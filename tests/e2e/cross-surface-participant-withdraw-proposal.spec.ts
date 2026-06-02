// Cross-surface 3-context spec for the participant withdraw-proposal
// gesture + the participant read-surface projector cleanup.
//
// Refinement: tasks/refinements/participant-ui/part_withdraw_proposal_gesture.md
//   (§A4 — two blocks; pays down the cross-surface 3-context debt that
//    `mod_withdraw_proposal_gesture` §D5 deferred because there was no
//    participant-side withdraw affordance to drive it.)
// Refinement: tasks/refinements/participant-ui/part_withdraw_proposal_overlay_removal.md
//   (§A2 — extends Block 1 with the deferred self-withdraw cross-surface
//    convergence, now reachable via the zero-emission `proposal-withdrawn`
//    terminator (ADR 0037).)
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
//
// **Two blocks (§A4).**
//
// - **Block 1 — proposer-only affordance + accepted withdraw round-trip.**
//   The moderator captures a node (so a real server-known node exists on
//   every surface); debater-A marks it as axiom from the tablet
//   (`useAxiomMarkAction`). The axiom-mark proposal row appears in the
//   pending pane on all three surfaces. The proposer-only withdraw button
//   shows ONLY on debater-A's tablet (absent on debater-B's tablet; the
//   moderator console's proposer-only guard hides it on the axiom-mark
//   row since the moderator is not its actor). Debater-A clicks withdraw →
//   the `proposal-withdrawn` ack lands cleanly (the wire-error region
//   stays empty). Because axiom-mark is a ZERO-EMISSION proposal the
//   server appends the `proposal-withdrawn` terminator (ADR 0037) rather
//   than a structural event; off that event on the immutable log the
//   pending row converges to count 0 on all three surfaces (debater-A,
//   debater-B, moderator) — the §A4 deferred sub-scenario, now paid here
//   (`part_withdraw_proposal_overlay_removal` §A2). The pending axiom-mark
//   never decorated the canvas (the badge is commit-gated, §D1), pinned by
//   a `data-is-axiom="false"` sanity check.
//
// - **Block 2 — observe-the-withdrawal-land (projector cleanup).** The
//   moderator captures a node; both debaters observe it on their canvas
//   (`participant-node-status[data-node-id]`) AND in the pending pane
//   (`participant-pending-proposal-row`). The moderator withdraws it
//   (existing `withdraw-proposal-button`); both debaters observe the node
//   leave their canvas (count → 0) AND the pending row vanish (count → 0).
//   This pins the participant `projectGraph` + `derivePendingProposals`
//   `entity-removed` cleanup across surfaces — the fully-observable
//   direction the moderator (who CAN mint a structural entity) makes
//   reachable (§D5).
//
// **Pair claim.** Distinct dev-user triples per block so the two tests in
// this file (same worker, serial) never collide on the per-session
// users-upsert (`tests/e2e/fixtures/dev-users.ts`): Block 1 uses
// alice/ben/maria; Block 2 uses dave/erin/frank.

import { expect, test, type Browser, type Page } from './fixtures/no-scrollbars';

import { authedContext } from './fixtures/authed-context';

const TOPIC = 'Should the carbon levy be repealed? (cross-surface participant withdraw)';

/**
 * Create a public session via the same-origin API (mirrors
 * `cross-surface-lobby-start.spec.ts`). Public so the non-host debaters
 * can self-claim their slots. Caller MUST already be authenticated.
 */
async function createSession(page: Page): Promise<string> {
  const response = await page.request.post('/api/sessions', {
    data: { topic: TOPIC, privacy: 'public' },
  });
  expect(response.status(), 'createSession: POST /api/sessions must return 201').toBe(201);
  const body = (await response.json()) as { id: string };
  expect(body.id, 'createSession: response body must carry a string id').toBeTruthy();
  return body.id;
}

interface Surfaces {
  readonly sessionId: string;
  readonly moderatorPage: Page;
  readonly debaterAPage: Page;
  readonly debaterBPage: Page;
  /** Close every context — call in the test's `finally`. */
  readonly teardown: () => Promise<void>;
}

