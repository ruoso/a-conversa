# Moderator meta-disagreement split rendering (violet double-border / dotted-stroke for unresolved disposition)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_meta_disagreement_split_render` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**:
- `moderator_ui.mod_graph_rendering.mod_proposed_state_styling` (done — landed `facetStatus.ts`, the `FacetStatusIndex`, `cardRollupStatus`, the per-component `data-facet-status` seam, and the proposed-state Tailwind / SVG-style branches).
- `moderator_ui.mod_graph_rendering.mod_agreed_state_styling` (done — pinned the rollup priority order `proposed > meta-disagreement > disputed > agreed > committed > withdrawn`, widened the per-component `data-facet-status` seam to stamp the attribute for every non-`undefined` rollup status, and landed the agreed-state className branch).
- `moderator_ui.mod_graph_rendering.mod_disputed_state_styling` (done — landed the third className branch and the red-stroke inline-style branch on the edge).

## What this task is

Visually mark nodes and edges whose facets have been marked **meta-disagreement** — the methodology's escape valve when a facet's dispute is irreducible by diagnostics or decomposition. Per `docs/methodology.md` §"Meta-disagreement fallback", the moderator records the **disagreement itself** as the disposition for the facet: both proposed values are carried side by side, the debate proceeds, and the facet's recorded status is "the dispute is the answer". This is a per-facet status (a single facet on an entity may be meta-disagreement while other facets are agreed / disputed / proposed) and is the fourth and final agreement-layer state, sitting alongside `proposed` / `agreed` / `disputed`. With `mod_proposed_state_styling`, `mod_agreed_state_styling`, and `mod_disputed_state_styling` already landed, this task completes the four-state agreement-layer visual vocabulary.

This task lands:

- A meta-disagreement-state branch in `StatementNode.tsx` that applies `border-double border-violet-600 ring-2 ring-violet-400 opacity-100` Tailwind classes when `cardRollupStatus(facetStatuses) === 'meta-disagreement'`. The `border-double` CSS resolves to two parallel borders — a literal visual split that communicates "both sides remain on the graph, side by side". The violet color (`violet-600` border + `violet-400` ring halo) is the distinct color family for methodology escalations, chosen to not collide with the existing slate (baseline / agreed) and rose (disputed) palettes.
- A meta-disagreement-state branch in `StatementEdge.tsx` that applies `style={{ stroke: '#7c3aed', strokeDasharray: '2 2' }}` (the `violet-600` hex + a tight dotted pattern) when `facetStatuses.substance === 'meta-disagreement'`. The dotted pattern conveys "fragmented / split" — visually distinct from the proposed long-dash (`6 4`) and the disputed solid stroke. The role-label pill's `data-facet-status="meta-disagreement"` attribute is already stamped (the agreed-state task widened the seam to cover every non-`undefined` rollup status); this task only wires the className / inline-style branch.
- Tests for the meta-disagreement branch on both node + edge.

This task is rendering-only. The methodology-flow that drives a facet into the meta-disagreement state is owned by `mod_meta_move_flow` and the methodology-engine; here we just show the visual state of what's already in the log.

The `data-facet-status="meta-disagreement"` attribute is already stamped on both the card root and the role-label pill (the agreed-state task widened the seam to cover every non-`undefined` rollup status); this task only wires the className / inline-style branch.

## Why it needs to be done

Meta-disagreement is the methodology's "we agreed to disagree" disposition — the last-resort fallback when diagnostics and decomposition can't resolve a facet's dispute (`docs/methodology.md` §"Meta-disagreement fallback"). Without a distinct visual, the moderator can't tell at a glance which facets have been marked meta-disagreed (a closed-but-split disposition) from which are still being negotiated (proposed / disputed) or fully resolved (agreed / committed). The methodology engine surfaces meta-disagreement as the moderator's escalation signal — it always sorts above `disputed` in the rollup priority order (pinned by `mod_agreed_state_styling`) — because once a facet is meta-disagreed the moderator has chosen to *record the disagreement* rather than continue resolving it.

