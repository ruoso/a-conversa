// Vitest cases for the audience's pure `projectGraph` projection.
//
// Refinement: tasks/refinements/audience/aud_cytoscape_init.md
//   (Acceptance criteria — 10 cases enumerated below pin the
//   single-pass projection algorithm without mounting Cytoscape.)
//
// ADRs: 0022 (no throwaway verifications — the projection's
//   behaviour is fully pinned at this pure layer; the `<AudienceGraphView>`
//   mount tests then assert the Cytoscape side without re-asserting
//   algorithmic behaviour).

import { describe, expect, it } from 'vitest';
import type { EdgeRole, Event, StatementKind } from '@a-conversa/shared-types';

import { projectGraph } from './projectGraph';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const NODE_C = '00000000-0000-4000-8000-00000000000c';
const EDGE_A = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const PROPOSAL_UNKNOWN = '00000000-0000-4000-8000-0000000000bb';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

const ALL_STATEMENT_KINDS: readonly StatementKind[] = [
  'fact',
  'predictive',
  'value',
  'normative',
  'definitional',
];

const ALL_EDGE_ROLES: readonly EdgeRole[] = [
  'supports',
  'rebuts',
  'qualifies',
  'bridges-from',
  'bridges-to',
  'defines',
  'contradicts',
];

function makeNodeCreated(opts: { sequence: number; nodeId: string; wording: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x100 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: opts.nodeId,
      wording: opts.wording,
      created_by: ACTOR,
      created_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function makeEdgeCreated(opts: {
  sequence: number;
  edgeId: string;
  source: string;
  target: string;
  role?: EdgeRole;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x300 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'edge-created',
    actor: ACTOR,
    payload: {
      edge_id: opts.edgeId,
      role: opts.role ?? 'supports',
      source_node_id: opts.source,
      target_node_id: opts.target,
      created_by: ACTOR,
      created_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function makeClassifyProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
  classification: StatementKind;
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
        classification: opts.classification,
      },
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function makeCommit(opts: { sequence: number; proposalEnvelopeId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x200 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      target: 'proposal',
      proposal_id: opts.proposalEnvelopeId,
      committed_by: ACTOR,
      committed_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function makeParticipantJoined(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x400 + sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence,
    kind: 'participant-joined',
    actor: ACTOR,
    payload: {
      user_id: ACTOR,
      role: 'debater-A',
      screen_name: 'alice',
      joined_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

describe('projectGraph (audience baseline)', () => {
  it('(a) returns empty arrays for an empty event log', () => {
    expect(projectGraph([])).toEqual({ nodes: [], edges: [] });
  });

  it('(b) emits one node descriptor per node-created event with kind: null', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'UBI lifts welfare floor' }),
    ];
    const { nodes, edges } = projectGraph(events);
    expect(edges).toEqual([]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      group: 'nodes',
      data: { id: NODE_A, wording: 'UBI lifts welfare floor', kind: null },
    });
  });

  it('(c) emits one edge descriptor per edge-created with correct source / target / role', () => {
    const events: Event[] = [
      makeEdgeCreated({
        sequence: 1,
        edgeId: EDGE_A,
        source: NODE_A,
        target: NODE_B,
        role: 'rebuts',
      }),
    ];
    const { nodes, edges } = projectGraph(events);
    expect(nodes).toEqual([]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      group: 'edges',
      data: { id: EDGE_A, source: NODE_A, target: NODE_B, role: 'rebuts' },
    });
  });

  it('(d) projects both nodes and edges from an interleaved event log', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeEdgeCreated({ sequence: 2, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
      makeNodeCreated({ sequence: 3, nodeId: NODE_B, wording: 'B' }),
    ];
    const { nodes, edges } = projectGraph(events);
    expect(nodes.map((n) => n.data.id)).toEqual([NODE_A, NODE_B]);
    expect(edges.map((e) => e.data.id)).toEqual([EDGE_A]);
  });

  it('(e) leaves kind: null when a classify-node proposal has no matching commit', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.kind).toBeNull();
  });

  it('(f) flips kind to the committed classification after a classify-node proposal + commit pair', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'normative',
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.kind).toBe('normative');
  });

  it('(g) ignores a commit referencing an unknown proposal envelope id', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeCommit({ sequence: 2, proposalEnvelopeId: PROPOSAL_UNKNOWN }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.kind).toBeNull();
  });

  it('(h) round-trips every StatementKind through proposal + commit', () => {
    for (const kind of ALL_STATEMENT_KINDS) {
      const proposalId = `00000000-0000-4000-8000-0000000000${ALL_STATEMENT_KINDS.indexOf(kind)
        .toString()
        .padStart(2, '0')}`;
      const events: Event[] = [
        makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'wording' }),
        makeClassifyProposal({
          sequence: 2,
          envelopeId: proposalId,
          nodeId: NODE_A,
          classification: kind,
        }),
        makeCommit({ sequence: 3, proposalEnvelopeId: proposalId }),
      ];
      const { nodes } = projectGraph(events);
      expect(nodes[0]?.data.kind).toBe(kind);
    }
  });

  it('(i) round-trips every EdgeRole through edge-created', () => {
    for (const role of ALL_EDGE_ROLES) {
      const events: Event[] = [
        makeEdgeCreated({
          sequence: 1,
          edgeId: EDGE_A,
          source: NODE_A,
          target: NODE_B,
          role,
        }),
      ];
      const { edges } = projectGraph(events);
      expect(edges).toHaveLength(1);
      expect(edges[0]?.data.role).toBe(role);
    }
  });

  it('(j) is invariant under non-causal events interleaved between node-created and its classify commit', () => {
    const direct: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_C, wording: 'C' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_C,
        classification: 'predictive',
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const interleaved: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_C, wording: 'C' }),
      makeParticipantJoined(2),
      makeClassifyProposal({
        sequence: 3,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_C,
        classification: 'predictive',
      }),
      makeParticipantJoined(4),
      makeCommit({ sequence: 5, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const directOut = projectGraph(direct);
    const interleavedOut = projectGraph(interleaved);
    expect(interleavedOut.nodes).toEqual(directOut.nodes);
    expect(interleavedOut.edges).toEqual(directOut.edges);
  });
});
