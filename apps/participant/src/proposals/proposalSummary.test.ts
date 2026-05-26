// Tests for the participant `summaryText` helper.
//
// Refinement: tasks/refinements/participant-ui/part_proposal_list_view.md
//
// Mirrors the moderator's coverage adapted to the participant's import
// path. Per ADR 0022 these are committed Vitest cases. One case per
// sub-kind (twelve) plus the unknown-sub-kind fall-through (one), total
// thirteen — matches the refinement's "Test layers" §2 enumeration.

import { describe, expect, it } from 'vitest';
import type { ProposalPayload } from '@a-conversa/shared-types';

import { summaryText } from './proposalSummary';

const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000c1';

describe('summaryText (participant)', () => {
  it('(a) capture-node → "node <8-char prefix>"', () => {
    const proposal: ProposalPayload = {
      kind: 'capture-node',
      node_id: NODE_X,
      wording: 'fresh wording',
    };
    expect(summaryText(proposal)).toBe(`node ${NODE_X.slice(0, 8)}`);
  });

  it('(b) classify-node → "node <8-char prefix>"', () => {
    const proposal: ProposalPayload = {
      kind: 'classify-node',
      node_id: NODE_X,
      classification: 'fact',
    };
    expect(summaryText(proposal)).toBe(`node ${NODE_X.slice(0, 8)}`);
  });

  it('(c) set-node-substance → "Set substance = <value> (node <prefix>)"', () => {
    const proposal: ProposalPayload = {
      kind: 'set-node-substance',
      node_id: NODE_X,
      value: 'agreed',
    };
    expect(summaryText(proposal)).toBe(`Set substance = agreed (node ${NODE_X.slice(0, 8)})`);
  });

  it('(d) set-edge-substance → "Set substance = <value> (edge <prefix>)"', () => {
    const proposal: ProposalPayload = {
      kind: 'set-edge-substance',
      edge_id: EDGE_E,
      value: 'disputed',
    };
    expect(summaryText(proposal)).toBe(`Set substance = disputed (edge ${EDGE_E.slice(0, 8)})`);
  });

  it('(e) edit-wording → new_wording verbatim', () => {
    const proposal: ProposalPayload = {
      kind: 'edit-wording',
      edit_kind: 'reword',
      node_id: NODE_X,
      new_wording: 'updated wording',
    };
    expect(summaryText(proposal)).toBe('updated wording');
  });

  it('(f) amend-node → new_content verbatim', () => {
    const proposal: ProposalPayload = {
      kind: 'amend-node',
      node_id: NODE_X,
      new_content: 'amended content',
    };
    expect(summaryText(proposal)).toBe('amended content');
  });

  it('(g) meta-move → "<meta_kind>: <content>"', () => {
    const proposal: ProposalPayload = {
      kind: 'meta-move',
      meta_kind: 'reframe',
      content: 'reframing the discussion',
      target_kind: 'node',
      target_id: NODE_X,
    };
    expect(summaryText(proposal)).toBe('reframe: reframing the discussion');
  });

  it('(h) annotate → "<annotation_kind>: <content>"', () => {
    const proposal: ProposalPayload = {
      kind: 'annotate',
      target_kind: 'node',
      target_id: NODE_X,
      annotation_kind: 'note',
      content: 'a clarifying note',
    };
    expect(summaryText(proposal)).toBe('note: a clarifying note');
  });

  it('(i) decompose → "Decompose into <n> components"', () => {
    const proposal: ProposalPayload = {
      kind: 'decompose',
      parent_node_id: NODE_X,
      components: [
        {
          wording: 'first component',
          classification: 'fact',
          node_id: '00000000-0000-4000-8000-00000000f001',
        },
        {
          wording: 'second component',
          classification: 'fact',
          node_id: '00000000-0000-4000-8000-00000000f002',
        },
      ],
    };
    expect(summaryText(proposal)).toBe('Decompose into 2 components');
  });

  it('(j) interpretive-split → "Split into <n> readings"', () => {
    const proposal: ProposalPayload = {
      kind: 'interpretive-split',
      parent_node_id: NODE_X,
      readings: [
        {
          wording: 'reading one',
          classification: 'value',
          node_id: '00000000-0000-4000-8000-00000000f003',
        },
        {
          wording: 'reading two',
          classification: 'value',
          node_id: '00000000-0000-4000-8000-00000000f004',
        },
        {
          wording: 'reading three',
          classification: 'value',
          node_id: '00000000-0000-4000-8000-00000000f005',
        },
      ],
    };
    expect(summaryText(proposal)).toBe('Split into 3 readings');
  });

  it('(k) axiom-mark → "Axiom-mark (participant <8-char prefix>)"', () => {
    const proposal: ProposalPayload = {
      kind: 'axiom-mark',
      node_id: NODE_Y,
      participant: PARTICIPANT_A,
    };
    expect(summaryText(proposal)).toBe(`Axiom-mark (participant ${PARTICIPANT_A.slice(0, 8)})`);
  });

  it('(l) break-edge → "Break edge <8-char prefix>"', () => {
    const proposal: ProposalPayload = {
      kind: 'break-edge',
      edge_id: EDGE_E,
    };
    expect(summaryText(proposal)).toBe(`Break edge ${EDGE_E.slice(0, 8)}`);
  });

  it('(m) unknown sub-kind (cast hack) → raw `kind` string', () => {
    const proposal = { kind: 'made-up-kind' } as unknown as ProposalPayload;
    expect(summaryText(proposal)).toBe('made-up-kind');
  });
});
