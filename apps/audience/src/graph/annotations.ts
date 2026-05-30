// Annotation-endpoint helpers for the audience Cytoscape canvas.
//
// Refinement: tasks/refinements/audience/aud_render_annotation_endpoint_edges.md
//   (Decisions §1, §3, §4 — hybrid promotion: an annotation becomes a
//   Cytoscape graph-node iff it participates as an edge endpoint;
//   otherwise it stays a DOM-overlay badge. Mutual exclusion is enforced
//   at the projector seam. The synthetic AnnotationHostEdge dashed tether
//   restores the spatial association the DOM badge currently provides.)
//
// The three exports below are workspace-local for now; if a third caller
// of the *promotion-set / host-edge* shape materializes (the moderator
// and audience already share the pattern in spirit, but the moderator's
// implementation lives in ReactFlow-typed code in
// `apps/moderator/src/graph/selectors.ts`), an `extract_*` task can lift
// them into `@a-conversa/shell` later. Until then this file is the
// audience's canonical source for the Cytoscape-typed projection.
//
// The five projection-trio symbols (`Annotation`, `EMPTY_ANNOTATIONS`,
// `projectAnnotations`, `groupAnnotationsByNode`, `groupAnnotationsByEdge`)
// live canonically in `@a-conversa/shell` after the
// `extract_cytoscape_projectors` lift; re-exporting them here keeps the
// audience workspace's import surface narrow.
//
// ADRs:
//   - 0004 (Cytoscape.js for the audience broadcast surface);
//   - 0021 (event envelope discriminated union — the projection narrows
//     on the `edge-created` arm via the wire schema's XOR);
//   - 0022 (no throwaway verifications — every helper is pinned in
//     `annotations.test.ts`).

import type { Event } from '@a-conversa/shared-types';

import { EMPTY_FACET_STATUSES, type Annotation, EMPTY_ANNOTATIONS } from '@a-conversa/shell';

import { EMPTY_AXIOM_MARKS } from '@a-conversa/shell';

import type { AudienceEdgeElement, AudienceNodeElement } from './projectGraph.js';

/**
 * Walk the event log once and collect every annotation id referenced as
 * an edge endpoint (`source_annotation_id` or `target_annotation_id` on
 * any `edge-created` payload). The returned set is the *promotion set*
 * — annotations whose id is in the set are promoted from
 * `<AudienceAnnotationBadge>` (DOM overlay) to a Cytoscape graph-node
 * with the dashed-tether host pseudo-edge; the rest stay as DOM
 * overlays. Mutual exclusion per `aud_render_annotation_endpoint_edges`
 * Decisions §1 + §3.
 *
 * Pure function — no React, no store, no DOM. Returns an empty set when
 * no annotation-endpoint edges have landed (the steady-state pre-
 * `edge_target_annotation_schema_extension` shape).
 */
export function computeAnnotationsAsEndpoints(events: readonly Event[]): Set<string> {
  const promoted = new Set<string>();
  for (const event of events) {
    if (event.kind !== 'edge-created') continue;
    if (event.payload.source_annotation_id !== undefined) {
      promoted.add(event.payload.source_annotation_id);
    }
    if (event.payload.target_annotation_id !== undefined) {
      promoted.add(event.payload.target_annotation_id);
    }
  }
  return promoted;
}

/**
 * Build the `(knownNodeIds, edgeSources)` resolution context for host
 * lookup. Single pass over the events log; cheap to share across the
 * node + pseudo-edge projectors.
 *
 * `knownNodeIds` carries every `node-created.node_id` seen in the log.
 * `edgeSources` carries each `edge-created.edge_id` paired with its
 * resolved source endpoint (either `source_node_id` or
 * `source_annotation_id`, per the wire schema's XOR — the moderator's
 * `mod_render_annotation_endpoint_edges` Decision §4 v1 approximation
 * carries to the audience byte-for-byte).
 */
function buildAnnotationHostIndex(events: readonly Event[]): {
  knownNodeIds: Set<string>;
  edgeSources: Map<string, string>;
} {
  const knownNodeIds = new Set<string>();
  const edgeSources = new Map<string, string>();
  for (const event of events) {
    if (event.kind === 'node-created') {
      knownNodeIds.add(event.payload.node_id);
      continue;
    }
    if (event.kind === 'edge-created') {
      const sourceId = event.payload.source_node_id ?? event.payload.source_annotation_id;
      if (sourceId !== undefined) {
        edgeSources.set(event.payload.edge_id, sourceId);
      }
      continue;
    }
  }
  return { knownNodeIds, edgeSources };
}

