// Tests for the in-memory graph projection storage layer.
//
// Refinement: tasks/refinements/data-and-methodology/projection_data_structure.md
// TaskJuggler: data_and_methodology.projection.projection_data_structure
//
// Coverage:
//   - Empty-projection invariants.
//   - Add / get / remove for nodes, edges, annotations (node target +
//     edge target).
//   - Duplicate-add throws (`ProjectionInvariantError`).
//   - Removing an unknown id is a silent no-op.
//   - Removing a node cascades to incident edges (both directions) and
//     to annotations targeting it.
//   - Removing an edge cascades to annotations targeting it.
//   - Index getters reflect mutations exactly.
//   - Visibility flag is independent of presence in the indices.
//   - `setXVisible` of an unknown id throws.
//   - Annotation polymorphic-target XOR is enforced at construction.
//   - Pending-proposal map.
//   - Property-style sweep with a deterministic seed.

import { describe, expect, it } from 'vitest';

import { Projection, ProjectionInvariantError, createEmptyProjection } from './projection.js';
import type { NewAnnotationInput, NewEdgeInput, NewNodeInput } from './types.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const NODE_ID_1 = '33333333-3333-4333-8333-333333333333';
const NODE_ID_2 = '44444444-4444-4444-8444-444444444444';
const NODE_ID_3 = '55555555-5555-4555-8555-555555555555';
const EDGE_ID_1 = '66666666-6666-4666-8666-666666666666';
const EDGE_ID_2 = '77777777-7777-4777-8777-777777777777';
const ANNOTATION_ID_1 = '88888888-8888-4888-8888-888888888888';
const PROPOSAL_ID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const NOW = '2026-05-10T12:00:00Z';

function nodeInput(id: string, wording = 'A statement.'): NewNodeInput {
  return { id, wording, createdBy: USER_ID, createdAt: NOW };
}

function edgeInput(id: string, source: string, target: string): NewEdgeInput {
  return {
    id,
    role: 'supports',
    sourceNodeId: source,
    targetNodeId: target,
    createdBy: USER_ID,
    createdAt: NOW,
  };
}

function annotationInputForNode(id: string, targetNodeId: string): NewAnnotationInput {
  return {
    id,
    kind: 'note',
    content: 'A note.',
    targetNodeId,
    targetEdgeId: null,
    createdBy: USER_ID,
    createdAt: NOW,
  };
}

function annotationInputForEdge(id: string, targetEdgeId: string): NewAnnotationInput {
  return {
    id,
    kind: 'note',
    content: 'A note.',
    targetNodeId: null,
    targetEdgeId,
    createdBy: USER_ID,
    createdAt: NOW,
  };
}

describe('createEmptyProjection', () => {
  it('produces a projection with the given session id and zero entities', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(projection.sessionId).toBe(SESSION_ID);
    expect(projection.nodeCount()).toBe(0);
    expect(projection.edgeCount()).toBe(0);
    expect(projection.annotationCount()).toBe(0);
    expect(projection.pendingProposalCount()).toBe(0);
  });

  it('returns undefined for any id and empty arrays for any index lookup', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(projection.getNode(NODE_ID_1)).toBeUndefined();
    expect(projection.getEdge(EDGE_ID_1)).toBeUndefined();
    expect(projection.getAnnotation(ANNOTATION_ID_1)).toBeUndefined();
    expect(projection.getEdgesBySource(NODE_ID_1)).toEqual([]);
    expect(projection.getEdgesByTarget(NODE_ID_1)).toEqual([]);
    expect(projection.getAnnotationsByNode(NODE_ID_1)).toEqual([]);
    expect(projection.getAnnotationsByEdge(EDGE_ID_1)).toEqual([]);
    expect(projection.getPendingProposal(PROPOSAL_ID_1)).toBeUndefined();
  });
});

