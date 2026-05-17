// Playwright configuration for `a-conversa`.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_testing.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
// TaskJuggler: frontend_i18n.i18n_testing
//
// **Single-origin deployment.** The Fastify server serves the moderator's
// built `dist/` at `/` (see `apps/server/src/routes/static-frontends.ts`)
// alongside the JSON / WebSocket API. Playwright tests therefore drive
// a single URL (`http://localhost:3000` by default) — no separate Vite
// preview, no CORS shim. The compose stack (`make up`) brings up the
// app exactly the way a real client would meet it.
//
// **Why `webServer` is unset.** Auto-starting the compose stack from
// `webServer` is tempting but couples the test process to docker. We
// keep the responsibility separate: the dev brings up `make up` (or
// CI brings it up explicitly), and the runner just connects. This:
//
//   - Keeps `pnpm run test:e2e` fast on iteration (server is already up).
//   - Lets the CI job own teardown via `make down-v` so cleanup is
//     guaranteed even on Playwright failures.
//   - Avoids the "Playwright crashed; compose left running" footgun.
//
// **Per-locale projects.** The three Chromium projects pre-seed the
// `aconversa_locale` cookie before the SPA loads. The cookie is the
// first signal `negotiateAuthenticatedLocale()` reads, so the SPA's
// initial paint already uses the project's locale — exactly the path a
// returning user would take.
//
// **Artifacts on failure.** Traces, screenshots, and videos are
// retained on failure only (no green-run cost). The HTML reporter
// writes to `playwright-report/` (already gitignored); test artifacts
// (traces, videos, screenshots) land under `test-results/`.

import { defineConfig, devices } from '@playwright/test';

import { LOCALE_COOKIE_NAME, SUPPORTED_LOCALES } from '@a-conversa/i18n-catalogs';

import { AUTH_STORAGE_STATE_PATH } from './tests/e2e/fixtures/auth-storage-path';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

// Derive the cookie's `domain` attribute from the base URL so the
// pre-seeded cookie matches the host the tests load. Localhost is the
// common case; CI overrides via PLAYWRIGHT_BASE_URL only if it points
// at a non-localhost ingress.
const cookieDomain = new URL(BASE_URL).hostname;

/**
 * Build a `storageState` object that pre-seeds the `aconversa_locale`
 * cookie for a given locale. Playwright treats `storageState` as either
 * a path to a JSON file or an inline object — we use the inline form
 * so the per-project setup stays declarative and reproducible without
 * touching the filesystem.
 *
 * The cookie attributes match what `persistLocale()` in
 * `packages/i18n-catalogs/src/negotiation.ts` writes from the SPA at
 * runtime: `Path=/`, `SameSite=Lax`, value is the canonical tag. We
 * do not set `Secure` because the dev compose stack is plain HTTP;
 * production deployments serve over HTTPS and the cookie value the
 * SPA itself sets will carry `Secure`. The pre-seeded cookie just
 * has to be readable by `document.cookie` before the SPA boots.
 */
