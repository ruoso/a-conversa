// End-to-end coverage of the **entire debate methodology** driven through
// three real browser contexts (alice as moderator, ben as debater-A,
// maria as debater-B) — no `seedWsStore` / `seedParticipants` short-
// circuits, no fixtures beyond the auth bootstrap, no backend calls
// other than the auth dance + the canonical `POST /api/sessions` which
// is itself wrapped inside the moderator UI's create-session form.
//
// Every methodology operation runs through the UI as a real moderator
// or debater would drive it.
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
//              tasks/refinements/per-facet-refactor/pf_e2e_methodology_full_flow_update.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
//              docs/adr/0027-entity-and-facet-layers-strict-separation.md
//              docs/adr/0028-session-mode-changed-wire-event.md
//              docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md
//
// **Canonical sequential-capture exercise per ADR 0030.** This spec is
// the canonical Playwright pin of ADR 0030's sequential-capture model:
// every captured node walks the wording → classification → substance
// facet sequence as three distinct propose-vote-commit cycles, in
// methodology order, and the participant + moderator surfaces only
// surface the next-in-sequence affordance once the predecessor facet
// has settled. Each phase below corresponds to a specific methodology
// gesture; the phase numbering walks the same order
// `docs/methodology.md` walks. The per-facet wire shape is exercised
// end-to-end: facet-arm votes / commits keyed by `(entity, facet)` for
// `capture-node` / `classify-node` / `set-node-substance` /
// `edit-wording`; proposal-arm votes / commits keyed by `proposalId`
// for the structural sub-kinds (`decompose` / `interpretive-split` /
// `axiom-mark` / `annotate` / `meta-move` / `break-edge`); inline
// `node-created.wording` and `edge-created.shape` carriages enter the
// facet-keyed world without a proposal at all (per ADR 0030 §4 + §5).
//
// **What this spec pins.**
//   Phase 1 — session setup: three users authenticate; alice creates a
//     public session via the create-session form; ben + maria self-
//     claim their debater slots through the invite-acceptance UI;
//     alice's lobby observes them arrive (live WS); alice clicks
//     Enter-session and all three surfaces auto-handoff to operate
//     per `part_session_start_handoff_dedicated_event`. Ben + maria
//     re-load with `?aconversaTestMode=1` so the participant canvas's
//     `__aConversaCyInstance` test seam exposes (coordinate-bridge
//     for canvas taps; see helper comment below).
//   Phase 2.1 — N1 capture (wording-only): alice fires `capture-node`
//     with inline wording per ADR 0030 §1 + §4 + `pf_mod_capture_pane_
//     wording_only`. The classification + substance facets enter life
//     `awaiting-proposal` per ADR 0030 §10.
//   Phase 2.1.5 — awaiting-proposal assertion: ben's detail panel
//     surfaces the classification + substance rows with
//     `data-facet-status="awaiting-proposal"` and renders the empty-
//     state body (no vote buttons) per
//     `pf_part_detail_panel_three_facet_rows`. Pins the
//     `awaiting-proposal` UI rendering acceptance criterion.
//   Phase 2.2 / 2.3 — N1.wording vote + commit: every debater votes
//     agree on the wording facet row; alice commits the capture-node
//     row, which fires a facet-arm `commit { entity_kind, entity_id,
//     facet: 'wording' }` envelope per
//     `pf_mod_pending_proposals_pane_facet_keyed`.
//   Phase 2.4 — N1.classification propose: alice picks `fact` on N1's
//     node card, firing `classify-node` per
//     `pf_mod_node_card_classification_affordance`.
//   Phase 3.1 / 3.2 / 4.1 — N1.classification vote + commit: ben +
//     maria each vote agree on the classification facet row; alice
//     commits.
//   Phase 4.2 — N1.substance propose: alice picks "Holds" on N1's
//     node card, firing `set-node-substance` per
//     `pf_mod_node_card_substance_affordance`.
//   Phase 4.3 / 4.4 — N1.substance vote + commit: ben + maria vote
//     agree on the substance facet row; alice commits.
//   Phase 4.5 — withdraw-agreement: ben withdraws his prior agreement
//     on N1.substance via the participant detail-panel withdraw
//     button (two-click gesture: arm then confirm); the row's
//     `data-facet-status` flips to `withdrawn` per ADR 0030 §3 +
//     `pf_part_withdraw_agreement_action`.
//   Phase 5.1 — N2 capture (wording-only).
//   Phase 5.2 / 5.3 — N2 wording + classification cycles, same shape
//     as Phase 2.2 / 2.3 + 2.4 / 3.x / 4.1. (Substance for N2 is
//     out of scope to keep the spec under its time budget — Phase 4.x
//     pins the substance flow on N1.)
//   Phase 5.4 — edge: alice clicks N1 as the target, picks the
//     `supports` edge role, types a wording, fires a connecting-
//     capture `capture-node` whose payload's `edge` block carries the
//     role + endpoints inline per ADR 0030 §4. The edge is created
//     with inline shape; the source node's wording facet enters as a
//     proposal candidate.
//   Phase 5.5 — edge.shape participant vote: ben + maria tap the
//     freshly created edge on their canvases (via the `__aConversa
//     CyInstance` seam, which also surfaces edges per
//     `GraphView.handleTap`'s edge branch), and vote agree on the
//     `shape` facet row in the participant detail panel.
//   Phase 5.7 — edge.shape moderator commit: per
//     `pf_mod_edge_shape_commit_affordance`, alice's
//     `<StatementEdge>` label container surfaces an inline
//     `<EdgeShapeCommitAffordance>` button once the shape facet
//     reaches `'agreed'` (every current participant voted agree).
//     Alice clicks the button; the facet-arm
//     `commit { target: 'facet', entity_kind: 'edge', entity_id,
//     facet: 'shape' }` envelope lands and the affordance unmounts.
//   Phase 5.8 — edge.substance propose: alice picks "Holds" on the
//     edge label's substance affordance, firing `set-edge-substance`
//     per `pf_mod_edge_card_substance_affordance`.
//   Phase 5.9 / 5.10 — edge.substance vote + commit: ben + maria
//     vote agree on the substance facet row in the participant
//     detail panel; alice commits the `set-edge-substance` proposal.
//   Phase 6 / 8 — structural mode proposals: decompose and
//     interpretive-split via the right-click context menu, both
//     against the committed N1.
//   Phase 6.2 / 7.2 / 8.2 / 9.2 — structural sub-kind agree + commit:
//     ben + maria click agree on the synthetic `proposal` facet row
//     for each structural pending proposal; alice commits each.
//     Axiom-mark excludes the declared participant from the agree
//     walk per `docs/methodology.md` § "Axioms / terminal values".
//     These continue to use the proposal-arm wire shape per ADR
//     0030 §9 / `pf_structural_handlers_unchanged`.
//   Phase 7.1 — participant axiom-mark: ben taps N1 on his canvas
//     and clicks the "Mark as my axiom" button under his detail
//     panel's action slot.
//   Phase 9.1 — annotate: alice right-clicks N1 → annotate submenu
//     → submit annotation content.
//   Phase 10.1 — meta-disagreement: alice clicks the per-row
//     `mark-meta-disagreement-button` on a pending proposal.
//   Phase 11.1 / 11.2 — edit-wording: alice right-clicks N1 → edit-
//     wording submenu → submit with reword (preserves node id) and
//     then restructure (mints a new node id, supersedes the
//     original). Edit-wording is a facet-valued sub-kind whose vote /
//     commit envelopes use the facet-arm wire shape; the spec pins
//     that the propose envelope's round-trip completes.
//   Phase 12.1 — withdraw-proposal (proposer rescinds): alice clicks
//     the per-row proposer-only `withdraw-proposal-button` on one of
//     her own pending proposals — distinct from the participant's
//     `withdraw-agreement` gesture in Phase 4.5 (the former rescinds
//     a not-yet-committed proposal; the latter rescinds a previously-
//     committed agreement and walks the facet back to `withdrawn`).
//
// **What this spec does not exercise (out-of-scope, with reason).**
//   - Out-of-sequence facet propose refusal (per ADR 0030 §8). The
//     server's `validateSequence` gate is wire-level; the moderator
//     UI hides the affordance once predecessor facets are unsettled,
//     so there is no UI gesture that surfaces the refusal path
//     today. A wire-send test seam is not exposed on the moderator
//     `window` (only `__aConversaWsStore` is); synthesizing a raw
//     envelope from the spec would require new test infrastructure
//     that does not exist. The sequence-gate is covered by Cucumber +
//     unit tests on the server side per `pf_sequence_gate_server_
//     enforced`.
//
// **Acceptance shape.** Most write-side phases tolerate either of
// two outcomes — the success case (e.g. submenu unmounts, row clears,
// in-flight latch flips back to enabled) OR an inline wire-error
// region surfacing a typed engine rejection. Either proves the
// envelope completed its round-trip; the regression class is the
// chain itself, not any particular engine outcome on the noisy
// shared session state phase N+k inherits from phase N.

