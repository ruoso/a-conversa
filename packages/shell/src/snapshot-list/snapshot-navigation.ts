// Snapshot-granularity (chapter) navigation for the replay/test surfaces.
//
// Refinement: tasks/refinements/replay_test/replay_chapter_jumping.md
//
// Client port of the server twin's chapter-navigation helpers
// (`apps/server/src/projection/snapshot-resolution.ts`), operating on the
// client camelCase `SnapshotRecord` already loaded by `useSessionSnapshots`.
// ADR 0043: the client replay-navigation contract lives here in
// `@a-conversa/shell` and is never imported from `apps/server`, never
// re-derived inside a component — chapter next/prev is the same contract one
// granularity coarser than `nextPosition`/`prevPosition`, so it joins them
// here beside `resolveSnapshotPosition` (which already lives in this
// subsystem alongside `SnapshotRecord`).
//
// Positions are event-sequence space — a snapshot's `logPosition` is already
// in that vocabulary, so this is pure lookup/ordering, no projecting and no
// new position vocabulary. Sparse markers return `null` at the ends (rather
// than saturating) so a chapter UI can disable its affordance.

import type { SnapshotRecord } from './types.js';

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
