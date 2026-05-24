// End-to-end invite-participants flow — drives the moderator from the
// create-session form through the new invite view, asserts the moderator
// slot pre-fill, exercises the copy-link clipboard path, and clicks
// "Enter session" to land on the operate canvas. The `mod_session_lobby`
// amendment adds two scenarios that exercise the strict gate + ready
// state via the `window.__aConversaWsStore` test seam.
//
// Refinements:
//   - tasks/refinements/moderator-ui/mod_invite_participants.md
//   - tasks/refinements/moderator-ui/mod_session_lobby.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler:
//   - moderator_ui.mod_session_setup.mod_invite_participants
//   - moderator_ui.mod_session_setup.mod_session_lobby
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
//      clicks "Enter session", lands on /m/sessions/<id>/operate with
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

import { expect, test } from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';
import { seedParticipants } from './fixtures/wsStoreSeed';

const TEST_USERNAME = 'alice';

const DEBATER_A_USER_ID = '00000000-0000-4000-8000-0000000000a1';
const DEBATER_B_USER_ID = '00000000-0000-4000-8000-0000000000b1';

/**
 * Extract the session id from the current `/m/sessions/<uuid>/invite`
 * URL. The session id is required to address the per-session slice of
 * the WS store via the `seedParticipants` helper.
 */
