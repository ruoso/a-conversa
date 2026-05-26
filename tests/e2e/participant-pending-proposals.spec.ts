// End-to-end spec for the participant operate route's pending-proposals
// tab seam.
//
// Refinement: tasks/refinements/participant-ui/part_proposals_tab.md
//   (Decision §8 — runs under the same participant project that hosts
//    `participant-graph-render.spec.ts`. Pins tab-mount, tab-switch,
//    badge-count derivation, AND both empty-state + non-empty-state
//    branches inside ONE scenario per the refinement's e2e plan.)
// ADRs:    docs/adr/0008-e2e-framework-playwright.md
//          docs/adr/0017-mock-oauth-authelia-users-file.md
//          docs/adr/0022-no-throwaway-verifications.md
//          docs/adr/0026-micro-frontend-root-app.md
//
// The fixture seeds the `__aConversaWsStore` test seam directly (the
// same seam `participant-graph-render.spec.ts` walks) so the WS-
// subscription path stays out of scope: the protocol-boundary
// guarantees are pinned by `ws_proposal_status_broadcast`'s scenarios;
// this spec only pins the UI consumer.

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';

async function createSession(
  page: Page,
  opts: { topic: string; privacy: 'public' | 'private' },
): Promise<string> {
  const response = await page.request.post('/api/sessions', {
    data: { topic: opts.topic, privacy: opts.privacy },
  });
  expect(response.status(), 'createSession: POST /api/sessions must return 201').toBe(201);
  const body = (await response.json()) as { id: string };
  expect(body.id, 'createSession: response body must carry a string id').toBeTruthy();
  return body.id;
}

async function logoutAndClearAllCookies(page: Page): Promise<void> {
  const response = await page.request.post('/api/auth/logout');
  expect([200, 204], 'logoutAndClearAllCookies: unexpected status').toContain(response.status());
  await page.context().clearCookies();
}

async function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
  });
}

