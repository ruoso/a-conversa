// Tests for `affectedEntities` — the pure per-`EventKind` map from one
// event to the graph entities it touched.
//
// Refinement: tasks/refinements/moderator-ui/mod_history_click_to_flash.md
//             (Acceptance §1–§8)
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// Per ADR 0022 these are committed Vitest cases. They pin the helper's
// totality over `EventKind`, the per-kind id extraction, the facet-vs-
// proposal arm split on the `target`-discriminated kinds, and the
// representative proposal sub-kinds.

import { describe, expect, it } from 'vitest';
import type { Event, EventKind } from '@a-conversa/shared-types';

import { affectedEntities } from './affectedEntities';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const TS = '2026-06-03T00:00:00.000Z';

function ev(kind: EventKind, payload: unknown, overrides: Partial<Event> = {}): Event {
  return {
    id: '00000000-0000-4000-8000-0000000000f1',
    sessionId: SESSION,
    sequence: 1,
    kind,
    actor: ACTOR,
    payload,
    createdAt: TS,
    ...overrides,
  } as Event;
}

describe('affectedEntities — structural entity kinds', () => {
  it('node-created → the node id in nodeIds, no edges', () => {
    const e = ev('node-created', {
      node_id: 'n1',
      wording: 'w',
      created_by: ACTOR,
      created_at: TS,
    });
    expect(affectedEntities(e)).toEqual({ nodeIds: ['n1'], edgeIds: [] });
  });

  it('edge-created → the edge id in edgeIds; node endpoints in nodeIds', () => {
    const e = ev('edge-created', {
      edge_id: 'e1',
      role: 'supports',
      source_node_id: 'n1',
      target_node_id: 'n2',
      created_by: ACTOR,
      created_at: TS,
    });
    expect(affectedEntities(e)).toEqual({ nodeIds: ['n1', 'n2'], edgeIds: ['e1'] });
  });

  it('edge-created → annotation endpoints land in nodeIds (promoted-annotation ids are node ids)', () => {
    // The XOR endpoints: a source annotation + a target node.
    const e = ev('edge-created', {
      edge_id: 'e1',
      role: 'rebuts',
      source_annotation_id: 'a1',
      target_node_id: 'n2',
      created_by: ACTOR,
      created_at: TS,
    });
    expect(affectedEntities(e)).toEqual({ nodeIds: ['a1', 'n2'], edgeIds: ['e1'] });
  });

  it('annotation-created → annotation id in nodeIds; a node host lands in nodeIds', () => {
    const e = ev('annotation-created', {
      annotation_id: 'a1',
      kind: 'note',
      content: 'c',
      target_node_id: 'n1',
      target_edge_id: null,
      created_by: ACTOR,
      created_at: TS,
    });
    expect(affectedEntities(e)).toEqual({ nodeIds: ['a1', 'n1'], edgeIds: [] });
  });

  it('annotation-created → an edge host lands in edgeIds', () => {
    const e = ev('annotation-created', {
      annotation_id: 'a1',
      kind: 'note',
      content: 'c',
      target_node_id: null,
      target_edge_id: 'e1',
      created_by: ACTOR,
      created_at: TS,
    });
    expect(affectedEntities(e)).toEqual({ nodeIds: ['a1'], edgeIds: ['e1'] });
  });
});

