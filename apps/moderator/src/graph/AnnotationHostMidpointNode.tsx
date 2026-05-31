// `<AnnotationHostMidpointNode>` — invisible synthetic ReactFlow node
// at the visual midpoint of a host edge, used as the tether endpoint for
// `<AnnotationHostEdge>` when the annotation's host is an edge (not a
// node).
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_node_edge_host_midpoint.md
// (prior:     tasks/refinements/moderator-ui/mod_render_annotation_endpoint_edges.md)
// ADRs:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md,
//              docs/adr/0025-graph-layout-engine-dagre.md
//
// Before this task, an annotation that targeted an edge tethered to that
// edge's source node (the v1 approximation per
// `mod_render_annotation_endpoint_edges` Decision §4). The correct
// rendering attaches the annotation to the host edge's *middle*; this
// node-type is the canonical ReactFlow idiom for "a connection point at
// a specific spot on the canvas" — Decision §1 of this refinement.
//
// Visual: 1×1, `pointer-events: none`, no border, no fill, no content
// (transparent). The dashed pseudo-edge appears to terminate cleanly at
// the host edge's midpoint because the midpoint node has effectively
// zero size at that coordinate (Decision §3).
//
// Why 1×1 and not 0×0: ReactFlow 11.x's `updateNodeDimensions` skips the
// dimension/handle-bounds update when the measured `offsetWidth` or
// `offsetHeight` is 0 (falsy guard in `@reactflow/core` `store/index.ts`
// → `updateNodeDimensions`). Without handle bounds, `getNodeData`
// reports the node as invalid and `EdgeRenderer` short-circuits every
// edge touching it. A truly 0×0 node would leave the edge-hosted host
// pseudo-edge unrendered. 1×1 is the smallest non-zero footprint that
// satisfies ReactFlow's render predicate; the resulting half-pixel
// centroid offset is well below visual perception and below the 1px
// measurement-debounce threshold the canvas already tolerates.
//
// Position is owned by the post-layout `placeAnnotationHostMidpoints`
// pass in `<GraphCanvasPane>`. The projector emits each midpoint at
// `(0, 0)` and the post-layout pass overwrites with the centroid of the
// host edge's two endpoint node centers (Decision §2 — midpoint nodes
// are NOT fed to dagre).

import { memo, type ReactElement } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

export interface AnnotationHostMidpointNodeData {
  /**
   * The host edge id this midpoint sits on. Used by the post-layout
   * `placeAnnotationHostMidpoints` pass to look up the edge's source +
   * target node ids (via the anchor index) and compute the centroid;
   * surfaced as `data-host-edge-id` on the DOM root for diagnosis
   * (Decision §8).
   */
  readonly hostEdgeId: string;
}

/**
 * ReactFlow `type` key under which `AnnotationHostMidpointNode` is
 * registered. Hoisted so the registration and every projected
 * `Node.type` stay in lockstep.
 */
export const ANNOTATION_HOST_MIDPOINT_NODE_TYPE = 'annotation-host-midpoint';

/**
 * Per-card dimensions. The midpoint node is a UI scaffold, not a
 * visible card — Decision §3 framed 0×0 as the limit case; the
 * implementation lifts to 1×1 because ReactFlow 11.x refuses to
 * commit handle bounds for a 0-dimension node (see the component
 * header for the full why). Exported so the dagre-skip seam in
 * `<GraphCanvasPane>` (Decision §2) and the centroid-placement helper
 * read against the same numbers.
 */
export const ANNOTATION_HOST_MIDPOINT_NODE_WIDTH = 1;
export const ANNOTATION_HOST_MIDPOINT_NODE_HEIGHT = 1;

function AnnotationHostMidpointNodeImpl(
  props: NodeProps<AnnotationHostMidpointNodeData>,
): ReactElement {
  const { data } = props;
  const { hostEdgeId } = data;
  return (
    <div
      data-testid={`annotation-host-midpoint-${hostEdgeId}`}
      data-host-edge-id={hostEdgeId}
      style={{
        width: ANNOTATION_HOST_MIDPOINT_NODE_WIDTH,
        height: ANNOTATION_HOST_MIDPOINT_NODE_HEIGHT,
        pointerEvents: 'none',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
    </div>
  );
}

/**
 * Memo'd custom ReactFlow node component. The canvas re-renders on
 * every viewport pan/zoom; the midpoint node only needs to re-render
 * when its `data.hostEdgeId` changes (effectively never — it's
 * lifetime-stable once emitted).
 */
export const AnnotationHostMidpointNode = memo(AnnotationHostMidpointNodeImpl);
