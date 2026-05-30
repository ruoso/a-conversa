# Widen `setEdgeSubstanceProposalSchema` + `captureNodeEdgeShapeSchema` for annotation endpoints; widen `validateSetEdgeSubstanceProposal` to a polymorphic visibility / agreement check

**TaskJuggler entry**: `data_and_methodology.methodology_engine.set_edge_substance_annotation_endpoint` — [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) (block at lines 424-434). Embedded note: *"Source of debt: edge_target_annotation_schema_extension — widens setEdgeSubstanceProposalSchema's optional endpoint fields and captureNodeEdgeShapeSchema's four endpoint fields to allow annotation ids. Extends validateSetEdgeSubstanceProposal rule 2a/2b visibility checks from nodeIsVisible to a polymorphic entityIsVisible(projection, 'node'|'annotation', id)."*

## Effort estimate

**0.5d** (per the `.tji` allocation). The work is engine-internal:

- **Schema widening (~1h).** `setEdgeSubstanceProposalSchema` at [`packages/shared-types/src/events/proposals.ts:202-209`](../../../packages/shared-types/src/events/proposals.ts) gains `source_annotation_id` and `target_annotation_id` as `.uuid().optional()` fields; per-endpoint `.refine()` blocks (mirroring the predecessor [`edgeCreatedPayloadSchema`](../../../packages/shared-types/src/events.ts) refines at L309-330 of events.ts) enforce that AT MOST ONE side of each endpoint pair is present (zero-or-one — the substance-only re-vote shape stays valid). `captureNodeEdgeShapeSchema` at L137-144 gets the same four-field widening with a tightened `.refine()` (exactly-one per endpoint, because capture-with-edge requires fully-specified endpoints).
- **Primitive helpers (~0.5h).** [`apps/server/src/methodology/primitives.ts`](../../../apps/server/src/methodology/primitives.ts) gains `annotationIsVisible(projection, annotationId): boolean` (mirroring `nodeIsVisible` / `edgeIsVisible` at L332-358) and the polymorphic dispatcher `entityIsVisible(projection, kind: 'node' | 'annotation' | 'edge', id): boolean` (per D2 the dispatcher is general over the three entity kinds; today's validator only uses `'node'` / `'annotation'`).
- **Validator widening (~1.5h).** `validateSetEdgeSubstanceProposal` at [`apps/server/src/methodology/handlers/propose.ts:1216-1314`](../../../apps/server/src/methodology/handlers/propose.ts):
  - Phase 1 symmetry: "any endpoint slot present → role present AND exactly one source-side slot present AND exactly one target-side slot present." Per D4 the per-endpoint XOR shape is enforced at the schema layer; the validator's Phase 1 enforces the cross-side "all sides present together" symmetry the schema cannot express in a single `.refine()`.
  - Drop the defensive `existingEdge` annotation-endpoint reject at L1257-1266 (added by `projection_edge_annotation_endpoint` D6 as a breadcrumb to THIS task).
  - Phase 2a / 2b: replace `nodeIsVisible(projection, ...)` with `entityIsVisible(projection, 'node' | 'annotation', resolvedId)` driven by whichever slot is present. → `'target-entity-not-found'` (sibling precedent — D6 mirrors `set_edge_substance_endpoint_validation` D2).
  - Phase 2c agreement: compare carried polymorphic triple `(source*, target*, role)` against the projected edge's polymorphic triple `((sourceNodeId | sourceAnnotationId), (targetNodeId | targetAnnotationId), role)`. → `'illegal-state-transition'` per the sibling precedent.
- **Capture-node validator extension (~0.5h).** `validateCaptureNodeProposal` at [`apps/server/src/methodology/handlers/propose.ts:1355-1411`](../../../apps/server/src/methodology/handlers/propose.ts) rule 3 widens analogously: each endpoint resolves via `entityIsVisible(projection, kind, id)`; the "self-reference for fresh node" guard (today `edge.source_node_id === nodeId`) stays for the node-id case (annotation endpoints cannot self-reference a capture-time-minted entity per D7).
- **Structural-event builder threading (~0.5h).** The `set-edge-substance` arm of `buildStructuralEventsForPropose` at [`propose.ts:1897-1948`](../../../apps/server/src/methodology/handlers/propose.ts) and the capture-with-edge arm at [`propose.ts:1862-1894`](../../../apps/server/src/methodology/handlers/propose.ts) thread the four polymorphic endpoint fields into the emitted `edge-created` payload (using `?? undefined` for the absent slot; the wire schema's per-endpoint `.refine()` already guarantees exactly one per endpoint is set). Per D5 the fresh-edge predicate becomes "source-side defined AND target-side defined AND role defined AND `getEdge(edgeId) === undefined`" (the same shape as today, just polymorphic over which slot satisfies "defined").
- **Vitest cover (~1h).** Extend [`apps/server/src/methodology/handlers/proposeSetEdgeSubstanceValidation.test.ts`](../../../apps/server/src/methodology/handlers/proposeSetEdgeSubstanceValidation.test.ts) (landed by the sibling `set_edge_substance_endpoint_validation`) with: new symmetry cases for the polymorphic shape; new 2a / 2b cases against missing or invisible annotation endpoints; new 2c agreement cases across the polymorphic pairings (carried-node vs projected-annotation, carried-annotation vs projected-node, both-annotation mismatch); happy-path accepts for each of the three new polymorphic shapes (node→annotation, annotation→node, annotation→annotation). Extend [`apps/server/src/methodology/handlers/proposeCaptureNode.test.ts`](../../../apps/server/src/methodology/handlers/proposeCaptureNode.test.ts) (or sibling) with capture-with-annotation-endpoint cases. New per-XOR schema cases at [`packages/shared-types/src/events/proposals.test.ts`](../../../packages/shared-types/src/events/proposals.test.ts) mirror the predecessor's `edgeCreatedPayloadSchema` cover.
- **Cucumber cover (~0.5h).** Per D8 a new scenario in [`tests/behavior/ws/propose.feature`](../../../tests/behavior/ws/propose.feature) (or sibling) pins the wire-level round-trip of a `propose` carrying a `set-edge-substance` with `target_annotation_id` — emitted `edge-created` + `entity-included` carry the polymorphic shape; the projection (post-`projection_edge_annotation_endpoint`) reflects the annotation-endpoint edge.

No new ADR. No DB migration. No UI consumer change.

## Inherited dependencies

**Settled:**

- [`data_and_methodology.event_types.edge_target_annotation_schema_extension`](./edge_target_annotation_schema_extension.md) (done — 2026-05-30). Widened `edgeCreatedPayloadSchema` with four `.optional()` endpoint fields and per-endpoint `.refine()` XOR blocks at [`packages/shared-types/src/events.ts:309-330`](../../../packages/shared-types/src/events.ts). The predecessor's Status block at L210-216 and its tech-debt registration entry name THIS task as the proposal-side follow-up that widens `setEdgeSubstanceProposalSchema` + `captureNodeEdgeShapeSchema` and the matching validator.
- [`data_and_methodology.projection.projection_edge_annotation_endpoint`](./projection_edge_annotation_endpoint.md) (done — 2026-05-30). Widened `ProjectedEdge` to four polymorphic endpoint slots (`sourceNodeId: string | null` + `sourceAnnotationId: string | null` + symmetric target pair) at [`apps/server/src/projection/types.ts:228-248`](../../../apps/server/src/projection/types.ts). Added the defensive guard at [`propose.ts:1257-1266`](../../../apps/server/src/methodology/handlers/propose.ts) (its D6 breadcrumb explicitly names THIS task) — the guard is the load-bearing constraint THIS task lifts.
- [`data_and_methodology.methodology_engine.set_edge_substance_endpoint_validation`](./set_edge_substance_endpoint_validation.md) (done — 2026-05-17, commit `7037c08` per its Status block). Landed `validateSetEdgeSubstanceProposal` with the three-rule structure (Phase 1 symmetry, Phase 2a/2b node-visibility, Phase 2c agreement) and the sibling test file `proposeSetEdgeSubstanceValidation.test.ts`. THIS task extends each rule polymorphically — Phase 1 symmetry over four endpoint slots, Phase 2a/2b over `entityIsVisible` instead of `nodeIsVisible`, Phase 2c over polymorphic triples — without reshaping the validator's two-phase structure.
- [`moderator_ui.mod_graph_rendering.mod_set_edge_substance_endpoint_carriage`](../moderator-ui/mod_set_edge_substance_endpoint_carriage.md) (done — commit `7037c08`). The originating task that introduced the three optional endpoint fields on `setEdgeSubstanceProposalSchema`. Its D2 is the source-of-debt for the whole chain.
- [`data_and_methodology.methodology_engine.agreement_state_machine`](./agreement_state_machine.md), [`data_and_methodology.methodology_engine.break_edge_logic`](./break_edge_logic.md), [`data_and_methodology.methodology_engine.amend_node_logic`](./amend_node_logic.md), [`data_and_methodology.methodology_engine.meta_move_logic`](./meta_move_logic.md), [`data_and_methodology.methodology_engine.annotation_logic`](./annotation_logic.md) (all done) — sibling validator templates. Pin the `validateXProposal(projection, action): RejectedValidationResult | null` shape, the reuse-existing-codes preference (D6), and the two-phase rule layout (D4).
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md). Schema-on-write: the four widened proposal fields parse at envelope-parse time; the validator runs on top of an already-shape-validated payload.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). Vitest + Cucumber cover.
- [ADR 0027 — Entity and facet layers strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md). Edge entity identity is fixed at `edge-created` time; the agreement rule (2c) enforces this against the polymorphic shape.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md). The shape facet's inline-candidate carriage continues to be the widened `EdgeShape`. No facet-keying change.

