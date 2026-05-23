# `awaiting-proposal` FacetStatus enum value

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.schema_and_events.pf_awaiting_proposal_facet_status`
**Effort estimate**: 0.5d
**Inherited dependencies**: (none upstream — additive enum widening; downstream `pf_projection_facet_status_refactor` and the moderator / participant UI tasks consume the new value)

## What this task is

Widen the `FacetStatus` enum from six values (`proposed | agreed | disputed | committed | withdrawn | meta-disagreement`) to seven by adding `awaiting-proposal`. The widening lands in all three places the enum lives:

- `apps/server/src/projection/facet-status.ts` + `apps/server/src/projection/types.ts` (the canonical definition).
- `apps/moderator/src/graph/facetStatus.ts` (the moderator mirror).
- `apps/participant/src/graph/facetStatus.ts` (the participant mirror).

Per [ADR 0030 §10](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): `awaiting-proposal` applies when the entity exists but no candidate value has been set for that facet yet (most commonly a freshly captured node's `classification` and `substance` facets, before a `classify-node` / `set-node-substance` proposal has been made). Distinct from `proposed`, which means "a candidate has been set and is gathering votes."

## Why it needs to be done

[ADR 0030 §10](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) explicitly enumerates the new value as a Consequence: existing six-value enum grows to seven; exhaustive `switch`es in consumers (per the `noFallthroughCasesInSwitch` + `never` default pattern from [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)) become compile errors until they handle it. The missing case is the surface that needs to surface the empty-state row in the participant detail panel. This task is the first step — the type-level addition — which closes those compile-time gaps with `TODO(pf_projection_facet_status_refactor)` markers + sensible defaults (most consumers map `'awaiting-proposal'` to the same behavior as `'proposed'`, since both are pre-agreement states with no settled record). The downstream consumer-rewriting tasks (`pf_projection_facet_status_refactor`, `pf_mod_node_card_classification_affordance`, `pf_mod_node_card_substance_affordance`, `pf_part_detail_panel_three_facet_rows`) then replace those defaults with the real `'awaiting-proposal'` behavior.

> **Note on green-build discipline:** an earlier draft of this refinement said this task should "leave the build red so the downstream tasks have a surface to work against." That guidance was incorrect — `ORCHESTRATOR.md` requires every leaf commit leaves the working tree green (`pnpm run check` passes, all three test suites pass, `make up` builds cleanly). The orchestrator rule wins; we close the consumer gaps in-task with TODO markers + sensible defaults and let the downstream tasks rewrite them later. The compile-error surface is still useful as a *transient* signal during implementation of this task — it tells the implementer exactly which consumers need a default + TODO marker — but the final commit must be green.

## Inputs / context

- [ADR 0030 §10 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts) — `deriveFacetStatus` and its return-type enum.
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) — `FacetStatus` union.
- [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) — moderator mirror.
- [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) — participant mirror.
- [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the `noFallthroughCasesInSwitch` + `never` exhaustiveness pattern that turns the enum change into compile errors at every consumer.

## Constraints / requirements

- The new enum value lands in all three source locations simultaneously (same commit). Cross-package drift is the bug the parallel definitions exist to surface; widening one without the others is what `tsc` is supposed to catch.
- Existing six-value semantics keep their meaning — `'awaiting-proposal'` is strictly additive, never written by any handler the current codebase already has (the new state is produced by `pf_projection_facet_status_refactor`'s rewritten derivation).
- This task DOES update consumer `switch` statements with TODO markers + sensible defaults so the build stays green (per `ORCHESTRATOR.md`'s leaf-commit-green-build rule). Each `awaiting-proposal` arm carries a `TODO(pf_projection_facet_status_refactor)` (or the closest correct downstream task — `pf_mod_node_card_*` for moderator-card rendering, `pf_part_detail_panel_three_facet_rows` for the participant detail panel) marker that names the downstream task that will replace the default with the real `awaiting-proposal` behavior. The default is "behave like `'proposed'`" almost everywhere (since both are pre-agreement states with no settled record); the shell's `<FacetPill>` and its `PILL_STATUS_CLASSNAME` map are extended (rather than narrowed at the call site) so the moderator and participant call sites can pass the widened `FacetStatus` through without a cast.

## Acceptance criteria

- All three `FacetStatus` definitions include `'awaiting-proposal'`.
- Type-level export carries the seven values.
- The shell-side `FacetStatus` union in `packages/shell/src/facet-pill/types.ts` is also extended (and `PILL_STATUS_CLASSNAME` gains an `'awaiting-proposal'` entry) so the moderator and participant call sites that pass the widened type into `<FacetPill>` continue to compile without a cast. The shell's default styling for `'awaiting-proposal'` mirrors `'proposed'` (dashed slate / faded); the downstream UI tasks will retune it.
- Consumer `switch` statements (`apps/server/src/diagnostics/pending-consequences.ts`, `apps/moderator/src/graph/disputationOutcome.ts`) gain an `'awaiting-proposal'` arm with a `TODO(pf_projection_facet_status_refactor)` marker; the arm semantically maps to the same behavior as `'proposed'` (no candidate → no consequence; no candidate → `'unsettled'` disputation outcome).
- `Record<FacetStatus, …>` shapes (notably `PILL_STATUS_CLASSNAME` and the `ProposalFacetBreakdown` per-status matrix test) gain an `'awaiting-proposal'` key with a sensible default + TODO marker.
- `pnpm run check` is green; Vitest, Cucumber, and Playwright smoke suites all pass. Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), no test is added that asserts "it compiles" — the existing exhaustive-narrow guards in `disputationOutcome.test.ts` and `ProposalFacetBreakdown.test.tsx` already pin the new arm because their `ALL_FACET_STATUSES` / `statuses` tuples are updated alongside the enum.
- `tj3 project.tjp` parses clean.

## Decisions

- **Three mirrored definitions, not a shared one.** Today's architecture has the server, moderator, and participant each carrying their own `FacetStatus` definition (with structural parity). The refactor preserves the architecture; consolidating into a shared package is out of scope (would itself need an ADR).
- **Green-build discipline overrides "ship-it-red" temptation.** An earlier draft of this refinement said consumers could go red for a tick while dependent tasks land; that conflicts with `ORCHESTRATOR.md`'s leaf-commit-green-build rule (every commit leaves `pnpm run check` + the three test suites passing). The orchestrator rule wins: we close the gap in-task with `TODO(pf_projection_facet_status_refactor)` (or the closest correct downstream task — `pf_mod_node_card_*`, `pf_part_detail_panel_three_facet_rows`) markers + sensible defaults. The downstream consumer-rewriting tasks read the TODO markers to find their surface; they do NOT rely on `tsc` errors as their work surface.
- **Empty-state row carriage** is the UI's job, not this task's. [ADR 0030 Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) describes the row shape (empty-state text, no vote buttons); the moderator + participant UI tasks implement it.

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-23.

- `FacetStatus` widened from six to seven values across all three mirrors: [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts), [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts), [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts).
- Shell `<FacetPill>` extended to the seven-value union: [`packages/shell/src/facet-pill/types.ts`](../../../packages/shell/src/facet-pill/types.ts) + [`packages/shell/src/facet-pill/FacetPill.tsx`](../../../packages/shell/src/facet-pill/FacetPill.tsx) (`PILL_STATUS_CLASSNAME['awaiting-proposal']` mirrors `'proposed'` styling, pending downstream UI tasks).
- Consumer gaps closed with `'proposed'`-equivalent defaults + TODO markers: [`apps/server/src/diagnostics/pending-consequences.ts`](../../../apps/server/src/diagnostics/pending-consequences.ts), [`apps/moderator/src/graph/disputationOutcome.ts`](../../../apps/moderator/src/graph/disputationOutcome.ts) (+ test), [`apps/moderator/src/graph/proposalFacets.ts`](../../../apps/moderator/src/graph/proposalFacets.ts), [`apps/moderator/src/graph/StatementNode.tsx`](../../../apps/moderator/src/graph/StatementNode.tsx) (ROLLUP_PRIORITY head), [`apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx`](../../../apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx) (matrix row).
- 9 TODO markers left, pointing at existing WBS leaves: 6 → `pf_projection_facet_status_refactor`, 1 → `pf_mod_node_card_classification_affordance`, 1 → `pf_part_detail_panel_three_facet_rows`, 1 shell-rendering TODO citing multiple downstream tasks. No new WBS registration needed.
- Refinement amended in place (Why-it-needs-to-be-done / Constraints / Acceptance / Decisions sections) to replace the prior "leave the build red" guidance with green-build-per-commit discipline per `ORCHESTRATOR.md`. Prior Status section was a placeholder; this block is the historical record of how it landed.
- Verification: `pnpm run check` green. Vitest 4287 → 4288 (+1). Cucumber 249 / 1715 unchanged. Playwright 107 unchanged. `make up` / `make down-v` clean.
