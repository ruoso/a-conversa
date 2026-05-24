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
// **Wire payload is a `target`-discriminated union** per [ADR 0030 §2 +
// §9](../../../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)
// and the refinement at `tasks/refinements/per-facet-refactor/
// pf_part_vote_action_facet_keyed.md`:
//
//   - `target: 'facet'` — names the `(entity_kind, entity_id, facet)`
//     triple. The handler resolves the facet's current candidate
//     proposal via `facet.candidateProposalEventId` on the post-replay
//     projection (mirroring the broadcast-side
//     `resolveFacetKeyedProposalId` helper) and threads the resolved
//     id into the `MethodologyAction.vote`. The engine's `voteHandler`
//     then emits the facet-keyed event arm.
//   - `target: 'proposal'` — names the proposal id directly. The
//     handler threads it through unchanged; the engine emits the
//     proposal-keyed event arm for the structural sub-kinds.
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

import type { Event, FacetName, ProposalPayload, WsEnvelope } from '@a-conversa/shared-types';

import type { DbPool } from '../../db.js';
import { ApiError, rejectedToApiError } from '../../errors.js';
import { appendSessionEvent } from '../../events/append.js';
import { validateEvent } from '../../events/validate.js';
import { validateAction } from '../../methodology/engine.js';
import type { VoteAction } from '../../methodology/types.js';
import type { Projection } from '../../projection/index.js';
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
    const { sessionId, expectedSequence, choice } = envelope.payload;
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

      // 4b. Resolve the proposalEventId the methodology engine expects.
      //     The wire payload is a `target`-discriminated union per ADR
      //     0030 §2 + §9 (+ refinement
      //     `pf_part_vote_action_facet_keyed`). The proposal-arm names
      //     the proposal id directly; the facet-arm names the
      //     `(entity_kind, entity_id, facet)` triple and the handler
      //     looks up the facet's current candidate proposal via the
      //     projection's `candidateProposalEventId` slot. The engine's
      //     `voteHandler` then dispatches by the proposal's sub-kind
      //     (facet-valued → emit `target: 'facet'` event; structural →
      //     emit `target: 'proposal'` event).
      let proposalEventId: string;
      if (envelope.payload.target === 'facet') {
        const resolved =
          resolveFacetCandidateProposalId(
            projection,
            envelope.payload.entity_kind,
            envelope.payload.entity_id,
            envelope.payload.facet,
          ) ??
          // Fallback: walk the event log for an OPEN proposal targeting
          // this `(entity_kind, entity_id, facet)`. Covers the
          // `capture-node` arm: the wording facet's candidate is
          // populated inline on `node-created` but the projection's
          // `candidateProposalEventId` is null (no facet-targeting sub-
          // kind drove the candidate — `firstFacetTargetForVote` returns
          // null for `capture-node`). The fallback mirrors the
          // participant-side `derivePendingFacetProposals` walk in
          // `apps/participant/src/detail/ParticipantVoteButtons.tsx`,
          // so what the participant's row binds to is what the server
          // resolves.
          resolveFacetPendingProposalFromLog(
            priorEvents,
            envelope.payload.entity_kind,
            envelope.payload.entity_id,
            envelope.payload.facet,
          );
        if (resolved === null) {
          throw rejectedToApiError({
            ok: false,
            reason: 'proposal-not-found',
            detail: `vote: facet ${envelope.payload.entity_kind}:${envelope.payload.entity_id}/${envelope.payload.facet} has no current candidate proposal to vote on`,
          });
        }
        proposalEventId = resolved;
      } else {
        proposalEventId = envelope.payload.proposalId;
      }

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
        proposalEventId,
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
 * Resolve the proposal id behind a facet-keyed vote envelope. Reads
 * `facet.candidateProposalEventId` from the post-replay projection —
 * the same slot the broadcast pipeline (`resolveFacetKeyedProposalId`
 * in `apps/server/src/ws/broadcast/proposal-status.ts`) uses to map
 * facet-keyed events back to their driving proposal.
 *
 * Returns `null` when the entity / facet is absent from the projection
 * or when the facet has no current candidate (e.g.
 * `awaiting-proposal`); the caller maps this to a `'proposal-not-found'`
 * rejection so the wire surface reports a typed error envelope.
 *
 * Mirrors the broadcast-side helper rather than re-exporting it — the
 * broadcast variant is keyed on a landed `Event` payload, whereas the
 * wire-time call here knows only the `(entity_kind, entity_id, facet)`
 * triple from the request payload. The two implementations stay
 * structurally identical; a future consolidation would re-export a
 * single helper.
 */
