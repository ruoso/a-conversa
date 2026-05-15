# Moderator graph layout — measured node dimensions (per-node `getBoundingClientRect` instead of constant 288×90)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_layout_measured_dimensions` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) (search the leaf `task mod_layout_measured_dimensions` inside `task mod_graph_rendering`).

**Effort estimate**: 0.5d (confirmed). The implementation is: one extension to `applyLayout`'s `LayoutOptions` (a `dimensions?: ReadonlyMap<string, { width: number; height: number }>` field), one extension to `runDagre` so each node's `setNode(id, …)` uses the per-id rect when present (falling back to `nodeWidth` / `nodeHeight`), one new hook inside `<GraphCanvasPane>` that subscribes to ReactFlow's internal `nodeInternals` via `useStore` (gated on `useNodesInitialized()`), one `useRef`-backed `measurementCacheRef`, one debounced re-layout effect that re-invokes `applyLayout` once measurements stabilize, a Vitest extension to `layoutEngine.test.ts`, a Vitest case on `GraphCanvasPane.tsx` exercising the first-paint → re-measure flow, and a Playwright extension to `tests/e2e/moderator-graph-layout.spec.ts` that seeds at least one tall node and asserts the post-measurement non-overlap contract holds. No new dependency, no new ADR, no new i18n catalog key.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their public contracts):

