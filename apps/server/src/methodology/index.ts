// Barrel for `apps/server/src/methodology`.
//
// Refinement: tasks/refinements/data-and-methodology/agreement_state_machine.md

export type {
  ActionEnvelopeBase,
  ActionHandlerFor,
  ActionKind,
  CommitAction,
  CommitActionFacet,
  CommitActionProposal,
  EventToAppend,
  EventToAppendEnvelope,
  MarkMetaDisagreementAction,
  MethodologyAction,
  ProposeAction,
  RejectedValidationResult,
  RejectionReason,
  RequireFailure,
  RequireParticipantResult,
  RequireResult,
  RequireSuccess,
  ValidValidationResult,
  ValidationResult,
  Validator,
  VoteAction,
  VoteActionFacet,
  VoteActionProposal,
} from './types.js';

export {
  currentParticipants,
  edgeIsVisible,
  findConflictingBreakEdgeProposal,
  findConflictingProposalAgainst,
  findParticipantVoteOnProposal,
  findProposal,
  hasAxiomMark,
  nextSequence,
  nodeIsPartyToAgreedContradicts,
  nodeIsVisible,
  proposalHasAnyDispute,
  proposalSubKind,
  proposalTargetsFacet,
  requesterIsModerator,
  requesterIsParticipant,
  requireModerator,
  requireParticipant,
  type ConflictingParentKind,
  type FoundProposal,
} from './primitives.js';

export {
  getActionHandler,
  registerActionHandler,
  resetActionHandlers,
  validateAction,
} from './engine.js';

// Standalone (non-`validateAction`-registered) helpers.
//
// `createSnapshot` is consumed directly by `ws_label_snapshot_message`
// rather than through the action-dispatch registry; snapshots are not
// facets and have no participant gate at this layer. See
// `tasks/refinements/data-and-methodology/snapshot_create_logic.md`
// Decisions §1.
export { createSnapshot, type CreateSnapshotInput } from './handlers/createSnapshot.js';
