// Cross-surface annotation-dispute round-trip — three real browser
// contexts (alice moderator + ben/maria debaters) driving the full
// post-commit annotation-dispute flow against the compose stack.
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_dispute_e2e.md
//
// This is the single coherent round-trip that discharges the
// disputed-annotation Playwright cover three predecessors deferred to
// this wiring task (`mod_meta_move_disputed_visibility` Decision §4,
// `annotation_facet_status_logic` AC, `annotation_facet_vote_seam` AC).
// Per Decision §1 it uses ONLY real server state — no `wsStoreSeed` for
// the dispute: the precondition annotation is minted by a real committed
// reframe meta-move, and the dispute is a real participant vote that the
// moderator badge reflects over genuine WS broadcast.
//
// Flow:
//   1. alice creates a session; ben + maria join and reach operate.
//   2. alice captures a node N1, then proposes a reframe meta-move on it
//      (F8 → stage node → content → Ctrl+Enter).
//   3. ben + maria cast real agree votes on the meta-move proposal
//      (participant proposals tab); alice commits it (`commit-button`) →
//      `annotation-created`. The moderator graph shows the reframe
//      `annotation-badge-<id>` (initially NOT disputed).
//   4. ben selects the annotation (taps N1 via the cy seam → clicks its
//      `participant-detail-panel-annotation-row` → annotation detail) and
//      clicks the new dispute affordance.
//   5. Assert: ben's affordance settles + reflects the resolved
//      `disputed` substance status; and alice's `annotation-badge-<id>`
//      gains `data-facet-status="disputed"` within the live-propagation
//      timeout.
//
// ADRs: 0008 (Playwright + compose layering); 0022 (no throwaway
// verifications / no seeded fake e2e); 0030 (facet-keyed vote arm);
// 0038 (annotations disputable post-commit via substance-facet votes).

import { expect, test, type BrowserContext, type Page } from './fixtures/no-scrollbars';
import { authedContext } from './fixtures/authed-context';

const TOPIC = 'Annotation-dispute round-trip reaches the moderator badge';
const N1_WORDING = 'Markets clear at the margin in competitive equilibrium.';
const REFRAME_CONTENT =
  'Reframe: the clearing claim is really a claim about the marginal trade, not the average.';

const LIVE_TIMEOUT = 15_000;

let aliceContext: BrowserContext;
let benContext: BrowserContext;
let mariaContext: BrowserContext;
let alicePage: Page;
let benPage: Page;
let mariaPage: Page;
let sessionId: string;
let n1Id: string;
let annotationId: string;

/**
 * Locate the node id rendered on a moderator canvas for a given wording.
 * Mirrors `methodology-full-flow.spec.ts`'s `readNodeIdByWording`.
 */
async function readNodeIdByWording(page: Page, wording: string): Promise<string> {
  const wordingLocator = page.locator('[data-testid^="statement-node-wording-"]', {
    hasText: wording,
  });
  await expect(wordingLocator).toBeVisible({ timeout: LIVE_TIMEOUT });
  const testid = await wordingLocator.getAttribute('data-testid');
  expect(testid).toMatch(/^statement-node-wording-[0-9a-f-]+$/);
  return testid!.replace(/^statement-node-wording-/, '');
}

/**
 * Click a moderator graph node, polling the click until the capture
 * target-chip flips to carry the expected staged-target substring.
 * Mirrors `moderator-capture.spec.ts`'s `clickNodeUntilTargetStaged`.
 */
async function clickNodeUntilTargetStaged(
  page: Page,
  nodeLocator: ReturnType<Page['locator']>,
  expectedTargetSubstring: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await nodeLocator.click();
        return (await page.getByTestId('capture-target-chip-label').textContent()) ?? '';
      },
      { intervals: [50, 100, 200, 500, 1000], timeout: 5_000 },
    )
    .toContain(expectedTargetSubstring);
}

/**
 * Cast a real agree vote on the pending reframe meta-move proposal from a
 * debater's proposals tab. Switches to the proposals tab, expands the
 * meta-move row, and clicks the per-proposal agree button.
 */
