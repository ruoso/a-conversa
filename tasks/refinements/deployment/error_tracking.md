# Error tracking — Sentry SDK init, DSN-absent no-op

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.observability.error_tracking`
**Effort estimate**: 1d
**Inherited dependencies**: `observability.structured_logging` (settled — the conventions doc this extends; error-level log lines and Sentry events are the same population).
**Executor**: implementation agent — repo-only work, part of milestone `m_predeploy_agent_work` (M9-prep). The **operator touchpoint** (creating the Sentry account/project and setting the `SENTRY_DSN` Railway Variable) is deliberately out of this task: absence of the DSN is non-fatal by construction, so the code side ships first and the operator arms it later.

## What this task is

Wire the Sentry SDK into the server per
[ADR 0033](../../../docs/adr/0033-production-observability-railway-sentry.md):

> **Error tracking.** Sentry via `@sentry/node`, initialized in the
> Fastify server bootstrap before any other plugin so route handlers
> and the WebSocket handlers all enroll. DSN supplied via Railway
> Variable `SENTRY_DSN`; absence at boot is non-fatal (the SDK no-ops
> cleanly), so dev / CI / Compose stacks keep working unchanged.

Concretely: a new `apps/server/src/sentry.ts` module owning init +
the Fastify error-capture attachment, called from `index.ts` (init,
before anything else) and `server.ts` (attachment, guarded on the SDK
actually being initialized).

## Why it needs to be done

- ADR 0033 makes Sentry one of the two production dashboards; without
  the SDK in the image there is nothing for the operator's
  `SENTRY_DSN` Variable to arm.
- A live-show failure today surfaces only as a `"level":50` log line
  in Railway's 7-day window; Sentry adds stack traces, grouping, and
  email notification — the "catches silent regressions during a live
  show" goal.
- The milestone `m_predeploy_agent_work` (M9-prep) lists this leaf;
  `prod_railway_app_service.md` already documents the Variable slot
  (`SENTRY_DSN` — "set when `observability.error_tracking` lands").

## Inputs / context

- **SDK**: `@sentry/node` v10 (latest at refinement time: 10.57.0),
  Node ≥18 — compatible with the project's Node 20 runtime.
  Relevant API: `init`, `isInitialized`, `setupFastifyErrorHandler`,
  `captureException`, `getClient`.
- **Bootstrap order** (`apps/server/src/index.ts`): secret gate →
  `createServer()` → migration gate → listen. Sentry init goes
  first, before the secret gate, so every later startup failure path
  is at least eligible for capture.
- **Error surface** (`apps/server/src/error-handler.ts`): the
  canonical envelope handler logs unhandled 5xx with `{ err }`.
  Sentry's `setupFastifyErrorHandler` attaches via Fastify's
  `onError` hook + diagnostics channel, which runs *alongside* a
  custom `setErrorHandler` — the envelope shape is untouched.
- **Process-level**: `@sentry/node`'s default integrations capture
  `uncaughtException` / `unhandledRejection`, covering crash paths
  outside Fastify's request lifecycle.
- **Env contract**: `.env.example` documents every variable in
  header + per-variable-comment style; `SENTRY_DSN` joins it as a
  commented-out optional.
- **Version stamp**: `resolveServerVersion()`
  (`apps/server/src/version.ts`) is the existing "which build is
  this" source; Sentry's `release` field uses the same helper so
  events and `/healthz` agree about the running build.

## Constraints / requirements

- **DSN-absent no-op is structural.** `initSentry(env)` returns
  without calling `Sentry.init` when `SENTRY_DSN` is unset or empty.
  Dev / CI / compose / test stacks see zero behavioral change: no
  SDK client, no hooks attached, no network. This is the load-bearing
  property — the app service can go live before the operator creates
  the Sentry project.
- **Init before everything** in `index.ts`'s `main()` (ADR 0033:
  "before any other plugin").
- **Error capture on the Fastify path** via
  `setupFastifyErrorHandler(app)` inside `createServer()`, guarded by
  `isInitialized()` so test-constructed instances stay byte-identical
  to before.
- **Error tracking only — no performance tracing.** No
  `tracesSampleRate` / `tracesSampler` (the SDK keeps tracing
  disabled when neither is set). ADR 0033 explicitly defers
  cross-service tracing.
- **Event metadata**: `environment` = `NODE_ENV` (fallback
  `'development'`), `release` = `resolveServerVersion()`.
- **No secret material to Sentry**: request bodies / cookies /
  headers are not attached beyond the SDK defaults (`sendDefaultPii`
  stays off — the default).
- **Tests** (`apps/server/src/sentry.test.ts`), no network (ADR 0022):
  - DSN absent / empty → no init (`isInitialized()` false).
  - DSN present → initialized with the expected `environment` /
    `release` / tracing-off options (asserted via
    `getClient().getOptions()`).
  - End-to-end capture: init with a `beforeSend` that records the
    event and returns `null` (dropping it — nothing leaves the
    process), attach the Fastify handler, inject a route that
    throws, assert the exception event was enrolled AND the response
    still carries the canonical 5xx envelope.
- **Docs**: `docs/observability.md` gains its Error tracking section
  (slot reserved by `structured_logging`); `.env.example` documents
  `SENTRY_DSN`.

## Acceptance criteria

- With `SENTRY_DSN` unset: server boots, all existing tests green,
  `isInitialized()` reports false — pinned by test.
- With a DSN: client options carry dsn / environment / release;
  a thrown route error is enrolled via the Fastify error handler
  while the HTTP response keeps the canonical envelope — pinned by
  the `beforeSend` capture test.
- `pnpm run test:smoke` and `pnpm run check` green.
- `docs/observability.md` + `.env.example` updated.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
  `complete 100`.

## Decisions

- **Skip `Sentry.init` entirely when the DSN is absent** rather than
  calling `init({ dsn: undefined })` (which also no-ops but still
  builds a client and runs integrations). Not constructing anything
  is the cheaper and more legible no-op; `isInitialized()` then
  doubles as the guard for the Fastify attachment.
- **`setupFastifyErrorHandler` over manual `captureException` calls
  in `error-handler.ts`.** The official integration enrolls every
  route error via `onError` + diagnostics channel without coupling
  the project's envelope handler to the Sentry API. The envelope
  handler keeps owning the response shape; Sentry observes.
- **No `--import @sentry/node/preload` loader hook.** Full ESM
  auto-instrumentation (per-request tracing spans) needs the
  preload; error capture does not. ADR 0033 wants error tracking,
  not tracing — adding the loader would complicate the runtime image
  CMD for a feature the ADR defers. Revisit with the cross-service
  tracing deferred question.
- **WS-layer errors stay log-first.** The WS dispatcher catches its
  own errors (they're handled paths — protocol rejections, payload
  validation); process-level integrations catch genuine crashes.
  Adding per-handler `captureException` calls in the WS layer is
  deferred until Sentry volume shows route-level capture missing
  real incidents.
- **`environment` from `NODE_ENV`, not a new `SENTRY_ENVIRONMENT`
  variable.** One fewer Variable to wire; the only deployed
  environment is production (ADR 0031 v1 ships a single instance),
  so per-env routing inside Sentry has nothing to distinguish yet.

## Open questions

(none — all decided; alert tuning and on-call rotation are ADR 0033
deferred questions, owned operator-side)

## Status

**Done** — 2026-06-12. Landed as:

- [`apps/server/src/sentry.ts`](../../../apps/server/src/sentry.ts) —
  `initSentry(env)` (DSN-absent structural no-op; environment /
  release / tracing-off options) + `attachSentryErrorCapture(app)`
  (guarded `setupFastifyErrorHandler`).
- [`apps/server/src/index.ts`](../../../apps/server/src/index.ts) —
  init first in `main()`;
  [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) —
  guarded attachment after the envelope error handler registers.
- Tests: [`apps/server/src/sentry.test.ts`](../../../apps/server/src/sentry.test.ts) —
  no-op pins, option pins, and the `beforeSend`-capture
  end-to-end (route throws → event enrolled, envelope intact,
  nothing leaves the process).
- Dependency: `@sentry/node@^10.57.0` direct dep of `apps/server`.
- Docs: Error tracking section in
  [`docs/observability.md`](../../../docs/observability.md);
  `SENTRY_DSN` documented in `.env.example`.
- `complete 100` marker in [tasks/70-deployment.tji](../../70-deployment.tji); tj3 parse clean.
