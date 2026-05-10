# 0018 — Local-dev Compose stack: three services, one user-defined network

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

The local-dev environment promised by the architecture is "`make up`
brings up everything you need." The previous foundation tasks settled
the three pieces that "everything" means: the application image
([ADR 0015](0015-dockerfile-multi-stage-pnpm-corepack.md)), the
PostgreSQL container ([ADR 0016](0016-postgres-upstream-alpine.md)),
and the Authelia OIDC provider in users-file mode
([ADR 0017](0017-mock-oauth-authelia-users-file.md)). The refinement
at [tasks/refinements/foundation/compose_file.md](../../tasks/refinements/foundation/compose_file.md)
fixed the broad shape (three services on a user-defined bridge,
healthchecked, `depends_on` chained, named volume for Postgres,
mounted config for Authelia, ports 3000/5432/9091, `.env` auto-loaded);
this ADR records the concrete file and a few choices that the
refinement deliberately left open.

The honest constraint at the time of writing: the application image's
runtime entry point is the stub from ADR 0015 — it prints a banner and
exits 0. The real entry point (apply migrations, start HTTP/WebSocket,
serve frontend bundles) lands with `backend.api_skeleton` together
with the migrations task. Compose's full-stack `up` therefore can't be
the smoke-test gate for this task by itself.

## Decision

The dev stack is committed at the repo root as **`compose.yaml`**
(modern Compose-spec name; either `docker-compose.yml` or
`compose.yaml` is fine per the refinement, and the tooling treats them
identically). Three services, one network, two named volumes.

- **Project name `aconversa`** set via the top-level `name:` field so
  the Compose project identity is stable regardless of working
  directory. Containers, network, and volumes get an `aconversa_`
  prefix; tooling that attaches by name works consistently.
- **`app` service** — `build: .`, tagged `aconversa/app:dev` so other
  tooling (a future `pnpm exec` runner, ad-hoc `docker run` for
  one-off commands, the seed-data script) can reference the same
  image by name. Publishes host port `3000`. Healthcheck pings
  `http://localhost:3000/healthz` via `node -e` (the runtime image is
  alpine + node, no `wget`/`curl`); `interval: 10s`, `start_period:
  30s`, six retries. `depends_on` lists both `postgres` and `authelia`
  with `condition: service_healthy`. `restart: unless-stopped`.
- **`postgres` service** — `image: postgres:16-alpine` per ADR 0016.
  `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` come from `.env`.
  Two volumes: the named `aconversa-postgres-data` at
  `/var/lib/postgresql/data` (persistent dev data, dropped by
  `docker compose down -v`); and a read-only bind mount of
  `infra/postgres/initdb/` at `/docker-entrypoint-initdb.d/`
  (currently empty save for `.gitkeep` — the directory is mounted now
  so a future extension-enable script has the obvious home). Host port
  `5432:5432`. Healthcheck `pg_isready -U $$POSTGRES_USER -d
  $$POSTGRES_DB` (the `$$` escapes Compose interpolation so the
  in-container shell expands the env vars).
- **`authelia` service** — `image: authelia/authelia:4.39` per
  ADR 0017. `command: ['--config', '/config/configuration.yml']`.
  `infra/authelia/configuration.yml` and `users.yml` mounted read-only
  at `/config/` (read-only so the upstream entrypoint's chown attempts
  fail loud-but-harmlessly without rewriting files in the working
  tree); named volume `aconversa-authelia-data` at `/var/lib/authelia`
  for the sqlite store and the filesystem-notifier output. Host port
  `9091:9091`. Healthcheck `wget -q --spider
  http://localhost:9091/api/health` — the upstream image ships busybox
  `wget` (no `curl`), and `--spider` exits non-zero on failure.
- **One user-defined bridge network `aconversa`** declared explicitly
  at the top level and listed on every service. Compose would create
  an implicit default bridge anyway; declaring it makes the network's
  identity stable for tooling that wants to attach by name.