describe('node mutations', () => {
  it('addNode makes the node retrievable by id with visible=true and initial facet state', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1, 'Hello.'));

    const node = projection.getNode(NODE_ID_1);
    expect(node).toBeDefined();
    expect(node?.id).toBe(NODE_ID_1);
    expect(node?.wording).toBe('Hello.');
    expect(node?.visible).toBe(true);
    expect(node?.wordingFacet.status).toBe('proposed');
    expect(node?.wordingFacet.value).toBe('Hello.');
    expect(node?.classificationFacet.status).toBe('proposed');
    expect(node?.classificationFacet.value).toBeNull();
    expect(node?.substanceFacet.status).toBe('proposed');
    expect(node?.axiomMarks.size).toBe(0);
  });

  it('addNode throws ProjectionInvariantError on duplicate id', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    expect(() => projection.addNode(nodeInput(NODE_ID_1))).toThrow(ProjectionInvariantError);
  });

  it('removeNode of an unknown id is a no-op', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(() => projection.removeNode(NODE_ID_1)).not.toThrow();
  });

  it('removeNode removes the node and clears any incident-edge index entries', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    projection.addNode(nodeInput(NODE_ID_2));
    projection.addEdge(edgeInput(EDGE_ID_1, NODE_ID_1, NODE_ID_2));

    expect(projection.getEdgesBySource(NODE_ID_1).map((e) => e.id)).toEqual([EDGE_ID_1]);
    expect(projection.getEdgesByTarget(NODE_ID_2).map((e) => e.id)).toEqual([EDGE_ID_1]);

    projection.removeNode(NODE_ID_1);

    expect(projection.getNode(NODE_ID_1)).toBeUndefined();
    expect(projection.getEdge(EDGE_ID_1)).toBeUndefined();
    expect(projection.getEdgesBySource(NODE_ID_1)).toEqual([]);
    expect(projection.getEdgesByTarget(NODE_ID_2)).toEqual([]);
  });

  it('removeNode cascades to annotations targeting the node', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    projection.addAnnotation(annotationInputForNode(ANNOTATION_ID_1, NODE_ID_1));
    expect(projection.getAnnotation(ANNOTATION_ID_1)).toBeDefined();

    projection.removeNode(NODE_ID_1);

    expect(projection.getAnnotation(ANNOTATION_ID_1)).toBeUndefined();
    expect(projection.getAnnotationsByNode(NODE_ID_1)).toEqual([]);
  });
});

describe('edge mutations', () => {
  it('addEdge makes the edge retrievable, indexed by source and target', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    projection.addNode(nodeInput(NODE_ID_2));
    projection.addEdge(edgeInput(EDGE_ID_1, NODE_ID_1, NODE_ID_2));

    expect(projection.getEdge(EDGE_ID_1)?.id).toBe(EDGE_ID_1);
    expect(projection.getEdgesBySource(NODE_ID_1).map((e) => e.id)).toEqual([EDGE_ID_1]);
    expect(projection.getEdgesByTarget(NODE_ID_2).map((e) => e.id)).toEqual([EDGE_ID_1]);
    expect(projection.getEdge(EDGE_ID_1)?.visible).toBe(true);
  });

  it('addEdge throws ProjectionInvariantError on duplicate id', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    projection.addNode(nodeInput(NODE_ID_2));
    projection.addEdge(edgeInput(EDGE_ID_1, NODE_ID_1, NODE_ID_2));
    expect(() => projection.addEdge(edgeInput(EDGE_ID_1, NODE_ID_1, NODE_ID_2))).toThrow(
      ProjectionInvariantError,
    );
  });

  it('removeEdge clears both source and target indices', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    projection.addNode(nodeInput(NODE_ID_2));
    projection.addEdge(edgeInput(EDGE_ID_1, NODE_ID_1, NODE_ID_2));
    projection.removeEdge(EDGE_ID_1);

    expect(projection.getEdge(EDGE_ID_1)).toBeUndefined();
    expect(projection.getEdgesBySource(NODE_ID_1)).toEqual([]);
    expect(projection.getEdgesByTarget(NODE_ID_2)).toEqual([]);
  });

  it('removeEdge of an unknown id is a no-op', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(() => projection.removeEdge(EDGE_ID_1)).not.toThrow();
  });

  it('removeEdge cascades to annotations targeting the edge', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    projection.addNode(nodeInput(NODE_ID_2));
    projection.addEdge(edgeInput(EDGE_ID_1, NODE_ID_1, NODE_ID_2));
    projection.addAnnotation(annotationInputForEdge(ANNOTATION_ID_1, EDGE_ID_1));

    projection.removeEdge(EDGE_ID_1);

    expect(projection.getAnnotation(ANNOTATION_ID_1)).toBeUndefined();
    expect(projection.getAnnotationsByEdge(EDGE_ID_1)).toEqual([]);
  });

  it('two edges share the same source: getEdgesBySource returns both', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    projection.addNode(nodeInput(NODE_ID_2));
    projection.addNode(nodeInput(NODE_ID_3));
    projection.addEdge(edgeInput(EDGE_ID_1, NODE_ID_1, NODE_ID_2));
    projection.addEdge(edgeInput(EDGE_ID_2, NODE_ID_1, NODE_ID_3));

    const ids = projection
      .getEdgesBySource(NODE_ID_1)
      .map((e) => e.id)
      .sort();
    expect(ids).toEqual([EDGE_ID_1, EDGE_ID_2].sort());

    projection.removeEdge(EDGE_ID_1);
    expect(projection.getEdgesBySource(NODE_ID_1).map((e) => e.id)).toEqual([EDGE_ID_2]);
  });
});

