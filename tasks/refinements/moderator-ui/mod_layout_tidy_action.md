# Moderator graph "tidy up" action — wire `relayoutAll()` to a moderator-visible button

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) —
`moderator_ui.mod_graph_rendering.mod_layout_tidy_action`. Registered as tech debt
by the Closer of `mod_layout_engine_choice` (commit `4666b4c`-era WBS update) per
the ORCHESTRATOR.md `b7c5ff0` tech-debt registration policy.

```
task mod_layout_tidy_action "Wire relayoutAll() to a moderator-visible 'tidy up' button" {
  effort 0.5d
  allocate team
  depends !mod_layout_engine_choice
  note "Source of debt: mod_layout_engine_choice (commit added by this Closer) — relayoutAll() seam is exported but not wired to a button. A 'tidy up' control in the moderator UI lets the operator force a full re-layout when the incremental position cache produces an awkward arrangement."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md (commit b7c5ff0)."
}
```

## Effort estimate

**0.5d.** Confirmed. The work is pure wiring on top of seams already in place:
the `relayoutAll(...)` function is exported from
`apps/moderator/src/graph/layoutEngine.ts:345`; the position cache
(`positionCacheRef`) and measurement cache (`measurementCacheRef`) already live
inside `<GraphCanvasPaneInner>`; the `nodes` `useMemo` already keys on
`layoutRevision` for measurement-driven re-runs. Concretely the deliverable is:

- One floating-action `<button>` rendered as a sibling of `<ReactFlow>` inside
  `<GraphCanvasPaneInner>`'s root `<div data-testid="graph-canvas-root">`.
- One `handleTidyUp` click handler that (a) clears `positionCacheRef.current`,
  (b) bumps the existing `layoutRevision` state counter so the `nodes` `useMemo`
  re-runs against the empty cache, (c) calls `useReactFlow().fitView({ duration: 0 })`
  after a microtask so the viewport re-frames the freshly arranged graph.
- 3 new i18n catalog keys under `moderator.graph.tidyUp.*` (button label,
  aria-label, tooltip / title attribute) landed in all three v1 locales with the
  pt-BR / es-419 drafts flagged PENDING in the existing `*.review.json` lifecycle.
- ~6 new Vitest cases in `apps/moderator/src/graph/GraphCanvasPane.test.tsx`
  (button renders / aria-label resolves / click clears the position cache / click
  bumps `layoutRevision` / click re-routes through dagre / click is a no-op on
  empty canvas).
- 1 new Playwright `test()` block in
  `tests/e2e/moderator-graph-layout.spec.ts` exercising the button against the
  existing 6-node seeded fixture (the button is now reachable — the moderator
  operate route is live since `mod_create_session_form`, so the e2e is scoped,
  not deferred).
- 1 follow-up tech-debt task registered in `tasks/35-frontend-i18n.tji` for the
  native-speaker review of the 9 new draft entries (3 keys × pt-BR + es-419, plus
  the en-US authoritative).

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their public
contracts):

- **`moderator_ui.mod_graph_rendering.mod_layout_engine_choice`** (done —
  `apps/moderator/src/graph/layoutEngine.ts:345` exports `relayoutAll<T>(nodes,
  edges, options?)` as a pure function that ignores any cached positions and
  feeds every node + edge to dagre for a fresh pass. The exported function is
  the contract this task binds to a UI affordance; the Closer of
  `mod_layout_engine_choice` shipped it specifically for this task to consume).
- **`moderator_ui.mod_graph_rendering.mod_layout_measured_dimensions`** (done —
  `<GraphCanvasPaneInner>` carries `measurementCacheRef` keyed by node id with
  per-card `{width, height}` rects sourced from ReactFlow's internal
  measurement store. A "tidy up" pass MUST honor those measurements — running
  dagre against the constant 288×90 fallback would produce a less-tight
  arrangement than the measurement-driven one the moderator already had. This
  task threads `dimensions: measurementCacheRef.current` into the `relayoutAll`
  invocation path; the `measurementCacheRef` itself is read-only from this
  task's perspective (its population is the measurement effect's responsibility
  and remains unchanged)).
