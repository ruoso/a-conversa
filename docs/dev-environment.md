# Local development environment

A walkthrough of the dev environment as it stands today: what to install, what `make up` actually does, what runs, what doesn't, and where to look when something misbehaves. The [README's Local development section](../README.md#local-development) is the front-door pointer; this doc is the deeper how-to.

Audience: a contributor cloning the repo for the first time, or someone debugging a dev-env hiccup.

Out of scope: production deployment (owned by [`deployment.deployment_docs`](../tasks/30-deployment.tji)) and per-test database isolation (owned by [`foundation.test_infra.test_db_provisioning`](../tasks/refinements/foundation/test_db_provisioning.md)).

## Prerequisites

- **Node 20+** via [Corepack](https://nodejs.org/api/corepack.html). The host this was last verified on runs 20.19.2.
- **pnpm 9.15.4** — pinned in [`package.json`](../package.json) under `packageManager`. Enable with `corepack enable && corepack prepare pnpm@9.15.4 --activate`; Corepack then enforces the pinned version on every `pnpm` invocation.
- **Docker + Docker Compose v2.x** — Compose v2 is the `docker compose` (subcommand) form, not the legacy `docker-compose` binary. Required for [`make up`](../Makefile); not required for tests, lint, format, or typecheck.

See [ADR 0001](adr/0001-language-and-runtime.md) for the language/runtime choice.

## First-run setup

```sh
pnpm install         # or: make install
```

`pnpm install` does three things at the workspace root:

1. Installs every workspace's dependencies (recursive — see [ADR 0010](adr/0010-directory-layout-pnpm-workspaces.md)).
2. Links the workspaces against each other so cross-package imports resolve to source rather than published versions.
3. Runs the `prepare` lifecycle script, which invokes Husky and wires the pre-commit hook into `.git/hooks/pre-commit` ([ADR 0014](adr/0014-pre-commit-hooks-husky-lint-staged.md)).

No additional steps. A fresh clone is ready for tests, lint, and typecheck immediately after `pnpm install`.

## Host resolution for Authelia

The OIDC dance hands the browser a 302 to `https://authelia.aconversa.local:9091/api/oidc/authorization?…`. That hostname is a network alias on the compose bridge — the `app` container resolves it via Docker's embedded DNS — but the **host** machine (where your browser runs) has no entry for it. Without a `/etc/hosts` line, browser-driven login fails at DNS resolution before the user ever reaches Authelia's login form.

One-time setup:

```sh
echo '127.0.0.1  authelia.aconversa.local' | sudo tee -a /etc/hosts
```

That single line resolves the hostname to localhost; the compose port-forward at `:9091` then routes the request to the Authelia container. The self-signed cert at [`infra/authelia/tls/cert.pem`](../infra/authelia/tls/cert.pem) already carries `DNS:authelia.aconversa.local` as a SAN, so TLS verifies cleanly against either the in-network FQDN or the host-side one.

`make up` checks `/etc/hosts` after the stack reports healthy and prints a notice with the fix command if the entry is missing — the notice is non-blocking because backend-only flows (`/healthz`, the Vitest + Cucumber smoke suites, the Playwright suite when it uses pre-seeded auth cookies) work without it. **The only flow that requires the `/etc/hosts` entry is the interactive browser SSO login.**

To undo the entry later, edit `/etc/hosts` and remove the line. Compose stops working from the host once removed, but the in-network path (`docker exec aconversa-app-1 ...`) is unaffected.

## The compose stack

Three services on one user-defined bridge network ([`compose.yaml`](../compose.yaml), [ADR 0018](adr/0018-compose-file-three-service-dev-stack.md)):

- **`app`** — built from the root [`Dockerfile`](../Dockerfile) ([ADR 0015](adr/0015-dockerfile-multi-stage-pnpm-corepack.md)). Multi-stage build: pnpm via Corepack in the build stage, slim runtime.
- **`postgres`** — upstream `postgres:16-alpine` ([ADR 0016](adr/0016-postgres-upstream-alpine.md)). Config notes: [`infra/postgres/README.md`](../infra/postgres/README.md). Init scripts mounted from `infra/postgres/initdb/`.
- **`authelia`** — upstream `authelia/authelia:4.39` in users-file mode ([ADR 0017](adr/0017-mock-oauth-authelia-users-file.md)). Config notes: [`infra/authelia/README.md`](../infra/authelia/README.md). Mounts `configuration.yml` and `users.yml` read-only.

All three live on the `aconversa` bridge network so service-name DNS works (the app reaches `postgres` and `authelia` by name from inside the stack).

Two named volumes hold persistent state across `docker compose down`:

- `aconversa-postgres-data` — Postgres data directory.
- `aconversa-authelia-data` — Authelia's sqlite store and filesystem-notifier output.

`make down` preserves both; `make down-v` drops them (canonical "give me a fresh stack" gesture).

## Make targets

The [`Makefile`](../Makefile) wraps `pnpm` and `docker compose` with friendlier UX. Run `make help` for the live list.

| Target         | What it does                                                                                | When you'd want it                                       |
| -------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `make install` | `pnpm install -r` across all workspaces.                                                    | First clone, or after pulling lockfile changes.          |
| `make check`   | Runs the full static-analysis bundle: `lint`, `format:check`, `typecheck`, `typecheck:tools`, `typecheck:tests`. Same target the pre-commit hook and CI invoke. | Anytime you want the exact contract CI will enforce.    |
| `make test`    | Runs Vitest, Cucumber, and Playwright smokes in sequence.                                   | Before committing or pushing.                            |
| `make up`      | Brings up `postgres + authelia + app` with the dev compose override (`NODE_ENV=development`); waits ~30s for healthy; prints the URL banner + the `/etc/hosts` notice if `authelia.aconversa.local` is missing. | Day-to-day dev work — the dev override relaxes the production-mode boot gates so `.env.example`'s placeholder secret boots without rotation. |
| `make up-prod-mode` | Same as `make up` but **without** the dev override. Production-mode boot gates (`SESSION_TOKEN_SECRET` strength, CORS lockdown, WS Origin allowlist) all armed. | Reproducing a CI failure locally, or smoking the production-config path. Used by CI's `e2e-playwright` job and by `make test:e2e:compose`. |
| `make up-app`  | Alias for `make up` (back-compat; the old `up`/`up-app` split is gone).                      | Existing muscle memory.                                  |
| `make migrate` | Applies pending DB migrations against the running `postgres` (forward-only; [ADR 0020](adr/0020-migrations-node-pg-migrate-forward-only.md)). | After `make up`, before exercising anything that talks to the schema. |
| `make down`    | `docker compose down`. Volumes preserved.                                                   | Stopping the stack at end of session.                    |
| `make down-v`  | `docker compose down -v`. Volumes dropped.                                                  | Resetting to a clean stack (drops Postgres + Authelia state). |
| `make logs`    | `docker compose logs -f`.                                                                   | Watching service output live.                            |
| `make ps`      | `docker compose ps`.                                                                        | Quick health check on running services.                  |
| `make seed`    | Runs the seed-data script (currently a stub — see [`seed_data_script`](../tasks/refinements/foundation/seed_data_script.md)). | Loads the walkthrough fixture once the script lands.    |
| `make clean`   | Removes `node_modules` (root + workspaces) and build artefacts.                             | Recovering from a corrupted install.                     |

The `up` / `up-prod-mode` split keeps local dev ergonomic without weakening CI: `make up` uses the dev compose override ([`compose.dev.yaml`](../compose.dev.yaml)) so `NODE_ENV=development` relaxes the production-mode boot gates (the `SESSION_TOKEN_SECRET` placeholder denylist, the CORS lockdown that requires `APP_BASE_URL`, the WS Origin allowlist, the pino JSON-output mode, the cookie `Secure` attribute). `make up-prod-mode` skips that override so CI — which runs `make up-prod-mode` in the `e2e-playwright` job — exercises the exact boot-gate set production ships. The `up-app` alias is preserved for muscle memory; the rationale for the dropped `up`/`up-app` split lives in [`one_command_script` Status](../tasks/refinements/foundation/one_command_script.md#status) and [ADR 0018 Amendments](adr/0018-compose-file-three-service-dev-stack.md#amendments).

## Environment variables

Compose auto-loads `.env` from the project root. Workflow:

```sh
cp .env.example .env
# edit only if your local Postgres or Authelia ports clash
```

`make up` auto-creates `.env` from [`.env.example`](../.env.example) if it doesn't exist, so a fresh clone needs no manual copy. `make up` does **not** clobber an existing `.env` — your overrides are safe.

`.env.example` is the source of truth and is fully commented; the variables it declares are documented inline. For the conventions behind each group:

- Postgres credentials: [`infra/postgres/README.md`](../infra/postgres/README.md).
- OIDC client / issuer: [`infra/authelia/README.md`](../infra/authelia/README.md).

## Authelia dev login

Six dev users are seeded in [`infra/authelia/users.yml`](../infra/authelia/users.yml): **`alice`**, **`ben`**, **`maria`**, **`dave`**, **`erin`**, **`frank`**. All six share the dev password **`aconversa-dev`**.

Issuer URL convention (current, post the HTTPS-issuer flip in commit [`f01ef3b`](https://github.com/ruoso/a-conversa/commit/f01ef3b) and the FQDN-alias landing in [`e02652b`](https://github.com/ruoso/a-conversa/commit/e02652b)):

| Caller                          | Issuer URL                                      |
| ------------------------------- | ----------------------------------------------- |
| Backend service inside Compose  | `https://authelia.aconversa.local:9091`         |
| Browser / host shell            | `https://authelia.aconversa.local:9091`         |

Both sides use the **same** URL. Inside the compose network the FQDN resolves via the network alias on the `authelia` service; from the host the same name resolves to `127.0.0.1` via the `/etc/hosts` entry (see [Host resolution for Authelia](#host-resolution-for-authelia) above). The self-signed cert at [`infra/authelia/tls/cert.pem`](../infra/authelia/tls/cert.pem) carries a SAN for that hostname. Using one URL on both sides keeps the OIDC `iss` claim consistent and avoids the openid-client metadata-vs-issuer trap a "browser uses localhost, backend uses container hostname" split would require. Full rationale and the rotation procedure in [`infra/authelia/README.md`](../infra/authelia/README.md).

## Tests

Three runners, all rolled up under `make test`:

- **Vitest** (unit) — `pnpm run test:smoke` ([ADR 0006](adr/0006-unit-test-framework-vitest.md)).
- **Cucumber** (behavior, Gherkin) — `pnpm run test:behavior:smoke` ([ADR 0007](adr/0007-behavior-test-framework-cucumber.md)).
- **Playwright** (E2E) — `pnpm run test:e2e:smoke` ([ADR 0008](adr/0008-e2e-framework-playwright.md)).

The five `pnpm run smoke:{node,react,reactflow,cytoscape,tailwind}` scripts are stack-validation throwaways that prove the picked dependencies wire up; they will go away once their owning workspaces have real code (cite ADRs [0001](adr/0001-language-and-runtime.md), [0003](adr/0003-frontend-framework-react.md), [0004](adr/0004-graph-libraries-reactflow-and-cytoscape.md), [0005](adr/0005-styling-tailwind-with-shared-tokens.md)).

## Lint, format, typecheck

| Command                  | What it does                                       |
| ------------------------ | -------------------------------------------------- |
| `pnpm run check`         | Runs `lint + format:check + typecheck + typecheck:tools + typecheck:tests` in one go — the same bundle the pre-commit hook and CI invoke. Single entry point. |
| `pnpm run lint`          | ESLint over the repo ([ADR 0011](adr/0011-linter-eslint-with-typescript-eslint.md)). |
| `pnpm run format`        | Prettier write across the repo ([ADR 0012](adr/0012-formatter-prettier.md)). |
| `pnpm run format:check`  | Prettier `--check` across the repo (read-only).    |
| `pnpm run typecheck`     | `tsc -b` over project references ([ADR 0013](adr/0013-typecheck-tsconfig-strict-with-project-references.md)). |
| `pnpm run typecheck:tools` | Typecheck the standalone `scripts/` programs.    |
| `pnpm run typecheck:tests` | Typecheck the test sources under `tests/`.       |

The pre-commit hook ([ADR 0014](adr/0014-pre-commit-hooks-husky-lint-staged.md)) runs `lint-staged` (ESLint `--fix` + Prettier `--write` on staged files), then `pnpm run lint` (full repo), then the three `tsc -b` invocations. The whole-repo lint catches the failure mode where a config or upstream-type change invalidates a file nobody staged — `lint-staged` alone can't see it. **Tests are intentionally not in the hook** — kept fast on purpose; the CI smoke step catches what the hook deliberately skips. `pnpm run check` / `make check` is the unified entry point both dev and CI invoke.

## Workspace layout

Five workspaces ([ADR 0010](adr/0010-directory-layout-pnpm-workspaces.md), [`pnpm-workspace.yaml`](../pnpm-workspace.yaml)):

```
apps/
  audience/
  moderator/
  participant/
  server/
packages/
  shared-types/
```

Today these are placeholders; real code lands per workspace as the WBS unfolds.

## What's not yet runnable end-to-end

Be honest about today's reality:

- The `app` container's runtime entry point is a stub ([ADR 0015](adr/0015-dockerfile-multi-stage-pnpm-corepack.md)) that exits 0 immediately. With `restart: unless-stopped`, `make up-app` therefore loops the container in a tight restart cycle. The split with `make up` (which only brings up `postgres + authelia`) keeps the working subset quiet.
- Full-stack `make up` (with the app folded back in) becomes the norm once [`backend.api_skeleton`](../tasks/refinements/backend/api_skeleton.md) lands.
- `make seed` is a stub (see [`seed_data_script` Status](../tasks/refinements/foundation/seed_data_script.md#status)) until the fixture-loader and the event-append API both exist.

## Troubleshooting

- **Pre-commit hook isn't firing.** Husky's hook lives under `.husky/_/pre-commit`. If the hook directory is stale (e.g., after a Husky version bump), `rm -rf .husky/_ && pnpm install` re-runs the `prepare` script and rewires it.
- **Authelia health check is slow on first boot.** Authelia takes ~12s to settle on a cold start; the 15s `sleep` in `make up` is heuristic-tuned for this. If you see Authelia still `starting` in `make ps`, give it another 10s and re-check.
- **Port 5432 or 9091 already in use.** Override the host-side port mapping in a personal `compose.override.yaml` (Compose auto-loads it, gitignored) rather than editing the committed `compose.yaml`. See [`infra/postgres/README.md`](../infra/postgres/README.md#port).
- **`.env` got out of date.** `make up` auto-creates `.env` only when missing — it does not clobber. To resync, `rm .env && make up` regenerates from the current `.env.example`.
- **Stale Postgres or Authelia state is causing weird behavior.** `make down-v` drops both named volumes; the next `make up` re-initialises from scratch (Postgres re-runs `initdb`, Authelia rebuilds its sqlite store).

## Where to learn more

- [docs/adr/](adr/) — the eighteen Architecture Decision Records that justify every choice above.
- [tasks/](../tasks/) — the work breakdown structure, including refinement notes for each completed and planned task.
- [DESIGN.md](../DESIGN.md) and [docs/architecture.md](architecture.md) — the design and engineering shape the dev environment is built to support.
