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

/**
 * A one-shot, imperative request to re-frame the graph canvas on a set
 * of entities. The flag pane (outside the `<ReactFlowProvider>`)
 * dispatches one; a thin effect inside the provider
 * (`useCanvasFocusEffect`) consumes it and calls `fitView`. The
 * monotonic `nonce` is load-bearing: it is the consumer's ref-guard key
 * and lets an identical re-click re-center. Refinement:
 * `mod_diagnostic_focus_action` Decision §D1/§D2.
 */
export interface FocusRequest {
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly nonce: number;
}

export interface UiState {
  /** Which right-sidebar sub-pane is foregrounded. */
  activeSidebarPane: SidebarPane;
  /** Graph-canvas zoom level, clamped to `[MIN_ZOOM, MAX_ZOOM]`. */
  zoom: number;
  /**
   * The latest canvas-focus command, or `null` before any has fired.
   * Each `requestCanvasFocus` call replaces it with a fresh object whose
   * `nonce` has advanced by one. Transient, in-memory only.
   */
  focusRequest: FocusRequest | null;
  setActiveSidebarPane: (pane: SidebarPane) => void;
  setZoom: (zoom: number) => void;
  /**
   * Dispatch a fresh canvas-focus command for the given entity set. The
   * new `focusRequest` is a distinct object reference with `nonce` =
   * previous nonce + 1 (1 from the initial `null`).
   */
  requestCanvasFocus: (target: { nodeIds: readonly string[]; edgeIds: readonly string[] }) => void;
}

function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export const useUiStore = create<UiState>()(
  withDevtools('moderator/ui', (set) => ({
    activeSidebarPane: 'pending-proposals',
    zoom: 1,
    focusRequest: null,
    setActiveSidebarPane: (activeSidebarPane) => set({ activeSidebarPane }),
    setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
    requestCanvasFocus: (target) =>
      set((state) => ({
        focusRequest: {
          nodeIds: target.nodeIds,
          edgeIds: target.edgeIds,
          nonce: (state.focusRequest?.nonce ?? 0) + 1,
        },
      })),
  })),
);