function sessionIdFromInviteUrl(url: string): string {
  const match = url.match(/\/m\/sessions\/([0-9a-f-]+)\/invite$/);
  if (match === null) {
    throw new Error(`URL did not match the invite shape: ${url}`);
  }
  return match[1] as string;
}

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
    await page.goto('/m/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();
    const topic = 'Should universal basic income replace existing welfare programs?';
    await page.getByTestId('create-session-topic-input').fill(topic);
    await page.getByTestId('create-session-submit').click();

    // 3. URL settles on the invite view (NOT the operate canvas — that
    //    was the pre-`mod_invite_participants` behavior; this spec is
    //    the regression for the amendment).
    await page.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
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
    expect(clipboardText).toMatch(/\/p\/sessions\/[0-9a-f-]+\/invite\?role=debater-A$/);

    // 8. mod_session_lobby: the Enter-session button is strict-gated.
    //    Assert the gate state with both debaters absent: disabled,
    //    awaiting-both tooltip surfaced via `title`.
    const enterButton = page.getByTestId('invite-enter-session');
    await expect(enterButton).toBeDisabled();
    await expect(enterButton).toHaveAttribute('title', 'Awaiting both debaters');

    // 9. Seed both debaters into the WS store via the dev-only
    //    `window.__aConversaWsStore` test seam (per mod_session_lobby
    //    Decision §5 — the sibling `seedParticipants` helper). The
    //    real backend self-claim endpoint doesn't exist yet (registered
    //    as a follow-up by mod_invite_participants); the seed
    //    simulates the same `participant-joined` events the server
    //    would emit.
    const inviteUrl = page.url();
    const sessionId = sessionIdFromInviteUrl(inviteUrl);
    await seedParticipants(page, {
      sessionId,
      participants: [
        { userId: DEBATER_A_USER_ID, role: 'debater-A', screenName: 'ben' },
        { userId: DEBATER_B_USER_ID, role: 'debater-B', screenName: 'maria' },
      ],
    });

    // 10. Both ready badges flip to ready; the "both ready" banner
    //     appears; the Enter button becomes enabled.
    await expect(
      page.locator('[data-testid="invite-slot-ready"][data-role="debater-A"]'),
    ).toHaveAttribute('data-ready', 'true');
    await expect(
      page.locator('[data-testid="invite-slot-ready"][data-role="debater-B"]'),
    ).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('invite-both-ready-banner')).toBeVisible();
    await expect(enterButton).toBeEnabled();

    // 11. Click "Enter session" → land on the operate canvas.
    await enterButton.click();
    await page.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();
    await expect(page.getByTestId('graph-canvas-root')).toBeVisible();
  });

  test('the Debater A invite link input value matches <origin>/p/sessions/<uuid>/invite?role=debater-A', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/m/sessions/new');
    await page.getByTestId('create-session-topic-input').fill('URL shape sanity check');
    await page.getByTestId('create-session-submit').click();
    await page.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });

    const linkInput = page.locator('[data-testid="invite-link-input"][data-role="debater-A"]');
    await expect(linkInput).toBeVisible();
    const inputValue = await linkInput.inputValue();
    expect(inputValue).toMatch(/\/p\/sessions\/[0-9a-f-]+\/invite\?role=debater-A$/);
  });

  // mod_session_lobby — strict-gate scenario: the Enter button starts
  // disabled with an awaiting-both tooltip; seeding only debater-A
  // narrows the gate reason to awaiting-B; seeding debater-B opens
  // the gate. Drives the per-state title attribute + per-slot ready
  // badge transitions through the WS store seed.
  test('strict gate: title progresses awaiting-both → awaiting-B → ready as debaters are seeded', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/m/sessions/new');
    await page.getByTestId('create-session-topic-input').fill('Strict gate progression check.');
    await page.getByTestId('create-session-submit').click();
    await page.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-invite-participants')).toBeVisible();

    const sessionId = sessionIdFromInviteUrl(page.url());
    const enterButton = page.getByTestId('invite-enter-session');

    // Initial: zero debaters → disabled, awaiting-both.
    await expect(enterButton).toBeDisabled();
    await expect(enterButton).toHaveAttribute('title', 'Awaiting both debaters');
    await expect(
      page.locator('[data-testid="invite-slot-ready"][data-role="debater-A"]'),
    ).toHaveAttribute('data-ready', 'false');
    await expect(
      page.locator('[data-testid="invite-slot-ready"][data-role="debater-B"]'),
    ).toHaveAttribute('data-ready', 'false');

    // Seed debater-A only → still disabled, now awaiting-B.
    await seedParticipants(page, {
      sessionId,
      participants: [{ userId: DEBATER_A_USER_ID, role: 'debater-A', screenName: 'ben' }],
    });
    await expect(
      page.locator('[data-testid="invite-slot-ready"][data-role="debater-A"]'),
    ).toHaveAttribute('data-ready', 'true');
    await expect(enterButton).toBeDisabled();
    await expect(enterButton).toHaveAttribute('title', 'Awaiting Debater B');
    // The "both ready" banner is NOT visible yet.
    await expect(page.getByTestId('invite-both-ready-banner')).toHaveCount(0);

    // Seed debater-B → gate opens, banner appears.
    await seedParticipants(page, {
      sessionId,
      participants: [{ userId: DEBATER_B_USER_ID, role: 'debater-B', screenName: 'maria' }],
    });
    await expect(
      page.locator('[data-testid="invite-slot-ready"][data-role="debater-B"]'),
    ).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('invite-both-ready-banner')).toBeVisible();
    await expect(enterButton).toBeEnabled();
    await expect(enterButton).not.toHaveAttribute('title', /Awaiting/);
  });

  // mod_session_lobby — re-disable on leave: with both debaters
  // present the gate is open; emitting a `participant-left` for
  // debater-A closes the gate and hides the banner.
  test('gate re-disables and banner disappears when debater-A leaves after both joined', async ({
    page,
  }) => {
    await loginAs(page, { username: TEST_USERNAME });
    await page.goto('/m/sessions/new');
    await page.getByTestId('create-session-topic-input').fill('Re-disable on leave check.');
    await page.getByTestId('create-session-submit').click();
    await page.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });

    const sessionId = sessionIdFromInviteUrl(page.url());
    const enterButton = page.getByTestId('invite-enter-session');

    // Seed both debaters.
    await seedParticipants(page, {
      sessionId,
      participants: [
        { userId: DEBATER_A_USER_ID, role: 'debater-A', screenName: 'ben' },
        { userId: DEBATER_B_USER_ID, role: 'debater-B', screenName: 'maria' },
      ],
    });
    await expect(enterButton).toBeEnabled();
    await expect(page.getByTestId('invite-both-ready-banner')).toBeVisible();

    // Debater A leaves.
    await seedParticipants(page, {
      sessionId,
      left: [DEBATER_A_USER_ID],
    });

    // Gate closes; banner unmounts; debater-A badge goes pending; the
    // awaiting-A tooltip surfaces on the disabled button.
    await expect(enterButton).toBeDisabled();
    await expect(enterButton).toHaveAttribute('title', 'Awaiting Debater A');
    await expect(page.getByTestId('invite-both-ready-banner')).toHaveCount(0);
    await expect(
      page.locator('[data-testid="invite-slot-ready"][data-role="debater-A"]'),
    ).toHaveAttribute('data-ready', 'false');
    await expect(
      page.locator('[data-testid="invite-slot-ready"][data-role="debater-B"]'),
    ).toHaveAttribute('data-ready', 'true');
  });
});