**Pending:** (none — every load-bearing input is settled on `main`.)

## What this task is

Widen the proposal-side wire shape and the methodology validator so that `set-edge-substance` (and the capture-with-edge sub-shape of `capture-node`) accept polymorphic endpoints — each endpoint independently `(node id | annotation id)` mirroring the projection's `ProjectedEdge` and the wire `edge-created` payload. The predecessor `projection_edge_annotation_endpoint` left a defensive guard in `validateSetEdgeSubstanceProposal` rejecting any existing edge with annotation endpoints, naming THIS task as the resolver; THIS task lifts the guard and threads the polymorphic shape end-to-end.

Concretely the deliverable is six artefacts:

1. **Widened proposal schemas** — [`packages/shared-types/src/events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts).
   - `setEdgeSubstanceProposalSchema` (L202-209): gains `source_annotation_id: z.string().uuid().optional()` and `target_annotation_id: z.string().uuid().optional()`. Per-endpoint `.refine()` blocks enforce "AT MOST one side of each pair is set" (the substance-only re-vote shape sets zero endpoint slots). Cross-side symmetry is enforced at the validator layer per D4.
   - `captureNodeEdgeShapeSchema` (L137-144): same four-field widening; per-endpoint `.refine()` enforces EXACTLY one side per pair (capture-with-edge always carries a fully-specified pair — there is no "substance-only" shape for capture).

2. **Polymorphic visibility primitives** — [`apps/server/src/methodology/primitives.ts`](../../../apps/server/src/methodology/primitives.ts). New `annotationIsVisible(projection, annotationId): boolean` mirroring `nodeIsVisible` / `edgeIsVisible`. New `entityIsVisible(projection, kind, id): boolean` dispatching to the per-kind helper. Per D2 the dispatcher is general over `'node' | 'annotation' | 'edge'` (today's validators only use `'node'` and `'annotation'`; the `'edge'` arm composes the existing `edgeIsVisible` for symmetry).

3. **Widened `validateSetEdgeSubstanceProposal`** — [`propose.ts:1216-1314`](../../../apps/server/src/methodology/handlers/propose.ts).
   - Phase 1 symmetry expands to the polymorphic shape: "any endpoint slot present → role present AND exactly-one source-side slot present AND exactly-one target-side slot present." The schema's per-endpoint `.refine()` already enforces the XOR; the validator enforces the cross-side "all sides present together" rule and emits a single legible rejection naming whichever side(s) are short.
   - Drop the L1257-1266 defensive guard (its breadcrumb message named THIS task).
   - Phase 2a / 2b: route the visibility check through `entityIsVisible(projection, kind, id)` where `kind` is `'node'` if `source_node_id` is set and `'annotation'` otherwise (symmetric for target).
   - Phase 2c: compare carried polymorphic triple against projected polymorphic triple. The triple comparison is now four-or-six field-by-field equalities (the absent slot is `null` on the projection's record and `undefined` on the carried payload; the comparison uses `=== undefined ? null : value` on the carried side or coerces both to nullable form for a single comparison).

4. **Widened `validateCaptureNodeProposal`** — [`propose.ts:1355-1411`](../../../apps/server/src/methodology/handlers/propose.ts) rule 3. Each endpoint's visibility check resolves via `entityIsVisible(projection, kind, id)` driven by which slot is set. The self-reference guard (today `edge.source_node_id === nodeId`) stays for the node-id case only — annotation endpoints cannot self-reference a capture-time-minted node (the capture mints a node, not an annotation; an annotation endpoint must reference an EXISTING visible annotation per D7).

5. **Structural-event builder threading** — [`propose.ts:1862-1894`](../../../apps/server/src/methodology/handlers/propose.ts) (capture-with-edge arm) and [`propose.ts:1897-1948`](../../../apps/server/src/methodology/handlers/propose.ts) (set-edge-substance connecting-edge arm). Both threaded `edge-created` emissions pass `source_node_id` / `source_annotation_id` / `target_node_id` / `target_annotation_id` through to the emitted payload using `?? undefined` for the absent slot. The fresh-edge predicate becomes "source-side OR target-side OR role present" → polymorphic-form symmetry-validated → exists-check on edge_id.

6. **Vitest + Cucumber cover** — enumerated under Acceptance criteria. Vitest extends the sibling `proposeSetEdgeSubstanceValidation.test.ts` and `proposeCaptureNode.test.ts`; Cucumber adds one round-trip scenario per D8.

Out of scope (each registered as a named follow-up under Tech-debt registration): the moderator UI's gesture for proposing an annotation-endpoint set-edge-substance (depends on annotations being canvas-renderable — the three rendering follow-ups already registered by the predecessor `projection_edge_annotation_endpoint`); the moderator UI's capture-with-annotation-endpoint gesture (same dependency).

## Why it needs to be done

**The defensive guard at `propose.ts:1257-1266` is debt with this task's name on it.** Predecessor `projection_edge_annotation_endpoint` D6 introduced the guard to keep the build green when `ProjectedEdge` widened; the guard's detail message explicitly says `"see follow-up task set_edge_substance_annotation_endpoint"`. Until lifted, any proposal addressing an existing annotation-endpoint edge is silently rejected — meaning once `walkthrough_e15_annotation_endpoint_refit` lands and the projection contains an annotation-endpoint edge, no substance vote can ever be cast against it. THIS task is the closing move of the chain.

**The schema widening lets the moderator's UI eventually express annotation-endpoint substance and capture-with-edge gestures.** Three UI-stream follow-ups (`mod_render_annotation_endpoint_edges`, `part_render_annotation_endpoint_edges`, `aud_render_annotation_endpoint_edges`, registered by `projection_edge_annotation_endpoint`) will render annotation-endpoint edges on the canvas; the propose-time picker that mints such an edge needs the proposal payload to carry the annotation-endpoint shape. Landing the schema + validator widening here is the wire-level gate for those UI tasks.

**Validator-vs-emitter separation stays intact.** The sibling `set_edge_substance_endpoint_validation` established the two-section layering (validators at the top of `propose.ts`, structural-event builders at the bottom; each arm is one OR the other, never both). The widening replays that layering: the validator's polymorphic Phase 2a / 2b checks run before the builder; a rejected proposal emits nothing; the inverse-pair invariant with `entitiesToRetractForWithdraw` holds trivially.

**Schema-on-write doesn't cover the failure modes the validator catches.** `validateEvent` on the propose envelope catches malformed UUIDs and out-of-enum role values. It does NOT catch: (a) a partial polymorphic payload — e.g. `source_node_id` set, `target_node_id` set, `target_annotation_id` ALSO set (the schema's per-endpoint `.refine()` catches this one, fine), but NOT "source-side present, target-side missing, role present" (cross-side symmetry — D4); (b) a payload that references a UUID that resolves to an annotation that does not exist or has been retracted (no annotation-retract event exists today per [primitives.ts:355-358](../../../apps/server/src/methodology/primitives.ts) grep — but the helper is the right pattern for when it does); (c) a payload whose carried polymorphic triple disagrees with the projection's record of truth for the named `edge_id` (the structural-event builder would mis-emit a substance-only re-vote with a lying-about-endpoints payload).

Downstream consumers benefit:

- The walkthrough fixture E15 refit (the predecessor's `walkthrough_e15_annotation_endpoint_refit`) is unblocked: with the projection AND the proposal-side widened, the refitted E15 can flow through both replay (already supported by `projection_edge_annotation_endpoint`) AND propose (supported by THIS task) end-to-end.
- The three UI-stream rendering follow-ups (`mod_render_annotation_endpoint_edges` and siblings) gain their wire-side counterpart — the proposal payload they need to emit to mint annotation-endpoint edges through propose-time gestures.
- Replay tests that exercise the propose-path against annotation-endpoint edges become possible (today blocked by the L1257-1266 guard).

## Inputs / context

**Design contract:**

- [`docs/example-walkthrough.md`](../../../docs/example-walkthrough.md) — turn 21 names E15 (N19 contradicts A2). The narrative this task makes proposeable at-runtime (not just replayable from a fixture).
- [`docs/data-model.md`](../../../docs/data-model.md) L114-122 — the edge-role vocabulary (the seven roles enumerated in `edgeRoleSchema`). Unchanged: the seven roles are independent of endpoint kind.
- [`docs/methodology.md`](../../../docs/methodology.md) L57 — "A proposed change appears on the graph in `proposed` state from the moment it is made." Unchanged: the structural-event builder still emits `edge-created` + `entity-included` at propose-time for the connecting-edge / capture-with-edge cases; the polymorphic widening just lets those emissions carry annotation endpoints.

**Architectural / engineering inputs:**

- [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — schema-on-write. The widened proposal fields parse at envelope-parse time; the validator runs after.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every check ships as committed Vitest + Cucumber cover.
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — edge entity identity is fixed at `edge-created` time; the agreement rule enforces it against the polymorphic shape.
- [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — shape facet's inline-candidate carriage continues to carry the widened `EdgeShape`. No keying change.

**Runtime inputs (real file references the implementer reads + edits):**

- [`packages/shared-types/src/events/proposals.ts:137-144`](../../../packages/shared-types/src/events/proposals.ts) — `captureNodeEdgeShapeSchema`. Widens to four fields per endpoint pair + per-endpoint `.refine()` XOR (exactly-one, mirroring `edgeCreatedPayloadSchema`'s `.refine()` precedent).
- [`packages/shared-types/src/events/proposals.ts:202-209`](../../../packages/shared-types/src/events/proposals.ts) — `setEdgeSubstanceProposalSchema`. Same four-field widening; per-endpoint `.refine()` enforces at-most-one (per D3 the relaxation from exactly-one accommodates the substance-only re-vote shape; cross-side symmetry runs at the validator layer per D4).
- [`packages/shared-types/src/events/proposals.ts:167-200`](../../../packages/shared-types/src/events/proposals.ts) — the `set-edge-substance` header docblock. The "two distinct use-cases" paragraph at L185-197 amends to mention the polymorphic endpoint shape (each endpoint independently node OR annotation per the predecessor `edge_target_annotation_schema_extension`).
- [`packages/shared-types/src/events.ts:309-330`](../../../packages/shared-types/src/events.ts) — `edgeCreatedPayloadSchema`. **The polymorphic-target precedent** (per-endpoint `.optional()` + per-endpoint `.refine()` XOR — exactly-one per endpoint). The proposal schemas mirror this pattern, with `setEdgeSubstanceProposalSchema`'s `.refine()` relaxed to at-most-one per D3.
- [`apps/server/src/methodology/primitives.ts:332-358`](../../../apps/server/src/methodology/primitives.ts) — `nodeIsVisible` / `edgeIsVisible`. **The visibility-predicate precedent** for the new `annotationIsVisible` and `entityIsVisible` helpers.
- [`apps/server/src/projection/types.ts:236-261`](../../../apps/server/src/projection/types.ts) — `ProjectedEdge` (widened by `projection_edge_annotation_endpoint`) and `ProjectedAnnotation`. The annotation record carries a `.visible: boolean` flag (L259); the helper checks `projection.getAnnotation(id) !== undefined && annotation.visible === true`.
- [`apps/server/src/projection/projection.ts:345-352`](../../../apps/server/src/projection/projection.ts) — `setAnnotationVisible`. The annotation visibility mutator exists on the projection API; no replay arm currently flips it (no `annotation-retract`-style event has shipped yet) but the helper aligns with the existing visibility-check pattern.
- [`apps/server/src/methodology/handlers/propose.ts:1216-1314`](../../../apps/server/src/methodology/handlers/propose.ts) — `validateSetEdgeSubstanceProposal`. Widened in-place per Acceptance criteria (drop the L1257-1266 guard; route 2a/2b through `entityIsVisible`; widen 2c to polymorphic-triple comparison; expand Phase 1 symmetry over four endpoint slots).
- [`apps/server/src/methodology/handlers/propose.ts:1355-1411`](../../../apps/server/src/methodology/handlers/propose.ts) — `validateCaptureNodeProposal`. Widened in-place per Acceptance criteria (rule 3 routes through `entityIsVisible`; self-reference guard stays for the node-id case only).
- [`apps/server/src/methodology/handlers/propose.ts:1862-1894`](../../../apps/server/src/methodology/handlers/propose.ts) — capture-with-edge structural-event builder. Threads the four polymorphic endpoint fields into the emitted `edge-created` payload.
- [`apps/server/src/methodology/handlers/propose.ts:1897-1948`](../../../apps/server/src/methodology/handlers/propose.ts) — set-edge-substance connecting-edge structural-event builder. Same threading; the fresh-edge predicate becomes polymorphic-form symmetry-aware.
- [`apps/server/src/methodology/handlers/proposeSetEdgeSubstanceValidation.test.ts`](../../../apps/server/src/methodology/handlers/proposeSetEdgeSubstanceValidation.test.ts) — extended with polymorphic-shape cases per Acceptance criteria.
- [`apps/server/src/methodology/handlers/proposeCaptureNode.test.ts`](../../../apps/server/src/methodology/handlers/proposeCaptureNode.test.ts) — extended with capture-with-annotation-endpoint cases.
- [`packages/shared-types/src/events/proposals.test.ts`](../../../packages/shared-types/src/events/proposals.test.ts) — extended with per-XOR schema cases (round-trip + rejection patterns mirror the predecessor's `edgeCreatedPayloadSchema` cover at `events.test.ts:315-386`).
- [`tests/behavior/ws/propose.feature`](../../../tests/behavior/ws/propose.feature) (or sibling) — new round-trip scenario per D8.

## Constraints / requirements

- **Proposal-side scope.** Per D1 this task widens the proposal schemas + the matching validator + the structural-event builder threading + the capture-node validator. The projection layer is already widened (predecessor). UI-stream gestures stay deferred to the named UI-stream follow-ups.
- **Polymorphic shape mirrors the wire `edge-created` precedent.** Per D3 the proposal payloads carry four explicit fields per endpoint pair (`source_node_id`, `source_annotation_id`, `target_node_id`, `target_annotation_id`), NOT a `source_kind` / `source_id` discriminator. Matches the predecessor's `edgeCreatedPayloadSchema` shape one-for-one.
- **`setEdgeSubstanceProposalSchema`'s per-endpoint `.refine()` is at-most-one (zero-or-one), NOT exactly-one.** Per D4 the substance-only re-vote shape carries zero endpoint slots; an exactly-one refine would falsely reject it. Cross-side symmetry ("all sides present together when any is present") runs at the validator layer where the multi-field error message is legible.
- **`captureNodeEdgeShapeSchema`'s per-endpoint `.refine()` is exactly-one.** Per D4 capture-with-edge always carries fully-specified endpoints (there is no "substance-only" capture shape — the edge IS minted by the capture). Schema-layer exactly-one is the tighter check.
- **`entityIsVisible` helper is the polymorphic dispatcher.** Per D2 `entityIsVisible(projection, kind, id)` dispatches to `nodeIsVisible` / `annotationIsVisible` / `edgeIsVisible`. Today's validators only use `'node'` and `'annotation'`; the `'edge'` arm is added for symmetry (existing `edgeIsVisible` call sites — `meta_move_logic` — could migrate later but stay as-is in v1).
- **Drop the L1257-1266 defensive guard (the breadcrumb to THIS task).** Lifting it is the load-bearing deliverable.
- **No new `RejectionReason` value.** Per D6 the polymorphic widening reuses the established codes (`'target-entity-not-found'` for missing / invisible endpoints; `'illegal-state-transition'` for symmetry violations and agreement violations). Sibling precedent (`set_edge_substance_endpoint_validation` D2, `break_edge_logic`, `amend_node_logic`) — the detail string carries the kind-specific specificity.
- **Validator does NOT re-check structural shape.** Per ADR 0021 the schema's `.refine()` blocks catch per-endpoint XOR violations at envelope-parse. The validator runs on top of a shape-validated payload.
- **Validator runs BEFORE the structural-event builder.** Per the established sibling ordering (`set_edge_substance_endpoint_validation` D7) a rejected proposal emits nothing.
- **Substance-only re-vote stays valid.** A `set-edge-substance` proposal with zero endpoint slots satisfies Phase 1 trivially (antecedent false) and skips Phase 2. The existing baseline tests (`proposeDefeaterPreCommit.test.ts`) pass without modification.
- **No new ADR.** The polymorphic-target pattern is settled by `entity_creation_events` (R11 / option a), replayed at the wire layer by `edge_target_annotation_schema_extension`, replayed at the projection layer by `projection_edge_annotation_endpoint`, and now at the proposal layer here. The micro-decisions (at-most-one vs exactly-one `.refine()`, polymorphic-triple comparison shape, polymorphic visibility dispatcher) are engineering choices documented in Decisions, not architectural.
- **No DB migration.** The proposal payload rides on the existing JSONB envelope column — no DB schema change needed. The `edges` table widening is the separate `edges_table_polymorphic_endpoint_migration` follow-up (already registered by the predecessor).
- **No UI consumer change in this task.** Per D9 the moderator / participant / audience UI gestures that mint polymorphic-endpoint set-edge-substance / capture-with-edge proposals are deferred to UI-stream follow-ups (named explicitly under Tech-debt registration).
- **Test discipline per ADR 0022.** Each check ships as committed Vitest + Cucumber cover.
- **No Playwright cover.** This is a backend / methodology-engine task (`data_and_methodology.methodology_engine.*`), not UI-stream. Per the sibling `set_edge_substance_endpoint_validation` precedent and the refinements README's UI-stream e2e policy, Vitest + Cucumber are the right layers.

## Acceptance criteria

**Pinned per ADR 0022 — every empirical check ships as committed Vitest + Cucumber cover.** Per D8 Vitest carries the per-rule unit cover; Cucumber pins the propose-emits-edge-created round-trip at the WS seam.

Schema widening:

- [ ] [`packages/shared-types/src/events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts) `setEdgeSubstanceProposalSchema` gains `source_annotation_id: z.string().uuid().optional()` and `target_annotation_id: z.string().uuid().optional()` plus two per-endpoint `.refine()` blocks: `!(source_node_id !== undefined && source_annotation_id !== undefined)` (at-most-one source-side) and symmetric for target. Rejection messages name the contested endpoint pair.
- [ ] `captureNodeEdgeShapeSchema` gains the same four-field widening (existing two fields demoted from required to optional) plus two per-endpoint `.refine()` blocks: `(source_node_id !== undefined) !== (source_annotation_id !== undefined)` (exactly-one per D4) and symmetric for target.
- [ ] The `set-edge-substance` header docblock amends to describe the polymorphic endpoint shape (cross-reference this refinement and the predecessor `edge_target_annotation_schema_extension`).
- [ ] The `SetEdgeSubstanceProposal` and `CaptureNodeEdgeShape` exported types automatically widen via `z.infer<...>`.

