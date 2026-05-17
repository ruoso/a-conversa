// `<OperationalizationModeExitButton>` — operationalization-mode exit
// affordance + target wording overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_operationalization_mode.md
// Sibling: apps/moderator/src/layout/DecomposeModeExitButton.tsx
//          apps/moderator/src/layout/InterpretiveSplitModeExitButton.tsx
//
// Thin wrapper over `<ProposalModeExitAffordance mode="operationalization">`.
// Per-mode `data-testid`s (`operationalization-mode-exit*`) are produced
// by the shared body when `props.mode === 'operationalization'`.

import { type ReactElement } from 'react';

import { ProposalModeExitAffordance } from './ProposalModeExitAffordance';

export function OperationalizationModeExitButton(): ReactElement | null {
  return <ProposalModeExitAffordance mode="operationalization" />;
}
