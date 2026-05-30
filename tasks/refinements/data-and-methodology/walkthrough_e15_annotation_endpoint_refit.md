# Refit E15 in the walkthrough fixture from node-target workaround to annotation-target

**TaskJuggler entry**: `data_and_methodology.data_methodology_tests.dm_e2e_tests.walkthrough_e15_annotation_endpoint_refit` — [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) (block at lines 560-572). Embedded note: *"Source of debt: edge_target_annotation_schema_extension — refits E15 in packages/test-fixtures/src/fixtures/walkthrough/events.json from source_node_id: <N19>, target_node_id: <N6> to source_node_id: <N19>, target_annotation_id: <A2>. Sequenced after projection_edge_annotation_endpoint lands (otherwise the projection guard rejects the refitted payload). Updates meta.json and any affected walkthrough-replay.feature scenario assertions that read E15's target."*

## Effort estimate

**0.25d** (per the `.tji` allocation). The work is a focused fixture refit at one event record plus matching test-surface updates:

- **`events.json` payload swap (~15min).** [`packages/test-fixtures/src/fixtures/walkthrough/events.json:3923-3938`](../../../packages/test-fixtures/src/fixtures/walkthrough/events.json) — the E15 `edge-created` record at sequence 264. Swap `target_node_id: "10000010-0000-4000-8000-000000000006"` (N6) for `target_annotation_id: "10000030-0000-4000-8000-000000000002"` (A2). `source_node_id` stays as N19. Per D2 the `target_node_id` key is removed entirely (NOT set to `null`) — the wire schema's `.optional()` shape per [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) treats absent and `undefined` equivalently, and the existing fixture style is "include keys that carry a value; omit keys that don't" (e.g. the existing `annotation-created` records at L3221-3247 omit unused endpoint keys).
- **`meta.json` description amendment (~5min).** [`packages/test-fixtures/src/fixtures/walkthrough/meta.json:3`](../../../packages/test-fixtures/src/fixtures/walkthrough/meta.json) — the description currently makes no statement about E15's encoding (it lists the UUID mapping range for edges generically). Add a clarifying sentence to the description noting "E15 is a contradicts edge from N19 (node) to A2 (annotation) — the canonical annotation-endpoint shape; this fixture is the first to exercise that shape end-to-end."
- **Cucumber feature pin (~15min).** [`tests/behavior/projection/walkthrough-replay.feature`](../../../tests/behavior/projection/walkthrough-replay.feature) — extend the existing `disputed entities at segment-1 close` scenario (L114-120) with an endpoint-shape assertion that pins the refit. Per D3 add two new Gherkin steps: `Then walkthrough edge E15 has source node N19` and `Then walkthrough edge E15 has target annotation A2`. The existing substance-status assertions stay unchanged (the refit is to the endpoints, not the substance facet).
- **Cucumber step definitions (~10min).** [`tests/behavior/steps/projection-walkthrough-replay.steps.ts`](../../../tests/behavior/steps/projection-walkthrough-replay.steps.ts) — two new step implementations reading `getEdge(edgeId).sourceNodeId` / `.targetAnnotationId` and asserting they equal the expected UUIDs. Mirrors the existing edge-facet-status step shape at L258-280.
- **Vitest tightening (~5min).** [`packages/test-fixtures/src/loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts) — the existing fixture-iteration `validateEvent` test (per `walkthrough_replay_e2e`'s Status block) already loops the events; the refit must continue to pass. No new case is required at this layer; the refitted payload's schema validity is a precondition the existing test pins. (Per D4 we do NOT add a separate Vitest case asserting "E15 carries `target_annotation_id`" — the schema-roundtrip cover at `events.test.ts:315-386` already pins the schema-level shape per `edge_target_annotation_schema_extension`'s acceptance, and the Cucumber endpoint-pin above is the at-scale cover.)

No new ADR. No DB migration. No new fixture file. No projection-layer or methodology-engine code change (the predecessor `projection_edge_annotation_endpoint` already widened those seams; this task exercises them through the canonical fixture).

## Inherited dependencies

**Settled:**

- [`data_and_methodology.projection.projection_edge_annotation_endpoint`](./projection_edge_annotation_endpoint.md) (done — 2026-05-30). This task's load-bearing blocker. Its Status block confirms: `EdgeShape` / `ProjectedEdge` / `NewEdgeInput` / `EdgeAddedChange` carry four polymorphic endpoint slots; `buildEdge` enforces XOR per endpoint; `handleEdgeCreated` no longer rejects annotation-endpoint payloads; the snapshot serializer ships the four fields; each diagnostic skips annotation-endpoint edges; the methodology validator defensively rejects them. The walkthrough fixture's refitted E15 payload now flows through `projectFromLog` without a guard rejection.
- [`data_and_methodology.event_types.edge_target_annotation_schema_extension`](./edge_target_annotation_schema_extension.md) (done — 2026-05-30). The wire schema accepts the polymorphic-endpoint shape; the fixture's refitted E15 record satisfies `validateEvent` end-to-end (per the schema's XOR `.refine()` block at [`packages/shared-types/src/events.ts:309-330`](../../../packages/shared-types/src/events.ts)).
- [`data_and_methodology.data_methodology_tests.dm_e2e_tests.walkthrough_replay_e2e`](./walkthrough_replay_e2e.md) (done — 2026-05-30). The fixture itself, the Cucumber feature, and the step library all exist. The E15 event record's UUID and surrounding sequence numbers are fixed; this task only mutates two payload key/value pairs at one record. The fixture-identifier mapping (N19 → `10000010-...-000000000019`, N6 → `10000010-...-000000000006`, A2 → `10000030-...-000000000002`, E15 → `10000020-...-000000000015`) is established in the fixture's `meta.json` description and the step file at L48 / L83 / L141 (annotation label lookup).
- [`data_and_methodology.projection.projection_data_structure`](./projection_data_structure.md) (done — `complete 100`). `Projection.getEdge(edgeId)` returns a `ProjectedEdge` carrying the four endpoint slots; the new Cucumber steps read these directly.
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md). The refitted E15 record validates through `validateEvent` on the JSONB → typed-Event boundary.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). The endpoint-shape pin ships as a Cucumber scenario assertion; no out-of-tree check.
- [ADR 0007 — Cucumber + pglite for behavior tests](../../../docs/adr/0007-test-framework-behavior.md). The walkthrough-replay feature's existing pglite-per-scenario harness is the cover layer.

**Pending:** (none — every load-bearing input is settled on `main`.)

## What this task is

Pay the last leg of the annotation-endpoint-edge debt by refitting the walkthrough fixture's E15 event from its node-target workaround (`target_node_id: N6`) to the canonical annotation-target encoding (`target_annotation_id: A2`) the predecessor schema and projection layers were widened to support.

Concretely the deliverable is:

1. **Fixture event refit** at [`packages/test-fixtures/src/fixtures/walkthrough/events.json:3929-3936`](../../../packages/test-fixtures/src/fixtures/walkthrough/events.json). The E15 `edge-created` record's payload changes from:
   ```json
   {
     "edge_id": "10000020-0000-4000-8000-000000000015",
     "role": "contradicts",
     "source_node_id": "10000010-0000-4000-8000-000000000019",
     "target_node_id": "10000010-0000-4000-8000-000000000006",
     "created_by": "...",
     "created_at": "..."
   }
   ```
   to:
   ```json
   {
     "edge_id": "10000020-0000-4000-8000-000000000015",
     "role": "contradicts",
     "source_node_id": "10000010-0000-4000-8000-000000000019",
     "target_annotation_id": "10000030-0000-4000-8000-000000000002",
     "created_by": "...",
     "created_at": "..."
   }
   ```
   `source_node_id` stays (N19 is genuinely a node — the workaround was on the target side). `target_node_id` is removed (per D2). `target_annotation_id` is added (A2). Sequence numbers, `id`, `session_id`, `actor`, `kind`, `created_at`, and the trailing `entity-included` at sequence 265 + `snapshot-created` at sequence 266 (with `log_position: 265`) all stay unchanged — the refit is payload-only.

2. **Fixture description amendment** at [`packages/test-fixtures/src/fixtures/walkthrough/meta.json:3`](../../../packages/test-fixtures/src/fixtures/walkthrough/meta.json). One added sentence to the description noting E15's canonical encoding (N19 contradicts A2 directly) and crediting the predecessor schema + projection widenings for unblocking it.

3. **Cucumber endpoint-shape pin** at [`tests/behavior/projection/walkthrough-replay.feature:114-120`](../../../tests/behavior/projection/walkthrough-replay.feature) (extending the `disputed entities at segment-1 close` scenario). Two new Gherkin `Then`/`And` lines pinning E15's source = N19 (node) AND target = A2 (annotation). The existing substance-status assertions stay unchanged; the comment block (L115-116) is updated to note the refit ("E15 is the canonical annotation-endpoint edge; the refit landed in `walkthrough_e15_annotation_endpoint_refit`").

4. **Cucumber step definitions** at [`tests/behavior/steps/projection-walkthrough-replay.steps.ts`](../../../tests/behavior/steps/projection-walkthrough-replay.steps.ts). Two new `Then`-bound step implementations:
   - `walkthrough edge {word} has source node {word}` — reads `getEdge(edgeId).sourceNodeId` against the expected node UUID, asserts equality AND asserts `sourceAnnotationId === null`.
   - `walkthrough edge {word} has target annotation {word}` — reads `getEdge(edgeId).targetAnnotationId` against the expected annotation UUID (via the existing `walkthroughAnnotationId(label)` lookup at L141), asserts equality AND asserts `targetNodeId === null`.

Out of scope (each registered as a named follow-up where load-bearing, or already named by the predecessor):

- `edges_table_polymorphic_endpoint_migration` (DB migration; predecessor-named in `edge_target_annotation_schema_extension`).
- `set_edge_substance_annotation_endpoint` (proposal-side widening; predecessor-named in `edge_target_annotation_schema_extension`).
- `mod_render_annotation_endpoint_edges` / `part_render_annotation_endpoint_edges` / `aud_render_annotation_endpoint_edges` (UI canvases; named in `projection_edge_annotation_endpoint`; `aud_render_annotation_endpoint_edges` already shipped on `main` per the recent commit log).

## Why it needs to be done

**The canonical narrative finally gets a canonical encoding.** [`docs/example-walkthrough.md`](../../../docs/example-walkthrough.md) turn 21 names E15 as "N19 contradicts A2" — Ben's crux directly contradicting Anna's annotation-as-reframe. The fixture today encodes this as `N19 → contradicts → N6` (the node A2 annotates) because the schema + projection layers were narrower than the doc demanded. Both layers have since been widened; without this refit the canonical fixture continues to embed a workaround that misrepresents the load-bearing narrative.

**The walkthrough is the canonical "substantial debate" fixture for downstream tests.** Per [`seed_data_for_tests.md`](./seed_data_for_tests.md)'s pin "the walkthrough fixture is canonical — every other test that needs 'a substantial debate' uses this one," any downstream consumer (replay-at-position queries, audience-broadcast scenarios at scale, projection-invariants property-based cover) reads E15's shape as part of the "real debate" baseline. Keeping E15 on the workaround means every downstream consumer inherits an encoding that doesn't match the documented narrative — and any future test that asserts "edge E15 targets annotation A2" would fail today's fixture for the wrong reason (the encoding, not the underlying behaviour).

**The annotation-endpoint-edge plumbing now has its end-to-end exercise.** The predecessor `projection_edge_annotation_endpoint` shipped Vitest deltas for the four endpoint-shape permutations + a Cucumber scenario in `from-log.feature` ("annotation-endpoint edge round-trips through projectFromLog"). Those pin the plumbing in isolation; the walkthrough refit exercises the same plumbing inside a 266-event canonical debate where E15 must coexist with N1–N19, E1–E14, A1–A3, and the snapshot. That at-scale composition catches integration bugs the per-unit covers can't (the most plausible being: the snapshot serializer emits the four endpoint fields on E15, the audience canvas (now reachable) renders the contradicts-edge to A2 correctly, future cache-invalidation logic doesn't accidentally key the edge on `sourceNodeId + targetNodeId` only).

**The Status-block-deferral pointer from `edge_target_annotation_schema_extension` (line 156) and `projection_edge_annotation_endpoint` (Status block) both explicitly name this task as the closing step.** Until this lands, the predecessor refinements' Status blocks carry an unsettled "the canonical fixture still encodes the workaround" footnote.

## Inputs / context

**Design contract:**

- [`docs/example-walkthrough.md`](../../../docs/example-walkthrough.md) — turn 21 names E15: "Ben commits N19 (Captivity contradicts welfare science) AND attaches it via a `contradicts` edge to A2 (Anna's reframe annotation)." The canonical narrative this refit honors.
- [`docs/data-model.md`](../../../docs/data-model.md) L114-122 — the edge-role vocabulary including `contradicts`. The role is unchanged by the refit.

**Architectural / engineering inputs:**

- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md). The refitted payload validates through `validateEvent`'s polymorphic-endpoint XOR `.refine()` block.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). The endpoint-shape pin ships as committed Cucumber.
- [ADR 0007 — Cucumber + pglite for behavior tests](../../../docs/adr/0007-test-framework-behavior.md). The walkthrough-replay feature is the cover layer.

**Runtime inputs (real file references the implementer reads + edits):**

- [`packages/test-fixtures/src/fixtures/walkthrough/events.json:3923-3938`](../../../packages/test-fixtures/src/fixtures/walkthrough/events.json) — the E15 `edge-created` record at sequence 264. The two-key payload swap described above.
- [`packages/test-fixtures/src/fixtures/walkthrough/events.json:3953-3964`](../../../packages/test-fixtures/src/fixtures/walkthrough/events.json) — the trailing `snapshot-created` event at sequence 266 with `log_position: 265`. **Unchanged** — sequence numbers and log_position stay; the refit is to E15's payload only.
- [`packages/test-fixtures/src/fixtures/walkthrough/meta.json:3`](../../../packages/test-fixtures/src/fixtures/walkthrough/meta.json) — description string. One sentence added.
- [`packages/shared-types/src/events.ts:309-330`](../../../packages/shared-types/src/events.ts) — `edgeCreatedPayloadSchema`. The XOR `.refine()` for each endpoint enforces "exactly one of `target_node_id` / `target_annotation_id` is set"; the refitted payload satisfies this with `target_annotation_id` set and `target_node_id` absent (per D2 the omitted-vs-explicit-null choice is "omit" — `.optional()` accepts absence directly).
- [`apps/server/src/projection/replay.ts:202-236`](../../../apps/server/src/projection/replay.ts) `handleEdgeCreated` — **unchanged**; the predecessor widened it to thread polymorphic endpoints into `addEdge` and `EdgeAddedChange`. The refitted payload flows through without a guard rejection.
- [`apps/server/src/projection/projection.ts:71-94, 227-251`](../../../apps/server/src/projection/projection.ts) `buildEdge` / `addEdge` / `removeEdge` — **unchanged**; the predecessor widened them. The refitted edge enters the `#edgesBySource` index under N19's UUID (source) and `#edgesByTarget` under A2's UUID (target — mixed-keys precedent established in predecessor's D2).
- [`tests/behavior/projection/walkthrough-replay.feature:114-120`](../../../tests/behavior/projection/walkthrough-replay.feature) — the `disputed entities at segment-1 close` scenario. Two new endpoint-shape lines added; existing substance-status assertions stay.
- [`tests/behavior/steps/projection-walkthrough-replay.steps.ts:48, 83, 141, 258-280`](../../../tests/behavior/steps/projection-walkthrough-replay.steps.ts) — N6 / E15 UUID constants (L48, L83), annotation-label lookup (L141), edge-facet-status step shape (L258-280) the new steps mirror.
- [`packages/test-fixtures/src/loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts) — the existing fixture-iteration `validateEvent` Vitest case (4 cases per `walkthrough_replay_e2e`'s Status block). The refitted payload must continue to pass; no new case required at this layer per D4.

## Constraints / requirements

- **One event record changes; sequences and IDs stay.** Per the schema, E15's `edge_id` UUID is preserved (the entity identity is unchanged — only the target endpoint shape changes). The surrounding `entity-included` (sequence 265) and `snapshot-created` (sequence 266 with `log_position: 265`) records are unchanged. The total event count stays at 266.
- **`target_node_id` key is removed, not set to `null`.** Per D2 the fixture style across the existing `annotation-created` records is "omit the unused endpoint key"; the wire schema's `.optional()` permits this. Setting `target_node_id: null` would still validate against the XOR (`.refine()` accepts `undefined` and rejects values), but mixing styles is noise.
- **`source_node_id` stays as N19.** The workaround was solely on the target side; N19 is genuinely a node. The refit is asymmetric per the walkthrough's narrative (a node contradicts an annotation, not annotation-to-annotation).
- **Per-edge substance facet status stays unchanged after refit.** E15's substance was never proposed or committed in the walkthrough's narrative; the refitted edge's substance facet remains non-`'committed'`. The existing `disputed entities at segment-1 close` scenario's assertion `walkthrough edge E15 substance facet is not "committed"` continues to pass.
- **Edge count stays at 17.** The full-walkthrough scenario asserts `the walkthrough projection has 17 edges`; this stays — the refit changes E15's endpoints, not its existence.
- **Diagnostics continue to skip E15.** Per `projection_edge_annotation_endpoint`'s D4 each diagnostic that walks the node-substance subgraph skips edges with null endpoints. After refit, E15 has `targetNodeId === null` — so cycle / coherency-hint / multi-warrant / dangling-claim / pending-consequences detection each skip it (which they did before too: E15's substance was never committed, so most diagnostics didn't surface findings on it pre-refit either). No diagnostic-output drift is expected.
- **Active-firing on E15 is undefined.** Per the predecessor's D4, `isEdgeActive` throws on annotation-endpoint edges. E15 is not in the active-firing test path (its substance is never committed; `isEdgeActive` is only invoked on committed-substance edges per `active-firing.ts`). No change in observable behaviour. The walkthrough-replay feature does not call `isEdgeActive` on E15.
- **The audience canvas renders the refitted edge per the recently-landed `aud_render_annotation_endpoint_edges`.** Per the recent `main` commit `2ab7c77 audience.aud_render_annotation_endpoint_edges: render annotation-endpoint edges on audience Cytoscape canvas`, the audience canvas is now the first UI to render annotation-endpoint edges. The refit makes E15 the first canonical example of this rendering inside the walkthrough fixture. The moderator and participant canvases still skip annotation-endpoint edges per their respective future tasks (`mod_render_annotation_endpoint_edges`, `part_render_annotation_endpoint_edges`).
- **Test discipline per ADR 0022.** The endpoint-shape pin lives in the Cucumber scenario; no out-of-tree verification.
- **No new ADR.** Every architectural input is settled.
- **No new Playwright cover in this task.** Per the refinements README test-layer policy this task is under `data_and_methodology.*` (backend / fixture); the audience canvas's rendering of annotation-endpoint edges is covered by `aud_render_annotation_endpoint_edges`'s own Playwright spec on `main`. Per D5 we do NOT add a walkthrough-level Playwright spec here — the audience canvas's Playwright cover is shape-level (does it render at all?), and a walkthrough-driven Playwright spec asserting "E15 contradicts A2 visually" would be downstream of the audience-broadcast story which has its own scope.

## Acceptance criteria

**Pinned per ADR 0022 — every empirical check ships as committed Cucumber.** Per D3 / D4 the test layers are existing Cucumber (extended) + existing Vitest (transitively re-runs `validateEvent` over the refitted fixture). Per the refinements README test-layer policy this is a `data_and_methodology.*` task; no new Playwright cover (per D5).

Fixture refit:

- [ ] [`packages/test-fixtures/src/fixtures/walkthrough/events.json:3929-3936`](../../../packages/test-fixtures/src/fixtures/walkthrough/events.json) — E15's `edge-created` payload has `source_node_id: "10000010-0000-4000-8000-000000000019"`, `target_annotation_id: "10000030-0000-4000-8000-000000000002"`, NO `target_node_id` key. `edge_id`, `role: "contradicts"`, `created_by`, `created_at`, and the surrounding record fields (`id`, `session_id`, `sequence: 264`, `kind`, `actor`) are unchanged.
- [ ] [`packages/test-fixtures/src/fixtures/walkthrough/events.json:3953-3964`](../../../packages/test-fixtures/src/fixtures/walkthrough/events.json) — `snapshot-created` at sequence 266 with `log_position: 265` is unchanged.
- [ ] Total event count stays 266; no records added or removed.
- [ ] [`packages/test-fixtures/src/fixtures/walkthrough/meta.json:3`](../../../packages/test-fixtures/src/fixtures/walkthrough/meta.json) — description string gains a sentence noting E15's canonical annotation-endpoint encoding (concise; one sentence; references A2 and `contradicts`).

Cucumber feature pin:

- [ ] [`tests/behavior/projection/walkthrough-replay.feature:114-120`](../../../tests/behavior/projection/walkthrough-replay.feature) `disputed entities at segment-1 close` scenario gains two new lines:
  - `And walkthrough edge E15 has source node N19`
  - `And walkthrough edge E15 has target annotation A2`
- [ ] The scenario's comment block is updated noting the refit (L115-116).
- [ ] The existing scenario assertions (L118-120) stay unchanged.
- [ ] The other four scenarios stay unchanged.

Cucumber step definitions:

- [ ] [`tests/behavior/steps/projection-walkthrough-replay.steps.ts`](../../../tests/behavior/steps/projection-walkthrough-replay.steps.ts) — new step `walkthrough edge {word} has source node {word}` reads `getEdge(edgeId).sourceNodeId` and `.sourceAnnotationId`, asserts the former equals the expected node UUID AND the latter is `null`.
- [ ] [`tests/behavior/steps/projection-walkthrough-replay.steps.ts`](../../../tests/behavior/steps/projection-walkthrough-replay.steps.ts) — new step `walkthrough edge {word} has target annotation {word}` reads `getEdge(edgeId).targetAnnotationId` and `.targetNodeId`, asserts the former equals the expected annotation UUID AND the latter is `null`.

Existing tests stay green:

- [ ] Every existing Vitest suite passes — including [`packages/test-fixtures/src/loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts)'s `validateEvent`-over-walkthrough-fixture case, which now iterates the refitted record and continues to pass (the schema accepts the annotation-endpoint shape per `edge_target_annotation_schema_extension`).
- [ ] Every existing Cucumber feature passes — including `walkthrough-replay.feature`'s other four scenarios (the refit changes one event's endpoint, not any substance / classification / axiom-mark / snapshot behaviour the scenarios assert on).
- [ ] Every existing Playwright suite passes — including the audience canvas's annotation-endpoint-edge rendering spec landed by `aud_render_annotation_endpoint_edges`; the canvas now sees a canonical annotation-endpoint edge from the walkthrough fixture (if any of its specs use the walkthrough fixture as a state seed) and continues to render it without a regression.

