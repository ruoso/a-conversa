// `useKeymapHelpStore` — module-scoped Zustand slice for the `?`-toggled
// keymap-help overlay's open/closed bit.
//
// Refinement: tasks/refinements/moderator-ui/mod_keymap_help_overlay.md
//
// Two call sites observe and write the same single bit: the `?` toggle
// hook (`useKeymapHelpShortcut`) and the sidebar help button
// (`<KeymapHelpButton>`); the overlay itself calls `close()` on
// Esc / backdrop / close-button. A module-scoped Zustand slice gives
// them a single source of truth without provider wiring — mirrors the
// `useSnapshotFlowStore` idiom this overlay is modelled on.
//
// `open()` / `close()` are idempotent (calling into the target state is
// a reference-stable no-op so subscribers see no spurious update);
// `toggle()` is the natural primitive for the press-again-to-close
// cheat-sheet behaviour (Decision §5).

import { create } from 'zustand';

interface KeymapHelpState {
  readonly isOpen: boolean;
  readonly open: () => void;
  readonly close: () => void;
  readonly toggle: () => void;
}

export const useKeymapHelpStore = create<KeymapHelpState>((set) => ({
  isOpen: false,
  open: () => set((state) => (state.isOpen ? state : { ...state, isOpen: true })),
  close: () => set((state) => (state.isOpen ? { ...state, isOpen: false } : state)),
  toggle: () => set((state) => ({ ...state, isOpen: !state.isOpen })),
}));

/**
 * Test seam — reset the keymap-help slice between cases without poking
 * at the store's internals. Mirrors `resetSnapshotFlowStore()`.
 */
export function resetKeymapHelpStore(): void {
  useKeymapHelpStore.setState({ isOpen: false });
}
