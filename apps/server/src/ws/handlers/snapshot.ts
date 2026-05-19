// Dispatcher handler for `snapshot` client → server messages.
//
// Refinement: tasks/refinements/backend/ws_snapshot_message.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_snapshot_message
//
// **What this module owns.**
//
// `buildSnapshotHandler({ pool, registry, log })` — returns a
// `WsDispatcher` handler for the `'snapshot'` envelope. **Interpretation
// A** of the WBS task: the wire `snapshot` request is a state-query —
// the client asks for the current projection of a session it has
// subscribed to, and the server replies with a `snapshot-state`
// envelope carrying the full projection at the server's current
// `lastAppliedSequence`. See the refinement Decisions for the
// rationale of choosing this shape over the label-creation
// Interpretation B (which is deferred to a future task once the
// methodology engine grows a snapshot-create handler).
//
// The handler:
//
//   1. **Subscribe-before-act gate.** Rejects with
//      `ApiError.forbidden(...)` when the client's connection is not
//      in `registry.connectionsForSession(payload.sessionId)`. The
//      `'forbidden'` code is reused from the existing `ApiError.code`
//      taxonomy — same uniform protocol-layer gate the four write
//      handlers (propose / vote / commit / mark-meta-disagreement)
//      use.
//   2. **Visibility re-check.** `canSeeSession(pool, sessionId,
//      userId)` is called even though `subscribe` already checked — a
//      session that became invisible between subscribe and snapshot
//      surfaces as `ApiError.notFound(...)`. Same existence-non-leak
//      rule the rest of the WS surface inherits.
//   3. **Event-log SELECT + projection replay.** A single
//      `SELECT ... ORDER BY sequence ASC` reads every event for the
//      session; `projectFromLog(events, sessionId)` builds the
//      projection. No FOR UPDATE, no MAX(sequence), no transaction —
//      this is a pure read. (Race against an in-flight propose is
//      benign: the proposer's `event-applied` broadcast carries the
//      new event; if it arrives BEFORE the snapshot response on the
//      same socket, the client deduplicates by sequence — any
//      broadcast at `sequence <= snapshot.sequence` is a no-op.)
//   4. **Serialize + respond.** The in-memory `Projection` class
//      holds Maps that don't survive `JSON.stringify`; the helper
//      `serializeProjectionForWire` walks the class's public
//      iterator + getter surface and produces a JSON-safe object.
//      The handler then mints a `snapshot-state` envelope
//      (`inResponseTo` correlated to the request's `id`) and sends
//      it directly on the requesting client's socket. No broadcast,
//      no other clients are touched.
//
// **What this handler does NOT do.**
//
//   - Authentication: enforced by the upgrade-time gate
//     (`ws_auth_on_connect`); `connection.user` is non-undefined on
//     every message the handler ever sees.
//   - Event-append, broadcast, transaction: none — this is a
//     read-only surface.
//   - Optimistic concurrency: no — there's no write to race against.
//   - Historical-point query (`at: <sequence>`): not in v1; the wire
//     schema accepts only `{ sessionId }`. See refinement Decisions.
//   - Labeled-checkpoint creation (Interpretation B): not in this
//     task; deferred to a future sibling once the methodology engine
//     grows a snapshot-create handler.

import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Event, WsEnvelope } from '@a-conversa/shared-types';

import type { DbPool } from '../../db.js';
import { ApiError } from '../../errors.js';
import { Projection } from '../../projection/projection.js';
import { projectFromLog } from '../../projection/replay.js';
import type {
  AxiomMarkRecord,
  FacetState,
  PerParticipantFacetState,
} from '../../projection/types.js';
import { canSeeSession } from '../../sessions/visibility.js';
import type { WsConnectionContext } from '../connection.js';
import type { WsDispatcher } from '../dispatcher.js';
import { serializeWsEnvelope } from '../envelope.js';
import type { WsSubscriptionRegistry } from '../subscriptions.js';

/**
 * Per-row shape returned from `SELECT ... FROM session_events ORDER BY
 * sequence ASC`. Mirrors the `SessionEventRow` in the four write
 * handlers (duplicated rather than imported to keep the handler
 * module self-contained — same convention).
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
 * Builder inputs — captured once at handler-registration time.
 * Minimal shape: no `broadcast` (read-only handler — no emit) and no
 * `now` (no event constructed — no `createdAt`).
 */
