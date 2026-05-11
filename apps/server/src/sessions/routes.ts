// Fastify plugin registering the session-management HTTP endpoints.
//
//   - POST /sessions — create a new debate session.
//
// Refinement: tasks/refinements/backend/create_session_endpoint.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.session_management.create_session_endpoint
//
// **What this plugin owns today.** A single route — `POST /sessions` —
// behind `preHandler: app.authenticate`. The handler:
//
//   1. Reads `request.authUser.id` (the host) and the body's `topic` +
//      optional `privacy` (default `'public'`).
//   2. Opens a transaction and INSERTs the session row.
//   3. Builds the `session-created` event envelope, runs it through
//      `validateEvent` (the server-side schema-on-write gate), and
//      INSERTs it into `session_events` at `sequence = 1` with
//      `actor = host_user_id`.
//   4. COMMITs and returns 201 + the camelCase session JSON.
//
// **Why a single transaction.** The sessions row AND the
// `session-created` event row are two sides of the same logical
// operation; a partial state where one lands but not the other would
// corrupt every downstream consumer (replay can't anchor without the
// first event; the sessions table would advertise a session whose log
// is empty). BEGIN-COMMIT keeps the invariant atomic.
//
// **Why `sequence = 1` hard-coded.** A brand-new session has no prior
// events; the first event is sequence=1 by construction. No
// `MAX(sequence)+1` is needed because the row didn't exist before the
// BEGIN — no concurrent writer can already be referencing it.
//
// **Why `validateEvent` runs before INSERT.** The schema-on-write
// invariant ADR 0021 documents: every row in `session_events` is
// structurally valid by construction. Calling `validateEvent` on the
// envelope this handler is about to insert catches any drift between
// the handler's payload construction and the shared-types
// `sessionCreatedPayloadSchema` at the earliest possible moment — the
// INSERT either lands a valid row or doesn't run at all.
//
// **What this plugin does NOT do** — deferred to sibling tasks:
//
//   - `GET /sessions` (list) — `backend.session_management.list_sessions_endpoint`.
//   - `GET /sessions/:id` (fetch) — `backend.session_management.get_session_endpoint`.
//   - `POST /sessions/:id/end` — `backend.session_management.end_session_endpoint`.
//   - `POST /sessions/:id/privacy` — `backend.session_management.session_privacy_toggle`.
//   - `POST /sessions/:id/participants` — `backend.session_management.participant_assignment`.
//
// The plugin's barrel-style shape (a Fastify plugin and a few exported
// schema/type symbols) is the seed those sibling tasks extend; new
// routes attach onto the same plugin.

import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { ApiError } from '../errors.js';
import { errorEnvelopeRef } from '../openapi.js';
import { getDefaultPool, type DbPool } from '../db.js';
import { validateEvent } from '../events/validate.js';

/**
 * Options accepted by `sessionsRoutesPlugin`. Every field is optional —
 * production callers pass `{}` and the plugin reaches for env-driven
 * defaults.
 */
export interface SessionsRoutesOptions {
  /**
   * Database pool. When absent the plugin lazily calls
   * `getDefaultPool()` on the first request. Tests pass a memory shim
   * (Vitest) or a pglite-backed adapter (Cucumber).
   *
   * Two flavours of pool are supported via the structural surface:
   *
   *   - A pool with `connect()` (production `pg.Pool`) — the handler
   *     `await pool.connect()`s a dedicated client for the transaction.
   *   - A pool without `connect()` (test pglite adapter / memory shim) —
   *     the handler issues `BEGIN/COMMIT/ROLLBACK` directly against the
   *     pool's `query` method. PGlite is single-connection by nature,
   *     so this is safe; the production `pg.Pool` requires the dedicated
   *     client to avoid cross-connection transaction leakage.
   */
  readonly pool?: DbPool;
  /**
   * Clock injection for the `session-created` event's `created_at`
   * payload field. Defaults to `Date.now`; tests pass a controllable
   * function so the payload is deterministic across runs.
   *
   * NB: the `sessions.created_at` and `session_events.created_at`
   * COLUMN values are produced by Postgres' `NOW()` / `DEFAULT` — we
   * read them back via `INSERT ... RETURNING`. The injected `now` is
   * used only for the JSON payload's `created_at` field, which the
   * validator parses as ISO-8601. In a hermetic test the two values
   * can be made consistent by pinning Postgres' clock; in production
   * they are within microseconds of each other.
   */
  readonly now?: () => number;
}

