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
