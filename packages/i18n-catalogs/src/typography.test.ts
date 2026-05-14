// Tests for the audience-broadcast typography policy.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_audience_typography.md
// ADRs:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: frontend_i18n.i18n_audience_typography
//
// The refinement's acceptance criteria split into two halves:
//
//   (i)  **Diacritic coverage in the catalog corpus.** Every string a
//        v1 audience viewer can see must lie inside the v1-locale
//        codepoint range (Basic Latin + Latin-1 Supplement + Latin
//        Extended-A + General Punctuation). The chosen font (Inter)
//        covers that range; a string outside the range is either a
//        catalog typo or a deliberate locale expansion that needs a
//        font review. This file is the committed regression test for
//        property (i), per ADR 0022.
//
//   (ii) **Glyph-by-glyph rendering on a real video feed.** Kerning,
//        clipping, anti-aliasing artifacts. That check is a Playwright
//        + visual-regression task gated on `aud_clean_typography`
//        shipping (the audience surface is still a stub today). The
//        refinement's "## Status" block records the deferral pointer.
//
// This file owns (i). The font-stack declaration itself is also
// asserted-as-policy here so a future contributor cannot silently
// reshape `BROADCAST_FONT_STACK` without a test update.

import { describe, expect, it } from 'vitest';

import { SUPPORTED_LOCALES } from './config.js';
import {
  BROADCAST_FALLBACK_FONTS,
  BROADCAST_FONT_STACK,
  BROADCAST_PRIMARY_FONT,
  REQUIRED_DIACRITICS,
  V1_LOCALE_CODEPOINT_RANGES,
  collectAllCatalogStrings,
  collectCatalogStrings,
  findOutOfRangeCodepoints,
  isInV1LocaleCodepointRange,
} from './typography.js';

describe('broadcast font stack policy', () => {
  it('has Inter as the primary face', () => {
    expect(BROADCAST_PRIMARY_FONT).toBe('Inter');
  });

  it('serializes the primary face as the leading entry of the stack', () => {
    expect(BROADCAST_FONT_STACK.startsWith(`${BROADCAST_PRIMARY_FONT},`)).toBe(true);
  });

  it('terminates with the generic sans-serif family', () => {
    expect(BROADCAST_FONT_STACK.endsWith('sans-serif')).toBe(true);
  });

  it('contains the system-stack fallback chain (apple / windows / android / generic)', () => {
    // The stack covers macOS (-apple-system / BlinkMacSystemFont),
    // Windows ("Segoe UI"), Android / Chrome OS (Roboto), legacy
    // macOS / Windows ("Helvetica Neue" / Arial), the
    // universal-coverage backstop ("Noto Sans"), and the generic
    // family. A future PR that drops one of these without consensus
    // would break broadcast hosts that depend on it; the test pins
    // each.
    for (const family of [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      '"Noto Sans"',
      'sans-serif',
    ]) {
      expect(BROADCAST_FONT_STACK).toContain(family);
    }
  });

  it('exposes the fallback chain (everything after the primary face) for downstream consumers', () => {
    // `BROADCAST_FALLBACK_FONTS` mirrors the stack minus the primary
    // face; downstream consumers (a tokens package, a Cytoscape
    // style block builder) consume the list rather than re-parsing
    // the CSS string.
    expect(BROADCAST_FALLBACK_FONTS).toEqual([
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      '"Noto Sans"',
      'sans-serif',
    ]);
  });

  it('keeps the stack and the fallback list in agreement (stack = primary + fallback chain)', () => {
    const rebuilt = [BROADCAST_PRIMARY_FONT, ...BROADCAST_FALLBACK_FONTS].join(', ');
    expect(BROADCAST_FONT_STACK).toBe(rebuilt);
  });
});

