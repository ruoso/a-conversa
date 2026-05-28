# Audience per-facet state visualization (a row of `<FacetPill>` chips inside the node card, painted as a DOM-overlay sibling of the Cytoscape canvas)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_graph_rendering.aud_per_facet_visualization` (lines 212-216).
**Effort estimate**: 2d
**Inherited dependencies**:

- `!audience.aud_graph_rendering.aud_proposed_styling` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_proposed_styling.md`](aud_proposed_styling.md)). The Decision §1 emission of `data.facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>` AND `data.rollupStatus: FacetStatus | 'none'` onto every projected element is the data carrier this leaf reads. Without the per-facet record stamped at projection time, the overlay would have nothing to iterate.
- `!audience.aud_graph_rendering.aud_agreed_styling` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_agreed_styling.md`](aud_agreed_styling.md)). The slate-700 (`#334155`) agreed-state palette and the cross-surface visual contract this leaf inherits inside the pill (`border-solid border-slate-700 text-slate-700`).
- `!audience.aud_graph_rendering.aud_disputed_styling` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_disputed_styling.md`](aud_disputed_styling.md)). The rose-600 (`#e11d48`) disputed-state palette and the ring-halo cross-surface contract this leaf inherits inside the pill (`border-solid border-rose-600 text-rose-700 ring-1 ring-rose-500`).
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_cytoscape_init` (settled). Decision §8 there established the `cyRef?: (cy: Core | null) => void` observability seam already wired through `<AudienceGraphView>` at [`apps/audience/src/graph/GraphView.tsx:146`](../../../apps/audience/src/graph/GraphView.tsx#L146); this leaf reuses that callback shape to lift the `Core` handle into a `useState` slot inside `<AudienceGraphView>` so the new overlay sibling can subscribe to Cytoscape events. Decision §2 (module-scope stylesheet) is unaffected — this leaf does NOT modify `STYLESHEET`.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_layout_engine` (settled — [`tasks/refinements/audience/aud_layout_engine.md`](aud_layout_engine.md)). The 200×80 node box (Decision §4) is the geometry the pill row anchors to; the pill row sits ABOVE the node bounding box (at `renderedBoundingBox().y1 - PILL_ROW_OFFSET_Y`) and centers via `translateX(-50%)`.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_stylesheet_module_extraction` (settled — [`tasks/refinements/audience/aud_stylesheet_module_extraction.md`](aud_stylesheet_module_extraction.md)). The stylesheet now lives in `./stylesheet.ts`; this leaf does NOT touch it (the per-facet detail is a DOM-overlay concern, not a Cytoscape-selector concern — Decision §1 below).
- Prose-only context (NOT a `.tji` edge): `moderator_ui.mod_graph_rendering.mod_per_facet_state_visualization` (settled — shipped 2026-05-11, [`tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md`](../moderator-ui/mod_per_facet_state_visualization.md)). The cross-surface precedent for the pill-row design: same `wording → classification → substance` reading order, same per-status visual vocabulary, same "additive, the whole-card rollup stays" posture. The `<FacetPill>` component the moderator built was lifted into `@a-conversa/shell` (`packages/shell/src/facet-pill/FacetPill.tsx`) and is the same component this leaf consumes — verbatim, no per-surface variant.
- Prose-only context (NOT a `.tji` edge): `participant_ui.part_per_facet_state_styling` (settled). Decision §6 there documents the participant's three-options analysis for landing per-facet detail on a Cytoscape canvas (per-node DOM overlay / `cytoscape-node-html-label` plugin / detail-panel deferral) and chose option (c) — detail-panel deferral — because the participant tablet has a tap-to-detail React surface (`part_entity_detail_panel`) that hosts the moderator's `<FacetPill>` vocabulary directly. **The audience inverts this conclusion** (Decision §1 below): the broadcast surface has no detail panel, no tap interaction, and the per-facet detail must land ON the broadcast canvas itself; the participant's rejected option (a) — DOM overlay — is the right fit here because the audience need is different.
- Prose-only context (NOT a `.tji` edge): `participant_ui.part_other_vote_indicators_canvas_dots` (settled — [`apps/participant/src/graph/OtherVotesOverlay.tsx`](../../../apps/participant/src/graph/OtherVotesOverlay.tsx)). The proven DOM-overlay pattern this leaf mirrors: positioning ancestor (`position: relative` div), absolute-positioned sibling overlay (`pointer-events-none absolute inset-0`), rAF-batched commit pumped by `cy.on('render pan zoom resize', cb)` + `cy.on('position', 'node', cb)` + `cy.on('add remove data', cb)`, `renderedBoundingBox()` for node coords. The audience overlay is a verbatim transposition of this pattern with `<FacetPill>` instead of vote dots and the anchor flipped from "below the node" to "above the node".

## What this task is

The 2d leaf that lands the **per-facet detail layer** on the audience broadcast canvas — a row of three `<FacetPill>` chips painted just above every node card, mirroring the moderator's in-card pill row. Each pill carries one facet's localized name label (`Wording` / `Classification` / `Substance`) and one of the seven `FacetStatus` visual treatments (proposed dashed-slate, agreed solid-slate-700, disputed rose-600 + ring, meta-disagreement violet-600 + double, committed solid-slate-400 + opacity-90, withdrawn dashed-slate-400 + opacity-50, awaiting-proposal dashed-slate-400). The whole-card rollup paint (proposed / agreed / disputed selectors in `STYLESHEET`) stays as the "scan the canvas" signal; the pill row is the "look at this card" detail.

Because the audience renders to a Cytoscape `<canvas>` and there is no React tree per node, the pill row CANNOT live inside the node card the way the moderator's does (ReactFlow's custom `<StatementNode>` is a React DOM subtree; Cytoscape's nodes are pixels). The pill row lands as a **DOM-overlay sibling** of the Cytoscape mount — an absolutely-positioned `<div>` layered on top of the canvas, with one positioned pill-row child per node whose `data.facetStatuses` record is non-empty. The overlay subscribes to the Cytoscape `Core`'s pan / zoom / render / position / add-remove-data events and re-paints (rAF-batched) so the pill rows track each node's screen position as the viewport moves.

This leaf is the **fifth** state-styling sibling under `aud_graph_rendering` (after `aud_proposed_styling`, `aud_agreed_styling`, `aud_disputed_styling`, and the stylesheet-extraction housekeeping) and the first to introduce a DOM-overlay surface on the audience workspace. The pattern lift from the participant's `OtherVotesOverlay` is direct: same positioning-ancestor wrapper, same `pointer-events-none` posture, same rAF-batched subscription set, same `renderedBoundingBox()` anchor — only the per-element content differs (a flex-row of three pills instead of a flex-row of vote dots).

After this leaf:

- A new file `apps/audience/src/graph/PerFacetPillOverlay.tsx` lands. A React component taking `{ cy: Core | null; containerRef: RefObject<HTMLDivElement | null> }` (mirrors `OtherVotesOverlayProps` shape). Subscribes to `cy.on('render pan zoom resize', …)` + `cy.on('position', 'node', …)` + `cy.on('add remove data', …)` with a singleton-rAF-handle batched commit; renders one `<div data-facet-pill-row data-element-id="<id>">` per node whose `data.facetStatuses` record is non-empty, each containing up to three `<FacetPill>` children iterated in canonical order (`wording → classification → substance`).
- A new file `apps/audience/src/graph/PerFacetPillOverlay.test.tsx` lands. Vitest cases mirror the moderator's `StatementNode.test.tsx` describe block coverage (empty record omits the row; single proposed pill renders; three pills in canonical order; mixed-status pills render independently; rollup-frame is unaffected) PLUS the participant's `OtherVotesOverlay.test.tsx` overlay-mount coverage (mount with no elements emits no rows; pan/zoom event re-commits placements; rAF batching drops re-entrant scheduling within the same frame).
- `apps/audience/src/graph/GraphView.tsx` is modified: the single-div return at [`L301`](../../../apps/audience/src/graph/GraphView.tsx#L301) wraps into a positioning ancestor (`<div data-testid="audience-graph-root-wrapper" className="relative h-full w-full">`) with the existing Cytoscape mount `<div data-testid="audience-graph-root">` as the first child and the new `<PerFacetPillOverlay>` as the absolutely-positioned sibling. The component internally lifts `cyInstanceRef.current` into a `useState<Core | null>(null)` slot (mirrors the participant's pattern at `<GraphView>`) so the overlay receives a non-null `cy` prop on the second render.
- `apps/audience/src/graph/GraphView.test.tsx` gains structural assertions that the new wrapper + overlay mount: the `audience-graph-root-wrapper` carries `position: relative`, the overlay carries `data-testid="audience-per-facet-pill-overlay"`, and a session whose projection produces at least one node with non-empty `facetStatuses` mounts at least one `[data-facet-pill-row]` child in the overlay.
- Per-facet i18n keys (`methodology.facet.wording` / `.classification` / `.substance`) are ALREADY present in the v1 catalogs from the moderator's task (per [`mod_per_facet_state_visualization.md`](../moderator-ui/mod_per_facet_state_visualization.md) Status block 2026-05-11). No catalog edit is required by this leaf — the audience's `useTranslation()` bootstrap already loads the same catalog set.

Out of scope (deferred to existing or future leaves):

- **Per-facet visualization on EDGES.** Edges carry a `substance` + `shape` facet pair (per `aud_proposed_styling`'s emitted data shape). The task name explicitly scopes "within a single **node**", matching the moderator's `mod_per_facet_state_visualization` (which iterates `Exclude<FacetName, 'shape'>` and renders pills on the node card only). Edge per-facet detail is a future polish task (named-future-task `aud_per_facet_visualization_edges`, ~1d) — registered by the closer if/when broadcast viewer feedback identifies it as load-bearing. For now, edges retain the rollup paint as the only visualization.
- **Vote indicators inside the pill.** `<FacetPill>` accepts an optional `votes?: readonly Vote[]` prop (per [`packages/shell/src/facet-pill/FacetPill.tsx:55`](../../../packages/shell/src/facet-pill/FacetPill.tsx#L55)) that renders per-participant vote dots inside the pill. The audience does NOT pass votes — the broadcast surface deliberately omits per-participant attribution per the show-producer model (the audience canvas reads the conversation, not the individual voters; per-participant detail belongs in the moderator console). The audience overlay passes `facet` + `status` only, leaving `votes` undefined (which `<FacetPill>` treats as empty per the `EMPTY_VOTES` default).
- **Per-facet hover affordance / click-to-detail.** The audience is broadcast-only, read-only (`autoungrabify: true` at [`apps/audience/src/graph/GraphView.tsx:202`](../../../apps/audience/src/graph/GraphView.tsx#L202)). The pills are visual chrome only — no click handlers, no hover popovers, no per-facet drill-in. The moderator's hover popover (`HoverPopover.tsx`) is a moderator-only affordance and stays moderator-side.
- **Larger pill typography for broadcast resolutions.** `<FacetPill>` uses Tailwind's `text-[10px]` (per [`PILL_BASE_CLASSNAME`](../../../packages/shell/src/facet-pill/FacetPill.tsx#L73)). At 720p / 1080p broadcast resolutions this is small but legible; the cross-surface consistency value (same vocabulary as the moderator console) outweighs a broadcast-only retune. If feedback after `aud_visual_regression` shows the pills are too small to read on stream, a polish leaf (`aud_per_facet_pill_broadcast_typography`, ~0.5d, named-future-task — registered by maintainer if/when needed) can retune. Not pre-registered today (speculative).
- **A Playwright spec exercising the pill overlay on a live session.** Per the deferred-e2e exception in `ORCHESTRATOR.md` (component not yet reachable): the audience surface is still placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx); the per-session route lands in `aud_url_routing.aud_session_url`. Full deferral applies; Decision §6 places the per-facet pill overlay pixel-stability pin on `aud_visual_regression`, same destination as the four predecessor styling refinements.
- **Cross-surface `<FacetPill>` extraction into `@a-conversa/shell`.** Already done — the component lives at [`packages/shell/src/facet-pill/FacetPill.tsx`](../../../packages/shell/src/facet-pill/FacetPill.tsx) and is consumed by the moderator today. This leaf is the second consumer; no extraction work.

## Why it needs to be done

The `m_audience_mvp` milestone in [`tasks/99-milestones.tji`](../../99-milestones.tji) names the entire `aud_graph_rendering` group transitively. The card-level rollup the predecessor styling tasks landed is the "scan the canvas" signal: a wall of cards on the broadcast canvas, one frame-color per state, viewers reading "this node needs attention" at a glance. But the rollup picks ONE status per entity from a record of up to three independent per-facet statuses — a node framed rose-600 could be disputed because **one** of its facets is disputed and the other two are agreed, or because **all** of its facets are disputed. The broadcast viewer cannot disambiguate from the rollup alone.

Per the methodology (`docs/methodology.md` § "Facets"), facets are the atomic agreement unit, not proposals — a node's wording can be agreed while its classification is still proposed and its substance is disputed. The rollup loses this structure; the per-facet pill row surfaces it. On the moderator console this matters because the moderator drives the conversation forward and needs to know which facet to surface next; on the broadcast audience this matters because the *viewer* — the show-producer's audience — needs to read the conversation's current state at a per-facet resolution to follow what's actually being debated.

Concretely:

- **`aud_meta_disagreement_split`** ([`tasks/50-audience-and-broadcast.tji:142-146`](../../50-audience-and-broadcast.tji#L142)) renders the meta-disagreement state. That state is per-facet by construction (only meta-disagreement-classified votes against a specific facet flip it), and the rollup priority puts it second-highest (above disputed, below proposed) — so a card framed violet-double could be meta-disagreed on **just one** facet. The pill row this leaf lands is what surfaces which facet is in meta-disagreement; without it, viewers see "this card is in meta-disagreement" with no per-facet detail.
- **`aud_axiom_mark_decoration`** ([`tasks/50-audience-and-broadcast.tji:202-206`](../../50-audience-and-broadcast.tji#L202)) and `aud_annotation_rendering` ([`L207-211`](../../50-audience-and-broadcast.tji#L207)) decorate nodes with per-event content overlays. The pill row this leaf lands establishes the DOM-overlay pattern (positioning ancestor + sibling absolute layer + rAF-batched subscription); those future leaves likely reuse the same pattern for their own overlays. Landing the overlay seam here is the architectural foundation.
- **`aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:318-347`](../../50-audience-and-broadcast.tji#L318)) is the pixel-comparison task that already inherits typography + layout + state-styling pixel-stability deferrals; per-facet pill-row pixel-stability deferred here (Decision §6) follows the same routing.

Architecturally, this leaf parallels the moderator's `mod_per_facet_state_visualization` (shipped 2026-05-11) but renders via a Cytoscape-canvas DOM overlay rather than a React custom node. The moderator's `<StatementNode>` is a ReactFlow custom-node React subtree; the audience's nodes are Cytoscape canvas pixels with no React tree per node. The DOM-overlay pattern proven by the participant's `OtherVotesOverlay` (shipped under `part_other_vote_indicators_canvas_dots`) is the canonical answer to "render arbitrary React per Cytoscape element"; this leaf adopts it directly. Same `<FacetPill>` component, same per-status visual vocabulary, same canonical reading order — only the rendering technology is different.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience uses Cytoscape. No React tree per node ⇒ per-facet detail cannot live inside the node card; the DOM-overlay sibling layered on top of the `<canvas>` is the architecturally correct seam.
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the per-facet state visual contract is documented at L19 ("proposed dashed/faded, agreed solid, disputed marker, meta-disagreement split"). `<FacetPill>`'s per-status Tailwind classes (`packages/shell/src/facet-pill/FacetPill.tsx:76-94`) encode the contract verbatim.
- [ADR 0021 — Event envelope discriminated union](../../../docs/adr/0021-event-envelope-discriminated-union.md) — the projection's narrowing across event kinds is already consumed via `aud_proposed_styling`'s `data.facetStatuses` emission. No new event-kind handling lands here; the overlay only reads the projected fields.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest pins the overlay's React-mount behavior + subscription set + per-element placement. The visible-rendering pin lands on `aud_visual_regression` (Decision §6).
- [ADR 0024 — Frontend i18n: react-i18next + ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `<FacetPill>` resolves the facet-name label via `t('methodology.facet.<facet>')`. The keys exist in all three v1 catalogs from the moderator's task; the audience's `useTranslation()` bootstrap already loads them.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the audience surface owns its mounted region; the new overlay ships inside the audience artifact.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the per-facet detail is the facet-layer surfacing; the whole-card rollup is the entity-layer surfacing. Both layers stay on the canvas; the pill overlay is the per-facet detail this ADR scopes.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the seven `FacetStatus` values (including `awaiting-proposal` per §10) all render with their own per-pill visual treatment per [`packages/shell/src/facet-pill/FacetPill.tsx:76-94`](../../../packages/shell/src/facet-pill/FacetPill.tsx#L76).

### Sibling refinements

- [`tasks/refinements/audience/aud_proposed_styling.md`](aud_proposed_styling.md) — Decision §1 (emit both `facetStatuses` and `rollupStatus`) is the data contract this leaf reads. The per-facet record on every emitted node descriptor is what the overlay iterates.
- [`tasks/refinements/audience/aud_agreed_styling.md`](aud_agreed_styling.md) — Decision §2 (slate-700 palette) cross-surface-locks the agreed-state color the pill mirrors.
- [`tasks/refinements/audience/aud_disputed_styling.md`](aud_disputed_styling.md) — Decision §2 (rose-600 + width-bump) cross-surface-locks the disputed-state visual the pill mirrors (with `ring-1 ring-rose-500` standing in for the canvas width-bump at pill scale).
- [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md) — Decision §8 (cyRef callback as sole observability seam) is the API this leaf reuses to expose the `Core` handle to the new overlay sibling.
- [`tasks/refinements/audience/aud_layout_engine.md`](aud_layout_engine.md) — Decision §4 (200×80 node box) is the geometry the pill row anchors to.
- [`tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md`](../moderator-ui/mod_per_facet_state_visualization.md) — the canonical pill-row precedent. Decisions §1-§8 there carry over verbatim except for §1 (position above wording) which becomes "position above the node bounding box" in the audience translation (since the audience has no "wording paragraph" DOM sibling — the wording is part of the Cytoscape canvas pixels).
- [`tasks/refinements/participant-ui/part_per_facet_state_styling.md`](../participant-ui/part_per_facet_state_styling.md) — Decision §6 there documents the three-options analysis for landing per-facet detail on Cytoscape canvas and chose detail-panel deferral; this leaf inverts that conclusion because the audience has no detail panel (Decision §1 below).

### Live code the leaf modifies / creates

- [`apps/audience/src/graph/GraphView.tsx:301`](../../../apps/audience/src/graph/GraphView.tsx#L301) — current single-div return. Wrapped into a positioning ancestor.
- [`apps/audience/src/graph/GraphView.tsx:146`](../../../apps/audience/src/graph/GraphView.tsx#L146) — `cyRef?: (cy: Core | null) => void` prop on the component. Unchanged externally; internally a new `useState<Core | null>(null)` slot is added so the overlay sibling receives a non-null `cy` prop on the second render.
- [`apps/audience/src/graph/GraphView.tsx:202-210`](../../../apps/audience/src/graph/GraphView.tsx#L202) — the one-shot mount effect. Extended to call `setCyState(cy)` on mount and `setCyState(null)` on cleanup, so the overlay's `useEffect` re-runs on the cy lifecycle.
- [`apps/audience/src/graph/GraphView.tsx:1-79`](../../../apps/audience/src/graph/GraphView.tsx#L1) — header refinement-trail block. Extended with this refinement's one-line-per-decision summary, matching the existing pattern.
- [`apps/audience/src/graph/GraphView.test.tsx`](../../../apps/audience/src/graph/GraphView.test.tsx) — existing 28 cases continue to pass; structural assertions for the wrapper + overlay mount are added (new cases listed under Constraints).
- `apps/audience/src/graph/PerFacetPillOverlay.tsx` — **NEW**. Direct transposition of [`apps/participant/src/graph/OtherVotesOverlay.tsx`](../../../apps/participant/src/graph/OtherVotesOverlay.tsx) with three differences:
  1. The per-element data field read is `data.facetStatuses` (not `data.otherVotes`).
  2. The per-element child is a flex-row of `<FacetPill>` chips (not a flex-row of vote dot `<span>`s).
  3. The anchor is above the node bounding box (`renderedBoundingBox().y1 - PILL_ROW_OFFSET_Y`) rather than below (`y2 + NODE_DOTS_OFFSET_Y`).
- `apps/audience/src/graph/PerFacetPillOverlay.test.tsx` — **NEW**. Vitest case set per Constraints.
- [`packages/shell/src/facet-pill/FacetPill.tsx`](../../../packages/shell/src/facet-pill/FacetPill.tsx) — UNCHANGED (consumed verbatim).
- [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) — confirm `FacetPill` is exported from the shell barrel. If not already re-exported, the closer adds the export line (small mechanical change; not a new architectural surface).
- `apps/audience/package.json` — confirm `@a-conversa/shell` is in `dependencies` (it is — the audience already consumes `useAuth()` per [`tasks/refinements/audience/aud_auth_for_private.md`](aud_auth_for_private.md)). No new dep added.

### What the surface MUST NOT do

- **No edit to `apps/audience/src/graph/stylesheet.ts`.** The Cytoscape selector set is unchanged. Per-facet detail is a DOM-overlay concern, not a Cytoscape-stylesheet concern (Decision §1). The four selector pairs (`node` + `edge` × `proposed`/`agreed`/`disputed` + baseline) stay byte-identical.
- **No edit to `apps/audience/src/graph/projectGraph.ts` or `apps/audience/src/graph/facetStatus.ts`.** The projection already emits `data.facetStatuses` and `data.rollupStatus` per `aud_proposed_styling`. The overlay reads what's already on the elements.
- **No edit to `apps/audience/src/graph/layoutOptions.ts` / `cytoscapeTestEnv.ts`.** Layout and mount-environment are unchanged.
- **No edit to `apps/audience/src/App.tsx`, `apps/audience/src/index.css`, `apps/audience/src/main.tsx`.** Route, page CSS, provider wiring all unchanged; the audience surface remains placeholder-routed.
- **No edit to `apps/audience/src/state/**` or `apps/audience/src/ws/**`.** State / WS layer is untouched.
- **No edit to `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**`.** The cross-surface artifact (`<FacetPill>` in shell) is already shipped.
- **No new ADR.** The decisions land inside this refinement; the pattern lift from `OtherVotesOverlay` is established precedent.
- **No new i18n keys.** `methodology.facet.wording` / `.classification` / `.substance` exist in the v1 catalogs from `mod_per_facet_state_visualization` (2026-05-11).
- **No new dependency.** `cytoscape`, `react`, `@a-conversa/shell` are all already on the audience's path.
- **No `cytoscape-node-html-label` or other Cytoscape extension.** Rejected for the same reason the participant rejected it (per `part_per_facet_state_styling` Decision §6): pulling a new dependency for ONE rendering feature when the DOM-overlay pattern is already proven on the codebase.
- **No `votes` prop on the audience's `<FacetPill>` instances.** Per-participant vote attribution is omitted on the broadcast surface (out-of-scope note above).
- **No pill-row click handler / hover popover / per-facet drill-in.** The audience is read-only; `pointer-events: none` on the overlay root ensures clicks pass through to the (also read-only-via-`autoungrabify`) Cytoscape canvas.
- **No edit to the `STYLESHEET` JSDoc or the existing per-state selector entries.** The per-facet detail is paint-on-top, not paint-inside-canvas.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/PerFacetPillOverlay.tsx` — **NEW**. Module exports: a default-exported `<AudiencePerFacetPillOverlay>` React component with props `{ cy: Core | null; containerRef: RefObject<HTMLDivElement | null> }` (the `containerRef` prop is reserved for future positioning-debug branches per the `OtherVotesOverlay` precedent and is referenced via `void containerRef;` to satisfy `noUnusedParameters`); a module-scope `PILL_ROW_OFFSET_Y = 6` constant (the px gap between the pill row's bottom edge and the node's top edge); a module-scope `FACET_RENDER_ORDER: readonly Exclude<FacetName, 'shape'>[] = ['wording', 'classification', 'substance']` constant (the canonical reading order, matching the moderator's `FACET_RENDER_ORDER` at [`apps/moderator/src/graph/StatementNode.tsx:100`](../../../apps/moderator/src/graph/StatementNode.tsx#L100)). The component's `useEffect` subscribes to `cy.on('render pan zoom resize', scheduleUpdate)` + `cy.on('position', 'node', scheduleUpdate)` + `cy.on('add remove data', scheduleUpdate)` with a singleton-rAF-handle batched commit; teardown calls the matching `cy.off(...)` set and `cancelAnimationFrame(frameRef.current)` if pending. The render returns a wrapper `<div data-testid="audience-per-facet-pill-overlay" className="pointer-events-none absolute inset-0">` enclosing one positioned `<div data-facet-pill-row data-element-id="<id>" style={{ position: 'absolute', left: x px, top: y px, transform: 'translate(-50%, -100%)', display: 'flex', gap: '4px' }}>` per node whose `data.facetStatuses` has at least one entry; each row contains up to three `<FacetPill facet={facet} status={status} />` children iterated in `FACET_RENDER_ORDER`, one pill per facet present in the record.

- `apps/audience/src/graph/PerFacetPillOverlay.test.tsx` — **NEW**. Vitest suite. Minimum case coverage (each case `expect(...).toBe(...)` style — no snapshots, no DOM regression-only):
  - 1 case: mount with `cy: null` (pre-mount state) renders the wrapper `<div data-testid="audience-per-facet-pill-overlay">` with no children (overlay is non-`null` but the placement list is empty until a `Core` arrives).
  - 1 case: mount with a `cy` containing zero elements renders the wrapper with no `[data-facet-pill-row]` children.
  - 1 case: mount with a `cy` containing one node whose `data.facetStatuses === {}` renders no `[data-facet-pill-row]` for that node (consistent with the moderator's empty-row omission).
  - 1 case: mount with a node whose `data.facetStatuses === { wording: 'proposed' }` renders exactly one `[data-facet-pill-row]` for that node containing exactly one `[data-facet-pill][data-facet-name='wording'][data-facet-status='proposed']` child.
  - 1 case: mount with a node whose `data.facetStatuses === { wording: 'agreed', classification: 'disputed', substance: 'proposed' }` renders the pill row with THREE pills in canonical DOM order — child 0 is `data-facet-name='wording'`, child 1 is `data-facet-name='classification'`, child 2 is `data-facet-name='substance'`. Each pill's `data-facet-status` matches the per-facet record.
  - 1 case: mount with TWO nodes both carrying non-empty `facetStatuses` renders two `[data-facet-pill-row]` children; the `data-element-id` attribute on each row matches the corresponding node's id; the position attributes (`style.left`, `style.top`) differ (because `renderedBoundingBox()` reports different rects per node).
  - 1 case: an EDGE with non-empty `data.facetStatuses` does NOT produce a `[data-facet-pill-row]` for the edge (the overlay iterates `cy.nodes()` only — edges are out of scope per the task name).
  - 1 case: firing `cy.emit('pan')` after mount triggers a re-commit (verified by spying on `setPlacements` via render-prop or by asserting the rAF batch fires exactly once even when `pan` is fired twice within the same frame).
  - 1 case: cleanup unsubscribes from the events — after `unmount()`, firing `cy.emit('pan')` does NOT trigger any state update (verified by Vitest's act-warning absence or by a spy on `cy.off`).
  - 1 case (locale): pill localized label resolves via the `useTranslation()` hook — for an en-US locale, the `wording` pill's text content includes `"Wording"`. The full cross-locale matrix is the moderator's `FacetPill.test.tsx` job; the audience pins only the en-US smoke to confirm the i18n bootstrap is wired through.

- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. Three diff regions:
  - Header refinement-trail block (lines 1-79) gains a "Refinement: tasks/refinements/audience/aud_per_facet_visualization.md" entry summarizing Decisions §1-§6.
  - Inside the `<AudienceGraphView>` function body (around [`L149-155`](../../../apps/audience/src/graph/GraphView.tsx#L149)): add `const [cyState, setCyState] = useState<Core | null>(null);` alongside the existing `cyInstanceRef`. In the mount effect (around [`L202-210`](../../../apps/audience/src/graph/GraphView.tsx#L202)): add `setCyState(cy);` after `cyInstanceRef.current = cy;` and `setCyState(null);` in the cleanup block.
  - The return JSX (currently the single div at [`L301`](../../../apps/audience/src/graph/GraphView.tsx#L301)) becomes:

    ```tsx
    return (
      <div data-testid="audience-graph-root-wrapper" className="relative h-full w-full">
        <div ref={containerRef} data-testid="audience-graph-root" className="h-full w-full" />
        <AudiencePerFacetPillOverlay cy={cyState} containerRef={containerRef} />
      </div>
    );
    ```

- `apps/audience/src/graph/GraphView.test.tsx` — MODIFIED. Existing 28 cases continue to pass (the testid query for `audience-graph-root` still resolves — it's now the inner div but the testid is unchanged). Add:
  - 1 case (structural): the rendered DOM has `[data-testid="audience-graph-root-wrapper"]` as a parent of `[data-testid="audience-graph-root"]` and `[data-testid="audience-per-facet-pill-overlay"]`.
  - 1 case (structural): the wrapper carries `className="relative h-full w-full"` (the positioning context that makes the overlay's `absolute inset-0` resolve to the canvas rectangle).
  - 1 case (integration): after the projection produces a node with non-empty `facetStatuses` and the mount effect runs, `[data-testid="audience-per-facet-pill-overlay"]` contains at least one `[data-facet-pill-row]` child whose `data-element-id` matches the node's id.

### Files this task does NOT touch

- `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — UNCHANGED.
- `packages/shell/src/facet-pill/FacetPill.tsx` and `packages/shell/src/facet-pill/types.ts` — UNCHANGED. `<FacetPill>` is consumed verbatim.
- `packages/shell/src/index.ts` — confirm `FacetPill` is in the barrel re-exports (read-only check; if missing the closer adds the line).
- `packages/i18n-catalogs/**` — UNCHANGED. The `methodology.facet.*` keys are already in the v1 catalogs.
- `apps/audience/src/graph/stylesheet.ts`, `apps/audience/src/graph/projectGraph.ts`, `apps/audience/src/graph/facetStatus.ts`, `apps/audience/src/graph/layoutOptions.ts`, `apps/audience/src/graph/cytoscapeTestEnv.ts` — UNCHANGED.
- `apps/audience/src/App.tsx`, `apps/audience/src/index.css`, `apps/audience/src/main.tsx` — UNCHANGED.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED (deps are already in place).
- `docs/adr/**` — UNCHANGED. No new ADR.
- `playwright.config.ts` / `tests/e2e/**` — UNCHANGED. Playwright deferral per Decision §6.
- `.tji` files — `complete 100` lands at task-completion time per the [README ritual](../README.md). No new `.tji` edges are required.

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/PerFacetPillOverlay.tsx` exists and exports a default `<AudiencePerFacetPillOverlay>` component with the props, subscription set, rAF-batched commit, and positioned-pill-row render path per Constraints.
- `apps/audience/src/graph/PerFacetPillOverlay.test.tsx` exists with the 10 listed cases (mount lifecycle × subscription × per-element placement × locale).
- `apps/audience/src/graph/GraphView.tsx` carries the wrapper-div / cyState / overlay-mount changes per Constraints; the existing `cyRef` callback API is unchanged externally (still accepts a `(cy: Core | null) => void`).
- `apps/audience/src/graph/GraphView.test.tsx` carries 31 cases total (28 baseline + 3 new). The 3 new cases pin the wrapper structure + the overlay-as-sibling mount + the integration path from projection to rendered pill row.
- The whole-card rollup paint (the existing `STYLESHEET` per-rollup selectors) is UNCHANGED in pixel terms — the four selector pairs for proposed / agreed / disputed and the baseline node / edge selectors are byte-identical.
- `apps/audience/package.json` is UNCHANGED — no new dependency.
- `apps/audience/src/App.tsx` is UNCHANGED. The component remains not-yet-reachable through any URL.
- Per `ORCHESTRATOR.md`'s deferred-e2e exception ("component not yet reachable"), Playwright coverage for this leaf is **deferred to `aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:318-347`](../../50-audience-and-broadcast.tji#L318); already inherits typography + layout + state-styling pixel-stability deferrals). The closer extends `aud_visual_regression`'s existing note to cover the per-facet pill overlay: a node with three facet pills (`wording=agreed`, `classification=disputed`, `substance=proposed`) renders with the per-status palette + canonical reading order across Chrome / Firefox / WebKit at 720p / 1080p / 1440p against the same reference fixtures the predecessor deferrals already pin. Decision §6 documents why this is the right destination.
- The closer (or maintainer) MAY register the named-future-task `aud_per_facet_visualization_edges` (~1d) in the WBS if/when edge per-facet detail is identified as load-bearing for broadcast viewers; deferred for now per the out-of-scope note above. NOT a required action at task close — registered only if/when the need is concrete (not speculative).
- `pnpm run check` clean (strict TS pass; no new dep declared; the `Core | null` lift to `useState` matches the participant's typed pattern).
- `pnpm run test:smoke` green (Vitest count rises by ~10 new `PerFacetPillOverlay.test.tsx` cases + 3 new `GraphView.test.tsx` cases).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta carries the new overlay component (~80-120 LOC compiled) and the `<FacetPill>` consumer code path; estimate ~3-5 KB pre-gzip.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_per_facet_visualization` in the same commit (the closer's ritual).
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer pins the overlay's mount behavior, the subscription set, the per-element placement, the canonical reading order, the empty-record omission, and the cleanup behavior. `aud_visual_regression` will land the pixel-level rendering pin once the route is reachable.

## Decisions

### §1 — DOM-overlay sibling of the Cytoscape canvas (NOT Cytoscape-native, NOT deferred)

Three approaches to landing per-facet detail on the audience canvas:

- **(A — chosen)** A React DOM overlay layered as a sibling of the Cytoscape mount (`pointer-events-none absolute inset-0`), positioned via `cy.elements().renderedBoundingBox()` / `cy.pan()` / `cy.zoom()`, subscribed to Cytoscape pan / zoom / render / position / add-remove-data events with rAF-batched commits. The pill row anchors above each node's bounding box; one row per node whose `data.facetStatuses` is non-empty. The pattern is a verbatim transposition of the participant's `OtherVotesOverlay` (shipped under `part_other_vote_indicators_canvas_dots`) — same wrapper structure, same subscription set, same singleton-rAF handle.
- **(B)** A Cytoscape-native per-node visualization via the `cytoscape-node-html-label` plugin (or compound nodes, or per-element `background-image` data-URLs). Cost: new dependency for ONE rendering feature; the participant explicitly rejected this option in `part_per_facet_state_styling` Decision §6 ("pulls a new dependency for ONE rendering feature whose primary home is the detail panel"). The same rejection applies here for the same reason — the codebase already has the DOM-overlay pattern proven and tested; adding a Cytoscape extension would introduce a maintenance surface that nobody else uses. Rejected.
- **(C)** Defer per-facet detail entirely — ship rollup-only on the audience, register a future task that re-visits per-facet visualization. Cost: the methodology's per-facet semantics are invisible on the broadcast surface (a violet-double card could be meta-disagreed on one facet or three; the viewer can't tell). The participant chose this option because it has a detail-panel fallback (`part_entity_detail_panel`) hosting `<FacetPill>` on tap. **The audience has no detail panel and no tap interaction** — broadcast is one-way. Deferring per-facet detail on the audience means the per-facet structure is permanently invisible to broadcast viewers. Rejected.

The DOM-overlay pattern is the architecturally correct choice for "render React per Cytoscape element on a non-interactive broadcast surface." The participant's `OtherVotesOverlay` is the proven precedent; the audience overlay is the second instance of the same pattern, which both validates the pattern (it has two consumers) and amortizes the cost of the next overlay (e.g., the future `aud_annotation_rendering` / `aud_axiom_mark_decoration` siblings likely reuse it again).

Alternative — split the overlay across two surfaces (one for nodes, one for edges). Rejected — the per-element loop in `OtherVotesOverlay` already handles both nodes and edges within a single subscription; the audience overlay scopes to nodes only by iterating `cy.nodes()` (no edge branch), which keeps the file half the size of the participant's. A future `aud_per_facet_visualization_edges` task can add the edge branch in place.

### §2 — Pill row anchor: ABOVE the node bounding box (not below, not inside)

Two approaches to the per-element anchor position:

- **(A — chosen)** Anchor the pill row's BOTTOM edge to `renderedBoundingBox().y1 - PILL_ROW_OFFSET_Y` (a few px above the node's top edge), with `translate(-50%, -100%)` centering horizontally and pulling the row up so the row's bottom sits at the anchor point. `PILL_ROW_OFFSET_Y = 6` keeps the row clear of the per-state border (up to 3px wide for disputed nodes) plus a small breathing gap.
- **(B)** Anchor BELOW the node (mirror the participant's vote-dots anchor at `y2 + NODE_DOTS_OFFSET_Y`). Rejected — places the per-facet detail where the next entity-card or edge label would land in the broadcast canvas layout; the overlap risk is high on dense graphs. Above-the-node is the moderator's pill-row position (`mod_per_facet_state_visualization` Decision §1) translated to the canvas surface.
- **(C)** Anchor inside the node (overlay the pill row on top of the node's wording). Rejected — overlays the entity-layer content (wording) with the facet-layer detail; per ADR 0027 the two layers should not visually compete. The above-the-node position separates the facet detail from the entity content in screen space, mirroring the moderator's "pill row above the wording paragraph" decision.

The above-the-node anchor matches the moderator's pill-row position (ADR 0027-respecting separation between facet layer above and entity layer below). The participant's vote-dots overlay anchored below the node because votes are per-proposal, not per-facet — different semantics, different anchor. Cross-surface consistency on the per-facet position (above) is the principle.

Alternative — anchor on the left or right of the node. Rejected — the 200×80 node box is wider than tall; horizontal anchors compete with edge labels and don't compose with the breadthfirst layout's left-to-right flow.

### §3 — Iterate `wording → classification → substance`, skip facets absent from the record

The canonical reading order from `docs/methodology.md` § "Facets" — also the moderator's `FACET_RENDER_ORDER` at [`apps/moderator/src/graph/StatementNode.tsx:100`](../../../apps/moderator/src/graph/StatementNode.tsx#L100). Cross-surface consistency carries verbatim. Pills emit only for facets present in `data.facetStatuses` (a node fresh from `node-created` with no proposals has `facetStatuses: {}` and renders no row at all, consistent with the moderator's empty-record omission and the participant's empty-votes omission).

The `shape` facet (which lives on edges, not nodes) is excluded by the type narrow `Exclude<FacetName, 'shape'>` — same as the moderator. Edges may eventually warrant their own overlay branch (a `substance` + `shape` two-pill row); deferred to the named-future-task `aud_per_facet_visualization_edges` per the out-of-scope note.

Alternative — iterate in `ROLLUP_PRIORITY` order (proposed-first). Rejected — `ROLLUP_PRIORITY` is the importance order (which status wins the card frame); the reading order is methodology-natural (`wording → classification → substance` — "how is it phrased? what kind is it? does it hold?"). Same separation the moderator made in its Decision §3.

### §4 — Subscribe to `render pan zoom resize` + `position node` + `add remove data`; rAF-batched

Verbatim transposition of `OtherVotesOverlay` Decision §6:

- `render` catches any Cytoscape repaint (general "something moved").
- `pan` / `zoom` catch viewport transforms (the canvas rect didn't move but the per-element rendered coords did).
- `resize` catches `<div>` bounds changes (e.g., browser viewport resize, OBS browser-source size change).
- `position` (node) catches per-element position settling after layout passes.
- `add remove data` catches element-set changes AND `data` field mutations (e.g., a new event arrives, `projectGraph` re-runs, the elements' `facetStatuses` field flips — the overlay needs to re-paint with the new per-facet record).

Singleton-rAF handle drops re-entrant scheduling within the same frame (one commit per frame regardless of how many events fire). `cancelAnimationFrame(frameRef.current)` in cleanup. The `happy-dom` rAF polyfill in `cytoscapeTestEnv.ts` backs the flow under Vitest (per the participant's [`cytoscapeTestEnv.ts`](../../../apps/participant/src/graph/cytoscapeTestEnv.ts) precedent — the audience already has the analogous file).

Alternative — subscribe to only `render` (assume Cytoscape fires render on every viewport / element change). Rejected — the participant's `OtherVotesOverlay` proved that `data` mutations on existing elements (the case where a `node-vote` event flips `facetStatuses.classification` from `'proposed'` to `'agreed'`) need the explicit `cy.on('add remove data', cb)` subscription to fire the re-commit. Skipping it leaves the per-facet overlay stale until the next pan/zoom event.

### §5 — Lift `cy` into `useState`, pass to overlay as a non-null prop after mount

The audience's `<AudienceGraphView>` currently exposes `cyRef?: (cy: Core | null) => void` as a callback prop (per `aud_cytoscape_init` Decision §8) — used by tests to grab the `Core` handle. The new overlay sibling needs the same handle to subscribe; React's `useRef` won't trigger a re-render when `.current` changes, so the overlay would never re-subscribe.

Two approaches:

- **(A — chosen)** Add `const [cyState, setCyState] = useState<Core | null>(null);` alongside the existing `cyInstanceRef`. The mount effect calls both `cyInstanceRef.current = cy` AND `setCyState(cy)` — the ref keeps the existing element-sync useEffect's synchronous access pattern; the state slot triggers the overlay's `useEffect` to run after the second render. Cleanup sets both to `null`. The external `cyRef?:` callback API is unchanged — the consumer's callback still fires on mount and unmount. Mirrors the participant's pattern (per `<GraphView>` in `apps/participant/src/graph/`).
- **(B)** Pass `cyInstanceRef` directly to the overlay and use a one-time `useEffect` to subscribe to `cy.ready()` from inside the overlay. Rejected — the overlay can't depend on a mutable ref's identity for re-subscription; if the audience ever re-mounts the Cytoscape instance (e.g., a future broadcast-mode toggle from `aud_cytoscape_init` Decision §7), the overlay would not re-subscribe to the new instance.
- **(C)** Hoist the `<AudiencePerFacetPillOverlay>` to a sibling of `<AudienceGraphView>` in the parent component, with the parent owning `cyState` lifted from `<AudienceGraphView>`'s `cyRef` callback. Rejected — `<AudienceGraphView>` is the canonical mount surface; the overlay belongs co-located with the mount so the wrapper-div positioning is self-contained. The parent component should not need to know about per-facet detail rendering.

### §6 — Playwright deferral lands on `aud_visual_regression`, NOT a new task

Per `ORCHESTRATOR.md`'s deferred-e2e exception: this leaf adds a DOM-overlay to an audience-surface region that is still not reachable through any user-flow route ([`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) maps every path to the placeholder; the per-session route lands in `aud_url_routing.aud_session_url`). The per-facet pills are invisible until that route ships.

`aud_session_url`'s inherited deferred-e2e debt is already past the "2+ refinements, pay down" threshold (per `aud_cytoscape_init.md` Decision §9 + the four state-styling siblings' deferrals). All four predecessor refinements (`aud_layout_engine`, `aud_clean_typography`, `aud_agreed_styling`, `aud_proposed_styling`, `aud_disputed_styling`) routed their pixel-stability work to `aud_visual_regression` for this reason. Per-facet detail follows the same routing.

The right destination is **`aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:318-347`](../../50-audience-and-broadcast.tji#L318)). The task already inherits five sibling deferrals. The closer extends `aud_visual_regression`'s existing note to also cover the per-facet pill overlay: a node with three facet pills (`wording=agreed`, `classification=disputed`, `substance=proposed`) renders with the per-status palette + canonical reading order + above-the-node anchor across Chrome / Firefox / WebKit at 720p / 1080p / 1440p.

The overlay's mount lifecycle, subscription set, per-element placement, and canonical reading order are fully pinned at the Vitest layer above — `aud_visual_regression` is for the *visible* rendering (pixel-level pill colors, font rendering, position-sync across the viewport), not the overlay's structure.

Alternative — defer to `aud_session_url`. Rejected per the "2+ refinements, pay down" rule and per the scope mismatch (route-mount assertions are not per-element overlay assertions).

Alternative — register a new `aud_pw_per_facet_pills_smoke` task. Rejected — planning-debt for no architectural reason; `aud_visual_regression` already exists and inherits the four state-styling deferrals' work, which the per-facet overlay is a natural extension of (same broadcast-canvas, same per-status palette, same not-yet-reachable surface).

Alternative — scope a thin Playwright spec inline that asserts the placeholder route's chrome includes a `[data-testid="audience-per-facet-pill-overlay"]` element. Rejected — the placeholder chrome does NOT include the Cytoscape mount (the `<AudienceGraphView>` is not mounted from `App.tsx`); no inline spec is meaningful before `aud_session_url` lands.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-28.

- `apps/audience/src/graph/PerFacetPillOverlay.tsx` — NEW. `<AudiencePerFacetPillOverlay>` component; rAF-batched DOM overlay subscribed to Cytoscape render/pan/zoom/resize/position/add-remove-data events; renders one positioned `[data-facet-pill-row]` per node with non-empty `facetStatuses`; `FACET_RENDER_ORDER` iterates `wording → classification → substance`; anchor above the node bounding box via `renderedBoundingBox().y1 - PILL_ROW_OFFSET_Y`; `pointer-events-none absolute inset-0` posture.
- `apps/audience/src/graph/PerFacetPillOverlay.test.tsx` — NEW. 10 Vitest cases (a–j): null-cy mount, empty cy, empty-record omission, single pill, three pills in canonical order, two-node distinct positions, edges-not-rendered, singleton-rAF batching, cleanup detaches listeners, en-US localized label.
- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. Header refinement-trail entry; `useState<Core | null>(null)` slot (`cyState`/`setCyState`) alongside `cyInstanceRef`; mount effect wires `setCyState(cy)` / cleanup `setCyState(null)`; return JSX wrapped in `<div data-testid="audience-graph-root-wrapper" className="relative h-full w-full">` with `<AudiencePerFacetPillOverlay cy={cyState} containerRef={containerRef} />` as overlay sibling.
- `apps/audience/src/graph/GraphView.test.tsx` — MODIFIED. Header trail entry; 3 new cases (ii–kk) pinning wrapper structure, classNames, and projection → pill-row integration.
- Pixel-stability pin (pill colors, font rendering, above-the-node anchor across Chrome/Firefox/WebKit at 720p/1080p/1440p) deferred to `aud_visual_regression` per Decision §6; `aud_visual_regression` note extended accordingly.
