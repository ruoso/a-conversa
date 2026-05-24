# 0033 — Production observability: Railway logs + Sentry

- **Date**: 2026-05-24
- **Status**: Accepted

## Context

M9 (`m_deployment_ready`) needs operational visibility into prod:
errors caught with enough context to fix, uptime monitoring that
notices outages before users do, and basic resource metrics. The
`deployment.observability` rollup has five leaves:
`structured_logging`, `error_tracking`, `basic_metrics`,
`health_and_readiness_endpoints`, `uptime_monitoring`.

The application already produces structured JSON logs via Pino
(`backend_hardening.auth_hardening.pino_redact_config` configures
the sensitive-field redaction). Railway's dashboard provides log
tail + CPU/RAM/network charts out of the box per
[ADR 0031](0031-production-hosting-railway-paas.md), which covers
the platform layer for free. What's missing is error tracking
(stack traces with breadcrumbs), uptime monitoring (external probe
that doesn't depend on Railway's status to say Railway is up), and
a `/readyz` endpoint that distinguishes "server is up" from
"server is up and the database is reachable and migrations are
applied."

Observability stack picks at this scale tend to over-engineer. The
realistic v1 traffic is one show every couple weeks plus background
exploration — there is no continuous high-volume signal to mine, no
on-call rotation, and no SRE to maintain a self-hosted Grafana
stack. The right shape is the smallest setup that catches silent
regressions during a live show.

## Decision

**Production observability for v1 is Railway's built-in
log/metric dashboard plus Sentry for error tracking.** No
self-hosted observability stack, no second SaaS aggregator, no
custom Prometheus pipeline.

- **Logs.** Railway's built-in log dashboard ingests Pino's prod
  JSON output (the existing prod gates ensure Pino emits structured
  JSON when `NODE_ENV=production`). One log stream per Railway
  service (`app`, `authelia`); cross-service search is the operator
  walking between tabs. Retention is Railway's default (~7 days on
  Hobby). No log aggregator in front.
- **Error tracking.** Sentry via `@sentry/node`, initialized in the
  Fastify server bootstrap before any other plugin so route
  handlers and the WebSocket handlers all enroll. DSN supplied via
  Railway Variable `SENTRY_DSN`; absence at boot is non-fatal (the
  SDK no-ops cleanly), so dev / CI / Compose stacks keep working
  unchanged.
- **`/readyz`.** A new endpoint sibling to `/healthz`. `/healthz`
  remains a pure liveness probe (the process is alive); `/readyz`
  additionally pings Postgres and verifies the startup migration
  gate completed successfully. Failing either flips the response
  to 503. The endpoint is the surface for both Railway's readiness
  probe and the external uptime monitor.
- **Uptime monitoring.** External probe pings `/healthz` every
  60s from outside Railway. Sentry's bundled uptime monitor (free
  tier covers a single endpoint) is the default; BetterStack's
  free tier is the documented fallback if Sentry's uptime story
  degrades. The probe page-and-alert configuration lives in the
  `admin_runbook` refinement.
- **Metrics.** No custom metrics pipeline in v1. Railway's
  dashboard covers CPU / RAM / network / request rate at the
  service level. Application-level metrics (event-log lag, WS
  connection count, per-handler latency) are emitted as
  structured Pino log lines on a low-cadence interval (every
  60s) so they show up in the log search without a separate
  metrics path. The `basic_metrics` task reduces to: pick the
  metric fields, emit them as log lines, document the search
  queries.

## Consequences

- **Two dashboards to monitor, not four.** Railway tab for
  resource health + logs; Sentry tab for errors + uptime. The
  operator can keep both pinned during a show without context
  collapse.
- **No log aggregation across services.** Authelia logs are in
  Railway's `authelia` service tab, app logs are in `app`'s tab.
  Acceptable for v1: most operational questions live entirely on
  one side or the other. Revisit if cross-service correlation
  becomes a frequent need.
- **Sentry vendor dependency.** Sentry's free tier (5k errors/mo,
  1 user, basic retention) is comfortably enough for one show
  every couple weeks. If Sentry pricing or terms change, the
  documented migration path is **GlitchTip** — the Sentry SDK
  works against GlitchTip's API unchanged, so swapping is a DSN
  change + a Railway service for GlitchTip itself. The migration
  is a refinement-time call, not an architectural one.
- **Custom metrics are deferred behind log lines.** Emitting the
  fields as structured logs keeps the data path simple but means
  graphing them requires a query against the log search rather
  than a chart. Acceptable while traffic is sparse; the natural
  upgrade is a hosted metric ingestor (BetterStack, Axiom)
  consuming the same log lines.
- **`/readyz` becomes the deploy gate.** The Railway service
  configuration sets `/readyz` as the readiness probe; a deploy
  is not considered healthy until `/readyz` returns 200. This
  catches migration failures (the startup migration gate already
  refuses to listen on failure, but `/readyz` makes it visible to
  Railway's deploy machinery too).
- **Log retention is short.** Seven days on Hobby. For post-show
  forensics longer than a week, the operator exports the relevant
  log window to local storage. The full `event_log_export` task
  ([per the M9 scope decisions, deferred to post-v1](#deferred-questions))
  would solve this more thoroughly; until then, the log export is
  manual.

## Deferred questions

- **Custom Sentry alert rules + on-call rotation.** v1 ships with
  Sentry's default project-level email notifications. Alert tuning
  (per-handler thresholds, paging integrations) lands when the
  alert volume signals it's needed.
- **Long-term log retention / archival.** Hobby tier retention is
  ~7 days; ad-hoc export covers v1. Post-v1 either upgrades to a
  Railway tier with longer retention or adds a log-archival
  pipeline.
- **GlitchTip migration trigger.** Move when Sentry's free tier no
  longer covers the project or when self-hosting beats $0.
- **Cross-service tracing.** Out for v1 (the per-show traffic
  doesn't justify it). Revisit if debugging an app↔Authelia
  interaction becomes a recurring exercise.

## Verification

This ADR commits to the observability shape. The Sentry SDK
wiring, the `/readyz` implementation, and the uptime-monitor
configuration are owned by:

- `deployment.observability.structured_logging` — confirms the
  existing Pino JSON output is the prod log path; no new code.
- `deployment.observability.error_tracking` — Sentry SDK init.
- `deployment.observability.basic_metrics` — picks the log-line
  metric fields.
- `deployment.observability.health_and_readiness_endpoints` —
  adds `/readyz` next to the existing `/healthz`.
- `deployment.observability.uptime_monitoring` — picks Sentry or
  BetterStack as the probe and documents the alert routing.

All five refinements cite this ADR as their decision input.
