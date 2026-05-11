// Fastify plugin registering the session-management HTTP endpoints.
//
//   - POST /sessions — create a new debate session.
//   - GET /sessions — list the visible debate sessions for the caller.
//   - GET /sessions/:id — fetch a single session's metadata.
//   - POST /sessions/:id/end — moderator marks a session as ended.
//   - PATCH /sessions/:id/privacy — host toggles the session privacy.
//
// Refinements: tasks/refinements/backend/create_session_endpoint.md,
//              tasks/refinements/backend/list_sessions_endpoint.md,
//              tasks/refinements/backend/get_session_endpoint.md,
//              tasks/refinements/backend/end_session_endpoint.md,
//              tasks/refinements/backend/session_privacy_toggle.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.session_management.create_session_endpoint,
//              backend.session_management.list_sessions_endpoint,
//              backend.session_management.get_session_endpoint,
//              backend.session_management.end_session_endpoint,
//              backend.session_management.session_privacy_toggle
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
// **`GET /sessions`** — the visibility-gated list. The handler:
//
//   1. Reads `request.authUser.id` (the caller).
//   2. Reads the optional `?status=active|ended` query param.
//   3. Issues a single SELECT against `sessions` with a parameterized
//      visibility gate (`privacy = 'public' OR host_user_id = $1 OR
//      EXISTS (... session_participants ...)`) and the optional status
//      WHERE on `ended_at IS [NOT] NULL`. ORDER BY `created_at DESC`.
//   4. Returns 200 + `{ sessions: SessionResponse[] }` (camelCase mapping
//      via the same `sessionRowToResponse` helper the create endpoint
//      uses).
//
// The visibility gate lifts the architecture's cross-session reference
// permission rule (docs/architecture.md, "Cross-session reference
// permissions") cleanly to a listing context: listing is strictly
// weaker than referencing, so the same gate suffices. Public sessions
// are visible to every authenticated user; private sessions are
// visible only to the host or a current/past participant. See
// tasks/refinements/backend/list_sessions_endpoint.md for the full
// rationale and the basic-vs-filters split with the sibling
// `session_listing_filters` task.
//
// **`GET /sessions/:id`** — the single-session fetch. The handler:
//
//   1. Reads `request.authUser.id` (the caller).
//   2. Reads the validated `:id` path param (Fastify rejects malformed
//      UUIDs at the schema layer with 400 `validation-failed`).
//   3. Issues a single SELECT against `sessions` with `id = $1` AND the
//      SAME visibility predicate `GET /sessions` uses (public OR host
//      OR participant). Zero rows → 404 `not-found` (whether the id
//      doesn't exist OR the row exists but isn't visible to this
//      caller — the two are deliberately indistinguishable from
//      outside, to avoid leaking the existence of private sessions to
//      unauthorized callers; see `tasks/refinements/backend/get_session_endpoint.md`'s
//      "404-not-403" decision).
//   4. Returns 200 + bare `SessionResponse` (NOT wrapped — the fetch
//      endpoint's resource IS the session, no second axis along which
//      the response could grow).
//
// **`POST /sessions/:id/end`** — the moderator-only end-of-show. The handler:
//
//   1. Reads `request.authUser.id` (the caller) and the validated `:id`
//      path param.
//   2. Opens a transaction.
//   3. Issues a visibility-gated `SELECT ... FOR UPDATE` against
//      `sessions` (same predicate `GET /sessions/:id` uses) to capture
//      the row's `host_user_id` and `ended_at` AND acquire a row lock
//      so concurrent end-session attempts serialise. Zero rows → 404
//      (existence-non-leak rule). Row found but `host_user_id !=
//      caller` → 403 `not-a-moderator` (the host IS the moderator at
//      v1). Row found, host matches, but `ended_at IS NOT NULL` → 409
//      `session-already-ended` (re-ending is meaningful, not idempotent).
//   4. UPDATEs `sessions SET ended_at = NOW()` RETURNING the full row.
//   5. SELECTs `MAX(sequence)` on `session_events` for this session,
//      computes `nextSeq = MAX + 1` (application-managed monotonic
//      sequence per ADR 0020; the UNIQUE constraint is the safety net
//      under concurrent writers).
//   6. Builds the `session-ended` envelope (payload `{ ended_at: <iso
//      from RETURNING> }`), runs `validateEvent`, and INSERTs the
//      event row.
//   7. COMMITs and returns 200 + the camelCase session JSON.
//
// See `tasks/refinements/backend/end_session_endpoint.md` for the
// authority-403 / visibility-404 ordering, the 409-not-200 rationale,
// and the FOR UPDATE row-lock decision.
//
// **`PATCH /sessions/:id/privacy`** — the host-only privacy toggle. The handler:
//
//   1. Reads `request.authUser.id` (the caller), the validated `:id`
//      path param, AND the validated body's `privacy` value.
//   2. Issues a visibility-gated SELECT against `sessions` (same
//      predicate the other session endpoints use) to capture the
//      row's `host_user_id`, `ended_at`, and current `privacy`. Zero
//      rows → 404 (existence-non-leak rule). Row found but
//      `host_user_id != caller` → 403 `not-a-moderator`. Row found,
//      host matches, but `ended_at IS NOT NULL` → 409
//      `session-already-ended` (privacy on an ended session is
//      meaningless; the cross-session-reference window is closed).
//   3. Issues a single UPDATE `sessions SET privacy = $1 WHERE id = $2`
//      RETURNING the full row. The UPDATE runs unconditionally — same-
//      value writes are a no-op at the DB layer and a 200 from this
//      endpoint (idempotent semantics; see refinement).
//   4. Returns 200 + the updated camelCase `SessionResponse`.
//
// **Why no transaction wrapper.** The endpoint issues a single UPDATE.
// `withTransaction` exists for endpoints that couple multiple writes
// (create + event INSERT; end's UPDATE + event INSERT). One statement
// has no atomicity boundary to manage; the visibility / authority /
// lifecycle checks run via a preceding SELECT, then the UPDATE
// follows. The SELECT and UPDATE see consistent state under standard
// READ COMMITTED — a concurrent end-session attempt that interleaved
// between this endpoint's SELECT and UPDATE would be detected at next
// access; for the v1 single-writer-per-session model the race is
// theoretical.
//
// **Why no `session-privacy-changed` event.** The event-kind catalog
// (`packages/shared-types/src/events.ts` / `apps/server/migrations/
// 0010_session_events.sql`) has no kind for privacy changes. Privacy
// is session-row metadata, not a methodology-level fact about the
// debate — the methodology engine never reads it; only the
// cross-session-reference + listing/audience permissions read it,
// and they read the current row value. Replay doesn't reconstruct
// historical privacy. See
// `tasks/refinements/backend/session_privacy_toggle.md` "Option B" for
// the alternative (Option A — add the event kind) that was weighed
// and rejected as scope creep for no v1 consumer.
//
// **What this plugin does NOT do** — deferred to sibling tasks:
//
//   - Filters beyond the visibility gate (host filter, participant
//     filter, pagination) — `backend.session_management.session_listing_filters`.
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
 * Stable `$id` for the shared `SessionListResponse` schema. The list
 * endpoint (`GET /sessions`) and any future listing surface that
 * returns the wrapped `{ sessions: SessionResponse[] }` shape
 * reference this exact wrapper via `{ $ref: 'SessionListResponse#' }`;
 * the `refResolver` in `openapi.ts` preserves `$id` as the
 * `components.schemas` key.
 */
