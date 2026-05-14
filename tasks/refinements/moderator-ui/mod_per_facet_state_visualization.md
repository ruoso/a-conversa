# Moderator per-facet state visualization (a row of facet pills inside the node card)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_per_facet_state_visualization` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 2d
**Inherited dependencies**:
- `moderator_ui.mod_graph_rendering.mod_proposed_state_styling` (done — landed `facetStatus.ts`, `FacetStatusIndex`, `cardRollupStatus`, the per-component `data-facet-status` seam, and the proposed-state Tailwind branches).
- `moderator_ui.mod_graph_rendering.mod_agreed_state_styling` (done — pinned the rollup priority `proposed > meta-disagreement > disputed > agreed > committed > withdrawn`, widened the data-attribute seam, landed the agreed-state branch).
- `moderator_ui.mod_graph_rendering.mod_disputed_state_styling` (done — landed the rose-600 red-marker branch on the card frame).

## What this task is

Surface **all three facet statuses simultaneously** on the node card via a per-facet pill row. The three preceding state-styling tasks paint the **whole-card** frame from a single rolled-up status (`cardRollupStatus`); this task adds the *detail* layer: a small row of pills inside the card, one per facet present on the node, each carrying its own per-facet status visual.

Per the methodology (`docs/methodology.md`, "Facets"), every node has three facets — **wording**, **classification**, and **substance** — each with its own independent agreement lifecycle. A node's wording can be agreed while its classification is disputed and its substance is still proposed. The card-rollup picks one (the highest-priority); the per-facet bar shows all three so the moderator sees at a glance which facets are committed vs disputed vs proposed without having to drill into the right sidebar.

This task lands:

- A new `<FacetPill>` component in `apps/moderator/src/graph/FacetPill.tsx` — small inline pill carrying `data-facet-pill`, `data-facet-name="<name>"`, and `data-facet-status="<status>"` attributes plus a localized facet-name label (`methodology.facet.<name>` resolved via `useTranslation`). When the per-facet status is undefined (no event has touched the facet on this node), the pill is omitted entirely.
- A new facet-pill row inside `<StatementNode>` rendered ABOVE the wording paragraph. The row's container carries `data-testid="facet-pill-row-node-<id>"`. The row renders only when at least one facet pill would render (no empty container in the DOM).
- New i18n keys `methodology.facet.wording` / `.classification` / `.substance` added to the three v1 catalogs (en-US / pt-BR / es-419), with `STRUCTURALLY_IDENTICAL` allow-list entries for any cross-locale cognates that legitimately collide.
- Per-pill styling rules MIRROR the existing whole-card frame rules from the three predecessor refinements, but scoped to the pill:
  - `'proposed'`     → `border-dashed border-slate-400 text-slate-500 opacity-60`
  - `'agreed'`       → `border-solid border-slate-700 text-slate-700 opacity-100`
  - `'disputed'`     → `border-solid border-rose-600 text-rose-700 ring-1 ring-rose-500 opacity-100`
  - `'meta-disagreement'` → `border-double border-violet-600 text-violet-700 ring-1 ring-violet-400 opacity-100`
  - `'committed'`    → `border-solid border-slate-400 text-slate-600 opacity-90` (closed; baseline-tone)
  - `'withdrawn'`    → `border-dashed border-slate-400 text-slate-500 opacity-50` (closed; faded)
- Tests covering the pill component, the facet-pill row in the node, and per-facet rendering across various status combinations.

**This task is additive**: the existing whole-card rollup styling (`cardRollupStatus` border + ring) stays. The whole-node frame remains the "this needs attention" high-level signal; the facet pill row is the detail layer underneath.

## Why it needs to be done

The card-rollup picks **one** facet status to paint the whole card frame. That's the right call for the "scan the canvas" view: the moderator sees a wall of cards and the framed-red cards demand attention. But once the moderator's eye lands on a card, the rollup is insufficient — a card framed red could be red because *only one* facet is disputed and the other two are agreed, or because *every* facet is disputed. The per-facet bar makes that visible without forcing the moderator to drill into the right sidebar.

