# Coherency hint: cross-anchor annotation-endpoint contradicts edge

**TaskJuggler entry**: `data_and_methodology.diagnostics.coherency_non_self_referential_annotation_contradicts_rule` — [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) (block at lines 352–366). Embedded note: *"Source of debt: contradiction_annotation_endpoint_semantics_audit D3. Candidate coherency-hint rule: one node endpoint + one annotation endpoint where annotation.targetNodeId !== nodeEndpoint.id (the anchor-match filter of the existing self-referential rule does NOT hold). Methodologically the same category error per docs/methodology.md L236, but not surfaced by any rule today. Conditional on docs/methodology.md enumerating the pattern as a named coherency hint (task bundles the methodology paragraph per the sibling rules' precedent). Includes Vitest cover; no Cucumber delta."*

## Effort estimate

**0.5d** (per the `.tji` allocation). Breakdown:

- **Methodology-doc edit (~1h).** Add one short paragraph to `docs/methodology.md`'s coherency-hint catalogue immediately below the existing self-referential-annotation-contradicts entry at [L236](../../../docs/methodology.md), naming the **cross-anchor** subset and stating its distinct resolution path (re-target the contradicts edge at the annotation's anchor node, or extract the annotation's substance as a peer node). Per D1 below, bundling the citation into the rule's own task mirrors the precedent the two sibling rules established for "conditional on methodology-doc enumeration" rules.
- **Rule implementation (~1h).** One new rule function in `apps/server/src/diagnostics/coherency-hint-detection.ts`, one new variant on `HintKind`, one new variant interface, one append to the `RULES` registry, one new variant on the `CoherencyHint` union, one export on the barrel, one identity-key case + helper in `event-emission.ts`.
- **Vitest cover (~1.5h).** Eight to ten cases: cross-anchor node→annotation positive (rule fires), cross-anchor annotation→node positive (rule fires per D2), self-referential anchor (no hint — owned by the sibling rule), wrong role, annotation anchors an edge, both-annotation endpoints, both-node endpoints, invisibility cases, coexistence with the sibling `self-referential-annotation-contradicts` on a different edge in the same projection.
- **WBS housekeeping (~0.5h).** Closer's responsibility — `complete 100` on `coherency_non_self_referential_annotation_contradicts_rule` plus the `note "Refinement: ..."` line.

No Cucumber delta (per D6 — the rule is unit-observable; the round-trip-through-JSONB shape for annotation-endpoint edges is already pinned by the predecessor `projection_edge_annotation_endpoint`'s `from-log.feature` scenario). No ADR (per D7 — adds a single advisory rule under an established detector seam). No DB migration. No projection-layer change. No UI consumer change in this task (the moderator-UI surfacing of annotation-endpoint edges is the already-named `mod_render_annotation_endpoint_edges`).

## Inherited dependencies

**Settled:**

- [`data_and_methodology.diagnostics.contradiction_annotation_endpoint_semantics_audit`](./contradiction_annotation_endpoint_semantics_audit.md) (done — 2026-05-30). The direct parent: its D3 named this rule with the exact shape "one node endpoint + one annotation endpoint where `annotation.targetNodeId !== nodeEndpoint.id`" and registered it as a candidate-future task conditional on methodology-doc enumeration, with explicit "~0.5d, includes Vitest cover; no Cucumber" framing. The audit's Vitest broadening at [`contradiction-detection.test.ts:570-586`](../../../apps/server/src/diagnostics/contradiction-detection.test.ts) already pins the *blocking*-detector-skip behaviour on the cross-anchor walkthrough-E15 shape; this task lands the *advisory*-detector-surface for the same shape, closing the moderator-visibility gap the audit named.
- [`data_and_methodology.diagnostics.coherency_self_referential_annotation_contradicts_rule`](./coherency_self_referential_annotation_contradicts_rule.md) (done — 2026-05-30). The parallel sibling: same parent-debt root (the annotation-endpoint contradicts pattern); same advisory-detector-surface seam; same bundled-methodology-paragraph + rule + barrel + identity-key + Vitest template. This refinement reuses that template verbatim wherever the shapes match, diverging only in: (a) the anchor-match filter is **inverted** (`annotation.targetNodeId !== nodeEndpoint.id`), and (b) the hint payload carries an additional `anchorNodeId` field naming the (distinct-from-the-edge-endpoint) node the annotation actually anchors on — per D8 a structurally-load-bearing piece of information for the cross-anchor case that the self-referential rule's payload does not need.
- [`data_and_methodology.diagnostics.coherency_hint_detection`](./coherency_hint_detection.md) (done — 2026-05-10). The detector this rule plugs into. Its rule-registry composition (`RULES: ReadonlyArray<(p: Projection) => CoherencyHint[]>` reduced via `flatMap`) is the extension seam.
- [`data_and_methodology.diagnostics.coherency_annotation_of_annotation_chain_rule`](./coherency_annotation_of_annotation_chain_rule.md) (done — 2026-05-30). Established the original precedent (alongside the self-referential rule landing later) for how an annotation-endpoint coherency rule lands: bundled methodology-doc paragraph + rule function + barrel export + identity-key + Vitest. This refinement's structure mirrors that precedent.
- [`data_and_methodology.projection.projection_edge_annotation_endpoint`](./projection_edge_annotation_endpoint.md) (done — 2026-05-30). Widened `ProjectedEdge` to polymorphic endpoints; without this widening, `node N1 → contradicts → annotation A (anchored on N2)` edges weren't structurally representable.
- [`data_and_methodology.event_types.edge_target_annotation_schema_extension`](./edge_target_annotation_schema_extension.md) (done — 2026-05-30). Wire-schema widening upstream — `edge-created` events can carry annotation endpoints.
- [`data_and_methodology.diagnostics.diagnostic_event_emission`](./diagnostic_event_emission.md) (done). Provides the `coherencyHintIdentityKey` switch that the new hint kind must be wired into.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). The rule ships as committed Vitest cases pinning both the positive (hint emits) and negative (no hint) shapes.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md). The non-self-referential-annotation-contradicts detection is purely entity-layer — no facet read; the rule fires regardless of substance-agreement state.

