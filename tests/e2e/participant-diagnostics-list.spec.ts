// End-to-end Playwright spec — the participant operate-route footer
// surfaces a structural-diagnostics affordance whose toggle reports the
// active-diagnostic count and whose list renders one row per active
// diagnostic in the shared blocking-first total order.
//
// Refinement: tasks/refinements/participant-ui/part_diagnostics_list.md
//             (Acceptance §3 — e2e IS IN SCOPE: the operate footer
//             renders the affordance, so per the UI-stream e2e policy
//             this is not deferred. Mirrors
//             `moderator-diagnostic-flag-pane.spec.ts`, seeding via the
//             `__aConversaWsStore` backdoor the participant exposes — the
//             same seam `participant-pending-proposals.spec.ts` walks.)
// ADRs:
//   - docs/adr/0008-e2e-framework-playwright.md
//   - docs/adr/0017-mock-oauth-authelia-users-file.md
//   - docs/adr/0022-no-throwaway-verifications.md
//   - docs/adr/0026-micro-frontend-root-app.md
//
// **What this spec pins.** A debater reaches the operate route, two
// `fired` diagnostics (blocking `cycle` + advisory `multi-warrant`) are
// injected via `applyDiagnostic`, and:
//
//   1. the footer toggle reports `data-count="2"`;
//   2. opening the list renders two `participant-diagnostic-row`s in
//      blocking-first order with the right `data-diagnostic-kind` /
//      `-severity` seams;
//   3. an empty session shows the toggle quiet at `data-count="0"` and a
//      single empty message when opened.
//
// **Single locale (en-US).** Cross-locale chrome resolution is pinned at
// the catalog layer (`participant-diagnostics.test.ts`) + the component
// layer (`ParticipantDiagnosticsList.test.tsx`); this spec asserts the
// structural seams, which are locale-independent. Uses the unraced
// `nora` + `oscar` pair from the dev pool.

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';
import { applyDiagnostic } from './fixtures/wsStoreSeed';

const NODE_A = 'node-a';
const NODE_B = 'node-b';
const NODE_C = 'node-c';

async function createSession(page: Page, topic: string): Promise<string> {
  const response = await page.request.post('/api/sessions', {
    data: { topic, privacy: 'public' },
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

/**
 * Drive the create-session (as `nora`) → join-as-debater (`oscar`) →
 * operate chain, returning the page on the live operate route and the
 * sessionId for the follow-on `applyDiagnostic` calls. Mirrors the
 * navigation `participant-pending-proposals.spec.ts` establishes.
 */
async function reachDebaterOperate(
  browser: Browser,
  topic: string,
): Promise<{ page: Page; sessionId: string }> {
  const context = await freshContext(browser);
  const page = await context.newPage();

  const nora = await loginAs(page, { username: 'nora' });
  expect(nora.screenName.toLowerCase()).toBe('nora');
  const sessionId = await createSession(page, topic);

  await logoutAndClearAllCookies(page);

  const oscar = await loginAs(page, { username: 'oscar' });
  expect(oscar.screenName.toLowerCase()).toBe('oscar');
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

  return { page, sessionId };
}

test.describe('Participant operate footer — structural-diagnostics list', () => {
  test('two diagnostics seeded → toggle reports count 2, list renders two rows blocking-first', async ({
    browser,
  }) => {
    const { page, sessionId } = await reachDebaterOperate(
      browser,
      'Participant diagnostics list — populated inventory',
    );

    const toggle = page.getByTestId('participant-diagnostics-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('data-count', '0');

    // Advisory lands first (lower sequence) — the blocking cycle must
    // still take the top slot in the rendered list.
    await applyDiagnostic(page, {
      sessionId,
      kind: 'multi-warrant',
      severity: 'advisory',
      status: 'fired',
      sequence: 10,
      diagnostic: {
        kind: 'multi-warrant',
        dataNodeId: NODE_A,
        claimNodeId: NODE_B,
        warrantNodeIds: [NODE_C],
      },
    });
    await applyDiagnostic(page, {
      sessionId,
      kind: 'cycle',
      severity: 'blocking',
      status: 'fired',
      sequence: 20,
      diagnostic: { kind: 'cycle', nodes: [NODE_A, NODE_B, NODE_C] },
    });

    await expect(toggle).toHaveAttribute('data-count', '2');
    await expect(toggle).toHaveAttribute('data-tone', 'blocking');

    // Open the list.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const list = page.getByTestId('participant-diagnostic-list');
    await expect(list).toBeVisible();

    const rows = list.getByTestId('participant-diagnostic-row');
    await expect(rows).toHaveCount(2);

    const firstRow = rows.nth(0);
    await expect(firstRow).toHaveAttribute('data-diagnostic-kind', 'cycle');
    await expect(firstRow).toHaveAttribute('data-diagnostic-severity', 'blocking');

    const secondRow = rows.nth(1);
    await expect(secondRow).toHaveAttribute('data-diagnostic-kind', 'multi-warrant');
    await expect(secondRow).toHaveAttribute('data-diagnostic-severity', 'advisory');

    await page.close();
  });

  test('no diagnostics seeded → toggle quiet at count 0, single empty message when opened', async ({
    browser,
  }) => {
    const { page } = await reachDebaterOperate(
      browser,
      'Participant diagnostics list — empty inventory',
    );

    const toggle = page.getByTestId('participant-diagnostics-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('data-count', '0');
    await expect(toggle).toHaveAttribute('data-tone', 'quiet');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('participant-diagnostic-empty')).toBeVisible();
    await expect(page.getByTestId('participant-diagnostic-row')).toHaveCount(0);

    await page.close();
  });
});