async function agreeOnMetaMove(page: Page): Promise<void> {
  await page.getByTestId('participant-proposals-tabbar-proposals').click();
  await expect(page.getByTestId('participant-pending-proposals-pane')).toBeVisible({
    timeout: LIVE_TIMEOUT,
  });
  const row = page
    .locator('[data-testid="participant-pending-proposal-row"]')
    .filter({
      has: page.locator('[data-testid="participant-pending-proposal-row-kind"]', {
        hasText: 'meta-move',
      }),
    })
    .first();
  await expect(row).toBeVisible({ timeout: LIVE_TIMEOUT });
  // Expand the row so the per-proposal facet breakdown (with its vote
  // buttons) mounts.
  if ((await row.getAttribute('data-expanded')) !== 'true') {
    await row.getByTestId('participant-pending-proposal-row-header').click();
  }
  const facet = row.locator(
    '[data-testid="participant-pending-proposal-row-facet"][data-facet-name="proposal"]',
  );
  await expect(facet).toBeVisible({ timeout: LIVE_TIMEOUT });
  const agree = facet.getByTestId('participant-pending-proposal-row-facet-vote-button-agree');
  await expect(agree).toBeVisible({ timeout: LIVE_TIMEOUT });
  await agree.click();
  // Settle: the wire round-trip must not error. On success the latest-
  // vote-wins projection flips the chip into change-vote mode (the agree
  // button is hidden, only the opposite-side dispute button remains).
  await expect(
    facet.getByTestId('participant-pending-proposal-row-facet-vote-button-error'),
  ).toHaveCount(0);
  await expect(agree).toHaveCount(0, { timeout: LIVE_TIMEOUT });
}

