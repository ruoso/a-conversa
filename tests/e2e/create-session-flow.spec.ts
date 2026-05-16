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
// `POST /api/sessions` was API-only and required `curl` to drive. The
// happy-path scenario closes that gap.
//
// Two scenarios:
//
//   1. happy path — alice logs in, navigates to /m/sessions/new,
//      fills a topic + selects private, submits, waits for the URL to
//      settle on /m/sessions/<uuid>/invite (was /operate before
//      `mod_invite_participants` amended the post-201 navigation).
//      The deeper graph-canvas-mounted assertion moved to
//      `invite-participants-flow.spec.ts`, which drives the chain all
//      the way through the "Enter session" click.
//   2. button-disabled-on-empty invariant — alice logs in, navigates
//      to /sessions/new, types whitespace only, asserts the submit
//      button is disabled (trimmed-length-zero rule).
//
// **Locale matrix.** This spec runs in en-US only — the cross-locale
// title / button text matrix is covered by the catalog-level parity
// check; the whole-flow chain is locale-independent and too expensive
// to run 3x.

import { expect, test } from '@playwright/test';

import { loginAs } from './fixtures/auth';

const TEST_USERNAME = 'alice';

test.describe('Create-session flow — moderator creates a session and lands on the invite view', () => {
  test('alice logs in, navigates to /m/sessions/new, submits topic + private privacy, lands on /m/sessions/<id>/invite (the invite-participants view)', async ({
    page,
  }) => {
    // 1. Login. After this, the page context's cookie jar carries
    //    `aconversa-session`; subsequent navigations inherit it.
    await loginAs(page, { username: TEST_USERNAME });

    // 2. Navigate to the form route. The route is gated by
    //    `<RequireAuth mode="authenticated-only">`; the gate sees the
    //    cookie-bearing /api/auth/me 200 response and renders children.
    await page.goto('/m/sessions/new');
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

    // 5. Submit. The form POSTs /api/sessions, the backend handler
    //    returns 201 with `{ id, ... }`, and the form calls `useNavigate`
    //    onto /m/sessions/<id>/invite (the invite-participants view —
    //    was /operate before `mod_invite_participants` amended the
    //    post-201 navigation target).
    await page.getByTestId('create-session-submit').click();

    // 6. Wait for the navigation to settle. The session id is the
    //    server-generated UUID we don't know in advance; match the URL
    //    pattern (lowercase hex + hyphens per RFC 4122 stringification).
    await page.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });

    // 7. Assert the invite route mounted. The deeper graph-canvas
    //    assertion moved to `invite-participants-flow.spec.ts` (which
    //    drives the chain through "Enter session" all the way to the
    //    operate route); here we cap the spec at the new post-create
    //    landing surface.
    await expect(page.getByTestId('route-invite-participants')).toBeVisible();
  });

  test('client-side validation: empty (whitespace-only) topic leaves the submit button disabled', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/m/sessions/new');

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
