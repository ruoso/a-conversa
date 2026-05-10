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
- **The dependency on `lang_decision` is now explicit** (I3 — see below). Now that T1 is TypeScript/Node, this task's content is well-defined.

## Open questions

- **Tool choice (T4).** Now that the backend is **TypeScript/Node**, the live candidates are:
  - **Knex** — query builder + migrations. Mature, widely used.
  - **Drizzle migrate** — newer, type-safe, schema-as-code.
  - **Prisma migrate** — schema-first; requires Prisma's runtime.
  - **node-pg-migrate** — minimal, just migrations on raw SQL.
  - Or a language-agnostic tool: **dbmate** or **atlas** — pure SQL migrations independent of the application stack.
  **Awaiting input.**
- **Migration policy (T5).** Forward-only (revert by writing a new forward migration) vs. up-and-down (every migration ships with a rollback). **Awaiting input.**

## Doc inconsistencies surfaced (not decisions)

- **I3.** This task's `.tji` entry should gain `depends !!lang_decision` (or absolute path) now that the language choice is made. Pending fix.
