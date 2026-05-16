// Tests for `<DecomposeComponentRow>` — one row of the decompose-mode
// multi-component capture grid.
//
// Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// Locks in:
//   1. The localized row label resolves to "Component <index+1>" in en-US.
//   2. The row composes the text input + the picker + the remove button.
//   3. Clicking the remove button calls the supplied onRemove prop.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { DecomposeComponentRow } from './DecomposeComponentRow';
import { useCaptureStore } from '../stores/captureStore';
import { createI18nInstance } from '@a-conversa/shell';

beforeEach(async () => {
  useCaptureStore.getState().reset();
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
  // Seed two rows so per-row reads inside the text input + picker have
  // a slice to bind to.
  act(() => {
    useCaptureStore.getState().enterDecomposeMode('n1');
  });
});

afterEach(() => {
  cleanup();
});

describe('DecomposeComponentRow — render shape', () => {
  it('renders the localized row label "Component 1" for index 0 in en-US', () => {
    render(
      <DecomposeComponentRow
        mode="decompose"
        index={0}
        canRemove={false}
        onRemove={() => undefined}
      />,
    );
    expect(screen.getByTestId('decompose-component-row-label-0').textContent).toBe('Component 1');
  });

  it('renders the text input + the picker + the remove button as children', () => {
    render(
      <DecomposeComponentRow
        mode="decompose"
        index={0}
        canRemove={true}
        onRemove={() => undefined}
      />,
    );
    expect(screen.getByTestId('decompose-component-row-0')).toBeTruthy();
    expect(screen.getByTestId('decompose-component-text-0')).toBeTruthy();
    expect(screen.getByTestId('decompose-component-classification-0')).toBeTruthy();
    expect(screen.getByTestId('decompose-component-row-remove-0')).toBeTruthy();
  });

  it('clicking the remove button calls the supplied onRemove prop', () => {
    const onRemove = vi.fn();
    render(
      <DecomposeComponentRow mode="decompose" index={1} canRemove={true} onRemove={onRemove} />,
    );
    fireEvent.click(screen.getByTestId('decompose-component-row-remove-1'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('the remove button is disabled when canRemove === false', () => {
    render(
      <DecomposeComponentRow
        mode="decompose"
        index={0}
        canRemove={false}
        onRemove={() => undefined}
      />,
    );
    const button = screen.getByTestId<HTMLButtonElement>('decompose-component-row-remove-0');
    expect(button.disabled).toBe(true);
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
describe('DecomposeComponentRow — mode="interpretive-split"', () => {
  beforeEach(() => {
    // Seed the interpretive-split slice instead so per-row reads bind.
    act(() => {
      useCaptureStore.getState().reset();
      useCaptureStore.getState().enterInterpretiveSplitMode('n1');
    });
  });

  it('renders the localized row label "Reading 1" for index 0 in en-US', () => {
    render(
      <DecomposeComponentRow
        mode="interpretive-split"
        index={0}
        canRemove={false}
        onRemove={() => undefined}
      />,
    );
    expect(screen.getByTestId('interpretive-split-reading-row-label-0').textContent).toBe(
      'Reading 1',
    );
  });

  it('renders the text input + the picker + the remove button with per-mode testids', () => {
    render(
      <DecomposeComponentRow
        mode="interpretive-split"
        index={0}
        canRemove={true}
        onRemove={() => undefined}
      />,
    );
    expect(screen.getByTestId('interpretive-split-reading-row-0')).toBeTruthy();
    expect(screen.getByTestId('interpretive-split-reading-text-0')).toBeTruthy();
    expect(screen.getByTestId('interpretive-split-reading-classification-0')).toBeTruthy();
    expect(screen.getByTestId('interpretive-split-reading-row-remove-0')).toBeTruthy();
  });
});
