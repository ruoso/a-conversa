// End-to-end spec for the authenticated My Sessions page
// (session_discovery.sd_frontend.sd_my_sessions_page).
//
// Refinement: tasks/refinements/session_discovery/sd_my_sessions_page.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0026-micro-frontend-root-app.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0040-automated-accessibility-checks-axe-playwright.md
//              docs/adr/0022-no-throwaway-verifications.md
//
// **What this spec pins (D9 — the page pays its own reachability + auth-bounce +
// host-badge + lobby-rows-appear debt; the heavier multi-user role matrix and
// the not-yet-built join-live routing stay in `sd_e2e`):**
//
//   1. **Auth bounce.** A signed-out visit to `/sessions/mine` bounces into the
//      sign-in flow (the OIDC IdP), never the list.
//   2. **Authenticated render.** A signed-in user (alice) sees her own
//      sessions, each carrying a **host** role badge, with a **lobby**
//      (unstarted) session present — the distinguishing My-Sessions behavior
//      (lobby rows appear, unlike the started-only public list).
//   3. **Search / pagination.** Topic search narrows the list; the pagination
//      control is present; a no-match search shows the empty state.
//   4. **Reachability.** The signed-in landing chrome shows a "My sessions"
//      link that navigates to the route.
//   5. axe reports no WCAG 2.0/2.1 A/AA violations on the rendered page.
//
// **Seeding.** alice creates her sessions via the same-origin API
// (`POST /api/sessions` → lobby; `POST /api/sessions/:id/start` → the
// lobby→operate transition that stamps `started_at`). The project loads alice's
// bootstrap jar as its storage state (`setup-auth`), so the test `page` is
// already authenticated as alice and both seeds and browses as her.

import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';

import type { APIRequestContext } from '@playwright/test';

import { expect, test } from './fixtures/no-scrollbars';

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
 * Seed one STARTED + one UNSTARTED (lobby) session for the caller, both carrying
 * the same unique token in their topic so a single search narrows to exactly
 * these two. Unlike the public list, BOTH must appear on My Sessions (the lobby
 * row is the distinguishing behavior). Returns the topics and the token.
 */
async function seedStartedAndLobby(request: APIRequestContext): Promise<{
  token: string;
  startedTopic: string;
  lobbyTopic: string;
}> {
  const token = randomUUID().slice(0, 8);
  const startedTopic = `Started my debate ${token}`;
  const lobbyTopic = `Lobby my debate ${token}`;

  const startedId = await createSession(request, { topic: startedTopic, privacy: 'public' });
  await startSession(request, startedId);
  await createSession(request, { topic: lobbyTopic, privacy: 'private' });

  return { token, startedTopic, lobbyTopic };
}

test('a signed-out visit to /sessions/mine bounces into the sign-in flow', async ({ browser }) => {
  // A fresh ANONYMOUS context — the auth gate must bounce. The empty
  // `storageState` is load-bearing: Playwright merges the project's default
  // `storageState` (alice's `setup-auth` jar) into `browser.newContext()`, so
  // without this override the "anonymous" context would arrive authenticated
  // and the deflection branch would never fire (mirrors the test-mode skeleton
  // unauthenticated-deflection scenario).
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  try {
    await page.goto('/sessions/mine');
    // The route remembers the deep link, Navigates to `/login`, which full-page
    // redirects onto the OIDC IdP. We land in the sign-in flow, not the list.
    await page.waitForURL(/authelia\.aconversa\.local/, { timeout: 30_000 });
    await expect(page.getByTestId('route-my-sessions')).toHaveCount(0);
    await expect(page.getByTestId('session-list')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a signed-in user sees her own sessions with host badges and a lobby row present', async ({
  page,
}) => {
  const { token, startedTopic, lobbyTopic } = await seedStartedAndLobby(page.request);

  await page.goto('/sessions/mine');
  await expect(page.getByTestId('route-my-sessions')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('route-title')).toHaveText('My sessions');
  await expect(page.getByTestId('session-list')).toBeVisible();

  // Narrow to just this run's two seeded sessions by the shared token.
  await page.getByTestId('session-list-search').fill(token);

  // Both the started AND the lobby (unstarted) session appear — the
  // distinguishing My-Sessions behavior (lobby rows appear, unlike the public
  // list which gates on `started_at IS NOT NULL`).
  await expect(page.getByText(startedTopic)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(lobbyTopic)).toBeVisible();

  // alice hosts both, so every visible row carries a "Host" role badge.
  const badges = page.getByTestId('session-role-badge');
  await expect(badges.first()).toBeVisible();
  const badgeTexts = await badges.allTextContents();
  expect(badgeTexts.length).toBeGreaterThanOrEqual(2);
  for (const text of badgeTexts) {
    expect(text).toBe('Host');
  }
});

test('topic search narrows the list, a no-match search shows the empty state, and pagination is present', async ({
  page,
}) => {
  const { token, startedTopic } = await seedStartedAndLobby(page.request);

  await page.goto('/sessions/mine');
  await expect(page.getByTestId('route-my-sessions')).toBeVisible({ timeout: 15_000 });

  // The pagination control is part of the page chrome regardless of count.
  await expect(page.getByTestId('session-list-prev')).toBeVisible();
  await expect(page.getByTestId('session-list-next')).toBeVisible();

  // A matching search narrows to this run's seeded sessions.
  await page.getByTestId('session-list-search').fill(token);
  await expect(page.getByText(startedTopic)).toBeVisible({ timeout: 15_000 });

  // A token nobody seeded yields the empty state.
  const noMatch = `zzz-${randomUUID().slice(0, 8)}`;
  await page.getByTestId('session-list-search').fill(noMatch);
  await expect(page.getByTestId('session-list-empty')).toBeVisible({ timeout: 15_000 });
});

test('the signed-in landing chrome links to the My Sessions route', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('route-landing')).toBeVisible({ timeout: 15_000 });

  const link = page.getByTestId('root-view-my-sessions');
  await expect(link).toBeVisible();
  await link.click();

  await page.waitForURL((url) => url.pathname === '/sessions/mine', { timeout: 15_000 });
  await expect(page.getByTestId('route-my-sessions')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('route-title')).toHaveText('My sessions');
});

test('axe reports no WCAG 2.0/2.1 A/AA violations on the my sessions page', async ({ page }) => {
  // Seed a session so the rendered table (not just the empty state) is scanned.
  await seedStartedAndLobby(page.request);

  await page.goto('/sessions/mine');
  await expect(page.getByTestId('route-my-sessions')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('session-list')).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags([...WCAG_AA_TAGS]).analyze();
  // Map to `id (nodeCount)` so a failure names the rule(s) instead of dumping
  // the full violation objects.
  const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`);
  expect(summary).toEqual([]);
});
