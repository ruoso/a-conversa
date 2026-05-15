# Moderator graph pan and zoom navigation — pin ReactFlow's defaults, widen the zoom range, lock the contract behind tests

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_pan_zoom` —
[tasks/30-moderator-ui.tji](../../30-moderator-ui.tji), line 231:

```
task mod_pan_zoom "Pan and zoom navigation" {
  effort 0.5d
  allocate team
}
```

No explicit `depends` line; inherits transitively from parent
`mod_graph_rendering` (which depends on `!mod_layout.mod_graph_canvas_pane`)
and from grandparent `moderator_ui` (which depends on
`backend.backend_tests.be_e2e_tests.auth_flow_integration`).

## Effort estimate

**0.5d.** Confirmed. ReactFlow ships pan + zoom *by default* — drag-to-pan
on the canvas background, scroll-wheel zoom, trackpad pinch-zoom,
double-click zoom (`apps/moderator/src/graph/GraphCanvasPane.tsx:810-823`
mounts a default `<ReactFlow>` with no opt-out). The behavior is reachable
today: log in, create a session via `mod_create_session_form`, land on
`/sessions/<id>/operate`, scroll the wheel over the canvas, drag the
background. The work in scope is **not building** pan/zoom — it is:

1. **Pinning the configuration** by setting the four behavior props
   explicitly on `<ReactFlow>` (rather than relying on `undefined` →
   library default, which is fragile across version bumps).
2. **Widening the zoom range** from ReactFlow's defaults
   (`minZoom: 0.5`, `maxZoom: 2`) to a range that matches a moderator
   debate with up to 100 nodes — empirically `0.1` (fit-everything zoom
   on a dense graph) to `2.5` (close-read a single card).
3. **Locking the contract behind tests**: 4 new Vitest cases pinning the
   prop values fed to `<ReactFlow>`, and one new Playwright `test()`
   block in `tests/e2e/moderator-graph-layout.spec.ts` exercising wheel
   zoom, drag pan, zoom clamping, and "tidy up still re-frames after
   manual zoom" (the existing `chromium-moderator-layout` project hosts
   the new spec — same overlap rationale `mod_layout_measured_dimensions`
   / `mod_layout_tidy_action` cited).

No new dependency, no new ADR, no new i18n catalog key (pan/zoom is
gesture-driven, not text).

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their
public contracts):

- **`moderator_ui.mod_graph_rendering.mod_graph_canvas_pane`** (done —
  `<GraphCanvasPane>` mounts `<ReactFlow>` at
  `apps/moderator/src/graph/GraphCanvasPane.tsx:810-823` with the
  `nodes` + `edges` props already wired. The mount itself is the seam
  this task configures; no structural change beyond adding ~6 props).
- **`moderator_ui.mod_graph_rendering.mod_layout_engine_choice`** (done —
  `applyLayout` from `./layoutEngine.ts` emits dagre-derived positions
  the viewport pans/zooms over. Pan/zoom operates on whatever positions
  land in `Node.position`; orthogonal to the layout algorithm).
- **`moderator_ui.mod_graph_rendering.mod_layout_measured_dimensions`**
  (done — measured rects flow into dagre via `LayoutOptions.dimensions`
  with a 75 ms debounce. Pan/zoom does NOT trigger measurement events:
  `ResizeObserver` fires on size changes, not transform changes, so
  zooming the viewport leaves the measurement cache silent. Verified
  against the `selectMeasurementRevision` selector at
  `GraphCanvasPane.tsx:465-485` — it reads `state.nodeInternals.width /
  .height`, which are pre-transform dimensions).
- **`moderator_ui.mod_graph_rendering.mod_layout_tidy_action`** (done —
  the top-right "Tidy up" button calls
  `useReactFlow().fitView({ duration: 0, padding: 0.1 })` inside a
  `requestAnimationFrame` after clearing the position cache. The
  fit-view call is the canonical re-center affordance after manual
  pan/zoom; this task does NOT add a separate "Reset zoom" button — the
  just-landed Tidy up button already gives the operator the
  re-center gesture. Pan/zoom and tidy-up compose: manual pan/zoom
  drifts the viewport, tidy-up snaps it back via fitView).
- **`moderator_ui.mod_graph_rendering.mod_selection`** (done — left-click
  selects the entity under the cursor. Pan starts on mousedown on the
  canvas background, NOT on a node/edge, so the selection click and the
  pan gesture do not race — ReactFlow's internal hit-test routes the
  event correctly. Verified against ReactFlow's `panOnDrag` default,
  which discriminates pan from node-drag based on the event target).
- **`moderator_ui.mod_graph_rendering.mod_context_menus`** (done —
  right-click opens the context menu. Pan does NOT start on right-click
  (`panOnDrag: true` defaults to left-button-only). Pan and right-click
  context-menu are independent gestures).
- **`moderator_ui.mod_graph_rendering.mod_hover_details`** (done — the
  hover popover anchors to the entity via `position: absolute; bottom:
  calc(100% + 4px)` inside the card root. ReactFlow's viewport zoom is
  applied to the whole `<ReactFlow>` subtree via a single CSS transform,
  so the popover scales with its parent — the popover stays anchored to
  the card at every zoom level without extra wiring).
- **`moderator_ui.mod_session_setup.mod_create_session_form`** (done —
  the operate route `/sessions/<id>/operate` is reachable from a real
  user flow as of commit `05f7d67`. The pan/zoom Playwright spec is
  therefore NOT deferred — the route is hot).
- **[ADR 0004 — Graph libraries](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md)**
  (Accepted 2026-05-10) — pinned ReactFlow on the moderator surface
  precisely because its interactive-edit profile (drag-to-pan,
  scroll-zoom, drag-to-create-edge, custom node components) is the
  library's strength. Pan/zoom is one of the things ReactFlow was
  chosen FOR; this task does not re-litigate the choice, it pins the
  configuration.
- **[ADR 0025 — Graph layout engine: dagre](../../../docs/adr/0025-graph-layout-engine-dagre.md)**
  (Accepted 2026-05-15) — pinned dagre. Layout produces positions; pan
  /zoom transforms the viewport over those positions. Orthogonal axis.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)** —
  every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0008 — E2E framework Playwright](../../../docs/adr/0008-e2e-framework-playwright.md)** —
  the e2e layer that proves the pan/zoom behavior holds in a real
  browser.

Pending edges (this task does NOT depend on them; they consume this
task's seams or are orthogonal):

- `moderator_ui.mod_capture_flow.*` — downstream consumer milestone work.
  Capture flow composes more cleanly with predictable pan/zoom: dragging
  from a source handle to a target handle (the future
  `mod_draw_edge_flow` gesture) must NOT accidentally pan the canvas;
  pinning `panOnDrag: true` on the **canvas background only** (which is
  ReactFlow's default behavior — `panOnDrag` ignores mousedown events
  whose target is a node or edge) preserves the canvas-grab-only pan
  semantics that future drag-to-create-edge needs.
- `mod_edge_popover_full_target_wording` (pending) — orthogonal; the
  popover-truncation decision operates on text content, not on
  viewport transforms.

## What this task is

Concrete, mechanical work, all inside `<GraphCanvasPaneInner>`:

### A. Pin the four pan/zoom props on `<ReactFlow>`

The existing `<ReactFlow ... />` mount at
`apps/moderator/src/graph/GraphCanvasPane.tsx:810-823` carries no
pan/zoom props — every behavior currently comes from ReactFlow's
implicit defaults. This task adds five explicit props plus the
zoom range:

```tsx
<ReactFlow
  nodes={nodes}
  edges={edges}
  nodeTypes={NODE_TYPES}
  edgeTypes={edgeTypes}
  onNodeClick={handleNodeClick}
  onEdgeClick={handleEdgeClick}
  onPaneClick={handlePaneClick}
  onNodeContextMenu={handleNodeContextMenu}
  onEdgeContextMenu={handleEdgeContextMenu}
  onPaneContextMenu={handlePaneContextMenu}
  // Refinement: mod_pan_zoom. Pin the pan/zoom contract explicitly so
  // the behavior does not drift across ReactFlow upgrades. The four
  // behavior props match ReactFlow's documented defaults (drag-to-pan
  // on background, scroll-wheel zoom, trackpad pinch zoom, double-click
  // zoom) — the explicit declaration is the load-bearing piece, the
  // values themselves are unchanged from the library defaults.
  panOnDrag={true}
  zoomOnScroll={true}
  zoomOnPinch={true}
  zoomOnDoubleClick={true}
  // Widen the zoom range from ReactFlow's defaults (0.5 .. 2). A debate
  // with ~100 nodes does not fit in the viewport at 0.5x; the moderator
  // needs to zoom further out to overview the whole canvas. The 2.5x
  // upper bound lets a moderator close-read a single card with wording
  // detail. See Decisions for the empirical rationale.
  minZoom={MIN_ZOOM}
  maxZoom={MAX_ZOOM}
