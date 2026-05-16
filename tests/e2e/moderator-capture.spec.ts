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
});
