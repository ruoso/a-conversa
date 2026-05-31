# Annotation-of-annotation overlay propagation on materialized audience annotation graph-nodes

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_graph_rendering.aud_annotation_of_annotation_overlay_chain` (block at [L335-348](../../50-audience-and-broadcast.tji#L335)). Embedded note: *"Source of debt: participant_ui.part_annotation_of_annotation_overlay_chain (done 2026-05-30). The audience Cytoscape canvas uses groupAnnotationsByNode to derive its annotation index; the parallel propagation (annotation A1 with target_node_id = A2's UUID overlays on A2's annotation graph-node) requires migrating the audience to groupAnnotationsByEntityId and adding parallel Vitest cover. Gated on aud_render_annotation_endpoint_edges landing first so annotation graph-nodes exist as canvas targets."*

## Effort estimate

**0.5d** (per the `.tji` allocation). The work spans:

- **Bucketer call-site rename (~15min).** [`apps/audience/src/graph/projectGraph.ts:145`](../../../apps/audience/src/graph/projectGraph.ts) (named import) and [`apps/audience/src/graph/projectGraph.ts:331`](../../../apps/audience/src/graph/projectGraph.ts) (call site inside `projectGraph`) migrate from `groupAnnotationsByNode` to `groupAnnotationsByEntityId`. The local variable name `nodeAnnotationIndex` is preserved (D2 — mirrors the participant's D3 verbatim). The runtime is byte-for-byte unchanged at this step; the rename makes the polymorphic-entity-id intent legible at the audience surface.
- **Thread `nodeAnnotationIndex` into `projectAnnotationNodes` so promoted annotation graph-nodes carry annotations targeting them (~1.5h).** Today [`apps/audience/src/graph/annotations.ts:148-177`](../../../apps/audience/src/graph/annotations.ts) — `projectAnnotationNodes` — always stamps `annotations: EMPTY_ANNOTATIONS` on every materialized annotation graph-node, so an annotation A2 targeting promoted annotation A1 is silently dropped (it's bucketed under A1 in `nodeAnnotationIndex` after `filterAnnotationIndex`, but nothing reads the bucket for promoted ids). The function gains a fourth parameter `nodeAnnotationIndex: ReadonlyMap<string, readonly Annotation[]>`, and the per-promoted-annotation arm reads `nodeAnnotationIndex.get(annotation.id) ?? EMPTY_ANNOTATIONS` to stamp the propagated array. The call site at [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts) (end-of-walk materialization) threads the already-computed `nodeAnnotationIndex` through.
- **Vitest cover (~1.5h).** [`apps/audience/src/graph/projectGraph.test.ts`](../../../apps/audience/src/graph/projectGraph.test.ts) gains three propagation cases mirroring the participant's `ann-oa-1` / `ann-oa-2` / `ann-oa-3` shape. [`apps/audience/src/graph/annotations.test.ts`](../../../apps/audience/src/graph/annotations.test.ts) gains one case asserting that `projectAnnotationNodes` reads the threaded `nodeAnnotationIndex` and stamps the propagated annotations on the materialized annotation graph-node. No new test files; all cases additive.
- **Comment touch (~15min).** The top-of-file refinement-roll comment at [`apps/audience/src/graph/projectGraph.ts:75-89`](../../../apps/audience/src/graph/projectGraph.ts) and the inline filtering-seam comment at [`apps/audience/src/graph/projectGraph.ts:322-337`](../../../apps/audience/src/graph/projectGraph.ts) gain a one-line breadcrumb pointing at THIS refinement's Status block once it lands. The `projectAnnotationNodes` docstring at [`apps/audience/src/graph/annotations.ts:129-147`](../../../apps/audience/src/graph/annotations.ts) gains one bullet documenting the new index parameter + propagation responsibility.

No new ADR. No shell-package change (the `groupAnnotationsByEntityId` export was added by the predecessor participant task and is already in `@a-conversa/shell`). No wire-schema change (per D4 of the participant refinement — the `target_node_id` slot already accepts any UUID; this task consumes the existing convention). No backend / projector / methodology-engine change. No new dependency.

## Inherited dependencies

**Settled:**

- [`audience.aud_graph_rendering.aud_render_annotation_endpoint_edges`](./aud_render_annotation_endpoint_edges.md) (done — 2026-05-30). Materializes annotation graph-nodes when referenced as an `edge-created` endpoint via the hybrid-promotion pattern: `computeAnnotationsAsEndpoints` builds the promotion set, `projectAnnotationNodes` emits Cytoscape descriptors for each promoted annotation, `filterAnnotationIndex` post-filters the `nodeAnnotationIndex` and `edgeAnnotationIndex` buckets so promoted annotations render as Cytoscape nodes only (never also as DOM badges). The `AudienceNodeData` interface already carries `nodeKind: 'statement' | 'annotation'` + `annotationKind: AnnotationKind | null` discriminators ([`apps/audience/src/graph/projectGraph.ts:168-237`](../../../apps/audience/src/graph/projectGraph.ts)). This task's predecessor explicitly named us as the downstream consumer at [its refinement L50, L60, L110, L432](./aud_render_annotation_endpoint_edges.md) — the materialized annotation graph-node IS the overlay surface this propagation needs.
- [`participant_ui.part_graph_view.part_annotation_of_annotation_overlay_chain`](../participant-ui/part_annotation_of_annotation_overlay_chain.md) (done — 2026-05-30). Established the polymorphic-entity-id convention at the shell layer: added `groupAnnotationsByEntityId` to [`packages/shell/src/annotations/annotations.ts:121-135`](../../../packages/shell/src/annotations/annotations.ts) with a docstring that documents the bucket-key-as-entity-id semantic; kept `groupAnnotationsByNode` as a thin backward-compat alias at [L147](../../../packages/shell/src/annotations/annotations.ts) so audience + moderator imports continue to resolve until their own follow-ups land. Its D6 explicitly registered THIS task as the audience follow-up: *"The follow-up migrates the audience to `groupAnnotationsByEntityId` and adds parallel Vitest cover."* Its `ann-oa-1` / `ann-oa-2` / `ann-oa-3` propagation cases at [`apps/participant/src/graph/projectGraph.test.ts:2114-2242`](../../../apps/participant/src/graph/projectGraph.test.ts) are the structural template for the audience-side cases here.
- [`audience.aud_graph_rendering.aud_annotation_rendering`](./aud_annotation_rendering.md) (done). Established the audience's DOM-overlay annotation badge: every projected node carries `data.annotations: readonly Annotation[]`, defaulting to `EMPTY_ANNOTATIONS`; `<AudienceAnnotationOverlay>` reads `node.data('annotations')` ([`apps/audience/src/graph/AnnotationOverlay.tsx:180`](../../../apps/audience/src/graph/AnnotationOverlay.tsx)) and renders one badge per annotation per node. This task's propagation lights up that same overlay path on annotation graph-nodes — the badge component needs no widening; once the projected `data.annotations` array carries the annotations targeting the promoted annotation, the overlay renders them by the existing mechanism.
- [`audience.aud_graph_rendering.aud_annotation_rendering_edges`](./aud_annotation_rendering_edges.md) (done). Established the symmetric edge-arm overlay (`data.annotations` on `AudienceEdgeData`). Not directly load-bearing for this task (which is node-arm only), but cited to confirm that the projection's per-edge annotation-overlay seam is unaffected by the rename.
- [`shell-package.extract_cytoscape_projectors`](../shell-package/extract_cytoscape_projectors.md) (done). Established that `projectAnnotations` / `groupAnnotationsByNode` / `groupAnnotationsByEdge` (and now `groupAnnotationsByEntityId`) live canonically in `@a-conversa/shell`. The audience workspace's `apps/audience/src/graph/annotations.ts` re-export shim does NOT currently re-export the bucketer trio — the audience's `projectGraph.ts` imports them directly from `@a-conversa/shell` at [L143-145](../../../apps/audience/src/graph/projectGraph.ts). This task swaps the imported symbol name; no re-export plumbing change.
- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Cytoscape.js for the audience broadcast surface. The existing DOM-overlay annotation badge (rendered by `<AudienceAnnotationOverlay>` over the Cytoscape canvas) is the rendering seam this propagation lights up.
- [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — annotation-created Zod schema; `target_node_id` is `z.string().uuid().nullable()` accepting any UUID. The polymorphic-entity-id convention is a consumer-side interpretation of the existing wire contract (no schema change).
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check committed. The "no Playwright" defense under D5 mirrors the participant's defense verbatim.
- [ADR 0026](../../../docs/adr/0026-micro-frontend-root-app.md) — `@a-conversa/shell` is the cross-surface vocabulary home; `groupAnnotationsByEntityId` is already there from the predecessor participant task.
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — annotations are entity-layer vocabulary. Entity-layer only; no facet-layer touch.

**Pending:** (none — every load-bearing input is settled on `main`.)

## What this task is

Light up annotation-of-annotation overlay propagation on the audience read-only Cytoscape broadcast surface. When an annotation A1 is promoted to a Cytoscape graph-node (because some `edge-created` references its id via `source_annotation_id` or `target_annotation_id`, per the predecessor `aud_render_annotation_endpoint_edges`), and another annotation A2 carries A1's UUID in its `target_node_id` field, A1's materialized graph-node carries A2 in its `data.annotations` array — and the existing `<AudienceAnnotationOverlay>` renders A2 as a DOM badge over A1's canvas position. The audience surface's broadcast viewer sees the same "annotation on annotation" visual vocabulary that the participant's read-mostly canvas already pinned end-to-end.

The mechanical change is two-step:

1. **Rename the bucketer call site to `groupAnnotationsByEntityId`** — runtime byte-for-byte unchanged; the rename makes the polymorphic-entity-id convention legible at the audience surface (today's import name `groupAnnotationsByNode` is misleading once the bucket key is an annotation id).
2. **Thread `nodeAnnotationIndex` into `projectAnnotationNodes`** so the materialization pass stamps `annotations: nodeAnnotationIndex.get(annotation.id) ?? EMPTY_ANNOTATIONS` on the promoted annotation graph-node instead of unconditionally stamping `EMPTY_ANNOTATIONS`. This is the actual propagation: the bucketer already buckets A2 under A1 (it always has — the wire schema's `target_node_id` slot is just a UUID), and `filterAnnotationIndex` preserves the A1 bucket because A2's id is NOT in the promotion set (only A1's is). The missing seam is the read inside `projectAnnotationNodes` — adding it lights up the data flow end-to-end.

The audience's surface differs from the participant's at one observable point: the audience's `data.annotations` carries the full `readonly Annotation[]` array (the DOM overlay reads it directly to render N badges), whereas the participant collapses it to `hasAnnotation: boolean` + `annotationCount: number` (the Cytoscape `[?hasAnnotation]` selector reads the boolean). The propagation behavior is identical in spirit; the wire-up site differs because the data shape differs. The work here pins the audience's shape.

Concretely the deliverable is:

1. **`groupAnnotationsByNode` → `groupAnnotationsByEntityId` rename** at [`apps/audience/src/graph/projectGraph.ts:145`](../../../apps/audience/src/graph/projectGraph.ts) (named import) and [L331](../../../apps/audience/src/graph/projectGraph.ts) (call site inside `projectGraph`). The local variable identifier `nodeAnnotationIndex` is preserved (D2).
2. **`projectAnnotationNodes` gains a `nodeAnnotationIndex` parameter** at [`apps/audience/src/graph/annotations.ts:148-177`](../../../apps/audience/src/graph/annotations.ts). The per-promoted-annotation arm reads `nodeAnnotationIndex.get(annotation.id) ?? EMPTY_ANNOTATIONS` and stamps the result on `data.annotations` (instead of unconditional `EMPTY_ANNOTATIONS`).
3. **The call site in `projectGraph` threads the already-computed `nodeAnnotationIndex` through** to `projectAnnotationNodes` (the existing call passes `(projectedAnnotations, promotedAnnotationIds, events)`; it gains a fourth argument).
4. **Comment touches.** The top-of-file refinement-roll comment at [`apps/audience/src/graph/projectGraph.ts:75-89`](../../../apps/audience/src/graph/projectGraph.ts) gains a paragraph entry pointing at this refinement; the docstring at [`apps/audience/src/graph/annotations.ts:129-147`](../../../apps/audience/src/graph/annotations.ts) gains one bullet documenting the new index parameter + propagation responsibility.
5. **Vitest cover.** Three propagation cases in `projectGraph.test.ts` (mirroring participant's `ann-oa-1/2/3`); one targeted case in `annotations.test.ts` pinning that `projectAnnotationNodes` reads the threaded index.
6. **No Playwright.** Per D5 (mirrors the participant's D5 verbatim) — the propagation is a thin Map-keying semantic that the Vitest layer pins exhaustively; the predecessor's Playwright block in [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) already exercises annotation graph-node rendering at the e2e seam.

Out of scope:

- **Moderator surface annotation-of-annotation propagation.** Registered in the participant's D6 as `mod_annotation_of_annotation_overlay_chain`; gated on the moderator's own `mod_render_annotation_endpoint_edges` landing first. Not bundled here.
- **Edge-arm annotation-of-annotation propagation.** Today the audience's `edgeAnnotationIndex` buckets annotations whose `targetEdgeId` is set. An annotation A1 targeting an edge E does NOT propagate to E's annotation endpoints (transitive chain). That's a different propagation question, and today's behavior (A1 overlays on E unchanged) is correct. The transitive-edge case is left as a future polish question if methodology surfaces a load-bearing user-visible scenario.
- **Wire schema 3-way XOR (explicit `target_annotation_id` slot).** Per the participant's D4 — would require an ADR-level decision and a backend/projection/replay touch; vastly exceeds 0.5d. The polymorphic-entity-id convention works today on the existing schema.
- **Visual regression on the propagated overlay.** Owned by the standing `aud_vr_*` policy.
- **Renaming the local variable identifier `nodeAnnotationIndex` to `entityAnnotationIndex` audience-wide.** Cosmetic-only churn; out of budget at 0.5d. Mirrors participant's D3.
- **Refactoring `filterAnnotationIndex` to thread the promoted-annotation entries differently.** Today the filter preserves entries keyed by promoted ids (because it filters by *annotation id*, not *target id*); that's exactly the behavior this task needs. No filter-side refactor.

## Why it needs to be done

**The participant has already pinned this convention; the audience is the next surface in the natural rollout.** The participant's `part_annotation_of_annotation_overlay_chain` (done 2026-05-30) lit up annotation-of-annotation overlay on the participant's read-mostly canvas, added the `groupAnnotationsByEntityId` export at the shell layer, and explicitly registered THIS task as the audience follow-up (D6). The audience's broadcast viewer should surface the same meta-commentary layer the participant's deliberation surface surfaces — a spectator watching the broadcast loses information if the audience's annotation graph-node renders as if no annotations target it, when the underlying methodology says otherwise.

**The visual surface is already half-built.** The predecessor `aud_render_annotation_endpoint_edges` (done 2026-05-30) materializes annotation graph-nodes via the hybrid-promotion pattern. The promoted annotation graph-node already carries `data.annotations`; today the field is hard-stamped to `EMPTY_ANNOTATIONS`. Wiring the bucketer index into `projectAnnotationNodes` is a one-line read that activates the propagation pipeline end-to-end — the bucketer, the filter, and the DOM overlay all already do the right thing on each side of the missing read.

**The bucketer's name is misleading on the audience side too.** The predecessor's `extract_cytoscape_projectors` lift put `groupAnnotationsByNode` in `@a-conversa/shell`; the audience imports it via [`apps/audience/src/graph/projectGraph.ts:145`](../../../apps/audience/src/graph/projectGraph.ts). The participant's task renamed to `groupAnnotationsByEntityId` with polymorphic-entity-id docstring; the audience continuing to import the legacy name implies a "node-only" reading that's now demonstrably wrong (the bucket key can be an annotation id). Migrating the audience site makes the convention honest at the second consumer.

**Pinning the convention at Vitest closes a documentation debt.** Without committed cases, a future refactor of `projectAnnotationNodes` or `filterAnnotationIndex` could regress the annotation-of-annotation propagation silently — the methodology-engine's `coherency_annotation_of_annotation_chain_rule` (done 2026-05-30, advisory-only) names the structural pattern; the audience's coverage should pin the visual surfacing for the same reason the participant's does.

## Inputs / context

**Design contract:**

- [`docs/methodology.md`](../../../docs/methodology.md) §"Annotations" — the meta-commentary layer admits annotations on annotations as a deliberation move.
- [`tasks/refinements/data-and-methodology/coherency_annotation_of_annotation_chain_rule.md`](../data-and-methodology/coherency_annotation_of_annotation_chain_rule.md) — the methodology-engine rule that recognizes the structural pattern (advisory-only; this task does NOT consume the rule's output, but the rule's existence is why the visual layer needs to surface the pattern).
- [`docs/data-model.md`](../../../docs/data-model.md) — annotations carry a polymorphic UUID target.

**Architectural / engineering inputs:**

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Cytoscape on audience; the DOM-overlay annotation badge is the rendering seam.
- [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — `target_node_id` is `z.string().uuid().nullable()` accepting any UUID; no schema change.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every check committed as Vitest cases.
- [ADR 0026](../../../docs/adr/0026-micro-frontend-root-app.md) — shell-package is the cross-surface vocabulary home.
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — entity-layer only.

**Predecessor refinements:**

- [`./aud_render_annotation_endpoint_edges.md`](./aud_render_annotation_endpoint_edges.md) — materializes the annotation graph-nodes this task decorates; Decisions §1–§11 establish the hybrid-promotion pattern + the `AudienceNodeData` discriminator widening.
- [`../participant-ui/part_annotation_of_annotation_overlay_chain.md`](../participant-ui/part_annotation_of_annotation_overlay_chain.md) — the structural template for this task; Decisions D1–D7 settle the shell-layer rename, the local-variable preservation, the no-wire-schema-change posture, the no-Playwright defense, and the Tech-debt registration boundary.

**Runtime inputs (real files the implementer reads + edits):**

- [`apps/audience/src/graph/projectGraph.ts:75-89`](../../../apps/audience/src/graph/projectGraph.ts) — top-of-file refinement-roll comment for `aud_render_annotation_endpoint_edges`; gains a parallel paragraph for this refinement.
- [`apps/audience/src/graph/projectGraph.ts:143-152`](../../../apps/audience/src/graph/projectGraph.ts) — shell imports including `groupAnnotationsByNode`. Migrates to `groupAnnotationsByEntityId`.
- [`apps/audience/src/graph/projectGraph.ts:319-345`](../../../apps/audience/src/graph/projectGraph.ts) — `projectGraph` body's index-build block. `nodeAnnotationIndex` derivation switches bucketer call name; the call to `projectAnnotationNodes` at the end-of-walk pass threads `nodeAnnotationIndex` as a fourth argument.
- [`apps/audience/src/graph/projectGraph.ts:560-586`](../../../apps/audience/src/graph/projectGraph.ts) — `filterAnnotationIndex`. **No code change here** — the filter already preserves entries whose key is a promoted annotation id (it filters by *annotation id*, not by *target id*); the propagation needs this exact behavior.
- [`apps/audience/src/graph/annotations.ts:129-177`](../../../apps/audience/src/graph/annotations.ts) — `projectAnnotationNodes` docstring + body. Adds the fourth parameter `nodeAnnotationIndex`; the per-promoted-annotation arm reads it before stamping `data.annotations`.
- [`apps/audience/src/graph/annotations.ts:148`](../../../apps/audience/src/graph/annotations.ts) — `projectAnnotationNodes` signature. Gains `nodeAnnotationIndex: ReadonlyMap<string, readonly Annotation[]>` as the fourth parameter.
- [`apps/audience/src/graph/AnnotationOverlay.tsx:180`](../../../apps/audience/src/graph/AnnotationOverlay.tsx) — **no code change**. The overlay reads `node.data('annotations')` directly; once promoted annotation graph-nodes stamp the propagated array, the overlay renders the badges by the existing mechanism.
- [`apps/audience/src/graph/projectGraph.test.ts`](../../../apps/audience/src/graph/projectGraph.test.ts) — Vitest suite. Gains three propagation cases.
- [`apps/audience/src/graph/annotations.test.ts`](../../../apps/audience/src/graph/annotations.test.ts) — Vitest suite for the `projectAnnotationNodes` / `projectAnnotationHostEdges` / `computeAnnotationsAsEndpoints` trio. Gains one case asserting the threaded `nodeAnnotationIndex` is read.
- [`packages/shell/src/annotations/annotations.ts:121-147`](../../../packages/shell/src/annotations/annotations.ts) — `groupAnnotationsByEntityId` export + `groupAnnotationsByNode` backward-compat alias. **No code change here** — already in place from the participant predecessor.
- [`apps/participant/src/graph/projectGraph.test.ts:2114-2242`](../../../apps/participant/src/graph/projectGraph.test.ts) — the participant's `ann-oa-1/2/3` cases. Read-only reference: the audience cases mirror the seeding pattern (case names and event shapes), substituting the audience's `data.annotations` shape for the participant's `hasAnnotation`/`annotationCount` shape.

## Constraints / requirements

- **The bucketer call site at [`apps/audience/src/graph/projectGraph.ts:331`](../../../apps/audience/src/graph/projectGraph.ts) migrates to `groupAnnotationsByEntityId`.** The named import at L145 updates accordingly. Runtime is byte-for-byte unchanged at this step.
- **`projectAnnotationNodes` reads the threaded `nodeAnnotationIndex` for propagation.** The previously hard-coded `annotations: EMPTY_ANNOTATIONS` becomes `annotations: nodeAnnotationIndex.get(annotation.id) ?? EMPTY_ANNOTATIONS`. The default-to-`EMPTY_ANNOTATIONS` posture preserves stable React-memoization identity per the audience's existing convention.
- **The variable identifier `nodeAnnotationIndex` is preserved.** Mirrors participant's D3; cosmetic rename is out of budget.
- **Mutual-exclusion invariant from the predecessor stays intact.** `filterAnnotationIndex` continues to drop annotations whose id IS in the promotion set (those become graph-nodes); it preserves entries whose KEY is a promoted annotation id (those annotations get propagated onto the promoted-annotation graph-node by this task). The two behaviors compose: promoted annotation A1 surfaces as a graph-node and NOT as a DOM badge; non-promoted annotation A2 targeting A1 surfaces as a DOM badge over A1's graph-node (rendered by `<AudienceAnnotationOverlay>` reading `data.annotations`).
- **No wire schema change.** Per participant D4 inherited.
- **No backend, projection, or methodology-engine change.** The propagation is consumer-side only.
- **No DOM mirror change.** The audience's DOM mirror (`apps/audience/src/dom/`-equivalent or the inline mirror selectors) reads `data.annotations` the same way the overlay does; no widening here.
- **Build + test discipline.** `pnpm -F @a-conversa/audience build` clean; `pnpm run check` clean. Vitest baseline rises by ~4 cases. Playwright baseline unchanged.

## Acceptance criteria

**Pinned per ADR 0022.** The e2e is deferred per D5 — the propagation is observable via the DOM overlay at the Vitest+component layer; the participant's predecessor task's "no Playwright" directive carries to the audience for the same reasons (the change is a thin Map-keying semantic; the predecessor's Playwright block already exercises annotation graph-node rendering at the e2e seam). The component IS reachable today via `/live/sessions/:id`-style routes; the deferral is justified by coverage duplication, not by unreachability.

Bucketer call-site migration:

- [ ] [`apps/audience/src/graph/projectGraph.ts:145`](../../../apps/audience/src/graph/projectGraph.ts) named import switches from `groupAnnotationsByNode` to `groupAnnotationsByEntityId`.
- [ ] [`apps/audience/src/graph/projectGraph.ts:331`](../../../apps/audience/src/graph/projectGraph.ts) call site inside `projectGraph` switches accordingly. The local variable identifier `nodeAnnotationIndex` is preserved per D2.

`projectAnnotationNodes` propagation wire-up:

- [ ] [`apps/audience/src/graph/annotations.ts:148`](../../../apps/audience/src/graph/annotations.ts) — `projectAnnotationNodes` signature gains `nodeAnnotationIndex: ReadonlyMap<string, readonly Annotation[]>` as the fourth parameter (after `events`).
- [ ] The per-promoted-annotation arm at [`apps/audience/src/graph/annotations.ts:159-173`](../../../apps/audience/src/graph/annotations.ts) reads `nodeAnnotationIndex.get(annotation.id) ?? EMPTY_ANNOTATIONS` and stamps the result on the `annotations` field of `baseData` (replacing today's unconditional `EMPTY_ANNOTATIONS`).
- [ ] The call site in `projectGraph`'s end-of-walk materialization threads `nodeAnnotationIndex` through as the fourth argument.
- [ ] The docstring at [`apps/audience/src/graph/annotations.ts:129-147`](../../../apps/audience/src/graph/annotations.ts) gains one bullet noting: "`data.annotations` is sourced from `nodeAnnotationIndex.get(annotation.id) ?? EMPTY_ANNOTATIONS` — when another annotation A2 targets this promoted annotation A1 (A1's id appears in A2's `targetNodeId`), A2 surfaces in A1's `data.annotations` array and the existing `<AudienceAnnotationOverlay>` renders the DOM badge on top of A1's graph-node. Refinement: `aud_annotation_of_annotation_overlay_chain`."

Comment / refinement-roll touch:

- [ ] [`apps/audience/src/graph/projectGraph.ts:75-89`](../../../apps/audience/src/graph/projectGraph.ts) refinement-roll comment gains a parallel paragraph pointing at this refinement; one-liner along the lines of: *"Refinement: `tasks/refinements/audience/aud_annotation_of_annotation_overlay_chain.md` (Decisions §1–§5 — migrate the bucketer call to `groupAnnotationsByEntityId` and thread `nodeAnnotationIndex` into `projectAnnotationNodes` so annotations targeting a promoted annotation graph-node surface on its `data.annotations` array and render via the existing DOM overlay.)"*

Vitest propagation cover (`apps/audience/src/graph/projectGraph.test.ts`):

- [ ] **Case ann-oa-1:** seed `session-created` + `node-created (N1)` + `annotation-created (A1, target_node_id = N1)` + `annotation-created (A2, target_node_id = A1)` + `edge-created (source_node_id = N1, target_annotation_id = A1)`. Materialization emits A1 as a Cytoscape graph-node (referenced as edge endpoint); A1's emitted node carries `data.annotations: [A2]` — sourced from the threaded `nodeAnnotationIndex`. N1's emitted node carries `data.annotations: []` (A1 is filtered out per the mutual-exclusion invariant; A2 targets A1, not N1).
- [ ] **Case ann-oa-2:** multiple annotations target the same materialized annotation graph-node. Seed adds `annotation-created (A3, target_node_id = A1)`. A1's emitted node carries `data.annotations` of length 2 (containing A2 and A3, order preserved per the bucketer's append order).
- [ ] **Case ann-oa-3:** annotation-on-annotation where the target annotation is NOT materialized (no edge references A1). Seed: `node-created (N1)` + `annotation-created (A1, target_node_id = N1)` + `annotation-created (A2, target_node_id = A1)` (no `edge-created` referencing A1). A1 does NOT materialize as a graph-node (predecessor's hybrid-promotion rule). N1's emitted node carries `data.annotations: [A1]` (A1 overlays on N1 unchanged — exactly today's behavior). The orphan A2 surfaces nowhere visually — the test pins that `nodes` does NOT include a graph-node with id `A1` or `A2`, AND that no node's `data.annotations` contains A2 (the bucket exists under key A1, but nothing reads it because A1 wasn't materialized).

Vitest annotation-helper cover (`apps/audience/src/graph/annotations.test.ts`):

- [ ] One new case asserting `projectAnnotationNodes(annotations, promotedSet, events, nodeAnnotationIndex)` reads the threaded index: construct a small `annotations` list with one promoted annotation A1, a `nodeAnnotationIndex` Map with one entry `A1 → [A2]`, and assert the emitted graph-node for A1 carries `data.annotations: [A2]`. A parallel sub-case with an empty `nodeAnnotationIndex` asserts the fallback to `EMPTY_ANNOTATIONS` (preserves React-memoization stability when no propagation applies).

Existing tests stay green:

- [ ] Every existing `projectGraph.test.ts` case stays green — the predecessor's hybrid-promotion cases unaffected (mutual-exclusion invariant intact; promoted annotations still don't render as DOM badges on their host).
- [ ] Every existing `annotations.test.ts` case stays green — the new parameter has a structural default-via-empty-Map for any existing call site that doesn't pass it (or the existing in-test call sites add the empty Map argument; implementer's choice).
- [ ] Every existing `GraphView.test.tsx` case stays green.
- [ ] Existing Playwright suite ([`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) and the broadcast canvas blocks) stays green — annotation graph-node materialization unchanged at the e2e seam.

