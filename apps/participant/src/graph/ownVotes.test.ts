// Vitest cases for `ownVotes.ts` — per-entity own-vote projection
// narrowed to the current participant.
//
// Refinement: tasks/refinements/participant-ui/part_own_vote_indicators.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in (mirroring the moderator's `projectVotesByFacet` test
// coverage shape so a reader cross-referencing the two ports sees the
// same pin, narrowed to the participant's single-participant filter):
//
//   1. `projectOwnVotes` over an empty event log returns the stable
//      `EMPTY_OWN_VOTES` reference.
//   2. A `classify-node` proposal + matching `agree` vote by the current
//      participant lands as `{ nodes: { [nodeId]: 'agree' } }`.
//   3. A vote by NOT the current participant is silently dropped (the
//      per-participant filter contract).
//   4. A `set-edge-substance` proposal + matching `dispute` vote lands
//      as `{ edges: { [edgeId]: 'dispute' } }` (symmetric across node
//      AND edge targets per Decision §1).
//   5. Latest-vote-wins on a same-participant retake.
//   6. A `withdraw-agreement` event is silently dropped by the
//      vote-only projector (no `case 'withdraw-agreement'` in the
//      walker) — the prior `'agree'` indicator persists; the
//      explicit "I withdrew" detail belongs in the future
//      `part_withdraw_indicator` polish leaf.
//   7. Two facets on the same entity — one `'agree'` + one `'dispute'`
//      by the current participant — rolls up to `'dispute'` per
//      Decision §1's dispute-wins tie-break.
//   8. A vote referencing an unknown proposal id is silently dropped.
//   9. `ownVoteForNode` / `ownVoteForEdge` return `'none'` for unknown
//      ids.
//   10. The projection is pure (same input twice yields equal results;
//       the no-vote case returns the stable empty reference).

import { describe, expect, it } from 'vitest';
import type { Event, StatementKind } from '@a-conversa/shared-types';

import {
  EMPTY_OWN_FACET_VOTES,
  EMPTY_OWN_VOTES,
  ownFacetKey,
  ownVoteForEdge,
  ownVoteForNode,
  projectOwnFacetVotes,
  projectOwnVotes,
} from './ownVotes';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const EDGE_A = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_CLASSIFY = '00000000-0000-4000-8000-0000000000c1';
const PROPOSAL_SUBSTANCE_NODE = '00000000-0000-4000-8000-0000000000c2';
const PROPOSAL_WORDING = '00000000-0000-4000-8000-0000000000c3';
const PROPOSAL_EDGE_SUBSTANCE = '00000000-0000-4000-8000-0000000000c4';
const ME = '00000000-0000-4000-8000-0000000000aa';
const SOMEONE_ELSE = '00000000-0000-4000-8000-0000000000bb';

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