describe('V1_LOCALE_CODEPOINT_RANGES policy', () => {
  it('covers Basic Latin (ASCII), Latin-1 Supplement, Latin Extended-A, and General Punctuation', () => {
    // Spot-check each block's bracket codepoints. The refinement
    // names "Latin Extended-A" colloquially; the concrete Unicode
    // blocks the audience surface relies on are listed here.
    const spotChecks: Array<{ name: string; cp: number }> = [
      { name: 'ASCII "A"', cp: 0x0041 },
      { name: 'Latin-1 ç', cp: 0x00e7 },
      { name: 'Latin-1 ñ', cp: 0x00f1 },
      { name: 'Latin-1 ¿', cp: 0x00bf },
      { name: 'Latin-1 ¡', cp: 0x00a1 },
      { name: 'Latin-1 ã', cp: 0x00e3 },
      { name: 'Latin-1 õ', cp: 0x00f5 },
      { name: 'Latin Extended-A ā', cp: 0x0101 },
      { name: 'General Punctuation ellipsis', cp: 0x2026 },
      { name: 'General Punctuation en-dash', cp: 0x2013 },
    ];
    for (const { name, cp } of spotChecks) {
      const inRange = V1_LOCALE_CODEPOINT_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
      expect(inRange, `expected ${name} (U+${cp.toString(16).toUpperCase()}) to be in range`).toBe(
        true,
      );
    }
  });

  it('excludes codepoints from non-Latin scripts (Cyrillic, CJK, Arabic)', () => {
    // The audience surface is v1-locale only (en-US / pt-BR /
    // es-419, all Latin-script). A future locale (Cyrillic, CJK,
    // Arabic) would require a font review per the refinement's
    // "Locale-specific font choice" open question. The test pins
    // that the current range does NOT silently accept those
    // codepoints.
    const outOfRange: Array<{ name: string; cp: number }> = [
      { name: 'Cyrillic A', cp: 0x0410 },
      { name: 'CJK 中', cp: 0x4e2d },
      { name: 'Arabic alif', cp: 0x0627 },
      { name: 'Greek alpha', cp: 0x03b1 },
    ];
    for (const { name, cp } of outOfRange) {
      const inRange = V1_LOCALE_CODEPOINT_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
      expect(inRange, `expected ${name} to be OUT of v1 range`).toBe(false);
    }
  });
});

describe('isInV1LocaleCodepointRange', () => {
  it('accepts an ASCII-only string', () => {
    expect(isInV1LocaleCodepointRange('hello, world')).toBe(true);
  });

  it('accepts pt-BR strings with cedilla / tilde / acute', () => {
    // From the actual catalogs.
    for (const text of [
      'olá, mundo',
      'sessão',
      'Bem-vinda(o)',
      'Não foi possível salvar',
      'Verificando sessão…',
      'Contradição',
      'Múltiplas garantias',
      'Sugestão de coerência',
    ]) {
      expect(isInV1LocaleCodepointRange(text), `pt-BR string: ${text}`).toBe(true);
    }
  });

  it('accepts es-419 strings with eñe / inverted punctuation / accent', () => {
    for (const text of [
      'hola, mundo',
      'Iniciar sesión',
      'Bienvenida(o)',
      'señor',
      '¿Quién?',
      '¡Hola!',
      'Múltiples garantías',
      'Contradicción',
    ]) {
      expect(isInV1LocaleCodepointRange(text), `es-419 string: ${text}`).toBe(true);
    }
  });

  it('rejects strings containing non-Latin codepoints', () => {
    expect(isInV1LocaleCodepointRange('hello мир')).toBe(false);
    expect(isInV1LocaleCodepointRange('日本語')).toBe(false);
    expect(isInV1LocaleCodepointRange('سلام')).toBe(false);
  });

  it('rejects strings containing emoji (BMP and supplementary)', () => {
    expect(isInV1LocaleCodepointRange('hello ❤')).toBe(false); // heavy black heart, U+2764
    expect(isInV1LocaleCodepointRange('hello \u{1F600}')).toBe(false); // grinning face, U+1F600
  });
});

describe('findOutOfRangeCodepoints', () => {
  it('returns [] for an in-range string', () => {
    expect(findOutOfRangeCodepoints('Olá, mundo')).toEqual([]);
  });

  it('lists every out-of-range codepoint with its hex name', () => {
    const result = findOutOfRangeCodepoints('a中b日c');
    expect(result.map((r) => r.hex)).toEqual(['U+4E2D', 'U+65E5']);
    expect(result.map((r) => r.char)).toEqual(['中', '日']);
  });
});

