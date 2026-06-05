// HTTP server bootstrap for `@a-conversa/server`.
//
// Refinement: tasks/refinements/backend/http_server.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0001-language-and-runtime.md (deferral resolved),
//              docs/adr/0015-dockerfile-multi-stage-pnpm-corepack.md (CMD swap)
// TaskJuggler: backend.api_skeleton.http_server
//
// This module exports `createServer(options?)`, which returns a
// configured `FastifyInstance` ready to listen (or to be exercised via
// `.inject(...)` for in-process tests). The companion `index.ts` is
// the actual entry point that binds the port and handles graceful
// shutdown.
//
// **Plugins wired at bootstrap** — only the ones every future sibling
// task will need:
//   - `@fastify/sensible` — typed `httpErrors` helpers (`reply.notFound()`,
//     `reply.badRequest()`, etc.); the error handler below recognises
//     and passes these through with the canonical envelope.
//   - `@fastify/cors` — permissive in dev (`origin: true`); production
//     locks the allowlist down to `APP_BASE_URL`'s origin (plus an
//     optional `CORS_ORIGIN_ALLOWLIST` for staging multi-origin shapes).
//     Refinement: tasks/refinements/backend-hardening/prod_cors_lockdown.md.
//   - `errorHandlerPlugin` — centralized `setErrorHandler` +
//     `setNotFoundHandler`, serialising every error response under the
//     canonical `{ error: { code, message, ...detail } }` envelope.
//     Owned by `backend.api_skeleton.error_handling`. Registered after
//     sensible+cors but BEFORE the route plugins so route-thrown errors
//     reach the handler instead of Fastify's default serializer.
//
// **Plugins explicitly deferred** to their owning tasks (so this
// bootstrap doesn't pre-empt them):
//   - `@fastify/swagger` + `swagger-ui` → `backend.api_skeleton.openapi_or_equivalent`.
//   - `@fastify/helmet` → later security-headers pass.
//   - A schema type provider (Zod or TypeBox) → first route that
//     actually validates a request body.
//
// **Plugins wired by sibling websocket_protocol tasks** (after this
// bootstrap-list, but registered inside the factory below):
//   - `@fastify/websocket` → wired by `wsConnectionHandlingPlugin`
//     (`backend.websocket_protocol.ws_connection_handling`).
//
// **Routes** wired today:
//   - `GET /` — serves the moderator SPA's `index.html` (registered
//     via `staticFrontendsPlugin` — `backend.api_skeleton.serve_static_frontends`).
//     Was previously a `{ status: 'ok' }` smoke route; that has been
//     removed now that the single-origin deployment serves the
//     moderator UI from the same Fastify process. The compose
//     healthcheck and the human-facing liveness smoke both target
//     `/healthz` instead.
//   - `GET /healthz` — liveness probe (registered via the
//     `healthzPlugin`); the compose `app` service healthcheck targets
//     this route. Owned by `backend.api_skeleton.health_endpoint`.
//     **Lives at the root** (not under `/api/*`) — ops convention.
//   - `GET /api/auth/*`, `GET|POST /api/sessions/*`, `GET /api/ws`,
//     `GET /api/docs[/json]` — every other HTTP / WS surface lives
//     under `/api/*`. The literal `/api` prefix lives directly inside
//     the route declarations (`app.get('/api/auth/login', ...)` etc.)
//     because the route plugins are `fastify-plugin`-wrapped
//     (skip-override) and would not pick up a `prefix` option on
//     `app.register(...)`. Refinement:
//     tasks/refinements/backend/serve_static_frontends_path_collision_fix.md.
//
// Sibling tasks register their routes on the instance returned here.

import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import {
  authenticatePlugin,
  authRoutesPlugin,
  getDefaultDenylistSweeper,
  loadOidcConfig,
  OidcConfigError,
} from './auth/index.js';
import { getDefaultPool } from './db.js';
import { closeUserConnections } from './ws/connection.js';
import { ApiError } from './errors.js';
import { errorHandlerPlugin } from './error-handler.js';
import { createLoggerOptions } from './logger.js';
import { openapiPlugin } from './openapi.js';
import { healthzPlugin } from './routes/healthz.js';
import { staticFrontendsPlugin } from './routes/static-frontends.js';
import { sessionsRoutesPlugin } from './sessions/routes.js';
import { replayRoutesPlugin } from './replay/routes.js';
import { registerTestModeRoutes } from './test-mode/register.js';
import { resolveWsOriginAllowlist } from './ws-origin-allowlist.js';
import { wsHandlersPlugin } from './ws/handlers/index.js';
import {
  wsConnectionHandlingPlugin,
  wsDiagnosticBroadcastPlugin,
  wsProposalStatusBroadcastPlugin,
} from './ws/index.js';

