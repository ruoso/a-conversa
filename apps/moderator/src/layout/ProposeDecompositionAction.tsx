// `<ProposeDecompositionAction>` — the moderator's "Propose
// decomposition" button + inline error region.
//
// Refinement: tasks/refinements/moderator-ui/mod_propose_decomposition.md
// Extracted to a parameterised body by
//             tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
//             (Decision §2 — extract-and-share with per-mode thin wrappers).
//
// Thin wrapper over `<ProposalAction mode="decompose">`. The shared
// body owns the per-mode i18n key / `data-testid` resolution + the
// hook invocation; this file preserves the public component name.

import { type ReactElement } from 'react';

import { ProposalAction } from './ProposalAction';

export function ProposeDecompositionAction(): ReactElement {
  return <ProposalAction mode="decompose" />;
}
