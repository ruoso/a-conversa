// Annotation derivation for the participant's read-mostly `<GraphView>`.
//
// Refinement: tasks/refinements/participant-ui/part_annotation_render.md
//              (Decision §1 — boolean `hasAnnotation` + numeric
//              `annotationCount` overlay at the at-a-glance card layer;
//              per-annotation chromatic identity stays a moderator-only
//              seam until the entity detail panel lands. Symmetric across
//              node AND edge targets per the wire schema's XOR.)
// Refinement: tasks/refinements/shell-package/extract_cytoscape_projectors.md
//              (Decision §5 — file collapses to a re-export shim around
//              the shell-lifted projection trio plus the three
//              participant-local boolean+count helpers below. Existing
//              in-workspace imports of the five lifted names continue to
//              resolve through this shim without a rewire.)
//
// The five projection-trio symbols (`Annotation`, `EMPTY_ANNOTATIONS`,
// `projectAnnotations`, `groupAnnotationsByNode`, `groupAnnotationsByEdge`)
// live canonically in `@a-conversa/shell` after the third-caller lift.
// The three boolean+count helpers below stay participant-local: they
// collapse a per-target `Annotation[]` to a presence boolean + count for
// the participant's at-a-glance Cytoscape overlay; neither the moderator
// nor the audience consumes this collapse (both render the full per-
// annotation list).

export {
  EMPTY_ANNOTATIONS,
  groupAnnotationsByEdge,
  groupAnnotationsByNode,
  projectAnnotations,
  type Annotation,
} from '@a-conversa/shell';

import type { Annotation } from '@a-conversa/shell';

/**
 * Boolean "does at least one committed annotation target this node?"
 * helper consumed by the projector to stamp `hasAnnotation` on every
 * emitted node element.
 */
export function nodeHasAnnotation(
  grouped: ReadonlyMap<string, readonly Annotation[]>,
  nodeId: string,
): boolean {
  return (grouped.get(nodeId)?.length ?? 0) > 0;
}

/**
 * Boolean "does at least one committed annotation target this edge?"
 * helper. Symmetric with `nodeHasAnnotation` — annotations target either
 * a node OR an edge per the wire schema XOR; the participant's projection
 * consults both indexes to stamp the per-target boolean on both element
 * kinds.
 */
export function edgeHasAnnotation(
  grouped: ReadonlyMap<string, readonly Annotation[]>,
  edgeId: string,
): boolean {
  return (grouped.get(edgeId)?.length ?? 0) > 0;
}

/**
 * Per-target annotation count. Returns 0 for an unbucketed id; N for a
 * bucket carrying N entries. The projector consumes this helper to stamp
 * `annotationCount: number` on every emitted node + edge data record.
 *
 * Works on either index (`groupAnnotationsByNode` or
 * `groupAnnotationsByEdge`) — both share the same
 * `Map<string, readonly Annotation[]>` shape.
 */
export function annotationCountFor(
  grouped: ReadonlyMap<string, readonly Annotation[]>,
  id: string,
): number {
  return grouped.get(id)?.length ?? 0;
}
