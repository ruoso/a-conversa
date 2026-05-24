// Tests for the client-side per-entity per-facet `FacetStatus` derivation.
//
// Refinement: tasks/refinements/moderator-ui/mod_proposed_state_styling.md
//
// Per ADR 0022 these are committed Vitest cases. They pin the rule set
// ported from `apps/server/src/projection/facet-status.ts`'s
// `deriveFacetStatus`: a vote / commit / meta-disagreement flow walked
// against a synthetic event log lands the expected `FacetStatus` on the
// affected entity-facet pair.
//
// The cases mirror the rule numbers in `facetStatus.ts`:
//   1. Empty log → empty maps.
//   2. classify-node proposal with no votes → 'proposed'.
//   3. classify-node + one agree, two current participants → 'proposed'
//      (not all current participants have voted agree).
//   4. classify-node + all participants agree → 'agreed'.
//   5. classify-node + a dispute → 'disputed'.
//   6. classify-node + all agree + commit → 'committed'.
//   7. classify-node + commit + a withdraw vote → 'withdrawn'.
//   8. classify-node + mark-meta-disagreement → 'meta-disagreement'.
//   9. A left participant's vote is excluded from the agree count.
//  10. Empty-session facet (no current participants, no votes) → 'proposed'.
//  11. set-node-substance proposal targets the `substance` facet.
//  12. set-edge-substance proposal targets an edge's `substance` facet.
//  13. edit-wording.reword targets the `wording` facet.
//  14. A node with no proposals against any facet appears as empty record
//      or no entry in the index.
//  15. Structural proposal sub-kinds (`decompose`, `axiom-mark`, etc.)
//      produce no facet-status entry.

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { computeFacetStatuses } from './facetStatus';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000a1';
const PARTICIPANT_B = '00000000-0000-4000-8000-0000000000a2';
const PARTICIPANT_C = '00000000-0000-4000-8000-0000000000a3';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_P = '00000000-0000-4000-8000-0000000000ff';
const PROPOSAL_Q = '00000000-0000-4000-8000-0000000000fe';

function envId(prefix: string, seq: number): string {
  return `00000000-0000-4000-8000-${(prefix.charCodeAt(0) * 256 + seq).toString(16).padStart(12, '0')}`;
}

