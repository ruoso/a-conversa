// Fastify plugin registering the session-management HTTP endpoints.
//
// All routes below are served under `/api/*` — `createServer()` (and
// the `__buildTestSessionsApp` test helper) register this plugin with
// `{ prefix: '/api' }`, so the route literals here remain bare
// `/sessions/...` and Fastify prepends the prefix at registration time.
// Refinement:
//   tasks/refinements/backend/serve_static_frontends_path_collision_fix.md.
//
//   - POST /api/sessions — create a new debate session.
//   - GET /api/sessions — list the visible debate sessions for the caller.
//   - GET /api/sessions/:id — fetch a single session's metadata.
//   - POST /api/sessions/:id/end — moderator marks a session as ended.
//   - PATCH /api/sessions/:id/privacy — host toggles the session privacy.
//   - POST /api/sessions/:id/participants — assign a debater participant (host-only).
//   - DELETE /api/sessions/:id/participants/:userId — remove a participant (host or self).
//
// Refinements: tasks/refinements/backend/create_session_endpoint.md,
//              tasks/refinements/backend/list_sessions_endpoint.md,
//              tasks/refinements/backend/session_listing_filters.md,
//              tasks/refinements/backend/get_session_endpoint.md,
//              tasks/refinements/backend/end_session_endpoint.md,
//              tasks/refinements/backend/session_privacy_toggle.md,
//              tasks/refinements/backend/participant_assignment.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
//
// **v1 role conflation: host == moderator.** Every authority check in
// this plugin treats `host_user_id === request.authUser.id` as "is
// moderator" and returns `not-a-moderator` for any non-host caller. The
// data model already distinguishes `actor` from `host` on per-event
// payloads, so the future "moderator separable from host" task can swap
// each per-site check for a single `isModerator(session, userId)` helper
// without touching the wire vocabulary. See
// tasks/refinements/backend-hardening/host_moderator_role_note.md
// (closes docs/security/m3-review/auth.md F-014).
// TaskJuggler: backend.session_management.create_session_endpoint,
//              backend.session_management.list_sessions_endpoint,
//              backend.session_management.session_listing_filters,
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
// **`GET /sessions`** — the visibility-gated list with optional
// filters and pagination. The handler:
//
//   1. Reads `request.authUser.id` (the caller).
//   2. Reads the validated query string. `status` / `host` /
//      `participant` / `privacy` / `topic` are optional filters
//      AND-composed onto the visibility gate; `limit` (default 50,
//      max 200) and `offset` (default 0) drive pagination.
//   3. Builds the composed WHERE clause + parameter array
//      incrementally — the visibility gate always uses `$1`; each
//      filter appends a fragment AND a value via a positional `$N`
//      counter. NO user-controlled string ever touches the SQL text;
//      enum branches use hard-coded literals and the `topic` value is
//      wrapped in `%...%` then passed as a parameter to `ILIKE`.
//   4. Issues TWO SELECTs against the same composed WHERE: the page
//      (with `ORDER BY created_at DESC LIMIT $N OFFSET $M`) and the
//      total count (`COUNT(*)::int` with no LIMIT). Both queries
//      reuse the parameter array up to (but not including) the
//      pagination placeholders.
//   5. Returns 200 + `{ sessions: SessionResponse[]; total: integer }`
//      — `sessions` is the camelCase-mapped page, `total` is the
//      visibility + filter count BEFORE limit/offset (matching the
//      page query's WHERE).
//
// The visibility gate lifts the architecture's cross-session reference
// permission rule (docs/architecture.md, "Cross-session reference
// permissions") cleanly to a listing context: listing is strictly
// weaker than referencing, so the same gate suffices. Public sessions
// are visible to every authenticated user; private sessions are
// visible only to the host or a current/past participant. The filters
// narrow WITHIN this set — a caller asking `?host=<other-user>` only
// sees the matching sessions they were already permitted to see (public
// + private-where-participant). See
// tasks/refinements/backend/session_listing_filters.md for the
// composed-WHERE rationale and pagination/`total` semantics.
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
//   - Full-text-search across topic + (future) participant screen-name
//     + (future) tags — `?topic=` is ILIKE substring for v1; a future
//     `backend.session_management.session_search` task replaces it with
//     `to_tsvector` + ranking when a UI surface needs ranked results.
//   - Cursor-based pagination — `?limit` / `?offset` is the v1 surface;
//     a future cursor token would land alongside (and eventually
//     deprecate `?offset`) if per-user row counts grow past offset
//     pagination's comfort zone.
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
import { appendSessionEvent } from '../events/append.js';
import { validateEvent } from '../events/validate.js';
import { canReferenceAnnotation, canReferenceEdge, canReferenceNode } from './references.js';
import { visibilityWhereFragment } from './visibility.js';

