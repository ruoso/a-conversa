// Vitest cases for the participant's pure `projectGraph` projection.
//
// Refinement: tasks/refinements/participant-ui/part_graph_render.md
//              (Test layers per ADR 0022 — ten cases per the
//              refinement's "Tests pin" sketch).
// ADRs:        0022 (no throwaway verifications — the projection's
//              behaviour is fully pinned at this pure layer; the
//              `<GraphView>` mount tests then assert the Cytoscape
//              side without re-asserting algorithmic behaviour).
//
// All event factories mirror the moderator's `GraphCanvasPane.test.tsx`
// shape so a reader cross-referencing the two surfaces sees the same
// envelope construction idiom.

import { describe, expect, it } from 'vitest';
import type { EdgeRole, Event, StatementKind } from '@a-conversa/shared-types';

import { projectGraph } from './projectGraph';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const EDGE_A = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

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
      created_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
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
    createdAt: '2026-05-17T00:00:00.000Z',
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
      proposal_id: opts.proposalEnvelopeId,
      moderator: ACTOR,
      committed_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function makeParticipantJoined(opts: { sequence: number; userId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x500 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'participant-joined',
    actor: opts.userId,
    payload: {
      user_id: opts.userId,
      role: 'debater-A',
      screen_name: 'noisy',
      joined_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

describe('projectGraph — pure projection from events to Cytoscape elements', () => {
  it('(a) returns empty arrays for an empty event log', () => {
    expect(projectGraph([])).toEqual({ nodes: [], edges: [] });
  });

  it('(b) emits one node descriptor per node-created event with kind: null', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'UBI lifts welfare floor' }),
    ];
    const { nodes, edges } = projectGraph(events);
    expect(edges).toEqual([]);
    expect(nodes).toEqual([
      {
        group: 'nodes',
        data: { id: NODE_A, wording: 'UBI lifts welfare floor', kind: null },
      },
    ]);
  });

  it('(c) emits one edge descriptor per edge-created event with source / target / role', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({
        sequence: 3,
        edgeId: EDGE_A,
        source: NODE_A,
        target: NODE_B,
        role: 'rebuts',
      }),
    ];
    const { edges } = projectGraph(events);
    expect(edges).toEqual([
      {
        group: 'edges',
        data: { id: EDGE_A, source: NODE_A, target: NODE_B, role: 'rebuts' },
      },
    ]);
  });

  it('(d) projects a mixed event log into both nodes and edges in their respective arrival orders', () => {
    const EDGE_B = '00000000-0000-4000-8000-00000000000f';
    const events: Event[] = [
      makeEdgeCreated({ sequence: 1, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_A, wording: 'A' }),
      makeEdgeCreated({
        sequence: 3,
        edgeId: EDGE_B,
        source: NODE_B,
        target: NODE_A,
        role: 'qualifies',
      }),
      makeNodeCreated({ sequence: 4, nodeId: NODE_B, wording: 'B' }),
    ];
    const { nodes, edges } = projectGraph(events);
    expect(nodes.map((n) => n.data.id)).toEqual([NODE_A, NODE_B]);
    expect(edges.map((e) => e.data.id)).toEqual([EDGE_A, EDGE_B]);
  });

  it('(e) leaves kind: null when a classify-node proposal exists but no commit landed', () => {
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

  it('(g) ignores a commit whose proposal id has not been seen', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeCommit({ sequence: 2, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.kind).toBeNull();
  });

  it('(h) round-trips every StatementKind through a proposal + commit pair', () => {
    const kinds: StatementKind[] = ['fact', 'predictive', 'value', 'normative', 'definitional'];
    for (const kind of kinds) {
      const proposalId = `00000000-0000-4000-8000-0000000000${kind.length.toString(16).padStart(2, '0')}1`;
      const events: Event[] = [
        makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: `wording for ${kind}` }),
        makeClassifyProposal({
          sequence: 2,
          envelopeId: proposalId,
          nodeId: NODE_A,
          classification: kind,
        }),
        makeCommit({ sequence: 3, proposalEnvelopeId: proposalId }),
      ];
      const { nodes } = projectGraph(events);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.data.kind).toBe(kind);
    }
  });

  it('(i) round-trips every EdgeRole through edge-created descriptors', () => {
    const roles: EdgeRole[] = [
      'supports',
      'rebuts',
      'qualifies',
      'bridges-from',
      'bridges-to',
      'defines',
      'contradicts',
    ];
    roles.forEach((role, index) => {
      const edgeId = `00000000-0000-4000-8000-0000000000${(index + 1).toString(16).padStart(2, '0')}0`;
      const events: Event[] = [
        makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
        makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
        makeEdgeCreated({
          sequence: 3,
          edgeId,
          source: NODE_A,
          target: NODE_B,
          role,
        }),
      ];
      const { edges } = projectGraph(events);
      expect(edges).toHaveLength(1);
      expect(edges[0]?.data.role).toBe(role);
    });
  });

  it('(j) is event-ordering invariant — unrelated events between a classify-node proposal and its commit do not break the kind flip', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'value',
      }),
      // Unrelated event interleaved between the proposal and the
      // commit — the projection must not lose the cached proposal.
      makeParticipantJoined({ sequence: 3, userId: ACTOR }),
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.kind).toBe('value');
  });
});
