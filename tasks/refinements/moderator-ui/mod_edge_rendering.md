# Moderator edge rendering (ReactFlow custom edge with localized role label)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_edge_rendering` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**: `moderator_ui.mod_layout.mod_graph_canvas_pane` (done — the ReactFlow root is mounted with `graph-canvas-root`) + `frontend_i18n.i18n_methodology_glossary` (done — `methodology.edgeRole.*` keys are populated in `en-US`, `pt-BR`, `es-419`).

## What this task is

Render `edge-created` events from the WS store as ReactFlow edges with a localized role label drawn on the edge body. Adds a custom ReactFlow edge component — `StatementEdge` — registered in a stable `edgeTypes` map and wired into `<GraphCanvasPane>`, plus the store-derived selector that maps the WS event log into ReactFlow `Edge<{role}>` instances. The label text resolves through `react-i18next`'s `t('methodology.edgeRole.<role>')` so the seven role variants (`supports` / `rebuts` / `qualifies` / `bridges-from` / `bridges-to` / `defines` / `contradicts`) render the per-locale value from the catalog.

This is rendering only. State-styling (proposed dashed / agreed solid / disputed marker), per-facet ambient indicators, the draw-edge flow, hover details, context menus — all downstream sibling tasks under `mod_graph_rendering` and `mod_capture_flow`. This task pins the basic "edges from the log render on the canvas with a localized role label" baseline.

## Why it needs to be done

`mod_graph_canvas_pane` left the canvas empty by design — the next-step decomposition routes node, edge, and annotation rendering through their own dedicated tasks. `mod_capture_flow.mod_propose_action` and `mod_diagnostic_resolution_flow.mod_annotation_action` both depend on `!mod_graph_rendering` as a whole: edges have to be visible before the propose flow can land an edge against the graph or the diagnostic flow can highlight one. Downstream state-styling tasks (`mod_proposed_state_styling`, `mod_agreed_state_styling`, `mod_disputed_state_styling`) extend the edge component's class-name logic; without a custom edge component to extend, each of those tasks would re-introduce the same one. Landing the custom edge once here means state-styling is a matter of toggling props/classes on a single component.

The localized label is required because the moderator console targets multilingual users (ADR 0024) and the methodology vocabulary is the user-facing terminology debate participants reason about. A bare wire-format identifier (`supports` / `bridges-from`) leaks the internal enum into the UI; resolving through the i18n catalog renders the human-readable per-locale form (`Supports` / `Apoia` / `Apoya` for `supports`).

## Inputs / context

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface; custom node/edge components are the explicit reason for the pick.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — react-i18next + ICU bound through `@a-conversa/i18n-catalogs`.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — the ReactFlow root this task wires the `edgeTypes` and store-derived `edges` array into.
- `apps/moderator/src/ws/wsStore.ts` — `WsSessionState.events: Event[]` is the source of truth this task selects from.
- `packages/shared-types/src/events/enums.ts` — `edgeRoleSchema` is the canonical enum; the seven role values mirror the SQL CHECK on `edges.role` exactly.
- `packages/shared-types/src/events.ts` — `EdgeCreatedPayload` carries `edge_id`, `role`, `source_node_id`, `target_node_id`.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — `methodology.edgeRole.<role>` keys for each of the seven roles.

## Constraints / requirements

