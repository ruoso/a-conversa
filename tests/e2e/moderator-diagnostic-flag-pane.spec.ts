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
