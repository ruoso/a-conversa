# Structured-logging conventions — confirm the prod log path, write the conventions down

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.observability.structured_logging`
**Effort estimate**: 1d
**Inherited dependencies**: none in the WBS. Practically builds on `backend.api_skeleton.request_logging` (the `createLoggerOptions` helper at `apps/server/src/logger.ts`) and `backend_hardening.auth_hardening.pino_redact_config` (the redact block) — both settled.
**Executor**: implementation agent — repo-only work, part of milestone `m_predeploy_agent_work` (M9-prep). No secrets, no privileged access.

## What this task is

Per [ADR 0033](../../../docs/adr/0033-production-observability-railway-sentry.md)'s verification section, this leaf "confirms the existing Pino JSON output is the prod log path; no new code." Two deliverables:

1. **Confirmation.** Audit that the production logging pipeline is what ADR 0033 assumes: Pino structured JSON, one object per line, written to stdout (no transport, no log files), with the redact block applied — so Railway's per-service log dashboard can ingest it directly. The confirmation is anchored to the existing vitest pins, not to a new ad-hoc probe (ADR 0022).
2. **Conventions document.** Write the structured-logging conventions down in a new `docs/observability.md` — the operator/developer-facing companion to ADR 0033: what the app emits, where it lands in production, and the rules every new log call follows so the log stream stays searchable.

## Why it needs to be done

- `observability.error_tracking` and `observability.basic_metrics` both gate on this leaf in the WBS (`depends !structured_logging`). `basic_metrics` in particular reduces to "emit metric fields as structured log lines" (ADR 0033), which only makes sense once the log-line conventions are fixed.
- Railway's log dashboard is the **only** log viewer in production (no aggregator, per ADR 0033). If log calls drift into unstructured string-interpolation, the search surface degrades and there is no second system to compensate.
- The milestone `m_predeploy_agent_work` (M9-prep) lists this leaf; M9 gates on the full `deployment.observability` rollup.

## Inputs / context

From ADR 0033 (Decision → Logs):

> **Logs.** Railway's built-in log dashboard ingests Pino's prod JSON output (the existing prod gates ensure Pino emits structured JSON when `NODE_ENV=production`). One log stream per Railway service (`app`, `authelia`); cross-service search is the operator walking between tabs. Retention is Railway's default (~7 days on Hobby). No log aggregator in front.

Existing artifacts (all pre-task; none of them change here):

- [`apps/server/src/logger.ts`](../../../apps/server/src/logger.ts) — `createLoggerOptions(env)`: `NODE_ENV=test` → `false` (no logger); `NODE_ENV=production` → `{ level, redact }` (default Pino JSON serializer to stdout, no transport); anything else → pino-pretty transport. `LOG_LEVEL` honored with a validated fallback to `info`. `LOGGER_REDACT_CONFIG` rewrites cookie / authorization / token / password / secret fields to `'[redacted]'`.
- [`apps/server/src/logger.test.ts`](../../../apps/server/src/logger.test.ts) — pins all of the above: "returns structured JSON (no transport) when `NODE_ENV=production`", the redact structural pins, and the end-to-end log-capture censorship tests.
- [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) — `createServer()` passes `createLoggerOptions(process.env)` to Fastify; an `onResponse` hook reflects the per-request id as the `x-request-id` response header.
- Call-site survey (2026-06-11): every non-test `log.*` call in `apps/server/src` already follows the bag-first shape — `log.warn({ field }, 'static message')` or `log.error({ err }, 'static message')` — via `app.log`, `request.log`, or an injected child logger. No call site string-interpolates values into the message.

## Constraints / requirements

- **No new runtime code.** ADR 0033 scopes this leaf to confirmation + conventions. If the audit had found a gap (e.g., a file transport, or prod logs not on stdout), closing it would have been in scope — it did not.
- **New document `docs/observability.md`** with at least a **Logs** section covering:
  - the production log path (Pino JSON → stdout → Railway log dashboard; retention; one stream per service);
  - the log-line shape (Pino base fields, request-scoped fields, numeric level values for raw-JSON search);
  - the conventions for new log calls (bag-first, static message strings, `err` key for errors, request-scoped logging through `request.log`, level guidance);
  - what must never be logged, and the redact safety net's role (defense in depth, not permission);
  - `LOG_LEVEL` handling and the dev/test modes, so a developer reading prod conventions also learns why their local output looks different.
- **Structured to be extended, not duplicated**: the sibling leaves add their own sections to the same document (`error_tracking` → Error tracking; `basic_metrics` → Metrics; `health_and_readiness_endpoints` → Health and readiness; `uptime_monitoring` → Uptime monitoring). One observability page, mirroring ADR 0033's "two dashboards, not four" stance.
- **Verification stays test-anchored** (ADR 0022): the doc links the existing vitest pins as the proof of the prod path; this task adds no throwaway verification scripts.

## Acceptance criteria

- `docs/observability.md` exists; its Logs section covers the path / shape / conventions / never-log / modes items above and links ADR 0033, `logger.ts`, and `logger.test.ts`.
- The documented conventions match the code: the call-site survey finds no contradicting log call (it didn't — see Inputs), and the documented line shape matches what the pinned tests assert.
- `pnpm run format:check` passes on the new/changed files.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the `complete 100` marker lands.

## Decisions

- **One `docs/observability.md`, not a separate `docs/logging.md`.** ADR 0033's whole point is a deliberately small observability surface (Railway tab + Sentry tab). The operator-facing documentation mirrors that: one page, one section per concern, each owned by the leaf that lands it. A standalone logging doc would be the first step toward the doc sprawl the ADR avoids.
- **Conventions codify existing practice rather than inventing new rules.** The call-site survey found the codebase already uniform (bag-first calls, static messages, `err` key). Writing down what is already true keeps the doc enforceable by review without a migration task.
- **No lint rule enforcing log-call shape.** A custom ESLint rule for "no template literals in log messages" is buildable but over-engineered at this scale (one server package, log calls reviewed in PRs). The doc + review is the mechanism; revisit if drift actually appears.
- **Numeric level values documented explicitly.** Railway's log search matches against the raw JSON line, so the doc gives the `"level":50` form for finding errors — the human-readable label (`error`) does not appear in Pino's default JSON output.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-11. Landed as:

- [`docs/observability.md`](../../../docs/observability.md) — new document; Logs section covering the production log path, line shape, log-call conventions, never-log list + redact safety net, `LOG_LEVEL`, and dev/test modes. Sibling sections (Error tracking, Metrics, Health and readiness, Uptime monitoring) are added by their own leaves.
- No runtime code changes — the audit confirmed the prod path matches ADR 0033 (Pino JSON to stdout, redact applied), already pinned by `apps/server/src/logger.test.ts`.
- `complete 100` marker added in [tasks/70-deployment.tji](../../70-deployment.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