// `@a-conversa/shared-types`'s `Event` discriminated union — used by
// the post-COMMIT broadcast emit. The route's `withTransaction`
// callback collects every event it appends into a local array; after
// the COMMIT lands, the route iterates the array and calls
// `app.wsBroadcast.emit(...)` for each (the post-commit-emit
// invariant — see tasks/refinements/backend/ws_event_broadcast.md).
import type { Event } from '@a-conversa/shared-types';
import {
  MAX_SESSION_LIST_OFFSET,
  MAX_TOPIC_SEARCH_LENGTH,
  MIN_TOPIC_SEARCH_LENGTH,
} from '@a-conversa/shared-types';
import { wsBroadcastPlugin, wsConnectionSendersPlugin } from '../ws/broadcast/index.js';
import { pruneSubscribersForPrivateSession, wsSubscriptionsPlugin } from '../ws/subscriptions.js';

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
 * `sessions` array AND a `total` count of matching rows. The wrapper
 * shape was chosen in `list_sessions_endpoint` for exactly this
 * future: `session_listing_filters` adds pagination + filters, and the
 * `total` field is the canonical "how many rows would this query
 * return if I paged all the way through" denominator for paged UIs.
 *
 * `total` is the count of rows after visibility-gating + filters but
 * BEFORE `LIMIT` / `OFFSET` are applied — matching the page query's
 * WHERE clause. See `tasks/refinements/backend/session_listing_filters.md`
 * for the rationale (the alternative — unfiltered visibility count —
 * was rejected because it produces the wrong number for a "showing
 * 1-50 of N" UI).
 *
 * Each array element is a `SessionResponse` — referenced via the
 * shared `$ref: 'SessionResponse#'` so the OpenAPI document carries
 * a single per-session definition and the list endpoint's schema
 * points at it rather than re-declaring the shape.
 */
export const sessionListResponseSchema = {
  $id: SESSION_LIST_RESPONSE_SCHEMA_ID,
  type: 'object',
  required: ['sessions', 'total'],
  additionalProperties: false,
  properties: {
    sessions: {
      type: 'array',
      description:
        'The visible sessions for the authenticated caller, ordered by `created_at` ' +
        'DESC (most-recently-created first). Visibility per the architecture: public ' +
        'sessions are visible to every authenticated user; private sessions are ' +
        'visible only to the host or a current/past participant. The page is sliced ' +
        'by the `?limit` / `?offset` query params (defaults 50 / 0); the `total` ' +
        'field carries the full-match count for pagination UI.',
      items: sessionResponseRef,
    },
    total: {
      type: 'integer',
      minimum: 0,
      description:
        'The count of sessions matching the visibility gate AND every supplied filter ' +
        '(host, participant, privacy, status, topic) BEFORE `LIMIT`/`OFFSET` are ' +
        'applied. Paged UIs use this as the denominator for "showing N of M" status; ' +
        'clients walking pages stop when `(offset + sessions.length) >= total`.',
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
 * Stable `$id` for the shared `SessionParticipantResponse` schema. The
 * participant-assignment endpoints (`POST /sessions/:id/participants`
 * and `DELETE /sessions/:id/participants/:userId`) reference this exact
 * shape via `{ $ref: 'SessionParticipantResponse#' }`. Declared
 * top-level so OpenAPI carries a single `components.schemas` entry
 * both endpoints' documentation points at.
 *
 * Refinement: tasks/refinements/backend/participant_assignment.md.
 */
export const SESSION_PARTICIPANT_RESPONSE_SCHEMA_ID = 'SessionParticipantResponse';

/**
 * The canonical session-participant response shape. All fields
 * camelCase per the platform's HTTP convention; the underlying
 * `session_participants` row is snake_case + DB-typed timestamps and
 * gets translated at the response boundary by
 * `participantRowToResponse` below.
 *
 * `leftAt` is `string | null` — null while the participant is still in
 * the session; populated with an ISO-8601 timestamp on a successful
 * DELETE.
 */
export const sessionParticipantResponseSchema = {
  $id: SESSION_PARTICIPANT_RESPONSE_SCHEMA_ID,
  type: 'object',
  required: ['id', 'sessionId', 'userId', 'role', 'joinedAt', 'leftAt'],
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      description: 'Server-generated participant row id.',
    },
    sessionId: {
      type: 'string',
      format: 'uuid',
      description: 'The session this participation row belongs to.',
    },
    userId: {
      type: 'string',
      format: 'uuid',
      description: 'The user filling this participation slot.',
    },
    role: {
      type: 'string',
      enum: ['moderator', 'debater-A', 'debater-B'],
      description:
        'The role this participant holds in the session. Only `debater-A` and ' +
        '`debater-B` can be assigned via `POST /sessions/:id/participants`; ' +
        '`moderator` is reserved for the session host and assigned implicitly ' +
        'at session creation.',
    },
    joinedAt: {
      type: 'string',
      format: 'date-time',
      description: 'ISO-8601 timestamp the participation row was created.',
    },
    leftAt: {
      type: ['string', 'null'],
      format: 'date-time',
      description:
        'ISO-8601 timestamp the participant left the session; null while the ' +
        'participant is still active.',
    },
  },
} as const;

/**
 * The `$ref` participant-assignment endpoints use to point at the
 * shared `SessionParticipantResponse` schema. Single source of truth
 * for the response shape across `POST /sessions/:id/participants` and
 * `DELETE /sessions/:id/participants/:userId`.
 */
export const sessionParticipantResponseRef = {
  $ref: `${SESSION_PARTICIPANT_RESPONSE_SCHEMA_ID}#`,
} as const;

/**
 * Stable `$id` for the `EntityInclusionResponse` schema returned by
 * `POST /sessions/:id/include`. Declared top-level so OpenAPI carries
 * a single `components.schemas.EntityInclusionResponse` entry the
 * endpoint references via `$ref`. Refinement:
 * tasks/refinements/backend/entity_inclusion_endpoint.md.
 */
export const ENTITY_INCLUSION_RESPONSE_SCHEMA_ID = 'EntityInclusionResponse';

/**
 * The canonical `POST /sessions/:id/include` 200-response shape. All
 * fields camelCase per the platform's HTTP convention. `entityKind`
 * is the discriminator from the request body; `entityId` is the
 * supplied global entity id (echoed back so the client doesn't need
 * to remember which inclusion it just landed); `sessionId` is the
 * destination session (echoed back from the path param); `includedBy`
 * is the authenticated caller; `includedAt` is the join-table's
 * `included_at` timestamp from RETURNING, formatted as ISO-8601.
 *
 * Mirrors the `entity-included` event payload (snake_case) on the
 * write side but adopts camelCase for the HTTP response per the
 * project's wire convention.
 */
export const entityInclusionResponseSchema = {
  $id: ENTITY_INCLUSION_RESPONSE_SCHEMA_ID,
  type: 'object',
  required: ['entityKind', 'entityId', 'sessionId', 'includedBy', 'includedAt'],
  additionalProperties: false,
  properties: {
    entityKind: {
      type: 'string',
      enum: ['node', 'edge', 'annotation'],
      description: 'The kind of entity that was included — mirrors the request body discriminator.',
    },
    entityId: {
      type: 'string',
      format: 'uuid',
      description: 'The global entity id that was brought into this session.',
    },
    sessionId: {
      type: 'string',
      format: 'uuid',
      description: 'The destination session id (echoes the path param).',
    },
    includedBy: {
      type: 'string',
      format: 'uuid',
      description: 'The authenticated user who included the entity.',
    },
    includedAt: {
      type: 'string',
      format: 'date-time',
      description:
        'ISO-8601 timestamp the inclusion landed (the `included_at` column of the matching ' +
        '`session_<kind>s` row).',
    },
  },
} as const;

/**
 * The `$ref` the inclusion endpoint uses to point at the shared
 * `EntityInclusionResponse` schema. Single source of truth for the
 * 200-response shape.
 */
export const entityInclusionResponseRef = {
  $ref: `${ENTITY_INCLUSION_RESPONSE_SCHEMA_ID}#`,
} as const;

/**
 * Request body schema for `POST /sessions/:id/include`. JSON Schema
 * attached to `schema.body`; Fastify's validator rejects malformed
 * bodies with a 400 `validation-failed` envelope before the handler
 * even runs.
 *
 * `entityKind` enum mirrors the shared-types `entityKindSchema` (and
 * the SQL CHECK on the `entity-included` event's payload). `entityId`
 * UUID format is the same surface every UUID-typed body field uses
 * across the session-management endpoints.
 */
const includeEntityBodySchema = {
  type: 'object',
  required: ['entityKind', 'entityId'],
  additionalProperties: false,
  properties: {
    entityKind: {
      type: 'string',
      enum: ['node', 'edge', 'annotation'],
      description: 'The kind of entity being included.',
    },
    entityId: {
      type: 'string',
      format: 'uuid',
      description: 'The global entity id (UUID) being brought into this session.',
    },
  },
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
 * Request body schema for `POST /sessions/:id/participants`. JSON
 * Schema attached to `schema.body`; Fastify's validator rejects
 * malformed bodies with a `validation` error that the centralized
 * handler renders as the canonical `validation-failed` envelope.
 *
 * The `role` enum **deliberately excludes `'moderator'`** — the
 * moderator role is reserved for the session host and assigned
 * implicitly at session creation (per Option A in
 * `tasks/refinements/backend/participant_assignment.md`). A client
 * that sends `role: 'moderator'` gets a clean 400
 * `validation-failed` with an enum-mismatch issue from Ajv.
 */
const assignParticipantBodySchema = {
  type: 'object',
  required: ['userId', 'role'],
  additionalProperties: false,
  properties: {
    userId: {
      type: 'string',
      format: 'uuid',
      description: 'The user being invited to the session.',
    },
    role: {
      type: 'string',
      enum: ['debater-A', 'debater-B'],
      description:
        'The role the user fills. `moderator` is reserved for the session host ' +
        'and assigned implicitly at session creation; it is NOT a valid value here.',
    },
  },
} as const;

/**
 * Path-params schema for `DELETE /sessions/:id/participants/:userId`.
 * JSON Schema attached to `schema.params`; Fastify's validator
 * enforces UUID shape on both `:id` and `:userId` before the handler
 * runs and rejects malformed UUIDs with a 400 `validation-failed`
 * envelope.
 */
const sessionParticipantParamsSchema = {
  type: 'object',
  required: ['id', 'userId'],
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      description: 'The session id (UUID).',
    },
    userId: {
      type: 'string',
      format: 'uuid',
      description: 'The participating user id (UUID).',
    },
  },
} as const;

/**
 * Query-string schema for `GET /sessions`. JSON Schema attached to
 * `schema.querystring`; Fastify's validator rejects malformed inputs
 * with a `validation` error that the centralized handler renders as
 * the canonical `validation-failed` envelope.
 *
 * Every filter is optional; filters are AND-composed and narrow WITHIN
 * the visibility gate (the gate stays in place — a caller asking
 * `?host=<other-user>` only sees the matching sessions they were
 * already permitted to see). `additionalProperties: false` rejects
 * unknown keys (e.g. typo'd filter names) with `validation-failed`
 * rather than silently ignoring them.
 *
 * Filter surface (per `tasks/refinements/backend/session_listing_filters.md`):
 *
 *   - `status` (lifecycle, landed in `list_sessions_endpoint`):
 *     `'active'` → `ended_at IS NULL`; `'ended'` → `ended_at IS NOT NULL`.
 *   - `host` — UUID of the session host. Filters to sessions where
 *     `host_user_id = $N`.
 *   - `participant` — UUID of a user. Filters to sessions where the
 *     user has any (current or historical) `session_participants`
 *     row. EXISTS-style join mirrors the visibility-gate's participant
 *     branch — leave-and-rejoin's multiple rows don't duplicate the
 *     parent session row.
 *   - `privacy` — narrows to a single privacy bucket. Enum-validated.
 *   - `topic` — case-insensitive substring match (`topic ILIKE
 *     '%<topic>%'`). ILIKE for v1; a future task may layer full-text-
 *     search.
 *   - `limit` — page size; default 50, max 200. Integer-coerced and
 *     range-validated at the schema layer.
 *   - `offset` — page offset; default 0, min 0. Integer-coerced.
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
    host: {
      type: 'string',
      format: 'uuid',
      description:
        'Optional host filter. Narrows to sessions whose `host_user_id` matches. ' +
        'The visibility gate still applies — the caller only sees the subset of the ' +
        "host's sessions they would otherwise be permitted to see.",
    },
    participant: {
      type: 'string',
      format: 'uuid',
      description:
        'Optional participant filter. Narrows to sessions where the named user is or ' +
        'was a participant (any `session_participants` row, including historical). The ' +
        'visibility gate still applies — the caller only sees the subset of the ' +
        "participant's sessions they would otherwise be permitted to see.",
    },
    privacy: {
      type: 'string',
      enum: ['public', 'private'],
      description:
        "Optional privacy filter. `'public'` or `'private'` narrows to a single " +
        'bucket. The visibility gate still applies — a non-participant asking ' +
        "`?privacy=private` sees no rows (private sessions they aren't in remain " +
        'invisible).',
    },
    topic: {
      type: 'string',
      // `MIN_TOPIC_SEARCH_LENGTH = 3`, `MAX_TOPIC_SEARCH_LENGTH = 64`
      // — see `packages/shared-types/src/limits.ts`. Closes
      // docs/security/m3-review/inputs.md F-013. The min-cap rejects
      // 0/1/2-char patterns (which match nearly every row and force
      // a full-scan worst case); the max-cap bounds the per-row ILIKE
      // comparison cost. Distinct from `MAX_TOPIC_LENGTH=256` (the
      // per-row stored-topic cap at session-creation) — this is the
      // SEARCH-string cap. Over-cap or below-min requests fail with
      // 400 `validation-failed` before any DB round-trip.
      minLength: MIN_TOPIC_SEARCH_LENGTH,
      maxLength: MAX_TOPIC_SEARCH_LENGTH,
      description:
        'Optional case-insensitive substring match against `topic`. Implemented via ' +
        "`topic ILIKE '%<value>%'`; full-text-search is a future task. The value is " +
        'passed as a parameterized pattern — no user input touches the SQL text. ' +
        'Length must be 3..64 characters — shorter patterns are not selective enough ' +
        'to be useful and longer ones inflate per-row ILIKE cost. See ' +
        'docs/security/m3-review/inputs.md F-013.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 200,
      default: 50,
      description:
        'Page size. Defaults to 50 if omitted; capped at 200 to prevent accidental ' +
        '"give me everything" requests. Returned rows are at most this count; the ' +
        '`total` field on the response carries the full match count for paging UIs.',
    },
    offset: {
      type: 'integer',
      minimum: 0,
      // `MAX_SESSION_LIST_OFFSET = 100_000` — see
      // `packages/shared-types/src/limits.ts`. Closes
      // docs/security/m3-review/coverage.md G-013 (an authenticated
      // client could otherwise burn DB scan budget on
      // `?offset=999999999999`). 100k = 500 pages at the maximum
      // `?limit=200`; over-cap requests fail with 400
      // `validation-failed` before any DB round-trip.
      maximum: MAX_SESSION_LIST_OFFSET,
      default: 0,
      description:
        'Page offset. Defaults to 0. Combined with `limit` this drives offset-based ' +
        'pagination over the ordered (`created_at DESC`) result set. Capped at ' +
        '100 000 (500 pages at `limit=200`) to bound DB scan cost — see ' +
        'docs/security/m3-review/coverage.md G-013.',
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
 * Per-row shape returned from `session_participants` queries. Narrowed
 * at the call site so the mapper doesn't need to know the full
 * participants-table schema. The DB returns snake_case; camelCase
 * translation happens at the response boundary.
 */
interface SessionParticipantsRow extends Record<string, unknown> {
  readonly id: string;
  readonly session_id: string;
  readonly user_id: string;
  readonly role: string;
  readonly joined_at: Date | string;
  readonly left_at: Date | string | null;
}

/**
 * Map a `session_participants` row to the camelCase HTTP response
 * shape with ISO-8601 string timestamps. Shared by
 * `POST /sessions/:id/participants` and
 * `DELETE /sessions/:id/participants/:userId` so the two endpoints
 * return the same canonical shape (`SessionParticipantResponse`).
 *
 * Refinement: tasks/refinements/backend/participant_assignment.md.
 */
export function participantRowToResponse(row: SessionParticipantsRow): {
  id: string;
  sessionId: string;
  userId: string;
  role: string;
  joinedAt: string;
  leftAt: string | null;
} {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    role: row.role,
    joinedAt: toIsoString(row.joined_at),
    leftAt: row.left_at === null ? null : toIsoString(row.left_at),
  };
}

