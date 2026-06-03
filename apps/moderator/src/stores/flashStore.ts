// `useFlashStore` — the transient entity-flash channel.
//
// Refinement: tasks/refinements/moderator-ui/mod_history_click_to_flash.md
//             (Constraint §7, Decision §D1)
//
// Activating a change-history row briefly **flashes** the graph entities
// that event touched — a self-clearing pulse that draws the moderator's
// eye to the node(s) / edge(s) the event affected. This store is the
// channel: the click handler calls `flash(ids)`; the node / edge
// components read `flashingIds.has(id)` by id and self-style (the same
// read-by-id pattern `useSelectionStore` established); a single auto-clear
// effect (`useFlashAutoClear`) watches `flashNonce` and empties the set
// after `FLASH_DURATION_MS`.
//
// **Two channels, one click** (Decision §D1). Re-framing the viewport
// (`fitView`, via `useUiStore.requestCanvasFocus`) and changing entity
// *appearance* are structurally different jobs — the focus consumer holds
// a `ReactFlowInstance` and pans the camera; it has no path to a node's
// render. Entity appearance is driven the way selection already is, so
// flashing is its own store rather than an overload of the focus channel.
//
// **Transient, in-memory only**, modelled on `useUiStore.focusRequest`:
// the monotonic `flashNonce` is the auto-clear effect's ref-guard key
// (exactly like `useCanvasFocusEffect`'s `lastHandledNonce`) and lets an
// identical re-activation restart the pulse. No persistence, no
// accumulation — each `flash` replaces the set (Constraint §11).

import { create } from 'zustand';

import { withDevtools } from './devtools.js';

export interface FlashState {
  /**
   * The graph-entity ids currently flashing. Node / edge components read
   * `flashingIds.has(id)` by id; empty between flashes. `ReadonlySet` so
   * consumers can't mutate the shared set.
   */
  flashingIds: ReadonlySet<string>;
  /**
   * Monotonic counter advanced on every `flash` call. The auto-clear
   * effect ref-guards on it (re-arm the timer only when it advances) and a
   * same-set re-activation still advances it so the pulse restarts.
   */
  flashNonce: number;
  /**
   * Flash exactly the given ids — REPLACING any currently-flashing set (no
   * accumulation, Constraint §11) and advancing `flashNonce` by one.
   */
  flash: (ids: readonly string[]) => void;
  /** Empty `flashingIds`. Called by the auto-clear timer. */
  clear: () => void;
}

export const useFlashStore = create<FlashState>()(
  withDevtools('moderator/flash', (set) => ({
    flashingIds: new Set<string>(),
    flashNonce: 0,
    flash: (ids) =>
      set((state) => ({
        flashingIds: new Set(ids),
        flashNonce: state.flashNonce + 1,
      })),
    clear: () => set({ flashingIds: new Set<string>() }),
  })),
);
