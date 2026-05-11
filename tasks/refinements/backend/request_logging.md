# Structured request logging

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.api_skeleton.request_logging`
**Effort estimate**: 0.5d
**Inherited dependencies**: `backend.api_skeleton.http_server` (settled — `createServer()` factory + `index.ts` entry point landed 2026-05-10), `backend.api_skeleton.error_handling` (settled — centralized error handler with `request.log.error({ err })` for 5xx stack capture landed 2026-05-10).

## What this task is

Tighten the Fastify server's Pino logger so every request gets a uniform, structured access-log line in production, a human-readable line in development, and silence under tests. Three things land together:

1. **A per-environment logger config helper** under `apps/server/src/logger.ts` that returns the `FastifyServerOptions['logger']` value to pass to `Fastify({ logger: ... })`. The helper reads `NODE_ENV` and `LOG_LEVEL` off the env passed in; it does not touch `process.env` directly so unit tests can pass a minimal env object.
2. **Request-id propagation in response headers** via a Fastify `onRequest` hook that echoes `request.id` (which Fastify either generates or reads from an inbound `x-request-id` header) back to the client as `x-request-id`. Combined with Pino's per-request log-line `reqId` field, this gives every request a single id that appears in the server log and on the wire.
3. **`pino-pretty` as a runtime dep** on `apps/server`, pinned to `13.1.3` (current stable on 2026-05-10).

The server.ts bootstrap previously had an inline `process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' }` expression for the logger config — functional but not unit-testable and with no pretty-printing in dev. This task replaces that with the helper and the explicit request-id machinery.

## Why it needs to be done

- **Dev ergonomics.** Default Pino output is one-line JSON, which is correct for production aggregators but unreadable in a `pnpm dev` terminal. `pino-pretty` formats each line into a single human-readable summary (timestamp + level + request fields + message), making the dev loop actually usable.
- **Production observability.** Every request needs a uniform shape (`method`, `url`, `statusCode`, `responseTime`, `reqId`) so a log aggregator (Loki, CloudWatch, etc.) can index against them. Fastify's default Pino integration emits exactly that shape; the helper just pins the level and the prod-vs-dev format switch.
- **Tracing correlation.** Without `x-request-id` reflection, a frontend or load-balancer observing a slow / failing request has no way to find the corresponding server-side log entry. With the reflection, every response carries the id that Pino stamps on every log line for that request.
- **Test quiet.** Vitest unit tests and Cucumber + pglite scenarios construct dozens of Fastify instances per run; if any of them logs to stdout, the test output becomes a wall of Pino lines and `--reporter=verbose` becomes unusable. The helper returns `false` under `NODE_ENV=test` to silence the logger entirely.
- **The siblings about to land — `openapi_or_equivalent`, the entire `auth` / `session_management` / `websocket_protocol` tree — will plug log statements into the same logger.** Pinning the format / level / redaction surface here means each future endpoint inherits the same shape without re-discussing it.

Downstream consumers:

- `backend.api_skeleton.error_handling` — its 5xx handler already calls `request.log.error({ err }, 'unhandled error in route handler')`; that path lights up correctly under the new logger config (test=silent, dev=pretty, prod=JSON). No edits to the error handler are needed.
- `backend.api_skeleton.openapi_or_equivalent` — the spec'd error component (`{ error: { code, message, ...detail } }`) gains a sibling `requestId` field once correlation lands; deferred to a future refinement (see Open questions).
- `deployment.observability` — the production logger's structured-JSON output is the input to an eventual aggregator. This task does not pre-empt that choice; it just ensures the JSON shape is stable.

## Inputs / context

From [ADR 0023](../../../docs/adr/0023-web-framework-fastify.md) (Consequences):

> Structured logging uses Fastify's built-in **Pino** (the framework's default logger). The `request_logging` sibling task will refine the redaction/serializer config; the bootstrap just enables `logger: true` with a sensible level (`info` outside test, `silent` under test) so the route smoke tests don't drown stdout.

This refinement settles the deferred half.

From [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) (pre-task):

```ts
const defaultLogger: FastifyServerOptions['logger'] =
  process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' };
```

