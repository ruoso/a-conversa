// Disputation-test outcome derivation — maps a node's `substance` facet
// status to the methodology's data-vs-claim vocabulary.
//
// Refinement: tasks/refinements/moderator-ui/mod_disputation_test_display.md
// Canonical mapping reference: docs/methodology.md § "Disputation test" (L128).
//
// The disputation test is a *read* of an existing facet, not a methodology
// rule of its own. The substance facet's wire-status vocabulary
// (`proposed | agreed | disputed | committed | withdrawn | meta-disagreement`)
// translates one-to-one into the methodology's narrative vocabulary
// (`data | claim | unsettled`) per the rules below. The mapping here is
// the testable surface; the chip / popover-row components are thin
// presentational shells over `disputationOutcome(...)`.
//
// **Mapping (load-bearing — pinned by tests):**
//
//   - 'agreed'            → 'data'       (post-agreement: node carries a supports edge)
//   - 'committed'         → 'data'       (closed agreement: durable record persists)
//   - 'disputed'          → 'claim'      (contested: node needs its own support)
//   - 'meta-disagreement' → 'claim'      (escalated dispute: same data-vs-claim outcome)
//   - 'proposed'          → 'unsettled'  (in-flight: votes have not landed yet)
//   - 'withdrawn'         → 'unsettled'  (retracted agreement: disputation test is open again)
//   - undefined           → null         (no substance facet activity — nothing to surface)
//
// Drift between this helper's mapping and the methodology doc is a
// methodology-engine-level discrepancy — fix the mapping here AND
// update `docs/methodology.md` § "Disputation test" in the same change.
// Three forward consumers reuse the function (see refinement Decision §7):
// `mod_diagnostic_methodology_suggestions` (suggestion-list selection),
// `mod_operationalization_mode` (entry affordance gating on 'claim'),
// `<HoverPopover>` (popover-row content).
//
// Pure module: no React, no Zustand, no side effects. Referentially
// transparent — consumers can memoize trivially. Mirrors the
// `facetStatus.ts` / `diagnosticHighlights.ts` pure-module pattern.

import type { FacetStatus } from './facetStatus.js';

/**
 * The methodology's narrative vocabulary for the disputation-test
 * outcome. A discriminated union of three string literals:
 *
 *   - `'data'`       — the node is functioning as a building block carrying
 *                      support to a claim. Methodology says no diagnostic
 *                      action is needed; the node is doing its job.
 *   - `'claim'`      — the node is itself contested and needs its own
 *                      support. Methodology says the moderator should
 *                      consider operationalization, warrant elicitation,
 *                      or capturing a defeater.
 *   - `'unsettled'`  — the disputation test has not produced a result yet.
 *                      Methodology says wait for votes to land.
 */
export type DisputationOutcome = 'data' | 'claim' | 'unsettled';

/**
 * Pure derivation from a node's substance `FacetStatus` to the
 * methodology's disputation-test outcome. Exhaustive narrow on
 * `FacetStatus`; `undefined` (no substance facet activity has ever
 * touched the node) returns `null` so the call site can omit the
 * methodology-label surface entirely.
 *
 * See module-level comment for the canonical mapping table.
 */
export function disputationOutcome(
  substanceStatus: FacetStatus | undefined,
): DisputationOutcome | null {
  if (substanceStatus === undefined) {
    return null;
  }
  switch (substanceStatus) {
    case 'agreed':
      return 'data';
    case 'committed':
      return 'data';
    case 'disputed':
      return 'claim';
    case 'meta-disagreement':
      return 'claim';
    case 'proposed':
      return 'unsettled';
    case 'withdrawn':
      return 'unsettled';
    // `'awaiting-proposal'` (per ADR 0030 §10) — the substance facet
    // has no candidate value yet (no `set-node-substance` proposal).
    // Maps to the same disputation outcome as `'proposed'`: the
    // disputation test has not produced a result yet because votes
    // cannot land on a non-existent candidate. Both pre-agreement
    // states are `'unsettled'` for methodology-narrative purposes —
    // the moderator's UI surface for the empty-state row is the
    // downstream `pf_mod_node_card_substance_affordance` task; the
    // disputation-outcome mapping here is unchanged.
    case 'awaiting-proposal':
      return 'unsettled';
    default: {
      // Exhaustive-narrow guard — TypeScript proves `substanceStatus`
      // is `never` here. A future `FacetStatus` value addition would
      // surface as a compile error AND the exhaustiveness test in
      // `disputationOutcome.test.ts` would fail.
      const _exhaustive: never = substanceStatus;
      return _exhaustive;
    }
  }
}
