# Coherency hint: annotation-of-annotation chain depth ≥ 2

**TaskJuggler entry**: `data_and_methodology.diagnostics.coherency_annotation_of_annotation_chain_rule` — [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) (block at lines 325–335). Embedded note: *"Source of debt: diagnostics_annotation_endpoint_semantics_audit D3. Candidate coherency-hint rule: annotation → role → annotation chains of depth ≥ 2. Conditional on docs/methodology.md enumerating the pattern as a named coherency hint. Includes Vitest cover; no Cucumber delta."*

## Effort estimate

**0.5d** (per the `.tji` allocation). Breakdown:

- **Methodology-doc edit (~1h).** Add one short paragraph to `docs/methodology.md`'s coherency-hint catalogue naming the annotation-of-annotation chain pattern. Per D1 below, the doc-citation grounding is bundled into this task because the candidate rule was registered with "conditional on methodology-doc enumeration" — the cleanest discharge is to write the citation here.
- **Rule implementation (~1h).** One new rule function in `apps/server/src/diagnostics/coherency-hint-detection.ts`, one new variant on `HintKind`, one new variant interface, one append to the `RULES` registry, three exports on the barrel.
- **Vitest cover (~1.5h).** Six cases spanning chain depths 1 (negative), 2 (positive), 3 (positive — emits per second-or-later hop), self-loops within the chain, mixed node/annotation chains (only the annotation-only segment counts), invisibility (broken segment splits the chain).
- **WBS housekeeping (~0.5h).** Closer's responsibility — `complete 100` on `coherency_annotation_of_annotation_chain_rule` and the `note "Refinement: ..."` line.

No Cucumber delta (per D4 — the rule is unit-observable, and the round-trip-through-JSONB shape for annotation-endpoint edges is already pinned by the predecessor `projection_edge_annotation_endpoint`'s `from-log.feature` scenario). No ADR (per D5 — adds a single advisory rule under an established detector seam). No DB migration. No projection-layer change. No UI consumer change in this task (the moderator-UI surfacing of annotation-endpoint edges is a separate already-named follow-up under `mod_render_annotation_endpoint_edges`).

## Inherited dependencies

**Settled:**

- [`data_and_methodology.diagnostics.diagnostics_annotation_endpoint_semantics_audit`](./diagnostics_annotation_endpoint_semantics_audit.md) (done — 2026-05-30). The direct parent: its D3 named *both* this rule and `coherency_self_referential_annotation_contradicts_rule` as candidate-future annotation-endpoint coherency rules, conditional on methodology-doc enumeration. The audit's Tech-debt registration scoped this task as ~0.5d with explicit "includes Vitest cover; no Cucumber" framing.
- [`data_and_methodology.diagnostics.coherency_hint_detection`](./coherency_hint_detection.md) (done — 2026-05-10). The detector this rule plugs into. Its rule-registry composition (`RULES: ReadonlyArray<(p: Projection) => CoherencyHint[]>` reduced via `flatMap`) is the extension seam this task uses; the audit confirmed that seam is the right place for annotation-endpoint coherency rules.
- [`data_and_methodology.projection.projection_edge_annotation_endpoint`](./projection_edge_annotation_endpoint.md) (done — 2026-05-30). Widened `ProjectedEdge` to polymorphic endpoints (`sourceNodeId | sourceAnnotationId`, symmetric target pair) and made the polymorphic `getEdgesBySource(key)` / `getEdgesByTarget(key)` accept either a node ID or an annotation ID. Without this widening, `annotation → role → annotation` edges weren't structurally representable on the projection at all; with it, the rule can walk them through the existing graph helpers.
- [`data_and_methodology.event_types.edge_target_annotation_schema_extension`](./edge_target_annotation_schema_extension.md) (done — 2026-05-30). The wire-schema widening upstream — `edge-created` events can carry annotation endpoints.
- [`data_and_methodology.methodology_engine.set_edge_substance_annotation_endpoint`](./set_edge_substance_annotation_endpoint.md) (done). Widened the substance-set proposal validator for polymorphic annotation endpoints.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). The rule ships as committed Vitest cases pinning both the positive (hint emits) and negative (no hint) shapes.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md). The annotation-of-annotation chain detection is purely entity-layer — no facet read; the rule fires regardless of substance-agreement state.

