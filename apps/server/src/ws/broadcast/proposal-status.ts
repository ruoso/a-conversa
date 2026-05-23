// `proposal-status` broadcast subscriber — fan out a server-emitted
// derived envelope carrying the current per-facet status for the
// proposal a just-appended event modified.
//
// Refinement: tasks/refinements/backend/ws_proposal_status_broadcast.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_proposal_status_broadcast
//
// **What this module owns.**
//
//   1. `buildProposalStatusBroadcastListener(...)` — a pure builder
//      that captures the subscription registry, the connection-sender
//      registry, the event loader, and the logger, and returns a
//      `WsBroadcastListener` ready to register on the bus. Pure so the
//      filter/compute/fan-out behaviour is unit-testable without
//      standing up a Fastify instance or a real DB pool.
//   2. `wsProposalStatusBroadcastPlugin` — the Fastify plugin that
//      wires the listener against `app.wsBroadcast`. Registered AFTER
//      `wsEventAppliedBroadcastPlugin` in `server.ts` so the
//      registration order (and therefore the synchronous-dispatch
//      order on the bus) is `event-applied` → `proposal-status`.
//
// **Filter set.** The listener only proceeds for the four event kinds
// that can modify per-facet proposal status:
//
//   - `proposal`           — adds a new pending proposal (status →
//                            `proposed` for the addressed facet).
//   - `vote`               — covers all three vote arms (`agree`,
//                            `dispute`, `withdraw`); withdrawal is a
//                            vote variant per `events.ts`, not a
//                            separate event kind.
//   - `commit`             — a moderator commits an `agreed` facet to
//                            `committed`.
//   - `meta-disagreement-marked` — a moderator marks the proposal as
//                            `meta-disagreement`.
//
// Every other event kind (session-created, participant-joined,
// entity-included, node-created, edge-created, annotation-created,
// session-ended, snapshot-created, participant-left) does NOT affect
// per-facet status and the listener returns early — no broadcast.
//
// **Facet-targeting vs. structural proposals.** Of the eleven proposal
// sub-kinds in `events/proposals.ts`, six contribute facet targets:
//
//   - `classify-node`         → node.classification (1 target)
//   - `set-node-substance`    → node.substance      (1 target)
//   - `set-edge-substance`    → edge.substance      (1 target)
//   - `edit-wording`          → node.wording        (1 target)
//   - `decompose`             → N × node.classification (one per component)
//   - `interpretive-split`    → N × node.classification (one per reading)
//
// The remaining five (axiom-mark / meta-move / break-edge / amend-node /
// annotate) are structural — they have no facet target and
// `deriveFacetStatus` cannot answer for them. The subscriber skips
// those: no broadcast.
//
// **Per-component fan-out for decompose / interpretive-split.** Per the
// refinement at `tasks/refinements/backend/facet_status_server_decompose_component_facets.md`
// the listener emits one envelope per component (not one envelope with
// N component facets). All N envelopes share the same `proposalId` +
// `sequence` but carry distinct server-minted UUIDs; each envelope's
// `perFacetStatus` is keyed by `FacetName` (the wire shape is
// unchanged) and carries the per-component classification status the
// projection derives. The moderator-side client mirror at
// `apps/moderator/src/graph/facetStatus.ts` walks the same per-component
// derivation locally; this server-side arm is the symmetric source for
// the participant + audience surfaces that consume the broadcast
// directly.
//
// **Source of truth for the status value.** `deriveFacetStatus(...)`
// from `apps/server/src/projection/facet-status.ts`. The wire payload
// reflects what that function returns — no separate derivation here,
// no recomputation of the precedence rules. The projection itself is
// built fresh from the event log via `projectFromLog` (matching the
// snapshot handler's pattern) since the server has no live per-session
// projection cache decorator today; "Take the projection AT the
// current event's sequence" is honoured because the bus emits AFTER
// the DB commits and we SELECT events `WHERE sequence <= event.sequence`
// ordered ASC. The replay sees exactly the state up to and including
// the triggering event.
//
// **Ordering relative to `event-applied`.** The bus is synchronous
// (mirroring `DiagnosticBus`) and dispatches to listeners in
// registration order. `wsEventAppliedBroadcastPlugin` registers its
// listener first; `wsProposalStatusBroadcastPlugin` registers second.
// So for each emit on the bus, the event-applied listener completes
// (synchronously sending its envelope to every subscriber) BEFORE this
// listener's synchronous prefix runs. This listener returns a Promise
// (async DB query + projection replay), so the actual `proposal-status`
// fan-out happens after the event-applied fan-out has finished.
//
// **Per-connection error isolation.** Mirror of `event-applied.ts`'s
// contract: one bad sender logged at warn level + the iteration
// continues so the other senders still receive the broadcast.

