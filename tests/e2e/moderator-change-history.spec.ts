// End-to-end Playwright spec — the moderator's change-history sidebar
// pane is route-rendered at `Operate.tsx`'s `changeHistorySlot`, and a
// small ordered event sequence injected via the dev-only
// `window.__aConversaWsStore` backdoor renders newest-first (highest
// `sequence` at the top).
//
// Refinement: tasks/refinements/moderator-ui/mod_history_scroller.md
//             (Acceptance §6, Decision §D6 — e2e is IN SCOPE, not
//             deferred; only the live-server full-log content assertion is
//             inherited by `mod_pw_full_session_run`.)
// ADRs:
//   - docs/adr/0008-e2e-framework-playwright.md
//   - docs/adr/0022-no-throwaway-verifications.md
//   - docs/adr/0021-event-envelope-discriminated-union-with-zod.md
// TaskJuggler: moderator_ui.mod_change_history_pane.mod_history_scroller
//
// **What this spec pins.** The pane mounts at the right-sidebar's
// `change-history` slot (wired by this task), the REST prefetch + WS
// overlay path reaches a rendered list, and the WS-seeded events render
// in reverse-chronological (`sequence` descending) order. The seeded
// events continue from the store's high-water mark, so they carry the
// highest sequences in the merged log — the top row's `data-sequence`
// matches the highest seeded.
//
// **Single locale (en-US).** Cross-locale label resolution is pinned at
// the catalog-parity layer (`change-history.test.ts`); this spec asserts
// the structural seams, which are locale-independent.

import { expect, test, type Page } from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';
import { seedParticipants, seedWsStore } from './fixtures/wsStoreSeed';

const TEST_USERNAME = 'alice';

// Synthetic debater user ids that open the lobby gate via the WS seam.
// Mirrors `moderator-diagnostic-flag-pane.spec.ts`.
const GATE_DEBATER_A_USER_ID = '00000000-0000-4000-8000-0000000000a1';
const GATE_DEBATER_B_USER_ID = '00000000-0000-4000-8000-0000000000b1';

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

/** Drive the create-session → invite → seed-gate → operate chain. */
async function reachOperate(page: Page, topic: string): Promise<string> {
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
  return sessionId;
}

/** Read the store's per-session high-water mark — the highest sequence
 *  applied (the last seeded event's sequence after `seedWsStore`). */
async function lastAppliedSequence(page: Page, sessionId: string): Promise<number> {
  return page.evaluate((sid) => {
    const store = (
      window as unknown as {
        __aConversaWsStore?: {
          getState(): { sessionState: Record<string, { lastAppliedSequence: number }> };
        };
      }
    ).__aConversaWsStore;
    if (store === undefined) throw new Error('window.__aConversaWsStore is undefined');
    return store.getState().sessionState[sid]?.lastAppliedSequence ?? 0;
  }, sessionId);
}