/**
 * Resolve a promoted annotation's host id. Two cases per
 * `aud_render_annotation_endpoint_edges` Decision §4:
 *
 *   1. `targetNodeId` set and the host node has been seen → host is
 *      that node id.
 *   2. `targetEdgeId` set → host is the host edge's source endpoint
 *      (v1 approximation matching moderator §4).
 *
 * Returns `null` when neither case resolves (defensive — the caller
 * surfaces this as `data.hostMissing` on the annotation node and omits
 * the host pseudo-edge).
 */
function resolveAnnotationHostId(
  annotation: Annotation,
  knownNodeIds: ReadonlySet<string>,
  edgeSources: ReadonlyMap<string, string>,
): string | null {
  if (annotation.targetNodeId !== null && knownNodeIds.has(annotation.targetNodeId)) {
    return annotation.targetNodeId;
  }
  if (annotation.targetEdgeId !== null) {
    const hostSource = edgeSources.get(annotation.targetEdgeId);
    if (hostSource !== undefined) return hostSource;
  }
  return null;
}

/**
 * Project the promoted-annotation subset onto Cytoscape node element
 * descriptors. One node per promoted annotation, carrying:
 *
 *   - `data.id = annotation.id` (Decision §10 — annotation id used
 *     directly, no prefix);
 *   - `data.wording = annotation.content` (Decision §6 — reuse the
 *     existing `label: 'data(wording)'` selector);
 *   - `data.nodeKind = 'annotation'`, `data.annotationKind =
 *     annotation.kind` (Decision §3);
 *   - sentinel defaults for statement-only fields (`kind: null`,
 *     `facetStatuses: EMPTY_FACET_STATUSES`, `rollupStatus: 'none'`,
 *     `axiomMarks: EMPTY_AXIOM_MARKS`, `annotations: EMPTY_ANNOTATIONS`);
 *   - `data.hostMissing = true` when the annotation's host can't be
 *     resolved (Decision §4 defensive case — the orphaned annotation
 *     still renders so the broadcast viewer can see the entity).
 *
 * Pure function — no React, no store, no DOM.
 */
export function projectAnnotationNodes(
  annotations: readonly Annotation[],
  promotedSet: ReadonlySet<string>,
  events: readonly Event[],
): AudienceNodeElement[] {
  if (promotedSet.size === 0) return [];
  const { knownNodeIds, edgeSources } = buildAnnotationHostIndex(events);
  const out: AudienceNodeElement[] = [];
  for (const annotation of annotations) {
    if (!promotedSet.has(annotation.id)) continue;
    const hostId = resolveAnnotationHostId(annotation, knownNodeIds, edgeSources);
    const baseData = {
      id: annotation.id,
      wording: annotation.content,
      nodeKind: 'annotation',
      annotationKind: annotation.kind,
      kind: null,
      facetStatuses: EMPTY_FACET_STATUSES,
      rollupStatus: 'none',
      axiomMarks: EMPTY_AXIOM_MARKS,
      annotations: EMPTY_ANNOTATIONS,
    } as const;
    const element: AudienceNodeElement =
      hostId === null
        ? { group: 'nodes', data: { ...baseData, hostMissing: true } }
        : { group: 'nodes', data: baseData };
    out.push(element);
  }
  return out;
}

/**
 * Project one synthetic dashed host-pseudo-edge per promoted
 * annotation, tethering the annotation graph-node to its resolved host
 * (the node it targets, or the source endpoint of the edge it targets
 * — Decision §4).
 *
 * The pseudo-edge is a UI artifact, not a methodology entity: dashed
 * slate-300, no arrow, no label (Decision §7). It restores the spatial
 * association the badge currently provides so breadthfirst places the
 * annotation node adjacent to its host.
 *
 * Promoted annotations whose host cannot be resolved produce no
 * pseudo-edge (paired with `data.hostMissing` on the annotation node
 * itself — Decision §4 defensive case).
 *
 * Pure function — no React, no store, no DOM.
 */
export function projectAnnotationHostEdges(
  annotations: readonly Annotation[],
  promotedSet: ReadonlySet<string>,
  events: readonly Event[],
): AudienceEdgeElement[] {
  if (promotedSet.size === 0) return [];
  const { knownNodeIds, edgeSources } = buildAnnotationHostIndex(events);
  const out: AudienceEdgeElement[] = [];
  for (const annotation of annotations) {
    if (!promotedSet.has(annotation.id)) continue;
    const hostId = resolveAnnotationHostId(annotation, knownNodeIds, edgeSources);
    if (hostId === null) continue;
    out.push({
      group: 'edges',
      data: {
        id: `annotation-host-${annotation.id}`,
        source: hostId,
        target: annotation.id,
        role: 'supports',
        entityRole: 'annotation-host',
        facetStatuses: EMPTY_FACET_STATUSES,
        rollupStatus: 'none',
        annotations: EMPTY_ANNOTATIONS,
      },
    });
  }
  return out;
}
