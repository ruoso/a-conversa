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
    // Annotation-endpoint canvas rendering e2e
    // (mod_render_annotation_endpoint_edges). Drives the moderator's
    // operate route, seeds a node + annotation + annotation-endpoint
    // edge into the Zustand WS store via `wsStoreSeed.ts`, and asserts
    // both the host statement node AND the promoted annotation node
    // surface alongside the host pseudo-edge. Same browser profile as
    // `chromium-moderator-hover` — the seeded text is locale-independent
    // (the spec asserts test-ids, not catalog content), so single-locale
    // is enough.
    {
      name: 'chromium-moderator-annotation-endpoint',
      testMatch: /annotation-endpoint-rendering\.spec\.ts$/,
      dependencies: ['setup-auth'],
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        ignoreHTTPSErrors: true,
        storageState: AUTH_STORAGE_STATE_PATH,
      },
    },
    // Annotation-endpoint propose-gesture e2e
    // (mod_propose_annotation_endpoint_gestures). Drives the
    // moderator's operate route, seeds an annotation-endpoint edge
    // into the Zustand WS store via `wsStoreSeed.ts`, then exercises
    // two propose-side gestures: (1) drag from a promoted annotation
    // node onto a statement node to open `<DrawEdgeRolePicker>` with
    // the kind-discriminated data-attributes; (2) click an annotation
    // node during capture to stage it as the capture target on
    // `<CaptureTargetChip>`. Same browser profile as
    // `chromium-moderator-annotation-endpoint` — same seed seam, same
    // single-locale rationale (data-attribute / content assertions).
    {
      name: 'chromium-moderator-annotation-endpoint-gestures',
      testMatch: /annotation-endpoint-gestures\.spec\.ts$/,
      dependencies: ['setup-auth'],
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        ignoreHTTPSErrors: true,
        storageState: AUTH_STORAGE_STATE_PATH,
      },
    },
    // Annotation context-menu e2e
    // (mod_annotation_context_menu). Drives the moderator's operate
    // route, seeds a host node + promoted annotation via `wsStoreSeed.ts`,
    // then right-clicks the annotation node and asserts the dedicated
    // annotation menu opens with `data-target-kind="annotation"` and the
    // two v1 items (`annotate`, `meta-disagree`). Picking each item
    // opens the `<AnnotateSubmenu>` with `data-target-kind="annotation"`.
    // Same browser profile and single-locale rationale as the rest of
    // the annotation-endpoint family.
    {
      name: 'chromium-moderator-annotation-context-menu',
      testMatch: /annotation-context-menu\.spec\.ts$/,
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
      testMatch:
        /(create-session-flow|moderator-capture|moderator-real-capture-flow|invite-participants-flow|moderator-proposed-entity-canvas-visibility|moderator-warrant-elicitation-mode|moderator-snapshot|moderator-diagnostic-flag-pane)\.spec\.ts$/,
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
      // `part_graph_render` widens it again to accept
      // `participant-graph-render.spec.ts` (the read-mostly operate
      // route's behavioural pin per Decision §6 of that refinement).
      // Same browser profile (single locale en-US, ignoreHTTPSErrors
      // for the OIDC redirect, bootstrap auth jar from setup-auth);
      // no new project. Decisions §7 of both refinements.
      testMatch:
        /participant-(skeleton-smoke|invite-acceptance|lobby|graph-render|pending-proposals)\.spec\.ts$/,
      dependencies: ['setup-auth'],
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        ignoreHTTPSErrors: true,
        storageState: AUTH_STORAGE_STATE_PATH,
      },
    },
    // Audience skeleton e2e (audience.aud_shell.aud_app_skeleton, refinement
    // `tasks/refinements/audience/aud_app_skeleton.md`). Drives a logged-in
    // browser to `/a/sessions/<uuid>` and asserts the audience surface's
    // placeholder route renders. Mirrors the `chromium-participant-skeleton`
    // shape — single locale en-US (cross-locale text is covered at the
    // catalog-parity layer), `ignoreHTTPSErrors` for the OIDC redirect
    // (irrelevant once the shared `setup-auth` storage state hits, but
    // kept for parity), and the bootstrap auth jar via `setup-auth`.
    // Future audience leaves widen the `testMatch` (the way
    // `chromium-participant-skeleton` widened to accept
    // `participant-invite-acceptance` / `participant-lobby` /
    // `participant-graph-render` over successive refinements).
    {
      name: 'chromium-audience-skeleton',
      // `aud_session_url` widens the testMatch to also accept
      // `audience-live-session.spec.ts` (the graph-route's six-scenario
      // behavioural pin — pays down the inherited deferred-e2e debt
      // declared against `aud_session_url` by four upstream audience
      // refinements). Mirrors the `chromium-participant-skeleton` regex
      // widening pattern (`participant-(skeleton-smoke|invite-acceptance|lobby|graph-render|pending-proposals)`).
      testMatch: /audience-(skeleton-smoke|live-session)\.spec\.ts$/,
      dependencies: ['setup-auth'],
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        ignoreHTTPSErrors: true,
        storageState: AUTH_STORAGE_STATE_PATH,
      },
    },
    // Test-mode skeleton e2e (replay_test.test_mode.test_mode_app,
    // refinement `tasks/refinements/replay_test/test_mode_app.md`).
    // Drives a logged-in browser to `/t/sessions/<uuid>` and asserts
    // the test-mode surface's placeholder route renders, plus an
    // unauthenticated-deflection scenario proving the
    // `requiredAuthLevel: 'authenticated'` gate bounces an anonymous
    // visitor to the host login. Mirrors the
    // `chromium-participant-skeleton` shape — single locale en-US
    // (cross-locale text is covered at the catalog-parity layer),
    // `ignoreHTTPSErrors` for the OIDC redirect, and the bootstrap auth
    // jar via `setup-auth`. Future test-mode leaves widen the
    // `testMatch` the way `chromium-participant-skeleton` did.
    {
      name: 'chromium-test-mode-skeleton',
      testMatch: /test-mode-skeleton-smoke\.spec\.ts$/,
      dependencies: ['setup-auth'],
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        ignoreHTTPSErrors: true,
        storageState: AUTH_STORAGE_STATE_PATH,
      },
    },
    // Cross-surface lobby + start-debate spec — three real browser
    // contexts (alice + ben + maria) prove the moderator-lobby's
    // Enter-session click after both debaters self-claim through
    // their own surfaces. The spec lives in its own project so its
    // testMatch doesn't bleed into either the moderator-side
    // `chromium-create-session` (which still drives the WS-store-seed
    // flavour for the gate-only contract) or the participant-side
    // `chromium-participant-skeleton`. Same browser profile as both:
    // single locale en-US (text assertions are role-labels +
    // localized strings already pinned by the catalog parity layer),
    // `ignoreHTTPSErrors` for the OIDC self-signed cert, and the
    // bootstrap `setup-auth` storage state (each scenario allocates
    // its own freshContext with an empty jar to drive per-user
    // dances; the project-level storageState is what `loginAs`'s
    // short-circuit probe reads on contexts that DON'T override it).
    {
      name: 'chromium-cross-surface',
      // `methodology-full-flow.spec.ts` shares the same three-context
      // shape as `cross-surface-lobby-start` (alice/ben/maria allocated
      // via `authedContext`) and the same browser profile (single
      // locale en-US, ignoreHTTPSErrors for the OIDC self-signed cert,
      // bootstrap auth jar). Widening the testMatch keeps both specs
      // co-located instead of cloning the project block.
      // `annotation-dispute-roundtrip.spec.ts` (mod_annotation_dispute_e2e)
      // joins the same project — it drives the identical three-context
      // shape to pin the post-commit annotation-dispute round-trip
      // (moderator commits a reframe meta-move → debater disputes the
      // resulting annotation → moderator badge gains
      // `data-facet-status="disputed"` live over WS).
      // `full-session-walkthrough.spec.ts` (mod_pw_full_session_run) joins
      // the same project — it drives the identical three-context shape
      // (maria mod + alice/ben debaters) to recreate the canonical
      // `docs/example-walkthrough.md` "Should zoos exist?" debate end-to-end
      // against the real backend (the M7 acceptance gate). Decision D5:
      // extend the existing cross-surface project rather than clone it.
      testMatch:
        /(cross-surface-lobby-start|methodology-full-flow|moderator-draw-edge|moderator-capture-targeted-by|annotation-dispute-roundtrip|full-session-walkthrough)\.spec\.ts$/,
      dependencies: ['setup-auth'],
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        ignoreHTTPSErrors: true,
        storageState: AUTH_STORAGE_STATE_PATH,
      },
    },
    // Public landing-page e2e (`landing_page.*`). The anonymous `/` marketing
    // surface — the walkthrough demo, the narrative + chrome sections, the
    // locale switcher, and (per `landing_responsive_a11y`) the page-wide
    // accessibility / responsive pins (axe WCAG-AA scan, focus order + visible
    // focus, no-horizontal-overflow, reduced-motion). No auth: the surface
    // renders for anonymous visitors (an authenticated visitor is bounced to
    // `/home` before the marketing body renders), so this project carries no
    // `setup-auth` dependency. Single locale en-US seeds the English baseline
    // the specs assert before exercising the in-page locale switch; each spec
    // allocates its own `browser.newContext()` (some at phone viewports), so
    // the project-level profile is just the default. Future landing leaves
    // (the terminal `landing_e2e`) widen this `testMatch`.
    {
      name: 'chromium-landing',
      testMatch: /landing-demo\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        ignoreHTTPSErrors: true,
        storageState: localeStorageState('en-US'),
      },
    },
  ],
});