/**
 * Options that vary between deployment modes (production, dev,
 * compose, vitest). Anything Fastify accepts via `FastifyServerOptions`
 * can be passed through; the factory only sets defaults for the
 * options the bootstrap cares about (`logger`, `disableRequestLogging`).
 *
 * Callers in tests typically pass `{ logger: false }` to silence
 * pino under Vitest / Cucumber.
 */
export type CreateServerOptions = FastifyServerOptions;

/**
 * Subset of `process.env` that `resolveCorsOptions` consumes. Typed
 * so callers can pass `process.env` directly without an `as any`
 * cast (per the same pattern as `LoggerEnv` in `logger.ts`).
 *
 * Three keys participate:
 *
 *   - `NODE_ENV` — the mode discriminator. `'production'` selects
 *     the strict allowlist; anything else (`'development'`, `'test'`,
 *     unset, `'ci'`, ...) keeps the open `origin: true` dev default.
 *   - `APP_BASE_URL` — the public-facing base URL. The origin
 *     (`new URL(APP_BASE_URL).origin`) is the canonical allowed
 *     origin in production. When `NODE_ENV === 'production'` and
 *     `APP_BASE_URL` is missing/malformed, `resolveCorsOptions`
 *     throws — a production server with no `APP_BASE_URL` cannot
 *     decide what origins to accept, and failing fast at boot is
 *     safer than silently shipping an open CORS policy.
 *   - `CORS_ORIGIN_ALLOWLIST` — optional comma-separated list of
 *     additional origins to allow in production (staging shapes,
 *     preview deployments on bespoke subdomains, etc.). Each entry
 *     is parsed through `new URL(...).origin` to normalize (so
 *     trailing-slash variants don't slip through as distinct
 *     allowlist entries). Malformed entries cause `resolveCorsOptions`
 *     to throw — same fail-fast posture as `APP_BASE_URL`.
 */
export interface CorsEnv {
  readonly NODE_ENV?: string | undefined;
  readonly APP_BASE_URL?: string | undefined;
  readonly CORS_ORIGIN_ALLOWLIST?: string | undefined;
}

/**
 * Default Fastify `bodyLimit` — 64 KiB. Closes
 * `docs/security/m3-review/inputs.md` F-002. Tight enough to choke a
 * memory-pressure DoS at the framework boundary (before any JSON
 * parser sees a byte); generous enough that no legitimate request
 * body bumps against it. The only HTTP body the server accepts with
 * any free-text length is the session-create `topic` (already capped
 * at 256 chars in the schema layer); every other POST/PATCH body is
 * a few hundred bytes of structured fields.
 *
 * Refinement:
 *   tasks/refinements/backend-hardening/fastify_body_limit.md.
 */
export const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;

/**
 * Env var name production reads to override
 * `DEFAULT_BODY_LIMIT_BYTES`. Exported so tests can assert against
 * the same constant the resolver consults.
 */
export const BODY_LIMIT_ENV = 'BODY_LIMIT_BYTES';

/**
 * Subset of `process.env` consumed by `resolveBodyLimit`. Typed so
 * callers can pass `process.env` directly (same pattern as `CorsEnv`
 * + `LoggerEnv`).
 */
export interface BodyLimitEnv {
  readonly BODY_LIMIT_BYTES?: string | undefined;
}

/**
 * Resolve the Fastify `bodyLimit` from the environment. Production
 * callers pass `process.env`; tests pass a bespoke record.
 *
 *   - Reads `BODY_LIMIT_BYTES` from the supplied env object.
 *   - Returns `DEFAULT_BODY_LIMIT_BYTES` (64 KiB) when the value is
 *     absent, empty, unparseable, or non-positive.
 *   - Returns the parsed integer otherwise.
 *
 * Mirrors the resolve-pattern used by
 * `resolveCatchUpMaxEvents`
 * (`apps/server/src/ws/handlers/catch-up.ts`): the production code
 * path reads the env once at factory time; tests inject directly.
 *
 * Closes `docs/security/m3-review/inputs.md` F-002. Refinement:
 *   tasks/refinements/backend-hardening/fastify_body_limit.md.
 */
export function resolveBodyLimit(env: BodyLimitEnv = process.env): number {
  const raw = env.BODY_LIMIT_BYTES;
  if (raw === undefined || raw === '') {
    return DEFAULT_BODY_LIMIT_BYTES;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BODY_LIMIT_BYTES;
  }
  return parsed;
}

