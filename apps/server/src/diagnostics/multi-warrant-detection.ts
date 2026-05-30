// Detect multi-warrant patterns in the visible graph.
//
// Refinement: tasks/refinements/data-and-methodology/multi_warrant_detection.md
// TaskJuggler: data_and_methodology.diagnostics.multi_warrant_detection
//
// Pure read function over the projection. Per `docs/data-model.md`
// line 187 ("Multiple competing warrants on one data→claim move"):
// "When two or more warrants both bridge the same (data, claim)
// pair, and they assert different bridges, this is a strong signal
// that the claim is bundling multiple things. Each warrant is
// anchoring on a different aspect of the claim. The system highlights
// this pattern as a likely-decomposition prompt …"
//
// Per `docs/data-model.md` lines 122–131 ("Warrants and bridging"),
// a warrant `W` is an ordinary node that licenses the inference from
// data `D` to claim `C` through TWO directed edges from W:
//   - A `bridges-from` edge `W → D` (to the data node).
//   - A `bridges-to`   edge `W → C` (to the claim node).
//
// Filtering, in evaluation order (per the refinement Decisions
// section):
//   1. `edge.visible === true` — broken edges and edges whose
//      endpoints were superseded by decompose / restructure don't
//      participate. The projection's visibility derivation is the
//      source of truth.
//   2. For each visible `bridges-from` edge `W → D`: identify W as a
//      warrant candidate.
//   3. Look up W's outgoing edges via `getEdgesBySource(W)` for every
//      visible `bridges-to` edge `W → C`.
//   4. Both endpoint nodes (W, D, C) must exist on the projection
//      and be visible — defensive guard mirroring the sibling
//      detectors' pattern.
//   5. Record W under the (D, C) group.
//   6. Emit each (D, C) group with `warrantNodeIds.length >= 2`;
//      sort `warrantNodeIds` lexicographically for stable output.
//
// Notably absent: no `isEdgeActive` gate, no substance-agreement
// check on any of the bridging edges or the (D, C) nodes. Per
// `docs/data-model.md` line 187 the diagnostic fires on the
// **structural co-occurrence** of two warrants on a (D, C) pair —
// it doesn't depend on whether the bridging edges' substance facets
// have been agreed. Even competing warrants whose substance is still
// being debated are a methodological signal worth surfacing. This is
// a deliberate divergence from `detectSupportsCycles` and
// `detectContradictions`, both of which gate on `isEdgeActive`.
//
// Boundary with siblings:
//   - `coherency_hint_detection` (sibling task, not yet landed)
//     catches **incomplete** warrants — a `bridges-from` without a
//     matching `bridges-to`, or vice versa. This detector counts
//     only **complete** warrants (both edges present and visible).
//   - `diagnostic_event_emission` (M2 sibling) wires this function's
//     output into the event-stream surface.
//   - `blocking_vs_advisory_classification` (M2 sibling) classifies
//     multi-warrant diagnostics alongside cycle / contradiction /
//     dangling-claim / coherency-hint diagnostics.

import type { Projection } from '../projection/projection.js';

/**
 * One multi-warrant pattern in the visible graph: a (data, claim)
 * pair plus two or more warrant nodes that all bridge from `data`
 * to `claim` via paired `bridges-from` + `bridges-to` edges.
 *
 * `dataNodeId` and `claimNodeId` carry the directed pair (data and
 * claim sides are distinct — no canonical reordering).
 * `warrantNodeIds` is sorted lexicographically for stable output.
 */
export interface MultiWarrant {
  dataNodeId: string;
  claimNodeId: string;
  warrantNodeIds: string[];
}

/**
 * Detect multi-warrant patterns in the visible graph.
 *
 * Pure read function. Returns the set of (data, claim) pairs that
 * have two or more warrants bridging them, as a list of
 * `MultiWarrant` entries. Empty when no such pattern exists.
 *
 * The filter is structural only — no substance-agreement gate per
 * `docs/data-model.md` line 187. See the file header and the
 * refinement Decisions section for the rationale.
 */
export function detectMultiWarrants(projection: Projection): MultiWarrant[] {
  // (D, C) pair key -> { dataNodeId, claimNodeId, warrantNodeIds }.
  // Using a `Map<string, MultiWarrant>` so insertion order is
  // preserved deterministically and the warrant-id list can be
  // accumulated in O(1) per addition.
  const byPair = new Map<string, MultiWarrant>();

  // Outer walk: every visible `bridges-from` edge identifies a
  // warrant candidate `W` and a data node `D`.
  for (const fromEdge of projection.edges()) {
    if (!fromEdge.visible) continue;
    if (fromEdge.role !== 'bridges-from') continue;
    // Per `projection_edge_annotation_endpoint` D4: warrants are
    // node-node constructs (the (data, warrant, claim) triple is
    // three nodes). An annotation endpoint can't play the data or
    // warrant role here. Skip.
    if (fromEdge.sourceNodeId === null || fromEdge.targetNodeId === null) continue;

    const warrantId = fromEdge.sourceNodeId;
    const dataId = fromEdge.targetNodeId;

    const warrantNode = projection.getNode(warrantId);
    const dataNode = projection.getNode(dataId);
    if (!warrantNode || !dataNode) continue;
    if (!warrantNode.visible || !dataNode.visible) continue;

    // For each visible `bridges-to` originating at the same warrant
    // node, pair the data node with the claim node W bridges to.
    // `getEdgesBySource(W)` returns W's outgoing edges efficiently
    // (O(1) source-index lookup) — without it we'd re-walk
    // `projection.edges()` per warrant.
    for (const toEdge of projection.getEdgesBySource(warrantId)) {
      if (!toEdge.visible) continue;
      if (toEdge.role !== 'bridges-to') continue;
      // Per `projection_edge_annotation_endpoint` D4: an annotation-
      // endpoint target can't play the claim role. Skip.
      if (toEdge.targetNodeId === null) continue;

      const claimId = toEdge.targetNodeId;
      const claimNode = projection.getNode(claimId);
      if (!claimNode || !claimNode.visible) continue;

      // Null-byte separator: UUID v4 strings never contain \0, so
      // the join is unambiguous. Defensive against future id
      // schemes that might include common separators.
      const key = `${dataId} ${claimId}`;
      const existing = byPair.get(key);
      if (existing) {
        // De-dup: a warrant with TWO `bridges-from` edges (both to
        // the same D) and ONE `bridges-to` (to C) would otherwise be
        // counted twice for the same (D, C) group. Practically rare,
        // but the inclusion check keeps the warrantNodeIds list a
        // set in disguise.
        if (!existing.warrantNodeIds.includes(warrantId)) {
          existing.warrantNodeIds.push(warrantId);
        }
      } else {
        byPair.set(key, {
          dataNodeId: dataId,
          claimNodeId: claimId,
          warrantNodeIds: [warrantId],
        });
      }
    }
  }

  // Filter to groups with >= 2 warrants and sort warrant ids for
  // stable output. Pair iteration order is Map insertion order —
  // deterministic for a given projection.
  const result: MultiWarrant[] = [];
  for (const entry of byPair.values()) {
    if (entry.warrantNodeIds.length < 2) continue;
    entry.warrantNodeIds.sort();
    result.push(entry);
  }
  return result;
}
