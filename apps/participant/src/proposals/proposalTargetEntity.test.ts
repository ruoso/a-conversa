// Vitest cases for `proposalTargetEntity`.
//
// Refinement: tasks/refinements/participant-ui/part_proposal_notification.md
//   (Test layers per ADR 0022 — one case per sub-kind of the 11-arm
//    `ProposalPayload` union plus the two `edit-wording` inner variants
//    [reword + restructure] = 12 cases.)

import { describe, expect, it } from 'vitest';
import type { ProposalPayload } from '@a-conversa/shared-types';

import { proposalTargetEntity } from './proposalTargetEntity';

const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const EDGE_A = '00000000-0000-4000-8000-00000000000e';
const PARENT_A = '00000000-0000-4000-8000-0000000000aa';
const PARTICIPANT = '00000000-0000-4000-8000-0000000000c1';
const NEW_NODE = '00000000-0000-4000-8000-0000000000c2';

describe('proposalTargetEntity', () => {
  it('(a) capture-node → { node, node_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'capture-node',
      node_id: NODE_A,
      wording: 'a',
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('(b) classify-node → { node, node_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_A,
      classification: 'fact',
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('(c) set-node-substance → { node, node_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'set-node-substance',
      node_id: NODE_A,
      value: 'agreed',
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('(d) set-edge-substance → { edge, edge_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'set-edge-substance',
      edge_id: EDGE_A,
      value: 'disputed',
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'edge', id: EDGE_A });
  });

  it('(e) edit-wording reword → { node, node_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'edit-wording',
      edit_kind: 'reword',
      node_id: NODE_A,
      new_wording: 'new wording',
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('(f) edit-wording restructure → { node, source node_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'edit-wording',
      edit_kind: 'restructure',
      node_id: NODE_A,
      new_wording: 'new wording',
      new_node_id: NEW_NODE,
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('(g) decompose → { node, parent_node_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'decompose',
      parent_node_id: PARENT_A,
      components: [
        { wording: 'c1', classification: 'fact', node_id: NODE_A },
        { wording: 'c2', classification: 'fact', node_id: NODE_B },
      ],
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'node', id: PARENT_A });
  });

  it('(h) interpretive-split → { node, parent_node_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'interpretive-split',
      parent_node_id: PARENT_A,
      readings: [
        { wording: 'r1', classification: 'fact', node_id: NODE_A },
        { wording: 'r2', classification: 'fact', node_id: NODE_B },
      ],
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'node', id: PARENT_A });
  });

  it('(i) axiom-mark → { node, node_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'axiom-mark',
      node_id: NODE_A,
      participant: PARTICIPANT,
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('(j) meta-move targeting a node → { node, target_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'meta-move',
      meta_kind: 'reframe',
      content: 'reframe content',
      target_kind: 'node',
      target_id: NODE_A,
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('(k) meta-move targeting an edge → { edge, target_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'meta-move',
      meta_kind: 'scope-change',
      content: 'scope-change content',
      target_kind: 'edge',
      target_id: EDGE_A,
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'edge', id: EDGE_A });
  });

  it('(l) break-edge → { edge, edge_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'break-edge',
      edge_id: EDGE_A,
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'edge', id: EDGE_A });
  });

  it('(m) amend-node → { node, node_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'amend-node',
      node_id: NODE_A,
      new_content: 'amended content',
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('(n) annotate targeting a node → { node, target_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'annotate',
      target_kind: 'node',
      target_id: NODE_A,
      annotation_kind: 'note',
      content: 'note content',
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('(o) annotate targeting an edge → { edge, target_id }', () => {
    const proposal: ProposalPayload = {
      kind: 'annotate',
      target_kind: 'edge',
      target_id: EDGE_A,
      annotation_kind: 'note',
      content: 'note content',
    };
    expect(proposalTargetEntity(proposal)).toEqual({ kind: 'edge', id: EDGE_A });
  });
});
