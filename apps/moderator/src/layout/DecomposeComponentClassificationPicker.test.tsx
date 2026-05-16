// Tests for `<DecomposeComponentClassificationPicker>` — per-row
// classification picker for the decompose-mode multi-component capture
// grid.
//
// Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// Locks in:
//   1. Clicking a kind button writes to the per-index slice.
//   2. Re-clicking the selected kind toggles it off (null).
//   3. aria-pressed reflects the per-row selection state.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { DecomposeComponentClassificationPicker } from './DecomposeComponentClassificationPicker';
import { useCaptureStore } from '../stores/captureStore';
import { initI18n } from '../i18n';

beforeEach(async () => {
  useCaptureStore.getState().reset();
  await initI18n('en-US');
  await i18next.changeLanguage('en-US');
  act(() => {
    useCaptureStore.getState().enterDecomposeMode('n1');
  });
});

afterEach(() => {
  cleanup();
});

describe('DecomposeComponentClassificationPicker — per-row binding', () => {
  it('renders five buttons over METHODOLOGY_KINDS for the bound index', () => {
    render(<DecomposeComponentClassificationPicker index={0} />);
    for (const kind of ['fact', 'predictive', 'value', 'normative', 'definitional']) {
      expect(
        screen.getByTestId(`decompose-component-classification-0-button-${kind}`),
      ).toBeTruthy();
    }
  });

  it('initial aria-pressed is "false" on every button (slice classification === null)', () => {
    render(<DecomposeComponentClassificationPicker index={0} />);
    for (const kind of ['fact', 'predictive', 'value', 'normative', 'definitional']) {
      const button = screen.getByTestId(`decompose-component-classification-0-button-${kind}`);
      expect(button.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('clicking the "fact" button calls setDecomposeComponentClassification(index, "fact")', () => {
    render(<DecomposeComponentClassificationPicker index={0} />);
    fireEvent.click(screen.getByTestId('decompose-component-classification-0-button-fact'));
    expect(useCaptureStore.getState().decomposeComponents[0]?.classification).toBe('fact');
  });

  it('re-clicking the currently selected kind toggles it off (null)', () => {
    render(<DecomposeComponentClassificationPicker index={0} />);
    const factButton = screen.getByTestId('decompose-component-classification-0-button-fact');
    fireEvent.click(factButton);
    expect(useCaptureStore.getState().decomposeComponents[0]?.classification).toBe('fact');
    fireEvent.click(factButton);
    expect(useCaptureStore.getState().decomposeComponents[0]?.classification).toBeNull();
  });

  it('clicking a different kind after one is selected switches the selection (single-select)', () => {
    render(<DecomposeComponentClassificationPicker index={0} />);
    fireEvent.click(screen.getByTestId('decompose-component-classification-0-button-fact'));
    fireEvent.click(screen.getByTestId('decompose-component-classification-0-button-value'));
    expect(useCaptureStore.getState().decomposeComponents[0]?.classification).toBe('value');
  });

  it('per-row isolation — clicking row 0\'s "fact" does NOT change row 1\'s classification', () => {
    render(
      <>
        <DecomposeComponentClassificationPicker index={0} />
        <DecomposeComponentClassificationPicker index={1} />
      </>,
    );
    fireEvent.click(screen.getByTestId('decompose-component-classification-0-button-fact'));
    const state = useCaptureStore.getState();
    expect(state.decomposeComponents[0]?.classification).toBe('fact');
    expect(state.decomposeComponents[1]?.classification).toBeNull();
  });
});
