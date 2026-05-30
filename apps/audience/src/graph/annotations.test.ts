// Vitest cases for the audience's annotation-endpoint helpers.
//
// Refinement: tasks/refinements/audience/aud_render_annotation_endpoint_edges.md
//   (Acceptance criteria — case (aep-a)–(aep-i) pin the three helpers
//   `computeAnnotationsAsEndpoints`, `projectAnnotationNodes`,
//   `projectAnnotationHostEdges`.)
//
// ADRs: 0022 (no throwaway verifications — every helper branch is pinned
//   here so the projector integration tests in `projectGraph.test.ts`
//   can focus on the end-of-walk composition.)

import { describe, expect, it } from 'vitest';
import type { Annotation } from '@a-conversa/shell';
import type { AnnotationKind, EdgeRole, Event } from '@a-conversa/shared-types';

import {
  computeAnnotationsAsEndpoints,
  projectAnnotationHostEdges,
  projectAnnotationNodes,
} from './annotations';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const EDGE_A = '00000000-0000-4000-8000-00000000000e';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const ANNO_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001';
const ANNO_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002';
const ANNO_UNKNOWN_HOST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa099';

function makeNodeCreated(opts: { sequence: number; nodeId: string; wording?: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x100 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: opts.nodeId,
      wording: opts.wording ?? 'node body',
      created_by: ACTOR,
      created_at: '2026-05-29T00:00:00.000Z',
    },
    createdAt: '2026-05-29T00:00:00.000Z',
  };
}

