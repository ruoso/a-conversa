# Basic metrics — metric fields as interval log lines + the search queries

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.observability.basic_metrics`
**Effort estimate**: 1d
**Inherited dependencies**: `observability.structured_logging` (settled — the log-line conventions and the `docs/observability.md` doc this extends).
**Executor**: implementation agent — repo-only work, part of milestone `m_predeploy_agent_work` (M9-prep).

## What this task is

Per [ADR 0033](../../../docs/adr/0033-production-observability-railway-sentry.md):

> **Metrics.** No custom metrics pipeline in v1. Railway's dashboard
> covers CPU / RAM / network / request rate at the service level.
> Application-level metrics (event-log lag, WS connection count,
> per-handler latency) are emitted as structured Pino log lines on a
> low-cadence interval (every 60s) so they show up in the log search
> without a separate metrics path. The `basic_metrics` task reduces
> to: pick the metric fields, emit them as log lines, document the
> search queries.

Three deliverables: (1) the picked field set, (2) a metrics-emitter
plugin that logs them under a constant `msg` every 60 seconds,
(3) the Metrics section of `docs/observability.md` with the search
queries.

## Why it needs to be done

- During a live show the operator's only application-level signals
  today are per-request lines and error lines; there is no periodic
  "is the WS fan-out healthy / is the process saturating" heartbeat.
- M9-prep (`m_predeploy_agent_work`) lists this leaf; M9 gates on the
  `observability` rollup.

## Inputs / context

- **Log conventions** — `docs/observability.md` (bag-first, static
  `msg`, numeric levels); Railway search is a substring filter over
  the raw JSON line, so a constant `msg` value is the query key.
- **WS bookkeeping** — `apps/server/src/ws/connection.ts` keeps the
  module-scoped `openConnections` set (today module-private);
  `apps/server/src/ws/subscriptions.ts` decorates a per-app
  `WsSubscriptionRegistry` (`app.wsSubscriptions`) with private
  `bySession` / `byConnection` maps. Both need small read-only
  accessors.
- **Event flow** — event append → projection → WS broadcast is
  **synchronous and in-process** (the bus dispatches inline; there is
  no queue between the event log and the fan-out). See Decisions for
  what that means for ADR 0033's "event-log lag" field.
- **Node built-ins** — `process.memoryUsage()`,
  `perf_hooks.monitorEventLoopDelay()` (histogram; nanosecond
  resolution).

## Constraints / requirements

- **Field set** (the pick this refinement owns), one log line per
  interval, `level: info`, constant `msg: 'app-metrics'`, all fields
  under a `metrics` bag:
  - `wsConnections` — open WebSocket connections.
  - `wsSubscribedSessions` — sessions with ≥1 subscriber.
  - `wsSubscriptions` — total (connection, session) subscription
    pairs.
  - `eventLoopDelayP99Ms` / `eventLoopDelayMaxMs` — event-loop delay
    percentile + max over the past interval (histogram reset per
    tick), in milliseconds.
  - `rssBytes`, `heapUsedBytes` — process memory.
  - `uptimeSec` — process uptime, anchoring the line to a deploy.
- **Cadence**: 60s (`METRICS_INTERVAL_MS` constant; plugin option
  override as the test seam). The interval timer is `unref()`ed so it
  never holds the process open.
- **Plugin shape**: a `fastify-plugin`-wrapped `metricsEmitterPlugin`
  registered in `createServer()`; reads `app.wsSubscriptions` lazily
  per tick (decoration-presence-guarded), logs through `app.log` so
  test mode (`logger: false`) emits nothing and prod emits structured
  JSON; clears the timer + histogram on `onClose`.
- **Accessors**: `countOpenWsConnections()` exported from
  `ws/connection.ts`; `WsSubscriptionRegistry.stats()` returning
  `{ sessions, connections, subscriptions }`. Read-only; no
  bookkeeping changes.
- **Tests** (`apps/server/src/metrics.test.ts` + registry-stats cases
  in the existing subscriptions suite): emitter ticks produce the
  line with the full field shape (fake timers + a capture stream);
  the timer stops on `app.close()`; `stats()` tracks add / remove /
  removeConnection. No port bind, no network (ADR 0022).
- **Docs**: Metrics section in `docs/observability.md` — field
  glossary + the Railway search queries (`app-metrics`,
  `"level":50`, etc.) and what "bad" looks like for each field.

## Acceptance criteria

- A prod-configured server emits one `app-metrics` JSON line per
  60s containing exactly the field set above (pinned by test at a
  short interval via the option seam).
- The timer never keeps the process alive (`unref`) and stops on
  close (pinned by test).
- `pnpm run test:smoke` + `pnpm run check` green.
- `docs/observability.md` Metrics section documents every field and
  its search query.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
  `complete 100`.

## Decisions

- **"Event-log lag" is replaced by event-loop delay, deliberately.**
  ADR 0033 listed "event-log lag" as a candidate field, but the
  append → projection → broadcast path is synchronous in-process —
  there is no queue whose depth could lag, so the literal metric is
  structurally zero. The failure mode it was meant to catch (the
  fan-out falling behind under load) manifests as **event-loop
  delay**, which `monitorEventLoopDelay` measures directly; that is
  the saturation signal worth emitting. If a queue ever appears
  between append and broadcast (e.g. a multi-instance bus), its depth
  becomes a new field then.
- **Per-handler latency stays per-request, not aggregated.** Every
  request-completion line already carries `responseTime`; aggregating
  percentiles in-process duplicates what a log query can compute over
  the same lines. v1 documents the query instead of shipping a
  histogram.
- **`msg: 'app-metrics'` as the search key.** Matches the
  structured-logging conventions (constant `msg`, data in the bag);
  one substring query (`app-metrics`) pulls the full time series out
  of Railway's log search.
- **Interval timer over a `/metrics` endpoint.** ADR 0033 explicitly
  rejects a metrics endpoint/pipeline for v1; log lines need no
  scraper, no auth story, and no new route surface. The `.tji` title
  ("Basic metrics endpoint") predates ADR 0033's reshaping — the ADR
  governs.
- **Registry `stats()` + connection-count accessor instead of
  reaching into private maps.** Keeps encapsulation; the accessors
  are trivially testable and reusable by any future admin surface.
- **60s constant, option-only override.** Same stance as the readyz
  ping timeout: no env tuning until a real deployment needs it; the
  option exists because tests must not wait a minute.

## Open questions

(none — all decided; a hosted metric ingestor consuming the same
lines is ADR 0033's documented upgrade path)

## Status

**Done** — 2026-06-12. Landed as:

- [`apps/server/src/metrics.ts`](../../../apps/server/src/metrics.ts) —
  `metricsEmitterPlugin` (60s unref'd interval, lazy
  `app.wsSubscriptions` read, `onClose` teardown, event-loop-delay
  histogram reset per tick) + `METRICS_INTERVAL_MS` /
  `METRICS_LOG_MSG` constants.
- [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) —
  `countOpenWsConnections()`;
  [`apps/server/src/ws/subscriptions.ts`](../../../apps/server/src/ws/subscriptions.ts) —
  `WsSubscriptionRegistry.stats()`.
- [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) —
  plugin registered after the WS broadcast plugins.
- Tests: [`apps/server/src/metrics.test.ts`](../../../apps/server/src/metrics.test.ts)
  (tick shape, lazy-registry fallback, close teardown) + `stats()`
  cases in
  [`apps/server/src/ws/subscriptions.test.ts`](../../../apps/server/src/ws/subscriptions.test.ts).
- Docs: Metrics section (field glossary + search queries) in
  [`docs/observability.md`](../../../docs/observability.md).
- `complete 100` marker in [tasks/70-deployment.tji](../../70-deployment.tji); tj3 parse clean.
