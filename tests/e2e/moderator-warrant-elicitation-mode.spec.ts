// End-to-end Playwright spec — warrant-elicitation context-menu entry
// renders in its methodology-gated DISABLED state against a freshly-
// proposed node (the disputation gate fails because substance is
// 'proposed', not 'disputed' / 'meta-disagreement').
//
// Refinement: tasks/refinements/moderator-ui/mod_warrant_elicitation_mode.md
// (Decisions §D8 + Acceptance §9)
// ADRs:
//   - docs/adr/0008-e2e-framework-playwright.md
//   - docs/adr/0022-no-throwaway-verifications.md
//   - docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
// TaskJuggler: moderator_ui.mod_diagnostic_flow.mod_warrant_elicitation_mode
//
// **What this spec pins.** Per Decisions §D8, this leaf lands a thin
// inline Playwright spec that asserts the disabled-state contract for
// BOTH new F3 diagnostic-test context-menu items
// (`run-operationalization-test` + `run-warrant-elicitation-test`) so
// the inherited-debt count on `mod_pw_diagnostic_flow` does NOT grow
// to four. The disabled-state surface IS reachable today end-to-end:
// log in, propose a node, right-click it, observe the two diagnostic-
// test items rendered with `aria-disabled="true"` because the
// substance facet is `'proposed'` (gate fails).
//
// **What this spec deliberately does NOT pin.** The enabled-state path
// (right-click a node whose substance is `'disputed'` /
// `'meta-disagreement'`, pick the item, observe the bottom-strip swap
// to the matching capture panel) remains deferred to
// `mod_pw_diagnostic_flow` — it still requires the `set-node-substance`
// propose-action UI which is not yet shipped (same blocker the three
// sibling F3 refinements share).
//
// **Locale.** en-US only; cross-locale matrix is covered at the
// catalog level (per `tests/e2e/moderator-capture.spec.ts`).

import { expect, test, type Page } from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';
import { seedParticipants } from './fixtures/wsStoreSeed';

const TEST_USERNAME = 'alice';

// Synthetic debater user ids for the moderator-only scenarios that
// use the WS-store seed to open the lobby gate. Mirrors
// `moderator-capture.spec.ts` and
// `moderator-proposed-entity-canvas-visibility.spec.ts`.
const GATE_DEBATER_A_USER_ID = '00000000-0000-4000-8000-0000000000a3';
const GATE_DEBATER_B_USER_ID = '00000000-0000-4000-8000-0000000000b3';

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
 * the caller can compose follow-on assertions. Mirrors the helper of
 * the same name in `moderator-proposed-entity-canvas-visibility.spec.ts`.
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
 * Drive the propose chain (type wording, fire Cmd/Ctrl+Enter).
 * Returns when the capture pane has cleared optimistically — the WS
 * round-trip is in flight. Per `pf_mod_capture_pane_wording_only`
 * (ADR 0030 §1) the capture-pane gesture is wording-only — the
 * classification palette is no longer mounted in the bottom strip,
 * and the propose-action gate no longer requires a classification
 * pick.
 */
async function proposeStatement(page: Page, wording: string): Promise<void> {
  const textarea = page.getByTestId('capture-text-input-textarea');
  await textarea.fill(wording);
  const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
  await textarea.press(submitKey);
  await expect(textarea).toHaveValue('');
}

test.describe('mod_warrant_elicitation_mode — diagnostic-test menu items render disabled against a freshly-proposed node', () => {
  test('Scenario 1: right-clicking a freshly-proposed node opens the context menu with the warrant-elicitation + operationalization items both visible and aria-disabled="true" (the disputation gate fails)', async ({
    page,
  }) => {
    const wording = 'The proposed minimum wage would raise prices for everyone.';
    await moderatorReachOperate(page, 'Warrant elicitation disabled-state context-menu check.');

    // Propose a free-floating `classify-node` statement so the canvas
    // has a right-clickable node. The propose handler emits
    // `node-created` + `entity-included` at propose-time per
    // `mod_proposed_entity_canvas_visibility`; the node renders with
    // `data-facet-status="proposed"`. Substance facet stays in
    // `'proposed'` state — the disputation gate (`disputationOutcome
    // (substance) === 'claim'`) does NOT match `'proposed'`, so both
    // diagnostic-test items render disabled.
    await proposeStatement(page, wording);

    const nodes = page.getByTestId(/^statement-node-[0-9a-f-]+$/);
    await expect(nodes).toHaveCount(1, { timeout: 15_000 });
    const node = nodes.first();
    await expect(node).toHaveAttribute('data-facet-status', 'proposed', { timeout: 15_000 });

    // Right-click the node → assert the context menu opens.
    await node.click({ button: 'right' });
    await expect(page.getByTestId('graph-context-menu')).toBeVisible();

    // --- Warrant-elicitation item (the leaf under test) ---
    const warrantItem = page.getByTestId('graph-context-menu-item-run-warrant-elicitation-test');
    await expect(warrantItem).toBeVisible();
    await expect(warrantItem).toHaveAttribute('aria-disabled', 'true');

    // --- Operationalization item (sibling F3 diagnostic-test item) ---
    // Pinning the operationalization item's disabled state in the same
    // spec closes the disabled-state portion of `mod_pw_diagnostic_flow`'s
    // inherited debt for BOTH F3 mode-entry items in one place, per
    // Decisions §D8.
    const operationalizationItem = page.getByTestId(
      'graph-context-menu-item-run-operationalization-test',
    );
    await expect(operationalizationItem).toBeVisible();
    await expect(operationalizationItem).toHaveAttribute('aria-disabled', 'true');

    // Clicking the disabled warrant-elicitation item must NOT swap the
    // bottom strip into warrant-elicitation mode. The
    // `data-testid="warrant-elicitation-capture-panel"` must remain
    // absent from the DOM after the click (the context-menu shell skips
    // `onSelect` on disabled items, and the underlying `<button
    // disabled>` blocks the click anyway — but we pin the contract here
    // so a future regression of either layer is caught).
    await warrantItem.click({ force: true });
    await expect(page.getByTestId('warrant-elicitation-capture-panel')).toHaveCount(0);
  });
});
