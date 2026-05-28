// End-to-end spec for the audience surface's live session route at
// `/a/sessions/:sessionId`.
//
// Refinement: tasks/refinements/audience/aud_session_url.md
//   (Decision §7 — one spec file, six concrete scenarios; each pays
//   down a distinct deferred-e2e debt declared against this leaf:
//     1. Authenticated event delivery
//        (`aud_ws_client.md` Decision §10),
//     2. Live projection rendering
//        (`aud_state_management.md` Decision §7),
//     3. Anonymous WS delivery
//        (`aud_anonymous_ws_subscribe.md` debt),
//     4. Canvas mount on `/sessions/:id`
//        (`aud_cytoscape_init.md` Decision §9 — direct self-deferral),
//     5. OBS no-input audit at the graph-route tier
//        (`aud_obs_no_input_required.md` Decision §5),
//     6. OBS dimension audit at the graph-route tier
//        (`aud_obs_sizing_defaults.md` Decision §5).)
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
//              docs/adr/0027-entity-and-facet-layers-strict-separation.md
//              docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md
// TaskJuggler: audience.aud_url_routing.aud_session_url
//
// **Seeding flavour (Decision §5).** Inline `page.evaluate(...)` against
// `window.__aConversaWsStore.getState().applyEvent(...)`. The audience
// surface's `mount(props)` (apps/audience/src/main.tsx) assigns
// `audienceWsStore` onto the window key when `import.meta.env.DEV` is
// true; the compose-dev Vite build is dev-mode by default. High
// sequence numbers (`1_000_000+`) clear any live-subscription
// high-water mark per the participant precedent.
//
// **User pool assignment.** Six scenarios → one distinct dev user
// each from `DEV_USER_POOL` so the file's tests run in parallel under
// Playwright's `fullyParallel: true` posture without racing on the
// shared per-session user-creation path: alice, ben, maria, dave,
// erin, frank.

import {
  expect,
  expectNoScrollbars,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';

/**
 * Create a public session via the same-origin API. Mirrors the
 * participant-graph-render helper at `participant-graph-render.spec.ts:72-83`.
 */
async function createSession(
  page: Page,
  opts: { topic: string; privacy: 'public' | 'private' },
): Promise<string> {
  const response = await page.request.post('/api/sessions', {
    data: { topic: opts.topic, privacy: opts.privacy },
  });
  expect(response.status(), 'createSession: POST /api/sessions must return 201').toBe(201);
  const body = (await response.json()) as { id: string };
  expect(body.id, 'createSession: response body must carry a string id').toBeTruthy();
  return body.id;
}

/**
 * Allocate a fresh browser context (project-level `setup-auth` jar is
 * intentionally overridden) that starts authenticated. Each scenario
 * gets its own context so concurrent scenarios do not share cookies.
 */
async function freshAuthedContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
  });
}

/**
 * Seed a synthetic `node-created` event into the audience surface's
 * WS store via the dev-only `window.__aConversaWsStore` seam.
 */
