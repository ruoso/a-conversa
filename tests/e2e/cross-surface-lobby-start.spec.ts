// End-to-end cross-surface spec for the moderator-lobby + start-debate
// gesture proven with three REAL browser contexts (alice + ben + maria).
//
// Refinements:
//   - tasks/refinements/moderator-ui/mod_session_lobby.md
//     (Decision §2 + §4 — the Enter-session button is strict-gated on
//     `bothDebatersPresent` and clicking it navigates to
//     `/m/sessions/:id/operate`; that click IS the start-the-debate
//     gesture by current design.)
//   - tasks/refinements/participant-ui/part_invite_acceptance.md
//   - tasks/refinements/participant-ui/part_lobby_view.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
//
// **Why this spec.** `invite-participants-flow.spec.ts` proves the
// moderator-side gate-then-enter chain via the dev-only
// `window.__aConversaWsStore` test seam, simulating debater presence
// without any real debater context. That seam was the right shape when
// the backend's participant self-claim endpoint did not yet exist (it
// was registered as a follow-up by `mod_invite_participants`); now that
// `backend.session_management.session_invite_self_claim_endpoint` is
// `complete 100` (commit `f07d456`) and the participant lobby route is
// shipped (`part_lobby_view`, commit `5932395`), the real cross-surface
// chain is reachable end-to-end. This spec proves it without faking:
// three independent browser contexts drive the moderator (alice) and
// two debaters (ben, maria) through their respective surfaces, and the
// moderator's lobby observes both debaters arrive via live WS events.
//
// **Why three contexts.** The whole point is to retire the WS-store
// seed for the cross-surface case. Each user needs an independent
// cookie jar + WS connection so the moderator's view receives
// `participant-joined` broadcasts as the server emits them — exactly
// the path a human moderator would drive (three browser windows).
// `participant-lobby.spec.ts` already pins the two-debater shape; this
// spec adds the third (moderator) context that closes the loop with
// the Enter-session click.
//
// **OIDC dance budget.** Zero per-test dances. Each per-user context
// loads the pre-seeded jar `global-auth.setup.ts` wrote during the
// one-time bootstrap (via `authedContext(browser, username)`). The
// historical "three fresh dances per run" model tripped Authelia's
// per-IP rate limiter under parallel workers (the limiter response
// surfaces as `OAUTH_RESPONSE_IS_NOT_CONFORM` inside
// `apps/server/src/auth/flow.ts` → 500 on `/api/auth/callback`); pre-
// seeded jars confine all OIDC traffic to the serial setup spec.

import { expect, test, type Page } from './fixtures/no-scrollbars';

import { authedContext } from './fixtures/authed-context';

const TOPIC = 'Should universal basic income replace existing welfare programs? (cross-surface)';

