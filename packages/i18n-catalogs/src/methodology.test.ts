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
  // Per-facet `FacetStatus` enum entries. The first four are the
  // agreement-layer statuses shipped by
  // `i18n_methodology_glossary`; `committed` + `withdrawn` are the
  // closed-lifecycle statuses landed by
  // `tasks/refinements/moderator-ui/mod_per_facet_breakdown.md`
  // (Decision §10) — the per-facet breakdown's chip uses these for
  // the `aria-label` + screen-reader prose alongside the visual
  // border / ring / opacity vocabulary.
  facetState: ['proposed', 'agreed', 'disputed', 'meta-disagreement', 'committed', 'withdrawn'],
  // Per-facet identifiers. Refinement:
  // `tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md`.
  // The moderator's per-facet pill row resolves
  // `methodology.facet.<name>` for each pill; the round-trip below
  // pins every locale's catalog entry for the three v1 facets. The
  // `proposal` entry is the synthetic lifecycle facet name used by
  // `tasks/refinements/moderator-ui/mod_per_facet_breakdown.md`'s
  // structural-sub-kind chips (Decision §4 + §10).
  facet: ['wording', 'classification', 'substance', 'proposal'],
  voteChoice: ['agree', 'dispute', 'withdraw'],
  // Per-participant vote-indicator verb-form fragments. Refinement:
  // `tasks/refinements/moderator-ui/mod_vote_indicators_on_graph.md`.
  // Distinct from `voteChoice` — the indicator's aria-label substitutes
  // the verb-form here ("voted agree") while `voteChoice` is the
  // title-case noun ("Agree" / "Dispute" / "Withdraw").
  voteIndicatorChoice: ['agree', 'dispute', 'withdraw'],
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
  'pt-BR::methodology.edgeRole.defines.label',
  'es-419::methodology.edgeRole.defines.label',
]);

async function makeT(locale: SupportedLocale): Promise<(key: string) => string> {
  const instance = i18next.createInstance();
  await instance.use(ICU).init(buildInitOptions(locale));
  return (key: string) => instance.t(key);
}

/**
 * Build the dotted-path key for a given group + id.
 *
 * The `edgeRole` group migrated from a bare-label string at
 * `methodology.edgeRole.<role>` to a `{label, description}` object at
 * `methodology.edgeRole.<role>.{label, description}` in
 * `frontend_i18n.i18n_methodology_role_descriptions`. The label round-
 * trip now reads `methodology.edgeRole.<role>.label`; the description
 * round-trip (separate `describe` block below) reads `<role>.description`.
 * Other groups remain bare-leaf entries at `methodology.<group>.<id>`.
 */
function leafKey(group: keyof typeof METHODOLOGY_VALUES, id: string): string {
  if (group === 'edgeRole') {
    return `methodology.edgeRole.${id}.label`;
  }
  return `methodology.${group}.${id}`;
}

describe('methodology glossary round-trip', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const [group, ids] of Object.entries(METHODOLOGY_VALUES) as [
        keyof typeof METHODOLOGY_VALUES,
        readonly string[],
      ][]) {
        for (const id of ids) {
          const key = leafKey(group, id);
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
        const key = leafKey(group, id);
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

  it('pt-BR methodology.edgeRole.bridges-from.label = "Ponte de"', async () => {
    const t = await makeT('pt-BR');
    expect(t('methodology.edgeRole.bridges-from.label')).toBe('Ponte de');
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

// edgeRole description round-trip (i18n_methodology_role_descriptions).
//
// Each `methodology.edgeRole.<role>` entry migrated from a bare label
// string to a `{label, description}` object so the moderator's edge
// hover-popover surfaces a one-sentence role description on hover. The
// label round-trip above resolves `<role>.label`; this block pins that
// the new `<role>.description` sub-key resolves to a non-empty,
// locale-distinct string for every role in every locale.

describe('methodology edgeRole description round-trip', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const id of METHODOLOGY_VALUES.edgeRole) {
        const key = `methodology.edgeRole.${id}.description`;
        it(`resolves ${key} to a non-empty string`, async () => {
          const t = await makeT(locale);
          const value = t(key);
          expect(value).toBeTruthy();
          expect(value.length).toBeGreaterThan(0);
          // i18next returns the dotted key when the entry is missing.
          expect(value).not.toBe(key);
        });
      }
    });
  }

  it('non-en-US edgeRole descriptions differ from en-US (drafts translate, not copy)', async () => {
    const tEn = await makeT('en-US');
    const tPt = await makeT('pt-BR');
    const tEs = await makeT('es-419');
    for (const id of METHODOLOGY_VALUES.edgeRole) {
      const key = `methodology.edgeRole.${id}.description`;
      const en = tEn(key);
      expect(tPt(key), `pt-BR.${key} should differ from en-US`).not.toBe(en);
      expect(tEs(key), `es-419.${key} should differ from en-US`).not.toBe(en);
    }
  });
});

describe('methodology edgeRole description: known canonical translations', () => {
  // One fixed-expectation per locale; pins the canonical authoritative
  // en-US string + the draft pt-BR / es-419 strings landed by
  // i18n_methodology_role_descriptions. The drafts are flagged PENDING
  // in the sibling *.review.json trackers — the native-review follow-up
  // may revise them, in which case this test moves with the catalog.
  it('en-US methodology.edgeRole.supports.description matches the canonical sentence', async () => {
    const t = await makeT('en-US');
    expect(t('methodology.edgeRole.supports.description')).toBe(
      'Source provides evidence or backing for target.',
    );
  });

  it('pt-BR methodology.edgeRole.supports.description matches the draft sentence', async () => {
    const t = await makeT('pt-BR');
    expect(t('methodology.edgeRole.supports.description')).toBe(
      'A fonte fornece evidência ou base para o alvo.',
    );
  });

  it('es-419 methodology.edgeRole.supports.description matches the draft sentence', async () => {
    const t = await makeT('es-419');
    expect(t('methodology.edgeRole.supports.description')).toBe(
      'La fuente aporta evidencia o respaldo al objetivo.',
    );
  });
});

