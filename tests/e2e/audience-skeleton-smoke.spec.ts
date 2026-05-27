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

import { expect, test } from './fixtures/no-scrollbars';

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

    // `aud_auth_for_private` Decision §1: authenticated visitors see
    // NO sign-in chrome — broadcast-clean aesthetic. The `audience-sign-in`
    // testid is reserved for the anonymous-branch affordance.
    await expect(page.getByTestId('audience-sign-in')).toHaveCount(0);
  });
});

// `aud_no_auth_for_public` — the host now honors a surface's declared
// `meta.requiredAuthLevel: 'public'` and mounts the audience surface
// for anonymous visitors, skipping the `/login` deflection that the
// authenticated-default-gated surfaces still apply. This describe
// block scopes an empty cookie jar via `test.use` so the browser
// context starts genuinely unauthenticated, then proves the canonical
// audience URL renders the placeholder anyway — and that the URL
// stays on `/a/...` (no implicit redirect to `/login`). The default
// project-level `storageState` (the bootstrap auth jar from
// `setup-auth`) is overridden for THIS describe block only; the
// authenticated scenario above keeps using the project-level state.
// See Decision §7 of the refinement.
test.describe('Audience surface skeleton — anonymous visitor reaches the placeholder', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('anonymous browser hits /a/sessions/<uuid> and sees the placeholder without bouncing to /login', async ({
    page,
  }) => {
    await page.goto(`/a/sessions/${SESSION_ID}`);

    await expect(
      page.getByTestId('route-audience-placeholder'),
      'the audience surface must mount for anonymous visitors when the surface declares requiredAuthLevel="public"',
    ).toBeVisible({ timeout: 15_000 });

    // Pin the URL stayed on `/a/...` — no implicit redirect to
    // `/login`. The host's `rememberReturnTo` write must also have
    // been skipped (Decision §6), but the URL pin is the directly-
    // observable proof; the `rememberReturnTo` pin is in the Vitest
    // case.
    expect(new URL(page.url()).pathname).toBe(`/a/sessions/${SESSION_ID}`);

    // `aud_auth_for_private`: an anonymous visitor of a (possibly-
    // private) audience URL is offered a sign-in affordance — the
    // shell's `<LoginButton>` rendered under the `audience-sign-in`
    // testid. The inner `<a>` points at `/api/auth/login` per ADR 0002
    // (full-page redirect, NOT `fetch`); clicking it eventually drops
    // the visitor back at the audience URL with an authenticated
    // session, at which point the surface re-mounts and the future
    // per-session subscribe runs under the authenticated predicate.
    const signIn = page.getByTestId('audience-sign-in');
    await expect(signIn).toBeVisible();
    await expect(signIn.locator('a')).toHaveAttribute('href', '/api/auth/login');
  });
});
