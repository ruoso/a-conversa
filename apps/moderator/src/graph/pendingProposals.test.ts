// Tests for `derivePendingProposals` — the pure selector behind the
// right-sidebar's pending-proposals pane.
//
// Refinement: tasks/refinements/moderator-ui/mod_proposal_list.md
//
// Per ADR 0022 these are committed Vitest cases. They pin the selector
// contract enumerated in Acceptance criteria:
//   (a) empty input → empty array.
//   (b) one `proposal` event → one row.
//   (c) `commit` referencing a proposal id removes its row.
//   (d) `meta-disagreement-marked` referencing a proposal id removes its row.
//   (e) `vote` does NOT remove the proposal.
//   (f) newest-first sort holds across out-of-order insertion.
//   (g) all eleven proposal sub-kinds round-trip on the emitted row's
//       `proposal.kind`.
//   (h) non-proposal event kinds are ignored.
//   (i) a `commit` referencing an unknown proposal id is a no-op.

import { describe, expect, it } from 'vitest';
import type { Event, ProposalPayload } from '@a-conversa/shared-types';

import { derivePendingProposals } from './pendingProposals';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const ACTOR_OTHER = '00000000-0000-4000-8000-0000000000ab';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000c1';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_P = '00000000-0000-4000-8000-0000000000ff';
const PROPOSAL_Q = '00000000-0000-4000-8000-0000000000fe';
const PROPOSAL_R = '00000000-0000-4000-8000-0000000000fd';
const UNKNOWN_PROPOSAL = '00000000-0000-4000-8000-0000000000ee';

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
    createdAt: overrides.createdAt ?? '2026-05-16T00:00:00.000Z',
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
      proposal_id: proposalId,
      moderator: ACTOR,
      committed_at: '2026-05-16T00:00:20.000Z',
    },
    createdAt: '2026-05-16T00:00:20.000Z',
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
      proposal_id: proposalId,
      moderator: ACTOR,
      marked_at: '2026-05-16T00:00:30.000Z',
    },
    createdAt: '2026-05-16T00:00:30.000Z',
  };
}

function voteEvent(seq: number, proposalId: string, vote: 'agree' | 'dispute' | 'withdraw'): Event {
  return {
    id: envId('v', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'vote',
    actor: PARTICIPANT_A,
    payload: {
      proposal_id: proposalId,
      participant: PARTICIPANT_A,
      vote,
      voted_at: '2026-05-16T00:00:10.000Z',
    },
    createdAt: '2026-05-16T00:00:10.000Z',
  };
}

function sessionCreatedEvent(seq: number): Event {
  return {
    id: envId('s', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'session-created',
    actor: ACTOR,
    payload: {
      host_user_id: ACTOR,
      privacy: 'public',
      topic: 'Synthetic session for the selector test.',
      created_at: '2026-05-16T00:00:00.000Z',
    },
    createdAt: '2026-05-16T00:00:00.000Z',
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
      created_at: '2026-05-16T00:00:00.000Z',
    },
    createdAt: '2026-05-16T00:00:00.000Z',
  };
}

const classifyNode: ProposalPayload = {
  kind: 'classify-node',
  node_id: NODE_X,
  classification: 'fact',
};

describe('derivePendingProposals — empty input', () => {
  it('returns an empty array for an empty event log', () => {
    const rows = derivePendingProposals([]);
    expect(rows).toEqual([]);
  });
});

describe('derivePendingProposals — single-proposal lifecycle', () => {
  it('emits one row for one proposal event with no terminators', () => {
    const events: Event[] = [proposalEvent(1, PROPOSAL_P, classifyNode)];
    const rows = derivePendingProposals(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      proposalEventId: PROPOSAL_P,
      sequence: 1,
      kind: 'proposal',
      proposal: classifyNode,
      actor: ACTOR,
      createdAt: '2026-05-16T00:00:00.000Z',
    });
  });

  it('passes through a null actor (system-emitted proposal envelope)', () => {
    const events: Event[] = [proposalEvent(1, PROPOSAL_P, classifyNode, { actor: null })];
    const rows = derivePendingProposals(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBeNull();
  });

  it('passes through the original ISO-8601 createdAt verbatim (no relative formatting)', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, classifyNode, { createdAt: '2026-05-16T12:34:56.789Z' }),
    ];
    const rows = derivePendingProposals(events);
    expect(rows[0]?.createdAt).toBe('2026-05-16T12:34:56.789Z');
  });
});

