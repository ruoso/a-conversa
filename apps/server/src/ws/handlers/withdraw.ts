// Dispatcher handler for `withdraw-proposal` client → server messages.
//
// Refinement: tasks/refinements/backend/ws_withdraw_proposal_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0027-entity-and-facet-layers-strict-separation.md
// TaskJuggler: backend.websocket_protocol.ws_withdraw_proposal_message
//
// **What this module owns.**
//
// `buildWithdrawProposalHandler({ pool, registry, broadcast, log, now? })`
// — returns a `WsDispatcher` handler for the `'withdraw-proposal'`
// envelope. Structurally mirrors `buildProposeHandler` /
// `buildCommitHandler` / `buildMarkMetaDisagreementHandler`: same gate
// stack, same transactional load-validate-append, same post-commit
// dual-signal (`event-applied` broadcast(s) + `proposal-withdrawn`
// ack), same `rejectedToApiError` mapping to the wire `error`
// envelope via the dispatcher's `onHandlerError` seam.
//
// **What this handler does differently** from the four sibling
// write-handlers:
//
//   1. **No engine routing for the action.** The handler enforces the
//      authority + state predicates directly (against the projection's
//      `findProposal` lookup) rather than constructing a
//      `MethodologyAction` and routing through `validateAction`. Per
//      D1 of the refinement: minting a `'withdraw-proposal'`
//      `MethodologyAction` variant + a `'not-proposer'`
//      `RejectionReason` would require engine work whose only
//      consumer is this one handler. The engine-gate promotion path
//      stays open (the docblock cites this for a future reader); v1
//      keeps the predicates at the protocol layer.
//
//   2. **Proposer-only authority gate, surfaced on the wire as
//      `'forbidden'`.** A subscribed non-proposer who sends
//      `'withdraw-proposal'` against another participant's pending
//      proposal passes gates 1 (subscribe) and 2 (visibility), reaches
//      the authority check, and is rejected with
//      `ApiError.forbidden('only the original proposer may withdraw
//      ...')`. The dispatcher's `onHandlerError` seam echoes the throw
//      as a wire `error` envelope with `code: 'forbidden'`. Mirrors
//      the commit-handler pattern of "authority decision lives in one
//      place + surfaces uniformly on the wire" — even though the
//      commit handler routes its authority decision through the
//      engine and this handler keeps it at the protocol layer, the
//      wire `error.code` shape is uniform across both.
//
//   3. **Per-sub-kind retraction mapping.** For each entity the
//      pending proposal introduced at propose-time, the handler emits
//      one `entity-removed` event. The mapping is the INVERSE of
//      `buildStructuralEventsForPropose` (in
//      `apps/server/src/methodology/handlers/propose.ts`) — the two
//      MUST stay in sync. The v1 mapping covers two sub-kinds: a
//      `classify-node` proposal whose payload carries a `wording`
//      AND whose `node_id` didn't pre-exist on the projection emits
//      exactly one `entity-removed(node)`; a `set-edge-substance`
//      proposal whose payload carries the three optional endpoint
//      fields (`source_node_id`, `target_node_id`, `role`) AND whose
//      `edge_id` resolves to an existing edge on the projection emits
//      exactly one `entity-removed(edge)`. Every other sub-kind
//      emits zero structural retractions (the proposal envelope
//      itself remains in the event log + `pendingProposals` — see
//      D5). When the remaining propose-emission tech-debt grows (the
//      decompose + interpretive-split arms), this handler's retraction
//      mapping MUST grow in lockstep.
//
//   4. **Multi-event sequence allocation.** The handler may emit zero,
//      one, or more `entity-removed` events per withdraw. Each
//      emitted event takes the next slot starting from
//      `MAX(sequence) + 1`, mirroring propose's multi-event
//      allocator at `methodology/handlers/propose.ts` L1199-L1209.
//
//   5. **Ack envelope type.** `'proposal-withdrawn'` (not
//      `'withdrawn'` — that name collides with the `vote.choice`
//      `'withdraw'` enum value used in `wsVotePayloadSchema`). The
//      ack carries `{ sessionId, proposalEventId, removedEventCount }`
//      so the client can pair the ack against the matching
//      `event-applied` broadcasts without polling.
//
// **What this handler does NOT do.**
//
//   - Authentication: enforced by the upgrade-time gate
//     (`ws_auth_on_connect`); `connection.user` is non-undefined.
//   - Schema validation of `payload`: enforced upstream by
//     `parseWsEnvelope` against `wsWithdrawProposalPayloadSchema`.
//   - Retract the proposal envelope event itself. Per D5 of the
//     refinement: history is replay-authoritative + immutable (ADR
//     0021 / ADR 0020). Withdrawing a proposal retracts the
//     propose-time-minted ENTITIES (via this handler's
//     `entity-removed` emissions); the original `proposal` event
//     stays in the log forever. The projector's response to the
//     entity retractions is what removes the proposal from the
//     canvas + the sidebar.
//   - Mint a new `'proposal-withdrawn'` event KIND (distinct from
//     this handler's `'proposal-withdrawn'` WS ENVELOPE type — the
//     overlap is intentional + namespace-distinct). If a future
//     consumer (a history-browser, a snapshot label, a methodology-
//     trace renderer) needs an explicit terminal marker on the
//     proposal, that's the right time to mint it; v1's entity-layer
//     removals are sufficient for the canvas + sidebar UX.
//
// **Proposer identity comes from the connection, not the payload.**
// The handler reads `connection.user.id` and matches it against
// `pending.proposer` (from the projection's `PendingProposal` record,
// itself derived from `event.actor` of the original `proposal` event
// at projection time per `apps/server/src/projection/replay.ts`'s
// `handleProposal`). The wire payload has NO `proposerId` field. A
// client cannot withdraw on behalf of someone else. Symmetric with
// `propose` (no `proposerId`), `vote` (no `voterId`), `commit` (no
// `moderatorId`), and `mark-meta-disagreement` (no `markerId`).
// Pinned by the unit-test
// `even-when-the-client-tries-to-spoof-proposerId` case.

