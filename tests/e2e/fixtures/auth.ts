// Playwright helper for driving the full OIDC handshake against the
// dev compose stack's Authelia binary.
//
// Refinement: tasks/refinements/backend/auth_flow_integration.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.backend_tests.be_e2e_tests.auth_flow_integration
//
// **What this helper does.** `loginAs(page, opts)` drives one full
// authorization-code round-trip:
//
//   1. Navigate to `/login` (the moderator SPA's unauthenticated route).
//   2. Click `[data-testid="auth-login-button"]` — a full-page anchor to
//      `/api/auth/login`, which the Fastify server 302-redirects to
//      `https://authelia.aconversa.local:9091/api/oidc/authorization?...`.
//   3. On Authelia's login form, fill `[name="username"]` and
//      `[name="password"]` and click the sign-in button. Authelia
//      validates against `/config/users.yml`, mints an authorization
//      code, and 302-redirects to `/api/auth/callback?state=...&code=...`.
//   4. The Fastify server's `/api/auth/callback` handler validates the
//      `state`, exchanges the code for tokens against Authelia's token
//      endpoint, upserts the `users` row, and:
//        - returning user: 302 to `APP_BASE_URL` + Set-Cookie `aconversa-session`.
//        - new user: 200 + Set-Cookie `aconversa-auth-pending` + a JSON
//          body the SPA reads on the *next* SPA navigation.
//   5. The helper navigates the browser back to `/login` if the
//      callback's 200-JSON response left it stranded on
//      `/api/auth/callback`. The SPA's `LoginRoute` then reads `/api/auth/me`
//      and, on the `<pending>` screen-name placeholder, does
//      `<Navigate to="/screen-name" />`.
//   6. The helper detects whichever branch fired:
//        - If the post-OIDC URL is the screen-name form, fill it with
//          `opts.screenName ?? opts.username` and submit.
//        - Either way, poll `/api/auth/me` until 200 (the authenticated
//          contract), then return.
//
// **Why a single helper, not two.** Callers do NOT know whether the
// users row already exists in the test DB — CI re-uses one Authelia
// instance for all four scenarios, and the `users` row is created on
// the first OIDC callback. A single helper that handles both branches
// keeps callers honest: they pass `username` + `password`, they get
// back an authenticated `page` context. The new-user / returning-user
// split is an implementation detail of the dance, not of the API.
//
// **Why accessible-role selectors, not testids.** Authelia 4.39's
// React frontend uses MUI `<TextField>` components, which render the
// label text as an accessible name on the underlying `<input
// role="textbox">`. We locate by the ARIA accessible name ("Username",
// "Password") and by the submit button's accessible name ("Sign in").
// This is the contract Authelia ships for screen-reader users; it is
// stable across MUI versions in a way React-internal testids or the
// `name="..."` HTML attribute (which MUI does NOT set by default) would
// not be. The Authelia container is pinned to `authelia/authelia:4.39`
// in `compose.yaml`, so an upstream bump that changes the label text
// is a deliberate event.
//
// **Why the new-user branch POSTs `/api/auth/screen-name` via the API,
// not via the rendered form.** The backend's `/api/auth/callback`
// new-user branch returns a 200 JSON body
// (`{ sub, oauthSubject, userId, needsScreenName: true }`) instead
// of redirecting to the SPA's `/screen-name` route. The browser
// renders that JSON directly — the SPA is NOT mounted on this
// page, so there is no form to fill. Navigating to `/screen-name`
// without a session cookie hits `RequireAuth`'s `unauthenticated`
// branch (because `/api/auth/me` returns 401 — the pending cookie is
// not the platform session cookie) and redirects to `/login`,
// landing the user in a dead end. The cleanest way to close the
// loop in the helper is to POST `/api/auth/screen-name` directly from
// the test-side request context (which inherits the cookie jar
// including the pending cookie). The server validates the pending
// cookie, writes the screen name, and sets the platform session
// cookie. The helper then navigates to `/login` so the SPA mounts
// in `authenticated` state. The "raw JSON on `/api/auth/callback`" UX
// gap is acknowledged in `moderator-ui/mod_auth_flow.md`'s
// "screen-name-detection question" section; a follow-up task
// (backend Accept-header branching, or a frontend `/auth-callback`
// route) closes that gap for real users.
//
// **Promotion path.** `foundation.test_infra.playwright_test_helpers`
// (in the WBS) will move this helper to
// `packages/test-fixtures/playwright-helpers/` once that workspace
// lands and grow it with session / vote / commit helpers. Until then
// it lives here as a sibling to `authed-state.ts` and `locales.ts`.

