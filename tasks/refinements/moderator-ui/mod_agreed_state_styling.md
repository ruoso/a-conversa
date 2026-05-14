# Moderator agreed-state styling (solid border, full opacity, darker tone for unanimously-agreed entities)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_agreed_state_styling` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 0.5d
**Inherited dependencies**:
- `moderator_ui.mod_graph_rendering.mod_proposed_state_styling` (done — landed `facetStatus.ts`, the `FacetStatusIndex`, `cardRollupStatus`, the per-component `data-facet-status` seam, and the proposed-state Tailwind / SVG-style branches).

## What this task is

Visually mark nodes and edges whose facets are in the **agreed** state — every current participant has voted `agree` on the facet but no commit / dispute / meta-disagreement event has landed yet. Per the methodology, agreed is the "fully aligned, awaiting moderator commit" agreement-layer state. Together with `mod_proposed_state_styling` (in-flight) and `mod_disputed_state_styling` (red-marker) this lands the second of the three baseline agreement-layer visual states, and pins the rollup priority order the rest of the sibling state-styling tasks build on.

This task lands:

- An extended `cardRollupStatus` in `apps/moderator/src/graph/StatementNode.tsx` that returns the highest-priority status across all facets per the documented priority order, not just `'proposed' | undefined`.
- An agreed-state branch in `StatementNode.tsx` that applies `border-solid border-slate-700 opacity-100` Tailwind classes when the rollup is `'agreed'`, plus `data-facet-status="agreed"` on the card root.
- An agreed-state branch in `StatementEdge.tsx` that stamps `data-facet-status="agreed"` on the role-label pill when the substance facet is `'agreed'`, and applies no inline style overrides (the BaseEdge default is solid stroke + full opacity, which IS the agreed-state visual).
- A widened seam: ANY rollup status (`'proposed'`, `'agreed'`, `'disputed'`, `'committed'`, `'meta-disagreement'`, `'withdrawn'`) now stamps the `data-facet-status` attribute on the card / label, even if its className branch hasn't shipped yet. This lets downstream Playwright / unit tests target every state seamlessly as each sibling refinement adds its className branch.
- Tests covering: agreed-state rendering, rollup priority pair-wise (proposed > agreed, agreed > committed, disputed > agreed, etc.), and the cross-locale invariance of the agreed-state styling.

This task is rendering-only. The vote-capture flow that puts a facet into the agreed state lives in `mod_capture_flow.mod_propose_action` + `mod_pending_proposals_pane.mod_vote_indicators_in_sidebar`; here we just show the visual state of what's already in the log.

## Why it needs to be done

The methodology distinguishes four agreement-layer states for every facet (`proposed | agreed | disputed | meta-disagreement`). Without a distinct agreed-state visual, the moderator can't tell at a glance which facets have already cleared every-participant agreement (and are ready to commit) from which are still gathering votes. The proposed-state task landed the projection plumbing and the `cardRollupStatus` seam; this task is the second class-name branch on the same seam.

Critically, this task also pins **the rollup priority order** the sibling state-styling tasks will all build on. The proposed-state task implemented a binary "any facet is proposed → proposed; else undefined" rollup; that's no longer sufficient once `agreed` is a recognized status. The priority order chosen here (`proposed > meta-disagreement > disputed > agreed > committed > withdrawn`) is what every subsequent sibling task (`mod_disputed_state_styling`, `mod_meta_disagreement_split_render`, `mod_per_facet_state_visualization`) inherits as its rendering contract.

## Inputs / context

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface; the custom node / edge components are the extension points for state styling.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the locale-aware mount the components already use; the styling is locale-independent but the rendering still passes through `useTranslation` so we keep the existing test infrastructure.
- `tasks/refinements/moderator-ui/mod_proposed_state_styling.md` — the predecessor task; landed `facetStatus.ts`, `FacetStatusIndex`, `cardRollupStatus`, and the per-component `data-facet-status` seam. This task extends the rollup and adds the second className branch.
- `apps/moderator/src/graph/facetStatus.ts` — the `FacetStatus` enum (`proposed | agreed | disputed | committed | withdrawn | meta-disagreement`). No change needed here; the derivation rules already produce `'agreed'` correctly when every current participant has voted agree.
- `apps/moderator/src/graph/StatementNode.tsx` — the `cardRollupStatus` function and the className-branch logic this task extends.
- `apps/moderator/src/graph/StatementEdge.tsx` — the substance-status-driven styling this task extends with the agreed branch.

## Constraints / requirements

