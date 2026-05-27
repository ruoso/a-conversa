# Audience proposed-state styling (dashed border, faded fill for in-flight entities on the broadcast surface)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_graph_rendering.aud_proposed_styling` (lines 116-120).
**Effort estimate**: 1d
**Inherited dependencies**:

- `!audience.aud_graph_rendering.aud_cytoscape_init` (settled — shipped 2026-05-27, `complete 100` at [`tasks/50-audience-and-broadcast.tji:90`](../../50-audience-and-broadcast.tji#L90)). The viewport this leaf extends: the one-shot `cytoscape({ ... })` mount inside `<div data-testid="audience-graph-root">` at [`apps/audience/src/graph/GraphView.tsx:214`](../../../apps/audience/src/graph/GraphView.tsx#L214); the module-scope `STYLESHEET` at [`apps/audience/src/graph/GraphView.tsx:150-201`](../../../apps/audience/src/graph/GraphView.tsx#L150) is the seam this leaf extends with the first per-state selector pair. The header comment at [`apps/audience/src/graph/GraphView.tsx:120-125`](../../../apps/audience/src/graph/GraphView.tsx#L120) explicitly forwarded per-facet styling to "sibling tasks (`aud_proposed_styling`, `aud_axiom_mark_decoration`, `aud_annotation_rendering`, …) that extend this stylesheet in their own commits" — this leaf is the named sibling.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_layout_engine` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_layout_engine.md`](aud_layout_engine.md)). Geometry is unchanged; the 200×80 node box + 180px text-max-width is the size envelope this leaf renders inside.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_clean_typography` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_clean_typography.md`](aud_clean_typography.md)). Typography is unchanged; proposed-state nodes / edges inherit `font-family` / `font-size` / `font-weight` from the baseline `node` / `edge` selectors per Cytoscape's per-selector resolution.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_agreed_styling` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_agreed_styling.md`](aud_agreed_styling.md)). The agreed-state refinement was authored under the assumption that **this** leaf would ship first and pay the plumbing cost — its Decision §1 declared `aud_proposed_styling` as a prose-only-context dependency and asked the closer to add `depends !aud_proposed_styling` to the `aud_agreed_styling` `.tji` entry (`tasks/50-audience-and-broadcast.tji:120-135` shows it landed). Two mount-time assertions deferred from `aud_agreed_styling` to the tech-debt task `aud_agreed_styling_mount_assertions` (0.25d, [`tasks/50-audience-and-broadcast.tji:162-174`](../../50-audience-and-broadcast.tji#L162)) are unblocked the moment this leaf lands the projection-time `data.rollupStatus` emission. The orchestrator picks this task **before** `aud_agreed_styling_mount_assertions` regardless because the latter explicitly `depends !aud_proposed_styling`.
- Prose-only context (NOT a `.tji` edge): `participant_ui.part_graph_rendering.pf_projection_facet_status_refactor` (settled — landed [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts), the participant client mirror). The participant's header trail at [`apps/participant/src/graph/facetStatus.ts:1-27`](../../../apps/participant/src/graph/facetStatus.ts#L1) explicitly names the audience as the future fourth copy ("extract to `@a-conversa/shell` when the third caller (audience) materialises" — though the participant counted itself as the third caller; this leaf is in fact the fourth copy across workspaces). The participant's port is the closest line-by-line precedent: it is more recent than the moderator's and carries the post-`pf_*` refactor cleanups (the seven derivation rules, the `awaiting-proposal` sentinel per ADR 0030 §10, the four `FacetName` values including `shape`, the `EMPTY_FACET_STATUSES` frozen reference).

## What this task is

The 1d leaf that lands the **proposed-state visual** on the audience's Cytoscape canvas — nodes and edges whose card-level rollup is `'proposed'` (any facet is still being voted on) get a dashed border + faded fill that reads as "in flight" against the baseline solid-slate render, distinct from both the baseline ("nothing has happened here yet") and from the agreed-state (solid darker-slate, [`aud_agreed_styling`](aud_agreed_styling.md)) visual.

Because the audience workspace has no per-facet derivation today, this leaf is the **heavy-plumbing** sibling: it ports the facet-status engine into the audience, threads the projection through it, and lands the first per-rollup selector pair against the freshly-emitted `data.rollupStatus` attribute. Subsequent state-styling leaves (`aud_agreed_styling`, already shipped against this assumption; `aud_disputed_styling`, `aud_meta_disagreement_split`) are thin selector extensions on top.

After this leaf:

- A new file `apps/audience/src/graph/facetStatus.ts` lands as the **fourth** copy across workspaces (after the server canonical [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts), the moderator client mirror [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts), and the participant client mirror [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts)). Verbatim port of the participant's — same exports (`FacetStatus`, `FacetName`, `FacetStatusIndex`, `EMPTY_FACET_STATUSES`, `ROLLUP_PRIORITY`, `computeFacetStatuses`, `cardRollupStatus`), same eight derivation rules, same single-pass walk. The header trail names all four copies and re-asserts the lockstep requirement.
- A new file `apps/audience/src/graph/facetStatus.test.ts` lands the regression cases for the ported derivation. Same shape as the moderator's 18 cases / participant's broader suite; the test file pins the derivation against the same fixtures.
- `apps/audience/src/graph/projectGraph.ts` extends `AudienceNodeData` / `AudienceEdgeData` with `facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>` and `rollupStatus: FacetStatus | 'none'`. The `projectGraph` signature changes to `projectGraph(events): { nodes, edges }` calling `computeFacetStatuses(events)` once up-front and reading `index.nodes.get(id) ?? EMPTY_FACET_STATUSES` / `index.edges.get(id) ?? EMPTY_FACET_STATUSES` to stamp both fields onto every emitted descriptor. The `'none'` sentinel covers the empty-record case so Cytoscape's `[rollupStatus = '<state>']` selectors have a stable string to match on (per [`apps/participant/src/graph/projectGraph.ts:130-137`](../../../apps/participant/src/graph/projectGraph.ts#L130) precedent — `undefined` would not match an attribute-equality selector).
- `apps/audience/src/graph/projectGraph.test.ts` gains new cases pinning that the projection populates `facetStatuses` + `rollupStatus` correctly per event log (proposed / agreed / committed / etc.), and that the `'none'` sentinel lands when no facet-targeting event references the entity.
- Two new selector entries land in `STYLESHEET` at [`apps/audience/src/graph/GraphView.tsx:150-201`](../../../apps/audience/src/graph/GraphView.tsx#L150) — `node[rollupStatus = 'proposed']` (overriding `border-style: 'dashed'` + `opacity: 0.6`) and `edge[rollupStatus = 'proposed']` (overriding `line-style: 'dashed'` + `opacity: 0.6`). Each entry overrides only the properties that differentiate the proposed state; typography, geometry, label, shape, background, text-background, and border-/line-color fields all inherit from the baseline `node` / `edge` selectors via Cytoscape's per-selector composition.
- New Vitest cases land in `apps/audience/src/graph/GraphView.test.tsx` (structural + mount-time) pinning the new selector entries and that an element whose projection emitted `data.rollupStatus === 'proposed'` actually carries the proposed-state computed style after one render tick.

Out of scope (deferred to existing or future leaves):

- **Per-facet state visualization (single node subdivided into per-facet visual slices).** Owned by `aud_per_facet_visualization` (2d, [`tasks/50-audience-and-broadcast.tji:157-161`](../../50-audience-and-broadcast.tji#L157)), which `depends !aud_proposed_styling, !aud_agreed_styling, !aud_disputed_styling`. The card-level rollup this leaf colors is the conservative default; the per-facet view is the upgrade. The `facetStatuses` field this leaf stamps onto every element is the data carrier the future per-facet task reads — emitting it now (alongside `rollupStatus`) means the per-facet task is a stylesheet-and-overlay leaf, not a re-projection leaf.
- **Disputed / meta-disagreement / withdrawn / committed / awaiting-proposal visuals.** Owned by `aud_disputed_styling` ([`tasks/50-audience-and-broadcast.tji:137-141`](../../50-audience-and-broadcast.tji#L137)), `aud_meta_disagreement_split` ([`tasks/50-audience-and-broadcast.tji:142-146`](../../50-audience-and-broadcast.tji#L142)), and (closer- or maintainer-registered) future leaves. Each adds its own `node[rollupStatus = '<state>']` / `edge[rollupStatus = '<state>']` entries against the same `STYLESHEET`; this leaf does NOT pre-emptively scope them.
- **The proposed → agreed transition animation.** Owned by `aud_proposed_to_agreed_animation` (1d, [`tasks/50-audience-and-broadcast.tji:197-200`](../../50-audience-and-broadcast.tji#L197) under the `aud_animations.*` group). This leaf ships only the static visual; the transition animation reads the same `data.rollupStatus` field on its own commit and tweens dash-array / opacity / color across the proposed → agreed change.
- **Extraction of `facetStatus.ts` into `@a-conversa/shell`.** The participant's header trail flagged this as the trigger once "the third caller (audience) materialises" — by that count this leaf is the trigger. Decision §5 below documents why the extraction is deferred to a named-future task (`shell_facet_status_extraction`, ~0.5d) rather than landed inline: extracting mid-stream costs the heavy-plumbing leaf two file moves + four import-path rewrites + a new shell-package barrel export and pushes the audience surface's TypeScript strict-mode dependency graph through the `shell` package (which is already on the participant's + moderator's + audience's import paths today), which risks circular-import regressions the implementer would have to chase. Landing the fourth verbatim copy keeps this leaf tight; the extraction task lands the move with no behavioural change.
- **Color tokens extracted to `packages/ui-tokens`.** Per ADR 0005's "Workspace realization deferred" consequence and [`aud_clean_typography.md`](aud_clean_typography.md) Decision §5 + [`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §3, the token workspace has not yet materialized; the dash-style + opacity values land inline in `STYLESHEET` and will migrate whenever the workspace ships. Same posture the moderator + participant surfaces take.
- **A Playwright spec exercising the proposed-state styling.** Per the deferred-e2e exception (`ORCHESTRATOR.md` UI-stream e2e policy): the component this leaf restyles is still not reachable through any user-flow route — the wildcard at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) still maps every path to the placeholder; the per-session route lands in `aud_url_routing.aud_session_url`. Full deferral applies; Decision §6 places it on `aud_visual_regression`, the same destination the layout / typography / agreed-state pixel-stability deferrals route to.

## Why it needs to be done

The `m_audience_mvp` milestone in [`tasks/99-milestones.tji`](../../99-milestones.tji) names the entire `aud_graph_rendering` group transitively. The audience surface's reason to exist is broadcast-output to OBS, and on a broadcast surface the **first-most informative cue** (after the entity / edge being on the canvas at all) is the in-flight signal — viewers need a glance-level signal that distinguishes "we're still debating this" from "we've all agreed on this" or "this is committed". Every new facet starts in `'proposed'` and stays there until a vote / commit happens, so without this leaf every entity on the audience canvas reads as if its facets had already settled — which is not the live state of the conversation.

Concretely:

- **`aud_agreed_styling` is already in the tree but its full coverage is blocked on this leaf.** Two of the four Vitest cases scoped by `aud_agreed_styling.md` (cases 3 + 4 — mount-time `cy.getElementById(id).style('border-color') === 'rgb(51, 65, 85)'`) deferred to the tech-debt task `aud_agreed_styling_mount_assertions` (0.25d, [`tasks/50-audience-and-broadcast.tji:162-174`](../../50-audience-and-broadcast.tji#L162)) because they require `data.rollupStatus === 'agreed'` to actually appear on a projected element — and the projection-time emission is this leaf's scope. Landing this leaf unblocks that task: it becomes a pure test-only follow-up that adds two cases to `GraphView.test.tsx`.
- **`aud_disputed_styling` / `aud_meta_disagreement_split`** extend the same `STYLESHEET` with their own per-rollup selectors. The `data.rollupStatus` projection field, the `FacetStatusIndex`, the `ROLLUP_PRIORITY` array, and `cardRollupStatus` all land here; the disputed / meta-disagreement-split leaves are the third + fourth selector groups. Once three sibling tasks layer per-state selectors on the file, the named-future-task `aud_stylesheet_module_extraction` (~0.25d, registered by [`aud_clean_typography.md`](aud_clean_typography.md) Decision §4) fires.
- **`aud_per_facet_visualization`** (2d, [`tasks/50-audience-and-broadcast.tji:157-161`](../../50-audience-and-broadcast.tji#L157)) subdivides a single node into per-facet visual slices once all three baseline state styles (proposed / agreed / disputed) ship. The card-level rollup this leaf colors is the conservative default; the per-facet view reads the same `data.facetStatuses` field this leaf also stamps onto every element.
- **`aud_proposed_to_agreed_animation`** (1d, [`tasks/50-audience-and-broadcast.tji:197-200`](../../50-audience-and-broadcast.tji#L197)) animates the transition from dashed-and-faded to solid-and-darker. Without this leaf's static visual the animation has no source state to animate from.
- **`aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:318-347`](../../50-audience-and-broadcast.tji#L318)) is the pixel-comparison task that already inherits typography + layout + agreed-state pixel-stability deferrals; proposed-state pixel-stability deferred here (Decision §6) follows the same routing.

Architecturally, this leaf mirrors the moderator's `mod_proposed_state_styling` (shipped 2026-05-11, see [`tasks/refinements/moderator-ui/mod_proposed_state_styling.md`](../moderator-ui/mod_proposed_state_styling.md) Status block) but renders into a Cytoscape stylesheet rather than Tailwind classes on a ReactFlow custom node. The moderator uses `border-dashed opacity-60` on the `<StatementNode>` React component with `data-facet-status="proposed"` as the stable seam; the audience uses `node[rollupStatus = 'proposed']` selector → `'border-style': 'dashed'` + `opacity: 0.6` inside Cytoscape's `style:` object. Same visual contract (dashed + faded, the CAD/diagram convention for "tentative"), different rendering tech. The participant's `pf_projection_facet_status_refactor` lineage is the line-by-line port for the derivation engine; the moderator's `mod_proposed_state_styling` is the cross-surface precedent for the stylesheet branch.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience uses Cytoscape's stylesheet for all rendering; per-state visuals must be expressed as selector entries in `STYLESHEET`, not as CSS classes / inline styles on a DOM ancestor (Cytoscape paints to canvas with its own per-selector resolution; CSS cascade does not cross the canvas boundary).
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the per-facet state visual contract is documented at L19 ("proposed dashed/faded, agreed solid, disputed marker, meta-disagreement split"). The "dashed/faded" treatment is the explicit visual specification this leaf realizes.
- [ADR 0021 — Event envelope discriminated union](../../../docs/adr/0021-event-envelope-discriminated-union.md) — the projection's narrowing across event kinds is load-bearing for both the existing `projectGraph` walk and the new `computeFacetStatuses` walk. Both consume the same `Event[]` input under the same discriminator.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the Vitest cases below ARE the regression coverage; no "I ran the audience locally and the proposed-state node was visibly dashed" smoke. The visible-rendering pin lands in `aud_visual_regression` (Decision §6).
- [ADR 0024 — Frontend i18n: react-i18next + ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — orthogonal but worth naming: state styling is locale-independent; the same selector / dash-style fires for every locale. No new i18n keys.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — orthogonal but worth naming: the audience surface is a mounted library; the new STYLESHEET entries + the new `facetStatus.ts` ship as part of the audience artifact and do not bleed into other surfaces.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the agreement-layer state (`proposed`) is what this leaf renders; the entity-layer (node existence, kind, wording, edges) is rendered by `aud_cytoscape_init`. The two layers do not bleed: a node may exist with `kind: null` and `rollupStatus: 'proposed'` if its classification has been proposed but no facet has resolved.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the eight-rule facet-status derivation is the source of the `'proposed'` value this leaf renders. The audience port mirrors the participant's verbatim implementation of the rule set, including the `awaiting-proposal` sentinel (§10) and the seven `FacetStatus` values.

### Sibling refinements

- [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md) — the foundation this leaf modifies. Decision §2 (module-scope stylesheet) and the "Per-facet styling … plug in via sibling tasks" forwarding comment at [`GraphView.tsx:120-125`](../../../apps/audience/src/graph/GraphView.tsx#L120) are the explicit invitation this leaf accepts.
- [`tasks/refinements/audience/aud_agreed_styling.md`](aud_agreed_styling.md) — the sibling that shipped first under the assumption this leaf would land the plumbing. Decision §1 there established the sequential-ordering contract; Decision §2 there established the slate-700-for-agreed cross-surface color; Decision §4 there established the attribute-equality-selector pattern this leaf follows for `'proposed'`. The mount-time cases deferred there will land in `aud_agreed_styling_mount_assertions` once this leaf ships.
- [`tasks/refinements/audience/aud_layout_engine.md`](aud_layout_engine.md) — Decision §3 (one-shot fit on first non-empty render) + Decision §4 (broadcast-tuned spacing constants) constrain the geometry this leaf renders inside. The 200×80 node box stays unchanged; the proposed-state opacity reduction does not affect layout.
- [`tasks/refinements/audience/aud_clean_typography.md`](aud_clean_typography.md) — Decision §5 (font-family on both node and edge selectors) is the precedent for "per-selector inheritance, no `core`-cascade reliance." The proposed-state selectors below follow the same posture: override only the differentiator, let the rest inherit.
- [`tasks/refinements/moderator-ui/mod_proposed_state_styling.md`](../moderator-ui/mod_proposed_state_styling.md) — the cross-surface precedent. Same task name, same 1d effort, same "heavy plumbing in this leaf, thin selector extensions in the next" shape, same dashed + 60%-opacity visual contract. Cross-surface visual choice carries verbatim per Decision §2 below; the rendering-tech translation (Tailwind class → Cytoscape selector style field) is the only divergence.
- [`tasks/refinements/per-facet-refactor/pf_projection_facet_status_refactor.md`](../per-facet-refactor/pf_projection_facet_status_refactor.md) — the canonical per-facet refactor that landed the participant's mirror. The participant port is the line-by-line precedent this leaf re-applies.

### Live code the leaf modifies / creates

- [`apps/audience/src/graph/GraphView.tsx:1-79`](../../../apps/audience/src/graph/GraphView.tsx#L1) — the header refinement-trail block. Extended with a one-line-per-decision summary of this refinement, matching the existing entries for the four shipped audience refinements.
- [`apps/audience/src/graph/GraphView.tsx:108-149`](../../../apps/audience/src/graph/GraphView.tsx#L108) — the `STYLESHEET` JSDoc block. The existing paragraph at [`L137-139`](../../../apps/audience/src/graph/GraphView.tsx#L137) ("The `data.rollupStatus` attribute the selectors key on is emitted by `projectGraph` once `aud_proposed_styling` ships …") is replaced with one stating that emission now lands; the per-state extension paragraph is unchanged.
- [`apps/audience/src/graph/GraphView.tsx:150-201`](../../../apps/audience/src/graph/GraphView.tsx#L150) — the `STYLESHEET` constant. Two new selector entries appended after the existing `agreed` pair:
  - `{ selector: "node[rollupStatus = 'proposed']", style: { 'border-style': 'dashed', opacity: 0.6 } }`
  - `{ selector: "edge[rollupStatus = 'proposed']", style: { 'line-style': 'dashed', opacity: 0.6 } }`
- [`apps/audience/src/graph/projectGraph.ts:47-69`](../../../apps/audience/src/graph/projectGraph.ts#L47) — `AudienceNodeData` + `AudienceEdgeData` interfaces. Extended with `facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>` and `rollupStatus: FacetStatus | 'none'`.
- [`apps/audience/src/graph/projectGraph.ts:110-205`](../../../apps/audience/src/graph/projectGraph.ts#L110) — `projectGraph` body. The single-pass walk is augmented: `computeFacetStatuses(events)` runs once up-front; each `node-created` and `edge-created` branch reads the matching index entry (or `EMPTY_FACET_STATUSES`) and computes `cardRollupStatus(record) ?? 'none'` before pushing the element. Pattern lifted from [`apps/participant/src/graph/projectGraph.ts:473-523`](../../../apps/participant/src/graph/projectGraph.ts#L473).
- `apps/audience/src/graph/facetStatus.ts` — **NEW**. Verbatim port of [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts). Same exports, same derivation rules, same `EMPTY_FACET_STATUSES` + `ROLLUP_PRIORITY` constants. Header trail names all four copies and re-asserts the lockstep requirement.
- `apps/audience/src/graph/facetStatus.test.ts` — **NEW**. Vitest case port of [`apps/participant/src/graph/facetStatus.test.ts`](../../../apps/participant/src/graph/facetStatus.test.ts). The participant suite is the closest in scope; the moderator's 18-case suite is also valid coverage. The audience suite mirrors the participant's cases verbatim to keep the lockstep-mirroring trail unambiguous — if the participant's cases pass, the audience's must too.
- [`apps/audience/src/graph/projectGraph.test.ts`](../../../apps/audience/src/graph/projectGraph.test.ts) — gains new cases pinning that `data.facetStatuses` + `data.rollupStatus` land on every emitted descriptor with the right values across the agreement-layer states.
- [`apps/audience/src/graph/GraphView.test.tsx`](../../../apps/audience/src/graph/GraphView.test.tsx) — gains structural Vitest cases for the new selector entries (mirrors the (w) + (x) cases the `aud_agreed_styling` leaf landed at [`L24-34`](../../../apps/audience/src/graph/GraphView.test.tsx#L24)) and mount-time cases that pin the computed style after a render tick.

### What the surface MUST NOT do

- **No edit to `apps/server/src/projection/facet-status.ts`.** The server's canonical derivation stays put; this leaf ports it client-side. If the server's rule set widens, all four mirrors update in lockstep — the audience port is now the fourth obligation, not the seed for a new rule.
- **No edit to `apps/moderator/src/graph/facetStatus.ts` or `apps/participant/src/graph/facetStatus.ts`.** The two existing client mirrors are unchanged; this leaf adds a third client mirror (fourth copy across workspaces) without touching the others. The future `shell_facet_status_extraction` task will consolidate; this leaf does not.
- **No edit to `packages/shared-types/**`.** `FacetStatus` is not exported through `@a-conversa/shared-types` today (see moderator refinement Decision); this leaf does not widen `shared-types` either. The cross-workspace mirroring is the documented seam the future extraction task replaces.
- **No edit to `layoutOptions.ts` / `cytoscapeTestEnv.ts` / `App.tsx` / `index.css` / `main.tsx`.** Layout, mount-environment, route, page CSS, and provider wiring are all unchanged. The visible change is entirely inside `STYLESHEET` + `projectGraph`'s emitted data.
- **No edit to `package.json`.** No new dependency. The port consumes only `@a-conversa/shared-types` types and `cytoscape`'s `StylesheetJson` — both already present.
- **No edit to `apps/audience/src/state/**` or `apps/audience/src/ws/**`.** The projection consumes the existing event log from `useAudienceSession()`; the WS / state layer is untouched.
- **No edit to `apps/participant`, `apps/moderator`, `apps/root`, `apps/server`.**
- **No `node.addClass('proposed')` / `cy.elements().filter(...)` imperative styling** inside the `useEffect`. Cytoscape selectors driven by `data.rollupStatus` are the declarative seam; imperative class manipulation bypasses the projection's data model and breaks the "stylesheet is the source of truth" invariant set by [`aud_cytoscape_init.md`](aud_cytoscape_init.md) Decision §2. (Mirrors [`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §4.)
- **No animation, transition, or `cy.animate(...)` call.** Static styling only; the proposed → agreed transition animation is `aud_proposed_to_agreed_animation`'s scope.
- **No `:selected` / `:active` / `:hover` Cytoscape pseudo-class entries.** The audience is read-only by construction (`autoungrabify: true` at [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx#L214)); pseudo-class state styling would imply interactive affordances the audience does not have.
- **No card-level shape / size / position change.** Color-only-and-dash-style differentiation (mirrors [`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §2: color-only, no width bump). The proposed-state stays inside the 200×80 box.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/facetStatus.ts` — **NEW**. Verbatim port of the participant's file. Module exports: `FacetStatus` (type, 7 values), `FacetName` (type, 4 values: `'classification' | 'substance' | 'wording' | 'shape'`), `FacetStatusIndex` (interface, `{ nodes: ReadonlyMap<…>, edges: ReadonlyMap<…> }`), `EMPTY_FACET_STATUSES` (frozen empty record), `ROLLUP_PRIORITY` (readonly array, `['proposed', 'meta-disagreement', 'disputed', 'agreed', 'committed', 'withdrawn', 'awaiting-proposal']`), `computeFacetStatuses(events)`, `cardRollupStatus(facetStatuses)`. Header trail (lines 1-30 or so) names all four copies (server canonical + moderator + participant + this file) and re-asserts the lockstep requirement plus the future `shell_facet_status_extraction` (Decision §5).

- `apps/audience/src/graph/facetStatus.test.ts` — **NEW**. Vitest suite port of the participant's. The full participant case set should land; minimum coverage:
  - Empty event log returns empty maps.
  - The four agreement-layer states (`proposed`, `agreed`, `disputed`, `meta-disagreement`) — one case per derivation rule, each isolating that rule's input.
  - The two committed-layer states (`committed`, `withdrawn`).
  - The empty-state `awaiting-proposal` per ADR 0030 §10.
  - Current-participants filtering: left-participant's vote is excluded; joined-then-left participants don't count toward "all current participants agreed".
  - Facet routing per proposal sub-kind (one case per: `classify-node` → classification, `set-node-substance` → substance, `set-edge-substance` → edge substance, `edit-wording.reword` → wording, plus the `shape` facet per the participant's `pf_part_facet_name_widen_shape` precedent).
  - Out-of-scope sub-kinds (`decompose`, `axiom-mark`, `meta-move`, `break-edge`, `annotate`, `interpretive-split`) produce no facet entry on the parent entity.
  - Multi-facet independence on one entity (one node carries independent statuses on classification + substance).
  - `cardRollupStatus` precedence cases — `proposed` beats `agreed` beats `committed` per `ROLLUP_PRIORITY`.

- `apps/audience/src/graph/projectGraph.ts` — MODIFIED. Three diff regions:
  - The header refinement-trail block (lines 1-35) gains a "Refinement: tasks/refinements/audience/aud_proposed_styling.md" entry summarizing Decision §1 (data shape: emit both `facetStatuses` and `rollupStatus`) and Decision §4 (the `'none'` sentinel rather than `undefined`).
  - `AudienceNodeData` (lines 47-54) and `AudienceEdgeData` (lines 60-69) gain two fields each:
    ```ts
    readonly facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>;
    readonly rollupStatus: FacetStatus | 'none';
    ```
  - `projectGraph` body (lines 110-205): import `computeFacetStatuses`, `cardRollupStatus`, `EMPTY_FACET_STATUSES`, `FacetName`, `FacetStatus` from `./facetStatus.js`. At the top of the function body, before the for-loop, compute `const facetStatusIndex = computeFacetStatuses(events);`. Inside each `node-created` / `edge-created` branch, read the matching index entry (`facetStatusIndex.nodes.get(event.payload.node_id) ?? EMPTY_FACET_STATUSES` / `…edges.get(event.payload.edge_id) ?? EMPTY_FACET_STATUSES`), compute the rollup (`cardRollupStatus(record) ?? 'none'`), and stamp both onto the emitted descriptor's `data`. The commit-arm `kind` flips at lines 173-201 preserve `facetStatuses` + `rollupStatus` via `{ ...existing.data, kind: classification }` (the spread carries them through; verify by test).

- `apps/audience/src/graph/projectGraph.test.ts` — MODIFIED. Existing 16 cases continue to pass (the `toEqual` baselines need `facetStatuses: {}` + `rollupStatus: 'none'` added to their expected `data` payloads — minor mechanical update). Add new cases:
  - 1 case: a `classify-node` proposal with no votes → emitted node carries `facetStatuses.classification === 'proposed'` and `rollupStatus === 'proposed'`.
  - 1 case: a `classify-node` proposal + all-current-participants `agree` → `facetStatuses.classification === 'agreed'` and `rollupStatus === 'agreed'`.
  - 1 case: a `set-edge-substance` proposal → emitted edge carries `facetStatuses.substance === 'proposed'` and `rollupStatus === 'proposed'`.
  - 1 case: a node with no facet-targeting events → `facetStatuses: {}` (the `EMPTY_FACET_STATUSES` reference) and `rollupStatus === 'none'`.
  - 1 case: the classification-commit branch (both the facet-keyed and proposal-keyed arms) preserves `facetStatuses` / `rollupStatus` across the `kind` flip.
  - 1 case: an entity whose classification facet is `'agreed'` but whose substance facet is `'proposed'` carries `rollupStatus === 'proposed'` (the `ROLLUP_PRIORITY` precedence — proposed beats agreed).

- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. Three diff regions (mirrors the `aud_agreed_styling` precedent at [`L44-55`](../../../apps/audience/src/graph/GraphView.tsx#L44) + [`L188-200`](../../../apps/audience/src/graph/GraphView.tsx#L188)):
  - Header refinement-trail block (lines 1-79) gains a "Refinement: tasks/refinements/audience/aud_proposed_styling.md" entry with one-line-per-decision summary.
  - `STYLESHEET` JSDoc block (lines 108-149): the paragraph at [`L137-139`](../../../apps/audience/src/graph/GraphView.tsx#L137) ("The `data.rollupStatus` attribute the selectors key on is emitted by `projectGraph` once `aud_proposed_styling` ships …") is updated to reflect that the emission now lands and to point to `facetStatus.ts` as the derivation source.
  - `STYLESHEET` constant: two new entries appended after the existing `agreed` pair:

    ```ts
    {
      selector: "node[rollupStatus = 'proposed']",
      style: {
        'border-style': 'dashed',
        opacity: 0.6,
      },
    },
    {
      selector: "edge[rollupStatus = 'proposed']",
      style: {
        'line-style': 'dashed',
        opacity: 0.6,
      },
    },
    ```

- `apps/audience/src/graph/GraphView.test.tsx` — MODIFIED. Existing 24 cases continue to pass. Add:
  - 1 case: `STYLESHEET` contains an entry with `selector === "node[rollupStatus = 'proposed']"` whose `style['border-style'] === 'dashed'` and `style.opacity === 0.6` (structural).
  - 1 case: `STYLESHEET` contains an entry with `selector === "edge[rollupStatus = 'proposed']"` whose `style['line-style'] === 'dashed'` and `style.opacity === 0.6` (structural).
  - 1 case: after projecting a session where a node's `rollupStatus` resolves to `'proposed'` and mounting `<AudienceGraphView>`, the Cytoscape instance reports the matching node's computed `border-style` as `'dashed'` (via `cy.getElementById(id).style('border-style')`) and `opacity` as `0.6`.
  - 1 case: after projecting a session where an edge's `rollupStatus` resolves to `'proposed'` and mounting `<AudienceGraphView>`, the Cytoscape instance reports the matching edge's computed `line-style` as `'dashed'` and `opacity` as `0.6`.

  Cases 1 + 2 mirror the (w) / (x) pattern from `aud_agreed_styling`. Cases 3 + 4 are the mount-time pins that `aud_agreed_styling` had to defer; this leaf can land them inline because it owns the emission they require.

### Files this task does NOT touch

- `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — UNCHANGED.
- `packages/**` — UNCHANGED. No `shared-types` widening, no token package consumed, no shell-package barrel extraction (deferred to `shell_facet_status_extraction`, Decision §5).
- `apps/audience/src/graph/layoutOptions.ts` / `.test.ts` — UNCHANGED.
- `apps/audience/src/graph/cytoscapeTestEnv.ts` / `.test.ts` — UNCHANGED.
- `apps/audience/src/App.tsx` — UNCHANGED. The placeholder route stays; the component remains not-yet-reachable through any URL.
- `apps/audience/src/index.css`, `apps/audience/src/main.tsx` — UNCHANGED.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED.
- `docs/adr/**` — UNCHANGED. No new ADR — the port pattern is established precedent (Decision §5).
- `playwright.config.ts` / `tests/e2e/**` — UNCHANGED. Playwright deferral per Decision §6.
- `.tji` files — `complete 100` lands at task-completion time per the [README ritual](../README.md). No new `.tji` edges are required (the agreed-styling refinement's closer already added `depends !aud_proposed_styling` to its own block).

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/facetStatus.ts` exists and exports `FacetStatus`, `FacetName`, `FacetStatusIndex`, `EMPTY_FACET_STATUSES`, `ROLLUP_PRIORITY`, `computeFacetStatuses`, `cardRollupStatus` — byte-equivalent rule set to the participant's port at [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) (some import paths / type-only re-exports may differ; the eight derivation rules, the priority ordering, and the seven `FacetStatus` values do not).
- `apps/audience/src/graph/facetStatus.test.ts` exists with case coverage per Constraints — at minimum the empty-log baseline, the four agreement-layer + two committed-layer + one empty-state status cases, current-participant filtering, facet-routing per proposal sub-kind (including the `shape` facet), out-of-scope sub-kind absence, multi-facet independence, and `cardRollupStatus` precedence.
- `AudienceNodeData` and `AudienceEdgeData` carry the new `facetStatuses` + `rollupStatus` fields. Every emitted descriptor from `projectGraph` carries them populated (empty record + `'none'` sentinel for entities with no facet events).
- `apps/audience/src/graph/projectGraph.test.ts` has 16 baseline cases updated for the new data fields plus the 6 new cases per Constraints — total 22.
- `apps/audience/src/graph/GraphView.tsx`'s `STYLESHEET` carries two new entries — `node[rollupStatus = 'proposed']` (with `border-style: 'dashed'`, `opacity: 0.6`) and `edge[rollupStatus = 'proposed']` (with `line-style: 'dashed'`, `opacity: 0.6`) — appended after the existing agreed-state entries.
- All other `STYLESHEET` fields are byte-identical to the post-`aud_agreed_styling` baseline; the header refinement-trail block and the `STYLESHEET` JSDoc gain prose updates per Constraints.
- `apps/audience/src/graph/GraphView.test.tsx` carries 28 cases total (24 baseline + 4 new). The 4 new cases pin the new selectors per Constraints (structural × 2 + mount-time × 2; the mount-time pair can land inline because this leaf owns the projection emission they require).
- `apps/audience/package.json` is UNCHANGED — no new dependency.
- `apps/audience/src/App.tsx` is UNCHANGED. The component remains not-yet-reachable through any URL.
- Per `ORCHESTRATOR.md`'s deferred-e2e exception ("component not yet reachable"), Playwright coverage for this leaf is **deferred to `aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:318-347`](../../50-audience-and-broadcast.tji#L318); already inherits `aud_layout_engine` + `aud_clean_typography` + `aud_agreed_styling` pixel-stability work). The closer extends `aud_visual_regression`'s existing note to cover proposed-state styling (a node + edge whose `rollupStatus === 'proposed'` render with `border-style: dashed` / `line-style: dashed` and `opacity: 0.6` across Chrome / Firefox / WebKit at 720p / 1080p / 1440p, against the same reference fixtures the layout / typography / agreed-state deferrals already pin). Decision §6 documents why this is the right destination.
- The closer registers the named-future-task `shell_facet_status_extraction` (~0.5d) in the WBS — likely under `27-shell-package.tji` — to consolidate the now-four `facetStatus.ts` copies into a single `@a-conversa/shell` barrel export. Decision §5 documents why the consolidation is deferred. (Optional: the closer may judge that the existing per-facet-refactor backlog at `15-per-facet-refactor.tji` is a better home; either is acceptable.)
- The closer-or-maintainer notes against `aud_agreed_styling_mount_assertions` ([`tasks/50-audience-and-broadcast.tji:162-174`](../../50-audience-and-broadcast.tji#L162)) that its blocker is now lifted (the projection-time `data.rollupStatus` emission lands here); no `.tji` edge is needed because the existing `depends !aud_proposed_styling` covers ordering. Implementer of that task picks up the two deferred mount-time assertions for `'agreed'`.
- `pnpm run check` clean (strict TS pass; no new dep declared).
- `pnpm run test:smoke` green (Vitest count rises by the new `facetStatus.test.ts` suite + 6 `projectGraph.test.ts` cases + 4 `GraphView.test.tsx` cases; total delta in the order of 25-30 new cases).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta carries the ported derivation rules (~30 lines compiled) plus two `STYLESHEET` entries — small but non-zero (~1-2 KB pre-gzip).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_proposed_styling` in the same commit (the closer's ritual).
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer pins the derivation rules, the projection emission, the stylesheet shape, AND the mount-time computed-style resolution; `aud_visual_regression` will land the pixel-level rendering pin once the route is reachable.

## Decisions

### §1 — Emit both `facetStatuses` and `rollupStatus` on every projected element

Three approaches to what `projectGraph` stamps onto each emitted `data`:

- **(A — chosen)** Emit BOTH `facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>` AND `rollupStatus: FacetStatus | 'none'`. The rollup is the field Cytoscape's attribute selectors key on for the current per-state styling work; the per-facet record is the field the future `aud_per_facet_visualization` task reads to subdivide cards. Computing both at projection time costs one extra `cardRollupStatus(record)` call per element — trivial.
- **(B)** Emit only `rollupStatus`, defer `facetStatuses` to `aud_per_facet_visualization`. Cost: when the per-facet visualization task lands, it would need to either re-port the projection (re-running `computeFacetStatuses` inside the component) or re-thread the projection signature to include the new field — both worse than just emitting both now. Benefit: smaller `data` payload today. Rejected — the size delta is irrelevant; the future ergonomics matter.
- **(C)** Emit only `facetStatuses`, compute `rollupStatus` per-render inside the React component via `cardRollupStatus(data.facetStatuses)`. Cost: Cytoscape's `[rollupStatus = '<state>']` selectors require an actual data field on the element, not a React-side computed value — so this option doesn't even work for selector matching unless we re-emit `rollupStatus` as a `cy.elements().data('rollupStatus', …)` after each projection pass. Rejected as architecturally backwards.

The participant's `projectGraph` (at [`apps/participant/src/graph/projectGraph.ts:484-512`](../../../apps/participant/src/graph/projectGraph.ts#L484)) emits both. The audience port follows the precedent.

### §2 — Visual treatment: dashed border / line + 60% opacity, color inherited from baseline

Two new selector entries:

- Nodes: `{ 'border-style': 'dashed', opacity: 0.6 }` — keeps the baseline `'border-color': '#cbd5e1'` (slate-300) and `'border-width': 1` from the `node` selector at [`GraphView.tsx:151-170`](../../../apps/audience/src/graph/GraphView.tsx#L151); flips border-style from the default `'solid'` to `'dashed'`; reduces opacity to 0.6 (text + background + border all fade together — the "tentative" semantic applies to the whole card).
- Edges: `{ 'line-style': 'dashed', opacity: 0.6 }` — keeps the baseline `'line-color': '#94a3b8'` (slate-400) and `'target-arrow-color': '#94a3b8'` from the `edge` selector at [`GraphView.tsx:171-187`](../../../apps/audience/src/graph/GraphView.tsx#L171); flips line-style to `'dashed'`; fades to 0.6.

Three design axes drove this choice:

1. **Cross-surface consistency.** The moderator's [`mod_proposed_state_styling.md`](../moderator-ui/mod_proposed_state_styling.md) Decisions / Status picked `border-dashed opacity-60` (Tailwind) on nodes and `strokeDasharray: '6 4'` + `opacity: 0.6` on edges. The audience translates to Cytoscape's equivalents (`'border-style': 'dashed'` / `'line-style': 'dashed'` + `opacity: 0.6`). Same visual contract; cross-surface broadcast composites read as one show.
2. **CAD / diagram convention for "tentative".** The moderator's refinement names this explicitly: "the long-standing convention in CAD / diagramming software that dashed-stroke = tentative / draft / proposed, while solid stroke = committed." The audience adopts the same convention so visualizing on the broadcast surface keys off viewer intuition.
3. **No color change.** Alternative — pick a brighter or dimmer color (e.g., slate-200 → slate-300 for the border) to signal "in flight". Rejected — color is the differentiator the agreed-state already used (slate-700 vs baseline slate-300 per [`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §2); using a third color for proposed would force the disputed / meta-disagreement / withdrawn states into ever-narrower color slots, and would visually compete with the agreed-state's darker tone (the viewer's eye would jump between two color signals). Dashed-vs-solid + opacity is a cleaner orthogonal axis: color carries "state in the agreement timeline" (baseline → settled → committed), dash + opacity carries "is this in flight or not". A future disputed state will use a third axis (red accent / marker overlay per [`tasks/50-audience-and-broadcast.tji:137-141`](../../50-audience-and-broadcast.tji#L137)) — color, dash, and marker glyph compose without overloading any single axis.

Alternative — use Cytoscape's `'border-style': 'dotted'` instead of `'dashed'`. Rejected — `dotted` reads as noisier at broadcast distances (1080p / 1440p) and was rejected by the moderator's task for the same reason (CAD convention is `dashed`, not `dotted`).

Alternative — reduce `opacity` further (e.g., 0.4). Rejected — at 0.4 the wording / role labels become illegible against the slate canvas after streaming compression. 0.6 is the moderator's calibrated value; the audience inherits it.

Alternative — use `'background-opacity': 0.6` on nodes (faded fill only, full-opacity text + border). Rejected — Cytoscape's `opacity` on a node applies to the whole element including text + border, which is what "the card is tentative" should communicate. Splitting fill-opacity from text-opacity makes the visual say "this is here but its content is uncertain" rather than "this whole card is in flight". The card-level semantic matches the moderator's `opacity-60` Tailwind class behavior (opacity applies to the whole DOM subtree).

No new ADR is required. The visual specification is already in ADR 0005 L19 ("proposed dashed/faded"); the moderator's task already settled the specific numbers; this leaf adopts them.

### §3 — Port `facetStatus.ts` verbatim from the participant, not from the moderator

The participant's port is the newer of the two client mirrors and carries the post-`pf_*` refactor cleanups: the seven `FacetStatus` values (including `awaiting-proposal` per ADR 0030 §10), the four `FacetName` values (including `shape` per `pf_part_facet_name_widen_shape`), and the `EMPTY_FACET_STATUSES` frozen reference. The moderator's port is older and was written before some of those landed. Porting from the participant means the audience starts at the current state of the rule set, not the moderator's older state.

Alternative — port from the moderator's older file. Rejected — would require immediately back-porting the `awaiting-proposal` + `shape` cleanups, and would leave a confusing "audience is at moderator-v1 + manual patches" trail for the future extraction task to untangle.

Alternative — port from the server canonical (`apps/server/src/projection/facet-status.ts`). Rejected — the server canonical exports `deriveFacetStatus(state)` (operating on `FacetState` records), not `computeFacetStatuses(events)` (operating on the event log). The client mirrors do the event-log walk themselves to avoid pulling in `apps/server`'s state-machine infrastructure. The participant's file is the canonical client shape.

### §4 — `'none'` sentinel for `rollupStatus`, not `undefined`

When an entity has no facet-targeting events in the log, its record in `FacetStatusIndex` is absent (or empty), and `cardRollupStatus({})` returns `undefined`. The projection translates this to the literal string `'none'` before stamping `rollupStatus` onto the element data.

Two approaches:

- **(A — chosen)** Stamp `'none'` (a literal string). Cytoscape's attribute selectors (`[rollupStatus = 'proposed']`) match on equality; `undefined` does not match any selector — but Cytoscape DOES emit `console.warn` traces in some versions when matching against `undefined` (the participant's `pf_*` thread documented this). The `'none'` sentinel both matches no per-state selector and silences the warn paths.
- **(B)** Stamp `undefined`. Cost: relies on Cytoscape's null-safety for attribute matching; may trigger version-dependent warnings; future selectors that want a "no-state" branch (`node[!rollupStatus]` or `node[rollupStatus = 'none']`) have no stable target. Rejected.

The participant's projection at [`apps/participant/src/graph/projectGraph.ts:131-137`](../../../apps/participant/src/graph/projectGraph.ts#L131) documents this exact reasoning. The audience follows.

### §5 — Defer `shell_facet_status_extraction` to a named-future task; ship the fourth verbatim copy

The participant's header trail at [`apps/participant/src/graph/facetStatus.ts:10-12`](../../../apps/participant/src/graph/facetStatus.ts#L10) named the audience as the trigger for shell extraction. Three approaches:

- **(A — chosen)** Ship the fourth verbatim copy in this leaf; register the named-future-task `shell_facet_status_extraction` (~0.5d) in the WBS for the closer-or-maintainer to land. Cost: a fourth duplicate file in the repo for a brief period. Benefit: this leaf's diff stays surgical (one new file + one test file + projection plumbing + two selectors), and the extraction task can be scoped independently with its own lockstep-mirroring breakdown.
- **(B)** Land the extraction inline in this leaf: create `packages/shell/src/facetStatus.ts`, move the four existing files' bodies into it, rewrite four sets of imports (server probably stays canonical and re-imports the shell version; participant + moderator + audience all import from `@a-conversa/shell`), update four test files, update four header trails. Cost: doubles the diff size, mixes a behavioural change (the audience gains proposed-state styling) with a structural refactor (consolidate four mirrors), and pushes the audience workspace through the `shell` package's TypeScript strict-mode dependency graph (already on the audience's path via `@a-conversa/shell`'s `AuthContext` / `I18nProvider` — but adding a methodology helper might surface a circular-import issue between `shell` and `shared-types` that would have to be debugged inline). Rejected as scope creep.
- **(C)** Skip extraction altogether; accept N-way duplication permanently. Cost: every methodology rule-set widening must edit N files; N grows as new surfaces materialize (replay-test workspace under `replay_test.*` is the next likely client). Rejected as long-term technical debt.

The named-future-task `shell_facet_status_extraction` is registered by the closer when this leaf lands. Effort estimate: ~0.5d (file moves + import rewrites + barrel export + run the now-shared suite once). The task's `.tji` block would go under `27-shell-package.tji` (or `15-per-facet-refactor.tji` — closer's judgment) and `depends !aud_proposed_styling` plus the analogous moderator + participant emissions (which already exist). No ADR required — the consolidation pattern is established by other shell extractions (e.g., the `AuthContext` lift).

### §6 — Playwright deferral lands on `aud_visual_regression`, NOT `aud_session_url`

Per `ORCHESTRATOR.md`'s deferred-e2e exception: this leaf modifies the Cytoscape stylesheet inside an audience-surface region that is still not reachable through any user-flow route ([`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) still maps every path to the placeholder; the per-session route lands in `aud_url_routing.aud_session_url`). The proposed-state visual is invisible until that route ships.

`aud_session_url`'s inherited deferred-e2e debt is already past the "2+ refinements, pay down" threshold flagged by `ORCHESTRATOR.md` (cumulative debt from `aud_ws_client`, `aud_state_management`, `aud_anonymous_ws_subscribe`, `aud_cytoscape_init` per [`aud_cytoscape_init.md`](aud_cytoscape_init.md) Decision §9). [`aud_layout_engine.md`](aud_layout_engine.md) Decision §5, [`aud_clean_typography.md`](aud_clean_typography.md) Decision §6, and [`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §5 all redirected pixel-stability work to `aud_visual_regression` to avoid adding to that pile. Per-state styling follows the same routing for the same reason — same audience surface, same not-yet-reachable canvas, same destination.

The right destination is **`aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:318-347`](../../50-audience-and-broadcast.tji#L318)). The task already inherits layout + typography + agreed-state styling pixel-stability deferrals; proposed-state is the same kind of "the rendered pixels match across runs" assertion. The closer extends `aud_visual_regression`'s existing note to also cover proposed-state styling — a node + edge whose `rollupStatus === 'proposed'` render with `border-style: dashed` / `line-style: dashed` and `opacity: 0.6` across Chrome / Firefox / WebKit at 720p / 1080p / 1440p.

The proposed-state stylesheet correctness (the selector entries and their style fields), the projection-time emission of `data.rollupStatus`, AND the mount-time `cy.getElementById(id).style('border-style')` resolution are fully pinned at the Vitest layer above — `aud_visual_regression` is for the *visible* rendering, not the stylesheet shape.

Alternative — defer to `aud_session_url`. Rejected per the "2+ refinements, pay down" rule and per the scope mismatch (route-mount assertions are not per-state styling assertions).

Alternative — register a new `aud_pw_state_styling_smoke` task. Rejected — planning-debt for no architectural reason; `aud_visual_regression` already exists with the right scope.

Alternative — scope a thin Playwright spec inline that asserts the placeholder route's chrome renders some visible signal of "proposed-state styling is wired in". Rejected — the placeholder chrome does NOT include a Cytoscape canvas (`<AudienceGraphView>` is not mounted from `App.tsx`); no inline spec is meaningful.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- `apps/audience/src/graph/facetStatus.ts` — NEW: verbatim port of the participant's derivation engine; fourth `facetStatus.ts` copy across workspaces (server canonical + moderator + participant + audience); header trail names all four copies and re-asserts the lockstep requirement.
- `apps/audience/src/graph/facetStatus.test.ts` — NEW: full Vitest suite mirroring the participant's case set; covers all derivation rules, `ROLLUP_PRIORITY` precedence, current-participant filtering, facet routing per proposal sub-kind (including `shape`), out-of-scope sub-kind absence, multi-facet independence, and `cardRollupStatus` precedence.
- `apps/audience/src/graph/projectGraph.ts` — MODIFIED: `AudienceNodeData` / `AudienceEdgeData` extended with `facetStatuses` + `rollupStatus`; `projectGraph` body calls `computeFacetStatuses(events)` once up-front and stamps both fields onto every emitted descriptor; `'none'` sentinel for entities with no facet-targeting events (per Decision §4).
- `apps/audience/src/graph/projectGraph.test.ts` — MODIFIED: 6 new cases (k–p) pinning `facetStatuses` + `rollupStatus` population across agreement-layer states; existing 16 baselines updated with the two new `data` fields.
- `apps/audience/src/graph/GraphView.tsx` — MODIFIED: header trail extended with this refinement's one-line-per-decision summary; STYLESHEET JSDoc updated to reflect live `data.rollupStatus` emission; two new selector entries appended after the agreed-state pair: `node[rollupStatus = 'proposed']` (`border-style: 'dashed'`, `opacity: 0.6`) and `edge[rollupStatus = 'proposed']` (`line-style: 'dashed'`, `opacity: 0.6`).
- `apps/audience/src/graph/GraphView.test.tsx` — MODIFIED: 4 new cases (y–bb): 2 structural (selector entry shape) + 2 mount-time (computed `border-style` / `line-style` and `opacity` after one render tick); 28 cases total.
- Playwright proposed-state pixel-stability deferred to `aud_visual_regression` per Decision §6; `aud_visual_regression` note extended accordingly.
- Tech-debt follow-up: `extract_facet_status_rules` (already registered in `tasks/27-shell-package.tji:79-86`) covers the `shell_facet_status_extraction` requirement named in Decision §5; no new WBS entry needed — the existing task `depends audience.aud_graph_rendering` and triggers once the full graph-rendering group lands.
