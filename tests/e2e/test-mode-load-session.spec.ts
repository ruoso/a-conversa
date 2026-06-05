// End-to-end spec for the test-mode session-log route.
//
// Refinement: tasks/refinements/replay_test/test_mode_load_session.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
// TaskJuggler: replay_test.test_mode.test_mode_load_session
//
// **What this spec pins.** The `/t/sessions/:sessionId` route, the
// shell's `useSessionEventLog` paging fetch, and the real REST endpoint
// `GET /api/sessions/:id/events` line up end to end through the mounted
// test-mode surface:
//
//   (a) a freshly-minted session loads to the `ready` state, which now
//       mounts the timeline scrubber surface (`test_mode_timeline_scrubber`
//       superseded the former inert readout in place) — the surface → real
//       REST fetch → real backend wiring proof. `POST /api/sessions`
//       atomically persists two creation events (`session-created` at
//       sequence 1, `participant-joined` at sequence 2 — the implicit
//       host/moderator join), so a brand-new session's persisted log is
//       never empty: the scrubber, not the empty-log affordance, is the
//       real-backend outcome;
//   (b) a random unused session id renders the `not-found` affordance —
//       the 404 path (the backend returns the same 404 for unknown and
//       invisible sessions).
//
// The empty-log affordance, the rich multi-page paging loop, and the
// scrubber's stepping behaviour are pinned deterministically by the Vitest
// hook + view + scrubber-component tests (the empty-ready state is in fact
// unreachable for a real session, since creation always persists the two
// events above); the live scrubber + snapshot-jump flow is pinned by
// `test-mode-scrubber.spec.ts`. Decision §6.
//
// **Auth.** The `chromium-test-mode-load-session` project depends on the
// shared `setup-auth` project, so the context already carries the
// `aconversa-session` cookie before the first navigation; the spec does
// not drive its own OIDC dance.

import { expect, test, type Page } from './fixtures/no-scrollbars';

// A deterministic UUID that no `POST /api/sessions` will mint — the
// not-found path's input.
const UNUSED_SESSION_ID = '00000000-0000-4000-8000-0000000000ff';

/**
 * Mint a session via the same-origin API (what `<CreateSessionRoute>`
 * does under the hood). The authenticated `setup-auth` caller becomes
 * the host; a freshly-created session has an empty persisted event log.
 */
async function createSession(page: Page): Promise<string> {
  const response = await page.request.post('/api/sessions', {
    data: { topic: 'Test-mode load-session e2e', privacy: 'private' },
  });
  expect(response.status(), 'createSession: POST /api/sessions must return 201').toBe(201);
  const body = (await response.json()) as { id: string };
  expect(body.id, 'createSession: response body must carry a string id').toBeTruthy();
  return body.id;
}

test.describe('Test-mode session log — /t/sessions/:id loads the persisted log', () => {
  test('a freshly-minted session reaches the ready scrubber surface', async ({ page }) => {
    const sessionId = await createSession(page);

    await page.goto(`/t/sessions/${sessionId}`);

    // Real surface → `useSessionEventLog` → `GET /api/sessions/:id/events`
    // → real backend returns the two creation events → the `ready` state
    // mounts the timeline scrubber. This is the surface → real REST fetch →
    // real backend wiring proof.
    await expect(
      page.getByTestId('test-mode-scrubber'),
      'a new session loads its persisted creation events → the ready scrubber surface',
    ).toBeVisible({ timeout: 15_000 });

    // The host-create transaction persists two events (`session-created` at
    // sequence 1, `participant-joined` at sequence 2), so the head sequence
    // is 2 and the scrubber opens at that head position.
    await expect(page.getByTestId('test-mode-scrubber-range')).toHaveAttribute('max', '2');
    await expect(page.getByTestId('test-mode-scrubber-status')).toHaveAttribute(
      'data-position',
      '2',
    );
  });

  test('a random unused session id reaches the not-found affordance', async ({ page }) => {
    await page.goto(`/t/sessions/${UNUSED_SESSION_ID}`);

    // The endpoint 404s for unknown-or-invisible sessions; the hook maps
    // that to `not-found`, distinct from the retry-able error state.
    await expect(
      page.getByTestId('test-mode-session-log-not-found'),
      'an unknown session id → the not-found affordance',
    ).toBeVisible({ timeout: 15_000 });
  });
});
