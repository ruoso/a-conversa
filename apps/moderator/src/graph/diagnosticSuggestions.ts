// Methodology-suggestion move catalog — maps a diagnostic payload to the
// methodology's ordered list of next-action moves the moderator may
// consider.
//
// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_methodology_suggestions.md
// Canonical mapping reference: docs/methodology.md § "Resolution of
//   structural diagnostics" (L216-233).
//
// The methodology has, per diagnostic kind, an explicit catalog of
// next-action paths the moderator may take. This helper encodes that
// catalog as a pure derivation from the wire `DiagnosticPayload` — the
// exact ordered move identifiers per kind are:
//
//   - cycle           → ['break-edge', 'decompose', 'axiom-mark']
//   - contradiction   → ['decompose', 'amend', 'axiom-mark-both']
//   - multi-warrant   → ['decompose']
//   - dangling-claim  → ['prompt-for-support', 'mark-conceded']
//   - coherency-hint  → ['review-configuration', 'repair-configuration',
//                        'leave-as-intentional']
//
// The coherency-hint catalog is the same triple for every sub-kind per
// `docs/methodology.md` L227 and `docs/data-model.md` L197 — the
// methodology pins no per-sub-kind variant. The helper still narrows on
// the sub-kind to surface the seam; the companion test pins the
// invariant so a future per-sub-kind divergence is a deliberate
// compile-or-test break rather than a silent regression.
//
// **Drift risk.** A divergence between this helper's mapping and the
// methodology doc is a methodology-engine-level discrepancy — fix the
// mapping here AND update `docs/methodology.md` § "Resolution of
// structural diagnostics" in the same change. The same drift-pinning
// comment shape as `disputationOutcome.ts`.
//
// Pure module: no React, no Zustand, no side effects. Referentially
// transparent — consumers (the panel) memoize on `payload` reference
// for stability. Mirrors the `facetStatus.ts` / `disputationOutcome.ts`
// / `diagnosticHighlights.ts` pure-module pattern.

import type { DiagnosticPayload } from '@a-conversa/shared-types';

import type { WireCoherencyHint, WireDiagnostic } from '@a-conversa/shell';

/**
 * Discriminated union of the methodology-pinned next-action move
 * identifiers across every diagnostic kind. This is the locked vocabulary
 * downstream surfaces (the F7 resolution-path picker, the blocking
 * diagnostic banner, the audience-broadcast diagnostic ticker if it
 * surfaces methodology recommendations) will switch on; pinning the
 * vocabulary in one place keeps the per-move surface coherent across
 * consumers.
 *
 *   - `'break-edge'`             — cycle (drop one `supports` edge).
 *   - `'decompose'`              — cycle, contradiction, multi-warrant.
 *   - `'axiom-mark'`             — cycle (terminate the chain at one
 *                                  participant's bedrock).
 *   - `'amend'`                  — contradiction (edit one node to remove
 *                                  conflict).
 *   - `'axiom-mark-both'`        — contradiction (accept as bedrock
 *                                  disagreement; each side axiom-marks).
 *   - `'prompt-for-support'`     — dangling-claim.
 *   - `'mark-conceded'`          — dangling-claim.
 *   - `'review-configuration'`   — coherency-hint (review the flag).
 *   - `'repair-configuration'`   — coherency-hint (repair if accidental).
 *   - `'leave-as-intentional'`   — coherency-hint (leave if intentional).
 */
export type SuggestionMove =
  | 'break-edge'
  | 'decompose'
  | 'axiom-mark'
  | 'amend'
  | 'axiom-mark-both'
  | 'prompt-for-support'
  | 'mark-conceded'
  | 'review-configuration'
  | 'repair-configuration'
  | 'leave-as-intentional';

// Pre-frozen per-kind ordered arrays. The helper returns a fresh
// `readonly` projection per call (so a consumer cannot mutate the
// shared array by widening the type), but the ordering / membership is
// canonical and pinned. Same order as the bullet list above.

const CYCLE_MOVES = [
  'break-edge',
  'decompose',
  'axiom-mark',
] as const satisfies readonly SuggestionMove[];
const CONTRADICTION_MOVES = [
  'decompose',
  'amend',
  'axiom-mark-both',
] as const satisfies readonly SuggestionMove[];
const MULTI_WARRANT_MOVES = ['decompose'] as const satisfies readonly SuggestionMove[];
const DANGLING_CLAIM_MOVES = [
  'prompt-for-support',
  'mark-conceded',
] as const satisfies readonly SuggestionMove[];
const COHERENCY_HINT_MOVES = [
  'review-configuration',
  'repair-configuration',
  'leave-as-intentional',
] as const satisfies readonly SuggestionMove[];

/**
 * Pure derivation from a `DiagnosticPayload` to the methodology's
 * ordered list of suggested next-action moves. Exhaustive narrow on
 * `payload.kind`; for `coherency-hint` the helper additionally narrows
 * on `payload.diagnostic.hint.kind` but currently returns the same
 * triple for every sub-kind (see module-level comment).
 *
 * The returned array is freshly built per call — callers (the panel)
 * memoize on `payload` reference if they want stability. The pure
 * helper does not maintain its own cache.
 *
 * See module-level comment for the canonical mapping table.
 */
export function suggestionsForDiagnostic(payload: DiagnosticPayload): readonly SuggestionMove[] {
  const diagnostic = payload.diagnostic as WireDiagnostic;
  switch (diagnostic.kind) {
    case 'cycle':
      return [...CYCLE_MOVES];
    case 'contradiction':
      return [...CONTRADICTION_MOVES];
    case 'multi-warrant':
      return [...MULTI_WARRANT_MOVES];
    case 'dangling-claim':
      return [...DANGLING_CLAIM_MOVES];
    case 'coherency-hint':
      return coherencyHintSuggestions(diagnostic.hint);
  }
}

function coherencyHintSuggestions(hint: WireCoherencyHint): readonly SuggestionMove[] {
  switch (hint.kind) {
    case 'incomplete-warrant-missing-bridges-to':
      return [...COHERENCY_HINT_MOVES];
    case 'incomplete-warrant-missing-bridges-from':
      return [...COHERENCY_HINT_MOVES];
    case 'self-contradicts':
      return [...COHERENCY_HINT_MOVES];
    case 'annotation-of-annotation-chain':
      return [...COHERENCY_HINT_MOVES];
    case 'self-referential-annotation-contradicts':
      return [...COHERENCY_HINT_MOVES];
    case 'non-self-referential-annotation-contradicts':
      return [...COHERENCY_HINT_MOVES];
  }
}
