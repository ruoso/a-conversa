# Moderator right-click context menus on nodes and edges

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_context_menus` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**:
- `moderator_ui.mod_graph_rendering.mod_selection` (done — `<GraphCanvasPane>` already wires `onNodeClick` / `onEdgeClick` / `onPaneClick` to `useSelectionStore`, and per-card / per-edge `data-selected` decoration is live).
- `moderator_ui.mod_graph_rendering.mod_node_rendering` (done — `<StatementNode>` is the custom ReactFlow node).
- `moderator_ui.mod_graph_rendering.mod_edge_rendering` (done — `<StatementEdge>` is the custom ReactFlow edge).

## What this task is

Wire ReactFlow's `onNodeContextMenu` / `onEdgeContextMenu` / `onPaneContextMenu` callbacks on `<GraphCanvasPane>` so a right-click on a node, an edge, or the empty pane opens a small fixed-position context menu at the cursor location. The menu lists the methodology actions the moderator can take against the right-clicked target — distinct item sets per kind:

- **Node menu**: propose vote, propose decompose, propose meta-disagreement, annotate, axiom-mark.
- **Edge menu**: propose vote, propose meta-disagreement, annotate.
- **Pane menu** (right-click on empty canvas): create new statement.

Each menu item is a localized button whose `onClick` fires a stub `console.info('menu action: <action>')` placeholder. The downstream capture / proposal flows (`mod_capture_flow.*`, `mod_propose_*`, `mod_axiom_*`) replace each stub with the real action handler; this task lands only the menu shell, the close-on-outside / close-on-Escape behavior, and the localized item labels.

This task lands:

- A `<GraphContextMenu>` component under `apps/moderator/src/graph/GraphContextMenu.tsx` that renders the menu at `{ x, y }` cursor coordinates via a fixed-position div, closes on click-outside or Escape, and accepts an `items` array of `{ id, labelKey, onSelect }` entries.
- `onNodeContextMenu` / `onEdgeContextMenu` / `onPaneContextMenu` handlers on `<ReactFlow>` inside `<GraphCanvasPane>` that:
  - `event.preventDefault()` the native browser context menu.
  - Set per-render state (`useState`) on the canvas with the target kind (`'node' | 'edge' | 'pane'`), target id (or `null` for pane), and cursor coordinates.
  - Render `<GraphContextMenu>` at the captured coordinates with the appropriate items.
- New i18n keys under `moderator.contextMenu.<action>` in all three locale catalogs (`en-US`, `pt-BR`, `es-419`), keeping catalog parity green.
- Vitest cases covering: right-click a node opens the node menu; right-click an edge opens the edge menu; right-click the pane opens the pane menu; click-outside closes; Escape closes; each menu item is rendered with the right localized label per locale.

## Why it needs to be done

The methodology actions (vote, decompose, meta-disagreement, annotate, axiom-mark, create-statement) need an entry point that doesn't require the moderator to learn keyboard shortcuts or scan a sidebar. Right-click on the target — a gesture every desktop user already knows — is the canonical "open the action list for this thing" surface in graph editors. Without this task: every downstream capture-flow / propose-flow task has nowhere to be reached from, because there is no UI seam that says "the moderator just asked to do X to entity Y."

The menu also pins the **action vocabulary** for the moderator surface: which actions live in the per-node menu, which live in the per-edge menu, which live on the pane. Downstream tasks can read that vocabulary from this refinement and the menu items without re-deciding "is axiom-mark a node action or an edge action?"

## Inputs / context

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow's `onNodeContextMenu` / `onEdgeContextMenu` / `onPaneContextMenu` props are the canonical right-click seams for the interactive-edit profile.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — every user-facing label resolves via `useTranslation` against the catalog namespace.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — the `<ReactFlow>` mount where the new context-menu handlers attach.
- `apps/moderator/src/stores/selectionStore.ts` — the existing per-entity selection store. The context-menu handlers also call `select({ kind, id })` so right-clicking selects the entity (consistent with desktop graph editors' "right-click selects then opens menu" pattern).
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — the catalogs that get the new `moderator.contextMenu.*` keys.
- `docs/methodology.md` — the action vocabulary the menu surfaces (vote / decompose / meta-disagreement / annotate / axiom-mark / create-statement).

## Constraints / requirements

- **Right-click handlers on `<ReactFlow>`**:
  - `onNodeContextMenu={(event, node) => { event.preventDefault(); useSelectionStore.getState().select({ kind: 'node', id: node.id }); setMenu({ target: { kind: 'node', id: node.id }, x: event.clientX, y: event.clientY }); }}`
  - `onEdgeContextMenu={(event, edge) => { event.preventDefault(); useSelectionStore.getState().select({ kind: 'edge', id: edge.id }); setMenu({ target: { kind: 'edge', id: edge.id }, x: event.clientX, y: event.clientY }); }}`
  - `onPaneContextMenu={(event) => { event.preventDefault(); setMenu({ target: { kind: 'pane', id: null }, x: event.clientX, y: event.clientY }); }}`
  - Each handler calls `event.preventDefault()` to suppress the native browser context menu (otherwise the browser's right-click menu appears underneath / instead of ours).
- **`<GraphContextMenu>` component** (`apps/moderator/src/graph/GraphContextMenu.tsx`):
  - Props: `{ x: number, y: number, items: readonly MenuItem[], onClose: () => void }`.
  - `MenuItem = { id: string; labelKey: string; onSelect: () => void }`.
  - Renders a `<ul role="menu" data-testid="graph-context-menu" style={{ position: 'fixed', top: y, left: x }}>` containing one `<li role="menuitem">` per item with a `<button>` child carrying `data-testid={`graph-context-menu-item-${id}`}` and a localized label from `t(labelKey)`.
  - Closes on click-outside: a `mousedown` listener on `window` calls `onClose()` when the target is outside the menu element. Listener attaches on mount, cleans up on unmount.
  - Closes on Escape: a `keydown` listener on `window` calls `onClose()` when `event.key === 'Escape'`.
  - Each menu-item `<button>`'s `onClick` calls the item's `onSelect()` then `onClose()`.
- **Action stubs**: each item's `onSelect` is a function that calls `console.info('menu action: <action>', { target })` for now. **Downstream tasks (`mod_capture_flow.*`, `mod_propose_*`, `mod_axiom_*`) replace each stub with the real action handler.** The stub mechanism is intentional — wiring real handlers here would couple this task to the unfinished capture / proposal flows.
- **i18n keys**: new entries under `moderator.contextMenu`:
  - `node.proposeVote` — "Propose vote"
  - `node.proposeDecompose` — "Propose decompose"
  - `node.proposeMetaDisagreement` — "Propose meta-disagreement"
  - `node.annotate` — "Annotate"
  - `node.axiomMark` — "Mark as axiom"
  - `edge.proposeVote` — "Propose vote"
  - `edge.proposeMetaDisagreement` — "Propose meta-disagreement"
  - `edge.annotate` — "Annotate"
  - `pane.createStatement` — "Create new statement"
  All three locale catalogs (`en-US`, `pt-BR`, `es-419`) get the same key set; the parity check stays green.
- **Test seams** (data-testids):
  - `graph-context-menu` on the menu root.
  - `graph-context-menu-item-<id>` on each item button.
  - `graph-context-menu-target-kind` and `graph-context-menu-target-id` data attributes on the menu root so tests can target the menu by what it points at.
- **No regressions to existing handlers**: the existing `onNodeClick` / `onEdgeClick` / `onPaneClick` handlers (left-click → select) stay; the new context-menu handlers are additive.

## Acceptance criteria

- `pnpm run check` passes (lint + format + typecheck).
- `pnpm run test:smoke` passes; new tests cover the cases listed under "What this task is."
- `pnpm -F @a-conversa/moderator build` produces a clean production bundle.
- `pnpm --filter @a-conversa/i18n-catalogs run check` passes (catalog parity).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
- The refinement gets a `## Status` block on completion, and `tasks/30-moderator-ui.tji`'s `mod_context_menus` entry gets `complete 100` plus a `note "Refinement: tasks/refinements/moderator-ui/mod_context_menus.md"` line.

