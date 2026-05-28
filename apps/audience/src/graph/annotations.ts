// Annotation derivation for the audience broadcast `<AudienceGraphView>`.
//
// Refinement: tasks/refinements/audience/aud_annotation_rendering.md
//              (Decision §1 — per-annotation badges (NOT a boolean+count
//              overlay); the audience inverts the participant's collapse
//              because the broadcast surface has no detail panel.
//              Decision §2 — scope to node-targeted annotations; edge-
//              targeted are deferred to the named-future-task
//              `aud_annotation_rendering_edges`. Decision §3 — verbatim
//              inline port of the projection helpers minus the unused
//              boolean/count helpers; the third-caller trigger fires
//              `shell_package.extract_cytoscape_projectors` (already
//              registered, no new WBS entry).)
//
// **Parallel client mirror**: this module is a verbatim port of the
// participant's `apps/participant/src/graph/annotations.ts` (which is
// itself a port of the moderator's `apps/moderator/src/graph/selectors.ts`
// annotation block). All three client ports must stay in lock-step
// against a future wire-event shape change; the natural unification
// point is `shell_package.extract_cytoscape_projectors`
// ([`tasks/27-shell-package.tji:101-108`]) — this leaf's third-caller
// landing fires the trigger condition that task's description names.
//
// **Methodology semantics**: `docs/methodology.md` §"Annotations" — the
// meta-commentary layer of the methodology (notes, reframes, scope-
// changes, stance pins) attached to existing nodes or edges via a
// polymorphic-FK XOR (`(target_node_id === null) !== (target_edge_id
// === null)`, enforced by Zod at validation time).
//
// **NOT ported** from the participant's mirror: `groupAnnotationsByEdge`
// / `nodeHasAnnotation` / `edgeHasAnnotation` / `annotationCountFor`.
// Edge-targeted annotations are out of scope per Decision §2 (deferred
// to `aud_annotation_rendering_edges`); the audience reads the full
// per-node list rather than a boolean/count collapse so the
// presence-only helpers are unused. The `extract_cytoscape_projectors`
// lift will pick up the full helper set from the moderator + participant
// copies.

import type { AnnotationKind, Event } from '@a-conversa/shared-types';

/**
 * Camel-cased annotation projected off the wire `annotation-created`
 * payload. Consumers (the projection's per-node stamping, the audience
 * badge component) see this shape, not the snake-cased payload — the
 * port is the conversion boundary so callers don't re-handle the wire
 * keys.
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
 * to consumers when a node has no annotations, so React-memoization
 * (`Array.length === 0` is identity-stable here) doesn't see a fresh
 * array on every projection pass. Same posture as `EMPTY_FACET_STATUSES`
 * and `EMPTY_AXIOM_MARKS`.
 */
export const EMPTY_ANNOTATIONS: readonly Annotation[] = Object.freeze([]);

/**
 * Pure projection from a session's event log to the `Annotation[]`
 * shape. Single-pass walk; every `annotation-created` envelope converts
 * to a camelCased `Annotation` record preserving arrival order. All
 * other event kinds are ignored.
 *
 * Empty for an empty event log. Verbatim port of the participant's
 * `projectAnnotations`.
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
 * Bucket annotations by their node target. Annotations targeting an
 * edge (i.e. with `targetNodeId === null`) are skipped — the wire
 * schema's XOR guarantees each annotation goes to exactly one bucket
 * between this helper and `groupAnnotationsByEdge` (the latter not
 * ported on the audience surface; edge-targeted annotations are out of
 * scope per Decision §2).
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
