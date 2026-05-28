// Vitest cases for the participant-local `nodeHasAnnotation` /
// `edgeHasAnnotation` / `annotationCountFor` helpers.
//
// Refinement: tasks/refinements/participant-ui/part_annotation_render.md
// Refinement: tasks/refinements/shell-package/extract_cytoscape_projectors.md
//              (Projection trio coverage moved to
//              `packages/shell/src/annotations/annotations.test.ts` after
//              the third-caller lift; only the participant-local boolean+
//              count helper cases stay here.)
// ADRs:        0022 (no throwaway verifications — every behavioural
//              assertion is a committed test case).
//
// The 2 cases remaining:
//   (i) `nodeHasAnnotation` / `edgeHasAnnotation` return `true` for a
//       bucketed target and `false` for an unbucketed one.
//   (j) `annotationCountFor` returns the right count (0 for unbucketed,
//       N for a bucket with N entries).

import { describe, expect, it } from 'vitest';
import type { AnnotationKind, Event } from '@a-conversa/shared-types';

import {
  annotationCountFor,
  edgeHasAnnotation,
  groupAnnotationsByEdge,
  groupAnnotationsByNode,
  nodeHasAnnotation,
  projectAnnotations,
} from './annotations';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_X = '00000000-0000-4000-8000-0000000000c1';
const NODE_UNTARGETED = '00000000-0000-4000-8000-0000000000c3';
const EDGE_M = '00000000-0000-4000-8000-0000000000e1';
const EDGE_UNTARGETED = '00000000-0000-4000-8000-0000000000e3';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const ANNO_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001';
const ANNO_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002';
const ANNO_3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';
const ANNO_4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004';

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
