// Detect cycles in the `supports` edges of the visible, active graph.
//
// Refinement: tasks/refinements/data-and-methodology/cycle_detection.md
// TaskJuggler: data_and_methodology.diagnostics.cycle_detection
//
// Pure read function over the projection. Per `docs/data-model.md`
// line 170 ("Cycles in support"): "Any cycle in `supports` edges
// indicates circular reasoning." The detection surfaces such cycles
// so the moderator can offer a resolution path (`break-edge`,
// `decompose`, `axiom-mark` per the data-model paragraph).
//
// Filtering, in evaluation order (per the refinement Decisions
// section):
//   1. `edge.visible === true` — broken edges (per committed
//      `break-edge`) and edges whose endpoints were superseded by
//      decompose / restructure don't participate.
//   2. `edge.role === 'supports'` — only supports cycles are the
//      diagnostic; other roles handle their own diagnostics.
//   3. `isEdgeActive(projection, edge.id) === true` — only actively-
//      firing edges count. The active-firing primitive handles the
//      conjunction `edge.substance ∧ source.substance` (both settled-
//      agreed).
//
// Algorithm: Tarjan's strongly-connected components over the pre-
// filtered adjacency map. Each non-trivial SCC (size >= 2) is one
// cycle entry; self-loops (size-1 SCC whose node has an edge to
// itself) are also cycle entries. Size-1 SCCs without self-loops
// are not cycles.
//
// The cycle is reported as a list of node ids in adjacency-walk
// order: every consecutive pair (including the wrap from the last
// node back to the first) is connected by an active visible
// `supports` edge.
//
// Boundary with downstream:
//   - `diagnostic_event_emission` (M2 sibling task) consumes this
//     function's output and wires it into the event-stream surface.
//   - `blocking_vs_advisory_classification` (M2 sibling task)
//     classifies cycle diagnostics alongside contradiction / multi-
//     warrant / dangling-claim / coherency-hint diagnostics.
//   - `break_edge_logic` (already landed) flips a broken edge's
//     `visible` flag to false; downstream calls to this detector
//     then see one fewer participant in the supports adjacency.

import type { Projection } from '../projection/projection.js';
import { isEdgeActive } from '../projection/active-firing.js';

/**
 * One cycle in the active visible supports graph, represented as
 * an ordered list of node ids. Every consecutive pair (including
 * the wrap from `nodes[length - 1]` back to `nodes[0]`) is
 * connected by an active visible `supports` edge in the projection.
 *
 * For self-loops (a node with an active visible supports edge to
 * itself) the list has a single entry.
 */
export interface SupportsCycle {
  nodes: string[];
}

/**
 * Detect cycles in the active visible supports subgraph.
 *
 * Pure read function. Returns the set of cycles as a list of
 * `SupportsCycle` entries; each entry is the cycle's node ids in
 * adjacency-walk order. The result is empty when no cycles exist.
 *
 * The algorithm is Tarjan's SCC over the pre-filtered supports
 * adjacency map. Each non-trivial SCC (size >= 2) is one cycle.
 * Self-loops are reported as size-1 cycles.
 */
export function detectSupportsCycles(projection: Projection): SupportsCycle[] {
  const adjacency = buildSupportsAdjacency(projection);
  const sccs = tarjanScc(adjacency);
  const cycles: SupportsCycle[] = [];
  for (const scc of sccs) {
    if (scc.length === 1) {
      // Size-1 SCC: only a cycle if the node has a self-edge.
      const node = scc[0] as string;
      const targets = adjacency.get(node);
      if (targets && targets.has(node)) {
        cycles.push({ nodes: [node] });
      }
      continue;
    }
    // Size >= 2: every node in the SCC is in a cycle. Re-walk the
    // SCC to produce an adjacency-ordered list.
    cycles.push({ nodes: walkSccInAdjacencyOrder(scc, adjacency) });
  }
  return cycles;
}

// ---------------------------------------------------------------
// Adjacency construction — filter to visible + supports + active.
// ---------------------------------------------------------------

function buildSupportsAdjacency(projection: Projection): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  // Seed with every visible node so size-1 SCCs (isolated nodes) are
  // discovered by Tarjan. (Tarjan's walk needs to start at every
  // node; isolated nodes never appear as edge endpoints in the
  // filtered adjacency.) We only include visible nodes — invisible
  // ones don't participate in current reasoning per the data-model
  // visibility rules.
  for (const node of projection.nodes()) {
    if (node.visible) {
      adjacency.set(node.id, new Set());
    }
  }
  for (const edge of projection.edges()) {
    if (!edge.visible) continue;
    if (edge.role !== 'supports') continue;
    // Per `diagnostics_annotation_endpoint_semantics_audit` D1: cycles
    // are over the node-supports subgraph (data-model.md L171-177);
    // annotation endpoints are entity-layer metadata, not part of the
    // supports subgraph.
    if (edge.sourceNodeId === null || edge.targetNodeId === null) continue;
    // `isEdgeActive` requires the source node to exist in the
    // projection; an edge whose source is absent would throw. The
    // visibility filter above doesn't guarantee both endpoints are
    // visible, but the active-firing primitive's source-node-
    // existence invariant is upheld by the dispatcher at write
    // time. If the source or target node is invisible, the edge
    // should be invisible too (the projection's incremental layer
    // cascades visibility); defensively skip if not.
    const source = projection.getNode(edge.sourceNodeId);
    const target = projection.getNode(edge.targetNodeId);
    if (!source || !target) continue;
    if (!source.visible || !target.visible) continue;
    if (!isEdgeActive(projection, edge.id)) continue;
    const bucket = adjacency.get(edge.sourceNodeId);
    if (!bucket) {
      // Source node is filtered out (e.g., not visible). Skip.
      continue;
    }
    bucket.add(edge.targetNodeId);
  }
  return adjacency;
}