export const SESSION_LIST_RESPONSE_SCHEMA_ID = 'SessionListResponse';

/**
 * The canonical session-list response shape — an object wrapping the
 * `sessions` array. The wrapper key (rather than a raw top-level
 * array) gives the response shape room to grow (pagination cursor,
 * total count, filter echo) without breaking the contract; clients
 * destructure `const { sessions } = await response.json()` and ignore
 * unknown sibling keys. See the refinement's "Response shape"
 * decision for the rationale.
 *
 * Each array element is a `SessionResponse` — referenced via the
 * shared `$ref: 'SessionResponse#'` so the OpenAPI document carries
 * a single per-session definition and the list endpoint's schema
 * points at it rather than re-declaring the shape.
 */
export const sessionListResponseSchema = {
  $id: SESSION_LIST_RESPONSE_SCHEMA_ID,
  type: 'object',
  required: ['sessions'],
  additionalProperties: false,
  properties: {
    sessions: {
      type: 'array',
      description:
        'The visible sessions for the authenticated caller, ordered by `created_at` ' +
        'DESC (most-recently-created first). Visibility per the architecture: public ' +
        'sessions are visible to every authenticated user; private sessions are ' +
        'visible only to the host or a current/past participant.',
      items: sessionResponseRef,
    },
  },
} as const;

