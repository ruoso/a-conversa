// `useSelectionStore` — currently-selected entity on the graph canvas.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md
//
// One selection at a time: either a node, an edge, an annotation, or
// nothing. The `kind` discriminator uses `EntityKind` from
// `@a-conversa/shared-types`, keeping the participant UI's notion of
// "selectable thing" aligned with the event-envelope vocabulary — and
// keeping it line-for-line aligned with the moderator's
// `apps/moderator/src/stores/selectionStore.ts` (same `EntityKind`
// import, same `{ kind, id } | null` shape, same `select`/`clear` API).

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
  withDevtools('participant/selection', (set) => ({
    selected: null,
    select: (selection) => set({ selected: selection }),
    clear: () => set({ selected: null }),
  })),
);
