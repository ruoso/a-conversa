// Tests for `<KeymapHelpOverlay>` — the `?`-toggled keymap-help dialog.
//
// Refinement: tasks/refinements/moderator-ui/mod_keymap_help_overlay.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//   (a) exactly one row per GLOBAL_KEYMAP entry, grouped by category,
//       in registry order,
//   (b) each row shows formatChord output + the resolved t(labelKey),
//   (c) reachable: false rows carry data-keymap-entry-reachable="false"
//       + the "coming soon" badge; reachable: true rows carry "true"
//       without it,
//   (d) role="dialog" + aria-modal="true" + aria-labelledby present,
//   (e) Esc / backdrop-click / close-button each close the store,
//   (f) every rendered labelKey + overlay-chrome key resolves non-empty
//       across en-US / pt-BR / es-419.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

import { CATALOGS, SUPPORTED_LOCALES } from '@a-conversa/i18n-catalogs';
import { createI18nInstance } from '@a-conversa/shell';

import { GLOBAL_KEYMAP } from './globalKeymap';
import { KeymapHelpOverlay } from './KeymapHelpOverlay';
import { resetKeymapHelpStore, useKeymapHelpStore } from './useKeymapHelpStore';

beforeAll(async () => {
  await createI18nInstance('en-US');
});

afterEach(() => {
  cleanup();
  resetKeymapHelpStore();
});

/** Resolve a dotted catalog key against a nested catalog object. */
function resolve(catalog: unknown, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((node, segment) => {
    if (node !== null && typeof node === 'object' && segment in node) {
      return (node as Record<string, unknown>)[segment];
    }
    return undefined;
  }, catalog);
}

describe('KeymapHelpOverlay', () => {
  it('(a) renders exactly one row per GLOBAL_KEYMAP entry, in registry order', () => {
    render(<KeymapHelpOverlay />);
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="keymap-help-row-"]'),
    );
    const renderedIds = rows.map((row) =>
      (row.dataset.testid ?? '').replace('keymap-help-row-', ''),
    );
    expect(renderedIds).toEqual(GLOBAL_KEYMAP.map((entry) => entry.id));
  });

  it('(a) groups rows under their category section in registry order', () => {
    render(<KeymapHelpOverlay />);
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('[data-keymap-help-category]'),
    );
    const renderedCategories = sections.map((s) => s.dataset.keymapHelpCategory);
    // First-appearance order of categories in the registry.
    const expected: string[] = [];
    for (const entry of GLOBAL_KEYMAP) {
      if (!expected.includes(entry.category)) expected.push(entry.category);
    }
    expect(renderedCategories).toEqual(expected);
  });

  it('(b) each row shows formatChord output + the resolved label', () => {
    render(<KeymapHelpOverlay />);
    // happy-dom navigator.platform is empty → isMacPlatform() false →
    // the platform modifier renders as `Ctrl`.
    const snapshotChord = document.querySelector(
      '[data-testid="keymap-help-chord-action.snapshot"]',
    );
    expect(snapshotChord?.textContent).toBe('Ctrl+S');
    const snapshotRow = document.querySelector('[data-testid="keymap-help-row-action.snapshot"]');
    expect(snapshotRow?.textContent).toContain('Snapshot');
    // The help row documents its own `?` opener.
    const helpChord = document.querySelector('[data-testid="keymap-help-chord-navigation.help"]');
    expect(helpChord?.textContent).toBe('?');
  });

  it('(c) reachable: false rows are dimmed with a coming-soon badge; reachable: true rows are not', () => {
    render(<KeymapHelpOverlay />);
    // The mode-entry chords remain unreachable (declared for the overlay
    // but not yet bound) — they are the dimmed / coming-soon exemplar.
    const decomposeRow = document.querySelector('[data-testid="keymap-help-row-mode.decompose"]');
    expect(decomposeRow?.getAttribute('data-keymap-entry-reachable')).toBe('false');
    expect(
      document.querySelector('[data-testid="keymap-help-coming-soon-mode.decompose"]'),
    ).not.toBeNull();

    // Commit is now reachable (mod_proposal_selection_commit_chord shipped
    // the proposal-selection model + the live binding) — NOT dimmed.
    const commitRow = document.querySelector('[data-testid="keymap-help-row-action.commit"]');
    expect(commitRow?.getAttribute('data-keymap-entry-reachable')).toBe('true');
    expect(
      document.querySelector('[data-testid="keymap-help-coming-soon-action.commit"]'),
    ).toBeNull();

    const snapshotRow = document.querySelector('[data-testid="keymap-help-row-action.snapshot"]');
    expect(snapshotRow?.getAttribute('data-keymap-entry-reachable')).toBe('true');
    expect(
      document.querySelector('[data-testid="keymap-help-coming-soon-action.snapshot"]'),
    ).toBeNull();
  });

  it('(d) carries role="dialog", aria-modal="true", and aria-labelledby', () => {
    render(<KeymapHelpOverlay />);
    const dialog = document.querySelector('[data-testid="keymap-help-overlay"]');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog?.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)).not.toBeNull();
  });

  it('(e) the close button closes the store', () => {
    act(() => {
      useKeymapHelpStore.getState().open();
    });
    render(<KeymapHelpOverlay />);
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="keymap-help-close"]')!);
    });
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
  });

  it('(e) Escape closes the store', () => {
    act(() => {
      useKeymapHelpStore.getState().open();
    });
    render(<KeymapHelpOverlay />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
  });

  it('(e) a backdrop click closes the store', () => {
    act(() => {
      useKeymapHelpStore.getState().open();
    });
    render(<KeymapHelpOverlay />);
    const backdrop = document.querySelector('[data-testid="keymap-help-overlay"]')!;
    act(() => {
      // Fire mousedown on the backdrop root itself (event.target === root).
      fireEvent.mouseDown(backdrop);
    });
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
  });

  it('(f) every rendered labelKey + overlay-chrome key resolves non-empty across all locales', () => {
    const chromeKeys = [
      'moderator.keymapHelp.title',
      'moderator.keymapHelp.closeLabel',
      'moderator.keymapHelp.comingSoon',
      'moderator.keymapHelp.category.kind',
      'moderator.keymapHelp.category.edgeRole',
      'moderator.keymapHelp.category.metaMoveKind',
      'moderator.keymapHelp.category.action',
      'moderator.keymapHelp.category.navigation',
      'moderator.keymapHelp.category.mode',
    ];
    const labelKeys = GLOBAL_KEYMAP.map((entry) => entry.labelKey);
    const allKeys = [...chromeKeys, ...labelKeys];
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of allKeys) {
        const value = resolve(CATALOGS[locale], key);
        expect(typeof value, `${key} in ${locale}`).toBe('string');
        expect((value as string).length, `${key} in ${locale}`).toBeGreaterThan(0);
      }
    }
  });
});
