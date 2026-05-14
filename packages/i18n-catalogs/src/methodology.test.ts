// Tests for the methodology glossary catalog entries.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_methodology_glossary.md
// ADRs:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: frontend_i18n.i18n_methodology_glossary
//
// Acceptance criteria from the refinement:
//
//   "A unit test exists that round-trips every English methodology value
//    through `t('methodology.kind.fact')` etc. and asserts non-empty
//    resolution in each locale."
//
// This file is that test. For every English wire-format identifier in
// `METHODOLOGY_VALUES` we resolve `methodology.<group>.<id>` in each of
// the three v1 locales and assert:
//
//   - The resolved string is non-empty.
//   - The resolved string is NOT the dotted key itself (which is
//     i18next's behavior when a key is missing; `returnNull: false` in
//     `buildInitOptions` makes the miss visible as the key string).
//   - For non-en-US locales, the resolved string is different from the
//     en-US value (sanity: we actually translated, not just copied
//     the English label). This catch is intentionally narrow — three
//     entries legitimately share their English form across the three
//     v1 locales (the cognate cases `Define` and `Valor` and
//     `Normativa` etc.), so the check is structural-only and not
//     applied at the leaf-value level. See `STRUCTURALLY_IDENTICAL`
//     below for the explicit allow-list of cross-locale collisions
//     that are not bugs.
//
// Per ADR 0022 this is a committed regression test — the empirical
// question "do the methodology keys resolve in every locale" is
// answered here once and re-answered on every CI run forever.

import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import ICU from 'i18next-icu';

import { buildInitOptions, SUPPORTED_LOCALES, type SupportedLocale } from './config.js';

/**
 * The canonical English methodology vocabulary. Keys mirror the
 * wire-format identifiers in `packages/shared-types/src/events/enums.ts`
 * (when that package lands; the values here are the source-of-truth
 * names from `docs/data-model.md` and `docs/methodology.md`). Adding
 * a new methodology identifier requires adding it here so the
 * round-trip test catches a missing catalog entry.
 */
const METHODOLOGY_VALUES = {
  kind: ['fact', 'predictive', 'value', 'normative', 'definitional'],
  edgeRole: [
    'supports',
    'rebuts',
    'qualifies',
    'bridges-from',
    'bridges-to',
    'defines',
    'contradicts',
  ],
  facetState: ['proposed', 'agreed', 'disputed', 'meta-disagreement'],
  // Per-facet identifiers. Refinement:
  // `tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md`.
  // The moderator's per-facet pill row resolves
  // `methodology.facet.<name>` for each pill; the round-trip below
  // pins every locale's catalog entry for the three v1 facets.
  facet: ['wording', 'classification', 'substance'],
  voteChoice: ['agree', 'dispute', 'withdraw'],
  annotationKind: ['note', 'reframe', 'scope-change', 'stance'],
  diagnostic: ['cycle', 'contradiction', 'multi-warrant', 'dangling-claim', 'coherency-hint'],
} as const;

/**
 * Cross-locale collisions that are legitimate cognates, NOT a missed
 * translation. The methodology vocabulary draws from a shared
 * Romance/Latinate stock; some terms render identically in en-US and
 * pt-BR / es-419. The acceptance test's "non-en-US value differs from
 * en-US" check is suppressed for entries listed here.
 *
 * Each entry is a `{locale}::methodology.<group>.<id>` triple. Adding
 * an entry is a deliberate decision: it asserts "this cognate is the
 * faithful localization, not a stub awaiting translation."
 */
const STRUCTURALLY_IDENTICAL: ReadonlySet<string> = new Set([
  // en-US "Define" / pt-BR "Define" / es-419 "Define" — same Latin verb
  // form in all three; nothing to translate.
  'pt-BR::methodology.edgeRole.defines',
  'es-419::methodology.edgeRole.defines',
]);

async function makeT(locale: SupportedLocale): Promise<(key: string) => string> {
  const instance = i18next.createInstance();
  await instance.use(ICU).init(buildInitOptions(locale));
  return (key: string) => instance.t(key);
}

describe('methodology glossary round-trip', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const [group, ids] of Object.entries(METHODOLOGY_VALUES) as [
        keyof typeof METHODOLOGY_VALUES,
        readonly string[],
      ][]) {
        for (const id of ids) {
          const key = `methodology.${group}.${id}`;
          it(`resolves ${key} to a non-empty string`, async () => {
            const t = await makeT(locale);
            const value = t(key);
            // Non-empty.
            expect(value).toBeTruthy();
            expect(value.length).toBeGreaterThan(0);
            // Not the key itself (i18next returns the key when missing).
            expect(value).not.toBe(key);
          });
        }
      }
    });
  }
});

describe('methodology glossary: non-en-US locales translate (not copy) en-US', () => {
  it('every methodology key resolves to a locale-distinct string except for documented cognates', async () => {
    const tEn = await makeT('en-US');
    const tPt = await makeT('pt-BR');
    const tEs = await makeT('es-419');

    for (const [group, ids] of Object.entries(METHODOLOGY_VALUES) as [
      keyof typeof METHODOLOGY_VALUES,
      readonly string[],
    ][]) {
      for (const id of ids) {
        const key = `methodology.${group}.${id}`;
        const en = tEn(key);
        const pt = tPt(key);
        const es = tEs(key);

        if (!STRUCTURALLY_IDENTICAL.has(`pt-BR::${key}`)) {
          expect(pt, `pt-BR.${key} should differ from en-US`).not.toBe(en);
        }
        if (!STRUCTURALLY_IDENTICAL.has(`es-419::${key}`)) {
          expect(es, `es-419.${key} should differ from en-US`).not.toBe(en);
        }
      }
    }
  });
});

describe('methodology glossary: known canonical translations', () => {
  // A small smoke set of fixed expectations from the glossary table in
  // the refinement. If the canonical mapping is edited, this test must
  // be updated alongside the catalog JSON — the test is the regression
  // gate against accidental glossary drift.
  it('en-US methodology.kind.fact = "Fact"', async () => {
    const t = await makeT('en-US');
    expect(t('methodology.kind.fact')).toBe('Fact');
  });

  it('pt-BR methodology.kind.fact = "Fato"', async () => {
    const t = await makeT('pt-BR');
    expect(t('methodology.kind.fact')).toBe('Fato');
  });

  it('es-419 methodology.kind.fact = "Hecho"', async () => {
    const t = await makeT('es-419');
    expect(t('methodology.kind.fact')).toBe('Hecho');
  });

  it('pt-BR methodology.edgeRole.bridges-from = "Ponte de"', async () => {
    const t = await makeT('pt-BR');
    expect(t('methodology.edgeRole.bridges-from')).toBe('Ponte de');
  });

  it('es-419 methodology.facetState.meta-disagreement = "Meta-desacuerdo"', async () => {
    const t = await makeT('es-419');
    expect(t('methodology.facetState.meta-disagreement')).toBe('Meta-desacuerdo');
  });

  it('pt-BR methodology.diagnostic.coherency-hint = "Sugestão de coerência"', async () => {
    const t = await makeT('pt-BR');
    expect(t('methodology.diagnostic.coherency-hint')).toBe('Sugestão de coerência');
  });
});