Build + scheduler:

- [ ] `pnpm -F @a-conversa/audience build` succeeds.
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green; Vitest baseline rises by ~4 cases (three propagation + one helper-layer).
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_annotation_of_annotation_overlay_chain`.

Tech-debt registration:

- [ ] **No new follow-ups registered.** The moderator surface's parallel `mod_annotation_of_annotation_overlay_chain` is already named-and-registered by the participant's D6; it stays where it is. No further audience-surface follow-up is required by this task.

## Decisions

- **D1 — Migrate the call site from `groupAnnotationsByNode` to `groupAnnotationsByEntityId` (no semantic change); pair the rename with the propagation wire-up at `projectAnnotationNodes`.** Rationale:
  - **The rename alone is insufficient.** A pure import-rename would land the docstring honesty but leave the audience's annotation-of-annotation propagation broken (because `projectAnnotationNodes` hard-codes `EMPTY_ANNOTATIONS`). The participant's task could land a rename-only because its annotation graph-node materialization already routed via `nodeAnnotationIndex.get`; the audience's materialization does not. Bundling the wire-up with the rename means a single commit lights up the propagation end-to-end, parallel to the participant's outcome.
  - **The shell-level export is already in place.** The participant's task added `groupAnnotationsByEntityId` to `@a-conversa/shell` with the polymorphic-entity-id docstring; the audience consumes the shell directly (no audience-side re-export shim for the bucketer trio). The import-name swap is one-line.
  - **Alternative considered: ship the rename only; defer the propagation wire-up to a separate task.** Rejected — splits a 0.5d cohesive change into two micro-commits with no benefit. The participant's task bundled rename + wire-up + tests; the audience should mirror that shape.
  - **Alternative considered: ship the wire-up only; keep the legacy `groupAnnotationsByNode` import name.** Rejected — the rename is the convention-honesty payoff the participant established at the shell layer; not migrating the audience leaves the misleading import name in place at the second consumer site, undermining the convention's legibility.

- **D2 — Preserve the local variable identifier `nodeAnnotationIndex` across the migration; do NOT rename to `entityAnnotationIndex`.** Rationale (mirrors participant D3 verbatim):
  - **Cosmetic-only churn is out of budget at 0.5d.** Renaming the local variable in `projectGraph` would touch every reader of the index throughout the file (multiple `for`-loop arms read `nodeAnnotationIndex.get`); the runtime change is zero.
  - **The local name is implementation-level; the shell-level rename is the contract-level honesty.** The polymorphic-entity-id semantic lives in the shell-level export's docstring (where the audience-side reader looking for "what does this bucket mean?" lands); the participant-side and audience-side local names are one level down.
  - **Future task can rename if cost-justified.** A standalone cosmetic refactor renaming the audience-side local identifiers is cheap and discoverable when the next audience-graph touch lands; deferring is low-risk.
  - **Alternative considered: rename `nodeAnnotationIndex` → `entityAnnotationIndex` audience-wide.** Rejected — out of budget; the cost-benefit is poor since local readers already understand the polymorphic semantics from the shell-level docstring; cross-surface inconsistency with the participant (which preserved the local name per its D3) introduces churn for zero behavioral benefit.

- **D3 — Thread `nodeAnnotationIndex` into `projectAnnotationNodes` as a fourth parameter rather than computing it inline OR inlining the materialization into `projectGraph`.** Rationale:
  - **`projectAnnotationNodes` already takes context as parameters.** Its current signature is `(annotations, promotedSet, events)` — `events` is threaded through for `buildAnnotationHostIndex`. Adding `nodeAnnotationIndex` as a fourth parameter keeps the function pure and its dependencies explicit; it's symmetric with the existing parameter-passing posture.
  - **Computing `nodeAnnotationIndex` inside `projectAnnotationNodes` would duplicate the bucket-build work.** `projectGraph` already builds the (filtered) `nodeAnnotationIndex` for the per-node-arm read; passing it through avoids a second `groupAnnotationsByEntityId + filterAnnotationIndex` pass.
  - **Inlining the materialization into `projectGraph` would lose the test-isolation seam.** `projectAnnotationNodes` is independently tested in `annotations.test.ts`; folding it back into `projectGraph` would force all coverage through the larger `projectGraph` test surface, undermining the predecessor task's deliberate three-helper split.
  - **Alternative considered: compute `nodeAnnotationIndex` inside `projectAnnotationNodes`.** Rejected — duplicates work + adds a `groupAnnotationsByEntityId` import to `annotations.ts` for a value that `projectGraph` already holds.
  - **Alternative considered: inline `projectAnnotationNodes` into `projectGraph`.** Rejected — undermines the predecessor's testability seam; loses the helper-layer Vitest coverage shape.

- **D4 — Use the existing `filterAnnotationIndex` post-filter unchanged; do NOT change the filter to exclude entries whose KEY is a promoted annotation id.** Rationale:
  - **The filter's behavior is exactly what we need.** Today `filterAnnotationIndex` drops annotations whose ID is in the promotion set (those promoted-to-graph-node annotations get rendered as Cytoscape nodes, not as DOM badges on their host), and preserves entries keyed by anything — including promoted annotation ids. That preservation is precisely what surfaces A2 under A1's bucket so the propagation wire-up can read it.
  - **Changing the filter would BREAK propagation.** If we changed the filter to drop entries whose KEY is in the promotion set, the bucket under A1 would disappear, and `projectAnnotationNodes`'s `nodeAnnotationIndex.get(A1)` would return `undefined`. The propagation would silently die.
  - **The filter's name vs. behavior is fine.** "Filter annotation index" is honest: it filters individual annotations (by id) out of the index; it does not filter index-keys. The predecessor's docstring at L555-569 already describes this precisely.
  - **Alternative considered: rename `filterAnnotationIndex` to `filterPromotedAnnotationsFromIndex` for clarity.** Considered, NOT required — cosmetic; the existing docstring is sufficient. Implementer may rename at discretion.

- **D5 — No Playwright spec. The propagation is pinned at the Vitest layer; the predecessor's Playwright block in `tests/e2e/audience-live-session.spec.ts` already exercises annotation graph-node rendering at the e2e seam.** Rationale (mirrors participant D5 with audience-specific seam names):
  - **The change is a thin Map-keying semantic.** What flips between "today" and "after this task" is: `projectAnnotationNodes` reads `nodeAnnotationIndex.get(annotation.id)` and stamps the result on `data.annotations`. The data-flow from event log → bucketer → filter → materialization → emitted `data.annotations` is fully pinned by Vitest at the function-call layer; the existing `<AudienceAnnotationOverlay>` reads `data.annotations` unchanged.
  - **The predecessor's Playwright block already exercises annotation graph-node rendering at the e2e seam.** [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) (per `aud_render_annotation_endpoint_edges` Acceptance criteria) seeds an annotation-endpoint edge + materialized annotation node and asserts the canvas surfaces it. Adding a parallel block for the annotation-on-annotation case would pile on the file with very similar coverage. The UI-stream policy explicitly warns about pile-on of catch-all e2e files.
  - **The component IS reachable** (a live session route renders the audience canvas; the predecessor task wired it). The deferral is justified by coverage duplication, not by unreachability — matching the participant's D5 reasoning verbatim.
  - **ADR 0022 is satisfied.** Every empirical check is a committed Vitest case; no throwaway verification.
  - **Alternative considered: add a parallel block to `audience-live-session.spec.ts`.** Rejected — duplicates predecessor coverage; pile-on the proximal catch-all file; no unique behavioral signal beyond what Vitest pins.
  - **Alternative considered: defer Playwright to a future `aud_pw_annotation_of_annotation_overlay` task.** Rejected — registers a thin debt item with no real coverage delta; the Vitest layer is the right pin for a data-flow Map-keying change.

- **D6 — No new ADR. The polymorphic-entity-id convention is the participant predecessor's already-documented contract; this task is the audience-side consumer-migration that adopts it.** Rationale:
  - **The convention's docstring lives at the shell layer.** [`packages/shell/src/annotations/annotations.ts:100-120`](../../../packages/shell/src/annotations/annotations.ts) already documents the polymorphic-entity-id semantic; no new architectural commitment lands here.
  - **The audience surface's wire-up is a Refinement-level decision, not an architectural one.** Threading `nodeAnnotationIndex` into `projectAnnotationNodes` is a function-signature change at one helper; no new dependency, no new architectural seam.
  - **Alternative considered: write an ADR for "audience surface annotation-of-annotation propagation."** Rejected — over-specifies a consumer-side wiring that's already constrained by the shell-layer contract; would set precedent for ADR'ing every per-surface consumer migration.

## Open questions

(none — all decided in D1–D6.)

## Status

**Done** — 2026-05-30.

- `apps/audience/src/graph/projectGraph.ts` — top-of-file refinement-roll comment paragraph added for this refinement; named import renamed `groupAnnotationsByNode → groupAnnotationsByEntityId` (L145); call-site at the `nodeAnnotationIndex` derivation renamed accordingly; `nodeAnnotationIndex` threaded as fourth arg to `projectAnnotationNodes` at the end-of-walk materialization pass.
- `apps/audience/src/graph/annotations.ts` — `projectAnnotationNodes` gains fourth parameter `nodeAnnotationIndex: ReadonlyMap<string, readonly Annotation[]>`; per-promoted-annotation arm reads `nodeAnnotationIndex.get(annotation.id) ?? EMPTY_ANNOTATIONS` for `data.annotations`; docstring bullet added documenting the new index parameter and propagation responsibility.
- `apps/audience/src/graph/projectGraph.test.ts` — three propagation cases added: `ann-oa-1` (A2 targeting promoted A1 surfaces on A1's graph-node), `ann-oa-2` (multiple annotations target same promoted annotation), `ann-oa-3` (annotation targeting non-promoted annotation surfaces nowhere).
- `apps/audience/src/graph/annotations.test.ts` — existing `(aep-e/f/g)` call sites updated to pass `new Map()` for the new parameter; `(aep-k)` asserts the threaded index is read; `(aep-l)` asserts fallback to `EMPTY_ANNOTATIONS` when index has no entry.
- No new ADR, no wire-schema change, no backend/projection change, no Playwright spec (per D5 — thin Map-keying semantic pinned at Vitest).
- Moderator parallel `mod_annotation_of_annotation_overlay_chain` remains registered where the participant's D6 placed it — no new follow-ups from this task.
