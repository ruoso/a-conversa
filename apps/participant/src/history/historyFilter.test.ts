// Tests for the participant change-history filter's pure predicate +
// derivation helpers (`part_history_filtering`).
//
// Refinement: tasks/refinements/participant-ui/part_history_filtering.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md
//
// Acceptance §3 — the predicate is AND-composed with an empty-set =
// no-narrowing rule and a default short-circuit; the derivations return the
// distinct kinds (canonical order) and the distinct actors labeled exactly
// as the row's actor column. All pure. A reduced mirror of the moderator's
// `historyFilter.test.ts` — no target dimension (Decision §D4).

import { describe, expect, it } from 'vitest';
import type { EventKind } from '@a-conversa/shared-types';

import type { HistoryRow } from './deriveHistoryRows';
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

let rowSeq = 0;

function makeRow(props: { kind: EventKind; actor?: string | null }): HistoryRow {
  rowSeq += 1;
  return {
    id: `00000000-0000-4000-8000-${rowSeq.toString(16).padStart(12, '0')}`,
    sequence: rowSeq,
    kind: props.kind,
    actor: props.actor ?? null,
    createdAt: '2026-06-03T00:00:00.000Z',
  };
}

function filterWith(overrides: Partial<HistoryFilter>): HistoryFilter {
  return {
    kinds: overrides.kinds ?? new Set<EventKind>(),
    actors: overrides.actors ?? new Set<string | null>(),
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
});

describe('matchesHistoryFilter — empty default short-circuits to true', () => {
  it('passes every row under the default filter', () => {
    expect(matchesHistoryFilter(makeRow({ kind: 'vote', actor: ACTOR_A }), EMPTY_FILTER)).toBe(
      true,
    );
    expect(matchesHistoryFilter(makeRow({ kind: 'commit', actor: null }), EMPTY_FILTER)).toBe(true);
  });
});

describe('matchesHistoryFilter — kind dimension', () => {
  it('a non-empty kind set passes iff row.kind is in it', () => {
    const filter = filterWith({ kinds: new Set<EventKind>(['vote']) });
    expect(matchesHistoryFilter(makeRow({ kind: 'vote' }), filter)).toBe(true);
    expect(matchesHistoryFilter(makeRow({ kind: 'commit' }), filter)).toBe(false);
  });

  it('a multi-kind set is a union (OR within the dimension)', () => {
    const filter = filterWith({ kinds: new Set<EventKind>(['vote', 'commit']) });
    expect(matchesHistoryFilter(makeRow({ kind: 'vote' }), filter)).toBe(true);
    expect(matchesHistoryFilter(makeRow({ kind: 'commit' }), filter)).toBe(true);
    expect(matchesHistoryFilter(makeRow({ kind: 'node-created' }), filter)).toBe(false);
  });
});

describe('matchesHistoryFilter — actor dimension', () => {
  it('a non-empty actor set passes iff row.actor is in it', () => {
    const filter = filterWith({ actors: new Set<string | null>([ACTOR_A]) });
    expect(matchesHistoryFilter(makeRow({ kind: 'vote', actor: ACTOR_A }), filter)).toBe(true);
    expect(matchesHistoryFilter(makeRow({ kind: 'vote', actor: ACTOR_B }), filter)).toBe(false);
  });

  it('the null/System actor is a first-class set member', () => {
    const filter = filterWith({ actors: new Set<string | null>([null]) });
    expect(matchesHistoryFilter(makeRow({ kind: 'snapshot-created', actor: null }), filter)).toBe(
      true,
    );
    expect(matchesHistoryFilter(makeRow({ kind: 'vote', actor: ACTOR_A }), filter)).toBe(false);
  });
});

describe('matchesHistoryFilter — AND composition across dimensions', () => {
  it('every active dimension must pass', () => {
    const filter = filterWith({
      kinds: new Set<EventKind>(['node-created']),
      actors: new Set<string | null>([ACTOR_A]),
    });
    // Both pass.
    expect(matchesHistoryFilter(makeRow({ kind: 'node-created', actor: ACTOR_A }), filter)).toBe(
      true,
    );
    // Wrong kind.
    expect(matchesHistoryFilter(makeRow({ kind: 'commit', actor: ACTOR_A }), filter)).toBe(false);
    // Wrong actor.
    expect(matchesHistoryFilter(makeRow({ kind: 'node-created', actor: ACTOR_B }), filter)).toBe(
      false,
    );
  });
});

describe('matchesHistoryFilter — purity', () => {
  it('does not mutate its inputs and is referentially transparent', () => {
    const row = makeRow({ kind: 'vote', actor: ACTOR_A });
    const frozenRow = Object.freeze({ ...row });
    const filter = filterWith({
      kinds: new Set<EventKind>(['vote']),
      actors: new Set<string | null>([ACTOR_A]),
    });
    const kindsBefore = [...filter.kinds];
    const actorsBefore = [...filter.actors];
    const first = matchesHistoryFilter(frozenRow, filter);
    const second = matchesHistoryFilter(frozenRow, filter);
    expect(first).toBe(second);
    expect(first).toBe(true);
    expect([...filter.kinds]).toEqual(kindsBefore);
    expect([...filter.actors]).toEqual(actorsBefore);
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
  it('labels a non-null actor with its 8-char id prefix', () => {
    expect(deriveActorOptions([makeRow({ kind: 'node-created', actor: ACTOR_A })])).toEqual([
      { actor: ACTOR_A, label: ACTOR_A.slice(0, 8) },
    ]);
  });

  it('labels the null actor with the System sentinel', () => {
    expect(deriveActorOptions([makeRow({ kind: 'snapshot-created', actor: null })])).toEqual([
      { actor: null, label: SYSTEM_ACTOR_SENTINEL },
    ]);
  });

  it('returns one entry per distinct actor in first-appearance order', () => {
    const rows = [
      makeRow({ kind: 'node-created', actor: ACTOR_B }),
      makeRow({ kind: 'vote', actor: ACTOR_A }),
      makeRow({ kind: 'commit', actor: ACTOR_A }),
      makeRow({ kind: 'snapshot-created', actor: null }),
    ];
    expect(deriveActorOptions(rows)).toEqual([
      { actor: ACTOR_B, label: ACTOR_B.slice(0, 8) },
      { actor: ACTOR_A, label: ACTOR_A.slice(0, 8) },
      { actor: null, label: SYSTEM_ACTOR_SENTINEL },
    ]);
  });
});
