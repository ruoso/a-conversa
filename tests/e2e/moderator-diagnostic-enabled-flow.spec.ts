// End-to-end Playwright spec — the F3 (diagnostic-test) and F7
// (diagnostic-resolution) moderator surfaces in their ENABLED state.
//
// Refinement: tasks/refinements/moderator-ui/mod_pw_diagnostic_flow.md
// ADRs:
//   - docs/adr/0008-e2e-framework-playwright.md  (the `window.__aConversaWsStore` dev seam)
//   - docs/adr/0022-no-throwaway-verifications.md (committed automated checks only)
//   - docs/adr/0024-frontend-i18n-react-i18next-with-icu.md (en-US in e2e)
// TaskJuggler: moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_diagnostic_flow
//
// **What this spec pins.** This is the terminal catch-all e2e task for
// the F3 / F7 moderator surfaces: it cashes in the `seedWsStore`
// facet-vote primitive (`playwright_f6_substance_precommit_full_chain`)
// to drive a node's substance facet to `disputed` / `committed` and
// thereby reach every diagnostic-gated ENABLED-state affordance that
// nine predecessor refinements deferred here (because, at their ship
// time, no test could satisfy `disputationOutcome(substance) === 'claim'`).
//
// Each scenario reaches the operate canvas via the shared create → invite
// → seed-gate → operate chain, seeds the projection directly through the
// dev-only `window.__aConversaWsStore` backdoor, and asserts observable,
// route-rendered behavior — a mounted capture panel, a chip outcome
// attribute, an enabled context-menu item, a canonical-order chip row, a
// vanished flag / edge — never internal store state.
//
// **What this spec deliberately does NOT pin.** The DISABLED-state of the
// two F3 mode-entry menu items is already pinned inline by
// `mod_warrant_elicitation_mode` (`moderator-warrant-elicitation-mode.spec.ts`)
// — not duplicated here. The genuinely-live multi-browser full-backend
// walk (two real participant tablets agreeing, a real backend re-running
// diagnostics and broadcasting the `cleared` frame) is the pre-existing
// remit of `mod_pw_full_session_run` (Decision §D2) — this spec drives the
// seed backdoor, asserting the moderator UI's *response* to the F3/F7
// state space.
//
// **Locale.** en-US only; the cross-locale matrix is covered at the
// catalog level (Decision §D4, matching the sibling specs).

import { expect, test, type Locator, type Page } from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';
import { applyDiagnostic, seedParticipants, seedWsStore } from './fixtures/wsStoreSeed';

const TEST_USERNAME = 'alice';

// Synthetic debater user ids that open the lobby gate via the WS seam AND
// stand in as the two current participants whose substance-facet votes the
// `derive` projection counts (votes from non-current participants are
// filtered out by Rule 3 of the facet-status derivation). Mirrors
// `moderator-warrant-elicitation-mode.spec.ts` / `moderator-capture.spec.ts`.
const GATE_DEBATER_A_USER_ID = '00000000-0000-4000-8000-0000000000a7';
const GATE_DEBATER_B_USER_ID = '00000000-0000-4000-8000-0000000000b7';

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
 * that every moderator-only scenario shares. Returns the sessionId so the
 * caller can compose the follow-on seed / assertion. Mirrors the helper of
 * the same name in `moderator-warrant-elicitation-mode.spec.ts`.
 */
async function moderatorReachOperate(page: Page, topic: string): Promise<string> {
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
 * Right-click a ReactFlow node, polling the gesture until the
 * `<GraphContextMenu>` mounts with `data-target-kind="node"`. ReactFlow's
 * `onNodeContextMenu` is gated on the node's ResizeObserver measurement;
 * a newly-seeded node can race that, so the right-click no-ops and the
 * menu never opens (or opens the pane menu instead). The gesture is
 * idempotent — each `contextmenu` event re-opens the menu at the latest
 * pointer position — so polling until `data-target-kind` is `"node"`
 * closes the race. Lifted from `moderator-capture.spec.ts`.
 */
async function rightClickNodeUntilContextMenuOpens(page: Page, node: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        await node.click({ button: 'right' });
        const menu = page.getByTestId('graph-context-menu');
        if ((await menu.count()) === 0) return null;
        return await menu.getAttribute('data-target-kind');
      },
      { intervals: [50, 100, 200, 500, 1000], timeout: 5_000 },
    )
    .toBe('node');
}

