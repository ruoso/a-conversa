// Tests for `<ClassificationPalette>` — the moderator's horizontal
// button row + keyboard shortcuts for statement classification.
//
// Refinement: tasks/refinements/moderator-ui/mod_classification_palette.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   1. Stable testid surface (wrapper, per-kind button, per-kind key
//      chip, shortcut-hint helper) so downstream tasks and the
//      Playwright spec can locate the component without scraping store
//      internals.
//   2. Canonical iteration order — buttons render in `METHODOLOGY_KINDS`
//      order so the moderator's mental model + the keymap-help overlay
//      see the same layout.
//   3. Localized labels resolve from `methodology.kind.<kind>` in every
//      v1 locale; the palette chrome resolves from
//      `moderator.classificationPalette.*`.
//   4. Store wiring — `aria-pressed` reflects the slice; clicks write
//      the slice; the toggle-off-on-re-click idiom from Decision §4.
//   5. Keyboard wiring — `f` / `p` / `v` / `n` / `d` write the slice;
//      modifier-bail / editable-target / repeat-skip guards hold; the
//      no-op-on-re-press asymmetry from Decision §4.
//   6. Listener cleanup on unmount — no leaks after the component
//      detaches.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import { act, type ReactElement } from 'react';
import i18next from 'i18next';

import { ClassificationPalette } from './ClassificationPalette';
import { CaptureTextInput } from './CaptureTextInput';
import { useCaptureStore } from '../stores/captureStore';
import { createI18nInstance } from '@a-conversa/shell';

// Local `render(...)` shadow that wraps every `render` in an `act(...)`
// block. `useTranslation()` schedules a microtask-deferred setState when
// its internal i18next subscription registers on mount. The deferred
// update fires AFTER the synchronous render's act() wrapper closes, so
// React emits "An update to <Component> was not wrapped in act(...)".
// `await act(async () => { ... })` flushes pending microtasks before the
// act block resolves, absorbing the deferred update inside the wrapper.
async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
  // `act` takes the async (microtask-flushing) path when the callback
  // returns a thenable — `return Promise.resolve()` is enough; no
  // `async` keyword (which would trip `require-await` since the body
  // does not await anything).
  await act(() => {
    result = rtlRender(ui, options);
    return Promise.resolve();
  });
  return result;
}

const EN_KIND_LABELS: Record<string, string> = {
  fact: 'Fact',
  predictive: 'Predictive',
  value: 'Value',
  normative: 'Normative',
  definitional: 'Definitional',
};

const EN_SHORTCUT_KEYS: Record<string, string> = {
  fact: 'F',
  predictive: 'P',
  value: 'V',
  normative: 'N',
  definitional: 'D',
};

const CANONICAL_ORDER = ['fact', 'predictive', 'value', 'normative', 'definitional'] as const;

