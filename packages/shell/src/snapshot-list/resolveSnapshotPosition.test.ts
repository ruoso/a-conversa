// Vitest cases for the client `resolveSnapshotPosition` helper.
//
// Refinement: tasks/refinements/replay_test/snapshot_jump_ui.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications).
//
// The client twin of the server resolver
// (`apps/server/src/projection/snapshot-resolution.ts`): pure, total, and
// `null`-on-miss rather than throwing. Asserts: a known id resolves to its
// `logPosition`; an unknown id and an empty list both return `null` (never a
// throw); and resolution keys on `snapshotId`, so duplicate `logPosition`s
// still resolve to the matched record's position.

import { describe, expect, it } from 'vitest';

import { resolveSnapshotPosition } from './resolveSnapshotPosition.js';
import type { SnapshotRecord } from './types.js';

const SNAP_1 = '00000000-0000-4000-8000-000000000a01';
const SNAP_2 = '00000000-0000-4000-8000-000000000a02';
const SNAP_3 = '00000000-0000-4000-8000-000000000a03';

const RECORDS: readonly SnapshotRecord[] = [
  { snapshotId: SNAP_1, label: 'Opening', logPosition: 4, createdAt: '2026-06-01T10:00:00.000Z' },
  { snapshotId: SNAP_2, label: 'Midpoint', logPosition: 17, createdAt: '2026-06-01T10:30:00.000Z' },
  { snapshotId: SNAP_3, label: 'Close', logPosition: 42, createdAt: '2026-06-01T11:00:00.000Z' },
];

describe('resolveSnapshotPosition', () => {
  it('resolves a known snapshotId to that record’s logPosition', () => {
    expect(resolveSnapshotPosition(RECORDS, SNAP_2)).toBe(17);
  });

  it('returns null for an unknown snapshotId (no throw)', () => {
    expect(resolveSnapshotPosition(RECORDS, '00000000-0000-4000-8000-deadbeef0000')).toBeNull();
  });

  it('returns null for an empty list (no throw)', () => {
    expect(resolveSnapshotPosition([], SNAP_1)).toBeNull();
  });

  it('keys on snapshotId, not position: duplicate logPositions resolve by id', () => {
    const dupes: readonly SnapshotRecord[] = [
      { snapshotId: SNAP_1, label: 'A', logPosition: 9, createdAt: '2026-06-01T10:00:00.000Z' },
      { snapshotId: SNAP_2, label: 'B', logPosition: 9, createdAt: '2026-06-01T10:30:00.000Z' },
    ];
    expect(resolveSnapshotPosition(dupes, SNAP_2)).toBe(9);
    expect(resolveSnapshotPosition(dupes, SNAP_1)).toBe(9);
  });
});