- **Custom edge component**: `apps/moderator/src/graph/StatementEdge.tsx` exports a memo'd functional component implementing the ReactFlow `EdgeProps<{ role: EdgeRole }>` contract. It uses `getBezierPath(...)` for the path geometry (consistent with the ReactFlow default look so the per-state styling task has a clean baseline) and `<EdgeLabelRenderer>` for the role label (an HTML overlay positioned at the midpoint of the bezier, so the label remains horizontal and crisp regardless of edge angle, matching the ReactFlow recommendation for text-on-edge use cases).
- **Label localization**: the label text comes from `useTranslation()`'s `t('methodology.edgeRole.<role>')`. The role is read from `data.role` on the ReactFlow edge object. If `data` or `data.role` is missing (a defensive path — shouldn't happen because the selector always populates it), the component renders an empty label rather than throwing.
- **`edgeTypes` map**: exported from `apps/moderator/src/graph/edgeTypes.ts` (so the test suite can reference the same map the canvas does). Single entry: `{ statement: StatementEdge }`. The selector below always emits `type: 'statement'` on every edge.
- **Store-derived edges selector**: `apps/moderator/src/graph/selectors.ts` exports `selectEdgesForSession(state: WsState, sessionId: string): Edge<{ role: EdgeRole }>[]`. It walks `state.sessionState[sessionId]?.events ?? []`, picks every `event.kind === 'edge-created'`, and maps each to `{ id: payload.edge_id, source: payload.source_node_id, target: payload.target_node_id, type: 'statement', data: { role: payload.role } }`. Pure function — testable in isolation without a React mount.
- **GraphCanvasPane wiring**: `<GraphCanvasPane>` accepts an optional `sessionId?: string` prop. When provided, the component reads the WS store via `useWsStore` and computes the edges via `selectEdgesForSession`. When omitted (the default — for instance the `App.test.tsx` route-render baseline) the canvas renders empty and the wiring still works. The `edgeTypes` map is passed in regardless. `Operate.tsx` threads its `useParams<{ id: string }>().id` into `<GraphCanvasPane sessionId={id} />`.
- **Edges only, no nodes (yet)**: `mod_node_rendering` is a sibling, not a predecessor — that task lands the node component and the corresponding selector. This task does NOT add a custom node component or a node selector. ReactFlow renders edges whose `source` / `target` refer to unknown nodes by simply not drawing them (no error) — the canvas under this task in isolation will look empty unless tests build a `<ReactFlowProvider>` and feed both nodes and edges directly. The store-to-edges path is the load-bearing surface here; the visible-on-screen end-to-end ties up once `mod_node_rendering` lands its selector.
- **Tests** (committed, per ADR 0022):
  - `apps/moderator/src/graph/selectors.test.ts` — pure-function tests for `selectEdgesForSession`: empty state, single `edge-created`, multiple `edge-created` events, mixed event log (only edges picked up), missing session id returns `[]`. Round-trip every role variant (`supports` / `rebuts` / `qualifies` / `bridges-from` / `bridges-to` / `defines` / `contradicts`) to confirm the role lands on `data.role`.
  - `apps/moderator/src/graph/StatementEdge.test.tsx` — render-the-component-in-isolation tests inside a `<ReactFlowProvider>` and a stub `<svg>` host so ReactFlow's `<EdgeLabelRenderer>` portal target exists. Cases: each of the seven roles × each of the three locales renders the matching catalog string in the label (21 cases). Plus a no-`data` defensive case that renders empty.
  - `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — extended to assert (a) the canvas renders the edges derived from the WS store when `sessionId` is passed, (b) the edge count matches the number of `edge-created` events for that session, (c) edges are picked up by the `.react-flow__edge` selector.
- **ReactFlow type imports**: `EdgeProps`, `Edge`, `getBezierPath`, `EdgeLabelRenderer` from `reactflow`. The package is already a moderator workspace dependency (pinned `11.11.4`).
- **Memo**: the edge component is wrapped in `memo(...)` per the ReactFlow recommendation — ReactFlow re-renders edges on every viewport-pan/zoom, and the role label only changes when `data.role` or the active locale changes.

## Acceptance criteria

- `apps/moderator/src/graph/StatementEdge.tsx` exists, exports a memo'd `StatementEdge` component that renders an SVG bezier path and an HTML label overlay sourced from `t('methodology.edgeRole.<role>')`.
- `apps/moderator/src/graph/edgeTypes.ts` exists, exports `edgeTypes = { statement: StatementEdge }` (frozen / `as const` so ReactFlow's `Object.keys`-based dirty-check stays stable across renders).
- `apps/moderator/src/graph/selectors.ts` exists, exports `selectEdgesForSession(state, sessionId)` that derives the ReactFlow edge list from the WS event log.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` accepts a `sessionId?: string` prop, reads `useWsStore` when provided, and passes `edges` + `edgeTypes` into `<ReactFlow>`.
- `apps/moderator/src/routes/Operate.tsx` threads `useParams().id` into `<GraphCanvasPane sessionId={id} />`.
- `apps/moderator/src/graph/selectors.test.ts` + `apps/moderator/src/graph/StatementEdge.test.tsx` exist with the cases listed under Constraints.
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` extends to cover store-derived edge rendering.
- `pnpm run check` clean; `pnpm run test:smoke` green (test count rises by the new cases).
- `pnpm -F @a-conversa/moderator build` succeeds.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_edge_rendering`.

## Decisions

