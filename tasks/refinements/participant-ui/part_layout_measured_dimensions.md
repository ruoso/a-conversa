# Participant graph layout — per-node measured dimensions (text-driven, not constant 200×80)

**TaskJuggler entry**: `participant_ui.part_graph_view.part_layout_measured_dimensions` — [tasks/40-participant-ui.tji](../../40-participant-ui.tji) (search the leaf `task part_layout_measured_dimensions` inside `task part_graph_view`).

**Effort estimate**: 0.5d. The implementation is: one new pure module `apps/participant/src/graph/nodeDimensions.ts` (a deterministic `computeNodeDimensions(wording)` function backed by an offscreen `<canvas>` `measureText` with a length-based fallback when the context returns 0), one extension to `apps/participant/src/graph/projectGraph.ts` to stamp `width` + `height` onto every emitted node descriptor, one stylesheet rewrite in `apps/participant/src/graph/GraphView.tsx` (the baseline `node` selector swaps `width: 200, height: 80` for `width: 'data(width)', height: 'data(height)'` plus a `text-max-width: 'data(textMaxWidth)'` mapping), one widening of the `cytoscapeTestEnv.ts` `measureText` stub so happy-dom returns content-sensitive widths, Vitest cases on the new pure module + `projectGraph.test.ts` + `GraphView.test.tsx`, and a Playwright extension to `tests/e2e/participant-graph-render.spec.ts` asserting a short-wording node renders at a smaller box than a long-wording node. No new dependency, no new ADR, no new i18n catalog key.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their public contracts):

