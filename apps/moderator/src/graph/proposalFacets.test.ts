// Tests for `derivePerProposalFacets` — the pure selector behind the
// right-sidebar's per-proposal facet breakdown.
//
// Refinement: tasks/refinements/moderator-ui/mod_per_facet_breakdown.md
//
// Per ADR 0022 these are committed Vitest cases. They pin the selector
// contract enumerated in the refinement's Acceptance criteria:
//
//   (a) Each of the four facet-targeting sub-kinds emits one entry
//       with the expected `facet` value
//       (classify-node → classification; set-node-substance → substance;
//       set-edge-substance → substance; edit-wording → wording).
//   (b) Each of the seven structural sub-kinds emits one entry with
//       `facet: 'proposal'`.
//   (c) Server `serverPerFacetStatus[facet]` overrides the client
//       mirror value.
//   (d) Client mirror value is used when `serverPerFacetStatus` is
//       undefined OR does not carry the facet.
//   (e) Default-to-`'proposed'` when neither surface carries the facet.
//   (f) The function is pure (two calls with the same inputs return
//       deep-equal outputs).
//   (g) The `labelKey` field is the canonical `methodology.facet.<facet>`
//       form for both real facets and the synthetic `'proposal'` entry.

import { describe, expect, it } from 'vitest';
import type { ProposalPayload } from '@a-conversa/shared-types';

import {
  deriveAllAgree,
  deriveCurrentParticipants,
  derivePerProposalFacets,
  type ProposalFacetEntry,
  type VotesByFacetIndex,
} from './proposalFacets';
import type { FacetName, FacetStatus, FacetStatusIndex } from './facetStatus';
import { EMPTY_VOTES, type Vote } from './selectors';
import type { Event } from '@a-conversa/shared-types';

const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000c1';
const PARTICIPANT_B = '00000000-0000-4000-8000-0000000000c2';
const PARTICIPANT_C = '00000000-0000-4000-8000-0000000000c3';

const EMPTY_VOTES_INDEX: VotesByFacetIndex = new Map();

function votesIndexWith(
  entityId: string,
  facet: FacetName,
  votes: readonly Vote[],
): VotesByFacetIndex {
  return new Map([[entityId, new Map([[facet, votes]])]]);
}

const EMPTY_INDEX: FacetStatusIndex = {
  nodes: new Map(),
  edges: new Map(),
};

function indexWith(
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: FacetName,
  status: FacetStatus,
): FacetStatusIndex {
  const inner: Partial<Record<FacetName, FacetStatus>> = { [facet]: status };
  if (entityKind === 'node') {
    return {
      nodes: new Map([[entityId, inner]]),
      edges: new Map(),
    };
  }
  return {
    nodes: new Map(),
    edges: new Map([[entityId, inner]]),
  };
}

describe('derivePerProposalFacets — facet-targeting sub-kinds emit the expected facet entry', () => {
  it('classify-node → one entry { facet: "classification" }', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined);
    expect(out).toHaveLength(1);
    expect(out[0]?.facet).toBe('classification');
    expect(out[0]?.labelKey).toBe('methodology.facet.classification');
  });

  it('set-node-substance → one entry { facet: "substance" }', () => {
    const proposal: ProposalPayload = {
      kind: 'set-node-substance',
      node_id: NODE_X,
      value: 'agreed',
    };
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined);
    expect(out).toHaveLength(1);
    expect(out[0]?.facet).toBe('substance');
    expect(out[0]?.labelKey).toBe('methodology.facet.substance');
  });

  it('set-edge-substance → one entry { facet: "substance" }', () => {
    const proposal: ProposalPayload = {
      kind: 'set-edge-substance',
      edge_id: EDGE_E,
      value: 'agreed',
    };
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined);
    expect(out).toHaveLength(1);
    expect(out[0]?.facet).toBe('substance');
    expect(out[0]?.labelKey).toBe('methodology.facet.substance');
  });

  it('edit-wording (reword) → one entry { facet: "wording" }', () => {
    const proposal: ProposalPayload = {
      kind: 'edit-wording',
      edit_kind: 'reword',
      node_id: NODE_X,
      new_wording: 'updated wording',
    };
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined);
    expect(out).toHaveLength(1);
    expect(out[0]?.facet).toBe('wording');
    expect(out[0]?.labelKey).toBe('methodology.facet.wording');
  });

  it('edit-wording (restructure) → one entry { facet: "wording" }', () => {
    const proposal: ProposalPayload = {
      kind: 'edit-wording',
      edit_kind: 'restructure',
      node_id: NODE_X,
      new_wording: 'rebuilt wording',
      new_node_id: NODE_Y,
    };
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined);
    expect(out).toHaveLength(1);
    expect(out[0]?.facet).toBe('wording');
  });
});