/**
 * Default per-IP request ceiling for the in-process rate limiter. 1000
 * requests / 60 s ≈ 16/s per IP — generous enough that a logged-in
 * user driving a SPA (page navigations triggering bundled asset
 * requests through `@fastify/static`, the JSON API, the OIDC callback
 * leg) never bumps the limit; tight enough that a sustained flood from
 * a single source gets a `429` before reaching any DB / OIDC code
 * path. Production sites that front the server behind a CDN or LB
 * should still rate-limit at the deployment edge; this layer is the
 * in-process guarantee that closes the CodeQL `js/missing-rate-limiting`
 * gap on every HTTP handler.
 *
 * Closes: GitHub code-scanning alerts #2–#9 on `apps/server/src/auth/routes.ts`
 * and `apps/server/src/sessions/routes.ts` (rule `js/missing-rate-limiting`).
 * Refinement:
 *   tasks/refinements/backend-hardening/missing_rate_limiting.md.
 */
export const DEFAULT_RATE_LIMIT_MAX = 1000;

/**
 * Default rolling-window length (milliseconds) the rate limiter counts
 * over. 60 s mirrors the `per-minute` mental model operators carry; the
 * env override accepts millisecond values so a deployment that wants a
 * `per-second` knob can set e.g. `1000` (1 second window) without
 * code change.
 */
export const DEFAULT_RATE_LIMIT_TIME_WINDOW_MS = 60_000;

/** Env var name the resolver consults for the per-window ceiling. */
export const RATE_LIMIT_MAX_ENV = 'RATE_LIMIT_MAX_PER_WINDOW';

/** Env var name the resolver consults for the window length. */
export const RATE_LIMIT_TIME_WINDOW_ENV = 'RATE_LIMIT_TIME_WINDOW_MS';

/**
 * Subset of `process.env` consumed by `resolveRateLimitMax` and
 * `resolveRateLimitTimeWindowMs`. Typed so callers can pass
 * `process.env` directly (same pattern as `BodyLimitEnv`).
 */
export interface RateLimitEnv {
  readonly RATE_LIMIT_MAX_PER_WINDOW?: string | undefined;
  readonly RATE_LIMIT_TIME_WINDOW_MS?: string | undefined;
}

/**
 * Resolve the per-IP per-window request ceiling. Mirrors
 * `resolveBodyLimit` — absent / empty / unparseable / non-positive
 * fall back to `DEFAULT_RATE_LIMIT_MAX`.
 */
export function resolveRateLimitMax(env: RateLimitEnv = process.env): number {
  const raw = env.RATE_LIMIT_MAX_PER_WINDOW;
  if (raw === undefined || raw === '') {
    return DEFAULT_RATE_LIMIT_MAX;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RATE_LIMIT_MAX;
  }
  return parsed;
}

/**
 * Resolve the rate-limit rolling-window length in milliseconds.
 * Same fallback semantics as `resolveRateLimitMax`.
 */
export function resolveRateLimitTimeWindowMs(env: RateLimitEnv = process.env): number {
  const raw = env.RATE_LIMIT_TIME_WINDOW_MS;
  if (raw === undefined || raw === '') {
    return DEFAULT_RATE_LIMIT_TIME_WINDOW_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RATE_LIMIT_TIME_WINDOW_MS;
  }
  return parsed;
}

/**
 * The shape we hand `@fastify/cors`. Narrow enough to commit-pin: the
 * `origin` field is either `true` (reflect any) or a concrete array
 * of allowed origins; `credentials` is always `true` (the session
 * cookie path depends on it). `@fastify/cors`'s upstream type allows
 * `boolean | string | RegExp | ...` — the narrower local type makes
 * the dev-vs-prod boundary visible in the function signature.
 */
export type ResolvedCorsOptions =
  | { readonly origin: true; readonly credentials: true }
  | { readonly origin: string[]; readonly credentials: true };

