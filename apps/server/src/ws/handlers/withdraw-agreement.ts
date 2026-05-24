// Dispatcher handler for `withdraw-agreement` client → server messages.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_withdraw_agreement_handler.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0029-protocol-rejection-policies.md,
//              docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md
// TaskJuggler: per_facet_refactor.server_handlers.pf_withdraw_agreement_handler
//
// **What this module owns.**
//
// `buildWithdrawAgreementHandler({ pool, registry, broadcast, log, now? })`
// — returns a `WsDispatcher` handler for the `'withdraw-agreement'`
// envelope (per ADR 0030 §3 + `pf_withdraw_agreement_event_kind`).
// Structurally mirrors `buildMarkMetaDisagreementHandler` /
// `buildCommitHandler` / `buildWithdrawProposalHandler`: same gate
// stack, same transactional load-validate-append, same post-commit
// dual-signal (`event-applied` broadcast + `agreement-withdrawn`
// ack), same `rejectedToApiError` / `ApiError.forbidden` mapping to
// the wire `error` envelope via the dispatcher's `onHandlerError`
// seam.
//
// **What this handler does differently** from the four sibling
// write-handlers (commit / vote / mark-meta-disagreement /
// withdraw-proposal):
//
//   1. **No engine routing for the action.** Per the refinement's D1
//      decision (no `MethodologyAction.withdrawAgreement` variant
//      today): the handler enforces the participant + state
//      predicates directly against the projection's `FacetState`
//      lookup. The engine-gate promotion path stays open (the
//      docblock cites this for a future reader); v1 keeps the
//      predicates at the protocol layer.
//
//   2. **Actor-must-match-participant authority gate** surfaced as
//      `'forbidden'`. A participant withdraws only their OWN prior
//      agreement (per the refinement). The moderator does NOT
//      withdraw on behalf of debaters; an envelope whose
//      `payload.participant !== connection.user.id` is rejected with
//      `ApiError.forbidden('a participant can only withdraw their
//      own agreement ...')`. Mirrors the proposer-only gate on the
//      `withdraw-proposal` handler — both surface "actor identity
//      mismatch" via the wire `forbidden` code.
//
//   3. **Per-facet state predicates** (per ADR 0030 §3 +
//      `docs/methodology.md:25`):
//        - The target `(entity_kind, entity_id, facet)` must resolve
//          to a `FacetState` on the projection. A missing target
//          rejects with `target-entity-not-found`.
//        - The facet's `committedAt` must be non-null — withdraw only
//          makes sense against a COMMITTED facet (an
//          uncommitted-but-agreed facet uses the regular `vote`
//          event with `choice: 'dispute'` to change the vote).
//          Rejects with `inapplicable-to-facet`.
//        - The participant must have a recorded `'agree'` vote on
//          the facet's `perParticipant` map; cannot withdraw an
//          agreement one never gave. Rejects with `no-prior-agree`.
//
//   4. **Ack envelope type.** `'agreement-withdrawn'` (mirror of
//      `'committed'` / `'voted'` / `'meta-disagreement-marked'` —
//      one ack per successful action carrying `{ sessionId,
//      sequence, eventId }`).
//
// **Idempotency.** A second withdraw against an already-withdrawn
// `(entity, facet)` is accepted at the handler level (the recorded
// event is informational; the projection's `Set<participantId>` add
// is a no-op the second time). Per the refinement's D3 decision the
// handler still appends the event for the historical record; the
// projection state doesn't drift. The repeat-withdraw is therefore
// neither rejected by the handler (no engine error code for "you
// already withdrew") nor surfaced as a state change.
//
// **What this handler does NOT do.**
//
//   - Authentication: enforced by the upgrade-time gate
//     (`ws_auth_on_connect`); `connection.user` is non-undefined.
//   - Schema validation of `payload`: enforced upstream by
//     `parseWsEnvelope` against `wsWithdrawAgreementPayloadSchema`.
//   - Mint a `withdraw-agreement` envelope on the *server* clock —
//     the event's `withdrawn_at` mirrors the envelope `createdAt`
//     (single clock source per the sibling vote / commit / meta
//     handlers).