describe('derivePendingProposals — lifecycle filter (terminators)', () => {
  it('removes a proposal whose id is referenced by a commit event', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, classifyNode),
      commitEvent(2, PROPOSAL_P),
    ];
    const rows = derivePendingProposals(events);
    expect(rows).toEqual([]);
  });

  it('removes a proposal whose id is referenced by meta-disagreement-marked', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, classifyNode),
      metaDisagreementEvent(2, PROPOSAL_P),
    ];
    const rows = derivePendingProposals(events);
    expect(rows).toEqual([]);
  });

  it('keeps proposals whose ids are NOT referenced by any terminator', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, classifyNode),
      proposalEvent(2, PROPOSAL_Q, {
        kind: 'classify-node',
        node_id: NODE_Y,
        classification: 'value',
      }),
      commitEvent(3, PROPOSAL_P),
    ];
    const rows = derivePendingProposals(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.proposalEventId).toBe(PROPOSAL_Q);
  });

  it('a `vote` event does NOT remove the proposal — even a unanimous-agree state is still pending', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, classifyNode),
      voteEvent(2, PROPOSAL_P, 'agree'),
    ];
    const rows = derivePendingProposals(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.proposalEventId).toBe(PROPOSAL_P);
  });

  it('a `vote: dispute` event does NOT remove the proposal either', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, classifyNode),
      voteEvent(2, PROPOSAL_P, 'dispute'),
    ];
    const rows = derivePendingProposals(events);
    expect(rows).toHaveLength(1);
  });

  it('a `commit` referencing an unknown proposal id is a no-op (defensive)', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, classifyNode),
      commitEvent(2, UNKNOWN_PROPOSAL),
    ];
    const rows = derivePendingProposals(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.proposalEventId).toBe(PROPOSAL_P);
  });

  it('a `meta-disagreement-marked` referencing an unknown proposal id is a no-op (defensive)', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, classifyNode),
      metaDisagreementEvent(2, UNKNOWN_PROPOSAL),
    ];
    const rows = derivePendingProposals(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.proposalEventId).toBe(PROPOSAL_P);
  });

  it('handles a terminator landing BEFORE its proposal in the log (out-of-order tolerance)', () => {
    // Forward-only pass — collect terminators first across the whole
    // log, then emit surviving proposals. So a terminator that appears
    // earlier in the (synthetic / replayed) events array still removes
    // the matching proposal.
    const events: Event[] = [
      commitEvent(2, PROPOSAL_P),
      proposalEvent(1, PROPOSAL_P, classifyNode),
    ];
    const rows = derivePendingProposals(events);
    expect(rows).toEqual([]);
  });
});

describe('derivePendingProposals — sort order', () => {
  it('emits newest-first by `sequence` descending', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, classifyNode),
      proposalEvent(2, PROPOSAL_Q, classifyNode),
      proposalEvent(3, PROPOSAL_R, classifyNode),
    ];
    const rows = derivePendingProposals(events);
    expect(rows.map((r) => r.sequence)).toEqual([3, 2, 1]);
    expect(rows.map((r) => r.proposalEventId)).toEqual([PROPOSAL_R, PROPOSAL_Q, PROPOSAL_P]);
  });

  it('newest-first sort holds across out-of-order insertion', () => {
    const events: Event[] = [
      proposalEvent(3, PROPOSAL_R, classifyNode),
      proposalEvent(1, PROPOSAL_P, classifyNode),
      proposalEvent(2, PROPOSAL_Q, classifyNode),
    ];
    const rows = derivePendingProposals(events);
    expect(rows.map((r) => r.sequence)).toEqual([3, 2, 1]);
  });
});

describe('derivePendingProposals — non-proposal event kinds ignored', () => {
  it('ignores `session-created`, `node-created`, `vote`, and other non-proposal kinds', () => {
    const events: Event[] = [
      sessionCreatedEvent(1),
      nodeCreatedEvent(2, NODE_X),
      proposalEvent(3, PROPOSAL_P, classifyNode),
      voteEvent(4, PROPOSAL_P, 'agree'),
    ];
    const rows = derivePendingProposals(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.proposalEventId).toBe(PROPOSAL_P);
  });

  it('returns empty when the log has only non-proposal kinds', () => {
    const events: Event[] = [sessionCreatedEvent(1), nodeCreatedEvent(2, NODE_X)];
    const rows = derivePendingProposals(events);
    expect(rows).toEqual([]);
  });
});

