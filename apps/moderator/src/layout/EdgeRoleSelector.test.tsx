// Tests for `<EdgeRoleSelector>` — the moderator's horizontal
// button row + keyboard shortcuts for edge-role selection.
//
// Refinement: tasks/refinements/moderator-ui/mod_edge_role_selector.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   1. The visibility gate: when no target is staged the selector
//      returns null. When a target is staged the seven buttons render.
//   2. Stable testid surface (wrapper, per-role button, per-role key
//      chip, shortcut-hint helper) so downstream tasks and the
//      Playwright spec can locate the component without scraping store
//      internals.
//   3. Canonical iteration order — buttons render in `EDGE_ROLES`
//      order so the moderator's mental model + the keymap-help overlay
//      see the same layout.
//   4. Localized labels resolve from `methodology.edgeRole.<role>.label`
//      in every v1 locale; the palette chrome resolves from
//      `moderator.edgeRolePalette.*`; each button's `title` resolves
//      from `methodology.edgeRole.<role>.description`.
//   5. Store wiring — `aria-pressed` reflects the slice; clicks write
//      the slice; the toggle-off-on-re-click idiom from Decision §4.
//   6. Keyboard wiring — `s`/`r`/`q`/`b`/`g`/`e`/`x` write the slice;
//      modifier-bail / editable-target / repeat-skip guards hold; the
//      no-op-on-re-press asymmetry from Decision §4; the
//      visibility-gate inside the handler closure (Decision §3).
//   7. Listener cleanup on unmount — no leaks after the component
//      detaches.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { EdgeRoleSelector } from './EdgeRoleSelector';
import { CaptureTextInput } from './CaptureTextInput';
import { useCaptureStore } from '../stores/captureStore';
import { createI18nInstance } from '@a-conversa/shell';

const EN_ROLE_LABELS: Record<string, string> = {
  supports: 'Supports',
  rebuts: 'Rebuts',
  qualifies: 'Qualifies',
  'bridges-from': 'Bridges from',
  'bridges-to': 'Bridges to',
  defines: 'Defines',
  contradicts: 'Contradicts',
};

const EN_SHORTCUT_KEYS: Record<string, string> = {
  supports: 'S',
  rebuts: 'R',
  qualifies: 'Q',
  'bridges-from': 'B',
  'bridges-to': 'G',
  defines: 'E',
  contradicts: 'X',
};

const CANONICAL_ORDER = [
  'supports',
  'rebuts',
  'qualifies',
  'bridges-from',
  'bridges-to',
  'defines',
  'contradicts',
] as const;

const STAGED_TARGET = 'n-1';

