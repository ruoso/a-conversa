# mod_drag_to_create_edge — drag from a source handle to a target handle creates an edge between two existing statement nodes

**TaskJuggler entry**: `moderator_ui.mod_capture_flow.mod_draw_edge_flow.mod_drag_to_create_edge` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) (block at lines 474-485).

## Effort estimate

**2d** (per the `.tji` allocation). The gesture itself is a ReactFlow `onConnect` + `onConnectEnd` plumb-through; the load-bearing work is the moderator-state plumbing (mounting the role picker against the cursor; the in-flight gate on the propose envelope; the Escape / outside-click cancel paths) plus the e2e drag-simulation pattern that future draw-edge consumers (warrant-elicitation, decompose follow-ups) will inherit.

## Inherited dependencies

**Settled:**

- [`mod_node_handle_rendering`](./mod_node_handle_rendering.md) (done — `<StatementNode>` lines 517-518 render the single `source` handle at `Position.Bottom` and the single `target` handle at `Position.Top`. The future-consumer note on that refinement explicitly names this task as the downstream that wires the drag-from-handle-to-handle interaction.)
- [`mod_set_edge_substance_endpoint_carriage`](./mod_set_edge_substance_endpoint_carriage.md) (done — `setEdgeSubstanceProposalSchema` carries the optional `source_node_id` / `target_node_id` / `role` fields; the propose handler's `set-edge-substance` arm emits `edge-created` + `entity-included(edge)` + `proposal` when the fresh-edge predicate holds. The wire path this task fires into is on `main`.)
- [`mod_proposed_entity_canvas_visibility`](./mod_proposed_entity_canvas_visibility.md) (done — proposed entities render with `data-facet-status="proposed"` from propose-time. The two seeded nodes the e2e drag-tests against use the same canvas-visibility contract.)
- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md). The moderator surface is the interactive-edit profile precisely because of ReactFlow's drag-to-create-edge ergonomics; this task is the first user-facing exercise of that gesture.
- [ADR 0008 — Playwright + compose layering](../../../docs/adr/0008-e2e-framework-playwright.md). The Playwright spec that drives a low-level pointer drag from source-handle to target-handle is the UI-stream regression cover.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). Every empirical check ships as a committed test.

**Pending:** (none — every input is settled on `main`.)

## What this task is

Wire ReactFlow's `onConnect` + `onConnectEnd` handlers on `<GraphCanvasPane>` so the moderator's drag from one statement node's bottom (source) handle to another statement node's top (target) handle:

1. Captures the `{source, target}` pair on the valid drop.
2. Captures the cursor `{clientX, clientY}` at drop-time so the role-pick popover (the sibling [`mod_role_palette_on_drop`](./mod_role_palette_on_drop.md) task) opens at the drop point rather than at a fixed location.
3. Mounts `<DrawEdgeRolePicker>` as a sibling render against the canvas root.
4. The picker's role pick fires the `set-edge-substance` connecting-case proposal envelope; the wire-level fan-out (`edge-created` + `entity-included(edge)` + `proposal`) lands per the inherited propose-handler arm.

The handler pair is the structural plumbing; the popover + propose round-trip + the cancel paths live in the sibling refinement to keep the WBS leaves discrete.

## Why it needs to be done

Today the moderator can only connect a NEW statement to an existing target via the `<EdgeRoleSelector>` in the bottom-strip capture pane (the F1 connecting-capture path). To create an edge between two EXTANT nodes, there is no UI path — the wire path exists (`set-edge-substance` connecting case via `mod_set_edge_substance_endpoint_carriage`) but no gesture fires it. The drag-from-handle-to-handle gesture is the missing UI path; ADR 0004 names it as one of the two reasons (alongside React-native custom nodes) for picking ReactFlow on the moderator surface in the first place.

## Inputs / context