**Pending:** (none — every load-bearing predecessor is on `main` at task start; the parent audit and the sibling self-referential rule both landed on 2026-05-30.)

## What this task is

Add a new **advisory coherency-hint rule** — `non-self-referential-annotation-contradicts` — to the existing `coherency-hint-detection.ts` detector. The rule walks the projection and emits one hint per visible `contradicts` edge connecting a node `N1` to an annotation `A` where `A.targetNodeId !== null` AND `A.targetNodeId !== N1` (i.e., `A` annotates *some other node* `N2`, not `N1`).

Structurally: an edge `E` with `role === 'contradicts'` and one endpoint a node and the other endpoint an annotation, such that the annotation's anchor is a node *distinct from* the edge's node endpoint. Per D2 the rule fires in **both** edge directions — `N1 → contradicts → A` (the audit's E15 phrasing) and `A → contradicts → N1` — because the smell is structurally symmetric (the user has wired the formal `contradicts` relation between an entity and metadata-about-a-different-entity, and the methodology resolution is symmetric: re-target the edge at `N2` if the disagreement is with the annotated entity, or extract `A`'s substance as a peer node if the disagreement is with the annotation's specific claim).

The rule is structural-only and advisory. It does not read substance facets, does not depend on agreement state, and does not block any user action. The hint payload identifies the edge, the contradicting node (`nodeId`), the annotation (`annotationId`), AND the annotation's actual anchor node (`anchorNodeId`) — per D8 the third id is structurally necessary because the cross-anchor case's UI surfacing needs to highlight *three* entities (the user almost certainly wants the moderator to see N1, A, and the N2 the annotation actually points at).

Bundled into this task: a one-paragraph addition to `docs/methodology.md`'s coherency-hint catalogue enumerating the cross-anchor pattern immediately below the existing self-referential entry at L236 (per D1 below). Without that citation, the rule would have no methodology grounding — a violation of the established "every structural diagnostic cites a methodology rule" convention that the parent audit pinned and both sibling rules paid down by precedent.

Out of scope:

- **Re-auditing or lifting the `contradiction_detection` skip on cross-anchor edges.** Settled by the parent audit's D1 (keep-skip across all annotation-endpoint shapes × both anchor configurations × both edge directions). This task is the advisory follow-up the parent audit's D3 registered; it adds a *coherency-hint* surface for the cross-anchor case, complementing rather than replacing the `contradiction_detection` keep-skip.
- **Moderator-UI surfacing of coherency hints over annotation-endpoint edges.** `mod_render_annotation_endpoint_edges` (already named by `projection_edge_annotation_endpoint`) is the UI hook task; this task delivers detector output; UI consumption is downstream.
- **Self-referential annotation-endpoint contradicts edges (`A.targetNodeId === N`).** Already surfaced by the sibling `self-referential-annotation-contradicts` rule. Per D3 this task's anchor filter is *strictly cross-anchor* — the two rules partition the annotation-endpoint contradicts shape space along the anchor-match axis and do not overlap.
- **Edge-anchored annotations (`annotation.targetEdgeId !== null`).** Per the sibling rule's D3, the audit-pinned scope for annotation-endpoint coherency rules is direct node-anchor only. An annotation `A` anchored on an edge `E` (where `E` may itself have `N1` as endpoint) with `N1 → contradicts → A` raises a separate methodology question (is `A` really about `N1`, or about the relation `E`?). Out of scope; no fixture motivates it today.
- **Other roles on the same mixed-endpoint shape.** Only `contradicts` qualifies, mirroring the sibling rule's D4. A `supports` edge between `N1` and an annotation about `N2` is "the node endorses some commentary on another node" — defensible (a participant agrees with someone else's annotation). A `rebuts` edge has no clear cross-anchor reading in the methodology and is not named by the audit's D3.
- **Both-annotation endpoints whose annotations anchor on distinct nodes.** A `contradicts` edge `A1 → contradicts → A2` where `A1.targetNodeId === N1` and `A2.targetNodeId === N2` is a different shape — there is no `N`-endpoint *on the edge itself*; the smell would be "two annotations on different nodes contradict each other," which is a normal disagreement encoding (two participants annotating distinct nodes with conflicting commentary, formalising the conflict). Out of scope; the both-annotation contradicts shape is the audit's D1 keep-skip territory and the existing `annotation-of-annotation-chain` rule's territory; if it ever becomes a coherency hint, it is a separate rule.

## Why it needs to be done

**The parent audit named this candidate rule with a concrete methodology framing already in place.** The parent `contradiction_annotation_endpoint_semantics_audit` D3 identified this exact pattern as the unfilled half of the annotation-endpoint contradicts coverage. The sibling `self-referential-annotation-contradicts` rule covers the `A.targetNodeId === N` half; the cross-anchor half (`A.targetNodeId !== N`) is methodologically the same category error per [`docs/methodology.md` L236](../../../docs/methodology.md) but produces no diagnostic surface anywhere today. The audit deliberately did NOT implement the rule — that's this task's role.

**The smell is real, named by the walkthrough, and structurally detectable today.** The walkthrough's E15 case (per `docs/example-walkthrough.md` turn 22, L207) lands `N19 contradicts A2` where `A2` annotates `N6`, not `N19`. The anchor-match filter on the existing self-referential rule fails (anchor `N6` ≠ contradicting node `N19`), so no hint fires today. A realistic, narratively-documented fixture being silently invisible to the moderator is the canonical case for naming + landing this rule.

