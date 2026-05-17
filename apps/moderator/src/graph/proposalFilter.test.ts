// Tests for `matchesProposalFilter` — the pure predicate behind the
// pending-proposals pane's filter strip.
//
// Refinement: tasks/refinements/moderator-ui/mod_proposal_filter_search.md
//
// Per ADR 0022 these are committed Vitest cases. They pin the
// contract enumerated in the refinement's Acceptance criteria:
//
//   (a) Empty default returns `true` for every row.
//   (b) Case-insensitive substring match on the summary string.
//   (c) Whitespace-only query is treated as empty.
//   (d) State `'all'` always passes the state-filter branch.
//   (e) State `'ready'` passes iff `deriveAllAgree(entries,
//       currentParticipantIds)` returns `{ ok: true }` — assert
//       alignment by calling both predicates and checking they agree
//       on a hand-rolled scenario per facet-targeting sub-kind.
//   (f) State `'disputed'` passes iff at least one derived facet
//       entry has `status === 'disputed'`.
//   (g) AND composition — text match AND state match are both required.
//   (h) Text branch matches the summary text for each of the eleven
//       proposal sub-kinds (round-trip pin against `summaryText`'s
//       output per sub-kind).

import { describe, expect, it } from 'vitest';
import type { ProposalPayload } from '@a-conversa/shared-types';

import {
  EMPTY_FILTER,
  isDefaultFilter,
  matchesProposalFilter,
  type ProposalFilter,
} from './proposalFilter';
import { summaryText } from './proposalSummary';
import type { PendingProposalRow } from './pendingProposals';
import { deriveAllAgree, derivePerProposalFacets, type VotesByFacetIndex } from './proposalFacets';
import type { FacetName, FacetStatus, FacetStatusIndex } from './facetStatus';
import type { Vote } from './selectors';

const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000c1';
const PARTICIPANT_B = '00000000-0000-4000-8000-0000000000c2';
const PROPOSAL_P = '00000000-0000-4000-8000-0000000000ff';

const EMPTY_INDEX: FacetStatusIndex = { nodes: new Map(), edges: new Map() };
const EMPTY_VOTES_INDEX: VotesByFacetIndex = new Map();
const NO_PARTICIPANTS: ReadonlySet<string> = new Set<string>();

function row(
  proposal: ProposalPayload,
  overrides: Partial<PendingProposalRow> = {},
): PendingProposalRow {
  return {
    proposalEventId: PROPOSAL_P,
    sequence: 1,
    kind: 'proposal',
    proposal,
    actor: PARTICIPANT_A,
    createdAt: '2026-05-16T00:01:00.000Z',
    ...overrides,
  };
}

function indexWith(
  entityKind: 'node' | 'edge',
  entityId: string,
  facet: FacetName,
  status: FacetStatus,
): FacetStatusIndex {
  const inner: Partial<Record<FacetName, FacetStatus>> = { [facet]: status };
  if (entityKind === 'node') {
    return { nodes: new Map([[entityId, inner]]), edges: new Map() };
  }
  return { nodes: new Map(), edges: new Map([[entityId, inner]]) };
}

function votesIndexWith(
  entityId: string,
  facet: FacetName,
  votes: readonly Vote[],
): VotesByFacetIndex {
  return new Map([[entityId, new Map([[facet, votes]])]]);
}

const editWording: ProposalPayload = {
  kind: 'edit-wording',
  edit_kind: 'reword',
  node_id: NODE_X,
  new_wording: 'The proposed minimum wage helps workers.',
};

const classifyNode: ProposalPayload = {
  kind: 'classify-node',
  node_id: NODE_X,
  classification: 'fact',
};

describe('isDefaultFilter', () => {
  it('returns true for the EMPTY_FILTER constant', () => {
    expect(isDefaultFilter(EMPTY_FILTER)).toBe(true);
  });

  it('returns true for empty text + all', () => {
    expect(isDefaultFilter({ text: '', state: 'all' })).toBe(true);
  });

  it('returns true for whitespace-only text + all', () => {
    expect(isDefaultFilter({ text: '   \t  ', state: 'all' })).toBe(true);
  });

  it('returns false when state is non-all', () => {
    expect(isDefaultFilter({ text: '', state: 'ready' })).toBe(false);
    expect(isDefaultFilter({ text: '', state: 'disputed' })).toBe(false);
  });

  it('returns false when text is non-empty after trim', () => {
    expect(isDefaultFilter({ text: 'wage', state: 'all' })).toBe(false);
  });
});

