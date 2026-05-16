// Tests for `<CaptureTextInput>` — the moderator's controlled-textarea
// capture-pane statement-wording input.
//
// Refinement: tasks/refinements/moderator-ui/mod_capture_text_input.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   1. Stable testid surface (`capture-text-input`,
//      `capture-text-input-label`, `capture-text-input-textarea`,
//      `capture-text-input-helper`) so downstream tasks and the
//      Playwright spec can locate the component without scraping store
//      internals.
//   2. Localized label / aria-label / placeholder / helper resolve in
//      every v1 locale — the moderator.captureTextInput.* namespace
//      ships with pt-BR + es-419 drafts flagged PENDING.
//   3. Shared-store read/write — the slice is the wire that
//      `mod_propose_action` will read from; the textarea is the first
//      writer on `useCaptureStore.text`.
//   4. Cap behaviour — `maxLength` at the input boundary and a
//      defensive `slice(0, MAX)` clamp on paste-bypass.
//   5. Submit gesture — Cmd/Ctrl+Enter fires `onSubmit` exactly once
//      and `e.preventDefault()` so no newline is inserted; plain
//      Enter does NOT fire `onSubmit` and the browser's native
//      newline behavior is preserved.
//   6. No auto-focus on mount — the operate route is multi-pane; the
//      textarea should not steal focus from any pre-existing keyboard
//      activity.
//   7. Cmd/Ctrl+Enter does NOT call `reset()` — the draft survives
//      the gesture so the moderator can retry on a failed propose.
//   8. Helper count reflects the raw store value (including leading
//      / trailing whitespace) so the moderator's running-count
//      reading is closer-to-the-textarea than a trim-aware count
//      would be.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { MAX_METHODOLOGY_TEXT_LENGTH } from '@a-conversa/shared-types';

import { CaptureTextInput } from './CaptureTextInput';
import { useCaptureStore } from '../stores/captureStore';
import { initI18n } from '../i18n';

const EN_LABEL = 'Statement wording';
const EN_PLACEHOLDER = 'Type the statement wording here…';
const EN_ARIA_LABEL = 'Compose the wording for a new statement to propose to the debate';