**Without this rule, the configuration is silently invisible to the moderator.** Cycle detection, multi-warrant detection, dangling-claim detection, and pending-consequences all skip annotation-endpoint edges (per the parent diagnostics audit D1/D2/D4/D5). `contradiction_detection` skips them too (per the parent audit's D1 + the skip-guard at `contradiction-detection.ts:108-112`). The existing coherency-hint rules are split: the self-referential rule covers the anchor-match subset; this rule covers the cross-anchor subset; without it, the cross-anchor case has zero diagnostic surface — the moderator has no system signal to spot the wrong layer being engaged.

**Symmetry with the sibling rule keeps the registered debt fully paid down.** The parent audit's D3 named this task explicitly with a stable id and a ~0.5d estimate; the sibling self-referential rule already landed; with this rule landed, the parent audit's named follow-ups under `data_and_methodology.diagnostics.*` are fully discharged.

## Inputs / context

**Design contract (doc-citation; the methodology-doc edit IS this task's deliverable, per D1):**

- [`docs/methodology.md`](../../../docs/methodology.md) line 236 — coherency-hint catalogue currently lists the **self-referential** annotation-endpoint contradicts pattern. This task adds a second entry immediately below it, naming the **cross-anchor** pattern, citing the shared L236 grounding ("`contradicts` as a substance-layer relation between peer entities") and stating the distinct resolution path (re-target the contradicts edge at the annotation's anchor node `N2`, or extract `A`'s substance as a peer node that can carry the contradiction at the substance layer).
- [`docs/data-model.md`](../../../docs/data-model.md) line 122 — `contradicts` edge definition. "Source and target conflict; both cannot be true. Directed." Establishes that `contradicts` is a substantive-disagreement encoding; pairing it with an annotation-on-a-different-node anchor is a methodology-layer category error in the same family as the self-referential case.
- [`docs/data-model.md`](../../../docs/data-model.md) lines 137–143 — annotations defined as first-class entities with their own facet set. The annotation lifecycle gives one resolution path (retract A, re-land the disagreement at the substance layer); the edge-restructure path gives the other (re-target the edge at `N2` if the disagreement is really with the annotated entity).
- [`docs/data-model.md`](../../../docs/data-model.md) lines 145–153 ("Coherency guidance") — the framing the rule lands under. "Some edge/node configurations are typical; others are unusual… advisory hints when an unusual configuration is created… The system never blocks; it nudges."
- [`docs/data-model.md`](../../../docs/data-model.md) lines 197–199 ("Coherency violations") — advisory, not blocking. The new rule lands as advisory per the established `blocking_vs_advisory_classification`.
- [`docs/example-walkthrough.md` line 207 (turn 22)](../../../docs/example-walkthrough.md) — the E15 fixture this rule's positive case generalises. `N19 contradicts A2` where `A2` annotates `N6`. The audit's D1 keeps the blocking-detector skip on this configuration; this rule's landing covers the advisory-surface half of the moderator-visibility gap.

**Architectural / engineering inputs:**

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). Vitest cover pins the rule's positive and negative behaviour.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md). The rule is entity-layer: it walks edges and annotations by ID; it does not read substance or wording facets.

**Runtime inputs (real file references the implementer reads + edits):**

- [`apps/server/src/diagnostics/coherency-hint-detection.ts`](../../../apps/server/src/diagnostics/coherency-hint-detection.ts):
  - L1–99 — top-of-file docblock. L58–82 currently lists two LANDED annotation-endpoint rules (`annotation-of-annotation-chain` at L64–70, `self-referential-annotation-contradicts` at L71–81). The rule's landing appends a third LANDED entry naming the cross-anchor pattern with its anchor-mismatch property, mirroring the prose shape of the existing entries.
  - L115–120 — `HintKind` string-literal union. Adds the new discriminator value `'non-self-referential-annotation-contradicts'`.
  - L191–213 — per-rule hint interfaces (the existing `SelfReferentialAnnotationContradictsHint` at L207–213). Adds the new variant interface (see Acceptance criteria for the exact shape — payload differs from the sibling by carrying `anchorNodeId` per D8).
  - L218–223 — `CoherencyHint` discriminated union. Widens with the new variant.
  - L457–507 — the existing `detectSelfReferentialAnnotationContradicts` rule. The new rule sits immediately after it (per D9 — the annotation-endpoint contradicts pair lives adjacent; the cross-anchor rule is the second of the pair).
  - L525–531 — `RULES` registry. Appends the new rule function as the sixth (and last) entry.
- [`apps/server/src/diagnostics/coherency-hint-detection.test.ts`](../../../apps/server/src/diagnostics/coherency-hint-detection.test.ts):
  - L178–262 — existing helpers `createAnnotation`, `createAnnotationEdge`, `createNodeToAnnotationEdge`, `createAnnotationToNodeEdge` (added by the prior sibling tasks). All four helpers are reused unchanged; the new cases need a second node fixture id (the annotation's anchor node distinct from the contradicting node endpoint), available from the existing `NODE_*` constant pool.
  - The new positive and negative cases sit in a new `describe` block `'non-self-referential-annotation-contradicts hints'`, placed alongside (after) the sibling task's `'self-referential-annotation-contradicts hints'` block.
- [`apps/server/src/diagnostics/index.ts`](../../../apps/server/src/diagnostics/index.ts) L25–34 — barrel re-exports for coherency hints. Adds the new variant type to the re-export list (extending the existing list that already includes the four prior coherency-hint variant types).
- [`apps/server/src/diagnostics/event-emission.ts`](../../../apps/server/src/diagnostics/event-emission.ts) L259–300 — `coherencyHintIdentityKey` switch and per-variant key helpers. Adds a new case + helper for the new hint kind. Identity is the edge id (one diagnostic per qualifying edge, mirroring the four existing edge-id-keyed coherency-hint identity shapes).
- [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) — graph-walking methods. The rule uses `projection.edges()` to enumerate edges and `projection.getAnnotation(annotationId)` to read `A.targetNodeId`. Both are already in use by the sibling rule.
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) L236–261 — `ProjectedEdge` and `ProjectedAnnotation`. The rule reads `edge.role`, `edge.sourceNodeId`, `edge.sourceAnnotationId`, `edge.targetNodeId`, `edge.targetAnnotationId`, `edge.visible`, `edge.id`, plus `annotation.targetNodeId` and `annotation.visible`. No new field needed.
- [`apps/server/src/diagnostics/contradiction-detection.test.ts:570-595`](../../../apps/server/src/diagnostics/contradiction-detection.test.ts) — parent-audit fixtures pinning *zero blocking findings* on the cross-anchor shape (lines 570–586 + the directional sibling at L588–600). Read for fixture-shape reference; the new advisory-rule positive cases use the same anchor topology and assert *one advisory hint* on the same shape, complementing the blocking-side negative pin.

## Constraints / requirements

- **Pure read function over the projection.** Same shape as the other rule functions in the detector — `(projection: Projection) => NonSelfReferentialAnnotationContradictsHint[]`, no side effects, no DB access, no event emission. Repeated calls yield identical output.
- **Structural-only — no substance-agreement gate.** The rule fires regardless of whether the edge's substance is agreed or disputed and regardless of the annotation's wording/substance state. Mirrors the v1 coherency-hint rules' and the sibling annotation-endpoint rules' structural-only stance.
- **Visibility filter.** Edge must have `visible === true`. The node endpoint must exist on the projection AND be visible. The annotation endpoint must exist on the projection AND be visible. The annotation's anchor node (`A.targetNodeId`) — when distinct from the edge's node endpoint — does NOT need to be visible for the hint to fire (per D10 — the smell is structurally about how the contradicts edge is wired, not about the downstream node's projection state; an invisible anchor target hides the rule's diagnostic value but the wire is still wrong, and the existing self-referential rule's visibility filter is on the edge's *direct* endpoints only).
- **Role filter.** Only `edge.role === 'contradicts'` qualifies. Other roles are out of scope per the parent audit D3.
- **Mixed-endpoint filter.** Same as the sibling rule — the edge must have exactly one node endpoint and exactly one annotation endpoint — i.e., either `(sourceNodeId !== null && targetAnnotationId !== null && sourceAnnotationId === null && targetNodeId === null)` OR the symmetric `(sourceAnnotationId !== null && targetNodeId !== null && sourceNodeId === null && targetAnnotationId === null)`. Both-node and both-annotation edges are out of scope (the existing `self-contradicts`, `annotation-of-annotation-chain`, and the parent audit's keep-skip handle those respective configurations).
- **Anchor-mismatch filter (the inverse of the sibling rule).** `annotation.targetNodeId !== null` AND `annotation.targetNodeId !== nodeEndpoint.id`. An annotation with `targetNodeId === null` (an edge-anchored annotation) is excluded per D3. An annotation with `targetNodeId === nodeEndpoint.id` (the self-referential case) is excluded per D4 — that subset is the sibling rule's territory.
- **One hint per qualifying edge.** No deduplication, no clustering. Same per-edge-incident stance as the four existing edge-id-keyed coherency rules.
- **Rule appended, not inlined.** New rule function lives at the bottom of the existing per-rule section in `coherency-hint-detection.ts`, immediately above the `RULES` array. Appended to `RULES` in declaration order — the new rule fires last among the six.
- **Methodology-doc citation as a deliverable.** Per D1, the rule's landing includes a one-paragraph addition to `docs/methodology.md` naming the cross-anchor pattern.
- **No new ADR.** Per D7, the rule lands under the established coherency-hint seam.
- **No Cucumber delta.** Per D6, the rule is unit-observable; the persistence layer for annotation-endpoint edges is already pinned.
- **Existing rules unmodified.** The five prior rules (incomplete-warrant ×2, self-contradicts, annotation-of-annotation-chain, self-referential-annotation-contradicts) keep their behaviour; this task is additive. In particular, the sibling self-referential rule's anchor-match filter (`annotation.targetNodeId === nodeId`) stays unchanged — the two rules' filters are mutually exclusive and partition the mixed-endpoint contradicts shape space.

## Acceptance criteria

Pinned per ADR 0022 — every empirical check ships as committed test cover. Per D6 the test layer here is Vitest unit. Per the refinement README's policy this is a methodology-engine-adjacent task; UI-stream Playwright cover does not apply (the detector output is consumed by a separate UI task downstream).

Methodology-doc citation:

- [ ] [`docs/methodology.md`](../../../docs/methodology.md) coherency-hint section (immediately below the self-referential-annotation-contradicts entry at L236) gains one paragraph naming the `non-self-referential-annotation-contradicts` pattern. Suggested wording: *"**Cross-anchor annotation contradicts (node ↔ annotation-on-a-different-node)** — a `contradicts` edge between a node `N1` and an annotation `A` whose anchor is some other node `N2` (`A.targetNodeId !== N1`) indicates the formal contradiction mechanism is being applied between an entity and metadata-about-a-different-entity — the same category error as the self-referential case, with two natural resolutions: re-target the contradicts edge at `N2` if the disagreement is with the annotated entity, or extract `A`'s substance as a peer node that can carry the contradiction at the substance layer. Surfaced as advisory; fires in both edge directions (`N1 → contradicts → A` and `A → contradicts → N1`) because the structural smell is symmetric."* The rule's source comment cites this paragraph by line range.

Source — `apps/server/src/diagnostics/coherency-hint-detection.ts`:

- [ ] `HintKind` string-literal union extended with `'non-self-referential-annotation-contradicts'`.
- [ ] New variant interface `NonSelfReferentialAnnotationContradictsHint = { kind: 'non-self-referential-annotation-contradicts'; edgeId: string; nodeId: string; annotationId: string; anchorNodeId: string }`. The four IDs are the qualifying edge, the node endpoint of that edge, the annotation endpoint of that edge, AND the annotation's actual anchor node (`A.targetNodeId`, structurally guaranteed distinct from `nodeId` by the rule's anchor-mismatch filter). Per D8 the `anchorNodeId` field is the structurally load-bearing difference from the sibling rule's payload — the UI surface needs to highlight three entities to render the cross-anchor smell legibly.
- [ ] `CoherencyHint` discriminated union widened to include `NonSelfReferentialAnnotationContradictsHint`.
- [ ] New rule function `detectNonSelfReferentialAnnotationContradicts(projection: Projection): NonSelfReferentialAnnotationContradictsHint[]`. Iterates `projection.edges()`; for each visible edge with `role === 'contradicts'` and exactly one node endpoint + one annotation endpoint, looks up the annotation via `projection.getAnnotation(annotationId)`; if the annotation is visible AND `annotation.targetNodeId !== null` AND `annotation.targetNodeId !== node.id` AND the node endpoint is itself visible, emits one hint carrying `(edgeId, nodeId, annotationId, anchorNodeId)` where `anchorNodeId === annotation.targetNodeId`. Walks both endpoint directions in a single pass — see D2 for the direction handling.
- [ ] `RULES` registry appended with the new rule function — in declaration order it is the sixth and last rule.
- [ ] Top-of-file docblock paragraph (extending the existing L58–82 annotation-endpoint section) updated with a third LANDED entry naming the cross-anchor pattern, mirroring the prose shape of the existing self-referential and chain entries.

Source — `apps/server/src/diagnostics/index.ts`:

- [ ] Barrel re-export list (L25–34) widened to include `type NonSelfReferentialAnnotationContradictsHint`.

Source — `apps/server/src/diagnostics/event-emission.ts`:

- [ ] `coherencyHintIdentityKey` switch (L259–272) gains a `case 'non-self-referential-annotation-contradicts':` branch returning `nonSelfReferentialAnnotationContradictsKey(hint)`.
- [ ] New helper `nonSelfReferentialAnnotationContradictsKey(hint)` returning `` `coherency-hint\0non-self-referential-annotation-contradicts\0${hint.edgeId}` ``. Identity is the edge id, mirroring the four existing edge-id-keyed coherency-hint identity shapes — one diagnostic per qualifying edge.
- [ ] Existing `coherencyHintIdentityKey` switch exhaustiveness stays compile-clean against the widened union (the switch is currently exhaustive over five `HintKind` variants; widening to six requires the new case to keep TypeScript happy).

Vitest cover — `apps/server/src/diagnostics/coherency-hint-detection.test.ts` (new `describe` block: `'non-self-referential-annotation-contradicts hints'`):

- [ ] **Positive — `node N1 → contradicts → annotation A` where `A` annotates `N2` (cross-anchor), one hint.** Seed: nodes `N1` and `N2`, annotation `A` with `targetNodeId === N2.id`, edge `E: N1 → contradicts → A`. Assert exactly one `non-self-referential-annotation-contradicts` hint with `(edgeId: E.id, nodeId: N1.id, annotationId: A.id, anchorNodeId: N2.id)`. Generalises the walkthrough E15 shape.
- [ ] **Positive — `annotation A → contradicts → node N1` where `A` annotates `N2` (cross-anchor), one hint (per D2).** Same anchor shape as above; edge direction reversed. Assert the same hint payload (the `nodeId` and `annotationId` fields are direction-agnostic; `anchorNodeId` is the annotation's `targetNodeId` regardless of edge direction).
- [ ] **Negative — self-referential anchor (`A.targetNodeId === N1`).** Same shape as the first positive but the annotation anchors on `N1` itself (the contradicting node endpoint). Assert no `non-self-referential-annotation-contradicts` hint — this case is owned by the sibling rule. Pins the anchor-mismatch filter from D4.
- [ ] **Negative — wrong role.** Same cross-anchor shape but `role === 'supports'` (or `'rebuts'`). Assert no `non-self-referential-annotation-contradicts` hint. Pins the role filter from D5.
- [ ] **Negative — annotation anchors an edge (not a node).** Cross-anchor-shaped edge with `A.targetEdgeId === someOtherEdgeId` and `A.targetNodeId === null`. Assert no hint. Pins D3 (edge-anchor variant is out of scope).
- [ ] **Negative — both endpoints are annotations.** Edge `A1 → contradicts → A2`, both `A1` and `A2` anchor on distinct nodes from each other AND from any potential edge endpoint. Assert no `non-self-referential-annotation-contradicts` hint (the mixed-endpoint filter excludes both-annotation edges).
- [ ] **Negative — both endpoints are nodes.** Standard `N1 → contradicts → N2` edge. Assert no hint from this rule (the mixed-endpoint filter excludes both-node edges; the existing `self-contradicts` rule handles the `N → N` self-loop case).
- [ ] **Negative — invisibility breaks the hint.** Three sub-cases: invisible edge; invisible node endpoint; invisible annotation endpoint. Each assert no hint. (Per D10 the anchor-node's visibility is **not** a hint suppressor; this is verified separately below.)
- [ ] **Edge case — anchor node invisible, hint still fires.** Cross-anchor shape with `A.targetNodeId === N2.id` and `N2.visible === false`. Assert one hint with `anchorNodeId === N2.id` (the rule's filter is on the *edge's* visible endpoints; the anchor node's projection state does not gate the hint per D10). Pins the visibility-filter scope.
- [ ] **Coexistence with `self-referential-annotation-contradicts` on a different edge in the same projection.** Build a projection with one cross-anchor edge `E1: N1 → contradicts → A1` (`A1.targetNodeId === N2`) AND one self-referential edge `E2: N3 → contradicts → A2` (`A2.targetNodeId === N3`). Assert two hints — one from each rule — in rule-declaration order (`self-referential-annotation-contradicts` before `non-self-referential-annotation-contradicts`). Pins the two rules' partition of the mixed-endpoint contradicts shape space.

Existing tests stay green:

- [ ] Every existing Vitest suite passes — including the parent audit's broadened pins (which assert zero *blocking* contradiction-detection findings on cross-anchor edges; this task adds *advisory* coherency-hint surface on the same shape, complementing rather than conflicting with the blocking-side pin).
- [ ] Every existing Cucumber feature passes.
- [ ] Every existing Playwright suite passes.

Build + scheduler:

- [ ] `pnpm -F @a-conversa/server build` succeeds.
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green; Vitest baseline rises by the ~10 new cases listed above.
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/10-data-and-methodology.tji` carries `complete 100` for `coherency_non_self_referential_annotation_contradicts_rule` plus a `note "Refinement: ..."` line.

Tech-debt registration:

- [ ] **No new follow-ups from this task itself.** The parent audit's D3 named exactly one candidate-future rule (this rule); with it landed, the audit's tech-debt registration is fully discharged. The two sibling annotation-endpoint coherency rules also have no outstanding annotation-endpoint coherency-hint follow-ups; the `mod_render_annotation_endpoint_edges` UI-render follow-up (inherited from `projection_edge_annotation_endpoint`) is unrelated to this task's scope.

## Decisions

- **D1 — Bundle the `docs/methodology.md` enumeration into this task.** Rationale:
  - **Precedent — two siblings already made this choice.** Both `coherency_annotation_of_annotation_chain_rule` (D1) and `coherency_self_referential_annotation_contradicts_rule` (D1) bundled the methodology paragraph; the result in each case was a clean single-commit-cluster landing. Following the same precedent keeps all three annotation-endpoint coherency rules on a symmetric landing pattern.
  - **The WBS note says "Conditional on `docs/methodology.md` enumerating the pattern as a named coherency hint (task bundles the methodology paragraph per the sibling rules' precedent)".** This task's `.tji` block is explicit about following the precedent.
  - **Methodology silence on cross-anchor is the audit-cited blocker.** The parent audit's D3 named this rule with the explicit grounding that the cross-anchor case is "methodologically the same category error per docs/methodology.md L236, but not surfaced by any rule today." The L236 entry IS framed around the self-referential anchor configuration; the cross-anchor case needs its own catalogue entry with its own distinct resolution-path framing to satisfy the "every structural diagnostic cites a methodology rule" convention.
  - **Alternative considered: defer until a separate methodology-doc task lands the paragraph.** Rejected per the two siblings' identical reasoning: scheduling overhead, sync hazard, no architectural benefit.
  - **Alternative considered: rely on the existing L236 entry without adding a new paragraph (interpret L236's "between an entity and its own commentary" framing as covering the cross-anchor case too).** Rejected — L236 is explicit about the "own annotation" anchor configuration; the cross-anchor case has a distinct resolution path (re-target the edge at `N2`, vs. withdraw the annotation), and the UI surface that reads this rule's hint will surface a different recommendation than the self-referential rule's hint. Two distinct named coherency hints with two distinct methodology paragraphs is the path-of-most-clarity for the moderator.

- **D2 — Fire on both edge directions: `N1 → contradicts → A` AND `A → contradicts → N1`.** Rationale:
  - **The sibling rule's D2 reasoning transfers unchanged.** The cross-anchor smell — formal `contradicts` between an entity and metadata-about-a-different-entity — is invariant under edge direction. Both directions encode the same category error; both have the same suggested resolutions.
  - **The walkthrough E15 picks one direction (`N19 → contradicts → A2`), but the smell is symmetric.** The audit's D3 phrasing didn't pin direction; the parent audit's broadened test cover at `contradiction-detection.test.ts:570-600` pins zero blocking findings in *both* directions, treating the structural property as direction-agnostic. This rule's positive cover matches.
  - **Cost is minimal.** A single per-edge filter handles both directions in one pass: identify the (node, annotation) pair on the edge regardless of which slot they occupy, then check the anchor-mismatch property. Same code shape as the sibling rule's direction handling.
  - **The hint payload is direction-agnostic.** `(edgeId, nodeId, annotationId, anchorNodeId)` identifies the involved entities; the UI can read `edge.sourceNodeId` / `edge.targetNodeId` / `edge.sourceAnnotationId` / `edge.targetAnnotationId` itself if it needs to render an arrow.
  - **Alternative considered: fire only on `N1 → contradicts → A` (the walkthrough direction).** Rejected — same reasoning as the sibling rule: would leave the symmetric case silently unsurfaced, an asymmetry no methodology basis justifies.
  - **Alternative considered: split into two rule kinds, one per direction.** Rejected — same reasoning as the sibling rule: discriminator inflation with no downstream consumer benefit.

- **D3 — Anchor scope: direct node-anchor only (`annotation.targetNodeId !== null` AND `!== nodeEndpoint.id`); no edge-anchor variant.** Rationale:
  - **The audit's D3 phrasing pins this scope explicitly:** "one node endpoint + one annotation endpoint where annotation.targetNodeId !== nodeEndpoint.id". An annotation with `targetNodeId === null` (i.e., an edge-anchored annotation) does not match this filter.
  - **Sibling rule's D3 already settled the methodology question for edge-anchored annotations.** Same reasoning carries over: the edge-anchor variant raises a separate question (is `A` really about `N1`, or about the relation `E`?); no fixture motivates it today; YAGNI.
  - **Filter shape — both an inequality AND a not-null guard.** `annotation.targetNodeId !== null && annotation.targetNodeId !== nodeEndpoint.id`. The not-null guard is necessary because TypeScript's `!== ` returns `true` when comparing `null !== someString`, but the methodology grounding requires a node-anchored annotation (`targetNodeId` is the anchored node), not an edge-anchored one. Failing to check the not-null case would over-fire the rule on edge-anchored annotations, conflating two structural patterns the methodology may want to surface differently.
  - **Alternative considered: drop the not-null guard, letting edge-anchored annotations fire as cross-anchor hints.** Rejected — over-fires; conflates two distinct methodology questions.

- **D4 — Mutual exclusion with the sibling self-referential rule (the anchor-match filters partition the shape space).** Rationale:
  - **Filter shapes are inverses.** Sibling rule: `annotation.targetNodeId === nodeId`. This rule: `annotation.targetNodeId !== null && annotation.targetNodeId !== nodeId`. By construction, exactly one rule (or neither, for edge-anchored annotations) fires per mixed-endpoint contradicts edge.
  - **Distinct resolutions justify distinct rules.** Self-referential case → "withdraw the annotation" (single resolution). Cross-anchor case → "re-target the edge at `N2`" OR "extract `A`'s substance as a peer node" (two natural resolutions, both at the substance layer). The UI surfacing differs; the hints carry different payloads (the cross-anchor payload includes `anchorNodeId` per D8).
  - **The two rules together cover the audit's full named pattern.** Sibling: half-1. This rule: half-2. Both halves landed → the audit's D3 debt is fully discharged.
  - **Alternative considered: a single rule that fires on both subsets, with a discriminator field on the payload (e.g., `anchorMatch: boolean`).** Rejected for several reasons: (a) inflates the hint payload with a structural-property bit the UI would have to switch on anyway, (b) hides the distinct-resolution distinction from the type system (a discriminated union with two `HintKind` variants makes the dual nature first-class), (c) the audit's D3 named two slots in two different tasks (the parent audit named this slot; the predecessor audit named the self-referential slot via `diagnostics_annotation_endpoint_semantics_audit` D3) — collapsing them into one rule retrofits a different shape onto the audit's pre-existing decomposition.
  - **Alternative considered: extend the sibling self-referential rule's payload to optionally carry `anchorNodeId` and have it fire on both subsets, treating the self-referential case as the "anchor matches" subcase.** Rejected — would retroactively change the sibling rule's contract (its payload semantics, its `kind` field) and turn a partition-into-two-orthogonal-rules into a parameterised-rule shape; churn for no architectural gain.

- **D5 — Role scope: `contradicts` only.** Rationale:
  - **The parent audit's D3 named `contradicts` specifically.** Other roles are not in scope for this rule.
  - **The sibling rule's D4 reasoning transfers unchanged.** Other roles have different cross-anchor self-referential readings, most of them benign:
    - `supports`: "the node endorses commentary on another node" — defensible (a participant agreeing with someone else's annotation).
    - `rebuts`: similar to `contradicts` but with different semantics; if it becomes a smell, it is a separate rule decision per the sibling D4.
    - `qualifies`, `defines`, `bridges-from`, `bridges-to`: not coherent cross-anchor self-referential shapes; the rule would over-fire if it included them.
  - **`contradicts` is uniquely positioned** per [`docs/data-model.md` L122](../../../docs/data-model.md) as the formal-substance-conflict relation; pairing it with an annotation-on-a-different-node anchor is uniquely a category error.
  - **Alternative considered: widen to all roles with the same cross-anchor condition.** Rejected — over-fires; the smell is specific to `contradicts`.
  - **Alternative considered: include `rebuts` as well.** Rejected without a methodology citation — the audit didn't name `rebuts`; it would be speculation.

- **D6 — Vitest unit cover; no Cucumber delta.** Rationale:
  - **The rule is unit-observable.** Same reasoning as both siblings' Cucumber-skip Decisions: detector input is a `Projection`, output is `CoherencyHint[]`; both ends are unit-testable.
  - **The round-trip-through-JSONB surface for annotation-endpoint edges is already pinned** by `projection_edge_annotation_endpoint`'s `from-log.feature` scenario. This task doesn't add a new persistence-boundary concern.
  - **A Cucumber pin would assert event-stream behaviour the unit test already covers** at higher per-case cost.
  - **ADR 0022 compliance.** Vitest satisfies the empirical-claims-have-tests requirement.
  - **Alternative considered: add a Cucumber scenario.** Rejected per the same reasoning the sibling rules and the parent audit applied — no Cucumber-layer-observable beyond what Vitest pins.

- **D7 — No new ADR.** Rationale:
  - **Established seam.** `coherency_hint_detection` is the detector; the rule-registry is the extension point; both pre-date this task. The rule uses the seam, doesn't change it.
  - **Methodology citation is editorial, not architectural.** Same reasoning as both siblings' "no ADR" Decisions.
  - **No new dependency, technology choice, or abstraction.** Pure read function over the existing projection.
  - **Alternative considered: an ADR titled "cross-anchor annotation contradicts is a coherency-hint smell".** Rejected — the position is fully captured by the docs paragraph and this refinement; ADR-isation adds no architectural specificity.

- **D8 — Hint payload carries four IDs: `(edgeId, nodeId, annotationId, anchorNodeId)`.** Rationale:
  - **The cross-anchor case has three structurally-distinct entities** (the contradicting node `N1`, the annotation `A`, and the annotation's anchor node `N2`). All three are load-bearing for the UI surface: `N1` is the edge endpoint to highlight; `A` is the annotation the moderator is being nudged to act on (re-target or restructure); `N2` is the entity `A` is actually about — without it, the moderator can't tell what the annotation is commentary on.
  - **The sibling self-referential rule's payload has three IDs** because the anchor node and the edge-endpoint node are the same (`A.targetNodeId === N`); this rule's payload has four because they are distinct by construction. The extra field is the structurally load-bearing difference between the two rules' shapes.
  - **`anchorNodeId` is redundant with `projection.getAnnotation(annotationId).targetNodeId`** — the UI could look it up itself. But the rule has already done the lookup to apply the anchor-mismatch filter; carrying the result in the payload saves the UI from re-looking-up and makes the structural witness for the hint self-evident from the payload alone (a reader doesn't have to remember "oh, this hint type means the annotation's anchor is distinct from `nodeId`; let me look up which one").
  - **Alternative considered: a three-ID payload `(edgeId, nodeId, annotationId)` matching the sibling rule's shape.** Rejected — the UI would have to look up the annotation's anchor to surface the smell legibly; pushes a structural-witness lookup downstream that the rule has already performed; obscures the cross-anchor distinction from the type system (a reader of `NonSelfReferentialAnnotationContradictsHint` shouldn't have to consult the rule's source to see what makes the case "cross-anchor").
  - **Alternative considered: a five-ID payload that also includes the annotation's wording or kind for UI prefetch.** Rejected — the rule is structural; substance prefetch is a UI concern; widening the payload with non-structural fields conflates layers and creates an entity-coupling the rule shouldn't impose.

- **D9 — Rule placement: append after `detectSelfReferentialAnnotationContradicts`, last in `RULES`.** Rationale:
  - **The annotation-endpoint contradicts pair belongs adjacent.** With this rule landing, the detector has three clusters: (1) v1 node-node rules (incomplete-warrant ×2, self-contradicts), (2) annotation-of-annotation-chain (its own cluster — it is the only depth-based annotation-endpoint rule), (3) annotation-endpoint contradicts pair (self-referential, non-self-referential). Placement immediately after `detectSelfReferentialAnnotationContradicts` keeps the contradicts pair adjacent in both source code order and `RULES` registration order — a future reader sees them as a partition of the same shape space.
  - **Append-only is the registry's convention.** The two siblings established it; the cross-anchor rule extends the registry by one entry at the end. Rule order is the determinism contract for `detectCoherencyHints` output (via `flatMap`).
  - **Alternative considered: place between `detectSelfContradicts` and `detectAnnotationOfAnnotationChains`** (cluster all contradicts-focused rules together). Rejected — splits the annotation-endpoint cluster from the chain rule and inserts the new rule in the middle of the existing rule order, changing the visible `RULES` order for downstream tests that depend on rule-declaration order. The sibling rule landed at the end; this rule lands immediately after it; declaration-order grows monotonically.
  - **Alternative considered: place adjacent to `detectSelfReferentialAnnotationContradicts` and reorder `RULES` so the contradicts pair lives between `detectSelfContradicts` and `detectAnnotationOfAnnotationChains`.** Rejected — reordering churns the registry's stable shape; downstream tests and the `diffDiagnostics` ordering rely on the existing declaration order for determinism.

- **D10 — Visibility filter scope: edge + edge's two direct endpoints; NOT the annotation's anchor node.** Rationale:
  - **The smell is about how the contradicts edge is wired.** The qualifying edge has two endpoints (the node `N1` and the annotation `A`); the annotation's anchor node `N2` is structurally adjacent but not on the edge. A `contradicts` edge with `N1` as endpoint is a misuse-of-the-relation whether or not `N2` is currently visible.
  - **The sibling self-referential rule's visibility filter is on the edge's direct endpoints only** — it does not have a separate "anchor node" to check because `nodeId === annotation.targetNodeId` by construction (the anchor IS the edge endpoint). Extending visibility to the anchor node here would impose an asymmetric filter not present in the sibling rule, for a property that doesn't structurally matter.
  - **An invisible anchor node still appears in the hint payload.** The UI can choose to render the hint differently when `anchorNodeId` is invisible (e.g., "the annotation `A` points at a hidden/withdrawn node; consider withdrawing `A` too"), but the rule's job is to surface the structural smell, not to filter on downstream rendering preferences.
  - **One Vitest case pins this scope explicitly** (the "anchor node invisible, hint still fires" case under Acceptance). A future contributor who reads the rule's visibility filter and wonders "should we check the anchor too?" lands on a committed test case answering "no, here is the pinned behaviour."
  - **Alternative considered: extend the visibility filter to the anchor node — suppress the hint when `A.targetNodeId` points at an invisible node.** Rejected — asymmetric with the sibling rule's filter; surfaces a downstream-rendering concern at the detector layer; the structural smell is independent of the anchor's projection state.

## Open questions

(none — all decided in D1–D10.)

## Status

**Done** — 2026-05-30.

- Landed advisory `non-self-referential-annotation-contradicts` coherency-hint rule in `apps/server/src/diagnostics/coherency-hint-detection.ts`: new `HintKind` variant, `NonSelfReferentialAnnotationContradictsHint` interface (carrying `edgeId`, `nodeId`, `annotationId`, `anchorNodeId`), `detectNonSelfReferentialAnnotationContradicts` rule function, appended to `RULES` as sixth (last) entry, updated top-of-file docblock with third LANDED annotation-endpoint entry.
- Widened `CoherencyHint` discriminated union in `apps/server/src/diagnostics/coherency-hint-detection.ts` to include the new variant.
- Added barrel re-export of `NonSelfReferentialAnnotationContradictsHint` in `apps/server/src/diagnostics/index.ts`.
- Added `case 'non-self-referential-annotation-contradicts':` branch and `nonSelfReferentialAnnotationContradictsKey` helper in `apps/server/src/diagnostics/event-emission.ts`; identity is edge id, mirroring the four existing edge-id-keyed coherency-hint shapes.
- Added methodology paragraph to `docs/methodology.md` naming the "Cross-anchor annotation contradicts" pattern immediately below the self-referential entry.
- Vitest cover: 12 cases in new `describe` block `'non-self-referential-annotation-contradicts hints'` in `apps/server/src/diagnostics/coherency-hint-detection.test.ts` — 2 positives (both edge directions), 1 self-referential-anchor negative, 1 wrong-role negative, 1 edge-anchor negative, 1 both-annotation negative, 1 both-node negative, 3 invisibility sub-cases, 1 anchor-invisible-fires edge case, 1 sibling-coexistence case. One pre-existing self-referential test scoped to `self-referential-annotation-contradicts` (the cross-anchor positive shape it originally asserted now legitimately fires the new rule; assertion scoped via `.filter(...)` mirroring the both-annotation/both-node pattern).
