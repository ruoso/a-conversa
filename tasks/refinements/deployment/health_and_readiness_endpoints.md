# `/healthz` and `/readyz` — add the readiness probe next to the liveness probe

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.observability.health_and_readiness_endpoints`
**Effort estimate**: 0.5d
**Inherited dependencies**: none in the WBS. Practically builds on `backend.api_skeleton.health_endpoint` (the existing `/healthz` plugin + the startup migration gate in `index.ts`) — settled.
**Executor**: implementation agent — repo-only work, part of milestone `m_predeploy_agent_work` (M9-prep).

## What this task is

Add `GET /readyz` as a sibling to the existing `GET /healthz`, per
[ADR 0033](../../../docs/adr/0033-production-observability-railway-sentry.md):

> **`/readyz`.** A new endpoint sibling to `/healthz`. `/healthz`
> remains a pure liveness probe (the process is alive); `/readyz`
> additionally pings Postgres and verifies the startup migration gate
> completed successfully. Failing either flips the response to 503.
> The endpoint is the surface for both Railway's readiness probe and
> the external uptime monitor.

`/healthz` keeps its liveness-only contract unchanged — its header
comment and the `health_endpoint` refinement explicitly anticipated a
future `/readyz` layering readiness on "without breaking the liveness
contract."

## Why it needs to be done

- ADR 0033 makes `/readyz` **the deploy gate**: Railway's service
  healthcheck path switches from `/healthz` to `/readyz` once this
  ships (the switch is an operator step already noted in
  [`prod_railway_app_service.md`](prod_railway_app_service.md)), so a
  deploy is not considered healthy until the database is reachable
  and the migration gate ran green.
- `observability.uptime_monitoring` gates on this leaf in the WBS
  (`depends !health_and_readiness_endpoints`).
- The milestone `m_predeploy_agent_work` (M9-prep) lists this leaf.

## Inputs / context

Existing artifacts:

- [`apps/server/src/routes/healthz.ts`](../../../apps/server/src/routes/healthz.ts) —
  the liveness plugin: 200 + `{ status: 'ok', version }`, no DB
  touch. Its `HealthzResponse` doc comment already sketches the
  differentiation: a future `/readyz` "would add `checks: { db, … }`".
- [`apps/server/src/index.ts`](../../../apps/server/src/index.ts) —
  the startup migration gate (ADR 0020 C6). Three paths: gate runs
  and succeeds (failure aborts the process before the port binds);
  gate skipped via explicit `SKIP_STARTUP_MIGRATIONS=true`; gate
  skipped because `DATABASE_URL` is unset.
- [`apps/server/src/db.ts`](../../../apps/server/src/db.ts) — the
  lazy `getDefaultPool()` singleton + the `DbPool` structural subtype
  (`query`) that every DB-touching plugin accepts as an injected
  `{ pool }` option for tests.
- [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) —
  the rate-limit registration allow-lists `/healthz` by URL predicate
  so probes are never throttled; `/readyz` needs the same exemption
  (Railway probes + the external uptime monitor hit it continuously).
- [`apps/server/src/routes/healthz.test.ts`](../../../apps/server/src/routes/healthz.test.ts) —
  the test pattern: `app.inject(...)` against a `createServer()`
  instance, no port bind (ADR 0022).

## Constraints / requirements

- **`/healthz` is untouched.** Same route, same body, same
  liveness-only semantics, same allow-list entry, same tests.
- **`GET /readyz`** returns:
  - **200** `{ status: 'ready', version, checks: { db: 'ok', migrations: 'ok' } }`
    when the Postgres ping succeeds AND the startup migration gate
    completed (see Decisions for the skip-path semantics);
  - **503** with `status: 'unavailable'` and the per-check
    `'ok' | 'failed'` detail when either check fails. The body keeps
    the same shape in both cases so probes and humans read one
    contract.
- **DB ping** is `SELECT 1` through the `DbPool` interface, with a
  short timeout (2s) so a hung pool turns into a fast 503 rather
  than a hanging probe. The plugin accepts an injected `{ pool }`
  option (test seam, matching the established pattern) and lazily
  falls back to `getDefaultPool()`; a throwing `getDefaultPool()`
  (no `DATABASE_URL`) counts as a failed db check, not a 500.
- **Migration-gate state** is recorded at boot by `index.ts` into a
  small module (`apps/server/src/readiness.ts`) the route reads.
  States: `not-run` (default; e.g. test instances), `completed`,
  `skipped: explicit-skip`, `skipped: no-database-url`.
- **Rate-limit allow-list** extends to `/readyz` (predicate becomes
  "URL is `/healthz` or `/readyz`"), with a test pinning that probes
  stay free past the per-IP ceiling, mirroring the existing
  `/healthz` pin.
- **OpenAPI**: the route documents both the 200 and 503 response
  schemas, tagged `meta`, like `/healthz`.
- **Tests** (`apps/server/src/routes/readyz.test.ts` + a rate-limit
  pin in `server.test.ts`): ready path with a mock pool; db-ping
  failure → 503; gate `not-run` → 503; `explicit-skip` → 200 (with
  db ok); `no-database-url` skip → 503; ping timeout → 503;
  `createServer()` integration (route is wired; no DB + no gate →
  503). No port bind, no real Postgres (ADR 0022).
- **Docs**: `docs/observability.md` gains its "Health and readiness"
  section (the slot reserved by `structured_logging`).
- The compose dev healthcheck stays on `/healthz` (liveness is the
  right restart signal; a transient DB blip must not restart the app
  container — that rationale is pinned in `routes/healthz.ts`).

## Acceptance criteria

- `GET /readyz` returns 200 with `checks.db = checks.migrations = 'ok'`
  on a stack where Postgres is reachable and the migration gate ran;
  503 with the failing check named otherwise.
- `/healthz` behavior is byte-identical to before (existing tests
  green, no schema/header changes).
- `pnpm run test:smoke` green, including the new readyz suite and the
  extended rate-limit pin.
- `pnpm run check` green.
- `docs/observability.md` documents the two probes and which consumer
  targets which.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
  `complete 100`.

## Decisions

- **Gate state is recorded at boot, not re-derived per probe.** The
  alternative — `/readyz` querying `pgmigrations` against the
  migrations directory on every probe — re-implements the runner's
  pending-set logic on a 60s cadence for no new information: the boot
  gate already guarantees "schema current or process dead." A
  boot-time fact is recorded once, at boot, in process state. The
  cost is that a test-constructed `createServer()` instance reports
  `not-run` → 503, which is honest (that instance never proved its
  schema).
- **`SKIP_STARTUP_MIGRATIONS=true` counts as migrations-ok.** The
  flag is the operator's explicit out-of-band assertion that the
  schema is current. If the explicit skip failed readiness, the
  escape hatch would be unusable in any orchestrated environment
  (Railway would never mark the deploy healthy) — the flag would be
  self-defeating exactly where it's needed. The missing-`DATABASE_URL`
  skip, by contrast, fails readiness: that server cannot serve any
  DB-touching request, and its db ping fails anyway.
- **503 body is the probe contract, not the error envelope.** The
  canonical `{ error: { code, message } }` envelope describes
  *errors*; a 503 from `/readyz` is the endpoint's *successful*
  report of an unready state, and the `checks` detail is the payload
  a human curling the probe needs. Probes (Railway, uptime monitor)
  read only the status code. Unexpected faults inside the handler
  still surface as enveloped 5xx via the global error handler.
- **2s DB-ping timeout, constant.** A probe that can hang defeats
  its purpose; 2s is far above a healthy in-VPC `SELECT 1` and far
  below Railway's probe interval. Not env-tunable until someone
  produces a deployment where the constant is wrong (same stance as
  the rate-limit defaults).
- **`/healthz` stays the compose healthcheck; `/readyz` becomes the
  Railway healthcheck.** Liveness controls restarts (a DB blip must
  not restart the app); readiness controls deploy-health and uptime
  monitoring (a DB blip *should* page). This is exactly ADR 0033's
  split; the operator-side switch is already written into
  `prod_railway_app_service.md` step 3.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-11. Landed as:

- [`apps/server/src/readiness.ts`](../../../apps/server/src/readiness.ts) — boot-time migration-gate state (`not-run` / `completed` / `skipped`), setters called from `index.ts`'s three gate paths, test-only reset.
- [`apps/server/src/routes/readyz.ts`](../../../apps/server/src/routes/readyz.ts) — the `GET /readyz` plugin: gate-state check + `SELECT 1` ping with 2s timeout, 200/503 with per-check detail, injected-pool test seam, OpenAPI schemas.
- [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) — registers the plugin next to `/healthz`; rate-limit allow-list predicate extended to `/readyz`.
- Tests: [`apps/server/src/routes/readyz.test.ts`](../../../apps/server/src/routes/readyz.test.ts) (unit + integration paths) and a `/readyz` rate-limit pin in [`apps/server/src/server.test.ts`](../../../apps/server/src/server.test.ts).
- Docs: Health and readiness section in [`docs/observability.md`](../../../docs/observability.md).
- `complete 100` marker in [tasks/70-deployment.tji](../../70-deployment.tji); tj3 parse clean.