import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import type { Event, ProposalPayload, WsEnvelope } from '@a-conversa/shared-types';

import type { DbPool } from '../../db.js';
import { getDefaultPool } from '../../db.js';
import { deriveFacetStatus } from '../../projection/facet-status.js';
import { Projection } from '../../projection/projection.js';
import { projectFromLog } from '../../projection/replay.js';
import type { FacetName, FacetStatus } from '../../projection/types.js';

import { wsBroadcastPlugin, type EventAppliedBusEvent, type WsBroadcastListener } from './bus.js';
import { wsConnectionSendersPlugin, type WsConnectionSenderRegistry } from './connections.js';
import type { WsSubscriptionRegistry } from '../subscriptions.js';

/**
 * Per-row shape returned by the event-loader's SELECT against
 * `session_events`. Mirrors `SessionEventRow` in `snapshot.ts` (and
 * each write handler) — duplicated locally to keep this module's
 * dependency surface narrow.
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
 * The closure that loads events for the affected session up to (and
 * including) the triggering event's sequence. Defaulted to a SELECT
 * against `app.dbPool` when the listener is constructed via the
 * plugin; injectable for the Vitest unit tests so they don't need a
 * real pool.
 *
 * Loader contract: returns the session's events with `sequence <=
 * upToSequence` in ascending order. The replay needs the full prefix
 * up to that point — the post-commit-emit invariant means by the time
 * the listener runs the row IS in the DB, so a `<=` filter is
 * deterministic.
 */
export type ProposalStatusEventLoader = (
  sessionId: string,
  upToSequence: number,
) => Promise<Event[]>;

/**
 * Options for `buildProposalStatusBroadcastListener`. Captures the
 * subscription registry, the connection-sender registry, the event
 * loader, and a logger.
 */
export interface ProposalStatusBroadcastListenerOptions {
  /** Per-app-instance subscription registry. */
  readonly subscriptions: WsSubscriptionRegistry;
  /** Per-app-instance connection-sender registry. */
  readonly connectionSenders: WsConnectionSenderRegistry;
  /** Event loader — see `ProposalStatusEventLoader`. */
  readonly loadEvents: ProposalStatusEventLoader;
  /** Logger for diagnostics + per-connection error isolation. */
  readonly log: FastifyBaseLogger;
}

// Set of `event.kind` values that can change per-facet status. Other
// kinds are filtered out at the top of the listener.
const STATUS_AFFECTING_KINDS = new Set(['proposal', 'vote', 'commit', 'meta-disagreement-marked']);

/**
 * Extract the `proposalId` (the proposal-event's `id`) the event
 * affects. For `proposal` events that's the event's own `id`; for
 * `vote` / `commit` / `meta-disagreement-marked` events it's the
 * `proposal_id` field on the payload. Returns `null` for any other
 * event kind (the filter at the call site should prevent that, but
 * the guard keeps the helper total).
 */
function proposalIdFor(event: Event): string | null {
  switch (event.kind) {
    case 'proposal':
      return event.id;
    case 'vote':
      // TODO(pf_vote_handler_facet_keyed): vote payloads are now a
      // `target`-discriminated union. The methodology engine still
      // emits the proposal-keyed arm; once the downstream task lands
      // facet-keyed emission this needs to resolve the broadcast
      // subject differently (most likely by looking up the proposal
      // that targets the entity+facet pair). Until then we read the
      // proposal-keyed arm only.
      if (event.payload.target === 'proposal') {
        return event.payload.proposal_id;
      }
      return null;
    case 'commit':
    case 'meta-disagreement-marked':
      return event.payload.proposal_id;
    default:
      return null;
  }
}

/** Target of a facet-changing proposal. */
interface FacetTarget {
  entityKind: 'node' | 'edge' | 'annotation';
  entityId: string;
  facet: FacetName;
}

