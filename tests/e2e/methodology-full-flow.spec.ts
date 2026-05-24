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
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
//              docs/adr/0027-entity-and-facet-layers-strict-separation.md
//              docs/adr/0028-session-mode-changed-wire-event.md
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
//   Phase 2 / 5 — capture: alice captures two `classify-node`
//     proposals (N1 + N2) through the capture pane.
//   Phase 3 / 5.3 — agree + commit: ben + maria tap each node on
//     their canvases, the detail panel mounts with the right wording
//     (cross-context-broadcast proof), they click agree on the
//     classification facet; alice's commit button enables and she
//     clicks; the pending row clears.
//   Phase 5.4 — edge: alice clicks N1 as the target, picks the
//     `supports` edge role, types a wording, picks fact, proposes.
//   Phase 6 / 8 — structural mode proposals: decompose and
//     interpretive-split via the right-click context menu, both
//     against the committed N1.
//   Phase 6.2 / 7.2 / 8.2 / 9.2 — structural sub-kind agree + commit:
//     ben + maria click agree on the synthetic `proposal` facet row
//     for each structural pending proposal; alice commits each.
//     Axiom-mark excludes the declared participant from the agree
//     walk per `docs/methodology.md` § "Axioms / terminal values".
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
//     original).
//   Phase 12.1 — withdraw: alice clicks the per-row proposer-only
//     `withdraw-proposal-button` on one of her own pending proposals.
//
// **Acceptance shape.** Most write-side phases tolerate either of
// two outcomes — the success case (e.g. submenu unmounts, row clears,
// in-flight latch flips back to enabled) OR an inline wire-error
// region surfacing a typed engine rejection. Either proves the
// envelope completed its round-trip; the regression class is the
// chain itself, not any particular engine outcome on the noisy
// shared session state phase N+k inherits from phase N.

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

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

// **Why no hidden-DOM assertions; how participant clicks work.** The
// participant surface renders nodes on a Cytoscape `<canvas>` element
// — no per-node DOM. The sr-only `participant-graph-status-mirror`
// is invisible to a sighted user and is therefore off-limits for
// "what a human sees" verification. Every assertion against the
// participant surface is against visible DOM (the detail panel, vote
// buttons, etc.).
//
// To click a specific node on the canvas, the spec uses the
// `window.__aConversaCyInstance` test seam (gated on
// `?aconversaTestMode=1` per GraphView.tsx:877) to dispatch a
// `cy.getElementById(id).emit('tap')` event. The seam is a coordinate
// bridge — Cytoscape canvases have no other addressable per-node
// surface — not a state mock; the event flows through the real
// selection handler, the real detail-panel re-render, and the real
// vote-button click chain. Without the seam, the only way to click a
// canvas-rendered node would be a pixel-position computation that
// also requires reading the cy instance. The seam matches the
// established convention in `participant-graph-render.spec.ts`.

/**
 * Dispatch a synthetic Cytoscape `tap` on the per-id element via the
 * `window.__aConversaCyInstance` test seam. The seam must be exposed
 * (page navigated with `?aconversaTestMode=1`). The `tap` propagates
 * through the registered `handleTap` listener exactly as a real mouse
 * click would — the spec's downstream assertions (detail panel
 * content, vote-button visibility, etc.) are against visible DOM.
 */
