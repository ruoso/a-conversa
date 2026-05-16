// `useCaptureStore` — local UI state for the bottom-strip capture pane.
//
// Refinement: tasks/refinements/moderator-ui/mod_state_management.md
// (also:      tasks/refinements/moderator-ui/mod_edge_role_selector.md,
//             tasks/refinements/moderator-ui/mod_decompose_mode.md)
//
// Holds the in-progress proposal the moderator is composing: the
// statement text, its classification (StatementKind from
// `@a-conversa/shared-types`), the target node it will hang off (if
// any), the edge role connecting the new statement to that target (if
// any), the per-mode target slices (e.g. `decomposeTargetNodeId`), and
// the current capture mode banner. None of this is server state — it
// is reset locally as soon as the moderator clicks "Propose" (the
// actual server round-trip is owned by
// `mod_capture_flow.mod_propose_action`).
//
// Downstream consumers (`mod_capture_flow`, `mod_classification_palette`,
// `mod_target_auto_suggest`, `mod_edge_role_selector`, `mod_mode_banner`)
// read from this store and call the setters. The store is intentionally
// lightweight: it holds form-shaped state, not business rules —
// methodology validation lives in the engine and lands via events.

import { create } from 'zustand';
import {
  MAX_METHODOLOGY_TEXT_LENGTH,
  type EdgeRole,
  type StatementKind,
} from '@a-conversa/shared-types';

import { withDevtools } from './devtools.js';

/**
 * Per-row decompose-mode capture shape. One entry per component the
 * moderator is composing in `mod_multi_component_capture`'s grid.
 *
 * The slice typed as `ReadonlyArray<DecomposeComponent>` is the UI side
 * of the `proposalComponentSchema` contract in
 * `packages/shared-types/src/events/proposals.ts` — the eventual
 * `propose: decompose` envelope's `components` field is built from
 * these rows by `mod_propose_decomposition` (sibling, next task).
 *
 * Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md
 */
export interface DecomposeComponent {
  text: string;
  classification: StatementKind | null;
}

/**
 * Lower bound for the decompose components array — mirrors the Zod
 * schema's `.min(2)` constraint at
 * `packages/shared-types/src/events/proposals.ts`. Enforced at the UI
 * layer for early feedback (disable per-row remove buttons at the
 * minimum) AND inside the store for defensive no-op on direct calls.
 */
const MINIMUM_DECOMPOSE_COMPONENTS = 2;

/**
 * Upper bound — mirrors `.max(10)`. Enforced symmetrically.
 */
const MAXIMUM_DECOMPOSE_COMPONENTS = 10;

/**
 * Build the two-empty-row seed shape `enterDecomposeMode` plants into
 * the slice on mode entry. Returns a fresh array each call so the
 * `set()` carries a new reference (Zustand triggers subscribers on
 * reference identity).
 */
function createEmptyDecomposeComponents(): DecomposeComponent[] {
  return [
    { text: '', classification: null },
    { text: '', classification: null },
  ];
}

/**
 * Free-function validator the sibling `mod_propose_decomposition` will
 * import to gate the propose button. Returns `true` iff every row has
 * non-empty trimmed text AND a non-null classification AND the array
 * length is within `[MINIMUM_DECOMPOSE_COMPONENTS,
 * MAXIMUM_DECOMPOSE_COMPONENTS]`.
 *
 * Decision §8 of the refinement records why this lives in the store
 * module rather than a sibling validator file.
 */
export function validateDecomposeComponents(
  components: ReadonlyArray<DecomposeComponent>,
): boolean {
  if (components.length < MINIMUM_DECOMPOSE_COMPONENTS) return false;
  if (components.length > MAXIMUM_DECOMPOSE_COMPONENTS) return false;
  return components.every((c) => c.text.trim().length > 0 && c.classification !== null);
}

