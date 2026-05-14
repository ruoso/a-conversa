# Moderator disputed-state styling (red marker / red border for disputed entities)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_disputed_state_styling` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**:
- `moderator_ui.mod_graph_rendering.mod_proposed_state_styling` (done — landed `facetStatus.ts`, the `FacetStatusIndex`, `cardRollupStatus`, the per-component `data-facet-status` seam, and the proposed-state Tailwind / SVG-style branches).
- `moderator_ui.mod_graph_rendering.mod_agreed_state_styling` (done — pinned the rollup priority order `proposed > meta-disagreement > disputed > agreed > committed > withdrawn`, widened the per-component `data-facet-status` seam to stamp the attribute for every non-`undefined` rollup status, and landed the agreed-state className branch).

## What this task is

Visually mark nodes and edges whose facets are in the **disputed** state — at least one current participant has voted `dispute` on the facet (or withdrawn against an uncommitted facet), and the methodology requires the moderator to surface and resolve the disagreement before the entity can be committed. This is the third of the three baseline agreement-layer visual states; with `mod_proposed_state_styling` and `mod_agreed_state_styling` already landed, the disputed-state branch completes the baseline `proposed / agreed / disputed` triad. (The fourth agreement-layer state, `meta-disagreement`, gets its own dedicated split rendering via `mod_meta_disagreement_split_render`.)

This task lands:

- A disputed-state branch in `StatementNode.tsx` that applies a red marker — `border-solid border-rose-600 ring-2 ring-rose-500 opacity-100` Tailwind classes — when `cardRollupStatus(facetStatuses) === 'disputed'`. The ring is the "this needs resolution" red marker the moderator scans for; combined with the solid `border-rose-600` it's unambiguous against both the unstyled baseline (`border-slate-300`) and the agreed variant (`border-slate-700`).
- A disputed-state branch in `StatementEdge.tsx` that applies `style={{ stroke: '#e11d48' }}` (the `rose-600` hex) when `facetStatuses.substance === 'disputed'`. Solid stroke at full opacity (no `strokeDasharray`, no `opacity` override) in red — the BaseEdge default behaviors stay except for the stroke color.
- Tests for the disputed branch on both node + edge.

This task is rendering-only. The vote-capture flow that drives a facet into the disputed state is owned by `mod_capture_flow.mod_propose_action` + `mod_pending_proposals_pane.mod_vote_indicators_in_sidebar`; here we just show the visual state of what's already in the log.

The `data-facet-status="disputed"` attribute is already stamped on both the card root and the role-label pill (the agreed-state task widened the seam to cover every non-`undefined` rollup status); this task only wires the className / inline-style branch.

## Why it needs to be done

Disputed is the methodology's "resolution required" agreement-layer state — when a participant has voted `dispute` (or withdrawn against an uncommitted facet), the moderator MUST surface the disagreement and pick a resolution path (decomposition, amendment, break-edge, accept-as-bedrock) before the entity can be committed. Without disputed-state styling, the moderator can't tell at a glance which facets are blocking commit from which are still gathering votes (proposed) or pre-commit-ready (agreed). The proposed-state task landed the projection plumbing; the agreed-state task pinned the rollup priority order; this task is the third class-name branch on the same seam, and the load-bearing visual that surfaces "this needs your attention" to the moderator.

The red marker is the load-bearing visual cue. Per the methodology, agreement-layer disputes are the moderator's most action-requiring surface (alongside meta-disagreement, which sits one priority level higher). A red border + ring conveys "blocking, requires attention" at a single glance across a dense canvas — the standard semantic for "something is wrong here" that the moderator can scan without reading the per-facet detail.

## Inputs / context

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface; the custom node / edge components are the extension points for state styling.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the locale-aware mount the components already use; the styling is locale-independent but the rendering still passes through `useTranslation` so we keep the existing test infrastructure.
- `tasks/refinements/moderator-ui/mod_proposed_state_styling.md` — the grandparent task; landed `facetStatus.ts`, `FacetStatusIndex`, `cardRollupStatus`, and the per-component `data-facet-status` seam.
- `tasks/refinements/moderator-ui/mod_agreed_state_styling.md` — the predecessor task; pinned the rollup priority order (`proposed > meta-disagreement > disputed > agreed > committed > withdrawn`), widened the seam to cover every non-`undefined` status, and added the second className branch. This task adds the third.
- `apps/moderator/src/graph/facetStatus.ts` — the `FacetStatus` enum (`proposed | agreed | disputed | committed | withdrawn | meta-disagreement`). No change needed here; the derivation rules already produce `'disputed'` correctly when any current participant has voted `dispute` (or withdrawn against an uncommitted facet).
- `apps/moderator/src/graph/StatementNode.tsx` — the `cardRollupStatus` function and the className-branch ternary chain this task extends.
- `apps/moderator/src/graph/StatementEdge.tsx` — the substance-status-driven styling this task extends with the disputed branch (an inline-style `stroke` override on the `<BaseEdge>` path).

