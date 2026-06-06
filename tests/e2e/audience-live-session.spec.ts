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
// erin, frank. Later additions extend the pool: scenario (7) reuses
// alice under a fresh `freshAuthedContext`, scenario (8) reuses alice
// likewise, scenario (9) takes `grace`, scenario (10) takes `henry`,
// scenario (11) takes `ivan`.
//
// Refinement: tasks/refinements/audience/aud_diagnostic_edge_fire_animation.md
//   (Decision §6 — Playwright spec lands INLINE here, not deferred. The
//   audience surface is reachable via `aud_session_url`'s route; the
//   `window.__aConversaWsStore` dev seam lets the scenario apply a
//   structural diagnostic mid-broadcast and assert the edge-locus
//   halo with its blocking severity class. Scenario (9) below.)
// Refinement: tasks/refinements/audience/aud_diagnostic_fire_animation_seeding_alignment.md
//   (Decision §4 — pays down the grand-predecessor
//   `aud_diagnostic_fire_animation`'s deferred-e2e debt (chain target
//   `aud_session_url` is `complete 100`). Scenario (10) below asserts
//   the fresh-session post-empty-mount cycle-fire animates the three
//   node-locus halos at the system seam. Pool member: `henry` (next
//   unallocated after grace).)
// Refinement: tasks/refinements/audience/aud_render_annotation_endpoint_edges.md
//   (Decision §8 — Playwright cover IS in scope (not deferred); the
//   audience surface is reachable via `aud_session_url`. Scenario (11)
//   below seeds `node-created` + `annotation-created` +
//   `edge-created (target_annotation_id)` via the same dev seam and
//   pins the mutual-exclusion contract: the promoted annotation
//   renders as a Cytoscape graph-node, and the DOM-overlay badge for
//   its id is suppressed. Pool member: `ivan` (next unallocated after
//   henry).)
// Refinement: tasks/refinements/audience/aud_chapter_marker_render.md
//   (Acceptance criteria §4 / Decision §7 — Playwright cover IS in
//   scope (not deferred); the audience surface is reachable via
//   `aud_session_url`. Scenario (12) below seeds `snapshot-created`
//   events via the same dev seam and pins the live chapter-marker
//   caption: absent before any snapshot, appears with the verbatim
//   label, supersedes to a newer snapshot. Pool member: `julia` (next
//   unallocated after ivan).)

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
 * Seed a synthetic `annotation-created` event into the audience
 * surface's WS store via the dev-only `window.__aConversaWsStore`
 * seam. Used by scenario (11) below to materialize a promoted
 * annotation graph-node on the broadcast canvas.
 */
async function seedAnnotationCreated(
  page: Page,
  seed: {
    sessionId: string;
    sequence: number;
    eventId: string;
    annotationId: string;
    kind: 'note' | 'reframe' | 'scope-change' | 'stance';
    content: string;
    targetNodeId: string | null;
    targetEdgeId: string | null;
    actorId: string;
  },
): Promise<void> {
  await page.evaluate(
    (s: {
      sessionId: string;
      sequence: number;
      eventId: string;
      annotationId: string;
      kind: 'note' | 'reframe' | 'scope-change' | 'stance';
      content: string;
      targetNodeId: string | null;
      targetEdgeId: string | null;
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
        kind: 'annotation-created',
        actor: s.actorId,
        payload: {
          annotation_id: s.annotationId,
          kind: s.kind,
          content: s.content,
          target_node_id: s.targetNodeId,
          target_edge_id: s.targetEdgeId,
          created_by: s.actorId,
          created_at: '2026-05-30T00:00:00.000Z',
        },
        createdAt: '2026-05-30T00:00:00.000Z',
      });
    },
    seed,
  );
}

/**
 * Seed a synthetic annotation-endpoint `edge-created` event — i.e. an
 * `edge-created` whose `target_annotation_id` (or `source_annotation_id`)
 * is set instead of the node-id endpoint. Used by scenario (11) to
 * exercise the lifted skip-guard at
 * `apps/audience/src/graph/projectGraph.ts:308-321`.
 */
