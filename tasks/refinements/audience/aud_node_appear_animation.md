# Audience node-appearance animation (a one-shot CSS keyframe applied to per-node React DOM-overlay "halo" wrappers painted by a new `<AudienceNodeAppearOverlay>` sibling of the Cytoscape canvas; gated by a `useRef<Set<string>>` of seen `nodeId` keys so only post-mount node arrivals animate; suppressed under `prefers-reduced-motion: reduce`)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_animations.aud_node_appear_animation` (lines 326-329).
**Effort estimate**: 1d
**Inherited dependencies**:

- `!audience.aud_graph_rendering` (settled — the entire group is `complete 100`). The audience surface already paints node bodies on a Cytoscape canvas via the static `STYLESHEET` consumed by `<AudienceGraphView>` ([`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx)). Element-sync is diff-based: every `events`-change re-projects via [`projectGraph`](../../../apps/audience/src/graph/projectGraph.ts) and calls `cy.json({ elements })`; Cytoscape internally adds/removes by element id. The "which node ids are truly new this tick" decision is already in the codebase — see [`GraphView.tsx:347-374`](../../../apps/audience/src/graph/GraphView.tsx#L347), where `knownNodeIdsRef` (a `useRef<Set<string>>`) drives the conditional `breadthfirst` layout pass. This leaf reuses the same arrival-detection signal for the animation gate.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_axiom_mark_animation` (settled — [`tasks/refinements/audience/aud_axiom_mark_animation.md`](aud_axiom_mark_animation.md)). The predecessor animation sibling that established the `aud_animations.*` group's reusable pattern: a one-shot CSS `@keyframes` rule layered onto a React-keyed wrapper, the per-element class gated by a `useRef<Set<string>>` seeded on the first non-empty commit (NOT the literal first render — `placements.length > 0` check), reduced-motion suppression via `@media (prefers-reduced-motion: reduce)` in CSS rather than JS branching. This leaf is the second hit on the same template; Decision §2 below explains why the template applies verbatim and how the per-node halo overlay shape composes alongside the existing per-node DOM overlays. The predecessor explicitly called out (its §1 / §4) that this leaf inherits the "don't animate every node on first load" initial-mount problem and the same seen-Set guard solves it.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_per_facet_visualization` (settled — [`tasks/refinements/audience/aud_per_facet_visualization.md`](aud_per_facet_visualization.md)). The first DOM-overlay sibling of the Cytoscape canvas, the one that introduced the `audience-graph-root-wrapper` positioning ancestor and the `cyState` `useState<Core | null>` slot so DOM-overlay siblings can see the `Core` handle on their second render. Three overlays already share the wrapper today (`<AudiencePerFacetPillOverlay>`, `<AudienceAxiomMarkOverlay>`, `<AudienceAnnotationOverlay>` per [`GraphView.tsx:389-391`](../../../apps/audience/src/graph/GraphView.tsx#L389)); this leaf adds a fourth (`<AudienceNodeAppearOverlay>`) using the identical mount + subscription shape so all four overlays follow one pattern.
- Prose-only context (NOT a `.tji` edge): `aud_animations.aud_animation_pacing` (sibling, future — [`tasks/50-audience-and-broadcast.tji:350-354`](../../50-audience-and-broadcast.tji#L350)). Already declares `!aud_node_appear_animation` as a direct dependency, so no closer-time `depends` edit is required against this leaf. This refinement chooses an initial 450 ms ease-out duration (slightly longer than the axiom-mark badge's 350 ms — see Decision §5 — because the node entrance is a larger visual movement against a denser background); the pacing task will revisit the constant alongside the other animation siblings' durations.
- Prose-only context (NOT a `.tji` edge): `audience.aud_url_routing.aud_session_url` (sibling, future — see [`tasks/50-audience-and-broadcast.tji`](../../50-audience-and-broadcast.tji), the audience-reachability task). The deferred-e2e debt collector for the audience surface. The predecessor `aud_axiom_mark_animation` already routes its Playwright debt there; this leaf joins the same chain (Decision §6 below). The closer of `aud_session_url` reads accumulated `Status`-block deferred-e2e prose across the chain and scopes the Playwright spec at that point.

## What this task is

The 1d leaf that lights up **arrival animation** on Cytoscape nodes painted by `<AudienceGraphView>`. When a new `node-created` event arrives on the audience event log mid-broadcast — a debater proposes a new wording, the projection emits a new element, the diff-sync calls `cy.json({ elements })` and Cytoscape adds the node — the corresponding node "lands" on the canvas with a brief radial-halo + opacity entrance, drawing the broadcast viewer's eye to the moment of arrival on the graph.

The implementation parallels the axiom-mark predecessor: a new React DOM-overlay sibling of the Cytoscape canvas (`<AudienceNodeAppearOverlay>`) iterates Cytoscape's current node set, positions one absolutely-positioned `<span data-node-appear-anim>` per node centered on `renderedBoundingBox()`, and applies a one-shot `aud-node-appear` animation class to the wrappers whose `nodeId` is "new" (not yet in a `useRef<Set<string>>` of seen keys). The animation itself is a single `@keyframes aud-node-appear` rule defined in `apps/audience/src/index.css`, suppressed under `@media (prefers-reduced-motion: reduce)`.

Because Cytoscape draws its node bodies on a `<canvas>` (not as DOM elements), the animation cannot live on the node body itself — `cy.style(...)` does not support CSS transitions and `cy.animate(...)` runs JS-driven tweens on the main thread that the predecessor's Decision §1 already rejected. The DOM-overlay halo is the architectural workaround: the halo `<span>` paints on top of the canvas at the node's rendered position with `pointer-events: none`, the CSS keyframe animates `opacity` + `transform: scale(...)` on the halo, and the halo is invisible at rest (the `@keyframes` fades from `opacity: 1` at the start to `opacity: 0` at the end, with `forwards` fill so it stays at `0` afterwards). The viewer perceives a brief radial "ping" centered on the new node — the node itself appears at Cytoscape's normal draw speed, and the halo annotates the arrival.

CSS keyframes are inherently one-shot per element lifetime — the animation fires when the wrapper is mounted by React, then never again. The overlay's render path keys each halo `<span>` by `nodeId`, so React reconciles existing halos across re-renders (no re-mount, no re-animation); only React-newly-mounted halos animate. The `seen` Set is the additional guard that handles the **initial-mount** edge case: when the audience surface first loads a session whose event log already carries N committed nodes, all the halos mount simultaneously and would otherwise all animate as if every node had just been created. The Set seeds itself from the first non-empty placement commit (NOT the literal first render — `placements.length > 0` check, mirroring the predecessor's Decision §4 implementation note); on subsequent commits any `nodeId` not in the Set is "new" — animates and is added.

After this leaf:

- `apps/audience/src/graph/NodeAppearOverlay.tsx` — **NEW**. A `<AudienceNodeAppearOverlay>` component mounted as a sibling of the Cytoscape canvas inside `audience-graph-root-wrapper`. Subscribes to the same Cytoscape event vocabulary as the three existing overlays (`render pan zoom resize` + `position node` + `add remove data`), commits placements via the singleton-rAF batch idiom, renders one absolutely-positioned `<span data-node-appear-anim>` per `cy.nodes()` entry, applies `aud-node-appear` class iff the `nodeId` is "new" per `seenNodeIdsRef`. Wraps no children — the halo is a pure decoration `<span>` with CSS-driven background painting (radial gradient via `background-image: radial-gradient(...)`). Header comment-block follows the established overlay shape (refinement + ADR trail).
- `apps/audience/src/graph/NodeAppearOverlay.test.tsx` — **NEW**. Mirrors the per-facet-pill / axiom-mark overlay test shape (install `cytoscapeTestEnv`, mount with a real `cytoscape()` instance, render via `@testing-library/react`). 7 Vitest cases pin: (a) overlay mounts with the `data-testid="audience-node-appear-overlay"` test seam; (b) overlay renders one `[data-node-appear-anim]` wrapper per `cy.nodes()` entry; (c) initial-mount nodes do NOT carry the `aud-node-appear` class; (d) a freshly-added node in a second render DOES carry the class; (e) the prior-rendered sibling node wrappers do NOT regain the class; (f) re-render with the same node set (pan/zoom simulation) does not re-add the class to any wrapper; (g) wrapper position centers on the node's `renderedBoundingBox()` midpoint.
- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. One new import + one new sibling line in the return JSX (mounted alongside the three existing overlays, line 389-391). Header comment-block extends with a refinement-trail entry summarizing Decisions §1-§6. No change to `knownNodeIdsRef` / `positionCacheRef` / `hasFitOnceRef` logic — the new overlay maintains its own `seenNodeIdsRef`, intentionally separate from `knownNodeIdsRef` (the GraphView ref serves a different purpose — gating the `breadthfirst` layout pass — and lives in a different component; Decision §3 below).
- `apps/audience/src/index.css` — MODIFIED. One `@keyframes aud-node-appear` rule plus a `.aud-node-appear` utility selector that consumes it (`animation: aud-node-appear 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards;`); one `@media (prefers-reduced-motion: reduce) { .aud-node-appear { animation: none; } }` override; a small static `[data-node-appear-anim]` rule that fixes the halo's intrinsic size and `background-image` radial gradient (the halo's visual character is in CSS so the React render path stays declarative).
- `apps/audience/src/index.test.ts` — MODIFIED. 2 new Vitest cases appended to the existing 2 (the file already exists per the axiom-mark predecessor) asserting `@keyframes aud-node-appear` presence and the matching `prefers-reduced-motion: reduce` override clause.

Out of scope (deferred to existing or future leaves):

- **Moderator-side node-appearance animation.** The moderator's ReactFlow `<StatementNode>` consumes the same projection but mounts in a different React tree without this overlay. Cross-surface parity is intentionally out of scope (the moderator's click-through workflow benefits less from arrival animation than the broadcast viewer's passive watch); a future `mod_node_appear_animation` task would scope it if product surfaces a moderator UX trigger. **NOT pre-registered** (speculative).
- **Participant-side node-appearance animation.** Participants see node arrivals in their own ReactFlow surface; same reasoning, same posture. **NOT pre-registered.**
- **Edge-appearance animation.** New edges land on the canvas alongside new nodes (the projection emits both per `node-created` / `edge-created` pairs). Animating edge arrival is a separate concern (the visual problem is different — edges are line segments stretching between two anchor points, not centered halos) and the `aud_animations.*` group as currently scoped does not call it out. **NOT pre-registered** today; if a future "edge arrival" entrance is wanted it lands as a new sibling task (`aud_edge_appear_animation`, ~0.5d) consuming a similar overlay-halo pattern adapted to edge geometry.
- **Node-deletion animation.** Nodes don't disappear under normal play — the projection treats events as monotonic. Withdrawal moves a node between agreement states (handled by `aud_withdrawal_animation`, sibling), it does not remove the node. **NOT a future task.**
- **Pixel-stable frame-by-frame capture.** Animation timing is not captured by `aud_visual_regression`'s steady-state snapshots; the regression task pins post-animation steady state (the halo fades to `opacity: 0` and the node body holds the existing per-state paint). Animation-timing capture would be the speculative `aud_animation_video_regression` (~1d, **NOT pre-registered** today; the predecessor refinement also held off on registering it).
- **Pacing constant tuning across the animation set.** This leaf chooses 450 ms ease-out as the initial duration (vs. 350 ms for the axiom-mark badge — see Decision §5 rationale); `aud_animation_pacing` is the cross-cutting cadence-tuning task that will revisit both constants. The pacing task's `.tji` `depends` already names `!aud_node_appear_animation`, so no closer-time `depends` edit is required against this leaf.
- **Animation on node `data` changes that are not creation.** A node's state can change post-arrival (proposed → agreed, etc.); those transitions are the territory of `aud_proposed_to_agreed_animation`, `aud_withdrawal_animation`, `aud_diagnostic_fire_animation`. This leaf's gate is strictly per-`nodeId` creation; if a node id reappears after being removed (an edge case the projection doesn't currently produce), the seen-Set would correctly NOT re-animate it. Re-arrival semantics are not a current concern.
- **A Playwright spec exercising the live arrival animation.** Per the deferred-e2e exception in the orchestrator brief (component not yet reachable): the audience surface is still placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx); the per-session route lands in `aud_url_routing.aud_session_url`. Full deferral applies — the Vitest pins above cover the behavioral seam (wrapper class is/isn't applied per-render). Decision §6 documents the routing of this debt onto the already-accumulating chain.
- **`framer-motion`, `react-spring`, or any motion-framework dependency.** Rejected (Decision §1; cumulative posture of the `aud_animations.*` group, established by the predecessor).
- **`cy.animate()` on the Cytoscape node directly.** Rejected (Decision §1 — keeps the CSS-first / DOM-overlay posture the predecessor established; avoids JS-driven tweens on the main thread).

## Why it needs to be done

The methodology of `a-conversa` treats node creation as a **structural commitment**: when a participant proposes a new wording, classification, or substance, a new node lands on the shared graph and becomes part of the conversation's load-bearing skeleton. For a passive broadcast viewer watching the audience surface during a live debate, a silent node appearing in some corner of a dense canvas is easy to miss — the eye is elsewhere, Cytoscape's default node-draw is instant (no entrance), and a fully-formed new node provides no "this just happened" temporal vocabulary. The arrival animation is the broadcast surface's signal that a structural event has just landed: the viewer sees a halo briefly bloom at the new node's position, learns within ~450 ms that the graph just grew, and can follow the conversation's evolution in real time.

The `aud_animations` task group exists precisely to add this temporal vocabulary on top of the steady-state visualization. The siblings (`aud_node_appear_animation` — this leaf; `aud_proposed_to_agreed_animation`; `aud_decomposition_animation`; `aud_withdrawal_animation`; `aud_diagnostic_fire_animation`; `aud_axiom_mark_animation` — settled) each pick up one structural-event class and render its "moment of arrival" so the broadcast viewer can follow the debate's evolution. Without node-appearance animation, the most common structural event class — every `node-created` is one — would be the only fully-silent arrival in the set. The axiom-mark predecessor settled the smallest-scope class (one specific badge type); this leaf handles the broadest-scope class (every new node).

Downstream concretely:

- **`aud_animation_pacing`** ([`tasks/50-audience-and-broadcast.tji:350-354`](../../50-audience-and-broadcast.tji#L350)) is the cross-cutting cadence-tuning task; this leaf's chosen 450 ms is one of two animation-duration inputs it already names. Once the remaining `aud_animations.*` siblings ship, the pacing task compares all six and may rebalance them so simultaneous arrivals (a new node WITH a fresh axiom-mark, say) don't visually collide.
- **`aud_session_url`** is the audience-reachability task; once it lands the inherited Playwright debt clears (Decision §6).
- **`aud_visual_regression`** pins the post-animation steady state — the halo fades to `opacity: 0` (invisible) and the node body sits in its existing per-state paint; no change to the steady-state visual contract.
- **The remaining `aud_animations.*` siblings** inherit this leaf's template — the overlay-halo + seen-Set + reduced-motion CSS posture maps directly onto the proposed-to-agreed / decomposition / withdrawal / diagnostic-fire animations (each may need different keyframe geometry but the same scaffolding holds). Establishing the second overlay-halo instance here pays the up-front cost so the remaining siblings each reach for the same template.

Architecturally, this leaf consolidates the precedent the axiom-mark predecessor established: CSS-first, `prefers-reduced-motion: reduce` suppression in CSS not TS, `useRef<Set>` initial-mount guard, no motion-framework dependency, no Cytoscape canvas-side animation. With two animation siblings using the identical pattern, the template is no longer speculative — it's the cumulative posture of the audience surface's animation layer.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience uses Cytoscape with React DOM overlays. Per-element React decoration (here, the per-node halo overlay) is the canonical pattern; Cytoscape's canvas-side `cy.animate(...)` API is reachable but rejected here for the same reasons the predecessor rejected it (Decision §1).
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the existing audience CSS lives at `apps/audience/src/index.css` with the Tailwind v4 `@import` and `@source` directives; the axiom-mark `@keyframes` already coexists with Tailwind utilities at the same CSS layer ([`apps/audience/src/index.css:86-105`](../../../apps/audience/src/index.css#L86)). This leaf appends a second keyframe under the same convention.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest pins the React-side behavior (per-render decision logic; presence/absence of the class). A second Vitest pair reads the CSS file from disk to confirm the keyframe + reduced-motion clause exist. Pixel-level frame-by-frame animation capture is out of scope (no current task has frame-capture infrastructure).
- [ADR 0024 — Frontend i18n: react-i18next + ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — no new i18n keys. The halo has no visible text and no accessibility-label requirement (the halo is `aria-hidden="true"`; screen readers narrate the node via Cytoscape's own a11y plumbing, animation or not).
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the audience artifact owns its CSS; the new keyframe ships inside the audience bundle and does not leak to the moderator or participant artifacts.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — node arrival is an entity-layer event (the node entity is created); the halo paints on top of the entity body, orthogonal to the per-facet pill row and the per-participant axiom-mark badge row.

No new ADR. The architectural seams (CSS-first overlay-halo, React-keyed reconciliation, `prefers-reduced-motion` in CSS, no motion-framework dependency) are either settled by existing ADRs or by the cumulative posture the axiom-mark predecessor established and this leaf reinforces.

### Sibling refinements

- [`tasks/refinements/audience/aud_axiom_mark_animation.md`](aud_axiom_mark_animation.md) — the direct predecessor sibling. Decisions §1 (CSS keyframe + React-keyed wrapper), §4 (`useRef<Set>` initial-mount guard; lazy-init gated on `placements.length > 0`), §6 (Vitest pins React-side + CSS-file presence; Playwright deferred to `aud_session_url`) all apply verbatim here, modulo the per-node halo geometry vs. per-badge wrapper geometry. The implementation pattern is "the same shape, but for nodes instead of axiom-mark badges."
- [`tasks/refinements/audience/aud_per_facet_visualization.md`](aud_per_facet_visualization.md) — the first DOM-overlay sibling; established the `audience-graph-root-wrapper` + `cyState` slot + rAF-batched subscription shape that this leaf's overlay follows verbatim. Decisions §1, §4, §5 are the canonical references for the overlay scaffolding.
- [`tasks/refinements/audience/aud_axiom_mark_decoration.md`](aud_axiom_mark_decoration.md) — the second DOM-overlay sibling (and the substrate the axiom-mark animation decorates); same overlay scaffolding, different anchor point. Confirms the pattern is reused across three overlays today (per-facet pill, axiom-mark, annotation) and is no longer one-off.
- [`tasks/refinements/audience/aud_annotation_rendering.md`](aud_annotation_rendering.md) — the third DOM-overlay sibling, latest hit on the same template. By the time this leaf lands, four DOM-overlay siblings share the wrapper; the new overlay is the fifth.
- [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md) — establishes the `cyState` + `cyRef` discipline and Decision §8 (no `window.__aConversaAudienceCyInstance` test seam — the overlay test reads the cy instance from a `cyRef` callback wrapper or constructs its own cytoscape instance in the test, never from a global).
- [`tasks/refinements/audience/aud_clean_typography.md`](aud_clean_typography.md) — the precedent for "the audience-only CSS file is the right home for custom rules" (the `--font-broadcast` token lives there). The keyframe lands beside the axiom-mark keyframe in the same file.

### Live code the leaf modifies / creates

- [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) (lines 207-209 — overlay imports; lines 386-393 — return JSX). The diff is two-line: one new import for `AudienceNodeAppearOverlay`, one new JSX sibling line between the existing three overlays. The header comment-block (lines 1-198) extends with a Refinement entry citing Decisions §1-§6. No change to `knownNodeIdsRef`, `positionCacheRef`, `hasFitOnceRef`, or any of the effect bodies; the new overlay maintains its own animation state.
- [`apps/audience/src/graph/AxiomMarkOverlay.tsx`](../../../apps/audience/src/graph/AxiomMarkOverlay.tsx) — UNCHANGED. The new overlay is a sibling, not a wrapper.
- [`apps/audience/src/graph/PerFacetPillOverlay.tsx`](../../../apps/audience/src/graph/PerFacetPillOverlay.tsx) — UNCHANGED.
- [`apps/audience/src/graph/AnnotationOverlay.tsx`](../../../apps/audience/src/graph/AnnotationOverlay.tsx) — UNCHANGED.
- [`apps/audience/src/graph/cytoscapeTestEnv.ts`](../../../apps/audience/src/graph/cytoscapeTestEnv.ts) — UNCHANGED. The new overlay test consumes the existing test env via `installCytoscapeTestEnv()` exactly as the sibling overlay tests do.
- [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts) — UNCHANGED. The animation is a render-layer concern; the projection emits `{ group: 'nodes', data: { ... } }` per `node-created` event today, and the overlay reads `cy.nodes()` after the diff-sync, so no projection field needs adding.
- [`apps/audience/src/graph/stylesheet.ts`](../../../apps/audience/src/graph/stylesheet.ts) — UNCHANGED. Cytoscape's node selectors stay paint-only; the halo is React + CSS.
- [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) — MODIFIED. Append a `@keyframes aud-node-appear` block, a `.aud-node-appear` utility class that consumes it, the matching `prefers-reduced-motion: reduce` override, AND a static `[data-node-appear-anim]` rule that fixes the halo's intrinsic size + radial-gradient `background-image` (so the React render path passes only positioning; everything else is CSS-side).
- [`apps/audience/src/index.test.ts`](../../../apps/audience/src/index.test.ts) — MODIFIED. The file already exists (created by the axiom-mark predecessor) with two `@keyframes aud-axiom-mark-land` smoke pins; this leaf appends two parallel pins for `@keyframes aud-node-appear` (presence + reduced-motion override).
- `packages/shell/src/**` — UNCHANGED. The halo is audience-specific decoration; no shell extraction.
- `apps/audience/package.json` — UNCHANGED. No new dependency.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**`, `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx` — UNCHANGED.

### What the surface MUST NOT do

- **No new dependency.** `framer-motion`, `react-spring`, `@react-spring/web`, `motion`, `react-transition-group` are all rejected (Decision §1; cumulative posture established by the predecessor).
- **No `cy.animate(...)` call.** Rejected by the predecessor and reaffirmed here; the halo overlay is the architectural answer to "Cytoscape canvas doesn't CSS-animate" (Decision §1).
- **No edit to the Cytoscape `STYLESHEET`.** Per-element node styling stays paint-only; the animation lives entirely in the React + CSS layer.
- **No JavaScript-driven animation loop.** No `requestAnimationFrame`-pump that tweens opacity/scale per frame; no `setTimeout` chain. The CSS keyframe runs on the GPU compositor; JS only decides which wrappers get the class.
- **No animation on initial mount.** Nodes already present in the event log at first render are seeded into the seen-Set on the first non-empty placement commit (NOT the literal first render — `placements.length > 0` guard; mirrors the predecessor's Decision §4 implementation note) and rendered without the animation class.
- **No animation re-fire on pan/zoom/resize.** Because the halo wrapper is keyed by `nodeId` and React reconciles by key, the existing halo DOM is reused across re-renders — CSS keyframes do not re-fire on rerender, only on mount.
- **No mutation of `knownNodeIdsRef` from the new overlay.** That ref lives in `<AudienceGraphView>` and serves the layout-pass gate; the new overlay maintains its own `seenNodeIdsRef` so the two concerns stay separate (Decision §3).
- **No edit to `<AudiencePerFacetPillOverlay>`, `<AudienceAxiomMarkOverlay>`, `<AudienceAnnotationOverlay>`.** Three of these already share the overlay shape; the fourth is independent.
- **No edit to the moderator or participant surfaces.** Cross-surface animation parity is explicitly out of scope.
- **No new i18n keys.** The halo has no visible label and adds no a11y prose. The halo's `<span>` carries `aria-hidden="true"` so screen readers skip it.
- **No edit to `tasks/50-audience-and-broadcast.tji` beyond the closer's `complete 100`.** The `aud_animation_pacing` `depends` line ALREADY names `!aud_node_appear_animation` (verified at line 354), so no closer-time `depends` edit is required against this leaf. The closer's ritual is one-step: `complete 100`.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/NodeAppearOverlay.tsx` — **NEW**. Shape:

  ```tsx
  // Header comment-block: refinement-trail (aud_node_appear_animation
  // Decisions §1-§6), ADR references (0004, 0022, 0026, 0027), overlay
  // posture (pointer-events: none; aria-hidden; pure decoration).

  import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
  import type { Core, NodeSingular } from 'cytoscape';

  export interface AudienceNodeAppearOverlayProps {
    readonly cy: Core | null;
    readonly containerRef: RefObject<HTMLDivElement | null>;
  }

  interface NodeAppearPlacement {
    readonly id: string;
    readonly x: number;
    readonly y: number;
  }

  export function AudienceNodeAppearOverlay({
    cy,
    containerRef,
  }: AudienceNodeAppearOverlayProps): ReactElement {
    void containerRef;
    const [placements, setPlacements] = useState<readonly NodeAppearPlacement[]>([]);
    const frameRef = useRef<number | null>(null);
    // Per Decision §4 — lazy-initialize the seen-Set from the FIRST
    // non-empty placement commit, not the literal first render. The
    // predecessor's implementation note (seenMarkKeysRef gated on
    // placements.length > 0) applies verbatim.
    const seenNodeIdsRef = useRef<Set<string> | null>(null);
    if (seenNodeIdsRef.current === null && placements.length > 0) {
      const seeded = new Set<string>();
      placements.forEach((p) => seeded.add(p.id));
      seenNodeIdsRef.current = seeded;
    }
    const seenNodeIds = seenNodeIdsRef.current;

    useEffect(() => {
      if (cy === null) return undefined;
      const commit = (): void => {
        frameRef.current = null;
        const next: NodeAppearPlacement[] = [];
        cy.nodes().forEach((node: NodeSingular) => {
          const bb = node.renderedBoundingBox();
          next.push({
            id: node.id(),
            x: (bb.x1 + bb.x2) / 2,
            y: (bb.y1 + bb.y2) / 2,
          });
        });
        setPlacements(next);
      };
      const scheduleUpdate = (): void => {
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(commit);
      };
      scheduleUpdate();
      cy.on('render pan zoom resize', scheduleUpdate);
      cy.on('position', 'node', scheduleUpdate);
      cy.on('add remove data', scheduleUpdate);
      return () => {
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        cy.off('render pan zoom resize', scheduleUpdate);
        cy.off('position', 'node', scheduleUpdate);
        cy.off('add remove data', scheduleUpdate);
      };
    }, [cy]);

    return (
      <div
        data-testid="audience-node-appear-overlay"
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
      >
        {placements.map((p) => {
          const isNew = seenNodeIds !== null && !seenNodeIds.has(p.id);
          if (isNew) seenNodeIds.add(p.id);
          return (
            <span
              key={p.id}
              data-node-appear-anim=""
              data-element-id={p.id}
              className={isNew ? 'aud-node-appear' : ''}
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

  export default AudienceNodeAppearOverlay;
  ```

  (The `useRef<Set<string> | null>(null)` + lazy-init-on-non-empty-placements pattern is verbatim from the predecessor; the per-node `isNew` decision + add-to-set is the same idiom.)

- `apps/audience/src/graph/NodeAppearOverlay.test.tsx` — **NEW**. 7 Vitest cases following the `AxiomMarkOverlay.test.tsx` shape (install `cytoscapeTestEnv` once in `beforeAll`, `i18next` not strictly needed since the overlay renders no text but the test fixture can still mount via `I18nProvider` for shape parity, mount overlay against a self-created cy instance, seed precisely the cy state each case needs):
  1. **Test seam present.** Mount overlay with a `cy` carrying two nodes. Query `[data-testid="audience-node-appear-overlay"]` — present and `aria-hidden="true"`.
  2. **One halo per node.** Same fixture. Query `[data-node-appear-anim]` count — equals 2. Each halo carries `data-element-id` matching one of the two node ids.
  3. **Initial-mount: no animation class.** Same fixture. Neither halo carries the `aud-node-appear` class. (Decision §4: initial-mount halos are seeded into seen-Set on first non-empty commit.)
  4. **Post-mount arrival: animation class on the new halo.** Mount with one node, then `act(() => { cy.add({ group: 'nodes', data: { id: NODE_B } }); })` to fire the `add` event. After the rAF-batched commit, the halo whose `data-element-id` matches `NODE_B` DOES carry the `aud-node-appear` class.
  5. **Post-mount arrival: existing halos remain unanimated.** Same scenario as (4) — the halo for `NODE_A` (initial mount) does NOT carry the class after the rerender.
  6. **Rerender with identical node set: no class spread.** Mount with two nodes; trigger `cy.emit('pan')`; after the second commit, no halo carries the `aud-node-appear` class.
  7. **Wrapper position centers on `renderedBoundingBox()` midpoint.** Mount with one node at a known position; assert the halo's inline `left` / `top` styles equal `(bb.x1+bb.x2)/2` / `(bb.y1+bb.y2)/2`. (Pins the geometry contract so a future refactor of the placement math is caught.)

  Existing tests in sibling overlay test files pass unchanged (no shared module mutated).

- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. Two-line render diff:

  ```tsx
  import { AudienceAnnotationOverlay } from './AnnotationOverlay.js';
  import { AudienceNodeAppearOverlay } from './NodeAppearOverlay.js'; // NEW
  // ...
  return (
    <div data-testid="audience-graph-root-wrapper" className="relative h-full w-full">
      <div ref={containerRef} data-testid="audience-graph-root" className="h-full w-full" />
      <AudiencePerFacetPillOverlay cy={cyState} containerRef={containerRef} />
      <AudienceAxiomMarkOverlay cy={cyState} containerRef={containerRef} />
      <AudienceAnnotationOverlay cy={cyState} containerRef={containerRef} />
      <AudienceNodeAppearOverlay cy={cyState} containerRef={containerRef} /> {/* NEW */}
    </div>
  );
  ```

  Mount order matters cosmetically: the node-appear halo mounts LAST so its absolutely-positioned `<span>` stacks above the three earlier overlays' chrome at the moment of node arrival, ensuring the halo isn't visually clipped by a pill row or badge row that happens to overlap the node center. The CSS `z-index` is intentionally not set (the DOM order suffices and a `z-index` would couple this overlay to the rest); document-order stacking is fine for a pointer-events-none decoration.

  Header comment-block extends with the Refinement entry.

- `apps/audience/src/index.css` — MODIFIED. Append (after the existing `aud-axiom-mark-land` block):

  ```css
  /* `aud_node_appear_animation` — one-shot halo animation on Cytoscape
   * node arrival.
   * Refinement: tasks/refinements/audience/aud_node_appear_animation.md
   *   Decision §1 — CSS @keyframes on a React-keyed halo overlay <span>,
   *   NOT a JS-driven tween, NOT a motion-framework dependency, NOT a
   *   cy.animate() call (Cytoscape canvas-side animation is rejected for
   *   the same reasons the predecessor rejected it).
   *   Decision §5 — 450 ms with cubic-bezier(0.16, 1, 0.3, 1) ("emphasized
   *   decelerate"); longer than the axiom-mark badge's 350 ms because the
   *   halo's larger geometry and dense-canvas placement benefit from a
   *   slightly slower entrance. `forwards` fill-mode keeps the halo at
   *   the `to` state (opacity: 0) after the animation completes so it is
   *   invisible at rest.
   *   Decision §6 — prefers-reduced-motion: reduce suppression in CSS
   *   (not TS — the class is always emitted by the render path).
   */
  [data-node-appear-anim] {
    width: 96px;
    height: 96px;
    pointer-events: none;
    background-image: radial-gradient(
      circle,
      rgba(15, 23, 42, 0.35) 0%,
      rgba(15, 23, 42, 0.10) 50%,
      rgba(15, 23, 42, 0)    75%
    );
    opacity: 0;
    border-radius: 50%;
  }

  @keyframes aud-node-appear {
    from {
      opacity: 1;
      transform: translate(-50%, -50%) scale(0.4);
    }
    to {
      opacity: 0;
      transform: translate(-50%, -50%) scale(1.6);
    }
  }

  .aud-node-appear {
    animation: aud-node-appear 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @media (prefers-reduced-motion: reduce) {
    .aud-node-appear { animation: none; }
  }
  ```

  Note the keyframe's `transform` includes `translate(-50%, -50%)` because the React inline style sets `transform: translate(-50%, -50%)` for centering; the CSS animation overrides the inline `transform` while running, so the keyframe must carry the centering translate alongside the scale (the same trick the per-facet pill row uses for centering, generalized). The slate-700 gradient color (`rgba(15, 23, 42, ...)`) matches the audience's existing border palette per `aud_agreed_styling.md` / `aud_disputed_styling.md` so the halo reads as "of the same surface" rather than a foreign accent.

- `apps/audience/src/index.test.ts` — MODIFIED. Append 2 cases parallel to the existing 2:
  1. `apps/audience/src/index.css` contains the substring `@keyframes aud-node-appear`.
  2. `apps/audience/src/index.css` contains both `prefers-reduced-motion: reduce` AND, within (or after) that media-block, a `.aud-node-appear { animation: none` override (whitespace-tolerant). Because the existing 2 cases already grep for `prefers-reduced-motion: reduce`, the new case adds the `.aud-node-appear` selector check specifically — the assertion can be written as a regex that looks for the literal `.aud-node-appear` followed by `{ animation: none` (with optional whitespace) anywhere in the file content.

### Files this task does NOT touch

- `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — UNCHANGED.
- `packages/shell/**`, `packages/shared-types/**`, `packages/i18n-catalogs/**` — UNCHANGED.
- `apps/audience/src/graph/projectGraph.ts`, `apps/audience/src/graph/stylesheet.ts`, `apps/audience/src/graph/facetStatus.ts`, `apps/audience/src/graph/layoutOptions.ts`, `apps/audience/src/graph/cytoscapeTestEnv.ts`, `apps/audience/src/graph/PerFacetPillOverlay.tsx`, `apps/audience/src/graph/AxiomMarkOverlay.tsx`, `apps/audience/src/graph/AnnotationOverlay.tsx`, `apps/audience/src/graph/AxiomMarkBadge.tsx` (audience-local shim, if still present — actual badge lives in shell), `apps/audience/src/graph/axiomMarks.ts` — UNCHANGED.
- `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx` — UNCHANGED.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED (no new dep).
- `docs/adr/**` — UNCHANGED. No new ADR.
- `playwright.config.ts` / `tests/e2e/**` — UNCHANGED. Playwright deferral per Decision §6.
- `.tji` files — `complete 100` lands at task-completion time per the [README ritual](../README.md); the closer owns that single edit (no `depends` line touch is required — `aud_animation_pacing` already names `!aud_node_appear_animation`).

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/NodeAppearOverlay.tsx` exists with the structure outlined in Constraints (props, `seenNodeIdsRef` lazy-init gated on `placements.length > 0`, rAF-batched `commit`, three subscriptions, per-node `isNew` decision, halo `<span data-node-appear-anim>` with conditional `aud-node-appear` class, `aria-hidden="true"` on the overlay root).
- `apps/audience/src/graph/NodeAppearOverlay.test.tsx` exists with the 7 Vitest cases listed above; all 7 pass.
- `apps/audience/src/graph/GraphView.tsx` imports `AudienceNodeAppearOverlay` and mounts it as the LAST overlay sibling inside the `audience-graph-root-wrapper`; header comment-block extended with the refinement-trail entry.
- `apps/audience/src/index.css` carries the `@keyframes aud-node-appear` rule, the `.aud-node-appear` utility, the `[data-node-appear-anim]` static rule (size + radial gradient + `opacity: 0` rest state), and the `prefers-reduced-motion: reduce` override per Constraints.
- `apps/audience/src/index.test.ts` carries the 2 new cases (in addition to the existing 2 for `aud-axiom-mark-land`); the file's total assertion count is 4.
- `packages/shell/**` is byte-unchanged (no cross-surface impact).
- `apps/audience/package.json` is byte-unchanged (no new dependency).
- All three existing audience overlay tests (`PerFacetPillOverlay.test.tsx`, `AxiomMarkOverlay.test.tsx`, `AnnotationOverlay.test.tsx`) pass unchanged.
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer pins (a) the React-side per-render class logic via 7 cases on the new overlay component and (b) the CSS file's keyframe + reduced-motion definitions via the 2 new cases in `index.test.ts`. Animation-timing pixel capture is left to the speculative `aud_animation_video_regression` (NOT pre-registered today).
- Per the orchestrator brief's deferred-e2e exception ("component not yet reachable"): Playwright coverage for the animation is **deferred to `aud_url_routing.aud_session_url`** — the same destination as the axiom-mark predecessor. This refinement registers the deferred-e2e debt as prose under the Status block (the closer of `aud_session_url` reads the accumulated chain — `aud_cytoscape_init.md` / `aud_state_management.md` / `aud_ws_client.md` / `aud_axiom_mark_decoration.md` / `aud_axiom_mark_animation.md` / this leaf — and scopes the Playwright spec at that point). The two scenarios this leaf contributes: (i) a freshly-arrived node's halo carries the `aud-node-appear` class; (ii) a node already present at page load does NOT carry the class. See Decision §6 for the routing rationale.
- The closer does NOT need to edit the `aud_animation_pacing` `depends` line — verified at [`tasks/50-audience-and-broadcast.tji:354`](../../50-audience-and-broadcast.tji#L354) it already names `!aud_node_appear_animation`. (Contrast the axiom-mark predecessor, where the closer DID extend the line.)
- `pnpm run check` clean (strict TS pass; no new dep declared).
- `pnpm run test:smoke` green (Vitest count rises by 7 (new overlay tests) + 2 (CSS smoke pins) = 9 new cases).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is minimal — one small component (~150 LOC including comments), one CSS block (~30 lines), no new dependency.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_node_appear_animation` in the same commit (the closer's ritual).
- **Infra debt to flag in Status block**: per the orchestrator brief, the closer notes the pre-existing `foundation.ci.cucumber_v8_wasm_jit_crash` (Node v24 pglite WASM JIT crash in cucumber teardown — tests still pass, teardown emits an error) so the fixer sub-agent recognizes the error as pre-existing rather than introduced by this leaf. No new debt registration is required; the foundation task already tracks it.

## Decisions

### §1 — DOM-overlay halo with CSS `@keyframes` (NOT `cy.animate`, NOT canvas-side, NOT motion framework, NOT JS tween)

Four options for "play an animation when a Cytoscape node arrives":

A. **`<AudienceNodeAppearOverlay>` DOM-overlay halo with CSS `@keyframes`.** Mirror the axiom-mark / per-facet pill / annotation overlay shape — paint a per-node `<span>` at the node's `renderedBoundingBox()` midpoint, give the wrapper a `aud-node-appear` class that triggers a `@keyframes` rule. CSS keyframes are inherently one-shot per element lifetime — the animation fires once on mount and never again. React's keyed reconciliation handles "which halos are new" automatically. Reduced-motion handled in CSS via `@media (prefers-reduced-motion: reduce)`. Zero new dependency.

B. **`cy.animate(...)` on the Cytoscape node.** When a new node is added (detected via `knownNodeIdsRef` or a fresh ref), call `node.style({ opacity: 0 }).animate({ style: { opacity: 1 } }, { duration: 450, easing: 'ease-out' })`. The animation runs on Cytoscape's canvas-side animation pipeline (a JS-driven rAF loop). Reduced-motion handled by JS branching on `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.

C. **JS-driven tween via `requestAnimationFrame` directly.** Maintain per-node animation state (start time, current frame); on each rAF tick, compute the easing fraction and write style on either the Cytoscape node (via `style()`) or a DOM-overlay element.

D. **`framer-motion` (or equivalent) layout animation.** Wrap each halo in a `<motion.span layout initial={...} animate={...} />`. The library handles the lifecycle; reduced-motion handled via the library's `useReducedMotion()` hook.

**Chosen: A.** The DOM-overlay halo with CSS keyframe is the same template the axiom-mark predecessor settled on, adapted to "the wrapped element is a halo decoration rather than a badge body." React's reconciliation IS the lifecycle bookkeeping; CSS's per-element keyframe lifetime IS the play-once guarantee; `prefers-reduced-motion` IS the OS-level a11y honoring. No JS animation loop, no new dependency, no library-specific abstraction to learn. The architectural cost is one new React component (the overlay) plus ~30 lines of CSS; the cost is fully amortized by the existing overlay scaffolding (three overlays already share the shape).

Option B is rejected for three reasons. First, `cy.animate(...)` runs JS-driven tweens on the main thread (Cytoscape's animation engine is a `setInterval`/rAF pump over its element collection), reintroducing exactly the main-thread cost the predecessor's Decision §1 already rejected. Second, animating `style.opacity` on a Cytoscape node only fades the node's body — there's no clean way to add a "halo bloom" decoration on canvas-side without drawing custom Cytoscape extensions or overriding the renderer. Third, the predecessor established CSS-first as the cumulative posture; deviating here for the second animation sibling would fragment the pattern before the remaining four siblings even land.

Option C is rejected as needless complexity — JS-driven tweens reinvent what the CSS compositor does for free, run on the main thread, and require manual reduced-motion plumbing.

Option D is rejected because the audience surface today has zero motion-framework dependencies, and adopting one for an animation leaf would commit the codebase to a non-trivial runtime dependency. The predecessor's Decision §2 articulated this posture; this leaf reinforces it. If a later leaf genuinely needs orchestration that CSS can't express (a sequence of staged animations across multiple elements with shared timing, say), THAT leaf adopts a framework and refactors at the same time; this leaf doesn't pre-commit. The codebase remains framework-free by default.

### §2 — Reuse predecessor's overlay-component shape verbatim (NOT extract a shared "AnimatedOverlay" primitive)

Two options once the predecessor's pattern is in place:

A. **Copy the overlay shape into a new `<AudienceNodeAppearOverlay>` component.** Direct verbatim copy of the rAF-batched commit + three subscriptions + lazy-init-on-non-empty-placements `useRef<Set>` from `<AudienceAxiomMarkOverlay>`, swapping the per-element data read (axiom marks → just node identity) and the rendered child (badge row → halo `<span>`).

B. **Extract a shared `<KeyedCytoscapeNodeOverlay<T>>` (or equivalent) primitive in `apps/audience/src/graph/` that the four overlays consume.** The primitive owns the rAF-batched commit, the subscription set, the seen-Set lazy-init, and exposes a render-prop or children-as-function for per-element rendering.

**Chosen: A.** The "rule of three" extraction trigger is the conventional bar; today the audience has three overlays (`<AudiencePerFacetPillOverlay>`, `<AudienceAxiomMarkOverlay>`, `<AudienceAnnotationOverlay>`) that share substantial scaffolding plus this leaf's fourth. That IS the rule-of-three trigger by count — but extraction is its own ~1-day task, requires care with the typed-render-prop API, and would change the implementation of the three already-shipped overlays in lockstep with adding the fourth (review surface area inflates from "one new file" to "one new file + three refactored files"). Doing both at once mixes "land the animation behavior" with "refactor three working components," which inflates risk and review surface.

The right answer is to ship A here (verbatim copy) AND register the extraction as a named-future-task: **`aud_dom_overlay_extraction`** (~1d, NOT pre-registered today as a `.tji` leaf; closer of this task adds it to `tasks/50-audience-and-broadcast.tji` under `aud_animations` or under a refactor sub-group). The future extraction task refactors all four overlays simultaneously and is the appropriate place for the API-design conversation that the extraction needs (render-prop vs. children-as-function vs. headless-hook). Shipping the duplication now, registering the refactor for later, is the cleaner separation. (Acceptance criteria lists the named-future-task; the closer registers it in the WBS as part of the closer ritual.)

This is consistent with how the codebase has handled prior "fourth duplicate triggers a future extraction" decisions — the `facetStatus.ts` consolidation was handled the same way (deferred to `shell_facet_status_extraction`).

### §3 — Independent `seenNodeIdsRef` in the overlay (NOT reuse `<AudienceGraphView>`'s `knownNodeIdsRef`)

Two options for the seen-Set state:

A. **Maintain `seenNodeIdsRef` inside the overlay component**, mirroring the predecessor's `seenMarkKeysRef`. The ref's seed condition is the first non-empty `placements` commit; subsequent renders compute `isNew = !seen.has(id)`.

B. **Lift the seen-Set to `<AudienceGraphView>` and pass it (or `trulyNewNodeIds`) down as a prop to the overlay.** The GraphView already has a `knownNodeIdsRef` for the layout-pass gate (lines 242, 355, 373); the overlay could consume the same source.

**Chosen: A.** The two refs serve different purposes and live on different state lifecycles. `knownNodeIdsRef` in GraphView is mutated INSIDE the element-sync `useEffect` AFTER `cy.json({ elements })` and a possible layout pass, with the explicit `useRef` (not `useState`) discipline that "writes happen AFTER layout completes and MUST NOT trigger a re-render" ([`GraphView.tsx:238-242`](../../../apps/audience/src/graph/GraphView.tsx#L238)). The overlay's seen-Set is mutated DURING the render path as part of the lazy-init + per-element `isNew` decision, with the synchronous-cache-mutation discipline the predecessor's Decision §4 documented. The two patterns produce the same "did we see this id before" answer but with different timing and different lifecycle hooks; coupling them through a shared ref or shared prop introduces order-of-operations coupling (the GraphView's effect runs AFTER the React commit, the overlay's render path runs DURING the commit — they'd race on first paint).

The architecturally clean answer is: each component owns its own seen-state for its own purpose. `<AudienceGraphView>` uses `knownNodeIdsRef` to decide whether to run a layout pass; `<AudienceNodeAppearOverlay>` uses `seenNodeIdsRef` to decide whether to attach the animation class. They happen to track the same identifier — but they answer different questions and decay independently (the GraphView's ref is cleared on `cy.destroy()` cleanup; the overlay's ref is cleared on overlay unmount). Lifting the state to a parent would require threading two consumers' update timings through a single ref, which is a fragile contract for what is presently a coincidence of identifier choice.

If a future refactor (the `aud_dom_overlay_extraction` named-future-task from §2 above) extracts a shared overlay primitive, the seen-Set can become a parameter of the primitive — but that's a code organization decision INSIDE the overlay layer, not a coupling to the GraphView's layout-gate ref.

### §4 — `useRef<Set<string>>` initial-mount guard with `placements.length > 0` lazy-init (NOT animate initial nodes)

Three options for handling nodes present at first mount (parallel to the predecessor's Decision §4):

A. **Animate everything that React mounts.** Simplest implementation — the animation class is always applied to every halo; CSS keyframes fire once on mount. Side effect: when the audience loads a session whose event log already carries N committed nodes, all N halos animate simultaneously, reading as "N nodes just landed" when in fact they were already there.

B. **Seed a `useRef<Set<string>>` on first render; only animate keys not in the set.** Lazy-initialize on the literal first render — i.e. when `seenNodeIdsRef.current === null`, populate it from `placements`. Then on subsequent renders, any key not in the set is "new."

C. **Seed a `useRef<Set<string>>` on the first non-empty render.** Lazy-initialize when `seenNodeIdsRef.current === null && placements.length > 0`. The literal first render has `placements: []` (the overlay's `useState` starts empty; the rAF-batched commit hasn't fired yet), so seeding on the literal first render would leave the set empty and the FIRST non-empty commit (the one carrying the initially-present nodes) would treat every node as "new" and animate them all.

**Chosen: C.** The predecessor's Decision §4 covered this exact pitfall — option B looks right textually but breaks the contract when combined with the rAF-batched commit pattern (the React first render has `placements: []` because the effect hasn't run yet, so the set seeds empty, then the FIRST non-empty commit treats every initial node as "new" and animates them all on page load). Option C's gate (`placements.length > 0` AND `seenNodeIdsRef.current === null`) handles both branches correctly: empty first render skips seeding; the first non-empty commit seeds from those placements; every commit after that treats only genuinely-new ids as "new."

Option A is rejected as misleading (the canonical "viewer joins mid-debate" case shows every previously-created node animating on page load — wrong story).

Option B is rejected as the subtle-but-wrong fix that the predecessor's implementation note already flagged. The lesson is documented in [`AxiomMarkOverlay.tsx:108-127`](../../../apps/audience/src/graph/AxiomMarkOverlay.tsx#L108) and adopted here verbatim.

A potential concern with option C is the React strict-mode double-render: the lazy-init lines run twice on the first effective render. The pattern is idempotent — `seenNodeIdsRef.current === null && placements.length > 0` is true on the first commit; the seed runs; on the second strict-mode pass `seenNodeIdsRef.current` is no longer null, the conditional short-circuits, no double-seed. Subsequent per-render `add()` calls during the render path are similarly idempotent (adding an already-present key is a no-op). No observable side effect outside the render.

### §5 — 450 ms ease-out duration with `cubic-bezier(0.16, 1, 0.3, 1)` and `forwards` fill-mode (initial constant; `aud_animation_pacing` revisits)

Three options for the timing curve and duration:

A. **450 ms `cubic-bezier(0.16, 1, 0.3, 1)` ("emphasized decelerate") with `forwards` fill.** Slightly slower than the axiom-mark badge's 350 ms because the halo's larger geometry (96px diameter vs. ~14px badge) and centered placement (on the node body, where the eye is already partially occupied by the node paint) benefit from a slower entrance. `forwards` fill keeps the halo at the `to` state (`opacity: 0`, `scale: 1.6`) after the animation completes, so the halo is invisible at rest and never re-paints once it has bloomed.

B. **350 ms `cubic-bezier(0.16, 1, 0.3, 1)` (parity with axiom-mark).** Same constant as the predecessor; trades visual differentiation for cross-sibling uniformity. The `aud_animation_pacing` task could later unify all animation durations under a single shared constant.

C. **600 ms with a spring-overshoot curve (`cubic-bezier(0.34, 1.56, 0.64, 1)`).** More emphatic; reads as "the node bounced into place." The overshoot adds character.

**Chosen: A.** The 450 ms with decelerated easing matches "ripples outward and fades" semantics for the halo: motion is fastest at the start (the halo expands quickly from the node center), settles into the final scale + opacity. The `forwards` fill-mode is load-bearing here in a way the badge's `both` fill wasn't: the badge's resting state is "visible" (the badge body remains painted), so `both` was fine; the halo's resting state is "invisible" (the halo IS the decoration, not the node body), so `forwards` is what keeps the halo at the faded `to` state after the animation completes. Without `forwards` the halo would snap back to its from-state (`opacity: 1, scale: 0.4`) at the end of the animation, which would leave a visible artifact.

Option B is rejected because the visual problem is genuinely different — the badge is a corner decoration with its own paint, the halo is a centered overlay BEHIND/AROUND the node with no paint of its own. A slower duration improves halo legibility against a denser background. The cross-sibling unification can happen in `aud_animation_pacing` if the broadcast feel calls for it — that's exactly what the pacing task is for.

Option C is rejected for the same reason the predecessor rejected its overshoot variant — the audience surface's overall visual vocabulary is calm and subtle (one of the explicit broadcast goals); bouncy entrance motion would be tonally inconsistent. The decelerated curve is the right tonal match.

The 450 ms constant is **initial** and may be tuned by `aud_animation_pacing` once the other animation siblings have shipped. The pacing task's `depends` list already includes `!aud_node_appear_animation`, so this constant becomes one of the durations the pacing task sees and may rebalance.

### §6 — Vitest pins React-side class logic + CSS file presence; Playwright deferred to `aud_session_url`

The Vitest cases pin the behavioral contract:
- Per-render decision logic (initial-mount halos do not animate; post-mount arrivals do; rerender with same nodes does not re-animate; placement geometry centers on `renderedBoundingBox` midpoint).
- CSS keyframe + reduced-motion override presence in the audience CSS file (string-grep smoke pin).

What the tests deliberately do NOT pin:
- Pixel-by-pixel frame capture of the animation (no current frame-capture infrastructure; speculative future `aud_animation_video_regression` is NOT pre-registered).
- Actual CSS rendering (jsdom does not run keyframes; the React tests assert on the class being present, the CSS-file test asserts on the keyframe being defined; together they pin the React→CSS seam end-to-end).
- Live arrival in a real audience session (Playwright deferred per the orchestrator brief's "component not yet reachable" exception — the audience is still placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx)).

**Playwright destination check.** The orchestrator brief explicitly calls out: "Watch the inherited-debt count on `mod_pw_*` (and similar) catch-all e2e tasks. Before deferring to a future Playwright task, check how many prior refinements already point at it. If it's inheriting from 2+ refinements already, pay debt down instead." The `aud_session_url` task is the audience-side equivalent of the moderator's `mod_pw_*` collector. As of this leaf, the chain pointing at `aud_session_url`'s Playwright scope includes: `aud_cytoscape_init.md`, `aud_state_management.md`, `aud_ws_client.md`, `aud_axiom_mark_decoration.md`, and `aud_axiom_mark_animation.md` — five refinements. Adding this leaf brings the count to six.

**Justification for deferring rather than splitting.** The orchestrator's threshold ("if it's inheriting from 2+ refinements already, pay debt down") suggests splitting the deferral target. However: (a) every refinement in the chain is exercising the same surface (the audience graph + overlays once reachable via the `/sessions/:id` route), (b) the Playwright spec for `aud_session_url` will necessarily mount the full audience under a real route and assert against the rendered DOM, and (c) the per-leaf scenarios are mostly assertion-additions onto a single test fixture (one mounted audience session, multiple `expect(...)` calls). Splitting the deferral target (e.g., a separate `aud_pw_animations` task) would re-mount the same audience fixture for a different subset of assertions and pay the same Playwright startup cost twice. The right answer is to acknowledge that `aud_session_url`'s Playwright scope is large by design — the closer of `aud_session_url` should either (i) absorb the full chain into one spec file with appropriately grouped `describe` blocks, or (ii) at refinement-time decide whether to split into multiple smaller `aud_pw_*` tasks each pinning one cluster of behavior. That structural decision belongs to the `aud_session_url` refinement, not to this leaf.

This leaf contributes two scenarios to the chain:
1. After mounting a session whose initial event log contains nodes, none of the rendered `[data-node-appear-anim]` halos carry the `aud-node-appear` class.
2. After a subsequent `node-created` event arrives via the WS stream, the halo for the newly-created node DOES carry the `aud-node-appear` class within the rAF settle window.

Pixel-stable post-animation steady state is already covered by `aud_visual_regression`'s node-body palette fixtures (inherited from `aud_proposed_styling.md` / `aud_agreed_styling.md` / `aud_disputed_styling.md`) — the halo is decoration that fades to `opacity: 0`, so the steady-state frame is identical with or without this leaf.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-29.

- `apps/audience/src/graph/NodeAppearOverlay.tsx` (NEW) — `<AudienceNodeAppearOverlay>` component: `pointer-events:none` / `aria-hidden` overlay; one `<span data-node-appear-anim>` per `cy.nodes()` entry positioned at `renderedBoundingBox()` midpoint; `seenNodeIdsRef<Set<string>>` lazy-seeded on first non-empty placement commit so post-mount arrivals get the `aud-node-appear` class and initial-mount nodes do not; rAF-batched subscription on `render pan zoom resize position add remove data`.
- `apps/audience/src/graph/NodeAppearOverlay.test.tsx` (NEW) — 7 Vitest cases: (a) test-seam + `aria-hidden`; (b) one halo per `cy.nodes()` entry; (c) initial-mount no `aud-node-appear` class; (d) post-mount arrival gains class; (e) prior siblings unanimated; (f) rerender with same node set no re-class; (g) wrapper position centers on `renderedBoundingBox()` midpoint.
- `apps/audience/src/graph/GraphView.tsx` (MODIFIED) — import + 4th overlay mount (`<AudienceNodeAppearOverlay>` as last sibling inside `audience-graph-root-wrapper`); header comment-block extended with refinement-trail entry for Decisions §1–§6.
- `apps/audience/src/index.css` (MODIFIED) — `[data-node-appear-anim]` static rule (96 px, radial-gradient, `opacity:0` rest state); `@keyframes aud-node-appear` (opacity+scale, 450 ms `cubic-bezier(0.16,1,0.3,1)` `forwards`); `.aud-node-appear` utility; `@media (prefers-reduced-motion: reduce)` override.
- `apps/audience/src/index.test.ts` (MODIFIED) — +2 CSS smoke pins: `@keyframes aud-node-appear` presence; `.aud-node-appear { animation: none` under `prefers-reduced-motion: reduce`.
- `tasks/50-audience-and-broadcast.tji` (MODIFIED) — `complete 100` on `aud_node_appear_animation`; `aud_dom_overlay_extraction` tech-debt task registered.
- Playwright deferred to `aud_url_routing.aud_session_url` (audience surface still placeholder-routed; sixth refinement in the accumulated chain).
- Tech-debt `aud_dom_overlay_extraction` registered in WBS (~1d): extract shared `<KeyedCytoscapeNodeOverlay>` primitive across all four DOM-overlay siblings (per-facet pill, axiom-mark, annotation, node-appear); deferred per Decision §2 to keep this leaf single-concern.
