// Tests for the change-history filter's pure predicate + derivation
// helpers (`mod_history_filtering`).
//
// Refinement: tasks/refinements/moderator-ui/mod_history_filtering.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md
//
// Acceptance §1 / §2 — the predicate is AND-composed with an empty-set =
// no-narrowing rule and a default short-circuit; the derivations return
// the distinct kinds (canonical order) and the distinct actors labeled
// from the log. All pure.

import { describe, expect, it } from 'vitest';
import type { Event, EventKind } from '@a-conversa/shared-types';

import type { ChangeHistoryRow } from './changeHistory';
import {
  deriveActorOptions,
  deriveAvailableKinds,
  EMPTY_FILTER,
  type HistoryFilter,
  isDefaultFilter,
  matchesHistoryFilter,
  SYSTEM_ACTOR_SENTINEL,
} from './historyFilter';

const ACTOR_A = '00000000-0000-4000-8000-0000000000a1';
const ACTOR_B = '00000000-0000-4000-8000-0000000000b1';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';

let rowSeq = 0;

function makeRow(props: {
  kind: EventKind;
  actor?: string | null;
  nodeIds?: readonly string[];
  edgeIds?: readonly string[];
}): ChangeHistoryRow {
  rowSeq += 1;
  return {
    id: `00000000-0000-4000-8000-${rowSeq.toString(16).padStart(12, '0')}`,
    sequence: rowSeq,
    kind: props.kind,
    actor: props.actor ?? null,
    createdAt: '2026-06-03T00:00:00.000Z',
    summary: { type: 'none' },
    affected: { nodeIds: props.nodeIds ?? [], edgeIds: props.edgeIds ?? [] },
  };
}

function filterWith(overrides: Partial<HistoryFilter>): HistoryFilter {
  return {
    kinds: overrides.kinds ?? new Set<EventKind>(),
    actors: overrides.actors ?? new Set<string | null>(),
    targetSelectedOnly: overrides.targetSelectedOnly ?? false,
  };
}

let eventSeq = 0;

function participantJoinedEvent(userId: string, screenName: string): Event {
  eventSeq += 1;
  return {
    id: `00000000-0000-4000-8000-${(0x3000 + eventSeq).toString(16).padStart(12, '0')}`,
    sessionId: '00000000-0000-4000-8000-0000000000f0',
    sequence: eventSeq,
    kind: 'participant-joined',
    actor: userId,
    payload: {
      user_id: userId,
      role: 'debater-A',
      screen_name: screenName,
      joined_at: '2026-06-03T00:00:00.000Z',
    },
    createdAt: '2026-06-03T00:00:00.000Z',
  };
}

function nodeCreatedEvent(actor: string | null): Event {
  eventSeq += 1;
  return {
    id: `00000000-0000-4000-8000-${(0x1000 + eventSeq).toString(16).padStart(12, '0')}`,
    sessionId: '00000000-0000-4000-8000-0000000000f0',
    sequence: eventSeq,
    kind: 'node-created',
    actor,
    payload: {
      node_id: NODE_X,
      wording: 'a statement',
      created_by: actor ?? ACTOR_A,
      created_at: '2026-06-03T00:00:00.000Z',
    },
    createdAt: '2026-06-03T00:00:00.000Z',
  };
}

describe('isDefaultFilter', () => {
  it('the EMPTY_FILTER constant is default', () => {
    expect(isDefaultFilter(EMPTY_FILTER)).toBe(true);
  });

  it('a fresh empty filter is default', () => {
    expect(isDefaultFilter(filterWith({}))).toBe(true);
  });

  it('a non-empty kind set is non-default', () => {
    expect(isDefaultFilter(filterWith({ kinds: new Set<EventKind>(['vote']) }))).toBe(false);
  });

  it('a non-empty actor set is non-default', () => {
    expect(isDefaultFilter(filterWith({ actors: new Set<string | null>([ACTOR_A]) }))).toBe(false);
  });

  it('a null actor in the set is non-default', () => {
    expect(isDefaultFilter(filterWith({ actors: new Set<string | null>([null]) }))).toBe(false);
  });

  it('targetSelectedOnly true is non-default', () => {
    expect(isDefaultFilter(filterWith({ targetSelectedOnly: true }))).toBe(false);
  });
});

