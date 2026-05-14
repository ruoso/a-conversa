// Cross-locale smoke specs that load the moderator SPA through the
// single-origin Fastify server and assert localized strings render
// correctly.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_testing.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// **What this spec proves.** Per-locale Playwright projects pre-seed
// the `aconversa_locale` cookie (see `playwright.config.ts`). On
// `page.goto('/')`:
//
//   1. The Fastify server serves the moderator's built `index.html`
//      from `apps/moderator/dist/` (see
//      `apps/server/src/routes/static-frontends.ts`).
//   2. The browser parses the HTML, loads the hashed bundle, executes
//      the React app.
//   3. `negotiateAuthenticatedLocale()` reads the pre-seeded cookie
//      and resolves the project's locale.
//   4. `i18next` is initialized with the catalog for that locale, and
//      the `Login` route renders `t('auth.login.title')` in the
//      target language.
//
// The assertions iterate the expectation matrix from
// `fixtures/locales.ts`, which reads strings directly from
// `@a-conversa/i18n-catalogs`. A catalog edit propagates to both the
// rendered string and the expected string — the spec stays in sync.
//
// **What this spec does NOT do.** It does not complete the OIDC
// handshake against Authelia. The login navigation case asserts the
// browser leaves the SPA (the server-side `/auth/login` redirect
// fires) without driving the foreign-origin login flow. Full-stack
// auth flow tests are a separate task.

import { expect, test } from '@playwright/test';

import { expectationsFor } from './fixtures/locales';

// The per-locale project name carries the locale tag; the test
// extracts it from the project metadata so each test run knows what
// to assert.
function localeForProject(projectName: string): string {
  const prefix = 'chromium-';
  if (!projectName.startsWith(prefix)) {
    throw new Error(
      `i18n-moderator-smoke: spec ran outside a per-locale project ("${projectName}"). ` +
        `Configure the spec under projects with name "chromium-<locale>".`,
    );
  }
  return projectName.slice(prefix.length);
}