describe('affectedEntities — entity-include / -remove classify by entity_kind', () => {
  it('entity-included node → nodeIds; edge → edgeIds; annotation → nodeIds', () => {
    const node = ev('entity-included', {
      entity_kind: 'node',
      entity_id: 'n1',
      included_by: ACTOR,
      included_at: TS,
    });
    const edge = ev('entity-included', {
      entity_kind: 'edge',
      entity_id: 'e1',
      included_by: ACTOR,
      included_at: TS,
    });
    const annotation = ev('entity-included', {
      entity_kind: 'annotation',
      entity_id: 'a1',
      included_by: ACTOR,
      included_at: TS,
    });
    expect(affectedEntities(node)).toEqual({ nodeIds: ['n1'], edgeIds: [] });
    expect(affectedEntities(edge)).toEqual({ nodeIds: [], edgeIds: ['e1'] });
    expect(affectedEntities(annotation)).toEqual({ nodeIds: ['a1'], edgeIds: [] });
  });

  it('entity-removed classifies entity_id by entity_kind', () => {
    const edge = ev('entity-removed', {
      entity_kind: 'edge',
      entity_id: 'e9',
      removed_by: ACTOR,
      removed_at: TS,
    });
    expect(affectedEntities(edge)).toEqual({ nodeIds: [], edgeIds: ['e9'] });
  });
});

describe('affectedEntities — facet arm vs proposal arm (target-discriminated)', () => {
  it('facet-arm vote extracts entity_id by entity_kind', () => {
    const e = ev('vote', {
      target: 'facet',
      entity_kind: 'edge',
      entity_id: 'e1',
      facet: 'substance',
      participant: ACTOR,
      choice: 'agree',
      voted_at: TS,
    });
    expect(affectedEntities(e)).toEqual({ nodeIds: [], edgeIds: ['e1'] });
  });

  it('proposal-arm vote returns empty (only a proposal_id, no cross-event resolution)', () => {
    const e = ev('vote', {
      target: 'proposal',
      proposal_id: 'p1',
      participant: ACTOR,
      choice: 'agree',
      voted_at: TS,
    });
    expect(affectedEntities(e)).toEqual({ nodeIds: [], edgeIds: [] });
  });

  it('facet-arm commit extracts entity_id by entity_kind; proposal-arm is empty', () => {
    const facet = ev('commit', {
      target: 'facet',
      entity_kind: 'node',
      entity_id: 'n1',
      facet: 'classification',
      committed_by: ACTOR,
      committed_at: TS,
    });
    const proposal = ev('commit', {
      target: 'proposal',
      proposal_id: 'p1',
      committed_by: ACTOR,
      committed_at: TS,
    });
    expect(affectedEntities(facet)).toEqual({ nodeIds: ['n1'], edgeIds: [] });
    expect(affectedEntities(proposal)).toEqual({ nodeIds: [], edgeIds: [] });
  });

  it('facet-arm meta-disagreement-marked extracts entity_id; proposal-arm is empty', () => {
    const facet = ev('meta-disagreement-marked', {
      target: 'facet',
      entity_kind: 'edge',
      entity_id: 'e1',
      facet: 'substance',
      marked_by: ACTOR,
      marked_at: TS,
    });
    const proposal = ev('meta-disagreement-marked', {
      target: 'proposal',
      proposal_id: 'p1',
      marked_by: ACTOR,
      marked_at: TS,
    });
    expect(affectedEntities(facet)).toEqual({ nodeIds: [], edgeIds: ['e1'] });
    expect(affectedEntities(proposal)).toEqual({ nodeIds: [], edgeIds: [] });
  });

  it('withdraw-agreement extracts entity_id by entity_kind', () => {
    const e = ev('withdraw-agreement', {
      entity_kind: 'node',
      entity_id: 'n1',
      facet: 'substance',
      participant: ACTOR,
      withdrawn_at: TS,
    });
    expect(affectedEntities(e)).toEqual({ nodeIds: ['n1'], edgeIds: [] });
  });
});

