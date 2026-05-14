# Moderator graph canvas pane (ReactFlow mount)

**TaskJuggler entry**: `moderator_ui.mod_layout.mod_graph_canvas_pane` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**: `moderator_ui.mod_layout.mod_layout_shell` (done — three-pane scaffold landed) + `foundation.stack_decisions.graph_lib_decision` (done — ADR 0004 picked ReactFlow for the moderator surface).

## What this task is

Mount ReactFlow inside the moderator's `operate-graph-pane` slot. The canvas starts empty — no nodes, no edges — and stays empty in this task; the rendering tasks under `mod_graph_rendering` (`mod_node_rendering`, `mod_edge_rendering`, `mod_annotation_rendering`, …) read events from the WS store and fill the canvas in. This task is solely responsible for: getting the ReactFlow component on screen with the right size, wiring its CSS into the moderator bundle, enabling the basic interaction defaults (pan + zoom), drawing the background grid, and giving downstream tasks a stable `data-testid` to hang assertions off.

## Why it needs to be done

`mod_layout_shell` left the graph pane holding a temporary placeholder `<div>` (the `operate-graph-placeholder` block carrying the `mod_state_management` test ids). Every downstream graph-rendering task (`mod_node_rendering`, `mod_edge_rendering`, the state-styling tasks, `mod_pan_zoom`, `mod_selection`, `mod_context_menus`, the draw-edge flow) targets the ReactFlow tree — they cannot mount node/edge components into a `<div>`. This task replaces the placeholder with the ReactFlow root that the downstream tasks plug into. It also pulls in the `reactflow` runtime dependency at the moderator workspace level (until now it lived only at the repo root for the throwaway smoke script) and wires its bundled stylesheet into the app entry so the rendered canvas isn't visually broken.

