// Fastify plugin registering the replay-family HTTP endpoints. The
// first sibling is `GET /sessions/:id/events` — the raw-log read
// surface: an authenticated user GETs a session's persisted event log
// as a forward, sequence-ordered, cursor-paginated stream, gated by the
// same visibility predicate the session-metadata endpoints apply.
//
// Refinement: tasks/refinements/backend/get_session_log.md
// TaskJuggler: backend.replay_endpoints.get_session_log
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
//
// **Why a dedicated plugin (not an extension of `sessions/routes.ts`).**
// Three more replay endpoints follow in this same `.tji` block
// (`get_at_position`, `list_snapshots`, `get_snapshot`); giving the
// family its own home avoids further bloating the already-large
// sessions plugin. The replay family is a distinct concern (history /
// replay vs. session lifecycle). The plugin imports `canSeeSession` for
// the gate — the visibility decision stays owned by
// `sessions/visibility.ts`; this plugin merely consumes it.
//
// **This endpoint returns events, not projected state.** It is
// deliberately distinct from the sibling `get_at_position`
// (`GET /sessions/:id/state?position=...`), which returns projected
// state. The log is the source of truth; projection is a derived view
// computed elsewhere. A client (the test-mode loader, a replay
// scrubber, an audit tool) loads the log via this endpoint and feeds it
// through the replay primitive itself.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { ApiError } from '../errors.js';
import { errorEnvelopeRef } from '../openapi.js';
import { getDefaultPool, type DbPool } from '../db.js';
import {
  readSessionEventLog,
  readSessionEventsPage,
  readSessionSnapshots,
} from '../events/read.js';
import { projectAtPosition, ReplayPositionError } from '../projection/at-position.js';
import { computeAllDiagnostics } from '../diagnostics/index.js';
import { canReplaySessionAnonymously, canSeeSession } from '../sessions/visibility.js';
import { serializeProjectionForWire } from '../ws/handlers/index.js';

/**
 * Stable `$id` for the shared `EventEnvelope` schema — the wire-ready
 * event shape (`packages/shared-types/src/events.ts`'s `EventEnvelope`,
 * already camelCase). Declared as a top-level schema so future replay
 * endpoints that return events can `$ref` it rather than redeclare the
 * shape. `payload` is an open object (`additionalProperties: true`) —
 * the per-kind payload shape is owned by the `event_types` family and
 * validated on write; on read the envelope is returned unmodified.
 */
export const EVENT_ENVELOPE_SCHEMA_ID = 'EventEnvelope';

export const eventEnvelopeSchema = {
  $id: EVENT_ENVELOPE_SCHEMA_ID,
  type: 'object',
  required: ['id', 'sessionId', 'sequence', 'kind', 'actor', 'payload', 'createdAt'],
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      description: 'Surrogate event id (`session_events.id`).',
    },
    sessionId: {
      type: 'string',
      format: 'uuid',
      description: 'Owning session (`session_events.session_id`).',
    },
    sequence: {
      type: 'integer',
      minimum: 1,
      description:
        'Per-session monotonic sequence. The ordering authority for replay (the ' +
        'first real event is sequence 1); `createdAt` is audit metadata only.',
    },
    kind: {
      type: 'string',
      description:
        'Envelope-level event-kind discriminator (e.g. `session-created`, `proposal`, ' +
        '`vote`, `commit`). Proposals use a single `proposal` kind; the payload`s own ' +
        '`kind` field discriminates among proposal sub-kinds.',
    },
    actor: {
      type: ['string', 'null'],
      format: 'uuid',
      description:
        'Causing actor (`session_events.actor`). Nullable for future system-generated ' +
        'events; today every event carries a participant actor.',
    },
    payload: {
      type: 'object',
      additionalProperties: true,
      description:
        'Kind-specific payload. Returned unmodified; the per-kind shape is validated on ' +
        'write (ADR 0021) and trusted on read.',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      description: 'Server-clock insert time (ISO-8601). Audit metadata, not the ordering key.',
    },
  },
} as const;

/**
 * The `$ref` clients use to point at the shared `EventEnvelope` schema.
 * The string form targets Fastify's schema store; `@fastify/swagger`
 * resolves it into `components.schemas.EventEnvelope` via the
 * `refResolver` configured in `openapi.ts`.
 */
export const eventEnvelopeRef = { $ref: `${EVENT_ENVELOPE_SCHEMA_ID}#` } as const;

/**
 * Stable `$id` for the `SessionEventsResponse` wrapper — the shape
 * `GET /sessions/:id/events` returns: `{ events: EventEnvelope[],
 * nextCursor }`. Each array element is an `EventEnvelope`, referenced
 * via the shared `$ref` so the OpenAPI document carries a single
 * per-event definition.
 */
export const SESSION_EVENTS_RESPONSE_SCHEMA_ID = 'SessionEventsResponse';

export const sessionEventsResponseSchema = {
  $id: SESSION_EVENTS_RESPONSE_SCHEMA_ID,
  type: 'object',
  required: ['events', 'nextCursor'],
  additionalProperties: false,
  properties: {
    events: {
      type: 'array',
      description:
        'The page of events, ascending by `sequence` (replay order). A (possibly empty) ' +
        'page is a meaningful answer — an empty log slice is 200, not 404.',
      items: eventEnvelopeRef,
    },
    nextCursor: {
      type: ['integer', 'null'],
      minimum: 1,
      description:
        'The `sequence` to pass as `?after=` to fetch the next page, or `null` when this ' +
        'page reaches the head of the log. A client pages until `nextCursor` is `null`.',
    },
  },
} as const;

