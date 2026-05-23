// Per-entity per-facet `FacetStatus` derivation for the moderator's graph.
//
// Refinement: tasks/refinements/moderator-ui/mod_proposed_state_styling.md
//
// Client-side mirror of `apps/server/src/projection/facet-status.ts`'s
// `deriveFacetStatus`. The server does not expose a client-callable
// helper, and the WS `proposal-status` broadcast only covers facets
// attached to *pending* proposals — committed / withdrawn / meta-
// disagreement facets need the same state-machine evaluation locally.
// Since `apps/server` is not a workspace dependency of the moderator
// and `@a-conversa/shared-types` does not re-export `FacetStatus`, this
// file mirrors the small rule set verbatim. If a future refactor extracts
// a shared methodology types package, the duplication becomes the call
// site.
//
// Walks the per-session event log once and builds a per-entity per-facet
// `FacetState` then runs the seven derivation rules to produce the final
// `FacetStatus` per entity-facet pair. Rules ported from
// `deriveFacetStatus`:
//
//   1. Meta-disagreement on a facet short-circuits to 'meta-disagreement'.
//   2. Filter votes by current participants (joined and not left).
//   3. A `withdraw` vote against a committed facet → 'withdrawn'.
//   4. Any `dispute` vote (or `withdraw` without prior commit) → 'disputed'.
//   5. Committed (no dispute / withdraw) → 'committed'.
//   6. All current participants voted `agree` → 'agreed'.
//   7. Anything else → 'proposed'.
//
// Returns `FacetStatusIndex`: two `Map`s — one per entity kind (nodes / edges)
// — keyed by entity id, each value a `Partial<Record<FacetName, FacetStatus>>`.
// An entity with no facet-targeting events appears as an empty record (or
// no entry at all — consumers should treat both the same via
// `index.nodes.get(id) ?? {}`).

import type { Event, ProposalPayload } from '@a-conversa/shared-types';

/**
 * Per-facet overall-status enum. Mirrors `apps/server/src/projection/types.ts`'s
 * `FacetStatus` verbatim. Six values across the agreement layer (`proposed`,
 * `agreed`, `disputed`, `meta-disagreement`) and the committed layer
 * (`committed`, `withdrawn`).
 */
export type FacetStatus =
  | 'proposed'
  | 'agreed'
  | 'disputed'
  | 'committed'
  | 'withdrawn'
  | 'meta-disagreement';

/**
 * The three facets the moderator's projection tracks per entity. Mirrors
 * `apps/server/src/projection/types.ts`'s `FacetName`. Nodes in v1 carry
 * all three; edges carry only `substance`.
 */
export type FacetName = 'classification' | 'substance' | 'wording';

type PerParticipantVote = 'agree' | 'dispute' | 'withdraw';

/**
 * The output of `computeFacetStatuses`. Per entity kind, a Map of entity id
 * to a partial record of per-facet status. Facets with no events affecting
 * them are absent from the record.
 */
export interface FacetStatusIndex {
  readonly nodes: ReadonlyMap<string, Readonly<Partial<Record<FacetName, FacetStatus>>>>;
  readonly edges: ReadonlyMap<string, Readonly<Partial<Record<FacetName, FacetStatus>>>>;
}

/**
 * Internal accumulator for per-facet state — same shape as the server's
 * `FacetState`, minus the typed `value` field (the client doesn't need
 * the proposed value to compute the status).
 *
 * `perParticipant` is keyed by participant user id; each value is the
 * participant's latest vote on the facet. Multiple votes by the same
 * participant overwrite (the server enforces a one-vote-per-(proposal,
 * participant) invariant; this client mirror trusts that).
 *
 * `committed` flips when a `commit` event lands referencing one of the
 * proposals targeting this facet; `metaDisagreement` flips when a
 * `mark-meta-disagreement` event lands likewise.
 */