describe('annotation mutations', () => {
  it('annotation targeting a node lands in annotationsByNode and not annotationsByEdge', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    projection.addAnnotation(annotationInputForNode(ANNOTATION_ID_1, NODE_ID_1));

    expect(projection.getAnnotationsByNode(NODE_ID_1).map((a) => a.id)).toEqual([ANNOTATION_ID_1]);
    expect(projection.getAnnotationsByEdge(EDGE_ID_1)).toEqual([]);
  });

  it('annotation targeting an edge lands in annotationsByEdge and not annotationsByNode', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    projection.addNode(nodeInput(NODE_ID_2));
    projection.addEdge(edgeInput(EDGE_ID_1, NODE_ID_1, NODE_ID_2));
    projection.addAnnotation(annotationInputForEdge(ANNOTATION_ID_1, EDGE_ID_1));

    expect(projection.getAnnotationsByEdge(EDGE_ID_1).map((a) => a.id)).toEqual([ANNOTATION_ID_1]);
    expect(projection.getAnnotationsByNode(NODE_ID_1)).toEqual([]);
  });

  it('addAnnotation throws when neither targetNodeId nor targetEdgeId is set', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(() =>
      projection.addAnnotation({
        id: ANNOTATION_ID_1,
        kind: 'note',
        content: 'orphan',
        targetNodeId: null,
        targetEdgeId: null,
        createdBy: USER_ID,
        createdAt: NOW,
      }),
    ).toThrow(ProjectionInvariantError);
  });

  it('addAnnotation throws when both target ids are set', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(() =>
      projection.addAnnotation({
        id: ANNOTATION_ID_1,
        kind: 'note',
        content: 'doubly-targeted',
        targetNodeId: NODE_ID_1,
        targetEdgeId: EDGE_ID_1,
        createdBy: USER_ID,
        createdAt: NOW,
      }),
    ).toThrow(ProjectionInvariantError);
  });

  it('addAnnotation throws on duplicate id', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    projection.addAnnotation(annotationInputForNode(ANNOTATION_ID_1, NODE_ID_1));
    expect(() =>
      projection.addAnnotation(annotationInputForNode(ANNOTATION_ID_1, NODE_ID_1)),
    ).toThrow(ProjectionInvariantError);
  });

  it('removeAnnotation removes from the right index', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    projection.addAnnotation(annotationInputForNode(ANNOTATION_ID_1, NODE_ID_1));
    projection.removeAnnotation(ANNOTATION_ID_1);

    expect(projection.getAnnotation(ANNOTATION_ID_1)).toBeUndefined();
    expect(projection.getAnnotationsByNode(NODE_ID_1)).toEqual([]);
  });

  it('removeAnnotation of an unknown id is a no-op', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(() => projection.removeAnnotation(ANNOTATION_ID_1)).not.toThrow();
  });
});

describe('visibility', () => {
  it('setNodeVisible(false) keeps the node in the by-id map and in incident-edge indices', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    projection.addNode(nodeInput(NODE_ID_2));
    projection.addEdge(edgeInput(EDGE_ID_1, NODE_ID_1, NODE_ID_2));

    projection.setNodeVisible(NODE_ID_1, false);

    expect(projection.getNode(NODE_ID_1)?.visible).toBe(false);
    expect(projection.getEdgesBySource(NODE_ID_1).map((e) => e.id)).toEqual([EDGE_ID_1]);
    expect(projection.getEdge(EDGE_ID_1)?.visible).toBe(true);
  });

  it('setEdgeVisible(false) keeps the edge in the indices but flips its flag', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    projection.addNode(nodeInput(NODE_ID_2));
    projection.addEdge(edgeInput(EDGE_ID_1, NODE_ID_1, NODE_ID_2));

    projection.setEdgeVisible(EDGE_ID_1, false);

    expect(projection.getEdge(EDGE_ID_1)?.visible).toBe(false);
    expect(projection.getEdgesBySource(NODE_ID_1).map((e) => e.id)).toEqual([EDGE_ID_1]);
  });

  it('setAnnotationVisible(false) keeps the annotation present but flips its flag', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addNode(nodeInput(NODE_ID_1));
    projection.addAnnotation(annotationInputForNode(ANNOTATION_ID_1, NODE_ID_1));

    projection.setAnnotationVisible(ANNOTATION_ID_1, false);

    expect(projection.getAnnotation(ANNOTATION_ID_1)?.visible).toBe(false);
    expect(projection.getAnnotationsByNode(NODE_ID_1).map((a) => a.id)).toEqual([ANNOTATION_ID_1]);
  });

  it('setNodeVisible / setEdgeVisible / setAnnotationVisible throw on unknown id', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(() => projection.setNodeVisible(NODE_ID_1, false)).toThrow(ProjectionInvariantError);
    expect(() => projection.setEdgeVisible(EDGE_ID_1, false)).toThrow(ProjectionInvariantError);
    expect(() => projection.setAnnotationVisible(ANNOTATION_ID_1, false)).toThrow(
      ProjectionInvariantError,
    );
  });
});

