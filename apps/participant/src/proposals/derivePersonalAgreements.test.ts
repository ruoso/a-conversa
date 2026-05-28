// Tests for the participant `derivePersonalAgreements` selector.
//
// Refinement: tasks/refinements/participant-ui/part_my_agreements_view.md
//
// Per ADR 0022 these are committed Vitest cases. They pin the selector
// contract from the refinement's "Test layers" §1 — 11 cases (a)-(j)
// plus the four-facet sanity case:
//   (a) empty event log → empty array.
//   (b) proposal + agree by current participant + status 'agreed' → one row.
//   (c) proposal + agree + commit → row with currentStatus 'committed'.
//   (d) proposal + agree + commit + withdraw-agreement → row with
//       currentStatus 'withdrawn'.
//   (e) proposal + agree + meta-disagreement-marked → row dropped
//       (currentStatus 'meta-disagreement' excluded).
//   (f) proposal + agree by OTHER participant → empty.
//   (g) proposal + agree by current (still 'proposed', no commit) →
//       empty (filter excludes 'proposed').
//   (h) Two agrees on different facets → two rows newest-first.
//   (i) proposal + agree + later dispute by current → empty (dispute
//       invalidates the prior agree).
//   (j) structural-arm proposal (decompose) + agree by current → empty
//       (no facet target).
//   Plus: agree across all four facet kinds → four rows.

import { describe, expect, it } from 'vitest';
import type { Event, ProposalPayload } from '@a-conversa/shared-types';

import { derivePersonalAgreements } from './derivePersonalAgreements';
import { computeFacetStatuses, type FacetStatusIndex } from '@a-conversa/shell';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const MODERATOR = '00000000-0000-4000-8000-0000000000aa';
const ME = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-0000000000c2';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const EDGE_E = '00000000-0000-4000-8000-00000000001a';
const NODE_S = '00000000-0000-4000-8000-00000000002a';
const NODE_T = '00000000-0000-4000-8000-00000000002b';
const PROPOSAL_P = '00000000-0000-4000-8000-0000000000f1';
const PROPOSAL_Q = '00000000-0000-4000-8000-0000000000f2';
const PROPOSAL_R = '00000000-0000-4000-8000-0000000000f3';
const PROPOSAL_S = '00000000-0000-4000-8000-0000000000f4';

function envId(prefix: string, seq: number): string {
  return `00000000-0000-4000-8000-${(prefix.charCodeAt(0) * 256 + seq).toString(16).padStart(12, '0')}`;
}