interface InternalFacetState {
  perParticipant: Map<string, PerParticipantVote>;
  committed: boolean;
  metaDisagreement: boolean;
  /** Whether at least one proposal targeting this facet has been seen. */
  hasProposal: boolean;
}

/** Three-tuple key for the (entity-kind, entity-id, facet) projection. */
type EntityKind = 'node' | 'edge';

function emptyFacetState(): InternalFacetState {
  return {
    perParticipant: new Map(),
    committed: false,
    metaDisagreement: false,
    hasProposal: false,
  };
}

/**
 * Decode a proposal payload to the (entityKind, entityId, facet) triple
 * the proposal targets, if any. Returns `null` for proposal sub-kinds
 * that do not produce a per-entity-facet status update (decompose,
 * interpretive-split, axiom-mark, meta-move, break-edge, annotate) — see
 * the refinement's "Out-of-scope proposal sub-kinds" decision.
 */
function targetOf(
  proposal: ProposalPayload,
): { entityKind: EntityKind; entityId: string; facet: FacetName } | null {
  switch (proposal.kind) {
    case 'classify-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'classification' };
    case 'set-node-substance':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'substance' };
    case 'set-edge-substance':
      return { entityKind: 'edge', entityId: proposal.edge_id, facet: 'substance' };
    case 'edit-wording':
      // Both reword and restructure target the parent node's wording
      // facet at proposal-time. (Restructure creates a new node at commit;
      // pre-commit the proposal is against the existing node's wording.)
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    case 'amend-node':
      // The methodology-engine repair op — same target as reword.
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    case 'decompose':
    case 'interpretive-split':
    case 'axiom-mark':
    case 'meta-move':
    case 'break-edge':
    case 'annotate':
      return null;
    default: {
      // Exhaustively narrowed; this branch is a runtime safety net for
      // callers that bypass TypeScript (e.g. tests that build malformed
      // events). An unknown proposal kind contributes no facet status.
      return null;
    }
  }
}

/**
 * Resolve a facet state from the per-kind storage maps. Creates the entry
 * lazily so callers don't have to pre-allocate; subsequent calls return
 * the same reference.
 */
function getOrCreateFacetState(
  nodeStates: Map<string, Map<FacetName, InternalFacetState>>,
  edgeStates: Map<string, Map<FacetName, InternalFacetState>>,
  entityKind: EntityKind,
  entityId: string,
  facet: FacetName,
): InternalFacetState {
  const store = entityKind === 'node' ? nodeStates : edgeStates;
  let perEntity = store.get(entityId);
  if (!perEntity) {
    perEntity = new Map();
    store.set(entityId, perEntity);
  }
  let state = perEntity.get(facet);
  if (!state) {
    state = emptyFacetState();
    perEntity.set(facet, state);
  }
  return state;
}

/**
 * Pure projection from a session's event log to the per-entity per-facet
 * `FacetStatus` index. The walk is single-pass over `events`; the rule
 * evaluation runs once at the end on each accumulated `InternalFacetState`.
 *
 * Empty event log returns empty maps. Unknown proposal sub-kinds (the
 * structural / per-participant ones) contribute nothing.
 */
