# Render annotation-endpoint edges on the moderator ReactFlow canvas

**TaskJuggler entry**: `moderator_ui.mod_annotation_ui.mod_render_annotation_endpoint_edges` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) (block at L681-L692). Embedded note: *"Source of debt: projection_edge_annotation_endpoint — the moderator ReactFlow canvas currently skips annotation-endpoint edges (apps/moderator/src/graph/selectors.ts) because annotations are not yet rendered as ReactFlow nodes. Rendering annotation-endpoint edges requires resolving the design question of how the canvas surfaces annotations as graph nodes with positions. Includes Playwright cover asserting an annotation-endpoint edge appears on the canvas."*

## Effort estimate

**1.5d** (per the `.tji` allocation). Roughly:

- **`<AnnotationNode>` component + ReactFlow node-type registration** (~0.3d). A small node mirroring the `<AnnotationBadge>` content (localized kind label + tooltip with content) in a node shell ReactFlow can position and connect edges to. Registered alongside `STATEMENT_NODE_TYPE` in [`GraphCanvasPane.tsx:146-148`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L146-L148).
- **Promotion-set + node projector** (~0.3d). A pure helper `computeAnnotationsAsEndpoints(events): Set<string>` collects every annotation id referenced in any annotation-endpoint `edge-created` payload; a sibling `projectAnnotationNodes(annotations, promotedSet)` emits the promoted subset as a `Node<AnnotationNodeData>[]` for the canvas to render.
- **Badge-suppression** (~0.1d). [`GraphCanvasPane.tsx` `projectNodes`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L495) and [`selectors.ts` `selectEdgesForSession`](../../../apps/moderator/src/graph/selectors.ts#L338) filter promoted annotations out of `data.annotations` for each host before attaching (mutual exclusion between badge and node — see Decisions §3).
- **Synthetic host pseudo-edge** (~0.2d). One ReactFlow `Edge` per promoted annotation tethering the annotation node to its host (the `targetNodeId` from `Annotation`, or the host edge's `source` when the annotation targets an edge — Decision §4). New edge `type: 'annotation-host'` registered in [`edgeTypes.ts`](../../../apps/moderator/src/graph/edgeTypes.ts); rendered dashed, no arrow, low contrast.
- **Lift the guard + project annotation-endpoint edges** (~0.2d). [`selectors.ts:374-376`](../../../apps/moderator/src/graph/selectors.ts#L374-L376) drops the `undefined` skip; the `for` loop accepts payloads with `source_annotation_id` / `target_annotation_id` and emits a ReactFlow `Edge` whose `source` / `target` resolve to whichever endpoint id is present (node id OR promoted annotation id — same string-keyed ReactFlow graph space).
- **Layout integration** (~0.1d). Dagre handles the new node ids automatically once they appear in the `nodes` array; the `width: 288 / height: 90` per-node dimensions in [`layoutEngine.ts`](../../../apps/moderator/src/graph/layoutEngine.ts) get matched by `AnnotationNode`'s rendered dimensions (or a smaller per-annotation-node constant — see Decision §5).
- **Vitest cover** (~0.3d). Promotion-set helper, projection helper, node component, badge-suppression, the lifted edge selector, host pseudo-edge generation, the round-trip through `GraphCanvasPane`.
- **Playwright cover** (~0.1d). One scoped spec that seeds the session log with an annotation-endpoint edge via the existing test seam and asserts the canvas surface.

## Inherited dependencies

**Settled:**

- [`moderator_ui.mod_annotation_ui.mod_render_annotations`](../moderator-ui/mod_annotation_rendering.md) (done — 2026-05-11, also surfaces in the `.tji` `note` at L665 marking the deliverable as verified by parking-lot triage 2026-05-30). Shipped:
  - [`apps/moderator/src/graph/AnnotationBadge.tsx`](../../../apps/moderator/src/graph/AnnotationBadge.tsx) — memo'd `<AnnotationBadge>` rendering localized kind label + `data-annotation-kind` + `title`.
  - [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts#L154-L158) — `selectAnnotations(state, sessionId): Annotation[]`.
  - Shell exports — [`@a-conversa/shell`](../../../packages/shell/src/index.ts) `projectAnnotations(events)`, `groupAnnotationsByNode(annotations)`, `groupAnnotationsByEdge(annotations)`, `Annotation` (camelCased `{ id, kind, content, targetNodeId, targetEdgeId, createdBy, createdAt }`), `EMPTY_ANNOTATIONS`.
  - `data.annotations: readonly Annotation[]` on both [`StatementNodeData`](../../../apps/moderator/src/graph/StatementNode.tsx) and [`StatementEdgeData`](../../../apps/moderator/src/graph/selectors.ts#L55-L138).
  - Decision §1 of that refinement: "Badge attached to target, not standalone ReactFlow node. No standalone `<AnnotationNode>` ReactFlow node-type." **This task amends that decision** for the subset of annotations that participate as edge endpoints (see Decisions §1 below; Decision §1 of `mod_annotation_rendering` continues to govern the badge-only case).

- [`data_and_methodology.projection.projection_edge_annotation_endpoint`](../data-and-methodology/projection_edge_annotation_endpoint.md) (done — 2026-05-30). Widened `ProjectedEdge` / `EdgeAddedChange` / wire snapshot serializer to four polymorphic endpoint slots (`sourceNodeId`, `sourceAnnotationId`, `targetNodeId`, `targetAnnotationId`) per [`apps/server/src/projection/types.ts:222-238`](../../../apps/server/src/projection/types.ts#L222-L238). Lifted the `handleEdgeCreated` `ReplayError` guard. **Explicitly named this task** in its Tech-debt registration (Acceptance criteria L219) as the moderator-rendering follow-up; updated the comment at [`selectors.ts:366-374`](../../../apps/moderator/src/graph/selectors.ts#L366-L374) to point here.

- [`data_and_methodology.event_types.edge_target_annotation_schema_extension`](../data-and-methodology/edge_target_annotation_schema_extension.md) (done — 2026-05-30). Widened `edgeCreatedPayloadSchema` so `source_node_id` / `target_node_id` are optional and a pair of `.refine()` blocks enforce per-endpoint XOR with `source_annotation_id` / `target_annotation_id`. That wire schema is what the lifted selector reads.

- [ADR 0004 — Graph libraries: ReactFlow on moderator + Cytoscape on read-only surfaces](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md). Custom React node components are the explicit reason ReactFlow was picked for the moderator surface — a second node-type (`annotation`) registered alongside `statement` is the canonical ReactFlow extension shape.

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). Every check ships as committed Vitest + Playwright.

- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md). The `<AnnotationNode>` reuses the same `methodology.annotationKind.<kind>` catalog keys the badge already binds (DRY — Decision §6).

- [ADR 0025 — Moderator layout engine: dagre Sugiyama hierarchical](../../../docs/adr/0025-moderator-layout-engine-dagre.md). The layout engine accepts arbitrary node ids; adding annotation node ids to the `nodes` array is structurally trivial. Per-node dimensions (`width: 288, height: 90`) governed there — Decision §5 below sets a smaller dimension for `AnnotationNode` and threads it through the dagre call.

- [ADR 0027 — Entity and facet layers strict separation](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md). Annotations are entity-layer; the node-type widening is an entity-layer rendering concern. No facet machinery is touched.

**Pending (none — every load-bearing input is settled on `main`):**

The walkthrough fixture refit (`walkthrough_e15_annotation_endpoint_refit`) and the proposal-side gestures (`mod_propose_annotation_endpoint_gestures`) are downstream of THIS task per the `.tji` `depends` chain — they consume this task's rendering, not the other way around.

## What this task is

Lift the moderator ReactFlow canvas's `continue`-on-annotation-endpoint guard at [`apps/moderator/src/graph/selectors.ts:374-376`](../../../apps/moderator/src/graph/selectors.ts#L374-L376) and render annotation-endpoint edges on the canvas by **promoting referenced annotations to a new `annotation` ReactFlow node-type**. Concretely:

1. **A new `<AnnotationNode>` ReactFlow node-type** in `apps/moderator/src/graph/AnnotationNode.tsx`. Renders a small card sized for short content (kind header + truncated body + `data-annotation-kind` seam + `title` hover with full content), `data-testid="annotation-node-<annotation-id>"`. Registered alongside `STATEMENT_NODE_TYPE` in [`GraphCanvasPane.tsx:146-148`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L146-L148).
2. **A `computeAnnotationsAsEndpoints(events): Set<string>` pure helper** in `apps/moderator/src/graph/selectors.ts` that walks the event log once collecting every annotation id referenced as `source_annotation_id` or `target_annotation_id` in any `edge-created` payload. This is the *promotion set* — annotations whose ids appear here become nodes; the rest stay badges.
3. **A `projectAnnotationNodes(annotations, promotedSet): Node<AnnotationNodeData>[]` projector** that emits one ReactFlow node per promoted annotation. Position is `(0, 0)` at emit time; dagre overwrites in the layout pass (same pattern as `projectNodes` per [`GraphCanvasPane.tsx:53`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L53)).
4. **Badge-suppression** in [`projectNodes`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L495) and in [`selectEdgesForSession`](../../../apps/moderator/src/graph/selectors.ts#L338): the per-target `Map<string, Annotation[]>` bucket filters out annotations whose id is in the promotion set before attaching `data.annotations` to the host. An annotation is rendered as **either** a badge **or** a node — never both (mutual exclusion).
5. **Annotation-endpoint edge projection**. The guard at [`selectors.ts:374-376`](../../../apps/moderator/src/graph/selectors.ts#L374-L376) drops; the `for (const event of events)` loop now accepts `edge-created` payloads with `source_annotation_id` / `target_annotation_id` set. The emitted ReactFlow `Edge`'s `source` and `target` resolve to whichever endpoint id is present in the payload — node id OR annotation id (ReactFlow's graph space is a flat string-keyed namespace; UUID collision space is effectively zero).
6. **Host pseudo-edges**. For each promoted annotation A, synthesize one ReactFlow `Edge` of `type: 'annotation-host'` connecting A's host (`targetNodeId` if non-null, else the `source` end of the host edge `targetEdgeId` — Decision §4) to A. Dashed, no arrow marker, low-contrast stroke (`#cbd5e1` / Tailwind `slate-300`-ish). `data-testid="annotation-host-edge-<annotation-id>"`. The pseudo-edge keeps dagre placing the annotation node near its host so the spatial association the badge currently provides is preserved.
7. **A second ReactFlow edge type** `annotation-host` registered in [`edgeTypes.ts`](../../../apps/moderator/src/graph/edgeTypes.ts) alongside the existing `statement` entry. The handler is a thin `<BaseEdge>` wrapper applying the dashed-low-contrast styling; no label, no marker. Per ADR 0004 this is the canonical ReactFlow extension shape (a custom edge type, not a property toggle on `statement`).
8. **Layout-engine compatibility**. The new `annotation` node id space is uniformly handled by [`layoutEngine.ts`](../../../apps/moderator/src/graph/layoutEngine.ts); dimensions for `annotation` nodes are smaller than `statement` (`width: 192, height: 56` per Decision §5), threaded via the existing per-node `width`/`height` dagre input.
9. **Cover** — Vitest pinning each new helper / component / projection branch; one Playwright spec exercising the surface end-to-end with a test-seeded event log carrying an annotation-endpoint edge.

This task is moderator-UI-only. No projection-layer change. No schema change. No methodology-engine change. The participant + audience analogues stay deferred to their own sibling tasks ([`part_render_annotation_endpoint_edges`](../participant-ui/part_render_annotation_endpoint_edges.md) and [`aud_render_annotation_endpoint_edges`](../audience/aud_render_annotation_endpoint_edges.md)) — each can choose its own spatial idiom independently within the Cytoscape vocabulary.

## Why it needs to be done

**The projection widened; the moderator canvas didn't.** [`projection_edge_annotation_endpoint`](../data-and-methodology/projection_edge_annotation_endpoint.md) widened `ProjectedEdge` and lifted the projection-layer guard so annotation-endpoint edges flow end-to-end through replay, the WS snapshot, and the diagnostics audit. The three UI-stream consumers ([`apps/moderator/src/graph/selectors.ts:374`](../../../apps/moderator/src/graph/selectors.ts#L374), [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts), [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts)) still `continue` on the unrenderable shape because annotations were never canvas-renderable as graph nodes. The walkthrough fixture E15 ("N19 contradicts A2") cannot encode its canonical narrative honestly until the canvas can render the endpoint. This task closes the moderator side.

**The proposal-side gestures depend on it.** `mod_propose_annotation_endpoint_gestures` (this task's downstream consumer, also gated on `set_edge_substance_annotation_endpoint`) cannot wire the moderator's endpoint-carriage picker or capture-with-edge flow to target an annotation if the annotation isn't a click-target on the canvas. The moderator needs to *see* an annotation as a graph-node-shaped thing to *target* one with a gesture. Closing the rendering gate is the prerequisite.

**The walkthrough fixture refit is sequenced through here.** `walkthrough_e15_annotation_endpoint_refit` is the canonical narrative fixture rewrite (E15 encoded as `(N19) -[contradicts]-> (A2)`, not its workaround). The walkthrough's Playwright assertions read against the moderator canvas; the refit cannot land observable assertions until the canvas surfaces the endpoint.

**The badge-only rendering is honest about decoration but incomplete about structural participation.** The `mod_annotation_rendering` Decision §1 ("Badge attached to target, not standalone ReactFlow node") was scoped to "annotations decorate their target". The widened wire-schema introduces a *second* role for annotations — they can be edge endpoints (structural argument-graph participants). The decoration framing is incomplete for that role; this task amends it surgically (only for annotations that take on the endpoint role; others stay as badges).

## Inputs / context

### The lift site

- [`apps/moderator/src/graph/selectors.ts:364-376`](../../../apps/moderator/src/graph/selectors.ts#L364-L376) — the `for (const event of events)` loop inside `selectEdgesForSession` that today filters annotation-endpoint payloads. The `continue` at L374-376 is the primary lift; the surrounding comment at L366-373 contracts to a forward pointer ("annotation-endpoint edges render via the `annotation` node-type per `mod_render_annotation_endpoint_edges`; see Decision §1 of that refinement").

### The promotion-set + projectors

- [`apps/moderator/src/graph/selectors.ts:154-158`](../../../apps/moderator/src/graph/selectors.ts#L154-L158) — existing `selectAnnotations(state, sessionId): Annotation[]`. Reused; the promotion-set helper consumes its output and a single pass over `events`.
- [`packages/shell/src/cytoscape-projectors`](../../../packages/shell/src/) — `projectAnnotations`, `groupAnnotationsByNode`, `groupAnnotationsByEdge`, `EMPTY_ANNOTATIONS`, `Annotation`. Imported via [`apps/moderator/src/graph/selectors.ts:37-50`](../../../apps/moderator/src/graph/selectors.ts#L37-L50). The `computeAnnotationsAsEndpoints` helper lives next to `projectAnnotations` for symmetry — it's a moderator-internal selector that walks the events log for the promotion set; deferring it into the shell is out of scope (the rendering split between moderator badges + nodes is a moderator-UI concern; participant + audience tasks each compute their own promotion set per their UI vocabulary).

### The canvas wiring

- [`apps/moderator/src/graph/GraphCanvasPane.tsx:102`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L102) — `import { STATEMENT_NODE_TYPE, StatementNode, type StatementNodeData } from './StatementNode.js';`. The new `AnnotationNode.tsx` exports `ANNOTATION_NODE_TYPE`, `AnnotationNode`, `AnnotationNodeData` mirrored on the same shape.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx:146-148`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L146-L148) — `const NODE_TYPES: NodeTypes = { [STATEMENT_NODE_TYPE]: StatementNode };` → widens to include `[ANNOTATION_NODE_TYPE]: AnnotationNode`. Declared at module scope (per ADR 0004 + the docblock at L136-145 explaining ReactFlow's identity-based memoization concern).
- [`apps/moderator/src/graph/edgeTypes.ts`](../../../apps/moderator/src/graph/edgeTypes.ts) — single entry `{ statement: StatementEdge }`. Adds `'annotation-host': AnnotationHostEdge`.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx:495-...`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L495) — `projectNodes(events, diagnosticHighlights, facetStatusIndex)`. Today filters node-substance nodes; widens to compose with `projectAnnotationNodes` for the promoted-annotation subset. Returns a combined `Node[]` array; node-type discrimination is per-node via `node.type`.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx:1093`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1093) — the `useMemo` calling `projectNodes(events, ...)`. The dependency array stays `[events, diagnosticHighlights, facetStatusIndex]`; the annotation projection lives inside the helper.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx:1392`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1392) — `<ReactFlow nodeTypes={NODE_TYPES} edgeTypes={edgeTypes} ... />`. No call-site change; the widened registries do the work.
- [`apps/moderator/src/graph/StatementNode.tsx`](../../../apps/moderator/src/graph/StatementNode.tsx) — pattern reference for the new `AnnotationNode.tsx` (export `ANNOTATION_NODE_TYPE = 'annotation'` + `AnnotationNodeData` interface + memo'd component).

### The host pseudo-edge

- [`apps/moderator/src/graph/StatementEdge.tsx`](../../../apps/moderator/src/graph/StatementEdge.tsx) — pattern reference for the new `AnnotationHostEdge.tsx`. Renders `<BaseEdge>` with dashed `strokeDasharray="4 3"`, low-contrast stroke, no `<EdgeLabelRenderer>` overlay, no `markerEnd`.
- [`apps/moderator/src/graph/selectors.ts:445-450`](../../../apps/moderator/src/graph/selectors.ts#L445-L450) — `markerEnd` pattern for the statement edge (per-substance-status color); the host pseudo-edge sets `markerEnd: undefined` (no arrow — it's a spatial-association indicator, not a directional edge).

### Layout-engine inputs

- [`apps/moderator/src/graph/layoutEngine.ts`](../../../apps/moderator/src/graph/layoutEngine.ts) — `applyLayout(nodes, edges, options)` + `relayoutAll(nodes, edges, options)`. The per-node `width` / `height` reads off node-attached fields (per the cache-stability docblock); `AnnotationNode` carries its own smaller dimensions and threads through dagre uniformly. ADR 0025 Amendment 2026-05-24 documents the stability strategy this task inherits.
- ADR 0025 — node dimensions: 288×90 for `StatementNode`. Decision §5 below picks 192×56 for `AnnotationNode` (matches the Tailwind sizing of a small text-card; ~⅔ the statement card's footprint).

### Sibling precedent

- [`tasks/refinements/moderator-ui/mod_annotation_rendering.md`](./mod_annotation_rendering.md) — the badge-rendering refinement this task amends. Decision §1 there is amended (not invalidated): badges remain the default; promotion to node happens only when an annotation participates as an edge endpoint.
- [`tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md`](./mod_axiom_mark_decoration.md) — the established sibling pattern for per-node decoration that *doesn't* promote to node (axiom marks decorate; never become nodes). Demonstrates the badge-style decoration idiom can coexist with node-typed entities on the same canvas.
- [`tasks/refinements/moderator-ui/mod_node_rendering.md`](./mod_node_rendering.md) — the canonical custom-node refinement; `<AnnotationNode>` mirrors the same shape (memo'd, `data-testid` seam, `data-*` attribute seam for downstream styling).
- [`tasks/refinements/data-and-methodology/projection_edge_annotation_endpoint.md`](../data-and-methodology/projection_edge_annotation_endpoint.md) — predecessor; the comment at [`selectors.ts:366-373`](../../../apps/moderator/src/graph/selectors.ts#L366-L373) is the breadcrumb that named this task.

### Walkthrough + downstream consumers

- [`docs/example-walkthrough.md`](../../../docs/example-walkthrough.md) turn 21 — E15: N19 contradicts A2. The canonical narrative this task makes renderable; `walkthrough_e15_annotation_endpoint_refit` (downstream) re-encodes the fixture.
- [`tasks/refinements/data-and-methodology/walkthrough_e15_annotation_endpoint_refit.md`](../data-and-methodology/walkthrough_e15_annotation_endpoint_refit.md) — gated on THIS task; rewrites the fixture to use the annotation-endpoint encoding.

### Related but not gating

- [`tasks/refinements/shell-package/extract_annotation_detail_view.md`](../shell-package/extract_annotation_detail_view.md) — has a trigger-condition gate waiting on a moderator-side OR audience-side per-annotation drill-down panel to materialize as a second caller. **This task is NOT the qualifying drill-down.** Adding an `AnnotationNode` makes the annotation a click-target in the spatial-graph sense (it's a ReactFlow node now), but does NOT open a per-annotation detail panel on click. The shell-extract refinement's gate stays open; the closer for this task confirms the gate-checked tasks list still excludes this one.

### Sibling rendering follow-ups (independent — each owns its surface)

- [`participant_ui.part_render_annotation_endpoint_edges`](../participant-ui/part_render_annotation_endpoint_edges.md) — Cytoscape-side analogue on the participant tablet. Independent design (Cytoscape allows orphan edges and has its own node-positioning idiom); does NOT depend on this task's outcome.
- [`audience.aud_render_annotation_endpoint_edges`](../audience/aud_render_annotation_endpoint_edges.md) — Cytoscape-side analogue on the audience broadcast. Same independence.

## Constraints / requirements

1. **Lift in `selectEdgesForSession` only.** The guard at [`selectors.ts:374-376`](../../../apps/moderator/src/graph/selectors.ts#L374-L376) is the single skip site in the moderator codebase (verified by a `grep` for `source_node_id === undefined` and `target_node_id === undefined`). Lifting it must not regress the existing node-to-node edge projection (the same loop produces those edges today).

2. **Mutual exclusion: badge OR node, never both.** An annotation whose id appears in the promotion set is rendered as an `AnnotationNode` and is filtered out of `data.annotations` on its host. An annotation whose id is NOT in the promotion set continues to render as an `AnnotationBadge` on its host (current behavior). Tests pin this: a badge-and-node duplicate render is a regression.

3. **Promotion is per-id, not per-event.** A single annotation referenced by N annotation-endpoint edges gets ONE `AnnotationNode` (the dagre graph has at most one node per id). The promotion-set helper returns a `Set<string>` — duplicates collapse naturally.

4. **Host pseudo-edge synthesis rules** (per Decision §4):
   - Promoted annotation A with `targetNodeId: <nodeId>` (host is a node) → synthesize one host pseudo-edge `{ id: 'annotation-host-<A.id>', source: <nodeId>, target: <A.id>, type: 'annotation-host' }`. The host node is guaranteed to be a `StatementNode` in the same `nodes` array (per the wire schema's annotation-target XOR + the `node-created` precondition).
   - Promoted annotation A with `targetEdgeId: <edgeId>` (host is an edge) → synthesize one host pseudo-edge tethering A to the host edge's `source` node id (looked up via the same `edge-created` event scan that `selectEdgesForSession` does). Documented as a v1 approximation (ReactFlow doesn't natively connect to edges); the alternative ("no host pseudo-edge for edge-hosted annotations") would let the annotation node float far from its host edge in dagre layout, which is the worse UX.
   - If the host's wire ids cannot be resolved (a defensive case for wire-protocol violations), the host pseudo-edge is omitted and a `data-host-missing` attribute is set on the annotation node for diagnosis. The annotation node still renders.

5. **`AnnotationNode` dimensions**: `width: 192, height: 56` (per Decision §5). Threaded through the existing per-node `width`/`height` field that `layoutEngine.ts` reads. The card renders the localized kind label as a bold header and the truncated content (first ~60 chars) as a body line; the full content is exposed via the `title` attribute (cheap baseline hover) consistent with `AnnotationBadge`'s precedent.

6. **`AnnotationNode` test-seam attributes**:
   - `data-testid="annotation-node-<annotation-id>"` — the canvas-stable handle.
   - `data-annotation-kind="<kind>"` — same wire-format kind seam as `AnnotationBadge`. The future per-kind theming hook in `packages/ui-tokens` selects on this attribute uniformly for both surfaces.
   - `title={content}` — full content on hover. `mod_hover_details` may later upgrade to a richer popover.

7. **`AnnotationHostEdge` styling**: dashed (`strokeDasharray="4 3"`), low-contrast stroke (`#cbd5e1` / Tailwind `slate-300`-class color), no `<EdgeLabelRenderer>`, no `markerEnd`. Per Decision §7 it carries `pointer-events: none` so clicking through to the host node behind it stays reliable; right-click context menus do not surface on the pseudo-edge (it's a UI artifact, not a methodology entity).

8. **Diagnostic highlighting + facet statuses do NOT apply to annotation nodes or host pseudo-edges in v1.** Annotations don't carry facets per ADR 0027 (entity/facet separation; annotations have no `substance` / `shape` facet). The diagnostic-highlight pass [`computeDiagnosticHighlights`](../../../apps/moderator/src/graph/selectors.ts) writes only to node/edge ids that came from `node-created` / `edge-created`; annotation ids never appear in its output. Pinning that observable contract: a Vitest case asserts an annotation node's `data` has no `diagnosticHighlight` field after the projector pass.

9. **Layout stability**. The existing relayout-on-truly-new-ids strategy (ADR 0025 Amendment 2026-05-24) extends to the new annotation node ids automatically — they're "truly new" the first time the promotion set surfaces them, triggering full relayout; subsequent re-renders reuse the cached position. The implementation must not introduce a special-case "annotation nodes always relayout" code path that would defeat the cache.

10. **TypeScript strict + ESLint flat config compliance** ([ADR 0013](../../../docs/adr/0013-typescript-strict.md), [ADR 0011](../../../docs/adr/0011-eslint.md)). `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` are on; the new `AnnotationNodeData` / `AnnotationHostEdgeData` interfaces must satisfy them. The widened `NODE_TYPES` map satisfies ReactFlow's `NodeTypes` shape.

11. **i18n** ([ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)). The annotation node's kind label resolves through `t('methodology.annotationKind.<kind>')` — the same key `<AnnotationBadge>` uses. No new catalog entries needed.

12. **No new ADR.** This task amends `mod_annotation_rendering`'s Decision §1 by adding an "edge-endpoint promotion" rule; the amendment is documented in this refinement's Decisions §1 and back-linked from the source refinement is NOT required (refinements are work-shaping documents per [`tasks/refinements/README.md`](../README.md); they're not amended retroactively). The architectural choices the amendment turns on (ReactFlow custom node-type, dagre layout, badge-only-or-node-only mutual exclusion) are already covered by ADR 0004 + ADR 0025; no new architectural seam opens.

13. **No projector / methodology / schema change.** Everything is moderator-UI selector + projection + rendering. The widened projection layer (per `projection_edge_annotation_endpoint`) already serves the data this task consumes.

14. **Vitest discipline** ([ADR 0006](../../../docs/adr/0006-test-framework-vitest.md), [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)). Every empirical check ships as a committed case; no out-of-tree probe.

15. **Playwright cover IS in scope** (per the source-of-debt note explicitly: *"Includes Playwright cover asserting an annotation-endpoint edge appears on the canvas."*). The annotation-endpoint surface is reachable via a test-seeded event log; full deferral to `mod_pw_full_session_run` is rejected (Decision §8).

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check is a committed Vitest case, an updated Playwright spec, or a CI script — no throwaway probes.

**Source edits**

- [ ] `apps/moderator/src/graph/AnnotationNode.tsx` (new file). Exports `ANNOTATION_NODE_TYPE = 'annotation'`, the `AnnotationNodeData` interface (`{ kind: AnnotationKind, content: string, hostMissing?: boolean }`), and a memo'd `AnnotationNode` component rendering the localized kind label header + truncated content body. Carries `data-testid="annotation-node-<id>"`, `data-annotation-kind="<kind>"`, `title={content}`, and (when `hostMissing`) `data-host-missing="true"`.
- [ ] `apps/moderator/src/graph/AnnotationHostEdge.tsx` (new file). Exports `ANNOTATION_HOST_EDGE_TYPE = 'annotation-host'`, the `AnnotationHostEdgeData` interface (empty for v1 — no per-edge data), and a memo'd `AnnotationHostEdge` component rendering `<BaseEdge>` with `strokeDasharray="4 3"`, `stroke="#cbd5e1"`, `pointerEvents="none"`, no marker, no label. Carries `data-testid="annotation-host-edge-<annotation-id>"` (the wrapping `<g>`).
- [ ] `apps/moderator/src/graph/selectors.ts`:
  - Drop the L374-376 `continue` guard; widen the projected `Edge<StatementEdgeData>` to handle annotation-endpoint payloads. `event.payload.source_node_id ?? event.payload.source_annotation_id` resolves to the ReactFlow `source` id; symmetric for `target`. The `sourceId` / `targetId` carriage fields on `StatementEdgeData` mirror this widening (Decision §10).
  - Add `computeAnnotationsAsEndpoints(events): Set<string>`. Pure helper; one pass; returns the set of annotation ids referenced by any `source_annotation_id` / `target_annotation_id`.
  - Add `projectAnnotationNodes(annotations, promotedSet): Node<AnnotationNodeData>[]`. Pure helper; emits one node per promoted annotation at `(0, 0)`, with `data-host-missing` when the host can't be resolved.
  - Add `projectAnnotationHostEdges(annotations, promotedSet, events): Edge<AnnotationHostEdgeData>[]`. Pure helper; emits one pseudo-edge per promoted annotation per Decision §4.
  - Update the L366-373 comment to point at THIS refinement and describe the new rendering shape (kept short — the refinement is the source of truth).
- [ ] `apps/moderator/src/graph/edgeTypes.ts`. Adds `[ANNOTATION_HOST_EDGE_TYPE]: AnnotationHostEdge` alongside the existing `statement` entry.
- [ ] `apps/moderator/src/graph/GraphCanvasPane.tsx`:
  - L102 import line widens to bring in `ANNOTATION_NODE_TYPE`, `AnnotationNode`, `AnnotationNodeData`.
  - L146-148 `NODE_TYPES` widens to include `[ANNOTATION_NODE_TYPE]: AnnotationNode`.
  - L495 `projectNodes` filters `data.annotations` to exclude promoted ids, then composes with `projectAnnotationNodes(annotations, promotedSet)` for the second slice of the combined `Node[]` return.
  - The edge-projection `useMemo` consuming `selectEdgesForSession` is extended (or a sibling `useMemo` is added — implementer picks) to also call `projectAnnotationHostEdges` and concatenate. The dependency stays `[sessionId, events, ...]`.
  - Edge-side: `selectEdgesForSession` itself filters `data.annotations` on each emitted edge to exclude promoted ids (same mutual-exclusion rule as nodes).
- [ ] `apps/moderator/src/graph/StatementEdge.tsx` — no behavior change; the source/target string ids it consumes on `data.sourceId` / `data.targetId` may now be an annotation id when an annotation-endpoint edge is rendered (Decision §10 widens those carriage types).

**Vitest coverage** (committed cases, ADR 0022)

- [ ] `apps/moderator/src/graph/selectors.test.ts`:
  - `computeAnnotationsAsEndpoints`: empty log → empty set; one annotation-endpoint edge → set with one id; multiple references to same annotation → set with one id; mixed node-target + annotation-target + annotation-source → set carries each unique annotation id once.
  - `projectAnnotationNodes`: empty promoted set → empty array; one promoted annotation → one node with the right `id` / `type` / `data.kind` / `data.content` / `position: (0, 0)`; promoted annotation with non-resolvable host → `data.hostMissing === true`.
  - `projectAnnotationHostEdges`: annotation with `targetNodeId` → one host pseudo-edge `{ source: nodeId, target: annotationId, type: 'annotation-host' }`; annotation with `targetEdgeId` resolving to a known edge → host pseudo-edge tethered to that edge's source-node id; annotation with no resolvable host → no host pseudo-edge emitted (paired with `data-host-missing` on the node — cross-checked in the `AnnotationNode` test).
  - `selectEdgesForSession`: annotation-endpoint edge (source = node, target = annotation) → emits an `Edge` with `source: <nodeId>, target: <annotationId>, data.sourceId: <nodeId>, data.targetId: <annotationId>`. Annotation-source case + annotation-to-annotation case each get a parallel test. Existing node-to-node cases stay green (regression cover).
  - Mutual exclusion: an annotation that is BOTH targeted by a `node-target` annotation AND referenced as an edge endpoint does NOT appear in any emitted `StatementEdgeData.annotations` (it's filtered out — pinned at the selector layer).
- [ ] `apps/moderator/src/graph/AnnotationNode.test.tsx` (new file): renders the localized kind label for each of the four kinds × three locales (12 cases); pins `data-testid` / `data-annotation-kind` / `title` attributes; pins `data-host-missing` attribute presence / absence based on the `hostMissing` data field.
- [ ] `apps/moderator/src/graph/AnnotationHostEdge.test.tsx` (new file): renders `<BaseEdge>` with the dashed-low-contrast styling; pins `data-testid` / `pointerEvents="none"` / absence of `markerEnd` (the BaseEdge component's props are observable via the test's render output).
- [ ] `apps/moderator/src/graph/GraphCanvasPane.test.tsx`:
  - Promoted-annotation flow: a `node-created` + `annotation-created` (node target) + `edge-created` (node→annotation) in the WS store renders one `StatementNode`, one `AnnotationNode`, the annotation-endpoint `StatementEdge`, and the `AnnotationHostEdge`. Pins each by `data-testid`. Asserts the badge container `annotation-badge-list-node-<id>` is empty (badge suppressed).
  - Pure-decoration flow (regression): `node-created` + `annotation-created` (node target) with NO `edge-created` referencing the annotation renders the badge as today, no annotation node, no host pseudo-edge. (The `mod_annotation_rendering` baseline stays green.)
  - Diagnostic-highlight isolation: a session with a diagnostic-highlighted node AND a promoted annotation renders the diagnostic halo on the node but NOT on the annotation node (per Constraint §8).
  - Layout-stability: applying a `node-created` followed by an `annotation-created` followed by an `edge-created` (annotation-endpoint) triggers full relayout on each truly-new id; the existing layout-cache contract is exercised end-to-end. Vitest asserts the resulting `nodes` array contains both node types and the dagre-computed positions are non-`(0, 0)`.

**Playwright coverage** — the surface is reachable via the existing test seam (no deferral; see Decision §8)

- [ ] `tests/e2e/annotation-endpoint-rendering.spec.ts` (new file). One scoped spec:
  - Drives the moderator console with a test-seeded event log carrying: `session-created` → `node-created` (one node N1) → `annotation-created` (one annotation A1 targeting N1) → `edge-created` (annotation-endpoint: source = N1, target = A1, role = `contradicts`).
  - Asserts the canvas surface: `[data-testid="statement-node-N1"]` is visible; `[data-testid="annotation-node-A1"]` is visible; `[data-testid="annotation-host-edge-A1"]` is visible (the dashed pseudo-edge); a `StatementEdge` connecting N1 and A1 is visible with the localized `contradicts` role label.
  - Asserts mutual exclusion: `[data-testid="annotation-badge-A1"]` is NOT in the DOM (the annotation is promoted to node, not rendered as a badge).
  - The seam is the `useWsStore` test-helper that already drives moderator Playwright specs ([`tests/e2e/methodology-full-flow.spec.ts`](../../../tests/e2e/methodology-full-flow.spec.ts) precedent). The closer of this task verifies the test-seam supports event-log injection (the existing methodology-full-flow spec drives WS events via the moderator UI gestures; this spec uses the lower-level WS-state seed pattern documented in the Playwright test-helpers refinement — [`tasks/refinements/foundation/playwright_test_helpers.md`](../foundation/playwright_test_helpers.md)).

**Build + scheduler**

- [ ] `pnpm run check` clean (typecheck + lint + format + i18n-catalogs validator).
- [ ] `pnpm run test:smoke` green (Vitest test count rises by ~25 cases — promotion-set + projectors + selector lifts + AnnotationNode i18n × 4 × 3 + AnnotationHostEdge + GraphCanvasPane integration).
- [ ] `pnpm -F @a-conversa/moderator build` succeeds (bundle size rises by the AnnotationNode + AnnotationHostEdge contributions — expected single-digit kB).
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100` lands on the task block at L681-L692.

**Refinement closure**

- [ ] `tasks/30-moderator-ui.tji` task block `mod_render_annotation_endpoint_edges` gains `complete 100` after the `allocate team` line, plus a `note "Refinement: tasks/refinements/moderator-ui/mod_render_annotation_endpoint_edges.md"` line.
- [ ] A `## Status` block is appended to this refinement on completion per [`tasks/refinements/README.md`](../README.md) ritual, listing the produced source / test / Playwright deltas and the smoke / build / `tj3` results. Also notes the gate-check on `extract_annotation_detail_view` (which stays open — this task does NOT open a per-annotation drill-down panel).

## Decisions

### §1. **Hybrid promotion**: an annotation becomes an `AnnotationNode` if and only if it participates as an edge endpoint; otherwise it stays a badge.

The strongest alternative is **uniform promotion** — every annotation becomes an `AnnotationNode`, badges retire. **Rejected** because:

- **The badge-stacking M-N case is load-bearing UX**. A statement node with three reframe annotations + one stance annotation stacks four amber pills inside the card; uniform promotion would push each into its own ReactFlow node + four host pseudo-edges, exploding the canvas density. A typical walkthrough session ends with dozens of annotations across the graph — visual budget matters.
- **The badge-and-decoration framing is honest for non-endpoint annotations**. Per `mod_annotation_rendering` Decision §1: "structurally a many-to-one decoration of a node or an edge, not a free-floating graph node." That framing is still right for the >>90% case (most annotations are pure meta-commentary). The endpoint-promotion case is a structural extension of the framing, not a wholesale replacement.
- **Layout cost stays proportional to the structural-participation surface**. Annotations that never participate as edge endpoints don't pay any layout cost — they're rendered as cheap DOM badges, not dagre-positioned nodes.

The second-strongest alternative is **annotation-node only when explicitly demanded by the moderator** (e.g., a "pin this annotation to the canvas" gesture). **Rejected** because:

- **Promotion would be UI-state rather than projection-state**. The same annotation-endpoint edge in the same event log would render differently per moderator depending on whether they'd pinned the annotation. That's an inconsistent observable surface — two moderators looking at the same session see different graphs.
- **The promotion rule should be a function of the projection** so anyone reading the projection (Playwright spec, walkthrough fixture, replay-mode debugger) sees the same graph. "Annotation X is referenced as an edge endpoint" is observable from the event log; "moderator-Alice has pinned annotation X" is not.

A more invasive alternative is **render every annotation as a node AND keep the badge** (visual duplication). **Rejected** trivially: duplicated visual representation is confusing — moderators would have to learn that the badge and the node are the same entity.

The hybrid promotion rule is the right cut: it amends `mod_annotation_rendering`'s Decision §1 by adding a clause — "*for the subset of annotations that participate as edge endpoints, promote to a standalone `AnnotationNode`; mutual exclusion with the badge.*" The original decoration framing continues to govern the non-endpoint case.

### §2. **Promotion-set computation lives at the selector layer**, not in the node component.

The alternative is to render every annotation as a hidden ReactFlow node and have the node component conditionally render itself visible / invisible. **Rejected** because:

- **Dagre would lay out invisible nodes**, taking up canvas space. The whole point of mutual exclusion is to keep the layout clean for the non-endpoint case.
- **The promotion set is observable from the events log alone** — no need to roundtrip through React state to derive it. Pure-selector composition is the right idiom for the moderator codebase (per the `selectors.ts` docblock at L1-23).
- **Testability**: a pure helper is one-line Vitest cover; a conditionally-invisible node would need a render harness.

### §3. **Mutual exclusion between badge and node**, enforced at the selector layer (not the renderer).

The alternative is to leave the badge in place AND also render the annotation node, then style the badge to "fade out" when the node is present. **Rejected** because:

- **The selector is the right exclusion seam**. The badge container's `data.annotations` array drives the badge render directly; filtering at the selector keeps the renderer dumb.
- **A "faded" badge invites accessibility regressions** (assistive tech still sees the badge in the DOM; visual fade doesn't communicate "this thing is now a separate node").
- **Test pin is simpler**: assert the badge container is absent or excludes the promoted id, rather than asserting CSS opacity.

The selector-layer filter is one `if (promotedSet.has(annotation.id)) continue;` line inside `groupAnnotationsByNode` / `groupAnnotationsByEdge`'s post-grouping pass — or equivalently a pre-grouping filter on the input array. Implementer's choice; both pass the same Vitest assertions.

### §4. **Host pseudo-edge tethers the annotation node to its host**; node-hosted is honest, edge-hosted approximates via the host edge's source node.

The strongest alternative is **no host pseudo-edge at all**. **Rejected** because:

- **Dagre would place the annotation node based ONLY on its annotation-endpoint edges**. An annotation referenced by a single annotation-endpoint edge (`source = N1`, `target = A1`) would float adjacent to N1 — fine. But an annotation referenced by zero edges that nevertheless got promoted via a separate `source-annotation` reference elsewhere could float anywhere. The spatial association with the host (the thing the annotation comments on) is the moderator's mental model — losing it would degrade the canvas's information density.
- **The host pseudo-edge restores the spatial association** the badge currently provides. Without it, the moderator would see "an annotation node floating somewhere with an edge to N7" and have to read the annotation's content to recover "this annotation is about N5". The dashed connector is cheap and unambiguous.

The second alternative is **render the host pseudo-edge as a real statement edge of role `annotates`** rather than a synthetic UI artifact. **Rejected** because:

- **`annotates` is not in the wire edge-role vocabulary** ([`docs/data-model.md:L114-122`](../../../docs/data-model.md)). The role enum is closed (supports / contradicts / explains / ...); adding `annotates` would be a methodology change touching the projection and replay layers.
- **The host pseudo-edge has no methodology semantics**. It's purely a spatial-association indicator for the moderator surface. Mixing it into the substance edge type would force the diagnostics pipeline (cycle detection, dangling-claim detection, etc.) to filter it out — re-introducing the kind of "skip if pseudo" guard the projection just removed for annotation-endpoint edges.

For edge-hosted annotations (the annotation's `targetEdgeId` is set), the host pseudo-edge tethers to the host edge's `source` node. The alternative — render a midpoint node on the host edge for the annotation to connect to — is more correct (the pseudo-edge would visually meet the host edge at its midpoint, which is "where the annotation is conceptually about") but more invasive (requires a synthetic mid-edge node + a host pseudo-edge that's actually 1.5 visible segments). The source-node approximation ships v1; if moderator feedback shows the imprecision matters, a future polish task — `mod_annotation_node_edge_host_midpoint` (~0.5d) — adds the midpoint rendering. Named in Tech-debt registration below.

When neither host is resolvable (a wire-protocol defensive case), the host pseudo-edge is omitted and the annotation node carries `data-host-missing="true"` for diagnosis. The annotation node still renders so the moderator can SEE the orphaned entity rather than encountering a silent edge-drop.

### §5. **`AnnotationNode` dimensions: 192×56**, smaller than `StatementNode` (288×90).

The alternative is to match `StatementNode`'s dimensions exactly. **Rejected** because:

- **Annotations are denser semantically but lighter visually**. The kind label + short content body fit in a narrower card; padding the card to 288×90 would waste canvas space.
- **Visually distinguishing annotation nodes from statement nodes is desirable**. A different size + different content density (header + body line vs. statement node's full wording paragraph) is a cheap visual signal that "this is a different entity kind" without requiring per-node color theming.

The chosen dimensions are: `width: 192` (= 12rem; ~⅔ of statement node's 18rem), `height: 56` (= 3.5rem; fits a header line + a single body line of `text-xs` Tailwind text). Threaded through the existing per-node `width` / `height` field that `layoutEngine.ts` reads — no engine change required.

A future amendment may revisit these dimensions once `mod_layout_measured_dimensions`-style per-card ResizeObserver coverage extends to annotation nodes; this v1 picks constants and ships.

### §6. **Reuse `methodology.annotationKind.<kind>` i18n keys**; no new annotation-node-specific keys.

Same DRY rationale as `mod_annotation_kind_tagging` Decision §4: the badge and the node both render the same kind label. The label lives in one catalog binding the badge already consumes — no risk of node-vs-badge drift, no new strings for native-speaker review.

Truncation of `content` for the node body line is a presentation concern (the renderer slices the string), not an i18n concern.

### §7. **`AnnotationHostEdge` carries `pointerEvents: none`**.

The host pseudo-edge is a UI artifact, not a methodology entity. Clicking it should NOT:
- Open a context menu (right-click on a real edge does — `mod_context_menus`).
- Open a hover popover (the real `StatementEdge` does — `mod_hover_details`).
- Affect selection state.

The cleanest enforcement is CSS-level `pointer-events: none` on the pseudo-edge's `<g>` wrapper. Mouse events pass through to whatever is behind it on the canvas (typically the canvas background or the statement node the pseudo-edge happens to overlap during layout).

The alternative is to render the pseudo-edge but disable its event handlers in JavaScript. **Rejected** as fragile: any future addition that forgets to check `if (edge.type === 'annotation-host') return;` would silently re-enable the click-target behavior. CSS-level enforcement is more honest.

### §8. **Playwright cover is in scope** (not deferred to `mod_pw_full_session_run` or a `mod_pw_*` catch-all).

The source-of-debt note in the `.tji` block explicitly requires it: *"Includes Playwright cover asserting an annotation-endpoint edge appears on the canvas."* And the per-policy `mod_pw_*` debt-watch favors paying down where reasonable:

- **`mod_pw_full_session_run` is a 3d catch-all** that will recreate the example walkthrough end-to-end. Deferring annotation-endpoint rendering into it would couple this task's verification to E15's refit (which is downstream) and to two-participant-tablet orchestration (which is overkill for "does the annotation node appear?").
- **`mod_pw_diagnostic_flow` already inherits debt from 5+ refinements** per the debt-watch guidance. Adding to it is exactly the planning-debt time bomb the policy flags.
- **A focused, ~50-line spec** that seeds the WS store with an annotation-endpoint event log and asserts the canvas surface (one node + one annotation node + one statement edge + one host pseudo-edge + badge-absence) costs less than the debt-tracking ceremony of either deferral and pins the user-observable contract directly.

The spec uses the existing WS-state seed seam ([`tasks/refinements/foundation/playwright_test_helpers.md`](../foundation/playwright_test_helpers.md) precedent); no new test-infrastructure work.

### §9. **No host pseudo-edge styling per annotation kind**; uniform dashed slate-300.

The alternative is to color the host pseudo-edge by the annotation's kind (matching the future per-kind theming that `data-annotation-kind` will hook into). **Rejected** for v1 because:

- **Per-kind colour theming is gated on `packages/ui-tokens` shipping** (per `mod_annotation_rendering` Decision §5). Until then, picking ad-hoc per-kind colours for the host pseudo-edge would create a fork: the pseudo-edge would have per-kind colours, the badge would not.
- **Uniform low-contrast slate is the right baseline for a spatial-association indicator** — it shouldn't compete visually with the actual methodology edges (substance roles).

When `packages/ui-tokens` lands, the host pseudo-edge can pick its colour from the same per-kind palette uniformly with the badge / node — the `data-annotation-kind` seam carries onto the host pseudo-edge's wrapping `<g>` so the CSS selector hooks in identically.

### §10. **`StatementEdgeData.sourceId` / `targetId` widen to accept annotation ids**.

The existing carriage fields on `StatementEdgeData` are typed `string` (per [`selectors.ts:92-98`](../../../apps/moderator/src/graph/selectors.ts#L92-L98)) and consumed by `<HoverPopover>` to render the endpoint-references row. With this task lifting the guard, those ids may now be annotation ids (not just node ids).

The downstream `<HoverPopover>` reads them as opaque ids — it doesn't currently distinguish "this id refers to a node" vs. "this id refers to an annotation." For v1 the popover continues to render the id verbatim; the moderator can disambiguate by looking at the canvas (where the annotation node is now visible).

A future polish task — `mod_hover_popover_endpoint_kind_disambiguation` (~0.5d) — could surface "(annotation)" or "(node)" badges next to each endpoint id in the popover. Named in Tech-debt registration below.

Mirrors the `sourceWording` / `targetWording` carriage: those resolve via the `wordingByNodeId` Map at [`selectors.ts:357-362`](../../../apps/moderator/src/graph/selectors.ts#L357-L362). For an annotation endpoint, the wording resolution falls through to the `'—'` em-dash fallback (the annotation id is not in the `wordingByNodeId` Map). This is honest — the annotation has no wording in the node-wording sense; it has content, which lives on the annotation node itself. The em-dash fallback is the existing documented behavior for "id not seen as `node-created`".

### §11. **Tech-debt registration**: name follow-ups crisply.

The following follow-ups surface during this task's scope but are out of scope:

- **`mod_annotation_node_edge_host_midpoint`** (future task — ~0.5d, UI-stream, moderator). When an annotation's host is an edge (not a node), render the host pseudo-edge tethered to the host edge's midpoint (via a synthetic midpoint node) rather than its source. The v1 implementation tethers to the source as an approximation per Decision §4. Belongs in the `moderator_ui.mod_annotation_ui.*` area (the same area as this task) under milestone M2 (the moderator-canvas milestone). Closer registers in WBS.

- **`mod_hover_popover_endpoint_kind_disambiguation`** (future task — ~0.5d, UI-stream, moderator). Disambiguate "annotation endpoint" vs. "node endpoint" in the edge-popover's endpoint-references row (a small "(annotation)" / "(node)" badge next to each id). The v1 popover renders ids verbatim per Decision §10. Belongs under `moderator_ui.mod_annotation_ui.*`. Closer registers in WBS.

The pre-existing follow-ups `walkthrough_e15_annotation_endpoint_refit`, `mod_propose_annotation_endpoint_gestures`, `part_render_annotation_endpoint_edges`, `aud_render_annotation_endpoint_edges`, and `set_edge_substance_annotation_endpoint` are NOT re-registered — they exist in WBS already (the `projection_edge_annotation_endpoint` Status block named them; the `.tji` `depends` graph wires them).

## Open questions

(none — all decided in §1–§11.)

## Status

**Done** — 2026-05-30.

- `apps/moderator/src/graph/AnnotationNode.tsx` (new) — memo'd `<AnnotationNode>` with `data-testid`, `data-annotation-kind`, `title`, `data-host-missing` seams; exports `ANNOTATION_NODE_TYPE = 'annotation'` and `AnnotationNodeData`.
- `apps/moderator/src/graph/AnnotationHostEdge.tsx` (new) — dashed `<BaseEdge>` (`strokeDasharray="4 3"`, `stroke="#cbd5e1"`, `pointerEvents="none"`, no marker); exports `ANNOTATION_HOST_EDGE_TYPE = 'annotation-host'`.
- `apps/moderator/src/graph/selectors.ts` — lifted L374-376 annotation-endpoint `continue` guard; added `computeAnnotationsAsEndpoints`, `projectAnnotationNodes`, `projectAnnotationHostEdges`; badge-mutual-exclusion filter in `selectEdgesForSession`.
- `apps/moderator/src/graph/edgeTypes.ts` — registered `annotation-host` edge type alongside `statement`.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — registered `annotation` node type; appended promoted-annotation nodes + host pseudo-edges; seeded dagre dimensions for annotation nodes (192×56); narrowed context-menu `targetNode` to statement nodes.
- `apps/moderator/src/graph/selectors.test.ts` — 17 new cases: promotion-set helper, projectors, lifted-guard selector branches, mutual-exclusion pin.
- `apps/moderator/src/graph/AnnotationNode.test.tsx` (new) — 15 cases: i18n × 4 kinds, `data-testid`/`data-annotation-kind`/`title`, `data-host-missing`.
- `apps/moderator/src/graph/AnnotationHostEdge.test.tsx` (new) — 3 cases: dashed-low-contrast styling, `pointerEvents="none"`, absence of `markerEnd`.
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — 4 new cases: promoted-flow, badge-baseline regression, `projectNodes` promotion, mutual-exclusion.
- `tests/e2e/fixtures/wsStoreSeed.ts` — extended with `SeedAnnotation` + polymorphic edge endpoint kinds.
- `tests/e2e/annotation-endpoint-rendering.spec.ts` (new) — Playwright spec asserting annotation node, host edge, badge absence, and annotation-endpoint statement edge on the moderator canvas.
- `playwright.config.ts` — added `chromium-moderator-annotation-endpoint` project.
- Gate-check note: `extract_annotation_detail_view` gate stays open — this task does NOT open a per-annotation drill-down panel; `AnnotationNode` is a click-target in the spatial sense but does not trigger a detail panel on click.
- Tech-debt follow-ups registered in WBS: `mod_annotation_node_edge_host_midpoint` and `mod_hover_popover_endpoint_kind_disambiguation` (both under `moderator_ui.mod_annotation_ui`, gated by M7 via container dependency).