describe('pending proposals', () => {
  it('addPendingProposal makes the proposal retrievable; remove clears it', () => {
    const projection = createEmptyProjection(SESSION_ID);
    projection.addPendingProposal({
      proposalEventId: PROPOSAL_ID_1,
      payload: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
      proposer: USER_ID,
      proposedAt: NOW,
      perParticipantVotes: new Map(),
    });

    expect(projection.getPendingProposal(PROPOSAL_ID_1)?.proposalEventId).toBe(PROPOSAL_ID_1);
    expect(projection.pendingProposalCount()).toBe(1);

    projection.removePendingProposal(PROPOSAL_ID_1);
    expect(projection.getPendingProposal(PROPOSAL_ID_1)).toBeUndefined();
    expect(projection.pendingProposalCount()).toBe(0);
  });

  it('addPendingProposal throws on duplicate id', () => {
    const projection = createEmptyProjection(SESSION_ID);
    const proposal = {
      proposalEventId: PROPOSAL_ID_1,
      payload: {
        kind: 'classify-node' as const,
        node_id: NODE_ID_1,
        classification: 'fact' as const,
      },
      proposer: USER_ID,
      proposedAt: NOW,
      perParticipantVotes: new Map(),
    };
    projection.addPendingProposal(proposal);
    expect(() => projection.addPendingProposal(proposal)).toThrow(ProjectionInvariantError);
  });

  it('removePendingProposal of an unknown id is a no-op', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(() => projection.removePendingProposal(PROPOSAL_ID_1)).not.toThrow();
  });
});

describe('property-style sweep — random distinct nodes, random subset removal', () => {
  // Tiny linear-congruential PRNG with a fixed seed so the test is
  // fully deterministic. Seed-2026-05-10. Not cryptographic.
  function makeRng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  function uuidLike(n: number): string {
    const hex = n.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  }

  it('adds 100 distinct nodes; each is retrievable by id', () => {
    const projection = createEmptyProjection(SESSION_ID);
    const ids: string[] = [];
    for (let i = 1; i <= 100; i++) {
      const id = uuidLike(i);
      ids.push(id);
      projection.addNode(nodeInput(id, `Statement ${i}`));
    }
    expect(projection.nodeCount()).toBe(100);
    for (const id of ids) {
      expect(projection.getNode(id)?.id).toBe(id);
    }
  });

  it('removes a random subset; the remainder is intact and indices clean', () => {
    const projection = new Projection(SESSION_ID);
    const nodeIds: string[] = [];
    for (let i = 1; i <= 50; i++) {
      const id = uuidLike(i);
      nodeIds.push(id);
      projection.addNode(nodeInput(id));
    }

    const rng = makeRng(0x05_10_2026);
    const toRemove = new Set<string>();
    for (const id of nodeIds) {
      if (rng() < 0.4) toRemove.add(id);
    }
    for (const id of toRemove) projection.removeNode(id);

    const remaining = nodeIds.filter((id) => !toRemove.has(id));
    expect(projection.nodeCount()).toBe(remaining.length);
    for (const id of remaining) {
      expect(projection.getNode(id)?.id).toBe(id);
    }
    for (const id of toRemove) {
      expect(projection.getNode(id)).toBeUndefined();
    }
  });

  it('cascade preserves invariant: no edge has a missing endpoint', () => {
    const projection = new Projection(SESSION_ID);
    const nodeIds: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const id = uuidLike(i);
      nodeIds.push(id);
      projection.addNode(nodeInput(id));
    }
    const rng = makeRng(0xdeadbeef);
    for (let i = 0; i < 30; i++) {
      const sourceIdx = Math.floor(rng() * nodeIds.length);
      const targetIdx = Math.floor(rng() * nodeIds.length);
      if (sourceIdx === targetIdx) continue;
      const source = nodeIds[sourceIdx];
      const target = nodeIds[targetIdx];
      if (source === undefined || target === undefined) continue;
      const edgeId = uuidLike(1000 + i);
      projection.addEdge(edgeInput(edgeId, source, target));
    }
    // Remove a random ~30% of nodes; edges to/from must vanish.
    const toRemove = new Set<string>();
    for (const id of nodeIds) {
      if (rng() < 0.3) toRemove.add(id);
    }
    for (const id of toRemove) projection.removeNode(id);

    for (const edge of projection.edges()) {
      expect(projection.getNode(edge.sourceNodeId)).toBeDefined();
      expect(projection.getNode(edge.targetNodeId)).toBeDefined();
    }
  });
});
