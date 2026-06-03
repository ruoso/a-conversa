import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { projectAtPosition } from './at-position.js';
import {
  nextSnapshotPosition,
  prevSnapshotPosition,
  resolveSnapshotPosition,
  SnapshotNotFoundError,
  snapshotPositions,
} from './index.js';
import type { SnapshotRecord } from './types.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';

const NODE_ID_1 = '66666666-6666-4666-8666-666666666666';
const SNAPSHOT_ID_1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SNAPSHOT_ID_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SNAPSHOT_ID_3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UNKNOWN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const T0 = '2026-05-10T12:00:00Z';

function makeSnapshot(snapshotId: string, label: string, logPosition: number): SnapshotRecord {
  return { snapshotId, label, logPosition, createdAt: T0 };
}

// Markers at positions 10, 20, 30; deliberately out of position order and with
// a duplicate logPosition (20) to pin ascending + de-dup + insertion-order
// independence.
function buildSnapshots(): SnapshotRecord[] {
  return [
    makeSnapshot(SNAPSHOT_ID_2, 'Segment 2 close', 20),
    makeSnapshot(SNAPSHOT_ID_1, 'Segment 1 close', 10),
    makeSnapshot('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Segment 2 close (dup pos)', 20),
    makeSnapshot(SNAPSHOT_ID_3, 'Segment 3 close', 30),
  ];
}

describe('resolveSnapshotPosition', () => {
  it('returns the record logPosition for a known id', () => {
    expect(resolveSnapshotPosition(buildSnapshots(), SNAPSHOT_ID_1)).toBe(10);
    expect(resolveSnapshotPosition(buildSnapshots(), SNAPSHOT_ID_3)).toBe(30);
  });

  it('throws SnapshotNotFoundError naming the id for an unknown id', () => {
    expect(() => resolveSnapshotPosition(buildSnapshots(), UNKNOWN_ID)).toThrow(
      SnapshotNotFoundError,
    );
    expect(() => resolveSnapshotPosition(buildSnapshots(), UNKNOWN_ID)).toThrow(UNKNOWN_ID);
  });

  it('throws SnapshotNotFoundError naming the id for an empty snapshot list', () => {
    expect(() => resolveSnapshotPosition([], SNAPSHOT_ID_1)).toThrow(SnapshotNotFoundError);
    expect(() => resolveSnapshotPosition([], SNAPSHOT_ID_1)).toThrow(SNAPSHOT_ID_1);
  });
});

describe('snapshotPositions', () => {
  it('returns positions ascending with duplicates collapsed, independent of insertion order', () => {
    expect(snapshotPositions(buildSnapshots())).toEqual([10, 20, 30]);
  });

  it('returns [] for no snapshots', () => {
    expect(snapshotPositions([])).toEqual([]);
  });
});

describe('nextSnapshotPosition', () => {
  it('returns the first marker from before the first marker', () => {
    expect(nextSnapshotPosition(buildSnapshots(), 0)).toBe(10);
    expect(nextSnapshotPosition(buildSnapshots(), 5)).toBe(10);
  });

  it('returns the nearest marker strictly greater when on a marker', () => {
    expect(nextSnapshotPosition(buildSnapshots(), 10)).toBe(20);
    expect(nextSnapshotPosition(buildSnapshots(), 20)).toBe(30);
  });

  it('returns the nearest marker strictly greater when between markers', () => {
    expect(nextSnapshotPosition(buildSnapshots(), 15)).toBe(20);
    expect(nextSnapshotPosition(buildSnapshots(), 25)).toBe(30);
  });

  it('returns null on or after the last marker', () => {
    expect(nextSnapshotPosition(buildSnapshots(), 30)).toBeNull();
    expect(nextSnapshotPosition(buildSnapshots(), 99)).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(nextSnapshotPosition([], 5)).toBeNull();
  });
});

describe('prevSnapshotPosition', () => {
  it('returns the last marker from after the last marker', () => {
    expect(prevSnapshotPosition(buildSnapshots(), 99)).toBe(30);
    expect(prevSnapshotPosition(buildSnapshots(), 31)).toBe(30);
  });

  it('returns the nearest marker strictly less when on a marker', () => {
    expect(prevSnapshotPosition(buildSnapshots(), 30)).toBe(20);
    expect(prevSnapshotPosition(buildSnapshots(), 20)).toBe(10);
  });

  it('returns the nearest marker strictly less when between markers', () => {
    expect(prevSnapshotPosition(buildSnapshots(), 25)).toBe(20);
    expect(prevSnapshotPosition(buildSnapshots(), 15)).toBe(10);
  });

  it('returns null on or before the first marker', () => {
    expect(prevSnapshotPosition(buildSnapshots(), 10)).toBeNull();
    expect(prevSnapshotPosition(buildSnapshots(), 0)).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(prevSnapshotPosition([], 5)).toBeNull();
  });
});

describe('composition with projectAtPosition', () => {
  function evId(n: number): string {
    const hex = n.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  }

  function makeEvent<K extends Event['kind']>(
    sequence: number,
    kind: K,
    actor: string | null,
    createdAt: string,
    payload: Extract<Event, { kind: K }>['payload'],
  ): Extract<Event, { kind: K }> {
    return {
      id: evId(sequence),
      sessionId: SESSION_ID,
      sequence,
      kind,
      actor,
      payload,
      createdAt,
    } as Extract<Event, { kind: K }>;
  }

  it('resolves a snapshot and projects at its position to that lastAppliedSequence', () => {
    // A log whose snapshot-created event (sequence 3) records log_position 2,
    // the position taken at the time of the snapshot.
    const events: Event[] = [
      makeEvent(1, 'session-created', HOST_ID, T0, {
        host_user_id: HOST_ID,
        privacy: 'public',
        topic: 'Test debate',
        created_at: T0,
      }),
      makeEvent(2, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'Claim A',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(3, 'snapshot-created', MODERATOR_ID, T0, {
        snapshot_id: SNAPSHOT_ID_1,
        label: 'Segment 1 close',
        log_position: 2,
      }),
    ];
    const snapshots: SnapshotRecord[] = [makeSnapshot(SNAPSHOT_ID_1, 'Segment 1 close', 2)];

    const position = resolveSnapshotPosition(snapshots, SNAPSHOT_ID_1);
    expect(position).toBe(2);

    const projection = projectAtPosition(events, SESSION_ID, position);
    expect(projection.lastAppliedSequence).toBe(position);
  });
});
