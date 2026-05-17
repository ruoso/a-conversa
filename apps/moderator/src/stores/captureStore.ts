// `useCaptureStore` — local UI state for the bottom-strip capture pane.
//
// Refinement: tasks/refinements/moderator-ui/mod_state_management.md
// (also:      tasks/refinements/moderator-ui/mod_edge_role_selector.md,
//             tasks/refinements/moderator-ui/mod_decompose_mode.md,
//             tasks/refinements/moderator-ui/mod_interpretive_split_mode.md)
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
 * Build the two-empty-row seed shape `enterDecomposeMode` /
 * `enterInterpretiveSplitMode` plant into their slice on mode entry.
 * Returns a fresh array each call so the `set()` carries a new
 * reference (Zustand triggers subscribers on reference identity).
 *
 * Mode-neutral name introduced by
 * `tasks/refinements/moderator-ui/mod_interpretive_split_mode.md`
 * Decision §1 (extract-and-share with the decompose-side name as a
 * thin wrapper for source stability).
 */
export function createEmptyProposalRows(): DecomposeComponent[] {
  return [
    { text: '', classification: null },
    { text: '', classification: null },
  ];
}

/**
 * Thin wrapper preserved for source-stable callers (the existing
 * decompose-side mode helpers / tests). Identical to
 * `createEmptyProposalRows`.
 */
export function createEmptyDecomposeComponents(): DecomposeComponent[] {
  return createEmptyProposalRows();
}

/**
 * Free-function validator both propose-{decomposition,interpretive-
 * split} hooks import to gate the propose button. Returns `true` iff
 * every row has non-empty trimmed text AND a non-null classification
 * AND the array length is within `[MINIMUM_DECOMPOSE_COMPONENTS,
 * MAXIMUM_DECOMPOSE_COMPONENTS]`.
 *
 * Same Zod bounds apply to both `decomposeProposalSchema.components`
 * and `interpretiveSplitProposalSchema.readings`
 * (`packages/shared-types/src/events/proposals.ts:155-186`); the
 * validator is mode-neutral.
 *
 * Mode-neutral name introduced by
 * `tasks/refinements/moderator-ui/mod_interpretive_split_mode.md`
 * Decision §1.
 */
export function validateProposalRows(rows: ReadonlyArray<DecomposeComponent>): boolean {
  if (rows.length < MINIMUM_DECOMPOSE_COMPONENTS) return false;
  if (rows.length > MAXIMUM_DECOMPOSE_COMPONENTS) return false;
  return rows.every((row) => row.text.trim().length > 0 && row.classification !== null);
}

/**
 * Thin wrapper preserved for source-stable callers. Identical to
 * `validateProposalRows`.
 */