/** The `$ref` clients use to point at the `SessionEventsResponse` schema. */
export const sessionEventsResponseRef = {
  $ref: `${SESSION_EVENTS_RESPONSE_SCHEMA_ID}#`,
} as const;

/**
 * Stable `$id` for the shared `SnapshotRecord` schema — one snapshot
 * marker (a moderator-created labeled checkpoint). The camelCase shape
 * matches `projection/types.ts`'s `SnapshotRecord` (`snapshotId`,
 * `label`, `logPosition`, `createdAt`); the envelope-level event `id` is
 * deliberately omitted (internal identity, no consumer use). Declared as
 * a top-level schema so `get_snapshot` (the next sibling) can `$ref` it.
 */
export const SNAPSHOT_RECORD_SCHEMA_ID = 'SnapshotRecord';

export const snapshotRecordSchema = {
  $id: SNAPSHOT_RECORD_SCHEMA_ID,
  type: 'object',
  required: ['snapshotId', 'label', 'logPosition', 'createdAt'],
  additionalProperties: false,
  properties: {
    snapshotId: {
      type: 'string',
      format: 'uuid',
      description:
        'The snapshot`s canonical key (`payload.snapshot_id`). Distinct from the ' +
        'envelope event id; the jump-to-snapshot action keys on this. Labels carry no ' +
        'uniqueness guarantee, so this is the stable identifier.',
    },
    label: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description: 'The moderator-supplied chapter name (1–128 chars).',
    },
    logPosition: {
      type: 'integer',
      minimum: 1,
      description:
        'The `sequence` the marker points at. Equal to the snapshot event`s own ' +
        '`sequence` by construction, so listing by `logPosition` is chapter order.',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      description: 'Server-clock insert time (ISO-8601). Audit metadata, not the ordering key.',
    },
  },
} as const;

/** The `$ref` clients use to point at the shared `SnapshotRecord` schema. */
export const snapshotRecordRef = { $ref: `${SNAPSHOT_RECORD_SCHEMA_ID}#` } as const;

/**
 * Stable `$id` for the `SessionSnapshotsResponse` wrapper — the shape
 * `GET /sessions/:id/snapshots` returns: `{ snapshots: SnapshotRecord[] }`.
 * A wrapper object (rather than a bare array) matches the
 * `SessionEventsResponse` envelope style and leaves room for a future
 * `headPosition` field without a breaking shape change.
 */
export const SESSION_SNAPSHOTS_RESPONSE_SCHEMA_ID = 'SessionSnapshotsResponse';

export const sessionSnapshotsResponseSchema = {
  $id: SESSION_SNAPSHOTS_RESPONSE_SCHEMA_ID,
  type: 'object',
  required: ['snapshots'],
  additionalProperties: false,
  properties: {
    snapshots: {
      type: 'array',
      description:
        'All of the session`s snapshot markers, ascending by `logPosition` (chapter ' +
        'order). A session with no snapshots — the common case — returns `[]` with a ' +
        '200, not a 404.',
      items: snapshotRecordRef,
    },
  },
} as const;

/** The `$ref` clients use to point at the `SessionSnapshotsResponse` schema. */
export const sessionSnapshotsResponseRef = {
  $ref: `${SESSION_SNAPSHOTS_RESPONSE_SCHEMA_ID}#`,
} as const;

/**
 * Stable `$id` for the `SessionStateResponse` wrapper — the shape
 * `GET /sessions/:id/state` returns: `{ sessionId, sequence, projection }`.
 * Structurally identical (field names + structure) to the WS `snapshot`
 * payload (`snapshotStatePayloadSchema` in `packages/shared-types`), so a
 * consumer can reuse WS-snapshot handling code unchanged; the two are kept
 * parallel rather than literally shared because the WS schema is Zod in a
 * different validation system and this one feeds the OpenAPI generator.
 */
export const SESSION_STATE_RESPONSE_SCHEMA_ID = 'SessionStateResponse';

export const sessionStateResponseSchema = {
  $id: SESSION_STATE_RESPONSE_SCHEMA_ID,
  type: 'object',
  required: ['sessionId', 'sequence', 'projection'],
  additionalProperties: false,
  properties: {
    sessionId: {
      type: 'string',
      format: 'uuid',
      description: 'The session the projection describes.',
    },
    sequence: {
      type: 'integer',
      minimum: 0,
      description:
        'The log position the projection was replayed to — equal to the requested ' +
        '`position` and to `projection.lastAppliedSequence`. `0` is the empty baseline ' +
        '(pre-history); `N` is the state after the event whose `sequence === N`.',
    },
    projection: {
      // Opaque on purpose — an open object, for the same reason the WS
      // schema uses `z.unknown()`: the projection is built by a pure
      // function over schema-validated events (ADR 0021), so re-validating
      // its output is redundant and would couple the route to every facet
      // field. The serializer's unit tests pin the inner wire shape; this
      // schema keeps only the outer envelope honest.
      type: 'object',
      additionalProperties: true,
      description:
        'The materialized projection at `sequence`, with the in-memory `Projection` ' +
        'class`s Maps flattened to plain objects — byte-identical to the WS `snapshot` ' +
        'payload`s `projection` field (single source of truth: ' +
        '`serializeProjectionForWire`).',
    },
  },
} as const;

