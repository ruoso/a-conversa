// Detect pending consequences — agreed-substance edges whose source
// node substance is still unagreed.
//
// Refinement: tasks/refinements/data-and-methodology/pending_consequences_stub.md
// TaskJuggler: data_and_methodology.diagnostics.pending_consequences_stub
//
// Pure read function over the projection. Per `docs/data-model.md`
// line 104:
//
//   "Future development: the system could surface 'pending
//    consequences' as a structural diagnostic — `agreed`-substance
//    edges whose source substance is not yet agreed, signalling
//    commitments that would fire if the source were established. Out
//    of scope for v1; recorded as a possible future feature."
//
// A pending consequence is the *inverse half* of active firing:
// `isEdgeActive` (data-model.md line 100) requires
// `edge.substance ∧ source.substance` both settled-agreed; a pending
// consequence has the edge-half settled-agreed and the source-half
// NOT settled-agreed. The canonical worked example is the defeater
// pattern (data-model.md line 102): a pre-committed `rebuts` whose
// source isn't yet substantively established sits in the graph but
// does not currently fire. The same structural shape applies to every
// edge role.
//
// Stub status per the WBS note. The detector is callable and tested,
// but in v1 it is NOT wired into `diagnostic_event_emission` or
// classified by `blocking_vs_advisory_classification` (both M2
// siblings). Re-promoting it to a full diagnostic in a later release
// is wiring-only — no detection-logic work. See the refinement
// "Decisions" section for what is and is not deferred.
//
// Filter, in evaluation order (per the refinement Decisions section):
//   1. `edge.visible === true` — broken edges (per committed
//      `break-edge`) and edges whose endpoints were superseded by
//      decompose / restructure don't participate.
//   2. Edge substance settled-agreed (status in {'agreed',
//      'committed'} AND effective value === 'agreed'). Same predicate
//      as the first half of `isEdgeActive`; we don't call
//      `isEdgeActive` directly because the SECOND half — the source
//      check — needs to *fail* in a specific direction (status
//      non-settled OR value not 'agreed'-when-settled-via-non-disputed
//      path). Negating `isEdgeActive` would conflate distinct cases.
//   3. Source-node present and visible (defensive — the projection's
//      visibility derivation cascades endpoint visibility onto edges,
//      so a visible edge whose source is missing/invisible would be a
//      projection-invariant violation; skip rather than throw,
//      matching the sibling detectors' pattern).
//   4. Source-node substance NOT settled-agreed. Three accepted
//      non-settled statuses produce three `reason` values:
//        - 'proposed' → 'source-substance-proposed'
//        - 'disputed' / 'withdrawn' → 'source-substance-disputed'
//        - 'meta-disagreement' → 'source-substance-meta-disagreement'
//      The settled-but-value-disputed case (status in {'agreed',
//      'committed'} with effective value 'disputed') is EXCLUDED —
//      the methodology has agreed the source's content is not true,
//      so the edge will never fire ("not pending — settled-not-true").
//
// Boundary with siblings:
//   - `active-firing.ts` provides the symmetric primitive
//     (`isEdgeActive`); this detector is its asymmetric counterpart.
//     The `statusEstablishesTruth` predicate and `resolveSubstanceValue`
//     helper are mirrored here (a small duplication; the alternative
//     was a refactor of `active-firing.ts` to export them, out of
//     scope for a stub — see refinement).
//   - `contradiction-detection.ts` (sibling) — same module layout,
//     pure-read shape, visibility-filter pattern.
//   - `diagnostic_event_emission` (M2 sibling, not yet landed) MAY
//     consume this detector's output in a later release; v1 does not
//     wire it in (the "stub" framing).
//   - `blocking_vs_advisory_classification` (M2 sibling, not yet
//     landed) would classify pending consequences as advisory if and
//     when they surface (per the doc's "signalling commitments"
//     framing — never blocking).

import type { Projection } from '../projection/projection.js';
import { deriveFacetStatus } from '../projection/facet-status.js';
import type { FacetState, FacetStatus } from '../projection/types.js';
import type { ProposalPayload } from '@a-conversa/shared-types';

/**
 * One pending consequence in the visible graph: a visible edge whose
 * substance facet is settled-agreed (status in `{'agreed',
 * 'committed'}`, effective value `'agreed'`) but whose source node's
 * substance facet is NOT settled-agreed (status not in `{'agreed',
 * 'committed'}`, OR status `'committed'`/`'agreed'` with effective
 * value `'disputed'` — but the latter is settled-not-true and is
 * EXCLUDED, see Decisions).
 *
 * `reason` discriminates the source-side unsettledness:
 *   - `'source-substance-proposed'` — the source substance has a live
 *     proposal but no full agree-vote pass; or no proposal at all
 *     (the facet is still at its initial `'proposed'` state).
 *   - `'source-substance-disputed'` — at least one participant has
 *     disputed the source substance proposal (the source is in
 *     unsettled disagreement). Also covers the `'withdrawn'` case
 *     (a previously-committed substance whose agreement has been
 *     withdrawn returns to the disputed state per data-model.md
 *     line 80).
 *   - `'source-substance-meta-disagreement'` — the source substance
 *     has been marked as a meta-disagreement.
 */
