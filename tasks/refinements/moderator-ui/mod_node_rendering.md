# Moderator graph node rendering (custom ReactFlow node + localized kind label)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_node_rendering` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**:
- `moderator_ui.mod_layout.mod_graph_canvas_pane` (done — ReactFlow root mounted with empty nodes/edges and the `graph-canvas-root` test id).
- `frontend_i18n.i18n_methodology_glossary` (done — `methodology.kind.{fact,predictive,value,normative,definitional}` resolve across en-US / pt-BR / es-419).

## What this task is

Turn the empty ReactFlow canvas into one that shows the session's nodes. This task lands the **custom ReactFlow node component** (`StatementNode`) that renders a node's wording + its localized kind label, registers it on `<ReactFlow>` via `nodeTypes`, and wires `GraphCanvasPane` to read events from the WS store and project them into `Node[]` for ReactFlow to render. Edge rendering, annotation rendering, the state-styling layers (proposed / agreed / disputed), pan-zoom polish, selection, and context menus are all separate downstream tasks; this one is solely about getting node bodies on screen with the right text + localized kind label.

## Why it needs to be done

`mod_graph_canvas_pane` left ReactFlow mounted with `nodes={[]}`. Every downstream rendering task (edge rendering, state styling, axiom-mark decoration, per-facet state visualization, diagnostic highlighting, etc.) layers something onto / between nodes, so node rendering is the foundation they build on. This task is also the first surface in the moderator console that consumes `methodology.kind.*` glossary entries (the `i18n_methodology_glossary` task landed them; this is the first place a user sees one).

## Inputs / context

