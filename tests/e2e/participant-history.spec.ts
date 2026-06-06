// End-to-end spec for the participant operate route's change-history tab.
//
// Refinement: tasks/refinements/participant-ui/part_history_list.md
//   (Acceptance §7 — this leaf wires the History tab into the operate
//    route, so the pane is reachable. Logs in, joins/operates a session
//    that has accrued events, switches to the History tab, and asserts the
//    list renders the expected events newest-first with their kind labels.
//    Runs under the same participant project that hosts
//    `participant-pending-proposals.spec.ts`; Decision §D2.)
// ADRs:    docs/adr/0008-e2e-framework-playwright.md
//          docs/adr/0017-mock-oauth-authelia-users-file.md
//          docs/adr/0022-no-throwaway-verifications.md
//          docs/adr/0026-micro-frontend-root-app.md
//
// The fixture seeds the `__aConversaWsStore` test seam directly (the same
// seam `participant-pending-proposals.spec.ts` walks): the change-history
// pane merges the REST prefetch (the persisted session log) with the live
// WS overlay, so the seeded high-sequence events surface at the top of the
// newest-first list. The protocol boundary is pinned elsewhere; this spec
// pins the UI consumer.

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

test.describe('Participant operate route — change-history tab', () => {
  test('peter creates a session, quinn claims debater-A, switches to History, and the seeded events render newest-first with their kind labels', async ({
    browser,
  }) => {
    // Uses `peter` + `quinn` — a fresh pair from the dev user pool, distinct
    // from the blocks saturating the other participant specs (alice+ben,
    // maria+dave, frank+erin, grace+henry, ivan+julia, kate+leo,
    // nora+oscar) to avoid racing on the shared user-creation path under
    // `fullyParallel: true`.
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Change-history tab reaches the participant tablet';

      // Moderator peter creates the session.
      const peter = await loginAs(page, { username: 'peter' });
      expect(peter.screenName.toLowerCase()).toBe('peter');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // Debater quinn claims debater-A and lands on the operate route.
      await logoutAndClearAllCookies(page);
      const quinn = await loginAs(page, { username: 'quinn' });
      expect(quinn.screenName.toLowerCase()).toBe('quinn');

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

      // Seed two node-created events via the WS test seam. Their high
      // sequences put them at the head of the newest-first list regardless
      // of however many baseline (session-created / participant-joined)
      // events the REST prefetch returns.
      const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
      const EVENT_A_ID = '33333333-3333-4333-8333-333333333301';
      const EVENT_B_ID = '33333333-3333-4333-8333-333333333302';
      await page.evaluate(
        (seed: { sessionId: string; actorId: string; eventAId: string; eventBId: string }) => {
          const store = (
            window as unknown as {
              __aConversaWsStore?: {
                getState: () => { applyEvent: (event: unknown) => void };
              };
            }
          ).__aConversaWsStore;
          if (!store) {
            throw new Error('__aConversaWsStore is not exposed on window');
          }
          const state = store.getState();
          state.applyEvent({
            id: seed.eventAId,
            sessionId: seed.sessionId,
            sequence: 1_000_001,
            kind: 'node-created',
            actor: seed.actorId,
            payload: {
              node_id: '55555555-5555-4555-8555-555555555501',
              wording: 'First seeded statement',
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          state.applyEvent({
            id: seed.eventBId,
            sessionId: seed.sessionId,
            sequence: 1_000_002,
            kind: 'node-created',
            actor: seed.actorId,
            payload: {
              node_id: '55555555-5555-4555-8555-555555555502',
              wording: 'Second seeded statement',
              created_by: seed.actorId,
              created_at: '2026-05-17T00:00:01.000Z',
            },
            createdAt: '2026-05-17T00:00:01.000Z',
          });
        },
        { sessionId, actorId: ACTOR_ID, eventAId: EVENT_A_ID, eventBId: EVENT_B_ID },
      );

      // Switch to the History tab; the graph region is replaced by the pane.
      const historyTab = page.getByTestId('participant-proposals-tabbar-history');
      await expect(historyTab).toBeVisible();
      await historyTab.click();
      await expect(historyTab).toHaveAttribute('data-active', 'true');
      await expect(page.locator('[data-testid="route-operate-graph-region"]')).toHaveCount(0);
      await expect(page.getByTestId('participant-history-pane')).toBeVisible();

      // The list renders; the two seeded events are at the head, newest-first
      // (sequence 1000002 before 1000001), each with the en-US kind label.
      const list = page.getByTestId('participant-history-pane-list');
      await expect(list).toBeVisible();
      const rows = list.locator('[data-testid="participant-history-row"]');

      await expect(rows.nth(0)).toHaveAttribute('data-event-id', EVENT_B_ID);
      await expect(rows.nth(0)).toHaveAttribute('data-sequence', '1000002');
      await expect(rows.nth(0).locator('[data-testid="participant-history-row-kind"]')).toHaveText(
        'Statement created',
      );
      await expect(rows.nth(0).locator('[data-testid="participant-history-row-actor"]')).toHaveText(
        ACTOR_ID.slice(0, 8),
      );

      await expect(rows.nth(1)).toHaveAttribute('data-event-id', EVENT_A_ID);
      await expect(rows.nth(1)).toHaveAttribute('data-sequence', '1000001');
      await expect(rows.nth(1).locator('[data-testid="participant-history-row-kind"]')).toHaveText(
        'Statement created',
      );
    } finally {
      await context.close();
    }
  });
});
