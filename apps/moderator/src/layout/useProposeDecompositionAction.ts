// `useProposeDecompositionAction()` — the moderator's
// propose-decomposition React hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_propose_decomposition.md
// Extracted to a parameterised body by
//             tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
//             (Decision §2 — extract-and-share with the shared
//              `useProposeProposalAction({ mode: 'decompose' })`).
//
// Thin wrapper preserving the public API of the predecessor for
// source-stable consumers. The shared body lives in
// `useProposeProposalAction.ts`; this file:
//
//   - re-exports the wrapper hook name (`useProposeDecompositionAction`)
//     that calls the shared body with `mode: 'decompose'`;
//   - re-exports `resetProposeDecompositionError` (the test seam),
//     `DecomposeValidationErrorReason` (alias of the shared union with
//     the legacy `'components-invalid'` reason spelling), and the
//     `UseProposeDecompositionActionResult` interface.

import {
  useProposeProposalAction,
  resetProposeDecompositionError,
  type ProposalValidationErrorReason,
  type UseProposeProposalActionResult,
} from './useProposeProposalAction';

/**
 * Preserved per-mode reason union for source-stable consumers. The
 * fourth reason on the wire is `'rows-invalid'` (mode-neutral); this
 * alias maps the decompose-side spelling `'components-invalid'` so
 * existing call sites keep matching.
 *
 * The runtime value in `validationError` from the wrapper hook is
 * mapped from the shared `'rows-invalid'` reason to the legacy
 * spelling so existing consumer-side switch / equality checks stay
 * green.
 */
export type DecomposeValidationErrorReason =
  | 'session-missing'
  | 'not-connected'
  | 'target-missing'
  | 'components-invalid';

export interface UseProposeDecompositionActionResult {
  propose: () => Promise<void>;
  canPropose: boolean;
  validationError: DecomposeValidationErrorReason | null;
  inFlight: boolean;
  lastError: UseProposeProposalActionResult['lastError'];
}

function toLegacyReason(
  reason: ProposalValidationErrorReason | null,
): DecomposeValidationErrorReason | null {
  if (reason === null) return null;
  if (reason === 'rows-invalid') return 'components-invalid';
  return reason;
}

export function useProposeDecompositionAction(): UseProposeDecompositionActionResult {
  const shared = useProposeProposalAction({ mode: 'decompose' });
  return {
    propose: shared.propose,
    canPropose: shared.canPropose,
    validationError: toLegacyReason(shared.validationError),
    inFlight: shared.inFlight,
    lastError: shared.lastError,
  };
}

export { resetProposeDecompositionError };
