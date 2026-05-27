// Per-entity per-facet `FacetStatus` derivation for the audience's
// read-only broadcast Cytoscape graph.
//
// Refinement: tasks/refinements/audience/aud_proposed_styling.md
//   (Decision §3 — port verbatim from the participant's mirror, which
//   is the newer of the two client copies and carries the post-`pf_*`
//   refactor cleanups: the seven `FacetStatus` values including
//   `'awaiting-proposal'` per ADR 0030 §10, the four `FacetName` values
//   including `'shape'` per `pf_part_facet_name_widen_shape`, and the
//   `EMPTY_FACET_STATUSES` frozen reference. Decision §5 — fourth
//   verbatim copy lands here; consolidation to `@a-conversa/shell`
//   deferred to the named-future-task `shell_facet_status_extraction`.)
//
// Client-side mirror of `apps/server/src/projection/facet-status.ts`'s
// `deriveFacetStatus`. The audience port is the fourth copy across
// workspaces. All four implementations MUST stay in lockstep if the
// server's rule set widens (e.g. a new facet kind, a new vote kind):
//
//   - `apps/server/src/projection/facet-status.ts` — canonical server
//     source (the rules' authoritative implementation; `deriveFacetStatus`).
//   - `apps/moderator/src/graph/facetStatus.ts` — moderator client mirror
//     (ReactFlow consumer; `GraphCanvasPane.tsx` + `PendingProposalsPane.tsx`).
//   - `apps/participant/src/graph/facetStatus.ts` — participant client mirror
//     (Cytoscape consumer; `GraphView.tsx`'s element-data stamping + the test mirror).
//   - this file — audience client mirror (Cytoscape consumer;
//     `GraphView.tsx`'s broadcast surface element-data stamping + the test mirror).
//
// The future `shell_facet_status_extraction` task consolidates the
// four copies into a single `@a-conversa/shell` barrel export and
// rewrites the four call sites' imports. Until that lands, every
// rule-set widening must edit all four files in lockstep.
//
// Walks the per-session event log once and builds a per-entity per-facet
// `FacetState` then runs the eight derivation rules to produce the final
// `FacetStatus` per entity-facet pair. Rules ported from
// `deriveFacetStatus`:
//
//   1. Meta-disagreement on a facet short-circuits to 'meta-disagreement'.
//   2. No candidate value yet → 'awaiting-proposal'.
//   3. Filter votes + withdrawals by current participants (joined and not left).
//   4. A withdraw-agreement against a committed facet → 'withdrawn'.
//      (Withdrawals come from `withdraw-agreement` events only — per
//      ADR 0030 §3 the legacy `vote.choice = 'withdraw'` arm is retired;
//      closed by `pf_unit_test_audit`.)
//   5. Any `dispute` vote → 'disputed'.
//   6. Committed (no dispute / withdraw) → 'committed'.
//   7. All current participants voted `agree` → 'agreed'.
//   8. Anything else → 'proposed'.
//
// Returns `FacetStatusIndex`: two `Map`s — one per entity kind (nodes / edges)
// — keyed by entity id, each value a `Partial<Record<FacetName, FacetStatus>>`.
// An entity with no facet-targeting events appears as an empty record (or
// no entry at all — consumers should treat both the same via
// `index.nodes.get(id) ?? EMPTY_FACET_STATUSES`).
//
// `cardRollupStatus(facetStatuses)` returns the highest-priority status
// per the `ROLLUP_PRIORITY` array (proposed > meta-disagreement >
// disputed > agreed > committed > withdrawn > awaiting-proposal). The
// audience-side `projectGraph` consumer stamps the literal sentinel
// `'none'` when the helper returns `undefined` so Cytoscape's
// `[rollupStatus = '<state>']` selectors have a stable string to match
// on (Decision §4).

import type { Event, ProposalPayload } from '@a-conversa/shared-types';

/**
 * Per-facet overall-status enum. Mirrors `apps/server/src/projection/types.ts`'s
 * `FacetStatus` verbatim. Seven values: the agreement layer (`proposed`,
 * `agreed`, `disputed`, `meta-disagreement`), the committed layer
 * (`committed`, `withdrawn`), and the empty-state `awaiting-proposal`.
 */
export type FacetStatus =
  | 'proposed'
  | 'agreed'
  | 'disputed'
  | 'committed'
  | 'withdrawn'
  | 'meta-disagreement'
  | 'awaiting-proposal';

/**
 * The four facets the audience's projection tracks per entity.
 * Mirrors `apps/server/src/projection/types.ts`'s `FacetName` AND the
 * wire-level `facetNameSchema` in `@a-conversa/shared-types` (both
 * 4-valued post `pf_shape_facet_wire_vote`). Nodes in v1 carry
 * `wording` / `classification` / `substance`; edges carry `shape`
 * (inline carriage of the role from `edge-created` per ADR 0030 §5)
 * and `substance`.
 */
