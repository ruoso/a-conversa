// End-to-end spec for the participant operate route's "My agreements"
// tab.
//
// Refinement: tasks/refinements/participant-ui/part_my_agreements_view.md
// ADRs:    docs/adr/0008-e2e-framework-playwright.md
//          docs/adr/0017-mock-oauth-authelia-users-file.md
//          docs/adr/0022-no-throwaway-verifications.md
//          docs/adr/0026-micro-frontend-root-app.md
//
// Mirrors the `participant-pending-proposals.spec.ts` skeleton (login +
// join + operate-route + tab switch + seed events via the
// `__aConversaWsStore` test seam). One scenario, end-to-end:
//   1. Login as a participant; join a session.
//   2. Land on the operate route; click the My agreements tab.
//   3. Seed a `proposal` + `vote agree` + `commit` event triple via the
//      WS-store handle.
//   4. Assert one row appears with `data-facet-status="committed"`.
//   5. Tap the row → assert the graph tab is active + selection landed +
//      detail panel mounts.

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

test.describe('Participant operate route — my-agreements tab', () => {
  test('kate creates, leo joins, the my-agreements tab surfaces a committed agreement row and tap-to-navigate switches back to the graph + selects the entity', async ({
    browser,
  }) => {
    // Uses `kate` + `leo` — the same pair the participant-pending-proposals
    // spec adopts. Both specs create their own session via `POST
    // /api/sessions`, so the per-test isolation under `fullyParallel`
    // is at the session boundary, not the user pool.
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'My-agreements tab reaches the participant tablet';

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

      await page.goto(`/p/sessions/${sessionId}`);
      await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-root')).toBeVisible({ timeout: 15_000 });

      // 1. The third tab is visible.
      const myAgreementsTab = page.getByTestId('participant-proposals-tabbar-my-agreements');
      const graphTab = page.getByTestId('participant-proposals-tabbar-graph');
      await expect(myAgreementsTab).toBeVisible();
      await expect(myAgreementsTab).toHaveAttribute('data-active', 'false');

      // 2. Click it; the pane appears with the empty-state branch (no
      //    agreements yet).
      await myAgreementsTab.click();
      await expect(myAgreementsTab).toHaveAttribute('data-active', 'true');
      await expect(page.getByTestId('participant-my-agreements-pane')).toBeVisible();
      await expect(page.getByTestId('participant-my-agreements-pane-empty')).toBeVisible();

      // 3. Seed a proposal + vote agree (by the logged-in participant) +
      //    commit, so the pane renders one row with currentStatus
      //    "committed". `__aConversaWsStore.applyEvent` is the same seam
      //    `participant-pending-proposals.spec.ts` uses; the
      //    `participant-joileo` event ensures the projector counts leo
      //    as a current participant so the agree-by-leo flow drives the
      //    facet to `agreed` then `committed`.
      const NODE_ID = '55555555-5555-4555-8555-555555555555';
      const PROPOSAL_ID = '11111111-1111-4111-8111-111111111111';
      await page.evaluate(
        (seed: {
          sessionId: string;
          nodeId: string;
          proposalId: string;
          participantId: string;
        }) => {
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
            id: '33333333-3333-4333-8333-333333333331',
            sessionId: seed.sessionId,
            sequence: 1_000_001,
            kind: 'participant-joileo',
            actor: seed.participantId,
            payload: {
              user_id: seed.participantId,
              role: 'debater-A',
              screen_name: 'leo',
              joileo_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          state.applyEvent({
            id: '33333333-3333-4333-8333-333333333332',
            sessionId: seed.sessionId,
            sequence: 1_000_002,
            kind: 'node-created',
            actor: seed.participantId,
            payload: {
              node_id: seed.nodeId,
              wording: 'A statement my-agreements row will surface',
              created_by: seed.participantId,
              created_at: '2026-05-17T00:00:01.000Z',
            },
            createdAt: '2026-05-17T00:00:01.000Z',
          });
          state.applyEvent({
            id: seed.proposalId,
            sessionId: seed.sessionId,
            sequence: 1_000_003,
            kind: 'proposal',
            actor: seed.participantId,
            payload: {
              proposal: {
                kind: 'set-node-substance',
                node_id: seed.nodeId,
                value: 'agreed',
              },
            },
            createdAt: '2026-05-17T00:00:02.000Z',
          });
          state.applyEvent({
            id: '44444444-4444-4444-8444-444444444441',
            sessionId: seed.sessionId,
            sequence: 1_000_004,
            kind: 'vote',
            actor: seed.participantId,
            payload: {
              target: 'facet',
              entity_kind: 'node',
              entity_id: seed.nodeId,
              facet: 'substance',
              participant: seed.participantId,
              choice: 'agree',
              voted_at: '2026-05-17T00:00:03.000Z',
            },
            createdAt: '2026-05-17T00:00:03.000Z',
          });
          state.applyEvent({
            id: '44444444-4444-4444-8444-444444444442',
            sessionId: seed.sessionId,
            sequence: 1_000_005,
            kind: 'commit',
            actor: seed.participantId,
            payload: {
              target: 'facet',
              entity_kind: 'node',
              entity_id: seed.nodeId,
              facet: 'substance',
              committed_by: seed.participantId,
              committed_at: '2026-05-17T00:00:04.000Z',
            },
            createdAt: '2026-05-17T00:00:04.000Z',
          });
        },
        {
          sessionId,
          nodeId: NODE_ID,
          proposalId: PROPOSAL_ID,
          participantId: leo.userId,
        },
      );

      // 4. One row with data-facet-status="committed".
      const rows = page.locator('[data-testid="participant-my-agreements-row"]');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toHaveAttribute('data-facet-status', 'committed');
      await expect(rows.first()).toHaveAttribute('data-entity-id', NODE_ID);
      await expect(rows.first()).toHaveAttribute('data-facet', 'substance');

      // 5. Tap the row → the graph tab activates + the detail panel
      //    surfaces the seeded entity.
      await rows.first().locator('button').click();
      await expect(graphTab).toHaveAttribute('data-active', 'true');
      await expect(myAgreementsTab).toHaveAttribute('data-active', 'false');
      await expect(page.getByTestId('participant-detail-panel')).toBeVisible();
      await expect(page.getByTestId('participant-detail-panel')).toHaveAttribute(
        'data-state',
        'detail',
      );
    } finally {
      await context.close();
    }
  });
});