/**
 * Drive the three real browser contexts through the lobby → operate
 * handoff (the proven `cross-surface-lobby-start.spec.ts` flow): the
 * moderator creates + enters the session; both debaters claim their
 * slots and auto-handoff to the operate route when the moderator clicks
 * Enter. Returns the three pages ready on the operate surface.
 */
async function reachOperate(
  browser: Browser,
  users: { moderator: string; debaterA: string; debaterB: string },
): Promise<Surfaces> {
  const moderatorContext = await authedContext(browser, users.moderator);
  const moderatorPage = await moderatorContext.newPage();
  const debaterAContext = await authedContext(browser, users.debaterA);
  const debaterAPage = await debaterAContext.newPage();
  const debaterBContext = await authedContext(browser, users.debaterB);
  const debaterBPage = await debaterBContext.newPage();

  const teardown = async (): Promise<void> => {
    await debaterBContext.close();
    await debaterAContext.close();
    await moderatorContext.close();
  };

  const sessionId = await createSession(moderatorPage);

  // Moderator lands on the invite/lobby view; the Enter gate is closed.
  await moderatorPage.goto(`/m/sessions/${sessionId}/invite`);
  await expect(moderatorPage.getByTestId('route-invite-participants')).toBeVisible({
    timeout: 15_000,
  });
  const enterButton = moderatorPage.getByTestId('invite-enter-session');
  await expect(enterButton).toBeDisabled();

  // Debater-A claims slot A.
  await debaterAPage.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
  await expect(debaterAPage.getByTestId('route-invite-acceptance')).toBeVisible({
    timeout: 15_000,
  });
  await debaterAPage.getByTestId('invite-acceptance-join-button').click();
  await debaterAPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
    timeout: 15_000,
  });

  // Debater-B claims slot B.
  await debaterBPage.goto(`/p/sessions/${sessionId}/invite?role=debater-B`);
  await expect(debaterBPage.getByTestId('route-invite-acceptance')).toBeVisible({
    timeout: 15_000,
  });
  await debaterBPage.getByTestId('invite-acceptance-join-button').click();
  await debaterBPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
    timeout: 15_000,
  });

  // The moderator's lobby observes both debaters arrive via live WS; the
  // gate opens. Click Enter → operate canvas.
  await expect(enterButton).toBeEnabled({ timeout: 15_000 });
  await enterButton.click();
  await moderatorPage.waitForURL((url) => url.pathname === `/m/sessions/${sessionId}/operate`, {
    timeout: 15_000,
  });
  await expect(moderatorPage.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });

  // Both debaters auto-handoff to the operate route per the
  // `session-mode-changed` broadcast.
  await debaterAPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
    timeout: 15_000,
  });
  await debaterBPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
    timeout: 15_000,
  });
  await expect(debaterAPage.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
  await expect(debaterBPage.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });

  return { sessionId, moderatorPage, debaterAPage, debaterBPage, teardown };
}

/**
 * Moderator capture-node gesture (the proven `capture-text-input-textarea`
 * flow from `moderator-proposed-entity-canvas-visibility.spec.ts`). The
 * capture emits `node-created` + `entity-included` at propose-time so the
 * proposed node renders on every surface; returns the server-minted node
 * id read off the moderator canvas testid.
 */
async function captureNode(moderatorPage: Page, wording: string): Promise<string> {
  const textarea = moderatorPage.getByTestId('capture-text-input-textarea');
  await textarea.fill(wording);
  const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
  await textarea.press(submitKey);
  const nodes = moderatorPage.getByTestId(/^statement-node-[0-9a-f-]+$/);
  await expect(nodes).toHaveCount(1, { timeout: 15_000 });
  const testid = await nodes.first().getAttribute('data-testid');
  expect(testid, 'captureNode: node testid must be present').toBeTruthy();
  return testid!.replace(/^statement-node-/, '');
}