- **Bezier path geometry** — matches the ReactFlow default look, sets a clean baseline for the downstream state-styling tasks (dashed / solid / disputed marker) to extend without re-deciding the curve shape.
- **HTML label via `<EdgeLabelRenderer>`** — keeps the label horizontal regardless of edge angle, matches the ReactFlow community pattern for text-on-edge, and lets Tailwind / future ui-tokens style the label as DOM (rather than SVG text).
- **Single `statement` edge type, role on `data`** — keeps the type registry tiny and lets the role drive label / class-name / future state-styling decisions through a single discriminator. Splitting into seven edge types (one per role) would balloon the registry and force downstream state-styling to fork seven copies of the same component.
- **`sessionId` is an optional prop on `GraphCanvasPane`** — keeps `App.test.tsx`'s router-only baseline test working (it renders the operate route without a populated WS store), and keeps the component testable in isolation.
- **No node component this task** — `mod_node_rendering` is a sibling; nodes are out of scope here. The store-to-edges pipeline is the load-bearing surface; visible end-to-end ties up when nodes land.
- **`memo()` on the edge component** — recommended ReactFlow pattern for custom edges; the label only re-renders when role or locale change.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

- New `apps/moderator/src/graph/StatementEdge.tsx` — `memo`'d custom ReactFlow edge implementing the `EdgeProps<StatementEdgeData>` contract. Uses `getBezierPath(...)` for the curve geometry (matching the ReactFlow default look so the per-state styling siblings have a clean baseline to extend) and `<EdgeLabelRenderer>` to portal the role label into the canvas. Label text resolves through `useTranslation()`'s `t('methodology.edgeRole.<role>')` — the seven role values land their localized strings from the `en-US` / `pt-BR` / `es-419` catalogs. Defensive `data?.role` check renders an empty label rather than the literal key string on the no-data path.
- New `apps/moderator/src/graph/edgeTypes.ts` — single-entry registry `{ statement: StatementEdge }` exported at module scope so the reference stays stable across renders (avoids ReactFlow rebuilding its internal edge-type cache on every render).
- New `apps/moderator/src/graph/selectors.ts` — `selectEdgesForSession(state, sessionId)` walks `state.sessionState[sessionId]?.events` once, picks every `edge-created` envelope, and maps each to `Edge<StatementEdgeData>` with `type: 'statement'` and `data.role` carried through. Pure function over `WsState`; testable without a React render. Exports `StatementEdgeData` for the edge component.
- Updated `apps/moderator/src/graph/GraphCanvasPane.tsx` — imports `edgeTypes` and `selectEdgesForSession`, passes both `edgeTypes` and the projected `edges` array into `<ReactFlow>` alongside the existing nodes wiring from `mod_node_rendering`. Edges are derived inside a `useMemo` keyed on `[sessionId, events]`, reading the same subscribed events array as `projectNodes` so the selector hook count stays the same.
- Updated `apps/moderator/src/routes/Operate.tsx` — refinement header pointer updated to `mod_edge_rendering`; the existing `<GraphCanvasPane sessionId={id} />` wire-up already threads the session id, so no functional change beyond the doc reference.
- New `apps/moderator/src/graph/selectors.test.ts` — 12 Vitest cases for `selectEdgesForSession`: unknown session, empty log, single edge, multiple edges in order, mixed log (node-created ignored), and a parametrized round-trip across all seven `EdgeRole` values.
- New `apps/moderator/src/graph/StatementEdge.test.tsx` — 22 Vitest cases: seven roles × three locales (21) plus a defensive no-`data` render. Tests mount a real `<ReactFlow>` with pre-measured nodes and an `ImmediateResizeObserver` stub so the edge-label portal target gets populated under happy-dom.
- Updated `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — added 2 store-derived edge cases: one asserts the selector reflects multiple `edge-created` events through the canvas wiring, the other asserts node and edge projections are disjoint (a `node-created` event does not contribute to `selectEdgesForSession`). The cases lean on the selector for the projection assertion rather than the `.react-flow__edge` DOM — ReactFlow only stamps that class once the source/target nodes expose `<Handle>` elements, which is a sibling concern outside this task's scope.
- Tests: +36 cases (12 selectors + 22 edge component + 2 canvas wiring). Baseline `pnpm run test:smoke` 2070 → 2106, green. `pnpm run check` clean. `pnpm -F @a-conversa/moderator build` green (529.90 kB / gzip 165.39 kB — small bump from the custom edge + selectors + role-label glue). `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream consumers — the state-styling siblings (`mod_proposed_state_styling`, `mod_agreed_state_styling`, `mod_disputed_state_styling`), `mod_per_facet_state_visualization`, `mod_hover_details`, `mod_context_menus`, and the draw-edge flow in `mod_capture_flow` — now have a single `<StatementEdge>` to extend (class names, marker shape, hover behaviour) instead of re-introducing the bezier path + label glue in each task. The store-to-edges projection is the load-bearing surface; the visible edge-with-handles end-to-end lands once the node task wires `<Handle>` elements on `<StatementNode>` (a separate refinement).
