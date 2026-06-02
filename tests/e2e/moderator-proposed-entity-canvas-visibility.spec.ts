// End-to-end Playwright spec — proposed entities appear on the graph
// canvas from the moment of proposal.
//
// Refinement: tasks/refinements/moderator-ui/mod_proposed_entity_canvas_visibility.md
// ADRs:
//   - docs/adr/0027-entity-and-facet-layers-strict-separation.md
//   - docs/adr/0008-e2e-framework-playwright.md
//   - docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: moderator_ui.mod_graph_rendering.mod_proposed_entity_canvas_visibility
//
// **What this spec pins.** Per `docs/methodology.md` L57 — "A proposed
// change appears on the graph in `proposed` state from the moment it is
// made." The four scenarios below cover the failure modes flagged in
// the refinement's Acceptance criteria:
//
//   1. Free-floating `classify-node` propose: the new node renders on
//      the canvas with `data-facet-status="proposed"`.
//   2. `set-edge-substance` propose with a fresh edge to an existing
//      target: the source node + the edge both surface with
//      `data-facet-status="proposed"`.
//   3. 2-component `decompose` propose: parent stays visible, both
//      child nodes render with `data-facet-status="proposed"`.
//   4. Single-actor propose-then-withdraw (moderator proposes then
//      withdraws their own pending proposal): proposed node leaves the
//      canvas and the pending-proposal row is removed after
//      `withdraw-proposal`. Owned by `mod_withdraw_proposal_gesture`,
//      which pays down the single-actor slice of the originally-3-context
//      Scenario 4 debt; the cross-surface 3-context variant stays
//      deferred to `participant_ui.part_withdraw_proposal_gesture`.
//   5. Propose-connecting-capture-node-then-withdraw: the composition of
//      Scenario 2 (a connecting `capture-node` seeds a source node + a
//      fresh edge) and Scenario 4 (withdraw). The proposed EDGE leaves the
//      canvas on withdraw (not just the node + row). Owned by
//      `mod_withdraw_proposal_canvas_edge_annotation_removal`, which fixes
//      the moderator edge projector (`selectEdgesForSession`) to honor
//      `entity-removed(edge)` — the gap the node-only fix left open.
//
// Authored failing-first per the refinement (red commit shows
// `statement-node-*` testids missing for the proposed node); the fix
// commit emits the `node-created` / `edge-created` / `entity-included`
// events at propose-time so the canvas projector renders the entities
// in `proposed` state.
//
// **Locale.** en-US only; cross-locale matrix is covered at the catalog
// level (per `tests/e2e/moderator-capture.spec.ts:28-30`).

import { expect, test, type Page } from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';
import { seedParticipants } from './fixtures/wsStoreSeed';

const TEST_USERNAME = 'alice';

// Synthetic debater user ids for the moderator-only scenarios that
// use the WS-store seed to open the lobby gate. Mirrors
// `moderator-capture.spec.ts:52-53`.
const GATE_DEBATER_A_USER_ID = '00000000-0000-4000-8000-0000000000a1';
const GATE_DEBATER_B_USER_ID = '00000000-0000-4000-8000-0000000000b1';

async function seedInviteParticipantsForGate(page: Page): Promise<void> {
  const url = page.url();
  const match = url.match(/\/m\/sessions\/([0-9a-f-]+)\/invite$/);
  if (match === null) {
    throw new Error(`seedInviteParticipantsForGate: URL did not match the invite shape: ${url}`);
  }
  const sessionId = match[1] as string;
  await seedParticipants(page, {
    sessionId,
    participants: [
      { userId: GATE_DEBATER_A_USER_ID, role: 'debater-A', screenName: 'ben' },
      { userId: GATE_DEBATER_B_USER_ID, role: 'debater-B', screenName: 'maria' },
    ],
  });
}

/**
 * Drive the create-session → invite → seed-gate → operate-canvas chain
 * that every moderator-only scenario shares. Returns the sessionId so
 * the caller can compose follow-on assertions.
 */
