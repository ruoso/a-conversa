// Tests for the participant change-history filter strip chrome strings.
//
// Refinement: tasks/refinements/participant-ui/part_history_filtering.md
//             (Acceptance §8 — the new `participant.historyFilter.*` keys
//             are present in en-US, pt-BR, and es-419 and parse under ICU.
//             The pt-BR + es-419 drafts mirror the already-approved
//             `moderator.historyFilter.*` values, so the native-speaker
//             review is a parity check, not a fresh translation.)
// ADRs:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md,
//              docs/adr/0022-no-throwaway-verifications.md

import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { IntlMessageFormat } from 'intl-messageformat';

import { buildInitOptions, SUPPORTED_LOCALES, type SupportedLocale } from './config.js';
import enUS from './catalogs/en-US.json' with { type: 'json' };
import ptBR from './catalogs/pt-BR.json' with { type: 'json' };
import es419 from './catalogs/es-419.json' with { type: 'json' };

/**
 * The five chrome leaf keys this leaf introduces (relative to
 * `participant.historyFilter`). The moderator's `targetToggleLabel` /
 * `targetDisabledHint` are dropped with the target dimension (Decision §D4).
 */
const FILTER_KEYS = [
  'regionAriaLabel',
  'kindGroupAriaLabel',
  'actorGroupAriaLabel',
  'clearLabel',
  'filteredEmpty',
] as const;

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

describe('participant.historyFilter: keys present in every locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const sub of FILTER_KEYS) {
        const key = `participant.historyFilter.${sub}`;
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
// (2) ICU syntax parses for every key (the strings are plain, but the
//     parse guard catches a stray brace introduced in a future edit).
// ---------------------------------------------------------------

describe('participant.historyFilter templates: ICU MessageFormat parses', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const sub of FILTER_KEYS) {
        const key = `participant.historyFilter.${sub}`;
        it(`parses ${key}`, () => {
          const template = lookup(CATALOG_DATA[locale], key);
          expect(() => new IntlMessageFormat(template, locale)).not.toThrow();
        });
      }
    });
  }
});

// ---------------------------------------------------------------
// (3) en-US oracle — the exact strings the component + e2e assert.
// ---------------------------------------------------------------

describe('participant.historyFilter: en-US oracle values', () => {
  it('renders the strip chrome strings', async () => {
    const t = await makeT('en-US');
    expect(t('participant.historyFilter.regionAriaLabel')).toBe('Change history filters');
    expect(t('participant.historyFilter.kindGroupAriaLabel')).toBe('Filter by event kind');
    expect(t('participant.historyFilter.actorGroupAriaLabel')).toBe('Filter by actor');
    expect(t('participant.historyFilter.clearLabel')).toBe('Clear filters');
    expect(t('participant.historyFilter.filteredEmpty')).toBe('No events match the current filter');
  });
});

// ---------------------------------------------------------------
// (4) Parity — the duplicated chrome values match the approved
//     `moderator.historyFilter.*` translations in every locale (the two
//     target-dimension keys are intentionally absent, Decision §D4).
// ---------------------------------------------------------------

describe('participant.historyFilter.*: parity with the moderator catalog', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const sub of FILTER_KEYS) {
      it(`${locale} ${sub} matches moderator`, () => {
        const participantValue = lookup(CATALOG_DATA[locale], `participant.historyFilter.${sub}`);
        const moderatorValue = lookup(CATALOG_DATA[locale], `moderator.historyFilter.${sub}`);
        expect(participantValue).toBe(moderatorValue);
      });
    }
  }
});
