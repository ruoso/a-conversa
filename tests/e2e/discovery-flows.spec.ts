// Discovery cross-surface journeys e2e (session_discovery.sd_e2e, refinement
// `tasks/refinements/session_discovery/sd_e2e.md`). The whole assembled
// discovery feature driven against the live compose stack with the seeded user
// pool — the journeys no single-page spec can reach because they need MULTIPLE
// authenticated contexts (`alice` + `ben`) for the role matrix and cross-surface
// navigation off a list row.
//
// Scope boundary (D5): this spec owns exactly what `my-sessions-page.spec.ts` /
// `public-sessions-page.spec.ts` cannot — the multi-user role matrix
// (host→`/m`, debater→`/p`), the anonymous join-live→`/a` leg, the
// see-replay→`/a/replay` leg, the private-session absence from the public list,
// and the FUNCTIONAL (not merely present) date-filter + pagination walk. It does
// NOT re-assert auth-bounce, host-badge-render, landing reachability, or the
// single-page lobby-secrecy check — those are already green in the page specs.
//
// Seeding is through the REAL flow (Constraint 2 / D2): sessions via
// `POST /api/sessions`, lifecycle via `/start` + `/end`, debater slots via
// `POST /api/sessions/:id/invite/claim` from the claimant's own authed context —
// so the `role` the `/mine` endpoint annotates is real, not hand-stamped. Every
// seeded topic carries a unique `randomUUID().slice(0, 8)` token so a search
// narrows to exactly this run's rows (keeps the suite parallel-safe).
//
// Destinations are asserted by `URL.pathname` (D3): the point of this task is
// routing correctness — the right role lands on the right surface prefix — not
// re-testing each surface's internals, which their own specs own. A single
// stable surface marker is asserted only where one exists (`route-operate`).
//
// ADRs: 0008 (Playwright, multi-context first-class), 0017 (dev Authelia OIDC),
//       0026 (micro-frontend root dispatch), 0029 (anonymous public access),
//       0040 (axe WCAG A/AA), 0022 (no throwaway verifications),
//       0045 (audience replay visibility gating).

import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';

import type { APIRequestContext } from '@playwright/test';

import { expect, test, type Browser, type Locator, type Page } from './fixtures/no-scrollbars';
import { authedContext } from './fixtures/authed-context';

const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

// `DEFAULT_PAGE_SIZE` rows per page (apps/root/src/discovery/SessionList.tsx).
// One past a page forces a second page in the pagination walk (AC 6).
const PAGE_SIZE = 20;

/** A fresh search token scoping one test's seeded rows. */
function token(): string {
  return randomUUID().slice(0, 8);
}

async function createSession(
  request: APIRequestContext,
  opts: { topic: string; privacy: 'public' | 'private' },
): Promise<string> {
  const response = await request.post('/api/sessions', {
    data: { topic: opts.topic, privacy: opts.privacy },
  });
  expect(response.status(), 'createSession: POST /api/sessions must return 201').toBe(201);
  const body = (await response.json()) as { id: string };
  expect(body.id, 'createSession: response body must carry a string id').toBeTruthy();
  return body.id;
}

async function startSession(request: APIRequestContext, sessionId: string): Promise<void> {
  const response = await request.post(`/api/sessions/${sessionId}/start`);
  expect(response.status(), 'startSession: POST /api/sessions/:id/start must return 200').toBe(200);
}

async function endSession(request: APIRequestContext, sessionId: string): Promise<void> {
  const response = await request.post(`/api/sessions/${sessionId}/end`);
  expect(response.status(), 'endSession: POST /api/sessions/:id/end must return 200').toBe(200);
}

/**
 * Self-claim a debater slot through the production claim path (the same
 * `POST /api/sessions/:id/invite/claim` the InviteAcceptance route fires), so
 * the `session_participants` row — and the role `/mine` annotates — is real.
 */
async function claimDebater(
  request: APIRequestContext,
  sessionId: string,
  role: 'debater-A' | 'debater-B',
): Promise<void> {
  const response = await request.post(`/api/sessions/${sessionId}/invite/claim`, {
    data: { role },
  });
  expect(response.status(), 'claimDebater: POST /invite/claim must return 200').toBe(200);
}

/** The `session-list-row` whose visible text contains the given topic. */
function rowByTopic(scope: Page | Locator, topic: string): Locator {
  return scope.getByTestId('session-list-row').filter({ hasText: topic });
}

/** Open the authenticated My Sessions page (default `alice` jar) and narrow to a token. */
async function openMineSearched(page: Page, searchToken: string): Promise<void> {
  await page.goto('/sessions/mine');
  await expect(page.getByTestId('route-my-sessions')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('session-list-search').fill(searchToken);
}

/** Open the anonymous Public Sessions page and narrow to a token. */
async function openPublicSearched(page: Page, searchToken: string): Promise<void> {
  await page.goto('/sessions');
  await expect(page.getByTestId('route-public-sessions')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('session-list-search').fill(searchToken);
}

/** A cookie-free context so the project's default `alice` jar does not leak in (Constraint 7). */
async function anonContext(browser: Browser): ReturnType<Browser['newContext']> {
  return browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
  });
}

