// Moderator graph layout engine — Sugiyama-style hierarchical layout via
// `@dagrejs/dagre`.
//
// Refinement: tasks/refinements/moderator-ui/mod_layout_engine_choice.md
// ADRs:        docs/adr/0025-graph-layout-engine-dagre.md,
//              docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md,
//              docs/adr/0022-no-throwaway-verifications.md
//
// **What this module does.** Given a ReactFlow `Node[]` projection from
// `projectNodes(events, highlights)` plus the matching `Edge[]` from
// `selectEdgesForSession(...)`, compute each node's `(x, y)` position
// such that the rendered canvas reads top-to-bottom in the methodology's
// "claim-on-top, evidence-below" direction.
//
// **Why `@dagrejs/dagre`.** Pinned by ADR 0025 (Accepted 2026-05-15).
// The library is the actively-maintained MIT fork of the abandoned
// upstream `dagre` package; it ships a Sugiyama-style layered layout
// algorithm with deterministic output given a fixed input + ordering,
// tolerates cycles by reversing offending edges for the layering pass
// only, and is the canonical companion the official ReactFlow examples
// pair with the library. Alternatives (`elkjs`, `d3-force`, manual
// placement) and the reasons they were rejected are documented in
// ADR 0025's Context block.
//
// **Stability strategy.** `applyLayout(nodes, edges, options)` consults
// the caller-supplied `options.cache` (a `Map<id, {x, y}>`) — any node
// whose id is already in the cache reuses the cached position, NEVER
// moving on incremental events. Only nodes whose id is NOT yet in the
// cache feed dagre alongside every edge connecting them to either
// another new node or a cached node. `relayoutAll(...)` is the
// user-triggered "tidy up" escape valve: it ignores the cache entirely
// and re-runs dagre over every node, producing a fresh arrangement.
// The cache itself lives in `<GraphCanvasPane>`'s `useRef`; this module
// is pure and stateless.
//
// **Dimensions fed to dagre.** Constant `width: 288`, `height: 90` per
// node. The `<StatementNode>` card is styled with Tailwind's
// `min-w-[12rem] max-w-[18rem]` (192–288 px including padding); cards
// with typical-length wordings hit the max-width side of that band
// (the 288 px upper bound) once the paragraph wraps. The Refinement
// initially pinned 220 as an "empirical mid-point" but the e2e non-
// overlap assertion (a load-bearing test) requires the dagre footprint
// to bound the actual rendered card — anything narrower than 288 lets
// neighbouring cards overlap horizontally for max-width-hitting
// wordings (observed: a 220 px dagre node placed cards at x={0, 260}
// while the rendered cards were 288 px wide, producing a 28 px
// overlap). The 288 px figure matches `max-w-[18rem]` exactly and
// keeps the non-overlap contract honest at the cost of a slightly
// looser horizontal arrangement for short wordings (a per-card
// measurement pass is deferred to `mod_layout_measured_dimensions`).
//
// The height is the typical two-line wording + kind label + one
// decoration row. Variable-height cards (multi-row decorations) will
// visually overflow the 90 px slot in the worst case; the DOM-measured
// improvement is deferred to the future `mod_layout_measured_dimensions`
// task (ADR 0025 Consequences).
//
// **Cycle handling.** Dagre breaks cycles by reversing the offending
// edge for the layering pass and drawing it in its original direction.
// Visually this surfaces as a layered graph with one or more "back
// edges" travelling upward; the methodology's diagnostic-highlighting
// layer already surfaces cycles with an amber halo so the moderator
// has the explicit signal regardless of layout direction.
//
// **No React, no store, no DOM.** This module is a pure function over
// its inputs; it does not import from React, Zustand, or the DOM. The
// caller decides when to invoke it. Mirrors the pattern of
// `facetStatus.ts` / `diagnosticHighlights.ts` (pure projections
// consumed from `<GraphCanvasPane>`'s `useMemo` blocks).

import dagre from '@dagrejs/dagre';
import type { Edge, Node, XYPosition } from 'reactflow';

/**
 * Direction the layered layout flows. `'TB'` (top-to-bottom) is the
 * default and matches the methodology's "claim on top, evidence below"
 * reading order. `'LR'` / `'RL'` / `'BT'` are accepted but not used by
 * the moderator surface today; a future per-debate orientation switch
 * could surface them via UI.
 */
export type RankDir = 'TB' | 'BT' | 'LR' | 'RL';