describe('derivePerProposalFacets — structural sub-kinds emit one synthetic "proposal" entry', () => {
  const cases: { name: string; payload: ProposalPayload }[] = [
    {
      name: 'decompose',
      payload: {
        kind: 'decompose',
        parent_node_id: NODE_X,
        components: [
          { wording: 'first', classification: 'fact' },
          { wording: 'second', classification: 'fact' },
        ],
      },
    },
    {
      name: 'interpretive-split',
      payload: {
        kind: 'interpretive-split',
        parent_node_id: NODE_X,
        readings: [
          { wording: 'reading 1', classification: 'value' },
          { wording: 'reading 2', classification: 'value' },
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
        content: 'reframing',
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
      payload: { kind: 'amend-node', node_id: NODE_X, new_content: 'amended' },
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

  for (const { name, payload } of cases) {
    it(`${name} → one entry { facet: "proposal", labelKey: "methodology.facet.proposal" }`, () => {
      const out = derivePerProposalFacets(payload, EMPTY_INDEX, undefined);
      expect(out).toHaveLength(1);
      expect(out[0]?.facet).toBe('proposal');
      expect(out[0]?.labelKey).toBe('methodology.facet.proposal');
    });
  }
});

describe('derivePerProposalFacets — status precedence: server → client mirror → default', () => {
  const classifyNode: ProposalPayload = {
    kind: 'classify-node',
    node_id: NODE_X,
    classification: 'fact',
  };

  it('server perFacetStatus overrides client mirror for the same facet', () => {
    const clientIndex = indexWith('node', NODE_X, 'classification', 'agreed');
    const server: Record<string, string> = { classification: 'disputed' };
    const out = derivePerProposalFacets(classifyNode, clientIndex, server);
    expect(out[0]?.status).toBe('disputed');
  });

  it('client mirror is used when server perFacetStatus is undefined', () => {
    const clientIndex = indexWith('node', NODE_X, 'classification', 'agreed');
    const out = derivePerProposalFacets(classifyNode, clientIndex, undefined);
    expect(out[0]?.status).toBe('agreed');
  });

  it('client mirror is used when server perFacetStatus is present but does not carry the facet', () => {
    const clientIndex = indexWith('node', NODE_X, 'classification', 'agreed');
    // Server frame carries another facet but not the one this proposal
    // targets — should fall through to the client mirror.
    const server: Record<string, string> = { substance: 'disputed' };
    const out = derivePerProposalFacets(classifyNode, clientIndex, server);
    expect(out[0]?.status).toBe('agreed');
  });

  it('default-to-"proposed" when neither server nor client carries the facet', () => {
    const out = derivePerProposalFacets(classifyNode, EMPTY_INDEX, undefined);
    expect(out[0]?.status).toBe('proposed');
  });

  it('default-to-"proposed" when the server map exists but is empty and the client mirror is empty', () => {
    const out = derivePerProposalFacets(classifyNode, EMPTY_INDEX, {});
    expect(out[0]?.status).toBe('proposed');
  });

  it('server value that is not a known FacetStatus falls through to client / default', () => {
    // Defensive — the wire schema is `Record<string, string>` per the
    // shared-types declaration; if a value lands that is not one of
    // the six FacetStatus values, the selector ignores it (rather
    // than surfacing a malformed status) and falls back to the
    // client mirror / default.
    const clientIndex = indexWith('node', NODE_X, 'classification', 'agreed');
    const server: Record<string, string> = { classification: 'not-a-real-status' };
    const out = derivePerProposalFacets(classifyNode, clientIndex, server);
    expect(out[0]?.status).toBe('agreed');
  });

  it('structural sub-kind status resolves through server frame when present', () => {
    // The synthetic 'proposal' facet name can still be carried by a
    // future tightening of the broadcast; today it stays 'proposed'
    // by default.
    const proposal: ProposalPayload = {
      kind: 'decompose',
      parent_node_id: NODE_X,
      components: [
        { wording: 'first', classification: 'fact' },
        { wording: 'second', classification: 'fact' },
      ],
    };
    const server: Record<string, string> = { proposal: 'committed' };
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, server);
    expect(out[0]?.status).toBe('committed');
  });

  it('structural sub-kind defaults to "proposed" with no server frame', () => {
    const proposal: ProposalPayload = {
      kind: 'axiom-mark',
      node_id: NODE_X,
      participant: PARTICIPANT_A,
    };
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined);
    expect(out[0]?.status).toBe('proposed');
  });
});

describe('derivePerProposalFacets — purity', () => {
  it('two calls with the same inputs return deep-equal outputs', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const index = indexWith('node', NODE_X, 'classification', 'disputed');
    const server: Record<string, string> = { classification: 'agreed' };
    const a = derivePerProposalFacets(proposal, index, server);
    const b = derivePerProposalFacets(proposal, index, server);
    expect(a).toEqual(b);
  });

  it('does not mutate its inputs', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const index = indexWith('node', NODE_X, 'classification', 'disputed');
    const server: Record<string, string> = { classification: 'agreed' };
    const serverBefore = { ...server };
    derivePerProposalFacets(proposal, index, server);
    expect(server).toEqual(serverBefore);
    // The index's inner maps stay the same shape (no spurious entries).
    expect(index.nodes.get(NODE_X)).toEqual({ classification: 'disputed' });
  });
});

