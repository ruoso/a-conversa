# Postgres container config

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.dev_env.dockerfile_postgres`
**Effort estimate**: 0.5d
**Inherited dependencies**: `foundation.repo_skeleton` (settled)

## What this task is

Configure the PostgreSQL container used by the local-dev compose stack. Likely no custom Dockerfile — the upstream `postgres:N-alpine` image is fine — but does need init scripts, a volume mount for data persistence, and dev-environment defaults.

## Why it needs to be done

Every backend test, every event-log append, every projection run hits this database. Local dev needs a Postgres instance that starts cleanly under `make up`, persists data across restarts, and resets cleanly when desired.

## Inputs / context

- Postgres is the chosen storage layer (per architecture.md).
- pnpm workspaces; migrations live at `apps/server/migrations/` (per `dir_layout`).
- Migrations tool: node-pg-migrate (per T4); forward-only (per T5).
- Test fixtures: `packages/test-fixtures/`; loader replays through event-append (per R23).
- Compose file (separate task) wires this container to the application image.

## Constraints / requirements

- Use the upstream `postgres:N-alpine` image (no custom Dockerfile needed).
- Persistent volume for `/var/lib/postgresql/data` so dev data survives `docker compose down` (without `-v`).
- A way to reset cleanly (volume removal + fresh init).
- Dev-environment credentials (matching what the application's `.env.example` expects).
- Optional init script for any extensions we need (none today; reserve a hook).
- Health-check directive so the application waits for Postgres readiness.

## Acceptance criteria

- A Compose service definition (or per-image override file) that:
  - Uses `postgres:LTS-alpine` (specific major version pinned).
  - Mounts a named volume for persistence.
  - Sets dev `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` matching `.env.example`.
  - Exposes 5432 on a host port (likely also 5432) for tooling access.
  - Defines a `healthcheck` using `pg_isready`.
- `docker compose up postgres` brings the database up cleanly.
- Migrations from `apps/server/migrations/` apply against it (separately, via the application's startup or a one-off command).

## Decisions

- **Use the upstream image** — no custom Dockerfile needed.
- **Pin the major version** (e.g., `postgres:16-alpine`). Alpine for size; matches the application image's base where reasonable.
- **Persistent volume for dev data**, easy to reset by `docker compose down -v`.

## Additional decisions

- **Postgres major version: 16 (LTS).** Pin in the compose-file image tag. Bump when LTS rolls.
- **No extensions in v1.** Add `pg_stat_statements` or others when there's a performance-debugging need.
