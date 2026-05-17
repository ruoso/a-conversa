// Vitest cases for the participant's `projectAnnotations` /
// `groupAnnotationsBy{Node,Edge}` / `nodeHasAnnotation` /
// `edgeHasAnnotation` / `annotationCountFor` derivation.
//
// Refinement: tasks/refinements/participant-ui/part_annotation_render.md
//              (Constraints — 10 Vitest cases mirroring the moderator's
//              `projectAnnotations` coverage from
//              `apps/moderator/src/graph/selectors.test.ts` so a reader
//              cross-referencing the two ports sees the same pin.)
// ADRs:        0022 (no throwaway verifications — every behavioural
//              assertion is a committed test case).
//
// The 10 cases per the refinement's "Constraints" section:
//   (a) empty event log → [].
//   (b) single `annotation-created` on a node target projects with all
//       fields camelCased + `targetEdgeId: null`.
//   (c) single `annotation-created` on an edge target projects with
//       `targetNodeId: null`.
//   (d) arrival order preserved across multiple `annotation-created`
//       events.
//   (e) mixed event log — non-annotation events ignored.
//   (f) each `AnnotationKind` value round-trips intact on
//       `Annotation.kind`.
//   (g) `groupAnnotationsByNode` buckets node-targeted annotations +
//       skips edge-targeted.
//   (h) `groupAnnotationsByEdge` buckets edge-targeted annotations +
//       skips node-targeted.
//   (i) `nodeHasAnnotation` / `edgeHasAnnotation` return `true` for a
//       bucketed target and `false` for an unbucketed one.
//   (j) `annotationCountFor` returns the right count (0 for
//       unbucketed, N for a bucket with N entries).

import { describe, expect, it } from 'vitest';
import type { AnnotationKind, Event } from '@a-conversa/shared-types';

import {
  annotationCountFor,
  edgeHasAnnotation,
  groupAnnotationsByEdge,
  groupAnnotationsByNode,
  nodeHasAnnotation,
  projectAnnotations,
  type Annotation,
} from './annotations';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_X = '00000000-0000-4000-8000-0000000000c1';
const NODE_Y = '00000000-0000-4000-8000-0000000000c2';
const NODE_UNTARGETED = '00000000-0000-4000-8000-0000000000c3';
const EDGE_M = '00000000-0000-4000-8000-0000000000e1';
const EDGE_N = '00000000-0000-4000-8000-0000000000e2';
const EDGE_UNTARGETED = '00000000-0000-4000-8000-0000000000e3';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const ANNO_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001';
const ANNO_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002';
const ANNO_3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';
const ANNO_4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004';
const PROPOSAL_CLASSIFY = '00000000-0000-4000-8000-0000000000d1';

const ALL_ANNOTATION_KINDS: readonly AnnotationKind[] = [
  'note',
  'reframe',
  'scope-change',
  'stance',
];

