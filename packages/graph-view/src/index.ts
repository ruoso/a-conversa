// `@a-conversa/graph-view` — the shared read-only Cytoscape.js graph
// renderer, lifted from `apps/audience/src/graph/` per ADR 0039.
//
// The public surface is the store-agnostic `GraphView` component (data
// in via the `events` + `instanceKey` + `activeDiagnostics` props),
// plus the pure projector and the layout / stylesheet constants that a
// consuming surface may need to tune framing. The eight DOM overlays,
// the overlay hooks, and `cytoscapeTestEnv` are internal: they are
// composed by `GraphView` and exercised by the co-located Vitest
// suites, not part of the consumer-facing contract.

export { GraphView, type GraphViewProps } from './GraphView.js';

export {
  projectGraph,
  type AudienceNodeData,
  type AudienceEdgeData,
  type AudienceNodeElement,
  type AudienceEdgeElement,
} from './projectGraph.js';

export {
  buildAudienceLayoutOptions,
  selectDeterministicRoots,
  SPACING_FACTOR,
  PADDING,
  BROADCAST_DIMENSIONS,
  DEFAULT_BROADCAST_DIMENSIONS,
  type BroadcastDimensions,
} from './layoutOptions.js';

export {
  STYLESHEET,
  STATE_COLORS,
  BROADCAST_NODE_FONT_SIZE_PX,
  BROADCAST_EDGE_FONT_SIZE_PX,
  BROADCAST_NODE_FONT_WEIGHT,
  BROADCAST_EDGE_FONT_WEIGHT,
  BROADCAST_ANNOTATION_FONT_SIZE_PX,
} from './stylesheet.js';
