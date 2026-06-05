// End-to-end spec for the replay-mode variant of the audience surface.
//
// Refinement: tasks/refinements/replay_test/replay_mode_audience_surface.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
//              docs/adr/0039-shared-read-only-graph-view-package.md
//              docs/adr/0041-synthetic-session-generation-dev-gated-seam.md
//              docs/adr/0045-audience-replay-surface-visibility-gating.md
// TaskJuggler: replay_test.replay_ui.replay_mode_audience_surface
//
// **What this spec pins (Acceptance criterion 4 — the reachable-today
// behaviors).** The `/a/{locale}/replay/{id}` route, the shell's
// `useSessionEventLog` paging fetch against the authenticated
// `GET /api/sessions/:id/events`, the shared `@a-conversa/graph-view`
// renderer mounted from a *replayed log* (ADR 0039), and the
// `PrivateSessionCta` sign-in wall line up end to end:
//
//   (1) **Authenticated viewer → graph renders.** A synthetic session
//       (rich persisted log, node-created events) owned by the
//       authenticated caller loads at `/a/replay/<id>`; the graph root
//       mounts and the Cytoscape canvas paints.
//   (2) **Anonymous viewer of a non-public session → sign-in CTA.** A
//       no-cookie context visiting `/a/replay/<id>` for a PRIVATE session
//       gets a 404 from the now-relaxed endpoint (existence-non-leak —
//       private/absent are indistinguishable); the surface funnels the
//       viewer to the `PrivateSessionCta` sign-in affordance (ADR 0045/0029).
//   (3) **Locale prefix applied.** `/a/pt-BR/replay/<id>` renders a
//       pt-BR-localized string, proving the audience `App`-level URL-locale
//       negotiation flows through the replay route for free.
//   (4) **Anonymous viewer of a PUBLIC session → graph renders (ADR 0045,
//       `anonymous_public_session_log`).** Once the backend serves anonymous
//       public reads, a no-cookie context replaying a public session mounts
//       the graph with no sign-in wall — the deferred criterion 5 below,
//       now reachable from the backend relaxation alone (the surface already
//       gates on data-load status, not auth status).
//
// **Criterion 5 paid down here.** Anonymous replay of a *public* session
// without sign-in became reachable when
// `backend.replay_endpoints.anonymous_public_session_log` relaxed the
// events endpoint to 200 for an anonymous public read; test (4) below is
// that coverage.
//
// **Auth + seeding.** The `chromium-audience-replay` project depends on the
// shared `setup-auth` project. Scenarios that need a specific host allocate
// their own fresh context and `loginAs` (mirroring `audience-live-session`),
// then seed a persisted log through the dev-gated synthetic generator
// (`POST /api/test-mode/synthetic-sessions`) — the same real write path
// `test_mode_synthetic_session` established. The generator is live because
// `make up` runs the app under `NODE_ENV=development` (ADR 0041).

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';

// A deterministic UUID that no session mint will produce — the not-found
// input for the locale scenario (an authenticated viewer of an absent
// session reaches the localized "unavailable" affordance).
const UNUSED_SESSION_ID = '00000000-0000-4000-8000-0000000000fe';

/**
 * Allocate a fresh browser context that starts anonymous (the project-level
 * `setup-auth` jar is intentionally overridden). Each scenario gets its own
 * context so concurrent scenarios do not share cookies.
 */
async function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
  });
}

/**
 * Generate a synthetic session (rich persisted log, owned by the caller)
 * through the dev-gated generator — the real surface → real endpoint →
 * real persisted log path. Returns the new session id.
 */
async function generateSyntheticSession(page: Page): Promise<string> {
  const response = await page.request.post('/api/test-mode/synthetic-sessions', {
    data: { scenario: 'structured' },
  });
  expect(
    response.status(),
    'generateSyntheticSession: POST /api/test-mode/synthetic-sessions must return 201',
  ).toBe(201);
  const body = (await response.json()) as { sessionId: string };
  expect(body.sessionId, 'response body must carry a string sessionId').toBeTruthy();
  return body.sessionId;
}

/**
 * Flip a session's privacy to `public` via the host-only privacy toggle
 * (`PATCH /api/sessions/:id/privacy`). The synthetic generator mints a
 * PRIVATE session; an anonymous public-replay test needs it public.
 * Must be called on a page whose context owns the session (the host).
 */
