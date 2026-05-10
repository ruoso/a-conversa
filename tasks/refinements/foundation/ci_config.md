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
