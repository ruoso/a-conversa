// Tests for `mergeAndOrderEventLog` — the change-history pane's pure
// merge/order helper.
//
// Refinement: tasks/refinements/moderator-ui/mod_history_scroller.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
//
// Per ADR 0022 these are committed Vitest cases. They pin (Acceptance
// §1):
//   (a) Overlapping prefetched + live logs union, dedup on `sequence`,
//       and return a sequence-descending list (index 0 = highest).
//   (b) The live overlay wins a sequence collision (freshest copy).
//   (c) Purity — same input → same output across repeated calls, with
//       no dependence on the input array order.

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { mergeAndOrderEventLog } from './changeHistory';
import { summarizeEvent } from './eventSummary';

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

describe('mergeAndOrderEventLog', () => {
  it('returns a sequence-descending list with index 0 = highest sequence', () => {
    const prefetched = [nodeEvent(1), nodeEvent(2), nodeEvent(3)];
    const rows = mergeAndOrderEventLog(prefetched, []);
    expect(rows.map((r) => r.sequence)).toEqual([3, 2, 1]);
    expect(rows[0]?.sequence).toBe(3);
  });

  it('unions prefetched + live and dedups on sequence', () => {
    // Prefetched 1..3; live carries 3 (overlap) + 4 + 5 (newer).
    const prefetched = [nodeEvent(1), nodeEvent(2), nodeEvent(3)];
    const live = [nodeEvent(3), nodeEvent(4), nodeEvent(5)];
    const rows = mergeAndOrderEventLog(prefetched, live);
    expect(rows.map((r) => r.sequence)).toEqual([5, 4, 3, 2, 1]);
    // Exactly one row per sequence — the overlapping 3 is deduped.
    expect(rows).toHaveLength(5);
  });

  it('lets the live overlay win a sequence collision (freshest copy)', () => {
    const prefetched = [nodeEvent(7, { id: 'prefetched-id' })];
    const live = [nodeEvent(7, { id: 'live-id' })];
    const rows = mergeAndOrderEventLog(prefetched, live);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('live-id');
  });

  it('is pure — same inputs yield equal outputs regardless of input order', () => {
    const a = [nodeEvent(2), nodeEvent(5), nodeEvent(1)];
    const b = [nodeEvent(5), nodeEvent(1), nodeEvent(2)];
    const first = mergeAndOrderEventLog(a, []);
    const second = mergeAndOrderEventLog(b, []);
    expect(first).toEqual(second);
    // Repeated call on the same input is identical.
    expect(mergeAndOrderEventLog(a, [])).toEqual(first);
  });

  it('preserves the row contract fields (id / kind / actor / createdAt)', () => {
    const rows = mergeAndOrderEventLog([nodeEvent(1, { actor: null })], []);
    expect(rows[0]).toMatchObject({
      sequence: 1,
      kind: 'node-created',
      actor: null,
      createdAt: '2026-06-03T00:00:00.000Z',
    });
    expect(typeof rows[0]?.id).toBe('string');
  });

  it('populates each row.summary from summarizeEvent for that event (D2)', () => {
    // A free-text node and an enum-driven vote — both round-trip through
    // the row builder identically to a direct `summarizeEvent` call.
    const node = nodeEvent(1);
    const vote = {
      id: '00000000-0000-4000-8000-0000000000bb',
      sessionId: SESSION,
      sequence: 2,
      kind: 'vote',
      actor: ACTOR,
      payload: {
        target: 'facet',
        entity_kind: 'node',
        entity_id: '00000000-0000-4000-8000-0000000000e1',
        facet: 'substance',
        participant: ACTOR,
        choice: 'agree',
        voted_at: '2026-06-03T00:00:00.000Z',
      },
      createdAt: '2026-06-03T00:00:00.000Z',
    } as Event;

    const rows = mergeAndOrderEventLog([node, vote], []);
    const bySeq = new Map(rows.map((r) => [r.sequence, r]));
    expect(bySeq.get(1)?.summary).toEqual(summarizeEvent(node));
    expect(bySeq.get(1)?.summary).toEqual({ type: 'text', text: 'node 1' });
    expect(bySeq.get(2)?.summary).toEqual(summarizeEvent(vote));
    expect(bySeq.get(2)?.summary).toEqual({
      type: 'i18n',
      key: 'moderator.changeHistory.summary.choice.agree',
    });
  });
});
