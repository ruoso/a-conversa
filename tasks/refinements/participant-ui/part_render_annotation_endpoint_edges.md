# Render annotation-endpoint edges on the participant Cytoscape canvas

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_render_annotation_endpoint_edges` (block at L208-219). Embedded note: *"Source of debt: projection_edge_annotation_endpoint — the participant Cytoscape canvas currently skips annotation-endpoint edges (apps/participant/src/graph/projectGraph.ts) because annotations are not yet rendered as Cytoscape nodes. Rendering annotation-endpoint edges requires resolving the design question of how the canvas surfaces annotations as standalone graph nodes. Includes Playwright cover asserting an annotation-endpoint edge appears on the canvas."*

## Effort estimate

**1.5d** (per the `.tji` allocation). The work spans:

- **Project-graph widening (~3h).** [`apps/participant/src/graph/projectGraph.ts:443-602`](../../../apps/participant/src/graph/projectGraph.ts) gains an `annotation-created` arm that caches annotation payloads, an edge-referenced-annotation pass, and conditional materialization of annotation graph-nodes; the L503-516 skip-guard is removed.
- **Node-data widening (~1h).** [`apps/participant/src/graph/projectGraph.ts:139-260`](../../../apps/participant/src/graph/projectGraph.ts) `ParticipantNodeData` gains `nodeKind: 'statement' | 'annotation'` (default sentinel `'statement'` for backward compatibility) and `annotationKind: AnnotationKind | null` (default `null` for statement nodes; carries the wire `annotation-created` kind for annotation nodes). Statement-only fields (`kind`, `facetStatuses`, `rollupStatus`, `isAxiom`, `ownVote`, `otherVotes`, `diagnosticHighlight`) carry their existing sentinel defaults for annotation nodes per D3.
- **Stylesheet branch (~1h).** [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) `STYLESHEET` gains a `node[nodeKind = "annotation"]` selector group that paints annotation graph-nodes distinctly (round-tag shape + amber-50 background + amber-600 border + smaller font) without disturbing any existing per-status / axiom-mark / overlay / diagnostic / own-vote / selected branches per D4.
- **DOM mirror widening (~1h).** [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) per-node `<li>` row gains `data-node-kind="statement|annotation"` and (for annotation nodes only) `data-annotation-kind="<kind>"`. Edges that reference annotations gain the existing `data-source-id` / `data-target-id` carrying the annotation graph-node id (uniformly with statement-node ids per D5).
- **Selection-store widening (~0.5h).** [`apps/participant/src/state/selectionStore.ts`](../../../apps/participant/src/state/selectionStore.ts) `SelectedEntity` discriminant widens with `kind: 'annotation'`. Per D6 the entity-detail-panel's annotation rendering is deferred to a follow-up — this task only opens the selection slot so tap-to-select doesn't crash.
- **Vitest cover (~2h).** [`apps/participant/src/graph/projectGraph.test.ts`](../../../apps/participant/src/graph/projectGraph.test.ts) gains cases for: (a) annotation graph-node materialization when referenced as edge endpoint; (b) no materialization when annotation is only an overlay target (current behavior); (c) edge round-trip for each of the three endpoint shapes (node→annotation, annotation→node, annotation→annotation); (d) statement-only fields carry sentinel defaults on annotation nodes; (e) edge `source`/`target` resolve to annotation graph-node ids. [`apps/participant/src/graph/GraphView.test.tsx`](../../../apps/participant/src/graph/GraphView.test.tsx) gains mirror-row assertion cases for `data-node-kind` + `data-annotation-kind`.
- **Playwright cover (~1.5h).** [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) gains a block seeding `node-created` + `annotation-created` + `edge-created (target_annotation_id)` via the `window.__aConversaWsStore` seam and asserts the mirror rows include the materialized annotation node + the annotation-endpoint edge. Per D8 the spec lands in the existing file (4th block) — the recently-landed `part_e2e_user_pool_expansion` (settled 2026-05-30) expanded the dev user pool so the file can stay parallel.

No new ADR (the polymorphic-endpoint pattern is settled by `entity_creation_events` / R11 and the projection-layer widening). No backend changes (the projection already carries the polymorphic shape; this task consumes the wire snapshot). No new dependency (Cytoscape supports per-node shape + per-selector branching via the existing stylesheet pattern).

## Inherited dependencies

**Settled:**

- [`participant_ui.part_graph_view.part_annotation_render`](./part_annotation_render.md) (done — `complete 100`). Shipped the `hasAnnotation` / `annotationCount` overlay on statement node/edge data, the amber-overlay / amber-underlay Cytoscape stylesheet branch, the `nodeAnnotationIndex` / `edgeAnnotationIndex` + `groupAnnotationsByNode` / `groupAnnotationsByEdge` bucketers in [`apps/participant/src/graph/annotations.ts`](../../../apps/participant/src/graph/annotations.ts), and the `data-has-annotation` + `data-annotation-count` mirror attributes. **This task does NOT touch that layer** — non-endpoint annotations continue to render as overlays on their target node/edge (per D2). The widening here is additive: an annotation that IS an edge endpoint also materializes as a graph node; an annotation that is only an overlay target stays an overlay.
- [`data_and_methodology.projection.projection_edge_annotation_endpoint`](../data-and-methodology/projection_edge_annotation_endpoint.md) (done — 2026-05-30). The projection-layer widening that this task consumes. `ProjectedEdge` / `EdgeShape` / `EdgeAddedChange` carry the four polymorphic endpoint slots; the WS snapshot serializer at [`apps/server/src/ws/handlers/snapshot.ts:315-324`](../../../apps/server/src/ws/handlers/snapshot.ts) emits `sourceAnnotationId` / `targetAnnotationId` on the wire; the `handleEdgeCreated` `ReplayError` guard is lifted. The three UI consumer narrowings — including [`apps/participant/src/graph/projectGraph.ts:503-516`](../../../apps/participant/src/graph/projectGraph.ts) — stay in place pending THIS task per that refinement's D3.
- [`participant_ui.part_graph_view.part_graph_render`](./part_graph_render.md) (done). Established the `projectGraph(events, ...)` single-pass projection idiom, the Cytoscape `STYLESHEET` module-scope constant, the `<ul data-testid="participant-graph-status-mirror">` DOM mirror with per-node and per-edge `<li>` rows, and the `/p/sessions/:id` route mount.
- [`participant_ui.part_graph_view.part_per_facet_state_styling`](./part_per_facet_state_styling.md) (done). Established the per-status selector layering on the baseline + the `rollupStatus: 'none'` sentinel posture this task replicates for the statement-only fields on annotation nodes (D3).
- [`participant_ui.part_graph_view.part_axiom_mark_decoration`](./part_axiom_mark_decoration.md), [`part_diagnostic_highlights`](./part_diagnostic_highlights.md), [`part_own_vote_indicators`](./part_own_vote_indicators.md), [`part_other_vote_indicators`](./part_other_vote_indicators.md) (all done). Each adds an additional `projectGraph` index argument. This task does NOT widen `projectGraph`'s signature again — annotation-node fields are populated from existing indices (axiom marks don't target annotations per the wire schema; diagnostics don't touch annotation graph-nodes per the projection-layer's D4 skip; votes don't target annotations).
- [`participant_ui.part_graph_view.part_pan_zoom_tap`](./part_pan_zoom_tap.md) (done). Established the tap-to-select handler and the `useSelectionStore` Zustand store. This task widens the store's `SelectedEntity` discriminant (D6).
- [`participant_ui.part_graph_view.part_entity_detail_panel`](./part_entity_detail_panel.md) (done). The detail panel today reads `kind: 'node' | 'edge'` from the selection store. Per D6 the panel's rendering of annotation entities is deferred to a follow-up; this task ensures the selection store accepts the new discriminant without crashing the panel.
- [`participant_ui.part_graph_view.part_e2e_user_pool_expansion`](./part_e2e_user_pool_expansion.md) (done — 2026-05-30). Expanded the Authelia dev user pool, allowing this task's 4th-block addition to `participant-graph-render.spec.ts` to stay parallel (D8).
- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Cytoscape.js for the read-mostly participant tablet.
- [ADR 0008](../../../docs/adr/0008-e2e-framework-playwright.md) — Playwright for the user-stream e2e.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case + Playwright spec block.
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — entity vs facet separation. This task lives at the entity layer (annotations are entities; the rendering question is "should this entity be visible on the canvas").

**Pending:** (none — every load-bearing input is settled on `main`.)

## What this task is

Render annotation-endpoint edges (edges whose `source` and/or `target` is an annotation rather than a statement node) on the participant Cytoscape canvas, by materializing the referenced annotations as standalone graph-nodes with their own positions and visual identity. The projection layer has carried polymorphic-endpoint edges since `projection_edge_annotation_endpoint` (done 2026-05-30); the participant UI's `projectGraph` helper still skips them at L503-516 because, today, annotations are surfaced only as overlays on their target node/edge (`hasAnnotation` / `annotationCount` on the target's `data`), not as Cytoscape nodes with ids the layout engine can bind edges to.

Concretely the deliverable is:

1. **Conditional annotation graph-node materialization in `projectGraph`.** Walk the events twice (or one pass with deferred emission, equivalently): first pass collects annotation payloads from `annotation-created` events into a Map<annotation_id, AnnotationPayload> AND collects the set of annotation ids referenced by any `edge-created` payload via `source_annotation_id` or `target_annotation_id`. Second pass emits Cytoscape elements: for each referenced annotation id, emit one annotation graph-node descriptor with the annotation's content as `wording`, its kind as `annotationKind`, sentinel defaults for the statement-only fields per D3, and per-node `width`/`height`/`textMaxWidth` computed via the existing `computeNodeDimensions` helper.

2. **Lift the skip-guard at [`apps/participant/src/graph/projectGraph.ts:503-516`](../../../apps/participant/src/graph/projectGraph.ts).** With annotations now materializable, the previously-orphaned edges have valid source/target ids to bind. The `edge-created` arm reads `event.payload.source_node_id ?? event.payload.source_annotation_id` (and symmetric for target) — whichever is set — as the Cytoscape `data.source` / `data.target`. The XOR `.refine()` on the wire schema guarantees exactly one is set per endpoint, so the `??` chain resolves unambiguously.

3. **Stylesheet branch for `node[nodeKind = "annotation"]`.** A new selector group paints annotation nodes distinctly: rounded-tag shape (Cytoscape `'round-tag'`), amber-50 fill (`#fef3c7` — matches the existing annotation overlay vocabulary), amber-600 border (`#d97706`), smaller font (`12px` vs `14px` baseline), and a per-`annotationKind` selector pair (e.g. `node[nodeKind = "annotation"][annotationKind = "note"]` adopts the amber palette; `[annotationKind = "reframe"]` adopts violet; `[annotationKind = "scope-change"]` adopts teal; `[annotationKind = "stance"]` adopts sky — the same four-color palette the moderator's `AnnotationBadge` already uses for kind disambiguation). Annotation graph-nodes carry their existing `[?isFlashing]` and `[?hasAnnotation]` (annotation-of-annotation case) overlay branches uniformly.

