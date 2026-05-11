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
//   - `@fastify/sensible` — typed `httpErrors` helpers so the eventual
//     `backend.api_skeleton.error_handling` sibling has a consistent
//     surface to build on (`reply.notFound()`, `reply.badRequest()`,
//     etc.).
//   - `@fastify/cors` — permissive in dev (`origin: true`); production
//     tightening lives with `deployment.prod_container`.
//
// **Plugins explicitly deferred** to their owning tasks (so this
// bootstrap doesn't pre-empt them):
//   - `@fastify/websocket` → `backend.websocket_protocol.ws_connection_handling`.
//   - `@fastify/swagger` + `swagger-ui` → `backend.api_skeleton.openapi_or_equivalent`.
//   - `@fastify/helmet` → later security-headers pass.
//   - A schema type provider (Zod or TypeBox) → first route that
//     actually validates a request body.
//
// **Routes** — exactly one trivial smoke route today:
//   - `GET /` returns `{ status: 'ok' }`.
// The real `/healthz` (with DB ping and migration-state check) is
// owned by `backend.api_skeleton.health_endpoint`. Sibling tasks
// register their routes on the instance returned here.

import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

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
  const defaultLogger: FastifyServerOptions['logger'] =
    process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' };

  const app = Fastify({
    logger: defaultLogger,
    ...options,
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

  // Trivial proof-of-bootstrap route. The proper `/healthz` (DB ping,
  // migration-state check, version stamp) is owned by
  // `backend.api_skeleton.health_endpoint` — this route is the
  // human-facing `curl /` smoke until that lands. Returning a plain
  // object lets Fastify's default JSON serializer handle the response.
  // The handler is intentionally sync (no `async`) — there's nothing
  // to await and the lint rule `@typescript-eslint/require-await`
  // catches gratuitous `async`.
  app.get('/', () => ({ status: 'ok' }));

  return app;
}
