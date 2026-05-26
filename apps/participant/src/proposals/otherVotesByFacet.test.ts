// Vitest cases for `projectOtherVotesByFacet`.
//
// Refinement: tasks/refinements/participant-ui/part_vote_indicators_in_pane.md
//
// Per ADR 0022 these are committed Vitest cases. They mirror the
// moderator's `projectVotesByFacet` scenarios with the self-filter pin
// added.

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { projectOtherVotesByFacet } from './otherVotesByFacet';

const SESSION = '00000000-0000-4000-8000-0000000000aa';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_W = '00000000-0000-4000-8000-0000000000a1';
const PROPOSAL_C = '00000000-0000-4000-8000-0000000000a2';
const PROPOSAL_E = '00000000-0000-4000-8000-0000000000a3';
const SELF = '00000000-0000-4000-8000-00000000000c';
const OTHER_A = '00000000-0000-4000-8000-00000000001a';
const OTHER_B = '00000000-0000-4000-8000-00000000001b';

function classifyNodeProposal(seq: number, envelopeId: string, nodeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: OTHER_A,
    payload: {
      proposal: { kind: 'classify-node', node_id: nodeId, classification: 'fact' },
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function editWordingProposal(seq: number, envelopeId: string, nodeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: OTHER_A,
    payload: {
      proposal: {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: nodeId,
        new_wording: 'new',
      },
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function setEdgeSubstanceProposal(seq: number, envelopeId: string, edgeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: OTHER_A,
    payload: {
      proposal: { kind: 'set-edge-substance', edge_id: edgeId, value: 'agreed' },
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function voteProposalArm(
  seq: number,
  proposalId: string,
  participantId: string,
  choice: 'agree' | 'dispute',
): Event {
  return {
    id: `00000000-0000-4000-8000-${(0xb00 + seq).toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence: seq,
    kind: 'vote',
    actor: participantId,
    payload: {
      target: 'proposal',
      proposal_id: proposalId,
      participant: participantId,
      choice,
      voted_at: '2026-05-25T00:00:00.000Z',
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function voteFacetArm(
  seq: number,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'wording' | 'classification' | 'substance' | 'shape',
  participantId: string,
  choice: 'agree' | 'dispute',
): Event {
  return {
    id: `00000000-0000-4000-8000-${(0xc00 + seq).toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence: seq,
    kind: 'vote',
    actor: participantId,
    payload: {
      target: 'facet',
      entity_kind: entityKind,
      entity_id: entityId,
      facet,
      participant: participantId,
      choice,
      voted_at: '2026-05-25T00:00:00.000Z',
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

describe('projectOtherVotesByFacet', () => {
  it('(a) empty event log → empty map', () => {
    const result = projectOtherVotesByFacet([], SELF);
    expect(result.size).toBe(0);
  });

  it('(b) one proposal + one matching facet-arm vote from a non-self participant → entry under (entityId, facet)', () => {
    const events: Event[] = [
      classifyNodeProposal(1, PROPOSAL_C, NODE_X),
      voteFacetArm(2, 'node', NODE_X, 'classification', OTHER_A, 'agree'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    const perNode = result.get(NODE_X);
    expect(perNode).toBeDefined();
    expect(perNode!.get('classification')).toEqual([{ participantId: OTHER_A, choice: 'agree' }]);
  });

  it('(c) self vote on the same proposal → projection emits NO entry for self', () => {
    const events: Event[] = [
      classifyNodeProposal(1, PROPOSAL_C, NODE_X),
      voteFacetArm(2, 'node', NODE_X, 'classification', SELF, 'agree'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    expect(result.size).toBe(0);
  });

  it('(d) arm-switch agree → dispute → agree by the same participant: last choice, position stable, length 1', () => {
    const events: Event[] = [
      editWordingProposal(1, PROPOSAL_W, NODE_X),
      voteProposalArm(2, PROPOSAL_W, OTHER_A, 'agree'),
      voteProposalArm(3, PROPOSAL_W, OTHER_A, 'dispute'),
      voteProposalArm(4, PROPOSAL_W, OTHER_A, 'agree'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    const perFacet = result.get(NODE_X)!.get('wording');
    expect(perFacet).toEqual([{ participantId: OTHER_A, choice: 'agree' }]);
  });

  it('(e) two participants on the same facet → both appear in arrival order; subsequent switch by the first keeps its position', () => {
    const events: Event[] = [
      editWordingProposal(1, PROPOSAL_W, NODE_X),
      voteProposalArm(2, PROPOSAL_W, OTHER_A, 'agree'),
      voteProposalArm(3, PROPOSAL_W, OTHER_B, 'dispute'),
      voteProposalArm(4, PROPOSAL_W, OTHER_A, 'dispute'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    expect(result.get(NODE_X)!.get('wording')).toEqual([
      { participantId: OTHER_A, choice: 'dispute' },
      { participantId: OTHER_B, choice: 'dispute' },
    ]);
  });

  it('(f) vote arrives BEFORE its referenced proposal → silently dropped', () => {
    const events: Event[] = [
      voteProposalArm(1, PROPOSAL_W, OTHER_A, 'agree'),
      editWordingProposal(2, PROPOSAL_W, NODE_X),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    expect(result.size).toBe(0);
  });

  it('(g) proposal-arm vote on a facet-targeting proposal resolves via proposalTarget lookup to (entityId, facet)', () => {
    const events: Event[] = [
      classifyNodeProposal(1, PROPOSAL_C, NODE_Y),
      voteProposalArm(2, PROPOSAL_C, OTHER_A, 'agree'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    expect(result.get(NODE_Y)!.get('classification')).toEqual([
      { participantId: OTHER_A, choice: 'agree' },
    ]);
  });

  it('(h) vote on an unknown proposal id (proposal-arm) → silently dropped', () => {
    const events: Event[] = [
      voteProposalArm(1, 'ffffffff-ffff-4fff-8fff-ffffffffffff', OTHER_A, 'agree'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    expect(result.size).toBe(0);
  });

  it('(i) edge-substance vote → inserts under the edge id with facet "substance"', () => {
    const events: Event[] = [
      setEdgeSubstanceProposal(1, PROPOSAL_E, EDGE_E),
      voteProposalArm(2, PROPOSAL_E, OTHER_A, 'agree'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    expect(result.get(EDGE_E)!.get('substance')).toEqual([
      { participantId: OTHER_A, choice: 'agree' },
    ]);
  });
});
