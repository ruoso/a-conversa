// `@a-conversa/graph-view` — the shared read-only Cytoscape.js graph
// renderer, lifted from `apps/audience/src/graph/` per ADR 0039.
//
// The public surface is the store-agnostic `GraphView` component (data
// in via the `events` + `instanceKey` + `activeDiagnostics` props),
// plus the pure projector and the layout / stylesheet constants that a
// consuming surface may need to tune framing. The eight DOM overlays and
// `cytoscapeTestEnv` are internal: they are composed by `GraphView` and
// exercised by the co-located Vitest suites, not part of the consumer-
// facing contract. The one exception is `useSeenKeysGate` — a generic,
// Cytoscape-free "fire once per new key" gate also consumed by the
// audience `<ChapterMarker>` segment-break cue (see the export below).

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

// `useSeenKeysGate` — the family's single source of truth for "fire once
// per newly-arrived key" (lazy-seed-on-first-non-empty, then `true` once
// per genuinely-new key). Used internally by the Cytoscape DOM overlays
// and, per `aud_segment_break_animation.md` Decision §2, reused verbatim
// by the audience surface's `<ChapterMarker>` to gate its one-shot
// segment-break cue against the latest `snapshotId`. The hook is generic
// over `K` and imports nothing from Cytoscape — the `cytoscapeOverlayHooks`
// module name is historical, not a coupling (Decision §2).
export { useSeenKeysGate } from './cytoscapeOverlayHooks.js';
