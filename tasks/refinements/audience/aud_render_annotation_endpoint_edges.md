# Render annotation-endpoint edges on the audience Cytoscape canvas

**TaskJuggler entry**: `audience.aud_graph_rendering.aud_render_annotation_endpoint_edges` — [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) (block at L322-L333). Embedded note: *"Source of debt: projection_edge_annotation_endpoint — the audience Cytoscape canvas currently skips annotation-endpoint edges (apps/audience/src/graph/projectGraph.ts) because annotations are not yet rendered as Cytoscape nodes. Rendering annotation-endpoint edges requires resolving the design question of how the canvas surfaces annotations as standalone graph nodes. Includes Playwright cover asserting an annotation-endpoint edge appears on the canvas."*

## Effort estimate

**1.5d** (per the `.tji` allocation). Roughly:

- **Project-graph widening** (~0.3d). Lift the skip-guard at [`apps/audience/src/graph/projectGraph.ts:308-321`](../../../apps/audience/src/graph/projectGraph.ts#L308); add `computeAnnotationsAsEndpoints(events): Set<string>` walker; widen the `edge-created` arm to resolve endpoints via `source_node_id ?? source_annotation_id` (and symmetric `target_*`); add deferred-emission pass that materializes annotation Cytoscape nodes for the promoted ids.
- **Node-data + edge-data widening** (~0.2d). `AudienceNodeData` gains `nodeKind: 'statement' | 'annotation'` and `annotationKind: AnnotationKind | null` (sentinel defaults `'statement'` / `null` per Decision §3, mirroring the participant's posture). `AudienceEdgeData` gains `entityRole: 'statement' | 'annotation-host'` and a sentinel `roleLabel` slot already exists; the synthetic host edge stamps `entityRole = 'annotation-host'` + empty `roleLabel`.
- **Synthetic host pseudo-edge** (~0.2d). `projectAnnotationHostEdges(annotations, promotedSet, events): AudienceEdgeElement[]` emits one dashed tether per promoted annotation per Decision §4. Edge id `annotation-host-<A.id>`.
- **Badge-suppression** (~0.1d). The existing `nodeAnnotationIndex` / `edgeAnnotationIndex` map results are filtered against the promoted set before being stamped on `data.annotations`. An annotation in the promotion set renders as a Cytoscape node — never as a DOM-overlay badge (mutual exclusion per Decision §3).
- **Stylesheet additions** (~0.2d). Append `node[nodeKind = 'annotation']` baseline (round-tag shape, `width: 140`, `height: 48`, amber-100 fill, amber-900 border, smaller font), four `[nodeKind = 'annotation'][annotationKind = '<kind>']` per-kind palette overrides (Decision §5 — match participant's amber/violet/teal/sky vocabulary), and one `edge[entityRole = 'annotation-host']` selector (dashed slate-300 line, no arrow, no label).
- **Vitest cover** (~0.3d). Promotion-set helper, projectors, lifted edge-arm, mutual-exclusion pin on both nodeAnnotationIndex and edgeAnnotationIndex, stylesheet selector smoke, projectGraph round-trip.
- **Playwright cover** (~0.2d). One new scenario inside [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) seeding `node-created` + `annotation-created` + `edge-created (target_annotation_id)` via the `window.__aConversaWsStore` dev seam and asserting the materialized annotation node + the annotation-host tether + badge absence for the promoted annotation.

## Inherited dependencies

**Settled:**

- [`audience.aud_graph_rendering.aud_annotation_rendering`](./aud_annotation_rendering.md) (done — 2026-05-28, `complete 100` at [`tasks/50-audience-and-broadcast.tji:238`](../../50-audience-and-broadcast.tji#L238)). Shipped:
  - [`apps/audience/src/graph/annotations.ts`](../../../apps/audience/src/graph/annotations.ts) — `Annotation`, `EMPTY_ANNOTATIONS`, `projectAnnotations`, `groupAnnotationsByNode` (and, by `aud_annotation_rendering_edges`, `groupAnnotationsByEdge`).
  - [`apps/audience/src/graph/AnnotationBadge.tsx`](../../../apps/audience/src/graph/AnnotationBadge.tsx) — DOM-overlay amber pill (`audience-annotation-badge-<id>`).
  - [`apps/audience/src/graph/AnnotationOverlay.tsx`](../../../apps/audience/src/graph/AnnotationOverlay.tsx) — sibling overlay iterating `cy.nodes()` AND `cy.edges()`, anchored 30 px below the node / 18 px above the edge midpoint.
  - `data.annotations: readonly Annotation[]` on both `AudienceNodeData` (line 172) and `AudienceEdgeData` (line 208). This task **filters** that field at projection time to exclude promoted ids — Decision §3.
  - That refinement's Decision §1 ("per-annotation DOM-overlay badges") **is amended** (not invalidated) by this task for the subset of annotations that participate as edge endpoints: the promoted subset renders as Cytoscape graph-nodes; the non-endpoint subset stays as DOM badges. Same hybrid-promotion shape the moderator's `mod_render_annotation_endpoint_edges` adopted.

- [`audience.aud_graph_rendering.aud_annotation_rendering_edges`](./aud_annotation_rendering_edges.md) (done — 2026-05-28, `complete 100` at [`tasks/50-audience-and-broadcast.tji:262`](../../50-audience-and-broadcast.tji#L262)). Extends the overlay to also iterate `cy.edges()` and stamps `annotations` on `AudienceEdgeData`. This task additionally filters the edge-targeted bucket against the promoted set (an annotation that decorates an edge AND is also referenced as an edge endpoint elsewhere stops being a badge — mutual exclusion is symmetric across the node + edge buckets).

- [`data_and_methodology.projection.projection_edge_annotation_endpoint`](../data-and-methodology/projection_edge_annotation_endpoint.md) (done — 2026-05-30, `complete 100` at [`tasks/10-data-and-methodology.tji:226`](../../10-data-and-methodology.tji#L226)). Widened `ProjectedEdge` / `EdgeAddedChange` / wire snapshot serializer to four polymorphic endpoint slots and lifted the `handleEdgeCreated` `ReplayError` guard. The audience's [`projectGraph.ts:308-321`](../../../apps/audience/src/graph/projectGraph.ts#L308) skip-guard is the last UI consumer in the chain; that comment block explicitly names THIS task as the unblocker.

- [`data_and_methodology.event_types.edge_target_annotation_schema_extension`](../data-and-methodology/edge_target_annotation_schema_extension.md) (done). Widened `edgeCreatedPayloadSchema` so `source_node_id` / `target_node_id` are optional and a pair of `.refine()` blocks enforce per-endpoint XOR with `source_annotation_id` / `target_annotation_id`.

- [`audience.aud_url_routing.aud_session_url`](./aud_session_url.md) (done — `complete 100` at [`tasks/50-audience-and-broadcast.tji:505`](../../50-audience-and-broadcast.tji#L505)). The audience surface is reachable via `/a/sessions/:sessionId`; the `window.__aConversaWsStore` dev seam (assigned by [`apps/audience/src/main.tsx`](../../../apps/audience/src/main.tsx) when `import.meta.env.DEV`) lets Playwright apply synthetic events. **Playwright cover is therefore in scope** (not deferred); see Decision §8.

- [`moderator_ui.mod_annotation_ui.mod_render_annotation_endpoint_edges`](../moderator-ui/mod_render_annotation_endpoint_edges.md) (done — 2026-05-30, commit `7620ab7`). **The authoritative reference for the hybrid-promotion pattern this task mirrors.** Shipped on the moderator's ReactFlow surface:
  - `computeAnnotationsAsEndpoints(events): Set<string>` pure helper (`apps/moderator/src/graph/selectors.ts` L484-496).
  - `projectAnnotationNodes(...)` (L574-597) — emits one ReactFlow node per promoted annotation; sentinel `data-host-missing` when the host can't be resolved.
  - `projectAnnotationHostEdges(...)` (L615-636) — emits one dashed `'annotation-host'` ReactFlow edge per promoted annotation tethered to the host.
  - `<AnnotationNode>` ReactFlow node-type (`apps/moderator/src/graph/AnnotationNode.tsx`) + `<AnnotationHostEdge>` edge-type (`apps/moderator/src/graph/AnnotationHostEdge.tsx`).
  - Mutual-exclusion filter at the selector layer (Decision §3 there).
  - Decisions §1 (hybrid promotion), §3 (mutual exclusion enforced at selector), §4 (host pseudo-edge resolution rules), §7 (`pointer-events: none` on tether), §10 (`StatementEdgeData.sourceId`/`targetId` widen to accept annotation ids), §11 (tech-debt: `mod_annotation_node_edge_host_midpoint` for edge-hosted v1 approximation).

- [`participant_ui.part_graph_view.part_render_annotation_endpoint_edges`](../participant-ui/part_render_annotation_endpoint_edges.md) (done — 2026-05-30, `complete 100` at [`tasks/40-participant-ui.tji:211`](../../40-participant-ui.tji#L211)). **The Cytoscape-side precedent this task draws its concrete shape from**:
  - Conditional annotation graph-node materialization in `projectGraph` (D1).
  - Single `ParticipantNodeData` shape with `nodeKind: 'statement' | 'annotation'` + `annotationKind: AnnotationKind | null` + sentinel defaults for statement-only fields on annotation nodes (D3).
  - Cytoscape stylesheet `node[nodeKind = 'annotation']` baseline + four `[annotationKind = '<kind>']` per-kind palette overrides (D4) — amber / violet / teal / sky.
  - Annotation id used directly as Cytoscape `data.id`; UUID v4 collision space is effectively zero (D5).
  - Defensive `continue`-skip when an edge references an annotation not yet seen in the log (D2).
  - D7 deferred annotation-of-annotation overlay propagation to a follow-up (already paralleled on the audience side: `aud_annotation_of_annotation_overlay_chain` is registered at [`tasks/50-audience-and-broadcast.tji:334`](../../50-audience-and-broadcast.tji#L334) gated on THIS task).

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md). Cytoscape attribute-equality selectors (`node[nodeKind = 'annotation']`, `edge[entityRole = 'annotation-host']`) are the canonical Cytoscape extension shape — a parallel to ReactFlow's custom node/edge types the moderator picked.
- [ADR 0021 — Event envelope discriminated union](../../../docs/adr/0021-event-envelope-discriminated-union.md). The shell client validates incoming envelopes at parse time; the polymorphic-endpoint shape is narrowed by the schema before reaching `projectGraph`.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). Every check ships as a committed Vitest case or a Playwright scenario.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md). New helpers ship inside the audience workspace until `extract_cytoscape_projectors` lifts the cross-surface shapes into `@a-conversa/shell`.
- [ADR 0027 — Entity and facet layers strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md). Annotations are entity-layer; the node-discriminator widening is an entity-layer rendering concern. No facet machinery is touched (annotation nodes carry `rollupStatus: 'none'`, `facetStatuses: EMPTY_FACET_STATUSES` sentinel defaults — Decision §3).

**Pending:** (none — every load-bearing input is settled on `main`.)

The downstream consumer `aud_annotation_of_annotation_overlay_chain` ([`tasks/50-audience-and-broadcast.tji:334-347`](../../50-audience-and-broadcast.tji#L334)) is gated on THIS task per its `depends !aud_render_annotation_endpoint_edges` — it consumes this task's promoted-annotation graph-nodes as the overlay surface for parallel-targeted annotations. No re-registration needed.

## What this task is

Lift the audience Cytoscape canvas's `continue`-on-annotation-endpoint guard at [`apps/audience/src/graph/projectGraph.ts:308-321`](../../../apps/audience/src/graph/projectGraph.ts#L308) and render annotation-endpoint edges on the broadcast canvas by **promoting referenced annotations to standalone Cytoscape graph-nodes**. Mirrors the hybrid-promotion design the moderator's `mod_render_annotation_endpoint_edges` shipped on its ReactFlow surface (commit `7620ab7`) and the conditional-materialization design the participant's `part_render_annotation_endpoint_edges` shipped on its Cytoscape surface.

Concretely:

1. **A `computeAnnotationsAsEndpoints(events): Set<string>` pure helper** added to `apps/audience/src/graph/annotations.ts`. Walks the event log once collecting every annotation id referenced as `source_annotation_id` or `target_annotation_id` in any `edge-created` payload. This is the *promotion set*: annotations whose ids appear here become Cytoscape nodes; the rest stay DOM-overlay badges. Same shape as the moderator's `computeAnnotationsAsEndpoints` helper at [`apps/moderator/src/graph/selectors.ts:484-496`](../../../apps/moderator/src/graph/selectors.ts#L484-L496).

2. **`AudienceNodeData` widens** at [`apps/audience/src/graph/projectGraph.ts:146-183`](../../../apps/audience/src/graph/projectGraph.ts#L146):
   - Adds `nodeKind: 'statement' | 'annotation'` (default `'statement'` stamped on every existing `node-created` arm).
   - Adds `annotationKind: AnnotationKind | null` (default `null` for statement nodes; carries the wire `annotation-created` kind for promoted annotations).
   - For promoted annotations: statement-only fields carry sentinel defaults (`kind: null`, `facetStatuses: EMPTY_FACET_STATUSES`, `rollupStatus: 'none'`, `axiomMarks: EMPTY_AXIOM_MARKS`, `annotations: EMPTY_ANNOTATIONS`, `decomposed: undefined`), `wording: annotation.content` so the baseline Cytoscape `label: 'data(wording)'` selector renders the body.

3. **A new `projectAnnotationNodes(annotations, promotedSet): AudienceNodeElement[]` projector** in `apps/audience/src/graph/annotations.ts`. Emits one Cytoscape node descriptor per promoted annotation with the sentinel defaults above. Includes a `hostMissing: true` flag stamped on `data.hostMissing` when the annotation's host resolves to neither a known node nor a known edge (defensive — matches moderator §4).

4. **`AudienceEdgeData` widens** at [`apps/audience/src/graph/projectGraph.ts:189-209`](../../../apps/audience/src/graph/projectGraph.ts#L189):
   - Adds `entityRole: 'statement' | 'annotation-host'` (default `'statement'` stamped on every existing `edge-created` arm).
   - Existing `roleLabel: string` slot (stamped at `GraphView`'s element-construction layer from `t('methodology.edgeRole.<role>')`) carries the empty string on synthetic host edges.

5. **A new `projectAnnotationHostEdges(annotations, promotedSet, events): AudienceEdgeElement[]` projector** in `apps/audience/src/graph/annotations.ts`. For each promoted annotation A, emits one synthetic Cytoscape edge `{ data: { id: 'annotation-host-<A.id>', source: <hostId>, target: <A.id>, role: 'supports' (unused — covered by entityRole), entityRole: 'annotation-host', roleLabel: '', facetStatuses: EMPTY_FACET_STATUSES, rollupStatus: 'none', annotations: EMPTY_ANNOTATIONS }, group: 'edges' }`. Host resolution rules per Decision §4: `targetNodeId` first, then the `source_node_id` of the host edge `targetEdgeId` references (v1 approximation matching moderator §4). If unresolvable, the host edge is omitted and the annotation node carries `data.hostMissing = true`.

6. **Lift the L308-321 skip-guard** in `projectGraph`. The `edge-created` arm now accepts payloads with `source_annotation_id` / `target_annotation_id` set; the emitted edge's Cytoscape `data.source` and `data.target` resolve via `event.payload.source_node_id ?? event.payload.source_annotation_id` (and symmetric for target). The XOR `.refine()` on the wire schema guarantees exactly one is set per endpoint, so the `??` chain is unambiguous.

7. **Mutual-exclusion filter** in `projectGraph`. The existing `nodeAnnotationIndex = groupAnnotationsByNode(...)` and `edgeAnnotationIndex = groupAnnotationsByEdge(...)` results are post-filtered to exclude entries whose `annotation.id` is in the promoted set. The DOM-overlay badge (`<AudienceAnnotationOverlay>`) renders only non-promoted annotations; the promoted subset is visible only as Cytoscape graph-nodes. Same shape as moderator Decision §3.

8. **Defensive skip for unknown endpoint ids** (matches participant D2). If an `edge-created` payload references an annotation id that no prior `annotation-created` event introduced (a wire-protocol-violation defensive case), the edge is `continue`-skipped at the projector seam rather than emitted with an orphan endpoint that Cytoscape would throw on at mount.

9. **Stylesheet additions** in `apps/audience/src/graph/stylesheet.ts`:
   - `node[nodeKind = 'annotation']` baseline: `shape: 'round-tag'`, `width: 140`, `height: 48`, smaller `font-size` (BROADCAST_ANNOTATION_FONT_SIZE_PX = 12), uniform amber palette as the baseline (`background-color: '#fef3c7'`, `border-color: '#92400e'`, `color: '#92400e'`). Decoupled from statement-node selectors via the `nodeKind` attribute key — no cross-layer interference (the per-rollupStatus / `?decomposed` selectors continue to key on the `data.rollupStatus` / `data.decomposed` fields, which annotation nodes stamp as `'none'` / `undefined` so the selectors don't match).
   - Four per-kind overrides `node[nodeKind = 'annotation'][annotationKind = '<kind>']` — Decision §5: amber (note), violet (reframe), teal (scope-change), sky (stance). Matches the participant's `part_render_annotation_endpoint_edges` D4 vocabulary so the cross-surface kind palette stays coherent.
   - `edge[entityRole = 'annotation-host']` selector: `line-style: 'dashed'`, `line-color: '#cbd5e1'`, `target-arrow-shape: 'none'`, `label: ''` (Cytoscape edge labels are stylesheet-driven; setting `label: ''` overrides the baseline `label: 'data(roleLabel)'`). No `text-background-*` claims.

10. **`<AudienceAnnotationOverlay>` consumes the filtered `data.annotations`** — no overlay code change. The filter happens at the projection seam (Decision §3); the overlay continues to iterate `cy.nodes()` + `cy.edges()` and reads `data.annotations` off each, unchanged. Promoted annotations are no longer in any `data.annotations` array, so they don't surface as DOM badges.

11. **No selection-store widening.** The audience surface is broadcast-only / read-only (`autoungrabify: true` at [`apps/audience/src/graph/GraphView.tsx:228`](../../../apps/audience/src/graph/GraphView.tsx#L228), no tap-handler, no detail panel). Annotation Cytoscape nodes are visual chrome only — they have no click affordance. This is the load-bearing difference from the participant version (which had to widen its selection-store discriminant per D6 of that refinement).

12. **Cover.** New Vitest cases pin each new helper / projector branch / stylesheet selector smoke; one new Playwright scenario inside the existing `tests/e2e/audience-live-session.spec.ts` file exercises the surface end-to-end.

This task is audience-UI-only. No projection-layer change. No wire-schema change. No methodology-engine change. No `packages/shared-types` / `packages/shell` / `packages/i18n-catalogs` change.

## Why it needs to be done

**The projection widened end-to-end; the audience canvas is the last skip site in the chain.** The wire schema (`edge_target_annotation_schema_extension`), the projection layer (`projection_edge_annotation_endpoint`), the moderator UI (`mod_render_annotation_endpoint_edges`, done 2026-05-30), and the participant UI (`part_render_annotation_endpoint_edges`, done 2026-05-30) all accept polymorphic-endpoint edges today. The audience's [`projectGraph.ts:308-321`](../../../apps/audience/src/graph/projectGraph.ts#L308) `continue` is the last consumer in the chain silently dropping the shape — explicitly registered as debt by `projection_edge_annotation_endpoint` and named in the L309-315 comment block.

**The broadcast viewer cannot see the methodology's full structural narrative.** When the methodology encodes a relation like "N19 contradicts A2" (the canonical walkthrough's E15, [`docs/example-walkthrough.md`](../../../docs/example-walkthrough.md) turn 21), the broadcast viewer currently sees a graph that silently drops that edge. The information loss is asymmetric: the moderator and participant surfaces now render the edge; the audience — the read-mostly surface designed specifically to expose the structural narrative to a viewing audience — does not. Once `walkthrough_e15_annotation_endpoint_refit` lands the canonical fixture, this gap becomes a regression in user-facing fidelity on the very surface the show producer monitors.

**Cross-surface coherence.** All three UI streams (moderator, participant, audience) carry the same skip-guard today; the moderator and participant have shipped their fixes; the audience is the last to land. Cross-surface coherence — the broadcast viewer, the debater, and the moderator all see the same structural edges — is the methodology's "shared graph" assumption per ADR 0027.

**Unblocks `aud_annotation_of_annotation_overlay_chain`.** That task ([`tasks/50-audience-and-broadcast.tji:334-347`](../../50-audience-and-broadcast.tji#L334)) explicitly depends on THIS task — the parallel annotation-of-annotation overlay (annotation A1 with `target_node_id = A2.id` overlaying on A2's materialized graph-node) requires A2 to first exist as a Cytoscape node. This task creates the canvas surface that downstream task decorates.

## Inputs / context

### The lift site

- [`apps/audience/src/graph/projectGraph.ts:308-321`](../../../apps/audience/src/graph/projectGraph.ts#L308) — the `edge-created` arm's skip-guard. The `continue` at L316-320 is the primary lift; the L309-315 comment block names THIS task as the unblocker and contracts post-lift to a forward pointer ("annotation-endpoint edges materialize the referenced annotation as a Cytoscape graph-node per `aud_render_annotation_endpoint_edges`").

### The projection + node-data widening

- [`apps/audience/src/graph/projectGraph.ts:146-183`](../../../apps/audience/src/graph/projectGraph.ts#L146-L183) — `AudienceNodeData` interface. Adds `nodeKind` + `annotationKind` per Decision §3.
- [`apps/audience/src/graph/projectGraph.ts:189-209`](../../../apps/audience/src/graph/projectGraph.ts#L189-L209) — `AudienceEdgeData` interface. Adds `entityRole` per Decision §3.
- [`apps/audience/src/graph/projectGraph.ts:250-340`](../../../apps/audience/src/graph/projectGraph.ts#L250-L340) — `projectGraph` body. The `node-created` arm stamps `nodeKind: 'statement', annotationKind: null` on every existing node. The `edge-created` arm stamps `entityRole: 'statement'` on every existing edge, lifts the skip-guard, resolves endpoints via `?? null`, and `continue`-skips edges whose annotation endpoint hasn't been seen in the log yet (Decision §2 — defensive). At end-of-walk: build the promoted set via `computeAnnotationsAsEndpoints(events)`, concatenate `projectAnnotationNodes(annotations, promotedSet)` onto `nodes`, concatenate `projectAnnotationHostEdges(annotations, promotedSet, events)` onto `edges`, post-filter `nodeAnnotationIndex` / `edgeAnnotationIndex` results to remove promoted ids (mutual exclusion).
- [`apps/audience/src/graph/annotations.ts`](../../../apps/audience/src/graph/annotations.ts) — `Annotation` interface and existing projectors. Gains: `computeAnnotationsAsEndpoints`, `projectAnnotationNodes`, `projectAnnotationHostEdges`.

### The Cytoscape stylesheet

- [`apps/audience/src/graph/stylesheet.ts:179-235`](../../../apps/audience/src/graph/stylesheet.ts#L179-L235) — the `STYLESHEET` constant. Six new selector entries (one annotation-node baseline + four annotation-kind palette overrides + one annotation-host edge entry); typography constants (`BROADCAST_ANNOTATION_FONT_SIZE_PX`, optionally `BROADCAST_ANNOTATION_FONT_WEIGHT`) added alongside the existing `BROADCAST_NODE_FONT_*` exports.
- [`apps/audience/src/graph/stylesheet.ts:113-122`](../../../apps/audience/src/graph/stylesheet.ts#L113-L122) — `STATE_COLORS` constant. Unchanged (annotation palette is per-kind, not per-state).

### The Cytoscape mount + layout

- [`apps/audience/src/graph/GraphView.tsx:218`](../../../apps/audience/src/graph/GraphView.tsx#L218) — the `cyState` slot. Unchanged (the three overlays continue to share the same `Core` instance).
- [`apps/audience/src/graph/GraphView.tsx:228`](../../../apps/audience/src/graph/GraphView.tsx#L228) — `autoungrabify: true`. Unchanged (broadcast surface remains read-only; annotation nodes inherit the same posture).
- [`apps/audience/src/graph/layoutOptions.ts:129`](../../../apps/audience/src/graph/layoutOptions.ts#L129) — `breadthfirst` layout. Unchanged. Breadthfirst lays out by depth from selected roots; the new annotation nodes participate as graph nodes (connected via the lifted annotation-endpoint statement edges AND the synthetic annotation-host edges). The synthetic host edges keep promoted annotations placed adjacent to their hosts (Decision §4).

### The DOM-overlay (unchanged code path)

- [`apps/audience/src/graph/AnnotationOverlay.tsx`](../../../apps/audience/src/graph/AnnotationOverlay.tsx) — iterates `cy.nodes()` + `cy.edges()` and reads `data.annotations`. Unchanged: the filter happens upstream in `projectGraph`; the overlay sees only non-promoted annotations and continues to render them as DOM badges.

### Sibling precedent — Cytoscape-on-participant

- [`tasks/refinements/participant-ui/part_render_annotation_endpoint_edges.md`](../participant-ui/part_render_annotation_endpoint_edges.md) — **the closest precedent (same Cytoscape rendering tech)**:
  - D1 — conditional materialization (annotations materialize only when referenced as an edge endpoint).
  - D2 — defensive `continue`-skip for unknown annotation references.
  - D3 — single shared `NodeData` shape with sentinel defaults; `nodeKind` discriminator.
  - D4 — `node[nodeKind = 'annotation']` baseline + four `[annotationKind = '<kind>']` per-kind palette overrides (amber/violet/teal/sky).
  - D5 — annotation id used directly as Cytoscape `data.id` (UUID v4 collision-free).
  - D7 — annotation-of-annotation overlay propagation deferred to a follow-up.
  - D9 — no new ADR.

  This task adopts D1/D2/D3/D4/D5/D7/D9 verbatim. It diverges on D6 (no selection-store widening — audience is read-only) and on the addition of the synthetic AnnotationHostEdge tether (audience adopts the moderator's host-tether pattern — see Decision §4 below).

### Sibling precedent — hybrid promotion on ReactFlow

- [`tasks/refinements/moderator-ui/mod_render_annotation_endpoint_edges.md`](../moderator-ui/mod_render_annotation_endpoint_edges.md) — **the authoritative hybrid-promotion reference**:
  - §1 — hybrid promotion (badge OR node, never both); amends the badge-rendering decision rather than invalidating it.
  - §3 — mutual exclusion enforced at the selector layer.
  - §4 — synthetic host pseudo-edge; v1 approximates edge-hosted annotations via the host edge's `source` endpoint.
  - §7 — `pointer-events: none` on the host pseudo-edge.
  - §11 — `mod_annotation_node_edge_host_midpoint` (~0.5d) registered as the future polish task for proper edge-hosted-annotation midpoint tethering.

  This task adopts §1/§3/§4/§7 verbatim (with the Cytoscape transposition documented below). The audience does NOT need an explicit `pointerEvents: none` on the tether — Cytoscape's `autoungrabify: true` on the whole surface already disables interaction; the tether is a normal Cytoscape edge with no event handlers.

### Walkthrough

- [`docs/example-walkthrough.md`](../../../docs/example-walkthrough.md) turn 21 — E15: "N19 contradicts A2". The canonical narrative this task makes renderable on the broadcast canvas.

### Playwright surface

- [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) — existing audience live-session spec. Carries six scenarios today (auth+event-delivery, live projection, anonymous WS, canvas mount, OBS-no-input, OBS-sizing) + recent scenarios (9-10) for diagnostic edge/cycle animations. **Adds a new scenario** seeding `node-created` + `annotation-created` + `edge-created (target_annotation_id)` and asserting (a) the materialized annotation Cytoscape node is visible (via `cy.getElementById(<A.id>).length === 1` from `window.__aConversaWsStore` access), (b) the annotation-host tether is visible (via `cy.getElementById('annotation-host-<A.id>').length === 1`), (c) the annotation-endpoint statement edge is visible, (d) the DOM badge for the promoted annotation is NOT in the DOM. Per Decision §8 the new scenario pulls a fresh dev-pool user (next unallocated after `henry`).

## Constraints / requirements

1. **Lift in `projectGraph` only.** The skip-guard at [`projectGraph.ts:316-320`](../../../apps/audience/src/graph/projectGraph.ts#L316-L320) is the single skip site in the audience codebase (verified by `grep "source_node_id === undefined"` returning one hit). Lifting it must not regress the existing node-to-node edge projection (the same `edge-created` arm produces those edges today).

2. **Mutual exclusion: Cytoscape node OR DOM badge, never both.** An annotation whose id appears in the promotion set is rendered as a Cytoscape graph-node and is filtered out of every `data.annotations` array (both node-targeted and edge-targeted buckets — symmetric across the per-`aud_annotation_rendering` and per-`aud_annotation_rendering_edges` indices). An annotation whose id is NOT in the promotion set continues to render as a DOM-overlay badge (current behavior). Tests pin this: a Cytoscape-node + DOM-badge duplicate render is a regression. The filter applies even when the same annotation has BOTH a node target (overlay candidate) AND is referenced as an edge endpoint (promotion candidate) — promotion wins.

3. **Promotion is per-id, not per-event.** A single annotation referenced by N annotation-endpoint edges gets ONE Cytoscape annotation node (the Cytoscape graph has at most one node per id). The promotion-set helper returns a `Set<string>` — duplicates collapse naturally.

4. **Host pseudo-edge synthesis rules** (per Decision §4):
   - Promoted annotation A with `targetNodeId: <nodeId>` → emit `{ id: 'annotation-host-<A.id>', source: <nodeId>, target: <A.id>, entityRole: 'annotation-host' }`. The host node is guaranteed to exist in the same `nodes` array (per the wire-schema XOR + the `node-created` precondition; if not, defensive skip per requirement §8).
   - Promoted annotation A with `targetEdgeId: <edgeId>` → emit `{ id: 'annotation-host-<A.id>', source: <hostEdge.source_node_id>, target: <A.id>, entityRole: 'annotation-host' }` (v1 approximation matching moderator §4; the midpoint-accurate version lands as the named-future-task `aud_annotation_node_edge_host_midpoint`).
   - If neither host is resolvable, the host pseudo-edge is omitted and `data.hostMissing = true` is stamped on the annotation node for diagnosis. The annotation node still renders.

5. **`AudienceNodeData` polymorphic shape**:
   - `nodeKind: 'statement' | 'annotation'` — required field; `'statement'` stamped on every node from `node-created`, `'annotation'` stamped on every promoted annotation node.
   - `annotationKind: AnnotationKind | null` — required field; `null` on statement nodes, the wire `annotation.kind` value on annotation nodes.
   - Sentinel defaults on annotation nodes: `kind: null`, `facetStatuses: EMPTY_FACET_STATUSES`, `rollupStatus: 'none'`, `axiomMarks: EMPTY_AXIOM_MARKS`, `annotations: EMPTY_ANNOTATIONS`, `decomposed: undefined`. `wording: annotation.content` so the baseline `label: 'data(wording)'` selector renders the content body.
   - `hostMissing: true` is optional; stamped only on annotation nodes whose host can't be resolved per Decision §4.

6. **`AudienceEdgeData` polymorphic shape**:
   - `entityRole: 'statement' | 'annotation-host'` — required field; `'statement'` on every statement edge from `edge-created`, `'annotation-host'` on every synthetic host pseudo-edge.
   - Synthetic host pseudo-edges carry sentinel defaults for the existing fields (`role: 'supports'` as a placeholder unused by the `entityRole = 'annotation-host'` selector, `facetStatuses: EMPTY_FACET_STATUSES`, `rollupStatus: 'none'`, `annotations: EMPTY_ANNOTATIONS`). The Cytoscape `roleLabel: ''` stamping happens at the existing element-construction layer (the host-edge selector's `label: ''` override is the belt-and-suspenders pin).

7. **Annotation node dimensions**: `width: 140`, `height: 48` (per Decision §5 — proportional to the moderator's 192×56 and smaller than the audience's statement node 200×80; visually communicates "less weighty than a statement"). Threaded through the existing `width` / `height` fields on the Cytoscape stylesheet entry (no per-node measurement — uniform per-kind).

8. **Defensive skip for unknown annotation references.** An `edge-created` payload that references an annotation id with no preceding `annotation-created` event is `continue`-skipped at the projector seam (matches participant D2). The Vitest case below pins this so a future change to throw-on-missing surfaces as a test failure.

9. **Diagnostic highlights, facet statuses, axiom marks do NOT apply to annotation nodes or annotation-host edges in v1.** Annotations don't carry facets per ADR 0027; the diagnostic-highlight pass writes only to entity ids that came from `node-created` / `edge-created`; annotation graph-node ids never appear in its output. Pinning that observable contract: a Vitest case asserts an annotation node's `data` carries the sentinel `rollupStatus: 'none'` / `axiomMarks: EMPTY_AXIOM_MARKS` / `annotations: EMPTY_ANNOTATIONS` after the projector pass.

10. **Stylesheet layering**: the new selector entries do not claim any property already claimed by the existing per-state / per-facet / decomposed / axiom-mark-overlay selectors. The `nodeKind` attribute key is fresh; no cross-layer interference. The `[?decomposed]` selector remains untouched (annotation nodes stamp `decomposed: undefined`, so the `[?decomposed]` attribute-truthy selector doesn't match).

11. **Cytoscape orphan-edge invariant.** Cytoscape throws on edges whose `source` / `target` references no element in the graph. The lifted `edge-created` arm must defer emission of an annotation-endpoint edge until the materialization pass has emitted the annotation node OR `continue`-skip per requirement §8 if no such node materializes. Concretely: build the materialization pass results FIRST (compute the promoted set, emit annotation nodes), then emit the edges, then concatenate. The end-of-walk pattern matches the moderator's selector composition.

12. **Layout stability**. The audience's `breadthfirst` layout is the canonical layout per `aud_layout_engine` (depth from selected roots). New annotation node ids feed into the layout uniformly; the synthetic host edges + the lifted annotation-endpoint statement edges contribute to the layout graph. No special-case layout override.

13. **TypeScript strict + ESLint flat config compliance** ([ADR 0013](../../../docs/adr/0013-typescript-strict.md), [ADR 0011](../../../docs/adr/0011-eslint.md)). `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` are on; the widened `AudienceNodeData` / `AudienceEdgeData` interfaces must satisfy them.

14. **i18n** ([ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)). No new catalog entries needed. The annotation node's wording IS the content body (raw user prose, no i18n); the kind disambiguation is communicated visually (per-kind palette per Decision §5). The DOM overlay's `methodology.annotationKind.<kind>` key continues to surface kind labels for NON-promoted annotations (badge case unchanged).

15. **No new ADR.** This task amends `aud_annotation_rendering`'s Decision §1 by adding an "edge-endpoint promotion" clause; the amendment is documented in this refinement's Decisions §1 (back-link from the source refinement is NOT required per [`tasks/refinements/README.md`](../README.md): refinements are work-shaping documents, not retroactively amended). The architectural choices (Cytoscape custom selector group, breadthfirst layout, badge-only-or-node-only mutual exclusion) are already covered by ADR 0004 + ADR 0027.

16. **No projector / methodology / schema change.** Everything is audience-UI selector + projection + rendering. The widened projection layer (per `projection_edge_annotation_endpoint`) already serves the data this task consumes.

17. **Vitest discipline** ([ADR 0006](../../../docs/adr/0006-test-framework-vitest.md), [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)). Every empirical check ships as a committed case; no out-of-tree probe.

18. **Playwright cover IS in scope** (per the source-of-debt note explicitly: *"Includes Playwright cover asserting an annotation-endpoint edge appears on the canvas."*). The audience surface is reachable via `/a/sessions/:sessionId` post-`aud_session_url`; the new scenario lands inline in `tests/e2e/audience-live-session.spec.ts`. Full deferral to `aud_visual_regression` is rejected per Decision §8.

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/projectGraph.ts` — MODIFIED. `AudienceNodeData` + `AudienceEdgeData` shape widening; node-arm + edge-arm sentinel stamping; lift L308-321 skip-guard; defensive unknown-annotation skip; end-of-walk promoted-annotation node + host-edge emission; mutual-exclusion filter on `nodeAnnotationIndex` + `edgeAnnotationIndex`.
- `apps/audience/src/graph/projectGraph.test.ts` — MODIFIED. ~10 new cases listed under Acceptance criteria.
- `apps/audience/src/graph/annotations.ts` — MODIFIED. New exports: `computeAnnotationsAsEndpoints`, `projectAnnotationNodes`, `projectAnnotationHostEdges`. Header comment trail-block updated to name this refinement.
- `apps/audience/src/graph/annotations.test.ts` — MODIFIED. ~6 new cases for the three helpers.
- `apps/audience/src/graph/stylesheet.ts` — MODIFIED. New `BROADCAST_ANNOTATION_FONT_SIZE_PX` typography constant; six new selector entries (1 annotation-node baseline + 4 annotation-kind palette overrides + 1 annotation-host edge).
- `apps/audience/src/graph/GraphView.test.tsx` — MODIFIED. ~3 new cases for the four-color palette mount-time assertions + annotation-host edge dashed-stroke smoke.
- `tests/e2e/audience-live-session.spec.ts` — MODIFIED. One new scenario for the annotation-endpoint surface (asserting materialized annotation node + tether + statement edge + badge-absence).

### Files this task does NOT touch

- `apps/audience/src/graph/AnnotationBadge.tsx` / `AnnotationBadge.test.tsx` — UNCHANGED (badge component is for the non-promoted population).
- `apps/audience/src/graph/AnnotationOverlay.tsx` / `AnnotationOverlay.test.tsx` — UNCHANGED (filter happens upstream in `projectGraph`; the overlay's iteration sees the filtered `data.annotations`).
- `apps/audience/src/graph/AxiomMarkOverlay.tsx`, `AxiomMarkBadge.tsx`, `axiomMarks.ts`, `PerFacetPillOverlay.tsx`, `facetStatus.ts`, `layoutOptions.ts`, `cytoscapeTestEnv.ts` — UNCHANGED.
- `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx`, `apps/audience/src/index.css` — UNCHANGED.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**` — UNCHANGED.
- `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — UNCHANGED.
- `packages/shared-types/**`, `packages/shell/**`, `packages/i18n-catalogs/**`, `packages/ui-tokens/**` — UNCHANGED.
- `docs/adr/**` — UNCHANGED (no new ADR).
- `playwright.config.ts` — UNCHANGED (the new scenario lands inside an existing spec file).
- `.tji` files — `complete 100` lands at task close per the [README ritual](../README.md). The closer registers `aud_annotation_node_edge_host_midpoint` (~0.5d) per Decision §11 if the v1 source-endpoint approximation surfaces UX complaints during follow-up review; otherwise the closer can park the follow-up as a Status-block note.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check is a committed Vitest case, an updated Playwright spec block, or a CI script — no throwaway probes.

**Source edits**

- [ ] `apps/audience/src/graph/annotations.ts`:
  - Adds `computeAnnotationsAsEndpoints(events: readonly Event[]): Set<string>` — single pass, returns the set of annotation ids referenced as `source_annotation_id` or `target_annotation_id` in any `edge-created` payload.
  - Adds `projectAnnotationNodes(annotations: readonly Annotation[], promotedSet: ReadonlySet<string>, events: readonly Event[]): AudienceNodeElement[]` — emits one Cytoscape node descriptor per promoted annotation with the sentinel defaults from Constraint §5 and `wording = annotation.content`; stamps `hostMissing: true` when host resolution per Decision §4 fails.
  - Adds `projectAnnotationHostEdges(annotations: readonly Annotation[], promotedSet: ReadonlySet<string>, events: readonly Event[]): AudienceEdgeElement[]` — emits one synthetic dashed-tether edge per promoted annotation per Decision §4; omits the edge for `hostMissing` annotations.
  - Header trail-block updated naming this refinement.

- [ ] `apps/audience/src/graph/projectGraph.ts`:
  - `AudienceNodeData` gains `nodeKind: 'statement' | 'annotation'`, `annotationKind: AnnotationKind | null`, optional `hostMissing?: boolean`.
  - `AudienceEdgeData` gains `entityRole: 'statement' | 'annotation-host'`.
  - The `node-created` arm stamps `nodeKind: 'statement', annotationKind: null` on every emitted node.
  - The `edge-created` arm stamps `entityRole: 'statement'` on every emitted edge.
  - The L308-321 skip-guard is lifted; annotation-endpoint edges resolve their `data.source` / `data.target` via `event.payload.source_node_id ?? event.payload.source_annotation_id` (and symmetric for target).
  - Edges whose annotation endpoint hasn't been seen in the log defensively `continue`-skip (Constraint §8).
  - End-of-walk: compute `promotedSet = computeAnnotationsAsEndpoints(events)`; concatenate `projectAnnotationNodes(annotations, promotedSet, events)` onto `nodes`; concatenate `projectAnnotationHostEdges(annotations, promotedSet, events)` onto `edges`; post-filter `nodeAnnotationIndex` and `edgeAnnotationIndex` to drop entries whose `annotation.id` is in `promotedSet` BEFORE stamping `data.annotations`.
  - Header trail-block updated naming this refinement.

- [ ] `apps/audience/src/graph/stylesheet.ts`:
  - New typography export `BROADCAST_ANNOTATION_FONT_SIZE_PX = 12` (alongside the existing `BROADCAST_NODE_FONT_SIZE_PX`).
  - One new entry `node[nodeKind = 'annotation']` with `shape: 'round-tag', width: 140, height: 48, background-color: '#fef3c7', border-color: '#92400e', border-width: 1, color: '#92400e', font-size: BROADCAST_ANNOTATION_FONT_SIZE_PX`.
  - Four per-kind override entries `node[nodeKind = 'annotation'][annotationKind = 'note' | 'reframe' | 'scope-change' | 'stance']` with the amber / violet / teal / sky palette per Decision §5.
  - One new entry `edge[entityRole = 'annotation-host']` with `line-style: 'dashed', line-color: '#cbd5e1', target-arrow-shape: 'none', label: ''`.

**Vitest coverage** (committed cases, ADR 0022)

- [ ] `apps/audience/src/graph/annotations.test.ts`:
  - `computeAnnotationsAsEndpoints`: empty log → empty set; one annotation-endpoint edge → set with one id; multiple references to same annotation → set with one id; mixed node-target + annotation-target + annotation-source → set carries each unique annotation id once.
  - `projectAnnotationNodes`: empty promoted set → empty array; one promoted annotation → one node with the right `id`, `data.nodeKind === 'annotation'`, `data.annotationKind`, `data.wording === annotation.content`, sentinel defaults; promoted annotation whose host can't be resolved → `data.hostMissing === true`.
  - `projectAnnotationHostEdges`: annotation with `targetNodeId` → one tether `{ source: nodeId, target: annotationId, entityRole: 'annotation-host' }`; annotation with `targetEdgeId` resolving to a known edge → tether tethered to the host edge's source node id; annotation with `hostMissing` → no tether emitted.

- [ ] `apps/audience/src/graph/projectGraph.test.ts`:
  - Annotation-endpoint edge (node → annotation) → emits the statement edge with `data.source = nodeId, data.target = annotationId, data.entityRole = 'statement'`; emits the promoted annotation node; emits the annotation-host tether.
  - Annotation-source-endpoint case + annotation-to-annotation case each get parallel tests. Existing node-to-node edge cases stay green.
  - Mutual exclusion: an annotation referenced as an endpoint AND also having a node target does NOT appear in any emitted `data.annotations` array (pinned at projection seam — Constraint §2).
  - Defensive skip: an `edge-created` referencing an annotation id with no preceding `annotation-created` is silently `continue`-skipped (no emitted edge); the rest of the graph projects normally (Constraint §8).
  - Statement-only-field sentinel defaults on annotation nodes (Constraint §5 + §9): `kind: null`, `facetStatuses: EMPTY_FACET_STATUSES`, `rollupStatus: 'none'`, `axiomMarks: EMPTY_AXIOM_MARKS`, `annotations: EMPTY_ANNOTATIONS`, `decomposed: undefined`.
  - Statement nodes carry `nodeKind: 'statement', annotationKind: null` (regression cover that the additive field defaults don't break the existing shape).

- [ ] `apps/audience/src/graph/GraphView.test.tsx`:
  - Mount-time assertion: a node with `data.nodeKind === 'annotation', data.annotationKind === 'reframe'` carries computed `background-color` matching the violet palette per Decision §5 after one render tick.
  - Mount-time assertion: an edge with `data.entityRole === 'annotation-host'` carries computed `line-style: 'dashed'`, `line-color` matching slate-300 (`#cbd5e1`), and no target-arrow.
  - Mount-time assertion: a statement node with `data.nodeKind === 'statement'` continues to render with the existing baseline (regression cover that the new annotation selectors don't bleed onto statement nodes).

**Playwright coverage** (Decision §8 — in scope; surface reachable via `/a/sessions/:sessionId`)

- [ ] New scenario inside [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) following the existing seed-via-`window.__aConversaWsStore` pattern:
  - Seeds: `session-created` → `node-created` (N1) → `annotation-created` (A1, kind=`reframe`, target_node_id=N1.id) → `edge-created` (annotation-endpoint: source_node_id=N1.id, target_annotation_id=A1.id, role=`contradicts`).
  - Asserts (via `page.evaluate` reading `window.__aConversaCy` if exposed by `GraphView`, or via DOM mirror assertions if the overlay surfaces the materialized node's `[data-annotation-row]` row): the Cytoscape `Core` contains a node with id A1.id and `data.nodeKind === 'annotation'`; an edge with id `annotation-host-<A1.id>` and `data.entityRole === 'annotation-host'`; the annotation-endpoint statement edge connecting N1 to A1.
  - Asserts the DOM overlay does NOT include `[data-testid="audience-annotation-badge-<A1.id>"]` (the badge is suppressed because A1 is promoted — Constraint §2).
  - User-pool: takes the next unallocated dev user after `henry` (the most recently allocated per `aud_diagnostic_fire_animation_seeding_alignment`'s scenario 10). The spec file's header comment is updated to name the new pool member alongside the existing six + grace + henry.

**Build + scheduler**

- [ ] `pnpm run check` clean (typecheck + lint + format + i18n-catalogs validator).
- [ ] `pnpm run test:smoke` green (Vitest count rises by ~19 cases — promotion-set 4 + projectors 6 + projectGraph integration ~6 + GraphView stylesheet 3).
- [ ] `pnpm -F @a-conversa/audience build` succeeds (bundle-size delta dominated by the three new pure helpers + six new stylesheet selector entries — expected single-digit-kB rise).
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100` lands on the task block at L322-L333.

**Refinement closure**

- [ ] `tasks/50-audience-and-broadcast.tji` task block `aud_render_annotation_endpoint_edges` gains `complete 100` after the `allocate team` line, plus a `note "Refinement: tasks/refinements/audience/aud_render_annotation_endpoint_edges.md"` line.
- [ ] A `## Status` block is appended to this refinement on completion per [`tasks/refinements/README.md`](../README.md) ritual, listing produced source / test / Playwright deltas and the smoke / build / `tj3` results. Also notes whether `aud_annotation_node_edge_host_midpoint` is registered (Decision §11 — conditional).

## Decisions

### §1. **Hybrid promotion**: an annotation becomes a Cytoscape graph-node if and only if it participates as an edge endpoint; otherwise it stays a DOM-overlay badge.

The strongest alternative is **uniform promotion** — every annotation becomes a Cytoscape node, DOM badges retire. **Rejected** because:

- **The DOM badge population is a much larger surface.** A typical broadcast session ends with dozens of annotations across the graph; uniform promotion would multiply the Cytoscape element count and inflate the breadthfirst layout's runtime (`breadthfirst`'s depth allocation is super-linear in node count near the root band).
- **The badge framing is honest for non-endpoint annotations.** Per `aud_annotation_rendering` Decision §1: per-annotation amber pills as a DOM-overlay sibling of the canvas, surfacing the meta-commentary layer adjacent to the entity. That framing is still right for the >>90% case (most annotations are pure meta-commentary). Endpoint promotion is a structural extension, not a wholesale replacement.
- **Cross-surface consistency with both the moderator and participant.** Both ship the hybrid-promotion rule (moderator §1, participant D1) — the audience adopting the same rule keeps all three UI streams' annotation vocabularies aligned.

The second-strongest alternative is **promotion ONLY when explicitly demanded by the show producer** (e.g., a config toggle). **Rejected** — same reason the moderator rejected it (Decision §1 there): promotion would be UI-state rather than projection-state; broadcast viewers watching the same session would see different graphs depending on the producer's local config. The promotion rule should be a pure function of the projection.

The third alternative is **render every annotation as a node AND keep the DOM badge** (visual duplication). **Rejected** trivially: duplicated visual representation is confusing — viewers would have to learn that the badge and the canvas node are the same entity.

The hybrid promotion rule amends `aud_annotation_rendering`'s Decision §1 by adding a clause: "*for the subset of annotations that participate as edge endpoints, promote to a standalone Cytoscape graph-node; mutual exclusion with the DOM badge.*" The original decoration framing continues to govern the non-endpoint case.

### §2. **Defensive `continue`-skip for unknown annotation references**; annotation-endpoint edges whose endpoint has no preceding `annotation-created` event are dropped at the projector seam.

The condition shouldn't happen — the WS broadcast can only carry endpoint-annotation references whose `annotation-created` event preceded the `edge-created` event (the server's event-handler validates against the current projection state). But defensive behavior matters because:

- **A throw at the projector seam would blank the broadcast canvas** on any malformed seed; the broadcast surface should degrade gracefully when the event log is inconsistent.
- **Cytoscape's orphan-edge invariant** is the same one the existing dangling-edge filter at projectGraph already honors (Cytoscape throws on orphan source/target). Skipping is the canonical resolution.
- **The participant adopted the same posture (D2 there)** for the same reasons; the audience mirrors it.

Alternative — throw `ProjectionInvariantError`-style. **Rejected**: over-strict for a UI-side projector. The server's projection layer is the right place for invariant enforcement; the UI projector mirrors the broadcast and degrades gracefully on inconsistent input.

Alternative — emit the edge with `source = '__missing__'`. **Rejected**: Cytoscape's required source/target invariant + the `source: 'data(id)'` mapping leaves no clean null story.

### §3. **Single shared `AudienceNodeData` shape; annotation graph-nodes carry sentinel defaults for statement-only fields; `nodeKind` + `annotationKind` discriminators added.** Same for `AudienceEdgeData` + `entityRole`.

Three options:

- **(A — chosen)** Single shared shape with sentinel defaults (`rollupStatus: 'none'`, `axiomMarks: EMPTY_AXIOM_MARKS`, etc.) plus a `nodeKind: 'statement' | 'annotation'` discriminator. Stylesheet branches via `node[nodeKind = 'annotation']` selectors; consumer reads stay polymorphic (the per-rollupStatus selectors continue to key on `data.rollupStatus`, which annotation nodes stamp as `'none'`, so the agreement-layer paint doesn't bleed onto annotation nodes).
- **(B)** Split into a discriminated union `AudienceStatementNodeData | AudienceAnnotationNodeData`. Rejected — clean type shape, but every consumer site (stylesheet projection, overlay iteration, `aud_decomposition_animation`'s `[?decomposed]` reader, future `aud_annotation_of_annotation_overlay_chain`'s annotation-of-annotation reader) needs `if (data.nodeKind === 'annotation') ...` discrimination before reading any field. The shared-shape posture lets reads stay polymorphic and matches the participant's D3 choice byte-for-byte.
- **(C)** Drop the statement-only fields from annotation nodes (TS-narrow `kind?: StatementKind`). Rejected — `?:` makes every consumer check `undefined`; the sentinel posture is more uniform and matches the existing `rollupStatus: 'none'` / `EMPTY_AXIOM_MARKS` / `EMPTY_ANNOTATIONS` sentinel discipline this codebase already follows.

The `AudienceEdgeData` story is symmetric: a single shape with `entityRole: 'statement' | 'annotation-host'`, defaults `'statement'` stamped on every existing edge, `'annotation-host'` stamped on synthetic tethers. The `roleLabel: ''` slot on tethers belt-and-suspenders against the stylesheet's `label: 'data(roleLabel)'` baseline (the `edge[entityRole = 'annotation-host'] { label: '' }` selector override is the primary pin).

Cross-surface consistency: the participant's D3 chose option (A) for identical reasons; the audience follows suit. The reference-stable frozen-empty constants (`EMPTY_FACET_STATUSES`, `EMPTY_AXIOM_MARKS`, `EMPTY_ANNOTATIONS`) are already on the audience's path — annotation nodes stamping them keeps `useMemo` identity stable, matching the established memoization discipline.

### §4. **Synthetic dashed AnnotationHostEdge tethers each promoted annotation to its host; node-hosted is honest, edge-hosted approximates via the host edge's source node.**

The strongest alternative is **no synthetic host edge** — let breadthfirst place promoted annotations based only on their annotation-endpoint statement edges. **Rejected** because:

- **Spatial association would be lost.** An annotation A originally attached to N3 via `target_node_id = N3.id` (decoration) AND now promoted because of `edge-created (target_annotation_id = A.id, source_node_id = N5.id)` would be placed adjacent to N5 by breadthfirst, but the conceptual link to its decoration target N3 would be invisible. The broadcast viewer's mental model (the annotation "comments on N3") would be silently broken.
- **The DOM badge currently encoded the spatial association** for non-promoted annotations (anchored 30 px below N3's bounding box). Losing the spatial cue on promoted annotations would create a regression vs. the badge experience: viewers would have to read the annotation's content to infer which host it comments on.
- **The moderator's mod_render_annotation_endpoint_edges chose this approach (§4 there)** for the same reasons. Cross-surface coherence on the hybrid-promotion spatial vocabulary keeps moderator + audience reading the same canvas vocabulary.

The participant's `part_render_annotation_endpoint_edges` did NOT include a synthetic tether — but the participant's `cose` layout is force-directed (attracts connected nodes), and the participant has additional UX affordances (tap-to-select, selection store, detail panel) that surface the conceptual host-link interactively. The audience's `breadthfirst` is depth-from-roots (no force attraction beyond the BFS structure), and the audience has zero interactive affordances — the tether is the load-bearing spatial signal.

For edge-hosted annotations (`targetEdgeId` is set), the host pseudo-edge tethers to the host edge's `source` node — a v1 approximation matching moderator §4. The alternative (a synthetic midpoint node on the host edge so the tether visually meets the host edge at its midpoint) is more correct but requires a synthetic mid-edge node + a tether that's effectively 1.5 segments — more invasive than v1 budget. If feedback during broadcast use shows the imprecision matters, the named-future-task `aud_annotation_node_edge_host_midpoint` (~0.5d) lands the midpoint rendering (Decision §11).

When neither host resolves (a wire-protocol defensive case), the host pseudo-edge is omitted and the annotation node carries `data.hostMissing = true` for diagnosis. The annotation node still renders (orphaned but visible) so the broadcast viewer can SEE the entity rather than encountering a silent drop.

### §5. **`AnnotationNode` dimensions 140×48; round-tag shape; four-kind chromatic palette (amber / violet / teal / sky).**

Two dimension alternatives:

- **(A — chosen)** `width: 140, height: 48` — smaller than statement node (200×80), readable for a short content body, proportional to the moderator's 192×56 AnnotationNode.
- **(B)** Match statement node 200×80. Rejected — the visual weight should be subordinate (annotations comment on statements; they shouldn't claim the same canvas footprint). Cross-surface consistency: moderator's AnnotationNode chose a smaller footprint for the same reason (Decision §5 there).

Two shape alternatives:

- **(A — chosen)** `shape: 'round-tag'` — matches participant D4. Cytoscape's `round-tag` is the most "label-like" of the built-in shapes (a rounded rectangle with a triangular pointer on one edge); reads as "commentary attached to something" without ambiguity.
- **(B)** Match statement's `round-rectangle`. Rejected — visual distinguishability requires shape differentiation, not just color (color-blindness + low-contrast displays at broadcast resolution).

Two palette alternatives:

- **(A — chosen)** Four-kind chromatic palette: amber-100 / amber-900 (note), violet-100 / violet-900 (reframe), teal-100 / teal-900 (scope-change), sky-100 / sky-900 (stance). Cross-surface consistency with the participant D4. Surfaces the annotation kind visually since the audience cannot render a kind-label header inside a Cytoscape node (no React subtree per node — the moderator's React-rendered "[Note] body" pattern can't transpose to Cytoscape).
- **(B)** Uniform amber palette (matching the DOM badge's amber-100/amber-900 baseline). Rejected — broadcast viewers cannot distinguish kind visually if all promoted annotations look the same, AND the audience has no `title`-attribute hover affordance (Cytoscape canvas nodes aren't DOM elements). The four-color palette is the only way to communicate kind at-a-glance on the broadcast canvas.
- **(C)** Wait for `packages/ui-tokens` to ship and theme through that. Rejected — the participant already established the audience-side palette without waiting; the audience following the participant's choice keeps the cross-surface vocabulary aligned. When `ui-tokens` materializes (independent workstream), the palette constants migrate uniformly with the participant's.

The chosen palette matches the participant's `part_render_annotation_endpoint_edges` D4 amber/violet/teal/sky vocabulary, so a viewer who has used the participant tablet recognizes the kind cues on the broadcast canvas immediately. This DOES diverge from the moderator's uniform-slate Decision §9 (the moderator surfaces kind via the React-rendered header label) — that divergence is OK: the audience cannot mirror the moderator's React-node body, so it mirrors the participant's chromatic-palette signal instead.

### §6. **Reuse the existing Cytoscape `label: 'data(wording)'` selector by stamping `wording: annotation.content` on promoted annotation nodes.**

The alternative is to add an annotation-specific selector with `label: 'data(content)'`. **Rejected**:

- **More invasive stylesheet change**: requires a new field + a parallel selector entry.
- **`data.wording` is the established label-bound field** ([`stylesheet.ts:187`](../../../apps/audience/src/graph/stylesheet.ts#L187)) for nodes. Stamping `annotation.content` into the `wording` slot reuses the existing rendering path with zero stylesheet plumbing.
- **The semantic mapping is honest**: an annotation's "wording" IS its `content` body; the field name is generic enough to accommodate.

Truncation of long `content` is handled by the existing `text-max-width: '180px'` on the `node` selector (Cytoscape wraps + truncates inside the bounding box automatically). For the smaller annotation-node dimensions, the stylesheet's per-annotation override can override `text-max-width` to `120px` to match the narrower card; the implementer picks the exact value.

### §7. **AnnotationHostEdge styling: dashed slate-300, no arrow, no label, no `target-arrow-shape`.**

Direct port of moderator §7 (dashed `'4 3'`, slate-300 `#cbd5e1`, no marker, no label). Cytoscape transposition:

- `line-style: 'dashed'` (Cytoscape doesn't accept a custom dash pattern via stylesheet — the built-in `'dashed'` value matches the moderator's `strokeDasharray="4 3"` visually closely enough that broadcast viewers won't perceive a difference).
- `line-color: '#cbd5e1'` (matches moderator).
- `target-arrow-shape: 'none'` (the host edge has no semantic direction — it's a spatial-association indicator).
- `label: ''` (overrides the baseline `label: 'data(roleLabel)'`).
- No CSS `pointer-events: none` needed (unlike the moderator's React-rendered tether). The audience canvas has `autoungrabify: true` on the `Core`; no click handlers fire on any element anyway.

### §8. **Playwright cover is in scope** (not deferred to `aud_visual_regression` or any other catch-all).

The orchestrator brief explicitly says "Playwright cover is in scope (not deferred)." Three reasons reinforce this:

- **The audience surface is reachable.** `aud_session_url` is `complete 100` (line 505 of `50-audience-and-broadcast.tji`); the `/a/sessions/:sessionId` route mounts the canvas; the `window.__aConversaWsStore` dev seam lets `page.evaluate` apply synthetic events. The "component not yet reachable" deferred-e2e exception does NOT apply.
- **`aud_visual_regression` is the pixel-stability surface, not the behavioral surface.** Per the orchestrator brief: "Visual-regression is not a substitute for Playwright. ... Both can coexist; only Playwright satisfies the e2e policy." The visual-regression task's annotation extension (added by `aud_annotation_rendering` Status block) will pin pixel-level kind palettes + tether dashed-stroke; this task pins the *behavioral* contract (the materialization rule + the mutual-exclusion contract + the projection-to-canvas round-trip) that `aud_visual_regression`'s pixel pins implicitly assume but don't directly assert.
- **A focused scenario is cheap.** The existing `audience-live-session.spec.ts` carries ten scenarios already; an eleventh that seeds three events and asserts four canvas elements is well under 60 lines of net new code with shared seed-helper boilerplate.

Alternative — defer to a new `aud_pw_annotation_endpoint` spec file. **Rejected**: scope mismatch (the existing live-session spec is the right home for any audience-canvas behavioral assertion); duplicate Authelia setup boilerplate; planning-debt for no architectural reason.

Alternative — defer to `aud_visual_regression`. **Rejected** per the visual-regression-vs-Playwright distinction above and per the brief's explicit instruction.

### §9. **No host-edge per-kind palette; uniform dashed slate-300 regardless of the tethered annotation's kind.**

Matches moderator §9. The tether is a spatial-association indicator, not a methodology-load-bearing edge; per-kind colour would compete visually with the real statement edges (which carry methodology role). When `packages/ui-tokens` lands, the host edge can pick its colour from the shared palette uniformly with statement edges; today the inline slate-300 hex is the right baseline.

### §10. **Annotation id used directly as the Cytoscape `data.id`; no prefix.**

Matches participant D5. The wire-id space is UUID v4 across node + annotation populations; collision risk is statistically zero. Prefixing (`'ann-' + id`) would require every consumer site (stylesheet selectors, overlay iteration, test assertions) to know to strip — extra unmarshalling for no semantic gain. The discrimination is cleanly available via the `data.nodeKind` field per Decision §3.

### §11. **Tech-debt registration: name follow-ups crisply.**

One conditional follow-up surfaces during this task:

- **`aud_annotation_node_edge_host_midpoint`** (future task — ~0.5d, UI-stream, audience). When an annotation's host is an edge (not a node), render the host tether anchored at the host edge's *midpoint* (via a synthetic midpoint node) rather than at the host edge's `source` endpoint. The v1 implementation approximates via the source endpoint per Decision §4. **Conditional**: register at task close ONLY IF the v1 source-endpoint approximation surfaces UX complaints during follow-up review. If not, the closer parks the follow-up as a Status-block note (per the orchestrator brief's "never defer to an audit/revisit task" rule — surface in the parking-lot summary instead if no concrete complaint exists). Belongs under `audience.aud_graph_rendering`. Mirrors the moderator's `mod_annotation_node_edge_host_midpoint`.

The pre-existing follow-ups are NOT re-registered:

- `aud_annotation_of_annotation_overlay_chain` is already in the WBS at [`tasks/50-audience-and-broadcast.tji:334`](../../50-audience-and-broadcast.tji#L334) gated on THIS task.
- `walkthrough_e15_annotation_endpoint_refit`, `aud_visual_regression`, `extract_cytoscape_projectors` are all already in the WBS.
- Cross-stream tasks (moderator + participant analogues) have already shipped.

## Open questions

(none — all decided in §1–§11.)

## Status

**Done** — 2026-05-30.

- `apps/audience/src/graph/annotations.ts` (NEW) — added `computeAnnotationsAsEndpoints`, `projectAnnotationNodes`, `projectAnnotationHostEdges` pure helpers; promotion-set walker + per-annotation Cytoscape node + synthetic host-edge projectors.
- `apps/audience/src/graph/annotations.test.ts` (NEW) — 10 Vitest cases covering the three new helpers (empty-log, single reference, multi-reference dedup, sentinel defaults, hostMissing flag, host-edge tether resolution).
- `apps/audience/src/graph/projectGraph.ts` — widened `AudienceNodeData` (`nodeKind`, `annotationKind`, optional `hostMissing?`) and `AudienceEdgeData` (`entityRole`); stamped sentinel defaults on `node-created` and `edge-created` arms; lifted L308-321 skip-guard; added defensive unknown-annotation `continue`-skip; end-of-walk promoted-annotation node + host-edge materialization; mutual-exclusion filter on `nodeAnnotationIndex` + `edgeAnnotationIndex`.
- `apps/audience/src/graph/projectGraph.test.ts` — 10 new annotation-endpoint integration cases (aep-1..aep-10): node→annotation edge, annotation-source edge, annotation-to-annotation, mutual exclusion pin, defensive skip, sentinel defaults.
- `apps/audience/src/graph/stylesheet.ts` — new `BROADCAST_ANNOTATION_FONT_SIZE_PX = 12` export; 6 new selectors: annotation-node baseline (round-tag, amber-100/amber-900, 140×48), four per-kind palette overrides (amber/violet/teal/sky), annotation-host edge (dashed slate-300, no arrow, no label).
- `apps/audience/src/graph/GraphView.test.tsx` — 4 new cases: aep-ss-a/b/c (stylesheet structural mounts for reframe palette, dashed host edge, statement-node regression) + aep-mm-a (statement-baseline non-bleed regression).
- `tests/e2e/audience-live-session.spec.ts` — new scenario 11 (`ivan` pool member) seeding `session-created` → `node-created` → `annotation-created` → annotation-endpoint `edge-created`; asserts materialized annotation node, annotation-host tether, statement edge, and badge-absence for the promoted annotation.
- Fixer: `tests/e2e/audience-live-session.spec.ts` — added missing `actorId: ivan.userId` to `seedAnnotationEndpointEdgeCreated` call (TS2345, attempt 1).
- Verification: `pnpm run check` green; `pnpm run test:smoke` green (Vitest +24 cases); `pnpm run test:behavior:smoke` green; `make test:e2e:compose` green.
- Tech-debt `aud_annotation_node_edge_host_midpoint` (~0.5d): render the host tether anchored at the host edge's midpoint for edge-hosted annotations (v1 approximates via source endpoint per Decision §4). **Conditional** per Decision §11 — parked as a Status-block note; register as a WBS task only if the v1 source-endpoint approximation surfaces UX complaints during broadcast use.
