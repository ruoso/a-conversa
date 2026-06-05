// Connected, surface-agnostic jump-to-snapshot affordance.
//
// Refinement: tasks/refinements/replay_test/snapshot_jump_ui.md
// ADRs:        0003 (React); 0010 (pnpm-workspace package placement).
//
// Composes `useSessionSnapshots(sessionId)` + the presentational
// `SnapshotList` + the client `resolveSnapshotPosition`, turning a row
// selection into a *navigation to that snapshot's position*. `snapshot_list_ui`
// deliberately shipped a pure `onSelect(snapshotId)` that does nothing so the
// navigation could be wired here, once, at the jump boundary.
//
// The host mounts `<SnapshotJumpList sessionId={…} onJump={setPosition} />` and
// receives a single `onJump(position)` callback in **event-sequence space** —
// the same vocabulary as `GET /sessions/:id/state?position=N`, the seek bar,
// and `position_navigation`. The component never leaks `snapshotId` to the
// host: resolving the selection to a `logPosition` happens here, so the replay
// viewer and test-mode scrubber stay position-only and share one primitive.
//
// It owns no surface, no route, and no "current position" state — load / error
// (+ retry) / empty / ready all pass straight through from the hook + list.

import type { ReactElement } from 'react';

import { resolveSnapshotPosition } from './resolveSnapshotPosition.js';
import { SnapshotList } from './SnapshotList.js';
import { useSessionSnapshots } from './useSessionSnapshots.js';

export interface SnapshotJumpListProps {
  readonly sessionId: string;
  /**
   * Fired with the selected snapshot's `logPosition` (event-sequence space)
   * when a row is activated and resolves. A selection that fails to resolve
   * (defensive; not normally reachable from rendered rows) performs no jump.
   */
  readonly onJump: (position: number) => void;
}

export function SnapshotJumpList(props: SnapshotJumpListProps): ReactElement {
  const { sessionId, onJump } = props;
  const { status, snapshots, retry } = useSessionSnapshots(sessionId);

  return (
    <SnapshotList
      status={status}
      snapshots={snapshots}
      onRetry={retry}
      onSelect={(snapshotId: string) => {
        const position = resolveSnapshotPosition(snapshots, snapshotId);
        if (position !== null) {
          onJump(position);
        }
      }}
    />
  );
}

export default SnapshotJumpList;