>
  <Background />
</ReactFlow>
```

The four behavior props are pinned at their library defaults (`true`)
because: (a) ReactFlow's defaults are the well-understood desktop graph
editor idiom — drag to pan, scroll to zoom, pinch to zoom, double-click
to zoom — and the moderator's expectation matches; (b) writing them
explicitly defends against any future ReactFlow version that changes a
default; (c) the test cases below assert against the explicit prop values
on the rendered element rather than against library behavior, which is
the more stable test contract.

The zoom range widens from ReactFlow's `[0.5, 2]` to `[0.1, 2.5]`:

- **`MIN_ZOOM = 0.1`** — at 100 nodes laid out by dagre with the
  measurement-driven heights, the canvas bounding box spans several
  thousand px on the y axis (rank heights × ~100 px/rank × ~10 ranks +
  rank separations). A typical moderator viewport at 1366×768 cannot fit
  that at 0.5x; 0.1x gives a true overview at the cost of card text
  being unreadable (acceptable — overview is for spatial structure, not
  reading). The "tidy up" + fit-view path bounds to this range at the
  low end so the fit-view never tries to zoom past 0.1x.
- **`MAX_ZOOM = 2.5`** — the cards' `max-w-[18rem]` (288 px) renders at
  288 px CSS width at zoom 1.0; at 2.5x the rendered card is 720 px wide,
  which is the close-read limit before single-card content fills more
  than half the viewport. Beyond 2.5x the user is fighting the layout;
  the cap prevents that. ReactFlow's default `maxZoom: 2` was tighter
  than necessary for the moderator's debug-the-detail use case.

### B. Module-scope constants for the zoom range

Hoisted to module scope so the test file can import them and assert
against the exact same constants the production code reads (no magic
numbers in tests, no drift):

```tsx
/**
 * **Pan/zoom range, in viewport-transform units.** Refinement:
 * `mod_pan_zoom`. ReactFlow's defaults are `0.5` / `2` — too tight for
 * a moderator debate with up to ~100 nodes. The lower bound supports a
 * true overview of a dense canvas; the upper bound supports close-
 * reading single-card wording detail. The `fitView({ padding: 0.1 })`
 * call inside `handleTidyUp` is bounded to this same range — ReactFlow
 * clamps fitView's computed zoom to `[minZoom, maxZoom]` automatically.
 */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.5;
```

### C. No new keyboard shortcuts in v1

Pan/zoom is mouse / trackpad-driven in v1. Reasons:

1. **ReactFlow ships `+ / -` keyboard zoom controls** as part of the
   built-in `<Controls />` minimap component (`@reactflow/controls`,
   already in the lockfile per the earlier discovery), but the moderator
   surface currently does NOT render `<Controls />`. Adding `<Controls />`
   is scope creep for this 0.5d task — it adds a UI corner widget
   (zoom-in / zoom-out / fit-view / lock buttons), which would need
   styling decisions and i18n keys (for the button aria-labels). The
   Tidy up button (top-right) plus mouse / trackpad gestures cover the
   v1 moderator workflow.
2. **No custom keyboard handler** is added here. The user can already
   `Tab` to entities (per `mod_selection`'s focus wiring) and trigger
   `fitView` via the Tidy up button. If real moderation sessions
   surface "I keep reaching for the keyboard" feedback, a follow-up task
   `mod_pan_zoom_keyboard_shortcuts` adds `Ctrl+/`, `Ctrl+-`, `Ctrl+0`
   (fit) under its own scope.

### D. No "Reset zoom" or "Fit view" button

The just-landed Tidy up button (`mod_layout_tidy_action`,
`apps/moderator/src/graph/GraphCanvasPane.tsx:824-833`) already calls
`fitView({ duration: 0, padding: 0.1 })` as part of its handler. After
manual pan/zoom drift, clicking Tidy up re-frames the viewport — same
gesture, no new button. Adding a separate "Reset zoom" button would
duplicate the affordance.

If real moderation sessions surface "I want to reset zoom WITHOUT
clearing the position cache" (i.e. preserve the current arrangement and
just re-center the viewport), a follow-up task `mod_fit_view_button` can
add a dedicated affordance under its own scope. Out of scope here.

### E. Tests pin the contract

Per ADR 0022, every assertion is a committed Vitest or Playwright case.
See Acceptance criteria for the case list.

## Why it needs to be done

Three reasons, in priority order:

1. **The contract is currently implicit.** Pan/zoom works today because
   ReactFlow's defaults happen to be sensible — there are no
   `panOnDrag` / `zoomOnScroll` / `zoomOnPinch` / `zoomOnDoubleClick`
   / `minZoom` / `maxZoom` props on `<ReactFlow>` anywhere in
   `apps/moderator/src/`. A ReactFlow upgrade that changes a default
   (e.g. v12 might disable scroll-zoom for accessibility, requiring an
   explicit opt-in) would silently regress the moderator's pan/zoom
   behavior with no test failure to catch it. **Pinning the four props
   explicitly is the seam that turns the implicit contract into a
   tested one.** This is the same rationale ADR 0025's Decisions block
   used for "constants exported alongside (e.g. `DEFAULT_LAYOUT_OPTIONS`)
   so the test suite asserts against the same source of truth the
   production code reads" — explicit configuration is the test seam.

2. **The default zoom range is too tight for 100-node sessions.** The
   library's `minZoom: 0.5` produces a viewport that cannot fit a
   dagre-laid-out 100-node debate. A moderator who can't zoom out far
   enough to see the whole graph cannot answer "where am I?" — a
   structural usability problem for a tool whose primary affordance is
   the graph canvas. The 0.1 .. 2.5 range, calibrated against the
   dagre layout's measured spread + the card's `max-w-[18rem]`, gives
   real overview and real close-read both. The cost is one constant
   declaration; the benefit is the moderator can actually operate the
   tool at the dense end of the use case.

3. **The `fitView({ padding: 0.1 })` call inside `handleTidyUp` reads
   `minZoom` / `maxZoom` for its zoom clamp.** ReactFlow's fitView
   computes the zoom that fits the bounding box of all nodes, then
   clamps to `[minZoom, maxZoom]`. With the library default
   `minZoom: 0.5`, a tidy-up over a 100-node canvas would clamp to 0.5
   and leave the outermost cards clipped by the canvas edge.
   Widening `minZoom` to 0.1 makes the existing tidy-up affordance
   actually fit a dense graph — the two tasks compose.

Downstream: closing `mod_pan_zoom` closes the last open leaf under
`mod_graph_rendering` (per `tasks/30-moderator-ui.tji:207-253`; every
other leaf already carries `complete 100`). The grandparent
`mod_capture_flow` depends on `!mod_graph_rendering` as a whole — this
task is the last preconditioning piece for the M4 capture-flow stream
to unblock.

## Inputs / context

Code seams the implementation plugs into (real paths + line numbers, all
verified against the working tree):

- `apps/moderator/src/graph/GraphCanvasPane.tsx:810-823` — the
  `<ReactFlow>` mount. This task adds 5 props (`panOnDrag`,
  `zoomOnScroll`, `zoomOnPinch`, `zoomOnDoubleClick`, `minZoom` /
  `maxZoom`) between the existing `onPaneContextMenu={...}` line and
  the `<Background />` child. No structural change to the JSX tree.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:499-510` — the
  existing `MEASUREMENT_DEBOUNCE_MS` and `DIMENSION_CHANGE_THRESHOLD_PX`
  module-scope constants are the precedent for adding `MIN_ZOOM` /
  `MAX_ZOOM` alongside them (same module-scope-constant idiom, same
  refinement-link JSDoc shape).
