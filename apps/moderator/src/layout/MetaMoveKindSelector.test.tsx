// Tests for `<MetaMoveKindSelector>` — the moderator's horizontal
// button row + keyboard shortcuts for meta-move kind selection.
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_move_kind_selector.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   1. The unconditional render (Decision §2 — divergence from
//      `<EdgeRoleSelector>`; the meta-move kind picker shows even when
//      no target is staged).
//   2. Stable testid surface (wrapper, per-kind button, per-kind key
//      chip, shortcut-hint helper) so downstream tasks and the
//      Playwright spec can locate the component without scraping store
//      internals.
//   3. Canonical iteration order — buttons render in `META_MOVE_KINDS`
//      order.
//   4. Localized labels resolve from `methodology.annotationKind.<kind>`
//      in every v1 locale (Decision §4 — label reuse); the chrome
//      resolves from `moderator.metaMoveKindSelector.*`.
//   5. Store wiring — `aria-pressed` reflects the slice; clicks write
//      the slice; the toggle-off-on-re-click idiom from Decision §3.
//   6. Keyboard wiring — `m`/`c`/`t` write the slice; modifier-bail /
//      editable-target / repeat-skip guards hold; the no-op-on-re-press
//      asymmetry from Decision §3.
//   7. Listener cleanup on unmount — no leaks after the component
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

import { MetaMoveKindSelector } from './MetaMoveKindSelector';
import { CaptureTextInput } from './CaptureTextInput';
import { useCaptureStore } from '../stores/captureStore';
import { createI18nInstance } from '@a-conversa/shell';

// Local `render(...)` shadow mirroring `<EdgeRoleSelector>` tests —
// absorbs the deferred `useTranslation()` setState inside act().
async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(ui, options);
    return Promise.resolve();
  });
  return result;
}

const EN_KIND_LABELS: Record<string, string> = {
  reframe: 'Reframe',
  'scope-change': 'Scope change',
  stance: 'Stance',
};

const EN_SHORTCUT_KEYS: Record<string, string> = {
  reframe: 'M',
  'scope-change': 'C',
  stance: 'T',
};

const CANONICAL_ORDER = ['reframe', 'scope-change', 'stance'] as const;

