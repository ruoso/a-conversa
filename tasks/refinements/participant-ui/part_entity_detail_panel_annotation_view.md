# Full annotation entity detail panel (kind / content / author / target / contradicts list)

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_entity_detail_panel_annotation_view` (block at L221–234). Embedded note: *"Source of debt: part_render_annotation_endpoint_edges — the entity-detail-panel today renders a placeholder ('Annotation selected — detail view coming soon') when the selected entity is an annotation. This task replaces the placeholder with the full annotation view: kind label, content text, author attribution, target-of-this-annotation link, contradicts-this-annotation edge list. Likely mirrors the moderator's AnnotationBadge extracted into the shell package. Includes Playwright cover asserting the panel surfaces annotation content + kind + author."*

**Effort estimate**: 1d

**Inherited dependencies**:

- `!participant_ui.part_graph_view.part_render_annotation_endpoint_edges` (settled — 2026-05-30, see [refinement Status](./part_render_annotation_endpoint_edges.md#status)). Shipped:
  - Annotation graph-node materialization in `projectGraph` (annotations referenced as edge endpoints emit as Cytoscape nodes with `nodeKind: 'annotation'` + `annotationKind: AnnotationKind`).
  - Selection-store widening to `{ kind: 'annotation', id }` plus the tap-handler reading `data.nodeKind`.
  - **The placeholder branch we are replacing** at [`apps/participant/src/detail/EntityDetailPanel.tsx:446-460`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L446) — renders `<p data-testid="participant-detail-panel-annotation-placeholder">{t('participant.annotation.detail.placeholder')}</p>` under `<aside data-state="annotation">`.
  - The `'annotation'` arm of [`apps/participant/src/detail/lookupEntity.ts:60-67`](../../../apps/participant/src/detail/lookupEntity.ts#L60) returning `null` ("reserved for the future annotation-tap surface"). THIS task is that future surface.
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_entity_detail_panel` (settled — 2026-05-17). Established the panel's eight-section shape, the route-hoisted projection memos, the `useSelectionStore` subscription pattern, the `participantRosterFrom` / `screenNameFor` resolvers, and the testid family `participant-detail-panel-*`. THIS task adds a ninth render branch (the annotation entity view) alongside the existing empty-state / stale-entity / detail-body / annotation-placeholder branches.
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_annotation_render` (settled — established `<AnnotationsSection>` at [`EntityDetailPanel.tsx:709-742`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L709) which renders a list of annotations targeting the selected NODE/EDGE entity. THIS task is the symmetric case — rendering the *one* annotation whose own entity is selected — and reuses the same `Annotation` shape from `@a-conversa/shell` ([packages/shell/src/annotations/annotations.ts:56-64](../../../packages/shell/src/annotations/annotations.ts#L56)).
- Prose-only context: `mod_annotation_rendering` (settled 2026-05-11). The moderator's [`apps/moderator/src/graph/AnnotationBadge.tsx`](../../../apps/moderator/src/graph/AnnotationBadge.tsx#L1) is the canvas-side per-annotation pill (amber bg, kind label, `title=content`). It is NOT the right primitive to import here — the panel's annotation-view is a structured prose surface, not a tiny pill — but the kind-label catalog (`methodology.annotationKind.*`) is shared, and the existing audience + moderator AnnotationBadge precedent confirms the participant becoming a third caller for any future shell-extracted per-annotation primitive (Decision §2).
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every check ships as a committed Vitest case or Playwright spec block.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — section headings + per-kind labels go through `useTranslation()`; new i18n keys added in all three locales.
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — annotations are entities (not facets); the panel's annotation-entity body carries entity-layer attributes only (no facet pill row, no per-facet vote rows — those would be category-mistakes).

## What this task is

Replace the participant entity-detail-panel's annotation **placeholder** body with a structured detail view that surfaces, for the annotation selected on the canvas:

1. **Identity header** — `t('participant.detailPanel.identity.annotation')` ("Annotation") + the localized kind label (`methodology.annotationKind.<kind>`) + the annotation id (small / muted / mono — matching the existing identity-section convention).
2. **Content text** — the verbatim `annotation.content` body, rendered as prose (not truncated; not `title`-attribute-hidden).
3. **Author attribution** — the resolved screen name via `screenNameFor(roster, annotation.createdBy)`.
4. **Target-of-this-annotation link** — a row carrying the kind (Node / Edge) of the annotation's target plus a navigation affordance (a button) that calls `useSelectionStore.getState().select({ kind: 'node'|'edge', id })` to swap the panel's selection to the underlying target entity. Resolves which kind via `annotation.targetNodeId` / `annotation.targetEdgeId` XOR.
5. **Contradicts-this-annotation edge list** — every projected edge whose `role === 'contradicts'` AND whose `source` or `target` equals the selected annotation's id. Each row renders the edge's role label + the *other* endpoint's resolved label (statement wording for a node endpoint, kind label for an annotation endpoint) + a navigation affordance that selects the edge in the store.

Out of scope (each registered as a named follow-up under Tech-debt registration, or explicitly out of scope below):

- **Lifting the panel's annotation-view into the shell package.** The participant is the first surface to render a per-annotation detail view (moderator surfaces annotations as inline canvas badges + a future per-annotation panel hasn't been scoped; audience surfaces annotations as broadcast-overlay badges without drill-down). Per the established third-caller rule (see [`extract_facet_pill`](../shell-package/extract_facet_pill.md), [`extract_cytoscape_projectors`](../shell-package/extract_cytoscape_projectors.md)), no shell-lift in this leaf — Decision §2.
- **Per-kind chromatic theming of the section identity row.** The four-color palette (amber/violet/teal/sky) lives on the Cytoscape annotation graph-nodes per `part_render_annotation_endpoint_edges` Decision §4; the panel surfaces the kind label textually only, matching the existing `<AnnotationsSection>` style at [`EntityDetailPanel.tsx:730-732`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L730). Decision §4.
- **Annotation-of-annotation chain rendering on the target row.** When `targetNodeId` points at another annotation (rather than a statement node), the row simply renders "Annotation: <kind>" and links to it; the chain depth is bounded by the methodology and rendering each link separately is sufficient. The unified `groupAnnotationsByEntityId` walk needed to surface annotation-of-annotation overlays on the canvas is the separately-scoped `part_annotation_of_annotation_overlay_chain`. Decision §3.
- **A `contradicts`-list-style projection helper for every edge role.** Only `contradicts` is structurally important for the annotation-detail view (the methodology surfaces "this annotation is contradicted by these edges" as a load-bearing relation); other roles (`supports`, `rebuts`, `clarifies`, `informs`, `qualifies`) that happen to anchor on an annotation are NOT surfaced as separate lists in v0 — they appear inline in the panel if the user navigates to the underlying edge. Decision §5.
- **A dedicated "actions" slot for proposing edits / withdrawals against an annotation.** The participant is read-mostly on the annotation entity in v0; affordances for annotation withdrawal / re-targeting are a methodology question outside this task's scope.

## Why it needs to be done

**The placeholder is a self-acknowledged stub.** `part_render_annotation_endpoint_edges` Decision §6 explicitly registered this task: *"Bundling [the full annotation-entity rendering] here doubles this task's effort without much gain. The Tech-debt registration captures the follow-up explicitly."* Today, a debater who taps an annotation graph-node on the canvas sees "Annotation selected — detail view coming soon" — an honest interim UX, but a regression in information density vs the moderator surface (which renders annotation kind + content + author inline on the canvas via `<AnnotationBadge>`).

**The information is already projected and addressable.** `projectAnnotations` ([packages/shell/src/annotations/annotations.ts:83](../../../packages/shell/src/annotations/annotations.ts#L83)) and the route-hoisted `nodeAnnotationIndex` / `edgeAnnotationIndex` memos already carry every annotation's kind / content / `createdBy` / target. The `projectedEdges` array already carries every edge with `role` + `source` + `target`. The `useSelectionStore` already accepts the `'annotation'` discriminant. The work is pure presentation — composing the existing inputs into a panel body — with no new projection, no new wire shape, no new store widening.

**The participant's structural-narrative surface is incomplete without it.** When the methodology emits an edge "N19 contradicts A2" (the canonical walkthrough's E15 per [docs/example-walkthrough.md](../../../docs/example-walkthrough.md) turn 21), the participant's canvas now renders the edge thanks to `part_render_annotation_endpoint_edges`. But the *participant's read affordance for the annotation A2 itself* — what kind of annotation is it? what does it say? who wrote it? what statement does it annotate? what other annotations or statements contradict it? — is the panel's job, and today the panel just punts. Closing this gap is what makes the canvas + panel pair structurally complete for read-mostly annotation comprehension.

**Unblocks future annotation-authoring affordances.** Any future task adding participant-side affordances against an annotation (proposing a contradiction edge anchored on it, withdrawing one's own annotation) needs a usable annotation-detail surface as its mount point — the existing `actionSlot` pattern at [`EntityDetailPanel.tsx:564-566`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L564) is the established seam, but the panel's annotation branch today has no body to mount actions beneath.

## Inputs / context

**Design contract:**

- [`docs/example-walkthrough.md`](../../../docs/example-walkthrough.md) — turn 21 (E15: N19 contradicts A2). The narrative this panel surface enables a debater to read.
- [`docs/methodology.md`](../../../docs/methodology.md) — annotation kinds + their semantics (note / reframe / scope-change / stance). The labels rendered are localized resolutions of these.
- [`docs/data-model.md`](../../../docs/data-model.md) — annotation entity shape + XOR target invariant.

**Architectural / engineering inputs:**

- [ADR 0003](../../../docs/adr/0003-frontend-framework-react.md) — React for all three UI surfaces.
- [ADR 0005](../../../docs/adr/0005-styling-tailwind.md) — Tailwind utility classes; the new section bodies reuse the existing panel typography scale.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every check ships as a committed Vitest case or Playwright spec block.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — react-i18next; new keys in all three locales.
- [ADR 0026](../../../docs/adr/0026-participant-detail-panel-no-shell-export-until-third-caller.md) — defers shell-lifting until the audience surface adds a third caller. Decision §2 honors this for the annotation-view.
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — entity-layer attributes only on the annotation body.

**Runtime inputs (real files the implementer reads + edits):**

- [`apps/participant/src/detail/EntityDetailPanel.tsx:438-460`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L438) — the existing annotation-placeholder branch. **This task replaces the inner body**; the `<aside>` wrapper, `data-state="annotation"`, `data-entity-kind="annotation"`, and `data-entity-id={selected.id}` attributes are preserved verbatim (seam stability for existing assertions + the future `actionSlot` mount point).
- [`apps/participant/src/detail/EntityDetailPanel.tsx:312-353`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L312) — `EntityDetailPanelProps`. Already carries `projectedNodes`, `projectedEdges`, `events`, `nodeAnnotationIndex`, `edgeAnnotationIndex` — the inputs the annotation body reads. **Signature unchanged**.
- [`apps/participant/src/detail/EntityDetailPanel.tsx:709-742`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L709) — `<AnnotationsSection>` (the bucketed list of annotations on a statement node/edge). Style/typography reference for the new `<AnnotationDetailBody>`; the per-row kind/content/author triple in that section informs the same triple in the new body.
- [`apps/participant/src/detail/lookupEntity.ts:60-67`](../../../apps/participant/src/detail/lookupEntity.ts#L60) — the `'annotation'` arm returning `null` today. **Replace** with a lookup over the route-hoisted `projectAnnotations(events)` result (a third lookup parameter widens the helper signature — see Decision §1).
- [`apps/participant/src/detail/participantRoster.ts`](../../../apps/participant/src/detail/participantRoster.ts) — `screenNameFor(roster, userId)` reused for author attribution.
- [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx) — the route currently memoizes `projectAnnotations(events)` and threads its bucketed indices to the panel. The same projection is reused; this task adds a thread of the annotation array directly to the panel (see Decision §1 for the input-shape choice).
- [`apps/participant/src/detail/EntityDetailPanel.test.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.test.tsx) — adds component cases for the new body branches.
- [`apps/participant/src/detail/lookupEntity.test.ts`](../../../apps/participant/src/detail/lookupEntity.test.ts) — adds cases for the `'annotation'` arm resolving to the matching `Annotation` record.
- [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) — adds a block exercising the annotation-tap-to-detail surface end-to-end.
- [`packages/i18n-catalogs/src/catalogs/{en-US,es-419,pt-BR}.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — adds the new section heading + identity + target-link + contradicts-list label keys. **Deletes** the placeholder key `participant.annotation.detail.placeholder` (no remaining caller after this task lands).
- [`packages/shell/src/annotations/annotations.ts:56-64`](../../../packages/shell/src/annotations/annotations.ts#L56) — `Annotation` interface (`id` / `kind` / `content` / `targetNodeId` / `targetEdgeId` / `createdBy` / `createdAt`). Consumed verbatim.

## Constraints / requirements

- **Same `<aside>` wrapper and outer testids preserved.** The branch keeps `data-testid="participant-detail-panel"`, `data-state="annotation"`, `data-entity-kind="annotation"`, `data-entity-id={selected.id}`. The placeholder `<p>` is removed; the new section bodies render inside the same `<aside>`. Any future spec or affordance keyed off `data-state="annotation"` keeps working.
- **No projection widening, no store widening.** The selection store already carries `{ kind: 'annotation', id }`; `projectAnnotations` already emits the camelCased `Annotation` shape. This task is presentation-only — no new wire shape, no new bucketer, no new event arm.
- **The `lookupEntity` helper widens to resolve annotations.** Per Decision §1 the helper takes a third input (an `Annotation[]` or its index) and returns the annotation record when `selection.kind === 'annotation'`. The return type widens to `ParticipantNodeData | ParticipantEdgeData | Annotation | null`; consumers (currently just the panel) discriminate on `selection.kind` to decide the render branch.
- **Empty inner sections omit their containers entirely.** Matches the existing panel-section "absent → omit" posture (see `<FacetPillRowSection>` at [EntityDetailPanel.tsx:628-653](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L628), `<AxiomMarkAttributionSection>` at [EntityDetailPanel.tsx:664-702](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L664)). Concretely: when the contradicts list is empty, the entire "Contradicted by" section is omitted; when the annotation's `content` is empty (the wire schema permits an empty string), the content `<p>` still renders (it's load-bearing identity even when blank).
- **Stale-entity branch handled.** When `selection.kind === 'annotation'` and no `Annotation` matches the id in the projected annotation list (a snapshot-reload race or a deletion event that hasn't surfaced yet — annotation deletion isn't a wire kind today, but the defensive posture aligns with the node/edge stale-entity branch at [EntityDetailPanel.tsx:465-477](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L465)), the panel renders the SAME stale-entity body the node/edge branch uses + auto-clears the selection on the next tick. Decision §6.
- **Target-link navigation does NOT round-trip through the canvas.** Clicking the target-link calls `useSelectionStore.getState().select(...)` directly; the panel re-renders with the new selection. The Cytoscape canvas's `:selected` overlay updates via the standard subscription (the canvas mount also subscribes to the store). No new tap-handler.
- **Contradicts-edge-list iteration order is `projectedEdges` order.** Matches `projectAnnotations`-like first-seen-arrival ordering used elsewhere in the panel (e.g. `<AnnotationsSection>`'s map preserves the bucket's arrival order). No re-sort by edge id or by timestamp.
- **Build + test discipline per ADR 0022.** Every check is a committed Vitest case or Playwright spec block; no throwaway verifications. The Playwright cover IS in scope (the surface is reachable today — annotation graph-nodes materialize and tap-to-select wires through to the panel per `part_render_annotation_endpoint_edges`'s deliverable). No deferred-e2e exception applies.

## Acceptance criteria

**Pinned per ADR 0022.** The e2e is in scope (UI-stream task, surface IS reachable today: the annotation graph-node materializes per `part_render_annotation_endpoint_edges`, the tap-handler writes `{ kind: 'annotation', id }` to the store, the panel's `data-state="annotation"` branch fires).

Component widening:

- [ ] [`apps/participant/src/detail/lookupEntity.ts`](../../../apps/participant/src/detail/lookupEntity.ts) takes a third argument `annotations: readonly Annotation[]`. The `'annotation'` arm returns `annotations.find((a) => a.id === selection.id) ?? null`. The return type widens to `ParticipantNodeData | ParticipantEdgeData | Annotation | null`.
- [ ] [`apps/participant/src/detail/lookupEntity.test.ts`](../../../apps/participant/src/detail/lookupEntity.test.ts) gains cases pinning: (annotation-a) an annotation in the array matches → returns the record; (annotation-b) an annotation id not in the array → returns `null`; (annotation-c) signature accepts an empty array; (annotation-d) the existing node / edge arms still pass with the third argument supplied.
- [ ] [`apps/participant/src/detail/EntityDetailPanel.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.tsx) widens `EntityDetailPanelProps` (only minimally — see Decision §1) and the panel's `lookupEntity` call updates to thread the annotation input.
- [ ] The placeholder branch at L446-460 is replaced. The new body lives inside the same `<aside data-state="annotation" data-entity-kind="annotation" data-entity-id={selected.id}>`. The placeholder `<p data-testid="participant-detail-panel-annotation-placeholder">` is removed.
- [ ] The stale-entity branch fires when the annotation id has no match in the input array — same body the node/edge branch renders, same auto-clear `useEffect`. The `useEffect` at [EntityDetailPanel.tsx:417-421](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L417) widens to remove the `selected.kind !== 'annotation'` exclusion (which existed precisely to keep the placeholder up despite a null `entity` lookup).

