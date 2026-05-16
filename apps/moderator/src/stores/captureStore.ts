// `useCaptureStore` — local UI state for the bottom-strip capture pane.
//
// Refinement: tasks/refinements/moderator-ui/mod_state_management.md
// (also:      tasks/refinements/moderator-ui/mod_edge_role_selector.md)
//
// Holds the in-progress proposal the moderator is composing: the
// statement text, its classification (StatementKind from
// `@a-conversa/shared-types`), the target node it will hang off (if
// any), the edge role connecting the new statement to that target (if
// any), and the current capture mode banner. None of this is server
// state — it is reset locally as soon as the moderator clicks
// "Propose" (the actual server round-trip is owned by
// `mod_capture_flow.mod_propose_action`).
//
// Downstream consumers (`mod_capture_flow`, `mod_classification_palette`,
// `mod_target_auto_suggest`, `mod_edge_role_selector`, `mod_mode_banner`)
// read from this store and call the setters. The store is intentionally
// lightweight: it holds form-shaped state, not business rules —
// methodology validation lives in the engine and lands via events.

import { create } from 'zustand';
import type { EdgeRole, StatementKind } from '@a-conversa/shared-types';

import { withDevtools } from './devtools.js';

/**
 * Modes the bottom-strip capture pane can be in. Each mode changes the
 * mode-banner copy and the set of follow-up actions surfaced to the
 * moderator. The canonical list comes from `docs/moderator-ui.md`
 * (F1–F8 capture flows) and the per-flow refinements under
 * `tasks/refinements/moderator-ui/`.
 */
export type CaptureMode =
  | 'idle'
  | 'capture-statement'
  | 'decompose'
  | 'capture-defeater'
  | 'operationalization'
  | 'warrant-elicitation'
  | 'meta-move'
  | 'axiom-mark';

export interface CaptureState {
  /** The free-text statement under construction. */
  text: string;
  /** Selected statement kind, or `null` when not yet classified. */
  classification: StatementKind | null;
  /** Target entity id (node or edge) the proposal will hang off, or `null` for a free-floating new node. */
  targetEntityId: string | null;
  /**
   * Selected edge role for the in-progress connect, or `null` when no
   * role has been picked yet. Only meaningful while
   * `targetEntityId !== null`; the chip's `handleClear` extension nulls
   * this slice alongside `targetEntityId` so a role-without-target
   * intermediate state never lingers. Refinement:
   * `tasks/refinements/moderator-ui/mod_edge_role_selector.md`.
   */
  edgeRole: EdgeRole | null;
  /** Current capture-pane mode. */
  mode: CaptureMode;
  /**
   * True while a propose round-trip is in flight; observable from
   * sibling components so they can de-emphasize the inputs during the
   * round-trip. v1 does NOT disable the inputs (see
   * `tasks/refinements/moderator-ui/mod_propose_action.md` Decision §5);
   * the slice carries the signal for future consumers (toast surface,
   * retry banner). Reset to `false` by `reset()` via the spread of
   * `initialCaptureState`.
   *
   * Refinement: `tasks/refinements/moderator-ui/mod_propose_action.md`.
   */
  proposing: boolean;

  setText: (text: string) => void;
  setClassification: (classification: StatementKind | null) => void;
  setTargetEntityId: (id: string | null) => void;
  setEdgeRole: (role: EdgeRole | null) => void;
  setMode: (mode: CaptureMode) => void;
  setProposing: (value: boolean) => void;
  /** Reset the pane to a fresh idle state — called after a successful propose. */
  reset: () => void;
}

const initialCaptureState: Pick<
  CaptureState,
  'text' | 'classification' | 'targetEntityId' | 'edgeRole' | 'mode' | 'proposing'
> = {
  text: '',
  classification: null,
  targetEntityId: null,
  edgeRole: null,
  mode: 'idle',
  proposing: false,
};

export const useCaptureStore = create<CaptureState>()(
  withDevtools('moderator/capture', (set) => ({
    ...initialCaptureState,
    setText: (text) => set({ text }),
    setClassification: (classification) => set({ classification }),
    setTargetEntityId: (targetEntityId) => set({ targetEntityId }),
    setEdgeRole: (edgeRole) => set({ edgeRole }),
    setMode: (mode) => set({ mode }),
    setProposing: (proposing) => set({ proposing }),
    reset: () => set({ ...initialCaptureState }),
  })),
);