beforeEach(async () => {
  useCaptureStore.getState().reset();
  // The action task's reset() restores metaMoveKind to its default
  // ('reframe'); null out the slice so the no-selection baseline is
  // deterministic across these tests.
  useCaptureStore.getState().setMetaMoveKind(null);
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('MetaMoveKindSelector — render structure (no visibility gate)', () => {
  it('renders unconditionally even when targetEntityId is null (Decision §2)', async () => {
    expect(useCaptureStore.getState().targetEntityId).toBeNull();
    await render(<MetaMoveKindSelector />);
    expect(screen.getByTestId('meta-move-kind-selector')).toBeTruthy();
    for (const kind of CANONICAL_ORDER) {
      expect(screen.getByTestId(`meta-move-kind-selector-button-${kind}`)).toBeTruthy();
      expect(screen.getByTestId(`meta-move-kind-selector-key-chip-${kind}`)).toBeTruthy();
    }
    expect(screen.getByTestId('meta-move-kind-selector-shortcut-hint')).toBeTruthy();
  });

  it('renders the same shape when a target is staged', async () => {
    act(() => {
      useCaptureStore.getState().setTargetEntityId('n-1');
    });
    await render(<MetaMoveKindSelector />);
    expect(screen.getByTestId('meta-move-kind-selector')).toBeTruthy();
  });

  it('renders the labelled `group` role for the buttons', async () => {
    await render(<MetaMoveKindSelector />);
    expect(screen.getByRole('group', { name: /Meta-move kind/ })).toBeTruthy();
  });

  it('renders all three buttons in the canonical META_MOVE_KINDS order', async () => {
    await render(<MetaMoveKindSelector />);
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-testid^="meta-move-kind-selector-button-"]',
      ),
    );
    expect(buttons.map((b) => b.getAttribute('data-kind'))).toEqual([...CANONICAL_ORDER]);
  });

  it('each button has type="button" so it never accidentally submits a wrapping form', async () => {
    await render(<MetaMoveKindSelector />);
    for (const kind of CANONICAL_ORDER) {
      const btn = screen.getByTestId<HTMLButtonElement>(`meta-move-kind-selector-button-${kind}`);
      expect(btn.getAttribute('type')).toBe('button');
    }
  });

  it("each button's visible label is the localized methodology.annotationKind.<kind> string", async () => {
    await render(<MetaMoveKindSelector />);
    for (const kind of CANONICAL_ORDER) {
      const btn = screen.getByTestId<HTMLButtonElement>(`meta-move-kind-selector-button-${kind}`);
      expect(btn.textContent).toContain(EN_KIND_LABELS[kind]);
    }
  });

  it("each button's key chip is the uppercase mnemonic", async () => {
    await render(<MetaMoveKindSelector />);
    for (const kind of CANONICAL_ORDER) {
      const chip = screen.getByTestId(`meta-move-kind-selector-key-chip-${kind}`);
      expect(chip.textContent).toBe(EN_SHORTCUT_KEYS[kind]);
    }
  });

  it("each button's aria-label composes the localized label and key", async () => {
    await render(<MetaMoveKindSelector />);
    for (const kind of CANONICAL_ORDER) {
      const btn = screen.getByTestId<HTMLButtonElement>(`meta-move-kind-selector-button-${kind}`);
      expect(btn.getAttribute('aria-label')).toBe(
        `${EN_KIND_LABELS[kind]} (shortcut: ${EN_SHORTCUT_KEYS[kind]})`,
      );
    }
  });

  it('renders the shortcut hint text', async () => {
    await render(<MetaMoveKindSelector />);
    expect(screen.getByTestId('meta-move-kind-selector-shortcut-hint').textContent).toBe(
      'Or press M / C / T',
    );
  });
});

