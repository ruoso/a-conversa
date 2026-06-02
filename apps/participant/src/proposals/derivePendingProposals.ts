// Pure selector that derives the participant pending-proposals pane's
// list from a session's event log.
//
// Refinement: tasks/refinements/participant-ui/part_proposal_list_view.md
//
// `derivePendingProposals(events)` walks `useWsStore.sessionState[id].events`
// once, collects every `kind === 'proposal'` envelope, and removes any
// proposal whose id has been referenced by a `commit` or
// `meta-disagreement-marked` event, OR whose propose-time-minted entities
// have been retracted by `entity-removed` events (a withdraw — the three
// lifecycle terminators). The surviving set is returned newest-first by
// event `sequence` (descending) so the pane renders the freshly-proposed
// row at the top.
//
// **Withdraw termination.** A `withdraw-proposal` does NOT mint a
// dedicated `proposal-withdrawn` EVENT (the proposal envelope stays in
// the immutable log forever per ADR 0021); it emits one `entity-removed`
// event per propose-time-created entity. To clear the pending-proposal
// row the selector mirrors the server's `entitiesToRetractForWithdraw`
// (`apps/server/src/ws/handlers/withdraw.ts`) INVERSE: it maps each
// proposal's propose-time-created entities `(entity_kind, entity_id)` back
// to the proposal event id, then terminates the proposal when any of those
// entities is retracted by a later `entity-removed`. The two mappings MUST
// stay in sync — a sub-kind whose propose handler mints new entities must
// register them here so its withdraw clears the row. Mirror of the
// moderator's `pendingProposals.ts` per `part_withdraw_proposal_gesture`.
//
// **Pure / idempotent**: no closure over time, no `Date.now()`, no
// `Math.random()`. The relative-time formatting is a render-time concern
// that lives in the pane component; the selector emits each event's
// ISO-8601 `createdAt` verbatim so the formatter sees the canonical wire
// value.
//
// **Reads only the event log**: does NOT touch
// `useWsStore.sessionState[id].pendingProposals` (the per-facet status
// frames) or any server-side projection cache. Coupling to the status
// frames would make the pane stop working when the server's
// `proposal-status` broadcast is rate-limited or temporarily silent.
//
// **Handles all eleven proposal sub-kinds**: the row's `proposal` field
// carries the full discriminated-union payload so the pane / sibling
// tasks can switch on `proposal.kind` and render the matching per-sub-
// kind summary without re-deriving anything.
//
// Mirror of `apps/moderator/src/graph/pendingProposals.ts` per
// `part_proposal_list_view` Decision §1 — duplication is deliberate
// until a third consumer (audience or replay surface) triggers shell
// extraction.

import type { Event, ProposalPayload } from '@a-conversa/shared-types';

/**
 * One row in the pending-proposals pane. Minimum fields each sibling
 * task needs: stable key (the `proposal` event id, which matches
 * `vote/commit/meta-disagreement-marked`'s `proposal_id`), sort key (the
 * per-session monotonic `sequence`), the proposal payload (so sibling
 * tasks can compute targets / render per-sub-kind summaries), and the
 * human-readable identity columns (`actor` UUID + ISO-8601 `createdAt`).
 *
 * **No `screenName` field** — the participant UI does not yet host a
 * `userId -> screenName` resolver; the row component renders the first
 * 8 chars of `actor` as the author display in v1. The screen-name
 * resolution is a follow-up.
 */
export interface PendingProposalRow {
  /**
   * The `proposal` event's envelope id. Matches `vote.payload.proposal_id`,
   * `commit.payload.proposal_id`, and
   * `meta-disagreement-marked.payload.proposal_id`. Also used as the
   * row's stable React key and the `data-proposal-id` attribute.
   */
  readonly proposalEventId: string;
  /**
   * Per-session monotonic `event.sequence`. Sort key (newest first =
   * descending). Ties are impossible — the server-side sequence is the
   * primary order key in `session_events`.
   */
  readonly sequence: number;
  /**
   * Outer envelope kind. Always `'proposal'` for this selector's output;
   * included for forward-compat with a future multi-kind row source (e.g.
   * a unified "pending actions" pane).
   */
  readonly kind: 'proposal';
  /**
   * The proposal payload — the discriminated union over the eleven
   * sub-kinds. Pane / siblings switch on `proposal.kind` to render the
   * per-sub-kind summary.
   */
  readonly proposal: ProposalPayload;
  /**
   * The causing `event.actor` UUID. Nullable per the envelope schema (a
   * future system-emitted proposal could carry `null`); the row
   * component falls back to a localized "System" label in that case.
   */
  readonly actor: string | null;
  /**
   * ISO-8601 `event.createdAt`. The pane formats it via
   * `formatRelativeTime` at render time; the selector emits the raw
   * wire value so the formatter sees the canonical timestamp.
   */
  readonly createdAt: string;
}

