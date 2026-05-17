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
              proposal_id: seed.axiomProposalId,
              moderator: seed.actorId,
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
});
