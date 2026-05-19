// Dispatcher handler for `vote` client → server messages.
//
// Refinement: tasks/refinements/backend/ws_vote_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_vote_message
//
// **What this module owns.**
//
// `buildVoteHandler({ pool, registry, broadcast, log, now? })` —
// returns a `WsDispatcher` handler for the `'vote'` envelope.
// Structurally mirrors `buildProposeHandler`: same gate stack, same
// transactional load-validate-append, same post-commit dual-signal
// (`event-applied` broadcast + `voted` ack), same `rejectedToApiError`
// mapping to the wire `error` envelope via the dispatcher's
// `onHandlerError` seam.
//
// The vote handler differs from propose in exactly three places:
//
//   1. The action it constructs — `MethodologyAction.vote` instead of
//      `MethodologyAction.propose`. The action carries
//      `proposalEventId`, `vote` (one of `'agree' | 'dispute' |
//      'withdraw'`), and `votedAt` instead of the proposal payload.
//   2. The engine call returns events keyed at `kind: 'vote'` (one
//      event per vote action, regardless of the arm).
//   3. The ack envelope type — `'voted'` instead of `'proposed'`.
//
// Everything else is identical and intentionally so: future sibling
// handlers (commit / meta / snapshot) follow the same shape and the
// four-way visual diff stays clean.
//
// **Voter identity comes from the connection, not the payload.** The
// handler reads `connection.user.id` and uses it as both the
// methodology requester AND the event actor. The request payload has
// NO `voterId` field (the wire schema `votePayloadSchema` does not
// declare one — symmetric with `proposePayloadSchema`'s lack of a
// `proposerId`). Even if a buggy or malicious client included an
// extra `voterId` key on the payload, the closed `z.object` strips
// unknown fields at parse time and the handler ignores them anyway.
// This is the security invariant pinned by the unit-test
// `even-when-the-client-tries-to-spoof-voterId` case.
//
// **Withdraw is a vote variant, not a separate message type.** The
// engine's `voteHandler` switches on `action.vote` for the three-arm
// matrix (`'agree'` / `'dispute'` / `'withdraw'`); the wire vocabulary
// extension is exactly two entries (`'vote'` + `'voted'`).
//
// **What this handler does NOT do.**
//
//   - Authentication: enforced by the upgrade-time gate
//     (`ws_auth_on_connect`); `connection.user` is non-undefined.
//   - Schema validation of `payload`: enforced upstream by
//     `parseWsEnvelope` against `votePayloadSchema`.
//   - Methodology-rule re-implementation: every rule lives in the
//     engine's `voteHandler` (see
//     `apps/server/src/methodology/handlers/vote.ts`).

import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Event, WsEnvelope } from '@a-conversa/shared-types';

import type { DbPool } from '../../db.js';
import { ApiError, rejectedToApiError } from '../../errors.js';
import { appendSessionEvent } from '../../events/append.js';
import { validateEvent } from '../../events/validate.js';
import { validateAction } from '../../methodology/engine.js';
import type { VoteAction } from '../../methodology/types.js';
import { projectFromLog } from '../../projection/replay.js';
import { canSeeSession } from '../../sessions/visibility.js';
import type { WsBroadcastBus } from '../broadcast/bus.js';
import type { WsConnectionContext } from '../connection.js';
import type { WsDispatcher } from '../dispatcher.js';
import { serializeWsEnvelope } from '../envelope.js';
import type { WsSubscriptionRegistry } from '../subscriptions.js';

/**
 * Per-row shape returned from `SELECT ... FROM session_events ORDER BY
 * sequence ASC`. Mirrors the `SessionEventRow` in `propose.ts`
 * (duplicated rather than imported to keep the handler self-contained;
 * if/when these helpers move to a shared module both call sites switch
 * atomically).
 */
interface SessionEventRow extends Record<string, unknown> {
  readonly id: string;
  readonly session_id: string;
  readonly sequence: number | string;
  readonly kind: string;
  readonly actor: string | null;
  readonly payload: Record<string, unknown>;
  readonly created_at: Date | string;
}

/**
 * Builder inputs — captured once at handler-registration time. Same
 * shape as `ProposeHandlerOptions`.
 */
