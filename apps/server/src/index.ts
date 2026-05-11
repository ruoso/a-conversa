// `@a-conversa/server` entry point — invoked by the runtime image's
// `CMD ["node", "/app/apps/server/dist/index.js"]` (per ADR 0015's
// Amendment) and by `pnpm --filter @a-conversa/server start` locally.
//
// Refinement: tasks/refinements/backend/http_server.md
// ADRs:        docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.api_skeleton.http_server
//
// Responsibilities, in order:
//   1. Build the Fastify instance via `createServer()`.
//   2. Bind the configured port (`PORT` env, default 3000) on all
//      interfaces (`0.0.0.0` — required so the compose `app` service
//      is reachable from outside the container).
//   3. Hand the listening instance off to a graceful-shutdown handler
//      that catches SIGINT / SIGTERM and `.close()`s the server.
//
// **What this file deliberately does not do** (each is a sibling task):
//   - Apply pending migrations on startup. Migrations are applied via
//     `make migrate` against the running postgres; the
//     migrations-on-startup hook is owned by the eventual
//     `backend.api_skeleton.health_endpoint`-aware sibling once
//     `node-pg-migrate`'s in-process API is wired here.
//   - Register WebSocket routes. That's
//     `backend.websocket_protocol.ws_connection_handling`.
//   - Read or validate any per-deployment config beyond `PORT`.
//     Config / env-loading is owned by a separate refinement once
//     more env vars are needed.

import { createServer } from './server.js';

/**
 * Read the port from the environment. Defaults to 3000 to match the
 * `EXPOSE 3000` in the Dockerfile and the `'3000:3000'` mapping in
 * `compose.yaml`. Any non-numeric value falls back to the default
 * with a warning logged AFTER the server is built (so the warning
 * goes through the Pino logger like every other diagnostic).
 */
function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 3000;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return 3000;
  }
  return parsed;
}

async function main(): Promise<void> {
  const app = await createServer();

  const port = parsePort(process.env.PORT);
  const host = process.env.HOST ?? '0.0.0.0';

  // Wire graceful shutdown BEFORE listening so a SIGTERM arriving
  // during early startup still triggers a clean close.
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info({ signal }, 'received shutdown signal; closing server');
    try {
      await app.close();
      app.log.info('server closed cleanly');
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    const address = await app.listen({ port, host });
    app.log.info({ address }, 'server listening');
  } catch (error) {
    app.log.error({ err: error }, 'failed to start server');
    process.exit(1);
  }
}

void main();
