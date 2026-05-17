// End-to-end spec for the participant invite-acceptance route.
//
// Refinement: tasks/refinements/participant-ui/part_invite_acceptance.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
// TaskJuggler: participant_ui.part_session_join.part_invite_acceptance
//
// **What this spec pins.** The chain a real debater hits:
//   1. The moderator-emitted invite URL (`/p/sessions/<uuid>/invite?role=debater-A`)
//      lands on the participant surface's new claim route.
//   2. The route's claim POST (`POST /api/sessions/:id/invite/claim`)
//      against the live backend (the predecessor endpoint, commit
//      `f07d456`) returns 200 for an authenticated, visible, non-host
//      caller against a session whose target role is available.
//   3. The route's post-success navigation lands the debater on the
//      placeholder lobby route (testid `lobby-placeholder`, session id
//      under `session-id`).
//   4. The not-found code path renders the discriminating
//      `invite-acceptance-error-not-found` panel.
//
// **Two scenarios:**
//
//   1. Happy path — alice creates a public session (via the existing
//      API, no UI dance), logs out, ben logs in and follows the
//      Debater A invite URL, clicks the join button, lands on the
//      lobby placeholder. The session is public so ben (a non-host,
//      non-yet-participant) can see and claim it — the predecessor
//      endpoint's visibility gate returns 404 to non-host callers
//      against private sessions (existence-non-leak).
//   2. Not-found path — the seeded `setup-auth` user navigates to a
//      deterministic non-existent session id, clicks the join button,
//      sees the terminal not-found panel.
//
// **Cross-surface scenarios deferred.** Per Decision §7 of the
// refinement: the unauth → OAuth → return-to round-trip e2e is already
// covered by the skeleton-smoke spec's `'unauthenticated visit to /p/...'`
// scenario + the auth-flow spec; the multi-debater cross-surface
// "moderator sees both debaters joined" scenario inherits to
// `participant_ui.part_tests.part_e2e_playwright.part_pw_concurrent_with_moderator`.

import { expect, test, type Page } from '@playwright/test';

import { loginAs } from './fixtures/auth';

const NON_EXISTENT_SESSION_ID = '00000000-0000-4000-8000-0000000000ff';

/**
 * Create a session via the same-origin API. Mirrors what the moderator
 * UI does when its `<CreateSessionRoute>` submits — the route makes
 * the same POST, the server returns `{ id: <uuid> }` on 201.
 *
 * The caller MUST already be authenticated; `loginAs` is the canonical
 * way to land that cookie on the page's context. The session's host
 * is the authenticated caller.
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
 * Log the current user out and drop the Authelia session cookie so the
 * next `loginAs` call drives a fresh OIDC dance instead of auto-
 * authenticating as the previous user.
 *
 * `/api/auth/logout` clears the platform's `aconversa-session` cookie,
 * but the Authelia `authelia_session` cookie lives on
 * `authelia.aconversa.local` and would otherwise auto-authenticate the
 * previous user when the next loginAs's click sends the browser back to
 * Authelia. `context.clearCookies()` flushes the jar entirely; the
 * `setup-auth` storage state was already loaded into this context at
 * test start, so the locale cookie is still present on `localhost` from
 * before — but the test will re-navigate which is fine.
 */
async function logoutAndClearAllCookies(page: Page): Promise<void> {
  const response = await page.request.post('/api/auth/logout');
  expect([200, 204], 'logoutAndClearAllCookies: unexpected status').toContain(response.status());
  // Drop every cookie (both `localhost` and `authelia.aconversa.local`)
  // so the next OIDC dance starts from a cookie-free context.
  await page.context().clearCookies();
}