test.describe
  .serial('Annotation-dispute round-trip — three real browser sessions (alice mod + ben/maria debaters)', () => {
  test.beforeAll(async ({ browser }) => {
    aliceContext = await authedContext(browser, 'alice');
    alicePage = await aliceContext.newPage();
    benContext = await authedContext(browser, 'ben');
    benPage = await benContext.newPage();
    mariaContext = await authedContext(browser, 'maria');
    mariaPage = await mariaContext.newPage();
  });

  test.afterAll(async () => {
    await mariaContext?.close();
    await benContext?.close();
    await aliceContext?.close();
  });

  test('Phase 1: alice creates a session; ben + maria join and all three reach operate', async () => {
    // alice creates the session via the moderator UI.
    await alicePage.goto('/m/sessions/new');
    await expect(alicePage.getByTestId('route-create-session')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await alicePage.getByTestId('create-session-topic-input').fill(TOPIC);
    await alicePage.getByTestId('create-session-privacy-public').click();
    await alicePage.getByTestId('create-session-submit').click();
    await alicePage.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/invite$/, { timeout: LIVE_TIMEOUT });
    const match = alicePage.url().match(/\/m\/sessions\/([0-9a-f-]+)\/invite$/);
    expect(match, 'invite-route url must carry a session id').not.toBeNull();
    sessionId = match![1] as string;
    await expect(alicePage.getByTestId('route-invite-participants')).toBeVisible();

    // ben self-claims debater-A.
    await benPage.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
    await expect(benPage.getByTestId('route-invite-acceptance')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await benPage.getByTestId('invite-acceptance-join-button').click();
    await benPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
      timeout: LIVE_TIMEOUT,
    });
    await expect(benPage.getByTestId('lobby-participant-debater-A-name')).toHaveText('ben');

    // maria self-claims debater-B.
    await mariaPage.goto(`/p/sessions/${sessionId}/invite?role=debater-B`);
    await expect(mariaPage.getByTestId('route-invite-acceptance')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await mariaPage.getByTestId('invite-acceptance-join-button').click();
    await mariaPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
      timeout: LIVE_TIMEOUT,
    });
    await expect(mariaPage.getByTestId('lobby-participant-debater-B-name')).toHaveText('maria');

    // alice's Enter-session gate opens once both debaters arrive (live WS).
    const enterButton = alicePage.getByTestId('invite-enter-session');
    await expect(enterButton).toBeEnabled({ timeout: LIVE_TIMEOUT });
    await enterButton.click();
    await alicePage.waitForURL((url) => url.pathname === `/m/sessions/${sessionId}/operate`, {
      timeout: LIVE_TIMEOUT,
    });
    await expect(alicePage.getByTestId('route-operate')).toBeVisible();

    // ben + maria hand off to the operate surface. ben re-loads with the
    // test-mode flag so the cy seam (`window.__aConversaCyInstance`) is
    // exposed for the node-tap selection in Phase 4 — maria only votes
    // through the proposals tab and needs no seam.
    await benPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
      timeout: LIVE_TIMEOUT,
    });
    await mariaPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
      timeout: LIVE_TIMEOUT,
    });
    await benPage.goto(`/p/sessions/${sessionId}?aconversaTestMode=1`);
    await expect(benPage.getByTestId('route-operate')).toBeVisible({ timeout: LIVE_TIMEOUT });
    await expect(benPage.getByTestId('participant-graph-root')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await benPage.waitForFunction(
      () =>
        Boolean((window as unknown as { __aConversaCyInstance?: unknown }).__aConversaCyInstance),
      undefined,
      { timeout: LIVE_TIMEOUT },
    );
    await expect(mariaPage.getByTestId('route-operate')).toBeVisible({ timeout: LIVE_TIMEOUT });
  });

  test('Phase 2: alice captures node N1 and proposes a reframe meta-move on it', async () => {
    // Capture N1 — emits `node-created`, a real targetable entity.
    await alicePage.getByTestId('capture-text-input-textarea').fill(N1_WORDING);
    await alicePage.getByTestId('propose-action-button').click();
    n1Id = await readNodeIdByWording(alicePage, N1_WORDING);

    // Lay the graph out so the freshly captured node is reliably
    // clickable for target staging.
    await alicePage.getByTestId('graph-tidy-up-button').click();

    // Stage N1 as the meta-move target, then F8 into meta-move mode.
    const n1Node = alicePage.locator(`[data-testid="statement-node-${n1Id}"]`);
    await expect(n1Node).toBeVisible({ timeout: LIVE_TIMEOUT });
    await clickNodeUntilTargetStaged(alicePage, n1Node, 'Markets clear');

    await alicePage.keyboard.press('F8');
    await expect(alicePage.getByTestId('meta-move-capture-pane')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });

    // Type the reframe content (kind defaults to reframe) and submit.
    const textarea = alicePage.getByTestId('capture-text-input-textarea');
    await textarea.fill(REFRAME_CONTENT);
    await expect(alicePage.getByTestId('meta-move-propose-button')).toBeEnabled({
      timeout: LIVE_TIMEOUT,
    });
    const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
    await textarea.press(submitKey);

    // The propose round-trip succeeds (N1 is real server state): no wire
    // error, and the meta-move proposal lands in alice's pending pane.
    await expect(alicePage.getByTestId('meta-move-propose-error')).toHaveCount(0, {
      timeout: LIVE_TIMEOUT,
    });
    const metaMoveRow = alicePage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: alicePage.locator('[data-testid="pending-proposal-row-kind"]', {
          hasText: 'meta-move',
        }),
      })
      .first();
    await expect(metaMoveRow).toBeVisible({ timeout: LIVE_TIMEOUT });

    // Leave meta-move mode so the pending-proposals pane is the active
    // moderator affordance for the commit in Phase 3.
    await alicePage.getByTestId('meta-move-mode-exit').click();
  });

  test('Phase 3: ben + maria agree, alice commits the meta-move → the reframe annotation badge renders', async () => {
    // Both debaters cast real agree votes on the meta-move proposal.
    await agreeOnMetaMove(benPage);
    await agreeOnMetaMove(mariaPage);

    // The unanimous-agree gate opens alice's commit button for the
    // meta-move row (live WS reflecting both debater votes).
    const metaMoveRow = alicePage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: alicePage.locator('[data-testid="pending-proposal-row-kind"]', {
          hasText: 'meta-move',
        }),
      })
      .first();
    const commitButton = metaMoveRow.locator('[data-testid="commit-button"]');
    await expect(commitButton).toBeEnabled({ timeout: LIVE_TIMEOUT });
    await commitButton.click();
    await expect(metaMoveRow).toHaveCount(0, { timeout: LIVE_TIMEOUT });

    // The committed meta-move minted an `annotation-created` (reframe).
    // The moderator graph shows its badge — initially NOT disputed.
    const reframeBadge = alicePage
      .locator('[data-testid^="annotation-badge-"][data-annotation-kind="reframe"]')
      .first();
    await expect(reframeBadge).toBeVisible({ timeout: LIVE_TIMEOUT });
    await expect(reframeBadge).not.toHaveAttribute('data-facet-status', 'disputed');
    const badgeTestId = await reframeBadge.getAttribute('data-testid');
    expect(badgeTestId).toMatch(/^annotation-badge-/);
    annotationId = badgeTestId!.replace(/^annotation-badge-/, '');
  });

  test('Phase 4: ben selects the annotation and disputes it; alice’s badge gains data-facet-status="disputed"', async () => {
    // ben returns to the graph tab and taps N1 via the cy seam so the
    // detail panel selects the node and renders its annotations list.
    await benPage.getByTestId('participant-proposals-tabbar-graph').click();
    await expect(benPage.getByTestId('participant-graph-root')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await benPage.waitForFunction(
      () =>
        Boolean((window as unknown as { __aConversaCyInstance?: unknown }).__aConversaCyInstance),
      undefined,
      { timeout: LIVE_TIMEOUT },
    );
    await benPage.evaluate((nodeId: string) => {
      const cy = (
        window as unknown as {
          __aConversaCyInstance?: {
            getElementById: (id: string) => { emit: (event: string) => unknown };
          };
        }
      ).__aConversaCyInstance;
      if (!cy) throw new Error('__aConversaCyInstance is not exposed on window');
      cy.getElementById(nodeId).emit('tap');
    }, n1Id);

    const panel = benPage.getByTestId('participant-detail-panel');
    await expect(panel).toHaveAttribute('data-entity-id', n1Id, { timeout: LIVE_TIMEOUT });

    // The reframe annotation surfaces in N1's annotations list. Click the
    // row to navigate into the annotation detail branch.
    const annotationRow = benPage.locator(
      `[data-testid="participant-detail-panel-annotation-row"][data-annotation-id="${annotationId}"]`,
    );
    await expect(annotationRow).toBeVisible({ timeout: LIVE_TIMEOUT });
    await annotationRow.click();
    await expect(panel).toHaveAttribute('data-state', 'annotation', { timeout: LIVE_TIMEOUT });
    await expect(panel).toHaveAttribute('data-entity-id', annotationId);

    // The annotation-detail actionSlot mounts the dispute affordance.
    const disputeButton = benPage.locator(
      `[data-testid="participant-annotation-dispute-button"][data-annotation-id="${annotationId}"]`,
    );
    await expect(disputeButton).toBeVisible({ timeout: LIVE_TIMEOUT });
    await expect(disputeButton).toHaveAttribute('data-dispute-state', 'enabled');
    await disputeButton.click();

    // The dispute vote settles (in-flight resolves back to enabled, no
    // wire error) and the resolved substance status folds to disputed.
    await expect(disputeButton).toHaveAttribute('data-dispute-state', 'enabled', {
      timeout: LIVE_TIMEOUT,
    });
    await expect(
      benPage.locator(
        `[data-testid="participant-annotation-dispute-button-wire-error"][data-annotation-id="${annotationId}"]`,
      ),
    ).toHaveCount(0);
    await expect(disputeButton).toHaveAttribute('data-facet-status', 'disputed', {
      timeout: LIVE_TIMEOUT,
    });

    // The dispute propagates over live WS: alice's badge gains the rose
    // `data-facet-status="disputed"` marker — the assertion this whole
    // round-trip exists to pin.
    await expect(
      alicePage.locator(`[data-testid="annotation-badge-${annotationId}"]`),
    ).toHaveAttribute('data-facet-status', 'disputed', { timeout: LIVE_TIMEOUT });
  });
});
