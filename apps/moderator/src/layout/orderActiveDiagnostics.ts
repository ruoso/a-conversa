// Per-severity panel palette for the moderator's `diagnostic-flags`
// sidebar slot, plus a re-export of the shared diagnostic total order.
//
// Refinement: tasks/refinements/participant-ui/part_diagnostics_list.md
//             (Decision §3 — the pure `orderActiveDiagnostics` comparator
//             LIFTED to `@a-conversa/shell` as its second caller, so the
//             moderator flag pane and the participant diagnostics list
//             share one "which flag is first" total order. The Tailwind
//             palette constants are presentation, not logic, and stay
//             here app-local; the moderator's three consumers
//             (`<DiagnosticSuggestionsPanel>`, `<DiagnosticFlagPane>`,
//             `<BlockingDiagnosticBanner>`) keep importing the comparator
//             from this module via the re-export below, so no call-site
//             churn.)
// Predecessor: tasks/refinements/moderator-ui/mod_diagnostic_flag_pane.md
//             (Decision §D2 — one shared total order; the comparator's
//             behavioral contract now lives in the shell suite at
//             `packages/shell/src/diagnostics/order-active-diagnostics.test.ts`.)

// Per-severity panel chrome. Blocking flags get the rose palette;
// advisory flags get amber. Shared by the suggestions panel, the
// flag-pane rows, and the blocking banner so the surfaces stay visually
// consistent (ADR 0005, Tailwind).
export const BLOCKING_PANEL_CLASSES =
  'rounded border border-rose-400 bg-rose-50 px-2 py-1.5 text-xs text-rose-900';
export const ADVISORY_PANEL_CLASSES =
  'rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900';

export { orderActiveDiagnostics } from '@a-conversa/shell';
