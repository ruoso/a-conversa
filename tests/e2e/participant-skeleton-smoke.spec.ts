// End-to-end placeholder spec for the participant surface skeleton.
//
// Refinement: tasks/refinements/participant-ui/part_app_skeleton.md
//              tasks/refinements/participant-ui/part_auth_flow.md
//              tasks/refinements/participant-ui/part_invite_acceptance.md
//                 (amends the chrome assertions to read off the
//                 invite-acceptance route's testid rather than the
//                 placeholder testid — the URL the original scenarios
//                 use now matches the new claim route; the chrome
//                 itself is unchanged and so are the chip / identity
//                 assertions, mirroring the mount.test.tsx surgical
//                 amendment in Decision §8).
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
// TaskJuggler: participant_ui.part_shell.part_app_skeleton,
//              participant_ui.part_shell.part_auth_flow
//
// **What this spec pins.** The skeleton's job is to make the
// moderator's already-emitted invite URLs (`/p/sessions/:id/invite?role=...`,
// see `apps/moderator/src/routes/InviteParticipants.tsx`) reachable
// from a logged-in browser. Before `part_app_skeleton` landed, those
// URLs fell through the root host's `*` catch-all and redirected to
// `/`. After it landed, the same URL resolved into the participant
// surface mounted by the root's `<SurfaceHost surfaceId="participant"
// routerBasePath="/p" />` route, the surface's wildcard route
// rendered, and the placeholder testid was visible.
//
// **`part_invite_acceptance` amendment.** The wildcard placeholder is
// no longer the route that matches the canonical invite URL shape —
// `<InviteAcceptanceRoute>` is. The skeleton assertions that pinned
// the surface-bundle mount + the chrome shape stay valid because the
// chrome composition is identical (same `<ParticipantLayout>` + same
// `<ParticipantChrome>` + same status chip in the footer); the
// testid the route renders changed from `route-participant-placeholder`
// to `route-invite-acceptance`. The not-found / claim-flow behaviour
// of the new route is pinned by `participant-invite-acceptance.spec.ts`,
// not here — this spec's scope stays "the bundle mounts and the chrome
// renders for the canonical invite URL".
//
// **Scope.** The `part_app_skeleton` scenario is one en-US case for the
// authenticated placeholder. `part_auth_flow` extends the spec with two
// additional scenarios:
//   (a) authenticated visit surfaces the host-supplied `screenName`
//       under the stable `participant-identity` testid;
//   (b) unauthenticated visit deflects to `/login` and remembers the
//       original `/p/...` URL under `sessionStorage['a-conversa:return-to']`.
// The cross-locale placeholder text is covered at the catalog parity
// layer.
//
// **Auth.** The Playwright project that runs this spec
// (`chromium-participant-skeleton` in `playwright.config.ts`) depends
// on the shared `setup-auth` project, which drives a single OIDC
// dance and persists the cookie jar to `AUTH_STORAGE_STATE_PATH`.
// `page.context()` therefore already carries `aconversa-session`
// before the first navigation; the spec does not need to call
// `loginAs` itself. The unauthenticated-deflection scenario opts out of
// the bootstrap jar via `test.use({ storageState: { ... } })` so the
// context starts cookie-free for the SPA's auth probe.

import { expect, test } from './fixtures/no-scrollbars';

// A deterministic UUID for the session id segment. The skeleton's
// wildcard route ignores the segment entirely, so the value is
// arbitrary — but a fixed UUID keeps the spec self-describing and
// matches the moderator's `InviteParticipants.tsx` URL shape.
const SESSION_ID = '00000000-0000-4000-8000-000000000099';