Section bodies:

- [ ] **Identity section** — `<section data-testid="participant-detail-panel-annotation-identity">` carries: an upper-cased kind-prefix label (`t('participant.detailPanel.identity.annotation')` → "Annotation"); a `<p data-testid="participant-detail-panel-annotation-kind">` with the localized kind label (`t('methodology.annotationKind.<kind>')`); a small mono `<p data-testid="participant-detail-panel-annotation-id">` with `annotation.id`.
- [ ] **Content section** — `<section data-testid="participant-detail-panel-annotation-content">` with `<p data-testid="participant-detail-panel-annotation-content-body">{annotation.content}</p>`. Always renders, even when content is the empty string (the wire schema permits empty `content`; the section renders an empty `<p>` rather than disappearing — content is identity).
- [ ] **Author section** — `<section data-testid="participant-detail-panel-annotation-author">` with the localized heading `t('participant.detailPanel.annotation.sectionTitle.author')` and `<p data-testid="participant-detail-panel-annotation-author-name">{screenNameFor(roster, annotation.createdBy)}</p>`.
- [ ] **Target section** — `<section data-testid="participant-detail-panel-annotation-target">` with the localized heading `t('participant.detailPanel.annotation.sectionTitle.target')`. The body carries one `<button data-testid="participant-detail-panel-annotation-target-link">` with `data-target-kind="node"|"edge"` and `data-target-id={annotation.targetNodeId ?? annotation.targetEdgeId}`. The button's text content is the resolved entity label (statement wording for a node target via `projectedNodes.find(...)`, edge-role label for an edge target via `projectedEdges.find(...)` + `t('methodology.edgeRole.<role>.label')`); when the target entity is itself an annotation, the text content is `t('methodology.annotationKind.<kind>')` of THAT annotation per Decision §3. The button's `onClick` calls `useSelectionStore.getState().select({ kind: 'node'|'edge'|'annotation', id })`.
- [ ] **Contradicts-this-annotation section** — `<section data-testid="participant-detail-panel-annotation-contradicts">` with the localized heading `t('participant.detailPanel.annotation.sectionTitle.contradicts')`. Body is a `<ul>` of `<li data-testid="participant-detail-panel-annotation-contradicts-row" data-edge-id={edge.id}>` rows, one per edge in `projectedEdges` where `role === 'contradicts'` AND (`source === selected.id` OR `target === selected.id`). Each row carries a `<button data-testid="participant-detail-panel-annotation-contradicts-link">` resolving to the OTHER endpoint's label (via the same resolver pattern as the target section) and selecting the edge on click. **The entire section is omitted when no contradicting edge exists.**

