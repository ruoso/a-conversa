# 0020 — Database migrations: `node-pg-migrate`, forward-only, refuse-to-start gate

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

The data-and-methodology workstream is about to land a sequence of
schema tasks (`users_table`, `sessions_table`, `nodes_table`, the M-N
joins, the per-session event log). Every one of those tasks writes a
migration; the runner has to be in place first. The refinement at
[tasks/refinements/data-and-methodology/migrations_tooling.md](../../tasks/refinements/data-and-methodology/migrations_tooling.md)
already settled three things — tool `node-pg-migrate` (T4),
forward-only policy (T5), and the "app refuses to start with pending
migrations" rule (C6). This ADR records the implementation choices.

The runtime entry point for `apps/server` is still the stub from
[ADR 0015](0015-dockerfile-multi-stage-pnpm-corepack.md); the real
HTTP/WebSocket process lands with `backend.api_skeleton`. So this ADR
gets the migration *runner* in place; the start-up gate that consumes
it is **deferred to that downstream task**.

## Decision

**Tool: `node-pg-migrate@8.0.4`** plus **`pg@8.20.0`**, both pinned as
`dependencies` (not devDependencies) on `@a-conversa/server`.
Application code, not workspace tooling. Considered and rejected:
Knex (drags in a query builder we wouldn't use); Prisma (schema-first
ORM, conflicts with our event-sourced write path); hand-rolled
`psql`-on-`*.sql` (would have to reinvent ordering, the tracking
table, the advisory lock).

**Forward-only policy.** Migrations are `.sql` files with no
`-- Down Migration` section. To revert, write a new migration that
undoes it. One path through history is the only path; down-scripts
that get written but never exercised rot silently. The runner is
invoked with `direction: 'up'` hard-coded in
[`apps/server/scripts/migrate.ts`](../../apps/server/scripts/migrate.ts).
No `migrate:down` script. Production rollback is owned separately by
`deployment.prod_migrations.rollback_strategy`; the on-disk story is
forward-only regardless. Enforcement is code review — the runner
itself ignores `-- Down Migration` blocks during up runs.

**File naming: `NNNN_short_name.sql`** with a four-digit zero-padded
prefix; lexicographic ordering matches apply order. This deviates
from `node-pg-migrate`'s default 13-digit-millisecond timestamp
template — chosen for readability at this project's scale (the tool
orders by filename, so `0000_meta.sql`, `0001_users.sql`, … work).
The CLI emits a benign `Can't determine timestamp for 0000` log line
during apply; informational, not an error.

**Migrations live at `apps/server/migrations/`** per refinement R4
and the existing
[`infra/postgres/README.md`](../../infra/postgres/README.md) note —
schema migrations are *not* Postgres init scripts. The bootstrap
migration `0000_meta.sql` creates `_aconversa_meta (schema_version
TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)` — proves the runner works
against a fresh DB and gives us a tiny home for any application-level
schema metadata that doesn't fit in `pgmigrations`.

**Runner entry point: `apps/server/scripts/migrate.ts`.** Single TS
script invoked via `tsx`. Reads `DATABASE_URL` from the environment,
calls `runner({ databaseUrl, dir, direction: 'up', migrationsTable:
'pgmigrations', singleTransaction: true, checkOrder: true })`, logs
applied migrations (or "no pending migrations"), exits non-zero on
error. `singleTransaction: true` means a mid-batch failure leaves the
database at the previous consistent state. This is the one entry
point both `make migrate` and the eventual app-startup health check
call.

**Local-dev integration.** `make migrate` reads `.env`, rewrites
`@postgres:` to `@localhost:` in the `DATABASE_URL` so the host-side
`tsx` reaches host-published 5432, and runs `pnpm run migrate` (which
delegates via `pnpm --filter @a-conversa/server run migrate`). Inside
the eventual app container the unmodified URL is correct — the same
script serves both contexts.

**Production integration.** Production deploys call the same
`migrate.ts` against the production `DATABASE_URL` before bringing up
the new application image. The runbook is owned by
`deployment.prod_migrations.migration_runner_in_prod`; this ADR pins
the entry point that task will wire.

**The startup gate is deferred.** The "app refuses to start with
pending migrations" rule (C6) lives in the application's startup
path, which doesn't exist yet. `backend.api_skeleton` will import
the same runner programmatically, run it, and abort startup if any
migrations were pending or any error occurred. Recorded here so
future readers know this ADR establishes only half of C6's
implementation.

## Consequences

- Every schema task downstream writes a `.sql` migration under
  `apps/server/migrations/` and ships it with the schema PR. No
  separate "register the migration" step.
- `pgmigrations` survives `make down` (the named Postgres volume
  already does); `make down-v` drops it and the next
  `make up && make migrate` re-applies everything — the desired
  reset.
- Until `backend.api_skeleton` lands, the local workflow is "remember
  to run `make migrate` after `make up`." Once the start-up gate
  exists, forgetting will fail fast.
- We deliberately use only the `runner({ databaseUrl, dir,
  direction: 'up', ... })` entry point plus `.sql` migration files;
  `node-pg-migrate`'s broader DSL/builder surface is a non-goal.