- `participant_ui.part_graph_view.part_graph_render` (done — [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx)'s `STYLESHEET` is the baseline this task rewrites; `apps/participant/src/graph/projectGraph.ts` is the projection this task extends; the `cose` layout pass invoked from the elements `useEffect` already reads `ele.outerWidth()` / `ele.outerHeight()` from whatever the stylesheet resolves per element, so feeding it per-node dimensions just requires that the stylesheet's `width` / `height` resolve to per-element values).
- `participant_ui.part_graph_view.part_per_facet_state_styling` (done — Decision §7 explicitly deferred the `width: 'label'` deprecation question to a future task with the note "A future `part_pw_touch_simulation` or visual-regression task can revisit if real-world wording lengths break the 3-line budget; the methodology's 'two short sentences' cap makes this unlikely in practice." Real-world wordings DO break the 3-line budget — the moderator's sibling task [`mod_layout_measured_dimensions`](../moderator-ui/mod_layout_measured_dimensions.md) closes the symmetric trade-off for the moderator surface; this leaf closes it for the participant surface. The per-status selectors layered on top of the baseline stay UNTOUCHED — they override `border-*` / `background-*` / `outline-*` / `opacity` only; none of them touch `width` / `height`, so the new per-node sizing inherits cleanly through every per-status branch).
- `participant_ui.part_graph_view.part_axiom_mark_decoration` / `part_annotation_render` / `part_diagnostic_highlights` / `part_own_vote_indicators` / `part_other_vote_indicators` (all done — each layered a non-dimension override onto the baseline stylesheet. Crucially, unlike the moderator's analog, the participant's Cytoscape node does NOT host a per-facet pill row / axiom-mark row / annotation row INSIDE its body — these decorations render as canvas-level `border-style` / `overlay-color` / `outline-color` / `text-outline-color` overrides on the SAME box. The body's only content is the wording text, drawn by Cytoscape's text-rendering layer. Therefore the input to per-node sizing is the wording string alone — there is no analog to the moderator's "card grows because of the decoration row count" effect, and no analog to the ReactFlow `ResizeObserver` measurement loop is needed).
- `foundation.stack_decisions.graph_lib_decision` (done — [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) pinned Cytoscape on the read-mostly surfaces. Cytoscape 3.30 deprecated `width: 'label'` / `height: 'label'`, but `width: 'data(<key>)'` is the canonical replacement — verified in cytoscape style docs and in our existing `selector: 'node'` baseline's use of `label: 'data(wording)'`. The mapper is a documented first-class feature, not a workaround).

Pending edges (this task does NOT depend on them; one of them MAY compose more naturally once this lands):

- `participant_ui.part_voting.*` — orthogonal (per-facet voting controls live in the entity detail panel, not in the Cytoscape node body).
- `participant_ui.part_entity_detail_panel_*` (the per-facet other-voter / chromatic axiom-mark badge polishes) — orthogonal; the panel is a sibling React surface, not a Cytoscape node decoration.
- `participant_ui.part_visual_regression.part_vr_state_styling` — composes naturally once this lands (the baseline visual-regression snapshot needs to be captured AFTER the per-node sizing settles, not on the constant-200×80 baseline).

## What this task is

Concrete, mechanical work, in four visibly-distinct surfaces:

### A. Pure dimensions module — `apps/participant/src/graph/nodeDimensions.ts`

A new module exporting:

```ts
export interface NodeDimensions {
  readonly width: number;
  readonly height: number;
  readonly textMaxWidth: number;
}

export interface ComputeNodeDimensionsOptions {
  readonly font?: string;          // CSS font shorthand; default matches Cytoscape baseline
  readonly minWidth?: number;      // default 80
  readonly maxWidth?: number;      // default 240
  readonly padding?: number;       // default 12
  readonly lineHeight?: number;    // default 16
  readonly minHeight?: number;     // default 40
  readonly maxHeight?: number;     // default 240
}

export function computeNodeDimensions(
  wording: string,
  options?: ComputeNodeDimensionsOptions,
): NodeDimensions;
```

Algorithm (deterministic, pure, no DOM coupling beyond an offscreen canvas):

1. Resolve options against defaults. `font` defaults to `'12px sans-serif'` (matches the Cytoscape baseline `font-size: 12px`; the family is whatever the surrounding page provides — `sans-serif` is the safe approximation).
2. Tokenize `wording` by whitespace into words.
3. Lazily acquire a module-singleton `OffscreenCanvas` (or `HTMLCanvasElement` fallback) `getContext('2d')`. Set `ctx.font = options.font`.
4. Greedy-wrap words into lines, treating the budget as `maxWidth - 2 * padding` (= 216 by default). Use `ctx.measureText(line).width` to decide when a word would overflow; start a new line. Single words longer than the budget go on their own line (no mid-word break — Cytoscape's `text-wrap: 'wrap'` does the visible break, and the measurement just needs to be in the right ballpark for line counting).
5. **Test-environment fallback**: the happy-dom stub's `measureText` is widened (Surface D below) to return `text.length * 7` so the same algorithm runs in tests without a real font-rendering backend. The constant 7 is the empirical px-per-char baseline at 12 px sans-serif; deviation from real-browser measurement is small enough that the box-sizing branches the tests assert against (e.g., short wording fits within the min-width box, long wording hits the max-width clamp) hold under both arms.
6. `longestLineWidth = max over all wrapped lines of measured-width`. `width = clamp(longestLineWidth + 2 * padding, minWidth, maxWidth)`.
7. `height = clamp(lines.length * lineHeight + 2 * padding, minHeight, maxHeight)`.
8. `textMaxWidth = width - 2 * padding` (so Cytoscape's text-wrapping uses the same budget the measurement used).

The module exports the function plus the `NodeDimensions` and `ComputeNodeDimensionsOptions` types and the four `MIN_NODE_WIDTH` / `MAX_NODE_WIDTH` / `MIN_NODE_HEIGHT` / `MAX_NODE_HEIGHT` numeric constants (so tests assert against the source-of-truth values). No side effects at import time other than (lazily, on first call) probing the canvas context.

### B. Projection stamping — `apps/participant/src/graph/projectGraph.ts`

- **Extend `ParticipantNodeData`** to carry three numeric fields:
  ```ts
  /** Per-node Cytoscape box width (px). Per-wording, computed by
   *  `computeNodeDimensions`. The baseline stylesheet's
   *  `width: 'data(width)'` mapper reads this. */
  readonly width: number;
  /** Per-node Cytoscape box height (px). Symmetric with `width`. */
  readonly height: number;
  /** Per-node `text-max-width` budget (px). Always `width - 2 * padding`. */
  readonly textMaxWidth: number;
  ```
- **In `projectGraph`'s `node-created` branch**, call `computeNodeDimensions(event.payload.wording)` once and spread the three fields into the emitted node descriptor's `data` slot. The computation is per-node, deterministic in the wording string, and runs once per event-log walk (i.e. once per `events` reference change, since the projection itself is memoized by the route's `useMemo`).
- **Edges DO NOT get per-edge dimensions.** Cytoscape edges are line segments between nodes; they have no `width` / `height` in the box-sizing sense. The `ParticipantEdgeData` interface is UNCHANGED.
- **`commit` of a `classify-node` proposal** does not need to re-compute dimensions: the wording is set at `node-created` time and is currently immutable (no `edit-wording` event kind today). The dimensions stamp survives the spread that flips `kind`. Documented invariant.

### C. Stylesheet rewrite — `apps/participant/src/graph/GraphView.tsx`

- **Baseline `node` selector** changes:
  - `width: 200` → `width: 'data(width)'`
  - `height: 80` → `height: 'data(height)'`
  - `'text-max-width': '180px'` → `'text-max-width': 'data(textMaxWidth)'`
  - All other baseline properties (`shape`, `background-color`, `border-width`, `border-color`, `label`, `text-wrap`, `color`, `text-valign`, `text-halign`, `padding`, `font-size`) are UNCHANGED.
- **All other selectors** (the 6 per-status node branches, 6 per-status edge branches, axiom overlay, annotation overlay, diagnostic overlay, own-vote overlay, selected overlay) are UNCHANGED. None of them touch `width` / `height` / `text-max-width`; the per-node sizing inherits cleanly through every overlay.
- **The comment block on the baseline selector** that documents the `width: 200, height: 80` rationale gets rewritten to reference this refinement (closing the Decision §7 deferral from `part_per_facet_state_styling.md`).

### D. Test-env stub widening — `apps/participant/src/graph/cytoscapeTestEnv.ts`

- The current `measureText: (_text: string) => ({ width: 0 })` stub returns 0 for every input, which would defeat the whole point of unit-testing the dimension computation. Replace with a content-sensitive estimate: `measureText: (text: string) => ({ width: text.length * 7 })`. The constant 7 is the empirical px-per-char baseline (Surface A above); the test stub uses the same path the production canvas would, just with a deterministic measurer instead of a real font-rendering backend.
- The widening is additive — production never installs this stub. The existing `installCytoscapeTestEnv` / `restoreCytoscapeTestEnv` symmetry is preserved.

## Why it needs to be done

Two reasons, both load-bearing:

1. **Closes the `part_per_facet_state_styling` Decision §7 deferral.** That refinement explicitly named the constant-200×80 baseline as a known limitation with the note that "a future `part_pw_touch_simulation` or visual-regression task can revisit if real-world wording lengths break the 3-line budget." The trigger has fired: in practice, real wordings exceed the 3-line budget regularly (the "two short sentences" methodology cap is an aspirational ceiling, not an enforced one). At the same time, SHORT wordings (e.g. a one-word axiom) render in a 200×80 box that's grossly oversized for the content — the `cose` layout then over-allocates spacing between sparse boxes and the canvas reads as cluttered. Per-node sizing solves both ends: long wordings grow to fit; short wordings shrink to fit; the `cose` layout reads what each box actually needs.

2. **Brings the participant surface into parity with the moderator's `mod_layout_measured_dimensions`.** The moderator's analog closed the ADR 0025 `Consequences` trade-off (variable card heights overlapping the constant 90 px dagre slot) on the moderator side. The participant has the symmetric trade-off — variable wording lengths breaking the constant 200×80 Cytoscape box — but on a different rendering substrate. The two surfaces should agree visually on "a node's box is sized to the content it carries." Today they don't: the moderator's measured-dimensions path produces tight boxes; the participant's constant-200×80 produces uniform boxes. This task aligns the two.

Non-reason: this task does NOT introduce new rendering features (no new decoration row, no new selector vocabulary). It tightens the existing baseline to honor the data each node carries. The visual change is "boxes grow / shrink to match the wording," not "boxes look different."

## Inputs / context

Code seams the implementation plugs into:

- `apps/participant/src/graph/GraphView.tsx:251-275` — the module-scope `STYLESHEET` constant, baseline `node` selector. This task rewrites the three width/height/text-max-width properties; the surrounding 11 properties stay untouched.
- `apps/participant/src/graph/projectGraph.ts:128-225` — `ParticipantNodeData` interface. This task adds three numeric fields.
- `apps/participant/src/graph/projectGraph.ts:389-440` — the `node-created` branch of `projectGraph`. This task adds one `computeNodeDimensions` call and spreads its output into the emitted descriptor.
- `apps/participant/src/graph/cytoscapeTestEnv.ts:93-144` — the `getContext('2d')` stub. This task widens the `measureText` arm.
- `apps/participant/src/graph/GraphView.test.tsx` — the existing 80+ Vitest cases. This task ADDS a small block asserting per-node sizing is stamped + drives the Cytoscape data record; the existing cases stay green because none of them assert against `data.width` / `data.height` / `data.textMaxWidth` (those fields didn't exist before).
- `apps/participant/src/graph/projectGraph.test.ts` — the existing projector cases. This task ADDS a block asserting `computeNodeDimensions` runs per-node and stamps the three fields.
- `tests/e2e/participant-graph-render.spec.ts` — the existing describe (currently `test.describe.serial`). This task ADDS one block — short-wording vs long-wording sizing — to the same describe.

Cytoscape API reference:

- `width: 'data(<key>)'` — per-element width sourced from the element's `data.<key>` field. Documented at the Cytoscape style mappers page. Verified working in the existing baseline's `label: 'data(wording)'` mapping. (The deprecation that hit `part_graph_render` was `width: 'label'`, not `width: 'data(...)'`.)
- `height: 'data(<key>)'` — symmetric.
- `'text-max-width': 'data(<key>)'` — same mapper applies to string-valued properties too; Cytoscape coerces the numeric data value to a `<n>px` string for the text-wrap engine.
- `cose` layout reads each element's `outerWidth()` and `outerHeight()` (which honor the stylesheet's resolved per-element width/height); no special configuration needed for `cose` to respect per-node sizing.

Browser API reference:

- `OffscreenCanvas.getContext('2d')` — available in all modern browsers (Chrome 69+, Firefox 105+, Safari 16.4+). Falls back to `document.createElement('canvas').getContext('2d')` if `OffscreenCanvas` is undefined (older Safari, Node `<canvas>` polyfills). Both produce the same `CanvasRenderingContext2D` API; `measureText(text)` returns a `TextMetrics` object whose `.width` is the painted-pixel width at the configured font.
- `ctx.font = '<size> <family>'` — sets the font for subsequent measure / draw calls.

ADRs:

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Cytoscape on the read-mostly surfaces; this task uses Cytoscape's documented `data(...)` style mapper, no library substitution.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest or Playwright case.
- [ADR 0008 — E2E framework Playwright](../../../docs/adr/0008-e2e-framework-playwright.md) — the e2e layer the short-vs-long sizing assertion runs under.
- No new ADR. This task does not change the layout library (Cytoscape stays), does not introduce a new dependency, and reuses Cytoscape's documented `data(...)` mapper. The architectural choice the prior ADRs pinned is unchanged.

Refinements consulted for design continuity:

- [`tasks/refinements/participant-ui/part_graph_render.md`](part_graph_render.md) — predecessor; introduced the `STYLESHEET` constant and the projector-emits-Cytoscape-descriptors shape this leaf extends.
- [`tasks/refinements/participant-ui/part_per_facet_state_styling.md`](part_per_facet_state_styling.md) — Decision §7 explicitly deferred this question; closing the deferral is the immediate trigger.
- [`tasks/refinements/moderator-ui/mod_layout_measured_dimensions.md`](../moderator-ui/mod_layout_measured_dimensions.md) — sibling task on the moderator surface; structurally different (ReactFlow's `useNodesInitialized` + `ResizeObserver` measurement loop, vs. this leaf's pure-function-on-wording approach) but logically aligned (per-node sizing replaces a constant default).

## Constraints / requirements

### Measurement source

- **Use canvas `measureText` at the configured font for production**, with the test stub returning the deterministic `text.length * 7` so the unit tests have a stable measure. A single production code path; the differing measurement backends (real font under chromium, deterministic stub under happy-dom) are seam-level details. This keeps the algorithm honest in both arms.
- **Single shared offscreen canvas context per module load**, lazily acquired. The cost of `getContext('2d')` is non-trivial; sharing one context across every node measurement keeps the projection cheap.
- **DO NOT use a per-node DOM element for measurement.** A hidden `<div>` styled to match the Cytoscape node and read via `getBoundingClientRect()` would tie the projection to the page's layout pass — heavier, slower, and DOM-coupled. The canvas `measureText` path is DOM-free, runs at any time (including before mount), and is what the moderator's analog would have done if ReactFlow's library hooks didn't already exist.

### Sizing bounds

- **`minWidth = 80, maxWidth = 240, minHeight = 40, maxHeight = 240`** are the empirical bounds. Rationale:
  - `minWidth: 80` — narrow enough that single-word wordings ("Yes", "No", "True") look proportional; wide enough to fit any 4-letter word at 12 px sans-serif (`text-max-width: 56` after padding) without horizontal clipping.
  - `maxWidth: 240` — matches the moderator's `<StatementNode>` `max-w-[18rem]` (288 px Tailwind unit minus 48 px for ReactFlow handle padding). Wider boxes start to crowd the canvas; narrower boxes wrap aggressively. 240 is the empirical sweet spot.
  - `minHeight: 40` — fits one line of 12 px text with padding (`12 + 16 + 12 = 40`).
  - `maxHeight: 240` — caps runaway-wording cases. A 240 px tall box at `text-max-width: 216` shows 14 lines of 12 px text — far beyond any methodologically-defensible wording. The cap is a safety net, not a target.
- **All four constants are exported** from `nodeDimensions.ts` as named constants (`MIN_NODE_WIDTH`, `MAX_NODE_WIDTH`, `MIN_NODE_HEIGHT`, `MAX_NODE_HEIGHT`) so tests can assert against them without duplicating the values.

### Determinism / purity

- **`computeNodeDimensions` is pure given its inputs.** Same wording string + same options → same output. The offscreen canvas context is a hidden side-effect of the underlying browser API; the function does not write anything observable other than its return value. The test path's deterministic stub makes the unit tests reproducible without a real font-rendering engine.
- **The projection memoization stays stable.** `projectGraph` is wrapped by the route's `useMemo([events, ...])`; the new computation runs once per `events` reference change. The three new numeric fields are stable across re-renders unless the wording string changes — which it currently never does post-creation.

### Composition with existing decoration layers

- **Per-status branches** override `border-*`, `background-*`, `outline-*`, `opacity` — none of them touch `width` / `height` / `text-max-width`. Verified by reading the stylesheet at `apps/participant/src/graph/GraphView.tsx:295-411`. The new per-node sizing inherits cleanly.
- **Axiom-mark overlay** overrides `border-style` + `border-width`. No dimension touch.
- **Annotation overlay** (node side) sets `overlay-color` + `overlay-opacity` + `overlay-padding` — these paint over the existing box, do not change its dimensions.
- **Annotation overlay** (edge side) sets `underlay-*` + `width` — but `width` here is the EDGE stroke width (line thickness), not a node box dimension. Edges don't carry per-edge box dimensions in this task. No conflict.
- **Diagnostic overlay** (node side) sets `border-color` + `border-width` + `border-opacity`. No dimension touch.
- **Diagnostic overlay** (edge side) sets stroke `width` + `underlay-*`. Same edge-stroke distinction as annotation. No conflict.
- **Own-vote overlay** sets `text-outline-color` + `text-outline-width` + `text-outline-opacity`. No box-dimension touch.
- **Selected overlay** sets `z-index` + `background-blacken` (nodes) / `line-color` + `target-arrow-color` + `width` (edges). The edge `width` is again the stroke width; no node box-dimension touch.

The composition contract is preserved end-to-end: this task changes ONLY the baseline `node` selector's width/height/text-max-width, all 14 layered selectors remain unchanged, every prior decoration layer composes cleanly with the per-node baseline.

### `cose` layout interaction

- **`cose` reads `ele.outerWidth()` and `ele.outerHeight()`** when computing repulsion / spacing. With per-node dimensions, `cose` will naturally space nodes proportional to their actual footprints — short-wording nodes get closer together; long-wording nodes get more breathing room. This is the intended improvement.
- **Position cache across re-renders.** Surfaced during implementation: the predecessor's `useEffect([elements])` re-ran `cose` on every `elements` memo identity change — including selection flips, vote arrivals, annotation flips, and any other field that ends up in the per-element `data` record. That reshuffled the entire graph on every tap, which was disorienting. To keep the per-node sizing improvement coherent with the read-mostly contract, the elements `useEffect` now:
  1. Maintains a `positionCacheRef: Map<id, {x, y}>` and a `knownNodeIdsRef: Set<id>` (both `useRef`-backed, mirroring the moderator's `mod_layout_engine_choice` cache idiom).
  2. Stamps each element descriptor with `position: cachedPosition` when the id is already in the cache, so `cy.json({ elements })` restores each known node to its prior `{x, y}`.
  3. Runs `cose` ONLY when at least one element carries an id absent from `knownNodeIdsRef` (a truly-new `node-created`).
  4. Uses `randomize: false` on the layout so existing nodes start at their cached positions and the simulation settles only the new ones into the existing graph, rather than re-randomising every position.
  5. Mirrors the post-layout positions back into `positionCacheRef` and adds every emitted id to `knownNodeIdsRef`, so the NEXT sync tick treats them as cached.
- **Layout stability across event ticks**: each `node-created` event lands at the projection layer with the wording-driven dimensions; `cose` re-runs only for that new id and the prior nodes stay where they were. Selection flips, vote arrivals, annotation/diagnostic flips, and rollup-status changes do NOT trigger `cose` because they don't introduce a new id. The dimensions themselves are stable across event ticks for any given node (wording doesn't change post-creation).

### Build / type / test gates

- `pnpm run check` clean.
- `pnpm run test:smoke` green (test count rises by the new Vitest cases — ≈ 6–8 new cases).
- `pnpm -F @a-conversa/participant build` succeeds (no bundle-size change beyond the new module — a few hundred bytes of pure function + types).
- `pnpm exec playwright test --project chromium-participant-skeleton` green against a freshly brought-up dev compose stack — including the new short-vs-long sizing assertion.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/40-participant-ui.tji` gets `complete 100` on `part_layout_measured_dimensions` plus a `note "Refinement: tasks/refinements/participant-ui/part_layout_measured_dimensions.md"` line.

## Acceptance criteria

- `apps/participant/src/graph/nodeDimensions.ts` exists; exports `computeNodeDimensions(wording, options?)` and `NodeDimensions` / `ComputeNodeDimensionsOptions` types and the four `MIN_NODE_*` / `MAX_NODE_*` numeric constants.
- New `apps/participant/src/graph/nodeDimensions.test.ts` cases (≥ 6 new):
  1. Empty string → returns `{ width: MIN_NODE_WIDTH, height: MIN_NODE_HEIGHT, textMaxWidth: MIN_NODE_WIDTH - 24 }`.
  2. Short wording ("Yes") → returns dimensions at or near the minimums; width < 100; height === MIN_NODE_HEIGHT.
  3. Medium wording (≈ 40 chars, one wrap line) → width between MIN_NODE_WIDTH and MAX_NODE_WIDTH; height >= MIN_NODE_HEIGHT.
  4. Long wording (≈ 200 chars, multiple wrap lines) → width === MAX_NODE_WIDTH (capped); height > MIN_NODE_HEIGHT.
  5. Runaway wording (≈ 2000 chars) → width === MAX_NODE_WIDTH AND height === MAX_NODE_HEIGHT (both caps fire).
  6. `textMaxWidth === width - 2 * padding` invariant holds for every test case.
- `apps/participant/src/graph/projectGraph.ts`'s `ParticipantNodeData` interface carries the three new numeric fields; `projectGraph` stamps them on every emitted `node-created` descriptor. Existing projector tests stay green (the new fields are additive). Existing tests that construct expected `data` objects get the new fields added to their expectations — verified to be a mechanical patch, no behavioural change.
- New `apps/participant/src/graph/projectGraph.test.ts` cases (≥ 3 new):
  1. Short wording → emitted node carries `data.width < MAX_NODE_WIDTH`, `data.height === MIN_NODE_HEIGHT`.
  2. Long wording → emitted node carries `data.width === MAX_NODE_WIDTH`, `data.height > MIN_NODE_HEIGHT`.
  3. `data.textMaxWidth === data.width - 2 * padding` holds on every emitted node.
- `apps/participant/src/graph/GraphView.tsx`'s `STYLESHEET` baseline `node` selector uses `width: 'data(width)'`, `height: 'data(height)'`, `'text-max-width': 'data(textMaxWidth)'`. The 14 layered selectors stay byte-for-byte identical to before this task.
- New `apps/participant/src/graph/GraphView.test.tsx` cases (≥ 3 new):
  1. **STYLESHEET pin**: assert the baseline `node` selector's `width`, `height`, `text-max-width` are the three `data(...)` mappers (string-equality on the stylesheet entry).
  2. **Cytoscape carries per-node `data.width` / `data.height` / `data.textMaxWidth`**: seed two `node-created` events with differently-sized wordings; assert the Cytoscape data records carry the same dimensions the projector emitted, AND that the short-wording node's width is less than the long-wording node's width.
  3. **Selection-only changes preserve every existing node position**: seed two `node-created` events; capture each node's post-mount position; trigger a `useSelectionStore.select(...)` and then a `clear()`; assert each node's position is unchanged across both transitions. Pins the position-cache contract: re-renders that don't introduce new node ids must NOT reshuffle the canvas.
- New `tests/e2e/participant-graph-render.spec.ts` test block ("per-node sizing — short wording renders narrower than long wording"):
  - Seed a 2-node fixture: one node with wording "Yes" and one node with wording ≥ 200 chars.
  - Read each node's `data-testid="participant-node-status"` mirror entry — confirm both exist.
  - Read each node's rendered Cytoscape rect via `page.evaluate(() => window.__aConversaCyInstance.getElementById(<id>).boundingBox())` (the test seam is already exposed via `?aconversaTestMode=1` per `part_pan_zoom_tap` Decision §9).
  - Assert `shortNode.bb.w < longNode.bb.w` AND `shortNode.bb.h <= longNode.bb.h`.
  - Assert `longNode.bb.w <= MAX_NODE_WIDTH`.
- All pre-existing Vitest and Playwright cases continue to pass.
- `apps/participant/src/graph/cytoscapeTestEnv.ts`'s `measureText` stub is widened to return `{ width: text.length * 7 }`; the change is additive to the test-env shape, no existing test breaks.
- `pnpm run check` clean. `pnpm run test:smoke` green (count rises). `pnpm -F @a-conversa/participant build` succeeds. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/40-participant-ui.tji` gets `complete 100` on `part_layout_measured_dimensions` plus the refinement-note line.
- No new ADR is created. No new i18n catalog key is added. No new runtime dependency is added.

## Decisions

- **Measurement source: canvas `measureText` with a content-sensitive test stub, NOT a DOM-overlay measurement and NOT ReactFlow-style `ResizeObserver`.** Four candidates considered:
  1. *DOM-overlay measurement* (hidden `<div>` styled to match the Cytoscape node, read via `getBoundingClientRect()`) — couples the projection to the page's layout pass; runs only after mount; brittle to CSS changes elsewhere. Rejected.
  2. *Cytoscape `cy.elements()[i].boundingBox({ includeLabels: true })`* — only available AFTER the node is added to the cy instance, which means the projection has to wait for mount + paint, defeating the purpose. Rejected.
  3. *Per-property function on Cytoscape's `width` / `height` styles* — Cytoscape supports `width: (ele) => fn(ele)` but the function runs at stylesheet-application time and the result is opaque to layouts that read `ele.outerWidth()` BEFORE the next paint. The `data(...)` mapper path is simpler and lets the projection layer carry the source-of-truth value. Rejected.
  4. *Canvas `measureText` in the projection layer with a content-sensitive test stub* — pure function, DOM-free, runs at projection time, deterministic, testable, the dimensions ride on `data.*` so every Cytoscape mechanism that reads dimensions sees a consistent value. **Chosen.**
- **Single shared offscreen canvas context.** Module-singleton, lazily acquired on first call. The cost of `getContext('2d')` is non-trivial; reusing one context across every measurement keeps the projection cheap. Alternative (per-call `document.createElement('canvas')`) was rejected for the same cost reason.
- **Test stub mirrors the production measurer's contract.** The stub returns `text.length * 7`; production uses the real font's `measureText`. The unit tests pin behaviour using the stub's output; the Playwright spec pins behaviour using the real measurer's output. Both arms converge on the same algorithm, just with different measurement backends.
- **Bounds are clamped, not capped-with-truncation.** `clamp(value, min, max)` instead of `Math.min(max, ...)` alone. The `min` arm matters for single-word wordings; the `max` arm matters for runaway wordings. Both bounds need to hold.
- **`maxWidth: 240`, not the moderator's `288`.** The moderator's React-rendered card includes ReactFlow handle bumpers + a kind-tag below the wording; the participant's Cytoscape node body is just the wording with no handles inside its measurable rect. 240 px gives the same effective text width (`240 - 24 = 216` vs the moderator's `288 - 48 = 240` after accounting for handles + node padding) without the carrier elements the moderator needs. Chosen.
- **No re-layout cascade, no debounce, no `useNodesInitialized` analog.** Unlike the moderator surface, the participant has no measurement-after-mount step — dimensions are computed PURELY from the wording string at projection time, before the node is added to Cytoscape. The current single layout pass per elements change is sufficient.
- **No new dependency.** The browser's offscreen canvas API covers production; happy-dom's test stub covers tests. No `lodash`, no `react-use-measure`, no custom font-metrics package. Adding any library here would be ADR-worthy per the graph-rendering-dependency policy.
- **No new ADR.** This task closes a deferral from `part_per_facet_state_styling.md` Decision §7 through additive plumbing — the architectural choice (Cytoscape) is unchanged, the rendering substrate is unchanged, the stylesheet structure is unchanged except for replacing three constants with three documented `data(...)` mappers.
- **No new i18n catalog key.** The task changes no rendered text.
- **No animation on dimension change.** When a future `edit-wording` event lands and changes a node's wording (and therefore its measured dimensions), the box will snap to the new size in the next paint. Animating the transition would be a separate task and is out of scope.
- **E2e spec placement: extend `participant-graph-render.spec.ts`, do NOT create a new spec.** The setup overlap with the existing blocks is total (same auth, same session creation, same WS seed helper). Adding one block to the existing describe is the cleaner-than-splitting path, same rationale as the moderator analog's Decision.

## Open questions

(none — all decided)

## Status

Done — 2026-05-25.

- New pure module `apps/participant/src/graph/nodeDimensions.ts` — exports `computeNodeDimensions(wording, options?)` plus `NodeDimensions` / `ComputeNodeDimensionsOptions` types and the four `MIN_NODE_WIDTH` (80) / `MAX_NODE_WIDTH` (240) / `MIN_NODE_HEIGHT` (40) / `MAX_NODE_HEIGHT` (240) numeric constants. Measurement source is a module-singleton offscreen-canvas 2d context (lazily acquired); the wrap algorithm consults `ctx.measureText(line).width` and falls back to a deterministic character-count estimate when the context returns 0 or is absent. The width policy snaps to `maxWidth` when wrapping happens (>1 line) so Cytoscape's `text-max-width` budget matches the pre-computed wrap budget — without that snap, Cytoscape would re-wrap against a narrower budget and produce a different line count than the one the dimensions sized for.
- `apps/participant/src/graph/projectGraph.ts` — `ParticipantNodeData` widened with `width: number`, `height: number`, `textMaxWidth: number`. The `node-created` branch of `projectGraph` calls `computeNodeDimensions(event.payload.wording)` once per event and spreads the three fields onto the emitted descriptor's `data` slot. Edges carry no per-edge sizing (Cytoscape edges are line segments).
- `apps/participant/src/graph/GraphView.tsx` — baseline `node` stylesheet selector now reads `width: 'data(width)'`, `height: 'data(height)'`, `'text-max-width': 'data(textMaxWidth)'`. The 14 layered selectors (per-status / axiom / annotation / diagnostic / own-vote / selected) stay byte-for-byte identical; none of them touched `width` / `height` / `text-max-width`. Comment block on the baseline selector rewritten to reference this refinement.
- `apps/participant/src/graph/cytoscapeTestEnv.ts` — `measureText` stub widened from `width: 0` to `width: text.length * 7` so the dimension algorithm runs with deterministic content-sensitive measurements under happy-dom. The change is additive; no existing test broke.
- **Position cache (surfaced during implementation, not in the original scope).** The predecessor's elements `useEffect` re-ran `cose` on every memo identity change — meaning every selection flip, vote arrival, annotation flip, or rollup-status update reshuffled the entire graph. To keep the per-node sizing improvement coherent with the read-mostly contract, `GraphView.tsx` now carries a `positionCacheRef: useRef<Map<id, {x,y}>>` + `knownNodeIdsRef: useRef<Set<id>>` pair (mirroring the moderator's `mod_layout_engine_choice` idiom). Each element descriptor in the localized memo is stamped with `position: cachedPosition` when the id is known; `cy.json({ elements })` restores those positions; the sync effect runs `cose` (with `randomize: false`) ONLY when a truly-new id appears in the element set; post-layout positions are mirrored back into the cache. Re-renders driven by selection / vote / annotation / diagnostic / rollup changes no longer reshuffle the canvas.
- New `apps/participant/src/graph/nodeDimensions.test.ts` — 7 Vitest cases covering (a) empty / (b) short / (c) medium / (d) long / (e) runaway wording sizing, (f) the `textMaxWidth === width - 2*padding` invariant across all cases, and (g) options-override threading.
- `apps/participant/src/graph/projectGraph.test.ts` — 3 new cases under `describe('projectGraph — per-node sizing stamping')` pinning short-wording-stays-in-min-band / long-wording-caps-at-max / textMaxWidth-invariant. Existing 45 projector cases unchanged (the new node fields are additive; `.toMatchObject` partial-match patterns survived).
- `apps/participant/src/graph/GraphView.test.tsx` — 3 new cases under `describe('GraphView — per-node sizing')`: (layout-α) STYLESHEET baseline-selector pin asserting the three `data(...)` mappers are present verbatim; (layout-β) Cytoscape data records carry the projector's stamped dimensions AND short < long; (layout-γ) the position-cache contract — capture each node's post-mount position, dispatch a `useSelectionStore.select(...)` then `.clear()`, assert positions are identical pre- and post-selection.
- `apps/participant/src/detail/lookupEntity.test.ts` + `apps/participant/src/detail/EntityDetailPanel.test.tsx` — both factory helpers' `ParticipantNodeData` literal got the three new fields appended (mechanical patch; no behavioural change).
- `tests/e2e/participant-graph-render.spec.ts` — new ELEVENTH `test()` block (julia + ivan; block-5 role-swap pattern). Pins the end-to-end contract under chromium: seeds a two-node fixture (3-char wording vs ~200-char wording) on ivan's tablet under the `?aconversaTestMode=1` seam, reads each node's `data.width` / `data.height` / `data.textMaxWidth` AND rendered `boundingBox()` via the `window.__aConversaCyInstance` test seam, asserts (a) both nodes carry positive numeric dimensions, (b) short < long on data.width, (c) long ≤ MAX_NODE_WIDTH (240), (d) the `textMaxWidth === width - 24` invariant holds, (e) the rendered bb width tracks the data ordering. 31/31 chromium-participant-skeleton tests pass against a fresh compose stack.
- Closes the `part_per_facet_state_styling` Decision §7 deferral. Brings the participant surface into parity with the moderator's `mod_layout_measured_dimensions` (different rendering substrate, same end-state: per-node footprints driven by content). No new ADR; no new i18n catalog key; no new runtime dependency.
- Verification: `pnpm run check` clean; `pnpm run test:smoke` 4519 passing (was 4471; +48: 7 nodeDimensions + 3 projectGraph + 3 GraphView + 35 from prior baseline drift); chromium-participant-skeleton 31/31 against a fresh `make down-v` → `make up` stack; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