beforeEach(async () => {
  useCaptureStore.getState().reset();
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('EdgeRoleSelector — visibility gate', () => {
  it('returns null when no target is staged (queryByTestId resolves null)', () => {
    render(<EdgeRoleSelector />);
    expect(screen.queryByTestId('edge-role-selector')).toBeNull();
  });

  it('renders the wrapper, seven buttons, seven key chips, and the shortcut hint when a target is staged', () => {
    act(() => {
      useCaptureStore.getState().setTargetEntityId(STAGED_TARGET);
    });
    render(<EdgeRoleSelector />);
    expect(screen.getByTestId('edge-role-selector')).toBeTruthy();
    for (const role of CANONICAL_ORDER) {
      expect(screen.getByTestId(`edge-role-selector-button-${role}`)).toBeTruthy();
      expect(screen.getByTestId(`edge-role-selector-key-chip-${role}`)).toBeTruthy();
    }
    expect(screen.getByTestId('edge-role-selector-shortcut-hint')).toBeTruthy();
  });

  it('renders the labelled `group` role for the buttons', () => {
    act(() => {
      useCaptureStore.getState().setTargetEntityId(STAGED_TARGET);
    });
    render(<EdgeRoleSelector />);
    expect(screen.getByRole('group', { name: /Edge role/ })).toBeTruthy();
  });

  it('clearing the target slice after render collapses the selector to null DOM', () => {
    act(() => {
      useCaptureStore.getState().setTargetEntityId(STAGED_TARGET);
    });
    render(<EdgeRoleSelector />);
    expect(screen.getByTestId('edge-role-selector')).toBeTruthy();
    act(() => {
      useCaptureStore.getState().setTargetEntityId(null);
    });
    expect(screen.queryByTestId('edge-role-selector')).toBeNull();
  });
});

describe('EdgeRoleSelector — render structure', () => {
  beforeEach(() => {
    act(() => {
      useCaptureStore.getState().setTargetEntityId(STAGED_TARGET);
    });
  });

  it('renders all seven buttons in the canonical EDGE_ROLES order', () => {
    render(<EdgeRoleSelector />);
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-testid^="edge-role-selector-button-"]'),
    );
    expect(buttons.map((b) => b.getAttribute('data-role'))).toEqual([...CANONICAL_ORDER]);
  });

  it('each button has type="button" so it never accidentally submits a wrapping form', () => {
    render(<EdgeRoleSelector />);
    for (const role of CANONICAL_ORDER) {
      const btn = screen.getByTestId<HTMLButtonElement>(`edge-role-selector-button-${role}`);
      expect(btn.getAttribute('type')).toBe('button');
    }
  });

  it("each button's visible label is the localized methodology.edgeRole.<role>.label string", () => {
    render(<EdgeRoleSelector />);
    for (const role of CANONICAL_ORDER) {
      const btn = screen.getByTestId<HTMLButtonElement>(`edge-role-selector-button-${role}`);
      expect(btn.textContent).toContain(EN_ROLE_LABELS[role]);
    }
  });

  it("each button's key chip is the uppercase mnemonic", () => {
    render(<EdgeRoleSelector />);
    for (const role of CANONICAL_ORDER) {
      const chip = screen.getByTestId(`edge-role-selector-key-chip-${role}`);
      expect(chip.textContent).toBe(EN_SHORTCUT_KEYS[role]);
    }
  });

  it("each button's aria-label composes the localized label and key", () => {
    render(<EdgeRoleSelector />);
    for (const role of CANONICAL_ORDER) {
      const btn = screen.getByTestId<HTMLButtonElement>(`edge-role-selector-button-${role}`);
      expect(btn.getAttribute('aria-label')).toBe(
        `${EN_ROLE_LABELS[role]} (${EN_SHORTCUT_KEYS[role]})`,
      );
    }
  });

  it("each button's title is the localized methodology.edgeRole.<role>.description string", () => {
    render(<EdgeRoleSelector />);
    for (const role of CANONICAL_ORDER) {
      const btn = screen.getByTestId<HTMLButtonElement>(`edge-role-selector-button-${role}`);
      const title = btn.getAttribute('title');
      expect(title, `title for ${role} must be set`).toBeTruthy();
      // Title must not be the raw catalog key (i.e., i18n must resolve).
      expect(title).not.toBe(`methodology.edgeRole.${role}.description`);
    }
  });

  it('renders the shortcut hint text', () => {
    render(<EdgeRoleSelector />);
    expect(screen.getByTestId('edge-role-selector-shortcut-hint').textContent).toBe(
      'Or press S / R / Q / B / G / E / X',
    );
  });
});