test.describe('moderator login route renders localized strings', () => {
  test('GET / serves the SPA shell and the login title matches the locale catalog', async ({
    page,
  }, testInfo) => {
    const locale = localeForProject(testInfo.project.name);
    const expected = expectationsFor(locale);

    // Load the moderator SPA through the single-origin server. The
    // browser follows the same path a real user would take — no Vite
    // preview, no proxy: the Fastify server's static-frontends plugin
    // returns the bundled `index.html`, the hashed assets stream from
    // the same origin, the React app boots in the page.
    const response = await page.goto('/');
    expect(response, 'GET / must return a response (the server is up at baseURL)').not.toBeNull();
    expect(response!.status(), `GET / status for locale ${locale}`).toBe(200);

    // Sanity-check that the document is the SPA's index.html (the
    // moderator's vite template mounts under `<div id="root">`). If
    // the static-frontends plugin regressed (e.g. served the JSON
    // 404 envelope), this catches it before the next assertion.
    const html = await response!.text();
    expect(html, 'GET / must return the moderator SPA index.html').toContain('<div id="root">');

    // Wait for the SPA to mount and render the login route. The
    // `negotiateAuthenticatedLocale` reads the cookie synchronously
    // during bootstrap; `initI18n` is awaited before `ReactDOM.render`,
    // so by the time the `route-title` H1 is in the DOM, the
    // localized string is already there.
    await expect(
      page.getByTestId('route-title'),
      `route-title must render for locale ${locale}`,
    ).toBeVisible();
    await expect(
      page.getByTestId('route-title'),
      `route-title must be the localized auth.login.title for locale ${locale}`,
    ).toHaveText(expected.loginTitle);
  });

  test('the SSO login affordance carries the localized label and navigates to /auth/login', async ({
    page,
  }, testInfo) => {
    const locale = localeForProject(testInfo.project.name);
    const expected = expectationsFor(locale);

    await page.goto('/');
    // Wait for unauthenticated state (the login button is rendered).
    // `auth-login-button` is rendered when `useAuth()` resolves to
    // `unauthenticated` (the default in the absence of a session
    // cookie); the spec runs without a session cookie, so this path
    // is the deterministic one.
    const loginButton = page.getByTestId('auth-login-button');
    await expect(loginButton, `login button must render for locale ${locale}`).toBeVisible();
    await expect(
      loginButton,
      `login button label must be the localized auth.login.button for locale ${locale}`,
    ).toHaveText(expected.loginButton);

    // The login button is an `<a href="/auth/login">`. A click triggers
    // a full-page navigation to the server's `/auth/login`, which
    // responds with a 302 to the OIDC issuer. We don't want to follow
    // the redirect into Authelia (that is a separate test layer), so
    // we intercept the navigation: assert the response status is a
    // redirect and the Location points at the OIDC issuer's
    // authorize endpoint.
    const navigationPromise = page.waitForResponse((resp) => resp.url().endsWith('/auth/login'), {
      timeout: 10_000,
    });
    await loginButton.click();
    const response = await navigationPromise;
    // The server emits a 302 with a Location to Authelia. Some compose
    // stacks (the dev one) point at `http://localhost:9091` for the
    // issuer; the assertion only needs the status to be a redirect
    // shape, not the destination's identity.
    expect(
      [302, 303, 307],
      `GET /auth/login must be a redirect for locale ${locale} (got ${response.status()})`,
    ).toContain(response.status());
    const location = response.headers()['location'];
    expect(
      location,
      `GET /auth/login must carry a Location header for locale ${locale}`,
    ).toBeDefined();
    // The redirect points at the OIDC `/authorize` endpoint — any
    // RFC-6749 conforming `response_type=code` URL satisfies. We
    // assert the `response_type=code` query string is present so a
    // misconfigured server (e.g. one that lost the OIDC plugin
    // wiring) trips here rather than fall through.
    expect(
      location,
      `GET /auth/login Location must include response_type=code for locale ${locale}`,
    ).toMatch(/response_type=code/);
  });

  test('GET /screen-name renders the SPA shell (client-side route)', async ({ page }, testInfo) => {
    const locale = localeForProject(testInfo.project.name);
    const expected = expectationsFor(locale);

    // A direct hit on a client-routed path goes through the SPA
    // fallback in the static-frontends plugin: the server returns
    // the SPA's `index.html` at 200, the SPA's React Router takes
    // over and renders the matching route.
    //
    // Without a pending-cookie or session cookie the screen-name
    // route falls back to the auth gate, which in turn redirects
    // unauthenticated users back to `/login`. Whichever path runs,
    // the bundle must still render a localized title — that's the
    // smoke this case pins.
    const response = await page.goto('/screen-name');
    expect(response, 'GET /screen-name must return a response').not.toBeNull();
    expect(
      response!.status(),
      `GET /screen-name status for locale ${locale} (200 from SPA fallback)`,
    ).toBe(200);

    // Wait for the SPA to settle. The `route-title` test id is
    // rendered by both the `Login` and `ScreenName` routes; the
    // string content depends on which path the auth state ends up
    // in. The smoke just confirms the SPA mounted and rendered
    // SOME localized title (proving react-i18next is wired into
    // the bundle through the single-origin path).
    await expect(
      page.getByTestId('route-title'),
      `route-title must render under /screen-name for locale ${locale}`,
    ).toBeVisible();
    // Loose assertion: the rendered title is one of the catalog
    // strings (login title OR screen-name title). The catalog is
    // the source of truth, so we read the localized strings via
    // `expectationsFor` and assert the rendered text matches one
    // of them. Avoids hard-coding which route the auth gate lands
    // on while still pinning that the i18n catalog answered.
    const titleText = await page.getByTestId('route-title').textContent();
    expect(titleText, `route-title must be a non-empty localized string`).not.toBeNull();
    expect(
      titleText!.trim().length,
      `route-title must be non-empty for locale ${locale}`,
    ).toBeGreaterThan(0);
    // The login-title is the most common landing for the unauthed
    // case; assert it specifically so a regression where the SPA
    // renders some other route's title here still fails.
    expect(
      titleText,
      `route-title under /screen-name should fall through to the login title for locale ${locale}`,
    ).toBe(expected.loginTitle);
  });
});
