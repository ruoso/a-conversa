// End-to-end OIDC handshake spec — drives the full authorization-code
// dance against the dev compose stack's Authelia binary.
//
// Refinement: tasks/refinements/backend/auth_flow_integration.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.backend_tests.be_e2e_tests.auth_flow_integration
//
// **What this spec pins.** Every UI stream (moderator_ui,
// participant_ui, audience, replay_test) hits the OIDC handshake on
// first paint; a drift in the application's `openid-client` config,
// Authelia's client registration, or the network shape between them
// silently breaks all of them. This spec is the regression-class
// safety net — when one of the following drifts, this spec fails
// loudly and the orchestrator halts the offending UI stream:
//
//   - `client_secret_basic` vs `client_secret_post` mismatch between
//     `apps/server/src/auth/config.ts` and
//     `infra/authelia/configuration.yml` — caught by the returning-
//     user scenario at the token-exchange step.
//   - HTTPS-issuer flip (the `f01ef3b` regression) — `make up-prod-mode`
//     fails the `/healthz` poll before this spec even runs.
//   - FQDN-alias removal on the compose network (the `e02652b`
//     regression) — caught by the new-user scenario at the Authelia
//     authorize step.
//   - Callback handler splits drifting (returning-user no longer
//     issues `aconversa-session`; new-user no longer issues
//     `aconversa-auth-pending`) — caught by the cookie-jar assertion.
//   - `/api/auth/me` growing an extra field (no-profile-data-policy
//     regression) — caught by the exact-shape assertion.
//
// **Scenario ordering — `test.describe.serial`.** The four scenarios
// share the compose stack's `users` table state within a CI run:
//
//   1. new-user — CREATES the `users` row for `alice` (the OIDC
//      callback's upsert fires for the first time). Submits the
//      screen-name form. Asserts `/api/auth/me` returns `{ userId,
//      screenName: 'alice' }`.
//   2. returning-user — re-uses the row created above. The callback's
//      returning-user branch sets `aconversa-session` directly; no
//      screen-name form. Asserts the same `/api/auth/me` shape.
//   3. logout — clears the cookie. Asserts `/api/auth/me` returns 401
//      `auth-required` AFTER `POST /api/auth/logout`.
//   4. invalid-state — drives a single `request.get('/api/auth/callback?
//      state=bogus&code=irrelevant')` and asserts the 400
//      `auth-state-invalid` envelope. Pure HTTP, no browser
//      navigation — fast and isolated.
//
// Ordering matters because Authelia's users-file mode has no
// programmatic user-creation API; the `users` row IS the test
// state. CI's `make down-v` between runs drops both
// `aconversa-postgres-data` and `aconversa-authelia-data`, so every
// CI run begins on a clean slate.

import { expect, test } from '@playwright/test';

import { loginAs } from './fixtures/auth';

const TEST_USERNAME = 'alice';

const SESSION_COOKIE_NAME = 'aconversa-session';