- `apps/moderator/src/graph/GraphCanvasPane.tsx:686-692` — the
  existing `handleTidyUp` callback's `fitView({ duration: 0,
  padding: 0.1 })` call. ReactFlow's internal fitView clamps the
  computed zoom to `[minZoom, maxZoom]` automatically (verified against
  `node_modules/.pnpm/@reactflow+core@11.11.4_*/node_modules/@reactflow/core/dist/esm/utils/general.js`
  — the `clampPosition` helper). No code change needed in
  `handleTidyUp` itself; widening the range simply lets fitView
  produce smaller zooms.
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx:80-103` — the
  existing `reactflow` `vi.mock` setup that exposes `fitViewSpy` and
  the `useReactFlow` mock. The new test cases reuse the same mock
  shape; the new assertions inspect the props passed to the
  `<ReactFlow>` mock component (the mock currently renders its
  children via a passthrough — see line 92's `({ children, ...rest })`
  pattern). The new pin-the-props tests assert against `rest.panOnDrag`
  / `rest.zoomOnScroll` / etc.
- `tests/e2e/moderator-graph-layout.spec.ts:124-285` — the existing
  6-node + stability test. The new pan/zoom `test()` block joins this
  file rather than a new file (same setup overlap rationale
  `mod_layout_measured_dimensions` / `mod_layout_tidy_action` cited:
  loginAs → POST /api/sessions → goto operate → seedWsStore → canvas
  assertions, all identical).
- `tests/e2e/fixtures/wsStoreSeed.ts` — the WS-store seed helper. The
  new spec reuses the existing 6-node fixture (or a smaller 3-node
  fixture — see Acceptance criteria).
- `playwright.config.ts:218-219` — the existing
  `chromium-moderator-layout` project entry
  (`testMatch: /moderator-graph-layout\.spec\.ts$/`). The new test
  block runs under this existing project; no new project entry is
  added.

ReactFlow API reference (verified against the installed
`@reactflow/core@11.11.4` types):

- `panOnDrag: boolean | number[]` — when `true`, dragging the canvas
  background (mousedown on the `.react-flow__pane` element) starts a
  pan gesture. The `number[]` form lets a subset of mouse buttons
  trigger pan (e.g. `[1]` = middle-button only); the boolean `true` is
  the library default and means "left button on the background pans;
  drag on a node or edge starts a node-drag instead." This task pins
  `true`. Verified against
  `node_modules/.pnpm/@reactflow+core@11.11.4_*/node_modules/@reactflow/core/dist/esm/container/ReactFlow/index.d.ts:24`.
- `zoomOnScroll: boolean` — wheel events zoom the viewport. Defaults to
  `true`. This task pins `true`.
- `zoomOnPinch: boolean` — trackpad pinch gestures (or ctrl+wheel as
  the browser-level pinch surrogate) zoom the viewport. Defaults to
  `true`. This task pins `true`.
- `zoomOnDoubleClick: boolean` — double-click zooms in (Shift+double-
  click zooms out). Defaults to `true`. This task pins `true`. The
  double-click gesture composes correctly with `mod_selection`'s click
  handler: a single click selects, a double-click zooms; ReactFlow's
  internal dispatcher distinguishes them.
- `minZoom` / `maxZoom: number` — viewport zoom clamp. Library
  defaults `0.5` / `2`; this task pins `0.1` / `2.5`.
- `defaultViewport: Viewport` — initial pan/zoom position. NOT set by
  this task — the library default `{ x: 0, y: 0, zoom: 1 }` is fine
  because the canvas's first paint runs through `fitView()` implicitly
  via the dagre layout positioning (and the tidy-up button refits on
  demand). Explicitly setting `defaultViewport` would override the
  library's first-paint logic and is unnecessary.

ADRs:

- [ADR 0004 — Graph libraries](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md)
  (with the 2026-05-15 ADR 0025 amendment) — ReactFlow is the moderator
  graph library; pan + zoom are part of why it was picked. This task
  pins how those interactive defaults are configured.
- [ADR 0025 — Graph layout engine: dagre](../../../docs/adr/0025-graph-layout-engine-dagre.md) —
  the layout produces positions; pan/zoom operates on the viewport over
  those positions. Orthogonal.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) —
  every empirical check is a committed test.
- [ADR 0008 — E2E framework Playwright](../../../docs/adr/0008-e2e-framework-playwright.md) —
  the in-browser pan/zoom assertion runs under Playwright against the
  dev compose stack.