export function validateDecomposeComponents(
  components: ReadonlyArray<DecomposeComponent>,
): boolean {
  return validateProposalRows(components);
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
  | 'interpretive-split'
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

  /**
   * The id of the node currently being interpretively split when
   * `mode === 'interpretive-split'`; `null` otherwise. Set atomically
   * by `enterInterpretiveSplitMode(nodeId)` and cleared by
   * `exitInterpretiveSplitMode()` / `reset()`. The propose-interpretive
   * -split flow reads this when building the propose envelope's
   * `parent_node_id`.
   *
   * Refinement: `tasks/refinements/moderator-ui/mod_interpretive_split_mode.md`.
   */
  interpretiveSplitTargetNodeId: string | null;
  /**
   * Per-row capture state for the interpretive-split flow's multi-
   * reading grid. Empty array outside interpretive-split mode;
   * initialized to two empty rows by `enterInterpretiveSplitMode`;
   * cleared back to `[]` by `exitInterpretiveSplitMode` / `reset`. The
   * row shape mirrors `DecomposeComponent` (the same `proposalComponentSchema`
   * applies; the wire envelope's per-row array is `readings` rather
   * than `components`).
   *
   * Refinement: `tasks/refinements/moderator-ui/mod_interpretive_split_mode.md`.
   */
  interpretiveSplitReadings: ReadonlyArray<DecomposeComponent>;

  /**
   * Set `interpretiveSplitTargetNodeId` directly. Direct callers
   * should prefer the coupled helpers (`enterInterpretiveSplitMode` /
   * `exitInterpretiveSplitMode`); this setter mirrors
   * `setDecomposeTargetNodeId` for symmetry / test seams.
   */
  setInterpretiveSplitTargetNodeId: (id: string | null) => void;
  /**
   * Enter interpretive-split mode for `nodeId`. Atomic multi-field
   * update mirroring `enterDecomposeMode`: sets
   * `mode = 'interpretive-split'`, `interpretiveSplitTargetNodeId =
   * nodeId`, clears the F1 capture-flow slices, and seeds two empty
   * reading rows. Does NOT cross-clear the decompose slices
   * (Decision §5 of the refinement — the two modes are mutually
   * exclusive via `mode`).
   *
   * Refinement: `tasks/refinements/moderator-ui/mod_interpretive_split_mode.md`.
   */
  enterInterpretiveSplitMode: (nodeId: string) => void;
  /**
   * Exit interpretive-split mode. Atomic update mirroring
   * `exitDecomposeMode`.
   */
  exitInterpretiveSplitMode: () => void;
  /** Write the per-row text for `interpretiveSplitReadings[index]` (with the same defensive clamp as the decompose mutator). */
  setInterpretiveSplitReadingText: (index: number, text: string) => void;
  /** Write the per-row classification for `interpretiveSplitReadings[index]`. */
  setInterpretiveSplitReadingClassification: (
    index: number,
    classification: StatementKind | null,
  ) => void;
  /** Append one empty row to `interpretiveSplitReadings` (no-op at the maximum). */
  addInterpretiveSplitReading: () => void;
  /** Remove the indexed row from `interpretiveSplitReadings` (no-op at the minimum). */
  removeInterpretiveSplitReading: (index: number) => void;

  /**
   * The id of the node currently being operationalized when `mode ===
   * 'operationalization'`; `null` otherwise. Set atomically by
   * `enterOperationalizationMode(nodeId)` and cleared by
   * `exitOperationalizationMode()` / `reset()`. The
   * `<OperationalizationCapturePanel>` reads this to surface the target
   * wording overlay; the future F5 / F6 / F7 answer-route wirings will
   * read it when promoting a captured route to a real propose action.
   *
   * Refinement:
   * `tasks/refinements/moderator-ui/mod_operationalization_mode.md`.
   */
  operationalizationTargetNodeId: string | null;

  /**
   * Set `operationalizationTargetNodeId` directly. Direct callers
   * should prefer the coupled helpers (`enterOperationalizationMode` /
   * `exitOperationalizationMode`); this setter mirrors
   * `setDecomposeTargetNodeId` /
   * `setInterpretiveSplitTargetNodeId` for symmetry / test seams.
   */
  setOperationalizationTargetNodeId: (id: string | null) => void;
  /**
   * Enter operationalization mode for `nodeId`. Atomic multi-field
   * update mirroring `enterDecomposeMode` /
   * `enterInterpretiveSplitMode`: sets `mode = 'operationalization'`,
   * `operationalizationTargetNodeId = nodeId`, and clears the F1
   * capture-flow slices so a stale F1 draft does not bleed into the
   * operationalization flow.
   *
   * Unlike the proposal modes there is no per-row seed (operationalization
   * is single-textarea, and the answer textarea's value is local
   * component state per Decision §D7 of the refinement).
   *
   * Refinement:
   * `tasks/refinements/moderator-ui/mod_operationalization_mode.md`.
   */
  enterOperationalizationMode: (nodeId: string) => void;
  /**
   * Exit operationalization mode. Atomic update mirroring
   * `exitDecomposeMode` / `exitInterpretiveSplitMode`: sets
   * `mode = 'idle'`, `operationalizationTargetNodeId = null`. The F1
   * slices are NOT re-populated.
   */
  exitOperationalizationMode: () => void;

  /**
   * The id of the node currently being warrant-elicited when `mode ===
   * 'warrant-elicitation'`; `null` otherwise. Set atomically by
   * `enterWarrantElicitationMode(nodeId)` and cleared by
   * `exitWarrantElicitationMode()` / `reset()`. The
   * `<WarrantElicitationCapturePanel>` reads this to surface the target
   * wording overlay; the future F2 / F4 / F7 route wirings will read it
   * when promoting a captured route to a real propose action.
   *
   * Refinement:
   * `tasks/refinements/moderator-ui/mod_warrant_elicitation_mode.md`.
   */
  warrantElicitationTargetNodeId: string | null;

  /**
   * Set `warrantElicitationTargetNodeId` directly. Direct callers
   * should prefer the coupled helpers
   * (`enterWarrantElicitationMode` / `exitWarrantElicitationMode`);
   * this setter mirrors `setOperationalizationTargetNodeId` /
   * `setDecomposeTargetNodeId` for symmetry / test seams.
   */
  setWarrantElicitationTargetNodeId: (id: string | null) => void;
  /**
   * Enter warrant-elicitation mode for `nodeId`. Atomic multi-field
   * update mirroring `enterOperationalizationMode` /
   * `enterDecomposeMode`: sets `mode = 'warrant-elicitation'`,
   * `warrantElicitationTargetNodeId = nodeId`, and clears the F1
   * capture-flow slices so a stale F1 draft does not bleed into the
   * warrant-elicitation flow.
   *
   * Unlike the proposal modes there is no per-row seed (warrant-
   * elicitation is single-textarea, and the answer textarea's value is
   * local component state per Decision §D7 of the refinement).
   *
   * Refinement:
   * `tasks/refinements/moderator-ui/mod_warrant_elicitation_mode.md`.
   */
  enterWarrantElicitationMode: (nodeId: string) => void;
  /**
   * Exit warrant-elicitation mode. Atomic update mirroring
   * `exitOperationalizationMode` / `exitDecomposeMode`: sets
   * `mode = 'idle'`, `warrantElicitationTargetNodeId = null`. The F1
   * slices are NOT re-populated.
   */
  exitWarrantElicitationMode: () => void;

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
  | 'interpretiveSplitTargetNodeId'
  | 'interpretiveSplitReadings'
  | 'operationalizationTargetNodeId'
  | 'warrantElicitationTargetNodeId'
> = {
  text: '',
  classification: null,
  targetEntityId: null,
  edgeRole: null,
  mode: 'idle',
  proposing: false,
  decomposeTargetNodeId: null,
  decomposeComponents: [],
  interpretiveSplitTargetNodeId: null,
  interpretiveSplitReadings: [],
  operationalizationTargetNodeId: null,
  warrantElicitationTargetNodeId: null,
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
    setInterpretiveSplitTargetNodeId: (interpretiveSplitTargetNodeId) =>
      set({ interpretiveSplitTargetNodeId }),
    enterInterpretiveSplitMode: (nodeId) =>
      set({
        mode: 'interpretive-split',
        interpretiveSplitTargetNodeId: nodeId,
        // F1-coupling clear (mirrors enterDecomposeMode — Decision §6
        // of mod_decompose_mode.md, applied symmetrically to the
        // interpretive-split mode entry per mod_interpretive_split_mode
        // Decision §5).
        text: '',
        classification: null,
        targetEntityId: null,
        edgeRole: null,
        // Two-empty-row seed (mirrors enterDecomposeMode).
        interpretiveSplitReadings: createEmptyProposalRows(),
      }),
    exitInterpretiveSplitMode: () =>
      set({
        mode: 'idle',
        interpretiveSplitTargetNodeId: null,
        interpretiveSplitReadings: [],
      }),
    setInterpretiveSplitReadingText: (index, text) =>
      set((state) => ({
        interpretiveSplitReadings: state.interpretiveSplitReadings.map((row, i) =>
          i === index
            ? {
                ...row,
                text:
                  text.length > MAX_METHODOLOGY_TEXT_LENGTH
                    ? text.slice(0, MAX_METHODOLOGY_TEXT_LENGTH)
                    : text,
              }
            : row,
        ),
      })),
    setInterpretiveSplitReadingClassification: (index, classification) =>
      set((state) => ({
        interpretiveSplitReadings: state.interpretiveSplitReadings.map((row, i) =>
          i === index ? { ...row, classification } : row,
        ),
      })),
    addInterpretiveSplitReading: () =>
      set((state) =>
        state.interpretiveSplitReadings.length >= MAXIMUM_DECOMPOSE_COMPONENTS
          ? state
          : {
              interpretiveSplitReadings: [
                ...state.interpretiveSplitReadings,
                { text: '', classification: null },
              ],
            },
      ),
    removeInterpretiveSplitReading: (index) =>
      set((state) =>
        state.interpretiveSplitReadings.length <= MINIMUM_DECOMPOSE_COMPONENTS
          ? state
          : {
              interpretiveSplitReadings: state.interpretiveSplitReadings.filter(
                (_, i) => i !== index,
              ),
            },
      ),
    setOperationalizationTargetNodeId: (operationalizationTargetNodeId) =>
      set({ operationalizationTargetNodeId }),
    enterOperationalizationMode: (nodeId) =>
      set({
        mode: 'operationalization',
        operationalizationTargetNodeId: nodeId,
        // F1-coupling clear (mirrors enterDecomposeMode /
        // enterInterpretiveSplitMode — Decision §D4 of
        // mod_operationalization_mode.md): a stale in-progress F1 draft
        // must not bleed into the operationalization flow.
        text: '',
        classification: null,
        targetEntityId: null,
        edgeRole: null,
      }),
    exitOperationalizationMode: () =>
      set({
        mode: 'idle',
        operationalizationTargetNodeId: null,
      }),
    setWarrantElicitationTargetNodeId: (warrantElicitationTargetNodeId) =>
      set({ warrantElicitationTargetNodeId }),
    enterWarrantElicitationMode: (nodeId) =>
      set({
        mode: 'warrant-elicitation',
        warrantElicitationTargetNodeId: nodeId,
        // F1-coupling clear (mirrors enterOperationalizationMode /
        // enterDecomposeMode / enterInterpretiveSplitMode — Decision
        // §D4 of mod_warrant_elicitation_mode.md): a stale in-progress
        // F1 draft must not bleed into the warrant-elicitation flow.
        text: '',
        classification: null,
        targetEntityId: null,
        edgeRole: null,
      }),
    exitWarrantElicitationMode: () =>
      set({
        mode: 'idle',
        warrantElicitationTargetNodeId: null,
      }),
    reset: () => set({ ...initialCaptureState }),
  })),
);
