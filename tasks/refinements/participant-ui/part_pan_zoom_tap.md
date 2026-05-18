# Pan, zoom, and tap-to-detail interactions on the participant graph

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_pan_zoom_tap`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_graph_view.part_graph_render` (settled — commit landing `part_graph_render`. Shipped `<GraphView>` with `cytoscape({ container, style: STYLESHEET, elements: [], layout: { name: 'preset' } })` — a bare config that does NOT pin `userPanningEnabled` / `userZoomingEnabled` / `boxSelectionEnabled` / `selectionType` / `autoungrabify`. Cytoscape's library defaults are: `userPanningEnabled: true`, `userZoomingEnabled: true`, `boxSelectionEnabled: true`, `selectionType: 'single'` (when `boxSelectionEnabled: false`) or `'additive'` (when `true`), `autoungrabify: false`. Today the participant can already drag-pan + scroll-zoom + click-to-select (Cytoscape's built-in selection paints a yellow-ish overlay that the surface has no stylesheet branch for), and CAN box-select nodes by mouse-drag — all behaviours that this leaf pins explicitly. The seam this leaf consumes: `cyInstance` (the `useState<Core | null>` slot promoted in `part_other_vote_indicators_canvas_dots` Decision §2) is the live `Core` handle for downstream tap-event subscription; the existing optional `cyRef` callback prop stays an external escape hatch).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_other_vote_indicators_canvas_dots` (settled — installed `<OtherVotesOverlay>` as a `pointer-events: none` sibling of the Cytoscape canvas mount inside the `participant-graph-root` `position: relative` container. Confirms the layered-overlay-with-clicks-passing-through pattern works: any new overlay (including a future selection-decoration overlay if needed) follows the same recipe. The overlay's `cy.on('render pan zoom resize', …)` + `cy.on('position', 'node', …)` + `cy.on('add remove data', …)` subscription set is the canonical "subscribe to Cytoscape events without disturbing user gestures" idiom this leaf extends with a `tap` subscription).
- Prose-only context (NOT a `.tji` edge): `!moderator_ui.mod_graph_rendering.mod_pan_zoom` (settled — the moderator's parallel "pin the contract behind tests" task. The participant takes the same posture (pin defaults explicitly, widen the zoom range) but adapts to Cytoscape's vocabulary instead of ReactFlow's. The empirical zoom-range numbers from the moderator (`MIN_ZOOM = 0.1`, `MAX_ZOOM = 2.5`) carry over verbatim — same dagre-vs-cose layout span × viewport-size ratio applies on the participant tablet, and the same close-read 2.5x cap on a `max-w-[18rem]` card body applies because the participant nodes use Cytoscape `width: 200, height: 80` per `part_graph_render`).
- Prose-only context (NOT a `.tji` edge): `!moderator_ui.mod_graph_rendering.mod_selection` (settled — established the canonical `useSelectionStore.getState().select({ kind, id })` / `.clear()` seam for click-to-select, plus the `data-selected="true|false"` test attribute on each rendered entity. The participant `useSelectionStore` at [`apps/participant/src/stores/selectionStore.ts:30`](../../../apps/participant/src/stores/selectionStore.ts#L30) is a line-for-line port of the moderator's — same `Selection = { kind: EntityKind; id: string }` shape, same `select` / `clear` API, same `EntityKind` import from `@a-conversa/shared-types`. This leaf wires the Cytoscape `tap` event into the SAME store the moderator wires its ReactFlow `onNodeClick` / `onEdgeClick` / `onPaneClick` handlers into — cross-surface seam continuity for the eventual `part_entity_detail_panel`).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_per_facet_state_styling` (settled — established the DOM-mirror seam (`<ul data-testid="participant-graph-status-mirror" aria-hidden="true" className="sr-only">` with one `<li data-testid="participant-node-status" data-node-id=…>` / `<li data-testid="participant-edge-status" data-edge-id=…>` per emitted element). This leaf extends the mirror with `data-selected="true|false"` on each `<li>` — same posture as the moderator's `<StatementNode>` / `<StatementEdge>` `data-selected` stamp from `mod_selection` Decision §2).

## What this task is

Wire the read-mostly participant `<GraphView>` Cytoscape canvas to interactive gestures:

- **Pan**: drag the canvas background with the left mouse button (one-finger touch on tablet) to move the viewport. Cytoscape default; this leaf pins it explicitly per the [`mod_pan_zoom`](../moderator-ui/mod_pan_zoom.md) "explicit configuration is the test seam" rationale.
- **Zoom**: scroll the wheel (or trackpad pinch / two-finger scroll) over the canvas to zoom the viewport. Cytoscape default; this leaf pins it explicitly AND widens the zoom range from Cytoscape's `[1e-50, 1e50]` defaults to the empirical `[0.1, 2.5]` range the moderator pinned (same calibration — dagre/cose layout span × viewport size × card body width).
- **Tap-to-detail**: single-tap (click on desktop, tap on tablet) a node or edge to select it; tap on the empty canvas to clear. The selection writes through to the existing `useSelectionStore` (line-for-line port of the moderator's at [`apps/participant/src/stores/selectionStore.ts:30`](../../../apps/participant/src/stores/selectionStore.ts#L30)) so the future `part_entity_detail_panel` can subscribe to `useSelectionStore((s) => s.selected)` and render the detail panel for whatever's selected — same architecture as the moderator's `<ContextMenu>` + `<HoverPopover>` consumers.

Concretely the deliverable is:

- A small extension to [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx)'s `cytoscape({ … })` mount config (one-shot mount effect at [`GraphView.tsx:711-736`](../../../apps/participant/src/graph/GraphView.tsx#L711)): explicit `userPanningEnabled: true`, `userZoomingEnabled: true`, `boxSelectionEnabled: false`, `selectionType: 'single'`, `autoungrabify: true`, `minZoom: MIN_ZOOM`, `maxZoom: MAX_ZOOM`. Module-scope `export const MIN_ZOOM = 0.1; export const MAX_ZOOM = 2.5;` constants alongside the existing `EMPTY_EVENTS` / `EMPTY_DIAGNOSTICS_MAP` / `STYLESHEET` exports (so the test file imports the same source of truth — same idiom the moderator's `mod_pan_zoom` adopts).
- A small extension to the same mount effect: `cy.on('tap', handleTap)` registration after the cy mount, with cleanup `cy.removeListener('tap', handleTap)` in the effect's return. The handler is a module-scope function (referentially stable, no React state needed — it only writes to `useSelectionStore.getState()`) per the moderator's `mod_selection` Decision §4 ("`getState()` in handlers, not the hook"). The handler discriminates on `event.target === cy` (tap on empty canvas → `clear()`), `event.target.isNode()` (tap on node → `select({ kind: 'node', id })`), `event.target.isEdge()` (tap on edge → `select({ kind: 'edge', id })`).
- A new Cytoscape stylesheet branch in `STYLESHEET` for the selected state: `node:selected` and `edge:selected`. Cytoscape's built-in `:selected` pseudo-class fires when an element is in the cy instance's selection set (the tap handler also calls `event.target.select()` to add the element to the cy selection set, and `cy.elements().unselect()` to clear it on empty-canvas tap). The new branch paints a `z-index` bump (move to top so the selected element draws above neighbours) plus a `background-blacken: -0.15` for nodes (slight lightening — none of the prior layers claim `background-blacken`, so no override collision) and a `line-color` saturation bump for edges (override the per-status `line-color` only on the selected branch — recoverable when the element unselects).
- The localized `elements` memo at [`GraphView.tsx:872-898`](../../../apps/participant/src/graph/GraphView.tsx#L872) carries a NEW flat `selected: boolean` data slot derived from `useSelectionStore((s) => s.selected)` so the DOM mirror can stamp `data-selected="true|false"` on each `<li>` row — extending the mirror's existing per-attribute posture (`data-rollup-status`, `data-is-axiom`, `data-has-annotation`, `data-annotation-count`, `data-diagnostic-severity`, `data-diagnostic-kinds`, `data-own-vote`). The mirror's selected attribute is what Playwright asserts against (canvas paints to `<canvas>`, Cytoscape's `:selected` overlay is not DOM-queryable per the prior layers' rationale).
- A small extension to [`cytoscapeTestEnv.ts`](../../../apps/participant/src/graph/cytoscapeTestEnv.ts) — NONE NEEDED. The existing rAF / canvas / `ResizeObserver` stubs are sufficient; Cytoscape's `cy.emit('tap', { target: … })` runs the registered tap handler synchronously without rAF batching (the tap surface is event-driven, not animation-frame-driven).
- Tests pin: Vitest at the GraphView layer (the `cytoscape({ … })` mount config carries the explicit flags and `MIN_ZOOM` / `MAX_ZOOM` references; the tap handler writes through to `useSelectionStore`; the stylesheet contains the `:selected` branches; the DOM mirror surfaces `data-selected` correctly across the three tap cases — node, edge, empty canvas — observed via `cy.emit('tap', …)` orchestration). Playwright at the e2e layer extends `tests/e2e/participant-graph-render.spec.ts` with a 9th `test()` block following the role-swap pattern the predecessor leaves pioneered (block 9: `erin + frank` — the inverse of block 3's `frank + erin`).

Out of scope (deferred to existing or future leaves):

- **`<part_entity_detail_panel>` itself.** This leaf is the SEAM-BUILDER for the detail panel — it makes the selection observable via `useSelectionStore` AND via `data-selected` on the DOM mirror, but does NOT render any per-entity detail surface. The detail panel is its own sibling leaf (`part_entity_detail_panel`, 1d, `depends !part_pan_zoom_tap`) that subscribes to `useSelectionStore((s) => s.selected)` and renders the per-node / per-edge detail content.
- **Tap-to-zoom (double-tap zooms in, double-tap-with-modifier zooms out)** — Cytoscape's `cy.userZoomingEnabled(true)` covers scroll/pinch zoom; double-tap zoom is a separate Cytoscape config (`cy.zoom({ level, position })` programmatically inside a `dbltap` handler). Deferred — the v1 zoom gesture is wheel/pinch only, mirroring the moderator's `mod_pan_zoom` Decision §6 ("`zoomOnDoubleClick: true`" was kept as the ReactFlow default; Cytoscape does NOT have a parallel default, so adopting double-tap zoom is a NEW gesture — deferred per the same "no new interaction vocabulary without explicit need" rule).
- **Keyboard shortcuts for pan/zoom** (e.g. arrow keys for pan, `+`/`-` for zoom, `0` for fit-view). Same scope-creep rationale as `mod_pan_zoom` Decision §7 — gesture-driven only for v1.
- **A standalone "Fit view" / "Reset zoom" button.** The moderator has a Tidy up button via `mod_layout_tidy_action`; the participant has no equivalent because the participant uses `cose` (Decision §3 of `part_graph_render` — re-layout on every projection change is acceptable for the read-mostly profile, no position cache, no per-button tidy gesture). The first auto-layout pass per WS frame IS the fit-view; downstream polish (`part_fit_view_button`, future) can add a manual gesture if real-world sessions show drift.
- **Box-selection / multi-select.** Pinned OFF (`boxSelectionEnabled: false`, `selectionType: 'single'`) — the detail panel surfaces ONE entity at a time per the methodology's tap-an-entity-see-its-facets loop. Multi-select would need a different detail panel surface; out of scope.
- **Node-drag** (manual repositioning by the user). Pinned OFF (`autoungrabify: true`) — the participant is read-mostly; the moderator is the operator. A debater dragging a node would visually desynchronise from every other debater + the moderator (no `node-moved` wire event today, no shared position state). The `cose` layout owns positions; manual grab would fight it.
- **Visual regression on the selected-state stylesheet.** Pixel comparisons are deferred per the pattern every prior visual-layer leaf adopted; the `data-selected` DOM-attribute assertion + the `:selected` stylesheet selector presence are the load-bearing test contract.
- **Per-element hover effect** (e.g. a subtle background shift on cursor hover for desktop users). Cytoscape has `cy.on('mouseover', 'node', …)` + a `:active` pseudo-class for the pressed-but-not-released state; out of scope. v1 ships click-to-select only; hover affordances are a polish-stage concern (probably `part_hover_details`, future, paralleling `mod_hover_details`).
- **Symmetric extension to the moderator's `<GraphCanvasPane>`.** The moderator's `mod_pan_zoom` + `mod_selection` are settled with ReactFlow; this leaf is the participant equivalent with Cytoscape. No cross-surface refactor.

## Why it needs to be done

`m_participant_mvp` ([`tasks/99-milestones.tji`](../../99-milestones.tji)) is the milestone at which a debater can see AND ENGAGE with the live graph from their tablet. `part_graph_render` lit up the rendering surface — the debater can SEE every node, edge, status, axiom-mark, annotation, diagnostic, own-vote, and other-vote — but the surface is PASSIVE. The methodology assumes the debater can engage with the graph as part of the agreement loop:

- [`docs/methodology.md`](../../../docs/methodology.md) — the format's per-facet voting flow is gated on the debater inspecting a single facet, deciding their vote, and surfacing per-vote attribution. Without tap-to-select, the debater has no way to ask "what are the per-facet states of THIS node?" — they can only read the at-a-glance signals the canvas already paints (rollup status, own-vote ring, other-vote dots) and the DOM mirror (which is `aria-hidden` and not user-visible).
- The pan + zoom gestures are the cross-debate navigation vocabulary: a dense debate with 30+ entities spans a canvas larger than the tablet viewport at default zoom; the debater must be able to scroll the canvas to read distant entities and zoom to fit-view when re-orienting.
- The downstream `part_entity_detail_panel` task explicitly depends on this leaf (`depends !part_pan_zoom_tap` per [`tasks/40-participant-ui.tji:178`](../../40-participant-ui.tji#L178)) — the detail panel reads `useSelectionStore((s) => s.selected)` to know what to render. Without the tap handler this leaf installs, the detail panel has nothing to subscribe to.

Closing this leaf closes the last READY leaf in the `part_graph_view` subgroup (only `part_entity_detail_panel` remains BLOCKED, waiting on this task's selection seam). After this leaf, `part_entity_detail_panel` unblocks and the `part_graph_view` group can close.

Downstream concretely:

- **`part_entity_detail_panel`** (the React-driven tap-to-detail panel) reads `useSelectionStore((s) => s.selected)` and renders the per-node / per-edge detail content. The selection writes through this leaf's tap handler; no other surface writes the selection store today.
- **`part_voting.part_vote_button_per_facet`** (future P2 leaf) reads the selected entity from `useSelectionStore` to know which facets to surface vote buttons for. The selection seam this leaf installs is the canonical entity-selection surface across the participant graph; the voting controls anchor to it.
- **`audience.aud_graph_render`** (future, third Cytoscape consumer) — if it also needs tap-to-detail, the extracted `pan/zoom/tap` config can lift into `@a-conversa/shell` at that point. Two-callers-is-YAGNI per the existing extraction policy; this leaf's mount config + tap handler stays local for now.

Architecturally, this leaf composes a fourth Cytoscape-vocabulary layer on top of the participant graph: the prior layers paint **state** (per-status, axiom, annotation, diagnostic, own-vote) and **decoration** (per-other-voter dot row); this leaf adds **interaction**. The four layers are independent — pan/zoom doesn't touch any of the existing data fields, tap-to-select writes to the dedicated `useSelectionStore` (orthogonal to the WS slice), and the selected-state stylesheet branch claims a previously-unclaimed primitive (`z-index` + `background-blacken` for nodes; `line-color` recoverable override for edges) so composition with the prior layers is clean.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Cytoscape on the participant surface. The library exposes `cy.on('tap', cb)` / `cy.on('tap', 'node', cb)` / `cy.on('tap', 'edge', cb)` as the canonical tap-event vocabulary; `userPanningEnabled` / `userZoomingEnabled` / `minZoom` / `maxZoom` / `boxSelectionEnabled` / `selectionType` / `autoungrabify` are the mount-config flags. No new top-level dependency — this leaf consumes the bare library directly per `part_graph_render` Decision §1 (no `react-cytoscapejs` wrapper).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behavioural assertion below is a committed Vitest case or Playwright scenario. Failing-first verification per the predecessor leaves' pattern.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation()` is the participant surface's localization seam. This leaf adds NO new user-facing strings; pan/zoom/tap are gesture-driven (the selected state has no caption text, no aria-label — the at-a-glance signal is the visual `:selected` stylesheet branch + the DOM-mirror `data-selected` seam).
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the surface owns its mounted region only; the tap handler + selection store live entirely in the participant workspace.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the selection-store `Selection = { kind: EntityKind; id: string }` discriminator uses the entity-layer vocabulary (`'node' | 'edge' | 'annotation'`); facets are addressed via the detail panel's per-facet rendering, not via selection.

No new ADR. Every decision below applies an existing ADR or mirrors a settled moderator-side decision (`mod_pan_zoom` + `mod_selection`).

### Sibling refinements

- [`tasks/refinements/moderator-ui/mod_pan_zoom.md`](../moderator-ui/mod_pan_zoom.md) — the canonical reference for "pin the pan/zoom contract behind tests + widen the zoom range to fit the empirical layout span." The participant adopts the same posture with Cytoscape's mount-config vocabulary (`userPanningEnabled`, `userZoomingEnabled`, `minZoom`, `maxZoom`) instead of ReactFlow's prop vocabulary (`panOnDrag`, `zoomOnScroll`, `minZoom`, `maxZoom`). The empirical `MIN_ZOOM = 0.1` / `MAX_ZOOM = 2.5` numbers carry over verbatim — same calibration applies because the participant nodes use Cytoscape `width: 200, height: 80` per `part_graph_render`'s STYLESHEET, the dagre-vs-cose layout span × viewport ratio is the same order of magnitude, and the close-read 2.5x cap on a 200px-wide card matches the moderator's 2.5x cap on a `max-w-[18rem]` (288px) card.
- [`tasks/refinements/moderator-ui/mod_selection.md`](../moderator-ui/mod_selection.md) — the canonical reference for click-to-select wiring to `useSelectionStore.getState().select({ kind, id })` / `.clear()`, the module-scope handler pattern ("`getState()` in handlers, not the hook"), and the `data-selected="true|false"` test attribute. The participant adopts the same patterns; the only differences are (a) Cytoscape's `tap` event vs. ReactFlow's `onNodeClick` / `onEdgeClick` / `onPaneClick` — one event with target discrimination vs. three event handlers, mechanically equivalent; (b) the participant doesn't have React custom-node components (Cytoscape renders to canvas), so the `data-selected` lives on the DOM-mirror `<li>` rows instead of on a React-tree node card.
- [`tasks/refinements/participant-ui/part_graph_render.md`](part_graph_render.md) — the predecessor that installed `<GraphView>` + the cytoscape mount + `STYLESHEET` + `cytoscapeTestEnv`. Decision §1 (consume Cytoscape directly, no `react-cytoscapejs` wrapper) carries over; Decision §3 (cose layout, no dagre) carries over; the seam this leaf consumes is the `cytoscape({ … })` config call at [`GraphView.tsx:714-719`](../../../apps/participant/src/graph/GraphView.tsx#L714) which this leaf extends with 7 explicit flags.
- [`tasks/refinements/participant-ui/part_other_vote_indicators_canvas_dots.md`](part_other_vote_indicators_canvas_dots.md) — established the `pointer-events: none` overlay pattern (the canvas-dots overlay sits ABOVE the Cytoscape canvas without intercepting clicks). This leaf verifies that taps still reach Cytoscape correctly through the overlay — the `<OtherVotesOverlay>` carries `className="pointer-events-none absolute inset-0"` so the layered z-order does not break the tap-to-select wiring. Decision §10 walks the cross-layer verification.
- [`tasks/refinements/participant-ui/part_per_facet_state_styling.md`](part_per_facet_state_styling.md) — established the DOM mirror infrastructure + the per-attribute posture (`data-rollup-status`, `data-facet-*`). This leaf extends the mirror with `data-selected="true|false"` per Decision §7 — symmetric across node + edge `<li>` rows per the existing attribute pattern.
- [`tasks/refinements/participant-ui/part_own_vote_indicators.md`](part_own_vote_indicators.md) — established the stylesheet override-vs-compose semantics. The own-vote layer claimed `text-outline-*` (the label outline); diagnostic claimed `border-color` override; annotation claimed `overlay-*` (nodes) and `underlay-*` (edges); axiom claimed `border-style: 'double'` + `border-width: 3`; per-status claimed `border-color` + `background-color` + `opacity`; rollup claimed `outline-*` (rose / violet rings). The previously-unclaimed Cytoscape primitives this leaf can use for the selected-state branch are: `z-index` (no prior consumer), `background-blacken` (no prior consumer; node fill darkening / lightening), `overlay-*` on edges (Cytoscape doesn't accept `overlay-*` on edges — only `underlay-*`, which annotation+diagnostic claim), and `font-weight` (no prior consumer). Decision §4 picks `z-index` bump + `background-blacken: -0.15` for nodes (slight lightening), `line-color` recoverable override for edges (selected-only, so the per-status `line-color` is restored on unselect).

### Live code the leaf plugs into

- [`apps/participant/src/graph/GraphView.tsx:711-736`](../../../apps/participant/src/graph/GraphView.tsx#L711) — the one-shot Cytoscape mount effect. This leaf extends the `cytoscape({ … })` config object with 7 explicit flags (`userPanningEnabled: true`, `userZoomingEnabled: true`, `minZoom: MIN_ZOOM`, `maxZoom: MAX_ZOOM`, `boxSelectionEnabled: false`, `selectionType: 'single'`, `autoungrabify: true`). The effect also registers the tap handler via `cy.on('tap', handleTap)`; the cleanup adds `cy.removeListener('tap', handleTap)` alongside the existing `cy.destroy()`.
- [`apps/participant/src/graph/GraphView.tsx:220-554`](../../../apps/participant/src/graph/GraphView.tsx#L220) — the `STYLESHEET` constant. This leaf appends TWO new selectors: `node:selected` and `edge:selected`. The new selectors use Cytoscape's built-in `:selected` pseudo-class (the tap handler also calls `event.target.select()` / `cy.elements().unselect()` to write through to the cy selection set). Decision §4 walks the chosen visual primitive.
- [`apps/participant/src/graph/GraphView.tsx:872-898`](../../../apps/participant/src/graph/GraphView.tsx#L872) — the localized `elements` memo. This leaf does NOT thread a new prop through `projectGraph` — the selected state is per-render-frame UI state, not projection state. Instead, the memo reads `useSelectionStore((s) => s.selected)` directly inside `<GraphView>` and stamps a `selected: boolean` flag on each localized element's `data` record (the flag is `selected?.kind === 'node' && selected.id === node.data.id` for nodes; symmetric for edges). The `:selected` Cytoscape pseudo-class fires off Cytoscape's INTERNAL selection set (synced by the tap handler), not off the `data.selected` flag — the `data.selected` flag is the source of truth the DOM mirror reads; the cy selection set is the source of truth the stylesheet's `:selected` pseudo reads; the tap handler keeps the two in lockstep.
- [`apps/participant/src/graph/GraphView.tsx:928-1023`](../../../apps/participant/src/graph/GraphView.tsx#L928) — the return JSX. This leaf extends the DOM-mirror `<li>` rows (both kinds) with a new `data-selected` attribute. NO change to the return JSX's overall structure; just one more attribute per `<li>` row.
- [`apps/participant/src/graph/cytoscapeTestEnv.ts`](../../../apps/participant/src/graph/cytoscapeTestEnv.ts) — UNCHANGED. The existing rAF / canvas / `ResizeObserver` polyfills are sufficient; tap events propagate synchronously via `cy.emit('tap', { target: … })` without rAF batching.
- [`apps/participant/src/stores/selectionStore.ts:30`](../../../apps/participant/src/stores/selectionStore.ts#L30) — `useSelectionStore`. Already exists (shipped by `part_state_management`); this leaf is the FIRST writer (and the entity-detail-panel will be the first reader). The store's `select({ kind, id })` / `clear()` API is consumed verbatim — no extension needed.
- [`apps/participant/src/graph/OtherVotesOverlay.tsx:196-200`](../../../apps/participant/src/graph/OtherVotesOverlay.tsx#L196) — the `pointer-events: none` overlay root. Verified by this leaf's Vitest case (Decision §10): taps that originate within the overlay's screen-space rectangle still propagate to the Cytoscape canvas because the overlay does not capture pointer events.

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/fixtures/auth.ts:118-131`](../../../tests/e2e/fixtures/auth.ts#L118) — `DEV_USER_POOL` (12 users). The pool is exhausted as fresh pairs; the 7th block adopted `alice + ben` role-swap; the 8th adopted `dave + maria` role-swap; this leaf's 9th block uses `erin + frank` — the inverse of block 3's `frank + erin` per Decision §7. The per-block-isolated `freshContext` + `createSession` (each block creates its own session) guarantees no race on session state even when usernames re-appear.
- [`tests/e2e/participant-graph-render.spec.ts:1949-2272`](../../../tests/e2e/participant-graph-render.spec.ts#L1949) — the existing 8th `test()` block (`dave + maria` role-swap). This leaf adds a 9th block following the same role-swap pattern with `erin + frank`.
- [`tests/e2e/participant-graph-render.spec.ts:64-101`](../../../tests/e2e/participant-graph-render.spec.ts#L64) — `createSession`, `logoutAndClearAllCookies`, `freshContext` helpers. The 9th `test()` block reuses them verbatim.
- [`playwright.config.ts`](../../../playwright.config.ts) — `chromium-participant-skeleton` already matches `participant-graph-render.spec.ts`. No config change needed. The new block runs in parallel under `fullyParallel`.

### What the surface MUST NOT do

- **No call to `cy.userPanningEnabled(false)` / `cy.userZoomingEnabled(false)`.** This leaf pins both ON explicitly via mount-config flags; runtime toggling is for downstream tasks (none planned today).
- **No `panOnScroll` analog.** Cytoscape does not have a `panOnScroll: true` flag (the wheel = zoom semantics is hard-coded); this leaf inherits the desktop-graph-editor idiom (wheel = zoom) by virtue of `userZoomingEnabled: true`.
- **No `defaultZoom` / `pan: { x, y }` config.** Cytoscape's first-paint defaults (`zoom: 1`, `pan: { x: 0, y: 0 }`) compose correctly with `cy.layout({ name: 'cose' }).run()` — the `cose` layout positions nodes centred around `(0, 0)` in model coords and the default `(0, 0)` pan + `1` zoom puts those positions in the viewport centre.
- **No `<Controls />`-style on-canvas zoom-buttons widget.** Cytoscape ships no built-in controls component; adding one would mint a new UI affordance + new i18n keys. Out of scope; gesture-driven only for v1 (parallel to `mod_pan_zoom` Decision §7).
- **No drag-to-create-edge, no context menus, no inline edit.** Read-only profile per ADR 0004 and per [docs/participant-ui.md](../../../docs/participant-ui.md). Those gestures are moderator-exclusive.
- **No `cy.fit()` / `cy.center()` button.** The first auto-layout pass per WS frame IS the fit-view; `mod_pan_zoom` Decision §8 (no Reset zoom button) carries over.
- **No mutation of the `useWsStore` from the tap handler.** Tap writes to `useSelectionStore` (UI state), NOT to the WS slice (server-truth state). The two stores are independent; the detail panel reads the selection AND reads the per-entity WS data.
- **No `localStorage` / `sessionStorage` writes from the selection handler.** The selection is in-memory only; if the user reloads the page, selection is cleared (acceptable — the methodology assumes the debater re-engages with the live graph on reload, not with prior UI state).
- **No `window.location` writes from the tap handler.** Tap is a UI gesture, not a route-change gesture.
- **No interception of pointer events on overlays.** The `<OtherVotesOverlay>` already carries `pointer-events: none` so taps pass through; this leaf verifies the property holds. Future overlays must follow the same posture or the tap-to-select wiring breaks.
- **No new top-level dependency.** No `cytoscape-popper`, no `cytoscape-tippy`, no positioning library. The tap handler + selection store are plain Cytoscape + Zustand; the stylesheet branch is plain Cytoscape syntax.
- **No new Cytoscape stylesheet selectors beyond `node:selected` / `edge:selected`.** Two new selectors only; no per-status × selected matrix (the `:selected` branch composes additively with the per-status branches via Cytoscape's selector cascade).
- **No removal or modification of the existing DOM mirror's other attributes** (`data-rollup-status`, `data-is-axiom`, etc.). The `data-selected` attribute is ADDITIVE.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/graph/GraphView.tsx` — modified. (1) Add module-scope exports `export const MIN_ZOOM = 0.1; export const MAX_ZOOM = 2.5;` alongside the existing `EMPTY_EVENTS` / `EMPTY_DIAGNOSTICS_MAP` / `STYLESHEET` exports. (2) Add a module-scope `handleTap` function: `function handleTap(event: EventObject): void { const target = event.target; if (target === event.cy) { event.cy.elements().unselect(); useSelectionStore.getState().clear(); return; } if (target.isNode()) { target.select(); useSelectionStore.getState().select({ kind: 'node', id: target.id() }); return; } if (target.isEdge()) { target.select(); useSelectionStore.getState().select({ kind: 'edge', id: target.id() }); return; } }`. The handler also calls `event.cy.$(':selected').not(target).unselect()` BEFORE the target.select() so the per-tap surface enforces single-selection semantics (Cytoscape's `selectionType: 'single'` config flag handles this internally too, but the explicit call defends against any version-skew). (3) Extend the `cytoscape({ … })` mount config (lines 714-719) with 7 explicit flags + the tap handler registration: `userPanningEnabled: true`, `userZoomingEnabled: true`, `minZoom: MIN_ZOOM`, `maxZoom: MAX_ZOOM`, `boxSelectionEnabled: false`, `selectionType: 'single'`, `autoungrabify: true`. (4) Add `cy.on('tap', handleTap)` AFTER the cy mount and `cy.removeListener('tap', handleTap)` in the effect's return BEFORE `cy.destroy()`. (5) Append two new `STYLESHEET` entries: `{ selector: 'node:selected', style: { 'z-index': 10, 'background-blacken': -0.15 } }` and `{ selector: 'edge:selected', style: { 'z-index': 10, 'line-color': '#0ea5e9', 'target-arrow-color': '#0ea5e9', width: 4 } }` (sky-500 — same neutral palette the moderator's `mod_selection` uses for the selection ring; Decision §4 walks the visual primitive choice). (6) Read `useSelectionStore((s) => s.selected)` at the top of the component (next to the existing `useTranslation` call); thread `selected` into the localized `elements` memo as a new dependency. (7) Extend the localized `elements` memo to stamp a `selected: boolean` slot on each Cytoscape data record (computed from `selected?.kind === 'node' && selected.id === node.data.id` for nodes; symmetric for edges). (8) Extend the DOM mirror `<li>` rows (both kinds) with `data-selected={selectedFlag(node|edge.data.id, selected, 'node'|'edge')}` — a small helper that returns `'true'` / `'false'`. (9) The module-header refinement comment grows one more entry citing THIS leaf and walking the 7-flag-mount + tap-handler + 2-stylesheet-selector + mirror-attribute extension.
- `apps/participant/src/graph/GraphView.test.tsx` — modified. Existing cases stay. 10 new Vitest cases added under a new `describe('part_pan_zoom_tap (pan + zoom + tap-to-select)', ...)` block: (a) `cy.userPanningEnabled()` returns `true` after mount (asserts the pinned flag); (b) `cy.userZoomingEnabled()` returns `true`; (c) `cy.minZoom()` / `cy.maxZoom()` return the exported `MIN_ZOOM` / `MAX_ZOOM` constants (test imports them); (d) `cy.boxSelectionEnabled()` returns `false`; (e) `cy.autoungrabify()` returns `true`; (f) `cy.emit('tap', { target: <node>, cy })` writes `{ kind: 'node', id }` to `useSelectionStore.getState().selected` AND the corresponding Cytoscape node has `:selected` pseudo-class active (via `cy.$(':selected').contains(node)`); (g) `cy.emit('tap', { target: <edge>, cy })` writes `{ kind: 'edge', id }` symmetrically; (h) `cy.emit('tap', { target: cy, cy })` (empty-canvas tap) writes `null` to the selection store AND unselects every cy element; (i) tapping a different element AFTER a prior tap unselects the prior element (single-selection semantics); (j) the DOM mirror `<li data-testid="participant-node-status">` / `<li data-testid="participant-edge-status">` rows carry `data-selected="true"` when their id matches the store's selected, `data-selected="false"` otherwise. Plus 2 stylesheet cases: (k) `STYLESHEET` contains a `node:selected` selector + an `edge:selected` selector; (l) the selected-state stylesheet entries use only the documented Cytoscape primitives (`z-index`, `background-blacken` for nodes; `z-index`, `line-color`, `target-arrow-color`, `width` for edges) — defends against future drift into a primitive a prior overlay layer claims.
- `tests/e2e/participant-graph-render.spec.ts` — modified. Adds a 9th `test()` block: `erin creates a session, frank claims debater-A, seeded WS events + tap-on-node writes the selection to useSelectionStore via the data-selected DOM mirror`. Reuses block 3's helpers verbatim with the inverse role pairing; seeds two `node-created` + one `edge-created`; navigates `frank` to `/p/sessions/${sessionId}`; asserts `route-operate` + `participant-graph-root` visible; emits a tap on one node via `page.evaluate(() => window.__aConversaCyInstance.emit('tap', { target: cy.getElementById('<id>'), cy }))` — the tap surface is exposed via a new `window.__aConversaCyInstance` test seam set by `<GraphView>` in test mode (Decision §8 — the seam is a `useEffect` that writes `(window as unknown as { __aConversaCyInstance?: Core }).__aConversaCyInstance = cy` when `import.meta.env.MODE === 'test'` OR a Playwright-detection check passes; the cleanup deletes the property). Alternative considered + chosen in Decision §8: skip the synthetic `cy.emit` and use Playwright's native `page.mouse.click(x, y)` against the canvas at the node's screen position — but this requires reading `cy.getElementById(id).renderedPosition()` to know where to click, which is brittle under the happy-dom-vs-real-browser layout drift the predecessor leaves named. The `window.__aConversaCyInstance` seam pins the tap mechanically without coordinate arithmetic. Asserts the targeted `<li data-node-id="<id>">` row flips to `data-selected="true"`; the un-tapped node stays `data-selected="false"`. A second tap-on-edge case asserts the edge selection symmetric. A third empty-canvas-tap case (via `cy.emit('tap', { target: cy, cy })`) asserts every row flips back to `data-selected="false"`.
- `playwright.config.ts` — unchanged.
- `apps/participant/package.json` — unchanged.

### Files this task does NOT touch

- `apps/participant/src/routes/OperateRoute.tsx` — unchanged. `<GraphView>` is rendered with the same props (`sessionId`, `currentParticipantId`); the tap handler is internal to `<GraphView>`.
- `apps/participant/src/main.tsx`, `apps/participant/src/App.tsx`, `apps/participant/src/layout/*` — unchanged.
- `apps/participant/src/graph/projectGraph.ts`, `axiomMarks.ts`, `annotations.ts`, `diagnosticHighlights.ts`, `ownVotes.ts`, `otherVotes.ts`, `facetStatus.ts` — unchanged. The projection layer is orthogonal to interaction; selection is per-render-frame UI state, not projection state.
- `apps/participant/src/graph/OtherVotesOverlay.tsx`, `OtherVotesOverlay.test.tsx` — unchanged. The overlay's `pointer-events: none` posture already supports taps reaching the canvas; this leaf verifies (in Vitest) but does not modify.
- `apps/participant/src/graph/cytoscapeTestEnv.ts` — UNCHANGED. Existing stubs sufficient.
- `apps/participant/src/stores/selectionStore.ts` — unchanged. The store's `select` / `clear` API is consumed verbatim.
- `apps/moderator/`, `apps/server/`, `apps/root/`, `apps/audience/` — unchanged.
- `packages/shell/`, `packages/shared-types/`, `packages/i18n-catalogs/` — unchanged. No new substrate, no new types, no new strings.
- `docs/adr/` — no new ADR. Every decision below applies an existing ADR or mirrors a settled moderator-side decision.
- `.tji` files — `complete 100` on `part_pan_zoom_tap` lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual.

### Mount-config extension (`apps/participant/src/graph/GraphView.tsx:714-719`)

Sketched (additions only; existing keys unchanged):

```tsx
const cy = cytoscape({
  container,
  style: STYLESHEET,
  elements: [],
  layout: { name: 'preset' },
  // part_pan_zoom_tap additions — pin the interactive contract explicitly
  // so the behaviour does not drift across Cytoscape upgrades. The four
  // boolean flags match Cytoscape's documented defaults; the explicit
  // declaration is the load-bearing piece (the test asserts against the
  // pinned values via `cy.userPanningEnabled()` etc.).
  userPanningEnabled: true,
  userZoomingEnabled: true,
  // Box-selection is OFF (single-tap-to-select semantic) and the
  // selection set holds AT MOST one element at a time per the methodology's
  // one-entity-at-a-time detail panel. Cytoscape's `selectionType: 'single'`
  // ensures any new selection unselects the prior one; the tap handler
  // also calls `cy.$(':selected').not(target).unselect()` defensively.
  boxSelectionEnabled: false,
  selectionType: 'single',
  // Read-mostly surface: the debater MUST NOT drag nodes around (no
  // `node-moved` wire event today; manual drags would visually
  // desynchronise from every other surface). `autoungrabify: true` locks
  // node positions. Pan + zoom still work — they operate on the viewport
  // transform, not on per-node positions.
  autoungrabify: true,
  // Widen the zoom range from Cytoscape's `[1e-50, 1e50]` defaults — the
  // unbounded range allows zoom levels that produce zero-sized or
  // visually-broken canvases. The empirical `[0.1, 2.5]` range mirrors
  // the moderator's `mod_pan_zoom` calibration (Decision §3); the cap
  // applies to BOTH wheel-zoom AND `cy.zoom({ level: … })` programmatic
  // calls.
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
});
cy.on('tap', handleTap);
cyInstanceRef.current = cy;
setCyInstance(cy);
cyRef?.(cy);
return () => {
  cy.removeListener('tap', handleTap);
  cy.destroy();
  // ... existing cleanup
};
```

### Stylesheet additions (appended to `STYLESHEET`)

```tsx
// Selected-state branch — per Decision §4. Cytoscape's built-in
// `:selected` pseudo-class fires when an element is in the cy
// instance's selection set (the tap handler calls `target.select()`
// to add; `cy.elements().unselect()` to clear). The branch composes
// additively with the per-status / axiom / annotation / diagnostic
// / own-vote layers because it claims previously-unclaimed
// primitives: `z-index` (no prior consumer; bumps the selected
// element above its neighbours so it draws on top), `background-
// blacken` for nodes (negative value lightens; no prior consumer),
// `line-color` recoverable override for edges (the per-status
// `line-color` restores when the element unselects; only applies
// while the selection is active).
{
  selector: 'node:selected',
  style: {
    'z-index': 10,
    'background-blacken': -0.15, // slight lightening; sky-tinted feel
  },
},
{
  selector: 'edge:selected',
  style: {
    'z-index': 10,
    'line-color': '#0ea5e9', // sky-500 — same palette as the
                              // moderator's `mod_selection` ring
    'target-arrow-color': '#0ea5e9',
    width: 4, // bumped from baseline 1 / status 5 / annotated 4
  },
},
```

### DOM mirror extension

The `<li data-testid="participant-node-status">` and `<li data-testid="participant-edge-status">` rows each grow ONE new attribute:

```tsx
data-selected={selectedFlag(node.data.id, selected, 'node')}
// ...
data-selected={selectedFlag(edge.data.id, selected, 'edge')}
```

Where `selectedFlag(id: string, selected: Selection | null, kind: 'node' | 'edge'): 'true' | 'false'` returns `'true'` iff `selected?.kind === kind && selected.id === id`. The helper sits alongside the existing `rollupAttr` / `axiomAttr` / `hasAnnotationAttr` / `diagnosticSeverityAttr` / `ownVoteAttr` family — same explicit-`'true'`/`'false'` posture (no omit-when-empty) so Playwright's `[data-selected="false"]` probe gives the explicit "we asserted not-selected" branch.

### Module-scope `handleTap`

```tsx
import type { EventObject } from 'cytoscape';
import { useSelectionStore } from '../stores/selectionStore';

function handleTap(event: EventObject): void {
  const target = event.target;
  const cy = event.cy;
  // Empty-canvas tap — target === cy (Cytoscape's documented sentinel
  // for "tap originated on the canvas background, no element under
  // the pointer").
  if (target === cy) {
    cy.elements().unselect();
    useSelectionStore.getState().clear();
    return;
  }
  // Node tap.
  if (typeof target.isNode === 'function' && target.isNode()) {
    cy.$(':selected').not(target).unselect();
    target.select();
    useSelectionStore.getState().select({ kind: 'node', id: target.id() });
    return;
  }
  // Edge tap.
  if (typeof target.isEdge === 'function' && target.isEdge()) {
    cy.$(':selected').not(target).unselect();
    target.select();
    useSelectionStore.getState().select({ kind: 'edge', id: target.id() });
    return;
  }
  // Unknown target kind — defensive no-op (Cytoscape's tap event API
  // emits only on core / node / edge; this branch protects against
  // future kinds without a behaviour change).
}
```

The handler is exported (`export function handleTap`) so the Vitest cases can invoke it directly without relying on the cy-event-emission path (per the moderator's `mod_selection` precedent: the moderator's `handleNodeClick` / `handleEdgeClick` / `handlePaneClick` are also exported for the same reason — "ReactFlow's internal click pipeline gates `onNodeClick` on a measured-node check that doesn't run under happy-dom's no-op `ResizeObserver`," per the `mod_selection` Status block; Cytoscape's `cy.emit('tap', …)` runs the handler directly, but the export keeps the seam symmetric across surfaces and gives the test a more direct entry point).

## Acceptance criteria

The check that says "done":

- `apps/participant/src/graph/GraphView.tsx`: (a) exports `MIN_ZOOM = 0.1` + `MAX_ZOOM = 2.5` module-scope constants; (b) the `cytoscape({ … })` mount config carries 7 explicit flags (`userPanningEnabled: true`, `userZoomingEnabled: true`, `minZoom: MIN_ZOOM`, `maxZoom: MAX_ZOOM`, `boxSelectionEnabled: false`, `selectionType: 'single'`, `autoungrabify: true`); (c) the mount effect calls `cy.on('tap', handleTap)` after mount and `cy.removeListener('tap', handleTap)` in the cleanup; (d) `STYLESHEET` ends with the two new `node:selected` / `edge:selected` entries claiming only the documented primitives (`z-index`, `background-blacken` for nodes; `z-index`, `line-color`, `target-arrow-color`, `width` for edges); (e) the component reads `useSelectionStore((s) => s.selected)` and threads `selected` into the localized `elements` memo via a new dependency; (f) the localized `elements` memo stamps `selected: boolean` on each Cytoscape data record; (g) the DOM mirror `<li>` rows (both kinds) carry `data-selected={selectedFlag(id, selected, kind)}`.
- `apps/participant/src/graph/GraphView.tsx` exports a module-scope `handleTap(event: EventObject): void` function with the three-branch (empty / node / edge) discrimination + the single-selection-defensive `cy.$(':selected').not(target).unselect()` call.
- `apps/participant/src/graph/GraphView.test.tsx` covers the 12 new Vitest cases listed under Constraints (10 behavioural + 2 stylesheet).
- `tests/e2e/participant-graph-render.spec.ts` adds the 9th `test()` block (`erin + frank` role-swap) per the Constraints sketch. **Per ORCHESTRATOR.md UI-stream e2e policy**: the route IS reachable, the tap surface IS exposed via the `window.__aConversaCyInstance` test seam, the data-selected mirror IS assertable — the e2e is in scope, not deferred. The spec asserts via the documented `data-selected` attribute on the DOM mirror; coordinate / pixel assertions are intentionally out of the assertion path (Decision §8 — the `cy.emit('tap', …)` seam is the load-bearing tap surface).
- **Failing-first verification per ADR 0022**: stubbing `handleTap` to a no-op flips at least 4 of the 10 behavioural Vitest cases red (cases f / g / h / i — the four cases that exercise the tap-writes-through path) AND the Playwright assertion red. The mount-config flag cases (a-e) stay green (those assert the cy config, not the tap behaviour). Document the verification in the Status block.
- `pnpm run check` clean.
- `pnpm run test:smoke` green; Vitest count rises by the new cases (+12 GraphView).
- `pnpm -F @a-conversa/participant build` succeeds (bundle grows by ~50 lines: the module-scope constants + the handler + the stylesheet branches; no new dependency).
- `pnpm run test:e2e:smoke` (with the compose stack up via `make up`) executes the extended spec and it passes; `chromium-participant-skeleton` wall-clock unchanged (the new block runs in parallel under `fullyParallel`).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/40-participant-ui.tji` gets `complete 100` on `part_pan_zoom_tap` in the same commit (the Closer's ritual).

## Decisions

### §1 — Pin the four pan/zoom/selection/grab flags + the two zoom bounds explicitly on the `cytoscape({ … })` mount config

Three alternatives surveyed:

- **Pin all flags explicitly** (chosen, mirrors `mod_pan_zoom` Decision §1). Defends against any future Cytoscape version that changes a default. Adds 7 lines of mount config + 2 module-scope constants; the test asserts against the pinned values via `cy.userPanningEnabled()` / `cy.userZoomingEnabled()` / `cy.minZoom()` / `cy.maxZoom()` / `cy.boxSelectionEnabled()` / `cy.autoungrabify()`. The pinning IS the test seam.
- **Leave the flags absent and rely on Cytoscape's defaults.** Rejected: behaviour is the same today; behaviour tomorrow depends on what the library decides. Same rationale as `mod_pan_zoom` Decision §1 — the test suite would have to assert against rendered behaviour (a wheel event produces a zoom change) instead of against config (a prop equals a constant), which is materially more fragile.
- **Pin only the non-default flags** (e.g. only `boxSelectionEnabled: false` + `autoungrabify: true` + `minZoom` / `maxZoom`). Rejected: would tie the test suite to the "library's defaults match our expectations" assumption — the same assumption `mod_pan_zoom` explicitly broke for the moderator surface.

Decision §1: ship all 7 flags explicitly with the two zoom bounds via the exported module-scope constants. The test file imports the constants to keep the source-of-truth shared.

### §2 — `MIN_ZOOM = 0.1`, `MAX_ZOOM = 2.5` (mirrors `mod_pan_zoom` Decision §2)

Three alternatives surveyed:

- **Keep Cytoscape's `[1e-50, 1e50]` defaults.** Rejected: the unbounded range allows degenerate zoom levels (zoom < 1e-3 produces a canvas where every node collapses to a sub-pixel dot; zoom > 100 produces a canvas where a single node fills the entire viewport at 20,000px). The bounded range pins reasonable interactive limits.
- **Adopt the moderator's `[0.1, 2.5]` calibration verbatim** (chosen). The empirical numbers carry over because: (a) the participant nodes use Cytoscape `width: 200, height: 80` per `part_graph_render`'s STYLESHEET, which is the same order of magnitude as the moderator's `max-w-[18rem]` (288px) card; (b) the dagre-on-moderator vs cose-on-participant layout span × viewport ratio is the same order of magnitude (cose is force-directed, dagre is hierarchical; both produce ~2000×2000 spans for ~100 nodes); (c) the close-read 2.5x cap on a 200px card gives 500px wide rendered cards — slightly tighter than the moderator's 720px, but in the same close-read band; (d) the overview 0.1x produces 20px-tall cards — unreadable but spatially intelligible, same as the moderator.
- **Re-calibrate independently** (e.g. `[0.2, 3.0]` or `[0.05, 2.0]`). Rejected for v1: the moderator's numbers are empirically derived; the participant's surface is read-mostly with the same node sizes, so independent calibration is premature. If real-world tablet sessions show drift, a future polish leaf can re-tune.

Decision §2: adopt `MIN_ZOOM = 0.1` and `MAX_ZOOM = 2.5` verbatim; pin them as exported module-scope constants alongside the existing `EMPTY_EVENTS` / `EMPTY_DIAGNOSTICS_MAP` / `STYLESHEET` exports.

### §3 — `boxSelectionEnabled: false` + `selectionType: 'single'` + `autoungrabify: true`

Three sub-decisions packed:

**(3a) `boxSelectionEnabled: false`.** Cytoscape's default is `true` — mouse-drag on the canvas background draws a selection rectangle that adds every enclosed element to the selection set. For a single-tap-to-select-an-entity surface, box-selection is OFF by design: (a) the methodology's tap-an-entity-see-its-facets loop is one entity at a time; (b) the future entity-detail-panel surfaces ONE selected entity at a time (a future multi-detail panel could lift this, but that's a separate task); (c) box-select would compete with the pan-on-canvas-drag gesture — Cytoscape resolves the ambiguity by routing to box-select when `boxSelectionEnabled: true`, which would PREVENT pan-on-drag. Turning box-select OFF preserves the canvas-drag-pans semantic. Alternative: `boxSelectionEnabled: true`. Rejected for both methodology and pan-gesture reasons.

**(3b) `selectionType: 'single'`.** Defends single-selection at the Cytoscape internal layer (in addition to the explicit `cy.$(':selected').not(target).unselect()` call inside `handleTap`). With `boxSelectionEnabled: false` this is technically a defensive flag (box-select is the path that would otherwise produce multi-selection); the explicit pin keeps the contract legible. Alternative: `selectionType: 'additive'`. Rejected — additive selection composes with shift-click to grow the selection; the participant doesn't need multi-select today.

**(3c) `autoungrabify: true`.** Cytoscape's default is `false` — every node is grabbable (the user can drag it to a new position). For a read-mostly participant surface, this is harmful: (a) no `node-moved` wire event today, so a moderator-side or other-debater-side observer would NOT see the moved node; (b) the `cose` layout owns positions and re-runs on every WS frame, so a manual grab would be overwritten on the next frame anyway; (c) grabbing fights the pan gesture (a drag that starts on a node grabs the node; a drag that starts on the background pans the canvas — the latter is what we want for the read-mostly surface). Alternative: `autoungrabify: false`. Rejected for all three reasons.

Decision §3: ship all three flags as pinned (`boxSelectionEnabled: false`, `selectionType: 'single'`, `autoungrabify: true`).

### §4 — Selected-state visual: `z-index: 10` + `background-blacken: -0.15` for nodes; `z-index: 10` + sky-500 `line-color` + `target-arrow-color` override + `width: 4` for edges

The selected-state stylesheet must NOT collide with any of the six prior overlay layers. The claim table:

| Primitive | Prior claimant | Available for selection? |
| --- | --- | --- |
| `border-style` | rollup (per-status) + axiom (double) | NO |
| `border-color` | rollup (per-status) + diagnostic (override) | NO |
| `border-width` | rollup (per-status) + axiom (3) + diagnostic (4) | NO |
| `background-color` | rollup (per-status) | NO |
| `opacity` | rollup (per-status) | NO |
| `outline-color` / `outline-width` | rollup (`disputed` / `meta-disagreement` rose / violet rings) | NO |
| `overlay-color` / `-opacity` / `-padding` | annotation (nodes) | NO |
| `underlay-color` / `-opacity` / `-padding` | annotation + diagnostic (edges) | NO |
| `text-outline-color` / `-width` / `-opacity` | own-vote (label outline) | NO |
| `line-color` / `target-arrow-color` (edges) | rollup (per-status) + diagnostic | NO (but recoverable on unselect) |
| `width` (edges) | annotation (4) + diagnostic (3 / 5) | NO (but recoverable on unselect) |
| **`z-index`** | NONE | YES |
| **`background-blacken`** | NONE | YES |
| `font-weight` | NONE (but label text is data-bound, no per-label styling family in use) | YES (but visually subtle) |
| `scale` | NONE | YES (but visually disruptive — scaling a node moves its bounding box, which would jump the at-a-glance dot-row overlay) |

Three alternatives surveyed:

- **(a) `z-index` bump + `background-blacken: -0.15` (nodes) / `line-color` + `target-arrow-color` + `width` override (edges).** Chosen. The `z-index` bump moves the selected element above its neighbours so it's not occluded by overlapping nodes; the `background-blacken: -0.15` produces a slight lightening (subtle, doesn't compete with the per-status fill); the edges get a sky-500 color override (recoverable on unselect because Cytoscape's selector cascade restores the per-status `line-color` when `:selected` no longer matches). The sky-500 palette matches the moderator's `mod_selection` ring color for cross-surface consistency.
- **(b) `scale: 1.05` bump.** Rejected: scaling a node changes its bounding box, which would jump the `<OtherVotesOverlay>`'s anchored dot row (anchored at `renderedBoundingBox().y2 + 4`) the moment the user taps. The visual flicker on every tap would be jarring.
- **(c) `font-weight: bold` on the label.** Rejected: too subtle as a primary signal; would also competer with the future `part_entity_detail_panel`'s per-facet font weights.

Decision §4: ship (a). The `z-index: 10` bump + slight `background-blacken` lightening (nodes) + sky-500 line/arrow color override + `width: 4` (edges) compose cleanly with every prior layer and use only previously-unclaimed primitives (for the node case) / recoverable overrides (for the edge case).

### §5 — Tap surface: a single `cy.on('tap', handleTap)` registration with target discrimination, NOT three separate `cy.on('tap', 'node', …)` / `cy.on('tap', 'edge', …)` / `cy.on('tap', 'core', …)` handlers

Two alternatives surveyed:

- **Single `cy.on('tap', cb)` with target discrimination on `event.target`** (chosen). Cytoscape's `tap` event fires once per tap regardless of target; the handler discriminates via `event.target === event.cy` (empty canvas), `event.target.isNode()` (node), `event.target.isEdge()` (edge). One registration, one cleanup. Mirrors the moderator's approach for `mod_selection` (the moderator registers THREE handlers because ReactFlow's prop API splits the three target kinds; Cytoscape has ONE event with target discrimination, so one handler is the symmetric shape).
- **Three separate `cy.on('tap', 'node', cb1)` + `cy.on('tap', 'edge', cb2)` + `cy.on('tap', 'core', cb3)` registrations.** Rejected: same effective semantics but three registrations + three cleanups + three handlers; the single-handler shape is more compact. The selector-qualified form is useful when the three behaviours diverge significantly; ours all write to the same store via a thin discriminator, so the unified handler is cleaner.

Decision §5: ship one `cy.on('tap', handleTap)` with target discrimination. Cleanup is symmetric: `cy.removeListener('tap', handleTap)`.

### §6 — `handleTap` is a module-scope function (referentially stable, exported for direct testing)

Two alternatives surveyed:

- **Module-scope function exported from the file** (chosen, mirrors `mod_selection` Status block precedent). The handler only WRITES to `useSelectionStore.getState()` — no React state, no closure over component-local variables. Module-scope ensures referential stability across renders (the mount effect runs once; the handler reference must not change for the cleanup's `removeListener` to find the right callback). Exporting gives the Vitest cases a direct entry point (per the moderator's "ReactFlow's internal click pipeline gates `onNodeClick` on a measured-node check that doesn't run under happy-dom's no-op `ResizeObserver`" rationale — Cytoscape's `cy.emit('tap', …)` runs the handler directly, but the export keeps the seam symmetric and gives a more direct test path).
- **Inside-component `useCallback`-wrapped handler.** Rejected: would re-create the handler reference on every render (unless deps are empty, in which case the closure semantics are the same as the module-scope path); the module-scope path is simpler and matches the moderator's pattern.

Decision §6: ship module-scope `export function handleTap(event: EventObject): void` with the three-branch discriminator + the defensive `cy.$(':selected').not(target).unselect()` call before `target.select()`.

### §7 — DOM mirror extension: add `data-selected="true|false"` per row; do NOT introduce a per-row visible-DOM element for selection

Two alternatives surveyed:

- **Add `data-selected` to the existing `<li data-testid="participant-node-status">` / `<li data-testid="participant-edge-status">` rows** (chosen). Mirrors the existing per-attribute posture (`data-rollup-status`, `data-is-axiom`, `data-has-annotation`, `data-annotation-count`, `data-diagnostic-severity`, `data-diagnostic-kinds`, `data-own-vote`). Symmetric across node + edge rows per the existing convention. The Playwright assertion path is the same as every prior leaf — `[data-selected="true"]` matches the selected row; `[data-selected="false"]` is the explicit not-selected branch.
- **Introduce a new sibling `<ul data-selected-mirror>` next to the existing `participant-graph-status-mirror`**. Rejected: would duplicate the per-element row structure for a single boolean signal; the additive attribute on the existing mirror is the natural extension.

The mirror's `data-selected` is the LOAD-BEARING seam for the future `part_entity_detail_panel` test surface — the panel asserts that tapping a node renders the panel for the right entity, and the mirror's `data-selected="true"` row is the test-side confirmation that the selection actually wrote through to the store before the panel re-rendered.

Decision §7: extend both `<li>` row kinds with `data-selected={selectedFlag(id, selected, kind)}`; helper sits alongside the existing `rollupAttr` / `axiomAttr` / etc. family with the same explicit-`'true'`/`'false'` posture.

### §8 — Playwright tap surface: synthetic `cy.emit('tap', …)` via the `window.__aConversaCyInstance` seam, NOT real `page.mouse.click(x, y)` against the canvas at a computed position

Three alternatives surveyed:

- **Real `page.mouse.click(x, y)` against the canvas at a position computed from `cy.getElementById(id).renderedPosition()`.** Rejected: requires reading the per-element rendered position via `page.evaluate(() => cy.getElementById('<id>').renderedPosition())`, which is sensitive to the happy-dom-vs-real-browser layout drift the predecessor leaves named (in particular `part_other_vote_indicators_canvas_dots` Decision §6 explicitly removed coordinate arithmetic from the e2e assertion path for this reason). Real-click would also exercise Cytoscape's hit-test rather than just the tap-handler — additional surface to debug if it flakes.
- **Synthetic `cy.emit('tap', { target: <element>, cy })` via the `window.__aConversaCyInstance` test seam** (chosen). Pins the tap behaviour mechanically without coordinate arithmetic. The `<GraphView>` component sets the `window` property when in test mode (Vitest sets `import.meta.env.MODE === 'test'`; Playwright sets a `data-aconversa-pw-mode` attribute on the document or a navigator userAgent suffix — Decision §9 walks the chosen detection mechanism). The seam is symmetric with the existing `window.__aConversaWsStore` seam at [`apps/participant/src/main.tsx:50`](../../../apps/participant/src/main.tsx#L50) — same module-scope hack the predecessor leaves' Playwright specs rely on.
- **Click on the DOM mirror `<li>` row directly to simulate selection.** Rejected: the mirror is `aria-hidden="true" className="sr-only"` — not a real user interaction path. Test assertions against the mirror are appropriate; test ORCHESTRATIONS via the mirror would be a no-op (the mirror has no click handler).

Decision §8: ship the `cy.emit('tap', …)` via the `window.__aConversaCyInstance` seam. The seam is set inside `<GraphView>`'s one-shot mount effect, gated by a test-environment check (Decision §9), and cleaned up in the effect's return. The seam exposes the live Cytoscape `Core` for the Playwright spec to call `cy.emit('tap', { target: cy.getElementById('<id>'), cy })` from `page.evaluate(...)`.

### §9 — Test-environment detection for the `window.__aConversaCyInstance` seam: gated on `import.meta.env.MODE === 'test' || (typeof window !== 'undefined' && window.location.search.includes('aconversaTestMode'))`

Two sub-options for the Playwright leg:

- **Detect via URL query parameter** (`?aconversaTestMode=1`) — the Playwright spec navigates to `/p/sessions/${sessionId}?aconversaTestMode=1` and `<GraphView>` sets the window property when the query is present. Chosen for simplicity: no `userAgent` mangling, no document-level attribute, just a URL flag the spec adds.
- **Detect via `navigator.userAgent.includes('Playwright')`** — Playwright's default `userAgent` carries the `HeadlessChrome/<version>` substring; could detect via that. Rejected: brittle (changes per Playwright version), and accidentally lights up in dev tools' headless mode.

Decision §9: gate the `window.__aConversaCyInstance` seam on `import.meta.env.MODE === 'test'` (covers Vitest) OR `window.location.search.includes('aconversaTestMode')` (covers Playwright when the spec navigates with `?aconversaTestMode=1`). The seam is module-scope-internal; production bundles still ship the gate but it never lights up. The dev build is unaffected.

### §10 — Tap-through-overlay verification: the `<OtherVotesOverlay>` `pointer-events: none` posture is asserted by a Vitest case here so a future overlay regression is caught at the unit level

The `<OtherVotesOverlay>` ships with `className="pointer-events-none absolute inset-0"` at [`OtherVotesOverlay.tsx:199`](../../../apps/participant/src/graph/OtherVotesOverlay.tsx#L199); this is the load-bearing CSS that lets taps pass through to the canvas. A future overlay leaf could accidentally drop the class (or shadow it with a higher-specificity rule); the regression would silently break tap-to-select on entities that happen to sit under the overlay's dot row.

A Vitest case in `GraphView.test.tsx` reads the rendered overlay's `style.pointerEvents` (via `getComputedStyle` after JSDOM applies the Tailwind class — happy-dom resolves the class to the inline equivalent). If the class drops, the value flips from `'none'` to `''` (empty/default), and the case fires. The case sits in the new `describe('part_pan_zoom_tap (pan + zoom + tap-to-select)', …)` block as case (m): `<OtherVotesOverlay> root carries pointer-events: none so taps reach Cytoscape`.

Decision §10: add the cross-layer verification case; future overlays MUST follow the same posture or this case (and downstream `part_entity_detail_panel` cases) fire.

### §11 — Playwright 9th block: `erin + frank` role-swap (block-3 inverse) per the user-pool exhaustion pattern the 7th + 8th blocks pioneered

The existing `tests/e2e/participant-graph-render.spec.ts` describe has EIGHT `test()` blocks (alice+ben, maria+dave, frank+erin, grace+henry, ivan+julia, kate+leo, alice+ben role-swap = block-1 inverse, dave+maria role-swap = block-2 inverse). The 12-user pool is exhausted; role-swap pairs already used: block-1 inverse (`ben + alice`) and block-2 inverse (`dave + maria`). Next available role-swap pair: **block-3 inverse** (`erin + frank`).

Three alternatives surveyed (same as `part_other_vote_indicators_canvas_dots` Decision §7):

- **(a) Role-swap an existing pair** (chosen): use `erin + frank` (the inverse of block 3's `frank + erin`). The per-block-isolated `createSession` + `freshContext` guarantees no race on session state even though the username pair re-appears; the OIDC dance per `loginAs` is independent per `freshContext`.
- **(b) Expand the dev-user pool again.** Rejected for the same reason `part_other_vote_indicators_canvas_dots` Decision §7 rejected it: adds infra cost (Authelia config edit + DEV_USER_POOL constant bump) for ONE block of value. The `part_e2e_user_pool_expansion` task (already settled per `tasks/40-participant-ui.tji:129`) was the one-off expansion; further expansion is the principled-fix path, deferred until real per-block exhaustion happens AGAIN.
- **(c) Split into a new spec file.** Rejected: same reason — would duplicate ~80 lines of fixture composition for one block.
- **(d) Reuse an already-used role-swap pair from blocks 7 or 8.** Rejected: would mean two blocks in the describe share the same `(creator, debater)` pair, which complicates failure attribution if both blocks fail (which is which?). Different role-swap pair gives each block its own observable identity.

Why `erin + frank` specifically: block 3 (`frank + erin`) used the standard `(creator=frank, debater=erin)` orientation; the inverse `(creator=erin, debater=frank)` is the natural complement. Block-3 was the third fresh pair after blocks 1 (`alice + ben`) and 2 (`maria + dave`); block-3-inverse is the natural next role-swap after block-1-inverse (`ben + alice`, used by block 7) and block-2-inverse (`dave + maria`, used by block 8). The block-N-inverse pattern is the legible rotation.

The 9th `test()` block:

1. Sets up `erin` (creator) + `frank` (debater-A) via `freshContext` + `loginAs` + the existing helpers.
2. Sets up the session + lobby chain (mirroring block 3's seed pattern).
3. Navigates `frank` to `/p/sessions/${sessionId}?aconversaTestMode=1` (Decision §9 — the query flag lights up the `window.__aConversaCyInstance` test seam).
4. Asserts `route-operate` + `participant-graph-root` + `participant-other-votes-overlay` visible.
5. Seeds events via `__aConversaWsStore.getState().applyEvent(...)`:
   - Two `node-created` (NODE_A, NODE_B) + one `edge-created` (EDGE_AB).
6. Reads `data-selected="false"` on both node rows + the edge row (baseline — nothing selected yet).
7. Emits a synthetic tap on NODE_A via `page.evaluate((nodeId) => { const cy = window.__aConversaCyInstance; cy.emit('tap', { target: cy.getElementById(nodeId), cy }); }, NODE_A_ID)`.
8. Asserts the NODE_A row flips to `data-selected="true"`; NODE_B + EDGE_AB rows stay `data-selected="false"`.
9. Emits a synthetic tap on EDGE_AB; asserts EDGE_AB flips to `data-selected="true"`; NODE_A flips back to `data-selected="false"` (single-selection semantic); NODE_B stays `data-selected="false"`.
10. Emits a synthetic empty-canvas tap (`cy.emit('tap', { target: cy, cy })`); asserts every row flips back to `data-selected="false"`.

Per the predecessor leaves' pattern: assertions target the documented `data-selected` attribute, NOT canvas pixels and NOT position arithmetic (Decision §8 — the `cy.emit` seam pins the tap mechanism without coordinate sensitivity).

### §12 — No e2e for pan/zoom — assertion lives in Vitest at the cy-config layer

Pan/zoom in a real browser is hard to e2e:

- **Pan**: Playwright can dispatch mouse events (`page.mouse.down(x, y)` / `move` / `up`) on the canvas, but the visible result is a viewport-transform change painted to `<canvas>` — not DOM-queryable. The moderator's `mod_pan_zoom` Playwright spec reads `.react-flow__viewport`'s `style.transform` to assert the pan; ReactFlow exposes that transform on a DOM element. Cytoscape paints the entire canvas to a `<canvas>` element; the viewport state lives in `cy.pan()` / `cy.zoom()`, NOT on a DOM transform. Reading `cy.pan()` from Playwright requires the `window.__aConversaCyInstance` seam (Decision §8) — feasible but adds complexity for a behaviour that's already pinned mechanically at the Vitest layer.
- **Zoom**: same shape — `page.mouse.wheel(0, -200)` dispatches a wheel event, but the result is `cy.zoom()` changing on the cy instance, not a DOM attribute. Same `window.__aConversaCyInstance`-readback shape as the pan case.

Decision §12: skip pan/zoom in the Playwright spec. The Vitest cases at the cy-config layer (cases a-e — `cy.userPanningEnabled()`, `cy.userZoomingEnabled()`, `cy.minZoom()`, `cy.maxZoom()`, `cy.boxSelectionEnabled()`) pin the configuration; the gestures themselves are Cytoscape library behaviour. The moderator's `mod_pan_zoom` chose differently because ReactFlow exposes the viewport transform on a DOM element; for the participant, the equivalent assertion would be `cy.pan()` / `cy.zoom()` readback from the test seam — equivalent to the Vitest assertion (both inspect the cy instance), but executed in Playwright against the real-browser stack. The marginal value of the in-browser pan/zoom assertion is low; the Vitest cases give the same coverage at a fraction of the wall-clock cost.

If real-world tablet sessions show pan/zoom drift (e.g. wheel deltas behaving differently on iPad Safari vs desktop Chromium), a future polish task can add the in-browser assertion at that point — out of scope for v1.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- Cytoscape mount-config pinned in `apps/participant/src/graph/GraphView.tsx`: 7 init flags (`userPanningEnabled`, `userZoomingEnabled`, `boxSelectionEnabled`, `autoungrabify`, `autounselectify`, `selectionType`, plus the wheel-sensitivity guard) wired alongside exported `MIN_ZOOM` / `MAX_ZOOM` bounds. Per Decisions §11 + §12 these are asserted via Vitest cy-config readback (cases pz-a..pz-e in `apps/participant/src/graph/GraphView.test.tsx`) rather than an in-browser Playwright gesture; the marginal value of a real-browser pan/zoom assertion vs the Vitest readback is low for a `<canvas>` surface where viewport state lives on the cy instance.
- Tap discriminator landed as a module-scope `handleTap` registered via `cy.on('tap', handleTap)` with strict-mode-safe cleanup; it writes node/edge selection to `useSelectionStore` (the shared Zustand slice). This is the seam the downstream `part_entity_detail_panel` leaf will consume — the panel reads from the same store, so it sees the active selection without re-implementing tap discrimination.
- `:selected` stylesheet branches added using primitives the predecessor leaves had not yet claimed: `z-index` bump + `background-blacken` overlay for nodes; sky-500 `line-color` + bumped `width` for edges. Picked to avoid colliding with the per-facet state palette (`part_per_facet_state_styling`), the vote indicators (`part_own_vote_indicators` / `part_other_vote_indicators`), or the axiom-mark / annotation / diagnostic decoration layers.
- DOM-mirror extension: `data-selected` attribute now stamped on both `<li>` row kinds (nodes and edges) in the mirror that the e2e and accessibility tests already consume; the existing per-row data attributes for state / vote / axiom-mark are untouched.
- Test seam: `window.__aConversaCyInstance` exposed only when the URL flag `?aconversaTestMode=1` is present (and scrubbed on unmount). Consumed by the new 9th block of `tests/e2e/participant-graph-render.spec.ts` (erin + frank role-swap inverse pair), which emits synthetic `tap` events via `cy.emit('tap', ...)` and asserts the `data-selected` attribute flips through node-tap → edge-tap → empty-canvas-tap. The seam approach lets the e2e exercise the real wired-up cy instance without coordinate-sensitive `page.mouse` arithmetic against an opaque `<canvas>`.
- Failing-first verification performed per ADR 0022: stubbing `handleTap` to a no-op flipped exactly 5 of the new behavioural Vitest cases red (pz-f / pz-g / pz-h / pz-i / pz-j — clears the refinement's "at least 4" bar); config-flag cases (pz-a..pz-e) and stylesheet/overlay cases (pz-k / pz-l / pz-m) stayed green as expected (they assert wiring, not tap behaviour); restoring `handleTap` returned all 69 cases to green.
- Test deltas (Implementer-verified): Vitest `GraphView.test.tsx` 55 → 69 (+14); Vitest smoke total 3987 → 4001 (+14); Playwright `tests/e2e/participant-graph-render.spec.ts` blocks 8 → 9 (+1), 24.1s wall-clock under 8 workers with block 9 itself 6.9s parallel.

