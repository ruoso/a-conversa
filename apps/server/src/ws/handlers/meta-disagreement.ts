// Dispatcher handler for `mark-meta-disagreement` client → server
// messages.
//
// Refinement: tasks/refinements/backend/ws_meta_disagreement_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_meta_disagreement_message
//
// **What this module owns.**
//
// `buildMarkMetaDisagreementHandler({ pool, registry, broadcast, log,
// now? })` — returns a `WsDispatcher` handler for the
// `'mark-meta-disagreement'` envelope. Structurally mirrors
// `buildCommitHandler` + `buildVoteHandler` + `buildProposeHandler`:
// same gate stack, same transactional load-validate-append, same
// post-commit dual-signal (`event-applied` broadcast +
// `meta-disagreement-marked` ack), same `rejectedToApiError` mapping
// to the wire `error` envelope via the dispatcher's `onHandlerError`
// seam.
//
// The mark handler differs from commit in exactly three places:
//
//   1. The action it constructs — `MethodologyAction.markMetaDisagreement`
//      instead of `MethodologyAction.commit`. The action carries
//      `proposalEventId` + `markedAt` (mirrored from `createdAt`).
//   2. The engine call returns one `meta-disagreement-marked` event
//      (per `markMetaDisagreementHandler` in
//      `methodology/handlers/markMetaDisagreement.ts`).
//   3. The ack envelope type — `'meta-disagreement-marked'` instead
//      of `'committed'` / `'voted'` / `'proposed'`.
//
// Everything else is identical and intentionally so: the headline
// authority gate (moderator-only) is enforced by the engine's
// `not-a-moderator` rejection (rule 1 of
// `markMetaDisagreementHandler`), surfaced here via
// `rejectedToApiError` as the wire `error` envelope with
// `code: 'not-a-moderator'` — same path as commit.
//
// **What "marking as meta-disagreement" means.** Per
// `docs/methodology.md` lines 203–212: when the diagnostic tests and
// decomposition have failed to resolve a facet-level dispute about
// wording / classification / substance, the moderator declares the
// disagreement irreducible — the affected facet's status transitions
// to `meta-disagreement` (carrying both proposed values side by side)
// and the proposal moves from `pendingProposals` to
// `unresolvedMetaDisagreements`, terminating the proposal's life
// cycle with a typed not-decided outcome and allowing the debate to
// continue past the irresolvable point.
//
// **Moderator identity comes from the connection, not the payload.**
// The handler reads `connection.user.id` and uses it as both the
// methodology requester (the actor the engine checks against the
// moderator role) AND the event actor. The request payload has NO
// `moderatorId` field — the wire schema
// `wsMarkMetaDisagreementPayloadSchema` does not declare one.
// Symmetric with `propose` (no `proposerId`), `vote` (no `voterId`),
// and `commit` (no `moderatorId`). Pinned by the unit-test
// `even-when-the-client-tries-to-spoof-moderatorId` case.
//
// **Engine-emitted events.** The engine's
// `markMetaDisagreementHandler` emits exactly ONE event (a
// `meta-disagreement-marked` event) for a mark action today. The
// read-side projection's `handleMetaDisagreementMarked` (in
// `apps/server/src/projection/replay.ts`) is what transitions the
// affected facet to status `meta-disagreement` and moves the
// proposal from `pendingProposals` to `unresolvedMetaDisagreements` —
// but that runs on every subscriber's local incremental `applyEvent`
// against the broadcast `event-applied` frame; no additional wire
// frames are required.
//
// **What this handler does NOT do.**
//
//   - Authentication: enforced by the upgrade-time gate
//     (`ws_auth_on_connect`); `connection.user` is non-undefined.
//   - Schema validation of `payload`: enforced upstream by
//     `parseWsEnvelope` against `wsMarkMetaDisagreementPayloadSchema`.
//   - Methodology-rule re-implementation: every rule lives in the
//     engine's `markMetaDisagreementHandler` (see
//     `apps/server/src/methodology/handlers/markMetaDisagreement.ts`).

import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Event, WsEnvelope } from '@a-conversa/shared-types';

import type { DbPool } from '../../db.js';
import { ApiError, rejectedToApiError } from '../../errors.js';
import { appendSessionEvent } from '../../events/append.js';
import { validateEvent } from '../../events/validate.js';
import { validateAction } from '../../methodology/engine.js';
import type { MarkMetaDisagreementAction } from '../../methodology/types.js';
import { projectFromLog } from '../../projection/replay.js';
import { canSeeSession } from '../../sessions/visibility.js';
import type { WsBroadcastBus } from '../broadcast/bus.js';
import type { WsConnectionContext } from '../connection.js';
import type { WsDispatcher } from '../dispatcher.js';
import { serializeWsEnvelope } from '../envelope.js';
import type { WsSubscriptionRegistry } from '../subscriptions.js';

/**
 * Per-row shape returned from `SELECT ... FROM session_events ORDER BY
 * sequence ASC`. Mirrors the `SessionEventRow` in `propose.ts` /
 * `vote.ts` / `commit.ts` (duplicated rather than imported to keep
 * the handler self-contained; if/when these helpers move to a shared
 * module all call sites switch atomically).
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
 * shape as `CommitHandlerOptions` / `VoteHandlerOptions` /
 * `ProposeHandlerOptions`.
 */