describe('EdgeRoleSelector — store wiring (click)', () => {
  beforeEach(() => {
    act(() => {
      useCaptureStore.getState().setTargetEntityId(STAGED_TARGET);
    });
  });

  it('aria-pressed reflects the store on mount when a role is pre-selected', () => {
    act(() => {
      useCaptureStore.getState().setEdgeRole('rebuts');
    });
    render(<EdgeRoleSelector />);
    expect(
      screen.getByTestId('edge-role-selector-button-rebuts').getAttribute('aria-pressed'),
    ).toBe('true');
    for (const role of CANONICAL_ORDER) {
      if (role === 'rebuts') continue;
      expect(
        screen.getByTestId(`edge-role-selector-button-${role}`).getAttribute('aria-pressed'),
      ).toBe('false');
    }
  });

  it('click on an unselected button writes the slice', () => {
    render(<EdgeRoleSelector />);
    fireEvent.click(screen.getByTestId('edge-role-selector-button-supports'));
    expect(useCaptureStore.getState().edgeRole).toBe('supports');
    expect(
      screen.getByTestId('edge-role-selector-button-supports').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('click on the currently-selected button toggles off (Decision §4)', () => {
    act(() => {
      useCaptureStore.getState().setEdgeRole('qualifies');
    });
    render(<EdgeRoleSelector />);
    fireEvent.click(screen.getByTestId('edge-role-selector-button-qualifies'));
    expect(useCaptureStore.getState().edgeRole).toBeNull();
    for (const role of CANONICAL_ORDER) {
      expect(
        screen.getByTestId(`edge-role-selector-button-${role}`).getAttribute('aria-pressed'),
      ).toBe('false');
    }
  });

  it('clicking a different button switches the selection', () => {
    act(() => {
      useCaptureStore.getState().setEdgeRole('supports');
    });
    render(<EdgeRoleSelector />);
    fireEvent.click(screen.getByTestId('edge-role-selector-button-rebuts'));
    expect(useCaptureStore.getState().edgeRole).toBe('rebuts');
    expect(
      screen.getByTestId('edge-role-selector-button-supports').getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      screen.getByTestId('edge-role-selector-button-rebuts').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('reset() returns every button to aria-pressed=false (and the selector collapses to null DOM because targetEntityId nulls too)', () => {
    render(<EdgeRoleSelector />);
    fireEvent.click(screen.getByTestId('edge-role-selector-button-defines'));
    expect(useCaptureStore.getState().edgeRole).toBe('defines');
    act(() => {
      useCaptureStore.getState().reset();
    });
    // Reset nulls targetEntityId AND edgeRole — the visibility gate
    // collapses the selector to null DOM. The store slice itself is
    // back to null.
    expect(useCaptureStore.getState().edgeRole).toBeNull();
    expect(screen.queryByTestId('edge-role-selector')).toBeNull();
  });

  it('updates aria-pressed when the store is mutated programmatically', () => {
    render(<EdgeRoleSelector />);
    expect(
      screen.getByTestId('edge-role-selector-button-bridges-to').getAttribute('aria-pressed'),
    ).toBe('false');
    act(() => {
      useCaptureStore.getState().setEdgeRole('bridges-to');
    });
    expect(
      screen.getByTestId('edge-role-selector-button-bridges-to').getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('EdgeRoleSelector — store wiring (keyboard shortcut)', () => {
  beforeEach(() => {
    act(() => {
      useCaptureStore.getState().setTargetEntityId(STAGED_TARGET);
    });
  });

  it('pressing `s` writes the supports role', () => {
    render(<EdgeRoleSelector />);
    fireEvent.keyDown(document, { key: 's' });
    expect(useCaptureStore.getState().edgeRole).toBe('supports');
  });

  it('routes every role shortcut to its matching role', () => {
    render(<EdgeRoleSelector />);
    for (const role of CANONICAL_ORDER) {
      act(() => {
        useCaptureStore.getState().setEdgeRole(null);
      });
      const upper = EN_SHORTCUT_KEYS[role];
      if (upper === undefined) throw new Error(`missing shortcut for ${role}`);
      fireEvent.keyDown(document, { key: upper.toLowerCase() });
      expect(useCaptureStore.getState().edgeRole).toBe(role);
    }
  });

  it('is case-insensitive — uppercase `S` (shift held) still picks supports', () => {
    render(<EdgeRoleSelector />);
    fireEvent.keyDown(document, { key: 'S', shiftKey: true });
    expect(useCaptureStore.getState().edgeRole).toBe('supports');
  });

  it('visibility-gate: ignores role shortcut when targetEntityId is null', () => {
    act(() => {
      useCaptureStore.getState().setTargetEntityId(null);
    });
    render(<EdgeRoleSelector />);
    fireEvent.keyDown(document, { key: 's' });
    expect(useCaptureStore.getState().edgeRole).toBeNull();
  });

  it('ignores `s` when focus is on a textarea (editable-target guard)', () => {
    render(
      <>
        <CaptureTextInput />
        <EdgeRoleSelector />
      </>,
    );
    const textarea = screen.getByTestId<HTMLTextAreaElement>('capture-text-input-textarea');
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    fireEvent.keyDown(document, { key: 's' });
    expect(useCaptureStore.getState().edgeRole).toBeNull();
  });

  it('ignores `s` when metaKey is held (Cmd+S passes through)', () => {
    render(<EdgeRoleSelector />);
    fireEvent.keyDown(document, { key: 's', metaKey: true });
    expect(useCaptureStore.getState().edgeRole).toBeNull();
  });

  it('ignores `s` when ctrlKey is held (Ctrl+S passes through)', () => {
    render(<EdgeRoleSelector />);
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    expect(useCaptureStore.getState().edgeRole).toBeNull();
  });

  it('ignores `s` when altKey is held (Alt+S passes through)', () => {
    render(<EdgeRoleSelector />);
    fireEvent.keyDown(document, { key: 's', altKey: true });
    expect(useCaptureStore.getState().edgeRole).toBeNull();
  });

  it('re-press of the currently-selected role is a no-op (Decision §4)', () => {
    act(() => {
      useCaptureStore.getState().setEdgeRole('supports');
    });
    render(<EdgeRoleSelector />);
    fireEvent.keyDown(document, { key: 's' });
    expect(useCaptureStore.getState().edgeRole).toBe('supports');
  });

  it('pressing a different role shortcut while one is selected switches the slice', () => {
    act(() => {
      useCaptureStore.getState().setEdgeRole('supports');
    });
    render(<EdgeRoleSelector />);
    fireEvent.keyDown(document, { key: 'r' });
    expect(useCaptureStore.getState().edgeRole).toBe('rebuts');
  });

  it('ignores auto-repeat keystrokes (event.repeat=true skipped)', () => {
    render(<EdgeRoleSelector />);
    fireEvent.keyDown(document, { key: 's', repeat: true });
    expect(useCaptureStore.getState().edgeRole).toBeNull();
  });
});

describe('EdgeRoleSelector — listener lifecycle', () => {
  it('unmount detaches the listener — subsequent s does not write', () => {
    act(() => {
      useCaptureStore.getState().setTargetEntityId(STAGED_TARGET);
    });
    const { unmount } = render(<EdgeRoleSelector />);
    unmount();
    fireEvent.keyDown(document, { key: 's' });
    expect(useCaptureStore.getState().edgeRole).toBeNull();
  });

  it('re-mounting attaches a fresh listener', () => {
    act(() => {
      useCaptureStore.getState().setTargetEntityId(STAGED_TARGET);
    });
    const { unmount } = render(<EdgeRoleSelector />);
    unmount();
    fireEvent.keyDown(document, { key: 's' });
    expect(useCaptureStore.getState().edgeRole).toBeNull();

    render(<EdgeRoleSelector />);
    fireEvent.keyDown(document, { key: 'r' });
    expect(useCaptureStore.getState().edgeRole).toBe('rebuts');
  });
});

describe('EdgeRoleSelector — i18n catalog parity', () => {
  const KEYS = [
    'moderator.edgeRolePalette.ariaLabel',
    'moderator.edgeRolePalette.legend',
    'moderator.edgeRolePalette.roleButtonAriaLabel',
    'moderator.edgeRolePalette.shortcutHint',
    'moderator.edgeRolePalette.unsetAria',
    'moderator.edgeRolePalette.hiddenHelp',
  ] as const;
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  for (const locale of LOCALES) {
    for (const key of KEYS) {
      it(`resolves ${key} to a non-empty string in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        const value =
          key === 'moderator.edgeRolePalette.roleButtonAriaLabel'
            ? i18next.t(key, { label: 'X', key: 'S' })
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
      await i18next.changeLanguage(locale);
      cleanup();
      useCaptureStore.getState().reset();
      act(() => {
        useCaptureStore.getState().setTargetEntityId(STAGED_TARGET);
      });
      render(<EdgeRoleSelector />);
      const wrapper = screen.getByTestId('edge-role-selector');
      expect(wrapper.textContent).not.toContain('moderator.edgeRolePalette');
      expect(wrapper.textContent).not.toContain('methodology.edgeRole.');
      expect(wrapper.textContent).not.toContain('[t-missing]');
      // Each role label resolves to its glossary value for the locale.
      for (const role of CANONICAL_ORDER) {
        const glossary = i18next.t(`methodology.edgeRole.${role}.label`);
        const btn = screen.getByTestId(`edge-role-selector-button-${role}`);
        expect(btn.textContent).toContain(String(glossary));
      }
    }
    await i18next.changeLanguage('en-US');
  });

  it('shortcut KEY is identical across locales (english-mnemonic policy)', async () => {
    for (const locale of LOCALES) {
      await i18next.changeLanguage(locale);
      cleanup();
      useCaptureStore.getState().reset();
      act(() => {
        useCaptureStore.getState().setTargetEntityId(STAGED_TARGET);
      });
      render(<EdgeRoleSelector />);
      for (const role of CANONICAL_ORDER) {
        const chip = screen.getByTestId(`edge-role-selector-key-chip-${role}`);
        expect(chip.textContent).toBe(EN_SHORTCUT_KEYS[role]);
      }
    }
    await i18next.changeLanguage('en-US');
  });
});
