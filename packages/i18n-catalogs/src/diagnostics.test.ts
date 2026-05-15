// Tests for the structural-diagnostic description catalog entries.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_diagnostic_descriptions.md
// ADRs:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: frontend_i18n.i18n_diagnostic_descriptions
//
// Acceptance criteria from the refinement (paraphrased):
//
//   1. `packages/i18n-catalogs/*` contain `title`, `description`, and
//      `action` (with optional `detail`) for each diagnostic kind in
//      each of the three locales.
//   2. ICU plural / select syntax validates against `IntlMessageFormat`
//      with sample payloads (no parse errors).
//   3. A vitest test, given a sample diagnostic event payload for each
//      kind, produces a non-empty rendered string in each locale and
//      the string contains the expected localized methodology terms
//      (composed via separate `t(...)` calls per the refinement's
//      "templates compose via lookup, not literal text" rule).
//   4. The parity-check from `i18n_catalog_workflow` passes — handled
//      by `scripts/check-parity.ts`; this file does not duplicate it.
//
// Per ADR 0022 these are committed regression tests — the empirical
// questions "do the diagnostic descriptions parse as ICU" and "do they
// render with sample payloads" are answered here once and re-answered
// on every CI run forever.

import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { IntlMessageFormat } from 'intl-messageformat';

import { buildInitOptions, SUPPORTED_LOCALES, type SupportedLocale } from './config.js';
import enUS from './catalogs/en-US.json' with { type: 'json' };
import ptBR from './catalogs/pt-BR.json' with { type: 'json' };
import es419 from './catalogs/es-419.json' with { type: 'json' };

/**
 * The five structural diagnostic kinds, mirroring the wire-format
 * identifiers under `methodology.diagnostic.*` (the labels-only entries
 * landed by `i18n_methodology_glossary`) and the detection sources at
 * `apps/server/src/diagnostics/{cycle,contradiction,multi-warrant,
 * dangling-claim,coherency-hint}-detection.ts`.
 */
const DIAGNOSTIC_KINDS = [
  'cycle',
  'contradiction',
  'multi-warrant',
  'dangling-claim',
  'coherency-hint',
] as const;

/**
 * The sub-keys every diagnostic kind must define. `title` is the short
 * panel label, `description` is the templated prose (ICU MessageFormat,
 * with payload interpolation), `detail` is the longer-form expanded
 * copy, `action` is the moderator's typical next step.
 */
const REQUIRED_SUBKEYS = ['title', 'description', 'detail', 'action'] as const;

/**
 * Per-locale sample payloads for each kind. These exercise the ICU
 * plural / select branches in each `description` template — `=2`,
 * `one`, and `other` for the kinds that pluralize, and the role +
 * nodes interpolation for the rest. Pulled from the detector payload
 * shapes documented in `apps/server/src/diagnostics/*-detection.ts`.
 */
const SAMPLE_PAYLOADS: Record<(typeof DIAGNOSTIC_KINDS)[number], Array<Record<string, unknown>>> = {
  cycle: [{ role: 'Supports', nodes: 'N1, N2, N3' }],
  contradiction: [{ count: 1 }, { count: 2 }, { count: 5 }],
  'multi-warrant': [
    { count: 2, nodes: 'W1, W2' },
    { count: 3, nodes: 'W1, W2, W3' },
  ],
  'dangling-claim': [{ nodes: 'N7' }],
  'coherency-hint': [
    { count: 1, kind: 'incomplete-warrant-missing-bridges-to' },
    { count: 3, kind: 'self-contradicts' },
  ],
};

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
// (1) Required-sub-keys presence across every kind and locale.
// ---------------------------------------------------------------

describe('diagnostic descriptions: required sub-keys present in every locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const kind of DIAGNOSTIC_KINDS) {
        for (const sub of REQUIRED_SUBKEYS) {
          const key = `diagnostics.${kind}.${sub}`;
          it(`has ${key}`, () => {
            const value = lookup(CATALOG_DATA[locale], key);
            expect(value).toBeTruthy();
            expect(value.length).toBeGreaterThan(0);
          });
        }
      }
    });
  }
});

// ---------------------------------------------------------------
// (2) ICU syntax parses for every description / detail / action.
// ---------------------------------------------------------------
//
// `IntlMessageFormat`'s constructor throws on a parse failure. Running
// each template through it catches a mangled `{count, plural, ...}` or
// an unbalanced brace at test time rather than at first-render time
// in the moderator UI.

describe('diagnostic description templates: ICU MessageFormat parses', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const kind of DIAGNOSTIC_KINDS) {
        for (const sub of REQUIRED_SUBKEYS) {
          const key = `diagnostics.${kind}.${sub}`;
          it(`parses ${key}`, () => {
            const template = lookup(CATALOG_DATA[locale], key);
            expect(() => new IntlMessageFormat(template, locale)).not.toThrow();
          });
        }
      }
    });
  }
});

// ---------------------------------------------------------------
// (3) Per-kind sample payloads render through `t(...)` to non-empty
//     strings in every locale.
// ---------------------------------------------------------------

