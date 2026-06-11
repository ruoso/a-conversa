// Full canonical-walkthrough session run — three real browser contexts
// driving the `docs/example-walkthrough.md` "Should zoos exist?" debate
// end-to-end against a **real backend** (no `seedWsStore` /
// `seedParticipants` / `applyDiagnostic` shortcuts). Every node, edge,
// annotation, axiom-mark, and snapshot below is produced through real
// moderator + debater UI gestures and persisted server-side.
//
// Refinement: tasks/refinements/moderator-ui/mod_pw_full_session_run.md
// TaskJuggler: moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_full_session_run
// ADRs: 0008 (Playwright + compose layering), 0021 (event envelope),
//       0022 (no throwaway verifications / no seeded fake e2e),
//       0028 (session-mode handoff), 0030 (per-facet keying + sequential
//       capture), 0038 (annotations disputable post-commit).
//
// **What this spec is — the M7 acceptance gate.** Every prior
// moderator/participant leaf pins one surface or one gesture in
// isolation (often via seeded state). This spec proves the *whole*
// canonical scenario runs to completion across all three surfaces
// against a live backend, exercising every distinctive structural
// technique the walkthrough demonstrates at least once, and that the
// resulting persisted event log cold-reloads into the change-history
// pane (the inherited `mod_history_scroller` D6 debt — AC-7).
//
// **Persona → dev-user mapping (Decision D4).** The walkthrough's three
// personas map onto `DEV_USER_POOL` as:
//   - Moderator **Maria → `maria`** (creates the session, operates the
//     board).
//   - Debater-A **Anna → `alice`** (no `anna` exists in `DEV_USER_POOL`;
//     `alice` is the conventional debater stand-in already used across
//     the suite — adding an `anna` user is an Authelia/infra change out
//     of scope for a test spec).
//   - Debater-B **Ben → `ben`** (matches the doc name).
// Node wordings are taken verbatim (or lightly shortened to keep the
// moderator card clickable) from the doc, so the produced debate is
// recognizably the zoos scenario and AC-7's change-history content is
// meaningful.
//
// **Structural spine, not verbatim fidelity (Decision D2).** This spec
// recreates the scenario's *named, structurally-distinctive beats* — not
// a turn-by-turn reproduction of all 19 nodes / 15 edges / 3
// annotations. It captures each distinctive technique at least once:
// opening decomposition + definitional scoping + annotation,
// operationalization → conditional defeater, shared per-participant
// axiom-mark, interpretive split, contested meta-move, located crux,
// segment snapshot. Full verbatim fidelity is a deliberate scoping call,
// not deferred work — no audit/fidelity follow-up task is registered.
//
// **Build on the pinned mechanics, do not re-pin them (Decision D1).**
// `methodology-full-flow.spec.ts` already exhaustively pins each
// gesture's per-facet keying / sequential-capture wire shape (ADR 0030).
// This spec's distinct value is the canonical scenario as an integration
// narrative + the inherited REST-prefetch assertion. It therefore drives
// the gestures and asserts the *structural outcome* (nodes / edges /
// decorations rendered, history persisted), leaning on the
// tolerant-acceptance pattern for the round-trip.
//
// **No hidden-DOM assertions (Constraint 4).** The participant surface
// renders nodes on a Cytoscape `<canvas>` with no per-node DOM; this
// spec never reads the sr-only `participant-graph-status-mirror`.
// Cross-context broadcast arrival is proven indirectly (a participant
// gesture only succeeds if the broadcast landed) and against the
// moderator's real ReactFlow DOM (`statement-node-wording-<id>`).
// Participant node taps go through the `?aconversaTestMode=1` →
// `__aConversaCyInstance` seam (the same coordinate-bridge
// `methodology-full-flow` + `annotation-dispute-roundtrip` use).
//
// **Tolerant-acceptance for write beats, strict for the read-side AC-7
// (Decision D6).** The early, clean part of the session (AC-1 / AC-2) is
// firm — it mirrors `methodology-full-flow`'s proven Phase 2–5 patterns.
// As the shared session state accumulates and gets noisy (AC-3 onward),
// the write-side beats become progressively tolerant: each propose / vote
// / commit accepts either the success surface OR a typed inline
// wire-error — both prove the envelope completed its round-trip through
// the dispatcher. The AC-bound *structural* assertions (defeater + rebut
// edge present, two per-participant axiom decorations, split parent
// removed + components rendered, disputed annotation, descending
// change-history) stay firm — and so do the two rebut pre-commit facet
// walks: AC-3b's E5 walk, whose committed-`agreed` edge substance IS
// that AC's central claim (a guarded version once no-oped silently and
// passed vacuously — registered debt this firmness pays), and AC-5a's
// E11 walk, load-bearing for AC-5b's inheritance assertions. AC-7's
// read-side assertion is strict — it runs against a settled,
// cold-loaded state with no noise to tolerate.
//
// **Annotation-kind note (the walkthrough's `concern`).** The doc's
// annotation A1 is `kind=concern`; the platform's annotation kinds are
// `note | reframe | scope-change | stance` (no `concern`). We map the
// walkthrough's "concern" onto `note` (the closest neutral kind) — the
// AC-2 assertion is that an annotation is captured on N1, not the kind
// slug. (The reframe meta-move A2 in AC-6 uses the real `reframe` kind.)

import { expect, test, type BrowserContext, type Page } from './fixtures/no-scrollbars';

import { authedContext } from './fixtures/authed-context';

const LIVE_TIMEOUT = 15_000;

const TOPIC = 'Should zoos exist?';

// ── Canonical node wordings from docs/example-walkthrough.md (verbatim,
//    lightly shortened where the full sentence would overflow the
//    moderator card). ───────────────────────────────────────────────
const N1_DEFINITIONAL =
  'Modern accredited zoos = AZA-accredited institutions and their international equivalents; roadside menageries and unaccredited operations are out of scope.';
const N2_UMBRELLA = 'Modern accredited zoos, on balance, do more good than harm.';
const N3_SUPPORT_LEG = 'Modern accredited zoos are a net positive for conservation.';
const A1_CONCERN_CONTENT =
  'Ben: scope-accepted; the accredited/unaccredited boundary does argumentative work — it narrows what Anna defends and what Ben may cite.';
const N6_COST_CLAIM = 'Confinement-as-such imposes a morally significant cost on the individual.';
const N8_DEFEATER =
  'Welfare science plus revealed-preference data converge on no remaining unmet interest in well-managed captives.';
const N11_CAPABILITIES =
  'A creature has a form of flourishing proper to its kind; frustrating constitutive capacities is morally significant harm, independent of subjective welfare.';
const N12_BEDROCK = 'A life has a shape it is owed; thwarting that shape counts morally.';
const N14_REDUCTION =
  'Capability-frustration reduces without remainder to welfare deficits in every case.';
const N16_EPISTEMIC =
  'Welfare deficits are our evidence for constitutive capacities (epistemic reading).';
const N17_METAPHYSICAL =
  'Capability-frustration just IS welfare loss, ontologically (metaphysical reading).';
const A2_REFRAME_HOST =
  'The netting question — does AZA-grade husbandry meet ranging/foraging/social capacities?';
const A2_REFRAME_CONTENT =
  'Reframe: if welfare is the access to constitutive capacities, the netting question is the operational form of the N11 dispute, not a sidestep of it.';
const N19_CRUX =
  'What is owed precedes welfare-aggregation; the netting question is downstream of that priority, not its operational form.';

// ── Module-scoped shared state — survives across the serial test()
//    blocks. Initialised in beforeAll / recorded as beats run. ───────
let mariaContext: BrowserContext; // moderator
let aliceContext: BrowserContext; // debater-A (Anna)
let benContext: BrowserContext; // debater-B (Ben)
let mariaPage: Page;
let alicePage: Page;
let benPage: Page;
let sessionId: string;

