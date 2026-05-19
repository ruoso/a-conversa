// End-to-end coverage of the **entire debate methodology** driven through
// three real browser contexts (alice as moderator, ben as debater-A,
// maria as debater-B) — no `seedWsStore` / `seedParticipants` short-
// circuits, no fixtures beyond the auth bootstrap, no backend calls
// other than the auth dance + the canonical `POST /api/sessions` which
// is itself wrapped inside the moderator UI's create-session form.
//
// Every methodology operation runs through the UI as a real moderator
// or debater would drive it. Phases that are blocked on missing UI
// affordances are pinned with `test.fixme(...)` rather than omitted, so
// that as each blocker lands the corresponding phase becomes the diff
// (flip `test.fixme(...)` → `test(...)`).
//
// **No hidden-DOM assertions.** The participant surface renders nodes
// on a Cytoscape `<canvas>` element — there is no per-node DOM that a
// sighted user could see. The `participant-graph-status-mirror`
// (sr-only, aria-hidden) exists for screen-reader access only; this
// spec deliberately does NOT read it. Cross-context broadcast arrival
// is verified indirectly: when a participant interacts with a node
// (vote, axiom-mark, …), the click + detail-panel-open chain only
// succeeds if the broadcast landed. The moderator surface IS real DOM
// (ReactFlow), so per-node testids like `statement-node-<id>` and
// `statement-node-wording-<id>` are first-class assertions.
//
// **Why a single serial suite, not one test per scenario.** The
// methodology unfolds across the SAME session: the canvas state
// accumulated by phase N is the precondition for phase N+1. Each
// test() block re-uses the three browser contexts allocated in
// `beforeAll` plus the moderator's `sessionId` recorded at session-
// creation time. `test.describe.serial` guarantees the ordering.
//
// Refinements: docs/methodology.md (the canonical methodology spec)
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
//              docs/adr/0027-entity-and-facet-layers-strict-separation.md
//              docs/adr/0028-session-mode-changed-wire-event.md
//
// **What this spec pins (today, when no `test.fixme` is removed).**
//   1. Three independent users authenticate via the pre-seeded jars.
//   2. Alice creates a public session through the create-session form.
//   3. Ben + Maria each follow the per-role invite URL and self-claim
//      their slot through the participant invite-acceptance UI.
//   4. Alice's lobby observes both debaters arrive (live WS) and the
//      Enter-session gate opens.
//   5. Alice clicks Enter; all three surfaces auto-handoff to the
//      operate route per `part_session_start_handoff_dedicated_event`.
//   6. Alice captures a free-floating `classify-node` (wording +
//      classification) through the capture pane; the proposed node
//      renders on Alice's moderator canvas (visible card with the
//      typed wording).
//   7. Alice captures a second node N2 the same way.
//
// **What this spec WILL pin once the marked blockers ship.** The
// fixme'd phases below cover voting, commit-on-agreed, edge proposals
// against committed nodes, decomposition with vote + commit, axiom-
// mark with vote + commit, interpretive-split with vote + commit,
// annotate (currently stubbed), meta-disagreement (currently stubbed),
// edit-wording (no UI), withdraw-proposal (no UI).

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { authedContext } from './fixtures/authed-context';

const TOPIC =
  'Should wolves be reintroduced to Yellowstone? (full methodology e2e — 3 simultaneous contexts)';

// ── Initial-capture node content. The methodology doc's worked example
//    uses "zoos do more good than harm" — we substitute a topical
//    variant so the test description matches the session topic above. ─
const N1_WORDING = 'Reintroducing wolves to Yellowstone restored the elk-aspen balance.';
const N1_KIND = 'fact'; // capture classification — observable / empirical

// ── A second free-floating node we will use as the target of the
//    supports edge once N1 is committed. ────────────────────────────
const N2_WORDING = 'Aspen recovery indicates a healthier riparian ecosystem.';
const N2_KIND = 'fact';