- **`cardRollupStatus` extension**: returns the highest-priority status per `ROLLUP_PRIORITY` (`proposed > meta-disagreement > disputed > agreed > committed > withdrawn`) when at least one facet status is present, else `undefined`. Exported so the test suite can pin the rollup logic without re-rendering.
- **`StatementNode` agreed branch**: when `cardRollupStatus(facetStatuses) === 'agreed'`, the card carries `border-solid border-slate-700 opacity-100` in its className (replacing the baseline `border-slate-300`) and `data-facet-status="agreed"` on the root.
- **`StatementNode` seam widening**: every non-`undefined` rollup status stamps `data-facet-status="<status>"` on the card root, even if the className branch for that status hasn't shipped yet. The className falls back to the unstyled baseline (`border-slate-300`) until the sibling task lands its branch.
- **`StatementEdge` agreed branch**: when `facetStatuses.substance === 'agreed'`, the role-label pill carries `data-facet-status="agreed"`. No inline `style` override is applied — the BaseEdge default (solid stroke + full opacity) is exactly the agreed-state visual.
- **`StatementEdge` seam widening**: every non-`undefined` substance status stamps `data-facet-status="<status>"` on the role-label pill. Inline style overrides only apply for the proposed branch (other branches are added by their own sibling refinements).
- **Tests** (committed, per ADR 0022):
  - `apps/moderator/src/graph/StatementNode.test.tsx` extended with:
    - 1 case: agreed classification applies `border-solid border-slate-700 opacity-100` + `data-facet-status="agreed"`.
    - 1 case: every facet agreed produces `data-facet-status="agreed"` (uniform-set rollup).
    - 1 case: proposed wins over agreed in the rollup (priority).
    - 1 case: agreed beats committed in the rollup.
    - 3 cases × 3 locales: cross-locale rendering — agreed styling is locale-independent.
    - 1 *updated* case: the prior `does not apply proposed styling when only agreed/disputed/committed` test (previously asserted `data-facet-status` is `null` for the mixed set) is updated to assert the rollup now returns `'disputed'` (the highest-priority status in the set) and stamps that attribute. The className still does NOT contain `border-dashed` because no facet is proposed.
    - 7 direct unit cases on `cardRollupStatus`: empty record, single-status, and one case per priority pair (`proposed > everything`, `meta-disagreement > disputed/agreed/committed/withdrawn`, `disputed > agreed/committed/withdrawn`, `agreed > committed/withdrawn`, `committed > withdrawn`).
  - `apps/moderator/src/graph/StatementEdge.test.tsx` extended with:
    - 1 case: substance=agreed stamps `data-facet-status="agreed"` on the role-label pill.
    - 1 case: substance=agreed does NOT apply the dashed-stroke / opacity overrides (the rendered `path` element has no `stroke-dasharray` attribute and no inline `opacity`).

## Acceptance criteria

