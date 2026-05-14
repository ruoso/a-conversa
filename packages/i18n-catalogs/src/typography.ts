// Audience-broadcast typography policy.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_audience_typography.md
// ADRs:        docs/adr/0005-styling-tailwind-with-shared-tokens.md,
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
// TaskJuggler: frontend_i18n.i18n_audience_typography
//
// The audience surface is the "on-camera" surface (OBS browser source).
// Its typography is doubly sensitive: it has to read crisply on a video
// feed AND it has to render every diacritic the v1 locales produce
// (Portuguese tildes, accents, cedillas; Spanish accents, eñes,
// inverted punctuation) without kerning or clipping artifacts. This
// module is the **policy** ADR-style data substrate for that choice.
//
// The two upstream pieces this module integrates:
//
//   1. `aud_clean_typography` (audience/aud_graph_rendering subtree) —
//      will pick the broadcast font when the audience graph-rendering
//      task lands. Today that task has NOT shipped (the audience
//      surface itself is still a stub per `apps/audience/src/index.tsx`
//      = `export {};`). This module therefore lands the typography
//      **decision** as policy data the eventual `aud_clean_typography`
//      task can consume, and as the source of truth `packages/ui-tokens`
//      will fold into its theme block when it materializes (deferred
//      per ADR 0005's Consequences: "Workspace realization deferred").
//
//   2. The v1 catalogs (`pt-BR.json`, `es-419.json`) — these contain
//      the actual strings the audience surface renders. Every label
//      in those catalogs sits inside the **Latin Extended-A** Unicode
//      block (U+0000–U+024F, comprising Basic Latin + Latin-1
//      Supplement + Latin Extended-A). A font is "v1-locale safe" iff
//      it has glyphs for every codepoint that appears across all three
//      catalogs. The committed test in `typography.test.ts` enumerates
//      the catalogs and asserts every codepoint lies in Latin
//      Extended-A — that's the property a v1-locale-safe font must
//      cover. The actual glyph-by-glyph rendering check (kerning,
//      clipping, on-camera legibility) is a Playwright + visual-
//      regression task gated on `aud_clean_typography` shipping; see
//      "Wiring deferred" below.
//
// ## Decision: font stack
//
// **Primary face: Inter** (open-source, OFL 1.1, designed for UI at
// small sizes, full Latin Extended-A coverage including the entire
// pt-BR / es-419 diacritic set, ships from Google Fonts / self-host
// without licensing friction). Inter is the default UI face in the
// Tailwind ecosystem, which dovetails with ADR 0005's choice.
//
// **Fallback chain** (in order, all v1-locale safe):
//
//   1. `Inter` — the chosen face.
//   2. `-apple-system` — San Francisco on macOS / iOS; full Latin
//      Extended-A.
//   3. `BlinkMacSystemFont` — Blink's mapping to system UI font.
//   4. `"Segoe UI"` — Windows default UI face; full Latin Extended-A.
//   5. `Roboto` — Android / Chrome OS default; full Latin Extended-A.
//   6. `"Helvetica Neue"` — older macOS fallback.
//   7. `Arial` — universal Windows fallback.
//   8. `"Noto Sans"` — Google's universal-coverage face; the explicit
//      "this covers every script we care about" backstop.
//   9. `sans-serif` — generic family, browser default.
//
// Items 1-5 cover the realistic OBS host OSes (macOS / Windows / Linux
// running on a producer's machine). 6-8 are belt-and-suspenders for
// off-spec OBS hosts. 9 is the generic terminator the CSS spec
// requires.
//
// ## What this module is NOT
//
// - It is not a font-loader. The audience surface's eventual
//   `main.tsx` / `index.css` is what `@import`s Inter from Google
//   Fonts (or self-hosts the woff2). That wiring lands when
//   `aud_clean_typography` does.
// - It is not a `packages/ui-tokens` substitute. When ui-tokens
//   materializes, it will re-export `BROADCAST_FONT_STACK` (or fold
//   it into a `tokens.typography.broadcast.fontFamily` entry).
//   ADR 0005's "Workspace realization deferred" consequence applies.
// - It is not the visual-regression smoke. The refinement's
//   acceptance criterion ("a reference test image per locale at three
//   resolutions") sits in the `aud_visual_regression` task; this
//   module ships the **policy data** that test will eventually drive
//   from. See `## Status` block in the refinement when this task
//   ships for the test count and the deferral pointer.
//
// Per ADR 0022, the diacritic-coverage check IS a committed test
// (`typography.test.ts`), not a probe — the empirical question "do
// the v1 catalogs stay inside Latin Extended-A" gets answered on
// every CI run forever.