// ---------------------------------------------------------------
// Tarjan's strongly-connected components.
// ---------------------------------------------------------------
//
// Iterative form (no explicit stack-overflow risk on deep graphs;
// the projection sizes we expect are small but using an explicit
// stack keeps the algorithm transparent). Returns SCCs in the order
// they're emitted (Tarjan's discovery order — deterministic for a
// given adjacency).

interface TarjanState {
  index: number;
  lowlink: number;
  onStack: boolean;
}

function tarjanScc(adjacency: Map<string, Set<string>>): string[][] {
  const state = new Map<string, TarjanState>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let index = 0;

  for (const node of adjacency.keys()) {
    if (state.has(node)) continue;
    strongConnect(node, adjacency, state, stack, sccs, () => index++);
  }
  return sccs;
}

function strongConnect(
  startNode: string,
  adjacency: Map<string, Set<string>>,
  state: Map<string, TarjanState>,
  stack: string[],
  sccs: string[][],
  nextIndex: () => number,
): void {
  // Iterative DFS frame: per node, an iterator over its successors
  // and a snapshot of its current lowlink.
  interface Frame {
    node: string;
    iterator: Iterator<string>;
  }
  const frames: Frame[] = [];

  function pushNode(node: string): void {
    const idx = nextIndex();
    state.set(node, { index: idx, lowlink: idx, onStack: true });
    stack.push(node);
    const successors = adjacency.get(node) ?? new Set<string>();
    frames.push({ node, iterator: successors.values() });
  }

  pushNode(startNode);

  while (frames.length > 0) {
    const frame = frames[frames.length - 1] as Frame;
    const step = frame.iterator.next();
    if (step.done) {
      // Finished exploring `frame.node`. If it's the root of an SCC
      // (lowlink === index), pop the stack down to it.
      const frameState = state.get(frame.node) as TarjanState;
      if (frameState.lowlink === frameState.index) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop() as string;
          const wState = state.get(w) as TarjanState;
          wState.onStack = false;
          scc.push(w);
        } while (w !== frame.node);
        sccs.push(scc);
      }
      frames.pop();
      // Propagate lowlink to parent frame.
      if (frames.length > 0) {
        const parent = frames[frames.length - 1] as Frame;
        const parentState = state.get(parent.node) as TarjanState;
        parentState.lowlink = Math.min(parentState.lowlink, frameState.lowlink);
      }
      continue;
    }
    const successor = step.value;
    const successorState = state.get(successor);
    if (!successorState) {
      // Unvisited — recurse.
      pushNode(successor);
    } else if (successorState.onStack) {
      // Back-edge / cross-edge to a node currently on the stack.
      const frameState = state.get(frame.node) as TarjanState;
      frameState.lowlink = Math.min(frameState.lowlink, successorState.index);
    }
    // else: successor already finished; ignore.
  }
}

// ---------------------------------------------------------------
// Walk an SCC to produce an adjacency-ordered node list.
// ---------------------------------------------------------------
//
// Tarjan emits each SCC's nodes in finish-order (the order the
// recursion unwinds, which is unrelated to the adjacency walk).
// For the moderator UI we want a list where consecutive nodes are
// connected by an edge. Re-walk the SCC starting at the first node
// Tarjan emitted, following an active visible supports edge within
// the SCC at each step, until the start repeats.
//
// For any non-trivial SCC (size >= 2) such a walk exists by the
// SCC's defining property (every node is reachable from every
// other). The walk picks deterministically (first matching target
// in the iteration order of the adjacency set) so the output is
// stable test-to-test.

function walkSccInAdjacencyOrder(
  scc: readonly string[],
  adjacency: Map<string, Set<string>>,
): string[] {
  const sccSet = new Set(scc);
  // Start at scc[0]; walk forward following intra-SCC edges; stop
  // when we'd revisit the start or when no further intra-SCC edge
  // exists (the latter shouldn't happen for a real SCC of size >= 2).
  const start = scc[0] as string;
  const visited = new Set<string>([start]);
  const ordered: string[] = [start];
  let current = start;
  // Guard with `scc.length` to bound the loop in case of bugs.
  for (let i = 0; i < scc.length; i++) {
    const targets = adjacency.get(current);
    if (!targets) break;
    let next: string | undefined;
    for (const candidate of targets) {
      if (sccSet.has(candidate) && !visited.has(candidate)) {
        next = candidate;
        break;
      }
    }
    if (next === undefined) {
      // No unvisited intra-SCC target — the walk has reached every
      // node in the SCC (or there's an oddity we can't represent).
      break;
    }
    ordered.push(next);
    visited.add(next);
    current = next;
    if (ordered.length === scc.length) break;
  }
  return ordered;
}
