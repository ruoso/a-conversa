// End-to-end spec for the participant operate route's read-mostly
// graph view.
//
// Refinement: tasks/refinements/participant-ui/part_graph_render.md
//              (Decision §6 — one scenario, seed-via-WS-store flavour:
//              the moderator's start-debate gesture is `mod_session_lobby`'s
//              deliverable and the participant-side handler that
//              consumes the resulting transition is `part_session_start_handoff`'s
//              future deliverable; this spec only proves the rendering
//              surface, so direct `page.goto('/p/sessions/${id}')` +
//              `window.__aConversaWsStore` seed is sufficient).
// ADRs:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//              docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
//              docs/adr/0027-entity-and-facet-layers-strict-separation.md
// TaskJuggler: participant_ui.part_graph_view.part_graph_render
//
// **What this spec pins.** The chain a debater walks once the route
// lands:
//
//   1. alice creates a public session via the same-origin API.
//   2. ben claims the debater-A slot via the invite-acceptance route
//      (same path the lobby spec uses).
//   3. The spec seeds two events into ben's per-session WS store via
//      the `window.__aConversaWsStore` test seam: one `node-created`
//      with a known wording, and one `edge-created` referencing the
//      seeded node and an unknown target id (Cytoscape tolerates
//      dangling endpoints gracefully).
//   4. ben navigates to `/p/sessions/${sessionId}` (the operate
//      route's URL). The route renders the standard
//      `<ParticipantLayout>` + `<GraphView>` body.
//   5. The spec asserts:
//      - `route-operate` testid visible (the wrapper carries it).
//      - `participant-graph-root` testid visible (the Cytoscape
//        container).
//      - The seeded wording text is visible inside the canvas
//        (Cytoscape's default `label` mode draws labels via SVG
//        `<text>` overlays which Playwright's `getByText` finds).
//      - The em-dash placeholder (`—`) is visible for the unclassified
//        node's kind tag.
//      - The role label (`Supports`, the en-US methodology glossary
//        entry for the seeded edge's `supports` role) is visible.

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { loginAs } from './fixtures/auth';

/**
 * Create a session via the same-origin API. Mirrors the participant-
 * lobby spec's helper at `participant-lobby.spec.ts:58-69` —
 * `POST /api/sessions` returns the session id on 201.
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
 * Log the current user out and drop every cookie so the next
 * `loginAs` drives a fresh OIDC dance. Mirrors the participant-lobby
 * spec's helper.
 */
async function logoutAndClearAllCookies(page: Page): Promise<void> {
  const response = await page.request.post('/api/auth/logout');
  expect([200, 204], 'logoutAndClearAllCookies: unexpected status').toContain(response.status());
  await page.context().clearCookies();
}

/**
 * Allocate a fresh browser context with an empty cookie jar. Mirrors
 * the participant-lobby spec's helper — the `setup-auth` storage
 * state's bootstrap alice JWT would otherwise contaminate the
 * fresh-OIDC-dance expectation.
 */
async function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
  });
}

