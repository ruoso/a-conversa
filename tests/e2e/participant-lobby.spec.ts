// End-to-end spec for the participant pre-debate lobby route.
//
// Refinement: tasks/refinements/participant-ui/part_lobby_view.md
//              (Decision §7 — two scenarios: single-debater happy
//              path + two-debater cross-context live-update; the
//              second is the milestone-closing proof for
//              `m_manual_lobby_smoke`).
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
// TaskJuggler: participant_ui.part_session_join.part_lobby_view
//
// **What this spec pins.** The chain a moderator and two debaters drive
// against the live compose stack:
//
//   1. The moderator creates a public session via the same-origin API
//      (the moderator UI's `<CreateSessionRoute>` shape — `POST
//      /api/sessions` returning `{ id }`).
//   2. A debater follows the moderator-emitted invite URL, claims a
//      slot, and lands on the real lobby route at `/p/sessions/:id/lobby`.
//   3. The lobby renders the session topic, the moderator row, the
//      caller's debater row, and a "waiting for the other debater"
//      hint — pinning the cold-load HTTP-prefetch path that resolves
//      the fresh-tab race.
//   4. While the first debater is still in the lobby, the OTHER
//      debater (in a second browser context with a fresh OIDC dance)
//      claims their slot. The first debater's open WS subscription
//      delivers the `participant-joined` event; the slot map re-derives;
//      the second debater's row appears LIVE without a manual refresh.
//      This second scenario IS the manual-smoke proof for
//      `m_manual_lobby_smoke`.
//
// **Why multiple contexts.** Each `browser.newContext()` gives the
// driven user an independent cookie jar + WS connection, faithful to
// the manual chain a human moderator would drive (open two incognito
// windows, log in as two different debaters). Both scenarios use
// `authedContext(browser, username)` to load the pre-seeded jar for
// each user — no per-test OIDC dance.
//
// **OIDC dance budget.** Zero per-test dances. Both scenarios open
// their per-user contexts via `authedContext(browser, username)` which
// loads the pre-seeded jar `global-auth.setup.ts` wrote during the
// one-time bootstrap. The historical "alice + ben + maria each pay a
// fresh dance" model tripped Authelia's per-IP rate limiter under
// parallel workers (the limiter response surfaces as
// `OAUTH_RESPONSE_IS_NOT_CONFORM` inside `apps/server/src/auth/flow.ts`
// → 500 on `/api/auth/callback`); pre-seeded jars confine all OIDC
// traffic to the serial setup spec and let cross-context tests run
// reliably under any worker count.

import { expect, test, type Page } from '@playwright/test';

import { authedContext } from './fixtures/authed-context';

/**
 * Create a session via the same-origin API. Mirrors what the moderator
 * UI does when its `<CreateSessionRoute>` submits — the route makes
 * the same POST, the server returns `{ id: <uuid> }` on 201. The
 * caller MUST already be authenticated.
 */
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

test.describe('Participant lobby route — single-debater happy path', () => {
  test('alice creates a public session, ben claims debater-A, lands on the lobby with topic + moderator + own row + waiting hint', async ({
    browser,
  }) => {
    const TOPIC = 'Should universal basic income replace existing welfare programs?';

    // ── Context 0: alice (pre-seeded jar) creates the session. ──────
    const aliceContext = await authedContext(browser, 'alice');
    const alicePage = await aliceContext.newPage();
    let sessionId: string;
    try {
      const sessionResponse = await alicePage.request.get('/api/auth/me');
      expect(sessionResponse.status()).toBe(200);
      const aliceBody = (await sessionResponse.json()) as { screenName: string };
      expect(aliceBody.screenName).toBe('alice');
      sessionId = await createSession(alicePage, { topic: TOPIC, privacy: 'public' });
    } finally {
      await aliceContext.close();
    }

    // ── Context 1: ben (pre-seeded jar) follows the debater-A invite. ─
    const benContext = await authedContext(browser, 'ben');
    const benPage = await benContext.newPage();
    try {
      await benPage.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);

      // Ben clicks join; the invite route POSTs the claim and
      // navigates to the lobby URL.
      await expect(benPage.getByTestId('route-invite-acceptance')).toBeVisible({
        timeout: 15_000,
      });
      const joinButton = benPage.getByTestId('invite-acceptance-join-button');
      await expect(joinButton).toBeEnabled();
      await joinButton.click();
      await benPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });

      // The lobby renders with the route's stable testid.
      await expect(benPage.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });

      // The session topic surfaces under the dedicated testid.
      await expect(benPage.getByTestId('lobby-topic')).toContainText(TOPIC, {
        timeout: 15_000,
      });

      // The moderator row carries alice's screen name + the
      // Moderator badge.
      await expect(benPage.getByTestId('lobby-participant-moderator-name')).toHaveText('alice', {
        timeout: 15_000,
      });
      await expect(benPage.getByTestId('lobby-participant-moderator-badge')).toHaveText(
        'Moderator',
      );

      // Ben's row carries his screen name + the Debater A badge.
      await expect(benPage.getByTestId('lobby-participant-debater-A-name')).toHaveText('ben', {
        timeout: 15_000,
      });
      await expect(benPage.getByTestId('lobby-participant-debater-A-badge')).toHaveText(
        'Debater A',
      );

      // Debater B is missing → waiting hint references the missing
      // debater (the role label is the localized "Debater B" string).
      await expect(benPage.getByTestId('lobby-waiting-for-debater')).toContainText('Debater B');

      // The both-debaters-present line is absent (debater-B
      // hasn't joined yet).
      await expect(benPage.getByTestId('lobby-both-debaters-present')).toHaveCount(0);
    } finally {
      await benContext.close();
    }
  });
});