import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Authelia 4.39 form-control accessible names. Treated as the helper's
 * upstream-version contract; an Authelia bump that renames these is a
 * deliberate event (the version is pinned in `compose.yaml`).
 *
 * MUI's `<TextField label="Username" />` renders the label text as the
 * input's accessible name, so `getByLabel('Username')` resolves to the
 * underlying `<input>` regardless of how MUI's internal DOM
 * (`aria-labelledby`, hidden `<label>`, etc.) shifts between releases.
 */
const AUTHELIA_USERNAME_LABEL = 'Username';
const AUTHELIA_PASSWORD_LABEL = 'Password';
/**
 * Authelia 4.39's submit button carries the accessible name "Sign in".
 * Located by role + name so a future MUI iteration that swaps the
 * `<button>` for a `<div role="button">` still resolves.
 */
const AUTHELIA_SUBMIT_NAME = /^Sign in$/i;

/**
 * The dev-only shared password baked into `infra/authelia/users.yml`
 * for the six seeded dev users (per ADR 0017). Hard-coded here rather
 * than read from env — the value is committed in the public repo
 * (the file's header acknowledges it as dev-only), and treating it as
 * a secret would be theater. Production Authelia uses a different
 * users backend and never sees this value.
 */
export const AUTHELIA_DEV_PASSWORD = 'aconversa-dev';

/**
 * Options accepted by {@link loginAs}.
 */
export interface LoginAsOptions {
  /**
   * Authelia username. Must be one of the seeded dev users in
   * `infra/authelia/users.yml` — `alice`, `ben`, `maria`, `dave`,
   * `erin`, `frank` (per ADR 0017).
   */
  readonly username: string;
  /**
   * Authelia password. Defaults to {@link AUTHELIA_DEV_PASSWORD}.
   * Callers typically omit this argument.
   */
  readonly password?: string;
  /**
   * Screen name to submit when the helper detects the new-user branch
   * (the `/screen-name` form is rendered). Defaults to the username,
   * which keeps the test self-describing: `loginAs(page, { username:
   * 'alice' })` produces a user whose screen name is `alice`.
   */
  readonly screenName?: string;
  /**
   * Hard ceiling on the whole handshake (ms). Authelia's cold-start
   * latency is the bottleneck; the default is generous to absorb a
   * slow CI runner.
   */
  readonly timeoutMs?: number;
}

/**
 * Polls `/api/auth/me` via the given page's request context until it
 * either returns 200 (authenticated) or the deadline elapses. Returns
 * the parsed `{ userId, screenName }` body on success; throws on
 * timeout. The poll interval is 250 ms — short enough to feel snappy,
 * long enough to avoid hammering the server.
 *
 * The poll is necessary because the OIDC callback's final 302 lands
 * the browser back on the SPA, which then mounts and fires its own
 * `/api/auth/me` request; the helper completes when the page-side cookie
 * jar carries the session cookie and the server returns the user
 * shape. Using the request context (rather than the page's `fetch`)
 * means the helper works whether the SPA has mounted yet or not.
 */
