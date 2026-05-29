# Audience withdrawal animation (a one-shot CSS `@keyframes` rose-tinted halo painted by a new DOM-overlay sibling `<AudienceWithdrawalHaloOverlay>` centered on each Cytoscape node whose `data.rollupStatus` first reaches `'disputed'` mid-broadcast — gated by `useSeenKeysGate` keyed by `nodeId` over currently-`'disputed'`-rollupStatus entries so initially-disputed nodes at audience-join do NOT animate; suppressed under `prefers-reduced-motion: reduce`)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_animations.aud_withdrawal_animation` (lines 340-343).
**Effort estimate**: 1d
**Inherited dependencies**:

- `!audience.aud_graph_rendering` (settled — the entire group is `complete 100`). The audience surface paints node bodies via Cytoscape's canvas-side `STYLESHEET` (now lifted to [`apps/audience/src/graph/stylesheet.ts`](../../../apps/audience/src/graph/stylesheet.ts)) and projects `data.rollupStatus` for every entity at [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts). This leaf adds an **entity-layer animation** when a node's rollup first reaches `'disputed'` mid-broadcast; the steady-state visual contract is unchanged.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_disputed_styling` (settled — [`tasks/refinements/audience/aud_disputed_styling.md`](aud_disputed_styling.md), shipped 2026-05-27). The disputed steady-state paint this leaf transitions INTO. Two STYLESHEET entries at [`apps/audience/src/graph/stylesheet.ts:234-246`](../../../apps/audience/src/graph/stylesheet.ts#L234) paint `node[rollupStatus = 'disputed']` with `border-color: STATE_COLORS.disputed` (`#e11d48` / rose-600 at [`stylesheet.ts:108-112`](../../../apps/audience/src/graph/stylesheet.ts#L108)) + `border-width: 3` and `edge[rollupStatus = 'disputed']` with `line-color` + `target-arrow-color` `#e11d48`. The animation's halo tint is sampled from the same `STATE_COLORS.disputed` so the pulse reads as "of the disputed-state surface" and the post-animation steady state lands on the static rose-600 border this refinement does NOT modify. The disputed-styling refinement's own Status block names this leaf as the consumer that completes the agreed → disputed transition visually ([`aud_disputed_styling.md` lines 29, 42](aud_disputed_styling.md#L29)).
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_node_appear_animation` (settled — [`tasks/refinements/audience/aud_node_appear_animation.md`](aud_node_appear_animation.md)). The direct structural precedent: a per-node halo overlay mounted as a DOM sibling of the Cytoscape canvas (`<AudienceNodeAppearOverlay>` at [`apps/audience/src/graph/NodeAppearOverlay.tsx`](../../../apps/audience/src/graph/NodeAppearOverlay.tsx)). Decision §1 (CSS keyframe on React-keyed halo `<span>`, NOT `cy.animate()`), §3 (overlay owns its own seen-Set, separate from GraphView's `knownNodeIdsRef`), §4 (lazy-init-on-first-non-empty-placements seeding), §5 (450 ms `cubic-bezier(0.16, 1, 0.3, 1)` `forwards` — halo geometry justifies the slower entrance), §6 (Vitest pins React-side + CSS file presence; Playwright deferred) all apply verbatim modulo the placement-filter (currently-`'disputed'`-rollup nodes vs all nodes) and the keyframe palette (rose-tint vs slate-tint).
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_proposed_to_agreed_animation` (settled — [`tasks/refinements/audience/aud_proposed_to_agreed_animation.md`](aud_proposed_to_agreed_animation.md)). The transition-keyed `useSeenKeysGate` precedent: the key shape encodes the target status, the `currentKeys` is filtered to entries currently IN that target status, the first non-empty commit seeds with whatever is already in that state at audience-join. This leaf adopts the same posture, narrowed to a per-node key shape (vs `${nodeId}:${facet}`) drawn from currently-`'disputed'`-rollup entries.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_axiom_mark_animation` (settled — [`tasks/refinements/audience/aud_axiom_mark_animation.md`](aud_axiom_mark_animation.md)). The pioneer animation leaf that established the CSS-first, no-motion-framework, `prefers-reduced-motion`-in-CSS, Vitest-pins-class-logic, Playwright-deferred posture. Decision §1, §2 (no motion-framework dependency), §6 (test discipline) all apply verbatim.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_dom_overlay_extraction` (settled — [`tasks/refinements/audience/aud_dom_overlay_extraction.md`](aud_dom_overlay_extraction.md)). The shared hooks `useCytoscapeOverlayPlacements<P>` and `useSeenKeysGate<K>` at [`apps/audience/src/graph/cytoscapeOverlayHooks.ts`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts:89-173) are consumed verbatim by this leaf — no hook edits. This leaf is the second new caller of both hooks since the extraction landed (the first being `aud_proposed_to_agreed_animation`'s addition of `useSeenKeysGate` to `<AudiencePerFacetPillOverlay>`).
- Prose-only context (NOT a `.tji` edge): `aud_animations.aud_animation_pacing` (sibling, future — [`tasks/50-audience-and-broadcast.tji:353-357`](../../50-audience-and-broadcast.tji#L353)). The cross-cutting cadence-tuning task; its `depends` line names `!aud_node_appear_animation, !aud_proposed_to_agreed_animation, !aud_axiom_mark_animation` (verified at [line 356](../../50-audience-and-broadcast.tji#L356)) but does NOT yet name `!aud_withdrawal_animation`. The closer of this leaf adds `!aud_withdrawal_animation` to that `depends` list (single-line `.tji` edit alongside the `complete 100`) so the pacing task sees all four shipped animation durations when it rebalances — see Acceptance criteria.
- Prose-only context (NOT a `.tji` edge): `audience.aud_url_routing.aud_session_url` (sibling, future). The deferred-e2e debt collector for the audience surface. Every prior `aud_animations.*` leaf routes its Playwright debt there; this leaf joins the same chain (Decision §6 below).
- Prose-only context (NOT a `.tji` edge): `audience.aud_data_layer.aud_visual_regression` (sibling, future). Pixel-stable steady-state regression pins for per-state palette; the disputed steady state is already in scope of `aud_disputed_styling`'s deferral entry there. This leaf is a transient animation — its post-animation steady state IS the disputed steady state already pinned by `aud_visual_regression`, so no new VR scenario is registered.

## What this task is

The 1d leaf that lights up the **entity-layer arrival animation** when a node's `rollupStatus` first reaches `'disputed'` mid-broadcast. A withdrawal — a participant retracting their `'agree'` vote on a facet via the `withdraw-agreement` event ([`apps/server/src/projection/replay.ts:1005-1029`](../../../apps/server/src/projection/replay.ts#L1005), schema at [`packages/shared-types/src/events.ts:666-674`](../../../packages/shared-types/src/events.ts#L666)) — flips at least one facet out of `'agreed'` per the per-facet derivation at [`apps/audience/src/graph/facetStatus.ts`](../../../apps/audience/src/graph/facetStatus.ts) (rules 4-8). When the resulting facet mix recomputes `cardRollupStatus` ([`facetStatus.ts:545-553`](../../../apps/audience/src/graph/facetStatus.ts#L545)) to `'disputed'` (the per-node rollup the audience stamps via [`projectGraph.ts:253`](../../../apps/audience/src/graph/projectGraph.ts#L253)), the entity-layer paint flips from agreed-slate to disputed-rose. The animation gives that flip a temporal signal: a brief rose-tinted halo expands from the node and fades out, telling the passive broadcast viewer "this specific node just landed back in dispute, RIGHT NOW."

The implementation parallels the `aud_node_appear_animation` predecessor's halo overlay: a new `<AudienceWithdrawalHaloOverlay>` component mounted as a fifth DOM-overlay sibling inside `<AudienceGraphView>`'s render tree (after `<AudienceNodeAppearOverlay>` at [`GraphView.tsx:411`](../../../apps/audience/src/graph/GraphView.tsx#L411)). The overlay's `commitWithdrawalPlacements(cy)` reads each node's `data.rollupStatus` via `node.data('rollupStatus')` and emits a placement record for nodes where `rollupStatus === 'disputed'`. `useCytoscapeOverlayPlacements<WithdrawalHaloPlacement>` drives the rAF-batched commit; `useSeenKeysGate<string>(currentDisputedNodeIds)` gates the `aud-withdrawal` animation class. The animation itself is a single `@keyframes aud-withdrawal` rule appended to `apps/audience/src/index.css`, suppressed under `@media (prefers-reduced-motion: reduce)`.

The seen-set semantics mirror `aud_proposed_to_agreed_animation`'s transition-keyed gate: `currentKeys` is filtered to ONLY currently-`'disputed'` node IDs. The first non-empty commit seeds with whatever nodes are already disputed at audience-join (mid-session joiners do NOT see retrospective animation for state they missed). Subsequent commits where a node flips to `'disputed'` produce a key not yet in the set; the gate returns `true` exactly once per (node, session) pair; the render path classes the halo `<span>` with `aud-withdrawal` for that one render. Nodes in any other `rollupStatus` (`'proposed'`, `'meta-disagreement'`, `'agreed'`, `'committed'`, `'withdrawn'`, `'awaiting-proposal'`) contribute no key to `currentKeys` — they don't seed and don't animate.

The lazy-init-on-non-empty contract of `useSeenKeysGate` ([`cytoscapeOverlayHooks.ts:162`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts#L162)) handles the rAF-batched-empty-first-render correctly: when no nodes are currently disputed, the gate stays un-seeded; when the first disputed-rollup arrival fires, the gate seeds from those (possibly zero existing + one new) keys. If the *very first* placement-commit already contains the new arrival (audience joined exactly when the first dispute lands), the new node IS seeded as "seen" and does NOT animate — this is the same compromise the predecessor halo overlay accepts and the trade-off the orchestrator brief sanctions (the brief favors the lazy-init contract over a wall-clock-based "post-mount only" heuristic).

After this leaf:

- `apps/audience/src/graph/WithdrawalHaloOverlay.tsx` — NEW. ~130 LOC mirroring `NodeAppearOverlay.tsx`'s shape: header docblock with refinement-trail + ADR list, `AudienceWithdrawalHaloOverlayProps` interface (`cy: Core | null; containerRef: RefObject<HTMLDivElement | null>`), `WithdrawalHaloPlacement` interface (`id, x, y`), the function component, and the pure `commitWithdrawalPlacements(cy)` iteration function.
- `apps/audience/src/graph/WithdrawalHaloOverlay.test.tsx` — NEW. ~10 Vitest cases parallel to `NodeAppearOverlay.test.tsx`'s structure: (a) initial-mount disputed nodes do NOT carry the animation class; (b) post-mount transition to `'disputed'` DOES animate; (c) initially-non-disputed sibling stays unanimated; (d) re-render with identical statuses (pan/zoom simulation) does not re-add the class; (e-i) one assertion per non-disputed `rollupStatus` value (`'agreed'`, `'proposed'`, `'meta-disagreement'`, `'committed'`, `'withdrawn'`, `'awaiting-proposal'`) confirming none produce the class; (j) halo `<span>` always carries the `data-withdrawal-anim` presence marker for testid stability.
- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. One new import line (`import { AudienceWithdrawalHaloOverlay } from './WithdrawalHaloOverlay.js';`); one new mount line in the render tree (`<AudienceWithdrawalHaloOverlay cy={cyState} containerRef={containerRef} />`) appended after the existing `<AudienceNodeAppearOverlay>` mount at [line 411](../../../apps/audience/src/graph/GraphView.tsx#L411). Header comment-block extends with a refinement-trail entry summarizing Decisions §1-§6.
- `apps/audience/src/graph/GraphView.test.tsx` — MODIFIED (if it asserts on overlay-mount ordering or count). One assertion update to bump the expected overlay count from 4 to 5, or one new presence assertion for `[data-testid="audience-withdrawal-halo-overlay"]`. Existing assertions on the four prior overlays pass unchanged.
- `apps/audience/src/index.css` — MODIFIED. Append a `@keyframes aud-withdrawal` block, a `[data-withdrawal-anim]` selector with the halo geometry + radial-gradient `background-image` (mirroring `[data-node-appear-anim]` at [`index.css:133-145`](../../../apps/audience/src/index.css#L133) but with rose-600 alpha stops), a `.aud-withdrawal` utility class consuming the keyframe with `forwards` fill, and the matching `prefers-reduced-motion: reduce` override.
- `apps/audience/src/index.test.ts` — MODIFIED. 2 new Vitest cases appended to the existing 6 (`@keyframes aud-axiom-mark-land`, reduced-motion override for `.aud-axiom-mark-land`, `@keyframes aud-node-appear`, reduced-motion override for `.aud-node-appear`, `@keyframes aud-pill-agreed`, reduced-motion override for `.aud-pill-agreed`) asserting `@keyframes aud-withdrawal` presence and the matching `prefers-reduced-motion: reduce` override clause.
- `tasks/50-audience-and-broadcast.tji` — MODIFIED at close-time only: the closer adds `complete 100` to the `aud_withdrawal_animation` task and edits the `aud_animation_pacing` `depends` line ([line 356](../../50-audience-and-broadcast.tji#L356)) to include `!aud_withdrawal_animation`. Both edits are mechanical and belong to the task-completion ritual, not to the implementation.

Out of scope (deferred to existing or future leaves):

- **Per-facet pill withdrawal animation.** A facet flipping from `'agreed'` → `'withdrawn'` (the `withdrawn` facet status from rule 4 of `facetStatus.ts`) could in principle get its own pill-level "untwine" animation analogous to `aud_proposed_to_agreed_animation`'s pulse. NOT pre-registered today: the task name "Animate withdrawal (agreed → disputed)" scopes this leaf strictly to the rollupStatus transition reaching `'disputed'`, and the per-facet pill already redraws its dashed slate `withdrawn` palette via the shell `<FacetPill>` (per [`packages/shell/src/facet-pill/FacetPill.tsx:83`](../../../packages/shell/src/facet-pill/FacetPill.tsx#L83)). A future `aud_per_facet_withdrawn_animation` task (~0.5d) could mirror the `aud_pill-agreed` template against currently-`'withdrawn'` pill keys; not pre-registered. Note that for the *rollup-level* `'agreed'` → `'disputed'` flip targeted by THIS leaf, an underlying per-facet flip from `'agreed'` → `'disputed'` (via rule 5, an active dispute vote) is the dominant trigger — the per-facet pill paints rose-600 from its `'disputed'` palette at [`FacetPill.tsx:79`](../../../packages/shell/src/facet-pill/FacetPill.tsx#L79) without animation; only the whole-node halo animates here.
- **Per-edge withdrawal animation.** Edges also carry `data.rollupStatus` and the `aud_disputed_styling` selectors paint `edge[rollupStatus = 'disputed']` with rose-600 lines + arrow-color. The existing audience DOM-overlay siblings (`<AudiencePerFacetPillOverlay>`, `<AudienceAxiomMarkOverlay>`, `<AudienceNodeAppearOverlay>`) iterate `cy.nodes()` only per the consolidated `aud_per_facet_visualization` Decision §3 precedent. This leaf adopts the same scope. A future `aud_edge_withdrawal_animation` (~0.5d, NOT pre-registered) could mount a parallel overlay iterating `cy.edges()` with an edge-midpoint halo or a line-color tween; product hasn't surfaced a need.
- **Whole-card rollup transitions to states OTHER than `'disputed'`.** A rollupStatus going from `'proposed'` → `'agreed'` (the celebratory inverse) is a methodologically-significant transition that today the per-facet `aud_proposed_to_agreed_animation` pulse already covers at the pill granularity. A whole-node "agreement-settled" halo would be a new `aud_rollup_to_agreed_animation` (~0.5d, NOT pre-registered today; the predecessor refinement also held off on registering it). `'agreed'` → `'committed'` is a closed-state transition the audience does not specially mark today.
- **Pixel-stable frame-by-frame capture.** Animation timing is not captured by `aud_visual_regression`'s steady-state snapshots; the regression task pins post-animation steady state (the halo fades to `opacity: 0` and the node body holds the rose-600 disputed border already pinned by `aud_disputed_styling`'s deferral entry). Animation-timing capture would be the speculative `aud_animation_video_regression` (~1d, NOT pre-registered today; the predecessor refinements also held off on registering it).
- **Pacing constant tuning across the animation set.** This leaf chooses 450 ms ease-out (matching the node-appear sibling — Decision §5 below); `aud_animation_pacing` is the cross-cutting cadence-tuning task that will revisit the constants alongside the other animation siblings' durations. The closer of THIS leaf adds `!aud_withdrawal_animation` to the pacing task's `depends` line so the pacing task sees this constant as one of four shipped animation durations.
- **A Playwright spec exercising the live withdrawal transition.** Per the deferred-e2e exception in the orchestrator brief (component not yet reachable): the audience surface is still placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx); the per-session route lands in `aud_url_routing.aud_session_url`. Full deferral applies — the Vitest pins above cover the behavioural seam (gate-class is/isn't applied per-render across all seven `rollupStatus` branches, post-mount transition fires once, rerender does not re-fire). Decision §6 documents the routing of this debt onto the already-accumulating chain and weighs the splitting alternative.
- **Moderator-side withdrawal animation.** The moderator's `<StatementNode>` ReactFlow children paint per-state borders too. Cross-surface animation parity (`mod_withdrawal_animation`) is **NOT pre-registered** (speculative; the moderator's click-through workflow benefits less from animated transition vocabulary than the broadcast viewer's passive watch).
- **Participant-side withdrawal animation.** Participant's detail panel paints facet pills. NOT pre-registered (same posture as moderator-side).
- **`framer-motion`, `react-spring`, or any motion-framework dependency.** Rejected (Decision §1; cumulative posture of the `aud_animations.*` group, established by the predecessors and reinforced here).
- **Editing the Cytoscape `STYLESHEET` constant.** Rejected. The static disputed paint is owned by `aud_disputed_styling`; this leaf adds a DOM-overlay decoration on top of the canvas, not a new selector. The post-animation steady state IS the existing disputed border + line-color rules.

## Why it needs to be done

The methodology treats withdrawal as a structurally consequential reversal: a participant who previously declared `agree` on a facet is retracting that declaration, which the per-facet derivation processes via the `withdraw-agreement` event handler at [`apps/server/src/projection/replay.ts:1021`](../../../apps/server/src/projection/replay.ts#L1021) (adds the participant to `facet.withdrawals`) and re-derives the facet's status via rules 4-8 at [`apps/audience/src/graph/facetStatus.ts`](../../../apps/audience/src/graph/facetStatus.ts). When the per-facet statuses recompute `cardRollupStatus` to `'disputed'`, the audience surface stamps `data.rollupStatus = 'disputed'` on the node, and the Cytoscape stylesheet paints the rose-600 border. The visual change is real but instantaneous — a single React tick's worth of paint difference on a node that may be off the broadcast viewer's foveal attention at that moment. Without an animation, a passive viewer not already watching that specific node has no temporal cue that the conversation just regressed at that location.

The animation gives the regression a moment-of-arrival signal — a brief rose halo expanding outward from the node center and fading to transparent over 450 ms. The halo's outermost extent and palette match the post-animation steady-state border so the eye can find the new disputed paint immediately: the halo fades, the rose-600 border stays, the node body remains `#ffffff` (per the stylesheet's node-fill default). The contrast is intentionally distinct from `aud_node_appear_animation`'s slate-tinted halo: a new node arrival is structurally additive; a withdrawal is structurally subtractive (an agreement was undone), and the rose tint signals "this is the disputed state's halo, not the new-node halo."

The `aud_animations` task group exists precisely to render the moment-of-arrival for each structural-event class — `aud_axiom_mark_animation` settled the per-participant declarative-mark class, `aud_node_appear_animation` settled the new-node class, `aud_proposed_to_agreed_animation` settled the per-facet agreement class. This leaf settles the **withdrawal-regression** class, the fourth shipped member of the group; the remaining unshipped siblings are `aud_decomposition_animation` (parent fading, components emerging) and `aud_diagnostic_fire_animation` (cycle/contradiction highlight).

Downstream concretely:

- **`aud_animation_pacing`** ([`tasks/50-audience-and-broadcast.tji:353-357`](../../50-audience-and-broadcast.tji#L353)) is the cross-cutting cadence-tuning task. With this leaf's 450 ms added, the pacing task sees four shipped durations (350 ms axiom-mark, 450 ms node-appear, 350 ms pill-agreed, 450 ms withdrawal) and can rebalance if the deferred sibling animations land at conflicting tempos. The closer of THIS leaf adds `!aud_withdrawal_animation` to the pacing task's `depends` list.
- **`aud_session_url`** is the audience-reachability task; once it lands the inherited Playwright debt clears (Decision §6).
- **`aud_visual_regression`** pins the post-animation steady state — the halo fades to `opacity: 0` and the node body holds the rose-600 disputed border already in scope of the regression task per `aud_disputed_styling`'s deferral entry. No new VR scenario is registered.

Architecturally, this leaf consolidates the pattern that emerged across the predecessor animations: a halo overlay for entity-layer transitions, a wrapped-pill animation for facet-layer transitions, both consuming the same `useCytoscapeOverlayPlacements` + `useSeenKeysGate` hooks with caller-chosen key shapes. The fourth animation leaf moves the pattern from "established by precedent and reinforced by a third instance" to "canonical idiom for the audience animation set." The remaining sibling animations (`aud_decomposition_animation`, `aud_diagnostic_fire_animation`) inherit this canon.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience uses Cytoscape with React DOM overlays. Per-element React decoration (here, a halo `<span>` per disputed node) is the canonical pattern; Cytoscape's canvas-side `cy.animate(...)` API is unreachable from a React-rendered DOM overlay and is rejected for the same reasons the predecessor animations rejected it (Decision §1).
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the audience CSS lives at `apps/audience/src/index.css` with the Tailwind v4 `@import` and `@source` directives. The three predecessor keyframes (`aud-axiom-mark-land`, `aud-node-appear`, `aud-pill-agreed`) already coexist with Tailwind utilities at the same CSS layer ([`apps/audience/src/index.css:70-216`](../../../apps/audience/src/index.css#L70)). This leaf appends a fourth keyframe under the same convention.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest pins the React-side behaviour (per-render decision logic; presence/absence of the class across all seven `rollupStatus` branches). A Vitest pair reads the CSS file from disk to confirm the keyframe + reduced-motion clause exist. Pixel-level frame-by-frame animation capture is out of scope (no current task has frame-capture infrastructure).
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the audience artifact owns its CSS; the new keyframe ships inside the audience bundle and does not leak to the moderator or participant artifacts.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — withdrawal manifests at both layers (per-facet `'withdrawn'` or `'disputed'` status; whole-node `'disputed'` rollup), but this leaf scopes strictly to the **entity-layer** rollup transition. The facet-layer pill repaint is handled by the shell `<FacetPill>` unchanged; no animation is added there by this leaf.
- [ADR 0030 — Per-facet vote keying](../../../docs/adr/0030-per-facet-vote-keying.md) — `'disputed'` is one of the seven `FacetStatus` values that contribute (via `cardRollupStatus`) to the entity-layer `rollupStatus` this leaf observes. The transition is observable purely from the projection's per-tick `data.rollupStatus` stamp. No projection-time helper or new emission is required.

No new ADR. The architectural seams (DOM-overlay halo with CSS-first keyframe, `useSeenKeysGate`-driven gate with a target-status-encoding key, `prefers-reduced-motion` in CSS, no motion-framework dependency, no STYLESHEET edit) are either settled by existing ADRs or by the cumulative posture three animation predecessors established and this leaf reinforces.

### Sibling refinements

- [`tasks/refinements/audience/aud_node_appear_animation.md`](aud_node_appear_animation.md) — the direct structural precedent. The halo overlay shape, the rAF-batched commit, the seeded-set lazy-init, the 450 ms `cubic-bezier(0.16, 1, 0.3, 1)` `forwards` duration, the test discipline are all adopted verbatim modulo the placement filter (currently-`'disputed'`-rollup nodes vs all nodes) and the halo palette (rose-600 vs slate-700).
- [`tasks/refinements/audience/aud_proposed_to_agreed_animation.md`](aud_proposed_to_agreed_animation.md) — the transition-keyed seen-Set precedent. The `useSeenKeysGate` posture ("filter currentKeys to entries currently IN the target state; first observation per session animates") is adopted verbatim with a per-node key shape instead of per-(node, facet) pair.
- [`tasks/refinements/audience/aud_axiom_mark_animation.md`](aud_axiom_mark_animation.md) — the pioneer refinement; established the CSS-first, no-motion-framework, `prefers-reduced-motion`-in-CSS, Vitest-pins-class-logic posture.
- [`tasks/refinements/audience/aud_dom_overlay_extraction.md`](aud_dom_overlay_extraction.md) — the extraction that established `useCytoscapeOverlayPlacements` + `useSeenKeysGate`. Both hooks consumed unchanged.
- [`tasks/refinements/audience/aud_disputed_styling.md`](aud_disputed_styling.md) — the static-paint precursor. The rose-600 border + line-color steady state is the destination this leaf's halo fades toward. The disputed-styling refinement explicitly named this leaf as the consumer that completes the agreed → disputed transition visually.
- [`tasks/refinements/audience/aud_per_facet_visualization.md`](aud_per_facet_visualization.md) — the `cy.nodes()`-only iteration scope precedent the DOM-overlay siblings have all followed; this leaf adopts the same scope (no edge halo). The future `aud_edge_withdrawal_animation` would relax this if product surfaces a need.

### Live code the leaf modifies / creates

- [`apps/audience/src/graph/WithdrawalHaloOverlay.tsx`](../../../apps/audience/src/graph/WithdrawalHaloOverlay.tsx) — NEW. The structural skeleton mirrors [`NodeAppearOverlay.tsx`](../../../apps/audience/src/graph/NodeAppearOverlay.tsx) verbatim modulo: (a) the placement-emission gate (`if (node.data('rollupStatus') !== 'disputed') return;` inside the `cy.nodes().forEach(...)` walk), (b) the wrapper's `data-testid="audience-withdrawal-halo-overlay"`, (c) the inner `<span>`'s `data-withdrawal-anim=""` presence-marker and `className={isNew ? 'aud-withdrawal' : ''}` gate. Header docblock extends with §1–§6 refinement trail.
- [`apps/audience/src/graph/WithdrawalHaloOverlay.test.tsx`](../../../apps/audience/src/graph/WithdrawalHaloOverlay.test.tsx) — NEW. ~10 Vitest cases mirroring `NodeAppearOverlay.test.tsx`'s shape (see Constraints for the enumerated list).
- [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) — MODIFIED. One new import (line 228 region); one new mount line (line 411 region); one header refinement-trail entry. No edit to the cy-state lifting, the stylesheet, or the layout-options.
- [`apps/audience/src/graph/GraphView.test.tsx`](../../../apps/audience/src/graph/GraphView.test.tsx) — POSSIBLY MODIFIED. The implementer reads existing GraphView tests; if any assertion counts the number of `[data-testid="audience-*-overlay"]` elements, that count bumps from 4 to 5. If no such assertion exists, this file is byte-unchanged. New presence assertion `expect(container.querySelector('[data-testid="audience-withdrawal-halo-overlay"]')).not.toBeNull()` is acceptable but not required (the `WithdrawalHaloOverlay.test.tsx` is the authoritative pin for the overlay's per-render contract).
- [`apps/audience/src/graph/cytoscapeOverlayHooks.ts`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts) — UNCHANGED. Both hooks consumed unchanged.
- [`apps/audience/src/graph/AxiomMarkOverlay.tsx`](../../../apps/audience/src/graph/AxiomMarkOverlay.tsx), [`apps/audience/src/graph/AnnotationOverlay.tsx`](../../../apps/audience/src/graph/AnnotationOverlay.tsx), [`apps/audience/src/graph/NodeAppearOverlay.tsx`](../../../apps/audience/src/graph/NodeAppearOverlay.tsx), [`apps/audience/src/graph/PerFacetPillOverlay.tsx`](../../../apps/audience/src/graph/PerFacetPillOverlay.tsx) — UNCHANGED. No new shared abstraction extracted (the rule-of-four threshold was already paid down by `aud_dom_overlay_extraction`; a fifth caller of `useCytoscapeOverlayPlacements`/`useSeenKeysGate` does NOT require a further extraction).
- [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts) — UNCHANGED. The transition is observable purely from the existing per-tick `data.rollupStatus` stamp; no projection field needs adding.
- [`apps/audience/src/graph/stylesheet.ts`](../../../apps/audience/src/graph/stylesheet.ts) — UNCHANGED. Cytoscape's `node[rollupStatus = 'disputed']` selectors stay paint-only; the animation lives entirely in the React + CSS overlay layer.
- [`apps/audience/src/graph/facetStatus.ts`](../../../apps/audience/src/graph/facetStatus.ts) — UNCHANGED. The rules 4-8 derivation that flips a facet to `'withdrawn'` / `'disputed'` / `'proposed'` is unchanged; the `cardRollupStatus(facetStatuses)` derivation that promotes to `'disputed'` is unchanged.
- [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) — MODIFIED. Append a `[data-withdrawal-anim]` selector with the halo geometry + rose-tinted radial-gradient, a `@keyframes aud-withdrawal` block, a `.aud-withdrawal` utility class that consumes it, and the matching `prefers-reduced-motion: reduce` override. The block lands beside the existing `aud-axiom-mark-land`, `aud-node-appear`, and `aud-pill-agreed` blocks.
- [`apps/audience/src/index.test.ts`](../../../apps/audience/src/index.test.ts) — MODIFIED. 2 new Vitest cases appended to the existing 6 asserting `@keyframes aud-withdrawal` presence and the matching reduced-motion override clause.
- [`packages/shell/src/facet-pill/FacetPill.tsx`](../../../packages/shell/src/facet-pill/FacetPill.tsx) — UNCHANGED. Cross-surface neutrality.
- `apps/audience/package.json` — UNCHANGED. No new dependency.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**`, `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx` — UNCHANGED.

### What the surface MUST NOT do

- **No new dependency.** `framer-motion`, `react-spring`, `@react-spring/web`, `motion`, `react-transition-group` are all rejected (Decision §1).
- **No edit to `@a-conversa/shell`.** The shell `<FacetPill>` is unchanged. This leaf's surface is the entity-layer node body, not any facet-layer pill.
- **No edit to the Cytoscape `STYLESHEET`.** The static disputed paint is `aud_disputed_styling`'s scope; this leaf adds a DOM-overlay decoration on top of the canvas.
- **No `cy.animate(...)` call.** The halo is a React-rendered DOM-overlay sibling of the Cytoscape canvas, fundamentally unreachable by `cy.animate(...)`.
- **No JavaScript-driven animation loop.** No `requestAnimationFrame`-pump that tweens scale/opacity per frame; no `setTimeout` chain. The CSS keyframe runs on the GPU compositor; JS only decides which halos get the class.
- **No animation on initial mount.** Nodes already in `'disputed'` rollup at first non-empty placement commit are seeded into the seen-Set (via `useSeenKeysGate`'s lazy-init-on-non-empty contract) and rendered without the animation class.
- **No animation re-fire on pan/zoom/resize.** Because the halo `<span>` is keyed by `nodeId` and React reconciles by key, the existing wrapper DOM is reused across re-renders. Once the `aud-withdrawal` class lands on a halo, subsequent renders find the key in the seen-Set and the predicate returns `false` — the class is not re-applied.
- **No animation on a node flipping AWAY from `'disputed'`.** A `'disputed'` → `'agreed'` (or any other) rollupStatus transition takes the key out of `currentKeys`. The seen-Set still holds the key (it's only ever added, never removed), so a subsequent re-arrival at `'disputed'` would NOT re-animate. This is intentional: the methodology treats withdrawal as a structural event; re-withdrawal of an already-withdrawn-then-re-agreed node is rare and not currently a methodology pattern, so the conservative "animate only the first observed `'disputed'` arrival per node per session" gate is correct.
- **No animation on `'agreed'`, `'proposed'`, `'meta-disagreement'`, `'committed'`, `'withdrawn'`, `'awaiting-proposal'`.** The key for each node is contributed to `currentKeys` ONLY when the current rollupStatus is `'disputed'`. The other six branches contribute no key, never participate in the gate, never get the halo.
- **No edge halo.** Edges with `rollupStatus = 'disputed'` paint rose-600 lines (existing `aud_disputed_styling`) but do not get an animated halo by this leaf. Future `aud_edge_withdrawal_animation` would relax.
- **No edit to other audience overlays.** No new shared abstraction; the fifth caller of `useCytoscapeOverlayPlacements`/`useSeenKeysGate` does NOT trigger another extraction (the extraction was done; the hooks ARE the abstraction).
- **No new i18n keys.** The animation has no visible label and adds no a11y prose. Screen readers narrate the underlying node via Cytoscape's own a11y plumbing; the halo overlay is `aria-hidden="true"` like its NodeAppearOverlay predecessor.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/WithdrawalHaloOverlay.tsx` — NEW. ~130 LOC mirroring `NodeAppearOverlay.tsx`. The component:

  ```tsx
  import { type ReactElement, type RefObject } from 'react';
  import type { Core, NodeSingular } from 'cytoscape';
  import { useCytoscapeOverlayPlacements, useSeenKeysGate } from './cytoscapeOverlayHooks.js';

  export interface AudienceWithdrawalHaloOverlayProps {
    readonly cy: Core | null;
    readonly containerRef: RefObject<HTMLDivElement | null>;
  }

  interface WithdrawalHaloPlacement {
    readonly id: string;
    readonly x: number;
    readonly y: number;
  }

  export function AudienceWithdrawalHaloOverlay({
    cy,
    containerRef,
  }: AudienceWithdrawalHaloOverlayProps): ReactElement {
    void containerRef;
    const placements = useCytoscapeOverlayPlacements<WithdrawalHaloPlacement>(
      cy,
      commitWithdrawalPlacements,
    );
    const disputedNodeIds = placements.map((p) => p.id);
    const isNewDisputedNode = useSeenKeysGate(disputedNodeIds);

    return (
      <div
        data-testid="audience-withdrawal-halo-overlay"
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
      >
        {placements.map((p) => {
          const isNew = isNewDisputedNode(p.id);
          return (
            <span
              key={p.id}
              data-withdrawal-anim=""
              data-element-id={p.id}
              className={isNew ? 'aud-withdrawal' : ''}
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

  function commitWithdrawalPlacements(cy: Core): readonly WithdrawalHaloPlacement[] {
    const next: WithdrawalHaloPlacement[] = [];
    cy.nodes().forEach((node: NodeSingular) => {
      if (node.data('rollupStatus') !== 'disputed') return;
      const bb = node.renderedBoundingBox();
      next.push({
        id: node.id(),
        x: (bb.x1 + bb.x2) / 2,
        y: (bb.y1 + bb.y2) / 2,
      });
    });
    return next;
  }

  export default AudienceWithdrawalHaloOverlay;
  ```

  Header docblock follows the `NodeAppearOverlay.tsx` template (sections: refinement-trail, ADRs, role summary) extended with §1–§6 references to this refinement.

- `apps/audience/src/graph/WithdrawalHaloOverlay.test.tsx` — NEW. ~10 Vitest cases mirroring `NodeAppearOverlay.test.tsx`:

  1. **Initial-mount: no animation class on initially-`'disputed'` nodes.** Mount with a `cy` instance carrying two nodes whose `data.rollupStatus === 'disputed'`. The rendered halo `<span>`s (located via `[data-withdrawal-anim]`) do NOT carry the `aud-withdrawal` class.
  2. **Post-mount transition: animation class on the freshly-disputed node.** Mount with one node carrying `rollupStatus: 'agreed'`; then `act(() => { cy.nodes().first().data('rollupStatus', 'disputed'); })`. After the rAF-batched commit, the halo for that node DOES carry the `aud-withdrawal` class.
  3. **Post-mount transition: initially-disputed sibling stays unanimated.** Mount with one node `'disputed'` (already at mount) and one node `'agreed'`; then mutate the agreed-node's rollup to `'disputed'`. The initially-disputed node's halo does NOT carry the class; the freshly-disputed sibling's halo DOES.
  4. **Rerender with identical statuses: no class spread.** Mount, then trigger `cy.emit('pan')`. After the second commit, no halo carries the class beyond what carried it after the first commit.
  5–10. **Non-`'disputed'` rollup never animates.** One parameterized case per status in `['agreed', 'proposed', 'meta-disagreement', 'committed', 'withdrawn', 'awaiting-proposal']`: mount with a single node in that status; mutate to a different non-`'disputed'` status; assert no halo `<span>` is emitted for the node (the `commitWithdrawalPlacements` filter early-returns when rollup is non-`'disputed'`, so the overlay emits NO placement for it — the assertion is `querySelectorAll('[data-withdrawal-anim]').length === 0`).
  11. **Halo `<span>` always carries `data-withdrawal-anim`.** Mount with a freshly-disputed node; `querySelector('[data-withdrawal-anim]')` resolves. Confirms the test selector seam.

  Existing audience overlay tests pass byte-unchanged (the new overlay is additive; no shared abstraction touched).

- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. Three additive edits:

  ```tsx
  // (existing import lines region ~225-228)
  import { AudiencePerFacetPillOverlay } from './PerFacetPillOverlay.js';
  import { AudienceAxiomMarkOverlay } from './AxiomMarkOverlay.js';
  import { AudienceAnnotationOverlay } from './AnnotationOverlay.js';
  import { AudienceNodeAppearOverlay } from './NodeAppearOverlay.js';
  import { AudienceWithdrawalHaloOverlay } from './WithdrawalHaloOverlay.js'; // NEW

  // (existing mount-line region ~408-411)
  <AudiencePerFacetPillOverlay cy={cyState} containerRef={containerRef} />
  <AudienceAxiomMarkOverlay cy={cyState} containerRef={containerRef} />
  <AudienceAnnotationOverlay cy={cyState} containerRef={containerRef} />
  <AudienceNodeAppearOverlay cy={cyState} containerRef={containerRef} />
  <AudienceWithdrawalHaloOverlay cy={cyState} containerRef={containerRef} /> {/* NEW */}
  ```

  Header docblock extends with a refinement-trail entry referencing this refinement's §1–§6.

- `apps/audience/src/graph/GraphView.test.tsx` — POSSIBLY MODIFIED. If existing assertions count the number of overlay-testid elements, bump 4 → 5. Otherwise byte-unchanged (the per-overlay behavioural pin lives in `WithdrawalHaloOverlay.test.tsx`).

- `apps/audience/src/index.css` — MODIFIED. Append (after the existing `aud-pill-agreed` block at lines 195-216):

  ```css
  /* `aud_withdrawal_animation` — one-shot rose-tinted halo on a
   * node's `rollupStatus` first reaching `'disputed'` mid-broadcast
   * (the agreed → disputed transition produced by withdraw-agreement
   * or per-facet dispute votes).
   * Refinement: tasks/refinements/audience/aud_withdrawal_animation.md
   *   Decision §1 — CSS `@keyframes` on a React-keyed halo `<span>`
   *   in a new `<AudienceWithdrawalHaloOverlay>`, NOT a JS-driven
   *   tween, NOT a motion-framework dependency, NOT `cy.animate()`.
   *   Decision §4 — `useSeenKeysGate` over currently-`'disputed'`
   *   `nodeId` keys; first non-empty commit seeds with the nodes
   *   already disputed at audience-join (no retrospective animation);
   *   subsequent disputed-rollup arrivals fire the halo exactly once
   *   per (node, session).
   *   Decision §5 — 450 ms with `cubic-bezier(0.16, 1, 0.3, 1)`
   *   ("emphasized decelerate"); parity with the node-appear halo's
   *   450 ms because the halo geometry is identical. `forwards`
   *   fill-mode keeps the `to` state (`opacity: 0`) after the
   *   animation completes so the halo is invisible at rest.
   *   `aud_animation_pacing` revisits the constant alongside the
   *   other animation siblings'.
   *   Decision §6 — `prefers-reduced-motion: reduce` suppression is
   *   in CSS (not TS — the class is always emitted by the render
   *   path).
   *
   * The halo geometry mirrors `[data-node-appear-anim]` (96px square,
   * radial gradient fading to transparent at 75%); the palette is
   * sampled from `STATE_COLORS.disputed` (rose-600 `#e11d48` /
   * `rgba(225, 29, 72, ...)`) at
   * `apps/audience/src/graph/stylesheet.ts:108`, so the halo reads as
   * "of the disputed-state surface" and the post-animation steady
   * state is the rose-600 border painted by the static stylesheet
   * (per `aud_disputed_styling.md`). */
  [data-withdrawal-anim] {
    width: 96px;
    height: 96px;
    pointer-events: none;
    background-image: radial-gradient(
      circle,
      rgba(225, 29, 72, 0.45) 0%,
      rgba(225, 29, 72, 0.15) 50%,
      rgba(225, 29, 72, 0) 75%
    );
    opacity: 0;
    border-radius: 50%;
  }

  @keyframes aud-withdrawal {
    from {
      opacity: 1;
      transform: translate(-50%, -50%) scale(0.6);
    }
    to {
      opacity: 0;
      transform: translate(-50%, -50%) scale(1.8);
    }
  }

  .aud-withdrawal {
    animation: aud-withdrawal 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @media (prefers-reduced-motion: reduce) {
    .aud-withdrawal {
      animation: none;
    }
  }
  ```

  The keyframe's `transform` carries `translate(-50%, -50%)` alongside `scale(...)` because the React inline style sets `transform: translate(-50%, -50%)` for centering; while the animation runs, the CSS animation overrides the inline transform, so the keyframe must restate the centering translate (same pattern as `aud-node-appear` at [`index.css:147-156`](../../../apps/audience/src/index.css#L147)). The halo's max scale (`1.8`) is slightly larger than the node-appear halo's `1.6` so the regression halo reads as "spreading outward" with a distinct rhythm — a subtle differentiation that pacing tuning may revisit.

- `apps/audience/src/index.test.ts` — MODIFIED. Append 2 cases parallel to the existing 6:
  1. `apps/audience/src/index.css` contains the substring `@keyframes aud-withdrawal`.
  2. `apps/audience/src/index.css` contains both `prefers-reduced-motion: reduce` AND, within (or after) that media-block, a `.aud-withdrawal { animation: none` override (whitespace-tolerant). The assertion can be a regex matching the literal `.aud-withdrawal` followed by `{ animation: none` (with optional whitespace) anywhere in the file content (same pattern as the predecessor CSS smoke pins).

### Files this task does NOT touch

- `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — UNCHANGED.
- `packages/shell/**`, `packages/shared-types/**`, `packages/i18n-catalogs/**` — UNCHANGED.
- `apps/audience/src/graph/projectGraph.ts`, `apps/audience/src/graph/stylesheet.ts`, `apps/audience/src/graph/facetStatus.ts`, `apps/audience/src/graph/layoutOptions.ts`, `apps/audience/src/graph/cytoscapeTestEnv.ts`, `apps/audience/src/graph/cytoscapeOverlayHooks.ts`, `apps/audience/src/graph/AxiomMarkOverlay.tsx`, `apps/audience/src/graph/AnnotationOverlay.tsx`, `apps/audience/src/graph/NodeAppearOverlay.tsx`, `apps/audience/src/graph/PerFacetPillOverlay.tsx`, `apps/audience/src/graph/axiomMarks.ts` — UNCHANGED.
- `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx` — UNCHANGED.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED (no new dep).
- `docs/adr/**` — UNCHANGED. No new ADR.
- `playwright.config.ts` / `tests/e2e/**` — UNCHANGED. Playwright deferral per Decision §6.

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/WithdrawalHaloOverlay.tsx` exists with the structure given under Constraints; the file mirrors `NodeAppearOverlay.tsx`'s shape with the disputed-rollup placement filter, the rose-tint halo wrapper testid, and the `aud-withdrawal` class gate. Header docblock carries the refinement-trail entry citing Decisions §1–§6.
- `apps/audience/src/graph/WithdrawalHaloOverlay.test.tsx` exists with the ~10 Vitest cases enumerated under Constraints; all cases pass.
- `apps/audience/src/graph/GraphView.tsx` carries the new import line and the new mount line for `<AudienceWithdrawalHaloOverlay>` after the existing `<AudienceNodeAppearOverlay>` mount; header docblock extended.
- `apps/audience/src/graph/GraphView.test.tsx` is byte-unchanged unless it asserts on an overlay count, in which case the count bumps 4 → 5; existing assertions pass otherwise.
- `apps/audience/src/index.css` carries the `[data-withdrawal-anim]` selector (96px halo, rose-600 radial gradient, `opacity: 0` rest state), the `@keyframes aud-withdrawal` rule, the `.aud-withdrawal` utility (450 ms `cubic-bezier(0.16, 1, 0.3, 1) forwards`), and the `prefers-reduced-motion: reduce` override per Constraints.
- `apps/audience/src/index.test.ts` carries the 2 new cases; the file's total assertion count is 8.
- `packages/shell/src/facet-pill/FacetPill.tsx` is byte-unchanged.
- `apps/audience/package.json` is byte-unchanged (no new dependency).
- The four existing audience overlay tests and `cytoscapeOverlayHooks.test.tsx` pass byte-unchanged.
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer pins (a) the React-side per-render class logic via ~10 cases on the new overlay covering all seven `rollupStatus` branches and (b) the CSS file's keyframe + reduced-motion definitions via the 2 new cases in `index.test.ts`. Animation-timing pixel capture is left to the speculative `aud_animation_video_regression` (NOT pre-registered today).
- Per the orchestrator brief's deferred-e2e exception ("component not yet reachable"): Playwright coverage for the animation is **deferred to `aud_url_routing.aud_session_url`** — the same destination as the three animation predecessors. This refinement registers the deferred-e2e debt as prose under the Status block (the closer of `aud_session_url` reads the accumulated chain — `aud_cytoscape_init.md` / `aud_state_management.md` / `aud_ws_client.md` / `aud_axiom_mark_decoration.md` / `aud_axiom_mark_animation.md` / `aud_node_appear_animation.md` / `aud_proposed_to_agreed_animation.md` / this leaf — and scopes the Playwright spec at that point). The two scenarios this leaf contributes: (i) a freshly-`'disputed'` rollupStatus node's halo carries the `aud-withdrawal` class on the commit that lifts it into the placement set; (ii) a node already `'disputed'` at page load does NOT carry the class. See Decision §6 for the routing rationale and the chain-length deliberation.
- **The closer adds `!aud_withdrawal_animation` to the `aud_animation_pacing` `depends` line** at [`tasks/50-audience-and-broadcast.tji:356`](../../50-audience-and-broadcast.tji#L356) in the same commit as `complete 100`. Verified at refinement-time the line currently reads `depends !aud_node_appear_animation, !aud_proposed_to_agreed_animation, !aud_axiom_mark_animation` and does NOT yet name this leaf.
- `pnpm run check` clean (strict TS pass; no new dep declared).
- `pnpm run test:smoke` green (Vitest count rises by ~10 (new overlay tests) + 2 (CSS smoke pins) = ~12 new cases).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is negligible — one new component file (~130 LOC after compression), one CSS block (~30 lines), no new dependency.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_withdrawal_animation` AND the `aud_animation_pacing` `depends` line edit in the same commit (the closer's ritual).

## Decisions

### §1 — CSS `@keyframes` on a React-keyed halo `<span>` in a NEW DOM-overlay sibling (NOT in-place-wrap, NOT JS tween, NOT motion framework, NOT `cy.animate()`)

Five options for "animate a node when its rollupStatus first reaches `'disputed'`":

A. **A new `<AudienceWithdrawalHaloOverlay>` DOM sibling mirroring `<AudienceNodeAppearOverlay>`.** Per-node halo `<span>` centered on each currently-disputed node; `useSeenKeysGate` keyed on `nodeId` over currently-`'disputed'`-rollup entries.

B. **In-place wrap inside an existing overlay** (the pattern `aud_proposed_to_agreed_animation` used). Requires an existing React-rendered element for the node body — there isn't one. The node body lives on Cytoscape's canvas, not in any React overlay.

C. **Animate via Cytoscape's `cy.animate(...)`** (canvas-side). Rejected by `aud_node_appear_animation` Decision §1 and `aud_axiom_mark_animation` Decision §1 verbatim — the React+DOM layer is the established home for audience animations.

D. **JS-driven tween via `requestAnimationFrame` directly** on a DOM overlay. Rejected by the cumulative posture (Decision §1 of all three predecessors).

E. **`framer-motion` or `react-spring`.** Rejected by the cumulative posture.

**Chosen: A.** Option A is the direct structural mirror of `aud_node_appear_animation`. The node body (the surface being decorated) is on the Cytoscape canvas; the predecessor halo overlay solved the same "decorate a canvas-side element with an animated React halo" problem and the same solution applies. The placement-filter differs (currently-disputed-rollup vs all nodes), the halo palette differs (rose vs slate), the seen-Set semantics differ (target-status-keyed vs creation-keyed — adopting `aud_proposed_to_agreed_animation`'s pattern) but the overall shape is identical.

Option B is rejected because there is no existing React-rendered element associated with the node body that this leaf could wrap. The per-facet pill overlay paints pills ABOVE the node, not on it; the node body itself is canvas paint. Wrapping a pill in `<AudiencePerFacetPillOverlay>` would put a node-level animation in a facet-level overlay, conflating the two layers ADR 0027 separates.

Options C/D/E are rejected for the established posture reasons.

### §2 — A NEW overlay file, NOT a fold into an existing overlay

Subsumed under §1, but called out because it is the load-bearing structural choice (a fifth React file in `apps/audience/src/graph/`). Two sub-options once §1 chose option A:

A. **A new `WithdrawalHaloOverlay.tsx` file mounted as a fifth sibling in `<AudienceGraphView>`.** Mirrors the three other halo / pill overlays in granularity and file location.

B. **Fold the disputed-halo logic into `<AudienceNodeAppearOverlay>`** by adding a second `useSeenKeysGate` call inside it (one for new-node arrivals, one for disputed-rollup arrivals).

**Chosen: A.** A single overlay paints one DOM-overlay class of decoration: node-appear paints "this node is new"; per-facet-pill paints per-facet status chips; axiom-mark paints per-participant declaration badges; annotation paints per-edge annotation labels. Folding the disputed-halo logic into NodeAppear would mix two semantic classes (arrival vs regression) inside one component, complicate the testing (8 cases for arrival × 8 cases for regression × shared state = expensive matrix), and obscure the symmetry of the `aud_animations.*` task group (each task ships its own overlay file, except for the in-place-wrap cases which modify an existing overlay).

Option B is rejected on the same posture as the predecessor refinements adopted for their own structural choices: keep one overlay per animation class; share the abstraction at the hook layer (`useCytoscapeOverlayPlacements` + `useSeenKeysGate`), not at the component layer.

### §3 — Audience-only halo (NOT modify the shell or moderator/participant surfaces)

The withdrawal regression visible on the broadcast audience is not necessarily visible on the moderator or participant surfaces in the same way (the moderator's click-through workflow sees the state via per-facet pills and the action panel; the participant is the actor causing the transition and sees their own retraction). Cross-surface parity is rejected for the same reason `aud_axiom_mark_animation` Decision §3 rejected it: animation is a surface-specific concern, and the moderator/participant surfaces would not necessarily benefit from a halo cue. Future `mod_withdrawal_animation` / `part_withdrawal_animation` are NOT pre-registered; product hasn't surfaced a need.

### §4 — `useSeenKeysGate` keyed by `nodeId` drawn from currently-`'disputed'`-rollup entries (transition-keyed, mirroring `aud_proposed_to_agreed_animation`)

Three options for the seen-Set / key-shape:

A. **`useSeenKeysGate(currentDisputedNodeIds)` where `currentDisputedNodeIds = placements.map(p => p.id)` AND `commitWithdrawalPlacements` early-returns for non-disputed nodes.** The key is the node ID; the array is filtered to only currently-disputed entries (via the commit function's early-return). First non-empty commit seeds with whatever nodes are disputed at audience-join; subsequent commits where a node flips to `'disputed'` produce a key not yet in the set, which the gate returns as new. Non-`'disputed'` rollups contribute no key — they don't seed and don't animate.

B. **`useSeenKeysGate(allNodeIds)` over every node regardless of rollup; gate the animation on `rollupStatus === 'disputed' && isNew(key)`.** Mirrors the same option-B rejection in `aud_proposed_to_agreed_animation` Decision §4: the Set would seed with EVERY node the audience saw at first commit, not just the disputed ones; a node that was `'agreed'` at audience-join and later transitions to `'disputed'` would have its key already in the set, and `isNew` would return `false` — the freshly-disputed node would NOT animate. Breaks the contract.

C. **A bespoke `useRef<Map<string, RollupStatus>>` tracking previous rollup per node; animate when previous was `'agreed'` and current is `'disputed'`.** Encodes the transition explicitly.

**Chosen: A.** Same hook contract, same key-shape rationale as `aud_proposed_to_agreed_animation` Decision §4. The hook's "first observation per session" semantics line up exactly with "first observation in the `'disputed'` rollup state" when `currentKeys` is filtered to only disputed entries (which the commit function does, via the early-return).

Option B is rejected for the same Decision §4 rationale the predecessor surfaced: incorrect seed semantics.

Option C is rejected because the projection already maintains the rollup state on every commit; a parallel `useRef<Map>` mirrors data the overlay already has. The seen-Set-keyed-on-target-status (option A) is the minimal correct shape.

A subtle property of option A: if a node flips `'disputed'` → (somewhere else) → `'disputed'` mid-session, the seen-Set still holds the key from the first `'disputed'` observation, so the re-arrival at `'disputed'` does NOT re-animate. This is intentional (per the "What MUST NOT do" enumeration): the methodology treats withdrawal as a structural commitment event; re-withdrawal after re-agreement is rare and not a methodology pattern, so the conservative "animate the first observation per session" gate is correct.

A second subtle property: the task name "agreed → disputed" reads as a transition arrow with a specific source state, but the gate is target-state-only — a node going from `'proposed'` → `'disputed'`, `'meta-disagreement'` → `'disputed'`, `'committed'` → `'disputed'` (the methodology may not actually generate the latter), or any other source → `'disputed'` would all animate. This is intentional: the visual signal "this node just landed in dispute" is independent of where it came from; the broadcast viewer doesn't need to know the source state, only that the regression-to-dispute just happened. Encoding "specifically from agreed" would (a) require option C's parallel state, (b) split the animation across two paths (animate-from-agreed and don't-animate-from-elsewhere), and (c) not improve the broadcast viewer's experience. The task name's "agreed → disputed" is the **dominant** transition product cares about; the implementation animates a superset that captures the dominant case plus rare edge cases under the same visual.

The lazy-init-on-non-empty contract handles the rAF-batched-empty-first-render correctly per `useSeenKeysGate`'s contract ([`cytoscapeOverlayHooks.ts:159-173`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts#L159)). One edge case worth noting: when the audience joins a session with NO disputed nodes (the common case), the first non-empty placement-commit may be the moment the FIRST node ever lands in `'disputed'`. The lazy-init seeds the just-arrived node's ID as "seen" without animating — the broadcast viewer misses the very first dispute animation of the session. This is the same trade-off the predecessor halo overlay accepts (per `aud_node_appear_animation` Decision §4 — the first non-empty commit is treated as "already mounted" rather than "newly arrived"). Relaxing this would require either (a) a wall-clock-based "post-mount only" gate (rejected by the predecessor for added complexity) or (b) seeding the gate as soon as the audience-app boots regardless of commits (rejected by the hook's contract — the empty-set is the un-seeded state). The trade-off is accepted: the FIRST dispute of a session may miss the animation; every subsequent dispute animates correctly.

### §5 — 450 ms `cubic-bezier(0.16, 1, 0.3, 1)` with `forwards` fill-mode (parity with node-appear halo; pacing revisits)

Three options for the timing curve and duration:

A. **450 ms `cubic-bezier(0.16, 1, 0.3, 1)` with `forwards` fill** (parity with node-appear sibling).

B. **350 ms with the same curve** (parity with axiom-mark and pill-agreed).

C. **600 ms slower for the heavier "regression" semantics** (the visual signal carries more weight than a node arrival, justifying a longer attention window).

**Chosen: A.** The halo geometry is identical to `aud_node_appear_animation` (96px square, radial gradient fading to transparent at 75%); the geometry-driven argument from that predecessor (larger halo benefits from a slower entrance than a small badge or pill chip) applies verbatim. The 450 ms with decelerated easing matches "lands and sticks" semantics for a halo-class decoration.

Option B is rejected because the smaller-target-faster-duration argument that justified 350 ms for axiom-mark and pill-agreed doesn't apply here — the halo is large. The cross-animation tonal grouping the proposed_to_agreed refinement settled on (350 ms for facet-layer commit events, 450 ms for entity-layer halo events) is principled and worth preserving for the broadcast viewer's perceptual classification.

Option C is rejected because the methodology does NOT treat withdrawal as more weighty than node arrival — both are structural events with comparable broadcast significance. Slowing this one would skew the cadence; pacing tuning later may reach for it if the deferred siblings' durations land at conflicting tempos, but 600 ms upfront over-claims the regression's centrality.

The `forwards` fill-mode is load-bearing: the keyframe's `to` state is `opacity: 0` — the halo fades to transparent. Without `forwards`, the halo would snap back to `from` (`opacity: 1; scale(0.6)`) at the end of the animation, leaving a visible opaque dot.

The 450 ms constant is **initial** and may be tuned by `aud_animation_pacing` once the remaining `aud_animations.*` siblings ship. The closer adds `!aud_withdrawal_animation` to the pacing task's `depends` list so this duration becomes one of four shipped inputs the pacing task sees.

### §6 — Vitest pins React-side class logic + CSS file presence; Playwright deferred to `aud_session_url` (chain count now 8)

The Vitest cases pin the behavioural contract:
- Per-render decision logic across all seven `rollupStatus` branches (only `'disputed'` ever produces the halo; only on first observation per node per session; rerender with same statuses does not re-animate).
- CSS keyframe + reduced-motion override presence in the audience CSS file (string-grep smoke pin).

What the tests deliberately do NOT pin:
- Pixel-by-pixel frame capture of the animation (no current frame-capture infrastructure; speculative future `aud_animation_video_regression` is NOT pre-registered).
- Actual CSS rendering (jsdom does not run keyframes; the React tests assert on the class being present, the CSS-file test asserts on the keyframe being defined; together they pin the React→CSS seam end-to-end).
- Live transition in a real audience session (Playwright deferred per the orchestrator brief's "component not yet reachable" exception — the audience is still placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx)).

**Playwright destination check.** The orchestrator brief calls out: "Watch the inherited-debt count on `mod_pw_*` (and similar) catch-all e2e tasks. Before deferring to a future Playwright task, check how many prior refinements already point at it. If it's inheriting from 2+ refinements already, pay debt down instead." The `aud_session_url` task is the audience-side equivalent. As of this leaf, the chain pointing at `aud_session_url`'s Playwright scope includes: `aud_cytoscape_init.md`, `aud_state_management.md`, `aud_ws_client.md`, `aud_axiom_mark_decoration.md`, `aud_axiom_mark_animation.md`, `aud_node_appear_animation.md`, `aud_proposed_to_agreed_animation.md` — seven refinements. Adding this leaf brings the count to eight.

**Justification for deferring rather than splitting.** The same justification the three immediate predecessors surfaced applies verbatim and is reinforced by their precedent: (a) every refinement in the chain is exercising the same surface (the audience graph + overlays once reachable via the `/sessions/:id` route), (b) the Playwright spec for `aud_session_url` will necessarily mount the full audience under a real route and assert against the rendered DOM, (c) the per-leaf scenarios are mostly assertion-additions onto a single test fixture (one mounted audience session, multiple `expect(...)` calls), and (d) the chain's growth is bounded — the remaining unshipped `aud_animations.*` siblings (`aud_decomposition_animation`, `aud_diagnostic_fire_animation`) will plausibly route there too, capping the chain at ten or so refinements. The structural decision (one large spec under `aud_session_url` vs multiple smaller `aud_pw_*` tasks) belongs to the `aud_session_url` refinement, not to this leaf. If the `aud_session_url` closer judges the inherited scenario count too large for a single spec, they SHOULD split into a small set of focused specs (`aud_pw_animations.spec.ts`, `aud_pw_state_arrivals.spec.ts`, etc.) at that point; the per-leaf deferral entries here name their scenarios crisply enough to route mechanically.

This leaf contributes two scenarios to the chain:
1. After mounting a session whose initial event log contains nodes with `'disputed'` rollupStatus, none of the rendered `[data-withdrawal-anim]` halos carry the `aud-withdrawal` class.
2. After a subsequent commit arrives via the WS stream that flips a node's `data.rollupStatus` from `'agreed'` (or any non-`'disputed'` rollup) to `'disputed'`, the halo for that specific node DOES carry the `aud-withdrawal` class within the rAF settle window. Halos for other already-disputed nodes do NOT carry the class.

Pixel-stable post-animation steady state is already covered by `aud_visual_regression`'s deferral entry from `aud_disputed_styling` — the rose-600 border + line-color steady state is the post-animation paint, so the existing deferred VR scope continues to apply unchanged with or without this leaf. No new VR scenario is registered (the regression's outcome IS the disputed paint, which `aud_disputed_styling` already routed).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-29.

- Created `apps/audience/src/graph/WithdrawalHaloOverlay.tsx`: fifth DOM-overlay sibling; `commitWithdrawalPlacements` filters to `rollupStatus === 'disputed'` nodes; `useSeenKeysGate` keys on `nodeId` for a target-status-keyed one-shot gate; halo `<span>` gets `aud-withdrawal` class on first observation per (node, session); `aria-hidden="true"`.
- Created `apps/audience/src/graph/WithdrawalHaloOverlay.test.tsx`: 12 Vitest cases covering initial-mount no-class, post-mount transition gains class via pre-seed sibling pattern, sibling stays unanimated, pan/zoom does not re-fire, 6 non-disputed status parameterized branches (no halo emitted), presence marker, overlay testid + aria-hidden.
- Modified `apps/audience/src/graph/GraphView.tsx`: added import for `AudienceWithdrawalHaloOverlay` and mount line after the existing `<AudienceNodeAppearOverlay>` (fifth overlay sibling); header refined with refinement-trail entry.
- Modified `apps/audience/src/index.css`: appended `[data-withdrawal-anim]` selector (96px halo, rose-600 radial gradient, `opacity: 0` rest), `@keyframes aud-withdrawal` (scale 0.6→1.8, opacity 1→0, 450 ms), `.aud-withdrawal` utility, and `@media (prefers-reduced-motion: reduce)` override.
- Modified `apps/audience/src/index.test.ts`: 2 new CSS smoke pins for `@keyframes aud-withdrawal` presence and the `prefers-reduced-motion` `.aud-withdrawal { animation: none` override clause.
- E2E deferred to `audience.aud_url_routing.aud_session_url` (chain now 8 refinements); two Playwright scenarios documented in Decision §6 of this refinement.
- No new dependency added; `apps/audience/package.json` unchanged.