Per the methodology, facets matter because "conceding the structure would imply conceding the content, which would be wrong." Surfacing the facets directly on the card honours the methodology's per-facet semantics in the moderator's primary view. This is the *fourth* state-styling task (after proposed / agreed / disputed) — it does NOT add a new state, it surfaces the per-facet detail of the same state machine the three predecessors already wired.

## Inputs / context

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface; the custom node is the extension point for in-card decoration rows.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation` for the localized facet-name label.
- `docs/methodology.md` § "Facets" — the canonical "wording / classification / substance" facet set per node and the per-facet-lifecycle rule.
- `tasks/refinements/moderator-ui/mod_proposed_state_styling.md` — landed `facetStatuses` prop on `StatementNodeData` and the `data-facet-status` seam.
- `tasks/refinements/moderator-ui/mod_agreed_state_styling.md` — pinned the rollup priority order. The facet-pill order chosen here (`wording > classification > substance`) is separate from the rollup priority (it's the *reading* order, not the *importance* order).
- `tasks/refinements/moderator-ui/mod_disputed_state_styling.md` — the red-marker visual the pill mirrors.
- `apps/moderator/src/graph/StatementNode.tsx` — the card component that gets the new pill row.
- `apps/moderator/src/graph/facetStatus.ts` — `FacetName` (`classification | substance | wording`) and `FacetStatus` are already exported.
- `apps/moderator/src/graph/AnnotationBadge.tsx` / `AxiomMarkBadge.tsx` — the existing in-card badge patterns the `<FacetPill>` mirrors (memoized component, `data-*` attribute seam, `useTranslation` for the label).

## Constraints / requirements

- **`<FacetPill>` component** (`apps/moderator/src/graph/FacetPill.tsx`): a memoized React component taking `{ facet: FacetName; status: FacetStatus }`. Renders a `<span>` with:
  - `data-facet-pill` attribute (sentinel — `''` value; presence is what testers select on).
  - `data-facet-name="<facet>"` — `wording` / `classification` / `substance`.
  - `data-facet-status="<status>"` — one of the six `FacetStatus` values.
  - A localized label resolved via `t('methodology.facet.<facet>')`.
  - Per-status Tailwind classes per the table above. The pill is a small bordered chip — `inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide whitespace-nowrap` is the baseline, with the per-status branch appended.
- **`<StatementNode>` facet-pill row**: ABOVE the wording paragraph (so the per-facet detail is the first thing read after the eye lands on the card). The row container:
  - Renders ONLY when the node has at least one entry in `facetStatuses` (empty record → no row in the DOM, mirroring the annotation / axiom-mark row pattern).
  - Uses `data-testid="facet-pill-row-node-<id>"` and `className="mb-1 flex flex-wrap gap-1"`.
  - Iterates the facets in canonical order: `wording` → `classification` → `substance`. Only emits a pill for facets present in `data.facetStatuses` (a node with only `wording` proposed gets a single wording pill).
- **i18n catalog keys**: add `methodology.facet.wording` / `.classification` / `.substance` to all three catalogs:
  - en-US: `"Wording"`, `"Classification"`, `"Substance"`
  - pt-BR: `"Redação"`, `"Classificação"`, `"Substância"`
  - es-419: `"Redacción"`, `"Clasificación"`, `"Sustancia"`
  - Extend `METHODOLOGY_VALUES` in `packages/i18n-catalogs/src/methodology.test.ts` with a `facet: ['wording', 'classification', 'substance']` entry so the existing round-trip test covers the new keys automatically.
  - No cognates expected to legitimately match across locales for these three.
- **No change to `cardRollupStatus` or the existing card frame styling**. The four whole-card frame branches (proposed dashed-slate, agreed solid-slate, disputed rose, meta-disagreement violet-double) stay; the pill row is additive.
- **Per-pill closed-state styling** (`committed`, `withdrawn`) IS rendered today — unlike the card-frame branches for those two statuses which fall back to baseline, the pill is the place where every facet shows its true status. A committed wording facet should look distinctly "closed but agreed-on" rather than indistinguishable from baseline.
- **Tests** (committed, per ADR 0022):
  - New `apps/moderator/src/graph/FacetPill.test.tsx`:
    - 1 case: renders the wording pill with `data-facet-name="wording"` and the en-US label `"Wording"`.
    - 1 case per status × facet sampled: pill carries `data-facet-status="<status>"` and the per-status className (proposed = `border-dashed`; agreed = `border-slate-700`; disputed = `border-rose-600` + `ring-rose-500`; meta-disagreement = `border-double` + `border-violet-600`; committed = `opacity-90`; withdrawn = `opacity-50`).
    - 3 × cross-locale: wording pill resolves to `"Wording"` / `"Redação"` / `"Redacción"`.
    - 1 case: classification pill resolves to `"Classification"` / `"Classificação"` / `"Clasificación"` (sampled in one locale; the cross-locale matrix is covered by the catalog round-trip test).
    - 1 case: substance pill resolves to `"Substance"` / `"Substância"` / `"Sustancia"` (sampled in one locale).
  - `apps/moderator/src/graph/StatementNode.test.tsx` extended with a new describe block `StatementNode — per-facet state visualization (mod_per_facet_state_visualization)`:
    - 1 case: empty `facetStatuses` does NOT render the row container (`facet-pill-row-node-<id>` absent).
    - 1 case: single proposed wording pill renders with `data-facet-name="wording"` and `data-facet-status="proposed"`; the row container exists.
    - 1 case: three facets (`wording=agreed, classification=disputed, substance=proposed`) render three pills in canonical order (`wording`, `classification`, `substance` — DOM order verified via the row's children).
    - 1 case: mixed-status (one disputed + two committed) renders three pills, each with its own `data-facet-status` value (sanity: pills are independent).
    - 1 case: the whole-card frame styling (the rollup) is UNAFFECTED — when one facet is proposed and another is disputed, the whole card still rolls up to proposed AND the pills each carry their own status. The frame's `border-dashed` and the disputed pill's `border-rose-600` coexist.
- **Catalog parity**: the methodology round-trip test in `packages/i18n-catalogs/src/methodology.test.ts` already iterates `METHODOLOGY_VALUES`; extending that constant with `facet: [...]` adds the parity coverage automatically. No new test file in the catalog package; just the constant extension and the per-catalog JSON updates.

## Acceptance criteria

- `apps/moderator/src/graph/FacetPill.tsx` exists, exports a memoized `<FacetPill>` component with the per-status Tailwind branches.
- `apps/moderator/src/graph/StatementNode.tsx` renders the facet-pill row above the wording paragraph when `facetStatuses` is non-empty; the row uses `data-testid="facet-pill-row-node-<id>"` and iterates facets in canonical order.
- `apps/moderator/src/graph/FacetPill.test.tsx` contains the listed cases.
- `apps/moderator/src/graph/StatementNode.test.tsx` extended with the new describe block.
- Three i18n catalogs (en-US, pt-BR, es-419) carry the new `methodology.facet.*` entries.
- `packages/i18n-catalogs/src/methodology.test.ts`'s `METHODOLOGY_VALUES` carries a `facet: ['wording', 'classification', 'substance']` entry.
- `pnpm run check` clean (no new errors beyond the pre-existing baseline).
- `pnpm run test:smoke` green (test count rises by the new cases).
- `pnpm -F @a-conversa/moderator build` succeeds.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_per_facet_state_visualization` plus a `note "Refinement: …"` line.

