// Tests for `useCaptureStore` — decompose-mode slice + coordination
// helpers.
//
// Refinement: tasks/refinements/moderator-ui/mod_decompose_mode.md
//             tasks/refinements/moderator-ui/mod_multi_component_capture.md
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// The store-shape smoke cases (default values + simple setters + the
// React re-render probe) live in `stores.test.tsx` — that file is the
// historical home for the `mod_state_management` cover. This file
// focuses on the decompose-mode-specific seams the
// `mod_decompose_mode` task adds: the `decomposeTargetNodeId` slice +
// the `enterDecomposeMode` / `exitDecomposeMode` coordination helpers
// + the F1-coupling clear documented in Decision §6 of the refinement.
//
// The `mod_multi_component_capture` task extends this file with the
// per-row `decomposeComponents` slice, the four per-row mutators
// (`setDecomposeComponentText`, `setDecomposeComponentClassification`,
// `addDecomposeComponent`, `removeDecomposeComponent`), the two-row
// init on `enterDecomposeMode`, the clear-back on `exitDecomposeMode`,
// and the free-function `validateDecomposeComponents` validator's
// truth-table.

import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_METHODOLOGY_TEXT_LENGTH } from '@a-conversa/shared-types';

import {
  createEmptyDecomposeComponents,
  createEmptyProposalRows,
  useCaptureStore,
  validateDecomposeComponents,
  validateProposalRows,
} from './captureStore.js';

const captureInitial = useCaptureStore.getState();

beforeEach(() => {
  useCaptureStore.setState(captureInitial, true);
});

