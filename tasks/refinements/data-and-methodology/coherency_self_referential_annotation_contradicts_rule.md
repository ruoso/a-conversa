# Coherency hint: node contradicts its own annotation

**TaskJuggler entry**: `data_and_methodology.diagnostics.coherency_self_referential_annotation_contradicts_rule` — [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) (block at lines 314–324). Embedded note: *"Source of debt: diagnostics_annotation_endpoint_semantics_audit D3. Candidate coherency-hint rule: node N → contradicts → annotation A where A annotates N. Conditional on docs/methodology.md enumerating the pattern as a named coherency hint. Includes Vitest cover; no Cucumber delta."*

## Effort estimate

**0.5d** (per the `.tji` allocation). Breakdown:

- **Methodology-doc edit (~1h).** Add one short paragraph to `docs/methodology.md`'s coherency-hint catalogue naming the self-referential-annotation-contradicts pattern, placed immediately under the annotation-of-annotation-chain entry the sibling task landed at L235. Per D1 below, bundling the citation into the rule's own task mirrors the precedent the sibling `coherency_annotation_of_annotation_chain_rule` established for "conditional on methodology-doc enumeration" rules.
- **Rule implementation (~1h).** One new rule function in `apps/server/src/diagnostics/coherency-hint-detection.ts`, one new variant on `HintKind`, one new variant interface, one append to the `RULES` registry, one new variant on the `CoherencyHint` union, one export on the barrel, one identity-key case + helper in `event-emission.ts`.
- **Vitest cover (~1.5h).** Six to eight cases: node→annotation positive direction (rule fires), annotation→node positive direction (rule fires per D2), wrong role on the same shape (no hint), annotation anchors a different node (no hint), annotation anchors an edge (no hint), invisible-segment cases, coexistence with the parallel `self-contradicts` rule on the same node.
- **WBS housekeeping (~0.5h).** Closer's responsibility — `complete 100` on `coherency_self_referential_annotation_contradicts_rule` plus the `note "Refinement: ..."` line.

No Cucumber delta (per D6 — the rule is unit-observable; the round-trip-through-JSONB shape for annotation-endpoint edges is already pinned by the predecessor `projection_edge_annotation_endpoint`'s `from-log.feature` scenario). No ADR (per D7 — adds a single advisory rule under an established detector seam). No DB migration. No projection-layer change. No UI consumer change in this task (the moderator-UI surfacing of annotation-endpoint edges is the already-named `mod_render_annotation_endpoint_edges`).

## Inherited dependencies

**Settled:**

- [`data_and_methodology.diagnostics.diagnostics_annotation_endpoint_semantics_audit`](./diagnostics_annotation_endpoint_semantics_audit.md) (done — 2026-05-30). The direct parent: its D3 named this rule with the exact shape "node N → contradicts → annotation A where A annotates N" and registered it as a candidate-future task conditional on methodology-doc enumeration, with explicit "~0.5d, includes Vitest cover; no Cucumber" framing.
- [`data_and_methodology.diagnostics.coherency_annotation_of_annotation_chain_rule`](./coherency_annotation_of_annotation_chain_rule.md) (done — 2026-05-30). The parallel sibling carved out of the same parent audit's D3. Established the precedent for how an annotation-endpoint coherency rule lands: bundled methodology-doc paragraph + rule function + barrel export + identity-key + Vitest. This refinement reuses that precedent verbatim wherever the shapes match.
- [`data_and_methodology.diagnostics.coherency_hint_detection`](./coherency_hint_detection.md) (done — 2026-05-10). The detector this rule plugs into. Its rule-registry composition (`RULES: ReadonlyArray<(p: Projection) => CoherencyHint[]>` reduced via `flatMap`) is the extension seam.
- [`data_and_methodology.projection.projection_edge_annotation_endpoint`](./projection_edge_annotation_endpoint.md) (done — 2026-05-30). Widened `ProjectedEdge` to polymorphic endpoints; without this widening, `node → contradicts → annotation` edges weren't structurally representable.
- [`data_and_methodology.event_types.edge_target_annotation_schema_extension`](./edge_target_annotation_schema_extension.md) (done — 2026-05-30). Wire-schema widening upstream — `edge-created` events can carry annotation endpoints.
- [`data_and_methodology.diagnostics.diagnostic_event_emission`](./diagnostic_event_emission.md) (done). Provides the `coherencyHintIdentityKey` switch that the new hint kind must be wired into.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). The rule ships as committed Vitest cases pinning both the positive (hint emits) and negative (no hint) shapes.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md). The self-referential-annotation-contradicts detection is purely entity-layer — no facet read; the rule fires regardless of substance-agreement state.