i18n:

- [ ] [`packages/i18n-catalogs/src/catalogs/{en-US,es-419,pt-BR}.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) gain the new keys in all three locales:
  - `participant.detailPanel.identity.annotation` (e.g. "Annotation")
  - `participant.detailPanel.annotation.sectionTitle.content` (e.g. "Content")
  - `participant.detailPanel.annotation.sectionTitle.author` (e.g. "Author")
  - `participant.detailPanel.annotation.sectionTitle.target` (e.g. "Annotating")
  - `participant.detailPanel.annotation.sectionTitle.contradicts` (e.g. "Contradicted by")
  - `participant.detailPanel.annotation.unknownTarget` (fallback when the target entity isn't in the projection — e.g. "Unknown target")
- [ ] The existing placeholder key `participant.annotation.detail.placeholder` is **removed** from all three locales (no remaining caller after this task lands). The `'annotation'` arm of `<EntityDetailPanel>` no longer reads it; the i18n catalog test (if one pins absent-keys) is updated to drop the entry.

Vitest cover:

- [ ] [`apps/participant/src/detail/EntityDetailPanel.test.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.test.tsx) — case (annotation-a): a `{ kind: 'annotation', id }` selection with a matching projected annotation renders the new body (kind, content, author, target row, contradicts section absent when no contradicting edge); the panel's `data-state="annotation"` attribute is preserved.
- [ ] Case (annotation-b): the contradicts section renders one `<li>` per `role === 'contradicts'` edge anchored on the annotation (covering both `source === id` and `target === id` anchorings).
- [ ] Case (annotation-c): the target-link button's `onClick` writes the correct `{ kind, id }` to the selection store (mock the store; assert the call).
- [ ] Case (annotation-d): the contradicts-link button's `onClick` writes `{ kind: 'edge', id }` to the selection store.
- [ ] Case (annotation-e): a stale annotation id (no match in the projection) renders the same `data-state="stale"` body the node/edge branch uses + triggers the auto-clear `useEffect`.
- [ ] Case (annotation-f): the placeholder `<p data-testid="participant-detail-panel-annotation-placeholder">` is gone (negative assertion).
- [ ] Case (annotation-g): when the annotation's target is itself an annotation, the target row's text resolves via `methodology.annotationKind.<kind>` of the target annotation (the annotation-of-annotation chain visualization at the panel level per Decision §3).
- [ ] [`apps/participant/src/detail/lookupEntity.test.ts`](../../../apps/participant/src/detail/lookupEntity.test.ts) — cases (annotation-a) through (annotation-d) per the Component widening checklist above.
- [ ] All existing `EntityDetailPanel.test.tsx` cases continue to pass — the node/edge render branches are untouched.