describe('derivePerProposalFacets — entity-kind isolation for substance', () => {
  it('a set-node-substance proposal does not pick up a same-id edge substance status from the mirror', () => {
    // Same entity id collision (extremely unlikely in practice — node
    // ids and edge ids share the UUID namespace) — the selector
    // disambiguates via entityKind.
    const indexWithEdge = indexWith('edge', NODE_X, 'substance', 'agreed');
    const proposal: ProposalPayload = {
      kind: 'set-node-substance',
      node_id: NODE_X,
      value: 'disputed',
    };
    const out = derivePerProposalFacets(proposal, indexWithEdge, undefined);
    // The node side of the mirror has no entry, so the default applies.
    expect(out[0]?.status).toBe('proposed');
  });

  it('a set-edge-substance proposal picks up the edge mirror entry', () => {
    const indexWithEdge = indexWith('edge', EDGE_E, 'substance', 'agreed');
    const proposal: ProposalPayload = {
      kind: 'set-edge-substance',
      edge_id: EDGE_E,
      value: 'agreed',
    };
    const out = derivePerProposalFacets(proposal, indexWithEdge, undefined);
    expect(out[0]?.status).toBe('agreed');
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_vote_indicators_in_sidebar.md
//
// The selector grows a fourth `votesByFacetIndex` parameter and a fourth
// `votes: readonly Vote[]` field on each `ProposalFacetEntry`. These
// cases pin the contract enumerated in the refinement's Acceptance
// criteria:
//   - (a) each facet-targeting sub-kind's `votes` field defaults to
//     `EMPTY_VOTES` when the index is empty;
//   - (b) when the index carries a vote for the (entityId, facet) pair,
//     the field surfaces it;
//   - (c) the structural `'proposal'` synthetic entry always emits
//     `EMPTY_VOTES` regardless of the index;
//   - (d) `set-edge-substance` resolves votes from the same index keyed
//     by `edge_id` (Decision §4);
//   - (e) the selector remains pure (two calls with the same args
//     return deep-equal outputs);
//   - (f) two participants on the same facet surface in arrival order.
describe('derivePerProposalFacets — per-participant votes field', () => {
  it('defaults to EMPTY_VOTES when the index is empty (classify-node)', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined, EMPTY_VOTES_INDEX);
    expect(out[0]?.votes).toBe(EMPTY_VOTES);
  });

  it('defaults to EMPTY_VOTES when the index argument is omitted (back-compat)', () => {
    // Older callers that pre-date the sidebar indicator task pass three
    // arguments; the new parameter has a default of an empty map, so
    // the `votes` field still resolves to the shared `EMPTY_VOTES`
    // reference.
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined);
    expect(out[0]?.votes).toBe(EMPTY_VOTES);
  });

  it('surfaces the matching (nodeId, facet) bucket for classify-node', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const votes: readonly Vote[] = [{ participantId: PARTICIPANT_A, choice: 'agree' }];
    const index = votesIndexWith(NODE_X, 'classification', votes);
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined, index);
    expect(out[0]?.votes).toEqual(votes);
  });

  it('surfaces the matching (nodeId, facet) bucket for set-node-substance', () => {
    const proposal: ProposalPayload = {
      kind: 'set-node-substance',
      node_id: NODE_X,
      value: 'agreed',
    };
    const votes: readonly Vote[] = [{ participantId: PARTICIPANT_A, choice: 'dispute' }];
    const index = votesIndexWith(NODE_X, 'substance', votes);
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined, index);
    expect(out[0]?.votes).toEqual(votes);
  });

  it('surfaces the matching (nodeId, facet) bucket for edit-wording', () => {
    const proposal: ProposalPayload = {
      kind: 'edit-wording',
      edit_kind: 'reword',
      node_id: NODE_X,
      new_wording: 'updated',
    };
    const votes: readonly Vote[] = [{ participantId: PARTICIPANT_A, choice: 'withdraw' }];
    const index = votesIndexWith(NODE_X, 'wording', votes);
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined, index);
    expect(out[0]?.votes).toEqual(votes);
  });

  it('surfaces the matching (edgeId, facet) bucket for set-edge-substance', () => {
    // Decision §4 — the index is keyed by `entityId` (node UUID OR edge
    // UUID — disjoint keyspaces). The set-edge-substance selector
    // resolves its target to `entityId = edge_id`, then reads the same
    // map. The projection extension and the selector extension agree on
    // the keying scheme; this case is the round-trip cover.
    const proposal: ProposalPayload = {
      kind: 'set-edge-substance',
      edge_id: EDGE_E,
      value: 'agreed',
    };
    const votes: readonly Vote[] = [
      { participantId: PARTICIPANT_A, choice: 'agree' },
      { participantId: PARTICIPANT_B, choice: 'dispute' },
    ];
    const index = votesIndexWith(EDGE_E, 'substance', votes);
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined, index);
    expect(out[0]?.votes).toEqual(votes);
  });

  it('preserves arrival order across multiple participants', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const votes: readonly Vote[] = [
      { participantId: PARTICIPANT_A, choice: 'agree' },
      { participantId: PARTICIPANT_B, choice: 'dispute' },
      { participantId: PARTICIPANT_C, choice: 'withdraw' },
    ];
    const index = votesIndexWith(NODE_X, 'classification', votes);
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined, index);
    expect(out[0]?.votes.map((v) => v.participantId)).toEqual([
      PARTICIPANT_A,
      PARTICIPANT_B,
      PARTICIPANT_C,
    ]);
  });

  it('an index entry for a different facet on the same entity is not picked up', () => {
    // classify-node targets `classification`; the index carries a vote
    // for the same node's `substance` facet — they don't cross.
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const votes: readonly Vote[] = [{ participantId: PARTICIPANT_A, choice: 'agree' }];
    const index = votesIndexWith(NODE_X, 'substance', votes);
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined, index);
    expect(out[0]?.votes).toBe(EMPTY_VOTES);
  });

  it('structural sub-kind always emits EMPTY_VOTES regardless of the index', () => {
    // Decision §5 — structural proposals don't carry per-(entity, facet)
    // votes today; the synthetic `'proposal'` lifecycle chip's `votes`
    // field is always the shared empty reference.
    const proposal: ProposalPayload = {
      kind: 'axiom-mark',
      node_id: NODE_X,
      participant: PARTICIPANT_A,
    };
    // Even if the index happened to carry an entry under the node id
    // (it shouldn't — `projectVotesByFacet` doesn't bucket axiom-mark
    // proposals — but a defensive test for the synthetic entry's
    // contract), the selector still returns EMPTY_VOTES.
    const votes: readonly Vote[] = [{ participantId: PARTICIPANT_A, choice: 'agree' }];
    const index = votesIndexWith(NODE_X, 'classification', votes);
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined, index);
    expect(out[0]?.facet).toBe('proposal');
    expect(out[0]?.votes).toBe(EMPTY_VOTES);
  });

  it('purity — two calls with the same args return deep-equal outputs (votes too)', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const votes: readonly Vote[] = [
      { participantId: PARTICIPANT_A, choice: 'agree' },
      { participantId: PARTICIPANT_B, choice: 'dispute' },
    ];
    const index = votesIndexWith(NODE_X, 'classification', votes);
    const a = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined, index);
    const b = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined, index);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------