export type FacetName = 'classification' | 'substance' | 'wording' | 'shape';

// Per ADR 0030 §3 + `pf_facet_keyed_vote_payload` + `pf_withdraw_agreement_handler`
// + `pf_unit_test_audit`: `vote.choice` collapsed to `'agree' | 'dispute'`;
// withdrawal is its own first-class event kind. The legacy `'withdraw'`
// arm has been retired from this union; withdrawals are tracked separately
// on the per-facet `withdrawals` set populated by `withdraw-agreement`
// events.
type PerParticipantVote = 'agree' | 'dispute';

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
 */
interface InternalFacetState {
  perParticipant: Map<string, PerParticipantVote>;
  /** Per-participant withdrawals (populated by `withdraw-agreement` events). */
  withdrawals: Set<string>;
  committed: boolean;
  metaDisagreement: boolean;
  /**
   * Whether the facet has any candidate value to vote on. Set to `true`
   * when a `node-created.wording` populates the wording facet inline,
   * an `edge-created` populates the shape facet inline, or a facet-
   * valued proposal targeting this facet lands. Drives the
   * `'awaiting-proposal'` rule per ADR 0030 §10.
   */
  hasCandidate: boolean;
  /**
   * The candidate-proposal-event-id supplying the current candidate
   * value, if any. Used to track vote-reset semantics when a new
   * facet-valued proposal supersedes the prior candidate.
   */
  candidateProposalEventId: string | null;
}

/** Three-tuple key for the (entity-kind, entity-id, facet) projection. */
type EntityKind = 'node' | 'edge';