/**
 * The plugin body. Wires the routes onto the parent scope (via
 * `fastify-plugin`'s skip-override marker) so the routes appear in
 * the generated OpenAPI document, the auth middleware decoration is
 * visible at registration time, and the error-handler plugin classifies
 * thrown errors under the canonical envelope.
 */
const sessionsRoutesPluginAsync: FastifyPluginAsync<SessionsRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  // Ensure `app.wsBroadcast` is decorated so the post-COMMIT
  // event-applied emit can publish. Both this plugin and
  // `wsConnectionHandlingPlugin` register the bus plugin — the bus
  // plugin's own `hasDecorator` guard makes the second registration
  // a no-op so order doesn't matter. Without this, the
  // `__buildTestSessionsApp` builder (used by `routes.test.ts`)
  // wouldn't have the bus and the routes' `app.wsBroadcast.emit(...)`
  // call would throw. Refinement:
  // tasks/refinements/backend/ws_event_broadcast.md.
  await app.register(wsBroadcastPlugin);

  // Ensure `app.wsSubscriptions` + `app.wsConnectionSenders` are
  // decorated so the `PATCH /sessions/:id/privacy` handler can call
  // `pruneSubscribersForPrivateSession(...)` after the privacy
  // UPDATE lands. Both plugins are `fastify-plugin`-wrapped and
  // idempotent against re-registration; production registers them
  // via `wsConnectionHandlingPlugin` (which composes the whole WS
  // surface), and the test surface (`__buildTestSessionsApp`) reaches
  // the same decorators through this registration. Closes
  // `docs/security/m3-review/coverage.md` G-001. Refinement:
  //   tasks/refinements/backend-hardening/privacy_flip_subscription_prune.md.
  await app.register(wsSubscriptionsPlugin);
  await app.register(wsConnectionSendersPlugin);

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

  // Register the `SessionParticipantResponse` schema once per Fastify
  // instance — same idempotence pattern. Both participant-assignment
  // endpoints (`POST /sessions/:id/participants` and
  // `DELETE /sessions/:id/participants/:userId`) reference it via
  // `sessionParticipantResponseRef`; OpenAPI carries a single
  // `components.schemas.SessionParticipantResponse` entry.
  if (app.getSchema(SESSION_PARTICIPANT_RESPONSE_SCHEMA_ID) === undefined) {
    app.addSchema(sessionParticipantResponseSchema);
  }

  // Register the `EntityInclusionResponse` schema once per Fastify
  // instance — same idempotence pattern. The inclusion endpoint
  // (`POST /sessions/:id/include`) references it via
  // `entityInclusionResponseRef`; OpenAPI carries a single
  // `components.schemas.EntityInclusionResponse` entry. Refinement:
  // tasks/refinements/backend/entity_inclusion_endpoint.md.
  if (app.getSchema(ENTITY_INCLUSION_RESPONSE_SCHEMA_ID) === undefined) {
    app.addSchema(entityInclusionResponseSchema);
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
    '/api/sessions',
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
      const hostScreenName = auth.screenName;

      const body = request.body as { topic: string; privacy?: 'public' | 'private' };
      const topic = body.topic;
      const privacy: 'public' | 'private' = body.privacy ?? 'public';

      // Events appended inside the transaction. Emitted to the WS
      // broadcast bus AFTER the transaction commits (the post-commit-
      // emit invariant — emitting before commit risks a subscriber
      // observing a frame for an event the DB later rolls back).
      const appendedEvents: Event[] = [];

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

        // 3. Insert the event row via the centralized
        //    `appendSessionEvent` helper — single SQL surface across
        //    every event-append site (per
        //    tasks/refinements/backend/ws_event_broadcast.md). The
        //    returned event is collected for the post-COMMIT WS
        //    broadcast emit.
        appendedEvents.push(await appendSessionEvent(client, envelope));

        // 4. Implicit-moderator join (Option A per
        //    `tasks/refinements/backend/participant_assignment.md`).
        //    The host is structurally the moderator of the session for
        //    its v1 lifetime; emitting the join here means the
        //    methodology engine's `currentParticipants(projection)`
        //    sees a non-empty set on every active session from the
        //    moment after this transaction commits. INSERT the
        //    `session_participants` row; the DB fills `id`,
        //    `joined_at`, `left_at` (NULL). RETURNING surfaces the
        //    `joined_at` for the event payload so the row and the
        //    event share a single canonical timestamp.
        const participantInsert = await client.query<{
          id: string;
          joined_at: Date | string;
        }>(
          `INSERT INTO session_participants (session_id, user_id, role)
           VALUES ($1, $2, 'moderator')
           RETURNING id, joined_at`,
          [row.id, hostUserId],
        );
        const participantRow = participantInsert.rows[0];
        if (participantRow === undefined) {
          // Defensive — RETURNING surfaces every inserted row, and
          // the INSERT itself can only fail by violating a constraint
          // (which would have surfaced as a query-level throw). A
          // surfaced 500 here means a wiring regression.
          throw new ApiError(500, 'internal-error', 'session_participants insert returned no row');
        }
        const joinedAtIso = toIsoString(participantRow.joined_at);

        // 5. Build the `participant-joined` envelope for the host at
        //    sequence=2 (the second event of the freshly-created
        //    session; `session-created` sits at sequence=1). The
        //    `actor` is the host (they "joined themselves" by
        //    creating the session). The payload mirrors
        //    `participantJoinedPayloadSchema` from shared-types
        //    verbatim — same snake_case discipline as `session-
        //    created`. `screen_name` comes from
        //    `request.authUser.screenName` which the auth middleware
        //    populated alongside the user id; no extra round trip.
        const joinEventId = randomUUID();
        const joinEventCreatedAtIso = new Date(nowFn()).toISOString();
        const joinEnvelope = {
          id: joinEventId,
          sessionId: row.id,
          sequence: 2,
          kind: 'participant-joined' as const,
          actor: hostUserId,
          payload: {
            user_id: hostUserId,
            role: 'moderator' as const,
            screen_name: hostScreenName,
            joined_at: joinedAtIso,
          },
          createdAt: joinEventCreatedAtIso,
        };
        validateEvent(joinEnvelope);
        appendedEvents.push(await appendSessionEvent(client, joinEnvelope));

        return row;
      });

      // Post-commit broadcast emit (per
      // tasks/refinements/backend/ws_event_broadcast.md). The
      // transaction has COMMITted; every collected event is a durable
      // row. Emitting now means subscribers see the broadcast AFTER
      // the DB write is final — never for a row that gets rolled back.
      // The bus dispatches synchronously and the broadcast subscriber
      // iterates `app.wsSubscriptions.connectionsForSession(...)` to
      // fan out the `event-applied` envelope.
      for (const evt of appendedEvents) {
        app.wsBroadcast.emit({ event: evt });
      }

      // 201 Created — the row is the new resource; the response body
      // carries the full camelCase shape so the client doesn't need a
      // follow-up GET.
      return reply.code(201).send(sessionRowToResponse(created));
    },
  );

  app.get(
    '/api/sessions',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['sessions'],
        summary: 'List the sessions visible to the authenticated caller',
        description:
          'Returns the sessions the caller is permitted to see, ordered ' +
          '`created_at` DESC. Visibility (per `docs/architecture.md`): public ' +
          'sessions are visible to every authenticated user; private sessions ' +
          'are visible only to the host or a current/past participant. The ' +
          'visibility gate is the canonical baseline; the query-string filters ' +
          'below narrow WITHIN it.\n\n' +
          'Filters (all optional, AND-composed):\n' +
          '  • `?status=active|ended` — lifecycle filter (`ended_at IS NULL` / ' +
          '`IS NOT NULL`).\n' +
          '  • `?host=<userId>` — sessions hosted by the given user id.\n' +
          '  • `?participant=<userId>` — sessions where the given user is or ' +
          'was a participant.\n' +
          '  • `?privacy=public|private` — narrow to a single privacy bucket.\n' +
          '  • `?topic=<substring>` — case-insensitive substring match against ' +
          'the topic column (ILIKE for v1; full-text-search is a future task).\n' +
          '  • `?limit=<n>` (default 50, max 200) and `?offset=<n>` (default 0) ' +
          'drive offset-based pagination.\n\n' +
          'The response is `{ sessions: SessionResponse[]; total: integer }` — ' +
          '`total` is the count of matches AFTER visibility + filters but ' +
          'BEFORE limit/offset, so paged UIs can render "showing 1-50 of N".\n\n' +
          'Returns 401 `auth-required` when no valid session cookie is present; ' +
          '400 `validation-failed` when the query string is malformed (e.g. a ' +
          'bad UUID on `host`/`participant`, an unrecognised `status` or ' +
          '`privacy`, out-of-range `limit`/`offset`, or an unknown query key).',
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
      // narrowed-cast captures the validated shape. Integer
      // coercion is enabled (ajv default in Fastify) so
      // `?limit=10` arrives as the number `10`; the schema's
      // `default` populates `limit` and `offset` when absent.
      const query = request.query as {
        status?: 'active' | 'ended';
        host?: string;
        participant?: string;
        privacy?: 'public' | 'private';
        topic?: string;
        limit?: number;
        offset?: number;
      };
      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;

      // Build the composed WHERE clause + the parameter array
      // incrementally. The pattern:
      //
      //   1. The visibility gate is always present and uses `$1`
      //      (the caller's user id).
      //   2. Each conditional filter appends a fragment AND a value;
      //      the positional placeholder counter `p` tracks the next
      //      `$N`. ALL user-controlled values flow via parameters —
      //      enum values are validated at the schema layer and the
      //      WHERE fragments use hard-coded literals (`'active'` /
      //      `'ended'`). The `topic` substring is wrapped in `%...%`
      //      and passed as a parameter — ILIKE evaluates the
      //      pattern, so the `%` wildcards remain wildcards while
      //      the captured substring stays a value, not SQL.
      //
      // The visibility gate's `EXISTS` (rather than a JOIN + DISTINCT)
      // avoids row-duplication when a user has multiple historical
      // participant rows for the same session (leave-and-rejoin →
      // multiple rows per the participants-table refinement's F5
      // decision). Past participants (`left_at IS NOT NULL`) remain
      // visible — once you've seen a session you've seen it, and
      // hiding it post-leave would surprise users and complicate
      // replay/audit flows.
      const params: unknown[] = [userId];
      let p = 1;
      // Visibility gate — public OR host OR (current/historical)
      // participant. The canonical rule lives in
      // `apps/server/src/sessions/visibility.ts` (one source of
      // truth across the five session-management endpoints that
      // read `sessions.privacy`). The fragment is parameterized at
      // `$1` here because `userId` is the only param so far; the
      // filter compositions below bump `p` and append their own
      // `$N` placeholders onto the same params array.
      let where = visibilityWhereFragment(p);

      if (query.status === 'active') {
        where += ' AND ended_at IS NULL';
      } else if (query.status === 'ended') {
        where += ' AND ended_at IS NOT NULL';
      }

      if (query.host !== undefined) {
        p += 1;
        params.push(query.host);
        where += ` AND host_user_id = $${String(p)}`;
      }

      if (query.participant !== undefined) {
        p += 1;
        params.push(query.participant);
        // Same `EXISTS` shape as the visibility gate's participant
        // branch — historical rows count, and a participant with
        // multiple (leave-and-rejoin) rows doesn't duplicate the
        // parent session row.
        where +=
          ` AND EXISTS (SELECT 1 FROM session_participants sp2` +
          ` WHERE sp2.session_id = sessions.id AND sp2.user_id = $${String(p)})`;
      }

      if (query.privacy !== undefined) {
        p += 1;
        params.push(query.privacy);
        where += ` AND privacy = $${String(p)}`;
      }

      if (query.topic !== undefined) {
        p += 1;
        // The `%...%` pattern is the parameter value — Postgres'
        // ILIKE evaluates the wildcards at query time. The captured
        // user substring is a value, not SQL; quoting / injection
        // hazards are isolated by the placeholder boundary.
        params.push(`%${query.topic}%`);
        where += ` AND topic ILIKE $${String(p)}`;
      }

      // The `total` query: same WHERE, no ORDER / LIMIT / OFFSET.
      // Snapshot the params shape BEFORE we append the pagination
      // placeholders so the COUNT(*) reuses the same array.
      const countParams = params.slice();

      // Append the limit + offset placeholders LAST — the page
      // query uses them; the count query does not.
      p += 1;
      params.push(limit);
      const limitPlaceholder = p;
      p += 1;
      params.push(offset);
      const offsetPlaceholder = p;

      const pool = ensurePool();

      // Two parallel queries: the page (rows + order + limit/offset)
      // and the total count. We issue them sequentially against the
      // same pool — Promise.all would marginally cut latency but the
      // two queries against the same connection-pool entry are
      // already cheap, and sequential is easier to reason about
      // under the pglite single-handle test path. READ COMMITTED is
      // fine; the two queries see the same snapshot up to
      // microseconds, and a concurrent INSERT that lands between
      // the two SELECTs would at worst inflate `total` by 1 — a
      // benign off-by-one for paging UI, not a correctness bug.
      const pageResult = await pool.query<SessionsInsertRow>(
        `SELECT id, host_user_id, privacy, topic, created_at, ended_at
         FROM sessions
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${String(limitPlaceholder)} OFFSET $${String(offsetPlaceholder)}`,
        params,
      );

      const countResult = await pool.query<{ total: number | string }>(
        `SELECT COUNT(*)::int AS total
         FROM sessions
         WHERE ${where}`,
        countParams,
      );

      // `COUNT(*)::int` returns an integer to the driver. The pg
      // driver surfaces ints as JS number; pglite mirrors that. We
      // coerce defensively (a string-typed bigint would surface
      // here if the cast were removed) — same defensive pattern as
      // the `MAX(sequence)` reader in the end-session handler.
      const rawTotal = countResult.rows[0]?.total ?? 0;
      const total = typeof rawTotal === 'string' ? Number.parseInt(rawTotal, 10) : rawTotal;

      // Map each snake_case row to the camelCase response shape via
      // the same helper the create endpoint uses; the wrapper carries
      // both the sliced page AND the total match count per the
      // `SessionListResponse` contract.
      return reply.code(200).send({
        sessions: pageResult.rows.map(sessionRowToResponse),
        total,
      });
    },
  );

  app.get(
    '/api/sessions/:id',
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
           AND ${visibilityWhereFragment(2)}`,
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
    '/api/sessions/:id/end',
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

      // Events appended inside the transaction. Emitted to the WS
      // broadcast bus after COMMIT (post-commit-emit invariant — see
      // tasks/refinements/backend/ws_event_broadcast.md).
      const appendedEvents: Event[] = [];

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
             AND ${visibilityWhereFragment(2)}
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

        // 7. INSERT the event row via the centralized
        //    `appendSessionEvent` helper. The appended event is
        //    collected for the post-COMMIT WS broadcast emit.
        appendedEvents.push(await appendSessionEvent(client, envelope));

        return updated;
      });

      // Post-commit broadcast emit (see
      // tasks/refinements/backend/ws_event_broadcast.md).
      for (const evt of appendedEvents) {
        app.wsBroadcast.emit({ event: evt });
      }

      return reply.code(200).send(sessionRowToResponse(updatedRow));
    },
  );

  app.patch(
    '/api/sessions/:id/privacy',
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
           AND ${visibilityWhereFragment(2)}`,
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

      // 5. Subscription prune (closes
      //    `docs/security/m3-review/coverage.md` G-001). When the
      //    new privacy is `'private'`, walk the WS subscription
      //    registry for `sessionId` and evict any subscriber whose
      //    authenticated user can no longer see the session. The
      //    helper sends each evicted subscriber a server-initiated
      //    `unsubscribed` envelope with
      //    `payload.reason = 'privacy-flipped'` and removes the
      //    registry entry so subsequent broadcasts don't reach them.
      //    Participants are NEVER pruned (the visibility predicate
      //    admits the host + every current-or-past participant
      //    regardless of privacy). A flip to `'public'` is a no-op
      //    for pruning — visibility widens, nobody loses access.
      //    Per-connection error isolation is owned by the helper;
      //    the prune cannot block / fail this response (the UPDATE
      //    has already committed; the privacy bit IS the new
      //    value). Refinement:
      //      tasks/refinements/backend-hardening/privacy_flip_subscription_prune.md.
      if (desiredPrivacy === 'private') {
        await pruneSubscribersForPrivateSession({
          subscriptions: app.wsSubscriptions,
          connectionSenders: app.wsConnectionSenders,
          pool,
          sessionId,
          log: request.log,
        });
      }

      return reply.code(200).send(sessionRowToResponse(updated));
    },
  );

  // ----------------------------------------------------------------
  // POST /sessions/:id/participants — host-only debater assignment.
  // ----------------------------------------------------------------
  //
  // The host invites a user into the session as a debater (`debater-A`
  // or `debater-B`). The `moderator` role is bound to the host at
  // session creation (per Option A — see
  // `tasks/refinements/backend/participant_assignment.md`); the body
  // schema's enum rejects `'moderator'` with 400 before the handler
  // even runs.
  //
  // The transaction:
  //   1. Visibility-gated SELECT ... FOR UPDATE on `sessions` (mirrors
  //      the end-session endpoint's WHERE clause).
  //   2. Authority: caller must equal `host_user_id` else 403.
  //   3. Lifecycle: session must not be ended else 409.
  //   4. Resolve the body's userId to a `users` row (existence +
  //      screen_name in one query). Zero rows → 404 `user-not-found`.
  //   5. Check the role isn't already filled (partial unique index
  //      `(session_id, role) WHERE left_at IS NULL`). Filled → 409
  //      `role-already-filled`.
  //   6. Check the user isn't already an active participant (partial
  //      unique index `(session_id, user_id) WHERE left_at IS NULL`).
  //      Active → 409 `user-already-joined`.
  //   7. INSERT the `session_participants` row RETURNING the full row
  //      shape (so the response and event payload share one timestamp).
  //   8. MAX(sequence)+1 — application-managed monotonic allocator
  //      inside the transaction (ADR 0020).
  //   9. Build the `participant-joined` envelope, run `validateEvent`,
  //      INSERT the event row.
  //  10. COMMIT and return 200 + the camelCase participant row.
  app.post(
    '/api/sessions/:id/participants',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['sessions'],
        summary: 'Assign a debater participant to a session (host-only)',
        description:
          'Invites a user into the session as `debater-A` or `debater-B`. The host ' +
          '(the moderator at v1) is the only caller authorized to assign debaters. ' +
          'The moderator role is reserved for the session host and assigned ' +
          'implicitly at session creation — sending `role: "moderator"` here returns ' +
          '400 `validation-failed`. The handler INSERTs a `session_participants` ' +
          'row AND emits a `participant-joined` event into `session_events` at the ' +
          'next available sequence, in a single transaction.\n\n' +
          'Visibility-then-authority-then-state ordering: invisible private sessions ' +
          'return 404 `not-found` BEFORE any authority check (existence-non-leak). ' +
          'Visible-but-not-host returns 403 `not-a-moderator`. An ended session ' +
          'returns 409 `session-already-ended`. An unknown userId returns 404 ' +
          '`user-not-found`. A role already filled returns 409 `role-already-filled`. ' +
          'A user already holding an active role returns 409 `user-already-joined`.\n\n' +
          'Returns 401 `auth-required` when no valid session cookie is present.',
        security: [{ cookieAuth: [] }],
        params: sessionIdParamsSchema,
        body: assignParticipantBodySchema,
        response: {
          200: sessionParticipantResponseRef,
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
      const callerUserId = auth.id;

      const params = request.params as { id: string };
      const sessionId = params.id;
      const body = request.body as {
        userId: string;
        role: 'debater-A' | 'debater-B';
      };
      const targetUserId = body.userId;
      const targetRole = body.role;

      // Events appended inside the transaction. Emitted to the WS
      // broadcast bus after COMMIT (post-commit-emit invariant — see
      // tasks/refinements/backend/ws_event_broadcast.md).
      const appendedEvents: Event[] = [];

      const inserted = await withTransaction(ensurePool(), async (client) => {
        // 1. Visibility-gated SELECT ... FOR UPDATE — same predicate
        //    `POST /sessions/:id/end` uses. The FOR UPDATE row lock
        //    serialises concurrent assignment attempts on the same
        //    session and the same role slot; without it, two
        //    transactions could both pass the role-availability check
        //    and only the partial-unique-index would catch the
        //    duplicate at INSERT time (correct but noisier).
        const lookup = await client.query<{
          id: string;
          host_user_id: string;
          ended_at: Date | string | null;
        }>(
          `SELECT id, host_user_id, ended_at
           FROM sessions
           WHERE id = $1
             AND ${visibilityWhereFragment(2)}
           FOR UPDATE`,
          [sessionId, callerUserId],
        );
        const existing = lookup.rows[0];
        if (existing === undefined) {
          // Zero rows — either the id doesn't exist OR it does but
          // isn't visible to this caller. Both collapse into 404 so
          // the response doesn't leak the existence of private
          // sessions (mirrors `get_session_endpoint`'s 404-not-403
          // decision).
          throw ApiError.notFound('session not found or not visible');
        }

        // 2. Authority — only the host may assign participants. The
        //    host IS the moderator at v1; `not-a-moderator` is the
        //    canonical 403 code used across the session-management
        //    surface for this failure mode.
        if (existing.host_user_id !== callerUserId) {
          throw new ApiError(
            403,
            'not-a-moderator',
            'only the session host may assign participants',
          );
        }

        // 3. Lifecycle — an ended session cannot accept new
        //    participants. Reuses `session-already-ended` for
        //    vocabulary consistency with the end / privacy endpoints.
        if (existing.ended_at !== null) {
          throw new ApiError(
            409,
            'session-already-ended',
            'cannot assign participants to an ended session',
          );
        }

        // 4. Resolve the body's userId to a non-deleted users row.
        //    Pulls `screen_name` in the same query so step 9's
        //    `participant-joined` payload (which carries
        //    `screen_name` per shared-types) doesn't need a second
        //    round trip.
        const userLookup = await client.query<{
          id: string;
          screen_name: string;
        }>(
          `SELECT id, screen_name
           FROM users
           WHERE id = $1
             AND deleted_at IS NULL`,
          [targetUserId],
        );
        const targetUser = userLookup.rows[0];
        if (targetUser === undefined) {
          throw new ApiError(404, 'user-not-found', 'no user matches the supplied userId');
        }

        // 5. Role-availability check — partial unique index
        //    `session_participants_active_role_idx` covers
        //    `(session_id, role) WHERE left_at IS NULL`. We pre-check
        //    here for a typed 409; the index would also catch a race,
        //    but the pre-check produces the canonical error envelope
        //    rather than a raw integrity-violation 5xx.
        const roleCheck = await client.query<{ id: string }>(
          `SELECT id
           FROM session_participants
           WHERE session_id = $1 AND role = $2 AND left_at IS NULL
           LIMIT 1`,
          [sessionId, targetRole],
        );
        if (roleCheck.rows.length > 0) {
          throw new ApiError(
            409,
            'role-already-filled',
            `role '${targetRole}' is already filled in this session`,
          );
        }

        // 6. User-availability check — partial unique index
        //    `session_participants_active_user_idx` covers
        //    `(session_id, user_id) WHERE left_at IS NULL`. Same
        //    pre-check rationale as the role check above.
        const userCheck = await client.query<{ id: string }>(
          `SELECT id
           FROM session_participants
           WHERE session_id = $1 AND user_id = $2 AND left_at IS NULL
           LIMIT 1`,
          [sessionId, targetUserId],
        );
        if (userCheck.rows.length > 0) {
          throw new ApiError(
            409,
            'user-already-joined',
            'user is already an active participant in this session',
          );
        }

        // 7. INSERT the new `session_participants` row. The DB fills
        //    `id` (gen_random_uuid()), `joined_at` (NOW()) and
        //    `left_at` (NULL). RETURNING surfaces the whole row so
        //    the response and event payload share a single source of
        //    truth.
        const participantInsert = await client.query<SessionParticipantsRow>(
          `INSERT INTO session_participants (session_id, user_id, role)
           VALUES ($1, $2, $3)
           RETURNING id, session_id, user_id, role, joined_at, left_at`,
          [sessionId, targetUserId, targetRole],
        );
        const participantRow = participantInsert.rows[0];
        if (participantRow === undefined) {
          throw new ApiError(500, 'internal-error', 'session_participants insert returned no row');
        }
        const joinedAtIso = toIsoString(participantRow.joined_at);

        // 8. MAX(sequence)+1 inside the transaction (ADR 0020). The
        //    UNIQUE (session_id, sequence) constraint is the safety
        //    net for concurrent appenders; the FOR UPDATE row lock
        //    earlier in the transaction is the primary serialisation
        //    mechanism for the session-management surface.
        const maxRes = await client.query<{ max_seq: number | string | null }>(
          `SELECT COALESCE(MAX(sequence), 0) AS max_seq
           FROM session_events
           WHERE session_id = $1`,
          [sessionId],
        );
        const rawMax = maxRes.rows[0]?.max_seq ?? 0;
        const maxSeq = typeof rawMax === 'string' ? Number.parseInt(rawMax, 10) : rawMax;
        const nextSeq = maxSeq + 1;

        // 9. Build the `participant-joined` envelope, run
        //    `validateEvent`, INSERT. `actor` is the caller (the host)
        //    — they initiated the assignment; the joined user is the
        //    subject (payload.user_id) but not the actor.
        const eventId = randomUUID();
        const eventCreatedAtIso = new Date(nowFn()).toISOString();
        const envelope = {
          id: eventId,
          sessionId,
          sequence: nextSeq,
          kind: 'participant-joined' as const,
          actor: callerUserId,
          payload: {
            user_id: targetUserId,
            role: targetRole,
            screen_name: targetUser.screen_name,
            joined_at: joinedAtIso,
          },
          createdAt: eventCreatedAtIso,
        };
        validateEvent(envelope);
        // INSERT via centralized helper + collect for post-COMMIT
        // broadcast emit.
        appendedEvents.push(await appendSessionEvent(client, envelope));

        return participantRow;
      });

      // Post-commit broadcast emit (see
      // tasks/refinements/backend/ws_event_broadcast.md).
      for (const evt of appendedEvents) {
        app.wsBroadcast.emit({ event: evt });
      }

      return reply.code(200).send(participantRowToResponse(inserted));
    },
  );

  // ----------------------------------------------------------------
  // DELETE /sessions/:id/participants/:userId — remove a participant.
  // ----------------------------------------------------------------
  //
  // Authority: the session host OR the participant themselves. The
  // moderator (the host at v1) cannot be removed via this endpoint —
  // the host owns the session for its lifetime. Removal is a soft
  // operation: the row's `left_at` flips from NULL to NOW(); a future
  // re-join INSERTs a fresh row (F5).
  //
  // The transaction:
  //   1. Visibility-gated SELECT ... FOR UPDATE on `sessions`.
  //   2. Authority: caller is host OR caller === :userId else 403.
  //   3. Lifecycle: session must not be ended else 409.
  //   4. Find the active `session_participants` row for `(session_id,
  //      user_id) WHERE left_at IS NULL`. Zero rows → 404.
  //   5. Block moderator removal: role='moderator' → 403
  //      `cannot-remove-moderator`.
  //   6. UPDATE `left_at = NOW()` RETURNING the full row (so the
  //      response and event share one canonical timestamp).
  //   7. MAX(sequence)+1 — application-managed monotonic allocator.
  //   8. Build the `participant-left` envelope, run `validateEvent`,
  //      INSERT.
  //   9. COMMIT and return 200 + the camelCase participant row.
  app.delete(
    '/api/sessions/:id/participants/:userId',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['sessions'],
        summary: 'Remove a participant from a session (host or self)',
        description:
          'Marks the participant as left by setting `left_at = NOW()` and emitting ' +
          'a `participant-left` event into `session_events` at the next available ' +
          'sequence — both writes are atomic (single transaction). The row stays for ' +
          'replay/history. Either the session host or the participant themselves may ' +
          'remove the participant; the moderator (the host at v1) cannot be removed ' +
          'via this endpoint.\n\n' +
          'Visibility-then-authority-then-state ordering: invisible private sessions ' +
          'return 404 `not-found` BEFORE any authority check. A caller who is neither ' +
          'host nor the participant themselves returns 403 `not-a-moderator`. An ended ' +
          'session returns 409 `session-already-ended`. A user who is not currently ' +
          'a participant returns 404 `not-found`. Attempting to remove the moderator ' +
          'returns 403 `cannot-remove-moderator`.\n\n' +
          'Returns 401 `auth-required` when no valid session cookie is present.',
        security: [{ cookieAuth: [] }],
        params: sessionParticipantParamsSchema,
        response: {
          200: sessionParticipantResponseRef,
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
      const callerUserId = auth.id;

      const params = request.params as { id: string; userId: string };
      const sessionId = params.id;
      const targetUserId = params.userId;

      // Events appended inside the transaction. Emitted to the WS
      // broadcast bus after COMMIT (post-commit-emit invariant — see
      // tasks/refinements/backend/ws_event_broadcast.md).
      const appendedEvents: Event[] = [];

      const updated = await withTransaction(ensurePool(), async (client) => {
        // 1. Visibility-gated SELECT ... FOR UPDATE — same predicate
        //    every session-management endpoint uses.
        const lookup = await client.query<{
          id: string;
          host_user_id: string;
          ended_at: Date | string | null;
        }>(
          `SELECT id, host_user_id, ended_at
           FROM sessions
           WHERE id = $1
             AND ${visibilityWhereFragment(2)}
           FOR UPDATE`,
          [sessionId, callerUserId],
        );
        const existing = lookup.rows[0];
        if (existing === undefined) {
          throw ApiError.notFound('session not found or not visible');
        }

        // 2. Authority — host OR the participant themselves. Anyone
        //    else gets 403 `not-a-moderator` (the host IS the
        //    moderator at v1; the code stays stable across the
        //    session-management surface).
        const isHost = existing.host_user_id === callerUserId;
        const isSelf = callerUserId === targetUserId;
        if (!isHost && !isSelf) {
          throw new ApiError(
            403,
            'not-a-moderator',
            'only the session host or the participant themselves may remove a participant',
          );
        }

        // 3. Lifecycle — an ended session is closed to participant
        //    state changes; reuses `session-already-ended`.
        if (existing.ended_at !== null) {
          throw new ApiError(
            409,
            'session-already-ended',
            'cannot remove participants from an ended session',
          );
        }

        // 4. Find the active participant row. Zero rows → 404 (the
        //    user isn't currently in the session; identical-shape
        //    response to the unknown-session case). The query keys on
        //    (session_id, user_id) WHERE left_at IS NULL — the
        //    same predicate the partial unique index enforces, so
        //    at most one row can match.
        const activeRow = await client.query<SessionParticipantsRow>(
          `SELECT id, session_id, user_id, role, joined_at, left_at
           FROM session_participants
           WHERE session_id = $1 AND user_id = $2 AND left_at IS NULL
           LIMIT 1`,
          [sessionId, targetUserId],
        );
        const participant = activeRow.rows[0];
        if (participant === undefined) {
          throw ApiError.notFound('participant is not currently in the session');
        }

        // 5. Block moderator removal. The host owns the session for
        //    its v1 lifetime; the participants-DELETE endpoint can't
        //    eject them. Same vocabulary as
        //    `tasks/refinements/backend/participant_assignment.md` —
        //    403 `cannot-remove-moderator` (authority failure).
        if (participant.role === 'moderator') {
          throw new ApiError(
            403,
            'cannot-remove-moderator',
            'the moderator cannot be removed via this endpoint',
          );
        }

        // 6. UPDATE `left_at = NOW()`. RETURNING surfaces the full
        //    row in the same shape `participantRowToResponse` and the
        //    `participant-left` payload consume.
        const updateRes = await client.query<SessionParticipantsRow>(
          `UPDATE session_participants
           SET left_at = NOW()
           WHERE id = $1
           RETURNING id, session_id, user_id, role, joined_at, left_at`,
          [participant.id],
        );
        const updatedRow = updateRes.rows[0];
        if (updatedRow === undefined || updatedRow.left_at === null) {
          throw new ApiError(
            500,
            'internal-error',
            'session_participants UPDATE returned no row or null left_at',
          );
        }
        const leftAtIso = toIsoString(updatedRow.left_at);

        // 7. MAX(sequence)+1 inside the transaction. Same pattern as
        //    `POST /sessions/:id/end`.
        const maxRes = await client.query<{ max_seq: number | string | null }>(
          `SELECT COALESCE(MAX(sequence), 0) AS max_seq
           FROM session_events
           WHERE session_id = $1`,
          [sessionId],
        );
        const rawMax = maxRes.rows[0]?.max_seq ?? 0;
        const maxSeq = typeof rawMax === 'string' ? Number.parseInt(rawMax, 10) : rawMax;
        const nextSeq = maxSeq + 1;

        // 8. Build the `participant-left` envelope, run
        //    `validateEvent`, INSERT. `actor` is the caller (host or
        //    the participant themselves); the subject is in the
        //    payload's `user_id`.
        const eventId = randomUUID();
        const eventCreatedAtIso = new Date(nowFn()).toISOString();
        const envelope = {
          id: eventId,
          sessionId,
          sequence: nextSeq,
          kind: 'participant-left' as const,
          actor: callerUserId,
          payload: {
            user_id: targetUserId,
            left_at: leftAtIso,
          },
          createdAt: eventCreatedAtIso,
        };
        validateEvent(envelope);
        // INSERT via centralized helper + collect for post-COMMIT
        // broadcast emit.
        appendedEvents.push(await appendSessionEvent(client, envelope));

        return updatedRow;
      });

      // Post-commit broadcast emit (see
      // tasks/refinements/backend/ws_event_broadcast.md).
      for (const evt of appendedEvents) {
        app.wsBroadcast.emit({ event: evt });
      }

      return reply.code(200).send(participantRowToResponse(updated));
    },
  );

  // ----------------------------------------------------------------
  // POST /sessions/:id/include — bring an existing global entity into
  // the destination session.
  // ----------------------------------------------------------------
  //
  // Refinement: tasks/refinements/backend/entity_inclusion_endpoint.md.
  //
  // The endpoint composes the two predicates the previous cross-session-
  // permissions siblings landed:
  //
  //   - **Destination-side**: visibility-gated `SELECT ... FOR UPDATE`
  //     on `sessions` (same predicate every session-management endpoint
  //     uses) → active-participant SELECT against `session_participants`
  //     → lifecycle gate (`ended_at IS NULL`).
  //   - **Source-side**: `canReference<Kind>(client, entityId, callerId)`
  //     per the validated `entityKind` enum. The predicate runs INSIDE
  //     the transaction (with the same client the FOR UPDATE acquired)
  //     so the source-side snapshot is consistent with the destination-
  //     side snapshot — no TOCTOU race between an origin session going
  //     private and the inclusion landing.
  //
  // The transaction:
  //
  //   1. Visibility-gated SELECT ... FOR UPDATE on the destination
  //      `sessions` row (existence-non-leak: 404 on invisible).
  //   2. Active-participant check: 403 `not-a-participant` if the
  //      caller isn't currently in the destination session.
  //   3. Lifecycle gate: 409 `session-already-ended` if `ended_at` is
  //      set.
  //   4. Source-side reachability: `canReference<Kind>` per the
  //      validated `entityKind`. False → 403
  //      `entity-not-referenceable`.
  //   5. `INSERT INTO session_<kind>s ... ON CONFLICT DO NOTHING
  //      RETURNING ...` against the matching join table. `rowCount ===
  //      0` → 409 `entity-already-included` (the composite PK's
  //      conflict surface collapses the race between concurrent
  //      inclusion attempts on the same `(session_id, entity_id)` pair
  //      into a deterministic outcome).
  //   6. `MAX(sequence)+1` inside the transaction (ADR 0020). The FOR
  //      UPDATE row lock on the destination session is the primary
  //      serialisation; the `UNIQUE (session_id, sequence)` constraint
  //      is the second-line guard.
  //   7. Build the `entity-included` envelope, run `validateEvent`,
  //      INSERT the event row.
  //   8. COMMIT.
  //
  // The handler returns 200 + `{ entityKind, entityId, sessionId,
  // includedBy, includedAt }` — the join-table's `included_at` from
  // RETURNING is the canonical inclusion timestamp (the event's
  // `created_at` is a microsecond-later audit-trail value; the
  // join-table value is what UIs / projections care about).
  //
  // **`entityKind` → join-table dispatch table.** The validated
  // `entityKind` enum picks the join-table name + entity-id column +
  // reference predicate at handler-entry time. Every value is a
  // hard-coded literal (no user input ever reaches the SQL text); the
  // entity id and the caller id flow through positional `$N`
  // parameters.
  app.post(
    '/api/sessions/:id/include',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['sessions'],
        summary: 'Include an existing global entity into a session',
        description:
          'Brings an existing global entity (node, edge, or annotation) into the ' +
          'destination session — INSERTs the matching `session_<kind>s` row AND emits ' +
          'an `entity-included` event into `session_events` at the next available ' +
          'sequence, atomically in a single transaction.\n\n' +
          'Composes the two cross-session-permission predicates: the caller must be an ' +
          'active participant of the destination session (otherwise 403 ' +
          '`not-a-participant`), and the source entity must be referenceable by the ' +
          'caller via at least one visible origin session (otherwise 403 ' +
          '`entity-not-referenceable`). Visibility-then-participant-then-lifecycle-then-' +
          'reference-then-uniqueness ordering: invisible private destinations return 404 ' +
          '`not-found` BEFORE any other check (existence-non-leak). An ended destination ' +
          'returns 409 `session-already-ended`. An entity already in the destination ' +
          'returns 409 `entity-already-included` (caught via composite-PK conflict on ' +
          'the join table).\n\n' +
          'Returns 401 `auth-required` when no valid session cookie is present; 400 ' +
          '`validation-failed` when the path `:id` or the body is malformed.',
        security: [{ cookieAuth: [] }],
        params: sessionIdParamsSchema,
        body: includeEntityBodySchema,
        response: {
          200: entityInclusionResponseRef,
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      // Auth middleware guarantees `authUser` is set on every request
      // that reaches a route with `preHandler: app.authenticate`; the
      // defensive 500 here is unreachable under normal wiring.
      const auth = request.authUser;
      if (auth === undefined) {
        throw new ApiError(
          500,
          'internal-error',
          'auth middleware did not populate request.authUser',
        );
      }
      const callerUserId = auth.id;

      const params = request.params as { id: string };
      const destinationSessionId = params.id;
      const body = request.body as {
        entityKind: 'node' | 'edge' | 'annotation';
        entityId: string;
      };
      const entityKind = body.entityKind;
      const entityId = body.entityId;

      // Dispatch table — pick the join-table name, the entity-id
      // column name, and the per-kind reference predicate from the
      // validated `entityKind` enum. Each branch's values are
      // hard-coded literals; no user input ever flows into the SQL
      // text. The handler treats the three kinds symmetrically from
      // this point on (single transactional code path; the kind only
      // influences which strings get interpolated and which
      // predicate runs).
      const dispatch = {
        node: {
          joinTable: 'session_nodes',
          entityIdColumn: 'node_id',
          canReference: canReferenceNode,
        },
        edge: {
          joinTable: 'session_edges',
          entityIdColumn: 'edge_id',
          canReference: canReferenceEdge,
        },
        annotation: {
          joinTable: 'session_annotations',
          entityIdColumn: 'annotation_id',
          canReference: canReferenceAnnotation,
        },
      }[entityKind];

      interface InclusionInsertRow extends Record<string, unknown> {
        readonly session_id: string;
        // The entity-id column name varies by kind; we don't model
        // it as a typed field on the row interface because the
        // handler reads it back through the validated `entityId`
        // (the INSERT echoed it; the RETURNING value matches the
        // input). The destructure below uses the column name from
        // the dispatch table to satisfy TS without per-kind row
        // types.
        readonly included_by: string;
        readonly included_at: Date | string;
      }

      // Events appended inside the transaction. Emitted to the WS
      // broadcast bus after COMMIT (post-commit-emit invariant — see
      // tasks/refinements/backend/ws_event_broadcast.md).
      const appendedEvents: Event[] = [];

      const inclusion = await withTransaction(ensurePool(), async (client) => {
        // 1. Destination visibility — SELECT ... FOR UPDATE.
        //    Mirrors the predicate every session-management endpoint
        //    uses. The FOR UPDATE row lock on the destination
        //    session serialises concurrent inclusion attempts (same
        //    primary serialisation mechanism as the participant-
        //    assignment endpoint).
        const lookup = await client.query<{
          id: string;
          host_user_id: string;
          ended_at: Date | string | null;
        }>(
          `SELECT id, host_user_id, ended_at
           FROM sessions
           WHERE id = $1
             AND ${visibilityWhereFragment(2)}
           FOR UPDATE`,
          [destinationSessionId, callerUserId],
        );
        const destination = lookup.rows[0];
        if (destination === undefined) {
          // Existence-non-leak: zero rows whether the destination
          // doesn't exist or exists-but-isn't-visible. 404 either
          // way. Mirrors `get_session_endpoint`'s 404-not-403
          // decision.
          throw ApiError.notFound('session not found or not visible');
        }

        // 2. Active-participant check. The visibility predicate
        //    permits past participants (read-once-seen semantics);
        //    write authority requires CURRENT participation
        //    (`left_at IS NULL`). The host auto-joined as moderator
        //    at session-creation (per the participant-assignment
        //    Option-A amendment) always satisfies this; debaters
        //    assigned via `POST /sessions/:id/participants` also
        //    satisfy this until they leave. A stranger who can SEE
        //    a public session but isn't a participant fails here
        //    with 403 `not-a-participant`.
        const activeRow = await client.query<{ id: string }>(
          `SELECT id
           FROM session_participants
           WHERE session_id = $1 AND user_id = $2 AND left_at IS NULL
           LIMIT 1`,
          [destinationSessionId, callerUserId],
        );
        if (activeRow.rows.length === 0) {
          throw new ApiError(
            403,
            'not-a-participant',
            'only an active participant of the destination session may include an entity',
          );
        }

        // 3. Lifecycle gate — an ended session is closed to new
        //    inclusions. Reuses `session-already-ended` for
        //    vocabulary consistency with the end / privacy /
        //    participant-assignment endpoints.
        if (destination.ended_at !== null) {
          throw new ApiError(
            409,
            'session-already-ended',
            'cannot include entities into an ended session',
          );
        }

        // 4. Source-side reachability — does the caller have at
        //    least one visible origin session for this entity? The
        //    predicate runs against the SAME transaction client so
        //    the source snapshot is consistent with the destination
        //    snapshot. False → 403 `entity-not-referenceable`.
        const reachable = await dispatch.canReference(client, entityId, callerUserId);
        if (!reachable) {
          throw new ApiError(
            403,
            'entity-not-referenceable',
            'caller cannot reference this entity (no visible origin session)',
          );
        }

        // 5. INSERT into the matching `session_<kind>s` table with
        //    ON CONFLICT DO NOTHING. The composite PK on
        //    `(session_id, <entity>_id)` collapses concurrent-
        //    inclusion races into a deterministic "rowCount === 0"
        //    outcome. RETURNING surfaces the row's `included_at`
        //    timestamp (server-managed via the column DEFAULT
        //    NOW()) so the response and the event payload share a
        //    single source of truth.
        const inclusionInsert = await client.query<InclusionInsertRow>(
          `INSERT INTO ${dispatch.joinTable} (session_id, ${dispatch.entityIdColumn}, included_by)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING
           RETURNING session_id, ${dispatch.entityIdColumn}, included_by, included_at`,
          [destinationSessionId, entityId, callerUserId],
        );
        const inclusionRow = inclusionInsert.rows[0];
        if (inclusionRow === undefined) {
          // ON CONFLICT DO NOTHING produced zero rows — the
          // `(session_id, entity_id)` pair already exists in the
          // join table. Surface as 409 `entity-already-included`
          // (typed code; consistent with the "no silent no-ops"
          // pattern the other session-management endpoints follow).
          throw new ApiError(
            409,
            'entity-already-included',
            'entity is already included in this session',
          );
        }
        const includedAtIso = toIsoString(inclusionRow.included_at);

        // 6. MAX(sequence)+1 inside the transaction (ADR 0020).
        //    Same allocator pattern as the end-session / participant-
        //    assignment endpoints; the FOR UPDATE on the destination
        //    session row serialises concurrent inclusion attempts
        //    and the UNIQUE (session_id, sequence) constraint is the
        //    second-line guard.
        const maxRes = await client.query<{ max_seq: number | string | null }>(
          `SELECT COALESCE(MAX(sequence), 0) AS max_seq
           FROM session_events
           WHERE session_id = $1`,
          [destinationSessionId],
        );
        const rawMax = maxRes.rows[0]?.max_seq ?? 0;
        const maxSeq = typeof rawMax === 'string' ? Number.parseInt(rawMax, 10) : rawMax;
        const nextSeq = maxSeq + 1;

        // 7. Build the `entity-included` event envelope, run
        //    `validateEvent`, INSERT. The payload's `included_at`
        //    is the join-table value from RETURNING (same source of
        //    truth as the response body); `included_by` is the
        //    caller; `actor` on the envelope is also the caller.
        const eventId = randomUUID();
        const eventCreatedAtIso = new Date(nowFn()).toISOString();
        const envelope = {
          id: eventId,
          sessionId: destinationSessionId,
          sequence: nextSeq,
          kind: 'entity-included' as const,
          actor: callerUserId,
          payload: {
            entity_kind: entityKind,
            entity_id: entityId,
            included_by: callerUserId,
            included_at: includedAtIso,
          },
          createdAt: eventCreatedAtIso,
        };
        validateEvent(envelope);
        // INSERT via centralized helper + collect for post-COMMIT
        // broadcast emit.
        appendedEvents.push(await appendSessionEvent(client, envelope));

        return {
          sessionId: destinationSessionId,
          includedBy: callerUserId,
          includedAt: includedAtIso,
        };
      });

      // Post-commit broadcast emit (see
      // tasks/refinements/backend/ws_event_broadcast.md).
      for (const evt of appendedEvents) {
        app.wsBroadcast.emit({ event: evt });
      }

      return reply.code(200).send({
        entityKind,
        entityId,
        sessionId: inclusion.sessionId,
        includedBy: inclusion.includedBy,
        includedAt: inclusion.includedAt,
      });
    },
  );

  // The plugin body's `await app.register(wsBroadcastPlugin)` makes
  // this async; the rest of the body runs synchronously (`app.post(...)`
  // returns the FastifyInstance, not a Promise) but the `async` keyword
  // satisfies the `FastifyPluginAsync` Promise<void> return contract.
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
