// Shared record shape for the cross-surface snapshot list.
//
// Refinement: tasks/refinements/replay_test/snapshot_list_ui.md
//
// Mirrors the camelCase wire shape returned by
// `GET /sessions/:id/snapshots` (`apps/server/src/replay/routes.ts`) and
// the moderator's local `Snapshot` interface
// (`apps/moderator/src/graph/selectors.ts`). Snapshots are events, not a
// separate table; this is the projected, navigation-ordered record the
// replay/test surfaces render.

export interface SnapshotRecord {
  readonly snapshotId: string;
  readonly label: string;
  readonly logPosition: number;
  readonly createdAt: string;
}