test.describe.serial('OAuth flow integration — full handshake against Authelia', () => {
  test('new user: completes OIDC, lands on /screen-name, submits a screen name, /api/auth/me returns the user', async ({
    page,
  }) => {
    const me = await loginAs(page, { username: TEST_USERNAME });

    // The new-user branch ended at `POST /api/auth/screen-name`, which
    // cleared the pending cookie AND set the platform session cookie.
    // Inspect the page context's cookie jar (HttpOnly cookies are
    // readable here — Playwright's `context.cookies()` returns them).
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(
      sessionCookie,
      `${SESSION_COOKIE_NAME} cookie must be present after the new-user OIDC dance + screen-name submit`,
    ).toBeDefined();
    expect(sessionCookie?.httpOnly, `${SESSION_COOKIE_NAME} must be HttpOnly`).toBe(true);

    // `/api/auth/me` reads as `{ userId, screenName }` — and ONLY those
    // two keys. This pins the `no_profile_data_policy` invariant at
    // the e2e layer: a regression that leaks `oauthSubject` or any
    // OIDC claim through `/api/auth/me` fails here.
    expect(me.screenName, 'screenName must echo the value submitted to /api/auth/screen-name').toBe(
      TEST_USERNAME,
    );
    expect(typeof me.userId, 'userId must be a string (uuid)').toBe('string');
    expect(me.userId.length, 'userId must be a non-empty uuid string').toBeGreaterThan(0);

    // Exact-shape assertion — no extra fields. `Object.keys` ordering
    // is implementation-defined in the JSON parse pipeline, so we
    // sort before comparing.
    const meRaw = await page.request.get('/api/auth/me');
    expect(meRaw.status(), 'GET /api/auth/me must return 200 for the authenticated session').toBe(
      200,
    );
    const body = (await meRaw.json()) as Record<string, unknown>;
    expect(
      Object.keys(body).sort(),
      '/api/auth/me response shape must be exactly { userId, screenName }',
    ).toEqual(['screenName', 'userId']);
  });

  test('returning user: completes OIDC, redirected to APP_BASE_URL, /api/auth/me returns the same user', async ({
    browser,
  }) => {
    // Fresh browser context so the previous test's cookies don't
    // leak (Authelia's own session cookie would short-circuit the
    // form fill). The same dev user logs in — this time the upsert
    // in `/api/auth/callback` finds the existing row, the returning-user
    // branch fires, and `aconversa-session` is set directly without
    // the screen-name detour.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      const me = await loginAs(page, { username: TEST_USERNAME });
      expect(
        me.screenName,
        'returning user keeps the screen name set in the new-user scenario',
      ).toBe(TEST_USERNAME);

      // The returning-user branch issued `aconversa-session` on the
      // 302 from `/api/auth/callback`, NOT via a screen-name POST. Assert
      // the cookie is set and the URL never visited `/screen-name`.
      const cookies = await context.cookies();
      const sessionCookie = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      expect(
        sessionCookie,
        `${SESSION_COOKIE_NAME} cookie must be present after the returning-user OIDC dance`,
      ).toBeDefined();
      // The post-OIDC URL is `APP_BASE_URL` (i.e., `/`); after the
      // SPA's React Router settles, we could be on `/` or `/login`
      // depending on the route the welcome banner mounted under.
      // Either way `/screen-name` must NOT appear — the returning
      // user does not visit it.
      expect(page.url(), 'returning user must never land on /screen-name').not.toMatch(
        /\/screen-name/,
      );
    } finally {
      await context.close();
    }
  });

  test('logout: POST /api/auth/logout, subsequent /api/auth/me returns 401 auth-required', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      // Log in first so there's something to log out from. The row
      // for `alice` exists from the new-user scenario — this is the
      // returning-user path again, used as setup.
      await loginAs(page, { username: TEST_USERNAME });

      // Sanity: we're authenticated.
      const before = await page.request.get('/api/auth/me');
      expect(before.status(), 'precondition: /api/auth/me is 200 before logout').toBe(200);

      // Drive the logout. The handler returns 204 + a cookie-clear
      // Set-Cookie. The page context's cookie jar drops the value
      // when the Max-Age=0 / Expires=epoch attribute lands.
      const logoutResponse = await page.request.post('/api/auth/logout');
      expect(logoutResponse.status(), 'POST /api/auth/logout must return 204').toBe(204);

      // After the cookie clear, `/api/auth/me` returns the canonical 401
      // `auth-required` envelope. This pins the cookie-clear path
      // (the auth middleware's missing-cookie branch).
      const after = await page.request.get('/api/auth/me');
      expect(after.status(), '/api/auth/me must return 401 after logout').toBe(401);
      const body = (await after.json()) as { error?: { code?: string } };
      expect(
        body.error?.code,
        '/api/auth/me 401 envelope must carry code auth-required after logout',
      ).toBe('auth-required');

      // And the page context's cookie jar must no longer carry the
      // session cookie. (Playwright clears cookies whose Set-Cookie
      // ages them out; the assertion catches a regression where the
      // handler stops emitting the cookie-clear header.)
      const cookies = await context.cookies();
      const sessionCookie = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      expect(
        sessionCookie,
        `${SESSION_COOKIE_NAME} cookie must be cleared from the jar after logout`,
      ).toBeUndefined();
    } finally {
      await context.close();
    }
  });

  test('invalid state: navigating to /api/auth/callback with a bogus state returns 400 auth-state-invalid', async ({
    request,
  }) => {
    // Pure HTTP — no browser navigation, no Authelia touch. This
    // exercises the negative path on the callback handler: the
    // inbound `state` is not in the flow-state store, so the handler
    // throws `auth-state-invalid` and the error handler renders the
    // canonical 400 envelope.
    const response = await request.get('/api/auth/callback?state=bogus&code=irrelevant');
    expect(response.status(), '/api/auth/callback with bogus state must return 400').toBe(400);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(
      body.error?.code,
      '/api/auth/callback bogus-state envelope must carry code auth-state-invalid',
    ).toBe('auth-state-invalid');
  });
});
