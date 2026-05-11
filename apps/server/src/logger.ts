// Per-environment Pino logger configuration for the Fastify server.
//
// Refinement: tasks/refinements/backend/request_logging.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.api_skeleton.request_logging
//
// Fastify ships Pino by default; this module centralizes the
// per-environment configuration so every request gets a uniform
// structured log line (method, url, statusCode, responseTime,
// reqId) in production, a human-readable line in development,
// and silence under tests.
//
// **Why a helper, not an inline config in `server.ts`.** Three
// reasons:
//   1. `createServer({ logger: false })` is what tests pass to
//      silence the logger explicitly. Without this helper,
//      `server.ts` would have to read `process.env.NODE_ENV` inline
//      and the per-mode branching would not be unit-testable.
//   2. `pino-pretty`-vs-structured-JSON is the kind of decision that
//      grows over time (redaction lists, custom serializers,
//      transport routing). Keeping it in its own module with its own
//      tests means future tightening doesn't require touching the
//      bootstrap.
//   3. The shape returned by this helper is exactly what
//      `Fastify({ logger: ... })` accepts; no adapter layer is
//      needed at the call site.
//
// **What's deliberately NOT logged** (privacy / security):
//   - Request bodies — they can contain user-authored statement
//     text, screen names, OAuth state, etc. Bodies are out of scope
//     for the per-request access log.
//   - Authorization / Cookie / Set-Cookie headers — bearer tokens,
//     session cookies, OAuth state. Pino's standard request
//     serializer is replaced (see below) so headers are dropped
//     entirely from the access line.
//   - Query strings on auth-callback routes — those carry OAuth
//     authorization codes and state nonces. Not solved here at
//     library level; the auth route handlers are responsible for
//     not echoing query strings into log messages. The default
//     serializer logs only `url` (path + query); the auth tasks
//     can override that when they land.
//
// Observability stack (OpenTelemetry, log aggregator, Sentry) is
// deliberately out of scope — that's `deployment.observability`.

import type { FastifyServerOptions } from 'fastify';

/**
 * The shape returned by `createLoggerOptions`. Matches what
 * `Fastify({ logger: ... })` accepts when set — either `false`
 * (silence the logger entirely) or a Pino options object (which
 * Fastify forwards to its internal Pino instance).
 *
 * Derived from `FastifyServerOptions['logger']` with `undefined`
 * excluded so the helper's return type is compatible with the
 * `Fastify({ logger: ... })` slot under the project-wide
 * `exactOptionalPropertyTypes: true` (see
 * [ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)).
 * Fastify's option is `boolean | PinoOptions | undefined`; the
 * helper always returns a concrete value (no `undefined`), so
 * exporting the narrower type makes the assignment safe at the
 * call site.
 */
export type LoggerOptions = Exclude<FastifyServerOptions['logger'], undefined>;

/**
 * The shape of `process.env` this helper consumes. Typed as a
 * subset of `NodeJS.ProcessEnv` so callers can pass `process.env`
 * directly without an `as any` cast and tests can construct a
 * minimal env object without touching the real `process.env`.
 *
 * Both keys are optional — unset values are valid and mean "use
 * the default for this mode."
 */
export interface LoggerEnv {
  readonly NODE_ENV?: string | undefined;
  readonly LOG_LEVEL?: string | undefined;
}

/**
 * Valid Pino log levels. Pino accepts any string at the type level
 * but emits a warning at runtime for unknown levels; we narrow to
 * the standard set so a typo like `LOG_LEVEL=infor` falls back to
 * `'info'` rather than producing a silently broken logger.
 */
const VALID_LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
type LogLevel = (typeof VALID_LOG_LEVELS)[number];

function isValidLogLevel(value: string): value is LogLevel {
  return (VALID_LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * Resolve the desired log level from the environment. Reads
 * `LOG_LEVEL`; falls back to `'info'` if unset, empty, or not one
 * of the valid Pino levels.
 *
 * The fallback is deliberately silent (no warning to stderr)
 * because the only contexts where this matters are (a) misconfigured
 * deployments — caught by the structured-JSON output looking
 * suddenly chatty/quiet, and (b) the test suite, which sets
 * `NODE_ENV=test` and bypasses level resolution entirely.
 */
function resolveLogLevel(env: LoggerEnv): LogLevel {
  const raw = env.LOG_LEVEL;
  if (typeof raw === 'string' && raw.length > 0 && isValidLogLevel(raw)) {
    return raw;
  }
  return 'info';
}

/**
 * Build the per-environment logger configuration.
 *
 * Three modes:
 *
 *   - **`NODE_ENV=test`**: return `false`. Fastify treats this as
 *     "no logger at all," so route smoke tests do not drown stdout
 *     and assertions over the response body never race against a
 *     parallel log write. Tests that need to capture log output
 *     pass an explicit `{ logger: { stream } }` override on the
 *     `createServer()` call.
 *
 *   - **`NODE_ENV=production`**: structured JSON. No transport, no
 *     prettifier; the Pino default JSON serializer emits one
 *     newline-delimited JSON object per log call, suitable for any
 *     log aggregator. `LOG_LEVEL` is honored; defaults to `'info'`.
 *
 *   - **Anything else** (development, unset, etc.): `pino-pretty`
 *     transport for human-readable output. Colorized, timestamp
 *     translated to local time, request-id included.
 *     `LOG_LEVEL` is honored; defaults to `'info'`.
 *
 * The Fastify request-id (set per request, included in every log
 * line via Pino's `reqId` key) is propagated to the response as
 * `x-request-id` by a separate `onResponse` hook in `server.ts` —
 * that hook lives at the framework layer, not the logger layer,
 * because it touches `reply.header(...)` and the Fastify
 * encapsulation barrier rather than the Pino instance.
 *
 * @param env - the `process.env` (or a test-shaped subset). Reads
 *              `NODE_ENV` to pick the mode and `LOG_LEVEL` to set
 *              the level (within the chosen mode).
 * @returns the value to pass as `Fastify({ logger: ... })`.
 */
export function createLoggerOptions(env: LoggerEnv): LoggerOptions {
  const nodeEnv = env.NODE_ENV;

  if (nodeEnv === 'test') {
    // Fastify documents `logger: false` as "disable logging entirely."
    // Returning a `{ level: 'silent' }` object would also work but
    // Pino still allocates the logger; `false` is cheaper and is the
    // shape the bootstrap previously used.
    return false;
  }

  const level = resolveLogLevel(env);

  if (nodeEnv === 'production') {
    // Structured JSON, one object per line. No transport — Pino's
    // default serializer writes to stdout. Aggregators (Loki,
    // CloudWatch, etc.) ingest this directly.
    return { level };
  }

  // Development (and anything else: NODE_ENV unset, NODE_ENV=ci, ...).
  // pino-pretty is loaded as a transport so the format switch happens
  // in a worker thread and doesn't block the event loop. The
  // `translateTime` option converts the epoch-ms `time` field to a
  // local ISO-like timestamp; `ignore` drops noisy keys that aren't
  // useful in dev (pid + hostname are always the same value across
  // every line).
  return {
    level,
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
        // `singleLine` keeps the per-request log to one line in dev;
        // the structured fields (reqId, method, url, statusCode,
        // responseTime) are appended after the message rather than
        // pretty-printed across multiple lines.
        singleLine: true,
      },
    },
  };
}
