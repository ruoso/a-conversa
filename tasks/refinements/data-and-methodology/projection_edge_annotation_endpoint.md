# Extend `ProjectedEdge` and `handleEdgeCreated` for annotation endpoints

**TaskJuggler entry**: `data_and_methodology.projection.projection_edge_annotation_endpoint` — [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) (block at lines 223-235). Embedded note: *"Source of debt: edge_target_annotation_schema_extension — widens ProjectedEdge and EdgeShape to carry polymorphic endpoints (four-field shape mirroring wire payload), updates replay.ts handleEdgeCreated and Projection.addEdge, lifts the ReplayError guard introduced in edge_target_annotation_schema_extension. Audits diagnostics (active_firing_computation, cycle_detection, dangling_claim_detection, coherency_hint_detection, multi_warrant_detection) for correct annotation-endpoint semantics. Unblocks walkthrough_e15_annotation_endpoint_refit."*

## Effort estimate

**1d** (per the `.tji` allocation). The work spans:

- **Type widening (~2h).** `EdgeShape`, `ProjectedEdge`, `NewEdgeInput`, and `EdgeAddedChange` in [`apps/server/src/projection/types.ts:222-238, 260-267, 381-387`](../../../apps/server/src/projection/types.ts) each gain polymorphic endpoint fields. Per D2, the in-memory shape mirrors the [`ProjectedAnnotation`](../../../apps/server/src/projection/types.ts) precedent (L240-251): `sourceNodeId: string | null` + `sourceAnnotationId: string | null` + symmetric target fields, with an XOR invariant per endpoint.
- **Projector + index plumbing (~2h).** [`apps/server/src/projection/projection.ts:71-94`](../../../apps/server/src/projection/projection.ts) `buildEdge` constructs the widened `EdgeShape` from the widened `NewEdgeInput`. [`apps/server/src/projection/projection.ts:227-251`](../../../apps/server/src/projection/projection.ts) `addEdge` / `removeEdge` keep the `#edgesBySource` / `#edgesByTarget` index pointing at whichever endpoint is set (node id OR annotation id — same string-keyed Map, mixed keys), mirroring how `addAnnotation` (L253-265) routes to `#annotationsByNode` vs. `#annotationsByEdge` by which target slot is non-null.
- **Replay guard lift (~1h).** [`apps/server/src/projection/replay.ts:202-236`](../../../apps/server/src/projection/replay.ts) `handleEdgeCreated` drops the `ReplayError` guard at L213-217 (added by predecessor) and instead passes the polymorphic endpoint fields through to `addEdge` and into the `EdgeAddedChange` payload.
- **Snapshot serializer (~0.5h).** [`apps/server/src/ws/handlers/snapshot.ts:315-324`](../../../apps/server/src/ws/handlers/snapshot.ts) edges-map projection serializes the new fields onto the wire snapshot. Per D5 the WS snapshot wrapper (`snapshotStatePayloadSchema` at [`packages/shared-types/src/ws-envelope.ts:872-876`](../../../packages/shared-types/src/ws-envelope.ts)) treats `projection` as `z.unknown()`, so no Zod schema update is required — only the serializer.
- **Diagnostics audit (~2h).** Per D4 each diagnostic gets a "skip if not a node-to-node edge" guard added at the point it reads `edge.sourceNodeId` / `edge.targetNodeId`. The five diagnostics + `pending-consequences` + `methodology/primitives.ts incidentEdgesForNode` each get one guard line plus a clarifying comment. Vitest deltas pin the skip behaviour.
- **Methodology-engine compile fix (~0.5h).** [`apps/server/src/methodology/handlers/propose.ts:1278-1285`](../../../apps/server/src/methodology/handlers/propose.ts) `set-edge-substance` validator's endpoint-triple comparison reads `existingEdge.sourceNodeId` / `existingEdge.targetNodeId` directly. The widening forces a TypeScript fix at this site: until `set_edge_substance_annotation_endpoint` lands, the comparison must be guarded — the validator already requires `existingEdge` resolved by `edge_id` with no proposal carrying annotation endpoints yet, so a defensive guard ("if the existing edge has annotation endpoints, reject — this proposal kind doesn't carry annotation endpoints yet") plus a breadcrumb to the follow-up is the right shape per D6.
- **Vitest cover (~1h).** [`apps/server/src/projection/replay.test.ts:308-332`](../../../apps/server/src/projection/replay.test.ts) flips the existing ReplayError regression test to a pass case (three polymorphic shapes). Additional cases pin the projection's index state (`getEdgesBySource(annotationId)` returns the edge), the snapshot serializer output, and each diagnostic's skip behaviour.
- **Cucumber cover (~1h).** Per D8, a new scenario in [`tests/behavior/projection/from-log.feature`](../../../tests/behavior/projection/from-log.feature) replays an event log carrying an annotation-endpoint `edge-created` and asserts the resulting projection's edge endpoints. This is the round-trip-through-JSONB pin per ADR 0021.

No new ADR. No DB migration (per D7 — deferred). No UI consumer change (per D3 — deferred to UI-stream follow-ups).

## Inherited dependencies

**Settled:**