describe('derivePendingProposals — all eleven proposal sub-kinds round-trip', () => {
  // One assertion per sub-kind on the emitted row's `proposal.kind` —
  // the selector emits any `proposal`-envelope regardless of sub-kind.
  const subKinds: { name: string; payload: ProposalPayload }[] = [
    {
      name: 'classify-node',
      payload: { kind: 'classify-node', node_id: NODE_X, classification: 'fact' },
    },
    {
      name: 'set-node-substance',
      payload: { kind: 'set-node-substance', node_id: NODE_X, value: 'agreed' },
    },
    {
      name: 'set-edge-substance',
      payload: { kind: 'set-edge-substance', edge_id: EDGE_E, value: 'agreed' },
    },
    {
      name: 'edit-wording (reword)',
      payload: {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: NODE_X,
        new_wording: 'updated wording',
      },
    },
    {
      name: 'edit-wording (restructure)',
      payload: {
        kind: 'edit-wording',
        edit_kind: 'restructure',
        node_id: NODE_X,
        new_wording: 'rebuilt wording',
        new_node_id: NODE_Y,
      },
    },
    {
      name: 'decompose',
      payload: {
        kind: 'decompose',
        parent_node_id: NODE_X,
        components: [
          { wording: 'first component', classification: 'fact' },
          { wording: 'second component', classification: 'fact' },
        ],
      },
    },
    {
      name: 'interpretive-split',
      payload: {
        kind: 'interpretive-split',
        parent_node_id: NODE_X,
        readings: [
          { wording: 'reading one', classification: 'value' },
          { wording: 'reading two', classification: 'value' },
        ],
      },
    },
    {
      name: 'axiom-mark',
      payload: { kind: 'axiom-mark', node_id: NODE_X, participant: PARTICIPANT_A },
    },
    {
      name: 'meta-move',
      payload: {
        kind: 'meta-move',
        meta_kind: 'reframe',
        content: 'reframing the discussion',
        target_kind: 'node',
        target_id: NODE_X,
      },
    },
    {
      name: 'break-edge',
      payload: { kind: 'break-edge', edge_id: EDGE_E },
    },
    {
      name: 'amend-node',
      payload: { kind: 'amend-node', node_id: NODE_X, new_content: 'amended content' },
    },
    {
      name: 'annotate',
      payload: {
        kind: 'annotate',
        target_kind: 'node',
        target_id: NODE_X,
        annotation_kind: 'note',
        content: 'a clarifying note',
      },
    },
  ];

  for (const sub of subKinds) {
    it(`emits a row for sub-kind '${sub.name}'`, () => {
      const events: Event[] = [proposalEvent(1, PROPOSAL_P, sub.payload)];
      const rows = derivePendingProposals(events);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.proposal.kind).toBe(sub.payload.kind);
      expect(rows[0]?.proposal).toEqual(sub.payload);
    });
  }
});

describe('derivePendingProposals — purity / idempotence', () => {
  it('returns a fresh array each call; subsequent calls on the same input produce equal output', () => {
    const events: Event[] = [proposalEvent(1, PROPOSAL_P, classifyNode)];
    const first = derivePendingProposals(events);
    const second = derivePendingProposals(events);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('does not mutate the input events array', () => {
    const events: Event[] = [
      proposalEvent(3, PROPOSAL_R, classifyNode),
      proposalEvent(1, PROPOSAL_P, classifyNode),
      proposalEvent(2, PROPOSAL_Q, classifyNode),
    ];
    const sequencesBefore = events.map((e) => e.sequence);
    derivePendingProposals(events);
    const sequencesAfter = events.map((e) => e.sequence);
    expect(sequencesAfter).toEqual(sequencesBefore);
  });

  it('emits an empty array when proposals are all terminated, regardless of ACTOR diversity', () => {
    const events: Event[] = [
      proposalEvent(1, PROPOSAL_P, classifyNode, { actor: ACTOR }),
      proposalEvent(2, PROPOSAL_Q, classifyNode, { actor: ACTOR_OTHER }),
      commitEvent(3, PROPOSAL_P),
      metaDisagreementEvent(4, PROPOSAL_Q),
    ];
    const rows = derivePendingProposals(events);
    expect(rows).toEqual([]);
  });
});
