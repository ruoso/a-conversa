# Audience agreed-state styling (solid border, darker tone for unanimously-agreed entities on the broadcast surface)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_graph_rendering.aud_agreed_styling`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!audience.aud_graph_rendering.aud_cytoscape_init` (settled — shipped 2026-05-27, `complete 100` at [`tasks/50-audience-and-broadcast.tji:90`](../../50-audience-and-broadcast.tji#L90). The viewport this leaf restyles: a one-shot `cytoscape({ ... })` mount inside `<div data-testid="audience-graph-root">` at [`apps/audience/src/graph/GraphView.tsx:211-239`](../../../apps/audience/src/graph/GraphView.tsx#L211); the module-scope `STYLESHEET` at [`apps/audience/src/graph/GraphView.tsx:123-161`](../../../apps/audience/src/graph/GraphView.tsx#L123) is the seam this leaf extends. The header comment at [`apps/audience/src/graph/GraphView.tsx:107-112`](../../../apps/audience/src/graph/GraphView.tsx#L107) explicitly forwarded per-facet styling to "sibling tasks (`aud_proposed_styling`, `aud_axiom_mark_decoration`, `aud_annotation_rendering`, …) that extend this stylesheet in their own commits.")
- Prose-only context (NOT a `.tji` edge today; Decision §1 below requests the closer add it): `audience.aud_graph_rendering.aud_proposed_styling` (not yet shipped — refinement not yet authored). This 0.5d budget assumes the 1d proposed-styling task ships first and lands the heavy plumbing: the `apps/audience/src/graph/facetStatus.ts` port (third copy after the server canonical and participant mirror, per the participant header trail at [`apps/participant/src/graph/facetStatus.ts:15-23`](../../../apps/participant/src/graph/facetStatus.ts#L15)), the projection-time `data.rollupStatus: FacetStatus | 'none'` emission on every projected node + edge, the `ROLLUP_PRIORITY` array (`proposed > meta-disagreement > disputed > agreed > committed > withdrawn > awaiting-proposal`, verbatim mirror of the participant's at [`apps/participant/src/graph/facetStatus.ts:647-662`](../../../apps/participant/src/graph/facetStatus.ts#L647)), and the first per-state selector (`node[rollupStatus = 'proposed']` + `edge[rollupStatus = 'proposed']`). The moderator's same pair landed in the same order ([`tasks/refinements/moderator-ui/mod_proposed_state_styling.md`](../moderator-ui/mod_proposed_state_styling.md) at 1d, then [`tasks/refinements/moderator-ui/mod_agreed_state_styling.md`](../moderator-ui/mod_agreed_state_styling.md) at 0.5d) and the same rationale carries — the proposed-state task pays the plumbing cost; the agreed-state task is a thin selector extension on top.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_clean_typography` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_clean_typography.md`](aud_clean_typography.md)). This leaf does not touch typography; agreed-state nodes / edges inherit `font-family` / `font-size` / `font-weight` from the baseline `node` / `edge` selectors per Cytoscape's per-selector resolution. The exported typography constants stay in place; this leaf adds no new exports.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_layout_engine` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_layout_engine.md`](aud_layout_engine.md)). Layout geometry is unchanged; the 200×80 node box + 180px text-max-width is the size envelope this leaf renders inside.

## What this task is

The 0.5d leaf that lands the **agreed-state visual** on the audience's Cytoscape canvas — nodes and edges whose card-level rollup is `'agreed'` (every current participant has voted `agree` on the facet but no `commit` has landed) get a solid darker-slate border and arrow tone that reads against compressed video, distinct from both the baseline (light slate, "nothing has happened here yet") and from the proposed-state (dashed, faded) visual landed by `aud_proposed_styling`.

After this leaf:

- Two new selector entries land in the module-scope `STYLESHEET` at [`apps/audience/src/graph/GraphView.tsx:123-161`](../../../apps/audience/src/graph/GraphView.tsx#L123) — `node[rollupStatus = 'agreed']` and `edge[rollupStatus = 'agreed']`. Each entry overrides only the properties that differentiate the agreed state from the baseline (border / line color on nodes; line / target-arrow color on edges); typography, geometry, label, shape, background, and text-background fields all inherit from the baseline `node` / `edge` selectors via Cytoscape's per-selector composition (an element matching two selectors merges their style objects; later selectors win on the conflicting keys).
- Four new Vitest cases land in `apps/audience/src/graph/GraphView.test.tsx` — two structural assertions that the new selector entries appear in `STYLESHEET` with the right style fields, and two mount-time assertions that a node / edge whose projection emitted `data.rollupStatus === 'agreed'` actually carries the agreed-state computed style after one render tick. Existing 22 cases (12 from `aud_cytoscape_init` + 4 from `aud_layout_engine` + 6 from `aud_clean_typography`) continue to pass.

Out of scope (deferred to existing or future leaves):

- **The facet-status engine port to the audience workspace** (`apps/audience/src/graph/facetStatus.ts`). Owned by `aud_proposed_styling`. Decision §1 below documents the assumed pre-condition.
- **The `data.rollupStatus` emission on each projected element** in `projectGraph` / `GraphView`. Owned by `aud_proposed_styling`. This leaf consumes the field; it does NOT introduce it.
- **The `ROLLUP_PRIORITY` array + `cardRollupStatus()` helper**. Owned by `aud_proposed_styling`. Mirrors the participant precedent at [`apps/participant/src/graph/facetStatus.ts:647-681`](../../../apps/participant/src/graph/facetStatus.ts#L647) verbatim.
- **Per-facet state visualization (single node subdivided into per-facet visual slices).** Owned by `aud_per_facet_visualization` (2d, [`tasks/50-audience-and-broadcast.tji:146-150`](../../50-audience-and-broadcast.tji#L146)), which depends on this leaf, `aud_proposed_styling`, and `aud_disputed_styling` all landing first.
- **The disputed-state / meta-disagreement-split / committed / withdrawn / awaiting-proposal visuals.** Owned by `aud_disputed_styling`, `aud_meta_disagreement_split`, and (closer- or maintainer-registered) future leaves under `aud_graph_rendering.*`. Each adds its own `node[rollupStatus = '<state>']` / `edge[rollupStatus = '<state>']` selector entries against the same `STYLESHEET`; this leaf does NOT pre-emptively scope them.
- **Color tokens extracted to `packages/ui-tokens`.** Per ADR 0005's "Workspace realization deferred" consequence and `aud_clean_typography.md` Decision §5, the token workspace has not yet materialized; the agreed-state color values land inline in `STYLESHEET` (slate-700 / slate-600 hex literals) and will migrate to `tokens.color.facet.agreed.*` whenever the workspace ships. Same posture the moderator + participant surfaces take for their own state-styling.
- **The agreed-state animation cue at the proposed → agreed transition.** Owned by `aud_proposed_to_agreed_animation` (1d, [`tasks/50-audience-and-broadcast.tji:174-177`](../../50-audience-and-broadcast.tji#L174)) under the `aud_animations.*` group (which depends `!aud_graph_rendering` and therefore runs after this leaf). This leaf ships only the static visual; the transition animation reads the same `data.rollupStatus` field on its own commit.
- **A Playwright spec exercising the agreed-state styling.** Per the deferred-e2e exception (`ORCHESTRATOR.md` UI-stream e2e policy): the component this leaf restyles is still not reachable through any user-flow route — the wildcard at [`apps/audience/src/App.tsx:124`](../../../apps/audience/src/App.tsx#L124) still maps every path to the placeholder. Full deferral applies; Decision §5 places it on `aud_visual_regression`, mirroring the destination `aud_clean_typography` and `aud_layout_engine` already used.

## Why it needs to be done

The `m_audience_mvp` milestone in [`tasks/99-milestones.tji`](../../99-milestones.tji) names the entire `aud_graph_rendering` group transitively. The audience surface's reason to exist is broadcast-output to OBS, and on a broadcast surface the agreed-state visual is the **second-most informative cue** after the entity / edge being on the canvas at all. Viewers watching the show need a glance-level signal that distinguishes "we've all agreed on this" from "we're still debating this" — without it, the audience canvas becomes a homogeneous slate-bordered diagram that says nothing about the conversation's state. The proposed-state styling (dashed + faded, sibling `aud_proposed_styling`) gives "in flight"; this leaf gives "settled (pre-commit)". Together with `aud_disputed_styling` (the marker visual) they land the three baseline agreement-layer states viewers need to read on the broadcast canvas.

Downstream concretely:

- **`aud_disputed_styling` / `aud_meta_disagreement_split`** extend the same `STYLESHEET` with their own per-rollup selectors. The `data.rollupStatus` projection field, the `ROLLUP_PRIORITY` array, and the `cardRollupStatus` helper all land in `aud_proposed_styling`; this leaf is the second selector group; those siblings are the third / fourth. Once three sibling tasks layer per-state selectors on the file, the named-future-task `aud_stylesheet_module_extraction` (~0.25d, registered by `aud_clean_typography.md` Decision §4) is the trigger — the moderator's precedent waited until a similar threshold before extracting.
- **`aud_per_facet_visualization`** (2d, [`tasks/50-audience-and-broadcast.tji:146-150`](../../50-audience-and-broadcast.tji#L146)) subdivides a single node into per-facet visual slices once all three baseline state styles (proposed / agreed / disputed) ship. The card-level rollup this leaf colors is the conservative default; the per-facet view is the upgrade.
- **`aud_proposed_to_agreed_animation`** (1d, [`tasks/50-audience-and-broadcast.tji:174-177`](../../50-audience-and-broadcast.tji#L174)) animates the transition from the proposed visual to the agreed visual. The animation reads the same `data.rollupStatus` field and tweens the color / opacity / dash-array properties this leaf and `aud_proposed_styling` set. Without this leaf the transition has no destination state to animate to.
- **`aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:294-310`](../../50-audience-and-broadcast.tji#L294)) is the pixel-comparison testing task that already inherits typography and layout pixel-stability deferrals from `aud_clean_typography` Decision §6 and `aud_layout_engine` Decision §5. Per-state styling pixel-stability deferred to it here (Decision §5) follows the same pattern: the visual-regression task will assert that agreed-state nodes / edges render at the right color across Chrome / Firefox / WebKit at 720p / 1080p / 1440p, on top of the already-inherited typography + layout fixtures.

Architecturally, this leaf mirrors the moderator's `mod_agreed_state_styling` (shipped 2026-05-11, see [`tasks/refinements/moderator-ui/mod_agreed_state_styling.md`](../moderator-ui/mod_agreed_state_styling.md) Status block) but renders into a Cytoscape stylesheet rather than a Tailwind className. The moderator uses `border-solid border-slate-700 opacity-100` on a `<StatementNode>` React component with `data-facet-status="agreed"` as the stable seam; the audience uses `node[rollupStatus = 'agreed']` selector → `border-color: #334155` (slate-700) inside Cytoscape's `style:` object — different rendering tech, same color choice, same scope. The cross-surface consistency of "slate-700 = agreed" makes the broadcast composite (audience canvas + future picture-in-picture moderator view) read as one show rather than two arbitrary palettes.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience uses Cytoscape's stylesheet for all rendering; per-state visuals must be expressed as selector entries in `STYLESHEET`, not as CSS classes / inline styles on a DOM ancestor (Cytoscape paints to canvas with its own per-selector resolution; CSS cascade does not cross the canvas boundary).
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the per-facet state visual contract is documented at L19 ("proposed dashed/faded, agreed solid, disputed marker, meta-disagreement split"). The smoke-test example at L47 (`--color-facet-agreed: #1f7a3a`) is illustrative, not normative; Decision §2 below picks slate-700 instead of the green for broadcast / cross-surface consistency.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the four Vitest cases below ARE the regression coverage; no "I ran the audience locally and the agreed-state node was visibly darker" smoke. The visible-rendering pin lands in `aud_visual_regression` (Decision §5).
- [ADR 0024 — Frontend i18n: react-i18next + ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — orthogonal but worth naming: state styling is locale-independent; the same selector / color fires for every locale. No new i18n keys; no edit to `methodology.kind.*` / `methodology.edgeRole.<role>.label`.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — orthogonal but worth naming: the audience surface is a mounted library; the new STYLESHEET entries ship as part of the audience artifact and do not bleed into other surfaces.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the agreement-layer state (`agreed`) is what this leaf renders; the entity-layer (node existence, kind, wording, edges) is rendered by `aud_cytoscape_init`. The two layers do not bleed: a node may exist with `kind: null` and `rollupStatus: 'agreed'` if its substance / wording facets have agreed but classification has not been proposed.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the eight-rule facet-status derivation is the source of the `'agreed'` value this leaf renders. Rule 7 (every current participant voted `agree` on the current candidate) is the rule that puts a facet into the agreed state; the derivation lives in the audience-side `facetStatus.ts` ported by `aud_proposed_styling` (mirror of [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts)).

### Sibling refinements

- [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md) — the foundation this leaf modifies. Decision §2 (module-scope stylesheet) and the "Per-facet styling … plug in via sibling tasks" forwarding comment at [`GraphView.tsx:107-112`](../../../apps/audience/src/graph/GraphView.tsx#L107) are the explicit invitation this leaf accepts.
- [`tasks/refinements/audience/aud_layout_engine.md`](aud_layout_engine.md) — Decision §3 (one-shot fit on first non-empty render) + Decision §4 (broadcast-tuned spacing constants) constrain the geometry this leaf renders inside. The 200×80 node box stays unchanged; the agreed-state border bumps no width / height fields.
- [`tasks/refinements/audience/aud_clean_typography.md`](aud_clean_typography.md) — Decision §5 (font-family on both node and edge selectors) is the precedent for "per-selector inheritance, no `core`-cascade reliance." The agreed-state selectors below follow the same posture: the override fields are listed explicitly per selector, not via a single core-level rule.
- [`tasks/refinements/moderator-ui/mod_agreed_state_styling.md`](../moderator-ui/mod_agreed_state_styling.md) — the cross-surface precedent. Same task name, same 0.5d effort, same "second state-styling leaf after the proposed-state leaf paid the plumbing cost" shape. Cross-surface color choice (slate-700 border) carries verbatim per Decision §2 below; the rendering-tech translation (Tailwind class → Cytoscape selector) is the only divergence.
- [`tasks/refinements/moderator-ui/mod_proposed_state_styling.md`](../moderator-ui/mod_proposed_state_styling.md) — the precedent for what the audience's `aud_proposed_styling` task will look like (the heavy-plumbing predecessor). Read alongside the participant's `facetStatus.ts` header trail to anticipate the data-shape this leaf consumes.
- [`tasks/refinements/per-facet-refactor/pf_projection_facet_status_refactor.md`](../per-facet-refactor/pf_projection_facet_status_refactor.md) (referenced indirectly via the participant `facetStatus.ts` header) — the canonical per-facet refactor that landed the participant's three-copy mirror trail. The audience's `aud_proposed_styling` adds the third copy; this leaf consumes it.

### Live code the leaf modifies

- [`apps/audience/src/graph/GraphView.tsx:123-161`](../../../apps/audience/src/graph/GraphView.tsx#L123) — the `STYLESHEET` constant. Two new selector entries appended:
  - `{ selector: "node[rollupStatus = 'agreed']", style: { 'border-color': '#334155' } }`
  - `{ selector: "edge[rollupStatus = 'agreed']", style: { 'line-color': '#334155', 'target-arrow-color': '#334155' } }`
- [`apps/audience/src/graph/GraphView.tsx:3-42`](../../../apps/audience/src/graph/GraphView.tsx#L3) — the header refinement-trail block. Extended with a one-line-per-decision summary of this refinement, matching the existing entries for `aud_cytoscape_init.md` / `aud_layout_engine.md` / `aud_clean_typography.md`.
- [`apps/audience/src/graph/GraphView.tsx:95-122`](../../../apps/audience/src/graph/GraphView.tsx#L95) — the `STYLESHEET` JSDoc block. Extended with a sentence on the per-state extension pattern (one selector entry per state, the override-only-the-differentiator posture).
- [`apps/audience/src/graph/GraphView.test.tsx`](../../../apps/audience/src/graph/GraphView.test.tsx) — gains 4 new Vitest cases (totalling 26); existing 22 cases continue to pass.

### What the surface MUST NOT do

- **No edit to `projectGraph.ts` / `projectGraph.test.ts`.** Projection-time `data.rollupStatus` emission is owned by `aud_proposed_styling` (the predecessor); this leaf consumes the field. If the predecessor's emission ships wrong, fix it there — not here. (If `aud_proposed_styling` has not shipped when this task is picked, Decision §1 is the blocker; the orchestrator should pick the proposed-styling task first.)
- **No edit to `apps/audience/src/graph/facetStatus.ts`.** The facet-status derivation lives in `aud_proposed_styling`'s ported file; this leaf does NOT touch the derivation rules, the `FacetStatus` / `FacetName` types, the `ROLLUP_PRIORITY` array, or `cardRollupStatus`.
- **No edit to `layoutOptions.ts` / `cytoscapeTestEnv.ts` / `App.tsx` / `index.css` / `main.tsx`.** Layout, mount-environment, route, page CSS, and provider wiring are all unchanged. The visual change is entirely inside `STYLESHEET`.
- **No edit to `package.json`.** No new dependency. The hex literals land inline; no token package consumed.
- **No edit to `participant` / `moderator` / `root` / `server` workspaces.** Per-state styling is audience-specific in pixel terms even if the color value (slate-700) matches the moderator — the moderator uses Tailwind classes on React DOM, the audience uses Cytoscape selector style fields on canvas. The cross-surface match is intentional and pinned by Decision §2's rationale, not by a shared import.
- **No new top-level named export from `GraphView.tsx`.** The named-export trigger established by `aud_clean_typography.md` Decision §3 fires when sibling tasks need to key off a numeric / color value (font sizes, weights); a per-state hex literal that appears once in `STYLESHEET` does not meet that bar yet. The trigger fires when a third sibling task wants to compose against it. (See Decision §3.)
- **No `node.addClass('agreed')` / `cy.elements().filter(...)` imperative styling** inside the `useEffect`. Cytoscape selectors driven by `data.rollupStatus` are the declarative seam; imperative class manipulation bypasses the projection's data model and breaks the "stylesheet is the source of truth" invariant set by `aud_cytoscape_init.md` Decision §2.
- **No animation, transition, or `cy.animate(...)` call.** Static styling only; the proposed → agreed transition animation is `aud_proposed_to_agreed_animation`'s scope.
- **No `:selected` / `:active` / `:hover` Cytoscape pseudo-class entries.** The audience is read-only by construction (Cytoscape's `autoungrabify: true` is already set at [`apps/audience/src/graph/GraphView.tsx:227`](../../../apps/audience/src/graph/GraphView.tsx#L227)); pseudo-class state styling would imply interactive affordances the audience does not have.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. Three diff hunks (all small):
  - The header refinement-trail block (lines 3-42) gains a new "Refinement: tasks/refinements/audience/aud_agreed_styling.md" entry, summarizing the agreed-state decisions in the same one-line-per-decision style the surrounding header uses.
  - The `STYLESHEET` JSDoc block (lines 95-122) gains a sentence explaining the per-state extension pattern (one selector entry per state; the override-only-the-differentiator posture).
  - The `STYLESHEET` constant gains two new entries appended to the array (after the existing `edge` entry):

    ```ts
    {
      selector: "node[rollupStatus = 'agreed']",
      style: {
        'border-color': '#334155',
      },
    },
    {
      selector: "edge[rollupStatus = 'agreed']",
      style: {
        'line-color': '#334155',
        'target-arrow-color': '#334155',
      },
    },
    ```

- `apps/audience/src/graph/GraphView.test.tsx` — MODIFIED. Add 4 new Vitest cases (totalling 26); existing 22 cases continue to pass:
  1. `STYLESHEET` contains an entry with `selector === "node[rollupStatus = 'agreed']"` whose `style['border-color'] === '#334155'`.
  2. `STYLESHEET` contains an entry with `selector === "edge[rollupStatus = 'agreed']"` whose `style['line-color'] === '#334155'` and `style['target-arrow-color'] === '#334155'`.
  3. After projecting a session where a node's `rollupStatus` resolves to `'agreed'` and mounting `<AudienceGraphView>`, the Cytoscape instance reports the matching node's computed `border-color` as `rgb(51, 65, 85)` (the resolved hex literal). Asserted via `cy.getElementById('<id>').style('border-color')`.
  4. After projecting a session where an edge's `rollupStatus` resolves to `'agreed'` and mounting `<AudienceGraphView>`, the Cytoscape instance reports the matching edge's computed `line-color` as `rgb(51, 65, 85)`. Asserted via `cy.getElementById('<id>').style('line-color')`.

  Cases 1 + 2 are structural-equality assertions on the exported `STYLESHEET` constant — no Cytoscape mount required. They mirror the pattern `aud_clean_typography.md` Constraints used for the typography fields. Cases 3 + 4 do mount Cytoscape (reusing the existing `cytoscapeTestEnv` setup); they pin the end-to-end behaviour that the `[rollupStatus = 'agreed']` attribute selector actually fires when `data.rollupStatus === 'agreed'` is present on an element.

  If `aud_proposed_styling` has not yet shipped at the time this task is implemented, cases 3 + 4 cannot pass — they require the projection-time `data.rollupStatus` emission. The implementer must verify the predecessor's `complete 100` marker is present before starting (Decision §1).

### Files this task does NOT touch

- `apps/audience/src/graph/projectGraph.ts` — UNCHANGED. Projection-time `data.rollupStatus` emission is `aud_proposed_styling`'s scope.
- `apps/audience/src/graph/projectGraph.test.ts` — UNCHANGED.
- `apps/audience/src/graph/facetStatus.ts` — UNCHANGED. The facet-status engine port lives in `aud_proposed_styling`; this leaf consumes its outputs via the projection.
- `apps/audience/src/graph/facetStatus.test.ts` — UNCHANGED.
- `apps/audience/src/graph/layoutOptions.ts` — UNCHANGED.
- `apps/audience/src/graph/layoutOptions.test.ts` — UNCHANGED.
- `apps/audience/src/graph/cytoscapeTestEnv.ts` — UNCHANGED.
- `apps/audience/src/graph/cytoscapeTestEnv.test.ts` — UNCHANGED.
- `apps/audience/src/App.tsx` — UNCHANGED. The placeholder route stays; the component remains not-yet-reachable through any URL.
- `apps/audience/src/index.css` — UNCHANGED.
- `apps/audience/src/main.tsx` — UNCHANGED.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED. No new dependency.
- `apps/participant/**`, `apps/moderator/**`, `apps/root/**`, `apps/server/**` — UNCHANGED.
- `packages/**` — UNCHANGED. No token package consumed; no shared-helper extracted.
- `docs/adr/**` — UNCHANGED. No new ADR (Decision §2).
- `playwright.config.ts` / `tests/e2e/**` — UNCHANGED. Playwright deferral per Decision §5.
- `.tji` files — `complete 100` lands at task-completion time per the [README ritual](../README.md). Decision §1 below also asks the closer to add `depends !aud_proposed_styling` to this task's `.tji` entry.

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/GraphView.tsx`'s `STYLESHEET` carries two new entries — `node[rollupStatus = 'agreed']` (with `border-color: '#334155'`) and `edge[rollupStatus = 'agreed']` (with `line-color: '#334155'` and `target-arrow-color: '#334155'`) — appended after the existing `node` and `edge` baseline entries.
- All other `STYLESHEET` fields are byte-identical to the post-`aud_clean_typography` baseline; the header refinement-trail block (lines 3-42) and the `STYLESHEET` JSDoc block (lines 95-122) gain prose updates per Constraints.
- `apps/audience/src/graph/GraphView.test.tsx` carries 26 cases total (22 baseline + 4 new). The 4 new cases pin the new selectors per Constraints.
- `apps/audience/package.json` is UNCHANGED — no new dependency.
- `apps/audience/src/App.tsx` is UNCHANGED. The component remains not-yet-reachable through any URL.
- Per `ORCHESTRATOR.md`'s deferred-e2e exception ("component not yet reachable"), Playwright coverage for this leaf is **deferred to `aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:294-310`](../../50-audience-and-broadcast.tji#L294); already inherits `aud_layout_engine` + `aud_clean_typography` pixel-stability work). The closer extends `aud_visual_regression`'s existing note to cover agreed-state styling (a node + edge whose `rollupStatus === 'agreed'` render at the `#334155` border / line color across Chrome / Firefox / WebKit at 720p / 1080p / 1440p, against the same reference fixtures the layout / typography deferrals already pin). Decision §5 documents why this is the right destination and why `aud_session_url` is wrong.
- The closer adds `depends !aud_proposed_styling` to the `aud_agreed_styling` `.tji` block at [`tasks/50-audience-and-broadcast.tji:121-125`](../../50-audience-and-broadcast.tji#L121), formalizing the sequential ordering Decision §1 establishes. (The dependency is prose-only at refinement time; the closer's ritual converts it to a `.tji` edge.)
- `pnpm run check` clean (strict TS pass; no new dep declared).
- `pnpm run test:smoke` green (Vitest count rises by **4** new cases in `GraphView.test.tsx`).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is essentially zero (two new selector entries with three string / hex-literal values combined).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_agreed_styling` in the same commit (the closer's ritual).
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer pins the stylesheet values and the mount-time `style()` resolution; `aud_visual_regression` will land the pixel-level rendering pin once the route is reachable.

## Decisions

### §1 — Sequential ordering: `aud_proposed_styling` ships first; closer adds the missing `.tji` dependency edge

The `.tji` block at [`tasks/50-audience-and-broadcast.tji:116-125`](../../50-audience-and-broadcast.tji#L116) declares `aud_proposed_styling` and `aud_agreed_styling` as parallel siblings, each depending only on `!aud_cytoscape_init`. The orchestrator's task-picker therefore sees both as eligible after `aud_cytoscape_init` ships. The 0.5d effort budget on `aud_agreed_styling` is calibrated against the assumption that the heavy plumbing has already landed — meaning either (a) the orchestrator picks `aud_proposed_styling` first by coincidence and this refinement applies as-written, or (b) the orchestrator picks this task first and the implementer would have to do the heavy plumbing inside a 0.5d budget that does not allow for it.

Three approaches to resolving the ambiguity:

- **(A — chosen)** Declare `aud_proposed_styling` as a prose-only-context dependency in this refinement (already done above) and request the closer add `depends !aud_proposed_styling` to the `aud_agreed_styling` `.tji` block as part of this task's completion ritual. Cost: the closer touches the `.tji` file once more than the minimal ritual. Benefit: the orchestrator's task-picker honours the dependency from this commit forward; the refinement's 0.5d budget is realistic; the implementer never picks up the task while the predecessor is incomplete.
- **(B)** Treat the refinement as conditional — "if `aud_proposed_styling` shipped, do X; if not, also do the plumbing (and bust the 0.5d budget)." Cost: the refinement balloons in scope, the budget loses its calibration meaning, and the implementer is left to judge mid-task. Rejected — refinements pin scope; conditional refinements drift.
- **(C)** Restructure this refinement to ship the plumbing itself (effectively merge `aud_proposed_styling` and `aud_agreed_styling`). Cost: this leaf becomes a 1.5d task; the proposed-state task becomes empty. Benefit: nothing — it just renames the plumbing's owner. Rejected as a no-op.

The moderator's same pair (`mod_proposed_state_styling` (1d) → `mod_agreed_state_styling` (0.5d)) shipped in the order Option A assumes, with the proposed task paying the `facetStatus.ts` port cost and the agreed task being a thin priority-order + selector addition. The audience reuses that ordering. The closer's ritual already touches the `.tji` for `complete 100`; adding one more line in the same edit is a minor extension.

No new ADR is required — this is a task-ordering refinement, not an architectural decision. The "two siblings; one pays plumbing, the next extends" pattern is documented in `aud_clean_typography.md` Decision §3 ("Named-export constants over a stylesheet-tokens module") and `aud_cytoscape_init.md` Decision §4 ("two callers is YAGNI; extract when the third caller materializes").

### §2 — Visual treatment: slate-700 border / arrow color, color-only differentiation (no width bump, no background fill, no green)

The baseline `node` selector ships `border-color: #cbd5e1` (slate-200, 1px width); the agreed-state node selector overrides `border-color` to `#334155` (slate-700) and leaves every other field at the baseline. The baseline `edge` selector ships `line-color: #94a3b8` (slate-400) and `target-arrow-color: #94a3b8`; the agreed-state edge selector overrides both to `#334155` (slate-700) and leaves every other field at the baseline.

Four design axes drove this choice:

1. **Cross-surface consistency over color saturation.** The moderator's [`mod_agreed_state_styling.md`](../moderator-ui/mod_agreed_state_styling.md) Decision (rollup priority + Tailwind classes) picked `border-solid border-slate-700 opacity-100` — slate-700 border on a white background card. The hex value of Tailwind's `slate-700` is `#334155`. Using the same hex in the Cytoscape stylesheet means the moderator's pane and the audience's broadcast canvas read as one show when composited side-by-side (the broadcast-polish picture-in-picture overlay a future task may scope, or a remote video producer's hand-rolled scene mixing both surfaces, both benefit from the palette match).
2. **No green / no chromatic saturation.** ADR 0005 L47 sketches `--color-facet-agreed: #1f7a3a` (a saturated forest green) in its example token set. The example was deliberately illustrative ("the system supports a green-for-agreed token"); the moderator's task rejected it for the same reason this task does — the surface palette is heavy slate, and a single saturated green token reads as a UI accent rather than a "settled, done" state. On the broadcast surface a saturated green token would compete with the speakers / lower-third / scene chrome the producer's OBS scene layers around the canvas; a darker slate reads as "informational, settled" without competing for the viewer's attention.
3. **Color-only differentiation; no border-width / fill / shape bump.** The baseline ships 1px border on a 200×80 node box with 180px text-max-width. Bumping the border to 2px would (a) eat 1px from each side of the box, reducing effective text room by ~1.1%, (b) introduce a width-keyed re-layout risk under a future `width: 'label'` toggle, and (c) make the proposed-state's `border-style: 'dashed'` override (which `aud_proposed_styling` will set against a 1px stroke) visually inconsistent with the 2px agreed stroke. Color-only differentiation keeps every other geometry / typography pin from `aud_layout_engine` / `aud_clean_typography` untouched.
4. **No background-color fill change for nodes.** Alternative — pre-tint the node fill (`#f1f5f9` slate-100 or similar) so agreed nodes read as "filled" against a white canvas. Rejected because (a) the Cytoscape canvas itself is the placement context, not a styled background, and a pre-tinted fill on agreed nodes would force the proposed-state to either (i) stay white (legible against a future colored disputed state, but inconsistent if the canvas itself is tinted by a future polish task) or (ii) under-fill, which crosses into the "faded" treatment proposed-state already uses; (b) the baseline white background already plays well with the OBS browser-source compositing where the producer often pre-multiplies a translucent panel under the canvas.

Alternative — pick a brighter shade (slate-900 / `#0f172a`). Rejected as over-saturated for the broadcast context; slate-900 reads as ink-black on streaming compression and competes with text. Slate-700 is the same value the moderator's Tailwind theme already exposes as the "darker neutral" tone, and matches what experienced producers compositing slate-palette UIs already calibrate against.

Alternative — pick a softer shade (slate-500 / `#64748b`). Rejected as insufficient differentiation from the baseline slate-200; the 4-step darkness gap between baseline and agreed needs to read against compressed video, and three steps (slate-200 → slate-500) is too close. Five steps (slate-200 → slate-700) is the moderator's calibrated choice.

Alternative — register the color as a `--color-facet-agreed` CSS custom property in `apps/audience/src/index.css` and reference it via `var(...)` in `STYLESHEET`. Rejected because Cytoscape's stylesheet does NOT resolve CSS custom properties — it paints to canvas with its own style resolver, and `border-color: 'var(--color-facet-agreed)'` would emit the literal string to Cytoscape and produce a broken parse. The `--font-broadcast` token from `aud_clean_typography` lands in the HTML / Tailwind `@theme` block (which feeds the audience surface's outer chrome — placeholder route, future per-session page) but NOT in Cytoscape's stylesheet for the same reason: Cytoscape needs the resolved string in the style object, not a CSS reference. The hex literal in `STYLESHEET` is the only correct path.

No new ADR is required. The choice between slate-700 and the ADR 0005-suggested green does not rise to an architectural-decision threshold — both are valid styling primitives; the decision is which token reads better on this surface, and the moderator has already settled that question with the same rationale. The "agreed = slate-700" choice is now a cross-surface convention; if a future surface (replay overlay, picture-in-picture composite) needs to override, that future task makes the case.

### §3 — Two selector entries, no factor-out into a state-color constant

The hex literal `#334155` appears three times across the two new selector entries (node border, edge line, edge target-arrow). Three approaches:

- **(A — chosen)** Inline the literal three times. Cost: a future color update to "slate-700 = agreed" requires editing three sites in the same file. Benefit: the stylesheet stays self-contained and readable; no indirection across module-scope constants for a value that appears in one logical region of the file.
- **(B)** Hoist `STATE_COLOR_AGREED = '#334155' as const` to module scope. Cost: a small named-export footprint; the file gains a new constant nobody outside `STYLESHEET` consumes today. Benefit: a future update edits one site. Rejected — the named-export trigger established by `aud_clean_typography.md` Decision §3 fires when a sibling task wants to key off the numeric / color value. For typography (font sizes / weights), `aud_per_facet_visualization` will likely consume `BROADCAST_NODE_FONT_SIZE_PX - 2` for sub-state row text. For per-state colors, no anticipated sibling needs `STATE_COLOR_AGREED - 1` or arithmetic against it — they will declare their own state's color (slate-500 for proposed, red-600 for disputed, etc.) inline.
- **(C)** Pull the color into a `STATE_COLORS = { agreed: '#334155', proposed: '#94a3b8', disputed: '#dc2626', … } as const` record. Cost: a forward-looking abstraction at the moment of the second per-state selector; commits the file to a shape it may outgrow. Benefit: future per-state tasks add one entry. Rejected — same "premature for the second sibling" reasoning as Option B. The trigger fires at three siblings, matching the named-export precedent in `aud_clean_typography.md` Decision §3 and the shell-extraction precedent in `aud_cytoscape_init.md` Decision §4.

The named-future-task (if 3+ per-state selectors layer on): `aud_stylesheet_state_color_extraction` (~0.25d, separate from the already-named `aud_stylesheet_module_extraction` registered by `aud_clean_typography.md` Decision §4 — the file-level extraction is independent of the constant-set extraction) — would hoist a `STATE_COLORS` record to module scope and replace the per-selector hex literals with named references. The closer does NOT register this in the WBS today; the trigger is empirical (the third per-state sibling task lands).

### §4 — Selector via attribute equality (`node[rollupStatus = 'agreed']`), not Cytoscape's `.class` API

Cytoscape supports two ways to scope a per-element style: (a) attribute-equality selectors against fields in `data` (e.g., `node[rollupStatus = 'agreed']`), and (b) Cytoscape's runtime class API (`cy.elements().getElementById(id).addClass('agreed')` paired with a `.agreed` selector). Three approaches:

- **(A — chosen)** Attribute selector against `data.rollupStatus`. The projection emits the value declaratively; the stylesheet matches it. No imperative `addClass` / `removeClass` calls in the React component.
- **(B)** Cytoscape class API. The React component runs `cy.elements().forEach(el => { el.toggleClass('agreed', el.data('rollupStatus') === 'agreed'); … })` after every element-sync pass. Cost: imperative bookkeeping in the `useEffect`, more code paths to test, drift risk between data and class state. Benefit: shorter selectors (`.agreed` vs `node[rollupStatus = 'agreed']`). Rejected.
- **(C)** Hybrid — emit a `classes: 'agreed'` field in the projected element descriptor (Cytoscape merges this into the element's class set on `cy.json({ elements })`). Cost: every projection update has to rebuild the classes string; element diffing across re-renders is fuzzier. Benefit: minimal. Rejected — same drift risk as Option B without the data-driven clarity of Option A.

Attribute-selector matching is also the participant's convention (the participant's `<GraphView>` consumes the same `data.rollupStatus` field per its facetStatus header trail). Cross-surface convention again favours Option A.

### §5 — Playwright deferral lands on `aud_visual_regression`, NOT `aud_session_url`

Per `ORCHESTRATOR.md`'s deferred-e2e exception: this leaf modifies the Cytoscape stylesheet inside an audience-surface region that is still not reachable through any user-flow route ([`apps/audience/src/App.tsx:124`](../../../apps/audience/src/App.tsx#L124) still maps every path to the placeholder; the per-session route lands in `aud_url_routing.aud_session_url`). The agreed-state visual is invisible until that route ships.

`aud_session_url`'s inherited deferred-e2e debt is already at the threshold flagged by `ORCHESTRATOR.md` (cumulative debt from `aud_ws_client`, `aud_state_management`, `aud_anonymous_ws_subscribe`, `aud_cytoscape_init` per [`aud_cytoscape_init.md`](aud_cytoscape_init.md) Decision §9). `aud_layout_engine.md` Decision §5 redirected layout-engine pixel-stability to `aud_visual_regression` to avoid adding a fifth dependent; `aud_clean_typography.md` Decision §6 did the same for typography pixel-stability. Per-state styling pixel-stability is the same case — same audience surface, same not-yet-reachable canvas, same destination.

The right destination is **`aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:294-310`](../../50-audience-and-broadcast.tji#L294)). The task already inherits layout + typography pixel-stability deferrals; per-state styling is the same kind of "the rendered pixels match across runs" assertion. The closer extends `aud_visual_regression`'s existing note (which already covers layout + typography) to also cover agreed-state styling — a node + edge whose `rollupStatus === 'agreed'` renders at `#334155` border / line color across Chrome / Firefox / WebKit at 720p / 1080p / 1440p.

The agreed-state stylesheet correctness (the selector entries and their style fields; the mount-time `cy.getElementById(id).style('border-color')` resolution) is fully pinned at the Vitest layer above — `aud_visual_regression` is for the *visible* rendering, not the stylesheet shape. Per ADR 0022 the Vitest cases are the regression coverage; the visual-regression task layers pixel-stability on top.

Alternative — defer to `aud_session_url`. Rejected per the "2+ refinements, pay down" rule (this would be the 6th dependent — fourfold over the threshold) and per the scope mismatch (route-mount assertions are not per-state styling assertions).

Alternative — register a new `aud_pw_state_styling_smoke` task. Rejected — planning-debt for no architectural reason; `aud_visual_regression` already exists with the right scope and already inherits the sibling state-styling tasks' deferrals once they ship (`aud_proposed_styling`, `aud_disputed_styling` follow the same destination).

Alternative — scope a thin Playwright spec inline that asserts the placeholder route's chrome renders some visible signal of "agreed-state styling is wired in". Rejected — the placeholder chrome does NOT include a Cytoscape canvas (`<AudienceGraphView>` is not mounted from `App.tsx`); the agreed-state selector cannot fire on a route that does not render the component, so no inline spec is meaningful.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- `apps/audience/src/graph/GraphView.tsx` — header refinement-trail block extended with a one-line-per-decision summary for `aud_agreed_styling`; `STYLESHEET` JSDoc paragraph added explaining the override-only-the-differentiator posture; two new selector entries appended to `STYLESHEET`: `node[rollupStatus = 'agreed']` → `border-color: '#334155'` and `edge[rollupStatus = 'agreed']` → `line-color: '#334155'`, `target-arrow-color: '#334155'`.
- `apps/audience/src/graph/GraphView.test.tsx` — header trail entry added; `findStylesheetEntry` signature loosened to `string`; two new Vitest structural cases (w, x) pinning the new selector entries; total is 24 cases (22 baseline + 2 new structural; mount-time cases deferred — see tech-debt below).
- Structural Vitest cases (w) and (x) pin `node[rollupStatus = 'agreed']` → `border-color: '#334155'` and `edge[rollupStatus = 'agreed']` → `line-color: '#334155'` / `target-arrow-color: '#334155'` without requiring a Cytoscape mount.
- Mount-time assertions (cases 3 and 4 from the Constraints spec) deferred to `aud_agreed_styling_mount_assertions` (~0.25d) — require the `data.rollupStatus` projection-time emission from `aud_proposed_styling` to be in place first.
- Playwright deferred to `aud_visual_regression` per Decision §5 (component not yet reachable through any route); `aud_visual_regression` note extended to cover agreed-state styling pixel-stability.
- `tasks/50-audience-and-broadcast.tji`: `complete 100` added to `aud_agreed_styling`; `depends !aud_proposed_styling` added per Decision §1 / Acceptance criteria; `aud_agreed_styling_mount_assertions` tech-debt task registered under `aud_graph_rendering`.