describe('matchesProposalFilter — empty default short-circuits to true', () => {
  it('returns true for the EMPTY_FILTER constant against any row', () => {
    expect(
      matchesProposalFilter(
        row(editWording),
        EMPTY_FILTER,
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(true);
  });

  it('returns true for an equivalent empty-fields filter', () => {
    expect(
      matchesProposalFilter(
        row(editWording),
        { text: '', state: 'all' },
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(true);
  });

  it('returns true for a whitespace-only query + all', () => {
    expect(
      matchesProposalFilter(
        row(editWording),
        { text: '   ', state: 'all' },
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(true);
  });
});

describe('matchesProposalFilter — free-text substring (case-insensitive)', () => {
  it('matches a substring of the summary verbatim', () => {
    expect(
      matchesProposalFilter(
        row(editWording),
        { text: 'minimum wage', state: 'all' },
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(true);
  });

  it('matches case-insensitively when the query is upper-case', () => {
    expect(
      matchesProposalFilter(
        row(editWording),
        { text: 'MINIMUM', state: 'all' },
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(true);
  });

  it('matches case-insensitively when the summary contains upper-case', () => {
    const all_lower: ProposalPayload = {
      kind: 'edit-wording',
      edit_kind: 'reword',
      node_id: NODE_X,
      new_wording: 'PUBLIC TRANSIT',
    };
    expect(
      matchesProposalFilter(
        row(all_lower),
        { text: 'public', state: 'all' },
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(true);
  });

  it('rejects a substring not present in the summary', () => {
    expect(
      matchesProposalFilter(
        row(editWording),
        { text: 'transit', state: 'all' },
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(false);
  });

  it('trims leading and trailing whitespace from the query before matching', () => {
    expect(
      matchesProposalFilter(
        row(editWording),
        { text: '   wage   ', state: 'all' },
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(true);
  });

  it('treats a whitespace-only query as empty (no narrowing)', () => {
    // The state arm is non-default to bypass the default fast-path so
    // the text branch's whitespace handling is what's under test.
    // Use 'all' for state so the predicate result is dominated by the
    // text branch.
    const f: ProposalFilter = { text: '   \t  ', state: 'all' };
    expect(
      matchesProposalFilter(
        row(editWording),
        f,
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(true);
  });
});

describe('matchesProposalFilter — state filter', () => {
  it('state=all always passes the state branch', () => {
    expect(
      matchesProposalFilter(
        row(editWording),
        { text: 'wage', state: 'all' },
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(true);
  });

  it("state=ready aligns with deriveAllAgree's {ok: true} for a classify-node", () => {
    // Hand-rolled scenario: two participants, both voted agree on the
    // classification facet. The predicate must agree with
    // `deriveAllAgree` on the row's derived entries.
    const participants = new Set<string>([PARTICIPANT_A, PARTICIPANT_B]);
    const votes: readonly Vote[] = [
      { participantId: PARTICIPANT_A, choice: 'agree' },
      { participantId: PARTICIPANT_B, choice: 'agree' },
    ];
    const votesIndex = votesIndexWith(NODE_X, 'classification', votes);

    const entries = derivePerProposalFacets(classifyNode, EMPTY_INDEX, undefined, votesIndex);
    expect(deriveAllAgree(entries, participants).ok).toBe(true);

    expect(
      matchesProposalFilter(
        row(classifyNode),
        { text: '', state: 'ready' },
        participants,
        votesIndex,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(true);
  });

  it('state=ready rejects when one participant has not voted', () => {
    const participants = new Set<string>([PARTICIPANT_A, PARTICIPANT_B]);
    const votes: readonly Vote[] = [{ participantId: PARTICIPANT_A, choice: 'agree' }];
    const votesIndex = votesIndexWith(NODE_X, 'classification', votes);

    const entries = derivePerProposalFacets(classifyNode, EMPTY_INDEX, undefined, votesIndex);
    expect(deriveAllAgree(entries, participants).ok).toBe(false);

    expect(
      matchesProposalFilter(
        row(classifyNode),
        { text: '', state: 'ready' },
        participants,
        votesIndex,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(false);
  });

  it('state=ready rejects when a participant voted dispute', () => {
    const participants = new Set<string>([PARTICIPANT_A, PARTICIPANT_B]);
    const votes: readonly Vote[] = [
      { participantId: PARTICIPANT_A, choice: 'agree' },
      { participantId: PARTICIPANT_B, choice: 'dispute' },
    ];
    const votesIndex = votesIndexWith(NODE_X, 'classification', votes);

    const entries = derivePerProposalFacets(classifyNode, EMPTY_INDEX, undefined, votesIndex);
    expect(deriveAllAgree(entries, participants).ok).toBe(false);

    expect(
      matchesProposalFilter(
        row(classifyNode),
        { text: '', state: 'ready' },
        participants,
        votesIndex,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(false);
  });

  it('state=ready rejects structural sub-kinds (commit-gate priority 2)', () => {
    // A break-edge proposal is structural — `deriveAllAgree` emits the
    // `'structural-sub-kind-not-supported'` reason.
    const breakEdge: ProposalPayload = { kind: 'break-edge', edge_id: EDGE_E };
    const participants = new Set<string>([PARTICIPANT_A]);
    expect(
      matchesProposalFilter(
        row(breakEdge),
        { text: '', state: 'ready' },
        participants,
        EMPTY_VOTES_INDEX,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(false);
  });

  it('state=disputed accepts when at least one facet entry is disputed via the client-mirror index', () => {
    const index = indexWith('node', NODE_X, 'classification', 'disputed');
    expect(
      matchesProposalFilter(
        row(classifyNode),
        { text: '', state: 'disputed' },
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        index,
        undefined,
      ),
    ).toBe(true);
  });

  it('state=disputed accepts when the server frame says disputed (server precedence)', () => {
    expect(
      matchesProposalFilter(
        row(classifyNode),
        { text: '', state: 'disputed' },
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        EMPTY_INDEX,
        { classification: 'disputed' },
      ),
    ).toBe(true);
  });

  it('state=disputed rejects when no facet entry is disputed (default proposed)', () => {
    expect(
      matchesProposalFilter(
        row(classifyNode),
        { text: '', state: 'disputed' },
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(false);
  });

  it('state=disputed rejects when the only facet is agreed', () => {
    const index = indexWith('node', NODE_X, 'classification', 'agreed');
    expect(
      matchesProposalFilter(
        row(classifyNode),
        { text: '', state: 'disputed' },
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        index,
        undefined,
      ),
    ).toBe(false);
  });
});

describe('matchesProposalFilter — AND composition', () => {
  it('passes only when both text and state match', () => {
    const participants = new Set<string>([PARTICIPANT_A]);
    const votes: readonly Vote[] = [{ participantId: PARTICIPANT_A, choice: 'agree' }];
    const votesIndex = votesIndexWith(NODE_X, 'wording', votes);

    // text matches AND state=ready matches → true
    expect(
      matchesProposalFilter(
        row(editWording),
        { text: 'wage', state: 'ready' },
        participants,
        votesIndex,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(true);
  });

  it('rejects when text matches but state=ready does not', () => {
    // No participants → no-current-participants reason → gate blocks.
    expect(
      matchesProposalFilter(
        row(editWording),
        { text: 'wage', state: 'ready' },
        NO_PARTICIPANTS,
        EMPTY_VOTES_INDEX,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(false);
  });

  it('rejects when state=ready matches but text does not', () => {
    const participants = new Set<string>([PARTICIPANT_A]);
    const votes: readonly Vote[] = [{ participantId: PARTICIPANT_A, choice: 'agree' }];
    const votesIndex = votesIndexWith(NODE_X, 'wording', votes);

    expect(
      matchesProposalFilter(
        row(editWording),
        { text: 'transit', state: 'ready' },
        participants,
        votesIndex,
        EMPTY_INDEX,
        undefined,
      ),
    ).toBe(false);
  });
});

describe('matchesProposalFilter — purity', () => {
  it('two calls with the same inputs return the same result', () => {
    const f: ProposalFilter = { text: 'wage', state: 'disputed' };
    const index = indexWith('node', NODE_X, 'wording', 'disputed');
    const r1 = matchesProposalFilter(
      row(editWording),
      f,
      NO_PARTICIPANTS,
      EMPTY_VOTES_INDEX,
      index,
      undefined,
    );
    const r2 = matchesProposalFilter(
      row(editWording),
      f,
      NO_PARTICIPANTS,
      EMPTY_VOTES_INDEX,
      index,
      undefined,
    );
    expect(r1).toBe(r2);
    expect(r1).toBe(true);
  });
});

describe('matchesProposalFilter — text branch matches summaryText for each of the eleven sub-kinds', () => {
  const cases: { name: string; payload: ProposalPayload; query: string }[] = [
    {
      name: 'classify-node',
      payload: { kind: 'classify-node', node_id: NODE_X, classification: 'fact' },
      // summaryText: `node ${NODE_X.slice(0, 8)}`
      query: NODE_X.slice(0, 8),
    },
    {
      name: 'set-node-substance',
      payload: { kind: 'set-node-substance', node_id: NODE_X, value: 'agreed' },
      query: 'set substance',
    },
    {
      name: 'set-edge-substance',
      payload: { kind: 'set-edge-substance', edge_id: EDGE_E, value: 'agreed' },
      query: 'set substance',
    },
    {
      name: 'edit-wording',
      payload: {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: NODE_X,
        new_wording: 'updated wording',
      },
      query: 'updated',
    },
    {
      name: 'edit-wording (restructure)',
      payload: {
        kind: 'edit-wording',
        edit_kind: 'restructure',
        node_id: NODE_X,
        new_wording: 'restructured wording',
        new_node_id: NODE_Y,
      },
      query: 'restructured',
    },
    {
      name: 'amend-node',
      payload: { kind: 'amend-node', node_id: NODE_X, new_content: 'amended content' },
      query: 'amended',
    },
    {
      name: 'meta-move',
      payload: {
        kind: 'meta-move',
        meta_kind: 'reframe',
        content: 'shifted the framing',
        target_kind: 'node',
        target_id: NODE_X,
      },
      query: 'reframe',
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
      query: 'clarifying',
    },
    {
      name: 'decompose',
      payload: {
        kind: 'decompose',
        parent_node_id: NODE_X,
        components: [
          {
            wording: 'first component',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-00000000f011',
          },
          {
            wording: 'second component',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-00000000f012',
          },
        ],
      },
      query: 'decompose',
    },
    {
      name: 'interpretive-split',
      payload: {
        kind: 'interpretive-split',
        parent_node_id: NODE_X,
        readings: [
          {
            wording: 'reading one',
            classification: 'value',
            node_id: '00000000-0000-4000-8000-00000000f013',
          },
          {
            wording: 'reading two',
            classification: 'value',
            node_id: '00000000-0000-4000-8000-00000000f014',
          },
        ],
      },
      query: 'split',
    },
    {
      name: 'axiom-mark',
      payload: { kind: 'axiom-mark', node_id: NODE_X, participant: PARTICIPANT_A },
      query: 'axiom',
    },
    {
      name: 'break-edge',
      payload: { kind: 'break-edge', edge_id: EDGE_E },
      query: 'break edge',
    },
  ];

  for (const c of cases) {
    it(`text query matches the summary for sub-kind '${c.name}'`, () => {
      // Sanity: the query is actually a substring of summaryText.
      expect(summaryText(c.payload).toLowerCase()).toContain(c.query.toLowerCase());
      expect(
        matchesProposalFilter(
          row(c.payload),
          { text: c.query, state: 'all' },
          NO_PARTICIPANTS,
          EMPTY_VOTES_INDEX,
          EMPTY_INDEX,
          undefined,
        ),
      ).toBe(true);
    });
  }
});
