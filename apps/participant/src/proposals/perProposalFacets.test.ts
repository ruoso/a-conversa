// Vitest cases for the participant's `derivePerProposalFacets` selector.
//
// Refinement: tasks/refinements/participant-ui/part_per_facet_breakdown_in_pane.md
//
// Per ADR 0022 these are committed Vitest cases. They pin the selector
// contract enumerated in the refinement's Acceptance criterion 5:
//
//   (a) Each of the five facet-targeting sub-kinds (capture-node +
//       classify-node + set-node-substance + set-edge-substance +
//       edit-wording reword/restructure) emits one entry with the
//       expected `facet` value.
//   (b) Each of the seven structural sub-kinds (decompose,
//       interpretive-split, axiom-mark, meta-move, break-edge,
//       amend-node, annotate) emits one entry with `facet: 'proposal'`.
//   (c) Server `serverPerFacetStatus[facet]` overrides the client mirror.
//   (d) Client mirror is used when `serverPerFacetStatus` is undefined
//       OR does not carry the facet.
//   (e) Default-to-`'proposed'` when neither surface carries the facet.
//   (f) Pure (two calls with the same inputs return deep-equal outputs).

import { describe, expect, it } from 'vitest';
import type { ProposalPayload } from '@a-conversa/shared-types';
import { EMPTY_VOTES, type Vote } from '@a-conversa/shell';

import { derivePerProposalFacets } from './perProposalFacets';
import type { OtherVotesByFacetIndex } from './otherVotesByFacet';
import type { OtherVotesByProposalIndex } from './otherVotesByProposal';
import type { FacetName, FacetStatus, FacetStatusIndex } from '../graph/facetStatus';

const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000c1';

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

describe('derivePerProposalFacets — facet-targeting sub-kinds emit one entry with the expected facet', () => {
  const facetTargetingCases: {
    name: string;
    payload: ProposalPayload;
    expectedFacet: FacetName;
  }[] = [
    {
      name: 'capture-node',
      payload: {
        kind: 'capture-node',
        node_id: NODE_X,
        wording: 'fresh wording',
      },
      expectedFacet: 'wording',
    },
    {
      name: 'classify-node',
      payload: { kind: 'classify-node', node_id: NODE_X, classification: 'fact' },
      expectedFacet: 'classification',
    },
    {
      name: 'set-node-substance',
      payload: { kind: 'set-node-substance', node_id: NODE_X, value: 'agreed' },
      expectedFacet: 'substance',
    },
    {
      name: 'set-edge-substance',
      payload: { kind: 'set-edge-substance', edge_id: EDGE_E, value: 'agreed' },
      expectedFacet: 'substance',
    },
    {
      name: 'edit-wording (reword)',
      payload: {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: NODE_X,
        new_wording: 'updated',
      },
      expectedFacet: 'wording',
    },
    {
      name: 'edit-wording (restructure)',
      payload: {
        kind: 'edit-wording',
        edit_kind: 'restructure',
        node_id: NODE_X,
        new_wording: 'rebuilt',
        new_node_id: NODE_Y,
      },
      expectedFacet: 'wording',
    },
  ];

  it('emits one entry per facet-targeting sub-kind with the expected facet + labelKey', () => {
    for (const { name, payload, expectedFacet } of facetTargetingCases) {
      const out = derivePerProposalFacets(payload, EMPTY_INDEX, undefined);
      expect(out, `${name}: should emit exactly one entry`).toHaveLength(1);
      expect(out[0]?.facet, `${name}: facet`).toBe(expectedFacet);
      expect(out[0]?.labelKey, `${name}: labelKey`).toBe(`methodology.facet.${expectedFacet}`);
    }
  });
});