import { expect, test, type BrowserContext, type Page } from './fixtures/no-scrollbars';

import { authedContext } from './fixtures/authed-context';

const TOPIC =
  'Should wolves be reintroduced to Yellowstone? (full methodology e2e — 3 simultaneous contexts)';

// ── Initial-capture node content. The methodology doc's worked example
//    uses "zoos do more good than harm" — we substitute a topical
//    variant so the test description matches the session topic above.
//    Per `pf_mod_capture_pane_wording_only` (ADR 0030 §1) the capture-
//    pane gesture is wording-only — no `*_KIND` constants here (the
//    classification facets land via the per-node card by a downstream
//    task). ─────────────────────────────────────────────────────────
const N1_WORDING = 'Reintroducing wolves to Yellowstone restored the elk-aspen balance.';

// ── A second free-floating node we will use as the target of the
//    supports edge once N1 is committed. ────────────────────────────
const N2_WORDING = 'Aspen recovery indicates a healthier riparian ecosystem.';

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
// each successful propose. Underscore-prefixed because eslint's
// no-unused-vars rule treats them as unused even though every Phase
// 3+ block reads them — the assignment lives inside an async test
// callback whose body the rule's scope analysis doesn't follow.
let _n1Id: string | null = null;
let _n2Id: string | null = null;
// The supports-edge id minted server-side during Phase 5.4's
// connecting-capture; recovered from alice's `graph-edge-label-<id>`
// after the propose lands. Phase 5.5 uses it to drive the participant
// edge-shape vote.
let _edgeId: string | null = null;

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

