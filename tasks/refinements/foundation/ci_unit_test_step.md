# CI step running unit tests

**TaskJuggler entry**: `foundation.test_infra.ci_unit_test_step` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort estimate**: 0.25d

## What and why

CI job running Vitest unit tests across all workspaces.

## Decisions

- Job name: `unit-tests`.
- Runs `pnpm test:unit --coverage`.
- Reports coverage as a CI artifact.
- Parallel with `lint`, `format`, `typecheck`.
- Doesn't depend on Postgres or Authelia — unit tests are isolated.

## Acceptance criteria

- A `unit-tests` job in CI.
- Coverage artifact uploaded.
- Failing tests fail the job.