async function seedNodeCreated(
  page: Page,
  seed: {
    sessionId: string;
    sequence: number;
    eventId: string;
    nodeId: string;
    wording: string;
    actorId: string;
  },
): Promise<void> {
  await page.evaluate(
    (s: {
      sessionId: string;
      sequence: number;
      eventId: string;
      nodeId: string;
      wording: string;
      actorId: string;
    }) => {
      const store = (
        window as unknown as {
          __aConversaWsStore?: {
            getState: () => { applyEvent: (event: unknown) => void };
          };
        }
      ).__aConversaWsStore;
      if (!store) {
        throw new Error('__aConversaWsStore is not exposed on window (audience dev seam)');
      }
      const apply = store.getState().applyEvent.bind(store.getState());
      apply({
        id: s.eventId,
        sessionId: s.sessionId,
        sequence: s.sequence,
        kind: 'node-created',
        actor: s.actorId,
        payload: {
          node_id: s.nodeId,
          wording: s.wording,
          created_by: s.actorId,
          created_at: '2026-05-27T00:00:00.000Z',
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      });
    },
    seed,
  );
}

/**
 * Seed a synthetic `edge-created` event into the audience surface's
 * WS store. `targetNodeId` may be unknown — Cytoscape's projection
 * filters dangling endpoints; the WS-store-state-level assertion does
 * not depend on whether the edge actually rendered.
 */
async function seedEdgeCreated(
  page: Page,
  seed: {
    sessionId: string;
    sequence: number;
    eventId: string;
    edgeId: string;
    sourceNodeId: string;
    targetNodeId: string;
    actorId: string;
  },
): Promise<void> {
  await page.evaluate(
    (s: {
      sessionId: string;
      sequence: number;
      eventId: string;
      edgeId: string;
      sourceNodeId: string;
      targetNodeId: string;
      actorId: string;
    }) => {
      const store = (
        window as unknown as {
          __aConversaWsStore?: {
            getState: () => { applyEvent: (event: unknown) => void };
          };
        }
      ).__aConversaWsStore;
      if (!store) {
        throw new Error('__aConversaWsStore is not exposed on window (audience dev seam)');
      }
      const apply = store.getState().applyEvent.bind(store.getState());
      apply({
        id: s.eventId,
        sessionId: s.sessionId,
        sequence: s.sequence,
        kind: 'edge-created',
        actor: s.actorId,
        payload: {
          edge_id: s.edgeId,
          role: 'supports',
          source_node_id: s.sourceNodeId,
          target_node_id: s.targetNodeId,
          created_by: s.actorId,
          created_at: '2026-05-27T00:00:00.000Z',
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      });
    },
    seed,
  );
}

/**
 * Read the WS-store events length for the named session via the dev
 * seam. Returns -1 when the store is missing or has no slice for the
 * session id — the caller asserts the positive value rather than the
 * absence of the sentinel.
 */
async function readEventsLength(page: Page, sessionId: string): Promise<number> {
  return page.evaluate((sid: string) => {
    const store = (
      window as unknown as {
        __aConversaWsStore?: {
          getState: () => {
            sessionState: Record<string, { events: readonly unknown[] }>;
          };
        };
      }
    ).__aConversaWsStore;
    if (!store) return -1;
    const slice = store.getState().sessionState[sid];
    if (!slice) return -1;
    return slice.events.length;
  }, sessionId);
}

test.describe('Audience live session route — /a/sessions/:sessionId', () => {
  test('(1) authenticated visitor: graph mounts, seeded node-created lands in the WS store, canvas paints', async ({
    browser,
  }) => {
    const context = await freshAuthedContext(browser);
    const page = await context.newPage();
    try {
      const alice = await loginAs(page, { username: 'alice' });
      expect(alice.screenName.toLowerCase()).toBe('alice');
      const sessionId = await createSession(page, {
        topic: 'Authenticated audience visit pins the graph mount',
        privacy: 'public',
      });

      await page.goto(`/a/sessions/${sessionId}`);

      // The new live route shadows the wildcard for `/sessions/<uuid>`,
      // so the placeholder testid must NOT render.
      await expect(page.getByTestId('route-audience-placeholder')).toHaveCount(0);

      // The graph container is the route body.
      await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

      await seedNodeCreated(page, {
        sessionId,
        sequence: 1_000_000,
        eventId: '55555555-5555-4555-8555-555555555550',
        nodeId: '11111111-1111-4111-8111-111111111111',
        wording: 'UBI lifts the welfare floor',
        actorId: alice.userId,
      });

      await expect
        .poll(() => readEventsLength(page, sessionId), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1);

      // Cytoscape paints labels to `<canvas>` layers; presence of
      // at least one canvas inside the testid container is the
      // canvas-end witness that the render pipeline started.
      const canvasCount = await page.getByTestId('audience-graph-root').locator('canvas').count();
      expect(canvasCount).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test('(2) live projection rendering: node-created + edge-created both land in the WS store, canvas layers present', async ({
    browser,
  }) => {
    const context = await freshAuthedContext(browser);
    const page = await context.newPage();
    try {
      const ben = await loginAs(page, { username: 'ben' });
      expect(ben.screenName.toLowerCase()).toBe('ben');
      const sessionId = await createSession(page, {
        topic: 'Live projection node + edge pair on the audience route',
        privacy: 'public',
      });

      await page.goto(`/a/sessions/${sessionId}`);
      await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

      const NODE_ID = '11111111-2222-4111-8111-111111111111';
      const UNKNOWN_TARGET_ID = '22222222-3333-4222-8222-222222222222';
      const EDGE_ID = '33333333-4444-4333-8333-333333333333';

      await seedNodeCreated(page, {
        sessionId,
        sequence: 1_000_001,
        eventId: '55555555-5555-4555-8555-555555555551',
        nodeId: NODE_ID,
        wording: 'Means-tested aid stigmatises',
        actorId: ben.userId,
      });
      await seedEdgeCreated(page, {
        sessionId,
        sequence: 1_000_002,
        eventId: '66666666-6666-4666-8666-666666666662',
        edgeId: EDGE_ID,
        sourceNodeId: NODE_ID,
        targetNodeId: UNKNOWN_TARGET_ID,
        actorId: ben.userId,
      });

      await expect
        .poll(() => readEventsLength(page, sessionId), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(2);

      const canvasCount = await page.getByTestId('audience-graph-root').locator('canvas').count();
      expect(canvasCount).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test('(3) anonymous WS delivery: anonymous browser context lands on the graph, anonymous-WS-upgrade carries the seeded event', async ({
    browser,
  }) => {
    // Two contexts: maria (authenticated) creates the public session;
    // a fresh anonymous context visits the URL and asserts the graph
    // mounts + the dev WS-store seam still seeds events.
    const creatorContext = await freshAuthedContext(browser);
    const creatorPage = await creatorContext.newPage();
    let sessionId: string;
    try {
      const maria = await loginAs(creatorPage, { username: 'maria' });
      expect(maria.screenName.toLowerCase()).toBe('maria');
      sessionId = await createSession(creatorPage, {
        topic: 'Anonymous WS upgrade carries audience events for public sessions',
        privacy: 'public',
      });
    } finally {
      await creatorContext.close();
    }

    const anonContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: { cookies: [], origins: [] },
    });
    const anonPage = await anonContext.newPage();
    try {
      await anonPage.goto(`/a/sessions/${sessionId}`);

      await expect(anonPage.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

      // `requiredAuthLevel: 'public'` honored — the URL did not bounce
      // to `/login`.
      expect(new URL(anonPage.url()).pathname).toBe(`/a/sessions/${sessionId}`);

      // The graph route is broadcast-clean — the sign-in chrome is the
      // placeholder route's affordance, NOT the graph route's.
      await expect(anonPage.getByTestId('audience-sign-in')).toHaveCount(0);

      await seedNodeCreated(anonPage, {
        sessionId,
        sequence: 1_000_010,
        eventId: '77777777-7777-4777-8777-777777777771',
        nodeId: '88888888-8888-4888-8888-888888888881',
        wording: 'Anonymous viewer sees the broadcast',
        actorId: '99999999-9999-4999-8999-999999999991',
      });

      await expect
        .poll(() => readEventsLength(anonPage, sessionId), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1);

      const canvasCount = await anonPage
        .getByTestId('audience-graph-root')
        .locator('canvas')
        .count();
      expect(canvasCount).toBeGreaterThan(0);
    } finally {
      await anonContext.close();
    }
  });

  test('(4) canvas mount: direct navigation to /a/sessions/<uuid> renders an empty Cytoscape canvas without any seeded events', async ({
    browser,
  }) => {
    const context = await freshAuthedContext(browser);
    const page = await context.newPage();
    try {
      const dave = await loginAs(page, { username: 'dave' });
      expect(dave.screenName.toLowerCase()).toBe('dave');
      const sessionId = await createSession(page, {
        topic: 'Empty Cytoscape canvas mounts on direct nav',
        privacy: 'public',
      });

      await page.goto(`/a/sessions/${sessionId}`);

      await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

      // Cytoscape mounts its `<canvas>` layers even with zero
      // elements — pin the empty-state baseline.
      const canvasCount = await page.getByTestId('audience-graph-root').locator('canvas').count();
      expect(canvasCount).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test('(5) OBS no-input audit at the graph-route tier: a populated graph mounts without any user-gating affordance', async ({
    browser,
  }) => {
    // Anonymous visitor — the OBS-canonical input shape per
    // `aud_obs_no_input_required.md`. Run the audit against a populated
    // graph so the assertion fires after the route has done its
    // event-driven rendering work.
    const creatorContext = await freshAuthedContext(browser);
    const creatorPage = await creatorContext.newPage();
    let sessionId: string;
    try {
      const erin = await loginAs(creatorPage, { username: 'erin' });
      expect(erin.screenName.toLowerCase()).toBe('erin');
      sessionId = await createSession(creatorPage, {
        topic: 'OBS no-input audit at the audience graph route',
        privacy: 'public',
      });
    } finally {
      await creatorContext.close();
    }

    const anonContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: { cookies: [], origins: [] },
    });
    const anonPage = await anonContext.newPage();
    try {
      await anonPage.goto(`/a/sessions/${sessionId}`);
      await expect(anonPage.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

      // Seed events so the audit runs against a populated graph (the
      // pixel-stability + canvas-readiness condition the OBS-source
      // contract cares about).
      await seedNodeCreated(anonPage, {
        sessionId,
        sequence: 1_000_020,
        eventId: '77777777-7777-4777-8777-777777777772',
        nodeId: '88888888-8888-4888-8888-888888888882',
        wording: 'OBS audit node',
        actorId: '99999999-9999-4999-8999-999999999992',
      });
      await expect
        .poll(() => readEventsLength(anonPage, sessionId), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1);

      // The audit. Each selector targets a pattern that would silently
      // break an OBS browser-source embed; the spec issues ZERO
      // user-interaction calls (no `.click()`, `.keyboard.*`,
      // `.mouse.*`) — these assertions confirm the surface reaches
      // its populated state without input.
      await expect(anonPage.locator('dialog')).toHaveCount(0);
      await expect(anonPage.locator('[aria-modal="true"]')).toHaveCount(0);
      await expect(anonPage.locator('audio')).toHaveCount(0);
      await expect(anonPage.locator('video')).toHaveCount(0);
      await expect(anonPage.locator('[data-requires-input="true"]')).toHaveCount(0);
    } finally {
      await anonContext.close();
    }
  });

  test('(7) anonymous visitor on a private session URL sees the per-session sign-in CTA', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/audience/aud_private_session_sign_in_cta.md
    //   (Acceptance criteria scenario 7 — anonymous visitor lands on
    //    a private session; the route mounts; the graph viewport is
    //    visible (empty); `audience-private-session-cta` renders with
    //    a `<LoginButton>` pointing at `/api/auth/login`.)
    // ADRs: 0029 (existence-non-leak; the wire returns `not-found`
    //              for anonymous-on-private), 0008 (Playwright).
    //
    // Creator (alice) creates the session directly as `privacy: 'private'`
    // via `POST /api/sessions` so no separate `PATCH /api/sessions/:id/privacy`
    // step is needed — the `createSession` helper accepts the privacy
    // discriminator and the audience surface only observes the wire
    // `not-found` reply.
    const creatorContext = await freshAuthedContext(browser);
    const creatorPage = await creatorContext.newPage();
    let sessionId: string;
    try {
      const alice = await loginAs(creatorPage, { username: 'alice' });
      expect(alice.screenName.toLowerCase()).toBe('alice');
      sessionId = await createSession(creatorPage, {
        topic: 'Private session anonymous visitor sees the sign-in CTA',
        privacy: 'private',
      });
    } finally {
      await creatorContext.close();
    }

    const anonContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: { cookies: [], origins: [] },
    });
    const anonPage = await anonContext.newPage();
    try {
      await anonPage.goto(`/a/sessions/${sessionId}`);

      // The route mounts — the graph viewport is the route body, the
      // CTA overlays it (Decision §1).
      await expect(anonPage.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

      // The URL did NOT bounce — the audience surface offers the
      // affordance in-place.
      expect(new URL(anonPage.url()).pathname).toBe(`/a/sessions/${sessionId}`);

      // The CTA itself.
      const cta = anonPage.getByTestId('audience-private-session-cta');
      await expect(cta).toBeVisible({ timeout: 15_000 });

      // The `<LoginButton>` inside the CTA points at the OIDC start
      // endpoint (ADR 0002).
      const loginLink = cta.locator('a').first();
      await expect(loginLink).toHaveAttribute('href', '/api/auth/login');
    } finally {
      await anonContext.close();
    }
  });

  test.describe('(6) OBS dimension audit at the graph-route tier', () => {
    // Match `DEFAULT_BROADCAST_DIMENSIONS` (1920×1080) from
    // `apps/audience/src/graph/layoutOptions.ts`. Scope the viewport
    // override to this describe so the other five scenarios continue
    // to use the project-level Desktop Chrome viewport.
    test.use({ viewport: { width: 1920, height: 1080 } });

    test('graph-root fills 1920×1080 edge-to-edge with no scrollbar-reserved strip', async ({
      browser,
    }) => {
      const context = await freshAuthedContext(browser);
      const page = await context.newPage();
      try {
        const frank = await loginAs(page, { username: 'frank' });
        expect(frank.screenName.toLowerCase()).toBe('frank');
        const sessionId = await createSession(page, {
          topic: 'OBS dimension audit at 1080p',
          privacy: 'public',
        });

        await page.goto(`/a/sessions/${sessionId}`);
        await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

        // Belt-and-suspenders against the auto-running fixture: the
        // explicit call surfaces the intent in the spec body.
        await expectNoScrollbars(page);

        const box = await page.locator('[data-testid="audience-graph-root"]').boundingBox();
        expect(box).not.toBeNull();
        // Tolerance ±1px for sub-pixel rounding.
        expect(box!.x).toBeLessThanOrEqual(1);
        expect(box!.y).toBeLessThanOrEqual(1);
        expect(Math.abs(box!.width - 1920)).toBeLessThanOrEqual(1);
        expect(Math.abs(box!.height - 1080)).toBeLessThanOrEqual(1);

        // `aud_obs_transparency` — the body composites with the
        // producer's scene via the alpha channel. The Vitest mount audit
        // pins this at the placeholder tier; this assertion extends the
        // pin to the reachable graph route under real Chromium at the
        // canonical 1080p OBS browser-source dimension. The dimension
        // matrix (720p, 1440p) is `aud_tests.aud_obs_render_smoke`'s
        // concern.
        const bodyBackgroundColor = await page.evaluate(
          () => getComputedStyle(document.body).backgroundColor,
        );
        expect(bodyBackgroundColor).toBe('rgba(0, 0, 0, 0)');
      } finally {
        await context.close();
      }
    });
  });
});
