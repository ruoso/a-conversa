// Pins for `computeSupersededNodeIds` — the shared client-side
// supersession derivation (the visible-graph rule of
// `docs/data-model.md` L276–289, seam decision in ADR 0047):
//
//   (a) a committed `decompose` supersedes the parent;
//   (b) a committed `interpretive-split` supersedes the parent;
//   (c) a committed `edit-wording.restructure` supersedes the old node;
//   (d) a pending structural proposal supersedes nothing;
//   (e) a withdrawn-before-commit proposal supersedes nothing;
//   (f) prefix behaviour — the node is absent from the set for every
//       prefix ending before the commit event and present at/after it
//       (the replay scrubber's contract).
//
// Refinement: tasks/refinements/moderator-ui/mod_decompose_split_parent_visibility.md
// ADRs: 0047 (client-derived supersession), 0022 (no throwaway
//       verifications).

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { computeSupersededNodeIds } from './supersession.js';

const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PARENT = '00000000-0000-4000-8000-00000000000a';
const COMPONENT_1 = '00000000-0000-4000-8000-00000000000b';
const COMPONENT_2 = '00000000-0000-4000-8000-00000000000c';
const NEW_NODE = '00000000-0000-4000-8000-00000000000d';
const PROPOSAL_ID = '11111111-1111-4111-8111-111111111111';
const AT = '2026-06-11T00:00:00.000Z';

function makeNodeCreated(opts: { sequence: number; nodeId: string; wording: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x100 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: opts.nodeId,
      wording: opts.wording,
      created_by: ACTOR,
      created_at: AT,
    },
    createdAt: AT,
  };
}

function makeDecomposeProposal(opts: {
  sequence: number;
  envelopeId: string;
  parentNodeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'decompose',
        parent_node_id: opts.parentNodeId,
        components: [
          { wording: 'first component', classification: 'fact', node_id: COMPONENT_1 },
          { wording: 'second component', classification: 'fact', node_id: COMPONENT_2 },
        ],
      },
    },
    createdAt: AT,
  };
}

function makeInterpretiveSplitProposal(opts: {
  sequence: number;
  envelopeId: string;
  parentNodeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'interpretive-split',
        parent_node_id: opts.parentNodeId,
        readings: [
          { wording: 'first reading', classification: 'fact', node_id: COMPONENT_1 },
          { wording: 'second reading', classification: 'fact', node_id: COMPONENT_2 },
        ],
      },
    },
    createdAt: AT,
  };
}

function makeRestructureProposal(opts: {
  sequence: number;
  envelopeId: string;
  oldNodeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'edit-wording',
        edit_kind: 'restructure',
        node_id: opts.oldNodeId,
        new_wording: 'restructured wording',
        new_node_id: NEW_NODE,
      },
    },
    createdAt: AT,
  };
}

function makeCommit(opts: { sequence: number; proposalEnvelopeId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x200 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      target: 'proposal',
      proposal_id: opts.proposalEnvelopeId,
      committed_by: ACTOR,
      committed_at: AT,
    },
    createdAt: AT,
  };
}

function makeProposalWithdrawn(opts: { sequence: number; proposalEnvelopeId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x300 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal-withdrawn',
    actor: ACTOR,
    payload: {
      proposal_id: opts.proposalEnvelopeId,
      withdrawn_by: ACTOR,
      withdrawn_at: AT,
    },
    createdAt: AT,
  };
}

describe('computeSupersededNodeIds', () => {
  it('(a) a committed decompose supersedes the parent', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: PARENT, wording: 'parent' }),
      makeDecomposeProposal({ sequence: 2, envelopeId: PROPOSAL_ID, parentNodeId: PARENT }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_ID }),
    ];
    expect(computeSupersededNodeIds(events)).toEqual(new Set([PARENT]));
  });

  it('(b) a committed interpretive-split supersedes the parent', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: PARENT, wording: 'parent' }),
      makeInterpretiveSplitProposal({
        sequence: 2,
        envelopeId: PROPOSAL_ID,
        parentNodeId: PARENT,
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_ID }),
    ];
    expect(computeSupersededNodeIds(events)).toEqual(new Set([PARENT]));
  });

  it('(c) a committed edit-wording.restructure supersedes the old node', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: PARENT, wording: 'old wording' }),
      makeRestructureProposal({ sequence: 2, envelopeId: PROPOSAL_ID, oldNodeId: PARENT }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_ID }),
    ];
    expect(computeSupersededNodeIds(events)).toEqual(new Set([PARENT]));
  });

  it('(d) a pending structural proposal supersedes nothing', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: PARENT, wording: 'parent' }),
      makeDecomposeProposal({ sequence: 2, envelopeId: PROPOSAL_ID, parentNodeId: PARENT }),
    ];
    expect(computeSupersededNodeIds(events).size).toBe(0);
  });

  it('(e) a withdrawn-before-commit proposal supersedes nothing', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: PARENT, wording: 'parent' }),
      makeInterpretiveSplitProposal({
        sequence: 2,
        envelopeId: PROPOSAL_ID,
        parentNodeId: PARENT,
      }),
      makeProposalWithdrawn({ sequence: 3, proposalEnvelopeId: PROPOSAL_ID }),
      // Defensive: even a (protocol-violating) commit referencing the
      // withdrawn envelope supersedes nothing — the withdraw cleared
      // the pending record.
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_ID }),
    ];
    expect(computeSupersededNodeIds(events).size).toBe(0);
  });

  it('(f) prefix behaviour — absent before the commit event, present at/after it', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: PARENT, wording: 'parent' }),
      makeDecomposeProposal({ sequence: 2, envelopeId: PROPOSAL_ID, parentNodeId: PARENT }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_ID }),
      makeNodeCreated({ sequence: 4, nodeId: COMPONENT_1, wording: 'later node' }),
    ];
    // Every prefix ending BEFORE the commit: parent not superseded.
    for (let end = 0; end < 3; end++) {
      expect(computeSupersededNodeIds(events.slice(0, end)).has(PARENT)).toBe(false);
    }
    // Every prefix at/after the commit: parent superseded.
    for (let end = 3; end <= events.length; end++) {
      expect(computeSupersededNodeIds(events.slice(0, end)).has(PARENT)).toBe(true);
    }
  });
});