## Inputs / context

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow for the moderator surface (the interactive-edit profile); Cytoscape for the read-only surfaces. The moderator's drag-to-create-edge ergonomics are the reason for the split.
- [docs/moderator-ui.md — Layout (sketch)](../../../docs/moderator-ui.md#layout-sketch) — the graph canvas "takes the majority of the screen" inside the three-pane shell.
- [tasks/refinements/moderator-ui/mod_layout_shell.md](mod_layout_shell.md) — the shell exposes the `operate-graph-pane` slot via a `graphPane` render prop on `<OperateLayout>`. The shell's Status block names `mod_graph_canvas_pane` as the task that deletes the placeholder.
- `apps/moderator/src/routes/Operate.tsx` — currently composes `<OperateLayout>` with the temporary placeholder block. This task swaps the `graphPane` prop to `<GraphCanvasPane />`.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.

## Constraints / requirements

- **Component location**: `apps/moderator/src/graph/GraphCanvasPane.tsx`. New folder `apps/moderator/src/graph/` parallels the existing `layout/`, `auth/`, `routes/`, `stores/`, `ws/` siblings — `graph` collects every ReactFlow-touching component the downstream rendering tasks will add.
- **Empty initial state**: the component renders `<ReactFlow nodes={[]} edges={[]} />`. No nodes, no edges. The component does NOT read from any store in this task — downstream rendering tasks introduce the store-to-canvas wiring.
- **Pan + zoom enabled**. ReactFlow's defaults (`panOnDrag`, `zoomOnScroll`, `zoomOnPinch`) stay on. The dedicated `mod_pan_zoom` task is downstream, but the default behaviour is the right behaviour; that later task is about polish (zoom-to-fit, min/max bounds, keybind), not about turning the feature on.
- **Background grid**. Mount `<Background />` from `@reactflow/background` inside the `<ReactFlow>` tree. Default variant (dots) is fine; the visual-design task will retune it once `packages/ui-tokens` lands.
- **Sizing**. ReactFlow requires its container to have an explicit height (the library logs a console warning otherwise). The component's root `<div>` claims `h-full w-full` so it fills the `operate-graph-pane` slot the layout shell hands it.
- **Pin reactflow at the moderator workspace.** Add `"reactflow": "11.11.4"` (no `^`) to `apps/moderator/package.json`'s `dependencies`. The repo root already lists it under `devDependencies` with `^11.11.0`; the resolved lockfile version (11.11.4) is what gets pinned here. Project convention: app deps are pinned, no caret.
- **CSS wiring**. Import `reactflow/dist/style.css` at the top of `GraphCanvasPane.tsx` so the library's stylesheet is bundled whenever the canvas component is imported. Import inside the component file (not `main.tsx`) so a future surface that doesn't render the canvas doesn't pull the CSS.
- **Test id**. The component's outer `<div>` carries `data-testid="graph-canvas-root"`. Downstream rendering tasks can target this for "find the canvas" assertions.
- **Drop the placeholder**. `apps/moderator/src/routes/Operate.tsx` stops rendering the `operate-graph-placeholder` block; the `route-operate` outer `<main>` and the `session-id` paragraph (the two ids asserted by `apps/moderator/src/App.test.tsx`'s "renders the operate route with the session id captured from the path" case) stay. The store-subscription test ids that lived in the placeholder (`capture-mode`, `selected-entity`, `active-sidebar-pane`, `route-title`, `i18n-hello`) are not referenced by any other test in the workspace and are removed with the placeholder; the `mod_state_management` AC stays satisfied by the stores themselves (their type signatures and reducers are exercised by `apps/moderator/src/stores/*.test.ts` and the broader test suite).
- **Tests** (committed, per ADR 0022): `apps/moderator/src/graph/GraphCanvasPane.test.tsx` with cases covering (a) the canvas renders without crashing, (b) the `graph-canvas-root` test id is present, (c) the ReactFlow DOM marker (`.react-flow` class) is in the rendered output, (d) the background grid is rendered (`.react-flow__background` class), and (e) the canvas mounts with no nodes/edges (asserting the `.react-flow__node` and `.react-flow__edge` selectors find nothing). ReactFlow needs measured viewport dims to do layout — `happy-dom` returns zero rect sizes by default; if the assertions need a non-zero size to fire, the test wraps `<GraphCanvasPane />` in a fixed-pixel container and/or stubs `ResizeObserver` (ReactFlow uses it internally).

## Acceptance criteria

- `apps/moderator/src/graph/GraphCanvasPane.tsx` exists, exports `GraphCanvasPane`, mounts `<ReactFlow nodes={[]} edges={[]}>` with a `<Background />` child, carries the `graph-canvas-root` test id on its outer `<div>`, and sizes itself to fill its parent.
- `apps/moderator/src/routes/Operate.tsx` composes `<OperateLayout graphPane={<GraphCanvasPane />} />`; the temporary placeholder block is gone; `route-operate` and `session-id` test ids remain.
- `apps/moderator/package.json` lists `"reactflow": "11.11.4"` under `dependencies` (pinned, no caret).
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` covers the cases listed under Constraints.
- `pnpm run check` clean, `pnpm run test:smoke` green (test count rises by the new cases under `GraphCanvasPane.test.tsx`).
- `pnpm -F @a-conversa/moderator build` succeeds (bundle size grows with `reactflow` — expected per ADR 0004 Consequences).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_graph_canvas_pane`.

## Decisions

- **ReactFlow, not Cytoscape** — settled by ADR 0004.
- **Pan + zoom on by default** — leaves the dedicated `mod_pan_zoom` task focused on polish (zoom-to-fit / bounds / keybind) rather than enable/disable.
- **Background grid: dot variant (ReactFlow default)** — visual-design retuning is downstream and gated on `packages/ui-tokens`.
- **CSS import in the component file** — keeps the canvas-stylesheet coupling local; a surface that doesn't import the canvas doesn't pull the CSS.
- **Pinned dependency version** — repo convention; the resolved lockfile version 11.11.4 (root listed `^11.11.0`) is what gets pinned.
- **Drop the placeholder block** — `mod_layout_shell` Status block explicitly names this task as the one that removes it; the bare two test ids the App router test asserts (`route-operate`, `session-id`) stay.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

- New `apps/moderator/src/graph/GraphCanvasPane.tsx` — mounts `<ReactFlow nodes={[]} edges={[]}>` with a `<Background />` child grid; outer `<div>` carries the `graph-canvas-root` test id and `h-full w-full` so the canvas fills the `operate-graph-pane` slot the `<OperateLayout>` hands it. `reactflow/dist/style.css` is imported at the top of the component file so the library's stylesheet ships only when the canvas does.
- New `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — committed Vitest cases (ADR 0022) covering: (a) the component renders without throwing, (b) the `graph-canvas-root` test id is present, (c) the `.react-flow` wrapper class is in the rendered DOM (the library actually mounted), (d) the `<Background />` grid renders (`.react-flow__background`), (e) the canvas starts with no nodes / no edges (`.react-flow__node` and `.react-flow__edge` selectors find nothing). A no-op `ResizeObserver` stub is installed once at the suite level — happy-dom doesn't ship one and ReactFlow's core observes its container.
- `apps/moderator/src/routes/Operate.tsx` — temporary placeholder block is gone; `<OperateLayout>` now receives `<GraphCanvasPane />` in its `graphPane` slot. `route-operate` (outer `<main>`) and `session-id` (an `sr-only` `<span>` pinned out of layout flow) test ids survive so the `App.test.tsx` "renders the operate route with the session id captured from the path" case continues to pass. The store-subscription test ids that lived inside the placeholder (`capture-mode`, `selected-entity`, `active-sidebar-pane`, `route-title`, `i18n-hello`) are removed with the placeholder; no other test in the workspace references them and the store-level coverage from `mod_state_management` is exercised by `apps/moderator/src/stores/*.test.ts`.
- `apps/moderator/package.json` — pinned `"reactflow": "11.11.4"` under `dependencies` (no caret; resolved lockfile version from the root `^11.11.0` devDependency).
- Tests: `apps/moderator/src/graph/GraphCanvasPane.test.tsx` adds 5 new Vitest cases; baseline 1681 → 1686. `pnpm run test:smoke` green. `pnpm -F @a-conversa/moderator build` green — bundle grew to 508 kB (gzip 159 kB), the expected price of bringing ReactFlow into the moderator app per ADR 0004 Consequences. `pnpm run check` clean. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream consumers (`mod_node_rendering`, `mod_edge_rendering`, the state-styling tasks, `mod_pan_zoom`, `mod_selection`, `mod_context_menus`, the draw-edge flow) now have a stable ReactFlow root to plug their store-to-canvas wiring into via the `graph-canvas-root` test id and the standard ReactFlow APIs.
