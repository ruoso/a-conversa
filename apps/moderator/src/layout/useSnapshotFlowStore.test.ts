// Tests for `useSnapshotFlowStore` — the module-scoped Zustand slice
// that gates the F10 snapshot-label modal.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_action.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   - initial state has `isLabelInputOpen === false`,
//   - `open()` flips it true,
//   - `close()` flips it back,
//   - `open()` is idempotent — a second call leaves the slice equal
//     by reference (no state churn),
//   - `close()` is idempotent — same reference-equality contract.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetSnapshotFlowStore, useSnapshotFlowStore } from './useSnapshotFlowStore';

beforeEach(() => {
  resetSnapshotFlowStore();
});

afterEach(() => {
  resetSnapshotFlowStore();
});

describe('useSnapshotFlowStore', () => {
  it('initial state has isLabelInputOpen === false', () => {
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
  });

  it('open() flips isLabelInputOpen to true', () => {
    useSnapshotFlowStore.getState().open();
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
  });

  it('close() flips isLabelInputOpen back to false after an open()', () => {
    useSnapshotFlowStore.getState().open();
    useSnapshotFlowStore.getState().close();
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
  });

  it('open() is idempotent — calling twice in a row leaves the state reference unchanged on the second call', () => {
    useSnapshotFlowStore.getState().open();
    const after1 = useSnapshotFlowStore.getState();
    useSnapshotFlowStore.getState().open();
    const after2 = useSnapshotFlowStore.getState();
    expect(after2.isLabelInputOpen).toBe(true);
    // Identity check: the no-op branch returns the same `state`
    // object so subscribers observe no spurious update.
    expect(after2).toBe(after1);
  });

  it('close() is idempotent when already closed — state reference unchanged', () => {
    const before = useSnapshotFlowStore.getState();
    useSnapshotFlowStore.getState().close();
    const after = useSnapshotFlowStore.getState();
    expect(after.isLabelInputOpen).toBe(false);
    expect(after).toBe(before);
  });

  it('open() → close() → open() cycles cleanly', () => {
    useSnapshotFlowStore.getState().open();
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
    useSnapshotFlowStore.getState().close();
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
    useSnapshotFlowStore.getState().open();
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
  });
});
