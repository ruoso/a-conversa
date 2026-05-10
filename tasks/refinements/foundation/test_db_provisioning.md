# Test-database provisioning per test run

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.test_infra.test_db_provisioning`
**Effort estimate**: 1d
**Inherited dependencies**: `foundation.stack_decisions, foundation.repo_skeleton` (both settled)

## What this task is

Build a helper that gives every test (or test scenario) a fresh, isolated PostgreSQL database. Run migrations, optionally load a fixture, and tear down at the end. Required by behavior tests, integration tests, and Playwright E2E.

## Why it needs to be done

Without per-test DB isolation, tests interact and become flaky. The "every test gets a clean state" property is what lets the BDD layer write scenarios that rely on a known starting point.

## Inputs / context

- Postgres in compose (per `dockerfile_postgres`).
- node-pg-migrate (per T4) applies migrations.
- Fixtures (per `seed_data_for_tests`) loaded by replaying through the application's event-append code (per R23).

## Decisions

- **Per-test database, not per-test schema.** A separate database per test gives the strongest isolation and avoids the `search_path` complexity that schema-based isolation introduces. Postgres handles many small databases fine.
- **Database naming: `test_<random_uuid>`** so concurrent test runs don't collide.
- **Lifecycle**: helper provisions the DB → applies migrations → optionally loads fixture → returns connection details → after test, drops the DB.
- **Provisioning happens against the same Postgres instance the running app uses in dev** — no separate test DB cluster. (Production uses a different cluster; dev and tests share.)
- **Helper exports** a typed function: `withTestDb<T>(fixture, fn: (conn) => Promise<T>): Promise<T>` — handles setup, runs the body, handles teardown even on test failure.
- **Cucumber Before/After hooks** call this helper for every scenario.
- **Playwright** uses the same helper at the per-test level (or per-spec, depending on speed).

## Acceptance criteria

- A `packages/test-db/` workspace (or helper inside `packages/test-fixtures/`) exporting `withTestDb` and `provisionTestDb` / `dropTestDb`.
- Cucumber hooks integrated.
- Playwright fixture / hook integrated.
- Behavior + integration + Playwright tests use clean DBs without interference.
- Concurrent test runs (e.g., parallel Vitest specs that hit the DB) don't collide.
