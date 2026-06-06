// E2E spec for the F10 snapshot-trigger affordance on the moderator's
// operate route.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_action.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: moderator_ui.mod_snapshot_flow.mod_snapshot_action
//
// **What this spec pins.** The snapshot-flow store is module-scoped
// inside the moderator bundle and not (yet) exposed on `window`. The
// trigger flag is reflected onto the layout root as
// `data-snapshot-flow-open="true"|"false"` (Decision §3 — the
// testability seam). This spec asserts the two trigger paths:
//
//   - Test 1 — sidebar button: visible on the operate route, the
//     seam attribute defaults to `"false"`, clicking the button flips
//     it to `"true"`.
//   - Test 2 — Cmd/Ctrl+S shortcut: from a clean page, the seam
//     defaults to `"false"`, dispatching the chord flips it to
//     `"true"`. The browser's "Save Page As…" dialog MUST NOT fire
//     (asserted via `page.on('dialog', ...)` — the listener throws
//     if any dialog appears during the chord).
//
// **No modal yet.** The `mod_snapshot_label_input` sibling task lands
// the modal that observes the trigger flag; until then, the data-
// attribute seam is the only end-to-end observable. Once the modal
// lands, the spec there can replace the seam assertion with the
// modal's own selector — or the seam can stay as a regression cover
// for the trigger plumbing (Decision §3 explicitly leaves both
// options open).
//
// **Single locale (en-US).** The cross-locale label / aria-label
// resolution is pinned at the catalog-parity layer in
// `SnapshotActionButton.test.tsx`; this spec only asserts the trigger
// plumbing, which is locale-independent. The button is reached by
// `data-testid="snapshot-action-button"`, not by visible text.

import { expect, test } from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';
import { seedParticipants } from './fixtures/wsStoreSeed';
import type { Page } from '@playwright/test';

const TEST_USERNAME = 'alice';

// mod_session_lobby strict-gates the invite Enter-session button until
// both debaters are filled. Seed both via the WS test seam so the gate
// opens (the snapshot-trigger assertions live on /operate, not on the
// gate behaviour). Mirrors the helper in moderator-capture.spec.ts.
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

