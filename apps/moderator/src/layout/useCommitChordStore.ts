// `useCommitChordStore` — the imperative seam between the document-level
// action-chord dispatcher and the React-bound commit machinery.
//
// Refinement:
//   tasks/refinements/moderator-ui/mod_proposal_selection_commit_chord.md
//
// The `Cmd/Ctrl+Shift+Enter` commit chord must, on match, run commit
// work that needs the React-context-only `WsClient` (`useWsClient()`
// throws outside `<WsClientProvider>`). The dispatcher (`useGlobalKeymap`)
// is intentionally context-free — its snapshot tests run with no
// provider — so it cannot hold a `WsClient`. This module-scoped slice is
// the bridge: the route-mounted `useProposalCommitChord()` hook captures
// the client and registers a stable `run` callback here; the dispatcher
// invokes `getState().run?.()` on the chord, symmetric with how it calls
// `useSnapshotFlowStore.getState().open()` for `Cmd/Ctrl+S` (Decision §2).
//
// `run` is `null` whenever the bridge hook is unmounted (no operate
// route) — the dispatcher's optional-chaining call is then a safe no-op.

import { create } from 'zustand';

interface CommitChordState {
  /** The registered commit-the-selected-proposal callback, or `null`. */
  readonly run: (() => void) | null;
  /** Register (or clear, with `null`) the imperative commit callback. */
  readonly setRun: (run: (() => void) | null) => void;
}

export const useCommitChordStore = create<CommitChordState>((set) => ({
  run: null,
  setRun: (run) => set({ run }),
}));

/**
 * Test seam — reset the commit-chord slice between cases. Mirrors
 * `resetSnapshotFlowStore()`.
 */
export function resetCommitChordStore(): void {
  useCommitChordStore.setState({ run: null });
}