Primitive helpers:

- [ ] [`apps/server/src/methodology/primitives.ts`](../../../apps/server/src/methodology/primitives.ts) gains `annotationIsVisible(projection, annotationId): boolean` returning `projection.getAnnotation(annotationId) !== undefined && annotation.visible === true` (mirrors `nodeIsVisible` / `edgeIsVisible`).
- [ ] Gains `entityIsVisible(projection, kind: 'node' | 'annotation' | 'edge', id): boolean` dispatching to the per-kind helper. The `'edge'` arm composes `edgeIsVisible` (for symmetry — no validator uses it in v1 per D2).
- [ ] Both helpers carry header docblocks following the established pattern (when the predicate returns true / false, what supersession / visibility semantics apply, what callers use it).

`validateSetEdgeSubstanceProposal` widening at [`propose.ts:1216-1314`](../../../apps/server/src/methodology/handlers/propose.ts):

- [ ] The L1257-1266 defensive guard rejecting annotation-endpoint existing edges is REMOVED.
- [ ] Phase 1 symmetry expands. The "any present" predicate widens to `source_node_id !== undefined || source_annotation_id !== undefined || target_node_id !== undefined || target_annotation_id !== undefined || role !== undefined`. The "all present" predicate widens to `(source_node_id !== undefined || source_annotation_id !== undefined) && (target_node_id !== undefined || target_annotation_id !== undefined) && role !== undefined`. On any-without-all the rejection (`'illegal-state-transition'`) enumerates which side(s) are short: "missing source-side endpoint", "missing target-side endpoint", or "missing role" (or combinations).
- [ ] Phase 2a (source visibility) — resolves `kind = source_node_id !== undefined ? 'node' : 'annotation'` and `id = source_node_id ?? source_annotation_id` (one is non-undefined per the symmetry phase and the schema's `.refine()`); rejects (`'target-entity-not-found'`) when `entityIsVisible(projection, kind, id)` is false. Detail names `source_node_id` or `source_annotation_id` as appropriate and the session id.
- [ ] Phase 2b (target visibility) — symmetric.
- [ ] Phase 2c (agreement) — compares the carried polymorphic triple against the projected edge's polymorphic triple. The comparison uses the absent slot's nullability: carried `source_node_id` (or `undefined`) vs projected `sourceNodeId` (or `null`); carried `source_annotation_id` (or `undefined`) vs projected `sourceAnnotationId` (or `null`); symmetric for target; role equality. Any disagreement rejects (`'illegal-state-transition'`) with detail naming both polymorphic triples and the contested `edge_id`.
- [ ] The validator's header docblock at L1130-1214 amends to describe the polymorphic Phase 2a/2b/2c shapes and the dropped defensive guard.

`validateCaptureNodeProposal` widening at [`propose.ts:1355-1411`](../../../apps/server/src/methodology/handlers/propose.ts):

- [ ] Rule 3 (source visibility) widens. Resolution: `kind = edge.source_node_id !== undefined ? 'node' : 'annotation'` and `id = edge.source_node_id ?? edge.source_annotation_id`. The self-reference guard (`edge.source_node_id === nodeId`) stays for the node-id case only; the annotation case routes directly through `entityIsVisible(projection, 'annotation', id)`.
- [ ] Rule 3 (target visibility) — symmetric.
- [ ] Rejection messages name `source_node_id` / `source_annotation_id` / `target_node_id` / `target_annotation_id` as appropriate.

Structural-event builder threading:

- [ ] [`propose.ts:1862-1894`](../../../apps/server/src/methodology/handlers/propose.ts) capture-with-edge arm threads `source_node_id`, `source_annotation_id`, `target_node_id`, `target_annotation_id` into the emitted `edge-created` payload (each as `?? undefined`).
- [ ] [`propose.ts:1897-1948`](../../../apps/server/src/methodology/handlers/propose.ts) set-edge-substance connecting-edge arm threads the same four fields. The fresh-edge predicate widens: `(sourceNodeId !== undefined || sourceAnnotationId !== undefined) && (targetNodeId !== undefined || targetAnnotationId !== undefined) && role !== undefined && projection.getEdge(edgeId) === undefined`.
- [ ] The `buildStructuralEventsForPropose` header docblock's `set-edge-substance` paragraph amends to describe the polymorphic shape.

Vitest cover (extending `proposeSetEdgeSubstanceValidation.test.ts`):

- [ ] **Existing 13 cases stay green** (Phase 1 symmetry, Phase 2a/2b/2c per existing rules, happy-path accepts — all on the node-endpoint shape).
- [ ] **New symmetry case** — proposal carries `target_annotation_id` + `role` but no source-side slot. → `Rejected` with `'illegal-state-transition'`, detail names the missing source-side.
- [ ] **New symmetry case** — proposal carries both source-side AND target-side annotation slots but no role. → `Rejected` (existing behavior, repeated for the annotation shape).
- [ ] **New Phase 2a case** — `source_annotation_id` references an unknown annotation id. → `Rejected` with `'target-entity-not-found'`, detail names `source_annotation_id`.
- [ ] **New Phase 2a case** — `source_annotation_id` references an annotation that exists but has been retracted (`visible === false`; seeded via direct `setAnnotationVisible(id, false)` on the test projection). → `Rejected` with `'target-entity-not-found'`.
- [ ] **New Phase 2b case** — `target_annotation_id` references an unknown annotation. → `Rejected` symmetric.
- [ ] **New Phase 2b case** — `target_annotation_id` references an invisible annotation. → `Rejected` symmetric.
- [ ] **New Phase 2c case** — projected edge has annotation source, proposal carries node source. → `Rejected` with `'illegal-state-transition'`, detail names both polymorphic triples.
- [ ] **New Phase 2c case** — projected edge has node target, proposal carries annotation target. → `Rejected` symmetric.
- [ ] **New Phase 2c case** — both projected and carried are annotation endpoints but the annotation ids differ. → `Rejected` symmetric.
- [ ] **New happy-path** — node→annotation connecting case (the E15 shape): `source_node_id` + `target_annotation_id` + `role` against a fresh `edge_id`. → `Valid` with three events (`edge-created` carrying `source_node_id` + `target_annotation_id` + `entity-included` + `proposal`).
- [ ] **New happy-path** — annotation→node connecting case (symmetric).
- [ ] **New happy-path** — annotation→annotation connecting case.
- [ ] **New happy-path** — substance-only re-vote against an extant annotation-endpoint edge (the formerly-rejected case): zero endpoint slots, `edge_id` references an extant edge whose source is an annotation. → `Valid` with one event (`proposal` only). This case is the lifted-guard regression.
- [ ] **New happy-path** — agreement-with-extant case carrying matching polymorphic triple (e.g. carried `target_annotation_id` matches projected `targetAnnotationId`). → `Valid` with one event.

Vitest cover (extending `proposeCaptureNode.test.ts` or sibling):

- [ ] **Existing capture-with-edge cases stay green** (today's `source_node_id` + `target_node_id` shape).
- [ ] **New capture-with-edge case** — `target_annotation_id` references an unknown annotation. → `Rejected` with `'target-entity-not-found'`.
- [ ] **New capture-with-edge case** — `target_annotation_id` references an invisible annotation. → `Rejected`.
- [ ] **New capture-with-edge happy-path** — node→annotation: `source_node_id === nodeId` (self-reference for the freshly-captured node) + `target_annotation_id` references a visible annotation. → `Valid`; the emitted `edge-created` carries `source_node_id` + `target_annotation_id`.
- [ ] **New capture-with-edge happy-path** — annotation→node: `source_annotation_id` + `target_node_id === nodeId`. → `Valid`.

Vitest cover (extending `packages/shared-types/src/events/proposals.test.ts`):

- [ ] **`setEdgeSubstanceProposalSchema`** — round-trip cases for each polymorphic shape (node→annotation, annotation→node, annotation→annotation); rejection cases for both-source-set, both-target-set; bad-UUID rejections for the two new fields; the zero-endpoint substance-only shape continues to parse.
- [ ] **`captureNodeEdgeShapeSchema`** — round-trip cases for each polymorphic shape; rejection cases for both-source-set, both-target-set, neither-source-set, neither-target-set (exactly-one per D4); bad-UUID rejections for the two new fields.

Cucumber cover:

- [ ] [`tests/behavior/ws/propose.feature`](../../../tests/behavior/ws/propose.feature) (or whichever sibling pins propose round-trips through pglite) gets one new scenario: a propose carrying `set-edge-substance` with `source_node_id` + `target_annotation_id` + `role` against a fresh `edge_id`, in a session seeded with the source node and target annotation. The WS handler emits three events; the projection contains an annotation-endpoint edge per `projection_edge_annotation_endpoint`'s round-trip pin in `from-log.feature`.

Existing tests stay green:

- [ ] Every existing Vitest suite passes — including the predecessor's `replay.test.ts` polymorphic-shape cases, the diagnostics' skip cases, the snapshot serializer's polymorphic cases, AND the existing `proposeSetEdgeSubstanceValidation.test.ts` 13 cases.
- [ ] Every existing Cucumber feature passes — `from-log.feature`'s polymorphic round-trip (from `projection_edge_annotation_endpoint`); `walkthrough-replay.feature` (E15 is still the node-target workaround until `walkthrough_e15_annotation_endpoint_refit` lands; THIS task's widening is forward-compatible with both encodings); `propose.feature`'s baseline scenarios.
- [ ] Every existing Playwright suite passes (UI consumers continue to skip annotation-endpoint edges per the unchanged guards from `projection_edge_annotation_endpoint` D3).

Build + scheduler:

- [ ] `pnpm -F @a-conversa/shared-types build` succeeds.
- [ ] `pnpm -F @a-conversa/server build` succeeds.
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green; Vitest baseline rises by ~25 (the polymorphic symmetry / 2a / 2b / 2c cases + happy-paths + capture-with-edge cases + schema XOR cases).
- [ ] `pnpm run test:behavior:smoke` green; Cucumber baseline rises by 1 (the new propose round-trip scenario).
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/10-data-and-methodology.tji` gets `complete 100` on `set_edge_substance_annotation_endpoint`.

Tech-debt registration:

- [ ] **`mod_propose_annotation_endpoint_gestures` (future task — ~2d, UI-stream, moderator).** Wire the moderator's set-edge-substance gesture (the endpoint-carriage picker landed by `mod_set_edge_substance_endpoint_carriage`) AND the capture-with-edge gesture to emit polymorphic-endpoint proposals — once annotations are canvas-renderable per the predecessor's `mod_render_annotation_endpoint_edges`. Depends on `mod_render_annotation_endpoint_edges` (which is itself a follow-up registered by `projection_edge_annotation_endpoint`). Includes Playwright cover (a spec where the moderator targets an annotation when minting an edge). Closer registers under `moderator_ui.mod_graph_rendering.*`. The closer of `mod_render_annotation_endpoint_edges` should consider whether to bundle these gestures into that task or split them out — both are reasonable; this registration names the work so the WBS doesn't lose it.

The other follow-ups in the polymorphic-endpoint chain are already registered: `walkthrough_e15_annotation_endpoint_refit` (unblocked by THIS task + the predecessor `projection_edge_annotation_endpoint` — its closer may begin), `edges_table_polymorphic_endpoint_migration` (independent — dormant until a production write path lands), `mod_render_annotation_endpoint_edges` / `part_render_annotation_endpoint_edges` / `aud_render_annotation_endpoint_edges` (registered by `projection_edge_annotation_endpoint`), `diagnostics_annotation_endpoint_semantics_audit` (registered by `projection_edge_annotation_endpoint`).

## Decisions

- **D1 — Bundle the schema widening + validator widening + capture-node widening + structural-event builder threading in one task; defer UI gestures to the named UI-stream follow-up.** Rationale:
  - **The 0.5d allocation matches a coherent proposal-layer surface.** Splitting the proposal schema from its validator from its structural-event builder would force three round-trips through the compile-error chain: dropping the L1257-1266 guard without widening the validator's Phase 2c triple comparison produces a TypeScript build failure (the `existingEdge.sourceNodeId !== sourceNodeId` comparison reads a `string | null` vs `string | undefined`); landing the schema widening without the validator widening means an annotation-endpoint payload parses but produces wrong outcomes at Phase 2c (defensive guard absence + node-only comparison).
  - **The capture-node widening rides on the same `entityIsVisible` helper.** Splitting it into a separate task would mean introducing the helper twice or shipping a helper without a second consumer (the parent refinement of `entityIsVisible` only matters if more than one validator uses it). Per the YAGNI / coherent-surface principle, bundling capture-node here is the right factoring.
  - **The structural-event builder threading is mechanical and follows the same shape as the validator.** Once the validator accepts the polymorphic triple, the builder must emit the polymorphic payload — they're a matched pair.
  - **UI gestures are a distinct concern.** Per D9 the moderator's endpoint-carriage picker (introduced by `mod_set_edge_substance_endpoint_carriage`) and the capture-with-edge picker don't render annotations as graph nodes today; minting an annotation-endpoint edge from the UI requires the annotation to be a click-target on the canvas — a UI design question handled by `mod_render_annotation_endpoint_edges` (and siblings).
  - **Alternative considered: split into `set_edge_substance_schema_annotation_endpoint` + `set_edge_substance_validator_annotation_endpoint`.** Rejected — the validator and schema are a matched pair; the validator's Phase 2c needs the schema to express the polymorphic shape; splitting forces the validator task to ship a no-op until the schema task lands.
  - **Alternative considered: defer capture-node to a separate `capture_node_annotation_endpoint` task.** Rejected — `captureNodeEdgeShapeSchema` rides on the same wire-shape precedent and uses the same primitive helpers; the work is single-digit minutes once the rest is in place; splitting it just creates orchestrator overhead.

- **D2 — Introduce `entityIsVisible(projection, kind, id)` as a polymorphic dispatcher over the three entity-kind helpers; the `'edge'` arm is added for symmetry even though no validator uses it in v1.** Rationale:
  - **Sibling-helper precedent.** `nodeIsVisible` / `edgeIsVisible` are flat boolean predicates over a single kind. Generalizing them through one dispatcher is the natural extension: callers that statically know the kind continue to call the per-kind helper; callers that route on kind (the new polymorphic validators) call the dispatcher.
  - **The `'edge'` arm is free.** Adding it costs one switch arm and zero runtime overhead; omitting it would leave a gap in the dispatcher's surface that a future polymorphic call site would need to plug. The cost of asymmetry is paid every time a reader has to ask "why doesn't this dispatcher cover edges?"
  - **Future `meta_move_logic` migration is left open.** The `edgeIsVisible` call in `meta_move_logic`'s rule 2 could migrate to `entityIsVisible(projection, 'edge', id)` for consistency, but the meta-move validator is established; touching it here would expand scope without value. The migration registers no follow-up — it's a cosmetic refactor a future reader can do opportunistically.
  - **Alternative considered: ad-hoc per-call `if kind === 'node' then ... else ...`.** Rejected — leaks the dispatch logic into every consumer (today: two validators; tomorrow: any propose validator that addresses polymorphic-endpoint entities). The helper centralizes the dispatch in one place; the test cover lives there too.
  - **Alternative considered: inline the dispatcher inside each validator (no helper at all).** Rejected — duplicates the dispatch logic across two validators (`validateSetEdgeSubstanceProposal` + `validateCaptureNodeProposal`); any future polymorphic-endpoint validator would duplicate it again.
  - **Alternative considered: name the dispatcher `isEntityVisible` (verb-leading).** Rejected — the sibling helpers (`nodeIsVisible`, `edgeIsVisible`) use noun-leading "isVisible" form; the polymorphic dispatcher follows the same naming.

- **D3 — Four explicit fields (`source_node_id`, `source_annotation_id`, `target_node_id`, `target_annotation_id`) on the proposal schemas, NOT a `source_kind`/`source_id` discriminator pair.** Rationale:
  - **Mirrors the wire `edge-created` precedent.** The predecessor `edge_target_annotation_schema_extension` D3 settled this choice for the entity-layer payload; replaying it for the proposal-layer payload keeps the polymorphic-target encoding consistent across the codebase.
  - **The structural-event builder maps fields one-for-one.** With four explicit fields on the proposal and four explicit fields on the emitted `edge-created` payload, the builder's threading is a trivial `payload: { ..., source_node_id, source_annotation_id, target_node_id, target_annotation_id }`. A discriminator-plus-opaque-id shape would require unpacking at the builder seam.
  - **Read-side ergonomics.** The validator's Phase 2a/2b checks `payload.source_annotation_id !== undefined` directly — a field-presence check — rather than `payload.source_kind === 'annotation'` followed by an unsafe assumption about `payload.source_id`'s referent.
  - **Alternative considered: discriminator pair (`source_kind: 'node' | 'annotation'` + `source_id: UUID`).** Rejected for the three reasons above; also fails to mirror the wire-layer precedent.

- **D4 — `setEdgeSubstanceProposalSchema`'s per-endpoint `.refine()` is at-most-one (zero-or-one); `captureNodeEdgeShapeSchema`'s is exactly-one. Cross-side symmetry runs at the validator layer, NOT in the schema.** Rationale:
  - **`set-edge-substance` has TWO use-cases.** The connecting-edge case carries a fully-specified endpoint pair + role; the substance-only re-vote case carries zero endpoint fields. The schema's `.refine()` must permit both. At-most-one per endpoint accommodates the substance-only shape (both source slots absent) AND rejects malformed payloads (both source slots set).
  - **`captureNodeEdgeShape` has ONE use-case.** Capture-with-edge always carries fully-specified endpoints — there is no "substance-only" capture (the edge IS the capture). Exactly-one is the tighter schema rule.
  - **Cross-side symmetry is a validator-layer check.** The schema's `.refine()` operates per endpoint slot — it can express "exactly one of source_node_id / source_annotation_id" but cannot easily express "all-or-nothing across source / target / role" without nesting `.refine()` blocks. The validator's Phase 1 carries the cross-side check today; widening it to the polymorphic case keeps the rule in one place where the error message can name every short side legibly.
  - **Alternative considered: schema enforces exactly-one per endpoint for `setEdgeSubstanceProposalSchema` (so substance-only re-vote becomes a separate sub-kind).** Rejected — splits one wire shape into two for a discrimination that exists today as a payload-shape predicate. The predecessor `mod_set_edge_substance_endpoint_carriage` D2 explicitly chose the single-sub-kind / optional-endpoints encoding; replaying that choice here is the right move.
  - **Alternative considered: schema enforces cross-side symmetry via a top-level `.superRefine()`.** Rejected — duplicates the rule across the schema AND validator layers (the validator would still need to check it for legibility in error messages); a single-source-of-truth at the validator layer is cleaner.

- **D5 — Fresh-edge predicate in the structural-event builder widens to be polymorphic-aware: "source-side defined AND target-side defined AND role defined AND `getEdge === undefined`".** Rationale:
  - **Required by D1's bundling decision.** Once the validator accepts polymorphic-endpoint proposals, the builder must emit polymorphic `edge-created` events; the predicate that gates the emission must recognize the polymorphic-form symmetry.
  - **The widening is straightforward.** Today's predicate reads `source_node_id !== undefined && target_node_id !== undefined && role !== undefined`; the polymorphic version reads `(source_node_id !== undefined || source_annotation_id !== undefined) && (target_node_id !== undefined || target_annotation_id !== undefined) && role !== undefined`. The validator's Phase 1 has already enforced the all-or-nothing rule, so any payload reaching the builder either has every required slot or has none.
  - **The emitted `edge-created` payload uses `?? undefined` for absent slots.** The wire `edgeCreatedPayloadSchema`'s per-endpoint `.refine()` exactly-one matches the proposal's at-most-one when extended through the connecting case (because the validator's Phase 1 has elevated at-most-one to exactly-one for the connecting shape). No additional coercion is needed.
  - **Alternative considered: keep the predicate node-only and ship a separate `edge-created-annotation` event kind.** Rejected — the predecessor `edge_target_annotation_schema_extension` D1 already settled the polymorphic-shape choice at the wire layer (one event kind, four endpoint fields). Replaying the choice at the propose layer keeps the polymorphic-target pattern consistent.

- **D6 — Reuse existing `RejectionReason` codes (`'target-entity-not-found'` for missing / invisible endpoints; `'illegal-state-transition'` for symmetry and agreement violations); do NOT mint a `'target-annotation-not-found'` or similar.** Rationale:
  - **Sibling precedent.** `set_edge_substance_endpoint_validation` D2 explicitly chose to reuse existing codes for the node-endpoint case ("the `detail` string carries the kind-specific specificity"). Adding an annotation-specific code for the polymorphic case would split the validator's rejection surface across two codes for one rule's two endpoint kinds — readers and clients would have to learn the discrimination.
  - **The detail string is the right place for kind specificity.** The detail explicitly names `source_annotation_id` vs `source_node_id` and includes the annotation id; any client-side error-rendering layer that wants to distinguish the cases can parse the detail (today's clients don't, but the precedent for parsing-when-needed is well-established by the other sibling validators).
  - **No new union member is the right default.** Adding `'target-annotation-not-found'` or `'endpoint-payload-asymmetric'` adds switch-arms to every consumer that handles `RejectionReason`; the YAGNI principle applies until a concrete consumer drives the need.
  - **Alternative considered: mint `'target-annotation-not-found'` for the annotation-not-found case.** Rejected per the sibling precedent and the YAGNI principle.

- **D7 — Capture-node's self-reference guard (`edge.source_node_id === nodeId`) stays for the node-id case only; annotation endpoints in capture-with-edge must reference EXISTING visible annotations.** Rationale:
  - **The capture-node sub-kind mints a NODE, not an annotation.** The self-reference guard exists because the connecting capture's common case is "capture a fresh node AND connect it to an existing node with an edge" — the source or target of the edge is the just-captured node. Annotations cannot be the just-captured entity; the capture-node sub-kind has no facility for minting an annotation alongside the node.
  - **An annotation endpoint must be an existing visible annotation.** The existence is checked via `entityIsVisible(projection, 'annotation', id)`. No special self-reference path applies.
  - **Future "capture-with-annotation" sub-kind is hypothetical.** No refinement currently scopes a sub-kind that mints an annotation; if one lands, it can introduce its own self-reference path. Today's capture-node + annotation-endpoint shape is "capture a node + connect it to an existing annotation," which is the right semantic.
  - **Alternative considered: allow an annotation-id self-reference path (a "capture-an-annotation" extension).** Rejected — out of scope; would expand the capture-node sub-kind beyond its current contract; no methodology requirement drives it.

- **D8 — Cucumber gets ONE new scenario covering the propose-emits-`edge-created` round-trip; Vitest carries the rest.** Rationale:
  - **The WS-handler-to-projection seam is what Cucumber pins** (ADR 0007 + the established `propose.feature` / `from-log.feature` shape). The validator's per-rule rejections are unit-level; the propose-time emission of the polymorphic-endpoint `edge-created` event and its arrival at the projection is the integration surface Cucumber covers.
  - **Vitest covers the per-rule unit shapes** (each Phase 1 / 2a / 2b / 2c case, the schema XOR, the capture-node arm).
  - **Alternative considered: a Cucumber scenario per rule.** Rejected — duplicates Vitest at a heavier layer; the rule-by-rule rejection paths are unit-level by construction.
  - **Alternative considered: no Cucumber.** Rejected — the propose-time emission DOES cross the wire / projection boundary (the emitted `edge-created` is a real envelope event the projection consumes); per the refinement-writer's "wire-shape / projector-output observable at the system seam" guidance, a Cucumber pin is the right level.

- **D9 — UI gestures (moderator endpoint-carriage picker minting annotation-endpoint edges; moderator capture-with-edge picker) stay out of scope; register as a single consolidated UI-stream follow-up `mod_propose_annotation_endpoint_gestures`.** Rationale:
  - **The moderator's set-edge-substance picker today (per `mod_set_edge_substance_endpoint_carriage`) clicks on rendered canvas nodes to pick endpoints.** Annotations are not currently rendered as canvas nodes (they're per-statement attachments per the predecessor `projection_edge_annotation_endpoint` D3). Wiring the picker to pick annotations requires annotations to be click-targets on the canvas — the `mod_render_annotation_endpoint_edges` follow-up's design surface.
  - **Bundling propose gestures into the rendering task is reasonable; bundling them into THIS task is not.** The propose gesture work depends on canvas-renderable annotations; THIS task's deliverable (proposal-schema + validator + structural-event builder) does NOT depend on rendering. Separating the two keeps each task's surface coherent.
  - **One consolidated UI follow-up rather than two (separate set-edge-substance and capture-with-edge tasks).** Both gestures share the canvas-picker pattern; bundling them gives the implementer the design-question-once benefit. The closer can split if the design surfaces differ enough.
  - **Alternative considered: register three separate UI follow-ups (moderator picker, participant picker — no participant capture-with-edge today — audience read-only — N/A).** Rejected — participant has no propose gestures for these sub-kinds; audience is read-only. Only the moderator needs the gesture work.

## Open questions

(none — all decided in D1–D9.)

## Status

**Done** — 2026-05-30.

- Widened `setEdgeSubstanceProposalSchema` (at-most-one per-endpoint `.refine()`) and `captureNodeEdgeShapeSchema` (exactly-one per endpoint) to four polymorphic slots — `packages/shared-types/src/events/proposals.ts`.
- Added `annotationIsVisible` + `entityIsVisible(kind, id)` dispatcher mirroring the node/edge visibility pattern — `apps/server/src/methodology/primitives.ts`.
- Rewrote `validateSetEdgeSubstanceProposal` polymorphically: Phase 1 cross-side symmetry over four slots; Phase 2a/2b via `entityIsVisible`; Phase 2c polymorphic-triple comparison; dropped the predecessor defensive guard at L1257-1266 — `apps/server/src/methodology/handlers/propose.ts`.
- Widened `validateCaptureNodeProposal` rule 3 per-slot via `entityIsVisible`; self-reference guard kept for the node-id case only — `apps/server/src/methodology/handlers/propose.ts`.
- Threaded all four polymorphic endpoint fields through both structural-event builder arms (capture-with-edge + set-edge-substance connecting-edge) — `apps/server/src/methodology/handlers/propose.ts`.
- Widened `entitiesToRetractForWithdraw` set-edge-substance arm to polymorphic per-side-presence predicate — `apps/server/src/ws/handlers/withdraw.ts`.
- Extended unit tests with ~25 new cases across schema XOR, validator polymorphic cover (2a/2b/2c + symmetry + happy-paths), and capture-with-annotation-endpoint cover — `packages/shared-types/src/events/proposals.test.ts`, `apps/server/src/methodology/handlers/proposeSetEdgeSubstanceValidation.test.ts`, `apps/server/src/methodology/handlers/proposeCaptureNode.test.ts`.
- Added 1 new Cucumber scenario pinning the propose-emits-`edge-created` round-trip for a `source_node_id` + `target_annotation_id` shape — `tests/behavior/methodology/propose-set-edge-substance.feature`, `tests/behavior/steps/methodology-propose-set-edge-substance.steps.ts`.