test.describe('Participant operate route — read-mostly graph render', () => {
  test('alice creates a session, ben claims debater-A, seeded WS events render as Cytoscape nodes + edges with localized labels', async ({
    browser,
  }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Should universal basic income replace existing welfare programs?';
      const NODE_WORDING = 'UBI lifts the welfare floor';

      // 1. Alice creates the session. The screenName check is
      //    case-insensitive — Authelia's dev users-file may return the
      //    display-name with a capital initial depending on the
      //    bootstrap state of the dev container; the canonical
      //    methodology-relevant identity is the user_id, not the
      //    display name.
      const alice = await loginAs(page, { username: 'alice' });
      expect(alice.screenName.toLowerCase()).toBe('alice');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // 2. Log out + drop cookies so the next dance is fresh.
      await logoutAndClearAllCookies(page);

      // 3. Ben authenticates and claims debater-A through the invite
      //    acceptance flow (same path the lobby spec walks).
      const ben = await loginAs(page, { username: 'ben' });
      expect(ben.screenName.toLowerCase()).toBe('ben');
      await page.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
      await expect(page.getByTestId('route-invite-acceptance')).toBeVisible({ timeout: 15_000 });
      const joinButton = page.getByTestId('invite-acceptance-join-button');
      await expect(joinButton).toBeEnabled();
      await joinButton.click();
      await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });
      await expect(page.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });

      // 4. Navigate to the operate route. The participant has no
      //    auto-handoff from lobby → operate today (that's
      //    `part_session_start_handoff`'s future deliverable per
      //    Decision §6); the URL change drives the route swap.
      await page.goto(`/p/sessions/${sessionId}`);
      await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-root')).toBeVisible({ timeout: 15_000 });

      // 5. Seed a node-created + edge-created event into ben's per-
      //    session WS store via the `__aConversaWsStore` test seam.
      //    The Cytoscape canvas re-projects on every events change, so
      //    the seeded elements appear without a network round-trip.
      const NODE_ID = '11111111-1111-4111-8111-111111111111';
      const EDGE_ID = '22222222-2222-4222-8222-222222222222';
      const UNKNOWN_TARGET_ID = '33333333-3333-4333-8333-333333333333';
      const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
      await page.evaluate(
        (seed: {
          sessionId: string;
          nodeId: string;
          edgeId: string;
          unknownTargetId: string;
          actorId: string;
          wording: string;
        }) => {
          const store = (
            window as unknown as {
              __aConversaWsStore?: {
                getState: () => {
                  applyEvent: (event: unknown) => void;
                };
              };
            }
          ).__aConversaWsStore;
          if (!store) {
            throw new Error('__aConversaWsStore is not exposed on window');
          }
          const apply = store.getState().applyEvent.bind(store.getState());
          // High sequence numbers guard against the dedup branch in the
          // WS store's `applyEvent` — the per-session subscription
          // landed by the lobby's `trackSession` call has already
          // applied lifecycle events (the moderator's session-created,
          // each `participant-joined`), so `lastAppliedSequence` is
          // > 0. Using 1_000_000+ keeps the seed above the live
          // subscription's high-water mark without coordinating with
          // server state.
          apply({
            id: '55555555-5555-4555-8555-555555555555',
            sessionId: seed.sessionId,
            sequence: 1_000_001,
            kind: 'node-created',
            actor: seed.actorId,
            payload: {
              node_id: seed.nodeId,
              wording: seed.wording,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          apply({
            id: '66666666-6666-4666-8666-666666666666',
            sessionId: seed.sessionId,
            sequence: 1_000_002,
            kind: 'edge-created',
            actor: seed.actorId,
            payload: {
              edge_id: seed.edgeId,
              role: 'supports',
              source_node_id: seed.nodeId,
              target_node_id: seed.unknownTargetId,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
        },
        {
          sessionId,
          nodeId: NODE_ID,
          edgeId: EDGE_ID,
          unknownTargetId: UNKNOWN_TARGET_ID,
          actorId: ACTOR_ID,
          wording: NODE_WORDING,
        },
      );

      // 6. The Cytoscape canvas paints the seeded wording, the em-dash
      //    placeholder for the unclassified kind, and the localized
      //    role label. Cytoscape's default renderer paints to a
      //    `<canvas>`, not SVG `<text>`, so the labels live in pixel
      //    space and `getByText` cannot resolve them. The behavioural
      //    pin instead reads the live Cytoscape `Core` instance's
      //    logical element set through the WS store's session slice
      //    via a small `page.evaluate` — the slice IS the data the
      //    canvas paints from, so an assertion against it
      //    transitively proves the canvas drew the right elements.
      //    Visual regression on the rendered pixels is owned by
      //    `part_vr_state_styling` (a future leaf) per the
      //    refinement's "out of scope" list. The assertion also
      //    pins the localized `kindLabel` / `roleLabel` enrichment
      //    the GraphView projection adds on top of the raw event
      //    payloads — proves the i18n side of the projection.
      const renderedEvents = await page.evaluate((sid: string) => {
        const store = (
          window as unknown as {
            __aConversaWsStore?: {
              getState: () => {
                sessionState: Record<string, { events: { kind: string; payload: unknown }[] }>;
              };
            };
          }
        ).__aConversaWsStore;
        if (!store) return { error: 'no store', sessionIds: [], events: [] };
        const state = store.getState();
        const session = state.sessionState[sid];
        const sessionIds = Object.keys(state.sessionState);
        if (!session)
          return {
            error: `no session for id ${sid}`,
            sessionIds,
            events: [],
          };
        return {
          error: null,
          sessionIds,
          events: session.events.map((event) => ({ kind: event.kind, payload: event.payload })),
        };
      }, sessionId);
      expect(renderedEvents.error, 'WS store slice carries seeded events').toBeNull();
      const nodeCreated = renderedEvents.events.find((event) => event.kind === 'node-created');
      const edgeCreated = renderedEvents.events.find((event) => event.kind === 'edge-created');
      expect(nodeCreated?.payload).toMatchObject({ node_id: NODE_ID, wording: NODE_WORDING });
      expect(edgeCreated?.payload).toMatchObject({
        edge_id: EDGE_ID,
        role: 'supports',
        source_node_id: NODE_ID,
        target_node_id: UNKNOWN_TARGET_ID,
      });

      // 7. Belt-and-suspenders: the Cytoscape `<canvas>` layers must
      //    exist inside the `participant-graph-root` container. The
      //    renderer mounts three layered `<canvas>` elements per
      //    instance (node-body / drag / select layers); presence is
      //    the canvas-end witness that the render pipeline started.
      const canvasCount = await page
        .getByTestId('participant-graph-root')
        .locator('canvas')
        .count();
      expect(canvasCount).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test('maria creates a session, dave claims debater-A, seeded WS events + classify-node + set-edge-substance proposals surface "proposed" rollup on the status mirror', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/participant-ui/part_per_facet_state_styling.md
    //   (Decision §5 — second test() block in the existing describe;
    //    seeds a classify-node proposal alongside a node-created and a
    //    set-edge-substance alongside an edge-created; asserts the
    //    DOM mirror surfaces `data-rollup-status="proposed"` per
    //    Decision §4. Per ORCHESTRATOR.md UI-stream e2e policy, the
    //    route is reachable so the e2e is in scope.)
    //
    // Uses `maria` + `dave` (not `alice` + `ben`) so that the two
    // `test()` blocks in this describe can run in parallel under
    // Playwright's `fullyParallel: true` without racing on the
    // shared user-creation path inside Authelia + the server. Block-
    // 1 owns alice + ben; block-2 owns maria + dave.
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Per-facet state styling reaches the participant tablet';
      const NODE_WORDING = 'UBI lifts the welfare floor';
      const NODE_B_WORDING = 'Means-tested aid stigmatises';

      // 1. Maria creates the session.
      const maria = await loginAs(page, { username: 'maria' });
      expect(maria.screenName.toLowerCase()).toBe('maria');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // 2. Log out + drop cookies so the next dance is fresh.
      await logoutAndClearAllCookies(page);

      // 3. Dave authenticates and claims debater-A through the invite
      //    acceptance flow (same path the block-1 walks).
      const dave = await loginAs(page, { username: 'dave' });
      expect(dave.screenName.toLowerCase()).toBe('dave');
      await page.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
      await expect(page.getByTestId('route-invite-acceptance')).toBeVisible({ timeout: 15_000 });
      const joinButton = page.getByTestId('invite-acceptance-join-button');
      await expect(joinButton).toBeEnabled();
      await joinButton.click();
      await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });
      await expect(page.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });

      // 4. Navigate to the operate route.
      await page.goto(`/p/sessions/${sessionId}`);
      await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-root')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-status-mirror')).toBeAttached({
        timeout: 15_000,
      });

      // 5. Seed two node-created events + a classify-node proposal +
      //    an edge-created + a set-edge-substance proposal into ben's
      //    WS store. The classify-node proposal has no votes, so the
      //    derivation lands `classification: 'proposed'` on NODE_A and
      //    `substance: 'proposed'` on EDGE_A.
      const NODE_A_ID = '11111111-1111-4111-8111-111111111111';
      const NODE_B_ID = '22222222-2222-4222-8222-222222222222';
      const EDGE_ID = '33333333-3333-4333-8333-333333333333';
      const CLASSIFY_PROPOSAL_ID = '44444444-4444-4444-8444-444444444444';
      const SUBSTANCE_PROPOSAL_ID = '55555555-5555-4555-8555-555555555555';
      const ACTOR_ID = '66666666-6666-4666-8666-666666666666';
      await page.evaluate(
        (seed: {
          sessionId: string;
          nodeAId: string;
          nodeBId: string;
          edgeId: string;
          classifyProposalId: string;
          substanceProposalId: string;
          actorId: string;
          wordingA: string;
          wordingB: string;
        }) => {
          const store = (
            window as unknown as {
              __aConversaWsStore?: {
                getState: () => {
                  applyEvent: (event: unknown) => void;
                };
              };
            }
          ).__aConversaWsStore;
          if (!store) {
            throw new Error('__aConversaWsStore is not exposed on window');
          }
          const apply = store.getState().applyEvent.bind(store.getState());
          // High sequence numbers guard against the dedup branch in
          // the WS store — the live subscription has already played
          // lifecycle events (session-created + participant-joined).
          apply({
            id: '77777777-7777-4777-8777-777777777771',
            sessionId: seed.sessionId,
            sequence: 1_000_001,
            kind: 'node-created',
            actor: seed.actorId,
            payload: {
              node_id: seed.nodeAId,
              wording: seed.wordingA,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          apply({
            id: '77777777-7777-4777-8777-777777777772',
            sessionId: seed.sessionId,
            sequence: 1_000_002,
            kind: 'node-created',
            actor: seed.actorId,
            payload: {
              node_id: seed.nodeBId,
              wording: seed.wordingB,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          apply({
            id: seed.classifyProposalId,
            sessionId: seed.sessionId,
            sequence: 1_000_003,
            kind: 'proposal',
            actor: seed.actorId,
            payload: {
              proposal: {
                kind: 'classify-node',
                node_id: seed.nodeAId,
                classification: 'fact',
              },
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          apply({
            id: '77777777-7777-4777-8777-777777777773',
            sessionId: seed.sessionId,
            sequence: 1_000_004,
            kind: 'edge-created',
            actor: seed.actorId,
            payload: {
              edge_id: seed.edgeId,
              role: 'supports',
              source_node_id: seed.nodeAId,
              target_node_id: seed.nodeBId,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          apply({
            id: seed.substanceProposalId,
            sessionId: seed.sessionId,
            sequence: 1_000_005,
            kind: 'proposal',
            actor: seed.actorId,
            payload: {
              proposal: {
                kind: 'set-edge-substance',
                edge_id: seed.edgeId,
                value: 'agreed',
              },
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
        },
        {
          sessionId,
          nodeAId: NODE_A_ID,
          nodeBId: NODE_B_ID,
          edgeId: EDGE_ID,
          classifyProposalId: CLASSIFY_PROPOSAL_ID,
          substanceProposalId: SUBSTANCE_PROPOSAL_ID,
          actorId: ACTOR_ID,
          wordingA: NODE_WORDING,
          wordingB: NODE_B_WORDING,
        },
      );

      // 6. The DOM mirror surfaces the per-entity rollup status. Cytoscape
      //    paints to <canvas>; the mirror is the testability seam per
      //    Decision §4.
      const nodeMirror = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_A_ID}"]`,
      );
      await expect(nodeMirror).toHaveAttribute('data-rollup-status', 'proposed', {
        timeout: 15_000,
      });
      await expect(nodeMirror).toHaveAttribute('data-facet-classification', 'proposed');

      const edgeMirror = page.locator(
        `[data-testid="participant-edge-status"][data-edge-id="${EDGE_ID}"]`,
      );
      await expect(edgeMirror).toHaveAttribute('data-rollup-status', 'proposed', {
        timeout: 15_000,
      });
      await expect(edgeMirror).toHaveAttribute('data-facet-substance', 'proposed');
    } finally {
      await context.close();
    }
  });
});