- [`data_and_methodology.event_types.edge_target_annotation_schema_extension`](./edge_target_annotation_schema_extension.md) (done — 2026-05-30). The wire-schema widening: `edgeCreatedPayloadSchema` at [`packages/shared-types/src/events.ts:309-330`](../../../packages/shared-types/src/events.ts) carries four `.optional()` endpoint id fields with two `.refine()` XOR blocks. The predecessor's Status block at L210-216 explicitly registers THIS task as the projection-layer follow-up that lifts its `handleEdgeCreated` guard, audits diagnostics, and unblocks `walkthrough_e15_annotation_endpoint_refit`.
- [`data_and_methodology.projection.projection_data_structure`](./projection_data_structure.md) (done — `complete 100`). Defines [`Projection`](../../../apps/server/src/projection/projection.ts) class shape: `#edgesBySource` / `#edgesByTarget` indices keyed by node id, `addEdge` / `removeEdge` mutators, `getEdgesBySource` / `getEdgesByTarget` getters. The widening reuses the same Map<string, Set<string>> index — keys become "node id OR annotation id" but the index API doesn't change.
- [`data_and_methodology.projection.project_from_log`](./project_from_log.md) and [`data_and_methodology.projection.project_incrementally`](./project_incrementally.md) (both done). Define the `applyEvent` → `ProjectionChange[]` shape that `handleEdgeCreated` participates in. The `EdgeAddedChange` discriminant widens; `applyEvent`'s outer dispatcher does not.
- [`data_and_methodology.projection.active_firing_computation`](./active_firing_computation.md) (done). [`apps/server/src/projection/active-firing.ts:124-156`](../../../apps/server/src/projection/active-firing.ts) `isEdgeActive` reads `edge.sourceNodeId` directly. Per D4 this site gets a defensive guard for annotation-source edges (active-firing is a node-substance computation; an annotation can't carry substance).
- [`data_and_methodology.diagnostics.cycle_detection`](./cycle_detection.md), [`data_and_methodology.diagnostics.dangling_claim_detection`](./dangling_claim_detection.md), [`data_and_methodology.diagnostics.coherency_hint_detection`](./coherency_hint_detection.md), [`data_and_methodology.diagnostics.multi_warrant_detection`](./multi_warrant_detection.md), [`data_and_methodology.diagnostics.pending_consequences_stub`](./pending_consequences_stub.md) (all done). Each currently walks node-substance graphs only; per D4 each gets an endpoint-kind guard at the edge-iteration site.
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md). The widened payload's already validated at the JSONB → typed-`Event` boundary by `validateEvent`; this task widens the post-validation handler.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case + a Cucumber scenario.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md). The widening is an entity-layer concern: edges (entities) now reference annotations (entities) as endpoints. Facet-layer machinery (`shapeFacet`, `substanceFacet`, `deriveFacetStatus`) is untouched per D2.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md). The shape facet's inline-candidate carriage continues to be the `EdgeShape` value — now the widened shape. No facet-keying change.
- The annotation-target polymorphic-FK precedent — [`apps/server/src/projection/types.ts:240-251`](../../../apps/server/src/projection/types.ts) `ProjectedAnnotation` (target field pair: `targetNodeId: string | null` + `targetEdgeId: string | null`) and [`apps/server/src/projection/projection.ts:96-117`](../../../apps/server/src/projection/projection.ts) `buildAnnotation` (XOR invariant at L97-101). Per D2 this task mirrors the pattern: `string | null` per endpoint field + an XOR check per endpoint in `buildEdge`.

**Pending:** (none — every load-bearing input is settled on `main`.)

## What this task is

Widen the projection layer's edge type, projector, indices, snapshot serializer, and diagnostics so that an edge can carry polymorphic endpoints (a node id OR an annotation id) for each of its source and target — matching the wire payload the predecessor task already widened. Today's `ProjectedEdge` carries `sourceNodeId: string` + `targetNodeId: string`; tomorrow's carries `sourceNodeId: string | null` + `sourceAnnotationId: string | null` + symmetric target fields, with an XOR invariant per endpoint mirroring the established `ProjectedAnnotation` pattern.

Concretely the deliverable is:

1. **Widened in-memory types** — [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts).
   - `EdgeShape` (L222-226): four fields per endpoint pair (`sourceNodeId`/`sourceAnnotationId`, `targetNodeId`/`targetAnnotationId`), each `string | null`.
   - `ProjectedEdge` (L228-238): mirrors the widened `EdgeShape`.
   - `NewEdgeInput` (L260-267): mirrors the wire payload's polymorphic endpoint shape.
   - `EdgeAddedChange` (L381-387): adds `sourceAnnotationId: string | null` + `targetAnnotationId: string | null`; existing fields demote to `string | null`.

2. **Widened projector** — [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts).
   - `buildEdge` (L71-94): constructs the widened `EdgeShape`; XOR invariant per endpoint (throws `ProjectionInvariantError` if both or neither slot is set), mirroring `buildAnnotation`'s precedent at L97-101.
   - `addEdge` / `removeEdge` (L227-251): the `#edgesBySource` / `#edgesByTarget` indices store whichever endpoint id is non-null (node id OR annotation id — same Map<string, Set<string>> shape, the key just happens to be either kind). This keeps `getEdgesBySource(nodeId)` and `getEdgesBySource(annotationId)` both working uniformly.

3. **Replay guard lift** — [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) `handleEdgeCreated` (L202-236). Drops the L213-217 `ReplayError` guard. Threads the polymorphic endpoint fields from the validated `EdgeCreatedPayload` into `addEdge` and into the `EdgeAddedChange` payload. The Zod schema's XOR `.refine()` blocks already guarantee exactly one slot per endpoint is set, so the projector reads them as `payload.source_node_id ?? null` / `payload.source_annotation_id ?? null` (no per-handler XOR re-check — the schema's `.refine()` is authoritative).

4. **Snapshot serializer widening** — [`apps/server/src/ws/handlers/snapshot.ts:315-324`](../../../apps/server/src/ws/handlers/snapshot.ts). Adds `sourceAnnotationId` / `targetAnnotationId` to the per-edge serialized shape; existing `sourceNodeId` / `targetNodeId` become nullable in the output JSON.

5. **Diagnostics audit + endpoint-kind guards.** Per D4, each diagnostic that reads `edge.sourceNodeId` or `edge.targetNodeId` to do a node-substance graph walk gets a one-line guard at the edge-iteration site: `if (edge.sourceNodeId === null || edge.targetNodeId === null) continue;` with a clarifying comment that the diagnostic operates on the node-substance subgraph and annotation-endpoint edges aren't part of that subgraph. The affected sites are:
   - [`apps/server/src/projection/active-firing.ts:124-156`](../../../apps/server/src/projection/active-firing.ts) `isEdgeActive` — guard at L129 before `projection.getNode(edge.sourceNodeId)`. Active-firing requires source-node substance; an annotation source has no substance facet.
   - [`apps/server/src/diagnostics/cycle-detection.ts:110-134`](../../../apps/server/src/diagnostics/cycle-detection.ts) `buildSupportsAdjacency` — guard at L121 before reading source/target. Cycles are over the node-supports subgraph.
   - [`apps/server/src/diagnostics/dangling-claim-detection.ts:120-152`](../../../apps/server/src/diagnostics/dangling-claim-detection.ts) `detectDanglingClaims` — the outer iteration walks nodes via `getEdgesByTarget(node.id)`, so annotation-target edges aren't in the result by construction. Guard added defensively at L135 before `getNode(edge.sourceNodeId)` (an annotation-source edge incident on a node target is technically possible — it's filtered for clarity).
   - [`apps/server/src/diagnostics/coherency-hint-detection.ts:179, 221, 257`](../../../apps/server/src/diagnostics/coherency-hint-detection.ts) `detectIncompleteWarrantsMissingBridges*` and `detectSelfContradicts` — guards at each site. Warrants and self-contradicts are node-node constructs.
   - [`apps/server/src/diagnostics/multi-warrant-detection.ts:99, 116`](../../../apps/server/src/diagnostics/multi-warrant-detection.ts) `detectMultiWarrants` — guards at the bridge-from and bridge-to edge-read sites. Warrants are nodes.
   - [`apps/server/src/diagnostics/pending-consequences.ts:135-158`](../../../apps/server/src/diagnostics/pending-consequences.ts) `detectPendingConsequences` — guard at L135 before `getNode(edge.sourceNodeId)`. Pending-consequences walks substance from source nodes.
   - [`apps/server/src/methodology/primitives.ts:541`](../../../apps/server/src/methodology/primitives.ts) `incidentEdgesForNode` — already conditioned on `edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId`; with the widening, null endpoints simply don't match `nodeId` (uuid strings ≠ null) so no behavioural change is required. The helper continues to function correctly under the widened types because `string !== null` is always true.