export interface SnapshotHandlerOptions {
  /** DB pool the visibility predicate + the event-log SELECT run against. */
  readonly pool: DbPool;
  /** Per-instance subscription registry — the subscribe-before-act gate. */
  readonly registry: WsSubscriptionRegistry;
  /** Logger for diagnostics. */
  readonly log: FastifyBaseLogger;
}

/**
 * Build the `snapshot` dispatcher handler. The returned closure
 * captures the pool / registry / log once; the dispatcher invokes it
 * per inbound `snapshot` envelope.
 */
export function buildSnapshotHandler(
  opts: SnapshotHandlerOptions,
): (envelope: WsEnvelope<'snapshot'>, connection: WsConnectionContext) => Promise<void> {
  return async (envelope, connection) => {
    const { sessionId } = envelope.payload;
    const userId = connection.user?.id;
    if (userId === undefined) {
      // Anonymous client (per ADR 0029 + `aud_anonymous_ws_subscribe`).
      // The snapshot envelope re-uses the visibility predicate; for
      // an anonymous viewer who could theoretically see a public
      // session, the snapshot envelope is still deferred to a future
      // leaf (the snapshot path's accounting + payload shape is
      // orthogonal to the broadcast-subscribe path). Reject with a
      // wire `forbidden` envelope so the client sees a typed code.
      throw ApiError.forbidden('this action requires an authenticated session', { sessionId });
    }

    // Gate 1 — subscribe-before-act. Identical to the propose/vote/
    // commit/mark-meta-disagreement handlers' first gate; the
    // `'forbidden'` code is reused from the existing `ApiError.code`
    // taxonomy. Rationale (see refinement Decisions): even a read of
    // session state is gated by subscription — uniform protocol-layer
    // invariant across every C→S request type. The HTTP `event-log`
    // endpoint (when it lands) is the surface for callers who want
    // the state WITHOUT subscribing to live deltas.
    const subscribers = opts.registry.connectionsForSession(sessionId);
    if (!subscribers.includes(connection.connectionId)) {
      throw ApiError.forbidden('not subscribed to this session — send a subscribe envelope first', {
        sessionId,
      });
    }

    // Gate 2 — visibility re-check. A session that became invisible
    // between the subscribe and this snapshot request surfaces as
    // not-found, inheriting the existence-non-leak rule from
    // `canSeeSession`.
    const visible = await canSeeSession(opts.pool, sessionId, userId);
    if (!visible) {
      throw ApiError.notFound('session not found or not visible', { sessionId });
    }

    // Event-log SELECT — single read, no transaction. Builds the
    // projection via `projectFromLog`, same primitive every write
    // handler uses. V1 replay-per-request; a cache-backed path is a
    // documented follow-up (the four write handlers will switch
    // atomically when the cache lands).
    const logRes = await opts.pool.query<SessionEventRow>(
      `SELECT id, session_id, sequence, kind, actor, payload, created_at
       FROM session_events
       WHERE session_id = $1
       ORDER BY sequence ASC`,
      [sessionId],
    );
    const events: Event[] = logRes.rows.map(rowToEvent);
    const projection = projectFromLog(events, sessionId);

    // Serialize + respond. The wire payload's `projection` field is
    // a JSON-safe object built from the `Projection` class's public
    // surface — Maps flattened to plain objects keyed by userId, all
    // record types unrolled to arrays. See
    // `serializeProjectionForWire` below for the shape.
    const response: WsEnvelope<'snapshot-state'> = {
      type: 'snapshot-state',
      id: randomUUID(),
      inResponseTo: envelope.id,
      payload: {
        sessionId,
        sequence: projection.lastAppliedSequence,
        projection: serializeProjectionForWire(projection),
      },
    };
    connection.socket.send(serializeWsEnvelope(response));
  };
}

/**
 * Register the snapshot handler against the dispatcher. Called by
 * `wsHandlersPlugin` once at registration time. Mirror of
 * `registerProposeHandlers` / `registerVoteHandlers` /
 * `registerCommitHandlers` / `registerMarkMetaDisagreementHandlers`.
 */
