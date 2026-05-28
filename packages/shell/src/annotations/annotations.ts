// Per-target annotation vocabulary for every UI surface.
//
// Refinement: tasks/refinements/shell-package/extract_cytoscape_projectors.md
//   (Third-caller lift: this module is the consolidated home of the
//   `Annotation` interface + `EMPTY_ANNOTATIONS` + `projectAnnotations` +
//   `groupAnnotationsByNode` + `groupAnnotationsByEdge` symbols that
//   previously lived in three verbatim copies — the moderator's
//   `apps/moderator/src/graph/selectors.ts:58-274` block, the participant's
//   `apps/participant/src/graph/annotations.ts`, and the audience's
//   `apps/audience/src/graph/annotations.ts`. The audience's
//   `aud_annotation_rendering` (node-side) + `aud_annotation_rendering_edges`
//   (edge-side) leaves landed as the third caller, firing the cross-surface
//   lift per the third-caller policy of `extract_facet_pill.md` Decision §2.)
//
// Predecessor refinements:
//   - tasks/refinements/moderator-ui/mod_annotation_rendering.md
//     (canonical source — defined the `Annotation` interface shape +
//     `projectAnnotations` walk + both `groupAnnotationsBy*` bucketers).
//   - tasks/refinements/participant-ui/part_annotation_render.md
//     (verbatim port + participant-local `nodeHasAnnotation` /
//     `edgeHasAnnotation` / `annotationCountFor` boolean+count helpers that
//     stay in the participant workspace).
//   - tasks/refinements/audience/aud_annotation_rendering.md +
//     tasks/refinements/audience/aud_annotation_rendering_edges.md
//     (verbatim port across both node-side and edge-side leaves — the
//     third caller that fired this extraction).
//
// Methodology semantics: `docs/methodology.md` §"Annotations" — the
// meta-commentary layer of the methodology (notes, reframes, scope-
// changes, stance pins) attached to existing nodes or edges via a
// polymorphic-FK XOR (`(target_node_id === null) !== (target_edge_id
// === null)`, enforced by Zod at validation time).
//
// ADRs:
//   - 0021 (event envelope discriminated union — the projection narrows
//     on the `annotation-created` arm);
//   - 0026 (micro-frontend root app — the shell package is the
//     architecturally-correct destination for cross-surface vocabulary);
//   - 0027 (entity / facet layers are strictly separate — annotations
//     are an entity-layer methodology vocabulary, sibling to but distinct
//     from the facet-pill and axiom-marks vocabularies).

import type { AnnotationKind, Event } from '@a-conversa/shared-types';

/**
 * Camel-cased annotation projected off the wire `annotation-created`
 * payload. Consumers (the node / edge projections, the badge components)
 * see this shape, not the snake-cased payload — the projector is the
 * conversion boundary so callers don't re-handle the wire keys.
 *
 * The `target_node_id` / `target_edge_id` XOR enforced by Zod at the
 * validation seam is preserved as a `string | null` pair on the camelCased
 * shape; consumers route the annotation to a node or an edge target by
 * checking which field is non-null.
 */
export interface Annotation {
  readonly id: string;
  readonly kind: AnnotationKind;
  readonly content: string;
  readonly targetNodeId: string | null;
  readonly targetEdgeId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

/**
 * Module-scope shared empty annotation array. Hands a stable reference
 * to consumers when a target has no annotations, so React / ReactFlow /
 * Cytoscape memoization (`Array.length === 0` is identity-stable here)
 * doesn't see a fresh array on every projection pass.
 */
export const EMPTY_ANNOTATIONS: readonly Annotation[] = Object.freeze([]);

/**
 * Pure projection from an `Event[]` slice to the `Annotation[]` shape.
 *
 * Walks `events` once. Every `annotation-created` envelope converts to a
 * camelCased `Annotation` record preserving arrival order. All other event
 * kinds are ignored at this layer.
 *
 * Empty for an empty event log.
 */
export function projectAnnotations(events: readonly Event[]): Annotation[] {
  const out: Annotation[] = [];
  for (const event of events) {
    if (event.kind !== 'annotation-created') continue;
    out.push({
      id: event.payload.annotation_id,
      kind: event.payload.kind,
      content: event.payload.content,
      targetNodeId: event.payload.target_node_id,
      targetEdgeId: event.payload.target_edge_id,
      createdBy: event.payload.created_by,
      createdAt: event.payload.created_at,
    });
  }
  return out;
}

/**
 * Bucket annotations by their node target.
 *
 * Returns a `Map` rather than a plain `Object` so `get(id)` lookups are
 * O(1) without the JSON-key string-coercion gotcha that surfaces when
 * ids contain dashes (UUIDs do). Annotations targeting an edge (i.e.
 * with `targetNodeId === null`) are skipped — the wire schema's XOR
 * (enforced by Zod at validation time) guarantees each annotation goes
 * to exactly one bucket between this helper and `groupAnnotationsByEdge`.
 */
export function groupAnnotationsByNode(
  annotations: readonly Annotation[],
): Map<string, Annotation[]> {
  const out = new Map<string, Annotation[]>();
  for (const annotation of annotations) {
    if (annotation.targetNodeId === null) continue;
    const existing = out.get(annotation.targetNodeId);
    if (existing) {
      existing.push(annotation);
    } else {
      out.set(annotation.targetNodeId, [annotation]);
    }
  }
  return out;
}

/**
 * Bucket annotations by their edge target. Annotations targeting a
 * node (`targetEdgeId === null`) are skipped. Same `Map` rationale as
 * `groupAnnotationsByNode`; the wire schema's XOR refinement guarantees
 * this helper and `groupAnnotationsByNode` are mutually exclusive over a
 * well-formed annotation log.
 */
export function groupAnnotationsByEdge(
  annotations: readonly Annotation[],
): Map<string, Annotation[]> {
  const out = new Map<string, Annotation[]>();
  for (const annotation of annotations) {
    if (annotation.targetEdgeId === null) continue;
    const existing = out.get(annotation.targetEdgeId);
    if (existing) {
      existing.push(annotation);
    } else {
      out.set(annotation.targetEdgeId, [annotation]);
    }
  }
  return out;
}
