// Barrel re-export of the participant pending-proposals surface.
//
// Refinement: tasks/refinements/participant-ui/part_proposal_list_view.md
//   (prior:    tasks/refinements/participant-ui/part_proposals_tab.md —
//    Decision §5 established the participant-local location; this leaf
//    adds the row-rendering selector + summary exports.)

export { ParticipantTopTabBar, type ParticipantTopTabBarProps } from './ParticipantTopTabBar';
export { PendingProposalsPane, type PendingProposalsPaneProps } from './PendingProposalsPane';
export { MyAgreementsPane, type MyAgreementsPaneProps } from './MyAgreementsPane';
export {
  derivePersonalAgreements,
  EMPTY_PERSONAL_AGREEMENTS,
  type PersonalAgreementRow,
} from './derivePersonalAgreements';
export { usePendingProposalsCount } from './usePendingProposalsCount';
export { derivePendingProposals, type PendingProposalRow } from './derivePendingProposals';
export {
  useWithdrawProposalAction,
  useWithdrawProposalStore,
  resetWithdrawProposalStore,
  type UseWithdrawProposalActionResult,
  type WireError,
} from './useWithdrawProposalAction';
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
  projectOtherVotesByProposal,
  EMPTY_OTHER_VOTES_BY_PROPOSAL_INDEX,
  type OtherVotesByProposalIndex,
} from './otherVotesByProposal';
export { proposalTargetEntity, type ProposalTargetEntity } from './proposalTargetEntity';
export {
  useNewProposalArrival,
  FLASH_WINDOW_MS,
  EMPTY_FLASH_MAP,
  type NewProposalArrivalState,
  type ProposalFlashEntry,
} from './useNewProposalArrival';