/**
 * Map a proposal payload to its per-target list of (entityKind,
 * entityId, facet) facets. Returns:
 *
 *   - A 1-element array for the four single-target sub-kinds
 *     (`classify-node`, `set-node-substance`, `set-edge-substance`,
 *     `edit-wording`).
 *   - An N-element array for the two multi-component sub-kinds
 *     (`decompose` — one per component; `interpretive-split` — one per
 *     reading). Each per-component target addresses the component's
 *     classification facet; per D6 of the refinement, the wording +
 *     substance facets are NOT emitted in v1 (the moderator-side mirror
 *     at `apps/moderator/src/graph/facetStatus.ts:239-262` walks the
 *     same classification-only scope, and this arm stays in lockstep).
 *   - An empty array for the five structural sub-kinds (`axiom-mark`,
 *     `meta-move`, `break-edge`, `amend-node`, `annotate`).
 *
 * Per the refinement's D7, the per-component iteration order mirrors
 * the proposal's `components` / `readings` array order — the same
 * convention the propose handler uses for the per-component
 * `node-created` + `entity-included` fan-out.
 *
 * Mirrors the per-component arm at
 * `apps/moderator/src/graph/facetStatus.ts:239-262`. The private
 * `facetTargetForProposal` in `apps/server/src/projection/replay.ts`
 * remains the canonical single-target helper for the dispatcher;
 * keeping both narrow + structural avoids exporting an unstable
 * private helper out of `replay.ts`.
 */
function facetTargetsForProposal(payload: ProposalPayload): readonly FacetTarget[] {
  switch (payload.kind) {
    case 'classify-node':
      return [{ entityKind: 'node', entityId: payload.node_id, facet: 'classification' }];
    case 'set-node-substance':
      return [{ entityKind: 'node', entityId: payload.node_id, facet: 'substance' }];
    case 'set-edge-substance':
      return [{ entityKind: 'edge', entityId: payload.edge_id, facet: 'substance' }];
    case 'edit-wording':
      return [{ entityKind: 'node', entityId: payload.node_id, facet: 'wording' }];
    case 'decompose':
      return payload.components.map((component) => ({
        entityKind: 'node' as const,
        entityId: component.node_id,
        facet: 'classification' as const,
      }));
    case 'interpretive-split':
      return payload.readings.map((reading) => ({
        entityKind: 'node' as const,
        entityId: reading.node_id,
        facet: 'classification' as const,
      }));
    default:
      // axiom-mark, meta-move, break-edge, amend-node, annotate —
      // structural sub-kinds with no facet target.
      return [];
  }
}

/**
 * Look up the proposal payload behind a `proposalId` in the
 * post-event projection. A proposal may live in any of three slots
 * depending on its lifecycle stage:
 *
 *   - `pendingProposals`           — pre-commit, pre-meta-disagreement.
 *   - `committedProposals`         — post-commit.
 *   - `unresolvedMetaDisagreements` — post-meta-disagreement-mark.
 *
 * Returns `null` if the proposal is absent — which would be a
 * projection-invariant violation given the triggering event already
 * referenced it. The listener treats `null` as "skip the broadcast"
 * rather than throw, mirroring the per-connection error-isolation
 * philosophy: a wedged broadcast surface is worse than a missed
 * derived frame.
 */
function lookupProposalPayload(projection: Projection, proposalId: string): ProposalPayload | null {
  const pending = projection.getPendingProposal(proposalId);
  if (pending) return pending.payload;
  const committed = projection.getCommittedProposal(proposalId);
  if (committed) return committed.payload;
  const md = projection.getUnresolvedMetaDisagreement(proposalId);
  if (md) return md.payload;
  return null;
}

/**
 * Build the bus listener that fans out `proposal-status` derived
 * envelopes for events that affect per-facet proposal status.
 *
 * The returned listener is `async` — it returns a Promise so the bus
 * (which is synchronous and discards the listener's return value)
 * fires this work AFTER the event-applied listener completes
 * synchronously. The actual send happens once the loader resolves and
 * the projection replay finishes. See the module header for the
 * ordering invariant.
 */
export function buildProposalStatusBroadcastListener(
  opts: ProposalStatusBroadcastListenerOptions,
): WsBroadcastListener {
  return (evt: EventAppliedBusEvent) => {
    const { event } = evt;

    // Filter — short-circuit on kinds that can't change status. The
    // event-applied listener has already fanned out the raw frame;
    // doing nothing here for an entity-included or session-created
    // event is the intended behaviour.
    if (!STATUS_AFFECTING_KINDS.has(event.kind)) {
      return;
    }

    const proposalId = proposalIdFor(event);
    if (proposalId === null) {
      // Defensive — the filter above narrows `event.kind`, but a
      // future widening of the kind set without updating
      // `proposalIdFor` would surface here. Skip + log.
      opts.log.warn(
        { eventKind: event.kind, eventId: event.id, eventSequence: event.sequence },
        'ws-proposal-status: no proposalId resolvable for status-affecting event kind',
      );
      return;
    }

    const sessionId = event.sessionId;
    const connectionIds = opts.subscriptions.connectionsForSession(sessionId);
    if (connectionIds.length === 0) {
      // Nothing to do — no subscribers means no fan-out targets.
      // Skipping the projection load avoids the SELECT cost on a
      // session no one is watching.
      return;
    }

    // Kick off the async derive + fan-out. The bus discards the
    // returned promise; the await chain runs after this synchronous
    // listener body returns, which (importantly) is after the
    // event-applied listener has completed its synchronous fan-out.
    void deriveAndFanOut(opts, event, proposalId, sessionId, connectionIds);
  };
}

