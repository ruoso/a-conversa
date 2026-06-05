// Truth-table Vitest for the pure projection-diff helper.
//
// Refinement: tasks/refinements/replay_test/test_mode_changed_highlights.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications — this pins
//   the diff bucketing independently of React, Acceptance §1); 0039 (the
//   `Audience*Element` shapes diffed here).
//
// Exercises each bucket of `diffProjection(before, after)`: an added node, a
// removed node, a `data`-changed node, an added edge, a changed edge, the
// all-empty (no-change) case, and the empty-before / full-after case
// (everything added). Asserts each element lands in exactly one bucket and
// that unchanged elements land in none.

import { describe, expect, it } from 'vitest';

import type {
  AudienceEdgeData,
  AudienceEdgeElement,
  AudienceNodeData,
  AudienceNodeElement,
} from '@a-conversa/graph-view';

import { diffProjection, isEmptyDiff, type ProjectionDiff } from './diffProjection';

function node(id: string, overrides: Partial<AudienceNodeData> = {}): AudienceNodeElement {
  return {
    group: 'nodes',
    data: {
      id,
      wording: id,
      nodeKind: 'statement',
      annotationKind: null,
      kind: null,
      facetStatuses: {},
      rollupStatus: 'none',
      axiomMarks: [],
      annotations: [],
      ...overrides,
    },
  };
}

function edge(id: string, overrides: Partial<AudienceEdgeData> = {}): AudienceEdgeElement {
  return {
    group: 'edges',
    data: {
      id,
      source: 'n-1',
      target: 'n-2',
      role: 'supports',
      entityRole: 'statement',
      facetStatuses: {},
      rollupStatus: 'none',
      annotations: [],
      ...overrides,
    },
  };
}

/** Total element count across every bucket — used to prove "exactly one". */
function bucketTotal(diff: ProjectionDiff): number {
  return (
    diff.nodesAdded.length +
    diff.nodesRemoved.length +
    diff.nodesChanged.length +
    diff.edgesAdded.length +
    diff.edgesRemoved.length +
    diff.edgesChanged.length
  );
}

describe('diffProjection — nodes', () => {
  it('buckets a node present only in after as added', () => {
    const before = { nodes: [node('n-1')], edges: [] };
    const after = { nodes: [node('n-1'), node('n-2')], edges: [] };

    const diff = diffProjection(before, after);

    expect(diff.nodesAdded.map((element) => element.data.id)).toEqual(['n-2']);
    expect(diff.nodesRemoved).toEqual([]);
    expect(diff.nodesChanged).toEqual([]);
    expect(bucketTotal(diff)).toBe(1);
  });

  it('buckets a node present only in before as removed', () => {
    const before = { nodes: [node('n-1'), node('n-2')], edges: [] };
    const after = { nodes: [node('n-1')], edges: [] };

    const diff = diffProjection(before, after);

    expect(diff.nodesRemoved.map((element) => element.data.id)).toEqual(['n-2']);
    expect(diff.nodesAdded).toEqual([]);
    expect(diff.nodesChanged).toEqual([]);
    expect(bucketTotal(diff)).toBe(1);
  });

  it('buckets a node whose data changed (kind null → fact) with the field named', () => {
    const before = { nodes: [node('n-1', { kind: null })], edges: [] };
    const after = { nodes: [node('n-1', { kind: 'fact' })], edges: [] };

    const diff = diffProjection(before, after);

    expect(diff.nodesChanged).toHaveLength(1);
    const change = diff.nodesChanged[0];
    expect(change?.id).toBe('n-1');
    expect(change?.changedFields).toContain('kind');
    expect(change?.before.data.kind).toBeNull();
    expect(change?.after.data.kind).toBe('fact');
    expect(diff.nodesAdded).toEqual([]);
    expect(diff.nodesRemoved).toEqual([]);
    expect(bucketTotal(diff)).toBe(1);
  });
});

describe('diffProjection — edges', () => {
  it('buckets an edge present only in after as added', () => {
    const before = { nodes: [], edges: [] };
    const after = { nodes: [], edges: [edge('e-1')] };

    const diff = diffProjection(before, after);

    expect(diff.edgesAdded.map((element) => element.data.id)).toEqual(['e-1']);
    expect(bucketTotal(diff)).toBe(1);
  });

  it('buckets an edge whose data changed (rollupStatus flip) with the field named', () => {
    const before = { nodes: [], edges: [edge('e-1', { rollupStatus: 'none' })] };
    const after = { nodes: [], edges: [edge('e-1', { rollupStatus: 'disputed' })] };

    const diff = diffProjection(before, after);

    expect(diff.edgesChanged).toHaveLength(1);
    expect(diff.edgesChanged[0]?.id).toBe('e-1');
    expect(diff.edgesChanged[0]?.changedFields).toContain('rollupStatus');
    expect(diff.edgesAdded).toEqual([]);
    expect(diff.edgesRemoved).toEqual([]);
    expect(bucketTotal(diff)).toBe(1);
  });
});

describe('diffProjection — degenerate cases', () => {
  it('reports no change when before and after are structurally equal', () => {
    const before = { nodes: [node('n-1', { kind: 'fact' })], edges: [edge('e-1')] };
    // Distinct object identities, same structure — a deep compare must not
    // false-positive (Decision §3 — frozen-default empties compare by value).
    const after = { nodes: [node('n-1', { kind: 'fact' })], edges: [edge('e-1')] };

    const diff = diffProjection(before, after);

    expect(isEmptyDiff(diff)).toBe(true);
    expect(bucketTotal(diff)).toBe(0);
  });

  it('reports everything as added for an empty-before / full-after diff', () => {
    const before = { nodes: [], edges: [] };
    const after = { nodes: [node('n-1'), node('n-2')], edges: [edge('e-1')] };

    const diff = diffProjection(before, after);

    expect(diff.nodesAdded.map((element) => element.data.id)).toEqual(['n-1', 'n-2']);
    expect(diff.edgesAdded.map((element) => element.data.id)).toEqual(['e-1']);
    expect(diff.nodesRemoved).toEqual([]);
    expect(diff.nodesChanged).toEqual([]);
    expect(diff.edgesChanged).toEqual([]);
    expect(isEmptyDiff(diff)).toBe(false);
    expect(bucketTotal(diff)).toBe(3);
  });
});
