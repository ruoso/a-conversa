// Vitest cases for the canonical `projectAnnotations` /
// `groupAnnotationsByNode` / `groupAnnotationsByEdge` derivation.
//
// Refinement: tasks/refinements/shell-package/extract_cytoscape_projectors.md
//   (Consolidates the moderator's `apps/moderator/src/graph/selectors.test.ts`
//   annotation block + the participant's `apps/participant/src/graph/
//   annotations.test.ts` projection blocks + the audience's
//   `apps/audience/src/graph/annotations.test.ts` into one suite at the
//   canonical shell home. The participant's local boolean+count helper
//   cases stay participant-side; this suite covers the lifted projection
//   trio only.)
// ADRs:        0022 (no throwaway verifications — every behavioural
//              assertion is a committed test case).
//
// The 10 cases mirror the predecessor suites' union:
//   (a) empty event log → [].
//   (b) one node-targeted `annotation-created` → one `Annotation` with
//       the right camelCased fields + `targetEdgeId: null`.
//   (c) one edge-targeted `annotation-created` → one `Annotation` with
//       `targetEdgeId` populated + `targetNodeId: null`.
//   (d) arrival order preserved across multiple `annotation-created`
//       events.
//   (e) mixed log — non-annotation events are ignored.
//   (f) every `AnnotationKind` value round-trips intact.
//   (g) `groupAnnotationsByNode` buckets node-targeted annotations +
//       skips edge-targeted ones (the edge-targeted entry does NOT leak
//       into any node bucket).
//   (h) `groupAnnotationsByEdge` buckets edge-targeted annotations +
//       skips node-targeted ones (the node-targeted entry does NOT leak
//       into any edge bucket).
//   (i) both bucketers handle a multi-bucket mixed log (per-edge / per-
//       node accumulation in arrival order, no cross-bucket leakage).
//   (j) both bucketers return an empty `Map` for an empty annotations
//       input + `EMPTY_ANNOTATIONS` is the same frozen reference across
//       calls (memoization identity invariant).

import { describe, expect, it } from 'vitest';
import type { AnnotationKind, Event } from '@a-conversa/shared-types';

import {
  EMPTY_ANNOTATIONS,
  groupAnnotationsByEdge,
  groupAnnotationsByEntityId,
  groupAnnotationsByNode,
  projectAnnotations,
  type Annotation,
} from './annotations.js';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_X = '00000000-0000-4000-8000-0000000000c1';
const NODE_Y = '00000000-0000-4000-8000-0000000000c2';
const EDGE_M = '00000000-0000-4000-8000-0000000000e1';
const EDGE_N = '00000000-0000-4000-8000-0000000000e2';
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
      created_at: '2026-05-28T00:00:00.000Z',
    },
    createdAt: '2026-05-28T00:00:00.000Z',
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
      created_at: '2026-05-28T00:00:00.000Z',
    },
    createdAt: '2026-05-28T00:00:00.000Z',
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
      created_at: '2026-05-28T00:00:00.000Z',
    },
    createdAt: '2026-05-28T00:00:00.000Z',
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
    createdAt: '2026-05-28T00:00:00.000Z',
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
      target: 'proposal',
      proposal_id: opts.proposalEnvelopeId,
      committed_by: ACTOR,
      committed_at: '2026-05-28T00:00:00.000Z',
    },
    createdAt: '2026-05-28T00:00:00.000Z',
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
      target: 'proposal' as const,
      proposal_id: opts.proposalEnvelopeId,
      participant: ACTOR,
      choice: 'agree',
      voted_at: '2026-05-28T00:00:00.000Z',
    },
    createdAt: '2026-05-28T00:00:00.000Z',
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
      createdAt: '2026-05-28T00:00:00.000Z',
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

  it('(e) ignores non-annotation events in a mixed log (node-created, edge-created, proposal, commit, vote)', () => {
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
  it('(g) buckets node-targeted annotations under their target node id and skips edge-targeted ones (no cross-bucket leakage)', () => {
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
    expect(
      Array.from(grouped.values())
        .flat()
        .map((a) => a.id),
    ).toEqual([ANNO_1, ANNO_2, ANNO_3]);
  });
});