- `apps/moderator/src/graph/StatementNode.tsx` carries the extended `cardRollupStatus` with the documented priority order and the new agreed-state className branch.
- `apps/moderator/src/graph/StatementEdge.tsx` carries the substance-status-driven `data-facet-status` seam widening (every non-`undefined` substance status stamps the attribute; only the proposed branch applies style overrides today).
- All test files listed above contain the listed cases.
- `pnpm run check` clean.
- `pnpm run test:smoke` green (test count rises by the new cases).
- `pnpm -F @a-conversa/moderator build` succeeds.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_agreed_state_styling` plus a `note "Refinement: …"` line.

## Decisions

- **Rollup priority order: `proposed > meta-disagreement > disputed > agreed > committed > withdrawn`.** Two design axes drive this:
  1. **"Things you can act on" sort first.** `proposed` means "votes still coming in, the moderator can drive the proposal toward agreement or surface the dispute"; `meta-disagreement` means "the methodology engine flagged this — the moderator MUST attend to it"; `disputed` means "a participant has rejected; the moderator needs to surface the disagreement". `agreed` means "ready to commit but moderator hasn't yet"; `committed` / `withdrawn` are closed.
  2. **Within the agreement layer, `proposed` outranks `disputed` outranks `agreed` because `proposed` is "still gathering votes"** — the moderator's most active surface. `disputed` outranks `agreed` because a dispute should pull the moderator's attention even if another facet is agreed (the disputed facet blocks the overall entity from being committed).
  3. **`meta-disagreement` slots between `proposed` and `disputed`** because it's a methodology-engine escalation — more urgent than a normal `disputed` (it requires the moderator to mark the entity meta-disagreed, not just resolve a dispute), but a still-in-flight `proposed` facet should sort above it because the proposed facet is the moderator's most immediate driving action.
  4. **`committed` outranks `withdrawn`** by convention; the two closed states share visual treatment (both reach the BaseEdge / baseline visual today), and neither will dominate a card in practice — most cards in a session-in-progress have at least one open-state facet.
- **Agreed-state Tailwind classes for nodes: `border-solid border-slate-700 opacity-100`.** Solid border + full opacity is the "unstyled baseline" structurally, but the unstyled baseline uses `border-slate-300` (light gray, the "nothing has happened here yet" tone). The agreed-state variant darkens the border to `border-slate-700` so the visual differentiation from the baseline is unambiguous. Explicit `border-solid` cancels any inherited dashed border (defense against className composition); explicit `opacity-100` does the same for any inherited dim opacity.
- **Agreed-state edge styling: no inline style override.** Edges in v1 use ReactFlow's `<BaseEdge>` with no `style` prop — the result is a solid stroke at full opacity, which is exactly the agreed-state visual. Adding a no-op `style={{ strokeDasharray: 'none', opacity: 1 }}` would only matter if another caller injected a dashed style, which doesn't happen in v1; we prefer "no override" today for clarity, and the next sibling task (`mod_disputed_state_styling`) is where a real edge-style override gets composed.
- **Seam widening: every rollup status stamps `data-facet-status`.** Even though `mod_disputed_state_styling`, `mod_meta_disagreement_split_render`, etc. haven't shipped their className branches yet, the rollup function knows the right status for any facet record. Stamping `data-facet-status="<status>"` even before the styling lands gives every future visual-regression test, every future Playwright selector, and every future sibling refinement a stable seam to extend. The Tailwind className for unhandled statuses falls back to the baseline (no visual change yet); only the data attribute is forward-looking.
- **Updated test: "no styling when only agreed/disputed/committed".** The proposed-state task's test asserted that a mixed `{ classification: 'agreed', substance: 'committed', wording: 'disputed' }` record left `data-facet-status` null. That was correct under the binary `'proposed' | undefined` rollup; under the new priority-order rollup, `disputed` (the highest-priority status in the mix) wins, and the attribute stamps `data-facet-status="disputed"`. The className still does NOT contain `border-dashed` (no facet is proposed). The updated assertion + the inline comment explain the priority-order change.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

- Updated `apps/moderator/src/graph/StatementNode.tsx` — extended `cardRollupStatus` to return the highest-priority status per the `ROLLUP_PRIORITY` array (`proposed > meta-disagreement > disputed > agreed > committed > withdrawn`). The component now composes the card className from a baseline (`rounded-md border bg-white shadow-sm px-3 py-2 min-w-[12rem] max-w-[18rem]`) and a status-driven `styleClassName` (`border-dashed border-slate-400 opacity-60` for `'proposed'`; `border-solid border-slate-700 opacity-100` for `'agreed'`; `border-slate-300` for every other status today). Every non-`undefined` rollup status stamps `data-facet-status="<status>"` on the card root — the stable seam for the still-unshipped sibling state-styling tasks (`mod_disputed_state_styling`, `mod_meta_disagreement_split_render`, etc.).
- Updated `apps/moderator/src/graph/StatementEdge.tsx` — the substance status now drives the `data-facet-status` attribute on the role-label pill for any non-`undefined` value (was: only stamped for `'proposed'`). The inline style override remains scoped to the proposed branch (the BaseEdge default is exactly the agreed-state visual; the disputed / meta-disagreement / etc. styling branches land in their own refinements).
- New `tasks/refinements/moderator-ui/mod_agreed_state_styling.md` (this file).
- Updated `apps/moderator/src/graph/StatementNode.test.tsx` — added 6 new agreed-state cases (single-facet agreed, all-facets agreed, proposed-wins-over-agreed, agreed-beats-committed, 3 cross-locale cases) and 7 direct `cardRollupStatus` unit cases (empty, single-status, and one per priority pair). Updated the existing "no styling when only agreed/disputed/committed" case (renamed to reflect the new priority-order semantics) to assert the new rollup picks `'disputed'`. Test helper import extended to include `cardRollupStatus`.
- Updated `apps/moderator/src/graph/StatementEdge.test.tsx` — added 2 new agreed-state cases under a new describe block: substance=agreed stamps `data-facet-status="agreed"` on the role-label pill; substance=agreed does not apply the dashed-stroke / opacity overrides (the rendered `path` has no `stroke-dasharray` and no inline `opacity`).
- `pnpm run check` clean. `pnpm run test:smoke` green. `pnpm -F @a-conversa/moderator build` green. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream consumers — the sibling state-styling tasks (`mod_disputed_state_styling`, `mod_meta_disagreement_split_render`), `mod_per_facet_state_visualization`, `mod_vr_state_styling`, and any Playwright test selecting on `[data-facet-status="<status>"]` — now have the rollup priority order pinned and the stable seam attribute for every rollup status. Each subsequent sibling task only needs to add its className branch to the `styleClassName` ternary chain (for nodes) and its inline-style override (for edges); the rollup logic and the data-attribute stamping are already in place.
