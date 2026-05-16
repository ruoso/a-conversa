// Tests for `<DecomposeComponentTextInput>` — per-row textarea for the
// decompose-mode multi-component capture grid.
//
// Refinement: tasks/refinements/moderator-ui/mod_multi_component_capture.md
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// Locks in:
//   1. Typing into the textarea writes to the per-index slice.
//   2. The textarea's maxLength is MAX_METHODOLOGY_TEXT_LENGTH.
//   3. Per-row isolation — writing into row 0 does not bleed into row 1.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { MAX_METHODOLOGY_TEXT_LENGTH } from '@a-conversa/shared-types';

import { DecomposeComponentTextInput } from './DecomposeComponentTextInput';
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

describe('DecomposeComponentTextInput — per-row textarea binding', () => {
  it('typing into the textarea calls setDecomposeComponentText for the bound index', () => {
    render(<DecomposeComponentTextInput mode="decompose" index={0} />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('decompose-component-text-0');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    expect(useCaptureStore.getState().decomposeComponents[0]?.text).toBe('hello');
  });

  it('the textarea maxLength equals MAX_METHODOLOGY_TEXT_LENGTH', () => {
    render(<DecomposeComponentTextInput mode="decompose" index={0} />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('decompose-component-text-0');
    expect(textarea.maxLength).toBe(MAX_METHODOLOGY_TEXT_LENGTH);
  });

  it('the textarea aria-label resolves to "Component <index+1>" (en-US)', () => {
    render(<DecomposeComponentTextInput mode="decompose" index={0} />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('decompose-component-text-0');
    expect(textarea.getAttribute('aria-label')).toBe('Component 1');
  });

  it('per-row isolation — writing to row 0 does not change row 1', () => {
    render(
      <>
        <DecomposeComponentTextInput mode="decompose" index={0} />
        <DecomposeComponentTextInput mode="decompose" index={1} />
      </>,
    );
    const row0 = screen.getByTestId<HTMLTextAreaElement>('decompose-component-text-0');
    const row1 = screen.getByTestId<HTMLTextAreaElement>('decompose-component-text-1');
    fireEvent.change(row0, { target: { value: 'first' } });
    fireEvent.change(row1, { target: { value: 'second' } });
    expect(useCaptureStore.getState().decomposeComponents[0]?.text).toBe('first');
    expect(useCaptureStore.getState().decomposeComponents[1]?.text).toBe('second');
    expect(row0.value).toBe('first');
    expect(row1.value).toBe('second');
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
describe('DecomposeComponentTextInput — mode="interpretive-split"', () => {
  beforeEach(() => {
    act(() => {
      useCaptureStore.getState().reset();
      useCaptureStore.getState().enterInterpretiveSplitMode('n1');
    });
  });

  it('reads from / writes to the interpretiveSplitReadings slice via the per-mode setter', () => {
    render(<DecomposeComponentTextInput mode="interpretive-split" index={0} />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('interpretive-split-reading-text-0');
    fireEvent.change(textarea, { target: { value: 'hello reading' } });
    expect(useCaptureStore.getState().interpretiveSplitReadings[0]?.text).toBe('hello reading');
  });

  it('aria-label resolves to "Reading <index+1>" (en-US)', () => {
    render(<DecomposeComponentTextInput mode="interpretive-split" index={0} />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('interpretive-split-reading-text-0');
    expect(textarea.getAttribute('aria-label')).toBe('Reading 1');
  });
});
