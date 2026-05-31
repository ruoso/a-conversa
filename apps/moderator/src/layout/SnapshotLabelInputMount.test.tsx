// Tests for `<SnapshotLabelInputMount>` — the open-flag-driven mount
// wrapper for the F10 snapshot-label modal.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_label_input.md
//
// Per ADR 0022. Locks in:
//   (a) Renders nothing when `isLabelInputOpen=false`.
//   (b) Renders the modal when `isLabelInputOpen=true`.
//   (c) Unmounts the modal when the flag flips back to false.
//
// The modal itself is stubbed — its render shape and behavior are
// covered by `SnapshotLabelInputModal.test.tsx`. This file only
// exercises the boolean subscription / conditional render contract.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('./SnapshotLabelInputModal', () => ({
  SnapshotLabelInputModal: () => <div data-testid="snapshot-label-input-modal-stub" />,
}));

import { SnapshotLabelInputMount } from './SnapshotLabelInputMount';
import { resetSnapshotFlowStore, useSnapshotFlowStore } from './useSnapshotFlowStore';

beforeEach(() => {
  resetSnapshotFlowStore();
});

afterEach(() => {
  cleanup();
  resetSnapshotFlowStore();
});

describe('SnapshotLabelInputMount — subscription contract', () => {
  it('(a) renders nothing when isLabelInputOpen=false', () => {
    render(<SnapshotLabelInputMount />);
    expect(screen.queryByTestId('snapshot-label-input-modal-stub')).toBeNull();
  });

  it('(b) renders the modal when isLabelInputOpen=true', () => {
    act(() => {
      useSnapshotFlowStore.getState().open();
    });
    render(<SnapshotLabelInputMount />);
    expect(screen.getByTestId('snapshot-label-input-modal-stub')).toBeTruthy();
  });

  it('(c) unmounts the modal when the flag flips back to false', () => {
    act(() => {
      useSnapshotFlowStore.getState().open();
    });
    render(<SnapshotLabelInputMount />);
    expect(screen.queryByTestId('snapshot-label-input-modal-stub')).not.toBeNull();
    act(() => {
      useSnapshotFlowStore.getState().close();
    });
    expect(screen.queryByTestId('snapshot-label-input-modal-stub')).toBeNull();
  });

  it('toggling the flag multiple times mounts/unmounts the modal each time', () => {
    render(<SnapshotLabelInputMount />);
    expect(screen.queryByTestId('snapshot-label-input-modal-stub')).toBeNull();
    act(() => {
      useSnapshotFlowStore.getState().open();
    });
    expect(screen.queryByTestId('snapshot-label-input-modal-stub')).not.toBeNull();
    act(() => {
      useSnapshotFlowStore.getState().close();
    });
    expect(screen.queryByTestId('snapshot-label-input-modal-stub')).toBeNull();
    act(() => {
      useSnapshotFlowStore.getState().open();
    });
    expect(screen.queryByTestId('snapshot-label-input-modal-stub')).not.toBeNull();
  });
});
