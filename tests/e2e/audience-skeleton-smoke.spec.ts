// End-to-end placeholder spec for the audience surface skeleton.
//
// Refinement: tasks/refinements/audience/aud_app_skeleton.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
// TaskJuggler: audience.aud_shell.aud_app_skeleton
//
// **What this spec pins.** The skeleton's job is to make the audience
// surface URLs (`/a/sessions/:id`) reachable from a browser. Before
// `aud_app_skeleton` landed, those URLs fell through the root host's
// `*` catch-all and redirected to `/`. After it lands, the same URL
// resolves into the audience surface mounted by the root's
// `<SurfaceHost surfaceId="audience" routerBasePath="/a" />` route,
// the surface's wildcard route renders, and the placeholder testid is
// visible.
//
// **Auth.** The Playwright project that runs this spec
// (`chromium-audience-skeleton` in `playwright.config.ts`) depends on
// the shared `setup-auth` project, which drives a single OIDC dance
// and persists the cookie jar to `AUTH_STORAGE_STATE_PATH`.
// `page.context()` therefore already carries `aconversa-session`
// before the first navigation. The audience surface's eventual
// public-session path (no auth required) is `aud_no_auth_for_public`'s
// scope; this skeleton inherits the `SurfaceHost`'s authenticated-only
// gate for the placeholder spec — that's enough to prove the bundle
// mounts.
//
// **Scope.** One scenario, en-US only (cross-locale text is covered at
// the catalog parity layer). The unauthenticated-deflection path is
// pinned by sibling specs against `/m/*` and `/p/*` and is not
// duplicated here (would not add new behaviour coverage at this tier).

import { expect, test } from '@playwright/test';

// A deterministic UUID for the session id segment. The skeleton's
// wildcard route ignores the segment entirely, so the value is
// arbitrary — but a fixed UUID keeps the spec self-describing and
// matches the canonical audience URL shape the OBS producer would
// point at.
const SESSION_ID = '00000000-0000-4000-8000-000000000099';

test.describe('Audience surface skeleton — /a/sessions/:id reaches the surface bundle', () => {
  test('authenticated user hits /a/sessions/<uuid> and sees the audience placeholder render', async ({
    page,
  }) => {
    // Navigate directly to the canonical audience session URL shape.
    // The root host's `/a/*` route, the `SurfaceHost` dispatcher's
    // dynamic-import of the audience bundle, the surface's
    // `mount(props)` boundary, and the `BrowserRouter`-scoped wildcard
    // route table must all line up for the placeholder testid to
    // appear.
    await page.goto(`/a/sessions/${SESSION_ID}`);

    await expect(
      page.getByTestId('route-audience-placeholder'),
      'the surface bundle must mount and render the audience placeholder for the canonical session URL',
    ).toBeVisible({ timeout: 15_000 });

    // The placeholder's title is the first <h1> inside the route body;
    // pin the en-US text so a regression in the i18n bridge (host-
    // supplied i18n not reaching the surface) surfaces here. The
    // string is `audience.placeholder.title` (en-US: "Audience
    // surface").
    await expect(page.locator('h1').first()).toHaveText('Audience surface');
  });
});