/**
 * Create a session via the same-origin API. Mirrors the moderator
 * UI's `<CreateSessionRoute>` POST shape — the server returns
 * `{ id: <uuid> }` on 201. Caller MUST already be authenticated.
 *
 * Sessions are created `public` because ben and maria are non-host
 * callers, and the predecessor self-claim endpoint's visibility-then-
 * lifecycle ordering returns 404 to non-host callers against private
 * sessions (existence-non-leak). The sibling `participant-invite-
 * acceptance.spec.ts` discovered this; mirror it here.
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

test.describe('Cross-surface lobby + start-debate gesture (three real browser contexts)', () => {
  test('alice (moderator) sees the Enter button enable as ben + maria join via their own contexts; clicking it navigates to the operate canvas', async ({
    browser,
  }) => {
    // ── Allocate all three contexts up-front so the `finally` teardown
    //    is reliable even if an early step throws. Each loads its own
    //    pre-seeded jar — no per-test OIDC dance. ────────────────────
    const aliceContext = await authedContext(browser, 'alice');
    const alicePage = await aliceContext.newPage();
    const benContext = await authedContext(browser, 'ben');
    const benPage = await benContext.newPage();
    const mariaContext = await authedContext(browser, 'maria');
    const mariaPage = await mariaContext.newPage();

    try {
      // ── Step 1. Alice creates a public session. ────────────────────
      const sessionId = await createSession(alicePage);

      // ── Step 2. Alice lands on the moderator's invite/lobby view. ──
      //    The moderator UI is mounted under `/m`; the route file
      //    (apps/moderator/src/routes/InviteParticipants.tsx) is what
      //    `mod_session_lobby` calls "the lobby" — same surface, both
      //    affordances (invite links + start-debate gate).
      await alicePage.goto(`/m/sessions/${sessionId}/invite`);
      await expect(alicePage.getByTestId('route-invite-participants')).toBeVisible({
        timeout: 15_000,
      });

      // ── Step 3. The Enter-session button starts disabled (gate
      //    closed — zero debaters present). This is the precondition
      //    the live-update flow has to overcome. ─────────────────────
      const enterButton = alicePage.getByTestId('invite-enter-session');
      await expect(enterButton).toBeDisabled();

      // ── Step 4. Ben (debater A) authenticates in his OWN context,
      //    navigates to the moderator-emitted invite URL shape, and
      //    claims his slot. We construct the URL from the session id +
      //    role hint rather than scraping it from alice's view — the
      //    sibling `participant-invite-acceptance.spec.ts` uses the
      //    same construction at lines 168 + 216. Reading the input
      //    value would also work, but constructing is more robust to
      //    a future testid rename. ───────────────────────────────────
      await benPage.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
      await expect(benPage.getByTestId('route-invite-acceptance')).toBeVisible({
        timeout: 15_000,
      });
      await benPage.getByTestId('invite-acceptance-join-button').click();
      await benPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });
      await expect(benPage.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });
      // Ben sees himself in the participants list.
      await expect(benPage.getByTestId('lobby-participant-debater-A-name')).toHaveText('ben', {
        timeout: 15_000,
      });

      // ── Step 5. Maria (debater B) does the same in her own context. ─
      await mariaPage.goto(`/p/sessions/${sessionId}/invite?role=debater-B`);
      await expect(mariaPage.getByTestId('route-invite-acceptance')).toBeVisible({
        timeout: 15_000,
      });
      await mariaPage.getByTestId('invite-acceptance-join-button').click();
      await mariaPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });
      await expect(mariaPage.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });
      // Maria sees BOTH debaters in her lobby (her own debater-B row
      // plus ben's debater-A row already present at her arrival).
      await expect(mariaPage.getByTestId('lobby-participant-debater-A-name')).toHaveText('ben', {
        timeout: 15_000,
      });
      await expect(mariaPage.getByTestId('lobby-participant-debater-B-name')).toHaveText('maria', {
        timeout: 15_000,
      });

      // ── Step 6. Back in Alice's context — the moderator's lobby
      //    view observes both debaters arrive via live WS events. Poll
      //    until the gate opens (the Enter button enables). 15s budget
      //    mirrors the participant-lobby spec's `expect.poll` budget
      //    for WS propagation under a slow CI runner — covers the
      //    round-trip from maria's claim POST → server event broadcast
      //    → alice's WS client `applyEvent` → store re-derive → button
      //    `disabled` flip. Playwright's `toBeEnabled` polls with
      //    exponential retry up to the declared timeout, so this is
      //    the idiomatic shape (no explicit `expect.poll` needed). ──
      await expect(enterButton).toBeEnabled({ timeout: 15_000 });
      // Belt-and-suspenders: the "both ready" banner is the explicit
      // visual cue the refinement (Decision §4) ties to the open gate.
      await expect(alicePage.getByTestId('invite-both-ready-banner')).toBeVisible({
        timeout: 15_000,
      });

      // ── Step 7. Alice clicks Enter-session → navigates to the
      //    operate canvas. This IS the start-the-debate gesture per
      //    `mod_session_lobby` — no backend state transition required;
      //    the navigation is the signal. ──────────────────────────────
      await enterButton.click();
      await alicePage.waitForURL((url) => url.pathname === `/m/sessions/${sessionId}/operate`, {
        timeout: 15_000,
      });
      await expect(alicePage.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
      // Don't assert anything specific about the operate canvas content
      // — M4 work pending. The URL + route testid prove the moderator
      // surface advanced to the operate stage.

      // ── Step 8. Ben + maria auto-navigate from their lobbies to the
      //    operate route — the coupling the original test guarded
      //    against has since become the intended behavior. Per
      //    `part_session_start_handoff_dedicated_event` (refinement
      //    `tasks/refinements/participant-ui/part_session_start_handoff_dedicated_event.md`,
      //    commit `d8d8d26`), alice's Enter click awaits
      //    `POST /api/sessions/:id/start` which emits a
      //    `session-mode-changed` event with `new_mode === 'operate'`;
      //    each participant lobby's `useEffect` watches for that
      //    event and `replace`-navigates to `/p/sessions/${id}` so the
      //    debater is already on the operate route when the first
      //    propose lands. This assertion now pins the auto-handoff
      //    contract end-to-end across three real browser contexts. ──
      await benPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
        timeout: 15_000,
      });
      await mariaPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
        timeout: 15_000,
      });
    } finally {
      await mariaContext.close();
      await benContext.close();
      await aliceContext.close();
    }
  });
});