- **`depends_on` chains health, not just startup.** With
  `condition: service_healthy`, Compose waits for `postgres`'s
  `pg_isready` and `authelia`'s `/api/health` to succeed before
  starting `app`. The first-boot init for both services takes a few
  seconds; this prevents the application from racing the database's
  init scripts or trying OIDC discovery against an Authelia that's
  still loading config.
- **`.env` auto-load.** Compose reads `.env` from the project root
  with no extra wiring. The variable *names* are fixed by ADR 0016
  (Postgres) and ADR 0017 (Authelia OIDC); the actual `.env.example`
  template and the values it documents are owned by the
  `foundation.dev_env.env_var_template` task. Until that lands,
  `make up` requires the operator to provide `.env` by hand; the
  variable list is the union of what the compose file and the Authelia
  config consume.

## Consequences

- **`make up` works for the dependencies today; full stack waits on
  `backend.api_skeleton`.** With the stub entry point the `app`
  container exits 0 immediately, and `restart: unless-stopped` then
  re-launches it in a tight loop with a perpetually unhealthy
  `/healthz` check. The wiring is correct — the healthcheck command,
  the `depends_on` chain, the network attachment, the env-var pass
  through — so when the real entry point lands, the stack starts
  cleanly. To run a quiet dev stack today, an operator brings the
  backing services up directly:
  ```sh
  docker compose up -d postgres authelia
  ```
  Both reach `healthy` in well under a minute (Authelia ≈ 12 s,
  Postgres ≈ 5 s in local verification). This partial-stack pattern
  is what the seed-data script and the env-var-template task can rely
  on; no `app` boot is needed for either.
- **`docker compose down -v` is the documented dev-data reset.** Both
  named volumes (`aconversa-postgres-data` and
  `aconversa-authelia-data`) drop together. The Postgres volume
  reset is documented in ADR 0016; the Authelia sqlite + notifier
  reset is documented in ADR 0017. `make down-v` wires this directly.
- **`Makefile` gains thin compose wrappers.** `make up`, `make down`,
  `make down-v`, `make logs`, `make ps` — all one-line `docker compose
  ...` calls. The richer one-command experience (env-file checks,
  pretty status output, opening the relevant URLs) is owned by
  `foundation.dev_env.one_command_script`; this task ships the
  underlying wiring those targets call.
- **Production compose is a separate task.**
  `deployment.prod_compose` will iterate on this file for cloud /
  production deployment — likely with image-pull instead of build,
  managed Postgres rather than the bundled container, real upstream
  OAuth providers wired into Authelia, and rotated secrets. The
  three-service shape and the network/volume conventions here are the
  spine that prod inherits from, not a throwaway.
- **`.env.example` is deferred.** This compose file references env
  vars that don't yet have an in-repo template. That's intentional —
  the env-var-template task is the next foundation refinement and
  authors `.env.example` based on the union of what compose, the app,
  and Authelia consume. A clear "copy `.env.example` to `.env` before
  `make up`" line in the README/dev-env docs closes the loop once
  both tasks are done.
- **No CI changes here.** `foundation.ci.*` tasks own the CI
  workflow; bringing the compose stack up in CI is a deferred
  decision, owned there.

## Verification

- `docker compose config` exits 0 and produces a fully resolved spec
  — three services on the `aconversa` network, two named volumes,
  ports `3000`/`5432`/`9091` published, `.env` interpolation
  substituted into the postgres environment block.
- `docker compose up -d postgres authelia` followed by `docker compose
  ps` (after a short settle) shows both services as `healthy`:
  ```
  aconversa-authelia-1   authelia/authelia:4.39   ...   Up 12 seconds (healthy)   0.0.0.0:9091->9091/tcp
  aconversa-postgres-1   postgres:16-alpine       ...   Up 12 seconds (healthy)   0.0.0.0:5432->5432/tcp
  ```
- `docker compose down -v` removes both containers, the network, and
  both named volumes cleanly.
- The full-stack `docker compose up` with the `app` service is
  *not* exercised by this task — it would loop on the stub entry
  point, by design. Once `backend.api_skeleton` lands, the same
  compose file boots the full stack with no further changes.
