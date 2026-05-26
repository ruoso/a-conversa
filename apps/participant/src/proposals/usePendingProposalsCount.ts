// `usePendingProposalsCount` — selector hook returning the count of
// pending proposals for a session.
//
// Refinement: tasks/refinements/participant-ui/part_proposals_tab.md
//   (Decision §3 — the seam ships the *total* pending-proposal count;
//    the per-participant "needs your vote" filter is deferred to
//    `part_vote_indicators_in_pane`, which replaces this hook's body
//    in place. The return type (`number`) and the call-site contract
//    stay stable across that future swap.)

import { useWsStore } from '../ws/wsStore';

export function usePendingProposalsCount(sessionId: string): number {
  return useWsStore((s) => {
    const map = s.sessionState[sessionId]?.pendingProposals;
    return map === undefined ? 0 : Object.keys(map).length;
  });
}