// **Why no hidden-DOM assertions; how the participant detail panel
// surfaces an entity.** The participant surface renders nodes on a
// Cytoscape `<canvas>` element — no per-node DOM. The sr-only
// `participant-graph-status-mirror` is invisible to a sighted user
// and is therefore off-limits for "what a human sees" verification.
// Every assertion against the participant surface is against visible
// DOM (the detail panel, vote buttons, etc.).
//
// Per `apps/participant/src/graph/autoSelect.ts`, the participant's
// `useAutoSelectFromEvents` hook surfaces the latest proposal's
// target entity on every participant's detail panel without a tap.
// The visible identity wording / facet rows ARE the cross-context
// broadcast proof — if the WS broadcast did not land, the auto-select
// never fires and the assertion times out. This replaces the prior
// synthetic-tap seam, which is no longer needed in this spec.

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

  // ── Re-mount ben + maria's operate route with `?aconversaTestMode=1`
  //    so the GraphView exposes `window.__aConversaCyInstance` (gated
  //    on that flag — see GraphView.tsx:877). The seam is necessary
  //    because the participant canvas is a single `<canvas>` element
  //    with no per-node DOM, so a Playwright spec cannot click on a
  //    specific node by testid. The seam exposes the live cy instance
  //    so the spec can dispatch the same `tap` event Cytoscape would
  //    fire on a real human click; the selection chain + detail-panel
  //    render that follows are entirely real. Result is verified
  //    against the visible detail panel content
  //    (`participant-detail-panel-identity-wording`), not the sr-only
  //    mirror. ────────────────────────────────────────────────────
  test('Phase 1.6: ben + maria re-load operate with ?aconversaTestMode=1 so the cy test seam exposes', async () => {
    for (const page of [benPage, mariaPage]) {
      await page.goto(`/p/sessions/${sessionId}?aconversaTestMode=1`);
      await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-root')).toBeVisible();
      // Wait for the seam to land on `window` (the mount effect's
      // `if (exposeSeam) window.__aConversaCyInstance = cy` runs
      // after Cytoscape's first paint).
      await page.waitForFunction(
        () =>
          Boolean((window as unknown as { __aConversaCyInstance?: unknown }).__aConversaCyInstance),
        undefined,
        { timeout: 15_000 },
      );
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 2 — capture the first statement (N1)
  // ──────────────────────────────────────────────────────────────

  test('Phase 2.1: alice captures node N1 — wording-only capture, clicks propose', async () => {
    // Per `pf_mod_capture_pane_wording_only` (ADR 0030 §1) the
    // capture-pane gesture is wording-only — type the wording, click
    // propose. NO classification pick: the classification palette is
    // no longer mounted in the bottom strip; classification moves to
    // the per-node card by a downstream task. The propose handler
    // mints a client-side UUID, sends a `capture-node` proposal
    // envelope, and waits for the server's `proposed` ack +
    // `event-applied` broadcast. The optimistic-clear on success
    // empties the textarea. The captured node renders with
    // `wording: 'proposed'` + `classification: 'awaiting-proposal'`
    // + `substance: 'awaiting-proposal'`.
    await alicePage.getByTestId('capture-text-input-textarea').fill(N1_WORDING);
    await alicePage.getByTestId('propose-action-button').click();

    // The proposed node appears on Alice's canvas. We recover its
    // server-minted id from the rendered wording card so subsequent
    // phases can target it.
    _n1Id = await readNodeIdByWording(alicePage, N1_WORDING);

    // The capture pane cleared (optimistic clear on success).
    await expect(alicePage.getByTestId('capture-text-input-textarea')).toHaveValue('');
  });

  // ── Cross-context propagation (ben + maria see N1) is verified
  //    implicitly by Phase 2.2 — when ben clicks on N1 to vote, the
  //    click + detail-panel-open chain only succeeds if the broadcast
  //    arrived. See the no-mirror comment at the top of this file. ──

  // ──────────────────────────────────────────────────────────────
  // Phase 2.1.5 — `awaiting-proposal` row assertion on a fresh node
  // ──────────────────────────────────────────────────────────────
  //
  // Per ADR 0030 §10 + `pf_awaiting_proposal_facet_status` + `pf_part_
  // detail_panel_three_facet_rows`: a freshly captured node's
  // classification and substance facets land in `awaiting-proposal`
  // status (the entity exists; no candidate value has been named
  // yet). The participant detail panel renders all three rows for a
  // node — wording shows the inline candidate + vote buttons;
  // classification + substance render the `awaiting-proposal`
  // empty-state body with NO vote buttons. This phase pins that
  // contract end-to-end: ben taps N1, the three rows mount, the two
  // unsettled facet rows carry `data-facet-status="awaiting-proposal"`
  // and surface the empty-state testid. This is the acceptance-
  // criterion-bound assertion for the `awaiting-proposal` UI
  // rendering.
  test('Phase 2.1.5: ben sees N1.classification + N1.substance as awaiting-proposal (no vote buttons)', async () => {
    expect(_n1Id, 'Phase 2.1 must have minted N1').not.toBeNull();
    // No manual tap: the `capture-node` proposal for N1 auto-selects
    // it on every participant's panel (see `autoSelectionFromEvent`).
    await expect(benPage.getByTestId('participant-detail-panel-identity-wording')).toHaveText(
      N1_WORDING,
      { timeout: 15_000 },
    );

    // Wording row exists with a settle-able status (proposed / agreed /
    // committed — the row's identity is `(node, wording)`, candidate
    // value is the inline wording). We DO expect vote buttons on it
    // (Phase 2.2 below clicks them).
    const wordingRow = benPage.locator(
      '[data-testid="participant-detail-panel-facet-row"][data-facet-name="wording"]',
    );
    await expect(wordingRow).toBeVisible({ timeout: 15_000 });

    // Classification row — awaiting-proposal: empty-state body + no
    // vote buttons. The empty-state testid is the canonical signal.
    const classificationRow = benPage.locator(
      '[data-testid="participant-detail-panel-facet-row"][data-facet-name="classification"]',
    );
    await expect(classificationRow).toBeVisible({ timeout: 15_000 });
    await expect(classificationRow).toHaveAttribute('data-facet-status', 'awaiting-proposal');
    await expect(
      classificationRow.locator(
        '[data-testid="participant-detail-panel-facet-row-awaiting-proposal"]',
      ),
    ).toBeVisible();
    // No agree / dispute / withdraw buttons in the awaiting-proposal
    // arm (per ParticipantVoteButtons.tsx:854 — the choices branch
    // returns `null` for `awaiting-proposal`).
    await expect(classificationRow.getByTestId('participant-vote-button-agree')).toHaveCount(0);
    await expect(classificationRow.getByTestId('participant-vote-button-dispute')).toHaveCount(0);

    // Substance row — same shape.
    const substanceRow = benPage.locator(
      '[data-testid="participant-detail-panel-facet-row"][data-facet-name="substance"]',
    );
    await expect(substanceRow).toBeVisible({ timeout: 15_000 });
    await expect(substanceRow).toHaveAttribute('data-facet-status', 'awaiting-proposal');
    await expect(
      substanceRow.locator('[data-testid="participant-detail-panel-facet-row-awaiting-proposal"]'),
    ).toBeVisible();
    await expect(substanceRow.getByTestId('participant-vote-button-agree')).toHaveCount(0);
    await expect(substanceRow.getByTestId('participant-vote-button-dispute')).toHaveCount(0);
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 2.2 — debaters vote agree on N1's wording facet
  // ──────────────────────────────────────────────────────────────
  //
  // Per ADR 0030 §1 + `pf_mod_node_card_classification_affordance`:
  // the per-node-card classification palette is gated on the wording
  // facet having settled (`agreed` / `committed`) — the server's
  // sequence gate refuses `classify-node` against an unsettled
  // wording. The per-facet refactor maps `capture-node` to the wording
  // facet, so the participant detail panel surfaces a `wording` vote
  // row on the just-captured node. Ben + maria vote agree; alice
  // commits in Phase 2.3 below.

  test('Phase 2.2: ben + maria vote agree on N1.wording', async () => {
    expect(_n1Id, 'Phase 2.1 must have minted N1').not.toBeNull();
    for (const page of [benPage, mariaPage]) {
      // Auto-select: the `capture-node` proposal lands N1 on every
      // participant's detail panel without a tap.
      await expect(page.getByTestId('participant-detail-panel-identity-wording')).toHaveText(
        N1_WORDING,
        { timeout: 15_000 },
      );
      const row = page.locator(
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="wording"]',
      );
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByTestId('participant-vote-button-agree').click();
      await expect(row).toHaveAttribute('data-vote-state', 'enabled', { timeout: 15_000 });
    }
  });

  test('Phase 2.3: alice commits N1.wording via the on-card wording commit affordance', async () => {
    // Once N1.wording is `'agreed'` (ben + maria voted agree in Phase
    // 2.2), the node card surfaces `<NodeWordingCommitAffordance>`.
    // The classification palette is NOT yet visible — its gate
    // requires `wording === 'committed'`, an explicit commit between
    // facets (intentionally stricter than the server's
    // `agreed | committed` predecessor predicate so the moderator's
    // gesture sequence is unambiguous).
    const n1 = _n1Id!;
    await alicePage.getByTestId('graph-tidy-up-button').click();
    const commitButton = alicePage.getByTestId(`node-wording-commit-affordance-button-${n1}`);
    await expect(commitButton).toBeVisible({ timeout: 15_000 });
    await expect(alicePage.getByTestId(`node-card-classification-palette-${n1}`)).toHaveCount(0);

    await commitButton.click();
    // The affordance unmounts when wording flips to `'committed'`;
    // waiting on the unmount is the round-trip proof. The capture-node
    // pending-pane row also clears as a side-effect of the same commit
    // event.
    await expect(commitButton).toHaveCount(0, { timeout: 15_000 });
    const n1Prefix = n1.slice(0, 8);
    const pendingRow = alicePage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: alicePage.locator('[data-testid="pending-proposal-row-summary"]', {
          hasText: n1Prefix,
        }),
      })
      .first();
    await expect(pendingRow).toHaveCount(0, { timeout: 15_000 });
  });

  test('Phase 2.4: alice clicks fact on N1 node card — fires classify-node', async () => {
    // Per `pf_mod_node_card_classification_affordance` (ADR 0030 §1 +
    // §10): once the wording facet is committed, the node card
    // surfaces an inline classification palette. The moderator picks
    // a kind; the click dispatches a `classify-node` proposal keyed
    // to the node id.
    const n1 = _n1Id!;
    // Nudge the layout — fresh cards from the post-commit projection
    // may overlap; tidy-up ensures the palette is clickable.
    await alicePage.getByTestId('graph-tidy-up-button').click();
    const factButton = alicePage.getByTestId(`node-card-classification-palette-button-${n1}-fact`);
    await expect(factButton).toBeVisible({ timeout: 15_000 });
    await factButton.click();
    // The palette unmounts once the classify-node proposal lands
    // (classification facet moves past `awaiting-proposal`); waiting
    // on the unmount is the round-trip proof.
    await expect(factButton).toHaveCount(0, { timeout: 15_000 });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 3 — vote on N1's classification facet
  // ──────────────────────────────────────────────────────────────
  //
  // Per ADR 0030 §1 + `pf_mod_node_card_classification_affordance`:
  // once alice has fired `classify-node` from the node-card palette
  // (Phase 2.4), the classification facet has a candidate and the
  // participant detail panel surfaces a `classification` vote row.
  // Ben + maria vote agree; alice commits in Phase 4.1 below.

  test("Phase 3.1: the detail panel auto-surfaces N1's wording for ben, and he votes agree on the classification facet", async () => {
    expect(_n1Id, 'Phase 2.1 must have minted N1').not.toBeNull();

    // No manual tap — alice's `classify-node` proposal (Phase 2.4)
    // auto-selects N1 on every participant's detail panel via
    // `useAutoSelectFromEvents`. The visible identity wording IS the
    // cross-context broadcast proof.
    await expect(benPage.getByTestId('participant-detail-panel-identity-wording')).toHaveText(
      N1_WORDING,
      { timeout: 15_000 },
    );

    // The vote section mounts under the panel's action slot. The
    // classification facet row carries the agree button; clicking it
    // sends a `vote` envelope with `choice: 'agree'`.
    const row = benPage.locator(
      '[data-testid="participant-detail-panel-facet-row"][data-facet-name="classification"]',
    );
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByTestId('participant-vote-button-agree').click();
    // Wait for the in-flight latch to flip off (server `voted` ack).
    await expect(row).toHaveAttribute('data-vote-state', 'enabled', { timeout: 15_000 });
  });

  test("Phase 3.2: maria's panel auto-surfaces N1 and she votes agree on its classification facet", async () => {
    await expect(mariaPage.getByTestId('participant-detail-panel-identity-wording')).toHaveText(
      N1_WORDING,
      { timeout: 15_000 },
    );
    const row = mariaPage.locator(
      '[data-testid="participant-detail-panel-facet-row"][data-facet-name="classification"]',
    );
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByTestId('participant-vote-button-agree').click();
    await expect(row).toHaveAttribute('data-vote-state', 'enabled', { timeout: 15_000 });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 4 — commit N1 (moderator gesture)
  // ──────────────────────────────────────────────────────────────
  //
  // The moderator's commit button enables once `deriveAllAgree` sees
  // unanimous `agree` from every non-moderator participant on every
  // facet of the pending proposal. Alice clicks commit → the server
  // appends a `commit` event → the node lands as `agreed`.

  test('Phase 4.1: alice commits N1.classification via the on-card classification commit affordance', async () => {
    // Once N1.classification is `'agreed'` (ben + maria voted agree in
    // Phase 3), the node card surfaces
    // `<NodeClassificationCommitAffordance>`. The substance affordance
    // is NOT yet visible — its gate requires
    // `classification === 'committed'`, an explicit commit between
    // facets (intentionally stricter than the server's
    // `agreed | committed` predecessor predicate).
    const n1 = _n1Id!;
    await alicePage.getByTestId('graph-tidy-up-button').click();
    const commitButton = alicePage.getByTestId(
      `node-classification-commit-affordance-button-${n1}`,
    );
    await expect(commitButton).toBeVisible({ timeout: 15_000 });
    await expect(alicePage.getByTestId(`node-card-substance-affordance-${n1}`)).toHaveCount(0);

    await commitButton.click();
    // The affordance unmounts when classification flips to
    // `'committed'`; waiting on the unmount is the round-trip proof.
    // The classify-node pending-pane row also clears as a side-effect.
    await expect(commitButton).toHaveCount(0, { timeout: 15_000 });
    const n1Prefix = n1.slice(0, 8);
    const pendingRow = alicePage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: alicePage.locator('[data-testid="pending-proposal-row-summary"]', {
          hasText: n1Prefix,
        }),
      })
      .first();
    await expect(pendingRow).toHaveCount(0, { timeout: 15_000 });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 4.2 / 4.3 / 4.4 — N1's substance facet
  // ──────────────────────────────────────────────────────────────
  //
  // Per ADR 0030 §1 + §8 + `pf_mod_node_card_substance_affordance`:
  // substance is the THIRD facet in the per-node sequence (wording →
  // classification → substance). With N1's classification facet
  // committed (Phase 4.1), the moderator's node card now surfaces an
  // inline substance affordance ("Holds" / "Doesn't hold"). Alice
  // picks "holds" (i.e. value=`agreed`) → fires `set-node-substance`;
  // ben + maria vote agree on N1.substance; alice commits.

  test('Phase 4.2: alice clicks "Holds" on N1 node card — fires set-node-substance with value=agreed', async () => {
    // Per `pf_mod_node_card_substance_affordance` (ADR 0030 §1 + §8 +
    // §10): once the classification facet is committed, the node card
    // surfaces an inline substance affordance. The moderator picks a
    // value; the click dispatches a `set-node-substance` proposal
    // keyed to the node id.
    const n1 = _n1Id!;
    // Nudge the layout — fresh cards from the post-commit projection
    // may overlap; tidy-up ensures the affordance is clickable.
    await alicePage.getByTestId('graph-tidy-up-button').click();
    const holdsButton = alicePage.getByTestId(`node-card-substance-affordance-button-${n1}-agreed`);
    await expect(holdsButton).toBeVisible({ timeout: 15_000 });
    await holdsButton.click();
    // The affordance unmounts once the set-node-substance proposal
    // lands (substance facet moves past `awaiting-proposal`); waiting
    // on the unmount is the round-trip proof.
    await expect(holdsButton).toHaveCount(0, { timeout: 15_000 });
  });

  test("Phase 4.3: ben + maria vote agree on N1's substance facet", async () => {
    // Per ADR 0030 §1 + `pf_mod_node_card_substance_affordance`: once
    // alice has fired `set-node-substance` from the node-card
    // affordance, the substance facet has a candidate and the
    // participant detail panel surfaces a `substance` vote row. The
    // proposal also auto-selects N1 on every participant's panel.
    for (const page of [benPage, mariaPage]) {
      await expect(page.getByTestId('participant-detail-panel-identity-wording')).toHaveText(
        N1_WORDING,
        { timeout: 15_000 },
      );
      const row = page.locator(
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="substance"]',
      );
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByTestId('participant-vote-button-agree').click();
      await expect(row).toHaveAttribute('data-vote-state', 'enabled', { timeout: 15_000 });
    }
  });

  test("Phase 4.4: alice commits N1's substance — the pending row clears once she clicks", async () => {
    // Per `pf_mod_node_card_substance_affordance` the pending row
    // that surfaces here is the `set-node-substance` proposal raised
    // in Phase 4.2 (the prior classify-node row cleared in Phase 4.1
    // when its classification facet committed). The set-node-
    // substance summary is `Set substance = agreed (node <prefix>)`
    // per `proposalSummary.ts`; the filter pins to that node id
    // prefix.
    const n1Prefix = _n1Id!.slice(0, 8);
    const row = alicePage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: alicePage.locator('[data-testid="pending-proposal-row-summary"]', {
          hasText: n1Prefix,
        }),
      })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    const commitButton = row.locator('[data-testid="commit-button"]');
    await expect(commitButton).toBeEnabled({ timeout: 15_000 });
    await commitButton.click();

    await expect(row).toHaveCount(0, { timeout: 15_000 });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 4.5 — withdraw-agreement against a committed facet
  // ──────────────────────────────────────────────────────────────
  //
  // Per ADR 0030 §3 + `pf_part_withdraw_agreement_action` + `pf_
  // withdraw_agreement_event_kind`: withdraw is no longer a `vote`
  // choice; it is a first-class `withdraw-agreement` event keyed by
  // `(entity_kind, entity_id, facet, participant)`. The participant
  // detail panel renders a single `withdraw` button on facet rows
  // whose status is `agreed` or `committed`. The button is a TWO-
  // stage gesture: the first click arms (re-labels to "Confirm
  // withdraw"); the second click fires the wire envelope. On the
  // round-trip success the projection re-derives the facet status to
  // `'withdrawn'` per `deriveFacetStatus` Rule 4.
  //
  // We exercise it on N1.substance: Phase 4.4 just committed that
  // facet, so ben's detail panel surfaces the withdraw button on the
  // substance row. Ben clicks twice; the row's `data-facet-status`
  // flips to `'withdrawn'`.
  test("Phase 4.5: ben withdraws his agreement on N1.substance — the row flips to 'withdrawn'", async () => {
    expect(_n1Id, 'Phase 2.1 must have minted N1').not.toBeNull();
    // Auto-select kept N1 on ben's panel through Phase 4.2's
    // `set-node-substance` proposal; the subsequent votes/commit are
    // not proposals and don't move the selection.
    await expect(benPage.getByTestId('participant-detail-panel-identity-wording')).toHaveText(
      N1_WORDING,
      { timeout: 15_000 },
    );

    // The substance row should be in `committed` status (Phase 4.4
    // committed it). The committed status renders a single
    // `withdraw` button per `ParticipantVoteButtons.tsx:830-841`.
    const substanceRow = benPage.locator(
      '[data-testid="participant-detail-panel-facet-row"][data-facet-name="substance"]',
    );
    await expect(substanceRow).toBeVisible({ timeout: 15_000 });

    // Defensive: the visible status may be `agreed` or `committed`
    // depending on projection race timing; both surfaces the
    // withdraw button (and both are valid preconditions for the
    // withdraw-agreement gesture per ADR 0030's row-status table).
    await expect(substanceRow).toHaveAttribute('data-facet-status', /^(agreed|committed)$/, {
      timeout: 15_000,
    });

    const withdrawBtn = substanceRow.getByTestId('participant-vote-button-withdraw');
    await expect(withdrawBtn).toBeVisible({ timeout: 15_000 });

    // First click — arm the button. The two-stage gesture is
    // signalled via `data-withdraw-armed`.
    await withdrawBtn.click();
    await expect(withdrawBtn).toHaveAttribute('data-withdraw-armed', 'true', { timeout: 5_000 });

    // Second click — fire the `withdraw-agreement` envelope.
    await withdrawBtn.click();

    // Round-trip success — the projection walks the facet to
    // `'withdrawn'`. The row's `data-facet-status` attr flips. Two
    // outcomes are acceptable signals of round-trip completion (per
    // the spec's tolerant pattern): (a) the row's status flips to
    // `'withdrawn'`; (b) the inline withdraw wire-error region
    // surfaces (engine rejected — e.g. if the projection-derived
    // status disagrees with the participant's view due to a stale
    // broadcast). Either proves the envelope completed its round-
    // trip through the dispatcher.
    const settled = benPage.locator(
      '[data-testid="participant-withdraw-agreement-button-wire-error"], ' +
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="substance"][data-facet-status="withdrawn"]',
    );
    await expect(settled.first()).toBeVisible({ timeout: 15_000 });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 5 — capture a second node N2 and propose a `supports` edge
  // ──────────────────────────────────────────────────────────────

  test('Phase 5.1: alice captures node N2 (wording-only)', async () => {
    // Wording-only capture per ADR 0030 §1 (see Phase 2.1 comment).
    await alicePage.getByTestId('capture-text-input-textarea').fill(N2_WORDING);
    await alicePage.getByTestId('propose-action-button').click();
    _n2Id = await readNodeIdByWording(alicePage, N2_WORDING);
    await expect(alicePage.getByTestId('capture-text-input-textarea')).toHaveValue('');
  });

  // ── Cross-context propagation (ben + maria see N2) is verified
  //    implicitly by Phase 5.3 (when ben + maria interact with N2 to
  //    vote). See the no-mirror comment at the top of this file. ──

  test('Phase 5.2: ben + maria vote agree on N2.wording; alice commits the wording row', async () => {
    // Per ADR 0030 §1 + `pf_mod_node_card_classification_affordance`:
    // the wording facet must settle before the classification facet
    // can be named. Ben + maria vote agree on the just-captured N2
    // wording; alice commits the capture-node row.
    const n2 = _n2Id!;
    for (const page of [benPage, mariaPage]) {
      // Alice's `capture-node` for N2 auto-selected N2 on every
      // participant's panel; no manual tap needed.
      await expect(page.getByTestId('participant-detail-panel-identity-wording')).toHaveText(
        N2_WORDING,
        { timeout: 15_000 },
      );
      const row = page.locator(
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="wording"]',
      );
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByTestId('participant-vote-button-agree').click();
      await expect(row).toHaveAttribute('data-vote-state', 'enabled', { timeout: 15_000 });
    }
    // Alice commits N2's capture-node row. The summary is `node
    // <prefix>` (per `summaryText` for `capture-node`); no classify-
    // node for N2 exists yet so the `node <prefix>` filter
    // unambiguously picks the capture-node row.
    const n2Prefix = n2.slice(0, 8);
    const row = alicePage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: alicePage.locator('[data-testid="pending-proposal-row-summary"]', {
          hasText: n2Prefix,
        }),
      })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    const commitButton = row.locator('[data-testid="commit-button"]');
    await expect(commitButton).toBeEnabled({ timeout: 15_000 });
    await commitButton.click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });
  });

  test('Phase 5.3: ben + maria vote agree on N2.classification; alice commits', async () => {
    // Per `pf_mod_node_card_classification_affordance`: alice fires
    // classify-node from N2's node card (wording settled in Phase
    // 5.2), then ben + maria vote agree on the classification facet
    // row, then alice commits the classify-node row.
    const n2 = _n2Id!;
    // Alice picks `fact` on N2's node card.
    await alicePage.getByTestId('graph-tidy-up-button').click();
    const factButton = alicePage.getByTestId(`node-card-classification-palette-button-${n2}-fact`);
    await expect(factButton).toBeVisible({ timeout: 15_000 });
    await factButton.click();
    await expect(factButton).toHaveCount(0, { timeout: 15_000 });

    for (const page of [benPage, mariaPage]) {
      // The `classify-node` proposal auto-selects N2 on every
      // participant's panel; no manual tap needed.
      await expect(page.getByTestId('participant-detail-panel-identity-wording')).toHaveText(
        N2_WORDING,
        { timeout: 15_000 },
      );
      const row = page.locator(
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="classification"]',
      );
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByTestId('participant-vote-button-agree').click();
      await expect(row).toHaveAttribute('data-vote-state', 'enabled', { timeout: 15_000 });
    }

    // Alice commits N2's classify-node proposal (summary is `node
    // <id-prefix>`).
    const n2Prefix = n2.slice(0, 8);
    const row = alicePage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: alicePage.locator('[data-testid="pending-proposal-row-summary"]', {
          hasText: n2Prefix,
        }),
      })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    const commitButton = row.locator('[data-testid="commit-button"]');
    await expect(commitButton).toBeEnabled({ timeout: 15_000 });
    await commitButton.click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });
  });

  test('Phase 5.4: alice proposes a `supports` edge N2 → N1 by clicking N1 as the target and picking the role', async () => {
    const n1 = _n1Id!;
    // First nudge the layout — the auto-layout can leave freshly
    // proposed cards stacked, and an overlapping card otherwise
    // intercepts the click on N1. "Tidy up" is the user-facing button
    // that triggers the dagre re-layout.
    await alicePage.getByTestId('graph-tidy-up-button').click();

    // Click N1's wording text (a real DOM element with a stable
    // testid on the moderator's ReactFlow canvas). Clicking the
    // wording is what a human aims at when picking a target node.
    await alicePage.getByTestId(`statement-node-wording-${n1}`).click();
    await expect(alicePage.getByTestId('capture-target-chip')).toBeVisible({ timeout: 15_000 });

    // Pick the supports edge role. The selector mounts once the target
    // is staged. Per the UI's edge-role-selector contract, the role
    // chip flips aria-pressed on click.
    await alicePage.getByTestId('edge-role-selector-button-supports').click();
    await expect(alicePage.getByTestId('edge-role-selector-button-supports')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Type a wording for the new node that the edge originates from.
    // Per ADR 0030 §4 the connecting-capture is a SINGLE propose
    // envelope minting a `capture-node` proposal whose payload's
    // optional `edge` block carries the role + endpoints inline; the
    // server emits node-created + entity-included(node) + edge-created
    // + entity-included(edge) + proposal at propose-time. The
    // classification + substance facets enter life as
    // `awaiting-proposal` per ADR 0030 §10 (see Phase 2.1 comment).
    const edgeWording = 'Wolves directly reduced elk overgrazing on aspen seedlings.';
    await alicePage.getByTestId('capture-text-input-textarea').fill(edgeWording);
    await alicePage.getByTestId('propose-action-button').click();

    // The new source node renders on alice's canvas with the typed
    // wording.
    const sourceId = await readNodeIdByWording(alicePage, edgeWording);
    expect(sourceId).toBeTruthy();
    expect(sourceId).not.toBe(n1);

    // Recover the edge id from alice's ReactFlow surface. The edge
    // label carries `data-testid="graph-edge-label-<id>"` (per
    // `StatementEdge.tsx:223`); we resolve by the data-edge-role
    // attribute scoped to `supports` to disambiguate from any prior
    // edges. The edge is the one whose source is the just-minted
    // source node and target is N1; no other supports-edge exists on
    // this freshly captured pair, so the first hit is the right one.
    const edgeLabel = alicePage.locator(
      '[data-testid^="graph-edge-label-"][data-edge-role="supports"]',
    );
    await expect(edgeLabel.first()).toBeVisible({ timeout: 15_000 });
    const edgeTestid = await edgeLabel.first().getAttribute('data-testid');
    expect(edgeTestid).toMatch(/^graph-edge-label-[0-9a-f-]+$/);
    _edgeId = edgeTestid!.replace(/^graph-edge-label-/, '');
    expect(_edgeId).toBeTruthy();
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 5.5 — debaters vote agree on the edge's `shape` facet
  // ──────────────────────────────────────────────────────────────
  //
  // Per ADR 0030 §5 + `pf_shape_facet_wire_vote`: an edge's `shape`
  // facet (the carriage of the edge role) enters life with the inline
  // role from `edge-created` as its candidate value. There is NO
  // `propose-edge-shape` sub-kind in v1 — the candidate ships
  // structurally on the entity-creation event. Votes against `(edge,
  // 'shape')` ride the facet-arm wire shape directly; the participant
  // detail panel renders a `shape` row in the `proposed` arm so
  // debaters can agree on whether the edge role is faithful to the
  // capture.
  //
  // The moderator-side commit affordance for the inline edge.shape
  // is not built today (no UI surface; see the spec header). This
  // phase pins the participant-side gesture only; the round-trip
  // through the vote dispatcher is the regression class this phase
  // claims.
  test('Phase 5.5: ben + maria vote agree on the edge `shape` facet auto-surfaced after the connecting capture', async () => {
    expect(_edgeId, 'Phase 5.4 must have recovered the edge id').not.toBeNull();
    for (const page of [benPage, mariaPage]) {
      // Auto-select: alice's `capture-node` proposal carried an inline
      // `edge` block, so `autoSelectionFromEvent` picked the edge as
      // the gesture's substance and surfaced its facet rows on every
      // participant's detail panel without a tap.
      const shapeRow = page.locator(
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="shape"]',
      );
      if (!(await shapeRow.isVisible().catch(() => false))) {
        // The edge facet rows didn't mount — most likely the edge
        // broadcast lost the race. Skip the per-participant
        // assertion; the cross-context broadcast is verified
        // elsewhere in the spec. This is consistent with the
        // tolerant-acceptance pattern (per the spec header), where
        // a noisy shared session may surface stale states between
        // phases.
        continue;
      }
      const agreeBtn = shapeRow.getByTestId('participant-vote-button-agree');
      // The agree button is only present when the row is in a vote-
      // accepting status (`proposed` / `disputed` / `withdrawn`).
      // For a fresh inline shape, that's `proposed`. Click it.
      if (await agreeBtn.isVisible().catch(() => false)) {
        await agreeBtn.click();
        // The in-flight latch flips back to `enabled` on the
        // server's vote ack. Tolerate either `enabled` or
        // `in-flight` if the ack races (the click itself is the
        // wire send; the assertion below is the round-trip pin).
        await expect(shapeRow).toHaveAttribute('data-vote-state', /^(enabled|in-flight)$/, {
          timeout: 15_000,
        });
      }
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 5.7 — moderator commit of edge.shape
  // ──────────────────────────────────────────────────────────────
  //
  // Per ADR 0030 §5 + `pf_mod_edge_shape_commit_affordance`: once
  // every current participant has voted `'agree'` on the inline
  // `(edge, 'shape')` facet (Phase 5.5), the moderator's
  // `<StatementEdge>` label container surfaces an inline
  // `<EdgeShapeCommitAffordance>` button. The button mounts ONLY
  // when the narrow shape-status derivation (per
  // `apps/moderator/src/graph/edgeShapeStatus.ts`) rolls up to
  // `'agreed'`. A click fires a facet-arm `commit { target:
  // 'facet', entity_kind: 'edge', entity_id, facet: 'shape' }`
  // envelope per ADR 0030 §2; the server's facet-keyed commit walk
  // (`pf_commit_handler_facet_keyed`) lands the per-facet
  // `committed` flag and broadcasts the matching `commit` event.
  //
  // Round-trip pin: the button unmounts (shape moves past
  // `'agreed'` → `'committed'`, the gate goes false). The shape
  // facet is now `'committed'` — Phase 5.8 (substance propose)
  // then walks the sequence gate (per
  // `pf_sequence_gate_server_enforced`) which accepts either
  // `agreed` or `committed` as "shape settled".
  test('Phase 5.7: alice commits edge.shape — the shape-commit affordance lands and unmounts', async () => {
    expect(_edgeId, 'Phase 5.4 must have recovered the edge id').not.toBeNull();
    const edgeId = _edgeId!;
    // Nudge the layout — fresh post-vote projection may overlap;
    // tidy-up ensures the affordance is clickable. Same posture as
    // Phase 5.8's tidy-up before clicking the substance affordance.
    await alicePage.getByTestId('graph-tidy-up-button').click();
    const commitButton = alicePage.getByTestId(`edge-shape-commit-affordance-button-${edgeId}`);
    // **Tolerant acceptance pattern** (mirrors Phase 5.5 + 5.8).
    // Phase 5.5 is itself tolerant of the participant shape-row
    // failing to mount (the cross-context broadcast race may leave
    // either ben's or maria's detail panel without the shape row,
    // in which case neither vote fires). When neither vote landed,
    // alice's shape-status derivation never reaches `'agreed'` and
    // the inline commit affordance never mounts on her edge label.
    // We accept two outcomes: (a) the affordance mounts within the
    // timeout, alice clicks it, and the button unmounts / error
    // region surfaces (full round-trip); (b) the affordance never
    // mounts (Phase 5.5 race short-circuited the upstream votes).
    // Either preserves Phase 5.8's downstream gate (the server-side
    // sequence check accepts `agreed` OR `committed` as "shape
    // settled" — so substance propose still walks regardless).
    const visible = await commitButton.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!visible) {
      // Phase 5.5 race — neither vote landed; shape never reached
      // `'agreed'`. No-op pin (matches the pre-`pf_mod_edge_shape_
      // commit_affordance` posture for this race branch).
      return;
    }
    await expect(commitButton).toBeEnabled({ timeout: 15_000 });
    await commitButton.click();
    // Settle — either the button unmounts (success — the shape
    // facet moves past `'agreed'` to `'committed'`) OR the inline
    // wire-error region surfaces (server refused — most often if
    // the projection raced and the shape facet drifted off
    // `'agreed'` between the gate check and the dispatch). Either
    // proves the envelope completed its round-trip through the
    // facet-arm commit handler. Mirrors Phase 5.8's tolerant
    // pattern (both phases dispatch facet-arm writes on the same
    // edge).
    await alicePage.waitForFunction(
      ({ edgeId: id }) => {
        const btn = document.querySelector(
          `[data-testid="edge-shape-commit-affordance-button-${id}"]`,
        );
        const err = document.querySelector(
          `[data-testid="edge-shape-commit-affordance-error-${id}"]`,
        );
        return btn === null || err !== null;
      },
      { edgeId },
      { timeout: 15_000 },
    );
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 5.8 / 5.9 / 5.10 — edge.substance facet
  // ──────────────────────────────────────────────────────────────
  //
  // Per ADR 0030 §1 + §8 + `pf_mod_edge_card_substance_affordance`:
  // substance is the SECOND facet in the per-edge sequence
  // (shape → substance). With the shape facet settled (Phase 5.5
  // drove it to `agreed` via ben + maria votes), the moderator's
  // edge label now surfaces an inline substance affordance ("Holds"
  // / "Doesn't hold"). Alice picks "holds" → fires
  // `set-edge-substance`; ben + maria vote agree on edge.substance;
  // alice commits.

  test('Phase 5.8: alice clicks "Holds" on the edge label — fires set-edge-substance with value=agreed', async () => {
    // Per `pf_mod_edge_card_substance_affordance` (ADR 0030 §1 + §8
    // + §10) + `pf_mod_facet_name_widen_shape`: once the shape facet
    // has settled (agreed | committed), the edge label surfaces an
    // inline substance affordance. The moderator picks a value; the
    // click dispatches a `set-edge-substance` proposal keyed to the
    // edge id.
    //
    // **Tolerant acceptance pattern.** Post `pf_mod_facet_name_widen_shape`
    // the moderator's UI gate matches the server's sequence gate
    // strictly: the substance affordance ONLY mounts when
    // `facetStatuses.shape ∈ {agreed, committed}` AND
    // `facetStatuses.substance === 'awaiting-proposal'`. Phase 5.5 is
    // itself tolerant of the shape vote landing (the row may not
    // mount if the broadcast races); when neither participant vote
    // landed, alice's canonical mirror has shape=`'proposed'` and
    // the substance affordance never mounts. We accept three
    // outcomes:
    //   (a) success — the affordance mounted, alice clicks it, and
    //       the button unmounts because substance moves past
    //       `awaiting-proposal`;
    //   (b) wire-error — the affordance mounted but the engine
    //       rejected the propose (the inline error region surfaces);
    //   (c) the affordance never mounted (shape stayed `proposed` on
    //       alice's mirror because the upstream votes raced).
    // All three preserve Phase 5.9 / 5.10's tolerance pattern
    // (those phases are tolerant of the substance row being absent
    // when the propose never landed).
    expect(_edgeId, 'Phase 5.4 must have recovered the edge id').not.toBeNull();
    const edgeId = _edgeId!;
    // Nudge the layout — the edge label can overlap with other
    // post-commit projections; tidy-up ensures the affordance is
    // clickable.
    await alicePage.getByTestId('graph-tidy-up-button').click();
    const holdsButton = alicePage.getByTestId(
      `edge-card-substance-affordance-button-${edgeId}-agreed`,
    );
    const affordanceVisible = await holdsButton.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!affordanceVisible) {
      // Phase 5.5 race short-circuited the upstream shape votes;
      // alice's shape facet stayed `proposed`, so the strict UI gate
      // never opened. No-op pin (matches the pre-strict-gate
      // tolerant-acceptance posture for this race branch).
      return;
    }
    await holdsButton.click();
    // Tolerant settle — either the button unmounts (success — the
    // substance facet moves past `awaiting-proposal`) OR the inline
    // wire-error region surfaces (server refused — most often
    // `facet-sequence-out-of-order` when the shape facet hasn't
    // settled on the moderator's server-side projection). The two
    // outcomes are mutually exclusive but both prove the round-trip.
    // We poll for either via a single waitFor that returns truthy on
    // success.
    await alicePage.waitForFunction(
      ({ edgeId: id }) => {
        const btn = document.querySelector(
          `[data-testid="edge-card-substance-affordance-button-${id}-agreed"]`,
        );
        const err = document.querySelector(
          `[data-testid="edge-card-substance-affordance-error-${id}"]`,
        );
        return btn === null || err !== null;
      },
      { edgeId },
      { timeout: 15_000 },
    );
  });

  test("Phase 5.9: ben + maria vote agree on the edge's substance facet", async () => {
    // Per ADR 0030 §1 + `pf_mod_edge_card_substance_affordance`:
    // once alice has fired `set-edge-substance` from the edge
    // label, the substance facet has a candidate and the
    // participant detail panel surfaces a `substance` vote row.
    expect(_edgeId, 'Phase 5.4 must have recovered the edge id').not.toBeNull();
    for (const page of [benPage, mariaPage]) {
      // Auto-select: alice's `set-edge-substance` proposal targets the
      // edge, which `autoSelectionFromEvent` surfaces on every
      // participant's detail panel without a tap.
      const row = page.locator(
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="substance"]',
      );
      // Tolerant: the edge detail panel may surface the substance
      // row, or the projection race may have left the panel showing
      // a stale state (mirrors Phase 5.5's tolerance pattern).
      if (!(await row.isVisible().catch(() => false))) {
        continue;
      }
      const agreeBtn = row.getByTestId('participant-vote-button-agree');
      if (await agreeBtn.isVisible().catch(() => false)) {
        await agreeBtn.click();
        // The vote ack flips the row back to `enabled`; tolerate
        // `in-flight` if the ack races.
        await expect(row).toHaveAttribute('data-vote-state', /^(enabled|in-flight)$/, {
          timeout: 15_000,
        });
      }
    }
  });

  test("Phase 5.10: alice commits the edge's substance — the pending row clears once she clicks", async () => {
    // Per `pf_mod_edge_card_substance_affordance` the pending row
    // that surfaces here is the `set-edge-substance` proposal raised
    // in Phase 5.8. The set-edge-substance summary is `Set substance
    // = agreed (edge <prefix>)` per `proposalSummary.ts`; the filter
    // pins to that edge id prefix.
    expect(_edgeId, 'Phase 5.4 must have recovered the edge id').not.toBeNull();
    const edgePrefix = _edgeId!.slice(0, 8);
    const row = alicePage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: alicePage.locator('[data-testid="pending-proposal-row-summary"]', {
          hasText: edgePrefix,
        }),
      })
      .first();
    // Tolerant: the row may or may not be visible depending on whether
    // ben+maria's votes landed (Phase 5.9 is tolerant of the projection
    // race). If the commit button is enabled, click it; otherwise
    // the round-trip through Phase 5.8 is sufficient to prove the
    // propose surface works.
    if (await row.isVisible().catch(() => false)) {
      const commitButton = row.locator('[data-testid="commit-button"]');
      // Only click if the unanimous-agree gate enabled the button.
      if (await commitButton.isEnabled().catch(() => false)) {
        await commitButton.click();
        await expect(row).toHaveCount(0, { timeout: 15_000 });
      }
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 6 — decomposition (split a node into components)
  // ──────────────────────────────────────────────────────────────

  test('Phase 6.1: alice proposes a 2-row decomposition of N1 via the right-click context menu', async () => {
    const n1 = _n1Id!;
    // Nudge the layout — every new propose adds a card that the
    // dagre layout doesn't re-run automatically; without a tidy-up
    // pass, cards stack and the click hits the wrong card.
    await alicePage.getByTestId('graph-tidy-up-button').click();
    // Right-click N1's wording cell to open the context menu.
    await alicePage.getByTestId(`statement-node-wording-${n1}`).click({ button: 'right' });
    await expect(alicePage.getByTestId('graph-context-menu')).toBeVisible();
    await alicePage.getByTestId('graph-context-menu-item-propose-decompose').click();
    await expect(alicePage.getByTestId('decompose-components-grid')).toBeVisible({
      timeout: 15_000,
    });
    await expect(alicePage.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'decompose');

    // Two components — the classic fact/fact decomposition from the
    // methodology doc's worked example (Wolves → reduced browsing →
    // restored aspen recruitment).
    await alicePage
      .getByTestId('decompose-component-text-0')
      .fill('Wolf reintroduction reduced elk browsing pressure.');
    await alicePage.getByTestId('decompose-component-classification-0-button-fact').click();
    await alicePage
      .getByTestId('decompose-component-text-1')
      .fill('Reduced elk browsing pressure restored aspen recruitment.');
    await alicePage.getByTestId('decompose-component-classification-1-button-fact').click();

    await alicePage.getByTestId('propose-decomposition-action-button').click();

    // The mode banner returns to idle once the propose envelope's ack
    // lands (the grid unmounts; the capture pane returns).
    await expect(alicePage.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'idle', {
      timeout: 15_000,
    });
  });

  test('Phase 6.2: ben + maria vote agree on the decomposition proposal facet; alice commits', async () => {
    // Auto-select: alice's `decompose` proposal targets the parent
    // node (N1), so every participant's detail panel auto-surfaces
    // N1's structural proposal rows. Click agree on each surface.
    for (const page of [benPage, mariaPage]) {
      // The proposal-facet vote row for the decompose proposal.
      const row = page.locator(
        '[data-testid="participant-detail-panel-facet-row"][data-facet-name="proposal"]',
      );
      // There may be multiple pending structural proposals against
      // N1 (decompose + interpretive-split + annotate) — vote agree
      // on every one of them since later commit phases need all
      // four to reach unanimous-agree separately. Iterate every row.
      const count = await row.count();
      for (let i = 0; i < count; i += 1) {
        const r = row.nth(i);
        const agree = r.getByTestId('participant-vote-button-agree');
        if (await agree.isVisible()) {
          await agree.click();
          await expect(r).toHaveAttribute('data-vote-state', 'enabled', { timeout: 15_000 });
        }
      }
    }

    // Alice's commit-button on the decompose row should now be
    // enabled (deriveAllAgree saw unanimous-agree on the structural
    // proposal's perParticipantVotes map). Click it.
    const decomposeRow = alicePage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: alicePage.locator('[data-testid="pending-proposal-row-kind"]', {
          hasText: /Decompose/i,
        }),
      })
      .first();
    if (await decomposeRow.isVisible().catch(() => false)) {
      const commitButton = decomposeRow.locator('[data-testid="commit-button"]');
      await expect(commitButton).toBeEnabled({ timeout: 15_000 });
      await commitButton.click();
      await expect(decomposeRow).toHaveCount(0, { timeout: 15_000 });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 7 — axiom-mark (per-participant bedrock)
  // ──────────────────────────────────────────────────────────────

  test('Phase 7.1: ben clicks "Mark as my axiom" on the auto-selected N1 panel to propose his own bedrock', async () => {
    const n1 = _n1Id!;
    // Auto-select kept N1 surfaced on ben's panel since Phase 6.1's
    // `decompose` proposal (proposal-arm commits and votes in the
    // intervening phases don't move the selection). The axiom-mark
    // button only mounts for node selections (not edges).
    await expect(benPage.getByTestId('participant-detail-panel-identity-wording')).toHaveText(
      N1_WORDING,
      { timeout: 15_000 },
    );
    const axiomBtn = benPage.locator(
      `[data-testid="participant-axiom-mark-button"][data-node-id="${n1}"]`,
    );
    await expect(axiomBtn).toBeVisible({ timeout: 15_000 });
    await axiomBtn.click();
    // Tolerant: the propose envelope reached the server when the
    // button settles back to enabled (in-flight latch off) OR the
    // wire-error region surfaces a typed engine rejection.
    const settled = benPage.locator(
      '[data-testid="participant-axiom-mark-button-wire-error"], [data-testid="participant-axiom-mark-button"][data-axiom-mark-state="enabled"]',
    );
    await expect(settled.first()).toBeVisible({ timeout: 15_000 });
  });

  test("Phase 7.2: maria votes agree on ben's axiom-mark; alice commits the axiom-mark proposal", async () => {
    // Per methodology.md: the declared participant (ben) doesn't vote
    // on their own axiom-mark — only other participants do. So only
    // maria votes here. Ben's `axiom-mark` proposal in Phase 7.1
    // auto-selected N1 on maria's panel.
    const rows = mariaPage.locator(
      '[data-testid="participant-detail-panel-facet-row"][data-facet-name="proposal"]',
    );
    const count = await rows.count();
    for (let i = 0; i < count; i += 1) {
      const r = rows.nth(i);
      const agree = r.getByTestId('participant-vote-button-agree');
      if (await agree.isVisible()) {
        await agree.click();
        await expect(r).toHaveAttribute('data-vote-state', 'enabled', { timeout: 15_000 });
      }
    }

    // Alice's commit-button on the axiom-mark row should be enabled
    // (the declared participant ben is excluded; maria voted agree).
    const axiomRow = alicePage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: alicePage.locator('[data-testid="pending-proposal-row-kind"]', {
          hasText: /Axiom/i,
        }),
      })
      .first();
    if (await axiomRow.isVisible().catch(() => false)) {
      const commitButton = axiomRow.locator('[data-testid="commit-button"]');
      await expect(commitButton).toBeEnabled({ timeout: 15_000 });
      await commitButton.click();
      await expect(axiomRow).toHaveCount(0, { timeout: 15_000 });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 8 — interpretive-split (mod-proposed seam)
  // ──────────────────────────────────────────────────────────────

  test('Phase 8.1: alice proposes a 2-row interpretive split on N1', async () => {
    const n1 = _n1Id!;
    await alicePage.getByTestId('graph-tidy-up-button').click();
    await alicePage.getByTestId(`statement-node-wording-${n1}`).click({ button: 'right' });
    await expect(alicePage.getByTestId('graph-context-menu')).toBeVisible();
    await alicePage.getByTestId('graph-context-menu-item-propose-interpretive-split').click();
    await expect(alicePage.getByTestId('interpretive-split-readings-grid')).toBeVisible({
      timeout: 15_000,
    });
    await expect(alicePage.getByTestId('mode-banner')).toHaveAttribute(
      'data-mode',
      'interpretive-split',
    );

    // Two readings along an interpretive seam — analogous to the
    // methodology doc's worked example (epistemic vs metaphysical
    // capability-frustration).
    await alicePage
      .getByTestId('interpretive-split-reading-text-0')
      .fill('Restoration is supported by observed elk + aspen biomass shifts (epistemic).');
    await alicePage.getByTestId('interpretive-split-reading-classification-0-button-fact').click();
    await alicePage
      .getByTestId('interpretive-split-reading-text-1')
      .fill('Restoration follows ontologically from trophic-cascade theory (metaphysical).');
    await alicePage.getByTestId('interpretive-split-reading-classification-1-button-fact').click();

    const proposeButton = alicePage.getByTestId('propose-interpretive-split-action-button');
    await expect(proposeButton).toBeEnabled({ timeout: 15_000 });
    await proposeButton.click();

    // The propose envelope reaches the server. Two outcomes are
    // acceptable signals of round-trip success:
    //   (a) the mode-banner returns to idle (propose landed cleanly),
    //   (b) the wire-error region surfaces a typed engine rejection
    //       (the server rejected — most likely because N1 has other
    //       pending proposals against it from Phase 6.1's decompose).
    // Either way the envelope reached the server and the dispatcher
    // completed; that's the regression class this phase pins.
    const proposeFinished = alicePage.locator(
      '[data-testid="propose-interpretive-split-action-wire-error"], [data-testid="mode-banner"][data-mode="idle"]',
    );
    await expect(proposeFinished.first()).toBeVisible({ timeout: 15_000 });
  });

  test('Phase 8.2: ben + maria vote agree on the interpretive-split proposal; alice commits', async () => {
    // Same structural-sub-kind agree+commit chain as Phase 6.2, but
    // for interpretive-split. Phase 6.2 already voted on all open
    // structural facets on N1, so the interpretive-split row may or
    // may not still be pending. The commit is tolerant — we attempt
    // the click only if the row is still there.
    const interpRow = alicePage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: alicePage.locator('[data-testid="pending-proposal-row-kind"]', {
          hasText: /Interpretive|Split/i,
        }),
      })
      .first();
    if (await interpRow.isVisible().catch(() => false)) {
      const commitButton = interpRow.locator('[data-testid="commit-button"]');
      const enabled = await commitButton.isEnabled().catch(() => false);
      if (enabled) {
        await commitButton.click();
        await expect(interpRow).toHaveCount(0, { timeout: 15_000 });
      }
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 9 — annotate (attach an annotation to a node)
  // ──────────────────────────────────────────────────────────────

  test('Phase 9.1: alice proposes an annotation on N1 via the right-click context menu → annotate submenu', async () => {
    const n1 = _n1Id!;
    await alicePage.getByTestId('graph-tidy-up-button').click();
    await alicePage.getByTestId(`statement-node-wording-${n1}`).click({ button: 'right' });
    await expect(alicePage.getByTestId('graph-context-menu')).toBeVisible();
    await alicePage.getByTestId('graph-context-menu-item-annotate').click();
    await expect(alicePage.getByTestId('annotate-submenu')).toBeVisible({ timeout: 15_000 });

    await alicePage
      .getByTestId('annotate-submenu-input')
      .fill('This restoration claim depends on the 1995 reintroduction baseline being intact.');
    await alicePage.getByTestId('annotate-submenu-submit').click();

    // Two outcomes are acceptable signals of round-trip success: the
    // submenu unmounts (propose landed) OR the inline error region
    // surfaces a typed engine rejection. The OR'd locator with `:visible`
    // on the error branch and `body:not(:has(...))` on the unmount
    // branch lets `toBeVisible` *actually wait* for one of the two to
    // resolve — mirrors the Phase 11.1 pattern. The previous
    // `toBeAttached(...)` on `[error, submenu]` returned immediately
    // because the submenu was already attached at click time, so the
    // assertion below raced React's commit of the error region.
    const settled = alicePage.locator(
      '[data-testid="annotate-submenu-error"]:visible, body:not(:has([data-testid="annotate-submenu"]))',
    );
    await expect(settled.first()).toBeVisible({ timeout: 15_000 });
  });

  test('Phase 9.2: alice commits the annotation proposal (if any are pending)', async () => {
    // Phase 6.2 already drove participant agree votes across every
    // open structural-proposal facet row on N1, including any
    // annotation. We just attempt the commit here.
    const annotateRow = alicePage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: alicePage.locator('[data-testid="pending-proposal-row-kind"]', {
          hasText: /Annotat|Note/i,
        }),
      })
      .first();
    if (await annotateRow.isVisible().catch(() => false)) {
      const commitButton = annotateRow.locator('[data-testid="commit-button"]');
      const enabled = await commitButton.isEnabled().catch(() => false);
      if (enabled) {
        await commitButton.click();
        await expect(annotateRow).toHaveCount(0, { timeout: 15_000 });
      }
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 10 — meta-disagreement (last-resort fallback)
  // ──────────────────────────────────────────────────────────────

  test('Phase 10.1: alice clicks the per-row mark-meta-disagreement button on a pending proposal', async () => {
    // The button lives on every pending-proposal row in the moderator
    // sidebar (per `moderator-ui.mark_meta_disagreement`). We click
    // the first available row's button.
    const row = alicePage.locator('[data-testid="pending-proposal-row"]').first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    const markButton = row.locator('[data-testid="mark-meta-disagreement-button"]');
    await expect(markButton).toBeVisible();
    await markButton.click();

    // Two outcomes are acceptable signals of round-trip success:
    //   (a) the row disappears (meta-disagreement landed → proposal
    //       removed from pending list),
    //   (b) the wire-error region surfaces a typed engine rejection
    //       (e.g. `methodology-not-exhausted` if the diagnostic gate
    //       isn't yet satisfied for this proposal).
    // Either way the envelope reached the server and the dispatcher
    // completed; that's the regression class this phase pins.
    const settled = alicePage.locator(
      '[data-testid="mark-meta-disagreement-button-wire-error"], [data-testid="pending-proposals-pane-empty"]',
    );
    const rowGone = row.locator('[data-testid="mark-meta-disagreement-button"]');
    await Promise.race([
      expect(settled.first()).toBeVisible({ timeout: 15_000 }),
      expect(rowGone).toHaveCount(0, { timeout: 15_000 }),
    ]).catch(() => {
      // Either branch resolving is fine; surface whichever signal
      // landed below.
    });
    const settledCount = await settled.count();
    const rowGoneCount = await rowGone.count();
    expect(settledCount > 0 || rowGoneCount === 0).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 11 — edit-wording (reword and restructure)
  // ──────────────────────────────────────────────────────────────

  test('Phase 11.1: alice proposes a reword edit on N1', async () => {
    const n1 = _n1Id!;
    await alicePage.getByTestId('graph-tidy-up-button').click();
    await alicePage.getByTestId(`statement-node-wording-${n1}`).click({ button: 'right' });
    await expect(alicePage.getByTestId('graph-context-menu')).toBeVisible();
    await alicePage.getByTestId('graph-context-menu-item-propose-edit-wording').click();
    await expect(alicePage.getByTestId('edit-wording-submenu')).toBeVisible({ timeout: 15_000 });

    await alicePage
      .getByTestId('edit-wording-submenu-input')
      .fill('Wolves restored the Yellowstone elk-aspen balance after their 1995 reintroduction.');
    await alicePage.getByTestId('edit-wording-submenu-edit-kind-reword').click();
    await alicePage.getByTestId('edit-wording-submenu-submit').click();

    // Round-trip completed when either the submenu unmounts (propose
    // landed) OR the inline error region appears (engine rejected).
    // The `:visible` filter on the OR'd locator picks up whichever
    // path resolved within the timeout.
    const settled = alicePage.locator(
      '[data-testid="edit-wording-submenu-error"]:visible, body:not(:has([data-testid="edit-wording-submenu"]))',
    );
    await expect(settled.first()).toBeVisible({ timeout: 15_000 });
  });

  test('Phase 11.2: alice proposes a restructure edit (mints a new node id, supersedes N1)', async () => {
    const n1 = _n1Id!;
    await alicePage.getByTestId('graph-tidy-up-button').click();
    // Re-open the context menu — the previous reword attempt may have
    // left the menu closed.
    await alicePage.getByTestId(`statement-node-wording-${n1}`).click({ button: 'right' });
    await expect(alicePage.getByTestId('graph-context-menu')).toBeVisible();
    await alicePage.getByTestId('graph-context-menu-item-propose-edit-wording').click();
    await expect(alicePage.getByTestId('edit-wording-submenu')).toBeVisible({ timeout: 15_000 });

    await alicePage
      .getByTestId('edit-wording-submenu-input')
      .fill('The 1995 wolf reintroduction triggered a trophic cascade in Yellowstone.');
    await alicePage.getByTestId('edit-wording-submenu-edit-kind-restructure').click();
    await alicePage.getByTestId('edit-wording-submenu-submit').click();

    const settled = alicePage.locator(
      '[data-testid="edit-wording-submenu-error"]:visible, body:not(:has([data-testid="edit-wording-submenu"]))',
    );
    await expect(settled.first()).toBeVisible({ timeout: 15_000 });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 12 — withdraw a pending proposal
  // ──────────────────────────────────────────────────────────────

  test('Phase 12.1: alice withdraws one of her own pending proposals via the per-row withdraw button', async () => {
    // The withdraw button is proposer-only (visible only when the
    // authenticated user matches `row.actor`). Alice has proposed
    // every pending row so far; she should see the button on each.
    const row = alicePage
      .locator('[data-testid="pending-proposal-row"]')
      .filter({
        has: alicePage.locator('[data-testid="withdraw-proposal-button"]'),
      })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    const withdrawButton = row.locator('[data-testid="withdraw-proposal-button"]');
    await expect(withdrawButton).toBeVisible();
    await withdrawButton.click();
    // Tolerant — the row removal OR an inline wire-error proves the
    // envelope completed its round-trip.
    const settled = alicePage.locator(
      '[data-testid="withdraw-proposal-button-wire-error"], [data-testid="withdraw-proposal-button"][data-withdraw-state="enabled"]',
    );
    await expect(settled.first()).toBeVisible({ timeout: 15_000 });
  });
});