## Constraints / requirements

- **`StatementNode` disputed branch**: when `cardRollupStatus(facetStatuses) === 'disputed'`, the card carries `border-solid border-rose-600 ring-2 ring-rose-500 opacity-100` Tailwind classes (replacing the baseline `border-slate-300`). The `data-facet-status="disputed"` attribute is already stamped by the agreed-state seam widening; no further root-prop change is needed.
- **`StatementEdge` disputed branch**: when `facetStatuses.substance === 'disputed'`, the rendered `<BaseEdge>` path carries `style={{ stroke: '#e11d48' }}` (the `rose-600` hex). No `strokeDasharray` override and no `opacity` override — the disputed visual is solid stroke at full opacity, in red. The caller-provided `style` (if any) and the role-label `data-facet-status="disputed"` attribute (already stamped by the agreed-state seam widening) remain intact.
- **Rollup priority is NOT changed.** `mod_agreed_state_styling` pinned the order (`proposed > meta-disagreement > disputed > agreed > committed > withdrawn`); this task only adds a className / style branch for one of the already-existing rollup outcomes. No edits to `cardRollupStatus` or the `ROLLUP_PRIORITY` constant.
- **Tests** (committed, per ADR 0022):
  - `apps/moderator/src/graph/StatementNode.test.tsx` extended with:
    - 1 case: disputed classification applies `border-rose-600 ring-2 ring-rose-500` + `data-facet-status="disputed"`, no `border-dashed`.
    - 1 case: disputed beats agreed in the rollup → card reads as disputed (sanity check that the priority chain is wired all the way through to the className branch, not just the rollup function).
    - 1 case: proposed wins over disputed (priority — already covered indirectly by the agreed task's tests, but pinned here for the disputed-styling perspective).
    - 3 cases × 3 locales: cross-locale rendering — the disputed styling applies regardless of the active locale.
  - `apps/moderator/src/graph/StatementEdge.test.tsx` extended with:
    - 1 case: substance=disputed stamps `data-facet-status="disputed"` on the role-label pill (this assertion exists implicitly in the agreed-state seam widening, but is pinned here to lock in the disputed-state perspective).
    - 1 case: substance=disputed renders the BaseEdge path with `stroke="#e11d48"` (or `style="stroke: rgb(225, 29, 72)"` — happy-dom may serialize the inline style either way) and NO `stroke-dasharray` and NO inline `opacity`.

## Acceptance criteria

- `apps/moderator/src/graph/StatementNode.tsx` carries the new disputed-state className branch.
- `apps/moderator/src/graph/StatementEdge.tsx` carries the new disputed-state inline-style branch (red stroke).
- All test files listed above contain the listed cases.
- `pnpm run check` clean.
- `pnpm run test:smoke` green (test count rises by the new cases).
- `pnpm -F @a-conversa/moderator build` succeeds.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_disputed_state_styling` plus a `note "Refinement: …"` line.

## Decisions

- **Red-marker shape: solid `border-rose-600` + `ring-2 ring-rose-500` on nodes.** Two visual signals stacked: the border switches from the baseline `border-slate-300` to red (the unambiguous "warning" semantic), and a 2-px ring in a slightly-brighter `rose-500` halos the card so it's visible even against a busy canvas. Both Tailwind classes resolve against the default Tailwind palette already used elsewhere in the moderator (no design-tokens package exists yet — `packages/ui-tokens` is a future workstream noted in `mod_annotation_rendering`'s decisions). The combination — solid red border + ring — is distinctly different from both the unstyled baseline (light slate, no ring) and the agreed variant (dark slate, no ring), and from the proposed variant (dashed slate, opacity-60, no ring). `opacity-100` is explicit to cancel any inherited dim opacity (defense against className composition).
- **Why ring + border, not a corner badge.** A corner badge (a small dot or `!` glyph) was considered but adds DOM weight and competes for the same screen-corner space the annotation-badge row uses. A ring is purely a CSS-class addition (no extra elements), composes cleanly with the rest of the card, and reads as "this entire entity is flagged" at a single glance — exactly the load-bearing signal. The corner-badge alternative is reserved for the per-facet visualization task (`mod_per_facet_state_visualization`), where individual facets within a card need their own markers.
- **Red color: `rose-600` for the border, `rose-500` for the ring** (Tailwind palette). `rose-600` (`#e11d48`) is darker and reads as the "primary" red of the marker; `rose-500` (`#f43f5e`) is lighter and works as the ring halo. Both are stock Tailwind v3 palette colors; if a future design-tokens package replaces them, the contract is "use the project's `danger` / `error` color family" — these particular shades are the v1 placeholder.
- **Disputed-state edge styling: red stroke, no dasharray, full opacity.** Edges have one facet (substance) in v1 and one visual axis (the path stroke). Solid red stroke is the unambiguous "disputed" signal; we don't add `strokeDasharray` (that's the proposed visual) and we don't dim with `opacity` (the disputed state is fully attention-grabbing, not faded). The stroke color is `#e11d48` (rose-600) — the same red as the node border, for visual consistency across nodes and edges in the same disputed state. We use an inline `style.stroke` rather than a Tailwind class because `<BaseEdge>` renders a raw `<path>` element inside ReactFlow's SVG and the canonical extension point is the `style` prop (the same pattern the proposed-state task uses for `strokeDasharray` / `opacity`).
- **No rollup priority change.** The agreed-state task pinned the order `proposed > meta-disagreement > disputed > agreed > committed > withdrawn`. This task only adds a rendering branch for one of those values; the order itself is the historical record of the `mod_agreed_state_styling` Decisions and is not reopened here.
- **Seam was already widened.** The agreed-state task widened the `data-facet-status` attribute stamping to cover every non-`undefined` rollup status (not just `proposed`). The disputed-state attribute is already on the rendered DOM by the time this task starts. We add only the className / inline-style branch — no further root-prop change.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

