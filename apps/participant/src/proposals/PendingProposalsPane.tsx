// `<PendingProposalsPane>` — empty-shell pane for the participant
// pending-proposals tab.
//
// Refinement: tasks/refinements/participant-ui/part_proposals_tab.md
//   (Decision §5 — participant-local seam; sibling leaves
//   `part_proposal_list_view`, `part_proposal_expand`,
//   `part_per_facet_breakdown_in_pane`, `part_vote_indicators_in_pane`
//   plug list content into the stable container testid + ARIA
//   contract this leaf establishes.)
//
// The non-empty branch renders an empty `<ul>` rather than nothing so
// the testid `participant-pending-proposals-pane-list` is stable for
// the list-view leaf to assert against without re-deciding the
// container shape.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useWsStore } from '../ws/wsStore';

export interface PendingProposalsPaneProps {
  sessionId: string;
}

export function PendingProposalsPane({ sessionId }: PendingProposalsPaneProps): ReactElement {
  const { t } = useTranslation();
  const pendingProposals = useWsStore((s) => s.sessionState[sessionId]?.pendingProposals);
  const isEmpty = pendingProposals === undefined || Object.keys(pendingProposals).length === 0;
  return (
    <section
      data-testid="participant-pending-proposals-pane"
      role="tabpanel"
      aria-live="polite"
      className="flex h-full w-full flex-col overflow-auto bg-white"
    >
      {isEmpty ? (
        <div
          data-testid="participant-pending-proposals-pane-empty"
          className="flex h-full w-full items-center justify-center p-6 text-sm text-slate-500"
        >
          {t('participant.pendingProposalsPane.emptyState')}
        </div>
      ) : (
        <ul
          data-testid="participant-pending-proposals-pane-list"
          aria-label={t('participant.pendingProposalsPane.emptyState')}
          className="flex flex-col"
        />
      )}
    </section>
  );
}