describe('groupAnnotationsByEdge', () => {
  it('(h) buckets edge-targeted annotations under their target edge id and skips node-targeted ones (no cross-bucket leakage)', () => {
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
        content: 'qualifies only the accredited subset',
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
    ];
    const grouped: ReadonlyMap<string, readonly Annotation[]> = groupAnnotationsByEdge(
      projectAnnotations(events),
    );
    expect(grouped.get(EDGE_M)?.map((a) => a.id)).toEqual([ANNO_2, ANNO_3]);
    // The node-targeted annotation must NOT leak into the edge index.
    expect(grouped.has(NODE_X)).toBe(false);
    expect(
      Array.from(grouped.values())
        .flat()
        .map((a) => a.id),
    ).toEqual([ANNO_2, ANNO_3]);
  });

  it('(i) buckets a multi-edge mixed log into per-edge entries in arrival order; node-targeted entries do not leak', () => {
    const events: Event[] = [
      makeAnnotationCreated({
        sequence: 1,
        annotationId: ANNO_1,
        kind: 'note',
        targetNodeId: null,
        targetEdgeId: EDGE_M,
      }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNO_2,
        kind: 'reframe',
        targetNodeId: null,
        targetEdgeId: EDGE_N,
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
        kind: 'scope-change',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
    ];
    const grouped = groupAnnotationsByEdge(projectAnnotations(events));
    expect(grouped.get(EDGE_M)?.map((a) => a.id)).toEqual([ANNO_1, ANNO_3]);
    expect(grouped.get(EDGE_N)?.map((a) => a.id)).toEqual([ANNO_2]);
    expect(grouped.has(NODE_X)).toBe(false);
  });
});

describe('groupAnnotationsByEntityId — polymorphic-entity-id convention', () => {
  // Refinement: tasks/refinements/participant-ui/part_annotation_of_annotation_overlay_chain.md
  //   (Decision §1 — the bucketer is target-kind-agnostic by construction;
  //   this case pins the convention that the `targetNodeId` slot may carry
  //   any UUID, including another annotation's id. The legacy
  //   `groupAnnotationsByNode` alias is asserted to be the same function
  //   reference so existing call sites keep working.)
  it('(k) buckets an annotation whose targetNodeId carries another annotation id under that annotation id, and the legacy `groupAnnotationsByNode` alias points at the same function', () => {
    const events: Event[] = [
      // A1 targets a statement node (the existing convention).
      makeAnnotationCreated({
        sequence: 1,
        annotationId: ANNO_1,
        kind: 'note',
        targetNodeId: NODE_X,
        targetEdgeId: null,
      }),
      // A2 targets A1 — the polymorphic-entity-id case. The wire schema's
      // `target_node_id: z.string().uuid().nullable()` slot accepts any
      // UUID; the bucketer keys on the raw UUID regardless of kind.
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNO_2,
        kind: 'reframe',
        targetNodeId: ANNO_1,
        targetEdgeId: null,
      }),
    ];
    const grouped: ReadonlyMap<string, readonly Annotation[]> = groupAnnotationsByEntityId(
      projectAnnotations(events),
    );
    expect(grouped.get(NODE_X)?.map((a) => a.id)).toEqual([ANNO_1]);
    expect(grouped.get(ANNO_1)?.map((a) => a.id)).toEqual([ANNO_2]);
    // The legacy name is a thin alias — exact identity, so audience +
    // moderator imports continue resolving to the same function.
    expect(groupAnnotationsByNode).toBe(groupAnnotationsByEntityId);
  });
});

describe('EMPTY_ANNOTATIONS + bucketer empty-input handling', () => {
  it('(j) bucketers return an empty Map for an empty annotations input and EMPTY_ANNOTATIONS is a frozen identity-stable reference', () => {
    expect(groupAnnotationsByNode(EMPTY_ANNOTATIONS).size).toBe(0);
    expect(groupAnnotationsByEdge(EMPTY_ANNOTATIONS).size).toBe(0);
    expect(groupAnnotationsByNode([]).size).toBe(0);
    expect(groupAnnotationsByEdge([]).size).toBe(0);
    expect(Object.isFrozen(EMPTY_ANNOTATIONS)).toBe(true);
    expect(EMPTY_ANNOTATIONS).toBe(EMPTY_ANNOTATIONS);
  });
});
