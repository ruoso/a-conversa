// E2E spec for the moderator's `Cmd/Ctrl+Shift+Enter` commit-of-selected
// chord on the operate route.
//
// Refinement:
//   tasks/refinements/moderator-ui/mod_proposal_selection_commit_chord.md
// ADRs: 0008 (Playwright + compose layering), 0022 (no throwaway
//       verifications / no seeded fake e2e), 0030 (per-facet keying).
// TaskJuggler:
//   moderator_ui.mod_keyboard_shortcuts.mod_proposal_selection_commit_chord
//
// **The deferred-e2e debt this pays down.** `mod_global_keymap` registered
// the commit chord but left it unreachable and explicitly deferred the
// Playwright spec to THIS task ("which makes the surface reachable and
// MUST scope the Playwright spec"). With the proposal-selection model +
// the bridge hook landed, the chord is now a live, user-visible gesture —
// this spec drives it end-to-end against a real backend.
//
// **What this pins (real backend, no seeded WS state).**
//   - Positive: maria captures a node, both debaters vote `agree`, maria
//     CLICKS the pending row (asserts `data-selected="true"`) and presses
//     `Cmd/Ctrl+Shift+Enter` — the row clears (commit fired via keyboard,
//     the keyboard alias of clicking the row's commit button).
//   - Negative: a not-all-agree proposal is selected; the chord is a
//     no-op (the row stays; its commit button is not `enabled`).
//
// Three real browser contexts (maria = moderator, alice + ben = debaters)
// reach operate the same way `full-session-walkthrough` does, then drive
// the commit-chord beats.

import { expect, test, type BrowserContext, type Page } from './fixtures/no-scrollbars';

import { authedContext } from './fixtures/authed-context';

const LIVE_TIMEOUT = 15_000;

const TOPIC = 'Should the commit chord land?';
const N_AGREE = 'Modern accredited zoos, on balance, do more good than harm.';
const N_NO_AGREE = 'Confinement imposes a morally significant cost on the individual.';

// `Cmd/Ctrl+Shift+Enter` — the commit-of-selected chord. Platform-adaptive
// exactly like the snapshot spec's `Meta+s` / `Control+s`.
const commitChord = process.platform === 'darwin' ? 'Meta+Shift+Enter' : 'Control+Shift+Enter';

let mariaContext: BrowserContext; // moderator
let aliceContext: BrowserContext; // debater-A
let benContext: BrowserContext; // debater-B
let mariaPage: Page;
let alicePage: Page;
let benPage: Page;
let sessionId: string;

function debaterPages(): Page[] {
  return [alicePage, benPage];
}

/** Recover a node id from its rendered wording on the moderator canvas. */
async function readNodeIdByWording(wording: string): Promise<string> {
  const wordingLocator = mariaPage.locator('[data-testid^="statement-node-wording-"]', {
    hasText: wording,
  });
  await expect(wordingLocator).toBeVisible({ timeout: LIVE_TIMEOUT });
  const testid = await wordingLocator.getAttribute('data-testid');
  expect(testid).toMatch(/^statement-node-wording-[0-9a-f-]+$/);
  return testid!.replace(/^statement-node-wording-/, '');
}

/** Maria captures a free-floating wording-only node and returns its id. */
async function captureNode(wording: string): Promise<string> {
  const clearTarget = mariaPage.getByTestId('capture-target-chip-clear');
  if (await clearTarget.isVisible().catch(() => false)) {
    await clearTarget.click();
  }
  await mariaPage.getByTestId('capture-text-input-textarea').fill(wording);
  const proposeButton = mariaPage.getByTestId('propose-action-button');
  await expect(proposeButton).toBeEnabled({ timeout: LIVE_TIMEOUT });
  await proposeButton.click();
  await expect(mariaPage.getByTestId('capture-text-input-textarea')).toHaveValue('', {
    timeout: LIVE_TIMEOUT,
  });
  return readNodeIdByWording(wording);
}

/** Both debaters vote agree on the auto-selected node's `wording` facet. */
async function voteAgreeOnWording(expectWording: string): Promise<void> {
  for (const page of debaterPages()) {
    await expect(page.getByTestId('participant-detail-panel-identity-wording')).toHaveText(
      expectWording,
      { timeout: LIVE_TIMEOUT },
    );
    const row = page.locator(
      '[data-testid="participant-detail-panel-facet-row"][data-facet-name="wording"]',
    );
    await expect(row).toBeVisible({ timeout: LIVE_TIMEOUT });
    await row.getByTestId('participant-vote-button-agree').click();
    await expect(row).toHaveAttribute('data-vote-state', 'enabled', { timeout: LIVE_TIMEOUT });
  }
}