/**
 * The async tail of the listener — separated so the bus-facing
 * function stays synchronous (matching the bus's listener signature)
 * while the DB load + projection replay live in a Promise the bus
 * does not await.
 */
async function deriveAndFanOut(
  opts: ProposalStatusBroadcastListenerOptions,
  event: Event,
  proposalId: string,
  sessionId: string,
  connectionIds: readonly string[],
): Promise<void> {
  let projection: Projection;
  try {
    const events = await opts.loadEvents(sessionId, event.sequence);
    projection = projectFromLog(events, sessionId);
  } catch (err) {
    opts.log.warn(
      {
        err,
        sessionId,
        proposalId,
        eventKind: event.kind,
        eventSequence: event.sequence,
      },
      'ws-proposal-status: projection load/replay failed — skipping derived broadcast',
    );
    return;
  }

  const payload = lookupProposalPayload(projection, proposalId);
  if (payload === null) {
    // The proposal is not in the projection — this is a projection-
    // invariant violation given the triggering event referenced it.
    // Logging + skipping rather than throwing keeps the broadcast
    // surface from wedging on a bad projection state.
    opts.log.warn(
      {
        sessionId,
        proposalId,
        eventKind: event.kind,
        eventSequence: event.sequence,
      },
      'ws-proposal-status: proposal not found in projection — skipping derived broadcast',
    );
    return;
  }

  const targets = facetTargetsForProposal(payload);
  if (targets.length === 0) {
    // Structural sub-kind — no facets, no broadcast. Not an error;
    // the methodology has no `FacetStatus` to surface for axiom-mark
    // / meta-move / break-edge / amend-node / annotate, so no wire
    // frame is emitted.
    return;
  }

  // Per target: derive status and fan out one envelope. Per the
  // refinement's D2, each envelope shares the same `proposalId` +
  // `sequence` but carries a distinct server-minted UUID `id`. Per
  // D7, iteration order mirrors the proposal's `components` /
  // `readings` array order — matching the propose handler's
  // structural-event fan-out order so receivers observe a consistent
  // per-component ordering between the `event-applied` and
  // `proposal-status` streams.
  for (const target of targets) {
    let status: FacetStatus;
    try {
      status = deriveFacetStatus(projection, target.entityKind, target.entityId, target.facet);
    } catch (err) {
      opts.log.warn(
        {
          err,
          sessionId,
          proposalId,
          eventKind: event.kind,
          eventSequence: event.sequence,
          target,
        },
        'ws-proposal-status: deriveFacetStatus threw — skipping derived broadcast for target',
      );
      // Per-target error isolation: one failed derivation does not
      // abort the rest of the fan-out. Mirror of the per-connection
      // error-isolation contract.
      continue;
    }

    // Build the envelope ONCE per target per fan-out (server-minted
    // UUID per envelope per the existing fan-out contract; receivers
    // de-duplicate by `id` if a reconnect replays). The same envelope
    // reference is shared across all subscribed connections for this
    // target.
    const envelope: WsEnvelope<'proposal-status'> = {
      type: 'proposal-status',
      id: randomUUID(),
      payload: {
        sessionId,
        proposalId,
        sequence: event.sequence,
        perFacetStatus: { [target.facet]: status },
      },
    };

    for (const connectionId of connectionIds) {
      const sender = opts.connectionSenders.get(connectionId);
      if (sender === undefined) {
        // Close-race window — connection unregistered between the
        // initial snapshot and this iteration. Skip, same as
        // `event-applied.ts`.
        continue;
      }
      try {
        sender(envelope);
      } catch (err) {
        // Per-connection error isolation — one bad socket does not
        // break the fan-out (and a send-failure on target i does not
        // abort the dispatch for target i+1).
        opts.log.warn(
          {
            err,
            connectionId,
            sessionId,
            proposalId,
            messageId: envelope.id,
            eventKind: event.kind,
            eventSequence: event.sequence,
          },
          'ws-proposal-status-send-failed — skipping connection (one bad socket does not break fan-out)',
        );
      }
    }
  }
}

