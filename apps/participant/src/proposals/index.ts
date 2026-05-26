// Barrel re-export of the participant pending-proposals surface.
//
// Refinement: tasks/refinements/participant-ui/part_proposals_tab.md
//   (Decision §5 — components live participant-local under
//   `apps/participant/src/proposals/`; sibling leaves add their
//   exports here as they land.)

export { PendingProposalsTabBar, type PendingProposalsTabBarProps } from './PendingProposalsTabBar';
export { PendingProposalsPane, type PendingProposalsPaneProps } from './PendingProposalsPane';
export { usePendingProposalsCount } from './usePendingProposalsCount';