describe('MetaMoveKindSelector — store wiring (click)', () => {
  it('aria-pressed reflects the store on mount when a kind is pre-selected', async () => {
    act(() => {
      useCaptureStore.getState().setMetaMoveKind('scope-change');
    });
    await render(<MetaMoveKindSelector />);
    expect(
      screen
        .getByTestId('meta-move-kind-selector-button-scope-change')
        .getAttribute('aria-pressed'),
    ).toBe('true');
    for (const kind of CANONICAL_ORDER) {
      if (kind === 'scope-change') continue;
      expect(
        screen.getByTestId(`meta-move-kind-selector-button-${kind}`).getAttribute('aria-pressed'),
      ).toBe('false');
    }
  });

  it('click on an unselected button writes the slice', async () => {
    await render(<MetaMoveKindSelector />);
    fireEvent.click(screen.getByTestId('meta-move-kind-selector-button-stance'));
    expect(useCaptureStore.getState().metaMoveKind).toBe('stance');
    expect(
      screen.getByTestId('meta-move-kind-selector-button-stance').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('click on the currently-selected button toggles off to null (Decision §3)', async () => {
    act(() => {
      useCaptureStore.getState().setMetaMoveKind('reframe');
    });
    await render(<MetaMoveKindSelector />);
    fireEvent.click(screen.getByTestId('meta-move-kind-selector-button-reframe'));
    expect(useCaptureStore.getState().metaMoveKind).toBeNull();
    for (const kind of CANONICAL_ORDER) {
      expect(
        screen.getByTestId(`meta-move-kind-selector-button-${kind}`).getAttribute('aria-pressed'),
      ).toBe('false');
    }
  });

  it('clicking a different button switches the selection', async () => {
    act(() => {
      useCaptureStore.getState().setMetaMoveKind('reframe');
    });
    await render(<MetaMoveKindSelector />);
    fireEvent.click(screen.getByTestId('meta-move-kind-selector-button-stance'));
    expect(useCaptureStore.getState().metaMoveKind).toBe('stance');
    expect(
      screen.getByTestId('meta-move-kind-selector-button-reframe').getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      screen.getByTestId('meta-move-kind-selector-button-stance').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('updates aria-pressed when the store is mutated programmatically', async () => {
    await render(<MetaMoveKindSelector />);
    expect(
      screen
        .getByTestId('meta-move-kind-selector-button-scope-change')
        .getAttribute('aria-pressed'),
    ).toBe('false');
    act(() => {
      useCaptureStore.getState().setMetaMoveKind('scope-change');
    });
    expect(
      screen
        .getByTestId('meta-move-kind-selector-button-scope-change')
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('MetaMoveKindSelector — store wiring (keyboard shortcut)', () => {
  it('pressing `m` writes the reframe kind', async () => {
    await render(<MetaMoveKindSelector />);
    fireEvent.keyDown(document, { key: 'm' });
    expect(useCaptureStore.getState().metaMoveKind).toBe('reframe');
  });

  it('routes every kind shortcut to its matching kind', async () => {
    await render(<MetaMoveKindSelector />);
    for (const kind of CANONICAL_ORDER) {
      act(() => {
        useCaptureStore.getState().setMetaMoveKind(null);
      });
      const upper = EN_SHORTCUT_KEYS[kind];
      if (upper === undefined) throw new Error(`missing shortcut for ${kind}`);
      fireEvent.keyDown(document, { key: upper.toLowerCase() });
      expect(useCaptureStore.getState().metaMoveKind).toBe(kind);
    }
  });

  it('is case-insensitive — uppercase `C` (shift held) still picks scope-change', async () => {
    await render(<MetaMoveKindSelector />);
    fireEvent.keyDown(document, { key: 'C', shiftKey: true });
    expect(useCaptureStore.getState().metaMoveKind).toBe('scope-change');
  });

  it('ignores `m` when focus is on a textarea (editable-target guard)', async () => {
    await render(
      <>
        <CaptureTextInput />
        <MetaMoveKindSelector />
      </>,
    );
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    fireEvent.keyDown(document, { key: 'm' });
    expect(useCaptureStore.getState().metaMoveKind).toBeNull();
  });

  it('ignores `m` when metaKey is held (Cmd+M passes through)', async () => {
    await render(<MetaMoveKindSelector />);
    fireEvent.keyDown(document, { key: 'm', metaKey: true });
    expect(useCaptureStore.getState().metaMoveKind).toBeNull();
  });

  it('ignores `m` when ctrlKey is held (Ctrl+M passes through)', async () => {
    await render(<MetaMoveKindSelector />);
    fireEvent.keyDown(document, { key: 'm', ctrlKey: true });
    expect(useCaptureStore.getState().metaMoveKind).toBeNull();
  });

  it('ignores `m` when altKey is held (Alt+M passes through)', async () => {
    await render(<MetaMoveKindSelector />);
    fireEvent.keyDown(document, { key: 'm', altKey: true });
    expect(useCaptureStore.getState().metaMoveKind).toBeNull();
  });

  it('re-press of the currently-selected kind is a no-op (Decision §3)', async () => {
    act(() => {
      useCaptureStore.getState().setMetaMoveKind('reframe');
    });
    await render(<MetaMoveKindSelector />);
    fireEvent.keyDown(document, { key: 'm' });
    expect(useCaptureStore.getState().metaMoveKind).toBe('reframe');
  });

  it('pressing a different kind shortcut while one is selected switches the slice', async () => {
    act(() => {
      useCaptureStore.getState().setMetaMoveKind('reframe');
    });
    await render(<MetaMoveKindSelector />);
    fireEvent.keyDown(document, { key: 'c' });
    expect(useCaptureStore.getState().metaMoveKind).toBe('scope-change');
  });

  it('ignores auto-repeat keystrokes (event.repeat=true skipped)', async () => {
    await render(<MetaMoveKindSelector />);
    fireEvent.keyDown(document, { key: 'm', repeat: true });
    expect(useCaptureStore.getState().metaMoveKind).toBeNull();
  });
});

describe('MetaMoveKindSelector — listener lifecycle', () => {
  it('unmount detaches the listener — subsequent m does not write', async () => {
    const { unmount } = await render(<MetaMoveKindSelector />);
    unmount();
    fireEvent.keyDown(document, { key: 'm' });
    expect(useCaptureStore.getState().metaMoveKind).toBeNull();
  });

  it('re-mounting attaches a fresh listener', async () => {
    const { unmount } = await render(<MetaMoveKindSelector />);
    unmount();
    fireEvent.keyDown(document, { key: 'm' });
    expect(useCaptureStore.getState().metaMoveKind).toBeNull();

    await render(<MetaMoveKindSelector />);
    fireEvent.keyDown(document, { key: 'c' });
    expect(useCaptureStore.getState().metaMoveKind).toBe('scope-change');
  });
});

describe('MetaMoveKindSelector — i18n catalog parity', () => {
  const KEYS = [
    'moderator.metaMoveKindSelector.ariaLabel',
    'moderator.metaMoveKindSelector.legend',
    'moderator.metaMoveKindSelector.kindButtonAriaLabel',
    'moderator.metaMoveKindSelector.shortcutHint',
  ] as const;
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  for (const locale of LOCALES) {
    for (const key of KEYS) {
      it(`resolves ${key} to a non-empty string in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        const value =
          key === 'moderator.metaMoveKindSelector.kindButtonAriaLabel'
            ? i18next.t(key, { label: 'X', key: 'M' })
            : i18next.t(key);
        expect(value).toBeTruthy();
        expect(value).not.toBe(key);
        expect(value).not.toContain('[t-missing]');
        await i18next.changeLanguage('en-US');
      });
    }
  }

  it('per-locale render: no raw catalog-key string nor [t-missing] in the selector DOM', async () => {
    for (const locale of LOCALES) {
      cleanup();
      await act(async () => {
        await i18next.changeLanguage(locale);
      });
      useCaptureStore.getState().reset();
      useCaptureStore.getState().setMetaMoveKind(null);
      await render(<MetaMoveKindSelector />);
      const wrapper = screen.getByTestId('meta-move-kind-selector');
      expect(wrapper.textContent).not.toContain('moderator.metaMoveKindSelector');
      expect(wrapper.textContent).not.toContain('methodology.annotationKind.');
      expect(wrapper.textContent).not.toContain('[t-missing]');
      for (const kind of CANONICAL_ORDER) {
        const glossary = i18next.t(`methodology.annotationKind.${kind}`);
        const btn = screen.getByTestId(`meta-move-kind-selector-button-${kind}`);
        expect(btn.textContent).toContain(String(glossary));
      }
    }
    cleanup();
    await act(async () => {
      await i18next.changeLanguage('en-US');
    });
  });

  it('shortcut KEY is identical across locales (english-mnemonic policy)', async () => {
    for (const locale of LOCALES) {
      cleanup();
      await act(async () => {
        await i18next.changeLanguage(locale);
      });
      useCaptureStore.getState().reset();
      useCaptureStore.getState().setMetaMoveKind(null);
      await render(<MetaMoveKindSelector />);
      for (const kind of CANONICAL_ORDER) {
        const chip = screen.getByTestId(`meta-move-kind-selector-key-chip-${kind}`);
        expect(chip.textContent).toBe(EN_SHORTCUT_KEYS[kind]);
      }
    }
    cleanup();
    await act(async () => {
      await i18next.changeLanguage('en-US');
    });
  });
});