function joinedEvent(seq: number, userId: string, role: 'debater-A' | 'debater-B'): Event {
  return {
    id: envId('j', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'participant-joined',
    actor: ACTOR,
    payload: {
      user_id: userId,
      role,
      screen_name: 'Test',
      joined_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function leftEvent(seq: number, userId: string): Event {
  return {
    id: envId('l', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'participant-left',
    actor: ACTOR,
    payload: {
      user_id: userId,
      left_at: '2026-05-11T00:01:00.000Z',
    },
    createdAt: '2026-05-11T00:01:00.000Z',
  };
}

function classifyProposal(
  seq: number,
  envelopeId: string,
  nodeId: string,
  classification: 'fact' | 'predictive' | 'value' | 'normative' | 'definitional' = 'fact',
): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'classify-node',
        node_id: nodeId,
        classification,
      },
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function setNodeSubstanceProposal(seq: number, envelopeId: string, nodeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: { kind: 'set-node-substance', node_id: nodeId, value: 'agreed' },
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function setEdgeSubstanceProposal(seq: number, envelopeId: string, edgeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: { kind: 'set-edge-substance', edge_id: edgeId, value: 'agreed' },
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function rewordProposal(seq: number, envelopeId: string, nodeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: nodeId,
        new_wording: 'updated wording',
      },
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function axiomMarkProposal(seq: number, envelopeId: string, nodeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: { kind: 'axiom-mark', node_id: nodeId, participant: PARTICIPANT_A },
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function voteEvent(
  seq: number,
  proposalId: string,
  participant: string,
  vote: 'agree' | 'dispute' | 'withdraw',
): Event {
  return {
    id: envId('v', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'vote',
    actor: participant,
    payload: {
      target: 'proposal' as const,
      proposal_id: proposalId,
      participant,
      choice: vote as 'agree' | 'dispute',
      voted_at: '2026-05-11T00:00:10.000Z',
    },
    createdAt: '2026-05-11T00:00:10.000Z',
  };
}

function commitEvent(seq: number, proposalId: string): Event {
  return {
    id: envId('c', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      target: 'proposal',
      proposal_id: proposalId,
      committed_by: ACTOR,
      committed_at: '2026-05-11T00:00:20.000Z',
    },
    createdAt: '2026-05-11T00:00:20.000Z',
  };
}

function withdrawAgreementEvent(
  seq: number,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'classification' | 'substance' | 'wording' | 'shape',
  participant: string,
): Event {
  return {
    id: envId('w', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'withdraw-agreement',
    actor: participant,
    payload: {
      entity_kind: entityKind,
      entity_id: entityId,
      facet,
      participant,
      withdrawn_at: '2026-05-11T00:00:25.000Z',
    },
    createdAt: '2026-05-11T00:00:25.000Z',
  };
}

function metaDisagreementEvent(seq: number, proposalId: string): Event {
  return {
    id: envId('m', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'meta-disagreement-marked',
    actor: ACTOR,
    payload: {
      target: 'proposal',
      proposal_id: proposalId,
      marked_by: ACTOR,
      marked_at: '2026-05-11T00:00:30.000Z',
    },
    createdAt: '2026-05-11T00:00:30.000Z',
  };
}

describe('computeFacetStatuses — empty input', () => {
  it('returns empty maps for an empty event log', () => {
    const index = computeFacetStatuses([]);
    expect(index.nodes.size).toBe(0);
    expect(index.edges.size).toBe(0);
  });
});

describe('computeFacetStatuses — agreement-layer states', () => {
  it('classify-node proposal with no votes lands as proposed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)).toEqual({ classification: 'proposed' });
  });

  it('classify-node + one agree out of two current participants is still proposed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('proposed');
  });

  it('classify-node + every current participant agreeing → agreed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'agree'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('agreed');
  });

  it('classify-node + a dispute vote → disputed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'dispute'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('disputed');
  });
});

describe('computeFacetStatuses — committed-layer states', () => {
  it('classify-node + all agree + commit → committed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'agree'),
      commitEvent(6, PROPOSAL_P),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('committed');
  });

  it('a withdraw-agreement against a committed facet → withdrawn', () => {
    // Per ADR 0030 §3: withdrawal is now its own first-class event
    // kind, keyed by `(entity, facet, participant)`.
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'agree'),
      commitEvent(6, PROPOSAL_P),
      withdrawAgreementEvent(7, 'node', NODE_X, 'classification', PARTICIPANT_A),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('withdrawn');
  });

  it('mark-meta-disagreement on a facet short-circuits to meta-disagreement', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'dispute'),
      metaDisagreementEvent(6, PROPOSAL_P),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('meta-disagreement');
  });
});

describe('computeFacetStatuses — participant filtering', () => {
  it("a left participant's vote is excluded from the agreement count", () => {
    // A and B agree; A leaves; B is now the only current participant and
    // has voted agree, so the facet is agreed (with A's vote no longer
    // contributing to the count but also not contradicting).
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'agree'),
      leftEvent(6, PARTICIPANT_A),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('agreed');
  });

  it('an empty-session facet (no current participants) stays proposed', () => {
    // A proposal can land before any participant joins (e.g. the
    // moderator's own actions on an empty lobby). Without current
    // participants the unanimous-agree rule cannot fire, so the facet
    // is proposed.
    const events: Event[] = [classifyProposal(1, PROPOSAL_P, NODE_X)];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('proposed');
  });
});

describe('computeFacetStatuses — facet routing per proposal sub-kind', () => {
  it('set-node-substance proposal targets the substance facet', () => {
    const events: Event[] = [setNodeSubstanceProposal(1, PROPOSAL_P, NODE_X)];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)).toEqual({ substance: 'proposed' });
  });

  it('set-edge-substance proposal targets an edge substance facet', () => {
    const events: Event[] = [setEdgeSubstanceProposal(1, PROPOSAL_P, EDGE_E)];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)).toEqual({ substance: 'proposed' });
    expect(index.nodes.size).toBe(0);
  });

  it('edit-wording.reword targets the wording facet', () => {
    const events: Event[] = [rewordProposal(1, PROPOSAL_P, NODE_X)];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)).toEqual({ wording: 'proposed' });
  });
});

describe('computeFacetStatuses — entities without proposals', () => {
  it('a node with no proposals against any of its facets has no entry in the index', () => {
    // No proposals at all → the projection has no entity entries.
    const events: Event[] = [joinedEvent(1, PARTICIPANT_A, 'debater-A')];
    const index = computeFacetStatuses(events);
    expect(index.nodes.size).toBe(0);
    expect(index.edges.size).toBe(0);
  });

  it('two nodes — proposal against one leaves the other absent from the index', () => {
    const events: Event[] = [classifyProposal(1, PROPOSAL_P, NODE_X)];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('proposed');
    expect(index.nodes.has(NODE_Y)).toBe(false);
  });
});

describe('computeFacetStatuses — out-of-scope proposal sub-kinds', () => {
  it('axiom-mark proposal does NOT produce a facet entry on the targeted node', () => {
    // axiom-mark is per-participant and rendered separately; this task
    // does not treat it as a facet-status update.
    const events: Event[] = [axiomMarkProposal(1, PROPOSAL_P, NODE_X)];
    const index = computeFacetStatuses(events);
    expect(index.nodes.has(NODE_X)).toBe(false);
  });
});