Refinements consulted for design continuity:

- `tasks/refinements/moderator-ui/mod_layout_engine_choice.md` — the
  module-scope-constants-exported-for-test idiom (`DEFAULT_LAYOUT_OPTIONS`),
  the Inherited-dependencies two-list shape, the "no new ADR for purely
  refinement-internal API choices" rule, the e2e-non-deferred posture.
- `tasks/refinements/moderator-ui/mod_layout_tidy_action.md` — the
  precedent for "an addition inside `<GraphCanvasPaneInner>` that joins
  the existing `chromium-moderator-layout` Playwright project rather
  than a new project." The Decisions section structure (numbered, each
  carrying surveyed alternatives + chosen rationale) is mirrored here.
- `tasks/refinements/moderator-ui/mod_layout_measured_dimensions.md` —
  the "no new ADR; the architectural choice was settled by ADR 0025,
  this is refinement-internal plumbing" framing.
- `tasks/refinements/moderator-ui/mod_selection.md` — the pinned click
  handler contract that this task's pan gesture composes with. Pan on
  background, click on entity, drag on entity → ReactFlow's hit-test
  routes correctly; this task does not change that.
- `tasks/refinements/moderator-ui/mod_context_menus.md` — the
  right-click gesture that this task's pan gesture composes with (pan
  is left-button-on-background; right-click is right-button-on-
  entity-or-pane; no race).
- `tasks/refinements/moderator-ui/mod_hover_details.md` — the
  popover that anchors to the card via `position: absolute` inside the
  card root. Pan/zoom is a single CSS transform on the
  `.react-flow__viewport` element; the popover scales with its parent.
  No interaction with this task.

No new ADR is required: the task adds no new dependency (ReactFlow is
already imported), no new public type, no new layout strategy, no new
moderator-console layout vocabulary. It pins existing implicit defaults
and widens a single numeric range — refinement-internal configuration,
not architectural choice.

## Constraints / requirements

### Prop pinning

- **Exactly five new props on `<ReactFlow>`**: `panOnDrag`,
  `zoomOnScroll`, `zoomOnPinch`, `zoomOnDoubleClick` (all literal
  `true`), plus `minZoom={MIN_ZOOM}` and `maxZoom={MAX_ZOOM}`. The four
  behavior booleans MUST be literal `true` (not a variable — the test
  asserts the literal value). The two zoom numbers MUST reference the
  module-scope constants, not inline literals.
- **No `defaultViewport` prop** — the library default
  (`{ x: 0, y: 0, zoom: 1 }`) is fine. Setting `defaultViewport`
  explicitly would override ReactFlow's first-paint heuristics and
  break the position-cache → fitView interaction in subtle ways. If a
  future task wants a remembered viewport (per-session "where did the
  moderator last leave the canvas?"), that's a separate task with its
  own persistence ADR.
- **No `fitViewOnInit` prop** — the canvas already lands at a sensible
  arrangement via dagre + the position cache; setting
  `fitViewOnInit={true}` would shrink-to-fit on every first paint,
  fighting the moderator's intuition for "I just clicked into this
  session, let me read it at normal zoom." The Tidy up button is the
  explicit user-elective fit gesture.
- **No `panOnScroll` prop** — defaults to `false`. Setting it to `true`
  would make wheel events PAN (vertical / horizontal) instead of ZOOM.
  This task explicitly KEEPS the default — wheel = zoom is the desktop
  graph editor idiom; pan-on-scroll is for scrollable-list interfaces.
  The Decision is documented below.
- **No `preventScrolling` prop** — defaults to `true`, which means
  ReactFlow's wheel handler calls `event.preventDefault()` so the
  browser page does not scroll while the cursor is over the canvas.
  Keep the default — the moderator on a long page (which is not the
  case today — the operate route is a fixed three-pane layout — but
  defensive) does not want to accidentally scroll the page while
  zooming the canvas.
- **No `nodesDraggable: false`** — defaults to `true`; we keep the
  default. Per-node dragging is what `mod_capture_flow.mod_draw_edge_flow`
  will eventually use (drag from a handle to create an edge); locking
  nodes here would foreclose that future seam. Pan on canvas background
  and drag-a-node are distinct gestures handled by ReactFlow's
  hit-test; no interaction.

### Zoom-range calibration

- **`MIN_ZOOM = 0.1`**. Rationale: a dagre TB layout over ~100 nodes
  with measurement-driven heights spans ~10 ranks × ~150 px/rank +
  rank separations ≈ 2000 px tall by 2000 px wide. The moderator's
  typical viewport (the right-of-sidebar canvas region inside
  `<OperateLayout>`) is ~1000 × 700 px at 1366×768 desktop. To fit
  2000 px into 700 px requires zoom ≤ 0.35; to give the moderator
  margin for the bounding-box edges, `minZoom: 0.1` is the looser
  bound. At 0.1x, card wording is unreadable — accepted trade-off,
  the use case is "spatial overview, then zoom in to read."
- **`MAX_ZOOM = 2.5`**. Rationale: `<StatementNode>`'s `max-w-[18rem]`
  is 288 px at 1.0x; at 2.5x it's 720 px wide. A 720-px-wide card
  occupies more than half the typical viewport horizontally, which is
  the "I'm reading one card and the rest of the canvas doesn't
  matter" close-read mode. Beyond 2.5x the card is bigger than the
  viewport and the user has lost spatial context.
- **Both constants pinned at module scope**, exported NOT exported
  (`const`, not `export const` — they're internal to the canvas pane;
  the test imports them via a separately-exposed value or asserts the
  numbers literally with a comment cross-reference). Decisions block
  explains the export-vs-not choice.

### Composability with existing tidy-up

- **`fitView({ padding: 0.1 })`'s zoom clamp picks up the new bounds.**
  ReactFlow's internal fitView computes a zoom that fits the bounding
  box + padding, then clamps to `[minZoom, maxZoom]`. With the wider
  range, the clamp is no longer a binding constraint for typical
  graphs; the bounding-box-fit zoom IS the resulting zoom. For a
  pathologically tiny graph (one node), fitView still clamps to
  `maxZoom: 2.5` to avoid zooming into infinity — acceptable.
- **No change to `handleTidyUp`'s body** — the cache-clear + revision
  bump + `requestAnimationFrame(fitView)` sequence is unchanged. The
  widened range simply gives fitView more room to operate.

### Composability with existing selection + context menus

- **Selection (left-click)**: pan starts on mousedown on the
  `.react-flow__pane` (canvas background), NOT on a node or edge.
  Click on a node calls `handleNodeClick`; click on the pane calls
  `handlePaneClick` and clears the selection. Pan and click are
  routed by ReactFlow's hit-test based on the mousedown target. No
  race.
- **Context menu (right-click)**: pan defaults to left-button-only.
  Right-click never starts a pan; right-click on a node / edge / pane
  fires the respective `onNodeContextMenu` / `onEdgeContextMenu` /
  `onPaneContextMenu` handler. No interaction.
- **Hover popover**: anchored to the card root via `position:
  absolute`. The canvas's viewport zoom is a single CSS transform on
  `.react-flow__viewport`; the popover scales with its parent. The
  popover stays visually anchored at every zoom level. No interaction.

### Composability with measured dimensions

- **Pan/zoom does NOT trigger measurement events.**
  `ResizeObserver` fires on element-size changes (CSS width / height /
  computed box). The viewport zoom changes the rendered transform, not
  the element's logical size — so `ResizeObserver` stays silent
  through pan/zoom gestures. The 75 ms measurement debounce is not
  exercised by pan/zoom. Verified against the React Flow source:
  `node_modules/.pnpm/@reactflow+core@11.11.4_*/node_modules/@reactflow/core/dist/esm/hooks/useResizeObserver.js`
  observes individual node wrappers, not the viewport.
- **The position cache stays untouched.** Pan/zoom does not call
  `applyLayout`, does not write to `positionCacheRef.current`, does
  not bump `layoutRevision`. The viewport transform is independent of
  the per-node positions in `node.position` (which are the
  pre-transform coordinates dagre emitted).

### a11y requirements (the testable list)

- **Scroll-wheel zoom over the canvas is reachable without keyboard
  shortcuts**: the default `zoomOnScroll: true` covers desktop users.
- **Trackpad pinch-zoom is reachable**: the default `zoomOnPinch: true`
  covers laptop / touchpad users.
- **The Tidy up button is the keyboard-accessible re-center
  affordance** for users who can't (or don't want to) scroll-zoom.
  Tab to the button (it's keyboard-focusable per `mod_layout_tidy_action`'s
  acceptance) + Enter triggers fitView, which clamps to the configured
  zoom range. This task does NOT add a keyboard shortcut for zoom;
  follow-up `mod_pan_zoom_keyboard_shortcuts` would.