function localeStorageState(locale: (typeof SUPPORTED_LOCALES)[number]): {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
} {
  return {
    cookies: [
      {
        name: LOCALE_COOKIE_NAME,
        value: locale,
        domain: cookieDomain,
        path: '/',
        // Far-future expiry; Playwright requires `expires` (-1 means
        // session cookie). Use one-year-from-now in epoch seconds.
        expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  };
}

export default defineConfig({
  testDir: 'tests/e2e',
  // Specs that don't need a browser (the legacy `hello.spec.ts`
  // arithmetic smoke) live next to specs that do. Each per-locale
  // project filters with a `testMatch` so cross-locale specs run
  // three times (once per project) while non-browser specs run once
  // under the default project.
  fullyParallel: true,
  // `forbidOnly: !!process.env.CI` — a `.only` left in a spec must
  // not pass CI silently.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Workers default to the runner's CPU count; cap on CI to avoid
  // contention with the compose stack on a small runner. When unset
  // Playwright picks half the available CPUs which is the right
  // default for local dev — so we only set `workers` under CI.
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // No `webServer` block: tests run against whatever is at `baseURL`.
  // Locally: `make up` brings up postgres + authelia + app; then
  // `pnpm run test:e2e`. CI: the `e2e-playwright` job runs `make up`
  // explicitly and tears down via `make down-v` on success and failure.
  projects: [
    // Decision-only smoke (no browser). The legacy `hello.spec.ts`
    // proves the runner discovers TypeScript specs; per ADR 0008 it
    // does not use the `page` fixture and does not need a browser.
    // Kept under its own project so per-locale projects don't run it
    // three times.
    {
      name: 'smoke-node',
      testMatch: /hello\.spec\.ts$/,
    },
    // Per-locale Chromium projects. Each pre-seeds the
    // `aconversa_locale` cookie so the SPA's first paint uses the
    // project's locale. The same spec runs once per project; the
    // `locale` test annotation passes through via `process.env` so
    // assertions can look up the expected localized strings.
    ...SUPPORTED_LOCALES.map((locale) => ({
      name: `chromium-${locale}`,
      testMatch: /i18n-moderator-smoke\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        // The browser's own `Accept-Language` is a fallback signal
        // for `navigator.languages`; setting it here matches what a
        // user with that locale's browser would send. The cookie is
        // the dominant signal (cookie > navigator.languages in
        // `negotiateAuthenticatedLocale`), but matching both means
        // the spec exercises a self-consistent client profile.
        locale,
        storageState: localeStorageState(locale),
      },
      metadata: { locale },
    })),
    // Full OIDC handshake project. Drives `tests/e2e/auth-flow.spec.ts`
    // against the dev compose stack's Authelia binary. Refinement:
    // `tasks/refinements/backend/auth_flow_integration.md`.
    //
    // - `ignoreHTTPSErrors: true` scoped to this project ONLY. The
    //   OIDC redirect crosses `https://authelia.aconversa.local:9091`
    //   which uses a self-signed cert (`infra/authelia/tls/cert.pem`).
    //   The other projects (smoke-node, chromium-<locale>) keep their
    //   strict-cert posture so a future HTTPS regression in the
    //   moderator surface still surfaces.
    // - The spec uses `test.describe.serial(...)` to pin the
    //   scenario order (new-user must precede returning-user because
    //   the first run is what creates the users-table row). No
    //   per-project parallelism cap is needed — the serial wrapper
    //   guarantees the scenarios run on one worker.
    // - The auth flow is locale-agnostic (the OIDC handshake carries
    //   no locale signal). Running the spec three times under three
    //   locales would triple wall-clock cost for zero signal — see
    //   the refinement's Decisions block.
    {
      name: 'chromium-auth',
      testMatch: /auth-flow\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        ignoreHTTPSErrors: true,
      },
    },
    // One-time auth bootstrap. Drives a single OIDC dance for `alice`
    // and writes the resulting cookie jar to `AUTH_STORAGE_STATE_PATH`.
    // Every downstream project that needs an authed page declares this
    // as a `dependencies` entry; Playwright runs setup once per
    // dependency relationship, before the dependents start. Previously
    // each test ran its own `loginAs`, which fanned ~30 OIDC dances
    // through the dev Authelia container per suite and tripped the
    // per-IP rate limiter (the rate-limit rejection surfaces inside
    // `openid-client` as `OAUTH_RESPONSE_IS_NOT_CONFORM` → 500 on
    // `/api/auth/callback`, which in turn made `loginAs` fail with a
    // misleading `auth-pending-cookie-invalid` envelope from the
    // follow-up `POST /api/auth/screen-name` — the failure surface
    // that motivated the change). Sharing one cookie jar across the
    // suite drops the dance count back to one per consuming project.
    //
    // The setup uses `chromium-create-session`'s profile (single
    // locale en-US, ignoreHTTPSErrors for the Authelia self-signed
    // cert, pre-seeded en-US locale cookie) because every consuming
    // project happens to share that profile; if a future consumer
    // needs a different profile, add a second setup project rather
    // than parameterising this one.
    {
      name: 'setup-auth',
      testMatch: /global-auth\.setup\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        ignoreHTTPSErrors: true,
        storageState: localeStorageState('en-US'),
      },
    },
    // Hover-details e2e (mod_hover_details). Drives the moderator's
    // operate route, seeds synthetic node + edge events into the
    // Zustand WS store via `window.__aConversaWsStore` (dev-only
    // attachment in `apps/moderator/src/main.tsx`), and asserts the
    // popover content + click-through / focus-visible behaviour.
    //
    // - Single locale (en-US) for deterministic content-text assertions.
    //   The cross-locale popover-content matrix is covered by the
    //   Vitest cases in `HoverPopover.test.tsx`.
    // - `ignoreHTTPSErrors: true` mirrors `chromium-auth` because the
    //   OIDC redirect crosses the self-signed cert on
    //   `authelia.aconversa.local`.
    // - `storageState` loads the bootstrap auth jar from
    //   `setup-auth`. `loginAs` short-circuits on the resulting
    //   `/api/auth/me === 200` probe so the per-test OIDC dance never
    //   runs.
    {
      name: 'chromium-moderator-hover',
      testMatch: /moderator-hover-details\.spec\.ts$/,
      dependencies: ['setup-auth'],
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        ignoreHTTPSErrors: true,
        storageState: AUTH_STORAGE_STATE_PATH,
      },
    },
    // Graph layout e2e (mod_layout_engine_choice, ADR 0025). Drives the
    // moderator's operate route, seeds a 6-node / 5-edge claim+evidence
    // +rebut fixture into the Zustand WS store, and asserts: pairwise
    // non-overlap of rendered cards, source.y < target.y for every
    // edge under rankdir=TB, and ≤ 2 px drift of original cards when
    // one incremental node + edge is seeded (the position-cache
    // stability contract). Same locale / ignoreHTTPSErrors profile as
    // `chromium-moderator-hover` — the layout assertions are locale-
    // independent (positions, not text), so single-locale is enough.
    {
      name: 'chromium-moderator-layout',
      testMatch: /moderator-graph-layout\.spec\.ts$/,
      dependencies: ['setup-auth'],
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        ignoreHTTPSErrors: true,
        storageState: AUTH_STORAGE_STATE_PATH,
      },
    },
    // Create-session whole-flow e2e (mod_create_session_form) and
    // moderator capture-pane e2e (mod_capture_text_input). Both specs
    // need the same browser profile (single locale en-US,
    // ignoreHTTPSErrors for the OIDC self-signed cert, pre-seeded
    // en-US locale cookie) and both reach the operate route via the
    // create-session login → POST /api/sessions → navigate chain.
    // Sharing the project keeps the per-locale-times-spec matrix
    // bounded; the capture-pane spec joins this project per the
    // `mod_capture_text_input` refinement Decision §8.
    //
    // - Single locale (en-US) for deterministic title/button assertions
    //   and label / helper text assertions on the capture pane.
    //   The cross-locale title / capture-text-input text is pinned at
    //   the catalog parity layer; the whole-flow chain is locale-
    //   independent.
    // - `ignoreHTTPSErrors: true` mirrors `chromium-auth` because the
    //   OIDC redirect crosses the self-signed cert on
    //   `authelia.aconversa.local`.
    {
      name: 'chromium-create-session',
      testMatch: /(create-session-flow|moderator-capture|invite-participants-flow)\.spec\.ts$/,
      dependencies: ['setup-auth'],
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        ignoreHTTPSErrors: true,
        storageState: AUTH_STORAGE_STATE_PATH,
      },
    },
    // Participant skeleton e2e (participant_ui.part_shell.part_app_skeleton,
    // refinement `tasks/refinements/participant-ui/part_app_skeleton.md`).
    // Drives a logged-in browser to a `/p/sessions/<uuid>/invite?role=...`
    // URL (the shape the moderator's `InviteParticipants.tsx` emits)
    // and asserts the participant surface's placeholder route renders.
    // Same browser profile as `chromium-create-session` — single locale
    // en-US (cross-locale text is covered at the catalog-parity layer),
    // `ignoreHTTPSErrors` for the OIDC redirect (irrelevant once the
    // shared `setup-auth` storage state hits, but kept for parity), and
    // the bootstrap auth jar via `setup-auth`.
    {
      name: 'chromium-participant-skeleton',
      // `part_invite_acceptance` widens the testMatch to also accept
      // `participant-invite-acceptance.spec.ts`; `part_lobby_view`
      // widens it again to accept `participant-lobby.spec.ts` (the
      // milestone-closing two-scenario spec for `m_manual_lobby_smoke`).
      // Same browser profile (single locale en-US, ignoreHTTPSErrors
      // for the OIDC redirect, bootstrap auth jar from setup-auth);
      // no new project. Decisions §7 of both refinements.
      testMatch: /participant-(skeleton-smoke|invite-acceptance|lobby)\.spec\.ts$/,
      dependencies: ['setup-auth'],
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        ignoreHTTPSErrors: true,
        storageState: AUTH_STORAGE_STATE_PATH,
      },
    },
  ],
});
