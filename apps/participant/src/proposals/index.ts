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
export {
  PerProposalFacetBreakdown,
  type PerProposalFacetBreakdownProps,
} from './PerProposalFacetBreakdown';
export {
  derivePerProposalFacets,
  type LifecycleFacetName,
  type ProposalFacetEntry,
  type VoteTarget,
} from './perProposalFacets';
export {
  ProposalFacetVoteButtons,
  type ProposalFacetVoteButtonsProps,
} from './ProposalFacetVoteButtons';
export {
  projectOtherVotesByFacet,
  EMPTY_OTHER_VOTES_BY_FACET_INDEX,
  type OtherVotesByFacetIndex,
} from './otherVotesByFacet';
export {
  projectOtherVotesByProposal,
  EMPTY_OTHER_VOTES_BY_PROPOSAL_INDEX,
  type OtherVotesByProposalIndex,
} from './otherVotesByProposal';
