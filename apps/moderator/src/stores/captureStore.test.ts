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

import { useCaptureStore, validateDecomposeComponents } from './captureStore.js';

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