describe('matchesHistoryFilter — empty default short-circuits to true', () => {
  it('passes every row under the default filter', () => {
    expect(
      matchesHistoryFilter(makeRow({ kind: 'vote', actor: ACTOR_A }), EMPTY_FILTER, null),
    ).toBe(true);
    expect(
      matchesHistoryFilter(makeRow({ kind: 'commit', actor: null }), EMPTY_FILTER, NODE_X),
    ).toBe(true);
  });
});

describe('matchesHistoryFilter — kind dimension', () => {
  it('a non-empty kind set passes iff row.kind is in it', () => {
    const filter = filterWith({ kinds: new Set<EventKind>(['vote']) });
    expect(matchesHistoryFilter(makeRow({ kind: 'vote' }), filter, null)).toBe(true);
    expect(matchesHistoryFilter(makeRow({ kind: 'commit' }), filter, null)).toBe(false);
  });

  it('a multi-kind set is a union', () => {
    const filter = filterWith({ kinds: new Set<EventKind>(['vote', 'commit']) });
    expect(matchesHistoryFilter(makeRow({ kind: 'vote' }), filter, null)).toBe(true);
    expect(matchesHistoryFilter(makeRow({ kind: 'commit' }), filter, null)).toBe(true);
    expect(matchesHistoryFilter(makeRow({ kind: 'node-created' }), filter, null)).toBe(false);
  });
});

describe('matchesHistoryFilter — actor dimension', () => {
  it('a non-empty actor set passes iff row.actor is in it', () => {
    const filter = filterWith({ actors: new Set<string | null>([ACTOR_A]) });
    expect(matchesHistoryFilter(makeRow({ kind: 'vote', actor: ACTOR_A }), filter, null)).toBe(
      true,
    );
    expect(matchesHistoryFilter(makeRow({ kind: 'vote', actor: ACTOR_B }), filter, null)).toBe(
      false,
    );
  });

  it('the null/System actor is a first-class set member', () => {
    const filter = filterWith({ actors: new Set<string | null>([null]) });
    expect(
      matchesHistoryFilter(makeRow({ kind: 'snapshot-created', actor: null }), filter, null),
    ).toBe(true);
    expect(matchesHistoryFilter(makeRow({ kind: 'vote', actor: ACTOR_A }), filter, null)).toBe(
      false,
    );
  });
});

describe('matchesHistoryFilter — target dimension', () => {
  it('with the toggle on and a selection, passes iff the id is in affected', () => {
    const filter = filterWith({ targetSelectedOnly: true });
    expect(
      matchesHistoryFilter(makeRow({ kind: 'node-created', nodeIds: [NODE_X] }), filter, NODE_X),
    ).toBe(true);
    expect(
      matchesHistoryFilter(makeRow({ kind: 'edge-created', edgeIds: [EDGE_E] }), filter, EDGE_E),
    ).toBe(true);
    expect(
      matchesHistoryFilter(makeRow({ kind: 'node-created', nodeIds: [NODE_X] }), filter, EDGE_E),
    ).toBe(false);
    expect(matchesHistoryFilter(makeRow({ kind: 'session-ended' }), filter, NODE_X)).toBe(false);
  });

  it('with no selection (null), passes every row even when the toggle is on', () => {
    const filter = filterWith({ targetSelectedOnly: true });
    expect(matchesHistoryFilter(makeRow({ kind: 'session-ended' }), filter, null)).toBe(true);
    expect(
      matchesHistoryFilter(makeRow({ kind: 'node-created', nodeIds: [NODE_X] }), filter, null),
    ).toBe(true);
  });
});

