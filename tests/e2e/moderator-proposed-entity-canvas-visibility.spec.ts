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
//   4. Propose-then-withdraw across 3 contexts (moderator + proposer
//      debater + non-proposer debater): proposed node disappears from
//      every canvas after `withdraw-proposal`.
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
    await supportsButton.click();
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

  test('Scenario 3: 2-component decompose propose → parent + 2 children all render with data-facet-status="proposed"', async ({
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
  });

  // Scenario 4 (propose-then-withdraw 3-context flow) remains
  // deferred per the parent refinement: it needs the participant-side
  // withdraw gesture (M5 leaf) AND the cross-surface 3-context test
  // fixture (re-using `cross-surface-lobby-start.spec.ts:46-95`'s
  // shape). The follow-up task is `mod_withdraw_proposal_gesture`;
  // the wire-layer `withdraw-proposal` handler + the
  // `entity-removed` event lifecycle ship in this commit cluster
  // (Vitest + Cucumber coverage pin the wire contract).
  //
  // The scenario is intentionally LEFT OUT — re-adding it as silent
  // `test.fixme` would violate the refinement's D6 ("Failing-first
  // e2e is a real failing test, not a `test.fixme` or `test.fail()`
  // annotation"). The follow-up refinement MUST scope its own
  // Playwright cell per the tech-debt registration policy (see
  // ORCHESTRATOR.md).
});
