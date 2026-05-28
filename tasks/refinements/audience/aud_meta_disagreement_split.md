# Audience meta-disagreement split rendering (violet double-border on nodes, violet solid stroke on edges, for the methodology's "carry both sides" disposition)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_graph_rendering.aud_meta_disagreement_split` (lines 197-201).
**Effort estimate**: 1d (the `.tji` budget; Decision §1 notes the realistic effort drops to ~0.5d now that the four-state stylesheet plumbing has shipped through the proposed/agreed/disputed siblings — the closer may revise downward, but the budget is not normative to this refinement).

**Inherited dependencies**:

- `!audience.aud_graph_rendering.aud_cytoscape_init` (settled — shipped 2026-05-27, `complete 100` at [`tasks/50-audience-and-broadcast.tji:90`](../../50-audience-and-broadcast.tji#L90)). The mount this leaf restyles: the one-shot `cytoscape({ ... })` call inside `<div data-testid="audience-graph-root">` at [`apps/audience/src/graph/GraphView.tsx:232-246`](../../../apps/audience/src/graph/GraphView.tsx#L232); the module-scope `STYLESHEET` (since `aud_stylesheet_module_extraction` shipped) now lives at [`apps/audience/src/graph/stylesheet.ts:155-234`](../../../apps/audience/src/graph/stylesheet.ts#L155) and is the seam this leaf extends with the fourth per-state selector pair.
- Prose-only context (NOT a `.tji` edge today; Decision §1 below requests the closer add it): `audience.aud_graph_rendering.aud_proposed_styling` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_proposed_styling.md`](aud_proposed_styling.md)). This leaf consumes the plumbing landed there: the [`apps/audience/src/graph/facetStatus.ts`](../../../apps/audience/src/graph/facetStatus.ts) port (`FacetStatus` enum at [`L72-79`](../../../apps/audience/src/graph/facetStatus.ts#L72) including the `'meta-disagreement'` value, the `ROLLUP_PRIORITY` array at [`L519-534`](../../../apps/audience/src/graph/facetStatus.ts#L519) ordering `proposed > meta-disagreement > disputed > agreed > committed > withdrawn > awaiting-proposal`, `cardRollupStatus`, and Rule 1 — meta-disagreement short-circuit — at [`L452-454`](../../../apps/audience/src/graph/facetStatus.ts#L452)) and the projection-time emission of `data.facetStatuses` + `data.rollupStatus` on every projected element. The `'meta-disagreement'` rollup value is produced whenever `state.metaDisagreement === true` on any of an entity's accumulated facet states (sourced from `meta-disagreement-marked` events at [`apps/audience/src/graph/facetStatus.ts:397-419`](../../../apps/audience/src/graph/facetStatus.ts#L397)).
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_agreed_styling` (settled — shipped 2026-05-27). The slate-700 (`#334155`) agreed precedent and the cross-surface palette discipline this leaf inherits (violet is its own family, not slate or rose).
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_disputed_styling` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_disputed_styling.md`](aud_disputed_styling.md)). The rose-600 (`#e11d48`) disputed precedent + the `border-width: 3` Cytoscape-canvas analogue of the moderator's `ring-rose-500` halo. This leaf is the **fourth** per-state sibling; the visual axis it claims (`border-style: double`) is the one the disputed pair deliberately did not touch (Decision §2 below documents the axis separation).
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_stylesheet_module_extraction` (settled — [`tasks/refinements/audience/aud_stylesheet_module_extraction.md`](aud_stylesheet_module_extraction.md)). The stylesheet now lives in `./stylesheet.ts`; this leaf modifies that file directly, not `GraphView.tsx`.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_stylesheet_state_color_extraction` (settled — [`tasks/refinements/audience/aud_stylesheet_state_color_extraction.md`](aud_stylesheet_state_color_extraction.md)). The `STATE_COLORS` named-export constant at [`apps/audience/src/graph/stylesheet.ts:100-103`](../../../apps/audience/src/graph/stylesheet.ts#L100) is the established home for per-state hex literals; this leaf extends it with a `metaDisagreement: '#7c3aed'` entry (Decision §3).
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_layout_engine` (settled). The 200×80 node box stays unchanged; `border-style: double` renders within the existing border envelope without additional geometric impact (Decision §2 documents why a `border-width` bump is NOT applied alongside the double border on the audience surface).
- Prose-only context (NOT a `.tji` edge): `moderator_ui.mod_graph_rendering.mod_meta_disagreement_split_render` (settled — shipped 2026-05-11, [`tasks/refinements/moderator-ui/mod_meta_disagreement_split_render.md`](../moderator-ui/mod_meta_disagreement_split_render.md)). The cross-surface visual precedent: `border-double border-violet-600 ring-2 ring-violet-400 opacity-100` on nodes; `stroke: '#7c3aed'` + `strokeDasharray: '2 2'` (tight dotted) on edges. This leaf adopts the moderator's color (`#7c3aed`, violet-600) verbatim and translates the visual axes into Cytoscape primitives: `border-style: 'double'` on nodes; **solid** violet stroke on edges (Decision §2 documents why the audience departs from the moderator's dotted edge — Cytoscape's `line-style` enum does not include a tight `2 2` analog).
- Prose-only context (NOT a `.tji` edge): `participant_ui.part_meta_disagreement_split_render` / equivalent (settled — the participant's `apps/participant/src/graph/GraphView.tsx:399-408` ships `border-style: 'double'` + `border-color: '#7c3aed'` + `background-color: '#f5f3ff'` (violet-50) + `outline-color: '#a78bfa'` + `outline-width: 2` for the meta-disagreement node selector, and `line-color: '#7c3aed'` solid for the edge selector at [`L460-467`](../../../apps/participant/src/graph/GraphView.tsx#L460)). The participant's Cytoscape stylesheet is the closest precedent to this leaf's tech (canvas, not ReactFlow). The audience adopts the participant's `border-style: 'double'` + violet-600 hex for cross-surface consistency, but **does NOT** adopt the violet-50 fill tint or the `outline-*` halo (Decision §2 — those break the audience's no-fill + Cytoscape-canvas-restraint postures established by the disputed-state pair).

## What this task is

The fourth per-state leaf on the audience's Cytoscape canvas — nodes and edges whose card-level rollup is `'meta-disagreement'` get a violet double-border / solid-violet-line treatment that reads as "the methodology engine recorded this dispute as the disposition" on the broadcast surface. This completes the four agreement-layer states (proposed / agreed / disputed / meta-disagreement) viewers need to read on the broadcast canvas — the full ADR 0005 L19 visual contract.

After this leaf:

- Two new selector entries land in the module-scope `STYLESHEET` at [`apps/audience/src/graph/stylesheet.ts:155-234`](../../../apps/audience/src/graph/stylesheet.ts#L155) — `node[rollupStatus = 'meta-disagreement']` (overriding `border-style: 'double'` and `border-color: STATE_COLORS.metaDisagreement` (= `'#7c3aed'`, violet-600)) and `edge[rollupStatus = 'meta-disagreement']` (overriding `line-color: STATE_COLORS.metaDisagreement` and `target-arrow-color: STATE_COLORS.metaDisagreement`). Each entry overrides only the properties that differentiate the meta-disagreement state from the baseline; typography, geometry (200×80 box), label, shape, background, border-width, and text-background fields all inherit from the baseline `node` / `edge` selectors via Cytoscape's per-selector composition.
- One new entry lands in the `STATE_COLORS` named-export constant at [`apps/audience/src/graph/stylesheet.ts:100-103`](../../../apps/audience/src/graph/stylesheet.ts#L100): `metaDisagreement: '#7c3aed'`. Grow-as-needed per the constant's established posture (Decision §2 of `aud_stylesheet_state_color_extraction.md`).
- Four new Vitest cases land in `apps/audience/src/graph/GraphView.test.tsx` (currently 34 cases after `aud_disputed_styling` cases ee–hh shipped) — two structural assertions that the new selector entries appear in `STYLESHEET` with the right style fields, and two mount-time assertions that a node / edge whose projection emitted `data.rollupStatus === 'meta-disagreement'` carries the meta-disagreement-state computed style after one render tick. Mount-time cases land inline here (not deferred to a follow-up task) because the projection-time emission is already in place — Vitest can resolve the computed style end-to-end on first commit (same posture as `aud_disputed_styling` Decision §3).

Out of scope (deferred to existing or future leaves):

- **Per-facet meta-disagreement pill rendering.** Owned by `aud_per_facet_visualization` (already shipped 2026-05-28). The per-facet pill overlay's `<FacetPill status="meta-disagreement">` consumer renders the moderator's `border-double border-violet-600 text-violet-700 ring-1 ring-violet-400` Tailwind palette at pill scale (per [`packages/shell/src/facet-pill/FacetPill.tsx:80-81`](../../../packages/shell/src/facet-pill/FacetPill.tsx#L80)). The card-level rollup this leaf paints is the conservative default; the per-facet detail is paint-on-top of the canvas via the existing DOM overlay. This leaf does NOT modify `PerFacetPillOverlay.tsx` or `<FacetPill>`.
- **Committed / withdrawn / awaiting-proposal visuals.** Owned by closer- or maintainer-registered future leaves under `aud_graph_rendering.*`. Each adds its own `node[rollupStatus = '<state>']` / `edge[rollupStatus = '<state>']` selector entries. This leaf does NOT pre-emptively scope them.
- **The diagnostic-fire animation.** Owned by `aud_diagnostic_fire_animation` (1d). Structural diagnostics (cycles, contradictions) are a separate visual axis from agreement-layer rollups; this leaf does NOT cross into structural-diagnostic styling.
- **The meta-disagreement transition animation** (e.g., `disputed → meta-disagreement` when the moderator marks a stuck dispute). No animation task is currently registered for this transition specifically; if/when broadcast viewer feedback identifies it as load-bearing, a maintainer registers `aud_meta_disagreement_mark_animation` (~1d) as a sibling of `aud_withdrawal_animation`. NOT pre-registered today (speculative).
- **A diagonal split / multi-fill node visualization.** The moderator deliberately rejected diagonal splits (`mod_meta_disagreement_split_render.md` Decision §1, third paragraph) because they collide with the per-facet visualization slot. The same rejection applies here: per-facet detail belongs in `PerFacetPillOverlay`, not in the card's fill geometry.
- **Color tokens extracted to `packages/ui-tokens`.** Per ADR 0005's "Workspace realization deferred" consequence and the standing posture across the per-state predecessors, the token workspace has not yet materialized; the violet-600 hex literal lands inline in `STATE_COLORS` and migrates whenever the workspace ships.
- **A Playwright spec exercising the meta-disagreement-state styling.** Per the deferred-e2e exception (`ORCHESTRATOR.md` UI-stream e2e policy): the audience surface is still placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) (the per-session route lands in `aud_url_routing.aud_session_url`). Full deferral applies; Decision §6 places it on `aud_visual_regression`, the same destination the layout / typography / agreed-state / proposed-state / disputed-state pixel-stability deferrals route to.

## Why it needs to be done

The `m_audience_mvp` milestone in [`tasks/99-milestones.tji`](../../99-milestones.tji) names the entire `aud_graph_rendering` group transitively. The audience surface exists to broadcast to OBS; on the broadcast surface the **meta-disagreement visual is the methodology-engine's "this dispute became the answer" signal**. Without it, the audience canvas can show "everyone agrees" (slate-700), "we're still gathering votes" (proposed dashed-faded), and "this is where the live tension is" (rose-600 + width 3), but cannot show "the moderator concluded this is irreducible and recorded both sides side by side" — the methodology's escape-valve disposition. With all four agreement-layer states on the canvas, the viewer can read the conversation's full agreement structure: settled, in-motion, still-contended, and explicitly-split.

Concretely:

- **`aud_per_facet_visualization`** (already shipped) renders per-facet detail via the DOM-overlay pill row. A card whose rollup paints violet-double-border (this leaf's signal) can carry pills showing exactly WHICH facet(s) flipped to meta-disagreement and which other facets are agreed/disputed/proposed. The card-level paint this leaf adds is the at-a-glance scan signal; the pill row already shipped provides the per-facet detail.
- **`aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:455+`](../../50-audience-and-broadcast.tji#L455)) is the pixel-comparison task that already inherits typography + layout + per-state styling deferrals; meta-disagreement-state pixel-stability deferred here (Decision §6) follows the same routing.
- **The per-state extension pattern reaches its fourth — and final agreement-layer — sibling.** Proposed / agreed / disputed / meta-disagreement together span the four-state agreement-layer space documented in ADR 0005 L19. After this leaf the audience canvas matches the moderator's visual vocabulary on every agreement-layer status the methodology emits.

Architecturally, this leaf mirrors the moderator's `mod_meta_disagreement_split_render` (shipped 2026-05-11) but renders into a Cytoscape stylesheet rather than Tailwind classes on a ReactFlow custom node, and into Cytoscape `line-color` rather than an SVG `<path>` `stroke` attribute on edges. The moderator stacks two visual signals on nodes — `border-double border-violet-600` + `ring-2 ring-violet-400` — to mark "this is a methodology escalation" at scan distance across a dense moderator canvas. The audience adopts the same color (`#7c3aed` violet-600) and the same border-style (`'double'`), but **does NOT** stack a second signal (no `outline-*` halo, no `border-width` bump). Decision §2 below documents the rationale: the broadcast surface is less dense than the moderator console; the `border-style: double` against an otherwise-baseline 1px slate-300 frame reads as unambiguously different from the disputed pair's (`border-width: 3` + rose-600); cross-axis differentiation (style vs. width) is the principled separation. The cross-surface palette match (violet-600 on both surfaces) means broadcast composites read as one show: rose-600 = unresolved, violet-600 = split-disposition, slate-700 = settled, slate-300-dashed = in flight.

The participant's `apps/participant/src/graph/GraphView.tsx:399-408` is the closer technological precedent — Cytoscape stylesheet, same `border-style: 'double'`, same violet-600 hex. The audience adopts the border-style + color decisions verbatim from the participant; Decision §2 documents why the audience does NOT adopt the participant's additional `background-color: '#f5f3ff'` (violet-50) fill tint or the `outline-color: '#a78bfa'` + `outline-width: 2` halo (the audience's no-fill + Cytoscape-canvas-restraint postures established by `aud_disputed_styling` Decision §2 preclude both).

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience uses Cytoscape's stylesheet for all rendering; per-state visuals must be expressed as selector entries in `STYLESHEET`, not as CSS classes / inline styles on a DOM ancestor. Cytoscape's per-element visual axes are color + border-width + border-style + opacity + shape + size + overlay-color/opacity/padding + outline-* + line-style + line-color + target-arrow-*.
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the per-facet state visual contract is documented at L19 ("proposed dashed/faded, agreed solid, disputed marker, **meta-disagreement split**"). The "meta-disagreement split" specification is what this leaf realizes; the moderator's `mod_meta_disagreement_split_render` already settled the specific Tailwind palette (violet-600 border + violet-400 ring + `border-double`). The "Workspace realization deferred" consequence still applies: `packages/ui-tokens` has not materialized; hex literals continue to land in `STATE_COLORS`.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the Vitest cases below ARE the regression coverage. The visible-rendering pin lands in `aud_visual_regression` (Decision §6).
- [ADR 0024 — Frontend i18n: react-i18next + ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — orthogonal but worth naming: state styling is locale-independent; the same selector / color fires for every locale.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — orthogonal but worth naming: the audience surface is a mounted library; the new STYLESHEET entries ship as part of the audience artifact and do not bleed into other surfaces.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the agreement-layer state (`meta-disagreement`) is what this leaf renders; the entity-layer (node existence, kind, wording, edges) is rendered by `aud_cytoscape_init`. A node with `kind: null` and `rollupStatus: 'meta-disagreement'` (e.g., its classification facet was meta-disagreement-marked before any kind was committed) renders with the violet double-border and an em-dash kindLabel.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the eight-rule facet-status derivation is the source of the `'meta-disagreement'` value this leaf renders. Rule 1 ("`state.metaDisagreement` short-circuits to `'meta-disagreement'`") fires whenever a `meta-disagreement-marked` event lands. The derivation lives in the audience-side `facetStatus.ts` ported by `aud_proposed_styling` (verbatim mirror of [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts)).

### Sibling refinements

- [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md) — the foundation this leaf modifies. Decision §2 (module-scope stylesheet) and the per-state extension forwarding comment are the explicit invitation this leaf accepts.
- [`tasks/refinements/audience/aud_proposed_styling.md`](aud_proposed_styling.md) — Decision §1 (emit both `facetStatuses` and `rollupStatus`) is the data contract this leaf reads.
- [`tasks/refinements/audience/aud_agreed_styling.md`](aud_agreed_styling.md) — Decision §2 (slate-700 palette, color-only, no width-bump) is the precedent for "restrained color-only when the methodology says 'we're done'".
- [`tasks/refinements/audience/aud_disputed_styling.md`](aud_disputed_styling.md) — Decision §2 (rose-600 + `border-width: 3`, color carries on edges) is the cross-axis discipline this leaf complements: the disputed pair owns the `border-width` axis; this leaf owns the `border-style: 'double'` axis. Decision §3 (mount-time cases land inline once projection emission is in place) is the precedent this leaf repeats. Decision §5 (Playwright deferral to `aud_visual_regression`) is the routing this leaf reuses.
- [`tasks/refinements/audience/aud_stylesheet_module_extraction.md`](aud_stylesheet_module_extraction.md) — Decision §1 (extract to `./stylesheet.ts`) sites this leaf's diff there, not in `GraphView.tsx`.
- [`tasks/refinements/audience/aud_stylesheet_state_color_extraction.md`](aud_stylesheet_state_color_extraction.md) — Decision §2 (grow-as-needed; one entry per future per-state refinement) is the precedent this leaf follows when adding `metaDisagreement` to `STATE_COLORS`. Decision §3 (name = `STATE_COLORS`) and Decision §4 (tests assert against the literal hex, not `STATE_COLORS.*`) carry over verbatim.
- [`tasks/refinements/audience/aud_per_facet_visualization.md`](aud_per_facet_visualization.md) — the per-facet pill overlay that already paints the per-facet meta-disagreement detail (via `<FacetPill status="meta-disagreement">`). This leaf is paint-inside-canvas (the card-level rollup); that leaf is paint-on-top (the per-facet detail). The two compose.
- [`tasks/refinements/moderator-ui/mod_meta_disagreement_split_render.md`](../moderator-ui/mod_meta_disagreement_split_render.md) — the cross-surface precedent. Same hex (`#7c3aed`), same `border-style: 'double'` on nodes. The moderator stacks a `ring-violet-400` halo; the audience does not (Decision §2). The moderator paints edges with `strokeDasharray: '2 2'`; the audience paints edges with solid violet (Decision §2 — Cytoscape's `line-style` enum lacks a tight `2 2` analog and `line-dash-pattern` is the verbose alternative for an audience that already differentiates the meta-disagreement state via color uniquely on the canvas).

### Live code the leaf modifies

- [`apps/audience/src/graph/stylesheet.ts:100-103`](../../../apps/audience/src/graph/stylesheet.ts#L100) — `STATE_COLORS` constant. Gains one entry:
  ```ts
  export const STATE_COLORS = {
    agreed: '#334155',
    disputed: '#e11d48',
    metaDisagreement: '#7c3aed',
  } as const;
  ```
  The JSDoc above the constant (lines 74-99) gains a one-sentence note that meta-disagreement is the fourth agreement-layer state and the third entry in the constant; the cross-surface palette match with the moderator's `border-violet-600` and the participant's `'#7c3aed'` Cytoscape selector is mentioned.
- [`apps/audience/src/graph/stylesheet.ts:155-234`](../../../apps/audience/src/graph/stylesheet.ts#L155) — `STYLESHEET` constant. Two new selector entries appended after the existing `disputed` pair (which currently ends at line 233):
  ```ts
  {
    selector: "node[rollupStatus = 'meta-disagreement']",
    style: {
      'border-style': 'double',
      'border-color': STATE_COLORS.metaDisagreement,
    },
  },
  {
    selector: "edge[rollupStatus = 'meta-disagreement']",
    style: {
      'line-color': STATE_COLORS.metaDisagreement,
      'target-arrow-color': STATE_COLORS.metaDisagreement,
    },
  },
  ```
  The `STYLESHEET` JSDoc block (lines 105-154) gains one sentence noting that the meta-disagreement state is the first per-state branch to override `border-style: 'double'` (the disputed pair overrides `border-width`; the proposed pair overrides `border-style: 'dashed'` + `opacity`; meta-disagreement is the third axis claim).
- [`apps/audience/src/graph/GraphView.tsx:74-91`](../../../apps/audience/src/graph/GraphView.tsx#L74) — header refinement-trail block. Extended with a "Refinement: tasks/refinements/audience/aud_meta_disagreement_split.md" entry summarizing the decisions in the existing one-line-per-decision style.
- [`apps/audience/src/graph/GraphView.test.tsx`](../../../apps/audience/src/graph/GraphView.test.tsx) — gains 4 new Vitest cases (totalling 38 from 34); existing 34 cases continue to pass. Header refinement-trail entry added.

### What the surface MUST NOT do

- **No edit to `projectGraph.ts` / `projectGraph.test.ts`.** Projection-time `data.rollupStatus` emission already lands (per `aud_proposed_styling`); this leaf only consumes the field. The new `'meta-disagreement'` selector entries pick up automatically once any projected element's `rollupStatus` resolves to `'meta-disagreement'`.
- **No edit to `apps/audience/src/graph/facetStatus.ts` / `.test.ts`.** The facet-status derivation already produces `'meta-disagreement'` correctly via Rule 1 of `cardRollupStatus` (the short-circuit at [`L452-454`](../../../apps/audience/src/graph/facetStatus.ts#L452)); the `ROLLUP_PRIORITY` array already orders `meta-disagreement` between `proposed` and `disputed`. The derivation rules are not re-opened.
- **No edit to `apps/server/src/projection/facet-status.ts`** or to the other client mirrors (`apps/moderator/src/graph/facetStatus.ts`, `apps/participant/src/graph/facetStatus.ts`). The four-copy mirror remains in lockstep; the future `extract_facet_status_rules` task ([`tasks/27-shell-package.tji`](../../27-shell-package.tji)) consolidates.
- **No edit to `packages/shared-types/**`** — `FacetStatus` is not exported through `@a-conversa/shared-types`; the cross-workspace mirroring stays as-is.
- **No edit to `packages/shell/src/facet-pill/FacetPill.tsx`.** The per-facet pill's meta-disagreement palette already shipped via the moderator's task; the audience already consumes it via `<AudiencePerFacetPillOverlay>`.
- **No edit to `apps/audience/src/graph/PerFacetPillOverlay.tsx` / `AxiomMarkOverlay.tsx`.** The DOM-overlay layer is unchanged; this leaf is a Cytoscape-stylesheet-only change.
- **No edit to `layoutOptions.ts` / `cytoscapeTestEnv.ts` / `App.tsx` / `index.css` / `main.tsx`.** Layout, mount-environment, route, page CSS, and provider wiring are all unchanged.
- **No edit to `package.json`.** No new dependency.
- **No edit to `apps/audience/src/state/**` or `apps/audience/src/ws/**`.**
- **No edit to `apps/participant`, `apps/moderator`, `apps/root`, `apps/server`.**
- **No `node.addClass('meta-disagreement')` / `cy.elements().filter(...)` imperative styling** inside the `useEffect`. Attribute selectors driven by `data.rollupStatus` are the declarative seam; imperative class manipulation bypasses the projection's data model and breaks the "stylesheet is the source of truth" invariant set by `aud_cytoscape_init.md` Decision §2 (mirrors `aud_disputed_styling.md` Decision §4 / `aud_agreed_styling.md` Decision §4 / `aud_proposed_styling.md`).
- **No animation, transition, or `cy.animate(...)` call.** Static styling only.
- **No `:selected` / `:active` / `:hover` Cytoscape pseudo-class entries.** Audience is read-only (`autoungrabify: true` at [`apps/audience/src/graph/GraphView.tsx:245`](../../../apps/audience/src/graph/GraphView.tsx#L245)).
- **No `background-color` fill change.** Alternative — pre-tint the node fill (`#f5f3ff` violet-50) the way the participant does. Rejected per Decision §2: breaks the no-fill posture the agreed + disputed siblings established for the audience surface.
- **No `outline-color` / `outline-width` halo.** Alternative — mirror the participant's `outline-color: '#a78bfa'` + `outline-width: 2` to add a Cytoscape-native halo analogous to the moderator's `ring-violet-400`. Rejected per Decision §2: the disputed pair deliberately did not adopt Cytoscape's `outline-*` axis (chose `border-width: 3` instead, reserving outline for future axiom-mark/annotation overlays); the meta-disagreement pair preserves that posture.
- **No `line-dash-pattern` on edges.** Alternative — mirror the moderator's `strokeDasharray: '2 2'` via Cytoscape's `line-dash-pattern: [2, 2]` + `line-style: 'dashed'`. Rejected per Decision §2: the violet color uniquely identifies meta-disagreement on the audience canvas (no other state uses violet); the additional dash pattern adds visual noise without disambiguation gain, and conflicts with the proposed-state's `line-style: 'dashed'` (an edge that is both proposed and meta-disagreement at different facets — though structurally rare — would lose the disambiguation).
- **No `border-width` change.** Inherits 1px from baseline. Decision §2: `border-width` is the disputed pair's axis; meta-disagreement uses `border-style: 'double'` instead, which under CSS / Cytoscape rendering produces visually heavier strokes (two parallel lines) than a 1px solid border without competing on the width axis.
- **No new top-level named export from `stylesheet.ts`.** The new `STATE_COLORS.metaDisagreement` entry extends an existing export; the new selector entries are inline `STYLESHEET` array members.
- **No new ADR.** The meta-disagreement visual is sufficiently specified by ADR 0005 L19 + the moderator's and participant's precedents; no architectural choice rises to ADR-level (Decision §2).

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/stylesheet.ts` — MODIFIED. Two small diff hunks:
  - `STATE_COLORS` object (lines 100-103) gains one entry: `metaDisagreement: '#7c3aed'`. JSDoc above the constant gains a sentence noting the entry and the cross-surface palette match (moderator: `border-violet-600` = `#7c3aed`; participant: `#7c3aed` Cytoscape selector).
  - `STYLESHEET` array gains two entries appended after the existing `disputed` pair (which ends at line 233):

    ```ts
    {
      selector: "node[rollupStatus = 'meta-disagreement']",
      style: {
        'border-style': 'double',
        'border-color': STATE_COLORS.metaDisagreement,
      },
    },
    {
      selector: "edge[rollupStatus = 'meta-disagreement']",
      style: {
        'line-color': STATE_COLORS.metaDisagreement,
        'target-arrow-color': STATE_COLORS.metaDisagreement,
      },
    },
    ```

    `STYLESHEET` JSDoc block (lines 105-154) gains one sentence noting that the meta-disagreement node selector is the first per-state branch to override `border-style: 'double'` (proposed overrides to `'dashed'`; the disputed pair adds `border-width`; meta-disagreement claims the third style axis).

- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. Single diff hunk:
  - Header refinement-trail block (lines 1-136) gains a "Refinement: tasks/refinements/audience/aud_meta_disagreement_split.md" entry summarizing Decisions §1–§6 in the same one-line-per-decision style.

- `apps/audience/src/graph/GraphView.test.tsx` — MODIFIED. Existing 34 cases continue to pass; the file header trail entry is extended. Add 4 new Vitest cases (totalling 38):
  1. `STYLESHEET` contains an entry with `selector === "node[rollupStatus = 'meta-disagreement']"` whose `style['border-style'] === 'double'` and `style['border-color'] === '#7c3aed'` (structural). Per the established convention (`aud_stylesheet_state_color_extraction.md` Decision §4), the assertion uses the literal hex, not `STATE_COLORS.metaDisagreement`.
  2. `STYLESHEET` contains an entry with `selector === "edge[rollupStatus = 'meta-disagreement']"` whose `style['line-color'] === '#7c3aed'` and `style['target-arrow-color'] === '#7c3aed'` (structural).
  3. After projecting a session where a node's `rollupStatus` resolves to `'meta-disagreement'` and mounting `<AudienceGraphView>`, the Cytoscape instance reports the matching node's computed `border-color` as `rgb(124, 58, 237)` (the resolved violet-600 hex) AND its `border-style` as `'double'`. Asserted via `cy.getElementById('<id>').style(...)`. Border-style assertion uses string equality (Cytoscape returns the style enum verbatim).
  4. After projecting a session where an edge's `rollupStatus` resolves to `'meta-disagreement'` and mounting `<AudienceGraphView>`, the Cytoscape instance reports the matching edge's computed `line-color` as `rgb(124, 58, 237)` and `target-arrow-color` as `rgb(124, 58, 237)`. Asserted via `cy.getElementById('<id>').style(...)`.

  Cases 1+2 mirror the (ee) / (ff) pattern from `aud_disputed_styling`. Cases 3+4 mirror the (gg) / (hh) pattern from `aud_disputed_styling` and land inline here because the projection-time emission they require is already in place (shipped via `aud_proposed_styling`).

  Fixture for cases 3+4: build a minimal event log via the existing `cytoscapeTestEnv` helpers that produces one node and one edge with `rollupStatus === 'meta-disagreement'`. Concretely, the event log needs a `node-created` + a facet-targeting proposal (`classify-node` or `set-node-substance`) + a **`meta-disagreement-marked`** event with `target: 'facet'` (or with a `proposal_id` referencing the proposal) so Rule 1 of the derivation fires and the rollup short-circuits. For the edge, an `edge-created` + a `set-edge-substance` proposal + a `meta-disagreement-marked` event. The existing `aud_disputed_styling` mount-time fixtures (cases gg–hh) are the closest precedent for fixture-construction shape — substitute `dispute` votes with `meta-disagreement-marked` events.

### Files this task does NOT touch

- `apps/audience/src/graph/projectGraph.ts` — UNCHANGED.
- `apps/audience/src/graph/projectGraph.test.ts` — UNCHANGED.
- `apps/audience/src/graph/facetStatus.ts` — UNCHANGED.
- `apps/audience/src/graph/facetStatus.test.ts` — UNCHANGED.
- `apps/audience/src/graph/layoutOptions.ts` / `.test.ts` — UNCHANGED.
- `apps/audience/src/graph/cytoscapeTestEnv.ts` / `.test.ts` — UNCHANGED.
- `apps/audience/src/graph/PerFacetPillOverlay.tsx` / `.test.tsx` — UNCHANGED.
- `apps/audience/src/graph/AxiomMarkOverlay.tsx` / `.test.tsx` — UNCHANGED.
- `apps/audience/src/App.tsx` — UNCHANGED. The placeholder route stays; the component remains not-yet-reachable through any URL.
- `apps/audience/src/index.css`, `apps/audience/src/main.tsx` — UNCHANGED.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED.
- `apps/participant/**`, `apps/moderator/**`, `apps/root/**`, `apps/server/**` — UNCHANGED.
- `packages/**` — UNCHANGED. No `shared-types` widening, no token package consumed, no shell-package barrel extraction.
- `docs/adr/**` — UNCHANGED. No new ADR (Decision §2).
- `playwright.config.ts` / `tests/e2e/**` — UNCHANGED. Playwright deferral per Decision §6.
- `.tji` files — `complete 100` lands at task-completion time per the [README ritual](../README.md). Decision §1 also asks the closer to add `depends !aud_proposed_styling, !aud_disputed_styling` to this task's `.tji` entry, matching the pattern set by `aud_agreed_styling.md` Decision §1 and `aud_disputed_styling.md` Decision §1.

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/stylesheet.ts`'s `STATE_COLORS` carries a new `metaDisagreement: '#7c3aed'` entry. `STYLESHEET` carries two new entries — `node[rollupStatus = 'meta-disagreement']` (with `border-style: 'double'`, `border-color: STATE_COLORS.metaDisagreement`) and `edge[rollupStatus = 'meta-disagreement']` (with `line-color: STATE_COLORS.metaDisagreement`, `target-arrow-color: STATE_COLORS.metaDisagreement`) — appended after the existing disputed-state pair.
- All other `STYLESHEET` / `STATE_COLORS` fields are byte-identical to the post-`aud_disputed_styling` baseline; the JSDoc blocks gain prose updates per Constraints.
- `apps/audience/src/graph/GraphView.test.tsx` carries 38 cases total (34 baseline + 4 new). The 4 new cases pin the new selectors per Constraints (structural × 2 + mount-time × 2; mount-time cases land inline because the projection emission they require already shipped via `aud_proposed_styling`).
- `apps/audience/src/graph/GraphView.tsx`'s header refinement-trail block gains a one-line summary of this refinement's decisions.
- `apps/audience/package.json` is UNCHANGED — no new dependency.
- `apps/audience/src/App.tsx` is UNCHANGED. The component remains not-yet-reachable through any URL.
- Per `ORCHESTRATOR.md`'s deferred-e2e exception ("component not yet reachable"), Playwright coverage for this leaf is **deferred to `aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:455`](../../50-audience-and-broadcast.tji#L455); already inherits layout + typography + agreed-state + proposed-state + disputed-state pixel-stability work). The closer extends `aud_visual_regression`'s existing note to cover meta-disagreement-state styling (a node whose `rollupStatus === 'meta-disagreement'` renders with `border-style: 'double'` + `border-color: #7c3aed`; an edge with the same rollup renders with `line-color: #7c3aed` + `target-arrow-color: #7c3aed`; across Chrome / Firefox / WebKit at 720p / 1080p / 1440p, against the same reference fixtures the existing deferrals already pin). Decision §6 documents why this is the right destination.
- The closer adds `depends !aud_proposed_styling, !aud_disputed_styling` to the `aud_meta_disagreement_split` `.tji` block at [`tasks/50-audience-and-broadcast.tji:197-201`](../../50-audience-and-broadcast.tji#L197), formalizing the sequential ordering Decision §1 establishes. The dependency is prose-only at refinement time; the closer's ritual converts it to a `.tji` edge.
- `pnpm run check` clean (strict TS pass; no new dep declared).
- `pnpm run test:smoke` green (Vitest count rises by **4** new cases in `GraphView.test.tsx`).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is essentially zero (one new `STATE_COLORS` entry + two new selector entries with four string / hex values combined).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_meta_disagreement_split` in the same commit (the closer's ritual).
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer pins the stylesheet values, the `'meta-disagreement'` attribute-selector resolution, AND the mount-time computed-style (border-color + border-style on nodes; line-color + target-arrow-color on edges); `aud_visual_regression` will land the pixel-level rendering pin once the route is reachable.

## Decisions

### §1 — Sequential ordering: `aud_proposed_styling` + `aud_disputed_styling` shipped first; closer adds the missing `.tji` dependency edges

The `.tji` block at [`tasks/50-audience-and-broadcast.tji:197-201`](../../50-audience-and-broadcast.tji#L197) declares `aud_meta_disagreement_split` as depending only on `!aud_cytoscape_init`. As a matter of fact `aud_proposed_styling` and `aud_disputed_styling` already shipped (commits `eaf1f73` and the disputed-styling close on 2026-05-27), so the orchestrator now sees this task as eligible — but the missing edges mean that if the dependency graph were re-evaluated against an earlier state of the tree, this task could have been picked before its plumbing predecessors.

Three approaches to formalizing the dependency:

- **(A — chosen)** Declare `aud_proposed_styling` and `aud_disputed_styling` as prose-only-context dependencies in this refinement (already done above) and request the closer add `depends !aud_proposed_styling, !aud_disputed_styling` to the `aud_meta_disagreement_split` `.tji` block as part of this task's completion ritual. The disputed edge is included because this leaf relies on the four-state-priority decision the disputed sibling implicitly settled (meta-disagreement sits one priority level ABOVE disputed; the disputed sibling shipped the third per-state pair and the visual-axis discipline that this leaf complements).
- **(B)** Treat the refinement as conditional ("if `aud_proposed_styling` shipped, do X; else also do the plumbing"). Cost: refinement scope balloons; budget loses calibration. Rejected — same principled reasoning as `aud_disputed_styling.md` Decision §1.
- **(C)** Leave the `.tji` alone and rely on prose-only context. Cost: future re-planning passes mis-order. Rejected — same reasoning as the precedent.

The `.tji` effort budget here is `1d`. With the plumbing already shipped (the four-copy `facetStatus.ts`, the projection-time emission, the `STATE_COLORS` constant, the `STYLESHEET` extraction), the realistic effort drops to ~0.5d (one `STATE_COLORS` entry + two selector entries + four Vitest cases). The closer MAY revise the budget downward; this refinement does not assume the revision and does not request it.

### §2 — Visual treatment: violet-600 (`#7c3aed`) border / line, `border-style: 'double'` on nodes only, no fill / outline / opacity change

The baseline `node` selector at [`apps/audience/src/graph/stylesheet.ts:156-175`](../../../apps/audience/src/graph/stylesheet.ts#L156) ships `border-color: #cbd5e1` (slate-300, 1px width, solid); the agreed-state selector overrides `border-color` to `#334155` (slate-700, still 1px solid); the proposed-state selector overrides `border-style: 'dashed'` + `opacity: 0.6`; the disputed-state selector overrides `border-color` to `#e11d48` + `border-width: 3`. The meta-disagreement-state node selector overrides `border-color` to `#7c3aed` (violet-600) AND `border-style` to `'double'` (the first per-state branch to override `border-style: 'double'` — the proposed pair owns `'dashed'`).

The baseline `edge` selector ships `line-color: #94a3b8` (slate-400) and `target-arrow-color: #94a3b8`; the meta-disagreement-state edge selector overrides both to `#7c3aed`. No edge `line-style` override (stays solid — see below for the moderator-departure rationale).

Six design axes drove this choice:

1. **Cross-surface consistency on the color and the node-border style.** Both the moderator's [`mod_meta_disagreement_split_render.md`](../moderator-ui/mod_meta_disagreement_split_render.md) Decision §2 and the participant's `apps/participant/src/graph/GraphView.tsx:399-408` use the violet-600 (`#7c3aed`) family and the `border-double` (or `border-style: 'double'`) primitive. The audience adopts both verbatim — broadcast composites read as one show, and the "split decision" semantic maps directly from CSS / Cytoscape's two-parallel-line rendering.
2. **`border-style: 'double'` as the visual-axis claim, NOT `border-width`.** The disputed pair claimed the `border-width` axis (1px → 3px bump) to mirror the moderator's `ring-rose-500`. The meta-disagreement pair must look unambiguously different from disputed — same priority level it sits above. Cross-axis differentiation (style vs. width) keeps both signals readable when both appear on the same canvas: disputed is "thicker red line"; meta-disagreement is "two parallel violet lines". This separation also leaves the `border-width` axis available for future states or overlays (e.g., axiom-mark decoration) without overlapping with this leaf's contribution.
3. **`border-style: 'double'` renders within the 200×80 envelope without geometric impact.** CSS `border-style: double` resolves to two parallel 1px lines with a 1px gap between them, occupying a total of 3px on each side — the same effective footprint as the disputed-state's `border-width: 3` bump. The ~2.2% effective text-room loss documented for the disputed state applies here too; same margin of safety.
4. **No `background-color` fill change.** The participant's stylesheet adds `background-color: '#f5f3ff'` (violet-50) inside the meta-disagreement node selector to provide a subtle fill tint. The audience deliberately does NOT adopt this. Rationale: (a) breaks the no-fill posture established by `aud_agreed_styling` (slate-700 no-fill) and `aud_disputed_styling` (rose-600 no-fill) — the audience surface paints with borders + lines only; (b) on the broadcast surface a violet-50 fill under streaming compression can read as near-white, providing no real signal gain; (c) reserves the `background-color` axis for future committed/withdrawn states which may need fills to mark "closed but recorded" semantics.
5. **No `outline-color` + `outline-width` halo.** The participant's stylesheet adds `outline-color: '#a78bfa'` + `outline-width: 2` to mirror the moderator's `ring-violet-400`. The audience deliberately does NOT adopt this. Rationale: (a) consistency with the audience's disputed-state, which chose `border-width: 3` over Cytoscape's `outline-*` axis to mirror the moderator's `ring-rose-500` — the choice to NOT use `outline-*` for the disputed state would be undermined if meta-disagreement used it; (b) reserves the `outline-*` axis for the future axiom-mark / annotation decoration tasks (which may need a Cytoscape-native halo without competing against per-state styling); (c) the `border-style: 'double'` against an otherwise-baseline 1px violet frame is already visually heavier than the disputed-state's 3px solid frame, so the additional halo would not gain proportionally for the broadcast-density surface.
6. **Edges: solid violet, no `line-style` override.** The moderator's `mod_meta_disagreement_split_render` uses `strokeDasharray: '2 2'` (a tight dotted pattern) on edges. The audience departs and uses solid violet instead. Rationale: (a) **Cytoscape's `line-style` enum is `'solid' | 'dashed' | 'dotted'`** — none of these match `strokeDasharray: '2 2'`; the closest is `'dotted'` which renders as round dots, not a tight dash pattern. The verbose alternative is `line-style: 'dashed'` + `line-dash-pattern: [2, 2]`, but this introduces a Cytoscape extension point already claimed by the proposed-state's `line-style: 'dashed'` — an edge that is both proposed and meta-disagreement at different facets (rare but possible during a rapid-fire moderator workflow) would lose disambiguation; (b) the violet color alone is unique on the audience canvas — no other state uses violet — and uniquely identifies meta-disagreement edges without a dash pattern; (c) the moderator's dotted pattern adds disambiguation against rose-600 dotted (none, since disputed is solid) and slate-700 (agreed, solid) — but in the moderator's denser canvas the dash pattern is a useful secondary signal; on the broadcast surface the cleaner solid stroke reads better under compression. The participant ships the same solid-violet edge approach (per [`apps/participant/src/graph/GraphView.tsx:460-467`](../../../apps/participant/src/graph/GraphView.tsx#L460)) for the same reasons, providing the closer technological precedent.

Alternatives surfaced and rejected:

- **Stack `border-style: 'double'` + `border-width: 3` (the canvas analogue of the moderator's `border-double` + `ring-2`).** Rejected — the `border-width: 3` axis is already owned by the disputed state; using it here would erase the cross-axis differentiation. The double-border alone, against an otherwise-1px frame and a strong violet hue, already reads as heavier than a 1px solid frame.
- **Adopt the participant's `outline-color` + `outline-width` halo.** Rejected per axis (5) above — the audience reserved `outline-*` for future overlays; consistency with the disputed-state choice matters.
- **Adopt the participant's `background-color: '#f5f3ff'` fill tint.** Rejected per axis (4) above — breaks the audience's no-fill posture.
- **Adopt the moderator's `line-dash-pattern: [2, 2]` on edges.** Rejected per axis (6) above — overlaps with proposed-state's `line-style: 'dashed'` and adds noise without disambiguation gain for the broadcast surface.
- **Different violet (`indigo-600 #4f46e5`, `purple-700 #7e22ce`, etc.).** Rejected — cross-surface palette match with the moderator + participant is the stronger force; violet-600 (`#7c3aed`) is the pinned value.

No new ADR is required. The visual specification is already in ADR 0005 L19 ("meta-disagreement split"); the moderator's and participant's tasks already settled the specific hex; this leaf adopts both and translates the visual axes into Cytoscape primitives.

### §3 — Add `metaDisagreement` to `STATE_COLORS`; grow-as-needed, no speculative slots

[`aud_stylesheet_state_color_extraction.md`](aud_stylesheet_state_color_extraction.md) Decision §2 established the posture: one `STATE_COLORS` entry per per-state refinement that differentiates on color (proposed has no entry because it differentiates on `border-style`/`opacity` only). Meta-disagreement differentiates on color (`#7c3aed`) AND on `border-style: 'double'` — it gets a `STATE_COLORS` entry for the color part. Future committed / withdrawn / awaiting-proposal entries materialize when their respective per-state refinements land.

Three approaches considered:

- **(A — chosen)** Add `metaDisagreement: '#7c3aed'` to `STATE_COLORS` and reference it from both the node and edge selector entries.
- **(B)** Inline the hex literal at each call site (skip the `STATE_COLORS` entry). Rejected — breaks the convention established by `aud_stylesheet_state_color_extraction`; the convention exists precisely so future per-state refinements have a uniform extension point.
- **(C)** Restructure `STATE_COLORS` to nest `{ border: '#7c3aed', outline: '#a78bfa', background: '#f5f3ff' }` per state to anticipate the participant's richer palette. Rejected — speculative for the audience; the audience's per-state contributions today need only the single color, and the nested shape would force the agreed / disputed entries to grow nominal `border` keys for no value. Grow-as-needed.

The naming choice (`metaDisagreement` camelCase) follows the JavaScript object-key convention used by the existing entries (`agreed`, `disputed` are single words; `metaDisagreement` matches the camelCase boundary). The wire-side string remains hyphenated (`'meta-disagreement'`) per ADR 0030 — that is the FacetStatus enum value Cytoscape's attribute selectors match on.

### §4 — Mount-time cases land inline; no follow-up `aud_meta_disagreement_split_mount_assertions` task

Same posture as `aud_disputed_styling.md` Decision §3 — the projection-time `data.rollupStatus` emission is already in place (shipped via `aud_proposed_styling`), so the mount-time cases for the meta-disagreement state can land in this leaf's commit without a sequencing blocker. A fixture event log that produces a meta-disagreement-state element is straightforward: a `node-created` + a facet-targeting proposal + a `meta-disagreement-marked` event — Rule 1 of `cardRollupStatus` short-circuits immediately.

Three approaches considered:

- **(A — chosen)** Land all four cases (2 structural + 2 mount-time) inline. Cost: ~0.25d of fixture-construction inside this leaf's budget. Benefit: no tech-debt registration; the leaf is self-contained.
- **(B)** Mirror `aud_agreed_styling`'s historical deferral pattern and split mount-time cases into a follow-up task. Rejected — the deferral was a sequencing-constraint accommodation that no longer applies.
- **(C)** Land only the mount-time cases (subsume structural). Rejected — structural cases pin the stylesheet shape directly (no Cytoscape mount) and catch regression modes (selector-string mangling, accidental entry deletion) that mount-time cases would miss.

### §5 — Selector via attribute equality, not Cytoscape's `.class` API

Same posture as `aud_disputed_styling.md` Decision §4, `aud_agreed_styling.md` Decision §4, and `aud_proposed_styling.md`. The meta-disagreement-state selector uses `node[rollupStatus = 'meta-disagreement']` / `edge[rollupStatus = 'meta-disagreement']` attribute equality against the data field that `projectGraph` emits. Imperative `cy.elements().forEach(el => el.toggleClass('meta-disagreement', …))` and hybrid `classes: 'meta-disagreement'` approaches both introduce drift risk between data and class state for no benefit; attribute selectors match Cytoscape's natural data-driven seam.

Rejected alternatives are documented at length in the predecessor refinements; not re-litigated here.

### §6 — Playwright deferral lands on `aud_visual_regression`, NOT `aud_session_url`

Per `ORCHESTRATOR.md`'s deferred-e2e exception: this leaf modifies the Cytoscape stylesheet inside an audience-surface region still not reachable through any user-flow route ([`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) still maps every path to the placeholder; the per-session route lands in `aud_url_routing.aud_session_url`). The meta-disagreement-state visual is invisible until that route ships.

`aud_session_url`'s inherited deferred-e2e debt is well past the "2+ refinements, pay down" threshold flagged by `ORCHESTRATOR.md` (the four predecessor styling refinements + the per-facet-pill + the axiom-mark overlay all already routed pixel-stability to `aud_visual_regression`). Adding the meta-disagreement pixel-stability to `aud_session_url` would compound the planning-debt time bomb without architectural gain.

`aud_visual_regression` (2d, [`tasks/50-audience-and-broadcast.tji:455`](../../50-audience-and-broadcast.tji#L455)) is the dedicated pixel-comparison task that already inherits the four state-styling deferrals' work; meta-disagreement pixel-stability is the same kind of "the rendered pixels match across runs" assertion and follows the same routing.

The closer extends `aud_visual_regression`'s existing note to also cover meta-disagreement-state styling — a node whose `rollupStatus === 'meta-disagreement'` renders with `border-style: 'double'` + `border-color: #7c3aed` (and inherited `border-width: 1`, baseline width); an edge with the same rollup renders with `line-color: #7c3aed` + `target-arrow-color: #7c3aed` (solid, baseline width) — across Chrome / Firefox / WebKit at 720p / 1080p / 1440p, against the same reference fixtures the layout / typography / agreed / proposed / disputed deferrals already pin.

The meta-disagreement-state stylesheet correctness, the projection-time `data.rollupStatus === 'meta-disagreement'` resolution, AND the mount-time computed-style resolution are fully pinned at the Vitest layer above — `aud_visual_regression` is for the *visible* rendering, not the stylesheet shape.

Rejected alternatives (defer to `aud_session_url`, register `aud_pw_state_styling_smoke`, scope an inline placeholder-route spec) are documented at length in `aud_proposed_styling.md` Decision §6 / `aud_disputed_styling.md` Decision §5 and not re-litigated here.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-28.

- `apps/audience/src/graph/stylesheet.ts` — `STATE_COLORS` extended with `metaDisagreement: '#7c3aed'` (violet-600); `STYLESHEET` gains two new selector entries: `node[rollupStatus = 'meta-disagreement']` (`border-style: 'double'`, `border-color: STATE_COLORS.metaDisagreement`) and `edge[rollupStatus = 'meta-disagreement']` (`line-color: STATE_COLORS.metaDisagreement`, `target-arrow-color: STATE_COLORS.metaDisagreement`) appended after the disputed-state pair; JSDoc updated.
- `apps/audience/src/graph/GraphView.tsx` — header refinement-trail block extended with the `aud_meta_disagreement_split` entry summarising Decisions §1–§6.
- `apps/audience/src/graph/GraphView.test.tsx` — header trail extended; new `metaDisagreementFacetEvent` helper added; 4 new Vitest cases land (oo–rr): `(oo)` STYLESHEET structural — node selector has `border-style: 'double'` + `border-color: '#7c3aed'`; `(pp)` STYLESHEET structural — edge selector has `line-color: '#7c3aed'` + `target-arrow-color: '#7c3aed'`; `(qq)` mount-time — node whose `rollupStatus === 'meta-disagreement'` carries computed `border-color: rgb(124, 58, 237)` + `border-style: 'double'`; `(rr)` mount-time — edge whose `rollupStatus === 'meta-disagreement'` carries computed `line-color: rgb(124, 58, 237)` + `target-arrow-color: rgb(124, 58, 237)`. Total Vitest case count rises from 34 (post-`aud_axiom_mark_decoration`) to 38.
- Fourth (final) agreement-layer state for the audience Cytoscape canvas shipped — meta-disagreement nodes/edges paint violet-600 with `border-style: 'double'` on nodes and solid violet stroke on edges; `STATE_COLORS` now carries three entries (agreed, disputed, metaDisagreement).
- Playwright pixel-stability deferred to `aud_visual_regression` per Decision §6; `aud_visual_regression` note extended to cover meta-disagreement-state styling.
- `tasks/50-audience-and-broadcast.tji` — `aud_meta_disagreement_split` marked `complete 100`; missing `depends !aud_proposed_styling, !aud_disputed_styling` edges added per Decision §1 Acceptance criteria.
- Tech-debt follow-up: none.
