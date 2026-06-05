// End-to-end placeholder spec for the test-mode surface skeleton.
//
// Refinement: tasks/refinements/replay_test/test_mode_app.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
// TaskJuggler: replay_test.test_mode.test_mode_app
//
// **What this spec pins.** The skeleton's job is to make the test-mode
// surface URLs (`/t/sessions/:id`) reachable from a browser. Before
// `test_mode_app` landed, those URLs fell through the root host's `*`
// catch-all and redirected to `/`. After it lands, the same URL
// resolves into the test-mode surface mounted by the root's
// `<SurfaceHost surfaceId="test-mode" routerBasePath="/t" />` route,
// the surface's wildcard route renders, and the placeholder testid is
// visible.
//
// **Auth.** The Playwright project that runs this spec
// (`chromium-test-mode-skeleton` in `playwright.config.ts`) depends on
// the shared `setup-auth` project, which drives a single OIDC dance and
// persists the cookie jar to `AUTH_STORAGE_STATE_PATH`. `page.context()`
// therefore already carries `aconversa-session` before the first
// navigation; the spec does not need to call `loginAs` itself. The
// unauthenticated-deflection scenario opts out of the bootstrap jar via
// `test.use({ storageState: { ... } })` so the context starts
// cookie-free for the SPA's auth probe.
//
// **Scope.** Two scenarios, en-US only (cross-locale text is covered at
// the catalog parity layer): (a) the authenticated placeholder render;
// (b) the `requiredAuthLevel: 'authenticated'` gate deflecting an
// anonymous visitor to the host login.

import { expect, test } from './fixtures/no-scrollbars';

// A deterministic UUID for the session id segment. The skeleton's
// wildcard route ignores the segment entirely, so the value is
// arbitrary — but a fixed UUID keeps the spec self-describing and
// matches the canonical test-mode session URL shape the downstream
// scrubber leaf will point at.
const SESSION_ID = '00000000-0000-4000-8000-000000000099';

test.describe('Test-mode surface skeleton — /t/* reaches the surface bundle', () => {
  test('authenticated user hits /t/sessions/<uuid> and sees the test-mode placeholder render', async ({
    page,
  }) => {
    // The root host's `/t/*` route, the `SurfaceHost` dispatcher's
    // dynamic-import of the test-mode bundle, the surface's
    // `mount(props)` boundary, and the `BrowserRouter`-scoped wildcard
    // route must all line up for the placeholder testid to appear.
    await page.goto(`/t/sessions/${SESSION_ID}`);

    await expect(
      page.getByTestId('route-test-mode-placeholder'),
      'the surface bundle must mount and render the test-mode placeholder',
    ).toBeVisible({ timeout: 15_000 });

    // The placeholder's title is the first <h1> inside the route body;
    // pin the en-US text so a regression in the i18n bridge (host-
    // supplied i18n not reaching the surface) surfaces here. The string
    // is `testMode.placeholder.title` (en-US: "Test mode").
    await expect(page.locator('h1').first()).toHaveText('Test mode');
  });
});

test.describe('Test-mode surface skeleton — unauthenticated visit deflects to host login', () => {
  // Run with a fresh, cookie-free context so the SPA's `useAuth()`
  // probe (`GET /api/auth/me`) returns 401 and the host's `SurfaceHost`
  // deflects to `/login` via `<Navigate to="/login" />` after
  // `rememberReturnTo(...)`. Without this override the project's default
  // `storageState` would short-circuit through `setup-auth`'s persisted
  // jar and the deflection branch would never fire.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unauthenticated visit to /t/... bounces through /login to the SSO endpoint', async ({
    page,
  }) => {
    await page.goto(`/t/sessions/${SESSION_ID}`);

    // The host's `SurfaceHost` reads `auth.status === 'unauthenticated'`
    // (the surface declares `requiredAuthLevel: 'authenticated'`), calls
    // `rememberReturnTo(...)`, then renders `<Navigate to="/login"
    // replace />`. `LoginRoute`'s unauthenticated useEffect immediately
    // `window.location.replace('/api/auth/login')`, which the server
    // 302s onto Authelia. Wait for the bounce to settle on the Authelia
    // origin to prove the full deflection chain ran.
    await page.waitForURL((url) => url.hostname.includes('authelia.aconversa.local'), {
      timeout: 15_000,
    });
  });
});
