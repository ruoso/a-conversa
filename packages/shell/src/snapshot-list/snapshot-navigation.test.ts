// Vitest cases for the ported chapter-navigation helpers.
//
// Refinement: tasks/refinements/replay_test/replay_chapter_jumping.md
//   (Acceptance §1 — mirror the server suite
//    `apps/server/src/projection/snapshot-resolution.test.ts`: positions are
//    ascending + de-duplicated; `nextSnapshotPosition` is the nearest strictly
//    greater marker and `null` past the last; `prevSnapshotPosition` the
//    nearest strictly less and `null` before the first; an empty set yields
//    `[]` and `null` both directions; a position on a marker steps to the
//    next/prev marker, not back to itself.)
// ADRs: 0006 (Vitest), 0043 (the client replay-navigation contract).

import { describe, expect, it } from 'vitest';

import {
  nextSnapshotPosition,
  prevSnapshotPosition,
  snapshotPositions,
} from './snapshot-navigation.js';
import type { SnapshotRecord } from './types.js';

const SNAPSHOT_ID_1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SNAPSHOT_ID_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SNAPSHOT_ID_3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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

  it('returns the nearest marker strictly greater when on a marker (not back to itself)', () => {
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

  it('returns the nearest marker strictly less when on a marker (not back to itself)', () => {
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
