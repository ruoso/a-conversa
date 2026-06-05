// End-to-end spec for the replay-mode variant of the audience surface.
//
// Refinement: tasks/refinements/replay_test/replay_mode_audience_surface.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
//              docs/adr/0039-shared-read-only-graph-view-package.md
//              docs/adr/0041-synthetic-session-generation-dev-gated-seam.md
//              docs/adr/0045-audience-replay-surface-visibility-gating.md
// TaskJuggler: replay_test.replay_ui.replay_mode_audience_surface
//
// **What this spec pins (Acceptance criterion 4 — the reachable-today
// behaviors).** The `/a/{locale}/replay/{id}` route, the shell's
// `useSessionEventLog` paging fetch against the authenticated
// `GET /api/sessions/:id/events`, the shared `@a-conversa/graph-view`
// renderer mounted from a *replayed log* (ADR 0039), and the
// `PrivateSessionCta` sign-in wall line up end to end:
//
//   (1) **Authenticated viewer → graph renders.** A synthetic session
//       (rich persisted log, node-created events) owned by the
//       authenticated caller loads at `/a/replay/<id>`; the graph root
//       mounts and the Cytoscape canvas paints.
//   (2) **Anonymous viewer → sign-in CTA.** A no-cookie context visiting
//       `/a/replay/<id>` gets a 401 from the authenticated-only endpoint;
//       the surface funnels the viewer to the `PrivateSessionCta` sign-in
//       affordance (existence-non-leak; ADR 0045/0029).
//   (3) **Locale prefix applied.** `/a/pt-BR/replay/<id>` renders a
//       pt-BR-localized string, proving the audience `App`-level URL-locale
//       negotiation flows through the replay route for free.
//
// **Deferred (criterion 5).** Anonymous replay of a *public* session
// without sign-in is not reachable until the events endpoint accepts
// anonymous public reads; that Playwright coverage is scoped into
// `backend.replay_endpoints.anonymous_public_session_log`.
//
// **Auth + seeding.** The `chromium-audience-replay` project depends on the
// shared `setup-auth` project. Scenarios that need a specific host allocate
// their own fresh context and `loginAs` (mirroring `audience-live-session`),
// then seed a persisted log through the dev-gated synthetic generator
// (`POST /api/test-mode/synthetic-sessions`) — the same real write path
// `test_mode_synthetic_session` established. The generator is live because
// `make up` runs the app under `NODE_ENV=development` (ADR 0041).

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';

// A deterministic UUID that no session mint will produce — the not-found
// input for the locale scenario (an authenticated viewer of an absent
// session reaches the localized "unavailable" affordance).
const UNUSED_SESSION_ID = '00000000-0000-4000-8000-0000000000fe';

/**
 * Allocate a fresh browser context that starts anonymous (the project-level
 * `setup-auth` jar is intentionally overridden). Each scenario gets its own
 * context so concurrent scenarios do not share cookies.
 */
async function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
  });
}

/**
 * Generate a synthetic session (rich persisted log, owned by the caller)
 * through the dev-gated generator — the real surface → real endpoint →
 * real persisted log path. Returns the new session id.
 */
async function generateSyntheticSession(page: Page): Promise<string> {
  const response = await page.request.post('/api/test-mode/synthetic-sessions', {
    data: { scenario: 'structured' },
  });
  expect(
    response.status(),
    'generateSyntheticSession: POST /api/test-mode/synthetic-sessions must return 201',
  ).toBe(201);
  const body = (await response.json()) as { sessionId: string };
  expect(body.sessionId, 'response body must carry a string sessionId').toBeTruthy();
  return body.sessionId;
}

test.describe('Audience replay surface — /a/{locale}/replay/:id', () => {
  test('(1) authenticated viewer: the replayed log renders the graph', async ({ browser }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const alice = await loginAs(page, { username: 'alice' });
      expect(alice.screenName.toLowerCase()).toBe('alice');
      // The caller owns the generated session, so `canSeeSession` admits
      // the authenticated replay read.
      const sessionId = await generateSyntheticSession(page);

      await page.goto(`/a/replay/${sessionId}`);

      // Real surface → `useSessionEventLog` → `GET /api/sessions/:id/events`
      // → real backend returns the synthetic log → the `ready` state mounts
      // the shared `@a-conversa/graph-view` renderer at the log head.
      await expect(
        page.getByTestId('audience-graph-root'),
        'the replayed log mounts the graph renderer',
      ).toBeVisible({ timeout: 15_000 });

      // Cytoscape paints nodes/labels to `<canvas>` layers; at least one
      // canvas inside the testid container is the canvas-end witness that
      // the render pipeline started over the node-created events.
      const canvasCount = await page.getByTestId('audience-graph-root').locator('canvas').count();
      expect(canvasCount, 'the replayed graph paints a Cytoscape canvas').toBeGreaterThan(0);

      // The URL stays put — replay is an in-place public route.
      expect(new URL(page.url()).pathname).toBe(`/a/replay/${sessionId}`);
    } finally {
      await context.close();
    }
  });

  test('(2) anonymous viewer: the endpoint 401s and the surface shows the sign-in CTA', async ({
    browser,
  }) => {
    // A host first creates the session so it genuinely exists; the
    // anonymous read is gated by the authenticated-only endpoint, not by
    // the session's absence.
    const creatorContext = await freshContext(browser);
    const creatorPage = await creatorContext.newPage();
    let sessionId: string;
    try {
      await loginAs(creatorPage, { username: 'alice' });
      sessionId = await generateSyntheticSession(creatorPage);
    } finally {
      await creatorContext.close();
    }

    const anonContext = await freshContext(browser);
    const anonPage = await anonContext.newPage();
    try {
      await anonPage.goto(`/a/replay/${sessionId}`);

      // The authenticated-only endpoint 401s the anonymous request; the
      // hook maps that to `error`, and the surface funnels the viewer to
      // the sign-in wall (ADR 0045 — visibility-gated v1).
      const cta = anonPage.getByTestId('audience-private-session-cta');
      await expect(cta, 'anonymous replay shows the sign-in CTA').toBeVisible({ timeout: 15_000 });

      // The URL did NOT bounce — the affordance is offered in-place.
      expect(new URL(anonPage.url()).pathname).toBe(`/a/replay/${sessionId}`);

      // The `<LoginButton>` inside the CTA points at the OIDC start
      // endpoint (ADR 0002).
      const loginLink = cta.locator('a').first();
      await expect(loginLink).toHaveAttribute('href', '/api/auth/login');
    } finally {
      await anonContext.close();
    }
  });

  test('(3) locale prefix flows through: /a/pt-BR/replay/<id> renders a pt-BR string', async ({
    page,
  }) => {
    // The default `page` carries the project `setup-auth` jar (authenticated
    // alice). An absent session id reaches the `not-found` → localized
    // "unavailable" affordance; the pt-BR URL prefix proves the audience
    // `App`-level `negotiateUrlLocale` effect localizes the replay route
    // with no route-local locale code.
    await page.goto(`/a/pt-BR/replay/${UNUSED_SESSION_ID}`);

    const unavailable = page.getByTestId('audience-replay-unavailable');
    await expect(unavailable, 'an absent session reaches the unavailable affordance').toBeVisible({
      timeout: 15_000,
    });

    // `audience.replay.unavailableTitle` in pt-BR — the URL-locale witness.
    await expect(unavailable).toContainText('Replay indisponível');
  });
});