describe('diagnostic descriptions render with sample payloads', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const kind of DIAGNOSTIC_KINDS) {
        for (const payload of SAMPLE_PAYLOADS[kind]) {
          it(`${kind} description renders with payload ${JSON.stringify(payload)}`, async () => {
            const t = await makeT(locale);
            const rendered = t(`diagnostics.${kind}.description`, payload);
            expect(rendered).toBeTruthy();
            // Should not be the bare key (i18next returns the key on a
            // missing translation).
            expect(rendered).not.toBe(`diagnostics.${kind}.description`);
            // Should not contain unsubstituted placeholders for the
            // keys we passed.
            for (const placeholder of Object.keys(payload)) {
              expect(rendered).not.toContain(`{${placeholder}}`);
            }
          });
        }
      }
    });
  }
});

// ---------------------------------------------------------------
// (4) Methodology terms compose via the glossary, not literal text.
// ---------------------------------------------------------------
//
// The refinement is explicit: "templates use `{role}` interpolation
// and the caller passes `t('methodology.edgeRole.supports')` rather
// than literal 'supports' / 'Apoia' / 'Apoya'. One source of truth
// (the glossary)." This test wires the `cycle.description` template
// to the localized `methodology.edgeRole.supports` value and asserts
// the rendered output contains the localized term — confirming the
// composition pattern works end-to-end.

describe('diagnostic descriptions compose with the methodology glossary', () => {
  it('en-US cycle.description composes with methodology.edgeRole.supports.label', async () => {
    const t = await makeT('en-US');
    const role = t('methodology.edgeRole.supports.label');
    const rendered = t('diagnostics.cycle.description', { role, nodes: 'N1, N2' });
    expect(role).toBe('Supports');
    expect(rendered).toContain('Supports');
    expect(rendered).toContain('N1, N2');
  });

  it('pt-BR cycle.description composes with methodology.edgeRole.supports.label', async () => {
    const t = await makeT('pt-BR');
    const role = t('methodology.edgeRole.supports.label');
    const rendered = t('diagnostics.cycle.description', { role, nodes: 'N1, N2' });
    expect(role).toBe('Apoia');
    expect(rendered).toContain('Apoia');
    expect(rendered).toContain('N1, N2');
  });

  it('es-419 cycle.description composes with methodology.edgeRole.supports.label', async () => {
    const t = await makeT('es-419');
    const role = t('methodology.edgeRole.supports.label');
    const rendered = t('diagnostics.cycle.description', { role, nodes: 'N1, N2' });
    expect(role).toBe('Apoya');
    expect(rendered).toContain('Apoya');
    expect(rendered).toContain('N1, N2');
  });
});

// ---------------------------------------------------------------
// (5) Plural branches fire as expected on the kinds that pluralize.
// ---------------------------------------------------------------
//
// Quick regression on the ICU plural arithmetic — `=2` is exact, the
// other branches choose `one` vs. `other` per the locale's CLDR rule.

describe('diagnostic descriptions: plural branches', () => {
  it('en-US contradiction.description: 1 -> singular, 2 -> plural', async () => {
    const t = await makeT('en-US');
    expect(t('diagnostics.contradiction.description', { count: 1 })).toContain('1 contradiction');
    expect(t('diagnostics.contradiction.description', { count: 2 })).toContain('2 contradictions');
  });

  it('en-US multi-warrant.description: =2 selects the "Two warrants" branch', async () => {
    const t = await makeT('en-US');
    const rendered = t('diagnostics.multi-warrant.description', {
      count: 2,
      nodes: 'W1, W2',
    });
    expect(rendered).toContain('Two warrants');
    expect(rendered).toContain('W1, W2');
  });

  it('pt-BR contradiction.description: 1 -> singular, 2 -> plural', async () => {
    const t = await makeT('pt-BR');
    expect(t('diagnostics.contradiction.description', { count: 1 })).toContain('1 contradição');
    expect(t('diagnostics.contradiction.description', { count: 2 })).toContain('2 contradições');
  });

  it('es-419 contradiction.description: 1 -> singular, 2 -> plural', async () => {
    const t = await makeT('es-419');
    expect(t('diagnostics.contradiction.description', { count: 1 })).toContain('1 contradicción');
    expect(t('diagnostics.contradiction.description', { count: 2 })).toContain('2 contradicciones');
  });
});

// ---------------------------------------------------------------
// (6) Title and action are non-empty plain strings (no placeholder
//     leakage) per locale — render with empty payloads.
// ---------------------------------------------------------------

describe('diagnostic descriptions: title and action are renderable with no payload', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const kind of DIAGNOSTIC_KINDS) {
        it(`${kind} title and action render`, async () => {
          const t = await makeT(locale);
          const title = t(`diagnostics.${kind}.title`);
          const action = t(`diagnostics.${kind}.action`);
          expect(title).toBeTruthy();
          expect(action).toBeTruthy();
          expect(title).not.toBe(`diagnostics.${kind}.title`);
          expect(action).not.toBe(`diagnostics.${kind}.action`);
        });
      }
    });
  }
});
