// `candidateBreakEdges` — derive the breakable `supports` edges of a
// cycle from the already-projected edge list.
//
// Refinement: tasks/refinements/moderator-ui/mod_break_edge_resolution_action.md
//             (Constraint §2 — candidates are derived, never guessed;
//              Decision §D3 — pure helper, the router cannot see the graph)
//
// A `cycle` diagnostic's payload carries only its node ids
// (`WireCycleDiagnostic { kind: 'cycle'; nodes }`); `affectedEntities`
// returns `edges: []` for it. The breakable edge set is therefore not
// readable from the payload — it must be derived from the live projection.
//
// This module filters the ReactFlow edge list (`selectEdgesForSession`,
// which already excludes hidden / not-yet-committed edges) for the
// `supports`-role edges whose BOTH endpoints sit inside the cycle's node
// set. Those are exactly the edges whose removal can sever the cycle
// (per docs/methodology.md L217-237). Order is preserved from the input
// edge list (event-log order), so the chooser rows and the tests are
// deterministic (Acceptance §2).
//
// Pure: no React, no store reads. The caller passes the projected edges
// and the cycle's node ids; the result is the candidate edge ids.

import type { Edge } from 'reactflow';

import type { StatementEdgeData } from './selectors.js';

/**
 * The breakable `supports` edge ids for a cycle over `cycleNodeIds`.
 *
 * An edge qualifies when its `data.role` is `'supports'` AND both its
 * `source` and `target` node ids are members of the cycle node set.
 * Non-`supports` roles, edges with an endpoint outside the set, and
 * (by construction of the input) hidden / absent edges are excluded.
 *
 * The returned ids preserve the input edge order — `selectEdgesForSession`
 * emits in event-log order, so the candidate list is stable for a given
 * session and does not flake the chooser rows.
 */
export function candidateBreakEdges(
  edges: readonly Edge<StatementEdgeData>[],
  cycleNodeIds: readonly string[],
): readonly string[] {
  const cycleNodes = new Set(cycleNodeIds);
  const out: string[] = [];
  for (const edge of edges) {
    if (edge.data?.role !== 'supports') continue;
    if (!cycleNodes.has(edge.source)) continue;
    if (!cycleNodes.has(edge.target)) continue;
    out.push(edge.id);
  }
  return out;
}