- [ADR 0004 — Graph libraries](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow for the moderator surface; the custom-node mechanism is the documented extension point for rendering domain content inside ReactFlow nodes.
- [ADR 0024 — Frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `react-i18next` + ICU; `useTranslation` returns `t` bound to the active locale.
- [tasks/refinements/frontend-i18n/i18n_methodology_glossary.md](../../frontend-i18n/i18n_methodology_glossary.md) — canonical `methodology.kind.<id>` mapping across the three v1 locales.
- [tasks/refinements/moderator-ui/mod_graph_canvas_pane.md](mod_graph_canvas_pane.md) — the ReactFlow mount this task fills in.
- [tasks/refinements/moderator-ui/mod_ws_client.md](mod_ws_client.md) — the WS store that owns server-state (`useWsStore`); per-session `events: Event[]` is what we project off.
- `packages/shared-types/src/events.ts` + `events/proposals.ts` — `node-created` payload (`node_id`, `wording`, ...), the `classify-node` proposal payload (the source of a node's `StatementKind`), and the `commit` resolution event (the methodology gate that turns a proposed classification into an applied one).
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.

## Constraints / requirements

- **Custom-node component**: `apps/moderator/src/graph/StatementNode.tsx`. Exports a `StatementNode` React component typed against ReactFlow's `NodeProps<StatementNodeData>`. The `StatementNodeData` interface carries the fields the renderer needs:
  - `wording: string` — the node's text.
  - `kind: StatementKind | null` — the current methodology classification, or `null` when the node is unclassified (created but no committed `classify-node` proposal yet).
- **Localized kind label via `useTranslation`.** The component calls `const { t } = useTranslation();` and renders `t('methodology.kind.' + kind)` for any non-null kind. When `kind` is null the component renders an em-dash `—` placeholder (Tailwind `text-slate-400` so the styling reads as "absent" rather than as a real label). The wording paragraph stays prominent at the top of the card; the kind label sits below it as a small uppercase tag (`text-xs`, `uppercase`, `tracking-wide`).
- **Tailwind frame.** The node body is a rounded rectangle with a 1px border, a 2-line max-width on the wording, light card shadow, and adequate padding. Concrete utility classes:
  - Root: `rounded-md border border-slate-300 bg-white shadow-sm px-3 py-2 min-w-[12rem] max-w-[18rem]`.
  - Wording: `text-sm text-slate-900 leading-snug whitespace-pre-line break-words`.
  - Kind label: `mt-1 text-xs uppercase tracking-wide text-slate-500`.
  - Test ids on the renderable fragments so tests can target them:
    - `statement-node-<id>` on the root.
    - `statement-node-wording-<id>` on the wording paragraph.
    - `statement-node-kind-<id>` on the kind label.
- **Node type key**: `'statement'`. The `nodeTypes` map registered on `<ReactFlow>` keys `StatementNode` under `statement`. Each projected `Node<StatementNodeData>` carries `type: 'statement'`. Hard-coding the literal in one place (a single `STATEMENT_NODE_TYPE = 'statement'` constant exported from `StatementNode.tsx`) keeps the registration and the projection in lockstep; ReactFlow falls back to the built-in default node type when no `type` is set, which would silently skip the custom component and is the regression to prevent.
- **`nodeTypes` is module-level, not inline.** ReactFlow re-creates its internal node map whenever `nodeTypes` changes by referential identity, and inline `{ statement: StatementNode }` literals create a fresh object every render. The map is declared once at module scope of `GraphCanvasPane.tsx` and passed in as a stable reference — the standard ReactFlow guidance for custom nodes.
- **Project events → nodes from the WS store.** `GraphCanvasPane` accepts a `sessionId: string` prop and reads `useWsStore((s) => s.sessionState[sessionId]?.events ?? emptyArray)`. The projection function (`projectNodes`, exported for direct testing) folds the event log left-to-right:
  - `node-created` → emit a new `Node<StatementNodeData>` with `id = payload.node_id`, `data.wording = payload.wording`, `data.kind = null`, and a position computed deterministically from the event sequence (see "Layout" below).
  - `commit` → resolve the referenced `proposal-event`. If that proposal's payload is `classify-node`, update the matching node's `data.kind` to the `classification` value. (Other commit kinds — substance, decompose, edit-wording, etc. — are out of scope here; they belong to later tasks. The projection ignores them.)
  - Every other event kind is ignored at this layer.
  - The projection is **pure** (input: events; output: nodes) so it tests directly without React, and so memoization in the component is straightforward (`useMemo` over `[events]`).
- **Layout.** Layout/positioning is owned by the separate `mod_layout_engine_choice` task. This task only needs *some* position so ReactFlow can render: place nodes on a deterministic grid keyed by their `node-created` sequence (e.g. `x = (i % 4) * 240`, `y = Math.floor(i / 4) * 140`). The grid keeps the test assertions concrete and the visual output orderly until the real layout engine lands. Document the choice in the component's header comment with a forward reference to `mod_layout_engine_choice`.
- **Re-render scope.** The session-id-prop pattern means `GraphCanvasPane` re-renders only when the events array reference for THAT session changes (the WS store immutably swaps the per-session record on `applyEvent`). The selector on `useWsStore` uses the function-arg form so unrelated state changes (other sessions, connection status, subscriptions) don't trigger renders.
- **`<Background />` stays.** The grid background from `mod_graph_canvas_pane` continues to render; this task adds the `nodeTypes={NODE_TYPES}` and `nodes={projectedNodes}` props to the existing `<ReactFlow>` element without changing anything else.
- **`Operate.tsx` passes the session id.** The Operate route already has `id` from `useParams`; thread it through as `<GraphCanvasPane sessionId={id} />`. The `route-operate` and `session-id` test ids stay intact (asserted by `App.test.tsx`).
- **Tests** (committed, per ADR 0022): split between two files.
  - `apps/moderator/src/graph/StatementNode.test.tsx` — direct render of `<StatementNode>` (wrapped in a minimal ReactFlow-compatible provider only if necessary; the component is a plain React tree so a bare `render(<StatementNode id="..." data={...} type="statement" ... />)` works in happy-dom). One render per `StatementKind` value (5 kinds) × 3 locales (en-US / pt-BR / es-419) asserts the kind label resolves to the right string from each catalog. One additional render for the `kind: null` case asserts the em-dash placeholder. One assertion that the wording is rendered verbatim. One assertion that the three `statement-node-*-<id>` test ids are present.
  - `apps/moderator/src/graph/GraphCanvasPane.test.tsx` (extension of the existing file) — three new cases:
    1. With one `node-created` event in `useWsStore.sessionState[sessionId].events`, the canvas renders one `.react-flow__node` and that node's body contains the wording and a localized kind label.
    2. With a `node-created` followed by a `commit` of a `classify-node` `proposal`, the rendered kind label flips from the em-dash placeholder to the localized kind text. (The proposal event is also in `events`; the projection resolves the link in-process.)
    3. With multiple `node-created` events, all of them are rendered and their wordings are present.

## Acceptance criteria

- `apps/moderator/src/graph/StatementNode.tsx` exists, exports `StatementNode`, `STATEMENT_NODE_TYPE`, and `StatementNodeData`, renders a Tailwind-framed card with the wording + localized kind label.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` registers `nodeTypes={{ statement: StatementNode }}` (declared at module scope), accepts a `sessionId: string` prop, reads `events` for that session from `useWsStore`, projects them into `Node<StatementNodeData>[]`, and passes them to `<ReactFlow>`. The previous test ids (`graph-canvas-root`) and the background grid remain.
- `apps/moderator/src/routes/Operate.tsx` threads the session id into `<GraphCanvasPane sessionId={id} />`. `App.test.tsx` continues to pass.
- `apps/moderator/src/graph/StatementNode.test.tsx` covers: kind label per locale × 5 kinds, the null-kind placeholder, the wording rendering, the test ids.
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` adds: single-node projection, commit-classify-node update, multi-node projection.
- `pnpm run check` clean, `pnpm run test:smoke` green (test count rises by the new cases).
- `pnpm -F @a-conversa/moderator build` succeeds.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_node_rendering` with a refinement note.

## Decisions

- **Custom node, not built-in label-in-node.** ReactFlow's default node renders a `data.label` string. We need (a) two distinct visual elements (wording + kind tag) and (b) i18n via `useTranslation`. A custom node component is the documented path for both.
- **`nodeTypes` declared at module scope.** Avoids the standard ReactFlow gotcha (a new map per render forces internal cache invalidation).
- **Node type key `'statement'`.** A single semantic key for the v1 moderator surface — every domain node is a "statement" in the methodology sense. Edge rendering (`mod_edge_rendering`) will register its own custom edge types separately; annotation rendering (`mod_annotation_rendering`) lands a second node-type later (different `type: 'annotation'`).
- **`kind: null` for unclassified nodes.** The wire event `node-created` does not carry a classification — classification is a separate `classify-node` proposal. The projection starts every node with `kind: null` and flips to the concrete `StatementKind` on a committed `classify-node`. The UI renders an em-dash placeholder in the null case rather than guessing a default.
- **Projection function exported for direct testing.** `projectNodes(events)` is a pure function. Testing it independently of React makes the "did we read the right events?" question answerable without happy-dom + ReactFlow + i18next on the stack.
- **Layout: deterministic grid for now.** A real layout engine is a separate task (`mod_layout_engine_choice`). A grid keyed by event sequence is the minimum that doesn't pile nodes on top of each other while keeping test assertions concrete.
- **Test ids include the node id.** `statement-node-<id>` etc. — tests can target a specific node when the canvas holds many. The pattern matches the surrounding sidebar tests (`right-sidebar-pane-<key>`).
- **Re-use the existing `ResizeObserver` stub** from `GraphCanvasPane.test.tsx`. happy-dom doesn't ship one; the existing `beforeAll` installs a no-op.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

- New `apps/moderator/src/graph/StatementNode.tsx` — custom ReactFlow node. Exports `StatementNode` (the component), `STATEMENT_NODE_TYPE = 'statement'` (the type key registered on `<ReactFlow nodeTypes>`), and `StatementNodeData` (the `data` shape: `wording: string` + `kind: StatementKind | null`). The card renders a Tailwind-framed rounded rectangle with the wording paragraph on top and a small uppercase kind tag below it. `useTranslation` resolves the kind label off `methodology.kind.<id>`; a `null` kind renders the em-dash placeholder (`text-slate-400`) so the card height stays stable regardless of classification state.
- Updated `apps/moderator/src/graph/GraphCanvasPane.tsx` — registers a module-scope `NODE_TYPES = { statement: StatementNode }` map and passes it to `<ReactFlow>`. Accepts a `sessionId: string` prop, reads `useWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS)` (the `EMPTY_EVENTS` constant is also module-scope so the selector reference stays stable across renders), and projects events to `Node<StatementNodeData>[]` via a pure `projectNodes()` function (exported for direct testing). The projection: `node-created` emits a new node with `kind: null`; `proposal` (classify-node) is cached by envelope id; a matching `commit` flips the cached classification onto the node's `data.kind`. All other event kinds are ignored. Layout is a deterministic 4-column grid (`x = (i % 4) * 240`, `y = Math.floor(i / 4) * 140`) keyed by `node-created` order — superseded once `mod_layout_engine_choice` lands.
- Updated `apps/moderator/src/routes/Operate.tsx` — threads the `id` from `useParams` into `<GraphCanvasPane sessionId={id} />`. `route-operate` and `session-id` test ids preserved; `App.test.tsx` continues to pass.
- New `apps/moderator/src/graph/StatementNode.test.tsx` — 19 Vitest cases. Asserts wording verbatim render, the three `statement-node-*-<id>` test ids, the em-dash placeholder for `kind: null`, and the per-kind × per-locale label resolution (5 kinds × 3 locales = 15 round-trip cases) using `expected[kind][locale]` values literal in the test (so a catalog drift fails here).
- Updated `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — added a `projectNodes` describe-block (5 pure-function cases: empty input, multiple node-created, grid layout, classify-commit applied, commit-without-proposal-id ignored) and a "events from the WS store render as custom nodes" describe-block (3 React-render cases: single node with placeholder kind, kind flips on classify-commit, multiple nodes). The pre-existing 5 ReactFlow-mount cases stay; the `sessionId` prop was added everywhere.
- Tests: 19 new in `StatementNode.test.tsx` + 9 new in `GraphCanvasPane.test.tsx` = +28 cases. Baseline `pnpm run test:smoke` 1895 → 1923, green. `pnpm run check` clean. `pnpm -F @a-conversa/moderator build` green (525.11 kB / gzip 163.99 kB — small growth from the custom-node component + projection). `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream consumers — every later `mod_graph_rendering.*` task (edge rendering, annotation rendering, the state-styling layers, axiom-mark decoration, per-facet state visualization, vote indicators, diagnostic highlighting, selection, context menus, draw-edge flow) — now have rendered nodes to attach behaviour and decorations to via the `statement-node-<id>` test ids and the standard ReactFlow Node API.
