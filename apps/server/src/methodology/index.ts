// Barrel for `apps/server/src/methodology`.
//
// Refinement: tasks/refinements/data-and-methodology/agreement_state_machine.md

export type {
  ActionEnvelopeBase,
  ActionHandlerFor,
  ActionKind,
  CommitAction,
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
} from './types.js';

export {
  currentParticipants,
  edgeIsVisible,
  findConflictingProposalAgainst,
  findParticipantVoteOnProposal,
  findProposal,
  hasAxiomMark,
  nextSequence,
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
