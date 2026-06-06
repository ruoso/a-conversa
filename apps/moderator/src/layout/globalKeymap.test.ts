// Tests for `globalKeymap` — the declarative moderator shortcut
// registry.
//
// Refinement: tasks/refinements/moderator-ui/mod_global_keymap.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//   (a) the generated kind / edge-role / meta-move-kind entries match
//       the canonical methodology tables exactly (drift guard),
//   (b) the registry carries the expected action / navigation ids with
//       the right reachability flags,
//   (c) the action / navigation / mode chords are mutually distinct
//       (platformModifier, shift, key) triples,
//   (d) no action / navigation chord key collides with a single-letter
//       shortcut key under the dispatcher's matching rules,
//   (e) every entry's labelKey resolves to a non-empty string in all
//       three locales.

import { describe, expect, it } from 'vitest';

import {
  CATALOGS,
  EDGE_ROLES,
  EDGE_ROLE_TO_SHORTCUT,
  KIND_TO_SHORTCUT,
  META_MOVE_KINDS,
  META_MOVE_KIND_TO_SHORTCUT,
  METHODOLOGY_KINDS,
  SUPPORTED_LOCALES,
} from '@a-conversa/i18n-catalogs';

import { GLOBAL_KEYMAP, type GlobalShortcut } from './globalKeymap';

function entriesIn(category: GlobalShortcut['category']): readonly GlobalShortcut[] {
  return GLOBAL_KEYMAP.filter((entry) => entry.category === category);
}

/** Resolve a dotted labelKey against a nested catalog object. */
function resolve(catalog: unknown, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((node, segment) => {
    if (node !== null && typeof node === 'object' && segment in node) {
      return (node as Record<string, unknown>)[segment];
    }
    return undefined;
  }, catalog);
}

describe('GLOBAL_KEYMAP — generated single-letter drift guard (a)', () => {
  it('kind entries match KIND_TO_SHORTCUT exactly', () => {
    const kindEntries = entriesIn('kind');
    expect(kindEntries.map((entry) => entry.id)).toEqual(
      METHODOLOGY_KINDS.map((kind) => `kind.${kind}`),
    );
    for (const kind of METHODOLOGY_KINDS) {
      const entry = kindEntries.find((candidate) => candidate.id === `kind.${kind}`);
      expect(entry?.chord.key).toBe(KIND_TO_SHORTCUT[kind]);
    }
  });

  it('edge-role entries match EDGE_ROLE_TO_SHORTCUT exactly', () => {
    const roleEntries = entriesIn('edge-role');
    expect(roleEntries.map((entry) => entry.id)).toEqual(
      EDGE_ROLES.map((role) => `edge-role.${role}`),
    );
    for (const role of EDGE_ROLES) {
      const entry = roleEntries.find((candidate) => candidate.id === `edge-role.${role}`);
      expect(entry?.chord.key).toBe(EDGE_ROLE_TO_SHORTCUT[role]);
    }
  });

  it('meta-move-kind entries match META_MOVE_KIND_TO_SHORTCUT exactly', () => {
    const metaEntries = entriesIn('meta-move-kind');
    expect(metaEntries.map((entry) => entry.id)).toEqual(
      META_MOVE_KINDS.map((kind) => `meta-move-kind.${kind}`),
    );
    for (const kind of META_MOVE_KINDS) {
      const entry = metaEntries.find((candidate) => candidate.id === `meta-move-kind.${kind}`);
      expect(entry?.chord.key).toBe(META_MOVE_KIND_TO_SHORTCUT[kind]);
    }
  });
});

describe('GLOBAL_KEYMAP — expected action / navigation ids (b)', () => {
  const byId = new Map(GLOBAL_KEYMAP.map((entry) => [entry.id, entry]));

  it('snapshot is present and reachable', () => {
    expect(byId.get('action.snapshot')?.reachable).toBe(true);
  });

  it('propose is present and reachable', () => {
    expect(byId.get('action.propose')?.reachable).toBe(true);
  });

  it('commit is present and NOT reachable (deferred)', () => {
    expect(byId.has('action.commit')).toBe(true);
    expect(byId.get('action.commit')?.reachable).toBe(false);
  });

  it('esc is present and reachable', () => {
    expect(byId.get('navigation.esc')?.reachable).toBe(true);
  });

  it('help (the `?` overlay toggle) is present, reachable, and bound to `?`', () => {
    const help = byId.get('navigation.help');
    expect(help?.reachable).toBe(true);
    expect(help?.chord).toEqual({ key: '?' });
    expect(help?.labelKey).toBe('moderator.globalKeymap.helpLabel');
  });

  it('mode-entry chords are present and NOT reachable', () => {
    for (const id of ['mode.decompose', 'mode.warrant-elicitation', 'mode.operationalization']) {
      expect(byId.has(id)).toBe(true);
      expect(byId.get(id)?.reachable).toBe(false);
    }
  });
});

describe('GLOBAL_KEYMAP — chord distinctness & collision-freedom', () => {
  it('(c) action / navigation / mode chords are mutually distinct triples', () => {
    const chords = GLOBAL_KEYMAP.filter((entry) =>
      ['action', 'navigation', 'mode'].includes(entry.category),
    ).map((entry) => `${!!entry.chord.platformModifier}|${!!entry.chord.shift}|${entry.chord.key}`);
    expect(new Set(chords).size).toBe(chords.length);
  });

  it('(d) no action / navigation chord key collides with a single-letter shortcut', () => {
    // The single-letter shortcuts (captureKeymap) fire only when NO
    // platform/alt modifier is held. An action/navigation chord can
    // therefore collide with a bare letter only if it requires no
    // platform modifier AND reuses one of those letters.
    const singleLetterKeys = new Set<string>([
      ...Object.values(KIND_TO_SHORTCUT),
      ...Object.values(EDGE_ROLE_TO_SHORTCUT),
      ...Object.values(META_MOVE_KIND_TO_SHORTCUT),
    ]);
    const actionNav = GLOBAL_KEYMAP.filter((entry) =>
      ['action', 'navigation'].includes(entry.category),
    );
    for (const entry of actionNav) {
      if (!entry.chord.platformModifier) {
        expect(singleLetterKeys.has(entry.chord.key)).toBe(false);
      }
    }
  });
});

describe('GLOBAL_KEYMAP — labelKey resolution (e)', () => {
  for (const entry of GLOBAL_KEYMAP) {
    for (const locale of SUPPORTED_LOCALES) {
      it(`${entry.id} resolves labelKey in ${locale}`, () => {
        const value = resolve(CATALOGS[locale], entry.labelKey);
        expect(typeof value).toBe('string');
        expect((value as string).length).toBeGreaterThan(0);
      });
    }
  }
});