describe('useCaptureStore — decompose-mode slice (mod_decompose_mode)', () => {
  it('decomposeTargetNodeId is null in the initial state', () => {
    expect(useCaptureStore.getState().decomposeTargetNodeId).toBeNull();
  });

  it('setDecomposeTargetNodeId mutates the slice directly (test seam, not the coupled helper)', () => {
    useCaptureStore.getState().setDecomposeTargetNodeId('n-direct');
    expect(useCaptureStore.getState().decomposeTargetNodeId).toBe('n-direct');
    useCaptureStore.getState().setDecomposeTargetNodeId(null);
    expect(useCaptureStore.getState().decomposeTargetNodeId).toBeNull();
  });

  it('enterDecomposeMode(nodeId) sets mode to decompose and stashes the target id', () => {
    useCaptureStore.getState().enterDecomposeMode('n1');
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('decompose');
    expect(state.decomposeTargetNodeId).toBe('n1');
  });

  it('enterDecomposeMode clears the F1 capture-flow slices (Decision §6 — no bleed-through)', () => {
    // Seed every F1 slice with a non-default value, then verify
    // enterDecomposeMode clears them atomically alongside the mode
    // flip + the target stash. The clear is the load-bearing seam
    // siblings (mod_multi_component_capture / mod_propose_decomposition)
    // depend on.
    useCaptureStore.getState().setText('a stale draft wording');
    useCaptureStore.getState().setClassification('fact');
    useCaptureStore.getState().setTargetEntityId('node-stale');
    useCaptureStore.getState().setEdgeRole('supports');

    useCaptureStore.getState().enterDecomposeMode('n1');

    const state = useCaptureStore.getState();
    expect(state.mode).toBe('decompose');
    expect(state.decomposeTargetNodeId).toBe('n1');
    expect(state.text).toBe('');
    expect(state.classification).toBeNull();
    expect(state.targetEntityId).toBeNull();
    expect(state.edgeRole).toBeNull();
  });

  it('enterDecomposeMode uses a single set() — subscribers observe exactly one transition per call', () => {
    // Subscribe via the store's `subscribe` API and count notification
    // fires. The helper must emit one (not seven) transition to keep
    // the React reconciliation cheap and the mode-banner re-render path
    // clean.
    let notifications = 0;
    const unsubscribe = useCaptureStore.subscribe(() => {
      notifications += 1;
    });
    try {
      useCaptureStore.getState().enterDecomposeMode('n1');
      expect(notifications).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  it('exitDecomposeMode reverts mode to idle and clears decomposeTargetNodeId', () => {
    useCaptureStore.getState().enterDecomposeMode('n1');
    expect(useCaptureStore.getState().mode).toBe('decompose');
    useCaptureStore.getState().exitDecomposeMode();
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('idle');
    expect(state.decomposeTargetNodeId).toBeNull();
  });

  it('exitDecomposeMode does NOT re-populate the F1 slices', () => {
    // After enterDecomposeMode cleared the F1 slices, exit leaves them
    // alone — there is no prior F1 draft to restore (the rationale in
    // Decision §6 makes the design call: cancelled decompose returns
    // the operator to an empty idle, not to a previous F1 state).
    useCaptureStore.getState().setText('would have been a draft');
    useCaptureStore.getState().enterDecomposeMode('n1');
    useCaptureStore.getState().exitDecomposeMode();
    const state = useCaptureStore.getState();
    expect(state.text).toBe('');
    expect(state.classification).toBeNull();
    expect(state.targetEntityId).toBeNull();
    expect(state.edgeRole).toBeNull();
  });

  it('reset() clears decomposeTargetNodeId alongside the other slices', () => {
    useCaptureStore.getState().enterDecomposeMode('n1');
    expect(useCaptureStore.getState().decomposeTargetNodeId).toBe('n1');
    useCaptureStore.getState().reset();
    expect(useCaptureStore.getState().decomposeTargetNodeId).toBeNull();
    expect(useCaptureStore.getState().mode).toBe('idle');
  });
});

describe('useCaptureStore — decompose-components slice (mod_multi_component_capture)', () => {
  it('decomposeComponents is [] in the initial state', () => {
    expect(useCaptureStore.getState().decomposeComponents).toEqual([]);
  });

  it('enterDecomposeMode(nodeId) seeds decomposeComponents to two empty rows', () => {
    useCaptureStore.getState().enterDecomposeMode('n1');
    const state = useCaptureStore.getState();
    expect(state.decomposeComponents).toHaveLength(2);
    expect(state.decomposeComponents[0]).toEqual({ text: '', classification: null });
    expect(state.decomposeComponents[1]).toEqual({ text: '', classification: null });
  });

  it('enterDecomposeMode uses a single set() — subscribers observe exactly one transition (including the decomposeComponents seed)', () => {
    let notifications = 0;
    const unsubscribe = useCaptureStore.subscribe(() => {
      notifications += 1;
    });
    try {
      useCaptureStore.getState().enterDecomposeMode('n1');
      expect(notifications).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  it('exitDecomposeMode clears decomposeComponents back to []', () => {
    useCaptureStore.getState().enterDecomposeMode('n1');
    expect(useCaptureStore.getState().decomposeComponents).toHaveLength(2);
    useCaptureStore.getState().exitDecomposeMode();
    expect(useCaptureStore.getState().decomposeComponents).toEqual([]);
  });

  it('reset() clears decomposeComponents back to []', () => {
    useCaptureStore.getState().enterDecomposeMode('n1');
    expect(useCaptureStore.getState().decomposeComponents).toHaveLength(2);
    useCaptureStore.getState().reset();
    expect(useCaptureStore.getState().decomposeComponents).toEqual([]);
  });

  it('setDecomposeComponentText(0, "hello") writes only to row 0; row 1 unchanged', () => {
    useCaptureStore.getState().enterDecomposeMode('n1');
    useCaptureStore.getState().setDecomposeComponentText(0, 'hello');
    const state = useCaptureStore.getState();
    expect(state.decomposeComponents[0]).toEqual({ text: 'hello', classification: null });
    expect(state.decomposeComponents[1]).toEqual({ text: '', classification: null });
  });

  it('setDecomposeComponentText clamps over-long input to MAX_METHODOLOGY_TEXT_LENGTH', () => {
    useCaptureStore.getState().enterDecomposeMode('n1');
    useCaptureStore
      .getState()
      .setDecomposeComponentText(0, 'x'.repeat(MAX_METHODOLOGY_TEXT_LENGTH + 1));
    expect(useCaptureStore.getState().decomposeComponents[0]?.text.length).toBe(
      MAX_METHODOLOGY_TEXT_LENGTH,
    );
  });

  it('setDecomposeComponentClassification(1, "fact") writes to row 1', () => {
    useCaptureStore.getState().enterDecomposeMode('n1');
    useCaptureStore.getState().setDecomposeComponentClassification(1, 'fact');
    const state = useCaptureStore.getState();
    expect(state.decomposeComponents[1]?.classification).toBe('fact');
    expect(state.decomposeComponents[0]?.classification).toBeNull();
  });

  it('addDecomposeComponent appends one empty row', () => {
    useCaptureStore.getState().enterDecomposeMode('n1');
    useCaptureStore.getState().addDecomposeComponent();
    const state = useCaptureStore.getState();
    expect(state.decomposeComponents).toHaveLength(3);
    expect(state.decomposeComponents[2]).toEqual({ text: '', classification: null });
  });

  it('addDecomposeComponent at length === 10 is a no-op (store defends the max bound)', () => {
    useCaptureStore.getState().enterDecomposeMode('n1');
    // Start at 2; add 8 to reach 10.
    for (let i = 0; i < 8; i += 1) {
      useCaptureStore.getState().addDecomposeComponent();
    }
    expect(useCaptureStore.getState().decomposeComponents).toHaveLength(10);
    // One more — no-op.
    useCaptureStore.getState().addDecomposeComponent();
    expect(useCaptureStore.getState().decomposeComponents).toHaveLength(10);
  });

  it('removeDecomposeComponent(1) on a 3-row grid removes the indexed row; the row formerly at index 2 is now at index 1', () => {
    useCaptureStore.getState().enterDecomposeMode('n1');
    useCaptureStore.getState().addDecomposeComponent(); // length === 3
    useCaptureStore.getState().setDecomposeComponentText(0, 'row-0');
    useCaptureStore.getState().setDecomposeComponentText(1, 'row-1');
    useCaptureStore.getState().setDecomposeComponentText(2, 'row-2');
    useCaptureStore.getState().removeDecomposeComponent(1);
    const state = useCaptureStore.getState();
    expect(state.decomposeComponents).toHaveLength(2);
    expect(state.decomposeComponents[0]?.text).toBe('row-0');
    expect(state.decomposeComponents[1]?.text).toBe('row-2');
  });

  it('removeDecomposeComponent(0) on a 2-row grid is a no-op (store defends the min bound)', () => {
    useCaptureStore.getState().enterDecomposeMode('n1');
    useCaptureStore.getState().setDecomposeComponentText(0, 'row-0');
    useCaptureStore.getState().setDecomposeComponentText(1, 'row-1');
    useCaptureStore.getState().removeDecomposeComponent(0);
    const state = useCaptureStore.getState();
    expect(state.decomposeComponents).toHaveLength(2);
    expect(state.decomposeComponents[0]?.text).toBe('row-0');
    expect(state.decomposeComponents[1]?.text).toBe('row-1');
  });
});

describe('validateDecomposeComponents — truth table (mod_multi_component_capture)', () => {
  it('returns false for an empty array (below minimum)', () => {
    expect(validateDecomposeComponents([])).toBe(false);
  });

  it('returns false for a single-row array (below minimum)', () => {
    expect(validateDecomposeComponents([{ text: 'a', classification: 'fact' }])).toBe(false);
  });

  it('returns true for a two-row array where every row has trimmed text + a non-null kind', () => {
    expect(
      validateDecomposeComponents([
        { text: 'a', classification: 'fact' },
        { text: 'b', classification: 'value' },
      ]),
    ).toBe(true);
  });

  it('returns false for an 11-element array (above maximum)', () => {
    const rows = Array.from({ length: 11 }, () => ({
      text: 'x',
      classification: 'fact' as const,
    }));
    expect(validateDecomposeComponents(rows)).toBe(false);
  });

  it('returns false when one row has whitespace-only text (trim check)', () => {
    expect(
      validateDecomposeComponents([
        { text: 'a', classification: 'fact' },
        { text: '   ', classification: 'value' },
      ]),
    ).toBe(false);
  });

  it('returns false when one row has null classification', () => {
    expect(
      validateDecomposeComponents([
        { text: 'a', classification: 'fact' },
        { text: 'b', classification: null },
      ]),
    ).toBe(false);
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
//
// `validateProposalRows` is the mode-neutral name introduced by this
// refinement (Decision §1); `validateDecomposeComponents` stays as a
// thin wrapper for source-stable consumers. Body identity is the
// load-bearing pin — the wrapper must continue resolving via the
// existing export name.
describe('validateProposalRows / wrapper preservation (mod_interpretive_split_mode)', () => {
  it('validateProposalRows returns the same truth as validateDecomposeComponents on identical input', () => {
    const passing = [
      { text: 'a', classification: 'fact' as const },
      { text: 'b', classification: 'value' as const },
    ];
    expect(validateProposalRows(passing)).toBe(true);
    expect(validateDecomposeComponents(passing)).toBe(true);

    const failing = [{ text: '', classification: null }];
    expect(validateProposalRows(failing)).toBe(false);
    expect(validateDecomposeComponents(failing)).toBe(false);
  });

  it('createEmptyProposalRows returns two empty rows; createEmptyDecomposeComponents stays as a wrapper with the same shape', () => {
    const rows = createEmptyProposalRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ text: '', classification: null });
    expect(rows[1]).toEqual({ text: '', classification: null });
    const wrapperRows = createEmptyDecomposeComponents();
    expect(wrapperRows).toEqual(rows);
    // Fresh array identity each call (Zustand subscribers fire on
    // reference change — same invariant the helper has always carried).
    expect(createEmptyProposalRows()).not.toBe(rows);
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
//
// New `'interpretive-split'` CaptureMode value + the parallel slices
// + the seven mode-flip / per-row helpers. The cases mirror the
// existing `decompose` set so the per-mode invariants are pinned
// symmetrically.
describe('useCaptureStore — interpretive-split slice (mod_interpretive_split_mode)', () => {
  it('interpretiveSplitTargetNodeId is null in the initial state', () => {
    expect(useCaptureStore.getState().interpretiveSplitTargetNodeId).toBeNull();
  });

  it('interpretiveSplitReadings is [] in the initial state', () => {
    expect(useCaptureStore.getState().interpretiveSplitReadings).toEqual([]);
  });

  it("'interpretive-split' is a valid CaptureMode value (setMode + slice read)", () => {
    useCaptureStore.getState().setMode('interpretive-split');
    expect(useCaptureStore.getState().mode).toBe('interpretive-split');
  });

  it('setInterpretiveSplitTargetNodeId mutates the slice directly (test seam)', () => {
    useCaptureStore.getState().setInterpretiveSplitTargetNodeId('n-direct');
    expect(useCaptureStore.getState().interpretiveSplitTargetNodeId).toBe('n-direct');
    useCaptureStore.getState().setInterpretiveSplitTargetNodeId(null);
    expect(useCaptureStore.getState().interpretiveSplitTargetNodeId).toBeNull();
  });

  it('enterInterpretiveSplitMode sets mode, the target id, seeds two empty rows, clears F1 slices', () => {
    useCaptureStore.getState().setText('a stale draft wording');
    useCaptureStore.getState().setClassification('fact');
    useCaptureStore.getState().setTargetEntityId('node-stale');
    useCaptureStore.getState().setEdgeRole('supports');

    useCaptureStore.getState().enterInterpretiveSplitMode('n1');

    const state = useCaptureStore.getState();
    expect(state.mode).toBe('interpretive-split');
    expect(state.interpretiveSplitTargetNodeId).toBe('n1');
    expect(state.interpretiveSplitReadings).toHaveLength(2);
    expect(state.interpretiveSplitReadings[0]).toEqual({ text: '', classification: null });
    expect(state.interpretiveSplitReadings[1]).toEqual({ text: '', classification: null });
    // F1 slices cleared.
    expect(state.text).toBe('');
    expect(state.classification).toBeNull();
    expect(state.targetEntityId).toBeNull();
    expect(state.edgeRole).toBeNull();
  });

  it('enterInterpretiveSplitMode uses a single set() — subscribers observe exactly one transition per call', () => {
    let notifications = 0;
    const unsubscribe = useCaptureStore.subscribe(() => {
      notifications += 1;
    });
    try {
      useCaptureStore.getState().enterInterpretiveSplitMode('n1');
      expect(notifications).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  it('enterInterpretiveSplitMode does NOT clear the decompose slices (Decision §5 — no cross-clearing)', () => {
    // First populate decompose slices.
    useCaptureStore.getState().enterDecomposeMode('decompose-target');
    useCaptureStore.getState().setDecomposeComponentText(0, 'decompose row 0');
    const beforeDecomposeRows = useCaptureStore.getState().decomposeComponents;

    // Now switch to interpretive-split. The decompose slices remain
    // populated — the mode field is the exclusion mechanism.
    useCaptureStore.getState().enterInterpretiveSplitMode('split-target');
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('interpretive-split');
    expect(state.decomposeTargetNodeId).toBe('decompose-target');
    expect(state.decomposeComponents).toBe(beforeDecomposeRows);
  });

  it('exitInterpretiveSplitMode reverts mode to idle and clears both interpretive-split slices', () => {
    useCaptureStore.getState().enterInterpretiveSplitMode('n1');
    expect(useCaptureStore.getState().mode).toBe('interpretive-split');
    useCaptureStore.getState().exitInterpretiveSplitMode();
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('idle');
    expect(state.interpretiveSplitTargetNodeId).toBeNull();
    expect(state.interpretiveSplitReadings).toEqual([]);
  });

  it('reset() clears both interpretive-split slices', () => {
    useCaptureStore.getState().enterInterpretiveSplitMode('n1');
    expect(useCaptureStore.getState().interpretiveSplitTargetNodeId).toBe('n1');
    useCaptureStore.getState().reset();
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('idle');
    expect(state.interpretiveSplitTargetNodeId).toBeNull();
    expect(state.interpretiveSplitReadings).toEqual([]);
  });

  it('setInterpretiveSplitReadingText(0, "hello") writes only to row 0; row 1 unchanged', () => {
    useCaptureStore.getState().enterInterpretiveSplitMode('n1');
    useCaptureStore.getState().setInterpretiveSplitReadingText(0, 'hello');
    const state = useCaptureStore.getState();
    expect(state.interpretiveSplitReadings[0]).toEqual({ text: 'hello', classification: null });
    expect(state.interpretiveSplitReadings[1]).toEqual({ text: '', classification: null });
  });

  it('setInterpretiveSplitReadingText clamps over-long input to MAX_METHODOLOGY_TEXT_LENGTH', () => {
    useCaptureStore.getState().enterInterpretiveSplitMode('n1');
    useCaptureStore
      .getState()
      .setInterpretiveSplitReadingText(0, 'x'.repeat(MAX_METHODOLOGY_TEXT_LENGTH + 1));
    expect(useCaptureStore.getState().interpretiveSplitReadings[0]?.text.length).toBe(
      MAX_METHODOLOGY_TEXT_LENGTH,
    );
  });

  it('setInterpretiveSplitReadingClassification(1, "fact") writes to row 1', () => {
    useCaptureStore.getState().enterInterpretiveSplitMode('n1');
    useCaptureStore.getState().setInterpretiveSplitReadingClassification(1, 'fact');
    const state = useCaptureStore.getState();
    expect(state.interpretiveSplitReadings[1]?.classification).toBe('fact');
    expect(state.interpretiveSplitReadings[0]?.classification).toBeNull();
  });

  it('addInterpretiveSplitReading appends one empty row; at length 10 it is a no-op', () => {
    useCaptureStore.getState().enterInterpretiveSplitMode('n1');
    useCaptureStore.getState().addInterpretiveSplitReading();
    expect(useCaptureStore.getState().interpretiveSplitReadings).toHaveLength(3);
    // Pad to 10.
    for (let i = 0; i < 7; i += 1) {
      useCaptureStore.getState().addInterpretiveSplitReading();
    }
    expect(useCaptureStore.getState().interpretiveSplitReadings).toHaveLength(10);
    // One more — no-op.
    useCaptureStore.getState().addInterpretiveSplitReading();
    expect(useCaptureStore.getState().interpretiveSplitReadings).toHaveLength(10);
  });

  it('removeInterpretiveSplitReading on a 3-row grid removes the indexed row; at the minimum 2 rows is a no-op', () => {
    useCaptureStore.getState().enterInterpretiveSplitMode('n1');
    useCaptureStore.getState().addInterpretiveSplitReading(); // length === 3
    useCaptureStore.getState().setInterpretiveSplitReadingText(0, 'row-0');
    useCaptureStore.getState().setInterpretiveSplitReadingText(1, 'row-1');
    useCaptureStore.getState().setInterpretiveSplitReadingText(2, 'row-2');
    useCaptureStore.getState().removeInterpretiveSplitReading(1);
    let state = useCaptureStore.getState();
    expect(state.interpretiveSplitReadings).toHaveLength(2);
    expect(state.interpretiveSplitReadings[0]?.text).toBe('row-0');
    expect(state.interpretiveSplitReadings[1]?.text).toBe('row-2');
    // Now at the minimum — no-op.
    useCaptureStore.getState().removeInterpretiveSplitReading(0);
    state = useCaptureStore.getState();
    expect(state.interpretiveSplitReadings).toHaveLength(2);
    expect(state.interpretiveSplitReadings[0]?.text).toBe('row-0');
  });
});

describe('useCaptureStore — operationalization-mode slice (mod_operationalization_mode)', () => {
  it('operationalizationTargetNodeId is null in the initial state', () => {
    expect(useCaptureStore.getState().operationalizationTargetNodeId).toBeNull();
  });

  it('setOperationalizationTargetNodeId mutates the slice without flipping mode', () => {
    useCaptureStore.getState().setOperationalizationTargetNodeId('n-direct');
    const state = useCaptureStore.getState();
    expect(state.operationalizationTargetNodeId).toBe('n-direct');
    // The direct setter is a pure slice mutation — mode stays idle.
    expect(state.mode).toBe('idle');
    useCaptureStore.getState().setOperationalizationTargetNodeId(null);
    expect(useCaptureStore.getState().operationalizationTargetNodeId).toBeNull();
  });

  it('enterOperationalizationMode(nodeId) flips mode to operationalization, stashes the target id, clears F1 slices', () => {
    // Seed every F1 slice so we can assert the atomic clear.
    useCaptureStore.getState().setText('a stale draft wording');
    useCaptureStore.getState().setClassification('fact');
    useCaptureStore.getState().setTargetEntityId('node-stale');
    useCaptureStore.getState().setEdgeRole('supports');

    useCaptureStore.getState().enterOperationalizationMode('n1');

    const state = useCaptureStore.getState();
    expect(state.mode).toBe('operationalization');
    expect(state.operationalizationTargetNodeId).toBe('n1');
    expect(state.text).toBe('');
    expect(state.classification).toBeNull();
    expect(state.targetEntityId).toBeNull();
    expect(state.edgeRole).toBeNull();
  });

  it('enterOperationalizationMode uses a single set() — subscribers observe exactly one transition per call', () => {
    let notifications = 0;
    const unsubscribe = useCaptureStore.subscribe(() => {
      notifications += 1;
    });
    try {
      useCaptureStore.getState().enterOperationalizationMode('n1');
      expect(notifications).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  it('exitOperationalizationMode reverts mode to idle and clears operationalizationTargetNodeId', () => {
    useCaptureStore.getState().enterOperationalizationMode('n1');
    expect(useCaptureStore.getState().mode).toBe('operationalization');
    useCaptureStore.getState().exitOperationalizationMode();
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('idle');
    expect(state.operationalizationTargetNodeId).toBeNull();
  });

  it('exitOperationalizationMode does NOT re-populate the F1 slices (mirrors exitDecomposeMode discipline)', () => {
    useCaptureStore.getState().setText('would have been a draft');
    useCaptureStore.getState().enterOperationalizationMode('n1');
    useCaptureStore.getState().exitOperationalizationMode();
    const state = useCaptureStore.getState();
    expect(state.text).toBe('');
    expect(state.classification).toBeNull();
    expect(state.targetEntityId).toBeNull();
    expect(state.edgeRole).toBeNull();
  });

  it('reset() clears operationalizationTargetNodeId even after entering operationalization mode', () => {
    useCaptureStore.getState().enterOperationalizationMode('n1');
    expect(useCaptureStore.getState().operationalizationTargetNodeId).toBe('n1');
    useCaptureStore.getState().reset();
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('idle');
    expect(state.operationalizationTargetNodeId).toBeNull();
  });

  it('enterOperationalizationMode then enterDecomposeMode flips mode but leaves operationalizationTargetNodeId stale (per-slice ownership)', () => {
    // The operationalization slice is owned by its own enter/exit pair;
    // an external mode flip (e.g. into decompose) leaves the stale
    // target id alone — the next enterOperationalizationMode overwrites
    // it. This mirrors the decompose / interpretive-split mutual-state
    // behavior. Pin the invariant so a cross-mode-clear refactor is a
    // deliberate change.
    useCaptureStore.getState().enterOperationalizationMode('op-target');
    useCaptureStore.getState().enterDecomposeMode('decompose-target');
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('decompose');
    expect(state.decomposeTargetNodeId).toBe('decompose-target');
    expect(state.operationalizationTargetNodeId).toBe('op-target');
  });
});

describe('useCaptureStore — warrant-elicitation-mode slice (mod_warrant_elicitation_mode)', () => {
  it('warrantElicitationTargetNodeId is null in the initial state', () => {
    expect(useCaptureStore.getState().warrantElicitationTargetNodeId).toBeNull();
  });

  it('setWarrantElicitationTargetNodeId mutates the slice without flipping mode', () => {
    useCaptureStore.getState().setWarrantElicitationTargetNodeId('n-direct');
    const state = useCaptureStore.getState();
    expect(state.warrantElicitationTargetNodeId).toBe('n-direct');
    // The direct setter is a pure slice mutation — mode stays idle.
    expect(state.mode).toBe('idle');
    useCaptureStore.getState().setWarrantElicitationTargetNodeId(null);
    expect(useCaptureStore.getState().warrantElicitationTargetNodeId).toBeNull();
  });

  it('enterWarrantElicitationMode(nodeId) flips mode to warrant-elicitation, stashes the target id, clears F1 slices', () => {
    // Seed every F1 slice so we can assert the atomic clear.
    useCaptureStore.getState().setText('a stale draft wording');
    useCaptureStore.getState().setClassification('fact');
    useCaptureStore.getState().setTargetEntityId('node-stale');
    useCaptureStore.getState().setEdgeRole('supports');

    useCaptureStore.getState().enterWarrantElicitationMode('n1');

    const state = useCaptureStore.getState();
    expect(state.mode).toBe('warrant-elicitation');
    expect(state.warrantElicitationTargetNodeId).toBe('n1');
    expect(state.text).toBe('');
    expect(state.classification).toBeNull();
    expect(state.targetEntityId).toBeNull();
    expect(state.edgeRole).toBeNull();
  });

  it('enterWarrantElicitationMode uses a single set() — subscribers observe exactly one transition per call', () => {
    let notifications = 0;
    const unsubscribe = useCaptureStore.subscribe(() => {
      notifications += 1;
    });
    try {
      useCaptureStore.getState().enterWarrantElicitationMode('n1');
      expect(notifications).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  it('exitWarrantElicitationMode reverts mode to idle and clears warrantElicitationTargetNodeId', () => {
    useCaptureStore.getState().enterWarrantElicitationMode('n1');
    expect(useCaptureStore.getState().mode).toBe('warrant-elicitation');
    useCaptureStore.getState().exitWarrantElicitationMode();
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('idle');
    expect(state.warrantElicitationTargetNodeId).toBeNull();
  });

  it('exitWarrantElicitationMode does NOT re-populate the F1 slices (mirrors exitOperationalizationMode discipline)', () => {
    useCaptureStore.getState().setText('would have been a draft');
    useCaptureStore.getState().enterWarrantElicitationMode('n1');
    useCaptureStore.getState().exitWarrantElicitationMode();
    const state = useCaptureStore.getState();
    expect(state.text).toBe('');
    expect(state.classification).toBeNull();
    expect(state.targetEntityId).toBeNull();
    expect(state.edgeRole).toBeNull();
  });

  it('reset() clears warrantElicitationTargetNodeId even after entering warrant-elicitation mode', () => {
    useCaptureStore.getState().enterWarrantElicitationMode('n1');
    expect(useCaptureStore.getState().warrantElicitationTargetNodeId).toBe('n1');
    useCaptureStore.getState().reset();
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('idle');
    expect(state.warrantElicitationTargetNodeId).toBeNull();
  });

  it('enterWarrantElicitationMode then enterOperationalizationMode flips mode but leaves warrantElicitationTargetNodeId stale (per-slice ownership)', () => {
    // Cross-mode invariant — the warrant-elicitation slice is owned by
    // its own enter/exit pair; an external mode flip (e.g. into
    // operationalization) leaves the stale target id alone. Mirrors
    // the existing decompose / interpretive-split / operationalization
    // mutual-state behavior. Pin the invariant so a cross-mode-clear
    // refactor is a deliberate change.
    useCaptureStore.getState().enterWarrantElicitationMode('we-target');
    useCaptureStore.getState().enterOperationalizationMode('op-target');
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('operationalization');
    expect(state.operationalizationTargetNodeId).toBe('op-target');
    expect(state.warrantElicitationTargetNodeId).toBe('we-target');
  });
});
