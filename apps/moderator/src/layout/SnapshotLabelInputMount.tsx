// `<SnapshotLabelInputMount>` — bridge that subscribes to
// `useSnapshotFlowStore` and conditionally renders the F10
// snapshot-label modal.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_label_input.md
//
// Mounted as a sibling of `<OperateLayout>` inside `OperateRoute` so
// the fixed-position overlay covers the layout from `z-50+` without
// participating in its CSS Grid (Decision §3). Isolating the
// mount/unmount in this thin component keeps the route's JSX from
// growing yet another store subscription — `OperateRoute` already
// reads `isLabelInputOpen` to drive the `data-snapshot-flow-open`
// attribute on the layout root.

import type { ReactElement } from 'react';

import { SnapshotLabelInputModal } from './SnapshotLabelInputModal';
import { useSnapshotFlowStore } from './useSnapshotFlowStore';

export function SnapshotLabelInputMount(): ReactElement | null {
  const open = useSnapshotFlowStore((s) => s.isLabelInputOpen);
  return open ? <SnapshotLabelInputModal /> : null;
}