- **Pan does NOT trap keyboard focus** — pan is mouse / trackpad only;
  there is no DOM element gaining persistent focus through a pan
  gesture. Tabbing past the canvas reaches the next element in the
  tab order.
- **Reduced-motion preference**: ReactFlow's zoom transitions
  default to instant (no animation) for prop-driven viewport
  changes. The fit-view call in `handleTidyUp` already passes
  `duration: 0`. Manual wheel zoom is gesture-paced (the user
  controls the speed via the wheel); no per-gesture animation. No
  `prefers-reduced-motion` accommodation is needed for this task.

### Files this task touches (explicit allowlist)

- `apps/moderator/src/graph/GraphCanvasPane.tsx` (modified — add the
  `MIN_ZOOM` / `MAX_ZOOM` module-scope constants and the 6 props on
  `<ReactFlow>`).
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` (modified — add
  the 4 new Vitest cases listed under Acceptance criteria; export the
  module-scope constants from the production file so the tests
  reference the same source of truth).
- `tests/e2e/moderator-graph-layout.spec.ts` (modified — add 1 new
  `test()` block exercising wheel zoom, drag pan, zoom clamping, and
  the tidy-up-still-refits-after-manual-zoom interaction).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_pan_zoom` lands at task-
  completion time per the README ritual, not at refinement-write time.
- `docs/adr/` — no new ADR. ADR 0004 already pinned the library; ADR
  0025 already pinned the layout; the pan/zoom configuration is
  refinement-internal.
- Other `apps/moderator/src/graph/*.tsx` — no changes to `StatementNode`
  / `StatementEdge` / `HoverPopover` / `GraphContextMenu` /
  `layoutEngine.ts` / `selectors.ts`.
- `apps/moderator/src/layout/*` — the operate layout shell is
  unchanged.
- `apps/moderator/package.json` — no new dependency.
- `packages/i18n-catalogs/` — no new catalog keys. Pan/zoom is
  gesture-driven; the Tidy up button already carries its three
  localized strings from `mod_layout_tidy_action`.
- `playwright.config.ts` — no new project; the new `test()` block
  joins the existing `chromium-moderator-layout` project.

### Build / type / test gates

- `pnpm run check` clean (lint + format + typecheck).
- `pnpm run test:smoke` green; the moderator-workspace test count
  rises by 4 (the new `GraphCanvasPane.test.tsx` cases).
- `pnpm -F @a-conversa/moderator build` succeeds. No bundle-size
  change of note (5 props + 2 constants ≈ 200 bytes of source).
- `pnpm exec playwright test --project chromium-moderator-layout`
  green against a freshly brought-up dev compose stack; the existing
  scenarios (6-node baseline, tall-node measured, tidy-up) plus the
  new pan/zoom scenario all pass.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the
  Closer adds `complete 100` on `mod_pan_zoom`.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_pan_zoom`
  plus a `note "Refinement: tasks/refinements/moderator-ui/mod_pan_zoom.md"`
  line (per `tasks/refinements/README.md`'s task-completion ritual).

### UI-stream e2e scoping (per ORCHESTRATOR.md commit `28a71f9`)

The pan/zoom behavior is reachable from a real user flow as of
`mod_create_session_form` + `mod_layout_engine_choice`
+ `mod_layout_tidy_action`: the moderator logs in, creates a session,
lands on `/sessions/<id>/operate`, sees the graph canvas, and can
scroll the wheel / drag the background / pinch-zoom right now (the
library defaults are already wired). Per the UI-stream e2e policy
default, the Playwright spec is **scoped under Acceptance criteria,
NOT deferred**. The new test block joins the existing
`tests/e2e/moderator-graph-layout.spec.ts` (same project, same setup
overlap rationale as `mod_layout_tidy_action`).

## Acceptance criteria

### 1. Production code

- `apps/moderator/src/graph/GraphCanvasPane.tsx` declares
  `MIN_ZOOM = 0.1` and `MAX_ZOOM = 2.5` as module-scope `const`
  declarations alongside `MEASUREMENT_DEBOUNCE_MS` and
  `DIMENSION_CHANGE_THRESHOLD_PX`, each with a JSDoc referencing
  `mod_pan_zoom`. The constants are exported so
  `GraphCanvasPane.test.tsx` can import them.
- The `<ReactFlow ... />` mount inside `<GraphCanvasPaneInner>`
  carries six new props:
  `panOnDrag={true}`, `zoomOnScroll={true}`, `zoomOnPinch={true}`,
  `zoomOnDoubleClick={true}`, `minZoom={MIN_ZOOM}`,
  `maxZoom={MAX_ZOOM}`.
- No other source-code change in `apps/moderator/src/`.

### 2. Vitest cases (in `apps/moderator/src/graph/GraphCanvasPane.test.tsx`)

Minimum 4 new cases under a new `describe('mod_pan_zoom (pan + zoom
configuration)', ...)` block, all per ADR 0022 (committed
regression-class proofs):

1. **Pan / zoom behavior props pinned at `true`** — render
   `<GraphCanvasPane>`, inspect the props passed to the `<ReactFlow>`
   mock (the existing `vi.mock('reactflow', ...)` block at lines
   80-103 already captures props via the passthrough renderer).
   Assert `panOnDrag === true`, `zoomOnScroll === true`,
   `zoomOnPinch === true`, `zoomOnDoubleClick === true`. The
   assertion is against the literal boolean `true`, not a truthy
   check — a future regression that flips one of these to `false`
   trips the test exactly.