/** The `$ref` clients use to point at the `SessionStateResponse` schema. */
export const sessionStateResponseRef = {
  $ref: `${SESSION_STATE_RESPONSE_SCHEMA_ID}#`,
} as const;

/**
 * Stable `$id` for the `SessionDiagnosticsResponse` wrapper — the shape
 * `GET /sessions/:id/diagnostics` returns: `{ diagnostics: DiagnosticEntry[] }`.
 * The array elements are the bare `DiagnosticEntry` objects
 * `computeAllDiagnostics` returns verbatim — each a discriminated union
 * member keyed on a string `kind` plus its kind-specific node/edge ids.
 * They are deliberately NOT the WS `DiagnosticPayload` envelope (no
 * `status`/`severity`/`sequence` wrapper — those are live-head transition
 * concepts meaningless for a static positional snapshot; ADR 0044). The
 * shipped client `useDiagnosticsAtPosition` binds this contract: it
 * requires `Array.isArray(body.diagnostics)` and narrows each element on
 * its string `kind`.
 */
export const SESSION_DIAGNOSTICS_RESPONSE_SCHEMA_ID = 'SessionDiagnosticsResponse';

export const sessionDiagnosticsResponseSchema = {
  $id: SESSION_DIAGNOSTICS_RESPONSE_SCHEMA_ID,
  type: 'object',
  required: ['diagnostics'],
  additionalProperties: false,
  properties: {
    diagnostics: {
      // Opaque entries on purpose — for the same reason the state route
      // leaves `projection` open: the entries are built by pure detectors
      // over schema-validated events (ADR 0021), so re-validating their
      // internal shape would couple the route to every detector's field
      // set and duplicate the detectors' own unit coverage. This schema
      // keeps only the outer `{ diagnostics: [...] }` envelope honest; the
      // detectors' Vitest tests pin the per-entry shapes.
      type: 'array',
      items: { type: 'object', additionalProperties: true },
      description:
        'The structural diagnostics the methodology engine surfaces for the projected ' +
        'state at `position` — the wire-shaped `DiagnosticEntry` objects ' +
        '`computeAllDiagnostics` returns verbatim (cycles, contradictions, multi-warrants, ' +
        'dangling claims, coherency hints). Each element carries a string `kind` ' +
        'discriminant plus its kind-specific node/edge ids. An empty array is the valid ' +
        'clean state (e.g. `position = 0`, the empty baseline projection).',
    },
  },
} as const;

/** The `$ref` clients use to point at the `SessionDiagnosticsResponse` schema. */
export const sessionDiagnosticsResponseRef = {
  $ref: `${SESSION_DIAGNOSTICS_RESPONSE_SCHEMA_ID}#`,
} as const;

/**
 * Path-params schema for `:id`. A non-UUID `:id` is rejected with 400
 * `validation-failed` by the Fastify validator before the handler runs.
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
 * Path-params schema for `:id` + `:snapshotId`. Both are UUIDs — `:id`
 * names the session, `:snapshotId` the snapshot's canonical key
 * (`payload.snapshot_id`, not the label, which carries no uniqueness
 * guarantee). A non-UUID in either segment is rejected with 400
 * `validation-failed` by the Fastify validator before the handler runs.
 */
const sessionSnapshotParamsSchema = {
  type: 'object',
  required: ['id', 'snapshotId'],
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      description: 'The session id (UUID).',
    },
    snapshotId: {
      type: 'string',
      format: 'uuid',
      description: 'The snapshot`s canonical key (`payload.snapshot_id`, a UUID).',
    },
  },
} as const;

/**
 * Query-string schema. `after` is the exclusive lower bound on
 * `sequence` (absent → start of log); `limit` is the page size
 * (default 100, max 1000). Out-of-range values are rejected with 400
 * `validation-failed` by the Fastify validator.
 */
const sessionEventsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    after: {
      type: 'integer',
      minimum: 0,
      description:
        'Exclusive lower bound on `sequence`. Absent → treated as 0 (start of log; the ' +
        'first real event is sequence 1). Pass the previous page`s `nextCursor` to page ' +
        'forward.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 1000,
      default: 100,
      description: 'Page size. Defaults to 100; maximum 1000.',
    },
  },
} as const;

/**
 * Query-string schema for the snapshots list. v1 takes no query params
 * (snapshots are sparse — no pagination, no filter; see the refinement's
 * Decisions). `additionalProperties: false` with no properties rejects
 * any unknown query param with 400 `validation-failed`.
 */
const sessionSnapshotsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

/**
 * Query-string schema for the projected-state read. `position` is the
 * required event-sequence position to replay to; ajv coerces the query
 * string (`"5" → 5`). A missing, non-integer, or negative `position` is
 * rejected with 400 `validation-failed` by the validator. A position
 * above the log's head sequence passes the schema but is rejected at
 * replay time with a 400 (see the handler). `additionalProperties:
 * false` documents the single-axis contract; the route-scoped
 * `preValidation` hook is what actually rejects an unknown query key on
 * the wire (ajv's `removeAdditional` would otherwise strip it silently).
 */
const sessionStateQuerySchema = {
  type: 'object',
  required: ['position'],
  additionalProperties: false,
  properties: {
    position: {
      type: 'integer',
      minimum: 0,
      description:
        'The log position to project to (event-sequence space). `0` returns the empty ' +
        'baseline projection (pre-history); `N` returns the state after the event whose ' +
        '`sequence === N`. Required — there is no implicit "current state" default. A ' +
        'position above the log`s head sequence is rejected with 400 (out of range).',
    },
  },
} as const;

