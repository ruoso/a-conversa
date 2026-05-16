// End-to-end invite-participants flow — drives the moderator from the
// create-session form through the new invite view, asserts the moderator
// slot pre-fill, exercises the copy-link clipboard path, and clicks
// "Enter session" to land on the operate canvas.
//
// Refinement: tasks/refinements/moderator-ui/mod_invite_participants.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: moderator_ui.mod_session_setup.mod_invite_participants
//
// **What this spec pins.** Per ORCHESTRATOR.md 28a71f9, the UI stream is
// gated on Playwright passing in compose. This is the regression-class
// proof of the create-session → invite-view → enter-session chain after
// `mod_invite_participants` amends the post-201 navigation target from
// `/operate` to `/invite`.
//
// **Two scenarios:**
//
//   1. happy path — alice logs in, creates a session, lands on the
//      invite view, sees the moderator slot pre-filled with "alice"
//      and both debater slots empty, copies the Debater A link,
//      verifies the clipboard contents match the expected URL shape,
//      clicks "Enter session", lands on /sessions/<id>/operate with
//      the graph canvas mounted.
//   2. URL-shape — alice creates a session, the Debater A invite link
//      input value matches the expected URL pattern. A pure URL-shape
//      assertion split from the happy-path so a regression in the link
//      shape fails distinctly from a regression in clipboard or
//      navigation.
//
// **Locale matrix.** en-US only — the cross-locale title/button text is
// covered at the catalog parity layer; the whole-flow chain is
// locale-independent and too expensive to run 3x.

import { expect, test } from '@playwright/test';

import { loginAs } from './fixtures/auth';

const TEST_USERNAME = 'alice';

test.describe('Invite-participants flow — moderator creates a session, lands on the invite view, copies a debater link, enters the operate canvas', () => {
  test('alice creates a session, sees the invite view with moderator pre-filled and debaters empty, copies a link, enters the operate canvas', async ({
    page,
    context,
  }) => {
    // Grant clipboard permissions for the test origin so
    // `navigator.clipboard.writeText` and `readText` work in chromium.
    // Playwright's documented path for clipboard testing — see the
    // refinement's "Clipboard API + Playwright" section.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // 1. Login. Cookie jar now carries `aconversa-session`.
    await loginAs(page, { username: TEST_USERNAME });

    // 2. Create a session via the form route.
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();
    const topic = 'Should universal basic income replace existing welfare programs?';
    await page.getByTestId('create-session-topic-input').fill(topic);
    await page.getByTestId('create-session-submit').click();

    // 3. URL settles on the invite view (NOT the operate canvas — that
    //    was the pre-`mod_invite_participants` behavior; this spec is
    //    the regression for the amendment).
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-invite-participants')).toBeVisible();
    await expect(page.getByTestId('route-title')).toHaveText('Invite participants');

    // 4. Moderator slot is pre-filled (the host-as-moderator row landed
    //    at session creation per `participant_assignment`; the WS
    //    catch-up replay populates the per-session event slice from which
    //    the view derives the moderator's screen name).
    const moderatorOccupant = page.locator(
      '[data-testid="invite-slot-occupant"][data-role="moderator"]',
    );
    await expect(moderatorOccupant).toHaveText(TEST_USERNAME, { timeout: 10_000 });

    // 5. Both debater slots render the empty-state caption.
    await expect(
      page.locator('[data-testid="invite-slot-empty"][data-role="debater-A"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="invite-slot-empty"][data-role="debater-B"]'),
    ).toBeVisible();

    // 6. Click the copy-link button for Debater A.
    await page.locator('[data-testid="invite-link-copy"][data-role="debater-A"]').click();
    // The transient "Copied!" confirmation appears.
    await expect(
      page.locator('[data-testid="invite-link-copied"][data-role="debater-A"]'),
    ).toBeVisible();

    // 7. Verify the clipboard carries the expected URL shape.
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toMatch(/\/sessions\/[0-9a-f-]+\/invite\?role=debater-A$/);

    // 8. Click "Enter session" → land on the operate canvas. The
    //    button is always enabled (Decision §3) so the click succeeds
    //    even though the debater slots are still empty.
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();
    await expect(page.getByTestId('graph-canvas-root')).toBeVisible();
  });

  test('the Debater A invite link input value matches <origin>/sessions/<uuid>/invite?role=debater-A', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/sessions/new');
    await page.getByTestId('create-session-topic-input').fill('URL shape sanity check');
    await page.getByTestId('create-session-submit').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });

    const linkInput = page.locator('[data-testid="invite-link-input"][data-role="debater-A"]');
    await expect(linkInput).toBeVisible();
    const inputValue = await linkInput.inputValue();
    expect(inputValue).toMatch(/\/sessions\/[0-9a-f-]+\/invite\?role=debater-A$/);
  });
});