let n1Id: string;
let n2Id: string;
let n6Id: string;
let n11Id: string;
let n12Id: string;
let n14Id: string;
let e11Id: string;
let a2HostId: string;

const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';

// The two debater participant surfaces — used by every cross-context
// vote helper. Maria is the moderator and never appears here.
function debaterPages(): Page[] {
  return [alicePage, benPage];
}

/**
 * Locate the node id rendered on the moderator canvas for a given
 * wording. Mirrors `methodology-full-flow.spec.ts`'s helper of the same
 * name — resolves the wording text → server-minted id via a DOM probe so
 * the rest of the test doesn't bind to a synthetic id we control.
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

/** Maria captures a free-floating node (wording-only, ADR 0030 §1). */
async function captureNode(wording: string): Promise<string> {
  // Target auto-suggest (`mod_target_auto_suggest` /
  // `mod_annotation_capture_auto_suggest`) stages the most-recently-
  // selected node/annotation as the capture target. After any prior
  // beat that selected an entity (a connecting-capture's target click,
  // a context-menu right-click), the pane enters this helper with a
  // target staged but no edge role — which leaves the propose button
  // `target-without-role`-disabled. A free-floating capture must first
  // clear the auto-suggested target via the chip's × affordance, exactly
  // as a real moderator would.
  const clearTarget = mariaPage.getByTestId('capture-target-chip-clear');
  if (await clearTarget.isVisible().catch(() => false)) {
    await clearTarget.click();
    await expect(clearTarget).toHaveCount(0, { timeout: LIVE_TIMEOUT });
  }
  await mariaPage.getByTestId('capture-text-input-textarea').fill(wording);
  const proposeButton = mariaPage.getByTestId('propose-action-button');
  await expect(proposeButton).toBeEnabled({ timeout: LIVE_TIMEOUT });
  await proposeButton.click();
  const id = await readNodeIdByWording(mariaPage, wording);
  await expect(mariaPage.getByTestId('capture-text-input-textarea')).toHaveValue('');
  return id;
}

/**
 * Each debater votes agree on the auto-selected node's facet row. Firm
 * variant — used for the clean early beats (AC-1 / AC-2) where the
 * session has little accumulated noise.
 */
async function voteAgreeOnFacet(facetName: string, expectWording: string): Promise<void> {
  for (const page of debaterPages()) {
    await expect(page.getByTestId('participant-detail-panel-identity-wording')).toHaveText(
      expectWording,
      { timeout: LIVE_TIMEOUT },
    );
    const row = page.locator(
      `[data-testid="participant-detail-panel-facet-row"][data-facet-name="${facetName}"]`,
    );
    await expect(row).toBeVisible({ timeout: LIVE_TIMEOUT });
    await row.getByTestId('participant-vote-button-agree').click();
    await expect(row).toHaveAttribute('data-vote-state', 'enabled', { timeout: LIVE_TIMEOUT });
  }
}

/**
 * Best-effort variant of {@link voteAgreeOnFacet} for the noisy
 * later beats. Tolerates a raced auto-select / absent row — the
 * structural assertion downstream is the regression class, not any
 * particular vote landing (Decision D6).
 */
async function tolerantVoteAgreeOnFacet(facetName: string): Promise<void> {
  for (const page of debaterPages()) {
    const row = page.locator(
      `[data-testid="participant-detail-panel-facet-row"][data-facet-name="${facetName}"]`,
    );
    if (
      !(await row
        .first()
        .isVisible()
        .catch(() => false))
    )
      continue;
    const agree = row.first().getByTestId('participant-vote-button-agree');
    if (!(await agree.isVisible().catch(() => false))) continue;
    await agree.click().catch(() => {});
    await row
      .first()
      .getAttribute('data-vote-state')
      .catch(() => null);
  }
}

/** Each debater votes agree on every open structural `proposal` facet row. */
async function tolerantVoteAgreeOnStructuralProposals(): Promise<void> {
  for (const page of debaterPages()) {
    const rows = page.locator(
      '[data-testid="participant-detail-panel-facet-row"][data-facet-name="proposal"]',
    );
    const count = await rows.count();
    for (let i = 0; i < count; i += 1) {
      const agree = rows.nth(i).getByTestId('participant-vote-button-agree');
      if (await agree.isVisible().catch(() => false)) {
        await agree.click().catch(() => {});
        await rows
          .nth(i)
          .getAttribute('data-vote-state')
          .catch(() => null);
      }
    }
  }
}

/** Maria commits a node's wording via the on-card commit affordance. */
async function commitWordingViaCard(nodeId: string): Promise<void> {
  await mariaPage.getByTestId('graph-tidy-up-button').click();
  const button = mariaPage.getByTestId(`node-wording-commit-affordance-button-${nodeId}`);
  await expect(button).toBeVisible({ timeout: LIVE_TIMEOUT });
  await button.click();
  await expect(button).toHaveCount(0, { timeout: LIVE_TIMEOUT });
}

/** Maria picks a classification kind on a node card (fires `classify-node`). */
async function classifyNode(nodeId: string, kind: string): Promise<void> {
  await mariaPage.getByTestId('graph-tidy-up-button').click();
  const button = mariaPage.getByTestId(`node-card-classification-palette-button-${nodeId}-${kind}`);
  await expect(button).toBeVisible({ timeout: LIVE_TIMEOUT });
  await button.click();
  await expect(button).toHaveCount(0, { timeout: LIVE_TIMEOUT });
}

/** Maria commits a node's classification via the on-card commit affordance. */
async function commitClassificationViaCard(nodeId: string): Promise<void> {
  await mariaPage.getByTestId('graph-tidy-up-button').click();
  const button = mariaPage.getByTestId(`node-classification-commit-affordance-button-${nodeId}`);
  await expect(button).toBeVisible({ timeout: LIVE_TIMEOUT });
  await button.click();
  await expect(button).toHaveCount(0, { timeout: LIVE_TIMEOUT });
}

/** Maria picks "Holds" (value=agreed) on a node card (fires `set-node-substance`). */
async function setNodeSubstanceHolds(nodeId: string): Promise<void> {
  await mariaPage.getByTestId('graph-tidy-up-button').click();
  const button = mariaPage.getByTestId(`node-card-substance-affordance-button-${nodeId}-agreed`);
  await expect(button).toBeVisible({ timeout: LIVE_TIMEOUT });
  await button.click();
  await expect(button).toHaveCount(0, { timeout: LIVE_TIMEOUT });
}

/** Locate the pending-proposal row whose summary carries an id prefix. */
function pendingRowByPrefix(prefix: string): ReturnType<Page['locator']> {
  return mariaPage
    .locator('[data-testid="pending-proposal-row"]')
    .filter({
      has: mariaPage.locator('[data-testid="pending-proposal-row-summary"]', { hasText: prefix }),
    })
    .first();
}

/** Maria commits the pending row identified by an entity-id prefix. */
async function commitPendingRowByPrefix(prefix: string): Promise<void> {
  const row = pendingRowByPrefix(prefix);
  await expect(row).toBeVisible({ timeout: LIVE_TIMEOUT });
  const commit = row.locator('[data-testid="commit-button"]');
  await expect(commit).toBeEnabled({ timeout: LIVE_TIMEOUT });
  await commit.click();
  await expect(row).toHaveCount(0, { timeout: LIVE_TIMEOUT });
}

/** Best-effort commit of the pending row identified by an entity-id prefix. */
async function tolerantCommitPendingRowByPrefix(prefix: string): Promise<void> {
  const row = pendingRowByPrefix(prefix);
  if (!(await row.isVisible().catch(() => false))) return;
  const commit = row.locator('[data-testid="commit-button"]');
  if (await commit.isEnabled().catch(() => false)) {
    await commit.click().catch(() => {});
    await expect(row)
      .toHaveCount(0, { timeout: LIVE_TIMEOUT })
      .catch(() => {});
  }
}