beforeEach(async () => {
  // Reset the capture store to its documented default so each test
  // starts from an empty `text` slice. `reset()` returns every slice
  // to the initial-state object.
  useCaptureStore.getState().reset();
  await initI18n('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('CaptureTextInput — controlled-textarea capture-pane wording input', () => {
  it('renders the component with all four stable testids', () => {
    render(<CaptureTextInput />);
    expect(screen.getByTestId('capture-text-input')).toBeTruthy();
    expect(screen.getByTestId('capture-text-input-label')).toBeTruthy();
    expect(screen.getByTestId('capture-text-input-textarea')).toBeTruthy();
    expect(screen.getByTestId('capture-text-input-helper')).toBeTruthy();
  });

  it('resolves the localized label, placeholder, aria-label, and helper', () => {
    render(<CaptureTextInput />);
    const label = screen.getByTestId('capture-text-input-label');
    expect(label.textContent).toBe(EN_LABEL);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    expect(textarea.getAttribute('placeholder')).toBe(EN_PLACEHOLDER);
    expect(textarea.getAttribute('aria-label')).toBe(EN_ARIA_LABEL);
    // The helper interpolates `{used}/{max}` via ICU.
    expect(screen.getByTestId('capture-text-input-helper').textContent).toBe('0/10000 characters');
  });

  it('wires the visible label to the textarea via htmlFor/id', () => {
    render(<CaptureTextInput />);
    const label = screen.getByTestId('capture-text-input-label');
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    expect(label.getAttribute('for')).toBe('capture-text-input');
    expect(textarea.getAttribute('id')).toBe('capture-text-input');
  });

  it('wires aria-describedby to the helper region', () => {
    render(<CaptureTextInput />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    const helper = screen.getByTestId('capture-text-input-helper');
    expect(textarea.getAttribute('aria-describedby')).toBe('capture-text-input-helper');
    expect(helper.getAttribute('id')).toBe('capture-text-input-helper');
  });

  it('reads the textarea value from the store on mount', () => {
    act(() => {
      useCaptureStore.getState().setText('pre-existing draft');
    });
    render(<CaptureTextInput />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    expect(textarea.value).toBe('pre-existing draft');
    expect(screen.getByTestId('capture-text-input-helper').textContent).toBe('18/10000 characters');
  });

  it('writes to the store on every change event', () => {
    render(<CaptureTextInput />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    fireEvent.change(textarea, { target: { value: 'hello world' } });
    expect(useCaptureStore.getState().text).toBe('hello world');
    expect(textarea.value).toBe('hello world');
  });

  it('updates the textarea when the store is mutated programmatically', () => {
    render(<CaptureTextInput />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    expect(textarea.value).toBe('');
    act(() => {
      useCaptureStore.getState().setText('programmatic write');
    });
    expect(textarea.value).toBe('programmatic write');
  });

  it('clears the textarea when the store is reset', () => {
    render(<CaptureTextInput />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    fireEvent.change(textarea, { target: { value: 'in-progress' } });
    expect(textarea.value).toBe('in-progress');
    act(() => {
      useCaptureStore.getState().reset();
    });
    expect(textarea.value).toBe('');
    expect(screen.getByTestId('capture-text-input-helper').textContent).toBe('0/10000 characters');
  });

  it('sets maxLength to MAX_METHODOLOGY_TEXT_LENGTH (10_000)', () => {
    render(<CaptureTextInput />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    expect(textarea.maxLength).toBe(MAX_METHODOLOGY_TEXT_LENGTH);
    expect(MAX_METHODOLOGY_TEXT_LENGTH).toBe(10_000);
  });

  it('defensively clamps a paste that exceeds the cap', () => {
    render(<CaptureTextInput />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    // Some browsers fire `input` with a value longer than `maxLength`
    // when the user pastes; the change handler's `slice` clamps the
    // slice's invariant either way.
    const overflow = 'a'.repeat(MAX_METHODOLOGY_TEXT_LENGTH + 1);
    fireEvent.change(textarea, { target: { value: overflow } });
    expect(useCaptureStore.getState().text.length).toBe(MAX_METHODOLOGY_TEXT_LENGTH);
    expect(useCaptureStore.getState().text).toBe('a'.repeat(MAX_METHODOLOGY_TEXT_LENGTH));
  });

  it('writes the helper count using the raw (untrimmed) text length', () => {
    render(<CaptureTextInput />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    fireEvent.change(textarea, { target: { value: '  hello  ' } });
    expect(screen.getByTestId('capture-text-input-helper').textContent).toBe('9/10000 characters');
  });

  it('shows the helper at the cap when the textarea holds the cap-length string', () => {
    act(() => {
      useCaptureStore.getState().setText('a'.repeat(MAX_METHODOLOGY_TEXT_LENGTH));
    });
    render(<CaptureTextInput />);
    expect(screen.getByTestId('capture-text-input-helper').textContent).toBe(
      '10000/10000 characters',
    );
  });

  it('fires onSubmit when the moderator presses Cmd+Enter', () => {
    const onSubmit = vi.fn();
    render(<CaptureTextInput onSubmit={onSubmit} />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('fires onSubmit when the moderator presses Ctrl+Enter', () => {
    const onSubmit = vi.fn();
    render(<CaptureTextInput onSubmit={onSubmit} />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onSubmit on plain Enter (newline gesture)', () => {
    const onSubmit = vi.fn();
    render(<CaptureTextInput onSubmit={onSubmit} />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: false, ctrlKey: false });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does NOT fire onSubmit on Shift+Enter (newline gesture, no modifier)', () => {
    const onSubmit = vi.fn();
    render(<CaptureTextInput onSubmit={onSubmit} />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls preventDefault on Cmd+Enter so no newline is inserted', () => {
    render(<CaptureTextInput onSubmit={() => undefined} />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    // `fireEvent.keyDown` returns whether the event's default was
    // NOT prevented (i.e. `true` means the listener did NOT call
    // `preventDefault`); a successful Cmd+Enter handler returns `false`.
    const allowedDefault = fireEvent.keyDown(textarea, {
      key: 'Enter',
      metaKey: true,
    });
    expect(allowedDefault).toBe(false);
  });

  it('does NOT call preventDefault on plain Enter (native newline runs)', () => {
    render(<CaptureTextInput />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    const allowedDefault = fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(allowedDefault).toBe(true);
  });

  it('does NOT reset the store on Cmd+Enter — the draft survives the gesture', () => {
    const onSubmit = vi.fn();
    render(<CaptureTextInput onSubmit={onSubmit} />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    fireEvent.change(textarea, { target: { value: 'unsubmitted draft' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(useCaptureStore.getState().text).toBe('unsubmitted draft');
  });

  it('treats onSubmit as optional — Cmd+Enter with no callback is a no-op', () => {
    render(<CaptureTextInput />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    // No callback supplied. The handler should still call
    // preventDefault but must not throw.
    expect(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    }).not.toThrow();
  });

  it('does not auto-focus the textarea on mount', () => {
    render(<CaptureTextInput />);
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    expect(document.activeElement).not.toBe(textarea);
  });

  it('is reachable via the labelled accessible name', () => {
    render(<CaptureTextInput />);
    // The visible `<label>` is the primary accessible name; the
    // `aria-label` carries the verbose secondary name.
    expect(screen.getByRole('textbox', { name: /Compose the wording/ })).toBeTruthy();
  });
});

describe('CaptureTextInput — i18n catalog parity', () => {
  const KEYS = [
    'moderator.captureTextInput.label',
    'moderator.captureTextInput.placeholder',
    'moderator.captureTextInput.ariaLabel',
    'moderator.captureTextInput.helper',
  ] as const;
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  for (const locale of LOCALES) {
    for (const key of KEYS) {
      it(`resolves ${key} to a non-empty string in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        const value = i18next.t(key);
        expect(value).toBeTruthy();
        expect(value).not.toBe(key);
        await i18next.changeLanguage('en-US');
      });
    }
  }
});