Build + scheduler:

- [ ] `pnpm -F @a-conversa/test-fixtures build` succeeds.
- [ ] `pnpm -F @a-conversa/server build` succeeds.
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green; Vitest baseline unchanged (the fixture-iteration test runs the same case shape); Cucumber baseline unchanged (the two new `And` lines extend an existing scenario; scenario count stays 5).
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/10-data-and-methodology.tji` gets `complete 100` on `walkthrough_e15_annotation_endpoint_refit`.

Tech-debt registration:

- [ ] **(none new from this task.)** Every annotation-endpoint-edge follow-up is already named by the predecessor refinements:
  - `edges_table_polymorphic_endpoint_migration` — named in `edge_target_annotation_schema_extension` Status block.
  - `set_edge_substance_annotation_endpoint` — named in `edge_target_annotation_schema_extension` Status block.
  - `mod_render_annotation_endpoint_edges` — named in `projection_edge_annotation_endpoint` Acceptance criteria.
  - `part_render_annotation_endpoint_edges` — named in `projection_edge_annotation_endpoint` Acceptance criteria.
  - `aud_render_annotation_endpoint_edges` — shipped on `main` (commit `2ab7c77`).
  - `diagnostics_annotation_endpoint_semantics_audit` — named in `projection_edge_annotation_endpoint` Acceptance criteria.

  The closer of this task verifies these remain registered (or marked done where appropriate) but does NOT re-register them here.

## Decisions

- **D1 — One-record payload refit; do NOT broaden the fixture to include additional annotation-endpoint edges.** Rationale:
  - **The task's scope is precisely the E15 workaround.** The `.tji` embedded note names a single record (`E15` at the specific payload shape). Adding more annotation-endpoint edges would shift the fixture's narrative away from `docs/example-walkthrough.md`'s 22-turn debate.
  - **The walkthrough doesn't have other annotation-endpoint edges.** Per the coda, E15 is the unique annotation-endpoint edge in the canonical narrative. Inventing additional ones would introduce events the doc doesn't cover.
  - **Other annotation-endpoint-edge coverage already exists.** `projection_edge_annotation_endpoint`'s Vitest deltas cover the four endpoint-shape permutations (node-source + annotation-target; annotation-source + node-target; annotation-source + annotation-target; node-source + node-target as the baseline). The walkthrough is the at-scale composition cover, not the per-shape unit cover.
  - **Alternative considered: also widen E11a / E11b (the interpretive-split rebut edges) to annotation endpoints.** Rejected — the walkthrough narrative encodes them as node-to-node rebuts (N16 rebuts N11, N17 rebuts N11); they aren't annotation-endpoint edges in the doc.

- **D2 — Omit `target_node_id` from the refitted payload (NOT set it to `null`).** Rationale:
  - **The wire schema's shape is `.optional()` per the predecessor's D2.** Per [`packages/shared-types/src/events.ts:309-330`](../../../packages/shared-types/src/events.ts) each endpoint field is `z.string().uuid().optional()`. The XOR `.refine()` reads "exactly one of `target_node_id` / `target_annotation_id` is `!== undefined`"; the wire shape doesn't include `null` as a valid value for these fields.
  - **The existing fixture style is "omit unused endpoint keys."** Per the existing `annotation-created` records at [`events.json:3221-3247`](../../../packages/test-fixtures/src/fixtures/walkthrough/events.json) the target-edge fields are omitted when target-node is set; same pattern.
  - **Diff readability.** Replacing one key with another (target_node_id → target_annotation_id) is a clearer diff than keeping target_node_id explicitly-`null` alongside a new target_annotation_id.
  - **Alternative considered: explicit `target_node_id: null` plus `target_annotation_id: "..."`.** Rejected — would require the schema's `.optional()` to accept `null` (it does not; the schema uses `.optional()` not `.nullable()`); even if it did, the redundancy is noise.

- **D3 — Extend the existing `disputed entities at segment-1 close` scenario rather than add a sixth scenario.** Rationale:
  - **E15's disputed-status is what the scenario already covers.** The scenario at L114-120 already asserts E15's non-committed substance facet; pinning its endpoint shape in the same scenario keeps "everything we know about E15" co-located.
  - **Per `walkthrough_replay_e2e` D5 the five scenarios are organized by distinct contracts.** Adding a sixth scenario solely for "E15 has the annotation-endpoint shape" is below the threshold for a distinct contract; the disputed-entities scenario already carries the load.
  - **Single fixture load per scenario.** Adding two `And` lines doesn't trigger a second fixture load (Cucumber runs scenarios in isolation; assertions within a scenario share the same projection).
  - **Alternative considered: add a sixth scenario "E15 has the canonical annotation-endpoint shape."** Rejected — adds a fifth fixture load for two assertions; the existing scenario can carry them.
  - **Alternative considered: extend the full-walkthrough scenario (Scenario 1) instead.** Rejected — that scenario's role is "the coda checklist as a flat sequence"; the endpoint-shape pin is a structural assertion about an entity the coda mentions as "live / disputed," so it fits the disputed-entities scenario more naturally.

- **D4 — No new Vitest case in `loader.test.ts` solely for the refitted payload.** Rationale:
  - **The existing fixture-iteration `validateEvent` case already covers the refit transitively.** Per `walkthrough_replay_e2e`'s Status block (line 237) `loader.test.ts` already iterates the walkthrough fixture's events through `validateEvent`; after the refit the same iteration validates the polymorphic-endpoint payload, which `edge_target_annotation_schema_extension`'s schema accepts.
  - **The per-shape schema cover lives at `events.test.ts:315-386`** per the predecessor refinement (`edge_target_annotation_schema_extension`'s acceptance criteria). Duplicating "the schema accepts node-source + annotation-target" at `loader.test.ts` adds nothing.
  - **The Cucumber endpoint-shape pin is the at-scale cover.** It exercises the same payload going through `projectFromLog` and inspecting `getEdge(E15)`'s in-memory shape — strictly more than a Vitest-side schema parse.
  - **Alternative considered: add a Vitest case asserting `events.json` contains an `edge-created` record at sequence 264 with `target_annotation_id` set.** Rejected — pins the fixture, not the projection; the Cucumber assertion pins the integrated behaviour, which is what regressions would surface as.

- **D5 — No new Playwright cover.** Rationale:
  - **This task is under `data_and_methodology.*` (backend / fixture).** Per the refinements README test-layer policy, UI-stream e2e applies to tasks under `moderator_ui.*` / `participant_ui.*` / `audience.*` / `replay_test.*`, not here.
  - **The audience canvas already has Playwright cover** per `aud_render_annotation_endpoint_edges` (shipped on `main`). That spec is shape-level (does the canvas render an annotation-endpoint edge at all?); the walkthrough-fixture-driven view ("does E15 render as N19 → A2 specifically?") is a downstream concern of audience-broadcast tasks, not this refit.
  - **The moderator and participant canvases still skip annotation-endpoint edges** per their respective future tasks; no Playwright change is appropriate at those layers for this refit.
  - **Alternative considered: add a Playwright spec asserting E15 renders on the audience canvas with the walkthrough fixture as state seed.** Rejected — that's the audience-broadcast story's scope, not this refit's; the audience-canvas-renders-annotation-endpoint-edges spec on `main` already pins the rendering behaviour.

## Open questions

(none — all decided in D1–D5.)

## Status

**Done** — 2026-05-30.

- Refitted E15 `edge-created` payload in `packages/test-fixtures/src/fixtures/walkthrough/events.json` (sequence 264): replaced `target_node_id: N6` with `target_annotation_id: A2`; removed `target_node_id` key entirely per D2.
- Amended `packages/test-fixtures/src/fixtures/walkthrough/meta.json`: added one sentence to the description noting E15 is the canonical annotation-endpoint edge (N19 contradicts A2 directly).
- Extended the `disputed entities at segment-1 close` scenario in `tests/behavior/projection/walkthrough-replay.feature` with two new `And` lines pinning E15's polymorphic-endpoint shape, plus a comment update noting the refit.
- Added two new `Then` step definitions in `tests/behavior/steps/projection-walkthrough-replay.steps.ts`: `walkthrough edge {word} has source node {word}` (asserts `sourceNodeId` equals expected UUID and `sourceAnnotationId === null`) and `walkthrough edge {word} has target annotation {word}` (asserts `targetAnnotationId` equals expected UUID and `targetNodeId === null`).
- All existing Vitest, Cucumber, and Playwright suites stayed green; the fixture-iteration `validateEvent` test continues to pass over the refitted payload.
- No new tech-debt tasks: every annotation-endpoint follow-up is already named by predecessor refinements (`edges_table_polymorphic_endpoint_migration`, `set_edge_substance_annotation_endpoint`, `mod_render_annotation_endpoint_edges`, `part_render_annotation_endpoint_edges`, `diagnostics_annotation_endpoint_semantics_audit`); `aud_render_annotation_endpoint_edges` already shipped on `main` (commit `2ab7c77`).
