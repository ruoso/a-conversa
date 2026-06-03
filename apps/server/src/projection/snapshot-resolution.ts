// Resolve a named snapshot to its event-sequence position, and compute the
// snapshot-granularity (chapter) navigation that chapter-jumping needs.
//
// Refinement: tasks/refinements/data-and-methodology/snapshot_resolution.md
// TaskJuggler: data_and_methodology.replay_primitive.snapshot_resolution
//
// Resolution computes *positions only*; rendering at a position remains
// projectAtPosition's job and stepping between adjacent events remains
// position_navigation's. A snapshot's logPosition is already in event-sequence
// space, so this is pure lookup/ordering around it — no new position
// vocabulary, no projecting, no event log. The canonical key is the snapshotId
// (unique by the addSnapshot invariant); labels carry no uniqueness guarantee.
// An unknown id is a caller bug and throws SnapshotNotFoundError, matching the
// loud-contract style of ReplayPositionError.

import type { SnapshotRecord } from './types.js';

export class SnapshotNotFoundError extends Error {
  override readonly name = 'SnapshotNotFoundError';
  readonly snapshotId: string;

  constructor(snapshotId: string) {
    super(`no snapshot found for id ${snapshotId}`);
    this.snapshotId = snapshotId;
  }
}

export function resolveSnapshotPosition(
  snapshots: readonly SnapshotRecord[],
  snapshotId: string,
): number {
  const record = snapshots.find((s) => s.snapshotId === snapshotId);
  if (record === undefined) {
    throw new SnapshotNotFoundError(snapshotId);
  }
  return record.logPosition;
}

// The chapter markers: snapshot logPositions, ascending and de-duplicated.
// Order is independent of the records' insertion order.
export function snapshotPositions(snapshots: readonly SnapshotRecord[]): number[] {
  const unique = new Set(snapshots.map((s) => s.logPosition));
  return [...unique].sort((a, b) => a - b);
}

// The nearest chapter marker strictly greater than `position`, or null if there
// is no further chapter (sparse markers → null rather than saturation, so a
// chapter UI can disable its affordance).
export function nextSnapshotPosition(
  snapshots: readonly SnapshotRecord[],
  position: number,
): number | null {
  for (const marker of snapshotPositions(snapshots)) {
    if (marker > position) {
      return marker;
    }
  }
  return null;
}

// The nearest chapter marker strictly less than `position`, or null if there is
// no earlier chapter.
export function prevSnapshotPosition(
  snapshots: readonly SnapshotRecord[],
  position: number,
): number | null {
  const markers = snapshotPositions(snapshots);
  for (let i = markers.length - 1; i >= 0; i -= 1) {
    if (markers[i]! < position) {
      return markers[i]!;
    }
  }
  return null;
}
