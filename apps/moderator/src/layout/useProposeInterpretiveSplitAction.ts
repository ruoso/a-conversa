// `useProposeInterpretiveSplitAction()` — the moderator's
// propose-interpretive-split React hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
//
// Thin wrapper over the shared
// `useProposeProposalAction({ mode: 'interpretive-split' })`. Preserved
// as a named symbol so the route mounts a per-mode hook (and future
// tests can import the per-mode name).

import {
  useProposeProposalAction,
  resetProposeInterpretiveSplitError,
  type ProposalValidationErrorReason,
  type UseProposeProposalActionResult,
} from './useProposeProposalAction';

export type InterpretiveSplitValidationErrorReason = ProposalValidationErrorReason;

export type UseProposeInterpretiveSplitActionResult = UseProposeProposalActionResult;

export function useProposeInterpretiveSplitAction(): UseProposeInterpretiveSplitActionResult {
  return useProposeProposalAction({ mode: 'interpretive-split' });
}

export { resetProposeInterpretiveSplitError };