// Hover-popover ICU template (mod_edge_popover_full_target_wording +
// mod_hover_popover_endpoint_kind_disambiguation).
//
// `moderator.hoverPopover.edgeEndpointsReference` is the ICU template
// the edge popover renders in place of the retired
// `moderator.hoverPopover.edgeEndpoints` wording-bearing template. The
// template substitutes `{sourceId}` / `{targetId}` (the canvas-stable
// node-id pair) plus `{sourceKind}` / `{targetKind}` (each fed through
// an ICU `select` block per
// `mod_hover_popover_endpoint_kind_disambiguation` Decision §3 — the
// per-kind labels live inline rather than as a separate
// `endpointKind.<kind>` catalog key family). The arrow + parens are
// ASCII per the existing `typography.ts:V1_LOCALE_CODEPOINT_RANGES`
// policy (Latin Extended-A + General Punctuation only, no Arrows
// block expansion); the localized surface is the kind noun inside
// the parens.
//
// The negative-assertion block also pins that the retired
// `moderator.hoverPopover.edgeEndpoints` key no longer resolves in any
// locale (returns the literal key string, i18next's documented miss
// behavior under `returnNull: false`).

describe('moderator.hoverPopover.edgeEndpointsReference round-trip', () => {
  for (const locale of SUPPORTED_LOCALES) {
    it(`resolves the edgeEndpointsReference template with ICU substitutions in ${locale}`, async () => {
      // The shared `makeT` helper above returns a no-args `t`; this
      // case needs ICU substitution so we build a per-test instance
      // and pass the substitution map directly.
      const instance = i18next.createInstance();
      await instance.use(ICU).init(buildInitOptions(locale));
      const rendered = instance.t('moderator.hoverPopover.edgeEndpointsReference', {
        sourceId: 'src-1',
        targetId: 'tgt-1',
        sourceKind: 'node',
        targetKind: 'node',
      });
      // Non-empty.
      expect(rendered).toBeTruthy();
      expect(rendered.length).toBeGreaterThan(0);
      // Not the raw key (i18next returns the key when missing).
      expect(rendered).not.toBe('moderator.hoverPopover.edgeEndpointsReference');
      // Every ICU placeholder was substituted.
      expect(rendered).toContain('src-1');
      expect(rendered).toContain('tgt-1');
      // Punctuation invariant — ASCII `->` arrow per the typography
      // codepoint-range policy referenced above.
      expect(rendered).toContain('->');
    });
  }

  // Per-locale kind-suffix substitutions (mod_hover_popover_endpoint_kind_disambiguation).
  // Each locale's `select` arms render its own noun for `node` /
  // `annotation`; the round-trip catches a catalog-row drift in any
  // single locale.
  const KIND_LABELS = {
    'en-US': { node: 'node', annotation: 'annotation' },
    'pt-BR': { node: 'nó', annotation: 'anotação' },
    'es-419': { node: 'nodo', annotation: 'anotación' },
  } as const;
  for (const locale of SUPPORTED_LOCALES) {
    it(`renders the localized (kind) suffix for both endpoints in ${locale}`, async () => {
      const instance = i18next.createInstance();
      await instance.use(ICU).init(buildInitOptions(locale));
      const labels = KIND_LABELS[locale];
      const rendered = instance.t('moderator.hoverPopover.edgeEndpointsReference', {
        sourceId: 'src-1',
        targetId: 'tgt-1',
        sourceKind: 'node',
        targetKind: 'annotation',
      });
      expect(rendered).toContain(`src-1 (${labels.node})`);
      expect(rendered).toContain(`tgt-1 (${labels.annotation})`);
      expect(rendered).toContain('->');
    });
  }

  it('renders the ICU `other {?}` fallback for an unrecognized endpoint kind across every locale', async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const instance = i18next.createInstance();
      await instance.use(ICU).init(buildInitOptions(locale));
      const rendered = instance.t('moderator.hoverPopover.edgeEndpointsReference', {
        sourceId: 'src-1',
        targetId: 'tgt-1',
        sourceKind: 'unknown-future-kind',
        targetKind: 'unknown-future-kind',
      });
      // The select's `other {?}` arm renders `?` — no thrown error, no
      // catalog miss; the renderer surfaces a typographic neutral
      // instead of an unlocalized identifier.
      expect(rendered, `${locale} fallback`).toContain('(?)');
    }
  });

  it('retires the legacy moderator.hoverPopover.edgeEndpoints key from every locale', async () => {
    // i18next returns the key itself when no translation is found
    // (config.ts pins `returnNull: false`). A literal-key result here
    // is the contract that the catalog entry was removed in this task.
    for (const locale of SUPPORTED_LOCALES) {
      const instance = i18next.createInstance();
      await instance.use(ICU).init(buildInitOptions(locale));
      const rendered = instance.t('moderator.hoverPopover.edgeEndpoints', {
        role: 'Supports',
        sourceWording: 'A wording',
        targetWording: 'B wording',
      });
      expect(
        rendered,
        `moderator.hoverPopover.edgeEndpoints must NOT resolve in ${locale} (the catalog entry was removed by mod_edge_popover_full_target_wording)`,
      ).toBe('moderator.hoverPopover.edgeEndpoints');
    }
  });
});