/**
 * Closes `docs/security/m3-review/auth.md` F-003 — production CORS
 * is no longer a wildcard reflection with cookies. The function
 * returns the options object `@fastify/cors` is registered with.
 *
 * **Dev / test default**: `{ origin: true, credentials: true }`.
 * Reflects any inbound `Origin`. Needed because local development
 * runs at `http://localhost:3000` (the server) but the frontend dev
 * server (Vite) defaults to `http://localhost:5173` and the browser
 * treats `localhost` vs `127.0.0.1` as cross-origin; preview /
 * Storybook ports also vary per developer. The dev story is not the
 * threat model — what matters is locking the production surface.
 *
 * **Production allowlist**: `{ origin: [<APP_BASE_URL.origin>, ...
 * CORS_ORIGIN_ALLOWLIST], credentials: true }`. Only the exact
 * origins listed are echoed back in `Access-Control-Allow-Origin`;
 * cross-origin browser fetches with `withCredentials` from any other
 * origin produce no `Access-Control-Allow-Origin` header and the
 * browser refuses the response. `credentials: true` stays on because
 * the session cookie is what makes the same-origin frontend work.
 *
 * The function deliberately validates `APP_BASE_URL` via `new URL(...)`
 * rather than reaching into `loadOidcConfig` — the CORS policy is
 * not OIDC-conditional. A deployment with no OIDC env vars but a
 * set `APP_BASE_URL` still needs CORS resolved against that base URL.
 *
 * @param env - subset of `process.env`. Pass `process.env` in the
 *              bootstrap; tests pass a bespoke record.
 * @returns the validated options object to pass to `app.register(cors, ...)`.
 * @throws `Error` when `NODE_ENV === 'production'` and `APP_BASE_URL`
 *         is missing / malformed, or when a `CORS_ORIGIN_ALLOWLIST`
 *         entry is malformed. Fail-fast at boot beats silent wildcard.
 */
export function resolveCorsOptions(env: CorsEnv): ResolvedCorsOptions {
  if (env.NODE_ENV !== 'production') {
    return { origin: true, credentials: true };
  }
  const appBaseUrl = env.APP_BASE_URL;
  if (typeof appBaseUrl !== 'string' || appBaseUrl.length === 0) {
    throw new Error(
      'CORS lockdown: APP_BASE_URL must be set in production (NODE_ENV=production); refusing to register a wildcard CORS allowlist.',
    );
  }
  let baseOrigin: string;
  try {
    baseOrigin = new URL(appBaseUrl).origin;
  } catch {
    throw new Error(
      `CORS lockdown: APP_BASE_URL is not a valid URL ("${appBaseUrl}"); refusing to register a wildcard CORS allowlist.`,
    );
  }
  const origins: string[] = [baseOrigin];
  const rawAllowlist = env.CORS_ORIGIN_ALLOWLIST;
  if (typeof rawAllowlist === 'string' && rawAllowlist.length > 0) {
    for (const entry of rawAllowlist.split(',')) {
      const trimmed = entry.trim();
      if (trimmed.length === 0) continue;
      let parsed: string;
      try {
        parsed = new URL(trimmed).origin;
      } catch {
        throw new Error(
          `CORS lockdown: CORS_ORIGIN_ALLOWLIST entry "${trimmed}" is not a valid URL.`,
        );
      }
      if (!origins.includes(parsed)) {
        origins.push(parsed);
      }
    }
  }
  return { origin: origins, credentials: true };
}

/**
 * Build a configured `FastifyInstance`. Does NOT call `.listen(...)` —
 * the caller decides whether to bind a port (real server) or use
 * `.inject(...)` (tests).
 *
 * @param options - optional Fastify server options. Defaults pick a
 *                  pino logger at `info` level outside `NODE_ENV=test`
 *                  and silence the logger under test.
 * @returns the configured instance.
 */