- **`moderator_ui.mod_graph_rendering.mod_node_rendering`** /
  **`mod_edge_rendering`** (done — `<StatementNode>` and `<StatementEdge>`
  render whatever positions the layout pass emits; both are pure consumers of
  `node.position` and don't observe the trigger that produced it).
- **`moderator_ui.mod_graph_rendering.mod_diagnostic_highlighting`** /
  **`mod_per_facet_state_visualization`** / **`mod_axiom_mark_decoration`** /
  **`mod_meta_disagreement_split_render`** (done — every decoration layer
  renders inside the card body and contributes to the measured footprint via
  the measurement effect; the tidy-up pass naturally absorbs whatever heights
  these layers produce because `dimensions: measurementCacheRef.current`
  carries them through).
- **`moderator_ui.mod_graph_rendering.mod_selection`** /
  **`mod_context_menus`** (done — selection state lives in `useSelectionStore`,
  not in `node.position`; tidy-up does not clear the selection. The context
  menu state is local component state and is unaffected).
- **`moderator_ui.mod_shell.mod_layout_shell`** (done — `<OperateLayout>` allots
  the graph pane a 1fr column + 1fr row of CSS grid space and its
  `data-testid="operate-graph-pane"` wraps `<GraphCanvasPane>`. The tidy-up
  button lives INSIDE `<GraphCanvasPane>`'s root div, not the shell — the shell
  is structural-only).
- **`moderator_ui.mod_session_setup.mod_create_session_form`** (done — the
  operate route is reachable from the browser via `/sessions/new/setup` →
  `POST /api/sessions` → `/sessions/<id>/operate`. The button this task lands
  is reachable from a real user flow, which is what makes the Playwright e2e
  the non-deferred default per the UI-stream e2e policy).
- **`frontend_i18n.i18n_library_choice`** /
  **`frontend_i18n.i18n_catalog_workflow`** (done — `useTranslation()` from
  `react-i18next`, the catalog parity-check script, and the `*.review.json`
  PENDING-flag lifecycle are all in place; the new keys flow through the same
  pipeline).
- **[ADR 0025 — Graph layout engine: dagre](../../../docs/adr/0025-graph-layout-engine-dagre.md)**
  (Accepted 2026-05-15) — pinned `relayoutAll(...)` as the user-triggered "tidy
  up" escape valve for the position-cached incremental layout strategy. The ADR
  text under "Stability strategy" reads: "A `relayoutAll()` function — exported
  alongside the incremental projection — exists for a future user-triggered
  'tidy up' action; v1 does not ship the action itself, only the function it
  will eventually call." THIS task is that future action.
- **[ADR 0004 — Graph libraries (ReactFlow + Cytoscape)](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md)**
  (with ADR 0025 amendment) — ReactFlow on the moderator surface; the
  `useReactFlow().fitView(...)` re-frame call after re-layout is the canonical
  pattern documented in the library's own auto-layout example.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)** —
  every empirical check ships as a committed Vitest / Playwright case.

Pending edges (this task does NOT depend on them):

- `moderator_ui.mod_graph_rendering.mod_pan_zoom` — orthogonal. Tidy-up re-runs
  layout positions; pan/zoom operates on whatever positions land in
  `Node.position`. The fitView call this task makes is a deliberate one-shot
  viewport re-frame, not an ongoing pan/zoom policy.
- `moderator_ui.mod_capture_flow.*` — downstream consumers. Capture flow
  composes more naturally with a tidy-up control that lets the moderator reset
  the arrangement after several captures pile up.
- `frontend_i18n.i18n_layout_tidy_action_native_review` (registered by this
  task — see Acceptance criteria / Decisions). The pt-BR / es-419 drafts of
  the 3 new keys land flagged PENDING; the follow-up replaces them with
  native-speaker-reviewed text. Not a precondition for the button surfacing —
  a draft is rendered just as readily as a reviewed string.

## What this task is

Concrete, mechanical work, all inside the existing moderator workspace:

### A. The button — rendered inside `<GraphCanvasPaneInner>`

A floating-action button rendered as a sibling of `<ReactFlow>` inside the root
`<div data-testid="graph-canvas-root">` returned by `GraphCanvasPaneInner` at
`apps/moderator/src/graph/GraphCanvasPane.tsx:781-808`. Concretely the JSX
addition is, immediately after the closing `</ReactFlow>`:

```tsx
<button
  type="button"
  data-testid="graph-tidy-up-button"
  aria-label={t('moderator.graph.tidyUp.ariaLabel')}
  title={t('moderator.graph.tidyUp.tooltip')}
  onClick={handleTidyUp}
  className="absolute right-4 top-4 z-10 rounded bg-white px-3 py-1.5 text-sm font-medium text-slate-900 shadow ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
>
  {t('moderator.graph.tidyUp.label')}
</button>
```

The root `<div>` already carries `className="h-full w-full"` but no
`position: relative`. The button's `absolute` positioning requires the parent
to be `position: relative` — this task amends the root div to
`className="relative h-full w-full"`. ReactFlow's own root mounts as a child
with its own positioning context, so adding `relative` to our wrapper does not
change ReactFlow's layout; it only anchors our sibling button.

The button lives in the top-right corner because (a) the moderator's typical
gaze pattern after a layout settles is upper-left → lower-right (claim at top,
evidence below); a top-right control is out of the reading path but immediately
in the screen-scanning periphery; (b) the bottom of the canvas is reserved for
`<BottomStripCapture>` from `mod_bottom_strip_capture`; the top-left is taken
by the ReactFlow attribution + (eventually) zoom controls; the top-right is the
unclaimed quadrant.

### B. The handler — `handleTidyUp` inside `<GraphCanvasPaneInner>`

```tsx
const { fitView } = useReactFlow();

const handleTidyUp = useCallback((): void => {
  // Clear the position cache so the next `useMemo` tick treats every
  // node as a cache miss. The `nodes` `useMemo` calls `applyLayout(...)`
  // (not `relayoutAll(...)`) — when the cache is empty, `applyLayout`
  // routes every node through dagre, which produces the same output
  // `relayoutAll` would. Going through `applyLayout` rather than swapping
  // in a `relayoutAll` call preserves the existing memoization shape and
  // the cache-write-back loop at lines 655-657, which is the seam the
  // measurement-effect at lines 685-764 relies on.
  positionCacheRef.current.clear();
  // Bump the existing `layoutRevision` state counter so the `nodes`
  // `useMemo` (deps: `[events, diagnosticHighlights, edges, layoutRevision]`)
  // re-runs against the freshly-emptied cache. Pre-existing seam from
  // `mod_layout_measured_dimensions`; we are a second writer to it.
  setLayoutRevision((r) => r + 1);
  // After the re-layout commits, re-frame the viewport. The
  // `requestAnimationFrame` defers `fitView` past the React commit cycle
  // that lands the new positions, so ReactFlow's internal node-position
  // store reads the post-relayout values when fitView computes its
  // bounding box. `duration: 0` is the deliberate no-animation choice:
  // tidy-up is an explicit user-elective rearrangement; animating the
  // viewport zoom would compose poorly with the instant snap of every
  // node's new position (per ADR 0025's no-animation precedent).
  requestAnimationFrame(() => {
    fitView({ duration: 0, padding: 0.1 });
  });
}, [fitView]);
```

The choice to clear the position cache + bump `layoutRevision` (rather than
swap the `applyLayout(...)` call for a `relayoutAll(...)` call) is a Decision
below; the load-bearing property is that the resulting position-emission path
is identical to a `relayoutAll(...)` invocation when the cache is empty (this
is provable from `layoutEngine.ts:264` — `applyLayout` over an empty cache
produces "the same result as `relayoutAll(...)` for the same inputs" per the
function's own contract documentation).

### C. The i18n catalog entries — 3 keys under `moderator.graph.tidyUp.*`

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.graph.tidyUp.label` | "Tidy up" | "Organizar" | "Reorganizar" |
| `moderator.graph.tidyUp.ariaLabel` | "Re-layout the graph to a fresh arrangement" | "Reorganizar o grafo para um novo arranjo" | "Reorganizar el grafo en un arreglo nuevo" |
| `moderator.graph.tidyUp.tooltip` | "Recalculates every node's position from scratch — useful when the canvas feels cluttered." | "Recalcula a posição de cada nó do zero — útil quando o canvas parece desorganizado." | "Recalcula la posición de cada nodo desde cero — útil cuando el canvas se ve desordenado." |

**Count: 3 keys × 3 locales = 9 catalog entries**. The pt-BR + es-419 drafts
land flagged PENDING in `packages/i18n-catalogs/src/catalogs/pt-BR.review.json`
and `es-419.review.json` (same pattern as `i18n_methodology_role_descriptions`,
`mod_create_session_form`). The en-US is authoritative.

### D. Tests — Vitest + Playwright per ADR 0022

See Acceptance criteria below for the case list.

### E. Follow-up native-review task registered

The Closer of this task adds a new leaf to `tasks/35-frontend-i18n.tji`:

```
task i18n_layout_tidy_action_native_review "Native-speaker review of pt-BR + es-419 tidy-up button strings" {
  effort 0.5d
  allocate team
  depends !i18n_create_session_form_native_review
  note "Source of debt: mod_layout_tidy_action (this commit) — pt-BR and es-419 drafts of the 3 keys under moderator.graph.tidyUp.* landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers. UI prose translation (lower bar than methodology terms but still needs review)."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md (commit b7c5ff0)."
}
```

Effort: 0.5d. Depends on the prior native-review chain
(`i18n_create_session_form_native_review`) to keep the review work serializable
under a single review-allocation slot.

## Why it needs to be done

Three reasons, in priority order:

1. **The function exists for this caller and only this caller.** ADR 0025's
   Stability-strategy decision explicitly named the user-triggered "tidy up"
   path as the third leg of the position-cache + auto-incremental-relayout
   tripod. The predecessor refinement shipped the function but left the affordance
   open as tech-debt with this task as its named follow-up. Until the button
   exists, an awkward layout (e.g. a late-arriving node that the dagre
   incremental pass placed below its visual neighbours because cache lookups
   pin most of the canvas) is unfixable from the moderator's seat —
   `relayoutAll(...)` is exported but unreachable, which is the worst kind of
   dead-code-from-a-user's-perspective.

2. **The incremental position cache is a one-way ratchet without it.** The
   `mod_layout_measured_dimensions` measurement loop evicts per-id positions
   when a measurement changes, which handles the "this card grew" case. The
   position cache itself, however, accumulates positions monotonically — a
   node placed at `(640, 200)` on tick 3 STAYS at `(640, 200)` for the entire
   session unless its measurement changes. The moderator's recourse when the
   accumulated arrangement gets messy is "drag every node manually" or "leave
   and re-enter the route" (which clears the per-component-instance ref).
   Both are bad UX. Tidy-up is the explicit reset valve.

3. **It unblocks the capture-flow stream's UX coherence.** `mod_capture_flow.*`
   will let the moderator add many nodes in quick succession; the position-cache
   stability that makes incremental insertion non-disorienting also accumulates
   any sub-optimal placement decisions. Capture-flow tasks that ship a tidy-up
   affordance alongside their insertion UX are materially better than ones that
   require an out-of-band gesture; landing this task first means the gesture
   is already there and capture-flow can reference it.

Downstream, this task does not unblock a milestone (it is a quality-of-life
follow-up, not on any milestone critical path), but it closes a registered
tech-debt entry that's been waiting since `mod_layout_engine_choice` shipped
on 2026-05-15.

## Inputs / context

Code seams the implementation plugs into (real file paths + real line numbers,
all verified against the working tree):

- `apps/moderator/src/graph/layoutEngine.ts:345-362` — the exported
  `relayoutAll<T>(nodes, edges, options?)` function. The function ignores any
  cache and feeds every node + edge to dagre. Per the contract comment at
  `layoutEngine.ts:264`: "`applyLayout` over an empty cache produces the same
  result as `relayoutAll(...)` for the same inputs." This task does NOT touch
  the function itself; it consumes it transitively by emptying the cache the
  existing `applyLayout(...)` call site already reads.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:625-665` — the `positionCacheRef`
  declaration, the `measurementCacheRef` declaration, the `layoutRevision`
  state slot, and the `nodes` `useMemo` block this task instructs to re-run via
  the cache-clear + revision-bump. The deps array
  `[events, diagnosticHighlights, edges, layoutRevision]` is reused as-is — no
  new dep is added.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:781-808` — the JSX return block
  where the new button is inserted as a sibling of `<ReactFlow>` inside the
  root `<div data-testid="graph-canvas-root">`. The root div's className grows
  from `"h-full w-full"` to `"relative h-full w-full"` to provide a
  positioning context for the button's `absolute right-4 top-4` anchor.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:510-523` — the
  `<ReactFlowProvider>` wrapper. Already present (added by
  `mod_layout_measured_dimensions` so the measurement hooks could mount); the
  `useReactFlow()` hook this task adds runs inside the same provider context.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:681-683` — existing
  `useReactFlow()`-adjacent hooks (`useStore(selectMeasurementRevision)`,
  `useNodesInitialized()`, `useStoreApi()`). The new `useReactFlow()` import
  joins them in the existing `reactflow` import block.
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx:64-135` — the existing
  `ImmediateResizeObserver` + `offsetWidth` / `offsetHeight` /
  `getBoundingClientRect` stubs. The new Vitest cases reuse these stubs as-is;
  the tidy-up flow is observable purely via position-change assertions, not via
  the measurement loop.
- `apps/moderator/src/layout/RightSidebar.tsx:115-131` — the precedent for
  Tailwind button styling on the moderator console: focus-visible outlines,
  hover backgrounds, slate-toned ring + shadow. The tidy-up button mirrors the
  same visual vocabulary so it reads as a moderator-console affordance rather
  than a foreign element.
- `apps/moderator/src/routes/CreateSession.tsx:275-282` — second precedent for
  Tailwind button styling on the moderator console (a primary `bg-blue-600`
  button). The tidy-up button is a **secondary** affordance, not a primary
  one, so it adopts the right-sidebar's slate vocabulary rather than the
  create-session's blue; per Decision below.
- `tests/e2e/moderator-graph-layout.spec.ts` — the existing 6-node + 1-node
  stability e2e spec (post-`mod_layout_measured_dimensions` — currently 2
  scenarios in the `chromium-moderator-layout` Playwright project). The new
  `test()` block joins this file rather than a new file (same setup overlap
  rationale `mod_layout_measured_dimensions` cited under its Decisions for the
  tall-node scenario).
- `tests/e2e/fixtures/wsStoreSeed.ts` — the `seedWsStore(...)` helper. Unchanged
  by this task; the new e2e seeds the same 6-node fixture the existing spec
  already builds.
- `playwright.config.ts:218-226` — the `chromium-moderator-layout` Playwright
  project entry. The new e2e runs under this existing project; no new project
  is registered.
- `packages/i18n-catalogs/src/catalogs/en-US.json`,
  `packages/i18n-catalogs/src/catalogs/pt-BR.json`,
  `packages/i18n-catalogs/src/catalogs/es-419.json` — the catalog files this
  task extends with the new `moderator.graph.tidyUp.*` namespace.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json`,
  `packages/i18n-catalogs/src/catalogs/es-419.review.json` — the PENDING-flag
  trackers; the 6 new draft entries (3 keys × 2 locales) get a `pending: true`
  entry per the established `i18n_methodology_glossary` /
  `i18n_methodology_role_descriptions` / `mod_create_session_form` pattern.

ADRs and refinements consulted for style + decision continuity:

- [ADR 0025 — Graph layout engine: dagre](../../../docs/adr/0025-graph-layout-engine-dagre.md) —
  Stability-strategy decision (option 3, the hybrid) and the named tidy-up
  follow-up; the no-animation precedent for `relayoutAll(...)` (the function
  produces an instant position snap, not an animated transition).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) —
  every empirical check is a committed Vitest / Playwright case.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) —
  the `useTranslation()` API the new button consumes.
- `tasks/refinements/moderator-ui/mod_layout_engine_choice.md` — predecessor;
  the position-cache contract and the explicit naming of this task as the
  follow-up that wires the button. The style precedent for the Inherited
  dependencies section's two-list shape (Settled / Pending) is lifted
  unchanged.
- `tasks/refinements/moderator-ui/mod_layout_measured_dimensions.md` — sibling;
  the `layoutRevision` state-counter idiom this task is a second writer to.
- `tasks/refinements/moderator-ui/mod_create_session_form.md` — sibling; the
  i18n catalog workflow (PENDING-flagged drafts in `*.review.json`, parity
  check, native-review follow-up task registration) is lifted unchanged.
- `tasks/refinements/frontend-i18n/i18n_methodology_role_descriptions.md` —
  the canonical example of the catalog workflow + native-review follow-up; the
  pattern this task mirrors exactly.

No new ADR is required (see Decisions); no new dependency lands (`reactflow` is
already imported and exports `useReactFlow`); no public type signature changes;
no cross-workspace contract changes.

## Constraints / requirements

### Button placement + structure

- **Single button**, rendered as a sibling of `<ReactFlow>` inside
  `<GraphCanvasPaneInner>`'s root `<div data-testid="graph-canvas-root">`. NOT
  a separate floating-pane component (no need — one button, one handler).
- **Top-right anchor** (`absolute right-4 top-4`). Rationale under Inputs /
  context.
- **`data-testid="graph-tidy-up-button"`** — the load-bearing selector for the
  Vitest and Playwright cases.
- **`type="button"`** explicitly (not `submit`; `<GraphCanvasPaneInner>` is not
  inside a `<form>`, but the explicit attribute defends against any future
  composition where it might be).
- **`aria-label`** sourced from `moderator.graph.tidyUp.ariaLabel` — the
  accessible name. The visible text content (`moderator.graph.tidyUp.label`)
  is also readable but the aria-label is more verbose for screen-reader users
  who can't see the icon-adjacent context.
- **`title`** sourced from `moderator.graph.tidyUp.tooltip` — the on-hover
  tooltip for keyboard / pointer users who want to know what the button does
  before clicking. The tooltip text explains WHY the user would click (canvas
  feels cluttered).
- **Visible label**: `t('moderator.graph.tidyUp.label')`. No icon in v1; an
  icon would require a new dependency or an SVG asset (DESIGN.md and the
  no-new-deps rule make this ADR-adjacent), and the text label is itself
  accessible. A future task may upgrade to icon + label once an icon library
  lands (out of scope here).

### Click handler

- **Synchronous body**: clear the position cache, bump `layoutRevision`. Both
  operations are O(1); the cache clear is `Map.prototype.clear()` and the
  state-bump is a single `setLayoutRevision` call. No async, no try/catch.
- **`fitView` after a `requestAnimationFrame`**: deferring `fitView` past the
  React commit cycle ensures ReactFlow's internal node-position store reads
  the post-relayout positions when computing the bounding box. Calling
  `fitView` synchronously inside the click handler would read stale positions
  (the commit hasn't landed) and produce a no-op or wrong-frame zoom. The
  `requestAnimationFrame` is the cheapest correct path; `setTimeout(fn, 0)`
  also works but `rAF` aligns with the next paint, which is the right cadence
  for a viewport change.
- **`fitView({ duration: 0, padding: 0.1 })`**: instant snap, 10% padding
  around the bounding box. No animation (per ADR 0025 / `mod_layout_measured_dimensions`
  precedent). Padding gives the moderator a small breathing margin around the
  outermost nodes so handles aren't clipped by the canvas edge.
- **No confirmation modal**: tidy-up is a reversible operation (clicking it
  again with the same node + edge set produces the same arrangement; the user
  doesn't lose any work). A confirmation step would be friction for an
  operation that can simply be re-invoked.
- **No-op on empty canvas**: when `nodes.length === 0`, the click handler
  still clears the (already-empty) cache + bumps the revision. The `useMemo`
  re-runs, `applyLayout([], [], …)` returns `[]`, and `fitView` re-frames an
  empty viewport (ReactFlow's `fitView` on an empty graph centers on the
  origin; benign). The handler does NOT need an early-return guard; the
  no-op behavior is correct by composition.
- **Selection is not cleared**: `useSelectionStore` is independent of layout;
  a selected node remains selected after tidy-up (its position changes; the
  selection ring follows).
- **Context menu is not affected**: if a context menu happens to be open when
  the button is clicked (unusual — the button is outside the menu and clicking
  outside dismisses the menu, but defending against the edge case), the menu
  state lives in `<GraphCanvasPaneInner>`'s `useState<ContextMenuState | null>`
  and is unaffected by the tidy-up handler. The menu's own outside-click
  dismissal will fire.

### Position cache semantics

- **Cache clear is total**: every id is removed (`Map.clear()`). Per-id
  selective clearing would be an option (e.g. "tidy up only the disconnected
  components") but is materially more complex and not what the moderator
  asked for — "tidy up" means "rearrange the whole canvas." This is the
  semantic ADR 0025 named.
- **Measurement cache is preserved**: `measurementCacheRef.current` is NOT
  cleared. The measurements ReactFlow's `ResizeObserver` populated are still
  valid (the cards haven't changed their footprint), so the next
  `applyLayout(…, { dimensions: measurementCacheRef.current })` call honors
  the per-id rects exactly as the pre-tidy pass did. This is the correctness
  property: tidy-up rearranges positions, not dimensions.
- **`layoutRevision` bumped via functional update**: `setLayoutRevision((r) =>
  r + 1)` — never `setLayoutRevision(layoutRevision + 1)`. Functional update
  composes with the measurement effect's identical bump pattern (also at
  `GraphCanvasPane.tsx:744` per `mod_layout_measured_dimensions`) without a
  race in the rare interleaving where a measurement landed in the same render
  cycle as a button click. Per React's documented batching contract.

### Re-layout cadence

- **One `applyLayout` pass per click**. The cache-clear + revision-bump pair
  invalidates the `useMemo` exactly once; React batches the state update and
  the `useMemo` re-runs in the next render. Multiple rapid clicks (e.g.
  smashing the button) produce N revision bumps and N `useMemo` re-runs but
  the canvas converges to the same arrangement because the inputs (events,
  edges, measurements) didn't change between clicks. The wasted work is one
  dagre pass per click; at ≤ 100 nodes (< 10 ms per pass) this is
  unobservable.
- **No measurement effect interaction**: clearing the position cache does
  NOT trigger a re-measurement; the cards haven't moved in DOM yet — only
  ReactFlow's internal "where to render" coordinates have changed. The
  `ResizeObserver` fires on **size** changes, not position changes. So the
  measurement effect at `GraphCanvasPane.tsx:685-764` stays silent through
  the tidy-up flow.

### i18n catalog keys

- **3 new keys under `moderator.graph.tidyUp.*`** across all three v1 locales.
- **pt-BR + es-419 drafts flagged PENDING** in `*.review.json` — same pattern
  as `i18n_methodology_role_descriptions` and `mod_create_session_form`. The
  parity-check script (`pnpm --filter @a-conversa/i18n-catalogs run check`)
  ensures every en-US key has pt-BR and es-419 counterparts; the review-flag
  lifecycle is orthogonal to parity.
- **No new catalog NAMESPACE**: `moderator.graph` is a new sub-area but it
  fits under the existing `moderator.*` top-level namespace established by
  `mod_create_session_form` (`moderator.createSession`),
  `mod_mode_banner` (`moderator.modeBanner`), `mod_right_sidebar`
  (`moderator.rightSidebar`), and others. `moderator.graph` carries clear
  intent ("moderator console, graph canvas region") and leaves room for
  future graph-area keys (`moderator.graph.viewport.*`, `moderator.graph.zoom.*`)
  without collision.

### Files this task touches (explicit allowlist)

- `apps/moderator/src/graph/GraphCanvasPane.tsx` (modified — add the button,
  the `handleTidyUp` handler, the `useReactFlow` import, and the `relative`
  className on the root div).
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` (modified — add the 6
  new Vitest cases listed under Acceptance criteria).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — add
  `moderator.graph.tidyUp.*`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/es-419.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` (modified — PENDING
  entries for the 3 new keys).
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` (modified — same).
- `tests/e2e/moderator-graph-layout.spec.ts` (modified — add the new `test()`
  block for the tidy-up e2e).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_layout_tidy_action` lands at
  task-completion time per the README ritual, not at refinement-write time.
  The Closer also adds the new `i18n_layout_tidy_action_native_review` task
  to `tasks/35-frontend-i18n.tji` per the tech-debt registration policy.
- `docs/adr/` — no new ADR. ADR 0025 already pinned every architectural
  choice (the existence of `relayoutAll`, its semantics, the no-animation
  policy); this task is the UI binding for the existing function.
- `apps/moderator/src/graph/layoutEngine.ts` — the function is consumed
  transitively (via emptying the cache); no edit to the function itself.
- `apps/moderator/src/layout/OperateLayout.tsx` / `Operate.tsx` /
  `RightSidebar.tsx` / `BottomStripCapture.tsx` / `ModeBanner.tsx` — the
  button lives inside `<GraphCanvasPane>`, not in the shell.
- `apps/server/src/` — no server-side change.
- `playwright.config.ts` — the new e2e scenario joins the existing
  `chromium-moderator-layout` Playwright project (per the
  `mod_layout_measured_dimensions` precedent for tall-node-scenario
  placement).

### a11y requirements (the testable list)

- The button has a programmatic accessible name (`aria-label`) AND a visible
  text content (the `label` key). Both resolve through `useTranslation()`.
- The button is keyboard-focusable (`<button>` is natively focusable; the
  `focus-visible:outline-*` Tailwind utilities provide a visible focus ring).
- The button is keyboard-activatable: Enter or Space triggers `onClick` per
  native HTML semantics; no custom keypress handler is needed.
- The button has a `title` attribute (hover tooltip) sourced from a localized
  catalog key. Native `title` is read by screen readers as a fallback when no
  `aria-label` is present; both are present here for belt-and-braces.
- The button does NOT trap keyboard focus: after activation, focus remains on
  the button. The moderator may Tab to subsequent UI as expected.
- The button respects the moderator console's color contrast vocabulary
  (slate-on-white with a slate-300 ring); this is the same vocabulary
  `<RightSidebar>` headers use, which passed contrast review at
  `mod_right_sidebar`'s acceptance.

### Build / type / test gates

- `pnpm run check` clean.
- `pnpm run test:smoke` green; the moderator-workspace test count rises by 6
  (the 6 new `GraphCanvasPane.test.tsx` cases).
- `pnpm --filter @a-conversa/i18n-catalogs run check` (the parity-check)
  green after the catalog edits — every `moderator.graph.tidyUp.*` key
  present in en-US is present in pt-BR and es-419.
- `pnpm -F @a-conversa/moderator build` succeeds (no bundle change of note;
  one new component-internal handler and an import that's already in the
  reactflow package).
- `pnpm exec playwright test --project chromium-moderator-layout` green
  against a freshly brought-up dev compose stack; the existing 3 scenarios
  (6-node baseline, tall-node measured, 1-node stability) plus the new
  tidy-up scenario all pass.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the Closer
  adds `complete 100` on `mod_layout_tidy_action` AND the new
  `i18n_layout_tidy_action_native_review` task block.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_layout_tidy_action`
  plus a `note "Refinement: tasks/refinements/moderator-ui/mod_layout_tidy_action.md"`
  line (per `tasks/refinements/README.md`'s task-completion ritual).

### UI-stream e2e scoping (per ORCHESTRATOR.md commit `28a71f9`)

The button is reachable from a real user flow as of `mod_create_session_form`
(commit `05f7d67`): the moderator can log in, navigate to `/sessions/new/setup`,
create a session, land on `/sessions/<id>/operate`, and see the graph canvas
with the tidy-up button rendered in the top-right corner. Per the UI-stream
e2e policy default, the Playwright spec is **scoped under Acceptance criteria,
NOT deferred**. The new test block joins the existing
`tests/e2e/moderator-graph-layout.spec.ts` rather than a new file — the setup
overlap is total (loginAs → POST /api/sessions → goto operate → seedWsStore →
canvas assertions) and the assertion is a sibling of the existing
non-overlap / stability assertions.

## Acceptance criteria

### 1. The button renders inside the graph pane

- `<GraphCanvasPaneInner>` returns a JSX tree where the root
  `<div data-testid="graph-canvas-root">` carries `className="relative h-full w-full"`
  (the `relative` is new; the rest is unchanged) AND contains a `<button
  data-testid="graph-tidy-up-button">` sibling of `<ReactFlow>`.
- The button has `type="button"`, `aria-label={t('moderator.graph.tidyUp.ariaLabel')}`,
  `title={t('moderator.graph.tidyUp.tooltip')}`, and renders the localized
  text content `t('moderator.graph.tidyUp.label')`.
- The button is positioned at `absolute right-4 top-4 z-10`.

### 2. `handleTidyUp` semantics

On click:

- `positionCacheRef.current` is cleared (size goes from N to 0).
- `layoutRevision` increments by exactly 1.
- `measurementCacheRef.current` is NOT cleared (its entries pass through).
- A `requestAnimationFrame` callback is scheduled that calls
  `useReactFlow().fitView({ duration: 0, padding: 0.1 })`.
- The handler is wrapped in `useCallback` so its referential identity stays
  stable across renders (button doesn't re-mount on every parent re-render).

### 3. Vitest cases (in `apps/moderator/src/graph/GraphCanvasPane.test.tsx`)

Minimum 6 new cases, all per ADR 0022 (committed regression-class proofs, not
throwaway smoke):

1. **Button renders with localized accessible name** — render the canvas with
   any non-empty event fixture; assert `getByTestId('graph-tidy-up-button')`
   resolves; assert its `aria-label` resolves to a non-key string (not literal
   `'moderator.graph.tidyUp.ariaLabel'`); assert its `title` attribute likewise;
   assert the visible text content resolves to the `label` key.
2. **Click clears the position cache** — render the canvas with a 2-node
   fixture, wait for the `useMemo` to populate `positionCacheRef.current`
   (spy / mock the ref's `.set` calls OR assert via an exported test helper
   the Closer adds at implementation time); click the button; assert the
   cache is empty after the click handler runs. The cleanest implementation
   path: expose a debug-only `__layoutDebug` ref on `window` from the test
   environment OR use Vitest's `vi.spyOn` on `Map.prototype.clear` to detect
   the call (the latter is the lower-coupling option).
3. **Click bumps `layoutRevision`** — render the canvas with the 2-node
   fixture; spy on the `applyLayout` call count via a `vi.spyOn` on the
   `layoutEngine` module's exported function; click the button; assert
   `applyLayout` was called one more time after the click (the revision bump
   forced the `useMemo` to re-run).
4. **Click re-runs `applyLayout` against an empty cache** — extend case 3:
   capture the arguments to the post-click `applyLayout` call; assert
   `options.cache.size === 0` at the moment of the call (the cache was
   cleared synchronously before the revision bump triggered the re-run).
5. **Click is a no-op on empty canvas** — render with an empty events array;
   click the button; assert no error thrown; assert `applyLayout` was called
   one more time but with `[]` and the call returns `[]`; assert `fitView`
   was called via the `useReactFlow` mock.
6. **`fitView` is called after `requestAnimationFrame`** — mock `useReactFlow`
   to return a `fitView` spy; render + click; assert `fitView` was NOT called
   synchronously during the click handler; advance fake timers / rAF to the
   next frame; assert `fitView` was then called exactly once with
   `{ duration: 0, padding: 0.1 }`.

### 4. Playwright `test()` block (in `tests/e2e/moderator-graph-layout.spec.ts`)

One new `test()` block inside the existing `test.describe('Moderator graph
layout', …)` block:

```ts
test('Tidy-up button: clicking it after manual position drift re-runs dagre and re-frames the viewport', async ({ page }) => {
  // 1. Login as alice + POST /api/sessions + goto operate (mirrors the
  //    existing 6-node test exactly).
  await loginAs(page, { username: 'alice' });
  // ... POST /api/sessions + page.goto(...) per the existing helper ...

  // 2. Seed the 6-node claim+evidence+rebut fixture.
  await seedWsStore(page, { sessionId, nodes: <6 nodes>, edges: <5 edges> });

  // 3. Wait for all 6 statement-node test ids to be visible AND the
  //    measurement loop to settle (200 ms past the 75 ms debounce).
  for (const id of nodeIds) {
    await expect(page.getByTestId(`statement-node-${id}`)).toBeVisible();
  }
  await page.waitForTimeout(200);

  // 4. Snapshot every card's getBoundingClientRect.
  const before = await page.evaluate((ids) => {
    return ids.map((id) => {
      const el = document.querySelector(`[data-testid="statement-node-${id}"]`);
      const r = el!.getBoundingClientRect();
      return { id, x: r.x, y: r.y, w: r.width, h: r.height };
    });
  }, nodeIds);

  // 5. Manually drift a node off its dagre position via ReactFlow's
  //    `setNodes` (exposed through the same dev-window WS-store seam the
  //    fixture uses — OR by simulating a drag via Playwright's
  //    `page.mouse.down/move/up` on one card). The drift makes the
  //    "before" arrangement non-dagre, so the tidy-up click produces a
  //    detectable position change for the dragged card.
  // [implementation lands during the Implementer pass]

  // 6. Assert the tidy-up button is visible + reachable.
  const tidyUp = page.getByTestId('graph-tidy-up-button');
  await expect(tidyUp).toBeVisible();
  await expect(tidyUp).toHaveAttribute('aria-label', /re-layout|fresh arrangement/i);

  // 7. Click.
  await tidyUp.click();

  // 8. Wait one frame past the click for `fitView` + the re-layout commit.
  await page.waitForTimeout(100);

  // 9. Read the dragged card's new rect; assert it moved BACK toward its
  //    dagre-computed position (within ≤ 4 px of the pre-drift `before`
  //    snapshot for that card).
  const after = await page.evaluate(...);
  // [assertion: dragged card's center is within 4 px of its pre-drift center]

  // 10. Assert non-overlap holds across the post-tidy-up arrangement
  //    (reuses the existing `overlap()` helper from the file).
  // 11. Assert TB direction holds for every edge (reuses the existing
  //    assertion shape).
});
```

The exact mechanism for step 5 (drag vs. setNodes) is an implementation choice
for the Implementer; the load-bearing assertion is "the tidy-up click brings
the drifted card back to the dagre-computed arrangement." Per ADR 0022 the
spec is committed (not a throwaway).

### 5. i18n catalog parity

- `packages/i18n-catalogs/src/catalogs/en-US.json` gains the
  `moderator.graph.tidyUp.{label, ariaLabel, tooltip}` keys with the text from
  the table under "What this task is, section C."
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` gains the same 3 keys with
  the pt-BR draft strings.
- `packages/i18n-catalogs/src/catalogs/es-419.json` gains the same 3 keys with
  the es-419 draft strings.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and
  `packages/i18n-catalogs/src/catalogs/es-419.review.json` gain
  `pending: true` entries for each of the 3 keys (per the established
  `*.review.json` lifecycle from `i18n_methodology_role_descriptions` and
  `mod_create_session_form`).
- `pnpm --filter @a-conversa/i18n-catalogs run check` green after the edits.

### 6. WBS updates

- `tasks/30-moderator-ui.tji`: `mod_layout_tidy_action` block gets
  `complete 100` after the `allocate team` line plus a `note "Refinement:
  tasks/refinements/moderator-ui/mod_layout_tidy_action.md"` line.
- `tasks/35-frontend-i18n.tji`: a new task block `i18n_layout_tidy_action_native_review`
  is added (effort 0.5d; `depends !i18n_create_session_form_native_review`;
  source-of-debt + tech-debt-registration-policy notes per the template under
  "What this task is, section E").
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

### 7. Build / type / test gates

All gates listed under Constraints / Build pass.

## Decisions

### 1. Cache-clear + revision-bump path, NOT a separate `relayoutAll(...)` call site

Three alternatives surveyed for "how does the click handler trigger a fresh
dagre pass over every node?":

- **Clear `positionCacheRef.current` + bump `layoutRevision`** (chosen). The
  existing `applyLayout(...)` call site inside the `nodes` `useMemo` (lines
  646-665) handles the "empty cache + non-empty inputs" case by routing every
  node through dagre — the function's own contract documentation
  (`layoutEngine.ts:264`) explicitly states the equivalence: "`applyLayout`
  over an empty cache produces the same result as `relayoutAll(...)` for the
  same inputs." Going through the existing memoization keeps every downstream
  property (the cache-write-back loop at lines 655-657, the
  `dimensions: measurementCacheRef.current` thread, the `layoutRevision` dep
  the measurement effect also writes to) working without parallel-path
  reasoning. **Lower complexity. Same observable behavior.**
- **Add a parallel `relayoutAll(...)` call inside the click handler and
  imperatively swap `nodes` into the store.** Rejected. (a) Forces a parallel
  layout invocation path the rest of the canvas doesn't go through, doubling
  the surface where a future change can desync the two paths. (b) Requires
  imperatively writing to the store / a local state, bypassing the `useMemo`,
  which means the cache-write-back loop after the parallel call has to be
  duplicated. (c) Loses composability with the measurement effect: a
  measurement that arrives one tick after the click would re-trigger the
  `useMemo` path, which would now read a stale cache (the parallel call
  didn't write to the cache) and would re-dagre the canvas a second time —
  exactly the "two re-layouts where one would do" pathology this task should
  avoid.
- **Reach into ReactFlow's store directly and `setNodes(relayoutAll(...))`.**
  Rejected for the same reasons as alternative 2, with the additional
  complication that ReactFlow's `setNodes` triggers its own `ResizeObserver`
  re-fire path (the new node positions can interact with measurement-loop
  re-entry); the cache-clear path stays inside the established
  `useMemo`-driven cadence and has no observed interaction with the
  measurement loop.

Documented as a Decision-class choice because the alternatives all produce
"functionally similar" results; the load-bearing reason is composability with
the measurement effect's pre-existing single-path re-layout cadence.

### 2. `useReactFlow().fitView({ duration: 0, padding: 0.1 })` after `requestAnimationFrame`

- **`fitView` IS called** (chosen) — without re-framing, the moderator may end
  up viewing an empty patch of canvas if the new arrangement falls outside the
  old viewport. The fit-view step is what makes "tidy up" feel like a complete
  action.
- **Alternative: don't call `fitView`; leave the viewport where it is.**
  Rejected. The whole point of tidy-up is "I want to see the canvas with a
  fresh arrangement"; preserving a stale viewport defeats the user intent.
- **`duration: 0` (no animation)** (chosen). Per ADR 0025's no-animation
  precedent for `relayoutAll(...)`-driven position changes; the predecessor
  `mod_layout_measured_dimensions` Decisions block carries the same "instant
  snap" rationale. Animating the viewport zoom while every node instantly
  snaps to its new position would compose poorly (the zoom would lag the
  node positions, producing perceived stutter).
- **`padding: 0.1` (10% padding around bounding box)** (chosen). ReactFlow's
  default is `0.1`; restating it explicitly defends against any future
  default change. The padding gives the outermost nodes a small breathing
  margin so their handle dots aren't clipped by the canvas edge.
- **`requestAnimationFrame` wrapper around the `fitView` call** (chosen). The
  click handler synchronously clears the cache + bumps `layoutRevision`;
  `setLayoutRevision` is queued and the `useMemo` doesn't re-run until React's
  next commit. Calling `fitView` synchronously inside the handler would read
  stale node positions (the new ones haven't landed yet). `requestAnimationFrame`
  defers `fitView` to the next paint, which is after the React commit has
  flushed the new positions to ReactFlow's internal store. The alternative
  (`setTimeout(fitView, 0)`) also works but is less precise about the cadence
  ("after the next macrotask" vs. "after the next paint"); rAF is the canonical
  choice for "after layout commits."

### 3. Top-right button placement, not bottom-left / center / inside the sidebar

Four alternatives surveyed:

- **Top-right of the graph pane, floating** (chosen). Out of the moderator's
  reading path (which flows upper-left → lower-right for claim → evidence)
  but in the screen-scanning periphery. The bottom of the canvas is reserved
  for `<BottomStripCapture>`. The top-left corner is taken by ReactFlow's
  attribution badge + (eventually) the zoom controls. The top-right is the
  unclaimed quadrant.
- **Inside `<RightSidebar>` as a new pane** — rejected. The sidebar is for
  per-pane stacked content (pending proposals, diagnostic flags, change
  history); a layout-control button is operationally different and would
  visually clutter the pane stack.
- **Inside `<BottomStripCapture>` alongside the mode banner** — rejected.
  The bottom strip is for capture workflow controls (text input, palette,
  edge-role selector, propose action); a layout-control button is not part
  of the capture flow.
- **Floating-action-button (FAB) bottom-right with an icon, Material-style**
  — rejected for v1. Requires either an icon library or a hand-rolled SVG;
  both are scope creep. A text-labeled button is the simpler-still-accessible
  v1 form. A future task may upgrade to icon + label once an icon library
  lands.

### 4. Secondary visual vocabulary (slate-on-white), NOT primary (blue)

The button is a **secondary** affordance — it doesn't progress the user's
primary task (running the debate) and is invoked occasionally on demand. The
moderator console's primary-action vocabulary is established at
`apps/moderator/src/routes/CreateSession.tsx:275-282` (a `bg-blue-600` button);
the secondary-action vocabulary is established at
`apps/moderator/src/layout/RightSidebar.tsx:115-131` (slate-on-white with a
slate-300 ring). The tidy-up button adopts the secondary vocabulary so the
moderator's visual hierarchy reads "primary CTA" (create session, submit) vs.
"secondary tool" (tidy up, expand sidebar pane). A blue tidy-up button would
read as a primary CTA and compete with the actual capture-flow CTAs.

### 5. Three i18n keys (label + ariaLabel + tooltip), not just one

Three keys is one more than the minimum but each carries a distinct purpose:

- `label` is the visible text content (short — "Tidy up" / "Organizar" /
  "Reorganizar"). What the user reads.
- `ariaLabel` is the screen-reader-only accessible name (more verbose — "Re-layout
  the graph to a fresh arrangement"). What the screen reader announces.
  Separating it from `label` lets the visual stay concise without sacrificing
  screen-reader clarity.
- `tooltip` is the hover-text via the `title` attribute (the most verbose —
  explains WHY the user would click). What the pointer user sees on hover.

The alternative (one key for all three uses) ties the visual brevity to the
screen-reader / tooltip verbosity and forces one of them to be wrong. The
three-key pattern matches the `moderator.modeBanner.<mode>.{label,
description}` precedent from `mod_mode_banner` and the
`moderator.rightSidebar.toggleAria` pattern from `mod_right_sidebar`. Three
keys × 3 locales = 9 catalog entries is a small enough surface that the
parity-check workflow handles it trivially.

### 6. Native-review follow-up registered, not bundled into this task

The pt-BR + es-419 drafts land flagged PENDING in `*.review.json`; the
native-speaker review is a separate task
(`i18n_layout_tidy_action_native_review`, effort 0.5d) registered in
`tasks/35-frontend-i18n.tji` per the established pattern from
`i18n_methodology_role_descriptions_native_review` and
`i18n_create_session_form_native_review`. Two reasons:

- **Native review is a different skill from the wiring**. The wiring task is
  TypeScript / React / catalog / test work; the review task is native-speaker
  localization work. Different reviewers; different scheduling.
- **The button is functional without the review**. A pt-BR speaker viewing
  the moderator console with the draft "Organizar" string still sees a
  functional, comprehensible button. The native-review pass replaces "good
  enough" with "reviewed and signed off"; it is not a precondition for the
  button surfacing.

### 7. No new ADR

Three potential ADR triggers, all dispatched:

- **"Adding a new graph-rendering dependency is ADR-worthy"** (per
  ORCHESTRATOR.md Refinement-Writer brief). This task adds NO new dependency
  — `reactflow` is already imported and exports `useReactFlow`.
- **"A new layout strategy is ADR-worthy"**. This task changes NO layout
  strategy — `relayoutAll(...)` semantics are pre-decided by ADR 0025; the
  cache-clear path through `applyLayout(...)` produces identical output per
  the function's contract.
- **"A new UI affordance is ADR-worthy if it changes the moderator console's
  layout vocabulary."** This task uses the **existing** secondary-action
  vocabulary established by `<RightSidebar>` headers; no new vocabulary
  lands.

ADR 0025 already pinned every architectural choice this task implements; this
refinement is the task-scope pin for the UI binding.

### 8. E2e spec placement: extend `moderator-graph-layout.spec.ts`, don't create a new spec

Following the precedent from `mod_layout_measured_dimensions` (which extended
the same file rather than splitting): the setup overlap with the existing 6-node
non-overlap test is total (loginAs → POST /api/sessions → goto operate →
seedWsStore → wait for measurements). The new tidy-up test is a sibling of the
existing non-overlap assertion. Splitting would duplicate boilerplate for
marginal isolation benefit.

### 9. No confirmation modal before tidy-up

Tidy-up is reversible (in the trivial sense — clicking again with the same
inputs produces the same arrangement; nothing is "lost"). The moderator can
re-invoke tidy-up freely. A confirmation step would be friction without a
matching risk. The screen-name form, the create-session form, and every other
moderator-console action that doesn't destroy data have followed the
no-confirmation-for-reversible-actions pattern; tidy-up matches.

### 10. Tidy-up does NOT touch the WS store or commit any event

Tidy-up is a **local UI rearrangement** — it changes how the canvas displays
positions but does not change the underlying methodology graph (nodes / edges /
events). No `node-position` event exists in the event envelope (per ADR 0021
and the data-model docs); positions are a moderator-local presentation concern.
Two moderators viewing the same session via separate browsers would each see
their own position cache and could tidy-up independently without cross-effect.
A future "share my arrangement" feature is out of scope and would require its
own ADR.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-15.

- Wired `relayoutAll()` to a moderator-visible top-right "Tidy up" button inside `<GraphCanvasPaneInner>`: the click handler clears `positionCacheRef.current`, bumps `layoutRevision`, and rAF-defers `useReactFlow().fitView({ duration: 0, padding: 0.1 })`. Implementation lives at `apps/moderator/src/graph/GraphCanvasPane.tsx` (added `useReactFlow` + `useTranslation` imports, `handleTidyUp` callback, the `<button>` sibling of `<ReactFlow>`, and `relative` on the root `<div>`).
- Added 6 new Vitest cases under `mod_layout_tidy_action` in `apps/moderator/src/graph/GraphCanvasPane.test.tsx`; introduced module-scope `vi.mock('./layoutEngine', …)` and `vi.mock('reactflow', …)` so `applyLayoutSpy` + `fitViewSpy` delegate to the real implementations while remaining observable. Vitest test-count delta: 2607 → 2613 (+6).
- 3 new i18n keys under `moderator.graph.tidyUp.{label,ariaLabel,tooltip}` landed across all three v1 locales — `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — with the pt-BR + es-419 drafts flagged PENDING in `packages/i18n-catalogs/src/catalogs/{pt-BR,es-419}.review.json` (6 new pending entries total).
- 1 new Playwright `test()` block joined the existing `describe.serial` at `tests/e2e/moderator-graph-layout.spec.ts` — asserts the button renders with the localized accessible name, click triggers a re-layout, non-overlap + TB direction hold post-click. The `chromium-moderator-layout` Playwright project runs 3/3 green against a fresh compose stack.
- New tech-debt follow-up `i18n_layout_tidy_action_native_review` registered in `tasks/35-frontend-i18n.tji` (effort 0.5d; `depends !i18n_create_session_form_native_review`) for the native-speaker review of the pt-BR + es-419 drafts.
- Closes the registered tech debt named by `mod_layout_engine_choice` (commit `b7c5ff0`-era WBS update): `relayoutAll()` is now reachable from a real user gesture, not just an exported function.
