// Vitest cases for `projectOtherVotesByProposal`.
//
// Refinement: tasks/refinements/participant-ui/part_vote_indicators_in_pane.md
//
// Per ADR 0022 these are committed Vitest cases.

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { projectOtherVotesByProposal } from './otherVotesByProposal';

const SESSION = '00000000-0000-4000-8000-0000000000aa';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const PROPOSAL_D = '00000000-0000-4000-8000-0000000000a4';
const SELF = '00000000-0000-4000-8000-00000000000c';
const OTHER_A = '00000000-0000-4000-8000-00000000001a';
const OTHER_B = '00000000-0000-4000-8000-00000000001b';

function decomposeProposal(seq: number, envelopeId: string, parentNodeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: OTHER_A,
    payload: {
      proposal: {
        kind: 'decompose',
        parent_node_id: parentNodeId,
        components: [
          {
            wording: 'first',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-00000000f041',
          },
          {
            wording: 'second',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-00000000f042',
          },
        ],
      },
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

describe('projectOtherVotesByProposal', () => {
  it('(a) empty event log → empty map', () => {
    const result = projectOtherVotesByProposal([], SELF);
    expect(result.size).toBe(0);
  });

  it('(b) structural proposal + non-self proposal-arm vote → entry at Map.get(proposalId)', () => {
    const events: Event[] = [
      decomposeProposal(1, PROPOSAL_D, NODE_X),
      voteProposalArm(2, PROPOSAL_D, OTHER_A, 'agree'),
    ];
    const result = projectOtherVotesByProposal(events, SELF);
    expect(result.get(PROPOSAL_D)).toEqual([{ participantId: OTHER_A, choice: 'agree' }]);
  });

  it('(c) self vote on the same structural proposal → projection emits NO entry for self', () => {
    const events: Event[] = [
      decomposeProposal(1, PROPOSAL_D, NODE_X),
      voteProposalArm(2, PROPOSAL_D, SELF, 'agree'),
    ];
    const result = projectOtherVotesByProposal(events, SELF);
    expect(result.size).toBe(0);
  });

  it('(d) facet-arm vote → silently ignored (this projection is proposal-arm only)', () => {
    const events: Event[] = [
      decomposeProposal(1, PROPOSAL_D, NODE_X),
      voteFacetArm(2, 'node', NODE_X, 'wording', OTHER_A, 'agree'),
    ];
    const result = projectOtherVotesByProposal(events, SELF);
    expect(result.size).toBe(0);
  });

  it('(e) arm-switch by same participant → last-write-wins; position stable in the array', () => {
    const events: Event[] = [
      decomposeProposal(1, PROPOSAL_D, NODE_X),
      voteProposalArm(2, PROPOSAL_D, OTHER_A, 'agree'),
      voteProposalArm(3, PROPOSAL_D, OTHER_B, 'dispute'),
      voteProposalArm(4, PROPOSAL_D, OTHER_A, 'dispute'),
    ];
    const result = projectOtherVotesByProposal(events, SELF);
    expect(result.get(PROPOSAL_D)).toEqual([
      { participantId: OTHER_A, choice: 'dispute' },
      { participantId: OTHER_B, choice: 'dispute' },
    ]);
  });
});
