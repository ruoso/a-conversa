// `<DecomposeModeExitButton>` — decompose-mode exit affordance + target
// wording overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_decompose_mode.md
// Extracted to a parameterised body by
//             tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
//             (Decision §2 — extract-and-share with per-mode thin wrappers).
//
// Thin wrapper over `<ProposalModeExitAffordance mode="decompose">`.
// The existing public symbols are preserved:
//   - the `DecomposeModeExitButton` component (renders the shared
//     affordance with `mode="decompose"`);
//   - the `resolveDecomposeTargetWording` named export — preserved as
//     an alias of the shared `resolveProposalTargetWording`.
//
// Per-mode `data-testid`s (`decompose-mode-exit*`) are produced by the
// shared body when `props.mode === 'decompose'`.

import { type ReactElement } from 'react';

import {
  ProposalModeExitAffordance,
  resolveProposalTargetWording,
} from './ProposalModeExitAffordance';

export function DecomposeModeExitButton(): ReactElement | null {
  return <ProposalModeExitAffordance mode="decompose" />;
}

/**
 * Preserved source-stable alias for `resolveProposalTargetWording`.
 * The events-log walker is mode-neutral; the original name shipped
 * with mod_decompose_mode is kept as an alias.
 */
export const resolveDecomposeTargetWording = resolveProposalTargetWording;
