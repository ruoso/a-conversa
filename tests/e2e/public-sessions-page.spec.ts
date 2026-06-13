// End-to-end spec for the anonymous Public Sessions page
// (session_discovery.sd_frontend.sd_public_sessions_page).
//
// Refinement: tasks/refinements/session_discovery/sd_public_sessions_page.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0026-micro-frontend-root-app.md
//              docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md
//              docs/adr/0040-automated-accessibility-checks-axe-playwright.md
//              docs/adr/0022-no-throwaway-verifications.md
//
// **What this spec pins (D8 — the page pays its own reachability +
// lobby-secrecy debt; the cross-surface journeys stay in `sd_e2e`):**
//
//   1. The landing page surfaces a "Public sessions" link that
//      navigates an anonymous visitor to `/sessions`.
//   2. The route lists a seeded already-STARTED public session.
//   3. **Lobby-secrecy UI pin:** a seeded UNSTARTED public session — one
//      whose topic matches the same search token — does NOT appear. The
//      load-bearing constraint, observed at the UI layer: the page never
//      surfaces a lobby (unstarted) public session whose id is still its
//      join secret.
//   4. Topic search narrows the list; a no-match search shows the empty
//      state; the pagination control is present.
//   5. axe reports no WCAG 2.0/2.1 A/AA violations on the rendered page.
//
// **Seeding.** A started public session is created via the same-origin
// API as the host (alice): `POST /api/sessions` (lobby) then
// `POST /api/sessions/:id/start` (the lobby→operate transition that
// stamps `sessions.started_at`, making it eligible for the public list).
// An unstarted one is created but never started. The browse itself runs
// in a fresh ANONYMOUS context (no cookie) — the page is auth-free.

import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';

import type { APIRequestContext } from '@playwright/test';

import { expect, test, type Browser } from './fixtures/no-scrollbars';

import { authedContext } from './fixtures/authed-context';

const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

/** Create a session via the same-origin API; returns its id (201 → { id }). */
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

/** Advance a session out of the lobby (stamps `started_at`); host-only. */
async function startSession(request: APIRequestContext, sessionId: string): Promise<void> {
  const response = await request.post(`/api/sessions/${sessionId}/start`);
  expect(response.status(), 'startSession: POST /api/sessions/:id/start must return 200').toBe(200);
}

/**
 * Seed one STARTED + one UNSTARTED public session, both carrying the same
 * unique token in their topic so a single search narrows to exactly these
 * two candidates — of which only the started one may appear. Returns the
 * topics and the token for the assertions.
 */
async function seedStartedAndUnstarted(browser: Browser): Promise<{
  token: string;
  startedTopic: string;
  unstartedTopic: string;
}> {
  const token = randomUUID().slice(0, 8);
  const startedTopic = `Started public debate ${token}`;
  const unstartedTopic = `Unstarted public debate ${token}`;

  const hostContext = await authedContext(browser, 'alice');
  try {
    const request = hostContext.request;
    const startedId = await createSession(request, { topic: startedTopic, privacy: 'public' });
    await startSession(request, startedId);
    await createSession(request, { topic: unstartedTopic, privacy: 'public' });
  } finally {
    await hostContext.close();
  }

  return { token, startedTopic, unstartedTopic };
}

test('the landing page links an anonymous visitor to the public sessions route', async ({
  browser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await expect(page.getByTestId('route-landing')).toBeVisible({ timeout: 15_000 });

    const link = page.getByTestId('root-browse-public-sessions');
    await expect(link).toBeVisible();
    await link.click();

    await page.waitForURL((url) => url.pathname === '/sessions', { timeout: 15_000 });
    await expect(page.getByTestId('route-public-sessions')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('route-title')).toHaveText('Public sessions');
  } finally {
    await context.close();
  }
});

test('lists a started public session and hides an unstarted one with the same topic (lobby secrecy)', async ({
  browser,
}) => {
  const { token, startedTopic, unstartedTopic } = await seedStartedAndUnstarted(browser);

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await page.goto('/sessions');
    await expect(page.getByTestId('route-public-sessions')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('session-list')).toBeVisible();

    // Narrow to just this run's two candidate sessions by the shared token.
    await page.getByTestId('session-list-search').fill(token);

    // The started session surfaces…
    await expect(page.getByText(startedTopic)).toBeVisible({ timeout: 15_000 });
    // …and the unstarted one — matching the same topic filter — does NOT.
    // The endpoint's `started_at IS NOT NULL` gate is the only thing
    // keeping the lobby session (whose id is still its join secret) out of
    // the anonymous list, and this pins it at the UI.
    await expect(page.getByText(unstartedTopic)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('topic search narrows the list, a no-match search shows the empty state, and pagination is present', async ({
  browser,
}) => {
  const { token, startedTopic } = await seedStartedAndUnstarted(browser);

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await page.goto('/sessions');
    await expect(page.getByTestId('route-public-sessions')).toBeVisible({ timeout: 15_000 });

    // The pagination control is part of the page chrome regardless of count.
    await expect(page.getByTestId('session-list-prev')).toBeVisible();
    await expect(page.getByTestId('session-list-next')).toBeVisible();

    // A matching search narrows to the seeded started session.
    await page.getByTestId('session-list-search').fill(token);
    await expect(page.getByText(startedTopic)).toBeVisible({ timeout: 15_000 });

    // A token nobody seeded yields the empty state.
    const noMatch = `zzz-${randomUUID().slice(0, 8)}`;
    await page.getByTestId('session-list-search').fill(noMatch);
    await expect(page.getByTestId('session-list-empty')).toBeVisible({ timeout: 15_000 });
  } finally {
    await context.close();
  }
});

test('axe reports no WCAG 2.0/2.1 A/AA violations on the public sessions page', async ({
  browser,
}) => {
  // Seed a started session so the rendered table (not just the empty
  // state) is in the scan's scope.
  await seedStartedAndUnstarted(browser);

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await page.goto('/sessions');
    await expect(page.getByTestId('route-public-sessions')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('session-list')).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags([...WCAG_AA_TAGS]).analyze();
    // Map to `id (nodeCount)` so a failure names the rule(s) instead of
    // dumping the full violation objects.
    const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`);
    expect(summary).toEqual([]);
  } finally {
    await context.close();
  }
});
