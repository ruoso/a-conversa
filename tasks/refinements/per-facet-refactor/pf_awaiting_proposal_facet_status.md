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

[ADR 0030 §10](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) explicitly enumerates the new value as a Consequence: existing six-value enum grows to seven; exhaustive `switch`es in consumers (per the `noFallthroughCasesInSwitch` + `never` default pattern from [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)) become compile errors until they handle it. The missing case is the surface that needs to surface the empty-state row in the participant detail panel. This task is the first step — the type-level addition — which deliberately breaks the downstream consumers so they can be updated next.

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
- This task does NOT update consumer `switch` statements to handle the new case. That is intentional — the broken builds are the surface the downstream consumer tasks (`pf_projection_facet_status_refactor`, the moderator UI tasks, the participant UI tasks) work against to know they're covering the new state. Each consumer task closes its own slice of the compile-time gap.

## Acceptance criteria

- All three `FacetStatus` definitions include `'awaiting-proposal'`.
- Type-level export carries the seven values.
- The downstream consumer build breakage is real (not papered over with `as` / `??`) — this task ships the type change and stops; the per-consumer tasks each close their own switch coverage.
- `pnpm run typecheck` against the three packages reports the new exhaustiveness errors and **only** the new exhaustiveness errors (no unrelated breakage). Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), there is no test added that asserts "it compiles" — the downstream tasks each ship their own coverage; this task's surface is the type addition itself.
- `tj3 project.tjp` parses clean.

## Decisions

- **Three mirrored definitions, not a shared one.** Today's architecture has the server, moderator, and participant each carrying their own `FacetStatus` definition (with structural parity). The refactor preserves the architecture; consolidating into a shared package is out of scope (would itself need an ADR).
- **No interim adapter.** Some consumers will go red for a tick while the dependent tasks land. That is acceptable because the dependent tasks ship in the same `pf_*` chain within the same WBS milestone — the broken state never reaches `main` un-fixed because the milestone gate only flips when every dependent task is done.
- **Empty-state row carriage** is the UI's job, not this task's. [ADR 0030 Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) describes the row shape (empty-state text, no vote buttons); the moderator + participant UI tasks implement it.

## Open questions

(none — all decided per ADR 0030)