/**
 * Drive the full wording → classification → substance facet sequence on
 * a node through real debater votes + moderator commits. The canonical
 * AC-2 walk (ADR 0030 sequential capture).
 */
async function walkNodeToCommittedSubstance(
  nodeId: string,
  wording: string,
  kind: string,
): Promise<void> {
  // wording
  await voteAgreeOnFacet('wording', wording);
  await commitWordingViaCard(nodeId);
  // classification
  await classifyNode(nodeId, kind);
  await voteAgreeOnFacet('classification', wording);
  await commitClassificationViaCard(nodeId);
  // substance
  await setNodeSubstanceHolds(nodeId);
  await voteAgreeOnFacet('substance', wording);
  await commitPendingRowByPrefix(nodeId.slice(0, 8));
}

/**
 * Tolerant variant of the full walk for the noisy later beats — drives
 * every facet but never hard-fails on a raced vote / commit. Returns
 * once the gestures have been attempted; downstream structural
 * assertions own the regression class.
 */
async function tolerantWalkNodeToCommittedSubstance(nodeId: string, kind: string): Promise<void> {
  await tolerantVoteAgreeOnFacet('wording');
  await commitWordingViaCard(nodeId).catch(() => {});
  await classifyNode(nodeId, kind).catch(() => {});
  await tolerantVoteAgreeOnFacet('classification');
  await commitClassificationViaCard(nodeId).catch(() => {});
  await setNodeSubstanceHolds(nodeId).catch(() => {});
  await tolerantVoteAgreeOnFacet('substance');
  await tolerantCommitPendingRowByPrefix(nodeId.slice(0, 8));
}

/** Tolerant commit of just a node's wording (enough to make it a target). */
async function tolerantCommitWording(nodeId: string): Promise<void> {
  await tolerantVoteAgreeOnFacet('wording');
  await commitWordingViaCard(nodeId).catch(() => {});
}

/**
 * Maria proposes a connecting-capture: she clicks an existing target
 * node, picks an edge role, types the new source node's wording, and
 * fires a single `capture-node` proposal whose `edge` block carries the
 * role + endpoints inline (ADR 0030 §4). Returns the new source node id.
 * Mirrors `methodology-full-flow.spec.ts:908-964`.
 *
 * Target staging goes through the chip's selection-driven auto-suggest
 * (`mod_target_auto_suggest`). The `<EdgeRoleSelector>` only mounts once
 * a target is staged (`targetEntityId !== null`); the always-present
 * `capture-target-chip` does NOT prove staging. A prior target-clear on
 * THIS same node — e.g. an `Esc` that closed a lingering context menu
 * (AC-3a) — arms the `userHasClearedRef` lockout while
 * `lastAutoStagedRef` still points at the node, and per the
 * `mod_target_clear_override` re-engagement contract a re-click of the
 * already-active node will NOT re-stage it. We detect the un-mounted
 * selector and recover by selecting a *different* node first (which
 * releases the same-node lockout), then re-selecting the intended
 * target — the real moderator gesture for re-targeting after a clear.
 */
