# Shape-facet wire vote + tighten `set-edge-substance` sequence gate

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.server_handlers.pf_shape_facet_wire_vote`
**Effort estimate**: 0.5d
**Inherited dependencies** (settled): `pf_sequence_gate_server_enforced`, `pf_vote_handler_facet_keyed` (and via the block-level `server_handlers depends !projection` and `projection depends !schema_and_events`, transitively `pf_awaiting_proposal_facet_status` + `pf_facet_keyed_vote_payload` + the full schema-and-events + projection sub-blocks).

> **Note on placement**: this task sits under `server_handlers` rather than `schema_and_events` even though the enum-widening half lives in `packages/shared-types/src/events/enums.ts`. The reason is graph-topology: a forward dep from `schema_and_events` back into `server_handlers` (needed to express "we're tightening the gate the sequence-gate task introduced") would cycle, because `server_handlers depends !projection depends !schema_and_events`. Placing it under `server_handlers` lets the cross-block schema work travel with the handler tightening without inverting the block-level DAG.

## What this task is

Widen the wire-level facet vocabulary to include `'shape'`, then close the deferred arm of the propose-handler sequence gate that depends on it:

1. Extend `facetNameSchema` in [`packages/shared-types/src/events/enums.ts`](../../../packages/shared-types/src/events/enums.ts) from the current three values (`'classification' | 'substance' | 'wording'`) to four by adding `'shape'`.
2. Verify the shape-facet vote / commit / withdraw flow round-trips through the wire (the discriminated-union vote / commit / meta-disagreement-marked / withdraw-agreement payloads already landed under the schema-and-events sub-block all key by `facetName: FacetName`; widening the enum extends the discriminator naturally).
3. Tighten the `set-edge-substance` arm of the propose handler's sequence gate in [`apps/server/src/methodology/handlers/propose.ts`](../../../apps/server/src/methodology/handlers/propose.ts) — remove the `TODO(pf_shape_facet_wire_vote)` marker at the `set-edge-substance` case (around line 1532) and activate the rejection: refuse `set-edge-substance` against an extant edge whose `shape` facet is not `'agreed'` / `'committed'`.

## Why it needs to be done

[ADR 0030 §8](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) specifies the sequence gate for all three facet-valued proposals symmetrically: `classify-node` gates on wording; `set-node-substance` gates on classification; `set-edge-substance` gates on the edge's `shape` facet. The first two arms landed under `pf_sequence_gate_server_enforced`; the third was **deferred** because the wire-level `facetNameSchema` is 3-valued (no `'shape'`), so there is no end-to-end path for shape-facet votes / commits to flow through the facet-keyed projection and reach `'agreed'` / `'committed'` — activating the gate against that backdrop would lock every `set-edge-substance` proposal out of the methodology (a v1 edge's shape facet enters life `'proposed'` per the projection refactor and never advances).

This task closes the loop: widen the enum, then activate the gate against the now-reachable accepting states.

## Inputs / context

- [ADR 0030 §5, §8 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the per-facet-keying spec; §5 carries the shape-facet definition, §8 carries the symmetric sequence gate.
- [`packages/shared-types/src/events/enums.ts`](../../../packages/shared-types/src/events/enums.ts) (line 66) — current `facetNameSchema = z.enum(['classification', 'substance', 'wording'])`. The comment at line 61–64 already flags the shape expansion as deferred to "downstream projection-refactor tasks"; this task IS that downstream.
- [`apps/server/src/methodology/handlers/propose.ts`](../../../apps/server/src/methodology/handlers/propose.ts) (around line 1532) — the `TODO(pf_shape_facet_wire_vote)` marker. The call site already reads `ProjectedEdge.shapeFacet` via the exported `deriveFacetStatusFromState` helper for reference; the tightening swaps the `void shapeStatus` reference for a real rejection arm symmetric with the existing classification / wording arms above.
- [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts) — `deriveFacetStatusFromState`, the read entry point the gate already uses.
- Source-of-debt commit: the `pf_sequence_gate_server_enforced` closing commit (to be assigned when this refinement lands and the gate-task commit hits HEAD).
- [`docs/methodology.md`](../../../docs/methodology.md) F6 — the defeater-capture flow, the canonical use case for the substance-only re-vote against an extant edge. The tightening must NOT lock this flow out (the F6 path operates against an edge whose shape is `'agreed'` / `'committed'` from a prior round; the gate accepts that state by design).
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — gate behavior is pinned by Vitest + at least one Cucumber + pglite scenario.
- [ADR 0029](../../../docs/adr/0029-protocol-rejection-policies.md) — typed error envelope shape; connection stays open on rejection. The shape arm reuses the existing `'facet-sequence-out-of-order'` rejection code (no new code, no new HTTP mapping — the predecessor-facet value in the message is `'shape'`).

## Constraints / requirements

- Enum widening lands at `packages/shared-types/src/events/enums.ts` only; the `FacetName` type-alias inference propagates the new value across every downstream consumer that uses `z.infer<typeof facetNameSchema>` or the `FacetName` type. Any consumer with an exhaustive `switch` over `FacetName` becomes a compile error until it handles `'shape'` — close those in-task with the appropriate behavior (most call sites should treat `'shape'` symmetrically with `'classification'`, since both are edge-keyed facets per ADR 0030 §5).
- The tightening MUST accept `set-edge-substance` against an edge whose `shape` is `'agreed'` or `'committed'` (the F6 defeater-capture path). It MUST refuse `set-edge-substance` against an edge whose `shape` is `'proposed'` / `'awaiting-proposal'` / `'disputed'` / `'withdrawn'` / `'meta-disagreement'` — i.e. the same accepting / refusing state set as the classification + wording arms above. The fresh-edge case (no projected edge yet, the connecting-capture path) continues to bypass the gate per the existing `validateSetEdgeSubstanceProposal` referential rules.
- Remove the `TODO(pf_shape_facet_wire_vote)` marker and the `void shapeStatus` reference; replace with the active rejection arm symmetric with the existing classification / wording arms. The rejection uses the existing `'facet-sequence-out-of-order'` reason (no new `RejectionReason`; the predecessor-facet name in the human-readable message becomes `'shape'`).
- Vitest cases at `apps/server/src/methodology/handlers/proposeSequenceGate.test.ts` (the existing file from `pf_sequence_gate_server_enforced`) gain a refuse-then-accept-after-shape-commit case for the shape arm. Existing classification + wording arm cases stay.
- A Cucumber + pglite scenario at `tests/behavior/backend/ws-propose.feature` pins the wire-level shape arm round (reject `set-edge-substance` against an edge whose shape is `'proposed'`; accept once shape is `'committed'`).
- No regression in the defeater-capture flow — the methodology-full-flow Playwright spec stays green; if it exercises the F6 path the spec serves as the canonical end-to-end pin.

## Acceptance criteria

- `facetNameSchema` in `packages/shared-types/src/events/enums.ts` is 4-valued: `['classification', 'substance', 'wording', 'shape']`. The deferral comment at lines 61–64 is removed or rewritten to reflect that the widening is now done.
- Downstream exhaustive `switch` statements over `FacetName` handle `'shape'` (compile errors closed).
- The `TODO(pf_shape_facet_wire_vote)` marker in `apps/server/src/methodology/handlers/propose.ts` is gone; the `set-edge-substance` arm of `validateSequence` returns a `'facet-sequence-out-of-order'` rejection when the edge's `shape` facet is not `'agreed'` / `'committed'`.
- New Vitest case in `apps/server/src/methodology/handlers/proposeSequenceGate.test.ts` pins the shape arm refuse + accept paths.
- New Cucumber scenario in `tests/behavior/backend/ws-propose.feature` pins the wire-level shape arm round (reject against `'proposed'` shape; accept once shape `'committed'`).
- `pnpm run check` green; `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` green; `tj3 project.tjp` parses clean. The methodology-full-flow Playwright spec stays green (no defeater-capture regression).

## Decisions

(none — all decided per ADR 0030 §5 + §8 + the inherited gate-task design)

## Open questions

(none — all decided)

## Status

_pending implementation_