describe('projectOwnVotes — per-entity own-vote projection narrowed to the current participant', () => {
  it('(a) returns EMPTY_OWN_VOTES (stable reference) for an empty event log', () => {
    const out = projectOwnVotes([], ME);
    expect(out).toBe(EMPTY_OWN_VOTES);
  });

  it('(b) records an "agree" vote by the current participant on a classify-node proposal as an own-vote on the targeted node', () => {
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: ME,
        vote: 'agree',
      }),
    ];
    const out = projectOwnVotes(events, ME);
    expect(out.nodes.get(NODE_A)).toBe('agree');
    expect(out.edges.size).toBe(0);
  });

  it('(c) silently drops a vote by NOT the current participant — the per-participant filter contract', () => {
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: SOMEONE_ELSE,
        vote: 'agree',
      }),
    ];
    const out = projectOwnVotes(events, ME);
    // No own-vote on NODE_A — only the other participant voted.
    expect(out.nodes.get(NODE_A)).toBeUndefined();
    // And the presence-helper returns 'none' for the missing entry.
    expect(ownVoteForNode(out, NODE_A)).toBe('none');
  });

  it('(d) records a "dispute" vote by the current participant on a set-edge-substance proposal as an own-vote on the targeted edge', () => {
    const events: Event[] = [
      setEdgeSubstanceProposal({
        sequence: 1,
        envelopeId: PROPOSAL_EDGE_SUBSTANCE,
        edgeId: EDGE_A,
      }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_EDGE_SUBSTANCE,
        participant: ME,
        vote: 'dispute',
      }),
    ];
    const out = projectOwnVotes(events, ME);
    expect(out.edges.get(EDGE_A)).toBe('dispute');
    expect(out.nodes.size).toBe(0);
  });

  it('(e) latest-vote-wins on a same-participant retake (agree then dispute → dispute)', () => {
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: ME,
        vote: 'agree',
      }),
      voteEvent({
        sequence: 3,
        proposalId: PROPOSAL_CLASSIFY,
        participant: ME,
        vote: 'dispute',
      }),
    ];
    const out = projectOwnVotes(events, ME);
    expect(out.nodes.get(NODE_A)).toBe('dispute');
  });

  // Per ADR 0030 §3 + `pf_withdraw_agreement_handler`: the
  // `'withdraw'` arm is no longer carried on the `vote` event's
  // `choice` enum — withdrawal is its own `withdraw-agreement` event
  // kind. The own-vote projector today silently drops the new event
  // kind (it isn't a `'vote'`). The at-a-glance "I voted agree on
  // this" indicator therefore STAYS `'agree'` after a withdrawal —
  // the explicit "I withdrew" detail belongs in the future
  // `part_withdraw_indicator` polish leaf that introduces a separate
  // sentinel. This test pins today's behavior: a `withdraw-agreement`
  // event landing on the log does NOT clear the participant's prior
  // `'agree'` indicator (the projector is vote-only).
  it('(f) a withdraw-agreement event does not clear the prior agree indicator (own-vote projector is vote-only — see future part_withdraw_indicator)', () => {
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: ME,
        vote: 'agree',
      }),
      // The new event kind — distinct from `'vote'`. The projector
      // silently passes over it (no `case 'withdraw-agreement'` in
      // the walker), so the prior `'agree'` indicator persists.
      {
        id: '00000000-0000-4000-8000-0000000005ff',
        sessionId: SESSION_ID,
        sequence: 3,
        kind: 'withdraw-agreement',
        actor: ME,
        payload: {
          entity_kind: 'node',
          entity_id: NODE_A,
          facet: 'classification',
          participant: ME,
          withdrawn_at: '2026-05-17T00:00:00.000Z',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    ];
    const out = projectOwnVotes(events, ME);
    expect(out.nodes.get(NODE_A)).toBe('agree');
    expect(ownVoteForNode(out, NODE_A)).toBe('agree');
  });

  it('(g) two facets on the same entity — one agree + one dispute — rolls up to "dispute" (dispute-wins tie-break per Decision §1)', () => {
    const events: Event[] = [
      // Two distinct facet-targeting proposals on the same node:
      // classify-node (classification facet) + edit-wording (wording
      // facet).
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      editWordingProposal({ sequence: 2, envelopeId: PROPOSAL_WORDING, nodeId: NODE_A }),
      // Agree on the classification facet.
      voteEvent({
        sequence: 3,
        proposalId: PROPOSAL_CLASSIFY,
        participant: ME,
        vote: 'agree',
      }),
      // Dispute on the wording facet.
      voteEvent({
        sequence: 4,
        proposalId: PROPOSAL_WORDING,
        participant: ME,
        vote: 'dispute',
      }),
    ];
    const out = projectOwnVotes(events, ME);
    // Dispute wins: even though one facet vote is 'agree', the rollup
    // is 'dispute' because the participant is contesting one facet.
    expect(out.nodes.get(NODE_A)).toBe('dispute');
  });

  it('(h) silently drops a vote referencing an unknown proposal id', () => {
    const UNKNOWN_PROPOSAL = '00000000-0000-4000-8000-0000000000ff';
    const events: Event[] = [
      voteEvent({
        sequence: 1,
        proposalId: UNKNOWN_PROPOSAL,
        participant: ME,
        vote: 'agree',
      }),
    ];
    const out = projectOwnVotes(events, ME);
    // No proposal seen → no entry, and the returned reference is the
    // stable empty (no-vote-no-entry baseline).
    expect(out).toBe(EMPTY_OWN_VOTES);
  });

  it('(i) ownVoteForNode / ownVoteForEdge return "none" for unknown ids', () => {
    expect(ownVoteForNode(EMPTY_OWN_VOTES, 'unknown-node')).toBe('none');
    expect(ownVoteForEdge(EMPTY_OWN_VOTES, 'unknown-edge')).toBe('none');
    // And with a non-empty index, unknown ids still return 'none'.
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: ME,
        vote: 'agree',
      }),
    ];
    const out = projectOwnVotes(events, ME);
    expect(ownVoteForNode(out, NODE_B)).toBe('none');
    expect(ownVoteForEdge(out, EDGE_A)).toBe('none');
    // ...while the targeted node returns the right arm.
    expect(ownVoteForNode(out, NODE_A)).toBe('agree');
  });

  it('(j) projection is pure (calling twice yields deep-equal results; the no-vote case returns the stable empty reference)', () => {
    // Pure-function shape: same input twice, equal output.
    const events: Event[] = [
      setNodeSubstanceProposal({
        sequence: 1,
        envelopeId: PROPOSAL_SUBSTANCE_NODE,
        nodeId: NODE_A,
      }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_SUBSTANCE_NODE,
        participant: ME,
        vote: 'agree',
      }),
    ];
    const out1 = projectOwnVotes(events, ME);
    const out2 = projectOwnVotes(events, ME);
    expect(out1.nodes.get(NODE_A)).toBe('agree');
    expect(out2.nodes.get(NODE_A)).toBe('agree');
    // Stable-empty contract: the no-vote case always returns the same
    // module-scope reference.
    const empty1 = projectOwnVotes([], ME);
    const empty2 = projectOwnVotes([], ME);
    expect(empty1).toBe(EMPTY_OWN_VOTES);
    expect(empty2).toBe(EMPTY_OWN_VOTES);
    // A non-empty event log with no current-participant votes also
    // collapses to the stable empty (the per-participant filter drops
    // every vote; no entry survives).
    const noOwnVotes: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: SOMEONE_ELSE,
        vote: 'agree',
      }),
    ];
    expect(projectOwnVotes(noOwnVotes, ME)).toBe(EMPTY_OWN_VOTES);
  });
});

