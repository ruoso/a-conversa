# Observability

How a running a-conversa instance is observed in production, and the
conventions the code follows so that observation stays useful.

The architectural shape is fixed by
[ADR 0033](adr/0033-production-observability-railway-sentry.md):
**Railway's built-in log/metric dashboard plus Sentry for error
tracking** — no self-hosted observability stack, no log aggregator, no
custom metrics pipeline. The operator watches two dashboards: the
Railway tab (resource health + logs) and the Sentry tab (errors +
uptime).

This document is the operator/developer-facing companion to that ADR.
Each section is owned by the `deployment.observability` task that
landed it; sections appear as their tasks ship.

## Logs

_Owned by `deployment.observability.structured_logging`
([refinement](../tasks/refinements/deployment/structured_logging.md))._

### The production log path

When `NODE_ENV=production`, the server emits **Pino structured JSON,
one object per line, on stdout**. There is no transport, no
prettifier, and no log file — Railway captures each service's
stdout/stderr into its per-service log dashboard, which is the only
log viewer in production. Retention is Railway's default (~7 days on
the Hobby plan); for post-show forensics beyond that window the
operator exports the relevant range manually (ADR 0033).

There is one log stream per Railway service: the app's Pino output
lives in the `app` service tab, Authelia's output in the `authelia`
tab. Cross-service correlation is the operator walking between tabs.

The configuration is built by `createLoggerOptions(env)` in
[`apps/server/src/logger.ts`](../apps/server/src/logger.ts) and is
pinned by
[`apps/server/src/logger.test.ts`](../apps/server/src/logger.test.ts)
(structured-JSON-in-prod, redaction paths, censorship end-to-end).
Those tests are the canonical confirmation that the path described
here is the path that ships.

### Log line shape

Every line is a single JSON object. Base fields (Pino defaults):

| Field      | Meaning                                                       |
| ---------- | ------------------------------------------------------------- |
| `level`    | numeric Pino level — see the table below                      |
| `time`     | epoch milliseconds                                            |
| `pid`      | process id (constant per deploy)                              |
| `hostname` | container hostname (constant per deploy)                      |
| `msg`      | the static message string passed to the log call              |
| `reqId`    | Fastify per-request id, present on every request-scoped line  |

Request lifecycle lines additionally carry Fastify's serializer
output: `req.method`, `req.url`, `req.remoteAddress` on the incoming
line; `res.statusCode` and `responseTime` (ms) on the completion
line. The `reqId` is also reflected to clients as the
`x-request-id` response header (hook in
[`apps/server/src/server.ts`](../apps/server/src/server.ts)), so a
user-reported failure can be joined to its log lines.

Because Railway's log search matches against the raw JSON line, the
**numeric** level values are what you filter on:

| Level   | Number | Search snippet |
| ------- | ------ | -------------- |
| `trace` | 10     | `"level":10`   |
| `debug` | 20     | `"level":20`   |
| `info`  | 30     | `"level":30`   |
| `warn`  | 40     | `"level":40`   |
| `error` | 50     | `"level":50`   |
| `fatal` | 60     | `"level":60`   |

A quick "anything wrong?" sweep over the `app` stream is a search for
`"level":50` (errors) and `"level":40` (warnings).

### Conventions for log calls

The codebase follows these rules uniformly; new code must too. They
exist so the log stream stays mechanically searchable with nothing
smarter than Railway's substring filter.

1. **Bag first, message second.**
   `log.info({ sessionId }, 'session ended')` — never interpolate
   values into the message string. The fields are what searches and
   future tooling filter on; an interpolated message is opaque to
   both.
2. **Static message strings.** The `msg` value is the search key for
   "all occurrences of this event." Keep it constant per call site;
   per-event data goes in the bag.
3. **Errors go under the `err` key.**
   `log.error({ err }, 'startup migration gate failed; aborting')` —
   Pino's standard `err` serializer renders message, type, and stack.
   Any other key logs the error as an opaque object.
4. **Request-scoped logging goes through `request.log`.** It is a
   child logger carrying `reqId`, so the line joins the request's
   lifecycle lines for free. The WebSocket layer logs through the
   upgrade request's `request.log` (or an injected child logger) for
   the same reason.
5. **Level guidance.**
   - `fatal` — the process is about to abort.
   - `error` — unexpected failure a developer should look at
     (these are also Sentry's domain — see Error tracking).
   - `warn` — degraded or suspicious but handled: rejected input,
     a skipped startup gate, a pruned subscription.
   - `info` — lifecycle and state transitions worth seeing in prod
     by default: server listening, shutdown signal, session ended.
   - `debug` / `trace` — local diagnostics; below the prod default
     level, so they cost nothing in production.

### What must never be logged

- **Request bodies** — they carry user-authored statement text,
  screen names, OAuth state.
- **Cookies, authorization headers, tokens, passwords, secrets.**
- **Auth-callback query strings** — they carry OAuth authorization
  codes and state nonces.

The Pino `redact` block (`LOGGER_REDACT_CONFIG` in `logger.ts`)
rewrites cookie / authorization / token / password / secret fields to
`'[redacted]'` on every line before it leaves the process, in both
prod and dev modes. That is **defense in depth, not permission**: the
redact list catches the field names it knows about, so the rule is
still "don't put secret material in a log bag," with redaction as the
backstop for the call site that slips through review. Sources and
path-list rationale:
[`pino_redact_config` refinement](../tasks/refinements/backend-hardening/pino_redact_config.md).

### `LOG_LEVEL` and the three modes

`LOG_LEVEL` selects the minimum level (`fatal` … `trace`, or
`silent`); unset, empty, or invalid values fall back to `info`.
Production keeps the default `info` — set the variable on the Railway
service only for a temporary diagnostic window.

The three `NODE_ENV` modes (all pinned in `logger.test.ts`):

- **`production`** — structured JSON to stdout, as above.
- **`test`** — `logger: false`; the suite stays silent and tests that
  assert on log output construct their own capture stream.
- **anything else** (development, unset) — `pino-pretty` transport:
  colorized single-line output, local-time timestamps, `pid`/
  `hostname` dropped. Same redaction, same level resolution — only
  the rendering differs, which is why local output looks nothing
  like the prod JSON this document describes.

<!--
Sections added by sibling deployment.observability tasks as they land:

## Error tracking   — deployment.observability.error_tracking
## Metrics          — deployment.observability.basic_metrics
## Health and readiness — deployment.observability.health_and_readiness_endpoints
## Uptime monitoring — deployment.observability.uptime_monitoring
-->