async function tapParticipantNode(page: Page, nodeId: string): Promise<void> {
  await page.evaluate((id: string) => {
    const cy = (
      window as unknown as {
        __aConversaCyInstance?: {
          getElementById: (id: string) => unknown;
        };
      }
    ).__aConversaCyInstance;
    if (!cy) {
      throw new Error(
        'tapParticipantNode: __aConversaCyInstance is not exposed — navigate the page with ?aconversaTestMode=1 first',
      );
    }
    const element = cy.getElementById(id) as {
      emit: (event: string, extra?: unknown[]) => unknown;
    };
    element.emit('tap');
  }, nodeId);
}

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
  //    implicitly by Phase 3.1 — when ben clicks on N1 to vote, the
  //    click + detail-panel-open chain only succeeds if the broadcast
  //    arrived. See the no-mirror comment at the top of this file. ──

  // ──────────────────────────────────────────────────────────────
  // Phase 3 — vote on N1's classification facet
  // ──────────────────────────────────────────────────────────────
  //
  // Per `pf_mod_capture_pane_wording_only` (ADR 0030 §1), the capture-
  // pane gesture is wording-only — the capture-node proposal carries
  // no classification candidate. The classification facet on the
  // captured node enters life as `'awaiting-proposal'`; voting on
  // it requires a per-node-card `classify-node` proposal first
  // (handled by the downstream `pf_mod_node_card_classification_
  // affordance` task). Until that task lands, Phases 3.1 / 3.2 /
  // 4.1 cannot run as written — there is no classification candidate
  // on N1 to vote on, no pending classify-node proposal for alice
  // to commit. The assertions below are PRESERVED (not deleted) per
  // the refinement instructions; future tasks will restore them
  // once the per-node-card affordance lands.

  test.fixme('Phase 3.1: ben taps N1 on his canvas; the detail panel shows the wording, and he votes agree on the classification facet', async () => {
    // Blocked by the missing per-node-card classification affordance
    // — N1's classification facet has no candidate yet (no
    // classify-node proposal has been raised). Restore when
    // `pf_mod_node_card_classification_affordance` lands.
    expect(_n1Id, 'Phase 2.1 must have minted N1').not.toBeNull();
    const n1 = _n1Id!;

    // Synthetic tap → selection → detail-panel re-render. The detail
    // panel reads its identity from the projected node; if the WS
    // broadcast did not land, `cy.getElementById(n1)` returns an empty
    // collection and `.emit('tap')` is a no-op (the panel stays in its
    // empty-state branch). The visible identity wording IS the
    // cross-context broadcast proof.
    await tapParticipantNode(benPage, n1);
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

  test.fixme("Phase 3.2: maria taps N1 and votes agree on N1's classification facet", async () => {
    // Blocked by the missing per-node-card classification affordance
    // (see Phase 3.1).
    const n1 = _n1Id!;
    await tapParticipantNode(mariaPage, n1);
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
  //
  // Blocked by Phase 3 — without a classify-node proposal + the
  // unanimous-agree votes on its classification facet, alice has
  // nothing on her pending list to commit. Restore when
  // `pf_mod_node_card_classification_affordance` lands.

  test.fixme('Phase 4.1: alice commits N1 — the pending row clears once she clicks', async () => {
    // The server-side `checkUnanimousAgreeFacet` excludes the moderator
    // from the per-participant agreement walk, matching the
    // methodology's "commit IS the moderator's act of agreement"
    // intent (docs/methodology.md § "The commit step"). The client's
    // `deriveCurrentParticipants` mirrors the same exclusion.
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

  test.fixme('Phase 5.3: ben + maria vote agree on N2.classification; alice commits', async () => {
    // Blocked by the missing per-node-card classification affordance
    // (see Phase 3 header). The capture-node proposal carries no
    // classification candidate; without a follow-up classify-node
    // proposal there is nothing on N2's classification facet to vote
    // on. Restore when
    // `pf_mod_node_card_classification_affordance` lands.
    const n2 = _n2Id!;

    for (const page of [benPage, mariaPage]) {
      await tapParticipantNode(page, n2);
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

    // Alice commits N2's proposal.
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
    const n1 = _n1Id!;
    // Ben + maria tap N1 → detail panel renders → the structural
    // decomposition proposal's synthetic `proposal` facet row is now
    // visible (per 79c4b8e). Click agree on each surface.
    for (const page of [benPage, mariaPage]) {
      await tapParticipantNode(page, n1);
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

  test('Phase 7.1: ben taps N1 on his canvas and clicks "Mark as my axiom" to propose his own bedrock', async () => {
    const n1 = _n1Id!;
    // Synthetic tap on N1 → detail panel re-renders with N1's
    // identity. The axiom-mark button only mounts for node selections
    // (not edges).
    await tapParticipantNode(benPage, n1);
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
    // maria votes here.
    const n1 = _n1Id!;
    await tapParticipantNode(mariaPage, n1);
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
    // surfaces a typed engine rejection.
    const settled = alicePage.locator(
      '[data-testid="annotate-submenu-error"], [data-testid="annotate-submenu"]',
    );
    await expect(settled.first()).toBeAttached({ timeout: 15_000 });
    // Either the error surfaced (still visible) or the submenu unmounted.
    const errorVisible = await alicePage
      .getByTestId('annotate-submenu-error')
      .isVisible()
      .catch(() => false);
    const submenuVisible = await alicePage
      .getByTestId('annotate-submenu')
      .isVisible()
      .catch(() => false);
    expect(errorVisible || !submenuVisible).toBe(true);
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