/** A `yyyy-mm-dd` day `offsetDays` from now, for the date-filter inputs. */
function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

test.describe('discovery cross-surface flows', () => {
  test('AC1 — My Sessions role matrix: host row → /m, debater row → /p (started)', async ({
    page,
    browser,
  }) => {
    const t = token();
    const hostTopic = `Host started ${t}`;
    const debTopic = `Debater started ${t}`;

    // alice hosts + starts her own session.
    const hostId = await createSession(page.request, { topic: hostTopic, privacy: 'public' });
    await startSession(page.request, hostId);

    // ben hosts a session, alice self-claims debater-A, ben starts it.
    const benCtx = await authedContext(browser, 'ben');
    try {
      const debId = await createSession(benCtx.request, { topic: debTopic, privacy: 'public' });
      await claimDebater(page.request, debId, 'debater-A');
      await startSession(benCtx.request, debId);

      await openMineSearched(page, t);

      const hostRow = rowByTopic(page, hostTopic);
      const debRow = rowByTopic(page, debTopic);
      await expect(hostRow).toBeVisible({ timeout: 15_000 });
      await expect(debRow).toBeVisible();
      await expect(hostRow.getByTestId('session-role-badge')).toHaveAttribute('data-role', 'host');
      await expect(debRow.getByTestId('session-role-badge')).toHaveAttribute(
        'data-role',
        'debater',
      );

      // Host row → moderator operate surface (started host cell of the matrix).
      await hostRow.getByTestId('session-join-live-link').click();
      await page.waitForURL((url) => url.pathname === `/m/sessions/${hostId}/operate`, {
        timeout: 30_000,
      });
      await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 30_000 });

      // Debater row → participant live surface (started debater cell of the matrix).
      await openMineSearched(page, t);
      await rowByTopic(page, debTopic).getByTestId('session-join-live-link').click();
      await page.waitForURL((url) => url.pathname === `/p/sessions/${debId}`, { timeout: 30_000 });
    } finally {
      await benCtx.close();
    }
  });

  test('AC2 — lobby-mode join-live: host row → /m/.../lobby, debater row → /p/.../lobby', async ({
    page,
    browser,
  }) => {
    const t = token();
    const hostTopic = `Host lobby ${t}`;
    const debTopic = `Debater lobby ${t}`;

    // alice hosts an UNSTARTED session (lobby).
    const hostId = await createSession(page.request, { topic: hostTopic, privacy: 'public' });

    const benCtx = await authedContext(browser, 'ben');
    try {
      // ben hosts an UNSTARTED session, alice self-claims debater-A in it.
      const debId = await createSession(benCtx.request, { topic: debTopic, privacy: 'public' });
      await claimDebater(page.request, debId, 'debater-A');

      await openMineSearched(page, t);
      await expect(rowByTopic(page, hostTopic)).toBeVisible({ timeout: 15_000 });

      await rowByTopic(page, hostTopic).getByTestId('session-join-live-link').click();
      await page.waitForURL((url) => url.pathname === `/m/sessions/${hostId}/lobby`, {
        timeout: 30_000,
      });

      await openMineSearched(page, t);
      await rowByTopic(page, debTopic).getByTestId('session-join-live-link').click();
      await page.waitForURL((url) => url.pathname === `/p/sessions/${debId}/lobby`, {
        timeout: 30_000,
      });
    } finally {
      await benCtx.close();
    }
  });

  test('AC3 — public list lobby-secrecy + privacy gating', async ({ page, browser }) => {
    const t = token();
    const pubStartedTopic = `Public started ${t}`;
    const pubLobbyTopic = `Public lobby ${t}`;
    const privStartedTopic = `Private started ${t}`;

    // Seeded by alice (default jar): one visible row + two that must be absent.
    const pubStartedId = await createSession(page.request, {
      topic: pubStartedTopic,
      privacy: 'public',
    });
    await startSession(page.request, pubStartedId);
    await createSession(page.request, { topic: pubLobbyTopic, privacy: 'public' }); // never started
    const privId = await createSession(page.request, {
      topic: privStartedTopic,
      privacy: 'private',
    });
    await startSession(page.request, privId);

    const ctx = await anonContext(browser);
    try {
      const anonPage = await ctx.newPage();
      await openPublicSearched(anonPage, t);

      // The started public row is shown; the lobby public row and the private
      // started row are absent (`toHaveCount(0)` — absence, not off-screen).
      await expect(anonPage.getByText(pubStartedTopic)).toBeVisible({ timeout: 15_000 });
      await expect(anonPage.getByText(pubLobbyTopic)).toHaveCount(0);
      await expect(anonPage.getByText(privStartedTopic)).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('AC4 — signed-out join-live on a public row → /a', async ({ page, browser }) => {
    const t = token();
    const topic = `Public joinable ${t}`;

    const id = await createSession(page.request, { topic, privacy: 'public' });
    await startSession(page.request, id);

    const ctx = await anonContext(browser);
    try {
      const anonPage = await ctx.newPage();
      await openPublicSearched(anonPage, t);

      const row = rowByTopic(anonPage, topic);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByTestId('session-join-live-link').click();
      await anonPage.waitForURL((url) => url.pathname === `/a/sessions/${id}`, { timeout: 30_000 });
    } finally {
      await ctx.close();
    }
  });

  test('AC5 — see-replay → /a/replay, and present on the public list', async ({
    page,
    browser,
  }) => {
    const t = token();
    const topic = `Ended replay ${t}`;

    // create → start → end, a public ended session.
    const id = await createSession(page.request, { topic, privacy: 'public' });
    await startSession(page.request, id);
    await endSession(page.request, id);

    // On /sessions/mine: see-replay present, NO join-live, click → /a/replay/:id.
    await openMineSearched(page, t);
    const mineRow = rowByTopic(page, topic);
    await expect(mineRow).toBeVisible({ timeout: 15_000 });
    await expect(mineRow.getByTestId('session-see-replay-link')).toBeVisible();
    await expect(mineRow.getByTestId('session-join-live-link')).toHaveCount(0);

    await mineRow.getByTestId('session-see-replay-link').click();
    await page.waitForURL((url) => url.pathname === `/a/replay/${id}`, { timeout: 30_000 });

    // The same ended-row affordance is present on the anonymous public list
    // (ended public sessions have `started_at IS NOT NULL`, so they appear).
    const ctx = await anonContext(browser);
    try {
      const anonPage = await ctx.newPage();
      await openPublicSearched(anonPage, t);
      const pubRow = rowByTopic(anonPage, topic);
      await expect(pubRow).toBeVisible({ timeout: 15_000 });
      await expect(pubRow.getByTestId('session-see-replay-link')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('AC6a — date filter narrows to started, excludes lobby (note appears)', async ({ page }) => {
    const t = token();
    const startedTopic = `Filter started ${t}`;
    const lobbyTopic = `Filter lobby ${t}`;

    const startedId = await createSession(page.request, { topic: startedTopic, privacy: 'public' });
    await startSession(page.request, startedId);
    await createSession(page.request, { topic: lobbyTopic, privacy: 'public' }); // NULL started_at

    await openMineSearched(page, t);
    await expect(rowByTopic(page, startedTopic)).toBeVisible({ timeout: 15_000 });
    await expect(rowByTopic(page, lobbyTopic)).toBeVisible();

    // A range bracketing "now" (UTC-tolerant): started_at falls inside it, the
    // NULL-started lobby row never satisfies the comparison and drops out.
    await page.getByTestId('session-list-from').fill(isoDay(-1));
    await page.getByTestId('session-list-to').fill(isoDay(1));

    await expect(rowByTopic(page, lobbyTopic)).toHaveCount(0, { timeout: 15_000 });
    await expect(rowByTopic(page, startedTopic)).toBeVisible();
    await expect(page.getByTestId('session-list-lobby-note')).toBeVisible();
  });

  test('AC6b — pagination walk advances and returns', async ({ page }) => {
    const t = token();
    // One past a full page forces a second page. Lobby sessions suffice — /mine
    // returns the caller's lobby rows, so no per-session start is needed.
    const total = PAGE_SIZE + 1;
    await Promise.all(
      Array.from({ length: total }, (_unused, i) =>
        createSession(page.request, { topic: `Page walk ${t} #${i}`, privacy: 'public' }),
      ),
    );

    await openMineSearched(page, t);
    const summary = page.getByTestId('session-list-summary');
    await expect(summary).toContainText('Showing 1', { timeout: 15_000 });
    await expect(summary).toContainText(`of ${total}`);

    // Next advances to the second page (offset reflected in the summary).
    await page.getByTestId('session-list-next').click();
    await expect(summary).toContainText(`Showing ${PAGE_SIZE + 1}`, { timeout: 15_000 });

    // Prev returns to the first page.
    await page.getByTestId('session-list-prev').click();
    await expect(summary).toContainText('Showing 1', { timeout: 15_000 });
  });

  test('AC7 — axe WCAG A/AA on a list containing an ended (see-replay) row', async ({ page }) => {
    const t = token();
    const topic = `Axe ended ${t}`;

    const id = await createSession(page.request, { topic, privacy: 'public' });
    await startSession(page.request, id);
    await endSession(page.request, id);

    await openMineSearched(page, t);
    const row = rowByTopic(page, topic);
    await expect(row).toBeVisible({ timeout: 15_000 });
    // The see-replay affordance DOM must be in scope — the one row state no
    // existing page-spec axe run covers (both seed only started/lobby rows).
    await expect(row.getByTestId('session-see-replay-link')).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags([...WCAG_AA_TAGS]).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`);
    expect(summary).toEqual([]);
  });
});