export interface MarkMetaDisagreementHandlerOptions {
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
 * Build the `mark-meta-disagreement` dispatcher handler. The returned
 * closure captures the pool / registry / broadcast / log / clock
 * once; the dispatcher invokes it per inbound
 * `mark-meta-disagreement` envelope.
 */
export function buildMarkMetaDisagreementHandler(
  opts: MarkMetaDisagreementHandlerOptions,
): (
  envelope: WsEnvelope<'mark-meta-disagreement'>,
  connection: WsConnectionContext,
) => Promise<void> {
  const nowFn = opts.now ?? Date.now;
  return async (envelope, connection) => {
    const { sessionId, expectedSequence, proposalId } = envelope.payload;
    const userId = connection.user?.id;
    if (userId === undefined) {
      // The upgrade-time auth gate populates `connection.user`. Reaching
      // this branch means a wiring bug — surface as a generic 500-
      // equivalent via the dispatcher's `onHandlerError` no-leak fallback.
      throw new Error(
        'ws-mark-meta-disagreement: connection.user is undefined — auth gate bypassed',
      );
    }

    // Gate 1 — subscribe-before-act. Identical to the propose/vote/commit
    // handler's gate; the `'forbidden'` code is reused from the
    // existing `ApiError.code` taxonomy.
    const subscribers = opts.registry.connectionsForSession(sessionId);
    if (!subscribers.includes(connection.connectionId)) {
      throw ApiError.forbidden('not subscribed to this session — send a subscribe envelope first', {
        sessionId,
      });
    }

    // Gate 2 — visibility re-check. A session that became invisible
    // between the subscribe and this mark surfaces as not-found,
    // inheriting the existence-non-leak rule from `canSeeSession`.
    const visible = await canSeeSession(opts.pool, sessionId, userId);
    if (!visible) {
      throw ApiError.notFound('session not found or not visible', { sessionId });
    }

    // Transactional load-validate-append. Identical shape to the
    // propose/vote/commit handlers: FOR UPDATE on the `sessions` row,
    // MAX(sequence) read, engine validation, schema-on-write
    // `validateEvent`, `appendSessionEvent`. Events appended inside
    // the transaction are collected for the post-COMMIT broadcast emit.
    const appendedEvents: Event[] = [];
    const markEventId = await withTransaction(opts.pool, async (client) => {
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
          detail: `mark-meta-disagreement: expectedSequence=${String(expectedSequence)} does not match server MAX(sequence)=${String(maxSeq)} for session ${sessionId} — your view of the session is stale`,
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

      // 5. Build the `MethodologyAction.markMetaDisagreement` and run
      //    it through the engine. The moderator identity comes from
      //    the AUTHENTICATED connection — never from the payload
      //    (security invariant; see refinement Decisions).
      //    `requester` (methodology gate — this is the user the
      //    engine's `requireModerator` check runs against) and
      //    `actor` (event column) both use `userId`. `markedAt`
      //    mirrors `createdAt` (single clock source).
      const eventId = randomUUID();
      const createdAtIso = new Date(nowFn()).toISOString();
      const action: MarkMetaDisagreementAction = {
        kind: 'mark-meta-disagreement',
        requester: userId,
        sessionId,
        eventId,
        sequence: nextSeq,
        actor: userId,
        createdAt: createdAtIso,
        proposalEventId: proposalId,
        markedAt: createdAtIso,
      };
      const result = validateAction(projection, action);
      if (!result.ok) {
        // The engine's `not-a-moderator` rejection (rule 1 of
        // `markMetaDisagreementHandler`) lands here for a non-
        // moderator subscribed participant; `rejectedToApiError`
        // maps it to a 403 with `code: 'not-a-moderator'`. That is
        // the headline authority gate for this handler — pinned by
        // the `non-moderator → not-a-moderator` unit test.
        throw rejectedToApiError(result);
      }
      // The engine emits exactly ONE `meta-disagreement-marked`
      // event for a mark action today (per
      // `methodology/handlers/markMetaDisagreement.ts` — the
      // returned `events: [markEvent]`). The read-side projection's
      // `handleMetaDisagreementMarked` does the facet-status
      // transition + proposal-bucket move, but that runs on every
      // subscriber's local incremental `applyEvent` against the
      // broadcast — no additional wire frames here. Defensive check
      // anyway in case a future engine arm drifts.
      if (result.events.length !== 1) {
        throw new Error(
          `ws-mark-meta-disagreement: engine produced ${String(result.events.length)} events (expected 1)`,
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

    // Post-commit emit + ack. Same ordering as the propose/vote/commit
    // handlers: emit FIRST so every subscribed client (including the
    // moderator) receives the `event-applied` envelope, THEN send the
    // request-correlated `meta-disagreement-marked` ack on the
    // moderator's socket.
    for (const evt of appendedEvents) {
      opts.broadcast.emit({ event: evt });
    }
    const ack: WsEnvelope<'meta-disagreement-marked'> = {
      type: 'meta-disagreement-marked',
      id: randomUUID(),
      inResponseTo: envelope.id,
      payload: {
        sessionId,
        sequence: appendedEvents[0]!.sequence,
        eventId: markEventId,
      },
    };
    connection.socket.send(serializeWsEnvelope(ack));
  };
}

/**
 * Register the mark-meta-disagreement handler against the dispatcher.
 * Called by `wsHandlersPlugin` once at registration time. Mirror of
 * `registerCommitHandlers` / `registerVoteHandlers` /
 * `registerProposeHandlers`.
 */
export function registerMarkMetaDisagreementHandlers(
  dispatcher: WsDispatcher,
  opts: MarkMetaDisagreementHandlerOptions,
): void {
  dispatcher.register('mark-meta-disagreement', buildMarkMetaDisagreementHandler(opts));
}

/**
 * Map a `session_events` row to the canonical `Event` envelope shape.
 * Mirrors the helper in `propose.ts` / `vote.ts` / `commit.ts`.
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
 * `propose.ts` / `vote.ts` / `commit.ts` and `sessions/routes.ts` —
 * duplicated here to keep the handler module self-contained.
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
 * `propose.ts` / `vote.ts` / `commit.ts` — duplicated here for the
 * same self-containment reason.
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