describe('affectedEntities — proposal sub-kinds read their in-payload target ids', () => {
  function proposalEvent(proposal: unknown): Event {
    return ev('proposal', { proposal });
  }

  it('classify-node / axiom-mark / amend-node → node_id in nodeIds', () => {
    expect(
      affectedEntities(
        proposalEvent({ kind: 'classify-node', node_id: 'n1', classification: 'fact' }),
      ),
    ).toEqual({ nodeIds: ['n1'], edgeIds: [] });
    expect(
      affectedEntities(proposalEvent({ kind: 'axiom-mark', node_id: 'n2', participant: ACTOR })),
    ).toEqual({ nodeIds: ['n2'], edgeIds: [] });
    expect(
      affectedEntities(proposalEvent({ kind: 'amend-node', node_id: 'n3', new_content: 'x' })),
    ).toEqual({ nodeIds: ['n3'], edgeIds: [] });
  });

  it('break-edge / set-edge-substance → edge_id in edgeIds', () => {
    expect(affectedEntities(proposalEvent({ kind: 'break-edge', edge_id: 'e1' }))).toEqual({
      nodeIds: [],
      edgeIds: ['e1'],
    });
    expect(
      affectedEntities(
        proposalEvent({ kind: 'set-edge-substance', edge_id: 'e2', value: 'agreed' }),
      ),
    ).toEqual({ nodeIds: [], edgeIds: ['e2'] });
  });

  it('set-edge-substance also surfaces in-payload endpoint node-ish ids', () => {
    expect(
      affectedEntities(
        proposalEvent({
          kind: 'set-edge-substance',
          edge_id: 'e2',
          value: 'agreed',
          source_node_id: 'n1',
          target_annotation_id: 'a1',
        }),
      ),
    ).toEqual({ nodeIds: ['n1', 'a1'], edgeIds: ['e2'] });
  });

  it('edit-wording restructure includes node_id + new_node_id; reword only node_id', () => {
    expect(
      affectedEntities(
        proposalEvent({
          kind: 'edit-wording',
          edit_kind: 'restructure',
          node_id: 'n1',
          new_wording: 'w',
          new_node_id: 'n2',
        }),
      ),
    ).toEqual({ nodeIds: ['n1', 'n2'], edgeIds: [] });
    expect(
      affectedEntities(
        proposalEvent({
          kind: 'edit-wording',
          edit_kind: 'reword',
          node_id: 'n1',
          new_wording: 'w',
        }),
      ),
    ).toEqual({ nodeIds: ['n1'], edgeIds: [] });
  });

  it('meta-move / annotate classify target_id by target_kind', () => {
    expect(
      affectedEntities(
        proposalEvent({
          kind: 'meta-move',
          meta_kind: 'reframe',
          content: 'c',
          target_kind: 'edge',
          target_id: 'e1',
        }),
      ),
    ).toEqual({ nodeIds: [], edgeIds: ['e1'] });
    expect(
      affectedEntities(
        proposalEvent({
          kind: 'annotate',
          target_kind: 'node',
          target_id: 'n1',
          annotation_kind: 'note',
          content: 'c',
        }),
      ),
    ).toEqual({ nodeIds: ['n1'], edgeIds: [] });
  });

  it('decompose / interpretive-split include parent_node_id + component ids', () => {
    expect(
      affectedEntities(
        proposalEvent({
          kind: 'decompose',
          parent_node_id: 'p1',
          components: [
            { wording: 'a', classification: 'fact', node_id: 'c1' },
            { wording: 'b', classification: 'fact', node_id: 'c2' },
          ],
        }),
      ),
    ).toEqual({ nodeIds: ['p1', 'c1', 'c2'], edgeIds: [] });
    expect(
      affectedEntities(
        proposalEvent({
          kind: 'interpretive-split',
          parent_node_id: 'p1',
          readings: [
            { wording: 'a', classification: 'fact', node_id: 'r1' },
            { wording: 'b', classification: 'fact', node_id: 'r2' },
          ],
        }),
      ),
    ).toEqual({ nodeIds: ['p1', 'r1', 'r2'], edgeIds: [] });
  });
});

