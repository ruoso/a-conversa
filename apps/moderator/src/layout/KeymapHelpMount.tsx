// `<KeymapHelpMount>` — bridge that subscribes to `useKeymapHelpStore`
// and conditionally renders the `?`-toggled keymap-help overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_keymap_help_overlay.md
//
// Mounted as a sibling of `<OperateLayout>` inside `OperateRoute` (next
// to `<SnapshotLabelInputMount>`) so the fixed-position overlay covers
// the layout from `z-50+` without participating in its CSS Grid.
// Isolating the mount/unmount in this thin component mirrors the
// `<SnapshotLabelInputMount>` subscription-bridge idiom (Decision §3).

import type { ReactElement } from 'react';

import { KeymapHelpOverlay } from './KeymapHelpOverlay';
import { useKeymapHelpStore } from './useKeymapHelpStore';

export function KeymapHelpMount(): ReactElement | null {
  const open = useKeymapHelpStore((s) => s.isOpen);
  return open ? <KeymapHelpOverlay /> : null;
}