// ── Module-scoped shared state — survives across the serial test()
//    blocks. Initialised in beforeAll. ─────────────────────────────
let aliceContext: BrowserContext;
let benContext: BrowserContext;
let mariaContext: BrowserContext;
let alicePage: Page;
let benPage: Page;
let mariaPage: Page;
let sessionId: string;
// Node ids are minted server-side at propose-time; we recover them from
// the `data-testid="statement-node-<id>"` cards on Alice's canvas after
// each successful propose. The first/second slots are set once the
// corresponding capture phase lands. Underscore prefix marks them as
// "captured but not yet consumed" — every Phase 3+ block that reads
// them is currently `test.fixme`'d; the prefix satisfies eslint's
// no-unused-vars rule while keeping the ids in scope for when the
// blocked phases are unblocked and start consuming them.
let _n1Id: string | null = null;
let _n2Id: string | null = null;

/**
 * Locate the node id rendered on Alice's canvas for a given wording.
 * The `<StatementNode>` card carries `data-testid="statement-node-<id>"`
 * and the wording child carries `data-testid="statement-node-wording-<id>"`.
 * We resolve the wording text → id via a DOM probe so the rest of the
 * test does not bind to a synthetic id we control.
 */
async function readNodeIdByWording(page: Page, wording: string): Promise<string> {
  const wordingLocator = page.locator('[data-testid^="statement-node-wording-"]', {
    hasText: wording,
  });
  await expect(wordingLocator).toBeVisible({ timeout: 15_000 });
  const testid = await wordingLocator.getAttribute('data-testid');
  expect(testid).toMatch(/^statement-node-wording-[0-9a-f-]+$/);
  return testid!.replace(/^statement-node-wording-/, '');
}

// **Why no per-participant "ben sees N1" probe.** A real user verifies a
// node arrived on their canvas by *looking* at the Cytoscape canvas,
// which is a single `<canvas>` element with no per-node DOM. The
// `participant-graph-status-mirror` is `aria-hidden + sr-only` —
// invisible to a sighted user — so asserting against it would betray
// the "what a human sees" contract this spec is built on. The
// `window.__aConversaCyInstance` test-seam route is similarly off-
// limits: it is a dev-only escape hatch, not a UI affordance. The
// cross-context propagation IS verified, but indirectly — every
// later phase that drives ben / maria to interact with a node (vote,
// axiom-mark, etc.) fails loudly if the broadcast did not land. The
// next visible cross-context signal is therefore Phase 3.1.

