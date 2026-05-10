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

## Status

**Done — 2026-05-10.**

- Stack lives at [`compose.yaml`](../../../compose.yaml) (modern
  Compose-spec name): three services (`app`, `postgres`, `authelia`)
  on the user-defined bridge network `aconversa`, with named volumes
  `aconversa-postgres-data` and `aconversa-authelia-data`, the
  Authelia config files mounted read-only, healthchecks for all three,
  and `app` `depends_on` `postgres` + `authelia` with
  `condition: service_healthy`.
- ADR [0018](../../../docs/adr/0018-compose-file-three-service-dev-stack.md)
  records the rationale and the partial-stack workflow.
- [`Makefile`](../../../Makefile) gains real `up` / `down` / `down-v`
  / `logs` / `ps` targets wrapping `docker compose ...`. The richer
  one-command UX (env-file checks, friendly output) is owned by
  `foundation.dev_env.one_command_script`.
- Verified: `docker compose config` exits 0; `docker compose up -d
  postgres authelia` brings both backing services to `healthy` in
  ~12 s; `docker compose down -v` cleans up.
- Caveat: the `app` runtime entry point is the ADR-0015 stub (prints
  banner, exits 0). Until `backend.api_skeleton` lands, full-stack
  `make up` will loop the `app` container under
  `restart: unless-stopped` with `/healthz` perpetually unhealthy.
  Use `docker compose up -d postgres authelia` for a quiet partial
  stack today.
- Deferred: `.env.example` (owned by `env_var_template`); the seed
  script (`seed_data_script`); the friendly `make up` wrapper
  (`one_command_script`); production compose (`deployment.prod_compose`).
