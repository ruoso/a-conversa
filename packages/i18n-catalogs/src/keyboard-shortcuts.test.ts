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
  EDGE_ROLE_TO_SHORTCUT,
  EDGE_ROLES,
  getShortcutForEdgeRole,
  getShortcutForKind,
  KEYBOARD_SHORTCUT_POLICY,
  KIND_TO_SHORTCUT,
  METHODOLOGY_KINDS,
  type EdgeRole,
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
  it('is total over (SupportedLocale x MethodologyKind) and over (SupportedLocale x EdgeRole)', () => {
    const matrix = buildShortcutMatrix();
    expect(Object.keys(matrix).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    for (const locale of SUPPORTED_LOCALES) {
      const row = matrix[locale];
      expect(Object.keys(row.kinds).sort()).toEqual([...METHODOLOGY_KINDS].sort());
      expect(Object.keys(row.roles).sort()).toEqual([...EDGE_ROLES].sort());
      for (const kind of METHODOLOGY_KINDS) {
        const shortcut = row.kinds[kind];
        expect(shortcut, `${locale}/kind/${kind} must be defined and non-empty`).toBeTruthy();
        expect(shortcut.length).toBeGreaterThan(0);
      }
      for (const role of EDGE_ROLES) {
        const shortcut = row.roles[role];
        expect(shortcut, `${locale}/role/${role} must be defined and non-empty`).toBeTruthy();
        expect(shortcut.length).toBeGreaterThan(0);
      }
    }
  });

  it('has no collisions within any single locale (kinds + roles unioned)', () => {
    const matrix = buildShortcutMatrix();
    for (const locale of SUPPORTED_LOCALES) {
      const row = matrix[locale];
      const values = [...Object.values(row.kinds), ...Object.values(row.roles)];
      const unique = new Set(values);
      expect(unique.size, `locale ${locale} has a duplicate shortcut across kinds+roles`).toBe(
        values.length,
      );
    }
  });

  it('every locale row equals the english-mnemonic tables (current policy)', () => {
    const matrix = buildShortcutMatrix();
    for (const locale of SUPPORTED_LOCALES) {
      for (const kind of METHODOLOGY_KINDS) {
        expect(matrix[locale].kinds[kind]).toBe(KIND_TO_SHORTCUT[kind]);
      }
      for (const role of EDGE_ROLES) {
        expect(matrix[locale].roles[role]).toBe(EDGE_ROLE_TO_SHORTCUT[role]);
      }
    }
  });

  it('exposes the en-US / pt-BR / es-419 kind rows the refinement documents', () => {
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
        expect(matrix[locale].kinds[kind], `${locale}/${kind}`).toBe(expectedRows[locale][kind]);
      }
    }
  });

  it('exposes the en-US / pt-BR / es-419 role rows the refinement documents', () => {
    const matrix = buildShortcutMatrix();
    const expectedRoleRow: Record<EdgeRole, string> = {
      supports: 's',
      rebuts: 'r',
      qualifies: 'q',
      'bridges-from': 'b',
      'bridges-to': 'g',
      defines: 'e',
      contradicts: 'x',
    };
    for (const locale of SUPPORTED_LOCALES) {
      for (const role of EDGE_ROLES) {
        expect(matrix[locale].roles[role], `${locale}/${role}`).toBe(expectedRoleRow[role]);
      }
    }
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_edge_role_selector.md
//
// Companion cases for the edge-role-selector's shortcut table. The
// english-mnemonic policy is already pinned by the kind cases above;
// here we lock the per-role picks + the no-collision-with-kinds
// property that the propose-flow keymap depends on.
describe('EDGE_ROLES literal tuple', () => {
  it('has exactly seven values (the canonical edge roles)', () => {
    expect(EDGE_ROLES.length).toBe(7);
  });

  it('matches the canonical order (mirrors edgeRoleSchema)', () => {
    expect([...EDGE_ROLES]).toEqual([
      'supports',
      'rebuts',
      'qualifies',
      'bridges-from',
      'bridges-to',
      'defines',
      'contradicts',
    ]);
  });
});

describe('EDGE_ROLE_TO_SHORTCUT (english-mnemonic source of truth)', () => {
  it('maps supports -> s', () => {
    expect(EDGE_ROLE_TO_SHORTCUT.supports).toBe('s');
  });

  it('maps rebuts -> r', () => {
    expect(EDGE_ROLE_TO_SHORTCUT.rebuts).toBe('r');
  });

  it('maps qualifies -> q', () => {
    expect(EDGE_ROLE_TO_SHORTCUT.qualifies).toBe('q');
  });

  it('maps bridges-from -> b', () => {
    expect(EDGE_ROLE_TO_SHORTCUT['bridges-from']).toBe('b');
  });

  it('maps bridges-to -> g', () => {
    expect(EDGE_ROLE_TO_SHORTCUT['bridges-to']).toBe('g');
  });

  it('maps defines -> e', () => {
    expect(EDGE_ROLE_TO_SHORTCUT.defines).toBe('e');
  });

  it('maps contradicts -> x', () => {
    expect(EDGE_ROLE_TO_SHORTCUT.contradicts).toBe('x');
  });

  it('covers every edge role exactly once', () => {
    const keys = Object.keys(EDGE_ROLE_TO_SHORTCUT).sort();
    expect(keys).toEqual([...EDGE_ROLES].sort());
  });

  it('uses single lowercase ASCII letters', () => {
    for (const role of EDGE_ROLES) {
      const shortcut = EDGE_ROLE_TO_SHORTCUT[role];
      expect(shortcut, `shortcut for ${role}`).toMatch(/^[a-z]$/);
    }
  });

  it('has no within-table collisions (seven distinct keys)', () => {
    const values = Object.values(EDGE_ROLE_TO_SHORTCUT);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('does NOT collide with KIND_TO_SHORTCUT (collision-avoidance proof)', () => {
    const kindKeys = new Set(Object.values(KIND_TO_SHORTCUT));
    const roleKeys = new Set(Object.values(EDGE_ROLE_TO_SHORTCUT));
    const intersection = [...kindKeys].filter((k) => roleKeys.has(k));
    expect(intersection, 'kind and role shortcut tables must be disjoint').toEqual([]);
  });
});

describe('getShortcutForEdgeRole: locale-independent resolution', () => {
  it('returns the english-mnemonic shortcut regardless of locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const role of EDGE_ROLES) {
        expect(getShortcutForEdgeRole(role, locale)).toBe(EDGE_ROLE_TO_SHORTCUT[role]);
      }
    }
  });
});