test.describe
  .serial('Full debate methodology — three real browser sessions (alice mod + ben debater-A + maria debater-B)', () => {
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

  // ──────────────────────────────────────────────────────────────
  // Phase 1 — session setup (UI-driven)
  // ──────────────────────────────────────────────────────────────

  test('Phase 1.1: alice creates a public session via the moderator UI form', async () => {
    await alicePage.goto('/m/sessions/new');
    await expect(alicePage.getByTestId('route-create-session')).toBeVisible();

    await alicePage.getByTestId('create-session-topic-input').fill(TOPIC);
    // The default privacy radio is public; we make it explicit to
    // pin the contract end-to-end.
    await alicePage.getByTestId('create-session-privacy-public').click();
    await expect(alicePage.getByTestId('create-session-privacy-public')).toBeChecked();

    await alicePage.getByTestId('create-session-submit').click();

    // The server returns 201 with the new session id; the form
    // navigates onto the invite/lobby view.
    await alicePage.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 15_000 });
    const match = alicePage.url().match(/\/m\/sessions\/([0-9a-f-]+)\/invite$/);
    expect(match, 'invite-route url must carry a session id').not.toBeNull();
    sessionId = match![1] as string;
    expect(sessionId).toBeTruthy();

    await expect(alicePage.getByTestId('route-invite-participants')).toBeVisible();
  });

  test('Phase 1.2: ben self-claims debater-A through the participant invite-acceptance UI', async () => {
    await benPage.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
    await expect(benPage.getByTestId('route-invite-acceptance')).toBeVisible({
      timeout: 15_000,
    });
    await benPage.getByTestId('invite-acceptance-join-button').click();
    await benPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
      timeout: 15_000,
    });
    await expect(benPage.getByTestId('route-lobby')).toBeVisible();
    await expect(benPage.getByTestId('lobby-participant-debater-A-name')).toHaveText('ben');
  });

  test('Phase 1.3: maria self-claims debater-B through the participant invite-acceptance UI', async () => {
    await mariaPage.goto(`/p/sessions/${sessionId}/invite?role=debater-B`);
    await expect(mariaPage.getByTestId('route-invite-acceptance')).toBeVisible({
      timeout: 15_000,
    });
    await mariaPage.getByTestId('invite-acceptance-join-button').click();
    await mariaPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
      timeout: 15_000,
    });
    await expect(mariaPage.getByTestId('route-lobby')).toBeVisible();
    await expect(mariaPage.getByTestId('lobby-participant-debater-A-name')).toHaveText('ben');
    await expect(mariaPage.getByTestId('lobby-participant-debater-B-name')).toHaveText('maria');
  });

  test("Phase 1.4: alice's lobby observes both debaters arrive (live WS); the Enter-session gate opens", async () => {
    const enterButton = alicePage.getByTestId('invite-enter-session');
    await expect(enterButton).toBeEnabled({ timeout: 15_000 });
    await expect(alicePage.getByTestId('invite-both-ready-banner')).toBeVisible();
  });

  test('Phase 1.5: alice clicks Enter-session; all three surfaces handoff to the operate route', async () => {
    const enterButton = alicePage.getByTestId('invite-enter-session');
    await enterButton.click();

    // Alice's surface lands on the moderator operate canvas.
    await alicePage.waitForURL((url) => url.pathname === `/m/sessions/${sessionId}/operate`, {
      timeout: 15_000,
    });
    await expect(alicePage.getByTestId('route-operate')).toBeVisible();
    await expect(alicePage.getByTestId('graph-canvas-root')).toBeVisible();

    // Both debaters auto-handoff per
    // `part_session_start_handoff_dedicated_event`: the
    // `session-mode-changed` event drives their lobby `useEffect` to
    // `replace`-navigate onto `/p/sessions/<id>`.
    await benPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
      timeout: 15_000,
    });
    await mariaPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
      timeout: 15_000,
    });
    await expect(benPage.getByTestId('route-operate')).toBeVisible();
    await expect(mariaPage.getByTestId('route-operate')).toBeVisible();
    await expect(benPage.getByTestId('participant-graph-root')).toBeVisible();
    await expect(mariaPage.getByTestId('participant-graph-root')).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 2 — capture the first statement (N1)
  // ──────────────────────────────────────────────────────────────

  test('Phase 2.1: alice captures node N1 — types wording, picks fact, clicks propose', async () => {
    // Type the wording, pick the classification, click propose. The
    // propose handler mints a client-side UUID, sends a `classify-node`
    // proposal envelope, and waits for the server's `proposed` ack +
    // `event-applied` broadcast. The optimistic-clear on success
    // empties the textarea.
    await alicePage.getByTestId('capture-text-input-textarea').fill(N1_WORDING);
    await alicePage.getByTestId(`classification-palette-button-${N1_KIND}`).click();
    await alicePage.getByTestId('propose-action-button').click();

    // The proposed node appears on Alice's canvas. We recover its
    // server-minted id from the rendered wording card so subsequent
    // phases can target it.
    _n1Id = await readNodeIdByWording(alicePage, N1_WORDING);

    // The capture pane cleared (optimistic clear on success).
    await expect(alicePage.getByTestId('capture-text-input-textarea')).toHaveValue('');
  });

  // ── Cross-context propagation (ben + maria see N1) is verified
  //    implicitly by Phase 3.1 — when ben clicks on N1 to vote, the
  //    click + detail-panel-open chain only succeeds if the broadcast
  //    arrived. See the no-mirror comment at the top of this file. ──

  // ──────────────────────────────────────────────────────────────
  // Phase 3 — vote on N1's facets (agreement rule)
  // ──────────────────────────────────────────────────────────────
  //
  // The methodology's "agreement rule": every facet a node carries
  // (wording / classification / substance) advances to `agreed` only
  // when every current participant votes `agree` AND the moderator
  // commits. Ben + Maria vote agree on each facet; Alice then commits.
  //
  // BLOCKER — participant vote UI is not implemented yet. `voteStore.ts`
  // is wired but no buttons exist in `EntityDetailPanel`'s `actionSlot`.
  // Removing the `test.fixme(true, ...)` line is the only diff once the
  // vote UI ships.

  test.fixme('Phase 3.1: ben opens N1 in the detail panel and votes agree on the wording facet', () => {
    // BLOCKED: participant vote UI does not exist (no
    // `participant-vote-button-*` testids; EntityDetailPanel.actionSlot
    // is empty in production). Build participant useVoteAction +
    // per-facet vote buttons.
    //
    // Once unblocked: ben taps N1 on his canvas → the detail panel
    // opens with the wording / classification / substance rows. He
    // clicks the agree button on the wording row. The exact click
    // selector for tapping the canvas-rendered node depends on what
    // the vote-UI builder adds; today there is no visible per-node
    // affordance on the participant surface and the sr-only mirror
    // is explicitly off-limits (see no-mirror comment at the top of
    // this file).
  });

  test.fixme('Phase 3.2: maria votes agree on N1.wording', () => {
    // BLOCKED: participant vote UI (see Phase 3.1).
  });

  test.fixme('Phase 3.3: ben + maria vote agree on N1.classification', () => {
    // BLOCKED: participant vote UI (see Phase 3.1).
  });

  test.fixme('Phase 3.4: ben + maria vote agree on N1.substance', () => {
    // BLOCKED: participant vote UI (see Phase 3.1).
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 4 — commit N1 (moderator gesture)
  // ──────────────────────────────────────────────────────────────
  //
  // The moderator's commit button enables once `deriveAllAgree` sees
  // unanimous `agree` from every non-moderator participant on every
  // facet of the pending proposal. Alice clicks commit → the server
  // appends a `commit` event → the node lands as `agreed`.

  test.fixme('Phase 4.1: alice commits N1; the pending row clears and N1.facets render as agreed', () => {
    // BLOCKED: commit-button gate depends on Phase 3 (participant
    // votes). Once unblocked:
    //   - locate the pending-proposal-row whose summary matches
    //     N1_WORDING
    //   - assert its commit-button is enabled (deriveAllAgree saw
    //     unanimous agree from ben + maria across all three facets)
    //   - click it
    //   - assert the row disappears within 15 s (commit landed,
    //     proposal removed from the pending list)
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 5 — capture a second node N2 and propose a `supports` edge
  // ──────────────────────────────────────────────────────────────

  test('Phase 5.1: alice captures node N2', async () => {
    await alicePage.getByTestId('capture-text-input-textarea').fill(N2_WORDING);
    await alicePage.getByTestId(`classification-palette-button-${N2_KIND}`).click();
    await alicePage.getByTestId('propose-action-button').click();
    _n2Id = await readNodeIdByWording(alicePage, N2_WORDING);
    await expect(alicePage.getByTestId('capture-text-input-textarea')).toHaveValue('');
  });

  // ── Cross-context propagation (ben + maria see N2) is verified
  //    implicitly by Phase 5.3 (when ben + maria interact with N2 to
  //    vote). See the no-mirror comment at the top of this file. ──

  test.fixme('Phase 5.3: ben + maria vote agree on every facet of N2; alice commits', () => {
    // BLOCKED: depends on Phase 3 participant vote UI.
    // Once unblocked: mirror Phase 3.1..3.4 + Phase 4.1 for N2.
  });

  test.fixme('Phase 5.4: alice proposes a `supports` edge N2 → N1 by clicking N1 as the target and picking the role', () => {
    // BLOCKED: edge proposal validator requires the target node to
    // exist server-side (committed). Depends on Phase 4.1 (commit N1).
    //
    // Once unblocked: alice clicks N1 on her canvas (the
    // `statement-node-<n1Id>` card is a real DOM element on the
    // moderator's ReactFlow canvas — fine to query by testid). The
    // capture-target chip auto-suggests N1. She picks edge role
    // `supports`, types the supporting wording, picks the
    // classification, and clicks propose. The propose envelope
    // lands; the edge renders on alice's canvas.
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 6 — decomposition (split a node into components)
  // ──────────────────────────────────────────────────────────────

  test.fixme('Phase 6.1: alice proposes a 2-row decomposition of N1 via the right-click context menu', () => {
    // BLOCKED: decompose proposal validator requires N1 to exist
    // server-side (committed). Depends on Phase 4.1.
    //
    // Once unblocked: alice right-clicks N1 on her canvas → context
    // menu opens → click "Propose decompose" item → decompose-grid
    // mounts with two empty rows. Fill row 0 + classification, row 1
    // + classification, click propose-decomposition-action-button.
  });

  test.fixme('Phase 6.2: ben + maria vote agree on the decomposition; alice commits; N1 is replaced by two component nodes', () => {
    // BLOCKED: depends on Phase 6.1 (proposal landing) + participant vote UI.
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 7 — axiom-mark (per-participant bedrock)
  // ──────────────────────────────────────────────────────────────

  test.fixme('Phase 7.1: ben proposes an axiom-mark on a node for himself (via the right-click submenu)', () => {
    // BLOCKED: axiom-mark submenu currently belongs to the
    // moderator surface; a participant-side axiom-mark gesture is
    // needed, OR the moderator must propose on behalf of the
    // participant (which the engine rejects with axiom-mark-not-self).
    //
    // The methodology says axiom-marks are per-participant: only
    // the participant themselves can hold a node as bedrock. The
    // moderator-side submenu surfaces an inline error if alice
    // tries to mark for ben. The correct gesture is ben tapping
    // his own node → the participant detail panel's axiom-mark
    // affordance.
  });

  test.fixme("Phase 7.2: maria + alice vote agree on ben's axiom-mark; alice commits; the axiom badge renders on the node", () => {
    // BLOCKED: depends on Phase 7.1 + participant vote UI.
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 8 — interpretive-split (mod-proposed seam)
  // ──────────────────────────────────────────────────────────────

  test.fixme('Phase 8.1: alice proposes a 2-row interpretive split on a target node', () => {
    // BLOCKED: interpretive-split validator requires the parent
    // node to exist server-side (committed). Depends on Phase 4.1.
    //
    // Mirrors decompose entry: right-click → interpretive-split
    // menu item → grid mounts → fill two reading rows → propose.
  });

  test.fixme('Phase 8.2: ben + maria vote agree on the interpretive split; alice commits; two reading-component nodes appear', () => {
    // BLOCKED: depends on Phase 8.1 + participant vote UI.
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 9 — annotate (attach an annotation to a node)
  // ──────────────────────────────────────────────────────────────

  test.fixme('Phase 9.1: alice proposes an annotation on a committed node via the right-click context menu', () => {
    // BLOCKED: moderator annotate handler is a stub (actionStub
    // in GraphContextMenu / GraphCanvasPane). Wire useAnnotateAction
    // to send the `annotate` proposal envelope.
  });

  test.fixme('Phase 9.2: ben + maria vote agree on the annotation; alice commits; the annotation badge renders on the node', () => {
    // BLOCKED: depends on Phase 9.1 + participant vote UI.
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 10 — meta-disagreement (last-resort fallback)
  // ──────────────────────────────────────────────────────────────

  test.fixme('Phase 10.1: alice marks a contested-classification facet as meta-disagreement via the context menu', () => {
    // BLOCKED: moderator meta-disagreement handler is a stub
    // (actionStub in GraphCanvasPane). Wire
    // useMarkMetaDisagreementAction to send the
    // `mark-meta-disagreement` WS envelope.
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 11 — edit-wording (reword and restructure)
  // ──────────────────────────────────────────────────────────────

  test.fixme('Phase 11.1: alice proposes a reword edit on a committed node (preserves node id, edges follow)', () => {
    // BLOCKED: no moderator UI exists for the `edit-wording`
    // proposal sub-kind (no right-click "Edit wording" item, no
    // editor surface, no useEditWordingAction hook).
  });

  test.fixme('Phase 11.2: alice proposes a restructure edit (creates a new node, supersedes the original)', () => {
    // BLOCKED: depends on Phase 11.1 (edit-wording UI).
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 12 — withdraw a pending proposal
  // ──────────────────────────────────────────────────────────────

  test.fixme('Phase 12.1: alice proposes a node, then withdraws the proposal before commit; the canvas reverts cleanly', () => {
    // BLOCKED: no moderator UI exists for the `withdraw-proposal`
    // WS envelope (no withdraw button in PendingProposalsPane, no
    // useWithdrawAction hook).
  });
});
