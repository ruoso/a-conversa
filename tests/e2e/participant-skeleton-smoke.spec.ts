// End-to-end placeholder spec for the participant surface skeleton.
//
// Refinement: tasks/refinements/participant-ui/part_app_skeleton.md
//              tasks/refinements/participant-ui/part_auth_flow.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
// TaskJuggler: participant_ui.part_shell.part_app_skeleton,
//              participant_ui.part_shell.part_auth_flow
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

    // Wait for the placeholder before reading the identity row to keep
    // the assertion order deterministic — the identity row is a child
    // of the placeholder main per the `part_auth_flow` refinement
    // Component-shape section.
    await expect(page.getByTestId('route-participant-placeholder')).toBeVisible({
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

  test('unauthenticated visit to /p/... lands on /login with the deep link remembered', async ({
    page,
  }) => {
    const inviteUrl = `/p/sessions/${SESSION_ID}/invite?role=debater-A`;
    await page.goto(inviteUrl);

    // The host's `SurfaceHost` branch reads `auth.status ===
    // 'unauthenticated'`, calls `rememberReturnTo(location.pathname +
    // location.search + location.hash)`, then renders `<Navigate
    // to="/login" replace />`. The browser settles on `/login`.
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 15_000 });

    await expect(
      page.getByTestId('auth-login-button'),
      'the root host must surface the SSO affordance on /login',
    ).toBeVisible({ timeout: 15_000 });

    // `rememberReturnTo` writes to `sessionStorage` under the
    // `a-conversa:return-to` key (see
    // `apps/root/src/surfaces/SurfaceHost.tsx`). Read it back from the
    // page's session storage to pin the deep-link round-trip contract.
    const rememberedReturnTo = await page.evaluate(() =>
      window.sessionStorage.getItem('a-conversa:return-to'),
    );
    expect(
      rememberedReturnTo,
      'SurfaceHost must remember the original /p/... URL so post-login navigation lands the debater back on the invite',
    ).toBe(inviteUrl);
  });
});
