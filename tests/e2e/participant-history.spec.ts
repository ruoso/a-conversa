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

  test('rosa creates a session, sam claims debater-A, and the History filter strip narrows by kind, actor, their intersection, clears, and surfaces the filtered-empty state', async ({
    browser,
  }) => {
    // Uses `rosa` + `sam` — the last unused dev-user pair, distinct from
    // every other participant spec's block to avoid racing on the shared
    // user-creation path under `fullyParallel: true`.
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Change-history filter strip narrows the participant log';

      const rosa = await loginAs(page, { username: 'rosa' });
      expect(rosa.screenName.toLowerCase()).toBe('rosa');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      await logoutAndClearAllCookies(page);
      const sam = await loginAs(page, { username: 'sam' });
      expect(sam.screenName.toLowerCase()).toBe('sam');

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

      // Seed three high-sequence events spanning two kinds and two actors so
      // the filter chips are deterministic regardless of the baseline log:
      //   nodeX  node-created / actor X
      //   voteX  vote         / actor X
      //   nodeY  node-created / actor Y
      // `vote` has no actor-Y row anywhere, so a vote + actor-Y filter matches
      // nothing → the filtered-empty surface.
      const ACTOR_X = '66666666-6666-4666-8666-666666666601';
      const ACTOR_Y = '77777777-7777-4777-8777-777777777701';
      const NODE_X_ID = '33333333-3333-4333-8333-333333333401';
      const VOTE_X_ID = '33333333-3333-4333-8333-333333333402';
      const NODE_Y_ID = '33333333-3333-4333-8333-333333333403';
      await page.evaluate(
        (seed: {
          sessionId: string;
          actorX: string;
          actorY: string;
          nodeXId: string;
          voteXId: string;
          nodeYId: string;
        }) => {
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
            id: seed.nodeXId,
            sessionId: seed.sessionId,
            sequence: 1_000_001,
            kind: 'node-created',
            actor: seed.actorX,
            payload: {
              node_id: '88888888-8888-4888-8888-888888888801',
              wording: 'Statement by X',
              created_by: seed.actorX,
              created_at: '2026-05-17T00:00:00.000Z',
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          });
          state.applyEvent({
            id: seed.voteXId,
            sessionId: seed.sessionId,
            sequence: 1_000_002,
            kind: 'vote',
            actor: seed.actorX,
            payload: {},
            createdAt: '2026-05-17T00:00:01.000Z',
          });
          state.applyEvent({
            id: seed.nodeYId,
            sessionId: seed.sessionId,
            sequence: 1_000_003,
            kind: 'node-created',
            actor: seed.actorY,
            payload: {
              node_id: '88888888-8888-4888-8888-888888888803',
              wording: 'Statement by Y',
              created_by: seed.actorY,
              created_at: '2026-05-17T00:00:02.000Z',
            },
            createdAt: '2026-05-17T00:00:02.000Z',
          });
        },
        {
          sessionId,
          actorX: ACTOR_X,
          actorY: ACTOR_Y,
          nodeXId: NODE_X_ID,
          voteXId: VOTE_X_ID,
          nodeYId: NODE_Y_ID,
        },
      );

      const historyTab = page.getByTestId('participant-proposals-tabbar-history');
      await expect(historyTab).toBeVisible();
      await historyTab.click();
      await expect(historyTab).toHaveAttribute('data-active', 'true');
      await expect(page.getByTestId('participant-history-pane')).toBeVisible();

      const strip = page.getByTestId('participant-history-filter-strip');
      await expect(strip).toBeVisible();
      const list = page.getByTestId('participant-history-pane-list');
      const nodeX = list.locator(`[data-event-id="${NODE_X_ID}"]`);
      const voteX = list.locator(`[data-event-id="${VOTE_X_ID}"]`);
      const nodeY = list.locator(`[data-event-id="${NODE_Y_ID}"]`);

      // All three seeded events are visible under the default (identity) filter.
      await expect(nodeX).toHaveCount(1);
      await expect(voteX).toHaveCount(1);
      await expect(nodeY).toHaveCount(1);

      // (1) Narrow by kind: pressing the `vote` chip leaves only vote rows.
      await strip.locator('[data-filter-kind="vote"]').click();
      await expect(voteX).toHaveCount(1);
      await expect(nodeX).toHaveCount(0);
      await expect(nodeY).toHaveCount(0);
      await expect(
        list.locator('[data-testid="participant-history-row"]:not([data-event-kind="vote"])'),
      ).toHaveCount(0);

      // Clear restores the full list.
      await strip.getByTestId('participant-history-filter-clear').click();
      await expect(nodeX).toHaveCount(1);
      await expect(voteX).toHaveCount(1);
      await expect(nodeY).toHaveCount(1);

      // (2) Narrow by actor: actor X owns nodeX + voteX, not nodeY.
      await strip.locator(`[data-filter-actor="${ACTOR_X}"]`).click();
      await expect(nodeX).toHaveCount(1);
      await expect(voteX).toHaveCount(1);
      await expect(nodeY).toHaveCount(0);

      // (3) AND the kind + actor dimensions down to the intersection
      // (vote AND actor X → voteX only).
      await strip.locator('[data-filter-kind="vote"]').click();
      await expect(voteX).toHaveCount(1);
      await expect(nodeX).toHaveCount(0);
      await expect(nodeY).toHaveCount(0);

      await strip.getByTestId('participant-history-filter-clear').click();
      await expect(list).toBeVisible();

      // (4) A filter that matches nothing (vote AND actor Y) surfaces the
      // filtered-empty state; the strip stays visible so the debater can clear.
      await strip.locator('[data-filter-kind="vote"]').click();
      await strip.locator(`[data-filter-actor="${ACTOR_Y}"]`).click();
      await expect(page.getByTestId('participant-history-pane-filtered-empty')).toBeVisible();
      await expect(page.getByTestId('participant-history-pane-list')).toHaveCount(0);
      await expect(strip).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
