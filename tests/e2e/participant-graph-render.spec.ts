// End-to-end spec for the participant operate route's read-mostly
// graph view.
//
// Refinements: tasks/refinements/participant-ui/part_graph_render.md
//              (Decision §6 — one scenario, seed-via-WS-store flavour
//              for the rendering surface),
//              tasks/refinements/participant-ui/part_session_start_handoff.md
//              (Decision §1 — the lobby's auto-navigation `useEffect`
//              consumes a per-session WS event and `replace`-navigates
//              the debater to the operate route),
//              tasks/refinements/participant-ui/part_session_start_handoff_dedicated_event.md
//              (Decision §1 + ADR 0028 — the canonical trigger is now
//              the dedicated `session-mode-changed` event with
//              `new_mode: 'operate'`; the predecessor's
//              `CONTENT_EVENT_KINDS` heuristic stays as a fallback
//              but the spec seeds the dedicated event as the primary
//              path to pin the new contract end-to-end).
// ADRs:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//              docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
//              docs/adr/0027-entity-and-facet-layers-strict-separation.md
// TaskJuggler: participant_ui.part_graph_view.part_graph_render
//              + participant_ui.part_graph_view.part_session_start_handoff
//
// **What this spec pins.** The chain a debater walks once the route
// lands:
//
//   1. alice creates a public session via the same-origin API.
//   2. ben claims the debater-A slot via the invite-acceptance route
//      (same path the lobby spec uses); he lands on the lobby.
//   3. The spec seeds a `session-mode-changed` event with
//      `new_mode: 'operate'` into ben's per-session WS store via the
//      `window.__aConversaWsStore` test seam while he is in the
//      lobby — simulating the moderator clicking "Enter session"
//      which POSTs to `/api/sessions/:id/start` (the server emits the
//      event the participant's lobby observes). The lobby's
//      auto-navigation `useEffect` (per ADR 0028) detects the
//      dedicated mode-changed event as its primary trigger and
//      `replace`-navigates to `/p/sessions/${sessionId}` (the operate
//      route's URL).
//   4. The spec asserts the auto-navigation completed:
//      - URL has flipped to `/p/sessions/${sessionId}`.
//      - `route-operate` testid visible (the wrapper carries it).
//      - `participant-graph-root` testid visible (the Cytoscape
//        container).
//   5. The spec then seeds an `edge-created` event referencing the
//      seeded node and an unknown target id (Cytoscape tolerates
//      dangling endpoints gracefully) so the rendering assertions
//      can pin both kinds.
//   6. The spec asserts the WS store slice carries both seeded events
//      and that the Cytoscape canvas layers are present inside the
//      `participant-graph-root` container (visual regression on
//      rendered pixels is owned by `part_vr_state_styling`).

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from './fixtures/no-scrollbars';

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

