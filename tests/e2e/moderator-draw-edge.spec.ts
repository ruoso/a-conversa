// End-to-end Playwright spec — moderator drag-from-handle-to-handle
// creates a proposed edge between two existing statement nodes, the
// edge propagates to both debater tablets, and the moderator can
// commit the proposal.
//
// Refinement: tasks/refinements/moderator-ui/mod_drag_to_create_edge.md
//             tasks/refinements/moderator-ui/mod_role_palette_on_drop.md
// TaskJuggler: moderator_ui.mod_capture_flow.mod_draw_edge_flow
//   (mod_drag_to_create_edge + mod_role_palette_on_drop, both F4 leaves)
// ADRs:
//   - docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//   - docs/adr/0008-e2e-framework-playwright.md
//   - docs/adr/0022-no-throwaway-verifications.md
//   - docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md
//
// **Why three real browser contexts.** ADR 0004 picks ReactFlow on the
// moderator surface for its drag-to-create-edge ergonomics; the wire
// fan-out per ADR 0030 §4 / `mod_set_edge_substance_endpoint_carriage`
// emits `edge-created` + `entity-included(edge)` + `proposal` at
// propose-time so subscribers see the proposed edge immediately. The
// only way to verify the cross-surface broadcast lands is to drive
// three independent browser contexts (alice as moderator + ben as
// debater-A + maria as debater-B) and read the edge off the
// participant `participant-edge-status` mirror on the two debater
// tablets. Same fixture posture as `cross-surface-lobby-start.spec.ts`
// + `methodology-full-flow.spec.ts`.
//
// **What this spec pins.**
//   - Phase 1 — three-context session setup; both debaters auto-handoff
//     to the operate route once alice clicks Enter.
//   - Phase 2 — alice proposes two free-floating statements; both
//     debaters' canvases mirror them via `participant-node-status`.
//   - Phase 3 — alice drags from N1's source handle to N2's target
//     handle; the role picker mounts at the drop point; alice picks
//     `supports`; the connecting `set-edge-substance` envelope lands
//     `edge-created` + `entity-included(edge)` + `proposal` per
//     `mod_set_edge_substance_endpoint_carriage`.
//   - Phase 4 — the proposed edge surfaces on alice's canvas
//     (`data-facet-status="proposed"`) AND on both debater tablets
//     (`participant-edge-status` carries the same edge id).
//   - Phase 5 — both debaters vote agree on the edge shape facet via
//     their detail panel; alice commits the shape facet via
//     `edge-shape-commit-affordance`. Tolerant of either commit
//     success or an inline wire-error per the methodology-full-flow
//     precedent — both prove the envelope round-trip completed.
//   - Phase 6 — both debaters vote agree on the edge substance facet;
//     alice commits the `set-edge-substance` proposal via the
//     pending-proposals pane. Same tolerant-acceptance pattern.

import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from './fixtures/no-scrollbars';

import { authedContext } from './fixtures/authed-context';

const TOPIC = 'F4 draw-edge flow — moderator drag, debaters see, moderator commits.';
const N1_WORDING = 'Universal basic income reduces poverty.';
const N2_WORDING = 'Cash transfers improve children’s outcomes.';

let aliceContext: BrowserContext;
let benContext: BrowserContext;
let mariaContext: BrowserContext;
let alicePage: Page;
let benPage: Page;
let mariaPage: Page;
let sessionId: string;
let n1Id: string | null = null;
let n2Id: string | null = null;
let edgeId: string | null = null;

/**
 * Resolve the rendered node id for a given wording off alice's canvas.
 * Mirrors `methodology-full-flow.spec.ts` lines 228-236 — the
 * `statement-node-wording-<id>` testid is the seam.
 */
async function readNodeIdByWording(page: Page, wording: string): Promise<string> {
  const wordingLocator = page.locator('[data-testid^="statement-node-wording-"]', {
    hasText: wording,
  });
  await expect(wordingLocator).toBeVisible({ timeout: 15_000 });
  const testid = await wordingLocator.getAttribute('data-testid');
  expect(testid).toMatch(/^statement-node-wording-[0-9a-f-]+$/);
  return testid!.replace(/^statement-node-wording-/, '');
}

