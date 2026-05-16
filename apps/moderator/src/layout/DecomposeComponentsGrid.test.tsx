// Tests for `<DecomposeComponentsGrid>` — the multi-component capture
// grid for the F2 decompose flow.
//
// Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// Locks in:
//   1. Render gating on `mode === 'decompose'`.
//   2. Two-row initial mount via `enterDecomposeMode`.
//   3. "Add component" appends one row; disabled at the maximum.
//   4. Per-row remove buttons disabled at the minimum, enabled above.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { DecomposeComponentsGrid } from './DecomposeComponentsGrid';
import { useCaptureStore } from '../stores/captureStore';
import { initI18n } from '../i18n';

beforeEach(async () => {
  useCaptureStore.getState().reset();
  await initI18n('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('DecomposeComponentsGrid — render gating', () => {
  it('renders null when mode === "idle" (no grid in the DOM)', () => {
    render(<DecomposeComponentsGrid mode="decompose" />);
    expect(screen.queryByTestId('decompose-components-grid')).toBeNull();
  });

  it('renders the grid with two rows after enterDecomposeMode', () => {
    act(() => {
      useCaptureStore.getState().enterDecomposeMode('n1');
    });
    render(<DecomposeComponentsGrid mode="decompose" />);
    expect(screen.getByTestId('decompose-components-grid')).toBeTruthy();
    expect(screen.getByTestId('decompose-component-row-0')).toBeTruthy();
    expect(screen.getByTestId('decompose-component-row-1')).toBeTruthy();
    expect(screen.queryByTestId('decompose-component-row-2')).toBeNull();
  });
});

describe('DecomposeComponentsGrid — add / remove row gating', () => {
  it('clicking "Add component" appends one row', () => {
    act(() => {
      useCaptureStore.getState().enterDecomposeMode('n1');
    });
    render(<DecomposeComponentsGrid mode="decompose" />);
    fireEvent.click(screen.getByTestId('decompose-components-add-row'));
    expect(screen.getByTestId('decompose-component-row-2')).toBeTruthy();
  });

  it('the "Add component" button is disabled when the grid is at the maximum 10 rows', () => {
    act(() => {
      useCaptureStore.getState().enterDecomposeMode('n1');
      for (let i = 0; i < 8; i += 1) {
        useCaptureStore.getState().addDecomposeComponent();
      }
    });
    render(<DecomposeComponentsGrid mode="decompose" />);
    const addButton = screen.getByTestId<HTMLButtonElement>('decompose-components-add-row');
    expect(addButton.disabled).toBe(true);
    expect(useCaptureStore.getState().decomposeComponents).toHaveLength(10);
  });

  it('per-row remove buttons are disabled at 2 rows; enabled at 3+ rows', () => {
    act(() => {
      useCaptureStore.getState().enterDecomposeMode('n1');
    });
    const { rerender } = render(<DecomposeComponentsGrid mode="decompose" />);
    expect(screen.getByTestId<HTMLButtonElement>('decompose-component-row-remove-0').disabled).toBe(
      true,
    );
    expect(screen.getByTestId<HTMLButtonElement>('decompose-component-row-remove-1').disabled).toBe(
      true,
    );

    act(() => {
      useCaptureStore.getState().addDecomposeComponent();
    });
    rerender(<DecomposeComponentsGrid mode="decompose" />);
    expect(screen.getByTestId<HTMLButtonElement>('decompose-component-row-remove-0').disabled).toBe(
      false,
    );
    expect(screen.getByTestId<HTMLButtonElement>('decompose-component-row-remove-2').disabled).toBe(
      false,
    );
  });

  it('clicking a per-row remove button on row index 1 of a 3-row grid drops the row at index 1 (later rows shift up)', () => {
    act(() => {
      useCaptureStore.getState().enterDecomposeMode('n1');
      useCaptureStore.getState().addDecomposeComponent(); // length === 3
      useCaptureStore.getState().setDecomposeComponentText(0, 'row-0');
      useCaptureStore.getState().setDecomposeComponentText(1, 'row-1');
      useCaptureStore.getState().setDecomposeComponentText(2, 'row-2');
    });
    render(<DecomposeComponentsGrid mode="decompose" />);
    fireEvent.click(screen.getByTestId('decompose-component-row-remove-1'));
    const state = useCaptureStore.getState();
    expect(state.decomposeComponents).toHaveLength(2);
    expect(state.decomposeComponents[0]?.text).toBe('row-0');
    expect(state.decomposeComponents[1]?.text).toBe('row-2');
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
//
// The grid is parameterised by `mode`; under `mode="interpretive-split"`
// the per-mode `data-testid`s + per-mode store reads switch.
describe('DecomposeComponentsGrid — mode="interpretive-split" (mod_interpretive_split_mode)', () => {
  it('renders null when mode !== interpretive-split', () => {
    render(<DecomposeComponentsGrid mode="interpretive-split" />);
    expect(screen.queryByTestId('interpretive-split-readings-grid')).toBeNull();
  });

  it('renders the interpretive-split readings grid with the per-mode testids when mode === interpretive-split', () => {
    act(() => {
      useCaptureStore.getState().enterInterpretiveSplitMode('n1');
    });
    render(<DecomposeComponentsGrid mode="interpretive-split" />);
    expect(screen.getByTestId('interpretive-split-readings-grid')).toBeTruthy();
    expect(screen.getByTestId('interpretive-split-reading-row-0')).toBeTruthy();
    expect(screen.getByTestId('interpretive-split-reading-row-1')).toBeTruthy();
    // The decompose-side testids are NOT present under this mode.
    expect(screen.queryByTestId('decompose-components-grid')).toBeNull();
  });

  it('the "Add reading" button has the per-mode testid and appends one row', () => {
    act(() => {
      useCaptureStore.getState().enterInterpretiveSplitMode('n1');
    });
    render(<DecomposeComponentsGrid mode="interpretive-split" />);
    fireEvent.click(screen.getByTestId('interpretive-split-readings-add-row'));
    expect(screen.getByTestId('interpretive-split-reading-row-2')).toBeTruthy();
  });

  it('per-row remove buttons disabled at the minimum 2 rows; the per-mode testid is used', () => {
    act(() => {
      useCaptureStore.getState().enterInterpretiveSplitMode('n1');
    });
    render(<DecomposeComponentsGrid mode="interpretive-split" />);
    expect(
      screen.getByTestId<HTMLButtonElement>('interpretive-split-reading-row-remove-0').disabled,
    ).toBe(true);
    expect(
      screen.getByTestId<HTMLButtonElement>('interpretive-split-reading-row-remove-1').disabled,
    ).toBe(true);
  });
});