test.describe('moderator snapshot trigger — sidebar button + Cmd/Ctrl+S shortcut both flip the trigger flag', () => {
  test('Test 1 — clicking the sidebar button flips data-snapshot-flow-open to "true"', async ({
    page,
  }) => {
    await reachOperate(page, 'Snapshot trigger button regression check.');

    const button = page.getByTestId('snapshot-action-button');
    await expect(button, 'the snapshot-action button mounts in the right sidebar').toBeVisible();

    const layoutRoot = page.getByTestId('operate-layout-root');
    await expect(
      layoutRoot,
      'data-snapshot-flow-open baseline is "false" before any trigger',
    ).toHaveAttribute('data-snapshot-flow-open', 'false');

    await button.click();
    await expect(
      layoutRoot,
      'clicking the button flips data-snapshot-flow-open to "true"',
    ).toHaveAttribute('data-snapshot-flow-open', 'true');
  });

  test('Test 3 — clicking sidebar button opens the modal; typing + submit closes the modal and flips data-snapshot-flow-open back to "false"', async ({
    page,
  }) => {
    await reachOperate(page, 'Snapshot modal submit-success regression check.');

    const layoutRoot = page.getByTestId('operate-layout-root');
    const modal = page.getByTestId('snapshot-label-input-modal');
    const input = page.getByTestId('snapshot-label-input-field');
    const submit = page.getByTestId('snapshot-label-input-submit');

    await expect(modal).toHaveCount(0);
    await page.getByTestId('snapshot-action-button').click();
    await expect(modal, 'modal mounts after the button click').toBeVisible();
    await expect(layoutRoot).toHaveAttribute('data-snapshot-flow-open', 'true');

    await input.fill('Segment 1 close');
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(modal, 'modal unmounts after a successful submit ack').toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(
      layoutRoot,
      'data-snapshot-flow-open flips back to "false" once the modal closes',
    ).toHaveAttribute('data-snapshot-flow-open', 'false');
  });

  test('Test 4 — pressing Escape inside the open modal closes it and flips data-snapshot-flow-open back to "false"', async ({
    page,
  }) => {
    await reachOperate(page, 'Snapshot modal Escape regression check.');

    const layoutRoot = page.getByTestId('operate-layout-root');
    const modal = page.getByTestId('snapshot-label-input-modal');

    await page.getByTestId('snapshot-action-button').click();
    await expect(modal).toBeVisible();
    await expect(layoutRoot).toHaveAttribute('data-snapshot-flow-open', 'true');

    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(layoutRoot).toHaveAttribute('data-snapshot-flow-open', 'false');
  });

  test('Test 5 — Cmd/Ctrl+S while the modal is open is a no-op (open() is idempotent)', async ({
    page,
  }) => {
    await reachOperate(page, 'Snapshot modal idempotent-shortcut regression check.');

    const layoutRoot = page.getByTestId('operate-layout-root');
    const modal = page.getByTestId('snapshot-label-input-modal');

    await page.getByTestId('snapshot-action-button').click();
    await expect(modal).toBeVisible();
    await expect(layoutRoot).toHaveAttribute('data-snapshot-flow-open', 'true');

    const chord = process.platform === 'darwin' ? 'Meta+s' : 'Control+s';
    await page.keyboard.press(chord);

    // The chord must NOT close the modal and must NOT navigate.
    await expect(modal, 'modal stays open after the chord').toBeVisible();
    await expect(layoutRoot).toHaveAttribute('data-snapshot-flow-open', 'true');
    await expect(page).toHaveURL(/\/m\/sessions\/[0-9a-f-]+\/operate$/);
  });

  test('Test 6 — clicking the backdrop (outside the card) closes the modal', async ({ page }) => {
    await reachOperate(page, 'Snapshot modal backdrop-click regression check.');

    const layoutRoot = page.getByTestId('operate-layout-root');
    const modal = page.getByTestId('snapshot-label-input-modal');

    await page.getByTestId('snapshot-action-button').click();
    await expect(modal).toBeVisible();

    // Click near the top-left corner of the backdrop — well outside the
    // centered card. The backdrop element IS the modal root (the card
    // is a child), so clicking the root targets the backdrop directly.
    const box = await modal.boundingBox();
    if (box === null) throw new Error('modal bounding box is null');
    await page.mouse.click(box.x + 10, box.y + 10);

    await expect(modal).toHaveCount(0);
    await expect(layoutRoot).toHaveAttribute('data-snapshot-flow-open', 'false');
  });

  test('Test 2 — Cmd/Ctrl+S keyboard shortcut flips data-snapshot-flow-open without firing the browser save dialog', async ({
    page,
  }) => {
    // The browser's "Save Page As…" dialog is fired as a `beforeunload`
    // /  print-style event — Playwright's `page.on('dialog')` covers
    // window.alert / confirm / prompt / beforeunload. Wire up a listener
    // that fails the test if anything pops; the listener is a no-op
    // unless preventDefault() failed and the chord leaked to the host.
    const dialogPromises: Array<Promise<void>> = [];
    page.on('dialog', (dialog) => {
      dialogPromises.push(
        (async () => {
          await dialog.dismiss();
          throw new Error(`Unexpected dialog fired: ${dialog.type()} — ${dialog.message()}`);
        })(),
      );
    });

    await reachOperate(page, 'Snapshot trigger shortcut regression check.');

    const layoutRoot = page.getByTestId('operate-layout-root');
    await expect(layoutRoot).toHaveAttribute('data-snapshot-flow-open', 'false');

    // Pick the platform-appropriate chord. Playwright's `keyboard.press`
    // dispatches the modifier + key as a single chord; the moderator's
    // action-chord dispatcher (`useGlobalKeymap` — mod_global_keymap
    // consolidated the former standalone `useSnapshotShortcut` into it)
    // reads `event.metaKey` on macOS and `event.ctrlKey` elsewhere. This
    // test is the regression pin for that consolidation: the Cmd/Ctrl+S
    // behaviour must remain unchanged through the dispatcher swap.
    const chord = process.platform === 'darwin' ? 'Meta+s' : 'Control+s';
    // Click the operate route's main element first so the chord lands
    // with focus inside the page (rather than the URL bar or a
    // chrome-level overlay). The route-operate testid is on the
    // <main> element wrapping the layout.
    await page.getByTestId('route-operate').click();
    await page.keyboard.press(chord);

    await expect(layoutRoot).toHaveAttribute('data-snapshot-flow-open', 'true');

    // The page must still be on the operate URL — a leaked Cmd/Ctrl+S
    // could fire navigation under a frame-trapping browser action.
    await expect(page).toHaveURL(/\/m\/sessions\/[0-9a-f-]+\/operate$/);

    // No dialog should have fired. If `page.on('dialog')` queued
    // anything, awaiting the promise re-throws and fails the test.
    await Promise.all(dialogPromises);
  });

  // -- mod_snapshot_visual_marker — pay down deferred-e2e debt -------
  //
  // The marker is the on-graph visual confirmation that an F10 snapshot
  // landed. Tests 7 and 8 close the loop registered by
  // `mod_snapshot_label_input` ("labeled-snapshot event arrives →
  // marker renders") by driving the modal end-to-end and asserting
  // the canvas-corner overlay updates.

  test('Test 7 — submitting a labeled snapshot mounts the snapshot-marker strip with one card carrying the label', async ({
    page,
  }) => {
    await reachOperate(page, 'Snapshot marker landing regression check.');

    // Baseline: no snapshots → strip is absent.
    await expect(
      page.getByTestId('snapshot-marker-strip'),
      'no marker strip mounts when no snapshot-created events exist',
    ).toHaveCount(0);

    // Drive the modal: open → type → submit.
    await page.getByTestId('snapshot-action-button').click();
    const modal = page.getByTestId('snapshot-label-input-modal');
    await expect(modal).toBeVisible();
    await page.getByTestId('snapshot-label-input-field').fill('Segment 1 close');
    await page.getByTestId('snapshot-label-input-submit').click();
    await expect(modal, 'modal unmounts after a successful submit ack').toHaveCount(0, {
      timeout: 10_000,
    });

    // The `snapshot-created` event has now flowed through the
    // projection. The strip appears with one card whose
    // `data-snapshot-label` mirrors the submitted text.
    const strip = page.getByTestId('snapshot-marker-strip');
    await expect(strip, 'marker strip mounts once the snapshot event is projected').toBeVisible();
    const cards = strip.locator(
      '[data-testid^="snapshot-marker-"]:not([data-testid="snapshot-marker-overflow"])',
    );
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute('data-snapshot-label', 'Segment 1 close');
  });

  test('Test 8 — a second snapshot stacks newest-first in the marker strip', async ({ page }) => {
    await reachOperate(page, 'Snapshot marker reverse-chrono regression check.');

    // First snapshot via sidebar button + modal.
    await page.getByTestId('snapshot-action-button').click();
    await page.getByTestId('snapshot-label-input-field').fill('Segment 1 close');
    await page.getByTestId('snapshot-label-input-submit').click();
    await expect(page.getByTestId('snapshot-label-input-modal')).toHaveCount(0, {
      timeout: 10_000,
    });

    // Second snapshot via Cmd/Ctrl+S shortcut + modal.
    const chord = process.platform === 'darwin' ? 'Meta+s' : 'Control+s';
    await page.getByTestId('route-operate').click();
    await page.keyboard.press(chord);
    await expect(page.getByTestId('snapshot-label-input-modal')).toBeVisible();
    await page.getByTestId('snapshot-label-input-field').fill('Segment 2 close');
    await page.getByTestId('snapshot-label-input-submit').click();
    await expect(page.getByTestId('snapshot-label-input-modal')).toHaveCount(0, {
      timeout: 10_000,
    });

    // Both cards visible; newest first.
    const strip = page.getByTestId('snapshot-marker-strip');
    await expect(strip).toBeVisible();
    const cards = strip.locator(
      '[data-testid^="snapshot-marker-"]:not([data-testid="snapshot-marker-overflow"])',
    );
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute('data-snapshot-label', 'Segment 2 close');
    await expect(cards.nth(1)).toHaveAttribute('data-snapshot-label', 'Segment 1 close');
  });
});