import { CATALOGS, SUPPORTED_LOCALES, type SupportedLocale } from './config.js';

/**
 * The CSS `font-family` value the audience surface uses for broadcast
 * rendering. Serialized as a single string so a Cytoscape style block
 * (ADR 0004 — Cytoscape consumes the value, not a class) can splice
 * it in verbatim and so a Tailwind `@theme` block (ADR 0005) can pin
 * it under `--font-broadcast` without re-quoting the multi-word
 * fallback entries.
 *
 * The leading `Inter` is the primary face; the remainder is the
 * system-stack fallback chain. Order is precedence — the browser
 * walks the list left-to-right and renders with the first family
 * available.
 */
export const BROADCAST_FONT_STACK =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif' as const;

/**
 * The primary broadcast face, exported separately so a font-loader
 * step (the `@import url('https://fonts.googleapis.com/css2?family=Inter…')`
 * call site the audience surface's eventual `index.css` will own) can
 * key off the canonical name without parsing the stack string.
 */
export const BROADCAST_PRIMARY_FONT = 'Inter' as const;

/**
 * The fallback chain (everything in `BROADCAST_FONT_STACK` after the
 * primary face). Useful for diagnostics and for the eventual
 * `packages/ui-tokens` consumer.
 */
export const BROADCAST_FALLBACK_FONTS: readonly string[] = [
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  '"Noto Sans"',
  'sans-serif',
];

/**
 * The Unicode codepoint range the v1 locales' catalogs must stay
 * inside. `Latin Extended-A` here is the colloquial name for the
 * union of three contiguous Unicode blocks:
 *
 *   - Basic Latin                 U+0000 .. U+007F  (ASCII)
 *   - Latin-1 Supplement          U+0080 .. U+00FF  (covers ñ, ç, á,
 *                                                   é, í, ó, ú, ã, õ
 *                                                   and Latin
 *                                                   punctuation incl.
 *                                                   ¡ and ¿)
 *   - Latin Extended-A            U+0100 .. U+017F  (covers extended
 *                                                   diacritics — none
 *                                                   appear in v1 but
 *                                                   reserved as the
 *                                                   compatible
 *                                                   superset)
 *
 * Plus the General Punctuation block U+2000 .. U+206F for the
 * ellipsis (U+2026) and the en-dash / em-dash characters that appear
 * in i18n catalog strings (e.g. "Verificando sessão…").
 *
 * A font is "v1-locale safe" iff every codepoint that appears across
 * all three catalogs lies in this range. The diacritic-coverage test
 * enforces that property; the font choice (Inter) is known to cover
 * the entire range.
 */
export const V1_LOCALE_CODEPOINT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x007f], // Basic Latin (ASCII)
  [0x0080, 0x00ff], // Latin-1 Supplement
  [0x0100, 0x017f], // Latin Extended-A
  [0x2000, 0x206f], // General Punctuation (ellipsis, dashes, smart quotes)
];