export interface PendingConsequence {
  edgeId: string;
  sourceNodeId: string;
  reason:
    | 'source-substance-proposed'
    | 'source-substance-disputed'
    | 'source-substance-meta-disagreement';
}

/**
 * Detect pending consequences in the visible graph.
 *
 * Pure read function. Returns the set of pending consequences as a
 * list of `PendingConsequence` entries. Empty when no edge matches.
 *
 * Iteration order: `projection.edges()` insertion order (edge
 * creation order). Deterministic for a given projection.
 *
 * Complexity: O(E) over the visible edges.
 */
export function detectPendingConsequences(projection: Projection): PendingConsequence[] {
  const result: PendingConsequence[] = [];
  for (const edge of projection.edges()) {
    // Rule 1: visible.
    if (!edge.visible) continue;

    // Rule 2: edge substance settled-agreed.
    const edgeStatus = deriveFacetStatus(projection, 'edge', edge.id, 'substance');
    if (!statusEstablishesTruth(edgeStatus)) continue;
    if (resolveSubstanceValue(projection, edge.substanceFacet) !== 'agreed') continue;

    // Rule 3: source-node present and visible.
    const source = projection.getNode(edge.sourceNodeId);
    if (!source || !source.visible) continue;

    // Rule 4: source-node substance NOT settled-agreed.
    const sourceStatus = deriveFacetStatus(projection, 'node', edge.sourceNodeId, 'substance');
    if (statusEstablishesTruth(sourceStatus)) {
      // Settled. If value is 'agreed' → active edge → exclude.
      // If value is 'disputed' → settled-not-true → exclude.
      // Either way, not a pending consequence.
      continue;
    }

    // Source substance status is one of:
    // 'proposed' | 'disputed' | 'withdrawn' | 'meta-disagreement'.
    const reason = reasonForUnsettledStatus(sourceStatus);
    if (reason === null) {
      // Defensive: covers any future widening of FacetStatus. v1's
      // enum has no other values, so this branch is unreachable today.
      continue;
    }

    result.push({
      edgeId: edge.id,
      sourceNodeId: edge.sourceNodeId,
      reason,
    });
  }
  return result;
}

// ---------------------------------------------------------------
// Internal helpers — mirror the ones in `active-firing.ts` and
// `contradiction-detection.ts`. Small duplication, deliberate: the
// alternative was exporting them from `active-firing.ts`, which is
// out of scope for a stub diagnostic per the refinement.
// ---------------------------------------------------------------

// A facet "establishes truth" — and therefore counts as
// settled-agreed-or-committed — when its derived status is `'agreed'`
// or `'committed'`. The other four statuses (`'proposed'`,
// `'disputed'`, `'withdrawn'`, `'meta-disagreement'`) do not.
function statusEstablishesTruth(status: FacetStatus): boolean {
  return status === 'agreed' || status === 'committed';
}

function proposalSubstanceValue(payload: ProposalPayload): 'agreed' | 'disputed' | null {
  if (payload.kind === 'set-node-substance' || payload.kind === 'set-edge-substance') {
    return payload.value;
  }
  return null;
}

// Resolve the effective substance value for a facet. Post-commit:
// `facetState.value` is authoritative. Pre-commit: walk the
// per-participant entries; look up the proposal in `pendingProposals`
// (pre-commit) or `committedProposals` (post-commit fallback) and
// read its value. Mirrors `active-firing.ts`.
function resolveSubstanceValue(
  projection: Projection,
  facetState: FacetState<'agreed' | 'disputed'>,
): 'agreed' | 'disputed' | null {
  if (facetState.value !== null) {
    return facetState.value;
  }
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

// Map an unsettled-source `FacetStatus` to the public `reason`
// discriminator. Returns `null` for the settled statuses
// (`'agreed'`, `'committed'`) — they should be filtered out by the
// caller before this is called; the `null` return is defensive.
//
// `'withdrawn'` maps to `'source-substance-disputed'` per the
// refinement: a withdrawn agreement returns the facet to a disputed
// state (data-model.md line 80). We don't surface `'withdrawn'` in
// the public discriminator because (a) it's an instance of disputed,
// and (b) `'withdrawn'` is `deriveFacetStatus`-output-only and the
// rest of the diagnostics API doesn't expose that derived-vs-stored
// distinction.
function reasonForUnsettledStatus(status: FacetStatus): PendingConsequence['reason'] | null {
  switch (status) {
    case 'proposed':
      return 'source-substance-proposed';
    // TODO(pf_projection_facet_status_refactor): `'awaiting-proposal'` is
    // the empty-state row introduced by `pf_awaiting_proposal_facet_status`
    // — the entity exists but no candidate value has been set for the
    // substance facet yet (no `set-node-substance` proposal). Semantically
    // it sits BEFORE `proposed` (no candidate, no votes). For the
    // pending-consequences diagnostic this is equivalent to `proposed`:
    // there is no candidate to compute a consequence against and the
    // source-substance is unsettled. The downstream
    // `pf_projection_facet_status_refactor` task will revisit this default
    // when it lands the real emission rules for `'awaiting-proposal'`.
    case 'awaiting-proposal':
      return 'source-substance-proposed';
    case 'disputed':
    case 'withdrawn':
      return 'source-substance-disputed';
    case 'meta-disagreement':
      return 'source-substance-meta-disagreement';
    case 'agreed':
    case 'committed':
      return null;
  }
}
