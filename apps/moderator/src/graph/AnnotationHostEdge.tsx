// `<AnnotationHostEdge>` — synthetic ReactFlow edge that tethers a
// promoted `AnnotationNode` to its host (either a `StatementNode` or
// the source-node of the annotation's `target_edge_id` host edge).
//
// Refinement: tasks/refinements/moderator-ui/mod_render_annotation_endpoint_edges.md
// ADRs:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//
// The host pseudo-edge is a UI artifact, not a methodology entity. It
// preserves the spatial association the badge currently provides when
// the annotation is promoted to a node — without it, dagre would place
// the annotation node based only on its annotation-endpoint edges,
// possibly far from the host the annotation is *about*.
//
// Visual: dashed (`strokeDasharray="4 3"`), low-contrast slate stroke
// (`#cbd5e1` ≈ Tailwind `slate-300`), no marker, no label. CSS-level
// `pointer-events: none` keeps click/hover gestures passing through to
// whatever is behind the pseudo-edge per Decision §7.

import { memo, type ReactElement } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from 'reactflow';

export interface AnnotationHostEdgeData {
  /**
   * The promoted annotation id this pseudo-edge tethers to. Used by
   * the `data-testid` seam on the wrapping `<g>` so tests can target a
   * specific host pseudo-edge by annotation id.
   */
  readonly annotationId: string;
}

/**
 * The ReactFlow `type` key under which `AnnotationHostEdge` is
 * registered alongside the existing `statement` entry in `edgeTypes`.
 */
export const ANNOTATION_HOST_EDGE_TYPE = 'annotation-host';

function AnnotationHostEdgeImpl(props: EdgeProps<AnnotationHostEdgeData>): ReactElement {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  // Surface the annotation id on the `data-testid` so tests can target
  // each host pseudo-edge by the annotation it tethers to.
  const annotationId = data?.annotationId ?? id;
  return (
    <g data-testid={`annotation-host-edge-${annotationId}`} style={{ pointerEvents: 'none' }}>
      <BaseEdge id={id} path={edgePath} style={{ stroke: '#cbd5e1', strokeDasharray: '4 3' }} />
    </g>
  );
}

/**
 * Memo'd custom ReactFlow edge component. Mirrors `<StatementEdge>`'s
 * memoization decision — the surrounding canvas re-renders on every
 * viewport pan/zoom; the pseudo-edge only re-renders when endpoint
 * coordinates change.
 */
export const AnnotationHostEdge = memo(AnnotationHostEdgeImpl);
