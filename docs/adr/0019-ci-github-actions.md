# 0019 — CI: GitHub Actions, two workflow files, deferred parallelism

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` ships under git on GitHub (assumed by the broader
project setup; the ADR log, the issue tracker, and the release
artifact destination all live there). The repo is a pnpm workspace
([ADR 0010](0010-directory-layout-pnpm-workspaces.md)) with ESLint
([ADR 0011](0011-linter-eslint-with-typescript-eslint.md)), Prettier
([ADR 0012](0012-formatter-prettier.md)), TypeScript project
references ([ADR 0013](0013-typecheck-tsconfig-strict-with-project-references.md)),
Vitest ([ADR 0006](0006-unit-test-framework-vitest.md)), Cucumber
([ADR 0007](0007-behavior-test-framework-cucumber.md)), and Playwright
([ADR 0008](0008-e2e-framework-playwright.md)). Husky pre-commit
hooks ([ADR 0014](0014-pre-commit-hooks-husky-lint-staged.md)) are
the local fast-feedback path; CI is the authoritative safety net and
the only thing a contributor cannot bypass.

The foundation refinement at
[tasks/refinements/foundation/ci_config.md](../../tasks/refinements/foundation/ci_config.md)
settled the broad shape (GitHub Actions, separate workflow for tagged
releases, Corepack-via-`actions/setup-node`, cached pnpm store, service
containers for jobs that need them, parallel jobs). The downstream CI
tasks (`ci_lint`, `ci_format`, `ci_typecheck`, `ci_build`,
`ci_image_publish`, `ci_dependency_audit`, plus
`foundation.test_infra.ci_unit_test_step` /
`ci_behavior_test_step` / `ci_playwright_step`) each iterate on a
specific concern. This ADR records the workflow-file shape, the
caching choice, and which knobs the v1 deliberately leaves to those
downstream tasks.

## Decision

**GitHub Actions** is the CI provider. Two workflow files live under
`.github/workflows/`:

- **`ci.yml`** — per-PR pipeline. Triggers on `pull_request` (any
  target branch) and on `push` to `main`. A `concurrency` block keyed
  on `ci-${{ github.ref }}` with `cancel-in-progress: true` supersedes
  in-progress runs when a new commit lands on the same ref.
- **`release.yml`** — tagged-release pipeline. Triggers on `push:
  tags: ['v*']`. Today it is a single-step stub that prints "release
  pipeline TODO" and exits 0; the real image-publish wiring is owned
  by `foundation.ci.ci_image_publish`. The trigger is wired now so
  the future contributor only has to fill the job body.

**Three jobs in `ci.yml`** for v1:

1. **`setup`** — checks out, sets up Node 20 via
   `actions/setup-node@v4`, enables Corepack
   (`corepack enable && corepack prepare --activate`), and installs
   workspace dependencies with `pnpm install --frozen-lockfile`. The
   pnpm store is cached via `actions/cache@v4` keyed on
   `hashFiles('pnpm-lock.yaml')`. `HUSKY=0` is set on install so the
   `prepare` script no-ops in CI (mirrors the Dockerfile pattern from
   ADR 0015's amendment).
2. **`checks`** — depends on `setup`; runs `pnpm run lint`,
   `pnpm run format:check`, `pnpm run typecheck`,
   `pnpm run typecheck:tools`, `pnpm run typecheck:tests` in
   sequence.
3. **`tests`** — depends on `setup`; installs Playwright's Chromium
   binary, then runs `pnpm run test:smoke`,
   `pnpm run test:behavior:smoke`, `pnpm run test:e2e:smoke` in
   sequence.

**The pnpm version pin lives in `package.json`'s `packageManager`
field** (per ADR 0010, currently `pnpm@9.15.4`). Corepack reads that
pin; the workflow does not name a pnpm version directly. One pin, one
place.

**Deferrals settled in this ADR**:

- **Per-concern job parallelism.** The refinement called for separate
  jobs for lint, format, typecheck, unit-tests, behavior-tests, and
  Playwright. The downstream CI tasks each own that split for their
  concern: `ci_lint`, `ci_format`, `ci_typecheck`,
  `foundation.test_infra.ci_unit_test_step`,
  `ci_behavior_test_step`, `ci_playwright_step`. The v1 workflow keeps
  the per-step structure (each is a separate `run:` step with the
  downstream task named in its label) so splitting later is a
  copy-paste, not a redesign. v1 ships as two combined jobs (`checks`,
  `tests`) so the workflow isn't six near-identical install jobs
  before any task that owns the split has fired.
- **Postgres + Authelia service containers.** The refinement called
  for them; today's smoke suites don't talk to either, so wiring
  service containers now would only add cold-start latency. The
  trigger to add them is a real test reaching for a real DB — owned
  by `foundation.test_infra.test_db_provisioning` plus the per-runner
  CI tasks. The forward pointer lives in `ci.yml` as a `TODO`
  comment.
- **`ci_build`, `ci_image_publish`, `ci_dependency_audit`.**
  Separately tasked. `ci_build` adds a build job to `ci.yml`;
  `ci_image_publish` fills `release.yml`; `ci_dependency_audit` adds
  a scheduled job (likely a `schedule:` cron, separate from PR runs).

## Consequences

- **Every PR runs lint, format-check, the three typechecks, and the
  three smoke suites end-to-end.** The pre-commit hook covers most of
  this locally; CI catches what the contributor skipped with
  `--no-verify` and what the hook deliberately doesn't run (smoke
  tests, ADR 0014).
- **Cold-start CI is slower than it needs to be — temporarily.** v1's
  three jobs (`setup`, `checks`, `tests`) each run a full
  `pnpm install`. Cache hits make the install fast (the store is
  reused), but the work is duplicated. The downstream per-concern
  splits will inherit the same install pattern; the right cleanup is
  a composite action or reusable workflow once we know the final job
  count, not now.
- **Concurrency cancellation prevents queue blow-ups.** A PR with a
  rapid push sequence supersedes its own previous runs; `main`
  pushes group on their ref so a series of merges don't pile up.
  Tagged-release runs (`release.yml`) have no concurrency block —
  every tag is a discrete artifact.
- **Workflow YAML is a text file, not a generated artifact.** No
  workflow generator, no `act` smoke-run gate, no auto-format. Pre-
  commit hooks already format YAML via Prettier
  (ADR 0012 + ADR 0014); that is the only locally-enforced
  validation. The first real run on GitHub is the first real
  validation; a broken workflow file fails the very PR that
  introduces it, which is the right place to catch it.
- **Read-only `permissions: contents: read` by default.** The release
  pipeline (eventually) will need `packages: write` or registry-push
  credentials — that scope expansion lives in `release.yml`, not
  here, so the per-PR workflow can never accidentally push.
- **Two-file split scales.** Adding a nightly dependency-audit
  workflow means a third file (`audit.yml`), not a third trigger
  shoehorned into `ci.yml`. The `release.yml` split sets the
  precedent.
- **No matrix.** v1 runs on a single Node major (20) and a single
  OS (`ubuntu-latest`). Matrixing across Node majors or browser
  builds is owned by the per-concern downstream tasks if/when they
  need it; doing it now would expand a slow workflow without
  catching anything the smoke suites don't already cover.