export function computeFacetStatuses(events: readonly Event[]): FacetStatusIndex {
  // Step 1: walk events once to build:
  //   - The current-participants set (joined - left).
  //   - A proposal-id → target triple map (vote / commit /
  //     mark-meta-disagreement events reference proposals by id; we map
  //     them back to facets via this).
  //   - Per-entity per-facet `InternalFacetState`s.
  const currentParticipants = new Set<string>();
  const proposalTarget = new Map<
    string,
    { entityKind: EntityKind; entityId: string; facet: FacetName }
  >();
  const nodeStates = new Map<string, Map<FacetName, InternalFacetState>>();
  const edgeStates = new Map<string, Map<FacetName, InternalFacetState>>();

  for (const event of events) {
    if (event.kind === 'participant-joined') {
      currentParticipants.add(event.payload.user_id);
      continue;
    }
    if (event.kind === 'participant-left') {
      currentParticipants.delete(event.payload.user_id);
      continue;
    }
    if (event.kind === 'proposal') {
      const target = targetOf(event.payload.proposal);
      if (target !== null) {
        proposalTarget.set(event.id, target);
        const state = getOrCreateFacetState(
          nodeStates,
          edgeStates,
          target.entityKind,
          target.entityId,
          target.facet,
        );
        state.hasProposal = true;
      }
      // Per `mod_decompose_propose_time_canvas_visibility`: a
      // pending decompose / interpretive-split proposal introduces N
      // component nodes (via the propose-time fan-out at
      // `apps/server/src/methodology/handlers/propose.ts`); each
      // component's classification facet is `proposed` while the
      // decompose / interpretive-split proposal is pending. (The
      // parent's classification facet is unaffected — the parent is
      // not the target of these proposals.) Without this branch the
      // component nodes would render with NO `data-facet-status`
      // attribute, violating the methodology contract that proposed
      // entities surface with `data-facet-status="proposed"` per
      // ADR 0027 + `mod_proposed_entity_canvas_visibility` Acceptance
      // criteria L103.
      //
      // This is purely a status-derivation rule (no per-component
      // proposal envelope is emitted at the wire layer — the single
      // `decompose` envelope carries the components inline). On
      // commit / withdraw of the decompose proposal, the component
      // nodes either persist (commit — the components are now real)
      // or get retracted (withdraw — `entity-removed(node)` per
      // component lands per `entitiesToRetractForWithdraw` in
      // `apps/server/src/ws/handlers/withdraw.ts`); either way the
      // facet status update is consistent.
      //
      // **Server-side symmetric arm.** The server-side
      // `facetTargetsForProposal` in
      // `apps/server/src/ws/broadcast/proposal-status.ts` is the
      // source of truth for non-moderator surfaces (participant +
      // audience) consuming the `proposal-status` broadcast directly
      // — it walks the same `components` / `readings` arrays and
      // emits one `proposal-status` envelope per component. This
      // moderator-side mirror remains the in-place derivation for the
      // moderator's `computeFacetStatuses(events)` consumer
      // (`GraphCanvasPane.tsx` + `PendingProposalsPane.tsx`) until a
      // future task migrates the moderator onto the broadcast path.
      // See refinement
      // `tasks/refinements/backend/facet_status_server_decompose_component_facets.md`
      // D5 for the rationale on keeping both arms in lockstep.
      const proposal = event.payload.proposal;
      if (proposal.kind === 'decompose') {
        for (const component of proposal.components) {
          const state = getOrCreateFacetState(
            nodeStates,
            edgeStates,
            'node',
            component.node_id,
            'classification',
          );
          state.hasProposal = true;
        }
      } else if (proposal.kind === 'interpretive-split') {
        for (const reading of proposal.readings) {
          const state = getOrCreateFacetState(
            nodeStates,
            edgeStates,
            'node',
            reading.node_id,
            'classification',
          );
          state.hasProposal = true;
        }
      }
      continue;
    }
    if (event.kind === 'vote') {
      // TODO(pf_vote_handler_facet_keyed): vote payloads are now a
      // `target`-discriminated union. The methodology engine emits
      // the proposal-keyed arm for now; the facet-keyed arm is
      // reserved for the downstream rewrite. Read only the proposal-
      // keyed arm until that lands.
      if (event.payload.target !== 'proposal') continue;
      const target = proposalTarget.get(event.payload.proposal_id);
      if (!target) continue;
      const state = getOrCreateFacetState(
        nodeStates,
        edgeStates,
        target.entityKind,
        target.entityId,
        target.facet,
      );
      // Latest vote wins (server enforces one-vote-per-participant-per-
      // proposal; this is a no-op for well-formed logs and a defensive
      // last-write-wins for malformed ones).
      state.perParticipant.set(event.payload.participant, event.payload.choice);
      continue;
    }
    if (event.kind === 'commit') {
      const target = proposalTarget.get(event.payload.proposal_id);
      if (!target) continue;
      const state = getOrCreateFacetState(
        nodeStates,
        edgeStates,
        target.entityKind,
        target.entityId,
        target.facet,
      );
      state.committed = true;
      continue;
    }
    if (event.kind === 'meta-disagreement-marked') {
      const target = proposalTarget.get(event.payload.proposal_id);
      if (!target) continue;
      const state = getOrCreateFacetState(
        nodeStates,
        edgeStates,
        target.entityKind,
        target.entityId,
        target.facet,
      );
      state.metaDisagreement = true;
      continue;
    }
    // Other event kinds (node-created, edge-created, annotation-created,
    // session-created, session-ended, entity-included, snapshot-created)
    // do not affect facet status directly. The facet status is purely a
    // function of proposals + votes + commits + meta-disagreement marks.
  }

  // Step 2: run the derivation rules on each accumulated state.
  const nodes = new Map<string, Partial<Record<FacetName, FacetStatus>>>();
  for (const [entityId, perEntity] of nodeStates) {
    const out: Partial<Record<FacetName, FacetStatus>> = {};
    for (const [facet, state] of perEntity) {
      out[facet] = derive(state, currentParticipants);
    }
    nodes.set(entityId, out);
  }
  const edges = new Map<string, Partial<Record<FacetName, FacetStatus>>>();
  for (const [entityId, perEntity] of edgeStates) {
    const out: Partial<Record<FacetName, FacetStatus>> = {};
    for (const [facet, state] of perEntity) {
      out[facet] = derive(state, currentParticipants);
    }
    edges.set(entityId, out);
  }

  return { nodes, edges };
}

