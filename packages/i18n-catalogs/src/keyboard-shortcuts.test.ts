// Tests for the moderator classification-palette keyboard shortcut policy.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_keyboard_shortcuts_policy.md
// ADRs:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: frontend_i18n.i18n_keyboard_shortcuts_policy
//
// Acceptance properties from the refinement:
//
//   - The mapping is **total**: every supported locale × every
//     methodology kind has a shortcut. (Total under
//     `'english-mnemonic'` policy because the locale axis collapses,
//     but we assert it at the matrix level so a future per-locale flip
//     keeps the totality guarantee.)
//   - The mapping is **collision-free within each locale**: no two
//     kinds in the same locale share a shortcut key. Across locales
//     collisions are fine (and in fact expected under
//     `'english-mnemonic'`).
//   - Under the current `'english-mnemonic'` policy every locale's
//     row is identical to the canonical English mnemonic table.
//   - The shortcut characters are single lowercase ASCII letters
//     (the moderator UI dispatches on the lowercased key event).
//
// Per ADR 0022 these are committed regression tests; the empirical
// answers ("is the matrix total / collision-free / english-mnemonic")
// are pinned here for every future CI run.

import { describe, expect, it } from 'vitest';

import { SUPPORTED_LOCALES, type SupportedLocale } from './config.js';
import {
  buildShortcutMatrix,
  getShortcutForKind,
  KEYBOARD_SHORTCUT_POLICY,
  KIND_TO_SHORTCUT,
  METHODOLOGY_KINDS,
  type MethodologyKind,
} from './keyboard-shortcuts.js';

describe('keyboard-shortcuts policy mode', () => {
  it('is the english-mnemonic policy', () => {
    expect(KEYBOARD_SHORTCUT_POLICY).toBe('english-mnemonic');
  });
});

describe('KIND_TO_SHORTCUT (english-mnemonic source of truth)', () => {
  it('maps fact -> f', () => {
    expect(KIND_TO_SHORTCUT.fact).toBe('f');
  });

  it('maps predictive -> p', () => {
    expect(KIND_TO_SHORTCUT.predictive).toBe('p');
  });

  it('maps value -> v', () => {
    expect(KIND_TO_SHORTCUT.value).toBe('v');
  });

  it('maps normative -> n', () => {
    expect(KIND_TO_SHORTCUT.normative).toBe('n');
  });

  it('maps definitional -> d', () => {
    expect(KIND_TO_SHORTCUT.definitional).toBe('d');
  });

  it('covers every methodology kind exactly once', () => {
    const keys = Object.keys(KIND_TO_SHORTCUT).sort();
    expect(keys).toEqual([...METHODOLOGY_KINDS].sort());
  });

  it('uses single lowercase ASCII letters', () => {
    for (const kind of METHODOLOGY_KINDS) {
      const shortcut = KIND_TO_SHORTCUT[kind];
      expect(shortcut, `shortcut for ${kind}`).toMatch(/^[a-z]$/);
    }
  });

  it('has no within-table collisions', () => {
    const values = Object.values(KIND_TO_SHORTCUT);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

describe('getShortcutForKind: locale-independent resolution', () => {
  it('returns the english-mnemonic shortcut regardless of locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const kind of METHODOLOGY_KINDS) {
        expect(getShortcutForKind(kind, locale)).toBe(KIND_TO_SHORTCUT[kind]);
      }
    }
  });

  it('produces "f" for fact in every locale (including es-419 where the label is "Hecho")', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(getShortcutForKind('fact', locale)).toBe('f');
    }
  });
});

describe('buildShortcutMatrix: totality and collision properties', () => {
  it('is total over (SupportedLocale x MethodologyKind)', () => {
    const matrix = buildShortcutMatrix();
    expect(Object.keys(matrix).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    for (const locale of SUPPORTED_LOCALES) {
      const row = matrix[locale];
      expect(Object.keys(row).sort()).toEqual([...METHODOLOGY_KINDS].sort());
      for (const kind of METHODOLOGY_KINDS) {
        const shortcut = row[kind];
        expect(shortcut, `${locale}/${kind} must be defined and non-empty`).toBeTruthy();
        expect(shortcut.length).toBeGreaterThan(0);
      }
    }
  });

  it('has no collisions within any single locale', () => {
    const matrix = buildShortcutMatrix();
    for (const locale of SUPPORTED_LOCALES) {
      const row = matrix[locale];
      const values = Object.values(row);
      const unique = new Set(values);
      expect(unique.size, `locale ${locale} has a duplicate shortcut among kinds`).toBe(
        values.length,
      );
    }
  });

  it('every locale row equals the english-mnemonic table (current policy)', () => {
    const matrix = buildShortcutMatrix();
    for (const locale of SUPPORTED_LOCALES) {
      for (const kind of METHODOLOGY_KINDS) {
        expect(matrix[locale][kind]).toBe(KIND_TO_SHORTCUT[kind]);
      }
    }
  });

  it('exposes the en-US / pt-BR / es-419 rows the refinement documents', () => {
    const matrix = buildShortcutMatrix();
    // The refinement table cites these specific cells; the cell test
    // doubles as the regression gate against silent matrix drift.
    const expectedRows: Record<SupportedLocale, Record<MethodologyKind, string>> = {
      'en-US': { fact: 'f', predictive: 'p', value: 'v', normative: 'n', definitional: 'd' },
      'pt-BR': { fact: 'f', predictive: 'p', value: 'v', normative: 'n', definitional: 'd' },
      'es-419': { fact: 'f', predictive: 'p', value: 'v', normative: 'n', definitional: 'd' },
    };
    for (const locale of SUPPORTED_LOCALES) {
      for (const kind of METHODOLOGY_KINDS) {
        expect(matrix[locale][kind], `${locale}/${kind}`).toBe(expectedRows[locale][kind]);
      }
    }
  });
});