async function seedAnnotationEndpointEdgeCreated(
  page: Page,
  seed: {
    sessionId: string;
    sequence: number;
    eventId: string;
    edgeId: string;
    sourceNodeId: string;
    targetAnnotationId: string;
    role: 'contradicts' | 'supports' | 'rebuts';
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
      targetAnnotationId: string;
      role: 'contradicts' | 'supports' | 'rebuts';
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
          role: s.role,
          source_node_id: s.sourceNodeId,
          target_annotation_id: s.targetAnnotationId,
          created_by: s.actorId,
          created_at: '2026-05-30T00:00:00.000Z',
        },
        createdAt: '2026-05-30T00:00:00.000Z',
      });
    },
    seed,
  );
}

/**
 * Apply a structural diagnostic to the audience surface's WS store
 * via the dev-only `window.__aConversaWsStore` seam. Mirrors the
 * `seedNodeCreated` / `seedEdgeCreated` shape but reaches the
 * `applyDiagnostic` reducer rather than `applyEvent`. The inline
 * `diagnostic` field shape mirrors the server-side payload union
 * narrowed by `apps/audience/src/graph/diagnosticHighlights.ts`.
 */
async function applyDiagnostic(
  page: Page,
  payload: {
    sessionId: string;
    kind: string;
    severity: 'blocking' | 'advisory';
    status: 'fired' | 'cleared';
    sequence: number;
    diagnostic: unknown;
  },
): Promise<void> {
  await page.evaluate(
    (p: {
      sessionId: string;
      kind: string;
      severity: 'blocking' | 'advisory';
      status: 'fired' | 'cleared';
      sequence: number;
      diagnostic: unknown;
    }) => {
      const store = (
        window as unknown as {
          __aConversaWsStore?: {
            getState: () => { applyDiagnostic: (payload: unknown) => void };
          };
        }
      ).__aConversaWsStore;
      if (!store) {
        throw new Error('__aConversaWsStore is not exposed on window (audience dev seam)');
      }
      store.getState().applyDiagnostic(p);
    },
    payload,
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

/**
 * Seed a synthetic `snapshot-created` event into the audience surface's
 * WS store via the dev-only `window.__aConversaWsStore` seam. Drives the
 * live chapter-marker caption (`<ChapterMarker>`), which projects the
 * most-recent snapshot label from the events slice.
 */
async function seedSnapshotCreated(
  page: Page,
  seed: {
    sessionId: string;
    sequence: number;
    eventId: string;
    snapshotId: string;
    label: string;
    logPosition: number;
    actorId: string;
  },
): Promise<void> {
  await page.evaluate(
    (s: {
      sessionId: string;
      sequence: number;
      eventId: string;
      snapshotId: string;
      label: string;
      logPosition: number;
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
        kind: 'snapshot-created',
        actor: s.actorId,
        payload: {
          snapshot_id: s.snapshotId,
          label: s.label,
          log_position: s.logPosition,
        },
        createdAt: '2026-06-05T00:00:00.000Z',
      });
    },
    seed,
  );
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

  test('(8) URL grammar widens with `?position=<sequence>`: route mounts, seeded node lands, no console errors', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/audience/aud_url_position_param.md
    //   (Acceptance criteria §5 — navigating to `/a/sessions/<uuid>?position=42`
    //   mounts the live route cleanly: canvas appears, seeded event
    //   reaches the WS store, no console error fires during navigation.
    //   The position value sits dormant in this leaf — downstream
    //   `replay_test.replay_ui.replay_url_position_loading` is what
    //   interprets it.)
    const context = await freshAuthedContext(browser);
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    try {
      const alice = await loginAs(page, { username: 'alice' });
      expect(alice.screenName.toLowerCase()).toBe('alice');
      const sessionId = await createSession(page, {
        topic: 'URL `?position=<sequence>` grammar mounts the live route cleanly',
        privacy: 'public',
      });

      await page.goto(`/a/sessions/${sessionId}?position=42`);

      // The position query string did not divert the route: the
      // `audience-graph-root` testid renders within the same budget the
      // other scenarios use.
      await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

      // The URL is preserved (no redirect that would drop the query).
      const visited = new URL(page.url());
      expect(visited.pathname).toBe(`/a/sessions/${sessionId}`);
      expect(visited.searchParams.get('position')).toBe('42');

      await seedNodeCreated(page, {
        sessionId,
        sequence: 1_000_030,
        eventId: '88888888-8888-4888-8888-888888888883',
        nodeId: '11111111-2222-4111-8111-111111111188',
        wording: 'Position-param URL grammar widening pin',
        actorId: alice.userId,
      });

      await expect
        .poll(() => readEventsLength(page, sessionId), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1);

      const canvasCount = await page.getByTestId('audience-graph-root').locator('canvas').count();
      expect(canvasCount).toBeGreaterThan(0);

      expect(
        consoleErrors,
        `console errors during navigation: ${consoleErrors.join(' | ')}`,
      ).toEqual([]);
      expect(pageErrors, `page errors during navigation: ${pageErrors.join(' | ')}`).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('(9) Diagnostic-fire edge halo on contradiction: seeded edges halo amber-blocking when the contradiction fires', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/audience/aud_diagnostic_edge_fire_animation.md
    //   (Acceptance — INLINE Playwright spec. Pre-fire snapshot: zero
    //   edge-locus halos. After `applyDiagnostic(...)` with a
    //   `contradiction` payload naming two edges, exactly 2 edge-locus
    //   halos render carrying `aud-diagnostic-fire-blocking`. The user
    //   `grace` is unallocated in the existing pool; the scenario uses
    //   a fresh authed context per the parallel-safety contract.)
    const context = await freshAuthedContext(browser);
    const page = await context.newPage();
    try {
      const grace = await loginAs(page, { username: 'grace' });
      expect(grace.screenName.toLowerCase()).toBe('grace');
      const sessionId = await createSession(page, {
        topic: 'Diagnostic-fire edge halo on a contradiction over the audience route',
        privacy: 'public',
      });

      await page.goto(`/a/sessions/${sessionId}`);
      await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

      const NODE_A_ID = '11111111-aaaa-4111-8111-111111111aaa';
      const NODE_B_ID = '11111111-bbbb-4111-8111-111111111bbb';
      const EDGE_1_ID = '22222222-aaaa-4222-8222-222222222aaa';
      const EDGE_2_ID = '22222222-bbbb-4222-8222-222222222bbb';

      // Seed two nodes + two edges so cy has elements to halo against.
      await seedNodeCreated(page, {
        sessionId,
        sequence: 1_000_100,
        eventId: '99999999-aaaa-4999-8999-999999999aaa',
        nodeId: NODE_A_ID,
        wording: 'Contradiction halo edge — node A',
        actorId: grace.userId,
      });
      await seedNodeCreated(page, {
        sessionId,
        sequence: 1_000_101,
        eventId: '99999999-bbbb-4999-8999-999999999bbb',
        nodeId: NODE_B_ID,
        wording: 'Contradiction halo edge — node B',
        actorId: grace.userId,
      });
      await seedEdgeCreated(page, {
        sessionId,
        sequence: 1_000_102,
        eventId: '99999999-cccc-4999-8999-999999999ccc',
        edgeId: EDGE_1_ID,
        sourceNodeId: NODE_A_ID,
        targetNodeId: NODE_B_ID,
        actorId: grace.userId,
      });
      await seedEdgeCreated(page, {
        sessionId,
        sequence: 1_000_103,
        eventId: '99999999-dddd-4999-8999-999999999ddd',
        edgeId: EDGE_2_ID,
        sourceNodeId: NODE_B_ID,
        targetNodeId: NODE_A_ID,
        actorId: grace.userId,
      });

      await expect
        .poll(() => readEventsLength(page, sessionId), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(4);

      // Pre-fire snapshot: no edge-locus halos render.
      const edgeHaloLocator = page.locator(
        '[data-diagnostic-fire-anim][data-diagnostic-fire-locus="edge"]',
      );
      await expect(edgeHaloLocator).toHaveCount(0);

      // Apply a contradiction diagnostic naming both seeded edges.
      await applyDiagnostic(page, {
        sessionId,
        kind: 'contradiction',
        severity: 'blocking',
        status: 'fired',
        sequence: 1_000_200,
        diagnostic: {
          kind: 'contradiction',
          nodeA: NODE_A_ID,
          nodeB: NODE_B_ID,
          edges: [EDGE_1_ID, EDGE_2_ID],
        },
      });

      // Both edge halos appear within the rAF settle window.
      await expect(edgeHaloLocator).toHaveCount(2);
      await expect(edgeHaloLocator.first()).toHaveClass(/aud-diagnostic-fire-blocking/);
      await expect(edgeHaloLocator.nth(1)).toHaveClass(/aud-diagnostic-fire-blocking/);
    } finally {
      await context.close();
    }
  });

  test('(10) Diagnostic-fire node halo on cycle: seeded nodes halo amber-blocking when the cycle fires', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/audience/aud_diagnostic_fire_animation_seeding_alignment.md
    //   (Acceptance — INLINE Playwright spec. Pays down the grand-
    //   predecessor `aud_diagnostic_fire_animation`'s deferred-e2e debt
    //   that was originally chained against `aud_session_url`. Pre-fire
    //   snapshot: zero node-locus diagnostic halos. After
    //   `applyDiagnostic(...)` with a `cycle` payload naming three
    //   nodes, exactly 3 node-locus halos render carrying
    //   `aud-diagnostic-fire-blocking`. The fresh-session post-empty-
    //   mount fire animation is the load-bearing observable that the
    //   surgical local-ref seeding fix enables; without the fix, the
    //   three halos render but lack the animation class. Pool member:
    //   `henry` (next unallocated after grace).)
    const context = await freshAuthedContext(browser);
    const page = await context.newPage();
    try {
      const henry = await loginAs(page, { username: 'henry' });
      expect(henry.screenName.toLowerCase()).toBe('henry');
      const sessionId = await createSession(page, {
        topic: 'Diagnostic-fire node halo on a cycle over the audience route',
        privacy: 'public',
      });

      await page.goto(`/a/sessions/${sessionId}`);
      await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

      const NODE_A_ID = '33333333-aaaa-4333-8333-333333333aaa';
      const NODE_B_ID = '33333333-bbbb-4333-8333-333333333bbb';
      const NODE_C_ID = '33333333-cccc-4333-8333-333333333ccc';

      // Seed three nodes so cy has elements to halo against.
      await seedNodeCreated(page, {
        sessionId,
        sequence: 1_000_300,
        eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        nodeId: NODE_A_ID,
        wording: 'Cycle halo node — A',
        actorId: henry.userId,
      });
      await seedNodeCreated(page, {
        sessionId,
        sequence: 1_000_301,
        eventId: 'aaaaaaaa-bbbb-4aaa-8aaa-aaaaaaaaaaab',
        nodeId: NODE_B_ID,
        wording: 'Cycle halo node — B',
        actorId: henry.userId,
      });
      await seedNodeCreated(page, {
        sessionId,
        sequence: 1_000_302,
        eventId: 'aaaaaaaa-cccc-4aaa-8aaa-aaaaaaaaaaac',
        nodeId: NODE_C_ID,
        wording: 'Cycle halo node — C',
        actorId: henry.userId,
      });

      await expect
        .poll(() => readEventsLength(page, sessionId), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(3);

      // Pre-fire snapshot: no node-locus diagnostic-fire halos render.
      // The selector excludes the edge sibling's locus attribute; node-
      // overlay halos carry `data-node-id` and lack
      // `data-diagnostic-fire-locus`.
      const nodeHaloLocator = page.locator(
        '[data-diagnostic-fire-anim]:not([data-diagnostic-fire-locus="edge"])',
      );
      await expect(nodeHaloLocator).toHaveCount(0);

      // Apply a cycle diagnostic naming all three seeded nodes.
      await applyDiagnostic(page, {
        sessionId,
        kind: 'cycle',
        severity: 'blocking',
        status: 'fired',
        sequence: 1_000_400,
        diagnostic: {
          kind: 'cycle',
          nodes: [NODE_A_ID, NODE_B_ID, NODE_C_ID],
        },
      });

      // All three node halos appear within the rAF settle window, each
      // carrying the blocking severity class — the load-bearing pin
      // for the local-ref seeding fix at the system seam.
      await expect(nodeHaloLocator).toHaveCount(3);
      await expect(nodeHaloLocator.nth(0)).toHaveClass(/aud-diagnostic-fire-blocking/);
      await expect(nodeHaloLocator.nth(1)).toHaveClass(/aud-diagnostic-fire-blocking/);
      await expect(nodeHaloLocator.nth(2)).toHaveClass(/aud-diagnostic-fire-blocking/);
    } finally {
      await context.close();
    }
  });

  test('(11) Annotation-endpoint edge promotes annotation to a Cytoscape node + suppresses the DOM-overlay badge', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/audience/aud_render_annotation_endpoint_edges.md
    //   (Decision §8 — Playwright cover IS in scope; the audience surface
    //   is reachable via `/a/sessions/:sessionId` and the
    //   `window.__aConversaWsStore` dev seam lets the scenario seed the
    //   minimum sequence of events that exercises the lifted
    //   skip-guard at `projectGraph.ts:308-321`. The load-bearing
    //   observable contract pinned end-to-end here is the
    //   mutual-exclusion rule from Decisions §1 + §3: an annotation
    //   referenced as an edge endpoint becomes a Cytoscape graph-node
    //   and SUPPRESSES its DOM-overlay badge. The Vitest layer pins
    //   the Cytoscape-side projection + stylesheet branches; this
    //   scenario asserts the end-to-end wiring round-trips through the
    //   WS store + the live React + Cytoscape mount on the real route.
    //   Pool member: `ivan` (next unallocated after henry).)
    const context = await freshAuthedContext(browser);
    const page = await context.newPage();
    try {
      const ivan = await loginAs(page, { username: 'ivan' });
      expect(ivan.screenName.toLowerCase()).toBe('ivan');
      const sessionId = await createSession(page, {
        topic: 'Annotation-endpoint edge promotes to a Cytoscape node on the audience canvas',
        privacy: 'public',
      });

      await page.goto(`/a/sessions/${sessionId}`);
      await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

      const NODE_1_ID = 'cccccccc-1111-4ccc-8ccc-cccccccccccc';
      const ANNO_1_ID = 'cccccccc-aaaa-4ccc-8ccc-ccccccccaaaa';
      const STATEMENT_EDGE_ID = 'cccccccc-eeee-4ccc-8ccc-cccccccceeee';

      // Seed: N1 → A1 (reframe, target_node_id=N1) → edge(N1 →
      // target_annotation_id=A1). After the projection runs, A1 is
      // promoted to a Cytoscape graph-node and the DOM badge for A1 is
      // suppressed.
      await seedNodeCreated(page, {
        sessionId,
        sequence: 1_000_500,
        eventId: 'cccccccc-dddd-4ccc-8ccc-cccccccc0001',
        nodeId: NODE_1_ID,
        wording: 'Means-testing carries stigma costs',
        actorId: ivan.userId,
      });
      await seedAnnotationCreated(page, {
        sessionId,
        sequence: 1_000_501,
        eventId: 'cccccccc-dddd-4ccc-8ccc-cccccccc0002',
        annotationId: ANNO_1_ID,
        kind: 'reframe',
        content: 'Means-test ≠ universal',
        targetNodeId: NODE_1_ID,
        targetEdgeId: null,
        actorId: ivan.userId,
      });
      await seedAnnotationEndpointEdgeCreated(page, {
        sessionId,
        sequence: 1_000_502,
        eventId: 'cccccccc-dddd-4ccc-8ccc-cccccccc0003',
        edgeId: STATEMENT_EDGE_ID,
        sourceNodeId: NODE_1_ID,
        targetAnnotationId: ANNO_1_ID,
        role: 'contradicts',
        actorId: ivan.userId,
      });

      await expect
        .poll(() => readEventsLength(page, sessionId), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(3);

      // Canvas is mounted — Cytoscape's render layers are present.
      const canvasCount = await page.getByTestId('audience-graph-root').locator('canvas').count();
      expect(canvasCount).toBeGreaterThan(0);

      // Mutual-exclusion contract per Decision §3 + Constraint §2: the
      // DOM-overlay badge for the promoted annotation must NOT mount;
      // the annotation renders as a Cytoscape graph-node instead. This
      // is the unique behavioural pin this scenario adds to the
      // existing Vitest cover.
      await expect(
        page.locator(`[data-testid="audience-annotation-badge-${ANNO_1_ID}"]`),
      ).toHaveCount(0);

      // The audience-annotation-overlay continues to mount (the third
      // sibling of audience-graph-root, per `aud_annotation_rendering`),
      // but it carries no row for the promoted annotation id.
      const overlay = page.getByTestId('audience-annotation-overlay');
      await expect(overlay).toHaveCount(1);
      const promotedRow = overlay.locator(`[data-element-id="${ANNO_1_ID}"]`);
      await expect(promotedRow).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('(12) live chapter marker: absent before any snapshot, appears on snapshot-created, supersedes to the newer label', async ({
    browser,
  }) => {
    const context = await freshAuthedContext(browser);
    const page = await context.newPage();
    try {
      const julia = await loginAs(page, { username: 'julia' });
      expect(julia.screenName.toLowerCase()).toBe('julia');
      const sessionId = await createSession(page, {
        topic: 'Audience chapter marker surfaces the latest snapshot label',
        privacy: 'public',
      });

      await page.goto(`/a/sessions/${sessionId}`);
      await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

      // Absent before any snapshot — the marker renders nothing until the
      // first `snapshot-created` event lands.
      await expect(page.getByTestId('audience-chapter-marker')).toHaveCount(0);

      await seedSnapshotCreated(page, {
        sessionId,
        sequence: 1_000_600,
        eventId: 'dddddddd-1111-4ddd-8ddd-dddddddd0001',
        snapshotId: 'dddddddd-aaaa-4ddd-8ddd-ddddddddaaaa',
        label: 'Segment 1 close',
        logPosition: 1_000_600,
        actorId: julia.userId,
      });

      const marker = page.getByTestId('audience-chapter-marker');
      await expect(marker).toBeVisible({ timeout: 15_000 });
      await expect(marker).toContainText('Segment 1 close');

      // A newer snapshot supersedes the caption (persistent-until-
      // superseded, Decision §5).
      await seedSnapshotCreated(page, {
        sessionId,
        sequence: 1_000_601,
        eventId: 'dddddddd-1111-4ddd-8ddd-dddddddd0002',
        snapshotId: 'dddddddd-bbbb-4ddd-8ddd-ddddddddbbbb',
        label: 'Commercial',
        logPosition: 1_000_601,
        actorId: julia.userId,
      });

      await expect(marker).toContainText('Commercial', { timeout: 15_000 });
      await expect(marker).not.toContainText('Segment 1 close');
    } finally {
      await context.close();
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