test.describe('Cross-surface participant withdraw-proposal (three real browser contexts)', () => {
  test('Block 1 — debater-A axiom-marks a node; the proposer-only withdraw button shows only on debater-A; the self-withdraw converges the pending row on every surface', async ({
    browser,
  }) => {
    const s = await reachOperate(browser, {
      moderator: 'alice',
      debaterA: 'ben',
      debaterB: 'maria',
    });
    try {
      const { sessionId, moderatorPage, debaterAPage, debaterBPage } = s;

      // The moderator captures a node so a real, server-known node exists
      // on every surface for debater-A to axiom-mark.
      const nodeId = await captureNode(
        moderatorPage,
        'Carbon pricing is the most cost-effective decarbonisation lever.',
      );

      // Debater-A re-navigates with the test-mode flag so `<GraphView>`
      // exposes the live Cytoscape core on `window.__aConversaCyInstance`
      // (the synthetic-tap seam, same as `participant-axiom-mark.spec.ts`).
      await debaterAPage.goto(`/p/sessions/${sessionId}?aconversaTestMode=1`);
      await expect(debaterAPage.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
      await expect(debaterAPage.getByTestId('participant-graph-root')).toBeVisible({
        timeout: 15_000,
      });
      // The captured node propagates to debater-A's canvas (DOM mirror).
      await expect(
        debaterAPage.locator(`[data-testid="participant-node-status"][data-node-id="${nodeId}"]`),
      ).toHaveCount(1, { timeout: 15_000 });

      // Tap the node via the cy seam so the detail panel selects it.
      await debaterAPage.evaluate((id: string) => {
        const cy = (
          window as unknown as {
            __aConversaCyInstance?: {
              getElementById: (nid: string) => { emit: (event: string) => unknown };
            };
          }
        ).__aConversaCyInstance;
        if (!cy) throw new Error('__aConversaCyInstance is not exposed on window');
        cy.getElementById(id).emit('tap');
      }, nodeId);
      const panel = debaterAPage.getByTestId('participant-detail-panel');
      await expect(panel).toHaveAttribute('data-entity-id', nodeId, { timeout: 15_000 });

      // Click the axiom-mark button → the real `propose` (axiom-mark) wire
      // round-trip. No axiom-mark wire-error must surface.
      const axiomBtn = debaterAPage.locator(
        `[data-testid="participant-axiom-mark-button"][data-node-id="${nodeId}"]`,
      );
      await expect(axiomBtn).toBeVisible({ timeout: 15_000 });
      await axiomBtn.click();
      await expect(
        debaterAPage.locator(
          `[data-testid="participant-axiom-mark-button-wire-error"][data-node-id="${nodeId}"]`,
        ),
      ).toHaveCount(0, { timeout: 15_000 });

      // Read the axiom-mark proposal's envelope id off debater-A's WS
      // store — it equals the pending row's `data-proposal-id`.
      const axiomProposalId = await readAxiomProposalId(debaterAPage, sessionId, nodeId);
      if (axiomProposalId === null) {
        throw new Error('Block 1: axiom-mark proposal envelope id must be present on the store');
      }

      // Debater-A switches to the Proposals tab: the axiom-mark row shows
      // the proposer-only withdraw button — and it is the ONLY withdraw
      // button on debater-A's pane (the moderator's capture-node row is
      // authored by the moderator, so its button is hidden for debater-A).
      await debaterAPage.getByTestId('participant-proposals-tabbar-proposals').click();
      const aAxiomRow = debaterAPage.locator(
        `[data-testid="participant-pending-proposal-row"][data-proposal-id="${axiomProposalId}"]`,
      );
      await expect(aAxiomRow).toHaveCount(1, { timeout: 15_000 });
      const aWithdrawButtons = debaterAPage.getByTestId('participant-withdraw-proposal-button');
      await expect(aWithdrawButtons).toHaveCount(1, { timeout: 15_000 });
      await expect(aWithdrawButtons.first()).toHaveAttribute('data-proposal-id', axiomProposalId);

      // Debater-B switches to the Proposals tab: the axiom-mark row is
      // present (cross-surface broadcast) but carries NO withdraw button
      // (debater-B is not the proposer).
      await debaterBPage.getByTestId('participant-proposals-tabbar-proposals').click();
      await expect(
        debaterBPage.locator(
          `[data-testid="participant-pending-proposal-row"][data-proposal-id="${axiomProposalId}"]`,
        ),
      ).toHaveCount(1, { timeout: 15_000 });
      await expect(debaterBPage.getByTestId('participant-withdraw-proposal-button')).toHaveCount(
        0,
        { timeout: 15_000 },
      );

      // The moderator console's proposer-only guard also hides the withdraw
      // button on the axiom-mark row (the moderator is not its actor).
      const modAxiomRow = moderatorPage.locator(
        `[data-testid="pending-proposal-row"][data-proposal-id="${axiomProposalId}"]`,
      );
      await expect(modAxiomRow).toHaveCount(1, { timeout: 15_000 });
      await expect(modAxiomRow.getByTestId('withdraw-proposal-button')).toHaveCount(0, {
        timeout: 15_000,
      });

      // Debater-A clicks withdraw → the `proposal-withdrawn` ack lands
      // cleanly (empty wire-error region).
      await aWithdrawButtons.first().click();
      await expect(
        debaterAPage.getByTestId('participant-withdraw-proposal-button-wire-error'),
      ).toHaveCount(0, { timeout: 15_000 });

      // §A2 — the deferred §A4 cross-surface convergence, now reachable via
      // the zero-emission `proposal-withdrawn` terminator (ADR 0037). Off the
      // new event on the immutable log the pending axiom-mark row vanishes on
      // every surface: debater-A's own tablet, debater-B's tablet, and the
      // moderator console. This is the debt-paying check.
      await expect(aAxiomRow).toHaveCount(0, { timeout: 15_000 });
      await expect(
        debaterBPage.locator(
          `[data-testid="participant-pending-proposal-row"][data-proposal-id="${axiomProposalId}"]`,
        ),
      ).toHaveCount(0, { timeout: 15_000 });
      await expect(modAxiomRow).toHaveCount(0, { timeout: 15_000 });

      // Commit-gating sanity (§D1): the participant canvas never decorated the
      // *pending* axiom-mark, since the badge is commit-gated and the mark was
      // never committed. Switch debater-A back to the graph mirror; the
      // (still-present, moderator-captured) node carries no axiom badge.
      await debaterAPage.getByTestId('participant-proposals-tabbar-graph').click();
      await expect(
        debaterAPage.locator(`[data-testid="participant-node-status"][data-node-id="${nodeId}"]`),
      ).toHaveAttribute('data-is-axiom', 'false', { timeout: 15_000 });
    } finally {
      await s.teardown();
    }
  });

  test('Block 2 — moderator withdraws a captured node; both debaters observe it leave their canvas and pending pane', async ({
    browser,
  }) => {
    const s = await reachOperate(browser, {
      moderator: 'dave',
      debaterA: 'erin',
      debaterB: 'frank',
    });
    try {
      const { moderatorPage, debaterAPage, debaterBPage } = s;

      // The moderator captures a node — a structural entity that a
      // withdraw CAN retract (unlike the zero-emission axiom-mark), making
      // the cross-surface disappearance fully observable.
      const nodeId = await captureNode(
        moderatorPage,
        'A border carbon adjustment is required to prevent leakage.',
      );

      // Both debaters observe the proposed node on their canvas (the DOM
      // mirror the participant `projectGraph` emits per node).
      for (const page of [debaterAPage, debaterBPage]) {
        await expect(
          page.locator(`[data-testid="participant-node-status"][data-node-id="${nodeId}"]`),
        ).toHaveCount(1, { timeout: 15_000 });
      }

      // Both debaters switch to the Proposals tab and observe the pending
      // row for the capture-node proposal.
      for (const page of [debaterAPage, debaterBPage]) {
        await page.getByTestId('participant-proposals-tabbar-proposals').click();
        await expect(page.getByTestId('participant-pending-proposal-row')).toHaveCount(1, {
          timeout: 15_000,
        });
      }

      // The moderator withdraws its own capture-node proposal. The server
      // emits one `entity-removed(node)` and acks `proposal-withdrawn`
      // cleanly; the moderator's own canvas node + pending row clear.
      const modRow = moderatorPage.getByTestId('pending-proposal-row');
      await expect(modRow).toHaveCount(1, { timeout: 15_000 });
      const modWithdraw = modRow.first().getByTestId('withdraw-proposal-button');
      await expect(modWithdraw).toBeVisible({ timeout: 15_000 });
      await modWithdraw.click();
      await expect(modRow.first().getByTestId('withdraw-proposal-button-wire-error')).toHaveCount(
        0,
        { timeout: 15_000 },
      );
      await expect(moderatorPage.getByTestId(/^statement-node-[0-9a-f-]+$/)).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(moderatorPage.getByTestId('pending-proposal-row')).toHaveCount(0, {
        timeout: 15_000,
      });

      // Both debaters observe the withdrawal land: the pending row vanishes
      // (`derivePendingProposals` honours `entity-removed`) …
      for (const page of [debaterAPage, debaterBPage]) {
        await expect(page.getByTestId('participant-pending-proposal-row')).toHaveCount(0, {
          timeout: 15_000,
        });
      }
      // … and the node leaves their canvas (`projectGraph` honours
      // `entity-removed`). Switch back to the Graph tab to read the mirror.
      for (const page of [debaterAPage, debaterBPage]) {
        await page.getByTestId('participant-proposals-tabbar-graph').click();
        await expect(
          page.locator(`[data-testid="participant-node-status"][data-node-id="${nodeId}"]`),
        ).toHaveCount(0, { timeout: 15_000 });
      }
    } finally {
      await s.teardown();
    }
  });
});

/**
 * Poll debater-A's `__aConversaWsStore` for the axiom-mark proposal
 * envelope minted by the button click, and return its envelope `id` (the
 * pending row's `data-proposal-id`). Mirrors the events-stream read in
 * `participant-axiom-mark.spec.ts`.
 */
async function readAxiomProposalId(
  page: Page,
  sessionId: string,
  nodeId: string,
): Promise<string | null> {
  await expect
    .poll(
      async () =>
        page.evaluate(
          ({ sid, nid }: { sid: string; nid: string }) => {
            const store = (
              window as unknown as {
                __aConversaWsStore?: {
                  getState: () => {
                    sessionState: Record<
                      string,
                      {
                        events: {
                          id: string;
                          kind: string;
                          payload: { proposal?: { kind: string; node_id?: string } };
                        }[];
                      }
                    >;
                  };
                };
              }
            ).__aConversaWsStore;
            if (!store) return false;
            const session = store.getState().sessionState[sid];
            if (!session) return false;
            return session.events.some(
              (event) =>
                event.kind === 'proposal' &&
                event.payload?.proposal?.kind === 'axiom-mark' &&
                event.payload?.proposal?.node_id === nid,
            );
          },
          { sid: sessionId, nid: nodeId },
        ),
      { timeout: 15_000 },
    )
    .toBe(true);

  return page.evaluate(
    ({ sid, nid }: { sid: string; nid: string }) => {
      const store = (
        window as unknown as {
          __aConversaWsStore?: {
            getState: () => {
              sessionState: Record<
                string,
                {
                  events: {
                    id: string;
                    kind: string;
                    payload: { proposal?: { kind: string; node_id?: string } };
                  }[];
                }
              >;
            };
          };
        }
      ).__aConversaWsStore;
      if (!store) return null;
      const session = store.getState().sessionState[sid];
      if (!session) return null;
      const proposal = session.events.find(
        (event) =>
          event.kind === 'proposal' &&
          event.payload?.proposal?.kind === 'axiom-mark' &&
          event.payload?.proposal?.node_id === nid,
      );
      return proposal?.id ?? null;
    },
    { sid: sessionId, nid: nodeId },
  );
}
