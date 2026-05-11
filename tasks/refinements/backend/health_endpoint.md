# /healthz endpoint and the startup migration gate

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.api_skeleton.health_endpoint`
**Effort estimate**: 0.25d (revised — see "Honest scope expansion" below)
**Inherited dependencies**: `backend.api_skeleton.http_server` (settled — `createServer()` factory + `index.ts` entry point landed 2026-05-10)

## What this task is

Two things land together because they share a refinement-round home:

1. **`GET /healthz`** — the liveness probe the compose `app` service healthcheck targets (per ADR 0018). Today the healthcheck `node -e`s a request to `/healthz`, hits a 404, and the service stays `(unhealthy)` even though the Fastify bootstrap is serving traffic. This task wires the route.

2. **The startup migration gate** — ADR 0020 / refinement [`data-and-methodology/migrations_tooling.md`](../data-and-methodology/migrations_tooling.md) C6 ("application refuses to start with pending migrations") was deferred at the time ADR 0020 was written: "the start-up gate that consumes [the runner] is deferred to `backend.api_skeleton`." `backend.api_skeleton.http_server` (which shipped 2026-05-10) explicitly punted the gate to a future sibling; this task is that sibling.

The two land together because (a) the C6 gate is operationally meaningful only once `/healthz` exists to report "server is up against a current schema," and (b) the Makefile's existing note — "Once `health_endpoint` (with migrations-on-startup) ships, `up` absorbs `up-app`" — already pre-commits to this pairing.

## Why it needs to be done

- **`/healthz` flips the compose healthcheck from red to green.** Until this lands, `docker compose ps` shows `app` as `(unhealthy)` and any downstream tooling that gates on the `service_healthy` condition (k8s probes, future CI smoke-against-compose, the `make up`-absorbs-`up-app` story) misreads the system.
- **The migration gate enforces schema/server-version coupling.** Without it, the operator can `make up-app` against a postgres that's missing `0010_session_events.sql` and the server happily takes traffic against a stale schema until the first session-events INSERT fails with a confusing `relation does not exist`. The gate moves the failure to startup time with a clear error.

Downstream consumers:

- `backend.api_skeleton.error_handling`, `request_logging`, `openapi_or_equivalent` — sibling api_skeleton tasks that will register on the same `FastifyInstance` and pre-assume `/healthz` already exists.
- `deployment.prod_migrations.migration_runner_in_prod` — the production deploy story uses the same `applyMigrationsOnStartup` (or a deploy-level wrapper) and the same `pgmigrations` table.

## Inputs / context

From [docs/adr/0023-web-framework-fastify.md](../../../docs/adr/0023-web-framework-fastify.md) (Consequences):

> The trivial `GET /` route stays. It returns `{ status: 'ok' }` — not a real healthcheck — and exists purely as a smoke endpoint for `curl http://localhost:3000/` against the running compose stack. The proper `/healthz` (with DB ping and migration-state check) is owned by `backend.api_skeleton.health_endpoint`.

ADR 0023 anticipated that `/healthz` would do "DB ping and migration-state check." This refinement deliberately walks that back — see "Decisions" below — and amends ADR 0023 to record the narrower (liveness-only) semantics.

From [docs/adr/0020-migrations-node-pg-migrate-forward-only.md](../../../docs/adr/0020-migrations-node-pg-migrate-forward-only.md) (Decision):

> The startup gate is deferred. The "app refuses to start with pending migrations" rule (C6) lives in the application's startup path, which doesn't exist yet. `backend.api_skeleton` will import the same runner programmatically, run it, and abort startup if any migrations were pending or any error occurred. Recorded here so future readers know this ADR establishes only half of C6's implementation.

This refinement settles the deferred half.

From [compose.yaml](../../../compose.yaml):

```yaml
healthcheck:
  test:
    - CMD
    - node
    - -e
    - "require('http').get('http://localhost:3000/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1));"
```

The probe shape is fine — the route at `/healthz` returning 200 makes it pass without touching compose.

From [Makefile](../../../Makefile):

> Once `health_endpoint` (with migrations-on-startup) ships, `up` absorbs `up-app` and the split goes away.

The Makefile pre-commits to "apply on startup," not "check-only-and-abort" — see Decisions.

## Constraints / requirements

