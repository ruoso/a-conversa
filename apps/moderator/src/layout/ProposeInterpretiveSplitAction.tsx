// `<ProposeInterpretiveSplitAction>` — the moderator's "Propose
// interpretive split" button + inline error region.
//
// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
// Sibling: apps/moderator/src/layout/ProposeDecompositionAction.tsx
//
// Thin wrapper over `<ProposalAction mode="interpretive-split">`. The
// shared body owns the per-mode i18n key / `data-testid` resolution +
// the hook invocation.

import { type ReactElement } from 'react';

import { ProposalAction } from './ProposalAction';

export function ProposeInterpretiveSplitAction(): ReactElement {
  return <ProposalAction mode="interpretive-split" />;
}
