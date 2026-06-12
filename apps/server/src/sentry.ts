// Sentry error-tracking init + Fastify error-capture attachment.
//
// Refinement: tasks/refinements/deployment/error_tracking.md
// ADRs:        docs/adr/0033-production-observability-railway-sentry.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: deployment.observability.error_tracking
//
// Per ADR 0033, production error tracking is Sentry via
// `@sentry/node`: stack traces with grouping and email notification,
// complementing the `"level":50` log lines in Railway's (short-
// retention) log dashboard. Two deliberate properties:
//
//   - **DSN-absent no-op, structurally.** When `SENTRY_DSN` is unset
//     or empty, `initSentry` returns without constructing anything —
//     no client, no integrations, no network. Dev / CI / compose /
//     test stacks ship the SDK in the image but never arm it; the
//     operator arms production by setting the Railway Variable.
//     `attachSentryErrorCapture` is guarded on `isInitialized()`, so
//     unarmed instances are byte-identical to the pre-Sentry server.
//
//   - **Error tracking only — no performance tracing.** Neither
//     `tracesSampleRate` nor `tracesSampler` is set, which keeps the
//     SDK's tracing machinery disabled. ADR 0033 explicitly defers
//     cross-service tracing; the ESM `--import @sentry/node/preload`
//     loader hook that full auto-instrumentation would need is
//     likewise not wired (error capture works without it).
//
// **How route errors enroll.** `setupFastifyErrorHandler(app)` is
// Sentry's official Fastify integration: it observes errors via the
// `onError` hook + diagnostics channel, running ALONGSIDE the
// project's canonical envelope handler (error-handler.ts) — the
// response shape stays owned by the envelope handler; Sentry only
// observes. Process-level crashes outside the request lifecycle
// (uncaughtException / unhandledRejection) are covered by the SDK's
// default integrations.
//
// **What is NOT sent.** `sendDefaultPii` stays off (the default):
// no cookies, no auth headers, no request bodies beyond SDK
// defaults. The Pino redact list (logger.ts) guards the log path;
// this module's restraint guards the Sentry path.

import * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';

import { resolveServerVersion } from './version.js';

/**
 * The env subset this module consumes. Same pattern as `LoggerEnv`:
 * callers pass `process.env` directly; tests construct a minimal
 * object.
 */
export interface SentryEnv {
  readonly SENTRY_DSN?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

/**
 * Extra options forwarded to `Sentry.init` — the test seam.
 * Production callers pass nothing; tests pass `beforeSend` to
 * capture-and-drop events so nothing leaves the process (ADR 0022:
 * assertions run against the captured event, not a live service).
 */
export interface InitSentryOverrides {
  readonly beforeSend?: NonNullable<Parameters<typeof Sentry.init>[0]>['beforeSend'];
}

/**
 * Initialize the Sentry SDK from the environment. Returns `true`
 * when the SDK was armed, `false` on the DSN-absent no-op path.
 *
 * Called FIRST in `index.ts`'s `main()` — before the secret gate,
 * before `createServer()` — per ADR 0033's "initialized in the
 * Fastify server bootstrap before any other plugin."
 */
export function initSentry(env: SentryEnv, overrides: InitSentryOverrides = {}): boolean {
  const dsn = env.SENTRY_DSN;
  if (dsn === undefined || dsn === '') {
    // Structural no-op: don't even construct a disabled client.
    // `isInitialized()` stays false, which is what gates
    // `attachSentryErrorCapture` below.
    return false;
  }

  Sentry.init({
    dsn,
    // Same build stamp /healthz and the OpenAPI document use — events
    // and probes agree about which build is running.
    release: resolveServerVersion(),
    environment: env.NODE_ENV ?? 'development',
    ...(overrides.beforeSend === undefined ? {} : { beforeSend: overrides.beforeSend }),
  });
  return true;
}

/**
 * Attach Sentry's Fastify error capture to the instance — guarded so
 * unarmed processes (no DSN: every dev / CI / test run) register
 * nothing and stay byte-identical to the pre-Sentry bootstrap.
 *
 * Called from `createServer()` right after the canonical envelope
 * error handler registers; the two coexist (onError hook vs.
 * setErrorHandler), with the envelope handler owning the response.
 */
export function attachSentryErrorCapture(app: FastifyInstance): void {
  if (!Sentry.isInitialized()) {
    return;
  }
  Sentry.setupFastifyErrorHandler(app);
}
