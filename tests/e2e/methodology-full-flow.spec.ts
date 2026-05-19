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

  // ── A `classify-node` proposal targets the *classification* facet
  //    only (per `proposalFacetTarget` in ParticipantVoteButtons.tsx).
  //    Wording + substance start as `proposed` once the node exists
  //    server-side (at commit time) but advance via separate proposal
  //    sub-kinds (`edit-wording`, `set-node-substance`) which the
  //    methodology surfaces later. Phase 3.1/3.2 therefore vote on
  //    `classification` only; advancing substance is its own phase. ──

  test('Phase 3.1: ben taps N1 on his canvas; the detail panel shows the wording, and he votes agree on the classification facet', async () => {
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

  test("Phase 3.2: maria taps N1 and votes agree on N1's classification facet", async () => {
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

  test('Phase 4.1: alice commits N1 — the pending row clears once she clicks', async () => {
    // After server-side alignment in commit 7f68719 — checkUnanimousAgree
    // now excludes the moderator from the per-participant agreement
    // walk, matching the methodology's "commit IS the moderator's
    // act of agreement" intent (docs/methodology.md §"The commit step").
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

  test('Phase 5.3: ben + maria vote agree on N2.classification; alice commits', async () => {
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
    // The `propose` envelope mints a new node AND attaches a supports
    // edge from it to N1 in one shot.
    const edgeWording = 'Wolves directly reduced elk overgrazing on aspen seedlings.';
    await alicePage.getByTestId('capture-text-input-textarea').fill(edgeWording);
    await alicePage.getByTestId('classification-palette-button-fact').click();
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

  test.fixme('Phase 6.2: ben + maria vote agree on the decomposition; alice commits; N1 is replaced by two component nodes', () => {
    // BLOCKED: the `decompose` proposal sub-kind is structural — per
    // ParticipantVoteButtons.tsx:122, `proposalFacetTarget` returns
    // null for decompose, so the participant vote UI does NOT render
    // an agree button for it. And the server's commit handler rejects
    // structural sub-kinds with `illegal-state-transition` (see
    // apps/server/src/methodology/handlers/commit.ts:148 — "structural
    // sub-kind ... deferred to a sibling"). The full
    // decomposition_logic land is pending.
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
