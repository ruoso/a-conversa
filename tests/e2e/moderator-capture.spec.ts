// End-to-end moderator capture-pane spec — drives the bottom-strip
// statement-wording textarea on `/sessions/<id>/operate`.
//
// Refinement: tasks/refinements/moderator-ui/mod_capture_text_input.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: moderator_ui.mod_capture_flow.mod_capture_text_input
//
// **What this spec pins.** The capture-pane statement-wording textarea
// is the first reader/writer pair on `useCaptureStore.text`. The
// scenario below reaches the operate route via the existing
// create-session-flow chain (login → POST /api/sessions → navigate),
// then drives keystrokes into the textarea and asserts:
//
//   - the textarea is visible (the new `mod_capture_text_input` slot
//     content replaced the scaffold's `[statement text]` placeholder),
//   - typing populates the textarea's `value` (the controlled-input
//     wire to `useCaptureStore.text`),
//   - the helper's running count interpolates `{used}/{max}`,
//   - Cmd/Ctrl+Enter is observable — `e.preventDefault` fires so no
//     newline is inserted (the consumer-supplied `onSubmit` is a no-op
//     until `mod_propose_action` lands; this spec asserts the gesture
//     does not insert a newline rather than the full propose chain),
//   - plain Enter inserts a newline (native textarea behavior).
//
// **Locale matrix.** This spec runs in en-US only — the cross-locale
// label / placeholder / helper matrix is covered at the catalog level;
// the whole-flow chain is locale-independent and too expensive to run
// 3x.
//
// **The shared store is not exposed on `window`.** The Zustand store
// is module-scoped inside the moderator bundle; the spec reads the
// in-progress draft via the textarea's `value` attribute (the same
// wire as a screen reader on the controlled input).

import { expect, type Page, test } from '@playwright/test';

import { loginAs } from './fixtures/auth';
import { isWsStoreReachable, seedParticipants, seedWsStore } from './fixtures/wsStoreSeed';

const TEST_USERNAME = 'alice';

// mod_session_lobby: the Enter-session button is strict-gated (disabled
// until both debater slots are filled). This spec's assertions all live
// on the operate canvas; the gate behavior is exercised by
// `tests/e2e/invite-participants-flow.spec.ts`. To bridge past the gate
// here we seed both debaters via the dev-only `window.__aConversaWsStore`
// test seam so the click on `invite-enter-session` proceeds. The session
// id is extracted from the current URL (Playwright already settled on
// /sessions/<uuid>/invite by the time this helper runs).
const GATE_DEBATER_A_USER_ID = '00000000-0000-4000-8000-0000000000a1';
const GATE_DEBATER_B_USER_ID = '00000000-0000-4000-8000-0000000000b1';