test.describe('Participant surface skeleton — invite URL reaches the surface bundle', () => {
  test('authenticated user hits /p/sessions/<uuid>/invite?role=debater-A and sees the invite-acceptance route render', async ({
    page,
  }) => {
    // Navigate directly to the participant invite URL shape the
    // moderator emits today (see
    // `apps/moderator/src/routes/InviteParticipants.tsx`). The root
    // host's `/p/*` route, the `SurfaceHost` dispatcher's dynamic-
    // import of the participant bundle, the surface's `mount(props)`
    // boundary, and the `BrowserRouter`-scoped route table must all
    // line up for the route testid to appear.
    //
    // After `part_invite_acceptance`, the URL matches the new
    // `<InviteAcceptanceRoute>` (testid `route-invite-acceptance`)
    // rather than the wildcard placeholder. The chrome composition is
    // unchanged, so the chip / identity / region assertions below stay
    // valid; this assertion swaps to the new testid.
    await page.goto(`/p/sessions/${SESSION_ID}/invite?role=debater-A`);

    await expect(
      page.getByTestId('route-invite-acceptance'),
      'the surface bundle must mount and render the invite-acceptance route for the canonical invite URL',
    ).toBeVisible({ timeout: 15_000 });

    // The invite-acceptance route's title is the first <h1> inside
    // the route body; pin the en-US text so a regression in the i18n
    // bridge (host-supplied i18n not reaching the surface) surfaces
    // here. The string is `participant.inviteAcceptance.title`
    // (en-US: "Join this debate").
    await expect(page.locator('h1').first()).toHaveText('Join this debate');

    // `part_landscape_layout`: the placeholder body is wrapped in a
    // landscape-grid chrome shell. Pin the four named-region testids
    // so a regression that strips the layout (or renames a region)
    // surfaces at the user-perspective layer, not just inside Vitest.
    await expect(page.getByTestId('participant-layout-root')).toBeVisible();
    const layoutHeader = page.getByTestId('participant-header');
    await expect(layoutHeader).toBeVisible();
    await expect(page.getByTestId('participant-main')).toBeVisible();
    const layoutFooter = page.getByTestId('participant-footer');
    await expect(layoutFooter).toBeVisible();

    // The header carries the product label (`participant.chrome.productLabel`,
    // en-US text). A regression that drops the chrome content but
    // keeps the region testid would otherwise pass.
    await expect(layoutHeader).toContainText('A Conversa — Participant');

    // The identity row migrates from the route body into the chrome
    // header (Decision §2 of part_landscape_layout). Pin that the
    // `participant-identity` element is a descendant of the header
    // region, not the route body — the structural shift this leaf
    // delivers.
    await expect(layoutHeader.getByTestId('participant-identity')).toBeVisible();

    // `part_status_indicator` + `part_ws_client`: the footer slot
    // carries the persistent connection-state chip. After
    // `part_ws_client` wired the real `useWsStore` source, the chip's
    // first paint is one of `'connecting'` (the moment the provider
    // calls `connect()`) or `'open'` (if the WS handshake against the
    // live compose stack completes before Playwright reads
    // `data-status`). The strict `'connecting'` assertion would race
    // the handshake — per Decision §2 of `part_status_indicator` and
    // Decision §3 of `part_ws_client`, the assertion is
    // transition-tolerant: accept either valid initial state. The
    // deterministic transition pin lives in the dedicated scenario
    // below.
    const statusIndicator = layoutFooter.getByTestId('participant-status-indicator');
    await expect(statusIndicator).toBeVisible();
    await expect
      .poll(() => statusIndicator.getAttribute('data-status'), { timeout: 5_000 })
      .toMatch(/^(connecting|open)$/);
  });

  test('chip surfaces the connection-state transition end-to-end', async ({ page }) => {
    // `part_ws_client` Acceptance §11 + Decision §3: pin the full
    // connecting → open → closed transition end-to-end against the
    // live compose stack. The first half (`'connecting'` initial
    // observation + `'open'` after the WS handshake) exercises the
    // real `/api/ws` upgrade through the provider's `connect()` path
    // against the `make up` server. The second half drives the store
    // imperatively via the `window.__aConversaWsStore` global the
    // participant `main.tsx` exposes (mirroring the moderator's
    // pattern), proving the chip re-renders on a store update without
    // depending on a server-side wire-tear path.
    await page.goto(`/p/sessions/${SESSION_ID}/invite?role=debater-A`);

    const chip = page.getByTestId('participant-status-indicator');
    await expect(chip).toBeVisible({ timeout: 15_000 });

    // Initial paint may be 'connecting' or already 'open' depending
    // on the handshake speed against the live compose stack — either
    // is a valid transient observation.
    await expect
      .poll(() => chip.getAttribute('data-status'), { timeout: 5_000 })
      .toMatch(/^(connecting|open)$/);

    // The WS handshake completes against the make-up compose stack;
    // the chip must reach 'open' within the polling window.
    await expect.poll(() => chip.getAttribute('data-status'), { timeout: 15_000 }).toBe('open');
    await expect(chip).toContainText('Live');

    // Imperatively drive the store to 'closed' (mirroring the
    // moderator's `wsStoreSeed` helper pattern). The chip's source
    // hook re-renders on the next React tick.
    await page.evaluate(() => {
      const w = window as unknown as {
        __aConversaWsStore: {
          getState: () => { setConnectionStatus: (s: string) => void };
        };
      };
      w.__aConversaWsStore.getState().setConnectionStatus('closed');
    });

    await expect.poll(() => chip.getAttribute('data-status'), { timeout: 5_000 }).toBe('closed');
    await expect(chip).toContainText('Disconnected');
  });

  test('authenticated visit surfaces the host-supplied screenName under participant-identity', async ({
    page,
  }) => {
    // Read the seeded user's `screenName` from `/api/auth/me` (the
    // canonical authenticated-shape probe) before navigating, so the
    // assertion below stays decoupled from which Authelia fixture user
    // the shared `setup-auth` project happened to seed. The probe
    // also doubles as a precondition check: if `setup-auth` didn't
    // land the cookie jar, this read fails before the navigation does
    // and makes the regression class obvious.
    const meResponse = await page.request.get('/api/auth/me');
    expect(
      meResponse.status(),
      'GET /api/auth/me must return 200 inside the chromium-participant-skeleton project',
    ).toBe(200);
    const me = (await meResponse.json()) as { userId: string; screenName: string };
    expect(me.screenName).toBeTruthy();

    await page.goto(`/p/sessions/${SESSION_ID}/invite?role=debater-A`);

    // Wait for the route before reading the identity row to keep the
    // assertion order deterministic. After `part_invite_acceptance`
    // the URL matches the new claim route (testid
    // `route-invite-acceptance`); the chrome composition is identical,
    // so the identity row is still a child of the chrome header
    // regardless of which route body renders.
    await expect(page.getByTestId('route-invite-acceptance')).toBeVisible({
      timeout: 15_000,
    });

    const identity = page.getByTestId('participant-identity');
    await expect(
      identity,
      'the participant surface must surface the host-supplied screenName under participant-identity',
    ).toBeVisible();
    await expect(identity).toContainText(me.screenName);

    // Belt-and-suspenders: the defensive panel must NOT be visible in
    // the authenticated branch (the not-authenticated guard is only
    // for the mid-mount status-flip / malformed-provider edges).
    await expect(page.getByTestId('participant-not-authenticated')).toHaveCount(0);
  });
});

