# Moderator click-to-select on nodes / edges

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_selection` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 0.5d
**Inherited dependencies**:
- `moderator_ui.mod_shell.mod_state_management` (done — landed `useSelectionStore` with `selected: { kind: EntityKind, id } | null`, `select()`, and `clear()`).
- `moderator_ui.mod_graph_rendering.mod_node_rendering` (done — `<StatementNode>` is the custom ReactFlow node card the selection ring decorates).
- `moderator_ui.mod_graph_rendering.mod_edge_rendering` (done — `<StatementEdge>` is the custom ReactFlow edge whose label this task decorates).

## What this task is

Wire the moderator's graph canvas to the existing `useSelectionStore`: a click on a node, edge, or empty pane updates the store, and the selected entity renders a visually distinct outline. Downstream tasks (`mod_context_menus`, `mod_hover_details`) read the store's `selected` value to drive their behavior; this task is the seam that lets them be built without re-deciding the click-handler contract.

This task lands:

- ReactFlow `onNodeClick` / `onEdgeClick` / `onPaneClick` handlers on the `<ReactFlow>` element inside `<GraphCanvasPane>`, mapping the event to a `useSelectionStore.getState().select({ kind: 'node' | 'edge', id })` or `.clear()` call.
- A per-node and per-edge selection-aware visual layer: each rendered `<StatementNode>` / `<StatementEdge>` reads the current selection from the store and, when its own id matches, stamps a `data-selected="true"` attribute plus a Tailwind `ring-*` outline (sky palette — neutral, deliberately not the rose / violet status colors). The non-selected case stamps `data-selected="false"` so tests have a stable false-branch seam.
- Vitest cases covering: click-a-node updates the store; click-an-edge updates the store with `kind: 'edge'`; click-the-pane clears the store; the selected node carries `data-selected="true"` + the ring classnames; non-selected nodes carry `data-selected="false"` and no ring class.

**This task is additive**: the existing per-facet / status-styling visuals (dashed proposed, solid agreed, rose disputed, violet meta-disagreement, ring-2 ring-rose-500, ring-2 ring-violet-400) stay; the selection ring is a separate ring on top of them (Tailwind composes multiple `ring-*` utilities — `ring-4` for selection sits visually outside the `ring-2` status ring).

## Why it needs to be done

The selection store has been live since `mod_state_management`, but nothing in the UI writes to it yet. Without a click-to-select gesture: (a) the right sidebar can't show "details for the selected entity"; (b) context menus have nothing to anchor to; (c) hover details have no fall-back display for keyboard-only users. Wiring the gesture once, in the canonical ReactFlow handler, means every downstream task that needs "what's selected?" reads `useSelectionStore` directly without re-implementing the click plumbing.

## Inputs / context

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow's `onNodeClick` / `onEdgeClick` / `onPaneClick` props are the canonical selection seams for the interactive-edit profile.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- `apps/moderator/src/stores/selectionStore.ts` — `useSelectionStore` API: `selected: Selection | null` (where `Selection = { kind: EntityKind; id: string }`), `select(selection)`, `clear()`. The `EntityKind` enum (`'node' | 'edge' | 'annotation'`) comes from `@a-conversa/shared-types`.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — the ReactFlow mount the handlers attach to.
- `apps/moderator/src/graph/StatementNode.tsx` — the custom node card that reads selection state and renders the outline.
- `apps/moderator/src/graph/StatementEdge.tsx` — the custom edge whose label container reads selection state.
- ReactFlow's `NodeMouseHandler` (`(event, node) => void`) + the `(event, edge) => void` shape for `onEdgeClick` + `(event) => void` for `onPaneClick`.

## Constraints / requirements

- **Click handlers in `<GraphCanvasPane>`**:
  - `onNodeClick={(_, node) => useSelectionStore.getState().select({ kind: 'node', id: node.id })}`.
  - `onEdgeClick={(_, edge) => useSelectionStore.getState().select({ kind: 'edge', id: edge.id })}`.
  - `onPaneClick={() => useSelectionStore.getState().clear()}`.
  - The handlers must be referentially stable across renders — wrap in `useCallback` (or hoist to module scope since they only call `getState()`, no React state needed). Hoisting via `getState()` keeps the canvas memoized: the `<ReactFlow>` doesn't see the handler identity changing per render.
- **Selection state on the node card** (`<StatementNode>`):
  - Read `useSelectionStore((s) => s.selected)` (component-local subscription so only this card re-renders when its own selected-ness flips).
  - Compute `isSelected = selected?.kind === 'node' && selected.id === id`.
  - Stamp `data-selected={isSelected ? 'true' : 'false'}` on the root card div.
  - When `isSelected`: add `ring-4 ring-sky-500` to the existing `className` (composition with the status `ring-2` rings is intentional — sky-500 reads neutrally against the slate / rose / violet status palette).
- **Selection state on the edge label** (`<StatementEdge>`):
  - Same pattern: subscribe to `useSelectionStore`, compute `isSelected = selected?.kind === 'edge' && selected.id === id`.
  - Stamp `data-selected={isSelected ? 'true' : 'false'}` on the role-label div (the visible interactive surface — the `<BaseEdge>` `<path>` is inside ReactFlow's SVG and isn't directly id-targetable for tests, mirroring the existing `data-facet-status` decision in `StatementEdge`).
  - When `isSelected`: add `ring-4 ring-sky-500` to the label classname.
- **No regressions to existing visuals**: the per-facet / status-styling classnames (`border-dashed`, `border-rose-600`, `ring-2 ring-rose-500`, `border-violet-600`, `ring-2 ring-violet-400`, etc.) stay; the selection ring composes on top of them.

## Acceptance criteria

- `pnpm run check` passes (lint + format + typecheck).
- `pnpm run test:smoke` passes; new tests cover the four cases listed under "What this task is."
- `pnpm -F @a-conversa/moderator build` produces a clean production bundle.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
- The refinement gets a `## Status` block on completion, and `tasks/30-moderator-ui.tji`'s `mod_selection` entry gets `complete 100`.