The visual contract — split / branched / double-bordered in violet — picks up the "carrying both sides side by side" semantic from the methodology text. A double border is the standard CSS / typography signal for "two of the same thing in parallel" (the `border-double` style renders as two thin parallel lines with a gap between them, the literal "split decision" visual). Violet differentiates from the rose (disputed) and slate (proposed / agreed) families without conflict; it also reads as the "methodology / engine" color family — fitting since meta-disagreement is the only one of the four agreement-layer states the methodology engine itself escalates.

## Inputs / context

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface; the custom node / edge components are the extension points for state styling.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the locale-aware mount the components already use; the styling is locale-independent but the rendering still passes through `useTranslation` so we keep the existing test infrastructure.
- `docs/methodology.md` §"Meta-disagreement fallback" — the canonical semantics: "the facet is marked as meta-disagreement: it carries both proposed values side by side. The debate proceeds." The visual choice mirrors that — both sides remain on the graph, the card / edge is "split" to surface the unresolved disposition.
- `tasks/refinements/moderator-ui/mod_proposed_state_styling.md` — the grandparent task; landed `facetStatus.ts`, `FacetStatusIndex`, `cardRollupStatus`, and the per-component `data-facet-status` seam.
- `tasks/refinements/moderator-ui/mod_agreed_state_styling.md` — pinned the rollup priority order (`proposed > meta-disagreement > disputed > agreed > committed > withdrawn`) and widened the seam to cover every non-`undefined` status.
- `tasks/refinements/moderator-ui/mod_disputed_state_styling.md` — landed the third className branch; this task adds the fourth (and last) agreement-layer branch on the same seam.
- `apps/moderator/src/graph/facetStatus.ts` — the `FacetStatus` enum already carries `'meta-disagreement'`; the derivation rules already produce it (Rule 1: meta-disagreement short-circuits).
- `apps/moderator/src/graph/StatementNode.tsx` — the `cardRollupStatus` function (no change) and the className-branch ternary chain this task extends.
- `apps/moderator/src/graph/StatementEdge.tsx` — the substance-status-driven styling this task extends with the meta-disagreement branch (an inline-style `stroke` + `strokeDasharray` override on the `<BaseEdge>` path).

## Constraints / requirements

- **`StatementNode` meta-disagreement branch**: when `cardRollupStatus(facetStatuses) === 'meta-disagreement'`, the card carries `border-double border-violet-600 ring-2 ring-violet-400 opacity-100` Tailwind classes (replacing the baseline `border-slate-300`). The `data-facet-status="meta-disagreement"` attribute is already stamped by the agreed-state seam widening; no further root-prop change is needed.
- **`StatementEdge` meta-disagreement branch**: when `facetStatuses.substance === 'meta-disagreement'`, the rendered `<BaseEdge>` path carries `style={{ stroke: '#7c3aed', strokeDasharray: '2 2' }}` (the `violet-600` hex + a tight 2-2 dotted pattern). No `opacity` override — the meta-disagreement visual is fully attention-grabbing, not faded. The caller-provided `style` (if any) and the role-label `data-facet-status="meta-disagreement"` attribute (already stamped by the agreed-state seam widening) remain intact.
- **Rollup priority is NOT changed.** `mod_agreed_state_styling` pinned the order (`proposed > meta-disagreement > disputed > agreed > committed > withdrawn`); this task only adds a className / style branch for one of the already-existing rollup outcomes. No edits to `cardRollupStatus` or the `ROLLUP_PRIORITY` constant.
- **Tests** (committed, per ADR 0022):
  - `apps/moderator/src/graph/StatementNode.test.tsx` extended with:
    - 1 case: meta-disagreement classification applies `border-double border-violet-600 ring-2 ring-violet-400` + `data-facet-status="meta-disagreement"`, no `border-dashed`, no `border-rose-600`.
    - 1 case: meta-disagreement beats disputed in the rollup → card reads as meta-disagreement (sanity check that the priority chain is wired all the way through to the className branch).
    - 1 case: proposed wins over meta-disagreement (priority — proposed has higher priority).
    - 3 cases × 3 locales: cross-locale rendering — the meta-disagreement styling applies regardless of the active locale.
  - `apps/moderator/src/graph/StatementEdge.test.tsx` extended with:
    - 1 case: substance=meta-disagreement stamps `data-facet-status="meta-disagreement"` on the role-label pill (already implicit in the agreed-state seam widening, but pinned here for the meta-disagreement perspective).
    - 1 case: substance=meta-disagreement renders the BaseEdge path with `stroke="#7c3aed"` (or `style="stroke: rgb(124, 58, 237)"` — happy-dom may serialize either way) AND `stroke-dasharray="2 2"` AND NO inline `opacity`.

