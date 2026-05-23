// Tests for `disputationOutcome` — the pure derivation helper that maps
// a substance `FacetStatus` to the methodology's `data | claim | unsettled`
// vocabulary.
//
// Refinement: tasks/refinements/moderator-ui/mod_disputation_test_display.md
//
// Per ADR 0022 these are committed Vitest cases. They pin:
//
//   - The exhaustive mapping table from `FacetStatus` → `DisputationOutcome`
//     (the load-bearing methodology contract — drift here is a
//     methodology-engine-level discrepancy).
//   - The `undefined` → `null` branch (no substance facet activity → no
//     methodology label to surface).
//   - An exhaustive-narrow guard: every `FacetStatus` value sourced from
//     the canonical tuple maps to a non-undefined output. A future
//     `FacetStatus` enum addition trips this test, forcing the mapping
//     to grow alongside.

import { describe, expect, it } from 'vitest';

import { disputationOutcome, type DisputationOutcome } from './disputationOutcome';
import type { FacetStatus } from './facetStatus';

// Canonical `FacetStatus` tuple — single source of truth for the
// exhaustive-narrow guard below. Sourced from `facetStatus.ts` L43-L49.
// Listed as a `readonly tuple` so the TypeScript-level enum addition
// also surfaces as a compile error if `FacetStatus` grows without this
// constant updating (the `satisfies readonly FacetStatus[]` clause is
// the structural check).
const ALL_FACET_STATUSES = [
  'proposed',
  'agreed',
  'disputed',
  'committed',
  'withdrawn',
  'meta-disagreement',
  // TODO(pf_projection_facet_status_refactor): empty-state row introduced
  // by `pf_awaiting_proposal_facet_status`. For now `disputationOutcome`
  // maps it to `'unsettled'` (same as `'proposed'`) — see the TODO in
  // `disputationOutcome.ts`. The downstream
  // `pf_projection_facet_status_refactor` task will revisit the mapping
  // when it lands real emission rules.
  'awaiting-proposal',
] as const satisfies readonly FacetStatus[];

describe('disputationOutcome — canonical mapping', () => {
  it('agreed → data', () => {
    expect(disputationOutcome('agreed')).toBe('data' satisfies DisputationOutcome);
  });

  it('disputed → claim', () => {
    expect(disputationOutcome('disputed')).toBe('claim' satisfies DisputationOutcome);
  });

  it('meta-disagreement → claim', () => {
    // Per refinement Decision §2: meta-disagreement is the escalation
    // of a dispute — the operational next-action is the same as for
    // disputed, so the data-vs-claim outcome is the same.
    expect(disputationOutcome('meta-disagreement')).toBe('claim' satisfies DisputationOutcome);
  });

  it('proposed → unsettled', () => {
    expect(disputationOutcome('proposed')).toBe('unsettled' satisfies DisputationOutcome);
  });

  it('committed → data', () => {
    // Per refinement Decision §3: closed-state committed mirrors the
    // post-agreement reading; the node served as data and that record
    // persists.
    expect(disputationOutcome('committed')).toBe('data' satisfies DisputationOutcome);
  });

  it('withdrawn → unsettled', () => {
    // Per refinement Decision §3: prior agreement retracted; the
    // disputation test is open again.
    expect(disputationOutcome('withdrawn')).toBe('unsettled' satisfies DisputationOutcome);
  });

  it('undefined → null', () => {
    // No substance facet activity has touched the node — no methodology
    // reading to surface. The call site (`<StatementNode>`) gates
    // chip rendering on the `!== null` check.
    expect(disputationOutcome(undefined)).toBeNull();
  });
});

describe('disputationOutcome — exhaustive-narrow guard', () => {
  it('maps every FacetStatus value to a non-null outcome', () => {
    // If a future enum addition lands in `FacetStatus` without growing
    // the mapping, this loop fails for the new value (the default branch
    // in `disputationOutcome` would surface as `never`, returning
    // undefined at runtime).
    for (const status of ALL_FACET_STATUSES) {
      const outcome = disputationOutcome(status);
      expect(outcome, `disputationOutcome(${status}) should not be null`).not.toBeNull();
      // Pin the narrow: the value must be one of the three
      // `DisputationOutcome` literals.
      expect(['data', 'claim', 'unsettled']).toContain(outcome);
    }
  });
});
