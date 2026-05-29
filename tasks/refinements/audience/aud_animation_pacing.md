# Audience animation pacing (cross-cutting cadence tuning that lifts the per-animation duration constants in `apps/audience/src/index.css` to a single tier of CSS custom properties — `--aud-anim-easing`, `--aud-anim-commit-ms`, `--aud-anim-halo-ms` — documents the methodological cadence model that justifies each tier against the 30 fps OBS frame-budget, and rewires the five shipped `.aud-*` utility classes to consume them; no behavioural / palette / geometry change to the overlays themselves)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_animations.aud_animation_pacing` (lines 384-388).
**Effort estimate**: 1d
**Inherited dependencies**:

- `!audience.aud_animations.aud_node_appear_animation` (settled — [`tasks/refinements/audience/aud_node_appear_animation.md`](aud_node_appear_animation.md)). Shipped duration: **450 ms** `cubic-bezier(0.16, 1, 0.3, 1) forwards`. Halo geometry (96 px) + dense-canvas placement was the predecessor's justification for the slower-than-commit-moment entrance. The `.aud-node-appear` utility lives at [`apps/audience/src/index.css:158-160`](../../../apps/audience/src/index.css#L158).
- `!audience.aud_animations.aud_proposed_to_agreed_animation` (settled — [`tasks/refinements/audience/aud_proposed_to_agreed_animation.md`](aud_proposed_to_agreed_animation.md)). Shipped duration: **350 ms** `cubic-bezier(0.16, 1, 0.3, 1) forwards`. Methodology-significant commit-moment (per-facet agreement); parity with axiom-mark landing was the predecessor's justification. The `.aud-pill-agreed` utility lives at [`apps/audience/src/index.css:206-210`](../../../apps/audience/src/index.css#L206).
- `!audience.aud_animations.aud_axiom_mark_animation` (settled — [`tasks/refinements/audience/aud_axiom_mark_animation.md`](aud_axiom_mark_animation.md)). Shipped duration: **350 ms** `cubic-bezier(0.16, 1, 0.3, 1) both`. The fill-mode is `both` (not `forwards`) because the axiom-mark badge sits at the `from` state at mount with `opacity: 0`; `both` carries the `from` styling pre-animation as well. Established the CSS-first, no-motion-framework, `prefers-reduced-motion`-in-CSS posture every subsequent animation sibling inherited. The `.aud-axiom-mark-land` utility lives at [`apps/audience/src/index.css:97-99`](../../../apps/audience/src/index.css#L97).
- `!audience.aud_animations.aud_withdrawal_animation` (settled — [`tasks/refinements/audience/aud_withdrawal_animation.md`](aud_withdrawal_animation.md)). Shipped duration: **450 ms** `cubic-bezier(0.16, 1, 0.3, 1) forwards`. Halo geometry parity with node-appear. The `.aud-withdrawal` utility lives at [`apps/audience/src/index.css:284-286`](../../../apps/audience/src/index.css#L284).
- `!audience.aud_animations.aud_diagnostic_fire_animation` (settled — [`tasks/refinements/audience/aud_diagnostic_fire_animation.md`](aud_diagnostic_fire_animation.md)). Shipped duration: **450 ms** `cubic-bezier(0.16, 1, 0.3, 1) forwards` for both severity classes. The `.aud-diagnostic-fire-blocking` + `.aud-diagnostic-fire-advisory` utilities live at [`apps/audience/src/index.css:378-383`](../../../apps/audience/src/index.css#L378).
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_diagnostic_edge_fire_animation` (settled — [`tasks/refinements/audience/aud_diagnostic_edge_fire_animation.md`](aud_diagnostic_edge_fire_animation.md)). Reuses the node-sibling's two `@keyframes aud-diagnostic-fire-{blocking,advisory}` keyframes verbatim — no separate utility class. Inherits the pacing variable consumption through the shared rules. Per the `.tji` `depends` graph, this leaf is NOT a declared predecessor of `aud_animation_pacing` (it landed during the same animation cluster as the diagnostic-fire family it twins); but its CSS surface is the same node-sibling rules, so any constant lift here applies to it transparently.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_diagnostic_fire_animation_seeding_alignment` (settled — [`tasks/refinements/audience/aud_diagnostic_fire_animation_seeding_alignment.md`](aud_diagnostic_fire_animation_seeding_alignment.md)). Pure gate-logic fix in `DiagnosticFireOverlay.tsx`; no CSS change. Not pacing-relevant; cited only for the audit completeness.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_decomposition_animation` (FUTURE — sibling, NOT yet shipped; [`tasks/50-audience-and-broadcast.tji:336-339`](../../50-audience-and-broadcast.tji#L336)). The remaining unshipped animation leaf in the group. NOT a declared predecessor (the `.tji` `depends` line at [line 387](../../50-audience-and-broadcast.tji#L387) names the five shipped animations only). This is deliberate — `aud_decomposition_animation` should adopt the cadence variables this leaf publishes when it lands rather than ship inline constants that pacing would then need to re-tune. The constraint is recorded under Decisions §7 below: future animation leaves consume `var(--aud-anim-*)` rather than inline `Nms`.
- Prose-only context (NOT a `.tji` edge): `audience.aud_url_routing.aud_session_url` (sibling, future). The audience surface's deferred-e2e debt collector. Per every prior `aud_animations.*` leaf's Decision §6, the live-arrival Playwright scenarios route there. This leaf does NOT add new behavioural scenarios — its surface is pure constant-lift — but the closer of `aud_session_url` should be aware that the visible-on-broadcast durations now flow through CSS variables, in case the e2e environment ever needs to inject test-mode override durations (e.g., faster animations for time-bound assertions). Decision §6 below documents this.
- Prose-only context (NOT a `.tji` edge): `audience.aud_visual_regression` (future). Pins post-animation steady state. This leaf does NOT change any post-animation steady state (the durations themselves are pre-steady-state; the `forwards` / `both` fill-mode end-states are byte-identical before and after the lift). No new VR fixture is registered. The `.aud-*` utility class names are unchanged.
- Prose-only context (NOT a `.tji` edge): `audience.aud_clean_typography.aud_typography_bundle_measurement` (settled — [`tasks/refinements/audience/aud_typography_bundle_measurement.md`](aud_typography_bundle_measurement.md), Decision §3(B)). Established that the Tailwind v4 + Vite library-mode build pipeline silently drops unreferenced `@import` rules — a cautionary tale informing the CSS smoke-pin tradition the animation siblings adopted. Custom-property `:root` declarations are NOT subject to that issue (they are not `@import` rules), but the same posture applies: a Vitest string-grep over the disk-read CSS file pins the variable definitions against silent pipeline drift. The 30 fps OBS frame-budget reasoning in Decision §2 below mirrors the same "broadcast platform's real constraints inform animation choices" framing this predecessor brought to typography.

## What this task is

The 1d cross-cutting leaf that **closes out the audience animation family** by consolidating the six shipped utility classes' inlined `Nms <easing> <fill-mode>` constants behind a single tier of three CSS custom properties:

```css
:root {
  --aud-anim-easing: cubic-bezier(0.16, 1, 0.3, 1);
  --aud-anim-commit-ms: 350ms;
  --aud-anim-halo-ms: 450ms;
}
```

and rewriting each `.aud-*` utility class to consume them via `animation-duration: var(...)` + `animation-timing-function: var(...)` (or the longhand-equivalent shorthand). The behavioural seam is preserved exactly: every animation continues to run with the same duration, easing, fill-mode, target opacity, target transform, and `prefers-reduced-motion: reduce` no-op override as before.

The task is **not** "change the durations to look better on video." It is "extract the durations to a single tier so that whichever durations are correct for video are encoded once, with a documenting comment block that records the methodology-tied cadence model and the 30 fps OBS frame-budget reasoning that produced the current values." The current values (350 ms for commit-moments, 450 ms for halos) ARE the tuned values — they were chosen with broadcast-readability in mind by the predecessor refinements, the cumulative posture is internally consistent, and the cross-cutting audit this leaf does confirms no per-leaf adjustment is warranted today. The lift IS the tuning: the documentation makes the cadence model explicit, the variables make future per-tier adjustment a one-line change, and the smoke pins guard the contract.

Concretely the leaf does four things end-to-end:

1. **Adds a `:root` declaration** with three custom properties (`--aud-anim-easing`, `--aud-anim-commit-ms`, `--aud-anim-halo-ms`) at the top of the animation block in [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) (after the `@theme` block, before `[data-axiom-mark-anim]` would naturally sit — currently `.aud-axiom-mark-land` is the first animation utility). A multi-line comment block above the `:root` records the cadence model + the 30 fps frame-budget reasoning + the methodology classification (commit-moments vs halos) per Decision §2.
2. **Rewrites the six existing `.aud-*` animation utility classes** to consume the variables. `.aud-axiom-mark-land` and `.aud-pill-agreed` switch to `var(--aud-anim-commit-ms)`; `.aud-node-appear`, `.aud-withdrawal`, `.aud-diagnostic-fire-blocking`, `.aud-diagnostic-fire-advisory` switch to `var(--aud-anim-halo-ms)`. All six switch to `var(--aud-anim-easing)`. Fill-modes (`both` for axiom-mark; `forwards` for the others) stay inline per Decision §3 — they are per-animation expression of intent, not pacing.
3. **Extends [`apps/audience/src/index.test.ts`](../../../apps/audience/src/index.test.ts)** with smoke pins that assert each custom property is defined in `:root` with the expected value (350ms / 450ms / the cubic-bezier curve), and that each `.aud-*` utility's `animation-duration` and `animation-timing-function` reference the correct variable. ~9 new Vitest cases (3 property-definition + 6 utility-consumption).
4. **Does NOT touch any overlay React file or its tests**. The lift is pure CSS surgery. The `.aud-*` class names, the `data-*-anim` selectors, the `useSeenKeysGate` gating, the rAF-batched commit path, the per-overlay React props — all unchanged. No Vitest case under `apps/audience/src/graph/*.test.tsx` should need any edit.

After this leaf:

- [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) — MODIFIED. Adds the `:root` block + the documenting comment; rewrites the `animation:` shorthand on each of the six utility classes to consume the variables. Net delta: ~30 lines added (mostly comment), ~6 lines rewritten in place. NO new keyframe. NO new utility class. NO new media query.
- [`apps/audience/src/index.test.ts`](../../../apps/audience/src/index.test.ts) — MODIFIED. ~9 new Vitest cases appended (variable-definition presence pins + utility-consumption pins). The existing 11 cases pass unchanged (the `@keyframes` names, the `prefers-reduced-motion: reduce` overrides, and the `.aud-*` utility class names are all preserved verbatim).
- `apps/audience/src/graph/AxiomMarkOverlay.tsx`, `apps/audience/src/graph/NodeAppearOverlay.tsx`, `apps/audience/src/graph/PerFacetPillOverlay.tsx`, `apps/audience/src/graph/WithdrawalHaloOverlay.tsx`, `apps/audience/src/graph/DiagnosticFireOverlay.tsx`, `apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx` — UNCHANGED. Same `.aud-*` class names; same `data-*-anim` wrapper attributes; same `useSeenKeysGate` posture.
- `apps/audience/src/graph/cytoscapeOverlayHooks.ts` — UNCHANGED.
- `apps/audience/src/graph/GraphView.tsx` — UNCHANGED.
- `apps/audience/src/ws/wsStore.ts` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED. No new dependency.
- `tasks/50-audience-and-broadcast.tji` — MODIFIED at close-time only: closer adds `complete 100` to `aud_animation_pacing`. No `depends` edits on this task itself; no new named-future-task to register (Decision §5 below scopes a future stagger task only as a speculative pointer, NOT a pre-registered leaf).

Out of scope (deferred to existing or future leaves):

- **Re-tuning any duration value.** The current 350 ms / 450 ms split is the predecessor refinements' tuned output; this leaf's audit confirms (Decision §2) that the 30 fps frame-budget reasoning supports both, with margin. If a future broadcast trial surfaces a perceptual problem (e.g., halos read as "too slow" on a particular OBS scene composition), the variable approach this leaf publishes is exactly the dial that future task turns — one `:root` value, no per-utility edits.
- **Stagger between simultaneous arrivals.** A multi-node cycle's diagnostic-fire today produces N halos arriving in the same rAF tick (one halo per affected node). Visually all N halos peak together. A future task `aud_animation_burst_stagger` (~1d, NOT pre-registered — speculative) could introduce a per-index `animation-delay` (e.g., `calc(var(--idx, 0) * 40ms)`) for genuinely simultaneous bursts, OR alternatively defer to a Cytoscape-side reveal sequencing that already orders nodes-in-cycle by some canonical ordering. The decision belongs in that future task with a real broadcast-trial input; this leaf does not pre-judge. See Decision §5 for the explicit deferral rationale.
- **A reduced-motion-aware visible-affordance alternative.** Today `@media (prefers-reduced-motion: reduce) { .aud-* { animation: none; } }` collapses every animation to a no-op. The viewer with reduced-motion preferences gets a static canvas — they see the steady-state styling (rose-600 disputed border, per-facet agreed pill chrome) but miss the moment-of-arrival cue entirely. A richer reduced-motion strategy (e.g., a brief opacity-only fade, or a 100 ms snap-flash with no scale change) is a polish surface not in scope. Future task `aud_reduced_motion_affordance` (~0.5d, NOT pre-registered — speculative; needs an a11y-design input).
- **The `aud_decomposition_animation` leaf's CSS.** That leaf is unshipped — when it lands, it should consume `var(--aud-anim-halo-ms)` (or `--aud-anim-commit-ms` depending on its semantic class) per Decision §7's contract. This leaf does NOT scope decomposition; this leaf publishes the variables that decomposition will consume.
- **Lifting the variables into `@a-conversa/shell` or `packages/ui-tokens`.** The cadence model is currently audience-only — the moderator and participant surfaces do not paint these same animations. If/when a third surface consumes commit-moment + halo animation, the variables migrate to a shared tokens layer alongside the typography token (`--font-broadcast`, see [`aud_clean_typography.md`](aud_clean_typography.md)). NOT pre-registered; the "extract on the third caller" policy applies, and we have only one caller today.
- **A motion-framework dependency.** Rejected cumulatively across every predecessor (each `aud_animations.*` leaf records the same rejection); this leaf reinforces it. The variable lift does NOT change the no-framework posture.
- **Cytoscape `cy.animate(...)` calls.** Same cumulative rejection.
- **JS-side animation-duration constants.** Rejected — see Decision §1 alternatives. The single source of truth lives in CSS, not in TS, because the consumers ARE CSS keyframe rules.
- **`prefers-reduced-motion: reduce` per-tier behaviour.** Today the override is uniform (`animation: none`); per-tier nuance (e.g., reduce halos to a 100 ms snap, leave commit-moments at 0 ms) is out of scope.
- **A Playwright spec exercising the cadence on a live audience session.** The audience is still placeholder-routed (per every predecessor's Decision §6); the deferred-e2e debt collector remains `aud_url_routing.aud_session_url`. This leaf does NOT add new scenarios — its surface is pure constant-lift — but the closer of `aud_session_url` should be aware that the visible durations now flow through CSS variables (see Decision §6).
- **A test-mode override that shortens durations in CI.** A `[data-test-mode='fast'] :root { --aud-anim-halo-ms: 0ms; }` selector would let Playwright skip animation waits. NOT in scope today — no Playwright scenario exists yet to demand it. The variable lift makes this a one-line future addition if ever needed.
- **Editing the moderator or participant surfaces.** Strictly audience-scoped.
- **Editing the Cytoscape `STYLESHEET`.** Animations live in CSS overlay rules; the static stylesheet is untouched.

## Why it needs to be done

The audience animation family has shipped: six utility classes across five animation siblings (axiom-mark-land, node-appear, pill-agreed, withdrawal, diagnostic-fire × two severities), plus the edge-fire variant that reuses the diagnostic-fire keyframes verbatim. Each predecessor refinement individually documented its duration choice and noted that `aud_animation_pacing` would revisit the constant as part of cross-cutting cadence tuning. This leaf is that revisit.

Two reasons it matters:

**Methodological coherence.** The animation surface is the broadcast viewer's temporal vocabulary — each animation class signals a different kind of methodologically-significant moment. Commit-moments (axiom-mark, per-facet agreement) are participant-side declarations: short, decisive, "lands and sticks" semantics. Halo events (node-appear, withdrawal, diagnostic-fire) are graph-state arrivals: slightly longer, fading-outward halo semantics, "the canvas registered a change here." The 100 ms delta between the two tiers (350 ms vs 450 ms) is the perceptual differentiation — short enough to keep the broadcast feeling responsive, long enough that a viewer not already watching the affected location catches the cue in peripheral vision. Documenting this cadence model in one place (a comment block on the `:root` declaration) makes the methodology classification load-bearing and discoverable — future animation leaves (decomposition, future polish) consult the model rather than re-derive the duration from scratch.

**Single dial for future tuning.** Predecessor refinements each noted "the pacing task revisits the constant alongside other animation siblings." Without this leaf, that revisit would require six find-and-replace edits across `index.css` plus updating every Decision §5 in every refinement to record the new duration. With this leaf's variables, a future per-tier retune is a one-line `:root` change with no refinement-trail edits required — the existing predecessor refinements remain accurate as historical-rationale records, and the new tuned values live in `:root` where the smoke-pin tests already check them. The lift is reversible (any future task can move back to inline durations if the variable layer proves regressive), but practically it is a strict ergonomic win.

The `aud_animations` task group exists precisely so the broadcast surface accumulates animation siblings over time without re-tuning each in isolation. This leaf is the cross-cutting commit that ensures the accumulated siblings share a cadence model — not by changing what any of them does, but by encoding what they collectively are.

Downstream concretely:

- **`aud_decomposition_animation`** (FUTURE — [`tasks/50-audience-and-broadcast.tji:336-339`](../../50-audience-and-broadcast.tji#L336)) is the next animation leaf. Per Decision §7, its refinement adopts the cadence model — its utility class consumes `var(--aud-anim-halo-ms)` (decomposition is a graph-state arrival — parent fades, components emerge — methodologically a halo-tier event) and `var(--aud-anim-easing)`. The decomposition refinement's Decisions §1/§5 cite this leaf's cadence model as the inherited input.
- **`aud_session_url`** is the audience-reachability task; once it lands the inherited Playwright debt clears. The closer should be aware that durations flow through CSS variables (per Decision §6) — if the e2e environment ever wants to shorten durations for time-bound assertions, the variable layer is the dial.
- **Future animation polish** (`aud_animation_burst_stagger`, `aud_reduced_motion_affordance`, hypothetical others) — each consults the cadence model and either consumes the existing variables or adds tier-orthogonal new ones (delays, severity-specific overrides).

Architecturally, this leaf is the audience animation family's **closing brace**. The five siblings opened the surface; this leaf locks the cadence model and publishes the dial. There is no `aud_animation_audit` follow-up needed — the audit IS this leaf.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience uses Cytoscape with React DOM overlays. Animations are React/CSS-overlay concerns; the Cytoscape canvas animation API (`cy.animate(...)`) is out of reach for these overlay halos and badges, and was rejected by every predecessor.
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the audience CSS file at [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) hosts a `@theme` block that already lifts one token (`--font-broadcast`) to a custom property. The cadence variables sit in the SAME file at a sibling `:root` block (NOT inside `@theme`, per Decision §1's tradeoff against Tailwind v4 `@theme`-specific tooling); they are conventional CSS custom properties consumable by the keyframe rules below them.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest pins the variable definitions and the `animation` shorthand's variable consumption. The two layers together pin the contract end-to-end: a future refactor that drops a variable definition breaks the property-definition pin; a future refactor that hardcodes a duration breaks the utility-consumption pin.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the audience artifact owns its CSS. The cadence variables ship inside the audience bundle and do not leak to the moderator / participant artifacts.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — N/A in this leaf (the cadence variables are layer-agnostic — they apply uniformly to both entity-layer halos and facet-layer pulses).

No new ADR. The architectural seam (CSS custom properties as the cadence-model dial, NOT a JS-side constants module, NOT a Tailwind `@theme` extension, NOT a shell-package token) is small enough to settle as a Decisions block here. If a third surface ever consumes the cadence model the variables migrate to a shared tokens layer and an ADR captures the move; today's audience-only scope does not warrant one.

### Sibling refinements

- [`tasks/refinements/audience/aud_axiom_mark_animation.md`](aud_axiom_mark_animation.md) — Decision §5 chose 350 ms cubic-bezier(0.16, 1, 0.3, 1) "both" — the commit-moment tier's seed value.
- [`tasks/refinements/audience/aud_node_appear_animation.md`](aud_node_appear_animation.md) — Decision §5 chose 450 ms with the same easing "forwards" — the halo tier's seed value.
- [`tasks/refinements/audience/aud_proposed_to_agreed_animation.md`](aud_proposed_to_agreed_animation.md) — Decision §5 chose 350 ms parity with axiom-mark (both mark methodology-significant commit moments).
- [`tasks/refinements/audience/aud_withdrawal_animation.md`](aud_withdrawal_animation.md) — Decision §5 chose 450 ms parity with node-appear (halo-geometry parity).
- [`tasks/refinements/audience/aud_diagnostic_fire_animation.md`](aud_diagnostic_fire_animation.md) — Decision §5 chose 450 ms parity with the halo siblings; the two severity classes share the duration, differing only in scale (1.8 vs 1.7) and palette.
- [`tasks/refinements/audience/aud_diagnostic_edge_fire_animation.md`](aud_diagnostic_edge_fire_animation.md) — explicitly reused the node-sibling's keyframes verbatim (Decision §5); inherits this leaf's variable consumption transparently.
- [`tasks/refinements/audience/aud_dom_overlay_extraction.md`](aud_dom_overlay_extraction.md) — established the shared overlay hooks consumed unchanged; not pacing-relevant but cited for completeness.
- [`tasks/refinements/audience/aud_typography_bundle_measurement.md`](aud_typography_bundle_measurement.md) — Decision §3(B) established the CSS smoke-pin posture this leaf adopts for the variable definitions.
- [`tasks/refinements/audience/aud_clean_typography.md`](aud_clean_typography.md) — the precedent for "the audience-only CSS file is the right home for cross-Tailwind custom properties" (`--font-broadcast` lives there). The cadence variables sit in the same file at a sibling `:root` block.

### Live code the leaf modifies / creates

- [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) — MODIFIED. Two surgical edits and one insertion:

  **Insertion** (after the `@theme` block at line 36, before the `aud_axiom_mark_animation` comment block at line 70):

  ```css
  /* `aud_animation_pacing` — audience animation cadence model.
   *
   * The audience surface's animation family is methodologically tiered:
   *
   *   commit-moment tier (--aud-anim-commit-ms = 350 ms)
   *     • aud-axiom-mark-land — per-participant axiom-mark badge arrival
   *     • aud-pill-agreed     — per-facet pill transition to 'agreed'
   *     Semantics: a participant-side declaration just landed. Fast,
   *     decisive, "lands and sticks". Short enough to keep the
   *     broadcast feeling responsive; long enough (~10 frames at 30 fps
   *     OBS, well above the ~100 ms perceptual JND for motion) for the
   *     eye to lock on.
   *
   *   halo tier (--aud-anim-halo-ms = 450 ms)
   *     • aud-node-appear            — Cytoscape node arrival halo
   *     • aud-withdrawal             — rollupStatus → 'disputed' halo
   *     • aud-diagnostic-fire-blocking, ...-advisory — structural diagnostic halos
   *     Semantics: the graph state registered a change at this entity.
   *     Halo geometry (96 px square radial gradient) on a dense canvas
   *     benefits from the slightly slower entrance — gives peripheral
   *     vision time to catch the cue (~14 frames at 30 fps OBS).
   *
   *   shared easing (--aud-anim-easing = cubic-bezier(0.16, 1, 0.3, 1))
   *     Material Design "emphasized decelerate": fast initial motion
   *     settling gently into the resting state. Reads as "arrives and
   *     settles" for both tiers.
   *
   * The 100 ms inter-tier delta is the perceptual differentiator (~3
   * frames at 30 fps). Short enough that simultaneous arrivals don't
   * feel temporally fractured; long enough that a halo and a
   * commit-moment side-by-side read as distinct event kinds rather
   * than as one synchronized burst.
   *
   * Refinement: tasks/refinements/audience/aud_animation_pacing.md
   *   Decision §1 — CSS custom properties (NOT a JS constants module,
   *   NOT Tailwind v4 @theme tokens) are the cadence dial. The
   *   keyframe rules below consume them via animation-duration:
   *   var(--aud-anim-...).
   *   Decision §2 — the 350 ms / 450 ms split is the methodologically
   *   tuned output of the predecessor refinements; this leaf's audit
   *   confirms it against the 30 fps OBS frame budget with margin.
   *   Decision §3 — fill-modes (both / forwards) stay inline on each
   *   utility — they are per-animation expression of intent, not
   *   pacing.
   *   Decision §5 — no stagger between simultaneous halos today
   *   (deferred to a speculative future task).
   *   Decision §7 — future animation siblings (aud_decomposition_*
   *   etc) MUST consume the variables rather than ship inline
   *   durations. */
  :root {
    --aud-anim-easing: cubic-bezier(0.16, 1, 0.3, 1);
    --aud-anim-commit-ms: 350ms;
    --aud-anim-halo-ms: 450ms;
  }
  ```

  **Rewrites** of the six utility classes (each line changes from inline `Nms cubic-bezier(...)` to `var(--aud-anim-...-ms) var(--aud-anim-easing)`; fill-mode preserved):

  ```css
  /* line 97-99 — was: animation: aud-axiom-mark-land 350ms cubic-bezier(0.16, 1, 0.3, 1) both; */
  .aud-axiom-mark-land {
    animation: aud-axiom-mark-land var(--aud-anim-commit-ms) var(--aud-anim-easing) both;
  }

  /* line 158-160 — was: animation: aud-node-appear 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards; */
  .aud-node-appear {
    animation: aud-node-appear var(--aud-anim-halo-ms) var(--aud-anim-easing) forwards;
  }

  /* line 206-210 — was: animation: aud-pill-agreed 350ms cubic-bezier(0.16, 1, 0.3, 1) forwards; */
  .aud-pill-agreed {
    display: inline-block;
    animation: aud-pill-agreed var(--aud-anim-commit-ms) var(--aud-anim-easing) forwards;
    border-radius: 9999px;
  }

  /* line 284-286 — was: animation: aud-withdrawal 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards; */
  .aud-withdrawal {
    animation: aud-withdrawal var(--aud-anim-halo-ms) var(--aud-anim-easing) forwards;
  }

  /* line 378-380 — was: animation: aud-diagnostic-fire-blocking 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards; */
  .aud-diagnostic-fire-blocking {
    animation: aud-diagnostic-fire-blocking var(--aud-anim-halo-ms) var(--aud-anim-easing) forwards;
  }

  /* line 381-383 — was: animation: aud-diagnostic-fire-advisory 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards; */
  .aud-diagnostic-fire-advisory {
    animation: aud-diagnostic-fire-advisory var(--aud-anim-halo-ms) var(--aud-anim-easing) forwards;
  }
  ```

  All `@keyframes` rules unchanged; all `[data-*-anim]` selectors unchanged; all `@media (prefers-reduced-motion: reduce)` overrides unchanged.

- [`apps/audience/src/index.test.ts`](../../../apps/audience/src/index.test.ts) — MODIFIED. ~9 new Vitest cases appended in a new `describe('aud_animation_pacing — cadence variables', ...)` block:

  1. `:root` contains `--aud-anim-easing: cubic-bezier(0.16, 1, 0.3, 1)` (whitespace-tolerant regex).
  2. `:root` contains `--aud-anim-commit-ms: 350ms`.
  3. `:root` contains `--aud-anim-halo-ms: 450ms`.
  4. `.aud-axiom-mark-land`'s `animation:` shorthand references `var(--aud-anim-commit-ms)`.
  5. `.aud-pill-agreed`'s `animation:` shorthand references `var(--aud-anim-commit-ms)`.
  6. `.aud-node-appear`'s `animation:` shorthand references `var(--aud-anim-halo-ms)`.
  7. `.aud-withdrawal`'s `animation:` shorthand references `var(--aud-anim-halo-ms)`.
  8. `.aud-diagnostic-fire-blocking`'s `animation:` shorthand references `var(--aud-anim-halo-ms)`.
  9. `.aud-diagnostic-fire-advisory`'s `animation:` shorthand references `var(--aud-anim-halo-ms)`.

  Each case uses the same `readFile(INDEX_CSS_PATH, 'utf-8')` + regex pattern the predecessor smoke pins established. No JSDOM rendering — pure string-grep against the disk-read CSS file, consistent with the existing 11 cases.

- `apps/audience/src/graph/AxiomMarkOverlay.tsx`, `apps/audience/src/graph/AxiomMarkOverlay.test.tsx`, `apps/audience/src/graph/NodeAppearOverlay.tsx`, `apps/audience/src/graph/NodeAppearOverlay.test.tsx`, `apps/audience/src/graph/PerFacetPillOverlay.tsx`, `apps/audience/src/graph/PerFacetPillOverlay.test.tsx`, `apps/audience/src/graph/WithdrawalHaloOverlay.tsx`, `apps/audience/src/graph/WithdrawalHaloOverlay.test.tsx`, `apps/audience/src/graph/DiagnosticFireOverlay.tsx`, `apps/audience/src/graph/DiagnosticFireOverlay.test.tsx`, `apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx`, `apps/audience/src/graph/DiagnosticEdgeFireOverlay.test.tsx`, `apps/audience/src/graph/cytoscapeOverlayHooks.ts`, `apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx`, `apps/audience/src/graph/GraphView.tsx`, `apps/audience/src/graph/GraphView.test.tsx`, `apps/audience/src/graph/diagnosticHighlights.ts`, `apps/audience/src/graph/diagnosticHighlights.test.ts`, `apps/audience/src/graph/projectGraph.ts`, `apps/audience/src/graph/stylesheet.ts`, `apps/audience/src/graph/layoutOptions.ts`, `apps/audience/src/graph/cytoscapeTestEnv.ts`, `apps/audience/src/ws/wsStore.ts`, `apps/audience/src/ws/wsStore.test.ts`, `apps/audience/src/ws/useAudienceActiveDiagnostics.ts`, `apps/audience/src/ws/useAudienceConnectionStatus.ts`, `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx`, `apps/audience/src/state/*` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED. No new dependency.
- `apps/moderator/**`, `apps/participant/**`, `apps/server/**`, `apps/root/**` — UNCHANGED.
- `packages/shell/**`, `packages/shared-types/**`, `packages/i18n-catalogs/**`, `packages/ui-tokens/**` (if extant) — UNCHANGED.
- `docs/adr/**` — UNCHANGED. No new ADR (the seam is small enough to settle as a Decisions block here).

### What the surface MUST NOT do

- **No change to any keyframe rule.** The `@keyframes aud-axiom-mark-land`, `aud-node-appear`, `aud-pill-agreed`, `aud-withdrawal`, `aud-diagnostic-fire-blocking`, `aud-diagnostic-fire-advisory` blocks are byte-unchanged. Same `from` / `to`, same opacity, same transform, same scale endpoints.
- **No change to any `data-*-anim` selector.** `[data-axiom-mark-anim]`, `[data-node-appear-anim]`, `[data-withdrawal-anim]`, `[data-diagnostic-fire-anim]` (with `[data-severity='blocking' | 'advisory']`), and any edge-fire counterpart all keep their existing CSS rules (geometry, radial gradient, border-radius, pointer-events, opacity).
- **No change to any `prefers-reduced-motion: reduce` override.** Same six no-op rules, same media query block organization.
- **No change to any `.aud-*` class name.** A class rename would cascade into the overlays' React class strings and break every overlay's tests — strictly out of scope here.
- **No change to any fill-mode.** Axiom-mark stays `both`; node-appear / pill-agreed / withdrawal / diagnostic-fire-{blocking,advisory} stay `forwards`. Fill-modes are per-animation expression of intent (does the animation jump back to `from` after completion? stay at `to`? carry `from` styling pre-animation?) — they belong with each utility, not in the cadence tier.
- **No new keyframe.** No animation added; no animation removed.
- **No new utility class.** Pure rewrite of the six existing ones.
- **No React-side change.** Zero edits in any `.tsx` file. The `useSeenKeysGate`, the rAF-batched commit, the seen-Set lazy seeding, the per-overlay `cy` subscription — all unchanged.
- **No new dependency.** No motion framework. No CSS-in-JS. No PostCSS plugin. The variables are vanilla CSS custom properties consumed by vanilla `animation:` shorthand.
- **No edit to Tailwind v4 `@theme`.** The cadence variables are decoupled from the typography token; they live at a sibling `:root` block. Decision §1 records the tradeoff.
- **No edit to any `.tji` file beyond the closer's `complete 100`.** No new task registration today (the speculative future tasks under "Out of scope" are speculative — not pre-registered).
- **No edit to the moderator or participant surfaces' animation behavior (they have none today on the relevant axes).** Strictly audience-scoped.
- **No JS-side reading of the variables.** The variables are CSS-only — consumed by the keyframe rules' `animation` shorthand. Reading them from React (`getComputedStyle(...)`) would couple the React layer to the cadence model and is out of scope.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) — MODIFIED. Insert one comment block + one `:root` block after the `@theme` block (line 36). Rewrite the six `.aud-*` utility class `animation:` shorthand declarations to consume the variables. Total delta: ~30 lines added (mostly comment), 6 lines rewritten in place. No keyframe / no media query / no selector changes.
- [`apps/audience/src/index.test.ts`](../../../apps/audience/src/index.test.ts) — MODIFIED. Append one `describe('aud_animation_pacing — cadence variables', ...)` block with 9 `it(...)` cases per the list in Inputs / context. The 11 existing cases pass unchanged.

### Files this task does NOT touch

- All files under `apps/audience/src/graph/`, `apps/audience/src/ws/`, `apps/audience/src/state/`, `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx`, `apps/audience/src/mount.test.tsx` — UNCHANGED.
- `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — UNCHANGED.
- `packages/shell/**`, `packages/shared-types/**`, `packages/i18n-catalogs/**`, `packages/ui-tokens/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED.
- `docs/adr/**` — UNCHANGED. No new ADR.
- `playwright.config.ts` / `tests/e2e/**` — UNCHANGED. Playwright deferral per Decision §6 (continues to route to `aud_session_url`'s inherited chain).
- `.tji` files — `complete 100` lands at task-completion time per the [README ritual](../README.md); the closer owns that edit. No `depends` edits and no new task registration here.

## Acceptance criteria

The check that says "done":

- `apps/audience/src/index.css` declares `:root { --aud-anim-easing: cubic-bezier(0.16, 1, 0.3, 1); --aud-anim-commit-ms: 350ms; --aud-anim-halo-ms: 450ms; }` (with the documenting comment block immediately above per Constraints).
- `apps/audience/src/index.css` `.aud-axiom-mark-land` and `.aud-pill-agreed` consume `var(--aud-anim-commit-ms)` and `var(--aud-anim-easing)`; `.aud-node-appear`, `.aud-withdrawal`, `.aud-diagnostic-fire-blocking`, `.aud-diagnostic-fire-advisory` consume `var(--aud-anim-halo-ms)` and `var(--aud-anim-easing)`. Fill-modes preserved (`both` for axiom-mark, `forwards` for the rest).
- All six `@keyframes` rules, all `[data-*-anim]` selectors, and all `prefers-reduced-motion: reduce` overrides are byte-unchanged relative to pre-leaf.
- `apps/audience/src/index.test.ts` carries the 9 new Vitest cases per the list in Inputs / context. The 11 existing cases pass unchanged.
- Every React overlay file (`AxiomMarkOverlay.tsx`, `NodeAppearOverlay.tsx`, `PerFacetPillOverlay.tsx`, `WithdrawalHaloOverlay.tsx`, `DiagnosticFireOverlay.tsx`, `DiagnosticEdgeFireOverlay.tsx`) is byte-unchanged. Their `.test.tsx` siblings are byte-unchanged.
- `apps/audience/package.json` is byte-unchanged (no new dependency).
- Per ADR 0022, no throwaway smoke scripts. The 9 new Vitest cases pin the variable definitions and the utility-class consumption end-to-end at the CSS-file seam; the existing per-overlay React tests continue to pin the class-application logic. Animation-timing pixel capture remains out of scope (no current task has frame-capture infrastructure; speculative `aud_animation_video_regression` is NOT pre-registered today).
- Per the orchestrator brief's deferred-e2e exception ("component not yet reachable"): Playwright coverage for the audience animations remains routed to `aud_url_routing.aud_session_url` (per every predecessor's Decision §6). This leaf does NOT add new behavioural scenarios — its surface is pure constant-lift. The closer of `aud_session_url` should be aware that the visible durations now flow through CSS variables (per Decision §6 below), in case the e2e environment ever wants to inject test-mode overrides.
- No `aud_animation_pacing` `depends` edit by the closer (the task already lists its five predecessors at [`tasks/50-audience-and-broadcast.tji:387`](../../50-audience-and-broadcast.tji#L387) — all settled). No new named-future-task to register; the speculative future tasks (`aud_animation_burst_stagger`, `aud_reduced_motion_affordance`, `aud_animation_video_regression`) are NOT pre-registered per the orchestrator brief's "register only crisp, scoped follow-ups" guidance — they need real broadcast-trial / a11y-design / infra inputs before they crystallize.
- `pnpm run check` clean (no TS surface changed; the CSS edit does not affect the type check).
- `pnpm run test:smoke` green (Vitest count rises by 9 new cases).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is negligible (variables compile to plain CSS; the comment block strips in production).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_animation_pacing` in the same commit (the closer's ritual).

## Decisions

### §1 — CSS custom properties on a `:root` block (NOT a JS constants module, NOT a Tailwind v4 `@theme` token, NOT a shell-package token)

Four options for "where do the cadence constants live":

A. **CSS custom properties on a `:root` block in `apps/audience/src/index.css`.** A sibling block to the existing `@theme` declaration. Each `.aud-*` utility consumes `var(--aud-anim-...)` in its `animation` shorthand. Variables are vanilla CSS, no preprocessor, no JS coupling. A future tier-adjustment is a one-line `:root` value change; a future test-mode override is a one-line attribute-selector addition (`[data-test-mode='fast'] :root { ... }`).

B. **A TypeScript constants module (`apps/audience/src/graph/animationPacing.ts` exporting `COMMIT_MS = 350`, `HALO_MS = 450`).** The React overlays read the constants and pass them via `style={{ animationDuration: ... }}` inline styles or via a CSS-in-JS layer. The CSS keyframe rules remain in `index.css` but the `animation` shorthand moves into JS-side computation.

C. **A Tailwind v4 `@theme` extension** — add `--animate-commit-ms`, `--animate-halo-ms` to the existing `@theme` block. Tailwind v4 surfaces these as utilities (e.g., `animate-duration-commit`); the `.aud-*` classes consume the Tailwind utilities OR the `@theme` variables directly.

D. **A shell-package token** — lift `commitMs`, `haloMs`, `easing` into `packages/ui-tokens/src/animation.ts`; the audience imports the tokens and emits them as inline CSS variables on `<body>` or `<html>` at runtime, OR via a build-time CSS extraction.

**Chosen: A.** The CSS-only `:root` declaration is the smallest correct answer:

- The consumers (the keyframe `animation` shorthand rules) are already CSS. Keeping the constants in the same layer avoids an unnecessary JS↔CSS round-trip.
- A `:root` block in the audience-only `index.css` mirrors what the predecessor `aud_clean_typography` did for `--font-broadcast` — same file, same posture, same smoke-pin discipline.
- A future test-mode override (`[data-test-mode='fast'] :root { --aud-anim-halo-ms: 0ms; }`) is a one-line addition with zero JS coupling.
- The `:root` block is decoupled from Tailwind v4's `@theme` block intentionally — `@theme` tokens surface as Tailwind utilities (e.g., `font-broadcast` becomes the `font-broadcast` class); cadence variables are NOT consumed as utility classes (the `.aud-*` utilities consume them via `var(...)` in handwritten CSS), so a Tailwind `@theme` declaration would add JIT-tooling concern without adding value. Keeping them in a plain `:root` block makes the "this is plain CSS, not a Tailwind plugin extension" boundary clear.

Option B (TS constants module) is rejected: the consumers are CSS keyframe rules, not React. Routing the durations through JS adds an inline-style layer (`style={{ animationDuration: \`${COMMIT_MS}ms\` }}`) on every animated wrapper, which (i) couples the React overlay layer to the cadence model that should be CSS-layer-private, (ii) duplicates the source of truth (JS module + CSS file both define the durations), (iii) breaks the existing `.aud-*` utility class contract (the class name today carries the duration; under option B the class name only carries the keyframe name and inline style carries the duration). The CSS-class contract is the better factoring.

Option C (Tailwind `@theme` token) is rejected: Tailwind v4's `@theme` tokens are designed to surface as utility classes (e.g., `--animate-fast` becomes `animate-fast`). Our `.aud-*` utilities are handwritten, not Tailwind-generated, and they consume the durations via `var(...)` in handwritten `animation:` shorthand. The `@theme` declaration would add Tailwind-tooling surface area (Vite plugin awareness, JIT-class candidacy) without adding consumer value. Option A's `:root` declaration is a strict subset — same `var(...)` consumption, no Tailwind-tooling concern.

Option D (shell-package token) is rejected today as premature extraction: there is one caller (the audience). The "extract on the third caller" policy applies symmetrically here — when (if ever) the moderator or participant grows commit-moment + halo animation, the variables migrate to a shared tokens layer at that time. Pre-emptive extraction commits the cross-surface contract before there's a second consumer to validate the shape.

### §2 — Audit of current durations against the 30 fps OBS frame budget; current values retained

Four options for "what duration values to ship":

A. **Retain 350 ms (commit) / 450 ms (halo).** The predecessor refinements' tuned output. Audit confirms (below) the values are within the 30 fps OBS frame budget with margin.

B. **Normalize everything to a single duration (e.g., 400 ms across the board).** Maximum visual coherence; loses the methodology-tied tier distinction.

C. **Shorten the halo tier to 350 ms** so both tiers match. Faster overall feel; loses the "halo geometry benefits from slower entrance" rationale the halo siblings recorded.

D. **Lengthen the commit tier to 450 ms** so both tiers match. Slower overall feel; loses the "lands and sticks" responsiveness the commit-moment siblings recorded.

**Chosen: A.** The audit:

- **OBS broadcast target** is conventionally 30 fps (some producers use 60; 30 is the floor). At 30 fps each frame is ~33.3 ms.
- **Commit-moment tier (350 ms)** ≈ 10.5 frames. Comfortably above the perceptual just-noticeable-difference for motion (~100 ms ≈ 3 frames). Long enough for video compression (H.264 / HEVC) to encode the transition smoothly without macroblock artifacting (sub-100 ms transitions can produce visible compression noise on low-bitrate streams; 350 ms transitions decompose into ~10 well-encoded I/P frame sequences).
- **Halo tier (450 ms)** ≈ 13.5 frames. The slightly longer duration accommodates (i) the halo's larger pixel footprint (96 px square radial gradient) which the eye scans rather than fixes on, (ii) the peripheral-vision capture pattern (a viewer not already looking at the affected entity needs slightly more time for saccadic re-fixation — the conventional ~200-300 ms saccade-to-fixation cycle plus a settling margin), (iii) the methodologically-graver semantics (a halo means the graph state changed; a viewer should have time to register WHICH entity changed before the cue fades).
- **Inter-tier delta (100 ms)** ≈ 3 frames. Short enough that a halo and a commit-moment arriving in the same broadcast tick read as part of one event sequence (not temporally fractured), long enough that the eye can sequence them ("the commit-moment landed slightly before / after the halo") rather than perceiving them as one synchronized burst.
- **Reduced-motion fallback** (uniform `animation: none`) means viewers with `prefers-reduced-motion: reduce` see no temporal cue at all — the cadence model applies only to the default-motion path. A nuanced reduced-motion strategy is deferred (per Out-of-scope) to a future polish task.

Options B/C/D are rejected: each loses information the predecessor refinements explicitly recorded as load-bearing. The 100 ms delta IS the methodology classification made visible — collapsing it erases the distinction between "a participant declared" and "the graph state changed." Normalization is a one-line `:root` change in any future task if a broadcast trial surfaces a perceptual problem; the variable layer this leaf publishes makes that future change cheap.

The audit also examined the easing curve: `cubic-bezier(0.16, 1, 0.3, 1)` is consistent across all six utility classes (no inter-utility easing drift). It is Material Design's "emphasized decelerate" — fast initial motion, gentle settle. It reads as "arrives and settles" for both tiers and does not need per-tier differentiation. Lifted to `--aud-anim-easing` for parity-of-treatment with the durations and to lock the consistency at the dial layer (a future variant-rule could expose `--aud-anim-easing-emphatic` if one halo class ever needs a sharper curve, but the current uniform curve is correct).

### §3 — Fill-modes (both / forwards) stay inline on each `.aud-*` utility — they are per-animation expression of intent, not pacing

Two options for where the fill-modes live:

A. **Keep fill-modes inline on each `.aud-*` utility** (`animation: <name> var(...) var(...) both` vs `... forwards`). Each animation expresses its intent at its utility class; the cadence variables carry only duration + easing.

B. **Lift fill-modes to per-tier variables too** (`--aud-anim-commit-fill: both`, `--aud-anim-halo-fill: forwards`). Each `.aud-*` utility consumes the tier's full pacing-and-fill profile.

**Chosen: A.** Fill-mode is NOT pacing — it is the answer to "what state does the element rest in pre- and post-animation?" The axiom-mark badge is `both` because its `from` state (`opacity: 0`) IS its pre-animation rest state (the badge is invisible until it mounts and the keyframe seeds the rest state from `from`). The halo classes are `forwards` because their `from` state (`opacity: 1`) is decidedly NOT their rest state (the halo should be invisible at rest — `opacity: 0` is the `to` state and `forwards` carries it post-animation). These choices are semantic per the animation kind, not per the cadence tier.

Option B is rejected: lifting fill-modes to per-tier variables would force every commit-moment animation to share `both` and every halo to share `forwards`. The classification accidentally holds today (axiom-mark + pill-agreed both happen to have specific reasons — axiom-mark needs `both` to seed the `from` state; pill-agreed could be `both` too but chose `forwards` to match the halo pattern), but it is not a load-bearing rule. Locking it at the dial layer would make a future animation that wants `commit-tier duration + forwards fill` (or `halo-tier duration + both fill`) into an awkward exception. Keeping fill-modes inline preserves per-utility expressiveness without complicating the cadence model.

### §4 — `prefers-reduced-motion: reduce` uniform `animation: none` override preserved; per-tier reduced-motion strategy deferred

Today the six `.aud-*` utilities share a uniform reduced-motion override: each gets its own `.aud-X { animation: none; }` rule inside one or more `@media (prefers-reduced-motion: reduce)` blocks. The override does NOT consume the cadence variables (it doesn't need to — it nulls the animation entirely).

This leaf preserves the uniform override exactly. A nuanced strategy (e.g., reduce halos to a 100 ms opacity-only fade so the viewer still sees a cue without the scale/translate motion) is out of scope and deferred to a speculative future `aud_reduced_motion_affordance` task (NOT pre-registered — needs a11y-design input to crystallize). The variable layer this leaf publishes does NOT preclude such a future change; if the future task wants tier-specific reduced-motion durations it can introduce `--aud-anim-reduced-fade-ms` or similar at that time.

### §5 — No stagger between simultaneous halos today (deferred; not pre-registered)

A multi-node cycle's diagnostic-fire produces N halos in the same rAF tick (one per affected node). All N halos peak together at ~150 ms into the animation and fade together at ~450 ms. The visual character is "the cycle fired at all these nodes" — a synchronized burst.

This may or may not be what the broadcast viewer needs. An alternative is a per-index `animation-delay` (e.g., `:nth-child(N) { animation-delay: calc(var(--N, 0) * 40ms); }`) that staggers the halos by ~40 ms apart, producing a "chase" or "ripple" effect. Or a Cytoscape-side reveal sequencing that orders the nodes-in-cycle by some canonical order (e.g., position around the layout's centroid).

This leaf does NOT introduce a stagger because:

- The "synchronized burst" character may be methodologically correct — a cycle IS a set of nodes that jointly form the diagnostic; making them peak together emphasizes the joint nature.
- A stagger introduces a "reading order" (which node fires first, which last) that has no methodology backing — the per-node ordering is an artifact of `affectedEntities(payload).nodes` array order, which is in turn an artifact of the diagnostic detector's traversal, which has no semantic significance.
- A stagger would couple the React overlay to a sequence index (today the overlay just maps nodes to halos without ordering) — a non-trivial behavioral change well beyond the pure-CSS scope of this leaf.

Future task `aud_animation_burst_stagger` (~1d, NOT pre-registered today — speculative; needs a real broadcast-trial input where a producer or moderator says "the simultaneous halos are visually overwhelming") would scope the decision and the implementation if/when surfaced.

### §6 — Vitest pins the variable definitions and the utility-class consumption; Playwright continues to route to `aud_session_url`

The 9 new Vitest cases pin the contract at the CSS-file seam:

- Three property-definition cases (each `--aud-anim-*` variable defined with the right value in `:root`).
- Six utility-consumption cases (each `.aud-*` utility's `animation:` shorthand references the correct variable).

What the tests deliberately do NOT pin:

- Live rendered duration (jsdom does not run CSS animations; the variable lift does not change runtime behavior the React tests would observe).
- Pixel-by-pixel frame capture (no infrastructure; speculative `aud_animation_video_regression` is NOT pre-registered).
- Per-tier reduced-motion behaviour (today's uniform `animation: none` does not need variable-consumption pins because it does not consume the variables).

Playwright destination: `aud_url_routing.aud_session_url` — same as every predecessor `aud_animations.*` leaf. This leaf does NOT add new behavioural scenarios; the audience animation behaviour is unchanged. The closer of `aud_session_url` should be aware that the visible durations now flow through CSS variables — in the unlikely event the e2e environment wants to inject test-mode override durations (e.g., `[data-test-mode='fast'] :root { --aud-anim-halo-ms: 0ms; }` to skip animation waits in time-bound assertions), the variable layer this leaf publishes is the one-line dial. Not in scope today; surfaced here so the closer of `aud_session_url` does not need to re-derive it.

### §7 — Future animation siblings MUST consume the variables (NOT ship inline durations)

The unshipped `aud_decomposition_animation` leaf is the next animation in the family. Per this leaf's cadence model, decomposition is a graph-state arrival (parent fades, components emerge) — methodologically a halo-tier event — and its CSS utility class MUST consume `var(--aud-anim-halo-ms)` and `var(--aud-anim-easing)` rather than ship inline `Nms cubic-bezier(...)`. The decomposition refinement's Decisions §1 / §5 will cite this leaf's cadence model as the inherited input.

This is a soft contract — the audience CSS file is small enough that a future inline value would be visible at code-review time, and the smoke-pin discipline this leaf establishes would catch it. But it is recorded explicitly here so future task authors do not need to re-derive the "should I lift this constant?" question.

If a future animation does not fit either tier (e.g., a 200 ms quick-flash for a confirmation cue), the right answer is to introduce a third tier (`--aud-anim-flash-ms`) at the `:root` block, NOT to ship inline. The cadence model is per-tier; the tiers themselves are extensible.

### §8 — No new ADR

The architectural seam is small: a single-file CSS lift confined to the audience surface, with one consumer (the audience's animation rules), no cross-surface contract, no new dependency, and a clear extraction path if a third surface ever consumes the cadence model (per Decision §1 option D's deferral). This is well within the Decisions-block-in-refinement threshold. If the future shell-package extraction lands, that task writes the ADR documenting the cross-surface contract — the move from per-app token to shared token is the architectural decision worth recording, not the per-app lift this leaf does.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-29.

- `apps/audience/src/index.css` — added `:root` block with three CSS custom properties (`--aud-anim-easing: cubic-bezier(0.16, 1, 0.3, 1)`, `--aud-anim-commit-ms: 350ms`, `--aud-anim-halo-ms: 450ms`) preceded by a multi-line documenting comment encoding the cadence model, the 30 fps OBS frame-budget reasoning, and the methodology tier classification.
- `apps/audience/src/index.css` — rewired the six `.aud-*` animation utility classes to consume `var(--aud-anim-commit-ms)` / `var(--aud-anim-halo-ms)` / `var(--aud-anim-easing)`; fill-modes preserved inline (`both` for `.aud-axiom-mark-land`, `forwards` for the others); all `@keyframes`, `[data-*-anim]` selectors, and `prefers-reduced-motion: reduce` overrides byte-unchanged.
- `apps/audience/src/index.test.ts` — added `describe('aud_animation_pacing — cadence variables')` block with 9 Vitest cases: 3 `:root` property-definition pins (one per variable) + 6 `.aud-*` utility-consumption pins (each checks the `animation:` shorthand references the correct variable).
- No React overlay files touched; no `@keyframes` added; no new dependency; no new ADR.
- Deferred speculative follow-up tasks (`aud_animation_burst_stagger`, `aud_reduced_motion_affordance`, `aud_animation_video_regression`) explicitly NOT pre-registered per the refinement's guidance — they need real broadcast-trial / a11y-design / infra inputs.