async function makeSessionPublic(page: Page, sessionId: string): Promise<void> {
  const response = await page.request.patch(`/api/sessions/${sessionId}/privacy`, {
    data: { privacy: 'public' },
  });
  expect(
    response.status(),
    'makeSessionPublic: PATCH /api/sessions/:id/privacy must return 200',
  ).toBe(200);
}

test.describe('Audience replay surface — /a/{locale}/replay/:id', () => {
  test('(1) authenticated viewer: the replayed log renders the graph', async ({ browser }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const alice = await loginAs(page, { username: 'alice' });
      expect(alice.screenName.toLowerCase()).toBe('alice');
      // The caller owns the generated session, so `canSeeSession` admits
      // the authenticated replay read.
      const sessionId = await generateSyntheticSession(page);

      await page.goto(`/a/replay/${sessionId}`);

      // Real surface → `useSessionEventLog` → `GET /api/sessions/:id/events`
      // → real backend returns the synthetic log → the `ready` state mounts
      // the shared `@a-conversa/graph-view` renderer at the log head.
      await expect(
        page.getByTestId('audience-graph-root'),
        'the replayed log mounts the graph renderer',
      ).toBeVisible({ timeout: 15_000 });

      // Cytoscape paints nodes/labels to `<canvas>` layers; at least one
      // canvas inside the testid container is the canvas-end witness that
      // the render pipeline started over the node-created events.
      const canvasCount = await page.getByTestId('audience-graph-root').locator('canvas').count();
      expect(canvasCount, 'the replayed graph paints a Cytoscape canvas').toBeGreaterThan(0);

      // The URL stays put — replay is an in-place public route.
      expect(new URL(page.url()).pathname).toBe(`/a/replay/${sessionId}`);
    } finally {
      await context.close();
    }
  });

  test('(2) anonymous viewer of a PRIVATE session: 404 → not-found → the sign-in CTA', async ({
    browser,
  }) => {
    // A host first creates the session so it genuinely exists; the
    // anonymous read is gated by the session's PRIVATE privacy, not by
    // its absence. `generateSyntheticSession()` mints a PRIVATE session
    // (see `test-mode/routes.ts` — `privacy 'private'`), so the relaxed
    // endpoint returns 404 `not-found` (existence-non-leak — private and
    // absent are indistinguishable) and the surface shows the CTA. The
    // "anonymous → sign-in wall" behavior keeps its pin; only the gating
    // reason changed from a blanket 401 to a privacy-gated 404.
    const creatorContext = await freshContext(browser);
    const creatorPage = await creatorContext.newPage();
    let sessionId: string;
    try {
      await loginAs(creatorPage, { username: 'alice' });
      sessionId = await generateSyntheticSession(creatorPage);
    } finally {
      await creatorContext.close();
    }

    const anonContext = await freshContext(browser);
    const anonPage = await anonContext.newPage();
    try {
      await anonPage.goto(`/a/replay/${sessionId}`);

      // The relaxed endpoint 404s the anonymous read of a private
      // session; the hook maps 404 to `not-found`, and the surface
      // funnels the viewer to the sign-in wall (ADR 0045 — visibility-
      // gated v1).
      const cta = anonPage.getByTestId('audience-private-session-cta');
      await expect(cta, 'anonymous replay shows the sign-in CTA').toBeVisible({ timeout: 15_000 });

      // The URL did NOT bounce — the affordance is offered in-place.
      expect(new URL(anonPage.url()).pathname).toBe(`/a/replay/${sessionId}`);

      // The `<LoginButton>` inside the CTA points at the OIDC start
      // endpoint (ADR 0002).
      const loginLink = cta.locator('a').first();
      await expect(loginLink).toHaveAttribute('href', '/api/auth/login');
    } finally {
      await anonContext.close();
    }
  });

  test('(3) locale prefix flows through: /a/pt-BR/replay/<id> renders a pt-BR string', async ({
    page,
  }) => {
    // The default `page` carries the project `setup-auth` jar (authenticated
    // alice). An absent session id reaches the `not-found` → localized
    // "unavailable" affordance; the pt-BR URL prefix proves the audience
    // `App`-level `negotiateUrlLocale` effect localizes the replay route
    // with no route-local locale code.
    await page.goto(`/a/pt-BR/replay/${UNUSED_SESSION_ID}`);

    const unavailable = page.getByTestId('audience-replay-unavailable');
    await expect(unavailable, 'an absent session reaches the unavailable affordance').toBeVisible({
      timeout: 15_000,
    });

    // `audience.replay.unavailableTitle` in pt-BR — the URL-locale witness.
    await expect(unavailable).toContainText('Replay indisponível');
  });

  test('(4) anonymous viewer of a PUBLIC session: the replayed log renders the graph, no CTA', async ({
    browser,
  }) => {
    // ADR 0045 — the deferred criterion 5 (`replay_mode_audience_surface`),
    // paid down by `anonymous_public_session_log`. A host seeds a synthetic
    // session (PRIVATE by default) and flips it PUBLIC; an anonymous
    // (no-cookie) context replays it. The relaxed endpoint returns 200 to
    // the anonymous public read → the hook flips to `ready` →
    // `AudienceReplayRoute` mounts `<GraphView>` with no auth conditional.
    const creatorContext = await freshContext(browser);
    const creatorPage = await creatorContext.newPage();
    let sessionId: string;
    try {
      await loginAs(creatorPage, { username: 'alice' });
      sessionId = await generateSyntheticSession(creatorPage);
      await makeSessionPublic(creatorPage, sessionId);
    } finally {
      await creatorContext.close();
    }

    const anonContext = await freshContext(browser);
    const anonPage = await anonContext.newPage();
    try {
      await anonPage.goto(`/a/replay/${sessionId}`);

      // 200 → `ready` → the shared `@a-conversa/graph-view` renderer mounts
      // for an anonymous viewer — no sign-in required.
      await expect(
        anonPage.getByTestId('audience-graph-root'),
        'the anonymous public replay mounts the graph renderer',
      ).toBeVisible({ timeout: 15_000 });

      // Cytoscape paints nodes/labels to `<canvas>` layers — the
      // render-pipeline witness over the node-created events.
      const canvasCount = await anonPage
        .getByTestId('audience-graph-root')
        .locator('canvas')
        .count();
      expect(canvasCount, 'the replayed graph paints a Cytoscape canvas').toBeGreaterThan(0);

      // The sign-in wall is ABSENT — the public read needs no auth.
      await expect(
        anonPage.getByTestId('audience-private-session-cta'),
        'no sign-in CTA for an anonymous public replay',
      ).toHaveCount(0);

      // The URL stays put — replay is an in-place public route.
      expect(new URL(anonPage.url()).pathname).toBe(`/a/replay/${sessionId}`);
    } finally {
      await anonContext.close();
    }
  });

  test('(5) playback controls: step + play/pause move the position over the replay', async ({
    browser,
  }) => {
    // Refinement: replay_playback_controls (Acceptance §3 — reachable
    // behavior on the already-mounted authenticated replay surface). The
    // controls render into the `ready` branch the surface already shipped, so
    // the "not yet reachable" e2e deferral does not apply.
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      await loginAs(page, { username: 'alice' });
      const sessionId = await generateSyntheticSession(page);

      await page.goto(`/a/replay/${sessionId}`);

      // The surface lands on the head frame with the controls present.
      const controls = page.getByTestId('audience-replay-controls');
      await expect(controls, 'the playback controls render in the ready branch').toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId('audience-replay-play')).toBeVisible();
      await expect(page.getByTestId('audience-replay-step-back')).toBeVisible();
      await expect(page.getByTestId('audience-replay-step-forward')).toBeVisible();

      const positionEl = page.getByTestId('audience-replay-position');
      const readPosition = async (): Promise<number> =>
        Number(await positionEl.getAttribute('data-position'));
      const head = Number(await positionEl.getAttribute('data-head'));
      expect(head, 'the synthetic log has a multi-event head to traverse').toBeGreaterThan(1);
      // Head-landing default (ADR 0045): the cursor opens at the head.
      expect(await readPosition()).toBe(head);

      // Step back then forward: the readout decrements then re-increments.
      await page.getByTestId('audience-replay-step-back').click();
      expect(await readPosition()).toBe(head - 1);
      await page.getByTestId('audience-replay-step-forward').click();
      expect(await readPosition()).toBe(head);

      // Play restarts from the start (Decision §5) and auto-advances over
      // wall-clock time.
      await page.getByTestId('audience-replay-play').click();
      await expect
        .poll(readPosition, {
          timeout: 15_000,
          message: 'play auto-advances the position past the baseline',
        })
        .toBeGreaterThan(0);

      // Pause (toggle the same control) freezes the position.
      await page.getByTestId('audience-replay-play').click();
      const paused = await readPosition();
      await page.waitForTimeout(2_500);
      expect(await readPosition(), 'pause stops the auto-advance').toBe(paused);
    } finally {
      await context.close();
    }
  });

  test('(6) seek bar: dragging relocates the position and the thumb tracks playback', async ({
    browser,
  }) => {
    // Refinement: replay_seek_bar (Acceptance §3 — reachable behavior on the
    // already-mounted authenticated replay surface). The seek bar renders into
    // the same `ready` controls cluster test (5) drives, so the "not yet
    // reachable" e2e deferral does not apply.
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      await loginAs(page, { username: 'alice' });
      const sessionId = await generateSyntheticSession(page);

      await page.goto(`/a/replay/${sessionId}`);

      // The surface lands on the head frame with the controls + seek bar.
      await expect(page.getByTestId('audience-replay-controls')).toBeVisible({ timeout: 15_000 });
      const seek = page.getByTestId('audience-replay-seek');
      await expect(seek, 'the seek bar renders in the ready branch').toBeVisible();

      const positionEl = page.getByTestId('audience-replay-position');
      const readPosition = async (): Promise<number> =>
        Number(await positionEl.getAttribute('data-position'));
      const graphRoot = page.getByTestId('audience-graph-root');
      const head = Number(await positionEl.getAttribute('data-head'));
      expect(head, 'the synthetic log has a multi-event head to traverse').toBeGreaterThan(1);
      expect(await readPosition()).toBe(head);

      // Setting the controlled range to a mid value relocates the cursor; the
      // readout and the rendered graph follow.
      const mid = Math.floor(head / 2);
      await seek.fill(String(mid));
      await expect(positionEl, 'a mid seek relocates the position readout').toHaveAttribute(
        'data-position',
        String(mid),
      );
      await expect(graphRoot, 'the graph re-renders at the seeked prefix').toBeVisible();

      // Pressing play (restart from the baseline) advances the seek value over
      // wall-clock time — the thumb doubles as a progress indicator.
      await page.getByTestId('audience-replay-play').click();
      await expect
        .poll(async () => Number(await seek.inputValue()), {
          timeout: 15_000,
          message: 'play advances the seek bar value past the baseline',
        })
        .toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test('(7) deep-link: ?position seeds the opening frame; out-of-range lands on the head', async ({
    browser,
  }) => {
    // Refinement: replay_url_position_loading (Acceptance §3 — reachable
    // behavior on the already-mounted authenticated replay surface). The
    // deep-link wires the shipped `?position` parser to the shipped playback
    // container, so the "not yet reachable" e2e deferral does not apply.
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      await loginAs(page, { username: 'alice' });
      const sessionId = await generateSyntheticSession(page);

      const positionEl = page.getByTestId('audience-replay-position');
      const readPosition = async (): Promise<number> =>
        Number(await positionEl.getAttribute('data-position'));
      const seek = page.getByTestId('audience-replay-seek');

      // First load with no `?position` to discover the head; the synthetic
      // log's head is server-derived, so we learn the mid target from it.
      await page.goto(`/a/replay/${sessionId}`);
      await expect(positionEl).toBeVisible({ timeout: 15_000 });
      const head = await readPosition();
      expect(head, 'the synthetic log has a multi-event head to deep-link into').toBeGreaterThan(1);
      const mid = Math.floor(head / 2);
      expect(mid, 'a mid sequence is a distinct stop from the head').toBeGreaterThan(0);

      // Deep-link to `?position=<mid>`: the surface opens with the cursor and
      // the seek thumb at `<mid>`, and the graph renders the prefix — not the
      // head frame.
      await page.goto(`/a/replay/${sessionId}?position=${String(mid)}`);
      await expect(
        positionEl,
        'the deep-link seeds the readout at the URL position',
      ).toHaveAttribute('data-position', String(mid));
      await expect(seek, 'the seek thumb reflects the URL-seeded position').toHaveValue(
        String(mid),
      );
      await expect(
        page.getByTestId('audience-graph-root'),
        'the graph renders the deep-linked prefix',
      ).toBeVisible();

      // An out-of-range `?position` degrades to the head frame (clamped) —
      // the informative complete-session default, no dead end.
      await page.goto(`/a/replay/${sessionId}?position=${String(head + 1000)}`);
      await expect(positionEl, 'an out-of-range deep-link clamps to the head').toHaveAttribute(
        'data-position',
        String(head),
      );
      await expect(seek).toHaveValue(String(head));
    } finally {
      await context.close();
    }
  });
});