The starting point. Functional but lacks pretty-printing in dev, doesn't switch on prod vs. dev explicitly, and doesn't extract into a testable surface.

From [`apps/server/src/error-handler.ts`](../../../apps/server/src/error-handler.ts) (5xx path):

```ts
request.log.error({ err }, 'unhandled error in route handler');
```

The error-handler's existing behavior — stack capture via Pino's standard error serializer — needs to keep working. The serializer is the same `pino.stdSerializers.err` whether the logger is in pretty or JSON mode, so this path is unaffected by the format switch; verified by the `error-handler.test.ts` raw-Error case (already in place).

From the Fastify 5 docs and types ([types/instance.d.ts:603-604](../../../node_modules/.pnpm/fastify@5.8.5/node_modules/fastify/types/instance.d.ts)):

```ts
requestIdHeader?: string | false,
requestIdLogLabel?: string,
```

Fastify reads an inbound request-id header if `requestIdHeader` is set, otherwise generates one. The id is exposed as `request.id` and stamped on every log line under the configured label (default `reqId`).

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): every empirical check is a committed test. The logger ships with Vitest unit tests (the helper's per-mode return value, the request-id reflection via `app.inject(...)`) and a Cucumber scenario that drives the running instance.

## Constraints / requirements

- **Module shape**:
  - `apps/server/src/logger.ts` — exports `createLoggerOptions(env: LoggerEnv): LoggerOptions`. Pure function: no I/O, no `process.env` access (env is passed in), no Fastify instantiation. Three modes selected by `env.NODE_ENV`:
    - `'test'` → `false`.
    - `'production'` → `{ level }` only (structured JSON, no transport).
    - anything else (including unset) → `{ level, transport: { target: 'pino-pretty', options: { translateTime, ignore, singleLine } } }`.
  - Both dev and prod modes honor `env.LOG_LEVEL` (validated against Pino's standard level set; invalid / empty values fall back to `'info'`).
- **`server.ts` wiring**:
  - Replace the inline ternary with `createLoggerOptions(process.env)`.
  - Add `requestIdHeader: 'x-request-id'` so Fastify picks up an inbound `x-request-id` header into `request.id`. (Default is `'request-id'`; the de facto convention is the `x-` prefix.)
  - Add `requestIdLogLabel: 'reqId'` (pinned explicitly though it matches the Fastify default — future readers shouldn't have to look up the default to know what the Pino log key is).
  - Add an `onRequest` hook that calls `reply.header('x-request-id', String(request.id))` so every response carries the id back to the client. `onRequest` is the right hook (not `onResponse`, which fires after headers are flushed; not `onSend`, which fires later in the lifecycle and is unnecessary).
- **`pino-pretty@13.1.3`** as a direct dep on `apps/server`. Listed as a runtime dep (not devDependency) because the dev process invokes pino-pretty in production-equivalent shell sessions (`pnpm --filter @a-conversa/server start` from a dev terminal). The dev-vs-prod switch lives in code (the `NODE_ENV` check), not in the dependency graph.
- **Test layers per ADR 0022**:
  - **Vitest** unit tests in `apps/server/src/logger.test.ts` covering each mode of `createLoggerOptions` (8 cases) and the `x-request-id` reflection via `createServer({ logger: false })` + `.inject(...)` (4 cases).
  - **Cucumber** scenario in `tests/behavior/backend/request-logging.feature` (1 scenario) asserting a request through `createServer` returns a non-empty `x-request-id` header. Step defs in `tests/behavior/steps/backend-request-logging.steps.ts` (which delegates entirely to the shared `Given` / `When` / `Then` step library — the new `Then the response has a non-empty "..." header` lives in `http-server.steps.ts` since the `lastResponse` carrier is owned there).
- **What's deliberately NOT logged** (privacy / security; documented inline in `logger.ts` so future readers don't restore them):
  - **Request bodies** — they can contain user-authored statement text, screen names, OAuth state, etc.
  - **Authorization / Cookie / Set-Cookie headers** — bearer tokens, session cookies. Pino's standard request serializer drops these by default; the helper does not re-enable them.
  - **Query strings on auth-callback routes** — OAuth `code` and `state` parameters. The default serializer logs `url` (path + query); the auth route handlers (when they land) are responsible for not echoing query strings into log messages.
- **No observability stack pre-emption.** OpenTelemetry, Sentry, Datadog, etc. are deliberately out of scope — that's `deployment.observability`'s job. This task just pins the shape that those tools will eventually consume.
- **No ad-hoc probes.** Every empirical check is a committed test; no `node -e`, no inline scripts.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; `apps/server/src/logger.test.ts` adds +14 tests atop the existing 616.
- `pnpm run test:behavior:smoke` (Cucumber) green; `tests/behavior/backend/request-logging.feature` adds 1 scenario atop the existing 113.
- A request through `createServer()` returns an `x-request-id` header; an inbound `x-request-id` is reflected verbatim; two requests with no inbound header get distinct ids.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- The error-handler's existing 5xx behavior (stack capture via `request.log.error({ err })`) keeps working — verified by the existing `error-handler.test.ts` raw-Error case.

## Decisions

- **Per-environment logger config in its own module.** Three alternatives surveyed:
  - **(A) Helper module `logger.ts` returning the Fastify logger option** (chosen). Pure function, unit-testable per-mode, no `process.env` coupling in the helper itself. Matches the plugin pattern the other api_skeleton siblings use (`routes/healthz.ts`, `error-handler.ts`).
  - **(B) Inline ternary in `server.ts`**. The starting point. Functional but not unit-testable; per-mode regressions surface only in integration tests; pretty-printing in dev requires a real Pino options object that's awkward to construct inline.
  - **(C) A Fastify plugin that decorates the logger**. Over-engineered for the surface — Pino is already integrated at the `Fastify({ logger })` slot, so a plugin would add an indirection without buying anything.
- **`pino-pretty` as a transport, not as a wrapper stream.** Two ways to pretty-print:
  - **(A) Transport** (`logger.transport = { target: 'pino-pretty', options }`) (chosen). The transport runs in a worker thread; the main thread's per-request log calls don't block on the prettifier. Recommended by the Pino docs for production parity (prod uses no transport; dev uses one — the same logger code path).
  - **(B) Wrapper stream** (`pino(pretty())` style). Older Pino pattern; runs in-thread; can block the event loop under load. Rejected — even though dev load is trivial, keeping the dev and prod logger setups structurally identical (just different transports / serializers) makes the format switch obviously safe.
- **`request_logging` reflects `request.id` via an `onRequest` hook**, not `onResponse` or `onSend`. Three considered:
  - **`onRequest`** (chosen). Fires before any route handler runs; `reply.header('x-request-id', ...)` queues the header on the pending response. The header appears on every response regardless of which path (success / error-handler / not-found-handler) produced it, because `reply.header(...)` runs once at the start of the lifecycle.
  - **`onSend`**. Also works (runs before headers are flushed). Rejected only because it runs later in the lifecycle — setting the header earlier reduces the chance of an intermediate hook (a future authentication plugin, say) accidentally clobbering it.
  - **`onResponse`**. Rejected — `onResponse` runs *after* headers are flushed to the socket; `reply.header(...)` there is a no-op. The task description named this hook but the Fastify lifecycle docs make it the wrong one in practice.
- **`requestIdHeader: 'x-request-id'`** (the `x-` prefixed convention) rather than Fastify's default `'request-id'`. Most clients / load balancers / tracing libraries use `x-request-id`; matching the convention means callers don't have to know to send the non-prefixed form. The reflected header on the response uses the same name, completing the symmetry.
- **`requestIdLogLabel: 'reqId'`** pinned explicitly even though it matches the Fastify default. The pin makes the Pino log-line key obvious to future readers without requiring them to know Fastify's defaults — a small documentation cost for a cleared assumption.
- **`LOG_LEVEL` validated against the standard Pino level set.** Invalid values (`'infor'`, `'verbose'`) fall back to `'info'` rather than producing a silently broken logger. The validation is silent (no warning to stderr) because the only context where this matters is a misconfigured deployment, which is caught by the structured-JSON output looking suddenly chatty / quiet — a louder warning would just add noise to the diagnostic.
- **`NODE_ENV=test` is unconditional silence**, even with `LOG_LEVEL=debug` set. Tests that need to capture log output pass an explicit `{ logger: { stream } }` override on the `createServer()` call (the existing `error-handler.test.ts` uses this pattern). Letting `LOG_LEVEL` override the test silence would mean every CI run with `LOG_LEVEL` accidentally exported drowns stdout.
- **Dev default (`NODE_ENV` unset) matches `NODE_ENV=development`.** Anything that isn't `'test'` or `'production'` gets the pino-pretty transport. The reasoning is that an unset `NODE_ENV` is almost always a developer running `node` directly; production deployments set `NODE_ENV=production` explicitly (the Dockerfile, the eventual deploy manifests, etc.).
- **Request body, auth headers, query strings: not logged.** Pino's standard request serializer logs only `method`, `url`, `hostname`, `remoteAddress`, `remotePort` — none of which carry secrets in our routes. The serializer is left at the default rather than narrowed further because (a) the default is already conservative, and (b) further redaction is a `deployment.observability` concern when an aggregator wires structured field-level masks.
- **Test layer split.** The per-mode `createLoggerOptions` cases are pure logic (no I/O, no DB) — Vitest unit tests per ADR 0006. The `x-request-id` reflection is also pure (no DB) but uses a Fastify instance via `.inject(...)`; that's still the Vitest layer (matching `server.test.ts`, `error-handler.test.ts`). The Cucumber scenario verifies the same surface end-to-end in the behavior layer, which guards against a regression where the hook is accidentally removed at the `server.ts` plumbing layer rather than the helper layer.

## Open questions

- **`requestId` in the error envelope.** `error_handling`'s refinement flagged this: `{ error: { code, message, requestId, ...detail } }`. Deferred from `error_handling` to here, and now deferred again from here to a follow-up — adding `requestId` to the envelope is a small change but it's a body-shape change to a stable contract; the right home is probably an explicit refinement that audits all envelope-shape consumers (frontend error renderer, WS error message, OpenAPI spec) and changes them together.
- **Pino redaction list for future routes.** `Authorization`, `Cookie`, and `Set-Cookie` aren't logged today because the default request serializer doesn't log headers at all. When the auth routes or session routes start logging custom fields, an explicit redaction list (`redact: ['req.headers.authorization', ...]`) becomes relevant. Deferred to the first route that needs it.
- **Trace-context (W3C traceparent) propagation.** OpenTelemetry-style `traceparent` / `tracestate` header propagation is out of scope — that's `deployment.observability`. Today's `x-request-id` is sufficient for a single-process trace.
- **Per-route log-level overrides.** Some endpoints (`GET /healthz`, the WebSocket upgrade ping) might warrant a lower log level than the default to avoid log spam. Fastify supports per-route `logLevel` config; this task does not exercise it yet because the only route that fits the pattern (`/healthz`, hit every few seconds by the compose healthcheck) is already low enough volume that the noise is acceptable.

## Status

**Done** — 2026-05-10. Landed as:

- Helper module: [`apps/server/src/logger.ts`](../../../apps/server/src/logger.ts).
- Server wiring: [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) (uses `createLoggerOptions(process.env)`; adds `requestIdHeader: 'x-request-id'`, `requestIdLogLabel: 'reqId'`, and the `onRequest` hook that echoes `request.id` to the response).
- Dependency: `pino-pretty@13.1.3` added to [`apps/server/package.json`](../../../apps/server/package.json) as a direct dep.
- Vitest: [`apps/server/src/logger.test.ts`](../../../apps/server/src/logger.test.ts) (+14 tests).
- Cucumber: [`tests/behavior/backend/request-logging.feature`](../../../tests/behavior/backend/request-logging.feature) (+1 scenario), [`tests/behavior/steps/backend-request-logging.steps.ts`](../../../tests/behavior/steps/backend-request-logging.steps.ts) (no new step defs; reuses the shared library). The new `Then the response has a non-empty "..." header` step lives in [`tests/behavior/steps/http-server.steps.ts`](../../../tests/behavior/steps/http-server.steps.ts) alongside the `lastResponse` carrier it reads.
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