function participantJoinedEvent(seq: number, userId: string): Event {
  return {
    id: envId('j', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'participant-joined',
    actor: userId,
    payload: {
      user_id: userId,
      role: 'debater-A',
      screen_name: 'tester',
      joined_at: '2026-05-25T00:00:00.000Z',
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function nodeCreatedEvent(seq: number, nodeId: string): Event {
  return {
    id: envId('n', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'node-created',
    actor: MODERATOR,
    payload: {
      node_id: nodeId,
      wording: `wording for ${nodeId.slice(0, 4)}`,
      created_by: MODERATOR,
      created_at: '2026-05-25T00:00:00.000Z',
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function edgeCreatedEvent(seq: number, edgeId: string, src: string, tgt: string): Event {
  return {
    id: envId('e', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'edge-created',
    actor: MODERATOR,
    payload: {
      edge_id: edgeId,
      role: 'supports',
      source_node_id: src,
      target_node_id: tgt,
      created_by: MODERATOR,
      created_at: '2026-05-25T00:00:00.000Z',
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function proposalEvent(seq: number, proposalId: string, proposal: ProposalPayload): Event {
  return {
    id: proposalId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: MODERATOR,
    payload: { proposal },
    createdAt: `2026-05-25T00:00:${String(seq).padStart(2, '0')}.000Z`,
  };
}

function voteAgreeFacetEvent(
  seq: number,
  participant: string,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'wording' | 'classification' | 'substance' | 'shape',
): Event {
  return {
    id: envId('v', seq),
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
      choice: 'agree',
      voted_at: `2026-05-25T00:00:${String(seq).padStart(2, '0')}.000Z`,
    },
    createdAt: `2026-05-25T00:00:${String(seq).padStart(2, '0')}.000Z`,
  };
}

function voteDisputeFacetEvent(
  seq: number,
  participant: string,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'wording' | 'classification' | 'substance' | 'shape',
): Event {
  return {
    id: envId('d', seq),
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
      choice: 'dispute',
      voted_at: `2026-05-25T00:00:${String(seq).padStart(2, '0')}.000Z`,
    },
    createdAt: `2026-05-25T00:00:${String(seq).padStart(2, '0')}.000Z`,
  };
}

function commitFacetEvent(
  seq: number,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'wording' | 'classification' | 'substance' | 'shape',
): Event {
  return {
    id: envId('c', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'commit',
    actor: MODERATOR,
    payload: {
      target: 'facet',
      entity_kind: entityKind,
      entity_id: entityId,
      facet,
      committed_by: MODERATOR,
      committed_at: `2026-05-25T00:00:${String(seq).padStart(2, '0')}.000Z`,
    },
    createdAt: `2026-05-25T00:00:${String(seq).padStart(2, '0')}.000Z`,
  };
}

function metaFacetEvent(
  seq: number,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'wording' | 'classification' | 'substance' | 'shape',
): Event {
  return {
    id: envId('M', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'meta-disagreement-marked',
    actor: MODERATOR,
    payload: {
      target: 'facet',
      entity_kind: entityKind,
      entity_id: entityId,
      facet,
      marked_by: MODERATOR,
      marked_at: `2026-05-25T00:00:${String(seq).padStart(2, '0')}.000Z`,
    },
    createdAt: `2026-05-25T00:00:${String(seq).padStart(2, '0')}.000Z`,
  };
}

function withdrawAgreementEvent(
  seq: number,
  participant: string,
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: 'wording' | 'classification' | 'substance' | 'shape',
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
      withdrawn_at: `2026-05-25T00:00:${String(seq).padStart(2, '0')}.000Z`,
    },
    createdAt: `2026-05-25T00:00:${String(seq).padStart(2, '0')}.000Z`,
  };
}

function indexFor(events: readonly Event[]): FacetStatusIndex {
  return computeFacetStatuses(events);
}

describe('derivePersonalAgreements', () => {
  it('(a) empty event log → empty array', () => {
    const idx = indexFor([]);
    const rows = derivePersonalAgreements([], ME, idx);
    expect(rows).toEqual([]);
  });

  it('(b) proposal + agree (current) → one row carrying the agree-vote identity', () => {
    // ME is the only participant — a single agree vote drives the facet
    // to 'agreed' under the projection's "all participants agreed" rule.
    const events: Event[] = [
      participantJoinedEvent(1, ME),
      nodeCreatedEvent(2, NODE_X),
      proposalEvent(3, PROPOSAL_P, {
        kind: 'set-node-substance',
        node_id: NODE_X,
        value: 'agreed',
      }),
      voteAgreeFacetEvent(4, ME, 'node', NODE_X, 'substance'),
    ];
    const idx = indexFor(events);
    const rows = derivePersonalAgreements(events, ME, idx);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.voteEventId).toBe(envId('v', 4));
    expect(rows[0]?.agreedAtSequence).toBe(4);
    expect(rows[0]?.entityKind).toBe('node');
    expect(rows[0]?.entityId).toBe(NODE_X);
    expect(rows[0]?.facet).toBe('substance');
    expect(rows[0]?.candidateValue).toBe('agreed');
    expect(rows[0]?.currentStatus).toBe('agreed');
  });

  it('(c) proposal + agree + commit → row with currentStatus committed', () => {
    const events: Event[] = [
      participantJoinedEvent(1, ME),
      nodeCreatedEvent(2, NODE_X),
      proposalEvent(3, PROPOSAL_P, {
        kind: 'classify-node',
        node_id: NODE_X,
        classification: 'fact',
      }),
      voteAgreeFacetEvent(4, ME, 'node', NODE_X, 'classification'),
      commitFacetEvent(5, 'node', NODE_X, 'classification'),
    ];
    const idx = indexFor(events);
    const rows = derivePersonalAgreements(events, ME, idx);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.currentStatus).toBe('committed');
    expect(rows[0]?.candidateValue).toBe('fact');
  });

  it('(d) proposal + agree + commit + withdraw-agreement → row with currentStatus withdrawn', () => {
    const events: Event[] = [
      participantJoinedEvent(1, ME),
      nodeCreatedEvent(2, NODE_X),
      proposalEvent(3, PROPOSAL_P, {
        kind: 'set-node-substance',
        node_id: NODE_X,
        value: 'agreed',
      }),
      voteAgreeFacetEvent(4, ME, 'node', NODE_X, 'substance'),
      commitFacetEvent(5, 'node', NODE_X, 'substance'),
      withdrawAgreementEvent(6, ME, 'node', NODE_X, 'substance'),
    ];
    const idx = indexFor(events);
    const rows = derivePersonalAgreements(events, ME, idx);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.currentStatus).toBe('withdrawn');
  });

  it('(e) proposal + agree + meta-disagreement-marked → row excluded (meta-disagreement filtered)', () => {
    const events: Event[] = [
      participantJoinedEvent(1, ME),
      nodeCreatedEvent(2, NODE_X),
      proposalEvent(3, PROPOSAL_P, {
        kind: 'set-node-substance',
        node_id: NODE_X,
        value: 'agreed',
      }),
      voteAgreeFacetEvent(4, ME, 'node', NODE_X, 'substance'),
      metaFacetEvent(5, 'node', NODE_X, 'substance'),
    ];
    const idx = indexFor(events);
    const rows = derivePersonalAgreements(events, ME, idx);
    expect(rows).toEqual([]);
  });

  it('(f) proposal + agree by OTHER participant → empty', () => {
    const events: Event[] = [
      participantJoinedEvent(1, OTHER),
      nodeCreatedEvent(2, NODE_X),
      proposalEvent(3, PROPOSAL_P, {
        kind: 'set-node-substance',
        node_id: NODE_X,
        value: 'agreed',
      }),
      voteAgreeFacetEvent(4, OTHER, 'node', NODE_X, 'substance'),
    ];
    const idx = indexFor(events);
    const rows = derivePersonalAgreements(events, ME, idx);
    expect(rows).toEqual([]);
  });

  it("(g) proposal + agree (current) with facet still 'proposed' → empty (filter excludes 'proposed')", () => {
    // Two participants, only one votes agree → facet status stays
    // 'proposed' (per the "all participants agreed" rule). The selector
    // filters it out.
    const events: Event[] = [
      participantJoinedEvent(1, ME),
      participantJoinedEvent(2, OTHER),
      nodeCreatedEvent(3, NODE_X),
      proposalEvent(4, PROPOSAL_P, {
        kind: 'set-node-substance',
        node_id: NODE_X,
        value: 'agreed',
      }),
      voteAgreeFacetEvent(5, ME, 'node', NODE_X, 'substance'),
    ];
    const idx = indexFor(events);
    // Sanity — the facet's projected status is 'proposed' here.
    expect(idx.nodes.get(NODE_X)?.substance).toBe('proposed');
    const rows = derivePersonalAgreements(events, ME, idx);
    expect(rows).toEqual([]);
  });

  it('(h) two agrees on different facets → two rows newest-first by agreedAtSequence', () => {
    const events: Event[] = [
      participantJoinedEvent(1, ME),
      nodeCreatedEvent(2, NODE_X),
      nodeCreatedEvent(3, NODE_Y),
      proposalEvent(4, PROPOSAL_P, {
        kind: 'set-node-substance',
        node_id: NODE_X,
        value: 'agreed',
      }),
      proposalEvent(5, PROPOSAL_Q, {
        kind: 'classify-node',
        node_id: NODE_Y,
        classification: 'value',
      }),
      voteAgreeFacetEvent(6, ME, 'node', NODE_X, 'substance'),
      voteAgreeFacetEvent(7, ME, 'node', NODE_Y, 'classification'),
    ];
    const idx = indexFor(events);
    const rows = derivePersonalAgreements(events, ME, idx);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.agreedAtSequence).toBe(7);
    expect(rows[1]?.agreedAtSequence).toBe(6);
  });

  it('(i) proposal + agree (current) + later dispute (current) on same facet → empty', () => {
    const events: Event[] = [
      participantJoinedEvent(1, ME),
      nodeCreatedEvent(2, NODE_X),
      proposalEvent(3, PROPOSAL_P, {
        kind: 'set-node-substance',
        node_id: NODE_X,
        value: 'agreed',
      }),
      voteAgreeFacetEvent(4, ME, 'node', NODE_X, 'substance'),
      voteDisputeFacetEvent(5, ME, 'node', NODE_X, 'substance'),
    ];
    const idx = indexFor(events);
    const rows = derivePersonalAgreements(events, ME, idx);
    expect(rows).toEqual([]);
  });

  it('(j) structural-arm proposal (decompose) + agree (current, proposal-keyed) → empty (no facet target)', () => {
    const events: Event[] = [
      participantJoinedEvent(1, ME),
      nodeCreatedEvent(2, NODE_X),
      proposalEvent(3, PROPOSAL_P, {
        kind: 'decompose',
        parent_node_id: NODE_X,
        components: [
          {
            node_id: '00000000-0000-4000-8000-0000000000d1',
            wording: 'component A',
            classification: 'fact',
          },
          {
            node_id: '00000000-0000-4000-8000-0000000000d2',
            wording: 'component B',
            classification: 'value',
          },
        ],
      }),
      {
        id: envId('v', 4),
        sessionId: SESSION,
        sequence: 4,
        kind: 'vote',
        actor: ME,
        payload: {
          target: 'proposal',
          proposal_id: PROPOSAL_P,
          participant: ME,
          choice: 'agree',
          voted_at: '2026-05-25T00:00:04.000Z',
        },
        createdAt: '2026-05-25T00:00:04.000Z',
      },
    ];
    const idx = indexFor(events);
    const rows = derivePersonalAgreements(events, ME, idx);
    expect(rows).toEqual([]);
  });

  it('agree across all four facet kinds → four rows', () => {
    // Node wording + classification + substance + edge shape.
    // (Single-participant session so each facet reaches 'agreed'.)
    const events: Event[] = [
      participantJoinedEvent(1, ME),
      nodeCreatedEvent(2, NODE_S),
      nodeCreatedEvent(3, NODE_T),
      edgeCreatedEvent(4, EDGE_E, NODE_S, NODE_T),
      // wording proposal on NODE_S
      proposalEvent(5, PROPOSAL_P, {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: NODE_S,
        new_wording: 'cleaner wording',
      }),
      // classification on NODE_S
      proposalEvent(6, PROPOSAL_Q, {
        kind: 'classify-node',
        node_id: NODE_S,
        classification: 'normative',
      }),
      // substance on NODE_S
      proposalEvent(7, PROPOSAL_R, {
        kind: 'set-node-substance',
        node_id: NODE_S,
        value: 'agreed',
      }),
      // shape on EDGE_E
      proposalEvent(8, PROPOSAL_S, {
        kind: 'set-edge-substance',
        edge_id: EDGE_E,
        value: 'agreed',
      }),
      voteAgreeFacetEvent(9, ME, 'node', NODE_S, 'wording'),
      voteAgreeFacetEvent(10, ME, 'node', NODE_S, 'classification'),
      voteAgreeFacetEvent(11, ME, 'node', NODE_S, 'substance'),
      voteAgreeFacetEvent(12, ME, 'edge', EDGE_E, 'substance'),
    ];
    const idx = indexFor(events);
    const rows = derivePersonalAgreements(events, ME, idx);
    expect(rows.map((r) => r.facet).sort()).toEqual(
      ['classification', 'substance', 'substance', 'wording'].sort(),
    );
    expect(rows).toHaveLength(4);
  });
});