/**
 * Per-row shape returned from the sessions INSERT ... RETURNING.
 * Narrowed at the call site so the helper doesn't need to know about
 * the full sessions-table schema. The DB returns snake_case;
 * camelCase translation happens at the response boundary.
 */
interface SessionsInsertRow extends Record<string, unknown> {
  readonly id: string;
  readonly host_user_id: string;
  readonly privacy: string;
  readonly topic: string;
  readonly created_at: Date | string;
  readonly ended_at: Date | string | null;
}

/**
 * Stable `$id` for the shared SessionResponse schema. Future session
 * endpoints (`GET /sessions/:id`, `POST /sessions/:id/end`, the
 * privacy-toggle endpoint) reference this exact shape via
 * `{ $ref: 'SessionResponse#' }`; the `refResolver` in `openapi.ts`
 * preserves `$id` as the `components.schemas` key.
 */
export const SESSION_RESPONSE_SCHEMA_ID = 'SessionResponse';

/**
 * The canonical session response shape. All fields camelCase per the
 * platform's HTTP convention (`/auth/me` is `{ userId, screenName }`).
 * Declared as a top-level schema so future session endpoints can
 * `$ref` it rather than redeclare the shape.
 */
export const sessionResponseSchema = {
  $id: SESSION_RESPONSE_SCHEMA_ID,
  type: 'object',
  required: ['id', 'hostUserId', 'privacy', 'topic', 'createdAt', 'endedAt'],
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      description: 'Server-generated session id.',
    },
    hostUserId: {
      type: 'string',
      format: 'uuid',
      description: 'The user who created the session (the host).',
    },
    privacy: {
      type: 'string',
      enum: ['public', 'private'],
      description:
        "Session privacy. `'public'` (the default) allows cross-session reference; " +
        "`'private'` gates audience-page authentication and cross-session reference.",
    },
    topic: {
      type: 'string',
      description: 'The debate topic, captured at session creation.',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      description: 'ISO-8601 timestamp the row was created.',
    },
    endedAt: {
      type: ['string', 'null'],
      format: 'date-time',
      description: 'ISO-8601 timestamp the session ended; null while the session is active.',
    },
  },
} as const;

/**
 * The `$ref` clients use to point at the shared `SessionResponse`
 * schema. The string form (`'SessionResponse#'`) targets Fastify's
 * schema store; `@fastify/swagger` resolves it into the generated
 * document's `components.schemas.SessionResponse` entry via the
 * `refResolver` configured in `openapi.ts`.
 */
export const sessionResponseRef = { $ref: `${SESSION_RESPONSE_SCHEMA_ID}#` } as const;

/**
 * Request body schema for `POST /sessions`. JSON Schema attached to
 * `schema.body`; Fastify's validator rejects malformed bodies with a
 * `validation` error that the centralized handler renders as the
 * canonical `validation-failed` envelope.
 *
 * `topic` minLength=1 rejects the empty string; maxLength=256 is the
 * API-layer cap (the `sessions.topic` column is TEXT with no DB cap).
 * `privacy` is optional — the handler defaults to `'public'` when
 * absent, matching both the SQL column default and the architecture's
 * "public by default; the host may mark a session private."
 */
const createSessionBodySchema = {
  type: 'object',
  required: ['topic'],
  additionalProperties: false,
  properties: {
    topic: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'The debate topic. 1..256 characters; non-empty after the schema check.',
    },
    privacy: {
      type: 'string',
      enum: ['public', 'private'],
      description:
        "Optional session privacy. Defaults to `'public'` when omitted. " +
        "`'private'` gates cross-session reference and audience-page auth.",
    },
  },
} as const;