async function moderatorReachOperate(page: Page, topic: string): Promise<string> {
  // The bootstrap auth jar already authenticates the user (alice via
  // Authelia). The shared `loginAs` short-circuits on the
  // `/api/auth/me === 200` probe when the stored screen name
  // case-sensitively matches `opts.username`; the dev DB sometimes
  // carries `Alice` from a prior interactive session. Probe directly
  // and skip `loginAs` when authenticated, so the spec is robust
  // against either case.
  const probe = await page.request.get('/api/auth/me');
  if (probe.status() !== 200) {
    await loginAs(page, { username: TEST_USERNAME });
  }
  await page.goto('/m/sessions/new');
  await expect(page.getByTestId('route-create-session')).toBeVisible();
  await page.getByTestId('create-session-topic-input').fill(topic);
  await page.getByTestId('create-session-submit').click();
  await page.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
  await seedInviteParticipantsForGate(page);
  await page.getByTestId('invite-enter-session').click();
  await page.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
  await expect(page.getByTestId('route-operate')).toBeVisible();
  const url = new URL(page.url());
  const sessionId = url.pathname.split('/')[3] ?? '';
  expect(sessionId, 'session id must be parsed from the URL').toBeTruthy();
  return sessionId;
}

/**
 * Drive the propose chain (type wording, fire Cmd/Ctrl+Enter).
 * Returns when the capture pane has cleared optimistically — the WS
 * round-trip is in flight. Per `pf_mod_capture_pane_wording_only`
 * (ADR 0030 §1) the capture-pane gesture is wording-only — the
 * classification palette is no longer mounted, and the propose-
 * action validation gate no longer requires a classification pick.
 */
async function proposeStatement(page: Page, wording: string): Promise<void> {
  const textarea = page.getByTestId('capture-text-input-textarea');
  await textarea.fill(wording);
  const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
  await textarea.press(submitKey);
  await expect(textarea).toHaveValue('');
}

