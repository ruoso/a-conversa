// `orderActiveDiagnostics` — the shared total order over a session's
// active-diagnostics map.
//
// Refinement: tasks/refinements/participant-ui/part_diagnostics_list.md
//             (Decision §3 — the two-callers-then-extract convention
//             fires: the moderator's flag pane + the participant's
//             diagnostics list both need the IDENTICAL "which flag is
//             first" total order, and apps cannot import from one
//             another. The pure comparator lifts here alongside the
//             existing diagnostics module; the moderator's Tailwind
//             palette constants stay app-local presentation.)
// Predecessor: tasks/refinements/moderator-ui/mod_diagnostic_flag_pane.md
//             (Decision §D2 — one shared total order so the list's top
//             row and the focused suggestions panel never disagree.)
//
// Both surfaces derive the focused flag as `[0]` and the inventory list
// as the full array, so cross-surface conversation ("the first flag")
// stays consistent.

import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { diagnosticIdentityKey } from './diagnostic-highlights.js';

/**
 * Total order over the active-diagnostics map per the shared rule:
 * blocking before advisory, then by ascending `sequence` (oldest
 * first), then by `diagnosticIdentityKey` lexicographic order
 * (deterministic tiebreak).
 *
 * Returns a fresh array sorted by the rule; an empty map yields `[]`.
 *
 * @param activeDiagnostics The session's active-diagnostics map (keyed
 *   by identity key) as maintained by the WS store.
 * @returns A fresh, deterministically-ordered array of payloads.
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
