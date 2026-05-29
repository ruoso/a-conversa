// Vitest cases for the shell's per-(entity, facet) vote projectors.
//
// Refinement: tasks/refinements/shell-package/extract_votes_by_facet_projector_v2.md
//   (predecessor suites:
//      apps/moderator/src/graph/selectors.test.ts (the eleven cases
//        under `describe('projectVotesByFacet', …)`),
//      apps/participant/src/proposals/otherVotesByFacet.test.ts (the
//        twelve cases under `describe('projectOtherVotesByFacet', …)`).)
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// Two `describe` blocks separate the no-filter form from the self-
// filter variant; the seed-log scaffolding is shared at the top of the
// file. Cases are byte-equivalent to their predecessors after the
// rewire.

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { projectOtherVotesByFacet, projectVotesByFacet } from './votes-by-facet.js';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

// -- Self-filter constants (participant suite) ---------------------------
const SELF = '00000000-0000-4000-8000-00000000000c';
const OTHER_A = '00000000-0000-4000-8000-00000000001a';
const OTHER_B = '00000000-0000-4000-8000-00000000001b';

// -- No-filter constants (moderator suite) -------------------------------
const PROPOSAL_WORDING_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const PROPOSAL_CLASSIFY_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const PROPOSAL_SUBSTANCE_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const PROPOSAL_EDGE_SUBSTANCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const NODE_VOTE_1 = '11111111-1111-4111-8111-111111111111';
const NODE_VOTE_2 = '22222222-2222-4222-8222-222222222222';
const EDGE_VOTE_1 = '33333333-3333-4333-8333-333333333333';
const VOTE_PARTICIPANT_A = '00000000-0000-4000-8000-0000000000a1';
const VOTE_PARTICIPANT_B = '00000000-0000-4000-8000-0000000000a2';

// -- Participant-suite proposal envelope ids -----------------------------
const PART_NODE_X = '00000000-0000-4000-8000-00000000000a';
const PART_NODE_Y = '00000000-0000-4000-8000-00000000000b';
const PART_EDGE_E = '00000000-0000-4000-8000-00000000000e';
const PART_PROPOSAL_W = '00000000-0000-4000-8000-0000000000a1';
const PART_PROPOSAL_C = '00000000-0000-4000-8000-0000000000a2';
const PART_PROPOSAL_E = '00000000-0000-4000-8000-0000000000a3';

function makeClassifyProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION,
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
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function makeEditWordingProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: opts.nodeId,
        new_wording: 'reworded',
      },
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function makeSetNodeSubstanceProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'set-node-substance',
        node_id: opts.nodeId,
        value: 'agreed',
      },
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function makeSetEdgeSubstanceProposal(opts: {
  sequence: number;
  envelopeId: string;
  edgeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'set-edge-substance',
        edge_id: opts.edgeId,
        value: 'agreed',
      },
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function makeVote(opts: {
  sequence: number;
  proposalEnvelopeId: string;
  participantId: string;
  vote: 'agree' | 'dispute';
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0xb00 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence: opts.sequence,
    kind: 'vote',
    actor: opts.participantId,
    payload: {
      target: 'proposal' as const,
      proposal_id: opts.proposalEnvelopeId,
      participant: opts.participantId,
      choice: opts.vote,
      voted_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

// -- Participant-suite helpers (proposal- and facet-arm) -----------------

function partClassifyNodeProposal(seq: number, envelopeId: string, nodeId: string): Event {
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

function partEditWordingProposal(seq: number, envelopeId: string, nodeId: string): Event {
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

function partSetEdgeSubstanceProposal(seq: number, envelopeId: string, edgeId: string): Event {
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

describe('projectVotesByFacet', () => {
  it('returns an empty map for an empty event log', () => {
    const result = projectVotesByFacet([]);
    expect(result.size).toBe(0);
  });

  it('projects a single agree vote onto the right (nodeId, facet) bucket', () => {
    const events: Event[] = [
      makeEditWordingProposal({
        sequence: 1,
        envelopeId: PROPOSAL_WORDING_1,
        nodeId: NODE_VOTE_1,
      }),
      makeVote({
        sequence: 2,
        proposalEnvelopeId: PROPOSAL_WORDING_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
    ];
    const result = projectVotesByFacet(events);
    const perNode = result.get(NODE_VOTE_1);
    expect(perNode).toBeDefined();
    const perFacet = perNode!.get('wording');
    expect(perFacet).toEqual([{ participantId: VOTE_PARTICIPANT_A, choice: 'agree' }]);
  });

  it('latest vote wins when the same participant votes twice (agree → dispute switch)', () => {
    const events: Event[] = [
      makeClassifyProposal({
        sequence: 1,
        envelopeId: PROPOSAL_CLASSIFY_1,
        nodeId: NODE_VOTE_1,
      }),
      makeVote({
        sequence: 2,
        proposalEnvelopeId: PROPOSAL_CLASSIFY_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
      makeVote({
        sequence: 3,
        proposalEnvelopeId: PROPOSAL_CLASSIFY_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'dispute',
      }),
    ];
    const result = projectVotesByFacet(events);
    const perFacet = result.get(NODE_VOTE_1)!.get('classification');
    expect(perFacet).toEqual([{ participantId: VOTE_PARTICIPANT_A, choice: 'dispute' }]);
  });

  it('preserves first-vote arrival order across multiple participants', () => {
    const events: Event[] = [
      makeEditWordingProposal({
        sequence: 1,
        envelopeId: PROPOSAL_WORDING_1,
        nodeId: NODE_VOTE_1,
      }),
      makeVote({
        sequence: 2,
        proposalEnvelopeId: PROPOSAL_WORDING_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
      makeVote({
        sequence: 3,
        proposalEnvelopeId: PROPOSAL_WORDING_1,
        participantId: VOTE_PARTICIPANT_B,
        vote: 'dispute',
      }),
      // A switches arm — should NOT move A to the end of the list.
      makeVote({
        sequence: 4,
        proposalEnvelopeId: PROPOSAL_WORDING_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'dispute',
      }),
    ];
    const result = projectVotesByFacet(events);
    const perFacet = result.get(NODE_VOTE_1)!.get('wording');
    expect(perFacet).toEqual([
      { participantId: VOTE_PARTICIPANT_A, choice: 'dispute' },
      { participantId: VOTE_PARTICIPANT_B, choice: 'dispute' },
    ]);
  });

  it('buckets votes correctly across two facets on the same node', () => {
    const events: Event[] = [
      makeEditWordingProposal({
        sequence: 1,
        envelopeId: PROPOSAL_WORDING_1,
        nodeId: NODE_VOTE_1,
      }),
      makeSetNodeSubstanceProposal({
        sequence: 2,
        envelopeId: PROPOSAL_SUBSTANCE_1,
        nodeId: NODE_VOTE_1,
      }),
      makeVote({
        sequence: 3,
        proposalEnvelopeId: PROPOSAL_WORDING_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
      makeVote({
        sequence: 4,
        proposalEnvelopeId: PROPOSAL_SUBSTANCE_1,
        participantId: VOTE_PARTICIPANT_B,
        vote: 'dispute',
      }),
    ];
    const result = projectVotesByFacet(events);
    const perNode = result.get(NODE_VOTE_1)!;
    expect(perNode.get('wording')).toEqual([
      { participantId: VOTE_PARTICIPANT_A, choice: 'agree' },
    ]);
    expect(perNode.get('substance')).toEqual([
      { participantId: VOTE_PARTICIPANT_B, choice: 'dispute' },
    ]);
  });

  it('buckets votes correctly across two distinct nodes', () => {
    const events: Event[] = [
      makeEditWordingProposal({
        sequence: 1,
        envelopeId: PROPOSAL_WORDING_1,
        nodeId: NODE_VOTE_1,
      }),
      makeEditWordingProposal({
        sequence: 2,
        envelopeId: PROPOSAL_CLASSIFY_1,
        nodeId: NODE_VOTE_2,
      }),
      makeVote({
        sequence: 3,
        proposalEnvelopeId: PROPOSAL_WORDING_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
      makeVote({
        sequence: 4,
        proposalEnvelopeId: PROPOSAL_CLASSIFY_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'dispute',
      }),
    ];
    const result = projectVotesByFacet(events);
    expect(result.get(NODE_VOTE_1)!.get('wording')).toEqual([
      { participantId: VOTE_PARTICIPANT_A, choice: 'agree' },
    ]);
    expect(result.get(NODE_VOTE_2)!.get('wording')).toEqual([
      { participantId: VOTE_PARTICIPANT_A, choice: 'dispute' },
    ]);
  });

  it('silently drops a vote referencing an unknown proposal', () => {
    const events: Event[] = [
      makeVote({
        sequence: 1,
        proposalEnvelopeId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
    ];
    const result = projectVotesByFacet(events);
    expect(result.size).toBe(0);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_vote_indicators_in_sidebar.md
  // Decision §4 — the projection now buckets `set-edge-substance` votes
  // under the edge id (alongside the existing node-keyed buckets). The
  // outer-map key is `entityId` (node UUID OR edge UUID — disjoint
  // keyspaces). The graph consumer (which only ever looks up node ids)
  // is unaffected; the sidebar consumer reads edge buckets via the same
  // lookup.
  it('buckets a vote on a set-edge-substance proposal under the edge id', () => {
    const events: Event[] = [
      makeSetEdgeSubstanceProposal({
        sequence: 1,
        envelopeId: PROPOSAL_EDGE_SUBSTANCE,
        edgeId: EDGE_VOTE_1,
      }),
      makeVote({
        sequence: 2,
        proposalEnvelopeId: PROPOSAL_EDGE_SUBSTANCE,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
    ];
    const result = projectVotesByFacet(events);
    const perEdge = result.get(EDGE_VOTE_1);
    expect(perEdge).toBeDefined();
    expect(perEdge!.get('substance')).toEqual([
      { participantId: VOTE_PARTICIPANT_A, choice: 'agree' },
    ]);
  });

  it('node-keyed and edge-keyed buckets coexist without interference', () => {
    const events: Event[] = [
      makeSetNodeSubstanceProposal({
        sequence: 1,
        envelopeId: PROPOSAL_SUBSTANCE_1,
        nodeId: NODE_VOTE_1,
      }),
      makeSetEdgeSubstanceProposal({
        sequence: 2,
        envelopeId: PROPOSAL_EDGE_SUBSTANCE,
        edgeId: EDGE_VOTE_1,
      }),
      makeVote({
        sequence: 3,
        proposalEnvelopeId: PROPOSAL_SUBSTANCE_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
      makeVote({
        sequence: 4,
        proposalEnvelopeId: PROPOSAL_EDGE_SUBSTANCE,
        participantId: VOTE_PARTICIPANT_B,
        vote: 'dispute',
      }),
    ];
    const result = projectVotesByFacet(events);
    expect(result.get(NODE_VOTE_1)!.get('substance')).toEqual([
      { participantId: VOTE_PARTICIPANT_A, choice: 'agree' },
    ]);
    expect(result.get(EDGE_VOTE_1)!.get('substance')).toEqual([
      { participantId: VOTE_PARTICIPANT_B, choice: 'dispute' },
    ]);
  });

  // Refinement: tasks/refinements/data-and-methodology/align_vote_facet_target_vocabulary.md
  // Decision §2 — `amend-node` is structural (proposal-keyed). Its
  // votes arrive on the `target: 'proposal'` arm and resolve to the
  // dispatcher's `null` return, so the projection produces NO entry in
  // the per-(entity, facet) bucket.
  it('does NOT bucket an amend-node proposal-arm vote (amend-node is structural)', () => {
    const events: Event[] = [
      {
        id: PROPOSAL_WORDING_1,
        sessionId: SESSION,
        sequence: 1,
        kind: 'proposal',
        actor: ACTOR,
        payload: {
          proposal: {
            kind: 'amend-node',
            node_id: NODE_VOTE_1,
            new_content: 'amended wording',
          },
        },
        createdAt: '2026-05-28T00:00:00.000Z',
      },
      makeVote({
        sequence: 2,
        proposalEnvelopeId: PROPOSAL_WORDING_1,
        participantId: VOTE_PARTICIPANT_A,
        vote: 'agree',
      }),
    ];
    const result = projectVotesByFacet(events);
    expect(result.size).toBe(0);
  });

  // Refinement: tasks/refinements/data-and-methodology/align_vote_facet_target_vocabulary.md
  // Decision §3 — `capture-node` is voteless at the proposal arm per
  // the schema commentary at `packages/shared-types/src/events/proposals.ts:111-116`.
  // The post-capture wording vote arrives on the `target: 'facet'` arm
  // and reaches the `(node, wording)` bucket via the facet-arm branch
  // WITHOUT consulting the dispatcher.
  it('buckets a capture-node wording vote that arrives via the facet arm', () => {
    const CAPTURED_NODE = '44444444-4444-4444-8444-444444444444';
    const CAPTURE_PROPOSAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
    const events: Event[] = [
      {
        id: '00000000-0000-4000-8000-000000000c01',
        sessionId: SESSION,
        sequence: 1,
        kind: 'node-created',
        actor: ACTOR,
        payload: {
          node_id: CAPTURED_NODE,
          wording: 'captured node wording',
          created_by: ACTOR,
          created_at: '2026-05-28T00:00:00.000Z',
        },
        createdAt: '2026-05-28T00:00:00.000Z',
      },
      {
        id: CAPTURE_PROPOSAL,
        sessionId: SESSION,
        sequence: 2,
        kind: 'proposal',
        actor: ACTOR,
        payload: {
          proposal: {
            kind: 'capture-node',
            node_id: CAPTURED_NODE,
            wording: 'captured node wording',
          },
        },
        createdAt: '2026-05-28T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000c02',
        sessionId: SESSION,
        sequence: 3,
        kind: 'vote',
        actor: VOTE_PARTICIPANT_A,
        payload: {
          target: 'facet' as const,
          entity_kind: 'node' as const,
          entity_id: CAPTURED_NODE,
          facet: 'wording',
          participant: VOTE_PARTICIPANT_A,
          choice: 'agree' as const,
          voted_at: '2026-05-28T00:00:00.000Z',
        },
        createdAt: '2026-05-28T00:00:00.000Z',
      },
    ];
    const result = projectVotesByFacet(events);
    expect(result.get(CAPTURED_NODE)!.get('wording')).toEqual([
      { participantId: VOTE_PARTICIPANT_A, choice: 'agree' },
    ]);
  });
});

describe('projectOtherVotesByFacet', () => {
  it('(a) empty event log → empty map', () => {
    const result = projectOtherVotesByFacet([], SELF);
    expect(result.size).toBe(0);
  });

  it('(b) one proposal + one matching facet-arm vote from a non-self participant → entry under (entityId, facet)', () => {
    const events: Event[] = [
      partClassifyNodeProposal(1, PART_PROPOSAL_C, PART_NODE_X),
      voteFacetArm(2, 'node', PART_NODE_X, 'classification', OTHER_A, 'agree'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    const perNode = result.get(PART_NODE_X);
    expect(perNode).toBeDefined();
    expect(perNode!.get('classification')).toEqual([{ participantId: OTHER_A, choice: 'agree' }]);
  });

  it('(c) self vote on the same proposal → projection emits NO entry for self', () => {
    const events: Event[] = [
      partClassifyNodeProposal(1, PART_PROPOSAL_C, PART_NODE_X),
      voteFacetArm(2, 'node', PART_NODE_X, 'classification', SELF, 'agree'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    expect(result.size).toBe(0);
  });

  it('(d) arm-switch agree → dispute → agree by the same participant: last choice, position stable, length 1', () => {
    const events: Event[] = [
      partEditWordingProposal(1, PART_PROPOSAL_W, PART_NODE_X),
      voteProposalArm(2, PART_PROPOSAL_W, OTHER_A, 'agree'),
      voteProposalArm(3, PART_PROPOSAL_W, OTHER_A, 'dispute'),
      voteProposalArm(4, PART_PROPOSAL_W, OTHER_A, 'agree'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    const perFacet = result.get(PART_NODE_X)!.get('wording');
    expect(perFacet).toEqual([{ participantId: OTHER_A, choice: 'agree' }]);
  });

  it('(e) two participants on the same facet → both appear in arrival order; subsequent switch by the first keeps its position', () => {
    const events: Event[] = [
      partEditWordingProposal(1, PART_PROPOSAL_W, PART_NODE_X),
      voteProposalArm(2, PART_PROPOSAL_W, OTHER_A, 'agree'),
      voteProposalArm(3, PART_PROPOSAL_W, OTHER_B, 'dispute'),
      voteProposalArm(4, PART_PROPOSAL_W, OTHER_A, 'dispute'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    expect(result.get(PART_NODE_X)!.get('wording')).toEqual([
      { participantId: OTHER_A, choice: 'dispute' },
      { participantId: OTHER_B, choice: 'dispute' },
    ]);
  });

  it('(f) vote arrives BEFORE its referenced proposal → silently dropped', () => {
    const events: Event[] = [
      voteProposalArm(1, PART_PROPOSAL_W, OTHER_A, 'agree'),
      partEditWordingProposal(2, PART_PROPOSAL_W, PART_NODE_X),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    expect(result.size).toBe(0);
  });

  it('(g) proposal-arm vote on a facet-targeting proposal resolves via proposalTarget lookup to (entityId, facet)', () => {
    const events: Event[] = [
      partClassifyNodeProposal(1, PART_PROPOSAL_C, PART_NODE_Y),
      voteProposalArm(2, PART_PROPOSAL_C, OTHER_A, 'agree'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    expect(result.get(PART_NODE_Y)!.get('classification')).toEqual([
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
      partSetEdgeSubstanceProposal(1, PART_PROPOSAL_E, PART_EDGE_E),
      voteProposalArm(2, PART_PROPOSAL_E, OTHER_A, 'agree'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    expect(result.get(PART_EDGE_E)!.get('substance')).toEqual([
      { participantId: OTHER_A, choice: 'agree' },
    ]);
  });

  // Refinement: tasks/refinements/data-and-methodology/align_vote_facet_target_vocabulary.md
  // Decision §2 — `amend-node` is structural (proposal-keyed).
  it('(j) amend-node proposal-arm vote from a non-self participant → no facet entry (structural)', () => {
    const PROPOSAL_AMEND = '00000000-0000-4000-8000-0000000000a4';
    const events: Event[] = [
      {
        id: PROPOSAL_AMEND,
        sessionId: SESSION,
        sequence: 1,
        kind: 'proposal',
        actor: OTHER_A,
        payload: {
          proposal: {
            kind: 'amend-node',
            node_id: PART_NODE_X,
            new_content: 'amended wording',
          },
        },
        createdAt: '2026-05-28T00:00:00.000Z',
      },
      voteProposalArm(2, PROPOSAL_AMEND, OTHER_A, 'agree'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    expect(result.size).toBe(0);
  });

  // Refinement: tasks/refinements/data-and-methodology/align_vote_facet_target_vocabulary.md
  // Decision §3 — `capture-node` is voteless at the proposal arm. Synthetic
  // event pins the dispatcher's null-return + the projector's silent-drop
  // behavior.
  it("(k) capture-node proposal-arm vote (synthetic; shouldn't happen in prod) → no facet entry", () => {
    const PROPOSAL_CAPTURE = '00000000-0000-4000-8000-0000000000a5';
    const events: Event[] = [
      {
        id: PROPOSAL_CAPTURE,
        sessionId: SESSION,
        sequence: 1,
        kind: 'proposal',
        actor: OTHER_A,
        payload: {
          proposal: {
            kind: 'capture-node',
            node_id: PART_NODE_X,
            wording: 'captured node wording',
          },
        },
        createdAt: '2026-05-28T00:00:00.000Z',
      },
      voteProposalArm(2, PROPOSAL_CAPTURE, OTHER_A, 'agree'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    expect(result.size).toBe(0);
  });

  // Refinement: tasks/refinements/data-and-methodology/align_vote_facet_target_vocabulary.md
  // Decision §3 — post-capture wording votes arrive on the `target:
  // 'facet'` arm and reach the `(node, wording)` bucket via the
  // facet-arm branch WITHOUT consulting the dispatcher.
  it('(l) capture-node + facet-arm wording vote from a non-self participant → (node, wording) bucket', () => {
    const PROPOSAL_CAPTURE = '00000000-0000-4000-8000-0000000000a6';
    const events: Event[] = [
      {
        id: '00000000-0000-4000-8000-0000000000d1',
        sessionId: SESSION,
        sequence: 1,
        kind: 'node-created',
        actor: OTHER_A,
        payload: {
          node_id: PART_NODE_X,
          wording: 'captured node wording',
          created_by: OTHER_A,
          created_at: '2026-05-28T00:00:00.000Z',
        },
        createdAt: '2026-05-28T00:00:00.000Z',
      },
      {
        id: PROPOSAL_CAPTURE,
        sessionId: SESSION,
        sequence: 2,
        kind: 'proposal',
        actor: OTHER_A,
        payload: {
          proposal: {
            kind: 'capture-node',
            node_id: PART_NODE_X,
            wording: 'captured node wording',
          },
        },
        createdAt: '2026-05-28T00:00:00.000Z',
      },
      voteFacetArm(3, 'node', PART_NODE_X, 'wording', OTHER_A, 'agree'),
    ];
    const result = projectOtherVotesByFacet(events, SELF);
    expect(result.get(PART_NODE_X)!.get('wording')).toEqual([
      { participantId: OTHER_A, choice: 'agree' },
    ]);
  });
});