/**
 * Derive the pending-proposals list from a session's event log.
 *
 * @param events The session's event log (`useWsStore.sessionState[id].events`).
 * @returns The surviving in-flight proposals in newest-first order.
 *
 * Steps:
 *   1. Collect terminated proposal ids — any `commit` or
 *      `meta-disagreement-marked` event references its target proposal
 *      via `payload.proposal_id`.
 *   2. Walk the event log and emit one row per `kind === 'proposal'`
 *      event whose id is NOT in the terminated set.
 *   3. Sort the surviving set by `sequence` descending (newest first).
 *
 * A `vote` event does NOT remove the proposal from the pending list —
 * even the unanimous-agree state is "pending" until the moderator
 * commits.
 *
 * A `commit` / `meta-disagreement-marked` referencing an unknown
 * proposal id is a no-op (defensive — should not happen in well-formed
 * logs).
 */
export function derivePendingProposals(events: readonly Event[]): readonly PendingProposalRow[] {
  // Step 1: collect terminated proposal ids in a single forward pass.
  // Per ADR 0030 §2 + §9, commit / meta-disagreement-marked payloads are
  // a `target`-discriminated union. The proposal-keyed arm names the
  // proposal id directly. The facet-keyed arm names
  // `(entity_kind, entity_id, facet)`; to terminate the proposal that
  // supplied the facet's current candidate we track a facet → most-
  // recent-proposal-id map (a new facet-valued proposal supersedes the
  // prior candidate per ADR 0030 §7) and resolve through it.
  const terminatedProposalIds = new Set<string>();
  const currentProposalByFacet = new Map<string, string>();
  const facetKey = (entityKind: string, entityId: string, facet: string): string =>
    `${entityKind}|${entityId}|${facet}`;
  // Withdraw termination: map each proposal's propose-time-created
  // entity `(entity_kind, entity_id)` back to its proposal event id.
  // A later `entity-removed` naming one of those entities terminates
  // the proposal (the inverse of the server's per-sub-kind retraction
  // mapping — see the module docblock).
  const proposalByCreatedEntity = new Map<string, string>();
  const entityKey = (entityKind: string, entityId: string): string => `${entityKind}|${entityId}`;
  for (const event of events) {
    if (event.kind === 'proposal') {
      const inner = event.payload.proposal;
      registerProposeTimeEntities(inner, event.id, proposalByCreatedEntity, entityKey);
      if (inner.kind === 'capture-node') {
        currentProposalByFacet.set(facetKey('node', inner.node_id, 'wording'), event.id);
      } else if (inner.kind === 'classify-node') {
        currentProposalByFacet.set(facetKey('node', inner.node_id, 'classification'), event.id);
      } else if (inner.kind === 'set-node-substance') {
        currentProposalByFacet.set(facetKey('node', inner.node_id, 'substance'), event.id);
      } else if (inner.kind === 'set-edge-substance') {
        currentProposalByFacet.set(facetKey('edge', inner.edge_id, 'substance'), event.id);
      } else if (inner.kind === 'edit-wording') {
        currentProposalByFacet.set(facetKey('node', inner.node_id, 'wording'), event.id);
      }
      continue;
    }
    if (event.kind === 'commit') {
      if (event.payload.target === 'proposal') {
        terminatedProposalIds.add(event.payload.proposal_id);
      } else {
        const proposalId = currentProposalByFacet.get(
          facetKey(event.payload.entity_kind, event.payload.entity_id, event.payload.facet),
        );
        if (proposalId !== undefined) terminatedProposalIds.add(proposalId);
      }
    } else if (event.kind === 'meta-disagreement-marked') {
      if (event.payload.target === 'proposal') {
        terminatedProposalIds.add(event.payload.proposal_id);
      } else {
        const proposalId = currentProposalByFacet.get(
          facetKey(event.payload.entity_kind, event.payload.entity_id, event.payload.facet),
        );
        if (proposalId !== undefined) terminatedProposalIds.add(proposalId);
      }
    } else if (event.kind === 'entity-removed') {
      // A withdraw retracts the proposal's propose-time-created
      // entities (the proposal envelope itself stays in the log per
      // ADR 0021). Terminate the proposal that minted the retracted
      // entity so its pending row clears.
      const proposalId = proposalByCreatedEntity.get(
        entityKey(event.payload.entity_kind, event.payload.entity_id),
      );
      if (proposalId !== undefined) terminatedProposalIds.add(proposalId);
    }
  }

  // Step 2: emit one row per surviving `proposal` event.
  const rows: PendingProposalRow[] = [];
  for (const event of events) {
    if (event.kind !== 'proposal') continue;
    if (terminatedProposalIds.has(event.id)) continue;
    rows.push({
      proposalEventId: event.id,
      sequence: event.sequence,
      kind: 'proposal',
      proposal: event.payload.proposal,
      actor: event.actor,
      createdAt: event.createdAt,
    });
  }

  // Step 3: newest-first by sequence descending. Sequence is unique per
  // session, so the sort is total-order; no secondary tie-breaker needed.
  rows.sort((a, b) => b.sequence - a.sequence);

  return rows;
}

