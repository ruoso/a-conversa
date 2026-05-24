// Vitest cases for `otherVotes.ts` — per-entity OTHER-participants
// vote projection narrowed to NOT the current participant.
//
// Refinement: tasks/refinements/participant-ui/part_other_vote_indicators.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in (mirroring `ownVotes.test.ts`'s coverage shape so a
// reader cross-referencing the two projections sees the same pin,
// narrowed to the inverse filter direction + the per-voter list shape):
//
//   1. `projectOtherVotes` over an empty event log returns the stable
//      `EMPTY_OTHERS_VOTES` reference.
//   2. A `classify-node` proposal + matching `agree` vote by an OTHER
//      participant lands as `index.nodes.get(nodeId)` → one-element
//      list with that voter at choice `'agree'`.
//   3. The same vote by the CURRENT participant is silently dropped
//      (the per-participant filter contract).
//   4. A `set-edge-substance` proposal + matching `dispute` vote by an
//      other participant lands on the edge bucket (symmetric across
//      node AND edge targets per Decision §1).
//   5. Latest-vote-wins on a same-(other-)participant retake (agree →
//      dispute keeps ONE entry with `dispute`; insertion-position
//      preserved per Decision §5).
//   6. (Retired by `pf_unit_test_audit` per ADR 0030 §3 — the legacy
//      `'withdraw'` vote-choice arm is gone; withdrawal is its own
//      first-class event kind, surfaced via the facet-status projection.)
//   7. Two facets on the same entity by the same other voter — one
//      `'agree'` + one `'dispute'` — rolls up to a single entry with
//      `'dispute'` (dispute-wins tie-break per Decision §1).
//   8. Two distinct other voters on the same entity surface in
//      first-vote-arrival insertion-order per Decision §5.
//   9. A vote referencing an unknown proposal id is silently dropped.
//  10. `otherVotesForNode` / `otherVotesForEdge` return
//      `EMPTY_OTHER_VOTES_LIST` for unknown ids.
//  11. The projection is pure (same input twice yields deep-equal
//      results).
//  12. The empty-bailout fires when every vote was filtered out (only
//      the current participant voted) — confirms the bailout doesn't
//      only fire on the raw-events-empty branch.

import { describe, expect, it } from 'vitest';
import type { Event, StatementKind } from '@a-conversa/shared-types';

import {
  EMPTY_OTHER_VOTES_LIST,
  EMPTY_OTHERS_VOTES,
  otherVotesForEdge,
  otherVotesForNode,
  projectOtherVotes,
} from './otherVotes';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const EDGE_A = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_CLASSIFY = '00000000-0000-4000-8000-0000000000c1';
const PROPOSAL_SUBSTANCE_NODE = '00000000-0000-4000-8000-0000000000c2';
const PROPOSAL_WORDING = '00000000-0000-4000-8000-0000000000c3';
const PROPOSAL_EDGE_SUBSTANCE = '00000000-0000-4000-8000-0000000000c4';
const ME = '00000000-0000-4000-8000-0000000000aa';
const VOTER_X = '00000000-0000-4000-8000-0000000000bb';
const VOTER_Y = '00000000-0000-4000-8000-0000000000cc';

function classifyProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
  classification?: StatementKind;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ME,
    payload: {
      proposal: {
        kind: 'classify-node',
        node_id: opts.nodeId,
        classification: opts.classification ?? 'fact',
      },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function setNodeSubstanceProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ME,
    payload: {
      proposal: {
        kind: 'set-node-substance',
        node_id: opts.nodeId,
        value: 'agreed',
      },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function editWordingProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ME,
    payload: {
      proposal: {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: opts.nodeId,
        new_wording: 'A revised wording',
      },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function setEdgeSubstanceProposal(opts: {
  sequence: number;
  envelopeId: string;
  edgeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ME,
    payload: {
      proposal: {
        kind: 'set-edge-substance',
        edge_id: opts.edgeId,
        value: 'agreed',
      },
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function voteEvent(opts: {
  sequence: number;
  proposalId: string;
  participant: string;
  vote: 'agree' | 'dispute';
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x500 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'vote',
    actor: opts.participant,
    payload: {
      target: 'proposal' as const,
      proposal_id: opts.proposalId,
      participant: opts.participant,
      choice: opts.vote,
      voted_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

describe('projectOtherVotes — per-entity per-OTHER-voter projection narrowed to NOT the current participant', () => {
  it('(a) returns EMPTY_OTHERS_VOTES (stable reference) for an empty event log', () => {
    const out = projectOtherVotes([], ME);
    expect(out).toBe(EMPTY_OTHERS_VOTES);
  });

  it('(b) records an "agree" vote by an OTHER participant on a classify-node proposal as a per-entity entry on the targeted node', () => {
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: VOTER_X,
        vote: 'agree',
      }),
    ];
    const out = projectOtherVotes(events, ME);
    const list = out.nodes.get(NODE_A);
    expect(list).toBeDefined();
    expect(list).toEqual([{ participantId: VOTER_X, choice: 'agree' }]);
    expect(out.edges.size).toBe(0);
  });

  it('(c) silently drops a vote by THE CURRENT participant — the per-participant filter contract', () => {
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: ME,
        vote: 'agree',
      }),
    ];
    const out = projectOtherVotes(events, ME);
    // No other-vote on NODE_A — only the current participant voted.
    expect(out.nodes.get(NODE_A)).toBeUndefined();
    // The presence-helper returns the stable empty-list reference.
    expect(otherVotesForNode(out, NODE_A)).toBe(EMPTY_OTHER_VOTES_LIST);
  });

  it('(d) records a "dispute" vote by an OTHER participant on a set-edge-substance proposal as a per-entity entry on the targeted edge', () => {
    const events: Event[] = [
      setEdgeSubstanceProposal({
        sequence: 1,
        envelopeId: PROPOSAL_EDGE_SUBSTANCE,
        edgeId: EDGE_A,
      }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_EDGE_SUBSTANCE,
        participant: VOTER_X,
        vote: 'dispute',
      }),
    ];
    const out = projectOtherVotes(events, ME);
    expect(out.edges.get(EDGE_A)).toEqual([{ participantId: VOTER_X, choice: 'dispute' }]);
    expect(out.nodes.size).toBe(0);
  });

  it('(e) latest-vote-wins on a same-(other-)participant retake (agree → dispute keeps ONE entry with dispute; original position preserved)', () => {
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      // Voter X votes agree first, then voter Y votes agree, then
      // voter X retakes to dispute. The retake MUST stay at index 0
      // (first-vote-arrival per Decision §5).
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: VOTER_X,
        vote: 'agree',
      }),
      voteEvent({
        sequence: 3,
        proposalId: PROPOSAL_CLASSIFY,
        participant: VOTER_Y,
        vote: 'agree',
      }),
      voteEvent({
        sequence: 4,
        proposalId: PROPOSAL_CLASSIFY,
        participant: VOTER_X,
        vote: 'dispute',
      }),
    ];
    const out = projectOtherVotes(events, ME);
    const list = out.nodes.get(NODE_A);
    expect(list).toEqual([
      { participantId: VOTER_X, choice: 'dispute' },
      { participantId: VOTER_Y, choice: 'agree' },
    ]);
  });

  // Test (f) — the `'withdraw'` vote-choice arm removing a voter from
  // the per-entity list — was deleted by `pf_unit_test_audit`. Per ADR
  // 0030 §3 + `pf_facet_keyed_vote_payload` the wire enum collapsed to
  // `'agree' | 'dispute'` (Zod hard-rejects `'withdraw'` on inbound
  // validation); withdrawal is its own first-class event kind
  // (`withdraw-agreement`) that this projector silently drops today.
  // A future `part_withdraw_indicator` task closes the indicator
  // hand-off with the new event kind.

  it('(g) two facets on the same entity — one agree + one dispute by the same other voter — rolls up to "dispute" (dispute-wins per Decision §1)', () => {
    const events: Event[] = [
      // Two distinct facet-targeting proposals on the same node:
      // classify-node (classification facet) + edit-wording (wording
      // facet).
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      editWordingProposal({ sequence: 2, envelopeId: PROPOSAL_WORDING, nodeId: NODE_A }),
      // VOTER_X: agree on the classification facet.
      voteEvent({
        sequence: 3,
        proposalId: PROPOSAL_CLASSIFY,
        participant: VOTER_X,
        vote: 'agree',
      }),
      // VOTER_X: dispute on the wording facet.
      voteEvent({
        sequence: 4,
        proposalId: PROPOSAL_WORDING,
        participant: VOTER_X,
        vote: 'dispute',
      }),
    ];
    const out = projectOtherVotes(events, ME);
    const list = out.nodes.get(NODE_A);
    // Dispute wins: voter appears once at choice `dispute` despite
    // also having an `agree` arm on the classification facet.
    expect(list).toEqual([{ participantId: VOTER_X, choice: 'dispute' }]);
  });

  it('(h) two distinct other voters on the same entity surface in first-vote-arrival insertion-order per Decision §5', () => {
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      // VOTER_Y votes FIRST so they appear at index 0.
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: VOTER_Y,
        vote: 'agree',
      }),
      // VOTER_X votes second so they appear at index 1.
      voteEvent({
        sequence: 3,
        proposalId: PROPOSAL_CLASSIFY,
        participant: VOTER_X,
        vote: 'dispute',
      }),
    ];
    const out = projectOtherVotes(events, ME);
    const list = out.nodes.get(NODE_A);
    expect(list).toEqual([
      { participantId: VOTER_Y, choice: 'agree' },
      { participantId: VOTER_X, choice: 'dispute' },
    ]);
  });

  it('(i) silently drops a vote referencing an unknown proposal id', () => {
    const UNKNOWN_PROPOSAL = '00000000-0000-4000-8000-0000000000ff';
    const events: Event[] = [
      voteEvent({
        sequence: 1,
        proposalId: UNKNOWN_PROPOSAL,
        participant: VOTER_X,
        vote: 'agree',
      }),
    ];
    const out = projectOtherVotes(events, ME);
    // No proposal seen → no entry, and the returned reference is the
    // stable empty (no-vote-no-entry baseline).
    expect(out).toBe(EMPTY_OTHERS_VOTES);
  });

  it('(j) otherVotesForNode / otherVotesForEdge return EMPTY_OTHER_VOTES_LIST for unknown ids', () => {
    expect(otherVotesForNode(EMPTY_OTHERS_VOTES, 'unknown-node')).toBe(EMPTY_OTHER_VOTES_LIST);
    expect(otherVotesForEdge(EMPTY_OTHERS_VOTES, 'unknown-edge')).toBe(EMPTY_OTHER_VOTES_LIST);
    // And with a non-empty index, unknown ids still return the
    // shared empty-list reference.
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: VOTER_X,
        vote: 'agree',
      }),
    ];
    const out = projectOtherVotes(events, ME);
    expect(otherVotesForNode(out, NODE_B)).toBe(EMPTY_OTHER_VOTES_LIST);
    expect(otherVotesForEdge(out, EDGE_A)).toBe(EMPTY_OTHER_VOTES_LIST);
    // ...while the targeted node returns the right per-voter list.
    expect(otherVotesForNode(out, NODE_A)).toEqual([{ participantId: VOTER_X, choice: 'agree' }]);
  });

  it('(k) projection is pure (calling twice yields deep-equal results)', () => {
    const events: Event[] = [
      setNodeSubstanceProposal({
        sequence: 1,
        envelopeId: PROPOSAL_SUBSTANCE_NODE,
        nodeId: NODE_A,
      }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_SUBSTANCE_NODE,
        participant: VOTER_X,
        vote: 'agree',
      }),
    ];
    const out1 = projectOtherVotes(events, ME);
    const out2 = projectOtherVotes(events, ME);
    expect(out1.nodes.get(NODE_A)).toEqual([{ participantId: VOTER_X, choice: 'agree' }]);
    expect(out2.nodes.get(NODE_A)).toEqual([{ participantId: VOTER_X, choice: 'agree' }]);
    // Stable-empty contract: the no-vote case always returns the same
    // module-scope reference.
    const empty1 = projectOtherVotes([], ME);
    const empty2 = projectOtherVotes([], ME);
    expect(empty1).toBe(EMPTY_OTHERS_VOTES);
    expect(empty2).toBe(EMPTY_OTHERS_VOTES);
  });

  it('(l) returns EMPTY_OTHERS_VOTES when every vote was filtered out (only the current participant voted) — the empty-bailout fires post-filter', () => {
    // Confirms the bailout doesn't only fire on the raw-events-empty
    // branch — a non-empty event log with no other-participant votes
    // also collapses to the stable empty (the per-participant filter
    // drops every vote; no entry survives).
    const noOtherVotes: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: ME,
        vote: 'agree',
      }),
    ];
    expect(projectOtherVotes(noOtherVotes, ME)).toBe(EMPTY_OTHERS_VOTES);
  });
});
