// Vitest cases for `lookupEntity.ts`.
//
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel.md
//              (five cases per the Constraints sketch: null selection,
//              matching node, unknown node id, matching edge, annotation
//              arm).

import { describe, expect, it } from 'vitest';

import { lookupEntity } from './lookupEntity';
import { EMPTY_FACET_STATUSES } from '../graph/facetStatus';
import { EMPTY_OTHER_VOTES_LIST } from '../graph/otherVotes';
import type { ParticipantEdgeData, ParticipantNodeData } from '../graph/projectGraph';

const NODE_A_ID = '00000000-0000-4000-8000-00000000000a';
const NODE_B_ID = '00000000-0000-4000-8000-00000000000b';
const EDGE_A_ID = '00000000-0000-4000-8000-00000000000e';

function nodeData(id: string, wording: string): ParticipantNodeData {
  return {
    id,
    wording,
    kind: null,
    facetStatuses: EMPTY_FACET_STATUSES,
    rollupStatus: 'none',
    isAxiom: false,
    hasAnnotation: false,
    annotationCount: 0,
    diagnosticHighlight: null,
    ownVote: 'none',
    otherVotes: EMPTY_OTHER_VOTES_LIST,
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
  };
}

describe('lookupEntity', () => {
  const nodes = [nodeData(NODE_A_ID, 'A'), nodeData(NODE_B_ID, 'B')];
  const edges = [edgeData(EDGE_A_ID, NODE_A_ID, NODE_B_ID)];

  it('(a) returns null for a null selection', () => {
    expect(lookupEntity(nodes, edges, null)).toBeNull();
  });

  it('(b) returns the matching node data when the selection points at a known node', () => {
    const result = lookupEntity(nodes, edges, { kind: 'node', id: NODE_A_ID });
    expect(result).not.toBeNull();
    expect(result?.id).toBe(NODE_A_ID);
    expect((result as ParticipantNodeData).wording).toBe('A');
  });

  it('(c) returns null when the selection points at an unknown node id (stale-entity branch)', () => {
    const result = lookupEntity(nodes, edges, {
      kind: 'node',
      id: '00000000-0000-4000-8000-00000000ffff',
    });
    expect(result).toBeNull();
  });

  it('(d) returns the matching edge data when the selection points at a known edge', () => {
    const result = lookupEntity(nodes, edges, { kind: 'edge', id: EDGE_A_ID });
    expect(result).not.toBeNull();
    expect(result?.id).toBe(EDGE_A_ID);
    expect((result as ParticipantEdgeData).role).toBe('supports');
  });

  it('(e) returns null for the annotation selection arm (reserved for future annotation-tap surface)', () => {
    const result = lookupEntity(nodes, edges, { kind: 'annotation', id: NODE_A_ID });
    expect(result).toBeNull();
  });
});
