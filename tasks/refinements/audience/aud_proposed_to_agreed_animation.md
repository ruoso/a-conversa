# Audience proposed → agreed transition animation (a one-shot CSS `@keyframes` applied to a wrapper around each `<FacetPill>` inside `<AudiencePerFacetPillOverlay>`, gated by `useSeenKeysGate` keyed on `${nodeId}:${facet}` over the currently-`agreed` pill set so only post-mount per-facet transitions to `'agreed'` animate; suppressed under `prefers-reduced-motion: reduce`)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_animations.aud_proposed_to_agreed_animation` (lines 331-334).
**Effort estimate**: 1d
**Inherited dependencies**:

- `!audience.aud_graph_rendering` (settled — the entire group is `complete 100`). The audience surface paints per-facet pill rows above each Cytoscape node via [`apps/audience/src/graph/PerFacetPillOverlay.tsx`](../../../apps/audience/src/graph/PerFacetPillOverlay.tsx); each row consumes the per-entity `data.facetStatuses` record emitted by [`projectGraph`](../../../apps/audience/src/graph/projectGraph.ts) (lines 226, 251-252 — `facetStatusIndex = computeFacetStatuses(events)`; `facetStatuses = facetStatusIndex.nodes.get(node_id) ?? EMPTY_FACET_STATUSES`). One `<FacetPill facet={...} status={...} />` renders per facet present in the record. This leaf adds **animated transition** when an individual facet's status flips to `'agreed'` mid-broadcast; the steady-state visual contract is unchanged.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_axiom_mark_animation` (settled — [`tasks/refinements/audience/aud_axiom_mark_animation.md`](aud_axiom_mark_animation.md)). The first sibling in the animation group; established the in-place-wrap pattern (modify the overlay that already renders the affected element rather than introducing a parallel halo overlay) for animating an inner element of an existing overlay. Decisions §1 (CSS keyframe on a React-keyed wrapper), §3 (animate by wrapping in the consuming overlay, not by modifying the shell primitive), §4 (`useRef<Set<string>>` initial-mount guard; lazy-init gated on `placements.length > 0`), §5 (350 ms `cubic-bezier(0.16, 1, 0.3, 1)` "lands and sticks"), §6 (Playwright deferred to `aud_session_url`; CSS file presence + React-side class logic pinned via Vitest) all apply verbatim modulo the per-pill key shape vs the per-badge key shape.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_node_appear_animation` (settled — [`tasks/refinements/audience/aud_node_appear_animation.md`](aud_node_appear_animation.md)). The second animation sibling; reinforced the cumulative posture (CSS-first, no motion framework, `prefers-reduced-motion` in CSS not TS, seen-Set lazy-init on first non-empty placement commit) and registered the rule-of-four extraction trigger that became `aud_dom_overlay_extraction`. This leaf is the third hit on the same template.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_dom_overlay_extraction` (settled — [`tasks/refinements/audience/aud_dom_overlay_extraction.md`](aud_dom_overlay_extraction.md)). The shared overlay primitives `useCytoscapeOverlayPlacements<P>` and `useSeenKeysGate<K>` now live in [`apps/audience/src/graph/cytoscapeOverlayHooks.ts`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts:89-173). `<AudiencePerFacetPillOverlay>` already consumes `useCytoscapeOverlayPlacements` ([`PerFacetPillOverlay.tsx:114`](../../../apps/audience/src/graph/PerFacetPillOverlay.tsx#L114)); this leaf adds a call to `useSeenKeysGate` for the per-facet `agreed` transition gate, mirroring the predecessor's `useSeenKeysGate(nodeIds)` pattern at [`NodeAppearOverlay.tsx:111`](../../../apps/audience/src/graph/NodeAppearOverlay.tsx#L111) and the lifted seen-key gate at [`AxiomMarkOverlay.tsx`](../../../apps/audience/src/graph/AxiomMarkOverlay.tsx).
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_per_facet_visualization` (settled — [`tasks/refinements/audience/aud_per_facet_visualization.md`](aud_per_facet_visualization.md)). The DOM-overlay sibling shape that paints the pill row this leaf decorates. Decisions §1 (DOM-overlay sibling), §2 (row anchored above the node bounding box), §3 (canonical reading order `wording → classification → substance`), §4 (rAF-batched commit subscribed to `render pan zoom resize` + `position node` + `add remove data`) all hold unchanged; this leaf adds a wrapper layer INSIDE the pill row without touching positioning or reading-order.
- Prose-only context (NOT a `.tji` edge): `aud_animations.aud_animation_pacing` (sibling, future — [`tasks/50-audience-and-broadcast.tji:352-355`](../../50-audience-and-broadcast.tji#L352)). The cross-cutting cadence-tuning task; its `depends` line already names `!aud_proposed_to_agreed_animation` (verified at [line 355](../../50-audience-and-broadcast.tji#L355)), so no closer-time `depends` edit is required against this leaf. This refinement chooses an initial 350 ms duration matching the axiom-mark sibling — both animations mark a methodologically-loaded commit moment; pacing revisits the constant once the remaining `aud_animations.*` siblings ship.
- Prose-only context (NOT a `.tji` edge): `audience.aud_url_routing.aud_session_url` (sibling, future — see [`tasks/50-audience-and-broadcast.tji:442+`](../../50-audience-and-broadcast.tji#L442)). The deferred-e2e debt collector for the audience surface. The predecessor animation siblings already route their Playwright debt there; this leaf joins the same chain (Decision §6 below).

## What this task is

The 1d leaf that lights up **transition animation** on per-facet pill chips painted by `<AudiencePerFacetPillOverlay>`. When a participant's `agree` vote settles the methodology requirement for a facet — all current non-moderator participants voted `agree` and `computeFacetStatuses` flips the facet's status from `'proposed'` (or `'awaiting-proposal'`) to `'agreed'` — the corresponding chip "settles" with a brief scale + soft outline pulse, signalling to the passive broadcast viewer that THIS specific facet on THIS specific node just reached agreement.

The implementation parallels the axiom-mark predecessor: wrap each `<FacetPill>` inside the overlay's render loop with a `<span data-pill-agreed-anim>` carrier; gate the `aud-pill-agreed` animation class via `useSeenKeysGate` keyed by `${nodeId}:${facet}` over the **subset of placements whose facet status is `'agreed'`**. The animation itself is a single `@keyframes aud-pill-agreed` rule defined in `apps/audience/src/index.css`, suppressed under `@media (prefers-reduced-motion: reduce)`.

The seen-set semantics are the load-bearing detail: the predecessor animations seeded over a per-element identity key (`nodeId` for `<AudienceNodeAppearOverlay>`, `${nodeId}:${participantId}` for `<AudienceAxiomMarkOverlay>`), so "newly seen" coincided with "newly mounted." For a proposed → agreed *transition* the key must encode the target status, not just the element. The right key is `${nodeId}:${facet}` (or any other reversible bijection between (node, facet) pairs and strings) **drawn only from currently-agreed entries**: the hook receives `currentKeys` containing exactly the `${nodeId}:${facet}` pairs whose current status is `'agreed'`. The first non-empty commit seeds the set with the pairs that were already agreed when the broadcast loaded (audience joining mid-session); subsequent commits where a (node, facet) flips to `'agreed'` produce a key not yet in the set, which the hook returns as new and which the render path classes with `aud-pill-agreed`. Facets in `'proposed'` / `'disputed'` / `'committed'` / `'withdrawn'` / `'meta-disagreement'` / `'awaiting-proposal'` simply contribute no key to `currentKeys` — they don't seed and don't animate.

CSS keyframes are inherently one-shot per element lifetime — the animation fires when the wrapper-class is applied to a previously-class-less wrapper and never again on rerender (a wrapper's `<span>` is keyed by `facet` inside a row keyed by `p.id`, so React reuses the existing DOM across rerenders; adding a class to an already-existing element triggers no animation on its own, but adding a class to a wrapper that already has the class is a no-op too). The `aud-pill-agreed` class is added once when the predicate fires and the gate flips the key from "unseen" to "seen"; subsequent renders find the key in the set and the class is not re-applied. Because the per-pill `<span>` may already exist before the agreed transition (a `'proposed'` pill was rendered first, then transitioned), the CSS animation must work whether the class lands on a wrapper that has been mounted for many frames or on a wrapper just mounted — both branches use the same `aud-pill-agreed { animation: ... }` rule and the CSS engine fires the keyframe on the *class* transition either way.

After this leaf:

- `apps/audience/src/graph/PerFacetPillOverlay.tsx` — MODIFIED. The render-loop's inner `<FacetPill>` wraps in a `<span data-pill-agreed-anim>` carrier; the overlay reads currently-agreed `${nodeId}:${facet}` keys from `placements` and passes them to `useSeenKeysGate`; the wrapper's `className` is `aud-pill-agreed` when the predicate returns `true` and empty otherwise. Header comment-block extends with a refinement-trail entry summarizing Decisions §1-§6.
- `apps/audience/src/graph/PerFacetPillOverlay.test.tsx` — MODIFIED. 6 new Vitest cases pin: (a) initial-mount `'agreed'` pills do NOT carry the animation class; (b) a freshly-transitioned (`'proposed'`/`'awaiting-proposal'` → `'agreed'`) pill DOES carry the class after the rerender; (c) the prior-rendered already-`'agreed'` sibling pills do NOT regain the class; (d) re-render with the same facet statuses (pan/zoom simulation) does not re-add the class to any wrapper; (e) the animation wrapper carries `data-pill-agreed-anim` for testid stability; (f) a non-`'agreed'` status (`'proposed'`, `'disputed'`, etc.) never gets the class regardless of mount timing. Existing tests pass byte-unchanged (the wrapper is additive and the existing `[data-facet-pill]` testid sits inside the wrapper).
- `apps/audience/src/index.css` — MODIFIED. One `@keyframes aud-pill-agreed` rule plus a `.aud-pill-agreed` utility selector that consumes it (`animation: aud-pill-agreed 350ms cubic-bezier(0.16, 1, 0.3, 1) forwards;`); one `@media (prefers-reduced-motion: reduce) { .aud-pill-agreed { animation: none; } }` override. The keyframe lands beside the existing `aud-axiom-mark-land` and `aud-node-appear` blocks.
- `apps/audience/src/index.test.ts` — MODIFIED. 2 new Vitest cases appended to the existing 4 (`@keyframes aud-axiom-mark-land`, reduced-motion override for `.aud-axiom-mark-land`, `@keyframes aud-node-appear`, reduced-motion override for `.aud-node-appear`) asserting `@keyframes aud-pill-agreed` presence and the matching `prefers-reduced-motion: reduce` override clause.

Out of scope (deferred to existing or future leaves):

- **Per-facet transitions to states OTHER than `'agreed'`** (`'proposed'` → `'disputed'`, `'agreed'` → `'committed'`, `'agreed'` → `'withdrawn'`, `'meta-disagreement'` arrivals). The task name explicitly scopes this leaf to the proposed → agreed transition. Disputed-arrival animation is the territory of `aud_diagnostic_fire_animation` or a future `aud_facet_disputed_animation` (NOT pre-registered); withdrawal is the territory of `aud_withdrawal_animation`; committed is a closed-state transition that the audience surface today does not specially mark (per `aud_per_facet_visualization` Decision §3 the pill renders all seven `FacetStatus` values uniformly through `<FacetPill>`). If product surfaces a need for any of these, each lands as its own sibling task following this leaf's template.
- **Per-edge facet transitions.** `<AudiencePerFacetPillOverlay>` today iterates `cy.nodes()` only ([`PerFacetPillOverlay.tsx:148`](../../../apps/audience/src/graph/PerFacetPillOverlay.tsx#L148)) per Decision §3 of `aud_per_facet_visualization`. Edge-targeted per-facet pills are out of scope for the overlay today; when a future task (`aud_edge_per_facet_visualization`, NOT pre-registered today) wires an edge-pill row, the animation pattern this leaf establishes maps directly onto it (same hook usage, same key shape `${edgeId}:${facet}`, same CSS class). The current leaf does not pre-commit to edge coverage.
- **Whole-card rollup transition animation** (the entity-layer paint flipping when `rollupStatus` derives a new aggregate). `rollupStatus` is computed by `cardRollupStatus(facetStatuses)` per [`projectGraph.ts:253`](../../../apps/audience/src/graph/projectGraph.ts#L253) and stamps the Cytoscape node body via the static stylesheet — animating the whole-card frame is a different concern (the body is on canvas, not in the overlay, so a halo would be needed analogous to `aud_node_appear_animation`'s halo). If product wants this it lands as a separate `aud_rollup_to_agreed_animation` task (~0.5-1d, NOT pre-registered today) wrapping the existing node-appear-overlay template with a new key shape and a different keyframe.
- **Per-pill withdrawal animation.** A facet flipping from `'agreed'` → `'withdrawn'` could in principle get its own "untwine" animation. NOT pre-registered (the methodology treats withdrawal as a methodology-significant but rare action; product hasn't surfaced a need).
- **Vote-indicator dot animation.** The `<FacetPill>` carries an inline `VoteIndicator` row for per-participant votes. Animating each vote-arrival (a participant just voted `agree` / `dispute`) is a separate concern from animating the *aggregate* facet transition. NOT pre-registered (a future `aud_vote_indicator_arrival_animation` task could cover it; speculative).
- **Pixel-stable frame-by-frame capture.** Animation timing is not captured by `aud_visual_regression`'s steady-state snapshots; the regression task pins post-animation steady state (the pill returns to its `'agreed'` paint after the 350 ms ripple). Animation-timing capture would be the speculative `aud_animation_video_regression` (~1d, NOT pre-registered today; the predecessor refinements also held off on registering it).
- **Pacing constant tuning across the animation set.** This leaf chooses 350 ms ease-out (matching the axiom-mark sibling — Decision §5 below); `aud_animation_pacing` is the cross-cutting cadence-tuning task that will revisit the constants alongside the other animation siblings' durations. The pacing task's `.tji` `depends` line already names `!aud_proposed_to_agreed_animation`, so no closer-time `depends` edit is required against this leaf.
- **A Playwright spec exercising the live transition.** Per the deferred-e2e exception in the orchestrator brief (component not yet reachable): the audience surface is still placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx); the per-session route lands in `aud_url_routing.aud_session_url`. Full deferral applies — the Vitest pins above cover the behavioural seam (wrapper class is/isn't applied per-render across the eight `FacetStatus` branches). Decision §6 documents the routing of this debt onto the already-accumulating chain.
- **Moderator-side per-facet transition animation.** The moderator's `<StatementNode>` ReactFlow children consume `<FacetPill>` in a different React tree. The shell badge is unchanged; the wrapper is audience-only. Cross-surface animation parity (`mod_facet_agreed_animation`) is **NOT pre-registered** (speculative; moderator's click-through workflow benefits less from animated transition vocabulary than the broadcast viewer's passive watch).
- **Participant-side animation.** Participant's facet-row in the detail panel consumes `<FacetPill>` (per the per-facet refactor). Same posture as moderator-side; NOT pre-registered.
- **`framer-motion`, `react-spring`, or any motion-framework dependency.** Rejected (Decision §1; cumulative posture of the `aud_animations.*` group, established by the predecessors and reinforced here).
- **Editing the shell `<FacetPill>`.** Rejected (Decision §3 of `aud_axiom_mark_animation.md`, adopted verbatim here). Animation is a surface-specific concern; the shell primitive stays cross-surface-neutral.

## Why it needs to be done

The methodology treats per-facet agreement as the **structural commitment milestone** at facet granularity. Per [`docs/methodology.md`](../../../docs/methodology.md) and [`packages/shell/src/facet-status/facet-status.ts`](../../../packages/shell/src/facet-status/facet-status.ts) (the `computeFacetStatuses` walk that the audience projection consumes via [`projectGraph.ts:226`](../../../apps/audience/src/graph/projectGraph.ts#L226)): a facet flips to `'agreed'` precisely when every current non-moderator participant has voted `'agree'` on the candidate value for that facet. This is the moment the conversation "settled" that facet — the proposer's wording for a node, the kind classification, or the substance — and the broadcast surface needs a temporal signal that **this just happened, on THIS pill, RIGHT NOW** so the passive viewer can follow the conversation's evolution in real time.

Without this leaf, a facet's transition to `'agreed'` is silent: the pill's appearance changes from the dashed slate `'proposed'` paint ([`PILL_STATUS_CLASSNAME.proposed`](../../../packages/shell/src/facet-pill/FacetPill.tsx#L77) — `border-dashed border-slate-400 text-slate-500 opacity-60`) to the solid slate `'agreed'` paint ([`PILL_STATUS_CLASSNAME.agreed`](../../../packages/shell/src/facet-pill/FacetPill.tsx#L78) — `border-solid border-slate-700 text-slate-700 opacity-100`), but the change is a single React re-render's worth of paint difference on a small chip in a corner of a dense canvas. A broadcast viewer not already looking at that specific pill at that specific tick has no way to learn the transition happened. The arrival animation is the broadcast surface's signal that a facet just landed agreement: a brief outline pulse + scale settle on the chip draws the eye within ~350 ms.

The `aud_animations` task group exists precisely to render the moment-of-arrival for each structural-event class — the axiom-mark sibling settled the per-participant declarative-mark class; the node-appear sibling settled the new-node class; this leaf settles the per-facet-agreement class, the third (and methodologically most central, since agreement is the explicit goal of the methodology) member of the group.

Downstream concretely:

- **`aud_animation_pacing`** ([`tasks/50-audience-and-broadcast.tji:352-355`](../../50-audience-and-broadcast.tji#L352)) is the cross-cutting cadence-tuning task; its `depends` list already names this leaf. Once the remaining `aud_animations.*` siblings (`aud_decomposition_animation`, `aud_withdrawal_animation`, `aud_diagnostic_fire_animation`) ship, pacing compares all six animation durations and may rebalance them so simultaneous arrivals (a new node WITH an immediately-agreed facet, say) don't visually collide. The 350 ms constant chosen here is one of three already-set inputs the pacing task will see.
- **`aud_session_url`** is the audience-reachability task; once it lands the inherited Playwright debt clears (Decision §6).
- **`aud_visual_regression`** pins the post-animation steady state — the chip returns to its `'agreed'` paint and the outline ripple fades to zero; no change to the steady-state visual contract.
- **The remaining `aud_animations.*` siblings** inherit a now well-established template: in-place-wrap inside the consuming overlay, `useSeenKeysGate` from the shared hooks with a per-event-class key shape, CSS-first keyframes, `prefers-reduced-motion` in CSS, no motion-framework dependency. This leaf adds the third instance and converts the pattern from "established by precedent" into "load-bearing canon for the rest of the group."

Architecturally, this leaf also pays down a small piece of pattern-coverage debt: the predecessor animation leaves both used a *creation-keyed* seen-set (the key was a stable per-element identifier, and "new" coincided with "newly created"). This leaf is the first instance of a *transition-keyed* seen-set, where the key encodes the target status and the seen-Set captures "this entity-facet pair has now been observed in the agreed state." The hook `useSeenKeysGate` is unchanged — the key shape is the caller's contract — but using it for a transition rather than an arrival proves the hook's neutrality and adds a third concrete usage to inform any future extraction of a typed "transition-gate" variant if more transition animations land.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience uses Cytoscape with React DOM overlays. Per-element React decoration (here, the wrapper around `<FacetPill>` inside the per-facet pill overlay) is the canonical pattern; Cytoscape's canvas-side `cy.animate(...)` API is unreachable from a React-rendered DOM overlay and is rejected for the same reasons the predecessor animations rejected it (Decision §1).
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the existing audience CSS lives at `apps/audience/src/index.css` with the Tailwind v4 `@import` and `@source` directives. The two predecessor keyframes (`aud-axiom-mark-land`, `aud-node-appear`) already coexist with Tailwind utilities at the same CSS layer ([`apps/audience/src/index.css:86-166`](../../../apps/audience/src/index.css#L86)). This leaf appends a third keyframe under the same convention.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest pins the React-side behaviour (per-render decision logic; presence/absence of the class across the eight `FacetStatus` branches). A Vitest pair reads the CSS file from disk to confirm the keyframe + reduced-motion clause exist. Pixel-level frame-by-frame animation capture is out of scope (no current task has frame-capture infrastructure).
- [ADR 0024 — Frontend i18n: react-i18next + ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — no new i18n keys. The animation has no visible text and adds no accessibility-label requirement; screen readers narrate the chip via the `<FacetPill>`'s existing localized facet name (`t('methodology.facet.<facet>')` per [`FacetPill.tsx:129`](../../../packages/shell/src/facet-pill/FacetPill.tsx#L129)), with or without animation.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the audience artifact owns its CSS; the new keyframe ships inside the audience bundle and does not leak to the moderator or participant artifacts.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the per-facet pill is the facet-layer surfacing; the animation lives on the same facet layer (the wrapper inside the per-facet pill overlay), orthogonal to the entity-layer rollup paint and the per-participant axiom-mark badge row.
- [ADR 0030 — Per-facet vote keying](../../../docs/adr/0030-per-facet-vote-keying.md) — `'agreed'` is one of the seven `FacetStatus` values; the transition is observable purely from the projection's per-tick `data.facetStatuses` record. No projection-time helper or new emission is required.

No new ADR. The architectural seams (CSS-first wrapper-animation on a React-keyed inner element, `useSeenKeysGate`-driven gate with a transition-encoding key, `prefers-reduced-motion` in CSS, no motion-framework dependency, no shell-primitive edit) are either settled by existing ADRs or by the cumulative posture the two animation predecessors established and this leaf reinforces.

### Sibling refinements

- [`tasks/refinements/audience/aud_axiom_mark_animation.md`](aud_axiom_mark_animation.md) — the direct shape-precedent for "wrap an inner element inside an existing overlay" animation. Decision §1 (CSS keyframe + React-keyed wrapper), §3 (audience-only wrapper, no shell edit), §4 (seen-Set initial-mount guard; lazy-init), §5 (350 ms `cubic-bezier(0.16, 1, 0.3, 1)`), §6 (Vitest pins React-side + CSS-file presence; Playwright deferred) all apply verbatim modulo the key shape (`${nodeId}:${facet}` over agreed entries vs `${nodeId}:${participantId}` over all marks).
- [`tasks/refinements/audience/aud_node_appear_animation.md`](aud_node_appear_animation.md) — the second animation precedent; reinforced the cumulative posture. Decision §2 (consume shared overlay primitives rather than introducing a render-prop) maps here too: this leaf calls `useCytoscapeOverlayPlacements` (already in place) and `useSeenKeysGate` (newly invoked) from `cytoscapeOverlayHooks.ts`.
- [`tasks/refinements/audience/aud_dom_overlay_extraction.md`](aud_dom_overlay_extraction.md) — the extraction that established `useCytoscapeOverlayPlacements` + `useSeenKeysGate`. The hook signatures are stable and consumed here unchanged; this leaf is the second `useSeenKeysGate` caller (the first is `<AudienceNodeAppearOverlay>` at [`NodeAppearOverlay.tsx:111`](../../../apps/audience/src/graph/NodeAppearOverlay.tsx#L111)).
- [`tasks/refinements/audience/aud_per_facet_visualization.md`](aud_per_facet_visualization.md) — the substrate overlay this leaf decorates. Decision §3 (canonical reading order `wording → classification → substance`), §4 (rAF-batched commit), §5 (`cyState` slot) are unchanged.
- [`tasks/refinements/audience/aud_proposed_styling.md`](aud_proposed_styling.md), [`tasks/refinements/audience/aud_agreed_styling.md`](aud_agreed_styling.md) — the per-status palette refinements. The pill's `'proposed'` vs `'agreed'` paint difference is the pre- and post-animation steady state; this leaf's keyframe transitions between those two visual states without modifying either.
- [`tasks/refinements/shell-package/extract_facet_pill.md`](../shell-package/extract_facet_pill.md) — the shell-extraction refinement that established `<FacetPill>` as the cross-surface primitive. This leaf intentionally does NOT modify the shell pill — the animation wrapper lives one layer up, in the audience overlay only, preserving the shell pill's cross-surface neutrality.

### Live code the leaf modifies / creates

- [`apps/audience/src/graph/PerFacetPillOverlay.tsx`](../../../apps/audience/src/graph/PerFacetPillOverlay.tsx) (lines 105-144 — render block) — gains a call to `useSeenKeysGate` over the currently-`'agreed'` `${p.id}:${facet}` keys derived from `placements`, plus a `<span data-pill-agreed-anim>` wrapper around each `<FacetPill>`; the wrapper's `className` is `aud-pill-agreed` when the gate's `isNew(...)` predicate returns true. Header comment-block (lines 1-46) extends with a refinement-trail entry summarizing Decisions §1-§6.
- [`apps/audience/src/graph/PerFacetPillOverlay.test.tsx`](../../../apps/audience/src/graph/PerFacetPillOverlay.test.tsx) — gains 6 new Vitest cases (listed below under Acceptance criteria); existing cases continue to pass unchanged (the wrapper `<span>` is additive — existing pill selectors via `[data-facet-pill]` keep matching because the `<FacetPill>` testid is unchanged and the wrapper `<span>` sits between row and pill).
- [`apps/audience/src/graph/cytoscapeOverlayHooks.ts`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts) — UNCHANGED. The hook is consumed unchanged; the key shape is the caller's contract.
- [`apps/audience/src/graph/AxiomMarkOverlay.tsx`](../../../apps/audience/src/graph/AxiomMarkOverlay.tsx), [`apps/audience/src/graph/AnnotationOverlay.tsx`](../../../apps/audience/src/graph/AnnotationOverlay.tsx), [`apps/audience/src/graph/NodeAppearOverlay.tsx`](../../../apps/audience/src/graph/NodeAppearOverlay.tsx), [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) — UNCHANGED. No new overlay; no new mount line.
- [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts) — UNCHANGED. The transition is observable purely from the existing per-tick `data.facetStatuses` record; no projection field needs adding.
- [`apps/audience/src/graph/stylesheet.ts`](../../../apps/audience/src/graph/stylesheet.ts) — UNCHANGED. Cytoscape's node selectors stay paint-only; the animation lives entirely in the React + CSS overlay layer.
- [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) — MODIFIED. Append a `@keyframes aud-pill-agreed` block, a `.aud-pill-agreed` utility class that consumes it, and the matching `prefers-reduced-motion: reduce` override.
- [`apps/audience/src/index.test.ts`](../../../apps/audience/src/index.test.ts) — MODIFIED. 2 new Vitest cases appended to the existing 4 asserting `@keyframes aud-pill-agreed` presence and the matching reduced-motion override clause.
- [`packages/shell/src/facet-pill/FacetPill.tsx`](../../../packages/shell/src/facet-pill/FacetPill.tsx) — UNCHANGED. Cross-surface neutrality (Decision §3 of `aud_axiom_mark_animation.md`, adopted verbatim here).
- [`packages/shell/src/facet-status/facet-status.ts`](../../../packages/shell/src/facet-status/facet-status.ts) — UNCHANGED. The `computeFacetStatuses` derivation that flips a facet to `'agreed'` is unchanged; this leaf observes the result through the projection-emitted `data.facetStatuses` record.
- `apps/audience/package.json` — UNCHANGED. No new dependency.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**`, `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx` — UNCHANGED.

### What the surface MUST NOT do

- **No new dependency.** `framer-motion`, `react-spring`, `@react-spring/web`, `motion`, `react-transition-group` are all rejected (Decision §1).
- **No edit to `@a-conversa/shell`.** The shell `<FacetPill>` is cross-surface; the audience animates by wrapping, not by modifying the shell primitive (Decision §3 of the axiom-mark predecessor, adopted here).
- **No `cy.animate(...)` call.** The pill is a React-rendered DOM-overlay sibling of the Cytoscape canvas, fundamentally unreachable by `cy.animate(...)`. The animation lives entirely in the React + CSS layer.
- **No JavaScript-driven animation loop.** No `requestAnimationFrame`-pump that tweens scale/opacity per frame; no `setTimeout` chain. The CSS keyframe runs on the GPU compositor; JS only decides which wrappers get the class.
- **No animation on initial mount.** Facets already in `'agreed'` state at first non-empty placement commit are seeded into the seen-Set (via `useSeenKeysGate`'s lazy-init-on-non-empty contract) and rendered without the animation class.
- **No animation re-fire on pan/zoom/resize.** Because the wrapper is keyed by `facet` inside a row keyed by `p.id` and React reconciles by key, the existing wrapper DOM is reused across re-renders. Once the `aud-pill-agreed` class lands on a wrapper, subsequent renders find the key in the seen-Set and the predicate returns `false` — the class is not re-applied. (Re-applying an already-present class would not re-fire a CSS animation either, but the predicate semantics ensure the className string is byte-stable across renders, which keeps React's class-diff a no-op.)
- **No animation on a facet flipping AWAY from `'agreed'`.** A `'agreed'` → `'withdrawn'` (or `'agreed'` → `'committed'`, if methodology supports it post-agreement) transition takes the key out of `currentKeys` — the seen-Set still holds the key (it's only ever added, never removed), so a subsequent re-arrival at `'agreed'` would NOT re-animate. This is intentional: the methodology treats agreement as a structural commitment; re-agreement after withdrawal is rare and not currently a methodology pattern, so the conservative "animate only the first observed agreement per (node, facet) per session" gate is correct. (A future task could relax this if re-agreement animation is wanted.)
- **No animation on `'awaiting-proposal'`, `'proposed'`, `'disputed'`, `'committed'`, `'withdrawn'`, `'meta-disagreement'`.** The key for each (node, facet) pair is contributed to `currentKeys` ONLY when the current status is `'agreed'`. The other six branches contribute no key, never participate in the gate, never get the class.
- **No new `data-testid` on the wrapper for behavioural assertions.** The wrapper carries `data-pill-agreed-anim` as a presence-marker only (not a testid). Existing test selectors via `[data-facet-pill]` keep working; the new wrapper is transparent to existing assertions. The 6 new Vitest cases assert on the presence/absence of the `aud-pill-agreed` class on the wrapper, located via `closest('[data-pill-agreed-anim]')` from the pill.
- **No edit to `<AudienceAxiomMarkOverlay>`, `<AudienceAnnotationOverlay>`, `<AudienceNodeAppearOverlay>`, or the GraphView mount sequence.** No new overlay sibling; the per-facet pill overlay is the right home (Decision §2).
- **No edit to the moderator or participant surfaces.** Cross-surface animation parity is explicitly out of scope.
- **No new i18n keys.** The animation has no visible label and adds no a11y prose. Screen readers narrate the existing `<FacetPill>` content.
- **No edit to `tasks/50-audience-and-broadcast.tji` beyond the closer's `complete 100`.** The `aud_animation_pacing` `depends` line ALREADY names `!aud_proposed_to_agreed_animation` (verified at [line 355](../../50-audience-and-broadcast.tji#L355)), so no closer-time `depends` edit is required against this leaf.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/PerFacetPillOverlay.tsx` — MODIFIED. The render block change (additions marked NEW; existing structure preserved):

  ```tsx
  // (existing) const placements = useCytoscapeOverlayPlacements<PillRowPlacement>(cy, commitPerFacetPlacements);

  // NEW — collect the currently-`'agreed'` (nodeId, facet) keys for the gate.
  const agreedPillKeys: string[] = [];
  for (const p of placements) {
    for (const facet of FACET_RENDER_ORDER) {
      if (p.facetStatuses[facet] === 'agreed') agreedPillKeys.push(`${p.id}:${facet}`);
    }
  }
  const isNewAgreedPill = useSeenKeysGate(agreedPillKeys); // NEW

  return (
    <div
      data-testid="audience-per-facet-pill-overlay"
      className="pointer-events-none absolute inset-0"
    >
      {placements.map((p) => (
        <div /* (existing row wrapper unchanged) */ key={p.id} data-facet-pill-row="" /* ... */>
          {FACET_RENDER_ORDER.map((facet) => {
            const status = p.facetStatuses[facet];
            if (status === undefined) return null;
            const isNew = status === 'agreed' && isNewAgreedPill(`${p.id}:${facet}`); // NEW
            return (
              <span
                key={facet}
                data-pill-agreed-anim=""
                data-element-id={p.id}
                data-facet-name={facet}
                className={isNew ? 'aud-pill-agreed' : ''}
              >
                <FacetPill facet={facet} status={status} />
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
  ```

  The wrapper keys by `facet` (matching the existing inner `key={facet}` slot the `<FacetPill>` previously occupied) so React's reconciliation reuses the same wrapper across rerenders. The `data-element-id` + `data-facet-name` carriers on the wrapper let the test layer locate the wrapper independently of the inner pill's `data-facet-name` (which the shell pill already carries — the test asserts on the WRAPPER's class, so resolving via `closest('[data-pill-agreed-anim]')` from the pill is the canonical seam). Header comment-block extends with a refinement-trail entry citing Decisions §1-§6.

  Import addition: `import { useCytoscapeOverlayPlacements, useSeenKeysGate } from './cytoscapeOverlayHooks.js';` (the file imports `useCytoscapeOverlayPlacements` today; this adds `useSeenKeysGate` to the same line).

- `apps/audience/src/graph/PerFacetPillOverlay.test.tsx` — MODIFIED. 6 new Vitest cases added; existing cases pass unchanged. The new cases:
  1. **Initial-mount: no animation class on `'agreed'` pills.** Mount the overlay with a `cy` instance carrying two nodes whose `data.facetStatuses` includes a `'wording'` facet in `'agreed'` state. The rendered pill's wrapper (located via `closest('[data-pill-agreed-anim]')` from `[data-facet-pill]`) does NOT carry the `aud-pill-agreed` class. (Pins the lazy-init-on-non-empty contract through the `useSeenKeysGate` seam.)
  2. **Post-mount transition: animation class on the freshly-agreed pill.** Mount with one node carrying `wording: 'proposed'`; then `act(() => { cy.nodes().first().data('facetStatuses', { wording: 'agreed' }); })` to fire the `data` event. After the rAF-batched commit, the wrapper for the `wording` facet on that node DOES carry the `aud-pill-agreed` class.
  3. **Post-mount transition: prior-agreed sibling stays unanimated.** Mount with one node where `classification: 'agreed'` (already agreed at mount) and `wording: 'proposed'`; then mutate to `wording: 'agreed'`. After the rerender, the `classification` wrapper does NOT carry the class (it was seeded at mount); the `wording` wrapper DOES (it's the freshly-agreed transition).
  4. **Rerender with identical statuses: no class spread.** Mount, then trigger `cy.emit('pan')` (which causes the rAF-batched commit to re-snapshot the same placements). After the second commit, no wrapper carries the class.
  5. **Non-`'agreed'` status never animates.** Mount with one node where `wording: 'proposed'`; mutate to `disputed`. The wrapper for `wording` does NOT carry the class. Repeat for `committed`, `withdrawn`, `meta-disagreement`, `awaiting-proposal` (one assertion per branch, parameterized).
  6. **Wrapper presence-marker.** Every rendered pill sits inside a `[data-pill-agreed-anim]` ancestor — the wrapper is unconditional, only the class is conditional. Confirms the test selector seam `closest('[data-pill-agreed-anim]')` works for every pill regardless of status.

  Existing tests continue to pass because the `<span data-pill-agreed-anim>` wrapper sits between `<div data-facet-pill-row>` (row) and `<span data-facet-pill>` (the inner shell pill). Any `querySelector('[data-facet-pill]')` traversal still resolves; the additional wrapper does not perturb React keyed reconciliation (row key by `p.id`; wrapper key by `facet` — matches the prior inner-pill key slot).

- `apps/audience/src/index.css` — MODIFIED. Append (after the existing `aud-node-appear` block):

  ```css
  /* `aud_proposed_to_agreed_animation` — one-shot pulse on per-facet
   * pill transition to `'agreed'`.
   * Refinement: tasks/refinements/audience/aud_proposed_to_agreed_animation.md
   *   Decision §1 — CSS `@keyframes` on a React-keyed wrapper around the
   *   inner `<FacetPill>`, NOT a JS-driven tween, NOT a motion-framework
   *   dependency. The wrapper class is gated by `useSeenKeysGate` over
   *   currently-`'agreed'` `${nodeId}:${facet}` keys; CSS keyframes fire
   *   once when the class lands on a previously-class-less wrapper, then
   *   never again (React's keyed reconciliation reuses the wrapper).
   *   Decision §5 — 350 ms with `cubic-bezier(0.16, 1, 0.3, 1)`
   *   ("emphasized decelerate"); parity with the axiom-mark sibling's
   *   350 ms because both animations mark a methodology-significant
   *   commit moment (axiom-mark = participant declaration; per-facet
   *   agreement = participant aggregate). `aud_animation_pacing`
   *   revisits the constant alongside the other animation siblings'.
   *   `forwards` fill-mode keeps the pulse's `to` state (scale 1,
   *   transparent outline) after the animation completes so the chip
   *   returns cleanly to its `'agreed'` paint with no residual outline.
   *   Decision §6 — `prefers-reduced-motion: reduce` suppression is in
   *   CSS (not TS — the class is always emitted by the render path).
   *
   * The keyframe animates a scale settle plus an outward `box-shadow`
   * ripple that fades to zero — visually reads as "agreement settled on
   * this chip just now". The slate-700 ripple color matches the
   * `'agreed'` border palette (`PILL_STATUS_CLASSNAME.agreed` in
   * `packages/shell/src/facet-pill/FacetPill.tsx`) so the pulse reads
   * as "of the agreed-state surface". */
  @keyframes aud-pill-agreed {
    from {
      transform: scale(0.92);
      box-shadow: 0 0 0 0 rgba(15, 23, 42, 0.45);
    }
    to {
      transform: scale(1);
      box-shadow: 0 0 0 6px rgba(15, 23, 42, 0);
    }
  }

  .aud-pill-agreed {
    display: inline-block;
    animation: aud-pill-agreed 350ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
    border-radius: 9999px;
  }

  @media (prefers-reduced-motion: reduce) {
    .aud-pill-agreed {
      animation: none;
    }
  }
  ```

  The `display: inline-block` on `.aud-pill-agreed` is load-bearing: the wrapper is a `<span>` which defaults to `display: inline`, on which CSS `transform` and `box-shadow` paint differently (inline elements ignore `transform` on their own layout box in some engines). `inline-block` ensures the transform and box-shadow apply to the wrapper's box. `border-radius: 9999px` matches the inner pill's `rounded-full` (Tailwind's pill shape) so the outward `box-shadow` ripple renders as a rounded halo rather than a hard-cornered rectangle. The slate-700-ish color (`rgba(15, 23, 42, 0.45)`) matches the `'agreed'` border palette (`border-slate-700` per [`FacetPill.tsx:78`](../../../packages/shell/src/facet-pill/FacetPill.tsx#L78)).

- `apps/audience/src/index.test.ts` — MODIFIED. Append 2 cases parallel to the existing 4:
  1. `apps/audience/src/index.css` contains the substring `@keyframes aud-pill-agreed`.
  2. `apps/audience/src/index.css` contains both `prefers-reduced-motion: reduce` AND, within (or after) that media-block, a `.aud-pill-agreed { animation: none` override (whitespace-tolerant). The assertion can be a regex that looks for the literal `.aud-pill-agreed` followed by `{ animation: none` (with optional whitespace) anywhere in the file content (same pattern as the predecessor two CSS smoke pins).

### Files this task does NOT touch

- `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — UNCHANGED.
- `packages/shell/**`, `packages/shared-types/**`, `packages/i18n-catalogs/**` — UNCHANGED.
- `apps/audience/src/graph/projectGraph.ts`, `apps/audience/src/graph/stylesheet.ts`, `apps/audience/src/graph/facetStatus.ts`, `apps/audience/src/graph/layoutOptions.ts`, `apps/audience/src/graph/cytoscapeTestEnv.ts`, `apps/audience/src/graph/cytoscapeOverlayHooks.ts`, `apps/audience/src/graph/AxiomMarkOverlay.tsx`, `apps/audience/src/graph/AnnotationOverlay.tsx`, `apps/audience/src/graph/NodeAppearOverlay.tsx`, `apps/audience/src/graph/GraphView.tsx`, `apps/audience/src/graph/axiomMarks.ts` — UNCHANGED.
- `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx` — UNCHANGED.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED (no new dep).
- `docs/adr/**` — UNCHANGED. No new ADR.
- `playwright.config.ts` / `tests/e2e/**` — UNCHANGED. Playwright deferral per Decision §6.
- `.tji` files — `complete 100` lands at task-completion time per the [README ritual](../README.md); the closer owns that single edit (no `depends` line touch is required — `aud_animation_pacing` already names `!aud_proposed_to_agreed_animation`).

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/PerFacetPillOverlay.tsx` carries the `agreedPillKeys` derivation, the `useSeenKeysGate(agreedPillKeys)` call, the `<span data-pill-agreed-anim>` wrapper, and the conditional `aud-pill-agreed` class per Constraints. Header comment-block extended with the refinement-trail entry for Decisions §1-§6.
- `apps/audience/src/graph/PerFacetPillOverlay.test.tsx` carries the 6 new Vitest cases listed above; all 6 pass; all existing cases pass unchanged.
- `apps/audience/src/index.css` carries the `@keyframes aud-pill-agreed` rule, the `.aud-pill-agreed` utility (with `display: inline-block`, `border-radius: 9999px`, `forwards` fill-mode), and the `prefers-reduced-motion: reduce` override per Constraints.
- `apps/audience/src/index.test.ts` carries the 2 new cases (in addition to the existing 4 for `aud-axiom-mark-land` and `aud-node-appear`); the file's total assertion count is 6.
- `packages/shell/src/facet-pill/FacetPill.tsx` is byte-unchanged (cross-surface neutrality).
- `apps/audience/package.json` is byte-unchanged (no new dependency).
- The four existing audience overlay tests (`PerFacetPillOverlay.test.tsx`'s existing cases, `AxiomMarkOverlay.test.tsx`, `AnnotationOverlay.test.tsx`, `NodeAppearOverlay.test.tsx`) and the `cytoscapeOverlayHooks.test.tsx` pass byte-unchanged.
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer pins (a) the React-side per-render class logic via 6 cases on the modified overlay component covering all eight `FacetStatus` branches and (b) the CSS file's keyframe + reduced-motion definitions via the 2 new cases in `index.test.ts`. Animation-timing pixel capture is left to the speculative `aud_animation_video_regression` (NOT pre-registered today).
- Per the orchestrator brief's deferred-e2e exception ("component not yet reachable"): Playwright coverage for the animation is **deferred to `aud_url_routing.aud_session_url`** — the same destination as the two animation predecessors. This refinement registers the deferred-e2e debt as prose under the Status block (the closer of `aud_session_url` reads the accumulated chain — `aud_cytoscape_init.md` / `aud_state_management.md` / `aud_ws_client.md` / `aud_axiom_mark_decoration.md` / `aud_axiom_mark_animation.md` / `aud_node_appear_animation.md` / this leaf — and scopes the Playwright spec at that point). The two scenarios this leaf contributes: (i) a freshly-transitioned `'agreed'` pill's wrapper carries the `aud-pill-agreed` class; (ii) a pill already in `'agreed'` state at page load does NOT carry the class. See Decision §6 for the routing rationale.
- The closer does NOT need to edit the `aud_animation_pacing` `depends` line — verified at [`tasks/50-audience-and-broadcast.tji:355`](../../50-audience-and-broadcast.tji#L355) it already names `!aud_proposed_to_agreed_animation`.
- `pnpm run check` clean (strict TS pass; no new dep declared).
- `pnpm run test:smoke` green (Vitest count rises by 6 (new overlay tests) + 2 (CSS smoke pins) = 8 new cases).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is negligible — a few lines of additional JS in the existing component (~80-120 bytes net of the wrapper + key derivation), one CSS block (~25 lines), no new dependency.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_proposed_to_agreed_animation` in the same commit (the closer's ritual).

## Decisions

### §1 — CSS `@keyframes` on a React-keyed wrapper inside the existing per-facet pill overlay (NOT a JS-driven tween, NOT a motion framework, NOT a separate overlay sibling)

Four options for "animate a per-facet pill at the moment its status transitions to `'agreed'`":

A. **Modify `<AudiencePerFacetPillOverlay>` to wrap each `<FacetPill>` with `<span data-pill-agreed-anim>` and gate the `aud-pill-agreed` class via `useSeenKeysGate` over currently-`'agreed'` keys.** Reuses the same overlay that already renders the pill; the gate hook is already in the codebase. Behaviour-preserving for non-agreed branches; additive for the `'agreed'` branch.

B. **Create a new `<AudienceProposedToAgreedHaloOverlay>` sibling that paints a separate halo `<span>` at each freshly-agreed pill's screen position.** Mirrors `<AudienceNodeAppearOverlay>`'s posture (a dedicated overlay for the animation, separate from the steady-state overlay).

C. **JS-driven tween via `requestAnimationFrame` directly.** Maintain per-(node, facet) animation state (start time, current frame); on each rAF tick, compute the easing fraction and write style on the wrapper.

D. **`framer-motion` (or equivalent) layout animation.** Wrap each pill in a `<motion.span animate={...} />`.

**Chosen: A.** The pill's pre- and post-animation steady state both live inside `<AudiencePerFacetPillOverlay>` — the same component already computes positions, iterates the canonical reading order, reads `data.facetStatuses`. Adding a wrapper there is the minimal change that puts the animation at the right granularity (per-pill, not per-row, not per-node). The `useSeenKeysGate` hook's contract is identical whether the key encodes an element identity (axiom-mark, node-appear) or a transition target (agreed): the hook returns `isNew(key)` over `currentKeys` with lazy-init on first non-empty. The caller chooses the key shape.

Option B is rejected because a separate overlay would need to duplicate the per-pill positioning math (the per-pill X offset within a row's `display: flex; gap: 4px` layout is internal to the row; duplicating it in a sibling overlay would couple two overlays through a flex-internal coordinate transform, which is fragile — any future change to the row's flex / gap / padding requires synchronized edits to the halo overlay). The axiom-mark predecessor already chose the same in-place-wrap approach (Decision §1 of `aud_axiom_mark_animation.md`) for the same reason. Option B is the right answer ONLY when the animation target is an element NOT already rendered by an existing overlay (the case `<AudienceNodeAppearOverlay>` handled: the node body is on Cytoscape's canvas, not in any React overlay, so a new React overlay was needed).

Option C is rejected as needless complexity — JS-driven tweens reinvent what the CSS compositor does for free, run on the main thread, and require manual reduced-motion plumbing.

Option D is rejected for the same reason the predecessors rejected it — the audience surface has zero motion-framework dependencies, and the cumulative `aud_animations.*` posture is CSS-first.

### §2 — Wrap inside the existing overlay (NOT a parallel halo overlay sibling)

Subsumed under §1's rejection of option B, but called out separately because it is the load-bearing structural choice. Two sub-options once the in-place-wrap approach is chosen:

A. **Wrap each `<FacetPill>` with `<span data-pill-agreed-anim>` directly in `<AudiencePerFacetPillOverlay>`'s render loop.** The wrapper is unconditional (every pill is wrapped); the `aud-pill-agreed` class is conditional.

B. **Conditionally render the wrapper only when the pill is currently `'agreed'`.** Saves one wrapper per non-agreed pill.

**Chosen: A.** The unconditional wrapper preserves a stable test seam (`closest('[data-pill-agreed-anim]')` from `[data-facet-pill]` works for EVERY pill, not just agreed ones, so tests asserting on the absence of the class don't need to handle the "wrapper isn't there" branch separately). The wrapper `<span>` has zero CSS without the class, so the DOM-cost is one extra `<span>` per pill — entirely negligible. This mirrors the axiom-mark predecessor's "wrapper unconditional, class conditional" pattern (Decision §4 of `aud_axiom_mark_animation.md`).

### §3 — Audience-only wrapper (NOT modify shell `<FacetPill>`)

Same reasoning as Decision §3 of `aud_axiom_mark_animation.md` (which itself adopted the shell-axiom-mark precedent). Two options:

A. **Wrap the shell pill in the audience overlay.** Add a `<span>` between the row and the pill in `PerFacetPillOverlay.tsx`; the wrapper carries the animation class; the shell pill is unchanged.

B. **Add an `animateOnAgreedTransition?: boolean` (or `wrapperClassName?: string`) prop to the shell `<FacetPill>`.** The audience passes it true; the moderator passes false.

**Chosen: A.** `<FacetPill>` is a cross-surface primitive (moderator + audience + participant detail panel + sidebar ProposalFacetBreakdown chips per `extract_facet_pill.md`). Animation is a surface-specific concern (the broadcast audience benefits; the moderator's click-through workflow does not — moderators see facets transition while clicking through their own affordances; the participant's detail panel is for proposing/voting, not passively watching). Adding a per-surface animation prop pushes a presentation concern into a shared primitive, growing the API surface for one surface's benefit. Wrapping in the consuming overlay keeps the shell pill's contract pure and confines the animation logic to the audience workspace. If cross-surface animation parity is ever wanted, the right answer is to refactor the wrapper into a shell-side primitive at that time, not to grow the shell pill's prop set today.

### §4 — `useSeenKeysGate` with the transition-encoding key `${nodeId}:${facet}` drawn from currently-`'agreed'` entries

Three options for the seen-Set / key-shape:

A. **`useSeenKeysGate(currentAgreedKeys)` where `currentAgreedKeys = placements.flatMap(p => FACET_RENDER_ORDER.filter(f => p.facetStatuses[f] === 'agreed').map(f => '${p.id}:${f}'))`.** The key encodes the (node, facet) pair; the array is filtered to only currently-`'agreed'` entries. First non-empty commit seeds with whatever facets are agreed at audience-join; subsequent commits where a (node, facet) flips to `'agreed'` produce a key not yet in the set, which the gate returns as new. Non-`'agreed'` statuses contribute no key — they don't seed and don't animate.

B. **`useSeenKeysGate(allCurrentPillKeys)` over all (node, facet) pairs regardless of status; gate the animation class on `status === 'agreed' && isNew(key)`.** The Set tracks every observed (node, facet) pair; the animation only fires when a key not-yet-in-set is currently-`'agreed'`.

C. **A bespoke `useRef<Map<string, FacetStatus>>` tracking previous status per (node, facet); animate when the previous-status was `'proposed'` (or `'awaiting-proposal'`) and the current is `'agreed'`.** Encodes the transition explicitly.

**Chosen: A.** The hook's contract is "first time a key shows up in `currentKeys`, return true (and remember it); thereafter return false." Filtering `currentKeys` to only `'agreed'` entries makes the hook's "first observation" semantics line up exactly with "first observation in the `'agreed'` state": the only keys ever passed to the hook are `${nodeId}:${facet}` pairs where the current status is `'agreed'`. The first non-empty commit's `currentKeys` is the snapshot of all agreed pairs at audience-join time — those seed; subsequent commits where a new (node, facet, 'agreed') pair shows up produce a key that wasn't in the seed; the hook returns it as new. Other status transitions never produce a key for this gate and so never animate.

Option B is rejected because the seed semantics would over-claim: the Set would seed with EVERY (node, facet) pair the audience saw at first commit, not just the agreed ones. A facet that was `'proposed'` at audience-join and later transitions to `'agreed'` would have its key already in the Set (because it was added during the initial seed), and the gate's `isNew` would return `false` — the freshly-agreed pill would NOT animate. That breaks the contract. The fix would be a separate "what status was it last time" track — at which point option C is the cleaner shape. But option A captures the intent with the existing hook unchanged, so it's the cleanest design.

Option C is rejected because it duplicates state the projection already maintains (the `data.facetStatuses` record IS the current state; a parallel `useRef<Map>` would mirror it). The "previous status" angle is also weaker: the methodology distinguishes several pre-agreement states (`'proposed'`, `'awaiting-proposal'`, `'meta-disagreement'`), and "from any of these to `'agreed'`" is the actual contract — encoding the source state explicitly adds friction without value. The seen-Set-keyed-on-target-status (option A) is the minimal correct shape.

A subtle property of option A: if a facet flips `'agreed'` → (somewhere else) → `'agreed'` mid-session, the seen-Set still holds the key from the first `'agreed'` observation, so the re-arrival at `'agreed'` does NOT re-animate. This is intentional (per the "What MUST NOT do" enumeration above): the methodology treats `'agreed'` as a structural commitment; re-agreement after withdrawal is rare and not a methodology pattern, so the conservative "animate the first observation per session" gate is correct. A future task could relax this if re-agreement animation is wanted.

The lazy-init-on-non-empty contract of `useSeenKeysGate` ([`cytoscapeOverlayHooks.ts:162`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts#L162)) handles the rAF-batched-empty-first-render correctly: when `currentKeys` is empty on first render (no placements yet because the rAF hasn't fired), the gate stays un-seeded and the predicate returns `false` for all calls; when the first non-empty commit arrives, the gate seeds from those keys (any pre-existing agreed pills are seeded as "seen"); subsequent commits run the gate normally. This is the same contract the predecessor animations rely on.

### §5 — 350 ms `cubic-bezier(0.16, 1, 0.3, 1)` with `forwards` fill-mode (parity with axiom-mark sibling; `aud_animation_pacing` revisits)

Three options for the timing curve and duration:

A. **350 ms `cubic-bezier(0.16, 1, 0.3, 1)` with `forwards` fill** (parity with axiom-mark sibling's 350 ms).

B. **450 ms with the same curve** (parity with node-appear sibling's 450 ms).

C. **250 ms snappier ease-out** (faster, less attention-demanding).

**Chosen: A.** The 350 ms with decelerated easing matches "lands and sticks" semantics — fast initial scale-up + outline pulse, settles into the resting state. The duration parity with the axiom-mark sibling is principled: both animations mark a methodology-significant commit moment (the axiom-mark is a per-participant declaration; the per-facet agreement is a per-participant aggregate). They belong to the same "commit cadence" — the broadcast viewer's perceptual classification should not separate them. The node-appear sibling's 450 ms is justified by its larger geometry (a 96px halo against a dense canvas) — the per-pill animation's geometry is small (one chip, ~24-32px wide), so the shorter 350 ms is the right tonal match.

The `forwards` fill-mode is load-bearing: the keyframe's `to` state is `transform: scale(1); box-shadow: 0 0 0 6px rgba(15, 23, 42, 0)` — the pulse fades to transparent and the pill returns to scale 1. Without `forwards`, the pill would snap back to the `from` state (scale 0.92, opaque outline) at the end of the animation, leaving a visible residual outline.

Option B is rejected — the geometry argument cuts the other way (small chip, brisk animation). Option C is rejected — at 250 ms the broadcast viewer's eye barely has time to register the pulse, and the methodology treats agreement as significant enough to warrant the standard 350 ms commit cadence.

The 350 ms constant is **initial** and may be tuned by `aud_animation_pacing` once the other animation siblings ship. The pacing task's `depends` list already includes `!aud_proposed_to_agreed_animation`, so this constant becomes one of the durations the pacing task sees and may rebalance.

### §6 — Vitest pins React-side class logic + CSS file presence; Playwright deferred to `aud_session_url`

The Vitest cases pin the behavioural contract:
- Per-render decision logic across all eight `FacetStatus` branches (only `'agreed'` ever produces the class; only on first observation per (node, facet) per session; rerender with same statuses does not re-animate).
- CSS keyframe + reduced-motion override presence in the audience CSS file (string-grep smoke pin).

What the tests deliberately do NOT pin:
- Pixel-by-pixel frame capture of the animation (no current frame-capture infrastructure; speculative future `aud_animation_video_regression` is NOT pre-registered).
- Actual CSS rendering (jsdom does not run keyframes; the React tests assert on the class being present, the CSS-file test asserts on the keyframe being defined; together they pin the React→CSS seam end-to-end).
- Live transition in a real audience session (Playwright deferred per the orchestrator brief's "component not yet reachable" exception — the audience is still placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx)).

**Playwright destination check.** The orchestrator brief calls out: "Watch the inherited-debt count on `mod_pw_*` (and similar) catch-all e2e tasks. Before deferring to a future Playwright task, check how many prior refinements already point at it. If it's inheriting from 2+ refinements already, pay debt down instead." The `aud_session_url` task is the audience-side equivalent. As of this leaf, the chain pointing at `aud_session_url`'s Playwright scope includes: `aud_cytoscape_init.md`, `aud_state_management.md`, `aud_ws_client.md`, `aud_axiom_mark_decoration.md`, `aud_axiom_mark_animation.md`, `aud_node_appear_animation.md` — six refinements. Adding this leaf brings the count to seven.

**Justification for deferring rather than splitting.** The orchestrator's threshold ("if it's inheriting from 2+ refinements already, pay debt down") suggests splitting the deferral target. However, the same justification the node-appear predecessor surfaced applies here verbatim: (a) every refinement in the chain is exercising the same surface (the audience graph + overlays once reachable via the `/sessions/:id` route), (b) the Playwright spec for `aud_session_url` will necessarily mount the full audience under a real route and assert against the rendered DOM, and (c) the per-leaf scenarios are mostly assertion-additions onto a single test fixture (one mounted audience session, multiple `expect(...)` calls). Splitting the deferral target (e.g., a separate `aud_pw_animations` task) would re-mount the same audience fixture for a different subset of assertions and pay the same Playwright startup cost twice. The structural decision (one large spec under `aud_session_url` vs multiple smaller `aud_pw_*` tasks) belongs to the `aud_session_url` refinement, not to this leaf. The node-appear sibling already made the same call; this leaf joins that chain.

This leaf contributes two scenarios to the chain:
1. After mounting a session whose initial event log contains nodes with `'agreed'` facets, none of the rendered `[data-pill-agreed-anim]` wrappers carry the `aud-pill-agreed` class.
2. After a subsequent commit arrives via the WS stream that flips a facet from `'proposed'` (or `'awaiting-proposal'`) to `'agreed'`, the wrapper for that specific (node, facet) DOES carry the `aud-pill-agreed` class within the rAF settle window. Wrappers for other already-agreed pills on the same node and other still-`'proposed'` pills do NOT carry the class.

Pixel-stable post-animation steady state is already covered by `aud_visual_regression`'s per-status palette fixtures (inherited from `aud_proposed_styling.md` / `aud_agreed_styling.md` / `aud_disputed_styling.md`) — the pulse completes within 350 ms and the steady-state frame is identical to the pre-animation `'agreed'` paint, so the existing pixel pins continue to apply unchanged with or without this leaf.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-29.

- `apps/audience/src/graph/PerFacetPillOverlay.tsx` (+50, -2): added `useSeenKeysGate` import, `agreedPillKeys` derivation, `<span data-pill-agreed-anim>` wrapper around each `<FacetPill>` with conditional `aud-pill-agreed` class; extended header docblock with §1–§6 refinement trail.
- `apps/audience/src/graph/PerFacetPillOverlay.test.tsx` (+207): 6 new Vitest cases covering initial-mount no-class (k), post-mount transition gets class (l), prior-agreed sibling stays unanimated (m), pan rerender drops class (n), non-agreed statuses never animate — 6 branches parameterized (o), wrapper presence-marker (p); all 16 cases pass.
- `apps/audience/src/index.css` (+50): `@keyframes aud-pill-agreed` + `.aud-pill-agreed` utility (`display: inline-block; border-radius: 9999px; animation … 350ms cubic-bezier(0.16,1,0.3,1) forwards`) + `prefers-reduced-motion: reduce` override.
- `apps/audience/src/index.test.ts` (+13): 2 new CSS smoke pins asserting `@keyframes aud-pill-agreed` presence and reduced-motion override; total CSS smoke cases: 6.
- Deferred e2e: two scenarios (`initial agreed pills no class`, `post-commit agreed pill gets class`) routed onto the existing `aud_url_routing.aud_session_url` Playwright debt chain (now 7 refinements deep); no new task registered — the debt target already exists in the WBS.
- Verification: `pnpm run check` green; `pnpm run test:smoke` green (22 cases in modified files); `pnpm run test:behavior:smoke` green; `make test:e2e:compose` green.