test.describe('Participant operate route — pending-proposals tab seam', () => {
  test('kate creates a session, leo claims debater-A, the tab strip + badge + tab switch + empty / non-empty branches all behave as designed', async ({
    browser,
  }) => {
    // Uses `kate` + `leo` — a fresh pair from the 12-user dev pool
    // expansion (`infra/authelia/users.yml`; see
    // `tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md`)
    // distinct from the blocks already saturating `alice+ben`,
    // `maria+dave`, `frank+erin`, `grace+henry`, `ivan+julia` to avoid
    // racing on the shared user-creation path under
    // `fullyParallel: true`.
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Pending-proposals tab seam reaches the participant tablet';
      const NODE_WORDING = 'A wording to attach a proposal to';

      const kate = await loginAs(page, { username: 'kate' });
      expect(kate.screenName.toLowerCase()).toBe('kate');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      await logoutAndClearAllCookies(page);

      const leo = await loginAs(page, { username: 'leo' });
      expect(leo.screenName.toLowerCase()).toBe('leo');
      await page.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
      await expect(page.getByTestId('route-invite-acceptance')).toBeVisible({ timeout: 15_000 });
      const joinButton = page.getByTestId('invite-acceptance-join-button');
      await expect(joinButton).toBeEnabled();
      await joinButton.click();
      await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });
      await expect(page.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });

      // Navigate directly to the operate route. The operate route's
      // tab strip is the first user-visible affordance this leaf
      // establishes; the spec asserts the empty-state branch first
      // (no pendingProposals seeded yet) and the non-empty branch
      // after a `proposal-status` envelope is applied.
      await page.goto(`/p/sessions/${sessionId}`);
      await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-root')).toBeVisible({ timeout: 15_000 });

      // 1. The tab strip is visible with both buttons; Graph is
      //    active by default; badge data-count is "0".
      const tabbar = page.getByTestId('participant-proposals-tabbar');
      await expect(tabbar).toBeVisible();
      const graphTab = page.getByTestId('participant-proposals-tabbar-graph');
      const proposalsTab = page.getByTestId('participant-proposals-tabbar-proposals');
      await expect(graphTab).toHaveAttribute('data-active', 'true');
      await expect(proposalsTab).toHaveAttribute('data-active', 'false');
      const badge = page.getByTestId('participant-proposals-tabbar-badge');
      await expect(badge).toHaveAttribute('data-count', '0');

      // 2. Click the Proposals tab; the pane appears (empty-state
      //    since no proposals seeded yet) and the graph region is
      //    gone from the DOM (the conditional only mounts one
      //    branch at a time per Decision §4's "instantaneous DOM
      //    swap").
      await proposalsTab.click();
      await expect(proposalsTab).toHaveAttribute('data-active', 'true');
      await expect(graphTab).toHaveAttribute('data-active', 'false');
      await expect(page.getByTestId('participant-pending-proposals-pane')).toBeVisible();
      await expect(page.getByTestId('participant-pending-proposals-pane-empty')).toBeVisible();
      await expect(page.getByTestId('participant-pending-proposals-pane-empty')).toHaveText(
        'No pending proposals',
      );
      await expect(page.locator('[data-testid="route-operate-graph-region"]')).toHaveCount(0);

      // 3. Click Graph; the graph region is back and the pane is gone.
      await graphTab.click();
      await expect(graphTab).toHaveAttribute('data-active', 'true');
      await expect(page.getByTestId('route-operate-graph-region')).toBeVisible();
      await expect(page.locator('[data-testid="participant-pending-proposals-pane"]')).toHaveCount(
        0,
      );

      // 4. Seed a `proposal-status` envelope via the WS store handle
      //    so the badge count + non-empty pane branch can be pinned.
      //    The store's `applyProposalStatus` reducer is the same one
      //    the shell WS-client dispatch path drives in production.
      const PROPOSAL_ID = '11111111-1111-4111-8111-111111111111';
      const FACET_ID = '22222222-2222-4222-8222-222222222222';
      const PROPOSAL_NODE_ID = '66666666-6666-4666-8666-666666666666';
      const PROPOSER_ACTOR_ID = '44444444-4444-4444-8444-444444444444';
      await page.evaluate(
        (seed: {
          sessionId: string;
          proposalId: string;
          facetId: string;
          wording: string;
          proposalNodeId: string;
          actorId: string;
        }) => {
          const store = (
            window as unknown as {
              __aConversaWsStore?: {
                getState: () => {
                  applyProposalStatus: (payload: unknown) => void;
                  applyEvent: (event: unknown) => void;
                };
              };
            }
          ).__aConversaWsStore;
          if (!store) {
            throw new Error('__aConversaWsStore is not exposed on window');
          }
          const state = store.getState();
          // Seed a node so the operate route's projection chain has
          // something coherent to render under the graph tab when the
          // spec flips back to it.
          state.applyEvent({
            id: '33333333-3333-4333-8333-333333333331',
            sessionId: seed.sessionId,
            sequence: 1_000_001,
            kind: 'node-created',
            actor: seed.actorId,
            payload: {
              node_id: '55555555-5555-4555-8555-555555555555',
              wording: seed.wording,
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          // Seed a `proposal` event so the pane's event-log-driven row
          // source surfaces a single row (per `part_proposal_list_view`
          // Decision §2). The envelope id matches `proposalId` so the
          // row's `data-proposal-id` aligns with the broadcast frame's
          // entry — the badge count + the rendered row converge on the
          // same proposal in the steady state.
          state.applyEvent({
            id: seed.proposalId,
            sessionId: seed.sessionId,
            sequence: 1_000_002,
            kind: 'proposal',
            actor: seed.actorId,
            payload: {
              proposal: {
                kind: 'capture-node',
                node_id: seed.proposalNodeId,
                wording: 'A freshly captured wording for the row test',
              },
            },
            createdAt: '2026-05-17T00:00:01.000Z',
          });
          state.applyProposalStatus({
            sessionId: seed.sessionId,
            proposalId: seed.proposalId,
            sequence: 1_000_003,
            perFacetStatus: { [seed.facetId]: 'pending' },
          });
        },
        {
          sessionId,
          proposalId: PROPOSAL_ID,
          facetId: FACET_ID,
          wording: NODE_WORDING,
          proposalNodeId: PROPOSAL_NODE_ID,
          actorId: PROPOSER_ACTOR_ID,
        },
      );

      // 5. The badge reflects the new total; click Proposals; the
      //    non-empty branch surfaces the stable list container
      //    testid (the empty-state is hidden).
      await expect(badge).toHaveAttribute('data-count', '1');
      await proposalsTab.click();
      await expect(page.getByTestId('participant-pending-proposals-pane')).toBeVisible();
      // The non-empty branch surfaces the stable list container; the
      // empty-state is gone. (`part_proposals_tab` predecessor's pin.)
      await expect(page.getByTestId('participant-pending-proposals-pane-list')).toBeAttached();
      await expect(
        page.locator('[data-testid="participant-pending-proposals-pane-empty"]'),
      ).toHaveCount(0);
      // `part_proposal_list_view` extension — the seeded `proposal`
      // event surfaces as one rendered row whose `data-proposal-id`
      // matches the seeded envelope id; the row's cells render the
      // capture-node summary (`node <8-char>`) and the proposer's
      // 8-char author prefix.
      const rows = page.locator('[data-testid="participant-pending-proposal-row"]');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toHaveAttribute('data-proposal-id', PROPOSAL_ID);
      await expect(
        rows.first().locator('[data-testid="participant-pending-proposal-row-summary"]'),
      ).toHaveText(`node ${PROPOSAL_NODE_ID.slice(0, 8)}`);
      await expect(
        rows.first().locator('[data-testid="participant-pending-proposal-row-author"]'),
      ).toHaveText(PROPOSER_ACTOR_ID.slice(0, 8));

      // 6. `part_proposal_expand` extension — tap the row's header
      //    button, assert the disclosure machinery expands the body;
      //    tap again, assert collapse. Single-open accordion semantics
      //    are pinned in Vitest; here we pin the end-to-end gesture +
      //    `data-expanded` / `aria-expanded` attributes + body
      //    visibility under the real compose stack.
      const row = rows.first();
      const header = row.locator('[data-testid="participant-pending-proposal-row-header"]');
      await expect(row).toHaveAttribute('data-expanded', 'false');
      await expect(header).toHaveAttribute('aria-expanded', 'false');
      await expect(
        row.locator('[data-testid="participant-pending-proposal-row-body"]'),
      ).toHaveCount(0);
      await header.click();
      await expect(row).toHaveAttribute('data-expanded', 'true');
      await expect(header).toHaveAttribute('aria-expanded', 'true');
      const body = row.locator('[data-testid="participant-pending-proposal-row-body"]');
      await expect(body).toBeVisible();

      // 7. `part_per_facet_breakdown_in_pane` extension — with the row
      //    expanded from step 6, the body region hosts the per-facet
      //    chip strip (REPLACING the predecessor's `<p data-testid=
      //    "-body-summary">` per Decision §2). The seeded `capture-node`
      //    proposal targets the `wording` facet (per the per-sub-kind
      //    map); no votes have arrived, so the chip status defaults to
      //    `'proposed'`.
      const facets = body.locator('[data-testid="participant-pending-proposal-row-facets"]');
      await expect(facets).toBeVisible();
      await expect(facets).toHaveAttribute('data-proposal-id', PROPOSAL_ID);
      const wordingChip = facets.locator(
        '[data-testid="participant-pending-proposal-row-facet"][data-facet-name="wording"]',
      );
      await expect(wordingChip).toHaveCount(1);
      await expect(wordingChip).toHaveAttribute('data-facet-status', 'proposed');

      // 8. `part_vote_indicators_in_pane` extension — with the row still
      //    expanded from step 6, seed one `vote` envelope from a SECOND
      //    participant (distinct from the logged-in test participant)
      //    targeting the seeded `capture-node` proposal's wording facet,
      //    choice `'agree'`. Poll for the indicator row to appear inside
      //    the chip and assert one `[data-vote-indicator]` dot carrying
      //    the seeded voter's id + choice. The test participant's own
      //    vote does NOT appear (self-filter lives at the projection
      //    layer).
      await expect(row).toHaveAttribute('data-expanded', 'true');
      const SECOND_VOTER_ID = '77777777-7777-4777-8777-777777777777';
      await page.evaluate(
        (seed: { sessionId: string; proposalNodeId: string; voterId: string }) => {
          const store = (
            window as unknown as {
              __aConversaWsStore?: {
                getState: () => {
                  applyEvent: (event: unknown) => void;
                };
              };
            }
          ).__aConversaWsStore;
          if (!store) {
            throw new Error('__aConversaWsStore is not exposed on window');
          }
          const state = store.getState();
          state.applyEvent({
            id: '88888888-8888-4888-8888-888888888881',
            sessionId: seed.sessionId,
            sequence: 1_000_010,
            kind: 'vote',
            actor: seed.voterId,
            payload: {
              target: 'facet',
              entity_kind: 'node',
              entity_id: seed.proposalNodeId,
              facet: 'wording',
              participant: seed.voterId,
              choice: 'agree',
              voted_at: '2026-05-17T00:00:05.000Z',
            },
            createdAt: '2026-05-17T00:00:05.000Z',
          });
        },
        {
          sessionId,
          proposalNodeId: PROPOSAL_NODE_ID,
          voterId: SECOND_VOTER_ID,
        },
      );
      const indicatorRow = wordingChip.locator(
        '[data-testid="participant-pending-proposal-row-facet-vote-indicator-row"]',
      );
      await expect(indicatorRow).toBeVisible();
      const dot = indicatorRow.locator(
        `[data-vote-indicator][data-participant-id="${SECOND_VOTER_ID}"][data-choice="agree"]`,
      );
      await expect(dot).toHaveCount(1);

      // 9. `part_vote_button_per_facet` extension — with the row still
      //    expanded and the chip at `proposed`, the per-facet vote
      //    buttons surface inside the chip. Click the agree button to
      //    exercise the affordance; then inject the matching `vote`
      //    envelope into the client store (mirroring the step 4 + 8
      //    `applyEvent` seam — the proposal was seeded client-side and
      //    has no server record, so the click's live WS round-trip
      //    would be rejected for sequence-mismatch; the projector's
      //    own-vote-hides behavior is the deterministic post-condition
      //    this leaf asserts per Decision §6). After the projector
      //    picks up the own vote, the affordance gate flips and both
      //    buttons disappear from the chip.
      const agreeButton = wordingChip.locator(
        '[data-testid="participant-pending-proposal-row-facet-vote-button-agree"]',
      );
      await expect(agreeButton).toHaveCount(1);
      await agreeButton.click();
      // `part_vote_single_tap` policy pin — no confirmation modal /
      // dialog mounts at the click → ack cross-process boundary. The
      // assertions run AFTER the click resolves (Playwright's await
      // microtask scheduling) but BEFORE the `expect.poll(...)` for
      // own-vote-hides — at that window any confirmation modal
      // wired into the click handler would be mounted because
      // confirmation modals mount synchronously on click in React's
      // render cycle. Per `docs/participant-ui.md` lines 84 + 139 +
      // ADR 0030 §3.
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
      await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
      await page.evaluate(
        (seed: { sessionId: string; proposalNodeId: string; voterId: string }) => {
          const store = (
            window as unknown as {
              __aConversaWsStore?: {
                getState: () => {
                  applyEvent: (event: unknown) => void;
                };
              };
            }
          ).__aConversaWsStore;
          if (!store) {
            throw new Error('__aConversaWsStore is not exposed on window');
          }
          store.getState().applyEvent({
            id: '88888888-8888-4888-8888-888888888882',
            sessionId: seed.sessionId,
            sequence: 1_000_011,
            kind: 'vote',
            actor: seed.voterId,
            payload: {
              target: 'facet',
              entity_kind: 'node',
              entity_id: seed.proposalNodeId,
              facet: 'wording',
              participant: seed.voterId,
              choice: 'agree',
              voted_at: '2026-05-17T00:00:06.000Z',
            },
            createdAt: '2026-05-17T00:00:06.000Z',
          });
        },
        {
          sessionId,
          proposalNodeId: PROPOSAL_NODE_ID,
          voterId: leo.userId,
        },
      );
      await expect
        .poll(
          async () =>
            await wordingChip
              .locator('[data-testid="participant-pending-proposal-row-facet-vote-button-agree"]')
              .count(),
          { timeout: 5_000 },
        )
        .toBe(0);
      // `part_change_vote_pre_commit` extension — the dispute (opposite-
      // of-ownVote) button STAYS visible after the agree ack; it is the
      // change-vote affordance. Pre-`part_change_vote_pre_commit` the
      // refinement asserted dispute=0 here.
      const disputeButton = wordingChip.locator(
        '[data-testid="participant-pending-proposal-row-facet-vote-button-dispute"]',
      );
      await expect(disputeButton).toHaveCount(1);
      await expect(disputeButton).toHaveAttribute('data-vote-mode', 'change');

      // 10. `part_change_vote_pre_commit` extension — click the dispute
      //     button to flip the vote, then inject the matching `vote`
      //     envelope into the client store (mirroring step 9's seam,
      //     since the client-seeded proposal has no server record).
      //     After the projector picks up the flipped own-vote the agree
      //     button comes back into the DOM and the dispute button hides
      //     — symmetric to the step 9 post-condition with the sides
      //     swapped. The single-tap-policy assertions wrap the change-
      //     vote click for symmetric coverage per
      //     `part_vote_single_tap.md` line 26.
      await disputeButton.click();
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
      await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
      await page.evaluate(
        (seed: { sessionId: string; proposalNodeId: string; voterId: string }) => {
          const store = (
            window as unknown as {
              __aConversaWsStore?: {
                getState: () => {
                  applyEvent: (event: unknown) => void;
                };
              };
            }
          ).__aConversaWsStore;
          if (!store) {
            throw new Error('__aConversaWsStore is not exposed on window');
          }
          store.getState().applyEvent({
            id: '88888888-8888-4888-8888-888888888883',
            sessionId: seed.sessionId,
            sequence: 1_000_012,
            kind: 'vote',
            actor: seed.voterId,
            payload: {
              target: 'facet',
              entity_kind: 'node',
              entity_id: seed.proposalNodeId,
              facet: 'wording',
              participant: seed.voterId,
              choice: 'dispute',
              voted_at: '2026-05-17T00:00:07.000Z',
            },
            createdAt: '2026-05-17T00:00:07.000Z',
          });
        },
        {
          sessionId,
          proposalNodeId: PROPOSAL_NODE_ID,
          voterId: leo.userId,
        },
      );
      await expect
        .poll(
          async () =>
            await wordingChip
              .locator('[data-testid="participant-pending-proposal-row-facet-vote-button-dispute"]')
              .count(),
          { timeout: 5_000 },
        )
        .toBe(0);
      const agreeBack = wordingChip.locator(
        '[data-testid="participant-pending-proposal-row-facet-vote-button-agree"]',
      );
      await expect(agreeBack).toHaveCount(1);
      await expect(agreeBack).toHaveAttribute('data-vote-mode', 'change');

      await header.click();
      await expect(row).toHaveAttribute('data-expanded', 'false');
      await expect(header).toHaveAttribute('aria-expanded', 'false');
      await expect(
        row.locator('[data-testid="participant-pending-proposal-row-body"]'),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