/**
 * Normalize a DB-returned timestamp (which pglite hands back as a
 * `Date` and `pg` hands back as a `Date` when the parser is the
 * default, or as a string under custom parsers) into an ISO-8601
 * string. `validateEvent`'s `created_at` payload field expects
 * `z.string().datetime({ offset: true })`, so we always produce a
 * string here regardless of the upstream driver's parsing choice.
 */
function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

/**
 * Minimal DB-client surface a transaction-aware route handler needs.
 * Matches both `pg.PoolClient` and the `DbPool` structural shape; the
 * `release()` is no-op for pools that don't carry a per-client
 * lifecycle (the pglite-backed adapter).
 */
interface DbTxClient {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: TRow[] }>;
  release?: () => void;
}

/**
 * Structural type for a pool that exposes `connect()` (the production
 * `pg.Pool` shape). The test-time pglite adapter does NOT implement
 * this — the helper below falls back to issuing transaction control
 * via `pool.query` directly in that case.
 */
interface PoolWithConnect extends DbPool {
  connect(): Promise<DbTxClient>;
}

/**
 * Type guard for `PoolWithConnect`. Pure structural check — we never
 * instantiate from the pool type at runtime; we just dispatch.
 */
function hasConnect(pool: DbPool): pool is PoolWithConnect {
  return typeof (pool as { connect?: unknown }).connect === 'function';
}

/**
 * Run `fn(client)` inside a DB transaction. Two code paths:
 *
 *   - **Production (`pg.Pool`)**: `await pool.connect()` to take a
 *     dedicated client out of the pool; run BEGIN/COMMIT/ROLLBACK on
 *     it; release on the way out (success or failure).
 *   - **Tests (pglite-backed adapter / memory shim)**: the pool does
 *     not expose `connect()`. Issue BEGIN/COMMIT/ROLLBACK directly
 *     against `pool.query` — pglite is single-connection by nature
 *     so there is no cross-connection leakage to worry about.
 *
 * Both branches re-throw on error so the caller's error handler runs
 * unchanged. ROLLBACK failures are not surfaced to the client (the
 * underlying transaction error is the one the caller cares about).
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
      // Best-effort rollback; if ROLLBACK itself fails (connection
      // already dead, etc.) we still want to surface the original
      // error to the caller, not the ROLLBACK error.
      try {
        await client.query('ROLLBACK');
      } catch {
        // intentionally suppressed; the original `err` is re-thrown.
      }
      throw err;
    } finally {
      if (client.release !== undefined) {
        client.release();
      }
    }
  }
  // Pool without `connect()` — issue BEGIN/COMMIT directly. The
  // pool's `query` shape matches the DbTxClient surface (sans
  // `release`), so we pass the pool itself as the client.
  const txClient: DbTxClient = {
    query: pool.query.bind(pool),
  };
  try {
    await txClient.query('BEGIN');
    const result = await fn(txClient);
    await txClient.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await txClient.query('ROLLBACK');
    } catch {
      // intentionally suppressed.
    }
    throw err;
  }
}

/**
 * Map a sessions-table row (snake_case, DB-typed timestamps) to the
 * camelCase HTTP response shape with ISO-8601 string timestamps.
 *
 * Single source of truth for the mapping so future session endpoints
 * (`GET /sessions/:id`, `POST /sessions/:id/end`) that produce the
 * same response shape can import this helper rather than re-deriving
 * the camelCase transformation.
 */
export function sessionRowToResponse(row: SessionsInsertRow): {
  id: string;
  hostUserId: string;
  privacy: string;
  topic: string;
  createdAt: string;
  endedAt: string | null;
} {
  return {
    id: row.id,
    hostUserId: row.host_user_id,
    privacy: row.privacy,
    topic: row.topic,
    createdAt: toIsoString(row.created_at),
    endedAt: row.ended_at === null ? null : toIsoString(row.ended_at),
  };
}

/**
 * The plugin body. Wires the routes onto the parent scope (via
 * `fastify-plugin`'s skip-override marker) so the routes appear in
 * the generated OpenAPI document, the auth middleware decoration is
 * visible at registration time, and the error-handler plugin classifies
 * thrown errors under the canonical envelope.
 */
