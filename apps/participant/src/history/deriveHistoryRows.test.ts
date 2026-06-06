// Unit tests for the pure participant history selector.
//
// Refinement: tasks/refinements/participant-ui/part_history_list.md
//   (Acceptance §3 — dedup by `id` across the REST + WS inputs, descending-
//    `sequence` (newest-first) ordering, the `actor === null` → system
//    path's source field, and the minimal row mapping. No `Date.now()` /
//    clock dependence.)
// ADRs:        docs/adr/0006-unit-test-framework-vitest.md,
//              docs/adr/0022-no-throwaway-verifications.md

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { deriveHistoryRows, EMPTY_HISTORY_ROWS } from './deriveHistoryRows';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

function nodeEvent(seq: number, overrides: Partial<Event> = {}): Event {
  return {
    id: `00000000-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`,
    sessionId: SESSION,
    sequence: seq,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: `00000000-0000-4000-8000-00000000000${seq}`,
      wording: `node ${String(seq)}`,
      created_by: ACTOR,
      created_at: '2026-06-03T00:00:00.000Z',
    },
    createdAt: '2026-06-03T00:00:00.000Z',
    ...overrides,
  } as Event;
}

describe('deriveHistoryRows', () => {
  it('returns a sequence-descending list with index 0 = highest sequence', () => {
    const prefetched = [nodeEvent(1), nodeEvent(2), nodeEvent(3)];
    const rows = deriveHistoryRows(prefetched, []);
    expect(rows.map((r) => r.sequence)).toEqual([3, 2, 1]);
    expect(rows[0]?.sequence).toBe(3);
  });

  it('unions prefetched + live and dedups by event id', () => {
    const prefetched = [nodeEvent(1), nodeEvent(2), nodeEvent(3)];
    const live = [nodeEvent(3), nodeEvent(4), nodeEvent(5)];
    const rows = deriveHistoryRows(prefetched, live);
    expect(rows.map((r) => r.sequence)).toEqual([5, 4, 3, 2, 1]);
    expect(rows).toHaveLength(5);
  });

  it('lets the live overlay win an id collision (freshest copy)', () => {
    // Same id, different sequence — live should win, and the row carries
    // the live envelope's fields.
    const prefetched = [nodeEvent(7, { id: 'shared-id', sequence: 7 })];
    const live = [nodeEvent(7, { id: 'shared-id', sequence: 8 })];
    const rows = deriveHistoryRows(prefetched, live);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sequence).toBe(8);
  });

  it('maps the minimal row contract (id / sequence / kind / actor / createdAt)', () => {
    const rows = deriveHistoryRows([nodeEvent(1)], []);
    expect(rows[0]).toEqual({
      id: nodeEvent(1).id,
      sequence: 1,
      kind: 'node-created',
      actor: ACTOR,
      createdAt: '2026-06-03T00:00:00.000Z',
    });
  });

  it('preserves a null actor (the system path source field)', () => {
    const rows = deriveHistoryRows([nodeEvent(1, { actor: null })], []);
    expect(rows[0]?.actor).toBeNull();
  });

  it('is pure — same inputs yield equal outputs regardless of input order', () => {
    const a = [nodeEvent(2), nodeEvent(5), nodeEvent(1)];
    const b = [nodeEvent(5), nodeEvent(1), nodeEvent(2)];
    const first = deriveHistoryRows(a, []);
    expect(deriveHistoryRows(b, [])).toEqual(first);
    expect(deriveHistoryRows(a, [])).toEqual(first);
  });

  it('returns the stable empty reference for two empty inputs', () => {
    expect(deriveHistoryRows([], [])).toBe(EMPTY_HISTORY_ROWS);
  });
});
