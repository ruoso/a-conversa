// Annotation derivation for the participant's read-mostly `<GraphView>`.
//
// Refinement: tasks/refinements/participant-ui/part_annotation_render.md
//              (Decision §1 — boolean `hasAnnotation` + numeric
//              `annotationCount` overlay at the at-a-glance card layer;
//              per-annotation chromatic identity stays a moderator-only
//              seam until the entity detail panel lands. Symmetric across
//              node AND edge targets per the wire schema's XOR — the
//              structural divergence from `part_axiom_mark_decoration`,
//              which is node-only. Decision §2 — verbatim port of
//              `projectAnnotations` + both `groupAnnotationsBy*`
//              bucketers from the moderator workspace; no shell
//              extraction yet — two callers is YAGNI, lift when the
//              audience surface materialises as the third caller.)
//
// **Parallel client mirror**: this module is a verbatim port of the
// moderator's `apps/moderator/src/graph/selectors.ts:52-268`. Both
// client ports must stay in lock-step if a future annotation wire-event
// shape change lands (e.g. an `annotation-edited` or
// `annotation-removed` event kind); the natural unification point is
// `@a-conversa/shell` (lifted when the audience surface becomes the
// third caller).
//
// **Methodology semantics**: `docs/methodology.md` §"Agreement is
// per-facet and per-participant" — annotations are first-class
// methodology entities listed alongside facets in the per-participant
// tracking rule. The participant's at-a-glance card layer collapses
// the per-annotation list to a single presence boolean + count per
// target; the per-kind / per-author / per-content breakdown is the
// (future) entity-detail-panel consumer's concern.
//
// **NOT ported**: the moderator's per-annotation `AnnotationBadge`
// React component is explicitly NOT mirrored here. The participant's
// Cytoscape canvas paints a boolean + count overlay (Decision §1 +
// §3), not a per-annotation badge per target. The per-kind
// chromatic identity is owned by the future `part_entity_detail_panel`
// React surface, which can import the moderator's `AnnotationBadge`
// directly when it lands (the `methodology.annotationKind.*` catalog
// keys already exist for en-US / pt-BR / es-419).

import type { AnnotationKind, Event } from '@a-conversa/shared-types';

/**
 * Camel-cased annotation projected off the wire `annotation-created`
 * payload. Consumers (the projector, the future entity-detail-panel
 * badge component) see this shape, not the snake-cased payload — the
 * port is the conversion boundary so callers don't re-handle the wire
 * keys.
 *
 * The `target_node_id` / `target_edge_id` XOR enforced by Zod at the
 * validation seam ([`packages/shared-types/src/events.ts:300-317`]) is
 * preserved as a `string | null` pair on the camelCased shape;
 * consumers route the annotation to a node or an edge target by
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
 * to consumers when a target has no annotations, so React / memoization
 * (`Array.length === 0` is identity-stable here) doesn't see a fresh
 * array on every projection pass. Same rationale as the moderator's
 * `EMPTY_ANNOTATIONS` (and the predecessor leaf's `EMPTY_AXIOM_MARKS`).
 */
export const EMPTY_ANNOTATIONS: readonly Annotation[] = Object.freeze([]);

/**
 * Pure projection from a session's event log to the `Annotation[]`
 * shape. Single-pass walk; every `annotation-created` envelope
 * converts to a camelCased `Annotation` record preserving arrival
 * order. All other event kinds are ignored at this layer.
 *
 * Empty for an empty event log. Verbatim port of the moderator's
 * `projectAnnotations` from `apps/moderator/src/graph/selectors.ts`.
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
 * `groupAnnotationsByNode`.
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

/**
 * Boolean "does at least one committed annotation target this node?"
 * helper consumed by the projector to stamp `hasAnnotation` on every
 * emitted node element. Decision §8 — kept as a separate small
 * primitive so the future entity-detail-panel consumer can call it
 * directly as a precondition before rendering the badge row.
 */
export function nodeHasAnnotation(
  grouped: ReadonlyMap<string, readonly Annotation[]>,
  nodeId: string,
): boolean {
  return (grouped.get(nodeId)?.length ?? 0) > 0;
}

/**
 * Boolean "does at least one committed annotation target this edge?"
 * helper. Symmetric with `nodeHasAnnotation` (Decision §1 — annotations
 * target either a node OR an edge per the wire schema XOR; the
 * participant's projection consults both indexes to stamp the per-
 * target boolean on both element kinds).
 */
export function edgeHasAnnotation(
  grouped: ReadonlyMap<string, readonly Annotation[]>,
  edgeId: string,
): boolean {
  return (grouped.get(edgeId)?.length ?? 0) > 0;
}

/**
 * Per-target annotation count. Returns 0 for an unbucketed id; N for a
 * bucket carrying N entries. The projector consumes this helper to
 * stamp `annotationCount: number` on every emitted node + edge data
 * record (Decision §1 — count is methodologically meaningful at the
 * at-a-glance layer; a node with one note is a different signal from a
 * node with five annotations).
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
