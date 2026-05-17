# Per-facet state styling on the participant's read-mostly graph

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_per_facet_state_styling`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_graph_view.part_graph_render` (settled, commit landing 2026-05-17 — shipped the `/p/sessions/:id` `OperateRoute`, the `<GraphView>` Cytoscape mount, the pure `projectGraph(events)` projector, and the per-session `useWsStore((s) => s.sessionState[sessionId]?.events)` selector idiom. Live code: [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx#L1), [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts#L1), [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx#L1)).
- Prose-only context (NOT a `.tji` edge): the entire moderator state-styling stack is settled, and its vocabulary is the reference this leaf adopts verbatim where it can — `moderator_ui.mod_graph_rendering.mod_proposed_state_styling`, `mod_agreed_state_styling`, `mod_disputed_state_styling`, `mod_per_facet_state_visualization`. The shipped artefacts the participant mirrors: [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts#L1) (the `FacetStatus` / `FacetName` enums + `computeFacetStatuses(events): FacetStatusIndex` derivation), [`apps/moderator/src/graph/StatementNode.tsx`](../../../apps/moderator/src/graph/StatementNode.tsx#L198) (the `ROLLUP_PRIORITY` constant + `cardRollupStatus(facetStatuses)` helper), [`apps/moderator/src/graph/FacetPill.tsx`](../../../apps/moderator/src/graph/FacetPill.tsx#L73) (the `PILL_STATUS_CLASSNAME` per-status visual map).
- Prose-only context (NOT a `.tji` edge): `data_and_methodology.projection.per_facet_status_derivation` (settled — defines the canonical seven derivation rules ([`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts)); both the moderator's `computeFacetStatuses` and this leaf's port mirror the same rules verbatim).
- Prose-only context (NOT a `.tji` edge): `backend.websocket_protocol.ws_proposal_status_broadcast` (settled — lands `useWsStore.sessionState[id].pendingProposals[proposalId].perFacetStatus`). This leaf does NOT consume the broadcast frame yet; the participant's per-entity-facet view derives directly from the per-session events slice (Decision §3 — same rationale the moderator's graph card uses: the broadcast covers facets attached to *pending* proposals only, while the per-entity styling layer needs status for every entity on the canvas including committed / withdrawn / meta-disagreement).

## What this task is

Extend the participant's read-mostly `<GraphView>` so every node and edge it paints carries a **per-facet status visual** — the second visual-vocabulary layer on top of the baseline rendering surface `part_graph_render` shipped. Before this leaf every node is a neutral round-rectangle (`#cbd5e1` border, `#ffffff` fill) and every edge is a neutral bezier (`#94a3b8`). After this leaf, the moderator's six-status vocabulary — `proposed`, `agreed`, `disputed`, `meta-disagreement`, `committed`, `withdrawn` — paints on the participant tablet too, with the same border style / colour / opacity grammar the moderator's `<FacetPill>` and `<StatementNode>` use.

Concretely the deliverable is:

- A new `apps/participant/src/graph/facetStatus.ts` — a verbatim port of the moderator's [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) (same `FacetStatus` / `FacetName` types, same `InternalFacetState` accumulator, same seven derivation rules, same `EMPTY_FACET_STATUSES` module-scope freeze). Exports `computeFacetStatuses(events): FacetStatusIndex` for the projection plus a small `cardRollupStatus(facetStatuses)` helper that returns the highest-priority status per the same `ROLLUP_PRIORITY` array the moderator pinned (`proposed > meta-disagreement > disputed > agreed > committed > withdrawn`). Decision §2 covers the "port verbatim now; extract to `@a-conversa/shell` when the third caller materialises" rationale.
- An extension to [`projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts) that takes the `FacetStatusIndex` as a second argument and stamps two new fields onto every emitted node / edge element's `data`:
  - `facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>` — the per-facet record verbatim from the index.
  - `rollupStatus: FacetStatus | 'none'` — the result of `cardRollupStatus`; `'none'` (literal string) when the record is empty so Cytoscape's selector engine has a stable value to match on (Cytoscape `[rollupStatus = 'foo']` selectors don't trigger on `undefined`; we encode "no status" as a sentinel string so the baseline branch has its own selector).
- An extension to [`GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) that computes the `FacetStatusIndex` once per `events` change (memoised on the events reference; same idiom the projector already uses) and threads it into `projectGraph`. The Cytoscape stylesheet grows seven `node[rollupStatus = '<status>']` selectors and seven `edge[rollupStatus = '<status>']` selectors, each carrying the per-status border / colour / opacity branch (Decision §1 maps the moderator's vocabulary onto Cytoscape's stylesheet syntax). The baseline `node` / `edge` selectors stay as the catch-all the `'none'` rollup hits.
- A new **test mirror** rendered alongside the Cytoscape canvas — a single `<ul data-testid="participant-graph-status-mirror" aria-hidden="true" className="sr-only">` with one `<li data-testid="participant-node-status" data-node-id="..." data-facet-status="..." data-rollup-status="...">` per emitted node and one `<li data-testid="participant-edge-status" data-edge-id="..." data-facet-status="...">` per emitted edge. The mirror is the testability seam the Playwright spec asserts against (Decision §4 — Cytoscape paints to `<canvas>` so DOM-text scraping cannot reach the rendered styling; the mirror is the smallest DOM seam that pins observable behaviour without breaking the read-mostly contract).
- Tests pin: Vitest at the projection layer (`projectGraph` now takes the index and stamps the new fields), at the helper layer (the new `cardRollupStatus` follows the moderator's pin pattern), and at the `<GraphView>` render layer (the test mirror lists one entry per node / edge with the right rollup); Playwright at the e2e layer extends `tests/e2e/participant-graph-render.spec.ts` with a second `test()` block that seeds a `node-created` + a `classify-node` proposal (no votes) + an `edge-created` + a `set-edge-substance` proposal into ben's WS store and asserts the participant-side mirror surfaces `data-rollup-status="proposed"` on both entities. Decision §5 settles the spec shape.

Out of scope (deferred to existing or future leaves):

- **Per-participant axiom-mark decoration** — owned by `part_axiom_mark_decoration` (0.5d, depends `!part_graph_render`). This leaf does not touch axiom-mark data.
- **Annotation rendering** — owned by `part_annotation_render` (0.5d, depends `!part_graph_render`).
- **Diagnostic highlights** (cycle / contradiction / multi-warrant halos) — owned by `part_diagnostic_highlights` (0.5d, depends `!part_graph_render`).
- **Pan + zoom + tap-to-detail interactions** + **entity detail panel** — owned by `part_pan_zoom_tap` and `part_entity_detail_panel`. This leaf does not change Cytoscape's pan/zoom defaults and does not register any tap handler.
- **Own / other vote indicators on graph** — owned by `part_own_vote_indicators` (1d, depends `!part_per_facet_state_styling`) and `part_other_vote_indicators` (1d, depends transitively). The vote-indicator rendering builds ON TOP of the per-facet status layer this leaf ships — it consumes the same `FacetStatusIndex` derivation seam and the same Cytoscape stylesheet seam, and adds per-participant dots scoped to the facet pill / chip rendering. This leaf only paints the per-facet state; the per-participant vote dots are the dependent task's deliverable.
- **Per-facet pill row on each node** (the moderator's `<FacetPill>` analog — one chip per facet inside the node body). The moderator can render React-tree custom nodes via ReactFlow; the participant cannot (Cytoscape paints to `<canvas>`, no React in the per-node render loop — `part_graph_render` Decision §2 settled this). The participant's per-facet detail layer is **the rollup-driven card frame paint only**; per-facet breakdowns belong inside the `part_entity_detail_panel` (the tap-to-detail panel, which IS a React surface and CAN host the moderator's `<FacetPill>` vocabulary). This leaf delivers the at-a-glance card-frame signal; the per-facet drill-down lands later in a React-driven panel. Decision §6 covers the alternatives (DOM-overlay per node, the `cytoscape-node-html-label` plugin) and the YAGNI rationale.
- **Visual regression** — owned by `part_vr_state_styling` (1d, depends `!part_e2e_playwright`). Pixel comparisons of the painted Cytoscape canvas are deferred to that leaf; this leaf's tests pin observable behaviour through the DOM mirror, not pixel content.

## Why it needs to be done

`m_participant_mvp` ([`tasks/99-milestones.tji`](../../99-milestones.tji)) is the milestone at which a debater can see and engage with the live graph from their tablet. `part_graph_render` lit up the rendering surface; without per-facet state styling the surface is a wall of identically-coloured rectangles regardless of whether the substance has been agreed, is disputed, or hasn't yet been voted on. The moderator's three baseline state-styling tasks established why this matters on the operator surface — the rationale carries over to the debater surface verbatim:

- The methodology distinguishes four agreement-layer states for every facet (`proposed | agreed | disputed | meta-disagreement`) and two committed-layer ones (`committed | withdrawn`); the debater needs the same at-a-glance signal the moderator has, because the agreement loop the format depends on can't close if the debater can't see which facets are still open vs settled (per [docs/methodology.md](../../../docs/methodology.md#L33-L41)).
- The methodology assumes the debater sees the same graph the moderator does. The proposal is "visible on the graph in a distinct state from the moment it is made"; the debater is the audience that needs the visual distinction the most — they're the ones whose vote moves the facet from `proposed` to `agreed` (or `disputed`).
- Downstream `part_own_vote_indicators` is the next critical path leaf for the milestone. Its rendering builds on the per-facet status layer (the own-vote indicator on a `proposed` facet looks different from the indicator on an `agreed` one); without this leaf's seam, the vote-indicator task has no per-facet status to address.

Downstream concretely:

- **`part_own_vote_indicators`** (the next leaf in the critical path) consumes the `FacetStatusIndex` this leaf computes — same derivation, additional per-facet vote-state overlay scoped to the local debater. The index is exposed by `GraphView`'s projection memo; the dependent task adds an own-vote-indicator layer alongside the existing per-status stylesheet branches.
- **`part_other_vote_indicators`** (transitively depending on the per-facet styling) adds the cross-participant dots; same seam.
- **`part_entity_detail_panel`** (a React-driven panel mounted on tap-to-detail) can host the moderator's `<FacetPill>` vocabulary directly — the per-facet pill row the participant can't render inside the Cytoscape canvas lives in the detail panel.
- **`part_vr_state_styling`** (visual regression on per-facet state styling, including own + other vote indicators) reads the painted pixels of the stylesheet branches this leaf installs.
- The participant's `<GraphView>` becomes the **second concrete adoption of the moderator's per-facet status vocabulary** (Cytoscape edition). The audience surface (`aud_graph_render`, future) will be the third, and the natural extraction trigger for lifting `computeFacetStatuses` into `@a-conversa/shell` (Decision §2 — same "two callers is YAGNI; extract when the third materialises" policy `mergeSlots` followed).

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Cytoscape on the participant surface; the stylesheet is the explicit extension point for per-state visual rules. Cytoscape's stated strengths cited here: "layout algorithms, animation hooks, customizable styling for distinct facet/state rendering, OBS-friendly" — this leaf is the first concrete validation of the "customizable styling for distinct facet/state rendering" piece on the participant.
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the wire-event vocabulary the derivation walks; the shell client validates incoming envelopes at parse time, so this leaf's port of `computeFacetStatuses` trusts the discriminated-union narrowing.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behavioural assertion below is a committed Vitest case or Playwright scenario.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation()` is the participant surface's localization seam. This leaf does NOT add new user-facing strings (per-facet status is communicated visually via border + colour + opacity, not via prose — same shape the moderator's `<StatementNode>` card frame uses; the per-facet status label only exists inside the moderator's `<FacetPill>`, which has no participant analog this iteration per the out-of-scope list).
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the surface owns its mounted region only; `useWsStore` comes from the participant workspace's singleton (which delegates to the shell's `createDefaultWsStore`). No new shell substrate in this leaf.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — `node-created` / `edge-created` fire at propose-time; this leaf's styling layer paints from the moment of proposal, not at commit. The per-facet status reflects the propose / vote / commit cycle accumulated in the per-session events slice.

No new ADR. Every decision below applies an existing ADR or mirrors an existing moderator-side decision; the architectural seams (Cytoscape library pick, micro-frontend shell, methodology vocabulary) are settled.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_graph_render.md`](part_graph_render.md) — the immediate predecessor. The component shape this leaf extends (Cytoscape mount in a one-shot `useEffect`, element sync in a separate `useEffect` keyed on the memoised `elements`, the events slice read via `useWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS)`) is settled there. The `part_graph_render` Status block explicitly defers the `width: 'label'` deprecation (forced to numeric `width: 200` / `height: 80`) to THIS task — Decision §7 picks the concrete approach and documents the rationale.
- [`tasks/refinements/participant-ui/part_state_management.md`](part_state_management.md) — the per-session `events` slice shape (`BaseWsSessionState.events: Event[]`) is exactly what the moderator's projection consumes; the port carries over the same input shape.
- [`tasks/refinements/participant-ui/part_landscape_layout.md`](part_landscape_layout.md) — the chrome the route renders inside; the test-mirror `<ul>` sits inside the `participant-graph-root` container alongside the Cytoscape canvas, so the layout's `participant-main` region budget (`1fr`) covers both.

### Sibling refinements on the moderator (parallel concept — the vocabulary this leaf adopts)

- [`tasks/refinements/moderator-ui/mod_proposed_state_styling.md`](../moderator-ui/mod_proposed_state_styling.md) — the canonical "client computes status from event log; mirrors the server's `deriveFacetStatus`" pattern. The participant port is this leaf's Decision §2.
- [`tasks/refinements/moderator-ui/mod_agreed_state_styling.md`](../moderator-ui/mod_agreed_state_styling.md) — pinned the `ROLLUP_PRIORITY` array (`proposed > meta-disagreement > disputed > agreed > committed > withdrawn`) and the seam-widening rule ("every non-`undefined` rollup status stamps `data-facet-status` even if the per-status visual branch hasn't shipped yet"). This leaf adopts both verbatim — Decision §1.
- [`tasks/refinements/moderator-ui/mod_disputed_state_styling.md`](../moderator-ui/mod_disputed_state_styling.md) — the red-marker branch (`border-rose-600` + ring + `#e11d48` stroke on edges). The Cytoscape equivalent of the moderator's edge `stroke: '#e11d48'` lands here verbatim; the node's "solid red border + ring" composes from the Cytoscape stylesheet's `border-color` + `border-style` + `outline-color` + `outline-width` properties (Decision §1's mapping table).
- [`tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md`](../moderator-ui/mod_per_facet_state_visualization.md) — the per-facet pill row inside the node card. This is the leaf the participant **cannot** mirror at this layer (Cytoscape paints to canvas; no React per-node render loop); the per-facet pill row's role moves to `part_entity_detail_panel` per the out-of-scope list above and Decision §6.
- [`tasks/refinements/moderator-ui/mod_meta_disagreement_split_render.md`](../moderator-ui/mod_meta_disagreement_split_render.md) — the moderator's meta-disagreement-specific split rendering (the violet double-border + ring + the split-card visual). The participant's meta-disagreement state still paints (it's one of the six rollup statuses); the SPLIT geometry of the moderator's card is deferred to the participant entity-detail panel — this leaf only paints the violet double-border + ring rollup signal on the closed node.

### Live code the leaf plugs into

- [`apps/participant/src/graph/GraphView.tsx:71-112`](../../../apps/participant/src/graph/GraphView.tsx#L71) — the module-scope `STYLESHEET` constant. This leaf extends it with seven `node[rollupStatus = '<status>']` selectors and seven `edge[rollupStatus = '<status>']` selectors. The baseline `node` / `edge` selectors stay as the catch-all (the `'none'` rollup falls through to the baseline border + fill).
- [`apps/participant/src/graph/GraphView.tsx:171-206`](../../../apps/participant/src/graph/GraphView.tsx#L171) — the `useMemo` over `events` that computes `elements`. This leaf inserts a `computeFacetStatuses(events)` call right before the projection call and threads the index into `projectGraph(events, index)`; the per-element localization mapper stamps `rollupStatus` (and the full `facetStatuses` record) onto each `data` object.
- [`apps/participant/src/graph/GraphView.tsx:236`](../../../apps/participant/src/graph/GraphView.tsx#L236) — the returned `<div data-testid="participant-graph-root">`. This leaf wraps the container in a fragment and adds the test-mirror `<ul data-testid="participant-graph-status-mirror" aria-hidden="true" className="sr-only">` (with one `<li>` per node + one `<li>` per edge) as a sibling — same container element ref'd by Cytoscape stays the actual canvas mount.
- [`apps/participant/src/graph/projectGraph.ts:113-190`](../../../apps/participant/src/graph/projectGraph.ts#L113) — the pure `projectGraph(events)` function. This leaf widens its signature to `projectGraph(events, facetStatusIndex)` and extends the `ParticipantNodeData` / `ParticipantEdgeData` interfaces with `facetStatuses` and `rollupStatus`.
- [`apps/moderator/src/graph/facetStatus.ts:1-410`](../../../apps/moderator/src/graph/facetStatus.ts) — the canonical port source. The participant's mirror copies the file shape line-for-line (Decision §2's port-verbatim choice) with one trivial path-rewrite (the participant doesn't import from the server workspace either, so the "duplication justified by workspace boundaries" header comment carries over verbatim with the moderator's path reference updated to point to both the server source AND the moderator parallel).
- [`apps/moderator/src/graph/StatementNode.tsx:198-217`](../../../apps/moderator/src/graph/StatementNode.tsx#L198) — `ROLLUP_PRIORITY` + `cardRollupStatus`. Same shape on the participant side; the helper lives in the participant's `facetStatus.ts` for co-location (the moderator put it in `StatementNode.tsx` because the moderator's React custom node was its only consumer; the participant has multiple consumers — the projector AND the test mirror — so the helper sits in the module that defines the index).
- [`apps/moderator/src/graph/FacetPill.tsx:73-81`](../../../apps/moderator/src/graph/FacetPill.tsx#L73) — `PILL_STATUS_CLASSNAME`. The mapping table in Decision §1 below translates each Tailwind branch into the equivalent Cytoscape stylesheet rule.
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — the `Event` discriminated union the derivation walks. No change.
- [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) — the existing Playwright spec; this leaf extends it with a second `test()` block in the same `test.describe('Participant operate route — read-mostly graph render', ...)` group. The seed-via-`__aConversaWsStore` pattern is the same; the new block adds a `classify-node` proposal alongside the existing `node-created` and asserts the test mirror surfaces `data-rollup-status="proposed"`.

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts) — `loginAs(page, { username })`. Same alice + ben pattern the existing spec uses.
- [`tests/e2e/participant-graph-render.spec.ts:55-91`](../../../tests/e2e/participant-graph-render.spec.ts#L55) — `createSession`, `logoutAndClearAllCookies`, `freshContext` helpers (already in scope). The new `test()` block reuses them verbatim.
- [`playwright.config.ts`](../../../playwright.config.ts) — `chromium-participant-skeleton` already matches `participant-graph-render.spec.ts` after `part_graph_render`. No config change needed.

### What the surface MUST NOT do

- **No `fetch('/api/...')` from `GraphView` or the facet-status derivation.** The per-session WS slice is the single data source.
- **No mutation of the `useWsStore`.** Read-only via the selector.
- **No new top-level dependency.** Cytoscape is already declared by ADR 0004 + the participant `package.json`. The stylesheet extension uses Cytoscape's built-in selector vocabulary — no `cytoscape-node-html-label` plugin, no React DOM-overlay (Decision §6).
- **No write paths on the WS connection.** Voting / proposals / axiom-marks are downstream tasks' deliverables.
- **No new shell exports.** The facet-status port lives in the participant workspace per Decision §2.
- **No new i18n keys.** The per-facet status is communicated visually; the per-facet pill prose (which would need `methodology.facet.*` + `methodology.facetState.*` already in the catalog) is out of scope per the per-facet pill row deferral.
- **No deviation from the moderator's `ROLLUP_PRIORITY` order.** The moderator pinned `proposed > meta-disagreement > disputed > agreed > committed > withdrawn`; this leaf adopts the same order so the two surfaces don't drift.
- **No change to `projectGraph`'s output ordering.** Nodes still emit in `node-created` arrival order; edges in `edge-created` arrival order. The new fields are additive on each `data` object; they do not reshape the iteration.
- **No `data-facet-pill` attribute on participant elements.** That attribute is the moderator's `<FacetPill>` seam; the participant's test mirror uses `data-testid="participant-node-status"` / `data-testid="participant-edge-status"` to avoid colliding with the moderator's selectors (which run against the moderator workspace's DOM only, but the namespacing keeps the contracts uncoupled if a future Playwright spec drives both surfaces in the same page context).

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/graph/facetStatus.ts` — NEW. The verbatim port of the moderator's `facetStatus.ts` per Decision §2. Exports `FacetStatus`, `FacetName`, `FacetStatusIndex`, `EMPTY_FACET_STATUSES`, `computeFacetStatuses(events)`, plus the new `ROLLUP_PRIORITY` + `cardRollupStatus(facetStatuses)` helper (the moderator's `cardRollupStatus` lives inside `StatementNode.tsx`; the participant collocates it with the index because the participant's two consumers — the projector and the test mirror — both read it). Header comment links back to BOTH the server source (`apps/server/src/projection/facet-status.ts`) AND the moderator mirror (`apps/moderator/src/graph/facetStatus.ts`), so a future extract-into-shell refactor finds every copy.
- `apps/participant/src/graph/facetStatus.test.ts` — NEW. Vitest cases (16) mirroring the moderator's `facetStatus.test.ts` pin shape so a reader cross-referencing the two ports sees the same coverage: (a) empty event log → empty maps; (b) `classify-node` proposal, no votes → `nodes.get(nodeId).classification === 'proposed'`; (c) `classify-node` + one `agree` of two current participants → still `'proposed'`; (d) `classify-node` + all current participants `agree` → `'agreed'`; (e) `classify-node` + a `dispute` vote → `'disputed'`; (f) `classify-node` + all `agree` + a `commit` → `'committed'`; (g) committed `classify-node` + a `withdraw` → `'withdrawn'`; (h) `classify-node` + `mark-meta-disagreement` → `'meta-disagreement'`; (i) a left participant's vote is excluded from the agreement count; (j) `set-node-substance` proposal → substance facet; (k) `set-edge-substance` proposal → edge substance facet; (l) `edit-wording.reword` proposal → wording facet; (m) `decompose` proposal → per-component classification facets; (n) `interpretive-split` proposal → per-reading classification facets; (o) out-of-scope sub-kinds (`axiom-mark`, `meta-move`, `break-edge`, `annotate`) produce no facet entry; (p) `cardRollupStatus` priority-pair coverage (one case per `ROLLUP_PRIORITY` pair — `proposed > everything`, `meta-disagreement > disputed/agreed/committed/withdrawn`, `disputed > agreed/committed/withdrawn`, `agreed > committed/withdrawn`, `committed > withdrawn`).
- `apps/participant/src/graph/projectGraph.ts` — modified. `projectGraph` signature widens to `projectGraph(events: readonly Event[], facetStatusIndex: FacetStatusIndex): { nodes, edges }`. The `ParticipantNodeData` and `ParticipantEdgeData` interfaces grow `facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>` and `rollupStatus: FacetStatus | 'none'`. The walk stamps both fields on each emitted element. `rollupStatus` defaults to `'none'` (literal string) when the per-entity record is empty so Cytoscape's selectors have a stable value to match (`node[rollupStatus = 'none']` is the baseline branch).
- `apps/participant/src/graph/projectGraph.test.ts` — modified. Existing 10 cases adapted to the new signature (each test factory passes `{ nodes: new Map(), edges: new Map() } as FacetStatusIndex` for the no-facet baseline). 8 new cases added: (a) projection threads `facetStatuses.classification` through when the index carries the entry; (b) projection threads `facetStatuses.substance` for nodes; (c) projection threads `facetStatuses.wording` for nodes; (d) projection threads `facetStatuses.substance` for edges; (e) `rollupStatus` reads `'proposed'` when any facet is proposed; (f) `rollupStatus` reads `'agreed'` when all-agreed; (g) `rollupStatus` reads `'none'` (the sentinel) when the per-entity record is empty; (h) multi-facet node (classification proposed, substance agreed) rolls up to `'proposed'` per the priority order.
- `apps/participant/src/graph/GraphView.tsx` — modified. (1) Stylesheet extension: 14 new selectors (7 node-rollup + 7 edge-rollup) per the mapping table in Decision §1. (2) The `useMemo` over `events` runs `computeFacetStatuses(events)` once before the projection call; the index threads through; the per-element localization mapper carries through the new `facetStatuses` + `rollupStatus` fields. (3) The render returns a React fragment containing the existing `<div ref={containerRef} data-testid="participant-graph-root">` AND the new `<ul data-testid="participant-graph-status-mirror" aria-hidden="true" className="sr-only">` — the mirror sits as a sibling of the Cytoscape mount, both inside the surface-wide `participant-main` region. The mirror renders one `<li data-testid="participant-node-status" data-node-id="<id>" data-rollup-status="<status>" data-facet-classification="<status|empty>" data-facet-substance="<status|empty>" data-facet-wording="<status|empty>">` per node and one `<li data-testid="participant-edge-status" data-edge-id="<id>" data-rollup-status="<status>" data-facet-substance="<status|empty>">` per edge.
- `apps/participant/src/graph/GraphView.test.tsx` — modified. Existing 12 cases stay (signature shifts in the projection don't change the GraphView-level assertions). 9 new cases added: (a) the test mirror is present in the DOM after mount; (b) `aria-hidden="true"` on the mirror so screen readers skip it; (c) one `<li participant-node-status>` per emitted node; (d) one `<li participant-edge-status>` per emitted edge; (e) the node mirror's `data-rollup-status` reflects the `projectGraph` output when the index carries a status; (f) the edge mirror's `data-rollup-status` reflects the edge's substance status when seeded; (g) the node mirror's per-facet `data-facet-classification` / `-substance` / `-wording` attributes carry the per-facet status (or empty string for absent facets — Decision §4); (h) Cytoscape's internal element set carries the same `data.rollupStatus` value the mirror surfaces (sanity check via `cy.elements().jsons()` that the projection's data and the mirror don't drift); (i) a session switch (prop change) clears the prior mirror entries before painting the new session's set (no stale `<li>` leakage).
- `tests/e2e/participant-graph-render.spec.ts` — modified. Adds a second `test()` block: `alice creates a session, ben claims debater-A, seeded WS events + a classify-node proposal surface as proposed state on the participant graph`. The block reuses the existing helpers verbatim; seeds the lobby chain identically; THEN seeds `node-created` + `classify-node` `proposal` (no votes — the rollup is `'proposed'`) + `edge-created` + `set-edge-substance` `proposal` events into ben's WS store via `__aConversaWsStore`; asserts the test mirror has one `<li participant-node-status>` with `data-rollup-status="proposed"` and one `<li participant-edge-status>` with `data-rollup-status="proposed"`. Per the new ORCHESTRATOR.md note on canvas-paint: the assertion targets the DOM mirror, not the canvas pixels.
- `playwright.config.ts` — unchanged. `chromium-participant-skeleton` already matches `participant-graph-render.spec.ts`.
- `apps/participant/package.json` — unchanged. No new dependency; the stylesheet extension uses Cytoscape's built-in selector vocabulary.

### Files this task does NOT touch

- `apps/participant/src/routes/OperateRoute.tsx` — unchanged. The route composes `<GraphView>`; the per-facet styling is a `<GraphView>` internal.
- `apps/participant/src/main.tsx`, `apps/participant/src/App.tsx`, `apps/participant/src/ws/wsStore.ts`, `apps/participant/src/layout/*` — unchanged.
- `apps/moderator/` — no cross-surface change. The moderator's existing facet-status seam stays where it is; the duplication is documented in the new participant `facetStatus.ts` header for the eventual shell extract.
- `packages/shell/`, `packages/shared-types/`, `packages/i18n-catalogs/` — unchanged. No new substrate, no new types, no new strings.
- `apps/server/`, `apps/root/`, `apps/audience/` — unchanged.
- `docs/adr/` — no new ADR. Every decision below applies an existing ADR (0004 / 0021 / 0022 / 0024 / 0026 / 0027) or mirrors a settled moderator-side decision.
- `.tji` files — `complete 100` on `part_per_facet_state_styling` lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual.

### Component shape (additions to `GraphView.tsx`)

Sketched (deltas only):

```ts
// Module scope — new
import { computeFacetStatuses, cardRollupStatus, type FacetStatus } from './facetStatus';

// STYLESHEET extension — seven node-rollup + seven edge-rollup selectors
// appended to the existing two-selector array. Per Decision §1 the
// per-status visual maps verbatim from the moderator's
// `PILL_STATUS_CLASSNAME` and the moderator's `StatementNode` /
// `StatementEdge` card-frame branches.
const STYLESHEET: StylesheetJson = [
  // ... existing baseline node + edge selectors (unchanged) ...
  // proposed — dashed slate border, faded opacity, lighter fill
  { selector: 'node[rollupStatus = "proposed"]', style: {
    'border-style': 'dashed',
    'border-color': '#94a3b8',   // slate-400
    'background-color': '#f8fafc', // slate-50 — slight tint for the faded look
    opacity: 0.6,
  } },
  { selector: 'node[rollupStatus = "agreed"]', style: {
    'border-style': 'solid',
    'border-color': '#334155',   // slate-700
    'background-color': '#ffffff',
    opacity: 1,
  } },
  { selector: 'node[rollupStatus = "disputed"]', style: {
    'border-style': 'solid',
    'border-color': '#e11d48',   // rose-600
    'background-color': '#fff1f2', // rose-50 — slight tint
    'outline-color': '#f43f5e',  // rose-500 — the "ring" analog
    'outline-width': 2,
    opacity: 1,
  } },
  { selector: 'node[rollupStatus = "meta-disagreement"]', style: {
    'border-style': 'double',
    'border-color': '#7c3aed',   // violet-600
    'background-color': '#f5f3ff', // violet-50
    'outline-color': '#a78bfa',  // violet-400
    'outline-width': 2,
    opacity: 1,
  } },
  { selector: 'node[rollupStatus = "committed"]', style: {
    'border-style': 'solid',
    'border-color': '#94a3b8',   // slate-400 — closed-tone
    'background-color': '#ffffff',
    opacity: 0.9,
  } },
  { selector: 'node[rollupStatus = "withdrawn"]', style: {
    'border-style': 'dashed',
    'border-color': '#94a3b8',   // slate-400 — retracted
    'background-color': '#f8fafc',
    opacity: 0.5,
  } },
  // edge per-status (same vocabulary on the edge stroke; no fill on edges)
  { selector: 'edge[rollupStatus = "proposed"]', style: {
    'line-style': 'dashed',
    'line-color': '#94a3b8',
    'target-arrow-color': '#94a3b8',
    opacity: 0.6,
  } },
  { selector: 'edge[rollupStatus = "agreed"]', style: {
    'line-style': 'solid',
    'line-color': '#334155',
    'target-arrow-color': '#334155',
    opacity: 1,
  } },
  { selector: 'edge[rollupStatus = "disputed"]', style: {
    'line-style': 'solid',
    'line-color': '#e11d48',
    'target-arrow-color': '#e11d48',
    opacity: 1,
  } },
  { selector: 'edge[rollupStatus = "meta-disagreement"]', style: {
    'line-style': 'solid',  // Cytoscape has no `double` for edges; use solid violet
    'line-color': '#7c3aed',
    'target-arrow-color': '#7c3aed',
    opacity: 1,
  } },
  { selector: 'edge[rollupStatus = "committed"]', style: {
    'line-style': 'solid',
    'line-color': '#94a3b8',
    'target-arrow-color': '#94a3b8',
    opacity: 0.9,
  } },
  { selector: 'edge[rollupStatus = "withdrawn"]', style: {
    'line-style': 'dashed',
    'line-color': '#94a3b8',
    'target-arrow-color': '#94a3b8',
    opacity: 0.5,
  } },
];

// Inside the component — the elements memo widens
const elements = useMemo<ElementDefinition[]>(() => {
  const facetStatusIndex = computeFacetStatuses(events);
  const { nodes, edges } = projectGraph(events, facetStatusIndex);
  // ... existing localization mapper (kindLabel / roleLabel) carries through
  //     facetStatuses + rollupStatus on each data object unchanged ...
  return [...localizedNodes, ...localizedEdges];
}, [events, t]);

// Render — the existing div ref stays; the mirror sits alongside.
return (
  <>
    <div ref={containerRef} data-testid="participant-graph-root" className="h-full w-full" />
    <ul
      data-testid="participant-graph-status-mirror"
      aria-hidden="true"
      className="sr-only"
    >
      {projectedNodes.map((node) => (
        <li
          key={`node-${node.data.id}`}
          data-testid="participant-node-status"
          data-node-id={node.data.id}
          data-rollup-status={node.data.rollupStatus}
          data-facet-classification={node.data.facetStatuses.classification ?? ''}
          data-facet-substance={node.data.facetStatuses.substance ?? ''}
          data-facet-wording={node.data.facetStatuses.wording ?? ''}
        />
      ))}
      {projectedEdges.map((edge) => (
        <li
          key={`edge-${edge.data.id}`}
          data-testid="participant-edge-status"
          data-edge-id={edge.data.id}
          data-rollup-status={edge.data.rollupStatus}
          data-facet-substance={edge.data.facetStatuses.substance ?? ''}
        />
      ))}
    </ul>
  </>
);
```

(The `projectedNodes` / `projectedEdges` references above are the un-localized projector output the mirror reads from — the existing memo splits into a "raw projection" memo and the "localized elements" memo so the mirror has access to the per-element data without re-running the projector.)

## Acceptance criteria

The check that says "done":

- `apps/participant/src/graph/facetStatus.ts` exists, exports `FacetStatus`, `FacetName`, `FacetStatusIndex`, `EMPTY_FACET_STATUSES`, `computeFacetStatuses`, `ROLLUP_PRIORITY`, and `cardRollupStatus`. The seven derivation rules are mirrored verbatim from the moderator port; the header comment links back to both the server source AND the moderator mirror.
- `apps/participant/src/graph/facetStatus.test.ts` covers the 16 Vitest cases listed under Constraints.
- `apps/participant/src/graph/projectGraph.ts`'s `projectGraph` signature widens to `(events, facetStatusIndex)`; every emitted node and edge data object carries `facetStatuses` and `rollupStatus`. `rollupStatus` is the sentinel string `'none'` when the per-entity record is empty.
- `apps/participant/src/graph/projectGraph.test.ts` covers the 8 new Vitest cases + the 10 existing ones (adapted to the new signature).
- `apps/participant/src/graph/GraphView.tsx`'s stylesheet grows the 14 new selectors per Decision §1; the elements memo runs `computeFacetStatuses(events)` and threads the index into the projector; the render returns the existing `participant-graph-root` div AND the new `<ul data-testid="participant-graph-status-mirror">` mirror as siblings.
- `apps/participant/src/graph/GraphView.test.tsx` covers the 9 new Vitest cases + the 12 existing ones (no signature break — the new fields are additive). Per ADR 0022, every behavioural assertion is a committed test case.
- `tests/e2e/participant-graph-render.spec.ts` extends `test.describe('Participant operate route — read-mostly graph render', ...)` with the new `test()` block per the Constraints sketch. **Per ORCHESTRATOR.md UI-stream e2e policy**: the route IS reachable (settled by `part_graph_render`), so the e2e is in scope. The spec asserts via the DOM mirror, not via canvas pixels (Decision §4 covers the testability rationale and the explicit deviation from the prose-only "use `getByText` on SVG labels" of the original `part_graph_render` Decision §6).
- `pnpm run check` clean.
- `pnpm run test:smoke` green; Vitest count rises by the new cases (16 facetStatus + 8 projectGraph + 9 GraphView = +33).
- `pnpm -F @a-conversa/participant build` succeeds (bundle grows by the facet-status derivation; expected, no new dependency).
- `pnpm run test:e2e:smoke` (with the compose stack up via `make up`) executes the extended spec and it passes.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/40-participant-ui.tji` gets `complete 100` on `part_per_facet_state_styling` in the same commit (the Closer's ritual).

## Decisions

### §1 — Cytoscape stylesheet mapping mirrors `PILL_STATUS_CLASSNAME` + the moderator's card-frame branches verbatim

The moderator's per-status vocabulary is split across two sites:

- [`apps/moderator/src/graph/StatementNode.tsx`](../../../apps/moderator/src/graph/StatementNode.tsx) — the whole-card frame branches (`border-dashed border-slate-400 opacity-60` for proposed, `border-solid border-slate-700 opacity-100` for agreed, `border-solid border-rose-600 ring-2 ring-rose-500 opacity-100` for disputed, etc.) keyed on the rollup status.
- [`apps/moderator/src/graph/FacetPill.tsx:73-81`](../../../apps/moderator/src/graph/FacetPill.tsx#L73) — `PILL_STATUS_CLASSNAME` (the per-facet pill branches, same vocabulary, slightly scoped to the smaller surface).

The participant adopts the WHOLE-CARD vocabulary (not the pill vocabulary), translated to Cytoscape stylesheet rules. The mapping table:

| Rollup status | Moderator Tailwind (card frame) | Cytoscape participant equivalent |
| --- | --- | --- |
| `proposed` | `border-dashed border-slate-400 opacity-60` | `border-style: 'dashed'`, `border-color: '#94a3b8'`, `background-color: '#f8fafc'`, `opacity: 0.6` |
| `agreed` | `border-solid border-slate-700 opacity-100` | `border-style: 'solid'`, `border-color: '#334155'`, `background-color: '#ffffff'`, `opacity: 1` |
| `disputed` | `border-solid border-rose-600 ring-2 ring-rose-500 opacity-100` | `border-style: 'solid'`, `border-color: '#e11d48'`, `background-color: '#fff1f2'`, `outline-color: '#f43f5e'`, `outline-width: 2`, `opacity: 1` |
| `meta-disagreement` | `border-double border-violet-600 ring-1 ring-violet-400 opacity-100` (`<FacetPill>`) | `border-style: 'double'`, `border-color: '#7c3aed'`, `background-color: '#f5f3ff'`, `outline-color: '#a78bfa'`, `outline-width: 2`, `opacity: 1` |
| `committed` | (whole-card falls back to baseline; pill: `border-solid border-slate-400 opacity-90`) | `border-style: 'solid'`, `border-color: '#94a3b8'`, `background-color: '#ffffff'`, `opacity: 0.9` |
| `withdrawn` | (whole-card falls back to baseline; pill: `border-dashed border-slate-400 opacity-50`) | `border-style: 'dashed'`, `border-color: '#94a3b8'`, `background-color: '#f8fafc'`, `opacity: 0.5` |

Two surface-specific adaptations the table makes explicit:

1. **Cytoscape uses `outline-*`, not `ring-*`.** Tailwind's `ring-2 ring-rose-500` is a CSS `box-shadow` of `0 0 0 2px rgba(244, 63, 94, 1)`. Cytoscape doesn't expose `box-shadow` on nodes; the closest equivalent is `outline-color` + `outline-width` (Cytoscape 3.30+ added node outlines for exactly this use case). The disputed and meta-disagreement branches both compose `border-*` + `outline-*` to surface the "ring halo" the moderator's red marker carries.
2. **The participant DOES paint `committed` and `withdrawn` distinctly** (unlike the moderator's whole-card frame, which falls back to baseline for closed statuses). The participant has no per-facet pill row to carry the closed-state visual, so the rollup paint IS the only signal — every status needs its own distinct visual. The closed-state branches mirror the moderator's `<FacetPill>` PILL_STATUS_CLASSNAME entries (the only place the moderator paints `committed` / `withdrawn` distinctly).

Three alternatives were considered:

- **(a) Verbatim mapping of the moderator's whole-card frame (committed / withdrawn fall back to baseline).** Rejected because the participant has no per-facet pill row to surface the closed-state status; the rollup paint is the only signal, so closed statuses need their own visual.
- **(b) Mint a participant-specific palette (lighter / brighter to suit the tablet's read-mostly context).** Rejected: would force the moderator and the debater to learn two grammars for the same data. The methodology-driven recognition transfer (a `disputed` card on the canvas reads the same as a `disputed` card on the tablet) is load-bearing.
- **(c) Use Cytoscape's `overlay-*` properties instead of `outline-*` for the ring.** Cytoscape's `overlay` paints across the entire node bounding box (a translucent fill, not a stroke). Rejected because it dims the node body — the disputed marker should DRAW ATTENTION, not fade the content.

Chosen: the table above. The slight tints on the disputed / meta-disagreement / proposed / withdrawn backgrounds (`rose-50`, `violet-50`, `slate-50`) are a participant-side concession to Cytoscape's lack of a true "ring halo" — the tinted fill compensates for the visual prominence the moderator's box-shadow ring gives the card.

### §2 — Verbatim port of `computeFacetStatuses` into the participant workspace

The moderator's `facetStatus.ts` is the canonical client-side derivation. The two options for getting the same derivation into the participant surface:

- **(a) Port verbatim into `apps/participant/src/graph/facetStatus.ts` now; document the port; extract to `@a-conversa/shell` when the third caller (audience) materialises.** Chosen.
- **(b) Extract `computeFacetStatuses` into `@a-conversa/shell` in this commit so the participant imports from the shell.** Rejected — same YAGNI argument the precedents in `shared_shell_extract_merge_slots_and_derive_slot_occupants.md` and `part_graph_render` Decision §4 already made: extraction with two callers risks shaping the seam around the second caller's needs (which differ from the eventual third), and the duplication cost (a ~410-line file) is bounded and reversible. The extract becomes natural when the audience surface lands and is also Cytoscape-shaped; at that point the shell hosts a single canonical port and both Cytoscape consumers import it.

Header comment on the new participant file links back to:

- `apps/server/src/projection/facet-status.ts` (canonical server source — the rules' authoritative implementation);
- `apps/moderator/src/graph/facetStatus.ts` (parallel client mirror — both client ports must stay in lock-step if the server rules ever widen).

A future ADR / refinement that extracts the shared helper into `@a-conversa/shell` finds every copy via this comment trail. The duplication is registered as tech-debt implicitly via the "shell extract when the audience lands" tag on this Decision; no new tech-debt task today (the trigger is the third caller, not a calendar date — registering a "do this later" task without a concrete trigger inflates the WBS without buying any planning value).

### §3 — Derive per-entity status from the WS events slice; do NOT consume `pendingProposals[*].perFacetStatus` yet

The moderator's `mod_per_facet_breakdown` task (the right-sidebar per-facet chips per proposal) reads BOTH the local `computeFacetStatuses(events)` derivation AND the server's `pendingProposals[proposalId].perFacetStatus` broadcast frame (with server precedence — Decision §5 of that refinement). The participant's graph-card paint is a different scope:

- The breakdown chips are *per-proposal* (one chip per facet THIS proposal targets); the broadcast `perFacetStatus` is keyed by facet for the proposal's id, so it's a natural read.
- The participant's per-entity card paint is *per-entity-facet* (the full per-entity facet state across the entity's lifetime). The broadcast only covers facets attached to *pending* proposals — committed / withdrawn / meta-disagreement entities need the per-entity derivation regardless.

This leaf takes the simpler path: the per-entity derivation IS the source of truth for the per-entity card paint. The broadcast frame stays unconsumed by this leaf; a future leaf (likely under `part_voting` once the participant starts CONSUMING pending-proposal status per-facet at the proposal level) is the natural home for the broadcast read.

Alternatives:

- **(a) Read both (server broadcast for proposals AND per-entity derivation; broadcast precedence per facet).** Rejected for this leaf: doubles the read surface for a contract that doesn't differentiate (the broadcast surfaces the same status the client derivation produces from the same events — they should agree). The broadcast read becomes load-bearing once the participant has a per-proposal surface (the pending-proposals pane: `part_pending_proposals.*`), not on the per-entity card paint.
- **(b) Read broadcast only.** Rejected: the broadcast doesn't cover committed / withdrawn / meta-disagreement entities, so the card paint would be silent for closed entities (a bug — the methodology requires the closed-state distinction on the graph).

Decision: chosen (a) per-entity derivation only; the broadcast read deferred to a future per-proposal-surface task.

### §4 — Test mirror: an `aria-hidden` DOM `<ul>` next to the canvas

Cytoscape paints to `<canvas>` by default; DOM queries (`getByText`, `getByTestId`) cannot reach the painted labels or the rendered border colours. Three options for surfacing the per-element styling for tests:

- **(a) Render an `aria-hidden` `<ul>` mirror inside the `participant-graph-root` container, with one `<li>` per node and one per edge carrying `data-rollup-status` + per-facet attributes.** Chosen. Pros: zero new dependency; the mirror IS the live projection's data so a render-time drift would surface immediately; both Vitest and Playwright assert against the same DOM seam; `aria-hidden="true"` + `className="sr-only"` keeps the mirror invisible to users and screen readers (no UX cost); a future Cytoscape renderer switch (SVG vs canvas) does not break the test seam. Cons: the seam exists purely for testability — it's a tax on the production surface (a small one — six fields × N elements; for a session with ~50 entities the DOM cost is negligible).
- **(b) Switch Cytoscape to its SVG renderer for tests (and use the rendered SVG as the test seam).** Rejected: Cytoscape's SVG renderer is a third-party plugin (`cytoscape-svg`); the moderator-side parallel uses ReactFlow which is native-React (the participant has nothing equivalent); pulling in `cytoscape-svg` for tests means the test environment diverges from production (the production canvas renderer is the one painting the user's pixels, so test-via-SVG would pin the wrong path). The renderer-divergence cost outweighs the "no extra DOM" win.
- **(c) Expose the Cytoscape `Core` instance via the existing `cyRef` callback and assert through `cy.elements().jsons()` from Playwright via `page.evaluate`.** Partial fit. The Vitest layer CAN do this (and already does — the existing GraphView tests assert via `cy.elements()` exposed through the prop). The Playwright layer CANNOT cleanly: `cyRef` would need a `window.__aConversaCyInstance` dev-only export, which expands the test seam surface and risks production users tripping the dev seam (the existing `__aConversaWsStore` seam already exists; a second one for the Cytoscape instance would be more dev-surface for prod). The DOM mirror is simpler — the data is already in React state at the projection memo's output, so rendering it as a `<ul>` is essentially free.

Per-facet attribute encoding: empty-string `''` for absent facets rather than omitting the attribute. Reason: `[data-facet-classification]` selectors match presence-or-emptiness uniformly; `[data-facet-classification=""]` is an explicit empty-state probe. The alternative (omit attribute when the facet is absent) forces tests to differentiate "the facet had no status" from "the projection forgot to stamp the field" — a footgun.

`data-rollup-status` carries the `'none'` sentinel string for entities with no facet record (mirroring the projection's `rollupStatus: 'none'` field). A Playwright selector `[data-rollup-status="proposed"]` matches only the proposed entities, never the baseline.

### §5 — Playwright extension: a second `test()` block in the existing spec file

The existing `tests/e2e/participant-graph-render.spec.ts` is the natural home for the new e2e. Adding a second `test()` block inside the same `test.describe(...)` keeps the fixture setup (`freshContext`, `loginAs`, `createSession`, `logoutAndClearAllCookies`) shared and the spec file's narrative (every test exercises the participant operate route) coherent. Alternatives:

- **(a) Second `test()` block in the existing file.** Chosen.
- **(b) New spec file `tests/e2e/participant-graph-state-styling.spec.ts`.** Rejected for now: every test in the new file would replicate the same alice-creates → ben-claims → goto-operate setup; the second `test()` block reuses it via the existing describe's fixtures. The "split when it gets crowded" rule applies — when the describe grows past ~5 blocks the split becomes worth it.

The new `test()` block:

1. Sets up alice + ben + the session + the lobby chain (same as block 1).
2. Navigates ben to `/p/sessions/${sessionId}` and asserts the route renders (`route-operate` + `participant-graph-root` visible).
3. Seeds the events into ben's WS store via `__aConversaWsStore.getState().applyEvent(...)` (same idiom as block 1):
   - `node-created` for a known node id.
   - `proposal` of `classify-node` targeting that node (the participant ben is NOT the proposer — alice is, via the actor field — so no participant has voted yet, which means the derivation's Rule 7 → `'proposed'` applies).
   - `edge-created` referencing the seeded node and a second seeded node (so the edge isn't dropped by `GraphView`'s dangling-edge filter — the spec seeds TWO `node-created` events for the edge endpoints).
   - `proposal` of `set-edge-substance` targeting the edge.
4. Asserts via `page.getByTestId('participant-node-status').filter({ has: page.locator(`[data-node-id="${NODE_ID}"]`) })` that the node mirror's `data-rollup-status` is `"proposed"` (and `data-facet-classification="proposed"`); and similarly for the edge mirror's `data-rollup-status="proposed"` (and `data-facet-substance="proposed"`).

The spec budget is bounded — the new block is ~30 lines on top of the shared helpers; the chromium-participant-skeleton project already runs the first block in well under 30s, so the project's wall-clock for the second block is sub-15s.

### §6 — No per-facet pill row inside the Cytoscape node; per-facet detail is the entity detail panel's job

The moderator's `mod_per_facet_state_visualization` ships a `<FacetPill>` row inside the node card body (rendered above the wording paragraph; one pill per facet with its own status border). The participant CANNOT mirror this at the Cytoscape canvas layer — Cytoscape paints to `<canvas>` and there is no React tree per node. Three options for landing per-facet detail on the participant:

- **(a) Cytoscape DOM-overlay per node.** Position a React subtree at every node's screen coordinates, sync on pan/zoom ticks. Heavy (pan/zoom would need to re-sync every overlay's position on every tick, and the surface is read-mostly with pan/zoom enabled by default); essentially building a per-node React renderer for one piece of detail. Rejected.
- **(b) `cytoscape-node-html-label` plugin.** Third-party Cytoscape plugin that gives nodes an HTML-overlay layer for their bodies. Pulls a new dependency for ONE rendering feature whose primary home is the detail panel (`part_entity_detail_panel`). The `part_graph_render` Decision §2 already named this plugin as the documented escape hatch "if the styling layer hits a wall." This layer doesn't hit a wall — the rollup paint is the at-a-glance signal; the per-facet pill row's role is to satisfy the moderator's "look at this card to see all three facet states" need, which translates on the participant to "tap a node to see its detail panel" — a different gesture, owned by `part_entity_detail_panel`. Rejected for this leaf.
- **(c) Defer per-facet detail to the React-driven entity detail panel (`part_entity_detail_panel`).** Chosen. The detail panel IS a React surface; it can host the moderator's `<FacetPill>` vocabulary directly (with no library port — the pill is pure React, no ReactFlow / Cytoscape coupling — though the moderator workspace's `useTranslation` + `methodology.facet.*` catalog keys would need either an import shape adjustment for the participant's i18n bootstrap, or a tiny re-export shim in `@a-conversa/shell`; both are sub-half-day moves the detail-panel refinement can settle).

Decision §6: ship (c). The participant's at-a-glance signal IS the rollup paint; the per-facet drill-down is the tap-to-detail panel. The detail panel refinement (`part_entity_detail_panel`, 1d, depends `!part_pan_zoom_tap`) inherits the "host a `<FacetPill>` row" scope; this leaf does not preempt it.

### §7 — Resolves `part_graph_render`'s deferred `width: 'label'` deprecation: keep numeric width/height but bump max-width and rely on text wrap

The predecessor `part_graph_render` left a known deviation: Cytoscape 3.33 deprecated the `width: 'label'` / `height: 'label'` auto-sizing values (using them surfaces `console.warn`, which the vitest harness now treats as a test failure per commit `f2f086a`). The predecessor's stylesheet falls back to numeric `width: 200, height: 80` placeholders; the predecessor's Status block explicitly handed this question to THIS task. Three options to address it:

- **(a) Manual content-aware sizing via a function on the `width` / `height` properties.** Cytoscape supports per-property functions: `width: (ele) => Math.min(240, 60 + ele.data('wording').length * 4)` (similar for height). The function is recomputed at layout time. Pros: tighter fit to the actual wording. Cons: requires a custom heuristic per font-size / wrap-config; the heuristic risks under- or over-sizing depending on word boundaries; reverting on a future renderer change is a manual edit (vs. a stylesheet constant).
- **(b) Fixed numeric width with text wrapping + a small max-height bump.** Keep `width: 200` (current), keep `text-wrap: 'wrap'` (current), bump `text-max-width: '180px'` (current — leaves a 20px horizontal padding budget at the 200px width), but raise `height` so the wrapped wording always fits at the configured `font-size: 12px`. With a 180px text width and 12px text, three lines = ~48px of text height; padding budget is 12px each side = 24px; total target 72-80px. The current `80` height matches; the wording cap implicit in the methodology is "two short sentences" which fits the 3-line budget. Chosen.
- **(c) Switch to `cytoscape-node-html-label` for a real React content-driven sizing.** Same dependency the per-facet pill row deferral rejected; same rejection rationale.

Decision §7: ship (b). Keep `width: 200, height: 80` as the numeric pair; the per-status branches in §1 override `border-style` / `border-color` / `background-color` / `opacity` / `outline-*` without touching the dimensions, so the existing sizing stays as the baseline AND every state inherits it. A future `part_pw_touch_simulation` or visual-regression task can revisit if real-world wording lengths break the 3-line budget; the methodology's "two short sentences" cap makes this unlikely in practice.

Documentation: a comment on the `node` baseline selector spells out the `width: 200, height: 80` rationale and references this Decision so a future reader doesn't re-investigate the `width: 'label'` deprecation independently.

### §8 — Localized status label in `aria-label` on the test mirror is OUT of scope; the mirror is unlabeled

The mirror is `aria-hidden="true"`; screen readers skip it. A localized status word (e.g. "Classification proposed") would only matter if the mirror were a user-facing surface. It isn't — the mirror is the testability seam. The status semantics ARE in the `data-rollup-status` / `data-facet-*` attributes, which are machine-readable and locale-independent. No new i18n keys. (When `part_entity_detail_panel` lands and renders the per-facet pill row in a user-visible surface, that's where `methodology.facetState.*` reads land — those keys already exist in en-US / pt-BR / es-419, populated by `mod_per_facet_breakdown` per its Decision §10.)

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- Ported the moderator's facet-status derivation verbatim into the participant workspace at [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) — same `FacetStatus` / `FacetName` types, same seven derivation rules, same `EMPTY_FACET_STATUSES`, plus `ROLLUP_PRIORITY` + `cardRollupStatus(facetStatuses)` co-located with the index per Decision §2 (the moderator co-located the helper inside `StatementNode.tsx` because that was its sole consumer; the participant has two — projector + test mirror — so the helper lives in the module that defines the index). Header comment points back at both the server source AND the moderator mirror for the eventual `@a-conversa/shell` extract trigger.
- Stamped `facetStatuses` + `rollupStatus` (sentinel `'none'` when the per-entity record is empty, per Decision §1) on every Cytoscape element emitted by [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts); the projector signature widens to `projectGraph(events, facetStatusIndex)`. 8 new Vitest cases in [`projectGraph.test.ts`](../../../apps/participant/src/graph/projectGraph.test.ts) pin the per-facet threading + the rollup priority.
- Extended [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx)'s stylesheet with 14 per-status selectors (6 node + 6 edge plus the baseline-none branch via existing baseline rules), mapping the moderator's `border-style` / `border-color` / `background-color` / `outline-*` / `opacity` vocabulary onto Cytoscape per the Decision §1 table. 9 new component cases in [`GraphView.test.tsx`](../../../apps/participant/src/graph/GraphView.test.tsx) cover the rendered stylesheet + the projection sanity-check.
- Added the `<ul data-testid="participant-graph-status-mirror" aria-hidden="true" className="sr-only">` DOM mirror alongside the Cytoscape canvas (Decision §4); one `<li data-testid="participant-node-status">` per node and one `<li data-testid="participant-edge-status">` per edge, carrying `data-rollup-status` + per-facet `data-facet-*` attributes (empty string for absent facets). This is the testability seam canvas-blind DOM assertions read.
- Extended [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) with a second `test()` block in the existing describe that seeds `node-created` + `classify-node` proposal (no votes) + `edge-created` + `set-edge-substance` proposal events and asserts the mirror surfaces `data-rollup-status="proposed"` on both entities. **Tightening**: the new block uses maria+dave instead of the refinement sketch's alice+ben so the two `test()` blocks in the describe run in parallel under `fullyParallel: true` without racing on Authelia + server user creation for shared usernames. Behavioural pin unchanged.
- Verification: `pnpm run check` green; `pnpm run test:smoke` green (Vitest 3771 → 3806, +35 cases: 18 facetStatus + 8 projectGraph + 9 GraphView; the 18 facetStatus cases are the 16 specified plus 2 helper `cardRollupStatus` readability cases); chromium-participant-skeleton e2e project 11/11 green via `make up` → run → `make down-v clean`.
- No tech-debt task registered: Decision §2's "extract to `@a-conversa/shell` when the audience surface lands" is event-driven (trigger = third caller materialises), not calendar-driven; the refinement explicitly opted not to mint a tech-debt task without a concrete trigger.