test.describe.serial('moderator commit-of-selected chord (Cmd/Ctrl+Shift+Enter)', () => {
  test.beforeAll(async ({ browser }) => {
    mariaContext = await authedContext(browser, 'maria');
    mariaPage = await mariaContext.newPage();
    aliceContext = await authedContext(browser, 'alice');
    alicePage = await aliceContext.newPage();
    benContext = await authedContext(browser, 'ben');
    benPage = await benContext.newPage();
  });

  test.afterAll(async () => {
    await benContext?.close();
    await aliceContext?.close();
    await mariaContext?.close();
  });

  test('all three reach operate (maria creates; alice + ben self-claim)', async () => {
    await mariaPage.goto('/m/sessions/new');
    await expect(mariaPage.getByTestId('route-create-session')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await mariaPage.getByTestId('create-session-topic-input').fill(TOPIC);
    await mariaPage.getByTestId('create-session-submit').click();
    await mariaPage.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/invite$/, { timeout: LIVE_TIMEOUT });
    const captured = mariaPage.url().match(/\/m\/sessions\/([0-9a-f-]+)\/invite$/)?.[1];
    if (captured === undefined) {
      throw new Error(`could not extract session id from invite URL: ${mariaPage.url()}`);
    }
    sessionId = captured;

    await alicePage.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
    await expect(alicePage.getByTestId('route-invite-acceptance')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await alicePage.getByTestId('invite-acceptance-join-button').click();
    await alicePage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
      timeout: LIVE_TIMEOUT,
    });

    await benPage.goto(`/p/sessions/${sessionId}/invite?role=debater-B`);
    await expect(benPage.getByTestId('route-invite-acceptance')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await benPage.getByTestId('invite-acceptance-join-button').click();
    await benPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
      timeout: LIVE_TIMEOUT,
    });

    const enterButton = mariaPage.getByTestId('invite-enter-session');
    await expect(enterButton).toBeEnabled({ timeout: LIVE_TIMEOUT });
    await enterButton.click();

    await mariaPage.waitForURL((url) => url.pathname === `/m/sessions/${sessionId}/operate`, {
      timeout: LIVE_TIMEOUT,
    });
    await expect(mariaPage.getByTestId('route-operate')).toBeVisible();
    await expect(mariaPage.getByTestId('graph-canvas-root')).toBeVisible({ timeout: LIVE_TIMEOUT });

    for (const page of debaterPages()) {
      await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
        timeout: LIVE_TIMEOUT,
      });
    }
  });

  test('positive — selected all-agree proposal commits via the keyboard chord', async () => {
    await captureNode(N_AGREE);
    await voteAgreeOnWording(N_AGREE);

    // The single pending row — its commit button is `enabled` once both
    // debaters' `agree` votes have landed.
    const row = mariaPage.getByTestId('pending-proposal-row');
    await expect(row).toHaveCount(1, { timeout: LIVE_TIMEOUT });
    const commit = row.locator('[data-testid="commit-button"]');
    await expect(commit).toHaveAttribute('data-commit-state', 'enabled', {
      timeout: LIVE_TIMEOUT,
    });

    // Select the row (click the body — the summary, not a control) and
    // confirm the selection ring's `data-selected` seam.
    await row.getByTestId('pending-proposal-row-summary').click();
    await expect(row).toHaveAttribute('data-selected', 'true', { timeout: LIVE_TIMEOUT });

    // The keyboard chord commits the SELECTED row — the row clears.
    await mariaPage.keyboard.press(commitChord);
    await expect(row).toHaveCount(0, { timeout: LIVE_TIMEOUT });
  });

  test('negative — the chord is a no-op when the selected proposal is not all-agree', async () => {
    await captureNode(N_NO_AGREE);

    // No debater votes — the gate stays closed.
    const row = mariaPage.getByTestId('pending-proposal-row');
    await expect(row).toHaveCount(1, { timeout: LIVE_TIMEOUT });
    const commit = row.locator('[data-testid="commit-button"]');
    await expect(commit).not.toHaveAttribute('data-commit-state', 'enabled', {
      timeout: LIVE_TIMEOUT,
    });

    await row.getByTestId('pending-proposal-row-summary').click();
    await expect(row).toHaveAttribute('data-selected', 'true', { timeout: LIVE_TIMEOUT });

    // Chord fires, but the closed gate makes it a no-op — the row stays.
    await mariaPage.keyboard.press(commitChord);
    await expect(row).toHaveCount(1);
    await expect(commit).not.toHaveAttribute('data-commit-state', 'enabled');
  });
});