/**
 * Register a proposal's propose-time-created entities into the
 * `proposalByCreatedEntity` map so a later `entity-removed` (a
 * withdraw) can terminate the proposal's pending row.
 *
 * The INVERSE of `entitiesToRetractForWithdraw`
 * (`apps/server/src/ws/handlers/withdraw.ts`) and a mirror of the
 * moderator's `pendingProposals.ts` `registerProposeTimeEntities` — the
 * three MUST stay in sync. When a sub-kind's propose handler starts
 * minting new entities at propose-time, register them here so its
 * withdraw clears the row.
 *
 * Unlike the server's retraction mapping, this client-side mirror has
 * no projection to existence-check against, so it registers every
 * candidate propose-time entity unconditionally. That is sound: the
 * server only emits `entity-removed` for entities it actually minted,
 * so a registered key that was never minted simply never matches.
 */
function registerProposeTimeEntities(
  proposal: ProposalPayload,
  proposalEventId: string,
  proposalByCreatedEntity: Map<string, string>,
  entityKey: (entityKind: string, entityId: string) => string,
): void {
  switch (proposal.kind) {
    case 'capture-node':
      // Always mints the captured node; mints a connecting edge when
      // `edge` is present (ADR 0030 §1 wording-only capture).
      proposalByCreatedEntity.set(entityKey('node', proposal.node_id), proposalEventId);
      if (proposal.edge !== undefined) {
        proposalByCreatedEntity.set(entityKey('edge', proposal.edge.edge_id), proposalEventId);
      }
      break;
    case 'set-edge-substance': {
      // Connecting case only — mints a fresh edge when each endpoint
      // side carries something + `role` is present (the polymorphic
      // fresh-edge predicate). The substance-only re-vote mints
      // nothing, so it registers nothing.
      const sourceSidePresent =
        proposal.source_node_id !== undefined || proposal.source_annotation_id !== undefined;
      const targetSidePresent =
        proposal.target_node_id !== undefined || proposal.target_annotation_id !== undefined;
      if (sourceSidePresent && targetSidePresent && proposal.role !== undefined) {
        proposalByCreatedEntity.set(entityKey('edge', proposal.edge_id), proposalEventId);
      }
      break;
    }
    case 'decompose':
      // Mints one component node per `components[i]`.
      for (const component of proposal.components) {
        proposalByCreatedEntity.set(entityKey('node', component.node_id), proposalEventId);
      }
      break;
    case 'interpretive-split':
      // Symmetric to `decompose` — mints one node per `readings[i]`.
      for (const reading of proposal.readings) {
        proposalByCreatedEntity.set(entityKey('node', reading.node_id), proposalEventId);
      }
      break;
    default:
      // Every other sub-kind mints no structural entities at
      // propose-time, so a withdraw retracts nothing and the proposal
      // row clears only via commit / meta-disagreement (or stays).
      break;
  }
}
