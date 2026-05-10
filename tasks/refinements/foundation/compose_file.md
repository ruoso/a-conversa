# `docker-compose.yml` bringing up the full stack

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.dev_env.compose_file`
**Effort estimate**: 1d
**Inherited dependencies**: `dockerfile_app`, `dockerfile_postgres`, `dockerfile_mock_oauth` (all settled)

## What this task is

Author the local-dev `docker-compose.yml` (or `compose.yaml`) at the repo root that brings up the full stack — application, Postgres, and the local Authelia OIDC provider — with one command (`make up`).

## Why it needs to be done

The architecture's "make up brings up everything you need locally" promise lives in this file. Every other dev-env feature (env-var template, one-command script, seed-data script) and the CI workflow's service containers are scaffolded around this.

## Decisions

- **File**: `docker-compose.yml` at the repo root (also accept the `compose.yaml` modern name; either is fine).
- **Services**: `app` (built from `Dockerfile`), `postgres` (postgres:16-alpine), `authelia` (upstream Authelia image).
- **Networks**: a single user-defined bridge network so service-to-service DNS resolution works (`app` finds `postgres` and `authelia` by name).
- **Volumes**: named volume for `postgres` data; mounted config files for `authelia`.
- **Ports**: `app` on 3000 (HTTP) — depending on backend wiring, the four frontend dev servers may also expose ports during dev. `postgres` on 5432. `authelia` on 9091.
- **Healthchecks**: `postgres` via `pg_isready`; `authelia` via its `/api/health` endpoint; `app` via `/healthz`.
- **`depends_on` with health conditions** so the app waits for Postgres + Authelia to be ready.
- **`restart: unless-stopped`** on all services for dev resilience.
- **`.env` file loaded** automatically (Compose's default behavior with `.env` at the project root); secrets and dev credentials live there (per `env_var_template`).

## Acceptance criteria

- `docker-compose.yml` at the repo root with the structure above.
- `docker compose up` (or `make up`) brings up the full stack from a clean checkout (after `pnpm install` and the initial image build).
- `docker compose ps` shows all services healthy within a reasonable time (under a minute).
- Tearing down with `docker compose down` is clean; `docker compose down -v` resets state.
- Migrations run on `app` startup against the `postgres` service.
- The `app` can reach the `authelia` issuer URL.
