// `mark-meta-disagreement` action handler — placeholder.
//
// Refinement: tasks/refinements/data-and-methodology/agreement_state_machine.md
// (placeholder lives here, factored out as a per-action module by
// `commit_logic`; the sibling `meta_disagreement_logic` task will
// replace it with the real validator that enforces moderator role,
// pending-proposal lookup, the `methodology-not-exhausted` precondition,
// and the no-double-mark defensive check).
//
// The placeholder passes universal checks (already run by
// `validateAction`) and emits one `EventToAppend` of kind
// `meta-disagreement-marked` constructed from the action envelope. No
// methodology-specific gating.

import type { Projection } from '../../projection/index.js';
import type {
  EventToAppendEnvelope,
  MarkMetaDisagreementAction,
  ValidationResult,
  Validator,
} from '../types.js';

export const placeholderMarkMetaDisagreementHandler: Validator<MarkMetaDisagreementAction> = (
  _projection: Projection,
  action: MarkMetaDisagreementAction,
): ValidationResult => {
  const event: EventToAppendEnvelope<'meta-disagreement-marked'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence,
    kind: 'meta-disagreement-marked',
    actor: action.actor,
    payload: {
      proposal_id: action.proposalEventId,
      moderator: action.requester,
      marked_at: action.markedAt,
    },
    createdAt: action.createdAt,
  };
  return { ok: true, events: [event] };
};

export default placeholderMarkMetaDisagreementHandler;