describe('projectOwnFacetVotes — per-(entity, facet) own-vote indicator with supersession-clears', () => {
  // Distinct from projectOwnVotes: per-facet granularity (not rolled up
  // per entity) AND supersession-clears semantics so the row's vote
  // button can ask "did I vote on the CURRENT candidate" and re-appear
  // when a new candidate lands on the facet.

  it('empty event log returns the stable EMPTY_OWN_FACET_VOTES reference', () => {
    expect(projectOwnFacetVotes([], ME)).toBe(EMPTY_OWN_FACET_VOTES);
  });

  it('records a proposal-keyed agree vote on a classify-node proposal under the (node, classification) facet key', () => {
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: ME,
        vote: 'agree',
      }),
    ];
    const out = projectOwnFacetVotes(events, ME);
    expect(out.facets.get(ownFacetKey('node', NODE_A, 'classification'))).toBe('agree');
    expect(out.proposals.size).toBe(0);
  });

  it('records a facet-keyed agree vote (no proposal_id on the wire) under the same facet key', () => {
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      {
        id: '00000000-0000-4000-8000-000000000601',
        sessionId: SESSION_ID,
        sequence: 2,
        kind: 'vote',
        actor: ME,
        payload: {
          target: 'facet' as const,
          entity_kind: 'node' as const,
          entity_id: NODE_A,
          facet: 'classification' as const,
          participant: ME,
          choice: 'agree' as const,
          voted_at: '2026-05-17T00:00:00.000Z',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    ];
    const out = projectOwnFacetVotes(events, ME);
    expect(out.facets.get(ownFacetKey('node', NODE_A, 'classification'))).toBe('agree');
  });

  it('drops a vote by another participant — per-participant filter', () => {
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: SOMEONE_ELSE,
        vote: 'agree',
      }),
    ];
    const out = projectOwnFacetVotes(events, ME);
    expect(out).toBe(EMPTY_OWN_FACET_VOTES);
  });

  it('supersession-clears: a NEW facet-valued proposal on the same facet clears the prior own-vote (the button must re-appear for the new candidate)', () => {
    const NEW_PROPOSAL = '00000000-0000-4000-8000-0000000000d1';
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: ME,
        vote: 'agree',
      }),
      // A new candidate lands on the same facet; per ADR 0030 §7 the
      // server clears the per-participant vote map and the client
      // mirror must too.
      classifyProposal({
        sequence: 3,
        envelopeId: NEW_PROPOSAL,
        nodeId: NODE_A,
        classification: 'value',
      }),
    ];
    const out = projectOwnFacetVotes(events, ME);
    expect(out.facets.has(ownFacetKey('node', NODE_A, 'classification'))).toBe(false);
  });

  it('does NOT clear other facets when a proposal supersedes one facet only', () => {
    const events: Event[] = [
      // Two proposals on different facets of the same node.
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      setNodeSubstanceProposal({
        sequence: 2,
        envelopeId: PROPOSAL_SUBSTANCE_NODE,
        nodeId: NODE_A,
      }),
      voteEvent({
        sequence: 3,
        proposalId: PROPOSAL_CLASSIFY,
        participant: ME,
        vote: 'agree',
      }),
      voteEvent({
        sequence: 4,
        proposalId: PROPOSAL_SUBSTANCE_NODE,
        participant: ME,
        vote: 'agree',
      }),
      // New classification candidate supersedes — only that facet clears.
      classifyProposal({
        sequence: 5,
        envelopeId: '00000000-0000-4000-8000-0000000000d2',
        nodeId: NODE_A,
        classification: 'value',
      }),
    ];
    const out = projectOwnFacetVotes(events, ME);
    expect(out.facets.has(ownFacetKey('node', NODE_A, 'classification'))).toBe(false);
    expect(out.facets.get(ownFacetKey('node', NODE_A, 'substance'))).toBe('agree');
  });

  it('records a structural proposal vote under `proposals` keyed by the proposal envelope id', () => {
    const STRUCTURAL_PROPOSAL = '00000000-0000-4000-8000-0000000000e1';
    const events: Event[] = [
      {
        id: STRUCTURAL_PROPOSAL,
        sessionId: SESSION_ID,
        sequence: 1,
        kind: 'proposal',
        actor: ME,
        payload: {
          proposal: {
            kind: 'axiom-mark',
            node_id: NODE_A,
            participant: ME,
          },
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      voteEvent({
        sequence: 2,
        proposalId: STRUCTURAL_PROPOSAL,
        participant: ME,
        vote: 'agree',
      }),
    ];
    const out = projectOwnFacetVotes(events, ME);
    expect(out.proposals.get(STRUCTURAL_PROPOSAL)).toBe('agree');
    expect(out.facets.size).toBe(0);
  });

  it('latest-vote-wins on a same-participant retake (e.g. agree then dispute on the same facet)', () => {
    const events: Event[] = [
      classifyProposal({ sequence: 1, envelopeId: PROPOSAL_CLASSIFY, nodeId: NODE_A }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_CLASSIFY,
        participant: ME,
        vote: 'agree',
      }),
      voteEvent({
        sequence: 3,
        proposalId: PROPOSAL_CLASSIFY,
        participant: ME,
        vote: 'dispute',
      }),
    ];
    const out = projectOwnFacetVotes(events, ME);
    expect(out.facets.get(ownFacetKey('node', NODE_A, 'classification'))).toBe('dispute');
  });

  it('edge facet target: a set-edge-substance vote records under (edge, substance)', () => {
    const events: Event[] = [
      setEdgeSubstanceProposal({
        sequence: 1,
        envelopeId: PROPOSAL_EDGE_SUBSTANCE,
        edgeId: EDGE_A,
      }),
      voteEvent({
        sequence: 2,
        proposalId: PROPOSAL_EDGE_SUBSTANCE,
        participant: ME,
        vote: 'agree',
      }),
    ];
    const out = projectOwnFacetVotes(events, ME);
    expect(out.facets.get(ownFacetKey('edge', EDGE_A, 'substance'))).toBe('agree');
  });

  it('vote referencing an unknown proposal id is silently dropped', () => {
    const events: Event[] = [
      voteEvent({
        sequence: 1,
        proposalId: '00000000-0000-4000-8000-0000000000ee',
        participant: ME,
        vote: 'agree',
      }),
    ];
    const out = projectOwnFacetVotes(events, ME);
    expect(out).toBe(EMPTY_OWN_FACET_VOTES);
  });

  // Per `pf_part_facet_name_widen_shape`: the local `FacetName` mirror
  // is now 4-valued; a shape-facet own vote lands in the index alongside
  // the other three facets (no skip guard).
  it('records a facet-keyed agree vote on (edge, shape) under the (edge, shape) facet key', () => {
    const events: Event[] = [
      {
        id: '00000000-0000-4000-8000-000000000701',
        sessionId: SESSION_ID,
        sequence: 1,
        kind: 'vote',
        actor: ME,
        payload: {
          target: 'facet' as const,
          entity_kind: 'edge' as const,
          entity_id: EDGE_A,
          facet: 'shape' as const,
          participant: ME,
          choice: 'agree' as const,
          voted_at: '2026-05-17T00:00:00.000Z',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    ];
    const out = projectOwnFacetVotes(events, ME);
    expect(out.facets.get(ownFacetKey('edge', EDGE_A, 'shape'))).toBe('agree');
  });
});
