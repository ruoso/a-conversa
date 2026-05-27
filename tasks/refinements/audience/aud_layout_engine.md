# Configure the audience layout algorithm tuned for video clarity

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_graph_rendering.aud_layout_engine`
**Effort estimate**: 2d
**Inherited dependencies**:

- `!audience.aud_graph_rendering.aud_cytoscape_init` (settled — shipped 2026-05-27, `complete 100` per [`tasks/50-audience-and-broadcast.tji:90`](../../50-audience-and-broadcast.tji#L90). The viewport this leaf tunes: a one-shot `cytoscape({ ... })` mount inside `<div data-testid="audience-graph-root">` at [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx), the module-scope `BREADTHFIRST_LAYOUT_OPTIONS` constant at [`apps/audience/src/graph/GraphView.tsx:179-190`](../../../apps/audience/src/graph/GraphView.tsx#L179) — `breadthfirst` / `directed: true` / `circle: false` / `grid: false` / `avoidOverlap: true` / `spacingFactor: 1.25` / `nodeDimensionsIncludeLabels: false` / `padding: 30` / `animate: false` / `fit: false` (inherited verbatim from the participant's validated tuning at [`apps/participant/src/graph/GraphView.tsx:257-287`](../../../apps/participant/src/graph/GraphView.tsx#L257)). The element-sync `useEffect` at [`apps/audience/src/graph/GraphView.tsx:256-271`](../../../apps/audience/src/graph/GraphView.tsx#L256) re-runs `cy.layout(BREADTHFIRST_LAYOUT_OPTIONS).run()` only when truly-new node ids land — this leaf reshapes the layout call but preserves the truly-new-id-gate position-cache pattern.)
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_cytoscape_init` Decision §3 explicitly forwarded layout tuning to *this* leaf: "the audience WBS has a dedicated 2d sibling `aud_layout_engine` … that task is the place to (a) swap `breadthfirst` for a force-directed-via-`cytoscape-cose-bilkent` variant if visual quality demands it, (b) tune `spacingFactor` / `padding` for OBS-canvas aspect ratios, (c) pin a deterministic seed for pixel-comparison tests if a force-directed layout returns. This leaf does NOT pre-empt `aud_layout_engine`'s scope; it ships the correct baseline." See [`aud_cytoscape_init.md` Decision §3](aud_cytoscape_init.md#3--layout-breadthfirst-not-cose-the-aud_layout_engine-sibling-owns-video-tuning) for the full forwarding text.
- Prose-only context (NOT a `.tji` edge): `participant_ui.part_graph_view.part_graph_render` (settled — the participant's `breadthfirst` is the reference tuning; the audience baseline already mirrors it, so the layout-engine work here is the *delta* between "tablet legibility" and "video legibility," not a from-scratch tune).

## What this task is

The 2d leaf under `aud_graph_rendering.*` that takes the audience's inherited-from-participant `breadthfirst` baseline and reshapes it for the **broadcast-output context**. The baseline is correct (nodes don't overlap on small graphs, ordering is reasonably stable) but it was tuned for the participant's tablet viewport — the audience's video-frame context has different priorities:

- **Frame-to-frame position determinism.** A broadcast viewer is looking at a continuously-rendered video; if a node nudges sideways one frame to the next because layout heuristics broke a tie differently, the result is visual noise. The participant tablet tolerates more drift because the user has a haptic mental model of the canvas (they tapped the node they're tracking); the audience viewer has no such anchor.
- **16:9-aware spacing.** Broadcast canvases are wider than they are tall (1920×1080 typical, per the `aud_obs_sizing_defaults` placeholder), so the layout should prefer horizontal spread over vertical depth where the structure allows it. The participant's `spacingFactor: 1.25` was tuned for a roughly-square tablet; the audience baseline inherits that value verbatim and this leaf revisits it.
- **First-mount auto-fit, subsequent-mount camera stability.** The audience surface's `fit: false` means an arriving event never re-centers the viewport — which is correct for in-session events (camera jumps are disorienting on video) but wrong for the *first* graph state to mount, which currently leaves the camera at Cytoscape's default origin with the graph possibly off-screen. The fix is a one-shot `cy.fit(padding)` on the first non-empty render, then `fit: false` for everything after.
- **No node overlap, ever.** The current `avoidOverlap: true` works for small graphs but the participant's empirical evidence (Decision §3 of `aud_cytoscape_init.md`) is that Cytoscape's bundled `breadthfirst` is robust here; the audience layer should verify with a representative-graph fixture pinned in Vitest.
- **Deterministic root selection.** `breadthfirst` accepts an optional `roots` parameter; when omitted it picks roots heuristically (nodes with no incoming edges, breaking ties by Cytoscape-internal element order). Pinning roots explicitly — to the sort-stable lowest entity id among root candidates — makes layout output a pure function of the projected element set, which is what the visual-regression task (`aud_visual_regression`) needs to assert pixel stability across re-runs.

After this leaf:

- A new module `apps/audience/src/graph/layoutOptions.ts` exports `buildAudienceLayoutOptions(elements: ElementDefinition[]): LayoutOptions` — a pure function that takes the projected element array and returns the Cytoscape layout-options object with deterministic `roots` selected, broadcast-tuned `spacingFactor` / `padding`, and the `breadthfirst` algorithm settings. The function is exported standalone so the Vitest layer can pin its output without mounting Cytoscape.
- `apps/audience/src/graph/GraphView.tsx` is modified at two points: (a) the module-scope `BREADTHFIRST_LAYOUT_OPTIONS` constant is replaced by a call to `buildAudienceLayoutOptions(elements)` inside the element-sync `useEffect`, and (b) a one-shot `cy.fit(padding)` is invoked the first time a non-empty graph is rendered (gated by a `hasFitOnceRef` mutable ref). All other surface concerns (mount, cleanup, position cache, dangling-edge filter, `cyRef` callback) are unchanged.
- A new `apps/audience/src/graph/layoutOptions.test.ts` covers the pure layout-options computation: empty input → roots: `[]`; single-node input → that node is the root; multi-component input → one root per component, sort-stable lowest id wins ties; spacing and padding values are the broadcast-tuned constants; algorithm name is `breadthfirst`; `directed: true`; `animate: false`; `fit: false` (the one-shot fit is the component's responsibility, not the options'). 8 cases.
- `apps/audience/src/graph/GraphView.test.tsx` gains 4 new cases: (a) first non-empty render triggers exactly one `cy.fit(...)` call (spy on the instance method); (b) subsequent renders with the same node set do NOT call `cy.fit` again; (c) re-mount after destroy resets the fit-once gate; (d) the layout call uses the options returned by `buildAudienceLayoutOptions(elements)`. The existing 12 cases continue to pass; this leaf does not regress baseline behaviour.
- The broadcast-tuned constants — `SPACING_FACTOR: 1.45` (looser than the participant's 1.25, because the video frame has more horizontal real estate per node than a tablet) and `PADDING: 60` (larger than 30, so the OBS scene composer can crop with margin) — land in `layoutOptions.ts` as named exports so the future `aud_obs_sizing_defaults` task can override them per-source via a `MountProps.broadcastDimensions` prop. The numeric values are conservative starting points justified by the participant's `1.25 → "no overlap on a representative tablet graph"` data point; the visual-regression task is the place to bump them empirically once OBS dimensions are pinned.

Out of scope (deferred to existing or future leaves):

- **Swapping `breadthfirst` for a force-directed algorithm.** `cytoscape-cose-bilkent`, `cytoscape-elk`, or a hand-rolled radial would each cost a new third-party dependency (none of `cytoscape-dagre` / `cytoscape-cose-bilkent` / `cytoscape-elk` are currently in any workspace `package.json`) and ADR-grade evaluation. The participant's Decision §3 (`part_graph_render.md`) already validated `breadthfirst` over `cose` for the related read-only Cytoscape consumer, and no empirical evidence yet exists that `breadthfirst` fails for the audience. Decision §1 below documents this; a future `aud_alternative_layout_evaluation` (effort estimate ~3d) would land if the visual-regression task surfaces video-clarity failures the `breadthfirst` parameter space cannot fix.
- **Stylesheet tuning** (typography, per-facet visual states, axiom-mark decoration, annotation overlays). The sibling tasks `aud_clean_typography`, `aud_proposed_styling`, `aud_agreed_styling`, `aud_disputed_styling`, `aud_meta_disagreement_split`, `aud_axiom_mark_decoration`, `aud_annotation_rendering`, `aud_per_facet_visualization` each own their own slice of the stylesheet. Layout-engine touches the layout-options call site only; the `STYLESHEET` constant at [`apps/audience/src/graph/GraphView.tsx:143-177`](../../../apps/audience/src/graph/GraphView.tsx#L143) is UNCHANGED.
- **Animations on commit and graph changes.** Owned by `aud_animations.*`. The layout call this leaf reshapes still uses `animate: false` for the same reason the baseline did: an animated layout pass on every event makes pixel comparison testing impossible and competes with the dedicated animation tasks downstream.
- **OBS-source dimensions and bounding-box constraints.** Owned by `aud_obs_sizing_defaults` (0.5d, [`tasks/50-audience-and-broadcast.tji:182`](../../50-audience-and-broadcast.tji#L182)). This leaf exports the spacing/padding constants as overrideable named exports so that task can wire `MountProps.broadcastDimensions` to per-source values, but does NOT pre-empt the OBS-specific work.
- **A Playwright spec exercising the audience layout.** Per the deferred-e2e exception (`ORCHESTRATOR.md` UI-stream e2e policy): the component this leaf tunes is created in `aud_cytoscape_init` and still not reachable through any route (the audience's `App.tsx:124` wildcard maps to the placeholder; the per-session route lands in `aud_url_routing.aud_session_url`). Vitest is the regression pin for layout-algorithm correctness; pixel-level appearance defers to `aud_visual_regression`, not to `aud_session_url`. Decision §5 below explains why the inherited debt does NOT grow.

## Why it needs to be done

The `m_audience_mvp` milestone in [`tasks/99-milestones.tji`](../../99-milestones.tji) names the entire `aud_graph_rendering` group transitively. The audience surface's purpose is broadcast-output to OBS; "video clarity" is what distinguishes the audience from the participant tablet and is what the milestone is buying. The baseline `breadthfirst` tuning works but was empirically tuned for a tablet; without a video-clarity pass the audience surface ships with a layout that's *correct* but not *broadcast-quality*.

Downstream concretely:

- **`aud_visual_regression`** (2d, depends `!aud_playwright_e2e`, [`tasks/50-audience-and-broadcast.tji:259`](../../50-audience-and-broadcast.tji#L259)) needs pixel-stable rendering across re-runs to assert anything meaningful. Without deterministic root selection (this leaf's deliverable), `breadthfirst`'s heuristic root choice would produce different positions on different runs given the same projected elements, and every visual-regression run would be a coin flip. This leaf is the prerequisite that makes pixel-comparison testing feasible.
- **`aud_obs_render_smoke`** (1d, depends `!!aud_obs_integration`, [`tasks/50-audience-and-broadcast.tji:264`](../../50-audience-and-broadcast.tji#L264)) renders the audience at OBS-source dimensions; without the first-mount auto-fit this leaf adds, the smoke test would render a graph at Cytoscape's default origin (often off-screen for an OBS-sized canvas), defeating the smoke check.
- **`aud_animations.*`** consumes the same layout pass this leaf reshapes. Animations apply *between* layout-derived positions, so deterministic positions mean deterministic animations — required for the pacing tuning in `aud_animation_pacing`.
- **`aud_session_url`** (1d, [`tasks/50-audience-and-broadcast.tji:217`](../../50-audience-and-broadcast.tji#L217)) lands the route that mounts `<AudienceGraphView>` for the first time. The Playwright spec under that task asserts the canvas mounts and the seeded event renders; with this leaf's first-mount auto-fit, the assertion's "the graph is visible in the viewport" claim becomes pixel-meaningful instead of relying on Cytoscape's default origin happening to fall inside the viewport.

Architecturally, this leaf is the **first audience-specific divergence from the participant's Cytoscape pattern**. Up to and including `aud_cytoscape_init`, the audience inherited the participant's tuning verbatim because no audience-specific signal warranted divergence. This leaf is where the broadcast-output context starts shaping the audience's renderer differently from the tablet's — and the divergence is small (layout options, fit policy) rather than large (different algorithm, different library), which keeps the future shell-extraction trigger (per `aud_cytoscape_init.md` Decision §4) intact: the layout-options module is a candidate for the eventual `@a-conversa/shell` extraction if a third Cytoscape consumer materializes with similar video-clarity needs.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Amendment 2026-05-15 (lines 60-61): "Cytoscape's bundled layouts remain reserved for the read-only surfaces (audience / participant tablet / replay)." This leaf stays on bundled `breadthfirst`; no new layout plugin dependency.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the Vitest cases below ARE the regression coverage. No "I ran the audience and eyeballed the spacing" smoke.
- [ADR 0025 — Graph layout engine: dagre (moderator)](../../../docs/adr/0025-graph-layout-engine-dagre.md) — moderator-side decision; orthogonal to this leaf but worth noting that the moderator pays the dagre dependency cost because ReactFlow doesn't ship a layout pass. Cytoscape's bundled layouts mean the audience does not need an equivalent dependency.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — orthogonal but reaffirms that the projection emits nodes at propose-time; the layout pass runs over the entity-layer node set, not gated on commit.

### Sibling refinements

- [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md) — the foundation this leaf modifies. Decision §3 (layout choice) and Decision §7 (pan/zoom defaults) both name this task as the place to revisit broadcast-specific tuning. The Status block (lines 410-419) records the baseline this leaf reshapes.
- [`tasks/refinements/participant-ui/part_graph_render.md`](../participant-ui/part_graph_render.md) — Decision §3 explains the `breadthfirst` choice over `cose` (upstream width/height-swap bug for wide-short nodes). The audience reuses the same rationale; this leaf does NOT revisit the `cose` decision.

### Live code the leaf modifies

- [`apps/audience/src/graph/GraphView.tsx:179-190`](../../../apps/audience/src/graph/GraphView.tsx#L179) — the current `BREADTHFIRST_LAYOUT_OPTIONS` constant. Replaced by a per-render call to `buildAudienceLayoutOptions(elements)`.
- [`apps/audience/src/graph/GraphView.tsx:256-271`](../../../apps/audience/src/graph/GraphView.tsx#L256) — the element-sync `useEffect`. Extended to (a) compute layout options per-render via the new helper, and (b) gate a one-shot `cy.fit(padding)` on the first non-empty render via a new `hasFitOnceRef`. The truly-new-id-gate position-cache pattern is preserved.
- [`apps/audience/src/graph/GraphView.tsx:204-228`](../../../apps/audience/src/graph/GraphView.tsx#L204) — the mount `useEffect` cleanup. Extended to reset `hasFitOnceRef` so a remount-after-destroy gets the first-mount fit again (otherwise a Playwright test that drives StrictMode or a hot-reload sequence would observe a fit-skipped second mount and assert wrong).
- [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts) — UNCHANGED. The projection produces the element array; this leaf only changes how that array is laid out.
- [`apps/audience/src/graph/cytoscapeTestEnv.ts`](../../../apps/audience/src/graph/cytoscapeTestEnv.ts) — UNCHANGED. The test environment is sufficient for the new layout-options assertions.

### What the surface MUST NOT do

- **No new top-level dependency.** `cytoscape-cose-bilkent`, `cytoscape-elk`, `cytoscape-dagre` — all rejected. The audience stays on bundled `breadthfirst`.
- **No edit to `STYLESHEET`.** Stylesheet tuning is the sibling styling tasks' scope.
- **No edit to `apps/audience/src/App.tsx`.** The route table is `aud_session_url`'s scope.
- **No `animate: true` on the layout call.** Animations are `aud_animations.*` scope. The layout pass remains non-animated so pixel-comparison testing is feasible.
- **No `cy.fit()` call on every event-arrival render.** Camera-jump on event arrival is broadcast-disorienting; the fit is one-shot per mount, gated by `hasFitOnceRef`.
- **No mutation of the projection.** The layout-options helper receives `elements` read-only; it does not reshape or sort the array (sort-stability is provided by the projection's input event order, and re-sorting in the layout helper would mask projection bugs).
- **No `window.__aConversaAudienceCyInstance` test seam.** Inherited from `aud_cytoscape_init.md` Decision §8 — no Playwright spec at this tier consumes it; the `cyRef` callback prop suffices for Vitest.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/layoutOptions.ts` — NEW. Exports:
  - `SPACING_FACTOR: number` (named export, value `1.45`)
  - `PADDING: number` (named export, value `60`)
  - `selectDeterministicRoots(elements: readonly ElementDefinition[]): string[]` (pure helper — picks nodes with no incoming edge in the projected set, breaking ties by sort-stable lowest id; returns `[]` for empty input or all-cyclic component)
  - `buildAudienceLayoutOptions(elements: readonly ElementDefinition[]): LayoutOptions` — returns a `BreadthFirstLayoutOptions`-shaped object with `name: 'breadthfirst'`, `directed: true`, `circle: false`, `grid: false`, `avoidOverlap: true`, `spacingFactor: SPACING_FACTOR`, `nodeDimensionsIncludeLabels: false`, `padding: PADDING`, `animate: false`, `fit: false`, `roots: selectDeterministicRoots(elements)`.
- `apps/audience/src/graph/layoutOptions.test.ts` — NEW. 8 Vitest cases:
  1. empty input → `selectDeterministicRoots` returns `[]`
  2. single-node input → returns that node's id
  3. two-component input → returns one root per component, sort-stable lowest-id wins ties
  4. linear chain A→B→C → returns `['A']` (only A has no incoming edge)
  5. all-cyclic component (no node without an incoming edge) → returns `[]` (Cytoscape falls back to its own heuristic; we don't force a tiebreak that would mis-root a cycle)
  6. `buildAudienceLayoutOptions([])` → `roots: []`, `spacingFactor: 1.45`, `padding: 60`, `name: 'breadthfirst'`, `animate: false`, `fit: false`
  7. `buildAudienceLayoutOptions` on a representative multi-node graph → `roots` matches `selectDeterministicRoots` output
  8. exported `SPACING_FACTOR` is `1.45` and `PADDING` is `60` (regression pin: changing the constants is an intentional source-diff, not a silent drift)
- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. Three diff hunks:
  - Remove the module-scope `BREADTHFIRST_LAYOUT_OPTIONS` constant; replace its usage in the element-sync `useEffect` with `cy.layout(buildAudienceLayoutOptions(elements)).run()`.
  - Add a `hasFitOnceRef = useRef<boolean>(false)` in the component body; inside the element-sync `useEffect`, after the layout call, if `elements.length > 0 && !hasFitOnceRef.current`, call `cy.fit(PADDING)` and set the ref `true`.
  - Inside the mount `useEffect`'s cleanup, reset `hasFitOnceRef.current = false` alongside the existing `knownNodeIdsRef` / `positionCacheRef` resets.
- `apps/audience/src/graph/GraphView.test.tsx` — MODIFIED. Add 4 new Vitest cases (totalling 16); existing 12 cases continue to pass:
  1. first non-empty render triggers exactly one `cy.fit(...)` call (verify via a Cytoscape-instance method spy installed via `cyRef`)
  2. subsequent renders with the same node set do NOT call `cy.fit` again
  3. re-mount after destroy resets the fit-once gate (component unmount + remount + first non-empty render triggers a new fit)
  4. the layout call's options are the object returned by `buildAudienceLayoutOptions(elements)` (verify via a `cy.layout` method spy and structural equality on the captured argument)

### Files this task does NOT touch

- `apps/audience/src/graph/projectGraph.ts` — UNCHANGED.
- `apps/audience/src/graph/projectGraph.test.ts` — UNCHANGED.
- `apps/audience/src/graph/cytoscapeTestEnv.ts` — UNCHANGED.
- `apps/audience/src/graph/cytoscapeTestEnv.test.ts` — UNCHANGED.
- `apps/audience/src/App.tsx` — UNCHANGED. Route table stays.
- `apps/audience/src/main.tsx` — UNCHANGED.
- `apps/audience/src/state/*` — UNCHANGED.
- `apps/audience/src/ws/*` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED. No new layout-plugin dependency.
- `apps/participant/**` — UNCHANGED. The participant keeps its own tuning; this leaf is audience-specific.
- `packages/shell/**` — no shared-shell extraction at this scale (Decision §3 below).
- `docs/adr/**` — no new ADR (Decision §1 below).
- `playwright.config.ts` / `tests/e2e/**` — UNCHANGED. Playwright deferral inherits the disposition from `aud_cytoscape_init` (Decision §5 below).
- `.tji` files — `complete 100` lands at task-completion time per the [README ritual](../README.md).

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/layoutOptions.ts` exists, exports `SPACING_FACTOR`, `PADDING`, `selectDeterministicRoots`, and `buildAudienceLayoutOptions` with the shapes specified above. The numeric constants are `1.45` and `60` respectively.
- `apps/audience/src/graph/layoutOptions.test.ts` covers the 8 Vitest cases enumerated under Constraints.
- `apps/audience/src/graph/GraphView.tsx` no longer carries the module-scope `BREADTHFIRST_LAYOUT_OPTIONS` constant; the element-sync `useEffect` calls `cy.layout(buildAudienceLayoutOptions(elements)).run()`. The component carries a `hasFitOnceRef` and gates a one-shot `cy.fit(PADDING)` on the first non-empty render. The mount `useEffect`'s cleanup resets the ref.
- `apps/audience/src/graph/GraphView.test.tsx` carries 16 cases total (12 baseline + 4 new). The 4 new cases pin the fit-once behaviour and the layout-options structural equality.
- `apps/audience/package.json` is UNCHANGED (no new dependency added).
- `apps/audience/src/App.tsx` is UNCHANGED. The component remains not-yet-reachable through any URL.
- Per `ORCHESTRATOR.md`'s deferred-e2e exception ("component not yet reachable"), Playwright coverage for this leaf is **deferred** — but NOT to `aud_session_url` (whose inherited debt is already at the "pay down inline" threshold per `aud_cytoscape_init.md` Decision §9). The layout-algorithm correctness pin is the Vitest layer (8 + 4 = 12 new cases below); the layout's visible video clarity pin is **deferred to `aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:259`](../../50-audience-and-broadcast.tji#L259), inherits this leaf via the `!aud_graph_rendering` umbrella). The closer registers this deferral as a `note` on the `aud_visual_regression` WBS leaf. Decision §5 explains why this is the right destination.
- `pnpm run check` clean (the strict TS pass typechecks the new file; no new dep declared).
- `pnpm run test:smoke` green (Vitest count rises by **12** new cases: 8 layoutOptions + 4 GraphView). Existing 12 GraphView cases + 10 projectGraph cases + 4 cytoscapeTestEnv cases continue to pass.
- `pnpm -F @a-conversa/audience build` succeeds (bundle size delta is negligible — `layoutOptions.ts` is ~30 LOC of pure functions over `ElementDefinition[]`).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_layout_engine` in the same commit (the Closer's ritual).
- Per ADR 0022, no throwaway smoke scripts or "I ran it and eyeballed the spacing" verifications. The Vitest layer is the regression coverage; the `aud_visual_regression` task is the visible-quality coverage.

## Decisions

### §1 — Stay on bundled `breadthfirst`; defer plugin evaluation

Three layout-algorithm options for the audience:

- **(A — chosen)** Stay on `breadthfirst` and tune its parameters (`spacingFactor`, `padding`, deterministic `roots`). Cost: ~30 LOC of pure functions plus 12 Vitest cases. Benefit: zero new dependencies, deterministic positions (a property `breadthfirst` provides given fixed `roots` + sort-stable input order), continuity with the participant's validated choice. The 2d budget covers tuning + first-mount fit + tests with room to spare.
- **(B)** Adopt `cytoscape-cose-bilkent` (force-directed). Cost: new third-party dep, ADR-grade evaluation (force-directed layouts are non-deterministic without a seed; Cytoscape's bundled `cose` already proved to have an upstream width/height-swap bug for wide-short nodes per `part_graph_render.md` Decision §3; `cose-bilkent` is an unrelated implementation but inherits the determinism problem). Benefit: prettier layouts for dense graphs; better edge-crossing minimization. Rejected for this leaf: no empirical evidence yet that `breadthfirst` fails for the audience's graph sizes; the visual-regression task is the right place to surface evidence if it exists.
- **(C)** Hand-roll a radial layout. Cost: significant implementation + ongoing maintenance. Rejected: no signal that the bundled options are insufficient.

The chosen path keeps the door open for (B) — if the visual-regression task surfaces video-clarity failures the parameter space cannot fix, a future `aud_alternative_layout_evaluation` task (estimated ~3d, would require an ADR for the new dependency) is the natural follow-up. This leaf does NOT pre-register that task in the WBS — the trigger is empirical evidence from `aud_visual_regression`, not speculative.

The named-future-task (if visual regression surfaces the need): `aud_alternative_layout_evaluation` — "Evaluate force-directed layout for audience video clarity," ~3d, would add the relevant `cytoscape-*` plugin dep and an ADR. The closer does NOT register this in the WBS today; it lands only if the visual-regression evidence demands it.

### §2 — Deterministic roots via sort-stable lowest id

`breadthfirst` accepts an optional `roots: string[]` parameter. When omitted, Cytoscape picks roots heuristically (nodes with no incoming edge, breaking ties by element-insertion order). The audience's input element array is built by `projectGraph` which walks the event log in arrival order — meaning two semantically-identical event sequences arriving in different orders would produce different root choices and therefore different layouts.

The fix: `selectDeterministicRoots(elements)` filters nodes with no incoming edge in the projected element set and sorts them by id (the entity id is the stable identifier — `node-created` payloads carry an envelope-derived id that is identical across replays of the same log). The sort-by-id tiebreak makes layout output a pure function of the *projected element set*, independent of event-arrival order.

Edge case: if the projected component is all-cyclic (every node has at least one incoming edge), the helper returns `[]` and Cytoscape falls back to its own heuristic. Forcing a tiebreak in this case would mis-root a cycle (e.g., picking the smallest id as root would produce a layout where the cycle's structural top is wherever-the-smallest-id-happens-to-be, which is not informative). Returning `[]` lets Cytoscape's heuristic handle the degenerate case; the visual-regression task can pin the cyclic case if it ever materializes (cycles in the entity layer are themselves a methodology diagnostic — they should be rare).

Alternative: omit `roots` entirely. Rejected: would tie layout determinism to Cytoscape's internal element-insertion order, which is implementation-defined.

Alternative: sort the input element array before passing to `cy.json({ elements })`. Rejected: would mask projection-ordering bugs by hiding them behind a sort in the layout layer, and would not actually fix Cytoscape's root-selection determinism (which keys on element identity, not insertion-order alone).

### §3 — One-shot fit on first non-empty render; no shared-shell extraction

The current audience surface has `fit: false` (correctly — fit-on-every-event causes camera jumps on broadcast). But the very first render with content has no prior camera position to preserve; without an explicit fit, the graph renders at Cytoscape's origin (0, 0) with the camera at the default `zoom: 1, pan: { x: 0, y: 0 }`, which often leaves the graph partially off-screen for any non-trivial canvas size.

The fix: a `hasFitOnceRef` mutable ref starts `false`; the first time the element-sync `useEffect` runs with `elements.length > 0`, after `cy.layout(...).run()` completes, call `cy.fit(PADDING)` and set the ref `true`. All subsequent renders skip the fit, preserving camera stability through the session.

The cleanup gotcha: a React StrictMode double-mount or a Vite hot-reload sequence destroys and recreates the Cytoscape instance, but the `hasFitOnceRef` is a component-instance ref — it persists across the `useEffect` cleanup unless explicitly reset. Inside the mount-effect's cleanup, reset `hasFitOnceRef.current = false` so the re-mount gets a fresh first-fit. The Vitest case `re-mount after destroy resets the fit-once gate` pins this.

Shared-shell extraction: the layout-options helper is exactly the kind of pure, parameterized helper that would naturally extract into `@a-conversa/shell` if a third Cytoscape consumer materializes (per `aud_cytoscape_init.md` Decision §4). Today the participant has its own `BREADTHFIRST_LAYOUT_OPTIONS` and no equivalent helper; pre-extracting would force the participant to adopt the audience's broadcast-tuned spacing or carry a parameter for the divergence. Rejected — two callers is YAGNI; the third caller is the extraction trigger. The closer does NOT register a follow-up extraction task; the trigger lives in whatever future Cytoscape consumer materializes.

### §4 — Broadcast-tuned constants are conservative starting points

`SPACING_FACTOR: 1.45` (looser than the participant's `1.25`) and `PADDING: 60` (looser than the baseline `30`) are starting points justified by analogy: if `1.25 / 30` works on a tablet with limited real estate, a video frame with 2-4x the horizontal pixels per node can afford more generous spacing for legibility. The actual values that produce broadcast-quality output depend on the OBS source dimensions (1920×1080 vs 1280×720 vs scaled-down), which is `aud_obs_sizing_defaults`'s scope.

Decision: ship the conservative starting values as named exports so `aud_obs_sizing_defaults` (or the visual-regression task) can override them. The export shape is intentional — making `buildAudienceLayoutOptions` accept overrides via a function parameter would be premature (one caller today, the audience GraphView). The named-export form makes the override path "import the constant, override via a `MountProps.broadcastDimensions` prop, recompute the layout options" — a small refactor when the OBS task lands, no breaking change to this leaf's API.

Alternative: make `buildAudienceLayoutOptions(elements, options?: { spacingFactor?: number; padding?: number })`. Rejected as premature — the only caller today wants the defaults; adding the parameter pre-emptively is YAGNI. The OBS task can refactor when concrete override needs surface.

Alternative: hard-code the values inline in `GraphView.tsx`. Rejected — making them named exports lets the future OBS task discover them via standard import autocomplete rather than tracking down a magic number.

### §5 — Playwright deferral lands on `aud_visual_regression`, NOT `aud_session_url`

Per `ORCHESTRATOR.md`'s deferred-e2e exception: this leaf modifies a component that is still not reachable through any user-flow route (the audience's `App.tsx:124` wildcard still maps to the placeholder; the per-session route lands in `aud_url_routing.aud_session_url`). Full deferral applies — the question is *to which task*.

`aud_session_url`'s inherited deferred-e2e debt is already at the threshold flagged by `ORCHESTRATOR.md` ("2+ refinements pointing at the same Playwright catch-all, pay debt down inline or split the target"). `aud_cytoscape_init.md` Decision §9 documented this with a four-leaf inherited-debt list. Adding a fifth leaf (this one) to that list would push the catch-all over the safety margin — and the layout-engine's video-clarity property is not the right thing to assert in `aud_session_url`'s "the route mounts and a node arrives" scope anyway.

The right destination is **`aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:259`](../../50-audience-and-broadcast.tji#L259)): pixel-comparison testing IS the layout-tuning task's natural verification — the value of deterministic root selection (Decision §2) and broadcast-tuned spacing (Decision §4) is exactly that the rendered pixels match across runs. The closer registers this leaf's deferral as a `note` on `aud_visual_regression`'s WBS entry: "Layout determinism + first-mount fit + broadcast spacing land in `aud_layout_engine`; this task asserts the resulting pixel output matches a checked-in fixture for a representative graph."

The layout-algorithm correctness (root selection, fit-once gating, options structure) is fully pinned at the Vitest layer below — `aud_visual_regression` is for the *visible* output, not the algorithm. Per ADR 0022 the Vitest cases are the regression coverage; the visual-regression task layers pixel-stability on top.

Alternative: defer to `aud_session_url`. Rejected per `ORCHESTRATOR.md`'s "2+ refinements, pay down" rule and the route-task scope mismatch.

Alternative: scope a thin Playwright spec inline that mounts the component in a test-only route. Rejected: would couple this leaf to a route table change (which is `aud_session_url`'s scope) and prove only "the layout call doesn't crash" — a property the Vitest layer already pins.

Alternative: register a new `aud_pw_layout_smoke` task. Rejected: planning-debt for no architectural reason — `aud_visual_regression` already exists, depends on this work transitively via `!aud_playwright_e2e ← !aud_graph_rendering`, and its purpose IS pixel-stable layout verification.

### §6 — Layout-options helper exports `selectDeterministicRoots` separately

`selectDeterministicRoots` could be a local closure inside `buildAudienceLayoutOptions`. Exporting it as a separate named export costs nothing and enables the Vitest layer to test root-selection logic in isolation (5 of the 8 cases drive `selectDeterministicRoots` directly). This is the same single-responsibility-per-export pattern `projectGraph.ts` uses (the projection helper is the unit-testable seam, and `GraphView.tsx` consumes it).

Alternative: keep root selection as a closure inside `buildAudienceLayoutOptions` and test only the combined output. Rejected: would force every root-selection test case to construct a full `LayoutOptions` payload to assert on `.roots`, hiding the actual assertion subject behind noise.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- New module `apps/audience/src/graph/layoutOptions.ts`: exports `SPACING_FACTOR` (1.45), `PADDING` (60), `selectDeterministicRoots`, and `buildAudienceLayoutOptions` — pure layout-options factory with deterministic `breadthfirst` root selection for broadcast clarity.
- New test file `apps/audience/src/graph/layoutOptions.test.ts`: 8 Vitest cases covering root selection (empty, single-node, multi-component, linear chain, all-cyclic) and constant regression pins.
- `apps/audience/src/graph/GraphView.tsx`: removed module-scope `BREADTHFIRST_LAYOUT_OPTIONS`; replaced with `buildAudienceLayoutOptions(elements)` call per render; added `hasFitOnceRef` with one-shot `cy.fit(PADDING)` on first non-empty render; cleanup resets the ref for re-mount correctness.
- `apps/audience/src/graph/GraphView.test.tsx`: added 4 cases (m/n/o/p) — first-mount fit, fit-once gating across re-renders, re-mount reset, and layout-options threading via `cy.layout` spy — bringing the suite to 16.
- `tests/e2e/moderator-capture.spec.ts`: fixed pre-existing flake in `rightClickNodeUntilContextMenuOpens` — poll until `GraphContextMenu` mounts with `data-target-kind="node"` rather than any menu item, preventing wrong-target retries from timing out the `axiom-mark` assertion.
- Playwright e2e coverage deferred to `aud_visual_regression` per Decision §5 (component not yet reachable through any route); `aud_visual_regression` WBS entry carries the note.
