// Active-firing computation for edges.
//
// Refinement: tasks/refinements/data-and-methodology/active_firing_computation.md
// TaskJuggler: data_and_methodology.projection.active_firing_computation
//
// Pure read function over the projection. Per `docs/data-model.md`
// line 100: "Whether the relation is actively firing on the graph
// right now — whether the data actually supports, whether the
// contradiction actually obtains, whether the warrant actually
// licenses the inference — is the conjunction
// `edge.substance ∧ source.substance`. Both must be `agreed` for the
// relation to take current effect."
//
// "Agreed" in the post-`per_facet_status_derivation` vocabulary
// covers both `'agreed'` (every current participant voted agree, no
// commit yet) and `'committed'` (`'agreed'` + moderator commit) —
// both establish truth. `'withdrawn'`, `'disputed'`, `'proposed'`,
// `'meta-disagreement'` do not. In addition the facet's *value*
// must be `'agreed'` (not `'disputed'`): a committed-disputed
// substance is a settled rejection and does not fire.
//
// Pre-commit, `FacetState.value` is `null` (the dispatcher only
// stores the value at commit time). For the pre-commit `'agreed'`
// case we resolve the value by looking up the proposal that the
// current participants voted on — every per-participant entry
// records `proposalEventId`, and the proposal payload (in
// `pendingProposals` pre-commit, in `committedProposals` post-
// commit) carries the value. A facet is therefore firing-positive
// iff its effective substance value is `'agreed'`, regardless of
// whether the value is read from the facet itself or from the
// underlying proposal.
//
// Target-node substance does NOT participate. The defeater pattern
// (`docs/data-model.md` line 102) specifically requires that a
// `rebuts` with agreed substance and agreed source fire against its
// target regardless of target state.
//
// Boundary with downstream: the structural-diagnostics task family
// (cycle detection, contradiction detection, multi-warrant) consumes
// this primitive to filter the graph to actively-firing edges. The
// WS broadcaster may eventually surface an `EdgeActiveChanged`
// event on transitions; that's a downstream concern.

import type { Projection } from './projection.js';
import { deriveFacetStatus } from './facet-status.js';
import type { FacetState, FacetStatus } from './types.js';
import type { ProposalPayload } from '@a-conversa/shared-types';

export class ActiveFiringComputationError extends Error {
  override readonly name = 'ActiveFiringComputationError';
}

// A facet "establishes truth" — and therefore contributes to active
// firing — when its derived status is `'agreed'` or `'committed'`.
// Other statuses (`'proposed'`, `'disputed'`, `'withdrawn'`,
// `'meta-disagreement'`) do not.
function statusEstablishesTruth(status: FacetStatus): boolean {
  return status === 'agreed' || status === 'committed';
}

// Pull the substance value carried by the proposal payload, when the
// payload addresses a substance facet. Returns null for unrelated
// proposal kinds.
function proposalSubstanceValue(payload: ProposalPayload): 'agreed' | 'disputed' | null {
  if (payload.kind === 'set-node-substance' || payload.kind === 'set-edge-substance') {
    return payload.value;
  }
  return null;
}

// Resolve the effective substance value for a facet. Post-commit:
// `facetState.value` is authoritative. Pre-commit: walk the
// per-participant entries (they all reference the same proposal in
// the all-agree case); look up the proposal in `pendingProposals`
// (pre-commit) or `committedProposals` (post-commit fallback) and
// read its value.
//
// Returns `null` if no value can be resolved (no proposal yet — the
// pre-commit `'proposed'` case never calls into here because the
// status check short-circuits earlier, but the fallback keeps the
// helper total).
function resolveSubstanceValue(
  projection: Projection,
  facetState: FacetState<'agreed' | 'disputed'>,
): 'agreed' | 'disputed' | null {
  if (facetState.value !== null) {
    return facetState.value;
  }
  // Pick any per-participant entry; they all reference the proposal
  // currently in play. (In the all-agree pre-commit case every entry
  // has the same `proposalEventId`. Once a withdrawal lands without
  // a prior commit, the derivation has already returned `'disputed'`
  // and this helper isn't called.)
  for (const record of facetState.perParticipant.values()) {
    const pending = projection.getPendingProposal(record.proposalEventId);
    if (pending) {
      return proposalSubstanceValue(pending.payload);
    }
    const committed = projection.getCommittedProposal(record.proposalEventId);
    if (committed) {
      return proposalSubstanceValue(committed.payload);
    }
  }
  return null;
}

/**
 * Return `true` iff the edge is currently actively firing in the
 * graph. An edge fires iff:
 *   - Its `substance` facet's derived status is `'agreed'` or
 *     `'committed'` AND the effective substance value is `'agreed'`.
 *   - The source node's `substance` facet satisfies the same two
 *     conditions.
 *
 * Target-node substance does NOT participate (see the data-model
 * doc's defeater paragraph and this task's refinement).
 *
 * Throws `ActiveFiringComputationError` if the edge id is unknown
 * to the projection, or if the edge's `sourceNodeId` references a
 * node not present in the projection (which would be a projection-
 * invariant violation; the dispatcher's `edge-created` handler
 * validates source/target presence at write time).
 */
export function isEdgeActive(projection: Projection, edgeId: string): boolean {
  const edge = projection.getEdge(edgeId);
  if (!edge) {
    throw new ActiveFiringComputationError(`edge ${edgeId} not present in projection`);
  }
  const sourceNode = projection.getNode(edge.sourceNodeId);
  if (!sourceNode) {
    throw new ActiveFiringComputationError(
      `edge ${edgeId}: source node ${edge.sourceNodeId} not present in projection`,
    );
  }

  // Edge substance must be settled-true (status in {agreed, committed}
  // AND effective value === 'agreed').
  const edgeStatus = deriveFacetStatus(projection, 'edge', edgeId, 'substance');
  if (!statusEstablishesTruth(edgeStatus)) {
    return false;
  }
  if (resolveSubstanceValue(projection, edge.substanceFacet) !== 'agreed') {
    return false;
  }

  // Source-node substance must be settled-true (same rule).
  const sourceStatus = deriveFacetStatus(projection, 'node', edge.sourceNodeId, 'substance');
  if (!statusEstablishesTruth(sourceStatus)) {
    return false;
  }
  if (resolveSubstanceValue(projection, sourceNode.substanceFacet) !== 'agreed') {
    return false;
  }

  return true;
}

/**
 * Whole-graph active-firing computation. Returns a `Map<edgeId,
 * boolean>` with one entry per edge in the projection, computed via
 * `isEdgeActive`. Iteration order follows `projection.edges()`
 * (Map preserves insertion order).
 *
 * If a projection-invariant violation surfaces during the walk
 * (a missing source-node referenced by an edge), the underlying
 * `ActiveFiringComputationError` propagates rather than being
 * swallowed — that condition signals a real bug.
 */
export function getActiveFiring(projection: Projection): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const edge of projection.edges()) {
    result.set(edge.id, isEdgeActive(projection, edge.id));
  }
  return result;
}