## Acceptance criteria

- `apps/moderator/src/graph/StatementNode.tsx` carries the new meta-disagreement-state className branch.
- `apps/moderator/src/graph/StatementEdge.tsx` carries the new meta-disagreement-state inline-style branch (violet dotted stroke).
- All test files listed above contain the listed cases.
- `pnpm run check` clean.
- `pnpm run test:smoke` green (test count rises by the new cases) — excluding pre-existing `apps/server` failures unrelated to this surface.
- `pnpm -F @a-conversa/moderator build` succeeds.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_meta_disagreement_split_render` plus a `note "Refinement: …"` line.

## Decisions

- **Split-visual shape: `border-double` on nodes.** The CSS `border-style: double` renders as two thin parallel lines with a transparent gap between them — the literal "split decision" / "two sides carried side by side" visual that maps the methodology semantics directly into the canvas. Alternatives considered:
  - A diagonal split (e.g. a CSS gradient halving the card into two colors) was rejected: it competes with the per-facet visualization slot reserved by `mod_per_facet_state_visualization`, where individual facets *within* a card get their own slices. Using a diagonal split for the card-level rollup would foreclose that future seam.
  - A divided badge (a corner icon depicting two arrows) was rejected: corner space is already used by the annotation-badge row, and a glyph adds DOM weight for a card-level signal where the className-only border is sufficient.
  - The double-border + ring composition is purely a CSS-class addition (no extra DOM), composes cleanly with the existing card structure, and reads as "this entire entity has a split disposition" at a single glance — exactly the load-bearing signal.
- **Violet color family: `violet-600` border, `violet-400` ring halo.** Tailwind palette. `violet-600` (`#7c3aed`) is the primary "this is a methodology escalation" tone — distinct from the slate family (baseline / agreed) and the rose family (disputed), and matches the mental model of "the methodology engine pulled the escape valve". `violet-400` (`#a78bfa`) is lighter and works as the ring halo (mirroring the disputed-state pattern of darker-border + lighter-ring). If a future design-tokens package replaces these, the contract is "use the project's `methodology-escalation` / `notice` color family" — these particular shades are the v1 placeholder.
- **Why ring AND double border, not just double border.** The double-border alone could read as "decorative" in a dense canvas where many cards have borders of various weights. The ring halo amplifies the "this needs your attention" signal — meta-disagreement IS the moderator's load-bearing escalation, even though it's a closed-disposition state (the methodology engine surfaced an irreducible dispute, and the moderator must attend to it). Mirrors the disputed-state pattern (border + ring) to keep the visual vocabulary consistent: both states get a halo because both are escalations the moderator scans for.
- **`opacity-100` is explicit.** Defense against any inherited dim opacity from compositional className stacks — the meta-disagreement state is attention-grabbing, not faded. (Mirrors the agreed-state and disputed-state pattern.)
- **Meta-disagreement-state edge styling: violet dotted stroke (`#7c3aed` + `strokeDasharray: '2 2'`), no opacity dim.** Edges have one facet (substance) in v1 and one visual axis (the path stroke). The dotted pattern (tight `2 2`) conveys "fragmented / split" — visually distinct from the proposed long-dash (`6 4`) and the disputed solid stroke. The stroke color matches the node's `border-violet-600` so nodes and edges in the same meta-disagreement state read as the same violet across the canvas. We use an inline `style` override rather than a Tailwind class because `<BaseEdge>` renders a raw `<path>` element inside ReactFlow's SVG and the canonical extension point is the `style` prop (the same pattern the proposed-state and disputed-state branches use).
- **No rollup priority change.** The agreed-state task pinned the order `proposed > meta-disagreement > disputed > agreed > committed > withdrawn`. This task only adds a rendering branch for one of those values; the order itself is the historical record of the `mod_agreed_state_styling` Decisions and is not reopened here.
- **Seam was already widened.** The agreed-state task widened the `data-facet-status` attribute stamping to cover every non-`undefined` rollup status (not just `proposed`). The meta-disagreement attribute is already on the rendered DOM by the time this task starts. We add only the className / inline-style branch — no further root-prop change.
- **No diagonal / branching geometry on the edge.** A meta-disagreement edge could conceivably split into two parallel paths (mirroring the node's double border). Rejected for v1: ReactFlow's `<BaseEdge>` renders a single `<path>` per edge, and splitting it would require a custom multi-path renderer with non-trivial geometry. The dotted-stroke + violet-color combination conveys the "fragmented disposition" signal sufficiently for v1, and the per-facet visualization (`mod_per_facet_state_visualization`) is the future surface where multi-path / parallel-edge rendering would land if it's ever needed.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

- Updated `apps/moderator/src/graph/StatementNode.tsx` — added the fourth className branch to the `styleClassName` ternary chain: when `cardRollupStatus(facetStatuses) === 'meta-disagreement'`, the card carries `border-double border-violet-600 ring-2 ring-violet-400 opacity-100`. The proposed / agreed / disputed branches are unchanged; the baseline (`border-slate-300`) still catches every other rollup status (`committed`, `withdrawn`) until its sibling refinement lands. The `data-facet-status="meta-disagreement"` attribute is already stamped on the card root by the agreed-state seam widening; no further root-prop change was needed. Component header and rollup-branch JSDoc extended to cover the new branch.
- Updated `apps/moderator/src/graph/StatementEdge.tsx` — added a parallel meta-disagreement-state inline-style branch alongside the proposed and disputed ones: when `substanceStatus === 'meta-disagreement'`, `metaDisagreementEdgeStyle = { stroke: '#7c3aed', strokeDasharray: '2 2' }` (the `violet-600` hex + a tight dotted pattern conveying "fragmented / split"). The three per-status overrides are coalesced (only one fires at a time since the substance facet has exactly one status), then composed with any caller-provided `style` and passed through to `<BaseEdge>`. The role-label `data-facet-status="meta-disagreement"` attribute is already stamped by the agreed-state seam widening. Header comment + rollup-branch JSDoc extended.
- New `tasks/refinements/moderator-ui/mod_meta_disagreement_split_render.md` (this file).
- Updated `apps/moderator/src/graph/StatementNode.test.tsx` — added 6 new meta-disagreement-state cases under a new describe block: meta-disagreement classification applies the violet split-visual className + `data-facet-status="meta-disagreement"`; meta-disagreement beats disputed in the rollup (priority chain wired through to the className branch); proposed beats meta-disagreement (the rollup priority is unchanged); 3 cross-locale cases verify the styling applies regardless of active locale. Total file: 55 cases (was 49).
- Updated `apps/moderator/src/graph/StatementEdge.test.tsx` — added 2 new meta-disagreement-state cases under a new describe block: substance=meta-disagreement stamps `data-facet-status="meta-disagreement"` on the role-label pill; substance=meta-disagreement renders the `<BaseEdge>` path with the violet stroke (`#7c3aed` / `rgb(124, 58, 237)`) AND the `2 2` dotted dasharray, and no inline `opacity`. Total file: 32 cases (was 30).
- `pnpm run check` clean. `pnpm run test:smoke` green — total moderator graph cases 166 (was 158: +6 on `StatementNode.test.tsx`, +2 on `StatementEdge.test.tsx`). Full-repo total 2203 (was 2195). `pnpm -F @a-conversa/moderator build` green. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream consumers — `mod_per_facet_state_visualization`, `mod_vr_state_styling`, and any future Playwright test selecting on `[data-facet-status="meta-disagreement"]` — now have the fourth and final agreement-layer className / inline-style branch in place. The rollup priority order (`proposed > meta-disagreement > disputed > agreed > committed > withdrawn`) and the data-attribute stamping are still those pinned by `mod_agreed_state_styling`; this task did not change them. The baseline branch in the `styleClassName` ternary now exclusively catches the closed-disposition states (`committed`, `withdrawn`), which sit out the v1 visual differentiation and rely solely on the `data-facet-status` seam attribute for downstream consumers.