test.describe('Participant invite-acceptance route — happy path', () => {
  // Fresh browser context with NO bootstrap storage state. The logout
  // step in this scenario revokes the JWT it was issued for; if the
  // scenario used the shared `setup-auth` bootstrap JWT, that JWT
  // would land on the server-side `auth_token_denylist` and every
  // OTHER test in the project (which loads the same JWT from the
  // shared storage state file) would 401 on its next request.
  //
  // Driving fresh OIDC dances for both users keeps the bootstrap JWT
  // out of the denylist. The dance cost (two against the dev
  // Authelia per CI run for this scenario) is bounded; per Decision §7
  // of the refinement, the budget allowed one extra `loginAs(ben)`
  // dance per CI run, and this construction extends that to two
  // (alice's dance lands a fresh JWT that we then revoke; alice's
  // shared bootstrap JWT is untouched).
  test('alice creates a private session, ben follows the invite URL, claims debater-A, lands on the lobby placeholder', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      // Explicitly empty `storageState` overrides the project-level
      // `use.storageState` (which points at the shared bootstrap JWT
      // file). Without this override Playwright would inherit the
      // bootstrap jar into our context — and our logout step would
      // revoke alice's bootstrap JTI, breaking every other test in
      // the project that loads the same jar.
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    try {
      // 1. The bootstrap `setup-auth` jar carries alice; `loginAs(alice)`
      //    short-circuits on the `/api/auth/me === 200` probe.
      const alice = await loginAs(page, { username: 'alice' });
      expect(alice.screenName).toBe('alice');

      // 2. Alice creates a public session via the API. The session's
      //    host is alice (implicit from the session cookie). The
      //    predecessor endpoint's visibility-then-lifecycle ordering
      //    (see `apps/server/src/sessions/routes.ts:2713-2738` +
      //    `tasks/refinements/backend/session_invite_self_claim_endpoint.md`
      //    Decisions §"Public sessions are claimable by any
      //    authenticated user") admits any authenticated caller against
      //    a public session; a private session would 404 here because
      //    ben is not yet visible to it (the predecessor returns
      //    `not-found` for invisible-to-caller rows as an
      //    existence-non-leak). v1 has no tokenized invitations — the
      //    moderator-shared URL relies on out-of-band trust + the
      //    structural role-availability index, so `public` is the
      //    semantically correct privacy mode for the moderator-shares-
      //    invite-URL-with-debater chain.
      const sessionId = await createSession(page, {
        topic: 'Should universal basic income replace existing welfare programs?',
        privacy: 'public',
      });

      // 3. Alice logs out so ben can claim a debater slot. (If ben were
      //    to attempt the claim while still authenticated as alice,
      //    the endpoint would return 403 `not-a-moderator` because
      //    alice already holds the moderator slot.) Also flush all
      //    cookies so the next OIDC dance drives a fresh Authelia
      //    login rather than auto-authenticating as alice.
      await logoutAndClearAllCookies(page);

      // 4. Ben logs in. The cookie jar now carries ben's session
      //    cookie. `loginAs` may need a full OIDC dance because the
      //    bootstrap jar was for alice; the helper handles both the
      //    new-user (first time ben logs in this CI run) and the
      //    returning-user branches.
      const ben = await loginAs(page, { username: 'ben' });
      expect(ben.screenName).toBe('ben');

      // 5. Ben navigates to the moderator-emitted invite URL shape.
      await page.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);

      // 6. The claim route renders. The hint surfaces ben's screen
      //    name and the Debater A label.
      await expect(page.getByTestId('route-invite-acceptance')).toBeVisible({
        timeout: 15_000,
      });
      const hint = page.getByTestId('invite-acceptance-hint');
      await expect(hint).toBeVisible();
      await expect(hint).toContainText('Debater A');
      await expect(hint).toContainText('ben');

      // 7. Click the join button. The route POSTs against the live
      //    backend's invite-claim endpoint.
      const joinButton = page.getByTestId('invite-acceptance-join-button');
      await expect(joinButton).toBeVisible();
      await expect(joinButton).toBeEnabled();
      await joinButton.click();

      // 8. URL settles on the lobby placeholder route under the same
      //    `/p` basename.
      await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });

      // 9. The lobby placeholder testid renders + the session id round-
      //    trips into the dedicated `session-id` testid.
      await expect(page.getByTestId('lobby-placeholder')).toBeVisible();
      await expect(page.getByTestId('session-id')).toHaveText(sessionId);
    } finally {
      await context.close();
    }
  });
});

test.describe('Participant invite-acceptance route — not-found terminal path', () => {
  test('alice navigates to a non-existent session id, clicks join, sees the terminal not-found panel', async ({
    page,
  }) => {
    // The seeded `setup-auth` jar carries alice; the dance is
    // short-circuited.
    await loginAs(page, { username: 'alice' });

    await page.goto(`/p/sessions/${NON_EXISTENT_SESSION_ID}/invite?role=debater-A`);

    // The claim route renders with the hint + button.
    await expect(page.getByTestId('route-invite-acceptance')).toBeVisible({ timeout: 15_000 });
    const joinButton = page.getByTestId('invite-acceptance-join-button');
    await expect(joinButton).toBeVisible();
    await joinButton.click();

    // The backend returns 404 not-found (existence-non-leak: a
    // non-existent session and a private-but-invisible session
    // collapse to the same envelope per the predecessor's
    // visibility-then-lifecycle ordering).
    await expect(page.getByTestId('invite-acceptance-error-not-found')).toBeVisible({
      timeout: 15_000,
    });

    // The terminal branch hides the join button and never navigates
    // away from the invite URL.
    await expect(page.getByTestId('invite-acceptance-join-button')).toHaveCount(0);
    await expect(page.getByTestId('lobby-placeholder')).toHaveCount(0);
    expect(page.url()).toContain(`/p/sessions/${NON_EXISTENT_SESSION_ID}/invite`);
  });
});
