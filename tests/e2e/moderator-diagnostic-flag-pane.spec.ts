// End-to-end Playwright spec — the moderator's diagnostic-flags sidebar
// pane renders every active diagnostic as a flag row in blocking-first
// order, and shows a single empty message when none are active.
//
// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_flag_pane.md
//             (Acceptance §3, Decision §D5 — e2e is IN SCOPE, not
//             deferred to `mod_pw_diagnostic_flow`)
// ADRs:
//   - docs/adr/0008-e2e-framework-playwright.md
//   - docs/adr/0022-no-throwaway-verifications.md
//   - docs/adr/0027-entity-and-facet-layers-strict-separation.md
// TaskJuggler: moderator_ui.mod_diagnostic_resolution_flow.mod_diagnostic_flag_pane
//
// **What this spec pins.** The pane is route-rendered at
// `Operate.tsx`'s `diagnosticFlagsSlot`, and a `fired` diagnostic is
// injectable into the live moderator client via the dev-only
// `window.__aConversaWsStore` backdoor (the same path the audience spec
// proves). Two scenarios:
//
//   1. Two diagnostics seeded (blocking `cycle` + advisory
//      `multi-warrant`): the `right-sidebar-pane-body-diagnostic-flags`
//      body contains two `diagnostic-flag-row`s in blocking-first order
//      with the correct `data-diagnostic-kind` / `-severity` seams and
//      the top row `data-focused="true"`.
//   2. No diagnostics seeded: a single empty message, zero rows.
//
// **Single locale (en-US).** The cross-locale flag-chrome resolution is
// pinned at the catalog-parity layer in `DiagnosticFlagPane.test.tsx`;
// this spec asserts the structural seams, which are locale-independent.

import { expect, test, type Page } from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';
import { applyDiagnostic, seedParticipants, seedWsStore } from './fixtures/wsStoreSeed';

const TEST_USERNAME = 'alice';

// Synthetic debater user ids that open the lobby gate via the WS seam.
// Mirrors `moderator-snapshot.spec.ts` / `moderator-capture.spec.ts`.
const GATE_DEBATER_A_USER_ID = '00000000-0000-4000-8000-0000000000a1';
const GATE_DEBATER_B_USER_ID = '00000000-0000-4000-8000-0000000000b1';

const NODE_A = 'node-a';
const NODE_B = 'node-b';
const NODE_C = 'node-c';

async function seedInviteParticipantsForGate(page: Page): Promise<string> {
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
  return sessionId;
}

/**
 * Drive the create-session → invite → seed-gate → operate chain, then
 * seed a small graph so the diagnostics name real nodes. Returns the
 * sessionId for the follow-on `applyDiagnostic` calls.
 */
async function reachOperateWithGraph(page: Page, topic: string): Promise<string> {
  const probe = await page.request.get('/api/auth/me');
  if (probe.status() !== 200) {
    await loginAs(page, { username: TEST_USERNAME });
  }
  await page.goto('/m/sessions/new');
  await expect(page.getByTestId('route-create-session')).toBeVisible();
  await page.getByTestId('create-session-topic-input').fill(topic);
  await page.getByTestId('create-session-submit').click();
  await page.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
  const sessionId = await seedInviteParticipantsForGate(page);
  await page.getByTestId('invite-enter-session').click();
  await page.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
  await expect(page.getByTestId('route-operate')).toBeVisible();

  // Seed a small graph so the diagnostics reference real nodes.
  await seedWsStore(page, {
    sessionId,
    nodes: [
      { nodeId: NODE_A, wording: 'A' },
      { nodeId: NODE_B, wording: 'B' },
      { nodeId: NODE_C, wording: 'C' },
    ],
    edges: [
      { edgeId: 'edge-ab', source: NODE_A, target: NODE_B, role: 'supports' },
      { edgeId: 'edge-bc', source: NODE_B, target: NODE_C, role: 'supports' },
    ],
  });
  return sessionId;
}

