// `useUiStore` — global moderator-UI chrome toggles.
//
// Refinement: tasks/refinements/moderator-ui/mod_state_management.md
//
// Holds the moderator's view preferences inside a single session:
// which right-sidebar sub-pane is visible, what the graph-canvas zoom
// level is. Persistence is in-memory only (the refinement is explicit
// on that point); a fresh tab opens with the defaults.

import { create } from 'zustand';

import { withDevtools } from './devtools.js';

/**
 * The right-sidebar contains stacked sub-panes (pending proposals,
 * change history, diagnostic flags, …). Exactly one is foregrounded at
 * a time. The set of pane keys is open-ended — downstream tasks under
 * `mod_layout.mod_right_sidebar` will add to it as panes land.
 */
export type SidebarPane = 'pending-proposals' | 'change-history' | 'diagnostic-flags';

/** Bounds chosen to match a typical fit-to-screen baseline (1.0). */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export interface UiState {
  /** Which right-sidebar sub-pane is foregrounded. */
  activeSidebarPane: SidebarPane;
  /** Graph-canvas zoom level, clamped to `[MIN_ZOOM, MAX_ZOOM]`. */
  zoom: number;
  setActiveSidebarPane: (pane: SidebarPane) => void;
  setZoom: (zoom: number) => void;
}

function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export const useUiStore = create<UiState>()(
  withDevtools('moderator/ui', (set) => ({
    activeSidebarPane: 'pending-proposals',
    zoom: 1,
    setActiveSidebarPane: (activeSidebarPane) => set({ activeSidebarPane }),
    setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  })),
);