export { MINIMUM_DECOMPOSE_COMPONENTS, MAXIMUM_DECOMPOSE_COMPONENTS };

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
  /**
   * The id of the node currently being decomposed when `mode ===
   * 'decompose'`; `null` otherwise. Set atomically by
   * `enterDecomposeMode(nodeId)` and cleared by `exitDecomposeMode()` /
   * `reset()`. The sibling `mod_multi_component_capture` task reads
   * this to know which parent the captured components are replacing;
   * `mod_propose_decomposition` reads it when building the propose
   * envelope's `parent_node_id`.
   *
   * Refinement: `tasks/refinements/moderator-ui/mod_decompose_mode.md`.
   */
  decomposeTargetNodeId: string | null;
  /**
   * Per-row capture state for the decompose flow's multi-component
   * grid. Empty array outside decompose mode; initialized to two empty
   * rows by `enterDecomposeMode`; cleared back to `[]` by
   * `exitDecomposeMode` / `reset`. Each row carries the wording the
   * moderator is composing for that component and its proposed
   * classification (null until they pick a kind).
   *
   * The slice's shape mirrors the eventual envelope's
   * `proposalComponentSchema` items in
   * `packages/shared-types/src/events/proposals.ts`; the sibling
   * `mod_propose_decomposition` task builds the envelope from these
   * rows and runs `validateDecomposeComponents` (exported from this
   * module) to gate the propose button.
   *
   * Refinement: `tasks/refinements/moderator-ui/mod_multi_component_capture.md`.
   */
  decomposeComponents: ReadonlyArray<DecomposeComponent>;

  setText: (text: string) => void;
  setClassification: (classification: StatementKind | null) => void;
  setTargetEntityId: (id: string | null) => void;
  setEdgeRole: (role: EdgeRole | null) => void;
  setMode: (mode: CaptureMode) => void;
  setProposing: (value: boolean) => void;
  /**
   * Set `decomposeTargetNodeId` directly. Direct callers should prefer
   * the coupled helpers (`enterDecomposeMode` / `exitDecomposeMode`)
   * that maintain the mode-flip + F1-clear invariants; this setter
   * exists for symmetry with the other slices and for test seams that
   * need to mutate the slice without invoking the coupled mode
   * transition.
   *
   * Refinement: `tasks/refinements/moderator-ui/mod_decompose_mode.md`.
   */
  setDecomposeTargetNodeId: (id: string | null) => void;
  /**
   * Enter decompose mode for `nodeId`. Atomic multi-field update:
   * sets `mode = 'decompose'`, `decomposeTargetNodeId = nodeId`, and
   * clears the F1 capture-flow slices (`text`, `classification`,
   * `targetEntityId`, `edgeRole`) so a stale F1 draft does not bleed
   * through into the decompose flow. Single `set()` so subscribers
   * observe one transition.
   *
   * Refinement: `tasks/refinements/moderator-ui/mod_decompose_mode.md`
   * (Decision §6 records the F1-clear coupling rationale).
   */
  enterDecomposeMode: (nodeId: string) => void;
  /**
   * Exit decompose mode. Atomic update: sets `mode = 'idle'`,
   * `decomposeTargetNodeId = null`. The F1 slices are NOT
   * re-populated (entering decompose already cleared them; cancelling
   * decompose returns the operator to an empty idle).
   *
   * Refinement: `tasks/refinements/moderator-ui/mod_decompose_mode.md`.
   */
  exitDecomposeMode: () => void;
  /**
   * Write the per-row text for `decomposeComponents[index]`. Defensive
   * `slice(0, MAX_METHODOLOGY_TEXT_LENGTH)` clamp mirrors
   * `<CaptureTextInput>`'s paste-bypass defense.
   *
   * Refinement: `tasks/refinements/moderator-ui/mod_multi_component_capture.md`.
   */
  setDecomposeComponentText: (index: number, text: string) => void;
  /**
   * Write the per-row classification for `decomposeComponents[index]`.
   * `null` clears the kind for that row.
   *
   * Refinement: `tasks/refinements/moderator-ui/mod_multi_component_capture.md`.
   */
  setDecomposeComponentClassification: (
    index: number,
    classification: StatementKind | null,
  ) => void;
  /**
   * Append one empty row to `decomposeComponents`. No-op when the
   * array is already at `MAXIMUM_DECOMPOSE_COMPONENTS` rows; the
   * consumer disables the button but the store defends the invariant.
   *
   * Refinement: `tasks/refinements/moderator-ui/mod_multi_component_capture.md`.
   */
  addDecomposeComponent: () => void;
  /**
   * Remove the indexed row from `decomposeComponents`. No-op when the
   * array is at the minimum `MINIMUM_DECOMPOSE_COMPONENTS` rows; the
   * consumer disables the per-row remove button but the store defends
   * the invariant.
   *
   * Refinement: `tasks/refinements/moderator-ui/mod_multi_component_capture.md`.
   */
  removeDecomposeComponent: (index: number) => void;
  /** Reset the pane to a fresh idle state — called after a successful propose. */
  reset: () => void;
}

