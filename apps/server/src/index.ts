// `@a-conversa/server` entry point — invoked by the runtime image's
// `CMD ["node", "/app/apps/server/dist/index.js"]` (per ADR 0015's
// Amendment) and by `pnpm --filter @a-conversa/server start` locally.
//
// Refinement: tasks/refinements/backend/http_server.md
//             tasks/refinements/backend/health_endpoint.md (migration
//             startup gate; ADR 0020 C6 settled here)
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0020-migrations-node-pg-migrate-forward-only.md
// TaskJuggler: backend.api_skeleton.http_server (bootstrap),
//              backend.api_skeleton.health_endpoint (migration gate)
//
// Responsibilities, in order:
//   1. Build the Fastify instance via `createServer()`.
//   2. **Apply pending migrations on startup** via
//      `applyMigrationsOnStartup()`. This is the C6 gate from
//      tasks/refinements/data-and-methodology/migrations_tooling.md
//      that ADR 0020 deferred to `backend.api_skeleton`. If
//      `DATABASE_URL` is missing OR the runner fails, the process
//      aborts with a non-zero exit before binding the port. The end
//      state is either "schema is current AND server is up" or
//      "operator sees the migration error AND no port is bound."
//   3. Bind the configured port (`PORT` env, default 3000) on all
//      interfaces (`0.0.0.0` — required so the compose `app` service
//      is reachable from outside the container).
//   4. Hand the listening instance off to a graceful-shutdown handler
//      that catches SIGINT / SIGTERM and `.close()`s the server.
//
// **Skipping the migration gate.** Two escape hatches:
//   - `SKIP_STARTUP_MIGRATIONS=true` — explicit opt-out for the rare
//     cases where the operator has already applied migrations
//     out-of-band and wants to start the server against an
//     unreachable / read-replica DB. Logs a warning.
//   - `DATABASE_URL` unset — equivalent to the explicit opt-out, but
//     warns more loudly because it likely indicates a misconfigured
//     `.env`. Useful for local "just boot the HTTP layer with no DB"
//     iteration; the server will obviously fail at the first
//     DB-touching request.
//
// **What this file deliberately does not do** (each is a sibling task):
//   - Register WebSocket routes. That's
//     `backend.websocket_protocol.ws_connection_handling`.
//   - Read or validate any per-deployment config beyond `PORT`,
//     `HOST`, `DATABASE_URL`, and `SKIP_STARTUP_MIGRATIONS`.
//     Config / env-loading is owned by a separate refinement once
//     more env vars are needed.

import { applyMigrationsOnStartup, withFastifyLogger } from './migrate-startup.js';
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

/**
 * Parse boolean-ish env values for `SKIP_STARTUP_MIGRATIONS`.
 * Accepts `'true'`, `'1'`, `'yes'` (case-insensitive) as truthy;
 * anything else (including unset / empty) is falsy. Strict on
 * purpose — a typo like `SKIP_STARTUP_MIGRATIONS=ture` shouldn't
 * silently disable the gate.
 */
function parseBoolEnv(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const lower = raw.trim().toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes';
}

async function main(): Promise<void> {
  const app = await createServer();

  // --- Startup migration gate (ADR 0020 C6) ---
  //
  // The gate runs BEFORE `app.listen(...)` so the port is never
  // bound against a stale schema. Two opt-outs (see header comment):
  // explicit `SKIP_STARTUP_MIGRATIONS=true`, and missing
  // `DATABASE_URL`. Either path logs a warning and proceeds; any
  // failure inside the runner aborts the process.
  const skip = parseBoolEnv(process.env['SKIP_STARTUP_MIGRATIONS']);
  const databaseUrl = process.env['DATABASE_URL'];

  if (skip) {
    app.log.warn(
      'SKIP_STARTUP_MIGRATIONS=true — skipping migration gate; ensure schema is current out-of-band',
    );
  } else if (!databaseUrl) {
    app.log.warn(
      'DATABASE_URL is not set — skipping migration gate; the server will fail on any DB-touching request',
    );
  } else {
    try {
      await applyMigrationsOnStartup({
        databaseUrl,
        log: withFastifyLogger(app.log),
      });
    } catch (error) {
      app.log.error({ err: error }, 'startup migration gate failed; aborting');
      // `app` has not yet bound a port — close it anyway so any
      // already-allocated resources release cleanly, then exit
      // non-zero. The compose `app` service's `restart: unless-stopped`
      // policy will retry once postgres / migrations are reachable.
      await app.close();
      process.exit(1);
    }
  }

  const port = parsePort(process.env['PORT']);
  const host = process.env['HOST'] ?? '0.0.0.0';

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
