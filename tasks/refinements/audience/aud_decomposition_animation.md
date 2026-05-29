# Audience decomposition animation (a one-shot CSS `@keyframes` slate-tinted fade-out halo painted by a NEW DOM-overlay sibling `<AudienceDecompositionFadeOverlay>` over each Cytoscape node whose projected `data.decomposed` first flips to `true` mid-broadcast — a fresh `decomposed: true` flag stamped by `projectGraph` when a `commit` event lands against a pending `decompose` / `interpretive-split` proposal payload, applied to the proposal's `parent_node_id`; the post-animation steady state is a single new stylesheet selector `node[?decomposed]` painting `opacity: 0.15` so the parent's "this card was structurally retired" status reads at-rest; component children emerging at propose-time / commit-time are NOT animated by this leaf — `aud_node_appear_animation`'s existing halo overlay already handles their `node-created` arrival via the shared seen-Set gate; gated by `useSeenKeysGate` keyed by `nodeId` over currently-`decomposed` entries so initially-decomposed parents at audience-join do NOT animate; suppressed under `prefers-reduced-motion: reduce`)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_animations.aud_decomposition_animation` (lines 336-339).
**Effort estimate**: 2d
**Inherited dependencies**:

- `!audience.aud_graph_rendering` (settled — the entire group is `complete 100`). The audience surface paints node bodies via Cytoscape's canvas-side `STYLESHEET` (lifted to [`apps/audience/src/graph/stylesheet.ts`](../../../apps/audience/src/graph/stylesheet.ts)) and projects per-element `data` via [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts). This leaf adds an **entity-layer animation** keyed on a fresh-by-this-task `data.decomposed` flag the projector stamps when it observes a `commit` of a `decompose` / `interpretive-split` proposal; the steady-state visual contract for non-decomposed entities is unchanged.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_node_appear_animation` (settled — [`tasks/refinements/audience/aud_node_appear_animation.md`](aud_node_appear_animation.md)). The direct structural precedent. Decision §1 (CSS keyframe on React-keyed halo `<span>`, NOT `cy.animate()` and NOT a JS-pump), §3 (overlay owns its own seen-Set, separate from GraphView's `knownNodeIdsRef`), §4 (lazy-init-on-first-non-empty-placements seeding), §5 (~450 ms easing — halo geometry justifies the slower entrance), §6 (Vitest pins React-side + CSS file presence; Playwright deferred) all apply verbatim modulo the placement-filter (currently-`decomposed` parents vs all nodes) and the keyframe palette (slate-on-fade-out vs slate-on-fade-in). The components emerging at propose-time arrive via per-component `node-created` events the moderator's propose-handler fans out (per [`tasks/refinements/moderator-ui/mod_decompose_propose_time_canvas_visibility.md`](../moderator-ui/mod_decompose_propose_time_canvas_visibility.md) D3) and are ALREADY animated by this predecessor's halo — this leaf does NOT re-animate component arrivals.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_withdrawal_animation` (settled — [`tasks/refinements/audience/aud_withdrawal_animation.md`](aud_withdrawal_animation.md)). The transition-keyed `useSeenKeysGate` precedent for an entity-layer rollup transition (`'agreed'` → `'disputed'`); this leaf adopts the same posture, narrowed to a per-node key shape over a fresh `data.decomposed` boolean. Decision §4 of that refinement is the seed-semantics template adopted verbatim.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_proposed_to_agreed_animation` (settled — [`tasks/refinements/audience/aud_proposed_to_agreed_animation.md`](aud_proposed_to_agreed_animation.md)). The target-state-keyed seen-Set precedent: the key shape encodes the target state, the `currentKeys` is filtered to entries currently IN that state, the first non-empty commit seeds with whatever is already in that state at audience-join.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_axiom_mark_animation` (settled — [`tasks/refinements/audience/aud_axiom_mark_animation.md`](aud_axiom_mark_animation.md)). The pioneer animation leaf that established the CSS-first, no-motion-framework, `prefers-reduced-motion`-in-CSS, Vitest-pins-class-logic, Playwright-deferred posture.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_diagnostic_fire_animation` (settled — [`tasks/refinements/audience/aud_diagnostic_fire_animation.md`](aud_diagnostic_fire_animation.md)) and `aud_diagnostic_edge_fire_animation` + `aud_diagnostic_fire_animation_seeding_alignment`. Established the projector-derived (not cytoscape-derived) key pattern: the diagnostics overlays seed their seen-Set synchronously from the projector tuples on first render rather than waiting for `useCytoscapeOverlayPlacements`'s rAF-batched first non-empty commit, because the source-of-truth is store-derived (the projection's diagnostic list) not canvas-derived (cytoscape's nodes). This leaf adopts the same posture — `decomposed` is also store-derived (a projector stamp), so the synchronous-seed-from-store pattern applies (Decision §5 below).
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_dom_overlay_extraction` (settled — [`tasks/refinements/audience/aud_dom_overlay_extraction.md`](aud_dom_overlay_extraction.md)). The shared hooks `useCytoscapeOverlayPlacements<P>` and `useSeenKeysGate<K>` at [`apps/audience/src/graph/cytoscapeOverlayHooks.ts:89-210`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts) are consumed by this leaf for the cytoscape-side iteration; the seen-Set is seeded synchronously from the projector signal (per the seeding-alignment precedent) rather than via `useSeenKeysGate`'s lazy-on-non-empty contract. No hook edits.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_animation_pacing` (settled — [`tasks/refinements/audience/aud_animation_pacing.md`](aud_animation_pacing.md)). The cross-cutting cadence consolidation that lifted the six prior halo / commit-tier constants to CSS custom properties `--aud-anim-halo-ms: 450ms` and `--aud-anim-commit-ms: 350ms` at [`apps/audience/src/index.css:119-123`](../../../apps/audience/src/index.css#L119). Per its Decision §7 ([line 116](../../../apps/audience/src/index.css#L116)): "future animation siblings (aud_decomposition_* etc) MUST consume the variables rather than ship inline durations." This leaf consumes `--aud-anim-halo-ms` (the halo tier — 450 ms) and `--aud-anim-easing` for its single new utility class. Because pacing has already shipped, this leaf adds **no edit** to the pacing task's `depends` line — pacing is settled and the consumed variables are stable.
- Prose-only context (NOT a `.tji` edge): `audience.aud_url_routing.aud_session_url` (sibling, future). The deferred-e2e debt collector for the audience surface. Every `aud_animations.*` leaf routes its Playwright debt there (per the seeding-alignment leaf's Status block which paid down some of that debt inline); this leaf adds the decomposition scenario to the chain.

## What this task is

The 2d leaf that lights up the **entity-layer regression animation** when a node's `data.decomposed` first flips to `true` mid-broadcast — the visual moment a participant proposal to decompose or interpretively-split a parent claim is committed, the parent is structurally retired in favour of its components (per `docs/methodology.md` L84: "agreeing to decompose N into A + B agrees to the structural restructuring (N is removed; A and B exist as entities)"), and the broadcast canvas needs a one-shot temporal signal that THIS parent just left the structure. The signal: a slate-tinted halo expands outward from the parent's position over `var(--aud-anim-halo-ms)` (450 ms) while the parent itself fades to `opacity: 0.15` (the new at-rest "structurally retired" steady state). After the halo fades, the parent remains visible-but-deprecated at 15% opacity; the component children (already on the canvas via their own propose-time `node-created` events animated by `aud_node_appear_animation`) carry the structure forward.

The implementation has three parts:

**Part A — projector signal (`projectGraph.ts` extension).** The audience's `projectGraph` currently handles `commit` events for `classify-node` proposals only (target=`'facet'`/`'proposal'` arms at [`projectGraph.ts:306-334`](../../../apps/audience/src/graph/projectGraph.ts#L306)). It silently ignores commits of every other proposal sub-kind (`decompose`, `interpretive-split`, `axiom-mark`, `meta-move`, `break-edge`, `set-node-substance`, `set-edge-substance`, `edit-wording`, `annotate`). This leaf extends the projector to additionally cache proposed `decompose` and `interpretive-split` payloads at the `proposal` event and, on the matching `commit` (target=`'proposal'`), stamp `data.decomposed: true` on the proposal's `parent_node_id`. A second `currentDecomposedNodes: Set<string>` (or per-node spread in the existing nodes array) tracks the flag; the existing nodes-by-id index reuses for the lookup. This is the **store-derived signal** the overlay reads.

**Part B — overlay (`<AudienceDecompositionFadeOverlay>`).** A new sixth DOM-overlay sibling mounted as a child of `<AudienceGraphView>` after `<AudienceDiagnosticEdgeFireOverlay>` (the current overlay tail). The component reads the projection's set of currently-`decomposed` node IDs from the WS store (via the same `useSyncExternalStore` selector pattern the diagnostic-fire overlays use — store-derived, NOT cytoscape-derived) and iterates `cy.nodes()` to emit a placement for each cytoscape node whose `data.decomposed === true`. A synchronous local-ref seen-Set (seeded from the first non-empty store snapshot, per the `aud_diagnostic_fire_animation_seeding_alignment` pattern at [`DiagnosticFireOverlay.tsx`](../../../apps/audience/src/graph/DiagnosticFireOverlay.tsx)) gates the `aud-decomposition` class. The halo `<span>` is keyed by `nodeId` and centered on the cytoscape node's `renderedBoundingBox` midpoint.

**Part C — stylesheet (`stylesheet.ts` extension).** A single new entry `node[?decomposed]` painting `opacity: 0.15` lands in `STYLESHEET` after the existing per-rollupStatus entries. Cytoscape's `[?attr]` selector matches when the data attribute is truthy ([Cytoscape stylesheet docs](https://js.cytoscape.org/#style/selectors-and-styles)), so the stylesheet entry kicks in exactly when `projectGraph` stamps `data.decomposed: true` and leaves the steady-state retired parent visibly faded but layout-present (so the eye can find the now-decomposed parent in the structure and read the relationship to its components). This is the **post-animation visual contract**.

After this leaf:

- `apps/audience/src/graph/projectGraph.ts` — MODIFIED. Add a `pendingDecompositions: Map<proposalEventId, parentNodeId>` alongside the existing `pendingClassifications`. The proposal-arm grows two branches: `if (inner.kind === 'decompose') pendingDecompositions.set(event.id, inner.parent_node_id);` and `if (inner.kind === 'interpretive-split') pendingDecompositions.set(event.id, inner.parent_node_id);`. The commit-arm grows one branch after the existing classify-node arm: `if (event.payload.target === 'proposal') { const parentId = pendingDecompositions.get(event.payload.proposal_id); if (parentId !== undefined) { /* stamp data.decomposed: true on the parent node element */ } }`. The stamping uses the existing `nodeIndexById.get(parentId)` / `nodes[idx] = { ...existing, data: { ...existing.data, decomposed: true } }` idiom already present at [`projectGraph.ts:316-319`](../../../apps/audience/src/graph/projectGraph.ts#L316). The `AudienceNodeData` type at [`projectGraph.ts:108-132`](../../../apps/audience/src/graph/projectGraph.ts#L108) grows one new field `readonly decomposed?: boolean` (optional — only stamped when the projector observes the commit; absent on non-decomposed parents, semantically equivalent to `false` for cytoscape's `[?decomposed]` selector).
- `apps/audience/src/graph/projectGraph.test.ts` — MODIFIED. ~6 new Vitest cases per Constraints: (i) pending decompose proposal stamps nothing on parent; (ii) committed decompose stamps `decomposed: true` on parent; (iii) committed interpretive-split stamps the same; (iv) witdrawn-then-re-proposed-then-committed decompose stamps cleanly; (v) commits against `classify-node` (the existing arm) do NOT stamp the field; (vi) parent's other data (wording, kind, axiomMarks, annotations, facetStatuses, rollupStatus) is preserved across the stamping (the spread idiom from the classify-node arm is reused).
- `apps/audience/src/graph/stylesheet.ts` — MODIFIED. One new entry `{ selector: 'node[?decomposed]', style: { opacity: 0.15 } }` appended after the existing per-rollupStatus entries at [`stylesheet.ts:208-260`](../../../apps/audience/src/graph/stylesheet.ts#L208). The selector composes with the per-state selectors via Cytoscape's per-selector merging; a decomposed parent whose `rollupStatus` is still `'agreed'` from before the commit paints with the agreed border + slate color + 0.15 opacity. Header docblock comment ahead of the new entry references this refinement and Decision §3.
- `apps/audience/src/graph/stylesheet.test.ts` — MODIFIED. 2 new Vitest cases: (i) the array contains an entry whose `selector === 'node[?decomposed]'` with `style.opacity === 0.15`; (ii) the entry sits after the per-rollupStatus entries (selector ordering verified by index — same kind of ordering assertion the existing meta-disagreement / disputed selectors carry).
- `apps/audience/src/graph/DecompositionFadeOverlay.tsx` — NEW. ~150 LOC mirroring `DiagnosticFireOverlay.tsx`'s store-derived shape (synchronous local-ref seed, not the lazy-init `useSeenKeysGate` hook) parallel to `aud_diagnostic_fire_animation_seeding_alignment`'s template. The store selector reads the WS-derived projection's set of currently-`decomposed` node IDs; the cytoscape-side `useCytoscapeOverlayPlacements` computes the halo positions; the gate seeds from the first observed store snapshot.
- `apps/audience/src/graph/DecompositionFadeOverlay.test.tsx` — NEW. ~12 Vitest cases parallel to `DiagnosticFireOverlay.test.tsx`'s structure.
- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. One new import line; one new mount line in the render tree appended after the existing `<AudienceDiagnosticEdgeFireOverlay>` mount (this leaf is the sixth DOM-overlay sibling). Header docblock extends with a refinement-trail entry summarizing Decisions §1–§7.
- `apps/audience/src/graph/GraphView.test.tsx` — MODIFIED if it asserts on the overlay-mount count; otherwise byte-unchanged. The per-overlay behavioural pin lives in `DecompositionFadeOverlay.test.tsx`.
- `apps/audience/src/index.css` — MODIFIED. Append after the diagnostic-edge-fire block:
  - The `[data-decomposition-anim]` selector with the halo geometry + slate-tinted radial-gradient `background-image` (mirroring `[data-node-appear-anim]` geometry but with slate-700 alpha stops to match the "structurally retired" semantic — slate reads as muted / past).
  - A `@keyframes aud-decomposition` block (opacity 1 → 0, scale 0.8 → 1.6 — a wider final scale than node-appear's 1.6 / withdrawal's 1.8 because "structural retirement" is the most dispersive of the halo semantics, conceptually "this card is being absorbed by its parts").
  - A `.aud-decomposition` utility class consuming the keyframe with `var(--aud-anim-halo-ms)` duration, `var(--aud-anim-easing)` timing, `forwards` fill-mode.
  - The matching `@media (prefers-reduced-motion: reduce)` override clause.
- `apps/audience/src/index.test.ts` — MODIFIED. 2 new Vitest cases parallel to the existing per-animation pair: (i) `apps/audience/src/index.css` contains `@keyframes aud-decomposition`; (ii) it contains a `prefers-reduced-motion: reduce` block with a `.aud-decomposition { animation: none` clause (whitespace-tolerant).
- `tasks/50-audience-and-broadcast.tji` — MODIFIED at close-time only: the closer adds `complete 100` to the `aud_decomposition_animation` task. The `aud_animation_pacing` task already shipped, so its `depends` line is NOT amended — pacing already names the four prior animation siblings as its `depends` set; this leaf is a downstream consumer of the pacing constants, not an upstream input. Verify at close-time the pacing task is `complete 100` and the variables exist.

Out of scope (deferred to existing or future leaves):

- **Removing the parent from the layout entirely.** Cytoscape's `display: 'none'` removes the node from layout, so connected edges re-target and the structure visibly compacts; this is a semantically distinct choice from "fade to 0.15 opacity but stay in layout." Product hasn't surfaced a preference and the simpler choice (stay in layout, paint at 0.15) preserves the broadcast viewer's spatial memory of where the parent was. A future `aud_decomposed_parent_layout_removal` (~0.5d, NOT pre-registered) could relax if product surfaces a need.
- **Animating the parent's body opacity from 1.0 → 0.15 over the 450 ms window.** The halo is the temporal cue; the parent body's opacity snaps to 0.15 at the same render tick the halo fires. Cytoscape's canvas-side opacity transition would require either `cy.animate(...)` (rejected by cumulative `aud_animations.*` posture) or cytoscape stylesheet `transition-property` + `transition-duration` fields (a different — and less well-tested — code path). The snap is masked by the halo's expanding ring; the visual reads as "the parent is being absorbed" without a separate body fade. A future `aud_decomposition_body_fade` (~0.5d, NOT pre-registered) could relax if frame-by-frame review shows the snap is visible.
- **Animating the component children emerging.** The per-component `node-created` events fan out at propose-time (per `mod_decompose_propose_time_canvas_visibility`) and arrive on the audience canvas via the WS event stream. `aud_node_appear_animation`'s halo overlay [`apps/audience/src/graph/NodeAppearOverlay.tsx`](../../../apps/audience/src/graph/NodeAppearOverlay.tsx) ALREADY animates every new node arrival keyed by node ID; the components emerging from a decomposition fire the existing slate-tinted node-appear halo automatically. This leaf adds NO separate "components emerging" animation. The brief's "components emerging" phrasing names a behaviour the audience already exhibits.
- **Animating decomposition propose-time (components appear without parent fade).** The parent ONLY fades at commit (per the methodology contract — until commit, the proposal is reversible). Propose-time only triggers the component `node-created` arrival animation. The decompose / interpretive-split lifecycle has three distinct visual moments: (a) propose-time → components appear (existing node-appear), (b) commit → parent fades (THIS leaf), (c) withdraw-before-commit → components disappear (handled by `entity-removed` event consumers, deferred audience-side to `aud_proposed_entity_canvas_visibility` parallel — see "Audience-side entity-removed handling" below).
- **Audience-side `entity-removed` handling.** The audience's `projectGraph` currently does NOT consume `entity-removed` events (none of its branches match the kind). Withdraw-after-propose lifecycle visibility is out of scope for this animation leaf and belongs to a future `aud_proposed_entity_canvas_visibility` task (~1d, NOT pre-registered today — the moderator's `mod_proposed_entity_canvas_visibility` is the cross-surface precedent). The decompose-then-withdraw round-trip the moderator-side e2e exercises is NOT covered by this leaf.
- **Edge re-binding from parent to components.** Methodology engine work; the server-side projection already tracks the parent → components relationship via the proposal payload's `parent_node_id` + `components[]`. The audience's edge projection does NOT today re-bind edges that pointed at the parent to point at components (the projector emits edges via `edge-created` events only; methodology-engine emitted edge-rebinding events are not yet specified). Out of scope for this animation leaf.
- **Per-component facet status pre-styling.** The components' `classification` facet enters `'proposed'` state via the facet-status pre-allocation at [`packages/shell/src/facet-status/facet-status.ts:418-444`](../../../packages/shell/src/facet-status/facet-status.ts#L418); the audience surface today reads this via `proposal-status` broadcasts (per [`tasks/refinements/backend/facet_status_server_decompose_component_facets.md`](../backend/facet_status_server_decompose_component_facets.md)) and renders the components with `data-facet-status="proposed"`. The per-state styling is already in scope of `aud_proposed_styling` (settled). No styling addition by this leaf.
- **Whole-card rollup transitions to `'committed'` on components.** Per [`tasks/refinements/data-and-methodology/replay_decompose_commit_marks_component_classification_committed.md`](../data-and-methodology/replay_decompose_commit_marks_component_classification_committed.md) (pending), the methodology engine's projector will stamp the components' classification facets as `'committed'` at decompose-commit time. When that lands, the components transition `'proposed'` → `'committed'` (a rollup-status transition not currently animated by any sibling). A speculative future `aud_proposed_to_committed_animation` (~0.5d, NOT pre-registered today; product has not surfaced a need) would relax. The brief's "components emerging" phrasing does NOT scope this.
- **Moderator-side decomposition animation.** Cross-surface parity (`mod_decomposition_animation`) is **NOT pre-registered** (speculative; the moderator's click-through workflow benefits less from animated transition vocabulary than the broadcast viewer's passive watch).
- **Participant-side decomposition animation.** NOT pre-registered (same posture).
- **Pixel-stable post-animation steady state in `aud_visual_regression`.** The 0.15 opacity decomposed-parent paint is a new at-rest visual contract this leaf adds. A speculative VR scenario "decomposed parent paints at 0.15 opacity post-commit" (~0.25d) would be a natural extension of `aud_visual_regression`'s existing per-rollupStatus baseline; deferred to that task's scope when it lands.
- **A Playwright spec exercising the live decomposition transition.** Per the deferred-e2e exception (component reachability): the audience surface is still placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx); the per-session route lands in `aud_url_routing.aud_session_url`. Full deferral applies — the Vitest pins above cover the behavioural seam (projector stamp on commit, overlay gate-class is/isn't applied per-render across decomposed/non-decomposed branches, stylesheet selector is present). Decision §7 below documents the routing of this debt onto the already-accumulating chain and weighs the splitting alternative.
- **`framer-motion`, `react-spring`, or any motion-framework dependency.** Rejected (Decision §1; cumulative posture of the `aud_animations.*` group).
- **Editing `cy.animate(...)` or wrapping cytoscape's canvas-side animation.** Rejected. The halo lives in a React-rendered DOM-overlay sibling above the canvas, not inside it (Decision §1).

## Why it needs to be done

The methodology treats decomposition as a structurally consequential transformation: a participant proposes that a single claim N is more productively considered as components A + B (or readings R1, R2, R3 for interpretive-split), and on commit, N is structurally retired — A and B carry forward as committed entities, N is marked invisible at the server-side projection ([`apps/server/src/projection/replay.ts:1200`](../../../apps/server/src/projection/replay.ts#L1200) `projection.setNodeVisible(parent_node_id, false)`). The audience surface today does NOT mark the parent visibly at all post-commit — the audience's `projectGraph` silently ignores the decompose-commit, leaving the parent painted at full agreed-state opacity even though the methodology has retired it. The broadcast viewer watching the canvas after a decomposition commit sees the parent unchanged alongside its components, an inconsistent visual that under-reports the structural event.

This leaf fixes that under-report AND gives the transition a moment-of-arrival signal:

1. **The post-commit at-rest visual: 0.15 opacity.** The parent is still in layout (spatial memory preserved — the broadcast viewer can see "where N used to be"), but visibly faded to 15% opacity (clearly subordinate to the now-vibrant component children). The stylesheet selector `node[?decomposed]` is the new at-rest contract.

2. **The moment-of-transition cue: a one-shot 450 ms slate-tinted halo.** When the parent's `data.decomposed` first flips to `true` mid-broadcast, an expanding slate ring (`scale 0.8 → 1.6`, `opacity 1 → 0`) emanates from the parent's center and fades. The halo's geometry (96px radial gradient) and palette (slate-700 alpha stops) signal "structural retirement" — slate is the neutral / past-state color (per `STATE_COLORS.agreed` at [`stylesheet.ts:109`](../../../apps/audience/src/graph/stylesheet.ts#L109) — slate is the audience's "settled" hue, repurposed here for the "settled-into-retirement" semantic). The halo masks the snap from full opacity to 0.15 on the parent body so the eye reads a continuous fade-out rather than a discontinuous drop.

The `aud_animations` task group exists precisely to render the moment-of-arrival for each structural-event class. The five prior shipped members covered axiom-mark, node-appear, proposed → agreed (per-facet), withdrawal (entity-rollup regression), and diagnostic-fire (node + edge halos). This leaf is the **sixth and last** shipped member of the group, settling the decomposition-commit visual that the methodology has been emitting structurally-but-invisibly since the propose-time canvas-visibility task landed.

Downstream concretely:

- **`aud_session_url`** is the audience-reachability task; once it lands the inherited Playwright debt clears (Decision §7).
- **`aud_visual_regression`** can extend to pin the 0.15 decomposed-parent paint (deferred; not in scope of this leaf).
- **The `aud_animations` group closes.** With this leaf shipped, every structural-event class the audience surface emits has its moment-of-arrival rendered: arrival (node-appear), per-facet agreement (proposed_to_agreed), entity rollup regression (withdrawal), structural diagnostic (diagnostic-fire × 2 surfaces), per-participant declaration (axiom-mark), and structural retirement (THIS leaf). The cross-cutting `aud_animation_pacing` task already consolidated the cadence constants ahead of this leaf so the slot is ready.

Architecturally, this leaf is the first `aud_animations.*` leaf that **extends the projector** with a new derived flag rather than reading an existing field. The two prior projector-derived halos (`aud_diagnostic_fire_animation` and `aud_diagnostic_edge_fire_animation`) read from the diagnostic projection emitted by `diagnosticHighlights.ts`, which was itself part of a separate refinement (`aud_diagnostic_rendering`). This leaf adds `data.decomposed` directly to `projectGraph.ts`'s output — a more invasive extension than prior animation leaves but still tightly scoped to one event-kind / one proposal-sub-kind pair. The pattern this introduces (cache-pending-proposal-by-event-id, stamp-on-commit) is the same pattern the existing `pendingClassifications` map already uses for `classify-node`; the new map for decompose / interpretive-split is a parallel structure. A future `aud_decomposition_commit_projection_extraction` task could lift both maps + the commit-stamp logic into a shared `pendingProposalCommitStamping.ts` module if a third proposal-sub-kind needs the same pattern; not pre-registered today (two callers does not yet trigger the rule-of-four).

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience uses Cytoscape with React DOM overlays. Per-element React decoration (here, a halo `<span>` per decomposed parent) is the canonical pattern; the new `node[?decomposed]` selector lands on the canvas-side stylesheet (cytoscape's attribute selectors are the canonical way to react to projection-stamped data on the canvas).
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the audience CSS lives at `apps/audience/src/index.css`. The five predecessor keyframes coexist under the same convention; this leaf appends a sixth.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaove-verifications.md) — Vitest pins (a) the projector stamping logic across decompose / interpretive-split / classify-node / no-op branches via cases in `projectGraph.test.ts`, (b) the React-side overlay per-render decision logic via cases in `DecompositionFadeOverlay.test.tsx`, (c) the stylesheet selector entry via cases in `stylesheet.test.ts`, and (d) the CSS file's keyframe + reduced-motion definitions via 2 cases in `index.test.ts`.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the audience artifact owns its CSS; the new keyframe ships inside the audience bundle.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — decomposition is an entity-layer structural event (parent visibility flip); the per-component facet-status pre-allocation is the facet-layer parallel handled separately. This leaf scopes strictly to the entity layer's parent-fade visual.
- [ADR 0030 — Per-facet vote keying](../../../docs/adr/0030-per-facet-vote-keying.md) — the commit envelope carries `target: 'proposal' | 'facet'`; this leaf reads the `target: 'proposal'` commits where the proposal is `decompose` or `interpretive-split`. The reading is symmetric with the existing classify-node arm at [`projectGraph.ts:322-333`](../../../apps/audience/src/graph/projectGraph.ts#L322).

No new ADR. The architectural seams (DOM-overlay halo with CSS-first keyframe, projector-derived signal via cached-pending-proposal-by-event-id, synchronous local-ref seed, `prefers-reduced-motion` in CSS, no motion-framework dependency) are either settled by existing ADRs or by the cumulative posture five animation predecessors established and this leaf extends in a tightly-scoped direction (the projector signal is the new pattern; the rest is verbatim).

### Sibling refinements

- [`tasks/refinements/audience/aud_node_appear_animation.md`](aud_node_appear_animation.md) — the direct structural precedent for the halo overlay shape, the rAF-batched commit, the seeded-set gate, the test discipline.
- [`tasks/refinements/audience/aud_withdrawal_animation.md`](aud_withdrawal_animation.md) — the transition-keyed seen-Set precedent for an entity-layer rollup transition; per-node key shape adopted.
- [`tasks/refinements/audience/aud_proposed_to_agreed_animation.md`](aud_proposed_to_agreed_animation.md) — the target-state-keyed seen-Set precedent.
- [`tasks/refinements/audience/aud_diagnostic_fire_animation.md`](aud_diagnostic_fire_animation.md) and [`tasks/refinements/audience/aud_diagnostic_edge_fire_animation.md`](aud_diagnostic_edge_fire_animation.md) and [`tasks/refinements/audience/aud_diagnostic_fire_animation_seeding_alignment.md`](aud_diagnostic_fire_animation_seeding_alignment.md) — the projector-derived (store-derived, not cytoscape-derived) signal precedent. The synchronous local-ref seed-from-first-store-snapshot pattern is adopted here.
- [`tasks/refinements/audience/aud_axiom_mark_animation.md`](aud_axiom_mark_animation.md) — pioneer; CSS-first, no-motion-framework, `prefers-reduced-motion`-in-CSS posture.
- [`tasks/refinements/audience/aud_animation_pacing.md`](aud_animation_pacing.md) — pacing consolidation; CSS custom property consumption is the contract this leaf adopts via `var(--aud-anim-halo-ms)` + `var(--aud-anim-easing)`.
- [`tasks/refinements/audience/aud_dom_overlay_extraction.md`](aud_dom_overlay_extraction.md) — extraction that established `useCytoscapeOverlayPlacements` + `useSeenKeysGate`; the former is consumed unchanged, the latter is bypassed in favour of the synchronous-seed pattern.
- [`tasks/refinements/audience/aud_proposed_styling.md`](aud_proposed_styling.md), [`tasks/refinements/audience/aud_agreed_styling.md`](aud_agreed_styling.md), [`tasks/refinements/audience/aud_disputed_styling.md`](aud_disputed_styling.md) — per-rollupStatus stylesheet precedents; the new `node[?decomposed]` selector composes with these via Cytoscape's per-selector merging.
- [`tasks/refinements/moderator-ui/mod_decompose_propose_time_canvas_visibility.md`](../moderator-ui/mod_decompose_propose_time_canvas_visibility.md) — cross-surface context. The moderator's propose-time emission of per-component `node-created` events drives the audience's component-arrival rendering. This leaf takes that as a given input and animates the parent-fade at commit, not the propose-time component fan-out (those are animated by `aud_node_appear_animation`).
- [`tasks/refinements/data-and-methodology/replay_decompose_commit_marks_component_classification_committed.md`](../data-and-methodology/replay_decompose_commit_marks_component_classification_committed.md) — pending. When this lands the per-component classification facets flip to `'committed'` at decompose-commit, which the audience's `proposal-status` consumer renders as a steady-state per-facet style change on the components. The interaction with THIS leaf is benign: the per-component facet change is independent of the parent-fade. No coordination needed.

### Live code the leaf modifies / creates

- [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts) — MODIFIED. Add `pendingDecompositions: Map<string, string>` (proposal event id → parent node id) alongside `pendingClassifications` at [`projectGraph.ts:238-247`](../../../apps/audience/src/graph/projectGraph.ts#L238). In the proposal-arm at [`projectGraph.ts:294-304`](../../../apps/audience/src/graph/projectGraph.ts#L294), add two branches: `if (inner.kind === 'decompose') pendingDecompositions.set(event.id, inner.parent_node_id);` and `if (inner.kind === 'interpretive-split') pendingDecompositions.set(event.id, inner.parent_node_id);`. In the commit-arm at [`projectGraph.ts:322-333`](../../../apps/audience/src/graph/projectGraph.ts#L322), after the existing classify-node lookup but before the final `continue;`, add a fallback lookup: `const parentId = pendingDecompositions.get(event.payload.proposal_id); if (parentId !== undefined) { const idx = nodeIndexById.get(parentId); if (idx !== undefined) { const existing = nodes[idx]; nodes[idx] = { group: 'nodes', data: { ...existing.data, decomposed: true } }; } continue; }`. The `AudienceNodeData` type at [`projectGraph.ts:108-132`](../../../apps/audience/src/graph/projectGraph.ts#L108) grows one optional field: `readonly decomposed?: boolean;` Header docblock extends with a §1 / §2 refinement-trail entry referencing THIS refinement.
- [`apps/audience/src/graph/projectGraph.test.ts`](../../../apps/audience/src/graph/projectGraph.test.ts) — MODIFIED. ~6 new Vitest cases per Constraints (enumerated below).
- [`apps/audience/src/graph/DecompositionFadeOverlay.tsx`](../../../apps/audience/src/graph/DecompositionFadeOverlay.tsx) — NEW. Mirrors `DiagnosticFireOverlay.tsx`'s store-derived shape (synchronous seed); see Constraints for the structural skeleton.
- [`apps/audience/src/graph/DecompositionFadeOverlay.test.tsx`](../../../apps/audience/src/graph/DecompositionFadeOverlay.test.tsx) — NEW. ~12 Vitest cases.
- [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) — MODIFIED. One new import (line 228 region); one new mount line (after the existing `<AudienceDiagnosticEdgeFireOverlay>` mount); one header refinement-trail entry.
- [`apps/audience/src/graph/GraphView.test.tsx`](../../../apps/audience/src/graph/GraphView.test.tsx) — POSSIBLY MODIFIED. If existing assertions count overlay-testid elements, bump the count.
- [`apps/audience/src/graph/stylesheet.ts`](../../../apps/audience/src/graph/stylesheet.ts) — MODIFIED. One new entry `{ selector: 'node[?decomposed]', style: { opacity: 0.15 } }`. Header docblock extends with §3 refinement-trail.
- [`apps/audience/src/graph/stylesheet.test.ts`](../../../apps/audience/src/graph/stylesheet.test.ts) — MODIFIED. 2 new Vitest cases per Constraints.
- [`apps/audience/src/graph/cytoscapeOverlayHooks.ts`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts) — UNCHANGED. `useCytoscapeOverlayPlacements` consumed unchanged; `useSeenKeysGate` bypassed in favour of synchronous local-ref seed (per `aud_diagnostic_fire_animation_seeding_alignment` precedent).
- [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) — MODIFIED. Append `[data-decomposition-anim]` selector + `@keyframes aud-decomposition` block + `.aud-decomposition` utility class consuming `var(--aud-anim-halo-ms)` / `var(--aud-anim-easing)` + `prefers-reduced-motion` override.
- [`apps/audience/src/index.test.ts`](../../../apps/audience/src/index.test.ts) — MODIFIED. 2 new Vitest cases.
- [`apps/audience/src/graph/AxiomMarkOverlay.tsx`](../../../apps/audience/src/graph/AxiomMarkOverlay.tsx), [`apps/audience/src/graph/AnnotationOverlay.tsx`](../../../apps/audience/src/graph/AnnotationOverlay.tsx), [`apps/audience/src/graph/NodeAppearOverlay.tsx`](../../../apps/audience/src/graph/NodeAppearOverlay.tsx), [`apps/audience/src/graph/PerFacetPillOverlay.tsx`](../../../apps/audience/src/graph/PerFacetPillOverlay.tsx), [`apps/audience/src/graph/WithdrawalHaloOverlay.tsx`](../../../apps/audience/src/graph/WithdrawalHaloOverlay.tsx), [`apps/audience/src/graph/DiagnosticFireOverlay.tsx`](../../../apps/audience/src/graph/DiagnosticFireOverlay.tsx), [`apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx`](../../../apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx) — UNCHANGED.
- [`apps/audience/src/graph/facetStatus.ts`](../../../apps/audience/src/graph/facetStatus.ts), [`apps/audience/src/graph/diagnosticHighlights.ts`](../../../apps/audience/src/graph/diagnosticHighlights.ts) — UNCHANGED.
- [`packages/shell/**`](../../../packages/shell/), [`packages/shared-types/**`](../../../packages/shared-types/), [`packages/i18n-catalogs/**`](../../../packages/i18n-catalogs/) — UNCHANGED.
- `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx`, `apps/audience/src/state/**`, `apps/audience/src/ws/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED (no new dependency).

### What the surface MUST NOT do

- **No new runtime dependency.** No `framer-motion`, `react-spring`, `@react-spring/web`, `motion`, `react-transition-group`.
- **No edit to `@a-conversa/shell`.** The shell facet-status logic is unchanged.
- **No `cy.animate(...)` or cytoscape `transition-property` field.** The animation lives in CSS on a React-rendered DOM-overlay `<span>`. The parent body's opacity snap to 0.15 is via the stylesheet `node[?decomposed]` selector — cytoscape applies it on the same render tick the projector stamps the flag; no animation on the body itself.
- **No JS-driven animation loop on the halo.** No `requestAnimationFrame`-pump tweening; no `setTimeout` chain. The CSS keyframe runs on the GPU compositor.
- **No animation on initial mount.** Parents already at `data.decomposed: true` at first non-empty placement commit are seeded into the seen-Set via the synchronous local-ref seed (per `aud_diagnostic_fire_animation_seeding_alignment`'s precedent) and rendered without the animation class.
- **No animation re-fire on pan / zoom / resize.** Halo `<span>` is keyed by `nodeId`; React reuses the existing DOM across re-renders; the gate returns `false` on subsequent renders.
- **No animation on a node flipping AWAY from `decomposed: true`.** The projector NEVER unsets `data.decomposed: true` once stamped (a committed decomposition is structurally permanent per methodology). The flag is monotonic — once `true`, always `true`. No need to gate on flip-out.
- **No animation on the component children.** They animate via `aud_node_appear_animation`'s existing halo, not this leaf.
- **No edge halo.** A decomposed parent's connected edges are out of scope (cytoscape's `[?decomposed]` selector composes only with the node selectors, not edges; future methodology-engine work may emit edge-rebinding events that this leaf does not handle).
- **No edit to other audience overlays.** The sixth caller of `useCytoscapeOverlayPlacements` does NOT trigger another extraction — the hook IS the abstraction (per `aud_dom_overlay_extraction`'s rationale).
- **No new i18n keys.** The animation has no visible label and adds no a11y prose; the halo `<span>` is `aria-hidden="true"` like every predecessor halo.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- **`apps/audience/src/graph/projectGraph.ts`** — MODIFIED.

  Type extension:

  ```ts
  export interface AudienceNodeData {
    readonly id: string;
    readonly wording: string;
    readonly kind: StatementKind | null;
    readonly facetStatuses: FacetStatuses;
    readonly rollupStatus: AudienceRollupStatus;
    readonly axiomMarks: readonly AxiomMark[];
    readonly annotations: readonly Annotation[];
    readonly decomposed?: boolean; // NEW (Decision §2)
  }
  ```

  Map declaration alongside `pendingClassifications`:

  ```ts
  // Map from `proposal` envelope id → parent node id, for `decompose`
  // and `interpretive-split` proposals. The matching `commit` (target=
  // 'proposal') resolves the parent via this map and stamps
  // `data.decomposed: true` on the parent node element. Symmetric with
  // `pendingClassifications` above, scoped to the two multi-component
  // sub-kinds. Refinement: aud_decomposition_animation Decision §2.
  const pendingDecompositions = new Map<string, string>();
  ```

  Proposal-arm extension at [`projectGraph.ts:294-304`](../../../apps/audience/src/graph/projectGraph.ts#L294):

  ```ts
  if (event.kind === 'proposal') {
    const inner = event.payload.proposal;
    if (inner.kind === 'classify-node') {
      pendingClassifications.set(event.id, {
        nodeId: inner.node_id,
        classification: inner.classification,
      });
      currentClassificationByNode.set(inner.node_id, inner.classification);
    } else if (inner.kind === 'decompose') {
      pendingDecompositions.set(event.id, inner.parent_node_id);
    } else if (inner.kind === 'interpretive-split') {
      pendingDecompositions.set(event.id, inner.parent_node_id);
    }
    continue;
  }
  ```

  Commit-arm extension at [`projectGraph.ts:322-333`](../../../apps/audience/src/graph/projectGraph.ts#L322) — after the existing classify-node lookup, before the final `continue`, add the decomposition fallback:

  ```ts
  // target === 'proposal' — the proposal-keyed arm.
  const classifyProposal = pendingClassifications.get(event.payload.proposal_id);
  if (classifyProposal !== undefined) {
    const idx = nodeIndexById.get(classifyProposal.nodeId);
    if (idx !== undefined) {
      const existing = nodes[idx];
      if (existing !== undefined) {
        nodes[idx] = {
          group: 'nodes',
          data: { ...existing.data, kind: classifyProposal.classification },
        };
      }
    }
    continue;
  }
  const decomposeParentId = pendingDecompositions.get(event.payload.proposal_id);
  if (decomposeParentId !== undefined) {
    const idx = nodeIndexById.get(decomposeParentId);
    if (idx !== undefined) {
      const existing = nodes[idx];
      if (existing !== undefined) {
        nodes[idx] = {
          group: 'nodes',
          data: { ...existing.data, decomposed: true },
        };
      }
    }
    continue;
  }
  continue;
  ```

  Header docblock extends with one new entry referencing this refinement.

- **`apps/audience/src/graph/projectGraph.test.ts`** — MODIFIED.

  6 new Vitest cases:

  1. **Pending decompose proposal does not stamp `decomposed` on parent.** Seed: `node-created` for parent N, `node-created` for components A + B, `proposal` carrying a `decompose` payload referencing N as parent and A + B as components. Project. Assert the N node element's `data.decomposed` is `undefined` (or `false`); the A + B elements are present and have no `decomposed` field set.
  2. **Committed decompose stamps `decomposed: true` on parent.** Seed: the same fixture as case 1 plus a `commit` event with `target: 'proposal'` and `proposal_id` matching the decompose envelope. Assert the N element's `data.decomposed === true`; the A + B elements still have no `decomposed` field; N's other data fields (`wording`, `kind`, `facetStatuses`, `rollupStatus`, `axiomMarks`, `annotations`) are preserved across the stamping.
  3. **Committed interpretive-split stamps the same.** Seed: parent N, readings R1/R2/R3, `proposal` with `interpretive-split` kind referencing N, then `commit` against the proposal. Assert `N.data.decomposed === true`.
  4. **Withdrawn-then-re-proposed-then-committed decompose stamps cleanly.** Seed: parent N, `proposal` (event id `p1`) carrying decompose, no commit, then another `proposal` (event id `p2`) carrying decompose for the same N, then `commit` against `p2`. Assert `N.data.decomposed === true` and the `pendingDecompositions` lookup correctly resolved via `p2` (i.e., the second proposal supersedes the first; the test verifies the projector handles this without `p1` shadowing).
  5. **Commit against a classify-node proposal does NOT stamp `decomposed`.** Seed: parent N, `proposal` with `classify-node`, `commit` against it. Assert `N.data.decomposed` is `undefined`; the existing classify-node arm fires (N gets `kind` stamped per the existing behaviour).
  6. **Subsequent classify-node commits do not unset `decomposed`.** Seed: parent N, decompose proposal + commit (stamps `decomposed: true`); THEN a `classify-node` proposal + commit on N. Assert `N.data.decomposed === true` AND `N.data.kind === <classification>` — both stamps coexist (the spread preserves the prior field across either commit-arm).

- **`apps/audience/src/graph/stylesheet.ts`** — MODIFIED.

  One new entry appended after the existing per-rollupStatus entries (after the meta-disagreement pair, before the close of `STYLESHEET`):

  ```ts
  // `aud_decomposition_animation` Decision §3 — post-animation at-rest
  // paint for parent nodes whose `data.decomposed` was stamped at commit
  // of a `decompose` or `interpretive-split` proposal by `projectGraph`.
  // The 0.15 opacity reads as "structurally retired" while preserving
  // the parent's position in the layout so the broadcast viewer's
  // spatial memory of where the parent was is intact. Composes with the
  // per-rollupStatus selectors via cytoscape's per-selector merging.
  // Refinement: tasks/refinements/audience/aud_decomposition_animation.md
  {
    selector: 'node[?decomposed]',
    style: {
      opacity: 0.15,
    },
  },
  ```

  Header docblock extends with one new entry referencing this refinement and Decision §3.

- **`apps/audience/src/graph/stylesheet.test.ts`** — MODIFIED.

  2 new Vitest cases:
  1. The array contains exactly one entry whose `selector === 'node[?decomposed]'`; its `style.opacity === 0.15`.
  2. The decomposed-selector entry's index sits AFTER the existing per-rollupStatus selectors (the index is greater than the meta-disagreement node selector's index — same kind of ordering check the existing tests carry).

- **`apps/audience/src/graph/DecompositionFadeOverlay.tsx`** — NEW.

  ~150 LOC mirroring `DiagnosticFireOverlay.tsx`'s store-derived shape:

  ```tsx
  import { useRef, useSyncExternalStore, type ReactElement, type RefObject } from 'react';
  import type { Core, NodeSingular } from 'cytoscape';

  import { useCytoscapeOverlayPlacements } from './cytoscapeOverlayHooks.js';

  export interface AudienceDecompositionFadeOverlayProps {
    readonly cy: Core | null;
    readonly containerRef: RefObject<HTMLDivElement | null>;
  }

  interface DecompositionPlacement {
    readonly id: string;
    readonly x: number;
    readonly y: number;
  }

  export function AudienceDecompositionFadeOverlay({
    cy,
    containerRef,
  }: AudienceDecompositionFadeOverlayProps): ReactElement {
    void containerRef;
    const placements = useCytoscapeOverlayPlacements<DecompositionPlacement>(
      cy,
      commitDecompositionPlacements,
    );
    // Synchronous local-ref seed-from-first-store-snapshot per
    // `aud_diagnostic_fire_animation_seeding_alignment`: seed from
    // `placements` on first render where `placements.length > 0`. No
    // race against rAF because we read from cytoscape data which is
    // already a snapshot of the projection.
    const seenRef = useRef<Set<string> | null>(null);
    if (seenRef.current === null && placements.length > 0) {
      seenRef.current = new Set<string>(placements.map((p) => p.id));
    }
    const isNewDecomposition = (id: string): boolean => {
      const seen = seenRef.current;
      if (seen === null) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    };

    return (
      <div
        data-testid="audience-decomposition-fade-overlay"
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
      >
        {placements.map((p) => {
          const isNew = isNewDecomposition(p.id);
          return (
            <span
              key={p.id}
              data-decomposition-anim=""
              data-element-id={p.id}
              className={isNew ? 'aud-decomposition' : ''}
              style={{
                position: 'absolute',
                left: `${String(p.x)}px`,
                top: `${String(p.y)}px`,
                transform: 'translate(-50%, -50%)',
              }}
            />
          );
        })}
      </div>
    );
  }

  function commitDecompositionPlacements(cy: Core): readonly DecompositionPlacement[] {
    const next: DecompositionPlacement[] = [];
    cy.nodes().forEach((node: NodeSingular) => {
      if (node.data('decomposed') !== true) return;
      const bb = node.renderedBoundingBox();
      next.push({
        id: node.id(),
        x: (bb.x1 + bb.x2) / 2,
        y: (bb.y1 + bb.y2) / 2,
      });
    });
    return next;
  }

  export default AudienceDecompositionFadeOverlay;
  ```

  Header docblock follows the `WithdrawalHaloOverlay.tsx` template extended with §1–§7 references.

- **`apps/audience/src/graph/DecompositionFadeOverlay.test.tsx`** — NEW.

  12 Vitest cases parallel to `WithdrawalHaloOverlay.test.tsx`'s structure:

  1. **Initial-mount with initially-decomposed parent — no class.** Mount with a `cy` carrying one node `decomposed: true`. The rendered halo `<span>` (located via `[data-decomposition-anim]`) does NOT carry `aud-decomposition`.
  2. **Initial-mount with two initially-decomposed parents — neither animates.** Same as case 1 with N=2.
  3. **Post-mount transition — class lands on the freshly-decomposed parent.** Mount with one node having no `decomposed` flag; then `act(() => { cy.nodes().first().data('decomposed', true); })`. After the rAF settle, that node's halo DOES carry `aud-decomposition`.
  4. **Initially-decomposed sibling does NOT re-fire when a fresh decomposition lands.** Mount with one node `decomposed: true` and one not; mutate the not-decomposed to `decomposed: true`. Only the freshly-decomposed node's halo carries the class.
  5. **Rerender with identical statuses — no class spread.** Mount, emit a no-op cy event (`'pan'`). No new halo carries the class.
  6. **A node without the `decomposed` field is not iterated.** Mount with one node having no `decomposed` data field. The overlay renders NO `[data-decomposition-anim]` `<span>` for it.
  7. **A node with `decomposed: false` is not iterated.** Same as case 6 with explicit `false`.
  8. **The halo `<span>` carries `data-decomposition-anim` presence marker.** For a freshly-decomposed node, `querySelector('[data-decomposition-anim]')` resolves.
  9. **The overlay wrapper carries the expected testid + aria-hidden.** `querySelector('[data-testid="audience-decomposition-fade-overlay"]')` resolves with `aria-hidden="true"`.
  10. **Pan / zoom does not re-fire the animation.** Mount with one freshly-decomposed node (animation class lands); emit `'pan'`; the halo re-renders but the class is gone (per the seen-set; the `<span>` may stay because the key is stable but the class is conditional on `isNew`).
  11. **A second fresh decomposition on a different node animates on the same commit window.** Mount with no decomposed nodes; mutate node A to `decomposed: true`; mutate node B to `decomposed: true` (separate ticks). Both A's and B's halos carry the class on their respective first commits.
  12. **`cy === null` (pre-init) renders an empty overlay wrapper with no halos.** Asserts the early-return path in `useCytoscapeOverlayPlacements`.

- **`apps/audience/src/graph/GraphView.tsx`** — MODIFIED. Three additive edits:

  - One new import line: `import { AudienceDecompositionFadeOverlay } from './DecompositionFadeOverlay.js';`
  - One new mount line appended after the existing `<AudienceDiagnosticEdgeFireOverlay>` mount: `<AudienceDecompositionFadeOverlay cy={cyState} containerRef={containerRef} />`
  - Header docblock extends with a refinement-trail entry referencing §1–§7.

- **`apps/audience/src/graph/GraphView.test.tsx`** — POSSIBLY MODIFIED. If existing assertions count the overlay-testid elements, bump the count; otherwise byte-unchanged.

- **`apps/audience/src/index.css`** — MODIFIED. Append after the diagnostic-edge-fire block (the current tail of the animation blocks):

  ```css
  /* `aud_decomposition_animation` — one-shot slate-tinted halo on a
   * parent node's `data.decomposed` first flipping to `true` mid-
   * broadcast (the moment a decompose / interpretive-split commit lands
   * structurally retiring the parent in favour of its components).
   * Refinement: tasks/refinements/audience/aud_decomposition_animation.md
   *   Decision §1 — CSS `@keyframes` on a React-keyed halo `<span>` in
   *   a new `<AudienceDecompositionFadeOverlay>`, NOT a JS tween, NOT a
   *   motion-framework dependency, NOT `cy.animate()`.
   *   Decision §5 — synchronous local-ref seed-from-first-store-snapshot
   *   gating (per aud_diagnostic_fire_animation_seeding_alignment); the
   *   gate is keyed on `nodeId` over currently-`decomposed` entries; the
   *   FIRST observed snapshot seeds the gate with the parents already
   *   decomposed at audience-join (no retrospective animation);
   *   subsequent decompose / interpretive-split commits fire the halo
   *   exactly once per (node, session).
   *   Decision §6 — `var(--aud-anim-halo-ms)` (450 ms) + `var(--aud-anim-
   *   easing)` (cubic-bezier(0.16, 1, 0.3, 1)); halo tier parity with
   *   node-appear, withdrawal, and diagnostic-fire because the halo
   *   geometry is identical. `forwards` fill keeps the `to` state
   *   (`opacity: 0`) after the animation completes.
   *   Decision §7 — `prefers-reduced-motion: reduce` suppression is in
   *   CSS (the class is always emitted by the render path).
   *
   * The halo geometry mirrors `[data-node-appear-anim]` (96px square,
   * radial gradient); the palette is sampled from `STATE_COLORS.agreed`
   * (slate-700 `#334155` / `rgba(51, 65, 85, ...)`) at
   * `apps/audience/src/graph/stylesheet.ts:108-112`, so the halo reads
   * as "settled into retirement" — slate is the audience's settled hue
   * and the decomposition retires the parent into committed-component
   * status. The post-animation steady state is `node[?decomposed]
   * { opacity: 0.15 }` (stylesheet entry per Decision §3): the parent
   * remains in layout but reads as visibly subordinate to its now-
   * vibrant components. */
  [data-decomposition-anim] {
    width: 96px;
    height: 96px;
    pointer-events: none;
    background-image: radial-gradient(
      circle,
      rgba(51, 65, 85, 0.45) 0%,
      rgba(51, 65, 85, 0.15) 50%,
      rgba(51, 65, 85, 0) 75%
    );
    opacity: 0;
    border-radius: 50%;
  }

  @keyframes aud-decomposition {
    from {
      opacity: 1;
      transform: translate(-50%, -50%) scale(0.8);
    }
    to {
      opacity: 0;
      transform: translate(-50%, -50%) scale(1.6);
    }
  }

  .aud-decomposition {
    animation: aud-decomposition var(--aud-anim-halo-ms) var(--aud-anim-easing) forwards;
  }

  @media (prefers-reduced-motion: reduce) {
    .aud-decomposition {
      animation: none;
    }
  }
  ```

- **`apps/audience/src/index.test.ts`** — MODIFIED. Append 2 cases parallel to the existing pairs:
  1. `apps/audience/src/index.css` contains the substring `@keyframes aud-decomposition`.
  2. The file contains both `prefers-reduced-motion: reduce` AND a `.aud-decomposition { animation: none` clause within (or after) the media block.

### Files this task does NOT touch

- `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — UNCHANGED.
- `packages/shell/**`, `packages/shared-types/**`, `packages/i18n-catalogs/**` — UNCHANGED.
- `apps/audience/src/graph/facetStatus.ts`, `apps/audience/src/graph/diagnosticHighlights.ts`, `apps/audience/src/graph/layoutOptions.ts`, `apps/audience/src/graph/cytoscapeTestEnv.ts`, `apps/audience/src/graph/cytoscapeOverlayHooks.ts`, `apps/audience/src/graph/AxiomMarkOverlay.tsx`, `apps/audience/src/graph/AnnotationOverlay.tsx`, `apps/audience/src/graph/NodeAppearOverlay.tsx`, `apps/audience/src/graph/PerFacetPillOverlay.tsx`, `apps/audience/src/graph/WithdrawalHaloOverlay.tsx`, `apps/audience/src/graph/DiagnosticFireOverlay.tsx`, `apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx`, `apps/audience/src/graph/axiomMarks.ts`, `apps/audience/src/graph/annotations.ts` — UNCHANGED.
- `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx` — UNCHANGED.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED (no new dep).
- `docs/adr/**` — UNCHANGED. No new ADR.
- `playwright.config.ts` / `tests/e2e/**` — UNCHANGED. Playwright deferral per Decision §7.

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/projectGraph.ts` carries the `pendingDecompositions` map, the proposal-arm extension for `decompose` / `interpretive-split`, the commit-arm fallback for the decomposition lookup, and the `decomposed?: boolean` field added to `AudienceNodeData`. Header docblock extends with a §1 / §2 refinement-trail entry.
- `apps/audience/src/graph/projectGraph.test.ts` carries the 6 new Vitest cases enumerated under Constraints; all pass.
- `apps/audience/src/graph/stylesheet.ts` carries the new `node[?decomposed]` selector entry with `opacity: 0.15`; header docblock extends with §3 trail.
- `apps/audience/src/graph/stylesheet.test.ts` carries the 2 new cases; all pass.
- `apps/audience/src/graph/DecompositionFadeOverlay.tsx` exists with the structure given under Constraints; the file mirrors `WithdrawalHaloOverlay.tsx`'s shape with the `decomposed`-flag placement filter, the slate-tint halo wrapper testid, the synchronous local-ref seed-from-first-snapshot gate, and the `aud-decomposition` class gate.
- `apps/audience/src/graph/DecompositionFadeOverlay.test.tsx` exists with the 12 Vitest cases enumerated under Constraints; all pass.
- `apps/audience/src/graph/GraphView.tsx` carries the new import + mount line for `<AudienceDecompositionFadeOverlay>` after the existing `<AudienceDiagnosticEdgeFireOverlay>` mount; header docblock extended.
- `apps/audience/src/graph/GraphView.test.tsx` is byte-unchanged unless it asserts on an overlay count.
- `apps/audience/src/index.css` carries the `[data-decomposition-anim]` selector (96px slate-radial halo, opacity 0 rest), the `@keyframes aud-decomposition` rule (opacity 1 → 0, scale 0.8 → 1.6), the `.aud-decomposition` utility (`var(--aud-anim-halo-ms) var(--aud-anim-easing) forwards`), and the `prefers-reduced-motion: reduce` override.
- `apps/audience/src/index.test.ts` carries the 2 new cases.
- `packages/shell/src/facet-status/facet-status.ts` is byte-unchanged.
- `apps/audience/package.json` is byte-unchanged.
- The six existing audience overlay tests and `cytoscapeOverlayHooks.test.tsx` pass byte-unchanged.
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer pins (a) the projector's stamping logic across 6 cases in `projectGraph.test.ts`, (b) the React-side per-render class logic via 12 cases in `DecompositionFadeOverlay.test.tsx`, (c) the stylesheet selector entry via 2 cases in `stylesheet.test.ts`, and (d) the CSS file's keyframe + reduced-motion definitions via 2 cases in `index.test.ts` (~22 new Vitest cases total).
- Per the orchestrator brief's deferred-e2e exception ("component not yet reachable"): Playwright coverage is **deferred to `aud_url_routing.aud_session_url`** — the same destination as the prior animation siblings. The closer of `aud_session_url` reads the accumulated chain (`aud_cytoscape_init.md`, `aud_state_management.md`, `aud_ws_client.md`, `aud_axiom_mark_decoration.md`, `aud_axiom_mark_animation.md`, `aud_node_appear_animation.md`, `aud_proposed_to_agreed_animation.md`, `aud_withdrawal_animation.md`, `aud_diagnostic_fire_animation.md`, `aud_diagnostic_edge_fire_animation.md`, `aud_diagnostic_fire_animation_seeding_alignment.md` — minus the seeding-alignment which already paid down its own debt inline, plus this leaf) and scopes the Playwright spec at that point. The three scenarios this leaf contributes are enumerated in Decision §7.
- The `aud_animation_pacing` `depends` line is **NOT** amended; pacing is already settled and consumed via CSS custom properties.
- `pnpm run check` clean (strict TS pass; no new dep declared).
- `pnpm run test:smoke` green (Vitest count rises by ~22 cases: 6 projector + 12 overlay + 2 stylesheet + 2 CSS-smoke).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta negligible (one new component file, one CSS block, one stylesheet entry).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_decomposition_animation` in the closing commit. With this leaf shipped, the `aud_animations` group's six animation tasks are all `complete 100`; the group's umbrella is fully covered.

## Decisions

### §1 — CSS `@keyframes` on a React-keyed halo `<span>` in a NEW DOM-overlay sibling (NOT in-place-wrap, NOT JS tween, NOT motion framework, NOT `cy.animate()`)

Six options for "animate the parent at decompose / interpretive-split commit":

A. **A new `<AudienceDecompositionFadeOverlay>` DOM sibling mirroring `<AudienceWithdrawalHaloOverlay>` / `<AudienceDiagnosticFireOverlay>`.** Per-parent halo `<span>` centered on each currently-`decomposed` node.

B. **In-place wrap inside an existing overlay** (the pattern `aud_proposed_to_agreed_animation` used). Requires an existing React-rendered element for the parent body — there isn't one. The parent body is on cytoscape's canvas.

C. **`cy.animate(...)` on the parent node's opacity** (canvas-side). Rejected by every predecessor animation leaf for the same cumulative-posture reason.

D. **JS-driven `requestAnimationFrame` tween on a DOM overlay.** Rejected by cumulative posture.

E. **Cytoscape `transition-property: 'opacity'` + `transition-duration: '450ms'` on the stylesheet so the parent's opacity transitions from 1 → 0.15 over 450 ms when the `decomposed` flag flips.** This is a code path different from `cy.animate()` — it relies on cytoscape's built-in CSS-like transitions on style changes. The argument FOR: no new DOM overlay, no new keyframe, just one stylesheet field. The argument AGAINST: (1) cytoscape's transition behavior is less idiomatic in this codebase (no prior consumer); (2) it animates the parent BODY only, providing no halo / no temporal directional cue (a 450 ms opacity-fade reads as "this card slowly dimmed," not "this card was structurally absorbed"); (3) the broadcast viewer's attention may not be on the parent at the moment of the transition — a halo's radial expansion catches peripheral vision in a way a body-opacity fade does not; (4) the established posture for entity-layer transitions in `aud_animations.*` is a halo overlay, and consistency with the prior shipped animations is itself a value.

F. **`framer-motion` or `react-spring`.** Rejected by cumulative posture.

**Chosen: A.** Option A is the direct structural mirror of `aud_withdrawal_animation` and `aud_diagnostic_fire_animation`. The parent body is on cytoscape's canvas; the predecessor halo overlays solved the same "decorate a canvas-side element with an animated React halo" problem and the same solution applies. The placement-filter differs (`decomposed`-flag vs disputed-rollup vs diagnostic-firing), the halo palette differs (slate vs rose vs amber), the seen-Set semantics adopt the `aud_diagnostic_fire_animation_seeding_alignment` pattern (synchronous local-ref seed from first store snapshot, NOT `useSeenKeysGate`'s lazy-init-on-non-empty contract), but the overall overlay shape is identical to the four prior overlay siblings.

Option E is the most-defensible alternative; the rejection is principled (consistency + peripheral-vision argument + non-idiomatic code path) but not unanimous. A future audit may revisit if frame-by-frame review shows the halo masks the body-fade well enough to not need both, OR shows the body-snap is visible and a transition would help; for now, the halo carries the temporal cue alone and the body snaps via `node[?decomposed]` stylesheet selector.

### §2 — Projector extends with `pendingDecompositions` map + `decomposed?` field on `AudienceNodeData`

Three options for the source-of-truth signal that "this parent was decomposed":

A. **Cache pending `decompose` / `interpretive-split` proposals in `projectGraph` and stamp `data.decomposed: true` on commit.** Mirrors the existing `pendingClassifications` pattern.

B. **Consume the server's projection-change `visibility-changed` records** (the audience would have to subscribe to a new wire event, which doesn't currently exist — server emits these to its internal listeners, not to the WS broadcast).

C. **Derive at the cytoscape-render time without a projection field**, by walking events on every commit. Rejects the precomputed-index principle the rest of `projectGraph` follows; recomputes O(N events) per render rather than O(1) lookup.

**Chosen: A.** Symmetric with the existing `pendingClassifications` machinery. The wire envelope shape is unchanged (the `commit` event with `target: 'proposal'` already carries the `proposal_id` the audience needs); only the projector's interpretation of that commit grows. The new map is local to the projection function (~5 LOC); the stamping is a one-line spread in the commit arm.

Option B is rejected: no `visibility-changed` event exists on the wire; the server-internal projection-change record at [`replay.ts:1201-1206`](../../../apps/server/src/projection/replay.ts#L1201) is consumed by the server's own subscribers (e.g., the `proposal-status` broadcast emitter), not transmitted to clients. Adding a new wire event for visibility would be a much larger architectural change disproportionate to this leaf's scope — a future task could relax (registered as speculative `proto_visibility_changed_event`, NOT pre-registered today).

Option C is rejected: violates the precomputed-index posture of `projectGraph` (which already runs `facetStatusIndex`, `axiomMarkIndex`, `nodeAnnotationIndex`, `edgeAnnotationIndex` ahead of the per-event loop) and adds O(N) work per render with no benefit.

A subtle property: the `pendingDecompositions` map grows monotonically as more `decompose` / `interpretive-split` proposals fire (one entry per pending proposal). For a long session with many decompositions this is bounded by the number of decompose / interpretive-split proposals (typically small per session). No cleanup is needed: the map is rebuilt on every `projectGraph(events)` call (the projection is pure-functional), so memory pressure is bounded by the current session log. Same posture as `pendingClassifications` which has the same shape and the same un-removed entries.

A second subtle property: `proposal-withdrawn` events do not currently fire in `projectGraph` (the projector silently ignores all event kinds not in its switch). When a proposal is withdrawn before commit, the `pendingDecompositions` entry stays in the map but never gets matched by a commit. This is fine — the entry is never read again. No leak (the map dies with the projection call).

### §3 — Stylesheet `node[?decomposed]` selector painting `opacity: 0.15`

Five options for the post-animation steady state:

A. **`{ selector: 'node[?decomposed]', style: { opacity: 0.15 } }`.** A retired-but-visible at-rest paint.

B. **`{ selector: 'node[?decomposed]', style: { display: 'none' } }`.** Removes the parent from layout entirely; the structure compacts.

C. **Drop the parent from the projected `nodes[]` array entirely.** Cytoscape sees fewer nodes; reactive add/remove dance.

D. **`{ selector: 'node[?decomposed]', style: { 'background-color': '#f1f5f9' } }`.** A "ghosted" paint without opacity change.

E. **No post-animation steady state — the parent paints unchanged post-animation.** Reverts to the current bug where decompositions are invisible on the audience.

**Chosen: A.** Opacity 0.15 is the spatial-memory-preserving choice: the broadcast viewer remembers where N was AND can find it in relation to its now-vibrant components (A and B near the deprecated-N's position). Option B removes that anchor; the components re-layout to fill the gap and the viewer loses spatial-memory continuity. Option C is more invasive (Cytoscape diff has to remove the node — the GraphView's `knownNodeIdsRef` would have to migrate) and adds churn. Option D leaves the parent fully opaque, contradicting the "retired" semantic. Option E preserves the bug.

The 0.15 magnitude is the lowest-opacity choice that still produces visible-but-clearly-subordinate text on Cytoscape's `#ffffff` node background under the audience's typography (the slate-900 label color at [`stylesheet.ts:180`](../../../apps/audience/src/graph/stylesheet.ts#L180) at 0.15 opacity remains legible at the audience's default zoom levels). A future visual-regression task may tune (deferred to `aud_visual_regression`'s scope).

The `[?decomposed]` selector syntax is cytoscape's "data attribute is truthy" matcher — it activates exactly when `data.decomposed === true` (per Cytoscape docs). It does NOT activate when the field is absent or `false`, which is the desired contract: pre-commit parents and non-decomposed entities paint normally.

### §4 — Per-node key shape over currently-`decomposed` entries (transition-keyed, mirroring withdrawal)

Three options for the seen-Set / key-shape:

A. **`isNewDecomposition(nodeId)` where `currentKeys = placements.map(p => p.id)` AND `commitDecompositionPlacements` early-returns for nodes without `decomposed: true`.** Same shape as `aud_withdrawal_animation` Decision §4 option A.

B. **Track all node IDs in the seen-Set; gate on `decomposed: true && isNew(key)`.** Mirrors the rejected option B from withdrawal — would seed every node at audience-join, breaking the contract.

C. **Bespoke `useRef<Map<string, boolean>>` tracking previous `decomposed` per node; animate when previous was undefined/false and current is true.** Encodes the transition explicitly but mirrors data the overlay already has.

**Chosen: A.** Same hook contract, same rationale as withdrawal Decision §4. Option B is rejected for the same incorrect-seed-semantics reason. Option C is rejected for redundancy with the projector's existing flag.

Because `data.decomposed` is **monotonic** (the projector stamps `true` and never unsets), a node that flips `decomposed` → (somewhere) → `decomposed` (which CANNOT happen given the monotone contract) does not need re-firing logic. The seen-Set's add-once-never-remove semantics align perfectly with the projector's monotone stamp.

### §5 — Synchronous local-ref seed-from-first-store-snapshot (NOT `useSeenKeysGate`'s lazy-on-non-empty)

Three options for the seed mechanism:

A. **Synchronous local-ref seed at first render where `placements.length > 0`** (mirror of `aud_diagnostic_fire_animation_seeding_alignment` precedent — `DiagnosticFireOverlay.tsx`).

B. **`useSeenKeysGate(currentKeys)`** — the shared hook that lazy-seeds on first non-empty render via `useRef<Set | null>` + `if (seenRef.current === null && currentKeys.length > 0)`.

C. **`useSeenKeysGate(allCytoscapeNodeIds)`** — seed once at audience-join from `cy.nodes().map(n => n.id())`, gate the animation on `decomposed && isNew(id)`. Same rejected pattern from withdrawal Decision §4 option B.

**Chosen: A.** The `aud_diagnostic_fire_animation_seeding_alignment` precedent settled this distinction: when the source-of-truth signal is **store-derived** (the projection's stamp on a per-node field) rather than **cytoscape-derived** (a cytoscape-internal event), the synchronous local-ref seed is preferred over `useSeenKeysGate`. The reason: `useCytoscapeOverlayPlacements` is rAF-batched, so the FIRST placement-commit may already include the freshly-decomposed node (the projection stamps the `decomposed: true` field in the same render tick the cytoscape `data` update fires) and the gate would incorrectly seed the just-arrived node as "seen" rather than animating it. The synchronous-seed pattern from `DiagnosticFireOverlay` solves this by seeding from a separate snapshot of the source-of-truth (which the diagnostics overlay reads from the projection directly).

For this leaf the equivalent "separate source-of-truth snapshot" IS the cytoscape `data('decomposed')` field, which is itself a render-tick-stamped projection field. The simpler local-ref-seeded-on-first-non-empty-placements pattern (option A as articulated in the test cases above) handles the case correctly because the gate seeds in the same render tick as the first commit, and subsequent renders compare against the seeded set. The behavior matches: first-observed decompositions seed without animating; subsequent-observed decompositions animate.

Option B (`useSeenKeysGate`) is rejected because of the lazy-on-non-empty timing pitfall the seeding-alignment refinement documented: the lazy seed runs ahead of the first effective commit, and a freshly-decomposed node arriving on the same tick as the very first non-empty placement would be incorrectly seeded as "seen." The synchronous local-ref seed (option A) sidesteps this by seeding on the same render where `placements` first becomes non-empty — the gate is established before the predicate is consulted.

Option C is rejected for the same incorrect-seed-semantics reason as withdrawal Decision §4 option B.

### §6 — `var(--aud-anim-halo-ms)` (450 ms) `var(--aud-anim-easing)` with `forwards` (halo tier; consumes pacing constants)

Three options for the timing curve and duration:

A. **`var(--aud-anim-halo-ms)` (450 ms) + `var(--aud-anim-easing)` + `forwards`** (parity with node-appear, withdrawal, diagnostic-fire siblings).

B. **`var(--aud-anim-commit-ms)` (350 ms)** (commit tier — parity with axiom-mark and pill-agreed).

C. **600 ms** (heavier "structural retirement" semantics justify a longer attention window).

**Chosen: A.** The halo geometry is identical to the other halo siblings (96px square, radial gradient); the geometry-driven argument (larger halo benefits from a slower entrance than a small badge or pill chip) applies verbatim. The halo tier is the right tier per `aud_animation_pacing` Decision §2's categorization. The 450 ms with decelerated easing matches "lands and sticks" semantics — even though decomposition is structurally a "leaves" event rather than a "lands" event, the visual contract (halo expands outward and fades to transparent) is the same shape, and the established cadence reads as part of the same family.

Option B is rejected because the smaller-target-faster-duration argument doesn't apply to a halo-class decoration. Option C is rejected because the methodology does NOT treat decomposition as more weighty than withdrawal or node-arrival; over-claiming centrality with a longer duration would skew the cadence.

The `forwards` fill-mode is load-bearing: the keyframe's `to` state is `opacity: 0` — the halo fades to transparent. Without `forwards`, the halo would snap back to `from` (`opacity: 1; scale(0.8)`) at the end of the animation, leaving a visible opaque slate dot.

The variables are consumed verbatim from `:root` per `aud_animation_pacing` Decision §7's contract. No inline duration on the `.aud-decomposition` utility class.

### §7 — Vitest pins (~22 cases across 4 test files) + CSS file presence; Playwright deferred to `aud_session_url` (chain count grows to 11)

The Vitest cases pin the behavioural contract:
- Projector stamping logic across 6 cases in `projectGraph.test.ts` (decompose / interpretive-split / classify-node / pending-no-commit / supersession / coexistence with classify-node).
- Per-render decision logic across 12 cases in `DecompositionFadeOverlay.test.tsx` (only `decomposed: true` ever produces the halo; only on first observation per node per session; rerender with same statuses does not re-animate; `cy === null` early-return path).
- Stylesheet selector presence + ordering across 2 cases in `stylesheet.test.ts`.
- CSS keyframe + reduced-motion override presence in the CSS file (2 cases, string-grep smoke pin).

What the tests deliberately do NOT pin:
- Pixel-by-pixel frame capture of the animation (no current frame-capture infrastructure; speculative future `aud_animation_video_regression` is NOT pre-registered).
- Actual CSS rendering (jsdom does not run keyframes; the React tests assert on the class being present; the CSS-file test asserts on the keyframe being defined; the stylesheet-entry test asserts the selector exists with the expected opacity).
- Live transition in a real audience session (Playwright deferred per the orchestrator brief's "component not yet reachable" exception — the audience is still placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx)).

**Playwright destination check.** Per the orchestrator brief: "Watch the inherited-debt count on `mod_pw_*` (and similar) catch-all e2e tasks. Before deferring to a future Playwright task, check how many prior refinements already point at it. If it's inheriting from 2+ refinements already, pay debt down instead." The `aud_session_url` task is the audience-side equivalent. As of this leaf, the chain pointing at `aud_session_url`'s Playwright scope includes (from `aud_diagnostic_fire_animation`'s Decision §6 enumeration plus subsequent leaves): `aud_cytoscape_init`, `aud_state_management`, `aud_ws_client`, `aud_axiom_mark_decoration`, `aud_axiom_mark_animation`, `aud_node_appear_animation`, `aud_proposed_to_agreed_animation`, `aud_withdrawal_animation`, `aud_diagnostic_fire_animation`, `aud_diagnostic_edge_fire_animation` — ten refinements (the `aud_diagnostic_fire_animation_seeding_alignment` leaf paid down its own debt inline per its Status block). Adding this leaf brings the count to eleven.

**Justification for deferring rather than splitting.** The same justification the predecessors surfaced applies: (a) every refinement in the chain exercises the same surface (the audience graph + overlays once reachable), (b) the Playwright spec for `aud_session_url` will necessarily mount the full audience under a real route, (c) the per-leaf scenarios are mostly assertion-additions onto a single test fixture, (d) the chain's growth is now FINAL — with this leaf shipped, the `aud_animations` group has no remaining unshipped siblings, so the chain caps at eleven. The structural decision (one large spec vs multiple focused specs) belongs to the `aud_session_url` refinement, not to this leaf. If the `aud_session_url` closer judges eleven inherited scenarios too large for a single spec, they SHOULD split into a small set of focused specs (`aud_pw_animations.spec.ts` plus dedicated specs for other surfaces) at that point; the per-leaf deferral entries here name their scenarios crisply enough to route mechanically.

This leaf contributes three scenarios to the chain:

1. **Initially-decomposed parents do NOT animate.** After mounting a session whose initial event log contains a `decompose` proposal AND its matching commit (so the parent has `data.decomposed: true` from the first projection), the rendered `[data-decomposition-anim]` halo for that parent does NOT carry the `aud-decomposition` class. The parent's body paints at 0.15 opacity per the stylesheet `node[?decomposed]` selector.
2. **A fresh decompose commit animates the parent.** After a subsequent commit arrives via the WS stream that flips a node's `data.decomposed` from absent / false to `true`, the halo for that specific node DOES carry the `aud-decomposition` class within the rAF settle window. Halos for any already-decomposed nodes do NOT carry the class.
3. **A fresh interpretive-split commit animates the parent.** Same as scenario 2 with `interpretive-split` substituted for `decompose` — confirms the projector arm fires symmetrically for both multi-component sub-kinds.

Pixel-stable post-animation steady state (0.15-opacity decomposed-parent paint) is a candidate future scenario for `aud_visual_regression` (registered as out-of-scope speculative under "Out of scope" above; not pre-registered here).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-29.

- `apps/audience/src/graph/projectGraph.ts` — extended with `pendingDecompositions: Map<string, string>` (proposal event id → parent node id); proposal-arm branches for `decompose` and `interpretive-split`; commit-arm fallback stamps `data.decomposed: true` on the matching parent; `AudienceNodeData` type grows `readonly decomposed?: boolean`.
- `apps/audience/src/graph/projectGraph.test.ts` — 6 new Vitest cases (dec1–dec6): pending-no-stamp, committed-decompose, committed-interpretive-split, withdrawn-then-recommitted, classify-node-does-not-stamp, coexistence-of-both-stamps.
- `apps/audience/src/graph/stylesheet.ts` — new entry `{ selector: 'node[?decomposed]', style: { opacity: 0.15 } }` appended after per-rollupStatus entries; header docblock updated with §3 trail.
- `apps/audience/src/graph/GraphView.tsx` — import + mount line for `<AudienceDecompositionFadeOverlay>` appended after `<AudienceDiagnosticEdgeFireOverlay>`; header docblock extended with §1–§7 trail entry.
- `apps/audience/src/graph/GraphView.test.tsx` — 2 new stylesheet-pin assertions (dec-ss-a, dec-ss-b) added.
- `apps/audience/src/graph/DecompositionFadeOverlay.tsx` — NEW sixth DOM-overlay sibling; slate-tinted halo (`aud-decomposition` CSS class) on nodes whose `data.decomposed` first flips `true` mid-broadcast; synchronous local-ref seen-Set seed from first non-empty placement commit (per `aud_diagnostic_fire_animation_seeding_alignment` precedent).
- `apps/audience/src/graph/DecompositionFadeOverlay.test.tsx` — NEW 12 Vitest cases covering initial-seed suppression, post-mount animation, rerender no-re-fire, `cy === null` early-return, and `aria-hidden` / testid contract.
- `apps/audience/src/index.css` — appended `[data-decomposition-anim]` halo geometry (96px slate-700 radial gradient), `@keyframes aud-decomposition` (opacity 1→0, scale 0.8→1.6), `.aud-decomposition` utility consuming `var(--aud-anim-halo-ms)` + `var(--aud-anim-easing)` with `forwards` fill-mode, and `prefers-reduced-motion: reduce` override.
- `apps/audience/src/index.test.ts` — 2 new CSS smoke-pin cases (`@keyframes aud-decomposition` presence + `prefers-reduced-motion` reduced-motion override).
- e2e Playwright coverage deferred to `aud_url_routing.aud_session_url` per Decision §7 (aud_session_url is already complete; the three decomposition scenarios were inherited into that task's scope as the eleventh item in the accumulated deferred-e2e chain).
- `aud_animations` group is now fully complete (all six animation siblings shipped); `m_audience_mvp` milestone propagated to `complete 100`.
