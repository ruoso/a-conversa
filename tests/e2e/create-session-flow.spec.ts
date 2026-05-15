// End-to-end create-session flow — drives the full auth + form + POST +
// navigation + canvas-mount chain for a moderator creating a new session.
//
// Refinement: tasks/refinements/moderator-ui/mod_create_session_form.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: moderator_ui.mod_session_setup.mod_create_session_form
//
// **What this spec pins.** Per ORCHESTRATOR.md 28a71f9, the UI stream is
// gated on Playwright passing in compose; the whole-flow scenario below
// is the regression-class proof that the moderator stack (auth → form →
// POST → navigation → canvas mount) holds end-to-end. Before this lands
// the moderator console was half-built from the user's perspective —
// `POST /sessions` was API-only and required `curl` to drive. The
// happy-path scenario closes that gap.
//
// Two scenarios:
//
//   1. happy path — alice logs in, navigates to /sessions/new/setup,
//      fills a topic + selects private, submits, waits for the URL to
//      settle on /sessions/<uuid>/operate, asserts the graph canvas
//      mounted.
//   2. button-disabled-on-empty invariant — alice logs in, navigates
//      to /sessions/new/setup, types whitespace only, asserts the
//      submit button is disabled (trimmed-length-zero rule).
//
// **Why `/sessions/new/setup` and not `/sessions/new`.** The Fastify
// `GET /sessions/:id` API route matches `/sessions/new` (2-segment
// path) and returns 400 `validation-failed` because `new` is not a
// UUID. The 4xx fires BEFORE the static-frontends not-found handler's
// SPA fallback can run, so the SPA never mounts on `/sessions/new`.
// A 3-segment path has no registered backend route, lands on the
// SPA-fallback 404 handler with an HTML accept, and serves `index.html`.
//
// **Locale matrix.** This spec runs in en-US only — the cross-locale
// title / button text matrix is covered by the catalog-level parity
// check; the whole-flow chain is locale-independent and too expensive
// to run 3x.

import { expect, test } from '@playwright/test';

import { loginAs } from './fixtures/auth';

const TEST_USERNAME = 'alice';

test.describe('Create-session flow — moderator creates a session and lands on the operate canvas', () => {
  test('alice logs in, navigates to /sessions/new, submits topic + private privacy, lands on /sessions/<id>/operate with the canvas mounted', async ({
    page,
  }) => {
    // 1. Login. After this, the page context's cookie jar carries
    //    `aconversa-session`; subsequent navigations inherit it.
    await loginAs(page, { username: TEST_USERNAME });

    // 2. Navigate to the form route. The route is gated by
    //    `<RequireAuth mode="authenticated-only">`; the gate sees the
    //    cookie-bearing /auth/me 200 response and renders children.
    await page.goto('/sessions/new/setup');
    await expect(page.getByTestId('route-create-session')).toBeVisible();
    await expect(page.getByTestId('route-title')).toHaveText('Create a session');

    // 3. Fill the topic.
    const topic = 'Should universal basic income replace existing welfare programs?';
    await page.getByTestId('create-session-topic-input').fill(topic);

    // 4. Select private (exercising the non-default path so the POST
    //    body carries `privacy: 'private'` rather than the default
    //    `'public'`).
    await page.getByTestId('create-session-privacy-private').click();
    await expect(page.getByTestId('create-session-privacy-private')).toBeChecked();
    await expect(page.getByTestId('create-session-privacy-public')).not.toBeChecked();

    // 5. Submit. The form POSTs /sessions, the backend handler returns
    //    201 with `{ id, ... }`, and the form calls `useNavigate` onto
    //    /sessions/<id>/operate.
    await page.getByTestId('create-session-submit').click();

    // 6. Wait for the navigation to settle. The session id is the
    //    server-generated UUID we don't know in advance; match the URL
    //    pattern (lowercase hex + hyphens per RFC 4122 stringification).
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });

    // 7. Assert the operate route mounted AND the graph canvas root is
    //    visible. This is the load-bearing assertion for the whole-
    //    flow chain — if the form-to-operate seam regresses, this
    //    fails loudly.
    await expect(page.getByTestId('route-operate')).toBeVisible();
    await expect(page.getByTestId('graph-canvas-root')).toBeVisible();
  });

  test('client-side validation: empty (whitespace-only) topic leaves the submit button disabled', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new/setup');

    // The submit button is disabled by default (empty topic). Type
    // whitespace only — the trim-then-length-zero rule keeps it
    // disabled. This pins the "no empty POSTs even via clever typing"
    // invariant directly at the UI boundary.
    await expect(page.getByTestId('create-session-submit')).toBeDisabled();
    await page.getByTestId('create-session-topic-input').fill('   ');
    await expect(page.getByTestId('create-session-submit')).toBeDisabled();

    // Typing a real character flips it to enabled (sanity).
    await page.getByTestId('create-session-topic-input').fill('non-empty');
    await expect(page.getByTestId('create-session-submit')).toBeEnabled();
  });
});