/**
 * Seed one node into a contested (`substance: 'disputed'`) state: a
 * `set-node-substance` proposal establishes the substance candidate (Rule
 * 2 of the facet-status derivation requires a candidate before any vote
 * counts), then a single `dispute` vote from one current debater drives
 * the facet to `disputed` (Rule 5). `disputed` maps to the `'claim'`
 * disputation outcome — the predicate that gates the F3 chip, the
 * operationalization-test menu item, and the warrant-elicitation-test menu
 * item (`GraphCanvasPane.tsx:1637,1644`). Waits for the disputation chip
 * to render `claim` so the seed has settled before the caller asserts.
 */
async function seedDisputedNode(page: Page, sessionId: string, nodeId: string): Promise<Locator> {
  await seedWsStore(page, {
    sessionId,
    nodes: [{ nodeId, wording: 'Disputed substance node under test.' }],
    proposals: [{ proposal: { kind: 'set-node-substance', node_id: nodeId, value: 'agreed' } }],
    votes: [
      {
        entityKind: 'node',
        entityId: nodeId,
        facet: 'substance',
        participant: GATE_DEBATER_A_USER_ID,
        choice: 'dispute',
      },
    ],
  });
  const node = page.getByTestId(`statement-node-${nodeId}`);
  await expect(node, 'seeded disputed node must render').toBeVisible({ timeout: 15_000 });
  // The chip is the direct read of the substance facet; its `claim`
  // outcome confirms `disputed` settled before the gate assertions run.
  await expect(node.locator('[data-disputation-chip]')).toHaveAttribute(
    'data-disputation-outcome',
    'claim',
    { timeout: 15_000 },
  );
  return node;
}

