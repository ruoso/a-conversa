// Detect dangling claim-positioned nodes in the visible graph.
//
// Refinement: tasks/refinements/data-and-methodology/dangling_claim_detection.md
// TaskJuggler: data_and_methodology.diagnostics.dangling_claim_detection
//
// Pure read function over the projection. Per `docs/data-model.md`
// line 192 ("Dangling claims"):
//
//   "A node positioned as a claim (i.e., something a debater is
//    defending) with no incoming `supports`, `rebuts`, or
//    `bridges-to` is "dangling." Not an error — claims can stand
//    briefly before being supported — but tracked as a state. A
//    claim that remains dangling for long is either being implicitly
//    accepted or implicitly conceded; the moderator can prompt for
//    support or for explicit disposition."
//
// "Claim-positioned" is operationalized as "at least one visible
// edge has this node as `targetNodeId` (with a visible source)."
// See the refinement Decisions section for the doc-reading rationale.
// An isolated node (no incoming edges) is not claim-positioned —
// nobody is asserting anything about it.
//
// "Dangling" then means: claim-positioned AND none of the visible
// incoming edges have role in the justification triplet
// `{supports, rebuts, bridges-to}`. The triplet is enumerated
// literally in `docs/data-model.md` line 192.
//
// Edge roles outside the triplet that DO make a node claim-positioned
// but do NOT justify it:
//   - `defines` — definitional, not justification.
//   - `qualifies` — hedges scope, not justification.
//   - `bridges-from` — points from a warrant to its data node; the
//     data node is being identified as data, not justified as a claim.
//   - `contradicts` — engagement (the node is being conflicted with)
//     but not justification. The doc's triplet excludes contradicts;
//     v1 follows the doc literally. See the refinement Open Questions
//     section if user testing surfaces this as noise.
//
// Filtering, in evaluation order (per the refinement Decisions
// section):
//   1. Walk `projection.nodes()`; skip if `!node.visible`.
//   2. Walk `projection.getEdgesByTarget(node.id)`; filter to
//      `edge.visible === true` AND `getNode(edge.sourceNodeId)?.visible
//      === true` (defensive — the projection cascades endpoint
//      visibility, but mirror the sibling detectors).
//   3. If the filtered incoming-edge list is empty → node is NOT
//      claim-positioned → skip (no entry).
//   4. If any filtered edge has role in {'supports', 'rebuts',
//      'bridges-to'} → node is justified → skip.
//   5. Otherwise → claim-positioned AND unjustified → emit `{ nodeId }`.
//
// Notably absent: no `isEdgeActive` gate, no substance-agreement
// check. Per `docs/data-model.md` line 192 the diagnostic fires on
// the **structural absence** of incoming justification — it doesn't
// depend on whether any node's or edge's substance facet has been
// agreed. This mirrors the multi-warrant detector's structural-only
// stance and diverges deliberately from the cycle / contradiction
// detectors (which gate on `isEdgeActive`).
//
// Boundary with siblings:
//   - `coherency_hint_detection` (sibling, not yet landed) flags
//     unusual edge/kind configurations and incomplete warrants
//     (`bridges-from` without matching `bridges-to`). That's about
//     the shape of what's there; this detector is about absence of
//     incoming justification.
//   - `diagnostic_event_emission` (M2 sibling) wires this function's
//     output into the event-stream surface.
//   - `blocking_vs_advisory_classification` (M2 sibling) classifies
//     dangling-claim diagnostics. Per the doc's "Not an error"
//     framing, dangling-claim is expected to land as advisory.

import type { Projection } from '../projection/projection.js';
import type { EdgeRole } from '@a-conversa/shared-types';

/**
 * One dangling claim-positioned node in the visible graph: a node
 * that has at least one visible incoming edge (so it is being
 * engaged with — "claim-positioned") but none of those incoming
 * edges have role in the justification triplet `{supports, rebuts,
 * bridges-to}` (so it is unjustified).
 *
 * v1 entry shape is minimal — just the node id. A future enhancement
 * could include the incoming-edge ids that make the node claim-
 * positioned (for the UI to render "Anna has a contradicts against
 * this but nobody has supported, rebutted, or warranted it"). The
 * current minimal shape mirrors the doc's "tracked as a state"
 * framing per the refinement Decisions section.
 */
export interface DanglingClaim {
  nodeId: string;
}

/**
 * Edge roles that justify a claim-positioned node — i.e., lift it
 * out of the dangling state. Enumerated literally from
 * `docs/data-model.md` line 192.
 *
 * The set is module-private but explicit so the test file and any
 * future reader can see the exact triplet at a glance.
 */
const JUSTIFICATION_ROLES: ReadonlySet<EdgeRole> = new Set<EdgeRole>([
  'supports',
  'rebuts',
  'bridges-to',
]);

/**
 * Detect dangling claim-positioned nodes in the visible graph.
 *
 * Pure read function. Returns the set of dangling claim-positioned
 * nodes as a list of `DanglingClaim` entries. Empty when no node
 * matches.
 *
 * Iteration order: `projection.nodes()` insertion order (node
 * creation order). Deterministic for a given projection.
 *
 * Complexity: O(N + E) — for each visible node, O(in-degree) over
 * the incoming-edge index.
 */
export function detectDanglingClaims(projection: Projection): DanglingClaim[] {
  const result: DanglingClaim[] = [];
  for (const node of projection.nodes()) {
    if (!node.visible) continue;

    let hasClaimPositioningEdge = false;
    let hasJustificationEdge = false;

    for (const edge of projection.getEdgesByTarget(node.id)) {
      if (!edge.visible) continue;
      // Defensive: the projection's visibility derivation cascades
      // endpoint visibility onto edges (per data-model.md lines
      // 287–293), so a visible edge with an invisible source
      // shouldn't happen — but skip rather than throw, matching the
      // sibling detectors' pattern.
      const source = projection.getNode(edge.sourceNodeId);
      if (!source || !source.visible) continue;

      hasClaimPositioningEdge = true;
      if (JUSTIFICATION_ROLES.has(edge.role)) {
        hasJustificationEdge = true;
        // Short-circuit: any one justification edge is enough to
        // lift the node out of dangling. No need to keep walking.
        break;
      }
    }

    if (hasClaimPositioningEdge && !hasJustificationEdge) {
      result.push({ nodeId: node.id });
    }
  }
  return result;
}
