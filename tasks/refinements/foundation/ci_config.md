# Set up CI configuration

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.ci.ci_config`
**Effort estimate**: 1d
**Inherited dependencies**: `foundation.repo_skeleton` (settled)

## What this task is

Set up the CI configuration that runs on every push and pull request. Provides the foundation that the per-step CI tasks (`ci_lint`, `ci_format`, `ci_typecheck`, `ci_build`, `ci_image_publish`, `ci_dependency_audit`, plus the test-infra CI steps) plug into.

## Why it needs to be done

CI is what catches regressions before they merge. A working CI config is the platform every other CI step (lint, format, typecheck, tests, build, publish) extends.

## Inputs / context

- Repo lives in git (assumed GitHub).
- pnpm workspaces; node-pg-migrate; Vitest; Cucumber; Playwright; Postgres in compose.
- Husky pre-commit catches lint/format/typecheck locally; CI re-runs as the safety net.

## Constraints / requirements

- Runs on push to any branch and on every pull request.
- Caches pnpm store between runs.
- Spins up Postgres and Authelia services for tests that need them.
- Runs jobs in parallel where independent (lint / typecheck / unit tests can all run alongside each other).
- Reports clearly: failed step, failed test, why.

## Decisions

- **CI provider: GitHub Actions.** Standard for GitHub-hosted repos; free for open-source; tight integration with PRs.
- **One workflow file per concern**: `.github/workflows/ci.yml` for the per-PR pipeline; `.github/workflows/release.yml` for tagged releases (image publish).
- **Use `actions/setup-node@vN` with Corepack** to get pnpm.
- **Cache `pnpm store` and `node_modules` per-workflow** keyed on the `pnpm-lock.yaml` hash.
- **Postgres + Authelia spun up as service containers** for jobs that need them (integration, behavior, Playwright).
- **Job parallelism**: lint, format-check, typecheck, unit-tests, behavior-tests, Playwright-e2e all run as separate jobs; build is a single job; image-publish only on tagged release.

## Acceptance criteria

- `.github/workflows/ci.yml` exists with the structure above.
- A trivial commit triggers the workflow and all jobs pass on a clean repo.
- Failed steps surface useful messages in the GitHub UI.
- Workflow runs in under 10 minutes on the steady-state path (post-cache-warmup).

## Status

**Done — 2026-05-10.**

- Per-PR workflow lives at
  [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml):
  triggers on every `pull_request` and on `push` to `main`; a
  `concurrency: ci-${{ github.ref }}` block with
  `cancel-in-progress: true` supersedes in-progress runs on the same
  ref. Three jobs — `setup`, `checks` (depends on setup; runs lint,
  format:check, the three typechecks), `tests` (depends on setup;
  installs Playwright Chromium then runs the three smoke suites).
  Node 20 via `actions/setup-node@v4`; pnpm via Corepack reading the
  `packageManager` pin from root `package.json`; pnpm store cached via
  `actions/cache@v4` keyed on `hashFiles('pnpm-lock.yaml')`.
- Tagged-release stub at
  [`.github/workflows/release.yml`](../../../.github/workflows/release.yml):
  triggers on `push: tags: ['v*']`; single placeholder job that prints
  "release pipeline TODO" and exits 0. Real wiring is owned by
  `foundation.ci.ci_image_publish`.
- ADR
  [0019](../../../docs/adr/0019-ci-github-actions.md)
  records the rationale (GitHub Actions; two workflow files;
  Corepack-via-`actions/setup-node`; cached pnpm store; the deferred
  per-concern parallelism; the deferred service containers; the
  concurrency-cancellation choice).
- Verified: `python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))'`
  on both workflow files exits 0 with no output. The pre-commit hook
  (ESLint / Prettier / `tsc -b`) runs at commit time and is the only
  locally-enforced validation; the workflow itself is first exercised
  on the next PR.

## Deferrals (explicit)

- **Per-concern parallel job splits.** v1 ships `checks` and `tests`
  as combined sequential jobs; each downstream task takes one
  concern out and gives it its own job:
  - `foundation.ci.ci_lint` — `pnpm run lint` to its own job.
  - `foundation.ci.ci_format` — `pnpm run format:check` to its own job.
  - `foundation.ci.ci_typecheck` — split the three typecheck commands.
  - `foundation.test_infra.ci_unit_test_step` — `pnpm run test:smoke`.
  - `foundation.test_infra.ci_behavior_test_step` — `pnpm run test:behavior:smoke`.
  - `foundation.test_infra.ci_playwright_step` — `pnpm run test:e2e:smoke`,
    plus pinning Playwright + caching the browser binaries.
- **Service containers (Postgres + Authelia).** Today's smoke suites
  don't need either. The trigger to add them is a real test reaching
  for a real DB —
  `foundation.test_infra.test_db_provisioning` plus the per-runner CI
  tasks above. A `TODO` comment in `ci.yml` marks the insertion
  point.
- **Build job (`pnpm -r build` in CI).** `foundation.ci.ci_build`.
- **Image build + push on tagged release.** `foundation.ci.ci_image_publish`
  fills the body of `release.yml`.
- **Dependency vulnerability scan.** `foundation.ci.ci_dependency_audit`
  (likely a separate `audit.yml` on a `schedule:` cron, not a
  per-PR step).