describe('computeFacetStatuses — multiple facets on the same entity', () => {
  it('one node carries independent statuses on classification and substance', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      // classification: one agree + one dispute → disputed
      classifyProposal(3, PROPOSAL_P, NODE_X),
      voteEvent(4, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_B, 'dispute'),
      // substance: no votes yet → proposed
      setNodeSubstanceProposal(6, PROPOSAL_Q, NODE_X),
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)).toEqual({
      classification: 'disputed',
      substance: 'proposed',
    });
  });

  it('three participants — one absent → the facet stays proposed until all three have voted', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      joinedEvent(3, PARTICIPANT_C, 'debater-A'), // role reuse fine for test
      classifyProposal(4, PROPOSAL_P, NODE_X),
      voteEvent(5, PROPOSAL_P, PARTICIPANT_A, 'agree'),
      voteEvent(6, PROPOSAL_P, PARTICIPANT_B, 'agree'),
      // PARTICIPANT_C hasn't voted yet
    ];
    const index = computeFacetStatuses(events);
    expect(index.nodes.get(NODE_X)?.classification).toBe('proposed');
  });
});

// ──────────────────────────────────────────────────────────────────────
// `pf_mod_facet_name_widen_shape` — shape facet on edges
// ──────────────────────────────────────────────────────────────────────
//
// Per ADR 0030 §5 + `pf_shape_facet_wire_vote` + the widening: the
// `shape` facet on an edge lands inline with the `edge-created` event
// (the carriage of the role). There is no `propose-edge-shape` sub-
// kind in v1, so the facet's candidate seeds from the create event
// directly and votes / commits / meta-disagreement marks / withdraw-
// agreement payloads ride the facet-arm wire shape. These tests pin
// the new arm.

function edgeCreatedEvent(
  seq: number,
  edgeId: string,
  source: string = '00000000-0000-4000-8000-000000000001',
  target: string = '00000000-0000-4000-8000-000000000002',
): Event {
  return {
    id: envId('e', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'edge-created',
    actor: ACTOR,
    payload: {
      edge_id: edgeId,
      source_node_id: source,
      target_node_id: target,
      role: 'supports',
      created_by: ACTOR,
      created_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function facetVoteEvent(
  seq: number,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'classification' | 'substance' | 'wording' | 'shape',
  participant: string,
  choice: 'agree' | 'dispute',
): Event {
  return {
    id: envId('V', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'vote',
    actor: participant,
    payload: {
      target: 'facet',
      entity_kind: entityKind,
      entity_id: entityId,
      facet,
      participant,
      choice,
      voted_at: '2026-05-11T00:00:10.000Z',
    },
    createdAt: '2026-05-11T00:00:10.000Z',
  };
}

function facetCommitEvent(
  seq: number,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'classification' | 'substance' | 'wording' | 'shape',
): Event {
  return {
    id: envId('C', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      target: 'facet',
      entity_kind: entityKind,
      entity_id: entityId,
      facet,
      committed_by: ACTOR,
      committed_at: '2026-05-11T00:00:20.000Z',
    },
    createdAt: '2026-05-11T00:00:20.000Z',
  };
}

describe('computeFacetStatuses — shape facet (edge)', () => {
  it('edge-created seeds the shape facet with a candidate; empty-session degenerates to proposed', () => {
    // No participants joined — Rule 7's unanimous-agree check fails
    // (currentParticipantCount === 0); Rule 8 'proposed' wins.
    const events: Event[] = [edgeCreatedEvent(1, EDGE_E)];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)).toEqual({
      shape: 'proposed',
      substance: 'awaiting-proposal',
    });
  });

  it('all current participants vote agree on (edge, shape) → agreed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVoteEvent(4, 'edge', EDGE_E, 'shape', PARTICIPANT_A, 'agree'),
      facetVoteEvent(5, 'edge', EDGE_E, 'shape', PARTICIPANT_B, 'agree'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)?.shape).toBe('agreed');
  });

  it('a dispute vote on (edge, shape) → disputed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVoteEvent(4, 'edge', EDGE_E, 'shape', PARTICIPANT_A, 'agree'),
      facetVoteEvent(5, 'edge', EDGE_E, 'shape', PARTICIPANT_B, 'dispute'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)?.shape).toBe('disputed');
  });

  it('facet-arm commit on (edge, shape) → committed', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVoteEvent(4, 'edge', EDGE_E, 'shape', PARTICIPANT_A, 'agree'),
      facetVoteEvent(5, 'edge', EDGE_E, 'shape', PARTICIPANT_B, 'agree'),
      facetCommitEvent(6, 'edge', EDGE_E, 'shape'),
    ];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)?.shape).toBe('committed');
  });

  it('withdraw-agreement on committed (edge, shape) → withdrawn', () => {
    const events: Event[] = [
      joinedEvent(1, PARTICIPANT_A, 'debater-A'),
      joinedEvent(2, PARTICIPANT_B, 'debater-B'),
      edgeCreatedEvent(3, EDGE_E),
      facetVoteEvent(4, 'edge', EDGE_E, 'shape', PARTICIPANT_A, 'agree'),
      facetVoteEvent(5, 'edge', EDGE_E, 'shape', PARTICIPANT_B, 'agree'),
      facetCommitEvent(6, 'edge', EDGE_E, 'shape'),
      withdrawAgreementEvent(7, 'edge', EDGE_E, 'shape', PARTICIPANT_A),
    ];
    const index = computeFacetStatuses(events);
    expect(index.edges.get(EDGE_E)?.shape).toBe('withdrawn');
  });
});