/**
 * Apply the seven derivation rules to a single `InternalFacetState`,
 * given the current participants set. Mirrors
 * `deriveFacetStatus` in `apps/server/src/projection/facet-status.ts`.
 */
function derive(state: InternalFacetState, currentParticipants: Set<string>): FacetStatus {
  // Rule 1: meta-disagreement short-circuits.
  if (state.metaDisagreement) {
    return 'meta-disagreement';
  }

  // Rule 2: filter votes to current participants only. Left participants'
  // votes are historical — the methodology says "current participants"
  // must agree.
  const currentVotes: PerParticipantVote[] = [];
  for (const [participantId, vote] of state.perParticipant) {
    if (currentParticipants.has(participantId)) {
      currentVotes.push(vote);
    }
  }

  const hasWithdraw = currentVotes.some((v) => v === 'withdraw');
  const hasDispute = currentVotes.some((v) => v === 'dispute');

  // Rule 3: withdraw against a committed facet supersedes commit.
  if (state.committed && hasWithdraw) {
    return 'withdrawn';
  }

  // Rule 4: any current dispute → disputed. Treat a withdraw without a
  // prior commit as a dispute (the participant is signalling rejection;
  // the projection has no commit to surface as `withdrawn`).
  if (hasDispute || hasWithdraw) {
    return 'disputed';
  }

  // Rule 5: committed (no dispute / withdraw) → committed.
  if (state.committed) {
    return 'committed';
  }

  // Rule 6: every current participant voted agree → agreed. Requires at
  // least one current participant (an empty-session facet stays
  // 'proposed').
  const currentParticipantCount = currentParticipants.size;
  const agreeCount = currentVotes.filter((v) => v === 'agree').length;
  if (currentParticipantCount > 0 && agreeCount === currentParticipantCount) {
    return 'agreed';
  }

  // Rule 7: anything else → proposed.
  return 'proposed';
}

/**
 * Module-scope shared empty per-facet record. Hands a stable reference to
 * consumers when an entity has no facet entries, so React / ReactFlow
 * memoization doesn't see a fresh object on every projection pass.
 */
export const EMPTY_FACET_STATUSES: Readonly<Partial<Record<FacetName, FacetStatus>>> =
  Object.freeze({});
