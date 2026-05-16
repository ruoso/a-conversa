// Tests for `useCaptureStore` — decompose-mode slice + coordination
// helpers.
//
// Refinement: tasks/refinements/moderator-ui/mod_decompose_mode.md
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// The store-shape smoke cases (default values + simple setters + the
// React re-render probe) live in `stores.test.tsx` — that file is the
// historical home for the `mod_state_management` cover. This file
// focuses on the decompose-mode-specific seams the
// `mod_decompose_mode` task adds: the `decomposeTargetNodeId` slice +
// the `enterDecomposeMode` / `exitDecomposeMode` coordination helpers
// + the F1-coupling clear documented in Decision §6 of the refinement.

import { beforeEach, describe, expect, it } from 'vitest';

import { useCaptureStore } from './captureStore.js';

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