**Pending:** (none — every load-bearing predecessor is on `main` at task start.)

## What this task is

Add a new **advisory coherency-hint rule** — `self-referential-annotation-contradicts` — to the existing `coherency-hint-detection.ts` detector. The rule walks the projection and emits one hint per visible `contradicts` edge connecting a node `N` to an annotation `A` where `A.targetNodeId === N` (i.e., `A` annotates `N`).

Structurally: an edge `E` with `role === 'contradicts'` and one endpoint a node and the other endpoint an annotation, such that the annotation's anchor is the same node. Per D2 the rule fires in **both** edge directions — `node N → contradicts → annotation A` (the shape the audit named directly) and `annotation A → contradicts → node N` — because the smell is structurally symmetric (the user has wired the formal `contradicts` relation between an entity and its own metadata, and the methodology resolution is the same in both directions: withdraw the annotation).

The rule is structural-only and advisory. It does not read substance facets, does not depend on agreement state, and does not block any user action. The hint payload identifies the edge, the node, and the annotation — enough for a moderator UI to highlight the smell and offer the typical resolution (withdraw the annotation rather than try to resolve the contradiction at the methodology layer).

Bundled into this task: a one-paragraph addition to `docs/methodology.md`'s coherency-hint catalogue enumerating the pattern (per D1 below). Without that citation, the rule would have no methodology grounding — a violation of the established "every structural diagnostic cites a methodology rule" convention that the parent audit pinned and the sibling `coherency_annotation_of_annotation_chain_rule` already paid down by precedent.

Out of scope:

- **The parallel `contradiction_detection` annotation-endpoint audit.** `contradiction_annotation_endpoint_semantics_audit` (already a WBS leaf, registered by the parent audit's D8) revisits whether `contradiction_detection` (the contradiction-pair detector, a *separate* diagnostic from coherency hints) should surface findings on annotation-endpoint contradicts edges. That audit may eventually carve out its own coherency-hint follow-ups for non-self-referential annotation-endpoint contradictions — out of scope here.
- **Moderator-UI surfacing of coherency hints over annotation-endpoint edges.** `mod_render_annotation_endpoint_edges` (already named by `projection_edge_annotation_endpoint`) is the UI hook task; this task delivers detector output; UI consumption is downstream.
- **Indirect self-reference through an annotated edge.** An annotation `A` anchored on edge `E`, where `E`'s endpoint is `N`, with a `contradicts` edge between `N` and `A` — that's a different structural shape with its own methodology question (is `A`'s anchor really `N`, or is it the relation `E`?). Per D3 this rule scopes to direct node-anchor self-reference only (`A.targetNodeId === N`); the edge-anchor variant is not surfaced here and is a candidate-future slot only if a real fixture motivates it.
- **Other roles on the same shape.** Only `contradicts` qualifies. A `supports` edge between `N` and an annotation that annotates `N` is "the node endorses its own commentary" — a defensible move, not a smell. A `rebuts` edge has no clear self-referential reading in the methodology and is not part of the audit's named pattern. Per D4.
- **Both endpoints on the same node via annotation.** A `contradicts` edge whose source and target are *both* annotations that annotate the same node (`A1 → contradicts → A2`, both `targetNodeId === N`) is a different shape — there's no `N`-endpoint on the edge itself; the smell would be "two annotations on the same node contradict each other," which is a normal disagreement encoding (two participants annotating the same node with conflicting commentary, then formalising the conflict). Out of scope; if it ever becomes a coherency hint, it's a separate rule.

## Why it needs to be done

**The audit named this candidate rule with a concrete methodology framing in place.** The parent `diagnostics_annotation_endpoint_semantics_audit` D3 identified this exact pattern as one of two annotation-endpoint coherency rules the existing detector's rule registry should grow to surface. The audit deliberately did NOT implement the rule — that's this task's role. The sibling `coherency_annotation_of_annotation_chain_rule` has already paid down half the registered debt with the same shape; this task closes the other half.

**The smell is real and structurally detectable today.** Now that `ProjectedEdge` carries polymorphic endpoints, a participant *can* land an edge whose endpoints are `(N, A)` where `A.targetNodeId === N`. The act looks defensible at the wire layer — `contradicts` is a normal edge role and annotation-endpoint edges are well-defined — but at the methodology layer it's a category error. An annotation is metadata about the entity; "the node contradicts the metadata on the node" is asking the methodology engine to treat a metadata layer as if it were a peer substance the formal `contradicts` machinery should adjudicate. The right move is upstream: withdraw the offending annotation, or restructure the node so the annotation's claim becomes a peer node that can carry the substantive disagreement. The hint exists to surface that the wrong layer is being engaged.

**Without this rule, the configuration is silently invisible to the moderator.** The v1 coherency-hint rules are node-node (per audit D3) and explicitly skip annotation-endpoint edges. The `contradiction_detection` diagnostic also skips annotation-endpoint edges by default (per audit D8 + the contradiction-detection.ts:108-112 guard). A self-referential annotation-contradicts edge therefore fires no diagnostic today. The moderator has no surface in the system to spot it.

**Symmetry with the sibling rule keeps the registered debt fully paid down.** The parent audit's D3 named two rules; one has landed, this is the other. Leaving this one undone would mean half of the audit-named coherency follow-ups exist in the detector and half don't — an asymmetry that any future contributor reading the top-of-file docblock or the audit's D3 would notice and have to chase down.

## Inputs / context

**Design contract (doc-citation; the methodology-doc edit IS this task's deliverable, per D1):**

- [`docs/methodology.md`](../../../docs/methodology.md) line 235 — coherency-hint catalogue currently lists one entry (`annotation-of-annotation chain (depth ≥ 2)`), added by the sibling task on 2026-05-30. This task adds a second entry immediately below it, naming the self-referential-annotation-contradicts pattern with its structural definition (`contradicts` edge between a node and an annotation that anchors on that same node) and the typical resolution (withdraw the annotation).
- [`docs/data-model.md`](../../../docs/data-model.md) line 122 — `contradicts` edge definition. "Source and target conflict; both cannot be true. Directed." Establishes that `contradicts` is a substantive-disagreement encoding; pairing it with a self-referential annotation is a methodology-layer category error.
- [`docs/data-model.md`](../../../docs/data-model.md) lines 137–143 — annotations defined as first-class entities with their own facet set. "An annotation can itself be disputed, decomposed, or retracted." The annotation lifecycle gives the natural resolution path (retract A) — the methodology paragraph cites this.
- [`docs/data-model.md`](../../../docs/data-model.md) lines 145–153 ("Coherency guidance") — the framing the rule lands under. "Some edge/node configurations are typical; others are unusual… advisory hints when an unusual configuration is created… The system never blocks; it nudges."
- [`docs/data-model.md`](../../../docs/data-model.md) lines 197–199 ("Coherency violations") — advisory, not blocking. The new rule lands as advisory per the established `blocking_vs_advisory_classification`.

**Architectural / engineering inputs:**

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). Vitest cover pins the rule's positive and negative behaviour.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md). The rule is entity-layer: it walks edges and annotations by ID; it does not read substance or wording facets.

**Runtime inputs (real file references the implementer reads + edits):**

- [`apps/server/src/diagnostics/coherency-hint-detection.ts`](../../../apps/server/src/diagnostics/coherency-hint-detection.ts):
  - L1–94 — top-of-file docblock. L71–77 currently flags `self-referential-annotation-contradicts` as candidate-future. The rule's landing replaces that paragraph with one that marks it as LANDED, mirroring how the sibling task updated the annotation-of-annotation-chain paragraph at L64–70.
  - L111–115 — `HintKind` string-literal union. Adds the new discriminator value `'self-referential-annotation-contradicts'`.
  - L126–184 — per-rule hint interfaces. Adds the new variant interface (see Acceptance criteria for the exact shape).
  - L190–194 — `CoherencyHint` discriminated union. Widens with the new variant.
  - L306–337 — the existing `detectSelfContradicts` rule. The new rule sits immediately after it (or after `detectAnnotationOfAnnotationChains` at the end of the per-rule section); both placements are defensible (see Decisions for the chosen ordering rationale).
  - L425–430 — `RULES` registry. Appends the new rule function as the fifth entry.
- [`apps/server/src/diagnostics/coherency-hint-detection.test.ts`](../../../apps/server/src/diagnostics/coherency-hint-detection.test.ts):
  - L178–219 — existing helpers `createAnnotation`, `createAnnotationEdge` (added by the sibling task). Per D8 the test file adds two thin parallel helpers `createNodeToAnnotationEdge` and `createAnnotationToNodeEdge` for mixed-endpoint contradicts edges; both wrap the existing `applyEvent` + `makeEvent` pattern with explicit per-endpoint parameters.
  - The new positive and negative cases sit in a new `describe` block `'self-referential-annotation-contradicts hints'`, placed alongside (after) the sibling task's `'annotation-of-annotation-chain hints'` block.
- [`apps/server/src/diagnostics/index.ts`](../../../apps/server/src/diagnostics/index.ts) L25–33 — barrel re-exports for coherency hints. Adds the new variant type to the re-export list.
- [`apps/server/src/diagnostics/event-emission.ts`](../../../apps/server/src/diagnostics/event-emission.ts) L258–288 — `coherencyHintIdentityKey` switch and per-variant key helpers. Adds a new case + helper for the new hint kind. Identity is the edge id (one diagnostic per qualifying edge, mirroring the `self-contradicts` and `annotation-of-annotation-chain` identity shape).
- [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) — graph-walking methods. The rule uses `projection.edges()` to enumerate edges and `projection.getAnnotation(annotationId)` to read `A.targetNodeId`. Both are already in use by the sibling rule.
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) L236–261 — `ProjectedEdge` and `ProjectedAnnotation`. The rule reads `edge.role`, `edge.sourceNodeId`, `edge.sourceAnnotationId`, `edge.targetNodeId`, `edge.targetAnnotationId`, `edge.visible`, `edge.id`, plus `annotation.targetNodeId` and `annotation.visible`. No new field needed.

## Constraints / requirements

- **Pure read function over the projection.** Same shape as the other rule functions in the detector — `(projection: Projection) => SelfReferentialAnnotationContradictsHint[]`, no side effects, no DB access, no event emission. Repeated calls yield identical output.
- **Structural-only — no substance-agreement gate.** The rule fires regardless of whether the edge's substance is agreed or disputed and regardless of the annotation's wording/substance state. Mirrors the v1 coherency-hint rules' structural-only stance.
- **Visibility filter.** Edge must have `visible === true`. The node endpoint must exist on the projection AND be visible. The annotation endpoint must exist on the projection AND be visible. A broken edge or invisibility on either endpoint suppresses the hint.
- **Role filter.** Only `edge.role === 'contradicts'` qualifies. Other roles are out of scope per D4.
- **Mixed-endpoint filter.** The edge must have exactly one node endpoint and exactly one annotation endpoint — i.e., either `(sourceNodeId !== null && targetAnnotationId !== null && sourceAnnotationId === null && targetNodeId === null)` OR the symmetric `(sourceAnnotationId !== null && targetNodeId !== null && sourceNodeId === null && targetAnnotationId === null)`. Both-node and both-annotation edges are out of scope (the existing `self-contradicts` and `annotation-of-annotation-chain` rules handle those respective patterns).
- **Anchor-match filter.** `annotation.targetNodeId === node.id` where `node.id` is the node endpoint. Annotations anchored on an edge (`annotation.targetEdgeId !== null`) do not qualify per D3.
- **One hint per qualifying edge.** No deduplication, no clustering. Same per-edge-incident stance as `self-contradicts` (L154–157) and `annotation-of-annotation-chain` (L178–184).
- **Rule appended, not inlined.** New rule function lives at the bottom of the existing per-rule section in `coherency-hint-detection.ts`, immediately above the `RULES` array. Appended to `RULES` in declaration order — the new rule fires last among the five.
- **Methodology-doc citation as a deliverable.** Per D1, the rule's landing includes a one-paragraph addition to `docs/methodology.md` naming the pattern under the coherency-hint catalogue.
- **No new ADR.** Per D7, the rule lands under the established coherency-hint seam.
- **No Cucumber delta.** Per D6, the rule is unit-observable; the persistence layer for annotation-endpoint edges is already pinned.
- **Existing v1 rules and the chain rule unmodified.** The four prior rules keep their behaviour; this task is additive.

## Acceptance criteria

Pinned per ADR 0022 — every empirical check ships as committed test cover. Per D6 the test layer here is Vitest unit. Per the refinement README's policy this is a methodology-engine-adjacent task; UI-stream Playwright cover does not apply (the detector output is consumed by a separate UI task downstream).

Methodology-doc citation:

- [ ] [`docs/methodology.md`](../../../docs/methodology.md) coherency-hint section (immediately below the annotation-of-annotation-chain entry at L235) gains one paragraph naming the `self-referential-annotation-contradicts` pattern. Suggested wording: *"**Self-referential annotation contradicts (node ↔ own annotation)** — a `contradicts` edge between a node `N` and an annotation `A` whose anchor is `N` indicates the formal contradiction mechanism is being applied between an entity and its own metadata layer. Surfaced as advisory; the typical resolution is to withdraw or restructure the annotation rather than resolve the contradiction at the substance layer — the methodology positions `contradicts` as a substance-layer relation between peer entities, not between an entity and its commentary."* The rule's source comment cites this paragraph by line range.

Source — `apps/server/src/diagnostics/coherency-hint-detection.ts`:

- [ ] `HintKind` string-literal union extended with `'self-referential-annotation-contradicts'`.
- [ ] New variant interface `SelfReferentialAnnotationContradictsHint = { kind: 'self-referential-annotation-contradicts'; edgeId: string; nodeId: string; annotationId: string }`. The three IDs are the qualifying edge, the node endpoint of that edge, and the annotation endpoint of that edge (which anchors on `nodeId`). The UI can highlight all three with this payload.
- [ ] `CoherencyHint` discriminated union widened to include `SelfReferentialAnnotationContradictsHint`.
- [ ] New rule function `detectSelfReferentialAnnotationContradicts(projection: Projection): SelfReferentialAnnotationContradictsHint[]`. Iterates `projection.edges()`; for each visible edge with `role === 'contradicts'` and exactly one node endpoint + one annotation endpoint, looks up the annotation via `projection.getAnnotation(annotationId)`; if the annotation is visible and `annotation.targetNodeId === node.id` and the node endpoint is itself visible, emits one hint carrying `(edgeId, nodeId, annotationId)`. Walks both endpoint directions in a single pass — see Decisions D2 for the direction handling.
- [ ] `RULES` registry appended with the new rule function — in declaration order it is the fifth and last rule.
- [ ] Top-of-file docblock paragraph (L71–77) updated to mark the self-referential-annotation-contradicts rule as **landed** (replacing the "candidate-future" wording), mirroring how the sibling task updated the annotation-of-annotation-chain paragraph at L64–70.

Source — `apps/server/src/diagnostics/index.ts`:

- [ ] Barrel re-export list (L25–33) widened to include `type SelfReferentialAnnotationContradictsHint`.

Source — `apps/server/src/diagnostics/event-emission.ts`:

- [ ] `coherencyHintIdentityKey` switch (L258–268) gains a `case 'self-referential-annotation-contradicts':` branch returning `selfReferentialAnnotationContradictsKey(hint)`.
- [ ] New helper `selfReferentialAnnotationContradictsKey(hint)` returning `` `coherency-hint\0self-referential-annotation-contradicts\0${hint.edgeId}` ``. Identity is the edge id, mirroring the `self-contradicts` and `annotation-of-annotation-chain` identity shape — one diagnostic per qualifying edge.
- [ ] Existing `coherencyHintIdentityKey` switch exhaustiveness check (TypeScript `never`-narrow at the end, if present) stays compile-clean against the widened union.

Vitest cover — `apps/server/src/diagnostics/coherency-hint-detection.test.ts` (new `describe` block: `'self-referential-annotation-contradicts hints'`):

- [ ] **Positive — `node N → contradicts → annotation A` where `A` annotates `N`, one hint.** Seed: node `N`, annotation `A` with `targetNodeId === N.id`, edge `E: N → contradicts → A`. Assert exactly one `self-referential-annotation-contradicts` hint with `(edgeId: E.id, nodeId: N.id, annotationId: A.id)`.
- [ ] **Positive — `annotation A → contradicts → node N` where `A` annotates `N`, one hint (per D2).** Same anchor shape as above; edge direction reversed. Assert the same hint payload (the `nodeId` and `annotationId` fields are direction-agnostic — they identify the endpoints semantically, not by source/target slot).
- [ ] **Negative — wrong role.** Same shape as the first positive but `role === 'supports'` (or `'rebuts'`). Assert no `self-referential-annotation-contradicts` hint. Pins the role filter from D4.
- [ ] **Negative — annotation anchors a different node.** Edge `N1 → contradicts → A`, `A.targetNodeId === N2` (different node). Assert no hint. Pins the anchor-match filter.
- [ ] **Negative — annotation anchors an edge (not a node).** Edge `N → contradicts → A`, `A.targetEdgeId === someOtherEdgeId` (and `A.targetNodeId === null`). Assert no hint. Pins D3 (edge-anchor variant is out of scope).
- [ ] **Negative — both endpoints are annotations.** Edge `A1 → contradicts → A2`, both `A1` and `A2` anchor on the same node `N`. Assert no `self-referential-annotation-contradicts` hint (the mixed-endpoint filter excludes both-annotation edges).
- [ ] **Negative — both endpoints are nodes.** Standard `N1 → contradicts → N2` edge. Assert no hint from this rule (the mixed-endpoint filter excludes both-node edges; the existing `self-contradicts` rule handles the `N → N` self-loop case).
- [ ] **Negative — invisibility breaks the hint.** Three sub-cases: invisible edge; invisible node endpoint; invisible annotation endpoint. Each assert no hint.
- [ ] **Coexistence with `self-contradicts` on the same node.** Build a projection with one `N → contradicts → N` self-loop (fires the v1 `self-contradicts` rule) AND one `N → contradicts → A` self-referential-annotation edge with `A.targetNodeId === N` (fires this rule). Assert both hints appear in rule-declaration order (`self-contradicts` before `self-referential-annotation-contradicts`).
- [ ] **Coexistence with `annotation-of-annotation-chain`.** Build a projection with one depth-2 annotation chain AND one self-referential-annotation-contradicts edge. Assert both hints appear in rule-declaration order.

Existing tests stay green:

- [ ] Every existing Vitest suite passes — including the parent audit's broadened pins and the sibling task's chain cases (this rule fires only on `contradicts`-role mixed-endpoint edges with the anchor-match property, which are not present in any prior test fixture).
- [ ] Every existing Cucumber feature passes.
- [ ] Every existing Playwright suite passes.

Build + scheduler:

- [ ] `pnpm -F @a-conversa/server build` succeeds.
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green; Vitest baseline rises by the ~10 new cases listed above.
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/10-data-and-methodology.tji` carries `complete 100` for `coherency_self_referential_annotation_contradicts_rule` plus a `note "Refinement: ..."` line.

Tech-debt registration:

- [ ] **No new follow-ups from this task itself.** The parent audit's D3 named two candidate-future rules — `coherency_annotation_of_annotation_chain_rule` (done — 2026-05-30) and this rule (this task). With both landed, the D3 debt is fully paid down. The audit's other registered follow-ups (`contradiction_annotation_endpoint_semantics_audit`, `pending_consequences_annotation_endpoint_revisit`, and the UI-render follow-ups inherited from `projection_edge_annotation_endpoint`) are unrelated to this task's scope.

## Decisions

- **D1 — Bundle the `docs/methodology.md` enumeration into this task.** Rationale:
  - **Precedent.** The sibling `coherency_annotation_of_annotation_chain_rule` made exactly this choice (its D1) and the result was clean: methodology paragraph + rule + tests in a single commit cluster. Following the same precedent keeps both audit-named coherency rules on a symmetric landing pattern.
  - **The WBS note says "Conditional on `docs/methodology.md` enumerating the pattern".** As with the sibling task, the cleanest discharge is to write the docs paragraph in the same task. The alternative — a separate one-paragraph docs task — is overhead for no gain.
  - **Methodology silence is the audit-cited blocker.** The parent audit's D3 said "Adding [these rules] without a methodology citation would be speculation per the established 'structural diagnostics cite a methodology rule' convention." Landing the citation in this task satisfies the convention.
  - **Alternative considered: defer until a separate methodology-doc task lands the paragraph.** Rejected — same reasoning as the sibling rule rejected it: scheduling overhead, sync hazard, no architectural benefit.
  - **Alternative considered: write the rule with a TODO comment marking the docs citation as pending.** Rejected — speculative source code without methodology grounding, the failure mode the audit explicitly cautioned against.

- **D2 — Fire on both edge directions: `N → contradicts → A` AND `A → contradicts → N`.** Rationale:
  - **The smell is structurally symmetric.** The audit's D3 named the rule using the `N → contradicts → A` direction because that's the natural reading-order phrasing ("the node contradicts the annotation"). But the methodology-layer category error — formal `contradicts` between an entity and its metadata — is invariant under edge direction. `A → contradicts → N` reads "the annotation contradicts the thing it's annotating," which is the *same* misuse of the `contradicts` relation, with the same resolution (withdraw `A`).
  - **`contradicts` is a directed relation per `docs/data-model.md` line 122**, but directionality matters at the *substance* layer ("source rules out target"). The coherency hint is about the *structural* pattern (the topology of which entities are connected by `contradicts`), which is direction-agnostic.
  - **The hint payload is direction-agnostic.** `(edgeId, nodeId, annotationId)` identifies the involved entities; the UI can read `edge.sourceNodeId` / `edge.targetNodeId` / `edge.sourceAnnotationId` / `edge.targetAnnotationId` itself if it needs to render an arrow. The hint contract does not encode direction.
  - **Cost is minimal.** A single per-edge filter in the rule function handles both directions in one pass: identify the (node, annotation) pair on the edge regardless of which slot they occupy, then check the anchor-match property. No loop duplication.
  - **Alternative considered: fire only on `N → contradicts → A` (the audit-named direction).** Rejected — would leave the symmetric case silently unsurfaced, an asymmetry the moderator would have to learn. The parent audit's prose phrased the rule one way; the structural smell is symmetric.
  - **Alternative considered: split into two rule kinds, one per direction.** Rejected — adds a discriminator distinction with no downstream consumer benefit; the UI treats both as the same smell. Inflates the `HintKind` union and the identity-key surface for no reason.

- **D3 — Anchor scope: direct node-anchor only (`A.targetNodeId === N`); no edge-anchor variant.** Rationale:
  - **The audit's D3 phrasing pins this scope explicitly:** "node N → contradicts → annotation A where A annotates N". "A annotates N" is the data-model's direct-anchor relation (`A.targetNodeId === N`), not the transitive "A annotates an edge incident on N" relation.
  - **The edge-anchor variant raises a different methodology question.** `A` anchored on edge `E` where `E` has endpoint `N`, with `N → contradicts → A`: is `A` really about `N`, or is it about the *relation* `E`? The data model is clear that `A` is about `E`, not about `E`'s endpoints. Surfacing this as the same smell would conflate "annotation of relation" with "annotation of node".
  - **YAGNI.** No fixture today motivates the edge-anchor variant. If one ever does, a separate rule (or a widened scope on this rule, with its own decision) can be added then. Scoping narrowly now avoids burning ambiguity into the rule's contract.
  - **Alternative considered: include the edge-anchor variant (`A.targetEdgeId === E`, where `E` has `N` as endpoint, with `N → contradicts → A`).** Rejected — different methodology question; conflates annotation-of-relation with annotation-of-node; no motivating fixture.

- **D4 — Role scope: `contradicts` only.** Rationale:
  - **The audit's D3 named `contradicts` specifically.** Other roles are not in scope for this rule.
  - **Other roles have different self-referential readings, most of them benign:**
    - `supports`: "the node endorses its own commentary" — defensible (a participant agreeing with the substance of their own annotation).
    - `rebuts`: similar to `contradicts` but with different semantics in the data model; if it becomes a smell, it's a separate rule decision.
    - `qualifies`, `defines`, `bridges-from`, `bridges-to`: not coherent self-referential shapes; the rule would over-fire if it included them.
  - **`contradicts` is uniquely positioned as the formal-substance-conflict relation** (per data-model.md line 122). Pairing it with an annotation-on-self anchor is uniquely a category error.
  - **Alternative considered: widen to all roles, with the same anchor-match condition.** Rejected — over-fires; the smell is specific to `contradicts`.
  - **Alternative considered: include `rebuts` as well.** Rejected without a methodology citation — the audit didn't name `rebuts`; it would be speculation.

- **D5 — One hint per qualifying edge.** Rationale:
  - **Mirrors `self-contradicts` and `annotation-of-annotation-chain` per-edge identity shape.** Both existing-detector rules with edge-id-keyed identity emit one hint per edge; this rule follows the same pattern.
  - **The edge IS the smell.** No clustering across multiple edges is needed — each `(N, A)` pair with the self-referential property is its own diagnostic moment.
  - **Identity key is `coherency-hint\0self-referential-annotation-contradicts\0${edgeId}`.** Same shape as `self-contradicts` (L279–281) and `annotation-of-annotation-chain` (L283–288), so the `diffDiagnostics` machinery in `event-emission.ts` handles fired/cleared transitions identically.
  - **Alternative considered: dedupe by `(nodeId, annotationId)` pair.** Rejected — if two edges form the smell (e.g., the user lands two `contradicts` edges between the same node and annotation), each is a distinct authored event the moderator should see. Per-edge surfacing matches per-authored-act granularity.

- **D6 — Vitest unit cover; no Cucumber delta.** Rationale:
  - **The rule is unit-observable.** Same reasoning as the sibling `coherency_annotation_of_annotation_chain_rule`'s D4: detector input is a `Projection`, output is `CoherencyHint[]`; both ends are unit-testable.
  - **The round-trip-through-JSONB surface for annotation-endpoint edges is already pinned** by `projection_edge_annotation_endpoint`'s `from-log.feature` scenario. This task doesn't add a new persistence-boundary concern.
  - **A Cucumber pin would assert event-stream behaviour the unit test already covers** at higher per-case cost.
  - **ADR 0022 compliance.** Vitest satisfies the empirical-claims-have-tests requirement.
  - **Alternative considered: add a Cucumber scenario.** Rejected per the same reasoning the sibling rule and the parent audit applied — no Cucumber-layer-observable beyond what Vitest pins.

- **D7 — No new ADR.** Rationale:
  - **Established seam.** `coherency_hint_detection` is the detector; the rule-registry is the extension point; both pre-date this task. The rule uses the seam, doesn't change it.
  - **Methodology citation is editorial, not architectural.** Same reasoning as the sibling rule's D5.
  - **No new dependency, technology choice, or abstraction.** Pure read function over the existing projection.
  - **Alternative considered: an ADR titled "self-referential annotation contradicts is a coherency-hint smell."** Rejected — the position is fully captured by the docs paragraph and this refinement; ADR-isation adds no architectural specificity.

- **D8 — Test-helper additions: `createNodeToAnnotationEdge` + `createAnnotationToNodeEdge`.** Rationale:
  - **The existing helpers don't cover mixed-endpoint edges.** `createEdge` (node-to-node, L43–176) and the sibling's `createAnnotationEdge` (annotation-to-annotation, L178–219) leave mixed-endpoint cases without a helper. The new test cases need both directions of mixed-endpoint contradicts edges.
  - **Two thin parallel helpers are clearer than a single mixed-union helper.** Per the sibling's D6 reasoning (rejecting a tagged-union `createMixedEdge`): direction-tagged call sites read more directly than tagged-union parameters. `createNodeToAnnotationEdge(projection, edgeId, sourceNodeId, targetAnnotationId, role)` and `createAnnotationToNodeEdge(projection, edgeId, sourceAnnotationId, targetNodeId, role)` mirror the existing `createEdge` shape exactly, just with one endpoint swapped to its annotation-id counterpart.
  - **Both helpers wrap `applyEvent` + `makeEvent` the same way the existing helpers do.** No new abstraction over what already exists.
  - **Reuse target.** Each helper is called ~3× across the new test cases (positive direction, negative variants where direction matters, coexistence case). The reuse threshold the file's existing helpers established is met.
  - **Alternative considered: inline the events 6× per direction.** Rejected — clutters the file; the precedent for adding annotation-related helpers was just set by the sibling task and reusing the same precedent here is the path of least cognitive surface.
  - **Alternative considered: a single `createMixedEdge(projection, edgeId, source, target, role)` helper** with tagged-union source/target. Rejected per the sibling rule's D6 — tagged-union call sites parse slowly compared to direction-named call sites.

- **D9 — Rule placement: append after `detectAnnotationOfAnnotationChains`, last in `RULES`.** Rationale:
  - **The `RULES` array is the registry the predecessor established.** Each new rule appends at the end. Rule order is the determinism contract for `detectCoherencyHints` output (via `flatMap`).
  - **Logical grouping.** The detector now has two clusters: (1) v1 node-node rules (incomplete-warrant×2, self-contradicts), (2) annotation-endpoint rules (annotation-of-annotation-chain, this rule). Placement at the end keeps the annotation-endpoint pair adjacent in both source code order and `RULES` registration order — a future reader sees them as a unit.
  - **Alternative considered: place between `detectSelfContradicts` and `detectAnnotationOfAnnotationChains`** (grouping with the other `contradicts`-focused rule). Rejected — splits the annotation-endpoint cluster; rule ordering should reflect "how this fits" with the registry's growth pattern (annotation-endpoint rules at the end), not by edge-role affinity.
  - **Alternative considered: place adjacent to `detectSelfContradicts` and reorder `RULES` to match source order.** Rejected — reordering `RULES` is a no-op for downstream consumers (the union is unordered), but it churns the registry's stable shape, which downstream tests and the `diffDiagnostics` ordering rely on for determinism.

## Open questions

(none — all decided in D1–D9.)

## Status

**Done** — 2026-05-30.

- `docs/methodology.md` — added self-referential-annotation-contradicts paragraph to the coherency-hint catalogue, immediately below the annotation-of-annotation-chain entry.
- `apps/server/src/diagnostics/coherency-hint-detection.ts` — docblock updated (candidate→LANDED), new `'self-referential-annotation-contradicts'` `HintKind`, new `SelfReferentialAnnotationContradictsHint` interface, `CoherencyHint` union widened, new `detectSelfReferentialAnnotationContradicts` rule function, appended to `RULES` registry as the fifth entry.
- `apps/server/src/diagnostics/index.ts` — barrel re-export of `SelfReferentialAnnotationContradictsHint`.
- `apps/server/src/diagnostics/event-emission.ts` — new `case 'self-referential-annotation-contradicts':` in `coherencyHintIdentityKey` switch, new `selfReferentialAnnotationContradictsKey` helper.
- `apps/server/src/diagnostics/coherency-hint-detection.test.ts` — two new helpers (`createNodeToAnnotationEdge`, `createAnnotationToNodeEdge`) + new `describe` block `'self-referential-annotation-contradicts hints'` with 11 cases covering both directions, wrong role, anchor-mismatch, edge-anchor variant, both-annotation, both-node, three invisibility sub-cases, coexistence with `self-contradicts`, coexistence with `annotation-of-annotation-chain`.
- Tech-debt: none — audit D3's two candidate rules are both now landed; no follow-up registered.