describe('derivePerProposalFacets — structural sub-kinds emit one synthetic "proposal" entry', () => {
  const structuralCases: { name: string; payload: ProposalPayload }[] = [
    {
      name: 'decompose',
      payload: {
        kind: 'decompose',
        parent_node_id: NODE_X,
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
    {
      name: 'interpretive-split',
      payload: {
        kind: 'interpretive-split',
        parent_node_id: NODE_X,
        readings: [
          {
            wording: 'reading 1',
            classification: 'value',
            node_id: '00000000-0000-4000-8000-00000000f043',
          },
          {
            wording: 'reading 2',
            classification: 'value',
            node_id: '00000000-0000-4000-8000-00000000f044',
          },
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

  it('emits one synthetic "proposal" entry per structural sub-kind', () => {
    for (const { name, payload } of structuralCases) {
      const out = derivePerProposalFacets(payload, EMPTY_INDEX, undefined);
      expect(out, `${name}: should emit exactly one entry`).toHaveLength(1);
      expect(out[0]?.facet, `${name}: facet`).toBe('proposal');
      expect(out[0]?.labelKey, `${name}: labelKey`).toBe('methodology.facet.proposal');
    }
  });
});

describe('derivePerProposalFacets — status precedence: server → client mirror → default', () => {
  const classifyNode: ProposalPayload = {
    kind: 'classify-node',
    node_id: NODE_X,
    classification: 'fact',
  };

  it('server perFacetStatus overrides the client mirror for the same facet', () => {
    const clientIndex = indexWith('node', NODE_X, 'classification', 'agreed');
    const server: Record<string, string> = { classification: 'disputed' };
    const out = derivePerProposalFacets(classifyNode, clientIndex, server);
    expect(out[0]?.status).toBe('disputed');
  });

  it('client mirror is used when server perFacetStatus is undefined OR does not carry the facet', () => {
    const clientIndex = indexWith('node', NODE_X, 'classification', 'agreed');
    expect(
      derivePerProposalFacets(classifyNode, clientIndex, undefined)[0]?.status,
      'undefined server frame falls through to client mirror',
    ).toBe('agreed');
    const serverWithoutKey: Record<string, string> = { substance: 'disputed' };
    expect(
      derivePerProposalFacets(classifyNode, clientIndex, serverWithoutKey)[0]?.status,
      'server frame missing the facet key falls through to client mirror',
    ).toBe('agreed');
  });

  it('defaults to "proposed" when neither surface carries the facet (and structural sub-kinds default the same way)', () => {
    expect(derivePerProposalFacets(classifyNode, EMPTY_INDEX, undefined)[0]?.status).toBe(
      'proposed',
    );
    const axiomMark: ProposalPayload = {
      kind: 'axiom-mark',
      node_id: NODE_X,
      participant: PARTICIPANT_A,
    };
    expect(derivePerProposalFacets(axiomMark, EMPTY_INDEX, undefined)[0]?.status).toBe('proposed');
  });
});

describe('derivePerProposalFacets — purity', () => {
  it('two calls with the same inputs return deep-equal outputs and do not mutate the inputs', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    const index = indexWith('node', NODE_X, 'classification', 'disputed');
    const server: Record<string, string> = { classification: 'agreed' };
    const serverBefore = { ...server };
    const a = derivePerProposalFacets(proposal, index, server);
    const b = derivePerProposalFacets(proposal, index, server);
    expect(a).toEqual(b);
    expect(server).toEqual(serverBefore);
    expect(index.nodes.get(NODE_X)).toEqual({ classification: 'disputed' });
  });
});

// -- Vote indicator extension (`part_vote_indicators_in_pane`) ------
//
// The selector grows three optional parameters; `ProposalFacetEntry`
// carries a `votes` field consumed by the in-chip indicator row.

const VOTER_A = '00000000-0000-4000-8000-00000000001a';
const VOTER_B = '00000000-0000-4000-8000-00000000001b';
const PROPOSAL_DECOMPOSE = '00000000-0000-4000-8000-0000000000d1';

function votesByFacetWith(
  entityId: string,
  facet: FacetName,
  votes: readonly Vote[],
): OtherVotesByFacetIndex {
  const inner = new Map<FacetName, readonly Vote[]>([[facet, votes]]);
  return new Map<string, ReadonlyMap<FacetName, readonly Vote[]>>([[entityId, inner]]);
}

function votesByProposalWith(
  proposalId: string,
  votes: readonly Vote[],
): OtherVotesByProposalIndex {
  return new Map<string, readonly Vote[]>([[proposalId, votes]]);
}

describe('derivePerProposalFacets — votes field (part_vote_indicators_in_pane)', () => {
  it('(g) facet-targeting sub-kind with two votes in votesByFacetIndex → entries[0].votes has both voters in arrival order', () => {
    const proposal: ProposalPayload = {
      kind: 'capture-node',
      node_id: NODE_X,
      wording: 'fresh wording',
    };
    const votes: readonly Vote[] = [
      { participantId: VOTER_A, choice: 'agree' },
      { participantId: VOTER_B, choice: 'dispute' },
    ];
    const index = votesByFacetWith(NODE_X, 'wording', votes);
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined, index);
    expect(out).toHaveLength(1);
    expect(out[0]?.facet).toBe('wording');
    expect(out[0]?.votes).toEqual(votes);
  });

  it('(h) structural sub-kind with two votes in votesByProposalIndex → entries[0].votes has length 2; entries[0].facet === "proposal"', () => {
    const proposal: ProposalPayload = {
      kind: 'decompose',
      parent_node_id: NODE_X,
      components: [
        {
          wording: 'first',
          classification: 'fact',
          node_id: '00000000-0000-4000-8000-00000000f001',
        },
        {
          wording: 'second',
          classification: 'fact',
          node_id: '00000000-0000-4000-8000-00000000f002',
        },
      ],
    };
    const votes: readonly Vote[] = [
      { participantId: VOTER_A, choice: 'agree' },
      { participantId: VOTER_B, choice: 'agree' },
    ];
    const byProposal = votesByProposalWith(PROPOSAL_DECOMPOSE, votes);
    const out = derivePerProposalFacets(
      proposal,
      EMPTY_INDEX,
      undefined,
      undefined,
      PROPOSAL_DECOMPOSE,
      byProposal,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.facet).toBe('proposal');
    expect(out[0]?.votes).toEqual(votes);
  });

  it('(i) proposalEventId === undefined AND structural sub-kind → entries[0].votes === EMPTY_VOTES', () => {
    const proposal: ProposalPayload = {
      kind: 'axiom-mark',
      node_id: NODE_X,
      participant: PARTICIPANT_A,
    };
    const byProposal = votesByProposalWith(PROPOSAL_DECOMPOSE, [
      { participantId: VOTER_A, choice: 'agree' },
    ]);
    const out = derivePerProposalFacets(
      proposal,
      EMPTY_INDEX,
      undefined,
      undefined,
      undefined,
      byProposal,
    );
    expect(out[0]?.facet).toBe('proposal');
    expect(out[0]?.votes).toBe(EMPTY_VOTES);
  });
});
