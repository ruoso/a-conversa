// Pure selector that derives the moderator right-sidebar's pending-
// proposals list from a session's event log.
//
// Refinement: tasks/refinements/moderator-ui/mod_proposal_list.md
//
// `derivePendingProposals(events)` walks `useWsStore.sessionState[id].events`
// once, collects every `kind === 'proposal'` envelope, and removes any
// proposal whose id has been referenced by a `commit` or
// `meta-disagreement-marked` event, by a `proposal-withdrawn` terminator,
// OR whose propose-time-minted entities have been retracted by
// `entity-removed` events (a withdraw). The surviving set is returned
// newest-first by event `sequence` (descending) so the right-sidebar
// pane renders the freshly-proposed row at the top.
//
// **Withdraw termination — two coexisting paths (ADR 0037, D5).** A
// `withdraw-proposal` terminates the pending row by one of two log
// signals depending on whether it was log-silent:
//   1. ENTITY-EMITTING withdraw — emits one `entity-removed` per
//      propose-time-created entity. The selector mirrors the server's
//      `entitiesToRetractForWithdraw`
//      (`apps/server/src/ws/handlers/withdraw.ts`) INVERSE: it maps each
//      proposal's propose-time-created entities `(entity_kind, entity_id)`
//      back to the proposal event id, then terminates the proposal when
//      any of those entities is retracted by a later `entity-removed`.
//      The two mappings MUST stay in sync — a sub-kind whose propose
//      handler mints new entities must register them here.
//   2. ZERO-EMISSION (log-silent) withdraw — emits a single
//      proposal-keyed `proposal-withdrawn` terminator event (ADR 0037).
//      The selector terminates the row directly off `payload.proposal_id`.
// Both paths are wired and additive (set membership), so row termination
// is robust to the zero-emission boundary moving.
//
// **Pure / idempotent** (Decision §1, Constraints): no closure over time,
// no `Date.now()`, no `Math.random()`. The relative-time formatting is a
// render-time concern that lives in the pane component (Decision §5);
// the selector emits each event's ISO-8601 `createdAt` verbatim so the
// formatter sees the canonical wire value.
//
// **Reads only the event log** (Constraints): does NOT touch
// `useWsStore.sessionState[id].pendingProposals` (the per-facet status
// frames) or any server-side projection cache. Coupling to the status
// frames would make the pane stop working when the server's
// `proposal-status` broadcast is rate-limited or temporarily silent.
//
// **Handles all eleven proposal sub-kinds** (Constraints): the row's
// `proposal` field carries the full discriminated-union payload so the
// pane / sibling tasks can switch on `proposal.kind` and render the
// matching per-sub-kind summary without re-deriving anything.
//
// Companion to `facetStatus.ts`'s `computeFacetStatuses` — same idiom
// (pure walk over `readonly Event[]` returning a derived index); future
// non-graph selectors for the change-history pane and the diagnostic
// pane will sit alongside per Decision §11.

import type { Event, ProposalPayload } from '@a-conversa/shared-types';

/**
 * One row in the pending-proposals pane. Decision §3 — minimum fields
 * each sibling task needs: stable key (the `proposal` event id, which
 * matches `vote/commit/meta-disagreement-marked`'s `proposal_id`), sort
 * key (the per-session monotonic `sequence`), the proposal payload (so
 * sibling tasks can compute targets / render per-sub-kind summaries),
 * and the human-readable identity columns (`actor` UUID + ISO-8601
 * `createdAt`).
 *
 * **No `screenName` field** — the moderator UI does not yet host a
 * `userId -> screenName` resolver; the row component renders the first
 * 8 chars of `actor` as the author display in v1 (Decision §6). The
 * screen-name resolution is a follow-up.
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
   * per-sub-kind summary (Decision §5).
   */
  readonly proposal: ProposalPayload;
  /**
   * The causing `event.actor` UUID. Nullable per the envelope schema (a
   * future system-emitted proposal could carry `null`); the row
   * component falls back to a localized "System" label in that case
   * (Decision §6).
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
 * commits (Constraints, Decision §2).
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
        // Per ADR 0030 §1 + §4 + `pf_mod_node_card_classification_affordance`:
        // `capture-node` names the wording-facet candidate inline; a
        // later facet-keyed commit on the (node, wording) triple
        // terminates the capture-node proposal so the pending row
        // clears.
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
      // Per ADR 0030 §2 + §9: meta-disagreement-marked payloads are a
      // `target`-discriminated union. The proposal-keyed arm carries
      // `proposal_id` directly; the facet-keyed arm names the
      // `(entity_kind, entity_id, facet)` triple and the proposal it
      // terminates is the most-recent facet-valued proposal for that
      // triple — looked up via the `currentProposalByFacet` map the
      // commit arm above also consults.
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
      // entities (per `ws_withdraw_proposal_message` D3/D5 the proposal
      // envelope itself stays in the log). Terminate the proposal that
      // minted the retracted entity so its pending row clears.
      const proposalId = proposalByCreatedEntity.get(
        entityKey(event.payload.entity_kind, event.payload.entity_id),
      );
      if (proposalId !== undefined) terminatedProposalIds.add(proposalId);
    } else if (event.kind === 'proposal-withdrawn') {
      // Per ADR 0037: a log-silent (zero-emission) withdraw appends a
      // proposal-keyed `proposal-withdrawn` terminator instead of any
      // `entity-removed`. Terminate the pending row directly off it.
      // This coexists with the `entity-removed` mirror above (D5) —
      // the two terminator paths are additive + idempotent (set
      // membership), so termination is robust whether a withdraw is
      // log-silent or entity-emitting.
      terminatedProposalIds.add(event.payload.proposal_id);
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
 * propose handler's `buildStructuralEventsForPropose` per-sub-kind
 * fan-out — the three MUST stay in sync. When a sub-kind's propose
 * handler starts minting new entities at propose-time, register them
 * here so its withdraw clears the row.
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