- `moderator_ui.mod_graph_rendering.mod_layout_engine_choice` (done — `apps/moderator/src/graph/layoutEngine.ts` exports `applyLayout` / `relayoutAll` / `LayoutOptions` / `DEFAULT_LAYOUT_OPTIONS`. The functions already honor a per-call `nodeWidth` / `nodeHeight` constant via `LayoutOptions`; this task widens the option surface to accept a per-id dimension map so different cards get different rects fed to dagre. The position cache, the cache-write-back loop, and the incremental-stability semantics (existing nodes never move on event ticks) stay intact). The `nodeWidth` upper bound was raised 220 → 288 mid-implementation of that predecessor (ADR 0025 Amendment 2026-05-15) precisely because the rendered cards hit `<StatementNode>`'s `max-w-[18rem]` upper bound; this task lifts the symmetric constraint on height.
- `moderator_ui.mod_graph_rendering.mod_node_rendering` (done — `<StatementNode>` at `apps/moderator/src/graph/StatementNode.tsx` is a Tailwind card with `min-w-[12rem] max-w-[18rem]` and NO explicit height cap. The wording paragraph uses `whitespace-pre-line break-words` and does not `line-clamp`, so the card already grows vertically to fit its content — long wordings + multi-facet pill rows + axiom-mark rows + annotation rows + diagnostic halo render at whatever pixel height the browser computes. This task feeds those measured rects to dagre).
- `moderator_ui.mod_graph_rendering.mod_node_handle_rendering` (done — `<StatementNode>` exposes `Position.Top` target + `Position.Bottom` source `<Handle>` elements. ReactFlow's `handleBounds` are populated AFTER the `ResizeObserver` measurement pass — i.e. the same trigger this task subscribes to for dimension measurements. Reading the handle bounds is NOT needed for layout, but the dependency exists in time: handles render → ResizeObserver fires → ReactFlow stamps `width` / `height` on the internal `Node` → this task reads those).
- `moderator_ui.mod_graph_rendering.mod_hover_details` (done — `<HoverPopover>` renders as a child of the card root with `position: absolute; bottom: calc(100% + 4px)`. It does NOT enter the card's box-sizing footprint and is `pointer-events: none`, so the popover does not change the measured `getBoundingClientRect()` of the card root. Hover does not interact with this task's measurement loop).
- `moderator_ui.mod_graph_rendering.mod_per_facet_state_visualization` / `mod_axiom_mark_decoration` / `mod_annotation_rendering` / `mod_diagnostic_highlighting` / `mod_meta_disagreement_split_render` (all done — each is a per-node decoration layer that contributes its own rendered DOM inside (or, in the case of the halo ring, around) the card body. Measured dimensions naturally absorb the variable footprint these layers produce — that is the entire point of this task).
- `foundation.stack_decisions.graph_lib_decision` (done — [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) pinned ReactFlow on the moderator surface. ReactFlow 11.11.4 exposes the `useNodesInitialized()` hook and stamps `width` / `height` on the internal `Node` shape after its `ResizeObserver` measurement pass — both load-bearing for this task and verified in `node_modules/@reactflow/core@11.11.4/dist/esm/types/nodes.d.ts:21-22` and `…/hooks/useNodesInitialized.d.ts`).

Pending edges (this task does NOT depend on them; one of them DOES depend on this task):

- `moderator_ui.mod_graph_rendering.mod_pan_zoom` — orthogonal (the layout pass produces positions; pan/zoom operates on whatever positions land in `Node.position`).
- `moderator_ui.mod_graph_rendering.mod_edge_popover_full_target_wording` (pending; registered by `mod_node_handle_rendering`'s Closer in commit `f83852b`-era WBS) — **THIS task is a structural seam for that decision.** The popover currently truncates source/target wordings to 60 chars (`HoverPopover.tsx`'s `truncate()` helper); the open question for that task is "lift the cap or document the 60-char prefix as the design contract." That choice is materially informed by HOW MUCH WORDING THE CARD ITSELF SHOWS. Once the card is dynamically sized to fit its full wording (which it already is structurally — no `line-clamp` — but until this task lands, that growth crashes into the constant-90 px height that dagre uses, producing edge crossings), the popover's truncation question shifts from "should we truncate?" to "what does the popover add beyond the card?" See **Why it needs to be done** below for the framing.
- `moderator_ui.mod_graph_rendering.mod_layout_tidy_action` (pending) — composes with this task naturally: `relayoutAll(...)` is already exported and would accept the same per-id dimensions map; the tidy-up button would invoke `relayoutAll(nodes, edges, { dimensions: measurementCacheRef.current })` once this task lands.
- `moderator_ui.mod_capture_flow.*` — downstream consumer milestone work.

## What this task is

Concrete, mechanical work, in two visibly-distinct surfaces:

### A. Layout engine — accept per-node dimensions

- **Extend `LayoutOptions`** in `apps/moderator/src/graph/layoutEngine.ts`:
  ```ts
  export interface LayoutOptions {
    readonly rankdir?: RankDir;
    readonly nodeWidth?: number;   // fallback default — see DEFAULT_LAYOUT_OPTIONS
    readonly nodeHeight?: number;  // fallback default — see DEFAULT_LAYOUT_OPTIONS
    readonly rankSep?: number;
    readonly nodeSep?: number;
    readonly cache?: ReadonlyMap<string, XYPosition>;
    /**
     * Per-node measured dimensions. When a node's id is present in this
     * map, the dagre input uses the corresponding `{ width, height }`
     * instead of the constant `nodeWidth` / `nodeHeight`. Nodes whose id
     * is NOT in the map fall back to the constants. This is the seam
     * `<GraphCanvasPane>` uses to feed dagre the rects ReactFlow's
     * `ResizeObserver` measured off the rendered DOM. Refinement:
     * `mod_layout_measured_dimensions`.
     */
    readonly dimensions?: ReadonlyMap<string, { readonly width: number; readonly height: number }>;
  }
  ```
- **Extend `runDagre`'s `setNode` call** to consult `opts.dimensions` for a per-id rect, falling back to `opts.nodeWidth` / `opts.nodeHeight` when absent. The geometric-center → top-left translation in the post-layout pass already reads dagre's emitted `placed.width` / `placed.height`; it does NOT need to change because dagre echoes back the per-node dimension we registered. (Verified: `graph.node(id)` returns the same `width` / `height` we passed into `setNode`.) Update the post-layout translation to read the per-node rect from `opts.dimensions` (falling back to the constant) when subtracting half-width / half-height, so the top-left coordinate matches the measured footprint exactly.
- **Pass `dimensions` through `applyLayout` and `relayoutAll`** unchanged — both functions already destructure `options` and forward the resolved opts to `runDagre`.
- **`DEFAULT_LAYOUT_OPTIONS` is unchanged.** The constants stay the fallback for the first paint (before measurements arrive) and for any node whose measurement hasn't landed yet.
- **No public-API breakage.** Existing callers that don't pass `dimensions` get the same behavior as today — constant 288×90 per node. The 20 existing Vitest cases in `layoutEngine.test.ts` continue to pass unchanged.

### B. `<GraphCanvasPane>` — measure + re-layout

- **Subscribe to ReactFlow's internal node dimensions** via `useStore` (re-exported from `reactflow`). The selector reads `state.nodeInternals` (a `Map<string, Node>`) and emits a `Map<string, { width, height }>` containing every node whose `width !== null && height !== null && width > 0 && height > 0`. (ReactFlow stamps `width` / `height` on the internal `Node` once its `ResizeObserver` callback fires; until then both are `null`.) The selector returns the SAME Map reference across renders when no measurement changed — implement equality via a content-stable serialization or, simpler, return a numeric "revision counter" that increments only when a measurement changes, and read the actual rects via `getState()` inside the layout effect (the same idiom `selectEdgesForSession` uses).
- **Gate the re-layout on `useNodesInitialized()`** (the official ReactFlow seam; returns `true` only after every visible node has been measured). The first-paint path uses the constant-dimension cache (the current behavior). The re-layout effect waits for `useNodesInitialized() === true` AND then debounces 75 ms to absorb measurement aftershocks (per-facet decoration rows can trigger a chain of `ResizeObserver` callbacks as the catalog text and CSS settle).
- **`measurementCacheRef`** — a new `useRef<Map<string, { width: number; height: number }>>(new Map())` inside `<GraphCanvasPane>`. The measurement effect writes every observed rect into this ref BEFORE invoking `applyLayout`. The next memoization tick passes `measurementCacheRef.current` as `LayoutOptions.dimensions`.
- **Re-layout strategy**:
  1. **First paint**: `applyLayout(projected, edges, { cache: positionCacheRef.current })` — no `dimensions` (the map is empty), so dagre uses the constant 288×90 for every node. Identical to today's behavior.
  2. **`useNodesInitialized()` flips to `true`** (i.e. ReactFlow has measured every rendered node): a `useEffect` fires. It:
     - reads every measured `{ width, height }` out of the ReactFlow store (via `getState().nodeInternals`),
     - compares each rect against `measurementCacheRef.current` — if the rect for an id differs from the cached value by ≥ 1 px on either axis, the rect is stored and the id is added to a "changed-ids" set,
     - if the changed-ids set is non-empty, the cached positions for those ids are EVICTED from `positionCacheRef.current` (so the next memoization tick treats them as uncached and re-runs dagre for them),
     - sets a `layoutRevision` state counter (`useState<number>(0)`); incrementing it triggers the next `useMemo` tick.
  3. **Subsequent memoization tick** invokes `applyLayout(projected, edges, { cache: positionCacheRef.current, dimensions: measurementCacheRef.current })`. The non-evicted nodes keep their cached positions; the evicted nodes feed dagre alongside the cached neighbours with their measured rects, producing fresh positions that respect the actual rendered footprint.
  4. **Cache write-back** — same loop as today: every emitted position writes into `positionCacheRef.current`. The measurement cache stays untouched (it's only written by the measurement effect, not by the layout pass).
- **Debounce**: the measurement effect schedules a 75 ms `setTimeout` before applying the evictions + incrementing `layoutRevision`. A new measurement that arrives during the window resets the timer. This absorbs the per-facet / per-decoration measurement aftershocks without firing N intermediate re-layouts on a single content tick. Upper bound on re-layout latency after the last measurement change: ~75 ms (well within the 50–100 ms budget the brief named).
- **`layoutRevision` is added to the `nodes` `useMemo` deps** alongside the existing `[events, diagnosticHighlights, edges]`. Incrementing it invalidates the memo so the next render reads the freshly-evicted cache + freshly-populated measurement map.
- **Mount cleanup**: the debounce timer is cleared on unmount via the standard `useEffect` cleanup function so a route-navigation-mid-debounce does not fire a stale callback on a stale component.

### C. StatementNode wording-display policy — no change

The card already does the right thing. Verified against `apps/moderator/src/graph/StatementNode.tsx:400-405`:

```tsx
<p
  data-testid={`statement-node-wording-${id}`}
  className="text-sm text-slate-900 leading-snug whitespace-pre-line break-words"
>
  {wording}
</p>
```

The wording paragraph carries `whitespace-pre-line break-words` with NO `line-clamp`, NO `max-h-*`, NO `overflow-hidden`, NO `truncate`. The card root carries `max-w-[18rem]` (288 px) which bounds horizontal growth; there is no vertical bound. **The card already shows the full wording, wrapped, grown to whatever height it needs.** What was breaking visually was NOT the card's display policy — it was the layout's constant 90 px height feeding dagre a smaller footprint than the rendered DOM, producing edge crossings when subsequent ranks landed on top of the overflow. This task closes the loop by feeding dagre the actually-rendered footprint.

**Decision: no change to `<StatementNode>`'s display policy.** The "no truncation, full wording, max-width-capped, vertical-grow-to-fit" idiom is already in place; this task is the layout-side completion that makes the existing display contract honest. The popover-truncation question (`mod_edge_popover_full_target_wording`) is now informed by this: the card shows the full wording; the popover question becomes "what does the popover add beyond a card that already shows everything?" — a re-framing this task explicitly enables.

## Why it needs to be done

Two reasons, both load-bearing:

1. **Closes the ADR 0025 Consequences trade-off.** The ADR's `Consequences` section states (excerpt): "Variable card heights overlap in v1. A card with many decoration rows (multiple facet pills + axiom marks + vote indicators) will overflow the constant 90 px slot dagre allocates and visually overlap the row below. Accepted v1 trade-off; the `mod_layout_measured_dimensions` follow-up task lifts the limitation by reading `getBoundingClientRect` after the first render and re-laying out." THIS IS that follow-up task. The trade-off was registered explicitly in the ADR and the predecessor refinement's Status section. Closing it lifts a known quality gap without re-litigating the layout-engine choice itself (dagre stays; only the dimension input changes).

2. **Unlocks the popover-truncation decision downstream (`mod_edge_popover_full_target_wording`).** The sibling tech-debt task is currently registered as "decide whether the hover popover truncates source/target wordings at 60 chars or shows them in full." That decision is materially informed by **how much of the wording the StatementNode card itself shows**. Today the card structurally shows the full wording (no `line-clamp`), but the LAYOUT crashes that growth into the 90 px slot, producing edge crossings — so in practice the moderator can't read the full wording without scrolling around overlapping cards. Once this task ships:
   - The card visibly shows the full wording at the size it actually renders.
   - The layout respects that footprint (no edge crossings, no overlap).
   - The popover's role becomes "show the wording IN ISOLATION for a hovered entity when the canvas is dense" — a different question from "the card truncates, so the popover de-truncates."
   - The sibling refinement can then decide cleanly: keep the 60-char truncation (the popover is a compact summary, the card is the canonical full view) OR drop the truncation (the popover and the card carry the same content). Either answer is defensible; the structural seam this task lands is what makes the question coherent.

   This downstream effect is the user-flagged dependency: the orchestrator pinned `mod_layout_measured_dimensions` as the next task explicitly because it changes the structural axis the popover-truncation decision has to be made against.

3. **Quality compounds for every downstream `mod_capture_flow.*` task.** `mod_capture_flow.mod_draw_edge_flow` will let the moderator drag from a source handle to a target handle to create a new edge; that interaction is materially worse when cards overlap and the moderator can't tell which handle they're hovering. `mod_capture_flow.mod_edit_wording_flow` will let a moderator reword a node; the post-reword measurement WILL change the card's footprint and the layout SHOULD adapt. Both downstream tasks compose more cleanly with a layout that respects rendered dimensions than with one that pretends every card is 90 px tall.

## Inputs / context

Code seams the implementation plugs into:

- `apps/moderator/src/graph/layoutEngine.ts:94-101` — the existing `LayoutOptions` interface. This task adds the `dimensions` field.
- `apps/moderator/src/graph/layoutEngine.ts:124-140` — the `ResolvedOptions` shape + `resolveOptions` helper. The `dimensions` field plumbs through `resolveOptions` unchanged (optional → optional).
- `apps/moderator/src/graph/layoutEngine.ts:154-204` — `runDagre`. The `graph.setNode(node.id, { width, height })` call (line 171) consults `opts.dimensions.get(node.id)` first, falling back to `opts.nodeWidth` / `opts.nodeHeight`. The post-layout translation (lines 198-201) reads the same per-id rect (falling back) when subtracting the half-extents.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:525-548` — the `useMemo` block that invokes `applyLayout`. This task adds the `dimensions: measurementCacheRef.current` option, adds `layoutRevision` to the deps, and adds the `useEffect` that subscribes to ReactFlow's measured-dimensions store + drives the debounced re-layout.
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx:64-135` — the existing `ImmediateResizeObserver` stub + `offsetWidth` / `offsetHeight` / `getBoundingClientRect` overrides. This task's Vitest cases set those stubs to varying values to exercise the measurement-driven re-layout — a measured-100×40 baseline (the existing default), and a measured-200×160 "tall" variant for the per-node case.
- `apps/moderator/src/graph/StatementNode.tsx:259-260` — the `min-w-[12rem] max-w-[18rem]` baseClassName. UNCHANGED by this task. Documented here so the implementer doesn't accidentally widen / cap the card.
- `apps/moderator/src/graph/StatementNode.tsx:400-405` — the wording paragraph. UNCHANGED by this task. The "no truncation, vertical-grow" idiom is the design contract.
- `apps/moderator/src/graph/HoverPopover.tsx:84` — the `truncate()` helper. UNCHANGED by this task; the popover-truncation decision is the sibling task's scope.
- `tests/e2e/moderator-graph-layout.spec.ts:36-280` — the existing layout spec. This task ADDS one new `test()` block: a tall-node fixture + post-measurement non-overlap assertion. The existing 6-node claim/evidence/rebut test stays.
- `tests/e2e/fixtures/wsStoreSeed.ts` — the WS-store seed helper. UNCHANGED — the existing `seedWsStore(...)` call signature already accepts an arbitrary wording string; the tall fixture just supplies a long one.

ReactFlow API reference:

- `useNodesInitialized(options?: UseNodesInitializedOptions): boolean` — re-exported from `reactflow` (verified in `node_modules/@reactflow/core@11.11.4/dist/esm/hooks/useNodesInitialized.d.ts`). Returns `true` once every node's `ResizeObserver` callback has fired and the internal `width` / `height` have been stamped. Re-renders the component when the value changes.
- `useStore<T>(selector: (state: ReactFlowState) => T): T` — re-exported from `reactflow`. The internal `state.nodeInternals` is a `Map<string, Node>`; each `Node` carries `width: number | null` and `height: number | null` post-measurement (verified in `…/types/nodes.d.ts:21-22`).
- Per-id stable selector pattern: subscribe to a numeric "revision counter" derived from a content hash of the measurements rather than to the Map itself, then read the live `nodeInternals` via `useReactFlow().getNodes()` (or `useStore.getState().nodeInternals` if `useStore` exposes `getState`) inside the effect. This avoids per-render Map allocation. (Implementer can choose either path; both compose with `useNodesInitialized` correctly.)

ADRs:

- [ADR 0025 — Graph layout engine: dagre](../../../docs/adr/0025-graph-layout-engine-dagre.md) — pinned the layout library and explicitly named THIS task in the `Consequences` block as the lift for the variable-card-height trade-off. No amendment needed: the architectural choice (dagre) is unchanged; the dimension input plumbing is a refinement-internal mechanical change. (If a future task switched layout libraries, that's a new ADR; this task does not.)
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest or Playwright case.
- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface; `useNodesInitialized` + `useStore` are the canonical extension points the library documents for "I want to know when nodes are measured."
- [ADR 0008 — E2E framework Playwright](../../../docs/adr/0008-e2e-framework-playwright.md) — the e2e layer the tall-node spec runs under.

Refinements consulted for design continuity:

- `tasks/refinements/moderator-ui/mod_layout_engine_choice.md` — predecessor; pinned the position-cache strategy and the constant-dimension trade-off. The Status section explicitly registers this task as the follow-up.
- `tasks/refinements/moderator-ui/mod_node_rendering.md` — pinned `<StatementNode>`'s `min-w-[12rem] max-w-[18rem]` width band and the wording paragraph's `whitespace-pre-line break-words` no-truncation idiom. Reading this confirms the wording display policy decision is "no change."
- `tasks/refinements/moderator-ui/mod_node_handle_rendering.md` — pinned the `Position.Top` / `Position.Bottom` Handle layout matching dagre's `rankdir: 'TB'`. Handles render INSIDE the card's relative-position context but their bounding rect does not extend beyond the card root, so they do not contribute to the measured footprint.
- `tasks/refinements/moderator-ui/mod_hover_details.md` — pinned that the popover is `pointer-events: none` and `position: absolute`, so it does NOT enter the card's box-sizing footprint. Hover events do not interact with the measurement loop.
- `tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md` / `mod_axiom_mark_decoration.md` / `mod_diagnostic_highlighting.md` — each adds a per-node decoration row that contributes to the measured height. Confirms why constant 90 px is wrong for the worst case.

No new ADR is required: this task reuses `@dagrejs/dagre@1.1.4` (already pinned, no API surface change), reuses `reactflow@11.11.4` through its documented hooks, introduces no new dependency, changes no public type signature in a breaking way (the `dimensions` field is optional and additive), and changes no cross-workspace contract.

## Constraints / requirements

### Measurement source

- **Use ReactFlow's internal node measurements via `useStore` + `useNodesInitialized`**, not a per-node `ref` callback and not a direct manual `ResizeObserver` on each rendered card. ReactFlow ALREADY runs the `ResizeObserver` on every node — re-running it would be wasteful and the per-`ref` path would couple the layout engine to the rendered DOM more tightly than necessary. The `useStore` path reads what ReactFlow already measured; the layout engine remains DOM-free and the wiring lives entirely in `<GraphCanvasPane>`.

### First-paint strategy

- **Render with constants on first paint, then re-layout once measurements arrive.** The alternative — render with `opacity-0` until measurements land — was considered and rejected: (a) `opacity-0` would hide the canvas for the duration of one `ResizeObserver` tick (~one frame), which reads as a flash of nothing on a slow render; (b) the constant-dimension first paint is ALREADY a tested, working layout — there's no benefit to hiding it; (c) the re-layout produces a position-change that's visible regardless of opacity, so hiding the first paint just trades one perceived "jump" for one perceived "fade-in." Document the v1 trade-off: on the very first paint of a session with many tall nodes, the moderator may briefly see overlapping cards before the re-layout settles. The 75 ms debounce makes this window short in practice (well under one perceptual "moment").

### Stability under incremental events

- **New nodes use the constant fallback until measured.** When a `node-created` event arrives, `projectNodes` emits the node with `position: { x: 0, y: 0 }` (current behavior); `applyLayout` runs dagre on it with the constant 288×90 because the new id is not yet in `measurementCacheRef.current`. The card renders, ReactFlow's `ResizeObserver` fires, the measurement-effect picks up the new rect, evicts the new node's position from `positionCacheRef.current`, and the next memoization tick re-runs dagre for that node alone (its neighbours stay cached). Existing nodes never move; only the freshly-arrived node settles to its measurement-aware position. This matches the predecessor's "existing nodes never move on incremental events" contract exactly — the position-cache strategy is preserved.
- **Borrowing average sibling measurements** for not-yet-measured nodes is rejected: it adds complexity (which siblings count? what if the new node IS bigger than the average?) for marginal benefit (one re-layout tick is cheap). The constant fallback is simpler and correct.

### Performance

- **75 ms debounce** absorbs measurement aftershocks. Per-facet decoration rows can fire multiple `ResizeObserver` callbacks in sequence as the DOM settles; without debouncing, each callback would trigger a re-layout, producing visible jitter and wasted dagre cycles. The 75 ms window is empirically tight enough to feel responsive (well under one perceptual "moment" of 100–150 ms) and loose enough to coalesce a typical decoration cascade. Document the constant inline.
- **Upper bound on re-layout latency after the last measurement change: 100 ms.** The 75 ms debounce + one React render cycle (~5–15 ms) + one dagre pass on ≤ 100 nodes (~10 ms) sums to well under 100 ms. This budget is the same one ADR 0025 set for the constant-dimension layout pass.
- **No re-layout on equal measurements.** The measurement effect compares each rect against the cached value before evicting; if every rect is within 1 px of the cached value, no eviction fires and no re-layout is triggered. This is the no-op steady-state path — when the canvas has stabilized, the measurement effect is silent.
- **`useStore` selector returns stable references.** The selector should return a numeric revision counter (incremented only when a measurement changes) or a content-stable serialization, not a fresh Map per render. The cheapest correct path: `useStore((s) => s.nodesInitialized ? Array.from(s.nodeInternals.values()).reduce((acc, n) => acc + (n.width ?? 0) * 31 + (n.height ?? 0), 0) : 0)` — a deterministic hash that changes only when measurements change. Implementer chooses the exact hash; the property is "stable across renders unless a measurement changed."

### Cache invalidation on wording change

- **A node whose wording changes (via a future `edit-wording` commit) MAY have a different measured footprint.** The current projection (`projectNodes` in `GraphCanvasPane.tsx`) does NOT yet apply `edit-wording` commits — that's `mod_capture_flow.mod_edit_wording_flow`'s scope. But the measurement loop should be ROBUST to wording changes regardless: when ReactFlow's `ResizeObserver` fires with a new rect for an existing id, the measurement effect compares against the cache, detects the change, evicts the position cache for that id, and triggers a re-layout. This is the same mechanism as the first-measurement path — no special-casing for wording-driven re-measurement.
- **Documented invariant**: the measurement cache is keyed by node id; it lives across the component's lifetime (cleared only on `<GraphCanvasPane>` unmount, same as `positionCacheRef`). It IS NOT cleared on `events` change — measurements are valid across event ticks unless a card's footprint actually changes.

### Composability with the position cache

- **Measurement-driven re-layouts ONLY affect not-yet-stably-measured nodes**, not already-laid-out nodes. The eviction step is the load-bearing piece: when a measurement arrives for an id whose cached rect differs, ONLY that id is evicted from `positionCacheRef`. Every other cached node stays cached. The next `applyLayout` pass re-runs dagre only over the evicted node + its cached neighbours; the neighbours' positions pass through unchanged. This preserves the "existing nodes never move on incremental events" contract from the predecessor — including the case where "incremental event" is broadened to mean "incremental measurement update."
- **Steady-state convergence**: once every node has been measured at its rendered footprint AND every measurement has been written to the cache, no further re-layout fires. The system is stable until either a new node arrives, an existing node's content changes (driving a re-measurement), or `relayoutAll(...)` is invoked.

### Test idiom

- **`ImmediateResizeObserver` + `offsetWidth` / `offsetHeight` / `getBoundingClientRect` stubs** are the established idiom (lifted from `StatementEdge.test.tsx` into `GraphCanvasPane.test.tsx` in commit `bcbe51a` per the `mod_node_handle_rendering` task's status section). New Vitest cases set those stubs to varying values per node — `100 × 40` for baseline nodes and `200 × 160` for the tall variant — to exercise the per-node measurement path. The `ImmediateResizeObserver` fires synchronously on `observe()`, so the measurement effect's `setTimeout(75)` is the only thing standing between the stub and the re-layout — the test uses `vi.useFakeTimers()` + `vi.advanceTimersByTime(80)` to fast-forward the debounce.

### Composability — diagnostic halo, hover popover, decorations

- **Diagnostic halo.** The amber ring is a CSS `box-shadow` outside the card's box-sizing border; it does NOT extend the measured `getBoundingClientRect` of the card root. Verified against `StatementNode.tsx:290-295` (Tailwind's `ring-*` utilities are box-shadow-based). The measured rect is the card body alone; the halo's pulse doesn't trigger measurement events. Safe.
- **Hover popover.** `position: absolute; bottom: calc(100% + 4px); pointer-events: none;` — the popover sits ABOVE the card and is removed from the layout flow. It does not contribute to the card's measured footprint. Hovering does not trigger a measurement event (hover state is a `useState` boolean that drives a child render; it doesn't change the card root's geometry). Safe.
- **Per-facet pill row, axiom-mark row, annotation row, kind label.** All render INSIDE the card body, contributing to the measured height naturally. This is the whole point of the task — these are what break the constant-90 px assumption.
- **Meta-disagreement split-render.** `border-double` + `ring-2 ring-violet-400` — the double-border is inside the card's box-sizing border slot (Tailwind defaults to `box-sizing: border-box`), and the violet ring is the same `box-shadow` idiom as the halo. Neither extends the measured rect. Same constant width applies as for any other node.
- **`mod_handle_rendering`'s `<Handle>` elements.** They render as absolute-positioned children inside the card root. ReactFlow's CSS pins them on the card's perimeter — their bounding rect is INSIDE the card's bounding rect. They do not contribute to the measured footprint.

### Build / type / test gates

- `pnpm run check` clean.
- `pnpm run test:smoke` green (test count rises by the new Vitest cases — ≈ 6-8 new cases).
- `pnpm -F @a-conversa/moderator build` succeeds (no bundle-size change — the new code is a few hundred bytes of `useEffect` + `useRef` + selector logic; no new dependency).
- `pnpm exec playwright test --project chromium-moderator-layout` green against a freshly brought-up dev compose stack — including the new tall-node test.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_layout_measured_dimensions` plus a `note "Refinement: tasks/refinements/moderator-ui/mod_layout_measured_dimensions.md"` line.

### UI-stream e2e scoping (per ORCHESTRATOR.md commit `28a71f9`)

The new tall-node assertion lands in `tests/e2e/moderator-graph-layout.spec.ts` as an additional `test()` block within the existing `chromium-moderator-layout` project, not as a new spec file. Rationale:
- The setup overlap with the existing 6-node test is total: `loginAs` → POST `/sessions` → goto operate → seed via `wsStoreSeed`. Splitting would duplicate the boilerplate.
- The assertion is a sibling of the existing non-overlap assertion — same axis, broader coverage. It belongs in the same spec for the same reason all "layout produces non-overlap" assertions belong together.
- A new spec file with its own project would double the wall-clock cost of the layout e2e suite for marginal isolation benefit.

The new test seeds a fixture containing at least one node whose forced height is ≥ 140 px (a long wording paragraph + multiple facet pills + an axiom-mark line). The pre-existing 6-node test asserts non-overlap for the baseline measured-footprint case; the new test asserts the same contract holds for a tall-node case where the constant-90 px would have produced overlap.

## Acceptance criteria

- `apps/moderator/src/graph/layoutEngine.ts`'s `LayoutOptions` interface carries the new `dimensions?: ReadonlyMap<string, { readonly width: number; readonly height: number }>` field; `runDagre` consults it per-node with a fallback to `nodeWidth` / `nodeHeight`; `applyLayout` and `relayoutAll` plumb it through unchanged. The 20 pre-existing Vitest cases in `layoutEngine.test.ts` continue to pass with no edits (additive change only).
- New `apps/moderator/src/graph/layoutEngine.test.ts` cases (≥ 4 new):
  1. `applyLayout` with `dimensions: new Map([['n1', { width: 400, height: 200 }]])` and the same node + edges as the baseline TB-direction case: dagre's emitted position for `n1` reflects the larger footprint (the geometric-center-to-top-left translation subtracts 200 / 100 instead of 144 / 45).
  2. `applyLayout` with a `dimensions` map populated for some but not all nodes: the missing ids fall back to `DEFAULT_LAYOUT_OPTIONS.nodeWidth` / `nodeHeight`. Non-overlap holds across the mixed-dimension input.
  3. `relayoutAll` with `dimensions` populated for every id: every node's position respects its custom footprint; non-overlap holds.
  4. `applyLayout` with an EMPTY `dimensions` map (i.e. `new Map()`): behaves identically to omitting the field (proves `dimensions: new Map()` is not a footgun).
- New `apps/moderator/src/graph/GraphCanvasPane.test.tsx` cases (≥ 2 new):
  1. **First-paint → re-measure flow**: seed two `node-created` events; on first render, the canvas mounts with cards at constant-288×90-driven positions. Override `offsetWidth` / `offsetHeight` / `getBoundingClientRect` to return a tall (200×160) rect for one node; flush the `ImmediateResizeObserver` (synchronous on `observe()`); advance fake timers by 80 ms (past the 75 ms debounce); re-render; assert the tall node's `position` differs from the first-paint position by ≥ the half-height delta (160/2 - 90/2 = 35 px on the y axis). Assert the OTHER node's position is unchanged (existing-nodes-don't-move contract).
  2. **No re-layout when measurements match the constants**: seed two `node-created` events; leave the stub at the default 100×40; render; advance timers by 80 ms; assert no additional render passed through `applyLayout` beyond the first paint (assert via spying on a `layoutInvocationCount` ref or via the position-stable assertion: `nodes[0].position` is the SAME object reference as the first-render emission). The steady-state silence is the load-bearing pin.
- New `tests/e2e/moderator-graph-layout.spec.ts` test block — "tall node fixture, non-overlap holds after measured re-layout":
  - Seed a 3-node fixture: one tall node (wording ≥ 200 chars + facet statuses on all three facets, forcing ≥ 140 px rendered height) and two baseline nodes connected by edges to it.
  - Wait for `useNodesInitialized` (proxied by polling for `data-testid="statement-node-<id>"` `getBoundingClientRect().height >= 140` on the tall node).
  - Wait an additional 200 ms (covers the 75 ms debounce + render cycle, generous safety margin under headed-browser conditions).
  - Read every card's rect via `page.evaluate(...)`; assert non-overlap holds across every unordered pair (reuses the existing `overlap()` helper).
  - Assert TB direction holds for every seeded edge (existing assertion shape).
- All pre-existing Playwright tests in `moderator-graph-layout.spec.ts`, `moderator-hover-details.spec.ts`, and `auth-flow.spec.ts` continue to pass.
- `pnpm run check` clean. `pnpm run test:smoke` green (count rises). `pnpm -F @a-conversa/moderator build` succeeds. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_layout_measured_dimensions` plus the refinement-note line.
- No new ADR is created. No new i18n catalog key is added.

## Decisions

- **Measurement source: ReactFlow internal store (`useStore` + `useNodesInitialized`), NOT manual `ref` callbacks or a parallel `ResizeObserver`.** Four candidates considered:
  1. *Per-card `ref` callback measuring `getBoundingClientRect()` on mount* — adds a wiring layer to `<StatementNode>` (a `ref` prop the layout passes through), couples the layout engine to the rendered DOM more tightly than necessary, and reproduces what ReactFlow already does. Rejected.
  2. *A new `ResizeObserver` instantiated in `<GraphCanvasPane>` and attached to every node DOM element via `useEffect`* — doubles the observer count (ReactFlow already runs one per node), and the DOM-traversal logic to find each node element is brittle. Rejected.
  3. *`useReactFlow().getNodes()` polled on a `setInterval`* — wrong tool; polling for a measurement that's available via subscription is wasteful and adds latency. Rejected.
  4. *`useStore((s) => measurement-revision-hash) + useNodesInitialized()`* — reads what ReactFlow already measured, gated on the canonical "all measured" signal, no DOM coupling. **Chosen.**
- **First-paint strategy: render with constants, then re-layout on measurement.** Two alternatives considered:
  1. *Render with `opacity-0` until measurements arrive* — hides the canvas for ~1 frame; reads as a flash; doesn't actually prevent the position change, just hides it. Rejected as a non-improvement.
  2. *Render with constants + re-layout on measurement* — the canvas is visible immediately; the re-layout produces one position adjustment per node within ~75 ms; users see a brief settling animation (or no visible motion if the measured rect matches the constants). **Chosen.** Lower complexity, no perceived blank period, and the brief settling is bounded by the debounce.
- **StatementNode wording display policy: no change (full wording, no truncation, vertical-grow-to-fit).** Three alternatives considered against the existing `whitespace-pre-line break-words` + `max-w-[18rem]` + no-height-cap idiom:
  1. *Keep existing behavior* — the card already shows the full wording wrapped to whatever height it needs. The constant-90 px slot was the dagre INPUT, not a display cap. **Chosen.** Aligns with the data already in `<StatementNode>` (verified — no `line-clamp`, no `max-h`, no `truncate`); the layout side was the only thing producing visual breakage.
  2. *Add a line-clamp cap of N lines + the popover de-truncates* — re-introduces truncation the card structurally never had, adds a display-policy decision that should be made in concert with the popover-truncation decision (sibling task), and defeats the purpose of measured dimensions (if the card is line-clamped, dagre doesn't need to measure anything). Rejected.
  3. *Drop `max-w-[18rem]` entirely and let cards grow horizontally too* — would interact badly with dagre's horizontal layout pass (rank-sibling spacing); the horizontal axis is already well-handled by the 288 px constant from the predecessor refinement. Rejected as scope creep.
- **Debounce window: 75 ms.** Two alternatives considered:
  1. *No debounce* — every `ResizeObserver` callback triggers a re-layout; per-decoration cascades produce visible jitter. Rejected.
  2. *50–100 ms* — the brief named this range. 75 ms is the midpoint; tight enough to feel responsive (under one perceptual "moment"), loose enough to coalesce a typical decoration cascade. **Chosen.** Round number, easy to read in the source, no tuning needed for v1.
- **Cache invalidation: per-id eviction on measurement change, not a full cache clear.** Three alternatives considered:
  1. *Full cache clear* — every measurement change rebuilds every position; existing nodes move, breaking the predecessor's "existing nodes never move" contract. Rejected.
  2. *Per-id eviction* — only the changed id is evicted; the next `applyLayout` runs dagre over the evicted id alongside the cached neighbours; existing positions pass through. **Chosen.** Preserves the predecessor's stability contract for the broader "incremental update" definition.
  3. *No invalidation; live with stale positions* — defeats the purpose. Rejected.
- **Re-layout trigger: `useEffect` watching the measurement-revision-hash from `useStore` plus `useNodesInitialized()`, NOT a direct `useMemo` dep on the measurement map.** A `useMemo` dep on the map would tie measurement reads to the same `useMemo` that runs `applyLayout`; the measurement effect path is cleaner because it can debounce, evict the position cache, and increment a separate revision counter to drive the next `useMemo` tick. Separation of concerns: measurement reads vs. layout invocations.
- **E2e spec placement: extend `moderator-graph-layout.spec.ts`, do NOT create a new spec.** The setup overlap is total (same loginAs, same session creation, same seed helper); the assertion is a sibling of the existing non-overlap assertion; a separate spec would duplicate boilerplate for marginal isolation benefit. **Chosen.** Documented as the cleaner-than-splitting path in the Constraints section.
- **Per-node `LayoutOptions.dimensions` is a `ReadonlyMap`, not an object literal `Record<string, …>` or an array.** `Map.get(id)` is O(1) by spec; object lookup is also O(1) but has the inherited-property footgun (`hasOwnProperty` defenses). The pre-existing `cache` option is already a `ReadonlyMap<string, XYPosition>`; the new field matches that shape exactly for symmetry. **Chosen.**
- **No new dependency.** ReactFlow + dagre + the platform `ResizeObserver` (already used by ReactFlow internally) cover the entire surface. Adding any library here (e.g. `lodash.debounce`, a manual `react-use-resize-observer`, an animation library for the re-layout transition) would be ADR-worthy per the ORCHESTRATOR.md graph-rendering-dependency policy and is rejected.
- **No new ADR.** This task lifts a trade-off documented in ADR 0025's `Consequences` section through additive plumbing — the architectural choice (dagre, position-cache, top-down) is unchanged. The `LayoutOptions.dimensions` field is a refinement-internal API expansion. (If a future task introduced a new layout LIBRARY, that would be ADR-worthy; per-node dimensions through the existing library is not.)
- **No new i18n catalog key.** The task changes no rendered text. Catalog parity tests stay green without edits.
- **Re-layout transition: no animation.** The re-layout produces an immediate position change. Animating the transition would require either a Tailwind-based CSS transition on `Node` positions (which ReactFlow's transform-based positioning doesn't naturally support) or a `react-spring`-style library (ADR-worthy, rejected). The instant snap is the same behavior the predecessor accepted for `relayoutAll(...)`; the same trade-off applies here. If "the post-measurement settling feels abrupt" turns out to be a real complaint after this task lands, a follow-up task can introduce a CSS transition on `Node.position` (no new dependency, just a Tailwind utility) — out of scope for v1.

## Open questions

(none — all decided)

## Status

Done — 2026-05-15.

- `LayoutOptions.dimensions: ReadonlyMap<string, { width: number; height: number }>` plumbed through `resolveOptions` and `runDagre` in `apps/moderator/src/graph/layoutEngine.ts` — per-id `setNode` rect lookup with fallback to the `nodeWidth` / `nodeHeight` constants; the post-layout geometric-center-to-top-left translation reads the same per-id rect (with the same fallback) when subtracting the half-extents. `applyLayout` and `relayoutAll` forward the field unchanged. No public-API breakage: existing call-sites that omit `dimensions` get the same behavior as before. Vitest coverage extended by 4 cases in `apps/moderator/src/graph/layoutEngine.test.ts` (per-id rect plumbing; partial-map fallback to constants; `relayoutAll` with dimensions; empty-map equivalence to omit).
- `<GraphCanvasPane>` (in `apps/moderator/src/graph/GraphCanvasPane.tsx`) now wraps its body in `<ReactFlowProvider>` and subscribes to ReactFlow's internal measurement store via `useStore(selectMeasurementRevision)` + `useNodesInitialized()` + `useStoreApi()`. A new `measurementCacheRef` accumulates the per-id `{ width, height }` rects ReactFlow stamps via its `ResizeObserver`; a 75 ms debounced `useEffect` commits pending measurements, evicts only the per-id entries in the position cache whose measurement materially changed from the constant, bumps a `layoutRevision` state counter, and triggers the next memoization tick — the next `applyLayout` invocation passes `dimensions: measurementCacheRef.current`. Existing nodes never move on incremental events. Vitest coverage extended by 2 cases in `apps/moderator/src/graph/GraphCanvasPane.test.tsx` (first-paint → re-measure flow with a tall A node moving while a baseline node stays put; steady-state silence when measurements match the constants).
- First-paint flow lands as decided: constants 288×90 render → ReactFlow's `ResizeObserver` measures every card → the 75 ms debounce coalesces the measurement aftershocks → one re-layout pass with measured dimensions. No flicker is visible in practice; the Vitest steady-state assertion pins that no re-layout fires when measurements match the constants.
- StatementNode wording-display policy unchanged — verified in implementation that `<StatementNode>` was already showing the full wording (`whitespace-pre-line break-words` + `max-w-[18rem]`, no `truncate` / `line-clamp` / `max-h` / `overflow-hidden`). The constant 90 px was a dagre-input bug, not a display cap. This reframes the still-open `mod_edge_popover_full_target_wording` decision: the card already shows everything, so the popover-truncation question shifts from "should we truncate?" to "what does the popover add beyond a card that already shows everything?" — a materially better-informed framing for the sibling refinement.
- New Playwright test in `tests/e2e/moderator-graph-layout.spec.ts` ("tall node fixture: non-overlap holds after measured re-layout") seeds a 3-node fixture with one ≥ 140 px tall node (long wording driving the height) and asserts pairwise non-overlap plus TB direction after the 75 ms debounce window. The existing 6-node test gets the same debounce wait. Both pass (2/2 in the `chromium-moderator-layout` project). Regression sweeps clean: `moderator-hover-details` (1/1), `auth-flow` (4/4).
- Closes the ADR 0025 "Consequences" constant-90-vs-measured trade-off explicitly named in commit `4666b4c`-era predecessor (`mod_layout_engine_choice`). The architectural choice (dagre, position-cache, top-down) is unchanged; only the dimension input to dagre is now measurement-driven. No new ADR. No new i18n catalog key. No new dependency. `mod_layout_tidy_action` and `mod_edge_popover_full_target_wording` now compose more naturally with this seam.
- Verification: `pnpm run check` green; `pnpm run test:smoke` 2504 passing (was 2498; +6); moderator workspace 632/632; Playwright `moderator-graph-layout` 2/2; `moderator-hover-details` 1/1; `auth-flow` 4/4; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
