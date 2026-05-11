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
//     tightening lives with `deployment.prod_container`.
//   - `errorHandlerPlugin` — centralized `setErrorHandler` +
//     `setNotFoundHandler`, serialising every error response under the
//     canonical `{ error: { code, message, ...detail } }` envelope.
//     Owned by `backend.api_skeleton.error_handling`. Registered after
//     sensible+cors but BEFORE the route plugins so route-thrown errors
//     reach the handler instead of Fastify's default serializer.
//
// **Plugins explicitly deferred** to their owning tasks (so this
// bootstrap doesn't pre-empt them):
//   - `@fastify/websocket` → `backend.websocket_protocol.ws_connection_handling`.
//   - `@fastify/swagger` + `swagger-ui` → `backend.api_skeleton.openapi_or_equivalent`.
//   - `@fastify/helmet` → later security-headers pass.
//   - A schema type provider (Zod or TypeBox) → first route that
//     actually validates a request body.
//
// **Routes** wired today:
//   - `GET /` — trivial proof-of-bootstrap, returns `{ status: 'ok' }`.
//   - `GET /healthz` — liveness probe (registered via the
//     `healthzPlugin`); the compose `app` service healthcheck targets
//     this route. Owned by `backend.api_skeleton.health_endpoint`.
//
// Sibling tasks register their routes on the instance returned here.

import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import {
  authenticatePlugin,
  authRoutesPlugin,
  loadOidcConfig,
  OidcConfigError,
} from './auth/index.js';
import { errorHandlerPlugin } from './error-handler.js';
import { createLoggerOptions } from './logger.js';
import { errorEnvelopeRef, openapiPlugin } from './openapi.js';
import { healthzPlugin } from './routes/healthz.js';
import { sessionsRoutesPlugin } from './sessions/routes.js';

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

  // Permissive CORS for dev / compose; production locks this down via
  // `deployment.prod_container`. `origin: true` reflects the request
  // origin, which is appropriate for a same-origin dev story plus
  // localhost-vs-127.0.0.1 cross-talk that the browser treats as
  // cross-origin.
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // Centralized error handling + 404 — wires `setErrorHandler` and
  // `setNotFoundHandler` on the root scope (via `fastify-plugin`'s
  // skip-override, so the handlers are NOT encapsulated to the
  // registration's child scope). Must register BEFORE any route plugin
  // so errors thrown from a route handler hit our handler rather than
  // Fastify's default serializer. Refinement:
  // tasks/refinements/backend/error_handling.md.
  await app.register(errorHandlerPlugin);

  // OpenAPI generator + Swagger UI. Registered BEFORE the route
  // plugins so `@fastify/swagger` sees each route's `schema` block
  // at startup and includes it in the generated document. The plugin
  // is `fastify-plugin`-wrapped (skip-override) so it attaches to the
  // root scope and observes subsequent registrations regardless of
  // which encapsulation child they live in. Refinement:
  // tasks/refinements/backend/openapi_or_equivalent.md.
  await app.register(openapiPlugin);

  // Trivial proof-of-bootstrap route. `/` is the human-facing smoke
  // (`curl http://localhost:3000/`); `/healthz` (below) is the
  // compose-healthcheck-facing liveness probe. The `schema` block
  // documents the response under the `meta` tag so the generated
  // OpenAPI captures it alongside `/healthz`. The handler is
  // intentionally sync (no `async`) — there's nothing to await and the
  // lint rule `@typescript-eslint/require-await` catches gratuitous
  // `async`.
  app.get(
    '/',
    {
      schema: {
        tags: ['meta'],
        summary: 'Bootstrap smoke route',
        description:
          'Returns `{ status: "ok" }`. Not a real healthcheck — use `/healthz` for ' +
          'liveness. This route exists for human-facing smoke (`curl http://localhost:3000/`) ' +
          'against a running stack.',
        response: {
          200: {
            type: 'object',
            required: ['status'],
            additionalProperties: false,
            properties: {
              status: { type: 'string', enum: ['ok'] },
            },
          },
          '5xx': errorEnvelopeRef,
        },
      },
    },
    () => ({ status: 'ok' }),
  );

  // `/healthz` lives in its own plugin so the route's full context —
  // semantics (liveness-only, not readiness), refinement link, sibling
  // ownership — stays in one file. See routes/healthz.ts.
  await app.register(healthzPlugin);

  // Auth middleware — decorates the instance with `app.authenticate`
  // and the request with `authUser`. Registered BEFORE the auth-routes
  // plugin so `/auth/me`'s `preHandler: app.authenticate` resolves at
  // route-registration time. The plugin lazily reaches for the DB
  // pool + session-token secret on the first authenticated request;
  // unauthenticated smoke tests of the bootstrap don't pay the cost.
  // Refinement: tasks/refinements/backend/auth_middleware.md.
  await app.register(authenticatePlugin);

  // OIDC handshake routes (`GET /auth/login` + `GET /auth/callback`).
  // Owned by `backend.auth.oauth_callback_handler`. The plugin reads
  // `OIDC_*` env vars at registration time; when those env vars are
  // not set (the common case for `createServer({ logger: false })`
  // smoke tests of the bootstrap), the plugin is silently skipped so
  // tests that don't care about auth don't have to mock env. A
  // production server with a real `.env` registers the routes; an
  // OIDC-less test does not. Refinement:
  // tasks/refinements/backend/oauth_callback_handler.md.
  try {
    const oidcConfig = loadOidcConfig(process.env);
    await app.register(authRoutesPlugin, { oidcConfig });
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

  // Session-management routes (`POST /sessions` today; `GET /sessions`,
  // `GET /sessions/:id`, `POST /sessions/:id/end`, the privacy-toggle
  // endpoint, and participant assignment as siblings land). Registered
  // AFTER the auth middleware so the route's
  // `preHandler: app.authenticate` resolves the decorator at
  // route-registration time. The plugin lazily reaches for the DB pool
  // on the first authenticated request; smoke tests of the bootstrap
  // that never POST /sessions don't pay the cost. Refinement:
  // tasks/refinements/backend/create_session_endpoint.md.
  await app.register(sessionsRoutesPlugin);

  return app;
}