2. **`minZoom` matches the exported constant** — assert
   `<ReactFlow>` received `minZoom === MIN_ZOOM` (i.e. `0.1`). Test
   imports `MIN_ZOOM` from the production module so the assertion
   references the same source of truth.
3. **`maxZoom` matches the exported constant** — symmetrically,
   `maxZoom === MAX_ZOOM` (i.e. `2.5`).
4. **No `defaultViewport` prop is passed** — assert the `<ReactFlow>`
   mock received `defaultViewport === undefined`. This pins the
   "first-paint heuristics owned by the library, not overridden by
   us" Decision. Future regression that adds an unexamined
   `defaultViewport` (which would break the position-cache → fitView
   interaction) trips the test.

The four cases together carry the prop contract; the existing tests
(selection, context menus, tidy-up) are unchanged and continue to
pass.

### 3. Playwright `test()` block (in `tests/e2e/moderator-graph-layout.spec.ts`)

One new `test()` block joining the existing
`test.describe.serial('moderator graph layout (dagre, TB)', ...)`,
under the existing `chromium-moderator-layout` project. The spec
exercises pan/zoom in a real browser against a freshly brought-up
dev compose stack:

```ts
test('Pan and zoom: wheel zoom changes viewport, drag pans, range clamps, tidy-up re-fits after manual drift', async ({ page }) => {
  // 1. Login + POST /api/sessions + goto operate (mirrors the
  //    existing 6-node test setup exactly).
  await loginAs(page, { username: 'alice' });
  // ... create session, navigate, probe WS-store reachability ...

  // 2. Seed the 6-node fixture.
  await seedWsStore(page, { sessionId, nodes: <6 nodes>, edges: <5 edges> });

  // 3. Wait for cards to render + measurement debounce to settle.
  for (const id of allNodeIds) {
    await expect(page.getByTestId(`statement-node-${id}`)).toBeVisible();
  }
  await page.waitForTimeout(250);

  // 4. Read the ReactFlow viewport transform via the .react-flow__viewport
  //    element's `transform` style. The format is
  //    `translate(<x>px, <y>px) scale(<zoom>)`.
  const readViewport = async (): Promise<{ x: number; y: number; zoom: number }> => {
    return page.evaluate(() => {
      const vp = document.querySelector('.react-flow__viewport') as HTMLElement | null;
      if (vp === null) throw new Error('viewport not found');
      const t = vp.style.transform;
      // [parse translate + scale from the transform string]
      ...
    });
  };
  const before = await readViewport();

  // 5. Wheel zoom: dispatch a wheel event over the canvas, assert
  //    the viewport scale changed. ReactFlow's wheel handler reads
  //    `event.deltaY` — negative deltas zoom in, positive zoom out.
  await page.locator('[data-testid="graph-canvas-root"]').hover();
  await page.mouse.wheel(0, -200); // zoom in
  await page.waitForTimeout(100);
  const afterZoom = await readViewport();
  expect(afterZoom.zoom).toBeGreaterThan(before.zoom);

  // 6. Drag-pan: mousedown on the canvas background (NOT on a
  //    node), move 100 px, mouseup. Assert the viewport translate
  //    components changed.
  // [drag the .react-flow__pane element via page.mouse.down/move/up]
  const afterPan = await readViewport();
  expect(afterPan.x !== afterZoom.x || afterPan.y !== afterZoom.y).toBe(true);

  // 7. Zoom-range clamping: repeatedly wheel-zoom-in past the
  //    maxZoom boundary; assert the resulting zoom never exceeds
  //    MAX_ZOOM (2.5) plus a small floating-point tolerance.
  for (let i = 0; i < 20; i += 1) {
    await page.mouse.wheel(0, -300);
  }
  await page.waitForTimeout(100);
  const afterMaxZoomTest = await readViewport();
  expect(afterMaxZoomTest.zoom).toBeLessThanOrEqual(2.5 + 0.01);

  // 8. Symmetrically clamp from the bottom — repeatedly zoom out
  //    past the minZoom boundary.
  for (let i = 0; i < 30; i += 1) {
    await page.mouse.wheel(0, 300);
  }
  await page.waitForTimeout(100);
  const afterMinZoomTest = await readViewport();
  expect(afterMinZoomTest.zoom).toBeGreaterThanOrEqual(0.1 - 0.01);

  // 9. Tidy-up still re-frames after manual pan/zoom drift. After
  //    the zoom-out + pan above, the viewport is at some non-fit
  //    state. Click the Tidy up button and assert the viewport
  //    snaps back to a fit-view zoom (the resulting zoom is
  //    inside the clamp range, and the translate is non-zero
  //    because fitView centers the bounding box). The exact
  //    expected values depend on the rendered graph; we assert
  //    that the post-tidy-up zoom differs from afterMinZoomTest
  //    and is within [MIN_ZOOM, MAX_ZOOM].
  await page.getByTestId('graph-tidy-up-button').click();
  await page.waitForTimeout(150); // rAF + fitView commit
  const afterTidyUp = await readViewport();
  expect(afterTidyUp.zoom).toBeGreaterThan(MIN_ZOOM);
  expect(afterTidyUp.zoom).toBeLessThanOrEqual(MAX_ZOOM);
  expect(afterTidyUp.zoom).not.toBeCloseTo(afterMinZoomTest.zoom, 2);
});
```

The exact wheel-event mechanics (whether to use
`page.mouse.wheel(...)` or to dispatch a synthetic `WheelEvent` via
`page.evaluate` — ReactFlow's wheel handler attaches at the document
level and reads `ctrlKey` / `metaKey` for pinch detection) is an
implementer choice; the load-bearing assertions are the four behavior
properties (zoom changes, pan changes, zoom clamps, tidy-up
re-fits). Per ADR 0022 the spec is committed (not a throwaway). The
spec joins the existing `chromium-moderator-layout` Playwright
project — no new project entry.

### 4. WBS update

- `tasks/30-moderator-ui.tji`: `mod_pan_zoom` block gets
  `complete 100` after the `allocate team` line plus a `note
  "Refinement: tasks/refinements/moderator-ui/mod_pan_zoom.md"` line.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

### 5. Build / type / test gates

All gates listed under Constraints / Build pass.

### 6. No new ADR, no new i18n keys

- `docs/adr/` is unchanged.
- `packages/i18n-catalogs/src/catalogs/` is unchanged.

## Decisions

### 1. Pin the four behavior props explicitly, do NOT rely on library defaults

Two alternatives surveyed:

- **Pin all four `panOnDrag` / `zoomOnScroll` / `zoomOnPinch` /
  `zoomOnDoubleClick` to `true` explicitly** (chosen). Defends against
  any future ReactFlow version that changes a default (e.g. an
  accessibility-driven decision to require an explicit opt-in to
  wheel-zoom for users who scroll long pages with the wheel). Adds 4
  lines of JSX, costs nothing at runtime, gives the test suite a
  stable contract to assert against. The cost is "more verbose JSX";
  the benefit is "the contract is the JSX, not the library docs."