async function proposeConnectingCapture(
  targetNodeId: string,
  role: string,
  sourceWording: string,
): Promise<string> {
  await mariaPage.getByTestId('graph-tidy-up-button').click();
  await mariaPage.getByTestId(`statement-node-wording-${targetNodeId}`).click();
  await expect(mariaPage.getByTestId('capture-target-chip')).toBeVisible({ timeout: LIVE_TIMEOUT });
  // The edge-role selector mounts only when a target is actually staged.
  // Give the async auto-stage a brief grace to render; if it does not,
  // the same-node clear-lockout is in effect — nudge selection onto any
  // other node, then back onto the target, to re-engage staging.
  const roleSelector = mariaPage.getByTestId('edge-role-selector');
  const staged = await roleSelector
    .waitFor({ state: 'visible', timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!staged) {
    const otherNode = mariaPage
      .locator(
        `[data-testid^="statement-node-wording-"]:not([data-testid="statement-node-wording-${targetNodeId}"])`,
      )
      .first();
    if (await otherNode.isVisible().catch(() => false)) {
      await otherNode.click();
      await mariaPage.getByTestId(`statement-node-wording-${targetNodeId}`).click();
    }
    await expect(roleSelector).toBeVisible({ timeout: LIVE_TIMEOUT });
  }
  await mariaPage.getByTestId(`edge-role-selector-button-${role}`).click();
  await expect(mariaPage.getByTestId(`edge-role-selector-button-${role}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await mariaPage.getByTestId('capture-text-input-textarea').fill(sourceWording);
  await mariaPage.getByTestId('propose-action-button').click();
  const sourceId = await readNodeIdByWording(mariaPage, sourceWording);
  expect(sourceId).not.toBe(targetNodeId);
  return sourceId;
}

/** Tap a node on a debater's participant canvas via the cy test seam. */
async function tapParticipantNode(page: Page, nodeId: string): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __aConversaCyInstance?: unknown }).__aConversaCyInstance),
    undefined,
    { timeout: LIVE_TIMEOUT },
  );
  await page.evaluate((id: string) => {
    const cy = (
      window as unknown as {
        __aConversaCyInstance?: {
          getElementById: (id: string) => { emit: (event: string) => unknown };
        };
      }
    ).__aConversaCyInstance;
    if (!cy) throw new Error('__aConversaCyInstance is not exposed on window');
    cy.getElementById(id).emit('tap');
  }, nodeId);
}

test.describe
  .serial('Full canonical walkthrough — "Should zoos exist?" across three real browser sessions (maria mod + alice debater-A + ben debater-B)', () => {
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

  // ════════════════════════════════════════════════════════════════
  // AC-1 — session bootstrap (real)
  // ════════════════════════════════════════════════════════════════

  test('AC-1: maria creates a "Should zoos exist?" session; alice + ben self-claim and all three reach operate', async () => {
    // Maria creates the public session via the moderator UI form.
    await mariaPage.goto('/m/sessions/new');
    await expect(mariaPage.getByTestId('route-create-session')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await mariaPage.getByTestId('create-session-topic-input').fill(TOPIC);
    await mariaPage.getByTestId('create-session-privacy-public').click();
    await expect(mariaPage.getByTestId('create-session-privacy-public')).toBeChecked();
    await mariaPage.getByTestId('create-session-submit').click();
    await mariaPage.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/invite$/, { timeout: LIVE_TIMEOUT });
    const match = mariaPage.url().match(/\/m\/sessions\/([0-9a-f-]+)\/invite$/);
    expect(match, 'invite-route url must carry a session id').not.toBeNull();
    sessionId = match![1] as string;
    expect(sessionId).toBeTruthy();
    await expect(mariaPage.getByTestId('route-invite-participants')).toBeVisible();

    // Anna (alice) self-claims debater-A.
    await alicePage.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
    await expect(alicePage.getByTestId('route-invite-acceptance')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await alicePage.getByTestId('invite-acceptance-join-button').click();
    await alicePage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
      timeout: LIVE_TIMEOUT,
    });
    await expect(alicePage.getByTestId('lobby-participant-debater-A-name')).toHaveText('alice');

    // Ben self-claims debater-B.
    await benPage.goto(`/p/sessions/${sessionId}/invite?role=debater-B`);
    await expect(benPage.getByTestId('route-invite-acceptance')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await benPage.getByTestId('invite-acceptance-join-button').click();
    await benPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
      timeout: LIVE_TIMEOUT,
    });
    await expect(benPage.getByTestId('lobby-participant-debater-B-name')).toHaveText('ben');

    // Maria's lobby observes both debaters arrive (live WS); the
    // Enter-session gate opens, and Enter hands all three off to operate.
    const enterButton = mariaPage.getByTestId('invite-enter-session');
    await expect(enterButton).toBeEnabled({ timeout: LIVE_TIMEOUT });
    await enterButton.click();
    await mariaPage.waitForURL((url) => url.pathname === `/m/sessions/${sessionId}/operate`, {
      timeout: LIVE_TIMEOUT,
    });
    await expect(mariaPage.getByTestId('route-operate')).toBeVisible();
    await expect(mariaPage.getByTestId('graph-canvas-root')).toBeVisible();

    await alicePage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
      timeout: LIVE_TIMEOUT,
    });
    await benPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
      timeout: LIVE_TIMEOUT,
    });

    // Re-load both debaters with the test-mode flag so the cy seam
    // (`window.__aConversaCyInstance`) is exposed for the node taps that
    // the axiom-mark (AC-4) and dispute (AC-6) beats need.
    for (const page of debaterPages()) {
      await page.goto(`/p/sessions/${sessionId}?aconversaTestMode=1`);
      await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: LIVE_TIMEOUT });
      await expect(page.getByTestId('participant-graph-root')).toBeVisible({
        timeout: LIVE_TIMEOUT,
      });
      await page.waitForFunction(
        () =>
          Boolean((window as unknown as { __aConversaCyInstance?: unknown }).__aConversaCyInstance),
        undefined,
        { timeout: LIVE_TIMEOUT },
      );
    }
  });

  // ════════════════════════════════════════════════════════════════
  // AC-2 — opening decomposition + definitional scoping + annotation
  // ════════════════════════════════════════════════════════════════
  //
  // The walkthrough's turn 5–7: N1 (definitional scope) up front, the N2
  // umbrella, a support leg (N3) with a `supports` edge, and Ben's
  // concern annotation A1 on N1. Reproducing all three legs N3/N4/N5
  // verbatim is not required (Decision D2) — one support leg + its edge
  // captures the technique.

  test('AC-2a: maria captures + fully commits the definitional node N1 (wording → classification=definitional → substance)', async () => {
    n1Id = await captureNode(N1_DEFINITIONAL);
    await walkNodeToCommittedSubstance(n1Id, N1_DEFINITIONAL, 'definitional');
    // The committed definitional node renders on the moderator canvas.
    await expect(mariaPage.getByTestId(`statement-node-wording-${n1Id}`)).toBeVisible();
  });

  test('AC-2b: maria captures + commits the umbrella node N2 (normative) through its wording + classification facets', async () => {
    n2Id = await captureNode(N2_UMBRELLA);
    // Wording.
    await voteAgreeOnFacet('wording', N2_UMBRELLA);
    await commitWordingViaCard(n2Id);
    // Classification = normative.
    await classifyNode(n2Id, 'normative');
    await voteAgreeOnFacet('classification', N2_UMBRELLA);
    await commitClassificationViaCard(n2Id);
    await expect(mariaPage.getByTestId(`statement-node-wording-${n2Id}`)).toBeVisible();
  });

  test('AC-2c: maria captures a support leg N3 with a `supports` edge into the umbrella N2', async () => {
    // Connecting-capture: click N2 as the target, pick `supports`, type
    // the support-leg wording. Mints N3 + a supports edge E1 inline.
    const n3Id = await proposeConnectingCapture(n2Id, 'supports', N3_SUPPORT_LEG);
    expect(n3Id).toBeTruthy();
    // The supports edge renders on the moderator canvas (AC-2's "at least
    // one support leg and a `supports` edge").
    await expect(
      mariaPage.locator('[data-testid^="graph-edge-label-"][data-edge-role="supports"]').first(),
    ).toBeVisible({ timeout: LIVE_TIMEOUT });
  });

  test('AC-2d: maria captures a concern annotation (mapped to kind=note) on N1', async () => {
    // Right-click N1 → annotate submenu → type the concern content →
    // submit. The walkthrough's A1 is kind=concern; the platform has no
    // `concern` kind, so we use `note` (the closest neutral kind). The
    // AC-bound outcome is that an annotation is captured on N1.
    await mariaPage.getByTestId('graph-tidy-up-button').click();
    await mariaPage.getByTestId(`statement-node-wording-${n1Id}`).click({ button: 'right' });
    await expect(mariaPage.getByTestId('graph-context-menu')).toBeVisible();
    await mariaPage.getByTestId('graph-context-menu-item-annotate').click();
    await expect(mariaPage.getByTestId('annotate-submenu')).toBeVisible({ timeout: LIVE_TIMEOUT });
    await mariaPage.getByTestId('annotate-submenu-input').fill(A1_CONCERN_CONTENT);
    await mariaPage.getByTestId('annotate-submenu-kind-note').click();
    await expect(mariaPage.getByTestId('annotate-submenu-kind-note')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await mariaPage.getByTestId('annotate-submenu-submit').click();
    // Round-trip settle: submenu unmounts (propose landed) OR the inline
    // error region surfaces a typed engine rejection.
    const settled = mariaPage.locator(
      '[data-testid="annotate-submenu-error"]:visible, body:not(:has([data-testid="annotate-submenu"]))',
    );
    await expect(settled.first()).toBeVisible({ timeout: LIVE_TIMEOUT });
    // Drive participant agreement on the annotation proposal so it can
    // commit, then commit it.
    await tolerantVoteAgreeOnStructuralProposals();
    const annotateRow = mariaPage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: mariaPage.locator('[data-testid="pending-proposal-row-kind"]', {
          hasText: /Annotat|Note/i,
        }),
      })
      .first();
    if (await annotateRow.isVisible().catch(() => false)) {
      const commit = annotateRow.locator('[data-testid="commit-button"]');
      if (await commit.isEnabled().catch(() => false)) {
        await commit.click().catch(() => {});
      }
    }
    // An annotation badge surfaces against N1 (committed) or the pending
    // proposal completed its round-trip (the tolerant signal). Either way
    // the annotation was captured on N1.
    const annotationBadge = mariaPage.locator('[data-testid^="annotation-badge-"]').first();
    await expect(annotationBadge).toBeVisible({ timeout: LIVE_TIMEOUT });
  });

  // ════════════════════════════════════════════════════════════════
  // AC-3 — operationalization → defeater with pre-committed rebut
  // ════════════════════════════════════════════════════════════════
  //
  // The walkthrough's turn 9–11: Maria runs operationalization on Ben's
  // cost claim N6, then captures a defeater N8 with a `rebuts` edge E5
  // whose substance is pre-committed `agreed` while N8's own substance
  // stays `proposed` — the conditional-reading defeater pattern (F3, F6).
  //
  // Per Constraint 8 the spec drives the operationalization *gesture* but
  // does NOT assert the server re-derived a diagnostic clear (that
  // derivation is owned by methodology-engine Cucumber + the seeded
  // `mod_pw_diagnostic_flow` F3 spec). The enabled-state operationalization
  // path is gated on a disputed/meta-disagreement substance (per
  // `mod_warrant_elicitation_mode`'s spec), so against a freshly-committed
  // node the menu item is reachable but typically disabled — we open the
  // gesture tolerantly and pin the real structural output: the defeater
  // node + its pre-committed rebut edge. AC-3b's E5 pre-commit facet walk
  // itself is FIRM (see the policy block atop this file): the committed
  // edge substance is the AC's central claim, so every beat of that walk
  // is a hard expect.

  test("AC-3a: maria captures Ben's cost claim N6 and tolerantly runs the operationalization gesture on it", async () => {
    n6Id = await captureNode(N6_COST_CLAIM);
    await tolerantCommitWording(n6Id);

    // Drive the operationalization context-menu gesture. The item is
    // reachable; against N6's freshly-committed (non-disputed) substance
    // the methodology gate renders it `aria-disabled` — we assert it is
    // present and attempt the click; both the disabled no-op and the
    // enabled panel-open are acceptable (the gesture is reachable, which
    // is all Constraint 8 asks of the operationalization beat here).
    await mariaPage.getByTestId('graph-tidy-up-button').click();
    await mariaPage.getByTestId(`statement-node-wording-${n6Id}`).click({ button: 'right' });
    await expect(mariaPage.getByTestId('graph-context-menu')).toBeVisible();
    const opItem = mariaPage.getByTestId('graph-context-menu-item-run-operationalization-test');
    await expect(opItem).toBeVisible();
    await opItem.click({ force: true }).catch(() => {});
    // Close the menu if it lingered (a disabled item leaves it open).
    await mariaPage.keyboard.press('Escape').catch(() => {});
  });

  test('AC-3b: maria captures the defeater N8 with a `rebuts` edge into N6; the edge substance is committed agreed while N8 substance stays proposed', async () => {
    // Headroom over the 30s default, per the AC-5a precedent: the firm
    // E5 pre-commit walk below is six-plus real round-trips against the
    // stack, several of them LIVE_TIMEOUT-bounded waits.
    test.setTimeout(90_000);
    // Connecting-capture with role=rebuts: mints N8 + the rebut edge E5.
    const n8Id = await proposeConnectingCapture(n6Id, 'rebuts', N8_DEFEATER);
    expect(n8Id).toBeTruthy();
    // Pin E5 by its endpoints (AC-5a later mints a second `rebuts` edge
    // E11, so a bare role query's uniqueness here would be an unstated
    // ordering invariant) and extract its server-minted id.
    const e5Label = mariaPage.locator(
      `[data-testid^="graph-edge-label-"][data-edge-role="rebuts"][data-edge-source="${n8Id}"][data-edge-target="${n6Id}"]`,
    );
    await expect(e5Label).toBeVisible({ timeout: LIVE_TIMEOUT });
    const e5Testid = await e5Label.getAttribute('data-testid');
    expect(e5Testid).toMatch(/^graph-edge-label-[0-9a-f-]+$/);
    const e5Id = e5Testid!.replace(/^graph-edge-label-/, '');

    // Pre-commit E5's substance to `agreed`: settle the edge `shape`
    // facet (debaters agree → maria commits via the inline shape-commit
    // affordance), then propose + commit edge substance `agreed`. This
    // walk is FIRM — its terminal committed-substance pin IS the test
    // title's central claim. A guarded version of this walk once no-oped
    // silently (the substance beat targeted the generic affordance testid
    // that never renders for rebut edges) and the test passed vacuously;
    // and since `showSubstanceAffordance` gates on a settled shape, a
    // silently-skipped shape beat would strand the substance assertion
    // far from the causing failure (the AC-5a rationale).
    //
    // Each debater's panel is auto-focused on E5 (the connecting-capture
    // proposal targets its inline edge per `autoSelectionFromProposal`);
    // both vote agree on the shape facet. Shape unanimity counts only
    // non-moderator participants, so two votes settle it.
    for (const page of debaterPages()) {
      await expect(page.getByTestId('participant-detail-panel')).toHaveAttribute(
        'data-entity-id',
        e5Id,
        { timeout: LIVE_TIMEOUT },
      );
      const shapeRow = page.locator(
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="shape"]',
      );
      await expect(shapeRow).toBeVisible({ timeout: LIVE_TIMEOUT });
      await shapeRow.getByTestId('participant-vote-button-agree').click();
      await expect(shapeRow).toHaveAttribute('data-vote-state', /^(enabled|in-flight)$/, {
        timeout: LIVE_TIMEOUT,
      });
    }
    await mariaPage.getByTestId('graph-tidy-up-button').click();
    const shapeCommit = mariaPage.getByTestId(`edge-shape-commit-affordance-button-${e5Id}`);
    await expect(shapeCommit).toBeVisible({ timeout: LIVE_TIMEOUT });
    await shapeCommit.click();
    await expect(shapeCommit).toHaveCount(0, { timeout: LIVE_TIMEOUT });
    // Propose edge substance = agreed. E5 is a `rebuts` edge, so the
    // affordance is the F6-flavored `<RebutEdgePreCommitAffordance>`
    // (`rebut-edge-pre-commit-button-*`), NOT the generic
    // `edge-card-substance-affordance-button-*` — same
    // `set-edge-substance` wire underneath. It unmounts once the
    // proposal lands (substance leaves `awaiting-proposal`).
    await mariaPage.getByTestId('graph-tidy-up-button').click();
    const subAffordance = mariaPage.getByTestId(`rebut-edge-pre-commit-button-${e5Id}-agreed`);
    await expect(subAffordance).toBeVisible({ timeout: LIVE_TIMEOUT });
    await subAffordance.click();
    await expect(subAffordance).toHaveCount(0, { timeout: LIVE_TIMEOUT });
    // The `set-edge-substance` proposal re-focuses every panel on E5;
    // both debaters vote agree on substance, then maria commits the
    // pending proposal row.
    for (const page of debaterPages()) {
      const substanceRow = page.locator(
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="substance"]',
      );
      await expect(substanceRow).toBeVisible({ timeout: LIVE_TIMEOUT });
      await substanceRow.getByTestId('participant-vote-button-agree').click();
      await expect(substanceRow).toHaveAttribute('data-vote-state', /^(enabled|in-flight)$/, {
        timeout: LIVE_TIMEOUT,
      });
    }
    await commitPendingRowByPrefix(e5Id.slice(0, 8));
    // The assertion that makes the test title true: E5's substance commit
    // completed its round trip and the edge label projects it.
    await expect(e5Label).toHaveAttribute('data-facet-status', 'committed', {
      timeout: LIVE_TIMEOUT,
    });

    // AC-3's structural pin: the defeater node renders and its rebut
    // edge is present. (We deliberately do NOT drive N8's own
    // substance facet — it stays `proposed`, the conditional-reading
    // pattern where the defeater sits in the graph without firing.)
    await expect(mariaPage.getByTestId(`statement-node-wording-${n8Id}`)).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await expect(
      mariaPage.locator(`[data-testid="graph-edge-label-${e5Id}"][data-edge-role="rebuts"]`),
    ).toBeVisible({ timeout: LIVE_TIMEOUT });
  });

  // ════════════════════════════════════════════════════════════════
  // AC-4 — shared per-participant axiom-mark on one node
  // ════════════════════════════════════════════════════════════════
  //
  // The walkthrough's signature "unanticipated structural finding" (turn
  // 14–17): both debaters axiom-mark the same bedrock node N12 from their
  // respective frames — two per-participant marks on one node (F5).

  test('AC-4a: maria captures + fully commits the bedrock node N12', async () => {
    n12Id = await captureNode(N12_BEDROCK);
    // A committed node is the clean precondition for a per-participant
    // axiom-mark. Tolerant walk — the session is noisy by now.
    await tolerantWalkNodeToCommittedSubstance(n12Id, 'normative');
    await expect(mariaPage.getByTestId(`statement-node-wording-${n12Id}`)).toBeVisible();
  });

  test('AC-4b: both debaters (alice = Anna, ben = Ben) axiom-mark N12; the node carries two per-participant axiom decorations', async () => {
    // Each debater taps N12 on their own canvas (cy seam) to select it,
    // then clicks "Mark as my axiom". Per methodology the declared
    // participant is excluded from voting on their own mark, so the other
    // debater agrees and maria commits each. All tolerant.
    for (const page of debaterPages()) {
      await page
        .getByTestId('participant-proposals-tabbar-graph')
        .click()
        .catch(() => {});
      await tapParticipantNode(page, n12Id).catch(() => {});
      const panel = page.getByTestId('participant-detail-panel');
      await expect(panel).toHaveAttribute('data-entity-id', n12Id, { timeout: LIVE_TIMEOUT });
      const axiomBtn = page.locator(
        `[data-testid="participant-axiom-mark-button"][data-node-id="${n12Id}"]`,
      );
      if (await axiomBtn.isVisible().catch(() => false)) {
        await axiomBtn.click().catch(() => {});
        const settled = page.locator(
          '[data-testid="participant-axiom-mark-button-wire-error"], ' +
            `[data-testid="participant-axiom-mark-button"][data-node-id="${n12Id}"][data-axiom-mark-state="enabled"]`,
        );
        await expect(settled.first())
          .toBeVisible({ timeout: LIVE_TIMEOUT })
          .catch(() => {});
      }
      // The other debater + structural agree votes, then maria commits any
      // pending axiom-mark rows.
      await tolerantVoteAgreeOnStructuralProposals();
      const axiomRows = mariaPage.locator('[data-testid="pending-proposal-row"]').filter({
        has: mariaPage.locator('[data-testid="pending-proposal-row-kind"]', {
          hasText: /Axiom/i,
        }),
      });
      const count = await axiomRows.count();
      for (let i = 0; i < count; i += 1) {
        const commit = axiomRows.nth(i).locator('[data-testid="commit-button"]');
        if (await commit.isEnabled().catch(() => false)) {
          await commit.click().catch(() => {});
        }
      }
    }

    // AC-4's load-bearing assertion: N12 carries two per-participant axiom
    // decorations. The moderator renders one badge per marking participant
    // (committed `axiom-mark-badge-<nodeId>-<pid>` or pending
    // `pending-axiom-mark-badge-<nodeId>-<pid>`); a node marked by two
    // debaters shows two distinct per-participant badges.
    const axiomBadges = mariaPage.locator(
      `[data-testid^="axiom-mark-badge-${n12Id}-"], [data-testid^="pending-axiom-mark-badge-${n12Id}-"]`,
    );
    await expect(axiomBadges).toHaveCount(2, { timeout: LIVE_TIMEOUT });
  });

  // ════════════════════════════════════════════════════════════════
  // AC-5 — interpretive split
  // ════════════════════════════════════════════════════════════════
  //
  // The walkthrough's turn 17: Maria splits the disputed reduction node
  // N14 into N16 (epistemic) + N17 (metaphysical), each inheriting N14's
  // pre-committed rebut edge to N11 (F2 variant). The two component nodes
  // render. (AC-5's "parent removed from the visible graph" clause is a
  // server-projection fact, not a moderator-canvas one — see the deferral
  // note at the AC-5b assertion block below.)

  test('AC-5a: maria builds N11 and a disputed reduction node N14 with a pre-committed `rebuts` edge into N11', async () => {
    // Headroom over the 30s default: `tolerantCommitWording(n14Id)` below
    // burns ~15s waiting for a wording-commit affordance that cannot
    // appear (the debater panels are auto-focused on E11, an edge, so the
    // wording vote is skipped and the affordance never mounts), and the
    // firm E11 pre-commit walk that follows is four real round-trips.
    test.setTimeout(90_000);
    n11Id = await captureNode(N11_CAPABILITIES);
    await tolerantCommitWording(n11Id);
    // N14 via connecting-capture with role=rebuts → mints N14 + its rebut
    // edge E11 into N11 (the edge N16/N17 will inherit at split time).
    n14Id = await proposeConnectingCapture(n11Id, 'rebuts', N14_REDUCTION);
    expect(n14Id).toBeTruthy();
    await tolerantCommitWording(n14Id);
    await expect(mariaPage.getByTestId(`statement-node-wording-${n14Id}`)).toBeVisible();

    // Pin E11 by its endpoints (the AC-3b rebut edge E5 also matches a
    // bare role query) and pre-commit its substance to `agreed`, the
    // walkthrough's F2-variant pre-commitment the readings inherit at
    // split time (ADR 0046 — only committed-substance outgoing edges
    // qualify). Like AC-3b's E5 walk, this walk is FIRM:
    // the committed-substance pin below is load-bearing for AC-5b's
    // inheritance assertions, so a silently-skipped beat here would
    // only fail later with worse signal.
    const e11Label = mariaPage.locator(
      `[data-testid^="graph-edge-label-"][data-edge-role="rebuts"][data-edge-source="${n14Id}"][data-edge-target="${n11Id}"]`,
    );
    await expect(e11Label).toBeVisible({ timeout: LIVE_TIMEOUT });
    const e11Testid = await e11Label.getAttribute('data-testid');
    expect(e11Testid).toMatch(/^graph-edge-label-[0-9a-f-]+$/);
    e11Id = e11Testid!.replace(/^graph-edge-label-/, '');

    // Each debater's panel is auto-focused on E11 (the connecting-capture
    // proposal targets its inline edge per `autoSelectionFromProposal`);
    // both vote agree on the shape facet. Shape unanimity counts only
    // non-moderator participants, so two votes settle it.
    for (const page of debaterPages()) {
      await expect(page.getByTestId('participant-detail-panel')).toHaveAttribute(
        'data-entity-id',
        e11Id,
        { timeout: LIVE_TIMEOUT },
      );
      const shapeRow = page.locator(
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="shape"]',
      );
      await expect(shapeRow).toBeVisible({ timeout: LIVE_TIMEOUT });
      await shapeRow.getByTestId('participant-vote-button-agree').click();
      await expect(shapeRow).toHaveAttribute('data-vote-state', /^(enabled|in-flight)$/, {
        timeout: LIVE_TIMEOUT,
      });
    }
    await mariaPage.getByTestId('graph-tidy-up-button').click();
    const shapeCommit = mariaPage.getByTestId(`edge-shape-commit-affordance-button-${e11Id}`);
    await expect(shapeCommit).toBeVisible({ timeout: LIVE_TIMEOUT });
    await shapeCommit.click();
    await expect(shapeCommit).toHaveCount(0, { timeout: LIVE_TIMEOUT });
    // Propose edge substance = agreed. E11 is a `rebuts` edge, so the
    // affordance is the F6-flavored `<RebutEdgePreCommitAffordance>`
    // (`rebut-edge-pre-commit-button-*`), NOT the generic
    // `edge-card-substance-affordance-button-*` — same
    // `set-edge-substance` wire underneath. It unmounts once the
    // proposal lands (substance leaves `awaiting-proposal`).
    await mariaPage.getByTestId('graph-tidy-up-button').click();
    const subAffordance = mariaPage.getByTestId(`rebut-edge-pre-commit-button-${e11Id}-agreed`);
    await expect(subAffordance).toBeVisible({ timeout: LIVE_TIMEOUT });
    await subAffordance.click();
    await expect(subAffordance).toHaveCount(0, { timeout: LIVE_TIMEOUT });
    // The `set-edge-substance` proposal re-focuses every panel on E11;
    // both debaters vote agree on substance, then maria commits the
    // pending proposal row.
    for (const page of debaterPages()) {
      const substanceRow = page.locator(
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="substance"]',
      );
      await expect(substanceRow).toBeVisible({ timeout: LIVE_TIMEOUT });
      await substanceRow.getByTestId('participant-vote-button-agree').click();
      await expect(substanceRow).toHaveAttribute('data-vote-state', /^(enabled|in-flight)$/, {
        timeout: LIVE_TIMEOUT,
      });
    }
    await commitPendingRowByPrefix(e11Id.slice(0, 8));
    // E11's pre-commitment is load-bearing for AC-5b's inheritance
    // assertion — pin it here so a failure surfaces at the causing beat.
    await expect(e11Label).toHaveAttribute('data-facet-status', 'committed', {
      timeout: LIVE_TIMEOUT,
    });
  });

  test('AC-5b: maria interpretively splits N14 into N16 (epistemic) + N17 (metaphysical); the two component reading nodes render and the superseded parent N14 leaves the canvas', async () => {
    await mariaPage.getByTestId('graph-tidy-up-button').click();
    await mariaPage.getByTestId(`statement-node-wording-${n14Id}`).click({ button: 'right' });
    await expect(mariaPage.getByTestId('graph-context-menu')).toBeVisible();
    await mariaPage.getByTestId('graph-context-menu-item-propose-interpretive-split').click();
    await expect(mariaPage.getByTestId('interpretive-split-readings-grid')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await expect(mariaPage.getByTestId('mode-banner')).toHaveAttribute(
      'data-mode',
      'interpretive-split',
    );
    await mariaPage.getByTestId('interpretive-split-reading-text-0').fill(N16_EPISTEMIC);
    await mariaPage
      .getByTestId('interpretive-split-reading-classification-0-button-predictive')
      .click();
    await mariaPage.getByTestId('interpretive-split-reading-text-1').fill(N17_METAPHYSICAL);
    await mariaPage
      .getByTestId('interpretive-split-reading-classification-1-button-normative')
      .click();
    const proposeButton = mariaPage.getByTestId('propose-interpretive-split-action-button');
    await expect(proposeButton).toBeEnabled({ timeout: LIVE_TIMEOUT });
    await proposeButton.click();
    // Round-trip settle: banner returns to idle OR a typed wire-error.
    const proposeFinished = mariaPage.locator(
      '[data-testid="propose-interpretive-split-action-wire-error"], [data-testid="mode-banner"][data-mode="idle"]',
    );
    await expect(proposeFinished.first()).toBeVisible({ timeout: LIVE_TIMEOUT });

    // Debaters agree on the split proposal; maria commits it.
    await tolerantVoteAgreeOnStructuralProposals();
    const splitRow = mariaPage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: mariaPage.locator('[data-testid="pending-proposal-row-kind"]', {
          hasText: /Interpretive|Split/i,
        }),
      })
      .first();
    await expect(splitRow).toBeVisible({ timeout: LIVE_TIMEOUT });
    const splitCommit = splitRow.locator('[data-testid="commit-button"]');
    await expect(splitCommit).toBeEnabled({ timeout: LIVE_TIMEOUT });
    await splitCommit.click();
    await expect(splitRow).toHaveCount(0, { timeout: LIVE_TIMEOUT });

    // AC-5's load-bearing moderator-canvas assertions: the interpretive
    // split's structural output renders — the two component reading
    // nodes (N16/N17) appear — AND the superseded parent N14 leaves the
    // visible graph (`docs/methodology.md` L154–158). The parent-removal
    // clause was deferred here until `mod_decompose_split_parent_visibility`
    // landed the client-side supersession derivation (ADR 0047): the
    // canvases now derive the superseded set from the proposal envelope
    // + the proposal-keyed commit event via the shared
    // `computeSupersededNodeIds` shell walk — no `entity-removed` is
    // emitted for supersession by design.
    await mariaPage.getByTestId('graph-tidy-up-button').click();
    await expect(mariaPage.getByTestId(`statement-node-${n14Id}`)).toHaveCount(0, {
      timeout: LIVE_TIMEOUT,
    });
    await expect(
      mariaPage.locator('[data-testid^="statement-node-wording-"]', { hasText: N16_EPISTEMIC }),
    ).toBeVisible({ timeout: LIVE_TIMEOUT });
    await expect(
      mariaPage.locator('[data-testid^="statement-node-wording-"]', { hasText: N17_METAPHYSICAL }),
    ).toBeVisible({ timeout: LIVE_TIMEOUT });
    // The reading nodes inherit N14's pre-committed rebut edge to N11
    // (the walkthrough's "each with rebut edges to N11 … each with edge
    // substance pre-committed agreed", ADR 0046): per reading, one
    // inherited `rebuts` edge sourced at the reading, targeting N11,
    // rendering committed substance carried from E11. Endpoint
    // discrimination via the edge label's data-edge-source/-target
    // attributes keeps AC-3b's unrelated rebut edge E5 out of the match.
    const n16Id = await readNodeIdByWording(mariaPage, N16_EPISTEMIC);
    const n17Id = await readNodeIdByWording(mariaPage, N17_METAPHYSICAL);
    for (const readingId of [n16Id, n17Id]) {
      const inherited = mariaPage.locator(
        `[data-testid^="graph-edge-label-"][data-edge-role="rebuts"][data-edge-source="${readingId}"][data-edge-target="${n11Id}"]`,
      );
      await expect(inherited).toBeVisible({ timeout: LIVE_TIMEOUT });
      await expect(inherited).toHaveAttribute('data-facet-status', 'committed', {
        timeout: LIVE_TIMEOUT,
      });
    }
  });

  // ════════════════════════════════════════════════════════════════
  // AC-6 — contested meta-move stays disputed + located crux + snapshot
  // ════════════════════════════════════════════════════════════════
  //
  // The walkthrough's turn 17 + 21–22: Anna's reframe is logged as a
  // meta-move annotation A2; Ben contests it, so A2 stays `disputed`. The
  // located crux N19 is captured with a `contradicts` edge, and Maria
  // closes the segment with a snapshot (F8, F10). Mirrors
  // `annotation-dispute-roundtrip.spec.ts` for the disputed round-trip.

  test('AC-6a: maria captures a reframe meta-move (A2); both debaters agree and maria commits it → the reframe badge renders', async () => {
    // A dedicated host node for the reframe (the doc's A2 sits on N6;
    // capturing a fresh host keeps this beat decoupled from N6's
    // accumulated state many phases back).
    a2HostId = await captureNode(A2_REFRAME_HOST);
    await tolerantCommitWording(a2HostId);

    // Stage the host as the meta-move target, then F8 into meta-move mode.
    await mariaPage.getByTestId('graph-tidy-up-button').click();
    const hostNode = mariaPage.locator(`[data-testid="statement-node-${a2HostId}"]`);
    await expect(hostNode).toBeVisible({ timeout: LIVE_TIMEOUT });
    await expect
      .poll(
        async () => {
          await hostNode.click();
          return (await mariaPage.getByTestId('capture-target-chip-label').textContent()) ?? '';
        },
        { intervals: [50, 100, 200, 500, 1000], timeout: 5_000 },
      )
      .toContain('netting');

    await mariaPage.keyboard.press('F8');
    await expect(mariaPage.getByTestId('meta-move-capture-pane')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    const textarea = mariaPage.getByTestId('capture-text-input-textarea');
    await textarea.fill(A2_REFRAME_CONTENT);
    await expect(mariaPage.getByTestId('meta-move-propose-button')).toBeEnabled({
      timeout: LIVE_TIMEOUT,
    });
    await textarea.press(submitKey);
    await expect(mariaPage.getByTestId('meta-move-propose-error')).toHaveCount(0, {
      timeout: LIVE_TIMEOUT,
    });
    const metaMoveRow = mariaPage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: mariaPage.locator('[data-testid="pending-proposal-row-kind"]', {
          hasText: 'meta-move',
        }),
      })
      .first();
    await expect(metaMoveRow).toBeVisible({ timeout: LIVE_TIMEOUT });
    await mariaPage.getByTestId('meta-move-mode-exit').click();

    // Both debaters agree on the meta-move proposal (proposals tab), then
    // maria commits → an `annotation-created` (reframe). Recover the
    // annotation id from the rendered badge.
    for (const page of debaterPages()) {
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
      if (!(await row.isVisible().catch(() => false))) continue;
      if ((await row.getAttribute('data-expanded')) !== 'true') {
        await row
          .getByTestId('participant-pending-proposal-row-header')
          .click()
          .catch(() => {});
      }
      const facet = row.locator(
        '[data-testid="participant-pending-proposal-row-facet"][data-facet-name="proposal"]',
      );
      const agree = facet.getByTestId('participant-pending-proposal-row-facet-vote-button-agree');
      if (await agree.isVisible().catch(() => false)) {
        await agree.click().catch(() => {});
        await expect(agree)
          .toHaveCount(0, { timeout: LIVE_TIMEOUT })
          .catch(() => {});
      }
    }

    const metaMoveModRow = mariaPage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: mariaPage.locator('[data-testid="pending-proposal-row-kind"]', {
          hasText: 'meta-move',
        }),
      })
      .first();
    const commitButton = metaMoveModRow.locator('[data-testid="commit-button"]');
    await expect(commitButton).toBeEnabled({ timeout: LIVE_TIMEOUT });
    await commitButton.click();
    await expect(metaMoveModRow).toHaveCount(0, { timeout: LIVE_TIMEOUT });

    const reframeBadge = mariaPage
      .locator('[data-testid^="annotation-badge-"][data-annotation-kind="reframe"]')
      .first();
    await expect(reframeBadge).toBeVisible({ timeout: LIVE_TIMEOUT });
    await expect(reframeBadge).not.toHaveAttribute('data-facet-status', 'disputed');
  });

  test('AC-6b: ben disputes the reframe (A2); the annotation surfaces in `disputed` state on the moderator badge', async () => {
    const reframeBadge = mariaPage
      .locator('[data-testid^="annotation-badge-"][data-annotation-kind="reframe"]')
      .first();
    const badgeTestId = await reframeBadge.getAttribute('data-testid');
    expect(badgeTestId).toMatch(/^annotation-badge-/);
    const annotationId = badgeTestId!.replace(/^annotation-badge-/, '');

    // Ben selects the annotation: tap the host node (cy seam) → click the
    // annotation row → annotation detail → dispute.
    await benPage.getByTestId('participant-proposals-tabbar-graph').click();
    await expect(benPage.getByTestId('participant-graph-root')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await tapParticipantNode(benPage, a2HostId);
    const panel = benPage.getByTestId('participant-detail-panel');
    await expect(panel).toHaveAttribute('data-entity-id', a2HostId, { timeout: LIVE_TIMEOUT });
    const annotationRow = benPage.locator(
      `[data-testid="participant-detail-panel-annotation-row"][data-annotation-id="${annotationId}"]`,
    );
    await expect(annotationRow).toBeVisible({ timeout: LIVE_TIMEOUT });
    await annotationRow.click();
    await expect(panel).toHaveAttribute('data-state', 'annotation', { timeout: LIVE_TIMEOUT });
    const disputeButton = benPage.locator(
      `[data-testid="participant-annotation-dispute-button"][data-annotation-id="${annotationId}"]`,
    );
    await expect(disputeButton).toBeVisible({ timeout: LIVE_TIMEOUT });
    await expect(disputeButton).toHaveAttribute('data-dispute-state', 'enabled');
    await disputeButton.click();
    await expect(
      benPage.locator(
        `[data-testid="participant-annotation-dispute-button-wire-error"][data-annotation-id="${annotationId}"]`,
      ),
    ).toHaveCount(0);

    // AC-6's strict load-bearing assertion: the dispute propagates over
    // live WS and maria's badge gains `data-facet-status="disputed"`.
    await expect(
      mariaPage.locator(`[data-testid="annotation-badge-${annotationId}"]`),
    ).toHaveAttribute('data-facet-status', 'disputed', { timeout: LIVE_TIMEOUT });
  });

  test('AC-6c: maria captures the located crux N19 with a `contradicts` edge, then closes the segment with a snapshot', async () => {
    // Located crux: connecting-capture with role=contradicts. The doc's
    // E15 contradicts the reframe annotation A2; the connecting-capture's
    // reliable target seam is the statement node, so we target A2's host
    // node — the structural technique pinned is the `contradicts` edge
    // from the crux node (Decision D1/D2 spine).
    const n19Id = await proposeConnectingCapture(a2HostId, 'contradicts', N19_CRUX);
    expect(n19Id).toBeTruthy();
    await expect(mariaPage.getByTestId(`statement-node-wording-${n19Id}`)).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await expect(
      mariaPage.locator('[data-testid^="graph-edge-label-"][data-edge-role="contradicts"]').first(),
    ).toBeVisible({ timeout: LIVE_TIMEOUT });

    // Segment-close snapshot (F10): label "Segment 1 close".
    await mariaPage.getByTestId('snapshot-action-button').click();
    await expect(mariaPage.getByTestId('snapshot-label-input-modal')).toBeVisible({
      timeout: LIVE_TIMEOUT,
    });
    await mariaPage.getByTestId('snapshot-label-input-field').fill('Segment 1 close');
    await mariaPage.getByTestId('snapshot-label-input-submit').click();
    // Round-trip settle: the modal closes (snapshot landed) OR a typed
    // inline error surfaces.
    const snapshotSettled = mariaPage.locator(
      '[data-testid="snapshot-label-input-error"]:visible, body:not(:has([data-testid="snapshot-label-input-modal"]))',
    );
    await expect(snapshotSettled.first()).toBeVisible({ timeout: LIVE_TIMEOUT });
  });

  // ════════════════════════════════════════════════════════════════
  // AC-7 — inherited: REST-prefetch-from-live-server full-log assertion
  // ════════════════════════════════════════════════════════════════
  //
  // Discharges the `mod_history_scroller` D6 debt: open a FRESH moderator
  // page on the operate route (cold load, no WS seeding), wait for the
  // change-history pane to REST-prefetch the persisted log
  // (`useSessionEventLogPrefetch` → GET /api/sessions/:id/events), and
  // assert the rendered rows carry `data-sequence` in strictly descending
  // order with a count consistent with the committed event log. Strict —
  // it runs against a settled, cold-loaded state with no noise (D6).

  test('AC-7: a fresh moderator operate page cold-loads the persisted event log into the change-history pane in strictly descending sequence', async () => {
    const coldPage = await mariaContext.newPage();
    try {
      await coldPage.goto(`/m/sessions/${sessionId}/operate`);
      await expect(coldPage.getByTestId('route-operate')).toBeVisible({ timeout: LIVE_TIMEOUT });

      // The pane is always mounted on the operate route. Wait for the
      // REST prefetch to settle out of its loading state into a populated
      // list.
      const pane = coldPage.getByTestId('change-history-pane');
      await expect(pane).toBeVisible({ timeout: LIVE_TIMEOUT });
      const list = coldPage.getByTestId('change-history-pane-list');
      await expect(list).toBeVisible({ timeout: LIVE_TIMEOUT });
      await expect(coldPage.getByTestId('change-history-pane-loading')).toHaveCount(0, {
        timeout: LIVE_TIMEOUT,
      });

      const rows = list.locator('[data-testid="change-history-row"]');
      await expect(rows.first()).toBeVisible({ timeout: LIVE_TIMEOUT });
      const rowCount = await rows.count();
      // The full canonical run committed many events (session-created,
      // node/edge/annotation creations, votes, commits, axiom-marks, the
      // snapshot, …); the persisted log is non-trivial.
      expect(rowCount).toBeGreaterThan(5);

      // Every row carries a numeric `data-sequence`; reverse-chronological
      // order means strictly descending sequence numbers down the list.
      const sequences: number[] = [];
      for (let i = 0; i < rowCount; i += 1) {
        const raw = await rows.nth(i).getAttribute('data-sequence');
        expect(raw, `row ${i} must carry data-sequence`).not.toBeNull();
        const seq = Number(raw);
        expect(Number.isFinite(seq), `row ${i} data-sequence must be numeric (${raw})`).toBe(true);
        sequences.push(seq);
      }
      for (let i = 1; i < sequences.length; i += 1) {
        expect(
          sequences[i - 1]!,
          `sequence must strictly descend: row ${i - 1}=${sequences[i - 1]} should exceed row ${i}=${sequences[i]}`,
        ).toBeGreaterThan(sequences[i]!);
      }
    } finally {
      await coldPage.close();
    }
  });
});
