# Per-participant axiom-mark decoration on the participant's read-mostly graph

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_axiom_mark_decoration`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!participant_ui.part_graph_view.part_graph_render` (settled, commit landing 2026-05-17 — shipped the `/p/sessions/:id` `OperateRoute`, the `<GraphView>` Cytoscape mount, the pure `projectGraph(events)` projector, the per-session `useWsStore((s) => s.sessionState[sessionId]?.events)` selector idiom. Live code: [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx#L1), [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts#L1), [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx#L1)).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_per_facet_state_styling` (settled, commit landing 2026-05-17 — shipped two seams this leaf reuses. (1) the stylesheet pattern: per-status selectors layered on top of the baseline `node` / `edge` rules without touching the baseline branch — Decision §3 of this leaf adopts that pattern for the axiom-mark overlay; (2) the `<ul data-testid="participant-graph-status-mirror" aria-hidden="true" className="sr-only">` DOM mirror with one `<li data-testid="participant-node-status">` per node and one `<li data-testid="participant-edge-status">` per edge carrying `data-*` attributes — Decision §5 of this leaf extends the per-node mirror entry with a `data-is-axiom` attribute). The split between a raw `projected` memo and a `localized elements` / `renderedEdges` memo (settled in [`GraphView.tsx:354-388`](../../../apps/participant/src/graph/GraphView.tsx#L354)) gives the projector output a stable identity the mirror reads from — this leaf threads the axiom-mark field through the same split without restructuring.
- Prose-only context (NOT a `.tji` edge): the moderator's `mod_axiom_mark_decoration` (settled 2026-05-11 — refinement [`tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md`](../moderator-ui/mod_axiom_mark_decoration.md)) is the canonical "per-participant axiom-mark rendering" reference this leaf adapts. The moderator artifacts: [`apps/moderator/src/graph/selectors.ts:286-359`](../../../apps/moderator/src/graph/selectors.ts#L286) (the `AxiomMark` interface + `projectAxiomMarks(events)` + `groupAxiomMarksByNode(marks)` + `EMPTY_AXIOM_MARKS` module-scope frozen reference), [`apps/moderator/src/graph/selectors.ts:479-554`](../../../apps/moderator/src/graph/selectors.ts#L479) (the `AxiomMarkColor` triple + the frozen 6-bucket `AXIOM_MARK_PALETTE` + the deterministic `axiomMarkColorFor(participantId)` hash), [`apps/moderator/src/graph/AxiomMarkBadge.tsx`](../../../apps/moderator/src/graph/AxiomMarkBadge.tsx) (the per-participant React badge component). This leaf does NOT extract those primitives into `@a-conversa/shell` yet (Decision §2 — same "two callers is YAGNI; extract when the third caller materialises" policy the per-facet-state-styling leaf adopted for `computeFacetStatuses`); it ports `projectAxiomMarks` + `groupAxiomMarksByNode` verbatim into the participant workspace and consumes the boolean "node has at least one committed axiom-mark" derivation via a thin `nodeHasAxiomMark` helper (Decision §1 — per-participant chromatic identity is the moderator's job; the participant carries only the boolean signal at this layer).
- Prose-only context (NOT a `.tji` edge): `data_and_methodology.methodology_engine.axiom_mark_logic` (settled — the wire event is a `proposal` envelope whose inner payload is `{ kind: 'axiom-mark', node_id, participant }` per [`packages/shared-types/src/events/proposals.ts:275-279`](../../../packages/shared-types/src/events/proposals.ts#L275). The committed axiom-mark is the `proposal + matching commit` pair; the per-participant `axiomMarks` accumulate one entry per (node, participant) pair). This leaf consumes the same wire vocabulary the moderator consumes; no shared-types change.

## What this task is

Extend the participant's read-mostly `<GraphView>` so every node that carries at least one **committed axiom-mark** paints a visually distinct "bedrock" decoration on its Cytoscape card — the third visual-vocabulary layer on top of `part_graph_render` (baseline) and `part_per_facet_state_styling` (per-facet rollup status). Before this leaf, an axiom-marked node renders identically to any other node — the methodology's primary success state ("we have located the bedrock") is silent on the participant tablet. After this leaf, the debater sees at a glance which nodes the participants are holding as bedrock.

Concretely the deliverable is:

- A new `apps/participant/src/graph/axiomMarks.ts` — a verbatim port of the moderator's `projectAxiomMarks` / `groupAxiomMarksByNode` + the `AxiomMark` interface + the `EMPTY_AXIOM_MARKS` module-scope frozen array (sourced from [`apps/moderator/src/graph/selectors.ts:270-359`](../../../apps/moderator/src/graph/selectors.ts#L270)). Plus a new `nodeHasAxiomMark(grouped: ReadonlyMap<string, readonly AxiomMark[]>, nodeId: string): boolean` helper that returns `true` iff at least one committed axiom-mark targets the node. The per-participant chromatic palette (`AXIOM_MARK_PALETTE`, `axiomMarkColorFor`, `AxiomMarkColor`) is NOT ported — Decision §1 explains: the participant's Cytoscape canvas paints a boolean "is-axiom" border (not a per-participant badge), so the per-participant color identity stays a moderator-only seam. Header comment links back to both the moderator mirror (for the extract-into-shell trigger when the audience surface adopts the same Cytoscape vocabulary) AND the underlying methodology semantics ([`docs/methodology.md` §"Axioms / terminal values"](../../../docs/methodology.md#L198)).
- An extension to [`projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts) that takes an `axiomMarkIndex: ReadonlyMap<string, readonly AxiomMark[]>` as a third argument (after `events` and `facetStatusIndex`) and stamps an `isAxiom: boolean` field onto every emitted **node** element's `data`. (Edges carry no axiom-mark — the wire payload is node-scoped per `axiomMarkProposalSchema`, mirroring the moderator's Decision §"No edge-target axiom-marks in v1".) The `ParticipantNodeData` interface grows the new field; `ParticipantEdgeData` is unchanged. The walk doesn't re-derive — it only reads the precomputed `Map` via `nodeHasAxiomMark`.
- An extension to [`GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) that derives the `axiomMarkIndex` once per `events` change via `groupAxiomMarksByNode(projectAxiomMarks(events))` (a third `useMemo`, parallel to the existing `facetStatusIndex` memo) and threads it into `projectGraph`. The Cytoscape stylesheet grows one **additional** selector — `node[?isAxiom]` — that overlays a distinctive border-style + border-width on top of the per-status border the rollup layer paints (Decision §3 — the `[?isAxiom]` Cytoscape "boolean truthy" selector layer composes WITH the existing `node[rollupStatus = '<status>']` branches, not in place of them). The baseline `node` / `edge` selectors stay as the catch-all.
- An extension to the existing `<ul data-testid="participant-graph-status-mirror">` DOM mirror — every `<li data-testid="participant-node-status">` grows a `data-is-axiom` attribute carrying `"true"` or `"false"` (Decision §5 — the explicit "true"/"false" string keeps Playwright's `toHaveAttribute('data-is-axiom', 'true')` symmetric with the existing `data-rollup-status` / `data-facet-*` pattern, and the `[data-is-axiom="false"]` probe gives tests an explicit "we asserted not-axiom" branch). The edge mirror is unchanged (edges have no axiom-mark by methodology).
- Tests pin: Vitest at the projection-helper layer (`projectAxiomMarks` round-trips proposal + commit pairs; `groupAxiomMarksByNode` buckets; `nodeHasAxiomMark` returns the boolean), at the projector layer (`projectGraph` stamps `isAxiom: true` when the index carries entries for the node, `false` otherwise, regardless of facet rollup status), and at the `<GraphView>` render layer (the mirror surfaces the right `data-is-axiom` per node; the Cytoscape `cy.elements()` carries the same `data.isAxiom` value). Playwright at the e2e layer extends `tests/e2e/participant-graph-render.spec.ts` with a **third** `test()` block (using distinct usernames `frank` + `grace` per the precedent the prior block set — see Decision §6) that seeds two `node-created` events, a committed axiom-mark proposal on one of them (proposal + commit pair), and asserts the mirror surfaces `data-is-axiom="true"` on the marked node and `data-is-axiom="false"` on the unmarked node.

Out of scope (deferred to existing or future leaves):

- **Per-participant chromatic identity on the participant canvas.** The moderator paints one per-participant-colored badge per axiom-mark (so "Anna marked N9" and "Ben marked N9" render as two distinct badges in two distinct colors). This leaf paints ONE boolean per node — "at least one participant has marked this as bedrock." The per-participant chromatic decoration is deferred to either (a) the entity detail panel (`part_entity_detail_panel`, a future React surface that can host the moderator's `AxiomMarkBadge` vocabulary directly — same reasoning the per-facet pill row deferral in `part_per_facet_state_styling` used), or (b) a future polish leaf if the entity detail panel doesn't end up showing it (Decision §1 covers the alternatives + the rationale for the boolean overlay).
- **Pending (proposed-but-not-yet-committed) axiom-mark visualisation.** The moderator has a separate `mod_axiom_mark_pending_render` task that renders dashed dots for pending axiom-mark proposals. The participant equivalent is not in this leaf — the participant's at-a-glance signal is "ratified bedrock"; pending axiom-marks are an in-flight proposal that lives under the (future) `part_pending_proposals.*` group when the participant gets a pending-proposals pane. The boolean overlay this leaf paints is anchored on **committed** axiom-marks only, mirroring the moderator's `mod_axiom_mark_decoration` "render only committed" decision.
- **Axiom-mark creation flow (the "mark as my axiom" action) from the participant tablet.** Owned by the `participant_ui.part_axiom_mark_from_tablet.*` group (`part_mark_axiom_action`, `part_axiom_mark_proposal`). This leaf is rendering-only; the action is the dependent task.
- **Tooltip / screen-reader prose on the per-node axiom signal.** The mirror is `aria-hidden="true"` (testability seam only — same as the predecessor leaf established). The user-visible tooltip for "this node is bedrock for participant X" is deferred to `part_entity_detail_panel` where a React surface can host the localized `methodology.axiomMark.tooltip` / `srLabel` keys (already in the catalog per the moderator's leaf). No new i18n keys in this leaf.
- **Edge-target axiom-marks.** Wire schema is node-only (`{ kind: 'axiom-mark', node_id, participant }`); methodology semantics are node-only ("what could end this debate from this participant's side?" applies to statements, not inferential edges). Edge mirror is unchanged.
- **Visual regression on the rendered axiom-mark border.** Owned by `part_vr_state_styling` (already deferred there for the per-facet styling layer). Pixel comparisons of the rendered overlay are out of scope for this leaf; this leaf's tests pin observable behaviour through the DOM mirror, not pixel content.

## Why it needs to be done

`m_participant_mvp` ([`tasks/99-milestones.tji`](../../99-milestones.tji)) is the milestone at which a debater can see and engage with the live graph from their tablet. `part_graph_render` lit up the rendering surface; `part_per_facet_state_styling` painted the agreement-state vocabulary; this leaf paints the methodology's **primary success state** — bedrock. The methodology document is explicit on the load-bearing-ness:

- [`docs/methodology.md:204`](../../../docs/methodology.md#L204) — "Axioms are not a defect. They are often the most valuable output of the exercise: the debate dead-ends at 'A holds X as bedrock, B holds Y as bedrock, and that is the real disagreement.' Surfacing axioms is a primary success state."
- [`DESIGN.md:26`](../../../DESIGN.md#L26) — "Bedrock axioms — when 'nothing could change my mind', the system marks the node as an axiom. Surfacing axioms is a primary success state — the debate has identified the irreducible disagreement."
- [`docs/methodology.md:224-225`](../../../docs/methodology.md#L224) — axiom-marking is one of the canonical resolutions for cycle / contradiction diagnostics ("have a participant axiom-mark a node in the cycle (the chain terminates at that participant's bedrock)"); without rendering, the debater cannot see the resolution has landed.

The methodology assumes the debater sees the same axiom-mark signal the moderator does. Without this leaf, a committed axiom-mark lands silently in the debater's WS log and the debater has no visual confirmation that the bedrock has been recorded — the agreement loop the format depends on closes on the moderator's canvas but stays invisible on the participant's, defeating the methodology's "the proposal is visible on the graph in a distinct state from the moment it is made" assumption ([`docs/methodology.md`](../../../docs/methodology.md#L33-L41)).

Downstream concretely:

- **`part_axiom_mark_from_tablet.part_mark_axiom_action`** (the participant-side "mark as my axiom" gesture, a future leaf under a sibling group) consumes the same `axiomMarkIndex` derivation this leaf installs — the entity detail panel needs to know whether the local participant has already marked the node (to show "remove my axiom" instead of "mark as my axiom"). The `axiomMarks.ts` port is the seam that question reads off.
- **`part_entity_detail_panel`** (the React-driven tap-to-detail panel) is the natural home for the per-participant chromatic badge row (the moderator's `AxiomMarkBadge` vocabulary). When that leaf lands, it imports the moderator's `AxiomMarkBadge` directly (with the same `methodology.axiomMark.*` catalog keys already populated for en-US / pt-BR / es-419) — the per-participant attribution surface uses the chromatic palette; the at-a-glance card paint this leaf ships uses the boolean overlay.
- **`audience.aud_graph_render` + sibling audience leaves** become the third Cytoscape consumer of axiom-mark vocabulary. When they land, the natural extraction trigger lifts `axiomMarks.ts` (and `facetStatus.ts`) into `@a-conversa/shell`; both client surfaces import from a single source.
- The participant's `<GraphView>` becomes the **second concrete adoption of the moderator's axiom-mark vocabulary** (Cytoscape edition; the moderator is React/ReactFlow edition). The audience surface (future) will be the third, and the natural extraction trigger for lifting `projectAxiomMarks` + `groupAxiomMarksByNode` into `@a-conversa/shell` (Decision §2 — same "two callers is YAGNI; extract when the third materialises" policy `mergeSlots` and `computeFacetStatuses` already followed).

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Cytoscape on the participant surface; the stylesheet's `node[?<flag>]` selector is the canonical "boolean truthy" extension point this leaf uses for the axiom overlay.
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the wire-event vocabulary `projectAxiomMarks` walks; the inner `axiomMarkProposalSchema` shape (`{ kind: 'axiom-mark', node_id, participant }`) lives at [`packages/shared-types/src/events/proposals.ts:275-279`](../../../packages/shared-types/src/events/proposals.ts#L275). The shell client validates incoming envelopes at parse time, so this leaf's port trusts the discriminated-union narrowing.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behavioural assertion below is a committed Vitest case or Playwright scenario.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation()` is the participant surface's localization seam. This leaf does NOT add new user-facing strings — the at-a-glance boolean is communicated visually (border style); the per-participant attribution prose belongs in the entity detail panel where the catalog keys (`methodology.axiomMark.label` / `tooltip` / `srLabel`, populated for en-US / pt-BR / es-419 by `mod_axiom_mark_decoration`) get consumed.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the surface owns its mounted region only; `useWsStore` comes from the participant workspace's singleton (which delegates to the shell's `createDefaultWsStore`). No new shell substrate in this leaf.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — an axiom-mark is a per-participant decoration on the node entity, NOT a facet. The boolean overlay this leaf paints composes orthogonally with the per-facet rollup status the predecessor leaf paints — Decision §3 documents the stylesheet composition (the axiom overlay overrides border-style / border-width while leaving border-color / background-color / opacity / outline-* to the rollup branches).

No new ADR. Every decision below applies an existing ADR or mirrors a settled moderator-side decision; the architectural seams (Cytoscape library pick, micro-frontend shell, methodology vocabulary, two-callers-then-extract policy) are settled.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_per_facet_state_styling.md`](part_per_facet_state_styling.md) — the immediate predecessor. The stylesheet pattern (per-status selectors layered atop the baseline) + the DOM mirror seam are this leaf's reused infrastructure. Decision §3 + Decision §5 below build on the predecessor's seams without reshaping them.
- [`tasks/refinements/participant-ui/part_graph_render.md`](part_graph_render.md) — `<GraphView>` mount + `projectGraph` seam. Decision §4 of that leaf established "projection lives in the participant workspace; extraction waits for the third caller (audience surface)"; this leaf adopts the same posture for the axiom-mark port (Decision §2).
- [`tasks/refinements/participant-ui/part_state_management.md`](part_state_management.md) — the per-session `events` slice shape (`BaseWsSessionState.events: Event[]`) is exactly what `projectAxiomMarks` consumes; the port carries over the same input shape.
- [`tasks/refinements/participant-ui/part_landscape_layout.md`](part_landscape_layout.md) — the chrome the route renders inside; the test-mirror `<ul>` sits inside the `participant-graph-root` container alongside the Cytoscape canvas (no change), so the layout's `participant-main` region budget covers both unchanged.

### Sibling refinements on the moderator (the vocabulary this leaf adapts)

- [`tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md`](../moderator-ui/mod_axiom_mark_decoration.md) — the canonical "client computes axiom-mark from event log; renders per-participant" pattern. This leaf adopts the projection verbatim and reduces the rendering to a per-node boolean (Decisions §1 and §2 explain the reduction).
- [`tasks/refinements/moderator-ui/mod_axiom_mark_pending_render.md`](../moderator-ui/mod_axiom_mark_pending_render.md) — pending-side rendering. NOT mirrored in this leaf; the participant's pending visualisation is deferred to the (future) pending-proposals pane.

### Live code the leaf plugs into

- [`apps/participant/src/graph/GraphView.tsx:110-271`](../../../apps/participant/src/graph/GraphView.tsx#L110) — the module-scope `STYLESHEET` constant. This leaf appends one **additional** node selector — `node[?isAxiom]` — between the per-status `node[rollupStatus = "..."]` branches and the per-status `edge[rollupStatus = "..."]` branches (or at the end of the node block; ordering within the array doesn't matter for the truthy-selector branch because Cytoscape's selector specificity is cumulative — Decision §3 walks through the cascade). The baseline `node` / `edge` selectors stay as the catch-all.
- [`apps/participant/src/graph/GraphView.tsx:316-352`](../../../apps/participant/src/graph/GraphView.tsx#L316) — the component body. This leaf inserts a third `useMemo` (parallel to the existing `facetStatusIndex` memo at line 352) that derives `axiomMarkIndex` via `groupAxiomMarksByNode(projectAxiomMarks(events))`. The `projected` memo (line 364) takes the axiom index as a third argument; the localized `elements` memo (line 390) carries `isAxiom` through via the existing `...node.data` spread.
- [`apps/participant/src/graph/GraphView.tsx:436-462`](../../../apps/participant/src/graph/GraphView.tsx#L436) — the returned fragment. This leaf adds one `data-is-axiom={...}` attribute on the existing `<li data-testid="participant-node-status">` element. No new wrapper / no new `<li>`; the edge mirror is unchanged.
- [`apps/participant/src/graph/projectGraph.ts:67-78`](../../../apps/participant/src/graph/projectGraph.ts#L67) — `ParticipantNodeData`. This leaf adds `readonly isAxiom: boolean;` to the interface. `ParticipantEdgeData` is unchanged.
- [`apps/participant/src/graph/projectGraph.ts:172-258`](../../../apps/participant/src/graph/projectGraph.ts#L172) — `projectGraph`. This leaf widens the signature to `projectGraph(events, facetStatusIndex, axiomMarkIndex)`; the node-creation branch consults `nodeHasAxiomMark(axiomMarkIndex, event.payload.node_id)` and stamps the boolean. No change to the edge branch.
- [`apps/moderator/src/graph/selectors.ts:270-359`](../../../apps/moderator/src/graph/selectors.ts#L270) — the canonical port source for `AxiomMark`, `projectAxiomMarks`, `groupAxiomMarksByNode`, `EMPTY_AXIOM_MARKS`. The participant's `axiomMarks.ts` mirror copies the function bodies line-for-line; the per-participant palette (lines 475-554 of the same file) is **not** ported — Decision §1 explains.
- [`packages/shared-types/src/events/proposals.ts:275-281`](../../../packages/shared-types/src/events/proposals.ts#L275) — `axiomMarkProposalSchema` + `AxiomMarkProposal` type. No change; the port reads the same shape.
- [`tests/e2e/participant-graph-render.spec.ts:103-548`](../../../tests/e2e/participant-graph-render.spec.ts#L103) — the existing Playwright describe with the two `test()` blocks (`alice`+`ben` and `maria`+`dave`). This leaf extends it with a third `test()` block using `frank`+`grace` per the precedent — Decision §6 walks through the assertion shape.

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts) — `loginAs(page, { username })`. Same pattern the prior blocks use; `frank` and `grace` are existing Authelia dev users.
- [`tests/e2e/participant-graph-render.spec.ts:64-101`](../../../tests/e2e/participant-graph-render.spec.ts#L64) — `createSession`, `logoutAndClearAllCookies`, `freshContext` helpers (already in scope at the spec module level). The new `test()` block reuses them verbatim.
- [`playwright.config.ts`](../../../playwright.config.ts) — `chromium-participant-skeleton` already matches `participant-graph-render.spec.ts` (added by `part_graph_render`). No config change needed.

### What the surface MUST NOT do

- **No `fetch('/api/...')` from `GraphView` or the axiom-mark derivation.** The per-session WS slice is the single data source.
- **No mutation of the `useWsStore`.** Read-only via the selector.
- **No new top-level dependency.** Cytoscape is already declared by ADR 0004 + the participant `package.json`. The stylesheet extension uses Cytoscape's built-in selector vocabulary.
- **No write paths on the WS connection.** Voting / proposals / axiom-mark creation are downstream tasks' deliverables (axiom-mark creation is the `part_axiom_mark_from_tablet.*` group).
- **No new shell exports.** The axiom-mark port lives in the participant workspace per Decision §2.
- **No new i18n keys.** The visual at-a-glance signal is a border-style; the prose surface is the entity detail panel's future job (the `methodology.axiomMark.*` keys already exist and will be consumed there).
- **No port of `AXIOM_MARK_PALETTE` / `axiomMarkColorFor` / `AxiomMarkColor`.** The per-participant chromatic identity is a moderator-only seam at this iteration — the participant carries only the boolean signal at the at-a-glance card layer (Decision §1).
- **No port of `AxiomMarkBadge`.** Same rationale — that component is the per-participant chromatic decoration; the participant's at-a-glance signal is the border-style overlay on the Cytoscape node, not a React badge.
- **No deviation from the moderator's "render committed only, never pending" rule.** Same as the moderator's `mod_axiom_mark_decoration` Decision: the badge represents "ratified bedrock"; pending axiom-marks belong in a future pending-proposals pane.
- **No change to `projectGraph`'s output ordering.** Nodes still emit in `node-created` arrival order; edges in `edge-created` arrival order. The new `isAxiom` field is additive on each node `data` object; it does not reshape iteration.
- **No change to the edge data shape.** Axiom-marks are node-only by methodology + wire schema; the edge mirror entry is unchanged.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/graph/axiomMarks.ts` — NEW. Verbatim port of the moderator's `AxiomMark` interface, `EMPTY_AXIOM_MARKS` module-scope frozen empty array, `projectAxiomMarks(events)` pure function (single-pass walk: `proposal` of `axiom-mark` cached by envelope id; `commit` of cached proposal emits an `AxiomMark { nodeId, participantId, committedAt }`; uncommitted proposals produce nothing), and `groupAxiomMarksByNode(marks)` bucketing helper. Plus a new `nodeHasAxiomMark(grouped, nodeId): boolean` helper (Decision §1) that returns `(grouped.get(nodeId)?.length ?? 0) > 0`. Header comment links back to BOTH the moderator source (`apps/moderator/src/graph/selectors.ts`) AND the methodology semantics doc (`docs/methodology.md` §"Axioms / terminal values"). The per-participant palette (`AXIOM_MARK_PALETTE` etc.) is explicitly NOT ported — Decision §1 + a comment in the file spells out the rationale so a future reader doesn't mistake the omission for an oversight.
- `apps/participant/src/graph/axiomMarks.test.ts` — NEW. Vitest cases (7) mirroring the moderator's `projectAxiomMarks` coverage from [`apps/moderator/src/graph/selectors.test.ts`](../../../apps/moderator/src/graph/selectors.test.ts) so a reader cross-referencing the two ports sees the same pin: (a) empty event log → `[]`; (b) `axiom-mark` proposal without commit → `[]`; (c) one (proposal + commit) pair → one `AxiomMark` with the right `nodeId` / `participantId` / `committedAt`; (d) two participants marking the same node → two records (the per-participant uniqueness invariant); (e) emission order matches commit arrival order; (f) mixed log — non-axiom-mark proposals (`classify-node`, `set-edge-substance`) and unrelated event kinds are ignored; (g) `groupAxiomMarksByNode` buckets correctly + `nodeHasAxiomMark` returns `true` for a bucketed node and `false` for an unbucketed one.
- `apps/participant/src/graph/projectGraph.ts` — modified. (1) `ParticipantNodeData` grows `readonly isAxiom: boolean`. (2) `projectGraph`'s signature widens to `projectGraph(events: readonly Event[], facetStatusIndex: FacetStatusIndex, axiomMarkIndex: ReadonlyMap<string, readonly AxiomMark[]>): { nodes, edges }`. (3) The `node-created` branch consults `nodeHasAxiomMark(axiomMarkIndex, event.payload.node_id)` to set the field. (4) The `commit` branch that rewrites a node descriptor preserves the prior `isAxiom` via the existing `...existing.data` spread (no special handling needed — the spread carries the boolean unchanged; this is mechanically equivalent to how the spread already preserves `facetStatuses` + `rollupStatus`). (5) The `ParticipantEdgeData` shape is unchanged.
- `apps/participant/src/graph/projectGraph.test.ts` — modified. Existing cases adapted to the new signature (each test factory passes `new Map() as ReadonlyMap<string, readonly AxiomMark[]>` for the no-axioms baseline). 5 new cases added: (a) projection stamps `isAxiom: false` on every node by default (no axiom index); (b) projection stamps `isAxiom: true` on a node the axiom index targets; (c) projection stamps `isAxiom: false` on the other nodes when only one is targeted; (d) `isAxiom` survives a classify-node commit (the spread in the `commit` branch preserves the boolean); (e) edges carry no `isAxiom` field — `ParticipantEdgeData` does not include the property and the emitted edge `data` matches the type exactly.
- `apps/participant/src/graph/GraphView.tsx` — modified. (1) Stylesheet extension: ONE new selector `node[?isAxiom]` per Decision §3 — overlays `border-style: 'double'`, `border-width: 3`, with `border-color` / `background-color` / `opacity` / `outline-*` left to the per-status branch beneath it. (2) A third `useMemo` (placed between the existing `facetStatusIndex` memo and the `projected` memo) derives `axiomMarkIndex = groupAxiomMarksByNode(projectAxiomMarks(events))` once per `events` change. (3) The `projected` memo's dependency list grows `axiomMarkIndex`; the `projectGraph` call takes it as the third argument. (4) The localized `elements` memo carries `isAxiom` through via the existing `...node.data` spread — no per-element re-stamp needed. (5) The mirror `<li data-testid="participant-node-status">` grows a `data-is-axiom={node.data.isAxiom ? 'true' : 'false'}` attribute (small helper `axiomAttr(value: boolean): 'true' | 'false'` matching the existing `rollupAttr` / `facetAttr` shape for consistency).
- `apps/participant/src/graph/GraphView.test.tsx` — modified. Existing cases stay (the additive field doesn't break them once the test factories pass the empty axiom-mark index). 5 new cases added: (a) the mirror `<li participant-node-status>` carries `data-is-axiom="false"` by default; (b) when a committed axiom-mark targets the node, the mirror reports `data-is-axiom="true"`; (c) when two participants mark the same node, the mirror still reports `data-is-axiom="true"` (the boolean OR — multiple marks collapse to one signal); (d) Cytoscape's internal element set carries the same `data.isAxiom` value the mirror surfaces (sanity check via `cy.elements().jsons()`); (e) the stylesheet contains the `node[?isAxiom]` selector with the expected border-style / border-width overrides (assert against `STYLESHEET` import; module-scope constant is testable directly).
- `tests/e2e/participant-graph-render.spec.ts` — modified. Adds a third `test()` block: `frank creates a session, grace claims debater-A, seeded WS events + a committed axiom-mark proposal surface as data-is-axiom="true" on the marked node`. Per Decision §6 — uses `frank` + `grace` (the next pair in the alphabet after the prior block's `maria` + `dave`) to keep `fullyParallel: true` execution race-free under Authelia + server user creation. Seeds: two `node-created` events; one `proposal` envelope with inner `{ kind: 'axiom-mark', node_id: NODE_A_ID, participant: PARTICIPANT_ID }`; one `commit` envelope referencing that proposal's envelope id. Asserts: the node-A mirror entry has `data-is-axiom="true"`; the node-B mirror entry has `data-is-axiom="false"`. Per the predecessor leaf's pattern: the assertions target the DOM mirror, not the canvas pixels.
- `playwright.config.ts` — unchanged. `chromium-participant-skeleton` already matches `participant-graph-render.spec.ts`.
- `apps/participant/package.json` — unchanged. No new dependency.

### Files this task does NOT touch

- `apps/participant/src/routes/OperateRoute.tsx` — unchanged. The route composes `<GraphView>`; the axiom-mark overlay is a `<GraphView>` internal.
- `apps/participant/src/main.tsx`, `apps/participant/src/App.tsx`, `apps/participant/src/ws/wsStore.ts`, `apps/participant/src/layout/*` — unchanged.
- `apps/participant/src/graph/facetStatus.ts` — unchanged. The facet-status derivation stays untouched; the axiom-mark derivation is an independent module.
- `apps/moderator/` — no cross-surface change. The moderator's existing axiom-mark seam stays where it is; the duplication is documented in the new participant `axiomMarks.ts` header for the eventual shell extract.
- `packages/shell/`, `packages/shared-types/`, `packages/i18n-catalogs/` — unchanged. No new substrate, no new types, no new strings.
- `apps/server/`, `apps/root/`, `apps/audience/` — unchanged.
- `docs/adr/` — no new ADR. Every decision below applies an existing ADR (0004 / 0021 / 0022 / 0024 / 0026 / 0027) or mirrors a settled moderator-side decision.
- `.tji` files — `complete 100` on `part_axiom_mark_decoration` lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual.

### Component shape (additions to `GraphView.tsx`)

Sketched (deltas only):

```ts
// Module scope — new
import { groupAxiomMarksByNode, projectAxiomMarks, type AxiomMark } from './axiomMarks';

// STYLESHEET extension — ONE new node selector appended after the
// per-status branches. Per Decision §3 the axiom overlay overrides
// border-style + border-width WITHOUT touching border-color /
// background-color / opacity / outline-* — those stay owned by the
// per-status branch beneath, so the composition is "rollup paints
// colour + opacity; axiom paints the double border on top".
const STYLESHEET: StylesheetJson = [
  // ... existing baseline node + edge selectors (unchanged) ...
  // ... existing 12 per-status node + edge selectors (unchanged) ...
  // is-axiom overlay — Cytoscape's `[?<flag>]` selector matches when
  // `data.<flag>` is truthy. Composes WITH the per-status branches:
  // a node with `rollupStatus = "agreed"` AND `isAxiom = true` paints
  // slate-700 colour (from the agreed branch) + double border + width 3
  // (from this overlay). The double border is the moderator's
  // meta-disagreement border-style — they don't collide because a
  // meta-disagreement node carries `rollupStatus = "meta-disagreement"`
  // AND `isAxiom = false` in the common case; if both ever co-fire,
  // the visual is "violet double border + width 3" which still reads
  // as both "this is meta-disagreement" and "this is bedrock" without
  // a third visual ambiguity. Decision §3 alternatives §A-§D walk
  // through the rejected styles.
  { selector: 'node[?isAxiom]', style: {
    'border-style': 'double',
    'border-width': 3,
  } },
];

// Inside the component — third memo, parallel to facetStatusIndex
const axiomMarkIndex = useMemo(
  () => groupAxiomMarksByNode(projectAxiomMarks(events)),
  [events],
);

// Projected memo — dependency widens
const projected = useMemo(
  () => projectGraph(events, facetStatusIndex, axiomMarkIndex),
  [events, facetStatusIndex, axiomMarkIndex],
);

// Mirror — the existing <li> grows ONE attribute
<li
  key={`node-${node.data.id}`}
  data-testid="participant-node-status"
  data-node-id={node.data.id}
  data-rollup-status={rollupAttr(node.data.rollupStatus)}
  data-facet-classification={facetAttr(node.data.facetStatuses.classification)}
  data-facet-substance={facetAttr(node.data.facetStatuses.substance)}
  data-facet-wording={facetAttr(node.data.facetStatuses.wording)}
  data-is-axiom={axiomAttr(node.data.isAxiom)}
/>
```

The localized `elements` memo carries `isAxiom` through via the existing `...node.data` spread — no change to the mapper body.

## Acceptance criteria

The check that says "done":

- `apps/participant/src/graph/axiomMarks.ts` exists, exports `AxiomMark`, `EMPTY_AXIOM_MARKS`, `projectAxiomMarks`, `groupAxiomMarksByNode`, and `nodeHasAxiomMark`. The projection rules mirror the moderator port verbatim; the per-participant palette is explicitly NOT included (commented in-file).
- `apps/participant/src/graph/axiomMarks.test.ts` covers the 7 Vitest cases listed under Constraints.
- `apps/participant/src/graph/projectGraph.ts`'s `projectGraph` signature widens to `(events, facetStatusIndex, axiomMarkIndex)`; every emitted node data object carries `isAxiom: boolean`; edge data is unchanged.
- `apps/participant/src/graph/projectGraph.test.ts` covers the 5 new Vitest cases plus the adapted existing cases.
- `apps/participant/src/graph/GraphView.tsx`'s stylesheet grows the `node[?isAxiom]` selector per Decision §3; a third `useMemo` derives `axiomMarkIndex` and threads it into the projector; the mirror `<li>` grows `data-is-axiom`.
- `apps/participant/src/graph/GraphView.test.tsx` covers the 5 new Vitest cases plus the adapted existing cases. Per ADR 0022, every behavioural assertion is a committed test case.
- `tests/e2e/participant-graph-render.spec.ts` extends `test.describe('Participant operate route — read-mostly graph render', ...)` with the new `test()` block per the Constraints sketch. **Per ORCHESTRATOR.md UI-stream e2e policy**: the route IS reachable (settled by `part_graph_render`) and the per-status mirror IS in place (settled by `part_per_facet_state_styling`), so the e2e is in scope. The spec asserts via the DOM mirror, not via canvas pixels.
- `pnpm run check` clean.
- `pnpm run test:smoke` green; Vitest count rises by the new cases (7 axiomMarks + 5 projectGraph + 5 GraphView = +17, baseline 3806).
- `pnpm -F @a-conversa/participant build` succeeds (bundle grows by the axiom-mark derivation; expected, no new dependency).
- `pnpm run test:e2e:smoke` (with the compose stack up via `make up`) executes the extended spec and it passes.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/40-participant-ui.tji` gets `complete 100` on `part_axiom_mark_decoration` in the same commit (the Closer's ritual).

## Decisions

### §1 — Boolean `isAxiom` overlay at the at-a-glance card layer; per-participant chromatic identity deferred to the entity detail panel

The moderator's `mod_axiom_mark_decoration` renders one per-participant-colored badge per (node, participant) axiom-mark — so a node Anna AND Ben both marked carries two distinct badges in two distinct colors. The per-participant chromatic identity is load-bearing for the moderator: the methodology requires the moderator to see *which participant* marked the axiom because the per-participant attribution is "the recorded methodology disposition" (Anna's bedrock and Ben's bedrock are different recorded events with different implications).

The participant's at-a-glance card layer faces a different constraint. The methodology's debater-side use of axiom-marks is anchored on two questions: (a) "is this node bedrock for anyone in this debate?" — the at-a-glance signal that says "the conversation has located a foundation here"; (b) "who marked it, and have I marked it?" — the drill-down detail the debater consults when they tap the node. Question (a) is a single boolean per node; question (b) needs the per-participant breakdown.

Three options:

- **(a) Boolean `isAxiom` overlay at the at-a-glance card layer; per-participant chromatic identity owned by the entity detail panel.** Chosen. The boolean overlay paints a single visual signal per node ("bedrock"); the per-participant breakdown lives in the React-driven entity detail panel (`part_entity_detail_panel`, a future leaf — same panel that hosts the per-facet pill row deferral from `part_per_facet_state_styling`). When the detail panel lands, it imports the moderator's `AxiomMarkBadge` directly (same per-participant palette, same chromatic identity, same `methodology.axiomMark.tooltip` / `srLabel` catalog keys) — the panel IS a React tree, no Cytoscape constraint, no library port needed.
- **(b) Per-participant chromatic badges as Cytoscape DOM overlays.** Position one rendered React badge per axiom-mark at each Cytoscape node's screen coordinates, sync on pan/zoom ticks. Same heavy mechanism the per-facet pill row deferral rejected — pan/zoom would re-sync every overlay's position on every tick. The per-participant data is also not load-bearing at the at-a-glance layer (the debater is looking at the whole graph; per-participant detail is a tap-to-drill-down moment, not a panoramic-view moment). Rejected.
- **(c) Per-participant chromatic painted via Cytoscape stylesheet — one selector per participant.** Cytoscape's stylesheet is static; participant ids are dynamic per session. Generating selectors at render time defeats the module-scope `STYLESHEET` stability the predecessor leaves established (the stylesheet is a stable reference passed into `cytoscape({...})` at mount); injecting per-participant selectors would force a re-mount or a `cy.style()` swap per axiom-mark commit. Mechanism mismatch; rejected.

Decision §1: ship (a). The participant carries only the boolean signal at the at-a-glance card layer. The per-participant identity (color + attribution) lands in the entity detail panel when that leaf ships. This is the same scoping pattern `part_per_facet_state_styling` used for the per-facet pill row: at-a-glance signal on the Cytoscape canvas, drill-down detail in the React-driven panel.

A consequence of (a): `axiomMarks.ts` does NOT port the moderator's `AXIOM_MARK_PALETTE`, `axiomMarkColorFor`, or `AxiomMarkColor`. The port is the algorithm (`projectAxiomMarks` + `groupAxiomMarksByNode`) plus the boolean helper (`nodeHasAxiomMark`); the chromatic primitives stay moderator-only until the entity detail panel needs them (at which point an extract-into-shell move can also lift them, since the panel will be a React surface compatible with the moderator's `AxiomMarkBadge` import shape).

### §2 — Verbatim port of `projectAxiomMarks` + `groupAxiomMarksByNode` into the participant workspace; no shell extraction yet

The moderator's `selectors.ts` is the canonical client-side axiom-mark derivation. The two options for getting the same derivation into the participant surface:

- **(a) Port verbatim into `apps/participant/src/graph/axiomMarks.ts` now; document the port; extract to `@a-conversa/shell` when the third caller (audience) materialises.** Chosen.
- **(b) Extract `projectAxiomMarks` + `groupAxiomMarksByNode` into `@a-conversa/shell` in this commit so the participant imports from the shell.** Rejected — same YAGNI argument the precedents in `shared_shell_extract_merge_slots_and_derive_slot_occupants.md`, `part_graph_render` Decision §4, and `part_per_facet_state_styling` Decision §2 already made: extraction with two callers risks shaping the seam around the second caller's needs (which differ from the eventual third), and the duplication cost (a ~70-line port — much smaller than `facetStatus.ts`) is bounded and reversible.

Header comment on the new participant file links back to:

- `apps/moderator/src/graph/selectors.ts` (parallel client mirror — both client ports must stay in lock-step if a future axiom-mark wire-event shape change lands);
- `docs/methodology.md` §"Axioms / terminal values" (the canonical semantics — the "ratified bedrock" semantic that anchors the "render committed only" rule).

A future ADR / refinement that extracts the shared helper into `@a-conversa/shell` finds the moderator copy via this comment trail. The duplication is registered implicitly via the "shell extract when the audience lands" tag on this Decision; no new tech-debt task today (the trigger is the third caller, not a calendar date — registering a "do this later" task without a concrete trigger inflates the WBS without buying any planning value; same posture the per-facet-state-styling leaf took).

### §3 — Axiom overlay = `node[?isAxiom]` Cytoscape selector with `border-style: 'double'` + `border-width: 3`; composes WITH per-status border-color rather than overriding it

The axiom-mark overlay needs to be a layer that (a) reads at-a-glance as "this node is bedrock", (b) composes cleanly with the per-status rollup branches the predecessor leaf installed, (c) is testable via the DOM mirror without canvas-pixel introspection. Four options for the visual treatment:

- **(A) `border-style: 'double'` + `border-width: 3` overlay; per-status branch still owns `border-color` / `background-color` / `opacity` / `outline-*`.** Chosen.
- **(B) Icon overlay via Cytoscape's `background-image` property** — a small "A" or pyramid SVG glyph painted into the node body. Cytoscape supports `background-image` per-element, but the icon would need an SVG/PNG asset bundled with the participant workspace AND the icon's z-order would compete with the wording text Cytoscape paints centered in the node body. Rejected: asset management overhead + visual collision with the wording label.
- **(C) Outline halo via `outline-color: '<axiom-color>'` + `outline-width: 4`.** Conflicts with the per-status branches that already use `outline-*` (the `disputed` and `meta-disagreement` branches set `outline-color` + `outline-width`; the axiom overlay would override the per-status ring halo). Rejected: would silently suppress the per-status disputed/meta-disagreement signal on any axiom-marked node — exactly the cross-layer interference Decision §3 should prevent.
- **(D) Prepend a Unicode glyph (e.g. "▲") to the wording label** by mutating `data.wording` in the projection. Rejected: contaminates the wording field with rendering concerns (the wording is the user's literal proposed statement; prepending visual decoration to it muddles the projection's role); also localization-fragile (some locales / fonts may render the glyph differently).

Chosen: (A). The axiom overlay's stylesheet entry is:

```ts
{ selector: 'node[?isAxiom]', style: {
  'border-style': 'double',
  'border-width': 3,
} },
```

Why double-3 specifically:
- **`border-style: 'double'`** — Cytoscape renders this as two parallel lines around the node body. The visual reads as "anchored" / "doubled-up" — semantically distinct from the per-status branches (which use `solid` for `agreed` / `disputed` / `committed`, `dashed` for `proposed` / `withdrawn`).
- **`border-width: 3`** — the baseline `node` selector sets `border-width: 1`; bumping to 3 for axioms gives the double-line enough visual weight to read as a single unified decoration rather than as a hairline pair. Per-status branches don't touch `border-width`, so the bump is non-conflicting.
- **Cross-layer composition** — the per-status `border-color` carries through (an axiom-marked `agreed` node paints slate-700 double-border 3px; an axiom-marked `proposed` node paints slate-400 double-border 3px). The user sees both signals: "this is the disposition (color) AND this is bedrock (double border)".

The one cross-layer interaction worth calling out: the `meta-disagreement` rollup branch ALSO uses `border-style: 'double'`. A node that is both meta-disagreement AND axiom-marked would inherit the meta-disagreement `border-color: '#7c3aed'` (violet) AND the axiom overlay's `border-width: 3` — visually: "violet double border, width 3". The composition is still unambiguous (the violet color signals meta-disagreement; the bumped width reads as the axiom emphasis), and the case is empirically rare (a meta-disagreement node is "we disagree about what we're disagreeing about" — adding bedrock on top is methodologically possible but uncommon). If real usage shows the visual reads as confusing, a future polish leaf can swap the axiom overlay to a different `border-style` variant (`solid` with `border-width: 4`, for instance); the seam is the stylesheet entry, one line to edit.

### §4 — `isAxiom` field stamped on the projection output, not on a separate Cytoscape class

Two options for how the projector communicates the axiom signal to the Cytoscape stylesheet:

- **(a) Stamp `isAxiom: boolean` on the element `data` object; stylesheet selector matches `node[?isAxiom]`.** Chosen.
- **(b) Add a Cytoscape class (`'is-axiom'`) to the element descriptor; stylesheet selector matches `node.is-axiom`.** Mechanically equivalent for the simple boolean case. Rejected for two consistency reasons: (1) the per-facet-state-styling predecessor uses the data-field-with-selector pattern (`node[rollupStatus = '<status>']`), not the class pattern — adopting the data-field pattern keeps the stylesheet vocabulary uniform across both overlays; (2) the DOM mirror reads `node.data.isAxiom` directly; using a class would require either reading the Cytoscape class set OR carrying a parallel "is in class" attribute on the mirror, doubling the surface area.

A side benefit of (a): the boolean is observable via `cy.elements().jsons()` in tests (the GraphView Vitest case (d) asserts the Cytoscape element set carries `data.isAxiom`), which gives a sanity check against mirror drift without needing to inspect Cytoscape's internal class set.

### §5 — DOM mirror adds `data-is-axiom="true|false"` on the existing `<li data-testid="participant-node-status">`; explicit-true-and-false (not omit-on-false) for symmetry

The DOM mirror is `aria-hidden="true"` and serves as the canvas-blind testability seam (Decision §4 of `part_per_facet_state_styling` settled this). The axiom signal extends the existing per-node `<li>` rather than adding a new `<li>` row — keeping the mirror's surface tight.

Attribute encoding: explicit `"true"` for axiom-marked, explicit `"false"` for not-axiom-marked (rather than omit-when-false). Three reasons:

- **Symmetry with `data-rollup-status` / `data-facet-*`.** Those attributes use sentinel strings (`"none"` for empty rollup; `""` for absent facets) rather than omission. The same posture for `data-is-axiom` keeps the mirror's per-attribute presence uniform.
- **Explicit not-axiom branch in Playwright.** The block 3 e2e asserts `[data-is-axiom="true"]` on the marked node AND `[data-is-axiom="false"]` on the unmarked node. The `"false"` branch is a real assertion — "we confirmed this node is NOT axiom-marked" — not the absence of an assertion.
- **Reader-friendliness for the cross-referencer.** A reader scanning the rendered DOM in devtools sees the boolean state for every node, not just the marked ones. The absence-versus-not-yet-stamped ambiguity the predecessor leaf avoided (per Decision §4 of `part_per_facet_state_styling`) is the same footgun here.

The edge mirror is unchanged — edges have no axiom-mark by methodology + wire schema.

### §6 — Third `test()` block in the existing spec file, using `frank` + `grace` for fullyParallel safety

The existing `tests/e2e/participant-graph-render.spec.ts` describe now has two `test()` blocks (`alice`+`ben` for the baseline render; `maria`+`dave` for the per-facet rollup). Adding a third block inside the same describe keeps the spec file's narrative ("every test exercises the participant operate route's read-mostly graph") coherent. Alternatives:

- **(a) Third `test()` block in the existing file using `frank` + `grace`.** Chosen.
- **(b) New spec file `tests/e2e/participant-graph-axiom-mark.spec.ts`.** Rejected for now: the new file would replicate the alice-creates → ben-claims → goto-operate setup; the third `test()` block reuses it. The "split when it gets crowded" rule applies — when the describe grows past ~5 blocks the split becomes worth it; three blocks is within budget.
- **(c) Reuse `maria` + `dave` (or `alice` + `ben`) and rely on test ordering to avoid the race.** Rejected: Playwright's `fullyParallel: true` is the surrounding contract; using the same usernames in two parallel blocks would race on Authelia's user-creation path (the test that wins gets the user; the loser sees an existing-user collision). The predecessor leaf's deviation Status note specifically called out the parallel-execution issue and adopted distinct usernames; this leaf inherits the same posture.

The username choice: `frank` + `grace` follow alphabetically after the existing pairs (`alice`/`ben`, `maria`/`dave`). Both are pre-existing Authelia dev users (per the `setup-auth` fixture's bootstrap user-list — there is no new user provisioning).

The new `test()` block:

1. Sets up frank + grace + the session + the lobby chain (mirroring blocks 1 and 2).
2. Navigates grace to `/p/sessions/${sessionId}` (manual `page.goto` since the auto-navigation handoff is block-1 territory; this block doesn't need to re-pin it).
3. Asserts `route-operate` + `participant-graph-root` + `participant-graph-status-mirror` visible (presence-of-mirror is the predecessor's contract; we depend on it).
4. Seeds the events into grace's WS store via `__aConversaWsStore.getState().applyEvent(...)`:
   - Two `node-created` events (NODE_A_ID and NODE_B_ID; the second so the mirror has an unmarked-node baseline to assert against).
   - One `proposal` envelope with inner `{ kind: 'axiom-mark', node_id: NODE_A_ID, participant: PARTICIPANT_ID }`.
   - One `commit` envelope referencing that proposal's envelope id (so the axiom-mark actually lands per the "render committed only" rule).
5. Asserts via `page.locator('[data-testid="participant-node-status"][data-node-id="${NODE_A_ID}"]')` that `data-is-axiom="true"`; and via the analogous locator on NODE_B_ID that `data-is-axiom="false"`.

The spec budget is bounded — the new block is ~30 lines on top of the shared helpers; the chromium-participant-skeleton project's wall-clock for the third block is sub-15s (same envelope blocks 1 and 2 run in).

### §7 — Read the axiom signal directly from the events log, not from `BaseWsSessionState.axiomMarks` (no such slice exists yet on the client)

The participant's WS store carries `BaseWsSessionState.events: Event[]` per [`packages/shell/src/ws/store-contract.ts:44-53`](../../../packages/shell/src/ws/store-contract.ts#L44). The shell client does NOT (today) carry a pre-projected `axiomMarks` slice per session — the only per-session slice that goes beyond the raw events log is `pendingProposals[*].perFacetStatus` (per the prior leaf's Decision §3), which covers facets-on-pending-proposals only.

This leaf reads the axiom signal directly from the events log via the local `projectAxiomMarks(events)` port. Alternatives:

- **(a) Derive from `events` via the local port.** Chosen.
- **(b) Wait for a server-broadcast `axiomMarks` slice and consume that.** Rejected for two reasons: (i) the slice doesn't exist; introducing it is a backend change (broadcast frame + client store schema) that doesn't fit the 0.5d budget and would defer the participant's axiom-mark rendering until a backend-side leaf lands; (ii) the per-events derivation IS the source of truth — a broadcast slice would be a cached derivation that needs reconciliation with the events log on every event apply. The simpler path is the events-log read; the broadcast slice can come later if the cost of re-deriving on every render becomes load-bearing.

Decision §7: chosen (a). The derivation cost is paid once per `events` change via `useMemo` (same idiom as the `facetStatusIndex` memo); the derivation is `O(n)` over events and the `axiom-mark` proposals are a small fraction of any session's events.

### §8 — `nodeHasAxiomMark` returns the boolean; the per-participant list is reachable for the future detail-panel consumer but not exposed at the at-a-glance layer

The `axiomMarks.ts` module exports BOTH:

- `groupAxiomMarksByNode(marks): Map<string, readonly AxiomMark[]>` — the bucketed list of `AxiomMark` records per node (verbatim from the moderator port).
- `nodeHasAxiomMark(grouped, nodeId): boolean` — the helper this leaf uses at the projection layer.

The at-a-glance projection consumes only `nodeHasAxiomMark`; the bucketed list is exposed for the future entity-detail-panel consumer (which needs the per-participant breakdown to render the moderator's `AxiomMarkBadge` row with attribution). Carrying both means the future consumer doesn't need to refactor the seam — it imports `groupAxiomMarksByNode` directly. Cost is one extra exported helper today; benefit is zero re-work later.

An alternative would be to inline `nodeHasAxiomMark` into the projector (skip exporting the helper). Rejected because the bucketed-list-to-boolean step IS the small primitive the next overlay author (annotation render, diagnostic highlights, vote indicators) might pick up — extracting it now follows the "small primitives another overlay author could pick up" steer from the orchestrator brief without crossing into premature abstraction (the helper has one call site today, two when the detail panel consumes it).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- Ported the moderator's axiom-mark projection verbatim into [`apps/participant/src/graph/axiomMarks.ts`](../../../apps/participant/src/graph/axiomMarks.ts) (the `AxiomMark` interface, `EMPTY_AXIOM_MARKS` frozen-empty array, `projectAxiomMarks(events)` single-pass walk, `groupAxiomMarksByNode(marks)` bucketer) plus the new `nodeHasAxiomMark(grouped, nodeId): boolean` helper per Decision §1 / §8; the per-participant palette (`AXIOM_MARK_PALETTE` / `axiomMarkColorFor` / `AxiomMarkColor`) is deliberately NOT ported and a header comment spells out the rationale so a future reader doesn't mistake the omission. Pinned by [`apps/participant/src/graph/axiomMarks.test.ts`](../../../apps/participant/src/graph/axiomMarks.test.ts) (7 Vitest cases mirroring the moderator coverage: empty log → []; uncommitted proposal → []; one (proposal + commit) pair → one record; two-participants-same-node multiplicity; commit-arrival ordering; mixed-log isolation from `classify-node` / `set-edge-substance`; `groupAxiomMarksByNode` + `nodeHasAxiomMark` truthy/false bucketing).
- Widened [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts) to take a third `axiomMarkIndex` argument (after `events` and `facetStatusIndex`) and stamped `isAxiom: boolean` onto every emitted node `data` object via `nodeHasAxiomMark`; `ParticipantNodeData` grew the new field; `ParticipantEdgeData` and emission ordering are unchanged. 5 new projection cases landed in [`apps/participant/src/graph/projectGraph.test.ts`](../../../apps/participant/src/graph/projectGraph.test.ts) covering the default-false stamp, the targeted-true stamp, the unmarked-sibling-stays-false invariant, the spread-survives-classify-commit branch, and the edges-carry-no-isAxiom shape pin.
- Layered the `node[?isAxiom]` Cytoscape selector with `border-style: 'double'` + `border-width: 3` on top of the rollup-status stylesheet in [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) per Decision §3 — the axiom overlay composes WITH the rollup branches rather than replacing them: an axiom-marked `agreed` node still paints its slate-700 `border-color` from the rollup branch underneath while the overlay supplies the doubled border weight, so both signals ("disposition is X" + "this is bedrock") read at once without the overlay suppressing the per-status color. Threaded the index via a third `useMemo` (`axiomMarkIndex = groupAxiomMarksByNode(projectAxiomMarks(events))`) parallel to the existing `facetStatusIndex` memo.
- Extended the per-node DOM mirror by adding `data-is-axiom="true|false"` to the existing `<li data-testid="participant-node-status">` alongside `data-rollup-status` and the `data-facet-*` triple — explicit `"true"` AND explicit `"false"` per Decision §5 (symmetric with the rollup/facet sentinel-string posture, gives Playwright a real not-axiom assertion branch). The edge mirror is unchanged. 5 new component cases in [`apps/participant/src/graph/GraphView.test.tsx`](../../../apps/participant/src/graph/GraphView.test.tsx) pin the default-false mirror, the targeted-true mirror, the two-participants-collapse-to-one boolean, the `cy.elements().jsons()` data-mirror sanity, and the module-scope `STYLESHEET` selector assertion.
- Failing-first verification per ADR 0022: confirmed by forcing `isAxiom: false` in `projectGraph.ts`, which made 6 positive Vitest cases fail (3 GraphView axiom-overlay + 3 projectGraph axiom-stamping); restoring the `nodeHasAxiomMark(...)` call returned all 17 new cases to green. No assertion was added without first watching it fail.
- E2e contract end-to-end in [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts): a third `test()` block seeds two `node-created` events plus a committed axiom-mark proposal (proposal + commit pair) and asserts `data-is-axiom="true"` on the marked node + `data-is-axiom="false"` on the unmarked sibling via the DOM mirror; `chromium-participant-skeleton` runs the 3 spec blocks + setup-auth in 13.8s green with no flakes.
- Username deviation from the refinement spec: Decision §6 calls for `frank` + `grace`, but `grace` is not in the Authelia dev user pool (`infra/authelia/users.yml`; the 6 dev users per ADR 0017 + `tests/e2e/fixtures/auth.ts:114` are alice / ben / maria / dave / erin / frank). The implementer picked `frank` + `erin` instead — both pre-existing dev users, both unused by blocks 1 (`alice` + `ben`) and 2 (`maria` + `dave`), preserving the `fullyParallel: true` race-safety constraint Decision §6 cared about. Future readers should not be surprised that the spec doesn't match the refinement's example usernames literally; the rationale (distinct usernames per parallel-execution safety) is unchanged.
