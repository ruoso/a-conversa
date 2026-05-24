// Dispatcher handler for `commit` client → server messages.
//
// Refinement: tasks/refinements/backend/ws_commit_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_commit_message
//
// **What this module owns.**
//
// `buildCommitHandler({ pool, registry, broadcast, log, now? })` —
// returns a `WsDispatcher` handler for the `'commit'` envelope.
// Structurally mirrors `buildProposeHandler` + `buildVoteHandler`:
// same gate stack, same transactional load-validate-append, same
// post-commit dual-signal (`event-applied` broadcast + `committed`
// ack), same `rejectedToApiError` mapping to the wire `error`
// envelope via the dispatcher's `onHandlerError` seam.
//
// The commit handler differs from propose/vote in exactly three places:
//
//   1. The action it constructs — `MethodologyAction.commit` instead
//      of `MethodologyAction.propose` / `.vote`. The action carries
//      `proposalEventId` + `committedAt` (mirrored from `createdAt`).
//   2. The engine call returns one `commit` event (per
//      `commitHandler` in `methodology/handlers/commit.ts`).
//   3. The ack envelope type — `'committed'` instead of `'proposed'`
//      / `'voted'`.
//
// Everything else is identical and intentionally so: the headline
// authority gate (moderator-only) is enforced by the engine's
// `not-a-moderator` rejection (rule 1 of `commitHandler`), surfaced
// here via `rejectedToApiError` as the wire `error` envelope with
// `code: 'not-a-moderator'`.
//
// **Moderator identity comes from the connection, not the payload.**
// The handler reads `connection.user.id` and uses it as both the
// methodology requester (the actor the engine checks against the
// moderator role) AND the event actor. The request payload has NO
// `moderatorId` field — the wire schema `wsCommitPayloadSchema` does
// not declare one. Symmetric with `propose` (no `proposerId`) and
// `vote` (no `voterId`). Pinned by the unit-test
// `even-when-the-client-tries-to-spoof-moderatorId` case.
//
// **Engine-emitted events.** The engine's `commitHandler` emits
// exactly ONE event (a `commit` event) for a commit action today.
// The read-side projection's `handleCommit` (in
// `apps/server/src/projection/replay.ts`) is what marks the affected
// facet `agreed` and moves the proposal from `pendingProposals` to
// `committedProposals` — but that runs on every subscriber's local
// incremental `applyEvent` against the broadcast `event-applied`
// frame; no additional wire frames are required.
//
// **What this handler does NOT do.**
//
//   - Authentication: enforced by the upgrade-time gate
//     (`ws_auth_on_connect`); `connection.user` is non-undefined.
//   - Schema validation of `payload`: enforced upstream by
//     `parseWsEnvelope` against `wsCommitPayloadSchema`.
//   - Methodology-rule re-implementation: every rule lives in the
//     engine's `commitHandler` (see
//     `apps/server/src/methodology/handlers/commit.ts`).

import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Event, FacetName, ProposalPayload, WsEnvelope } from '@a-conversa/shared-types';