## Decisions

- **Menu state lives on `<GraphCanvasPane>`, not in a Zustand store.** The open-menu position is a transient UI fact tied to a single component's lifetime — it isn't read from elsewhere on the surface (the right sidebar / mode banner don't care where the menu is), so a `useState` keeps the scope honest. A future `useContextMenuStore` slice could land if a second surface needs to drive the menu open, but that's YAGNI for v1.
- **Right-click also selects.** Mirrors desktop graph editors (yEd, Cytoscape Desktop, draw.io). The moderator's expectation is "what I right-click is what the next action targets" — and `<StatementNode>` / `<StatementEdge>` already read selection from `useSelectionStore` to show the sky-500 ring, so right-click flips that ring automatically. Reuses the existing `select({ kind, id })` API.
- **Action handlers are stubs that `console.info` until downstream tasks replace them.** Wiring real handlers here would either (a) couple this task to the unfinished capture / proposal flows, blocking the menu seam landing until every downstream task ships, or (b) re-implement the flows inline, duplicating the work. The stub mechanism keeps the menu shell decoupled — downstream tasks need only swap in a real `onSelect` to take over.
- **Click-outside via window-level `mousedown`, not a ReactFlow callback.** ReactFlow doesn't expose a canonical "click anywhere except inside this menu" hook; window-level mousedown with a `contains()` check on the menu element is the standard React idiom for floating menus, and it composes correctly with ReactFlow's own pan / drag listeners (pan starts on mousedown — we close the menu and the pan proceeds).
- **Pane right-click currently lists only "create new statement"**, mirroring how desktop graph editors offer "new node" on empty-canvas right-click. If downstream review wants additional pane actions (e.g., "paste statement"), the menu shell already supports an arbitrary `items` array.
- **`event.preventDefault()` on each handler is mandatory**, not optional. Without it the browser's native context menu appears on top of (or instead of) ours.
- **`data-testid` is the test seam, not the role attribute or the className.** Aligns with the existing decision in `mod_selection` and `mod_node_rendering` — Tailwind class strings and ARIA-role queries aren't load-bearing across refactors; the data-testid stays stable.

## Open questions

(none — all decided; the action-handler stubs are explicitly time-bounded by downstream-task ownership.)

## Status

**Done** — 2026-05-11.

- `<GraphContextMenu>` component in `apps/moderator/src/graph/GraphContextMenu.tsx`. Renders an `<ul role="menu" data-testid="graph-context-menu">` at the cursor coordinates via `position: fixed`, with one `<li role="none">`/`<button role="menuitem" data-testid="graph-context-menu-item-<id>">` per item. Closes on outside `mousedown` (window-level listener with a `contains()` check on the menu root), on `Escape` keydown, and after any item is selected. The `data-target-kind` / `data-target-id` data attributes are stamped on the menu root as test seams.
- Wire-up in `apps/moderator/src/graph/GraphCanvasPane.tsx`: `useState<ContextMenuState | null>` on the canvas; three new `useCallback` handlers (`handleNodeContextMenu` / `handleEdgeContextMenu` / `handlePaneContextMenu`) each call `event.preventDefault()`, then `useSelectionStore.getState().select({ kind, id })` (node / edge only — pane right-click doesn't select), then `setContextMenu({ target, x: event.clientX, y: event.clientY })`. Wired onto `<ReactFlow onNodeContextMenu={...} onEdgeContextMenu={...} onPaneContextMenu={...}>`.
- Three exported menu-item factories in `GraphCanvasPane.tsx` — `buildNodeMenuItems` (5 items: propose-vote, propose-decompose, propose-meta-disagreement, annotate, axiom-mark), `buildEdgeMenuItems` (3 items: propose-vote, propose-meta-disagreement, annotate), `buildPaneMenuItems` (1 item: create-statement). Each item's `onSelect` calls a `console.info('menu action: <action>', target)` stub via the internal `actionStub` helper; the stubs are explicitly time-bounded by downstream-task ownership (the relevant `mod_capture_flow.*`, `mod_propose_*`, `mod_axiom_*` tasks each replace one stub with the real action handler).
- New i18n keys under `moderator.contextMenu.{node,edge,pane}.*` added to all three locale catalogs (`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`). Catalog parity check passes at 140 keys per locale.
- Vitest cases added (47 new tests; project total 2322 → 2369):
  - `apps/moderator/src/graph/GraphContextMenu.test.tsx` (37 new): the menu renders at the requested `{ x, y }` via `position: fixed`; `data-target-kind` / `data-target-id` are stamped; every item is rendered as a `<button data-testid="graph-context-menu-item-<id>">`; clicking an item fires `onSelect` then `onClose`; window-level `mousedown` outside the menu calls `onClose`; `mousedown` inside the menu does NOT call `onClose`; `Escape` calls `onClose`; non-Escape keys do not; listeners are removed on unmount; every menu-item label resolves to the catalog-correct string for en-US / pt-BR / es-419 (9 labels × 3 locales = 27 cross-locale parity cases).
  - `apps/moderator/src/graph/GraphCanvasPane.test.tsx` (10 new): the `buildNodeMenuItems` / `buildEdgeMenuItems` / `buildPaneMenuItems` factories return the documented action sets in order with the documented labelKeys; all 9 stubs are callable without throwing and emit exactly 9 `console.info` calls; right-clicking a rendered node opens the node menu with `data-target-kind="node"` and every node-scope item; right-clicking a node also selects it; right-clicking the pane background (`.react-flow__pane`) opens the pane menu; selecting any menu item closes the menu; `Escape` closes the menu; an outside `mousedown` closes the menu.
- `pnpm run check`, `pnpm run test:smoke`, `pnpm -F @a-conversa/moderator build`, `pnpm --filter @a-conversa/i18n-catalogs run check` (140 keys / 3 locales) all clean. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream tasks (`mod_capture_flow.*`, `mod_propose_*`, `mod_axiom_*`) each replace one `actionStub(...)` call with the real action handler; the menu shell, the close-on-outside / close-on-Escape behavior, the cursor-position seam, and the localized labels are pinned by this task.
