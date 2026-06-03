// Tests for `summarizeEvent` — the change-history pane's pure per-kind
// summary descriptor (`mod_history_event_summary`).
//
// Refinement: tasks/refinements/moderator-ui/mod_history_event_summary.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
//
// Per ADR 0022 these are committed Vitest cases pinning Acceptance §1:
//   - free-text kinds return `{ type: 'text', text: <verbatim payload> }`;
//   - enum kinds return `{ type: 'i18n', key, values? }` with the expected
//     key + interpolation values;
//   - empty-payload kinds return `{ type: 'none' }`;
//   - `kind === 'proposal'` returns text byte-equal to
//     `summaryText(payload.proposal)` for ≥ 2 sub-kinds;
//   - the helper is total over all 17 `EventKind`s and pure (same input →
//     same output, no clock / RNG).

import { describe, expect, it } from 'vitest';
import type { Event, EventKind } from '@a-conversa/shared-types';

import { summarizeEvent } from './eventSummary';
import { summaryText } from './proposalSummary';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const ENTITY = '00000000-0000-4000-8000-0000000000e1';
const TS = '2026-06-03T00:00:00.000Z';

/** Build a typed `Event` for `kind` from a payload + optional overrides. */
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

describe('summarizeEvent — free-text kinds (verbatim, never translated)', () => {
  it('node-created → the wording verbatim', () => {
    const e = ev('node-created', {
      node_id: ENTITY,
      wording: 'Markets allocate capital efficiently',
      created_by: ACTOR,
      created_at: TS,
    });
    expect(summarizeEvent(e)).toEqual({
      type: 'text',
      text: 'Markets allocate capital efficiently',
    });
  });

  it('annotation-created → the content verbatim', () => {
    const e = ev('annotation-created', {
      annotation_id: ENTITY,
      kind: 'note',
      content: 'Needs a source.',
      target_node_id: ENTITY,
      target_edge_id: null,
      created_by: ACTOR,
      created_at: TS,
    });
    expect(summarizeEvent(e)).toEqual({ type: 'text', text: 'Needs a source.' });
  });

  it('session-created → the topic verbatim', () => {
    const e = ev('session-created', {
      host_user_id: ACTOR,
      privacy: 'public',
      topic: 'Should cities ban cars downtown?',
      created_at: TS,
    });
    expect(summarizeEvent(e)).toEqual({ type: 'text', text: 'Should cities ban cars downtown?' });
  });

  it('snapshot-created → the label verbatim', () => {
    const e = ev('snapshot-created', {
      snapshot_id: ENTITY,
      label: 'After round 1',
      log_position: 5,
    });
    expect(summarizeEvent(e)).toEqual({ type: 'text', text: 'After round 1' });
  });
});

describe('summarizeEvent — proposal delegates to summaryText (Decision §D3)', () => {
  it('edit-wording → byte-equal to summaryText', () => {
    const proposal = {
      kind: 'edit-wording',
      node_id: ENTITY,
      new_wording: 'A revised wording',
    };
    const e = ev('proposal', { proposal });
    expect(summarizeEvent(e)).toEqual({ type: 'text', text: summaryText(proposal as never) });
    expect(summarizeEvent(e)).toEqual({ type: 'text', text: 'A revised wording' });
  });

  it('decompose → byte-equal to summaryText', () => {
    const proposal = {
      kind: 'decompose',
      node_id: ENTITY,
      components: [{ wording: 'a' }, { wording: 'b' }],
    };
    const e = ev('proposal', { proposal });
    expect(summarizeEvent(e)).toEqual({ type: 'text', text: summaryText(proposal as never) });
    expect(summarizeEvent(e)).toEqual({ type: 'text', text: 'Decompose into 2 components' });
  });
});