import type { DbPool } from '../../db.js';
import { ApiError, rejectedToApiError } from '../../errors.js';
import { appendSessionEvent } from '../../events/append.js';
import { validateEvent } from '../../events/validate.js';
import { validateAction } from '../../methodology/engine.js';
import type { CommitAction } from '../../methodology/types.js';
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
 * sequence ASC`. Mirrors the `SessionEventRow` in `propose.ts` /
 * `vote.ts` (duplicated rather than imported to keep the handler
 * self-contained; if/when these helpers move to a shared module both
 * call sites switch atomically).
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
 * shape as `ProposeHandlerOptions` / `VoteHandlerOptions`.
 */
export interface CommitHandlerOptions {
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
 * Build the `commit` dispatcher handler. The returned closure captures
 * the pool / registry / broadcast / log / clock once; the dispatcher
 * invokes it per inbound `commit` envelope.
 */
export function buildCommitHandler(
  opts: CommitHandlerOptions,
): (envelope: WsEnvelope<'commit'>, connection: WsConnectionContext) => Promise<void> {
  const nowFn = opts.now ?? Date.now;
  return async (envelope, connection) => {
    const { sessionId, expectedSequence } = envelope.payload;
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

    // Gate 1 — subscribe-before-act. Identical to the propose/vote
    // handler's gate; the `'forbidden'` code is reused from the
    // existing `ApiError.code` taxonomy.
    const subscribers = opts.registry.connectionsForSession(sessionId);
    if (!subscribers.includes(connection.connectionId)) {
      throw ApiError.forbidden('not subscribed to this session — send a subscribe envelope first', {
        sessionId,
      });
    }

    // Gate 2 — visibility re-check. A session that became invisible
    // between the subscribe and this commit surfaces as not-found,
    // inheriting the existence-non-leak rule from `canSeeSession`.
    const visible = await canSeeSession(opts.pool, sessionId, userId);
    if (!visible) {
      throw ApiError.notFound('session not found or not visible', { sessionId });
    }

    // Transactional load-validate-append. Identical shape to the
    // propose/vote handlers: FOR UPDATE on the `sessions` row,
    // MAX(sequence) read, engine validation, schema-on-write
    // `validateEvent`, `appendSessionEvent`. Events appended inside
    // the transaction are collected for the post-COMMIT broadcast emit.
    const appendedEvents: Event[] = [];
    const commitEventId = await withTransaction(opts.pool, async (client) => {
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
          detail: `commit: expectedSequence=${String(expectedSequence)} does not match server MAX(sequence)=${String(maxSeq)} for session ${sessionId} — your view of the session is stale`,
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
      //     `pf_mod_pending_proposals_pane_facet_keyed`). The proposal
      //     arm names the proposal id directly; the facet arm names the
      //     `(entity_kind, entity_id, facet)` triple and the handler
      //     looks up the facet's current candidate proposal via the
      //     projection's `candidateProposalEventId` slot (mirroring the
      //     vote-facet arm in `apps/server/src/ws/handlers/vote.ts`).
      //     The engine's `commitHandler` then dispatches on the
      //     proposal's sub-kind (facet-valued → emit `target: 'facet'`
      //     event; structural → emit `target: 'proposal'` event).
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
          // `candidateProposalEventId` is null (no facet-targeting
          // sub-kind drove the candidate — `firstFacetTargetForVote`
          // returns null for `capture-node`). Mirrors the vote handler's
          // identical fallback so the commit and vote handlers stay
          // structurally symmetric on this case.
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
            detail: `commit: facet ${envelope.payload.entity_kind}:${envelope.payload.entity_id}/${envelope.payload.facet} has no current candidate proposal to commit`,
          });
        }
        proposalEventId = resolved;
      } else {
        proposalEventId = envelope.payload.proposalId;
      }

      // 5. Build the `MethodologyAction.commit` and run it through the
      //    engine. The moderator identity comes from the AUTHENTICATED
      //    connection — never from the payload (security invariant; see
      //    refinement Decisions). `requester` (methodology gate — this
      //    is the user the engine's `requireModerator` check runs
      //    against) and `actor` (event column) both use `userId`.
      //    `committedAt` mirrors `createdAt` (single clock source).
      const eventId = randomUUID();
      const createdAtIso = new Date(nowFn()).toISOString();
      const action: CommitAction = {
        kind: 'commit',
        requester: userId,
        sessionId,
        eventId,
        sequence: nextSeq,
        actor: userId,
        createdAt: createdAtIso,
        proposalEventId,
        committedAt: createdAtIso,
      };
      const result = validateAction(projection, action);
      if (!result.ok) {
        // The engine's `not-a-moderator` rejection (rule 1 of
        // `commitHandler`) lands here for a non-moderator subscribed
        // participant; `rejectedToApiError` maps it to a 403 with
        // `code: 'not-a-moderator'`. That is the headline authority
        // gate for this handler — pinned by the
        // `non-moderator → not-a-moderator` unit test.
        throw rejectedToApiError(result);
      }
      // The engine emits at least one event per commit action: the
      // `commit` envelope. Some structural sub-kinds (`annotate`)
      // additionally emit paired entity-creation events that precede
      // the commit envelope so the incremental `applyEvent` projects
      // the new entity BEFORE `handleCommit` runs. The commit envelope
      // is always the LAST event in the returned list (its sequence is
      // `action.sequence + structuralEvents.length`); the WS ack
      // carries that last event's id so the moderator's request-
      // response correlation lands on the commit envelope.
      if (result.events.length === 0) {
        throw new Error('ws-commit: engine produced 0 events (expected at least 1)');
      }
      const commitEnvelopeEvent = result.events[result.events.length - 1]!;
      if (commitEnvelopeEvent.kind !== 'commit') {
        throw new Error(
          `ws-commit: last emitted event is '${commitEnvelopeEvent.kind}' (expected 'commit')`,
        );
      }

      // 6. Schema-on-write — every row in `session_events` is
      //    structurally valid by construction (ADR 0021). Validate +
      //    append each engine-emitted event in order so subscribers
      //    see structural events before the `commit` envelope.
      for (const emitted of result.events) {
        validateEvent(emitted);
        appendedEvents.push(await appendSessionEvent(client, emitted));
      }

      return eventId;
    });

    // Post-commit emit + ack. Same ordering as the propose/vote
    // handlers: emit FIRST so every subscribed client (including the
    // moderator) receives the `event-applied` envelope, THEN send the
    // request-correlated `committed` ack on the moderator's socket.
    for (const evt of appendedEvents) {
      opts.broadcast.emit({ event: evt });
    }
    // The `commit` envelope is always the LAST event in `appendedEvents`
    // (the engine emits any structural fan-out before the commit
    // envelope, mirroring the propose handler's structural-then-envelope
    // shape). The ack carries the commit envelope's sequence so the
    // client's request-response correlation lands on the commit.
    const commitEnvelope = appendedEvents[appendedEvents.length - 1]!;
    const ack: WsEnvelope<'committed'> = {
      type: 'committed',
      id: randomUUID(),
      inResponseTo: envelope.id,
      payload: {
        sessionId,
        sequence: commitEnvelope.sequence,
        eventId: commitEventId,
      },
    };
    connection.socket.send(serializeWsEnvelope(ack));
  };
}

/**
 * Register the commit handler against the dispatcher. Called by
 * `wsHandlersPlugin` once at registration time. Mirror of
 * `registerProposeHandlers` / `registerVoteHandlers`.
 */
export function registerCommitHandlers(dispatcher: WsDispatcher, opts: CommitHandlerOptions): void {
  dispatcher.register('commit', buildCommitHandler(opts));
}

/**
 * Resolve the proposal id behind a facet-keyed commit envelope. Reads
 * `facet.candidateProposalEventId` from the post-replay projection —
 * the same slot the broadcast pipeline (`resolveFacetKeyedProposalId`
 * in `apps/server/src/ws/broadcast/proposal-status.ts`) uses to map
 * facet-keyed events back to their driving proposal. Mirrors the
 * sibling helper of the same name in
 * `apps/server/src/ws/handlers/vote.ts`.
 *
 * Returns `null` when the entity / facet is absent from the projection
 * or when the facet has no current candidate (e.g. `awaiting-proposal`);
 * the caller maps this to a `'proposal-not-found'` rejection so the
 * wire surface reports a typed error envelope.
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
 * Mirrors `resolveFacetPendingProposalFromLog` in
 * `apps/server/src/ws/handlers/vote.ts` — same single-pass walk, same
 * latest-wins rule per facet, same close-out by commit / meta-disagreement-
 * marked. Used as the fallback when `facet.candidateProposalEventId` is
 * null (the `capture-node` arm: the wording facet's candidate is
 * populated inline on `node-created` with no driving facet-targeting
 * proposal — but a `capture-node` proposal IS still the open proposal
 * whose commit walks against the wording facet).
 */
function resolveFacetPendingProposalFromLog(
  events: readonly Event[],
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: FacetName,
): string | null {
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
 * Resolve the facet target a proposal payload addresses for commit-time
 * purposes. Covers the four facet-valued sub-kinds (`classify-node` /
 * `set-node-substance` / `set-edge-substance` / `edit-wording`) AND
 * `capture-node` (which maps to the wording facet per ADR 0030 §1 +
 * §4). Returns `null` for structural sub-kinds (which carry no facet
 * target — they hold the proposal-keyed arm).
 *
 * Mirrors the sibling helper of the same name in
 * `apps/server/src/ws/handlers/vote.ts`.
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
 * Mirrors the helper in `propose.ts` / `vote.ts`.
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
 * `propose.ts` / `vote.ts` and `sessions/routes.ts` — duplicated here
 * to keep the handler module self-contained.
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
 * `propose.ts` / `vote.ts` — duplicated here for the same
 * self-containment reason.
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