export interface VoteHandlerOptions {
  /** DB pool the visibility predicate + transactional writes run against. */
  readonly pool: DbPool;
  /** Per-instance subscription registry — the subscribe-before-act gate. */
  readonly registry: WsSubscriptionRegistry;
  /** Per-instance broadcast bus — the post-commit `event-applied` emit. */
  readonly broadcast: WsBroadcastBus;
  /** Logger for diagnostics. */
  readonly log: FastifyBaseLogger;
  /**
   * Clock injection for the event envelope's `createdAt` field.
   * Defaulted to `Date.now` in production; tests pin a controllable
   * function so the payload is deterministic across runs.
   */
  readonly now?: () => number;
}

/**
 * Build the `vote` dispatcher handler. The returned closure captures
 * the pool / registry / broadcast / log / clock once; the dispatcher
 * invokes it per inbound `vote` envelope.
 */
export function buildVoteHandler(
  opts: VoteHandlerOptions,
): (envelope: WsEnvelope<'vote'>, connection: WsConnectionContext) => Promise<void> {
  const nowFn = opts.now ?? Date.now;
  return async (envelope, connection) => {
    const { sessionId, expectedSequence, proposalId, choice } = envelope.payload;
    const userId = connection.user?.id;
    if (userId === undefined) {
      // Anonymous client (per ADR 0029 + `aud_anonymous_ws_subscribe`).
      // Audience-role connections never write — reject with a wire
      // `forbidden` envelope so the client sees a typed code. The
      // dispatcher maps `ApiError.forbidden` to the canonical
      // `error` envelope with `inResponseTo: envelope.id`; the
      // connection stays open per `ws_error_message`.
      throw ApiError.forbidden('this action requires an authenticated session', { sessionId });
    }

    // Gate 1 — subscribe-before-act. Identical to the propose handler's
    // gate; the `'forbidden'` code is reused from the existing
    // `ApiError.code` taxonomy.
    const subscribers = opts.registry.connectionsForSession(sessionId);
    if (!subscribers.includes(connection.connectionId)) {
      throw ApiError.forbidden('not subscribed to this session — send a subscribe envelope first', {
        sessionId,
      });
    }

    // Gate 2 — visibility re-check. A session that became invisible
    // between the subscribe and this vote surfaces as not-found,
    // inheriting the existence-non-leak rule from `canSeeSession`.
    const visible = await canSeeSession(opts.pool, sessionId, userId);
    if (!visible) {
      throw ApiError.notFound('session not found or not visible', { sessionId });
    }

    // Transactional load-validate-append. Identical shape to the propose
    // handler: FOR UPDATE on the `sessions` row, MAX(sequence) read,
    // engine validation, schema-on-write `validateEvent`,
    // `appendSessionEvent`. Events appended inside the transaction are
    // collected for the post-COMMIT broadcast emit.
    const appendedEvents: Event[] = [];
    const voteEventId = await withTransaction(opts.pool, async (client) => {
      // 1. FOR UPDATE on `sessions` — serialises concurrent appenders.
      const lookup = await client.query<{ id: string; ended_at: Date | string | null }>(
        `SELECT id, ended_at
         FROM sessions
         WHERE id = $1
         FOR UPDATE`,
        [sessionId],
      );
      const existing = lookup.rows[0];
      if (existing === undefined) {
        throw ApiError.notFound('session not found or not visible', { sessionId });
      }

      // 2. Application-managed monotonic sequence allocator.
      const maxRes = await client.query<{ max_seq: number | string | null }>(
        `SELECT COALESCE(MAX(sequence), 0) AS max_seq
         FROM session_events
         WHERE session_id = $1`,
        [sessionId],
      );
      const rawMax = maxRes.rows[0]?.max_seq ?? 0;
      const maxSeq = typeof rawMax === 'string' ? Number.parseInt(rawMax, 10) : rawMax;
      const nextSeq = maxSeq + 1;

      // 3. Optimistic-concurrency check.
      if (expectedSequence !== maxSeq) {
        throw rejectedToApiError({
          ok: false,
          reason: 'sequence-mismatch',
          detail: `vote: expectedSequence=${String(expectedSequence)} does not match server MAX(sequence)=${String(maxSeq)} for session ${sessionId} — your view of the session is stale`,
        });
      }

      // 4. Load the session's event log + project (v1 replay-per-request).
      const logRes = await client.query<SessionEventRow>(
        `SELECT id, session_id, sequence, kind, actor, payload, created_at
         FROM session_events
         WHERE session_id = $1
         ORDER BY sequence ASC`,
        [sessionId],
      );
      const priorEvents: Event[] = logRes.rows.map(rowToEvent);
      const projection = projectFromLog(priorEvents, sessionId);

      // 5. Build the `MethodologyAction.vote` and run it through the
      //    engine. The voter identity comes from the AUTHENTICATED
      //    connection — never from the payload (security invariant; see
      //    refinement Decisions). `requester` (methodology gate) and
      //    `actor` (event column) both use `userId`. `votedAt` mirrors
      //    `createdAt` (single clock source; see refinement Decisions).
      const eventId = randomUUID();
      const createdAtIso = new Date(nowFn()).toISOString();
      const action: VoteAction = {
        kind: 'vote',
        requester: userId,
        sessionId,
        eventId,
        sequence: nextSeq,
        actor: userId,
        createdAt: createdAtIso,
        proposalEventId: proposalId,
        vote: choice,
        votedAt: createdAtIso,
      };
      const result = validateAction(projection, action);
      if (!result.ok) {
        throw rejectedToApiError(result);
      }
      if (result.events.length !== 1) {
        throw new Error(
          `ws-vote: engine produced ${String(result.events.length)} events (expected 1)`,
        );
      }
      const emitted = result.events[0]!;

      // 6. Schema-on-write — every row in `session_events` is
      //    structurally valid by construction (ADR 0021).
      validateEvent(emitted);

      // 7. INSERT via the centralized append helper.
      appendedEvents.push(await appendSessionEvent(client, emitted));

      return eventId;
    });

    // Post-commit emit + ack. Same ordering as the propose handler:
    // emit FIRST so every subscribed client (including the voter)
    // receives the `event-applied` envelope, THEN send the request-
    // correlated `voted` ack on the voter's socket.
    for (const evt of appendedEvents) {
      opts.broadcast.emit({ event: evt });
    }
    const ack: WsEnvelope<'voted'> = {
      type: 'voted',
      id: randomUUID(),
      inResponseTo: envelope.id,
      payload: {
        sessionId,
        sequence: appendedEvents[0]!.sequence,
        eventId: voteEventId,
      },
    };
    connection.socket.send(serializeWsEnvelope(ack));
  };
}

