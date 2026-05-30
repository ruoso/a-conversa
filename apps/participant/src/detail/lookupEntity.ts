// `lookupEntity.ts` — resolve a `Selection` (the participant's
// `useSelectionStore` slot) to a concrete `ParticipantNodeData` /
// `ParticipantEdgeData` / `Annotation` element from the route-hoisted
// projection output, or `null` when no element matches (the stale-entity
// branch — Decision §10 of `part_entity_detail_panel`).
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
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel_annotation_view.md
//              (Decision §1 — the `'annotation'` arm now resolves
//              against a flat `Annotation[]` threaded from the route's
//              `projectAnnotations(events)` memo. The return type widens
//              to include `Annotation`; the panel discriminates on
//              `selection.kind` to pick the render branch.)
//
// ADRs:
//   - 0022 (no throwaway verifications — every behaviour below is
//           pinned by `lookupEntity.test.ts`).

import type { Annotation } from '@a-conversa/shell';

import type { Selection } from '../stores/selectionStore';
import type { ParticipantEdgeData, ParticipantNodeData } from '../graph/projectGraph';

/**
 * Resolve a `Selection` to a concrete projected node / edge / annotation
 * record. Returns `null` for any of:
 *
 *   - `selection === null` (nothing selected — the panel renders the
 *     empty-state body).
 *   - `selection.kind === 'node'` and no node in `projectedNodes`
 *     matches `selection.id` (the stale-entity branch).
 *   - `selection.kind === 'edge'` and no edge in `projectedEdges`
 *     matches `selection.id` (the stale-entity branch).
 *   - `selection.kind === 'annotation'` and no annotation in
 *     `annotations` matches `selection.id` (the stale-annotation
 *     branch — same body the node / edge branch uses, per Decision §6
 *     of `part_entity_detail_panel_annotation_view`).
 *
 * Otherwise returns the matching record. The caller (`<EntityDetailPanel>`)
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
  annotations: readonly Annotation[],
  selection: Selection | null,
): ParticipantNodeData | ParticipantEdgeData | Annotation | null {
  if (selection === null) return null;
  if (selection.kind === 'node') {
    return projectedNodes.find((node) => node.id === selection.id) ?? null;
  }
  if (selection.kind === 'edge') {
    return projectedEdges.find((edge) => edge.id === selection.id) ?? null;
  }
  return annotations.find((annotation) => annotation.id === selection.id) ?? null;
}
