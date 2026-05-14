// Moderator classification-palette keyboard shortcut policy.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_keyboard_shortcuts_policy.md
// ADR:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
// TaskJuggler: frontend_i18n.i18n_keyboard_shortcuts_policy
//
// The moderator UI binds a single keystroke to each methodology statement
// kind (fact / predictive / value / normative / definitional) so the
// operator can drive classification without leaving the keyboard. The
// policy decision (recorded in ADR 0024's Consequences and in the
// refinement Decisions block) is:
//
//   **Shortcuts stay English-mnemonic regardless of UI locale.**
//
// Rationale (from the refinement):
//   1. A single trained operator drives a session; cross-deployment
//      consistency wins over local-mnemonic agreement.
//   2. Four of five pt-BR labels and four of five es-419 labels happen to
//      match the English mnemonic already; only `fact -> Hecho` in es-419
//      breaks it. Rebinding for one of five would be inconsistent.
//   3. The keymap help overlay always renders `<KEY>: <localized label>`,
//      so the moderator sees the binding alongside the localized term.
//
// The mapping is therefore **locale-independent** — there is a single
// `KIND_TO_SHORTCUT` table, NOT a `(locale, kind) -> key` matrix. The
// moderator UI's `mod_classification_palette` task consumes this table
// directly; the `mod_keymap_help_overlay` task consumes it together with
// the `methodology.kind.<id>` catalog entries to render the help
// overlay.
//
// Non-classification shortcuts (commit, snapshot, esc, etc.) are not
// methodology-derived and are NOT covered by this module; they live with
// the moderator UI's own keymap definition.

import type { SupportedLocale } from './config.js';
import { SUPPORTED_LOCALES } from './config.js';

/**
 * The five methodology statement kinds the classification palette
 * exposes. Mirrors `METHODOLOGY_VALUES.kind` in
 * `methodology.test.ts`; kept as a local literal-tuple here so this
 * module has no dependency on the test file.
 */
export const METHODOLOGY_KINDS = [
  'fact',
  'predictive',
  'value',
  'normative',
  'definitional',
] as const;

export type MethodologyKind = (typeof METHODOLOGY_KINDS)[number];

/**
 * The English-mnemonic shortcut for each methodology kind. Single
 * lowercase ASCII letter; modifiers (shift / ctrl / cmd) are NOT part of
 * the classification shortcut surface — the moderator UI normalises the
 * key event to its lowercase form before dispatching.
 *
 * This table is the source of truth referenced by:
 *   - `apps/moderator` `mod_classification_palette` (when it lands).
 *   - `apps/moderator` `mod_keymap_help_overlay` (when it lands).
 *   - Operator training docs (when they land).
 */
export const KIND_TO_SHORTCUT: Readonly<Record<MethodologyKind, string>> = {
  fact: 'f',
  predictive: 'p',
  value: 'v',
  normative: 'n',
  definitional: 'd',
};

/**
 * The policy mode this module enforces. Exported as a constant so a
 * downstream consumer (the help-overlay renderer, an operator-training
 * doc generator) can branch on the policy without re-reading the
 * refinement. If this value ever flips to `'per-locale'`, the shape of
 * `getShortcutForKind` must change in lockstep.
 */
export const KEYBOARD_SHORTCUT_POLICY = 'english-mnemonic' as const;

export type KeyboardShortcutPolicy = typeof KEYBOARD_SHORTCUT_POLICY;

/**
 * Resolve the shortcut for a given methodology kind. The `locale`
 * parameter is accepted for forward compatibility — if the policy ever
 * flips to per-locale, every call site is already passing the active
 * locale. Under the current `'english-mnemonic'` policy the locale is
 * ignored.
 *
 * The function is total over `MethodologyKind` × `SupportedLocale`; it
 * returns the same single-character lowercase string for any locale.
 */
export function getShortcutForKind(
  kind: MethodologyKind,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  locale: SupportedLocale,
): string {
  return KIND_TO_SHORTCUT[kind];
}

/**
 * The full `(locale, kind) -> shortcut` table, materialised. Useful for
 * the help-overlay renderer (which iterates the cross-product) and for
 * the round-trip test that asserts totality + no within-locale
 * collisions.
 *
 * Under the current `'english-mnemonic'` policy every row is identical;
 * the matrix shape exists so a flip to per-locale is a data change, not
 * an API change.
 */
export function buildShortcutMatrix(): Readonly<
  Record<SupportedLocale, Readonly<Record<MethodologyKind, string>>>
> {
  const matrix: Partial<Record<SupportedLocale, Record<MethodologyKind, string>>> = {};
  for (const locale of SUPPORTED_LOCALES) {
    const row: Partial<Record<MethodologyKind, string>> = {};
    for (const kind of METHODOLOGY_KINDS) {
      row[kind] = getShortcutForKind(kind, locale);
    }
    matrix[locale] = row as Record<MethodologyKind, string>;
  }
  return matrix as Record<SupportedLocale, Record<MethodologyKind, string>>;
}