/**
 * The diacritic-bearing characters the refinement explicitly names as
 * acceptance-critical. Test fixture: every one of these must
 *
 *   (a) lie inside `V1_LOCALE_CODEPOINT_RANGES` (sanity — the font
 *       covers them), and
 *   (b) appear in at least one v1 catalog string (sanity — the
 *       diacritic set is not aspirational).
 *
 * Organized per-locale because the refinement enumerates them
 * per-locale. The `shared` set is characters common to pt-BR and
 * es-419 (the accented vowels).
 */
export const REQUIRED_DIACRITICS: Readonly<
  Record<'pt-BR' | 'es-419' | 'shared', readonly string[]>
> = {
  'pt-BR': ['ç', 'Ç', 'ã', 'Ã', 'õ', 'Õ', 'â', 'Â', 'ê', 'Ê', 'ô', 'Ô'],
  'es-419': ['ñ', 'Ñ', '¿', '¡'],
  // Acute-accented vowels appear in both pt-BR and es-419.
  shared: ['á', 'Á', 'é', 'É', 'í', 'Í', 'ó', 'Ó', 'ú', 'Ú'],
};

/**
 * Return true iff every codepoint of `text` lies inside a
 * `V1_LOCALE_CODEPOINT_RANGES` interval. The check iterates
 * codepoints (not code units) so a surrogate pair is treated as a
 * single character; v1 catalogs do not contain any BMP-supplementary
 * characters, so a `false` here means a stray codepoint slipped in
 * and the font may not render it.
 */
export function isInV1LocaleCodepointRange(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) {
      return false;
    }
    let ok = false;
    for (const [lo, hi] of V1_LOCALE_CODEPOINT_RANGES) {
      if (cp >= lo && cp <= hi) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      return false;
    }
  }
  return true;
}

/**
 * Locate any codepoint in `text` that falls outside
 * `V1_LOCALE_CODEPOINT_RANGES`. Returns the first offending character
 * (and its codepoint, hex-formatted) for use in test failure messages
 * — empty array if everything is in range.
 *
 * Returns an array (not a single value) so a caller surfacing a batch
 * of strings can collect every miss before reporting; in practice
 * `isInV1LocaleCodepointRange` is what the test asserts on, and this
 * function is used to format the failure message.
 */
export function findOutOfRangeCodepoints(
  text: string,
): ReadonlyArray<{ char: string; hex: string }> {
  const out: Array<{ char: string; hex: string }> = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    let ok = false;
    for (const [lo, hi] of V1_LOCALE_CODEPOINT_RANGES) {
      if (cp >= lo && cp <= hi) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      out.push({ char: ch, hex: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` });
    }
  }
  return out;
}

/**
 * Walk a catalog node tree, yielding every leaf string. The catalog
 * shape mirrors `config.ts`'s `LocaleCatalog`: a nested object where
 * leaves are strings; recursion follows the object branches.
 */
function* iterateCatalogStrings(node: unknown): Generator<string> {
  if (typeof node === 'string') {
    yield node;
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      yield* iterateCatalogStrings(value);
    }
  }
}

/**
 * Collect every string the given locale's catalog ships. The
 * diacritic-coverage test iterates the result and asserts each string
 * is in-range. Exposed (not inlined inside the test) so a future
 * downstream consumer — e.g. a Playwright fixture rendering every
 * label — can drive from the same flattened list.
 */
export function collectCatalogStrings(locale: SupportedLocale): readonly string[] {
  return [...iterateCatalogStrings(CATALOGS[locale])];
}

/**
 * Materialize the full flat catalog corpus across every supported
 * locale. The test harness uses this to assert "every codepoint that
 * a v1 user sees on the audience surface lies inside the v1-locale
 * codepoint range".
 */
export function collectAllCatalogStrings(): Readonly<Record<SupportedLocale, readonly string[]>> {
  const out: Partial<Record<SupportedLocale, readonly string[]>> = {};
  for (const locale of SUPPORTED_LOCALES) {
    out[locale] = collectCatalogStrings(locale);
  }
  return out as Record<SupportedLocale, readonly string[]>;
}
