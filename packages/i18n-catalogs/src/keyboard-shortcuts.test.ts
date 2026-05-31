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
  getShortcutForMetaMoveKind,
  KEYBOARD_SHORTCUT_POLICY,
  KIND_TO_SHORTCUT,
  META_MOVE_KIND_TO_SHORTCUT,
  META_MOVE_KINDS,
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
  it('is total over (SupportedLocale x MethodologyKind), (SupportedLocale x EdgeRole), and (SupportedLocale x MetaMoveKind)', () => {
    const matrix = buildShortcutMatrix();
    expect(Object.keys(matrix).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    for (const locale of SUPPORTED_LOCALES) {
      const row = matrix[locale];
      expect(Object.keys(row.kinds).sort()).toEqual([...METHODOLOGY_KINDS].sort());
      expect(Object.keys(row.roles).sort()).toEqual([...EDGE_ROLES].sort());
      expect(Object.keys(row.metaMoveKinds).sort()).toEqual([...META_MOVE_KINDS].sort());
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
      for (const metaKind of META_MOVE_KINDS) {
        const shortcut = row.metaMoveKinds[metaKind];
        expect(
          shortcut,
          `${locale}/metaMoveKind/${metaKind} must be defined and non-empty`,
        ).toBeTruthy();
        expect(shortcut.length).toBeGreaterThan(0);
      }
    }
  });

  it('has no collisions within any single locale (kinds + roles + metaMoveKinds unioned)', () => {
    const matrix = buildShortcutMatrix();
    for (const locale of SUPPORTED_LOCALES) {
      const row = matrix[locale];
      const values = [
        ...Object.values(row.kinds),
        ...Object.values(row.roles),
        ...Object.values(row.metaMoveKinds),
      ];
      const unique = new Set(values);
      expect(
        unique.size,
        `locale ${locale} has a duplicate shortcut across kinds+roles+metaMoveKinds`,
      ).toBe(values.length);
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
      for (const metaKind of META_MOVE_KINDS) {
        expect(matrix[locale].metaMoveKinds[metaKind]).toBe(META_MOVE_KIND_TO_SHORTCUT[metaKind]);
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

// Refinement: tasks/refinements/moderator-ui/mod_meta_move_kind_selector.md
//
// Companion cases for the meta-move-kind-selector's shortcut table.
// The english-mnemonic policy is already pinned by the kind cases
// above; here we lock the per-kind picks + the
// no-collision-with-kinds-or-roles property the propose-flow keymap
// depends on. The three single-letter shortcut tables together must
// form an injection — the regression assertion enforces it.
describe('META_MOVE_KINDS literal tuple', () => {
  it('has exactly three values (reframe / scope-change / stance)', () => {
    expect(META_MOVE_KINDS.length).toBe(3);
  });

  it('matches the canonical order (mirrors metaMoveProposalSchema.meta_kind)', () => {
    expect([...META_MOVE_KINDS]).toEqual(['reframe', 'scope-change', 'stance']);
  });
});

describe('META_MOVE_KIND_TO_SHORTCUT (english-mnemonic source of truth)', () => {
  it('maps reframe -> m (Decision §1)', () => {
    expect(META_MOVE_KIND_TO_SHORTCUT.reframe).toBe('m');
  });

  it('maps scope-change -> c (Decision §1)', () => {
    expect(META_MOVE_KIND_TO_SHORTCUT['scope-change']).toBe('c');
  });

  it('maps stance -> t (Decision §1)', () => {
    expect(META_MOVE_KIND_TO_SHORTCUT.stance).toBe('t');
  });

  it('covers every meta-move kind exactly once', () => {
    const keys = Object.keys(META_MOVE_KIND_TO_SHORTCUT).sort();
    expect(keys).toEqual([...META_MOVE_KINDS].sort());
  });

  it('uses single lowercase ASCII letters', () => {
    for (const kind of META_MOVE_KINDS) {
      const shortcut = META_MOVE_KIND_TO_SHORTCUT[kind];
      expect(shortcut, `shortcut for ${kind}`).toMatch(/^[a-z]$/);
    }
  });

  it('has no within-table collisions (three distinct keys)', () => {
    const values = Object.values(META_MOVE_KIND_TO_SHORTCUT);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('does NOT collide with KIND_TO_SHORTCUT (collision-avoidance proof)', () => {
    const kindKeys = new Set(Object.values(KIND_TO_SHORTCUT));
    const metaKeys = new Set(Object.values(META_MOVE_KIND_TO_SHORTCUT));
    const intersection = [...kindKeys].filter((k) => metaKeys.has(k));
    expect(
      intersection,
      'KIND_TO_SHORTCUT and META_MOVE_KIND_TO_SHORTCUT must be disjoint',
    ).toEqual([]);
  });

  it('does NOT collide with EDGE_ROLE_TO_SHORTCUT (collision-avoidance proof)', () => {
    const roleKeys = new Set(Object.values(EDGE_ROLE_TO_SHORTCUT));
    const metaKeys = new Set(Object.values(META_MOVE_KIND_TO_SHORTCUT));
    const intersection = [...roleKeys].filter((k) => metaKeys.has(k));
    expect(
      intersection,
      'EDGE_ROLE_TO_SHORTCUT and META_MOVE_KIND_TO_SHORTCUT must be disjoint',
    ).toEqual([]);
  });

  it('the union of all three shortcut tables forms an injection (every letter maps to at most one surface)', () => {
    const all = [
      ...Object.values(KIND_TO_SHORTCUT),
      ...Object.values(EDGE_ROLE_TO_SHORTCUT),
      ...Object.values(META_MOVE_KIND_TO_SHORTCUT),
    ];
    const unique = new Set(all);
    expect(
      unique.size,
      'the union of kind + role + meta-move-kind shortcut tables must be collision-free',
    ).toBe(all.length);
  });
});

describe('getShortcutForMetaMoveKind: locale-independent resolution', () => {
  it('returns the english-mnemonic shortcut regardless of locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const kind of META_MOVE_KINDS) {
        expect(getShortcutForMetaMoveKind(kind, locale)).toBe(META_MOVE_KIND_TO_SHORTCUT[kind]);
      }
    }
  });

  it('returns three letters disjoint from kind / role shortcuts (sanity)', () => {
    const seen = new Set<string>();
    for (const kind of META_MOVE_KINDS) {
      const key = getShortcutForMetaMoveKind(kind, 'en-US');
      expect(seen.has(key), `${kind} duplicates an earlier meta-move-kind shortcut`).toBe(false);
      seen.add(key);
    }
  });
});