/**
 * The `$ref` clients use to point at the shared `SessionListResponse`
 * schema. Future listing surfaces (e.g. a filters endpoint that
 * differs only on the query-string surface) can attach this to their
 * `schema.response[200]` slot rather than redeclaring the wrapper
 * shape.
 */
export const sessionListResponseRef = {
  $ref: `${SESSION_LIST_RESPONSE_SCHEMA_ID}#`,
} as const;

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
 * Path-param schema for `GET /sessions/:id`. JSON Schema attached to
 * `schema.params`; Fastify's validator enforces UUID shape before the
 * handler runs and rejects `/sessions/not-a-uuid` style requests with
 * a `validation` error that the centralized handler renders as the
 * canonical 400 `validation-failed` envelope.
 *
 * `format: 'uuid'` is the ajv-built-in UUID v4 format check — same
 * surface the `SessionResponse` schema uses for the `id` field, so a
 * round-trip GET/response keeps the same shape contract on both sides.
 */
const sessionIdParamsSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      description: 'The session id (UUID).',
    },
  },
} as const;

/**
 * Request body schema for `PATCH /sessions/:id/privacy`. JSON Schema
 * attached to `schema.body`; Fastify's validator rejects malformed
 * bodies with a `validation` error that the centralized handler
 * renders as the canonical `validation-failed` envelope.
 *
 * `privacy` is REQUIRED here (unlike `POST /sessions` where it
 * defaults to `'public'` when absent). The endpoint's contract is
 * "set privacy to X"; the X has to be supplied. Enum-constrained to
 * the same two values the SQL CHECK accepts; an out-of-enum value
 * would reach the DB only to be rejected at INSERT time, so we
 * short-circuit at the API layer for a cleaner error envelope.
 */
const sessionPrivacyBodySchema = {
  type: 'object',
  required: ['privacy'],
  additionalProperties: false,
  properties: {
    privacy: {
      type: 'string',
      enum: ['public', 'private'],
      description:
        "The desired session privacy. `'public'` allows cross-session reference; " +
        "`'private'` gates cross-session reference and audience-page authentication.",
    },
  },
} as const;

/**
 * Query-string schema for `GET /sessions`. JSON Schema attached to
 * `schema.querystring`; Fastify's validator rejects malformed inputs
 * with a `validation` error that the centralized handler renders as
 * the canonical `validation-failed` envelope.
 *
 * `status` is optional:
 *   - absent → no lifecycle filter; both active and ended sessions returned.
 *   - `'active'` → `WHERE ended_at IS NULL` applied on top of the visibility gate.
 *   - `'ended'` → `WHERE ended_at IS NOT NULL` applied on top of the visibility gate.
 *
 * Per the sessions-table refinement's "no explicit `status` column"
 * decision, lifecycle is inferred from `ended_at IS NULL` — this
 * filter exposes that inference as a query-time toggle.
 *
 * The sibling `session_listing_filters` task may extend this schema
 * (host filter, participant filter, pagination); THIS task lands the
 * visibility-gated base and the cheapest natural follow-on
 * (`status`).
 */
const listSessionsQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: {
      type: 'string',
      enum: ['active', 'ended'],
      description:
        "Optional lifecycle filter. `'active'` → only sessions with `ended_at IS NULL`; " +
        "`'ended'` → only sessions with `ended_at IS NOT NULL`. Absent → both.",
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

  // Register the wrapper `SessionListResponse` schema once per Fastify
  // instance — same idempotence pattern as the per-session schema.
  // The wrapper carries the `sessions: SessionResponse[]` shape the
  // list endpoint returns. Future listing surfaces (e.g. the sibling
  // `session_listing_filters` task) reference it via
  // `sessionListResponseRef` rather than redeclaring the wrapper.
  if (app.getSchema(SESSION_LIST_RESPONSE_SCHEMA_ID) === undefined) {
    app.addSchema(sessionListResponseSchema);
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

  app.get(
    '/sessions',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['sessions'],
        summary: 'List the sessions visible to the authenticated caller',
        description:
          'Returns every session the caller is permitted to see, ordered ' +
          '`created_at` DESC. Visibility (per `docs/architecture.md`): public ' +
          'sessions are visible to every authenticated user; private sessions ' +
          'are visible only to the host or a current/past participant. The ' +
          'optional `?status=active|ended` query param filters on lifecycle: ' +
          "`'active'` → only sessions with `ended_at IS NULL`; `'ended'` → only " +
          'sessions with `ended_at IS NOT NULL`; absent → both.\n\n' +
          'The response wraps the array under a `sessions` key so the shape can ' +
          'grow (pagination metadata, filter echo) without breaking existing ' +
          'clients. Pagination itself is intentionally deferred to the sibling ' +
          '`session_listing_filters` task; today the endpoint returns the full ' +
          'visible set in one response.\n\n' +
          'Returns 401 `auth-required` when no valid session cookie is present; ' +
          '400 `validation-failed` when the query string is malformed (e.g. an ' +
          'unrecognised `status` value).',
        security: [{ cookieAuth: [] }],
        querystring: listSessionsQuerystringSchema,
        response: {
          200: sessionListResponseRef,
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      // Same defensive-but-static-analysis-necessary check as the
      // create handler — the middleware guarantees `authUser` is set
      // for any request that reaches this point.
      const auth = request.authUser;
      if (auth === undefined) {
        throw new ApiError(
          500,
          'internal-error',
          'auth middleware did not populate request.authUser',
        );
      }
      const userId = auth.id;

      // Fastify's validator coerces / rejects per the schema; the
      // narrowed-cast captures the validated shape.
      const query = request.query as { status?: 'active' | 'ended' };

      // Build the lifecycle WHERE clause. The visibility gate is
      // always present; the status filter is conditional. We
      // concatenate the SQL but ALL parameter values flow via the
      // `$1` placeholder — no user-controlled string ever touches
      // the SQL text. (`status` is enum-validated at the schema
      // layer; the branch is a hard-coded literal regardless.)
      let lifecycleFilter = '';
      if (query.status === 'active') {
        lifecycleFilter = ' AND ended_at IS NULL';
      } else if (query.status === 'ended') {
        lifecycleFilter = ' AND ended_at IS NOT NULL';
      }

      // The visibility gate: ANY of (public privacy) OR (caller is
      // host) OR (caller has a session_participants row for this
      // session) admits the row. `EXISTS` (rather than a JOIN +
      // DISTINCT) avoids row-duplication when a user has multiple
      // historical participant rows for the same session — the
      // participants-table refinement's F5 decision (leave-and-rejoin
      // → multiple rows) makes this duplication possible. Past
      // participants (`left_at IS NOT NULL`) remain visible: once
      // you've seen a session you've seen it, and hiding it post-leave
      // would surprise users and complicate replay/audit flows.
      const pool = ensurePool();
      const result = await pool.query<SessionsInsertRow>(
        `SELECT id, host_user_id, privacy, topic, created_at, ended_at
         FROM sessions
         WHERE (
                privacy = 'public'
                OR host_user_id = $1
                OR EXISTS (
                     SELECT 1 FROM session_participants sp
                     WHERE sp.session_id = sessions.id AND sp.user_id = $1
                   )
              )${lifecycleFilter}
         ORDER BY created_at DESC`,
        [userId],
      );

      // Map each snake_case row to the camelCase response shape via
      // the same helper the create endpoint uses; the wrapper key
      // is the SessionListResponse contract.
      return reply.code(200).send({
        sessions: result.rows.map(sessionRowToResponse),
      });
    },
  );

  app.get(
    '/sessions/:id',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['sessions'],
        summary: "Fetch a single session's metadata by id",
        description:
          'Returns the session metadata for the supplied id, if and only if ' +
          'the caller is permitted to see it. Visibility (per `docs/architecture.md` ' +
          'and the `list_sessions_endpoint` refinement): public sessions are ' +
          'visible to every authenticated user; private sessions are visible ' +
          'only to the host or a current/past participant.\n\n' +
          'When the session does not exist OR exists but is invisible to the ' +
          'caller, the server returns 404 `not-found` — the two cases are ' +
          'deliberately indistinguishable to avoid leaking the existence of ' +
          'private sessions to unauthorized callers (see ' +
          '`tasks/refinements/backend/get_session_endpoint.md`).\n\n' +
          'Returns 401 `auth-required` when no valid session cookie is present; ' +
          '400 `validation-failed` when the path `:id` is not a UUID.',
        security: [{ cookieAuth: [] }],
        params: sessionIdParamsSchema,
        response: {
          200: sessionResponseRef,
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      // Defensive — same shape as the create / list handlers. The
      // middleware guarantees `authUser` is set on every request that
      // reaches a handler with `preHandler: app.authenticate`.
      const auth = request.authUser;
      if (auth === undefined) {
        throw new ApiError(
          500,
          'internal-error',
          'auth middleware did not populate request.authUser',
        );
      }
      const userId = auth.id;

      // Fastify's validator narrows the params to the schema shape;
      // the cast captures the validated `id`.
      const params = request.params as { id: string };
      const sessionId = params.id;

      // The visibility gate — LIFTED VERBATIM from `GET /sessions`'s
      // SELECT (see the list endpoint above for the canonical
      // rationale: public OR host OR participant, EXISTS-rather-than-
      // JOIN to avoid duplication from leave-and-rejoin rows, past
      // participants stay visible). Adding `id = $1` narrows the
      // result to at most one row; zero rows means either the id
      // doesn't exist OR it does but isn't visible to this caller —
      // BOTH cases collapse into 404 so the response doesn't leak
      // the existence of private sessions (the 404-not-403 decision
      // in this endpoint's refinement).
      const pool = ensurePool();
      const result = await pool.query<SessionsInsertRow>(
        `SELECT id, host_user_id, privacy, topic, created_at, ended_at
         FROM sessions
         WHERE id = $1
           AND (
                 privacy = 'public'
                 OR host_user_id = $2
                 OR EXISTS (
                      SELECT 1 FROM session_participants sp
                      WHERE sp.session_id = sessions.id AND sp.user_id = $2
                    )
               )`,
        [sessionId, userId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw ApiError.notFound('session not found or not visible');
      }

      return reply.code(200).send(sessionRowToResponse(row));
    },
  );

  app.post(
    '/sessions/:id/end',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['sessions'],
        summary: 'End a debate session (moderator-only)',
        description:
          'Marks the session as ended by setting `ended_at = NOW()` and emitting a ' +
          '`session-ended` event into `session_events` at the next available sequence. ' +
          'Both writes are atomic (single transaction); the row stays for replay/history. ' +
          'Only the session host (the moderator at v1) may end the session.\n\n' +
          'Visibility-then-authority ordering: invisible sessions (private + caller is ' +
          'neither host nor participant) return 404 `not-found` BEFORE any authority ' +
          'check, preserving the existence-non-leak property. Visible-but-not-host ' +
          'returns 403 `not-a-moderator`. An already-ended session returns 409 ' +
          '`session-already-ended` — re-ending is deliberately NOT idempotent because ' +
          'a no-op response would silently desync the client from the methodology, and ' +
          'a second `session-ended` event would corrupt the per-session log.\n\n' +
          'Returns 401 `auth-required` when no valid session cookie is present; ' +
          '400 `validation-failed` when the path `:id` is not a UUID.',
        security: [{ cookieAuth: [] }],
        params: sessionIdParamsSchema,
        response: {
          200: sessionResponseRef,
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      const auth = request.authUser;
      if (auth === undefined) {
        throw new ApiError(
          500,
          'internal-error',
          'auth middleware did not populate request.authUser',
        );
      }
      const userId = auth.id;

      const params = request.params as { id: string };
      const sessionId = params.id;

      // The whole flow lives inside a single transaction so the
      // visibility check, the authority check, the UPDATE, the
      // MAX(sequence) read, and the event INSERT are atomic with
      // respect to concurrent end-session attempts on the same
      // session. `withTransaction` issues BEGIN/COMMIT (or ROLLBACK
      // on throw); the production path takes a dedicated client out
      // of the pg.Pool, the test/pglite path issues transaction
      // control directly against `pool.query`.
      const updatedRow = await withTransaction(ensurePool(), async (client) => {
        // 1. Visibility-gated SELECT ... FOR UPDATE.
        //    Same predicate as `GET /sessions/:id` (public OR host OR
        //    participant) — the existence-non-leak property carries
        //    through: invisible sessions return 404 BEFORE any
        //    authority check fires. The `FOR UPDATE` clause acquires
        //    a row lock so concurrent end-session attempts on the
        //    same session serialise; the second transaction's
        //    visibility-gated SELECT will block until the first
        //    commits, then see the post-commit `ended_at IS NOT
        //    NULL` and short-circuit to 409.
        const lookup = await client.query<{
          id: string;
          host_user_id: string;
          ended_at: Date | string | null;
        }>(
          `SELECT id, host_user_id, ended_at
           FROM sessions
           WHERE id = $1
             AND (
                   privacy = 'public'
                   OR host_user_id = $2
                   OR EXISTS (
                        SELECT 1 FROM session_participants sp
                        WHERE sp.session_id = sessions.id AND sp.user_id = $2
                      )
                 )
           FOR UPDATE`,
          [sessionId, userId],
        );
        const existing = lookup.rows[0];
        if (existing === undefined) {
          // Zero rows — either the id doesn't exist OR it does but
          // isn't visible to this caller. Both collapse into 404 so
          // the response doesn't leak the existence of private
          // sessions. Mirrors `get_session_endpoint`'s 404-not-403
          // decision.
          throw ApiError.notFound('session not found or not visible');
        }

        // 2. Authority — only the host may end the session. The
        //    `RejectionReason` union's `not-a-moderator` maps to 403
        //    and is the right code at v1 because the host IS the
        //    moderator. See the refinement for the alternatives
        //    surveyed.
        if (existing.host_user_id !== userId) {
          throw new ApiError(403, 'not-a-moderator', 'only the session host may end the session');
        }

        // 3. Idempotency check — already-ended returns 409 with a
        //    discriminating code, NOT a no-op 200. Re-ending is a
        //    meaningful state attempt (the caller's mental model
        //    says the session is still active); the typed code lets
        //    the client distinguish this from a generic conflict
        //    and refresh / display the "already ended" notice.
        if (existing.ended_at !== null) {
          throw new ApiError(409, 'session-already-ended', 'session has already ended');
        }

        // 4. Flip `ended_at` to NOW(). RETURNING surfaces the full
        //    row (the same shape `sessionRowToResponse` consumes).
        //    The DB's NOW() is the canonical end-of-show timestamp;
        //    both the column and the event payload use the same
        //    value (read out of RETURNING below) so the projection's
        //    "session.endedAt == event.payload.ended_at" invariant
        //    holds.
        const updateResult = await client.query<SessionsInsertRow>(
          `UPDATE sessions
           SET ended_at = NOW()
           WHERE id = $1
           RETURNING id, host_user_id, privacy, topic, created_at, ended_at`,
          [sessionId],
        );
        const updated = updateResult.rows[0];
        if (updated === undefined || updated.ended_at === null) {
          // Defensive — should be unreachable. The WHERE matched a
          // row (we just SELECTed it under FOR UPDATE) and the SET
          // assigns a non-null value. A surfaced 500 here means a
          // wiring regression.
          throw new ApiError(
            500,
            'internal-error',
            'session UPDATE returned no row or null ended_at',
          );
        }
        const endedAtIso = toIsoString(updated.ended_at);

        // 5. Application-managed monotonic sequence allocator (ADR
        //    0020). Read MAX(sequence) for this session, INSERT at
        //    MAX+1. The MAX-then-INSERT pair is inside the
        //    transaction so the `UNIQUE (session_id, sequence)`
        //    constraint catches concurrent writers — a racing
        //    transaction that committed at MAX+1 first would force
        //    this transaction's INSERT to violate the unique check,
        //    surface as a 500, and ROLLBACK. The FOR UPDATE on the
        //    sessions row serialises concurrent end-session
        //    attempts (which is the common case here), so the unique
        //    constraint is the second-line guard rather than the
        //    primary serialisation mechanism — but it's the
        //    canonical guard the methodology engine's future event-
        //    append helper will rely on.
        const maxRes = await client.query<{ max_seq: number | string | null }>(
          `SELECT COALESCE(MAX(sequence), 0) AS max_seq
           FROM session_events
           WHERE session_id = $1`,
          [sessionId],
        );
        // `MAX(sequence)` is BIGINT in Postgres; the default `pg`
        // parser surfaces BIGINT as string to avoid silent precision
        // loss past 2^53. We coerce to JS number — safe well past
        // 2^53 for any plausible per-session event count, and
        // documented as a known ceiling in shared-types' events.ts.
        const rawMax = maxRes.rows[0]?.max_seq ?? 0;
        const maxSeq = typeof rawMax === 'string' ? Number.parseInt(rawMax, 10) : rawMax;
        const nextSeq = maxSeq + 1;

        // 6. Build the `session-ended` envelope and run it through
        //    `validateEvent`. Same schema-on-write contract as
        //    `session-created` — every row in `session_events` is
        //    structurally valid by construction.
        const eventId = randomUUID();
        const eventCreatedAtIso = new Date(nowFn()).toISOString();
        const envelope = {
          id: eventId,
          sessionId: updated.id,
          sequence: nextSeq,
          kind: 'session-ended' as const,
          actor: userId,
          payload: {
            ended_at: endedAtIso,
          },
          createdAt: eventCreatedAtIso,
        };
        validateEvent(envelope);

        // 7. INSERT the event row. `payload` carries the snake_case
        //    shared-types payload; `created_at` is server-managed via
        //    the column default.
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

        return updated;
      });

      return reply.code(200).send(sessionRowToResponse(updatedRow));
    },
  );

  app.patch(
    '/sessions/:id/privacy',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['sessions'],
        summary: "Toggle a session's privacy (host-only)",
        description:
          "Updates the session row's `privacy` column to the requested value. Only the " +
          'session host (the moderator at v1) may toggle privacy. Live sessions only: ' +
          'an ended session cannot be re-privatised or re-published (privacy at end-time ' +
          'is the frozen value).\n\n' +
          'Visibility-then-authority ordering: invisible sessions (private + caller is ' +
          'neither host nor participant) return 404 `not-found` BEFORE any authority ' +
          'check, preserving the existence-non-leak property. Visible-but-not-host ' +
          'returns 403 `not-a-moderator`. An already-ended session returns 409 ' +
          '`session-already-ended`. Setting the same value the row already has is ' +
          'a 200 no-op (idempotent semantics; see refinement).\n\n' +
          'No `session-privacy-changed` event is written — privacy is session-row ' +
          'metadata, not a methodology-level fact about the debate. See ' +
          '`tasks/refinements/backend/session_privacy_toggle.md` "Option B".\n\n' +
          'Returns 401 `auth-required` when no valid session cookie is present; ' +
          '400 `validation-failed` when the path `:id` is not a UUID or the body ' +
          'is malformed (missing `privacy`, value outside the enum).',
        security: [{ cookieAuth: [] }],
        params: sessionIdParamsSchema,
        body: sessionPrivacyBodySchema,
        response: {
          200: sessionResponseRef,
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      // Same defensive-but-static-analysis-necessary check as the
      // sibling handlers — the middleware guarantees `authUser` is
      // set for any request that reaches a route with
      // `preHandler: app.authenticate`.
      const auth = request.authUser;
      if (auth === undefined) {
        throw new ApiError(
          500,
          'internal-error',
          'auth middleware did not populate request.authUser',
        );
      }
      const userId = auth.id;

      const params = request.params as { id: string };
      const sessionId = params.id;
      const body = request.body as { privacy: 'public' | 'private' };
      const desiredPrivacy = body.privacy;

      const pool = ensurePool();

      // 1. Visibility-gated lookup. Same predicate as `GET /sessions/:id`
      //    and `POST /sessions/:id/end` — the existence-non-leak rule
      //    carries through. We pull `host_user_id` and `ended_at` so
      //    the authority + lifecycle checks can fire from a single
      //    SELECT round trip. We do NOT use `FOR UPDATE` here: this
      //    endpoint issues a single UPDATE without coupling to an
      //    event INSERT, so there's no read-then-write window that a
      //    concurrent writer could corrupt (the UPDATE itself is the
      //    atomic step).
      const lookup = await pool.query<{
        id: string;
        host_user_id: string;
        ended_at: Date | string | null;
      }>(
        `SELECT id, host_user_id, ended_at
         FROM sessions
         WHERE id = $1
           AND (
                 privacy = 'public'
                 OR host_user_id = $2
                 OR EXISTS (
                      SELECT 1 FROM session_participants sp
                      WHERE sp.session_id = sessions.id AND sp.user_id = $2
                    )
               )`,
        [sessionId, userId],
      );
      const existing = lookup.rows[0];
      if (existing === undefined) {
        // Zero rows — either the id doesn't exist OR it does but isn't
        // visible to this caller. Both collapse into 404 so the
        // response doesn't leak the existence of private sessions.
        throw ApiError.notFound('session not found or not visible');
      }

      // 2. Authority — only the host may toggle privacy. Reuses
      //    `not-a-moderator` to keep the rejection vocabulary stable
      //    across the session-management surface (same code the
      //    end-session endpoint emits for the same failure mode at v1
      //    — the host IS the moderator).
      if (existing.host_user_id !== userId) {
        throw new ApiError(
          403,
          'not-a-moderator',
          'only the session host may toggle the session privacy',
        );
      }

      // 3. Lifecycle gate — ended sessions can't toggle. Privacy at
      //    end-time is the frozen value; flipping it post-end would
      //    either lie ("this session was always private") or break
      //    invariants for downstream snapshot/audit consumers. Reuses
      //    the `session-already-ended` code from the end-session
      //    endpoint for vocabulary consistency.
      if (existing.ended_at !== null) {
        throw new ApiError(
          409,
          'session-already-ended',
          'cannot toggle privacy on an ended session',
        );
      }

      // 4. UPDATE. Runs unconditionally — same-value writes are a
      //    no-op at the DB layer (`SET privacy = $1` writes the same
      //    value; `created_at` / `host_user_id` / `topic` / `ended_at`
      //    are not touched). The idempotency semantics mean a retry-
      //    on-network-error is safe; clients don't have to detect
      //    "did my prior call already land?" RETURNING surfaces the
      //    full row so we can map directly to the response shape.
      const updateResult = await pool.query<SessionsInsertRow>(
        `UPDATE sessions
         SET privacy = $1
         WHERE id = $2
         RETURNING id, host_user_id, privacy, topic, created_at, ended_at`,
        [desiredPrivacy, sessionId],
      );
      const updated = updateResult.rows[0];
      if (updated === undefined) {
        // Defensive — should be unreachable. The WHERE matched a row
        // we just SELECTed above; the UPDATE's WHERE narrows the
        // same way. A surfaced 500 here means a wiring regression
        // (e.g. concurrent DELETE — but `sessions` has no DELETE
        // path at v1).
        throw new ApiError(500, 'internal-error', 'session UPDATE returned no row');
      }

      return reply.code(200).send(sessionRowToResponse(updated));
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
