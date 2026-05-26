// Barrel re-export of the participant pending-proposals surface.
//
// Refinement: tasks/refinements/participant-ui/part_proposal_list_view.md
//   (prior:    tasks/refinements/participant-ui/part_proposals_tab.md —
//    Decision §5 established the participant-local location; this leaf
//    adds the row-rendering selector + summary exports.)

export { PendingProposalsTabBar, type PendingProposalsTabBarProps } from './PendingProposalsTabBar';
export { PendingProposalsPane, type PendingProposalsPaneProps } from './PendingProposalsPane';
export { usePendingProposalsCount } from './usePendingProposalsCount';
export { derivePendingProposals, type PendingProposalRow } from './derivePendingProposals';
export { summaryText } from './proposalSummary';
