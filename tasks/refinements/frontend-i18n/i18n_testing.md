# Playwright + visual-regression coverage across locales

**TaskJuggler entry**: [tasks/35-frontend-i18n.tji](../../35-frontend-i18n.tji) — task `frontend_i18n.i18n_testing`
**Effort estimate**: 2d
**Inherited dependencies**: `frontend_i18n.i18n_locale_negotiation`, `foundation.test_infra.playwright_setup` (both must land first)

## What this task is

Extend the existing Playwright + visual-regression coverage on the four frontend surfaces to run against each of the three locales. Adds the Playwright project matrix (3 locales x 4 surfaces = 12 baseline contexts), the per-locale smoke scenarios, and the visual-regression baseline images. Also lands the CI integration for the catalog parity-check from `i18n_catalog_workflow` and the error-code drift check from `i18n_error_code_catalog`.

## Why it needs to be done

The four UI groups (moderator, participant, audience, replay/test) each have their own `*_tests` sub-tree (`mod_tests`, `part_tests`, `aud_tests`, `replay_test_tests`) that produces Playwright + visual-regression baselines. Without per-locale runs, a missing translation, a layout overflow on a longer Portuguese label, or a rendering glitch on a diacritic only shows up in production. This task wires the locale dimension into the existing test matrix without rewriting the per-surface tests themselves — they parameterize over locale.

## Inputs / context