Playwright cover:

- [ ] [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) gains a new block (a `block-4` role-swap — i.e. `henry creates a session, grace claims debater-A` — to avoid re-exhausting the user pool; the predecessor's block-12 already took `leo + kate` per Decision §8 of `part_render_annotation_endpoint_edges`). The block seeds (via `window.__aConversaWsStore`):
  - `session-created`
  - `participant-joined` for both henry + grace (drives the roster's screen-name resolution).
  - `node-created` (statement N1).
  - `node-created` (statement N2 — the source of a future contradicts edge).
  - `annotation-created` (annotation A1, kind `note`, content "context for N1", target_node_id = N1, created_by = grace).
  - `edge-created` (E1, role `contradicts`, source_node_id = N2, target_annotation_id = A1) — materializes A1 as a graph-node per the predecessor's contract.
- [ ] The block taps the materialized annotation node (via the established test seam — selection store write or canvas tap dispatch matching prior blocks' pattern). Asserts the panel shows:
  - `<aside data-testid="participant-detail-panel" data-state="annotation" data-entity-id="A1">` is present.
  - `[data-testid="participant-detail-panel-annotation-kind"]` text matches the localized "Note" label.
  - `[data-testid="participant-detail-panel-annotation-content-body"]` text matches "context for N1".
  - `[data-testid="participant-detail-panel-annotation-author-name"]` text matches "grace" (the seeded screen name).
  - `[data-testid="participant-detail-panel-annotation-target-link"]` is present with `data-target-kind="node"` and `data-target-id="N1"` and its text contains N1's wording.
  - `[data-testid="participant-detail-panel-annotation-contradicts-row"]` is present (exactly one — for E1), with `data-edge-id="E1"`.
  - The legacy `[data-testid="participant-detail-panel-annotation-placeholder"]` is absent.
- [ ] After clicking the target-link, the panel re-renders with `data-state="detail"` + `data-entity-kind="node"` + `data-entity-id="N1"` (proving the selection round-trip works).
- [ ] The block fits the per-block parallel-execution pattern (no `.serial` flip — the recent `part_e2e_user_pool_expansion` left headroom; pool entries `henry + grace` (block-4 role-swap) are unused as of 2026-05-30).

Existing tests stay green:

- [ ] Every existing Vitest suite passes — the panel's eight-section node/edge branches are untouched.
- [ ] Every existing Cucumber feature passes (no backend change).
- [ ] Every existing Playwright block passes — the new block is additive and does not alter the prior blocks' seeds.

Build + scheduler:

- [ ] `pnpm -F @a-conversa/participant build` succeeds.
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green; Vitest baseline rises (~10 new cases). Playwright baseline rises by 1 block.
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100` lands on the task block.

WBS:

- [ ] `tasks/40-participant-ui.tji` task block at L221 gets `complete 100`.

Tech-debt registration:

- [ ] **`shell_package.extract_annotation_detail_view` (future task — ~0.5d, shell-package stream).** When a third surface (the audience's drill-down once it gains a panel, or a moderator-side `mod_entity_detail_panel`) needs the same kind/content/author/target/contradicts composition, the participant-local body lifts to `@a-conversa/shell` following the established third-caller pattern (`extract_facet_pill`, `extract_cytoscape_projectors`). Until then, no lift — Decision §2. Closer registers under `shell_package.*`; gated on a third caller (NOT a fixed-date scheduled task). The follow-up's milestone is whichever milestone the third caller falls under.

## Decisions

- **§1 — `lookupEntity` widens to take `annotations: readonly Annotation[]` as a third argument and return `Annotation | null` for the `'annotation'` arm. The panel's `EntityDetailPanelProps` widens by ONE prop (`annotations: readonly Annotation[]`) rather than threading a new bucketer.** Rationale:
  - **Symmetric with the existing helper signature.** `lookupEntity` already discriminates on `selection.kind` and walks `projectedNodes` / `projectedEdges` by id; the `'annotation'` arm becomes the third symmetric case. No new lookup helper, no new index shape.
  - **The route already memoizes `projectAnnotations(events)`** (the bucketed indices `nodeAnnotationIndex` / `edgeAnnotationIndex` are derived from it via `groupAnnotationsByNode` / `groupAnnotationsByEdge`). Threading the underlying `Annotation[]` adds one prop, not a new projection memo. The hoisted memo is already O(events).
  - **The bucketed indices are wrong-shape for this lookup.** They key by *target* entity id (what does this node have annotations from?), not by annotation id (what is this annotation's payload?). A flat `Annotation[]` + O(n) `find()` is the right input — the lookup is per-render-cycle and the array is bounded by the methodology's annotation budget per session (well under 1000 in practice).
  - **Alternative considered: introduce a new `annotationsById: ReadonlyMap<string, Annotation>` projection memo.** Rejected — premature optimization. The flat array's O(n) find is sub-microsecond for realistic n; introducing a Map costs route-level complexity for no measurable benefit.
  - **Alternative considered: thread an annotation lookup callback into the panel.** Rejected — couples the panel to the route's projection plumbing in a non-uniform way; the existing `projectedNodes` / `projectedEdges` props are passed as bare arrays, and the annotation array should match.

- **§2 — No shell-lift in this leaf. The annotation-detail body is participant-local, following the established third-caller rule.** Rationale:
  - **The participant is the first caller of "annotation entity drill-down."** The moderator surfaces annotations as canvas-side `<AnnotationBadge>` pills (a different surface — small inline kind label, no author/target/contradicts breakdown). The audience surfaces annotations as broadcast-overlay badges (also different). Neither has a panel-style drill-down today.
  - **Premature shell-lifting locks in shape choices.** The participant's needs (target-link navigation tied to `useSelectionStore`; contradicts-list over `projectedEdges`) are participant-specific; abstracting them into shell now risks an over-general interface that the eventual audience / moderator drill-down would have to either ignore or work around.
  - **The established pattern works.** [`extract_facet_pill`](../shell-package/extract_facet_pill.md) lifted on the third caller; [`extract_cytoscape_projectors`](../shell-package/extract_cytoscape_projectors.md) lifted on the third caller; this leaf adds a Tech-debt entry naming `shell_package.extract_annotation_detail_view` as the future lift point, gated on the third caller materializing.
  - **Alternative considered: import the moderator's `<AnnotationBadge>` from the shell-lifted `Annotation` type.** Rejected — `<AnnotationBadge>` is a tiny canvas-pill, not a panel-body. The shapes are different surfaces; reusing the badge as the panel body would render a single amber pill where structured prose is needed.
  - **Alternative considered: lift the panel body into shell preemptively.** Rejected — see "premature shell-lifting" above. Documented as the Tech-debt registration future-task.

- **§3 — The target-link row renders the target entity's label inline (statement wording for a node target, edge-role label for an edge target, annotation kind label for an annotation target). When the target is itself an annotation, clicking the link selects that annotation and the panel re-renders with the new annotation's detail body.** Rationale:
  - **The wire schema permits annotation-on-annotation.** `Annotation.targetNodeId` is a polymorphic UUID slot (per the annotation overlay chain refinement's documentation in [packages/shell/src/annotations/annotations.ts:121-135](../../../packages/shell/src/annotations/annotations.ts#L121)); the lookup falls through cleanly when the targeted id matches another annotation rather than a statement node.
  - **The participant's annotation-detail body is the natural chain-walking surface.** A debater inspecting "A2 (a reframe of A1)" can click through to A1 without leaving the panel; the existing canvas-level overlay propagation (the `part_annotation_of_annotation_overlay_chain` leaf) handles the symmetric overlay direction, but this panel surface handles the *downward* navigation (clicking from A2 to A1).
  - **The unknown-target fallback handles the snapshot-reload race.** When the target id matches neither a projected node, an edge, nor an annotation (the brief race between an annotation arriving and its target arriving), the row renders the localized `unknownTarget` label and the button is disabled. Defensive but rare in practice.
  - **Alternative considered: ONLY support node + edge targets; punt annotation-on-annotation to a follow-up.** Rejected — the lookup widens trivially (just walks the third array) and the navigation cycle naturally handles the chain; deferring would leave a real failure mode (annotation A2 targeting A1 renders an "unknown target" row even though A1 is in the projection).
  - **Alternative considered: render the target as a non-clickable label (no navigation).** Rejected — the panel's central interaction model is selection-driven; making the target navigable is consistent with every other entity-detail-panel surface and aligns with how a debater follows a structural narrative.

- **§4 — Per-kind chromatic theming is NOT applied to the annotation-detail section identity row. The kind label is textual ("Note" / "Reframe" / "Scope change" / "Stance"); the four-color palette lives on the Cytoscape graph-node only.** Rationale:
  - **The canvas already carries chromatic identity.** The annotation graph-node's amber / violet / teal / sky palette per `part_render_annotation_endpoint_edges` Decision §4 is the at-a-glance signal; once the debater taps through to the panel, the textual kind label is sufficient.
  - **Panel typography is uniform.** Every other panel section (FacetPillRow, AxiomMark, Annotations list, Diagnostics, Own vote, Other voters) uses the same neutral slate / amber palette; introducing a per-section chromatic header for the annotation-detail body would visually break the panel's information hierarchy.
  - **Localization affordances are clearer.** A localized text label is unambiguous across locales; a color is not. The participant audience is multilingual (the panel ships in en-US / es-419 / pt-BR).
  - **Alternative considered: apply the four-color palette as the identity-section border / accent.** Rejected — visually inconsistent with the rest of the panel; redundant with the canvas signal that the user just tapped.
  - **Alternative considered: render the kind label as a chromatic pill (mirroring the canvas-side `<AnnotationBadge>`).** Rejected — pill is a canvas-vocabulary primitive; the panel renders prose detail, not pills, for entity identity (the only pills in the panel are facet-status pills, which are a deliberately-shared moderator/participant vocabulary; the annotation-detail surface is participant-only).

- **§5 — Only the `contradicts` role gets a dedicated section in the annotation-detail body. Other roles (`supports`, `rebuts`, `clarifies`, `informs`, `qualifies`) that happen to anchor on the annotation are NOT surfaced as separate lists.** Rationale:
  - **`contradicts` is methodology-load-bearing on annotations.** The methodology surfaces "this annotation is contradicted by ..." as the canonical structural narrative for an annotation's controversy (per `docs/example-walkthrough.md` turn 21 — N19 contradicts A2). Surfacing the contradicting edges in the panel is the symmetric read affordance to the canvas-side rendering.
  - **Other roles are equally valid but visually noisy.** A "supports this annotation" or "clarifies this annotation" edge is structurally important too, but stacking N sections in the panel for each role bloats the panel; the user can navigate to the underlying edge to read its role label.
  - **The contradicts-only choice is bounded scope.** If a future leaf demonstrates that participants benefit from a generic "anchored edges" list (all roles), the section adds; today no usage data motivates the bloat.
  - **Alternative considered: render a generic "Anchored edges" list with one row per anchored edge regardless of role.** Rejected — visual density without proven need; the structurally distinguished `contradicts` lead loses signal-to-noise.
  - **Alternative considered: omit the contradicts section entirely; let the user navigate via the canvas.** Rejected — the canvas paints contradicting edges, but the panel is where the debater reads detail; failing to surface contradicting edges in the detail surface forces them back to the canvas to enumerate.

- **§6 — Stale-annotation branch reuses the existing `data-state="stale"` body and auto-clear `useEffect`. The placeholder branch's `selected.kind !== 'annotation'` exclusion in the `useEffect` is removed.** Rationale:
  - **The existing stale branch is correct for annotations too.** Annotation deletion isn't a wire kind today, but the snapshot-reload race (selection persists across reload before the snapshot replays the annotation-created event) is the same race the node/edge branch handles. The localized stale-entity body and auto-clear behavior are identical.
  - **Removing the placeholder-era `useEffect` carve-out simplifies the panel.** The carve-out at [EntityDetailPanel.tsx:418](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L418) existed precisely to prevent the auto-clear from firing during the predecessor's placeholder branch (where the entity-lookup always returned null and the selection was deliberately retained). With the real body in place, the carve-out is dead code.
  - **Alternative considered: a dedicated `data-state="annotation-stale"` body.** Rejected — duplicates the body and the localization keys without benefit; the user-visible message ("this element is no longer present") applies identically.

- **§7 — Selection navigation from the target-link / contradicts-link writes directly to the store via `useSelectionStore.getState().select(...)`; no new prop, no callback thread.** Rationale:
  - **The panel is already a store consumer** (it subscribes via `useSelectionStore((s) => s.selected)` at [EntityDetailPanel.tsx:382](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L382)). Writing back to the store from the same component is the simplest pattern.
  - **The canvas's `:selected` overlay updates via the standard subscription.** When the store changes, the Cytoscape mount's subscription handler updates the selected element; no special bridging needed between the panel and the canvas.
  - **Alternative considered: thread a callback prop (`onSelect`) into the panel.** Rejected — adds prop surface for a behavior that's already addressable via the store; the existing tap-handler on the canvas writes directly to the store too, so the symmetric write from the panel matches the established pattern.

- **§8 — No new ADR. The annotation-detail body is presentation work within the established panel architecture (ADR 0026 — no shell export until the third caller; ADR 0027 — entity-layer attributes only; ADR 0024 — i18n via react-i18next).** Rationale:
  - **No new architectural commitment.** The lookup widening, the section bodies, and the navigation are engineering choices documented in Decisions; no cross-cutting policy is established.
  - **The third-caller rule for shell-lifting is already an ADR-level pattern.** ADR 0026 documents it; this leaf honors it without amending.
  - **Alternative considered: an ADR formalizing "panel surfaces own their entity-detail bodies."** Rejected — overgeneralizes; each entity-kind's body is shaped by the entity's methodology semantics, not a universal panel pattern.

## Open questions

(none — all decided in §1–§8.)

## Status

**Done** — 2026-05-30.

- Replaced the placeholder annotation panel branch in `apps/participant/src/detail/EntityDetailPanel.tsx` with a structured 5-section detail view: AnnotationIdentity / Content / Author / Target / Contradicts; added 2 resolver helpers and nodeOrEdge type narrowing.
- Widened `apps/participant/src/detail/lookupEntity.ts` to accept a third `annotations: readonly Annotation[]` argument; the `'annotation'` arm now resolves to the matching record or `null`; return type widens to `ParticipantNodeData | ParticipantEdgeData | Annotation | null`.
- Threaded the `annotations` prop through `apps/participant/src/routes/OperateRoute.tsx` to the panel.
- Added 7 new Vitest cases (annotation-a..g) in `apps/participant/src/detail/EntityDetailPanel.test.tsx` and a `renderPanel` optional-prop spread fix; added annotation-arm cases in `apps/participant/src/detail/lookupEntity.test.ts`.
- Extended block 12 (`leo` / block-6 role-swap) in `tests/e2e/participant-graph-render.spec.ts` with annotation body assertions + target-link click round-trip + `participant-joined` actor seed; the refinement-scoped block-4 was folded here because the 12-user pool is exhausted (all blocks 1–12 use distinct pairs; `henry + grace` is claimed by block 10).
- Added i18n keys `participant.detailPanel.identity.annotation`, `annotation.sectionTitle.{content,author,target,contradicts}`, `annotation.unknownTarget` across all three locales (`packages/i18n-catalogs/src/catalogs/{en-US,es-419,pt-BR}.json`); removed the now-dead `annotation.detail.placeholder` key.
- Registered tech-debt task `shell_package.extract_annotation_detail_view` (~0.5d) in `tasks/27-shell-package.tji`, wired to M7; registered `participant_ui.part_graph_view.part_e2e_user_pool_expansion_v2` (~0.5d) in `tasks/40-participant-ui.tji`, wired to M10.