4. **DOM mirror widening.** Per-node `<li>` rows gain `data-node-kind="statement"|"annotation"`. Annotation nodes additionally carry `data-annotation-kind="<kind>"`. The existing `data-node-id` carries the annotation id for annotation nodes (uniformly with statement-node ids per D5 — no ambiguity because the id space is UUID and there's no collision). Per-edge `<li>` rows are unchanged in shape; their existing `data-source-id` / `data-target-id` carry the annotation id when the endpoint is an annotation, which assertions can correlate against the matching annotation `<li>`'s `data-node-id`.

5. **Selection store widening.** [`apps/participant/src/state/selectionStore.ts`](../../../apps/participant/src/state/selectionStore.ts) `SelectedEntity` discriminated union widens from `{ kind: 'node', id } | { kind: 'edge', id }` to `{ kind: 'node', id } | { kind: 'edge', id } | { kind: 'annotation', id }`. The `useSelectionStore` Zustand store accepts the new shape. The existing tap-handler at the Cytoscape mount reads the tapped element's `data.nodeKind` to decide which discriminant to write. Per D6 the entity-detail-panel's rendering of annotation entities is deferred to a follow-up — for v0 the panel reads the discriminant and renders a placeholder ("Annotation selected — detail view coming soon") rather than crashing or rendering as if the annotation were a statement node.

6. **Vitest cover.** New cases in `projectGraph.test.ts` pin: (a) the three round-trip endpoint shapes (node→annotation, annotation→node, annotation→annotation); (b) the materialization-only-when-referenced rule; (c) the sentinel-default posture for statement-only fields on annotation nodes; (d) the `nodeKind` discriminator surfaces; (e) the `annotationKind` field surfaces with the wire kind value. New cases in `GraphView.test.tsx` pin the `data-node-kind` / `data-annotation-kind` mirror attributes.

7. **Playwright cover.** A new block in `participant-graph-render.spec.ts` seeds a session log carrying `session-created` → `node-created` → `annotation-created` → `edge-created (target_annotation_id set)` and asserts that the mirror lists both the statement node and the materialized annotation node, that the mirror includes the edge with `data-source-id` matching the statement and `data-target-id` matching the annotation, and that the annotation's `data-node-kind="annotation"` row carries `data-annotation-kind` matching the seeded kind.

Out of scope (each registered as a named follow-up under Tech-debt registration):

- The entity-detail-panel's annotation-entity rendering (per D6 → `part_entity_detail_panel_annotation_view`).
- Pan/zoom layout tuning for annotation graph-nodes (the `cose` layout treats them uniformly with statement nodes for v0 — visual polish if needed lands as a follow-up).
- Annotation-of-annotation overlay chain propagation (when annotation A1 targets annotation A2 and A2 is materialized as a graph-node, A1 should overlay on A2's graph-node body). Per D7 this is a separate decision-point; defer until the methodology-engine's `coherency_annotation_of_annotation_chain_rule` adoption surfaces the rule end-to-end.
- The moderator (`mod_render_annotation_endpoint_edges`) and audience (`aud_render_annotation_endpoint_edges`) parallel tasks — each separately scoped in their respective WBS files at [`tasks/30-moderator-ui.tji:674-685`](../../30-moderator-ui.tji) and [`tasks/50-audience-and-broadcast.tji:322`](../../50-audience-and-broadcast.tji).
- Visual regression coverage of annotation graph-nodes (the standing `part_vr_*` policy; a polish pass after the rendering settles).

## Why it needs to be done

**The participant cannot see the methodology's full structural narrative.** When the methodology encodes a relation like "N19 contradicts A2" (the canonical walkthrough's E15 — see [`docs/example-walkthrough.md`](../../../docs/example-walkthrough.md) turn 21), the participant currently sees a graph that silently drops that edge. The information loss is asymmetric: the moderator's panel may surface the relation in other UI affordances (annotation lists, contradiction diagnostics), but on the participant's read-mostly graph view — the primary surface a debater consults to understand the session's structural state — the edge is invisible. Once the canonical walkthrough fixture E15 lands (`walkthrough_e15_annotation_endpoint_refit` is unblocked by `projection_edge_annotation_endpoint`), this gap becomes a regression in user-facing fidelity.

**The schema has been widened end-to-end across the data path.** The wire schema (`edge_target_annotation_schema_extension`), the projection layer (`projection_edge_annotation_endpoint`), and the proposal validators (`set_edge_substance_annotation_endpoint`) all accept polymorphic endpoints today. The participant canvas is the last consumer in the chain still silently dropping the shape — explicitly registered as debt by `projection_edge_annotation_endpoint`'s D3.

**The participant surface should match the audience and moderator surfaces' structural coverage.** All three surfaces have the same skip-guard today (`apps/moderator/src/graph/selectors.ts:365-374`, `apps/audience/src/graph/projectGraph.ts:308-321`, and `apps/participant/src/graph/projectGraph.ts:503-516`). Each is a separate UI-stream task scoped at the same effort (~1.5d). Landing the participant first establishes the design pattern (annotation-as-graph-node with conditional materialization) that the moderator's ReactFlow port and the audience's Cytoscape port can replicate.

**Unblocks downstream gestures.** [`mod_propose_annotation_endpoint_gestures`](../../30-moderator-ui.tji) is sequenced after the moderator-side rendering task with rationale: an annotation must be a click-target before a user can pick it as an edge endpoint via the canvas. The participant side doesn't mint proposals (read-mostly), but the same logic governs the participant's tap-to-select-annotation affordance — only meaningful once annotations are graph-nodes.

## Inputs / context

**Design contract:**

- [`docs/example-walkthrough.md`](../../../docs/example-walkthrough.md) — turn 21 names E15 (N19 contradicts A2). The narrative this rendering enables surfacing to participants.
- [`docs/data-model.md`](../../../docs/data-model.md) L114-122 — edge roles. Unchanged: the seven roles are independent of endpoint kind.
- [`docs/architecture.md`](../../../docs/architecture.md) — Cytoscape for the participant per ADR 0004.

**Architectural / engineering inputs:**

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Cytoscape.js for participant read-mostly.
- [ADR 0008](../../../docs/adr/0008-e2e-framework-playwright.md) — Playwright spec layer; user-stream tasks default to a Playwright cover scoped under Acceptance criteria.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every check is a committed Vitest case or Playwright block.
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — annotations are entities; this task widens the canvas's entity-rendering vocabulary.

**Runtime inputs (real files the implementer reads + edits):**

- [`apps/participant/src/graph/projectGraph.ts:139-260`](../../../apps/participant/src/graph/projectGraph.ts) — `ParticipantNodeData` interface. Widens to add `nodeKind: 'statement' | 'annotation'` and `annotationKind: AnnotationKind | null`.
- [`apps/participant/src/graph/projectGraph.ts:443-456`](../../../apps/participant/src/graph/projectGraph.ts) — `projectGraph` function signature + entry. Signature is unchanged (the new fields populate from existing indices + the annotation index already threaded as the fourth argument); the function body widens.
- [`apps/participant/src/graph/projectGraph.ts:473-501`](../../../apps/participant/src/graph/projectGraph.ts) — `node-created` arm. Stamps `nodeKind: 'statement'` and `annotationKind: null` on every statement node.
- [`apps/participant/src/graph/projectGraph.ts:503-516`](../../../apps/participant/src/graph/projectGraph.ts) — **the skip-guard removed by this task**. The comment naming `part_render_annotation_endpoint_edges` is the breadcrumb pointing here.
- [`apps/participant/src/graph/projectGraph.ts:517-537`](../../../apps/participant/src/graph/projectGraph.ts) — `edge-created` element construction. `source` / `target` resolve via `?? null` chain across the four payload fields.
- **New arm added to `projectGraph`**: `annotation-created` event walker. Stores the payload in a Map for the deferred-emission pass at function exit.
- **New pass added to `projectGraph`**: pre-walk OR end-of-walk pass that emits one annotation graph-node per referenced-annotation-id. Builds the referenced-set during the edge walk; emits at end so the order is deterministic (annotations referenced earlier in the log emit earlier).
- [`apps/participant/src/graph/annotations.ts`](../../../apps/participant/src/graph/annotations.ts) — existing `Annotation` type + bucketers. Reused for the annotation kind / content lookup; this task adds no new types here.
- [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) — Cytoscape mount + `STYLESHEET` constant + DOM mirror render. All three sites change: stylesheet gains the new branch, mirror gains the new attributes, the React render handles both `nodeKind` rows.
- [`apps/participant/src/graph/nodeDimensions.ts`](../../../apps/participant/src/graph/nodeDimensions.ts) — `computeNodeDimensions(wording)`. Reused as-is for annotation graph-node dimension calculation (annotation content is also a string and the wrap-budget math is wording-length-agnostic).
- [`apps/participant/src/state/selectionStore.ts`](../../../apps/participant/src/state/selectionStore.ts) — Zustand selection store. Discriminated union widens.
- [`apps/participant/src/graph/projectGraph.test.ts`](../../../apps/participant/src/graph/projectGraph.test.ts) — Vitest unit cases. Adds the materialization + endpoint-shape + sentinel-default cases.
- [`apps/participant/src/graph/GraphView.test.tsx`](../../../apps/participant/src/graph/GraphView.test.tsx) — Vitest component cases. Adds the mirror-attribute cases.
- [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) — Playwright spec. Adds a 4th block (the user-pool expansion already cleared the way per `part_e2e_user_pool_expansion`).
- [`apps/participant/src/components/EntityDetailPanel.tsx`](../../../apps/participant/src/components/EntityDetailPanel.tsx) (or wherever the panel render lives) — read the new `'annotation'` discriminant and render a placeholder per D6.
- [`packages/shared-types/src/annotations.ts`](../../../packages/shared-types/src/annotations.ts) (if exists) — `AnnotationKind` type. Imported as the type for the new `annotationKind` field.

## Constraints / requirements

- **Annotation graph-node materialization is conditional, not universal.** Only annotations referenced as an `edge-created` source or target endpoint materialize as graph-nodes. Non-endpoint annotations continue to render as `hasAnnotation` / `annotationCount` overlays on their target node/edge per the existing `part_annotation_render` contract. This is the smallest behaviour-change that resolves the edge-rendering gap without re-deciding how non-endpoint annotations surface (D2).
- **Annotation graph-nodes use distinct visual identity.** Per D4, a `node[nodeKind = "annotation"]` selector group paints them as round-tag amber-bordered boxes with smaller font, and per-`annotationKind` selectors apply the same four-color palette the moderator's `AnnotationBadge` already uses. This signals "different entity-kind" without breaking the stylesheet's per-layer composability (each existing per-status / overlay / diagnostic / vote layer's selectors are properties annotation nodes legitimately don't claim — facet-status doesn't apply, votes don't apply, axiom-marks don't apply — so the stylesheet's existing branches paint nothing on annotation nodes per D3).
- **Statement-only fields carry sentinel defaults on annotation nodes.** Per D3 the `ParticipantNodeData` shape stays single (no separate `ParticipantAnnotationNodeData`). Annotation nodes emit `kind: null`, `facetStatuses: EMPTY_FACET_STATUSES`, `rollupStatus: 'none'`, `isAxiom: false`, `ownVote: 'none'`, `otherVotes: EMPTY_OTHER_VOTES_LIST`, `diagnosticHighlight: null`. The existing Cytoscape selectors keyed off these fields produce no paint for annotation nodes (e.g. `[?isAxiom]` is `false`, so the double-border branch doesn't apply). This forward-compatibility posture matches the established projection layering pattern.
- **`hasAnnotation` / `annotationCount` still apply to annotation graph-nodes.** Per D7 the annotation-of-annotation chain rule lets an annotation be itself annotated; the existing `nodeAnnotationIndex` already buckets by target node id (and would bucket by target annotation id once the methodology surfaces the chain end-to-end). Annotation graph-nodes read these fields uniformly; for v0 the typical case is `false` / `0`, and the propagation is registered as a follow-up.
- **`isFlashing` still applies to annotation graph-nodes.** Per the proposal-notification refinement, `flashIndex` keys are entity ids — when a new annotation lands, its id flashes whether it's an overlay or a graph-node.
- **The XOR `.refine()` on the wire schema is the source of truth for endpoint exclusivity.** The participant projector does no per-handler XOR re-check — the wire schema guarantees exactly one of source_node_id/source_annotation_id is set, and symmetric for target. The `??` chain resolves unambiguously: `source_node_id ?? source_annotation_id ?? null`. The `?? null` tail is defensive — if the schema's `.refine()` were ever weakened to allow both-null endpoints, the projector falls through to a `continue` so the edge silently drops rather than throwing.
- **Skip annotation-endpoint edges whose endpoint annotation is NOT in the log.** Per D2's invariant, an `edge-created` referencing an annotation id that has no preceding `annotation-created` in the log is a malformed log; the projector skips such an edge defensively (the materialization pass only materializes annotations whose `annotation-created` was seen). Vitest pins this skip.
- **Selection store widens; entity-detail-panel renders a placeholder for v0.** Per D6 the panel doesn't render annotation entities yet — that's the deferred follow-up. Tapping an annotation node updates the selection store; the panel renders "Annotation selected — detail view coming soon" (i18n'd via the shell catalog). The Cytoscape `:selected` overlay paints normally on the annotation graph-node.
- **Build + test discipline per ADR 0022.** Every check is a committed Vitest case or Playwright spec block; no throwaway verifications.

## Acceptance criteria

**Pinned per ADR 0022.** The e2e is in scope (UI-stream task per the refinements README's policy; the surface IS reachable today via the `/p/sessions/:id` operate route).

Type + projection widening:

- [ ] [`apps/participant/src/graph/projectGraph.ts:139-260`](../../../apps/participant/src/graph/projectGraph.ts) `ParticipantNodeData` adds `nodeKind: 'statement' | 'annotation'` and `annotationKind: AnnotationKind | null`. Existing fields are unchanged.
- [ ] `projectGraph` function body gains an `annotation-created` event arm that caches `{ id, kind, content }` into a Map<string, AnnotationPayload> for the materialization pass.
- [ ] `projectGraph` function body builds a `referencedAnnotationIds: Set<string>` during the `edge-created` walk, populated from `event.payload.source_annotation_id` and `event.payload.target_annotation_id` when set.
- [ ] After the events walk completes, `projectGraph` emits one annotation graph-node per id in `referencedAnnotationIds ∩ annotationPayloads.keys()` (only annotations whose `annotation-created` was seen). Each emitted node carries `id` = annotation id, `wording` = annotation content, `nodeKind: 'annotation'`, `annotationKind: <kind>`, and sentinel defaults for the statement-only fields per D3.
- [ ] The L503-516 skip-guard is removed; the edge `data.source` and `data.target` resolve via `event.payload.source_node_id ?? event.payload.source_annotation_id` (and symmetric for target). The XOR `.refine()` guarantees exactly one is set; the `?? null` tail is defensive.
- [ ] An `edge-created` referencing an annotation id with no preceding `annotation-created` is `continue`-skipped defensively.

Stylesheet branch:

- [ ] [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) `STYLESHEET` gains `node[nodeKind = "annotation"]` selector group with: `shape: 'round-tag'`, `background-color: '#fef3c7'`, `border-color: '#d97706'`, `border-width: 1.5`, `font-size: 12`.
- [ ] Per-`annotationKind` selector pair adds the four-color palette: `[annotationKind = "note"]` (amber); `[annotationKind = "reframe"]` (violet — `#7c3aed`); `[annotationKind = "scope-change"]` (teal — `#0d9488`); `[annotationKind = "stance"]` (sky — `#0284c7`). Each overrides `border-color` only.
- [ ] Existing per-status / overlay / diagnostic / vote / selected branches still apply uniformly (annotation nodes' statement-only field defaults mean those branches paint nothing — verified by Vitest snapshot).

DOM mirror:

- [ ] Per-node `<li data-testid="participant-node-status">` rows carry `data-node-kind="statement"` or `data-node-kind="annotation"` (sentinel-string posture).
- [ ] Annotation rows additionally carry `data-annotation-kind="<kind>"` matching the wire kind (`note` / `reframe` / `scope-change` / `stance`).
- [ ] Existing per-edge mirror rows are unchanged in shape; their existing `data-source-id` / `data-target-id` carry the annotation id when the endpoint is an annotation.

Selection store + detail panel placeholder:

- [ ] [`apps/participant/src/state/selectionStore.ts`](../../../apps/participant/src/state/selectionStore.ts) `SelectedEntity` discriminated union widens to include `{ kind: 'annotation', id: string }`. `useSelectionStore.select({ kind: 'annotation', id })` and `.clear()` work as today.
- [ ] The tap-handler at the Cytoscape mount reads the tapped node's `data.nodeKind` to write the correct discriminant — `'annotation'` for `nodeKind === 'annotation'`, `'node'` otherwise.
- [ ] The entity-detail-panel renders a placeholder ("Annotation selected — detail view coming soon", i18n'd via shell catalog key `participant.annotation.detail.placeholder`) when the selected entity is an annotation, without crashing or rendering as a statement node.

Vitest cover:

- [ ] [`apps/participant/src/graph/projectGraph.test.ts`](../../../apps/participant/src/graph/projectGraph.test.ts) — case A: `node-source + annotation-target` round-trip emits the statement node, the annotation graph-node, and one edge with `source` = node id and `target` = annotation id.
- [ ] Case B: `annotation-source + node-target` symmetric round-trip.
- [ ] Case C: `annotation-source + annotation-target` round-trip emits both annotations as graph-nodes + the edge.
- [ ] Case D: an annotation that is ONLY an overlay target (no edge referencing it) does NOT materialize as a graph-node — only the existing `hasAnnotation`/`annotationCount` overlay on the target.
- [ ] Case E: an `edge-created` referencing an annotation id with no preceding `annotation-created` is skipped (no edge emitted, no error thrown).
- [ ] Case F: an annotation graph-node's `ParticipantNodeData` carries sentinel defaults for `kind` / `facetStatuses` / `rollupStatus` / `isAxiom` / `ownVote` / `otherVotes` / `diagnosticHighlight`.
- [ ] Case G: an annotation graph-node's `nodeKind` is `'annotation'`, `annotationKind` matches the wire kind, `wording` is the annotation content, `id` is the annotation id.
- [ ] Case H: emit order is deterministic (annotation graph-nodes emit at the end of the nodes array, in `annotation-created` arrival order filtered by referenced-set membership).
- [ ] [`apps/participant/src/graph/GraphView.test.tsx`](../../../apps/participant/src/graph/GraphView.test.tsx) — case asserting mirror row carries `data-node-kind` and (for annotation rows) `data-annotation-kind`.
- [ ] [`apps/participant/src/state/selectionStore.test.ts`](../../../apps/participant/src/state/selectionStore.test.ts) — case asserting `select({ kind: 'annotation', id })` round-trips through the store.
- [ ] Failing-first verification per ADR 0022: stubbing out the L503-516 skip-guard removal flips the round-trip cases red but leaves overlay-only cases green.

Playwright cover:

- [ ] [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) gains a 4th block. The block seeds (via `window.__aConversaWsStore`) a session log carrying:
  - `session-created`
  - `node-created` (one statement node N1)
  - `annotation-created` (one annotation A1 targeting N1)
  - `edge-created` with `source_node_id = N1`, `target_annotation_id = A1`, `role = 'contradicts'`
- [ ] The block asserts the participant-graph-status-mirror contains: a `<li data-node-kind="statement" data-node-id="N1">` row; a `<li data-node-kind="annotation" data-node-id="A1" data-annotation-kind="note">` row; a `<li data-edge-id="<edgeId>" data-source-id="N1" data-target-id="A1" data-role="contradicts">` row.
- [ ] The block asserts the Cytoscape instance (via `window.__aConversaCyInstance`) reports two nodes and one edge present.
- [ ] The block asserts a tap on the annotation node's mirror row (or via the test seam) updates the selection store to `{ kind: 'annotation', id: 'A1' }` and the detail panel renders the placeholder.

Existing tests stay green:

- [ ] Every existing Vitest suite passes — including the prior `projectGraph` baseline cases.
- [ ] Every existing Cucumber feature passes (no Cucumber change — backend layer unchanged).
- [ ] Every existing Playwright suite passes — the prior `participant-graph-render` blocks (1–3) still drive their node-only / node-edge cases; the new block is additive.

Build + scheduler:

- [ ] `pnpm -F @a-conversa/participant build` succeeds.
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green; Vitest baseline rises by ~10 (the new cases above). Playwright baseline rises by 1 block.
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/40-participant-ui.tji` gets `complete 100` on `part_render_annotation_endpoint_edges`.
- [ ] The dead-code comment in [`apps/participant/src/graph/projectGraph.ts:503-516`](../../../apps/participant/src/graph/projectGraph.ts) is removed (the guard is removed by this task; the comment naming THIS task as the resolution is no longer load-bearing).

Tech-debt registration:

- [ ] **`part_entity_detail_panel_annotation_view` (future task — ~1d, UI-stream, participant).** The entity-detail-panel today renders statement nodes and edges; this task introduces an annotation discriminant rendering a placeholder. The follow-up replaces the placeholder with the full annotation view (kind label, content text, author attribution, target-of-this-annotation link, contradicts-this-annotation edge list, etc.), likely mirroring the moderator's `AnnotationBadge` extracted into the shell package. Closer registers under `participant_ui.part_graph_view.*`. Includes Playwright cover (asserts the panel surfaces the annotation's content + kind + author).
- [ ] **`part_annotation_of_annotation_overlay_chain` (future task — ~0.5d, UI-stream, participant).** Once the methodology engine adopts the `coherency_annotation_of_annotation_chain_rule` end-to-end, an annotation A1 targeting another annotation A2 may want to overlay on A2's materialized graph-node (the existing overlay-on-target pattern, applied transitively). Today's `groupAnnotationsByNode` keys only by node ids; the follow-up may widen to a unified `groupAnnotationsByEntityId` over `{ kind, id }` buckets. Closer registers under `participant_ui.part_graph_view.*`. Includes Vitest cover (no Playwright — the chain is observable via the mirror).

## Decisions

- **D1 — Conditional annotation graph-node materialization (annotations materialize only when referenced as an edge endpoint); non-endpoint annotations continue to render as overlays on their target node/edge.** Rationale:
  - **Smallest behaviour-change that resolves the edge-rendering gap.** The skip-guard exists because annotation-endpoint edges have no graph-node to bind to. Materializing the annotations referenced as endpoints provides the binding targets without re-deciding the entire annotation visual idiom.
  - **Preserves the existing `part_annotation_render` contract.** Non-endpoint annotations are a much larger population than endpoint annotations (the typical case is "annotation A notes node N", not "edge E contradicts annotation A"); flipping the typical case from overlay to graph-node would invalidate the existing visual vocabulary and create a much larger UX redesign. Per the `part_annotation_render` D1, the overlay-on-target idiom was a deliberate choice; this task additively extends it, not replaces it.
  - **Avoids a layout explosion.** Materializing every annotation as a graph-node would multiply the Cytoscape element count by ~2-4× in a session with active annotation activity; the `cose` layout's runtime is super-linear in node count, and the participant tablet's layout budget is already tight.
  - **Alternative considered: materialize ALL annotations as graph-nodes (drop the conditional).** Rejected — large UX redesign, layout-cost regression, breaks the existing overlay contract.
  - **Alternative considered: render annotation-endpoint edges as floating (no graph-node binding).** Rejected — Cytoscape renders orphan-source/target edges invisibly. No user-visible outcome.
  - **Alternative considered: coerce annotation endpoints to "the node the annotation targets" (i.e. render the edge as if it pointed at the underlying statement).** Rejected — exactly the encoding workaround the schema widening was designed to FIX. Re-introducing it at the canvas seam silently reverts the structural fidelity gain of the data-layer widening (this is the same alternative the projection-layer task's D1 rejected for the same reason).
  - **Alternative considered: render annotation-endpoint edges as a side-pane list (no canvas rendering).** Rejected — undermines the canvas as the structural-narrative surface; the participant goes to the side pane to learn the structure rather than seeing it on the graph; reduces the canvas's information density.

- **D2 — Annotations not in the log (referenced by an edge but with no preceding `annotation-created`) are silently skipped — the edge is `continue`-skipped defensively rather than emitted with a dangling endpoint.** Rationale:
  - **The condition shouldn't happen.** The wire schema for `edge-created` doesn't enforce annotation existence (that's an event-log integrity concern, not a per-event check). But the server's event handler validates against the current projection state, and the WS broadcast can only carry endpoint annotations whose `annotation-created` event preceded.
  - **Defensive over throwing.** A throw at the projector seam would cascade up and blank the participant canvas on any seed with a malformed annotation reference; a silent skip degrades the rendering gracefully (the edge is invisible; the rest of the graph renders).
  - **Vitest pins it.** Case E in Acceptance criteria pins the skip, so a future change that flips this to a throw shows up as a test failure rather than a silent regression.
  - **Alternative considered: throw `ProjectionInvariantError`-style.** Rejected — over-strict for a UI-side projector. The server's projection layer is the right place for invariant enforcement; the UI projector mirrors the broadcast.
  - **Alternative considered: emit the edge with `source = '__missing__'` or null.** Rejected — Cytoscape's required `source`/`target` invariant + the `source: 'data(id)'` mapping leaves no clean null story; an explicit `continue` is cleaner.

- **D3 — Single `ParticipantNodeData` shape; annotation graph-nodes carry sentinel defaults for statement-only fields (`kind: null`, `facetStatuses: EMPTY_FACET_STATUSES`, `rollupStatus: 'none'`, `isAxiom: false`, `ownVote: 'none'`, `otherVotes: EMPTY_OTHER_VOTES_LIST`, `diagnosticHighlight: null`). A new `nodeKind: 'statement' | 'annotation'` discriminator on the shared shape lets stylesheet + mirror branch.** Rationale:
  - **Forward-compatibility pattern is established.** Every prior layer (`part_per_facet_state_styling`, `part_axiom_mark_decoration`, etc.) adopted "emit defaults forward; consumers can ignore" — `rollupStatus: 'none'`, `isAxiom: false`, `ownVote: 'none'`. Annotation nodes adopting the same defaults means existing selectors paint nothing on them (the `[?isAxiom]` branch is `false`, the `[ownVote = "agree"]` branch is `'none'`, etc.) without needing per-selector annotation-exclusions.
  - **Avoids type churn at every consumer site.** Splitting into `ParticipantStatementNodeData | ParticipantAnnotationNodeData` would force every Cytoscape consumer (the mirror render, the tap-handler, the detail panel) to switch on the discriminant before reading any field. The shared shape with sentinels keeps reads polymorphic.
  - **`useMemo` reference stability stays cheap.** The shared `EMPTY_FACET_STATUSES` / `EMPTY_OTHER_VOTES_LIST` frozen constants are referenced (not freshly allocated) for annotation nodes, matching the established memoization discipline.
  - **Alternative considered: separate `ParticipantAnnotationNodeData` type + discriminated union.** Rejected — clean type shape but every read site needs `if (data.nodeKind === 'annotation') ...` discrimination; the shared shape lets the stylesheet do the branching.
  - **Alternative considered: drop the statement-only fields from annotation nodes (TS-narrow `kind?: StatementKind`).** Rejected — `?:` makes every consumer check `undefined`; the sentinel posture is more uniform.

- **D4 — Annotation graph-nodes use round-tag shape + four-color palette (amber / violet / teal / sky) matching the moderator's `AnnotationBadge` kind-vocabulary; a `node[nodeKind = "annotation"]` selector group lives at the bottom of the `STYLESHEET` constant.** Rationale:
  - **Visual distinctness is required.** A user looking at the canvas needs to read "this is an annotation, not a statement" without ambiguity. Round-tag shape (Cytoscape's `'round-tag'`) is recognizably different from the statement default (`'rectangle'`).
  - **Four-color palette is already authored.** The moderator's `AnnotationBadge` uses amber/violet/teal/sky for the four annotation kinds; the participant adopting the same vocabulary keeps cross-surface coherence (and means the future `AnnotationBadge` extraction into the shell package can reuse the same constants).
  - **The stylesheet's layering discipline is preserved.** The new branch claims `shape`, `background-color`, `border-color`, `border-width`, `font-size` — none of which are claimed by per-status / overlay / diagnostic / vote / selected branches today (those claim `border-style`, `width` for nodes, `outline-*`, `overlay-*`, `text-outline-*`, `z-index`, `background-blacken`). No cross-layer interference.
  - **Smaller font signals "less weighty than a statement".** Annotations are commentary on statements; their visual weight should be subordinate.
  - **Alternative considered: paint annotation nodes identically to statement nodes with just a colored border.** Rejected — at-a-glance distinguishability requires shape differentiation, not just color (color-blindness, low-contrast displays, etc.).
  - **Alternative considered: hexagon or octagon shape.** Rejected — round-tag is the most "label-like" of Cytoscape's built-in shapes and reads as commentary; hexagons/octagons read as "decision" or "process" in standard diagrammatic vocabulary.

- **D5 — Annotation graph-nodes use the annotation id directly as the Cytoscape `data.id`. The id space (UUID v4) has effectively zero collision risk across node + annotation populations.** Rationale:
  - **The wire schema uses the same id space.** Annotation ids and node ids are both UUID v4; they're already distinguishable by the surrounding semantic context (the event kind, the lookup-from-bucket). Cytoscape's id-uniqueness invariant is satisfied because UUID v4 collisions are statistically impossible.
  - **Edge `data.source` / `data.target` resolve cleanly via the `?? null` chain.** No id-namespace prefix needed.
  - **Tap-handler discrimination reads `data.nodeKind`, not the id shape.** Knowing "this tap was on an annotation" comes from `event.target.data('nodeKind')` not from id parsing.
  - **Alternative considered: prefix annotation ids in the Cytoscape graph (`'ann-' + id`).** Rejected — extra unmarshalling at every consumer site; selectors need to know to strip the prefix; future code can confuse the prefixed and unprefixed forms.
  - **Alternative considered: use compound keys (`{ kind, id }` as a JSON-stringified composite id).** Rejected — Cytoscape's id is a string; round-tripping JSON strings as ids is brittle and the discrimination is already cleanly available via the `data.nodeKind` field.

- **D6 — The selection store widens to a three-discriminant union (`'node' | 'edge' | 'annotation'`); the entity-detail-panel renders a placeholder for the annotation case in v0; full annotation-entity rendering is deferred to `part_entity_detail_panel_annotation_view`.** Rationale:
  - **The selection-store widening is load-bearing for this task** — tap-to-select on an annotation node has to do something; crashing is not an option.
  - **The detail-panel rendering is a separate concern.** Full annotation-entity rendering (kind label, content prose, author attribution, target-back-link, contradicts-list, etc.) is a similar-effort job to the original `part_entity_detail_panel`'s scope (~1d). Bundling it here doubles this task's effort without much gain.
  - **The placeholder is honest interim UX.** A user who taps an annotation sees "Annotation selected — detail view coming soon" rather than a confusing render or a blank panel. The placeholder is i18n'd via the shell catalog so it's not English-locked.
  - **Alternative considered: bundle the full annotation-detail-panel rendering here.** Rejected — doubles the task effort and dilutes scope. The Tech-debt registration captures the follow-up explicitly.
  - **Alternative considered: don't widen the selection store; ignore taps on annotation nodes.** Rejected — silent failure on tap is worse UX than a placeholder; users expect tap to do something.

- **D7 — Annotation-of-annotation overlay propagation (an annotation targeting an annotation graph-node showing as an overlay on the materialized graph-node) is deferred to a follow-up. v0 emits annotation graph-nodes with `hasAnnotation: false` / `annotationCount: 0` regardless of whether other annotations target them.** Rationale:
  - **The methodology-engine chain rule hasn't surfaced end-to-end yet.** `coherency_annotation_of_annotation_chain_rule` is an advisory hint at the diagnostics layer (landed 2026-05-30 per recent commits); it doesn't yet flow through the projection as a structural relation the UI must surface.
  - **The bucketers would need widening.** `groupAnnotationsByNode` keys by node ids only; a unified `groupAnnotationsByEntityId` over `{ kind, id }` buckets is a small but distinct refactor that touches the `part_annotation_render` contract.
  - **The visual story isn't decided.** Whether an annotation-on-annotation should overlay (amber halo over the round-tag) or appear as another edge or surface only in the detail panel is a design question worth its own discussion.
  - **Alternative considered: thread the annotation-on-annotation overlay here.** Rejected — drags in the bucketer refactor + a design decision the methodology-engine hasn't yet surfaced as a load-bearing user-visible relation.

- **D8 — Add a 4th block to the existing `participant-graph-render.spec.ts` rather than create a new spec file. The `part_e2e_user_pool_expansion` (settled 2026-05-30) cleared the way for parallel execution.** Rationale:
  - **Locality.** The new block exercises the same operate-route surface the existing blocks exercise; co-locating keeps the seed-via-WS-store setup helpers shared.
  - **User-pool budget.** The recent `part_e2e_user_pool_expansion` added two dev user pairs so a 4th block doesn't re-exhaust the pool; the spec stays parallel (no `test.describe.serial`).
  - **Symmetry with the moderator-side task.** The moderator's `mod_render_annotation_endpoint_edges` similarly adds to its existing canvas spec; participant follows suit.
  - **Alternative considered: a dedicated `participant-annotation-endpoint-edges.spec.ts` file.** Rejected — duplicates the OIDC setup + seed-helper boilerplate; the 4th block is ~30 lines of net new code in the existing file.

- **D9 — No new ADR. The polymorphic-endpoint pattern is settled by `entity_creation_events` (R11 / option a) and the projection-layer widening; the canvas-rendering choices (conditional materialization, sentinel defaults, four-color palette) are engineering choices documented in Decisions, not architectural decisions worth an ADR.** Rationale:
  - **ADRs capture architecture-level choices.** "How does the participant canvas paint annotation entities" is product / UX design within an established architectural envelope (Cytoscape per ADR 0004; overlay-on-target per `part_annotation_render`); the choices here are visual / interaction polish.
  - **The conditional-materialization rule is a Refinement-level Decision.** It binds this task's scope; future tasks (moderator, audience) are free to adopt the same rule or diverge with their own reasoning.
  - **Alternative considered: an ADR for "annotations as canvas-renderable graph-nodes."** Rejected — not a cross-cutting architectural commitment. Each UI stream (moderator / participant / audience) can revisit independently as its rendering tech surfaces different constraints (ReactFlow vs Cytoscape).

## Open questions

(none — all decided in D1–D9.)

## Status

**Done** — 2026-05-30.

- `apps/participant/src/graph/projectGraph.ts` — widened `ParticipantNodeData` with `nodeKind`/`annotationKind`; added `annotation-created` arm caching payloads; lifted the L503-516 skip-guard; resolves endpoints via `?? null` chain; defensive skip for unknown annotation refs; deferred materialization pass emits annotation graph-nodes for referenced ∩ seen annotations with sentinel defaults per D3.
- `apps/participant/src/graph/GraphView.tsx` — added `node[nodeKind = "annotation"]` baseline + four `[annotationKind = ...]` per-kind palette overrides; updated `handleTap` to read `data.nodeKind` and write `'annotation'` discriminant; per-node `<li>` rows carry `data-node-kind` + `data-annotation-kind`; widened `selectedFlag` signature; dropped three redundant `as 'node' | 'edge'` type assertions (lint fix).
- `apps/participant/src/detail/EntityDetailPanel.tsx` — added annotation-placeholder branch rendering `participant.annotation.detail.placeholder`.
- `apps/participant/src/detail/lookupEntity.test.ts` + `apps/participant/src/detail/EntityDetailPanel.test.tsx` — updated test fixtures to include `nodeKind`/`annotationKind`.
- `apps/participant/src/stores/stores.test.tsx` — added annotation-discriminant case for the selection store.
- `apps/participant/src/graph/projectGraph.test.ts` — 8 new cases (ann-A through ann-H): materialization, endpoint shapes, sentinel defaults, deterministic emit order, skip-guard removal.
- `apps/participant/src/graph/GraphView.test.tsx` — 3 new mirror-attribute cases (ann-mirror-a through ann-mirror-c) for `data-node-kind`/`data-annotation-kind`.
- `tests/e2e/participant-graph-render.spec.ts` — block-12 (leo+kate, block-6 role-swap) seeding `node-created` + `annotation-created` + `edge-created (target_annotation_id)`, asserting materialized annotation row, placeholder panel branch via synthetic tap.
- `packages/i18n-catalogs/src/catalogs/{en-US,es-419,pt-BR}.json` — added `participant.annotation.detail.placeholder` in all three locales.
- Tech-debt registered: `part_entity_detail_panel_annotation_view` (~1d) and `part_annotation_of_annotation_overlay_chain` (~0.5d) in `tasks/40-participant-ui.tji`.