test.describe('moderator change-history pane — reverse-chronological scroller', () => {
  test('seeded events render newest-first with the highest sequence on top', async ({ page }) => {
    const sessionId = await reachOperate(page, 'Change history — reverse-chronological order.');

    // Inject an ordered event sequence. `seedWsStore` assigns ascending
    // sequences continuing from the store's high-water mark, so the last
    // node gets the highest sequence.
    await seedWsStore(page, {
      sessionId,
      nodes: [
        { nodeId: 'hist-node-a', wording: 'First statement' },
        { nodeId: 'hist-node-b', wording: 'Second statement' },
        { nodeId: 'hist-node-c', wording: 'Third statement' },
      ],
    });
    const topSeq = await lastAppliedSequence(page, sessionId);

    // The sidebar section + the pane body are both present.
    await expect(page.getByTestId('right-sidebar-pane-change-history')).toBeVisible();
    const pane = page.getByTestId('change-history-pane');
    await expect(pane).toBeVisible();

    const rows = pane.getByTestId('change-history-row');
    // At least the three seeded events render (the real catch-up log may
    // add a few lower-sequence rows below them).
    await expect(rows.first()).toBeVisible();

    // The top row is the highest seeded sequence (newest-first).
    await expect(rows.first()).toHaveAttribute('data-sequence', String(topSeq));

    // The full rendered list is in strictly-descending sequence order.
    const sequences = await rows.evaluateAll((els) =>
      els.map((el) => Number(el.getAttribute('data-sequence'))),
    );
    expect(sequences.length).toBeGreaterThanOrEqual(3);
    const sortedDesc = [...sequences].sort((a, b) => b - a);
    expect(sequences).toEqual(sortedDesc);
  });

  test('rows render a per-row payload summary (free text + localized enum)', async ({ page }) => {
    // `mod_history_event_summary` Acceptance §5 / Decision §D6 — e2e is IN
    // SCOPE: seed a free-text `node-created` (verbatim wording) and an
    // enum-driven `vote` (localized choice), then assert each row's
    // `change-history-row-summary`. Single locale (en-US), matching the
    // spec header's convention.
    const sessionId = await reachOperate(page, 'Change history — per-row payload summary.');

    await seedWsStore(page, {
      sessionId,
      nodes: [{ nodeId: 'sum-node-a', wording: 'Markets allocate capital efficiently' }],
      votes: [
        {
          entityKind: 'node',
          entityId: 'sum-node-a',
          facet: 'substance',
          participant: GATE_DEBATER_A_USER_ID,
          choice: 'dispute',
        },
      ],
    });

    const pane = page.getByTestId('change-history-pane');
    await expect(pane).toBeVisible();

    // Free-text summary: the node row shows the wording verbatim.
    const nodeRow = pane
      .locator('[data-testid="change-history-row"][data-event-kind="node-created"]')
      .first();
    await expect(nodeRow.getByTestId('change-history-row-summary')).toHaveText(
      'Markets allocate capital efficiently',
    );

    // Enum summary: the vote row shows the localized (en-US) choice label
    // (`summary.choice.dispute` → "Dispute").
    const voteRow = pane
      .locator('[data-testid="change-history-row"][data-event-kind="vote"]')
      .first();
    await expect(voteRow.getByTestId('change-history-row-summary')).toHaveText('Dispute');
  });

  test('activating a change-history row flashes the affected graph node', async ({ page }) => {
    // `mod_history_click_to_flash` Acceptance §15 — e2e is IN SCOPE: the
    // pane AND the canvas are both route-rendered, so activating a row
    // flashes the entity it touched. Seed a `node-created` (+ an
    // `edge-created` so the surrounding log is realistic); the most-recent
    // node (`flash-node-b`) owns the topmost `node-created` row. Click that
    // row's activation button and assert the matching ReactFlow node card
    // stamps `data-flashing="true"`. Single locale (en-US) — the affordance
    // is non-textual, so no cross-locale assertion is needed.
    const sessionId = await reachOperate(page, 'Change history — click-to-flash.');

    await seedWsStore(page, {
      sessionId,
      nodes: [
        { nodeId: 'flash-node-a', wording: 'Flash source statement' },
        { nodeId: 'flash-node-b', wording: 'Flash target statement' },
      ],
      edges: [{ edgeId: 'flash-edge-1', source: 'flash-node-a', target: 'flash-node-b' }],
    });

    const pane = page.getByTestId('change-history-pane');
    await expect(pane).toBeVisible();

    // The seeded node card is on the canvas, not yet flashing.
    const nodeCard = page.getByTestId('statement-node-flash-node-b');
    await expect(nodeCard).toBeVisible();
    await expect(nodeCard).not.toHaveAttribute('data-flashing', 'true');

    // The topmost `node-created` row is `flash-node-b` (highest seeded
    // sequence among node-created events). Activate it.
    const nodeRow = pane
      .locator('[data-testid="change-history-row"][data-event-kind="node-created"]')
      .first();
    await nodeRow.getByTestId('change-history-row-activate').click();

    // The matching ReactFlow node flashes (the pulse self-clears after a
    // short delay, but `toHaveAttribute` polls fast enough to catch it).
    await expect(nodeCard).toHaveAttribute('data-flashing', 'true');
  });
});