function resolveFacetCandidateProposalId(
  projection: Projection,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: FacetName,
): string | null {
  if (entityKind === 'node') {
    const node = projection.getNode(entityId);
    if (node === undefined) return null;
    if (facet === 'classification') return node.classificationFacet.candidateProposalEventId;
    if (facet === 'substance') return node.substanceFacet.candidateProposalEventId;
    if (facet === 'wording') return node.wordingFacet.candidateProposalEventId;
    // Nodes have no `'shape'` facet — the wire schema permits it via
    // the union but the projection has no slot. Fall through to null.
    return null;
  }
  // entityKind === 'edge'
  const edge = projection.getEdge(entityId);
  if (edge === undefined) return null;
  if (facet === 'substance') return edge.substanceFacet.candidateProposalEventId;
  if (facet === 'shape') return edge.shapeFacet.candidateProposalEventId;
  return null;
}

/**
 * Walk the session's event log for an OPEN proposal targeting
 * `(entityKind, entityId, facet)`. Returns the latest (closest-to-tail)
 * such proposal's event id, or `null` when no open candidate exists.
 *
 * "Open" means a `proposal` event whose id has not been closed by a
 * later `commit` (proposal-arm or matching facet-arm) or
 * `meta-disagreement-marked` event. Mirrors the participant-side
 * `derivePendingFacetProposals` walk in
 * `apps/participant/src/detail/ParticipantVoteButtons.tsx` — the same
 * single-pass shape, the same per-facet latest-wins rule. Used by the
 * facet-keyed vote handler as the fallback when the projection's
 * `candidateProposalEventId` slot is null (the `capture-node` arm:
 * the wording facet's candidate is populated inline on `node-created`
 * with no driving facet-targeting proposal, so the projection slot
 * stays null — but a `capture-node` proposal IS still the open proposal
 * the wording facet's vote is keyed to, per the methodology engine's
 * `facetTargetForProposal('capture-node') === wording`).
 */
function resolveFacetPendingProposalFromLog(
  events: readonly Event[],
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: FacetName,
): string | null {
  // proposalEventId → facet for facet-relevant proposals targeting THIS
  // (entityKind, entityId). Latest-wins per facet.
  const proposalIdByFacet = new Map<FacetName, string>();
  const closedProposalIds = new Set<string>();
  for (const event of events) {
    if (event.kind === 'proposal') {
      const target = facetTargetOfProposalPayload(event.payload.proposal);
      if (target === null) continue;
      if (target.entityKind !== entityKind) continue;
      if (target.entityId !== entityId) continue;
      proposalIdByFacet.set(target.facet, event.id);
    } else if (event.kind === 'commit') {
      if (event.payload.target === 'proposal') {
        closedProposalIds.add(event.payload.proposal_id);
      } else if (event.payload.entity_kind === entityKind && event.payload.entity_id === entityId) {
        const proposalId = proposalIdByFacet.get(event.payload.facet);
        if (proposalId !== undefined) closedProposalIds.add(proposalId);
      }
    } else if (event.kind === 'meta-disagreement-marked') {
      if (event.payload.target === 'proposal') {
        closedProposalIds.add(event.payload.proposal_id);
      } else if (event.payload.entity_kind === entityKind && event.payload.entity_id === entityId) {
        const proposalId = proposalIdByFacet.get(event.payload.facet);
        if (proposalId !== undefined) closedProposalIds.add(proposalId);
      }
    }
  }
  const candidate = proposalIdByFacet.get(facet);
  if (candidate === undefined) return null;
  if (closedProposalIds.has(candidate)) return null;
  return candidate;
}

/**
 * Resolve the facet target a proposal payload addresses for vote-time
 * purposes. Covers the four facet-valued sub-kinds (`classify-node` /
 * `set-node-substance` / `set-edge-substance` / `edit-wording`) AND
 * `capture-node` (which maps to the wording facet per ADR 0030 §1 +
 * §4). Returns `null` for structural sub-kinds (which carry no facet
 * target — they hold the proposal-keyed arm).
 *
 * Mirrors `facetTargetForProposal` in
 * `apps/server/src/methodology/handlers/vote.ts` — same coverage,
 * inlined here so the WS-layer fallback stays self-contained.
 */
function facetTargetOfProposalPayload(
  proposal: ProposalPayload,
): { entityKind: 'node' | 'edge'; entityId: string; facet: FacetName } | null {
  switch (proposal.kind) {
    case 'capture-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    case 'edit-wording':
    case 'amend-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    case 'classify-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'classification' };
    case 'set-node-substance':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'substance' };
    case 'set-edge-substance':
      return { entityKind: 'edge', entityId: proposal.edge_id, facet: 'substance' };
    default:
      return null;
  }
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