test.describe('Participant surface skeleton — unauthenticated visit deflects to host login', () => {
  // Run with a fresh, cookie-free context so the SPA's `useAuth()`
  // probe (`GET /api/auth/me`) returns 401 and the host's
  // `SurfaceHost` deflects to `/login` via `<Navigate to="/login" />`
  // after `rememberReturnTo(...)`. Without this override the project's
  // default `storageState` would short-circuit through `setup-auth`'s
  // persisted jar and the deflection branch would never fire.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unauthenticated visit to /p/... bounces through /login to the SSO endpoint with the deep link remembered', async ({
    page,
  }) => {
    const inviteUrl = `/p/sessions/${SESSION_ID}/invite?role=debater-A`;
    await page.goto(inviteUrl);

    // The host's `SurfaceHost` branch reads `auth.status ===
    // 'unauthenticated'`, calls `rememberReturnTo(location.pathname +
    // location.search + location.hash)`, then renders `<Navigate
    // to="/login" replace />`. `LoginRoute`'s unauthenticated useEffect
    // immediately `window.location.replace('/api/auth/login')`, which
    // the server 302s onto Authelia. Wait for the bounce to settle on
    // the Authelia origin to prove the full deflection chain ran.
    await page.waitForURL((url) => url.hostname.includes('authelia.aconversa.local'), {
      timeout: 15_000,
    });

    // `rememberReturnTo` writes to `sessionStorage` under the
    // `a-conversa:return-to` key (see
    // `apps/root/src/surfaces/SurfaceHost.tsx`). The key lives on the
    // SPA origin, not on Authelia's — navigate back to `/` on the SPA
    // (the unauthenticated LandingRoute renders inline, no further
    // redirect) so we can read sessionStorage on the right origin.
    await page.goto('/');
    const rememberedReturnTo = await page.evaluate(() =>
      window.sessionStorage.getItem('a-conversa:return-to'),
    );
    expect(
      rememberedReturnTo,
      'SurfaceHost must remember the original /p/... URL so post-login navigation lands the debater back on the invite',
    ).toBe(inviteUrl);
  });
});
