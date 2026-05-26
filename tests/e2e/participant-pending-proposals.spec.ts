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
      await page.evaluate(
        (seed: { sessionId: string; proposalId: string; facetId: string; wording: string }) => {
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
            actor: '44444444-4444-4444-8444-444444444444',
            payload: {
              node_id: '55555555-5555-4555-8555-555555555555',
              wording: seed.wording,
              created_by: '44444444-4444-4444-8444-444444444444',
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          state.applyProposalStatus({
            sessionId: seed.sessionId,
            proposalId: seed.proposalId,
            sequence: 1_000_002,
            perFacetStatus: { [seed.facetId]: 'pending' },
          });
        },
        { sessionId, proposalId: PROPOSAL_ID, facetId: FACET_ID, wording: NODE_WORDING },
      );

      // 5. The badge reflects the new total; click Proposals; the
      //    non-empty branch surfaces the stable list container
      //    testid (the empty-state is hidden).
      await expect(badge).toHaveAttribute('data-count', '1');
      await proposalsTab.click();
      await expect(page.getByTestId('participant-pending-proposals-pane')).toBeVisible();
      // The non-empty branch renders an EMPTY `<ul>` shell whose children
      // sibling leaves (`part_proposal_list_view` et al.) fill. With no
      // rendered rows the list has a zero bounding box — `toBeAttached`
      // is the right pin for the structural container; visibility lands
      // once the list-view leaf adds content. The empty-state branch is
      // gone, which is the user-visible flip this case pins.
      await expect(page.getByTestId('participant-pending-proposals-pane-list')).toBeAttached();
      await expect(
        page.locator('[data-testid="participant-pending-proposals-pane-empty"]'),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
