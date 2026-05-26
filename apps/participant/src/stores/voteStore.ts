// `useVoteStore` — per-`(proposalId, facetId)` pending votes the debater
// has tapped but the surface has not yet sent to the backend.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md
//
// The slice is "local UI state" in the strict sense — it holds the
// button-pressed signal so multiple components can read a consistent
// local view (the per-facet button strip, an "Agree all" gesture, an
// eventual voting summary). The active vote-dispatch path is
// `apps/participant/src/detail/useVoteAction.ts`; this slice was
// originally planned for the dispatch path but the active
// implementation took a different shape and the slice is currently
// unused outside its own tests. It remains as a potential home for a
// future queued-local-vote indicator (`part_queued_local_vote_indicator`
// under `part_voting.*`, not yet registered).
//
// Per `docs/participant-ui.md` P2: single-tap votes with no
// confirmation modal; vote changes are allowed up to commit (so the
// slice's `setVote` is the same writer for both "first vote" and
// "change vote"). Withdraw is NOT in this slice — withdrawal is the
// post-commit P3 flow with a confirmation dialog and a different
// wire-envelope shape (`vote: withdraw`), owned by `part_withdraw.*`.

import { create } from 'zustand';

import { withDevtools } from './devtools.js';

/**
 * The two pre-commit vote values a debater can cast on a single facet.
 * Mirrors the `vote` enum's pre-commit arms in
 * `packages/shared-types/src/events.ts:353` (the third arm, `'withdraw'`,
 * is the P3 post-commit flow and lives in a different store path).
 */
export type VoteValue = 'agree' | 'dispute';

/**
 * A vote keyed by the pair `(proposalId, facetId)` flattened to a
 * single string. The flattening keeps the slice flat (`Record<string, VoteValue>`)
 * instead of nested (`Record<proposalId, Record<facetId, VoteValue>>`),
 * which simplifies the setter / remover / iteration and matches how
 * Zustand examples typically index sparse key-spaces.
 */
function voteKey(proposalId: string, facetId: string): string {
  return `${proposalId}::${facetId}`;
}

export interface VoteState {
  /** Pending votes keyed by `voteKey(proposalId, facetId)`. */
  votes: Readonly<Record<string, VoteValue>>;
  /** Set or change the pending vote on a facet. Same writer for first-vote and change-vote. */
  setVote: (proposalId: string, facetId: string, value: VoteValue) => void;
  /** Remove the pending vote on a facet (called by the consumer on server ack, or by the user clearing). */
  removeVote: (proposalId: string, facetId: string) => void;
  /** Read the pending vote on a facet, or `undefined` if none. */
  getVote: (proposalId: string, facetId: string) => VoteValue | undefined;
  /** Reset to no pending votes — called on session change / surface unmount. */
  reset: () => void;
}

export { voteKey };

export const useVoteStore = create<VoteState>()(
  withDevtools('participant/vote', (set, get) => ({
    votes: {},
    setVote: (proposalId, facetId, value) =>
      set((state) => ({
        votes: { ...state.votes, [voteKey(proposalId, facetId)]: value },
      })),
    removeVote: (proposalId, facetId) =>
      set((state) => {
        const key = voteKey(proposalId, facetId);
        if (!(key in state.votes)) return state;
        const next = { ...state.votes };
        delete next[key];
        return { votes: next };
      }),
    getVote: (proposalId, facetId) => get().votes[voteKey(proposalId, facetId)],
    reset: () => set({ votes: {} }),
  })),
);
