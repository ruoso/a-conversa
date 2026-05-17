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
// **Why two contexts.** A second `browser.newContext()` gives the
// second debater an independent cookie jar + WS connection, faithful
// to the manual chain a human moderator would drive (open two
// incognito windows, log in as two different debaters). The single-
// context fallback (driving the second claim via `page.request.post`)
// retains the participant-side WS-live-update pin but is less
// faithful to the user flow.
//
// **OIDC dance budget.** Per the refinement's Decision §7 the
// scenarios cost 4 fresh OIDC dances per CI run (alice for session-
// create in each scenario, ben for debater-A in each scenario, plus
// maria once for debater-B in scenario 2). Within the Authelia rate-
// limit budget; the invite-acceptance spec already pays 2 dances.

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { loginAs } from './fixtures/auth';

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

/**
 * Log the current user out and drop every cookie so the next
 * `loginAs` drives a fresh OIDC dance. Mirrors the invite-acceptance
 * spec's helper at `participant-invite-acceptance.spec.ts:85-91`.
 */
async function logoutAndClearAllCookies(page: Page): Promise<void> {
  const response = await page.request.post('/api/auth/logout');
  expect([200, 204], 'logoutAndClearAllCookies: unexpected status').toContain(response.status());
  await page.context().clearCookies();
}

/**
 * Allocate a fresh browser context with an empty cookie jar. The
 * `setup-auth` storage state from the project-level `use.storageState`
 * is explicitly overridden — without that override, every fresh
 * context would inherit the bootstrap alice JWT and our logout step
 * would land it on the server-side `auth_token_denylist`, breaking
 * every other test in the project. Mirrors the invite-acceptance
 * spec's pattern at `participant-invite-acceptance.spec.ts:111-120`.
 */
async function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
  });
}

test.describe('Participant lobby route — single-debater happy path', () => {
  test('alice creates a public session, ben claims debater-A, lands on the lobby with topic + moderator + own row + waiting hint', async ({
    browser,
  }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Should universal basic income replace existing welfare programs?';

      // 1. Alice authenticates and creates a public session.
      const alice = await loginAs(page, { username: 'alice' });
      expect(alice.screenName).toBe('alice');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // 2. Alice logs out + clears cookies so the next dance is fresh.
      await logoutAndClearAllCookies(page);

      // 3. Ben authenticates and follows the debater-A invite URL.
      const ben = await loginAs(page, { username: 'ben' });
      expect(ben.screenName).toBe('ben');
      await page.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);

      // 4. Ben clicks join; the invite route POSTs the claim and
      //    navigates to the lobby URL.
      await expect(page.getByTestId('route-invite-acceptance')).toBeVisible({
        timeout: 15_000,
      });
      const joinButton = page.getByTestId('invite-acceptance-join-button');
      await expect(joinButton).toBeEnabled();
      await joinButton.click();
      await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });

      // 5. The lobby renders with the route's stable testid.
      await expect(page.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });

      // 6. The session topic surfaces under the dedicated testid.
      await expect(page.getByTestId('lobby-topic')).toContainText(TOPIC, {
        timeout: 15_000,
      });

      // 7. The moderator row carries alice's screen name + the
      //    Moderator badge.
      await expect(page.getByTestId('lobby-participant-moderator-name')).toHaveText('alice', {
        timeout: 15_000,
      });
      await expect(page.getByTestId('lobby-participant-moderator-badge')).toHaveText('Moderator');

      // 8. Ben's row carries his screen name + the Debater A badge.
      await expect(page.getByTestId('lobby-participant-debater-A-name')).toHaveText('ben', {
        timeout: 15_000,
      });
      await expect(page.getByTestId('lobby-participant-debater-A-badge')).toHaveText('Debater A');

      // 9. Debater B is missing → waiting hint references the missing
      //    debater (the role label is the localized "Debater B" string).
      await expect(page.getByTestId('lobby-waiting-for-debater')).toContainText('Debater B');

      // 10. The both-debaters-present line is absent (debater-B
      //     hasn't joined yet).
      await expect(page.getByTestId('lobby-both-debaters-present')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

test.describe('Participant lobby route — two-debater cross-context live update', () => {
  test('ben in context 1 sees maria appear within seconds of maria claiming debater-B in context 2 (no refresh)', async ({
    browser,
  }) => {
    const TOPIC =
      'Should universal basic income replace existing welfare programs? (live-update scenario)';

    // ── Context 0: alice creates the session + logs out. ────────────
    const aliceContext = await freshContext(browser);
    const alicePage = await aliceContext.newPage();
    let sessionId: string;
    try {
      const alice = await loginAs(alicePage, { username: 'alice' });
      expect(alice.screenName).toBe('alice');
      sessionId = await createSession(alicePage, { topic: TOPIC, privacy: 'public' });
    } finally {
      await aliceContext.close();
    }

    // ── Context 1: ben claims debater-A and stays on the lobby. ─────
    const benContext = await freshContext(browser);
    const benPage = await benContext.newPage();
    // ── Context 2: maria claims debater-B (allocated up-front so the
    //    teardown is reliable in `finally`). ───────────────────────────
    const mariaContext = await freshContext(browser);
    const mariaPage = await mariaContext.newPage();
    try {
      // 1. Ben authenticates and claims debater-A.
      const ben = await loginAs(benPage, { username: 'ben' });
      expect(ben.screenName).toBe('ben');
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

      // 3. Carol authenticates in her own context and claims debater-B.
      const maria = await loginAs(mariaPage, { username: 'maria' });
      expect(maria.screenName).toBe('maria');
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