- Updated `apps/moderator/src/graph/StatementNode.tsx` — added the third className branch to the `styleClassName` ternary chain: when `cardRollupStatus(facetStatuses) === 'disputed'`, the card carries `border-solid border-rose-600 ring-2 ring-rose-500 opacity-100`. The proposed and agreed branches are unchanged; the baseline (`border-slate-300`) still catches every other rollup status until its sibling refinement lands its own branch. The `data-facet-status="disputed"` attribute is already stamped on the card root by the agreed-state seam widening; no further root-prop change was needed. The component header comment + the rollup-branch JSDoc comment were extended to mention the disputed branch.
- Updated `apps/moderator/src/graph/StatementEdge.tsx` — added a parallel disputed-state inline-style branch alongside the proposed-state one: when `substanceStatus === 'disputed'`, `disputedEdgeStyle = { stroke: '#e11d48' }` (the `rose-600` hex). The two per-status overrides are coalesced (only one fires at a time since the substance facet has exactly one status), then composed with any caller-provided `style` and passed through to `<BaseEdge>`. The role-label `data-facet-status="disputed"` attribute is already stamped by the agreed-state seam widening. Header comment + the rollup-branch JSDoc were extended.
- New `tasks/refinements/moderator-ui/mod_disputed_state_styling.md` (this file).
- Updated `apps/moderator/src/graph/StatementNode.test.tsx` — added 6 new disputed-state cases under a new describe block: disputed classification applies the red-marker className + `data-facet-status="disputed"`; disputed beats agreed in the rollup (priority chain wired through to the className branch); proposed beats disputed (the rollup priority is unchanged by this task — proposed still wins); 3 cross-locale cases verify the disputed-state styling applies regardless of active locale. Total file: 49 cases (was 43).
- Updated `apps/moderator/src/graph/StatementEdge.test.tsx` — added 2 new disputed-state cases under a new describe block: substance=disputed stamps `data-facet-status="disputed"` on the role-label pill; substance=disputed renders the `<BaseEdge>` path with the red stroke (`#e11d48` / `rgb(225, 29, 72)`), no `stroke-dasharray`, and no inline `opacity`. Total file: 30 cases (was 28).
- `pnpm run check` clean. `pnpm run test:smoke` green — total `apps/moderator/src/graph/` cases 158 (was 150: +6 on `StatementNode.test.tsx`, +2 on `StatementEdge.test.tsx`). Full-repo total 2195. `pnpm -F @a-conversa/moderator build` green. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream consumers — `mod_meta_disagreement_split_render` (the next sibling state-styling task), `mod_per_facet_state_visualization`, `mod_vr_state_styling`, and any future Playwright test selecting on `[data-facet-status="disputed"]` — now have the third class-name / inline-style branch in place. The rollup priority order (`proposed > meta-disagreement > disputed > agreed > committed > withdrawn`) and the data-attribute stamping are still those pinned by `mod_agreed_state_styling`; this task did not change them.
