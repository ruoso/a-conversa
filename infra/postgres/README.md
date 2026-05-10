# Postgres container — `infra/postgres/`

Configuration record for the PostgreSQL container used by the local-dev
Compose stack. The actual `docker-compose.yml` wiring lands with the
`foundation.dev_env.compose_file` task; this directory documents the
decisions that task will consume.

See [ADR 0016](../../docs/adr/0016-postgres-upstream-alpine.md) for the
rationale.

## Image

- **`postgres:16-alpine`** (upstream image, no custom Dockerfile).
- Major version pinned at **16** (current LTS at the time of writing).
  Bump when LTS rolls; do not float to `latest`.
- Alpine variant for size, matching the application image's runtime base
  ([ADR 0015](../../docs/adr/0015-dockerfile-multi-stage-pnpm-corepack.md)).

## Persistence

- Named Docker volume **`aconversa-postgres-data`** mounted at
  `/var/lib/postgresql/data`.
- Survives `docker compose down` (the default), so dev data is sticky.
- Reset workflow:

  ```sh
  docker compose down -v   # drops the volume; next `up` re-initialises
  ```

  This is the canonical "give me a fresh database" gesture for local
  dev. Test isolation per-Playwright-test is a separate concern owned
  by `foundation.test_infra.test_db_provisioning`.

## Credentials (dev defaults)

The compose service sets the following via environment, which the
upstream image consumes on first start:

| Variable            | Dev value     |
| ------------------- | ------------- |
| `POSTGRES_USER`     | `aconversa`   |
| `POSTGRES_DB`       | `aconversa`   |
| `POSTGRES_PASSWORD` | from env      |

The actual values live in `.env.example` / `.env`, authored by
`foundation.dev_env.env_var_template`. The compose file references them
as `${POSTGRES_USER}` etc. so the container, the application, and any
host-side tooling (`psql`, migration runs) all read the same source of
truth.

These are dev-only credentials. Cloud / production deployments use
managed Postgres with rotated secrets, out of scope here.

## Port

- Container listens on **5432** (the upstream default; not overridden).
- Host port **5432** is published so host-side tools (`psql`, GUI
  clients, ad-hoc scripts, the application running outside the
  container during development) can reach the database directly.
- If 5432 is already taken on the host, override via Compose's
  `ports:` mapping in a personal override file rather than editing the
  committed config.

## Health check

```sh
pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Wired via Compose's `healthcheck:` block (with `interval`, `timeout`,
`retries` set by `compose_file`). The application service depends on
this health gate so it doesn't try to run migrations or open a pool
before Postgres has finished initialising — the first-start init
(database/user creation, any `initdb/` scripts) takes a few seconds and
the app must wait it out.

## Init scripts (`initdb/`)

The upstream `postgres` image runs every `*.sql`, `*.sql.gz`, and
`*.sh` file dropped into `/docker-entrypoint-initdb.d/` once, the first
time the data directory is empty. Compose mounts `infra/postgres/initdb/`
into that path.

**No init scripts ship in v1.** The directory exists (with a
`.gitkeep`) so the Compose mount is valid and so a future need (e.g.,
enabling an extension that has to be created by superuser before app
migrations run) has an obvious home.

Schema migrations are **not** init scripts. They live at
`apps/server/migrations/` and are applied by the application's startup
(node-pg-migrate, forward-only) — that's owned by the
`data_and_methodology.schema` task and the migration-runner work in
`backend.api_skeleton`. Putting schema in `initdb/` would defeat
forward-only migrations and the cloud deployment story.

## What lives where

| Concern                            | Owner                                                     |
| ---------------------------------- | --------------------------------------------------------- |
| This Postgres container's config   | here + ADR 0016                                           |
| `docker-compose.yml` wiring        | `foundation.dev_env.compose_file`                         |
| `.env.example` and credential vars | `foundation.dev_env.env_var_template`                     |
| Schema + migrations                | `data_and_methodology.schema` + `backend.api_skeleton`    |
| Per-test DB isolation              | `foundation.test_infra.test_db_provisioning`              |
| Production / cloud Postgres        | `deployment.*`                                            |