/**
 * Query-string schema for the diagnostics read. Identical single-axis
 * contract to the projected-state read: `position` is the required
 * event-sequence position to replay-then-detect at; ajv coerces the
 * query string (`"5" → 5`). A missing, non-integer, or negative
 * `position` is rejected with 400 `validation-failed` by the validator; a
 * position above the log's head sequence passes the schema but is
 * rejected at replay time (see the handler). `additionalProperties:
 * false` documents the single-axis contract; the route-scoped
 * `preValidation` hook is what actually rejects an unknown query key on
 * the wire (ajv's `removeAdditional` would otherwise strip it silently).
 */
const sessionDiagnosticsQuerySchema = {
  type: 'object',
  required: ['position'],
  additionalProperties: false,
  properties: {
    position: {
      type: 'integer',
      minimum: 0,
      description:
        'The log position to compute diagnostics at (event-sequence space). `0` returns ' +
        'the empty baseline projection`s diagnostics (`[]`); `N` returns the diagnostics ' +
        'for the state after the event whose `sequence === N`. Required — there is no ' +
        'implicit "current state" default. A position above the log`s head sequence is ' +
        'rejected with 400 (out of range).',
    },
  },
} as const;

/**
 * Options accepted by `replayRoutesPlugin`. Mirrors the sessions
 * plugin's pool-injection contract: production passes `{}` and the
 * plugin lazily resolves the default pool on the first request; tests
 * pass a memory shim (Vitest) or a pglite-backed adapter (Cucumber).
 */
export interface ReplayRoutesOptions {
  readonly pool?: DbPool;
}

/**
 * The plugin body. Wired onto the parent scope (via `fastify-plugin`'s
 * skip-override marker) so the routes appear in the generated OpenAPI
 * document, the auth-middleware decoration is visible at registration
 * time, and the error-handler plugin classifies thrown errors under the
 * canonical envelope.
 */
/* eslint-disable @typescript-eslint/require-await -- the body awaits nothing
   (all registration here is synchronous), but the codebase standardizes route
   plugins on `FastifyPluginAsync` (cf. `sessionsRoutesPluginAsync`, which
   genuinely awaits `app.register`); the `async` keyword satisfies the shared
   `Promise<void>` contract and keeps the two plugins type-identical. */