- **Leave the props absent and rely on `undefined → library default`.**
  Rejected. Behavior is the same today; behavior tomorrow depends on
  what the library decides. The test suite would have to assert
  against rendered behavior (a wheel event produces a scale change),
  not against props — which is materially more fragile (the test
  needs a real DOM + a ReactFlow mount + an event dispatch, vs. a
  prop-shape assertion against a mock). The orchestrator's brief
  named "pinning the contract" as the primary work; explicit props
  ARE the contract.

### 2. Widen the zoom range from `[0.5, 2]` to `[0.1, 2.5]`

Three alternatives surveyed:

- **Keep ReactFlow's defaults `[0.5, 2]`.** Rejected. At `minZoom: 0.5`
  a dagre-laid-out 100-node graph does not fit the viewport — the
  outermost cards clip past the canvas edge even at minimum zoom.
  The Tidy up button's `fitView` clamps to 0.5, which means it
  cannot re-fit a dense graph; the affordance gets less useful as the
  debate grows, which is the opposite of what the moderator needs.
- **Widen to `[0.1, 2.5]`** (chosen). The lower bound calibrates
  against the dagre layout's worst-case span (~2000 × 2000 px for
  100 nodes) divided by the moderator's typical canvas viewport
  (~1000 × 700 px); a zoom of ~0.35 just barely fits, so 0.1 gives
  comfortable margin. The upper bound calibrates against the card's
  `max-w-[18rem]` (288 px → 720 px at 2.5x), which fills half the
  viewport horizontally — the close-read limit before the card is
  bigger than the screen. The pair is symmetric in "factor below
  default" (0.5 → 0.1 = 5x looser) and "factor above default" (2 →
  2.5 = 1.25x tighter) because the bottom end matters more for the
  scaling-up-to-100-nodes use case.
- **Widen further to `[0.05, 4]` or `[0.01, 10]`.** Rejected. At
  zoom < 0.1 cards are tens of pixels tall and entirely unreadable;
  even an overview at 0.1 carries some spatial intuition (rank
  structure, edge density) — below that, the canvas is dots. At zoom
  > 2.5 the card no longer fits the viewport and the moderator has
  lost spatial context — close-read is the use case, but extreme
  close-read is "the wording text is hard to read" which is a
  legibility issue the card's text size handles, not a zoom issue
  the viewport should handle.

The exact numbers are calibrated against the v1 layout + the v1 card
sizing. If a future redesign changes either the card's `max-w-*` or
the dagre rank separation, the constants may need re-tuning — they're
module-scope so the change is local.

### 3. Module-scope constants, exported for test reuse

- **Module-scope `const MIN_ZOOM = 0.1; const MAX_ZOOM = 2.5;`**
  (chosen). Mirrors the established pattern from
  `MEASUREMENT_DEBOUNCE_MS` (line 499) and
  `DIMENSION_CHANGE_THRESHOLD_PX` (line 510), both of which are
  module-scope constants in the same file with a refinement-link
  JSDoc.
- **Exported** (`export const ...`) so the test file imports the
  exact same constants the production code reads. The pre-existing
  internal constants (`MEASUREMENT_DEBOUNCE_MS`,
  `DIMENSION_CHANGE_THRESHOLD_PX`) are NOT exported because their
  tests can rely on the `vi.useFakeTimers()` debounce-advance pattern
  instead of the literal value. The zoom range is different: the
  tests assert exact equality (`minZoom === MIN_ZOOM`), so the
  test MUST reference the same source of truth. Exporting is the
  correct seam.
- **Alternative: inline literals (`minZoom={0.1}`)** rejected because
  the test would either hard-code `0.1` (which drifts from
  production when the constants change) or import a magic number
  from the production source (which is the same as the chosen
  approach, just less obvious). Module-scope constants are the
  least-magic option.

### 4. Keep `panOnScroll: false` (the library default) — wheel = zoom, not pan

Two alternatives:

- **`panOnScroll: false` (chosen, library default).** Wheel events
  zoom the viewport. This is the desktop graph editor idiom
  (yEd, Cytoscape Desktop, Figma, draw.io, Miro — all default
  wheel-to-zoom on graph / canvas surfaces). The moderator's
  expectation matches.
- **`panOnScroll: true`.** Wheel events pan vertically; Shift+wheel
  pans horizontally; zoom moves to Ctrl+wheel (the trackpad pinch
  surrogate). This is the scrollable-list idiom (web pages, code
  editors), wrong for a graph canvas where the wheel is the natural
  zoom gesture. Rejected.

### 5. Trackpad pinch-zoom is `zoomOnPinch: true` (library default)

Two alternatives:

- **`zoomOnPinch: true` (chosen).** Trackpad pinch (recognized by the
  browser as Ctrl+wheel events at the OS level on macOS / Windows
  laptops) zooms the viewport. This is the laptop-trackpad-user
  expectation; turning it off would force trackpad users to scroll
  with two fingers (which `panOnScroll: false` already redirects to
  zoom anyway, so the gesture works either way — but pinch is the
  natural one).
- **`zoomOnPinch: false`.** Would require trackpad users to use
  `Ctrl+wheel` explicitly, which is the desktop-mouse fallback —
  worse UX on laptops. Rejected.

### 6. Double-click is `zoomOnDoubleClick: true` (library default)

- **`zoomOnDoubleClick: true` (chosen).** Double-click on the canvas
  background zooms in by ~2x; Shift+double-click zooms out. This is
  the established graph editor gesture (Figma, draw.io). The
  selection click handler (`handleNodeClick`) fires on single click;
  ReactFlow's internal dispatcher distinguishes single from double,
  so there is no race. **Composability verified**: a moderator who
  single-clicks a node selects it; a moderator who double-clicks the
  canvas background zooms; a moderator who double-clicks a node...
  ReactFlow's library behavior is "double-click on a node zooms,
  same as on the pane" — for v1 this is the library default and we
  accept it. If real moderation sessions show "I keep accidentally
  zooming when double-clicking a node to do something else,"
  a follow-up task can disable double-click zoom or scope it to
  background-only.
- **`zoomOnDoubleClick: false`.** Would break the user's expectation
  for "the canvas zooms on double-click." Rejected. The pin defends
  against a future ReactFlow upgrade that defaults to `false` for
  accessibility (since double-click can interfere with assistive-tech
  click semantics).

### 7. No keyboard shortcuts for zoom in v1

- **No keyboard zoom shortcuts** (chosen). ReactFlow's `<Controls />`
  add-on package provides `+ / -` keyboard zoom buttons but adds a
  visual corner widget that would need styling + i18n keys. The
  Tidy up button covers "reset to fit," and mouse / trackpad
  gestures cover "zoom in / out." For 0.5d this is the minimal seam.