describe('summarizeEvent — enum kinds (localized structural words)', () => {
  it('edge-created → the edge-role i18n key', () => {
    const e = ev('edge-created', {
      edge_id: ENTITY,
      role: 'rebuts',
      source_node_id: ENTITY,
      target_node_id: ENTITY,
      created_by: ACTOR,
      created_at: TS,
    });
    expect(summarizeEvent(e)).toEqual({
      type: 'i18n',
      key: 'moderator.changeHistory.summary.edgeRole.rebuts',
    });
  });

  it('vote → the choice i18n key (regardless of target arm)', () => {
    const e = ev('vote', {
      target: 'facet',
      entity_kind: 'node',
      entity_id: ENTITY,
      facet: 'substance',
      participant: ACTOR,
      choice: 'dispute',
      voted_at: TS,
    });
    expect(summarizeEvent(e)).toEqual({
      type: 'i18n',
      key: 'moderator.changeHistory.summary.choice.dispute',
    });
  });

  it('entity-included / entity-removed → the entity-kind i18n key', () => {
    const included = ev('entity-included', {
      entity_kind: 'edge',
      entity_id: ENTITY,
      included_by: ACTOR,
      included_at: TS,
    });
    const removed = ev('entity-removed', {
      entity_kind: 'annotation',
      entity_id: ENTITY,
      removed_by: ACTOR,
      removed_at: TS,
    });
    expect(summarizeEvent(included)).toEqual({
      type: 'i18n',
      key: 'moderator.changeHistory.summary.entityKind.edge',
    });
    expect(summarizeEvent(removed)).toEqual({
      type: 'i18n',
      key: 'moderator.changeHistory.summary.entityKind.annotation',
    });
  });

  it('withdraw-agreement → the facet i18n key', () => {
    const e = ev('withdraw-agreement', {
      entity_kind: 'node',
      entity_id: ENTITY,
      facet: 'wording',
      participant: ACTOR,
      withdrawn_at: TS,
    });
    expect(summarizeEvent(e)).toEqual({
      type: 'i18n',
      key: 'moderator.changeHistory.summary.facet.wording',
    });
  });

  it('participant-joined → name (verbatim) + select-safe role token', () => {
    const e = ev('participant-joined', {
      user_id: ACTOR,
      role: 'debater-A',
      screen_name: 'Alice',
      joined_at: TS,
    });
    expect(summarizeEvent(e)).toEqual({
      type: 'i18n',
      key: 'moderator.changeHistory.summary.participantJoined',
      values: { name: 'Alice', role: 'debaterA' },
    });
  });

  it('session-mode-changed → previous + next mode values', () => {
    const e = ev('session-mode-changed', {
      previous_mode: 'lobby',
      new_mode: 'operate',
      changed_by: ACTOR,
      changed_at: TS,
    });
    expect(summarizeEvent(e)).toEqual({
      type: 'i18n',
      key: 'moderator.changeHistory.summary.sessionModeChanged',
      values: { previous: 'lobby', next: 'operate' },
    });
  });
});

describe('summarizeEvent — target-discriminated commit / meta-disagreement', () => {
  it('commit facet arm → the facet i18n key; proposal arm → none (no facet)', () => {
    const facet = ev('commit', {
      target: 'facet',
      entity_kind: 'node',
      entity_id: ENTITY,
      facet: 'classification',
      committed_by: ACTOR,
      committed_at: TS,
    });
    const proposal = ev('commit', {
      target: 'proposal',
      proposal_id: ENTITY,
      committed_by: ACTOR,
      committed_at: TS,
    });
    expect(summarizeEvent(facet)).toEqual({
      type: 'i18n',
      key: 'moderator.changeHistory.summary.facet.classification',
    });
    expect(summarizeEvent(proposal)).toEqual({ type: 'none' });
  });

  it('meta-disagreement-marked facet arm → the facet key; proposal arm → none', () => {
    const facet = ev('meta-disagreement-marked', {
      target: 'facet',
      entity_kind: 'edge',
      entity_id: ENTITY,
      facet: 'shape',
      marked_by: ACTOR,
      marked_at: TS,
    });
    const proposal = ev('meta-disagreement-marked', {
      target: 'proposal',
      proposal_id: ENTITY,
      marked_by: ACTOR,
      marked_at: TS,
    });
    expect(summarizeEvent(facet)).toEqual({
      type: 'i18n',
      key: 'moderator.changeHistory.summary.facet.shape',
    });
    expect(summarizeEvent(proposal)).toEqual({ type: 'none' });
  });
});

