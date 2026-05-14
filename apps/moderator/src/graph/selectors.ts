// Store-derived selectors that translate the WS event log into the
// ReactFlow node / edge / annotation shapes the canvas consumes.
//
// Refinement: tasks/refinements/moderator-ui/mod_proposed_state_styling.md
// (prior:     tasks/refinements/moderator-ui/mod_annotation_rendering.md,
//             tasks/refinements/moderator-ui/mod_edge_rendering.md)
//
// `selectEdgesForSession` walks the per-session event log in `useWsStore`
// and projects every `edge-created` event into a ReactFlow `Edge<{ role,
// annotations }>`. `selectAnnotations` does the same for
// `annotation-created` events, returning a camelCased `Annotation[]` for
// downstream consumers (the node / edge projections enrich their per-
// target `data.annotations` from this list via `groupAnnotationsByNode`
// / `groupAnnotationsByEdge`).
//
// Every selector here is a pure function over `WsState`; none subscribes
// to the store itself (the consuming component decides how to subscribe).
// Pure means fully unit-testable without a React render.
//
// Sibling selector `selectNodesForSession` may land later; today the
// node projection lives in `GraphCanvasPane.tsx` as `projectNodes` so
// it can do the per-target annotation enrichment in a single pass.

import type { Edge } from 'reactflow';
import type { AnnotationKind, EdgeRole, Event } from '@a-conversa/shared-types';

import {
  computeFacetStatuses,
  EMPTY_FACET_STATUSES,
  type FacetName,
  type FacetStatus,
} from './facetStatus.js';
import type { WsState } from '../ws/wsStore.js';

/**
 * Camel-cased annotation projected off the wire `annotation-created`
 * payload. Consumers (the node / edge projections, the badge component)
 * see this shape, not the snake-cased payload — the selector is the
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

/** Payload carried on each rendered edge — the role drives the label and (later) the per-state styling. */
export interface StatementEdgeData {
  role: EdgeRole;
  /**
   * The annotations targeting this edge. Empty when no `annotation-
   * created` event references the edge. Read by `<StatementEdge>` to
   * render the badge row beneath the role label.
   */
  annotations: readonly Annotation[];
  /**
   * Per-facet `FacetStatus` for this edge. Read by `<StatementEdge>` to
   * apply the proposed / agreed / disputed state styling (refinement
   * `mod_proposed_state_styling` and siblings). Empty when no facet-
   * targeting proposal references the edge — the styling falls back to
   * the solid-stroke default. Edges carry only the `substance` facet
   * in v1; this record's shape allows the sibling per-facet-state
   * task to add more facets without changing the contract.
   */
  facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>;
}

/**
 * Module-scope shared empty annotation array. Hands a stable reference
 * to consumers when a target has no annotations, so React / ReactFlow
 * memoization (`Array.length === 0` is identity-stable here) doesn't
 * see a fresh array on every projection pass.
 */
export const EMPTY_ANNOTATIONS: readonly Annotation[] = Object.freeze([]);

/**
 * Project the per-session WS event log into the camelCased annotation
 * list. Walks `state.sessionState[sessionId]?.events` once and picks
 * every `annotation-created` envelope.
 *
 * Empty for an unknown `sessionId` or an empty event log.
 */
export function selectAnnotations(state: WsState, sessionId: string): Annotation[] {
  const session = state.sessionState[sessionId];
  if (!session) return [];
  return projectAnnotations(session.events);
}

/**
 * Pure projection from an `Event[]` slice to the `Annotation[]` shape.
 *
 * Exported separately so `projectNodes` in `GraphCanvasPane.tsx` can
 * re-use it without going through the store — the node projection is a
 * pure function of `events` (no `WsState` dependency), so the enrichment
 * pass walks the same events array directly.
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
 * with `targetNodeId === null`) are skipped.
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
 * Project the per-session WS event log into the ReactFlow edge list.
 *
 * Walks `state.sessionState[sessionId]?.events` once, picks every
 * `edge-created` envelope, and maps each to a ReactFlow `Edge` with
 * `type: 'statement'` (the single entry in `edgeTypes`), the role
 * stashed on `data` so `<StatementEdge>` can render the localized label,
 * and the matching annotations bucketed in via
 * `groupAnnotationsByEdge`. Downstream state-styling tasks can still
 * read `data.role` as the stable discriminator.
 *
 * Empty for an unknown `sessionId` or an empty event log — the consuming
 * component renders no edges in that case, which is the expected idle
 * state before the WS catch-up replay lands the first events.
 */
export function selectEdgesForSession(
  state: WsState,
  sessionId: string,
): Edge<StatementEdgeData>[] {
  const session = state.sessionState[sessionId];
  if (!session) return [];
  const annotationsByEdge = groupAnnotationsByEdge(projectAnnotations(session.events));
  // Per-edge per-facet `FacetStatus` index — computed once over the same
  // events array so the projection stays a single pass-effort over the
  // log. Refinement: `mod_proposed_state_styling`.
  const facetStatusIndex = computeFacetStatuses(session.events);
  const out: Edge<StatementEdgeData>[] = [];
  for (const event of session.events) {
    if (event.kind !== 'edge-created') continue;
    const annotations = annotationsByEdge.get(event.payload.edge_id) ?? EMPTY_ANNOTATIONS;
    const facetStatuses = facetStatusIndex.edges.get(event.payload.edge_id) ?? EMPTY_FACET_STATUSES;
    out.push({
      id: event.payload.edge_id,
      source: event.payload.source_node_id,
      target: event.payload.target_node_id,
      type: 'statement',
      data: { role: event.payload.role, annotations, facetStatuses },
    });
  }
  return out;
}
