// `<InterpretiveSplitReadingsGrid>` — thin wrapper for the
// interpretive-split flow's multi-reading capture grid.
//
// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
// Sibling: apps/moderator/src/layout/DecomposeComponentsGrid.tsx
//
// Wraps `<DecomposeComponentsGrid mode="interpretive-split">` so the
// route mounts a named component (matching the decompose-side naming
// convention) and future test imports have a per-mode name to assert
// against.

import { type ReactElement } from 'react';

import { DecomposeComponentsGrid } from './DecomposeComponentsGrid';

export function InterpretiveSplitReadingsGrid(): ReactElement | null {
  return <DecomposeComponentsGrid mode="interpretive-split" />;
}
