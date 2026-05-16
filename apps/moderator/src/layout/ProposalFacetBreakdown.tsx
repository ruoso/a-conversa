// `<ProposalFacetBreakdown>` — small inline row of facet chips that
// renders inside each `<PendingProposalRow>`'s `<li>` body, beneath the
// existing one-line header.
//
// Refinement: tasks/refinements/moderator-ui/mod_per_facet_breakdown.md
// (prior:     tasks/refinements/moderator-ui/mod_proposal_list.md,
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
// `data-facet-status="<status>"`. The sibling
// `mod_vote_indicators_in_sidebar` task will mount per-participant
// dots INSIDE each chip via the `data-facet-name`/`data-facet-status`
// pair.

import { memo, useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { PILL_BASE_CLASSNAME, PILL_STATUS_CLASSNAME } from '../graph/FacetPill.js';
import type { FacetStatusIndex } from '../graph/facetStatus.js';
import type { PendingProposalRow } from '../graph/pendingProposals.js';
import { derivePerProposalFacets } from '../graph/proposalFacets.js';

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
}

const BREAKDOWN_CONTAINER_CLASSES = 'flex flex-wrap items-center gap-1';

function ProposalFacetBreakdownImpl(props: ProposalFacetBreakdownProps): ReactElement {
  const { row, facetStatusIndex, serverPerFacetStatus } = props;
  const { t } = useTranslation();

  // Per Decision §8 — memoize the per-row derivation so re-renders that
  // don't change the underlying references skip the work. The
  // serverPerFacetStatus reference changes only when a new
  // `proposal-status` envelope lands for this proposal id.
  const entries = useMemo(
    () => derivePerProposalFacets(row.proposal, facetStatusIndex, serverPerFacetStatus),
    [row.proposal, facetStatusIndex, serverPerFacetStatus],
  );

  return (
    <div
      data-testid="proposal-facet-breakdown"
      data-proposal-id={row.proposalEventId}
      className={BREAKDOWN_CONTAINER_CLASSES}
    >
      {entries.map((entry) => {
        const className = `${PILL_BASE_CLASSNAME} ${PILL_STATUS_CLASSNAME[entry.status]}`;
        return (
          <span
            key={entry.facet}
            data-testid="proposal-facet-row"
            data-facet-name={entry.facet}
            data-facet-status={entry.status}
            className={className}
          >
            {t(entry.labelKey)}
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
