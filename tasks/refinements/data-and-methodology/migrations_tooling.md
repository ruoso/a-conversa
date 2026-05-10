# Migrations runner and conventions

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.schema.migrations_tooling`
**Effort estimate (placeholder)**: 1d
**Inherited dependencies**: none in TaskJuggler — but in practice, the choice of migrations tool depends on the chosen backend language. See open question below.

## What this task is

Pick and configure the database migrations tooling. Establish conventions for how migrations are written, named, applied (locally and in production), and rolled back.

## Why it needs to be done

Every other schema task (`users_table`, `sessions_table`, etc.) is the work of *writing the migration*. The runner has to be in place first. Beyond v1, every change to the schema lands as a migration; the conventions matter from the start.

## Inputs / context

From [docs/architecture.md — storage](../../../docs/architecture.md#storage):

> PostgreSQL for everything.

From [docs/architecture.md — local development environment](../../../docs/architecture.md#local-development-environment):

> Reproducible builds — the same Compose file should produce the same dev environment on any machine that has Docker.

From [docs/architecture.md — deployment](../../../docs/architecture.md#deployment):

> Single Docker image for the application + a managed PostgreSQL.

Downstream tasks that depend on this:

- All other `data_and_methodology.schema.*` tasks (the actual migrations).
- `deployment.prod_migrations.migration_runner_in_prod` (production deploys).
- `deployment.prod_migrations.rollback_strategy`.

## Constraints / requirements

- Migrations are append-only and ordered (typical pattern: numeric or timestamped filename prefix).
- Migrations run automatically as part of the local-dev Compose startup — `make up` (or equivalent) brings up Postgres and applies all pending migrations before the app starts.
- Migrations also run as part of production deployment (per `deployment.prod_migrations`).
- Rollback strategy exists (downgrade migrations, or forward-fix-only with snapshots — see open question).
- Conventions for naming, idempotency, and review documented.

## Acceptance criteria

- A specific migrations tool chosen (typically idiomatic for the backend language).
- A directory structure for migrations and a naming convention documented.
- A working "up" path: a fresh database has all current migrations applied.
- Documented (and tested) rollback strategy.
- The local-dev Compose stack auto-applies migrations on startup.
- A README section or doc covering: where migrations live, how to add one, how the rollback story works, how production deploys handle them.

## Decisions

- **Application refuses to start if pending migrations exist** (C6). The startup health check verifies the migration state and aborts if anything is unapplied.
- **Tool: `node-pg-migrate`** (T4). Minimal, raw-SQL migrations, no ORM imposition. Suits the project: we already speak SQL directly through CHECK-constraint conventions; migrations stay close to the schema we read.
- **Policy: forward-only** (T5). Revert a bad migration by writing a new forward migration that undoes it. No down-scripts to maintain that may have rotted; one path through history is the only path.
- **Dependency on `lang_decision` is explicit** in the `.tji` (I3). Resolved.

## Open questions

(none — all decided)

## Status

**Done** 2026-05-10. See [ADR 0020](../../../docs/adr/0020-migrations-node-pg-migrate-forward-only.md).

What landed:

- `node-pg-migrate@8.0.4` + `pg@8.20.0` pinned as `dependencies` on `@a-conversa/server`.
- Migrations directory at [`apps/server/migrations/`](../../../apps/server/migrations/) with one bootstrap migration `0000_meta.sql` (creates `_aconversa_meta` and self-records). File-naming convention: `NNNN_short_name.sql` (deviates from node-pg-migrate's default 13-digit-ms timestamps; readability at our scale, ordering still works since the tool sorts by filename).
- Runner entry point at [`apps/server/scripts/migrate.ts`](../../../apps/server/scripts/migrate.ts) — reads `DATABASE_URL`, hard-codes `direction: 'up'` (forward-only), `singleTransaction: true`, `checkOrder: true`. Logs applied migrations or "no pending migrations".
- Workspace script: `pnpm --filter @a-conversa/server run migrate`. Root convenience: `pnpm run migrate`. Make target: `make migrate` (rewrites `@postgres:` → `@localhost:` in the `.env` `DATABASE_URL` so the host-side runner reaches the published 5432).
- Verified end-to-end against the running Compose stack: fresh DB applied `0000_meta`, `\dt` shows both `pgmigrations` and `_aconversa_meta`, second `make migrate` is a no-op.

**Deferred to `backend.api_skeleton`**: the C6 rule that the application **refuses to start with pending migrations**. That gate lives inside the runtime entry point, which is still the ADR-0015 stub. The runner this task ships will be imported and called from that future startup path; recording the deferral here so the link doesn't get lost.
