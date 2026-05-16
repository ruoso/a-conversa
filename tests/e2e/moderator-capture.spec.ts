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

import { expect, test } from '@playwright/test';

import { loginAs } from './fixtures/auth';
import { isWsStoreReachable, seedWsStore } from './fixtures/wsStoreSeed';

const TEST_USERNAME = 'alice';

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
});