6. **Methodology-engine compile fix** — [`apps/server/src/methodology/handlers/propose.ts:1278-1285`](../../../apps/server/src/methodology/handlers/propose.ts) `validateSetEdgeSubstanceProposal`'s endpoint-triple comparison. Per D6, until `set_edge_substance_annotation_endpoint` widens the proposal-side, the validator rejects any existing edge with annotation endpoints with a `validation-failed` error message naming the follow-up; this is the smallest change that keeps the build green and the validator honest.

7. **Vitest cover** — `replay.test.ts`, `projection.test.ts`, `active-firing.test.ts`, each diagnostic's test file, `snapshot.test.ts`, `propose.test.ts` get deltas (enumerated under Acceptance criteria).

8. **Cucumber cover** — `from-log.feature` gets a new scenario per D8.

Out of scope (each registered as a named follow-up): the moderator/participant/audience graph rendering of annotation-endpoint edges (D3), the proposal-side `set-edge-substance` widening (D6 — predecessor already named `set_edge_substance_annotation_endpoint`), the DB migration (D7 — predecessor already named `edges_table_polymorphic_endpoint_migration`), the walkthrough fixture E15 refit (unblocked by this task — predecessor already named `walkthrough_e15_annotation_endpoint_refit`).

## Why it needs to be done

**The schema is widened but the projection still rejects.** The predecessor `edge_target_annotation_schema_extension` widened `edgeCreatedPayloadSchema` but added a defensive `ReplayError` guard at `handleEdgeCreated` (D5 in that refinement) so the build wouldn't break. The guard is debt — every annotation-endpoint edge that flows through the system today (and any future event log carrying one) gets rejected at the projection seam. This task pays the debt by widening the projection layer so the schema and projector agree on the polymorphic-endpoint shape.

**The walkthrough fixture E15 refit is blocked on this task.** The predecessor refinement names `walkthrough_e15_annotation_endpoint_refit` as a follow-up sequenced after this task — because the refitted fixture would crash `handleEdgeCreated`'s guard if landed first. Until this task lands, the canonical walkthrough cannot encode its canonical narrative faithfully (E15: N19 contradicts A2 is encoded as N19→contradicts→N6, the node A2 annotates).

**The diagnostics need explicit semantics for annotation endpoints.** Each diagnostic currently assumes edges are node↔node. If an annotation-endpoint edge sneaks through (post-this-task, until the diagnostics are audited), the diagnostics' `getNode(edge.sourceNodeId)` returns `undefined` and the downstream `?.visible` chain produces silently-wrong results. Per D4 the conservative default is "diagnostics that walk the node-substance subgraph skip annotation-endpoint edges" — making the skip explicit rather than implicit closes the silent-corruption gap that would otherwise exist between the projection's widening and the diagnostics' widening.

**The downstream consumers (DB, methodology, UI) each become possible after this task.** The proposal-side `set_edge_substance_annotation_endpoint` validator needs the projection to carry annotation-endpoint edges so its endpoint-triple check has something to compare against. The DB migration `edges_table_polymorphic_endpoint_migration` writes rows whose shape mirrors the in-memory `ProjectedEdge`. The UI-stream rendering tasks read the widened `ProjectedEdge` off the WS snapshot. Each chains off this task's deliverable.

## Inputs / context

**Design contract:**

- [`docs/example-walkthrough.md`](../../../docs/example-walkthrough.md) — turn 21 names E15 (N19 contradicts A2). The narrative this widening enables encoding faithfully.
- [`docs/data-model.md`](../../../docs/data-model.md) L114-122 — the edge-role vocabulary. Unchanged: the seven roles are independent of endpoint kind.
- [`docs/data-model.md`](../../../docs/data-model.md) L211-213 — confirms the event-log encoding is authoritative; the projection is its faithful in-memory shadow.

**Architectural / engineering inputs:**

