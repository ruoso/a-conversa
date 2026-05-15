# Moderator node Handle rendering (ReactFlow source/target Handles on StatementNode for edge anchoring)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_node_handle_rendering` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) (search the leaf `task mod_node_handle_rendering` inside `task mod_graph_rendering`).

**Effort estimate**: 0.5d (confirmed). The implementation is a two-line JSX addition to `<StatementNode>` (a source `<Handle>` plus a target `<Handle>`), a small Vitest extension proving the handles are in the DOM, and the lift of one already-written Playwright assertion from conditional to hard. No new dependency, no new catalog key, no new positioning logic, no new ADR.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their contracts):

- `moderator_ui.mod_graph_rendering.mod_node_rendering` (done — `<StatementNode>` at `apps/moderator/src/graph/StatementNode.tsx` is the custom ReactFlow node card; its root carries `data-testid="statement-node-<id>"`, `tabIndex={0}`, the per-status className stack, the diagnostic-halo ring, the hover popover trigger, the per-facet pill row, the axiom-mark badge row, and the annotation badge row. This task adds two child elements — a source `<Handle>` and a target `<Handle>` — to that same component without changing any of the existing seams).
- `moderator_ui.mod_graph_rendering.mod_edge_rendering` (done — `<StatementEdge>` at `apps/moderator/src/graph/StatementEdge.tsx` is the custom ReactFlow edge; `selectEdgesForSession` populates `source` / `target` / `type: 'statement'` on every emitted edge. ReactFlow renders an edge's `<BaseEdge>` `<path>` only once it can resolve the source/target handle anchor coordinates — which is exactly what this task unlocks).
- `moderator_ui.mod_graph_rendering.mod_layout_engine_choice` (done — [ADR 0025](../../../docs/adr/0025-graph-layout-engine-dagre.md) pinned `rankdir: 'TB'` as the default layout direction. In a TB layout, edges flow top-to-bottom: a node's outgoing edge originates from its bottom edge, an incoming edge terminates at its top edge. This task places the source handle at `Position.Bottom` and the target handle at `Position.Top` to match — anchor positions follow the layout direction).
- `moderator_ui.mod_graph_rendering.mod_diagnostic_highlighting` (done — composes a `ring-4` amber halo around the card root. Handles render as small ReactFlow-default circles centered on the card edge; they sit on the rounded-rectangle perimeter, NOT inside the halo's outer offset zone — the halo is a CSS `box-shadow` outside the border, the handles are inline DOM children inside it. This task verifies the two compose visually under a Vitest case).
- `moderator_ui.mod_graph_rendering.mod_hover_details` (done — established the `<HoverPopover>` rendered as the last child of the card root with `position: absolute; bottom: calc(100% + 4px)`. The popover sits above the card; handles sit on the card's top + bottom edges. No conflict — the popover anchors to the card root's relative-positioning context regardless of what additional children render inside).
- `moderator_ui.mod_graph_rendering.mod_per_facet_state_visualization` / `mod_axiom_mark_decoration` / `mod_annotation_rendering` / `mod_proposed_state_styling` / `mod_agreed_state_styling` / `mod_disputed_state_styling` / `mod_meta_disagreement_split_render` / `mod_selection` / `mod_vote_indicators_on_graph` (all done — every existing styling layer renders inside the card's existing DOM structure. Handles are tiny circles on the card's outer perimeter; they don't visually interfere with any decoration that lives inside the card body, including the violet `border-double` of meta-disagreement nodes).
- `foundation.stack_decisions.graph_lib_decision` (done — [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) pinned ReactFlow on the moderator surface; `<Handle>` is the canonical extension point ReactFlow provides for custom-node-to-edge anchoring. No new dependency).

Pending edges (this task does NOT depend on them):

- `moderator_ui.mod_graph_rendering.mod_pan_zoom` — orthogonal (pan/zoom polish on whatever positions the layout emits; doesn't read handle anchors).
- `moderator_ui.mod_capture_flow.mod_draw_edge_flow` — future consumer (drag-from-handle-to-handle to create a new edge is a downstream interaction; this task lands the static handle anchors that flow will eventually drive).

## What this task is

Concrete, mechanical work:

- **Add `<Handle>` elements to `<StatementNode>`.** Import `Handle` and `Position` from `reactflow` (the package is already pinned at `11.11.4` in `apps/moderator/package.json`; `Handle` and `Position` re-export through `reactflow` from `@reactflow/core` — verified via `node_modules/.pnpm/@reactflow+core@11.11.4/.../dist/esm/index.d.ts`). Inside the root `<div>` of `<StatementNode>`, render two `<Handle>` elements as the FIRST children (before the facet-pill row, the wording paragraph, the kind label, the axiom-mark / annotation rows, and the hover popover):
  - `<Handle type="target" position={Position.Top} />` — the incoming-edge anchor at the top of the card. Edges whose `target` is this node terminate here.
  - `<Handle type="source" position={Position.Bottom} />` — the outgoing-edge anchor at the bottom of the card. Edges whose `source` is this node originate here.
- **Use ReactFlow's default Handle visibility.** The library renders a 6-px-radius circle by default; it sits on the card's edge (the card root's `position: relative` context — already established by the hover popover — is the anchor parent ReactFlow's internal CSS targets). No `style` override, no custom className, no opacity tweak. The visual is subtle and consistent with the rest of the ReactFlow surface; if a future visual-design pass wants the handles invisible, that's a CSS-only follow-up.
- **Lift `tests/e2e/moderator-hover-details.spec.ts` Test 4 from conditional to hard.** The current spec (committed in `b7ac2d5`) ends Test 4 with the early-return / `if (await edgeLabel.count() === 0) return;` pattern documented in lines 161–189 of the spec. With handles on the node, ReactFlow now stamps the `.react-flow__edge` SVG path in a real browser, the edge-label DOM lands, and the hover assertions can run unconditionally. Drop the conditional; assert hard that:
  1. `[data-testid="graph-edge-label-${EDGE_ID}"]` is visible after the canvas renders.
  2. Hovering it surfaces `[data-testid="hover-popover-${EDGE_ID}"]`.
  3. The popover carries `data-hover-target-kind="edge"`.
  4. The popover text contains the localized role label (`"Supports"` in en-US) AND the target wording.
- **Verify ReactFlow does NOT log an "edge has no source/target handle" warning.** Today the canvas mounts edges whose endpoints have no handle — ReactFlow silently skips rendering the `<path>` and logs a console warning. Once handles land the warning should stop. Not a hard test assertion (capturing console warnings in Playwright is fragile across runs); flagged here so the implementer notices the warning's absence as a sanity check.

This task is rendering only. It does NOT add the drag-from-handle-to-handle interaction (`mod_draw_edge_flow` owns that; the handles are usable as edge-creation targets via ReactFlow's defaults but no new gesture is wired here), does NOT add multiple handles per side, does NOT introduce per-role handle anchors, does NOT change any existing styling layer, does NOT touch `<StatementEdge>`, does NOT touch `selectEdgesForSession` or `projectNodes`.

## Why it needs to be done

This task closes the deferred-e2e debt registered by `mod_hover_details`'s Closer (commit `b7ac2d5`) and formalized by the tech-debt registration policy (commit `b7c5ff0`). The debt is concrete and singular: **Test 4 of `tests/e2e/moderator-hover-details.spec.ts` is currently a conditional / soft assertion** because `.react-flow__edge` does not render in a real browser when `<StatementNode>` lacks source/target `<Handle>` elements.

ReactFlow's edge-rendering pipeline computes each edge's endpoint coordinates by reading the source and target nodes' Handle anchor positions (via the library's internal `nodeInternals.get(nodeId).handleBounds.source[i]` lookup). Without any `<Handle>` element on the custom node, `handleBounds` stays `null`, the edge's source/target coordinates can't be resolved, ReactFlow logs an "edge has no source handle" warning, and the `<path>` is never appended to the SVG layer. The selector projection (`selectEdgesForSession`) emits the edge correctly; the WS store carries it; the moderator's `<StatementEdge>` component WOULD render the role label and the bezier path if it ran — but ReactFlow's renderer never invokes it because the edge has no resolvable geometry.

The component-level Vitest cases (`StatementEdge.test.tsx` mounts a real `<ReactFlow>` with pre-measured nodes and an `ImmediateResizeObserver` stub — see lines 179–237 of `StatementEdge.test.tsx`) fully cover the edge popover content + wiring under happy-dom because they fake the dimensions ReactFlow needs. The Playwright spec under a real chromium browser does NOT have that stub; it relies on actual layout math, which fails without handles.

Picking this task now closes existing debt — the highest-priority heuristic under the orchestrator's pick rule (committed `6e2af91`). The fix is 4 lines of code; the dividend is the e2e proof that hover-on-edge surfaces the popover in a real browser, the visible-edge-path baseline that downstream tasks (`mod_pan_zoom` polish, `mod_draw_edge_flow`, any future visual-regression layer for edges) can build on, and the cleaner ReactFlow console (no more "edge has no source handle" warnings on every mount).

## Inputs / context

Code seams the implementation plugs into:

- `apps/moderator/src/graph/StatementNode.tsx:41-43` — the existing `import { useState, type ReactElement } from 'react'; ... import type { NodeProps } from 'reactflow';` block. This task widens the `reactflow` import to `import { Handle, Position, type NodeProps } from 'reactflow';`.
- `apps/moderator/src/graph/StatementNode.tsx:348-358` — the root `<div data-testid="statement-node-${id}" ...>` opening tag. The two `<Handle>` elements render as the first children inside this `<div>`, before the facet-pill row at line 359. The existing `relative` Tailwind class on `cardClassName` (line 296) is already the relative-positioning context ReactFlow's Handle CSS expects.
- `apps/moderator/src/graph/StatementNode.tsx:405` — the `{isHovered ? <HoverPopover id={id} target={{ kind: 'node', data }} /> : null}` line. Stays as the LAST child of the card root; handles are siblings rendered FIRST so they don't visually push the popover off its anchor.
- `apps/moderator/src/graph/StatementNode.test.tsx:27-31` — the existing Vitest imports. This task adds two cases to the file asserting the handles render and carry the expected `position` prop (asserted via the DOM `.react-flow__handle-top` / `.react-flow__handle-bottom` class selectors ReactFlow stamps, or via the `data-handlepos="top" | "bottom"` attribute the library sets — verify whichever is more stable under happy-dom; the `data-handlepos` route is the library's documented seam).
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx:405-446` — the existing `describe('GraphCanvasPane — store-derived edges (mod_edge_rendering)')` block whose comments at lines 405–416 explicitly forward-reference this task ("The visible `.react-flow__edge` DOM only appears once `mod_node_rendering`'s `StatementNode` exposes ReactFlow `<Handle>` elements (a sibling concern that's not in this task's scope per the refinement)"). This task adds one Vitest case to that file asserting `.react-flow__edge` paths now render for each seeded edge under happy-dom (the existing `ResizeObserver` + dimension stubs make this possible).
- `tests/e2e/moderator-hover-details.spec.ts:161-189` — the conditional Test 4 block. This task rewrites lines 176–189 to drop the `edgeLabelCount > 0 ?` guard and assert the edge-label visibility + popover content as hard expectations. The hover-leave / click-through tests above (lines 145–159) are unchanged.

ReactFlow API reference:

- `Handle` is re-exported from `reactflow` (`apps/moderator/package.json` pins `reactflow@11.11.4`). It comes from `@reactflow/core`'s `index.d.ts:2` (`export { default as Handle } from './components/Handle';`). The component's props: `type: 'source' | 'target'`, `position: Position` (the `Position` enum exports `Top | Right | Bottom | Left`), plus optional `id` (for multi-handle nodes — not needed here), `isConnectable`, `style`, `className`. Default visual: a 6-px-radius circle centered on the card edge at the specified `Position`.
- `Position` is re-exported from `reactflow`. Enum values: `Position.Top`, `Position.Right`, `Position.Bottom`, `Position.Left`. Stringly the values are `'top' | 'right' | 'bottom' | 'left'` (the library stamps `data-handlepos="top"` etc. on the rendered DOM).

ADRs:

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — pinned ReactFlow on the moderator surface and identified custom node components + Handle anchors as the canonical extension points for edge anchoring. No amendment needed: this task uses the already-pinned dependency through its already-documented API.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case (or, here, a hardened Playwright assertion).
- [ADR 0025 — Graph layout engine: dagre](../../../docs/adr/0025-graph-layout-engine-dagre.md) — pinned `rankdir: 'TB'` (top-to-bottom). The handle placement (source bottom, target top) matches that layout direction so edges flow naturally between cards.

Refinements consulted for design continuity:

- `tasks/refinements/moderator-ui/mod_node_rendering.md` — the `<StatementNode>` baseline that this task extends.
- `tasks/refinements/moderator-ui/mod_edge_rendering.md` — established that `<StatementEdge>` projection is the load-bearing surface and that visible-edge-in-browser ties up "once the node task wires `<Handle>` elements on `<StatementNode>` (a separate refinement)". This IS that separate refinement.
- `tasks/refinements/moderator-ui/mod_hover_details.md` — the Status block names "deferred-e2e debt" on Test 4 specifically and forward-references this task by name (`mod_node_handle_rendering`).
- `tasks/refinements/moderator-ui/mod_layout_engine_choice.md` — pinned `rankdir: 'TB'` and confirmed dagre's TB-layout produces source-on-top / target-underneath placement, which dictates source handle at bottom, target handle at top.
- `tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md` — the amber-halo ring that handles must not visually conflict with.

No new ADR is required: the task reuses `reactflow` (already pinned), uses the library's canonical extension API, introduces no new visual idiom (ReactFlow defaults), and changes no cross-workspace contract.

## Constraints / requirements

### Handle placement

- **Two `<Handle>` elements**, both rendered as direct children inside the existing root `<div data-testid="statement-node-${id}">` of `<StatementNode>`. Rendered FIRST (before the existing pill row / wording / kind / decoration / popover children) so React keeps them stable across the rest of the card's content tree.
  - `<Handle type="target" position={Position.Top} />` — incoming-edge anchor. Lands at the horizontal center of the card's top border.
  - `<Handle type="source" position={Position.Bottom} />` — outgoing-edge anchor. Lands at the horizontal center of the card's bottom border.
- **No `id` prop on either handle.** A single source + single target node has no need for the multi-handle disambiguation `id` enables. ReactFlow defaults the handle's identity to `null` when omitted; the edge selector emits edges without `sourceHandle` / `targetHandle` (which is already the case — see `selectEdgesForSession` at `apps/moderator/src/graph/selectors.ts`), and ReactFlow matches `null`-handle edges to `null`-id handles by convention. Defaulting to `null` keeps the surface area minimal.
- **No `style` override on either handle.** The library renders a 6-px-radius circle by default; that visual is subtle and consistent with the rest of the ReactFlow surface. Adding a custom style here would scope-creep into the visual-design pass.
- **Match dagre's `rankdir: 'TB'` direction.** In TB, edges flow top-to-bottom — the parent node sits above the child, the outgoing-edge anchor is at the bottom of the parent, the incoming-edge anchor is at the top of the child. This task pins that mapping. If a future task changes the default `rankdir` (e.g. to `LR` for a horizontal layout), the handles will need a parallel update (source → `Position.Right`, target → `Position.Left`). Documented inline in the `<StatementNode>` JSDoc with a forward reference.

### Don't break existing layers

- **Diagnostic-halo ring.** The amber ring (`ring-4 ring-amber-500/80 ring-offset-2 ring-offset-white motion-safe:animate-pulse` for blocking; `ring-2 ring-amber-300/70 ring-offset-1 ring-offset-white` for advisory) is a CSS `box-shadow` rendered OUTSIDE the card's border. Handles render as inline DOM children inside the card's `position: relative` context, on the card's border perimeter. The ring's offset gap creates visual separation between the ring and the card body; the handles sit on the body edge, inside that gap. The two compose without overlap. Vitest case (under the diagnostic-highlight describe block) verifies that a haloed node still renders both handles.
- **Hover popover.** The popover renders as the LAST child of the card root with `position: absolute; bottom: calc(100% + 4px)` — anchored above the card. The target handle (`Position.Top`) sits on the top border of the card. The popover's `bottom: calc(100% + 4px)` puts its bottom edge 4 px above the card's top — there's a 4-px gap between the popover's bottom and the handle. No visual conflict. Vitest case verifies the popover continues to render in the right place when handles are present.
- **Per-facet pill row, axiom-mark badges, annotation badges, kind label, wording paragraph.** All render inside the card body, below the top border. Handles sit on the border perimeter, not inside the body. No DOM-tree interference.
- **Selection ring, status ring (rose / violet), `<HoverPopover>`'s `aria-describedby` linkage.** Unchanged. Handles add their own DOM elements with their own ReactFlow-generated classNames; nothing in the existing className composition reads from them.
- **`data-testid`, `data-facet-status`, `data-selected`, `data-diagnostic-severity`, `aria-describedby`, `tabIndex` on the card root.** All unchanged. Handles are children of the card root, not modifications of its attributes.

### a11y

- **Handles are not focusable by default.** ReactFlow's `Handle` component renders without `tabIndex`, so keyboard Tab navigation skips them. They're edge anchors, not interactive elements in the same sense as the card itself. Screen readers don't announce them as buttons (no `role`, no `aria-label`, no inherent semantic role).
- **`tabIndex={0}` on the card root stays.** The card itself is the focusable interactive surface (focus is what opens the hover popover via the keyboard path); the handles don't compete for the focus slot.
- **No `aria-hidden` on handles needed.** The library renders them as small `<div>` elements with no text content and no `role`; assistive technologies traverse them silently. Adding `aria-hidden="true"` is a defensible defensive measure but not load-bearing for v1.

### Visual style

- **Subtle / ReactFlow default.** The library's default handle visual is a 6-px-radius white circle with a 1-px grey border, centered on the card edge. The Tailwind palette doesn't reach into ReactFlow's internal handle CSS; restyling would require either inline `style` props on each handle or a `className` override + a Tailwind utility per handle. Out of scope: this task ships the default and accepts that the per-facet visual-design pass (if any future task explicitly takes that scope) can re-skin handles consistently with the rest of the surface.
- **Opacity 0 on idle is acceptable but NOT done in this task.** ReactFlow's default `opacity: 1` is fine for v1; if "visible handles distract from the card content" comes up as real feedback, a follow-up task can add `style={{ opacity: 0 }}` (handles still need to exist for the edge-anchor math; only the rendered circle would be invisible). Scope creep avoided.

### Component test idiom

- **Match sibling moderator tests.** `StatementNode.test.tsx` uses `makeNodeProps` to synthesize `NodeProps<StatementNodeData>` and renders the component via `@testing-library/react`'s `render(<StatementNode {...props} />)` without a `<ReactFlowProvider>` wrapper. The Handle component reads from ReactFlow's internal store via `useStore` when computing some hover / dragging interactivity, but its base render is functional under the bare React tree — the `data-handlepos` attribute and the per-position class names are stamped from props alone, which is what tests assert on. If a Handle-related test ends up needing the provider, wrap the render in `<ReactFlowProvider>` for that specific case (the pattern is already used in `StatementEdge.test.tsx`).
- **No new dependency.** ReactFlow is pinned at `11.11.4` in `apps/moderator/package.json`. The `Handle` and `Position` exports come through the existing package.

### Meta-disagreement split-render compatibility

- A meta-disagreement-state node renders `border-double border-violet-600 ring-2 ring-violet-400 opacity-100` (per `mod_meta_disagreement_split_render`). The `border-double` is two thin parallel lines drawn inside the card's `box-sizing: border-box` border slot — the rendered footprint matches a single-bordered card. Handles anchor on the card's outer border perimeter, which is the outer line of the double-border. They sit on the visual edge regardless of which border style is active.
- The conceptual question: should a meta-disagreement-split node have MULTIPLE source / target handles (one per "side" of the split decision) so a future edge-creation flow can attach edges to specific sides? **No — and not as a future enhancement either.** Meta-disagreement is intentionally a single facet status with a single rollup (per `docs/methodology.md` lines 203–214 and `tasks/refinements/data-and-methodology/meta_disagreement_logic.md`): when the moderator marks a facet as meta-disagreement, the move is to **park both proposed values off-limits as a unit** — the entire meta-disagreement is acknowledged-and-set-aside, not litigated per-side. The "carries both proposed values side by side" phrasing in the methodology document is descriptive of the visual rendering, not a hint that per-side addressability is a missing feature. Per-side handles would imply per-side edge-attachability, which is **contrary to the methodology's intent** — once a facet is meta-disagreed, debaters are not supposed to keep arguing it side-by-side, they're supposed to move on. The 2-handle layout (one target top, one source bottom) is therefore the correct layout for split-rendered nodes for the same reason it's correct for baseline nodes: the node is one rollup, addressed as a unit. See Decisions for the framing.

### Tests (committed, per ADR 0022)

All listed tests are pre-decided as the Acceptance bar. The implementer should not introduce new uncovered behavior; if a new branch surfaces during implementation, document it and add the corresponding case.

**Extension to `apps/moderator/src/graph/StatementNode.test.tsx`** — handle wiring:

1. A baseline `<StatementNode>` renders one `Position.Top` target handle and one `Position.Bottom` source handle. Assert via `container.querySelectorAll('.react-flow__handle')` finds exactly 2 elements (or via `[data-handlepos="top"]` + `[data-handlepos="bottom"]` selectors — whichever is more stable under happy-dom).
2. The target handle carries the documented marker. Assert `container.querySelector('[data-handlepos="top"]')` is non-null and carries the className `react-flow__handle-top` (or equivalent — verify the actual library stamp during implementation).
3. The source handle carries the documented marker. Same assertion shape for `data-handlepos="bottom"`.
4. Handles compose with the diagnostic-halo ring without disappearing. Render a node with `diagnosticHighlight: { severity: 'blocking', kinds: ['cycle'] }`; assert both handles still render AND the amber-ring className is still on the root.
5. Handles compose with the hover popover. Hover the card (`fireEvent.mouseEnter` on the card root); assert both handles AND the popover render simultaneously (the popover via `data-testid="hover-popover-${id}"`).
6. Handles compose with every per-status rollup branch (proposed / agreed / disputed / meta-disagreement). One parametrized test across the four statuses asserts both handles render in each branch — pinning that the new children don't break any existing className branch.

**Extension to `apps/moderator/src/graph/GraphCanvasPane.test.tsx`** — visible edge rendering:

7. With one `node-created` + another `node-created` + one `edge-created` event in the WS store, the rendered canvas has `container.querySelectorAll('.react-flow__edge').length === 1` (was previously 0 — the existing test at lines 437–460 was a workaround; this new case lifts it from "projection asserts via `selectEdgesForSession`" to "actual edge SVG path renders under happy-dom"). The pre-existing two test cases stay (the projection-level assertion is still load-bearing; this new case is additive). Document the lift in a code comment on the existing block referencing this refinement.

**Playwright spec update** — `tests/e2e/moderator-hover-details.spec.ts`:

8. **Lift Test 4 from conditional to hard.** Remove lines 176–189's `const edgeLabelCount = await edgeLabel.count(); if (edgeLabelCount > 0) { ... }` guard. Assert:
   - `await expect(edgeLabel, 'seeded edge label must render').toBeVisible({ timeout: 10_000 });`
   - `await edgeLabel.hover();`
   - `await expect(edgePopover, 'hover popover must appear when the edge is hovered').toBeVisible();`
   - `await expect(edgePopover).toHaveAttribute('data-hover-target-kind', 'edge');`
   - `await expect(edgePopover).toContainText('Supports');`
   - `await expect(edgePopover).toContainText(TARGET_WORDING);`
   - `await page.mouse.move(0, 0);` to dismiss before Test 5 (keyboard focus).
9. **Optional: add an additional small assertion that the `.react-flow__edge` SVG path is in the DOM.** A single `await expect(page.locator('.react-flow__edge')).toHaveCount(1);` between the canvas-mount and the hover step, scoped to the same `test()` block. This is the load-bearing pin for "handles actually work end-to-end in a real browser" — independent of the popover content. See Decisions for the trade-off of inlining vs. splitting into a dedicated spec.
10. **Update the spec's header comment.** Remove the "Conditional on edge rendering" / "deferred-e2e debt" prose from lines 161–175; replace with a brief note that handles are now in place and Test 4 asserts hard. The historical reference to the debt is preserved in this refinement and in `mod_hover_details`'s Status block (immutable).

**Pre-existing Playwright specs that must stay green.** Per the orchestrator's UI-stream e2e policy:

- `tests/e2e/auth-flow.spec.ts` — unaffected (no graph-canvas dependency).
- `tests/e2e/moderator-hover-details.spec.ts` — Test 1 (node hover) / Test 2 (hover-leave) / Test 3 (click-through) / Test 5 (keyboard focus) stay; Test 4 lifts.
- `tests/e2e/moderator-graph-layout.spec.ts` — the layout spec's non-overlap + TB-direction + stability assertions read `getBoundingClientRect()` on rendered cards. Adding handles changes the card's child DOM tree but not its bounding rect; the spec stays green. (The handles' own bounding rects are inside the card's rect, so the overlap check doesn't pick up new rects.)

### Build / type / test gates

- `pnpm run check` clean.
- `pnpm run test:smoke` green (test count rises by 6–8 new Vitest cases).
- `pnpm -F @a-conversa/moderator build` succeeds (no bundle-size change beyond the 2-element JSX addition — `Handle` and `Position` are already pulled into the bundle transitively via `<ReactFlow>`).
- `pnpm exec playwright test --project chromium-moderator-hover` green against a freshly brought-up dev compose stack (per `docs/dev-environment.md`). Test 4 now asserts hard.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_node_handle_rendering` plus a `note "Refinement: tasks/refinements/moderator-ui/mod_node_handle_rendering.md"` line.

## Acceptance criteria

- `apps/moderator/src/graph/StatementNode.tsx` imports `Handle` and `Position` from `reactflow` and renders two `<Handle>` elements (`type="target" position={Position.Top}` and `type="source" position={Position.Bottom}`) as the first children inside the card root `<div>`. The pre-existing children (facet-pill row, wording paragraph, kind label, axiom-mark row, annotation row, hover popover) and root attributes (`data-testid`, `data-facet-status`, `data-selected`, `data-diagnostic-severity`, `aria-describedby`, `tabIndex={0}`, `className`, hover / focus handlers) remain intact.
- `apps/moderator/src/graph/StatementNode.test.tsx` carries the 6 new Vitest cases listed under Constraints — handle presence, per-position markers, composition with diagnostic halo, composition with hover popover, composition across status branches.
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` carries the one new case asserting `.react-flow__edge` SVG paths render for each seeded edge under happy-dom (the existing projection-level cases stay).
- `tests/e2e/moderator-hover-details.spec.ts` Test 4 is unconditional; the `if (edgeLabelCount > 0)` guard is gone; the edge-popover content + role + target-wording assertions are hard. The spec header comment is updated to remove the deferred-debt prose.
- `pnpm run check` clean. `pnpm run test:smoke` green (test count rises by the new cases). `pnpm -F @a-conversa/moderator build` succeeds. `pnpm exec playwright test --project chromium-moderator-hover` green against the dev compose stack. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_node_handle_rendering` plus the refinement-note line.
- No new ADR is created (this task reuses existing dependencies through their canonical API). No new i18n catalog key is added (handles render no text).

## Decisions

- **Two handles total (source bottom, target top), not four (one per side).** Four candidate handle counts considered:
  1. *Zero handles* — what's there today. Rejected because `.react-flow__edge` doesn't render, which is the exact debt this task closes.
  2. *One handle* (either source or target on one side, with the library defaulting both source and target lookups to it) — fragile; ReactFlow's edge-anchor resolution wants a source handle on the source node and a target handle on the target node, even if both are at the same Position. A single shared handle would conflict on bidirectional edges (A→B and B→A both anchoring to the same handle), and the visual is asymmetric in a way that doesn't match the methodology's claim-above-evidence reading order.
  3. *Two handles* (source bottom, target top) — matches dagre's `rankdir: 'TB'` direction exactly, supports bidirectional edges (A→B uses A's bottom-source + B's top-target; B→A uses B's bottom-source + A's top-target), keeps the visual minimal. **Chosen.**
  4. *Four handles* (top + bottom + left + right, each as both source and target) — allows ReactFlow to route edges through any side. Rejected for v1 because: (a) the layout direction is pinned to TB, so the top + bottom anchors are the load-bearing pair; left + right anchors would only be used if `rankdir` switched to `LR`, which is currently a `LayoutOptions` parameter with no UI surface to flip it; (b) more handles means more visual noise on every card; (c) the change is purely additive — if a future task introduces per-debate orientation switching, adding the left + right handles is a one-line follow-up.
- **JSX position: handles as FIRST children of the card root, not last, not wrapped.** The card root already establishes the relative-positioning context the popover + the rings depend on; rendering handles first keeps the visual stacking order (handles at the bottom of the visual layer, content on top, popover floating above). React's child render order doesn't affect ReactFlow's anchor math (the library reads the handle's `position` prop and the parent element's bounding rect, not the JSX position), but rendering handles first keeps the component's structure readable: "anchors first, then content."
- **Default ReactFlow visibility (no opacity override, no className tweak).** Three options considered:
  1. *Opacity 0 on idle* — handles are invisible until needed. Rejected because: (a) the default 6-px-radius white-with-grey-border circle is already minimally visible; (b) hiding them would obscure them from the future `mod_draw_edge_flow` user who hovers a card looking for a drag target; (c) opacity 0 doesn't help the edge-anchor math; (d) the visual-design pass (if any future task takes that scope) can re-skin them consistently.
  2. *Custom Tailwind className* — restyle to match the rest of the surface. Rejected because: (a) this is scope creep into visual design; (b) the default is fine for v1; (c) restyling without a design-tokens package is premature.
  3. *Library default* — chosen. Minimal change, minimal scope, clear seam for the future visual pass.
- **Position mapping: source bottom + target top (matches `rankdir: 'TB'`).** Pre-decided by [ADR 0025](../../../docs/adr/0025-graph-layout-engine-dagre.md). In TB, the source node sits above the target; the edge exits the source from its bottom and enters the target from its top. The handle positions follow that mapping directly. Alternative orientations (`BT` / `LR` / `RL`) are accepted by `LayoutOptions` but not the default; if a future task switches the default, the handle positions would need a parallel update. Documented in the `<StatementNode>` JSDoc with a forward reference.
- **Meta-disagreement-split node handling: SAME 2-handle layout as a baseline node — multi-handle is not a future enhancement, it would be contrary to the methodology.** Meta-disagreement is **intentionally** a single facet status with a single rollup (per `docs/methodology.md` lines 203–214 — "Meta-disagreement is a per-facet status" carrying "both proposed values side by side" as a registered acknowledgment — and per `tasks/refinements/data-and-methodology/meta_disagreement_logic.md`'s validator, which emits one `meta-disagreement-marked` event keyed to one facet and parks the proposal as a unit). When the moderator marks-as-meta-disagreement, the move is **to park both sides off-limits as a unit** — the entire meta-disagreement is acknowledged-and-set-aside, not an invitation to debate each side individually. Per-side handles would imply per-side addressability (per-side edges, per-side votes), which would re-open as a fresh debate exactly the thing the methodology just parked. That is **contrary to the methodology's intent**, not a future feature. The 2-handle layout (target top, source bottom) is therefore the **correct** decision for split-rendered nodes — the node is one rollup, the rollup has one set of incoming/outgoing edges, and the handles match. No `30-moderator-ui.tji` task is registered for per-side handles because no such task should ever exist; if a future methodology revision wanted per-side addressability, that revision would land in `docs/methodology.md` and `meta_disagreement_logic.md` first, and only then would a corresponding UI task make sense. The split-visual (`border-double`) is the moderator-affordance for "both values are registered as parked" — that is a visual cue for the audience, not a structural decomposition of the node.
- **Test 4 hardened in-place, not split into a dedicated spec.** Two candidate strategies for the Playwright assertion update:
  1. *Drop the conditional in-place in `moderator-hover-details.spec.ts`* — keeps the hover-details spec as the single source of truth for hover behavior across nodes AND edges. The seeded `node-created` + `edge-created` events are already set up in lines 112–119; reusing them for the edge assertion is zero additional setup cost.
  2. *Add a separate small `tests/e2e/moderator-edge-rendering.spec.ts`* — pure assertion that `.react-flow__edge` SVG paths visibly render for every seeded edge, independent of the popover. Cleaner separation of concerns; one spec proves "edges render," one proves "edge popover works."
  
  **Chosen: option 1 (drop the conditional in-place).** The setup overlap is high enough that splitting would duplicate the loginAs + POST /sessions + seedWsStore boilerplate; the hover-details spec already exercises every component this task touches; lifting Test 4 in-place is the minimum-change path. The optional `.react-flow__edge` count assertion (acceptance bullet 9) lives inside the same `test()` block — one small additional pin that the path exists, between canvas-mount and hover-step, deferred to implementer discretion if it ends up adding flake. If real-world spec maintenance shows the hover-details spec is getting unwieldy, a future refactor task can split out the edge-rendering assertions then.
- **No new ADR.** The task reuses `reactflow@11.11.4` (already pinned), uses the library's canonical extension API (`<Handle>` + `Position` from the same package), introduces no new visual idiom (ReactFlow defaults), changes no cross-workspace contract, adds no i18n key. The architectural seams are all pre-existing.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-15.**

- Handle JSX landed on `<StatementNode>` at `apps/moderator/src/graph/StatementNode.tsx`: `<Handle type="target" position={Position.Top} />` and `<Handle type="source" position={Position.Bottom} />` as the first children inside the card root, matching dagre's `rankdir: 'TB'` direction per [ADR 0025](../../../docs/adr/0025-graph-layout-engine-dagre.md). No `id`, no `style`, no className override — library defaults preserved per the Decisions section.
- Vitest coverage added to `apps/moderator/src/graph/StatementNode.test.tsx` under a new `StatementNode — ReactFlow Handle anchors` describe block (9 cases): handle presence count, `data-handlepos="top"` target marker, `data-handlepos="bottom"` source marker, composition with the diagnostic-halo ring, composition with the hover popover, and four per-status branch cases (proposed / agreed / disputed / meta-disagreement). The meta-disagreement case is the load-bearing pin for the corrected design intent — same 2-handle layout as a baseline node, NOT per-side handles — per the Constraints and Decisions sections of this refinement (intentional single-rollup model, not a deferred data-model gap).
- `tests/e2e/moderator-hover-details.spec.ts` Test 4 lifted from conditional / soft to hard: the `if (edgeLabelCount > 0)` guard is gone, `.react-flow__edge` count is pinned at `= 1` in the seeded fixture, and the edge popover content + role + target-wording assertions are hard. The "popover contains target wording" check was relaxed to a 60-char prefix match because `HoverPopover.tsx`'s `truncate()` caps source/target wordings at 60 chars — registered as a follow-up tech-debt task (`mod_edge_popover_full_target_wording` in `tasks/30-moderator-ui.tji`) per the ORCHESTRATOR.md `b7c5ff0` policy to decide whether to lift the cap or document it as the design contract.
- Test 5 robustness fix in the same spec: a `blur()` evaluate step before `focus()` so the keyboard-focus assertion no longer false-positives on residual focus state left by earlier tests.
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` swapped to active `ImmediateResizeObserver` + `offsetWidth` / `offsetHeight` / `getBoundingClientRect` stubs (lifted from `StatementEdge.test.tsx`) so ReactFlow's edge-render measurement pass succeeds under happy-dom; one new edge-rendering case asserts `.react-flow__edge` SVG paths render for each seeded edge.
- Closes the deferred-e2e debt registered by `mod_hover_details`'s Closer (commit `b7ac2d5`).

Verification: `pnpm run check` clean; `pnpm run test:smoke` 2498 passing (was 2488; +10); Playwright `moderator-hover-details` Tests 4 + 5, `chromium-moderator-layout`, and `chromium-auth` all green; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
