// `<CaptureDefeaterModeExitButton>` — capture-defeater-mode exit
// affordance + target wording overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_capture_defeater_mode.md
// Sibling: apps/moderator/src/layout/DecomposeModeExitButton.tsx
//          apps/moderator/src/layout/InterpretiveSplitModeExitButton.tsx
//          apps/moderator/src/layout/OperationalizationModeExitButton.tsx
//          apps/moderator/src/layout/WarrantElicitationModeExitButton.tsx
//
// Thin wrapper over `<ProposalModeExitAffordance mode="capture-defeater">`.
// Per-mode `data-testid`s (`capture-defeater-mode-exit*`) are produced
// by the shared body when `props.mode === 'capture-defeater'`.

import { type ReactElement } from 'react';

import { ProposalModeExitAffordance } from './ProposalModeExitAffordance';

export function CaptureDefeaterModeExitButton(): ReactElement | null {
  return <ProposalModeExitAffordance mode="capture-defeater" />;
}