describe('matchesHistoryFilter — AND composition', () => {
  it('every active dimension must pass', () => {
    const filter = filterWith({
      kinds: new Set<EventKind>(['node-created']),
      actors: new Set<string | null>([ACTOR_A]),
      targetSelectedOnly: true,
    });
    // All three pass.
    expect(
      matchesHistoryFilter(
        makeRow({ kind: 'node-created', actor: ACTOR_A, nodeIds: [NODE_X] }),
        filter,
        NODE_X,
      ),
    ).toBe(true);
    // Wrong kind.
    expect(
      matchesHistoryFilter(
        makeRow({ kind: 'commit', actor: ACTOR_A, nodeIds: [NODE_X] }),
        filter,
        NODE_X,
      ),
    ).toBe(false);
    // Wrong actor.
    expect(
      matchesHistoryFilter(
        makeRow({ kind: 'node-created', actor: ACTOR_B, nodeIds: [NODE_X] }),
        filter,
        NODE_X,
      ),
    ).toBe(false);
    // Doesn't affect the selected entity.
    expect(
      matchesHistoryFilter(
        makeRow({ kind: 'node-created', actor: ACTOR_A, nodeIds: [NODE_X] }),
        filter,
        EDGE_E,
      ),
    ).toBe(false);
  });
});

describe('matchesHistoryFilter — purity', () => {
  it('same inputs produce the same output', () => {
    const row = makeRow({ kind: 'vote', actor: ACTOR_A, nodeIds: [NODE_X] });
    const filter = filterWith({
      kinds: new Set<EventKind>(['vote']),
      actors: new Set<string | null>([ACTOR_A]),
      targetSelectedOnly: true,
    });
    const first = matchesHistoryFilter(row, filter, NODE_X);
    const second = matchesHistoryFilter(row, filter, NODE_X);
    expect(first).toBe(second);
    expect(first).toBe(true);
  });
});

describe('deriveAvailableKinds', () => {
  it('returns the distinct kinds present, in canonical order, no duplicates', () => {
    const rows = [
      makeRow({ kind: 'vote' }),
      makeRow({ kind: 'node-created' }),
      makeRow({ kind: 'vote' }),
      makeRow({ kind: 'commit' }),
    ];
    // Canonical `eventKinds` order: node-created < vote < commit.
    expect(deriveAvailableKinds(rows)).toEqual(['node-created', 'vote', 'commit']);
  });

  it('returns an empty array for an empty log', () => {
    expect(deriveAvailableKinds([])).toEqual([]);
  });
});

describe('deriveActorOptions', () => {
  it('labels a participant by the screen_name from their join event', () => {
    const events = [participantJoinedEvent(ACTOR_A, 'Alice'), nodeCreatedEvent(ACTOR_A)];
    const options = deriveActorOptions(events);
    expect(options).toEqual([{ actor: ACTOR_A, label: 'Alice' }]);
  });

  it('builds the screen-name map even when the join event trails the actor row', () => {
    const events = [nodeCreatedEvent(ACTOR_A), participantJoinedEvent(ACTOR_A, 'Alice')];
    const options = deriveActorOptions(events);
    expect(options).toEqual([{ actor: ACTOR_A, label: 'Alice' }]);
  });

  it('falls back to the 8-char id prefix when no join event is present', () => {
    const options = deriveActorOptions([nodeCreatedEvent(ACTOR_B)]);
    expect(options).toEqual([{ actor: ACTOR_B, label: ACTOR_B.slice(0, 8) }]);
  });

  it('labels the null actor with the System sentinel', () => {
    const options = deriveActorOptions([nodeCreatedEvent(null)]);
    expect(options).toEqual([{ actor: null, label: SYSTEM_ACTOR_SENTINEL }]);
  });

  it('returns one entry per distinct actor in first-appearance order', () => {
    const events = [
      nodeCreatedEvent(ACTOR_B),
      participantJoinedEvent(ACTOR_A, 'Alice'),
      nodeCreatedEvent(ACTOR_A),
      nodeCreatedEvent(null),
    ];
    const options = deriveActorOptions(events);
    expect(options).toEqual([
      { actor: ACTOR_B, label: ACTOR_B.slice(0, 8) },
      { actor: ACTOR_A, label: 'Alice' },
      { actor: null, label: SYSTEM_ACTOR_SENTINEL },
    ]);
  });
});
