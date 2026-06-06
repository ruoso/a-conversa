// `useProposalCommitChord` — the React-bound bridge that wires the
// `Cmd/Ctrl+Shift+Enter` commit chord to the currently-selected pending
// proposal.
//
// Refinement:
//   tasks/refinements/moderator-ui/mod_proposal_selection_commit_chord.md
//
// Mounted ONCE under `<OperateRouteInner>` — inside `<WsClientProvider>`
// — alongside `useGlobalKeymap()`. It captures the two things that
// genuinely need React: the context-only `WsClient` (`useWsClient()`
// throws outside its provider — `WsClientProvider.tsx`) and the route
// `sessionId`. It then registers ONE stable imperative callback into the
// module-scoped `useCommitChordStore`; the document-level dispatcher
// invokes that callback via `getState().run?.()` on the chord, so the
// dispatcher itself stays context-free (Decision §2).
//
// Everything else the callback needs — the selected id, the events, the
// facet/vote indices, `expectedSequence` — is `getState()`-reachable, so
// the callback registers once (capturing the stable client + sessionId)
// and reads all volatile state FRESH at invocation. No stale closure:
// the chord can never fire against a target that has since left the
// pending list.
//
// The gate + dispatch are the row button's, not a second copy: the
// callback computes `deriveAllAgree(...)` over the same merged
// `deriveFacetStatusIndex(...)` the pane feeds its rows, shapes the
// envelope with the shared `commitTargetForProposal(...)`, and dispatches
// through the shared `sendCommit(...)` core — so the chord is the exact
// keyboard alias of clicking the selected row's commit button
// (Decision §3).

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import { projectVotesByFacet, useWsClient } from '@a-conversa/shell';

import { useWsStore } from '../ws/wsStore';
import { derivePendingProposals } from '../graph/pendingProposals';
import { deriveFacetStatusIndex } from '../graph/facetStatusIndex';
import { projectVotesByProposal } from '../graph/selectors';
import {
  deriveAllAgree,
  deriveCurrentParticipants,
  derivePerProposalFacets,
} from '../graph/proposalFacets';
import { useSelectedProposalStore } from '../stores/selectedProposalStore';
import { useCommitChordStore } from './useCommitChordStore';
import { commitTargetForProposal } from './PendingProposalsPane';
import { sendCommit } from './useCommitAction';

/**
 * Mount the commit-chord bridge. Registers the imperative
 * commit-the-selected-proposal callback for the lifetime of the operate
 * route and clears it on unmount (so the dispatcher's
 * `getState().run?.()` is a safe no-op once the route is gone).
 */
export function useProposalCommitChord(): void {
  const client = useWsClient();
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';
  // Pre-resolve the timeout wire-error fallback at register time and let
  // `sendCommit` stay React-free. The locale rarely changes mid-session;
  // re-registering when it does keeps the message current.
  const { t } = useTranslation();
  const timeoutText = t('moderator.commitButton.timeoutError');

  useEffect(() => {
    const run = (): void => {
      const selectedId = useSelectedProposalStore.getState().selectedProposalId;
      if (selectedId === null) return;

      // Read all volatile inputs fresh — never a stale closure.
      const session = useWsStore.getState().sessionState[sessionId];
      const events = session?.events ?? [];

      const row = derivePendingProposals(events).find((r) => r.proposalEventId === selectedId);
      if (row === undefined) {
        // Stale selection — the proposal committed / withdrew / was
        // superseded out of the pending list. Clear it so the chord
        // never fires against a gone target, and do not send.
        useSelectedProposalStore.getState().clear();
        return;
      }

      // Outer connection-status gate — mirrors the row component's
      // pre-`deriveAllAgree` check (`PendingProposalsPane` Decision §1.b).
      const connectionOpen = useWsStore.getState().connectionStatus === 'open';
      if (!connectionOpen) return;

      // Recompute the SAME gate the row button shows, over the SAME
      // merged facet-status index + vote indices the pane feeds its rows.
      const facetStatusIndex = deriveFacetStatusIndex(events, session?.pendingProposalFacetStatus);
      const votesByFacetIndex = projectVotesByFacet(events);
      const votesByProposalIndex = projectVotesByProposal(events);
      const currentParticipantIds = deriveCurrentParticipants(events);
      const entries = derivePerProposalFacets(
        row.proposal,
        facetStatusIndex,
        votesByFacetIndex,
        row.proposalEventId,
        votesByProposalIndex,
      );
      const gate = deriveAllAgree(entries, currentParticipantIds, row.proposal);
      if (!gate.ok) return;

      // Gate open — dispatch the IDENTICAL envelope the selected row's
      // commit button would, through the shared in-flight-keyed core.
      const target = commitTargetForProposal(row.proposal, row.proposalEventId);
      void sendCommit(client, sessionId, target, timeoutText);
    };

    useCommitChordStore.getState().setRun(run);
    return () => {
      useCommitChordStore.getState().setRun(null);
    };
  }, [client, sessionId, timeoutText]);
}
