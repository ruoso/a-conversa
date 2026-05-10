// `propose` action handler — placeholder.
//
// Refinement: tasks/refinements/data-and-methodology/agreement_state_machine.md
// (placeholder lives here, factored out as a per-action module by
// `commit_logic`; the sibling `vote_logic` / proposal-validation work
// will replace it with the real validator).
//
// The placeholder passes universal checks (already run by
// `validateAction`) and emits one `EventToAppend` of kind `proposal`
// constructed from the action payload. No methodology-specific gating.

import type { Projection } from '../../projection/index.js';
import type {
  EventToAppendEnvelope,
  ProposeAction,
  ValidationResult,
  Validator,
} from '../types.js';

export const placeholderProposeHandler: Validator<ProposeAction> = (
  _projection: Projection,
  action: ProposeAction,
): ValidationResult => {
  const event: EventToAppendEnvelope<'proposal'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence,
    kind: 'proposal',
    actor: action.actor,
    payload: { proposal: action.proposal },
    createdAt: action.createdAt,
  };
  return { ok: true, events: [event] };
};

export default placeholderProposeHandler;
