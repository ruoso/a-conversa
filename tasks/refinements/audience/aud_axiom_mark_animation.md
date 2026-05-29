# Audience axiom-mark landing animation (a one-shot CSS keyframe applied to a wrapper around each newly-arrived `<AxiomMarkBadge>` inside `<AudienceAxiomMarkOverlay>`, gated by a `seen` Set so only post-mount arrivals animate, suppressed under `prefers-reduced-motion: reduce`)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_animations.aud_axiom_mark_animation` (lines 346-349).
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!audience.aud_graph_rendering` (settled — the entire group is `complete 100`). The audience surface already paints per-participant chromatic axiom-mark badges as a DOM-overlay sibling of the Cytoscape canvas via [`apps/audience/src/graph/AxiomMarkOverlay.tsx`](../../../apps/audience/src/graph/AxiomMarkOverlay.tsx), iterating each node's `data.axiomMarks: readonly AxiomMark[]` and rendering one `<AxiomMarkBadge mark={mark} />` per record (keyed by `mark.participantId`). This leaf adds **animated arrival** without changing the steady-state visual contract.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_axiom_mark_decoration` (settled — [`tasks/refinements/audience/aud_axiom_mark_decoration.md`](aud_axiom_mark_decoration.md)). The settled overlay shape — rAF-batched commit subscribed to `render pan zoom resize` + `position node` + `add remove data`, per-node row `key={p.id}`, per-badge `key={mark.participantId}`, badge supplied by `@a-conversa/shell`'s `<AxiomMarkBadge>` — is the substrate this leaf decorates. Decision §1 there established per-participant chromatic identity is methodology-load-bearing for broadcast viewers; the animation reinforces that identity by drawing the eye to each freshly-arrived badge in the moment of arrival.
- Prose-only context (NOT a `.tji` edge): `shell_package.shell_axiom_marks_extraction` (settled — [`tasks/refinements/shell-package/shell_axiom_marks_extraction.md`](../shell-package/shell_axiom_marks_extraction.md)). The `<AxiomMarkBadge>` is a shell-package primitive consumed cross-surface (moderator graph + audience overlay + participant panel via the consolidation refinement). This leaf does NOT modify the shell badge — the animation wrapper lives in the audience overlay only. Cross-surface animation parity (moderator-side axiom-mark animation) is explicitly out of scope (see "What this task is NOT" below) and would be its own future task if the moderator UI design ever wants it.
- Prose-only context (NOT a `.tji` edge): `aud_animations.aud_animation_pacing` (sibling, future — [`tasks/50-audience-and-broadcast.tji:350-354`](../../50-audience-and-broadcast.tji#L350)). Names two explicit deps (`!aud_node_appear_animation`, `!aud_proposed_to_agreed_animation`) today. This refinement's Decision §5 chooses an initial 350 ms ease-out duration; the pacing task expands its deps to include `!aud_axiom_mark_animation` (closer registers the dep add) and revisits the constant as part of the cross-animation cadence tuning.

## What this task is

The 0.5d leaf that lights up **arrival animation** on per-participant axiom-mark badges painted by `<AudienceAxiomMarkOverlay>`. When a new axiom-mark commit is applied to the audience event log mid-broadcast — a participant marks a node as bedrock — the corresponding badge "lands" with a brief scale-and-fade-in motion, drawing the broadcast viewer's eye to the moment of arrival.

The implementation is mechanically narrow: add a wrapping `<span>` around each badge inside the overlay's render path, give that wrapper a one-shot CSS animation class, and gate which wrappers receive the class on a `useRef<Set<string>>` of already-seen `${nodeId}:${participantId}` keys so that badges present at first mount do NOT animate (only badges that *arrive* during the session animate). The animation itself is a single `@keyframes axiom-mark-land` rule defined in `apps/audience/src/index.css`, suppressed under `@media (prefers-reduced-motion: reduce)`.

CSS keyframes are inherently one-shot per element lifetime — the animation fires when the wrapper is mounted by React, then never again. Because the audience overlay rebuilds its `placements` snapshot on every Cytoscape event (pan / zoom / position / add / remove / data) but reconciles by stable keys, existing badge wrappers are reused (no re-mount, no re-animation); only React-newly-mounted wrappers animate. The `seen` Set is the additional guard that handles the **initial-mount** edge case: when the audience surface first loads a session whose event log already carries committed axiom-marks, all the badges mount simultaneously and would otherwise all animate as if they had just landed. The Set seeds itself on first render from the initial placement set, then on subsequent renders any key not in the Set is "new" — animates and is added.

After this leaf:

- `apps/audience/src/graph/AxiomMarkOverlay.tsx` — MODIFIED. The render-loop's inner `<AxiomMarkBadge>` wraps in a `<span data-axiom-mark-anim>` carrier; a module-private hook reads a `useRef<Set<string> | null>` of seen mark keys to decide whether to apply the `aud-axiom-mark-land` animation class. Reduced-motion gating is in CSS, not in TS — the class is always emitted, but the CSS rule is no-op'd when `prefers-reduced-motion: reduce`.
- `apps/audience/src/graph/AxiomMarkOverlay.test.tsx` — MODIFIED. 5 new Vitest cases pin: (a) first-mount badges do NOT carry the animation class; (b) a freshly-added mark in a second render DOES carry the class; (c) the prior-rendered sibling badges in that row do NOT regain the class; (d) re-render with the same marks (pan/zoom simulation) does not re-add the class to any badge; (e) the animation wrapper carries `data-axiom-mark-anim` for testid stability.
- `apps/audience/src/index.css` — MODIFIED. One `@keyframes axiom-mark-land` rule plus a `.aud-axiom-mark-land` utility selector that references it (`animation: aud-axiom-mark-land 350ms cubic-bezier(0.16, 1, 0.3, 1) both;`); one `@media (prefers-reduced-motion: reduce) { .aud-axiom-mark-land { animation: none; } }` override.
- `apps/audience/src/index.test.ts` — **NEW** (tiny). 2 Vitest cases that read `apps/audience/src/index.css` from disk and assert it contains the `@keyframes axiom-mark-land` declaration AND the `prefers-reduced-motion: reduce` override clause. (This is the smoke-pin equivalent of "the keyframe exists and the OS-preference branch exists"; pixel-stable frame capture is `aud_visual_regression`'s job.)

Out of scope (deferred to existing or future leaves):

- **Moderator-side axiom-mark animation.** The `<AxiomMarkBadge>` in `@a-conversa/shell` is unchanged by this leaf. The moderator surface (`<StatementNode>` ReactFlow children) consumes the same shell primitive without an animation wrapper. If broadcast-style arrival animation is wanted on the moderator console (the use case is weaker — moderators have a click-through workflow, not a passive watch), that is a separate future task `mod_axiom_mark_animation` (~0.5d, NOT pre-registered; speculative — register only when product surfaces a moderator UX trigger). The audience-only wrapper keeps the shell badge's cross-surface contract pure.
- **Participant-side animation.** Participants see the axiom-mark surface through `<AxiomMarkBadge>` in the participant detail panel. Same reasoning — out of scope, no pre-registration.
- **Pixel-stable frame-by-frame capture.** Animation timing is not captured by `aud_visual_regression`'s steady-state snapshots; the regression task pins post-animation steady state (Decision §6 of [`aud_axiom_mark_decoration.md`](aud_axiom_mark_decoration.md) — already inherits axiom-mark badge palette pixel pin). Animation-timing capture would be its own future polish task `aud_animation_video_regression` (~1d, NOT pre-registered today; speculative and only meaningful once two or more animation leaves have shipped to compare against, hence belongs to whoever lands `aud_animations` last).
- **Pacing constant tuning across the animation set.** This leaf chooses 350 ms ease-out as the initial duration; `aud_animation_pacing` (sibling, [`tasks/50-audience-and-broadcast.tji:350-354`](../../50-audience-and-broadcast.tji#L350)) is the cross-cutting cadence-tuning task that will revisit the constant alongside the other animation leaves' durations to ensure the broadcast feel is coherent. The pacing task's `.tji` `depends` list today names `!aud_node_appear_animation` + `!aud_proposed_to_agreed_animation`; **the closer extends it to also depend on `!aud_axiom_mark_animation`** (see Acceptance criteria) so the pacing task picks up this leaf's constant when it runs.
- **Withdrawal / un-mount animation.** Axiom-marks are immutable methodology declarations in the wire schema (`{ kind: 'axiom-mark', node_id, participant }` per [`packages/shared-types/src/events/proposals.ts:275-281`](../../../packages/shared-types/src/events/proposals.ts#L275); no withdraw counterpart). Badges don't disappear under normal play; if a node carrying axiom-marks is itself deleted (an edge case methodology doesn't normally cover), the badge row vanishes without animation. NOT a future task — the wire schema makes withdrawal a non-case.
- **Node-level "ripple" or "pulse" highlight on the receiving node.** The animation language for diagnostic events lives on `aud_diagnostic_fire_animation` (sibling, [`tasks/50-audience-and-broadcast.tji:342-345`](../../50-audience-and-broadcast.tji#L342)). Axiom-marks are not diagnostics — they are participant declarations. Keeping the animation localized to the badge keeps the visual vocabulary "the participant placed a mark here" rather than "the system reacted at this node".
- **A Playwright spec exercising the live arrival animation.** Per the deferred-e2e exception in the orchestrator brief (component not yet reachable): the audience surface is still placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx); the per-session route lands in `aud_url_routing.aud_session_url`. Full deferral applies — the Vitest pins above cover the behavioral seam (wrapper class is/isn't applied per-render). When `aud_session_url` ships, the closer of THAT task adds an inherited-debt entry pointing back to this leaf among the deferred-e2e scenarios (the audience already inherits a multi-leaf debt chain, per `aud_axiom_mark_decoration.md` Decision §6); the Playwright spec at that point asserts a freshly-arrived axiom-mark badge carries the animation wrapper, and that an initially-present axiom-mark badge does not. Decision §6 below documents why this is the right destination.
- **`framer-motion`, `react-spring`, or any motion-framework dependency.** Rejected (Decision §2 below); a 5-line CSS keyframe carries this leaf's full behavior contract.

## Why it needs to be done

The methodology treats axiom-marks as the **primary success state** of the debate — bedrock has been located ([`docs/methodology.md:204`](../../../docs/methodology.md#L204): *"Surfacing axioms is a primary success state."*; [`DESIGN.md:26`](../../../DESIGN.md#L26): same). For a passive broadcast viewer watching the audience surface during a live debate, a silent badge appearing in the corner of a node is easy to miss — the canvas is dense, the eye is elsewhere, and a static decoration carries no "this just happened" signal. The arrival animation is the broadcast surface's equivalent of "the lower-third graphic just slid in": viewers learn within ~350 ms that a methodology-load-bearing event happened HERE on the graph.

The `aud_animations` task group exists precisely to add this layer of temporal vocabulary on top of the steady-state visualization. The siblings (`aud_node_appear_animation`, `aud_proposed_to_agreed_animation`, `aud_decomposition_animation`, `aud_withdrawal_animation`, `aud_diagnostic_fire_animation`) each pick up one structural-event class and render its "moment of arrival" so the broadcast viewer can follow the conversation's evolution in real time. Without the axiom-mark animation, the most methodologically-loaded event class — the one the design doc calls out as the primary success state — would be the only animation-less arrival in the set.

Downstream concretely:

- **`aud_animation_pacing`** ([`tasks/50-audience-and-broadcast.tji:350-354`](../../50-audience-and-broadcast.tji#L350)) is the cross-cutting cadence-tuning task. It compares animation durations across the set and may rebalance them so simultaneous arrivals don't visually collide. This leaf's chosen 350 ms is the input it tunes against; the closer extends `aud_animation_pacing`'s `depends` list to include `!aud_axiom_mark_animation` so the pacing task sees all six animation siblings before retuning.
- **`aud_session_url`** ([`tasks/50-audience-and-broadcast.tji:431+`](../../50-audience-and-broadcast.tji#L431)) wires the audience into a `/sessions/:id` route. Once that lands the inherited Playwright debt clears — the closer of `aud_session_url` (or a dedicated `aud_pw_*` task if the debt fans out further) adds an end-to-end spec covering the live axiom-mark arrival animation in a real session.
- **`aud_visual_regression`** ([`tasks/50-audience-and-broadcast.tji:318-347`](../../50-audience-and-broadcast.tji#L318)) pins the post-animation steady state (badge painted, animation completed). This leaf's animation does not change the steady-state visual contract — the regression task's existing axiom-mark badge palette + position fixtures continue to apply as-is once the animation is complete.

Architecturally, this leaf parallels what every other `aud_animations.*` sibling will do: a small CSS keyframe layered on top of the steady-state DOM-overlay surface. The pattern this leaf establishes (CSS-first, `prefers-reduced-motion: reduce` suppression, `useRef<Set>` initial-mount guard) is reusable verbatim by the sibling animation tasks — `aud_node_appear_animation` for instance has the analogous initial-mount problem (don't animate every node on first load).

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience uses Cytoscape with React DOM overlays. Per-element React decoration (here, the wrapper around `<AxiomMarkBadge>`) is the canonical pattern; the animation belongs on the React side, NOT inside Cytoscape's animation API (`cy.animate(...)` operates on Cytoscape elements, not on overlay DOM).
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the existing audience CSS lives at `apps/audience/src/index.css` with the Tailwind v4 `@import` and `@source` directives. Custom keyframes coexist with Tailwind utilities at the same CSS layer; the animation wrapper class is a plain utility selector (not a Tailwind-arbitrary-value class) so it survives the Tailwind v4 + Vite library-mode build pipeline (the same pipeline that silently dropped the Google Fonts `@import` per `aud_typography_bundle_measurement.md` Decision §3(B) — keyframe `@` rules are not `@import` and ARE preserved).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest pins the React-side behavior (wrapper class is/isn't applied per render). A second Vitest pin reads the CSS file from disk to confirm the keyframe + reduced-motion clause exist. Pixel-level frame-by-frame animation capture is out of scope (no current task has frame-capture infrastructure).
- [ADR 0024 — Frontend i18n: react-i18next + ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — no new i18n keys. The badge's `title` + `aria-label` are unchanged; the animation has no visible text and no accessibility-label requirement (screen readers narrate the badge's existing `aria-label`, animation or not).
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the audience artifact owns its CSS; the new keyframe ships inside the audience bundle and does not leak to the moderator or participant artifacts.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — axiom-marks are per-participant disposition decorations on the node entity; the animation lives on the same disposition layer (the badge wrapper inside the axiom-mark overlay), not on the entity-rollup paint or the per-facet pill row.

No new ADR. The architectural seams (CSS-first, React-keyed reconciliation, `prefers-reduced-motion` honoring, no motion-framework dependency) are either settled by existing ADRs or adopt the codebase's existing zero-motion-framework posture (per the Explore survey: no `framer-motion` / `react-spring` / `@keyframes` anywhere in the audience surface today).

### Sibling refinements

- [`tasks/refinements/audience/aud_axiom_mark_decoration.md`](aud_axiom_mark_decoration.md) — the predecessor leaf that established the overlay's render shape (per-node row keyed by `nodeId`, per-badge child keyed by `participantId`, rAF-batched commit). The animation wrapper slots in between the row's `<div data-axiom-mark-row>` and the inner `<AxiomMarkBadge>` without altering either contract.
- [`tasks/refinements/audience/aud_per_facet_visualization.md`](aud_per_facet_visualization.md) — the canonical DOM-overlay precedent. The per-facet pill overlay has the same initial-mount-vs-post-mount distinction (a session loading with N pre-existing per-facet votes shouldn't animate them all) but does not animate any pill today; `aud_animations` group does not currently scope per-facet pill animation. The pattern this leaf establishes (seen-Set guard + CSS keyframe + reduced-motion suppression) is the reusable template for if/when per-facet pill animation lands.
- [`tasks/refinements/audience/aud_clean_typography.md`](aud_clean_typography.md) — the precedent for "the audience-only CSS file is the right home for cross-Tailwind custom rules" (the typography keys at `--font-broadcast` live there). The keyframe lands beside them in the same file.
- [`tasks/refinements/shell-package/shell_axiom_marks_extraction.md`](../shell-package/shell_axiom_marks_extraction.md) — the shell-extraction refinement that established `<AxiomMarkBadge>` as the cross-surface primitive. This leaf intentionally does NOT modify the shell badge — the animation wrapper lives one layer up, in the audience overlay only, preserving the shell badge's cross-surface neutrality.

### Live code the leaf modifies / creates

- [`apps/audience/src/graph/AxiomMarkOverlay.tsx`](../../../apps/audience/src/graph/AxiomMarkOverlay.tsx) (lines 132-154 — render-loop) — gains a wrapper `<span data-axiom-mark-anim>` around each `<AxiomMarkBadge>`; gains a `seenMarkKeysRef = useRef<Set<string> | null>(null)` slot; the wrapper's `className` is `aud-axiom-mark-land` when the mark-key is "new" (not yet in the seen-Set) and empty otherwise; the seen-Set is seeded on first render from the initial placement set (so badges present at mount do NOT animate). Header comment-block (lines 1-35) extends with a refinement-trail entry summarizing Decisions §1-§6.
- [`apps/audience/src/graph/AxiomMarkOverlay.test.tsx`](../../../apps/audience/src/graph/AxiomMarkOverlay.test.tsx) — gains 5 new Vitest cases (listed below under Acceptance criteria); existing 10 cases continue to pass unchanged (the wrapper `<span>` is additive and its presence is the new contract — existing badge selectors via `[data-testid^="axiom-mark-badge-"]` still match because the `<AxiomMarkBadge>` testid is unchanged and the `<span>` sits between row and badge).
- [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) — gains a `@keyframes aud-axiom-mark-land` block, a `.aud-axiom-mark-land` utility class that consumes it, and a `@media (prefers-reduced-motion: reduce)` clause that overrides the animation to `none`. The keyframe sits alongside the existing `@theme` block; the file remains under a few dozen lines.
- `apps/audience/src/index.test.ts` — **NEW**. 2 Vitest cases that read `apps/audience/src/index.css` from disk via `node:fs/promises` and assert the file contents include both `@keyframes aud-axiom-mark-land` and `prefers-reduced-motion: reduce`. (Smoke pin — the build pipeline could in principle drop unreferenced CSS, but the wrapper class is referenced in the overlay so the selector survives; this test catches accidental removal of the keyframe definition itself.)
- [`packages/shell/src/axiom-marks/AxiomMarkBadge.tsx`](../../../packages/shell/src/axiom-marks/AxiomMarkBadge.tsx) — UNCHANGED. Cross-surface neutrality (Decision §3).
- `apps/audience/package.json` — UNCHANGED. No new dependency.
- `apps/audience/src/graph/projectGraph.ts` — UNCHANGED. The animation is a render-layer concern; no projection change.
- `apps/audience/src/graph/GraphView.tsx` — UNCHANGED. The overlay's external prop shape is unchanged; only its internal render path adds the wrapper.

### What the surface MUST NOT do

- **No new dependency.** `framer-motion`, `react-spring`, `@react-spring/web`, `motion`, `react-transition-group` are all rejected (Decision §2).
- **No edit to `@a-conversa/shell`.** The shell `<AxiomMarkBadge>` is cross-surface; the audience animates by wrapping, not by modifying the shell primitive (Decision §3).
- **No `cy.animate(...)` call.** Cytoscape's animation API operates on Cytoscape elements (nodes/edges) and their style properties (border-color, position, etc.), not on overlay DOM. The axiom-mark badges are React-rendered overlay siblings; `cy.animate(...)` cannot reach them. The animation lives entirely in the React + CSS layer.
- **No JavaScript-driven animation loop.** No `requestAnimationFrame`-pump that tweens opacity/scale per frame; no `setTimeout` chain. The CSS keyframe runs on the GPU compositor; JS only decides which wrappers get the class.
- **No animation on initial mount.** Badges already present in the event log at first render are seeded into the seen-Set and rendered without the animation class (Decision §4).
- **No animation re-fire on pan/zoom/resize.** Because the wrapper is keyed by `${nodeId}:${participantId}` and React reconciles by key, the existing wrapper DOM is reused across re-renders — CSS keyframes do not re-fire on rerender, only on mount.
- **No animation on badge re-order.** If a node accumulates marks in commit-arrival order and a future render reorders them (it shouldn't — the projection preserves commit order), React's keyed reconciliation reuses the existing wrappers; no spurious animation.
- **No new `data-testid` on the wrapper for behavioral assertions.** The wrapper carries `data-axiom-mark-anim` as a presence-marker only (not a testid). Existing test selectors via `[data-testid^="axiom-mark-badge-"]` keep working; the new wrapper is transparent to existing assertions. The 5 new Vitest cases assert on the presence/absence of the `aud-axiom-mark-land` class on the wrapper, located via `closest('[data-axiom-mark-anim]')` from the badge.
- **No edit to `apps/audience/src/graph/PerFacetPillOverlay.tsx`.** Per-facet pill animation is out of scope; the `aud_animations` group does not currently scope it.
- **No edit to the moderator or participant surfaces.** Cross-surface animation parity is explicitly out of scope (see What this task is NOT).
- **No new i18n keys.** The animation has no visible label and adds no a11y prose. Screen readers narrate the existing `aria-label`.
- **No edit to `tasks/50-audience-and-broadcast.tji` beyond the closer's `complete 100` + the cadence-revisit `depends` add to `aud_animation_pacing`.** The closer's ritual handles both edits in the same commit per the [README ritual](../README.md).

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/AxiomMarkOverlay.tsx` — MODIFIED. The render-loop change:

  ```tsx
  // (existing) const [placements, setPlacements] = useState<readonly BadgeRowPlacement[]>([]);
  const seenMarkKeysRef = useRef<Set<string> | null>(null);

  if (seenMarkKeysRef.current === null) {
    // First render — seed the set so initially-present badges do NOT animate.
    const seeded = new Set<string>();
    placements.forEach((p) => {
      p.marks.forEach((m) => seeded.add(`${p.id}:${m.participantId}`));
    });
    seenMarkKeysRef.current = seeded;
  }

  // ...
  {p.marks.map((mark) => {
    const markKey = `${p.id}:${mark.participantId}`;
    const isNew = !seenMarkKeysRef.current!.has(markKey);
    if (isNew) seenMarkKeysRef.current!.add(markKey);
    return (
      <span
        key={mark.participantId}
        data-axiom-mark-anim=""
        className={isNew ? 'aud-axiom-mark-land' : ''}
      >
        <AxiomMarkBadge mark={mark} />
      </span>
    );
  })}
  ```

  (The `useRef<Set<string> | null>(null)` + null-check pattern is the standard "lazy-initialize a ref synchronously during render" idiom — the ref mutation is idempotent and produces no observable side effect outside the render.) Header comment-block extends with a refinement-trail entry citing Decisions §1-§6.

- `apps/audience/src/graph/AxiomMarkOverlay.test.tsx` — MODIFIED. 5 new Vitest cases added; existing 10 cases pass unchanged. The new cases:
  1. **Initial-mount: no animation class.** Render the overlay with a `cy` instance carrying one node whose `data.axiomMarks` has one entry. The rendered badge's wrapper (located via `closest('[data-axiom-mark-anim]')`) does NOT carry the `aud-axiom-mark-land` class.
  2. **Post-mount arrival: animation class on the new wrapper.** Render with one node + one mark, then rerender after the node's `data.axiomMarks` is mutated to add a second mark from a different participant. The freshly-mounted wrapper (the one whose `data-participant-id` matches the new mark) DOES carry the `aud-axiom-mark-land` class.
  3. **Post-mount arrival: existing siblings remain unanimated.** Same scenario as (2) — the wrapper for the first mark (rendered at initial mount) does NOT carry the class after the rerender.
  4. **Rerender with identical marks: no class spread.** Render once, then trigger a `cy.emit('pan')` (which causes the rAF-batched commit to re-snapshot the same placements). After the second render, no wrapper carries the `aud-axiom-mark-land` class.
  5. **Wrapper presence-marker.** Every rendered badge sits inside a `[data-axiom-mark-anim]` ancestor — the wrapper is unconditional, only the class is conditional. (Confirms the test selector seam `closest('[data-axiom-mark-anim]')` works for every mark.)

- `apps/audience/src/index.css` — MODIFIED. Append:

  ```css
  @keyframes aud-axiom-mark-land {
    from { opacity: 0; transform: translateY(-8px) scale(0.6); }
    to   { opacity: 1; transform: translateY(0)    scale(1);   }
  }

  .aud-axiom-mark-land {
    animation: aud-axiom-mark-land 350ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  @media (prefers-reduced-motion: reduce) {
    .aud-axiom-mark-land { animation: none; }
  }
  ```

  The `both` fill-mode means the badge stays at the `to` state after the animation completes (no flash back to the `from` state). The `cubic-bezier(0.16, 1, 0.3, 1)` curve is Material Design's "decelerated easing" (`emphasizedDecelerate`-ish — fast start, gentle settle), well-matched to "lands and sticks" semantics.

- `apps/audience/src/index.test.ts` — **NEW**. 2 Vitest cases:
  1. `apps/audience/src/index.css` contains the substring `@keyframes aud-axiom-mark-land`.
  2. `apps/audience/src/index.css` contains the substring `prefers-reduced-motion: reduce` AND, within that media-block, a `.aud-axiom-mark-land { animation: none` (or `animation:none` — whitespace-tolerant) override.

### Files this task does NOT touch

- `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — UNCHANGED.
- `packages/shell/**`, `packages/shared-types/**`, `packages/i18n-catalogs/**` — UNCHANGED.
- `apps/audience/src/graph/projectGraph.ts`, `apps/audience/src/graph/stylesheet.ts`, `apps/audience/src/graph/facetStatus.ts`, `apps/audience/src/graph/layoutOptions.ts`, `apps/audience/src/graph/cytoscapeTestEnv.ts`, `apps/audience/src/graph/PerFacetPillOverlay.tsx`, `apps/audience/src/graph/AxiomMarkBadge.tsx` (audience-local shim, if still present — actual badge lives in shell), `apps/audience/src/graph/GraphView.tsx`, `apps/audience/src/graph/axiomMarks.ts` — UNCHANGED.
- `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx` — UNCHANGED.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED (no new dep).
- `docs/adr/**` — UNCHANGED. No new ADR.
- `playwright.config.ts` / `tests/e2e/**` — UNCHANGED. Playwright deferral per Decision §6.
- `.tji` files — `complete 100` and the `aud_animation_pacing` `depends` add land at task-completion time per the [README ritual](../README.md); the closer owns that edit.

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/AxiomMarkOverlay.tsx` carries the `seenMarkKeysRef` slot, the lazy-init null-check, the per-mark `isNew` decision, the `<span data-axiom-mark-anim>` wrapper, and the conditional `aud-axiom-mark-land` class per Constraints.
- `apps/audience/src/graph/AxiomMarkOverlay.test.tsx` carries the 5 new Vitest cases listed above; all existing cases pass unchanged.
- `apps/audience/src/index.css` carries the `@keyframes aud-axiom-mark-land` rule, the `.aud-axiom-mark-land` utility, and the `prefers-reduced-motion: reduce` override per Constraints.
- `apps/audience/src/index.test.ts` exists with the 2 listed cases (string-grep against the CSS file).
- `packages/shell/src/axiom-marks/AxiomMarkBadge.tsx` is byte-unchanged (cross-surface neutrality).
- `apps/audience/package.json` is byte-unchanged (no new dependency).
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer pins (a) the React-side per-render class logic with full 5-case coverage and (b) the CSS file's keyframe + reduced-motion definitions. Animation-timing pixel capture is left to a future polish task (NOT pre-registered today — speculative).
- Per the orchestrator brief's deferred-e2e exception ("component not yet reachable"): Playwright coverage for the animation is **deferred**. The audience surface remains placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx). The closer of `aud_url_routing.aud_session_url` (the task that makes the audience reachable) adds a Playwright spec covering: (i) a freshly-arrived axiom-mark badge's wrapper carries the `aud-axiom-mark-land` class; (ii) a badge already present at page load does NOT carry the class. This refinement registers the deferred-e2e debt as a prose entry under `aud_session_url`'s Status block (the closer of `aud_session_url` reads it and includes it in the inherited scenarios — same chain used by the predecessor `aud_axiom_mark_decoration.md` for its overlay pixel pin).
- The closer extends `aud_animation_pacing`'s `depends` line in [`tasks/50-audience-and-broadcast.tji:350-354`](../../50-audience-and-broadcast.tji#L350) to include `, !aud_axiom_mark_animation` so the pacing task sees this leaf's 350 ms constant alongside the other animation siblings' durations. This is a closer-time edit, NOT done by the implementer.
- `pnpm run check` clean (strict TS pass; no new dep declared).
- `pnpm run test:smoke` green (Vitest count rises by 5 + 2 = 7 new cases).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is negligible (a few lines of CSS, ~80 bytes of TS; no new dependency).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_axiom_mark_animation` in the same commit (the closer's ritual).

## Decisions

### §1 — CSS keyframe one-shot on React-keyed wrapper (NOT JS-driven tween, NOT motion framework, NOT Cytoscape `cy.animate`)

Three options for "play an animation when a badge arrives":

A. **CSS `@keyframes` on a React-keyed wrapper.** Wrap each badge in a `<span>` keyed by `${nodeId}:${participantId}`; give the wrapper a class that triggers a `@keyframes` rule. CSS keyframes are inherently one-shot per element lifetime — the animation fires once on mount and never again. React's keyed reconciliation handles "which wrappers are new" automatically. Reduced-motion handled in CSS via `@media (prefers-reduced-motion: reduce)`. Zero new dependency.

B. **JS-driven tween via `requestAnimationFrame`.** Maintain per-badge animation state (start time, current frame); on each rAF tick, compute the easing fraction and write style.opacity / style.transform. Detection of "which badges are new" requires explicit JS bookkeeping (a Set or Map of seen keys). Reduced-motion handled by reading `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and either suppressing the animation or jumping to the end state.

C. **`framer-motion` (or equivalent) layout animation.** Wrap each badge in a `<motion.span layout initial={...} animate={...} />`. The library handles the lifecycle; reduced-motion handled via the library's `useReducedMotion()` hook.

**Chosen: A.** The CSS-on-React-keyed-wrapper option is the simplest correct answer for "play once on mount, skip on rerender" — React's reconciliation IS the lifecycle bookkeeping; CSS's per-element keyframe lifetime IS the play-once guarantee; `prefers-reduced-motion` IS the OS-level a11y honoring. No JS animation loop, no new dependency, no library-specific abstraction to learn.

Option B is rejected as needless complexity — JS-driven tweens reinvent what the CSS compositor does for free, run on the main thread (compositor animations run off-thread), and require manual reduced-motion plumbing. Option C is rejected because the audience surface today has zero motion-framework dependencies (Explore survey confirmed: no `framer-motion`, no `react-spring`, no `@keyframes` anywhere); introducing one for a 0.5d leaf is disproportionate, and the precedent it sets (every animation leaf will use the framework) commits the codebase to a non-trivial dependency before any of the other animation leaves have been refined to see if they actually need it. The simpler shape is more reversible — if a later leaf genuinely needs orchestration that CSS can't express (a sequence of staged animations across multiple elements with shared timing, say), THAT leaf adopts a framework and refactors at the same time; this leaf doesn't pre-commit.

The Cytoscape `cy.animate(...)` API was also considered briefly and rejected: it operates on Cytoscape elements (nodes/edges) and their style properties, not on overlay DOM. The axiom-mark badges are React-rendered DOM-overlay siblings of the Cytoscape canvas, fundamentally unreachable by `cy.animate`. The animation belongs on the React/CSS side, where the badge actually lives.

### §2 — No motion-framework dependency (no `framer-motion`, no `react-spring`)

Subsumed under Decision §1's option-C rejection but called out separately because it's a load-bearing posture for the rest of the `aud_animations.*` group. The codebase has chosen, by current absence, "CSS is enough" for animation. This leaf reinforces that choice. The next animation leaf (`aud_node_appear_animation` for example) inherits the same default; if any later leaf escalates to a framework, the decision should land in an ADR (not in a single leaf's refinement) because of the cross-cutting commitment.

### §3 — Audience-only wrapper (NOT modify shell `<AxiomMarkBadge>`)

Two options:

A. **Wrap the shell badge in the audience overlay.** Add a `<span>` between the row and the badge in `AxiomMarkOverlay.tsx`; the wrapper carries the animation class; the shell badge is unchanged.

B. **Add an `animateOnMount?: boolean` prop (or similar) to the shell `<AxiomMarkBadge>`.** The audience passes it true; the moderator passes it false (or omits, defaulting to false).

**Chosen: A.** The shell badge is a cross-surface primitive (moderator + audience + participant detail panel via the consolidation refinement). Animation is a surface-specific concern (the broadcast audience benefits from arrival animation; the moderator's click-through workflow does not; the participant's detail panel arguably doesn't either). Adding a per-surface animation prop to the shell badge pushes a presentation concern into a shared primitive, growing the badge's API surface for one surface's benefit. Wrapping in the consuming overlay keeps the shell badge's contract pure and confines the animation logic to the audience workspace.

If cross-surface animation parity is ever wanted, the right answer is to refactor the wrapper into a shell-side `<AnimatedOnMount>` primitive at that time, not to grow the badge's prop set today. (Speculative; not pre-registered.)

### §4 — `useRef<Set<string>>` initial-mount guard (NOT animate initial badges)

Three options for handling badges present at first mount:

A. **Animate everything that React mounts.** Simplest implementation — the animation class is always applied to every wrapper; CSS keyframes fire once on mount as a natural property. Side effect: when the audience loads a session whose event log already carries N committed axiom-marks, all N badges animate simultaneously, reading as "N axiom-marks just landed" when in fact they were already there.

B. **Seed a `useRef<Set<string>>` on first render; only animate keys not in the set.** The render path checks the set; first-render keys are all "seen" (seeded) and don't animate; second-render and later keys not in the set are "new" and animate (and are added). Initial mount produces zero animations; post-mount arrivals animate.

C. **Use a `useEffect` flag to gate animation to post-first-render.** A `hasMountedRef = useRef(false)` flips to true in a layout-effect after the first render. The render path only applies the animation class when the ref is true. But the second render needs to know which badges are "new since first render" — same problem as B, so this option collapses to B with an extra `hasMountedRef` slot that doesn't actually help.

**Chosen: B.** The `seen-Set` pattern produces the methodologically-correct behavior (only post-load arrivals animate; viewers learn "this just happened" specifically when something just happened, not on every page reload). The implementation is small — ~10 lines in the render path, idempotent in re-runs, and synchronous with the render that produces the placements. Lazy-initializing the ref to `null` and checking on each render is the standard React idiom for "lazy-init a ref synchronously during render"; the mutation is a pure cache operation visible only to the next render.

Option A is rejected as misleading for broadcast viewers (the canonical "viewer joins mid-debate" use case would show every previously-committed axiom-mark as if it had just arrived). Option C is rejected as a non-fix — it solves a non-problem (the first render's "animate or not" decision) without solving the actual problem (distinguishing pre-existing from newly-arrived badges across renders).

A potential concern with option B: ref mutation during render is sometimes warned against (React's docs say "don't write to refs during render"). The lazy-init pattern is the documented exception — `if (ref.current === null) ref.current = expensiveValue()` is a standard React pattern for synchronous lazy initialization, and the per-mark `seenSet.add(markKey)` mutation is a follow-on of the same lazy-init pattern (the set grows in-place as a synchronous cache; no observable side effect outside the render). React's strict-mode double-render would re-add already-present keys to the set (idempotent) and would NOT re-add the animation class to wrappers whose keys were added in the first pass (the second pass would find them already in the set and skip).

### §5 — 350 ms ease-out duration with `cubic-bezier(0.16, 1, 0.3, 1)` (initial constant; `aud_animation_pacing` revisits)

Two options for the timing curve and duration:

A. **350 ms `cubic-bezier(0.16, 1, 0.3, 1)` ("emphasized decelerate").** Fast initial motion (badge appears quickly) settling gently into the resting state. Reads as "lands and sticks".

B. **250 ms `ease-out`.** Faster, snappier; common UI animation duration. Reads as "pops in".

C. **500 ms with a spring curve (`cubic-bezier(0.34, 1.56, 0.64, 1)` — overshoot).** Slower, more emphatic; the overshoot adds a "bounce" character.

**Chosen: A.** 350 ms is the conventional sweet spot for a single-element entrance — long enough for the eye to lock on (well above the ~150 ms perceptual just-noticeable threshold for motion) and short enough to not feel sluggish on a dense canvas where multiple animations might coexist. The decelerated curve matches "lands" semantics: motion is fastest at the start (the badge appears from "off"), settles into the resting state (it's now part of the canvas). The simultaneous opacity + translateY + scale composition is a standard "drop and settle" entrance.

Option B is rejected as too snappy for a methodology-load-bearing arrival; the broadcast viewer's eye needs slightly more lock-on time. Option C is rejected as too theatrical for the visual vocabulary the rest of the audience surface establishes (subtle state styling, calm typography, no other bounce/overshoot motion).

The 350 ms constant is **initial** and may be tuned by `aud_animation_pacing` once the other animation siblings have shipped and the cadence across the set can be evaluated together. That task's `depends` list expands to include this leaf so it picks up the constant.

### §6 — Vitest pins the React-side class logic + CSS file presence; pixel + Playwright deferred

The Vitest cases pin the behavioral contract:
- Per-render decision logic (initial-mount badges skipped; post-mount arrivals animated; rerender with same marks does not re-animate).
- CSS keyframe + reduced-motion override presence in the audience CSS file (string-grep smoke pin).

What the tests deliberately do NOT pin:
- Pixel-by-pixel frame capture of the animation (no current task has frame-capture infrastructure; future task `aud_animation_video_regression` could land it but is speculative — NOT pre-registered).
- Actual CSS rendering (jsdom does not run keyframes; the React tests assert on the class being present, the CSS-file test asserts on the keyframe being defined; these two together pin the behavior end-to-end at the seam React→CSS).
- Live arrival in a real audience session (Playwright deferred per the orchestrator brief's "component not yet reachable" exception — the audience is still placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx)).

Playwright destination: `aud_url_routing.aud_session_url` (the task that makes the audience reachable). The closer of `aud_session_url` reads the deferred-e2e prose under this leaf's Status block and includes the two scenarios (freshly-arrived badge animates; initially-present badge does not) alongside the inherited scenarios from `aud_cytoscape_init.md` / `aud_state_management.md` / `aud_ws_client.md` / `aud_axiom_mark_decoration.md`. The `aud_session_url` refinement (to be authored) is the central deferred-e2e debt collector for the audience surface; this leaf's two scenarios join the chain.

Pixel-stable post-animation steady state is already covered by `aud_visual_regression`'s axiom-mark badge palette fixtures (inherited from `aud_axiom_mark_decoration.md` Decision §6) — the animation completes within 350 ms and the steady-state frame is what `aud_visual_regression` snapshots, so no separate animation-aware regression task is needed for the static appearance. The animation timing itself is a candidate for future video-frame regression infrastructure but is not in scope today.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-29.

- `apps/audience/src/graph/AxiomMarkOverlay.tsx` — added `seenMarkKeysRef` (`useRef<Set<string> | null>(null)`), lazy-init gated on `placements.length > 0` (preserves Decision §4 contract: initial badges do not animate), per-mark `isNew` decision, `<span data-axiom-mark-anim>` wrapper with conditional `aud-axiom-mark-land` class; refinement-trail header extended.
- `apps/audience/src/graph/AxiomMarkOverlay.test.tsx` — 5 new Vitest cases appended: (k) initial-mount no class; (l) post-mount arrival gets class; (m) prior sibling stays unanimated; (n) pan/zoom rerender does not re-add class; (o) every badge wrapped in `[data-axiom-mark-anim]`.
- `apps/audience/src/index.css` — added `@keyframes aud-axiom-mark-land` (opacity 0→1, translateY −8px→0, scale 0.6→1), `.aud-axiom-mark-land` utility (350 ms cubic-bezier(0.16,1,0.3,1) both), and `@media (prefers-reduced-motion: reduce)` no-op override.
- `apps/audience/src/index.test.ts` (new) — 2 Vitest cases pinning `@keyframes aud-axiom-mark-land` presence and `prefers-reduced-motion: reduce` override via `node:fs/promises` read-and-grep.
- Implementation note: `seenMarkKeysRef` lazy-init gated on `placements.length > 0` rather than unconditionally on first render; prevents empty-placement first render from seeding the set before rAF-batched commit fires, which would cause all initial-mount badges to animate (breaks test k).
- Deferred Playwright spec → `aud_url_routing.aud_session_url` per Decision §6: (i) freshly-arrived badge wrapper carries `aud-axiom-mark-land`; (ii) initially-present badge does not. The `aud_session_url` closer adds these two scenarios to the inherited deferred-e2e chain alongside `aud_axiom_mark_decoration` and siblings.
- Infra debt surfaced by fixer sub-agent: Node v24 fatal V8 JIT crash (`ThreadIsolation::UnregisterWasmAllocation`) during pglite WASM teardown in cucumber — registered as `foundation.ci.cucumber_v8_wasm_jit_crash` in `tasks/00-foundation.tji`; driver verified cucumber PASS (intermittent) — tracked for `NODE_OPTIONS=--jitless` workaround or Node version pin.
