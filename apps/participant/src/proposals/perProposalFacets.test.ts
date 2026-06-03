// Vitest cases for the participant's `derivePerProposalFacets` selector.
//
// Refinement: tasks/refinements/participant-ui/part_migrate_to_pending_proposal_facet_status.md
//   (prior:    tasks/refinements/participant-ui/part_per_facet_breakdown_in_pane.md)
//
// Per ADR 0022 these are committed Vitest cases. They pin the selector
// contract enumerated in the refinement's Acceptance criteria. Per D2
// the three-tier precedence (server frame → client mirror → default)
// collapses to two tiers (merged-index → `'proposed'` default) because
// the pane now passes a `FacetStatusIndex` that already merges the
// broadcast-derived per-entity cell map over the events-derived mirror
// with broadcast winning per cell.
//
//   (a) Each of the five facet-targeting sub-kinds (capture-node +
//       classify-node + set-node-substance + set-edge-substance +
//       edit-wording reword/restructure) emits one entry with the
//       expected `facet` value.
//   (b) Each of the seven structural sub-kinds (decompose,
//       interpretive-split, axiom-mark, meta-move, break-edge,
//       amend-node, annotate) emits one entry with `facet: 'proposal'`.
//   (c) Merged-index value is returned when present for the facet.
//   (d) Default-to-`'proposed'` when the merged index does NOT carry
//       the facet (post-subscribe / pre-seed window).
//   (e) Pure (two calls with the same inputs return deep-equal outputs).

import { describe, expect, it } from 'vitest';
import type { ProposalPayload } from '@a-conversa/shared-types';
import {
  EMPTY_VOTES,
  type FacetName,
  type FacetStatus,
  type FacetStatusIndex,
  type Vote,
  type VotesByFacetIndex,
} from '@a-conversa/shell';

import { derivePerProposalFacets } from './perProposalFacets';
import type { OtherVotesByProposalIndex } from './otherVotesByProposal';

const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000c1';

const EMPTY_INDEX: FacetStatusIndex = {
  nodes: new Map(),
  edges: new Map(),
  annotations: new Map(),
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
      annotations: new Map(),
    };
  }
  return {
    nodes: new Map(),
    edges: new Map([[entityId, inner]]),
    annotations: new Map(),
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
      const out = derivePerProposalFacets(payload, EMPTY_INDEX);
      expect(out, `${name}: should emit exactly one entry`).toHaveLength(1);
      expect(out[0]?.facet, `${name}: facet`).toBe(expectedFacet);
      expect(out[0]?.labelKey, `${name}: labelKey`).toBe(`methodology.facet.${expectedFacet}`);
    }
  });
});

describe('derivePerProposalFacets — structural sub-kinds emit one synthetic "proposal" entry', () => {
  // `decompose` + `interpretive-split` are EXCLUDED from this group per
  // `part_pw_multi_component_decompose_per_component_breakdown.md` — those
  // two sub-kinds fan out per-component entries (one `'classification'`
  // chip per component) instead of the synthetic `'proposal'` chip. The
  // other five structural sub-kinds keep the synthetic-`'proposal'`
  // contract because their payloads carry no per-component list.
  const structuralCases: { name: string; payload: ProposalPayload }[] = [
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
      const out = derivePerProposalFacets(payload, EMPTY_INDEX);
      expect(out, `${name}: should emit exactly one entry`).toHaveLength(1);
      expect(out[0]?.facet, `${name}: facet`).toBe('proposal');
      expect(out[0]?.labelKey, `${name}: labelKey`).toBe('methodology.facet.proposal');
    }
  });
});