test.describe('Participant lobby route — two-debater cross-context live update', () => {
  test('ben in context 1 sees maria appear within seconds of maria claiming debater-B in context 2 (no refresh)', async ({
    browser,
  }) => {
    const TOPIC =
      'Should universal basic income replace existing welfare programs? (live-update scenario)';

    // ── Context 0: alice (pre-seeded jar) creates the session. ──────
    const aliceContext = await authedContext(browser, 'alice');
    const alicePage = await aliceContext.newPage();
    let sessionId: string;
    try {
      sessionId = await createSession(alicePage, { topic: TOPIC, privacy: 'public' });
    } finally {
      await aliceContext.close();
    }

    // ── Context 1: ben (pre-seeded jar) claims debater-A and stays on
    //    the lobby. ───────────────────────────────────────────────────
    const benContext = await authedContext(browser, 'ben');
    const benPage = await benContext.newPage();
    // ── Context 2: maria (pre-seeded jar) claims debater-B (allocated
    //    up-front so the teardown is reliable in `finally`). ─────────
    const mariaContext = await authedContext(browser, 'maria');
    const mariaPage = await mariaContext.newPage();
    try {
      // 1. Ben claims debater-A.
      await benPage.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
      await expect(benPage.getByTestId('route-invite-acceptance')).toBeVisible({
        timeout: 15_000,
      });
      await benPage.getByTestId('invite-acceptance-join-button').click();
      await benPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });

      // 2. Ben's lobby is loaded — debater-B slot is still empty.
      await expect(benPage.getByTestId('route-lobby')).toBeVisible({
        timeout: 15_000,
      });
      await expect(benPage.getByTestId('lobby-participant-debater-A-name')).toHaveText('ben', {
        timeout: 15_000,
      });
      await expect(benPage.getByTestId('lobby-participant-debater-B')).toHaveCount(0);
      await expect(benPage.getByTestId('lobby-waiting-for-debater')).toContainText('Debater B');

      // 3. Maria claims debater-B in her own context.
      await mariaPage.goto(`/p/sessions/${sessionId}/invite?role=debater-B`);
      await expect(mariaPage.getByTestId('route-invite-acceptance')).toBeVisible({
        timeout: 15_000,
      });
      await mariaPage.getByTestId('invite-acceptance-join-button').click();
      await mariaPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });

      // 4. Ben's lobby (context 1) sees maria's row appear via the
      //    WS broadcast — without a manual refresh. Playwright's
      //    `toBeVisible` polls with an exponential retry up to the
      //    declared timeout; the lobby's slot map re-derives on every
      //    WS event arrival, so the row appears as soon as the
      //    `participant-joined` broadcast lands. The 15s budget
      //    matches the refinement's "~15s" guidance and absorbs WS
      //    round-trip + applyEvent + re-render latency on a slow CI
      //    runner.
      await expect(benPage.getByTestId('lobby-participant-debater-B-name')).toHaveText('maria', {
        timeout: 15_000,
      });

      // 5. The waiting hint is gone; the both-present line replaces it.
      await expect(benPage.getByTestId('lobby-waiting-for-debater')).toHaveCount(0);
      await expect(benPage.getByTestId('lobby-both-debaters-present')).toBeVisible();

      // 6. Belt-and-suspenders — ben's debater-A row stayed intact.
      await expect(benPage.getByTestId('lobby-participant-debater-A-name')).toHaveText('ben');
    } finally {
      await mariaContext.close();
      await benContext.close();
    }
  });
});
