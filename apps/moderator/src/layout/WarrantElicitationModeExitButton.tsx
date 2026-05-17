// `<WarrantElicitationModeExitButton>` — warrant-elicitation-mode exit
// affordance + target wording overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_warrant_elicitation_mode.md
// Sibling: apps/moderator/src/layout/DecomposeModeExitButton.tsx
//          apps/moderator/src/layout/InterpretiveSplitModeExitButton.tsx
//          apps/moderator/src/layout/OperationalizationModeExitButton.tsx
//
// Thin wrapper over `<ProposalModeExitAffordance mode="warrant-elicitation">`.
// Per-mode `data-testid`s (`warrant-elicitation-mode-exit*`) are produced
// by the shared body when `props.mode === 'warrant-elicitation'`.

import { type ReactElement } from 'react';

import { ProposalModeExitAffordance } from './ProposalModeExitAffordance';

export function WarrantElicitationModeExitButton(): ReactElement | null {
  return <ProposalModeExitAffordance mode="warrant-elicitation" />;
}
