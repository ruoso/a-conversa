// `<InterpretiveSplitModeExitButton>` — interpretive-split-mode exit
// affordance + target wording overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
// Sibling: apps/moderator/src/layout/DecomposeModeExitButton.tsx
//
// Thin wrapper over `<ProposalModeExitAffordance mode="interpretive-
// split">`. Per-mode `data-testid`s
// (`interpretive-split-mode-exit*`) are produced by the shared body
// when `props.mode === 'interpretive-split'`.

import { type ReactElement } from 'react';

import { ProposalModeExitAffordance } from './ProposalModeExitAffordance';

export function InterpretiveSplitModeExitButton(): ReactElement | null {
  return <ProposalModeExitAffordance mode="interpretive-split" />;
}
