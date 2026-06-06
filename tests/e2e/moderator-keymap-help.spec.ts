// E2E spec for the `?`-toggled keymap-help overlay on the moderator's
// operate route.
//
// Refinement: tasks/refinements/moderator-ui/mod_keymap_help_overlay.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: moderator_ui.mod_keyboard_shortcuts.mod_keymap_help_overlay
//
// **What this spec pins.** The overlay is reachable on /operate, so e2e
// is in scope (not deferred). The overlay reads the live GLOBAL_KEYMAP
// and renders each entry as `<chord glyph> : <localized label>`. This
// spec asserts the reachable end-to-end behaviour:
//
//   1. Pressing `?` shows the overlay.
//   2. A known reachable row (snapshot) renders its chord + label.
//   3. A reachable: false row (action.commit) is present and dimmed —
//      proving the deferred commit chord is advertised-but-dim today
//      (the wiring the orchestrator asked for).
//   4. Escape closes the overlay.
//   5. The sidebar help button opens it.
//   6. Typing `?` into the capture wording textarea does NOT open the
//      overlay (the editable-target bail).
//
// **Single locale (en-US).** Cross-locale label resolution is pinned at
// the catalog-parity + KeymapHelpOverlay.test.tsx layers; this spec
// asserts the toggle + render plumbing, reaching elements by
// `data-testid`.

import { expect, test } from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';
import { seedParticipants } from './fixtures/wsStoreSeed';
import type { Page } from '@playwright/test';

const TEST_USERNAME = 'alice';

// mod_session_lobby strict-gates the invite Enter-session button until
// both debaters are filled. Seed both via the WS test seam so the gate
// opens. Mirrors the helper in moderator-snapshot.spec.ts.
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

async function reachOperate(page: Page, topic: string): Promise<void> {
  await loginAs(page, { username: TEST_USERNAME });
  await page.goto('/m/sessions/new');
  await expect(page.getByTestId('route-create-session')).toBeVisible();
  await page.getByTestId('create-session-topic-input').fill(topic);
  await page.getByTestId('create-session-submit').click();
  await page.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
  await seedInviteParticipantsForGate(page);
  await page.getByTestId('invite-enter-session').click();
  await page.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
  await expect(page.getByTestId('route-operate')).toBeVisible();
}

// The composed chord glyph is locale-independent but platform-dependent:
// `⌘+S` on macOS, `Ctrl+S` elsewhere (formatChord + isMacPlatform).
const EXPECTED_SNAPSHOT_CHORD = process.platform === 'darwin' ? '⌘+S' : 'Ctrl+S';

test.describe('moderator keymap-help overlay — `?` toggles the GLOBAL_KEYMAP cheat-sheet', () => {
  test('Test 1 — pressing `?` shows the keymap-help overlay', async ({ page }) => {
    await reachOperate(page, 'Keymap help overlay open regression check.');

    const overlay = page.getByTestId('keymap-help-overlay');
    await expect(overlay).toHaveCount(0);

    // Focus the page body (not an editable target) before the chord.
    await page.getByTestId('route-operate').click();
    await page.keyboard.press('?');
    await expect(overlay, 'pressing `?` opens the overlay').toBeVisible();
  });

  test('Test 2 — a reachable row (snapshot) renders its chord glyph + localized label', async ({
    page,
  }) => {
    await reachOperate(page, 'Keymap help overlay reachable-row regression check.');

    await page.getByTestId('route-operate').click();
    await page.keyboard.press('?');
    await expect(page.getByTestId('keymap-help-overlay')).toBeVisible();

    const snapshotRow = page.getByTestId('keymap-help-row-action.snapshot');
    await expect(snapshotRow).toBeVisible();
    await expect(snapshotRow).toHaveAttribute('data-keymap-entry-reachable', 'true');
    await expect(page.getByTestId('keymap-help-chord-action.snapshot')).toHaveText(
      EXPECTED_SNAPSHOT_CHORD,
    );
    await expect(snapshotRow).toContainText('Snapshot');
  });

  test('Test 3 — the deferred commit row is present, dimmed (reachable=false)', async ({
    page,
  }) => {
    await reachOperate(page, 'Keymap help overlay coming-soon-row regression check.');

    await page.getByTestId('route-operate').click();
    await page.keyboard.press('?');
    await expect(page.getByTestId('keymap-help-overlay')).toBeVisible();

    const commitRow = page.getByTestId('keymap-help-row-action.commit');
    await expect(commitRow, 'the commit chord is advertised even though deferred').toBeVisible();
    await expect(commitRow).toHaveAttribute('data-keymap-entry-reachable', 'false');
    await expect(page.getByTestId('keymap-help-coming-soon-action.commit')).toBeVisible();
  });

  test('Test 4 — Escape closes the overlay', async ({ page }) => {
    await reachOperate(page, 'Keymap help overlay escape-close regression check.');

    await page.getByTestId('route-operate').click();
    await page.keyboard.press('?');
    const overlay = page.getByTestId('keymap-help-overlay');
    await expect(overlay).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
  });

  test('Test 5 — the sidebar help button opens the overlay', async ({ page }) => {
    await reachOperate(page, 'Keymap help overlay button-open regression check.');

    const overlay = page.getByTestId('keymap-help-overlay');
    await expect(overlay).toHaveCount(0);

    await page.getByTestId('keymap-help-button').click();
    await expect(overlay, 'clicking the help button opens the overlay').toBeVisible();
  });

  test('Test 6 — typing `?` into the capture wording textarea does NOT open the overlay', async ({
    page,
  }) => {
    await reachOperate(page, 'Keymap help overlay editable-bail regression check.');

    const textarea = page.getByTestId('capture-text-input-textarea');
    await expect(textarea).toBeVisible();
    await textarea.click();
    await textarea.type('why? because');

    // The overlay must stay closed — the `?` was text entry, not a help
    // request (editable-target bail).
    await expect(page.getByTestId('keymap-help-overlay')).toHaveCount(0);
    // The character landed in the textarea.
    await expect(textarea).toHaveValue('why? because');
  });
});