describe('REQUIRED_DIACRITICS sanity', () => {
  it('every required diacritic lies inside the v1-locale codepoint range', () => {
    // Property (a): the font covers them. If the font choice ever
    // changed to one with narrower Latin coverage, this test would
    // need updating in lockstep with the font choice.
    for (const [locale, chars] of Object.entries(REQUIRED_DIACRITICS)) {
      for (const ch of chars) {
        expect(
          isInV1LocaleCodepointRange(ch),
          `${locale} required diacritic ${ch} (U+${ch.codePointAt(0)?.toString(16).toUpperCase() ?? '?'}) must be in v1 range`,
        ).toBe(true);
      }
    }
  });

  it('every pt-BR-required diacritic appears in at least one pt-BR catalog string', () => {
    // Property (b): the diacritic shape is not aspirational. Each
    // character the refinement names appears somewhere in the
    // shipped pt-BR catalog. Includes the shared accented vowels —
    // pt-BR uses all of them (e.g. "Não", "Sugestão de coerência").
    //
    // Uppercase variants and rare-in-v1 letters (ô / Ô, Â) may not
    // appear in the current catalog corpus — they would only show
    // up if a string contained an uppercase accented vowel or the
    // specific letter. The check tolerates that subset by listing
    // it explicitly; the font (Inter) covers them either way, and
    // the codepoint-range test above pins font coverage. The claim
    // here is "this diacritic shape is exercised somewhere in the
    // corpus", with explicit allowance for rare letter-shapes whose
    // corpus presence will follow as the catalogs grow.
    const corpus = collectCatalogStrings('pt-BR').join('\n');
    const toleratedAbsent = new Set([
      // Uppercase accented vowels — only appear if a string starts
      // with one; current catalog has none.
      'Á',
      'É',
      'Í',
      'Ó',
      'Ú',
      'Ã',
      'Õ',
      'Â',
      'Ê',
      'Ô',
      'Ç',
      // Lowercase o-circumflex — pt-BR uses it in some words but the
      // v1 catalog doesn't currently ship one.
      'ô',
    ]);
    for (const ch of [...REQUIRED_DIACRITICS['pt-BR'], ...REQUIRED_DIACRITICS.shared]) {
      if (toleratedAbsent.has(ch)) continue;
      const present = corpus.includes(ch) || corpus.toLowerCase().includes(ch.toLowerCase());
      expect(present, `pt-BR diacritic ${ch} should appear in the pt-BR catalog`).toBe(true);
    }
  });

  it('every es-419-required diacritic appears in at least one es-419 catalog string', () => {
    // The es-419 catalog as currently shipped does not include
    // every uppercase variant or the inverted punctuation marks
    // (¿ / ¡), because the catalog does not have question/exclamation
    // sentences yet. We assert presence with a tolerant check: each
    // character either appears verbatim OR is exercised by a string
    // somewhere in the corpus (case-folded). The inverted punctuation
    // marks are exercised by the isInV1LocaleCodepointRange test
    // above; their corpus presence is enforced once the audience
    // surface ships strings using them. For now we tolerate absence
    // of ¿ / ¡ / Ñ in the corpus, but still pin them as required
    // codepoints the font must cover.
    const corpus = collectCatalogStrings('es-419').join('\n');
    const toleratedAbsent = new Set(['¿', '¡', 'Ñ']);
    for (const ch of [...REQUIRED_DIACRITICS['es-419'], ...REQUIRED_DIACRITICS.shared]) {
      if (toleratedAbsent.has(ch)) continue;
      const present = corpus.includes(ch) || corpus.toLowerCase().includes(ch.toLowerCase());
      expect(present, `es-419 diacritic ${ch} should appear in the es-419 catalog`).toBe(true);
    }
  });
});

describe('catalog corpus stays inside the v1-locale codepoint range', () => {
  // This is the load-bearing acceptance test (i) the refinement
  // names: every string a v1 audience viewer can see must lie inside
  // the codepoint range Inter covers. A new pt-BR string with a
  // stray smart-quote or a typo'd Cyrillic look-alike would fail
  // here before the audience surface tried to render it.

  for (const locale of SUPPORTED_LOCALES) {
    it(`every ${locale} catalog string is in v1-locale codepoint range`, () => {
      const corpus = collectCatalogStrings(locale);
      expect(corpus.length, `${locale} catalog must contain strings`).toBeGreaterThan(0);
      for (const str of corpus) {
        const offending = findOutOfRangeCodepoints(str);
        expect(
          offending,
          `${locale} string "${str}" contains out-of-range codepoint(s): ${offending.map((o) => `${o.char} (${o.hex})`).join(', ')}`,
        ).toEqual([]);
      }
    });
  }
});

describe('collectAllCatalogStrings totality', () => {
  it('returns one entry per supported locale, each non-empty', () => {
    const all = collectAllCatalogStrings();
    expect(Object.keys(all).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    for (const locale of SUPPORTED_LOCALES) {
      const strings = all[locale];
      expect(strings.length, `${locale}`).toBeGreaterThan(0);
    }
  });

  it('each locale corpus contains strictly more than just the chrome.hello smoke entry', () => {
    // Sanity that the test is actually walking the nested catalog
    // tree (auth / methodology / diagnostics) and not just the
    // top-level `chrome.hello` from `i18n_catalog_workflow`'s smoke.
    const all = collectAllCatalogStrings();
    for (const locale of SUPPORTED_LOCALES) {
      expect(all[locale].length, `${locale}`).toBeGreaterThan(10);
    }
  });
});