import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type {
  Event,
  EntityRemovedPayload,
  ProposalPayload,
  WsEnvelope,
} from '@a-conversa/shared-types';

import type { DbPool } from '../../db.js';
import { ApiError, rejectedToApiError } from '../../errors.js';
import { appendSessionEvent } from '../../events/append.js';
import { validateEvent } from '../../events/validate.js';
import { findProposal } from '../../methodology/primitives.js';
import type { EventToAppendEnvelope } from '../../methodology/types.js';
import type { PendingProposal, Projection } from '../../projection/index.js';
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
 * `commit.ts` / `meta-disagreement.ts` (duplicated rather than
 * imported to keep the handler self-contained; if/when these helpers
 * move to a shared module all call sites switch atomically).
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
 * shape as `CommitHandlerOptions` / `ProposeHandlerOptions` /
 * `MarkMetaDisagreementHandlerOptions`.
 */
export interface WithdrawProposalHandlerOptions {
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
   * the per-event `entity-removed` payload's `removed_at`. Defaulted
   * to `Date.now` in production; tests pin a controllable function so
   * the payload is deterministic across runs.
   */
  readonly now?: () => number;
}

/**
 * Build the `withdraw-proposal` dispatcher handler. The returned
 * closure captures the pool / registry / broadcast / log / clock
 * once; the dispatcher invokes it per inbound `withdraw-proposal`
 * envelope.
 */