// `deriveCurrentParticipants` tests
//
// Refinement: tasks/refinements/moderator-ui/mod_commit_button.md
// Acceptance criterion 5.1, 5.2: excludes moderator role; excludes left
// participants. Pure; same `events`-keyed cadence as the other
// pane-level memos.
// ---------------------------------------------------------------------

const MODERATOR_ID = '00000000-0000-4000-8000-0000000000a0';
const DEBATER_A_ID = '00000000-0000-4000-8000-0000000000a1';
const DEBATER_B_ID = '00000000-0000-4000-8000-0000000000a2';
const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';

function joinedEvent(
  seq: number,
  userId: string,
  role: 'moderator' | 'debater-A' | 'debater-B',
): Event {
  return {
    id: `00000000-0000-4000-8000-${(seq + 0x1000).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: seq,
    kind: 'participant-joined',
    actor: userId,
    payload: {
      user_id: userId,
      role,
      screen_name: `User-${role}`,
      joined_at: '2026-05-16T00:00:00.000Z',
    },
    createdAt: '2026-05-16T00:00:00.000Z',
  };
}

function leftEvent(seq: number, userId: string): Event {
  return {
    id: `00000000-0000-4000-8000-${(seq + 0x2000).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: seq,
    kind: 'participant-left',
    actor: userId,
    payload: {
      user_id: userId,
      left_at: '2026-05-16T00:05:00.000Z',
    },
    createdAt: '2026-05-16T00:05:00.000Z',
  };
}

describe('deriveCurrentParticipants — current non-moderator participants only', () => {
  it('excludes the moderator role', () => {
    const events: Event[] = [
      joinedEvent(1, MODERATOR_ID, 'moderator'),
      joinedEvent(2, DEBATER_A_ID, 'debater-A'),
      joinedEvent(3, DEBATER_B_ID, 'debater-B'),
    ];
    const out = deriveCurrentParticipants(events);
    expect(out.has(MODERATOR_ID)).toBe(false);
    expect(out.has(DEBATER_A_ID)).toBe(true);
    expect(out.has(DEBATER_B_ID)).toBe(true);
    expect(out.size).toBe(2);
  });

  it('excludes participants who emitted participant-left after participant-joined', () => {
    const events: Event[] = [
      joinedEvent(1, DEBATER_A_ID, 'debater-A'),
      joinedEvent(2, DEBATER_B_ID, 'debater-B'),
      leftEvent(3, DEBATER_A_ID),
    ];
    const out = deriveCurrentParticipants(events);
    expect(out.has(DEBATER_A_ID)).toBe(false);
    expect(out.has(DEBATER_B_ID)).toBe(true);
    expect(out.size).toBe(1);
  });

  it('re-adds a participant who left and then rejoined', () => {
    const events: Event[] = [
      joinedEvent(1, DEBATER_A_ID, 'debater-A'),
      leftEvent(2, DEBATER_A_ID),
      joinedEvent(3, DEBATER_A_ID, 'debater-A'),
    ];
    const out = deriveCurrentParticipants(events);
    expect(out.has(DEBATER_A_ID)).toBe(true);
  });

  it('empty event log → empty set', () => {
    const out = deriveCurrentParticipants([]);
    expect(out.size).toBe(0);
  });

  it('purity — two calls with the same input return a set with the same membership', () => {
    const events: Event[] = [
      joinedEvent(1, DEBATER_A_ID, 'debater-A'),
      joinedEvent(2, DEBATER_B_ID, 'debater-B'),
    ];
    const a = deriveCurrentParticipants(events);
    const b = deriveCurrentParticipants(events);
    expect([...a].sort()).toEqual([...b].sort());
  });
});

// ---------------------------------------------------------------------
// `deriveAllAgree` tests
//
// Refinement: tasks/refinements/moderator-ui/mod_commit_button.md
// Acceptance criteria 5.3–5.7. The predicate mirrors the engine's
// `commitHandler` rule 4 (unanimous agree across current participants
// for facet-targeting sub-kinds; structural sub-kinds rejected with
// `structural-sub-kind-not-supported`).
// ---------------------------------------------------------------------

/**
 * Build a facet entry for testing the commit-gate predicate. The
 * `facet` defaults to `'classification'` (a real facet); structural
 * sub-kinds set `facet: 'proposal'`.
 */
function makeEntry(
  votes: readonly Vote[],
  overrides: Partial<ProposalFacetEntry> = {},
): ProposalFacetEntry {
  return {
    facet: 'classification',
    status: 'proposed',
    labelKey: 'methodology.facet.classification',
    votes,
    ...overrides,
  };
}

describe('deriveAllAgree — unanimous agree across current non-moderator participants', () => {
  it('returns { ok: true } when every entry has every participant voting agree', () => {
    const entry = makeEntry([
      { participantId: DEBATER_A_ID, choice: 'agree' },
      { participantId: DEBATER_B_ID, choice: 'agree' },
    ]);
    const out = deriveAllAgree([entry], new Set([DEBATER_A_ID, DEBATER_B_ID]));
    expect(out.ok).toBe(true);
  });

  it('returns { ok: false, reason: participants-not-voted } when a participant has no vote on one facet', () => {
    const entry = makeEntry([{ participantId: DEBATER_A_ID, choice: 'agree' }]);
    const out = deriveAllAgree([entry], new Set([DEBATER_A_ID, DEBATER_B_ID]));
    expect(out).toEqual({ ok: false, reason: 'participants-not-voted' });
  });

  it('returns { ok: false, reason: participants-disagree } when a participant voted dispute', () => {
    const entry = makeEntry([
      { participantId: DEBATER_A_ID, choice: 'agree' },
      { participantId: DEBATER_B_ID, choice: 'dispute' },
    ]);
    const out = deriveAllAgree([entry], new Set([DEBATER_A_ID, DEBATER_B_ID]));
    expect(out).toEqual({ ok: false, reason: 'participants-disagree' });
  });

  it('returns { ok: false, reason: participants-disagree } when a participant voted withdraw', () => {
    const entry = makeEntry([
      { participantId: DEBATER_A_ID, choice: 'agree' },
      { participantId: DEBATER_B_ID, choice: 'withdraw' },
    ]);
    const out = deriveAllAgree([entry], new Set([DEBATER_A_ID, DEBATER_B_ID]));
    expect(out).toEqual({ ok: false, reason: 'participants-disagree' });
  });

  it('returns { ok: false, reason: proposal-meta-disagreement } when any entry status is meta-disagreement', () => {
    const entry = makeEntry(
      [
        { participantId: DEBATER_A_ID, choice: 'agree' },
        { participantId: DEBATER_B_ID, choice: 'agree' },
      ],
      { status: 'meta-disagreement' },
    );
    const out = deriveAllAgree([entry], new Set([DEBATER_A_ID, DEBATER_B_ID]));
    expect(out).toEqual({ ok: false, reason: 'proposal-meta-disagreement' });
  });

  it('returns { ok: false, reason: structural-sub-kind-not-supported } for the synthetic proposal facet', () => {
    const entry = makeEntry([], { facet: 'proposal', labelKey: 'methodology.facet.proposal' });
    const out = deriveAllAgree([entry], new Set([DEBATER_A_ID, DEBATER_B_ID]));
    expect(out).toEqual({ ok: false, reason: 'structural-sub-kind-not-supported' });
  });

  it('returns { ok: false, reason: no-current-participants } when the participant set is empty', () => {
    const entry = makeEntry([]);
    const out = deriveAllAgree([entry], new Set());
    expect(out).toEqual({ ok: false, reason: 'no-current-participants' });
  });

  it('ignores votes from non-current participants (e.g., a participant who left)', () => {
    const entry = makeEntry([
      { participantId: DEBATER_A_ID, choice: 'agree' },
      // DEBATER_B left — their stale vote should not gate the result.
      { participantId: DEBATER_B_ID, choice: 'dispute' },
    ]);
    const out = deriveAllAgree([entry], new Set([DEBATER_A_ID]));
    expect(out.ok).toBe(true);
  });

  it('meta-disagreement takes priority over participants-not-voted', () => {
    const entry = makeEntry([], { status: 'meta-disagreement' });
    const out = deriveAllAgree([entry], new Set([DEBATER_A_ID]));
    expect(out).toEqual({ ok: false, reason: 'proposal-meta-disagreement' });
  });

  it('multi-entry — one entry blocks even when other entries are agree', () => {
    const ok = makeEntry([
      { participantId: DEBATER_A_ID, choice: 'agree' },
      { participantId: DEBATER_B_ID, choice: 'agree' },
    ]);
    const blocked = makeEntry([{ participantId: DEBATER_A_ID, choice: 'agree' }], {
      facet: 'substance',
      labelKey: 'methodology.facet.substance',
    });
    const out = deriveAllAgree([ok, blocked], new Set([DEBATER_A_ID, DEBATER_B_ID]));
    expect(out).toEqual({ ok: false, reason: 'participants-not-voted' });
  });
});
