# 0016 — Postgres container: upstream `postgres:16-alpine`, no custom image

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

The local-dev Docker Compose stack needs a PostgreSQL service. Postgres is the only storage layer in v1 (per [docs/architecture.md](../architecture.md) "Storage" — global tables for nodes/edges/annotations/users, per-session tables, and a per-session append-only `session_events` event log; no graph database). Every backend test, every event-log append, and every projection rebuild hits this database. The foundation refinement at [tasks/refinements/foundation/dockerfile_postgres.md](../../tasks/refinements/foundation/dockerfile_postgres.md) settled the broad shape; this ADR records the concrete choices and the boundary against the surrounding tasks.

The application image is a separate concern with its own multi-stage build ([ADR 0015](0015-dockerfile-multi-stage-pnpm-corepack.md)); the two coexist as Compose services. The Postgres container is needed *now* by `foundation.dev_env.compose_file`, even though the application's migration runner and the schema itself land later (with `backend.api_skeleton` and `data_and_methodology.schema`).

## Decision

Use the **upstream `postgres:16-alpine` image** directly, with no custom Dockerfile. Configuration lives entirely in the Compose service definition and a small `infra/postgres/` directory documenting the conventions.

- **Major version pinned at 16.** Current LTS. Pinned in the compose-file image tag (`postgres:16-alpine`, not `postgres:latest`, not `postgres:16` floating on minor). Bump when the LTS rolls.
- **Alpine variant.** Smaller image, matches the application image's runtime base. If musl-vs-glibc friction with extensions ever shows up, the fallback is `postgres:16-bookworm` — same configuration shape, one-line change.
- **No extensions in v1.** Plain Postgres is enough for the current schema (relational tables + an append-only event log; no full-text search, no `pg_stat_statements`, no PostGIS). When a real performance-debugging or feature need lands, an extension is added by an init script (see below) and recorded in a new ADR.
- **Persistent named volume `aconversa-postgres-data`** mounted at `/var/lib/postgresql/data`. Dev data survives ordinary `docker compose down`. Reset is `docker compose down -v` — one command, no manual `rm -rf`. Per-test isolation (clean DB per Playwright test) is *not* this container's concern; that's `foundation.test_infra.test_db_provisioning`.
- **Init-script directory present but empty.** `infra/postgres/initdb/` is mounted into the upstream image's `/docker-entrypoint-initdb.d/`. Ships with only a `.gitkeep`. The hook exists so a future extension-enable script has an obvious home; **schema does not go here** — the application owns schema, applied via node-pg-migrate (forward-only, per the data-and-methodology refinements) on startup.
- **Healthcheck with `pg_isready`.** Compose's `healthcheck:` block runs `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB`. The application service depends on the health gate so it doesn't open a pool or run migrations before first-start init has finished.
- **Dev credentials by convention** — `POSTGRES_USER=aconversa`, `POSTGRES_DB=aconversa`, password from env. The actual `.env.example` is authored by `foundation.dev_env.env_var_template`; this ADR only fixes the *names* and the user/db convention so the surrounding tasks line up.
- **Host port 5432 published.** Default Postgres port, mapped 1:1 so host-side tools (`psql`, GUI clients, the app running outside the container during development) reach the database the obvious way. Conflicts on the host port are handled by personal Compose override files, not by changing the committed config.

## Consequences

- **No custom image to maintain, scan, or rebuild.** The upstream image is well-known, well-tested, and security-patched on a public cadence. Bumping Postgres is a one-line tag change in the compose file.
- **Schema is owned by the application, not the container.** node-pg-migrate runs on app startup; the database is initialised empty and the first app boot brings it up to schema. This keeps the local-dev story and the cloud-deployment story (where the same migrations apply against a managed Postgres) identical at the data layer — the cloud deployment doesn't have a Compose `initdb/` mount, and we rely on it not having one.
- **`docker compose down -v` is the documented reset.** A small UX cost (the `-v` is not the default, easy to forget) for a real safety property: data doesn't disappear on a typo.
- **Compose wiring is deferred** to `foundation.dev_env.compose_file`. That task consumes the choices recorded here and writes the actual service block. This ADR's job is to make those choices boring, not to author YAML.
- **`.env.example` is deferred** to `foundation.dev_env.env_var_template`. The variable *names* are fixed here so this task and that one don't drift.
- **Production / cloud deployment doesn't inherit this ADR directly.** Cloud uses managed Postgres (RDS, Cloud SQL, or equivalent) with rotated secrets and no `initdb/` mount; the relevant ADR will live under `deployment.*` when that work lands. The schema migration story is shared; the container is not.
- **No Dockerfile under `infra/postgres/`.** Deliberate. If a future change requires one (e.g., a custom extension that isn't available in upstream Alpine), this ADR is superseded by a new one and a Dockerfile lands then.

## Amendments

- **2026-05-10** — The "Compose wiring is deferred" and "`.env.example` is deferred" lines above have both resolved. Compose wiring landed with [ADR 0018](0018-compose-file-three-service-dev-stack.md) — the `postgres` service in [`compose.yaml`](../../compose.yaml) consumes the choices recorded here (image tag, named volume `aconversa-postgres-data`, `pg_isready` healthcheck, host port 5432, init-script bind mount of `infra/postgres/initdb/`). `.env.example` landed at [`.env.example`](../../.env.example) under `foundation.dev_env.env_var_template` with `POSTGRES_USER=aconversa`, `POSTGRES_PASSWORD=aconversa-dev`, `POSTGRES_DB=aconversa`, and a derived `DATABASE_URL`. The decision (`postgres:16-alpine`, no custom image) is unchanged.