- [`apps/moderator/src/graph/GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) — the ReactFlow mount. The handlers + the picker mount land here.
- [`apps/moderator/src/graph/StatementNode.tsx:517-518`](../../../apps/moderator/src/graph/StatementNode.tsx) — the source / target handle anchors the drag binds to.
- [ReactFlow `OnConnect` / `OnConnectEnd` API](https://reactflow.dev/docs/api/react-flow-props/) — `onConnect` fires synchronously on a valid handle-to-handle drop with `{source, target, sourceHandle, targetHandle}`; `onConnectEnd` fires immediately after with the native MouseEvent or TouchEvent carrying drop coordinates.

## Constraints / requirements

- **`onConnect` + `onConnectEnd` are the pair, not `onConnect` alone.** `onConnect` carries source/target node ids but no cursor coordinates; `onConnectEnd` carries cursor coordinates but no source/target. The canvas stashes the valid pair in a `useRef` from `onConnect` and reads it back inside `onConnectEnd` to set the picker state with both pieces of information. The ref is intentionally not `useState` — writes happen inside a synchronous ReactFlow callback and must not drive a re-render between the two callbacks.
- **Same-node drops are silently dropped.** ReactFlow's default predicate already rejects same-node drops (the source handle and target handle are distinct, and the underlying `isValidConnection` requires distinct node ids); the canvas's `handleConnect` adds a defensive `params.source === params.target` guard so the picker never opens for a self-loop.
- **The picker opens at the drop cursor.** `{x, y}` come from `event.clientX` / `event.clientY` (mouse) or `event.changedTouches[0].clientX` / `clientY` (touch). Position is `position: fixed` per the sibling submenu pattern (`<AxiomMarkSubmenu>` lines 178-184).
- **No new proposal kind.** The wire path is `set-edge-substance` connecting case per `mod_set_edge_substance_endpoint_carriage` D1. This task introduces no schema, no migration, no event-kind work — only handler wiring + a popover.
- **No regression in existing pointer interactions.** Selection clicks (`handleNodeClick` / `handleEdgeClick` / `handlePaneClick`) and the context-menu right-click handlers continue to fire on their normal triggers. ReactFlow's `onConnect` only fires on a valid handle-to-handle drag-drop; the click handlers are independent.

## Acceptance criteria

**Pinned per ADR 0022 — every check ships as a committed test.**

UI-stream Playwright e2e (failing-first per ADR 0022):

- [`tests/e2e/moderator-draw-edge.spec.ts`](../../../tests/e2e/moderator-draw-edge.spec.ts) — new spec. Scenario 1: seed two `proposed` statement nodes via the capture-pane gesture; drive a low-level pointer drag from `nodes.nth(0).locator('.react-flow__handle.source')` to `nodes.nth(1).locator('.react-flow__handle.target')`; assert the role-picker mounts with `data-testid="draw-edge-role-picker"` carrying both UUIDs on `data-source-id` / `data-target-id`. Scenario 2: same seed; same drag; press Escape on the open picker; assert the picker dismounts and no edge label surfaces (`page.locator('[data-testid^="graph-edge-label-"]')` count is 0).

Vitest:

- [`apps/moderator/src/graph/GraphCanvasPane.test.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.test.tsx) — the existing 87 cases stay green (the new handlers are additive on the ReactFlow props; the existing prop captures continue to find their assertions).

Build + scheduler:

- `pnpm run check` clean.
- `pnpm run test:smoke` green.
- `pnpm -F @a-conversa/moderator build` clean.
- The new e2e spec passes against the post-fix runtime.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_drag_to_create_edge`.

## Decisions

- **D1 — `onConnect` + `onConnectEnd` together; not `onConnect` alone.** ReactFlow's `onConnect` does not carry cursor coordinates; the popover would otherwise have to be positioned at a fixed location (canvas center, or projected from the target node's coordinates), neither of which match the drop point users expect. The two-handler pair (`onConnect` for the validated pair via a ref, `onConnectEnd` for the cursor coords) is the cleanest way to combine both pieces of information without forking ReactFlow internals. Alternative considered: project the target node's screen position via `useReactFlow().getNode(targetId)` and offset. Rejected — surfaces a popover that drifts off-cursor for dragged targets and feels disconnected from the gesture.
- **D2 — Drag-to-self is silently dropped at the canvas layer.** ReactFlow's `isValidConnection` default already rejects self-loops on the same handle. The canvas's `handleConnect` adds an additional `params.source === params.target` guard against any cross-handle self-loop ReactFlow might allow in future versions. The defensive guard is one comparison; the resilience win outweighs the surface-area cost.

## Open questions

(none — all decided.)

## Status

**Done** — 2026-05-25.

- `<GraphCanvasPane>` at [`apps/moderator/src/graph/GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) grew (a) the `drawEdgePicker` state alongside the existing submenu states, (b) the `pendingConnectionRef` + `handleConnect` + `handleConnectEnd` callback pair, (c) the `onConnect` + `onConnectEnd` props on the `<ReactFlow>` element, (d) the `<DrawEdgeRolePicker>` mount alongside the other submenu mounts. Same-node drops and missing source/target are silently dropped at the `handleConnect` guard.
- New e2e spec [`tests/e2e/moderator-draw-edge.spec.ts`](../../../tests/e2e/moderator-draw-edge.spec.ts) drives the gesture end-to-end: two scenarios cover (i) drag-then-pick-role → proposed edge surfaces on the canvas; (ii) drag-then-Escape → picker dismounts, no edge created.
- The sibling [`mod_role_palette_on_drop`](./mod_role_palette_on_drop.md) refinement ships the `<DrawEdgeRolePicker>` component the canvas mounts.
- `pnpm run check` green; `pnpm run build` green (server + shared-types + moderator + audience + participant all clean).