describe('affectedEntities — non-graph kinds flash nothing', () => {
  const EMPTY = { nodeIds: [], edgeIds: [] };

  it('session/participant/mode/snapshot kinds → empty', () => {
    const cases: ReadonlyArray<readonly [EventKind, unknown]> = [
      ['session-created', { host_user_id: ACTOR, privacy: 'public', topic: 't', created_at: TS }],
      ['session-ended', { ended_at: TS }],
      [
        'participant-joined',
        { user_id: ACTOR, role: 'moderator', screen_name: 's', joined_at: TS },
      ],
      ['participant-left', { user_id: ACTOR, left_at: TS }],
      [
        'session-mode-changed',
        {
          previous_mode: 'lobby',
          new_mode: 'operate',
          changed_by: ACTOR,
          changed_at: TS,
        },
      ],
      ['snapshot-created', { snapshot_id: 's1', label: 'L', log_position: 1 }],
      ['proposal-withdrawn', { proposal_id: 'p1', withdrawn_by: ACTOR, withdrawn_at: TS }],
    ];
    for (const [kind, payload] of cases) {
      expect(affectedEntities(ev(kind, payload))).toEqual(EMPTY);
    }
  });
});

describe('affectedEntities — totality over EventKind', () => {
  it('accepts a representative event of every kind without throwing', () => {
    const samples: ReadonlyArray<readonly [EventKind, unknown]> = [
      ['session-created', { host_user_id: ACTOR, privacy: 'public', topic: 't', created_at: TS }],
      ['session-ended', { ended_at: TS }],
      [
        'participant-joined',
        { user_id: ACTOR, role: 'moderator', screen_name: 's', joined_at: TS },
      ],
      ['participant-left', { user_id: ACTOR, left_at: TS }],
      ['node-created', { node_id: 'n1', wording: 'w', created_by: ACTOR, created_at: TS }],
      [
        'edge-created',
        {
          edge_id: 'e1',
          role: 'supports',
          source_node_id: 'n1',
          target_node_id: 'n2',
          created_by: ACTOR,
          created_at: TS,
        },
      ],
      [
        'annotation-created',
        {
          annotation_id: 'a1',
          kind: 'note',
          content: 'c',
          target_node_id: 'n1',
          target_edge_id: null,
          created_by: ACTOR,
          created_at: TS,
        },
      ],
      [
        'entity-included',
        { entity_kind: 'node', entity_id: 'n1', included_by: ACTOR, included_at: TS },
      ],
      [
        'entity-removed',
        { entity_kind: 'node', entity_id: 'n1', removed_by: ACTOR, removed_at: TS },
      ],
      ['proposal', { proposal: { kind: 'break-edge', edge_id: 'e1' } }],
      [
        'vote',
        {
          target: 'facet',
          entity_kind: 'node',
          entity_id: 'n1',
          facet: 'substance',
          participant: ACTOR,
          choice: 'agree',
          voted_at: TS,
        },
      ],
      [
        'commit',
        {
          target: 'facet',
          entity_kind: 'node',
          entity_id: 'n1',
          facet: 'substance',
          committed_by: ACTOR,
          committed_at: TS,
        },
      ],
      [
        'meta-disagreement-marked',
        {
          target: 'facet',
          entity_kind: 'node',
          entity_id: 'n1',
          facet: 'substance',
          marked_by: ACTOR,
          marked_at: TS,
        },
      ],
      ['snapshot-created', { snapshot_id: 's1', label: 'L', log_position: 1 }],
      [
        'session-mode-changed',
        {
          previous_mode: 'lobby',
          new_mode: 'operate',
          changed_by: ACTOR,
          changed_at: TS,
        },
      ],
      [
        'withdraw-agreement',
        {
          entity_kind: 'node',
          entity_id: 'n1',
          facet: 'substance',
          participant: ACTOR,
          withdrawn_at: TS,
        },
      ],
      ['proposal-withdrawn', { proposal_id: 'p1', withdrawn_by: ACTOR, withdrawn_at: TS }],
    ];
    for (const [kind, payload] of samples) {
      const result = affectedEntities(ev(kind, payload));
      expect(Array.isArray(result.nodeIds)).toBe(true);
      expect(Array.isArray(result.edgeIds)).toBe(true);
    }
  });
});