/**
 * Per-call layout options. All fields are optional; the function-level
 * defaults are `DEFAULT_LAYOUT_OPTIONS` below.
 *
 * `cache` is the position cache: `id → {x, y}` for previously laid-out
 * nodes. `applyLayout` reuses cached positions verbatim; `relayoutAll`
 * ignores the cache (callers typically pass an empty Map or omit the
 * field). The Map is read-only from this module's point of view — the
 * caller (`<GraphCanvasPane>`) writes the post-layout positions back
 * after each invocation.
 */
export interface LayoutOptions {
  readonly rankdir?: RankDir;
  readonly nodeWidth?: number;
  readonly nodeHeight?: number;
  readonly rankSep?: number;
  readonly nodeSep?: number;
  readonly cache?: ReadonlyMap<string, XYPosition>;
}

/**
 * Canonical default values for `LayoutOptions`. Exported so the test
 * suite asserts against the same source of truth the production code
 * reads.
 *
 * - `rankdir`: `'TB'` (top-to-bottom — methodology's primary reading).
 * - `nodeWidth`: `288` px — matches `<StatementNode>`'s
 *   `max-w-[18rem]` upper bound. See the module header for why this
 *   departs from the refinement's initial `220` figure.
 * - `nodeHeight`: `90` px (typical card height — see header).
 * - `rankSep`: `60` px vertical gap between layered ranks.
 * - `nodeSep`: `40` px horizontal gap between siblings inside a rank.
 */
export const DEFAULT_LAYOUT_OPTIONS: Required<Omit<LayoutOptions, 'cache'>> = {
  rankdir: 'TB',
  nodeWidth: 288,
  nodeHeight: 90,
  rankSep: 60,
  nodeSep: 40,
};

interface ResolvedOptions {
  readonly rankdir: RankDir;
  readonly nodeWidth: number;
  readonly nodeHeight: number;
  readonly rankSep: number;
  readonly nodeSep: number;
}

function resolveOptions(options: LayoutOptions | undefined): ResolvedOptions {
  return {
    rankdir: options?.rankdir ?? DEFAULT_LAYOUT_OPTIONS.rankdir,
    nodeWidth: options?.nodeWidth ?? DEFAULT_LAYOUT_OPTIONS.nodeWidth,
    nodeHeight: options?.nodeHeight ?? DEFAULT_LAYOUT_OPTIONS.nodeHeight,
    rankSep: options?.rankSep ?? DEFAULT_LAYOUT_OPTIONS.rankSep,
    nodeSep: options?.nodeSep ?? DEFAULT_LAYOUT_OPTIONS.nodeSep,
  };
}

/**
 * Run a fresh dagre layout pass over the given nodes + edges and
 * return a `Map<id, XYPosition>` of computed positions. The map is
 * keyed by ReactFlow node id; dagre's internal `(x, y)` is the
 * geometric center of the node's bounding box, which we translate to
 * ReactFlow's top-left coordinate by subtracting half the node's
 * dimensions. The translation matches ReactFlow's `position` semantics
 * (`Node.position` is the upper-left corner of the rendered card).
 *
 * Internal helper — `applyLayout` and `relayoutAll` both call this
 * after deciding which nodes participate in the dagre pass.
 */