const replayRoutesPluginAsync: FastifyPluginAsync<ReplayRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  // Register the shared response schemas once per Fastify instance.
  // `addSchema` throws on a duplicate `$id` on the same instance, so we
  // guard with the schema-store getter (same idempotence pattern as
  // `sessions/routes.ts`).
  if (app.getSchema(EVENT_ENVELOPE_SCHEMA_ID) === undefined) {
    app.addSchema(eventEnvelopeSchema);
  }
  if (app.getSchema(SESSION_EVENTS_RESPONSE_SCHEMA_ID) === undefined) {
    app.addSchema(sessionEventsResponseSchema);
  }
  if (app.getSchema(SNAPSHOT_RECORD_SCHEMA_ID) === undefined) {
    app.addSchema(snapshotRecordSchema);
  }
  if (app.getSchema(SESSION_SNAPSHOTS_RESPONSE_SCHEMA_ID) === undefined) {
    app.addSchema(sessionSnapshotsResponseSchema);
  }
  if (app.getSchema(SESSION_STATE_RESPONSE_SCHEMA_ID) === undefined) {
    app.addSchema(sessionStateResponseSchema);
  }
  if (app.getSchema(SESSION_DIAGNOSTICS_RESPONSE_SCHEMA_ID) === undefined) {
    app.addSchema(sessionDiagnosticsResponseSchema);
  }

  // Lazy DB-pool resolution — the first request triggers
  // `getDefaultPool()`. Mirrors the sessions-plugin pattern.
  let resolvedPool: DbPool | undefined = opts.pool;
  const ensurePool = (): DbPool => {
    if (resolvedPool !== undefined) {
      return resolvedPool;
    }
    resolvedPool = getDefaultPool();
    return resolvedPool;
  };

  app.get(
    '/api/sessions/:id/events',
    {
      // Two auth postures on one route (ADR 0045, mirroring ADR 0029's
      // "one transport, two auth postures"). `optionalAuthenticate`
      // resolves a valid cookie to `request.authUser` and degrades a
      // missing/invalid cookie to anonymous WITHOUT 401-ing — the
      // handler branches on `request.authUser` below.
      preHandler: app.optionalAuthenticate,
      schema: {
        tags: ['events'],
        summary: "Fetch a session's persisted event log (paginated, replay order)",
        description:
          'Returns the session`s persisted event log as a forward, sequence-ordered, ' +
          'cursor-paginated stream — the raw events themselves, in replay order, so a ' +
          'client can feed them through the replay primitive. This is distinct from ' +
          '`GET /sessions/:id/state?position=...`, which returns projected state at a ' +
          'log position.\n\n' +
          'Serves two auth postures on one route (ADR 0045). An AUTHENTICATED caller ' +
          'sees exactly the session`s own visibility: public sessions are visible to ' +
          'every authenticated user; private sessions only to the host or a current/past ' +
          'participant. An ANONYMOUS caller (no cookie, or an invalid/expired cookie) may ' +
          "replay a public session — `privacy = 'public'`, ended or not, since replay is " +
          'inherently historical. When the session does not exist OR exists but is ' +
          'invisible to the caller, the server returns 404 `not-found` — the two cases are ' +
          'deliberately indistinguishable to avoid leaking the existence of private ' +
          'sessions (a private/absent session is 404 for an anonymous caller too).\n\n' +
          'Paginate with `?after=<sequence>` (exclusive cursor) and `?limit` (default ' +
          '100, max 1000). The response carries `nextCursor` — the sequence to pass as ' +
          'the next `?after`, or `null` at the head of the log. An empty page (a ' +
          'brand-new session, or a cursor past the head) is 200 with ' +
          '`{ events: [], nextCursor: null }`, not 404.\n\n' +
          'Returns 400 `validation-failed` when `:id` is not a UUID or `after`/`limit` ' +
          'are out of range. This endpoint does not 401 — an unauthenticated request is ' +
          'served the anonymous posture.',
        security: [{ cookieAuth: [] }],
        params: sessionIdParamsSchema,
        querystring: sessionEventsQuerySchema,
        response: {
          200: sessionEventsResponseRef,
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      // `optionalAuthenticate` either set `request.authUser` (a valid
      // cookie) or left it unset (no cookie / invalid cookie → anonymous).
      const auth = request.authUser;

      // Fastify's validator narrows params / query to the schema shapes.
      const params = request.params as { id: string };
      const sessionId = params.id;
      const query = request.query as { after?: number; limit?: number };
      const afterSequence = query.after ?? 0;
      const limit = query.limit ?? 100;

      const pool = ensurePool();

      // Visibility gate runs BEFORE the events read — an invisible
      // session never reaches the events query. Zero visibility → 404
      // (whether the id is unused or exists-but-invisible, per the
      // existence-leak rule).
      //
      // Two postures (ADR 0045):
      //   - Authenticated → `canSeeSession` (public OR host OR participant
      //     incl. historical) — the events of a session are exactly as
      //     visible as the session itself.
      //   - Anonymous → `canReplaySessionAnonymously` (public, ended or
      //     not). A private or nonexistent session is 404, indistinguishable
      //     from outside; a forged cookie lands here and is gated by the
      //     strict `privacy = 'public'` filter.
      const visible =
        auth === undefined
          ? await canReplaySessionAnonymously(pool, sessionId)
          : await canSeeSession(pool, sessionId, auth.id);
      if (!visible) {
        throw ApiError.notFound('session not found or not visible');
      }

      const page = await readSessionEventsPage(pool, {
        sessionId,
        afterSequence,
        limit,
      });

      return reply.code(200).send(page);
    },
  );

  app.get(
    '/api/sessions/:id/snapshots',
    {
      preHandler: app.authenticate,
      // v1 takes no query params. `schema.querystring` with
      // `additionalProperties: false` documents that in the OpenAPI doc,
      // but it does NOT reject an unknown param on the wire: Fastify's
      // default ajv runs `removeAdditional: true`, so an additional query
      // property is silently stripped (the request would otherwise reach
      // the handler and return 200). We rely on that strip-not-reject
      // behavior for request *bodies* elsewhere (see `sessions/routes.ts`),
      // so flipping the global ajv config is not an option. This
      // route-scoped `preValidation` hook closes the gap: it runs before
      // ajv strips the query, and rejects any present query param with the
      // same 400 `validation-failed` envelope ajv would have produced —
      // honoring the endpoint's "400 on an unknown query param" contract.
      preValidation: async (request) => {
        const queryKeys = Object.keys(request.query as Record<string, unknown>);
        if (queryKeys.length > 0) {
          throw new ApiError(400, 'validation-failed', 'Request validation failed', {
            issues: queryKeys.map((key) => ({
              keyword: 'additionalProperties',
              instancePath: '',
              schemaPath: '#/additionalProperties',
              params: { additionalProperty: key },
              message: 'must NOT have additional properties',
            })),
          });
        }
      },
      schema: {
        tags: ['replay'],
        summary: "List a session's snapshot markers (chapter order)",
        description:
          'Returns all of the session`s snapshot markers — the moderator-created labeled ' +
          'checkpoints — each as `{ snapshotId, label, logPosition, createdAt }`, ordered ' +
          'by `logPosition` ascending (chapter order). A snapshot is a regular event ' +
          '(`kind: snapshot-created`), not a separate table; this is a filtered read of ' +
          'those events, not a projection.\n\n' +
          'Visibility is exactly the session`s own: public sessions are visible to every ' +
          'authenticated user; private sessions only to the host or a current/past ' +
          'participant. When the session does not exist OR exists but is invisible to the ' +
          'caller, the server returns 404 `not-found` — the two cases are deliberately ' +
          'indistinguishable to avoid leaking the existence of private sessions.\n\n' +
          'A visible session with no snapshots (the common case) returns ' +
          '`{ snapshots: [] }` with a 200 — 404 is reserved for the session itself being ' +
          'absent or invisible. v1 returns the full set (snapshots are sparse); there is ' +
          'no pagination or query filter.\n\n' +
          'Returns 401 `auth-required` when no valid session cookie is present; 400 ' +
          '`validation-failed` when `:id` is not a UUID or an unknown query param is sent.',
        security: [{ cookieAuth: [] }],
        params: sessionIdParamsSchema,
        querystring: sessionSnapshotsQuerySchema,
        response: {
          200: sessionSnapshotsResponseRef,
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      // Defensive — the middleware guarantees `authUser` is set on every
      // request that reaches a handler with `preHandler: app.authenticate`.
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

      const pool = ensurePool();

      // Visibility gate runs BEFORE the snapshots read — an invisible
      // session never reaches the query. Zero visibility → 404 (whether
      // the id is unused or exists-but-invisible, per the existence-leak
      // rule). A session's snapshots are exactly as visible as the
      // session itself.
      if (!(await canSeeSession(pool, sessionId, userId))) {
        throw ApiError.notFound('session not found or not visible');
      }

      const snapshots = await readSessionSnapshots(pool, { sessionId });

      return reply.code(200).send({ snapshots });
    },
  );

  app.get(
    '/api/sessions/:id/snapshots/:snapshotId',
    {
      preHandler: app.authenticate,
      // Same strip-not-reject gap as the snapshots-list route: Fastify's
      // ajv runs `removeAdditional: true`, so an unknown query param is
      // silently stripped rather than rejected. This route-scoped
      // `preValidation` hook restores the 400 the no-query-string contract
      // requires — identical to the list route above.
      preValidation: async (request) => {
        const queryKeys = Object.keys(request.query as Record<string, unknown>);
        if (queryKeys.length > 0) {
          throw new ApiError(400, 'validation-failed', 'Request validation failed', {
            issues: queryKeys.map((key) => ({
              keyword: 'additionalProperties',
              instancePath: '',
              schemaPath: '#/additionalProperties',
              params: { additionalProperty: key },
              message: 'must NOT have additional properties',
            })),
          });
        }
      },
      schema: {
        tags: ['replay'],
        summary: 'Fetch one snapshot marker of a session by its snapshotId',
        description:
          'Returns a single snapshot marker — the moderator-created labeled checkpoint with ' +
          'the given `:snapshotId` — as `{ snapshotId, label, logPosition, createdAt }`. The ' +
          'marker is resolved by its canonical `snapshotId` (a UUID), NOT by its `label`: ' +
          'labels carry no uniqueness guarantee (a session may hold two snapshots both ' +
          'labeled the same), so `snapshotId` is the stable key. A snapshot is a regular ' +
          'event (`kind: snapshot-created`), not a separate table; this is a filtered read ' +
          'of those events plus an in-memory match on `snapshot_id`, not a projection.\n\n' +
          'Visibility is exactly the session`s own: public sessions are visible to every ' +
          'authenticated user; private sessions only to the host or a current/past ' +
          'participant. When the session does not exist OR exists but is invisible to the ' +
          'caller, the server returns 404 `not-found` — the two cases are deliberately ' +
          'indistinguishable to avoid leaking the existence of private sessions. Because the ' +
          'visibility gate runs first, a snapshot-not-found 404 (a visible session with no ' +
          'snapshot at `:snapshotId`) is reachable only after the session is confirmed ' +
          'visible, so it leaks nothing about a private session`s contents.\n\n' +
          'Returns 401 `auth-required` when no valid session cookie is present; 400 ' +
          '`validation-failed` when `:id` or `:snapshotId` is not a UUID or an unknown query ' +
          'param is sent.',
        security: [{ cookieAuth: [] }],
        params: sessionSnapshotParamsSchema,
        querystring: sessionSnapshotsQuerySchema,
        response: {
          200: snapshotRecordRef,
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      // Defensive — the middleware guarantees `authUser` is set on every
      // request that reaches a handler with `preHandler: app.authenticate`.
      const auth = request.authUser;
      if (auth === undefined) {
        throw new ApiError(
          500,
          'internal-error',
          'auth middleware did not populate request.authUser',
        );
      }
      const userId = auth.id;

      const params = request.params as { id: string; snapshotId: string };
      const sessionId = params.id;
      const { snapshotId } = params;

      const pool = ensurePool();

      // Visibility gate runs BEFORE the snapshots read — an invisible
      // session never reaches the query. Zero visibility → 404 (whether
      // the id is unused or exists-but-invisible, per the existence-leak
      // rule). A session's snapshots are exactly as visible as the
      // session itself.
      if (!(await canSeeSession(pool, sessionId, userId))) {
        throw ApiError.notFound('session not found or not visible');
      }

      // Snapshots are sparse (a handful per session); read the small
      // `(session_id, kind)`-bounded set and match `snapshotId` in memory.
      // No targeted single-row SQL — the JSON predicate is not indexed, so
      // it would scan the same rows for no cost win (Decisions §2). Reuses
      // the helper already covered by Vitest + Cucumber.
      const all = await readSessionSnapshots(pool, { sessionId });
      const record = all.find((r) => r.snapshotId === snapshotId);
      if (record === undefined) {
        // Reachable only after the session is confirmed visible, so this
        // distinct message leaks nothing about a private session.
        throw ApiError.notFound('snapshot not found');
      }

      return reply.code(200).send(record);
    },
  );

  app.get(
    '/api/sessions/:id/state',
    {
      preHandler: app.authenticate,
      // Only `position` is accepted. The schema's `additionalProperties:
      // false` documents that, but Fastify's ajv runs `removeAdditional:
      // true`, so an unknown query param is silently stripped rather than
      // rejected. This route-scoped `preValidation` hook restores the 400
      // the single-axis contract requires — same shape as the snapshot
      // routes, but it preserves `position` (the one accepted key).
      preValidation: async (request) => {
        const unknownKeys = Object.keys(request.query as Record<string, unknown>).filter(
          (key) => key !== 'position',
        );
        if (unknownKeys.length > 0) {
          throw new ApiError(400, 'validation-failed', 'Request validation failed', {
            issues: unknownKeys.map((key) => ({
              keyword: 'additionalProperties',
              instancePath: '',
              schemaPath: '#/additionalProperties',
              params: { additionalProperty: key },
              message: 'must NOT have additional properties',
            })),
          });
        }
      },
      schema: {
        tags: ['replay'],
        summary: "Fetch a session's projected state at a log position",
        description:
          'Returns the session`s materialized projection — the derived state — as it stood ' +
          'after applying every event up to and including log position `?position=N`. Where ' +
          '`GET /sessions/:id/events` returns the raw event log (the source of truth), this ' +
          'endpoint returns the projected view: a thin HTTP wrapper over the replay ' +
          'primitive (read the log, replay to `N`, serialize the `Projection`). The 200 body ' +
          '`{ sessionId, sequence, projection }` is byte-identical in field names and ' +
          'structure to the WS `snapshot` payload, so a consumer can reuse WS-snapshot ' +
          'handling code unchanged; `sequence === position === projection.lastAppliedSequence`.' +
          '\n\n' +
          'Position is event-sequence space: `position = 0` returns the empty baseline ' +
          'projection (pre-history — valid for any visible session, including a brand-new one ' +
          'with no events); `position = N` returns the state after the event whose ' +
          '`sequence === N`; `position = headSequence` returns the full-log projection. ' +
          '`position` is required (no implicit "current state" default).\n\n' +
          'Visibility is exactly the session`s own: public sessions are visible to every ' +
          'authenticated user; private sessions only to the host or a current/past ' +
          'participant. When the session does not exist OR exists but is invisible to the ' +
          'caller, the server returns 404 `not-found` — the two cases are deliberately ' +
          'indistinguishable to avoid leaking the existence of private sessions. The gate ' +
          'runs before the log read, so a private session never reaches the replay.\n\n' +
          'Returns 401 `auth-required` when no valid session cookie is present; 400 ' +
          '`validation-failed` when `:id` is not a UUID, `position` is missing / non-integer ' +
          '/ negative, an unknown query param is sent, or `position` is above the log`s head ' +
          'sequence (out of range — the 400 carries the valid `0..headSequence` range).',
        security: [{ cookieAuth: [] }],
        params: sessionIdParamsSchema,
        querystring: sessionStateQuerySchema,
        response: {
          200: sessionStateResponseRef,
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      // Defensive — the middleware guarantees `authUser` is set on every
      // request that reaches a handler with `preHandler: app.authenticate`.
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
      // ajv coerced the query string to an integer >= 0 (the schema's job);
      // an out-of-range position is still possible and is caught below.
      const query = request.query as { position: number };
      const { position } = query;

      const pool = ensurePool();

      // Visibility gate runs BEFORE the log read — an invisible session
      // never reaches the read or the replay. Zero visibility → 404
      // (whether the id is unused or exists-but-invisible, per the
      // existence-leak rule). A session's projected state is exactly as
      // visible as the session itself.
      if (!(await canSeeSession(pool, sessionId, userId))) {
        throw ApiError.notFound('session not found or not visible');
      }

      // Read the ENTIRE log ascending and hand it to the replay primitive.
      // The whole log (not just the prefix up to `position`) is required:
      // `projectAtPosition` validates `position` against the true head
      // sequence, so a truncated read would make an out-of-range position
      // indistinguishable from the head (refinement Decisions §2).
      const events = await readSessionEventLog(pool, { sessionId });
      try {
        const projection = projectAtPosition(events, sessionId, position);
        return reply.code(200).send({
          sessionId,
          sequence: position,
          projection: serializeProjectionForWire(projection),
        });
      } catch (err) {
        if (err instanceof ReplayPositionError) {
          // The position is outside the log's range — a client-input
          // error, not a server fault. Re-thrown as 400 carrying the valid
          // `0..headSequence` range the error already computed.
          throw new ApiError(400, 'validation-failed', err.message, {
            position: err.position,
            headSequence: err.headSequence,
          });
        }
        throw err;
      }
    },
  );

  app.get(
    '/api/sessions/:id/diagnostics',
    {
      preHandler: app.authenticate,
      // Only `position` is accepted. Same shape as the state route: the
      // schema's `additionalProperties: false` documents the single-axis
      // contract, but Fastify's ajv runs `removeAdditional: true` and would
      // silently strip an unknown query param, so this route-scoped
      // `preValidation` hook restores the 400 the contract requires while
      // preserving `position` (the one accepted key).
      preValidation: async (request) => {
        const unknownKeys = Object.keys(request.query as Record<string, unknown>).filter(
          (key) => key !== 'position',
        );
        if (unknownKeys.length > 0) {
          throw new ApiError(400, 'validation-failed', 'Request validation failed', {
            issues: unknownKeys.map((key) => ({
              keyword: 'additionalProperties',
              instancePath: '',
              schemaPath: '#/additionalProperties',
              params: { additionalProperty: key },
              message: 'must NOT have additional properties',
            })),
          });
        }
      },
      schema: {
        tags: ['replay'],
        summary: "Fetch a session's structural diagnostics at a log position",
        description:
          'Returns the structural diagnostics the methodology engine would surface for the ' +
          'session`s projected state at log position `?position=N` — the cycles, ' +
          'contradictions, multi-warrants, dangling claims, and coherency hints. It is the ' +
          'diagnostics-shaped sibling of `GET /sessions/:id/state`: a thin HTTP wrapper that ' +
          'reads the log, replays to `N` with the replay primitive, and runs the server`s ' +
          'detectors (`computeAllDiagnostics`) over the resulting projection. The detectors ' +
          'are the single source of truth — there is no client-side mirror (ADR 0044).' +
          '\n\n' +
          'The 200 body is `{ diagnostics: [...] }`: a JSON object with a single ' +
          '`diagnostics` array whose elements are the bare diagnostic entries (each a string ' +
          '`kind` discriminant plus its kind-specific node/edge ids). The entries are NOT the ' +
          'live WS `diagnostic` broadcast envelope — `status`/`severity`/`sequence` are ' +
          'live-head transition concepts meaningless for a static positional snapshot.' +
          '\n\n' +
          'Position is event-sequence space: `position = 0` returns the empty baseline ' +
          'projection`s diagnostics (`{ diagnostics: [] }` — valid for any visible session, ' +
          'including a brand-new one); `position = N` returns the diagnostics for the state ' +
          'after the event whose `sequence === N`; `position = headSequence` returns the ' +
          'full-log diagnostics. `position` is required (no implicit "current state" default).' +
          '\n\n' +
          'Visibility is exactly the session`s own: public sessions are visible to every ' +
          'authenticated user; private sessions only to the host or a current/past ' +
          'participant. When the session does not exist OR exists but is invisible to the ' +
          'caller, the server returns 404 `not-found` — the two cases are deliberately ' +
          'indistinguishable to avoid leaking the existence of private sessions. The gate ' +
          'runs before the log read, so a private session never reaches the replay.\n\n' +
          'Returns 401 `auth-required` when no valid session cookie is present; 400 ' +
          '`validation-failed` when `:id` is not a UUID, `position` is missing / non-integer ' +
          '/ negative, an unknown query param is sent, or `position` is above the log`s head ' +
          'sequence (out of range — the 400 carries the valid `0..headSequence` range).',
        security: [{ cookieAuth: [] }],
        params: sessionIdParamsSchema,
        querystring: sessionDiagnosticsQuerySchema,
        response: {
          200: sessionDiagnosticsResponseRef,
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      // Defensive — the middleware guarantees `authUser` is set on every
      // request that reaches a handler with `preHandler: app.authenticate`.
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
      // ajv coerced the query string to an integer >= 0 (the schema's job);
      // an out-of-range position is still possible and is caught below.
      const query = request.query as { position: number };
      const { position } = query;

      const pool = ensurePool();

      // Visibility gate runs BEFORE the log read — an invisible session
      // never reaches the read or the replay. Zero visibility → 404
      // (whether the id is unused or exists-but-invisible, per the
      // existence-leak rule). A session's diagnostics are exactly as
      // visible as the session itself.
      if (!(await canSeeSession(pool, sessionId, userId))) {
        throw ApiError.notFound('session not found or not visible');
      }

      // Read the ENTIRE log ascending and hand it to the replay primitive
      // (same rationale as the state route: the whole log lets
      // `projectAtPosition` validate `position` against the true head
      // sequence). Then run the detectors over the in-memory projection —
      // it is NOT serialized to the wire here (the detectors consume the
      // `Projection` class directly; only the diagnostics they yield cross
      // the wire — refinement Decisions §8).
      const events = await readSessionEventLog(pool, { sessionId });
      try {
        const projection = projectAtPosition(events, sessionId, position);
        const diagnostics = computeAllDiagnostics(projection);
        return reply.code(200).send({ diagnostics });
      } catch (err) {
        if (err instanceof ReplayPositionError) {
          // The position is outside the log's range — a client-input
          // error, not a server fault. Re-thrown as 400 carrying the valid
          // `0..headSequence` range the error already computed.
          throw new ApiError(400, 'validation-failed', err.message, {
            position: err.position,
            headSequence: err.headSequence,
          });
        }
        throw err;
      }
    },
  );
};
/* eslint-enable @typescript-eslint/require-await */

/**
 * The wrapped plugin. `fastify-plugin` adds `skip-override` so the
 * routes attach to the parent scope (visible to `@fastify/swagger` and
 * to the auth-middleware decoration). Named via the plugin metadata so
 * `app.printPlugins()` shows it under a stable label.
 */
export const replayRoutesPlugin = fp(replayRoutesPluginAsync, {
  name: 'a-conversa-replay-routes',
  fastify: '5.x',
});

/**
 * Test-only convenience — build a minimal Fastify instance with the
 * shared error-envelope schema, the error-handler plugin, the auth
 * middleware plugin, and the replay-routes plugin all wired. Mirrors
 * `__buildTestSessionsApp` (`sessions/routes.ts`); hides the `fastify`
 * import behind the workspace boundary so the test tsconfig can build
 * the integration app without an extra import path.
 *
 * Production code does NOT use this helper. Use `createServer()`
 * (in `server.ts`) which wires the full stack.
 *
 * @returns the configured Fastify instance, ready for `.inject(...)`.
 */
export async function __buildTestReplayApp(options: {
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
  const replayOpts: ReplayRoutesOptions = {
    ...(options.pool !== undefined ? { pool: options.pool } : {}),
  };
  await app.register(replayRoutesPlugin, replayOpts);
  await app.ready();
  return app;
}
