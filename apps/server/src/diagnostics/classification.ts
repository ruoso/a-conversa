// Diagnostic classification — map each `DiagnosticEntry` to a
// `'blocking' | 'advisory'` severity per the methodology doc.
//
// Refinement: tasks/refinements/data-and-methodology/blocking_vs_advisory_classification.md
// TaskJuggler: data_and_methodology.diagnostics.blocking_vs_advisory_classification
//
// The five surfaced diagnostic kinds (`cycle`, `contradiction`,
// `multi-warrant`, `dangling-claim`, `coherency-hint`) fall into two
// methodological categories per `docs/methodology.md` lines 210–227
// ("Resolution of structural diagnostics"):
//
//   - Blocking — "Logical problems block forward progress until
//     acknowledged" (line 216). Cycles in `supports` and contradictions
//     are listed explicitly under this heading (lines 218–219).
//   - Advisory — "Methodological opportunities — visible but non-
//     blocking" (line 223). Multiple competing warrants on one
//     data→claim (line 225), dangling claims (line 226), and coherency
//     hints (line 227) are listed under this heading.
//
// `docs/data-model.md` line 197 reaffirms coherency hints in
// particular: "Unusual edge/kind configurations [...] are flagged as
// advisory hints. Not errors; not blockers. Just nudges that something
// might warrant a closer look."
//
// The classifier is a pure read-side primitive over `DiagnosticEntry`.
// It does NOT modify the entry, does NOT wire into commit-gating, and
// does NOT introduce a new event kind — classification is derived data,
// computable from the entry's `kind` (and, in principle, from coherency-
// hint sub-kinds — though in v1 all three sub-kinds classify the same
// way).
//
// Boundary with the methodology engine: the engine's `commit_logic`
// handler is settled and shipped. Modifying it to consult this
// classifier and refuse-on-blocking is OUT of scope here — that wiring
// requires a notion of "acknowledged" on each diagnostic (per the
// methodology doc's "until acknowledged" framing) which has no event-
// log representation today. The downstream task
// `commit_gating_on_blocking_diagnostics` (provisional name) will pick
// up the gating wiring; this task delivers only the classifier and the
// partition helper.
//
// `pending-consequences` is NOT classified here — it is excluded from
// the `DiagnosticEntry` union per its stub-framing. Future re-promotion
// adds the entry kind to both `event-emission.ts` and this module
// together; the data-model doc's "signalling commitments" framing
// (line 104) means it will classify as advisory.

import type { DiagnosticEntry } from './event-emission.js';

/**
 * Two-level severity for diagnostics, per `docs/methodology.md` lines
 * 210–227.
 *
 * - `'blocking'` — the methodology should require resolution (or
 *   acknowledgment, including axiom-marking the position) before
 *   further commits on the affected facet are permitted. Cycle in
 *   `supports` and contradiction are the two blocking kinds.
 * - `'advisory'` — informational; the moderator may act on the
 *   diagnostic or leave it. Multi-warrant, dangling-claim, and the
 *   coherency hints are advisory.
 *
 * String-literal union (matching the project-wide pattern for
 * discriminator types) rather than a TS enum. No runtime artifact.
 */
export type Severity = 'blocking' | 'advisory';

/**
 * Classify a single diagnostic entry as `'blocking'` or `'advisory'`.
 *
 * The mapping is doc-grounded — every classification cites the
 * relevant `docs/methodology.md` or `docs/data-model.md` paragraph in
 * this module's leading comment. It is a pure function of the entry's
 * `kind` (and, for `coherency-hint`, of the inner `hint.kind` — though
 * in v1 every sub-kind classifies the same way).
 *
 * The switch is exhaustive over `DiagnosticEntry.kind` by TypeScript's
 * discriminated-union narrowing — there is no `default` branch. Adding
 * a sixth kind to the union (e.g., re-promoting `pending-consequence`)
 * is a compile error in this file until classified. Intentional.
 */
export function classifyDiagnostic(entry: DiagnosticEntry): Severity {
  switch (entry.kind) {
    case 'cycle':
      // methodology.md line 218 — "Cycle in `supports` — break one
      // `supports` edge, decompose a node in the cycle, or have a
      // participant axiom-mark a node in the cycle." Listed under
      // "Blocking diagnostics."
      return 'blocking';

    case 'contradiction':
      // methodology.md line 219 — "Contradiction — decompose one or
      // both nodes, amend one to remove conflict, or accept the
      // contradiction as a bedrock disagreement." Listed under
      // "Blocking diagnostics."
      return 'blocking';

    case 'multi-warrant':
      // methodology.md line 225 — "Multiple competing warrants on one
      // data→claim — decompose the claim. [...] if the participants
      // don't see it that way, no requirement to act." Listed under
      // "Advisory diagnostics."
      return 'advisory';

    case 'dangling-claim':
      // methodology.md line 226 — "Dangling claim — a soft prompt; the
      // moderator asks for support or asks whether the claim is being
      // conceded/accepted." Listed under "Advisory diagnostics."
      // data-model.md line 191 also frames this as "tracked as a
      // state" rather than an error.
      return 'advisory';

    case 'coherency-hint':
      // methodology.md line 227 — "Coherency hints — advisory only; no
      // required resolution." data-model.md line 197 reaffirms: "Not
      // errors; not blockers. Just nudges." All three sub-kinds
      // (`incomplete-warrant-missing-bridges-to`,
      // `incomplete-warrant-missing-bridges-from`, `self-contradicts`)
      // classify the same way; the doc has no per-sub-kind qualifier.
      // The test file exercises each sub-kind individually so a future
      // reader sees the decision encoded per-sub-kind. If a future
      // variant ever needs to be blocking, this branch becomes a
      // narrower switch on `entry.hint.kind`.
      return 'advisory';
  }
}

/**
 * Partition a list of diagnostic entries into the `'blocking'` and
 * `'advisory'` buckets. Pure function; preserves input order within
 * each bucket; round-trip property — the union of the two buckets
 * (as multisets) equals the input list, and each entry appears in
 * exactly one bucket.
 *
 * Common use: the moderator UI's diagnostic panel renders the
 * blocking entries first (red-bordered, "must address") and the
 * advisory entries below (yellow, "nudges"); the consumer wants both
 * lists in their detector-order without re-sorting.
 *
 * The same shape is also useful in tests — a single call yields both
 * buckets in one pass so the round-trip property is asserted at one
 * call site.
 */
export function partitionBySeverity(entries: DiagnosticEntry[]): {
  blocking: DiagnosticEntry[];
  advisory: DiagnosticEntry[];
} {
  const blocking: DiagnosticEntry[] = [];
  const advisory: DiagnosticEntry[] = [];
  for (const entry of entries) {
    if (classifyDiagnostic(entry) === 'blocking') {
      blocking.push(entry);
    } else {
      advisory.push(entry);
    }
  }
  return { blocking, advisory };
}
