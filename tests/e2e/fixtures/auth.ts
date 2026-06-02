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
//   1. Navigate straight to `/api/auth/login`, which the Fastify server
//      302-redirects to
//      `https://authelia.aconversa.local:9091/api/oidc/authorization?...`.
//      (The SPA's `/login` route auto-redirects to `/api/auth/login` for
//      unauthenticated visitors, so there is no intermediate button to
//      click; the helper skips the SPA hop and hits the server endpoint
//      directly.)
//   3. On Authelia's login form, fill `[name="username"]` and
//      `[name="password"]` and click the sign-in button. Authelia
//      validates against `/config/users.yml`, mints an authorization
//      code, and 302-redirects to `/api/auth/callback?state=...&code=...`.
//   4. The Fastify server's `/api/auth/callback` handler validates the
//      `state`, exchanges the code for tokens against Authelia's token
//      endpoint, upserts the `users` row, and 302-redirects the browser:
//        - returning user: 302 to `APP_BASE_URL` + Set-Cookie `aconversa-session`.
//        - new user: 302 to `/screen-name?from=callback` + Set-Cookie
//          `aconversa-auth-pending`. The SPA mounts `ScreenNameRoute`,
//          reads the `?from=callback` signal, and renders the form even
//          though `/api/auth/me` returns 401 with only the pending cookie.
//          See `tasks/refinements/backend/auth_callback_new_user_browser_redirect.md`.
//   5. The helper detects whichever branch fired:
//        - new user (URL contains `/screen-name`): fill the form's input
//          with `opts.screenName ?? opts.username` and click submit.
//          The SPA's `onSuccess` calls `auth.refresh()` and navigates
//          onward to the remembered return-to.
//        - returning user: nothing extra — the browser is already past
//          the OIDC dance with the session cookie set.
//   6. Poll `/api/auth/me` until 200 (the authenticated contract), then
//      return.
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
// **New-user branch — drive the browser through the screen-name form.**
// The backend's `/api/auth/callback` new-user branch 302-redirects to
// `/screen-name?from=callback` with the pending cookie set; the root
// SPA mounts `ScreenNameRoute`, reads the `?from=callback` signal,
// and renders the form despite `auth.status === 'unauthenticated'`
// (per `tasks/refinements/backend/auth_callback_new_user_browser_redirect.md`).
// The helper fills the form and submits it as a real user would; the
// form's POST validates the pending cookie server-side and the SPA's
// onSuccess navigates onward.
//
// **Promotion path.** `foundation.test_infra.playwright_test_helpers`
// (in the WBS) will move this helper to
// `packages/test-fixtures/playwright-helpers/` once that workspace
// lands and grow it with session / vote / commit helpers. Until then
// it lives here as a sibling to `authed-state.ts` and `locales.ts`.

import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { AUTHELIA_DEV_PASSWORD } from './dev-users';

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

// `DEV_USER_POOL` and `AUTHELIA_DEV_PASSWORD` live in a playwright-free
// sibling module so the Vitest pin in `tests/smoke/dev-user-pool.test.ts`
// can load the roster without dragging the `@playwright/test` runtime
// into happy-dom (whose env emits an unresolvable-URL console.error
// during playwright module init — a hard failure under
// `vitest.setup.ts`'s strict console gate). Re-exported here so the e2e
// callers that already import from `./fixtures/auth` keep working.
export { AUTHELIA_DEV_PASSWORD, DEV_USER_POOL } from './dev-users';

/**
 * Options accepted by {@link loginAs}.
 */
export interface LoginAsOptions {
  /**
   * Authelia username. Must be one of the seeded dev users in
   * `infra/authelia/users.yml`; the canonical roster lives in
   * {@link DEV_USER_POOL} (per ADR 0017 +
   * `tasks/refinements/participant-ui/part_e2e_user_pool_expansion_v2.md`).
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

  // 0. Storage-state short-circuit. The setup project
  //    (`tests/e2e/global-auth.setup.ts`) drives one OIDC dance per
  //    dev user and writes the resulting cookie jars to
  //    `authStorageStatePath(<username>)`; every consuming project
  //    loads alice's jar at project-level so the page's cookie jar
  //    already carries `aconversa-session` for alice before the first
  //    navigation. The `/api/auth/me === 200` probe is the canonical
  //    "the platform accepts this cookie" check; on a hit we skip the
  //    dance entirely (avoids hammering Authelia's per-IP rate
  //    limiter, which is what surfaced as `OAUTH_RESPONSE_IS_NOT_CONFORM`
  //    → 500 callback → bogus `auth-pending-cookie-invalid` failure
  //    in the original flake). On a miss (no storage state, expired
  //    cookie, or a different user wanted) we fall through to the
  //    full OIDC dance below. Tests that want to drive a fresh non-
  //    default user without an OIDC dance should pre-seed the jar
  //    explicitly via `authedContext(browser, username)` rather than
  //    relying on `loginAs` to short-circuit — `loginAs` runs the
  //    real dance for any cookie-free context so the resulting JWT
  //    is the test's own (and its eventual logout doesn't denylist
  //    the shared bootstrap JTI).
  const probe = await page.request.get('/api/auth/me');
  if (probe.status() === 200) {
    const body = (await probe.json()) as { userId: string; screenName: string };
    if (body.screenName === screenName) {
      return body;
    }
  }

  // 1. Kick the OIDC dance off. The SPA's `/login` route auto-
  //    redirects unauthenticated visitors to `/api/auth/login`, so
  //    skip the SPA hop entirely and hit the server endpoint directly
  //    — the resulting 302 to Authelia is the same in both paths.
  //    Skip the navigation if the browser is already mid-flow on the
  //    Authelia origin (a caller may have driven the SurfaceHost
  //    deflection through to Authelia already, in which case re-
  //    navigating here would just start a fresh OIDC flow on top of
  //    the in-flight one).
  if (!page.url().includes('authelia.aconversa.local')) {
    await page.goto('/api/auth/login');
  }

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
  //    the server now 302s the browser onward in BOTH branches:
  //
  //    - returning user: 302 to `APP_BASE_URL` (i.e., `/`). The SPA
  //      mounts and `useAuth()`'s `/api/auth/me` returns 200; the page
  //      settles on `/` (or `/login`'s post-auth `<Navigate>` target).
  //
  //    - new user: 302 to `/screen-name?from=callback` with the
  //      `aconversa-auth-pending` cookie set. The SPA mounts
  //      `ScreenNameRoute`, reads `?from=callback`, and renders the
  //      form despite `auth.status === 'unauthenticated'`. We fill it
  //      and submit; the POST validates the pending cookie server-side
  //      and the SPA's `onSuccess` navigates onward.
  if (page.url().includes('/screen-name')) {
    // The SPA's screen-name input + submit are both rendered with
    // stable test IDs by `<ScreenNameForm>`.
    await page.getByTestId('screen-name-input').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('screen-name-input').fill(screenName);
    await page.getByTestId('screen-name-submit').click();
    // Wait for the SPA to leave `/screen-name`; the `onSuccess` calls
    // `auth.refresh()` and then `navigate(resolvePostAuthTarget())`.
    await page.waitForURL((url) => !url.pathname.startsWith('/screen-name'), {
      timeout: 15_000,
    });
  }

  // 6. Poll `/api/auth/me` until it returns 200. This is the canonical
  //    "the cookie is set and the server agrees we're authenticated"
  //    signal.
  return waitForAuthenticated(page.request, deadlineMs);
}
