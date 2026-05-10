# tests/behavior/support — Cucumber + pglite scaffold

This directory holds the Cucumber **World**, **hooks**, and the
test-only **migration runner** that together give every `.feature`
scenario a fresh, in-process Postgres database.

It pre-empts `foundation.test_infra.test_db_provisioning`. When that
task formalizes, it inherits this pattern.

## Per-scenario lifecycle

Cucumber's `Before` hook in [`world.ts`](./world.ts) runs before every
scenario and does three things:

1. Instantiates a fresh `new PGlite()` — an in-memory Postgres-in-WASM
   handle. Each scenario gets its own; there is no shared state across
   scenarios.
2. Calls `applyMigrations(db)` from [`migrate.ts`](./migrate.ts), which
   replays every SQL file under `apps/server/migrations/` in
   lexicographic order, recording each into a `pgmigrations` table whose
   shape matches what `node-pg-migrate` produces in production.
3. Exposes the handle on the World as `this.db` plus a thin
   `LoadFixtureClient`-compatible `this.client` (for steps that call
   the fixture loader directly).

The `After` hook closes the pglite handle.

## Why pglite, not Testcontainers / SQLite / compose Postgres

Decided in [ADR 0007](../../../docs/adr/0007-behavior-test-framework-cucumber.md) (Decision section, amended on 2026-05-10) and reinforced by [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):

- **Not SQLite** — the schema uses Postgres-specific features (JSONB,
  partial unique indexes `WHERE left_at IS NULL`, `gen_random_uuid()`,
  TIMESTAMPTZ, CHECK with rich expressions). Testing against SQLite
  would mean skipping those (defeats the purpose) or translating them
  (engine-divergence bugs). pglite is real Postgres in WASM — same
  parser, same planner, same constraint engine.
- **Not Testcontainers** — multi-second Docker startup per suite plus a
  Docker prerequisite for every Cucumber run. pglite is in-process,
  sub-second startup, hermetic per scenario by construction.
- **Not the compose Postgres** — that stack is reserved for Playwright
  E2E. Cucumber here is the *integration* layer, deliberately faster
  than booting Compose and deliberately hermetic so scenarios don't
  observe each other.

## Why `migrate.ts` re-implements the runner

`node-pg-migrate` expects a `pg.ClientBase`, which pglite does not
produce. Rather than wrap pglite in a synthetic pg-protocol adapter
(fragile, large surface area), the test-only runner reads the same SQL
files directly and tracks them in a `pgmigrations` table with the same
shape `node-pg-migrate` produces. This means:

- The application schema applied in tests is byte-identical to what
  production runs.
- A future swap to `node-pg-migrate` proper (e.g., if a pglite
  pg-protocol adapter becomes maintained) is mechanical — the
  `pgmigrations` table is already the right shape.

The split is documented in the header of
[`migrate.ts`](./migrate.ts) too.

## Rules for adding new behavior scenarios

1. **No ad-hoc probes.** Any "does pglite support X / does this
   constraint fire" question is answered by a committed scenario, not
   a `node -e` or interactive `psql`. See [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md).
   The first scenario in a new file IS allowed to be the probe — but
   the probe is committed.
2. **Per-area layout.** Feature files live under
   `tests/behavior/<area>/<feature>.feature`; their step definitions
   live under `tests/behavior/steps/<feature>.steps.ts`.
3. **Shared helpers go in [`helpers.ts`](./helpers.ts).** The current
   set covers stable test UUIDs, an `expectQuery` wrapper that
   captures errors on the World, and small `insertUser` /
   `insertSession` / `insertNode` helpers so step defs don't repeat
   boilerplate.
4. **Don't mutate the World between scenarios.** The `Before` hook is
   the single point of construction. If you need per-scenario state,
   use `this.scratch`.
5. **Step phrases must be Cucumber-Expression safe.** `{`, `}`, `(`,
   `)`, `\`, and `/` are reserved by the expression parser — if you
   need them in literal step text, either escape them or pin the
   literal in the step definition file. See
   [`steps/pglite-feature-support.steps.ts`](../steps/pglite-feature-support.steps.ts)
   for the JSONB example.

## How to run

- All behavior scenarios: `pnpm run test:behavior:smoke` — runs every
  `.feature` under `tests/behavior/`. (Despite the historical name,
  this target now runs the full integration suite, not just the
  hello-world smoke. Renaming is deferred to keep `make test` stable.)
- Full test gate: `make test` — Vitest unit + Cucumber behavior +
  Playwright E2E smoke.

The pre-commit hook does **not** run Cucumber (per refinement R24); CI
does (`foundation.ci.ci_behavior_test_step`); locally `make test`
runs them.

## Pointers

- The rules: [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md).
- The layering: [ADR 0006](../../../docs/adr/0006-unit-test-framework-vitest.md) (unit), [ADR 0007](../../../docs/adr/0007-behavior-test-framework-cucumber.md) (integration via Cucumber+pglite), [ADR 0008](../../../docs/adr/0008-e2e-framework-playwright.md) (E2E).
- The schema this exercises: [`apps/server/migrations/`](../../../apps/server/migrations/).
- The fixture loader this exercises: [`packages/test-fixtures/src/loader.ts`](../../../packages/test-fixtures/src/loader.ts).
- The production runner this mirrors: [`apps/server/scripts/migrate.ts`](../../../apps/server/scripts/migrate.ts).