export async function createServer(options: CreateServerOptions = {}): Promise<FastifyInstance> {
  // Per-environment logger config — owned by request_logging. Three
  // modes (test=silent, prod=structured JSON, dev=pino-pretty). The
  // helper reads `NODE_ENV` and `LOG_LEVEL` off the env passed in;
  // see apps/server/src/logger.ts for the full per-mode contract.
  const defaultLogger = createLoggerOptions(process.env);

  const app = Fastify({
    logger: defaultLogger,
    // Explicit HTTP body-size ceiling — closes
    // `docs/security/m3-review/inputs.md` F-002. Fastify's documented
    // default is 1 MiB; we drop to 64 KiB (see
    // `DEFAULT_BODY_LIMIT_BYTES`) which is 6–8× headroom over the
    // largest body shape this server accepts (the session-create
    // `topic` capped at 256 chars; every other body is a few hundred
    // bytes of structured fields). Bodies over the limit produce a
    // canonical `413 Payload Too Large` response (Fastify's
    // `FST_ERR_CTP_BODY_TOO_LARGE` → the error-handler's
    // `http-error-413` envelope). The value is env-overridable via
    // `BODY_LIMIT_BYTES` so production can tune without a code
    // change. Refinement:
    //   tasks/refinements/backend-hardening/fastify_body_limit.md.
    bodyLimit: resolveBodyLimit(process.env),
    // Reflect the inbound `x-request-id` header (if any) into
    // `req.id`; otherwise Fastify generates a fresh id. The header
    // value Fastify reads is configurable; the default is
    // `'request-id'`, but the de facto convention is
    // `'x-request-id'` — pin it explicitly so tracing-aware
    // clients / load-balancers can carry an id end-to-end. The same
    // id is echoed back on the response via the `onRequest` hook
    // below. Refinement:
    // tasks/refinements/backend/request_logging.md.
    requestIdHeader: 'x-request-id',
    // The label Pino's request serializer uses for the id field in
    // every log line. Defaults to `'reqId'`; pin explicitly so logs
    // and the response header use parallel vocabulary
    // (`x-request-id` on the wire, `reqId` in the structured log).
    requestIdLogLabel: 'reqId',
    ...options,
  });

  // Reflect the request id on every response as `x-request-id` so
  // clients (and downstream load balancers / log aggregators) can
  // correlate a response back to its server-side log lines. The
  // hook is registered as `onRequest` (the earliest lifecycle hook)
  // rather than `onSend` or `onResponse` because:
  //
  //   - `onRequest` fires before any handler runs, so the header is
  //     queued on the reply early — guaranteed to appear on the
  //     final response regardless of whether the route succeeds,
  //     throws (error handler path), or 404s (not-found path).
  //   - `onSend` would also work but runs per response payload,
  //     after the route returns; the earlier we register the header,
  //     the smaller the surface for a handler to accidentally drop
  //     it.
  //   - `onResponse` runs AFTER headers are flushed to the socket,
  //     so `reply.header(...)` there is a no-op (the header buffer
  //     has already been written).
  //
  // The id source is `request.id`, which Fastify sets to the inbound
  // `x-request-id` header (per `requestIdHeader` above) if present,
  // or to a freshly generated id otherwise. `String(...)` is
  // defensive — `req.id` is typed `string | number` upstream (the
  // default generator emits a monotonic number; the inbound-header
  // path emits a string).
  app.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', String(request.id));
    done();
  });

  // `@fastify/sensible` first — its `httpErrors` decoration is what
  // the eventual error_handling sibling builds on, and registering it
  // early means any subsequent plugin can use the helpers.
  await app.register(sensible);

  // CORS — dev keeps `origin: true` (reflect any) so localhost dev
  // with arbitrary preview origins and the `localhost` vs `127.0.0.1`
  // cross-talk both work without per-developer env tweaks. Production
  // narrows the allowlist to `APP_BASE_URL`'s origin (plus any
  // `CORS_ORIGIN_ALLOWLIST` extras) so a malicious cross-origin site
  // cannot cause the browser to send `Access-Control-Allow-Origin:
  // <attacker>` back with `credentials: true`. Closes
  // `docs/security/m3-review/auth.md` F-003. Refinement:
  // tasks/refinements/backend-hardening/prod_cors_lockdown.md.
  await app.register(cors, resolveCorsOptions(process.env));

  // Centralized error handling + 404 — wires `setErrorHandler` and
  // `setNotFoundHandler` on the root scope (via `fastify-plugin`'s
  // skip-override, so the handlers are NOT encapsulated to the
  // registration's child scope). Must register BEFORE any route plugin
  // so errors thrown from a route handler hit our handler rather than
  // Fastify's default serializer. Refinement:
  // tasks/refinements/backend/error_handling.md.
  await app.register(errorHandlerPlugin);

  // Global per-IP rate limiter — closes the CodeQL
  // `js/missing-rate-limiting` gap surfaced on every route handler in
  // `auth/routes.ts` and `sessions/routes.ts` (GitHub code-scanning
  // alerts #2–#9). Registered AFTER `errorHandlerPlugin` so the
  // `errorResponseBuilder` below can throw `ApiError(429, ...)` and
  // have the canonical envelope handler serialize it; registered
  // BEFORE every route plugin so the plugin's `onRequest` hook is
  // attached to the root scope and applies to every subsequently
  // registered route by default.
  //
  // Key (default `request.ip`) + max (`DEFAULT_RATE_LIMIT_MAX`) +
  // timeWindow (`DEFAULT_RATE_LIMIT_TIME_WINDOW_MS`) are intentionally
  // generous — the in-process layer is the framework-boundary guard
  // that the code-scanning rule recognises; deployments that need a
  // tighter ceiling should tune the env vars or front the server with
  // an edge LB / WAF. The `/healthz` path is allow-listed so
  // compose / k8s liveness probes never get throttled (a probe storm
  // counts against the same per-IP bucket otherwise, and a `429` on
  // `/healthz` reads as a service outage to the orchestrator).
  //
  // The `errorResponseBuilder` rethrows as `ApiError(429,
  // 'rate-limited', ...)` so the response body follows the project's
  // canonical `{ error: { code, message } }` envelope. The plugin
  // still emits its own informative `retry-after` + `x-ratelimit-*`
  // response headers — those layer on top of the envelope without
  // colliding with the body shape.
  //
  // Refinement:
  //   tasks/refinements/backend-hardening/missing_rate_limiting.md.
  await app.register(rateLimit, {
    max: resolveRateLimitMax(process.env),
    timeWindow: resolveRateLimitTimeWindowMs(process.env),
    // `allowList` accepts either an array of literal IPs OR a
    // predicate `(req, key) => boolean`. Path-level allow-listing
    // needs the predicate form — the array form compares against the
    // resolved key (default `request.ip`), not the URL. Skipping
    // `/healthz` keeps compose / k8s liveness probes free; a probe
    // storm at the same per-IP bucket would otherwise read as a
    // service outage to the orchestrator.
    allowList: (request) => request.url === '/healthz',
    errorResponseBuilder: (_request, context) => {
      throw new ApiError(
        429,
        'rate-limited',
        `rate limit exceeded; retry after ${String(context.after)}`,
      );
    },
  });

  // OpenAPI generator + Swagger UI. Registered BEFORE the route
  // plugins so `@fastify/swagger` sees each route's `schema` block
  // at startup and includes it in the generated document. The plugin
  // is `fastify-plugin`-wrapped (skip-override) so it attaches to the
  // root scope and observes subsequent registrations regardless of
  // which encapsulation child they live in. Refinement:
  // tasks/refinements/backend/openapi_or_equivalent.md.
  await app.register(openapiPlugin);

  // The previous `GET /` bootstrap smoke route (returning
  // `{ status: 'ok' }`) was removed in
  // `backend.api_skeleton.serve_static_frontends`. Today `/` is owned
  // by the moderator SPA — the `staticFrontendsPlugin` registered
  // LAST in this factory mounts the moderator's `dist/` at the root
  // and serves `index.html` there. The human-facing liveness smoke
  // (`curl http://localhost:3000/healthz`) and the compose
  // healthcheck both target `/healthz`, which remains a JSON route.

  // `/healthz` lives in its own plugin so the route's full context —
  // semantics (liveness-only, not readiness), refinement link, sibling
  // ownership — stays in one file. See routes/healthz.ts.
  await app.register(healthzPlugin);

  // Auth middleware — decorates the instance with `app.authenticate`
  // and the request with `authUser`. Registered BEFORE the auth-routes
  // plugin so `/api/auth/me`'s `preHandler: app.authenticate` resolves
  // at route-registration time. The plugin lazily reaches for the DB
  // pool + session-token secret on the first authenticated request;
  // unauthenticated smoke tests of the bootstrap don't pay the cost.
  // Refinement: tasks/refinements/backend/auth_middleware.md.
  await app.register(authenticatePlugin);

  // OIDC handshake routes (`GET /api/auth/login` + `GET /api/auth/callback`).
  // Owned by `backend.auth.oauth_callback_handler`. The plugin reads
  // `OIDC_*` env vars at registration time; when those env vars are
  // not set (the common case for `createServer({ logger: false })`
  // smoke tests of the bootstrap), the plugin is silently skipped so
  // tests that don't care about auth don't have to mock env. A
  // production server with a real `.env` registers the routes; an
  // OIDC-less test does not. Refinement:
  // tasks/refinements/backend/oauth_callback_handler.md.
  //
  // The route literals inside `auth/routes.ts` carry the `/api/*`
  // prefix directly — `authRoutesPlugin` is `fastify-plugin`-wrapped
  // (skip-override), so a `register(..., { prefix: '/api' })` call
  // here would be ignored by Fastify (skip-override plugins attach to
  // the parent scope and the parent's prefix context does not apply).
  // Refinement:
  //   tasks/refinements/backend/serve_static_frontends_path_collision_fix.md.
  try {
    const oidcConfig = loadOidcConfig(process.env);
    // Wire the WS-revocation hook into the logout path. When `POST
    // /api/auth/logout` verifies a cookie + commits a denylist row,
    // the hook closes every open WebSocket connection owned by the
    // logging-out user (close code 4401 / reason `auth-revoked`).
    // The static import edge `auth/ → ws/` here is acceptable because
    // `server.ts` is the composition root that already imports both.
    // Refinement: tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md.
    await app.register(authRoutesPlugin, {
      oidcConfig,
      closeUserConnectionsHook: closeUserConnections,
    });
    // Lazily arm the denylist sweeper against the default pool. The
    // sweeper is `.unref()`'d so graceful shutdown is not blocked;
    // calling `getDefaultDenylistSweeper` here binds the singleton to
    // the production pool. A test build that never authenticates
    // doesn't reach here (the OIDC config load throws, the catch
    // branch warns) — same posture as the routes registration.
    // Wrapped in a try/catch so a `DATABASE_URL`-less boot (where
    // `getDefaultPool` throws) doesn't tear down the server — the
    // sweeper is hygiene, not a correctness invariant.
    // Refinement: tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md.
    try {
      getDefaultDenylistSweeper(getDefaultPool());
    } catch (sweeperErr) {
      app.log.warn(
        { err: sweeperErr },
        'auth_token_denylist sweeper not armed (DATABASE_URL unset?). Logout will still write denylist rows when DATABASE_URL is configured; the sweeper just cleans expired rows on a 60-minute cadence.',
      );
    }
  } catch (err) {
    if (err instanceof OidcConfigError) {
      app.log.warn(
        { issues: err.issues },
        'OIDC env vars not set or invalid — /auth/login and /auth/callback are NOT registered. Set OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and APP_BASE_URL to enable the auth surface.',
      );
    } else {
      throw err;
    }
  }

  // Session-management routes (`POST /api/sessions` today;
  // `GET /api/sessions`, `GET /api/sessions/:id`,
  // `POST /api/sessions/:id/end`, the privacy-toggle endpoint, and
  // participant assignment as siblings land). Registered AFTER the
  // auth middleware so the route's `preHandler: app.authenticate`
  // resolves the decorator at route-registration time. The plugin
  // lazily reaches for the DB pool on the first authenticated request;
  // smoke tests of the bootstrap that never POST /api/sessions don't
  // pay the cost. Refinement:
  // tasks/refinements/backend/create_session_endpoint.md.
  //
  // The route literals inside `sessions/routes.ts` carry the `/api/*`
  // prefix directly (same reason as `authRoutesPlugin` above —
  // `sessionsRoutesPlugin` is `fastify-plugin`-wrapped so a
  // `prefix` option would be ignored). Refinement:
  //   tasks/refinements/backend/serve_static_frontends_path_collision_fix.md.
  await app.register(sessionsRoutesPlugin);

  // Replay-family routes (`GET /api/sessions/:id/events` today; the
  // sibling `get_at_position`, `list_snapshots`, `get_snapshot`
  // endpoints land in the same `.tji` block). Registered AFTER the auth
  // middleware so the route's `preHandler: app.authenticate` resolves
  // the decorator at registration time, and AFTER the sessions plugin so
  // both share the auth surface. The plugin lazily reaches for the DB
  // pool on the first authenticated request. Like the sessions plugin,
  // it is `fastify-plugin`-wrapped, so the `/api/*` prefix lives in the
  // route literals rather than a `prefix` option. Refinement:
  //   tasks/refinements/backend/get_session_log.md.
  await app.register(replayRoutesPlugin);

  // Test-mode synthetic-session generator (`GET /api/test-mode/
  // synthetic-scenarios`, `POST /api/test-mode/synthetic-sessions`).
  // Registered ONLY when `NODE_ENV !== 'production'` — in production the
  // routes never mount and 404. The env gate is the single enforcement
  // of the participant-authorization bypass synthetic generation
  // inherently requires (the same gate the CORS lockdown uses). The
  // plugin registers AFTER the auth middleware so its routes'
  // `preHandler: app.authenticate` resolves the decorator, and reaches
  // for the DB pool lazily on the first generate request. Refinement:
  //   tasks/refinements/replay_test/test_mode_synthetic_session.md.
  // ADR: docs/adr/0041-synthetic-session-generation-dev-gated-seam.md.
  await registerTestModeRoutes(app);

  // WebSocket connection lifecycle. Registers `@fastify/websocket`
  // (decorating `app.websocketServer` + `app.injectWS`) and a single
  // `GET /ws` route that upgrades to WS, mints a per-connection
  // `connectionId`, logs open/close, sends a placeholder hello
  // envelope, and arranges a 1001 going-away close on app shutdown.
  // Auth gating, subscription routing, the canonical message envelope,
  // message types, and broadcasts are each separate downstream
  // websocket_protocol tasks that build on this foundation. Refinement:
  // tasks/refinements/backend/ws_connection_handling.md.
  //
  // The `originAllowlist` option threads the env-resolved allowlist
  // into the WS preValidation gate (per
  // tasks/refinements/backend-hardening/ws_origin_allowlist.md). The
  // resolver fail-fasts at boot when production env vars are
  // missing/malformed (same posture as `loadOidcConfig`); a dev start
  // gets the `'*'` sentinel and the gate accepts every origin.
  const wsOriginAllowlist = resolveWsOriginAllowlist(process.env);
  await app.register(wsConnectionHandlingPlugin, { originAllowlist: wsOriginAllowlist });

  // WS message-type handlers (subscribe / unsubscribe today; more
  // land as `ws_propose_message`, `ws_vote_message`, etc. ship).
  // Registered AFTER `wsConnectionHandlingPlugin` because the
  // handlers plugin reaches for the dispatcher + subscription
  // registry that plugin decorates. Refinement:
  // tasks/refinements/backend/ws_subscribe_to_session.md.
  await app.register(wsHandlersPlugin);

  // WS diagnostic broadcast surface. Bridges the projection-layer
  // `DiagnosticBus` to the WS fan-out: decorates `app.diagnosticBus`
  // + `app.wsDiagnosticBroadcast` (the session-context-aware
  // wrapper) and binds `fired` / `cleared` listeners that fan out a
  // `diagnostic` envelope to every connection subscribed to the
  // diagnostic's session. Registered AFTER `wsConnectionHandlingPlugin`
  // (so `app.wsConnectionSenders` + `app.wsSubscriptions` are
  // available) and AFTER the event-applied broadcast plugin (so the
  // listener-registration order matches the natural broadcast
  // ordering: `event-applied(N)` before any `diagnostic` derived
  // from the post-N projection). Refinement:
  // tasks/refinements/backend/ws_diagnostic_broadcast.md.
  await app.register(wsDiagnosticBroadcastPlugin);

  // WS proposal-status broadcast surface. Listens on `app.wsBroadcast`
  // for the four status-affecting event kinds (propose / vote /
  // commit / meta-disagreement-marked); on each, loads the session's
  // event log up to the triggering sequence, builds a fresh
  // projection, derives the per-facet status via `deriveFacetStatus`,
  // and fans out a `proposal-status` envelope to every connection
  // subscribed to the session. Registered AFTER
  // `wsConnectionHandlingPlugin` (so `app.wsBroadcast` /
  // `app.wsConnectionSenders` / `app.wsSubscriptions` are available)
  // and AFTER the event-applied broadcast plugin registered inside
  // it — that registration order is what makes the bus's synchronous
  // dispatch deliver `event-applied` first and `proposal-status`
  // second on every emit. Refinement:
  // tasks/refinements/backend/ws_proposal_status_broadcast.md.
  await app.register(wsProposalStatusBroadcastPlugin);

  // Static-frontends plugin — serves the root app at `/` plus the
  // surface bundles under `/_surfaces/*` from the same Fastify process
  // as the JSON API. Single-origin deployment per ADR 0026.
  //
  // **Registered LAST on purpose.** Fastify matches routes in
  // registration order; the wildcard static handler would shadow API
  // surfaces if it ran first. Putting it last guarantees `/healthz`,
  // `/auth/*`, `/sessions/*`, `/ws`, `/docs`, and every future API
  // route take precedence — the static handler only sees requests
  // they didn't claim.
  //
  // The plugin also installs an SPA-aware `setNotFoundHandler` that
  // overrides the canonical one from `errorHandlerPlugin`: HTML
  // requests for unknown paths get the root app's `index.html` (so the
  // host router can render the route client-side); JSON / curl
  // clients still get the canonical `{ error: { code: 'not-found',
  // message: 'Route not found' } }` envelope.
  //
  // Fail-fast at boot: a missing or unreadable `dist/` (or its
  // `index.html`) throws here, BEFORE `app.listen(...)`. The runtime
  // image copies both `apps/root/dist` and `apps/moderator/dist` into
  // the container; a stripped image without either produces a clear
  // startup error rather than 404s on every HTML request.
  //
  // Refinement: tasks/refinements/backend/serve_static_frontends.md.
  await app.register(staticFrontendsPlugin);

  return app;
}
