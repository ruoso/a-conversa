// `vote` action handler — placeholder.
//
// Refinement: tasks/refinements/data-and-methodology/agreement_state_machine.md
// (placeholder lives here, factored out as a per-action module by
// `commit_logic`; the sibling `vote_logic` task will replace it with
// the real validator that enforces "the requester is the participant
// being recorded as voter", "the proposal is referenced by id in
// `pendingProposals` or `committedProposals`", and the no-double-agree
// / no-prior-agree-for-withdraw rules).
//
// The placeholder passes universal checks (already run by
// `validateAction`) and emits one `EventToAppend` of kind `vote`
// constructed from the action envelope. No methodology-specific
// gating.

import type { Projection } from '../../projection/index.js';
import type { EventToAppendEnvelope, ValidationResult, Validator, VoteAction } from '../types.js';

export const placeholderVoteHandler: Validator<VoteAction> = (
  _projection: Projection,
  action: VoteAction,
): ValidationResult => {
  const event: EventToAppendEnvelope<'vote'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence,
    kind: 'vote',
    actor: action.actor,
    payload: {
      proposal_id: action.proposalEventId,
      participant: action.requester,
      vote: action.vote,
      voted_at: action.votedAt,
    },
    createdAt: action.createdAt,
  };
  return { ok: true, events: [event] };
};

export default placeholderVoteHandler;
