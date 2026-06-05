// Fastify plugin — the test-mode synthetic-session generator endpoints.
//
// Refinement: tasks/refinements/replay_test/test_mode_synthetic_session.md
// ADRs:        docs/adr/0041-synthetic-session-generation-dev-gated-seam.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: replay_test.test_mode.test_mode_synthetic_session
//
// Two routes, both `/api/test-mode/*`, both `preHandler: app.authenticate`:
//
//   - GET  /api/test-mode/synthetic-scenarios — lists the available
//     scenario descriptors so the gallery is data-driven.
//   - POST /api/test-mode/synthetic-sessions — mints a fresh session,
//     owns it by the caller, runs the named builder, and appends every
//     event through the production write path in one transaction;
//     returns `201 { sessionId }`.
//
// **This plugin is gated to non-production.** `createServer()` only
// registers it when `NODE_ENV !== 'production'` (see `./register.ts`).
// In production the routes never mount; requests 404. That env gate is
// the single enforcement of the participant-authorization bypass
// synthetic generation inherently requires (ADR 0041, Decision §1).
//
// **Why the production write path, not `loadFixture`.** `loadFixture`
// truncates every core table and replays fixed ids — a destructive
// test-harness primitive, unsafe at runtime. The generator instead
// mints a fresh session id + fresh entity ids and appends a validated
// log non-destructively, so the result is a real persisted session the
// existing `GET /api/sessions/:id/events` read path serves unchanged
// (Decision §2).

import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import type { Event } from '@a-conversa/shared-types';

import { ApiError } from '../errors.js';
import { errorEnvelopeRef } from '../openapi.js';
import { getDefaultPool, type DbPool } from '../db.js';
import { appendSessionEvent } from '../events/append.js';
import { validateEvent } from '../events/validate.js';
import {
  getScenarioBuilder,
  SYNTHETIC_SCENARIO_DESCRIPTORS,
  SYNTHETIC_USERS,
} from './synthetic/scenarios.js';

/**
 * Options accepted by `testModeRoutesPlugin`. Mirrors the sessions
 * plugin's shape — every field optional; production passes `{}` and the
 * plugin lazily reaches for `getDefaultPool()`. Tests inject a
 * pglite-backed adapter (Cucumber) or a memory shim (Vitest).
 */
export interface TestModeRoutesOptions {
  readonly pool?: DbPool;
}

/**
 * Minimal transaction-aware client surface — matches both `pg.PoolClient`
 * and the pglite adapter's `query`-only shape.
 */
interface DbTxClient {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: TRow[] }>;
  release?: () => void;
}

interface PoolWithConnect extends DbPool {
  connect(): Promise<DbTxClient>;
}

function hasConnect(pool: DbPool): pool is PoolWithConnect {
  return typeof (pool as { connect?: unknown }).connect === 'function';
}

/**
 * Run `fn(client)` inside a DB transaction. Same two-path shape the
 * sessions plugin uses: a dedicated `connect()`ed client for the
 * production `pg.Pool`, or BEGIN/COMMIT directly against `pool.query`
 * for the single-connection pglite adapter.
 */
async function withTransaction<T>(
  pool: DbPool,
  fn: (client: DbTxClient) => Promise<T>,
): Promise<T> {
  if (hasConnect(pool)) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // suppressed — surface the original error.
      }
      throw err;
    } finally {
      if (client.release !== undefined) {
        client.release();
      }
    }
  }
  const txClient: DbTxClient = { query: pool.query.bind(pool) };
  try {
    await txClient.query('BEGIN');
    const result = await fn(txClient);
    await txClient.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await txClient.query('ROLLBACK');
    } catch {
      // suppressed.
    }
    throw err;
  }
}

/** Stable `$id` for the scenario-list response schema. */
const SYNTHETIC_SCENARIO_LIST_RESPONSE_SCHEMA_ID = 'SyntheticScenarioListResponse';

