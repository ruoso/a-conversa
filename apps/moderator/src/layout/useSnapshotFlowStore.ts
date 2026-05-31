// `useSnapshotFlowStore` — module-scoped Zustand slice for the F10
// snapshot trigger flag.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_action.md
//
// Three independent call sites observe and write the same single bit:
// the sidebar button (`<SnapshotActionButton>`), the Cmd/Ctrl+S
// shortcut hook (`useSnapshotShortcut`), and — once it lands —
// `mod_snapshot_label_input`'s modal lifecycle. A module-scoped Zustand
// slice gives all three a single source of truth without provider
// wiring; mirrors the `useCommitStore` / `useProposeErrorStore`
// colocation idiom in `useCommitAction.ts`.
//
// `open()` and `close()` are both idempotent — calling `open()` while
// already open (e.g., the moderator presses the shortcut just after
// clicking the button) is a no-op; `close()` is the symmetric reset the
// modal calls on submit / cancel.

import { create } from 'zustand';

interface SnapshotFlowState {
  readonly isLabelInputOpen: boolean;
  readonly open: () => void;
  readonly close: () => void;
}

export const useSnapshotFlowStore = create<SnapshotFlowState>((set) => ({
  isLabelInputOpen: false,
  open: () =>
    set((state) => (state.isLabelInputOpen ? state : { ...state, isLabelInputOpen: true })),
  close: () =>
    set((state) => (state.isLabelInputOpen ? { ...state, isLabelInputOpen: false } : state)),
}));

/**
 * Test seam — reset the snapshot-flow slice between cases without
 * poking at the store's internals. Mirrors `resetCommitStore()` from
 * the commit hook.
 */
export function resetSnapshotFlowStore(): void {
  useSnapshotFlowStore.setState({ isLabelInputOpen: false });
}
