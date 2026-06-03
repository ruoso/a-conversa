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
import { readSessionEventsPage } from '../events/read.js';
import { canSeeSession } from '../sessions/visibility.js';

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
      preHandler: app.authenticate,
      schema: {
        tags: ['events'],
        summary: "Fetch a session's persisted event log (paginated, replay order)",
        description:
          'Returns the session`s persisted event log as a forward, sequence-ordered, ' +
          'cursor-paginated stream — the raw events themselves, in replay order, so a ' +
          'client can feed them through the replay primitive. This is distinct from ' +
          '`GET /sessions/:id/state?position=...`, which returns projected state at a ' +
          'log position.\n\n' +
          'Visibility is exactly the session`s own: public sessions are visible to every ' +
          'authenticated user; private sessions only to the host or a current/past ' +
          'participant. When the session does not exist OR exists but is invisible to the ' +
          'caller, the server returns 404 `not-found` — the two cases are deliberately ' +
          'indistinguishable to avoid leaking the existence of private sessions.\n\n' +
          'Paginate with `?after=<sequence>` (exclusive cursor) and `?limit` (default ' +
          '100, max 1000). The response carries `nextCursor` — the sequence to pass as ' +
          'the next `?after`, or `null` at the head of the log. An empty page (a ' +
          'brand-new session, or a cursor past the head) is 200 with ' +
          '`{ events: [], nextCursor: null }`, not 404.\n\n' +
          'Returns 401 `auth-required` when no valid session cookie is present; 400 ' +
          '`validation-failed` when `:id` is not a UUID or `after`/`limit` are out of range.',
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
      // existence-leak rule). Reuses `canSeeSession` verbatim — the
      // events of a session are exactly as visible as the session itself.
      if (!(await canSeeSession(pool, sessionId, userId))) {
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
