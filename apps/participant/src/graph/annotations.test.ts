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
const NODE_WITHDRAWN = '00000000-0000-4000-8000-0000000000c4';
const EDGE_M = '00000000-0000-4000-8000-0000000000e1';
const EDGE_UNTARGETED = '00000000-0000-4000-8000-0000000000e3';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const ANNO_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001';
const ANNO_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002';
const ANNO_3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';
const ANNO_4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004';
const PROPOSAL_ANNOTATE_W = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa005';

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

function makeAnnotateProposal(opts: {
  sequence: number;
  envelopeId: string;
  targetNodeId: string;
  kind: AnnotationKind;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'annotate',
        target_kind: 'node',
        target_id: opts.targetNodeId,
        annotation_kind: opts.kind,
        content: 'pending annotation body',
      },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function makeProposalWithdrawn(opts: { sequence: number; proposalEnvelopeId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x900 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal-withdrawn',
    actor: ACTOR,
    payload: {
      proposal_id: opts.proposalEnvelopeId,
      withdrawn_by: ACTOR,
      withdrawn_at: '2026-05-17T00:00:00.000Z',
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

describe('annotation commit-gating (proposal-withdrawn terminator)', () => {
  // §A1 regression pin (part_withdraw_proposal_overlay_removal). A debater
  // self-withdraws a *pending* `annotate` proposal via the zero-emission
  // `proposal-withdrawn` terminator (ADR 0037) — no `annotation-created`
  // ever lands. `projectAnnotations` walks `annotation-created` only, so the
  // withdrawn-pending proposal contributed no overlay and there is nothing
  // to retract: the node carries no annotation. The committed sibling
  // (`annotation-created` on NODE_X) proves the pin distinguishes
  // withdrawn-pending from committed, not a blanket "no annotations".
  it('a withdrawn pending annotate yields no annotation while a committed sibling still does', () => {
    const events: Event[] = [
      // Pending annotate → withdrawn (no annotation-created): no overlay.
      makeAnnotateProposal({
        sequence: 1,
        envelopeId: PROPOSAL_ANNOTATE_W,
        targetNodeId: NODE_WITHDRAWN,
        kind: 'note',
      }),
      makeProposalWithdrawn({ sequence: 2, proposalEnvelopeId: PROPOSAL_ANNOTATE_W }),
      // Committed annotation on NODE_X: still yields an overlay.
      makeAnnotationCreated({
        sequence: 3,
        annotationId: ANNO_1,
        kind: 'note',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
    ];

    const annotations = projectAnnotations(events);
    const nodeIndex = groupAnnotationsByNode(annotations);

    expect(annotations.map((annotation) => annotation.targetNodeId)).toEqual([NODE_X]);
    expect(nodeHasAnnotation(nodeIndex, NODE_WITHDRAWN)).toBe(false);
    expect(nodeHasAnnotation(nodeIndex, NODE_X)).toBe(true);
  });
});
