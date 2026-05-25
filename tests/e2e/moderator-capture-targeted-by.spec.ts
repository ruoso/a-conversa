// End-to-end Playwright spec — moderator captures a new statement
// with the edge direction toggled to "is targeted by", inverting the
// connecting edge so the new node lands at the TARGET end and the
// pre-existing staged node sits at the SOURCE end. Verified across
// three real browser contexts (alice as moderator + ben as debater-A +
// maria as debater-B) so the cross-surface broadcast of the new node
// and the inverted edge lands on every tablet.
//
// Refinement: tasks/refinements/moderator-ui/mod_edge_direction_toggle.md
// TaskJuggler: moderator_ui.mod_capture_flow.mod_edge_direction_toggle
// ADRs:
//   - docs/adr/0008-e2e-framework-playwright.md
//   - docs/adr/0022-no-throwaway-verifications.md
//   - docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md
//
// **Why three real browser contexts.** ADR 0030 §4 emits `edge-created`
// + `entity-included(edge)` + `proposal` at propose-time so subscribers
// see the proposed edge immediately. The wire-level proof the direction
// toggle wires through end-to-end is that the edge's endpoints land
// inverted on the debater tablets' participant-edge-status mirror. The
// only way to verify that is to drive three independent browser
// contexts — same fixture posture as `moderator-draw-edge.spec.ts`
// and `methodology-full-flow.spec.ts`.
//
// **What this spec pins.**
//   - Phase 1 — three-context session setup; both debaters auto-handoff
//     to the operate route once alice clicks Enter.
//   - Phase 2 — alice proposes a free-floating "anchor" statement (N1);
//     both debater tablets mirror it via `participant-node-status`.
//   - Phase 3 — alice clicks N1; the chip auto-stages it; the direction
//     `<select>` mounts with the default value `targets`.
//   - Phase 4 — alice flips the select to `targeted-by`, picks the
//     `supports` role, types wording, and proposes. The capture pane
//     clears optimistically; alice's canvas surfaces a fresh node + a
//     proposed `supports` edge.
//   - Phase 5 — the inverted edge lands on both debater tablets'
//     `participant-edge-status` mirror; the recovered edge id matches
//     across surfaces; the source endpoint is N1 (the pre-existing
//     anchor) and the target endpoint is the freshly-captured node.

import { expect, test, type BrowserContext, type Page } from './fixtures/no-scrollbars';

import { authedContext } from './fixtures/authed-context';

const TOPIC = 'F1 inverted-direction capture — alice toggles "is targeted by".';
const ANCHOR_WORDING = 'Carbon pricing reduces aggregate emissions.';
const CAPTURED_WORDING =
  'A revenue-neutral dividend mechanism makes the policy politically durable.';

let aliceContext: BrowserContext;
let benContext: BrowserContext;
let mariaContext: BrowserContext;
let alicePage: Page;
let benPage: Page;
let mariaPage: Page;
let sessionId: string;
let anchorNodeId: string | null = null;
let capturedNodeId: string | null = null;
let edgeId: string | null = null;

/**
 * Resolve the rendered node id for a given wording off the moderator's
 * canvas. Same seam as `moderator-draw-edge.spec.ts`.
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
 * Free-floating capture-node propose driven from the capture textarea
 * + Cmd/Ctrl+Enter. Mirrors `moderator-draw-edge.spec.ts`'s helper.
 */
async function proposeStatement(page: Page, wording: string): Promise<void> {
  const textarea = page.getByTestId('capture-text-input-textarea');
  await textarea.fill(wording);
  const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
  await textarea.press(submitKey);
  await expect(textarea).toHaveValue('');
}

