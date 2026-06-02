// Shared diagnostic ordering + per-severity palette for the moderator's
// `diagnostic-flags` sidebar slot.
//
// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_flag_pane.md
//             (Decision §D2 — one shared total order)
//
// Both `<DiagnosticSuggestionsPanel>` (which focuses the head of the
// order) and `<DiagnosticFlagPane>` (which lists the whole order
// top-to-bottom) consume `orderActiveDiagnostics`, so the list's top
// row and the focused suggestion panel can never disagree about which
// flag is "first/focused." The rose (blocking) / amber (advisory)
// palette tokens are hoisted here alongside the comparator rather than
// re-declared per component (ADR 0005, Tailwind).

import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { diagnosticIdentityKey } from '@a-conversa/shell';

// Per-severity panel chrome. Blocking flags get the rose palette;
// advisory flags get amber. Shared by the suggestions panel and the
// flag-pane rows so the two surfaces stay visually consistent.
export const BLOCKING_PANEL_CLASSES =
  'rounded border border-rose-400 bg-rose-50 px-2 py-1.5 text-xs text-rose-900';
export const ADVISORY_PANEL_CLASSES =
  'rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900';

/**
 * Total order over the active-diagnostics map per the refinement's
 * rule: blocking before advisory, then by ascending `sequence` (oldest
 * first), then by `diagnosticIdentityKey` lexicographic order
 * (deterministic tiebreak).
 *
 * Returns a fresh array sorted by the rule; an empty map yields `[]`.
 * The caller derives the focused flag as `[0]` and the flag list as the
 * full array (Decision §D2 — one shared total order).
 */
export function orderActiveDiagnostics(
  activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>,
): DiagnosticPayload[] {
  const entries = [...activeDiagnostics.values()];
  entries.sort((a, b) => {
    // blocking < advisory
    if (a.severity !== b.severity) {
      return a.severity === 'blocking' ? -1 : 1;
    }
    if (a.sequence !== b.sequence) {
      return a.sequence - b.sequence;
    }
    const keyA = diagnosticIdentityKey(a);
    const keyB = diagnosticIdentityKey(b);
    if (keyA < keyB) return -1;
    if (keyA > keyB) return 1;
    return 0;
  });
  return entries;
}