- [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the JSONB → typed-`Event` boundary. Once the payload schema accepts annotation endpoints, the projector seam is the next gate.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every check ships as committed Vitest + Cucumber cover.
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the widening is entity-layer only; facets unchanged.
- [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — shape facet's inline-candidate carriage continues to carry the widened `EdgeShape`. No keying change.

**Runtime inputs (real file references the implementer reads + edits):**

- [`apps/server/src/projection/types.ts:222-226`](../../../apps/server/src/projection/types.ts) — `EdgeShape`. Widens to four fields per endpoint pair (null-on-the-other-slot).
- [`apps/server/src/projection/types.ts:228-238`](../../../apps/server/src/projection/types.ts) — `ProjectedEdge`. Mirrors widened `EdgeShape`.
- [`apps/server/src/projection/types.ts:240-251`](../../../apps/server/src/projection/types.ts) — `ProjectedAnnotation`. **The in-memory polymorphic-target precedent this task mirrors** (`targetNodeId: string | null` + `targetEdgeId: string | null`).
- [`apps/server/src/projection/types.ts:260-267`](../../../apps/server/src/projection/types.ts) — `NewEdgeInput`. Mirrors widened payload shape.
- [`apps/server/src/projection/types.ts:269-277`](../../../apps/server/src/projection/types.ts) — `NewAnnotationInput`. **Precedent** for `NewEdgeInput`'s polymorphic input shape.
- [`apps/server/src/projection/types.ts:381-387`](../../../apps/server/src/projection/types.ts) — `EdgeAddedChange`. Widens to mirror `ProjectedEdge`. Per D9 consumers of `EdgeAddedChange` are exhaustively `incremental.test.ts:281` and the snapshot serializer indirectly via `applyEvent`'s return; no downstream consumer reads the change discriminant for routing.
- [`apps/server/src/projection/projection.ts:71-94`](../../../apps/server/src/projection/projection.ts) — `buildEdge`. Adds XOR invariant per endpoint pair, mirroring `buildAnnotation` at L96-118.
- [`apps/server/src/projection/projection.ts:96-118`](../../../apps/server/src/projection/projection.ts) — `buildAnnotation`. **The XOR-invariant precedent** for `buildEdge`.
- [`apps/server/src/projection/projection.ts:227-251`](../../../apps/server/src/projection/projection.ts) — `addEdge` / `removeEdge`. Per D2 the index mutation reads `edge.sourceNodeId ?? edge.sourceAnnotationId` (whichever is non-null) as the index key. Symmetric for target. Same pattern as `addAnnotation` at L253-265.
- [`apps/server/src/projection/replay.ts:202-236`](../../../apps/server/src/projection/replay.ts) — `handleEdgeCreated`. Drops the L213-217 `ReplayError` guard. Threads four optional payload fields into `addEdge` (using `?? null` to convert `undefined` → `null` per D2) and `EdgeAddedChange`.
- [`apps/server/src/projection/replay.test.ts:308-332`](../../../apps/server/src/projection/replay.test.ts) — `'edge-created with an annotation-endpoint payload throws ReplayError ...'`. **Flipped** to a pass case per Acceptance criteria.
- [`apps/server/src/ws/handlers/snapshot.ts:315-324`](../../../apps/server/src/ws/handlers/snapshot.ts) — edges-map projection in the WS snapshot serializer. Adds the two new fields.
- [`apps/server/src/projection/active-firing.ts:124-156`](../../../apps/server/src/projection/active-firing.ts) — `isEdgeActive`. Gets a null-endpoint guard.
- [`apps/server/src/diagnostics/cycle-detection.ts:110-134`](../../../apps/server/src/diagnostics/cycle-detection.ts) — `buildSupportsAdjacency`. Gets a null-endpoint guard.
- [`apps/server/src/diagnostics/dangling-claim-detection.ts:120-152`](../../../apps/server/src/diagnostics/dangling-claim-detection.ts) — `detectDanglingClaims`. Gets a null-endpoint guard (defensive).
- [`apps/server/src/diagnostics/coherency-hint-detection.ts:162-268`](../../../apps/server/src/diagnostics/coherency-hint-detection.ts) — three call sites get null-endpoint guards.
- [`apps/server/src/diagnostics/multi-warrant-detection.ts:86-154`](../../../apps/server/src/diagnostics/multi-warrant-detection.ts) — two call sites get null-endpoint guards.
- [`apps/server/src/diagnostics/pending-consequences.ts:135-158`](../../../apps/server/src/diagnostics/pending-consequences.ts) — null-endpoint guard.
- [`apps/server/src/methodology/handlers/propose.ts:1278-1285`](../../../apps/server/src/methodology/handlers/propose.ts) — `validateSetEdgeSubstanceProposal` endpoint-triple comparison. Per D6 a defensive guard rejects annotation-endpoint existing-edges with a follow-up breadcrumb.
- [`apps/server/src/methodology/primitives.ts:541`](../../../apps/server/src/methodology/primitives.ts) — `incidentEdgesForNode`. Continues to work correctly under widened types (D4).
- [`tests/behavior/projection/from-log.feature`](../../../tests/behavior/projection/from-log.feature) — gets one new scenario per D8.
- [`apps/moderator/src/graph/selectors.ts:365-374`](../../../apps/moderator/src/graph/selectors.ts), [`apps/participant/src/graph/projectGraph.ts:503-516`](../../../apps/participant/src/graph/projectGraph.ts), [`apps/audience/src/graph/projectGraph.ts:308-321`](../../../apps/audience/src/graph/projectGraph.ts) — **the three UI-stream consumer narrowings added by the predecessor**. Per D3 these stay (they currently `continue` on annotation-endpoint payloads, skipping the edge from the canvas). The comment text is updated to reference the new follow-up tasks; the runtime behaviour is unchanged. UI rendering of annotation-endpoint edges is a separate concern that needs annotations to be canvas-renderable as ReactFlow/Cytoscape nodes — a UI-stream design question, not a projection-layer change.

## Constraints / requirements

- **Projection-layer scope.** Per D3, this task widens the projection layer (types, replay, projector indices, snapshot serializer, diagnostics) + the minimum methodology-engine change to keep the build green (D6). UI rendering of annotation-endpoint edges stays out of scope and is registered as named follow-ups per UI stream.
- **In-memory shape mirrors `ProjectedAnnotation`'s polymorphic-target precedent.** Per D2 the fields are `sourceNodeId: string | null` + `sourceAnnotationId: string | null` (and symmetric target pair). NOT optional-`undefined`; NOT discriminator-plus-opaque-id. The in-memory shape uses `| null` because the wire schema uses `.optional()` (`undefined`) and the in-memory shape uses `| null` to match the `ProjectedAnnotation` precedent. The `?? null` coercion at the `handleEdgeCreated` seam is where the conversion lives.
- **XOR invariant per endpoint, enforced in `buildEdge`.** Mirrors `buildAnnotation`'s L97-101 precedent. Throws `ProjectionInvariantError` with a per-endpoint message if the invariant is violated. The wire schema's `.refine()` already prevents this at validation time, so the projector's check is defense-in-depth (and the only path that catches a bad direct-`addEdge` from a future code site).
- **Index keys are mixed node ids and annotation ids.** Per D2 the same `#edgesBySource` / `#edgesByTarget` Map<string, Set<string>> structure stores both. `getEdgesBySource(annotationId)` uniformly returns edges whose source IS that annotation. UUID collision space is effectively zero (uuid v4 over node and annotation populations).
- **Replay guard lifted; `EdgeAddedChange` widened.** Per D9 the change discriminant carries the polymorphic fields so incremental observers (snapshot test, future cache invalidation logic) see the same shape the projection holds.
- **Diagnostics conservatively skip annotation-endpoint edges.** Per D4 each diagnostic that walks the node-substance subgraph gets a one-line `continue` guard with an explanatory comment. Coherency-hint detection MAY in the future grow rules for annotation endpoints — that's its own task, named in Tech-debt registration. The default-skip prevents silent corruption from `getNode(annotationId) === undefined` cascading through `?.visible` chains.
- **Methodology validator gets a defensive reject.** Per D6 `validateSetEdgeSubstanceProposal` rejects any existing edge with annotation endpoints — the proposal kind doesn't carry annotation endpoints yet (`set_edge_substance_annotation_endpoint` is the follow-up). The reject keeps the validator honest while the proposal-side catches up.
- **No new ADR.** The polymorphic-target pattern is settled by `entity_creation_events` (R11 / option a) and replayed at the projection layer here. The micro-decisions (`| null` vs `| undefined` in the in-memory shape; per-diagnostic skip vs error) are engineering choices documented in Decisions, not architectural.
- **No DB migration in this task.** Per D7 the DB migration is deferred to `edges_table_polymorphic_endpoint_migration` (predecessor already named it).
- **No new Playwright cover.** This task is under `data_and_methodology.*` (backend / projection layer), NOT UI-stream. The Cucumber + Vitest cover is the right level per the refinements README. UI-stream e2e for annotation-endpoint edges falls under the moderator/participant/audience rendering follow-ups.
- **Test discipline per ADR 0022.** Each empirical check ships as a Vitest case + the Cucumber scenario; no out-of-tree verification.

## Acceptance criteria

**Pinned per ADR 0022 — every empirical check ships as a committed Vitest case + a Cucumber scenario.** Per D8 the test layers are Vitest (unit + projection-state) AND Cucumber (DB-roundtrip through projection). Per the test-layer policy in the refinements README, this is a projection / methodology-engine task — UI-stream Playwright cover does not apply (the UI consumers' rendering of annotation-endpoint edges is deferred to UI-stream follow-ups per D3).

Type + projector widening:

- [ ] [`apps/server/src/projection/types.ts:222-226`](../../../apps/server/src/projection/types.ts) `EdgeShape` widens to `{ role, sourceNodeId: string | null, sourceAnnotationId: string | null, targetNodeId: string | null, targetAnnotationId: string | null }`.
- [ ] [`apps/server/src/projection/types.ts:228-238`](../../../apps/server/src/projection/types.ts) `ProjectedEdge` mirrors the widened `EdgeShape` (four endpoint fields).
- [ ] [`apps/server/src/projection/types.ts:260-267`](../../../apps/server/src/projection/types.ts) `NewEdgeInput` mirrors the widened `EdgeShape`.
- [ ] [`apps/server/src/projection/types.ts:381-387`](../../../apps/server/src/projection/types.ts) `EdgeAddedChange` mirrors `ProjectedEdge`'s four endpoint fields.
- [ ] [`apps/server/src/projection/projection.ts:71-94`](../../../apps/server/src/projection/projection.ts) `buildEdge` constructs the widened shape from `NewEdgeInput`; throws `ProjectionInvariantError` with message `'edge <id>: exactly one of sourceNodeId / sourceAnnotationId must be set'` (and symmetric for target) when the XOR invariant is violated.
- [ ] [`apps/server/src/projection/projection.ts:227-234`](../../../apps/server/src/projection/projection.ts) `addEdge` indexes by `edge.sourceNodeId ?? edge.sourceAnnotationId` (whichever is non-null) into `#edgesBySource`; symmetric for target into `#edgesByTarget`.
- [ ] [`apps/server/src/projection/projection.ts:238-251`](../../../apps/server/src/projection/projection.ts) `removeEdge` removes from the index using the same key resolution.

Replay guard lift:

- [ ] [`apps/server/src/projection/replay.ts:213-217`](../../../apps/server/src/projection/replay.ts) `ReplayError` guard removed; the docblock above is updated to describe the new four-shape handling.
- [ ] `handleEdgeCreated` passes `source_node_id ?? null`, `source_annotation_id ?? null`, `target_node_id ?? null`, `target_annotation_id ?? null` into `addEdge` AND into the `EdgeAddedChange` payload.

Snapshot serializer:

- [ ] [`apps/server/src/ws/handlers/snapshot.ts:315-324`](../../../apps/server/src/ws/handlers/snapshot.ts) per-edge entry adds `sourceAnnotationId: edge.sourceAnnotationId` and `targetAnnotationId: edge.targetAnnotationId`; existing `sourceNodeId` / `targetNodeId` are now nullable in the output JSON.

Diagnostics audit (each site adds a one-line `if (edge.sourceNodeId === null || edge.targetNodeId === null) continue;` guard with a clarifying comment naming the node-substance subgraph as the scope; symmetric for source-only or target-only audits where appropriate):

- [ ] [`apps/server/src/projection/active-firing.ts:124-156`](../../../apps/server/src/projection/active-firing.ts) `isEdgeActive` — defensive guard at the top: if source/target is an annotation endpoint, throw a clear error (per D4 active-firing on annotation endpoints is undefined in v1; the throw is loud rather than silent).
- [ ] [`apps/server/src/diagnostics/cycle-detection.ts:121`](../../../apps/server/src/diagnostics/cycle-detection.ts) — `continue` on null endpoint at `buildSupportsAdjacency`.
- [ ] [`apps/server/src/diagnostics/dangling-claim-detection.ts:135`](../../../apps/server/src/diagnostics/dangling-claim-detection.ts) — defensive `continue` on null source.
- [ ] [`apps/server/src/diagnostics/coherency-hint-detection.ts:179, 221, 257`](../../../apps/server/src/diagnostics/coherency-hint-detection.ts) — `continue` on null endpoint at each site.
- [ ] [`apps/server/src/diagnostics/multi-warrant-detection.ts:99, 116`](../../../apps/server/src/diagnostics/multi-warrant-detection.ts) — `continue` on null endpoint at each site.
- [ ] [`apps/server/src/diagnostics/pending-consequences.ts:135`](../../../apps/server/src/diagnostics/pending-consequences.ts) — `continue` on null source.
- [ ] [`apps/server/src/methodology/primitives.ts:541`](../../../apps/server/src/methodology/primitives.ts) `incidentEdgesForNode` — no behavioural change (string id ≠ null is always true); but a one-line comment notes the widened-type handling so a future reader understands.

Methodology-engine compile fix:

- [ ] [`apps/server/src/methodology/handlers/propose.ts:1278-1285`](../../../apps/server/src/methodology/handlers/propose.ts) `validateSetEdgeSubstanceProposal` reads `existingEdge.sourceNodeId` / `existingEdge.targetNodeId` — both now nullable. The guard rejects (`validation-failed`) any existing edge with annotation endpoints with a message naming the follow-up `set_edge_substance_annotation_endpoint` so the breadcrumb is in the failure.

UI-stream consumers (the three projectGraph / selectors guards — comment update only, runtime behaviour unchanged):

- [ ] [`apps/moderator/src/graph/selectors.ts:366-374`](../../../apps/moderator/src/graph/selectors.ts) — the existing `continue` guard's comment is updated: today's text mentions "rejected at the projection-layer's `handleEdgeCreated` guard" (no longer accurate); replace with text naming the moderator-rendering follow-up (`mod_render_annotation_endpoint_edges`) and explaining the canvas can't render annotation endpoints as ReactFlow nodes yet. The narrowing logic stays (`if (source_node_id === undefined || target_node_id === undefined) continue;`).
- [ ] [`apps/participant/src/graph/projectGraph.ts:507-516`](../../../apps/participant/src/graph/projectGraph.ts) — same shape; the comment names the participant-rendering follow-up (`part_render_annotation_endpoint_edges`).
- [ ] [`apps/audience/src/graph/projectGraph.ts:312-321`](../../../apps/audience/src/graph/projectGraph.ts) — same shape; the comment names the audience-rendering follow-up (`aud_render_annotation_endpoint_edges`).

Vitest cover:

- [ ] [`apps/server/src/projection/replay.test.ts:308-332`](../../../apps/server/src/projection/replay.test.ts) — the existing `'... throws ReplayError ...'` test is **flipped** to a pass case asserting that `applyEvent` on an annotation-endpoint payload returns an `EdgeAddedChange` with the right four-field shape AND that the projection's `getEdge(edgeId)` returns the widened `ProjectedEdge`.
- [ ] New Vitest case — round-trip for `source_node_id + target_annotation_id` (the load-bearing E15 shape — node-source contradicting annotation-target).
- [ ] New Vitest case — round-trip for `source_annotation_id + target_node_id` (annotation-source case).
- [ ] New Vitest case — round-trip for `source_annotation_id + target_annotation_id` (annotation-to-annotation case).
- [ ] New Vitest case — `getEdgesBySource(annotationId)` and `getEdgesByTarget(annotationId)` return the index-resolved annotation-endpoint edge.
- [ ] New Vitest case — `Projection.addEdge` directly with a malformed `NewEdgeInput` (both source fields set, or neither) throws `ProjectionInvariantError`.
- [ ] [`apps/server/src/projection/incremental.test.ts:248-281`](../../../apps/server/src/projection/incremental.test.ts) — the existing `'edge-added'` baseline cases continue to pass; add one new case asserting `EdgeAddedChange` carries the annotation-id fields when `edge-created` payload sets them.
- [ ] [`apps/server/src/projection/active-firing.test.ts`](../../../apps/server/src/projection/active-firing.test.ts) — new case asserting `isEdgeActive` throws (or returns the documented sentinel per D4) when called on an annotation-endpoint edge.
- [ ] Each diagnostic's test file (`cycle-detection.test.ts`, `dangling-claim-detection.test.ts`, `coherency-hint-detection.test.ts`, `multi-warrant-detection.test.ts`, `pending-consequences.test.ts`) — new case asserting the diagnostic returns no findings for a projection containing only annotation-endpoint edges (the skip behaviour is pinned).
- [ ] [`apps/server/src/ws/handlers/snapshot.test.ts`](../../../apps/server/src/ws/handlers/snapshot.test.ts) — new case asserting the WS snapshot serializer produces the four endpoint fields for an annotation-endpoint edge.
- [ ] [`apps/server/src/methodology/handlers/propose.test.ts`](../../../apps/server/src/methodology/handlers/propose.test.ts) — new case asserting `validateSetEdgeSubstanceProposal` rejects (`validation-failed`) when the resolved existing edge carries annotation endpoints, with the follow-up name in the message.

Cucumber cover:

- [ ] [`tests/behavior/projection/from-log.feature`](../../../tests/behavior/projection/from-log.feature) — new scenario "annotation-endpoint edge round-trips through projectFromLog". Given an event log with `session-created`, `node-created` (one node), `annotation-created` (one annotation targeting the node), `edge-created` (source = node, target = annotation), When `projectFromLog` is invoked, Then the resulting projection has one edge with `sourceNodeId` set, `targetAnnotationId` set, and the other two endpoint slots null. The corresponding steps file extends with whatever helpers are needed.

Existing tests stay green:

- [ ] Every existing Vitest suite passes — including the prior `edge-created` baseline cases at `replay.test.ts:334-...` and `projection.test.ts`'s edge cases.
- [ ] Every existing Cucumber feature passes — `from-log.feature`'s baseline scenarios; `walkthrough-replay.feature`'s five scenarios (E15 is still encoded as the node-target workaround until `walkthrough_e15_annotation_endpoint_refit` lands — this task's widening is forward-compatible with both encodings).
- [ ] Every existing Playwright suite passes (UI consumers still skip annotation-endpoint edges per the unchanged guards).

Build + scheduler:

- [ ] `pnpm -F @a-conversa/server build` succeeds.
- [ ] `pnpm -F @a-conversa/moderator build`, `@a-conversa/participant` build, `@a-conversa/audience` build all succeed (the consumer-side guards continue to typecheck; their comment text is updated).
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green; Vitest baseline rises by ~15 (the new round-trips + diagnostics skip cases + snapshot delta + methodology reject case). Cucumber baseline rises by 1 (the new from-log scenario).
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/10-data-and-methodology.tji` gets `complete 100` on `projection_edge_annotation_endpoint`.

Tech-debt registration:

- [ ] **`mod_render_annotation_endpoint_edges` (future task — ~1.5d, UI-stream, moderator).** The moderator ReactFlow canvas currently skips annotation-endpoint edges (`apps/moderator/src/graph/selectors.ts:372`). Annotations are not currently rendered as ReactFlow nodes on the moderator canvas; rendering annotation-endpoint edges therefore requires the design question "how does the canvas surface annotations" to be resolved first. Closer registers under `moderator_ui.mod_canvas.*` (or wherever ReactFlow rendering work lives). Includes Playwright cover (a Playwright spec exercising a session log carrying an annotation-endpoint edge and asserting the canvas surface).
- [ ] **`part_render_annotation_endpoint_edges` (future task — ~1.5d, UI-stream, participant).** Same shape; participant's Cytoscape canvas. Closer registers under `participant_ui.part_canvas.*`. Includes Playwright cover.
- [ ] **`aud_render_annotation_endpoint_edges` (future task — ~1.5d, UI-stream, audience).** Same shape; audience Cytoscape canvas. Closer registers under `audience.aud_canvas.*`. Includes Playwright cover.
- [ ] **`diagnostics_annotation_endpoint_semantics_audit` (future task — ~1d).** Once moderator UI surfaces annotation-endpoint edges, revisit whether each diagnostic should also surface findings on those edges. The default established by this task is "skip" (conservative — pins observable behaviour). Coherency-hint detection in particular may want to surface "annotation-endpoint edge of role X is unusual" type rules. Closer registers under `data_and_methodology.diagnostics.*`.

The other follow-ups the predecessor already named (`edges_table_polymorphic_endpoint_migration`, `set_edge_substance_annotation_endpoint`, `walkthrough_e15_annotation_endpoint_refit`) are NOT re-registered here — the predecessor's Status block already named them as future tasks. The closer of THIS task verifies they remain as named-future-tasks in WBS or as registered work; the closer for `walkthrough_e15_annotation_endpoint_refit` may begin (its blocker — THIS task — is now resolved).

## Decisions

- **D1 — Widen the projection layer end-to-end in one task (types + projector + diagnostics + snapshot serializer + minimum methodology compile fix); defer UI rendering and proposal-side widening to named follow-ups.** Rationale:
  - **The 1d allocation matches a coherent widening surface.** Splitting types from projector from diagnostics would force three round-trips through the compile-error chain at each split-boundary. The five diagnostic sites and the methodology compile fix each take ~15 minutes once the type widening is settled — bundling them keeps the work coherent.
  - **The schema-side debt has a clear settlement point.** The predecessor's `ReplayError` guard is the load-bearing constraint to lift; once lifted the projection has to be consistent end-to-end, otherwise downstream consumers see undefined behaviour.
  - **UI rendering is a different concern.** Rendering annotation-endpoint edges on the canvas requires annotations to be canvas-renderable as graph nodes — a design question this task is not equipped to answer (it touches ReactFlow `Node` types, Cytoscape node configs, hover popovers, the per-statement vs per-annotation visual idiom). Lumping that in turns a 1d projection task into a 4–5d UI-redesign task. Per D3 the UI consumers stay as-is (skipping annotation-endpoint edges in their projectGraph helpers) and the rendering work registers as three named UI-stream follow-ups.
  - **Proposal-side widening is the predecessor's already-named follow-up** (`set_edge_substance_annotation_endpoint`). This task's only proposal-side concern is the validator-side defensive reject (D6) — the minimum to keep the build green.
  - **Alternative considered: do only the type + replay widening + diagnostics, and leave methodology + snapshot as the next slice.** Rejected — `validateSetEdgeSubstanceProposal` reading nullable `existingEdge.sourceNodeId` produces a TypeScript build error; without the methodology fix, the build doesn't compile. Same for the snapshot serializer: leaving it serializing only `sourceNodeId` / `targetNodeId` would make the WS snapshot lossy for annotation-endpoint edges, which is a wire-level regression the WS test would catch.
  - **Alternative considered: lift the guard but leave the projection's `ProjectedEdge` carrying only node ids; coerce annotation endpoints to "node-target = first incident node of the annotation".** Rejected — this is exactly the workaround the schema widening was designed to fix. The projection is the authoritative in-memory shape; coercing at the projection seam re-introduces the encoding mismatch the predecessor lifted.

- **D2 — In-memory shape uses `| null` per endpoint slot (mirroring `ProjectedAnnotation`); wire payload uses `.optional()` (mirroring annotation-created precedent at the wire layer). The `?? null` coercion lives at `handleEdgeCreated`.** Rationale:
  - **`ProjectedAnnotation` is the established precedent** at [L240-251](../../../apps/server/src/projection/types.ts): `targetNodeId: string | null` + `targetEdgeId: string | null` + XOR invariant in `buildAnnotation`. Replicating this for edges is one less idiom in the codebase.
  - **`| null` makes the XOR check explicit.** `payload.x !== null` is unambiguous; `payload.x !== undefined` is the same at runtime but reads less clearly in the projection layer's vocabulary (the projection doesn't traffic in optionality — it traffics in present-or-absent fields).
  - **The `?? null` coercion happens at one site** (`handleEdgeCreated`). Outside that seam the projection only sees `| null`.
  - **Alternative considered: in-memory `| undefined`, matching the wire schema.** Rejected — `| null` is more uniform with the rest of the projection layer (every other nullable field in `types.ts` is `| null`, not `| undefined`). Switching idioms mid-file makes the type story noisier than it needs to be.
  - **Alternative considered: a discriminated-union endpoint type (`{ kind: 'node', id } | { kind: 'annotation', id }`).** Rejected — clean shape on paper, but every read site has to switch on `.kind` before getting an id, and the wire payload's four-field shape doesn't map onto it cleanly (would need a transformer at the projection seam). The flat-fields-with-null pattern matches the wire shape directly.

- **D3 — UI consumers (moderator/participant/audience graph helpers) stay as-is; their `continue`-on-annotation-endpoint guards remain; the rendering work registers as three named follow-ups.** Rationale:
  - **Rendering annotation-endpoint edges requires annotations to be canvas-renderable as graph nodes.** Today annotations are surfaced on the canvas as per-statement attachments (a small icon or popover), not as standalone graph nodes with their own positions. ReactFlow / Cytoscape edges connect graph-node ids; if the canvas doesn't render annotation as a graph node, an annotation-endpoint edge has no node to connect to. That's a UI design question, not a projection-layer change.
  - **The current guards are honest:** they `continue` on the unrenderable shape. Lifting them without solving the design question would either produce a runtime error (id-not-found on the ReactFlow graph) or a silent edge drop with no breadcrumb. The continued-skip is the cleanest interim state.
  - **The three follow-ups (moderator / participant / audience) name the design problem.** Each is a UI-stream task with Playwright cover; each can move at its own pace; each gets to make the "render annotation as graph node or as edge attachment?" call within its own UI's vocabulary.
  - **Alternative considered: lift the guards and render the edge as floating (no source-node connection on the canvas).** Rejected — ReactFlow requires `source` / `target` to be present node ids; missing-id is a runtime error. Cytoscape allows orphan edges but renders them invisibly. Neither is the user-visible outcome.
  - **Alternative considered: lift the guards in the moderator-only consumer this task, defer participant + audience.** Rejected — splitting the three reduces UI consistency without buying much (each is ~1.5d and they don't share code).

- **D4 — Diagnostics default to skipping annotation-endpoint edges (conservative — pins observable behaviour); active-firing throws (defensive — annotation has no substance facet to read).** Rationale:
  - **Each diagnostic walks the node-substance subgraph by construction.** Cycle detection over `supports` edges requires source/target both be nodes (cycles are over the claim/data/warrant subgraph). Multi-warrant detection reasons about (data, warrant, claim) triples — all nodes. Coherency-hint detection's warrant rules and self-contradicts rule are node-node. Dangling-claim detection walks nodes' incoming edges; annotation-source edges incident on a node target are out-of-band of the dangling-claim rule.
  - **Skipping is the least-surprising default.** It says "this diagnostic doesn't have an answer for annotation-endpoint edges yet." Any answer the diagnostic returned would be ad-hoc until the methodology specifies what an annotation-endpoint edge means structurally for that diagnostic.
  - **Active-firing is the exception because the read fails.** `isEdgeActive` reads source-node substance via `deriveFacetStatus(projection, 'node', edge.sourceNodeId, 'substance')` — if the source is an annotation, this is a category error (annotations don't have substance facets). Throwing with a clear message is better than `?? 'baseline'`-style coercion.
  - **The diagnostics-semantics-audit follow-up is the right place to revisit.** Once the methodology has resolved "what does an annotation-endpoint edge MEAN structurally?", each diagnostic gets a per-rule pass.
  - **Alternative considered: have each diagnostic surface annotation-endpoint edges with their own rule.** Rejected — premature. The methodology hasn't specified the semantics; speculating is what the audit task is for.
  - **Alternative considered: throw across the board, including the cycle/coherency/multi-warrant/etc. diagnostics.** Rejected — the throws would crash diagnostic runs on any projection containing an annotation-endpoint edge, including the walkthrough fixture post-refit. Skipping keeps the diagnostics composable.

- **D5 — No Zod schema for the WS snapshot wire shape; snapshot serializer adds the new fields and the existing `z.unknown()` wrapper continues to accept the widened JSON.** Rationale:
  - **The snapshot wire schema already treats `projection` as `z.unknown()`** at [`packages/shared-types/src/ws-envelope.ts:872-876`](../../../packages/shared-types/src/ws-envelope.ts). The docblock at L859-870 explicitly states "widening the wire schema to enforce every nested key would tightly couple the WS module to those types" — the chosen architecture is "the projection is built by a pure function over schema-validated events; re-validating its OUTPUT is redundant."
  - **The serializer's Vitest pins the wire shape.** Same as today's seven other projection fields.
  - **Alternative considered: add a narrow Zod schema for the edges-array entry.** Rejected — would need to evolve every time a facet field lands on `ProjectedEdge`. Not worth the maintenance burden for a defense-in-depth re-validation of a pure-function output.

- **D6 — `validateSetEdgeSubstanceProposal` defensively rejects existing edges with annotation endpoints; the follow-up name is in the message.** Rationale:
  - **The build needs a fix.** `existingEdge.sourceNodeId !== sourceNodeId` reads `existingEdge.sourceNodeId` as `string`; the widening makes it `string | null` and `null !== string` is always true, so the comparison subtly mis-fires (the validator would falsely report a mismatch when in fact the proposal carries a node id and the projected edge has an annotation source).
  - **The right behaviour pending the proposal-side widening is to reject.** The proposal kind doesn't carry annotation endpoints yet (`set_edge_substance_annotation_endpoint` is the follow-up); receiving a proposal whose resolved edge has annotation endpoints means "this proposal can't address this edge." Reject with a clear message naming the follow-up so a future developer hitting this knows where the work goes.
  - **The reject is small** — a guard before the existing endpoint-triple comparison, returning a `validation-failed` outcome with the follow-up name in the detail message.
  - **Alternative considered: silently allow the validator to mis-fire as today.** Rejected — produces wrong outcomes (proposal incorrectly rejected as endpoint-triple mismatch).
  - **Alternative considered: do the proposal-side widening here.** Rejected — out of this task's scope per D1; predecessor already named it as a separate follow-up.

- **D7 — DB migration is OUT of scope.** Rationale:
  - **The predecessor already named** `edges_table_polymorphic_endpoint_migration` as a separate follow-up. No DB write path lands edges today (no `INSERT INTO edges` in `apps/server/src` per the predecessor's grep). The in-memory projection is widened here; the DB migration runs on its own track when a future write path lands.
  - **Sequencing.** The DB migration would mirror this task's in-memory shape; landing it ahead of the in-memory widening would force a migration without a consumer.

- **D8 — Cucumber `from-log.feature` gets one new scenario covering the round-trip; Vitest carries the rest.** Rationale:
  - **The JSONB-roundtrip surface is what Cucumber pins** per [ADR 0007](../../../docs/adr/0007-behavior-test-framework-cucumber.md) and the established `from-log.feature` shape. A scenario carrying an annotation-endpoint `edge-created` through JSONB and asserting the projection's edge shape is the right level for "the widened payload survives the persistence boundary."
  - **Vitest covers the per-unit shapes** (XOR invariant, index population, diagnostic-skip behaviour, snapshot serializer, methodology validator). These are unit-level concerns.
  - **Alternative considered: add scenarios to each diagnostic's feature file** (`cycle-detection.feature`, etc.) asserting the skip. Rejected — the skip is unit-level: the diagnostic's `for (const edge of ...) if (skip) continue;` line has no observable difference at the Cucumber-layer scenario level (no findings emitted either way). Vitest pins it more directly.

- **D9 — `EdgeAddedChange` widens to carry all four endpoint fields (mirroring `ProjectedEdge`); no new change discriminant for annotation-endpoint edges.** Rationale:
  - **Symmetry with `ProjectedEdge`.** The change describes what the projection now holds; one discriminant carrying the widened shape is more honest than two discriminants (`'edge-added'` and `'annotation-endpoint-edge-added'`) papering over a fork in the data.
  - **No downstream consumer routes on the discriminant.** Per the grep at L324-end the only consumers are `incremental.test.ts:281` (asserts the discriminant in tests — easy fix) and `applyEvent`'s outer dispatcher (doesn't read endpoint fields). The widening costs ~one line per consumer to type-narrow.
  - **Alternative considered: keep `'edge-added'` carrying only `sourceNodeId` / `targetNodeId` and emit no change for annotation-endpoint edges.** Rejected — `applyEvent`'s contract is "every event produces zero or more changes describing what shifted"; silently emitting nothing for annotation-endpoint edges would break the contract.
  - **Alternative considered: add a separate `'annotation-endpoint-edge-added'` discriminant.** Rejected — duplicates the `'edge-added'` shape verbatim except for the endpoint-field nullability. Adds discriminator churn at no value.

## Open questions

(none — all decided in D1–D9.)

## Status

**Done** — 2026-05-30.

- Widened `EdgeShape`, `ProjectedEdge`, `NewEdgeInput`, and `EdgeAddedChange` to four polymorphic endpoint slots (`sourceNodeId`, `sourceAnnotationId`, `targetNodeId`, `targetAnnotationId`) in `apps/server/src/projection/types.ts`.
- Updated `buildEdge` (XOR invariant per endpoint) and `addEdge`/`removeEdge` (index by whichever slot is non-null) in `apps/server/src/projection/projection.ts`; added `edgeSourceKey`/`edgeTargetKey` helpers.
- Lifted the `ReplayError` guard in `handleEdgeCreated`; threaded four `?? null` fields into `addEdge` and `EdgeAddedChange` in `apps/server/src/projection/replay.ts`.
- Added `sourceAnnotationId`/`targetAnnotationId` to the edges wire entry in `apps/server/src/ws/handlers/snapshot.ts`.
- Added null-endpoint skip guards to `apps/server/src/projection/active-firing.ts` (throws on annotation endpoint), `apps/server/src/diagnostics/{cycle,dangling-claim,coherency-hint,multi-warrant,pending-consequences}-detection.ts`, and a comment-only note on widened-type handling to `apps/server/src/methodology/primitives.ts`.
- Added defensive annotation-endpoint reject in `validateSetEdgeSubstanceProposal` in `apps/server/src/methodology/handlers/propose.ts`, naming `set_edge_substance_annotation_endpoint` as the follow-up.
- Updated dead-code comments in `apps/{moderator,participant,audience}/src/graph/{selectors,projectGraph}.ts` to name the rendering follow-up tasks.
- Covered with Vitest deltas across `replay.test.ts`, `projection.test.ts`, `incremental.test.ts`, `active-firing.test.ts`, five diagnostic test files, `snapshot.test.ts`, and `proposeSetEdgeSubstanceValidation.test.ts`; added one new Cucumber scenario in `tests/behavior/projection/from-log.feature` ("annotation-endpoint edge round-trips through projectFromLog").
