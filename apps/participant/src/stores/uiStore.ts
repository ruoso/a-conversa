// `useUiStore` — global participant-UI chrome toggles.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md
//
// Holds the participant's view preferences inside a single session:
// which top-of-main tab (`'graph'` / `'proposals'` / `'my-agreements'`)
// is foregrounded, and the graph-canvas zoom level. Persistence is
// in-memory only.

import { create } from 'zustand';

import { withDevtools } from './devtools.js';

/**
 * The tabs the top-of-main switcher offers per `docs/participant-ui.md`'s
 * "two primary regions, switchable by tab or split-view" + the
 * `'my-agreements'` retrospective-audit affordance scoped by
 * `part_my_agreements_view` + the `'history'` change-history view scoped by
 * `part_history_list`. The set is closed at v1; future tabs add as literal
 * members here.
 */
export type ParticipantTab = 'graph' | 'proposals' | 'my-agreements' | 'history';

/** Bounds chosen to match the moderator's `[MIN_ZOOM, MAX_ZOOM]`. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/**
 * A one-shot, imperative request to re-frame the graph canvas on a set
 * of entities. The diagnostics list lives in the operate-route footer
 * (a `ParticipantLayout` sibling of `main`), so it cannot reach the
 * Cytoscape `Core` directly; it dispatches one of these
 * (`requestCanvasFocus`) and a thin effect inside `<GraphView>`
 * (`useCanvasFocusEffect`) consumes it and calls `cy.animate({ fit })`.
 * The monotonic `nonce` is load-bearing: it is the consumer's ref-guard
 * key and lets an identical re-tap re-center. Mirrors the moderator
 * `uiStore` twin line-for-line. Refinement:
 * `part_diagnostic_focus` Decision §D1/§D2.
 */
export interface FocusRequest {
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly nonce: number;
}

export interface UiState {
  /** Which top-of-main tab is foregrounded. */
  currentTab: ParticipantTab;
  /** Graph-canvas zoom level, clamped to `[MIN_ZOOM, MAX_ZOOM]`. */
  zoom: number;
  /**
   * Single-open accordion slot for the pending-proposals tab row
   * disclosure: the `event.id` of the currently-expanded proposal row,
   * or `null` when every row is collapsed. The slot shape itself
   * enforces the "at most one open" contract.
   */
  expandedProposalId: string | null;
  /**
   * The latest canvas-focus command, or `null` before any has fired.
   * Each `requestCanvasFocus` call replaces it with a fresh object whose
   * `nonce` has advanced by one. Transient, in-memory only.
   */
  focusRequest: FocusRequest | null;
  setCurrentTab: (tab: ParticipantTab) => void;
  setZoom: (zoom: number) => void;
  /** Overwrite the open-row slot atomically. Passing `null` collapses. */
  setExpandedProposalId: (id: string | null) => void;
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
  withDevtools('participant/ui', (set) => ({
    currentTab: 'graph',
    zoom: 1,
    expandedProposalId: null,
    focusRequest: null,
    setCurrentTab: (currentTab) => set({ currentTab }),
    setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
    setExpandedProposalId: (expandedProposalId) => set({ expandedProposalId }),
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