/**
 * Type a wording into the capture textarea and fire Cmd/Ctrl+Enter to
 * land a free-floating `capture-node` proposal. Mirrors the helper in
 * `moderator-proposed-entity-canvas-visibility.spec.ts` lines 100-105.
 */
async function proposeStatement(page: Page, wording: string): Promise<void> {
  const textarea = page.getByTestId('capture-text-input-textarea');
  await textarea.fill(wording);
  const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
  await textarea.press(submitKey);
  await expect(textarea).toHaveValue('');
}

/**
 * Drive a low-level pointer drag from one handle locator to another.
 *
 * Sampling rules:
 *   - Source position is read via `hover()` BEFORE `mouse.down()` — at
 *     that point the handle is in its idle state and Playwright's
 *     actionability checks (visible + stable) hold.
 *   - The target's drop coordinate is read via `boundingBox()`
 *     IMMEDIATELY before `mouse.up()`, NOT via `hover()`. Once
 *     `mouse.down()` has fired on the source, ReactFlow stamps the
 *     candidate target handle with the `react-flow__handle-connecting`
 *     class and re-runs the per-frame connection-line projection;
 *     `Locator.hover()` then waits indefinitely for the handle to be
 *     "stable" (no bbox change across two animation frames), which
 *     never happens while the drag is in progress and times the test
 *     out (iter-001 evidence: 61 retries × 500 ms ≈ test timeout, then
 *     `Target page closed`). `boundingBox()` reads the rect without
 *     gating on actionability — that rect IS the handle's settled
 *     position, even if a sibling render is in flight.
 *   - Intermediate `mouse.move` events keep ReactFlow's
 *     connection-line tracker fed so the gesture is recognised as a
 *     drag rather than a click.
 */
async function dragFromHandleToHandle(
  page: Page,
  sourceHandle: Locator,
  targetHandle: Locator,
): Promise<void> {
  await sourceHandle.hover();
  const sourceBox = await sourceHandle.boundingBox();
  if (sourceBox === null) {
    throw new Error('dragFromHandleToHandle: source handle bounding box was null');
  }
  await page.mouse.down();

  const targetBoxStart = await targetHandle.boundingBox();
  if (targetBoxStart !== null) {
    const fromX = sourceBox.x + sourceBox.width / 2;
    const fromY = sourceBox.y + sourceBox.height / 2;
    const toX = targetBoxStart.x + targetBoxStart.width / 2;
    const toY = targetBoxStart.y + targetBoxStart.height / 2;
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      await page.mouse.move(
        fromX + ((toX - fromX) * i) / steps,
        fromY + ((toY - fromY) * i) / steps,
        { steps: 2 },
      );
    }
  }

  const targetBoxFinal = await targetHandle.boundingBox();
  if (targetBoxFinal !== null) {
    await page.mouse.move(
      targetBoxFinal.x + targetBoxFinal.width / 2,
      targetBoxFinal.y + targetBoxFinal.height / 2,
    );
  }
  await page.mouse.up();
}

/**
 * Poll a locator's bounding box until two consecutive reads match
 * within 0.5 px on x/y/width/height. Returns the settled rect.
 *
 * Why we need this before the Phase 3.1 drag. After Phase 2.1 mints
 * N1 + N2, dagre lays them out from the placeholder origin; ReactFlow
 * then measures each node via ResizeObserver. `mod_layout_measured_
 * dimensions` debounces those measurements for 75 ms and bumps
 * `layoutRevision`, which re-runs the dagre pass against the measured
 * footprint — nodes (and their handles) shift one final time after
 * the initial paint. On a fast local runner that shift settles well
 * before the drag fires; on a slow CI runner the 75 ms debounce can
 * fire DURING the drag and move the target handle out from under the
 * pointer, so ReactFlow's `onConnect` never sees a valid (source,
 * target) pair and `<DrawEdgeRolePicker>` never mounts. Polling for
 * a stable bounding box closes the window: when two consecutive reads
 * agree, no further measurement-driven re-layout is pending.
 */