function makeAnnotationCreated(opts: {
  sequence: number;
  annotationId: string;
  kind: AnnotationKind;
  content?: string;
  targetNodeId: string | null;
  targetEdgeId: string | null;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x500 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'annotation-created',
    actor: ACTOR,
    payload: {
      annotation_id: opts.annotationId,
      kind: opts.kind,
      content: opts.content ?? 'annotation body',
      target_node_id: opts.targetNodeId,
      target_edge_id: opts.targetEdgeId,
      created_by: ACTOR,
      created_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function makeNodeCreated(opts: { sequence: number; nodeId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x100 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: opts.nodeId,
      wording: 'wording',
      created_by: ACTOR,
      created_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function makeEdgeCreated(opts: {
  sequence: number;
  edgeId: string;
  source: string;
  target: string;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x300 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'edge-created',
    actor: ACTOR,
    payload: {
      edge_id: opts.edgeId,
      role: 'supports',
      source_node_id: opts.source,
      target_node_id: opts.target,
      created_by: ACTOR,
      created_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function makeClassifyProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'classify-node',
        node_id: opts.nodeId,
        classification: 'fact',
      },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function makeCommit(opts: { sequence: number; proposalEnvelopeId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x800 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      proposal_id: opts.proposalEnvelopeId,
      moderator: ACTOR,
      committed_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function makeVote(opts: { sequence: number; proposalEnvelopeId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x900 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'vote',
    actor: ACTOR,
    payload: {
      proposal_id: opts.proposalEnvelopeId,
      participant: ACTOR,
      vote: 'agree',
      voted_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

describe('projectAnnotations', () => {
  it('(a) returns [] for an empty event log', () => {
    expect(projectAnnotations([])).toEqual([]);
  });

  it('(b) projects a node-targeted annotation into the camelCased shape with targetEdgeId: null', () => {
    const events: Event[] = [
      makeAnnotationCreated({
        sequence: 1,
        annotationId: ANNO_1,
        kind: 'note',
        content: 'see also F-003',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
    ];
    const annotations = projectAnnotations(events);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({
      id: ANNO_1,
      kind: 'note',
      content: 'see also F-003',
      targetNodeId: NODE_X,
      targetEdgeId: null,
      createdBy: ACTOR,
      createdAt: '2026-05-17T00:00:00.000Z',
    });
  });

  it('(c) projects an edge-targeted annotation with targetNodeId: null', () => {
    const events: Event[] = [
      makeAnnotationCreated({
        sequence: 1,
        annotationId: ANNO_1,
        kind: 'reframe',
        targetNodeId: null,
        targetEdgeId: EDGE_M,
      }),
    ];
    const annotations = projectAnnotations(events);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.targetNodeId).toBeNull();
    expect(annotations[0]?.targetEdgeId).toBe(EDGE_M);
  });

  it('(d) preserves arrival order across multiple annotation-created events', () => {
    const events: Event[] = [
      makeAnnotationCreated({
        sequence: 1,
        annotationId: ANNO_1,
        kind: 'note',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNO_2,
        kind: 'reframe',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: ANNO_3,
        kind: 'stance',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
    ];
    const annotations = projectAnnotations(events);
    expect(annotations.map((a) => a.id)).toEqual([ANNO_1, ANNO_2, ANNO_3]);
  });

  it('(e) ignores non-annotation events in a mixed log (node-created, proposal, commit, vote)', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_X }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_CLASSIFY,
        nodeId: NODE_X,
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_CLASSIFY }),
      makeVote({ sequence: 4, proposalEnvelopeId: PROPOSAL_CLASSIFY }),
      makeAnnotationCreated({
        sequence: 5,
        annotationId: ANNO_1,
        kind: 'note',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
      makeEdgeCreated({
        sequence: 6,
        edgeId: EDGE_M,
        source: NODE_X,
        target: NODE_Y,
      }),
    ];
    const annotations = projectAnnotations(events);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.id).toBe(ANNO_1);
  });

  it('(f) round-trips every AnnotationKind value through the projection', () => {
    const events: Event[] = ALL_ANNOTATION_KINDS.map((kind, index) =>
      makeAnnotationCreated({
        sequence: index + 1,
        annotationId: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa${(0x100 + index).toString(16).padStart(4, '0')}`,
        kind,
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
    );
    const annotations = projectAnnotations(events);
    expect(annotations).toHaveLength(ALL_ANNOTATION_KINDS.length);
    expect(annotations.map((a) => a.kind)).toEqual(ALL_ANNOTATION_KINDS);
  });
});

describe('groupAnnotationsByNode', () => {
  it('(g) buckets node-targeted annotations under their target node id and skips edge-targeted ones', () => {
    const events: Event[] = [
      makeAnnotationCreated({
        sequence: 1,
        annotationId: ANNO_1,
        kind: 'note',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNO_2,
        kind: 'reframe',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: ANNO_3,
        kind: 'stance',
        targetNodeId: NODE_Y,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 4,
        annotationId: ANNO_4,
        kind: 'note',
        targetNodeId: null,
        targetEdgeId: EDGE_M,
      }),
    ];
    const grouped: ReadonlyMap<string, readonly Annotation[]> = groupAnnotationsByNode(
      projectAnnotations(events),
    );
    expect(grouped.get(NODE_X)?.map((a) => a.id)).toEqual([ANNO_1, ANNO_2]);
    expect(grouped.get(NODE_Y)?.map((a) => a.id)).toEqual([ANNO_3]);
    // The edge-targeted annotation must NOT leak into the node index.
    expect(grouped.has(EDGE_M)).toBe(false);
  });
});

describe('groupAnnotationsByEdge', () => {
  it('(h) buckets edge-targeted annotations under their target edge id and skips node-targeted ones', () => {
    const events: Event[] = [
      makeAnnotationCreated({
        sequence: 1,
        annotationId: ANNO_1,
        kind: 'note',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNO_2,
        kind: 'reframe',
        targetNodeId: null,
        targetEdgeId: EDGE_M,
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: ANNO_3,
        kind: 'stance',
        targetNodeId: null,
        targetEdgeId: EDGE_M,
      }),
      makeAnnotationCreated({
        sequence: 4,
        annotationId: ANNO_4,
        kind: 'note',
        targetNodeId: null,
        targetEdgeId: EDGE_N,
      }),
    ];
    const grouped: ReadonlyMap<string, readonly Annotation[]> = groupAnnotationsByEdge(
      projectAnnotations(events),
    );
    expect(grouped.get(EDGE_M)?.map((a) => a.id)).toEqual([ANNO_2, ANNO_3]);
    expect(grouped.get(EDGE_N)?.map((a) => a.id)).toEqual([ANNO_4]);
    // The node-targeted annotation must NOT leak into the edge index.
    expect(grouped.has(NODE_X)).toBe(false);
  });
});

describe('nodeHasAnnotation + edgeHasAnnotation', () => {
  it('(i) returns true for a bucketed target and false for an unbucketed one', () => {
    const events: Event[] = [
      makeAnnotationCreated({
        sequence: 1,
        annotationId: ANNO_1,
        kind: 'note',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNO_2,
        kind: 'reframe',
        targetNodeId: null,
        targetEdgeId: EDGE_M,
      }),
    ];
    const annotations = projectAnnotations(events);
    const nodeIndex = groupAnnotationsByNode(annotations);
    const edgeIndex = groupAnnotationsByEdge(annotations);

    expect(nodeHasAnnotation(nodeIndex, NODE_X)).toBe(true);
    expect(nodeHasAnnotation(nodeIndex, NODE_UNTARGETED)).toBe(false);

    expect(edgeHasAnnotation(edgeIndex, EDGE_M)).toBe(true);
    expect(edgeHasAnnotation(edgeIndex, EDGE_UNTARGETED)).toBe(false);
  });
});

describe('annotationCountFor', () => {
  it('(j) returns 0 for an unbucketed id and N for a bucket with N entries', () => {
    const events: Event[] = [
      makeAnnotationCreated({
        sequence: 1,
        annotationId: ANNO_1,
        kind: 'note',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNO_2,
        kind: 'reframe',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: ANNO_3,
        kind: 'stance',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 4,
        annotationId: ANNO_4,
        kind: 'note',
        targetNodeId: null,
        targetEdgeId: EDGE_M,
      }),
    ];
    const annotations = projectAnnotations(events);
    const nodeIndex = groupAnnotationsByNode(annotations);
    const edgeIndex = groupAnnotationsByEdge(annotations);

    expect(annotationCountFor(nodeIndex, NODE_X)).toBe(3);
    expect(annotationCountFor(nodeIndex, NODE_UNTARGETED)).toBe(0);
    expect(annotationCountFor(edgeIndex, EDGE_M)).toBe(1);
    expect(annotationCountFor(edgeIndex, EDGE_UNTARGETED)).toBe(0);
  });
});
