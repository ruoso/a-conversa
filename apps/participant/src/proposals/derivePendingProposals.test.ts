// Tests for the participant `derivePendingProposals` selector.
//
// Refinement: tasks/refinements/participant-ui/part_proposal_list_view.md
//
// Mirror of the moderator's selector test coverage adapted to the
// participant's import path. Per ADR 0022 these are committed Vitest
// cases. They pin the selector contract from the refinement's "Test
// layers" §1 — nine cases (a)-(i):
//   (a) empty event log → empty array.
//   (b) one `proposal` event → one row with expected fields.
//   (c) two `proposal` events → newest-first order.
//   (d) `proposal` → `commit` (proposal-arm) → terminated.
//   (e) `proposal` (set-node-substance) → `commit` (facet-arm) → terminated.
//   (f) `proposal` → `meta-disagreement-marked` (proposal-arm) → terminated.
//   (g) `proposal` (classify-node) → `meta-disagreement-marked` (facet-arm) → terminated.
//   (h) Two facet-valued proposals supersession — only the second is
//       terminated by a later facet-arm commit.
//   (i) Mixed event kinds ignored — only proposal/commit/marked participate.

import { describe, expect, it } from 'vitest';
import type { Event, ProposalPayload } from '@a-conversa/shared-types';

import { derivePendingProposals } from './derivePendingProposals';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000c1';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const PROPOSAL_P = '00000000-0000-4000-8000-0000000000ff';
const PROPOSAL_Q = '00000000-0000-4000-8000-0000000000fe';

function envId(prefix: string, seq: number): string {
  return `00000000-0000-4000-8000-${(prefix.charCodeAt(0) * 256 + seq).toString(16).padStart(12, '0')}`;
}

function proposalEvent(
  seq: number,
  envelopeId: string,
  proposal: ProposalPayload,
  overrides: { actor?: string | null; createdAt?: string } = {},
): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: overrides.actor === undefined ? ACTOR : overrides.actor,
    payload: { proposal },
    createdAt: overrides.createdAt ?? '2026-05-25T00:00:00.000Z',
  };
}

function commitProposalEvent(seq: number, proposalId: string): Event {
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
      committed_at: '2026-05-25T00:00:20.000Z',
    },
    createdAt: '2026-05-25T00:00:20.000Z',
  };
}

function commitFacetEvent(
  seq: number,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'wording' | 'classification' | 'substance',
): Event {
  return {
    id: envId('f', seq),
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
      committed_at: '2026-05-25T00:00:30.000Z',
    },
    createdAt: '2026-05-25T00:00:30.000Z',
  };
}

function metaProposalEvent(seq: number, proposalId: string): Event {
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
      marked_at: '2026-05-25T00:00:40.000Z',
    },
    createdAt: '2026-05-25T00:00:40.000Z',
  };
}

function metaFacetEvent(
  seq: number,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'wording' | 'classification' | 'substance',
): Event {
  return {
    id: envId('M', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'meta-disagreement-marked',
    actor: ACTOR,
    payload: {
      target: 'facet',
      entity_kind: entityKind,
      entity_id: entityId,
      facet,
      marked_by: ACTOR,
      marked_at: '2026-05-25T00:00:50.000Z',
    },
    createdAt: '2026-05-25T00:00:50.000Z',
  };
}

function voteEvent(seq: number, proposalId: string): Event {
  return {
    id: envId('v', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'vote',
    actor: PARTICIPANT_A,
    payload: {
      target: 'proposal',
      proposal_id: proposalId,
      participant: PARTICIPANT_A,
      choice: 'agree',
      voted_at: '2026-05-25T00:00:10.000Z',
    },
    createdAt: '2026-05-25T00:00:10.000Z',
  };
}

function nodeCreatedEvent(seq: number, nodeId: string): Event {
  return {
    id: envId('n', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: nodeId,
      wording: 'synthetic node',
      created_by: ACTOR,
      created_at: '2026-05-25T00:00:00.000Z',
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

const classifyP: ProposalPayload = {
  kind: 'classify-node',
  node_id: NODE_X,
  classification: 'fact',
};

const setNodeSubstanceP: ProposalPayload = {
  kind: 'set-node-substance',
  node_id: NODE_X,
  value: 'agreed',
};

describe('derivePendingProposals (participant)', () => {
  it('(a) empty event log → empty array', () => {
    expect(derivePendingProposals([])).toEqual([]);
  });

  it('(b) single proposal event → one row with expected fields', () => {
    const events: Event[] = [proposalEvent(1, PROPOSAL_P, classifyP)];
    const rows = derivePendingProposals(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      proposalEventId: PROPOSAL_P,
      sequence: 1,
      kind: 'proposal',
      proposal: classifyP,
      actor: ACTOR,
      createdAt: '2026-05-25T00:00:00.000Z',
    });
  });

  it('(c) two proposal events at sequences 1 and 2 → newest-first [2, 1]', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, classifyP),
      proposalEvent(2, PROPOSAL_Q, {
        kind: 'classify-node',
        node_id: NODE_Y,
        classification: 'value',
      }),
    ];
    const rows = derivePendingProposals(events);
    expect(rows.map((r) => r.sequence)).toEqual([2, 1]);
    expect(rows.map((r) => r.proposalEventId)).toEqual([PROPOSAL_Q, PROPOSAL_P]);
  });

  it('(d) proposal → commit (proposal-arm) → row terminated', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, classifyP),
      commitProposalEvent(2, PROPOSAL_P),
    ];
    expect(derivePendingProposals(events)).toEqual([]);
  });

  it('(e) proposal (set-node-substance) → commit (facet-arm) → row terminated', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, setNodeSubstanceP),
      commitFacetEvent(2, 'node', NODE_X, 'substance'),
    ];
    expect(derivePendingProposals(events)).toEqual([]);
  });

  it('(f) proposal → meta-disagreement-marked (proposal-arm) → row terminated', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, classifyP),
      metaProposalEvent(2, PROPOSAL_P),
    ];
    expect(derivePendingProposals(events)).toEqual([]);
  });

  it('(g) proposal (classify-node) → meta-disagreement-marked (facet-arm) → row terminated', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, classifyP),
      metaFacetEvent(2, 'node', NODE_X, 'classification'),
    ];
    expect(derivePendingProposals(events)).toEqual([]);
  });

  it('(h) two facet-valued proposals on the same (node, substance) triple — the second supersedes; a later facet commit terminates only the second; the first remains pending', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, setNodeSubstanceP),
      proposalEvent(2, PROPOSAL_Q, {
        kind: 'set-node-substance',
        node_id: NODE_X,
        value: 'disputed',
      }),
      commitFacetEvent(3, 'node', NODE_X, 'substance'),
    ];
    const rows = derivePendingProposals(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.proposalEventId).toBe(PROPOSAL_P);
  });

  it('(i) mixed event kinds (node-created, vote) interleaved → ignored; only proposal/commit/marked participate', () => {
    const events: Event[] = [
      nodeCreatedEvent(1, NODE_X),
      proposalEvent(2, PROPOSAL_P, classifyP),
      voteEvent(3, PROPOSAL_P),
    ];
    const rows = derivePendingProposals(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.proposalEventId).toBe(PROPOSAL_P);
  });
});
