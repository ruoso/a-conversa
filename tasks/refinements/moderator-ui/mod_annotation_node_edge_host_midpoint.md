# Tether edge-hosted annotation pseudo-edge to host edge midpoint

**TaskJuggler entry**: `moderator_ui.mod_annotation_ui.mod_annotation_node_edge_host_midpoint` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) (block at L724-L735). Embedded note: *"Source of debt: mod_render_annotation_endpoint_edges (2026-05-30) — the v1 host pseudo-edge for an annotation targeting an edge tethers to the host edge's source node (approximation per Decision §4). The correct rendering connects the annotation node to the host edge's visual midpoint via a synthetic midpoint node. Belongs in moderator_ui.mod_annotation_ui.*. Source refinement: tasks/refinements/moderator-ui/mod_render_annotation_endpoint_edges.md (Decisions §4, §11)."*

## Effort estimate

**0.5d** (per the `.tji` allocation). Roughly:

- **`<AnnotationHostMidpointNode>` node-type + registration** (~0.05d). A 0×0 invisible ReactFlow node, `pointer-events: none`, carries `data-testid="annotation-host-midpoint-<edge-id>"` for the test seam; registered alongside `STATEMENT_NODE_TYPE` and `ANNOTATION_NODE_TYPE` in the `NODE_TYPES` map at [`GraphCanvasPane.tsx:146-148`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L146-L148).
- **Projector `projectAnnotationHostMidpointNodes`** (~0.05d). Pure helper in `apps/moderator/src/graph/selectors.ts` emitting one midpoint node per *edge-hosted* promoted annotation whose host edge id resolves in the projection. Position is `(0, 0)` at emit time; the post-layout pass below overwrites with the host edge's geometric midpoint.
- **Selector rewire: edge-hosted host pseudo-edge points at the midpoint node** (~0.05d). In `projectAnnotationHostEdges` ([`selectors.ts:696-717`](../../../apps/moderator/src/graph/selectors.ts#L696-L717)), the `targetEdgeId` branch swaps `source: edgeSources.get(targetEdgeId)` (host edge's source-node id, the v1 approximation) for `source: midpointIdFor(targetEdgeId)` (the synthetic midpoint node). Node-hosted annotations are unchanged.
- **Post-layout midpoint placement** (~0.15d). After `applyLayout` / `relayoutAll` in [`GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx), a pure helper `placeAnnotationHostMidpoints(nodes, hostEdgeAnchorMap)` walks the midpoint nodes and overwrites each `position` with the centroid of its host edge's source-node + target-node positioned centers. Lives next to the existing layout invocation; no `layoutEngine` change.
- **Vitest cover** (~0.15d). Projection helper, midpoint-placement helper, `projectAnnotationHostEdges` rewire (edge-hosted now points at midpoint id; node-hosted unchanged), `GraphCanvasPane` integration (the rendered `AnnotationHostEdge` tethers from midpoint to annotation node).
- **Playwright cover** (~0.05d). Extend [`tests/e2e/annotation-endpoint-rendering.spec.ts`](../../../tests/e2e/annotation-endpoint-rendering.spec.ts) with one additional seeded scenario: an annotation whose `target_edge_id` references a real edge already in the seeded log; assert the midpoint node renders and the host pseudo-edge tethers to it.

## Inherited dependencies

**Settled:**

- [`moderator_ui.mod_annotation_ui.mod_render_annotation_endpoint_edges`](./mod_render_annotation_endpoint_edges.md) (done — 2026-05-30, named THIS task under Decision §4 + Tech-debt §11). Shipped:
  - The promotion-set + projection pipeline ([`selectors.ts`](../../../apps/moderator/src/graph/selectors.ts) `computeAnnotationsAsEndpoints`, `projectAnnotationNodes`, `projectAnnotationHostEdges`) — THIS task adds a parallel midpoint-node projector and rewires the edge-hosted branch of `projectAnnotationHostEdges`.
  - The synthetic-host-pseudo-edge concept (`AnnotationHostEdge.tsx`, `annotation-host` edge type, dashed slate-300 styling, `pointer-events: none`) — reused as-is; only its `source` field changes for the edge-hosted case.
  - The defensive `data-host-missing` seam on `AnnotationNode` for the "no host resolvable" case ([`AnnotationNode.tsx` `hostMissing` data field](../../../apps/moderator/src/graph/AnnotationNode.tsx)) — extended below to also fire when the edge-hosted lookup fails (the host edge id present but unrenderable in the projection at this moment).
  - The `buildAnnotationHostIndex` / `resolveAnnotationHostId` helpers ([`selectors.ts:581-621`](../../../apps/moderator/src/graph/selectors.ts#L581-L621)) — extended with a parallel resolver that also exposes the host edge's *target* node id (needed for midpoint computation, where the v1 approximation only kept the source).
  - The Playwright spec [`tests/e2e/annotation-endpoint-rendering.spec.ts`](../../../tests/e2e/annotation-endpoint-rendering.spec.ts) — extended below with an edge-hosted scenario; the `wsStoreSeed.ts` polymorphic seed already supports `target_edge_id` on `annotation-created` payloads.
  - The selector comment at [`selectors.ts:570-571`](../../../apps/moderator/src/graph/selectors.ts#L570-L571) — the breadcrumb naming THIS task; the comment contracts on landing per the closer's wire-up.

- [`moderator_ui.mod_annotation_ui.mod_render_annotations`](./mod_annotation_rendering.md) (done — 2026-05-11). The `groupAnnotationsByEdge` index ([`packages/shell/src/`](../../../packages/shell/src/)) is the upstream `Annotation.targetEdgeId` consumer; nothing here changes the badge / decoration framing for annotations targeting an edge that are NOT promoted to a node (those continue to render as badges on the edge target row).

- [ADR 0004 — Graph libraries: ReactFlow on moderator + Cytoscape on read-only surfaces](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md). A third custom node-type (`annotation-host-midpoint`) registered alongside `statement` and `annotation` is the canonical ReactFlow extension shape — same pattern as the predecessor task's `annotation` node-type registration.

- [ADR 0025 — Moderator layout engine: dagre Sugiyama hierarchical](../../../docs/adr/0025-moderator-layout-engine-dagre.md). The dagre pipeline lays out every node id uniformly. THIS task does NOT feed midpoint nodes to dagre (Decision §2); the engine itself is untouched. The cache-stability strategy (ADR 0025 Amendment 2026-05-24) is preserved because the midpoint node ids are computed from the dagre-managed real-node positions in a downstream pass.

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). Every check ships as committed Vitest + Playwright.

- [ADR 0011 / 0013 — ESLint + TypeScript strict](../../../docs/adr/0011-eslint.md). `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` are on; the new `AnnotationHostMidpointNodeData` interface matches the established shape.

**Pending (none — every load-bearing input is settled on `main`):**

The future `mod_propose_annotation_endpoint_gestures` (still pending) does NOT affect midpoint rendering — it adds gestures for *minting* annotation-endpoint edges; midpoint placement reads whatever edges exist regardless of minting path.

## What this task is

Today, when a promoted annotation targets an *edge* (its `Annotation.targetEdgeId` is set), the host pseudo-edge tethers to the host edge's **source node** — the v1 approximation documented under Decision §4 of [`mod_render_annotation_endpoint_edges`](./mod_render_annotation_endpoint_edges.md). The correct rendering tethers the annotation node to the host edge's **visual midpoint**, which is where the annotation conceptually attaches.

This task replaces the v1 approximation with a synthetic midpoint node:

1. **A new invisible `<AnnotationHostMidpointNode>` ReactFlow node-type** in `apps/moderator/src/graph/AnnotationHostMidpointNode.tsx`. Renders a 0×0 `<div>` with `pointer-events: none` and a `data-testid="annotation-host-midpoint-<edge-id>"` test seam. No visible content; the dashed pseudo-edge appears to terminate at the host edge's middle.
2. **A `projectAnnotationHostMidpointNodes(annotations, promotedSet, hostEdgeIds)` pure helper** in `selectors.ts` emitting one midpoint node per (edge-hosted, promoted, host-edge-resolvable) annotation. Position is `(0, 0)` at emit time; the post-layout pass overwrites.
3. **`projectAnnotationHostEdges` rewires the edge-hosted branch**. Today it points the pseudo-edge's `source` at the host edge's source node id ([`selectors.ts:587-590`](../../../apps/moderator/src/graph/selectors.ts#L587-L590), via `edgeSources.get(targetEdgeId)`). It now points the `source` at the synthetic midpoint node's id (`annotation-host-midpoint-<edge-id>`). Node-hosted annotations (the `targetNodeId` branch) are unchanged.
4. **A post-layout `placeAnnotationHostMidpoints` pass** in `GraphCanvasPane.tsx`. After `applyLayout` / `relayoutAll` returns the dagre-laid-out nodes (statement nodes, promoted annotation nodes), walk the midpoint nodes and overwrite each `position` with the geometric centroid of its host edge's two endpoint nodes (source center + target center, halved). This places the midpoint exactly where the host edge's straight-line midpoint would render.
5. **Defensive seam**. When the host edge's *target* node can't be resolved (the host edge has not yet projected, or its endpoints have been pruned), the midpoint node is not emitted, the host pseudo-edge is not emitted, and the annotation node carries `data-host-missing="true"` — same diagnosis surface the v1 approximation uses today for the unresolved case.
6. **Cover** — Vitest pinning the projector, the midpoint-placement helper, the rewired `projectAnnotationHostEdges` branch, the `GraphCanvasPane` integration; Playwright extending the existing annotation-endpoint spec with one edge-hosted scenario.

No new methodology semantics. No projection-layer change. No schema change. No edge-role change. The midpoint node is a purely visual scaffold — invisible, non-clickable, non-methodology.

## Why it needs to be done

**The v1 source-node tether misplaces edge-hosted annotations.** Decision §4 of [`mod_render_annotation_endpoint_edges`](./mod_render_annotation_endpoint_edges.md) ships the source-node approximation explicitly as v1 debt: *"render a midpoint node on the host edge for the annotation to connect to is more correct... ships v1; if moderator feedback shows the imprecision matters, a future polish task — `mod_annotation_node_edge_host_midpoint` (~0.5d) — adds the midpoint rendering."* THIS task is that follow-up.

**The misplacement is observable on the canonical walkthrough.** The E15 fixture refit (`walkthrough_e15_annotation_endpoint_refit`, downstream) is `(N19) -[contradicts]-> (A2)` — but A2's own target is an edge (E2: "humans should switch to clean energy → climate harms humanity"), so the refit will surface a promoted annotation whose host is itself an edge. With the v1 approximation, A2 would tether to E2's source node N1, not E2's middle. The moderator's mental model — "A2 comments on the *connection* between N1 and N3" — is degraded by the source-skewed placement.

**The fix is local + cheap.** A synthetic invisible node + a one-line post-layout coordinate write + one rewired branch in an existing projector. No engine change, no projection change. The cost-to-correctness ratio is the right shape.

**Test pin durability.** The midpoint pattern is the right semantic anchor for any future Playwright assertion about edge-hosted annotation placement (e.g., the walkthrough's "A2 sits between N1 and N3 visually" check). `data-testid="annotation-host-midpoint-<edge-id>"` is a stable, locale-independent, layout-cache-stable handle that downstream specs can pin without coupling to dagre coordinate math.

## Inputs / context

### The selector layer

- [`apps/moderator/src/graph/selectors.ts:581-594`](../../../apps/moderator/src/graph/selectors.ts#L581-L594) — `resolveAnnotationHostId`: the v1 dispatch. The `targetEdgeId` branch (lines 587-590) returns `edgeSources.get(annotation.targetEdgeId)` — the host edge's source node. THIS task replaces that return value with the synthetic midpoint id for the edge-hosted case.
- [`apps/moderator/src/graph/selectors.ts:601-621`](../../../apps/moderator/src/graph/selectors.ts#L601-L621) — `buildAnnotationHostIndex`: collects `knownNodeIds` + `edgeSources: Map<edge_id, source_node_id>`. THIS task extends the index with a parallel `edgeTargets: Map<edge_id, target_node_id>` so the midpoint pass can compute centroids from both endpoints. The single pass over events absorbs the additional `Map.set` without measurable cost (per-event constant work).
- [`apps/moderator/src/graph/selectors.ts:696-717`](../../../apps/moderator/src/graph/selectors.ts#L696-L717) — `projectAnnotationHostEdges`: emits one host pseudo-edge per promoted annotation. THIS task rewires the edge-hosted branch (`source` now points at `annotation-host-midpoint-<edge-id>` instead of the resolved source node id); node-hosted branch is unchanged.
- [`apps/moderator/src/graph/selectors.ts:570-571`](../../../apps/moderator/src/graph/selectors.ts#L570-L571) — the breadcrumb comment naming THIS task. Contracts on landing per the closer's wire-up.

### The renderer layer

- [`apps/moderator/src/graph/AnnotationHostEdge.tsx`](../../../apps/moderator/src/graph/AnnotationHostEdge.tsx) — pattern reference for the host pseudo-edge shape. Unchanged by this task; the bezier path interpolates between its source / target endpoints which are now (in the edge-hosted case) the midpoint node and the annotation node — both ReactFlow nodes with normal `(x, y)` positions, so the existing `getBezierPath(...)` works identically.
- [`apps/moderator/src/graph/AnnotationNode.tsx`](../../../apps/moderator/src/graph/AnnotationNode.tsx) — pattern reference for the new `AnnotationHostMidpointNode.tsx`. The midpoint node is structurally simpler (no i18n label, no body content, no kind seam) — just an invisible 0×0 container with the test-seam attribute.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx:146-148`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L146-L148) — the `NODE_TYPES` map widens from two entries (`statement`, `annotation`) to three (`+ annotation-host-midpoint`).
- [`apps/moderator/src/graph/GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) — the `useMemo` block that calls `applyLayout` / `relayoutAll` on the projected nodes + edges. THIS task adds a downstream `placeAnnotationHostMidpoints(layoutedNodes, hostEdgeAnchorMap)` pass before the result is fed to ReactFlow.

### The layout engine

- [`apps/moderator/src/graph/layoutEngine.ts`](../../../apps/moderator/src/graph/layoutEngine.ts) — dagre wrapper; per-node width / height read off node-attached fields. **Untouched by this task**: midpoint nodes are NOT fed to dagre (Decision §2); they're positioned in a downstream pass that consumes dagre's output.
- ADR 0025 Amendment 2026-05-24 — the cache-stability strategy. Midpoint nodes are an *additive* layer over dagre's output; their ids don't participate in dagre's truly-new-id detection, so they don't trigger relayout. Each render computes midpoint position from the current dagre node positions — proportional and stable.

### The seed seam + Playwright

- [`tests/e2e/fixtures/wsStoreSeed.ts`](../../../tests/e2e/fixtures/wsStoreSeed.ts) — extended in the predecessor with `SeedAnnotation` carrying polymorphic targets. The `target_edge_id` field is already supported; no fixture change needed.
- [`tests/e2e/annotation-endpoint-rendering.spec.ts`](../../../tests/e2e/annotation-endpoint-rendering.spec.ts) — the predecessor's spec. Today's seeded scenario is node-hosted (annotation A1 targets node N1). THIS task adds an edge-hosted scenario: a second node N2, an edge E1 between N1 and N2, an annotation A2 with `target_edge_id: E1`, and an annotation-endpoint edge from N1 (or any node) to A2 (so A2 enters the promotion set). The new assertions pin the midpoint node's presence and the host pseudo-edge's source attribute.

### Sibling precedent

- [`tasks/refinements/moderator-ui/mod_render_annotation_endpoint_edges.md`](./mod_render_annotation_endpoint_edges.md) — Decisions §4 + §11 (the source of debt); Decision §5 (the dimension idiom — midpoint is the limit case, 0×0).
- [`tasks/refinements/moderator-ui/mod_hover_popover_endpoint_kind_disambiguation.md`](./mod_hover_popover_endpoint_kind_disambiguation.md) — the established shape for a small follow-up that pays down a named v1 debt from the same predecessor.

## Constraints / requirements

1. **Midpoint id is deterministic from host edge id.** `midpointIdFor(edgeId): string` returns `"annotation-host-midpoint-${edgeId}"`. Stable across renders so layout cache keys are stable.

2. **One midpoint node per host edge, not per annotation.** Two annotations sharing the same `targetEdgeId` share the same midpoint node (and both their host pseudo-edges tether to it). The projector deduplicates by edge id when emitting midpoints. Vitest pins the dedup branch.

3. **Midpoint node is invisible.** 0×0 footprint, `pointer-events: none`, no visible content, no border, no fill. The host pseudo-edge bezier visually terminates at the host edge's middle because the midpoint node has zero size at that coordinate.

4. **Midpoint nodes are NOT fed to dagre.** They live downstream of the dagre output (Decision §2). The `nodes` array passed to `applyLayout` / `relayoutAll` contains only `statement` + `annotation` typed nodes; midpoint nodes are appended after `placeAnnotationHostMidpoints` runs. This preserves the layout cache stability contract from ADR 0025 Amendment 2026-05-24.

5. **Midpoint position is the centroid of the host edge's two endpoint node centers**. Concretely, for host edge `E` with source node `S` (position `S.position` = top-left; size `(S.width, S.height)`) and target node `T`:
   - `center(N) = (N.position.x + N.width / 2, N.position.y + N.height / 2)`.
   - `midpoint = ( (center(S).x + center(T).x) / 2, (center(S).y + center(T).y) / 2 )`.
   - The midpoint node's `position` (ReactFlow top-left convention; 0×0 size means top-left ≡ center) is set to `midpoint`.

6. **Defensive omission**. If the host edge id present on `Annotation.targetEdgeId` does NOT resolve in `buildAnnotationHostIndex` (the edge has not yet been projected, or both its endpoints have been pruned), the midpoint node is omitted, the host pseudo-edge for that annotation is omitted, and the annotation node carries `data-host-missing="true"`. Same diagnostic shape the v1 approximation uses today for the "no host" case (per `mod_render_annotation_endpoint_edges` Constraint §4 third bullet).

7. **Node-hosted annotations are unchanged.** When `Annotation.targetNodeId` is set, the host pseudo-edge tethers directly from the host node id to the annotation node id, exactly as today. The midpoint node-type is only emitted for the edge-hosted case.

8. **Mutual exclusion + dedup.** The promotion-set + badge-suppression rules from the predecessor task continue to govern (a promoted annotation is rendered as `AnnotationNode`, not a badge). The midpoint node is a third entity *kind* the canvas surfaces — it is neither a badge nor a substantive node; tests pin it separately by `data-testid`.

9. **`pointer-events: none` on the midpoint node**. Same enforcement idiom as `AnnotationHostEdge` (Decision §7 of the predecessor). The midpoint node is a UI scaffold; clicks pass through to whatever sits behind it on the canvas (typically the host edge label or empty canvas).

10. **Diagnostic-highlight + facet statuses do NOT apply to midpoint nodes**. Same isolation as `AnnotationNode` from the predecessor (Constraint §8 there): midpoint nodes don't carry methodology semantics; the diagnostic-highlight pass writes only to `node-created` / `edge-created` ids; midpoint ids never appear.

11. **TypeScript strict + ESLint flat config compliance** ([ADR 0013](../../../docs/adr/0013-typescript-strict.md), [ADR 0011](../../../docs/adr/0011-eslint.md)). The new `AnnotationHostMidpointNodeData` interface (`{ hostEdgeId: string }`) and the widened `NODE_TYPES` map satisfy ReactFlow's `NodeTypes` shape.

12. **i18n** ([ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)). Midpoint nodes have no visible text — no catalog change.

13. **No new ADR.** The added node-type registration + the post-layout coordinate pass are direct applications of ADR 0004 (custom node-types) + ADR 0025 (dagre owns layout; downstream passes can derive secondary positions). No architectural seam opens.

14. **No projector / methodology / schema change.** Everything is moderator-UI selector + post-layout pass + node-type renderer.

15. **Vitest discipline** ([ADR 0006](../../../docs/adr/0006-test-framework-vitest.md), [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)). Every empirical check ships as a committed case.

16. **Playwright cover IS in scope** — extends the predecessor's existing scoped spec (the surface is reachable; full deferral to `mod_pw_full_session_run` is rejected per Decision §6).

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check is a committed Vitest case, an updated Playwright spec, or a CI script — no throwaway probes.

**Source edits**

- [ ] `apps/moderator/src/graph/AnnotationHostMidpointNode.tsx` (new file). Exports `ANNOTATION_HOST_MIDPOINT_NODE_TYPE = 'annotation-host-midpoint'`, the `AnnotationHostMidpointNodeData` interface (`{ hostEdgeId: string }`), and a memo'd `AnnotationHostMidpointNode` component rendering an empty 0×0 `<div>` with `pointerEvents: 'none'`, `data-testid="annotation-host-midpoint-<edge-id>"`, and `data-host-edge-id="<edge-id>"`. Width / height ReactFlow node-attached fields are both `0`.
- [ ] `apps/moderator/src/graph/selectors.ts`:
  - Export a `midpointIdFor(edgeId): string` helper (top-level utility — used by both projectors and tests).
  - Widen `buildAnnotationHostIndex` (lines 601-621) to also collect `edgeTargets: Map<edge_id, target_node_id>` alongside the existing `edgeSources`. Single pass over events; symmetric to the source pass.
  - Rewire the `targetEdgeId` branch of `resolveAnnotationHostId` (lines 587-590): on edge-hosted annotations, return `midpointIdFor(targetEdgeId)` if BOTH `edgeSources` and `edgeTargets` resolve for that edge id; else return `null` (defensive — falls through to `data-host-missing`).
  - Add `projectAnnotationHostMidpointNodes(annotations, promotedSet, hostIndex): Node<AnnotationHostMidpointNodeData>[]`. Walks promoted edge-hosted annotations; emits one midpoint node per unique host edge id whose both endpoints resolve in the index; position `(0, 0)`. Dedup by edge id.
  - Add `placeAnnotationHostMidpoints(layoutedNodes): Node[]`. Pure helper: given a `nodes` array that already contains midpoint nodes (positioned at `(0, 0)`) and the dagre-positioned statement / annotation nodes, walks the midpoint subset and overwrites each `position` with the centroid of the corresponding host edge's source + target nodes' centers (per Constraint §5). Returns a new array; does not mutate inputs.
  - Update the comment at lines 570-571 to point at THIS refinement and describe the midpoint rendering (kept short — the refinement is the source of truth).
- [ ] `apps/moderator/src/graph/GraphCanvasPane.tsx`:
  - Widen the `NODE_TYPES` map at L146-148 to include `[ANNOTATION_HOST_MIDPOINT_NODE_TYPE]: AnnotationHostMidpointNode`.
  - In the layout-feeding `useMemo`, after calling `applyLayout` / `relayoutAll` on the statement + annotation nodes, concatenate the midpoint node array AND apply `placeAnnotationHostMidpoints` to position them. The combined `nodes` array is fed to ReactFlow.
  - The edge `useMemo` (or its sibling) already concatenates `projectAnnotationHostEdges` per the predecessor — no shape change; the existing concatenation continues to work since the edges' `source` field already targets midpoint ids (which are now real ReactFlow node ids in the combined nodes array).
- [ ] No change to `apps/moderator/src/graph/AnnotationHostEdge.tsx` — the bezier renderer is endpoint-coordinate-driven; tethering to a midpoint node vs. a source node is observable only through `source` / `target` ids.

**Vitest coverage** (committed cases, ADR 0022)

- [ ] `apps/moderator/src/graph/selectors.test.ts`:
  - `midpointIdFor(edgeId)`: pins the deterministic `annotation-host-midpoint-${edgeId}` shape.
  - `buildAnnotationHostIndex`: an event log with one node-to-node `edge-created` populates both `edgeSources[edgeId]` and `edgeTargets[edgeId]` with the correct node ids; mixed annotation-endpoint edges continue to populate the source side per the predecessor's behavior.
  - `projectAnnotationHostMidpointNodes`:
    - Empty promoted set → empty array.
    - Promoted node-hosted annotation only → empty array (midpoints only emitted for edge-hosted promotions).
    - Promoted edge-hosted annotation with both host endpoints resolved → one midpoint node with `id: 'annotation-host-midpoint-<edge-id>'`, `type: 'annotation-host-midpoint'`, `data.hostEdgeId: <edge-id>`, `position: (0, 0)`.
    - Two promoted annotations sharing the same `targetEdgeId` → exactly ONE midpoint node (dedup pin).
    - Promoted edge-hosted annotation whose host edge has only one endpoint resolvable in the index → midpoint node NOT emitted (paired with the `data-host-missing` pin in the annotation node test).
  - `projectAnnotationHostEdges` (regression + rewire):
    - Node-hosted promoted annotation: `source` is still the host node id (regression).
    - Edge-hosted promoted annotation with host endpoints resolved: `source` is the midpoint id `annotation-host-midpoint-<edge-id>`, `target` is the annotation id (rewire pin).
    - Edge-hosted promoted annotation with host not resolvable: no host pseudo-edge emitted (defensive case).
  - `placeAnnotationHostMidpoints`:
    - Empty nodes array → empty array.
    - Nodes array with no midpoint subset → unchanged shape (statement / annotation nodes pass through with positions intact).
    - Single midpoint node + the host edge's two endpoint nodes positioned at known coordinates → midpoint position equals `((sx + tx) / 2, (sy + ty) / 2)` of the endpoint centers (Constraint §5 formula). Uses concrete numbers (e.g., S at `(0, 0)` size 288×90; T at `(400, 200)` size 288×90 → centroid `(344, 145)`).
    - Midpoint node whose host edge id can't be resolved against the layouted nodes (defensive — both endpoints missing) → midpoint position falls through to `(0, 0)` (unchanged); the test pins this branch.
- [ ] `apps/moderator/src/graph/AnnotationHostMidpointNode.test.tsx` (new file):
  - Renders a `<div>` with `width: 0` / `height: 0` styling and `pointer-events: none`.
  - Stamps `data-testid="annotation-host-midpoint-<edge-id>"` from the `data.hostEdgeId` field.
  - Stamps `data-host-edge-id="<edge-id>"`.
  - Contains no visible text content.
- [ ] `apps/moderator/src/graph/GraphCanvasPane.test.tsx`:
  - **Edge-hosted promotion flow**: a session log with `node-created` × 2 (N1, N2), `edge-created` (E1: N1→N2 node-substance), `annotation-created` (A2 targeting `target_edge_id: E1`), `edge-created` (annotation-endpoint: N1 → A2 — promotes A2) renders one `AnnotationNode` for A2, one `AnnotationHostMidpointNode` keyed on E1, and the host pseudo-edge `data-testid="annotation-host-edge-A2"` whose `source` resolves to the midpoint id (pinned via the ReactFlow `Edge` record on the rendered canvas).
  - **Mutual-exclusion baseline (regression)**: the node-hosted scenario from the predecessor stays green — no midpoint node emitted for node-hosted promotions.
  - **Midpoint position equals centroid (post-layout pin)**: after the dagre layout pass + `placeAnnotationHostMidpoints`, the rendered midpoint node's `position` equals the centroid of N1 and N2's positioned centers. Computed against fixed dagre-output positions (the dagre output is deterministic given the seeded input — the test pins to the actual numerical result, mirroring the layout-stability test from `mod_render_annotation_endpoint_edges` Acceptance criteria).
  - **`data-host-missing` regression**: an edge-hosted promoted annotation whose host edge has not been projected yet renders the annotation node with `data-host-missing="true"` and emits no midpoint + no host pseudo-edge.

**Playwright coverage** — extend the predecessor's spec; surface is reachable.

- [ ] `tests/e2e/annotation-endpoint-rendering.spec.ts` — add a new test case OR an additional assertion block to the existing case:
  - Seed the WS store with: `session-created`, `node-created` (N1), `node-created` (N2), `edge-created` (E1: N1→N2 with a node-substance role, e.g., `supports`), `annotation-created` (A2 targeting `target_edge_id: E1`), `edge-created` (annotation-endpoint: source = N1, target = A2, role = `contradicts`).
  - Assert the midpoint node renders: `await expect(page.locator('[data-testid="annotation-host-midpoint-E1"]')).toBeAttached()` (the midpoint is 0×0 and invisible — `toBeAttached`, not `toBeVisible`).
  - Assert the host pseudo-edge for A2 renders: `[data-testid="annotation-host-edge-A2"]` is present.
  - The seam mirrors the predecessor's pattern; the new edge-hosted scenario re-uses the existing `wsStoreSeed` helper without extension. The `playwright.config.ts` `chromium-moderator-annotation-endpoint` project covers the new assertions.

**Build + scheduler**

- [ ] `pnpm run check` clean (typecheck + lint + format + i18n-catalogs validator).
- [ ] `pnpm run test:smoke` green (Vitest test count rises by ~15 cases — projector + midpoint-placement + helper + GraphCanvasPane integration + renderer).
- [ ] `pnpm -F @a-conversa/moderator build` succeeds (bundle size delta is negligible — one tiny invisible node-type component + one pure-helper).
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100` lands on the task block at L724-L735.

**Refinement closure**

- [ ] `tasks/30-moderator-ui.tji` task block `mod_annotation_node_edge_host_midpoint` gains `complete 100` after the `allocate team` line, plus a `note "Refinement: tasks/refinements/moderator-ui/mod_annotation_node_edge_host_midpoint.md"` line.
- [ ] A `## Status` block is appended to this refinement on completion per [`tasks/refinements/README.md`](../README.md) ritual, listing the produced source / test / Playwright deltas and the smoke / build / `tj3` results.

## Decisions

### §1. **Synthetic midpoint node** — a real ReactFlow node positioned at the host edge's visual centroid — rather than a virtual edge-to-edge attachment.

The alternative is to leave the host pseudo-edge tethered to the host edge's *source node* (the v1 approximation) and accept the imprecision. **Rejected** — this task exists precisely to retire that approximation; the source-skewed placement is the documented v1 debt.

A more invasive alternative is to teach ReactFlow / the host pseudo-edge to render attached to *another edge* directly. **Rejected** because:

- **ReactFlow's `EdgeProps` contract exposes only source/target *node* coordinates** (`sourceX`, `sourceY`, `targetX`, `targetY`). There is no "attach an edge to another edge" primitive; building one would mean a custom edge renderer that walks the canvas tree at render time to look up the host edge's path. Fragile, expensive, off-paradigm.
- **A real node at the midpoint coordinate** is the canonical ReactFlow idiom for "connect to this spot on the canvas". Its size is 0×0 — visually it disappears — but the connection point is geometrically real.
- **The dashed pseudo-edge's bezier interpolation works unchanged**: source = midpoint node center, target = annotation node center. The existing `AnnotationHostEdge` component needs zero changes.

A third alternative is to render the host pseudo-edge as a custom SVG that draws from the annotation node to a *computed* coordinate in canvas-space, bypassing ReactFlow's edge mechanism. **Rejected** because:

- **ReactFlow's edge mechanism already handles viewport pan/zoom, layout updates, and re-render gating** for us. Replicating that with a custom SVG is a substantial regression.
- **Test seams are uniform**: every host pseudo-edge today carries `data-testid="annotation-host-edge-<annotation-id>"` and renders inside a `<g>` from `<BaseEdge>`. Diverging the edge-hosted case to a custom SVG would fragment the test surface.

### §2. **Midpoint nodes live downstream of dagre** — a post-layout coordinate pass, not a dagre input.

The strongest alternative is **inject midpoint nodes into the dagre graph**, with two auxiliary edges (`hostEdge.source → M → hostEdge.target`) so dagre lays out M between them. **Rejected** because:

- **Dagre's rank algorithm would reshape the host edge's layout**. Splitting `S → T` into `S → M → T` adds a rank between S and T, lengthening the visual gap between them and adding a horizontal slot for M. The host edge itself would no longer render as a straight S-to-T connector — its endpoints would drift apart. The cure becomes worse than the disease.
- **Dagre treats every node uniformly** for sizing + ranking. A 0×0 node forced between two ranked nodes is still allocated a rank slot and contributes to layout decisions in ways that propagate to neighboring nodes.
- **The cache-stability strategy (ADR 0025 Amendment 2026-05-24)** depends on a stable set of dagre-managed ids. Injecting midpoint ids into that set would force a relayout every time a new edge-hosted annotation is promoted — defeating the cache.

The chosen approach — compute midpoint position from dagre's output positions in a downstream pure pass — leaves dagre's view of the world untouched, preserves the cache contract, and gives exactly the desired geometric result (midpoint at the centroid of the two endpoint centers, which is where ReactFlow's bezier label-midpoint lands for a straight-ish host edge).

A second alternative is **ReactFlow's `onNodeDrag` / `useStore` hooks** to subscribe to host edge endpoint changes and update the midpoint position reactively. **Rejected** as overkill — the moderator surface doesn't expose drag-to-reposition for statement or annotation nodes today (positions are dagre-owned and read-only from user perspective); a one-shot post-layout pass in the same `useMemo` as the layout call is the simpler shape.

### §3. **Midpoint nodes are invisible (0×0)** — not a tiny visible dot.

The alternative is a small visible marker (e.g., a 4-pixel circle, or a `╳` glyph) showing the moderator where the pseudo-edge attaches. **Rejected** because:

- **The host edge itself already provides a visual line for the moderator's eye** to trace from N1 to N3. Adding a marker at its midpoint duplicates visual density without adding information.
- **A visible marker would invite the question "what is that dot?"** — moderators would have to learn that it represents the annotation's host-attachment point. The dashed pseudo-edge already communicates "this annotation comments on this edge"; the marker would be redundant signage.
- **0×0 is the right limit case**. The midpoint node has a position but no surface — the dashed pseudo-edge appears to terminate cleanly at the host edge's middle, which is the desired moderator-perception.

A future iteration may surface a marker if walkthrough feedback shows the host edge's middle is hard to pick out at low zoom levels. Punted to that hypothetical follow-up; v1 ships invisible.

### §4. **One midpoint node per host edge**, deduplicated even when multiple annotations target the same edge.

The alternative is one midpoint node per *annotation* (a unique `annotation-host-midpoint-<annotation-id>` id per promoted edge-hosted annotation). **Rejected** because:

- **All annotations targeting the same edge attach at the same spot** — the host edge's midpoint. Emitting N midpoint nodes at the same coordinate is pure noise; ReactFlow would render N invisible nodes at the same `(x, y)` and the dashed pseudo-edges would all bezier from there.
- **Stable test seam**: `data-testid="annotation-host-midpoint-<edge-id>"` is a deterministic 1-per-edge handle; tests pinning "the midpoint for E1" don't have to know which annotation promoted it.
- **Layout cost**: N midpoint-nodes-per-edge scales linearly with annotation density; 1 midpoint-per-edge is constant. Cheap to dedup at projection time via a `Set<edgeId>` walk.

### §5. **Midpoint position is the centroid of source + target node centers**, not the bezier midpoint of the rendered host edge.

The alternative is to compute the actual visual midpoint of the rendered bezier curve (via `getBezierPath` returning `[edgePath, labelX, labelY]` and taking `(labelX, labelY)`). **Rejected** because:

- **The bezier path is parameterized by the source and target `Handle.Position` values** (top / right / bottom / left) which encode the entry side. Computing `(labelX, labelY)` requires recreating those Handle.Position decisions outside ReactFlow's edge rendering. Coupling.
- **For straight-line host edges (the common case), the bezier midpoint and the centroid are visually indistinguishable** — within a few pixels. The centroid is the structurally correct "middle of the conceptual line between S and T" and is observable without re-running bezier math.
- **The pure-helper shape is simpler to test**: `centroid(s, t) = ((s.x + t.x) / 2, (s.y + t.y) / 2)`. Vitest pins to specific numerical values with no transcendentals.

For host edges whose bezier curves significantly bow (long-range edges where dagre routes around obstructions), the centroid will not visually coincide with the rendered curve's apex — a moderator may see the dashed pseudo-edge crossing empty canvas to reach an "off-curve" midpoint. If this case becomes load-bearing (the walkthrough's edge layouts are mostly short-range; the centroid will sit close to the curve), a future polish task can switch to the bezier-midpoint formula.

### §6. **Playwright cover is in scope** — extend `tests/e2e/annotation-endpoint-rendering.spec.ts`, not deferred to `mod_pw_full_session_run` or a `mod_pw_*` catch-all.

Same rationale as Decision §6 of the sibling `mod_hover_popover_endpoint_kind_disambiguation`:

- **The annotation-endpoint surface is reachable today** via the predecessor's spec + `wsStoreSeed.ts`. Adding a seeded edge-hosted scenario costs ~30 lines.
- **`mod_pw_full_session_run` is a 3d catch-all** — coupling this task's verification to its eventual landing would delay coverage for years of calendar time.
- **`mod_pw_diagnostic_flow` already inherits debt from 5+ refinements** per the debt-watch guidance; not piling more on.

The spec extension pins the midpoint node's presence + the host pseudo-edge's tether — the minimal observable contract for "edge-hosted annotations now render midpoint-correctly".

### §7. **No `pointer-events: none` enforcement at the renderer per-instance**; declare via the `<div>`'s inline style at the component level.

The alternative is to set `pointer-events: none` via a class in a stylesheet, or via a ReactFlow node-level `style` prop pushed through the projection. **Rejected** because:

- **The midpoint node has exactly one visual concern** — its size (0×0) and its pointer-events. Both live cleanly on the component's root `<div>` inline style. No external CSS or shared class is justified.
- **Consistency with `AnnotationHostEdge`** (Decision §7 of the predecessor), which also enforces `pointer-events: none` via its rendered `<g>` style attribute.

### §8. **`data-host-edge-id` attribute on the midpoint node**, mirroring the `data-host-missing` debug attribute on `AnnotationNode`.

The midpoint's host edge id is observable from the `data.hostEdgeId` field at the data layer but not at the DOM seam unless stamped explicitly. **Decided**: stamp it. Cost is one extra attribute; gain is a stable DOM-level handle for diagnosis when a moderator's UI inspector wants to know "this midpoint sits on which host edge?". Symmetric to `data-annotation-kind` on `AnnotationNode`.

### §9. **Tech-debt registration**: none.

No new follow-ups surface from this task. The centroid-vs-bezier-midpoint trade-off (Decision §5) is a known minor approximation; if walkthrough feedback flags it, the closer for a future task can register the bezier-midpoint upgrade at that point. Premature to register pre-feedback.

The visible-marker question (Decision §3) is similarly punted to feedback.

## Open questions

(none — all decided in §1–§9.)

## Status

**Done** — 2026-05-31.

- Added `apps/moderator/src/graph/AnnotationHostMidpointNode.tsx` (new): invisible 1×1 `<div>`, `pointer-events: none`, `data-testid="annotation-host-midpoint-<edge-id>"`, `data-host-edge-id`; size lifted from 0×0 to 1×1 to satisfy ReactFlow 11.11.4's handle-bounds guard.
- Added `apps/moderator/src/graph/AnnotationHostMidpointNode.test.tsx` (new): 4 renderer cases (size, pointer-events, testid, host-edge-id stamp, no visible text).
- Extended `apps/moderator/src/graph/selectors.ts`: added `midpointIdFor`, `projectAnnotationHostMidpointNodes`, `placeAnnotationHostMidpoints`, `buildAnnotationHostEdgeAnchorIndex`; widened `buildAnnotationHostIndex` + `resolveAnnotationHostId` to track edge targets; rewired `projectAnnotationHostEdges` edge-hosted branch to point at midpoint id.
- Extended `apps/moderator/src/graph/selectors.test.ts`: new Vitest cases for `midpointIdFor`, `projectAnnotationHostMidpointNodes` (5 cases incl. dedup pin), `placeAnnotationHostMidpoints` (5 cases incl. centroid math pin), `buildAnnotationHostEdgeAnchorIndex` (2 cases), rewired `projectAnnotationHostEdges` edge-hosted branch.
- Extended `apps/moderator/src/graph/GraphCanvasPane.tsx`: registered `annotation-host-midpoint` node type; added post-layout `placeAnnotationHostMidpoints` pass after `applyLayout`/`relayoutAll`.
- Extended `apps/moderator/src/graph/GraphCanvasPane.test.tsx`: 3 new integration cases — edge-hosted promotion → midpoint node emitted; node-hosted regression baseline; `data-host-missing` defensive case for unresolved host.
- Extended `tests/e2e/annotation-endpoint-rendering.spec.ts`: new edge-hosted seeded scenario (N1, N2, E1: N1→N2, A2 targeting `target_edge_id: E1`, annotation-endpoint N1→A2); asserts midpoint node attached and host pseudo-edge present.
