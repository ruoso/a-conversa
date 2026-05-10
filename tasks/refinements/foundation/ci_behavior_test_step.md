# CI step running behavior tests

**TaskJuggler entry**: `foundation.test_infra.ci_behavior_test_step` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort estimate**: 0.25d

## What and why

CI job running Cucumber behavior tests against the running application. Requires Postgres and Authelia service containers.

## Decisions

- Job name: `behavior-tests`.
- Runs `pnpm test:behavior`.
- Spins up Postgres and Authelia as service containers.
- Test DB provisioning per scenario via `withTestDb` (per `test_db_provisioning`).
- Sequential (or low-parallel) — too much DB churn for high parallelism on the free CI tier.

## Acceptance criteria

- A `behavior-tests` job in CI.
- Service containers (Postgres, Authelia) configured.
- Failing scenarios fail the job.
