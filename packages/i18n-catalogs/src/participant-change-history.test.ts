// Tests for the participant change-history chrome + kind-label strings.
//
// Refinement: tasks/refinements/participant-ui/part_history_list.md
//             (Acceptance §8 — the new `participant.changeHistory.*` keys
//             and `participant.proposalsTab.historyLabel` are present in
//             en-US, pt-BR, and es-419 and parse under ICU. The kind-label
//             values duplicate the already-approved
//             `moderator.changeHistory.kind.*` translations, so the
//             native-speaker review (`frontend_i18n.i18n_participant_change_
//             history_native_review`) is a parity check, not a fresh
//             translation.)
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

/** The 17 event kinds, mirroring `moderator.changeHistory.kind.*`. */
const EVENT_KINDS = [
  'session-created',
  'session-ended',
  'participant-joined',
  'participant-left',
  'node-created',
  'edge-created',
  'annotation-created',
  'entity-included',
  'proposal',
  'vote',
  'commit',
  'meta-disagreement-marked',
  'snapshot-created',
  'entity-removed',
  'session-mode-changed',
  'withdraw-agreement',
  'proposal-withdrawn',
] as const;

/** The chrome leaf keys (relative to `participant.changeHistory`). */
const CHROME_KEYS = [
  'paneAriaLabel',
  'systemActor',
  'loading',
  'error',
  'retry',
  'emptyState',
] as const;

/** All dotted keys this leaf introduces, relative to `participant`. */
const ALL_KEYS = [
  'proposalsTab.historyLabel',
  ...CHROME_KEYS.map((k) => `changeHistory.${k}`),
  ...EVENT_KINDS.map((k) => `changeHistory.kind.${k}`),
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

describe('participant.changeHistory: keys present in every locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const sub of ALL_KEYS) {
        const key = `participant.${sub}`;
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

describe('participant.changeHistory templates: ICU MessageFormat parses', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const sub of ALL_KEYS) {
        const key = `participant.${sub}`;
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

describe('participant.changeHistory: en-US oracle values', () => {
  it('renders the tab label, chrome strings, and the kind labels', async () => {
    const t = await makeT('en-US');
    expect(t('participant.proposalsTab.historyLabel')).toBe('History');
    expect(t('participant.changeHistory.paneAriaLabel')).toBe('Change history list');
    expect(t('participant.changeHistory.systemActor')).toBe('System');
    expect(t('participant.changeHistory.loading')).toBe('Loading change history…');
    expect(t('participant.changeHistory.error')).toBe("Couldn't load the change history.");
    expect(t('participant.changeHistory.retry')).toBe('Retry');
    expect(t('participant.changeHistory.emptyState')).toBe('No events yet');
    expect(t('participant.changeHistory.kind.node-created')).toBe('Statement created');
    expect(t('participant.changeHistory.kind.vote')).toBe('Vote');
  });
});

// ---------------------------------------------------------------
// (4) Parity — the duplicated kind-label values match the approved
//     `moderator.changeHistory.kind.*` translations in every locale.
// ---------------------------------------------------------------

describe('participant.changeHistory.kind.*: parity with the moderator catalog', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const kind of EVENT_KINDS) {
      it(`${locale} ${kind} matches moderator`, () => {
        const participantValue = lookup(
          CATALOG_DATA[locale],
          `participant.changeHistory.kind.${kind}`,
        );
        const moderatorValue = lookup(CATALOG_DATA[locale], `moderator.changeHistory.kind.${kind}`);
        expect(participantValue).toBe(moderatorValue);
      });
    }
  }
});