- **`/healthz` is liveness-only.** A 200 says "server process is running and able to serve HTTP traffic." It does NOT ping the database, validate OIDC, or re-check migration state. See the Decision below for the rationale and the alternatives surveyed.
- **The startup migration gate lives in `index.ts`, not in `/healthz`.** Migrations are applied before `app.listen(...)`; the route never has to re-verify schema currency because the only way the server is listening is past the gate.
- **The standalone `apps/server/scripts/migrate.ts` CLI stays in place.** `make migrate` and CI / runbook invocations continue to call it; the startup gate uses the same `node-pg-migrate` library with the same options, so the on-disk `pgmigrations` rows are identical regardless of which path applies a given migration.
- **Forward-only policy preserved** (ADR 0020). The startup gate is hard-coded to `direction: 'up'`; there is no down path.
- **Test layers per ADR 0022**:
  - Pure logic (route handler, version-resolution fallback, gate-options forwarded to the runner) → Vitest under `apps/server/src/routes/healthz.test.ts` and `apps/server/src/migrate-startup.test.ts`.
  - DB-touching scenario (migration runner end-to-end) → Cucumber against pglite under `tests/behavior/backend/healthz.feature` (route) and the existing `tests/behavior/runner/migrate.feature` (migration runner, already in place).
- **No ad-hoc probes.** Every empirical check is a committed test; no `node -e`, no `psql -c`, no inline scripts.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; the new `routes/healthz.test.ts` and `migrate-startup.test.ts` cases land alongside the existing server.test.ts coverage.
- `pnpm run test:behavior:smoke` (Cucumber) green; the new `backend/healthz.feature` scenarios pass via `app.inject(...)`.
- `make up && make up-app` (or the future merged `make up` once it absorbs `up-app`) brings up the stack and `docker compose ps` reports `app` as `healthy` within `start_period + interval × retries`.
- `curl http://localhost:3000/healthz` returns `200 OK` with `{"status":"ok","version":"<string>"}`.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- ADR 0020 gains an Amendment noting C6's startup-gate half is settled here.
- ADR 0023 gains an Amendment noting `/healthz` is liveness-only (the original "DB ping and migration-state check" framing is superseded).

## Decisions

- **`/healthz` is liveness-only.** Returns 200 + `{ status: 'ok', version: <pkg version> }` unconditionally when the server is running. Three alternatives surveyed:
  - **(A) Liveness-only** (chosen). Cheap, no dependency coupling, matches the canonical Kubernetes `/healthz` semantics. The compose healthcheck stays stable across transient DB blips: a postgres hiccup doesn't cause Docker to restart-loop the app, which is what would happen with a readiness-flavored `/healthz`.
  - **(B) Liveness + DB ping.** Rejected for this task because (a) the migration gate already verifies DB reachability at startup, so adding a per-request ping is a "test for tests'-sake" surface area, and (b) it couples healthchecks to DB availability, which is the well-known anti-pattern that causes restart loops during recoverable DB outages. The right home for DB readiness is a separate `/readyz` (deferred — see Open questions).
  - **(C) Liveness + DB ping + migration-state recheck.** Rejected because the migration state is invariant past startup (the gate has already applied or aborted); re-checking on every healthcheck wastes a query and tells you nothing new.
- **Version stamp in the response.** Sourced from `process.env.npm_package_version` (set by pnpm/npm at script launch) with a `'0.0.0'` fallback. Useful diagnostic when chasing "is the rolling deploy done?" against a live stack; not load-bearing, so the fallback is acceptable until `deployment.prod_container` wires a build-time `APP_VERSION`.
- **Plugin-encapsulated route.** `routes/healthz.ts` exports a `FastifyPluginAsync`; `server.ts` registers it. This pattern is what the other api_skeleton siblings (`error_handling`, `request_logging`, `openapi_or_equivalent`) will use; we set the template here.
- **Migration startup gate: apply, not check-only.** Two interpretations of C6 ("refuses to start with pending migrations") were viable:
  - **Apply pending migrations; abort if applying fails** (chosen). On boot, run the same `node-pg-migrate` runner the CLI uses; if it returns successfully, listen on the port; if it throws, log + `process.exit(1)`. Matches the Makefile's pre-commitment ("Once `health_endpoint` (with migrations-on-startup) ships, `up` absorbs `up-app`") — there's no separate `make migrate` step in the new compose flow. Also matches the production-deploy story: prod applies migrations as part of bringing up the new image, not as a pre-step that has to succeed before the deploy is triggered.
  - **Check pending; abort if any exist; let operator apply them** (rejected). Stricter reading of C6 ("refuses to start") but pessimistic — every `make up-app` would fail with "pending migrations" until the operator manually ran `make migrate`. Doesn't fit the "one command brings up the stack" intent.