beforeEach(async () => {
  useCaptureStore.getState().reset();
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('ClassificationPalette — render structure', () => {
  it('renders the wrapper, five buttons, five key chips, and the shortcut hint', async () => {
    await render(<ClassificationPalette />);
    expect(screen.getByTestId('classification-palette')).toBeTruthy();
    for (const kind of CANONICAL_ORDER) {
      expect(screen.getByTestId(`classification-palette-button-${kind}`)).toBeTruthy();
      expect(screen.getByTestId(`classification-palette-key-chip-${kind}`)).toBeTruthy();
    }
    expect(screen.getByTestId('classification-palette-shortcut-hint')).toBeTruthy();
  });

  it('renders the labelled `group` role for the buttons', async () => {
    await render(<ClassificationPalette />);
    expect(screen.getByRole('group', { name: /Statement classification/ })).toBeTruthy();
  });

  it('renders all five buttons in the canonical METHODOLOGY_KINDS order', async () => {
    await render(<ClassificationPalette />);
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-testid^="classification-palette-button-"]',
      ),
    );
    expect(buttons.map((b) => b.getAttribute('data-kind'))).toEqual([...CANONICAL_ORDER]);
  });

  it('each button has type="button" so it never accidentally submits a wrapping form', async () => {
    await render(<ClassificationPalette />);
    for (const kind of CANONICAL_ORDER) {
      const btn = screen.getByTestId<HTMLButtonElement>(`classification-palette-button-${kind}`);
      expect(btn.getAttribute('type')).toBe('button');
    }
  });

  it("each button's visible label is the localized methodology.kind.<kind> string", async () => {
    await render(<ClassificationPalette />);
    for (const kind of CANONICAL_ORDER) {
      const btn = screen.getByTestId<HTMLButtonElement>(`classification-palette-button-${kind}`);
      expect(btn.textContent).toContain(EN_KIND_LABELS[kind]);
    }
  });

  it("each button's key chip is the uppercase mnemonic", async () => {
    await render(<ClassificationPalette />);
    for (const kind of CANONICAL_ORDER) {
      const chip = screen.getByTestId(`classification-palette-key-chip-${kind}`);
      expect(chip.textContent).toBe(EN_SHORTCUT_KEYS[kind]);
    }
  });

  it("each button's aria-label composes the localized label and key", async () => {
    await render(<ClassificationPalette />);
    for (const kind of CANONICAL_ORDER) {
      const btn = screen.getByTestId<HTMLButtonElement>(`classification-palette-button-${kind}`);
      expect(btn.getAttribute('aria-label')).toBe(
        `${EN_KIND_LABELS[kind]} (${EN_SHORTCUT_KEYS[kind]})`,
      );
    }
  });

  it('exposes each button via its composed accessible name', async () => {
    await render(<ClassificationPalette />);
    expect(screen.getByRole('button', { name: /Fact \(F\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Predictive \(P\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Value \(V\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Normative \(N\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Definitional \(D\)/ })).toBeTruthy();
  });

  it('renders the shortcut hint text', async () => {
    await render(<ClassificationPalette />);
    expect(screen.getByTestId('classification-palette-shortcut-hint').textContent).toBe(
      'Or press F / P / V / N / D',
    );
  });
});

describe('ClassificationPalette — store wiring (click)', () => {
  it('aria-pressed reflects the store on mount when a kind is pre-selected', async () => {
    act(() => {
      useCaptureStore.getState().setClassification('value');
    });
    await render(<ClassificationPalette />);
    expect(
      screen.getByTestId('classification-palette-button-value').getAttribute('aria-pressed'),
    ).toBe('true');
    for (const kind of CANONICAL_ORDER) {
      if (kind === 'value') continue;
      expect(
        screen.getByTestId(`classification-palette-button-${kind}`).getAttribute('aria-pressed'),
      ).toBe('false');
    }
  });

  it('click on an unselected button writes the slice', async () => {
    await render(<ClassificationPalette />);
    fireEvent.click(screen.getByTestId('classification-palette-button-predictive'));
    expect(useCaptureStore.getState().classification).toBe('predictive');
    expect(
      screen.getByTestId('classification-palette-button-predictive').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('click on the currently-selected button toggles off (Decision §4)', async () => {
    act(() => {
      useCaptureStore.getState().setClassification('fact');
    });
    await render(<ClassificationPalette />);
    fireEvent.click(screen.getByTestId('classification-palette-button-fact'));
    expect(useCaptureStore.getState().classification).toBeNull();
    for (const kind of CANONICAL_ORDER) {
      expect(
        screen.getByTestId(`classification-palette-button-${kind}`).getAttribute('aria-pressed'),
      ).toBe('false');
    }
  });

  it('clicking a different button switches the selection', async () => {
    act(() => {
      useCaptureStore.getState().setClassification('fact');
    });
    await render(<ClassificationPalette />);
    fireEvent.click(screen.getByTestId('classification-palette-button-value'));
    expect(useCaptureStore.getState().classification).toBe('value');
    expect(
      screen.getByTestId('classification-palette-button-fact').getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      screen.getByTestId('classification-palette-button-value').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('reset() returns every button to aria-pressed=false', async () => {
    await render(<ClassificationPalette />);
    fireEvent.click(screen.getByTestId('classification-palette-button-value'));
    expect(useCaptureStore.getState().classification).toBe('value');
    act(() => {
      useCaptureStore.getState().reset();
    });
    for (const kind of CANONICAL_ORDER) {
      expect(
        screen.getByTestId(`classification-palette-button-${kind}`).getAttribute('aria-pressed'),
      ).toBe('false');
    }
  });

  it('updates aria-pressed when the store is mutated programmatically', async () => {
    await render(<ClassificationPalette />);
    expect(
      screen.getByTestId('classification-palette-button-normative').getAttribute('aria-pressed'),
    ).toBe('false');
    act(() => {
      useCaptureStore.getState().setClassification('normative');
    });
    expect(
      screen.getByTestId('classification-palette-button-normative').getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('ClassificationPalette — store wiring (keyboard shortcut)', () => {
  it('pressing `f` writes the fact kind', async () => {
    await render(<ClassificationPalette />);
    fireEvent.keyDown(document, { key: 'f' });
    expect(useCaptureStore.getState().classification).toBe('fact');
  });

  it('routes every kind shortcut to its matching kind', async () => {
    await render(<ClassificationPalette />);
    for (const kind of CANONICAL_ORDER) {
      act(() => {
        useCaptureStore.getState().setClassification(null);
      });
      const upper = EN_SHORTCUT_KEYS[kind];
      if (upper === undefined) throw new Error(`missing shortcut for ${kind}`);
      fireEvent.keyDown(document, { key: upper.toLowerCase() });
      expect(useCaptureStore.getState().classification).toBe(kind);
    }
  });

  it('is case-insensitive — uppercase `F` (shift held) still picks fact', async () => {
    await render(<ClassificationPalette />);
    fireEvent.keyDown(document, { key: 'F', shiftKey: true });
    expect(useCaptureStore.getState().classification).toBe('fact');
  });

  it('ignores `f` when focus is on a textarea (editable-target guard)', async () => {
    // Mount both the palette and the capture-text-input textarea
    // alongside one another, the same as the operate route's bottom
    // strip. The keymap module's guard fires from the textarea's focus.
    await render(
      <>
        <CaptureTextInput />
        <ClassificationPalette />
      </>,
    );
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    fireEvent.keyDown(document, { key: 'f' });
    expect(useCaptureStore.getState().classification).toBeNull();
  });

  it('ignores `f` when metaKey is held (Cmd+F passes through)', async () => {
    await render(<ClassificationPalette />);
    fireEvent.keyDown(document, { key: 'f', metaKey: true });
    expect(useCaptureStore.getState().classification).toBeNull();
  });

  it('ignores `f` when ctrlKey is held (Ctrl+F passes through)', async () => {
    await render(<ClassificationPalette />);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    expect(useCaptureStore.getState().classification).toBeNull();
  });

  it('ignores `f` when altKey is held (Alt+F passes through)', async () => {
    await render(<ClassificationPalette />);
    fireEvent.keyDown(document, { key: 'f', altKey: true });
    expect(useCaptureStore.getState().classification).toBeNull();
  });

  it('re-press of the currently-selected kind is a no-op (Decision §4)', async () => {
    act(() => {
      useCaptureStore.getState().setClassification('fact');
    });
    await render(<ClassificationPalette />);
    fireEvent.keyDown(document, { key: 'f' });
    expect(useCaptureStore.getState().classification).toBe('fact');
  });

  it('pressing a different kind shortcut while one is selected switches the slice', async () => {
    act(() => {
      useCaptureStore.getState().setClassification('fact');
    });
    await render(<ClassificationPalette />);
    fireEvent.keyDown(document, { key: 'v' });
    expect(useCaptureStore.getState().classification).toBe('value');
  });

  it('ignores auto-repeat keystrokes (event.repeat=true skipped)', async () => {
    await render(<ClassificationPalette />);
    fireEvent.keyDown(document, { key: 'f', repeat: true });
    expect(useCaptureStore.getState().classification).toBeNull();
  });

  it('ignores unmapped keys', async () => {
    await render(<ClassificationPalette />);
    fireEvent.keyDown(document, { key: 'q' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(useCaptureStore.getState().classification).toBeNull();
  });
});

describe('ClassificationPalette — listener lifecycle', () => {
  it('unmount detaches the listener — subsequent f does not write', async () => {
    const { unmount } = await render(<ClassificationPalette />);
    unmount();
    fireEvent.keyDown(document, { key: 'f' });
    expect(useCaptureStore.getState().classification).toBeNull();
  });

  it('re-mounting attaches a fresh listener', async () => {
    const { unmount } = await render(<ClassificationPalette />);
    unmount();
    fireEvent.keyDown(document, { key: 'f' });
    expect(useCaptureStore.getState().classification).toBeNull();

    await render(<ClassificationPalette />);
    fireEvent.keyDown(document, { key: 'v' });
    expect(useCaptureStore.getState().classification).toBe('value');
  });
});

describe('ClassificationPalette — i18n catalog parity', () => {
  const KEYS = [
    'moderator.classificationPalette.ariaLabel',
    'moderator.classificationPalette.legend',
    'moderator.classificationPalette.kindButtonAriaLabel',
    'moderator.classificationPalette.shortcutHint',
    'moderator.classificationPalette.unsetAria',
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

  it('per-locale parity: methodology.kind.<kind> resolves and no [t-missing] visible', async () => {
    for (const locale of LOCALES) {
      // `i18next.changeLanguage(...)` triggers `useTranslation()`'s
      // internal subscription to schedule a setState on every mounted
      // consumer. With `IS_REACT_ACT_ENVIRONMENT = true` this needs an
      // `act(...)` wrapper, otherwise React emits "An update to
      // ClassificationPalette ... was not wrapped in act(...)".
      await act(async () => {
        await i18next.changeLanguage(locale);
      });
      cleanup();
      await render(<ClassificationPalette />);
      const wrapper = screen.getByTestId('classification-palette');
      // No raw catalog-key string should appear in the DOM.
      expect(wrapper.textContent).not.toContain('moderator.classificationPalette');
      expect(wrapper.textContent).not.toContain('methodology.kind.');
      expect(wrapper.textContent).not.toContain('[t-missing]');
      // Each kind label resolves to its glossary value for the locale.
      for (const kind of CANONICAL_ORDER) {
        const glossary = i18next.t(`methodology.kind.${kind}`);
        const btn = screen.getByTestId(`classification-palette-button-${kind}`);
        expect(btn.textContent).toContain(String(glossary));
      }
    }
    await act(async () => {
      await i18next.changeLanguage('en-US');
    });
  });

  it('shortcut KEY is identical across locales (english-mnemonic policy)', async () => {
    for (const locale of LOCALES) {
      await act(async () => {
        await i18next.changeLanguage(locale);
      });
      cleanup();
      await render(<ClassificationPalette />);
      for (const kind of CANONICAL_ORDER) {
        const chip = screen.getByTestId(`classification-palette-key-chip-${kind}`);
        expect(chip.textContent).toBe(EN_SHORTCUT_KEYS[kind]);
      }
    }
    await act(async () => {
      await i18next.changeLanguage('en-US');
    });
  });
});
