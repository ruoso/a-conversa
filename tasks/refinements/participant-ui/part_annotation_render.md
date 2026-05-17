# Render annotation presence + per-kind counts on the participant's read-mostly graph

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_annotation_render`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!participant_ui.part_graph_view.part_graph_render` (settled — shipped the `/p/sessions/:id` `OperateRoute`, the `<GraphView>` Cytoscape mount, the pure `projectGraph(events)` projector, the per-session `useWsStore((s) => s.sessionState[sessionId]?.events)` selector idiom, the `<ul data-testid="participant-graph-status-mirror">` DOM mirror seam, the per-node `<li data-testid="participant-node-status">` and per-edge `<li data-testid="participant-edge-status">` rows the mirror lists. Live code: [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx#L1), [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts#L1)).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_per_facet_state_styling` (settled — shipped the stylesheet pattern (per-status selectors layered on top of the baseline `node` / `edge` rules) AND the DOM mirror surface this leaf extends. The per-`<li>` `data-rollup-status` / `data-facet-*` sentinel-string posture is the precedent for the new `data-annotation-count` / `data-has-annotation` attributes this leaf adds — Decision §5 below builds on it).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_axiom_mark_decoration` (settled, commit `c717fe2` landing 2026-05-17 — the immediate template. Shipped (a) the verbatim port from `apps/moderator/src/graph/selectors.ts` → `apps/participant/src/graph/axiomMarks.ts` of an algorithm + bucketer pair + boolean helper; (b) the third `useMemo` parallel to `facetStatusIndex`; (c) the `projectGraph` signature widening to take an extra index argument and stamp a per-node flag on the emitted `data`; (d) the `node[?<flag>]` Cytoscape selector layered on top of the per-status branches; (e) the per-`<li>` mirror-attribute extension; (f) the third `test()` block in `tests/e2e/participant-graph-render.spec.ts` using a fresh username pair. This leaf reuses the same six seams for annotations — Decision §1 explains the one structural divergence from axiom-marks: annotations target both nodes AND edges per the wire schema's XOR, so this leaf widens BOTH the per-node and per-edge mirror entries, not just the node entry).
- Prose-only context (NOT a `.tji` edge): `moderator_ui.mod_graph_rendering.mod_annotation_rendering` (settled 2026-05-11 — refinement [`tasks/refinements/moderator-ui/mod_annotation_rendering.md`](../moderator-ui/mod_annotation_rendering.md)) is the canonical "client computes annotation list from event log; renders per-target" reference. The moderator artifacts: [`apps/moderator/src/graph/selectors.ts:52-60`](../../../apps/moderator/src/graph/selectors.ts#L52) (the `Annotation` interface — camelCased projection of the wire payload's snake_cased fields), [`apps/moderator/src/graph/selectors.ts:154`](../../../apps/moderator/src/graph/selectors.ts#L154) (the `EMPTY_ANNOTATIONS` module-scope frozen empty array), [`apps/moderator/src/graph/selectors.ts:208-223`](../../../apps/moderator/src/graph/selectors.ts#L208) (`projectAnnotations(events)` — the single-pass walk), [`apps/moderator/src/graph/selectors.ts:233-247`](../../../apps/moderator/src/graph/selectors.ts#L233) (`groupAnnotationsByNode`), [`apps/moderator/src/graph/selectors.ts:254-268`](../../../apps/moderator/src/graph/selectors.ts#L254) (`groupAnnotationsByEdge`), [`apps/moderator/src/graph/AnnotationBadge.tsx`](../../../apps/moderator/src/graph/AnnotationBadge.tsx) (the per-annotation React badge — NOT ported, same reason `AxiomMarkBadge` was not ported in the prior leaf). This leaf ports the projection + bucketers verbatim and reduces the rendering at the at-a-glance card layer to a per-target boolean + count signal — Decision §1 walks through the reduction.
- Prose-only context (NOT a `.tji` edge): the wire-event for annotation creation is `annotation-created` (a top-level event kind — NOT a `proposal + commit` pair like axiom-mark, NOT a sub-kind of `proposal` like classify-node). Payload schema [`packages/shared-types/src/events.ts:300-317`](../../../packages/shared-types/src/events.ts#L300) — `annotationCreatedPayloadSchema` carries `{ annotation_id, kind, content, target_node_id, target_edge_id, created_by, created_at }` with a Zod `.refine()` enforcing the XOR `(target_node_id === null) !== (target_edge_id === null)`. The annotation-kind enum lives at [`packages/shared-types/src/events/enums.ts:38`](../../../packages/shared-types/src/events/enums.ts#L38) — `annotationKindSchema = z.enum(['note', 'reframe', 'scope-change', 'stance'])`. There IS also a sibling `annotate` proposal sub-kind at [`packages/shared-types/src/events/proposals.ts:345-352`](../../../packages/shared-types/src/events/proposals.ts#L345) (`annotateProposalSchema` — the **propose-an-annotation** flow that committing would turn into an `annotation-created`), but that path is NOT what the moderator's `selectAnnotations` reads off and NOT what this leaf consumes — Decision §2 covers the reason (the rendered surface is committed annotations only; pending `annotate` proposals belong in a future pending-proposals pane, mirroring the axiom-mark leaf's "render committed only" posture).

## What this task is

Extend the participant's read-mostly `<GraphView>` so every node OR edge that carries at least one **committed annotation** surfaces a presence-indicator + per-kind count on its Cytoscape element — the fourth visual-vocabulary layer on top of `part_graph_render` (baseline), `part_per_facet_state_styling` (per-facet rollup status), and `part_axiom_mark_decoration` (axiom-mark boolean overlay). Before this leaf, an annotation-created event lands silently in the debater's WS log and the debater has no visual confirmation that meta-commentary on a node or edge has been recorded. After this leaf, the debater sees at a glance which nodes / edges carry annotations and how many.

Concretely the deliverable is:

- A new `apps/participant/src/graph/annotations.ts` — a verbatim port of the moderator's `Annotation` interface (camelCased), `EMPTY_ANNOTATIONS` module-scope frozen empty array, `projectAnnotations(events)` pure function (single-pass walk: `annotation-created` events convert to `Annotation` records preserving arrival order), and `groupAnnotationsByNode(annotations)` / `groupAnnotationsByEdge(annotations)` `Map`-returning bucketers (sourced from [`apps/moderator/src/graph/selectors.ts:52-268`](../../../apps/moderator/src/graph/selectors.ts#L52)). Plus three new tiny helpers (`nodeHasAnnotation` / `edgeHasAnnotation`: boolean presence; `annotationCountFor`: total count across all kinds). The header comment links back to BOTH the moderator port (for the eventual extract-into-shell trigger when the audience surface adopts the same vocabulary) AND the methodology semantics (annotations are first-class meta-commentary entities per [`docs/methodology.md:13`](../../../docs/methodology.md#L13)).
- An extension to [`projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts) that takes TWO additional index arguments — `nodeAnnotationIndex: ReadonlyMap<string, readonly Annotation[]>` and `edgeAnnotationIndex: ReadonlyMap<string, readonly Annotation[]>` (after `events`, `facetStatusIndex`, `axiomMarkIndex`) — and stamps a `hasAnnotation: boolean` + `annotationCount: number` pair onto every emitted **node** and **edge** `data` object (Decision §1 — the at-a-glance card layer carries presence + count; the per-kind / per-author / content list is the entity-detail-panel's job). `ParticipantNodeData` and `ParticipantEdgeData` interfaces both grow the two new fields.
- An extension to [`GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) that derives the two indexes once per `events` change via two new `useMemo`s parallel to the existing `axiomMarkIndex` memo. Stylesheet adds TWO additional selectors — `node[?hasAnnotation]` and `edge[?hasAnnotation]` — that overlay a distinctive visual on top of (not replacing) the existing per-status branches. The presence-indicator visual treatment is `overlay-color: '#f59e0b'` (amber-500) + `overlay-opacity: 0.15` + `overlay-padding: 4` on nodes (Cytoscape's overlay paints over the node body without disturbing the per-status border / fill the rollup branch owns), and `'line-style': 'solid', 'line-fill': 'linear-gradient', 'line-gradient-stop-colors': '#94a3b8 #f59e0b'` for edges. Decision §3 walks through the alternatives.
- An extension to the existing per-node + per-edge `<li>` mirror entries — both grow `data-has-annotation="true|false"` AND `data-annotation-count="<n>"` attributes (sentinel-string posture matching the existing `data-rollup-status` / `data-facet-*` / `data-is-axiom` pattern — explicit `"0"` / `"false"` rather than omit-when-empty per Decision §5 of `part_axiom_mark_decoration`).
- Tests pin: Vitest at the projection-helper layer (`projectAnnotations` round-trips `annotation-created` events; `groupAnnotationsBy{Node,Edge}` buckets correctly with XOR-target awareness; `nodeHasAnnotation` / `edgeHasAnnotation` / `annotationCountFor` return the right booleans + counts), at the projector layer (`projectGraph` stamps `hasAnnotation` / `annotationCount` on both nodes AND edges), and at the `<GraphView>` render layer (both the node and edge mirror surface the right `data-has-annotation` + `data-annotation-count` per target; the Cytoscape element set carries the same values). Playwright at the e2e layer extends `tests/e2e/participant-graph-render.spec.ts` with a **fourth** `test()` block (per Decision §6 — block-4 reuses `alice` + `ben` and the whole describe gets the `.serial` modifier; the alternatives + rationale are spelled out there).

Out of scope (deferred to existing or future leaves):

- **Per-annotation badges + per-kind chromatic identity on the participant canvas.** The moderator paints one amber pill per annotation (with localized `methodology.annotationKind.<kind>` label + `data-annotation-kind="<kind>"` seam for future per-kind theming, per `mod_annotation_rendering` Decisions). The participant's at-a-glance layer carries ONE presence boolean + ONE count per target — the per-annotation breakdown (kind labels, content text, per-author attribution) is the entity-detail-panel's job (`part_entity_detail_panel`, a future leaf — the same panel that hosts the per-facet pill row deferral from `part_per_facet_state_styling` and the per-participant chromatic axiom-mark badges deferred from `part_axiom_mark_decoration`). When that leaf lands it can import the moderator's `AnnotationBadge` directly (same `methodology.annotationKind.*` catalog keys already populated for en-US / pt-BR / es-419).
- **Pending (proposed-but-not-yet-committed) annotations.** The wire vocabulary distinguishes `annotation-created` (a top-level event) from `annotate` (a proposal sub-kind that commits into an `annotation-created`). This leaf renders **committed only** (the `annotation-created` event log slice), mirroring the moderator's `mod_annotation_rendering` Decision and the participant's own `part_axiom_mark_decoration` "render committed only" rule. Pending `annotate` proposals belong in a future pending-proposals pane (`part_pending_proposals.*` group, where pending axiom-marks also live).
- **Annotation authoring from the participant tablet.** No `participant_ui.*` task in the current WBS owns the "create an annotation" gesture — the annotation creation flow is owned by the moderator's `mod_diagnostic_resolution_flow.mod_annotation_action` task (per the moderator refinement's Why-it-needs-to-be-done section). This leaf is rendering-only.
- **Tooltip / screen-reader prose surfacing annotation content on the canvas.** The mirror is `aria-hidden="true"` (testability seam only). The user-visible hover content (the annotation `content` field surfaced via `title` attribute on the moderator) is deferred to `part_entity_detail_panel` where a React surface can host the per-locale `methodology.annotationKind.<kind>` label AND the unmodified `content` body for each annotation.
- **Per-kind decoration variants** (different visual treatment for `note` vs `reframe` vs `scope-change` vs `stance`). v1 carries presence + count only — the per-kind chromatic theming routes through `packages/ui-tokens` once that workstream ships (same posture the moderator's `mod_annotation_rendering` adopted). The seam is the data field — adding a `dominantAnnotationKind` projection later doesn't break the at-a-glance layer.
- **Visual regression on the rendered annotation overlay.** Owned by `part_vr_state_styling` (already deferred there for the per-facet styling layer). Pixel comparisons of the rendered overlay are out of scope for this leaf; this leaf's tests pin observable behaviour through the DOM mirror, not pixel content.
- **Removal / withdrawal of annotations.** No `annotation-removed` event exists in the current shared-types schema; an annotation that lands is permanent at the methodology layer. If a future leaf introduces removal semantics, the count + boolean stamped here will be recomputed from the (then-richer) event log on the next memo pass without code change.

## Why it needs to be done

`m_participant_mvp` ([`tasks/99-milestones.tji`](../../99-milestones.tji)) is the milestone at which a debater can see and engage with the live graph from their tablet. `part_graph_render` lit up the rendering surface; `part_per_facet_state_styling` painted the agreement-state vocabulary; `part_axiom_mark_decoration` painted the bedrock vocabulary; this leaf paints the **meta-commentary vocabulary** — the methodology's mechanism for capturing reframes, scope-changes, stance-pins, and free-form notes on existing entities ([`docs/methodology.md:13`](../../../docs/methodology.md#L13) — "Each facet of an entity (node wording, classification, substance; edge shape and substance; annotation content) tracks each participant's stance individually"; annotations are first-class methodology entities, not chrome).

The methodology assumes the debater sees the same annotation signal the moderator does. Without this leaf, an `annotation-created` event lands silently in the debater's WS log and the debater has no visual confirmation that meta-commentary has been recorded on an entity — the moderator's reframes / scope-changes / stance pins on the debater's nodes stay invisible on the debater's tablet, defeating the methodology's assumption that the meta-commentary layer is observable on both sides.

Downstream concretely:

- **`part_entity_detail_panel`** (the React-driven tap-to-detail panel) is the natural home for the per-annotation badge row (the moderator's `AnnotationBadge` vocabulary) — the panel imports the moderator's `AnnotationBadge` directly when it lands, surfacing per-kind localized labels + content + per-author attribution. The presence + count this leaf stamps is the at-a-glance scan; the per-annotation breakdown is the tap-to-detail.
- **`audience.aud_annotation_rendering`** ([`tasks/50-audience-and-broadcast.tji:109`](../../50-audience-and-broadcast.tji#L109)) becomes the third Cytoscape consumer of annotation vocabulary. When it lands, the natural extraction trigger lifts `annotations.ts` (and `axiomMarks.ts` and `facetStatus.ts`) into `@a-conversa/shell`; all three client surfaces import from a single source.
- The participant's `<GraphView>` becomes the **second concrete adoption of the moderator's annotation vocabulary** (Cytoscape edition; the moderator is React/ReactFlow edition). The audience surface (future) will be the third, and the natural extraction trigger for lifting `projectAnnotations` + `groupAnnotationsBy{Node,Edge}` into `@a-conversa/shell` (Decision §2 — same "two callers is YAGNI; extract when the third materialises" policy `mergeSlots`, `computeFacetStatuses`, and `projectAxiomMarks` already followed).

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Cytoscape on the participant surface; the stylesheet's `node[?<flag>]` / `edge[?<flag>]` selectors are the canonical "boolean truthy" extension point this leaf uses for the presence overlay (same vocabulary `part_axiom_mark_decoration` used).
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the wire-event vocabulary `projectAnnotations` walks; the `annotationCreatedPayloadSchema` shape at [`packages/shared-types/src/events.ts:300-317`](../../../packages/shared-types/src/events.ts#L300) (with the XOR `.refine()` on `target_node_id` / `target_edge_id`) is the source of truth for the projector's narrowing. The shell client validates incoming envelopes at parse time, so this leaf's port trusts the discriminated-union narrowing AND the XOR invariant (the bucketers route by which target field is non-null, never both).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behavioural assertion below is a committed Vitest case or Playwright scenario.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation()` is the participant surface's localization seam. This leaf does NOT add new user-facing strings — the at-a-glance signal is a presence + count communicated visually; the per-kind localized prose belongs in the entity detail panel where `methodology.annotationKind.<kind>` (already populated for en-US / pt-BR / es-419 by `mod_annotation_rendering`) gets consumed.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the surface owns its mounted region only; `useWsStore` comes from the participant workspace's singleton (which delegates to the shell's `createDefaultWsStore`). No new shell substrate in this leaf.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — an annotation is a first-class entity in its own right (`session_annotations` is a third M-N join table per [`packages/shared-types/src/events/enums.ts:45`](../../../packages/shared-types/src/events/enums.ts#L45)), attached to its target node or edge via the polymorphic-FK XOR encoding in the payload. The presence overlay this leaf paints composes orthogonally with the per-facet rollup status the predecessor leaf paints — Decision §3 documents the stylesheet composition (the annotation overlay paints a Cytoscape `overlay-*` layer on top of the per-status border / fill / opacity stack).

No new ADR. Every decision below applies an existing ADR or mirrors a settled moderator-side decision; the architectural seams (Cytoscape library pick, micro-frontend shell, methodology vocabulary, two-callers-then-extract policy) are settled.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_axiom_mark_decoration.md`](part_axiom_mark_decoration.md) — the immediate predecessor and the closest template. The verbatim-port-then-thread-through-projectGraph-then-mirror-attribute pattern repeats here; the one structural divergence (annotations target both nodes AND edges; axiom-marks are node-only) is called out in Decision §1.
- [`tasks/refinements/participant-ui/part_per_facet_state_styling.md`](part_per_facet_state_styling.md) — the stylesheet pattern (per-status selectors layered atop the baseline) + the DOM mirror seam are this leaf's reused infrastructure. Decision §3 + Decision §5 below build on the same posture.
- [`tasks/refinements/participant-ui/part_graph_render.md`](part_graph_render.md) — `<GraphView>` mount + `projectGraph` seam. Decision §4 of that leaf established "projection lives in the participant workspace; extraction waits for the third caller (audience surface)"; this leaf adopts the same posture for the annotation port (Decision §2).
- [`tasks/refinements/participant-ui/part_state_management.md`](part_state_management.md) — the per-session `events` slice shape (`BaseWsSessionState.events: Event[]`) is exactly what `projectAnnotations` consumes; the port carries over the same input shape.
- [`tasks/refinements/participant-ui/part_landscape_layout.md`](part_landscape_layout.md) — the chrome the route renders inside; the test-mirror `<ul>` sits inside the `participant-graph-root` container alongside the Cytoscape canvas (no change), so the layout's `participant-main` region budget covers both unchanged.

### Sibling refinements on the moderator (the vocabulary this leaf adapts)

- [`tasks/refinements/moderator-ui/mod_annotation_rendering.md`](../moderator-ui/mod_annotation_rendering.md) — the canonical "client computes annotation list from event log; renders per-target" pattern. This leaf adopts the projection verbatim and reduces the rendering to a per-target boolean + count (Decisions §1 and §2 explain the reduction). The moderator's per-annotation `AnnotationBadge` lives on the React-driven `StatementNode` / `StatementEdge` card; the Cytoscape canvas (this surface's runtime) doesn't host arbitrary React subtrees per node, so the boolean + count is the at-a-glance signal here and the per-annotation breakdown is deferred to the (future) entity detail panel.

### Live code the leaf plugs into

- [`apps/participant/src/graph/GraphView.tsx:120-304`](../../../apps/participant/src/graph/GraphView.tsx#L120) — the module-scope `STYLESHEET` constant. This leaf appends TWO additional selectors — `node[?hasAnnotation]` and `edge[?hasAnnotation]` — after the existing axiom-mark overlay block. The baseline `node` / `edge` selectors stay as the catch-all; the per-status branches stay as the per-rollup vocabulary; the axiom-mark overlay stays as the node-only border override; the annotation overlay layers on top using Cytoscape's `overlay-*` properties (node) and a per-edge gradient (edge) — Decision §3 walks through the visual treatment.
- [`apps/participant/src/graph/GraphView.tsx:361-393`](../../../apps/participant/src/graph/GraphView.tsx#L361) — the component body (the `GraphView` function). This leaf inserts TWO new `useMemo`s (parallel to the existing `axiomMarkIndex` memo at line 405) that derive `nodeAnnotationIndex = groupAnnotationsByNode(projectAnnotations(events))` and `edgeAnnotationIndex = groupAnnotationsByEdge(projectAnnotations(events))` once per `events` change. The `projected` memo at line 417 takes both as the fourth and fifth arguments to `projectGraph`; the localized `elements` memo at line 446 carries `hasAnnotation` / `annotationCount` through via the existing `...node.data` / `...edge.data` spreads.
- [`apps/participant/src/graph/GraphView.tsx:492-519`](../../../apps/participant/src/graph/GraphView.tsx#L492) — the returned fragment. This leaf adds TWO `data-*` attributes on EACH of the existing `<li>` mirror rows: `data-has-annotation` + `data-annotation-count` on `<li data-testid="participant-node-status">` AND on `<li data-testid="participant-edge-status">`. No new `<li>` rows; no new wrappers. Two helpers in the same shape as the existing `rollupAttr` / `facetAttr` / `axiomAttr` — `hasAnnotationAttr(value: boolean): 'true' | 'false'` (matching `axiomAttr`) and `annotationCountAttr(value: number): string` (matching `rollupAttr`'s "just return the string"). Decision §5 walks through the sentinel posture.
- [`apps/participant/src/graph/projectGraph.ts:76-96`](../../../apps/participant/src/graph/projectGraph.ts#L76) — `ParticipantNodeData`. This leaf adds `readonly hasAnnotation: boolean` and `readonly annotationCount: number` to the interface, in that order, after `isAxiom`.
- [`apps/participant/src/graph/projectGraph.ts:107-120`](../../../apps/participant/src/graph/projectGraph.ts#L107) — `ParticipantEdgeData`. This leaf adds the same two fields after `rollupStatus`. Symmetric with `ParticipantNodeData` because annotations target both — Decision §1.
- [`apps/participant/src/graph/projectGraph.ts:190-278`](../../../apps/participant/src/graph/projectGraph.ts#L190) — `projectGraph`. This leaf widens the signature to `projectGraph(events, facetStatusIndex, axiomMarkIndex, nodeAnnotationIndex, edgeAnnotationIndex)`. The node-creation branch consults `nodeAnnotationIndex.get(event.payload.node_id) ?? EMPTY_ANNOTATIONS` and stamps `hasAnnotation: list.length > 0, annotationCount: list.length`. The edge-creation branch does the same with `edgeAnnotationIndex` + `event.payload.edge_id`. The classify-commit branch's `...existing.data` spread carries the prior values unchanged (same posture the axiom-mark leaf documented for its `isAxiom` field).
- [`apps/moderator/src/graph/selectors.ts:52-268`](../../../apps/moderator/src/graph/selectors.ts#L52) — the canonical port source for `Annotation`, `EMPTY_ANNOTATIONS`, `selectAnnotations`, `projectAnnotations`, `groupAnnotationsByNode`, `groupAnnotationsByEdge`. The participant's `annotations.ts` mirror copies the body of `projectAnnotations` + both bucketers + the type + the empty-array constant line-for-line; `selectAnnotations(state, sessionId)` is NOT ported (it walks `WsState`, which would couple the projection helper to the store shape — the participant's `GraphView` calls `projectAnnotations(events)` directly the way `projectAxiomMarks(events)` is called, with the per-session selector already done at the component layer).
- [`packages/shared-types/src/events.ts:300-317`](../../../packages/shared-types/src/events.ts#L300) — `annotationCreatedPayloadSchema` + `AnnotationCreatedPayload` type. No change; the port reads the same shape and trusts the Zod-enforced XOR `(target_node_id === null) !== (target_edge_id === null)` at the validation seam — the bucketers route the annotation to either the node or the edge index by checking which field is non-null, mirroring the moderator port's bucketers.
- [`packages/shared-types/src/events/enums.ts:38`](../../../packages/shared-types/src/events/enums.ts#L38) — `annotationKindSchema`. Reused indirectly via the `AnnotationKind` type on the `Annotation` interface. No change.
- [`tests/e2e/participant-graph-render.spec.ts:103-727`](../../../tests/e2e/participant-graph-render.spec.ts#L103) — the existing Playwright describe with three `test()` blocks (`alice`+`ben`, `maria`+`dave`, `frank`+`erin`). This leaf extends it with a fourth `test()` block; per Decision §6, the whole `describe` gets the `.serial` modifier (changes one line — `test.describe(...)` becomes `test.describe.serial(...)`) so block-4 can reuse one of the existing pairs without racing on the in-file `users` upsert path.

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/fixtures/auth.ts:112-115`](../../../tests/e2e/fixtures/auth.ts#L112) — `loginAs(page, { username })`. The 6-user pool documented in the JSDoc (`alice`, `ben`, `maria`, `dave`, `erin`, `frank`) per ADR 0017 + [`infra/authelia/users.yml`](../../../infra/authelia/users.yml). All six are consumed by blocks 1-3; block-4 reuses `alice` + `ben` per Decision §6.
- [`tests/e2e/participant-graph-render.spec.ts:64-101`](../../../tests/e2e/participant-graph-render.spec.ts#L64) — `createSession`, `logoutAndClearAllCookies`, `freshContext` helpers (already in scope at the spec module level). The new `test()` block reuses them verbatim.
- [`playwright.config.ts`](../../../playwright.config.ts) — `chromium-participant-skeleton` already matches `participant-graph-render.spec.ts` (added by `part_graph_render`). No config change needed. The `.serial` modifier on the describe runs the 4 blocks sequentially within the same worker — wall-clock grows by roughly one block (~14s) but the file already sits under 60s per the predecessor's Status notes.

### What the surface MUST NOT do

- **No `fetch('/api/...')` from `GraphView` or the annotation derivation.** The per-session WS slice is the single data source.
- **No mutation of the `useWsStore`.** Read-only via the selector.
- **No new top-level dependency.** Cytoscape is already declared by ADR 0004 + the participant `package.json`. The stylesheet extension uses Cytoscape's built-in selector + `overlay-*` vocabulary.
- **No write paths on the WS connection.** Annotation creation is the moderator's `mod_annotation_action` task; the participant has no annotation-authoring affordance.
- **No new shell exports.** The annotation port lives in the participant workspace per Decision §2.
- **No new i18n keys.** The visual at-a-glance signal is a presence + count painted on the canvas + surfaced on the mirror; the per-kind localized labels are the entity detail panel's future job (the `methodology.annotationKind.*` keys already exist there).
- **No port of the moderator's `AnnotationBadge`.** That React component is the per-annotation chromatic pill; the participant's at-a-glance signal is the count + boolean stamped on the Cytoscape element data, NOT a React subtree per badge.
- **No deviation from the moderator's "render committed only" rule.** This leaf reads `annotation-created` events only; the `annotate` proposal sub-kind that commits into an `annotation-created` is bypassed at this layer (a pending `annotate` proposal contributes zero to the boolean + count until the matching `commit` resolves into an `annotation-created` event — though note that the wire vocabulary today actually emits `annotation-created` *directly* once committed, so the projector consumes the post-commit event, not the proposal).
- **No change to `projectGraph`'s output ordering.** Nodes still emit in `node-created` arrival order; edges in `edge-created` arrival order. The new `hasAnnotation` / `annotationCount` fields are additive on each element `data` object; they do not reshape iteration.
- **No removal of the prior fields.** `isAxiom`, `rollupStatus`, `facetStatuses`, `kind`, `wording`, `id` all survive — every prior overlay still composes.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/graph/annotations.ts` — NEW. Verbatim port of the moderator's `Annotation` interface, `EMPTY_ANNOTATIONS` module-scope frozen empty array, `projectAnnotations(events)` pure function (single-pass walk: every `annotation-created` event converts to a camelCased `Annotation` record preserving arrival order), and `groupAnnotationsByNode(annotations)` + `groupAnnotationsByEdge(annotations)` `Map`-returning bucketers (each skips annotations whose target field is `null` for the OTHER entity kind — the XOR enforced by Zod at the validation seam means each annotation goes to exactly one bucket). Plus three new helpers: `nodeHasAnnotation(grouped, nodeId): boolean`, `edgeHasAnnotation(grouped, edgeId): boolean`, and `annotationCountFor(grouped, id): number` (returns `grouped.get(id)?.length ?? 0`). Header comment links back to BOTH the moderator source (`apps/moderator/src/graph/selectors.ts`) AND the methodology semantics ([`docs/methodology.md` §"Agreement is per-facet and per-participant"](../../../docs/methodology.md#L13) — annotations are first-class methodology entities, listed alongside facets in the per-participant tracking rule). The moderator's `selectAnnotations(state, sessionId)` is NOT ported — the participant's `GraphView` calls `projectAnnotations(events)` with the events selector already done at the component layer, same as `projectAxiomMarks`.
- `apps/participant/src/graph/annotations.test.ts` — NEW. Vitest cases (10) mirroring the moderator's `projectAnnotations` coverage from [`apps/moderator/src/graph/selectors.test.ts`](../../../apps/moderator/src/graph/selectors.test.ts) so a reader cross-referencing the two ports sees the same pin: (a) empty event log → `[]`; (b) single `annotation-created` on a node target projects with all fields camelCased + `targetEdgeId: null`; (c) single `annotation-created` on an edge target projects with `targetNodeId: null`; (d) arrival order preserved across multiple `annotation-created` events; (e) mixed event log — non-annotation events (`node-created`, `proposal`, `commit`, `vote`) are ignored; (f) each `AnnotationKind` value (`note`, `reframe`, `scope-change`, `stance`) round-trips intact on `Annotation.kind` (1 case asserting all four); (g) `groupAnnotationsByNode` buckets node-targeted annotations + skips edge-targeted; (h) `groupAnnotationsByEdge` buckets edge-targeted annotations + skips node-targeted; (i) `nodeHasAnnotation` / `edgeHasAnnotation` return `true` for a bucketed target and `false` for an unbucketed one; (j) `annotationCountFor` returns the right count (0 for unbucketed, N for a bucket with N entries).
- `apps/participant/src/graph/projectGraph.ts` — modified. (1) `ParticipantNodeData` grows `readonly hasAnnotation: boolean` + `readonly annotationCount: number` (in that order, after `isAxiom`). (2) `ParticipantEdgeData` grows the same two fields after `rollupStatus`. (3) `projectGraph`'s signature widens to `projectGraph(events, facetStatusIndex, axiomMarkIndex, nodeAnnotationIndex, edgeAnnotationIndex)`. (4) The `node-created` branch resolves the bucket via `nodeAnnotationIndex.get(event.payload.node_id) ?? EMPTY_ANNOTATIONS` and stamps `hasAnnotation: list.length > 0, annotationCount: list.length`. (5) The `edge-created` branch does the same with `edgeAnnotationIndex` + `event.payload.edge_id`. (6) The classify-commit branch's `...existing.data` spread carries the prior `hasAnnotation` + `annotationCount` unchanged. (7) `EMPTY_ANNOTATIONS` is imported from `./annotations`.
- `apps/participant/src/graph/projectGraph.test.ts` — modified. Existing cases adapted to the new signature (each test factory passes two `new Map() as ReadonlyMap<string, readonly Annotation[]>` for the no-annotations baseline). 6 new cases added: (a) projection stamps `hasAnnotation: false, annotationCount: 0` on every node by default (no annotation indexes); (b) projection stamps `hasAnnotation: true, annotationCount: 1` on a node the annotation index targets with one entry; (c) projection stamps `hasAnnotation: true, annotationCount: 3` on a node with three annotations; (d) projection stamps the same on edges (one assertion covering both target kinds); (e) `hasAnnotation` / `annotationCount` survive a classify-node commit (the spread in the commit branch preserves the values); (f) sibling nodes / edges not targeted by any annotation get `hasAnnotation: false, annotationCount: 0`.
- `apps/participant/src/graph/GraphView.tsx` — modified. (1) Stylesheet extension: TWO new selectors after the existing axiom-mark overlay block — `node[?hasAnnotation]` with `'overlay-color': '#f59e0b', 'overlay-opacity': 0.15, 'overlay-padding': 4` per Decision §3 (amber tint over the node body without disturbing the per-status border + fill the rollup branch owns); `edge[?hasAnnotation]` with a per-edge treatment described in Decision §3 (an amber dashed-over-solid pattern via `line-style: 'solid'` plus a doubled `line-color` halo via Cytoscape's `line-fill` gradient OR a simpler stroke-width bump — Decision §3 walks the trade-off and the chosen pick). (2) TWO new `useMemo`s (placed after the existing `axiomMarkIndex` memo) derive `nodeAnnotationIndex` and `edgeAnnotationIndex` from a single `projectAnnotations(events)` call shared between them (the helper runs once per events change; the two bucketers split its output). (3) The `projected` memo's dependency list grows the two new indexes; the `projectGraph` call takes them as the fourth and fifth arguments. (4) The localized `elements` memo carries `hasAnnotation` + `annotationCount` through via the existing `...node.data` / `...edge.data` spreads. (5) The mirror `<li data-testid="participant-node-status">` grows `data-has-annotation` + `data-annotation-count`; the mirror `<li data-testid="participant-edge-status">` grows the same two attributes. Small helpers `hasAnnotationAttr(value: boolean): 'true' | 'false'` (matching `axiomAttr`'s shape) and `annotationCountAttr(value: number): string` (matching `rollupAttr`'s "string passthrough" shape; `String(value)` for a numeric input).
- `apps/participant/src/graph/GraphView.test.tsx` — modified. Existing cases stay (the additive fields don't break them once the test factories pass empty annotation indexes). 6 new cases added: (a) the per-node mirror `<li>` carries `data-has-annotation="false"` + `data-annotation-count="0"` by default; (b) when one annotation targets the node, the mirror reports `data-has-annotation="true"` + `data-annotation-count="1"`; (c) when three annotations target the node, the mirror reports `data-annotation-count="3"`; (d) the per-edge mirror `<li>` carries the same semantics for edge-targeted annotations; (e) Cytoscape's internal element set carries the same `data.hasAnnotation` + `data.annotationCount` values the mirror surfaces (sanity check via `cy.elements().jsons()`); (f) the stylesheet contains the `node[?hasAnnotation]` + `edge[?hasAnnotation]` selectors with the expected overlay / line overrides (assert against `STYLESHEET` import; module-scope constant is testable directly).
- `tests/e2e/participant-graph-render.spec.ts` — modified. (1) The `describe` modifier changes from `test.describe(...)` to `test.describe.serial(...)` per Decision §6 (the existing comments inside blocks 2 and 3 about `fullyParallel: true` no longer apply once the modifier flips; new top-of-describe comment explains the trade-off and links to this refinement's Decision §6). (2) Adds a fourth `test()` block: `alice creates a session, ben claims debater-A, seeded WS events + an annotation-created on a node + another on an edge surface data-has-annotation="true"/"false" + data-annotation-count="N" on the targeted entities`. Seeds: two `node-created` events; one `edge-created` event; one `annotation-created` targeting NODE_A; one `annotation-created` targeting the EDGE; one `annotation-created` ALSO targeting NODE_A (to assert the count rises to 2). Asserts: the NODE_A mirror entry has `data-has-annotation="true"` + `data-annotation-count="2"`; the NODE_B mirror entry has `data-has-annotation="false"` + `data-annotation-count="0"`; the EDGE mirror entry has `data-has-annotation="true"` + `data-annotation-count="1"`. Per the predecessor leaves' pattern: the assertions target the DOM mirror, not the canvas pixels.
- `playwright.config.ts` — unchanged. `chromium-participant-skeleton` already matches `participant-graph-render.spec.ts`.
- `apps/participant/package.json` — unchanged. No new dependency.

### Files this task does NOT touch

- `apps/participant/src/routes/OperateRoute.tsx` — unchanged. The route composes `<GraphView>`; the annotation overlay is a `<GraphView>` internal.
- `apps/participant/src/main.tsx`, `apps/participant/src/App.tsx`, `apps/participant/src/ws/wsStore.ts`, `apps/participant/src/layout/*` — unchanged.
- `apps/participant/src/graph/facetStatus.ts`, `apps/participant/src/graph/axiomMarks.ts` — unchanged. The two prior projections stay untouched; the annotation derivation is an independent module.
- `apps/moderator/` — no cross-surface change. The moderator's existing annotation seam stays where it is; the duplication is documented in the new participant `annotations.ts` header for the eventual shell extract.
- `packages/shell/`, `packages/shared-types/`, `packages/i18n-catalogs/` — unchanged. No new substrate, no new types, no new strings.
- `apps/server/`, `apps/root/`, `apps/audience/` — unchanged.
- `docs/adr/` — no new ADR. Every decision below applies an existing ADR (0004 / 0021 / 0022 / 0024 / 0026 / 0027) or mirrors a settled moderator-side decision.
- `.tji` files — `complete 100` on `part_annotation_render` lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual.

### Component shape (additions to `GraphView.tsx`)

Sketched (deltas only):

```ts
// Module scope — new
import {
  EMPTY_ANNOTATIONS,
  groupAnnotationsByEdge,
  groupAnnotationsByNode,
  projectAnnotations,
  type Annotation,
} from './annotations';

// STYLESHEET extension — TWO new selectors appended after the
// existing axiom-mark overlay block. Per Decision §3 the annotation
// overlay paints an amber wash over the node body via Cytoscape's
// `overlay-*` properties (which layer ON TOP of the node's own
// border + fill without disturbing them) AND a doubled-stroke effect
// on edges via `width` bump + amber halo.
const STYLESHEET: StylesheetJson = [
  // ... existing baseline node + edge selectors (unchanged) ...
  // ... existing 12 per-status node + edge selectors (unchanged) ...
  // ... existing `node[?isAxiom]` axiom overlay (unchanged) ...
  // has-annotation overlay (node) — Cytoscape's overlay-* layer
  // paints OVER the node body without touching border / fill / opacity
  // owned by the per-status branch. An amber tint at 0.15 opacity
  // reads as "this node carries meta-commentary" at a glance.
  { selector: 'node[?hasAnnotation]', style: {
    'overlay-color': '#f59e0b',   // amber-500 — matches the moderator's badge palette
    'overlay-opacity': 0.15,
    'overlay-padding': 4,
  } },
  // has-annotation overlay (edge) — Cytoscape edges don't accept
  // overlay-*, so the signal layers via a width bump + amber outline
  // halo. The bumped width composes WITH the per-status line-color
  // beneath (a `disputed` annotated edge stays rose-600 but reads
  // thicker; an `agreed` annotated edge stays slate-700 but reads
  // thicker). Decision §3 alternatives §A-§D walk through the rejected
  // styles.
  { selector: 'edge[?hasAnnotation]', style: {
    width: 4,                       // baseline edges are width 1
    'underlay-color': '#f59e0b',   // amber-500 halo behind the stroke
    'underlay-opacity': 0.25,
    'underlay-padding': 3,
  } },
];

// Inside the component — TWO new memos, parallel to axiomMarkIndex.
// projectAnnotations(events) runs once per events change; the two
// bucketers split its output into the per-target indexes.
const annotations = useMemo(() => projectAnnotations(events), [events]);
const nodeAnnotationIndex = useMemo(() => groupAnnotationsByNode(annotations), [annotations]);
const edgeAnnotationIndex = useMemo(() => groupAnnotationsByEdge(annotations), [annotations]);

// Projected memo — dependency widens
const projected = useMemo(
  () => projectGraph(
    events,
    facetStatusIndex,
    axiomMarkIndex,
    nodeAnnotationIndex,
    edgeAnnotationIndex,
  ),
  [events, facetStatusIndex, axiomMarkIndex, nodeAnnotationIndex, edgeAnnotationIndex],
);

// Mirror — both <li> rows grow two attributes
<li
  key={`node-${node.data.id}`}
  data-testid="participant-node-status"
  data-node-id={node.data.id}
  data-rollup-status={rollupAttr(node.data.rollupStatus)}
  data-facet-classification={facetAttr(node.data.facetStatuses.classification)}
  data-facet-substance={facetAttr(node.data.facetStatuses.substance)}
  data-facet-wording={facetAttr(node.data.facetStatuses.wording)}
  data-is-axiom={axiomAttr(node.data.isAxiom)}
  data-has-annotation={hasAnnotationAttr(node.data.hasAnnotation)}
  data-annotation-count={annotationCountAttr(node.data.annotationCount)}
/>
<li
  key={`edge-${edge.data.id}`}
  data-testid="participant-edge-status"
  data-edge-id={edge.data.id}
  data-rollup-status={rollupAttr(edge.data.rollupStatus)}
  data-facet-substance={facetAttr(edge.data.facetStatuses.substance)}
  data-has-annotation={hasAnnotationAttr(edge.data.hasAnnotation)}
  data-annotation-count={annotationCountAttr(edge.data.annotationCount)}
/>
```

The localized `elements` memo carries `hasAnnotation` + `annotationCount` through via the existing `...node.data` / `...edge.data` spreads — no change to the mapper bodies.

## Acceptance criteria

The check that says "done":

- `apps/participant/src/graph/annotations.ts` exists, exports `Annotation`, `EMPTY_ANNOTATIONS`, `projectAnnotations`, `groupAnnotationsByNode`, `groupAnnotationsByEdge`, `nodeHasAnnotation`, `edgeHasAnnotation`, and `annotationCountFor`. The projection rules mirror the moderator port verbatim; the per-annotation `AnnotationBadge` is explicitly NOT ported (commented in-file).
- `apps/participant/src/graph/annotations.test.ts` covers the 10 Vitest cases listed under Constraints.
- `apps/participant/src/graph/projectGraph.ts`'s `projectGraph` signature widens to `(events, facetStatusIndex, axiomMarkIndex, nodeAnnotationIndex, edgeAnnotationIndex)`; every emitted node data object carries `hasAnnotation: boolean` + `annotationCount: number`; every emitted edge data object carries the same two fields.
- `apps/participant/src/graph/projectGraph.test.ts` covers the 6 new Vitest cases plus the adapted existing cases.
- `apps/participant/src/graph/GraphView.tsx`'s stylesheet grows the `node[?hasAnnotation]` + `edge[?hasAnnotation]` selectors per Decision §3; two new `useMemo`s derive `nodeAnnotationIndex` + `edgeAnnotationIndex` and thread them into the projector; the per-node AND per-edge mirror `<li>` rows grow `data-has-annotation` + `data-annotation-count`.
- `apps/participant/src/graph/GraphView.test.tsx` covers the 6 new Vitest cases plus the adapted existing cases. Per ADR 0022, every behavioural assertion is a committed test case.
- `tests/e2e/participant-graph-render.spec.ts` flips its `describe` to `.serial` and adds the fourth `test()` block per the Constraints sketch. **Per ORCHESTRATOR.md UI-stream e2e policy**: the route IS reachable (settled by `part_graph_render`) and the per-target mirror IS in place (settled by `part_per_facet_state_styling` + `part_axiom_mark_decoration`), so the e2e is in scope. The spec asserts via the DOM mirror, not via canvas pixels.
- `pnpm run check` clean.
- `pnpm run test:smoke` green; Vitest count rises by the new cases (10 annotations + 6 projectGraph + 6 GraphView = +22).
- `pnpm -F @a-conversa/participant build` succeeds (bundle grows by the annotation derivation; expected, no new dependency).
- `pnpm run test:e2e:smoke` (with the compose stack up via `make up`) executes the extended spec and it passes; wall-clock for `chromium-participant-skeleton` grows by ~one block (~14s) under serial execution.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/40-participant-ui.tji` gets `complete 100` on `part_annotation_render` in the same commit (the Closer's ritual).

## Decisions

### §1 — Presence boolean + count at the at-a-glance card layer; per-annotation breakdown deferred to the entity detail panel; SYMMETRIC across node AND edge targets (the structural divergence from `part_axiom_mark_decoration`)

The moderator's `mod_annotation_rendering` renders one amber pill per annotation per target — so a node carrying three annotations paints three pills (each with the localized kind label + `title` content), and an edge carrying two annotations paints two pills beneath the role label. The per-annotation per-kind chromatic identity is moderator-load-bearing: the moderator's role is to track what kinds of meta-commentary have landed where, with hover-content access to the `content` body.

The participant's at-a-glance card layer faces a different constraint. The methodology's debater-side use of annotations is anchored on two questions: (a) "does this entity carry any meta-commentary right now?" — the at-a-glance signal that says "the moderator (or another debater, future authoring leaf) has commented on this"; (b) "what specifically did they say?" — the drill-down detail the debater consults when they tap the entity. Question (a) is presence + count per target; question (b) needs the per-annotation kind + content + author list.

Three options for the at-a-glance signal:

- **(a) `hasAnnotation: boolean` + `annotationCount: number` overlay; per-annotation breakdown owned by the entity detail panel.** Chosen. The presence + count paints two pieces of information per target ("there is meta-commentary" + "how much") without claiming Cytoscape canvas real estate for per-annotation badges; the per-annotation breakdown lives in the React-driven entity detail panel (`part_entity_detail_panel`, a future leaf — same panel that hosts the deferred per-facet pill row from `part_per_facet_state_styling` and the deferred per-participant axiom-mark chromatic row from `part_axiom_mark_decoration`). When the detail panel lands it imports the moderator's `AnnotationBadge` directly (same per-kind palette, same `methodology.annotationKind.<kind>` catalog keys).
- **(b) Per-annotation chromatic badges as Cytoscape DOM overlays.** Position one rendered React badge per annotation at each Cytoscape target's screen coordinates, sync on pan/zoom ticks. Same heavy mechanism `part_axiom_mark_decoration` Decision §1 rejected — pan/zoom would re-sync every overlay's position on every tick. The per-annotation data is also not load-bearing at the at-a-glance layer (the debater is looking at the whole graph; per-annotation detail is a tap-to-drill-down moment, not a panoramic-view moment). Rejected.
- **(c) Presence boolean only (no count).** Same shape as the axiom-mark leaf's `isAxiom` boolean. Rejected because annotations carry meaningful multiplicity at the at-a-glance layer in a way axiom-marks don't: an axiom-mark presence ("this is bedrock for someone") is largely all-or-nothing — the per-participant attribution matters but the count of participants who marked it is methodologically less load-bearing than the boolean itself. Annotations are different: a node with one note is a different at-a-glance signal than a node with five annotations (the latter is "the conversation has been actively re-framed here multiple times"); a debater scanning the canvas wants to see the density, not just the presence. The count costs one additional small integer per target on the data record and one additional attribute on the mirror — cheap, observable, and methodologically meaningful.

Decision §1 (a): ship (a). The participant carries presence + count at the at-a-glance card layer. The per-kind / per-author / per-content breakdown lands in the entity detail panel.

The **structural divergence from `part_axiom_mark_decoration`**: annotations target both nodes AND edges per the wire schema's XOR (`annotationCreatedPayloadSchema` carries `target_node_id` AND `target_edge_id`, exactly one non-null). Axiom-marks are node-only (`axiomMarkProposalSchema` has only `node_id`). Consequence: this leaf widens BOTH `ParticipantNodeData` AND `ParticipantEdgeData` with the two new fields; the projector consults TWO bucketed indexes (one per target kind); the stylesheet adds TWO overlay selectors (one per target kind); the mirror widens BOTH `<li>` row kinds. The axiom-mark leaf widened only the node side.

A consequence of (a) + the symmetry: `annotations.ts` exports BOTH bucketers (`groupAnnotationsByNode` AND `groupAnnotationsByEdge`) and BOTH boolean helpers (`nodeHasAnnotation` AND `edgeHasAnnotation`) — the projector calls both. The single shared `projectAnnotations(events)` call inside `GraphView.tsx` is run once per events change and its output split into the two bucketed indexes (per the Component-shape sketch above); the `O(n)` projection cost is paid once, not twice.

### §2 — Verbatim port of `projectAnnotations` + both bucketers into the participant workspace; no shell extraction yet

The moderator's `selectors.ts` is the canonical client-side annotation derivation. Same YAGNI argument as `part_axiom_mark_decoration` Decision §2 + `part_graph_render` Decision §4 + `part_per_facet_state_styling` Decision §2 + the `shared_shell_extract_merge_slots_and_derive_slot_occupants.md` precedent: extract with two callers risks shaping the seam around the second caller's needs (which differ from the eventual third), and the duplication cost (a ~80-line port — bigger than `axiomMarks.ts` because the bucketers come in pairs, smaller than `facetStatus.ts`) is bounded and reversible.

Two options:

- **(a) Port verbatim into `apps/participant/src/graph/annotations.ts` now; document the port; extract to `@a-conversa/shell` when the third caller (audience) materialises.** Chosen.
- **(b) Extract `projectAnnotations` + both bucketers into `@a-conversa/shell` in this commit so the participant imports from the shell.** Rejected — same YAGNI argument as the predecessors. The trigger is the third caller (audience surface), not a calendar date.

Header comment on the new participant file links back to:
- `apps/moderator/src/graph/selectors.ts` (parallel client mirror — both client ports must stay in lock-step if a future annotation wire-event shape change lands; in particular, if a future `annotation-edited` or `annotation-removed` event kind appears, both ports update together);
- `docs/methodology.md` §"Agreement is per-facet and per-participant" (the canonical mention of annotations alongside facets in the per-participant tracking rule).

A future ADR / refinement that extracts the shared helpers into `@a-conversa/shell` finds the moderator copy via this comment trail.

### §3 — Annotation overlay = Cytoscape's `overlay-*` properties on nodes (amber wash) + `underlay-*` properties + width bump on edges (amber halo); composes WITH per-status branches without overriding them

The annotation overlay needs to be a visual layer that (a) reads at-a-glance as "this entity carries meta-commentary", (b) composes cleanly with the per-status rollup branches AND the axiom-mark overlay both prior layers installed, (c) is testable via the DOM mirror without canvas-pixel introspection. The constraint set is tighter than the axiom-mark leaf's: the axiom-mark overlay already owns `border-style` + `border-width` on nodes; the per-status branches own `border-color` / `background-color` / `opacity` / `outline-*`. Adding annotation signal on top requires choosing a Cytoscape style property neither of those two layers touches.

Four options for the visual treatment (node side):

- **(A) Cytoscape `overlay-color` + `overlay-opacity` + `overlay-padding`** — a translucent amber wash painted as a separate Cytoscape layer ON TOP of the node body (border + fill + outline all stay). Chosen. Mechanically: Cytoscape's overlay is a designed extensibility seam for exactly this — a per-element "this element is highlighted" indicator that composes WITHOUT touching the element's own border / fill / outline. The amber-500 color (`#f59e0b`) is the same hue the moderator's `AnnotationBadge` uses (`bg-amber-100 text-amber-900`); the color identity stays consistent across surfaces.
- **(B) Icon overlay via `background-image`** — same rejection as the axiom-mark leaf's option (B): asset management overhead + visual collision with the wording label centered in the node body. Rejected.
- **(C) Border color override** — set `border-color: '#f59e0b'` on annotated nodes. Would clobber the per-status `border-color` (the most load-bearing per-status signal — "is this proposed / agreed / disputed?"). Rejected: silently suppressing the status signal on any annotated entity is exactly the cross-layer interference Decision §3 should prevent.
- **(D) Append a count badge to the wording label** by mutating `data.wording` in the projection. Same rejection as the axiom-mark leaf's option (D): contaminates the wording field with rendering concerns; localization-fragile. Rejected.

Three options for the visual treatment (edge side):

- **(α) Width bump (1 → 4) + `underlay-color` + `underlay-opacity` halo** — Cytoscape edges don't accept `overlay-*`, but `underlay-*` paints a halo behind the stroke. The combination — wider stroke + amber halo — reads as "this edge carries meta-commentary" while preserving the per-status `line-color` + `line-style` the rollup branch owns. Chosen.
- **(β) `line-fill: 'linear-gradient'` with `line-gradient-stop-colors`** — paint the edge as a gradient between the per-status color and amber. Mechanically works but the gradient direction would compete with the directional arrow semantic the per-status arrow-color already carries; reads as "the edge changes role mid-flight", which is misleading. Rejected.
- **(γ) `line-style: 'dashed'`** — flip the line style. Rejected because the per-status branches ALREADY use line-style as their primary signal (`solid` for agreed / disputed / committed, `dashed` for proposed / withdrawn); flipping to `dashed` for annotation presence would suppress the rollup signal on agreed edges and double-paint it on proposed edges.

Chosen: (A) for nodes + (α) for edges. The overlay entries are:

```ts
{ selector: 'node[?hasAnnotation]', style: {
  'overlay-color': '#f59e0b',     // amber-500
  'overlay-opacity': 0.15,
  'overlay-padding': 4,
} },
{ selector: 'edge[?hasAnnotation]', style: {
  width: 4,                         // baseline edges are width 1
  'underlay-color': '#f59e0b',     // amber-500
  'underlay-opacity': 0.25,
  'underlay-padding': 3,
} },
```

Why these specific values:
- **`overlay-opacity: 0.15`** — light enough that the per-status border + fill remain the dominant visual signal; heavy enough that the wash is unambiguously present. The moderator's `bg-amber-100` (Tailwind amber-100) sits at roughly 95% lightness; an amber-500 at 15% opacity over a white-ish background produces a visually similar tint. The badge palette consistency across surfaces matters for the eventual entity-detail-panel hand-off.
- **`overlay-padding: 4`** — extends the wash 4px beyond the node body so the signal is visible at the perimeter (the inside of the wash blends with the node body color; the perimeter halo is what reads at a glance).
- **`width: 4` on annotated edges** — baseline `width: 1`, bumped 4x; large enough to read across a typical edge length but not so large that it dominates the rollup color. The bump composes cleanly with the per-status `line-color`.
- **`underlay-opacity: 0.25` + `underlay-padding: 3`** — amber halo painted behind the stroke; the halo is wider than the bumped stroke so it reads as a glow around the edge, not as a second stroke.

The one cross-layer interaction worth calling out: a node that is simultaneously axiom-marked AND annotated paints "per-status color + double border 3px + amber wash". The three signals stack without occluding each other — the wash sits above the border + fill but below the layout-z of the label text per Cytoscape's render order. If real usage shows the visual reads as confusing, a future polish leaf can adjust opacity or swap the overlay for an outline halo (the seam is the two stylesheet entries, one block to edit).

### §4 — `hasAnnotation` + `annotationCount` stamped on the projection output, not on separate Cytoscape classes

Same shape decision as `part_axiom_mark_decoration` Decision §4. Two options for how the projector communicates the annotation signal to the Cytoscape stylesheet:

- **(a) Stamp `hasAnnotation: boolean` + `annotationCount: number` on the element `data` object; stylesheet selectors match `node[?hasAnnotation]` / `edge[?hasAnnotation]`.** Chosen.
- **(b) Add Cytoscape classes (`'has-annotation'`, `'annotation-count-N'`) to the element descriptor.** Mechanically equivalent for the simple boolean. Rejected for the same two consistency reasons as the axiom-mark leaf: (1) the per-facet-state-styling and axiom-mark-decoration predecessors use the data-field-with-selector pattern, not the class pattern — adopting the data-field pattern keeps the stylesheet vocabulary uniform across the three overlays; (2) the DOM mirror reads `node.data.hasAnnotation` / `node.data.annotationCount` directly; using classes would require either reading the Cytoscape class set OR carrying parallel "is in class" attributes on the mirror, doubling the surface area. Additionally, the count is a small integer with arbitrary range (1, 2, 3, …, N); modeling it as a class would either explode into per-N classes (`annotation-count-1`, `annotation-count-2`, …) or require parsing the class name. The data field is the natural fit.

A side benefit of (a): both values are observable via `cy.elements().jsons()` in tests, which gives a sanity check against mirror drift without needing to inspect Cytoscape's internal class set.

### §5 — DOM mirror adds `data-has-annotation="true|false"` AND `data-annotation-count="<n>"` on BOTH `<li participant-node-status>` AND `<li participant-edge-status>`; explicit "0" / "false" (not omit-when-empty) for symmetry

The DOM mirror is `aria-hidden="true"` and serves as the canvas-blind testability seam (Decision §4 of `part_per_facet_state_styling` settled this; Decision §5 of `part_axiom_mark_decoration` extended it with `data-is-axiom` on the node row). The annotation signal extends BOTH the existing per-node AND per-edge `<li>` rows rather than adding new `<li>` rows — keeping the mirror's row count tight.

Attribute encoding: explicit `"true"` for annotated, explicit `"false"` for not-annotated, explicit `"0"` (not omit) for zero count, explicit `"<n>"` for nonzero count. Same three reasons as Decision §5 of `part_axiom_mark_decoration`:

- **Symmetry with `data-rollup-status` / `data-facet-*` / `data-is-axiom`.** Those attributes use sentinel strings (`"none"` for empty rollup; `""` for absent facets; `"true"` / `"false"` for axiom-marks) rather than omission. The same posture for `data-has-annotation` + `data-annotation-count` keeps the mirror's per-attribute presence uniform.
- **Explicit not-annotated branch in Playwright.** The block 4 e2e asserts `[data-has-annotation="true"]` + `[data-annotation-count="2"]` on the doubly-annotated node AND `[data-has-annotation="false"]` + `[data-annotation-count="0"]` on the unannotated node. The `"false"` / `"0"` branches are real assertions — "we confirmed this entity is NOT annotated" — not the absence of an assertion.
- **Reader-friendliness for the cross-referencer.** A reader scanning the rendered DOM in devtools sees the annotation state for every entity, not just the annotated ones.

A consequence of the symmetric treatment (both node AND edge mirror rows): the four total new attributes (`data-has-annotation` + `data-annotation-count` × 2 mirror row kinds) are testable via the same `page.locator('[data-testid="participant-node-status"][data-node-id="..."]')` / `page.locator('[data-testid="participant-edge-status"][data-edge-id="..."]')` selectors the prior tests already use.

### §6 — Fourth `test()` block in the existing spec file, reusing `alice` + `ben` BUT flipping the describe to `.serial`; trade-off documented

The existing `tests/e2e/participant-graph-render.spec.ts` describe now has THREE `test()` blocks consuming all six Authelia dev users (`alice`+`ben`, `maria`+`dave`, `frank`+`erin` per [`infra/authelia/users.yml`](../../../infra/authelia/users.yml) + the JSDoc on `loginAs` at [`tests/e2e/fixtures/auth.ts:112-115`](../../../tests/e2e/fixtures/auth.ts#L112)). Adding a fourth block requires either picking a fresh pair (impossible — pool exhausted), reusing a pair (risky under the in-file `fullyParallel: true` race the prior decisions cared about), or splitting into a new spec file.

Three options:

- **(a) Fourth `test()` block in the existing file using `alice` + `ben`, with the describe modifier changed from `test.describe(...)` to `test.describe.serial(...)`.** Chosen. The `.serial` modifier forces the 4 blocks to run sequentially within the same worker — the wall-clock grows by roughly one block (~14s based on the prior blocks' Status notes) but the per-user race is eliminated (no two blocks claim debater-A on overlapping sessions within the same worker). The `alice` + `ben` pair is reused (block-1 ALSO uses it); within-worker serialization means block-1 and block-4 never overlap.
- **(b) New spec file `tests/e2e/participant-annotation-render.spec.ts` with its own setup-auth and fresh user pair.** Rejected for now: the new file would duplicate the alice-creates → ben-claims → goto-operate setup chain (~80 lines of fixture composition). The "split when it gets crowded" rule the prior leaf hinted at (Decision §6 of `part_axiom_mark_decoration` set the threshold at 5 blocks) — at 4 blocks the split adds maintenance overhead without the readability win. Additionally, a new spec file would have to choose its own pair from the same exhausted 6-user pool; cross-file user collisions are the same race in different clothing (the global `users` DB row upsert is the bottleneck either way).
- **(c) Reuse `alice` + `ben` AND keep `fullyParallel: true`.** Rejected: the prior leaves' Decision §6 specifically cited the in-file parallel-execution race as the reason for distinct pairs. Reusing without `.serial` would race block-1 against block-4 on the per-session `users` upsert AND on the per-session debater-A claim. The `.serial` modifier is the cheap fix; reusing the pair without the modifier rolls back the prior decisions' rationale.

Chosen: (a). The describe modifier flip is one line of code (`test.describe(...)` → `test.describe.serial(...)`); the new block reuses `alice` + `ben` since they were the first-block pair. A new top-of-describe comment cites this refinement's Decision §6 so a future reader doesn't undo the `.serial` modifier without understanding the trade-off.

The wall-clock cost of `.serial`: the prior 3-block describe ran in ~14s per block under parallel, ~42s sequential. Adding a 4th block under `.serial` brings the spec file to ~56s — still well under the playwright per-spec budget. The serial mode runs all 4 blocks in the same worker; the `chromium-participant-skeleton` project's overall wall-clock grows by ~14s (one block's worth) compared to the parallel-with-distinct-pairs alternative.

The new `test()` block:

1. Sets up alice + ben + the session + the lobby chain (mirroring block 1).
2. Navigates ben to `/p/sessions/${sessionId}` (manual `page.goto`, same as the prior blocks).
3. Asserts `route-operate` + `participant-graph-root` + `participant-graph-status-mirror` visible.
4. Seeds the events into ben's WS store via `__aConversaWsStore.getState().applyEvent(...)`:
   - Two `node-created` events (NODE_A_ID and NODE_B_ID; the second so the mirror has an unannotated-node baseline to assert against).
   - One `edge-created` event (EDGE_ID, source NODE_A → target NODE_B; gives the mirror an edge to annotate).
   - Three `annotation-created` events: two targeting NODE_A (so the count rises to 2; one of kind `note`, one of kind `reframe` to exercise the kind multiplicity) and one targeting the EDGE (kind `stance`, count 1).
5. Asserts:
   - `page.locator('[data-testid="participant-node-status"][data-node-id="${NODE_A_ID}"]')` has `data-has-annotation="true"` AND `data-annotation-count="2"`.
   - `page.locator('[data-testid="participant-node-status"][data-node-id="${NODE_B_ID}"]')` has `data-has-annotation="false"` AND `data-annotation-count="0"`.
   - `page.locator('[data-testid="participant-edge-status"][data-edge-id="${EDGE_ID}"]')` has `data-has-annotation="true"` AND `data-annotation-count="1"`.

The block is ~50 lines on top of the shared helpers (slightly larger than the prior blocks because of the three annotation seed events + the per-target assertion triple).

### §7 — Read the annotation signal directly from the events log, not from a per-session `annotations` slice (no such slice exists yet on the client)

Same shape decision as `part_axiom_mark_decoration` Decision §7. The participant's WS store carries `BaseWsSessionState.events: Event[]` per [`packages/shell/src/ws/store-contract.ts:44-53`](../../../packages/shell/src/ws/store-contract.ts#L44); no pre-projected `annotations` slice exists on the client today.

Two options:

- **(a) Derive from `events` via the local port.** Chosen.
- **(b) Wait for a server-broadcast `annotations` slice and consume that.** Rejected for the same two reasons the axiom-mark leaf cited: (i) the slice doesn't exist; introducing it is a backend change that doesn't fit the 0.5d budget; (ii) the per-events derivation IS the source of truth — a broadcast slice would be a cached derivation that needs reconciliation with the events log on every event apply. The events-log read is the simpler path; the broadcast slice can come later if the derivation cost becomes load-bearing.

Decision §7: chosen (a). The derivation cost is paid once per `events` change via `useMemo` (same idiom as the `facetStatusIndex` + `axiomMarkIndex` memos); the projection is `O(n)` over events and `annotation-created` events are a small fraction of any session's events.

A small efficiency note: the two bucketers (`groupAnnotationsByNode` + `groupAnnotationsByEdge`) share a single underlying `projectAnnotations(events)` walk. The Component-shape sketch above factors that out as a separate `annotations = useMemo(() => projectAnnotations(events), [events])` step feeding both bucketers, so the `O(n)` walk runs once per events change, not twice.

### §8 — Export both presence boolean helpers AND the count helper from `annotations.ts`; the bucketed-list seam stays reachable for the future detail-panel consumer

The `annotations.ts` module exports:

- `groupAnnotationsByNode(annotations): Map<string, readonly Annotation[]>` — bucketed list per node (verbatim from the moderator port).
- `groupAnnotationsByEdge(annotations): Map<string, readonly Annotation[]>` — bucketed list per edge (verbatim).
- `nodeHasAnnotation(grouped, nodeId): boolean` — presence helper for node targets.
- `edgeHasAnnotation(grouped, edgeId): boolean` — presence helper for edge targets.
- `annotationCountFor(grouped, id): number` — count helper, takes either index (the same `Map<string, readonly Annotation[]>` shape).

The at-a-glance projection consumes `annotationCountFor` and derives the boolean inline (`hasAnnotation: list.length > 0`), but the boolean helpers are exported anyway for the future entity-detail-panel consumer (which needs presence as a precondition for rendering the badge row). Same rationale as `part_axiom_mark_decoration` Decision §8 — carrying the small helpers means the future consumer doesn't refactor the seam.

The bucketed list (the `Map<string, readonly Annotation[]>` itself) is what the entity detail panel will consume to render the per-annotation badge row with kind + content + author. Exposing the bucketers as the primary seam — instead of inlining the bucketing into the projector — means the detail panel imports `groupAnnotationsByNode` / `groupAnnotationsByEdge` directly without re-walking the events log.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- **Structural divergence from the axiom-mark template.** Unlike axiom-marks (which attach only to nodes), `annotation-created` events carry an XOR target — either `nodeId` OR `edgeId`. The port to `apps/participant/src/graph/annotations.ts` accordingly exposes BOTH `groupAnnotationsByNode` and `groupAnnotationsByEdge` bucketers over a shared `projectAnnotations(events)` walk; the `apps/participant/src/graph/projectGraph.ts` projection stamps symmetric `hasAnnotation` + `annotationCount` data on BOTH node and edge entries (axiom-mark only stamps nodes).
- **Cytoscape layering: overlay-* for nodes, underlay-* for edges.** The annotated-node visual uses Cytoscape's `overlay-*` stylesheet seam (amber overlay drawn on top of the node's existing per-facet state styling + rollup decoration + axiom-mark glyph) at `apps/participant/src/graph/GraphView.tsx`'s `node[?hasAnnotation]` selector. The annotated-edge visual uses the `underlay-*` seam (amber underlay drawn beneath the edge's color + width-bump) at the `edge[?hasAnnotation]` selector — chosen so the per-facet edge color (proposed / agreed / disputed) stays the primary signal and the annotation underlay reads as a halo, not a recolor. Both selectors compose with rollup + axiom layers without overriding any existing style key.
- **DOM-mirror extension on both node AND edge rows.** Extended `participant-node-status` and `participant-edge-status` mirror rows in `apps/participant/src/graph/GraphView.tsx` with `data-has-annotation` (`"true"`/`"false"`) and `data-annotation-count` (numeric string). The symmetric per-target row attrs are what the new Playwright block reads to assert presence + count — the headless-Cytoscape test seam stays intact.
- **Playwright spec flipped to `test.describe.serial`.** Added a 4th block to `tests/e2e/participant-graph-render.spec.ts` (alice + ben again; the 6-user Authelia dev pool was already exhausted by blocks 1–3) that seeds 3 `annotation-created` events (2 node-targeted on NODE_A, 1 edge-targeted on EDGE) and asserts the per-target mirror values. Wall-clock for the spec file: ~33.5s under `.serial` (one worker, sequential) vs the prior ~14s/block under `fullyParallel`. The user-pool exhaustion is registered as the cross-cutting follow-up `part_e2e_user_pool_expansion` (see `tasks/40-participant-ui.tji`) — the cheap fix is two more dev user pairs in `infra/authelia/users.yml` + `tests/e2e/fixtures/auth.ts`.
- **Failing-first verification per ADR 0022.** Confirmed by forcing `hasAnnotation: false` + `annotationCount: 0` in both `projectGraph` branches: 5 of the 6 new `projectGraph` cases (bb–ff) flipped to red; case (aa) ("false by default") correctly stayed green. Helpers restored and the full smoke suite re-ran clean.
- **Test-count deltas.** Vitest 3872 → 3894 (+22 = 10 annotations + 6 projectGraph + 6 GraphView). Cucumber unchanged. Playwright `participant-graph-render.spec.ts` 3 → 4 blocks; e2e run 5/5 passing in 33.5s under one worker.

Artifacts:

- `apps/participant/src/graph/annotations.ts` — ported `projectAnnotations` + `groupAnnotationsBy{Node,Edge}` + presence/count helpers.
- `apps/participant/src/graph/annotations.test.ts` — 10 unit cases.
- `apps/participant/src/graph/projectGraph.ts` + `projectGraph.test.ts` — symmetric node+edge stamping; +6 cases.
- `apps/participant/src/graph/GraphView.tsx` + `GraphView.test.tsx` — overlay/underlay stylesheet entries + DOM-mirror data-* attrs; +6 cases.
- `tests/e2e/participant-graph-render.spec.ts` — 4th block + `.serial` flip.
