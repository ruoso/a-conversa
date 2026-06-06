// `useSelectedProposalStore` — the currently-"focused" pending proposal
// in the right-sidebar's pending-proposals pane.
//
// Refinement:
//   tasks/refinements/moderator-ui/mod_proposal_selection_commit_chord.md
//
// A single-field module-scoped slice, deliberately separate from the
// graph `useSelectionStore` (Decision §1): a pending proposal is an
// uncommitted event keyed by its stable `proposalEventId`, NOT a
// committed canvas entity (`{ kind, id }`). Sharing the graph slice
// would conflate two selection domains; a dedicated one-field store has
// no cross-talk.
//
// The store is the seam that crosses the pane → document-listener
// boundary: the pane writes it on a row click, and the route-mounted
// `useProposalCommitChord()` bridge reads it via `getState()` when the
// `Cmd/Ctrl+Shift+Enter` chord fires. Local component `useState` would
// be unreachable from the document-level dispatcher (Decision §1,
// rejected alternative).

import { create } from 'zustand';

import { withDevtools } from './devtools.js';

export interface SelectedProposalState {
  /** The selected proposal's stable `proposalEventId`, or `null`. */
  selectedProposalId: string | null;
  /** Single-select: selecting a new id replaces the prior selection. */
  select: (id: string) => void;
  /** Clear the selection (Esc, pane-background click, or stale-target). */
  clear: () => void;
}

export const useSelectedProposalStore = create<SelectedProposalState>()(
  withDevtools('moderator/selected-proposal', (set) => ({
    selectedProposalId: null,
    select: (id) => set({ selectedProposalId: id }),
    clear: () => set({ selectedProposalId: null }),
  })),
);

/**
 * Test seam — reset the selection slice between cases without poking at
 * the store's internals. Mirrors `resetSnapshotFlowStore()` /
 * `resetCommitStore()`.
 */
export function resetSelectedProposalStore(): void {
  useSelectedProposalStore.setState({ selectedProposalId: null });
}
