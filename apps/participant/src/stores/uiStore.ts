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
 * The three tabs the top-of-main switcher offers per
 * `docs/participant-ui.md`'s "two primary regions, switchable by tab or
 * split-view" + the `'my-agreements'` retrospective-audit affordance
 * scoped by `part_my_agreements_view`. The set is closed at v1; future
 * tabs add as literal members here.
 */
export type ParticipantTab = 'graph' | 'proposals' | 'my-agreements';

/** Bounds chosen to match the moderator's `[MIN_ZOOM, MAX_ZOOM]`. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

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
  setCurrentTab: (tab: ParticipantTab) => void;
  setZoom: (zoom: number) => void;
  /** Overwrite the open-row slot atomically. Passing `null` collapses. */
  setExpandedProposalId: (id: string | null) => void;
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
    setCurrentTab: (currentTab) => set({ currentTab }),
    setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
    setExpandedProposalId: (expandedProposalId) => set({ expandedProposalId }),
  })),
);