const sessionsRoutesPluginAsync: FastifyPluginAsync<SessionsRoutesOptions> = (
  app: FastifyInstance,
  opts,
) => {
  // Register the shared `SessionResponse` schema once per Fastify
  // instance. `addSchema` is idempotent across `fastify-plugin`-wrapped
  // plugins on the same scope, but Fastify throws if the same `$id` is
  // registered twice on the same instance — so we guard with the
  // schema-store getter.
  if (app.getSchema(SESSION_RESPONSE_SCHEMA_ID) === undefined) {
    app.addSchema(sessionResponseSchema);
  }

  // Lazy DB-pool resolution. The first request triggers
  // `getDefaultPool()`; tests that never hit `POST /sessions` don't pay
  // the cost. Mirrors the `authRoutesPlugin` pattern.
  let resolvedPool: DbPool | undefined = opts.pool;
  const ensurePool = (): DbPool => {
    if (resolvedPool !== undefined) {
      return resolvedPool;
    }
    resolvedPool = getDefaultPool();
    return resolvedPool;
  };

  // Clock injection — defaults to `Date.now`. Tests pin this for
  // hermetic payload assertions on the `session-created` event's
  // `created_at` field.
  const nowFn = (): number => (opts.now !== undefined ? opts.now() : Date.now());

  app.post(
    '/sessions',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['sessions'],
        summary: 'Create a new debate session',
        description:
          'Creates a new session whose host is the authenticated caller. ' +
          'The body carries the debate topic and an optional privacy setting ' +
          "(defaults to `'public'`). On success the server inserts the session row " +
          'AND emits the corresponding `session-created` event into `session_events` ' +
          'at sequence 1 — both writes are atomic (single transaction). The response ' +
          'body is the created session in camelCase.\n\n' +
          'Returns 401 `auth-required` when no valid session cookie is present; ' +
          '400 `validation-failed` when the body is malformed (missing topic, topic ' +
          'too long, invalid privacy enum, etc.).',
        security: [{ cookieAuth: [] }],
        body: createSessionBodySchema,
        response: {
          201: sessionResponseRef,
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      // The middleware guarantees `authUser` is set; the non-null
      // assertion is a static-analysis necessity (the augmentation
      // types `authUser` as optional because public routes never set
      // it) and a runtime invariant (the preHandler either set it or
      // we never got here).
      const auth = request.authUser;
      if (auth === undefined) {
        // Defensive — should be unreachable. A surfaced 500 here means
        // a wiring regression (e.g. `preHandler: app.authenticate` was
        // removed from the route options); failing loud is the right
        // diagnostic.
        throw new ApiError(
          500,
          'internal-error',
          'auth middleware did not populate request.authUser',
        );
      }
      const hostUserId = auth.id;

      const body = request.body as { topic: string; privacy?: 'public' | 'private' };
      const topic = body.topic;
      const privacy: 'public' | 'private' = body.privacy ?? 'public';

      const created = await withTransaction(ensurePool(), async (client) => {
        // 1. Insert the session row. `gen_random_uuid()` produces the
        //    id; `NOW()` produces `created_at`; RETURNING surfaces the
        //    full row so we can build the event payload from a single
        //    source of truth.
        const insertResult = await client.query<SessionsInsertRow>(
          `INSERT INTO sessions (host_user_id, privacy, topic)
           VALUES ($1, $2, $3)
           RETURNING id, host_user_id, privacy, topic, created_at, ended_at`,
          [hostUserId, privacy, topic],
        );
        const row = insertResult.rows[0];
        if (row === undefined) {
          // The INSERT returned no row — should be impossible against
          // a healthy DB (the WHERE clause is implicit; RETURNING
          // surfaces every inserted row). Surface as a 500 so the
          // operator sees the impossibility.
          throw new ApiError(500, 'internal-error', 'session insert returned no row');
        }
        const createdAtIso = toIsoString(row.created_at);

        // 2. Build the `session-created` event envelope and run it
        //    through `validateEvent`. The validator catches any drift
        //    between this payload construction and the shared-types
        //    `sessionCreatedPayloadSchema` at the earliest moment;
        //    failures throw `EventValidationError` and the transaction
        //    rolls back. The event-log invariant ("every row is
        //    structurally valid") holds because every writer runs
        //    through the same gate. The envelope's `id` is a freshly-
        //    minted UUID generated client-side; we pass it in the
        //    INSERT explicitly so the same id appears in both the
        //    payload (if a future audit field references it) and the
        //    DB row.
        const eventId = randomUUID();
        const eventCreatedAtIso = new Date(nowFn()).toISOString();
        const envelope = {
          id: eventId,
          sessionId: row.id,
          sequence: 1,
          kind: 'session-created' as const,
          actor: hostUserId,
          payload: {
            host_user_id: hostUserId,
            privacy: row.privacy as 'public' | 'private',
            topic: row.topic,
            created_at: createdAtIso,
          },
          createdAt: eventCreatedAtIso,
        };
        // Throws EventValidationError on shape failure; the error
        // handler renders the canonical 422 envelope and the
        // transaction rolls back via the catch block in
        // `withTransaction`.
        validateEvent(envelope);

        // 3. Insert the event row. `sequence = 1` hard-coded because
        //    this is the session's first event (no prior events to
        //    select MAX from). `actor` is the host. `payload` carries
        //    the snake_case shared-types payload. `created_at` is
        //    server-managed via the column default — we don't pass
        //    `eventCreatedAtIso` here because the projection layer
        //    reads `created_at` from the row, not the payload, and
        //    consistency with the DB clock is preferable to consistency
        //    with the wall clock at handler-entry time.
        await client.query(
          `INSERT INTO session_events
             (id, session_id, sequence, kind, actor, payload)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            envelope.id,
            envelope.sessionId,
            envelope.sequence,
            envelope.kind,
            envelope.actor,
            JSON.stringify(envelope.payload),
          ],
        );

        return row;
      });

      // 201 Created — the row is the new resource; the response body
      // carries the full camelCase shape so the client doesn't need a
      // follow-up GET.
      return reply.code(201).send(sessionRowToResponse(created));
    },
  );

  // The plugin body is synchronous — `app.post(...)` returns the
  // FastifyInstance, not a Promise — but `FastifyPluginAsync` demands
  // a Promise<void> return. Mirrors the auth-routes plugin convention.
  return Promise.resolve();
};

/**
 * The wrapped plugin. `fastify-plugin` adds `skip-override` so the
 * routes attach to the parent scope rather than the plugin's
 * encapsulation child — required for `app.authenticate` (decorated by
 * a sibling plugin) to resolve at route-registration time, and for
 * `@fastify/swagger` to see the routes in the generated document.
 *
 * Named via the plugin metadata so `app.printPlugins()` shows it under
 * a stable label.
 */
export const sessionsRoutesPlugin = fp(sessionsRoutesPluginAsync, {
  name: 'a-conversa-sessions-routes',
  fastify: '5.x',
});

/**
 * Test-only convenience — build a minimal Fastify instance with the
 * shared error-envelope schema, the error-handler plugin, the auth
 * middleware plugin, and the sessions-routes plugin all wired. Hides
 * the `fastify` import behind the workspace boundary so the test
 * tsconfig (which doesn't resolve `fastify` directly — the dep lives
 * under `apps/server/node_modules`) can build the integration app
 * without an extra import path.
 *
 * Production code does NOT use this helper. Use `createServer()`
 * (in `server.ts`) which wires the full stack.
 *
 * @param options - the same shape as `SessionsRoutesOptions`, plus an
 *                  optional `sessionTokenSecret` forwarded to the
 *                  auth middleware so test JWTs verify under a known
 *                  key.
 * @returns the configured Fastify instance, ready for `.inject(...)`.
 */
export async function __buildTestSessionsApp(options: {
  pool?: DbPool;
  sessionTokenSecret?: string;
  now?: () => number;
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
    ...(options.now !== undefined ? { now: options.now } : {}),
  };
  await app.register(authenticatePlugin, middlewareOpts);
  const sessionsOpts: SessionsRoutesOptions = {
    ...(options.pool !== undefined ? { pool: options.pool } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  };
  await app.register(sessionsRoutesPlugin, sessionsOpts);
  await app.ready();
  return app;
}