describe('derivePerProposalFacets — status precedence: merged-index → default', () => {
  const classifyNode: ProposalPayload = {
    kind: 'classify-node',
    node_id: NODE_X,
    classification: 'fact',
  };

  it('returns the merged-index value when the index carries the facet', () => {
    const index = indexWith('node', NODE_X, 'classification', 'agreed');
    const out = derivePerProposalFacets(classifyNode, index);
    expect(out[0]?.status).toBe('agreed');
  });

  it('defaults to "proposed" when the merged index does not carry the facet (facet-targeting + structural sub-kinds alike)', () => {
    expect(derivePerProposalFacets(classifyNode, EMPTY_INDEX)[0]?.status).toBe('proposed');
    const axiomMark: ProposalPayload = {
      kind: 'axiom-mark',
      node_id: NODE_X,
      participant: PARTICIPANT_A,
    };
    expect(derivePerProposalFacets(axiomMark, EMPTY_INDEX)[0]?.status).toBe('proposed');
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
    const a = derivePerProposalFacets(proposal, index);
    const b = derivePerProposalFacets(proposal, index);
    expect(a).toEqual(b);
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
): VotesByFacetIndex {
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
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, index);
    expect(out).toHaveLength(1);
    expect(out[0]?.facet).toBe('wording');
    expect(out[0]?.votes).toEqual(votes);
  });

  it('(h) structural sub-kind with two votes in votesByProposalIndex → entries[0].votes has length 2; entries[0].facet === "proposal"', () => {
    // Per `part_pw_multi_component_decompose_per_component_breakdown.md`,
    // `decompose` + `interpretive-split` now fan out per-component
    // entries — they no longer hit the synthetic-`'proposal'` arm.
    // Retarget the case to `axiom-mark`, one of the five non-componented
    // structural sub-kinds that still emits the synthetic chip.
    const proposal: ProposalPayload = {
      kind: 'axiom-mark',
      node_id: NODE_X,
      participant: PARTICIPANT_A,
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
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX, undefined, undefined, byProposal);
    expect(out[0]?.facet).toBe('proposal');
    expect(out[0]?.votes).toBe(EMPTY_VOTES);
  });
});

// -- voteTarget extension (`part_vote_button_per_facet`) ------------
//
// Each entry carries a discriminated `voteTarget` field consumed by the
// chip's in-place vote-button affordance.

describe('derivePerProposalFacets — voteTarget field (part_vote_button_per_facet)', () => {
  it('(j) facet-targeting sub-kind (capture-node) → voteTarget is facet arm with the (entity_kind, entity_id, facet) triple', () => {
    const proposal: ProposalPayload = {
      kind: 'capture-node',
      node_id: NODE_X,
      wording: 'fresh wording',
    };
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX);
    expect(out[0]?.voteTarget).toEqual({
      kind: 'facet',
      entity_kind: 'node',
      entity_id: NODE_X,
      facet: 'wording',
    });
  });

  it('(k) edge-facet sub-kind (set-edge-substance) → voteTarget is facet arm with entity_kind="edge"', () => {
    const proposal: ProposalPayload = {
      kind: 'set-edge-substance',
      edge_id: EDGE_E,
      value: 'agreed',
    };
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX);
    expect(out[0]?.voteTarget).toEqual({
      kind: 'facet',
      entity_kind: 'edge',
      entity_id: EDGE_E,
      facet: 'substance',
    });
  });

  it('(l) structural sub-kind (axiom-mark) with a defined proposalEventId → voteTarget is proposal arm with proposal_id', () => {
    // Predecessor seeded `decompose` here; that sub-kind now fans out
    // per-component entries per
    // `part_pw_multi_component_decompose_per_component_breakdown.md`.
    // Use `axiom-mark` to keep the case targeting the synthetic-
    // `'proposal'` arm whose voteTarget contract this case pins.
    const proposal: ProposalPayload = {
      kind: 'axiom-mark',
      node_id: NODE_X,
      participant: PARTICIPANT_A,
    };
    const out = derivePerProposalFacets(
      proposal,
      EMPTY_INDEX,
      undefined,
      PROPOSAL_DECOMPOSE,
      undefined,
    );
    expect(out[0]?.voteTarget).toEqual({
      kind: 'proposal',
      proposal_id: PROPOSAL_DECOMPOSE,
    });
  });

  it("(l') structural sub-kind with proposalEventId === undefined → voteTarget.proposal_id is the empty-string fallback", () => {
    const proposal: ProposalPayload = {
      kind: 'axiom-mark',
      node_id: NODE_X,
      participant: PARTICIPANT_A,
    };
    const out = derivePerProposalFacets(proposal, EMPTY_INDEX);
    expect(out[0]?.voteTarget).toEqual({ kind: 'proposal', proposal_id: '' });
  });
});