## Decisions

- **Selection-ring palette: `ring-4 ring-sky-500`.** Neutral against slate (baseline / agreed), rose (disputed), and violet (meta-disagreement). `ring-4` is one tier above the `ring-2` status rings so the two compose visibly without one masking the other.
- **`data-selected` is the test seam, not the ring class.** Tailwind class strings aren't load-bearing (JIT / production purging can change them), but data attributes are stable. Tests assert `data-selected="true"` for selection and also that the className contains `ring-4 ring-sky-500` so a refactor that drops the visual change still fails CI.
- **Handlers go on `<ReactFlow>`, not on individual node / edge components.** ReactFlow's own selection model is bypassed in favor of our store-based selection; the `onNodeClick` / `onEdgeClick` / `onPaneClick` props are the canonical seams. Per-component `onClick` handlers would double-fire with ReactFlow's pan / drag gestures.
- **`useSelectionStore.getState()` in the handlers, not the hook**. The handlers don't need to re-run on selection change — they only WRITE. Reading via `.getState()` keeps the handler reference stable and avoids subscribing the canvas to its own writes.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

- Module-scope click handlers in `apps/moderator/src/graph/GraphCanvasPane.tsx`: `handleNodeClick(_, node)` → `useSelectionStore.getState().select({ kind: 'node', id: node.id })`; `handleEdgeClick(_, edge)` → `select({ kind: 'edge', id: edge.id })`; `handlePaneClick()` → `clear()`. Exported for direct testing because ReactFlow's internal click pipeline gates `onNodeClick` on a measured-node check that doesn't run under happy-dom's no-op `ResizeObserver`. Wired onto `<ReactFlow onNodeClick={...} onEdgeClick={...} onPaneClick={...} />`.
- Read-side subscription in `<StatementNode>` (`apps/moderator/src/graph/StatementNode.tsx`): `useSelectionStore((s) => s.selected?.kind === 'node' && s.selected.id === id)` — the selector reduces the store to a per-card boolean so only the previously- / newly-selected card re-renders on a selection change. Adds `data-selected="true"|"false"` to the root card div and composes `ring-4 ring-sky-500` on top of any existing status ring when selected.
- Read-side subscription in `<StatementEdge>` (`apps/moderator/src/graph/StatementEdge.tsx`): same pattern, scoped to `kind === 'edge'`. The `data-selected` attribute + `ring-4 ring-sky-500` apply to the role-label div (the visible interactive surface — matches the existing `data-facet-status` decision for the same reason: the `<BaseEdge>` SVG `<path>` isn't directly id-targetable).
- Vitest cases added (13 new tests; project total 2309 → 2322):
  - `apps/moderator/src/graph/GraphCanvasPane.test.tsx` (5 new): direct invocations of `handleNodeClick` / `handleEdgeClick` / `handlePaneClick` updating the store; last-write-wins across kinds; and an end-to-end "store-write → rendered card flips `data-selected` + picks up the ring classnames" case.
  - `apps/moderator/src/graph/StatementNode.test.tsx` (5 new): unselected case stamps `data-selected="false"` with no ring; selected case stamps `data-selected="true"` + `ring-4 ring-sky-500`; selection on a different node id leaves this card unselected; edge-kind selection with the same id doesn't bleed into node selection; selection composes additively with the disputed status ring.
  - `apps/moderator/src/graph/StatementEdge.test.tsx` (3 new): mirror cases for the edge label — unselected default; selected stamps both `data-selected="true"` and the ring classnames; node-kind selection with the same id doesn't bleed.
- ESLint, Prettier, `tsc -b`, `pnpm run typecheck:tools`, `pnpm run typecheck:tests`, `pnpm run test:smoke`, and `pnpm -F @a-conversa/moderator build` all clean. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream tasks (`mod_context_menus`, `mod_hover_details`) read `useSelectionStore` directly; the click-handler contract pinned by this task means they can subscribe to the store without re-implementing the click plumbing.