describe('summarizeEvent — empty-payload kinds (Decision §D5)', () => {
  it.each(['session-ended', 'participant-left', 'proposal-withdrawn'] as const)(
    '%s → { type: none }',
    (kind) => {
      expect(summarizeEvent(ev(kind, {}))).toEqual({ type: 'none' });
    },
  );
});

describe('summarizeEvent — totality + purity', () => {
  // One representative payload per kind so the helper is exercised across
  // all 17 `EventKind`s — a missing case would throw or mis-narrow here.
  const ALL: Array<[EventKind, unknown]> = [
    ['session-created', { host_user_id: ACTOR, privacy: 'public', topic: 't', created_at: TS }],
    ['session-ended', { ended_at: TS }],
    [
      'participant-joined',
      { user_id: ACTOR, role: 'moderator', screen_name: 'Mod', joined_at: TS },
    ],
    ['participant-left', { user_id: ACTOR, left_at: TS }],
    ['node-created', { node_id: ENTITY, wording: 'w', created_by: ACTOR, created_at: TS }],
    [
      'edge-created',
      {
        edge_id: ENTITY,
        role: 'supports',
        source_node_id: ENTITY,
        target_node_id: ENTITY,
        created_by: ACTOR,
        created_at: TS,
      },
    ],
    [
      'annotation-created',
      {
        annotation_id: ENTITY,
        kind: 'note',
        content: 'c',
        target_node_id: ENTITY,
        target_edge_id: null,
        created_by: ACTOR,
        created_at: TS,
      },
    ],
    [
      'entity-included',
      { entity_kind: 'node', entity_id: ENTITY, included_by: ACTOR, included_at: TS },
    ],
    ['proposal', { proposal: { kind: 'break-edge', edge_id: ENTITY } }],
    [
      'vote',
      {
        target: 'facet',
        entity_kind: 'node',
        entity_id: ENTITY,
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
        entity_id: ENTITY,
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
        entity_id: ENTITY,
        facet: 'substance',
        marked_by: ACTOR,
        marked_at: TS,
      },
    ],
    ['snapshot-created', { snapshot_id: ENTITY, label: 'l', log_position: 1 }],
    [
      'entity-removed',
      { entity_kind: 'node', entity_id: ENTITY, removed_by: ACTOR, removed_at: TS },
    ],
    [
      'session-mode-changed',
      { previous_mode: 'lobby', new_mode: 'operate', changed_by: ACTOR, changed_at: TS },
    ],
    [
      'withdraw-agreement',
      {
        entity_kind: 'node',
        entity_id: ENTITY,
        facet: 'substance',
        participant: ACTOR,
        withdrawn_at: TS,
      },
    ],
    ['proposal-withdrawn', { proposal_id: ENTITY, withdrawn_by: ACTOR, withdrawn_at: TS }],
  ];

  it('is total over all 17 EventKinds (returns a valid descriptor for each)', () => {
    expect(ALL).toHaveLength(17);
    for (const [kind, payload] of ALL) {
      const summary = summarizeEvent(ev(kind, payload));
      expect(['text', 'i18n', 'none']).toContain(summary.type);
    }
  });

  it('is pure — same input yields a deeply-equal descriptor across calls', () => {
    for (const [kind, payload] of ALL) {
      const e = ev(kind, payload);
      expect(summarizeEvent(e)).toEqual(summarizeEvent(e));
    }
  });
});