test.describe('mod_proposed_entity_canvas_visibility — proposed entities render on the canvas at propose-time', () => {
  test('Scenario 1: free-floating capture-node propose → exactly one statement-node renders with data-facet-status="proposed"', async ({
    page,
  }) => {
    const wording = 'The proposed minimum wage would raise prices for everyone.';
    await moderatorReachOperate(
      page,
      'Scenario 1 — free-floating propose canvas-visibility check.',
    );

    // Pre-fix baseline: zero proposed statement-node testids on the canvas.
    // No need to assert here — the propose chain below produces exactly one.
    await proposeStatement(page, wording);

    // The propose round-trip lands a `proposal` envelope server-side
    // and (per ADR 0027) accompanying `node-created` + `entity-included`
    // structural events. The canvas projector
    // (`apps/moderator/src/graph/GraphCanvasPane.tsx#projectNodes`)
    // emits one ReactFlow node per `node-created` event.
    //
    // Assert: exactly one `statement-node-*` testid surfaces; that
    // element carries `data-facet-status="proposed"`; the wording is
    // the one we typed.
    const nodes = page.getByTestId(/^statement-node-[0-9a-f-]+$/);
    await expect(nodes).toHaveCount(1, { timeout: 15_000 });
    const node = nodes.first();
    await expect(node).toHaveAttribute('data-facet-status', 'proposed', { timeout: 15_000 });
    await expect(node.locator('[data-testid^="statement-node-wording-"]')).toHaveText(wording, {
      timeout: 15_000,
    });
  });

  test('Scenario 2: set-edge-substance propose with a fresh edge to an existing target → source node + edge both render proposed', async ({
    page,
  }) => {
    const firstWording = 'Universal basic income reduces poverty.';
    const secondWording = 'It also reduces work incentives.';
    await moderatorReachOperate(
      page,
      'Scenario 2 — propose-with-new-edge canvas-visibility check.',
    );

    // Step 1 — propose a target node so a subsequent propose can
    // attempt to connect to it. The propose stays in `proposed` state
    // (no commit, no votes). One `statement-node-*` testid surfaces.
    await proposeStatement(page, firstWording);
    const firstNodes = page.getByTestId(/^statement-node-[0-9a-f-]+$/);
    await expect(firstNodes).toHaveCount(1, { timeout: 15_000 });

    // Step 2 — capture a second statement that points at the first.
    // Per ADR 0030 §4 the connecting-capture is a single
    // `capture-node` proposal whose payload's optional `edge` block
    // carries the role + endpoints inline; the server emits
    // node-created + entity-included(node) + edge-created +
    // entity-included(edge) + proposal at propose-time.
    //
    // We drive the "click an existing node to stage it as target"
    // gesture: the canvas's per-card click handler (per
    // `mod_target_auto_suggest`) sets `useCaptureStore.targetEntityId`
    // and the propose-action's edge-role gate opens. Type wording,
    // pick an edge role, fire submit.
    await firstNodes.first().click();

    const textarea = page.getByTestId('capture-text-input-textarea');
    await textarea.fill(secondWording);
    // Pick an edge role — `supports` is the methodology default; the
    // edge-role selector test ids follow the
    // `edge-role-selector-button-<role>` shape per `EdgeRoleSelector.tsx`.
    const supportsButton = page.getByTestId('edge-role-selector-button-supports');
    await expect(supportsButton).toBeVisible({ timeout: 5_000 });
    // Fire the click as a synthetic event rather than via the mouse
    // pipeline. The bottom-strip reflow that follows the
    // target-staging click can keep the supports button's hit-test
    // coordinates inside the `bottom-strip-propose-action` cell for
    // 20+ seconds on a busy runner (iter-001 trace: 24 s of
    // `propose-action intercepts pointer events` retries; iter-002:
    // `waitForBoundingBoxStable` returned a false positive after two
    // polls landed in the same transient stable window, then the
    // click took another 25 s anyway). The behaviour under test here
    // is the propose-entity-render path, not the click ergonomics —
    // a synthetic `click` event runs the button's React `onClick`
    // handler without going through hit-testing. The role-button
    // click ergonomics are pinned by `moderator-capture.spec.ts` +
    // `moderator-real-capture-flow.spec.ts` under their own project.
    await supportsButton.dispatchEvent('click');
    const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
    await textarea.press(submitKey);
    await expect(textarea).toHaveValue('');

    // Both nodes (the prior target + the new source) must surface, and
    // both must carry `data-facet-status="proposed"`.
    const nodes = page.getByTestId(/^statement-node-[0-9a-f-]+$/);
    await expect(nodes).toHaveCount(2, { timeout: 15_000 });
    for (const handle of await nodes.elementHandles()) {
      const status = await handle.getAttribute('data-facet-status');
      expect(status).toBe('proposed');
    }

    // Per ADR 0030 §4 the connecting-capture is a single
    // `capture-node` whose inline `edge` block carries the role +
    // endpoints; the propose handler emits `edge-created` +
    // `entity-included(edge)` at propose-time. The edge's `shape`
    // facet enters life with the role+endpoints inline as candidate
    // (status `'proposed'`); its `substance` facet enters life as
    // `'awaiting-proposal'` (no candidate, per ADR 0030 §10). The
    // canvas projector (`StatementEdge.tsx`) stamps the edge's
    // SUBSTANCE-facet status onto `data-facet-status`, so the
    // freshly-captured edge carries `'awaiting-proposal'`. Assert:
    // exactly one edge label surfaces; it carries
    // `data-facet-status="awaiting-proposal"`.
    const edgeLabels = page.locator('[data-testid^="graph-edge-label-"]');
    await expect(edgeLabels).toHaveCount(1, { timeout: 15_000 });
    await expect(edgeLabels.first()).toHaveAttribute('data-facet-status', 'awaiting-proposal', {
      timeout: 15_000,
    });
  });

  test('Scenario 3: 2-component decompose propose → parent + 2 children all render with data-facet-status="proposed" (incl. reconnect-seed re-render)', async ({
    page,
  }) => {
    // Per `mod_decompose_propose_time_canvas_visibility`, the propose
    // handler emits per-component `node-created` + `entity-included`
    // for `decompose` at propose-time alongside the `proposal`
    // envelope. The canvas projector renders the proposed components
    // in `proposed` state immediately. The parent stays visible
    // during the proposed window (per `docs/methodology.md` L84 +
    // `docs/data-model.md` L282-285 — the parent flips invisible
    // only on commit). This scenario asserts the three-node canvas
    // state after a 2-component decompose propose.
    const parentWording = 'Workers should earn a living wage and receive fair benefits.';
    await moderatorReachOperate(
      page,
      'Scenario 3 — 2-component decompose propose-time canvas-visibility check.',
    );

    // Step 1 — propose the parent statement (free-floating
    // classify-node). One `statement-node-*` testid surfaces.
    await proposeStatement(page, parentWording);
    const oneNode = page.getByTestId(/^statement-node-[0-9a-f-]+$/);
    await expect(oneNode).toHaveCount(1, { timeout: 15_000 });

    // Step 2 — right-click the parent node to open the graph
    // context menu; click the Decompose menu item to enter
    // decompose-mode against the parent.
    const parentNode = oneNode.first();
    await parentNode.click({ button: 'right' });
    await expect(page.getByTestId('graph-context-menu')).toBeVisible();
    await page.getByTestId('graph-context-menu-item-propose-decompose').click();

    // Step 3 — fill the two default decompose-component rows (the
    // grid seeds 2 empty rows on mode-entry per
    // `mod_decompose_mode`). Pick a classification per row.
    await expect(page.getByTestId('decompose-component-row-0')).toBeVisible();
    await page.getByTestId('decompose-component-text-0').fill('Workers should earn a living wage.');
    await page.getByTestId('decompose-component-classification-0-button-value').click();
    await page
      .getByTestId('decompose-component-text-1')
      .fill('Workers should receive fair benefits.');
    await page.getByTestId('decompose-component-classification-1-button-normative').click();

    // Step 4 — click the Propose-decomposition button. The propose
    // handler emits 2 × (node-created + entity-included) + the
    // proposal envelope. The canvas now shows the parent + the two
    // proposed children, all `data-facet-status="proposed"`.
    await page.getByTestId('propose-decomposition-action-button').click();

    const nodes = page.getByTestId(/^statement-node-[0-9a-f-]+$/);
    await expect(nodes).toHaveCount(3, { timeout: 15_000 });
    for (const handle of await nodes.elementHandles()) {
      const status = await handle.getAttribute('data-facet-status');
      expect(status).toBe('proposed');
    }

    // ───────────────────────────────────────────────────────────────────
    // Reconnect-seed sub-step — pins the deferred regression cover from
    // `migrate_off_compute_facet_statuses_onto_proposal_status_broadcast`.
    // Refinement:
    // `tasks/refinements/moderator-ui/mod_pw_reconnect_seed_visible_styling.md`
    //
    // The migration landed the server-side `proposal-status` seed
    // envelopes (`emitPendingProposalStatusFrames` at
    // `apps/server/src/ws/broadcast/proposal-status.ts:697-720`,
    // dispatched from the snapshot + catch-up handlers AFTER
    // `snapshot-state`) and rewired the moderator's facet-status reads
    // off the broadcast-derived store cell. What this sub-step pins is
    // that a real moderator browser losing its WS connection mid-
    // decompose actually rebuilds the per-component canvas styling
    // from those seed envelopes on reconnect. The acceptance is two-
    // fold: (a) after the kill + reconnect, the three nodes still
    // carry `data-facet-status="proposed"`; (b) during the catch-up
    // window between `snapshot-state` apply and the seed-envelope
    // apply, NO node's `data-facet-status` flashes to `null` / `''` /
    // `'undefined'` / `'awaiting-proposal'` (the migration's D7
    // ordering guarantee).
    // ───────────────────────────────────────────────────────────────────

    // Capture the node testids so the flash-watcher polls the exact
    // same three elements through the reconnect window even if
    // ReactFlow re-mounts the wrapping DOM nodes.
    const proposedTestIds: string[] = [];
    for (const handle of await nodes.elementHandles()) {
      const id = await handle.getAttribute('data-testid');
      if (id !== null) proposedTestIds.push(id);
    }
    expect(proposedTestIds).toHaveLength(3);

    // Force-close the underlying WS socket via the moderator-installed
    // test seam (Decision §D3 — `OperateRouteInner` exposes
    // `window.__testHooks.killWebSocket` on mount, deletes on unmount;
    // the underlying `WsClient.killWebSocket()` triggers the natural
    // onclose → `scheduleReconnect()` path without flipping
    // `explicitlyClosed`).
    await page.evaluate(() => {
      const w = window as unknown as { __testHooks?: { killWebSocket?: () => void } };
      const kill = w.__testHooks?.killWebSocket;
      if (kill === undefined) {
        throw new Error('window.__testHooks.killWebSocket was not installed by OperateRoute');
      }
      kill();
    });

    // Wait for the connection to recover to 'open' (the post-hello,
    // pre-seed-envelope sliver is what the D7 ordering pin guards
    // against — but the visible status flip is the cue to start
    // re-asserting the canvas state). The connection-status read goes
    // through `__aConversaWsStore` per the existing seed-helper in
    // `tests/e2e/fixtures/wsStoreSeed.ts`'s precedent.
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __aConversaWsStore?: { getState: () => { connectionStatus: string } };
        };
        return w.__aConversaWsStore?.getState().connectionStatus === 'open';
      },
      undefined,
      { timeout: 10_000, polling: 50 },
    );

    // Post-reconnect: the three nodes still carry
    // `data-facet-status="proposed"`. This is the headline assertion —
    // the seed envelopes arriving after `snapshot-state` rebuild the
    // per-entity `pendingProposalFacetStatus` cells, and the canvas
    // projector reads them back onto each node's `data-facet-status`.
    const reconnectedNodes = page.getByTestId(/^statement-node-[0-9a-f-]+$/);
    await expect(reconnectedNodes).toHaveCount(3, { timeout: 15_000 });
    for (const handle of await reconnectedNodes.elementHandles()) {
      const status = await handle.getAttribute('data-facet-status');
      expect(status).toBe('proposed');
    }

    // Flash-to-undefined watcher — per Decision §D6. Sample every 50ms
    // for a 2-second window after the connection returns; reject if
    // any sampled iteration observes a node whose `data-facet-status`
    // is `null` / `''` / `'undefined'` / `'awaiting-proposal'`. The
    // D7 ordering guarantee (seed envelopes go AFTER `snapshot-state`)
    // would surface as a sampled-null failure here.
    //
    // The watcher runs AFTER the headline assertion because once the
    // re-render has settled we only need to confirm no future render
    // tick regresses. (The catch-up sliver itself is sub-100ms in
    // practice — `expect.poll` at 50ms is tight enough to catch a
    // future regression that re-introduced an empty intermediate
    // render while staying inside Playwright-idiomatic patterns.)
    const observedBadStatuses: string[] = [];
    await expect
      .poll(
        async () => {
          const statuses = await page.evaluate((testIds) => {
            return testIds.map((id) => {
              const el = document.querySelector(`[data-testid="${id}"]`);
              return el === null ? '__missing__' : el.getAttribute('data-facet-status');
            });
          }, proposedTestIds);
          for (const s of statuses) {
            if (s === null || s === '' || s === 'undefined' || s === 'awaiting-proposal') {
              observedBadStatuses.push(s ?? 'null');
            }
          }
          return observedBadStatuses.length;
        },
        { intervals: Array.from({ length: 40 }, () => 50), timeout: 2_500 },
      )
      .toBe(0);
  });

  // Scenario 4 — single-actor propose-then-withdraw. Owned by
  // `moderator_ui.mod_withdraw_proposal_gesture`, which pays down the
  // single-actor slice of the Scenario 4 debt the canvas-visibility
  // refinement deferred (§D5 of that task's refinement). The withdraw
  // button is route-rendered on the operate console's pending-proposals
  // row and the proposal is seedable by the moderator's own propose
  // gesture, so under the strict UI-stream reachability test e2e is in
  // scope here, not deferred again.
  //
  // The CROSS-SURFACE 3-context variant (a *debater* proposing and
  // withdrawing from the participant tablet while the moderator observes
  // the node disappear on a second context) remains genuinely
  // unreachable: it needs a participant-side withdraw affordance that
  // does not exist yet. That dimension is deferred to the new task
  // `participant_ui.part_withdraw_proposal_gesture` (re-using
  // `cross-surface-lobby-start.spec.ts:46-95`'s 3-context fixture),
  // NOT to a silent `test.fixme` here.
  test('Scenario 4: single-actor propose-then-withdraw → proposed node leaves the canvas and the pending-proposal row is removed', async ({
    page,
  }) => {
    const wording = 'The proposed levy should be scrapped before it ever takes effect.';
    await moderatorReachOperate(
      page,
      'Scenario 4 — single-actor propose-then-withdraw canvas-visibility check.',
    );

    // Step 1 — propose a free-floating statement (the Scenario 1
    // shape). Exactly one `statement-node-*` testid surfaces in
    // `proposed` state.
    await proposeStatement(page, wording);
    const nodes = page.getByTestId(/^statement-node-[0-9a-f-]+$/);
    await expect(nodes).toHaveCount(1, { timeout: 15_000 });
    await expect(nodes.first()).toHaveAttribute('data-facet-status', 'proposed', {
      timeout: 15_000,
    });

    // Step 2 — a pending-proposal row surfaces for the proposal. The
    // moderator (alice) is the original proposer (`row.actor ===
    // auth.user.userId`), so the proposer-gated withdraw button renders
    // on that row (per `mod_withdraw_proposal_gesture` §D3 — UX gating;
    // the server independently enforces proposer authority).
    const rows = page.getByTestId('pending-proposal-row');
    await expect(rows).toHaveCount(1, { timeout: 15_000 });
    const withdrawButton = rows.first().getByTestId('withdraw-proposal-button');
    await expect(withdrawButton).toBeVisible({ timeout: 15_000 });
    await expect(withdrawButton).toHaveAttribute('data-withdraw-state', 'enabled');

    // Step 3 — click withdraw. The hook dispatches the existing
    // `withdraw-proposal` WS message
    // (`apps/moderator/src/layout/useWithdrawProposalAction.ts`); the
    // server's `withdraw.ts` handler derives the retraction set from the
    // proposal sub-kind and emits one `entity-removed` event per
    // propose-time-created entity plus the `proposal-withdrawn` ack. No
    // wire error must surface in the row's error region.
    await withdrawButton.click();
    await expect(rows.first().getByTestId('withdraw-proposal-button-wire-error')).toHaveCount(0, {
      timeout: 15_000,
    });

    // Step 4 — the `entity-removed` broadcast applies on the canvas
    // projector: the proposed node leaves the canvas (zero matching
    // `statement-node` elements) and the pending-proposal row is
    // removed. This is the headline assertion that pays down the
    // deferred Scenario 4 single-actor observable behaviour.
    await expect(nodes).toHaveCount(0, { timeout: 15_000 });
    await expect(rows).toHaveCount(0, { timeout: 15_000 });
  });

  // Scenario 5 — propose-with-edge-then-withdraw. Owned by
  // `moderator_ui.mod_withdraw_proposal_canvas_edge_annotation_removal`.
  // The composition of Scenario 2 (connecting `capture-node` seeds a
  // source node + a fresh edge) and Scenario 4 (single-actor withdraw).
  // Withdrawing the connecting `capture-node` emits one
  // `entity-removed(node)` (the source) AND one `entity-removed(edge)` (the
  // minted connecting edge). The node projector already drops the source
  // node; this task's edge projector fix (`selectEdgesForSession`
  // `removedEdgeIds` pass) drops the edge — so the proposed edge leaves the
  // canvas, not just the proposed node and the pending-proposal row. This
  // pins the edge-projector fix end-to-end.
  //
  // Both the connecting-capture gesture and the withdraw button are
  // route-rendered in the operate console and seedable by the moderator's
  // own gestures, so this e2e is IN SCOPE (strict reachability met), not
  // deferred.
  test('Scenario 5: propose connecting capture-node then withdraw → proposed edge and source node leave the canvas', async ({
    page,
  }) => {
    const targetWording = 'Universal basic income reduces poverty.';
    const sourceWording = 'It also reduces work incentives.';
    await moderatorReachOperate(
      page,
      'Scenario 5 — propose-with-edge-then-withdraw canvas-visibility check.',
    );

    // Step 1 — propose the target statement so the connecting capture has
    // something to point at. One `statement-node-*` testid surfaces.
    await proposeStatement(page, targetWording);
    const firstNodes = page.getByTestId(/^statement-node-[0-9a-f-]+$/);
    await expect(firstNodes).toHaveCount(1, { timeout: 15_000 });

    // Step 2 — connecting capture (Scenario 2 seed): click the target to
    // stage it, type the source wording, pick the `supports` edge role,
    // fire submit. Per ADR 0030 §4 this is a single `capture-node` whose
    // inline `edge` block carries the role + endpoints; the server emits
    // node-created + entity-included(node) + edge-created +
    // entity-included(edge) + proposal at propose-time.
    await firstNodes.first().click();
    const textarea = page.getByTestId('capture-text-input-textarea');
    await textarea.fill(sourceWording);
    const supportsButton = page.getByTestId('edge-role-selector-button-supports');
    await expect(supportsButton).toBeVisible({ timeout: 5_000 });
    // Synthetic click — same rationale as Scenario 2 (bottom-strip reflow
    // can keep the button under the propose-action cell for the hit-test).
    await supportsButton.dispatchEvent('click');
    const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
    await textarea.press(submitKey);
    await expect(textarea).toHaveValue('');

    // Seed assertion — both nodes (prior target + new source) render, and
    // exactly one proposed edge label surfaces.
    const nodes = page.getByTestId(/^statement-node-[0-9a-f-]+$/);
    await expect(nodes).toHaveCount(2, { timeout: 15_000 });
    const edgeLabels = page.locator('[data-testid^="graph-edge-label-"]');
    await expect(edgeLabels).toHaveCount(1, { timeout: 15_000 });

    // Step 3 — two pending-proposal rows now exist (the target propose +
    // the connecting capture). They surface in proposal-arrival order, so
    // the connecting capture-node is the LAST row. Click its withdraw
    // button. The server's `withdraw.ts` handler emits
    // `entity-removed(node)` for the source and `entity-removed(edge)` for
    // the minted connecting edge plus the `proposal-withdrawn` ack. No
    // wire error must surface.
    const rows = page.getByTestId('pending-proposal-row');
    await expect(rows).toHaveCount(2, { timeout: 15_000 });
    const connectingRow = rows.last();
    const withdrawButton = connectingRow.getByTestId('withdraw-proposal-button');
    await expect(withdrawButton).toBeVisible({ timeout: 15_000 });
    await expect(withdrawButton).toHaveAttribute('data-withdraw-state', 'enabled');
    await withdrawButton.click();
    await expect(connectingRow.getByTestId('withdraw-proposal-button-wire-error')).toHaveCount(0, {
      timeout: 15_000,
    });

    // Step 4 — the headline assertion: after the `entity-removed`
    // broadcast applies, the proposed edge leaves the canvas (edge label
    // count returns to 0) and the source node is removed (one
    // `statement-node` remains — the original target). The connecting
    // capture's pending row is gone; the target's row stays.
    await expect(edgeLabels).toHaveCount(0, { timeout: 15_000 });
    await expect(nodes).toHaveCount(1, { timeout: 15_000 });
    await expect(rows).toHaveCount(1, { timeout: 15_000 });
  });
});