// The four `test()` blocks below run in parallel under Playwright's
// default `fullyParallel: true` posture. Each block claims a distinct
// `{ creator, debater }` pair from the 12-user Authelia dev pool
// (`infra/authelia/users.yml`) to avoid the in-file per-session
// `users` upsert race that surfaces when two blocks within the same
// worker claim the same user-id concurrently.
//
// Pair assignment (source: tests/e2e/fixtures/auth.ts DEV_USER_POOL):
//   block 1: alice + ben
//   block 2: maria + dave
//   block 3: frank + erin
//   block 4: grace + henry
//   block 5: ivan + julia    (added by part_diagnostic_highlights)
//   block 6: kate + leo      (added by part_own_vote_indicators)
//   block 7: ben + alice     (added by part_other_vote_indicators; block-1 role-swap)
//   block 8: dave + maria    (added by part_other_vote_indicators_canvas_dots; block-2 role-swap)
//   block 9: erin + frank    (added by part_pan_zoom_tap; block-3 role-swap)
//   block 12: leo + kate     (added by part_render_annotation_endpoint_edges; block-6 role-swap)
//
// History: blocks 1-3 saturated the original 6-user pool; block 4
// (added by `part_annotation_render`) initially reused alice+ben and
// flipped the describe to `.serial` (wall-clock ~33.5s under one
// worker). The pool was expanded to 12 by
// `tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md`,
// freeing block 4 to use a fresh pair and the describe to revert to
// parallel execution (wall-clock recovered to ~14s/block).
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

      // 4. From the lobby, seed the moderator's "Enter session" gesture
      //    (a `session-mode-changed` event with `new_mode: 'operate'`)
      //    into ben's per-session WS store via the
      //    `__aConversaWsStore` test seam. Per ADR 0028 this is the
      //    canonical trigger for the lobby → operate auto-navigation;
      //    the participant lobby's `useEffect` detects the dedicated
      //    event as its primary trigger and `replace`-navigates the
      //    debater to the operate route URL. The predecessor's
      //    `CONTENT_EVENT_KINDS` heuristic is retained as a
      //    defense-in-depth fallback (Decision §7 of
      //    `part_session_start_handoff_dedicated_event.md`) but this
      //    spec pins the primary path.
      const NODE_ID = '11111111-1111-4111-8111-111111111111';
      const EDGE_ID = '22222222-2222-4222-8222-222222222222';
      const UNKNOWN_TARGET_ID = '33333333-3333-4333-8333-333333333333';
      const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
      await page.evaluate(
        (seed: { sessionId: string; actorId: string }) => {
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
          // the WS store's `applyEvent` — the per-session subscription
          // landed by the lobby's `trackSession` call has already
          // applied lifecycle events (the moderator's session-created,
          // each `participant-joined`), so `lastAppliedSequence` is
          // > 0. Using 1_000_000+ keeps the seed above the live
          // subscription's high-water mark without coordinating with
          // server state.
          apply({
            id: '55555555-5555-4555-8555-555555555550',
            sessionId: seed.sessionId,
            sequence: 1_000_000,
            kind: 'session-mode-changed',
            actor: seed.actorId,
            payload: {
              previous_mode: 'lobby',
              new_mode: 'operate',
              changed_by: seed.actorId,
              changed_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
        },
        {
          sessionId,
          actorId: ACTOR_ID,
        },
      );

      // 5. Wait for the auto-navigation handoff to complete. The
      //    `{ replace: true }` posture means the browser URL flips
      //    without a back-stack push.
      await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
        timeout: 15_000,
      });
      await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-root')).toBeVisible({ timeout: 15_000 });

      // 6. Now that the operate route has mounted, seed a `node-created`
      //    + `edge-created` pair so the Cytoscape canvas has elements
      //    to render. Per the refinement (§ "the spec still seeds a
      //    node-created AFTER the navigation has fired") this happens
      //    POST-navigation so the operate route's first paint sees
      //    something to draw.
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

      // 7. The Cytoscape canvas paints the seeded wording, the em-dash
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

      // 8. Belt-and-suspenders: the Cytoscape `<canvas>` layers must
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

  test('frank creates a session, erin claims debater-A, a committed axiom-mark proposal surfaces as data-is-axiom="true" on the marked node and "false" on the unmarked one', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/participant-ui/part_axiom_mark_decoration.md
    //   (Decision §6 — third test() block in the existing describe;
    //    seeds two node-created events plus an axiom-mark proposal
    //    + commit pair on the first node; asserts the DOM mirror
    //    surfaces `data-is-axiom="true"` on NODE_A and
    //    `data-is-axiom="false"` on NODE_B. Per ORCHESTRATOR.md
    //    UI-stream e2e policy, the route is reachable and the
    //    per-node mirror is in place so the e2e is in scope.)
    //
    // Uses `frank` + `erin` (the next pair of pre-existing Authelia
    // dev users beyond `alice`+`ben` / `maria`+`dave`) so the three
    // `test()` blocks in this describe can run in parallel under
    // Playwright's `fullyParallel: true` without racing on the
    // shared user-creation path. Block-1 owns alice+ben; block-2
    // owns maria+dave; block-3 owns frank+erin.
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Axiom-mark decoration reaches the participant tablet';
      const NODE_A_WORDING = 'Liberty is the ultimate value';
      const NODE_B_WORDING = 'Equality matters but is secondary';

      // 1. Frank creates the session.
      const frank = await loginAs(page, { username: 'frank' });
      expect(frank.screenName.toLowerCase()).toBe('frank');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // 2. Log out + drop cookies so the next dance is fresh.
      await logoutAndClearAllCookies(page);

      // 3. Erin authenticates and claims debater-A through the invite
      //    acceptance flow.
      const erin = await loginAs(page, { username: 'erin' });
      expect(erin.screenName.toLowerCase()).toBe('erin');
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

      // 5. Seed the events: two `node-created` events, one
      //    `axiom-mark` proposal targeting NODE_A, and one matching
      //    commit so the axiom-mark actually lands (the rendering
      //    rule per the refinement is "render committed only").
      const NODE_A_ID = '11111111-1111-4111-8111-111111111111';
      const NODE_B_ID = '22222222-2222-4222-8222-222222222222';
      const AXIOM_PROPOSAL_ID = '33333333-3333-4333-8333-333333333333';
      const PARTICIPANT_ID = '44444444-4444-4444-8444-444444444444';
      const ACTOR_ID = '55555555-5555-4555-8555-555555555555';
      await page.evaluate(
        (seed: {
          sessionId: string;
          nodeAId: string;
          nodeBId: string;
          axiomProposalId: string;
          participantId: string;
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
          // High sequence numbers guard against the dedup branch.
          apply({
            id: '66666666-6666-4666-8666-666666666661',
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
            id: '66666666-6666-4666-8666-666666666662',
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
            id: seed.axiomProposalId,
            sessionId: seed.sessionId,
            sequence: 1_000_003,
            kind: 'proposal',
            actor: seed.participantId,
            payload: {
              proposal: {
                kind: 'axiom-mark',
                node_id: seed.nodeAId,
                participant: seed.participantId,
              },
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          apply({
            id: '66666666-6666-4666-8666-666666666664',
            sessionId: seed.sessionId,
            sequence: 1_000_004,
            kind: 'commit',
            actor: seed.actorId,
            payload: {
              // Per ADR 0030 §2 + §9 + `pf_facet_keyed_commit_payload`,
              // the commit payload is now a `target`-discriminated
              // union. Structural sub-kinds (axiom-mark) emit the
              // proposal-keyed arm.
              target: 'proposal',
              proposal_id: seed.axiomProposalId,
              committed_by: seed.actorId,
              committed_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
        },
        {
          sessionId,
          nodeAId: NODE_A_ID,
          nodeBId: NODE_B_ID,
          axiomProposalId: AXIOM_PROPOSAL_ID,
          participantId: PARTICIPANT_ID,
          actorId: ACTOR_ID,
          wordingA: NODE_A_WORDING,
          wordingB: NODE_B_WORDING,
        },
      );

      // 6. The DOM mirror surfaces the boolean axiom signal per node.
      //    Cytoscape paints to <canvas>; the mirror is the
      //    testability seam per Decision §5.
      const markedNodeMirror = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_A_ID}"]`,
      );
      await expect(markedNodeMirror).toHaveAttribute('data-is-axiom', 'true', {
        timeout: 15_000,
      });

      const unmarkedNodeMirror = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_B_ID}"]`,
      );
      await expect(unmarkedNodeMirror).toHaveAttribute('data-is-axiom', 'false', {
        timeout: 15_000,
      });
    } finally {
      await context.close();
    }
  });

  test('grace creates a session, henry claims debater-A, seeded annotation-created events surface data-has-annotation + data-annotation-count on the targeted node and edge', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/participant-ui/part_annotation_render.md
    //   (Decision §6 — fourth test() block in the existing describe;
    //    seeds two node-created events, one edge-created, and three
    //    annotation-created events (two targeting NODE_A so the count
    //    rises to 2; one targeting the EDGE with count 1); asserts the
    //    DOM mirror surfaces `data-has-annotation="true"` +
    //    `data-annotation-count="2"` on NODE_A,
    //    `data-has-annotation="false"` + `data-annotation-count="0"`
    //    on NODE_B, and `data-has-annotation="true"` +
    //    `data-annotation-count="1"` on the EDGE. Per ORCHESTRATOR.md
    //    UI-stream e2e policy, the route is reachable and the
    //    per-target mirror is in place so the e2e is in scope.)
    //
    // Uses `grace` + `henry` — a fresh pair from the 12-user dev pool
    // expansion (`infra/authelia/users.yml`; see
    // `tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md`).
    // Distinct from blocks 1-3 so the four blocks run in parallel under
    // `fullyParallel: true` without racing on the shared user-creation
    // path.
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Annotation rendering reaches the participant tablet';
      const NODE_A_WORDING = 'UBI lifts the welfare floor';
      const NODE_B_WORDING = 'Means-tested aid stigmatises';

      // 1. Grace creates the session.
      const grace = await loginAs(page, { username: 'grace' });
      expect(grace.screenName.toLowerCase()).toBe('grace');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // 2. Log out + drop cookies so the next dance is fresh.
      await logoutAndClearAllCookies(page);

      // 3. Henry authenticates and claims debater-A through the invite
      //    acceptance flow.
      const henry = await loginAs(page, { username: 'henry' });
      expect(henry.screenName.toLowerCase()).toBe('henry');
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

      // 5. Seed the events: two `node-created`, one `edge-created`,
      //    two `annotation-created` targeting NODE_A (kinds `note`
      //    + `reframe` to exercise the kind multiplicity), and one
      //    `annotation-created` targeting the EDGE (kind `stance`).
      //    The wire schema's XOR (target_node_id / target_edge_id,
      //    exactly one non-null) is the projector's routing key.
      const NODE_A_ID = '11111111-1111-4111-8111-111111111111';
      const NODE_B_ID = '22222222-2222-4222-8222-222222222222';
      const EDGE_ID = '33333333-3333-4333-8333-333333333333';
      const ANNO_NODE_1_ID = '44444444-4444-4444-8444-444444444441';
      const ANNO_NODE_2_ID = '44444444-4444-4444-8444-444444444442';
      const ANNO_EDGE_1_ID = '44444444-4444-4444-8444-444444444443';
      const ACTOR_ID = '55555555-5555-4555-8555-555555555555';
      await page.evaluate(
        (seed: {
          sessionId: string;
          nodeAId: string;
          nodeBId: string;
          edgeId: string;
          annoNode1Id: string;
          annoNode2Id: string;
          annoEdge1Id: string;
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
          // High sequence numbers guard against the dedup branch.
          apply({
            id: '66666666-6666-4666-8666-666666666661',
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
            id: '66666666-6666-4666-8666-666666666662',
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
            id: '66666666-6666-4666-8666-666666666663',
            sessionId: seed.sessionId,
            sequence: 1_000_003,
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
            id: '66666666-6666-4666-8666-666666666664',
            sessionId: seed.sessionId,
            sequence: 1_000_004,
            kind: 'annotation-created',
            actor: seed.actorId,
            payload: {
              annotation_id: seed.annoNode1Id,
              kind: 'note',
              content: 'see also F-003',
              target_node_id: seed.nodeAId,
              target_edge_id: null,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          apply({
            id: '66666666-6666-4666-8666-666666666665',
            sessionId: seed.sessionId,
            sequence: 1_000_005,
            kind: 'annotation-created',
            actor: seed.actorId,
            payload: {
              annotation_id: seed.annoNode2Id,
              kind: 'reframe',
              content: 'reframe the welfare framing',
              target_node_id: seed.nodeAId,
              target_edge_id: null,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          apply({
            id: '66666666-6666-4666-8666-666666666666',
            sessionId: seed.sessionId,
            sequence: 1_000_006,
            kind: 'annotation-created',
            actor: seed.actorId,
            payload: {
              annotation_id: seed.annoEdge1Id,
              kind: 'stance',
              content: 'edge stance noted',
              target_node_id: null,
              target_edge_id: seed.edgeId,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
        },
        {
          sessionId,
          nodeAId: NODE_A_ID,
          nodeBId: NODE_B_ID,
          edgeId: EDGE_ID,
          annoNode1Id: ANNO_NODE_1_ID,
          annoNode2Id: ANNO_NODE_2_ID,
          annoEdge1Id: ANNO_EDGE_1_ID,
          actorId: ACTOR_ID,
          wordingA: NODE_A_WORDING,
          wordingB: NODE_B_WORDING,
        },
      );

      // 6. The DOM mirror surfaces the per-target annotation signal.
      //    Cytoscape paints to <canvas>; the mirror is the testability
      //    seam per Decision §5. The doubly-annotated NODE_A reports
      //    count 2; the unannotated NODE_B reports the explicit
      //    "false" / "0" baseline; the singly-annotated EDGE reports
      //    count 1.
      const annotatedNodeMirror = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_A_ID}"]`,
      );
      await expect(annotatedNodeMirror).toHaveAttribute('data-has-annotation', 'true', {
        timeout: 15_000,
      });
      await expect(annotatedNodeMirror).toHaveAttribute('data-annotation-count', '2');

      const unannotatedNodeMirror = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_B_ID}"]`,
      );
      await expect(unannotatedNodeMirror).toHaveAttribute('data-has-annotation', 'false');
      await expect(unannotatedNodeMirror).toHaveAttribute('data-annotation-count', '0');

      const annotatedEdgeMirror = page.locator(
        `[data-testid="participant-edge-status"][data-edge-id="${EDGE_ID}"]`,
      );
      await expect(annotatedEdgeMirror).toHaveAttribute('data-has-annotation', 'true', {
        timeout: 15_000,
      });
      await expect(annotatedEdgeMirror).toHaveAttribute('data-annotation-count', '1');
    } finally {
      await context.close();
    }
  });

  test('ivan creates a session, julia claims debater-A, fired + cleared diagnostic envelopes surface data-diagnostic-severity + data-diagnostic-kinds on the affected entities', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/participant-ui/part_diagnostic_highlights.md
    //   (Decision §6 — fifth test() block in the existing describe;
    //    seeds three node-created events, one edge-created, a fired
    //    cycle (blocking), a fired contradiction (blocking), a fired
    //    multi-warrant (advisory), then a cleared multi-warrant to pin
    //    both the fired AND cleared paths inside one block; asserts the
    //    DOM mirror surfaces `data-diagnostic-severity="blocking"` +
    //    `data-diagnostic-kinds` containing the right kinds on flagged
    //    entities and the explicit `"none"` / `""` baseline on the
    //    unflagged NODE_D. Per ORCHESTRATOR.md UI-stream e2e policy:
    //    the route is reachable, the per-target mirror is in place
    //    (settled by the predecessor leaves), AND the wire envelope
    //    reaches the participant (the server fans diagnostic envelopes
    //    out to every subscribed WS connection per session); the e2e
    //    is in scope.)
    //
    // Uses `ivan` + `julia` — the explicit earmark from
    // `tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md`
    // line 42. Distinct from blocks 1-4 so the five blocks run in
    // parallel under `fullyParallel: true` without racing on the shared
    // user-creation path.
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Diagnostic highlights reach the participant tablet';
      const NODE_A_WORDING = 'UBI lifts the welfare floor';
      const NODE_B_WORDING = 'Means-tested aid stigmatises';
      const NODE_C_WORDING = 'Behavioural-economics nudges suffice';
      const NODE_D_WORDING = 'An unflagged baseline node';

      // 1. Ivan creates the session.
      const ivan = await loginAs(page, { username: 'ivan' });
      expect(ivan.screenName.toLowerCase()).toBe('ivan');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // 2. Log out + drop cookies so the next dance is fresh.
      await logoutAndClearAllCookies(page);

      // 3. Julia authenticates and claims debater-A through the invite
      //    acceptance flow.
      const julia = await loginAs(page, { username: 'julia' });
      expect(julia.screenName.toLowerCase()).toBe('julia');
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

      // 5. Seed the events + diagnostic envelopes via the exposed WS
      //    store handle. The same `applyEvent` path the prior blocks
      //    use; `applyDiagnostic` is the widened reducer landed by
      //    `part_diagnostic_highlights` Decision §2.
      const NODE_A_ID = '11111111-1111-4111-8111-111111111111';
      const NODE_B_ID = '22222222-2222-4222-8222-222222222222';
      const NODE_C_ID = '33333333-3333-4333-8333-333333333333';
      const NODE_D_ID = '44444444-4444-4444-8444-444444444444';
      const EDGE_AB_ID = '55555555-5555-4555-8555-555555555555';
      const ACTOR_ID = '66666666-6666-4666-8666-666666666666';
      await page.evaluate(
        (seed: {
          sessionId: string;
          nodeAId: string;
          nodeBId: string;
          nodeCId: string;
          nodeDId: string;
          edgeAbId: string;
          actorId: string;
          wordingA: string;
          wordingB: string;
          wordingC: string;
          wordingD: string;
        }) => {
          const store = (
            window as unknown as {
              __aConversaWsStore?: {
                getState: () => {
                  applyEvent: (event: unknown) => void;
                  applyDiagnostic: (payload: unknown) => void;
                };
              };
            }
          ).__aConversaWsStore;
          if (!store) {
            throw new Error('__aConversaWsStore is not exposed on window');
          }
          const state = store.getState();
          const applyEvent = state.applyEvent.bind(state);
          const applyDiagnostic = state.applyDiagnostic.bind(state);

          // Four node-created events (NODE_D is unflagged baseline).
          applyEvent({
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
          applyEvent({
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
          applyEvent({
            id: '77777777-7777-4777-8777-777777777773',
            sessionId: seed.sessionId,
            sequence: 1_000_003,
            kind: 'node-created',
            actor: seed.actorId,
            payload: {
              node_id: seed.nodeCId,
              wording: seed.wordingC,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          applyEvent({
            id: '77777777-7777-4777-8777-777777777774',
            sessionId: seed.sessionId,
            sequence: 1_000_004,
            kind: 'node-created',
            actor: seed.actorId,
            payload: {
              node_id: seed.nodeDId,
              wording: seed.wordingD,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // One edge-created (NODE_A → NODE_B, contradicts role).
          applyEvent({
            id: '77777777-7777-4777-8777-777777777775',
            sessionId: seed.sessionId,
            sequence: 1_000_005,
            kind: 'edge-created',
            actor: seed.actorId,
            payload: {
              edge_id: seed.edgeAbId,
              role: 'contradicts',
              source_node_id: seed.nodeAId,
              target_node_id: seed.nodeBId,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });

          // Fired cycle (blocking) on [A, B, C].
          applyDiagnostic({
            sessionId: seed.sessionId,
            kind: 'cycle',
            severity: 'blocking',
            status: 'fired',
            sequence: 2_000_001,
            diagnostic: {
              kind: 'cycle',
              nodes: [seed.nodeAId, seed.nodeBId, seed.nodeCId],
            },
          });
          // Fired contradiction (blocking) on (A, B) over EDGE_AB.
          applyDiagnostic({
            sessionId: seed.sessionId,
            kind: 'contradiction',
            severity: 'blocking',
            status: 'fired',
            sequence: 2_000_002,
            diagnostic: {
              kind: 'contradiction',
              nodeA: seed.nodeAId,
              nodeB: seed.nodeBId,
              edges: [seed.edgeAbId],
            },
          });
          // Fired multi-warrant (advisory) on C-data, A-claim,
          // [B]-warrants.
          applyDiagnostic({
            sessionId: seed.sessionId,
            kind: 'multi-warrant',
            severity: 'advisory',
            status: 'fired',
            sequence: 2_000_003,
            diagnostic: {
              kind: 'multi-warrant',
              dataNodeId: seed.nodeCId,
              claimNodeId: seed.nodeAId,
              warrantNodeIds: [seed.nodeBId],
            },
          });
          // Cleared the multi-warrant identity (so we pin both fired
          // AND cleared paths inside this block).
          applyDiagnostic({
            sessionId: seed.sessionId,
            kind: 'multi-warrant',
            severity: 'advisory',
            status: 'cleared',
            sequence: 2_000_004,
            diagnostic: {
              kind: 'multi-warrant',
              dataNodeId: seed.nodeCId,
              claimNodeId: seed.nodeAId,
              warrantNodeIds: [seed.nodeBId],
            },
          });
        },
        {
          sessionId,
          nodeAId: NODE_A_ID,
          nodeBId: NODE_B_ID,
          nodeCId: NODE_C_ID,
          nodeDId: NODE_D_ID,
          edgeAbId: EDGE_AB_ID,
          actorId: ACTOR_ID,
          wordingA: NODE_A_WORDING,
          wordingB: NODE_B_WORDING,
          wordingC: NODE_C_WORDING,
          wordingD: NODE_D_WORDING,
        },
      );

      // 6. The DOM mirror surfaces the per-target diagnostic signal.
      //    Cytoscape paints to <canvas>; the mirror is the testability
      //    seam per Decision §5. After the seeds:
      //      NODE_A: cycle (blocking) + contradiction (blocking) →
      //              severity="blocking", kinds contains both.
      //      NODE_B: cycle + contradiction → same severity + kinds
      //              as NODE_A.
      //      NODE_C: cycle only (multi-warrant was cleared) →
      //              severity="blocking", kinds="cycle".
      //      NODE_D: untouched → severity="none", kinds="".
      //      EDGE_AB: contradiction → severity="blocking",
      //              kinds="contradiction".
      const nodeAMirror = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_A_ID}"]`,
      );
      await expect(nodeAMirror).toHaveAttribute('data-diagnostic-severity', 'blocking', {
        timeout: 15_000,
      });
      const nodeAKinds = await nodeAMirror.getAttribute('data-diagnostic-kinds');
      expect(nodeAKinds).toContain('cycle');
      expect(nodeAKinds).toContain('contradiction');

      const nodeBMirror = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_B_ID}"]`,
      );
      await expect(nodeBMirror).toHaveAttribute('data-diagnostic-severity', 'blocking');
      const nodeBKinds = await nodeBMirror.getAttribute('data-diagnostic-kinds');
      expect(nodeBKinds).toContain('cycle');
      expect(nodeBKinds).toContain('contradiction');

      const nodeCMirror = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_C_ID}"]`,
      );
      await expect(nodeCMirror).toHaveAttribute('data-diagnostic-severity', 'blocking');
      await expect(nodeCMirror).toHaveAttribute('data-diagnostic-kinds', 'cycle');

      const nodeDMirror = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_D_ID}"]`,
      );
      await expect(nodeDMirror).toHaveAttribute('data-diagnostic-severity', 'none');
      await expect(nodeDMirror).toHaveAttribute('data-diagnostic-kinds', '');

      const edgeAbMirror = page.locator(
        `[data-testid="participant-edge-status"][data-edge-id="${EDGE_AB_ID}"]`,
      );
      await expect(edgeAbMirror).toHaveAttribute('data-diagnostic-severity', 'blocking');
      await expect(edgeAbMirror).toHaveAttribute('data-diagnostic-kinds', 'contradiction');
    } finally {
      await context.close();
    }
  });

  test('kate creates a session, leo claims debater-A, seeded vote events by leo on facet-targeting proposals surface data-own-vote and a kate-only vote stays "none" for leo', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/participant-ui/part_own_vote_indicators.md
    //   (Decision §6 — sixth test() block in the existing describe;
    //    seeds two node-created events, one edge-created, three
    //    proposals (classify-node on NODE_A, set-edge-substance on
    //    EDGE_AB, classify-node on NODE_B), and three votes — leo's
    //    agree on P1 (NODE_A), leo's dispute on P2 (EDGE_AB), and
    //    kate's agree on P3 (NODE_B). Asserts the DOM mirror
    //    surfaces `data-own-vote="agree"` on NODE_A (leo's vote),
    //    `data-own-vote="dispute"` on EDGE_AB (leo's vote), and
    //    `data-own-vote="none"` on NODE_B (only kate voted; the
    //    per-participant filter excludes others). Per ORCHESTRATOR.md
    //    UI-stream e2e policy: the route is reachable, the per-target
    //    mirror is in place, the `vote` envelope reaches the
    //    participant's WS connection (already pinned by
    //    `ws-vote.feature` + `ws-proposal-status.feature`); the e2e
    //    is in scope. The spec asserts via the DOM mirror, not canvas
    //    pixels.)
    //
    // Uses `kate` + `leo` — the explicit earmark from
    // `tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md`
    // and the predecessor `part_diagnostic_highlights` refinement.
    // Distinct from blocks 1-5 so the six blocks run in parallel
    // under `fullyParallel: true` without racing on the shared user-
    // creation path. This exhausts the 12-user pool: alice+ben,
    // maria+dave, frank+erin, grace+henry, ivan+julia, kate+leo.
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Own-vote indicators reach the participant tablet';
      const NODE_A_WORDING = 'UBI lifts the welfare floor';
      const NODE_B_WORDING = 'Means-tested aid stigmatises';

      // 1. Kate creates the session.
      const kate = await loginAs(page, { username: 'kate' });
      expect(kate.screenName.toLowerCase()).toBe('kate');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // 2. Log out + drop cookies so the next dance is fresh.
      await logoutAndClearAllCookies(page);

      // 3. Leo authenticates and claims debater-A through the invite
      //    acceptance flow.
      const leo = await loginAs(page, { username: 'leo' });
      expect(leo.screenName.toLowerCase()).toBe('leo');
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

      // 5. Seed the events: two `node-created`, one `edge-created`,
      //    three proposals (classify-node on NODE_A, set-edge-substance
      //    on EDGE_AB, classify-node on NODE_B), and three votes —
      //    leo's agree on P1, leo's dispute on P2, kate's agree on P3
      //    (the per-participant filter contract: kate's vote MUST
      //    NOT surface in leo's own-vote indicator).
      const NODE_A_ID = '11111111-1111-4111-8111-111111111111';
      const NODE_B_ID = '22222222-2222-4222-8222-222222222222';
      const EDGE_AB_ID = '33333333-3333-4333-8333-333333333333';
      const P1_ID = '44444444-4444-4444-8444-444444444441';
      const P2_ID = '44444444-4444-4444-8444-444444444442';
      const P3_ID = '44444444-4444-4444-8444-444444444443';
      const ACTOR_ID = '55555555-5555-4555-8555-555555555555';
      // The current participant's UUID is `leo.userId` (the
      // server-stamped vote.payload.participant on leo's votes). The
      // OTHER participant's id is `kate.userId`. Both reach the
      // participant-side projection via the events log; the
      // projection's filter narrows to `voter.id === leo.userId`.
      await page.evaluate(
        (seed: {
          sessionId: string;
          nodeAId: string;
          nodeBId: string;
          edgeAbId: string;
          p1Id: string;
          p2Id: string;
          p3Id: string;
          actorId: string;
          leoId: string;
          kateId: string;
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

          // Two node-created events.
          apply({
            id: '66666666-6666-4666-8666-666666666661',
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
            id: '66666666-6666-4666-8666-666666666662',
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
          // One edge-created (NODE_A → NODE_B).
          apply({
            id: '66666666-6666-4666-8666-666666666663',
            sessionId: seed.sessionId,
            sequence: 1_000_003,
            kind: 'edge-created',
            actor: seed.actorId,
            payload: {
              edge_id: seed.edgeAbId,
              role: 'supports',
              source_node_id: seed.nodeAId,
              target_node_id: seed.nodeBId,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // P1: classify-node on NODE_A.
          apply({
            id: seed.p1Id,
            sessionId: seed.sessionId,
            sequence: 1_000_004,
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
          // P2: set-edge-substance on EDGE_AB.
          apply({
            id: seed.p2Id,
            sessionId: seed.sessionId,
            sequence: 1_000_005,
            kind: 'proposal',
            actor: seed.actorId,
            payload: {
              proposal: {
                kind: 'set-edge-substance',
                edge_id: seed.edgeAbId,
                value: 'agreed',
              },
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // P3: classify-node on NODE_B.
          apply({
            id: seed.p3Id,
            sessionId: seed.sessionId,
            sequence: 1_000_006,
            kind: 'proposal',
            actor: seed.actorId,
            payload: {
              proposal: {
                kind: 'classify-node',
                node_id: seed.nodeBId,
                classification: 'fact',
              },
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // Leo's agree on P1 (NODE_A's classify-node proposal).
          apply({
            id: '66666666-6666-4666-8666-666666666667',
            sessionId: seed.sessionId,
            sequence: 1_000_007,
            kind: 'vote',
            actor: seed.leoId,
            payload: {
              target: 'proposal',
              proposal_id: seed.p1Id,
              participant: seed.leoId,
              choice: 'agree',
              voted_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // Leo's dispute on P2 (EDGE_AB's set-edge-substance proposal).
          apply({
            id: '66666666-6666-4666-8666-666666666668',
            sessionId: seed.sessionId,
            sequence: 1_000_008,
            kind: 'vote',
            actor: seed.leoId,
            payload: {
              target: 'proposal',
              proposal_id: seed.p2Id,
              participant: seed.leoId,
              choice: 'dispute',
              voted_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // Kate's agree on P3 (NODE_B's classify-node proposal) —
          // the per-participant filter contract: this MUST NOT
          // surface on leo's own-vote indicator.
          apply({
            id: '66666666-6666-4666-8666-666666666669',
            sessionId: seed.sessionId,
            sequence: 1_000_009,
            kind: 'vote',
            actor: seed.kateId,
            payload: {
              target: 'proposal',
              proposal_id: seed.p3Id,
              participant: seed.kateId,
              choice: 'agree',
              voted_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
        },
        {
          sessionId,
          nodeAId: NODE_A_ID,
          nodeBId: NODE_B_ID,
          edgeAbId: EDGE_AB_ID,
          p1Id: P1_ID,
          p2Id: P2_ID,
          p3Id: P3_ID,
          actorId: ACTOR_ID,
          leoId: leo.userId,
          kateId: kate.userId,
          wordingA: NODE_A_WORDING,
          wordingB: NODE_B_WORDING,
        },
      );

      // 6. The DOM mirror surfaces the per-target own-vote signal.
      //    Cytoscape paints to <canvas>; the mirror is the testability
      //    seam per Decision §5. The three-entity assertion table:
      //      NODE_A: leo voted agree on P1 → data-own-vote="agree".
      //      EDGE_AB: leo voted dispute on P2 → data-own-vote="dispute".
      //      NODE_B: only kate voted (on P3); leo did NOT → the
      //              per-participant filter contract surfaces
      //              data-own-vote="none" on NODE_B for leo's mirror.
      const nodeAMirror = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_A_ID}"]`,
      );
      await expect(nodeAMirror).toHaveAttribute('data-own-vote', 'agree', {
        timeout: 15_000,
      });

      const edgeAbMirror = page.locator(
        `[data-testid="participant-edge-status"][data-edge-id="${EDGE_AB_ID}"]`,
      );
      await expect(edgeAbMirror).toHaveAttribute('data-own-vote', 'dispute', {
        timeout: 15_000,
      });

      const nodeBMirror = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_B_ID}"]`,
      );
      await expect(nodeBMirror).toHaveAttribute('data-own-vote', 'none');
    } finally {
      await context.close();
    }
  });

  test("alice (block-7) navigates to operate, seeded vote events by synthetic-UUID OTHER voters surface per-voter <li data-other-vote …> entries; alice's own vote stays out of the other-votes list", async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/participant-ui/part_other_vote_indicators.md
    //   (Decision §7 — SEVENTH test() block. The 12-user Authelia dev
    //    pool was exhausted by block 6 (kate+leo); block 7 REUSES the
    //    alice+ben pair (same pair as block 1) AND synthesizes
    //    additional OTHER-voter UUIDs at the event-seed layer. The
    //    projection compares `voter.id !== currentParticipantId` as a
    //    string-equality check; the per-`vote` `participantId` is a
    //    UUID string and the projection does NOT validate against the
    //    `participant-joined` event log. Synthetic UUIDs at the seed
    //    layer behave indistinguishably from real per-user UUIDs at
    //    the projection layer. Per-block-isolated `freshContext` +
    //    `createSession` ensures different sessions per block — no
    //    race on session state even though both blocks 1 and 7 use
    //    alice + ben. Decision §3 — DOM-mirror-only assertions; no
    //    canvas pixels.
    //
    //    Per ORCHESTRATOR.md UI-stream e2e policy: the route is
    //    reachable, the per-target nested `<ul data-other-votes>`
    //    mirror is in place, the `vote` envelope reaches the
    //    participant's WS connection (already pinned by
    //    `ws-vote.feature` + `ws-proposal-status.feature`); the e2e
    //    is in scope.)
    //
    // Pair reuse note: alice + ben are also used by block 1. Block 1
    // has alice as creator + ben as debater-A (ben is the navigating
    // current participant); block 7 inverts to ben as creator + alice
    // as debater-A (alice is the navigating current participant). The
    // shared user-creation path in Authelia / the server runs once
    // per OIDC dance; both blocks may race on concurrent logins for
    // the same user under `fullyParallel: true`. If observed flaky,
    // the fallback is to expand the user pool (a future leaf
    // `part_e2e_user_pool_expansion_v2`) OR to mark only block-7's
    // inner describe `.serial`. This block ships under the
    // `fullyParallel` posture first per Decision §7 (a).
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Other-vote indicators reach the participant tablet';
      const NODE_A_WORDING = 'UBI lifts the welfare floor';
      const NODE_B_WORDING = 'Means-tested aid stigmatises';

      // 1. Ben creates the session (the creator role; not the
      //    navigating participant per Decision §7's inverse-of-block-1
      //    posture).
      const ben = await loginAs(page, { username: 'ben' });
      expect(ben.screenName.toLowerCase()).toBe('ben');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // 2. Log out + drop cookies so the next dance is fresh.
      await logoutAndClearAllCookies(page);

      // 3. Alice authenticates and claims debater-A through the
      //    invite acceptance flow. Alice becomes the navigating
      //    current participant whose tablet the spec asserts against.
      const alice = await loginAs(page, { username: 'alice' });
      expect(alice.screenName.toLowerCase()).toBe('alice');
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

      // 5. Seed the events per Decision §7:
      //
      //      - Two node-created (NODE_A, NODE_B).
      //      - One edge-created (EDGE_AB, NODE_A → NODE_B).
      //      - Three proposals:
      //          P1: classify-node on NODE_A.
      //          P2: set-edge-substance on EDGE_AB.
      //          P3: classify-node on NODE_B.
      //      - Four votes:
      //          SYNTHETIC_VOTER_X agree on P1 (NODE_A's first other vote).
      //          SYNTHETIC_VOTER_Y dispute on P1 (NODE_A's second other vote).
      //          SYNTHETIC_VOTER_X dispute on P2 (EDGE_AB's only other vote).
      //          alice.userId agree on P3 (NODE_B's only vote, by the
      //                                   CURRENT participant — MUST be
      //                                   filtered out of the other-
      //                                   votes list).
      const NODE_A_ID = '11111111-1111-4111-8111-111111111111';
      const NODE_B_ID = '22222222-2222-4222-8222-222222222222';
      const EDGE_AB_ID = '33333333-3333-4333-8333-333333333333';
      const P1_ID = '44444444-4444-4444-8444-444444444441';
      const P2_ID = '44444444-4444-4444-8444-444444444442';
      const P3_ID = '44444444-4444-4444-8444-444444444443';
      const ACTOR_ID = '55555555-5555-4555-8555-555555555555';
      // Synthetic OTHER-voter UUIDs. Distinct from alice.userId AND
      // ben.userId. The projection compares UUID strings only — it
      // does not validate the voter UUID against the per-session
      // participant-joined log, so synthetic UUIDs flow through the
      // projection as ordinary other-voter entries.
      const SYNTHETIC_VOTER_X = '77777777-7777-4777-8777-777777777771';
      const SYNTHETIC_VOTER_Y = '77777777-7777-4777-8777-777777777772';
      await page.evaluate(
        (seed: {
          sessionId: string;
          nodeAId: string;
          nodeBId: string;
          edgeAbId: string;
          p1Id: string;
          p2Id: string;
          p3Id: string;
          actorId: string;
          aliceId: string;
          voterXId: string;
          voterYId: string;
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

          // Two node-created events.
          apply({
            id: '88888888-8888-4888-8888-888888888881',
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
            id: '88888888-8888-4888-8888-888888888882',
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
          // One edge-created (NODE_A → NODE_B).
          apply({
            id: '88888888-8888-4888-8888-888888888883',
            sessionId: seed.sessionId,
            sequence: 1_000_003,
            kind: 'edge-created',
            actor: seed.actorId,
            payload: {
              edge_id: seed.edgeAbId,
              role: 'supports',
              source_node_id: seed.nodeAId,
              target_node_id: seed.nodeBId,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // P1: classify-node on NODE_A.
          apply({
            id: seed.p1Id,
            sessionId: seed.sessionId,
            sequence: 1_000_004,
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
          // P2: set-edge-substance on EDGE_AB.
          apply({
            id: seed.p2Id,
            sessionId: seed.sessionId,
            sequence: 1_000_005,
            kind: 'proposal',
            actor: seed.actorId,
            payload: {
              proposal: {
                kind: 'set-edge-substance',
                edge_id: seed.edgeAbId,
                value: 'agreed',
              },
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // P3: classify-node on NODE_B.
          apply({
            id: seed.p3Id,
            sessionId: seed.sessionId,
            sequence: 1_000_006,
            kind: 'proposal',
            actor: seed.actorId,
            payload: {
              proposal: {
                kind: 'classify-node',
                node_id: seed.nodeBId,
                classification: 'fact',
              },
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // SYNTHETIC_VOTER_X agree on P1 (NODE_A's first other vote).
          apply({
            id: '88888888-8888-4888-8888-888888888887',
            sessionId: seed.sessionId,
            sequence: 1_000_007,
            kind: 'vote',
            actor: seed.voterXId,
            payload: {
              target: 'proposal',
              proposal_id: seed.p1Id,
              participant: seed.voterXId,
              choice: 'agree',
              voted_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // SYNTHETIC_VOTER_Y dispute on P1 (NODE_A's second other vote;
          // distinct voter, first-vote-arrival places them at index 1).
          apply({
            id: '88888888-8888-4888-8888-888888888888',
            sessionId: seed.sessionId,
            sequence: 1_000_008,
            kind: 'vote',
            actor: seed.voterYId,
            payload: {
              target: 'proposal',
              proposal_id: seed.p1Id,
              participant: seed.voterYId,
              choice: 'dispute',
              voted_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // SYNTHETIC_VOTER_X dispute on P2 (EDGE_AB's only other vote).
          apply({
            id: '88888888-8888-4888-8888-888888888889',
            sessionId: seed.sessionId,
            sequence: 1_000_009,
            kind: 'vote',
            actor: seed.voterXId,
            payload: {
              target: 'proposal',
              proposal_id: seed.p2Id,
              participant: seed.voterXId,
              choice: 'dispute',
              voted_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // alice.userId agree on P3 (NODE_B's only vote, by the
          // CURRENT participant — the per-participant filter MUST
          // exclude this from the other-votes list).
          apply({
            id: '88888888-8888-4888-8888-88888888888a',
            sessionId: seed.sessionId,
            sequence: 1_000_010,
            kind: 'vote',
            actor: seed.aliceId,
            payload: {
              target: 'proposal',
              proposal_id: seed.p3Id,
              participant: seed.aliceId,
              choice: 'agree',
              voted_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
        },
        {
          sessionId,
          nodeAId: NODE_A_ID,
          nodeBId: NODE_B_ID,
          edgeAbId: EDGE_AB_ID,
          p1Id: P1_ID,
          p2Id: P2_ID,
          p3Id: P3_ID,
          actorId: ACTOR_ID,
          aliceId: alice.userId,
          voterXId: SYNTHETIC_VOTER_X,
          voterYId: SYNTHETIC_VOTER_Y,
          wordingA: NODE_A_WORDING,
          wordingB: NODE_B_WORDING,
        },
      );

      // 6. Assert the DOM mirror surfaces the per-other-voter rows
      //    per Decision §6:
      //      NODE_A: TWO <li data-other-vote> entries (X agree at
      //              index 0, Y dispute at index 1 — first-vote-
      //              arrival per Decision §5).
      //      EDGE_AB: ONE <li data-other-vote data-vote="dispute"> entry
      //               (X's edge vote).
      //      NODE_B: ZERO <li data-other-vote> entries (the only vote
      //              was alice's, the current participant — confirms
      //              the per-participant filter excludes self).
      const nodeAOtherVotes = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_A_ID}"] ul[data-other-votes] li[data-other-vote]`,
      );
      // Wait for the first entry to land before reading the count to
      // avoid a race between the seed evaluate() returning and React's
      // re-render.
      await expect(nodeAOtherVotes.first()).toBeAttached({ timeout: 15_000 });
      await expect(nodeAOtherVotes).toHaveCount(2);
      await expect(nodeAOtherVotes.nth(0)).toHaveAttribute('data-voter-id', SYNTHETIC_VOTER_X);
      await expect(nodeAOtherVotes.nth(0)).toHaveAttribute('data-vote', 'agree');
      await expect(nodeAOtherVotes.nth(1)).toHaveAttribute('data-voter-id', SYNTHETIC_VOTER_Y);
      await expect(nodeAOtherVotes.nth(1)).toHaveAttribute('data-vote', 'dispute');

      const edgeAbOtherVotes = page.locator(
        `[data-testid="participant-edge-status"][data-edge-id="${EDGE_AB_ID}"] ul[data-other-votes] li[data-other-vote]`,
      );
      await expect(edgeAbOtherVotes).toHaveCount(1);
      await expect(edgeAbOtherVotes.nth(0)).toHaveAttribute('data-voter-id', SYNTHETIC_VOTER_X);
      await expect(edgeAbOtherVotes.nth(0)).toHaveAttribute('data-vote', 'dispute');

      const nodeBOtherVotes = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_B_ID}"] ul[data-other-votes] li[data-other-vote]`,
      );
      // The empty-list contract — the <ul> still renders with zero
      // children. The probe matches the absent-children branch
      // distinct from "the <ul> is missing entirely" (which would be
      // a projector bug per Decision §6).
      await expect(nodeBOtherVotes).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('dave (block-8, block-2 role-swap) navigates to operate, seeded vote events by synthetic-UUID OTHER voters surface per-element <div data-canvas-vote-dots> entries with per-voter dots on the Cytoscape overlay', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/participant-ui/part_other_vote_indicators_canvas_dots.md
    //   (Decision §7 — EIGHTH test() block. The 12-user Authelia dev
    //    pool was exhausted by block 6 (kate+leo); block 7 pioneered
    //    the role-swap pattern with alice+ben (the inverse of block 1)
    //    plus synthetic-UUID voter seeding. This block adopts the same
    //    pattern with `dave + maria` — the inverse of block 2's
    //    `maria + dave` orientation. Per-block-isolated `freshContext` +
    //    `createSession` ensures different sessions per block — no
    //    race on session state even though the username pair re-appears.
    //
    //    Decision §6 — DOM-attribute assertions on
    //    `<div data-canvas-vote-dots data-element-id="...">` +
    //    `<span data-canvas-vote-dot data-voter-id="..." data-vote="...">`;
    //    no position arithmetic in the assertion (the coordinate values
    //    are sensitive to happy-dom-vs-real-browser layout drift;
    //    per-voter attribute presence + ordering carries the load-
    //    bearing signal).
    //
    //    Per ORCHESTRATOR.md UI-stream e2e policy: the route is
    //    reachable, the per-target nested `<ul data-other-votes>`
    //    mirror is in place from the predecessor, the canvas overlay
    //    component is in scope — the e2e is in scope, not deferred.
    //    The block also cross-checks the dot order matches the DOM
    //    mirror's `<li data-other-vote>` order (per Decision §8 —
    //    the two surfaces are independent renderings of the same per-
    //    voter data; the sort-order pin would catch any future
    //    desynchronisation).)
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Other-vote canvas dots reach the participant tablet';
      const NODE_A_WORDING = 'UBI lifts the welfare floor';
      const NODE_B_WORDING = 'Means-tested aid stigmatises';

      // 1. Dave creates the session (the creator role; block-2 inverse —
      //    block 2 had maria as creator + dave as debater-A; block 8
      //    swaps the roles).
      const dave = await loginAs(page, { username: 'dave' });
      expect(dave.screenName.toLowerCase()).toBe('dave');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // 2. Log out + drop cookies so the next dance is fresh.
      await logoutAndClearAllCookies(page);

      // 3. Maria authenticates and claims debater-A through the
      //    invite acceptance flow. Maria becomes the navigating
      //    current participant whose tablet the spec asserts against.
      const maria = await loginAs(page, { username: 'maria' });
      expect(maria.screenName.toLowerCase()).toBe('maria');
      await page.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
      await expect(page.getByTestId('route-invite-acceptance')).toBeVisible({ timeout: 15_000 });
      const joinButton = page.getByTestId('invite-acceptance-join-button');
      await expect(joinButton).toBeEnabled();
      await joinButton.click();
      await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });
      await expect(page.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });

      // 4. Navigate to the operate route + assert the overlay container
      //    is mounted.
      await page.goto(`/p/sessions/${sessionId}`);
      await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-root')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-other-votes-overlay')).toBeAttached({
        timeout: 15_000,
      });
      await expect(page.getByTestId('participant-graph-status-mirror')).toBeAttached({
        timeout: 15_000,
      });

      // 5. Seed the events per Decision §7:
      //
      //      - Two node-created (NODE_A, NODE_B).
      //      - One edge-created (EDGE_AB, NODE_A → NODE_B).
      //      - Three proposals:
      //          P1: classify-node on NODE_A.
      //          P2: set-edge-substance on EDGE_AB.
      //          P3: classify-node on NODE_B.
      //      - Three votes (block 7 had a fourth alice-self vote on
      //        P3; this block omits it — NODE_B's empty-list early-
      //        exit branch is assertion-checked below regardless):
      //          SYNTHETIC_VOTER_X agree on P1 (NODE_A's first other vote).
      //          SYNTHETIC_VOTER_Y dispute on P1 (NODE_A's second other vote).
      //          SYNTHETIC_VOTER_X dispute on P2 (EDGE_AB's only other vote).
      const NODE_A_ID = '11111111-1111-4111-8111-1111111111d8';
      const NODE_B_ID = '22222222-2222-4222-8222-2222222222d8';
      const EDGE_AB_ID = '33333333-3333-4333-8333-3333333333d8';
      const P1_ID = '44444444-4444-4444-8444-44444444448d';
      const P2_ID = '44444444-4444-4444-8444-44444444448e';
      const P3_ID = '44444444-4444-4444-8444-44444444448f';
      const ACTOR_ID = '55555555-5555-4555-8555-555555555d88';
      // Synthetic OTHER-voter UUIDs. Distinct from maria.userId AND
      // dave.userId. Distinct from block 7's `7777…7771` / `…7772` so
      // the parallel blocks don't share voter identities across the
      // describe.
      const SYNTHETIC_VOTER_X = '77777777-7777-4777-8777-7777777778d1';
      const SYNTHETIC_VOTER_Y = '77777777-7777-4777-8777-7777777778d2';
      await page.evaluate(
        (seed: {
          sessionId: string;
          nodeAId: string;
          nodeBId: string;
          edgeAbId: string;
          p1Id: string;
          p2Id: string;
          p3Id: string;
          actorId: string;
          voterXId: string;
          voterYId: string;
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

          apply({
            id: '88888888-8888-4888-8888-8888888888d1',
            sessionId: seed.sessionId,
            sequence: 2_000_001,
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
            id: '88888888-8888-4888-8888-8888888888d2',
            sessionId: seed.sessionId,
            sequence: 2_000_002,
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
            id: '88888888-8888-4888-8888-8888888888d3',
            sessionId: seed.sessionId,
            sequence: 2_000_003,
            kind: 'edge-created',
            actor: seed.actorId,
            payload: {
              edge_id: seed.edgeAbId,
              role: 'supports',
              source_node_id: seed.nodeAId,
              target_node_id: seed.nodeBId,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          apply({
            id: seed.p1Id,
            sessionId: seed.sessionId,
            sequence: 2_000_004,
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
            id: seed.p2Id,
            sessionId: seed.sessionId,
            sequence: 2_000_005,
            kind: 'proposal',
            actor: seed.actorId,
            payload: {
              proposal: {
                kind: 'set-edge-substance',
                edge_id: seed.edgeAbId,
                value: 'agreed',
              },
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          apply({
            id: seed.p3Id,
            sessionId: seed.sessionId,
            sequence: 2_000_006,
            kind: 'proposal',
            actor: seed.actorId,
            payload: {
              proposal: {
                kind: 'classify-node',
                node_id: seed.nodeBId,
                classification: 'fact',
              },
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // SYNTHETIC_VOTER_X agree on P1 (NODE_A's first other vote).
          apply({
            id: '88888888-8888-4888-8888-8888888888d7',
            sessionId: seed.sessionId,
            sequence: 2_000_007,
            kind: 'vote',
            actor: seed.voterXId,
            payload: {
              target: 'proposal',
              proposal_id: seed.p1Id,
              participant: seed.voterXId,
              choice: 'agree',
              voted_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // SYNTHETIC_VOTER_Y dispute on P1 (NODE_A's second other vote).
          apply({
            id: '88888888-8888-4888-8888-8888888888d8',
            sessionId: seed.sessionId,
            sequence: 2_000_008,
            kind: 'vote',
            actor: seed.voterYId,
            payload: {
              target: 'proposal',
              proposal_id: seed.p1Id,
              participant: seed.voterYId,
              choice: 'dispute',
              voted_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // SYNTHETIC_VOTER_X dispute on P2 (EDGE_AB's only other vote).
          apply({
            id: '88888888-8888-4888-8888-8888888888d9',
            sessionId: seed.sessionId,
            sequence: 2_000_009,
            kind: 'vote',
            actor: seed.voterXId,
            payload: {
              target: 'proposal',
              proposal_id: seed.p2Id,
              participant: seed.voterXId,
              choice: 'dispute',
              voted_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
        },
        {
          sessionId,
          nodeAId: NODE_A_ID,
          nodeBId: NODE_B_ID,
          edgeAbId: EDGE_AB_ID,
          p1Id: P1_ID,
          p2Id: P2_ID,
          p3Id: P3_ID,
          actorId: ACTOR_ID,
          voterXId: SYNTHETIC_VOTER_X,
          voterYId: SYNTHETIC_VOTER_Y,
          wordingA: NODE_A_WORDING,
          wordingB: NODE_B_WORDING,
        },
      );

      // 6. Assert the canvas overlay surfaces the expected per-element
      //    dot row containers + per-voter dots in first-vote-arrival
      //    order. The overlay's commit runs inside rAF + React's
      //    reconciler tick; `toBeAttached` / `toHaveCount` await the
      //    settled DOM state.
      const nodeAOverlay = page.locator(`[data-canvas-vote-dots][data-element-id="${NODE_A_ID}"]`);
      await expect(nodeAOverlay).toHaveCount(1, { timeout: 15_000 });
      const nodeADots = nodeAOverlay.locator('[data-canvas-vote-dot]');
      await expect(nodeADots).toHaveCount(2);
      await expect(nodeADots.nth(0)).toHaveAttribute('data-voter-id', SYNTHETIC_VOTER_X);
      await expect(nodeADots.nth(0)).toHaveAttribute('data-vote', 'agree');
      await expect(nodeADots.nth(1)).toHaveAttribute('data-voter-id', SYNTHETIC_VOTER_Y);
      await expect(nodeADots.nth(1)).toHaveAttribute('data-vote', 'dispute');

      const edgeAbOverlay = page.locator(
        `[data-canvas-vote-dots][data-element-id="${EDGE_AB_ID}"]`,
      );
      await expect(edgeAbOverlay).toHaveCount(1);
      const edgeAbDots = edgeAbOverlay.locator('[data-canvas-vote-dot]');
      await expect(edgeAbDots).toHaveCount(1);
      await expect(edgeAbDots.nth(0)).toHaveAttribute('data-voter-id', SYNTHETIC_VOTER_X);
      await expect(edgeAbDots.nth(0)).toHaveAttribute('data-vote', 'dispute');

      // NODE_B has no other-participant votes — the overlay short-
      // circuits and does NOT emit a `<div data-canvas-vote-dots>` for it.
      const nodeBOverlay = page.locator(`[data-canvas-vote-dots][data-element-id="${NODE_B_ID}"]`);
      await expect(nodeBOverlay).toHaveCount(0);

      // Cross-check (Decision §8) — the DOM-mirror nested-list order
      // matches the canvas dot order for NODE_A. The two surfaces are
      // independent renderings of the same per-voter data; this probe
      // would catch any future desynchronisation.
      const nodeAMirror = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_A_ID}"] ul[data-other-votes] li[data-other-vote]`,
      );
      await expect(nodeAMirror).toHaveCount(2);
      await expect(nodeAMirror.nth(0)).toHaveAttribute('data-voter-id', SYNTHETIC_VOTER_X);
      await expect(nodeAMirror.nth(1)).toHaveAttribute('data-voter-id', SYNTHETIC_VOTER_Y);
    } finally {
      await context.close();
    }
  });

  test('erin (block-9, block-3 role-swap) navigates to operate with the test-mode flag, synthetic taps via window.__aConversaCyInstance write through to the data-selected DOM mirror', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/participant-ui/part_pan_zoom_tap.md
    //   (Decision §11 — NINTH test() block. The 12-user pool is
    //    exhausted; this block adopts the block-3 role-swap pattern
    //    (`erin + frank` — inverse of block 3's `frank + erin`) to
    //    keep parallel execution under `fullyParallel: true` race-free.
    //
    //    Decision §8 — synthetic `cy.emit('tap', ...)` via the
    //    `window.__aConversaCyInstance` test seam, NOT real
    //    `page.mouse.click(x, y)` against the canvas at a position
    //    computed from `cy.getElementById(id).renderedPosition()`. The
    //    seam pins the tap mechanically without coordinate arithmetic
    //    (avoids the happy-dom-vs-real-browser layout drift named by
    //    `part_other_vote_indicators_canvas_dots` Decision §6).
    //
    //    Decision §9 — the seam is gated on a URL query parameter
    //    (`?aconversaTestMode=1`); the spec navigates with the flag,
    //    and `<GraphView>`'s mount effect lights up the seam.
    //
    //    Per ORCHESTRATOR.md UI-stream e2e policy: the route is
    //    reachable, the tap surface is exposed via the test seam, the
    //    `data-selected` mirror is assertable — the e2e is in scope.
    //
    //    Decision §12 — no in-browser pan/zoom assertion; the Vitest
    //    cy-config readback (cases pz-a..pz-e) pins the same contract
    //    at a fraction of the wall-clock cost.)
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Pan / zoom / tap-to-select reaches the participant tablet';
      const NODE_A_WORDING = 'UBI lifts the welfare floor';
      const NODE_B_WORDING = 'Means-tested aid stigmatises';

      // 1. Erin creates the session (the creator role; block-3 inverse —
      //    block 3 had frank as creator + erin as debater-A; block 9
      //    swaps the roles).
      const erin = await loginAs(page, { username: 'erin' });
      expect(erin.screenName.toLowerCase()).toBe('erin');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // 2. Log out + drop cookies so the next dance is fresh.
      await logoutAndClearAllCookies(page);

      // 3. Frank authenticates and claims debater-A through the invite
      //    acceptance flow. Frank becomes the navigating current
      //    participant whose tablet the spec asserts against.
      const frank = await loginAs(page, { username: 'frank' });
      expect(frank.screenName.toLowerCase()).toBe('frank');
      await page.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
      await expect(page.getByTestId('route-invite-acceptance')).toBeVisible({ timeout: 15_000 });
      const joinButton = page.getByTestId('invite-acceptance-join-button');
      await expect(joinButton).toBeEnabled();
      await joinButton.click();
      await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });
      await expect(page.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });

      // 4. Navigate to the operate route WITH the test-mode flag set so
      //    `<GraphView>` exposes the live cy instance on `window`
      //    (Decision §9). Production browser sessions never see the
      //    flag and the seam stays dormant.
      await page.goto(`/p/sessions/${sessionId}?aconversaTestMode=1`);
      await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-root')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-status-mirror')).toBeAttached({
        timeout: 15_000,
      });

      // 5. Seed the events per Decision §11: two `node-created`
      //    (NODE_A, NODE_B) + one `edge-created` (EDGE_AB).
      const NODE_A_ID = '11111111-1111-4111-8111-111111111199';
      const NODE_B_ID = '22222222-2222-4222-8222-222222222299';
      const EDGE_AB_ID = '33333333-3333-4333-8333-333333333399';
      const ACTOR_ID = '55555555-5555-4555-8555-555555555599';
      await page.evaluate(
        (seed: {
          sessionId: string;
          nodeAId: string;
          nodeBId: string;
          edgeAbId: string;
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
          apply({
            id: '99999999-9999-4999-8999-999999999991',
            sessionId: seed.sessionId,
            sequence: 3_000_001,
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
            id: '99999999-9999-4999-8999-999999999992',
            sessionId: seed.sessionId,
            sequence: 3_000_002,
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
            id: '99999999-9999-4999-8999-999999999993',
            sessionId: seed.sessionId,
            sequence: 3_000_003,
            kind: 'edge-created',
            actor: seed.actorId,
            payload: {
              edge_id: seed.edgeAbId,
              role: 'supports',
              source_node_id: seed.nodeAId,
              target_node_id: seed.nodeBId,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
        },
        {
          sessionId,
          nodeAId: NODE_A_ID,
          nodeBId: NODE_B_ID,
          edgeAbId: EDGE_AB_ID,
          actorId: ACTOR_ID,
          wordingA: NODE_A_WORDING,
          wordingB: NODE_B_WORDING,
        },
      );

      // 6. Baseline — before any tap every row reads
      //    `data-selected="false"`. The mirror's explicit-false branch
      //    per Decision §7 means the assertion does not rely on
      //    attribute absence.
      const nodeARow = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_A_ID}"]`,
      );
      const nodeBRow = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_B_ID}"]`,
      );
      const edgeRow = page.locator(
        `[data-testid="participant-edge-status"][data-edge-id="${EDGE_AB_ID}"]`,
      );
      await expect(nodeARow).toHaveAttribute('data-selected', 'false', { timeout: 15_000 });
      await expect(nodeBRow).toHaveAttribute('data-selected', 'false');
      await expect(edgeRow).toHaveAttribute('data-selected', 'false');

      // 7. Synthetic tap on NODE_A via the `window.__aConversaCyInstance`
      //    seam. `cy.emit('tap', ...)` runs the registered `handleTap`
      //    synchronously; React's reconciler picks up the resulting
      //    store update on the next microtask tick.
      await page.evaluate((nodeId: string) => {
        const cy = (
          window as unknown as {
            __aConversaCyInstance?: {
              getElementById: (id: string) => unknown;
              emit: (event: string, extra: unknown[]) => unknown;
            };
          }
        ).__aConversaCyInstance;
        if (!cy) {
          throw new Error('__aConversaCyInstance is not exposed on window');
        }
        const element = cy.getElementById(nodeId) as {
          emit: (event: string, extra?: unknown[]) => unknown;
        };
        // Cytoscape's `singular.emit('tap')` dispatches a `tap` event
        // whose `event.target` is the calling singular — drives the
        // node branch of `handleTap` exactly as a real tap would.
        element.emit('tap');
      }, NODE_A_ID);

      // 8. NODE_A's row flips to `data-selected="true"`; NODE_B and
      //    the edge stay `"false"`.
      await expect(nodeARow).toHaveAttribute('data-selected', 'true', { timeout: 15_000 });
      await expect(nodeBRow).toHaveAttribute('data-selected', 'false');
      await expect(edgeRow).toHaveAttribute('data-selected', 'false');

      // 9. Synthetic tap on the EDGE — single-selection: NODE_A flips
      //    back to "false", the edge flips to "true", NODE_B stays
      //    "false".
      await page.evaluate((edgeId: string) => {
        const cy = (
          window as unknown as {
            __aConversaCyInstance?: {
              getElementById: (id: string) => unknown;
              emit: (event: string, extra: unknown[]) => unknown;
            };
          }
        ).__aConversaCyInstance;
        if (!cy) {
          throw new Error('__aConversaCyInstance is not exposed on window');
        }
        const element = cy.getElementById(edgeId) as {
          emit: (event: string, extra?: unknown[]) => unknown;
        };
        element.emit('tap');
      }, EDGE_AB_ID);

      await expect(edgeRow).toHaveAttribute('data-selected', 'true', { timeout: 15_000 });
      await expect(nodeARow).toHaveAttribute('data-selected', 'false');
      await expect(nodeBRow).toHaveAttribute('data-selected', 'false');

      // 10. Synthetic tap on the cy core (empty canvas) — every row
      //     flips back to `data-selected="false"`. The core path
      //     emits via the cy instance itself (not via an element);
      //     `handleTap` discriminates on `event.target === event.cy`.
      await page.evaluate(() => {
        const cy = (
          window as unknown as {
            __aConversaCyInstance?: {
              emit: (event: string, extra?: unknown[]) => unknown;
            };
          }
        ).__aConversaCyInstance;
        if (!cy) {
          throw new Error('__aConversaCyInstance is not exposed on window');
        }
        cy.emit('tap');
      });

      await expect(nodeARow).toHaveAttribute('data-selected', 'false', { timeout: 15_000 });
      await expect(nodeBRow).toHaveAttribute('data-selected', 'false');
      await expect(edgeRow).toHaveAttribute('data-selected', 'false');
    } finally {
      await context.close();
    }
  });

  test('henry (block-10, block-4 role-swap) navigates to operate with the test-mode flag, the entity-detail-panel surfaces identity + rollup + facet + annotation + diagnostic rows when grace taps a seeded node', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/participant-ui/part_entity_detail_panel.md
    //   (Decision §7 — TENTH test() block. The 12-user dev pool is
    //    exhausted; this block adopts the block-4 role-swap pattern
    //    (`henry + grace` — inverse of block 4's `grace + henry`) to
    //    keep parallel execution under `fullyParallel: true` race-free.
    //
    //    Asserts the entity-detail-panel surfaces:
    //      - the panel testid + the empty-state body before any tap;
    //      - on tap of NODE_A: identity row, rollup badge with
    //        data-rollup-status="proposed" (from a classify-node
    //        proposal seeded against the node), per-facet pill row,
    //        annotation row with the annotation kind label + content
    //        text, and the diagnostic row with the localized title;
    //      - on tap of NODE_B: the panel content swaps (different id);
    //      - on empty-canvas tap: the panel returns to the empty-state.
    //
    //    Per ORCHESTRATOR.md UI-stream e2e policy: the panel is the
    //    debater's user-visible surface for the per-entity drill-down
    //    detail every prior overlay leaf deferred; the e2e is the
    //    end-to-end pin against the per-section render.)
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Entity detail panel reaches the participant tablet';
      const NODE_A_WORDING = 'UBI lifts the welfare floor';
      const NODE_B_WORDING = 'Means-tested aid stigmatises';

      // 1. Henry creates the session (the creator role; block-4 inverse).
      const henry = await loginAs(page, { username: 'henry' });
      expect(henry.screenName.toLowerCase()).toBe('henry');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // 2. Log out + drop cookies so the next dance is fresh.
      await logoutAndClearAllCookies(page);

      // 3. Grace authenticates and claims debater-A through the invite
      //    acceptance flow. Grace becomes the navigating current
      //    participant whose tablet the spec asserts against.
      const grace = await loginAs(page, { username: 'grace' });
      expect(grace.screenName.toLowerCase()).toBe('grace');
      await page.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
      await expect(page.getByTestId('route-invite-acceptance')).toBeVisible({ timeout: 15_000 });
      const joinButton = page.getByTestId('invite-acceptance-join-button');
      await expect(joinButton).toBeEnabled();
      await joinButton.click();
      await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });
      await expect(page.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });

      // 4. Navigate to the operate route WITH the test-mode flag so
      //    `<GraphView>` exposes the live cy instance on `window`
      //    (the same seam blocks 9 + 10 share for synthetic taps).
      await page.goto(`/p/sessions/${sessionId}?aconversaTestMode=1`);
      await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-root')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-detail-panel')).toBeVisible({ timeout: 15_000 });

      // 5. Baseline — before any tap, the panel renders the empty-state.
      await expect(page.getByTestId('participant-detail-panel')).toHaveAttribute(
        'data-state',
        'empty',
        { timeout: 15_000 },
      );
      await expect(page.getByTestId('participant-detail-panel-empty-state')).toBeVisible();

      // 6. Seed the events: a participant-joined for grace (so the
      //    roster resolves her screen name), two node-created (NODE_A
      //    + NODE_B), a classify-node proposal on NODE_A (so the
      //    rollup is "proposed" + the facet pill row carries
      //    classification), an annotation-created on NODE_A, and a
      //    fired diagnostic (cycle) touching NODE_A. NODE_B stays
      //    bare so the panel-swap assertion has a clean contrast
      //    surface.
      const NODE_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const NODE_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const PROPOSAL_A_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const ANNO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const ACTOR_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      const GRACE_USER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      const AXIOM_PROPOSAL_ID = '11111111-1111-4111-8111-111111111111';
      // Per-facet other-voter breakdown (Section 8 sub-rows) needs a
      // second voter whose vote events land in the events log without
      // a Playwright session driving them — per
      // `part_entity_detail_panel_per_facet_other_voter_breakdown`
      // Decision §6 (synthesised user pattern; no DEV_USER_POOL expansion).
      const IVAN_USER_ID = '22222222-2222-4222-8222-222222222222';
      await page.evaluate(
        (seed: {
          sessionId: string;
          nodeAId: string;
          nodeBId: string;
          proposalAId: string;
          annoId: string;
          actorId: string;
          graceUserId: string;
          axiomProposalId: string;
          ivanUserId: string;
          wordingA: string;
          wordingB: string;
        }) => {
          const store = (
            window as unknown as {
              __aConversaWsStore?: {
                getState: () => {
                  applyEvent: (event: unknown) => void;
                  applyDiagnostic?: (payload: unknown) => void;
                };
              };
            }
          ).__aConversaWsStore;
          if (!store) {
            throw new Error('__aConversaWsStore is not exposed on window');
          }
          const apply = store.getState().applyEvent.bind(store.getState());
          apply({
            id: '99999999-9999-4999-8999-999999999a01',
            sessionId: seed.sessionId,
            sequence: 4_000_001,
            kind: 'participant-joined',
            actor: seed.graceUserId,
            payload: {
              user_id: seed.graceUserId,
              role: 'debater-A',
              screen_name: 'grace',
              joined_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          apply({
            id: '99999999-9999-4999-8999-999999999a02',
            sessionId: seed.sessionId,
            sequence: 4_000_002,
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
            id: '99999999-9999-4999-8999-999999999a03',
            sessionId: seed.sessionId,
            sequence: 4_000_003,
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
            id: seed.proposalAId,
            sessionId: seed.sessionId,
            sequence: 4_000_004,
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
            id: '99999999-9999-4999-8999-999999999a05',
            sessionId: seed.sessionId,
            sequence: 4_000_005,
            kind: 'annotation-created',
            actor: seed.actorId,
            payload: {
              annotation_id: seed.annoId,
              kind: 'note',
              content: 'panel-side annotation prose',
              target_node_id: seed.nodeAId,
              target_edge_id: null,
              created_by: seed.graceUserId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // An axiom-mark proposal from grace targeting NODE_A, then a
          // commit envelope referencing that proposal — together they
          // produce one committed AxiomMark in the projection, which
          // the panel surfaces as a chromatic per-participant badge in
          // Section 4 (per
          // `part_entity_detail_panel_chromatic_axiom_mark_badge`).
          apply({
            id: seed.axiomProposalId,
            sessionId: seed.sessionId,
            sequence: 4_000_006,
            kind: 'proposal',
            actor: seed.graceUserId,
            payload: {
              proposal: {
                kind: 'axiom-mark',
                node_id: seed.nodeAId,
                participant: seed.graceUserId,
              },
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          apply({
            id: '99999999-9999-4999-8999-999999999a07',
            sessionId: seed.sessionId,
            sequence: 4_000_007,
            kind: 'commit',
            actor: seed.actorId,
            payload: {
              target: 'proposal',
              proposal_id: seed.axiomProposalId,
              committed_by: seed.actorId,
              committed_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // A synthesised non-pool voter (ivan) joins + votes `agree` on
          // the classify-node proposal so the panel's Section 8 carries
          // a per-voter row whose per-facet sub-list surfaces the
          // classification arm. Per
          // `part_entity_detail_panel_per_facet_other_voter_breakdown`
          // Decision §6 (no Playwright session needed — `applyEvent` is
          // sufficient to seed the events log). The single agree vote
          // keeps the classification facet in `'proposed'` (per
          // `facetStatus.ts` rule 8: agreeCount < currentParticipants.size
          // because grace hasn't voted) so the existing rollup-badge
          // assertion is unaffected.
          apply({
            id: '99999999-9999-4999-8999-999999999a08',
            sessionId: seed.sessionId,
            sequence: 4_000_008,
            kind: 'participant-joined',
            actor: seed.ivanUserId,
            payload: {
              user_id: seed.ivanUserId,
              role: 'debater-B',
              screen_name: 'ivan',
              joined_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          apply({
            id: '99999999-9999-4999-8999-999999999a09',
            sessionId: seed.sessionId,
            sequence: 4_000_009,
            kind: 'vote',
            actor: seed.ivanUserId,
            payload: {
              target: 'proposal',
              proposal_id: seed.proposalAId,
              participant: seed.ivanUserId,
              choice: 'agree',
              voted_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // Fire a cycle diagnostic touching NODE_A so the panel's
          // diagnostic row renders the localized title + description.
          // Wire envelope shape per `apps/server/src/diagnostics/event-emission.ts`:
          // outer fields carry severity / status / sequence + a nested
          // `diagnostic` describing the per-kind payload.
          const applyDiag = store.getState().applyDiagnostic;
          if (applyDiag) {
            applyDiag({
              sessionId: seed.sessionId,
              kind: 'cycle',
              severity: 'blocking',
              status: 'fired',
              sequence: 4_000_010,
              diagnostic: {
                kind: 'cycle',
                nodes: [seed.nodeAId],
              },
            });
          }
        },
        {
          sessionId,
          nodeAId: NODE_A_ID,
          nodeBId: NODE_B_ID,
          proposalAId: PROPOSAL_A_ID,
          annoId: ANNO_ID,
          actorId: ACTOR_ID,
          graceUserId: GRACE_USER_ID,
          axiomProposalId: AXIOM_PROPOSAL_ID,
          ivanUserId: IVAN_USER_ID,
          wordingA: NODE_A_WORDING,
          wordingB: NODE_B_WORDING,
        },
      );

      // 7. Synthetic tap on NODE_A — the panel transitions to the
      //    detail-body and surfaces identity + rollup + facet pill +
      //    annotation + diagnostic rows.
      await page.evaluate((nodeId: string) => {
        const cy = (
          window as unknown as {
            __aConversaCyInstance?: {
              getElementById: (id: string) => { emit: (event: string) => unknown };
            };
          }
        ).__aConversaCyInstance;
        if (!cy) {
          throw new Error('__aConversaCyInstance is not exposed on window');
        }
        cy.getElementById(nodeId).emit('tap');
      }, NODE_A_ID);

      const panel = page.getByTestId('participant-detail-panel');
      await expect(panel).toHaveAttribute('data-state', 'detail', { timeout: 15_000 });
      await expect(panel).toHaveAttribute('data-entity-id', NODE_A_ID);
      await expect(panel).toHaveAttribute('data-entity-kind', 'node');

      // Identity row — wording text.
      await expect(page.getByTestId('participant-detail-panel-identity-wording')).toHaveText(
        NODE_A_WORDING,
      );

      // Rollup badge — classify-node proposal puts the rollup in
      // `proposed` (no votes have landed yet).
      await expect(page.getByTestId('participant-detail-panel-rollup-badge')).toHaveAttribute(
        'data-rollup-status',
        'proposed',
      );

      // Per-facet pill row — at least one pill present (the classify-
      // node proposal contributes the classification facet). The pill
      // row is the FacetPill display; the per-facet vote rows that
      // host the vote buttons carry `participant-detail-panel-facet-row`
      // (one per facet) — they're a sibling render under the action
      // slot, not the pill display.
      const facetRow = page.getByTestId('participant-detail-panel-facet-pill-row');
      await expect(facetRow).toBeVisible();
      await expect(facetRow.locator('[data-facet-pill]').first()).toBeVisible();

      // Per ADR 0030 §10 +
      // `pf_part_detail_panel_three_facet_rows`: the always-on
      // per-facet row block renders three rows for a node panel
      // (wording / classification / substance) regardless of how many
      // facets have a proposal. NODE_A here has a classify-node
      // proposal (so the classification row is `proposed`); the
      // wording facet has the inline node-created carriage as its
      // candidate; the substance facet has no proposal yet and the
      // row renders in the `awaiting-proposal` empty-state branch.
      const facetRows = page.locator('[data-testid="participant-detail-panel-facet-row"]');
      await expect(facetRows).toHaveCount(3, { timeout: 15_000 });
      await expect(
        page.locator(
          '[data-testid="participant-detail-panel-facet-row"][data-facet-name="wording"]',
        ),
      ).toBeVisible();
      await expect(
        page.locator(
          '[data-testid="participant-detail-panel-facet-row"][data-facet-name="classification"]',
        ),
      ).toBeVisible();
      const substanceRow = page.locator(
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="substance"]',
      );
      await expect(substanceRow).toBeVisible();
      // Substance is awaiting-proposal — no candidate value has been
      // named yet; the empty-state body surfaces here.
      await expect(substanceRow).toHaveAttribute('data-facet-status', 'awaiting-proposal');
      await expect(
        substanceRow.locator(
          '[data-testid="participant-detail-panel-facet-row-awaiting-proposal"]',
        ),
      ).toBeVisible();

      // Annotation row — kind + content + author.
      const annotationRow = page.getByTestId('participant-detail-panel-annotation-row').first();
      await expect(annotationRow).toBeVisible();
      await expect(annotationRow).toHaveAttribute('data-annotation-kind', 'note');
      await expect(annotationRow).toContainText('panel-side annotation prose');

      // Diagnostic row — localized cycle title.
      const diagnosticRow = page.getByTestId('participant-detail-panel-diagnostic-row').first();
      await expect(diagnosticRow).toBeVisible();
      await expect(diagnosticRow).toHaveAttribute('data-diagnostic-kind', 'cycle');

      // Axiom-mark attribution row — grace's seeded axiom-mark
      // (`axiom-mark` proposal + matching `commit`) surfaces as a
      // chromatic per-participant badge (per
      // `part_entity_detail_panel_chromatic_axiom_mark_badge`).
      const axiomBadge = page.locator(
        `[data-testid="axiom-mark-badge-${NODE_A_ID}-${GRACE_USER_ID}"]`,
      );
      await expect(axiomBadge).toBeVisible();
      await expect(axiomBadge).toHaveAttribute('data-participant-id', GRACE_USER_ID);
      await expect(axiomBadge).toHaveAttribute('title', /grace/);

      // Per-voter Section 8 row — ivan voted `agree` on the classify-
      // node proposal (per
      // `part_entity_detail_panel_per_facet_other_voter_breakdown`).
      // The outer row carries the rollup arm; the per-facet sub-list
      // beneath surfaces the classification arm.
      const ivanRow = page.locator(
        `[data-testid="participant-detail-panel-other-vote-row"][data-voter-id="${IVAN_USER_ID}"]`,
      );
      await expect(ivanRow).toBeVisible();
      await expect(ivanRow).toHaveAttribute('data-vote-arm', 'agree');
      const ivanFacetList = ivanRow.locator(
        '[data-testid="participant-detail-panel-other-vote-facet-list"]',
      );
      await expect(ivanFacetList).toBeVisible();
      const ivanClassificationRow = ivanFacetList.locator(
        '[data-testid="participant-detail-panel-other-vote-facet-row"][data-facet="classification"]',
      );
      await expect(ivanClassificationRow).toBeVisible();
      await expect(ivanClassificationRow).toHaveAttribute('data-vote-arm', 'agree');

      // 8. Synthetic tap on NODE_B — the panel content swaps; the
      //    rollup section omits entirely (no proposal targets NODE_B)
      //    AND the annotation / diagnostic sections also omit.
      await page.evaluate((nodeId: string) => {
        const cy = (
          window as unknown as {
            __aConversaCyInstance?: {
              getElementById: (id: string) => { emit: (event: string) => unknown };
            };
          }
        ).__aConversaCyInstance;
        if (!cy) {
          throw new Error('__aConversaCyInstance is not exposed on window');
        }
        cy.getElementById(nodeId).emit('tap');
      }, NODE_B_ID);

      await expect(panel).toHaveAttribute('data-entity-id', NODE_B_ID, { timeout: 15_000 });
      await expect(page.getByTestId('participant-detail-panel-identity-wording')).toHaveText(
        NODE_B_WORDING,
      );

      // 9. Synthetic tap on the empty canvas — the panel returns to
      //    the empty-state body.
      await page.evaluate(() => {
        const cy = (
          window as unknown as {
            __aConversaCyInstance?: { emit: (event: string) => unknown };
          }
        ).__aConversaCyInstance;
        if (!cy) {
          throw new Error('__aConversaCyInstance is not exposed on window');
        }
        cy.emit('tap');
      });

      await expect(panel).toHaveAttribute('data-state', 'empty', { timeout: 15_000 });
      await expect(page.getByTestId('participant-detail-panel-empty-state')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('julia (block-11, block-5 role-swap) navigates to operate with the test-mode flag, short-wording nodes render narrower than long-wording nodes via per-node data(width)/data(height) mappers', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/participant-ui/part_layout_measured_dimensions.md
    //   ELEVENTH test() block. Block-5 role-swap (`julia + ivan` —
    //   inverse of block 5's `ivan + julia`) to keep parallel execution
    //   under `fullyParallel: true` race-free; the 12-user pool is
    //   recycled via the role-swap pattern established by blocks 7-10.
    //
    //   Pins the per-node sizing contract end-to-end: the stylesheet's
    //   `width: 'data(width)'` / `height: 'data(height)'` /
    //   `'text-max-width': 'data(textMaxWidth)'` mappers consume what
    //   the projector stamped via `computeNodeDimensions(wording)`.
    //   The cytoscape boundingBox API exposes the rendered footprint;
    //   the assertion is "the box that holds a short wording is
    //   narrower than the box that holds a long wording" — what
    //   chromium computes, not what happy-dom's text-stub computes
    //   (the Vitest layer pins the algorithm under the stub).
    //
    //   The `window.__aConversaCyInstance` test seam is reused from
    //   `part_pan_zoom_tap` Decision §9 — gated on the
    //   `?aconversaTestMode=1` URL query parameter.
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Per-node sizing reaches the participant tablet';
      const NODE_SHORT_WORDING = 'Yes';
      const NODE_LONG_WORDING =
        'the participant should see this wording wrap across several lines as the rendered card grows to fit its content without clipping or overflowing the rounded rectangle box that cytoscape draws on the canvas';

      // 1. Julia creates the session (block-5 inverse — block 5 had
      //    ivan as creator + julia as debater-A; block 11 swaps the
      //    roles).
      const julia = await loginAs(page, { username: 'julia' });
      expect(julia.screenName.toLowerCase()).toBe('julia');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // 2. Log out + drop cookies so the next dance is fresh.
      await logoutAndClearAllCookies(page);

      // 3. Ivan authenticates and claims debater-A through the invite
      //    acceptance flow. Ivan becomes the navigating current
      //    participant whose tablet the spec asserts against.
      const ivan = await loginAs(page, { username: 'ivan' });
      expect(ivan.screenName.toLowerCase()).toBe('ivan');
      await page.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
      await expect(page.getByTestId('route-invite-acceptance')).toBeVisible({ timeout: 15_000 });
      const joinButton = page.getByTestId('invite-acceptance-join-button');
      await expect(joinButton).toBeEnabled();
      await joinButton.click();
      await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });
      await expect(page.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });

      // 4. Navigate to the operate route WITH the test-mode flag set so
      //    `<GraphView>` exposes the live cy instance on `window` for
      //    the boundingBox reads below.
      await page.goto(`/p/sessions/${sessionId}?aconversaTestMode=1`);
      await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-root')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-status-mirror')).toBeAttached({
        timeout: 15_000,
      });

      // 5. Seed two `node-created` events with very-different wording
      //    lengths.
      const NODE_SHORT_ID = '11111111-1111-4111-8111-1111111111bb';
      const NODE_LONG_ID = '22222222-2222-4222-8222-2222222222bb';
      const ACTOR_ID = '55555555-5555-4555-8555-5555555555bb';
      await page.evaluate(
        (seed: {
          sessionId: string;
          nodeShortId: string;
          nodeLongId: string;
          actorId: string;
          wordingShort: string;
          wordingLong: string;
        }) => {
          const store = (
            window as unknown as {
              __aConversaWsStore?: {
                getState: () => { applyEvent: (event: unknown) => void };
              };
            }
          ).__aConversaWsStore;
          if (!store) {
            throw new Error('__aConversaWsStore is not exposed on window');
          }
          const apply = store.getState().applyEvent.bind(store.getState());
          apply({
            id: '66666666-6666-4666-8666-66666666b001',
            sessionId: seed.sessionId,
            sequence: 1_000_001,
            kind: 'node-created',
            actor: seed.actorId,
            payload: {
              node_id: seed.nodeShortId,
              wording: seed.wordingShort,
              created_by: seed.actorId,
              created_at: '2026-05-25T00:00:00.000Z',
            },
            createdAt: '2026-05-25T00:00:00.000Z',
          });
          apply({
            id: '66666666-6666-4666-8666-66666666b002',
            sessionId: seed.sessionId,
            sequence: 1_000_002,
            kind: 'node-created',
            actor: seed.actorId,
            payload: {
              node_id: seed.nodeLongId,
              wording: seed.wordingLong,
              created_by: seed.actorId,
              created_at: '2026-05-25T00:00:00.000Z',
            },
            createdAt: '2026-05-25T00:00:00.000Z',
          });
        },
        {
          sessionId,
          nodeShortId: NODE_SHORT_ID,
          nodeLongId: NODE_LONG_ID,
          actorId: ACTOR_ID,
          wordingShort: NODE_SHORT_WORDING,
          wordingLong: NODE_LONG_WORDING,
        },
      );

      // 6. Wait for both mirror rows to land so the cy elements are
      //    confirmed mounted before reading their boundingBoxes.
      await expect(
        page.locator(`[data-testid="participant-node-status"][data-node-id="${NODE_SHORT_ID}"]`),
      ).toBeAttached({ timeout: 15_000 });
      await expect(
        page.locator(`[data-testid="participant-node-status"][data-node-id="${NODE_LONG_ID}"]`),
      ).toBeAttached({ timeout: 15_000 });

      // 7. Read each node's rendered Cytoscape boundingBox.
      const dimensions = await page.evaluate(
        (ids: { shortId: string; longId: string }) => {
          const cy = (
            window as unknown as {
              __aConversaCyInstance?: {
                getElementById: (id: string) => {
                  data: (key: string) => unknown;
                  boundingBox: () => { w: number; h: number };
                };
              };
            }
          ).__aConversaCyInstance;
          if (!cy) {
            throw new Error('__aConversaCyInstance is not exposed on window');
          }
          const shortNode = cy.getElementById(ids.shortId);
          const longNode = cy.getElementById(ids.longId);
          return {
            short: {
              data: {
                width: shortNode.data('width') as number,
                height: shortNode.data('height') as number,
                textMaxWidth: shortNode.data('textMaxWidth') as number,
              },
              bb: shortNode.boundingBox(),
            },
            long: {
              data: {
                width: longNode.data('width') as number,
                height: longNode.data('height') as number,
                textMaxWidth: longNode.data('textMaxWidth') as number,
              },
              bb: longNode.boundingBox(),
            },
          };
        },
        { shortId: NODE_SHORT_ID, longId: NODE_LONG_ID },
      );

      // 8. Assert the contract:
      //    - Both nodes carry positive numeric width / height / textMaxWidth on data.
      //    - The short-wording node's width is strictly less than the
      //      long-wording node's width (the per-node mapper actually
      //      drove different sizes, not the same constant).
      //    - The long-wording node's width does NOT exceed the
      //      MAX_NODE_WIDTH constant (240 px from nodeDimensions.ts).
      //    - The textMaxWidth invariant `textMaxWidth === width - 24`
      //      holds for both nodes.
      //    - The rendered boundingBox width tracks the data.width
      //      ordering (short bb < long bb).
      expect(dimensions.short.data.width).toBeGreaterThan(0);
      expect(dimensions.short.data.height).toBeGreaterThan(0);
      expect(dimensions.long.data.width).toBeGreaterThan(0);
      expect(dimensions.long.data.height).toBeGreaterThan(0);
      expect(dimensions.short.data.width).toBeLessThan(dimensions.long.data.width);
      expect(dimensions.long.data.width).toBeLessThanOrEqual(240);
      expect(dimensions.short.data.textMaxWidth).toBe(dimensions.short.data.width - 24);
      expect(dimensions.long.data.textMaxWidth).toBe(dimensions.long.data.width - 24);
      expect(dimensions.short.bb.w).toBeLessThan(dimensions.long.bb.w);
    } finally {
      await context.close();
    }
  });

  test('leo (block-12, block-6 role-swap) navigates to operate, a seeded annotation-endpoint edge materializes the target annotation as a graph-node and the participant can tap it', async ({
    browser,
  }) => {
    // Refinement: tasks/refinements/participant-ui/part_render_annotation_endpoint_edges.md
    //   TWELFTH test() block. Block-6 role-swap (`leo + kate` — inverse
    //   of block 6's `kate + leo`) keeps parallel execution under
    //   `fullyParallel: true` race-free; the 12-user pool is recycled
    //   via the role-swap pattern established by blocks 7–11.
    //
    //   Pins the annotation-endpoint rendering contract end-to-end: the
    //   spec seeds a `node-created` + `annotation-created` +
    //   `edge-created (target_annotation_id)` triple via the WS-store
    //   test seam, then asserts (a) the DOM mirror surfaces both nodes
    //   (statement N1 + annotation A1), (b) the edge mirror row carries
    //   `data-source-id` matching N1 and `data-target-id` matching A1,
    //   (c) the annotation row carries `data-node-kind="annotation"` +
    //   `data-annotation-kind="note"`, (d) the Cytoscape instance
    //   reports two nodes + one edge, and (e) a synthetic tap on the
    //   annotation node updates the selection store to
    //   `{ kind: 'annotation', id: A1 }` and the detail panel renders
    //   the structured annotation entity-detail body (identity / kind /
    //   content / author / target / contradicts).
    //
    // Refinement: tasks/refinements/participant-ui/part_entity_detail_panel_annotation_view.md
    //   (Pool exhaustion follow-up: the refinement initially scoped a
    //   thirteenth `henry + grace` block-4 role-swap, but that pair was
    //   already claimed by block 10 — the 12-user pool is fully
    //   recycled. The new annotation-view assertions are folded into
    //   this block instead: the seed already carries the node +
    //   annotation + contradicts-edge triple the new body needs, and an
    //   additional `participant-joined` event for the synthetic actor
    //   gives the author row a resolvable screen name. The block also
    //   exercises the target-link click round-trip: after tapping the
    //   "Annotating" link, the panel re-renders with
    //   `data-state="detail"` against the underlying statement.)
    //
    //   Uses the `?aconversaTestMode=1` query-param to enable the
    //   `window.__aConversaCyInstance` seam (per Decision §9 of
    //   `part_pan_zoom_tap`) so the spec can dispatch synthetic taps
    //   without coordinate arithmetic.
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Annotation-endpoint edges reach the participant tablet';
      const NODE_WORDING = 'UBI replaces existing welfare programs';
      const ANNOTATION_CONTENT = 'Scoped to working-age adults only';

      // 1. Leo creates the session.
      const leo = await loginAs(page, { username: 'leo' });
      expect(leo.screenName.toLowerCase()).toBe('leo');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // 2. Log out + drop cookies so the next dance is fresh.
      await logoutAndClearAllCookies(page);

      // 3. Kate authenticates and claims debater-A through the invite
      //    acceptance flow.
      const kate = await loginAs(page, { username: 'kate' });
      expect(kate.screenName.toLowerCase()).toBe('kate');
      await page.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
      await expect(page.getByTestId('route-invite-acceptance')).toBeVisible({ timeout: 15_000 });
      const joinButton = page.getByTestId('invite-acceptance-join-button');
      await expect(joinButton).toBeEnabled();
      await joinButton.click();
      await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });
      await expect(page.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });

      // 4. Navigate to the operate route with the test-mode flag so the
      //    `__aConversaCyInstance` seam is live for synthetic taps.
      await page.goto(`/p/sessions/${sessionId}?aconversaTestMode=1`);
      await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-root')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-status-mirror')).toBeAttached({
        timeout: 15_000,
      });
      await expect(page.getByTestId('participant-detail-panel')).toBeVisible({ timeout: 15_000 });

      // 5. Seed the events: a synthetic-actor `participant-joined` (so
      //    the annotation-view's author row resolves a screen name), one
      //    node, one annotation targeting that node (so the existing
      //    `part_annotation_render` overlay also fires), and one
      //    annotation-endpoint edge (N1 contradicts A1).
      const NODE_ID = '11111111-1111-4111-8111-111111111111';
      const ANNOTATION_ID = '22222222-2222-4222-8222-222222222222';
      const EDGE_ID = '33333333-3333-4333-8333-333333333333';
      const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
      const ACTOR_SCREEN_NAME = 'annotator';
      await page.evaluate(
        (seed: {
          sessionId: string;
          nodeId: string;
          annotationId: string;
          edgeId: string;
          actorId: string;
          actorScreenName: string;
          wording: string;
          annotationContent: string;
        }) => {
          const store = (
            window as unknown as {
              __aConversaWsStore?: {
                getState: () => { applyEvent: (event: unknown) => void };
              };
            }
          ).__aConversaWsStore;
          if (!store) {
            throw new Error('__aConversaWsStore is not exposed on window');
          }
          const apply = store.getState().applyEvent.bind(store.getState());
          apply({
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0000',
            sessionId: seed.sessionId,
            sequence: 5_000_000,
            kind: 'participant-joined',
            actor: seed.actorId,
            payload: {
              user_id: seed.actorId,
              role: 'debater-B',
              screen_name: seed.actorScreenName,
              joined_at: '2026-05-30T00:00:00.000Z',
            },
            createdAt: '2026-05-30T00:00:00.000Z',
          });
          apply({
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0001',
            sessionId: seed.sessionId,
            sequence: 5_000_001,
            kind: 'node-created',
            actor: seed.actorId,
            payload: {
              node_id: seed.nodeId,
              wording: seed.wording,
              created_by: seed.actorId,
              created_at: '2026-05-30T00:00:00.000Z',
            },
            createdAt: '2026-05-30T00:00:00.000Z',
          });
          apply({
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0002',
            sessionId: seed.sessionId,
            sequence: 5_000_002,
            kind: 'annotation-created',
            actor: seed.actorId,
            payload: {
              annotation_id: seed.annotationId,
              kind: 'note',
              content: seed.annotationContent,
              target_node_id: seed.nodeId,
              target_edge_id: null,
              created_by: seed.actorId,
              created_at: '2026-05-30T00:00:00.000Z',
            },
            createdAt: '2026-05-30T00:00:00.000Z',
          });
          apply({
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0003',
            sessionId: seed.sessionId,
            sequence: 5_000_003,
            kind: 'edge-created',
            actor: seed.actorId,
            payload: {
              edge_id: seed.edgeId,
              role: 'contradicts',
              source_node_id: seed.nodeId,
              target_annotation_id: seed.annotationId,
              created_by: seed.actorId,
              created_at: '2026-05-30T00:00:00.000Z',
            },
            createdAt: '2026-05-30T00:00:00.000Z',
          });
        },
        {
          sessionId,
          nodeId: NODE_ID,
          annotationId: ANNOTATION_ID,
          edgeId: EDGE_ID,
          actorId: ACTOR_ID,
          actorScreenName: ACTOR_SCREEN_NAME,
          wording: NODE_WORDING,
          annotationContent: ANNOTATION_CONTENT,
        },
      );

      // 6. Mirror assertions — both nodes appear; the annotation row
      //    carries the new discriminators; the edge row binds to the
      //    annotation id as its target.
      const statementRow = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${NODE_ID}"]`,
      );
      await expect(statementRow).toBeAttached({ timeout: 15_000 });
      await expect(statementRow).toHaveAttribute('data-node-kind', 'statement');
      await expect(statementRow).toHaveAttribute('data-annotation-kind', '');

      const annotationRow = page.locator(
        `[data-testid="participant-node-status"][data-node-id="${ANNOTATION_ID}"]`,
      );
      await expect(annotationRow).toBeAttached({ timeout: 15_000 });
      await expect(annotationRow).toHaveAttribute('data-node-kind', 'annotation');
      await expect(annotationRow).toHaveAttribute('data-annotation-kind', 'note');

      const edgeRow = page.locator(
        `[data-testid="participant-edge-status"][data-edge-id="${EDGE_ID}"]`,
      );
      await expect(edgeRow).toBeAttached({ timeout: 15_000 });
      // Per Decision §5 the annotation id flows verbatim as the
      // Cytoscape `data.target` (no namespace prefix); the mirror's
      // `data-source-id` carries the statement id and the
      // `data-target-id` carries the annotation id uniformly with
      // statement-node ids.

      // 7. Cytoscape-side witness — the cy instance reports two nodes
      //    and one edge present.
      const counts = await page.evaluate(() => {
        const cy = (
          window as unknown as {
            __aConversaCyInstance?: {
              nodes: () => { length: number };
              edges: () => { length: number };
            };
          }
        ).__aConversaCyInstance;
        if (!cy) {
          throw new Error('__aConversaCyInstance is not exposed on window');
        }
        return { nodes: cy.nodes().length, edges: cy.edges().length };
      });
      expect(counts.nodes).toBe(2);
      expect(counts.edges).toBe(1);

      // 8. Synthetic tap on the annotation graph-node — drives the
      //    selection store through `{ kind: 'annotation', id: A1 }` and
      //    the detail panel into the annotation entity-detail branch.
      await page.evaluate((annotationId: string) => {
        const cy = (
          window as unknown as {
            __aConversaCyInstance?: {
              getElementById: (id: string) => {
                emit: (event: string) => unknown;
              };
            };
          }
        ).__aConversaCyInstance;
        if (!cy) {
          throw new Error('__aConversaCyInstance is not exposed on window');
        }
        cy.getElementById(annotationId).emit('tap');
      }, ANNOTATION_ID);

      const panel = page.getByTestId('participant-detail-panel');
      await expect(panel).toHaveAttribute('data-state', 'annotation', { timeout: 15_000 });
      await expect(panel).toHaveAttribute('data-entity-kind', 'annotation');
      await expect(panel).toHaveAttribute('data-entity-id', ANNOTATION_ID);

      // 9. Annotation entity-detail body — per
      //    `part_entity_detail_panel_annotation_view`. The five-section
      //    body surfaces kind label, content text, author screen name,
      //    target-link, and the contradicts-this-annotation list.
      await expect(page.getByTestId('participant-detail-panel-annotation-kind')).toHaveText('Note');
      await expect(page.getByTestId('participant-detail-panel-annotation-content-body')).toHaveText(
        ANNOTATION_CONTENT,
      );
      await expect(page.getByTestId('participant-detail-panel-annotation-author-name')).toHaveText(
        ACTOR_SCREEN_NAME,
      );

      const targetLink = page.getByTestId('participant-detail-panel-annotation-target-link');
      await expect(targetLink).toBeVisible();
      await expect(targetLink).toHaveAttribute('data-target-kind', 'node');
      await expect(targetLink).toHaveAttribute('data-target-id', NODE_ID);
      await expect(targetLink).toContainText(NODE_WORDING);

      const contradictsRow = page.getByTestId(
        'participant-detail-panel-annotation-contradicts-row',
      );
      await expect(contradictsRow).toHaveCount(1);
      await expect(contradictsRow).toHaveAttribute('data-edge-id', EDGE_ID);

      // 10. The legacy placeholder testid is gone — negative assertion
      //     pinning the predecessor stub's removal.
      await expect(page.getByTestId('participant-detail-panel-annotation-placeholder')).toHaveCount(
        0,
      );

      // 11. Click the target-link and verify the panel re-renders with
      //     the underlying statement entity selected (selection-store
      //     round-trip via `useSelectionStore.getState().select(...)`).
      await targetLink.click();
      await expect(panel).toHaveAttribute('data-state', 'detail', { timeout: 15_000 });
      await expect(panel).toHaveAttribute('data-entity-kind', 'node');
      await expect(panel).toHaveAttribute('data-entity-id', NODE_ID);
    } finally {
      await context.close();
    }
  });
});