test.describe('moderator diagnostic-flag pane — renders the active-diagnostic inventory', () => {
  test('two diagnostics seeded → two rows in blocking-first order with correct seams', async ({
    page,
  }) => {
    const sessionId = await reachOperateWithGraph(
      page,
      'Diagnostic flag pane — populated inventory.',
    );

    // Advisory lands first (lower sequence) — the blocking cycle must
    // still take the top, `data-focused="true"` slot.
    await applyDiagnostic(page, {
      sessionId,
      kind: 'multi-warrant',
      severity: 'advisory',
      status: 'fired',
      sequence: 10,
      diagnostic: {
        kind: 'multi-warrant',
        dataNodeId: NODE_A,
        claimNodeId: NODE_B,
        warrantNodeIds: [NODE_C],
      },
    });
    await applyDiagnostic(page, {
      sessionId,
      kind: 'cycle',
      severity: 'blocking',
      status: 'fired',
      sequence: 20,
      diagnostic: { kind: 'cycle', nodes: [NODE_A, NODE_B, NODE_C] },
    });

    const body = page.getByTestId('right-sidebar-pane-body-diagnostic-flags');
    await expect(body).toBeVisible();

    const rows = body.getByTestId('diagnostic-flag-row');
    await expect(rows).toHaveCount(2);

    const firstRow = rows.nth(0);
    await expect(firstRow).toHaveAttribute('data-diagnostic-kind', 'cycle');
    await expect(firstRow).toHaveAttribute('data-diagnostic-severity', 'blocking');
    await expect(firstRow).toHaveAttribute('data-focused', 'true');

    const secondRow = rows.nth(1);
    await expect(secondRow).toHaveAttribute('data-diagnostic-kind', 'multi-warrant');
    await expect(secondRow).toHaveAttribute('data-diagnostic-severity', 'advisory');
    await expect(secondRow).toHaveAttribute('data-focused', 'false');

    // The embedded suggestions panel focuses the same flag as the top row.
    const panel = body.getByTestId('diagnostic-suggestions-panel');
    await expect(panel).toHaveAttribute('data-diagnostic-kind', 'cycle');
  });

  test('no diagnostics seeded → single empty message, zero rows', async ({ page }) => {
    await reachOperateWithGraph(page, 'Diagnostic flag pane — empty inventory.');

    const body = page.getByTestId('right-sidebar-pane-body-diagnostic-flags');
    await expect(body).toBeVisible();
    await expect(body.getByTestId('diagnostic-flag-empty')).toBeVisible();
    await expect(body.getByTestId('diagnostic-flag-row')).toHaveCount(0);
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_focus_action.md
//             (Acceptance §5, Decision §D5 — e2e IN SCOPE, extends this spec)
//
// Clicking a flag row's focus button re-frames the graph canvas on the
// diagnostic's affected region. The behavioral pin is the
// `.react-flow__viewport` `transform` changing on click (the viewport
// moved/zoomed); the deterministic pin is the row's
// `data-diagnostic-affected-nodes` seam matching the seeded cycle's
// nodes. A cycle over a TWO-node SUBSET of the three-node graph
// guarantees the focus zoom differs from the initial fit-all framing.
test.describe('moderator diagnostic-flag pane — click focuses the affected region', () => {
  test('clicking the cycle row focuses the canvas on its affected nodes', async ({ page }) => {
    const sessionId = await reachOperateWithGraph(
      page,
      'Diagnostic flag pane — focus the affected region.',
    );

    await applyDiagnostic(page, {
      sessionId,
      kind: 'cycle',
      severity: 'blocking',
      status: 'fired',
      sequence: 30,
      // A two-node subset (A, B) of the three-node graph — focusing it
      // zooms past the initial fit-all framing, so the transform must
      // change.
      diagnostic: { kind: 'cycle', nodes: [NODE_A, NODE_B] },
    });

    const body = page.getByTestId('right-sidebar-pane-body-diagnostic-flags');
    await expect(body).toBeVisible();

    // The blocking cycle is the order head — the first (and only) row.
    const row = body.getByTestId('diagnostic-flag-row').first();
    await expect(row).toHaveAttribute('data-diagnostic-kind', 'cycle');
    await expect(row).toHaveAttribute('data-diagnostic-affected-nodes', `${NODE_A} ${NODE_B}`);

    const viewport = page.locator('.react-flow__viewport');
    await expect(viewport).toBeVisible();
    // `.react-flow__viewport` is a `<div>`; ReactFlow applies the pan/zoom
    // via the inline CSS `style.transform` (`translate(...) scale(...)`),
    // NOT an HTML `transform` attribute — `getAttribute('transform')` on a
    // div is always `null`. Read the live inline transform instead.
    const readTransform = (): Promise<string> =>
      viewport.evaluate((el) => (el as HTMLElement).style.transform);
    const before = await readTransform();

    await row.getByTestId('diagnostic-flag-focus-button').click();

    // The `duration: 250` animated pan settles asynchronously — poll the
    // transform until it differs from the pre-click framing.
    await expect.poll(readTransform, { timeout: 5_000 }).not.toBe(before);
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_blocking_diagnostic_banner.md
//             (Acceptance §2, Decision §D5 — e2e IN SCOPE, extends this spec)
//
// The blocking-diagnostic banner is route-rendered at the TOP of
// `Operate.tsx`'s `<main data-testid="route-operate">`, above the
// three-pane grid (Decision §D1). It is present ONLY while ≥1
// `blocking`-severity diagnostic is active and absent otherwise — advisory
// diagnostics never raise it. Its review button re-frames the canvas (the
// transform pin already lives in the focus-action scenario above) AND
// foregrounds the diagnostic-flags sidebar pane.
test.describe('moderator blocking-diagnostic banner — announces the blocked session', () => {
  test('seeding a blocking cycle raises the banner with the right count + head kind', async ({
    page,
  }) => {
    const sessionId = await reachOperateWithGraph(page, 'Blocking banner — present when blocked.');

    await applyDiagnostic(page, {
      sessionId,
      kind: 'cycle',
      severity: 'blocking',
      status: 'fired',
      sequence: 40,
      diagnostic: { kind: 'cycle', nodes: [NODE_A, NODE_B, NODE_C] },
    });

    const banner = page.getByTestId('blocking-diagnostic-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-blocking-count', '1');
    await expect(banner).toHaveAttribute('data-diagnostic-kind', 'cycle');
  });

  test('seeding only an advisory multi-warrant leaves the banner absent', async ({ page }) => {
    // End-to-end proof that advisory diagnostics do not raise the banner —
    // while the flag pane still lists the advisory row.
    const sessionId = await reachOperateWithGraph(page, 'Blocking banner — absent when advisory.');

    await applyDiagnostic(page, {
      sessionId,
      kind: 'multi-warrant',
      severity: 'advisory',
      status: 'fired',
      sequence: 50,
      diagnostic: {
        kind: 'multi-warrant',
        dataNodeId: NODE_A,
        claimNodeId: NODE_B,
        warrantNodeIds: [NODE_C],
      },
    });

    await expect(page.getByTestId('blocking-diagnostic-banner')).toHaveCount(0);

    const body = page.getByTestId('right-sidebar-pane-body-diagnostic-flags');
    const row = body.getByTestId('diagnostic-flag-row');
    await expect(row).toHaveCount(1);
    await expect(row.first()).toHaveAttribute('data-diagnostic-kind', 'multi-warrant');
  });

  test('clicking review foregrounds the diagnostic-flags pane', async ({ page }) => {
    const sessionId = await reachOperateWithGraph(
      page,
      'Blocking banner — review foregrounds pane.',
    );

    await applyDiagnostic(page, {
      sessionId,
      kind: 'cycle',
      severity: 'blocking',
      status: 'fired',
      sequence: 60,
      // A two-node subset of the three-node graph — mirrors the focus-action
      // scenario; the canvas re-frame transform is pinned there + at the unit
      // layer, so this scenario asserts only the pane foregrounding.
      diagnostic: { kind: 'cycle', nodes: [NODE_A, NODE_B] },
    });

    const flagsPane = page.getByTestId('right-sidebar-pane-diagnostic-flags');
    await expect(flagsPane).toHaveAttribute('data-active', 'false');

    await page.getByTestId('blocking-diagnostic-banner-review').click();

    await expect(flagsPane).toHaveAttribute('data-active', 'true');
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_resolution_path_picker.md
//             (Acceptance §10/§11, Decision §D6 — single-actor observable
//              behavior is IN SCOPE here; the multi-actor
//              resolve→agree→commit→flag-clears walk stays deferred to
//              `mod_pw_diagnostic_flow`)
//
// The picker turns the methodology-suggestion chips live: a chip click
// frames the affected region (focus fires) and launches the shipped
// affordance for that move (a capture mode, or — for multi-candidate
// diagnostics — an inline target chooser that then opens a proposal
// submenu). These two scenarios pin the reachable, single-actor behavior:
//
//   10. A blocking `contradiction` → the decompose/amend/axiom-mark-both
//       chips render enabled; clicking `amend` fires canvas focus (the
//       viewport transform changes) and, after a chooser pick, opens the
//       edit-wording submenu.
//   11. An advisory `dangling-claim` → clicking `prompt-for-support`
//       enters warrant-elicitation mode (its capture panel becomes visible).
test.describe('moderator resolution-path picker — chips launch the shipped affordances', () => {
  test('contradiction chips are enabled; amend focuses the region + opens the edit-wording submenu', async ({
    page,
  }) => {
    const sessionId = await reachOperateWithGraph(
      page,
      'Resolution picker — contradiction amend path.',
    );

    await applyDiagnostic(page, {
      sessionId,
      kind: 'contradiction',
      severity: 'blocking',
      status: 'fired',
      sequence: 70,
      // A two-node subset of the three-node graph — focusing it zooms past
      // the initial fit-all framing, so the viewport transform must change.
      diagnostic: { kind: 'contradiction', nodeA: NODE_A, nodeB: NODE_B, edges: ['edge-ab'] },
    });

    const body = page.getByTestId('right-sidebar-pane-body-diagnostic-flags');
    await expect(body).toBeVisible();

    // The three contradiction chips render live (enabled), per Acceptance §4.
    await expect(body.getByTestId('diagnostic-suggestions-move-decompose')).toBeEnabled();
    await expect(body.getByTestId('diagnostic-suggestions-move-axiom-mark-both')).toBeEnabled();
    const amendChip = body.getByTestId('diagnostic-suggestions-move-amend');
    await expect(amendChip).toBeEnabled();

    const viewport = page.locator('.react-flow__viewport');
    await expect(viewport).toBeVisible();
    const readTransform = (): Promise<string> =>
      viewport.evaluate((el) => (el as HTMLElement).style.transform);
    const before = await readTransform();

    // Clicking the chip frames the affected region (focus fires) and, for
    // the multi-candidate contradiction, presents the inline target chooser.
    await amendChip.click();
    await expect.poll(readTransform, { timeout: 5_000 }).not.toBe(before);

    // Pick a candidate node → the edit-wording submenu opens seeded with it.
    await body.getByTestId(`diagnostic-resolution-chooser-candidate-${NODE_A}`).click();
    const submenu = page.getByTestId('edit-wording-submenu');
    await expect(submenu).toBeVisible();
    await expect(submenu).toHaveAttribute('data-node-id', NODE_A);
  });

  test('dangling-claim prompt-for-support enters warrant-elicitation mode', async ({ page }) => {
    const sessionId = await reachOperateWithGraph(
      page,
      'Resolution picker — dangling-claim prompt path.',
    );

    await applyDiagnostic(page, {
      sessionId,
      kind: 'dangling-claim',
      severity: 'advisory',
      status: 'fired',
      sequence: 80,
      diagnostic: { kind: 'dangling-claim', nodeId: NODE_A },
    });

    const body = page.getByTestId('right-sidebar-pane-body-diagnostic-flags');
    await expect(body).toBeVisible();

    await body.getByTestId('diagnostic-suggestions-move-prompt-for-support').click();

    // Warrant-elicitation mode opened against the dangling claim node — its
    // capture panel is route-rendered in the bottom strip when the mode is on.
    const panel = page.getByTestId('warrant-elicitation-capture-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-warrant-elicitation-target-node-id', NODE_A);
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_break_edge_resolution_action.md
//             (Acceptance §9, Decision §D6 — single-actor observable
//              behavior is IN SCOPE here; the multi-actor
//              propose→agree→commit→flag-clears walk stays deferred to
//              `mod_pw_diagnostic_flow`)
//
// The break-edge chip derives the cycle's breakable `supports` edges from
// the live projection. Seeding a cycle over the two-node subset {A, B}
// with TWO supports edges between them (the base graph's A→B plus a
// seeded back-edge B→A) gives ≥2 candidates → the inline edge chooser.
// The subset (two of the three graph nodes) forces the focus zoom past
// the initial fit-all framing, so the viewport transform must change.
test.describe('moderator resolution-path picker — break-edge edge chooser', () => {
  test('break-edge chip opens the edge chooser, focuses the region, and a pick dismisses it', async ({
    page,
  }) => {
    const sessionId = await reachOperateWithGraph(page, 'Resolution picker — break-edge path.');

    // Close the A→B / B→? base graph into a real 2-cycle over {A, B}: add a
    // back-edge B→A so {A, B} carries two breakable supports edges.
    await seedWsStore(page, {
      sessionId,
      edges: [{ edgeId: 'edge-ba', source: NODE_B, target: NODE_A, role: 'supports' }],
    });

    await applyDiagnostic(page, {
      sessionId,
      kind: 'cycle',
      severity: 'blocking',
      status: 'fired',
      sequence: 90,
      diagnostic: { kind: 'cycle', nodes: [NODE_A, NODE_B] },
    });

    const body = page.getByTestId('right-sidebar-pane-body-diagnostic-flags');
    await expect(body).toBeVisible();

    const breakEdgeChip = body.getByTestId('diagnostic-suggestions-move-break-edge');
    await expect(breakEdgeChip).toBeEnabled();

    const viewport = page.locator('.react-flow__viewport');
    await expect(viewport).toBeVisible();
    const readTransform = (): Promise<string> =>
      viewport.evaluate((el) => (el as HTMLElement).style.transform);
    const before = await readTransform();

    // Clicking the chip frames the affected region (focus fires) and opens
    // the inline edge chooser populated with the cycle's supports edges.
    await breakEdgeChip.click();
    await expect.poll(readTransform, { timeout: 5_000 }).not.toBe(before);

    const chooser = body.getByTestId('diagnostic-resolution-chooser');
    await expect(chooser).toBeVisible();
    await expect(chooser).toHaveAttribute('data-chooser-kind', 'edge');
    await expect(body.getByTestId('diagnostic-resolution-chooser-candidate-edge-ab')).toBeVisible();
    await expect(body.getByTestId('diagnostic-resolution-chooser-candidate-edge-ba')).toBeVisible();

    // Picking an edge dispatches the break-edge proposal and dismisses the
    // chooser (the pick closes optimistically; the multi-actor commit walk
    // is `mod_pw_diagnostic_flow`'s remit).
    await body.getByTestId('diagnostic-resolution-chooser-candidate-edge-ab').click();
    await expect(chooser).toHaveCount(0);
  });
});