function makeEdgeCreated(opts: {
  sequence: number;
  edgeId: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  sourceAnnotationId?: string;
  targetAnnotationId?: string;
  role?: EdgeRole;
}): Event {
  const role: EdgeRole = opts.role ?? 'supports';
  const payload: Record<string, unknown> = {
    edge_id: opts.edgeId,
    role,
    created_by: ACTOR,
    created_at: '2026-05-29T00:00:00.000Z',
  };
  if (opts.sourceNodeId !== undefined) payload.source_node_id = opts.sourceNodeId;
  else payload.source_annotation_id = opts.sourceAnnotationId;
  if (opts.targetNodeId !== undefined) payload.target_node_id = opts.targetNodeId;
  else payload.target_annotation_id = opts.targetAnnotationId;
  return {
    id: `00000000-0000-4000-8000-${(0x300 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'edge-created',
    actor: ACTOR,
    payload: payload as Event extends { kind: 'edge-created'; payload: infer P } ? P : never,
    createdAt: '2026-05-29T00:00:00.000Z',
  };
}

function makeAnnotation(opts: {
  annotationId: string;
  kind?: AnnotationKind;
  content?: string;
  targetNodeId?: string | null;
  targetEdgeId?: string | null;
}): Annotation {
  return {
    id: opts.annotationId,
    kind: opts.kind ?? 'note',
    content: opts.content ?? 'annotation body',
    targetNodeId: opts.targetNodeId ?? null,
    targetEdgeId: opts.targetEdgeId ?? null,
    createdBy: ACTOR,
    createdAt: '2026-05-29T00:00:00.000Z',
  };
}

describe('computeAnnotationsAsEndpoints', () => {
  it('(aep-a) returns an empty set for an empty event log', () => {
    expect(computeAnnotationsAsEndpoints([])).toEqual(new Set<string>());
  });

  it('(aep-b) collects target_annotation_id from a single annotation-endpoint edge', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A }),
      makeEdgeCreated({
        sequence: 2,
        edgeId: EDGE_A,
        sourceNodeId: NODE_A,
        targetAnnotationId: ANNO_1,
        role: 'contradicts',
      }),
    ];
    expect(computeAnnotationsAsEndpoints(events)).toEqual(new Set<string>([ANNO_1]));
  });

  it('(aep-c) collapses duplicate references to the same annotation id', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B }),
      makeEdgeCreated({
        sequence: 3,
        edgeId: '00000000-0000-4000-8000-00000000000e',
        sourceNodeId: NODE_A,
        targetAnnotationId: ANNO_1,
      }),
      makeEdgeCreated({
        sequence: 4,
        edgeId: '00000000-0000-4000-8000-00000000000f',
        sourceNodeId: NODE_B,
        targetAnnotationId: ANNO_1,
      }),
    ];
    expect(computeAnnotationsAsEndpoints(events)).toEqual(new Set<string>([ANNO_1]));
  });

  it('(aep-d) collects both source_annotation_id and target_annotation_id across edges', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A }),
      makeEdgeCreated({
        sequence: 2,
        edgeId: '00000000-0000-4000-8000-00000000000e',
        sourceAnnotationId: ANNO_1,
        targetNodeId: NODE_A,
      }),
      makeEdgeCreated({
        sequence: 3,
        edgeId: '00000000-0000-4000-8000-00000000000f',
        sourceNodeId: NODE_A,
        targetAnnotationId: ANNO_2,
      }),
    ];
    expect(computeAnnotationsAsEndpoints(events)).toEqual(new Set<string>([ANNO_1, ANNO_2]));
  });
});

describe('projectAnnotationNodes', () => {
  it('(aep-e) returns an empty array when the promoted set is empty', () => {
    const annotations: Annotation[] = [
      makeAnnotation({ annotationId: ANNO_1, targetNodeId: NODE_A }),
    ];
    expect(projectAnnotationNodes(annotations, new Set<string>(), [])).toEqual([]);
  });

  it('(aep-f) emits one node descriptor per promoted annotation with the sentinel defaults', () => {
    const annotations: Annotation[] = [
      makeAnnotation({
        annotationId: ANNO_1,
        kind: 'reframe',
        content: 'reframe of N_A',
        targetNodeId: NODE_A,
      }),
    ];
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A })];
    const out = projectAnnotationNodes(annotations, new Set<string>([ANNO_1]), events);
    expect(out).toHaveLength(1);
    const node = out[0];
    expect(node?.group).toBe('nodes');
    expect(node?.data.id).toBe(ANNO_1);
    expect(node?.data.nodeKind).toBe('annotation');
    expect(node?.data.annotationKind).toBe('reframe');
    expect(node?.data.wording).toBe('reframe of N_A');
    expect(node?.data.kind).toBeNull();
    expect(node?.data.rollupStatus).toBe('none');
    expect(node?.data.facetStatuses).toEqual({});
    expect(node?.data.axiomMarks).toEqual([]);
    expect(node?.data.annotations).toEqual([]);
    expect(node?.data.hostMissing).toBeUndefined();
  });

  it('(aep-g) stamps hostMissing: true when neither target_node_id nor target_edge_id resolves', () => {
    const annotations: Annotation[] = [
      makeAnnotation({
        annotationId: ANNO_UNKNOWN_HOST,
        kind: 'note',
        targetNodeId: NODE_B,
      }),
    ];
    // NODE_B is not in events — the host can't be resolved.
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A })];
    const out = projectAnnotationNodes(annotations, new Set<string>([ANNO_UNKNOWN_HOST]), events);
    expect(out).toHaveLength(1);
    expect(out[0]?.data.hostMissing).toBe(true);
  });
});

describe('projectAnnotationHostEdges', () => {
  it('(aep-h) emits a tether { source: targetNodeId, target: annotationId } for a node-hosted annotation', () => {
    const annotations: Annotation[] = [
      makeAnnotation({ annotationId: ANNO_1, kind: 'note', targetNodeId: NODE_A }),
    ];
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A })];
    const out = projectAnnotationHostEdges(annotations, new Set<string>([ANNO_1]), events);
    expect(out).toHaveLength(1);
    expect(out[0]?.data.id).toBe(`annotation-host-${ANNO_1}`);
    expect(out[0]?.data.source).toBe(NODE_A);
    expect(out[0]?.data.target).toBe(ANNO_1);
    expect(out[0]?.data.entityRole).toBe('annotation-host');
  });

  it('(aep-i) tethers an edge-hosted annotation to the host edge source endpoint', () => {
    const annotations: Annotation[] = [
      makeAnnotation({ annotationId: ANNO_1, kind: 'note', targetEdgeId: EDGE_A }),
    ];
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B }),
      makeEdgeCreated({
        sequence: 3,
        edgeId: EDGE_A,
        sourceNodeId: NODE_A,
        targetNodeId: NODE_B,
      }),
    ];
    const out = projectAnnotationHostEdges(annotations, new Set<string>([ANNO_1]), events);
    expect(out).toHaveLength(1);
    expect(out[0]?.data.source).toBe(NODE_A);
    expect(out[0]?.data.target).toBe(ANNO_1);
  });

  it('(aep-j) omits the tether entirely when the host cannot be resolved', () => {
    const annotations: Annotation[] = [
      makeAnnotation({ annotationId: ANNO_UNKNOWN_HOST, kind: 'note', targetNodeId: NODE_B }),
    ];
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A })];
    const out = projectAnnotationHostEdges(
      annotations,
      new Set<string>([ANNO_UNKNOWN_HOST]),
      events,
    );
    expect(out).toEqual([]);
  });
});
