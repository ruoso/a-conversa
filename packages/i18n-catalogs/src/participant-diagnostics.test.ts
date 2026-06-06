// Tests for the participant diagnostics-list chrome strings.
//
// Refinement: tasks/refinements/participant-ui/part_diagnostics_list.md
//             (Acceptance §4 — the new `participant.diagnostics.*` keys
//             pass the catalog presence / ICU-parse / render suite for
//             en-US plus the draft pt-BR / es-419, consistent with how
//             `diagnostics.test.ts` guards the shared `diagnostics.<kind>.*`
//             keys.)
// ADRs:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md,
//              docs/adr/0022-no-throwaway-verifications.md
//
// The per-kind `title` / `detail` rows reuse the shared
// `diagnostics.<kind>.*` namespace (already guarded by
// `diagnostics.test.ts`); this suite covers only the chrome namespace
// this leaf introduces: the panel header, the empty message, the toggle
// label + count aria, the list count aria, and the severity labels.

import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { IntlMessageFormat } from 'intl-messageformat';

import { buildInitOptions, SUPPORTED_LOCALES, type SupportedLocale } from './config.js';
import enUS from './catalogs/en-US.json' with { type: 'json' };
import ptBR from './catalogs/pt-BR.json' with { type: 'json' };
import es419 from './catalogs/es-419.json' with { type: 'json' };

/** The leaf-string keys (relative to `participant.diagnostics`). */
const PLAIN_KEYS = [
  'header',
  'empty',
  'toggleLabel',
  'severity.blocking',
  'severity.advisory',
] as const;

/** The ICU-templated, count-bearing keys. */
const PLURAL_KEYS = ['toggleAria', 'countAria'] as const;

type CatalogNode = { readonly [key: string]: CatalogNode | string };
const CATALOG_DATA: Record<SupportedLocale, CatalogNode> = {
  'en-US': enUS,
  'pt-BR': ptBR,
  'es-419': es419,
};

function lookup(node: CatalogNode, dotted: string): string {
  const parts = dotted.split('.');
  let cur: CatalogNode | string = node;
  for (const part of parts) {
    if (typeof cur === 'string') {
      throw new Error(`lookup overshot at ${part}; ${dotted} hit a leaf early`);
    }
    const next: CatalogNode | string | undefined = cur[part];
    if (next === undefined) {
      throw new Error(`missing key ${dotted} (failed at ${part})`);
    }
    cur = next;
  }
  if (typeof cur !== 'string') {
    throw new Error(`key ${dotted} did not resolve to a leaf string`);
  }
  return cur;
}

async function makeT(
  locale: SupportedLocale,
): Promise<(key: string, vars?: Record<string, unknown>) => string> {
  const instance = i18next.createInstance();
  await instance.use(ICU).init(buildInitOptions(locale));
  return (key: string, vars?: Record<string, unknown>) =>
    vars === undefined ? instance.t(key) : instance.t(key, { ...vars });
}

// ---------------------------------------------------------------
// (1) Presence — every key resolves to a non-empty leaf in each locale.
// ---------------------------------------------------------------

describe('participant.diagnostics: keys present in every locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const sub of [...PLAIN_KEYS, ...PLURAL_KEYS]) {
        const key = `participant.diagnostics.${sub}`;
        it(`has ${key}`, () => {
          const value = lookup(CATALOG_DATA[locale], key);
          expect(value).toBeTruthy();
          expect(value.length).toBeGreaterThan(0);
        });
      }
    });
  }
});

// ---------------------------------------------------------------
// (2) ICU syntax parses for every templated key.
// ---------------------------------------------------------------

describe('participant.diagnostics templates: ICU MessageFormat parses', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const sub of PLURAL_KEYS) {
        const key = `participant.diagnostics.${sub}`;
        it(`parses ${key}`, () => {
          const template = lookup(CATALOG_DATA[locale], key);
          expect(() => new IntlMessageFormat(template, locale)).not.toThrow();
        });
      }
    });
  }
});

// ---------------------------------------------------------------
// (3) Count-bearing keys render through `t(...)` with no leftover
//     placeholders, across the =0 / one / other plural branches.
// ---------------------------------------------------------------

describe('participant.diagnostics: count keys render across plural branches', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const sub of PLURAL_KEYS) {
        const key = `participant.diagnostics.${sub}`;
        for (const count of [0, 1, 5]) {
          it(`${key} renders for count=${count}`, async () => {
            const t = await makeT(locale);
            const rendered = t(key, { count });
            expect(rendered).toBeTruthy();
            expect(rendered).not.toBe(key);
            expect(rendered).not.toContain('{count}');
          });
        }
      }
    });
  }
});

// ---------------------------------------------------------------
// (4) en-US oracle — the exact strings the component + e2e assert.
// ---------------------------------------------------------------

describe('participant.diagnostics: en-US oracle values', () => {
  it('renders the panel header, empty message, severity labels, and count branches', async () => {
    const t = await makeT('en-US');
    expect(t('participant.diagnostics.header')).toBe('Active diagnostics');
    expect(t('participant.diagnostics.toggleLabel')).toBe('Diagnostics');
    expect(t('participant.diagnostics.severity.blocking')).toBe('Blocking');
    expect(t('participant.diagnostics.severity.advisory')).toBe('Advisory');
    expect(t('participant.diagnostics.empty')).toBe('No structural problems are open right now.');
    expect(t('participant.diagnostics.toggleAria', { count: 0 })).toBe('No active diagnostics');
    expect(t('participant.diagnostics.countAria', { count: 1 })).toBe('1 active diagnostic');
    expect(t('participant.diagnostics.countAria', { count: 3 })).toBe('3 active diagnostics');
  });
});