async function waitForAuthenticated(
  request: APIRequestContext,
  deadlineMs: number,
): Promise<{ userId: string; screenName: string }> {
  while (Date.now() < deadlineMs) {
    const response = await request.get('/api/auth/me');
    if (response.status() === 200) {
      const body = (await response.json()) as { userId: string; screenName: string };
      return body;
    }
    // Tolerate the 401 path explicitly — that's the unauthenticated
    // shape the middleware returns when no cookie is present yet.
    // Any other status is a test setup or wiring regression; surface
    // it immediately rather than silently retrying.
    if (response.status() !== 401) {
      throw new Error(
        `loginAs: GET /api/auth/me returned unexpected status ${response.status()} while waiting for authentication`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('loginAs: timed out waiting for GET /api/auth/me to return 200');
}

/**
 * Drive one full OIDC handshake against the dev compose stack's
 * Authelia, leaving the `page` (and its `context.cookies()` jar)
 * authenticated. Handles both the new-user branch (screen-name form
 * gets filled) and the returning-user branch (direct landing) without
 * the caller needing to know which one will fire.
 *
 * **Mutates the page's context.** Cookies set during the dance —
 * `authelia_session` (Authelia's own session), `aconversa-session`
 * (or `aconversa-auth-pending` for a moment in the new-user branch) —
 * live on `page.context()` after this returns. Subsequent
 * `page.goto(...)` calls inherit them.
 *
 * **Returns** the authenticated user's `{ userId, screenName }` as
 * read from `GET /api/auth/me` once the dance settles. Callers can use
 * the userId to seed downstream API calls without re-reading the
 * cookie jar.
 *
 * **Throws** on any structural failure: missing Authelia form,
 * timeout waiting for the auth state to settle, an unexpected status
 * on `/api/auth/me`. Each error message names the helper plus the failing
 * step so the regression class is obvious in the trace.
 *
 * @example
 *   await loginAs(page, { username: 'alice' });
 *   // page.context().cookies() now carries `aconversa-session`
 */
export async function loginAs(
  page: Page,
  opts: LoginAsOptions,
): Promise<{ userId: string; screenName: string }> {
  const password = opts.password ?? AUTHELIA_DEV_PASSWORD;
  const screenName = opts.screenName ?? opts.username;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const deadlineMs = Date.now() + timeoutMs;

  // 1. Land on the SPA's login route. Even if the SPA hasn't fully
  //    mounted (no `auth-login-button` rendered yet) we can fall back
  //    to a direct navigation to `/api/auth/login` — but the canonical
  //    path is the click, because that's what a real user does.
  await page.goto('/login');

  // 2. Click the SSO affordance. The button is an `<a href="/api/auth/login">`,
  //    so the click triggers a full-page navigation (the OIDC dance is
  //    cross-origin; `fetch` would not follow the redirect).
  const loginButton = page.getByTestId('auth-login-button');
  await expect(loginButton, 'loginAs: SPA must render the auth-login-button').toBeVisible({
    timeout: 10_000,
  });
  await loginButton.click();

  // 3. Authelia's login form. The page is a React SPA, so we wait
  //    for the username input to be visible (mounted + interactable)
  //    before typing. Authelia's first paint shows a "Loading…"
  //    spinner that resolves into the form once `/api/state` returns.
  await page.waitForURL(/authelia\.aconversa\.local/, { timeout: 30_000 });
  // `getByRole('textbox', { name: ... })` matches by accessible name,
  // which MUI's `<TextField>` exposes via the floating label's
  // `aria-labelledby` linkage. This is more robust than `getByLabel`
  // against MUI's hidden-label layout (MUI 5 hides the visible label
  // when the input is focused/filled, which can confuse `getByLabel`'s
  // label-text heuristic in some renderings).
  const usernameInput = page.getByRole('textbox', { name: AUTHELIA_USERNAME_LABEL });
  await expect(usernameInput, 'loginAs: Authelia login form must render').toBeVisible({
    timeout: 30_000,
  });
  await usernameInput.fill(opts.username);
  // The password input is `role="textbox"` for accessibility (MUI's
  // `type="password"` does not change the ARIA role); the "toggle
  // password visibility" sibling button is `role="button"` and does
  // NOT match the textbox role, so the locator stays unambiguous.
  await page.getByRole('textbox', { name: AUTHELIA_PASSWORD_LABEL }).fill(password);

  // 4. Submit. Authelia validates, mints a code, and 302s back to
  //    `/api/auth/callback`. The Fastify server then either 302s onto
  //    `APP_BASE_URL` (returning user) or returns a 200 JSON envelope
  //    the SPA reads and routes to `/screen-name` (new user).
  //
  //    We wait for the browser to leave the Authelia origin before
  //    deciding which branch fired. The first thing that happens after
  //    the form POSTs is Authelia's 302 to `/api/auth/callback?...`; the
  //    follow-up 302 (returning user) or 200 + SPA-route (new user)
  //    determines the URL we eventually settle on.
  await page.getByRole('button', { name: AUTHELIA_SUBMIT_NAME }).click();

  // 4a. Consent screen. Authelia's OIDC client (`aconversa-app-dev`) is
  //     not configured with `pre_configured_consent_duration`, so a
  //     freshly-authenticating user lands on the consent prompt
  //     ("Hi <name>, Consent Request — Use OpenID to verify your
  //     identity, [Accept] [Deny]"). We click Accept and continue.
  //     Once Authelia records the consent, subsequent OIDC dances for
  //     the same user skip this screen (the consent state lives in
  //     Authelia's sqlite store, which `make down-v` drops between
  //     CI runs). The helper polls for the Accept button with a short
  //     timeout — if the consent screen never renders (the user already
  //     consented in a prior scenario within the same run), we fall
  //     straight through to the post-Authelia URL wait.
  const acceptButton = page.getByRole('button', { name: /^Accept$/i });
  try {
    await acceptButton.waitFor({ state: 'visible', timeout: 5_000 });
    await acceptButton.click();
  } catch {
    // Consent screen not shown — user already consented. Fall through.
  }

  await page.waitForURL((url) => !url.hostname.includes('authelia.aconversa.local'), {
    timeout: 30_000,
  });

  // 5. Branch detection. After Authelia's 302 to `/api/auth/callback`,
  //    one of two things has happened server-side:
  //
  //    - returning user: the server 302'd onto `APP_BASE_URL`
  //      (i.e., `/`). The SPA mounts, reads `/api/auth/me`, transitions
  //      to `authenticated`, and renders the welcome banner. The
  //      browser settles on `/login` (the SPA's universal redirect
  //      sink for `/`).
  //
  //    - new user: the server returned a 200 JSON envelope
  //      (`{ sub, oauthSubject, userId, needsScreenName: true }`)
  //      directly on `/api/auth/callback`. The browser is now sitting
  //      on `/api/auth/callback` rendering the raw JSON — the SPA is
  //      NOT mounted because the response was JSON, not HTML.
  //
  //    We discriminate on the URL: `/api/auth/callback` means the
  //    new-user JSON-body branch fired. The cookie jar carries
  //    `aconversa-auth-pending` either way; for the new-user case
  //    we close out the screen-name step before navigating into
  //    the SPA (otherwise `/api/auth/me` returns 401 because the
  //    pending cookie is NOT the platform session cookie, and the
  //    SPA's `RequireAuth` would bounce the user out of
  //    `/screen-name` back to `/login` — see the
  //    `moderator-ui/mod_auth_flow.md` refinement's
  //    "screen-name-detection question" for the open UX gap that
  //    motivates closing it via the API path here rather than via
  //    the SPA's form-render path).
  if (page.url().includes('/api/auth/callback')) {
    // POST the screen-name directly via the cookie-jar-bearing
    // request context. The pending cookie sitting in
    // `page.context().cookies()` is sent automatically; the server
    // validates it, writes the screen name onto the users row, and
    // returns 200 with both Set-Cookies (pending-clear + session).
    const response = await page.request.post('/api/auth/screen-name', {
      data: { screenName },
      headers: { 'content-type': 'application/json' },
    });
    if (response.status() !== 200) {
      const body = await response.text();
      throw new Error(
        `loginAs: POST /api/auth/screen-name returned ${String(response.status())} during new-user setup; body: ${body}`,
      );
    }
  }

  // 6. Navigate to `/login` to settle the SPA. For returning users
  //    the SPA mounts and reads `/api/auth/me` (200, authenticated). For
  //    new users (just past the POST above) the session cookie is
  //    now set; the SPA reads `/api/auth/me` (200, authenticated). The
  //    redundant `goto('/login')` for returning users is cheap —
  //    the chunked bundle is cached after the earlier `goto('/login')`
  //    in step 1 — and keeps the post-helper page state symmetric
  //    across branches (callers see a mounted SPA, not a JSON view
  //    on `/api/auth/callback`).
  await page.goto('/login');

  // 7. Poll `/api/auth/me` until it returns 200. This is the canonical
  //    "the cookie is set and the server agrees we're authenticated"
  //    signal.
  return waitForAuthenticated(page.request, deadlineMs);
}