export function buildWithdrawProposalHandler(
  opts: WithdrawProposalHandlerOptions,
): (envelope: WsEnvelope<'withdraw-proposal'>, connection: WsConnectionContext) => Promise<void> {
  const nowFn = opts.now ?? Date.now;
  return async (envelope, connection) => {
    const { sessionId, expectedSequence, proposalEventId } = envelope.payload;
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

    // Gate 1 — subscribe-before-act. Identical to the propose / vote /
    // commit / mark-meta-disagreement handler's gate; the `'forbidden'`
    // code is reused from the existing `ApiError.code` taxonomy.
    const subscribers = opts.registry.connectionsForSession(sessionId);
    if (!subscribers.includes(connection.connectionId)) {
      throw ApiError.forbidden('not subscribed to this session — send a subscribe envelope first', {
        sessionId,
      });
    }

    // Gate 2 — visibility re-check. A session that became invisible
    // between the subscribe and this withdraw surfaces as not-found,
    // inheriting the existence-non-leak rule from `canSeeSession`.
    const visible = await canSeeSession(opts.pool, sessionId, userId);
    if (!visible) {
      throw ApiError.notFound('session not found or not visible', { sessionId });
    }

    // Transactional load-validate-append. Identical shape to the
    // propose / commit / mark-meta-disagreement handlers: FOR UPDATE
    // on the `sessions` row, MAX(sequence) read, projection load,
    // authority + state checks, schema-on-write `validateEvent` per
    // emitted event, `appendSessionEvent` per emitted event. Events
    // appended inside the transaction are collected for the post-
    // COMMIT broadcast emit.
    const appendedEvents: Event[] = [];
    await withTransaction(opts.pool, async (client) => {
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

      // 3. Optimistic-concurrency check. Mirrors propose / commit /
      //    mark-meta-disagreement; the synthesised
      //    `'sequence-mismatch'` `RejectedValidationResult` routes
      //    through `rejectedToApiError` for the uniform wire-code
      //    surface (status 409).
      if (expectedSequence !== maxSeq) {
        throw rejectedToApiError({
          ok: false,
          reason: 'sequence-mismatch',
          detail: `withdraw-proposal: expectedSequence=${String(expectedSequence)} does not match server MAX(sequence)=${String(maxSeq)} for session ${sessionId} — your view of the session is stale`,
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

      // 5. Proposal-state check. `findProposal` returns `null` (not
      //    found), or a discriminated record naming one of the three
      //    states (`'pending'`, `'committed'`, `'meta-disagreement'`).
      //    Per D2 of the refinement: route each rejection through
      //    `rejectedToApiError` against the existing engine
      //    `RejectionReason` codes so the wire-code surface is uniform
      //    with commit / mark-meta-disagreement / vote.
      const found = findProposal(projection, proposalEventId);
      if (found === null) {
        throw rejectedToApiError({
          ok: false,
          reason: 'proposal-not-found',
          detail: `withdraw-proposal: proposalEventId=${proposalEventId} does not match any pending, committed, or meta-disagreement proposal in session ${sessionId}`,
        });
      }
      if (found.state === 'committed') {
        throw rejectedToApiError({
          ok: false,
          reason: 'proposal-already-committed',
          detail: `withdraw-proposal: proposalEventId=${proposalEventId} has already been committed; the entity-layer effects of the commit are durable and cannot be undone by a withdraw`,
        });
      }
      if (found.state === 'meta-disagreement') {
        throw rejectedToApiError({
          ok: false,
          reason: 'proposal-already-meta-disagreement',
          detail: `withdraw-proposal: proposalEventId=${proposalEventId} has already been marked as a meta-disagreement; a withdraw against a meta-disagreement-marked proposal is not meaningful`,
        });
      }

      // 6. Authority check — proposer-only. Per D1 of the refinement:
      //    surface as `ApiError.forbidden(...)` (wire `code:
      //    'forbidden'`) rather than minting a new engine
      //    `RejectionReason`. The error message names both the
      //    requester and the original proposer so logs + on-wire
      //    diagnostics are unambiguous.
      const pending: PendingProposal = found.record;
      if (pending.proposer !== userId) {
        throw ApiError.forbidden(
          `only the original proposer may withdraw this proposal — proposalEventId=${proposalEventId}, you are ${userId}, the proposer is ${pending.proposer ?? 'unknown'}`,
          {
            sessionId,
            proposalEventId,
          },
        );
      }

      // 7. Per-sub-kind retraction mapping. Derives "which entities
      //    to retract" from the pending proposal's payload by mirroring
      //    `buildStructuralEventsForPropose` (in
      //    `apps/server/src/methodology/handlers/propose.ts`). The two
      //    functions are inverses and MUST stay in sync; the docblock
      //    on `buildStructuralEventsForPropose` cross-references this
      //    handler. See D3 of the refinement for the rationale on
      //    inlining the derivation here rather than extracting a
      //    shared helper.
      const createdAtIso = new Date(nowFn()).toISOString();
      const retractedEntities = entitiesToRetractForWithdraw(projection, pending.payload);

      // 8. Build, validate-on-write, and append one `entity-removed`
      //    event per retracted entity. Each event takes the next
      //    sequence slot starting from `maxSeq + 1`. Mirrors
      //    propose's multi-event allocator.
      for (let i = 0; i < retractedEntities.length; i++) {
        const target = retractedEntities[i]!;
        const removalPayload: EntityRemovedPayload = {
          entity_kind: target.entityKind,
          entity_id: target.entityId,
          removed_by: userId,
          removed_at: createdAtIso,
        };
        const removalEvent: EventToAppendEnvelope<'entity-removed'> = {
          id: randomUUID(),
          sessionId,
          sequence: maxSeq + 1 + i,
          kind: 'entity-removed',
          actor: userId,
          payload: removalPayload,
          createdAt: createdAtIso,
        };
        // Schema-on-write — every row in `session_events` is
        // structurally valid by construction (ADR 0021).
        validateEvent(removalEvent);
        appendedEvents.push(await appendSessionEvent(client, removalEvent));
      }
    });

    // Post-commit emit + ack. Same ordering as the propose / vote /
    // commit / mark-meta-disagreement handlers: emit FIRST so every
    // subscribed client (including the proposer) receives any
    // `event-applied` envelopes, THEN send the request-correlated
    // `proposal-withdrawn` ack on the proposer's socket. For the
    // zero-emission sub-kinds (every sub-kind other than free-floating
    // `classify-node` today) the broadcast loop is a no-op; the ack
    // still lands (signals "your request was processed"). See D3 + D5
    // of the refinement for the zero-emission rationale.
    for (const evt of appendedEvents) {
      opts.broadcast.emit({ event: evt });
    }
    const ack: WsEnvelope<'proposal-withdrawn'> = {
      type: 'proposal-withdrawn',
      id: randomUUID(),
      inResponseTo: envelope.id,
      payload: {
        sessionId,
        proposalEventId,
        removedEventCount: appendedEvents.length,
      },
    };
    connection.socket.send(serializeWsEnvelope(ack));
  };
}

/**
 * Register the withdraw-proposal handler against the dispatcher.
 * Called by `wsHandlersPlugin` once at registration time. Mirror of
 * `registerCommitHandlers` / `registerProposeHandlers` /
 * `registerMarkMetaDisagreementHandlers`.
 */
export function registerWithdrawProposalHandlers(
  dispatcher: WsDispatcher,
  opts: WithdrawProposalHandlerOptions,
): void {
  dispatcher.register('withdraw-proposal', buildWithdrawProposalHandler(opts));
}

/**
 * Per-sub-kind retraction mapping. The inverse of
 * `buildStructuralEventsForPropose` (in
 * `apps/server/src/methodology/handlers/propose.ts`). Returns the
 * list of entities to retract via `entity-removed` events for the
 * given pending proposal payload + projection.
 *
 * **Invariant**: this function and `buildStructuralEventsForPropose`
 * MUST stay in sync — they describe the same per-sub-kind mapping in
 * opposite directions. When the propose-emission tech-debt grows
 * (`mod_set_edge_substance_endpoint_carriage`,
 * `mod_decompose_propose_time_canvas_visibility`), the new arms must
 * land here in lockstep. The docblock on
 * `buildStructuralEventsForPropose` cites this function as the pair;
 * a code-review walk of either function should verify the other.
 *
 * **v1 coverage**:
 *
 *   - `classify-node` with a `wording` field AND a `node_id` that
 *     doesn't pre-exist on the projection → retract the node. (The
 *     propose handler only emits `node-created` + `entity-included`
 *     when the same predicate holds, per
 *     `buildStructuralEventsForPropose`'s `classify-node` arm.)
 *   - `set-edge-substance` with the three optional endpoint fields
 *     (`source_node_id`, `target_node_id`, `role`) present AND
 *     `edge_id` resolving to an existing edge on the projection →
 *     retract the edge. The propose handler emits `edge-created` +
 *     `entity-included` for the connecting case (the four-branch
 *     fresh-edge predicate); withdrawing retracts the edge entity
 *     via `entity-removed(edge)`. Mirrors the `classify-node` arm:
 *     the endpoint-presence is the propose-time signal; the
 *     projector-side existence check guards against double-retraction
 *     (the projector's `handleEntityRemoved` would reject anyway).
 *   - `decompose` → walk `payload.components` in array order; for
 *     each component whose `node_id` resolves to an extant node on
 *     the projection, push one `{ entityKind: 'node', entityId:
 *     component.node_id }` retraction target. The propose handler's
 *     `decompose` arm emitted `node-created` + `entity-included`
 *     per component at propose-time (per
 *     `mod_decompose_propose_time_canvas_visibility`); withdrawing
 *     retracts each component node via `entity-removed(node)`. The
 *     parent node's visibility is UNCHANGED here (it never flipped
 *     at propose-time — the propose-time emission doesn't touch
 *     the parent per the methodology contract). The
 *     `projection.getNode !== undefined` defensive check guards
 *     against missing-entity retraction (the projector's
 *     `handleEntityRemoved` would reject anyway).
 *   - `interpretive-split` → identical shape to `decompose`, but
 *     walks `payload.readings` instead of `payload.components`.
 *     Both arms share the same `proposalComponentSchema` per-element
 *     shape and the same per-element retraction logic; kept as
 *     separate `case` blocks for symmetry with the propose-handler's
 *     per-sub-kind switch (mirrors D5 of
 *     `mod_decompose_propose_time_canvas_visibility`).
 *   - Every other sub-kind → retract nothing. The proposal envelope
 *     event itself remains in the event log + `pendingProposals`
 *     (per D5 of the refinement); the entity layer has nothing to
 *     retract because nothing was minted at propose-time.
 */
interface EntityRetractionTarget {
  entityKind: 'node' | 'edge' | 'annotation';
  entityId: string;
}

function entitiesToRetractForWithdraw(
  projection: Projection,
  payload: ProposalPayload,
): EntityRetractionTarget[] {
  const targets: EntityRetractionTarget[] = [];

  switch (payload.kind) {
    case 'classify-node': {
      // Mirror of `buildStructuralEventsForPropose`'s `classify-node`
      // arm: the propose handler emits `node-created` only when the
      // node didn't pre-exist AND the payload carried a wording. The
      // wording-vs-no-wording predicate is the client's signal for
      // "this is a fresh free-floating statement" vs "re-classify an
      // already-extant node." Both branches must match here so we
      // don't retract a pre-extant node that this proposal didn't
      // mint. Since propose-time the node MAY have been minted, but
      // by the time we're processing the withdraw a) the node exists
      // on the projection (we just confirmed the proposal exists +
      // the projection rebuilt off the log), and b) the
      // `visible`-flip already happened. The right predicate at
      // withdraw-time is "did the propose-time payload carry a
      // wording" — that's the same signal the propose handler used.
      const nodeId = payload.node_id;
      const wording = payload.wording;
      const node = projection.getNode(nodeId);
      // The node MUST exist on the projection at withdraw-time if it
      // was minted at propose-time (the log replay rebuilt it). When
      // `wording !== undefined` AND the projector has a record for
      // `nodeId`, the propose-time fan-out minted it — retract.
      // Defensive: if the projection somehow lacks the node, don't
      // emit a retraction (the projector would reject the event
      // anyway via `handleEntityRemoved`'s missing-entity check).
      if (wording !== undefined && node !== undefined) {
        targets.push({ entityKind: 'node', entityId: nodeId });
      }
      break;
    }
    case 'set-edge-substance': {
      // Mirror of `buildStructuralEventsForPropose`'s
      // `set-edge-substance` arm: the propose handler emits
      // `edge-created` + `entity-included` only when the three
      // endpoint fields are present AND `projection.getEdge(edge_id)`
      // returned `undefined` at propose-time. By withdraw-time the
      // log replay has rebuilt the edge on the projection (if it was
      // minted at propose-time), so the right withdraw-side gate is
      // "did the propose payload carry the endpoints" — the same
      // signal the propose handler used. The `getEdge !== undefined`
      // defensive check guards against a missing-entity retraction
      // (the projector's `handleEntityRemoved` would reject anyway).
      const edgeId = payload.edge_id;
      const sourceNodeId = payload.source_node_id;
      const targetNodeId = payload.target_node_id;
      const role = payload.role;
      const edge = projection.getEdge(edgeId);
      if (
        sourceNodeId !== undefined &&
        targetNodeId !== undefined &&
        role !== undefined &&
        edge !== undefined
      ) {
        targets.push({ entityKind: 'edge', entityId: edgeId });
      }
      break;
    }
    case 'decompose': {
      // Mirror of `buildStructuralEventsForPropose`'s `decompose`
      // arm: the propose handler emits `node-created` +
      // `entity-included` per component at propose-time using the
      // client-minted `node_id` carried inline on each
      // `payload.components[i]` (per
      // `mod_decompose_propose_time_canvas_visibility`). By
      // withdraw-time the log replay has rebuilt each component
      // node on the projection; the right withdraw-side gate is
      // "for each component whose `node_id` resolves on the
      // projection, retract." The `getNode !== undefined`
      // defensive check guards against missing-entity retraction
      // (the projector's `handleEntityRemoved` would reject
      // anyway). The parent node is intentionally NOT retracted —
      // the propose-time emission never touched its visibility
      // (the parent flips invisible only on commit per
      // `apps/server/src/projection/replay.ts:691-711`).
      for (const component of payload.components) {
        if (projection.getNode(component.node_id) !== undefined) {
          targets.push({ entityKind: 'node', entityId: component.node_id });
        }
      }
      break;
    }
    case 'interpretive-split': {
      // Symmetric arm to `decompose` — walks `payload.readings`
      // instead of `payload.components`. Both arms share the same
      // `proposalComponentSchema` per-element shape and the same
      // per-element retraction logic; kept as separate `case`
      // blocks for symmetry with the propose-handler's per-sub-kind
      // switch (per D5 of
      // `mod_decompose_propose_time_canvas_visibility`).
      for (const reading of payload.readings) {
        if (projection.getNode(reading.node_id) !== undefined) {
          targets.push({ entityKind: 'node', entityId: reading.node_id });
        }
      }
      break;
    }
    case 'set-node-substance':
    case 'edit-wording':
    case 'axiom-mark':
    case 'meta-move':
    case 'break-edge':
    case 'amend-node':
    case 'annotate':
      // No structural events emitted at propose-time for these
      // sub-kinds today (see `buildStructuralEventsForPropose`'s
      // header). When future propose-emission tech-debt lands the
      // corresponding `node-created` / `edge-created` /
      // `annotation-created` arms, the matching retraction arms
      // land here.
      break;
  }

  return targets;
}

/**
 * Map a `session_events` row to the canonical `Event` envelope shape.
 * Mirrors the helper in `propose.ts` / `commit.ts` /
 * `meta-disagreement.ts`.
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
 * sibling handlers and `sessions/routes.ts` — duplicated here to keep
 * the handler module self-contained.
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