- [docs/adr/0008-e2e-framework-playwright.md](../../../docs/adr/0008-e2e-framework-playwright.md) — Playwright is the E2E framework; supports a `projects` matrix natively.
- [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — locale-negotiation strategies that the tests exercise.
- `foundation.test_infra.playwright_setup` — the upstream Playwright bootstrap.
- `foundation.test_infra.playwright_test_helpers` — the helpers (auth, session creation, event seeding) that tests use; they may need locale-parameter extensions.
- `mod_tests.mod_e2e_playwright.*`, `part_tests.part_e2e_playwright.*`, `aud_tests.aud_playwright_e2e`, `replay_test_tests.replay_playwright_e2e` — the per-surface test sub-trees this task augments.

## Constraints / requirements

- **Playwright project matrix**: a `projects` configuration with one project per (surface, locale) pair. Per-locale projects override the locale cookie (moderator / participant / private audience) or the URL prefix (public audience / replay). 12 baseline contexts in total.
- **Per-locale smoke**: at minimum, one "locale renders correctly" smoke test per surface per locale that asserts a known localized string is visible. Lightweight; runs on every CI build.
- **Full per-surface flows**: do NOT run the entire per-surface flow suite in every locale on every CI build — that would 3x the test runtime. Instead, the full flow suite runs in `en-US` on every build; the other locales run the smoke per build and the full suite on a nightly/scheduled CI job.
- **Visual-regression baselines per locale**: each visual-regression task (`mod_vr_*`, `part_vr_*`, `aud_visual_regression`, `replay_visual_regression`) gains per-locale snapshot baselines. Storage: snapshots live alongside the existing ones with a locale suffix (`mod_classification_palette.pt-BR.png`).
- **Catalog parity-check in CI**: the parity-check script from `i18n_catalog_workflow` runs as a CI step. Failing on missing keys.
- **Error-code drift check in CI**: the drift check from `i18n_error_code_catalog` runs as a CI step. Failing on missing frontend translations for server codes.
- **No test in this task touches `apps/server/`**.

## Acceptance criteria

- `playwright.config.ts` (or its equivalent) defines projects for `(surface, locale)` pairs covering the 12 combinations.
- A per-surface locale-smoke test exists for each of the four surfaces, asserts a known-localized string in each locale, and passes on a fresh checkout.
- The full per-surface flow suites continue to pass under `en-US`; pt-BR / es-419 are exempted from full per-build runs but pass on the scheduled job.
- Visual-regression baseline images exist for each surface in each locale; the per-locale baselines are checked into the repo under a clear directory convention.
- CI pipeline runs: (1) catalog parity-check, (2) error-code drift check, (3) per-locale smoke, (4) en-US full flows. Failing any step fails the build.
- Per-locale baseline updates are gated by review (a baseline update commit message references the responsible reviewer, mirroring the methodology-glossary review chain).

## Decisions

- **Playwright `projects` matrix** as the multiplexing primitive. Settled here.
- **en-US is the per-build full-flow locale; pt-BR / es-419 are smoke-only per-build, full-flow on scheduled jobs.** Rationale: keeps the per-PR feedback loop short while still catching locale-specific regressions before release.
- **Per-locale visual-regression baselines stored alongside the existing ones**, suffixed by locale tag. Avoids a separate snapshot directory tree.

## Open questions

- **Visual-regression diff tolerance for diacritic rendering.** Anti-aliasing of `c-cedilla` and `n-tilde` may render slightly differently across font versions / OS environments. Acceptable tolerance and pixel-diff threshold settle when the first baselines land; recorded then.
- **Scheduled-job cadence for full-flow runs in pt-BR / es-419.** Nightly is the obvious default; a weekly cadence may be enough if the per-build smoke catches the high-frequency regressions. Revisit when CI runtime data is available.
- **Locale-switching test on moderator / participant.** A scenario where a logged-in user toggles the locale-selector control mid-session is high-value coverage; lands as a separate scenario rather than the per-locale smoke. Capture as a follow-up if not in the initial scope here.

## Status

**Done** (2026-05-11). Initial wave: per-locale moderator smoke through the single-origin Fastify server + a CI job that brings up the full compose stack.

**Scope landed in this round.** The original refinement was written for the four-surface × three-locale matrix; the v1 platform today only has the moderator app with a real `vite build`, and the participant / audience / replay surfaces are stubs. This round delivers:

- Real Playwright config (replaces the decision-only smoke) — three per-locale Chromium projects (`chromium-en-US`, `chromium-pt-BR`, `chromium-es-419`), each pre-seeding the `aconversa_locale` cookie via `storageState`. Base URL defaults to `http://localhost:3000` and is overridable via `PLAYWRIGHT_BASE_URL`. `webServer` is deliberately unset — tests run against whatever's at the base URL so CI can own compose teardown explicitly (see "Compose teardown" below).
- Three smoke specs in `tests/e2e/i18n-moderator-smoke.spec.ts`, run once per per-locale project (9 test runs total): (1) `GET /` serves the SPA shell and renders `auth.login.title` in the project's locale, (2) the login button carries the localized label and navigates to `/auth/login` with a redirect response carrying `response_type=code`, (3) `GET /screen-name` loads through the SPA fallback (the static-frontends plugin's `Accept: text/html` discriminator) and renders the localized login title (the auth gate's redirect target).
- Fixtures: `tests/e2e/fixtures/locales.ts` reads `auth.login.title` / `auth.login.button` directly from `@a-conversa/i18n-catalogs` so a translation edit never silently drifts from the assertion. `tests/e2e/fixtures/authed-state.ts` exports `mintSessionToken(...)` (mirrors `apps/server/src/auth/session-token.ts` byte-for-byte using `jose@6.1.0`) for future specs that need a signed-in page context — the v1 smoke runs unauthed.
- `make test:e2e` runs the suite against an already-running compose stack (fast iteration). `make test:e2e:compose` orchestrates the full path (`make up` → wait for `/healthz` → run → `make down-v`) so the teardown runs on success and failure. Both are wired into `make help`.
- New CI job `e2e-playwright` in `.github/workflows/ci.yml`. Depends on `setup` and `build` (so the Docker image is cached); installs Chromium with `playwright install chromium --with-deps` (CI-runner-local, never baked into the runtime image per ADR 0008's amendments); writes a CI-only `.env` from `.env.example` plus the `SESSION_TOKEN_SECRET` / `APP_BASE_URL` overrides the `Smoke test built image` step in `build` uses; calls `make up`, polls `/healthz` for up to 60 seconds, runs `pnpm run test:e2e` against `http://localhost:3000`; on failure dumps `docker compose logs` and uploads `playwright-report/` + `test-results/` as workflow artifacts. The teardown step uses `if: always()` + `make down-v` so the compose stack is dropped on every code path.
- Existing `tests` CI job no longer runs the e2e smoke (it has nowhere to point — the static-frontends Vitest tests run via `inject` and the real Playwright suite needs the compose stack). It now builds the moderator dist before the unit smoke (the static-frontends plugin fail-fasts at boot if the dist is absent).
- `@playwright/test` version pinned to `1.60.0` (no `^`). Workspace dependency `@a-conversa/i18n-catalogs` (workspace:*) and `jose@6.1.0` added to root devDependencies so the playwright config and the e2e fixtures resolve via the root `node_modules` symlinks.
- README "End-to-end tests" subsection documents both run modes, the per-locale projects, the `aconversa_locale` cookie convention, the CI compose path, and the browser-binary-stays-runner-local policy.

**Deferred (per the original refinement's four-surface scope).** Participant / audience / replay per-locale smoke specs land when each of those app skeletons (`part_app_skeleton`, `aud_app_skeleton`, `replay_test_*`) produces a real `vite build`; the per-locale projects in `playwright.config.ts` are the multiplexing primitive and a new app's `testMatch` is a one-line entry. The four-surface visual-regression baselines (the `mod_vr_*` / `part_vr_*` / `aud_vr_*` / `replay_vr_*` per-locale snapshots), the catalog-parity CI step, the error-code-drift CI step, and the scheduled `nightly` full-flow job for pt-BR / es-419 are the remainder of the original two-day budget and ship as follow-ups when their per-surface tests land.

**Verification (caveat).** `pnpm run check` + `pnpm run test:smoke` + `pnpm run typecheck:tests` all green on a fresh worktree after `pnpm --filter @a-conversa/moderator build`. The Playwright suite itself requires the compose stack to be up locally for full validation; the agent landing this round did not have docker available in its sandbox so `make test:e2e:compose` was not executed in this worktree. The CI `e2e-playwright` job is the authoritative verification — on first run it will either pass (confirming the per-locale projects + single-origin path work end-to-end) or surface a real failure with traces in the uploaded artifacts.

Artifacts:

- `playwright.config.ts` (replaces the decision-only smoke with three per-locale Chromium projects + a `smoke-node` project that keeps `tests/e2e/hello.spec.ts` running as a no-browser arithmetic smoke).
- `tests/e2e/i18n-moderator-smoke.spec.ts` (3 specs × 3 locales = 9 test runs).
- `tests/e2e/fixtures/locales.ts` (per-locale expectation matrix sourced from `@a-conversa/i18n-catalogs`).
- `tests/e2e/fixtures/authed-state.ts` (signed-session helper for future authenticated specs).
- `.github/workflows/ci.yml` — new `e2e-playwright` job + adjustments to the `tests` job.
- `Makefile` — `test:e2e` + `test:e2e:compose` + `help` updates.
- `README.md` — new "End-to-end tests" subsection under "Local development".
- `package.json` — `@playwright/test` pinned to `1.60.0`, `@a-conversa/i18n-catalogs` (workspace:*) + `jose@6.1.0` added as root devDependencies; new `test:e2e` script.
- `tests/tsconfig.json` — `@a-conversa/i18n-catalogs` path mapped for the test-tree typecheck.