**Pending:** (none — every load-bearing predecessor is on `main` at task start.)

## What this task is

Add a new **advisory coherency-hint rule** — `annotation-of-annotation-chain` — to the existing `coherency-hint-detection.ts` detector. The rule walks the projection and emits one hint per edge that participates as the **second or later hop** in a chain of `annotation → role → annotation` edges.

Structurally: an edge `E` with `sourceAnnotationId != null` and `targetAnnotationId != null` is an "annotation-to-annotation edge". The rule emits a hint for `E` when there exists another visible `annotation-to-annotation` edge `E'` whose target is `E`'s source annotation — i.e., the chain reaches depth ≥ 2 at `E`. The first hop of any chain (an `annotation → annotation` edge whose source has no annotation-incoming) emits no hint; chains of depth ≥ 2 emit exactly one hint per second-or-later hop.

The rule is structural-only and advisory. It does not read substance facets, does not depend on agreement state, and does not block any user action. The hint payload identifies the edge, both annotation endpoints, and the incoming-annotation edge that established the chain — enough for a moderator UI to highlight the smell pattern and let the participants choose how to resolve it (typically by withdrawing the deeper annotations and re-landing the discussion as a substance edit).

Bundled into this task: a one-paragraph addition to `docs/methodology.md`'s coherency-hint catalogue enumerating the pattern (per D1 below). Without that citation, the rule would have no methodology grounding — a violation of the established "every structural diagnostic cites a methodology rule" convention that the parent audit pinned.

Out of scope:

- **Implementing `coherency_self_referential_annotation_contradicts_rule`.** That's the sibling task carved out by the audit's D3 alongside this one. Different methodology citation, different rule shape, different payload. Each rule gets its own task, refinement, methodology-citation, and review pass per the parent audit's decision-isolation pattern.
- **Moderator-UI surfacing of coherency hints over annotation-endpoint edges.** `mod_render_annotation_endpoint_edges` (already named by the predecessor audit) is the UI hook task. This task delivers detector output; UI consumption is downstream.
- **Annotation-of-annotation entity support.** Annotations themselves still target only nodes or edges (per `docs/data-model.md` line 236 — `annotation-created` payload's `target-entity-id` is node-or-edge). The chains this rule detects are over EDGE endpoints (an edge whose endpoints are annotations) — not over annotation-anchor recursion. No entity-schema change.
- **A node-included variant** (e.g., `annotation → node → annotation`). Per D2 the rule looks at *contiguous* annotation-to-annotation hops only — a node in the middle of the path breaks the chain because the methodology smell is "the discussion has migrated off the substance graph", and a node in the chain is *on* the substance graph.

## Why it needs to be done

**The audit named this candidate rule with a concrete methodology citation framework in place.** The parent `diagnostics_annotation_endpoint_semantics_audit` D3 identified annotation-of-annotation chains of depth ≥ 2 as one of two annotation-endpoint coherency patterns the existing detector's rule registry should grow to surface. The audit deliberately did NOT implement the rule — that's this task's role.

**The smell is real and structurally detectable today.** Now that `ProjectedEdge` carries polymorphic endpoints, a participant *can* land an edge whose source is annotation `A` and target is annotation `B`. A single such edge is defensible (one annotation comments on another). A chain of length ≥ 2 (A → B → C, or longer) is a signal that the participants have stopped engaging with the substance graph and are arguing about their own metadata. The methodology's stance is that metadata layers exist to ground substance discussions, not to host their own multi-step debates — when annotation chains deepen, the resolution is usually to withdraw the deep-chain annotations and re-land the discussion at the substance level the metadata was originally pointing at.

**Without this rule, the configuration is silently invisible to the moderator.** Cycle detection skips annotation-endpoint edges (per audit D1). Multi-warrant detection skips them (per audit D4). The existing coherency-hint rules are node-node (per audit D3 — the v1 rules deliberately don't address annotation-endpoint patterns). A chain like `A → supports → B → supports → C` over three annotations would fire NO diagnostic today, and the moderator has no surface in the system to spot it. This task closes that gap for one specific, doc-enumerable shape.

**The walkthrough's E15 refit is the latent stress test.** Once the walkthrough fixture carries annotation-endpoint edges (per `walkthrough_e15_annotation_endpoint_refit`, already named by the predecessor audit), the diagnostic surface against the fixture is observable. This rule's behaviour on the walkthrough — emit on annotation chains, ignore single-hop annotation→annotation edges — is part of the fixture's documented baseline.

## Inputs / context

**Design contract (doc-citation; the methodology-doc edit IS this task's deliverable, per D1):**

- [`docs/methodology.md`](../../../docs/methodology.md) lines 228–234 — advisory-diagnostics enumeration. Currently lists multi-warrant, dangling-claim, and coherency-hints generically. This task adds one paragraph extending the coherency-hint catalogue to name the annotation-of-annotation chain pattern; the new entry cites `docs/data-model.md`'s annotation system and the structural definition of "chain depth ≥ 2".
- [`docs/data-model.md`](../../../docs/data-model.md) lines 137–143 — annotations defined as first-class entities with their own facet set; "an annotation can itself be disputed, decomposed, or retracted". Establishes that annotations are entity-layer first-class, justifying that an edge with annotation endpoints is structurally well-defined.
- [`docs/data-model.md`](../../../docs/data-model.md) lines 145–153 ("Coherency guidance") — the framing the rule lands under. "Some edge/node configurations are typical; others are unusual… The list will grow with experience. The system never blocks; it nudges." This task grows the list by one entry on both the docs side and the detector side.
- [`docs/data-model.md`](../../../docs/data-model.md) lines 197–199 ("Coherency violations") — advisory, not blocking. The new rule lands as advisory per the established `blocking_vs_advisory_classification`.
- [`docs/data-model.md`](../../../docs/data-model.md) line 236 — `annotation-created` payload constrains `target-entity-id` to node-or-edge. The rule does NOT depend on annotations targeting annotations (that's about anchor) — it depends only on edges' endpoint polymorphism, which is already settled.

**Architectural / engineering inputs:**

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). Vitest cover pins the rule's positive and negative behaviour.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md). The rule is entity-layer: it walks edges and annotations by ID; it does not read substance or wording facets.

**Runtime inputs (real file references the implementer reads + edits):**

- [`apps/server/src/diagnostics/coherency-hint-detection.ts`](../../../apps/server/src/diagnostics/coherency-hint-detection.ts):
  - L58–78 — top-of-file docblock paragraph naming this rule (added by the parent audit). The rule's landing closes that pre-named slot; the docblock should be updated to reflect "v1: skip → v1.1: rule landed".
  - L112–115 — `HintKind` string-literal union. Adds the new discriminator value.
  - L126–166 — per-rule hint interfaces. Adds the new variant interface.
  - L327–331 — `RULES` registry. Appends the new rule function.
- [`apps/server/src/diagnostics/coherency-hint-detection.test.ts`](../../../apps/server/src/diagnostics/coherency-hint-detection.test.ts):
  - L43–176 — helper functions (`seedSession`, `createNode`, `createEdge`). Per D6 the test file adds a new helper `createAnnotation(projection, annId, anchor)` and a thin `createAnnotationEdge(projection, edgeId, srcAnn, tgtAnn, role)` for annotation-to-annotation edges (alternative considered: inline the events per case; rejected — the helper is reused 6× and the pattern is already established in the file's existing annotation-endpoint section).
  - L411–546 — existing annotation-endpoint test section (added by the parent audit's broadened pins). The new positive cases for this rule sit in a new "annotation-of-annotation-chain hints" `describe` block below the existing annotation-endpoint negative-case section.
- [`apps/server/src/diagnostics/index.ts`](../../../apps/server/src/diagnostics/index.ts) L25–32 — barrel re-exports for coherency hints. Adds the new variant type to the re-export list.
- [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) L365–379 — graph-walking methods. The rule uses `projection.getEdges()` to enumerate all edges, then filters for `sourceAnnotationId !== null && targetAnnotationId !== null`. For each candidate, it checks for an annotation-to-annotation incoming via `getEdgesByTarget(sourceAnnotationId)` (the polymorphic-key index already accepts annotation IDs as well as node IDs per the predecessor `projection_edge_annotation_endpoint`'s D-block).
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) L236–248 — `ProjectedEdge`. The rule reads `sourceAnnotationId`, `targetAnnotationId`, `sourceNodeId`, `targetNodeId`, `role`, `id`, `visible`. No new field needed.

## Constraints / requirements

- **Pure read function over the projection.** Same shape as the other rule functions in the detector — `(projection: Projection) => CoherencyHint[]`, no side effects, no DB access, no event emission. Repeated calls yield identical output.
- **Structural-only — no substance-agreement gate.** The rule fires regardless of whether the annotation-to-annotation edges' substance is agreed or disputed. Mirrors the other coherency-hint rules' structural-only stance (per `coherency_hint_detection.md` Decisions).
- **Visibility filter.** Edges must have `visible === true`. Both endpoint annotations must exist on the projection AND be visible. A broken-edge or invisible-annotation segment splits the chain — a subsequent hop after a broken segment does NOT inherit the chain's depth (per D7).
- **Contiguous-annotation-only chains.** A chain is a sequence of edges where each edge's source annotation is the target annotation of the previous edge in the chain. A node-endpoint edge breaks the chain. Per D2.
- **Rule appended, not inlined.** New rule function lives at the bottom of the existing per-rule section in `coherency-hint-detection.ts`, immediately above the `RULES` array. Appended to `RULES` in declaration order — the new rule fires *after* the three v1 rules. Matches the rule-registry pattern the predecessor established.
- **One hint per second-or-later hop.** A chain of depth `D` (i.e., `D` annotation-to-annotation edges forming a contiguous path) emits `D - 1` hints — one for each edge that is the 2nd, 3rd, …, Dth hop. The first hop of every chain emits nothing. Per D3.
- **Self-loop handling.** A cycle of annotation-to-annotation edges (e.g., `A → B → A`) has *every* edge as a second-or-later hop (each edge has an annotation-to-annotation incoming), so each edge emits one hint. The rule does not deduplicate over cycles — the existence of any edge with annotation-to-annotation incoming is the smell, and emitting once per such edge gives the UI per-edge highlighting without special cycle handling. Per D8.
- **Methodology-doc citation as a deliverable.** Per D1 the rule's landing includes a one-paragraph addition to `docs/methodology.md` naming the pattern under the coherency-hint catalogue. Without the citation, the rule violates the established "every structural diagnostic cites a methodology rule" convention.
- **No new ADR.** Per D5 the rule lands under the established coherency-hint seam; no new architectural alternative is being chosen.
- **No Cucumber delta.** Per D4 the rule is unit-observable; the round-trip-through-JSONB persistence layer is already pinned by the predecessor `projection_edge_annotation_endpoint`'s `from-log.feature` scenario.
- **Existing v1 rules unmodified.** The three existing rules (`incomplete-warrant-missing-bridges-to`, `incomplete-warrant-missing-bridges-from`, `self-contradicts`) keep their skip-on-annotation-endpoint guards from the parent audit — this task does NOT lift them. The new rule is additive; it surfaces a pattern the existing rules deliberately skip.

## Acceptance criteria

Pinned per ADR 0022 — every empirical check ships as committed test cover. Per D4 the test layer here is Vitest unit. Per the refinement README's policy this is a methodology-engine-adjacent task; UI-stream Playwright cover does not apply (the detector output is consumed by a separate UI task downstream).

Methodology-doc citation:

- [ ] [`docs/methodology.md`](../../../docs/methodology.md) coherency-hint section (around L230–234) gains one paragraph naming the `annotation-of-annotation-chain` pattern: "An edge whose source is an annotation and whose target is an annotation, where the source annotation is itself the target of another such edge, indicates an annotation-on-annotation chain of depth ≥ 2 — a signal that the discussion has migrated off the substance graph. Surfaced as advisory; resolution is typically to withdraw the deeper annotations and re-land the discussion at the substance level the metadata originally pointed at." Citation can be quoted from the new rule's source-comment.

Source — `apps/server/src/diagnostics/coherency-hint-detection.ts`:

- [ ] `HintKind` string-literal union extended with `'annotation-of-annotation-chain'`.
- [ ] New variant interface `AnnotationOfAnnotationChainHint = { kind: 'annotation-of-annotation-chain'; edgeId: string; sourceAnnotationId: string; targetAnnotationId: string; incomingEdgeId: string }`. The `incomingEdgeId` field identifies the prior annotation-to-annotation edge whose target equals this edge's source — the structural witness that establishes the chain.
- [ ] `CoherencyHint` discriminated union widened to include `AnnotationOfAnnotationChainHint`.
- [ ] New rule function `detectAnnotationOfAnnotationChains(projection: Projection): CoherencyHint[]`. Iterates `projection.edges()`; for each visible edge with both `sourceAnnotationId !== null` and `targetAnnotationId !== null` and both endpoint annotations visible, checks `projection.getEdgesByTarget(edge.sourceAnnotationId)` for a visible edge with both source and target annotations (the chain-establishing incoming); emits one hint per qualifying edge carrying `(edgeId, sourceAnnotationId, targetAnnotationId, incomingEdgeId)`.
- [ ] `RULES` registry appended with the new rule function — in declaration order it is the fourth and last rule.
- [ ] Top-of-file docblock paragraph (L58–78) updated to mark the annotation-of-annotation chain rule as **landed** (replacing the "candidate-future" wording) with one-line citation back to `docs/methodology.md`. The self-referential-annotation-contradicts paragraph remains as candidate-future per the parallel `coherency_self_referential_annotation_contradicts_rule` task.

Source — `apps/server/src/diagnostics/index.ts`:

- [ ] Barrel re-export list (L25–32) widened to include `type AnnotationOfAnnotationChainHint`.

Vitest cover — `apps/server/src/diagnostics/coherency-hint-detection.test.ts` (new `describe` block: "annotation-of-annotation-chain hints"):

- [ ] **Single annotation-to-annotation edge — no hint.** Two annotations `A1`, `A2` (each anchored on a distinct node) with one `A1 → supports → A2` edge. Assert `detectCoherencyHints(projection)` returns no `annotation-of-annotation-chain` hint.
- [ ] **Chain depth 2 → one hint on the second hop.** Three annotations `A1`, `A2`, `A3`. Edges `E1: A1 → supports → A2`, `E2: A2 → supports → A3`. Assert exactly one `annotation-of-annotation-chain` hint, on `E2`, with `incomingEdgeId === E1.id`.
- [ ] **Chain depth 3 → two hints (each second-or-later hop).** Four annotations, three edges `E1: A1→A2`, `E2: A2→A3`, `E3: A3→A4`. Assert two hints: one on `E2` (incoming `E1`), one on `E3` (incoming `E2`). Rule-declaration-order iteration is deterministic.
- [ ] **Branched chain.** Three annotations, edges `E1: A1 → A2`, `E2: A1 → A3`, `E3: A2 → A3`. `E3` has annotation-to-annotation incoming (`E1`, since A2 is `E1`'s target). `E2` has no annotation-to-annotation incoming (A1 is no annotation-edge's target). Assert exactly one hint, on `E3` with `incomingEdgeId === E1.id`.
- [ ] **Self-loop / cycle.** Two annotations, edges `E1: A1 → A2`, `E2: A2 → A1`. Both `A1` and `A2` are targets of annotation-to-annotation edges, so BOTH `E1` and `E2` emit hints. Assert two hints in edges-iteration order.
- [ ] **Node-source edge breaks the chain.** Three annotations and one node `N1`. Edges `E1: A1 → A2`, `E2: A2 → N1`, `E3: N1 → A3`. `E3` is a node-to-annotation edge, NOT an annotation-to-annotation edge — the rule's first filter excludes it. Assert no hint from this rule (the chain "ends" at the node).
- [ ] **Invisibility breaks the chain.** Three annotations, edges `E1: A1→A2`, `E2: A2→A3`. Mark `E1` as invisible (e.g., via a `break-edge` event). Assert NO hint on `E2` — the chain's first edge is invisible so `A2` is no longer the target of a *visible* annotation-to-annotation edge. The negative pins the visibility filter from D7.
- [ ] **Invisible endpoint annotation breaks the chain.** Three annotations, both edges visible, mark `A2` invisible. Assert no hint (defensive: endpoint-annotation visibility guard rejects both edges).
- [ ] **Coexistence with other coherency hints.** Build a projection with one incomplete warrant (node-node) AND one depth-2 annotation chain. Assert the result contains both kinds, in rule-declaration order (incomplete-warrant kinds before annotation-of-annotation-chain).

Existing tests stay green:

- [ ] Every existing Vitest suite passes — including the parent audit's broadened pins (this rule fires only on annotation-to-annotation chains, which are not present in any prior test fixture).
- [ ] Every existing Cucumber feature passes.
- [ ] Every existing Playwright suite passes.

Build + scheduler:

- [ ] `pnpm -F @a-conversa/server build` succeeds.
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green; Vitest baseline rises by the 9 new cases listed above.
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/10-data-and-methodology.tji` carries `complete 100` for `coherency_annotation_of_annotation_chain_rule` plus a `note "Refinement: ..."` line.

Tech-debt registration:

- [ ] **No new follow-ups from this task itself.** The parallel `coherency_self_referential_annotation_contradicts_rule` is already a WBS leaf (registered by the parent audit) — not re-registered here. The downstream UI-surfacing work for annotation-endpoint edges (`mod_render_annotation_endpoint_edges`, `part_render_annotation_endpoint_edges`, `aud_render_annotation_endpoint_edges`) was registered by `projection_edge_annotation_endpoint` and consumes coherency hints (including this new kind) as part of its scope.

## Decisions

- **D1 — Bundle the `docs/methodology.md` enumeration into this task.** Rationale:
  - **The WBS note says "Conditional on `docs/methodology.md` enumerating the pattern".** Read strictly, this could mean either (a) "block until the docs change lands separately" or (b) "this task lands the docs change together with the rule". Option (a) defers indefinitely on a tiny doc edit nobody else has scoped; option (b) makes the rule's grounding self-contained.
  - **The methodology citation is ~1 paragraph; the rule's source comment already needs to state it.** The cleanest discharge is to land the doc paragraph in the same commit as the rule, with the source comment pointing at the docs by line range. The two lines reach a stable equilibrium together.
  - **Methodology silence is the audit-cited blocker.** The parent audit's D3 said "Adding [these rules] without a methodology citation would be speculation per the established 'structural diagnostics cite a methodology rule' convention." The two paths to satisfying that convention are: change the docs, or skip the rule. The audit's task-creation implies the former path is endorsed once a refinement is written; this refinement writes that change down.
  - **Alternative considered: defer this task until a separate `methodology_doc_annotation_endpoint_coherency_catalogue` task lands the docs change.** Rejected — adds a new WBS task for ~30 minutes of documentation work and creates a synchronisation hazard (the docs task lands, then this refinement's citations are written, then this rule lands). Bundling lets one commit cluster cover the methodology change + rule + tests + WBS.
  - **Alternative considered: write the rule with a TODO/FIXME comment marking the docs citation as pending.** Rejected — would land speculative source code without methodology grounding, exactly what the audit's D3 cautioned against.

- **D2 — Chain definition: contiguous annotation-to-annotation hops only; a node-endpoint edge breaks the chain.** Rationale:
  - **Methodology smell framing.** The audit's D3 framing of the smell is "the meta-discussion has migrated off the substance graph". A node in the middle of a chain *is* a return to the substance graph — that's exactly where the discussion belongs. So a chain like `A1 → N1 → A2 → A3` is two separate chains: `A1 → N1` (a single annotation-to-node hop) and `A2 → A3` (a single annotation-to-annotation hop, depth 1 → no hint).
  - **Operational simplicity.** Defining the chain as a path-graph in `(annotation IDs) × (visible annotation-to-annotation edges)` yields the simplest possible rule: filter edges to annotation-to-annotation, build adjacency on annotation IDs, count depth via incoming-edge presence. A node-in-the-middle definition would require querying the whole graph for path connectivity through node-endpoint edges, blurring the rule's scope and its docs framing.
  - **Per-edge hint payload aligns.** Each second-or-later hop's payload (`edgeId`, `incomingEdgeId`) is self-contained; the UI can highlight the two edges in the chain without needing to reconstruct a multi-edge path. If the chain were defined to span node-endpoint edges, the hint payload would need to be more complex.
  - **Alternative considered: define chain over any "annotation-touching" edges, including node-endpoint edges adjacent to annotation-endpoint edges.** Rejected — diffuses the smell signal and risks false positives whenever a moderator runs an annotation through a single node. The crisp signal is "consecutive annotation-only hops".

- **D3 — Emit one hint per second-or-later hop, not one per chain.** Rationale:
  - **Mirrors the existing detector's per-edge / per-incident emission stance.** `self-contradicts` emits one hint per self-loop edge; the incomplete-warrant rules emit one hint per dangling bridge edge. The detector's contract with downstream consumers is hint-per-incident, not hint-per-cluster.
  - **Per-edge hints give the UI granularity.** A moderator looking at a depth-3 chain `A → B → C → D` may want to highlight `B → C` and `C → D` separately (each is its own diagnostic moment); a single chain-level hint would lose the per-edge handle.
  - **Cycles are handled gracefully.** A chain that forms a cycle (`A → B → A`) emits a hint on every edge — no cycle-special-casing needed. A single chain-level hint would have to decide what `headAnnotationId` is for a cycle (it has no head).
  - **Determinism.** `RULES.flatMap(rule => rule(projection))` already maintains rule-then-incident order; per-edge emission inherits that determinism from `projection.edges()` iteration order.
  - **Alternative considered: emit one hint per maximal chain, carrying the full chain as an ordered annotation-list + edge-list.** Rejected for v1 — payload is heavier, downstream consumers (moderator UI) would need to walk the list for highlighting anyway, and the maximal-chain definition is ambiguous in cyclic graphs (no canonical "start"). The per-edge shape is simpler and information-equivalent at the cluster level (downstream code can reconstruct the chain by following `incomingEdgeId` if needed).
  - **Alternative considered: emit one hint at the first second-hop only (i.e., one hint per chain even if depth > 2).** Rejected — loses per-edge granularity for deeper chains; a depth-10 chain would emit one hint, which under-reports the smell magnitude.

- **D4 — Vitest unit cover; no Cucumber delta.** Rationale:
  - **The rule is unit-observable** — same as the parent audit's D6 reasoning. The detector's input is a `Projection` and its output is a `CoherencyHint[]`; both ends are unit-testable without traversing the event-stream / pglite layer.
  - **The round-trip-through-JSONB surface for annotation-endpoint edges is already pinned** by the predecessor `projection_edge_annotation_endpoint`'s `from-log.feature` scenario. The Cucumber layer pins persistence of polymorphic-endpoint edges; this task pins detection logic over already-persisted shapes.
  - **A Cucumber pin would assert "no event fires" against a chain-shaped fixture** — same property the Vitest case asserts, at higher per-case cost (boot pglite, run the projector, etc.).
  - **ADR 0022 compliance.** Every empirical claim ships as committed test cover; Vitest satisfies this without mandating a Cucumber slot.
  - **Alternative considered: add a Cucumber scenario in `tests/behavior/diagnostics/coherency-hint-detection.feature`** mirroring the existing two scenarios. Rejected per the same reasoning the parent audit applied — the per-rule skip / fire decision has no Cucumber-layer observable beyond what Vitest already pins.

- **D5 — No new ADR.** Rationale:
  - **The rule lands under an established seam.** `coherency_hint_detection` is the detector; its rule-registry composition is the seam for adding rules. The seam was chosen in the parent `coherency_hint_detection` refinement; this task uses it.
  - **The methodology citation is a doc update, not an architectural decision.** ADRs capture choices among architectural alternatives. Naming a coherency-hint pattern in the docs is editorial — there's no decision-between-alternatives shape.
  - **No new dependency, no new technology choice, no new abstraction.** The rule is a pure read function over an existing projection type.
  - **Alternative considered: an ADR titled "annotation-of-annotation chains are a coherency-hint smell".** Rejected — the position is fully captured by the docs paragraph plus this refinement; ADR-isation adds no architectural specificity over what the rule's source comment + docs citation provide.

- **D6 — Test-helper additions: `createAnnotation` + `createAnnotationEdge`.** Rationale:
  - **The new test cases each need 2–4 annotations and 1–3 annotation-to-annotation edges.** Inlining the `annotation-created` and `edge-created` events 9× would clutter the file; a thin helper that wraps the existing `applyEvent` + `makeEvent` pattern keeps cases readable.
  - **The existing annotation-endpoint test section** (L411–546, added by the parent audit) already seeds annotation-created events inline. Per D6 the new helpers refactor those inline seeds *only if the refactor is mechanical*; if the inline pattern reads cleanly in the existing cases, leave them alone (the helpers exist for the new cases).
  - **Helper shape:**
    - `createAnnotation(projection, annotationId, anchor)` — `anchor` is `{ nodeId } | { edgeId }` (the existing data-model allows only node-or-edge anchors per `docs/data-model.md` line 236).
    - `createAnnotationEdge(projection, edgeId, sourceAnnotationId, targetAnnotationId, role)` — emits an `edge-created` event with both source and target annotation IDs set, both node IDs null.
  - **Alternative considered: add a `createMixedEdge(projection, edgeId, source, target, role)` helper** where `source` and `target` are tagged unions of node-or-annotation IDs. Rejected for v1 — the two-helper split is more explicit at the call site; tagged-union shaping at call sites tends to leak into test readers' parsing budget. If a future task needs a mixed-edge helper, it can land then.

- **D7 — Invisibility breaks the chain (broken-edge or invisible-endpoint-annotation segment).** Rationale:
  - **Invisible edges don't participate in any structural reasoning** (per `docs/data-model.md` lines 287–293, cited by every diagnostic in the module). The rule is no exception — a chain whose first edge is invisible no longer has a "second hop", so the would-be-second-hop edge emits no hint.
  - **Defensive endpoint-visibility guard** mirrors the sibling rules' pattern (verified against the existing rules at L184–228, L236–276, L286–309 — each checks both endpoint nodes' visibility before counting the edge).
  - **Operational consequence: graceful degradation.** A participant who breaks a chain-segment edge via `break-edge` immediately removes downstream hints. No diagnostic-stream "echo" after withdrawal.
  - **Alternative considered: emit the hint even when the chain-establishing incoming is invisible, with a comment that the chain "was" depth ≥ 2.** Rejected — diagnostic firing on historical structure violates the projection's "what's structurally true right now" stance and would surprise the moderator.

- **D8 — Cycles get per-edge hints, not deduplicated.** Rationale:
  - **Every edge in a cycle has a visible annotation-to-annotation incoming.** The rule's per-edge filter fires for each. Deduplicating would require cycle detection, which expands the rule's scope to graph traversal.
  - **Per-edge hints in a cycle are the truthful signal — the moderator may want to break the cycle at any edge.** A single "the cycle exists" hint would still need to identify all edges so the UI can offer per-edge controls, leaving the deduplication adding no clarity.
  - **Cost of the choice: small inflation in hint count for cyclic chains.** A 3-edge cycle emits 3 hints. Acceptable; the UI surfaces them as separate per-edge advisories. If cycle-hint inflation becomes a problem at scale, a future task can add a `dedupeAnnotationChainsAtCycles` post-processor at the detector level — no impact on this rule's shape.
  - **Alternative considered: detect cycles and emit one synthetic "annotation-chain cycle" hint per cycle.** Rejected — adds a *different* `HintKind` (cycle vs depth ≥ 2), splits the rule into two, and pulls cycle detection into the rule's scope. Out of proportion for v1.

## Open questions

(none — all decided in D1–D8.)

## Status

**Done** — 2026-05-30.

- `docs/methodology.md` — coherency-hint catalogue gains the annotation-of-annotation chain (depth ≥ 2) entry.
- `apps/server/src/diagnostics/coherency-hint-detection.ts` — docblock updated, `HintKind` widened with `'annotation-of-annotation-chain'`, `AnnotationOfAnnotationChainHint` interface added, `CoherencyHint` union widened, `detectAnnotationOfAnnotationChains` rule appended to `RULES`; self-loop guard (`if (incoming.id === edge.id) continue`) added to fix cycle-test (root cause: candidate edge was its own incoming-witness via `getEdgesByTarget(edge.sourceAnnotationId)`).
- `apps/server/src/diagnostics/index.ts` — barrel re-exports `AnnotationOfAnnotationChainHint`.
- `apps/server/src/diagnostics/event-emission.ts` — `coherencyHintIdentityKey` switch gains `'annotation-of-annotation-chain'` case and `annotationOfAnnotationChainKey` helper.
- `apps/server/src/diagnostics/coherency-hint-detection.test.ts` — `createAnnotation` + `createAnnotationEdge` helpers and new `describe` block with 9 cases: depth-1 negative, depth-2 single hint, depth-3 two hints, branched chain, cycle/self-loop, node-endpoint breaks chain, invisible edge breaks chain, invisible endpoint annotation breaks chain, coexistence with v1 incomplete-warrant rule.
