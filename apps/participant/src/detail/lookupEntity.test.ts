// Vitest cases for `lookupEntity.ts`.
//
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel.md
//              (original cases: null selection, matching node, unknown
//              node id, matching edge, annotation arm).
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel_annotation_view.md
//              (annotation-a..d cases: matching annotation, unknown id,
//              empty array, third-arg threading with the existing
//              node/edge arms).

import { describe, expect, it } from 'vitest';

import { lookupEntity } from './lookupEntity';
import { EMPTY_FACET_STATUSES, type Annotation } from '@a-conversa/shell';
import { EMPTY_OTHER_VOTES_LIST } from '../graph/otherVotes';
import type { ParticipantEdgeData, ParticipantNodeData } from '../graph/projectGraph';

const NODE_A_ID = '00000000-0000-4000-8000-00000000000a';
const NODE_B_ID = '00000000-0000-4000-8000-00000000000b';
const EDGE_A_ID = '00000000-0000-4000-8000-00000000000e';
const ANNOTATION_A_ID = '00000000-0000-4000-8000-0000000000a1';
const ANNOTATION_B_ID = '00000000-0000-4000-8000-0000000000a2';

function nodeData(id: string, wording: string): ParticipantNodeData {
  return {
    id,
    wording,
    nodeKind: 'statement',
    annotationKind: null,
    kind: null,
    facetStatuses: EMPTY_FACET_STATUSES,
    rollupStatus: 'none',
    isAxiom: false,
    hasAnnotation: false,
    annotationCount: 0,
    diagnosticHighlight: null,
    ownVote: 'none',
    otherVotes: EMPTY_OTHER_VOTES_LIST,
    isFlashing: false,
    width: 80,
    height: 40,
    textMaxWidth: 56,
  };
}

function edgeData(id: string, source: string, target: string): ParticipantEdgeData {
  return {
    id,
    source,
    target,
    role: 'supports',
    facetStatuses: EMPTY_FACET_STATUSES,
    rollupStatus: 'none',
    hasAnnotation: false,
    annotationCount: 0,
    diagnosticHighlight: null,
    ownVote: 'none',
    otherVotes: EMPTY_OTHER_VOTES_LIST,
    isFlashing: false,
  };
}

function annotationRecord(id: string, content: string): Annotation {
  return {
    id,
    kind: 'note',
    content,
    targetNodeId: NODE_A_ID,
    targetEdgeId: null,
    createdBy: NODE_B_ID,
    createdAt: '2026-05-30T00:00:00.000Z',
  };
}

describe('lookupEntity', () => {
  const nodes = [nodeData(NODE_A_ID, 'A'), nodeData(NODE_B_ID, 'B')];
  const edges = [edgeData(EDGE_A_ID, NODE_A_ID, NODE_B_ID)];
  const annotations: readonly Annotation[] = [
    annotationRecord(ANNOTATION_A_ID, 'note on A'),
    annotationRecord(ANNOTATION_B_ID, 'note on B'),
  ];

  it('(a) returns null for a null selection', () => {
    expect(lookupEntity(nodes, edges, annotations, null)).toBeNull();
  });

  it('(b) returns the matching node data when the selection points at a known node', () => {
    const result = lookupEntity(nodes, edges, annotations, { kind: 'node', id: NODE_A_ID });
    expect(result).not.toBeNull();
    expect(result?.id).toBe(NODE_A_ID);
    expect((result as ParticipantNodeData).wording).toBe('A');
  });

  it('(c) returns null when the selection points at an unknown node id (stale-entity branch)', () => {
    const result = lookupEntity(nodes, edges, annotations, {
      kind: 'node',
      id: '00000000-0000-4000-8000-00000000ffff',
    });
    expect(result).toBeNull();
  });

  it('(d) returns the matching edge data when the selection points at a known edge', () => {
    const result = lookupEntity(nodes, edges, annotations, { kind: 'edge', id: EDGE_A_ID });
    expect(result).not.toBeNull();
    expect(result?.id).toBe(EDGE_A_ID);
    expect((result as ParticipantEdgeData).role).toBe('supports');
  });

  it('(annotation-a) returns the matching annotation record when the selection points at a known annotation', () => {
    const result = lookupEntity(nodes, edges, annotations, {
      kind: 'annotation',
      id: ANNOTATION_A_ID,
    });
    expect(result).not.toBeNull();
    expect(result?.id).toBe(ANNOTATION_A_ID);
    expect((result as Annotation).content).toBe('note on A');
  });

  it('(annotation-b) returns null when the annotation id is not in the array (stale-annotation branch)', () => {
    const result = lookupEntity(nodes, edges, annotations, {
      kind: 'annotation',
      id: '00000000-0000-4000-8000-0000000000ff',
    });
    expect(result).toBeNull();
  });

  it('(annotation-c) accepts an empty annotation array and returns null for any annotation selection', () => {
    const result = lookupEntity(nodes, edges, [], { kind: 'annotation', id: ANNOTATION_A_ID });
    expect(result).toBeNull();
  });

  it('(annotation-d) existing node / edge arms still pass with the third argument supplied', () => {
    expect(lookupEntity(nodes, edges, annotations, { kind: 'node', id: NODE_B_ID })?.id).toBe(
      NODE_B_ID,
    );
    expect(lookupEntity(nodes, edges, annotations, { kind: 'edge', id: EDGE_A_ID })?.id).toBe(
      EDGE_A_ID,
    );
  });
});