test.describe('mod_pw_diagnostic_flow — F3/F7 enabled-state diagnostic flow (seed backdoor)', () => {
  // AC #1 (cycle) — the diagnostic-flags pane embeds the suggestions panel
  // keyed to the focused diagnostic's kind, with the methodology's
  // canonical-order move chips (`cycle → break-edge, decompose,
  // axiom-mark`, per `diagnosticSuggestions.ts`).
  test('AC#1a: a fired cycle diagnostic surfaces the suggestions panel with cycle chips in canonical order', async ({
    page,
  }) => {
    const sessionId = await moderatorReachOperate(page, 'F3 suggestions panel — cycle kind.');
    await seedWsStore(page, {
      sessionId,
      nodes: [
        { nodeId: 'node-a', wording: 'A' },
        { nodeId: 'node-b', wording: 'B' },
        { nodeId: 'node-c', wording: 'C' },
      ],
      edges: [
        { edgeId: 'edge-ab', source: 'node-a', target: 'node-b', role: 'supports' },
        { edgeId: 'edge-bc', source: 'node-b', target: 'node-c', role: 'supports' },
      ],
    });
    await applyDiagnostic(page, {
      sessionId,
      kind: 'cycle',
      severity: 'blocking',
      status: 'fired',
      sequence: 10,
      diagnostic: { kind: 'cycle', nodes: ['node-a', 'node-b', 'node-c'] },
    });

    const body = page.getByTestId('right-sidebar-pane-body-diagnostic-flags');
    await expect(body).toBeVisible();
    const panel = body.getByTestId('diagnostic-suggestions-panel');
    await expect(panel).toHaveAttribute('data-diagnostic-kind', 'cycle');
    await expect(panel).toHaveAttribute('data-diagnostic-severity', 'blocking');

    const moves = panel.locator('[data-suggestion-move]');
    await expect(moves).toHaveCount(3);
    const order = await moves.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-suggestion-move')),
    );
    const cycleMoves = ['break-edge', 'decompose', 'axiom-mark'] as const;
    expect(order).toEqual([...cycleMoves]);
    // Every chip is keyed to the focused diagnostic kind (the F7 picker's
    // switch contract).
    for (const move of cycleMoves) {
      await expect(panel.getByTestId(`diagnostic-suggestions-move-${move}`)).toHaveAttribute(
        'data-suggestion-diagnostic-kind',
        'cycle',
      );
    }
  });

  // AC #1 (contradiction) — the second diagnostic kind: the panel re-keys
  // to `contradiction` with its canonical move order (`decompose, amend,
  // axiom-mark-both`).
  test('AC#1b: a fired contradiction diagnostic surfaces the suggestions panel with contradiction chips in canonical order', async ({
    page,
  }) => {
    const sessionId = await moderatorReachOperate(
      page,
      'F3 suggestions panel — contradiction kind.',
    );
    await seedWsStore(page, {
      sessionId,
      nodes: [
        { nodeId: 'node-a', wording: 'A' },
        { nodeId: 'node-b', wording: 'B' },
      ],
      edges: [{ edgeId: 'edge-ab', source: 'node-a', target: 'node-b', role: 'contradicts' }],
    });
    await applyDiagnostic(page, {
      sessionId,
      kind: 'contradiction',
      severity: 'blocking',
      status: 'fired',
      sequence: 10,
      diagnostic: { kind: 'contradiction', nodeA: 'node-a', nodeB: 'node-b', edges: ['edge-ab'] },
    });

    const body = page.getByTestId('right-sidebar-pane-body-diagnostic-flags');
    await expect(body).toBeVisible();
    const panel = body.getByTestId('diagnostic-suggestions-panel');
    await expect(panel).toHaveAttribute('data-diagnostic-kind', 'contradiction');

    const moves = panel.locator('[data-suggestion-move]');
    await expect(moves).toHaveCount(3);
    const order = await moves.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-suggestion-move')),
    );
    expect(order).toEqual(['decompose', 'amend', 'axiom-mark-both']);
  });

  // AC #2 — substance `dispute` votes drive the node's disputation chip to
  // the `claim` outcome (`disputed` → `claim` per `disputationOutcome.ts`).
  test('AC#2: substance dispute votes render the disputation chip with outcome="claim"', async ({
    page,
  }) => {
    const sessionId = await moderatorReachOperate(page, 'F3 disputation chip — claim outcome.');
    // `seedDisputedNode` asserts the chip is `claim`; the explicit
    // re-assertion below documents the AC pin at the call site.
    const node = await seedDisputedNode(page, sessionId, 'node-claim');
    await expect(node.locator('[data-disputation-chip]')).toHaveAttribute(
      'data-disputation-outcome',
      'claim',
    );
  });

  // AC #3 — substance unanimous-agree votes + a commit drive the chip to
  // the `data` outcome (`committed` → `data`).
  test('AC#3: substance agree votes + commit render the disputation chip with outcome="data"', async ({
    page,
  }) => {
    const sessionId = await moderatorReachOperate(page, 'F3 disputation chip — data outcome.');
    const nodeId = 'node-data';
    await seedWsStore(page, {
      sessionId,
      nodes: [{ nodeId, wording: 'Committed substance node under test.' }],
      proposals: [{ proposal: { kind: 'set-node-substance', node_id: nodeId, value: 'agreed' } }],
      votes: [
        {
          entityKind: 'node',
          entityId: nodeId,
          facet: 'substance',
          participant: GATE_DEBATER_A_USER_ID,
          choice: 'agree',
        },
        {
          entityKind: 'node',
          entityId: nodeId,
          facet: 'substance',
          participant: GATE_DEBATER_B_USER_ID,
          choice: 'agree',
        },
      ],
      commits: [{ entityKind: 'node', entityId: nodeId, facet: 'substance' }],
    });

    const node = page.getByTestId(`statement-node-${nodeId}`);
    await expect(node).toBeVisible({ timeout: 15_000 });
    await expect(node.locator('[data-disputation-chip]')).toHaveAttribute(
      'data-disputation-outcome',
      'data',
      { timeout: 15_000 },
    );
  });

  // AC #4 + AC #6 — with substance `disputed`, the operationalization-test
  // menu item is ENABLED; clicking it mounts `<OperationalizationCapturePanel>`
  // targeting the node, and the is-ought prompt surfaces in the same
  // capture mode.
  test('AC#4+#6: operationalization-test is enabled on a disputed node; clicking mounts the capture panel and the is-ought prompt', async ({
    page,
  }) => {
    const sessionId = await moderatorReachOperate(page, 'F3 operationalization — enabled-state.');
    const nodeId = 'node-op';
    const node = await seedDisputedNode(page, sessionId, nodeId);

    await rightClickNodeUntilContextMenuOpens(page, node);
    const item = page.getByTestId('graph-context-menu-item-run-operationalization-test');
    await expect(item).toBeVisible();
    // ENABLED: the disputation gate maps `disputed` → `claim`, so the
    // `disabled` predicate (`!== 'claim'`) is false.
    await expect(item).toHaveAttribute('aria-disabled', 'false');
    await expect(item).toBeEnabled();

    await item.click();
    const panel = page.getByTestId('operationalization-capture-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-operationalization-target-node-id', nodeId);

    // AC #6 — the is-ought prompt mounts whenever the capture mode is
    // `operationalization` (or `warrant-elicitation`); pin both its
    // presence and the mode it surfaced under.
    const isOught = page.getByTestId('is-ought-prompt');
    await expect(isOught).toBeVisible();
    await expect(isOught).toHaveAttribute('data-mode', 'operationalization');
  });

  // AC #5 — symmetric to AC #4 for the warrant-elicitation-test item.
  // (The DISABLED-state of this item is pinned inline by
  // `mod_warrant_elicitation_mode`; only the enabled-state is new here.)
  test('AC#5: warrant-elicitation-test is enabled on a disputed node; clicking mounts the capture panel', async ({
    page,
  }) => {
    const sessionId = await moderatorReachOperate(page, 'F3 warrant-elicitation — enabled-state.');
    const nodeId = 'node-warrant';
    const node = await seedDisputedNode(page, sessionId, nodeId);

    await rightClickNodeUntilContextMenuOpens(page, node);
    const item = page.getByTestId('graph-context-menu-item-run-warrant-elicitation-test');
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute('aria-disabled', 'false');
    await expect(item).toBeEnabled();

    await item.click();
    const panel = page.getByTestId('warrant-elicitation-capture-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-warrant-elicitation-target-node-id', nodeId);
  });

  // AC #7 — the F7 resolution-lifecycle projection response. Seed a cycle
  // over a real 2-cycle (`A ⇄ B`, two `supports` edges) → the flag + the
  // suggestions panel render. Then seed the resolution lifecycle: the
  // `break-edge` proposal plus its commit-time `entity-removed(edge)`
  // fan-out, and the `cleared` diagnostic frame. The moderator projection
  // reacts: the broken edge unmounts, and the cleared diagnostic drops the
  // flag row + the suggestions panel (which the flag pane stops mounting
  // once `activeDiagnostics` is empty). Per Decision §D5 this pins the
  // moderator's *reaction* to the lifecycle, not the server's derivation
  // of the clear.
  test('AC#7: resolving a cycle (break-edge commit + cleared diagnostic) drops the flag, the suggestions panel, and the broken edge', async ({
    page,
  }) => {
    const sessionId = await moderatorReachOperate(page, 'F7 resolution lifecycle — cycle cleared.');
    const cycleDiagnostic = { kind: 'cycle', nodes: ['node-a', 'node-b'] };
    await seedWsStore(page, {
      sessionId,
      nodes: [
        { nodeId: 'node-a', wording: 'A' },
        { nodeId: 'node-b', wording: 'B' },
      ],
      // A real 2-cycle over {A, B}: A→B and the back-edge B→A.
      edges: [
        { edgeId: 'edge-ab', source: 'node-a', target: 'node-b', role: 'supports' },
        { edgeId: 'edge-ba', source: 'node-b', target: 'node-a', role: 'supports' },
      ],
    });
    await applyDiagnostic(page, {
      sessionId,
      kind: 'cycle',
      severity: 'blocking',
      status: 'fired',
      sequence: 10,
      diagnostic: cycleDiagnostic,
    });

    // Pre-resolution: the flag row + suggestions panel are present, and
    // both cycle edges render.
    const body = page.getByTestId('right-sidebar-pane-body-diagnostic-flags');
    await expect(body).toBeVisible();
    await expect(body.getByTestId('diagnostic-flag-row')).toHaveCount(1);
    await expect(body.getByTestId('diagnostic-suggestions-panel')).toHaveAttribute(
      'data-diagnostic-kind',
      'cycle',
    );
    await expect(page.getByTestId('graph-edge-label-edge-ab')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('graph-edge-label-edge-ba')).toBeVisible();

    // Resolve: seed the `break-edge` proposal and its commit-time
    // `entity-removed(edge-ab)` fan-out (the observable projection effect
    // of a break-edge commit in the seed backdoor), then the `cleared`
    // diagnostic frame carrying the same identity as the fired one.
    await seedWsStore(page, {
      sessionId,
      proposals: [{ proposal: { kind: 'break-edge', edge_id: 'edge-ab' } }],
      entityRemovals: [{ entityKind: 'edge', entityId: 'edge-ab' }],
    });
    await applyDiagnostic(page, {
      sessionId,
      kind: 'cycle',
      severity: 'blocking',
      status: 'cleared',
      sequence: 20,
      diagnostic: cycleDiagnostic,
    });

    // Post-resolution: the flag row + suggestions panel are gone (the flag
    // pane shows its single empty message and stops mounting the panel
    // once `activeDiagnostics` is empty), and the broken edge no longer
    // renders. The surviving back-edge stays.
    await expect(body.getByTestId('diagnostic-flag-row')).toHaveCount(0);
    await expect(body.getByTestId('diagnostic-flag-empty')).toBeVisible();
    await expect(body.getByTestId('diagnostic-suggestions-panel')).toHaveCount(0);
    await expect(page.getByTestId('graph-edge-label-edge-ab')).toHaveCount(0);
    await expect(page.getByTestId('graph-edge-label-edge-ba')).toBeVisible();
  });
});