- **Two escape hatches for the gate.** `SKIP_STARTUP_MIGRATIONS=true` env var (explicit opt-out for replica/read-only DB scenarios) and `DATABASE_URL` unset (warning-loud opt-out for DB-less iteration). Both log a clear warning and proceed without applying. Tests use the second path (they pass `{ logger: false }` and don't set `DATABASE_URL`).
- **The standalone `migrate.ts` CLI stays.** Both paths (CLI and startup) call `node-pg-migrate`'s `runner` with identical options. Refactoring the CLI to call into `migrate-startup.ts` would save a few lines but couple two contracts (CLI uses console.log + process.exit; startup uses Fastify Pino + thrown errors). Deliberate duplication.
- **`compose.yaml` healthcheck shape unchanged.** The probe already targets `/healthz` via `node -e`; the only thing missing was the route, which this task ships. No compose edit required.

## Open questions

- **`/readyz` (readiness probe).** Deferred. When session-management endpoints or the WebSocket protocol need to gate "is the server actually ready to serve a request that touches the DB," a separate `/readyz` (pings DB, optionally checks OIDC discovery) is the right shape. Tracked as a future task; this refinement deliberately does not pre-empt the design.
- **Should the runtime container's `APP_VERSION` come from build args or git SHA?** Deferred to `deployment.prod_container`. Today's `0.0.0` fallback is acceptable.

## Honest scope expansion

The original task description was `0.25d` — "implement GET /healthz". The migration-startup gate doubles the surface area: a new module, a mock-runner Vitest suite, the wiring change in `index.ts`, and an ADR 0020 amendment. Two ways to honor the original scope cleanly:

1. **Settle here** (chosen). The gate is small (~50 LOC of glue around a library we already depend on), and the operational benefit is high — `make up-app` becoming `make up` removes a step from the dev-loop documentation that has tripped people up. Refinement-document time matters more than the implementation time.
2. **Defer to a follow-up task.** Would have left ADR 0020's C6 in "deferred" state for another iteration and required a small `backend.api_skeleton.migration_startup_gate` task to be added to `20-backend.tji`.

Picking (1) means this refinement's effort estimate moves from 0.25d to ~0.5d. Recorded honestly here rather than silently absorbed.

## Status

**Done** — 2026-05-10. Landed as:

- Route: [`apps/server/src/routes/healthz.ts`](../../../apps/server/src/routes/healthz.ts) (Fastify plugin).
- Server wiring: [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) (registers the plugin).
- Startup gate: [`apps/server/src/migrate-startup.ts`](../../../apps/server/src/migrate-startup.ts) (applyMigrationsOnStartup + Fastify-logger adapter).
- Bootstrap: [`apps/server/src/index.ts`](../../../apps/server/src/index.ts) (gate invoked before `app.listen(...)`).
- Vitest: [`apps/server/src/routes/healthz.test.ts`](../../../apps/server/src/routes/healthz.test.ts) (+4 cases), [`apps/server/src/migrate-startup.test.ts`](../../../apps/server/src/migrate-startup.test.ts) (+6 cases with a mocked runner).
- Cucumber: [`tests/behavior/backend/healthz.feature`](../../../tests/behavior/backend/healthz.feature) (+2 scenarios), step `the response body has a non-empty version string` added to [`tests/behavior/steps/http-server.steps.ts`](../../../tests/behavior/steps/http-server.steps.ts).
- ADR amendments: [ADR 0020](../../../docs/adr/0020-migrations-node-pg-migrate-forward-only.md) (C6 startup-gate settled), [ADR 0023](../../../docs/adr/0023-web-framework-fastify.md) (`/healthz` semantics: liveness-only).
- Makefile updated: `make up` now absorbs `make up-app` per the long-promised Amendment in ADR 0018 / Makefile note; the `up-app` target remains as a thin alias for back-compat.
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