/**
 * Map a `session_events` row to the canonical `Event` envelope shape.
 * Mirrors the same helper in `snapshot.ts` and the four write
 * handlers — duplicated rather than imported to keep the module
 * self-contained (same convention).
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
 * Build a pool-backed event loader. The plugin uses this; the unit
 * tests inject their own loader directly to avoid a DB dependency.
 *
 * The SELECT bounds events to `sequence <= upToSequence` so the
 * replay yields the projection state AT the triggering event — not
 * the latest. (By the time this runs, the triggering event has
 * already been committed by the route's transaction; the post-
 * commit-emit invariant guarantees that.)
 */
export function buildPoolEventLoader(pool: DbPool): ProposalStatusEventLoader {
  return async (sessionId, upToSequence) => {
    const res = await pool.query<SessionEventRow>(
      `SELECT id, session_id, sequence, kind, actor, payload, created_at
       FROM session_events
       WHERE session_id = $1 AND sequence <= $2
       ORDER BY sequence ASC`,
      [sessionId, upToSequence],
    );
    return res.rows.map(rowToEvent);
  };
}

/**
 * Options accepted by `wsProposalStatusBroadcastPlugin`. Production
 * callers pass `{}` (or nothing) and the plugin reaches for
 * `getDefaultPool()` on first dispatch. Tests pass a memory-backed or
 * pglite-backed pool so the event-loader hits the test DB.
 */
export interface WsProposalStatusBroadcastOptions {
  /**
   * Database pool used by the default event loader. When absent the
   * plugin lazily calls `getDefaultPool()` on first listener
   * invocation.
   */
  readonly pool?: DbPool;
}

/**
 * Fastify plugin: register the `proposal-status` broadcast listener
 * against `app.wsBroadcast`. Depends on:
 *
 *   - `wsBroadcastPlugin` — provides `app.wsBroadcast` (the bus).
 *   - `wsConnectionSendersPlugin` — provides `app.wsConnectionSenders`.
 *   - `wsSubscriptionsPlugin` — provides `app.wsSubscriptions`.
 *
 * Lazy pool resolution mirrors `wsHandlersPlugin`'s pattern: tests
 * inject the pool up front; production callers pass `{}` and the
 * singleton resolves on first dispatch.
 *
 * **Registration order matters.** This plugin MUST register AFTER
 * `wsEventAppliedBroadcastPlugin` so the bus's synchronous dispatch
 * fires event-applied first, then proposal-status. The caller (see
 * `server.ts`) is responsible for the order; this plugin only
 * registers its own listener.
 */
const wsProposalStatusBroadcastPluginAsync: FastifyPluginAsync<
  WsProposalStatusBroadcastOptions
> = async (app: FastifyInstance, opts: WsProposalStatusBroadcastOptions) => {
  // Register transitively-required decorators so this plugin can be
  // registered standalone in a test app without the caller having to
  // remember the order. The plugin wrappers are idempotent (each
  // plugin's body checks `hasDecorator` first).
  await app.register(wsBroadcastPlugin);
  await app.register(wsConnectionSendersPlugin);

  // Lazy pool resolution — same pattern `wsHandlersPlugin` uses.
  let resolvedPool: DbPool | undefined = opts.pool;
  const ensurePool = (): DbPool => {
    if (resolvedPool !== undefined) return resolvedPool;
    resolvedPool = getDefaultPool();
    return resolvedPool;
  };

  // Compose the default pool-backed loader at first-use. Wrapping in
  // a thunk keeps the lazy-resolution semantics — a test pool injected
  // via options short-circuits the `getDefaultPool()` call entirely.
  const loadEvents: ProposalStatusEventLoader = async (sessionId, upToSequence) => {
    const loader = buildPoolEventLoader(ensurePool());
    return loader(sessionId, upToSequence);
  };

  app.wsBroadcast.on(
    'event-applied',
    buildProposalStatusBroadcastListener({
      subscriptions: app.wsSubscriptions,
      connectionSenders: app.wsConnectionSenders,
      loadEvents,
      log: app.log,
    }),
  );
};

export const wsProposalStatusBroadcastPlugin = fp(wsProposalStatusBroadcastPluginAsync, {
  name: 'a-conversa-ws-proposal-status-broadcast',
  fastify: '5.x',
});
