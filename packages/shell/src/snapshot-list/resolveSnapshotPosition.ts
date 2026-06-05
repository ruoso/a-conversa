// Client-side snapshot→position resolver for the cross-surface jump affordance.
//
// Refinement: tasks/refinements/replay_test/snapshot_jump_ui.md
//
// Mirrors the server helper of the same name
// (`apps/server/src/projection/snapshot-resolution.ts`) but operates on the
// client camelCase `SnapshotRecord` already loaded by `useSessionSnapshots`,
// and returns `null` rather than throwing `SnapshotNotFoundError`: this runs
// inside a React click handler, where the server twin's loud throw would
// crash the surface. The only caller selects from rendered rows, so a miss is
// effectively unreachable — `null` (and no jump) is the safe, total result.
//
// The `snapshotId` is the lookup key (unique by the addSnapshot invariant);
// `logPosition` is not — records may share a position, so resolution must
// match by id, not by position. `logPosition` is already in event-sequence
// space, so this is pure lookup, no new position vocabulary.

import type { SnapshotRecord } from './types.js';

export function resolveSnapshotPosition(
  snapshots: readonly SnapshotRecord[],
  snapshotId: string,
): number | null {
  const record = snapshots.find((s) => s.snapshotId === snapshotId);
  return record === undefined ? null : record.logPosition;
}