function runDagre<T>(
  nodes: readonly Node<T>[],
  edges: readonly Edge[],
  opts: ResolvedOptions,
): Map<string, XYPosition> {
  const graph = new dagre.graphlib.Graph({ multigraph: false, compound: false });
  graph.setGraph({
    rankdir: opts.rankdir,
    nodesep: opts.nodeSep,
    ranksep: opts.rankSep,
    marginx: 0,
    marginy: 0,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const participatingIds = new Set<string>();
  for (const node of nodes) {
    graph.setNode(node.id, { width: opts.nodeWidth, height: opts.nodeHeight });
    participatingIds.add(node.id);
  }
  for (const edge of edges) {
    // Only feed dagre edges whose both endpoints participate in this
    // pass — dagre throws if an edge references an unknown node id.
    if (!participatingIds.has(edge.source) || !participatingIds.has(edge.target)) {
      continue;
    }
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  const positions = new Map<string, XYPosition>();
  for (const node of nodes) {
    const placed = graph.node(node.id) as { x?: number; y?: number } | undefined;
    if (placed === undefined || placed.x === undefined || placed.y === undefined) {
      // Dagre is expected to place every node we registered; this
      // branch is a defensive fallback in case the library returns an
      // unplaced node (e.g. for a degenerate input). `(0, 0)` keeps
      // the function total.
      positions.set(node.id, { x: 0, y: 0 });
      continue;
    }
    // Dagre's `(x, y)` is the node's geometric center; ReactFlow's
    // `Node.position` is the top-left corner.
    positions.set(node.id, {
      x: placed.x - opts.nodeWidth / 2,
      y: placed.y - opts.nodeHeight / 2,
    });
  }
  return positions;
}

/**
 * Incremental layout pass: nodes whose id is in `options.cache` keep
 * their cached `{x, y}` unchanged; nodes NOT in the cache feed dagre
 * (alongside every cached node, so the new node's placement respects
 * the existing arrangement) and receive a dagre-computed position.
 *
 * The returned `Node[]` has the same length and id-order as the input;
 * each output node's `position` is the cached-or-dagre-derived value.
 * Every other field of each node (id, type, data, etc.) passes through
 * by referential identity — React / ReactFlow's prop-diff memoization
 * downstream still sees stable references for the non-position fields.
 *
 * If every node is already in the cache, the function returns the
 * nodes with their cached positions and does NOT invoke dagre. If no
 * node is in the cache, the function behaves identically to
 * `relayoutAll(...)` for the same inputs.
 */
export function applyLayout<T>(
  nodes: readonly Node<T>[],
  edges: readonly Edge[],
  options?: LayoutOptions,
): Node<T>[] {
  if (nodes.length === 0) {
    return [];
  }
  const opts = resolveOptions(options);
  const cache = options?.cache;

  // Partition node ids into cached vs. uncached. Cached nodes contribute
  // their cached position; uncached nodes feed dagre.
  const cachedIds = new Set<string>();
  const uncachedNodes: Node<T>[] = [];
  if (cache !== undefined) {
    for (const node of nodes) {
      if (cache.has(node.id)) {
        cachedIds.add(node.id);
      } else {
        uncachedNodes.push(node);
      }
    }
  } else {
    uncachedNodes.push(...nodes);
  }

  // Fast path: every node is cached. No dagre invocation needed.
  if (uncachedNodes.length === 0 && cache !== undefined) {
    return nodes.map((node) => {
      const cachedPos = cache.get(node.id);
      if (cachedPos === undefined) {
        // Unreachable given the partition above, but keep the type
        // narrowing honest.
        return node;
      }
      return { ...node, position: cachedPos };
    });
  }

  // Build the dagre input: every node we want a fresh placement for,
  // plus every cached node (so dagre can place the uncached ones
  // relative to the existing arrangement). After dagre returns,
  // we ONLY use the dagre positions for the uncached ids — cached
  // positions stay unchanged.
  const dagreInputNodes: Node<T>[] = [...uncachedNodes];
  if (cache !== undefined) {
    for (const node of nodes) {
      if (cachedIds.has(node.id)) {
        dagreInputNodes.push(node);
      }
    }
  }
  const dagrePositions = runDagre(dagreInputNodes, edges, opts);

  return nodes.map((node) => {
    if (cache !== undefined && cachedIds.has(node.id)) {
      const cachedPos = cache.get(node.id);
      if (cachedPos !== undefined) {
        return { ...node, position: cachedPos };
      }
    }
    const fresh = dagrePositions.get(node.id);
    if (fresh === undefined) {
      // Defensive fallback — see `runDagre`'s comment.
      return { ...node, position: { x: 0, y: 0 } };
    }
    return { ...node, position: fresh };
  });
}

/**
 * Full re-layout pass: ignores any cache and feeds every node + every
 * edge to dagre. The user-triggered "tidy up" semantics — every node
 * gets a fresh dagre-computed position, intentionally moving existing
 * arrangements. Exported for the future `mod_layout_tidy_action` task
 * to bind to a UI affordance; this task ships the function and tests
 * it but does not wire any button.
 */
export function relayoutAll<T>(
  nodes: readonly Node<T>[],
  edges: readonly Edge[],
  options?: LayoutOptions,
): Node<T>[] {
  if (nodes.length === 0) {
    return [];
  }
  const opts = resolveOptions(options);
  const positions = runDagre(nodes, edges, opts);
  return nodes.map((node) => {
    const fresh = positions.get(node.id);
    if (fresh === undefined) {
      return { ...node, position: { x: 0, y: 0 } };
    }
    return { ...node, position: fresh };
  });
}