import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Event, WithdrawAgreementPayload, WsEnvelope } from '@a-conversa/shared-types';

import type { DbPool } from '../../db.js';
import { ApiError, rejectedToApiError } from '../../errors.js';
import { appendSessionEvent } from '../../events/append.js';
import { validateEvent } from '../../events/validate.js';
import type { EventToAppendEnvelope } from '../../methodology/types.js';
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
 * `commit.ts` / `meta-disagreement.ts` / `withdraw.ts` (duplicated
 * rather than imported to keep the handler self-contained; if/when
 * these helpers move to a shared module all call sites switch
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
 * shape as `WithdrawProposalHandlerOptions` /
 * `MarkMetaDisagreementHandlerOptions`.
 */
export interface WithdrawAgreementHandlerOptions {
  /** DB pool the visibility predicate + transactional writes run against. */
  readonly pool: DbPool;
  /** Per-instance subscription registry — the subscribe-before-act gate. */
  readonly registry: WsSubscriptionRegistry;
  /** Per-instance broadcast bus — the post-commit `event-applied` emit. */
  readonly broadcast: WsBroadcastBus;
  /** Logger for diagnostics. */
  readonly log: FastifyBaseLogger;
  /**
   * Clock injection for the event envelope's `createdAt` field +
   * the per-event `withdraw-agreement` payload's `withdrawn_at`.
   * Defaulted to `Date.now` in production; tests pin a controllable
   * function so the payload is deterministic across runs.
   */
  readonly now?: () => number;
}

/**
 * Build the `withdraw-agreement` dispatcher handler. The returned
 * closure captures the pool / registry / broadcast / log / clock
 * once; the dispatcher invokes it per inbound `withdraw-agreement`
 * envelope.
 */
export function buildWithdrawAgreementHandler(
  opts: WithdrawAgreementHandlerOptions,
): (envelope: WsEnvelope<'withdraw-agreement'>, connection: WsConnectionContext) => Promise<void> {
  const nowFn = opts.now ?? Date.now;
  return async (envelope, connection) => {
    const {
      sessionId,
      expectedSequence,
      entity_kind: entityKind,
      entity_id: entityId,
      facet,
      participant,
    } = envelope.payload;
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

    // Gate 1 — subscribe-before-act. Identical to the sibling
    // handlers' gate; the `'forbidden'` code is reused from the
    // existing `ApiError.code` taxonomy.
    const subscribers = opts.registry.connectionsForSession(sessionId);
    if (!subscribers.includes(connection.connectionId)) {
      throw ApiError.forbidden('not subscribed to this session — send a subscribe envelope first', {
        sessionId,
      });
    }

    // Gate 2 — actor-must-match-participant. A participant withdraws
    // their OWN prior agreement only. The moderator does NOT
    // withdraw on behalf of debaters (per the refinement's D2
    // decision). Even if the wire payload spoofs a different
    // participant id, the handler authoritatively reads the
    // authenticated `connection.user.id` and rejects a mismatch
    // with `forbidden`.
    if (participant !== userId) {
      throw ApiError.forbidden(
        `a participant can only withdraw their own agreement — payload.participant=${participant}, you are ${userId}`,
        { sessionId },
      );
    }

    // Gate 3 — visibility re-check. A session that became invisible
    // between the subscribe and this withdraw surfaces as not-found,
    // inheriting the existence-non-leak rule from `canSeeSession`.
    const visible = await canSeeSession(opts.pool, sessionId, userId);
    if (!visible) {
      throw ApiError.notFound('session not found or not visible', { sessionId });
    }

    // Transactional load-validate-append. Identical shape to the
    // sibling handlers: FOR UPDATE on the `sessions` row,
    // MAX(sequence) read, projection load, state checks,
    // schema-on-write `validateEvent`, `appendSessionEvent`. Events
    // appended inside the transaction are collected for the post-
    // COMMIT broadcast emit.
    const appendedEvents: Event[] = [];
    const withdrawEventId = await withTransaction(opts.pool, async (client) => {
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

      // 3. Optimistic-concurrency check. Mirrors the sibling
      //    handlers; the synthesised `'sequence-mismatch'`
      //    `RejectedValidationResult` routes through
      //    `rejectedToApiError` for the uniform wire-code surface
      //    (status 409).
      if (expectedSequence !== maxSeq) {
        throw rejectedToApiError({
          ok: false,
          reason: 'sequence-mismatch',
          detail: `withdraw-agreement: expectedSequence=${String(expectedSequence)} does not match server MAX(sequence)=${String(maxSeq)} for session ${sessionId} — your view of the session is stale`,
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

      // 5. Participant-presence check. Must be a CURRENT participant
      //    (still open `participant-joined` record with no matching
      //    `participant-left`). A historical participant (who left)
      //    cannot withdraw an agreement they once held — the
      //    derivation filters left participants out of the facet
      //    status anyway per ADR 0030 §7's rule 3.
      const isCurrent = projection.currentParticipants().some((p) => p.userId === userId);
      if (!isCurrent) {
        throw rejectedToApiError({
          ok: false,
          reason: 'not-a-participant',
          detail: `withdraw-agreement: requester ${userId} is not a current participant of session ${sessionId}`,
        });
      }

      // 6. Target-facet lookup. The `(entity_kind, entity_id, facet)`
      //    triple must resolve to a `FacetState` on the projection
      //    (the entity exists AND the facet is applicable for the
      //    entity kind — e.g. nodes carry classification /
      //    substance / wording; edges carry shape / substance;
      //    annotations carry wording / substance — only nodes and
      //    edges are reachable on this handler per the payload's
      //    narrowed `entity_kind` enum).
      const facetState = lookupFacetState(projection, entityKind, entityId, facet);
      if (facetState === null) {
        throw rejectedToApiError({
          ok: false,
          reason: 'target-entity-not-found',
          detail: `withdraw-agreement: target ${entityKind}:${entityId} facet '${facet}' is not present in session ${sessionId}`,
        });
      }

      // 7. Facet-must-be-committed gate (per ADR 0030 §3 +
      //    `docs/methodology.md:25`). Withdraw only makes sense
      //    against a COMMITTED facet — an uncommitted-but-agreed
      //    facet uses the regular `vote` event with
      //    `choice: 'dispute'` to change the vote. Reject with the
      //    sibling-vote-handler's `inapplicable-to-facet` code.
      if (facetState.committedAt === null) {
        throw rejectedToApiError({
          ok: false,
          reason: 'inapplicable-to-facet',
          detail: `withdraw-agreement: facet ${entityKind}:${entityId}/${facet} has not been committed — withdraw is only meaningful against a committed facet (use vote+dispute to change a still-pending vote)`,
        });
      }

      // 8. No-prior-agree check. The participant must have a
      //    recorded `'agree'` vote on the facet's `perParticipant`
      //    map. Cannot withdraw an agreement one never gave.
      const priorVote = facetState.perParticipant.get(userId);
      if (priorVote === undefined || priorVote.vote !== 'agree') {
        const observed =
          priorVote === undefined
            ? 'no prior vote'
            : `prior vote was '${priorVote.vote}', not 'agree'`;
        throw rejectedToApiError({
          ok: false,
          reason: 'no-prior-agree',
          detail: `withdraw-agreement: cannot withdraw on facet ${entityKind}:${entityId}/${facet} — withdrawal requires a prior 'agree' from ${userId} (${observed})`,
        });
      }

      // 9. Build the `withdraw-agreement` event. The `withdrawn_at`
      //    mirrors the envelope `createdAt` (single clock source,
      //    sibling vote / commit / meta convention).
      const eventId = randomUUID();
      const createdAtIso = new Date(nowFn()).toISOString();
      const withdrawPayload: WithdrawAgreementPayload = {
        entity_kind: entityKind,
        entity_id: entityId,
        facet,
        participant: userId,
        withdrawn_at: createdAtIso,
      };
      const withdrawEvent: EventToAppendEnvelope<'withdraw-agreement'> = {
        id: eventId,
        sessionId,
        sequence: nextSeq,
        kind: 'withdraw-agreement',
        actor: userId,
        payload: withdrawPayload,
        createdAt: createdAtIso,
      };
      // Schema-on-write — every row in `session_events` is
      // structurally valid by construction (ADR 0021).
      validateEvent(withdrawEvent);
      appendedEvents.push(await appendSessionEvent(client, withdrawEvent));
      return eventId;
    });

    // Post-commit emit + ack. Same ordering as the sibling write-
    // handlers: emit FIRST so every subscribed client (including the
    // withdrawer) receives the `event-applied` envelope, THEN send
    // the request-correlated `agreement-withdrawn` ack on the
    // withdrawer's socket.
    for (const evt of appendedEvents) {
      opts.broadcast.emit({ event: evt });
    }
    const ack: WsEnvelope<'agreement-withdrawn'> = {
      type: 'agreement-withdrawn',
      id: randomUUID(),
      inResponseTo: envelope.id,
      payload: {
        sessionId,
        sequence: appendedEvents[0]!.sequence,
        eventId: withdrawEventId,
      },
    };
    connection.socket.send(serializeWsEnvelope(ack));
  };
}

/**
 * Register the withdraw-agreement handler against the dispatcher.
 * Called by `wsHandlersPlugin` once at registration time. Mirror of
 * `registerWithdrawProposalHandlers` /
 * `registerMarkMetaDisagreementHandlers` /
 * `registerCommitHandlers`.
 */
export function registerWithdrawAgreementHandlers(
  dispatcher: WsDispatcher,
  opts: WithdrawAgreementHandlerOptions,
): void {
  dispatcher.register('withdraw-agreement', buildWithdrawAgreementHandler(opts));
}

/**
 * Per-facet state lookup. Mirrors `facetStateForTarget` in
 * `apps/server/src/projection/replay.ts` — kept inline here so the
 * handler module stays self-contained (the projection-layer helper
 * is internal to `replay.ts`). The `entity_kind` enum on the
 * payload is narrowed to `'node' | 'edge'` (annotations have no
 * facets in v1 per ADR 0030 §3), so this lookup never asks for an
 * annotation facet.
 *
 * Returns `null` when the entity or the facet doesn't resolve on
 * the projection. The handler surfaces that as
 * `target-entity-not-found`.
 */
function lookupFacetState(
  projection: ReturnType<typeof projectFromLog>,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'classification' | 'substance' | 'wording',
): {
  committedAt: string | null;
  perParticipant: Map<string, { vote: 'agree' | 'dispute' | 'withdraw' }>;
} | null {
  if (entityKind === 'node') {
    const node = projection.getNode(entityId);
    if (!node) return null;
    if (facet === 'classification') return node.classificationFacet;
    if (facet === 'substance') return node.substanceFacet;
    if (facet === 'wording') return node.wordingFacet;
    return null;
  }
  // entityKind === 'edge'
  const edge = projection.getEdge(entityId);
  if (!edge) return null;
  if (facet === 'substance') return edge.substanceFacet;
  // 'classification' / 'wording' are not applicable to edges in v1;
  // returning `null` surfaces as `target-entity-not-found` at the
  // handler. Per ADR 0030 §5, edge `shape` is a facet but it lives
  // inline and isn't part of the wire-level `facetNameSchema` yet
  // (the projection-layer `FacetName` only carries the 3 voteable
  // facets); when that widens, this lookup widens in lockstep.
  return null;
}

/**
 * Map a `session_events` row to the canonical `Event` envelope shape.
 * Mirrors the helper in `propose.ts` / `commit.ts` /
 * `meta-disagreement.ts` / `withdraw.ts`.
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
 * Transaction-bound client surface. Mirrors `DbTxClient` in the
 * sibling handlers and `sessions/routes.ts` — duplicated here to
 * keep the handler module self-contained.
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
 * Run `fn` inside a transaction. Mirrors `withTransaction` in the
 * sibling handlers.
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
