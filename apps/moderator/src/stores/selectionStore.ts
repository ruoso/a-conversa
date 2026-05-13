// `useSelectionStore` — currently-selected entity on the graph canvas.
//
// Refinement: tasks/refinements/moderator-ui/mod_state_management.md
//
// One selection at a time: either a node, an edge, an annotation, or
// nothing. The `kind` discriminator uses `EntityKind` from
// `@a-conversa/shared-types`, keeping the moderator UI's notion of
// "selectable thing" aligned with the event-envelope vocabulary.

import { create } from 'zustand';
import type { EntityKind } from '@a-conversa/shared-types';

import { withDevtools } from './devtools.js';

export interface Selection {
  kind: EntityKind;
  id: string;
}

export interface SelectionState {
  /** Currently-selected entity, or `null` when nothing is selected. */
  selected: Selection | null;
  select: (selection: Selection) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>()(
  withDevtools('moderator/selection', (set) => ({
    selected: null,
    select: (selection) => set({ selected: selection }),
    clear: () => set({ selected: null }),
  })),
);
