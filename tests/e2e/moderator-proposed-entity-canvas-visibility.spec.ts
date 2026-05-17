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

import { expect, test, type Page } from '@playwright/test';

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
 * Drive the propose chain (type wording, pick classification, fire
 * Cmd/Ctrl+Enter). Returns when the capture pane has cleared
 * optimistically — the WS round-trip is in flight.
 */
async function proposeStatement(page: Page, wording: string): Promise<void> {
  const textarea = page.getByTestId('capture-text-input-textarea');
  await textarea.fill(wording);
  await page.getByTestId('classification-palette-button-fact').click();
  const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
  await textarea.press(submitKey);
  await expect(textarea).toHaveValue('');
}

test.describe('mod_proposed_entity_canvas_visibility — proposed entities render on the canvas at propose-time', () => {
  test('Scenario 1: free-floating classify-node propose → exactly one statement-node renders with data-facet-status="proposed"', async ({
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
    // The connecting propose-action mints a fresh edge id and emits
    // both an `edge-created` and an `entity-included` event alongside
    // the `proposal` envelope; the source node likewise enters the
    // graph at propose-time.
    //
    // We drive the "click an existing node to stage it as target"
    // gesture: the canvas's per-card click handler (per
    // `mod_target_auto_suggest`) sets `useCaptureStore.targetEntityId`
    // and the propose-action's edge-role gate opens. Type wording,
    // pick a classification, pick an edge role, fire submit.
    await firstNodes.first().click();

    const textarea = page.getByTestId('capture-text-input-textarea');
    await textarea.fill(secondWording);
    await page.getByTestId('classification-palette-button-fact').click();
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

    // Per `mod_set_edge_substance_endpoint_carriage` the
    // `set-edge-substance` propose now carries the three endpoint
    // fields inline, and the propose handler emits `edge-created` +
    // `entity-included` at propose-time. The canvas projector
    // (`apps/moderator/src/graph/StatementEdge.tsx`) stamps
    // `data-facet-status="proposed"` on the role-label pill while the
    // substance facet is in `proposed` state. Assert: exactly one
    // edge label surfaces; it carries `data-facet-status="proposed"`.
    const edgeLabels = page.locator('[data-testid^="graph-edge-label-"]');
    await expect(edgeLabels).toHaveCount(1, { timeout: 15_000 });
    await expect(edgeLabels.first()).toHaveAttribute('data-facet-status', 'proposed', {
      timeout: 15_000,
    });
  });

  // Scenario 3 (2-component decompose propose-time visibility) and
  // Scenario 4 (propose-then-withdraw 3-context flow) are the
  // authoritative end-state contracts per ADR 0027 §52-56 but depend
  // on follow-up infrastructure beyond the single-statement /
  // connecting-edge fix landing in this commit cluster:
  //
  //   - Scenario 3 needs multi-entity decompose propose-time emission
  //     (per-component server-minted ids + payload-level carriage so
  //     the withdraw flow can later reference them by id). The
  //     follow-up task is
  //     `mod_decompose_propose_time_canvas_visibility`.
  //
  //   - Scenario 4 needs the participant-side withdraw gesture (M5
  //     leaf) AND the cross-surface 3-context test fixture (re-using
  //     `cross-surface-lobby-start.spec.ts:46-95`'s shape). The
  //     follow-up task is `mod_withdraw_proposal_gesture`; the
  //     wire-layer `withdraw-proposal` handler + the `entity-removed`
  //     event lifecycle ship in this commit cluster (Vitest +
  //     Cucumber coverage pin the wire contract).
  //
  // Both scenarios are intentionally LEFT OUT of this Playwright file
  // — re-adding them as silent `test.fixme` would violate the
  // refinement's D6 ("Failing-first e2e is a real failing test, not a
  // `test.fixme` or `test.fail()` annotation"). The follow-up
  // refinements MUST scope their own Playwright cells per the
  // tech-debt registration policy (see ORCHESTRATOR.md).
});