## Decisions

- **Pill row position: ABOVE the wording.** The eye-scan order on a card the moderator has chosen to look at: per-facet detail first (so "what state is this in at every level") → then wording (the content) → then kind label → then any axiom-mark / annotation decoration rows. The methodology framing — facets are the methodological structure; wording is one of them — argues for the structural detail leading the content. (An alternative was "below kind label, above annotations" but that buries the per-facet detail among the commentary decorations and breaks the "facets are first-class structure" framing.)
- **Pill shape: small bordered chip, not a colored dot.** A bordered chip carries the localized facet-name label so the moderator doesn't have to memorize which dot is which facet. The border style + color + ring mirror the whole-card frame rules (`border-dashed` for proposed, `border-solid border-rose-600 ring-1 ring-rose-500` for disputed, etc.) so the visual vocabulary is consistent: a disputed card and a disputed pill share the same red border + rose ring. Ring thickness is `ring-1` on the pill (vs `ring-2` on the card frame) — proportional to the smaller surface.
- **All three facets render in canonical reading order: wording → classification → substance.** The reading order is methodology-natural ("how is it phrased? what kind is it? does it hold?") and matches the order in `docs/methodology.md` § "Facets". This is **separate from** the rollup priority order (`proposed > meta-disagreement > disputed > agreed > committed > withdrawn`); the rollup is about *importance*, the pill order is about *reading sequence*.
- **Pills only render for facets present in `facetStatuses`.** A node fresh from `node-created` with no proposals has `facetStatuses: {}` and renders no pill row at all (consistent with the annotation / axiom-mark row pattern). A node where only the wording has been edited renders a single wording pill. This keeps the DOM clean for the common "card with one in-flight facet" case.
- **Closed-state styling for the pill (committed, withdrawn) IS rendered.** Unlike the card frame which falls back to baseline for closed statuses (because the frame is the "needs your attention" signal and a committed facet doesn't need attention), the pill IS the per-facet record. A committed wording pill should communicate "agreed, closed" and a withdrawn one "rejected, closed" — both visually distinct from the open `proposed` / `agreed` / `disputed` / `meta-disagreement` states. `committed` is solid-bordered slate at slight opacity; `withdrawn` is dashed slate at heavier fade (the methodology semantics: withdrawn = the agreement was retracted).
- **i18n key shape: `methodology.facet.<name>`.** Mirrors the existing `methodology.facetState.<status>`, `methodology.kind.<id>`, `methodology.edgeRole.<id>`, etc. — the `methodology.*` namespace is the canonical vocabulary surface, and adding a `facet` sub-namespace alongside the existing ones is the natural fit. The round-trip test in `packages/i18n-catalogs/src/methodology.test.ts` picks them up automatically via `METHODOLOGY_VALUES` extension.
- **No change to `cardRollupStatus` or the existing whole-card frame branches.** The whole-card frame is the "scan the canvas" signal; the pill row is the "look at this card" detail. They serve different scales of attention. Mixing the two (e.g. removing the whole-card frame styling once pills exist) would force the moderator to do per-facet scanning across every card on the canvas, which is the opposite of the design goal. The frame stays; the pills are additive.
- **One component per pill, not one component per facet × status.** A single `<FacetPill>` with a status-branch ternary keeps the styling rules co-located (same place the predecessor refinements would extend if they ever needed the per-pill view). The status branch reuses the same Tailwind utility classes used by the card-frame branches.
- **Pill width is content-driven (no fixed width).** The pill's text differs in length across locales (`"Wording"` vs `"Redacción"`) and across facets (`"Substance"` vs `"Classification"`). Forcing a fixed width either truncates the longer labels or wastes space on the shorter ones; `whitespace-nowrap` + content-driven width is the simpler and methodology-faithful default.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

- New `apps/moderator/src/graph/FacetPill.tsx` — memoized React component rendering a single per-facet pill. Takes `{ facet: FacetName; status: FacetStatus }`. Carries the `data-facet-pill` sentinel + `data-facet-name="<facet>"` + `data-facet-status="<status>"` attributes (the stable test seam) and resolves the localized facet-name label via `t('methodology.facet.<facet>')`. Per-status Tailwind classes mirror the whole-card frame rules: proposed = dashed-slate + opacity-60; agreed = solid-slate-700 + opacity-100; disputed = solid-rose-600 + ring-1 rose-500 + opacity-100; meta-disagreement = double-violet-600 + ring-1 violet-400 + opacity-100; committed = solid-slate-400 + opacity-90 (closed-tone); withdrawn = dashed-slate-400 + opacity-50 (retracted). Unlike the whole-card frame (which falls back to baseline for closed statuses), the pill renders styling for every status because the pill IS the per-facet record.
- Updated `apps/moderator/src/graph/StatementNode.tsx` — added a `FACET_RENDER_ORDER` constant (`['wording', 'classification', 'substance']`, the canonical reading order from `docs/methodology.md` § "Facets") and a facet-pill row ABOVE the wording paragraph. The row renders only when at least one facet is present in `data.facetStatuses` (mirrors the annotation / axiom-mark row pattern — no empty container in the DOM); pills iterate in canonical order and only emit for facets present in the record. The whole-card `cardRollupStatus` border styling stays untouched — the pill row is additive.
- New i18n catalog entries `methodology.facet.wording` / `.classification` / `.substance` in all three v1 catalogs (en-US: "Wording" / "Classification" / "Substance"; pt-BR: "Redação" / "Classificação" / "Substância"; es-419: "Redacción" / "Clasificación" / "Sustancia"). Extended `METHODOLOGY_VALUES` in `packages/i18n-catalogs/src/methodology.test.ts` with `facet: ['wording', 'classification', 'substance']` so the existing round-trip test covers the new keys (+9 cases from the round-trip matrix: 3 locales × 3 facets).
- New `apps/moderator/src/graph/FacetPill.test.tsx` — 20 cases: seam-attribute stamping (3 cases × 3 facets); per-status styling branches (6 cases — one per `FacetStatus`); localized facet-name label per facet × locale (9 cases for the 3×3 matrix) + a non-cognate sanity check + a base structural-class assertion.
- Updated `apps/moderator/src/graph/StatementNode.test.tsx` — added a new describe block `StatementNode — per-facet state visualization (mod_per_facet_state_visualization)` with 6 cases: empty `facetStatuses` omits the row; single proposed wording pill renders; three pills render in canonical order; mixed-status (one disputed + two committed) renders three independent pills with distinct per-status classes; rollup + per-pill coexist (proposed frame + disputed pill side-by-side); pill row sits ABOVE the wording paragraph (DOM order pinned). Total file: 65 cases (was 59).
- Updated `tasks/30-moderator-ui.tji` — added `complete 100` and `note "Refinement: …"` to the `mod_per_facet_state_visualization` task block.
- `pnpm run check` — back to pre-existing baseline (8 errors, all in pre-existing server routes / e2e fixtures unrelated to this task; my code is clean).
- `pnpm run test:smoke` — 2178 passed, was 2143 → +35 cases (20 FacetPill + 6 StatementNode + 9 methodology round-trip). 6 pre-existing file failures unchanged (server routes' missing `@fastify/static` dep, unrelated to graph rendering).
- `pnpm -F @a-conversa/moderator build` — green, 538.48 kB / gzip 167.74 kB (small bump from the new FacetPill component).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` — silent.

Downstream consumers — `mod_vote_indicators_on_graph` (the next dependent task) and any future Playwright test selecting on `[data-facet-pill][data-facet-name="<name>"][data-facet-status="<status>"]` — now have the per-facet detail layer rendered on every node card whose facetStatuses record is non-empty. The whole-card rollup remains the "scan the canvas" signal; the pill row is the "look at this card" detail. Both signals coexist and are tested for non-interference.
