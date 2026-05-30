# Extend edge endpoint schema to allow annotation endpoints

**TaskJuggler entry**: `data_and_methodology.event_types.edge_target_annotation_schema_extension` — [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) (block at lines 154-164). Embedded note: *"Source of debt: walkthrough_replay_e2e — the edge schema currently only allows node↔node endpoints. The walkthrough's E15 (N19 contradicts A2) had to be encoded as N19→contradicts→N6 (the node A2 annotates) as the closest faithful encoding within today's schema. Extend edge-created payload to accept annotation ids as valid source/target endpoints so E15 can be encoded faithfully."*

## Effort estimate

**0.5d** (per the `.tji` allocation). The work is purely a payload-schema widening at one file ([`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — the `edgeCreatedPayloadSchema` definition at L300-309), plus the matching Vitest deltas in `events.test.ts` (round-trip + invalid-input cover for the new annotation-endpoint shape). No DB migration. No projection-layer change. No methodology validator change. No fixture refit. Each of those is an explicitly-named downstream follow-up registered under "Tech-debt registration" below; this task is the wire-schema gate that unblocks them.

Breakdown:

- **Schema widening (~2h)**. Replace the two required `source_node_id` / `target_node_id` fields on `edgeCreatedPayloadSchema` with four `.optional()` fields (`source_node_id`, `source_annotation_id`, `target_node_id`, `target_annotation_id`), then chain two `.refine()` blocks enforcing "exactly one of each pair is set" (mirrors the precedent in [`annotationCreatedPayloadSchema`](../../../packages/shared-types/src/events.ts) at L320-335). Backward-compat at the call site: existing payloads carrying `source_node_id` + `target_node_id` (no annotation fields present) continue to parse — D2 below picks `.optional()` over `.nullable()` precisely for this.
- **Vitest deltas (~2h)**. Existing `edge-created payload schema` describe block at [`events.test.ts:315-386`](../../../packages/shared-types/src/events.test.ts) extends with: a round-trip case for the annotation-target shape; an annotation-source shape; a mixed shape (node-source + annotation-target — the load-bearing E15 case); negative cases for both-target-fields-set, neither-target-field-set, both-source-fields-set, neither-source-field-set; a non-UUID `source_annotation_id` rejection; a non-UUID `target_annotation_id` rejection. The existing six tests stay unchanged (the well-formed `valid` fixture still parses).

No new ADR. No new file. One module touched: `packages/shared-types/src/events.ts`. One test file touched: `packages/shared-types/src/events.test.ts`.

## Inherited dependencies

**Settled:**

- [`data_and_methodology.event_types.entity_creation_events`](./entity_creation_events.md) (done — `complete 100` on 2026-05-10. The source of the schema this task widens: `edgeCreatedPayloadSchema` at [`packages/shared-types/src/events.ts:300-309`](../../../packages/shared-types/src/events.ts), `annotationCreatedPayloadSchema` at [L320-335](../../../packages/shared-types/src/events.ts) — whose two-nullable-target-columns + `.refine()` XOR pattern is the precedent this task mirrors per D2. The shared `edgeRoleSchema` / `annotationKindSchema` enums in [`packages/shared-types/src/events/enums.ts`](../../../packages/shared-types/src/events/enums.ts) are unchanged — only the endpoint-id fields widen.)
- [`data_and_methodology.data_methodology_tests.dm_e2e_tests.walkthrough_replay_e2e`](./walkthrough_replay_e2e.md) (done — `complete 100`. The source-of-debt: its Status block at L242 explicitly registers this task as the follow-up for "annotation endpoints in edge schema; E15 currently encoded via the annotation's host node." E15's current wire encoding lives at [`packages/test-fixtures/src/fixtures/walkthrough/events.json:3923-3938`](../../../packages/test-fixtures/src/fixtures/walkthrough/events.json) — `source_node_id: <N19>`, `target_node_id: <N6>` — the workaround this task makes refittable.)
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md). Per the from-log.feature header note and the `validateEvent` seam at [`packages/shared-types/src/events.ts:840-876`](../../../packages/shared-types/src/events.ts), `edge-created` payloads validate through the shared `edgeCreatedPayloadSchema` on the JSONB → typed-`Event` boundary. Widening the schema widens what `validateEvent` accepts — automatically, no API change.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every check ships as a committed Vitest case. The deltas under Acceptance criteria are the cover.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md). The schema widening is an entity-layer concern: it changes what entities (edges) can refer to. The facet-layer machinery (`shapeFacet`, `substanceFacet`, `deriveFacetStatus`) is untouched.
- The annotation-target polymorphic-FK precedent — `annotationCreatedPayloadSchema` at [L320-335](../../../packages/shared-types/src/events.ts) (settled by `entity_creation_events`). Two nullable typed columns + `.refine()` XOR. The pattern, modulo `.optional()` vs `.nullable()` (D2), carries directly.
- The mirroring SQL convention — [`0006_annotations.sql`](../../../apps/server/migrations/0006_annotations.sql) L51-98 ("Polymorphic-FK strategy: option (a) — two nullable typed FK columns. `target_node_id` references `nodes`, `target_edge_id` references `edges`, and a CHECK constraint enforces exactly one non-null"). D6 below decides the DB migration that mirrors this pattern for the `edges` table is OUT of scope for this task and a named follow-up.

**Pending:** (none — every load-bearing input is settled on `main`.)

## What this task is

Widen the `edge-created` event payload schema so an edge's `source` and/or `target` endpoint may be an annotation (in addition to a node). The today's-shape contract — "an edge connects two nodes" — becomes "an edge connects two entities, each of which is either a node or an annotation, with each endpoint independently polymorphic." The Zod payload schema enforces "exactly one of `<endpoint>_node_id` / `<endpoint>_annotation_id` per endpoint" via a `.refine()` block per endpoint, mirroring the precedent already established for `annotationCreatedPayloadSchema`'s polymorphic-target shape.

Concretely the deliverable is two artefacts:

1. **Widened Zod schema** — [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) L300-309. The `edgeCreatedPayloadSchema` gains two new endpoint id fields (`source_annotation_id`, `target_annotation_id`) and demotes the existing two (`source_node_id`, `target_node_id`) from required to optional. Two `.refine()` blocks enforce the per-endpoint XOR. The exported `EdgeCreatedPayload` type — `z.infer<typeof edgeCreatedPayloadSchema>` — automatically widens to the union shape; consumers that destructure `.source_node_id` directly become call sites that need to handle the optional case (a deliberate forcing function that surfaces the polymorphic-endpoint concern where it lives — see D5 for why this is the right forcing function and not a regression).

2. **Vitest cover** — [`packages/shared-types/src/events.test.ts`](../../../packages/shared-types/src/events.test.ts) `edge-created payload schema` describe block at L315-386. Six new test cases: round-trip for the annotation-target shape, round-trip for the annotation-source shape, round-trip for the mixed shape (the load-bearing E15 case — node-source + annotation-target), and four negative cases (`both targets set`, `neither target set`, `both sources set`, `neither source set`). Two additional bad-UUID rejection cases for the two new fields. Existing six cases stay green.

This task is the wire-schema gate. Downstream consumers — the projection layer, the methodology validator, the DB schema, the moderator UI, the walkthrough fixture's E15 refit — each become possible after this lands and are explicitly named under "Tech-debt registration" so the orchestrator picks them up.

## Why it needs to be done

Three reasons compose:

**The walkthrough's E15 is the canonical failure case the schema doesn't yet honour.** [`docs/example-walkthrough.md`](../../../docs/example-walkthrough.md) — the load-bearing simulated debate per [`DESIGN.md`](../../../DESIGN.md) L39 — names a turn-21 edge that contradicts an annotation (E15: N19 contradicts A2). The recently-landed `walkthrough_replay_e2e` fixture had to encode this as a node-target workaround (N19→contradicts→N6, where N6 is the node A2 annotates) and its Status block at L242 explicitly registers this task as the follow-up. Without the schema widening, the canonical fixture cannot encode the canonical narrative faithfully — and any future replay test or audience-broadcast scenario built on the walkthrough inherits the workaround.

**The schema is the gate that unblocks every downstream layer.** Because `edgeCreatedPayloadSchema` is the source-of-truth wire shape, widening it is the prerequisite for: the projection's `ProjectedEdge` carrying polymorphic-endpoint state; the methodology validator (`validateSetEdgeSubstanceProposal`) accepting annotation endpoints in propose-time validation; the moderator UI proposing an annotation-targeted contradiction; the DB `edges` table widening (so production can actually persist such edges once a UI ships). Each of those is its own follow-up task; this one is the wire-layer change that makes any of them coherent to attempt. Per D1 the scope here is intentionally narrow — the schema only — because the schema is the load-bearing dependency the rest of the chain hangs off.

**The polymorphic-target pattern already exists in the codebase.** [`annotationCreatedPayloadSchema`](../../../packages/shared-types/src/events.ts) at L320-335 settled it once: two nullable typed columns + Zod `.refine()` XOR + SQL `CHECK ((target_node_id IS NOT NULL) <> (target_edge_id IS NOT NULL))` (mirrored in [`0006_annotations.sql:97`](../../../apps/server/migrations/0006_annotations.sql)). Replicating the pattern for edge endpoints keeps the polymorphic-FK strategy consistent across the three entity types (annotations, then edges — both targeting "a node or some other entity") and matches the principle the entity_creation_events refinement explicitly named ("R11 / option a"). The cost of inconsistency — different polymorphic-target patterns across schemas — is paid in every downstream consumer that has to learn two encodings; the cost of consistency is one schema widening.

Downstream consumers benefit transitively (each is its own follow-up task, registered below):

- `edges_table_polymorphic_endpoint_migration` (DB schema) — the migration that mirrors `0006_annotations.sql`'s pattern on the `edges` table. Today the global `edges` table is dormant in production (no `INSERT INTO edges` in `apps/server/src` per repository grep) so the gap isn't load-bearing, but once a UI gesture mints an annotation-endpoint edge the production write path needs the columns.
- `projection_edge_annotation_endpoint` — extends `ProjectedEdge` and `EdgeShape` to carry the polymorphic endpoints, updates `replay.ts`'s `handleEdgeCreated`, audits the diagnostics (`active_firing_computation`, `cycle_detection`, `dangling_claim_detection`, `coherency_hint_detection`, `multi_warrant_detection`) for "what does this mean for an annotation-endpoint edge?"
- `set_edge_substance_annotation_endpoint` — widens `setEdgeSubstanceProposalSchema`'s optional endpoint fields to allow annotation ids, extends `validateSetEdgeSubstanceProposal` accordingly.
- `walkthrough_e15_annotation_endpoint_refit` — refits E15 in the walkthrough fixture once the projection has caught up.

## Inputs / context

**Design contract:**

- [`docs/example-walkthrough.md`](../../../docs/example-walkthrough.md) — the source-of-truth narrative; turn 21 names E15 (N19 contradicts A2) — the canonical annotation-endpoint edge.
- [`docs/data-model.md`](../../../docs/data-model.md) L114-122 — the edge-role vocabulary (the seven roles enumerated in `edgeRoleSchema`). The widening leaves this vocabulary unchanged; the seven roles are independent of endpoint kind.
- [`docs/data-model.md`](../../../docs/data-model.md) L211-213 — "decompositions, interpretive splits, axiom-marks, and meta-moves are events recorded in history; their effects ... appear on the graph." Confirms the event-log encoding is the authoritative shape; widening it is the right place for this change.

**Architectural / engineering inputs:**

- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — `validateEvent` is the JSONB → typed-`Event` boundary; widening the per-kind schema widens what passes the boundary automatically.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest deltas at `events.test.ts` are the cover.
- [ADR 0027 — Entity and facet layers strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the widening is an entity-layer concern; facet-layer machinery is untouched.

**Runtime inputs (real file references the implementer reads + edits):**

- [`packages/shared-types/src/events.ts:300-309`](../../../packages/shared-types/src/events.ts) — `edgeCreatedPayloadSchema` definition. The widening lives here.
- [`packages/shared-types/src/events.ts:320-335`](../../../packages/shared-types/src/events.ts) — `annotationCreatedPayloadSchema` definition. **The precedent this task mirrors.** Same polymorphic-target encoding pattern (two nullable typed FK columns + `.refine()` XOR), modulo D2's choice of `.optional()` vs `.nullable()`.
- [`packages/shared-types/src/events.ts:243-269`](../../../packages/shared-types/src/events.ts) — the `entity_creation_events` header docblock. The text gets a one-paragraph amendment noting `edge-created` now mirrors `annotation-created`'s polymorphic-target shape (two `.optional()` endpoint fields per side + per-endpoint `.refine()` XOR — see D2 for the `.optional()` vs `.nullable()` choice rationale).
- [`packages/shared-types/src/events.test.ts:315-386`](../../../packages/shared-types/src/events.test.ts) — `edge-created payload schema` describe block. Extended with the deltas listed under Acceptance criteria.
- [`packages/shared-types/src/events.test.ts:388-500`](../../../packages/shared-types/src/events.test.ts) — `annotation-created payload schema` describe block. **Reference template for the new annotation-target cases** — the both-targets / neither-target negative test patterns transfer one-for-one with field name substitutions.
- [`packages/shared-types/src/events/enums.ts`](../../../packages/shared-types/src/events/enums.ts) — `edgeRoleSchema`, `annotationKindSchema`. **Unchanged** — the role vocabulary doesn't depend on endpoint kind.
- [`apps/server/src/projection/replay.ts:202-225`](../../../apps/server/src/projection/replay.ts) — `handleEdgeCreated`. **Unchanged in this task** — D1 punts the projection-layer widening to the named follow-up `projection_edge_annotation_endpoint`. Today's handler reads `payload.source_node_id` / `payload.target_node_id` directly; after this task it sees those as optional fields. Per D5 the TypeScript compiler will surface this as a build error; the fix is to add a guard — `if (payload.source_node_id === undefined || payload.target_node_id === undefined) throw new ReplayError(...)` — that rejects annotation-endpoint edges at the projection layer until the follow-up lands. This guard is the bridge between the widened schema and the unwidened projection.
- [`apps/server/src/projection/types.ts:222-238`](../../../apps/server/src/projection/types.ts) — `EdgeShape` + `ProjectedEdge`. **Unchanged in this task** — same reasoning.
- [`packages/shared-types/src/events/proposals.ts:137-144`](../../../packages/shared-types/src/events/proposals.ts) — `captureNodeEdgeShapeSchema`. **Unchanged in this task** — D1 punts the proposal-side widening to the named follow-up `set_edge_substance_annotation_endpoint`.
- [`packages/shared-types/src/events/proposals.ts:202-209`](../../../packages/shared-types/src/events/proposals.ts) — `setEdgeSubstanceProposalSchema`. **Unchanged in this task** — same reasoning.
- [`apps/server/migrations/0005_edges.sql`](../../../apps/server/migrations/0005_edges.sql) — edges DB schema. **Unchanged in this task** — D6 punts to the named follow-up `edges_table_polymorphic_endpoint_migration`.
- [`packages/test-fixtures/src/fixtures/walkthrough/events.json:3923-3938`](../../../packages/test-fixtures/src/fixtures/walkthrough/events.json) — E15's current node-target workaround. **Unchanged in this task** — D7 punts the refit to the named follow-up `walkthrough_e15_annotation_endpoint_refit`, sequenced after the projection-layer follow-up has landed (otherwise the refitted fixture would crash the projection's `handleEdgeCreated`).

## Constraints / requirements

- **Schema-only scope.** Per D1 this task ships ONLY the Zod payload widening + Vitest deltas. The projection layer, the methodology validator, the DB migration, the proposal sub-kind extension, and the walkthrough fixture refit are explicitly out of scope; each is a named follow-up registered under "Tech-debt registration" so the orchestrator's pick-task pass picks them up.
- **Polymorphic-target pattern matches `annotation-created`.** Per D3, the field names are `source_node_id` / `source_annotation_id` / `target_node_id` / `target_annotation_id` — explicit per-kind id columns, NOT a `source_kind` / `source_id` discriminator-plus-opaque-id pair. Mirrors the precedent at [L328-329](../../../packages/shared-types/src/events.ts).
- **`.optional()` not `.nullable()`.** Per D2, the new fields are `.optional()` (allowing `undefined` / absent) — and the existing two fields are demoted from required to `.optional()` — rather than `.nullable()` (requiring an explicit `null`). Backward-compat: existing payloads carrying `source_node_id` + `target_node_id` with no annotation fields present continue to parse without modification. The annotation-target precedent uses `.nullable()`; this task diverges with stated rationale (D2).
- **Per-endpoint `.refine()` XOR.** Two `.refine()` blocks, one per endpoint: `(source_node_id === undefined) !== (source_annotation_id === undefined)` and the symmetric target check. Distinct blocks rather than one combined check so the rejection message names the specific endpoint that's malformed (the precedent established by `annotationCreatedPayloadSchema`'s one-and-only `.refine()` is for a single target; here we have two targets so two `.refine()` blocks).
- **Existing payload shape is a strict subset of the new shape.** Every payload that validates against today's `edgeCreatedPayloadSchema` continues to validate against the widened one. Verified by the round-trip case in the existing Vitest suite (unchanged) plus a regression baseline noting "the walkthrough fixture's 15 edges parse without change."
- **No widening of `validateEvent` plumbing.** Per ADR 0021 the registry-and-discriminator pattern is general over per-kind schemas; widening one entry in the registry needs no envelope-level change.
- **Downstream consumers stay node-only until their own task lands.** Per D5, the projection's `handleEdgeCreated`, the methodology validator, the `setEdgeSubstanceProposalSchema`, and the moderator UI are unchanged. The projection layer needs the TypeScript compiler error fix described under Inputs / context (guard rejecting annotation-endpoint payloads at the replay seam until the follow-up lands) so the schema widening doesn't break the build.
- **No new ADR.** The polymorphic-target pattern is already settled by `entity_creation_events` (R11 / option a) and replayed here with rationale; this is a schema widening within an established pattern, not a new architectural choice. The two micro-decisions (`.optional()` vs `.nullable()`; per-endpoint vs combined `.refine()`) are payload-shape engineering, not architectural.
- **No Cucumber scenario.** Per D4 the test layer is Vitest. The DB-roundtrip surface for `edge-created` is already covered by `from-log.feature`'s baseline scenario (which exercises the existing payload shape through pglite's JSONB); the widened shape rides on the same plumbing, so the existing cover already pins the round-trip behaviour at the DB layer. The widened-shape rejection cases are unit-level concerns, not integration concerns.
- **No new Playwright cover.** Per the UI-stream e2e policy at [tasks/refinements/README.md](../README.md) UI-stream tasks get Playwright cover; this task is under `data_and_methodology.*` (backend / payload schema) NOT UI-stream. The Vitest cover is the right level.
- **Test discipline per ADR 0022.** Each Vitest delta is a committed test case; no out-of-tree verification.

## Acceptance criteria

**Pinned per ADR 0022 — every empirical check ships as a committed Vitest case.** Per D4 the layer is Vitest (NOT Cucumber, NOT Playwright). Per the test-layer policy in the refinements README, this is an event-types / shared-types task (`data_and_methodology.event_types.*`) — UI-stream e2e does not apply.

Schema landing (at [`packages/shared-types/src/events.ts:300-309`](../../../packages/shared-types/src/events.ts)):

- [ ] `edgeCreatedPayloadSchema` gains `source_annotation_id: z.string().uuid().optional()` and `target_annotation_id: z.string().uuid().optional()` fields.
- [ ] `edgeCreatedPayloadSchema` demotes `source_node_id` and `target_node_id` from required `z.string().uuid()` to `z.string().uuid().optional()`.
- [ ] `edgeCreatedPayloadSchema` chains two `.refine()` blocks:
  - First: `(payload.source_node_id === undefined) !== (payload.source_annotation_id === undefined)` with message `'exactly one of source_node_id / source_annotation_id must be set'`.
  - Second: `(payload.target_node_id === undefined) !== (payload.target_annotation_id === undefined)` with message `'exactly one of target_node_id / target_annotation_id must be set'`.
- [ ] The entity-creation header docblock at [`events.ts:243-269`](../../../packages/shared-types/src/events.ts) gets a one-paragraph amendment noting `edge-created` now mirrors `annotation-created`'s polymorphic-target shape (cross-references this refinement).
- [ ] `EdgeCreatedPayload` type (the `z.infer<...>` derivation) automatically widens. The exported type signature surfaces all four endpoint fields as `string | undefined`.

Vitest cover (at [`packages/shared-types/src/events.test.ts:315-386`](../../../packages/shared-types/src/events.test.ts) — `edge-created payload schema` describe block):

- [ ] **Existing six cases stay green.** Round-trip with `source_node_id` + `target_node_id`; seven-role acceptance; unknown-role rejection through `validateEvent`; non-UUID `edge_id` rejection; non-UUID `source_node_id` rejection; non-UUID `target_node_id` rejection.
- [ ] **New case — round-trip with `source_node_id` + `target_annotation_id`** (the load-bearing E15 shape — node-source contradicting annotation-target). Parses, round-trips through JSON, equals input.
- [ ] **New case — round-trip with `source_annotation_id` + `target_node_id`** (the symmetric annotation-source case — covered because the schema treats the two endpoints symmetrically and proving symmetry pins the implementation).
- [ ] **New case — round-trip with `source_annotation_id` + `target_annotation_id`** (annotation-to-annotation edge — schema-permitted even though no v1 narrative produces one; covered to pin the schema's behaviour under the most permissive shape).
- [ ] **New case — rejects payload with both `source_node_id` AND `source_annotation_id` set.** `safeParse` returns `success: false`; the issue message contains `'source_node_id / source_annotation_id'`.
- [ ] **New case — rejects payload with NEITHER `source_node_id` NOR `source_annotation_id` set.** Symmetric to above.
- [ ] **New case — rejects payload with both `target_node_id` AND `target_annotation_id` set.** Symmetric to the source-side both-set case.
- [ ] **New case — rejects payload with NEITHER `target_node_id` NOR `target_annotation_id` set.** Symmetric to the source-side neither-set case.
- [ ] **New case — rejects a non-UUID `source_annotation_id`.** `safeParse` returns `success: false`.
- [ ] **New case — rejects a non-UUID `target_annotation_id`.** Symmetric.

Downstream consumer plumbing (the projection-layer guard that bridges the widened schema and the unwidened projection):

- [ ] [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) `handleEdgeCreated` gains a guard at the top that throws `ReplayError` if either `payload.source_node_id === undefined` OR `payload.target_node_id === undefined` (i.e. an annotation-endpoint edge — not yet handled at the projection layer per D1 / D5; the named follow-up `projection_edge_annotation_endpoint` lifts this guard). The error message names the deferred follow-up so a future developer hitting this in tests has a clear breadcrumb. Vitest case at [`apps/server/src/projection/replay.test.ts`](../../../apps/server/src/projection/replay.test.ts) covers this rejection.

Existing tests stay green:

- [ ] Every existing Vitest suite passes — including the `events.test.ts` suite's pre-existing six `edge-created payload schema` cases and the broader `validateEvent` suite.
- [ ] Every existing Cucumber feature passes — including `from-log.feature`'s `empty`-fixture scenario and `walkthrough-replay.feature`'s five scenarios (E15 is still encoded as the node-target workaround until the named refit task lands).
- [ ] Every existing Playwright suite passes.

Build + scheduler:

- [ ] `pnpm -F @a-conversa/shared-types build` succeeds (the type widening compiles cleanly).
- [ ] `pnpm -F @a-conversa/server build` succeeds (the projection-layer guard's TypeScript fix is the only consumer-side change).
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green; Vitest baseline rises by 9 (the seven new round-trip / negative cases + the two new bad-UUID rejection cases + the projection-layer guard regression).
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/10-data-and-methodology.tji` gets `complete 100` on `edge_target_annotation_schema_extension`.

Tech-debt registration:

- [ ] **`edges_table_polymorphic_endpoint_migration` (future task — ~0.5d).** DB migration widening the global `edges` table to mirror this schema change: `source_node_id` and `target_node_id` become nullable; `source_annotation_id` and `target_annotation_id` are added as nullable FKs to `annotations`; per-endpoint `CHECK ((source_node_id IS NOT NULL) <> (source_annotation_id IS NOT NULL))` constraints enforce the XOR at the DB layer (mirrors `0006_annotations.sql` L97). The UNIQUE constraint on `(role, source_node_id, target_node_id)` becomes a UNIQUE INDEX over the polymorphic endpoint tuple. Not load-bearing today (no `INSERT INTO edges` in production per repository grep) but the migration is the gate that lets a future production write path persist annotation-endpoint edges. Closer registers in WBS under `data_and_methodology.schema.*`.
- [ ] **`projection_edge_annotation_endpoint` (future task — ~1d).** Widens `ProjectedEdge` and `EdgeShape` to carry polymorphic endpoints (four-field shape mirroring the wire payload), updates `replay.ts`'s `handleEdgeCreated` and `Projection.addEdge`, lifts the projection-layer guard introduced by this task. Audits each diagnostic — `active_firing_computation`, `cycle_detection`, `dangling_claim_detection`, `coherency_hint_detection`, `multi_warrant_detection` — for "what is the right semantics for an annotation-endpoint edge?" (the conservative default: diagnostics that walk only the node-substance graph skip annotation endpoints; coherency-hint detection may want to surface them). Closer registers in WBS under `data_and_methodology.projection.*`.
- [ ] **`set_edge_substance_annotation_endpoint` (future task — ~0.5d).** Widens `setEdgeSubstanceProposalSchema`'s three optional endpoint fields and `captureNodeEdgeShapeSchema`'s four endpoint fields to allow annotation ids. Extends `validateSetEdgeSubstanceProposal` rule 2a/2b (the visibility checks at [`propose.ts:1254-1268`](../../../apps/server/src/methodology/handlers/propose.ts)) from `nodeIsVisible(...)` to a polymorphic `entityIsVisible(projection, 'node' | 'annotation', id)`. Closer registers in WBS under `data_and_methodology.methodology_engine.*`.
- [ ] **`walkthrough_e15_annotation_endpoint_refit` (future task — ~0.25d).** Refits E15 in the walkthrough fixture (`packages/test-fixtures/src/fixtures/walkthrough/events.json:3923-3938`) from `source_node_id: <N19>, target_node_id: <N6>` to `source_node_id: <N19>, target_annotation_id: <A2>`. Updates the meta.json identifier-mapping header noting E15 now targets A2 directly. Updates the affected `walkthrough-replay.feature` scenario assertions that read E15's target (the disputed-entities scenario at minimum). Sequenced AFTER `projection_edge_annotation_endpoint` lands (otherwise the projection's `handleEdgeCreated` guard rejects the refitted payload). Closer registers in WBS under `data_and_methodology.data_methodology_tests.*`.

## Decisions

- **D1 — Schema-only scope; downstream layers stay as-is and become named follow-ups.** Rationale:
  - **Effort fits the `.tji` 0.5d allocation.** The full chain — schema + DB migration + projection + methodology + UI + fixture refit — is realistically 2.5–3d of work across five distinct concerns. Bundling them defeats the WBS's effort-tracking accuracy and ties the schema landing to slower-moving consumers. The schema is the prerequisite gate; once it lands the four follow-ups can run in any order (and `walkthrough_e15_annotation_endpoint_refit` runs after `projection_edge_annotation_endpoint`).
  - **The schema is independently useful** even before the consumers catch up — it documents the intended shape, lets fixtures that test wire-level validation prove the XOR rejects malformed payloads, and serves as the contract the downstream tasks consume.
  - **Each follow-up has a single, well-scoped concern.** Splitting them this way also keeps the diagnostics-audit (the coherency-hint / cycle-detection / multi-warrant questions for annotation-endpoint edges) in `projection_edge_annotation_endpoint` where it belongs, not buried in a schema-change PR.
  - **Alternative considered: bundle everything into one task.** Rejected — 2.5–3d of work bundled as a 0.5d task corrodes the WBS's planning surface; the five concerns naturally split along the existing task-bucket boundaries (`event_types` vs. `schema` vs. `projection` vs. `methodology_engine` vs. `dm_e2e_tests`).
  - **Alternative considered: defer the schema and write the whole chain top-down from the UI gesture.** Rejected — the schema is the wire-level contract; ungated, the proposal-sub-kind / methodology-validator / projection / fixture work would each invent their own representation choices and then need to retrofit when the schema landed.

- **D2 — `.optional()` not `.nullable()` for the new (and now-demoted) endpoint fields.** Rationale:
  - **Backward-compat with existing payloads.** Today's `edge-created` envelopes carry `source_node_id: <uuid>` and `target_node_id: <uuid>` with no annotation fields. With `.nullable()`, Zod's strict parse would require the fields to be explicitly present as `null`; payloads omitting them would fail. With `.optional()`, the absent-field shape parses cleanly. The walkthrough fixture's 15 existing edge-created events (and every other edge-created event in the codebase) carry the today-shape and continue to validate without retrofit.
  - **The wire is JSON; absent and `null` are interchangeable at the API layer.** Zod treats them differently, and the practical choice is the one that doesn't force a wholesale fixture rewrite.
  - **The annotation precedent uses `.nullable()`** — its target columns are always explicitly present, one as `null` — but the annotation schema was authored at greenfield time with no pre-existing-shape constraint. The edge schema is post-greenfield: there are events on disk validating against today's shape, and any choice that breaks them is a regression in the migration story.
  - **Alternative considered: `.nullable().default(null)`.** Rejected — `default(null)` on parse doesn't backfill the absent field on stringify, so a round-trip would lose the explicitness the `.nullable()` mode is trying to preserve. The two modes (optional and nullable-with-default) produce different JSON shapes; mixing them is needless ambiguity.
  - **Alternative considered: keep node fields required, add annotation fields as `.optional()`, allow both-source-set / both-target-set so the annotation fields are an *extension* not a *replacement*.** Rejected — that produces a richer shape where `source_node_id` is always set and `source_annotation_id` is an optional sidecar; the read-side then has to define "which one is the real source?" The XOR encoding is cleaner because exactly one field is the source on every payload.

- **D3 — Four explicit fields (`source_node_id`, `source_annotation_id`, `target_node_id`, `target_annotation_id`), not a `source_kind`/`source_id` discriminator pair.** Rationale:
  - **Matches the annotation-created precedent** (which uses `target_node_id` / `target_edge_id` rather than `target_kind` / `target_id`). Single source of truth for the polymorphic-target encoding across the codebase.
  - **DB-layer alignment.** The annotation table's polymorphic FK is two nullable typed columns + CHECK. The future `edges`-table widening (`edges_table_polymorphic_endpoint_migration`) will mirror this pattern. Discriminator-plus-opaque-id would require either a CHECK constraint with a dynamic referent (which Postgres doesn't support) or losing DB-level FK integrity altogether.
  - **Read-side ergonomics.** Consumers that distinguish node-endpoint vs. annotation-endpoint behaviour (the coherency-hint diagnostic, the moderator UI's edge-target picker) read `payload.source_annotation_id !== undefined` — a direct field-presence check — rather than `payload.source_kind === 'annotation'` followed by an unsafe assumption about `payload.source_id`'s referent.
  - **Alternative considered: `source_kind: 'node' | 'annotation'` + `source_id: UUID`.** Rejected for the three reasons above.

- **D4 — Vitest, not Cucumber.** Rationale:
  - **The widening is a unit-level shape concern** (`safeParse` accepts / rejects per-field combinations). Cucumber's value is at the integration / DB-roundtrip layer; a Cucumber scenario for "the widened schema accepts the new shape" would be ceremony over a Zod-parse check.
  - **The existing `from-log.feature` baseline already covers the DB-roundtrip surface** for `edge-created` via the empty-fixture scenario; an event with the widened shape rides on the exact same JSONB plumbing. Any DB-layer regression would surface there.
  - **Vitest is the established precedent for this task layer.** `entity_creation_events` (the originating task) shipped its tests at `packages/shared-types/src/events.test.ts` — exactly the file extended here.
  - **Alternative considered: add a Cucumber scenario at `tests/behavior/projection/`.** Rejected — the widened schema's read-side consumers (projection) aren't widened in this task per D1; a Cucumber scenario asserting "the projection handles the widened payload" would need the projection layer to be widened first, which is the follow-up `projection_edge_annotation_endpoint`'s scope.

- **D5 — The TypeScript widening surfaces a build error at `replay.ts`'s `handleEdgeCreated` consumer; the fix is a guard (NOT a quiet narrowing to `as string`).** Rationale:
  - **Forcing-function for the follow-up.** A `ReplayError` thrown when the projection encounters an annotation-endpoint edge says, at the first runtime trial, "this projection doesn't handle annotation endpoints yet — see `projection_edge_annotation_endpoint`." The error message names the follow-up so the breadcrumb is in the failure mode itself.
  - **Honesty about the deferral.** A type cast (`payload.source_node_id as string`) would silently accept undefined-at-runtime and produce a `ProjectedEdge` with `sourceNodeId: undefined` that subtly poisons downstream computation. The throw says "this combination is rejected" loudly, where it belongs (at the projection seam, not later in active-firing).
  - **The guard's regression test is the smallest possible cover** — a single Vitest case at `replay.test.ts` that builds an `edge-created` payload with `target_annotation_id` set and asserts `handleEdgeCreated` throws with the expected breadcrumb message.
  - **Alternative considered: narrow the type with `as string`.** Rejected for the silent-corruption reason above.
  - **Alternative considered: leave `handleEdgeCreated` untouched and let the build break.** Rejected — a broken build blocks every subsequent task, including the four follow-ups; the guard is the minimum cost to unblock.

- **D6 — DB migration is OUT of scope and registered as `edges_table_polymorphic_endpoint_migration`.** Rationale:
  - **Not load-bearing today.** Repository grep for `INSERT INTO edges` in `apps/server/src` returns nothing — the global `edges` table is dormant in production. The schema widening at the wire level is consequence-free at the DB level because no production write path lands edge rows yet.
  - **Sequencing.** The DB migration logically rides on the projection-layer widening (because the future write path that mints edge rows lives downstream of the projection); migrating the table ahead of any consumer would land a schema change without a consumer, which is its own kind of debt.
  - **Mirrors the precedent.** `entity_creation_events` itself shipped only the Zod schemas; the DB-layer changes for `nodes` / `edges` / `annotations` rode on separate `schema.*` tasks. This task follows the same factoring.

- **D7 — Walkthrough fixture E15 refit is OUT of scope and registered as `walkthrough_e15_annotation_endpoint_refit`, sequenced after `projection_edge_annotation_endpoint`.** Rationale:
  - **The fixture's refitted payload would crash the projection's `handleEdgeCreated` guard (D5) until the projection layer is widened.** Sequencing the refit after the projection task keeps the walkthrough fixture green throughout the intermediate landings.
  - **The current E15 encoding works.** The walkthrough's `walkthrough-replay.feature` scenarios pass with the node-target workaround; refitting before the projection is ready would either need a parallel set of "annotation-endpoint" projection paths OR would break the established Cucumber baseline. Neither is desirable.
  - **The refit is small** (one event record update, possibly one meta.json comment line, possibly one scenario-line update). It's a clean follow-up to register, not work to interleave here.

## Open questions

(none — all decided in D1–D7.)

## Status

**Done** — 2026-05-30.

- Widened `edgeCreatedPayloadSchema` in `packages/shared-types/src/events.ts`: four `.optional()` endpoint fields (`source_node_id`, `source_annotation_id`, `target_node_id`, `target_annotation_id`) plus two per-endpoint `.refine()` XOR blocks; amended the entity-creation header docblock.
- Added 9 new Vitest cases in `packages/shared-types/src/events.test.ts` (+ `ANNOTATION_ID_2` constant): 3 round-trip cases (node→annotation E15 shape, annotation→node, annotation→annotation), 4 XOR rejection cases (both/neither × source/target), 2 bad-UUID rejection cases for the new annotation-id fields.
- Added defensive `ReplayError` guard in `apps/server/src/projection/replay.ts` at the top of `handleEdgeCreated`, rejecting annotation-endpoint payloads with a breadcrumb naming the follow-up `projection_edge_annotation_endpoint`.
- Added regression Vitest case in `apps/server/src/projection/replay.test.ts` covering the new guard.
- Added minimal `if (...) continue` narrowing at each `edge-created` consumer in `apps/moderator/src/graph/selectors.ts`, `apps/participant/src/graph/projectGraph.ts`, and `apps/audience/src/graph/projectGraph.ts` (build-only; projection guard makes these branches dead at runtime).
- Four tech-debt follow-ups registered in WBS: `edges_table_polymorphic_endpoint_migration`, `projection_edge_annotation_endpoint`, `set_edge_substance_annotation_endpoint`, `walkthrough_e15_annotation_endpoint_refit`.