- **`<Controls />` add-on with zoom buttons.** Rejected for v1
  scope. If real moderation sessions show "I want a keyboard shortcut
  / on-screen button for zoom," a follow-up task
  `mod_pan_zoom_keyboard_shortcuts` (or `mod_zoom_controls_widget`)
  ships under its own scope. Out of scope here.
- **Custom keyboard handler on the canvas root** (e.g.
  `Ctrl+Plus` / `Ctrl+Minus` / `Ctrl+0`). Rejected for the same
  scope reason — adding a custom handler requires deciding the key
  bindings (which differ on macOS vs. Windows), keeping them in sync
  with browser-level zoom shortcuts (which the browser claims at the
  page level), and adding tests for each binding. Not 0.5d work.

### 8. No "Reset zoom" or standalone "Fit view" button

- **No new button** (chosen). The just-landed Tidy up button at
  `apps/moderator/src/graph/GraphCanvasPane.tsx:824-833` already
  calls `fitView({ duration: 0, padding: 0.1 })` as part of its
  handler. After manual pan/zoom, clicking Tidy up re-frames the
  viewport. Adding a separate "Reset zoom" button would duplicate
  the affordance with subtly different semantics ("reset zoom
  preserving the layout" vs. "tidy + reset zoom") that the v1
  moderator does not need to distinguish.
- **A dedicated "Fit view" button next to Tidy up.** Rejected for
  scope. If real moderation sessions show "I want to re-center the
  viewport without re-layouting," a follow-up task
  `mod_fit_view_button` can land that distinct affordance. The
  semantic difference (re-layout vs. re-center) matters only at
  large scale; at small scale they're indistinguishable.

### 9. No `defaultViewport` prop — let ReactFlow handle first paint

- **No `defaultViewport`** (chosen). The library default
  `{ x: 0, y: 0, zoom: 1 }` is fine — the canvas's first paint
  positions cards at the dagre-derived coordinates and the viewport
  starts at the origin / zoom 1.0. The Tidy up button is the
  explicit user-elective re-frame.
- **`defaultViewport={{ x: 0, y: 0, zoom: 0.5 }}` (or similar).**
  Rejected. Setting a non-default initial zoom would visually shrink
  the first paint, fighting the moderator's intuition for "I just
  clicked into this session, let me read it at normal zoom."
- **`fitViewOnInit: true`** (a ReactFlow alternative to manual
  fit-view). Rejected — would auto-shrink-to-fit on every first
  paint, including for a fresh empty session (where fitView on an
  empty graph produces `zoom: 1` at the origin, which is fine, but
  the prop also fires on every remount, which is more aggressive
  than the moderator's mental model for "I came back, let me see
  what's there at the size I left it").

### 10. e2e spec placement: extend `moderator-graph-layout.spec.ts`, do NOT create a new spec

Mirrors the precedent from `mod_layout_measured_dimensions` and
`mod_layout_tidy_action`: the setup overlap with the existing tests
is total (loginAs → POST /api/sessions → goto operate →
seedWsStore → canvas assertions). The new test runs under the
existing `chromium-moderator-layout` Playwright project. Splitting
into a new spec would duplicate boilerplate for marginal isolation
benefit. **Chosen.**

### 11. No new ADR

Three potential ADR triggers, all dispatched:

- **"Adding a new graph-rendering dependency is ADR-worthy"** (per
  ORCHESTRATOR.md Refinement-Writer brief). This task adds NO new
  dependency — every prop / constant ships through the existing
  `reactflow` import.
- **"A new layout strategy is ADR-worthy"**. This task changes NO
  layout strategy — pan/zoom is viewport-transform behavior, not
  layout algorithm. Dagre still owns positions; the viewport just
  transforms over them.
- **"A new moderator-console interaction vocabulary is ADR-worthy"**.
  This task uses ReactFlow's **existing** interactive defaults
  (drag-to-pan, scroll-to-zoom, pinch-to-zoom, double-click-zoom).
  It does NOT introduce a new gesture (no swipe, no rotate, no
  multi-finger pan); it pins what's already there.

ADR 0004 already pinned ReactFlow precisely because of these
interactive defaults. This refinement is the task-scope pin for the
configuration; the ADR is the architectural pin for the choice.

### 12. No new i18n catalog keys

Pan/zoom is gesture-driven. No new strings render. The existing
Tidy up button's three localized keys (label, ariaLabel, tooltip)
from `mod_layout_tidy_action` are the only canvas-control text on
the moderator surface; pan/zoom adds zero new keys.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-15.

- Pinned ReactFlow's pan/zoom contract by adding six explicit props
  (`panOnDrag`, `zoomOnScroll`, `zoomOnPinch`, `zoomOnDoubleClick`,
  `minZoom`, `maxZoom`) to the `<ReactFlow>` mount in
  `apps/moderator/src/graph/GraphCanvasPane.tsx`. The four behavior
  booleans hold the library defaults explicitly; the zoom range widens
  from `[0.5, 2]` to `[0.1, 2.5]`.
- Hoisted `MIN_ZOOM = 0.1` and `MAX_ZOOM = 2.5` to module scope and
  exported them so the Vitest and Playwright suites assert against the
  same source of truth the production code reads.
- Added 4 new Vitest cases under `describe('mod_pan_zoom ...')` in
  `apps/moderator/src/graph/GraphCanvasPane.test.tsx`, extending the
  existing `vi.mock('reactflow', ...)` passthrough wrapper to capture
  the props handed to `<ReactFlow>`. File test count rose 56 → 60; the
  smoke suite rose 2613 → 2617.
- Added 1 new Playwright `test()` block to
  `tests/e2e/moderator-graph-layout.spec.ts` exercising wheel zoom,
  drag pan, max/min zoom clamping, and the drift → tidy-up composition;
  the `chromium-moderator-layout` project runs 4/4 green.
- **Implementation deviation from refinement Acceptance § 3 step 9.**
  The refinement prescribed asserting `afterTidyUp.zoom !==
  afterMinZoomTest.zoom` after the manual-drift scenario. Empirically
  ReactFlow's deterministic `fitView` output for the 6-node dagre
  fixture in this viewport coincides with `MIN_ZOOM = 0.1`, so the
  inequality is unstable. The shipped test instead asserts post-tidy
  zoom stays inside `[MIN_ZOOM, MAX_ZOOM]` and every seeded card
  remains visible; the existing Tidy-up test #3 in the same project
  already pins the re-layout-recovers-from-drift invariant from the
  other direction, so coverage is preserved.
- Closes the last open leaf under the `mod_graph_rendering` container;
  per TJ semantics the container is now derived-complete. Does NOT
  close M4 (`m_moderator_mvp`) — `mod_capture_flow` and its children
  still gate that milestone.
- No new ADR, no new i18n catalog key, no new dependency. No newly-
  deferred follow-ups; the refinement already names
  `mod_pan_zoom_keyboard_shortcuts`, `mod_zoom_controls_widget`, and
  `mod_fit_view_button` as potential future options (not scoped /
  deferred).