const syntheticScenarioListResponseSchema = {
  $id: SYNTHETIC_SCENARIO_LIST_RESPONSE_SCHEMA_ID,
  type: 'object',
  required: ['scenarios'],
  additionalProperties: false,
  properties: {
    scenarios: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'title', 'description'],
        additionalProperties: false,
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
  },
} as const;

const SYNTHETIC_SESSION_RESPONSE_SCHEMA_ID = 'SyntheticSessionResponse';

const syntheticSessionResponseSchema = {
  $id: SYNTHETIC_SESSION_RESPONSE_SCHEMA_ID,
  type: 'object',
  required: ['sessionId'],
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', format: 'uuid' },
  },
} as const;

const generateSyntheticSessionBodySchema = {
  type: 'object',
  required: ['scenario'],
  additionalProperties: false,
  properties: {
    scenario: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const;

const testModeRoutesPluginAsync: FastifyPluginAsync<TestModeRoutesOptions> = (
  app: FastifyInstance,
  opts,
) => {
  if (app.getSchema(SYNTHETIC_SCENARIO_LIST_RESPONSE_SCHEMA_ID) === undefined) {
    app.addSchema(syntheticScenarioListResponseSchema);
  }
  if (app.getSchema(SYNTHETIC_SESSION_RESPONSE_SCHEMA_ID) === undefined) {
    app.addSchema(syntheticSessionResponseSchema);
  }

  // Lazy DB-pool resolution — mirrors the sessions plugin. The first
  // generate request triggers `getDefaultPool()`; the list endpoint
  // never touches the DB.
  let resolvedPool: DbPool | undefined = opts.pool;
  const ensurePool = (): DbPool => {
    if (resolvedPool !== undefined) {
      return resolvedPool;
    }
    resolvedPool = getDefaultPool();
    return resolvedPool;
  };

  app.get(
    '/api/test-mode/synthetic-scenarios',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['test-mode'],
        summary: 'List the available synthetic-session scenarios',
        description:
          'Returns the scenario descriptors the generator can build, so the ' +
          'test-mode gallery is data-driven. Non-production only — 404 in ' +
          'production where the test-mode plugin is not registered.',
        security: [{ cookieAuth: [] }],
        response: {
          200: { $ref: `${SYNTHETIC_SCENARIO_LIST_RESPONSE_SCHEMA_ID}#` },
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (_request, reply) => {
      return reply.code(200).send({ scenarios: SYNTHETIC_SCENARIO_DESCRIPTORS });
    },
  );

  app.post(
    '/api/test-mode/synthetic-sessions',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['test-mode'],
        summary: 'Generate a synthetic session from a named scenario',
        description:
          'Mints a fresh session owned by the caller, runs the named scenario ' +
          'builder, validates + appends every event through the production ' +
          'write path in one transaction, and returns `201 { sessionId }`. ' +
          'Non-production only. Returns 400 for an unknown scenario and 401 ' +
          'when unauthenticated.',
        security: [{ cookieAuth: [] }],
        body: generateSyntheticSessionBodySchema,
        response: {
          201: { $ref: `${SYNTHETIC_SESSION_RESPONSE_SCHEMA_ID}#` },
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      const auth = request.authUser;
      if (auth === undefined) {
        // Defensive — the preHandler guarantees `authUser`. A surfaced
        // 500 here means a wiring regression.
        throw new ApiError(
          500,
          'internal-error',
          'auth middleware did not populate request.authUser',
        );
      }
      const hostUserId = auth.id;

      const body = request.body as { scenario: string };
      const build = getScenarioBuilder(body.scenario);
      if (build === undefined) {
        throw new ApiError(
          400,
          'validation-failed',
          `unknown synthetic scenario '${body.scenario}'`,
        );
      }

      const sessionId = randomUUID();

      await withTransaction(ensurePool(), async (client) => {
        // 1. Insert the session row owned by the operator. Explicit id
        //    so the builder's events (which already carry `sessionId`)
        //    line up; privacy `private` keeps a synthetic session out of
        //    the public cross-session-reference surface while staying
        //    visible to its host via `canSeeSession`.
        await client.query(
          `INSERT INTO sessions (id, host_user_id, privacy, topic)
           VALUES ($1, $2, 'private', $3)`,
          [sessionId, hostUserId, 'Synthetic session (test mode)'],
        );

        // 2. Ensure the stable synthetic debater users exist so the
        //    events' `actor` FK into `users(id)` resolves. ON CONFLICT
        //    DO NOTHING under fixed ids — this generator is the only
        //    writer of the `synthetic:` oauth-subject namespace, so the
        //    id never drifts (Decision §3).
        for (const u of SYNTHETIC_USERS) {
          await client.query(
            `INSERT INTO users (id, oauth_subject, screen_name)
             VALUES ($1, $2, $3)
             ON CONFLICT (oauth_subject) DO NOTHING`,
            [u.id, u.oauthSubject, u.screenName],
          );
        }

        // 3. Build the scenario log and append every event through the
        //    production write path: `validateEvent` (schema-on-write,
        //    ADR 0021) then `appendSessionEvent` (the single INSERT
        //    surface). The builder allocates ascending sequences from 1.
        const events: Event[] = build(sessionId, hostUserId, randomUUID);
        for (const event of events) {
          validateEvent(event);
          await appendSessionEvent(client, event);
        }
      });

      return reply.code(201).send({ sessionId });
    },
  );

  // FastifyPluginAsync demands a Promise return; the registration
  // itself is sync (the route handlers attach synchronously). Wrapping
  // in `Promise.resolve` keeps the plugin-async contract without a
  // gratuitous `async` keyword that would trigger
  // `@typescript-eslint/require-await`.
  return Promise.resolve();
};

/**
 * The wrapped plugin. `fastify-plugin` adds `skip-override` so the
 * routes attach to the parent scope (where `app.authenticate` is
 * decorated) rather than the plugin's encapsulation child.
 */
export const testModeRoutesPlugin = fp(testModeRoutesPluginAsync, {
  name: 'a-conversa-test-mode-routes',
  fastify: '5.x',
});

/**
 * Test-only convenience — build a minimal Fastify instance with the
 * error-envelope schema, the error-handler plugin, the auth middleware,
 * and the test-mode-routes plugin all wired. Mirrors
 * `__buildTestSessionsApp`. Hides the `fastify` import behind the
 * workspace boundary so the behaviour-test tsconfig can build the app
 * without resolving `fastify` directly.
 *
 * Production code does NOT use this helper — `createServer()` wires the
 * full stack behind the `NODE_ENV !== 'production'` gate.
 */
export async function __buildTestTestModeApp(options: {
  pool?: DbPool;
  sessionTokenSecret?: string;
}): Promise<import('fastify').FastifyInstance> {
  const { default: fastifyFactory } = await import('fastify');
  const { errorHandlerPlugin } = await import('../error-handler.js');
  const { errorEnvelopeSchema } = await import('../openapi.js');
  const { authenticatePlugin } = await import('../auth/middleware.js');
  const app = fastifyFactory({ logger: false });
  app.addSchema(errorEnvelopeSchema);
  await app.register(errorHandlerPlugin);
  const middlewareOpts: Parameters<typeof authenticatePlugin>[1] = {
    ...(options.pool !== undefined ? { pool: options.pool } : {}),
    ...(options.sessionTokenSecret !== undefined
      ? { sessionTokenSecret: options.sessionTokenSecret }
      : {}),
  };
  await app.register(authenticatePlugin, middlewareOpts);
  const testModeOpts: TestModeRoutesOptions = {
    ...(options.pool !== undefined ? { pool: options.pool } : {}),
  };
  await app.register(testModeRoutesPlugin, testModeOpts);
  await app.ready();
  return app;
}
