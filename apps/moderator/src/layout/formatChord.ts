// `formatChord` — compose a structured `Chord` into a display glyph
// string for the keymap-help overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_keymap_help_overlay.md
//
// Presentation stays in the presentational layer (Decision §4 — the
// registry stores the structured `Chord` + a `labelKey`, never a
// display string). `isMacPlatform()` (re-homed to `useGlobalKeymap` by
// mod_global_keymap and exported for exactly this reuse) picks the
// platform glyph: `⌘` on macOS, `Ctrl` elsewhere; `⇧` vs `Shift`.
//
// The chord glyph is locale-INDEPENDENT (ADR 0024's english-mnemonic
// shortcut policy) — it is never a catalog entry; only the row's label
// resolves via `t(labelKey)`.

import type { Chord } from './globalKeymap';
import { isMacPlatform } from './useGlobalKeymap';

/**
 * Render a single chord key. Special keys map to their conventional
 * display form (`escape` → `Esc`, `enter` → `Enter`); single-character
 * keys (letters, `?`) uppercase (`s` → `S`, `?` → `?`); anything else
 * passes through verbatim.
 */
function formatKey(key: string): string {
  switch (key) {
    case 'escape':
      return 'Esc';
    case 'enter':
      return 'Enter';
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

/**
 * Compose the full glyph: platform modifier, then shift, then the key,
 * joined with `+` (`⌘+S`, `Ctrl+S`, `⇧+Enter`, `Esc`, `?`).
 */
export function formatChord(chord: Chord): string {
  const isMac = isMacPlatform();
  const parts: string[] = [];
  if (chord.platformModifier === true) parts.push(isMac ? '⌘' : 'Ctrl');
  if (chord.shift === true) parts.push(isMac ? '⇧' : 'Shift');
  parts.push(formatKey(chord.key));
  return parts.join('+');
}