export function registerSnapshotHandlers(
  dispatcher: WsDispatcher,
  opts: SnapshotHandlerOptions,
): void {
  dispatcher.register('snapshot', buildSnapshotHandler(opts));
}

/**
 * Map a `session_events` row to the canonical `Event` envelope shape.
 * Duplicated from the four write handlers — same self-containment
 * reason.
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
 * Wire-friendly view of a `FacetState<T>`. `perParticipant` flattens
 * from a `Map<userId, PerParticipantFacetState>` to a plain object
 * keyed by userId. `status` / `value` / `committedProposalEventId` /
 * `committedAt` pass through unchanged.
 *
 * The shape is exported as a TypeScript type (not a Zod schema) for
 * the same reason the parent `snapshot-state` payload uses
 * `z.unknown()` for the projection field: the projection types are
 * locked by the `projection` work-stream and re-validating the
 * output of a pure function over schema-validated input would be
 * redundant. See refinement Decisions.
 */
interface FacetStateWire<TValue> {
  status: FacetState<TValue>['status'];
  value: TValue | null;
  perParticipant: Record<string, PerParticipantFacetState>;
  committedProposalEventId: string | null;
  committedAt: string | null;
}

function serializeFacetState<TValue>(facet: FacetState<TValue>): FacetStateWire<TValue> {
  const perParticipant: Record<string, PerParticipantFacetState> = {};
  for (const [userId, state] of facet.perParticipant) {
    perParticipant[userId] = state;
  }
  return {
    status: facet.status,
    value: facet.value,
    perParticipant,
    committedProposalEventId: facet.committedProposalEventId,
    committedAt: facet.committedAt,
  };
}

function serializeAxiomMarks(marks: Map<string, AxiomMarkRecord>): Record<string, AxiomMarkRecord> {
  const out: Record<string, AxiomMarkRecord> = {};
  for (const [userId, record] of marks) {
    out[userId] = record;
  }
  return out;
}

/**
 * Build the wire-friendly snapshot of a projection. Walks the
 * `Projection` class's public iterator + getter surface and emits a
 * plain JSON-serializable object. Map fields are flattened to plain
 * objects keyed by userId; iterators are materialized to arrays.
 *
 * The shape is documented in the `snapshot-state` payload's
 * docblock in `packages/shared-types/src/ws-envelope.ts` and pinned
 * by the unit tests in `snapshot.test.ts`.
 *
 * Exported for testability — the unit tests build a projection by
 * applying events to an empty instance and assert the serialized
 * shape directly, without standing up the full handler harness.
 */
export function serializeProjectionForWire(projection: Projection): Record<string, unknown> {
  return {
    sessionState: projection.sessionState,
    lastAppliedSequence: projection.lastAppliedSequence,
    participants: projection.currentParticipants(),
    nodes: Array.from(projection.nodes()).map((node) => ({
      id: node.id,
      wording: node.wording,
      createdBy: node.createdBy,
      createdAt: node.createdAt,
      visible: node.visible,
      wordingFacet: serializeFacetState(node.wordingFacet),
      classificationFacet: serializeFacetState(node.classificationFacet),
      substanceFacet: serializeFacetState(node.substanceFacet),
      axiomMarks: serializeAxiomMarks(node.axiomMarks),
    })),
    edges: Array.from(projection.edges()).map((edge) => ({
      id: edge.id,
      role: edge.role,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      createdBy: edge.createdBy,
      createdAt: edge.createdAt,
      visible: edge.visible,
      substanceFacet: serializeFacetState(edge.substanceFacet),
    })),
    annotations: Array.from(projection.annotations()).map((annotation) => ({
      id: annotation.id,
      kind: annotation.kind,
      content: annotation.content,
      targetNodeId: annotation.targetNodeId,
      targetEdgeId: annotation.targetEdgeId,
      createdBy: annotation.createdBy,
      createdAt: annotation.createdAt,
      visible: annotation.visible,
      wordingFacet: serializeFacetState(annotation.wordingFacet),
      substanceFacet: serializeFacetState(annotation.substanceFacet),
    })),
    pendingProposals: Array.from(projection.pendingProposals()),
    committedProposals: Array.from(projection.committedProposals()),
    snapshots: Array.from(projection.snapshots()),
    unresolvedMetaDisagreements: Array.from(projection.unresolvedMetaDisagreements()),
  };
}