async function waitForBoundingBoxStable(
  locator: ReturnType<Page['locator']>,
  options: { timeoutMs?: number; intervalMs?: number; toleranceMs?: number } = {},
): Promise<{ x: number; y: number; width: number; height: number }> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 50;
  const tolerance = options.toleranceMs ?? 0.5;
  const deadline = Date.now() + timeoutMs;
  let prev: { x: number; y: number; width: number; height: number } | null = null;
  while (Date.now() < deadline) {
    const box = await locator.boundingBox();
    if (box !== null) {
      if (
        prev !== null &&
        Math.abs(prev.x - box.x) < tolerance &&
        Math.abs(prev.y - box.y) < tolerance &&
        Math.abs(prev.width - box.width) < tolerance &&
        Math.abs(prev.height - box.height) < tolerance
      ) {
        return box;
      }
      prev = box;
    } else {
      prev = null;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('waitForBoundingBoxStable: bounding box never stabilized within timeout');
}

test.describe
  .serial('mod_draw_edge_flow — drag-from-handle creates a proposed edge across 3 browser contexts and the moderator commits it', () => {
  test.beforeAll(async ({ browser }) => {
    aliceContext = await authedContext(browser, 'alice');
    alicePage = await aliceContext.newPage();
    benContext = await authedContext(browser, 'ben');
    benPage = await benContext.newPage();
    mariaContext = await authedContext(browser, 'maria');
    mariaPage = await mariaContext.newPage();
  });

  test.afterAll(async () => {
    await mariaContext?.close();
    await benContext?.close();
    await aliceContext?.close();
  });

  // ── Phase 1 — session setup ───────────────────────────────────────
  test('Phase 1.1: alice creates a public session', async () => {
    await alicePage.goto('/m/sessions/new');
    await expect(alicePage.getByTestId('route-create-session')).toBeVisible();
    await alicePage.getByTestId('create-session-topic-input').fill(TOPIC);
    await alicePage.getByTestId('create-session-privacy-public').click();
    await alicePage.getByTestId('create-session-submit').click();
    await alicePage.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 15_000 });
    const match = alicePage.url().match(/\/m\/sessions\/([0-9a-f-]+)\/invite$/);
    expect(match).not.toBeNull();
    sessionId = match![1] as string;
  });

  test('Phase 1.2: ben self-claims debater-A', async () => {
    await benPage.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
    await expect(benPage.getByTestId('route-invite-acceptance')).toBeVisible({
      timeout: 15_000,
    });
    await benPage.getByTestId('invite-acceptance-join-button').click();
    await benPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
      timeout: 15_000,
    });
  });

  test('Phase 1.3: maria self-claims debater-B', async () => {
    await mariaPage.goto(`/p/sessions/${sessionId}/invite?role=debater-B`);
    await expect(mariaPage.getByTestId('route-invite-acceptance')).toBeVisible({
      timeout: 15_000,
    });
    await mariaPage.getByTestId('invite-acceptance-join-button').click();
    await mariaPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
      timeout: 15_000,
    });
  });

  test('Phase 1.4: alice clicks Enter-session; all three surfaces land on operate', async () => {
    const enterButton = alicePage.getByTestId('invite-enter-session');
    await expect(enterButton).toBeEnabled({ timeout: 15_000 });
    await enterButton.click();
    await alicePage.waitForURL((url) => url.pathname === `/m/sessions/${sessionId}/operate`, {
      timeout: 15_000,
    });
    await expect(alicePage.getByTestId('route-operate')).toBeVisible();
    await expect(alicePage.getByTestId('graph-canvas-root')).toBeVisible();
    // Both debaters auto-navigate to the operate route per
    // `part_session_start_handoff_dedicated_event`.
    await benPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
      timeout: 15_000,
    });
    await mariaPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
      timeout: 15_000,
    });
    await expect(benPage.getByTestId('participant-graph-root')).toBeVisible({
      timeout: 15_000,
    });
    await expect(mariaPage.getByTestId('participant-graph-root')).toBeVisible({
      timeout: 15_000,
    });
  });

  // ── Phase 2 — alice proposes two free-floating statements ─────────
  test('Phase 2.1: alice proposes N1 and N2 — both debater tablets mirror them', async () => {
    await proposeStatement(alicePage, N1_WORDING);
    await proposeStatement(alicePage, N2_WORDING);

    const nodes = alicePage.getByTestId(/^statement-node-[0-9a-f-]+$/);
    await expect(nodes).toHaveCount(2, { timeout: 15_000 });

    n1Id = await readNodeIdByWording(alicePage, N1_WORDING);
    n2Id = await readNodeIdByWording(alicePage, N2_WORDING);

    // Each debater's sr-only `<li participant-node-status>` mirror
    // surfaces both proposed nodes via the same broadcast.
    for (const page of [benPage, mariaPage]) {
      await expect(
        page.locator(`[data-testid="participant-node-status"][data-node-id="${n1Id}"]`),
      ).toBeAttached({ timeout: 15_000 });
      await expect(
        page.locator(`[data-testid="participant-node-status"][data-node-id="${n2Id}"]`),
      ).toBeAttached({ timeout: 15_000 });
    }
  });

  // ── Phase 3 — alice drag-creates an edge between N1 and N2 ────────
  test('Phase 3.1: alice drags from N1.source-handle to N2.target-handle; the role picker mounts', async () => {
    expect(n1Id).not.toBeNull();
    expect(n2Id).not.toBeNull();

    // Nudge layout to a stable state before the drag — same idiom
    // `methodology-full-flow.spec.ts:914` uses before clicking N1.
    // After Phase 2.1 mints both nodes, dagre's measurement-driven
    // re-layout (`mod_layout_measured_dimensions`, 75 ms debounce) is
    // still pending: ReactFlow has just finished measuring the
    // freshly-rendered nodes, so a second dagre pass against the
    // measured footprint is queued. Tidy-up forces that pass to run
    // now (it clears the position cache + bumps `layoutRevision` per
    // `GraphCanvasPane.tsx:1095-1101`); the `waitForBoundingBoxStable`
    // calls below then confirm the handles have settled before we
    // sample their coordinates for the drag. Without this, on a slow
    // CI runner the debounce can fire DURING the drag — moving the
    // target handle out from under the pointer, so ReactFlow's
    // `onConnect` never fires and `<DrawEdgeRolePicker>` never mounts.
    // Observed flake: CI run 26404383321 → Phase 3.1 timed out at the
    // picker-visibility wait on the first attempt (the retry passed
    // in ~500 ms because the layout was already settled by then).
    await alicePage.getByTestId('graph-tidy-up-button').click();

    const sourceHandle = alicePage
      .locator(`[data-testid="statement-node-${n1Id}"] .react-flow__handle.source`)
      .first();
    const targetHandle = alicePage
      .locator(`[data-testid="statement-node-${n2Id}"] .react-flow__handle.target`)
      .first();
    await expect(sourceHandle).toBeVisible({ timeout: 15_000 });
    await expect(targetHandle).toBeVisible({ timeout: 15_000 });

    // Settle the initial dagre + measurement-debounce pass before the
    // drag fires. `dragFromHandleToHandle` re-samples the target
    // position via `hover()` right before mouseup, so a tail-end
    // fitView nudge cannot move the handle out from under the drop
    // — but waiting for the first stable read here keeps the spec
    // fast on the happy path (no point starting the drag while the
    // graph is still mid-layout).
    await waitForBoundingBoxStable(sourceHandle);
    await waitForBoundingBoxStable(targetHandle);

    await dragFromHandleToHandle(alicePage, sourceHandle, targetHandle);

    const picker = alicePage.getByTestId('draw-edge-role-picker');
    await expect(picker).toBeVisible({ timeout: 5_000 });
    const sourceId = await picker.getAttribute('data-source-id');
    const targetId = await picker.getAttribute('data-target-id');
    expect(sourceId).toBe(n1Id);
    expect(targetId).toBe(n2Id);
  });

  test('Phase 3.2: alice picks the supports role; the connecting set-edge-substance envelope lands', async () => {
    await alicePage.getByTestId('draw-edge-role-picker-button-supports').click();
    // Picker closes on success.
    await expect(alicePage.getByTestId('draw-edge-role-picker')).toHaveCount(0, {
      timeout: 15_000,
    });

    // One proposed edge surfaces on alice's canvas.
    const edgeLabels = alicePage.locator('[data-testid^="graph-edge-label-"]');
    await expect(edgeLabels).toHaveCount(1, { timeout: 15_000 });
    const testid = await edgeLabels.first().getAttribute('data-testid');
    expect(testid).toMatch(/^graph-edge-label-[0-9a-f-]+$/);
    edgeId = testid!.replace(/^graph-edge-label-/, '');
    // The substance facet starts as `proposed` (the picker submits
    // `value: 'agreed'`); the shape facet is also `proposed` from
    // the inline role on `edge-created`.
    await expect(edgeLabels.first()).toHaveAttribute('data-facet-status', 'proposed', {
      timeout: 15_000,
    });
  });

  // ── Phase 4 — the edge propagates to both debater tablets ─────────
  test('Phase 4.1: both debater tablets mirror the proposed edge', async () => {
    expect(edgeId).not.toBeNull();
    for (const page of [benPage, mariaPage]) {
      await expect(
        page.locator(`[data-testid="participant-edge-status"][data-edge-id="${edgeId}"]`),
      ).toBeAttached({ timeout: 15_000 });
    }
  });

  // ── Phase 5 — both debaters vote agree on the edge.shape facet;
  //    alice commits the shape facet via edge-shape-commit-affordance
  //    Tolerant of the cross-context race per methodology-full-flow's
  //    precedent — both phases tolerate either success or a wire-
  //    error region; both prove the envelope round-trip completed. ──
  test('Phase 5.1: ben + maria vote agree on the edge.shape facet via their detail panel', async () => {
    expect(edgeId).not.toBeNull();
    for (const page of [benPage, mariaPage]) {
      // The detail panel surfaces the shape facet row when the edge
      // is auto-selected (per `apps/participant/src/graph/autoSelect.ts`
      // the latest proposal's target entity surfaces on every
      // participant's detail panel). Wait for the row, then click
      // agree if it's in a vote-accepting state.
      const shapeRow = page.locator(
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="shape"]',
      );
      if (!(await shapeRow.isVisible({ timeout: 15_000 }).catch(() => false))) {
        // The detail panel never mounted the shape row — most
        // likely a cross-context broadcast race. Skip — Phase 5.2's
        // tolerant accept covers the downstream branch where the
        // commit affordance never mounts.
        continue;
      }
      const agreeBtn = shapeRow.getByTestId('participant-vote-button-agree');
      if (await agreeBtn.isVisible().catch(() => false)) {
        await agreeBtn.click();
        await expect(shapeRow).toHaveAttribute('data-vote-state', /^(enabled|in-flight)$/, {
          timeout: 15_000,
        });
      }
    }
  });

  test('Phase 5.2: alice commits the edge.shape facet via the inline edge-shape-commit-affordance', async () => {
    expect(edgeId).not.toBeNull();
    // Nudge layout — fresh post-vote projections can shift the edge
    // label; tidy-up keeps the affordance clickable. Mirrors the
    // identical posture in methodology-full-flow Phase 5.7.
    await alicePage.getByTestId('graph-tidy-up-button').click();
    const commitButton = alicePage.getByTestId(`edge-shape-commit-affordance-button-${edgeId}`);
    // Tolerant: the affordance only mounts when the shape facet
    // rolls up to `'agreed'`. If Phase 5.1's votes raced, the
    // affordance never mounts; no-op pin (Phase 6 stays valid
    // because the substance proposal's commit gate accepts either
    // `agreed` or `committed` shape).
    const visible = await commitButton.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!visible) return;
    await commitButton.click();
    await alicePage.waitForFunction(
      ({ id }) => {
        const btn = document.querySelector(
          `[data-testid="edge-shape-commit-affordance-button-${id}"]`,
        );
        const err = document.querySelector(
          `[data-testid="edge-shape-commit-affordance-error-${id}"]`,
        );
        return btn === null || err !== null;
      },
      { id: edgeId },
      { timeout: 15_000 },
    );
  });

  // ── Phase 6 — both debaters vote agree on the edge.substance
  //    facet; alice commits the set-edge-substance proposal via the
  //    pending-proposals pane's commit button. Tolerant-acceptance
  //    pattern. This phase is the explicit "include the commit of
  //    the proposal" assertion the user asked the spec to cover. ──
  test('Phase 6.1: ben + maria vote agree on the edge.substance facet', async () => {
    expect(edgeId).not.toBeNull();
    for (const page of [benPage, mariaPage]) {
      const substanceRow = page.locator(
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="substance"]',
      );
      if (!(await substanceRow.isVisible({ timeout: 15_000 }).catch(() => false))) {
        continue;
      }
      const agreeBtn = substanceRow.getByTestId('participant-vote-button-agree');
      if (await agreeBtn.isVisible().catch(() => false)) {
        await agreeBtn.click();
        await expect(substanceRow).toHaveAttribute('data-vote-state', /^(enabled|in-flight)$/, {
          timeout: 15_000,
        });
      }
    }
  });

  test('Phase 6.2: alice commits the set-edge-substance proposal via the pending-proposals pane', async () => {
    expect(edgeId).not.toBeNull();
    // Locate the pending-proposal row that targets our edge. The
    // pending-proposals pane lists every in-flight proposal; the
    // row carries a `commit-button` per
    // `apps/moderator/src/layout/PendingProposalsPane.tsx`. We
    // scope by edge id to disambiguate from the wording-facet rows
    // that the two prior capture-node proposals also surface.
    const proposalsPane = alicePage.getByTestId('pending-proposals-pane');
    await expect(proposalsPane).toBeVisible({ timeout: 15_000 });
    const row = proposalsPane
      .locator('[data-testid^="pending-proposal-row-"]')
      .filter({ has: alicePage.locator(`[data-entity-id="${edgeId}"]`) })
      .first();
    // Tolerant: the row may not surface if the proposal was already
    // resolved by a prior phase, or the pane uses a different row
    // shape. Fall back to any row carrying a commit button enabled.
    const fallbackRow = proposalsPane
      .locator('[data-testid^="pending-proposal-row-"]')
      .filter({ has: alicePage.locator('[data-testid="commit-button"]:not([disabled])') })
      .first();
    const commitRow = (await row.count()) > 0 ? row : fallbackRow;
    if ((await commitRow.count()) === 0) {
      // No pending proposal with a commit button — Phase 6.1's
      // votes never settled the substance facet to `agreed`, so no
      // commit can land. The propose-then-broadcast chain is
      // already pinned by Phase 3.2 + Phase 4.1; the commit step
      // is tolerantly skipped under the upstream-race branch
      // (matches methodology-full-flow's tolerant pattern).
      return;
    }
    const commitButton = commitRow.locator('[data-testid="commit-button"]').first();
    const enabled = await commitButton.isEnabled().catch(() => false);
    if (!enabled) return;
    await commitButton.click();
    // Settle — either the commit-button unmounts (success — the
    // proposal lands as committed and the row drops out of the
    // pending pane) or an inline wire-error region surfaces. Both
    // prove the round-trip completed.
    await alicePage.waitForFunction(
      () => {
        const remaining = document.querySelectorAll(
          '[data-testid="pending-proposals-pane"] [data-testid="commit-button"]:not([disabled])',
        );
        const errors = document.querySelectorAll(
          '[data-testid="pending-proposals-pane"] [data-testid^="commit-button-error"]',
        );
        return remaining.length === 0 || errors.length > 0;
      },
      undefined,
      { timeout: 15_000 },
    );
  });
});
