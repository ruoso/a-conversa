// End-to-end placeholder spec for the participant surface skeleton.
//
// Refinement: tasks/refinements/participant-ui/part_app_skeleton.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
// TaskJuggler: participant_ui.part_shell.part_app_skeleton
//
// **What this spec pins.** The skeleton's job is to make the
// moderator's already-emitted invite URLs (`/p/sessions/:id/invite?role=...`,
// see `apps/moderator/src/routes/InviteParticipants.tsx`) reachable
// from a logged-in browser. Before this leaf lands, those URLs
// fall through the root host's `*` catch-all and redirect to `/`.
// After it lands, the same URL resolves into the participant surface
// mounted by the root's `<SurfaceHost surfaceId="participant"
// routerBasePath="/p" />` route, the surface's wildcard route renders,
// and the placeholder testid is visible.
//
// **Scope.** One scenario, en-US only. The cross-locale placeholder
// text is covered at the catalog parity layer. The unauthenticated
// → `/login` deflection is `SurfaceHost`'s responsibility and is
// already pinned by the existing root-host e2e coverage under `/m/*`
// (`tests/e2e/create-session-flow.spec.ts` exercises the same
// `rememberReturnTo` path); a `/p/*` mirror would duplicate coverage
// without pinning surface-specific behavior.
//
// **Auth.** The Playwright project that runs this spec
// (`chromium-participant-skeleton` in `playwright.config.ts`) depends
// on the shared `setup-auth` project, which drives a single OIDC
// dance and persists the cookie jar to `AUTH_STORAGE_STATE_PATH`.
// `page.context()` therefore already carries `aconversa-session`
// before the first navigation; the spec does not need to call
// `loginAs` itself.

import { expect, test } from '@playwright/test';

// A deterministic UUID for the session id segment. The skeleton's
// wildcard route ignores the segment entirely, so the value is
// arbitrary — but a fixed UUID keeps the spec self-describing and
// matches the moderator's `InviteParticipants.tsx` URL shape.
const SESSION_ID = '00000000-0000-4000-8000-000000000099';

test.describe('Participant surface skeleton — invite URL reaches the placeholder', () => {
  test('authenticated user hits /p/sessions/<uuid>/invite?role=debater-A and sees the placeholder', async ({
    page,
  }) => {
    // Navigate directly to the participant invite URL shape the
    // moderator emits today (see
    // `apps/moderator/src/routes/InviteParticipants.tsx`). The root
    // host's `/p/*` route, the `SurfaceHost` dispatcher's dynamic-
    // import of the participant bundle, the surface's `mount(props)`
    // boundary, and the `BrowserRouter`-scoped wildcard route must
    // all line up for the placeholder testid to appear.
    await page.goto(`/p/sessions/${SESSION_ID}/invite?role=debater-A`);

    await expect(
      page.getByTestId('route-participant-placeholder'),
      'the surface bundle must mount and render the placeholder route',
    ).toBeVisible({ timeout: 15_000 });

    // The placeholder title is the first <h1> inside the placeholder
    // main; pin the en-US text so a regression in the i18n bridge
    // (host-supplied i18n not reaching the surface) surfaces here.
    await expect(page.locator('h1').first()).toHaveText('Participant surface');
  });
});
