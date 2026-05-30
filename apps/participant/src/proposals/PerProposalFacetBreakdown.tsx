// `<PerProposalFacetBreakdown>` — small inline row of facet chips that
// renders inside each `<PendingProposalRow>`'s expanded body region on
// the participant's proposals tab.
//
// Refinement: tasks/refinements/participant-ui/part_per_facet_breakdown_in_pane.md
//
// Port of `apps/moderator/src/layout/ProposalFacetBreakdown.tsx` minus
// the in-chip `<VoteIndicator>` row (per-participant vote indicators
// are out of scope here; sibling `part_vote_indicators_in_pane` will
// thread them in). Testids are participant-namespaced for unambiguous
// Playwright addressing across both apps' specs:
//   - container: `participant-pending-proposal-row-facets`
//   - chip:      `participant-pending-proposal-row-facet`
//
// **Visual vocabulary mirrors `<FacetPill>` verbatim**: the chip
// className is `${PILL_BASE_CLASSNAME} ${PILL_STATUS_CLASSNAME[status]}`
// from `@a-conversa/shell`, so a `disputed` chip on the participant's
// pane renders the same as a `disputed` pill on the graph card and the
// same as the moderator sidebar's chip. A state-styling refinement that
// touches those constants propagates here automatically; the drift-
// guard test asserts the per-status className map equals the shell
// exports verbatim.

import { memo, useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProposalPayload } from '@a-conversa/shared-types';
import {
  EMPTY_VOTES_BY_FACET_INDEX,
  PILL_BASE_CLASSNAME,
  PILL_STATUS_CLASSNAME,
  VoteIndicator,
  type FacetStatusIndex,
  type VotesByFacetIndex,
} from '@a-conversa/shell';

import { EMPTY_OWN_FACET_VOTES, type OwnFacetVoteIndex } from '../graph/ownVotes';
import { derivePerProposalFacets } from './perProposalFacets';
import {
  EMPTY_OTHER_VOTES_BY_PROPOSAL_INDEX,
  type OtherVotesByProposalIndex,
} from './otherVotesByProposal';
import { ProposalFacetVoteButtons } from './ProposalFacetVoteButtons';

export interface PerProposalFacetBreakdownProps {
  readonly proposal: ProposalPayload;
  readonly facetStatusIndex: FacetStatusIndex;
  readonly proposalEventId: string;
  readonly votesByFacetIndex?: VotesByFacetIndex;
  readonly votesByProposalIndex?: OtherVotesByProposalIndex;
  readonly ownFacetVotes?: OwnFacetVoteIndex;
}

const BREAKDOWN_CONTAINER_CLASSES = 'flex flex-row flex-wrap items-center gap-1';

function PerProposalFacetBreakdownImpl(props: PerProposalFacetBreakdownProps): ReactElement {
  const {
    proposal,
    facetStatusIndex,
    proposalEventId,
    votesByFacetIndex,
    votesByProposalIndex,
    ownFacetVotes,
  } = props;
  const { t } = useTranslation();
  const ownFacetVotesResolved = ownFacetVotes ?? EMPTY_OWN_FACET_VOTES;

  const entries = useMemo(
    () =>
      derivePerProposalFacets(
        proposal,
        facetStatusIndex,
        votesByFacetIndex ?? EMPTY_VOTES_BY_FACET_INDEX,
        proposalEventId,
        votesByProposalIndex ?? EMPTY_OTHER_VOTES_BY_PROPOSAL_INDEX,
      ),
    [proposal, facetStatusIndex, votesByFacetIndex, proposalEventId, votesByProposalIndex],
  );

  return (
    <div
      data-testid="participant-pending-proposal-row-facets"
      data-proposal-id={proposalEventId}
      className={BREAKDOWN_CONTAINER_CLASSES}
    >
      {entries.map((entry, entryIndex) => {
        const className = `${PILL_BASE_CLASSNAME} ${PILL_STATUS_CLASSNAME[entry.status]}`;
        const facetLabel = t(entry.labelKey);
        const statusLabel = t(`methodology.facetState.${entry.status}`);
        const voteIndicatorRow =
          entry.votes.length > 0 ? (
            <span
              data-testid="participant-pending-proposal-row-facet-vote-indicator-row"
              className="ml-1 inline-flex items-center gap-0.5"
            >
              {entry.votes.map((vote) => (
                <VoteIndicator
                  key={vote.participantId}
                  participantId={vote.participantId}
                  choice={vote.choice}
                />
              ))}
            </span>
          ) : null;
        return (
          <span
            key={`${entry.facet}-${entryIndex}`}
            data-testid="participant-pending-proposal-row-facet"
            data-facet-name={entry.facet}
            data-facet-status={entry.status}
            className={className}
            aria-label={`${facetLabel} ${statusLabel}`}
          >
            {facetLabel}
            {voteIndicatorRow}
            <ProposalFacetVoteButtons
              voteTarget={entry.voteTarget}
              status={entry.status}
              ownFacetVotes={ownFacetVotesResolved}
            />
          </span>
        );
      })}
    </div>
  );
}

export const PerProposalFacetBreakdown = memo(PerProposalFacetBreakdownImpl);
