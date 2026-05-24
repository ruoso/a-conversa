// Vitest cases for `autoSelect.ts` — proposal-envelope → auto-select
// target derivation for the participant detail panel.
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They pin:
//
//   1. Non-proposal events (`vote`, `commit`, `node-created`,
//      `edge-created`, lifecycle) return `null`.
//   2. Every proposal sub-kind maps to the documented target.
//      `capture-node` with an inline `edge` block picks the edge
//      (the gesture's substance); without it, picks the new node.
//   3. `decompose` / `interpretive-split` pick the parent (not the
//      per-child component); this is the conversational focus.
//   4. `meta-move` / `annotate` honor the inline `target_kind`.

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { autoSelectionFromEvent } from './autoSelect';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const NODE_A = '11111111-1111-4111-8111-111111111111';
const NODE_B = '11111111-1111-4111-8111-111111111112';
const NODE_C = '11111111-1111-4111-8111-111111111113';
const EDGE_A = '22222222-2222-4222-8222-222222222221';

function proposalEvent(opts: {
  sequence: number;
  envelopeId: string;
  proposal: import('@a-conversa/shared-types').ProposalPayload;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: { proposal: opts.proposal },
    createdAt: '2026-05-24T00:00:00.000Z',
  };
}

describe('autoSelectionFromEvent', () => {
  it('returns null for non-proposal events', () => {
    const nodeCreated: Event = {
      id: '99999999-9999-4999-8999-999999999991',
      sessionId: SESSION_ID,
      sequence: 1,
      kind: 'node-created',
      actor: ACTOR,
      payload: {
        node_id: NODE_A,
        wording: 'hello',
        created_by: ACTOR,
        created_at: '2026-05-24T00:00:00.000Z',
      },
      createdAt: '2026-05-24T00:00:00.000Z',
    };
    expect(autoSelectionFromEvent(nodeCreated)).toBeNull();
  });

  it('picks the new node for a wording-only capture-node', () => {
    const event = proposalEvent({
      sequence: 10,
      envelopeId: '99999999-9999-4999-8999-999999999910',
      proposal: { kind: 'capture-node', node_id: NODE_A, wording: 'hi' },
    });
    expect(autoSelectionFromEvent(event)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('picks the inline edge for a connecting capture-node', () => {
    const event = proposalEvent({
      sequence: 11,
      envelopeId: '99999999-9999-4999-8999-999999999911',
      proposal: {
        kind: 'capture-node',
        node_id: NODE_B,
        wording: 'because',
        edge: {
          edge_id: EDGE_A,
          role: 'supports',
          source_node_id: NODE_B,
          target_node_id: NODE_A,
        },
      },
    });
    expect(autoSelectionFromEvent(event)).toEqual({ kind: 'edge', id: EDGE_A });
  });

  it('picks the targeted node for classify-node', () => {
    const event = proposalEvent({
      sequence: 12,
      envelopeId: '99999999-9999-4999-8999-999999999912',
      proposal: { kind: 'classify-node', node_id: NODE_A, classification: 'fact' },
    });
    expect(autoSelectionFromEvent(event)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('picks the targeted node for set-node-substance', () => {
    const event = proposalEvent({
      sequence: 13,
      envelopeId: '99999999-9999-4999-8999-999999999913',
      proposal: { kind: 'set-node-substance', node_id: NODE_A, value: 'agreed' },
    });
    expect(autoSelectionFromEvent(event)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('picks the targeted edge for set-edge-substance', () => {
    const event = proposalEvent({
      sequence: 14,
      envelopeId: '99999999-9999-4999-8999-999999999914',
      proposal: { kind: 'set-edge-substance', edge_id: EDGE_A, value: 'agreed' },
    });
    expect(autoSelectionFromEvent(event)).toEqual({ kind: 'edge', id: EDGE_A });
  });

  it('picks the parent node for decompose (not per-child)', () => {
    const event = proposalEvent({
      sequence: 15,
      envelopeId: '99999999-9999-4999-8999-999999999915',
      proposal: {
        kind: 'decompose',
        parent_node_id: NODE_A,
        components: [
          { node_id: NODE_B, wording: 'left', classification: 'fact' },
          { node_id: NODE_C, wording: 'right', classification: 'fact' },
        ],
      },
    });
    expect(autoSelectionFromEvent(event)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('picks the parent node for interpretive-split (not per-reading)', () => {
    const event = proposalEvent({
      sequence: 16,
      envelopeId: '99999999-9999-4999-8999-999999999916',
      proposal: {
        kind: 'interpretive-split',
        parent_node_id: NODE_A,
        readings: [
          { node_id: NODE_B, wording: 'a', classification: 'fact' },
          { node_id: NODE_C, wording: 'b', classification: 'fact' },
        ],
      },
    });
    expect(autoSelectionFromEvent(event)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('picks the targeted node for axiom-mark', () => {
    const event = proposalEvent({
      sequence: 17,
      envelopeId: '99999999-9999-4999-8999-999999999917',
      proposal: { kind: 'axiom-mark', node_id: NODE_A, participant: ACTOR },
    });
    expect(autoSelectionFromEvent(event)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('picks the inline target for meta-move', () => {
    const event = proposalEvent({
      sequence: 18,
      envelopeId: '99999999-9999-4999-8999-999999999918',
      proposal: {
        kind: 'meta-move',
        meta_kind: 'reframe',
        content: 'rethink',
        target_kind: 'edge',
        target_id: EDGE_A,
      },
    });
    expect(autoSelectionFromEvent(event)).toEqual({ kind: 'edge', id: EDGE_A });
  });

  it('picks the inline target for annotate', () => {
    const event = proposalEvent({
      sequence: 19,
      envelopeId: '99999999-9999-4999-8999-999999999919',
      proposal: {
        kind: 'annotate',
        target_kind: 'node',
        target_id: NODE_A,
        annotation_kind: 'note',
        content: 'see also',
      },
    });
    expect(autoSelectionFromEvent(event)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('picks the targeted node for edit-wording (reword)', () => {
    const event = proposalEvent({
      sequence: 20,
      envelopeId: '99999999-9999-4999-8999-999999999920',
      proposal: {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: NODE_A,
        new_wording: 'tweak',
      },
    });
    expect(autoSelectionFromEvent(event)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('picks the targeted node for amend-node', () => {
    const event = proposalEvent({
      sequence: 21,
      envelopeId: '99999999-9999-4999-8999-999999999921',
      proposal: { kind: 'amend-node', node_id: NODE_A, new_content: 'repaired' },
    });
    expect(autoSelectionFromEvent(event)).toEqual({ kind: 'node', id: NODE_A });
  });

  it('picks the targeted edge for break-edge', () => {
    const event = proposalEvent({
      sequence: 22,
      envelopeId: '99999999-9999-4999-8999-999999999922',
      proposal: { kind: 'break-edge', edge_id: EDGE_A },
    });
    expect(autoSelectionFromEvent(event)).toEqual({ kind: 'edge', id: EDGE_A });
  });
});
