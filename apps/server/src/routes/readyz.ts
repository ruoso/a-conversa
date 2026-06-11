// Fastify plugin registering `GET /readyz` — the readiness probe.
//
// Refinement: tasks/refinements/deployment/health_and_readiness_endpoints.md
// ADRs:        docs/adr/0033-production-observability-railway-sentry.md,
//              docs/adr/0020-migrations-node-pg-migrate-forward-only.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: deployment.observability.health_and_readiness_endpoints
//
// **Semantics: readiness, layered on top of liveness.** `/healthz`
// (routes/healthz.ts) stays a pure liveness probe — "the process is
// alive." `/readyz` answers the stricter question Railway's deploy
// machinery and the external uptime monitor ask: "is this instance
// able to do real work?" Two checks, per ADR 0033:
//
//   - **db** — `SELECT 1` through the pool, with a short timeout so
//     a hung pool turns into a fast 503 rather than a hanging probe.
//   - **migrations** — the startup migration gate's recorded outcome
//     (see readiness.ts). The gate is a boot-time fact; the probe
//     reads the recorded state instead of re-deriving it per probe.
//
// Failing either check flips the response to 503. The body keeps the
// same `{ status, version, checks }` shape on both 200 and 503 so
// probes and humans read one contract; the 503 is the endpoint's
// *successful* report of an unready state, not an error, so it does
// NOT use the canonical `{ error: { code, message } }` envelope
// (unexpected faults inside the handler still surface as enveloped
// 5xx via the global error handler).
//
// **Consumers.** Railway's service healthcheck switches from
// `/healthz` to `/readyz` (operator step in
// tasks/refinements/deployment/prod_railway_app_service.md); the
// external uptime monitor (`observability.uptime_monitoring`)
// targets it too. The compose dev healthcheck deliberately stays on
// `/healthz` — liveness controls restarts, and a transient DB blip
// must not restart the app container.

import type { FastifyPluginAsync } from 'fastify';

import { getDefaultPool, type DbPool } from '../db.js';
import { isMigrationGateReady } from '../readiness.js';
import { resolveServerVersion } from '../version.js';

/**
 * How long the `SELECT 1` ping may take before the db check is
 * declared failed. Far above a healthy in-VPC round trip, far below
 * any probe interval. A constant, not an env var — same stance as
 * the rate-limit defaults: tune it when a real deployment proves it
 * wrong, not before.
 */
export const READYZ_DB_PING_TIMEOUT_MS = 2_000;

/** Per-check outcome in the `/readyz` response body. */
export type ReadyzCheck = 'ok' | 'failed';

/**
 * Response shape for `GET /readyz` — identical on 200 and 503 except
 * for the `status` discriminant, so a human curling the probe sees
 * which check failed without a second request.
 */
export interface ReadyzResponse {
  /** `'ready'` on 200, `'unavailable'` on 503. */
  readonly status: 'ready' | 'unavailable';
  /** Same build stamp as `/healthz` (resolveServerVersion). */
  readonly version: string;
  readonly checks: {
    /** Postgres reachability (`SELECT 1` with timeout). */
    readonly db: ReadyzCheck;
    /** Startup migration gate outcome (see readiness.ts). */
    readonly migrations: ReadyzCheck;
  };
}

/**
 * Options for the plugin. The `pool` seam matches the established
 * DB-touching-plugin pattern (see db.ts): production registration
 * passes nothing and the handler lazily reaches for
 * `getDefaultPool()` per probe; tests inject a mock / pglite-backed
 * pool.
 */
export interface ReadyzPluginOptions {
  readonly pool?: DbPool;
}

const readyzResponseSchema = {
  type: 'object',
  required: ['status', 'version', 'checks'],
  additionalProperties: false,
  properties: {
    status: {
      type: 'string',
      enum: ['ready', 'unavailable'],
      description: '"ready" when both checks pass (200); "unavailable" otherwise (503).',
    },
    version: {
      type: 'string',
      description: "The server's package.json version (or '0.0.0' fallback).",
    },
    checks: {
      type: 'object',
      required: ['db', 'migrations'],
      additionalProperties: false,
      properties: {
        db: {
          type: 'string',
          enum: ['ok', 'failed'],
          description: 'Postgres reachability (SELECT 1 with a 2s timeout).',
        },
        migrations: {
          type: 'string',
          enum: ['ok', 'failed'],
          description:
            'Startup migration gate outcome: completed (or explicitly skipped by the operator) = ok.',
        },
      },
    },
  },
} as const;

/**
 * Run the `SELECT 1` ping against the pool, racing a timeout. Any
 * outcome other than a timely successful query — including a
 * throwing `getDefaultPool()` when `DATABASE_URL` is unset — is a
 * failed check, never a 500: an unreachable database is exactly the
 * condition this probe exists to report.
 */
async function pingDatabase(resolvePool: () => DbPool): Promise<ReadyzCheck> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const pool = resolvePool();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`db ping exceeded ${String(READYZ_DB_PING_TIMEOUT_MS)}ms`));
      }, READYZ_DB_PING_TIMEOUT_MS);
    });
    await Promise.race([pool.query('SELECT 1'), timeout]);
    return 'ok';
  } catch {
    return 'failed';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Fastify plugin that registers `GET /readyz`. Encapsulated as a
 * plugin for the same reason as `healthzPlugin`: the route's full
 * context — semantics, refinement link, consumer list — lives in one
 * file.
 */
export const readyzPlugin: FastifyPluginAsync<ReadyzPluginOptions> = (app, opts) => {
  const resolvePool = (): DbPool => opts.pool ?? getDefaultPool();

  app.get(
    '/readyz',
    {
      schema: {
        tags: ['meta'],
        summary: 'Readiness probe',
        description:
          'Returns 200 when the database is reachable AND the startup migration gate ' +
          'completed (or was explicitly skipped by the operator); 503 otherwise, with ' +
          'per-check detail. Railway uses this as the deploy-health gate per ADR 0033; ' +
          '/healthz remains the pure liveness probe.',
        response: {
          200: readyzResponseSchema,
          503: readyzResponseSchema,
        },
      },
    },
    async (_request, reply): Promise<ReadyzResponse> => {
      const db = await pingDatabase(resolvePool);
      const migrations: ReadyzCheck = isMigrationGateReady() ? 'ok' : 'failed';
      const ready = db === 'ok' && migrations === 'ok';

      const body: ReadyzResponse = {
        status: ready ? 'ready' : 'unavailable',
        version: resolveServerVersion(),
        checks: { db, migrations },
      };
      return reply.code(ready ? 200 : 503).send(body);
    },
  );

  return Promise.resolve();
};