test.describe
  .serial('mod_edge_direction_toggle — moderator captures with the "is targeted by" direction; the inverted edge broadcasts to both debater tablets', () => {
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

  // ── Phase 1 — session setup ─────────────────────────────────────
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

  // ── Phase 2 — alice proposes the anchor statement ────────────────
  test('Phase 2.1: alice proposes the anchor statement; both debater tablets mirror it', async () => {
    await proposeStatement(alicePage, ANCHOR_WORDING);
    anchorNodeId = await readNodeIdByWording(alicePage, ANCHOR_WORDING);
    for (const page of [benPage, mariaPage]) {
      await expect(
        page.locator(`[data-testid="participant-node-status"][data-node-id="${anchorNodeId}"]`),
      ).toBeAttached({ timeout: 15_000 });
    }
  });

  // ── Phase 3 — alice stages the anchor + checks the direction
  //    select renders with the default value ──────────────────────
  test('Phase 3.1: alice clicks the anchor; the chip stages it; the direction select mounts with the default "targets" value', async () => {
    expect(anchorNodeId).not.toBeNull();
    // "Tidy up" first — auto-layout can leave the freshly proposed
    // card under stack obscurity (same precaution as
    // methodology-full-flow.spec.ts Phase 5.4).
    await alicePage.getByTestId('graph-tidy-up-button').click();
    // Click the node's wording to stage it as the chip's target.
    await alicePage.getByTestId(`statement-node-wording-${anchorNodeId}`).click();
    await expect(alicePage.getByTestId('capture-target-chip')).toBeVisible({
      timeout: 15_000,
    });
    const direction = alicePage.getByTestId('capture-target-chip-direction');
    await expect(direction).toBeVisible();
    await expect(direction).toHaveValue('targets');
  });

  // ── Phase 4 — alice flips the direction, picks supports, and
  //    captures a fresh statement that should land as the edge
  //    TARGET (the anchor lands as the edge SOURCE) ───────────────
  test('Phase 4.1: alice flips direction to targeted-by, picks supports, types wording, and proposes; the capture pane clears optimistically', async () => {
    const direction = alicePage.getByTestId('capture-target-chip-direction');
    await direction.selectOption('targeted-by');
    await expect(direction).toHaveValue('targeted-by');

    // Pick the supports role. The selector mounts when a target is
    // staged; aria-pressed flips true on click.
    await alicePage.getByTestId('edge-role-selector-button-supports').click();
    await expect(alicePage.getByTestId('edge-role-selector-button-supports')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Type the wording and propose. The capture pane clears
    // optimistically; the direction select returns to absent
    // (the staged target slot is reset).
    const textarea = alicePage.getByTestId('capture-text-input-textarea');
    await textarea.fill(CAPTURED_WORDING);
    await expect(alicePage.getByTestId('propose-action-button')).toBeEnabled();
    await alicePage.getByTestId('propose-action-button').click();
    await expect(textarea).toHaveValue('', { timeout: 15_000 });
  });

  test("Phase 4.2: alice's canvas surfaces the freshly-captured node + a proposed supports edge", async () => {
    expect(anchorNodeId).not.toBeNull();
    // Two distinct nodes are on the canvas: the anchor and the new
    // one. Resolve the fresh node by wording (the only one carrying
    // CAPTURED_WORDING).
    const nodes = alicePage.getByTestId(/^statement-node-[0-9a-f-]+$/);
    await expect(nodes).toHaveCount(2, { timeout: 15_000 });
    capturedNodeId = await readNodeIdByWording(alicePage, CAPTURED_WORDING);
    expect(capturedNodeId).toBeTruthy();
    expect(capturedNodeId).not.toBe(anchorNodeId);

    // One proposed `supports` edge surfaces on alice's canvas. Its
    // id is recoverable from the StatementEdge testid (per
    // `apps/moderator/src/graph/StatementEdge.tsx:223`).
    const edgeLabel = alicePage.locator(
      '[data-testid^="graph-edge-label-"][data-edge-role="supports"]',
    );
    await expect(edgeLabel.first()).toBeVisible({ timeout: 15_000 });
    const edgeTestid = await edgeLabel.first().getAttribute('data-testid');
    expect(edgeTestid).toMatch(/^graph-edge-label-[0-9a-f-]+$/);
    edgeId = edgeTestid!.replace(/^graph-edge-label-/, '');
    expect(edgeId).toBeTruthy();
  });

  // ── Phase 5 — debater mirrors + endpoint inversion proof ───────
  test('Phase 5.1: both debater tablets mirror the freshly-captured node and the inverted-direction edge', async () => {
    expect(capturedNodeId).not.toBeNull();
    expect(edgeId).not.toBeNull();

    for (const page of [benPage, mariaPage]) {
      await expect(
        page.locator(`[data-testid="participant-node-status"][data-node-id="${capturedNodeId}"]`),
      ).toBeAttached({ timeout: 15_000 });
      await expect(
        page.locator(`[data-testid="participant-edge-status"][data-edge-id="${edgeId}"]`),
      ).toBeAttached({ timeout: 15_000 });
    }
  });

  test("Phase 5.2: the broadcast `edge-created` event on alice's WS store carries inverted endpoints — anchor is SOURCE, fresh node is TARGET", async () => {
    // The capture-pane propose envelope was constructed with the
    // direction slice set to `targeted-by`, so
    // `buildCaptureNodeProposal` swapped `source_node_id` /
    // `target_node_id`. The server's structural-events builder for
    // the `capture-node` arm passes the inline endpoints through to
    // the `edge-created` event verbatim (see
    // apps/server/src/methodology/handlers/propose.ts ~L1839-1854).
    // Probe the moderator's WS store directly via the dev-only
    // `window.__aConversaWsStore` seam to confirm the wire shape.
    expect(edgeId).not.toBeNull();
    expect(anchorNodeId).not.toBeNull();
    expect(capturedNodeId).not.toBeNull();

    const endpoints = await alicePage.evaluate(
      ({ sid, eid }) => {
        const store = (
          window as unknown as {
            __aConversaWsStore?: {
              getState(): {
                sessionState: Record<
                  string,
                  {
                    events: Array<{
                      kind: string;
                      payload?: {
                        edge_id?: string;
                        source_node_id?: string;
                        target_node_id?: string;
                      };
                    }>;
                  }
                >;
              };
            };
          }
        ).__aConversaWsStore;
        const session = store?.getState().sessionState[sid];
        const events = session?.events ?? [];
        const ev = events.find((e) => e.kind === 'edge-created' && e.payload?.edge_id === eid);
        return {
          found: ev !== undefined,
          sourceId: ev?.payload?.source_node_id ?? null,
          targetId: ev?.payload?.target_node_id ?? null,
        };
      },
      { sid: sessionId, eid: edgeId! },
    );

    expect(endpoints.found).toBe(true);
    // Inverted: the pre-existing anchor is the SOURCE; the just-
    // captured node is the TARGET.
    expect(endpoints.sourceId).toBe(anchorNodeId);
    expect(endpoints.targetId).toBe(capturedNodeId);
  });
});
