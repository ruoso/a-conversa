// `<ProposalFacetBreakdown>` — small inline row of facet chips that
// renders inside each `<PendingProposalRow>`'s `<li>` body, beneath the
// existing one-line header. Each chip now also hosts an inline row of
// per-participant vote dots (when any participant has voted on the
// chip's facet) so the moderator scanning the pane sees both the
// per-facet status AND the per-voter distribution at a glance — the
// cross-surface counterpart to the graph card's `<FacetPill>` in-pill
// row.
//
// Refinement: tasks/refinements/moderator-ui/mod_vote_indicators_in_sidebar.md
// (prior:     tasks/refinements/moderator-ui/mod_per_facet_breakdown.md,
//             tasks/refinements/moderator-ui/mod_proposal_list.md,
//             tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md)
//
// The pane's purpose is "decide what to commit next" (Decision §2 of
// the refinement); a per-facet-status glance is the primary signal for
// that decision. The breakdown is always-shown and compact — one chip
// per facet, wrapping if the row narrows.
//
// **Visual vocabulary mirrors `<FacetPill>` verbatim** (Decision §3):
// the per-status Tailwind branches are re-used directly from
// `apps/moderator/src/graph/FacetPill.tsx`'s exported
// `PILL_STATUS_CLASSNAME` constant. A `disputed` chip on the sidebar
// renders the same as a `disputed` pill on the graph card — moderators
// learn one grammar.
//
// **Test seam** (refinement Acceptance criteria): the container carries
// `data-testid="proposal-facet-breakdown"` + `data-proposal-id="<id>"`;
// each chip carries `data-testid="proposal-facet-row"`,
// `data-facet-name="<facet|proposal>"`, and
// `data-facet-status="<status>"`. When any participant has voted on the
// chip's facet, the chip span hosts an inline row with
// `data-testid="proposal-facet-vote-indicator-row"`, mapped over the
// projected `Vote[]` to one `<VoteIndicator>` per voter. The inner
// `<VoteIndicator>` children carry the cross-surface
// `data-vote-indicator` sentinel so a selector targeting
// `[data-vote-indicator][data-participant-id="<uuid>"]` hits both the
// sidebar chip and the graph pill.

import { memo, useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { PILL_BASE_CLASSNAME, PILL_STATUS_CLASSNAME, VoteIndicator } from '@a-conversa/shell';

import type { FacetStatusIndex } from '../graph/facetStatus.js';
import type { PendingProposalRow } from '../graph/pendingProposals.js';
import { derivePerProposalFacets, type VotesByFacetIndex } from '../graph/proposalFacets.js';

export interface ProposalFacetBreakdownProps {
  /** The pending-proposal row this breakdown belongs to. */
  readonly row: PendingProposalRow;
  /**
   * Client-side `computeFacetStatuses(events)` output — the per-entity
   * per-facet status index. Used as the fallback when the server
   * `proposal-status` broadcast has not yet landed for this proposal
   * (or the proposal is structural and has no facet-targeting entry).
   */
  readonly facetStatusIndex: FacetStatusIndex;
  /**
   * Per-proposal server-broadcast `perFacetStatus` map (from
   * `useWsStore.sessionState[id].pendingProposals[proposalId]
   * .perFacetStatus`). `undefined` when no server frame has landed.
   * When present, takes precedence over the client mirror.
   */
  readonly serverPerFacetStatus: Record<string, string> | undefined;
  /**
   * Per-(entityId, facet) vote bucket — `projectVotesByFacet(events)`'s
   * return value, computed ONCE per pane render and threaded through
   * to every row's breakdown. Drives the in-chip
   * `<VoteIndicator>` row per Decision §1 of
   * `tasks/refinements/moderator-ui/mod_vote_indicators_in_sidebar.md`.
   *
   * Optional with an empty-map default so older render paths (and
   * test fixtures authored before the sidebar indicator task landed)
   * continue to compile / behave as before — every chip's
   * `votes` array collapses to `EMPTY_VOTES` and the indicator row
   * is omitted.
   */
  readonly votesByFacetIndex?: VotesByFacetIndex;
}

const EMPTY_VOTES_BY_FACET_INDEX: VotesByFacetIndex = new Map();

const BREAKDOWN_CONTAINER_CLASSES = 'flex flex-wrap items-center gap-1';

function ProposalFacetBreakdownImpl(props: ProposalFacetBreakdownProps): ReactElement {
  const {
    row,
    facetStatusIndex,
    serverPerFacetStatus,
    votesByFacetIndex = EMPTY_VOTES_BY_FACET_INDEX,
  } = props;
  const { t } = useTranslation();

  // Per Decision §8 of `mod_per_facet_breakdown` (and Decision §10 of
  // `mod_vote_indicators_in_sidebar`) — memoize the per-row derivation
  // so re-renders that don't change the underlying references skip
  // the work. The `serverPerFacetStatus` reference changes only when a
  // new `proposal-status` envelope lands for this proposal id; the
  // `votesByFacetIndex` reference changes whenever a new event (any
  // kind) lands in the session log.
  const entries = useMemo(
    () =>
      derivePerProposalFacets(
        row.proposal,
        facetStatusIndex,
        serverPerFacetStatus,
        votesByFacetIndex,
      ),
    [row.proposal, facetStatusIndex, serverPerFacetStatus, votesByFacetIndex],
  );

  return (
    <div
      data-testid="proposal-facet-breakdown"
      data-proposal-id={row.proposalEventId}
      className={BREAKDOWN_CONTAINER_CLASSES}
    >
      {entries.map((entry) => {
        const className = `${PILL_BASE_CLASSNAME} ${PILL_STATUS_CLASSNAME[entry.status]}`;
        // Per `mod_vote_indicators_in_sidebar` Decision §2, the
        // indicator row mirrors `<FacetPill>`'s in-pill row 1:1:
        // `ml-1 inline-flex items-center gap-0.5` spacing, one
        // `<VoteIndicator>` per `Vote`, empty-row omission when
        // `votes.length === 0`. The sidebar uses a `data-testid`
        // distinct from the graph's `data-vote-indicator-row`
        // attribute so test selectors can target one surface at a
        // time; the inner `<VoteIndicator>` children both carry the
        // cross-surface `data-vote-indicator` sentinel.
        const voteIndicatorRow =
          entry.votes.length > 0 ? (
            <span
              data-testid="proposal-facet-vote-indicator-row"
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
            key={entry.facet}
            data-testid="proposal-facet-row"
            data-facet-name={entry.facet}
            data-facet-status={entry.status}
            className={className}
          >
            {t(entry.labelKey)}
            {voteIndicatorRow}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Memo'd breakdown — the pane re-renders on each event-applied frame,
 * but each row's breakdown only changes when its proposal payload, the
 * facetStatusIndex reference, or the row's server-broadcast
 * perFacetStatus reference changes. Decision §8.
 */
export const ProposalFacetBreakdown = memo(ProposalFacetBreakdownImpl);