// -- Per-component fan-out (`part_pw_multi_component_decompose_per_component_breakdown`)
//
// `decompose` + `interpretive-split` payloads carry a per-component list;
// the server emits one `proposal-status` envelope per component keyed by
// `(node, component.node_id, 'classification')`. The selector now fans
// out one `'classification'` entry per component, each resolving status
// against the merged index by the component's `node_id`. The vote target
// stays the shared proposal-arm (Decision §4).

const COMPONENT_1 = '00000000-0000-4000-8000-00000000f001';
const COMPONENT_2 = '00000000-0000-4000-8000-00000000f002';
const COMPONENT_3 = '00000000-0000-4000-8000-00000000f003';

describe('derivePerProposalFacets — per-component fan-out (decompose + interpretive-split)', () => {
  it('(m) decompose with 2 components, both cells absent → 2 entries, each facet="classification", both status="proposed", voteTarget proposal-arm with the proposal envelope id', () => {
    const proposal: ProposalPayload = {
      kind: 'decompose',
      parent_node_id: NODE_X,
      components: [
        { wording: 'first', classification: 'fact', node_id: COMPONENT_1 },
        { wording: 'second', classification: 'fact', node_id: COMPONENT_2 },
      ],
    };
    const out = derivePerProposalFacets(
      proposal,
      EMPTY_INDEX,
      undefined,
      PROPOSAL_DECOMPOSE,
      undefined,
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.facet).toBe('classification');
    expect(out[1]?.facet).toBe('classification');
    expect(out[0]?.status).toBe('proposed');
    expect(out[1]?.status).toBe('proposed');
    expect(out[0]?.labelKey).toBe('methodology.facet.classification');
    expect(out[1]?.labelKey).toBe('methodology.facet.classification');
    expect(out[0]?.voteTarget).toEqual({ kind: 'proposal', proposal_id: PROPOSAL_DECOMPOSE });
    expect(out[1]?.voteTarget).toEqual({ kind: 'proposal', proposal_id: PROPOSAL_DECOMPOSE });
  });

  it('(n) decompose with 2 components, one cell carries "committed" → 2 entries in payload order; statuses match the cell-map lookup (NOT sorted by status)', () => {
    const proposal: ProposalPayload = {
      kind: 'decompose',
      parent_node_id: NODE_X,
      components: [
        { wording: 'first', classification: 'fact', node_id: COMPONENT_1 },
        { wording: 'second', classification: 'fact', node_id: COMPONENT_2 },
      ],
    };
    // Only COMPONENT_2 has a cell, and it's `'committed'`. COMPONENT_1
    // falls back to the default `'proposed'`. Payload order is C1 then
    // C2, so the entries surface as `['proposed', 'committed']` — NOT
    // sorted by status.
    const index: FacetStatusIndex = {
      nodes: new Map([[COMPONENT_2, { classification: 'committed' }]]),
      edges: new Map(),
      annotations: new Map(),
    };
    const out = derivePerProposalFacets(proposal, index, undefined, PROPOSAL_DECOMPOSE, undefined);
    expect(out).toHaveLength(2);
    expect(out[0]?.status).toBe('proposed');
    expect(out[1]?.status).toBe('committed');
  });

  it('(o) interpretive-split with 3 readings → 3 entries, each facet="classification"', () => {
    const proposal: ProposalPayload = {
      kind: 'interpretive-split',
      parent_node_id: NODE_X,
      readings: [
        { wording: 'reading 1', classification: 'value', node_id: COMPONENT_1 },
        { wording: 'reading 2', classification: 'value', node_id: COMPONENT_2 },
        { wording: 'reading 3', classification: 'value', node_id: COMPONENT_3 },
      ],
    };
    const out = derivePerProposalFacets(
      proposal,
      EMPTY_INDEX,
      undefined,
      PROPOSAL_DECOMPOSE,
      undefined,
    );
    expect(out).toHaveLength(3);
    expect(out[0]?.facet).toBe('classification');
    expect(out[1]?.facet).toBe('classification');
    expect(out[2]?.facet).toBe('classification');
  });
});