const initialCaptureState: Pick<
  CaptureState,
  | 'text'
  | 'classification'
  | 'targetEntityId'
  | 'edgeRole'
  | 'mode'
  | 'proposing'
  | 'decomposeTargetNodeId'
  | 'decomposeComponents'
> = {
  text: '',
  classification: null,
  targetEntityId: null,
  edgeRole: null,
  mode: 'idle',
  proposing: false,
  decomposeTargetNodeId: null,
  decomposeComponents: [],
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
    setDecomposeTargetNodeId: (decomposeTargetNodeId) => set({ decomposeTargetNodeId }),
    enterDecomposeMode: (nodeId) =>
      set({
        mode: 'decompose',
        decomposeTargetNodeId: nodeId,
        // F1-coupling clear (Decision §6 of mod_decompose_mode.md):
        // a stale in-progress F1 draft must not bleed into the
        // decompose flow.
        text: '',
        classification: null,
        targetEntityId: null,
        edgeRole: null,
        // Two-empty-row seed (mod_multi_component_capture Decision §1):
        // the grid mounts with the minimum number of rows the moderator
        // will fill in. The store carries the invariant so the route
        // doesn't have to seed on mount.
        decomposeComponents: createEmptyDecomposeComponents(),
      }),
    exitDecomposeMode: () =>
      set({
        mode: 'idle',
        decomposeTargetNodeId: null,
        // Clear the per-row capture state so the grid is empty on the
        // next mode entry. The reset is symmetric with the seed in
        // `enterDecomposeMode`.
        decomposeComponents: [],
      }),
    setDecomposeComponentText: (index, text) =>
      set((state) => ({
        decomposeComponents: state.decomposeComponents.map((component, i) =>
          i === index
            ? {
                ...component,
                text:
                  text.length > MAX_METHODOLOGY_TEXT_LENGTH
                    ? text.slice(0, MAX_METHODOLOGY_TEXT_LENGTH)
                    : text,
              }
            : component,
        ),
      })),
    setDecomposeComponentClassification: (index, classification) =>
      set((state) => ({
        decomposeComponents: state.decomposeComponents.map((component, i) =>
          i === index ? { ...component, classification } : component,
        ),
      })),
    addDecomposeComponent: () =>
      set((state) =>
        state.decomposeComponents.length >= MAXIMUM_DECOMPOSE_COMPONENTS
          ? state
          : {
              decomposeComponents: [
                ...state.decomposeComponents,
                { text: '', classification: null },
              ],
            },
      ),
    removeDecomposeComponent: (index) =>
      set((state) =>
        state.decomposeComponents.length <= MINIMUM_DECOMPOSE_COMPONENTS
          ? state
          : {
              decomposeComponents: state.decomposeComponents.filter((_, i) => i !== index),
            },
      ),
    reset: () => set({ ...initialCaptureState }),
  })),
);
