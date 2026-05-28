// Vitest cases for the audience's pure `projectGraph` projection.
//
// Refinement: tasks/refinements/audience/aud_cytoscape_init.md
//   (Acceptance criteria — 10 cases (a–j) pin the single-pass projection
//   algorithm without mounting Cytoscape.)
//
// Refinement: tasks/refinements/audience/aud_proposed_styling.md
//   (Acceptance criteria — 6 additional cases (k–p) pin the per-facet
//   status stamping: every emitted node + edge carries
//   `data.facetStatuses` (sourced from `computeFacetStatuses(events)`)
//   and `data.rollupStatus` (the priority rollup, or the literal
//   sentinel `'none'` when the per-facet record is empty per
//   Decision §4). The commit-arm kind flips preserve both fields via
//   the `{...existing.data}` spread.)
//
// Refinement: tasks/refinements/audience/aud_axiom_mark_decoration.md
//   (Acceptance criteria — 5 additional cases (q–u) pin the per-node
//   axiom-mark stamping: default empty, targeted non-empty, multi-
//   participant accumulation, commit-survives-kind-flip, and edges-
//   carry-no-axiomMarks shape.)
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

  it('(k) emits facetStatuses + rollupStatus on every projected node', () => {
    // A lone `node-created` seeds the wording facet inline (per ADR
    // 0030 §4): wording = 'proposed' (no votes, no participants),
    // classification and substance = 'awaiting-proposal' (no candidate
    // yet). Rollup priority surfaces 'proposed'.
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.facetStatuses).toEqual({
      wording: 'proposed',
      classification: 'awaiting-proposal',
      substance: 'awaiting-proposal',
    });
    expect(nodes[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(l) stamps a classify-node proposal target as facetStatuses.classification: "proposed"', () => {
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
    expect(nodes[0]?.data.facetStatuses.classification).toBe('proposed');
    expect(nodes[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(m) stamps a set-edge-substance proposal as edge facetStatuses.substance: "proposed"', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
      {
        id: '00000000-0000-4000-8000-0000000000ee',
        sessionId: SESSION_ID,
        sequence: 4,
        kind: 'proposal',
        actor: ACTOR,
        payload: {
          proposal: { kind: 'set-edge-substance', edge_id: EDGE_A, value: 'agreed' },
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      },
    ];
    const { edges } = projectGraph(events);
    expect(edges[0]?.data.facetStatuses.substance).toBe('proposed');
    expect(edges[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(n) preserves facetStatuses + rollupStatus across the proposal-keyed classify commit branch', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events);
    // kind flipped to the committed classification...
    expect(nodes[0]?.data.kind).toBe('fact');
    // ...and the facet stamping survived the `{...existing.data}`
    // spread inside the commit arm.
    expect(nodes[0]?.data.facetStatuses.classification).toBe('committed');
    // wording stays 'proposed' (no wording-targeting events, 0
    // participants); rollupStatus priority ordering surfaces it.
    expect(nodes[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(o) preserves facetStatuses + rollupStatus across the facet-keyed classification commit branch', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'value',
      }),
      // Facet-keyed commit (ADR 0030 §2). The projection resolves the
      // committed classification via `currentClassificationByNode`.
      {
        id: '00000000-0000-4000-8000-0000000000c5',
        sessionId: SESSION_ID,
        sequence: 3,
        kind: 'commit',
        actor: ACTOR,
        payload: {
          target: 'facet',
          entity_kind: 'node',
          entity_id: NODE_A,
          facet: 'classification',
          committed_by: ACTOR,
          committed_at: '2026-05-27T00:00:00.000Z',
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      },
    ];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.kind).toBe('value');
    expect(nodes[0]?.data.facetStatuses.classification).toBe('committed');
    expect(nodes[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(p) ROLLUP_PRIORITY: proposed beats agreed across facets on the same node', () => {
    // Two participants join + agree on classify-node → classification:
    // 'agreed'. A set-node-substance proposal then lands with no votes
    // → substance: 'proposed'. Wording stays 'proposed' (no wording
    // votes against 2 current participants). Rollup priority surfaces
    // 'proposed' because at least one facet is proposed.
    const PROPOSAL_SUB = '00000000-0000-4000-8000-0000000000b2';
    const PARTICIPANT_X = '00000000-0000-4000-8000-0000000000b9';
    const PARTICIPANT_Y = '00000000-0000-4000-8000-0000000000ba';
    const events: Event[] = [
      {
        id: '00000000-0000-4000-8000-000000000401',
        sessionId: SESSION_ID,
        sequence: 1,
        kind: 'participant-joined',
        actor: ACTOR,
        payload: {
          user_id: PARTICIPANT_X,
          role: 'debater-A',
          screen_name: 'X',
          joined_at: '2026-05-27T00:00:00.000Z',
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000402',
        sessionId: SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: ACTOR,
        payload: {
          user_id: PARTICIPANT_Y,
          role: 'debater-B',
          screen_name: 'Y',
          joined_at: '2026-05-27T00:00:00.000Z',
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      },
      makeNodeCreated({ sequence: 3, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 4,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'predictive',
      }),
      {
        id: '00000000-0000-4000-8000-000000000601',
        sessionId: SESSION_ID,
        sequence: 5,
        kind: 'vote',
        actor: PARTICIPANT_X,
        payload: {
          target: 'proposal',
          proposal_id: PROPOSAL_A,
          participant: PARTICIPANT_X,
          choice: 'agree',
          voted_at: '2026-05-27T00:00:00.000Z',
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000602',
        sessionId: SESSION_ID,
        sequence: 6,
        kind: 'vote',
        actor: PARTICIPANT_Y,
        payload: {
          target: 'proposal',
          proposal_id: PROPOSAL_A,
          participant: PARTICIPANT_Y,
          choice: 'agree',
          voted_at: '2026-05-27T00:00:00.000Z',
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      },
      {
        id: PROPOSAL_SUB,
        sessionId: SESSION_ID,
        sequence: 7,
        kind: 'proposal',
        actor: ACTOR,
        payload: {
          proposal: { kind: 'set-node-substance', node_id: NODE_A, value: 'agreed' },
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      },
    ];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.facetStatuses.classification).toBe('agreed');
    expect(nodes[0]?.data.facetStatuses.substance).toBe('proposed');
    expect(nodes[0]?.data.rollupStatus).toBe('proposed');
  });

  // ---------------------------------------------------------------
  // aud_axiom_mark_decoration — per-node axiom-mark stamping. Pinned
  // cases pulled directly from the refinement Constraints section.
  // ---------------------------------------------------------------

  function makeAxiomMarkProposal(opts: {
    sequence: number;
    envelopeId: string;
    nodeId: string;
    participantId: string;
  }): Event {
    return {
      id: opts.envelopeId,
      sessionId: SESSION_ID,
      sequence: opts.sequence,
      kind: 'proposal',
      actor: opts.participantId,
      payload: {
        proposal: {
          kind: 'axiom-mark',
          node_id: opts.nodeId,
          participant: opts.participantId,
        },
      },
      createdAt: '2026-05-28T00:00:00.000Z',
    };
  }

  const PARTICIPANT_AX_A = '00000000-0000-4000-8000-0000000000aa1';
  const PARTICIPANT_AX_B = '00000000-0000-4000-8000-0000000000bb2';
  const PROPOSAL_AX_A = '00000000-0000-4000-8000-0000000000ax1';
  const PROPOSAL_AX_B = '00000000-0000-4000-8000-0000000000ax2';

  it('(q) stamps axiomMarks: [] on every projected node by default when no axiom-mark events landed', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.axiomMarks).toEqual([]);
  });

  it('(r) stamps a one-entry axiomMarks array on a node targeted by a committed axiom-mark', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: PROPOSAL_AX_A,
        nodeId: NODE_A,
        participantId: PARTICIPANT_AX_A,
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_AX_A }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.axiomMarks).toHaveLength(1);
    expect(nodes[0]?.data.axiomMarks[0]).toEqual({
      nodeId: NODE_A,
      participantId: PARTICIPANT_AX_A,
      committedAt: '2026-05-27T00:00:00.000Z',
    });
  });

  it('(s) stamps a two-entry axiomMarks array on a node two participants have marked, in commit-arrival order', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: PROPOSAL_AX_A,
        nodeId: NODE_A,
        participantId: PARTICIPANT_AX_A,
      }),
      makeAxiomMarkProposal({
        sequence: 3,
        envelopeId: PROPOSAL_AX_B,
        nodeId: NODE_A,
        participantId: PARTICIPANT_AX_B,
      }),
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_AX_B }),
      makeCommit({ sequence: 5, proposalEnvelopeId: PROPOSAL_AX_A }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.axiomMarks.map((m) => m.participantId)).toEqual([
      PARTICIPANT_AX_B,
      PARTICIPANT_AX_A,
    ]);
  });

  it('(t) preserves axiomMarks across a later classify-node commit (commit-arm spread)', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: PROPOSAL_AX_A,
        nodeId: NODE_A,
        participantId: PARTICIPANT_AX_A,
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_AX_A }),
      makeClassifyProposal({
        sequence: 4,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'value',
      }),
      makeCommit({ sequence: 5, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.kind).toBe('value');
    expect(nodes[0]?.data.axiomMarks).toHaveLength(1);
    expect(nodes[0]?.data.axiomMarks[0]?.participantId).toBe(PARTICIPANT_AX_A);
  });

  it('(u) edges carry no axiomMarks field — AudienceEdgeData is unchanged', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
    ];
    const { edges } = projectGraph(events);
    expect(edges).toHaveLength(1);
    expect((edges[0]?.data as unknown as Record<string, unknown>).axiomMarks).toBeUndefined();
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