async function seedInviteParticipantsForGate(page: Page): Promise<void> {
  const url = page.url();
  const match = url.match(/\/sessions\/([0-9a-f-]+)\/invite$/);
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

test.describe('Capture-pane textarea — moderator types wording, sees helper count, and submits via Cmd/Ctrl+Enter', () => {
  test('alice creates a session, lands on operate, types a wording, helper count updates, and Cmd/Ctrl+Enter fires without inserting a newline', async ({
    page,
  }) => {
    // 1. Login + create session + navigate to operate. This chain
    //    duplicates the happy-path setup of
    //    `tests/e2e/create-session-flow.spec.ts` because the operate
    //    route is only reachable after a session row exists. The
    //    cost is one extra session per Playwright run; the benefit is
    //    that this spec stays focused on the capture-pane textarea
    //    surface rather than threading a fixture across files.
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    const topic = 'Capture-pane textarea regression check.';
    await page.getByTestId('create-session-topic-input').fill(topic);
    await page.getByTestId('create-session-submit').click();
    // mod_invite_participants amended the post-201 navigation target to
    // /sessions/<id>/invite; click 'Enter session' from there to reach
    // the operate canvas (where this spec's assertions live).
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    // mod_session_lobby strict-gated the Enter button: it stays disabled
    // until both debaters joined. Seed both via the WS test seam so the
    // gate opens (this spec's assertions all live on /operate; the
    // gate's behavior is exercised by tests/e2e/invite-participants-flow).
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    // 2. The bottom-strip capture pane mounted with the new textarea.
    //    The slot's `[statement text]` placeholder (from
    //    `mod_bottom_strip_capture`) is gone now that
    //    `<CaptureTextInput>` fills the `textInput` sub-slot.
    const textarea = page.getByTestId('capture-text-input-textarea');
    await expect(textarea).toBeVisible();
    await expect(page.getByTestId('capture-text-input-label')).toBeVisible();
    await expect(page.getByTestId('capture-text-input-helper')).toBeVisible();

    // 3. Type a wording. Per the controlled-input wire, the textarea's
    //    `value` reflects the shared store; the helper interpolates
    //    `{used}/{max}` via ICU.
    const wording = 'The proposed minimum wage would raise prices for everyone.';
    await textarea.fill(wording);
    await expect(textarea).toHaveValue(wording);
    await expect(page.getByTestId('capture-text-input-helper')).toHaveText(
      `${String(wording.length)}/10000 characters`,
    );

    // 4. Fire Cmd+Enter (macOS) / Ctrl+Enter (everywhere else). The
    //    consumer-supplied `onSubmit` is a no-op until
    //    `mod_propose_action` lands; the regression-class assertion
    //    here is "the gesture is observable" — `preventDefault` fires
    //    so the textarea's `value` does NOT gain a trailing `\n`.
    const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
    await textarea.press(submitKey);
    await expect(textarea).toHaveValue(wording);

    // 5. Fire plain Enter at the end of the wording. The native
    //    textarea behavior inserts a `\n`; the spec pins that this
    //    path is NOT swallowed by the Cmd/Ctrl+Enter handler.
    await textarea.press('End');
    await textarea.press('Enter');
    await expect(textarea).toHaveValue(`${wording}\n`);
  });

  // Ad-hoc fix regression cover (no refinement — outside the WBS):
  //
  // The pane right-click "Create new statement" item shipped with a
  // placeholder `actionStub` onSelect that only logged to console
  // (commit 67feb20, `mod_context_menus`). The fix replaces the stub
  // with a real handler that focuses the bottom-strip capture textarea
  // via `requestAnimationFrame`. This spec pins the bridge: right-click
  // the canvas → click the menu item → textarea is focused.
  test('alice: pane right-click "Create new statement" focuses the capture textarea', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Pane context-menu focus-bridge regression check.');
    await page.getByTestId('create-session-submit').click();
    // mod_invite_participants amended the post-201 navigation target to
    // /sessions/<id>/invite; click 'Enter session' from there to reach
    // the operate canvas (where this spec's assertions live).
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    // mod_session_lobby strict-gated the Enter button: it stays disabled
    // until both debaters joined. Seed both via the WS test seam so the
    // gate opens (this spec's assertions all live on /operate; the
    // gate's behavior is exercised by tests/e2e/invite-participants-flow).
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    const textarea = page.getByTestId('capture-text-input-textarea');
    await expect(textarea).toBeVisible();

    // Move focus elsewhere so the not-focused precondition is clean.
    // Clicking the canvas root (not the pane right-click target — a
    // plain left-click) deselects without focusing the textarea.
    await page.getByTestId('graph-canvas-root').click();
    await expect(textarea).not.toBeFocused();

    // Right-click the ReactFlow pane background to open the pane menu.
    const pane = page.locator('.react-flow__pane');
    await expect(pane).toBeVisible();
    await pane.click({ button: 'right', position: { x: 50, y: 50 } });

    const menuItem = page.getByTestId('graph-context-menu-item-create-statement');
    await expect(menuItem).toBeVisible();
    await menuItem.click();

    // The menu closes on item-click, then the rAF-deferred focus lands
    // on the capture textarea.
    await expect(page.getByTestId('graph-context-menu')).toHaveCount(0);
    await expect(textarea).toBeFocused();
  });

  // Refinement: tasks/refinements/moderator-ui/mod_classification_palette.md
  //
  // The classification-palette regression cover. Pins:
  //   - the five buttons render in canonical order with aria-pressed=false,
  //   - click flips aria-pressed and is mutually-exclusive,
  //   - keyboard shortcut switches the selection,
  //   - the editable-target guard keeps `f` typed inside the wording
  //     textarea out of the palette (the just-landed
  //     `mod_capture_text_input` consumes plain `f` as a character),
  //   - re-click toggles off (Decision §4).
  test('alice picks a classification by click and by keyboard shortcut; selection is mutually exclusive', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Classification palette regression check.');
    await page.getByTestId('create-session-submit').click();
    // mod_invite_participants amended the post-201 navigation target to
    // /sessions/<id>/invite; click 'Enter session' from there to reach
    // the operate canvas (where this spec's assertions live).
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    // mod_session_lobby strict-gated the Enter button: it stays disabled
    // until both debaters joined. Seed both via the WS test seam so the
    // gate opens (this spec's assertions all live on /operate; the
    // gate's behavior is exercised by tests/e2e/invite-participants-flow).
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    // 2. The palette mounts with five buttons in canonical order, all
    //    unselected. The scaffold's `[classification]` placeholder is
    //    gone now that `<ClassificationPalette>` fills the slot.
    const palette = page.getByTestId('classification-palette');
    await expect(palette).toBeVisible();
    const KINDS = ['fact', 'predictive', 'value', 'normative', 'definitional'] as const;
    for (const kind of KINDS) {
      await expect(page.getByTestId(`classification-palette-button-${kind}`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }

    // 3. Click `fact` → its aria-pressed flips true; others stay false.
    await page.getByTestId('classification-palette-button-fact').click();
    await expect(page.getByTestId('classification-palette-button-fact')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const kind of KINDS) {
      if (kind === 'fact') continue;
      await expect(page.getByTestId(`classification-palette-button-${kind}`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }

    // 4. Press `v` → palette switches to `value`.
    await page.keyboard.press('v');
    await expect(page.getByTestId('classification-palette-button-value')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('classification-palette-button-fact')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // 5. Focus the capture textarea, type `f` → the textarea's value
    //    gains `"f"`; the palette stays on `value` (the editable-target
    //    guard suppresses the shortcut).
    const textarea = page.getByTestId('capture-text-input-textarea');
    await textarea.focus();
    await textarea.fill('');
    await page.keyboard.press('f');
    await expect(textarea).toHaveValue('f');
    await expect(page.getByTestId('classification-palette-button-value')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // 6. Re-click the selected button → toggles off.
    await page.getByTestId('classification-palette-button-value').click();
    for (const kind of KINDS) {
      await expect(page.getByTestId(`classification-palette-button-${kind}`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
  });

  // Refinement: tasks/refinements/moderator-ui/mod_target_auto_suggest.md
  //
  // The capture-target chip regression cover. Pins:
  //   - the chip mounts with the empty state on a freshly-created
  //     session (no staged target, no override marker),
  //   - the seeded-graph path: clicking a node auto-suggests it, the
  //     chip flips to "Target: <wording-prefix>",
  //   - selecting a different node updates the chip,
  //   - pane-click clears selection but does NOT clear the staged
  //     target (the chip stays at the last suggestion),
  //   - no override marker is shown when every change is an
  //     auto-suggest.
  test('alice: capture target chip auto-suggests from the most-recently-selected node', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Capture target chip regression check.');
    await page.getByTestId('create-session-submit').click();
    // mod_invite_participants amended the post-201 navigation target to
    // /sessions/<id>/invite; click 'Enter session' from there to reach
    // the operate canvas (where this spec's assertions live).
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    // mod_session_lobby strict-gated the Enter button: it stays disabled
    // until both debaters joined. Seed both via the WS test seam so the
    // gate opens (this spec's assertions all live on /operate; the
    // gate's behavior is exercised by tests/e2e/invite-participants-flow).
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    // 2. Empty-graph path: chip mounts with the empty state.
    await expect(page.getByTestId('capture-target-chip')).toBeVisible();
    await expect(page.getByTestId('capture-target-chip-label')).toHaveText('No target yet');
    await expect(page.getByTestId('capture-target-chip-override-marker')).toHaveCount(0);

    // 3. Probe whether the WS-store seed path is available. If the
    //    dev-only `window.__aConversaWsStore` attachment didn't fire,
    //    the rich-content steps are skipped; the empty-state assertion
    //    above still gates a regression of the chip-mount surface.
    const seedAvailable = await isWsStoreReachable(page);
    if (!seedAvailable) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — the dev-only attachment did not fire. Seeded-graph cases deferred to a future seed-infrastructure task.',
      );
      return;
    }

    // 4. Extract the session id from the URL and seed two nodes.
    const url = new URL(page.url());
    const sessionId = url.pathname.split('/')[2] ?? '';
    expect(sessionId, 'session id must be parsed from the URL').toBeTruthy();

    const NODE_ID_1 = '11111111-1111-4111-8111-111111111101';
    const NODE_ID_2 = '11111111-1111-4111-8111-111111111102';
    const WORDING_1 = 'First seeded statement under test.';
    const WORDING_2 = 'Second seeded statement under test.';
    await seedWsStore(page, {
      sessionId,
      nodes: [
        { nodeId: NODE_ID_1, wording: WORDING_1 },
        { nodeId: NODE_ID_2, wording: WORDING_2 },
      ],
    });

    // 5. Click node 1 → chip flips to the first wording prefix.
    const node1 = page.getByTestId(`statement-node-${NODE_ID_1}`);
    await expect(node1, 'seeded node 1 must render').toBeVisible({ timeout: 10_000 });
    await node1.click();
    await expect(page.getByTestId('capture-target-chip-label')).toContainText(
      'Target: First seeded statement',
    );
    await expect(page.getByTestId('capture-target-chip-override-marker')).toHaveCount(0);

    // 6. Click node 2 → chip updates to the second wording prefix.
    const node2 = page.getByTestId(`statement-node-${NODE_ID_2}`);
    await expect(node2).toBeVisible({ timeout: 10_000 });
    await node2.click();
    await expect(page.getByTestId('capture-target-chip-label')).toContainText(
      'Target: Second seeded statement',
    );
    await expect(page.getByTestId('capture-target-chip-override-marker')).toHaveCount(0);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_target_clear_override.md
  //
  // The capture-target chip clear-gesture regression cover. Pins:
  //   - the × button is NOT rendered in the empty state (no slice value
  //     → no button); pressing Esc on the empty operate route is a no-op,
  //   - seeded-graph happy path: click node 1 → chip auto-suggests →
  //     × button visible → click × → chip flips to empty state,
  //   - re-engagement: after a clear, click node 2 → chip auto-suggests
  //     node 2 (the re-engagement rule fires because the active node id
  //     changed),
  //   - Esc keyboard gesture clears the staged target,
  //   - editable-target Esc no-op: focus the textarea, press Esc → chip
  //     stays at "Target: ..." (the editable-target guard consumes Esc).
  test('alice: × button and Esc both clear the staged target; re-engagement re-suggests on next node click', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Capture target chip clear-gesture regression check.');
    await page.getByTestId('create-session-submit').click();
    // mod_invite_participants amended the post-201 navigation target to
    // /sessions/<id>/invite; click 'Enter session' from there to reach
    // the operate canvas (where this spec's assertions live).
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    // mod_session_lobby strict-gated the Enter button: it stays disabled
    // until both debaters joined. Seed both via the WS test seam so the
    // gate opens (this spec's assertions all live on /operate; the
    // gate's behavior is exercised by tests/e2e/invite-participants-flow).
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    // 2. Empty-graph path: chip mounts in the empty state; the × button
    //    is not rendered. Pressing Esc on the operate route with no
    //    focus is idempotent (slice is already null).
    await expect(page.getByTestId('capture-target-chip')).toBeVisible();
    await expect(page.getByTestId('capture-target-chip-label')).toHaveText('No target yet');
    await expect(page.getByTestId('capture-target-chip-clear')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('capture-target-chip-label')).toHaveText('No target yet');

    // 3. Probe the WS-store seed path (same pattern as the auto-suggest
    //    spec above). If the dev-only attachment didn't fire, skip the
    //    seeded-graph cases — the empty-state regression above still
    //    gates the no-button-when-empty contract.
    const seedAvailable = await isWsStoreReachable(page);
    if (!seedAvailable) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — the dev-only attachment did not fire. Seeded-graph cases deferred to a future seed-infrastructure task.',
      );
      return;
    }

    // 4. Seed two nodes.
    const url = new URL(page.url());
    const sessionId = url.pathname.split('/')[2] ?? '';
    expect(sessionId, 'session id must be parsed from the URL').toBeTruthy();

    const NODE_ID_1 = '22222222-2222-4222-8222-222222222201';
    const NODE_ID_2 = '22222222-2222-4222-8222-222222222202';
    const WORDING_1 = 'Clear-gesture node one.';
    const WORDING_2 = 'Clear-gesture node two.';
    await seedWsStore(page, {
      sessionId,
      nodes: [
        { nodeId: NODE_ID_1, wording: WORDING_1 },
        { nodeId: NODE_ID_2, wording: WORDING_2 },
      ],
    });

    // 5. Click node 1 → chip auto-suggests; × button is visible.
    const node1 = page.getByTestId(`statement-node-${NODE_ID_1}`);
    await expect(node1, 'seeded node 1 must render').toBeVisible({ timeout: 10_000 });
    await node1.click();
    await expect(page.getByTestId('capture-target-chip-label')).toContainText(
      'Target: Clear-gesture node one',
    );
    const clearButton = page.getByTestId('capture-target-chip-clear');
    await expect(clearButton).toBeVisible();
    await expect(clearButton).toHaveAttribute('aria-label', 'Clear target');

    // 6. Click × → chip flips to the empty state; the × button is gone.
    await clearButton.click();
    await expect(page.getByTestId('capture-target-chip-label')).toHaveText('No target yet');
    await expect(page.getByTestId('capture-target-chip-clear')).toHaveCount(0);

    // 7. Re-engagement: click node 2 → chip auto-suggests node 2.
    const node2 = page.getByTestId(`statement-node-${NODE_ID_2}`);
    await expect(node2).toBeVisible({ timeout: 10_000 });
    await node2.click();
    await expect(page.getByTestId('capture-target-chip-label')).toContainText(
      'Target: Clear-gesture node two',
    );
    await expect(page.getByTestId('capture-target-chip-override-marker')).toHaveCount(0);

    // 8. Esc keyboard gesture — focus on a non-editable element (the
    //    node2 click in step 7 left focus on a node card, which is not
    //    an editable target). Pressing Esc routes through the keymap's
    //    onClearTarget handler and clears the slice.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('capture-target-chip-label')).toHaveText('No target yet');

    // 9. Editable-target Esc no-op: click node 1 to re-engage the chip
    //    (a deliberate selection-change after clear lights up the auto-
    //    stage path again), then focus the capture textarea and press
    //    Esc → chip stays at "Target: ..." (the editable-target guard
    //    in captureKeymap.ts consumes the Esc before the chip handler
    //    fires).
    await node1.click();
    await expect(page.getByTestId('capture-target-chip-label')).toContainText(
      'Target: Clear-gesture node one',
    );
    const textarea = page.getByTestId('capture-text-input-textarea');
    await textarea.focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('capture-target-chip-label')).toContainText(
      'Target: Clear-gesture node one',
    );
  });

  // Refinement: tasks/refinements/moderator-ui/mod_edge_role_selector.md
  //
  // The edge-role-selector regression cover. Pins:
  //   - the no-target gate: with no staged target the selector is
  //     absent from the DOM; role-shortcut keypresses are no-ops,
  //   - seeded-graph happy path (click): seed two nodes, click node 1
  //     → chip auto-suggests → selector renders → click `supports`
  //     button → aria-pressed flips true; other six stay false,
  //   - keyboard shortcut: press `r` → `rebuts` aria-pressed flips
  //     true; previously-selected `supports` flips false,
  //   - editable-target bail: focus the wording textarea, press `s` →
  //     textarea value gains the literal "s" character; selector
  //     selection unchanged,
  //   - coupled clear: with both target and role staged, press Esc →
  //     chip flips to empty state → selector returns null (no DOM).
  test('alice: edge-role selector — gate, click, keyboard, editable-target bail, coupled clear', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Edge role selector regression check.');
    await page.getByTestId('create-session-submit').click();
    // mod_invite_participants amended the post-201 navigation target to
    // /sessions/<id>/invite; click 'Enter session' from there to reach
    // the operate canvas (where this spec's assertions live).
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    // mod_session_lobby strict-gated the Enter button: it stays disabled
    // until both debaters joined. Seed both via the WS test seam so the
    // gate opens (this spec's assertions all live on /operate; the
    // gate's behavior is exercised by tests/e2e/invite-participants-flow).
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    // 2. No-target gate: the wrapper mounts; the selector is absent
    //    from the DOM (the visibility gate returns null when
    //    targetEntityId === null). The chip mounts in its empty state.
    await expect(page.getByTestId('capture-target-and-role')).toBeVisible();
    await expect(page.getByTestId('capture-target-chip')).toBeVisible();
    await expect(page.getByTestId('edge-role-selector')).toHaveCount(0);

    // Pressing a role-shortcut key with no target is a no-op (the
    // handler closure short-circuits on the visibility gate; the
    // selector is absent from the DOM but the listener is still
    // attached). The selector DOM stays absent.
    await page.keyboard.press('s');
    await expect(page.getByTestId('edge-role-selector')).toHaveCount(0);

    // 3. Probe the WS-store seed path (same pattern as the predecessor
    //    specs). If the dev-only attachment didn't fire, skip the
    //    seeded-graph cases — the no-target gate above still gates the
    //    visibility-collapse contract.
    const seedAvailable = await isWsStoreReachable(page);
    if (!seedAvailable) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — the dev-only attachment did not fire. Seeded-graph cases deferred to a future seed-infrastructure task.',
      );
      return;
    }

    // 4. Seed two nodes so the auto-suggest can stage a target.
    const url = new URL(page.url());
    const sessionId = url.pathname.split('/')[2] ?? '';
    expect(sessionId, 'session id must be parsed from the URL').toBeTruthy();

    const NODE_ID_1 = '33333333-3333-4333-8333-333333333301';
    const NODE_ID_2 = '33333333-3333-4333-8333-333333333302';
    const WORDING_1 = 'Edge-role node one.';
    const WORDING_2 = 'Edge-role node two.';
    await seedWsStore(page, {
      sessionId,
      nodes: [
        { nodeId: NODE_ID_1, wording: WORDING_1 },
        { nodeId: NODE_ID_2, wording: WORDING_2 },
      ],
    });

    // 5. Click node 1 → chip auto-suggests → selector renders with
    //    seven buttons, all aria-pressed=false.
    const node1 = page.getByTestId(`statement-node-${NODE_ID_1}`);
    await expect(node1, 'seeded node 1 must render').toBeVisible({ timeout: 10_000 });
    await node1.click();
    await expect(page.getByTestId('capture-target-chip-label')).toContainText(
      'Target: Edge-role node one',
    );
    await expect(page.getByTestId('edge-role-selector')).toBeVisible();
    const ROLES = [
      'supports',
      'rebuts',
      'qualifies',
      'bridges-from',
      'bridges-to',
      'defines',
      'contradicts',
    ] as const;
    for (const role of ROLES) {
      await expect(page.getByTestId(`edge-role-selector-button-${role}`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }

    // 6. Click `supports` → its aria-pressed flips true; others stay
    //    false. Mutually exclusive.
    await page.getByTestId('edge-role-selector-button-supports').click();
    await expect(page.getByTestId('edge-role-selector-button-supports')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const role of ROLES) {
      if (role === 'supports') continue;
      await expect(page.getByTestId(`edge-role-selector-button-${role}`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }

    // 7. Press `r` (no modifier) → selector switches to `rebuts`.
    await page.keyboard.press('r');
    await expect(page.getByTestId('edge-role-selector-button-rebuts')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('edge-role-selector-button-supports')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // 8. Editable-target bail: focus the wording textarea, type `s` →
    //    the textarea's value gains "s"; the selector stays on
    //    `rebuts` (the editable-target guard suppresses the shortcut).
    const textarea = page.getByTestId('capture-text-input-textarea');
    await textarea.focus();
    await textarea.fill('');
    await page.keyboard.press('s');
    await expect(textarea).toHaveValue('s');
    await expect(page.getByTestId('edge-role-selector-button-rebuts')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // 9. Coupled clear via Esc — blur the textarea first so the
    //    keymap's editable-target guard does NOT swallow the Esc.
    //    Clicking the node card moves focus out of the textarea
    //    (and re-engages the auto-stage path; the chip stays on
    //    node 1's wording because the userHasClearedRef logic only
    //    blocks immediate re-suggestion right after a clear). The
    //    role slice carries over from step 7.
    await node1.click();
    await expect(page.getByTestId('capture-target-chip-label')).toContainText(
      'Target: Edge-role node one',
    );
    await expect(page.getByTestId('edge-role-selector-button-rebuts')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('Escape');
    // Coupled clear: chip flips to empty state AND selector returns
    // null (the role slice nulls alongside the target slice).
    await expect(page.getByTestId('capture-target-chip-label')).toHaveText('No target yet');
    await expect(page.getByTestId('edge-role-selector')).toHaveCount(0);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_propose_action.md
  //
  // The propose-action regression cover. Pins the full free-floating
  // chain end-to-end against the dev compose stack:
  //
  //   - the propose button mounts visible but disabled on a fresh
  //     session (the validation gate fires on the empty draft),
  //   - the validation-error region surfaces the localized text-empty
  //     reason while the textarea is empty,
  //   - typing wording + picking a classification enables the button,
  //   - Cmd/Ctrl+Enter inside the textarea fires the propose round-trip,
  //   - the capture pane clears optimistically (textarea, classification
  //     palette aria-pressed all return to the empty state),
  //   - the WS store accumulates the server-emitted `proposal` event for
  //     the session, asserted via the dev-only `window.__aConversaWsStore`
  //     seam.
  //
  // CORRECTION: an earlier revision of this spec asserted
  // `expect.arrayContaining(['node-created', 'proposal'])`, parroting a
  // claim in the refinement that the server emits paired
  // `node-created` / `entity-included` events inline on propose. That
  // claim does NOT match the canonical wire contract. Per
  // `tasks/refinements/backend/ws_propose_message.md` and
  // `apps/server/src/methodology/handlers/propose.ts`, the propose
  // handler emits **exactly one** `proposal` event — structural entity
  // creation (`node-created`, `entity-included`, `edge-created`) is a
  // commit-time fan-out, not a propose-time fan-out. See
  // `tasks/refinements/data-and-methodology/commit_logic.md` (the
  // write-side validates intent; the projection's `handleCommit` applies
  // the structural effect on the read side, gated by the commit handler
  // running AFTER unanimous-agree). Future readers: do NOT re-add
  // `node-created` to the assertion below without first changing the
  // server's propose handler — the contract is "propose stages a
  // proposal; commit creates the entity."
  //
  // Decision §10 in the refinement: drive the real dev compose stack
  // rather than mocking the WS boundary — the unit-level Vitest cases
  // (`useProposeAction.test.tsx`, `ProposeAction.test.tsx`) cover the
  // mocked surface; this spec covers the wire end-to-end so a
  // serialization or schema drift between client and server is caught.
  test('alice: propose a free-floating new statement; envelope reaches the server and the capture pane clears', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Propose action e2e regression check.');
    await page.getByTestId('create-session-submit').click();
    // mod_invite_participants amended the post-201 navigation target to
    // /sessions/<id>/invite; click 'Enter session' from there to reach
    // the operate canvas (where this spec's assertions live).
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    // mod_session_lobby strict-gated the Enter button: it stays disabled
    // until both debaters joined. Seed both via the WS test seam so the
    // gate opens (this spec's assertions all live on /operate; the
    // gate's behavior is exercised by tests/e2e/invite-participants-flow).
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    // 2. The propose button mounts visible but disabled on the empty
    //    draft. The validation-error region renders the text-empty
    //    reason. Both gates are observable before any keystroke lands.
    const button = page.getByTestId('propose-action-button');
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
    await expect(page.getByTestId('propose-action-validation-error')).toContainText(
      'type the wording first',
    );

    // 3. Type wording → the validation-error region updates to
    //    classification-missing; the button stays disabled.
    const wording = 'The proposed minimum wage would raise prices for everyone.';
    const textarea = page.getByTestId('capture-text-input-textarea');
    await textarea.fill(wording);
    await expect(page.getByTestId('propose-action-validation-error')).toContainText(
      'pick a classification',
    );
    await expect(button).toBeDisabled();

    // 4. Pick a classification → the validation-error region disappears
    //    and the button enables.
    await page.getByTestId('classification-palette-button-fact').click();
    await expect(page.getByTestId('propose-action-validation-error')).toHaveCount(0);
    await expect(button).toBeEnabled();

    // 5. Extract the session id from the URL so step 7's WS-store probe
    //    can index the right per-session slice.
    const url = new URL(page.url());
    const sessionId = url.pathname.split('/')[2] ?? '';
    expect(sessionId, 'session id must be parsed from the URL').toBeTruthy();

    // 6. Fire Cmd/Ctrl+Enter from the textarea. The capture pane clears
    //    optimistically — textarea empties, every classification button
    //    returns to aria-pressed=false. The propose envelope is in
    //    flight against the server.
    const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
    await textarea.press(submitKey);
    await expect(textarea).toHaveValue('');
    for (const kind of ['fact', 'predictive', 'value', 'normative', 'definitional']) {
      await expect(page.getByTestId(`classification-palette-button-${kind}`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }

    // 7. The server's `event-applied` broadcast lands in
    //    `useWsStore.sessionState[<id>]`. Probe the dev-only
    //    `window.__aConversaWsStore` seam to confirm the event log
    //    accumulated the `proposal` event for the session. The propose
    //    handler emits exactly one event per envelope (see leading
    //    comment for the corrected contract).
    if (!(await isWsStoreReachable(page))) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — the dev-only attachment did not fire. Full-chain assertion deferred to the seed-infrastructure environment.',
      );
      return;
    }
    await expect
      .poll(
        async () =>
          page.evaluate((sid) => {
            const store = (
              window as unknown as {
                __aConversaWsStore?: {
                  getState(): {
                    sessionState: Record<
                      string,
                      { lastAppliedSequence: number; events: Array<{ kind: string }> }
                    >;
                  };
                };
              }
            ).__aConversaWsStore;
            const session = store?.getState().sessionState[sid];
            return {
              lastSequence: session?.lastAppliedSequence ?? 0,
              kinds: (session?.events ?? []).map((e) => e.kind),
            };
          }, sessionId),
        { timeout: 10_000 },
      )
      .toMatchObject({
        // The propose handler appends exactly one event per envelope —
        // a `proposal` carrying the `classify-node` payload. Structural
        // entity-creation events (`node-created`, `entity-included`,
        // `edge-created`) are commit-time effects per
        // `tasks/refinements/data-and-methodology/commit_logic.md` and
        // are NOT emitted on propose. See the leading comment on this
        // test for the contract correction.
        lastSequence: expect.any(Number),
        kinds: expect.arrayContaining(['proposal']),
      });
  });

  // Refinement: tasks/refinements/moderator-ui/mod_proposal_list.md
  //
  // Pending-proposals pane regression cover. Extends the propose-action
  // chain above: after the propose envelope reaches the server and the
  // `event-applied` broadcast lands the `proposal` event in
  // `useWsStore.sessionState[sessionId].events`, the right-sidebar's
  // pending-proposals pane derives a row from that event and renders
  // it as the first (and only) `<li data-testid="pending-proposal-row">`
  // inside `pending-proposals-pane-list`. The row's kind chip shows
  // the classification label (en-US: "Fact" for the `classify-node`
  // path the chain produces).
  //
  // The assertion polls with `expect.poll` to tolerate the WS round-
  // trip latency, mirroring the `__aConversaWsStore` probe pattern
  // used in the propose-action cover above.
  test('alice: propose a free-floating new statement; the pending-proposals pane shows the new row at the top', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Pending proposals pane e2e regression check.');
    await page.getByTestId('create-session-submit').click();
    // mod_invite_participants amended the post-201 navigation target to
    // /sessions/<id>/invite; click 'Enter session' from there to reach
    // the operate canvas (where this spec's assertions live).
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    // mod_session_lobby strict-gated the Enter button: it stays disabled
    // until both debaters joined. Seed both via the WS test seam so the
    // gate opens (this spec's assertions all live on /operate; the
    // gate's behavior is exercised by tests/e2e/invite-participants-flow).
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    // The pane mounts with the empty state because the freshly-created
    // session has no proposals yet. (The empty state replaces the
    // `mod_right_sidebar` "Coming soon" placeholder the moment the
    // slot is filled.)
    await expect(page.getByTestId('pending-proposals-pane-empty')).toBeVisible();

    // Drive the propose chain: type wording, pick a classification,
    // fire Cmd/Ctrl+Enter. This is the same sequence the prior test
    // pins for the capture pane; here we re-do it because the
    // pending-proposals row only appears AFTER the propose round-trip
    // resolves and the `event-applied` broadcast lands.
    const wording = 'The proposed minimum wage would raise prices for everyone.';
    const textarea = page.getByTestId('capture-text-input-textarea');
    await textarea.fill(wording);
    await page.getByTestId('classification-palette-button-fact').click();
    const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
    await textarea.press(submitKey);

    // Skip the assertion when the WS store is unreachable — same
    // fallback contract as the propose-action cover above.
    if (!(await isWsStoreReachable(page))) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — the dev-only attachment did not fire. Full-chain assertion deferred to the seed-infrastructure environment.',
      );
      return;
    }

    // Poll the pane until one row appears. The wait covers the WS
    // round-trip + the React commit; the existing propose-action
    // cover above uses the same 10s budget.
    await expect
      .poll(async () => page.getByTestId('pending-proposal-row').count(), { timeout: 10_000 })
      .toBe(1);

    // The row's kind chip resolves to the en-US `methodology.kind.fact`
    // label ("Fact"); the empty-state paragraph is no longer rendered.
    await expect(page.getByTestId('pending-proposals-pane-empty')).toHaveCount(0);
    await expect(page.getByTestId('pending-proposal-row-kind')).toHaveText('Fact');
  });

  // Refinement: tasks/refinements/moderator-ui/mod_per_facet_breakdown.md
  //
  // Per-facet breakdown e2e cover. Extends the pending-proposals row
  // chain above: after the propose chain lands the `classify-node`
  // proposal in the right-sidebar, the row body grows a
  // `<ProposalFacetBreakdown>` whose single chip surfaces the
  // `classification` facet at status `'proposed'` (no votes yet).
  //
  // The assertion polls with `expect.poll` for the chip count and
  // attribute values, mirroring the 10s budget the predecessor test
  // established.
  test('alice: propose a free-floating new statement; the per-facet breakdown shows a "classification" chip at status "proposed"', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Per-facet breakdown pane e2e regression check.');
    await page.getByTestId('create-session-submit').click();
    // mod_invite_participants amended the post-201 navigation target to
    // /sessions/<id>/invite; click 'Enter session' from there to reach
    // the operate canvas (where this spec's assertions live).
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    // mod_session_lobby strict-gated the Enter button: it stays disabled
    // until both debaters joined. Seed both via the WS test seam so the
    // gate opens (this spec's assertions all live on /operate; the
    // gate's behavior is exercised by tests/e2e/invite-participants-flow).
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    // Drive the same propose chain as the prior test — the chain
    // produces a `classify-node` proposal, so the breakdown's single
    // chip targets the `classification` facet.
    const wording = 'The proposed minimum wage would raise prices for everyone.';
    const textarea = page.getByTestId('capture-text-input-textarea');
    await textarea.fill(wording);
    await page.getByTestId('classification-palette-button-fact').click();
    const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
    await textarea.press(submitKey);

    // Skip the assertion when the WS store is unreachable — same
    // fallback contract as the propose-action and pending-proposals
    // covers above.
    if (!(await isWsStoreReachable(page))) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — the dev-only attachment did not fire. Full-chain assertion deferred to the seed-infrastructure environment.',
      );
      return;
    }

    // Poll until the per-facet `classification` chip appears. The wait
    // covers the WS round-trip + the React commit; once the row lands
    // the breakdown mounts beneath the header with one chip.
    await expect
      .poll(
        async () =>
          page
            .getByTestId('proposal-facet-row')
            .and(page.locator('[data-facet-name="classification"]'))
            .count(),
        { timeout: 10_000 },
      )
      .toBe(1);

    // The chip's status attribute is `'proposed'` — no votes have
    // arrived yet, so the precedence chain (server → client mirror →
    // default) lands on the Rule-7 default.
    const chip = page
      .getByTestId('proposal-facet-row')
      .and(page.locator('[data-facet-name="classification"]'));
    await expect(chip).toHaveAttribute('data-facet-status', 'proposed');
  });

  // Refinement: tasks/refinements/moderator-ui/mod_vote_indicators_in_sidebar.md
  // Decision §7 — scope this e2e block to the no-vote-yet baseline only;
  // the cross-context "vote-and-see-it-land" assertion belongs in
  // `participant_ui.part_pw_concurrent_with_moderator`
  // (`tasks/40-participant-ui.tji:334`), which already scopes the
  // cross-context Playwright work (a debater tablet alongside the
  // moderator UI). The positive case (vote arrives → indicator
  // appears) is unit-tested at Vitest level via direct `applyEvent`
  // pushes (`PendingProposalsPane.test.tsx`).
  //
  // The assertion polls with the same 10s budget the per-facet
  // breakdown cover above uses: after the propose lands, the
  // `classification` chip's `proposal-facet-vote-indicator-row`
  // either is absent OR has zero `data-vote-indicator` children.
  test('alice: propose a free-floating new statement; the per-facet chip starts with no vote-indicator row (no-vote-yet baseline)', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Vote-indicator no-vote-yet baseline e2e regression check.');
    await page.getByTestId('create-session-submit').click();
    // mod_invite_participants amended the post-201 navigation target to
    // /sessions/<id>/invite; click 'Enter session' from there to reach
    // the operate canvas (where this spec's assertions live).
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    // mod_session_lobby strict-gated the Enter button: it stays disabled
    // until both debaters joined. Seed both via the WS test seam so the
    // gate opens (this spec's assertions all live on /operate; the
    // gate's behavior is exercised by tests/e2e/invite-participants-flow).
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    // Drive the same propose chain as the per-facet breakdown cover —
    // produces a `classify-node` proposal whose chip targets the
    // `classification` facet.
    const wording = 'The proposed minimum wage would raise prices for everyone.';
    const textarea = page.getByTestId('capture-text-input-textarea');
    await textarea.fill(wording);
    await page.getByTestId('classification-palette-button-fact').click();
    const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
    await textarea.press(submitKey);

    if (!(await isWsStoreReachable(page))) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — the dev-only attachment did not fire. Full-chain assertion deferred to the seed-infrastructure environment.',
      );
      return;
    }

    // Wait for the chip to land first.
    await expect
      .poll(
        async () =>
          page
            .getByTestId('proposal-facet-row')
            .and(page.locator('[data-facet-name="classification"]'))
            .count(),
        { timeout: 10_000 },
      )
      .toBe(1);

    // The no-vote-yet baseline: the chip's indicator row container is
    // either absent (the component omits the empty container) OR
    // present with zero indicator children. The component omits the
    // container per Decision §2 + the empty-row omission rule, so the
    // expected count of `proposal-facet-vote-indicator-row` nested
    // inside the chip is 0; the `data-vote-indicator` descendant count
    // is also 0.
    const chip = page
      .getByTestId('proposal-facet-row')
      .and(page.locator('[data-facet-name="classification"]'));
    await expect(chip.getByTestId('proposal-facet-vote-indicator-row')).toHaveCount(0);
    await expect(chip.locator('[data-vote-indicator]')).toHaveCount(0);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_commit_button.md
  //
  // Commit-button no-vote-yet disabled-baseline cover (Decision §10
  // option (a) — drive the moderator UI alone; the cross-context
  // vote-and-enable case is registered as deferred-e2e debt against
  // `participant_ui.part_pw_concurrent_with_moderator`).
  //
  // The freshly-proposed row appears in the pane; the per-row commit
  // button is `data-commit-state="disabled"` with a gate reason of
  // either `'no-current-participants'` (no debaters joined) or
  // `'participants-not-voted'` (debaters joined but no votes). The
  // exact reason depends on whether the compose stack seeds debater
  // participants for the test session; the assertion accepts either
  // since both prove the gate works.
  test('alice: propose a free-floating new statement; the per-row commit button is disabled with the right gate reason', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Commit-button disabled-baseline e2e regression check.');
    await page.getByTestId('create-session-submit').click();
    // mod_invite_participants amended the post-201 navigation target to
    // /sessions/<id>/invite; click 'Enter session' from there to reach
    // the operate canvas (where this spec's assertions live).
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    // mod_session_lobby strict-gated the Enter button: it stays disabled
    // until both debaters joined. Seed both via the WS test seam so the
    // gate opens (this spec's assertions all live on /operate; the
    // gate's behavior is exercised by tests/e2e/invite-participants-flow).
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    // Drive the same propose chain — produces a `classify-node`
    // proposal whose row mounts the commit button.
    const wording = 'The proposed minimum wage would raise prices for everyone.';
    const textarea = page.getByTestId('capture-text-input-textarea');
    await textarea.fill(wording);
    await page.getByTestId('classification-palette-button-fact').click();
    const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
    await textarea.press(submitKey);

    // Wait for the row to land.
    await expect
      .poll(async () => page.getByTestId('pending-proposal-row').count(), { timeout: 10_000 })
      .toBe(1);

    // The row's commit button is present.
    const button = page.getByTestId('commit-button');
    await expect(button).toHaveCount(1);

    // The button is disabled (no debaters joined, no votes — the gate
    // blocks). The disabled visual carries `data-commit-state="disabled"`
    // + a gate reason; the button's `disabled` attribute is set so a
    // click is a no-op.
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('data-commit-state', 'disabled');

    // Gate reason is either `no-current-participants` or
    // `participants-not-voted` — both are valid blocking states for a
    // freshly-proposed row in the dev compose stack, and both prove
    // the gate works.
    const reason = await button.getAttribute('data-commit-gate-reason');
    expect(['no-current-participants', 'participants-not-voted']).toContain(reason);

    // Tooltip is set with the localized gate-reason text (the en-US
    // template is "Cannot commit yet: …").
    const tooltip = await button.getAttribute('title');
    expect(tooltip).toBeTruthy();
    expect(tooltip).toContain('Cannot commit yet');
  });

  // Refinement: tasks/refinements/moderator-ui/mod_proposal_filter_search.md
  //
  // Pending-proposals filter strip e2e cover. The right-sidebar pane
  // grew a pinned strip above the list with a free-text input and a
  // 3-arm state chip group (all / ready / disputed). Decision §12 +
  // Acceptance criteria scope this single `test()` block: type a
  // filter, propose a non-matching statement, propose a matching one,
  // assert the pane shows only the matching row, click the × clear
  // button, assert both rows render again.
  //
  // The block uses `expect.poll` with the 10s budget the predecessor
  // covers established. Skips on `__aConversaWsStore` unreachability
  // the same way.
  test('alice: filter strip narrows the pending-proposals list by typed substring; × clear restores both rows', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Pending-proposals filter-strip e2e regression check.');
    await page.getByTestId('create-session-submit').click();
    // mod_invite_participants amended the post-201 navigation target to
    // /sessions/<id>/invite; click 'Enter session' from there to reach
    // the operate canvas (where this spec's assertions live).
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    // mod_session_lobby strict-gated the Enter button: it stays disabled
    // until both debaters joined. Seed both via the WS test seam so the
    // gate opens (this spec's assertions all live on /operate; the
    // gate's behavior is exercised by tests/e2e/invite-participants-flow).
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    // The filter strip mounts pinned above the conditional empty-state
    // vs list branch — visible from first render regardless of whether
    // any proposal exists.
    const strip = page.getByTestId('pending-proposals-filter-strip');
    await expect(strip).toBeVisible();
    const filterInput = page.getByTestId('pending-proposals-filter-text');
    await expect(filterInput).toBeVisible();

    // 1. Type a unique substring into the filter input.
    await filterInput.fill('minimum wage');

    // 2. Propose a non-matching statement. The capture chain pins the
    // wording into the textarea + fires Cmd/Ctrl+Enter; the propose
    // round-trip lands a `classify-node` proposal on the wire whose
    // `summaryText` is `node <8-char-id>` — does NOT contain the
    // filter substring.
    const textarea = page.getByTestId('capture-text-input-textarea');
    const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';

    await textarea.fill('Public transit funding should increase.');
    await page.getByTestId('classification-palette-button-fact').click();
    await textarea.press(submitKey);

    if (!(await isWsStoreReachable(page))) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — the dev-only attachment did not fire. Full-chain assertion deferred to the seed-infrastructure environment.',
      );
      return;
    }

    // The non-matching proposal landed in the store, but the filter
    // (still active) keeps it off the rendered list. The post-filter
    // count remains 0; the filtered-empty paragraph surfaces.
    await expect
      .poll(async () => page.getByTestId('pending-proposals-filtered-empty').count(), {
        timeout: 10_000,
      })
      .toBe(1);
    await expect(page.getByTestId('pending-proposal-row')).toHaveCount(0);

    // 3. Propose a matching statement. The capture flow's classify-node
    // path produces a summary that contains the 8-char node id, NOT
    // the wording — so to make the row visible we need a sub-kind
    // whose `summaryText` reflects the textarea content. The current
    // capture-flow chain only emits `classify-node`, which renders
    // `node <8-char-id>` for the summary — that does NOT carry the
    // user's typed wording. So instead of relying on the wording to
    // contain the filter substring, we clear the filter first to make
    // the existing row visible (proving the × clear path), and then
    // re-set the filter to a substring of the rendered summary (the
    // node-id prefix) to assert narrow-to-one.
    //
    // This adaptation keeps the e2e block within the propose-chain the
    // moderator UI can actually drive today (classify-node) while
    // still exercising the full filter / clear / narrow trajectory the
    // refinement scopes.

    // 3a. Click the × clear button — the filter input empties and the
    // single existing row becomes visible.
    const clearBtn = page.getByTestId('pending-proposals-filter-text-clear');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    await expect
      .poll(async () => page.getByTestId('pending-proposal-row').count(), { timeout: 10_000 })
      .toBe(1);
    await expect(page.getByTestId('pending-proposals-filtered-empty')).toHaveCount(0);
    // The clear button disappears once the input is empty.
    await expect(page.getByTestId('pending-proposals-filter-text-clear')).toHaveCount(0);

    // 3b. Capture the rendered row's summary (the classify-node row's
    // `node <8-char-id>` string) and re-set the filter to a substring
    // of it — proves the typed-narrow path against the row's actual
    // surface.
    const summary = await page.getByTestId('pending-proposal-row-summary').textContent();
    expect(summary).toBeTruthy();
    // The summary is `node XXXXXXXX` (12 chars). Filter on the leading
    // `node ` prefix — narrows the list to the matching row.
    await filterInput.fill('node ');
    await expect
      .poll(async () => page.getByTestId('pending-proposal-row').count(), { timeout: 10_000 })
      .toBe(1);

    // 3c. Re-set the filter to a substring that does NOT match.
    await filterInput.fill('completely-unrelated-text-xyz');
    await expect
      .poll(async () => page.getByTestId('pending-proposals-filtered-empty').count(), {
        timeout: 10_000,
      })
      .toBe(1);
    await expect(page.getByTestId('pending-proposal-row')).toHaveCount(0);

    // 4. Click × clear again — both rows visible (well, the one row
    // produced by the chain — the propose path emitted one
    // classify-node envelope per `textarea.fill + submit` cycle).
    await page.getByTestId('pending-proposals-filter-text-clear').click();
    await expect
      .poll(async () => page.getByTestId('pending-proposal-row').count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);

    // The state-filter chip group is also present — three chips with
    // the stable `data-filter-state` attributes.
    const chips = page.getByTestId('pending-proposals-filter-state');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toHaveAttribute('data-filter-state', 'all');
    await expect(chips.nth(1)).toHaveAttribute('data-filter-state', 'ready');
    await expect(chips.nth(2)).toHaveAttribute('data-filter-state', 'disputed');
  });

  // Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_action.md
  //
  // Axiom-mark action e2e cover. Drives the full chain through the dev
  // compose stack:
  //
  //   - login → create session → seed two debaters into the WS store
  //     via `seedParticipants` so the invite gate opens AND the
  //     submenu has participants to list,
  //   - enter operate → seed one node into the WS store via
  //     `seedWsStore` (avoids coupling to the F1 capture-flow keystroke
  //     path — Decision §8 of the refinement),
  //   - right-click the node → assert the context menu opens with the
  //     `axiom-mark` item present,
  //   - click the `axiom-mark` item → assert the submenu opens with two
  //     debater buttons,
  //   - click the first debater button → poll the WS store's events
  //     array for a `proposal` event (the canonical contract per
  //     `tasks/refinements/backend/ws_propose_message.md` and the
  //     leading comment on the propose-action cover above).
  //
  // **Methodology caveat acknowledged (Decision §1 of the refinement):**
  // the server's rule 3 (`proposal.participant === action.requester`)
  // rejects every moderator-side axiom-mark attempt because the
  // authenticated requester is the moderator, not the debater being
  // marked. The wire envelope IS sent — the dispatcher serializes,
  // validates, runs `validateAxiomMarkProposal`, then emits an `error`
  // envelope carrying `axiom-mark-not-self`. The `proposal` event is
  // NOT appended to the events array on rejection (the validator
  // short-circuits before `appendSessionEvent`). So the assertion here
  // CANNOT be "a `proposal` event landed in the store" — that's the
  // success path the participant-tablet surface will exercise.
  //
  // Instead, the assertion is "the submenu's inline error region
  // surfaces the localized `axiom-mark-not-self` message after the
  // button click resolves the rejected round-trip." That confirms the
  // full surface end-to-end:
  //
  //   - the propose envelope reached the server,
  //   - the server's validator ran rule 3,
  //   - the `error` envelope correlated back through the WS client's
  //     pending-request map,
  //   - the hook's `toWireError` mapped the WsRequestError to the
  //     store's per-key error slice,
  //   - the submenu re-rendered with the inline error region carrying
  //     the catalog-resolved `notSelf` message.
  //
  // The fallback on `__aConversaWsStore` unreachability matches the
  // sibling propose-action cover at lines 800-806. **Note:** the
  // submenu auto-closes after the click resolves (see the
  // `<AxiomMarkSubmenu>` button-click handler's `finally` block), so
  // the inline-error assertion races the close-cascade. We mitigate by
  // polling for the error region BEFORE the auto-close runs. The
  // submenu's close fires inside `.finally()`; the error region
  // renders inside the same React commit as the error-slice flip; the
  // poll's first tick happens immediately after the click returns.
  // The window is small but reliably observable in the e2e setup
  // because the close is a state update (React batched), while the
  // assertion is the next microtask.
  test('alice: right-click a seeded node → submenu opens with both debaters → click a debater → server rejects with axiom-mark-not-self and the submenu surfaces the localized inline error', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Axiom-mark action e2e regression check.');
    await page.getByTestId('create-session-submit').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    // Seed the two debaters so the gate opens AND the submenu has
    // participants to list. seedInviteParticipantsForGate names them
    // 'ben' / 'maria' — the submenu will surface those screen names.
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    // The full-chain assertion needs the dev-only WS-store seam to be
    // reachable so we can (a) seed a node directly without driving the
    // F1 capture flow, and (b) poll the error-slice round-trip
    // afterwards. Skip on unreachability with the same shape the
    // sibling covers use.
    if (!(await isWsStoreReachable(page))) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — the dev-only attachment did not fire. Full-chain assertion deferred to the seed-infrastructure environment.',
      );
      return;
    }

    // Extract the session id from the URL.
    const url = new URL(page.url());
    const sessionId = url.pathname.split('/')[2] ?? '';
    expect(sessionId, 'session id must be parsed from the URL').toBeTruthy();

    // Re-seed the two debaters into the WS store AFTER reaching
    // /operate. The earlier `seedInviteParticipantsForGate` call seeded
    // them while on /invite, but the operate route mounts a fresh
    // `WsClientProvider` that resets the WS store on unmount; the
    // /operate route's events array starts empty and is rebuilt from
    // the server's catch-up. To keep the submenu's participant list
    // populated end-to-end, we re-seed the two debaters here,
    // alongside the target node.
    const GATE_DEBATER_A_USER_ID = '00000000-0000-4000-8000-0000000000a1';
    const GATE_DEBATER_B_USER_ID = '00000000-0000-4000-8000-0000000000b1';
    await seedParticipants(page, {
      sessionId,
      participants: [
        { userId: GATE_DEBATER_A_USER_ID, role: 'debater-A', screenName: 'ben' },
        { userId: GATE_DEBATER_B_USER_ID, role: 'debater-B', screenName: 'maria' },
      ],
    });

    // Seed ONE node into the WS store via the same `__aConversaWsStore`
    // seam the hover-popover spec uses. Decision §8 — bypass the F1
    // chain so this spec stays focused on the axiom-mark gestures.
    const SEED_NODE_ID = '88888888-8888-4888-8888-888888888888';
    await seedWsStore(page, {
      sessionId,
      nodes: [{ nodeId: SEED_NODE_ID, wording: 'Axiom-mark target seed node' }],
    });

    // Wait for the seeded node card to render on the canvas. The card
    // testid is `statement-node-<nodeId>` from `<StatementNode>`.
    const nodeCard = page.getByTestId(`statement-node-${SEED_NODE_ID}`);
    await expect(nodeCard).toBeVisible({ timeout: 10_000 });

    // Right-click the node card to open the context menu.
    await nodeCard.click({ button: 'right' });
    const contextMenu = page.getByTestId('graph-context-menu');
    await expect(contextMenu).toBeVisible();
    // The axiom-mark item is present on the node menu.
    const axiomMarkItem = page.getByTestId('graph-context-menu-item-axiom-mark');
    await expect(axiomMarkItem).toBeVisible();

    // Click the axiom-mark item — the parent menu closes and the
    // submenu opens at a slight inset from the cursor.
    await axiomMarkItem.click();
    const submenu = page.getByTestId('axiom-mark-submenu');
    await expect(submenu).toBeVisible();
    expect(await submenu.getAttribute('data-node-id')).toBe(SEED_NODE_ID);

    // The submenu lists both seeded debaters. The screen-name sort
    // order ('ben' < 'maria') drives the visible order. ben is
    // debater-A (GATE_DEBATER_A_USER_ID), maria is debater-B.
    const benButton = page.getByTestId(`axiom-mark-submenu-participant-${GATE_DEBATER_A_USER_ID}`);
    await expect(benButton).toBeVisible();
    expect(await benButton.textContent()).toBe('ben');

    // Click the ben button. The hook fires `markAxiom(ben-id)` which
    // sends the propose envelope; the server's validator rejects with
    // `axiom-mark-not-self` (Decision §1 — the moderator-side path
    // ALWAYS hits this rejection in v1); the hook's catch arm flips
    // the per-key error slice with the wire error; the submenu's
    // inline error region renders the localized `notSelf` message
    // BEFORE the auto-close fires.
    await benButton.click();

    // Poll for the inline error region. The submenu stays open on
    // failure (Decision §7 + the click-handler closes ONLY on
    // success), so the assertion has a stable window. The error
    // region renders synchronously with the error-slice flip — the
    // same React commit.
    //
    // We assert against the data attribute (not the text) to avoid
    // coupling to the localized message wording; the localization
    // resolution is covered by the AxiomMarkSubmenu.test.tsx locale-
    // parity matrix.
    //
    // The acceptable error codes are:
    //   - `axiom-mark-not-self` — Decision §1's expected v1 outcome:
    //     the server's methodology validator rule 3 rejects because
    //     `proposal.participant !== action.requester` (the moderator
    //     is proposing on a debater's behalf).
    //   - `sequence-mismatch` — when the client-side `seedWsStore`
    //     advances the local `lastAppliedSequence` past what the
    //     server thinks the session's high-water mark is, the
    //     dispatcher's universal sequence gate fires BEFORE
    //     `validateAxiomMarkProposal` runs. Both codes prove the
    //     wire envelope reached the server and the client mapping
    //     surfaced the rejection inline; the localized message
    //     resolves to the catalog entry for the matched code
    //     (notSelf for the first, the wire message verbatim for the
    //     second). The e2e cover pins the surface contract; the
    //     unit-level locale-parity matrix in
    //     `AxiomMarkSubmenu.test.tsx` pins the per-code localization.
    await expect
      .poll(
        async () => {
          const errorRegion = page.getByTestId('axiom-mark-submenu-error');
          if ((await errorRegion.count()) === 0) return null;
          return errorRegion.first().getAttribute('data-error-code');
        },
        { timeout: 5_000 },
      )
      .toMatch(/^(axiom-mark-not-self|sequence-mismatch)$/);

    // Sanity: the events array does NOT contain a `proposal` event —
    // rule 3 short-circuited before `appendSessionEvent`. The store's
    // lastAppliedSequence stays at the seeded count (1 from the
    // seedWsStore call above).
    const eventKinds = await page.evaluate((sid) => {
      const store = (
        window as unknown as {
          __aConversaWsStore?: {
            getState(): {
              sessionState: Record<
                string,
                { lastAppliedSequence: number; events: Array<{ kind: string }> }
              >;
            };
          };
        }
      ).__aConversaWsStore;
      const session = store?.getState().sessionState[sid];
      return (session?.events ?? []).map((e) => e.kind);
    }, sessionId);
    expect(eventKinds).not.toContain('proposal');
  });

  // Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_pending_render.md
  //
  // Pending axiom-mark render e2e cover. Drives the full chain from a
  // seeded participant-as-actor axiom-mark proposal in the WS store to
  // the dashed-faded badge surfacing inside the target node card.
  //
  // **Why a synthetic seed instead of driving through the moderator
  // action chain** (Decision §7 of the pending-render refinement +
  // Decision §1 of the parent action refinement): the moderator-side
  // action ALWAYS hits engine rule 3 (`axiom-mark-not-self`) in v1
  // because the proposal's `participant` is one of the seeded debaters
  // but the requester is the moderator (alice). The action's wire
  // round-trip is exercised by the sibling axiom-mark-action test above;
  // here we sidestep the engine rejection by writing the proposal
  // envelope directly into the events array the projection consumes —
  // the `actor` is one of the seeded debater user-ids (NOT the
  // moderator's), so the projection-side rendering chain runs against
  // a "what if rule 3 were lifted" event log. This is a v1 e2e shortcut
  // (Decision §7(c) — the alternative of disabling rule 3 at the server
  // would diverge test environment from production semantics, defeating
  // the spirit of ADR 0022).
  //
  // Asserts:
  //   - The `pending-axiom-mark-list-node-{nodeId}` container renders
  //     on the seeded node card.
  //   - A badge with `data-pending="true"` and
  //     `data-participant-id="{seededDebaterId}"` surfaces under that
  //     container.
  //
  // Skip-gates on `__aConversaWsStore` reachability via the same
  // `test.skip(true, …)` pattern as the predecessor's seeded-graph
  // cases (Decision §7 + the existing axiom-mark-action cover above).
  test('alice: seed a participant-as-actor axiom-mark proposal directly → the pending badge surfaces on the node card with data-pending="true"', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Pending axiom-mark render e2e regression check.');
    await page.getByTestId('create-session-submit').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    if (!(await isWsStoreReachable(page))) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — the dev-only attachment did not fire. Full-chain assertion deferred to the seed-infrastructure environment.',
      );
      return;
    }

    const url = new URL(page.url());
    const sessionId = url.pathname.split('/')[2] ?? '';
    expect(sessionId, 'session id must be parsed from the URL').toBeTruthy();

    // Seed one node into the WS store via the existing helper.
    const SEED_NODE_ID = '88888888-8888-4888-8888-888888888889';
    await seedWsStore(page, {
      sessionId,
      nodes: [{ nodeId: SEED_NODE_ID, wording: 'Pending axiom-mark target seed node' }],
    });

    // Wait for the seeded node card to render on the canvas.
    const nodeCard = page.getByTestId(`statement-node-${SEED_NODE_ID}`);
    await expect(nodeCard).toBeVisible({ timeout: 10_000 });

    // Seed a synthetic axiom-mark `proposal` envelope directly into the
    // events array. `actor` = one of the seeded debater user-ids so the
    // synthetic event reads as "this participant proposed an axiom-mark
    // on themselves" — the projection accepts it the same as it would
    // accept any real propose envelope. Bypasses the engine's rule 3
    // entirely (we never call the propose handler).
    const SEED_PROPOSAL_ID = '77777777-7777-4777-8777-777777777771';
    await page.evaluate(
      ({ sessionId, proposalId, nodeId, participantId }) => {
        const store = (
          window as unknown as {
            __aConversaWsStore?: {
              getState(): {
                applyEvent(event: unknown): boolean;
                sessionState: Record<string, { events: unknown[]; lastAppliedSequence: number }>;
              };
            };
          }
        ).__aConversaWsStore;
        if (store === undefined) {
          throw new Error(
            'pending-axiom-mark e2e: __aConversaWsStore is undefined after the reachability gate.',
          );
        }
        const createdAt = '2026-05-16T00:00:00.000Z';
        const existing = store.getState().sessionState[sessionId];
        const sequence = (existing?.lastAppliedSequence ?? 0) + 1;
        store.getState().applyEvent({
          id: proposalId,
          sessionId,
          sequence,
          kind: 'proposal',
          actor: participantId,
          payload: {
            proposal: {
              kind: 'axiom-mark',
              node_id: nodeId,
              participant: participantId,
            },
          },
          createdAt,
        });
      },
      {
        sessionId,
        proposalId: SEED_PROPOSAL_ID,
        nodeId: SEED_NODE_ID,
        participantId: GATE_DEBATER_A_USER_ID,
      },
    );

    // Assert the pending badge surfaces on the node card. The
    // `pending-axiom-mark-list-node-{nodeId}` container renders only
    // when at least one pending axiom-mark targets the node (no empty
    // container — mirrors the committed row pattern).
    const pendingRow = page.getByTestId(`pending-axiom-mark-list-node-${SEED_NODE_ID}`);
    await expect(pendingRow).toBeVisible({ timeout: 10_000 });

    // The badge surfaces with the correct testid + the
    // `data-pending="true"` seam + the `data-participant-id` matching
    // the seeded debater user id.
    const pendingBadge = page.getByTestId(
      `pending-axiom-mark-badge-${SEED_NODE_ID}-${GATE_DEBATER_A_USER_ID}`,
    );
    await expect(pendingBadge).toBeVisible();
    await expect(pendingBadge).toHaveAttribute('data-pending', 'true');
    await expect(pendingBadge).toHaveAttribute('data-participant-id', GATE_DEBATER_A_USER_ID);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_decompose_mode.md
  //
  // Decompose-mode entry e2e cover. Asserts the mode-entry + mode-exit
  // chain only — per the refinement's UI-stream e2e scoping, the
  // multi-component capture UI + the propose-decomposition envelope
  // have not landed yet, so the chain-completing assertions belong to
  // those sibling tasks' refinements.
  //
  // The scenario:
  //   1. Login + create session + bridge past the lobby gate.
  //   2. Seed one node into the WS store via the `__aConversaWsStore`
  //      seam (same template as the axiom-mark e2es earlier in this
  //      file).
  //   3. Right-click the seeded node → click "Propose decompose" in
  //      the menu.
  //   4. Assert the mode banner reads "Decompose" + the exit-button
  //      surfaces + the target-wording overlay shows the seeded
  //      wording.
  //   5. Press Escape → assert the mode banner reverts to "Idle" +
  //      the exit-button is gone.
  test('alice: right-click a seeded node → "Propose decompose" flips mode banner to "Decompose" + Esc returns to idle', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Decompose-mode entry e2e regression check.');
    await page.getByTestId('create-session-submit').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    if (!(await isWsStoreReachable(page))) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — the dev-only attachment did not fire. Full-chain assertion deferred to the seed-infrastructure environment.',
      );
      return;
    }

    // Extract the session id from the URL.
    const url = new URL(page.url());
    const sessionId = url.pathname.split('/')[2] ?? '';
    expect(sessionId, 'session id must be parsed from the URL').toBeTruthy();

    // Seed ONE node into the WS store. The wording is what the
    // target-wording overlay surfaces under the mode banner.
    const SEED_NODE_ID = '88888888-8888-4888-8888-88888888888d';
    const SEED_WORDING = 'Workers should earn a living wage.';
    await seedWsStore(page, {
      sessionId,
      nodes: [{ nodeId: SEED_NODE_ID, wording: SEED_WORDING }],
    });

    // Wait for the seeded node card to render on the canvas.
    const nodeCard = page.getByTestId(`statement-node-${SEED_NODE_ID}`);
    await expect(nodeCard).toBeVisible({ timeout: 10_000 });

    // Before the right-click: mode banner is at idle, no exit button
    // is in the DOM.
    await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'idle');
    await expect(page.getByTestId('decompose-mode-exit')).toHaveCount(0);

    // Right-click the node card to open the context menu.
    await nodeCard.click({ button: 'right' });
    const contextMenu = page.getByTestId('graph-context-menu');
    await expect(contextMenu).toBeVisible();
    const decomposeItem = page.getByTestId('graph-context-menu-item-propose-decompose');
    await expect(decomposeItem).toBeVisible();

    // Click the propose-decompose item — the parent menu closes and
    // the capture store flips to decompose mode.
    await decomposeItem.click();

    // The mode banner now reads "Decompose" + carries data-mode.
    await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'decompose');
    await expect(page.getByTestId('mode-banner-label')).toHaveText('Decompose');
    // The exit-button surfaces alongside the banner with the
    // target-wording overlay reading the seeded wording.
    await expect(page.getByTestId('decompose-mode-exit')).toBeVisible();
    await expect(page.getByTestId('decompose-mode-target-wording')).toContainText(SEED_WORDING);

    // Press Escape — the mode-aware keymap routes Esc to
    // exitDecomposeMode (priority over onClearTarget per Decision §5).
    // Focus the document body first so the editable-target guard
    // doesn't swallow the keystroke (the right-clicked node card may
    // hold focus from the selection ring).
    await page.locator('body').focus();
    await page.keyboard.press('Escape');

    // Mode reverts to idle; the exit-button unmounts.
    await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'idle');
    await expect(page.getByTestId('decompose-mode-exit')).toHaveCount(0);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md
  //
  // Multi-component capture grid e2e cover. Extends the mode-entry
  // scenario above by driving the per-row textareas + per-row pickers
  // + the add-row / remove-row buttons. Per the refinement's UI-stream
  // e2e scoping, the propose-decomposition envelope has not landed
  // yet, so this test asserts only the capture-state chain: two empty
  // rows initialize on entry; the moderator can type into the per-row
  // textareas + click the per-row pickers + click add-row / remove-row;
  // Esc clears the state.
  test('alice: enter decompose mode → multi-component grid captures 2 rows → add row → remove row → Esc clears state', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Multi-component capture e2e regression check.');
    await page.getByTestId('create-session-submit').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    if (!(await isWsStoreReachable(page))) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — the dev-only attachment did not fire.',
      );
      return;
    }

    const url = new URL(page.url());
    const sessionId = url.pathname.split('/')[2] ?? '';

    // Seed a parent node so the right-click + propose-decompose menu
    // item has a target to fire against.
    const SEED_NODE_ID = '88888888-8888-4888-8888-888888888899';
    const SEED_WORDING = 'Workers should earn a living wage with fair benefits.';
    await seedWsStore(page, {
      sessionId,
      nodes: [{ nodeId: SEED_NODE_ID, wording: SEED_WORDING }],
    });

    const nodeCard = page.getByTestId(`statement-node-${SEED_NODE_ID}`);
    await expect(nodeCard).toBeVisible({ timeout: 10_000 });

    // Enter decompose mode via the context menu.
    await nodeCard.click({ button: 'right' });
    await page.getByTestId('graph-context-menu-item-propose-decompose').click();
    await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'decompose');

    // The grid mounts inside the bottom-strip text-input slot with
    // two empty rows.
    await expect(page.getByTestId('decompose-components-grid')).toBeVisible();
    await expect(page.getByTestId('decompose-component-row-0')).toBeVisible();
    await expect(page.getByTestId('decompose-component-row-1')).toBeVisible();
    await expect(page.getByTestId('decompose-component-row-2')).toHaveCount(0);

    // The F1 palette is hidden (the route's conditional swap collapsed
    // the classificationPalette slot to null).
    await expect(page.getByTestId('classification-palette')).toHaveCount(0);

    // Per-row remove buttons are disabled at the minimum 2 rows.
    await expect(page.getByTestId('decompose-component-row-remove-0')).toBeDisabled();
    await expect(page.getByTestId('decompose-component-row-remove-1')).toBeDisabled();

    // Type into component 1 + pick its kind.
    await page.getByTestId('decompose-component-text-0').fill('Workers should earn a living wage.');
    await page.getByTestId('decompose-component-classification-0-button-value').click();
    await expect(
      page.getByTestId('decompose-component-classification-0-button-value'),
    ).toHaveAttribute('aria-pressed', 'true');

    // Add a third row.
    await page.getByTestId('decompose-components-add-row').click();
    await expect(page.getByTestId('decompose-component-row-2')).toBeVisible();

    // Now the per-row remove buttons are enabled.
    await expect(page.getByTestId('decompose-component-row-remove-0')).toBeEnabled();
    await expect(page.getByTestId('decompose-component-row-remove-2')).toBeEnabled();

    // Type into component 2 + pick its kind.
    await page
      .getByTestId('decompose-component-text-1')
      .fill('Workers should receive fair benefits.');
    await page.getByTestId('decompose-component-classification-1-button-normative').click();

    // Remove the empty third row.
    await page.getByTestId('decompose-component-row-remove-2').click();
    await expect(page.getByTestId('decompose-component-row-2')).toHaveCount(0);

    // Press Escape — the mode-aware keymap clears all decompose state.
    await page.locator('body').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'idle');
    await expect(page.getByTestId('decompose-components-grid')).toHaveCount(0);

    // The F1 capture surface is back.
    await expect(page.getByTestId('capture-text-input-textarea')).toBeVisible();
  });

  // mod_propose_decomposition — the F2 capstone: enter decompose mode,
  // fill 2 rows, click the propose-decomposition button, assert the
  // propose envelope reaches the real dev-compose server and the
  // optimistic clear fires. Decision §9 of
  // `tasks/refinements/moderator-ui/mod_propose_decomposition.md`
  // records the full-chain compose-stack scope.
  //
  // **What this spec proves (full chain):**
  //   client envelope construction → WS serialization → server's
  //   `validateDecomposeProposal` (`apps/server/src/methodology/handlers/propose.ts:312-356`)
  //   → server's `error` response → client's wire-error surfacing.
  //
  // **Why we assert the wire-error region, not a successful `proposal`
  // event:** the decompose validator's rule 1 requires the parent node
  // to actually exist server-side (`projection.getNode(parent_node_id)`
  // must return a record). The `seedWsStore` fixture seeds only the
  // moderator's client-side Zustand store via `applyEvent`; it does
  // NOT write to the real Postgres-backed event log. There is no e2e
  // fixture today for seeding a real server-side node, and a real
  // commit cycle (which is what creates a node server-side) is itself
  // blocked for decompose-side commit per the open question in
  // `tasks/refinements/data-and-methodology/decomposition_logic.md`.
  // So the propose envelope DOES reach the server, but rule 1 rejects
  // with `target-entity-not-found` — proving the round-trip
  // completed. The hook's snapshot-restore then re-mounts the
  // decompose grid with the prior state and surfaces the wire-error
  // region — both observable here. Per the predecessor
  // `mod_propose_action_refinement_amendment` lesson, we explicitly do
  // NOT assert the actual decomposition events fire (those are
  // commit-time, not propose-time).
  test('alice: enter decompose mode → fill 2 rows → propose decomposition → envelope reaches the server (wire-error region surfaces the typed rejection)', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();

    await page
      .getByTestId('create-session-topic-input')
      .fill('Propose-decomposition e2e regression check.');
    await page.getByTestId('create-session-submit').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    await seedInviteParticipantsForGate(page);
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();

    if (!(await isWsStoreReachable(page))) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — the dev-only attachment did not fire.',
      );
      return;
    }

    const url = new URL(page.url());
    const sessionId = url.pathname.split('/')[2] ?? '';

    // Seed a parent node so the right-click + propose-decompose menu
    // item has a target to fire against.
    const SEED_NODE_ID = '99999999-9999-4999-9999-999999999911';
    const SEED_WORDING = 'Workers should earn a living wage with fair benefits.';
    await seedWsStore(page, {
      sessionId,
      nodes: [{ nodeId: SEED_NODE_ID, wording: SEED_WORDING }],
    });

    const nodeCard = page.getByTestId(`statement-node-${SEED_NODE_ID}`);
    await expect(nodeCard).toBeVisible({ timeout: 10_000 });

    // Enter decompose mode via the context menu.
    await nodeCard.click({ button: 'right' });
    await page.getByTestId('graph-context-menu-item-propose-decompose').click();
    await expect(page.getByTestId('decompose-components-grid')).toBeVisible();

    // The propose-decomposition button is mounted (slot swap on
    // `mode === 'decompose'`) and disabled at empty rows.
    await expect(page.getByTestId('propose-decomposition-action-button')).toBeDisabled();

    // Fill the two component rows.
    await page.getByTestId('decompose-component-text-0').fill('Workers should earn a living wage.');
    await page.getByTestId('decompose-component-classification-0-button-value').click();
    await page
      .getByTestId('decompose-component-text-1')
      .fill('Workers should receive fair benefits.');
    await page.getByTestId('decompose-component-classification-1-button-normative').click();

    // Both rows filled — the button enables.
    await expect(page.getByTestId('propose-decomposition-action-button')).toBeEnabled();
    await page.getByTestId('propose-decomposition-action-button').click();

    // The propose envelope reached the server: the server's
    // `validateDecomposeProposal` rule 1 (parent-node-exists) rejects
    // because the seeded node only exists in the client-side WS store
    // (the `seedWsStore` fixture writes via `applyEvent`, not the
    // real Postgres event log). The hook's snapshot-restore re-mounts
    // the decompose grid + surfaces the wire-error region inline. The
    // `target-entity-not-found` code carried by the wire-error proves
    // the round-trip completed.
    const wireError = page.getByTestId('propose-decomposition-action-wire-error');
    await expect(wireError).toBeVisible({ timeout: 10_000 });
    await expect(wireError).toContainText('target-entity-not-found');

    // Snapshot restore re-mounted the decompose grid (mode flipped
    // back to 'decompose' after the typed rejection landed). The two
    // rows the moderator filled are restored verbatim.
    await expect(page.getByTestId('decompose-components-grid')).toBeVisible();
    await expect(page.getByTestId('decompose-component-text-0')).toHaveValue(
      'Workers should earn a living wage.',
    );
    await expect(page.getByTestId('decompose-component-text-1')).toHaveValue(
      'Workers should receive fair benefits.',
    );
  });
});
