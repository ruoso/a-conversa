// Tests for `candidateBreakEdges` — the pure derivation of a cycle's
// breakable `supports` edges from the projected edge list.
//
// Refinement: tasks/refinements/moderator-ui/mod_break_edge_resolution_action.md
//             (Acceptance §1-§2, Constraint §2, Decision §D3)
//
// Per ADR 0022 these are committed Vitest cases. They pin:
//   - only `supports`-role edges with BOTH endpoints in the cycle node
//     set are returned (Acceptance §1);
//   - non-`supports` roles, edges with an endpoint outside the set, and
//     edges absent from the projected list are excluded (Acceptance §1);
//   - the result order tracks the input edge order — deterministic so the
//     chooser rows and tests don't flake (Acceptance §2).

import { describe, expect, it } from 'vitest';
import type { Edge } from 'reactflow';
import type { EdgeRole } from '@a-conversa/shared-types';

import { candidateBreakEdges } from './candidateBreakEdges.js';
import type { StatementEdgeData } from './selectors.js';

const NODE_A = 'node-a';
const NODE_B = 'node-b';
const NODE_C = 'node-c';
const NODE_OUT = 'node-outside';

/**
 * Build a minimal `Edge<StatementEdgeData>` for the helper. Only `id`,
 * `source`, `target`, and `data.role` drive the derivation; the remaining
 * `StatementEdgeData` fields are filled with inert defaults to satisfy the
 * type without affecting the assertion.
 */
function edge(id: string, source: string, target: string, role: EdgeRole): Edge<StatementEdgeData> {
  return {
    id,
    source,
    target,
    type: 'statement',
    data: {
      role,
      annotations: [],
      facetStatuses: {},
      sourceId: source,
      targetId: target,
      sourceKind: 'node',
      targetKind: 'node',
      sourceWording: source,
      targetWording: target,
    },
  };
}

describe('candidateBreakEdges', () => {
  it('returns only supports edges with both endpoints inside the cycle node set', () => {
    const edges = [
      edge('e-ab', NODE_A, NODE_B, 'supports'),
      edge('e-bc', NODE_B, NODE_C, 'supports'),
      edge('e-ca', NODE_C, NODE_A, 'supports'),
    ];
    expect(candidateBreakEdges(edges, [NODE_A, NODE_B, NODE_C])).toEqual(['e-ab', 'e-bc', 'e-ca']);
  });

  it('excludes non-supports roles', () => {
    const edges = [
      edge('e-ab', NODE_A, NODE_B, 'supports'),
      edge('e-bc-rebuts', NODE_B, NODE_C, 'rebuts'),
      edge('e-ca-qualifies', NODE_C, NODE_A, 'qualifies'),
    ];
    expect(candidateBreakEdges(edges, [NODE_A, NODE_B, NODE_C])).toEqual(['e-ab']);
  });

  it('excludes supports edges with an endpoint outside the cycle node set', () => {
    const edges = [
      edge('e-ab', NODE_A, NODE_B, 'supports'),
      edge('e-b-out', NODE_B, NODE_OUT, 'supports'),
      edge('e-out-a', NODE_OUT, NODE_A, 'supports'),
    ];
    expect(candidateBreakEdges(edges, [NODE_A, NODE_B])).toEqual(['e-ab']);
  });

  it('returns nothing for a cycle node set the projected edges miss (excludes absent edges)', () => {
    // A real cycle always has ≥2 supports edges; an empty projection (or a
    // node set the visible edges do not connect) yields zero candidates so
    // the panel can fall back to focus-only (Constraint §6).
    expect(candidateBreakEdges([], [NODE_A, NODE_B])).toEqual([]);
    const edges = [edge('e-ab', NODE_A, NODE_B, 'supports')];
    expect(candidateBreakEdges(edges, [NODE_C, NODE_OUT])).toEqual([]);
  });

  it('preserves the input edge order (deterministic, stable across calls)', () => {
    const edges = [
      edge('e-bc', NODE_B, NODE_C, 'supports'),
      edge('e-ab', NODE_A, NODE_B, 'supports'),
      edge('e-ca', NODE_C, NODE_A, 'supports'),
    ];
    const nodes = [NODE_A, NODE_B, NODE_C];
    const first = candidateBreakEdges(edges, nodes);
    expect(first).toEqual(['e-bc', 'e-ab', 'e-ca']);
    // Stable for the same input.
    expect(candidateBreakEdges(edges, nodes)).toEqual(first);
  });
});
