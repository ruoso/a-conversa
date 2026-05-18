// `lookupEntity.ts` — resolve a `Selection` (the participant's
// `useSelectionStore` slot) to a concrete `ParticipantNodeData` /
// `ParticipantEdgeData` element from the route-hoisted projection output,
// or `null` when no element matches (the stale-entity branch — Decision
// §10 of `part_entity_detail_panel`).
//
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel.md
//              (Decision §10 — staleness manifests in three cases:
//              (i) a deleted entity (rare today — the methodology has no
//              entity-deletion event yet), (ii) a dangling-edge filter
//              dropping an edge from the projection, and (iii) a snapshot-
//              reload race where the selection persists across the
//              reload but the snapshot doesn't yet contain the entity.
//              The panel renders a localized "this element is no longer
//              present" body AND auto-clears the selection on the next
//              tick when this helper returns `null`.)
//
// ADRs:
//   - 0022 (no throwaway verifications — every behaviour below is
//           pinned by `lookupEntity.test.ts`).

import type { Selection } from '../stores/selectionStore';
import type { ParticipantEdgeData, ParticipantNodeData } from '../graph/projectGraph';

/**
 * Resolve a `Selection` to a concrete projected node or edge `data`
 * record. Returns `null` for any of:
 *
 *   - `selection === null` (nothing selected — the panel renders the
 *     empty-state body).
 *   - `selection.kind === 'annotation'` (reserved for a future
 *     annotation-tap surface; no current handling per Decision §3 of
 *     `part_entity_detail_panel`).
 *   - `selection.kind === 'node'` and no node in `projectedNodes`
 *     matches `selection.id` (the stale-entity branch).
 *   - `selection.kind === 'edge'` and no edge in `projectedEdges`
 *     matches `selection.id` (the stale-entity branch).
 *
 * Otherwise returns the matching `data` record. The caller (`<EntityDetailPanel>`)
 * discriminates the return on the same `selection.kind` it passed in to
 * decide which render branch to take.
 *
 * Straight `.find()` by id — O(n) per call but n is small in practice
 * (per-session node count is bounded by the methodology's WBS-budget;
 * the moderator's `mod_pending_proposals` peaks well under 100). Pre-
 * indexing by id would be a sub-day optimization the v0 doesn't need.
 */
export function lookupEntity(
  projectedNodes: readonly ParticipantNodeData[],
  projectedEdges: readonly ParticipantEdgeData[],
  selection: Selection | null,
): ParticipantNodeData | ParticipantEdgeData | null {
  if (selection === null) return null;
  if (selection.kind === 'node') {
    return projectedNodes.find((node) => node.id === selection.id) ?? null;
  }
  if (selection.kind === 'edge') {
    return projectedEdges.find((edge) => edge.id === selection.id) ?? null;
  }
  // `selection.kind === 'annotation'` arm — reserved for the future
  // annotation-tap surface. The current tap handler only writes node /
  // edge selections so the arm is unreachable today; explicit `null`
  // keeps the panel rendering the empty-state body if a future seam
  // writes an annotation selection before the panel knows how to
  // surface it.
  return null;
}