function emptyFacetState(): InternalFacetState {
  return {
    perParticipant: new Map(),
    withdrawals: new Set(),
    committed: false,
    metaDisagreement: false,
    hasCandidate: false,
    candidateProposalEventId: null,
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
    case 'capture-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
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
    if (event.kind === 'node-created') {
      // Per ADR 0030 §4: wording is inline on `node-created`. The
      // wording facet enters life with the captured text as its
      // candidate. Classification + substance facets remain
      // `awaiting-proposal` until their respective proposals land.
      const wordingState = getOrCreateFacetState(
        nodeStates,
        edgeStates,
        'node',
        event.payload.node_id,
        'wording',
      );
      wordingState.hasCandidate = true;
      getOrCreateFacetState(
        nodeStates,
        edgeStates,
        'node',
        event.payload.node_id,
        'classification',
      );
      getOrCreateFacetState(nodeStates, edgeStates, 'node', event.payload.node_id, 'substance');
      continue;
    }
    if (event.kind === 'edge-created') {
      // Per ADR 0030 §5: edge shape is inline on `edge-created` — the
      // shape facet enters life with the inline role as its candidate
      // (no proposal supplied it). The substance facet enters life
      // `awaiting-proposal` until a `set-edge-substance` proposal lands.
      const shapeState = getOrCreateFacetState(
        nodeStates,
        edgeStates,
        'edge',
        event.payload.edge_id,
        'shape',
      );
      shapeState.hasCandidate = true;
      getOrCreateFacetState(nodeStates, edgeStates, 'edge', event.payload.edge_id, 'substance');
      continue;
    }
    if (event.kind === 'withdraw-agreement') {
      // Per ADR 0030 §3: withdraw-agreement is keyed by `(entity, facet,
      // participant)`. The handler records the withdrawal on the
      // matching facet; the derivation surfaces `'withdrawn'` when the
      // withdrawal lands on a committed candidate.
      const state = getOrCreateFacetState(
        nodeStates,
        edgeStates,
        event.payload.entity_kind,
        event.payload.entity_id,
        event.payload.facet,
      );
      state.withdrawals.add(event.payload.participant);
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
        // Per ADR 0030 §7: a new facet-valued proposal sets a fresh
        // candidate AND clears prior per-participant votes (the old
        // votes were votes against the old candidate). Withdrawals
        // are NOT cleared.
        state.hasCandidate = true;
        state.candidateProposalEventId = event.id;
        state.perParticipant.clear();
      }
      // A pending decompose / interpretive-split proposal introduces N
      // component nodes via the propose-time fan-out; each component's
      // classification facet is `proposed` while the proposal is pending.
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
          state.hasCandidate = true;
          state.candidateProposalEventId = event.id;
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
          state.hasCandidate = true;
          state.candidateProposalEventId = event.id;
        }
      }
      continue;
    }
    if (event.kind === 'vote') {
      if (event.payload.target === 'facet') {
        const state = getOrCreateFacetState(
          nodeStates,
          edgeStates,
          event.payload.entity_kind,
          event.payload.entity_id,
          event.payload.facet,
        );
        state.perParticipant.set(event.payload.participant, event.payload.choice);
        continue;
      }
      const target = proposalTarget.get(event.payload.proposal_id);
      if (!target) continue;
      const state = getOrCreateFacetState(
        nodeStates,
        edgeStates,
        target.entityKind,
        target.entityId,
        target.facet,
      );
      state.perParticipant.set(event.payload.participant, event.payload.choice);
      continue;
    }
    if (event.kind === 'commit') {
      if (event.payload.target === 'facet') {
        const state = getOrCreateFacetState(
          nodeStates,
          edgeStates,
          event.payload.entity_kind,
          event.payload.entity_id,
          event.payload.facet,
        );
        state.committed = true;
        continue;
      }
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
      if (event.payload.target === 'facet') {
        const state = getOrCreateFacetState(
          nodeStates,
          edgeStates,
          event.payload.entity_kind,
          event.payload.entity_id,
          event.payload.facet,
        );
        state.metaDisagreement = true;
        continue;
      }
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
    // Other event kinds (annotation-created, session-created, session-ended,
    // entity-included, snapshot-created) do not affect facet status directly.
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
 * Apply the eight derivation rules to a single `InternalFacetState`,
 * given the current participants set. Mirrors
 * `deriveFacetStatus` in `apps/server/src/projection/facet-status.ts`.
 */
function derive(state: InternalFacetState, currentParticipants: Set<string>): FacetStatus {
  // Rule 1: meta-disagreement short-circuits.
  if (state.metaDisagreement) {
    return 'meta-disagreement';
  }

  // Rule 2: no candidate value yet → `'awaiting-proposal'`.
  if (!state.hasCandidate) {
    return 'awaiting-proposal';
  }

  // Rule 3: filter votes + withdrawals to current participants only.
  const currentVotes: PerParticipantVote[] = [];
  for (const [participantId, vote] of state.perParticipant) {
    if (currentParticipants.has(participantId)) {
      currentVotes.push(vote);
    }
  }
  let hasCurrentWithdrawal = false;
  for (const participantId of state.withdrawals) {
    if (currentParticipants.has(participantId)) {
      hasCurrentWithdrawal = true;
      break;
    }
  }

  const hasDispute = currentVotes.some((v) => v === 'dispute');

  // Rule 4: withdraw-agreement against a committed facet → 'withdrawn'.
  if (state.committed && hasCurrentWithdrawal) {
    return 'withdrawn';
  }

  // Rule 5: any current dispute → disputed.
  if (hasDispute) {
    return 'disputed';
  }

  // Rule 6: committed (no dispute / withdraw) → committed.
  if (state.committed) {
    return 'committed';
  }

  // Rule 7: every current participant voted agree → agreed. Requires at
  // least one current participant.
  const currentParticipantCount = currentParticipants.size;
  const agreeCount = currentVotes.filter((v) => v === 'agree').length;
  if (currentParticipantCount > 0 && agreeCount === currentParticipantCount) {
    return 'agreed';
  }

  // Rule 8: anything else → proposed.
  return 'proposed';
}

/**
 * Module-scope shared empty per-facet record. Hands a stable reference to
 * consumers when an entity has no facet entries, so React memoization
 * doesn't see a fresh object on every projection pass.
 */
export const EMPTY_FACET_STATUSES: Readonly<Partial<Record<FacetName, FacetStatus>>> =
  Object.freeze({});

/**
 * Card-level rollup priority. Highest priority first; the first status
 * present in the per-facet record wins.
 *
 *   1. `proposed`           — gathering votes; the most active surface.
 *   2. `meta-disagreement`  — methodology-engine escalation always wins.
 *   3. `disputed`           — agreement broke down on a vote.
 *   4. `agreed`             — all current participants agreed, no commit.
 *   5. `committed`          — agreed and committed; closed.
 *   6. `withdrawn`          — committed then withdrawn; closed.
 *   7. `awaiting-proposal`  — empty-state per ADR 0030 §10.
 */
export const ROLLUP_PRIORITY: readonly FacetStatus[] = [
  'proposed',
  'meta-disagreement',
  'disputed',
  'agreed',
  'committed',
  'withdrawn',
  'awaiting-proposal',
];

/**
 * Return the highest-priority `FacetStatus` present in the per-facet
 * record per `ROLLUP_PRIORITY`. Returns `undefined` when the record is
 * empty (no facet entries) — the audience-side `projectGraph` consumer
 * then stamps the literal sentinel string `'none'` onto the element
 * data so Cytoscape's selector engine has a stable value to match on
 * (`[rollupStatus = '<state>']` would not match against `undefined`).
 * Decision §4 of the refinement covers the sentinel-string choice.
 */
export function cardRollupStatus(
  facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>,
): FacetStatus | undefined {
  const present = new Set(Object.values(facetStatuses));
  for (const status of ROLLUP_PRIORITY) {
    if (present.has(status)) return status;
  }
  return undefined;
}