/**
 * Register the vote handler against the dispatcher. Called by
 * `wsHandlersPlugin` once at registration time. Mirror of
 * `registerProposeHandlers`.
 */
export function registerVoteHandlers(dispatcher: WsDispatcher, opts: VoteHandlerOptions): void {
  dispatcher.register('vote', buildVoteHandler(opts));
}

/**
 * Map a `session_events` row to the canonical `Event` envelope shape.
 * Mirrors the helper in `propose.ts`.
 */
function rowToEvent(row: SessionEventRow): Event {
  const seq = typeof row.sequence === 'string' ? Number.parseInt(row.sequence, 10) : row.sequence;
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return {
    id: row.id,
    sessionId: row.session_id,
    sequence: seq,
    kind: row.kind,
    actor: row.actor,
    payload: row.payload,
    createdAt,
  } as Event;
}

/**
 * Transaction-bound client surface. Mirrors `DbTxClient` in
 * `propose.ts` and `sessions/routes.ts` — duplicated here to keep the
 * handler module self-contained.
 */
interface DbTxClient {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: TRow[] }>;
  release?: () => void;
}

interface PoolWithConnect {
  connect(): Promise<DbTxClient>;
}

function hasConnect(pool: DbPool): pool is DbPool & PoolWithConnect {
  return typeof (pool as Partial<PoolWithConnect>).connect === 'function';
}

/**
 * Run `fn` inside a transaction. Mirrors `withTransaction` in
 * `propose.ts` — duplicated here for the same self-containment reason.
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
        // intentionally suppressed; original `err` is re-thrown.
      }
      throw err;
    } finally {
      if (client.release !== undefined) {
        client.release();
      }
    }
  }
  // Pool without `connect()` — issue BEGIN/COMMIT directly against
  // `pool.query` (pglite + memory shims).
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
      // intentionally suppressed; original `err` is re-thrown.
    }
    throw err;
  }
}
