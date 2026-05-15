# Moderator hover details (popover on nodes and edges)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_hover_details` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 0.5d (confirmed; the project reuses the existing `data-*` seams, existing i18n keys, and existing test-mount idioms — no new dependency, no new catalog key, no new positioning library)

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their contracts):

- `moderator_ui.mod_graph_rendering.mod_node_rendering` (done — `<StatementNode>` is the custom ReactFlow node card; the per-node `data` carries `wording`, `kind`, `annotations`, `facetStatuses`, `axiomMarks`, `votesByFacet`, `diagnosticHighlight`).
- `moderator_ui.mod_graph_rendering.mod_edge_rendering` (done — `<StatementEdge>` is the custom ReactFlow edge; the per-edge `data` carries `role`, `annotations`, `facetStatuses`, `diagnosticHighlight`).
- `moderator_ui.mod_graph_rendering.mod_per_facet_state_visualization` (done — pinned the canonical `FACET_RENDER_ORDER` (`wording → classification → substance`) and the per-facet pill row idiom).
- `moderator_ui.mod_graph_rendering.mod_axiom_mark_decoration` (done — pinned the per-participant `axiomMarkColorFor` palette and the `AxiomMarkBadge` "I'm a decoration the popover should mirror" surface).
- `moderator_ui.mod_graph_rendering.mod_selection` (done — hover composes with click-to-select: click still fires the existing `onNodeClick` / `onEdgeClick` handlers in `GraphCanvasPane`. Hover does NOT consume click).
- `moderator_ui.mod_graph_rendering.mod_context_menus` (done — right-click composes with hover. The popover is dismissed when the context menu opens; right-click on a hover-popover'd entity does not double-render two floating surfaces).
- `moderator_ui.mod_graph_rendering.mod_diagnostic_highlighting` (done — the most recent moderator graph addition. **Established the native `title` baseline** that this task supersedes for the rich-card path; the popover surfaces the full diagnostic title + severity per kind in a richer layout than `title` can give. The `title` attribute is removed from the entities this popover covers — the popover IS the hover affordance, not a duplicate).
- `frontend_i18n.i18n_methodology_glossary` (done — `methodology.kind.*`, `methodology.edgeRole.*`, `methodology.facetState.*`, `methodology.facet.*`, `methodology.voteIndicator.*`, `methodology.axiomMark.*` already resolve in en-US / pt-BR / es-419).
- `frontend_i18n.i18n_diagnostic_descriptions` (done — `diagnostics.<kind>.title` already resolves in all three locales; the popover reuses these keys).

Pending edges (this task does NOT depend on them):

- `moderator_ui.mod_graph_rendering.mod_layout_engine_choice` — orthogonal (different rendering axis).
- `moderator_ui.mod_graph_rendering.mod_pan_zoom` — orthogonal.

## What this task is

When the moderator hovers a node or an edge on the graph canvas — or focuses one via keyboard — a **detail popover** surfaces beside the entity showing the methodology-relevant context the canvas card / edge label had to truncate. The popover is transient: appears on `mouseenter` / `focus-visible`, disappears on `mouseleave` / `blur` (with a short grace period — see Decisions). It does NOT consume click — `pointer-events: none` is on the popover root so a left-click flows straight through to ReactFlow's `onNodeClick` / `onEdgeClick` handlers that drive `useSelectionStore` (per `mod_selection`). A right-click on the entity opens the existing `GraphContextMenu` and dismisses the popover.

Concretely, this task lands:

1. **A new `<HoverPopover>` component** at `apps/moderator/src/graph/HoverPopover.tsx` that accepts a `target: { kind: 'node' | 'edge'; id: string }` plus the snapshot of the relevant `data` from the projection (`StatementNodeData` for nodes, `StatementEdgeData` for edges) and renders a floating panel positioned **relative to the hovered entity's DOM element**. The popover is rendered as a child of the same `data-testid="statement-node-<id>"` root (for nodes) or `data-testid="graph-edge-label-<id>"` root (for edges) so positioning is purely CSS — `position: absolute; bottom: calc(100% + 4px); left: 0;` — no positioning library, no portal, no Floating UI dependency. The relative-position parent already exists for both surfaces (the node root is the relative anchor; the edge label is positioned absolute via `<EdgeLabelRenderer>` and we layer the popover as a sibling child of that label container).

2. **Per-target content templates** inside `<HoverPopover>`:
   - **Node target**: rendered sections, top-to-bottom:
     - `wording` — full untruncated paragraph from `data.wording` (the canvas card may wrap at `max-w-[18rem]`; the popover uses `max-w-[24rem]` so a long wording reads in fewer line wraps).
     - `kind` row — localized via `t('methodology.kind.<kind>')`; em-dash when `kind === null` (mirrors the card's null-kind placeholder).
     - **Per-facet status summary** — a compact glyph row using the canonical `FACET_RENDER_ORDER` (`wording → classification → substance`) from `mod_per_facet_state_visualization`. Each facet that has a status renders a glyph: the localized facet name (`t('methodology.facet.<facet>')`) plus the localized facet state (`t('methodology.facetState.<status>')`). Statuses absent from `data.facetStatuses` are omitted (mirrors the card's pill-row "no empty container" rule). The summary reuses `data.facetStatuses` already on `StatementNodeData` — no new projection.
     - **Axiom-mark line** — if `data.axiomMarks.length > 0`, render a localized "Marked as axiom by N participants" line (reuses the count from the already-projected `data.axiomMarks` array). The list of participant short identifiers is rendered via the same `axiomMarkColorFor(participantId).text` palette, so a moderator scanning the popover sees the same per-participant color the badge row used. If `length === 0`, the line is omitted.
     - **Active-diagnostic line** — if `data.diagnosticHighlight !== undefined`, render the severity (localized) + one `t('diagnostics.<kind>.title')` per `kinds[i]`, separated by `", "`. Mirrors the existing `title`-attribute string `mod_diagnostic_highlighting` stamps today but with proper layout (severity on its own row above the kind list) rather than crammed into a single attribute value.
   - **Edge target**: rendered sections, top-to-bottom:
     - **Role line** — localized via `t('methodology.edgeRole.<role>')` (matches the edge-label pill's existing rendering, but with the headline visual emphasis).
     - **Endpoints line** — `source → target`. Resolve the localized "from / to" framing through a new ICU template (see "i18n" below) and render each node's wording (truncated to the first 60 chars + `…` if longer). Source / target ids are NOT shown — the moderator already sees ids as the entity is on the canvas; the wording is the load-bearing recall.
     - **Per-facet status summary** — substance only (edges carry only the substance facet in v1, per the existing `<StatementEdge>` rendering). Localized facet name + state, same idiom as the node.
     - **Active-diagnostic line** — same shape as the node's.

3. **Hover state lives on the entity component, not on a Zustand store.** Each `<StatementNode>` / `<StatementEdge>` carries a `useState<boolean>` hover flag toggled by `onMouseEnter` / `onMouseLeave` / `onFocus` / `onBlur` on the same root that already stamps `data-selected` / `data-facet-status`. The `<HoverPopover>` is rendered as a child conditionally on the flag. No store-level coupling — the open-popover position is a transient UI fact tied to one component's lifetime, mirroring the `mod_context_menus` decision to keep menu position in `useState` rather than a slice.

4. **Resolving the source/target wording for the edge popover.** The edge popover needs to render the wordings of its source and target nodes, but `StatementEdgeData` today carries only `role` / `annotations` / `facetStatuses` / `diagnosticHighlight`. We extend it with `sourceWording: string` and `targetWording: string`. `selectEdgesForSession` enriches each emitted `Edge` with the wordings by walking the `node-created` event log once up-front (the same loop that already projects edges from `edge-created`), building a `Map<nodeId, wording>`, and looking up the source/target wordings as each `edge-created` event is mapped. The map is built from `edit-wording` commit events too, so a node whose wording was edited surfaces the current value (mirrors how `projectNodes` updates `data.wording` — actually `projectNodes` doesn't currently update wording on edit either, but the projection helper reuses the same `editWordingTextFor(events, nodeId)` semantics as the rest of the moderator graph: latest committed `edit-wording` wins, otherwise the original `node-created` payload). If a node referenced by the edge has not been created yet (would be a wire-protocol violation but defensible), the wording falls back to `'—'`.

5. **A11y: focus-visible parity.** The same node card root + edge label that carry `onMouseEnter` / `onMouseLeave` also accept `onFocus` / `onBlur`. The root carries `tabIndex={0}` (already on the node card from `mod_selection`'s ReactFlow keyboard navigation — confirmed in `StatementNode.tsx`; if not present, this task adds it on both surfaces). Focus-visible (the `:focus-visible` CSS pseudo) drives the same hover flag, so a keyboard user navigating between nodes / edges with Tab sees the same popover. The popover is rendered with `role="tooltip"` and the entity's root carries `aria-describedby="hover-popover-<id>"`, so screen readers announce the popover content when focus lands.

6. **The popover is `pointer-events: none`.** Click / mousedown / mouseup events flow through the popover to the entity below. This means: (a) ReactFlow's `onNodeClick` / `onEdgeClick` continue to fire (selection still works), (b) right-click still hits the entity and opens `GraphContextMenu`, (c) the popover cannot be "interactively clicked into" — there are no interactive elements inside it (no buttons, no links), only display content. If a future task wants interactive content in the popover (e.g. "open detail" link), it MUST switch to a different pattern (e.g. a click-pinned panel) — this is documented in the popover's JSDoc as a constraint.

7. **Hover-enter delay and hover-leave grace period.** `mouseenter` fires the `setShowPopover(true)` immediately (no delay — the moderator's intent on entering a node is clear; a delay reads as latency). `mouseleave` fires `setShowPopover(false)` immediately too — no grace period, no `setTimeout` (the simpler-is-better default; if "pop flicker" turns out to be a real complaint after this task lands, a follow-up task can add a short grace window). The `mod_diagnostic_highlighting` task's native `title` baseline has no hover-enter delay either; this task matches that behavior.

8. **Removing the `mod_diagnostic_highlighting` native `title`.** The native `title` attribute the diagnostic-highlighting task stamped on `<StatementNode>` and `<StatementEdge>` is REMOVED by this task. Reason: the popover surfaces the same diagnostic content in a richer layout; leaving `title` in place would mean two competing tooltips race on hover (native `title` on a delay, our popover instantly). The popover IS the hover affordance now. The `data-diagnostic-severity` attribute STAYS — it's the test seam for the amber halo, independent of the popover.

9. **Reactive updates while the popover is open.** Same as today: ReactFlow re-renders the node / edge whenever its `data` reference changes; the popover is a child of that component so it re-renders with the latest `data` automatically. If a `diagnostic-fired` envelope lands while the moderator is hovering a node, the popover gains an active-diagnostic line on the next render without any extra plumbing.

10. **Performance: no popover rendered when nothing is hovered.** The hover flag defaults to `false`; the `<HoverPopover>` JSX is gated by `{showPopover ? <HoverPopover ... /> : null}`. When an entity is removed from the projection (e.g. session reset, sub-event that didn't actually happen but a future feature may add) the component unmounts and the hover state goes with it — no risk of a stale popover.

This task is rendering only. It does NOT add hover-driven actions, does not surface a "pin popover open" gesture, does not add a positioning library, does not introduce a new i18n catalog namespace, does not change the methodology-state styling layer.

## Why it needs to be done

The canvas card and the edge label are visually compact by design — the card's `max-w-[18rem]` wording wraps after a couple of lines; the edge label is a single line. Statements in real moderation sessions are routinely 2–4 sentences long. Today the only way to read a node's full wording is to open the right sidebar's per-entity detail (per `mod_right_sidebar`'s scope), which requires a click + a context switch off the canvas. The hover popover is the **low-friction** "show me what I'm pointing at" surface every desktop graph editor offers; it lets the moderator scan the canvas, hover a node whose wording is wrap-truncated, read the full content without leaving the canvas, and move on.

The same applies to edges: the role label says "Supports" but the moderator scanning a dense subgraph wants to read "Supports from <data wording> to <claim wording>" to make sense of why this edge is here. Forcing a click-to-select + sidebar-read for every "what does this edge connect?" question is friction the canvas should absorb.

Closing `mod_hover_details` closes 14/16 of `mod_graph_rendering`'s children. The remaining open leaves — `mod_layout_engine_choice`, `mod_pan_zoom` — are orthogonal axes (positioning algorithm, zoom polish) and can land independently; their completion unblocks `mod_capture_flow` → M4.

## Inputs / context

Code seams the implementation plugs into:

- `apps/moderator/src/graph/StatementNode.tsx:191-392` — `<StatementNode>` body. Adds `onMouseEnter` / `onMouseLeave` / `onFocus` / `onBlur` to the root `<div>`, plus the conditional `<HoverPopover>` render. The existing `data-testid="statement-node-<id>"` root is the relative-position anchor.
- `apps/moderator/src/graph/StatementEdge.tsx:195-233` — `<StatementEdge>`'s `<EdgeLabelRenderer>` child. Adds the same hover handlers to the role-label div + the conditional `<HoverPopover>` sibling inside the existing `flex flex-col items-center gap-0.5` container.
- `apps/moderator/src/graph/StatementNode.tsx:296-321` — the `diagnosticTitle` block + the `title` attribute on `rootProps`. **Removed** by this task — the popover surfaces the same content in a richer layout.
- `apps/moderator/src/graph/StatementEdge.tsx:170-188` — the symmetric `diagnosticTitle` block + the `title` attribute on `labelDataAttrs`. **Removed** by this task.
- `apps/moderator/src/graph/selectors.ts:62-89` — `StatementEdgeData`. Gains `sourceWording: string` + `targetWording: string`. `selectEdgesForSession` enriches both fields by walking the events log to build a per-node wording map.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:284-416` — `projectNodes`. No changes needed (the node data shape already carries everything the popover renders).
- `apps/moderator/src/graph/GraphCanvasPane.tsx:497-520` — `selectEdgesForSession` invocation. Unchanged signature; the enrichment is internal to the selector.

ADRs:

- [ADR 0004 — Graph libraries](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow's `<EdgeLabelRenderer>` is the official portal for HTML overlays anchored on edge geometry; the popover layers as a sibling of the role-label inside that portal. Custom node components are the canonical extension point for per-node interaction.
- [ADR 0005 — Tailwind](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the popover uses Tailwind utilities exclusively; no new CSS file, no design-tokens additions.
- [ADR 0008 — Playwright + compose](../../../docs/adr/0008-e2e-framework-playwright.md) — the e2e spec runs against the compose stack via the existing `loginAs` fixture; no new infrastructure.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case OR a committed Playwright spec.
- [ADR 0024 — Frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation` resolves every popover string from the catalog.

Refinements consulted for design continuity:

- `tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md` — the most-recent moderator graph addition; established the `data-diagnostic-severity` seam and the native `title` baseline this task supersedes for the rich-card path. Also the prior art for "compose another visual layer on top of existing decorations without overwriting any of them."
- `tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md` — the canonical `FACET_RENDER_ORDER` the popover reuses for its per-facet section.
- `tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md` — the per-participant color palette the popover reuses for axiom-mark participant identifiers.
- `tasks/refinements/moderator-ui/mod_selection.md` — pinned the click-to-select gesture the popover must NOT consume.
- `tasks/refinements/moderator-ui/mod_context_menus.md` — pinned the right-click gesture the popover must dismiss in favor of.
- `tasks/refinements/moderator-ui/mod_annotation_rendering.md` — established the "native `title` is the cheap baseline; `mod_hover_details` is the rich superseder" pattern for hover content.

No new ADR is required: the task adds no new dependency (no Floating UI, no Popper, no Radix-Tooltip), uses Tailwind utilities already in the moderator bundle, reuses every i18n catalog key the popover surfaces (except the new ICU template described under "i18n"), and reuses every per-entity data field already on `StatementNodeData` / `StatementEdgeData` (modulo the two new wording fields on `StatementEdgeData`).

## Constraints / requirements

### Component shape

- **File**: `apps/moderator/src/graph/HoverPopover.tsx`. Exports `HoverPopover` (the component) and `HoverPopoverProps` (the prop type).
- **Props**:
  ```ts
  export interface HoverPopoverProps {
    readonly id: string; // entity id; drives `aria-describedby`
    readonly target:
      | { kind: 'node'; data: StatementNodeData }
      | { kind: 'edge'; data: StatementEdgeData };
  }
  ```
- **DOM shape**: a single absolute-positioned `<div role="tooltip">` with `id="hover-popover-<id>"`, `data-testid="hover-popover-<id>"`, `data-hover-target-kind="<node|edge>"`, `pointer-events: none`, plus per-section children. The popover is `position: absolute; bottom: calc(100% + 4px); left: 0; z-index: 10` — anchored to the immediately-above-the-entity space. If the entity is near the top of the viewport this overflows the canvas — accepted as a v1 trade-off (alternatives are: a positioning library = ADR-worthy and rejected here, or flipping `bottom` ↔ `top` based on a `getBoundingClientRect` measurement = JS + a re-render-on-resize loop, which is the next-cheapest option but still more code than the v1 popover needs). Document the trade-off in the component JSDoc with a forward reference to a future `mod_hover_details_flip_on_clip` follow-up task IF the simple anchored version turns out to clip in real moderation sessions.
- **Sizing**: `max-w-[24rem] min-w-[16rem]` so the popover reads comfortably without growing past two-thirds of a typical viewport.
- **Styling**: `rounded-md border border-slate-300 bg-white shadow-lg px-3 py-2 text-sm text-slate-900 space-y-1`. The visual distinguishes from the card frame (the card is `shadow-sm`, the popover is `shadow-lg`) so the layering reads as "this is in front of the canvas."

### Hover wiring on `<StatementNode>`

- Add `useState<boolean>(false)` for the hover flag.
- Bind `onMouseEnter={() => setIsHovered(true)}` and `onMouseLeave={() => setIsHovered(false)}` to the root `<div>` that already carries `data-testid="statement-node-<id>"`.
- Bind `onFocus` / `onBlur` to the same root so keyboard focus drives the popover. Add `tabIndex={0}` if not already present (verify against the current `StatementNode.tsx`; the existing selection ring suggests focus is already a thing but the explicit tabIndex may be missing).
- Render `{isHovered ? <HoverPopover id={id} target={{ kind: 'node', data }} /> : null}` as the LAST child inside the card root (after the annotation-badge row), so its absolute positioning anchors to the card root's relative-position frame.
- Stamp `aria-describedby={isHovered ? \`hover-popover-${id}\` : undefined}` on the card root.

### Hover wiring on `<StatementEdge>`

- Same `useState<boolean>` flag inside `StatementEdgeImpl`.
- Bind `onMouseEnter` / `onMouseLeave` / `onFocus` / `onBlur` to the role-label div that already carries `data-testid="graph-edge-label-<id>"`. The role-label is the visible interactive surface (the `<BaseEdge>` SVG path is not directly hover-targetable for HTML overlays; this is the same compositional decision `mod_selection` and `mod_diagnostic_highlighting` made for the same reason).
- Add `tabIndex={0}` to the role-label div so keyboard focus can reach it (verify the existing div — `mod_selection`'s implementation already implies a focusable surface).
- Render `{isHovered ? <HoverPopover id={id} target={{ kind: 'edge', data }} /> : null}` as a sibling inside the existing `flex flex-col items-center gap-0.5` container, BELOW the annotation badge row. The popover's absolute positioning anchors to the role-label's relative-position context (the role-label is `position: relative` implicitly via its `relative` class — wait, it's not relative. The popover anchors instead to the `nodrag nopan flex flex-col items-center gap-0.5` container which IS the position-context inside the `<EdgeLabelRenderer>`'s `position: absolute` portal). Verify the anchor relationship works under happy-dom and Playwright.

### Selector enrichment for edge endpoints

- Extend `selectEdgesForSession(state, sessionId, highlights?)` to:
  - Build a `wordingByNodeId: Map<string, string>` in the same pass it currently walks events for `edge-created`. Pre-populate from every `node-created` event (`wordingByNodeId.set(event.payload.node_id, event.payload.wording)`). Update on every committed `edit-wording` proposal (the same proposal/commit pair the node projection currently uses for `classify-node` — but `selectEdgesForSession` doesn't currently process `edit-wording` commits; it does for THIS task, with the projection logic mirrored from `projectNodes`'s `classify-node` pass). If `edit-wording` isn't yet committed-handled in `projectNodes`, that's a separate task — for THIS task the projection accepts the original `wording` from `node-created` and ignores commits, matching today's `projectNodes` semantics. Document in a JSDoc note that the popover's wording will lag a committed wording edit until `mod_capture_flow.mod_edit_wording_flow` lands.
  - For each `edge-created` event, look up source and target wordings from the map; default to `'—'` for any id not yet in the map.
- Extend `StatementEdgeData`:
  ```ts
  export interface StatementEdgeData {
    role: EdgeRole;
    annotations: readonly Annotation[];
    facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>;
    diagnosticHighlight?: DiagnosticHighlight;
    sourceWording: string;
    targetWording: string;
  }
  ```
  The two new fields are NON-optional — they're always populated by the selector (the `'—'` fallback is a string, not `undefined`). This keeps the popover renderer's null-check surface small.

### Removing the native `title` from the diagnostic-highlighting baseline

- Remove the `diagnosticTitle` const and the `title:` field of `rootProps` in `StatementNode.tsx`.
- Remove the symmetric `diagnosticTitle` + the `title:` field of `labelDataAttrs` in `StatementEdge.tsx`.
- Leave the `data-diagnostic-severity` attribute stamping intact — it's the test seam for the amber halo, independent of the hover surface.
- Update `mod_diagnostic_highlighting.md`'s **Status** section is left untouched (immutable historical record per `tasks/refinements/README.md`); the contract change is captured in THIS refinement's Decisions and Status sections. The two test cases in `StatementNode.test.tsx` / `StatementEdge.test.tsx` that assert `title="Cycle"` etc. are updated to assert the same content lives inside the `<HoverPopover>` instead — the assertion moves, the contract content stays the same.

### i18n

Reused keys (no new namespace entries beyond the one new ICU template):

- `methodology.kind.<id>` — node classification.
- `methodology.edgeRole.<id>` — edge role.
- `methodology.facet.<id>` — `wording` / `classification` / `substance` localized.
- `methodology.facetState.<id>` — `proposed` / `agreed` / `disputed` / `meta-disagreement`. **Note**: today's catalog has `meta-disagreement` but not `committed` or `withdrawn` under `facetState`. The popover renders only the four `facetState`-mapped statuses; `committed` and `withdrawn` fall back to the wire identifier with a Tailwind `text-slate-400` styling so the missing-translation case is visually distinguishable. **If a real session in pt-BR / es-419 ends up with a `committed` facet rendered through the popover, the bare wire identifier is what shows — flag for a future catalog-extension task `i18n_facet_state_completion` which is out of scope here.** This is the established pattern from `mod_per_facet_state_visualization` (the facet pill renders unstyled-fallback for `committed` / `withdrawn` for the same reason).
- `methodology.axiomMark.label` / `methodology.axiomMark.tooltip` — the axiom-mark localized text the popover line reuses for the "Marked as axiom by …" phrasing. **Existing** `methodology.axiomMark.tooltip` = `"Axiom marked by {participantId}"`; the popover line uses the same template for each participant in the list. No new key needed.
- `diagnostics.<kind>.title` — diagnostic kind title.
- `diagnostics.severity.blocking` / `diagnostics.severity.advisory` — **CHECK CATALOG**. If these don't exist yet, render the wire identifier with Tailwind `text-slate-400` (the missing-translation pattern above). The diagnostic-highlighting refinement did not add severity-level localized strings — the popover documents this gap and renders the bare `'blocking'` / `'advisory'` until a follow-up catalog task lands them. **Acceptable for v1** because the visual amber-halo (blocking = bigger ring + pulse; advisory = thinner ring) already communicates severity to the moderator; the popover's severity-text-line is a redundancy, not the sole signal.

**One new ICU template** added to all three locale catalogs (the only catalog change in this task):

- `moderator.hoverPopover.edgeEndpoints` — ICU template for the edge popover's source→target framing.
  - en-US: `"{role}: \"{sourceWording}\" → \"{targetWording}\""`
  - pt-BR: `"{role}: \"{sourceWording}\" → \"{targetWording}\""`
  - es-419: `"{role}: \"{sourceWording}\" → \"{targetWording}\""`
  - The template is identical across locales because the `{role}` substitution carries the locale-correct role label and the `{sourceWording}` / `{targetWording}` carry user-authored content; only the punctuation differs across locales and `:` / `→` / `"` are punctuation-neutral. If a future locale needs different framing (e.g. RTL languages, locale-specific quotation marks), the template grows per-locale variants then.
  - Wording is truncated to the first 60 characters (with a `…` suffix) before being substituted; the truncation is a JS-side concern, not the catalog's. The 60-char cap balances "enough to read" with "fits on one popover line."

If reading the existing catalogs reveals that a key listed above does NOT in fact exist (other than the `moderator.hoverPopover.edgeEndpoints` template explicitly added), STOP and report — do NOT add unreviewed catalog content. The orchestrator instructed: "Reuse existing keys; if you need text not yet in the catalog, stop and report." The one explicit exception is `moderator.hoverPopover.edgeEndpoints`, which is mechanical punctuation-only across locales and well within the "no review needed" envelope.

Update `packages/i18n-catalogs/src/methodology.test.ts` (or the equivalent catalog round-trip test) to extend its `METHODOLOGY_VALUES` (or `MODERATOR_VALUES`) array with the new key so the parity check covers it automatically — the established pattern from `mod_vote_indicators_on_graph` and `mod_context_menus`.

### A11y

- The popover carries `role="tooltip"` and `id="hover-popover-<id>"`.
- The entity root carries `aria-describedby="hover-popover-<id>"` ONLY when the popover is open. Adding `aria-describedby` to a node/edge that doesn't have a corresponding open tooltip would be an a11y lie (assistive tech reports "this element is described by X" when X isn't rendered).
- Focus on the entity (node or edge surface) is the keyboard-equivalent of hover — `onFocus` opens the popover, `onBlur` closes it. The same surface is `tabIndex={0}` so keyboard users can Tab through entities.
- The popover content is NOT focusable internally (no interactive children); this is consistent with `pointer-events: none` + `role="tooltip"` (a tooltip is not a focus stop per WAI-ARIA).
- Add a CSS rule (in the popover's Tailwind classes or a small `.css` block in the component) that hides the popover when `prefers-reduced-motion: reduce` is set IF the popover gains any animation. The v1 popover has NO animation (it's an instantaneous show / hide), so no special handling is needed today — but document the constraint in JSDoc.

### Performance

- The popover's `<HoverPopover>` is mounted only while the entity is hovered/focused; an un-hovered card has zero popover DOM. ReactFlow's "render edges on every viewport pan/zoom" cost is bounded — the popover renders are scoped to the hovered entity only.
- The popover does not subscribe to Zustand. It reads from props (the parent's `data`). No new store reads, no new selectors.
- The new `wordingByNodeId` walk inside `selectEdgesForSession` is `O(N_events)` — same big-O as the existing walk, just with one more `Map.set` per `node-created` event. The selector is already memoized in `GraphCanvasPane.tsx` via `useMemo([sessionId, events, diagnosticHighlights])`; no memo-dependency changes are needed.

### Tests (committed, per ADR 0022)

All listed tests are pre-decided as the Acceptance bar.

**New file `apps/moderator/src/graph/HoverPopover.test.tsx`** — direct render of `<HoverPopover>` with hand-built `data`. Cases:

- Node target with all-`undefined`-optional `data`: renders the wording paragraph, em-dash kind placeholder, no facet rows, no axiom-mark line, no diagnostic line.
- Node target with a non-null `kind`: renders the localized kind via `t('methodology.kind.<kind>')` (3 locale cases × at least one kind = 3 cases).
- Node target with `facetStatuses: { substance: 'disputed' }`: renders a single facet row with localized facet name + state.
- Node target with multiple facet statuses present: renders rows in `FACET_RENDER_ORDER` (`wording → classification → substance`).
- Node target with `axiomMarks` length 2: renders the localized "Marked as axiom by 2 participants" line + per-participant color-coded participant ids.
- Node target with `diagnosticHighlight: { severity: 'blocking', kinds: ['cycle', 'contradiction'] }`: renders severity + both kind titles joined with `", "`.
- Edge target with `role: 'supports'`, `sourceWording: 'A'`, `targetWording: 'B'`: renders the localized "Supports: A → B" string via the new ICU template (3 locales × the same role = 3 cases).
- Edge target with a `sourceWording` length > 60: renders truncated with `…` suffix.
- Edge target with `facetStatuses: { substance: 'agreed' }`: renders the substance facet row.
- `role="tooltip"` is on the popover root; the `id` matches the prop pattern.
- `data-testid="hover-popover-<id>"`, `data-hover-target-kind="node"|"edge"` are stamped.
- `pointer-events: none` is on the popover root (assert via the inline-style serialization or the Tailwind utility class).

**Extension to `apps/moderator/src/graph/StatementNode.test.tsx`** — hover-popover wiring:

- `mouseenter` on the card root sets `isHovered=true` and renders `<HoverPopover>` (assert via `data-testid="hover-popover-<id>"`).
- `mouseleave` clears it.
- `focus` on the card root opens the popover; `blur` closes it.
- `aria-describedby` is `"hover-popover-<id>"` when open, absent when closed.
- The card root retains `data-selected` / `data-facet-status` / `data-diagnostic-severity` stamps with the popover present (no regression on the existing seams).
- The `title` attribute is NO LONGER stamped on the card root for the diagnostic-highlight case (the popover supersedes it). One updated case: a node with `diagnosticHighlight: { kinds: ['cycle'] }` and hover open renders the localized "Cycle" string inside the popover, NOT in the root's `title`.

**Extension to `apps/moderator/src/graph/StatementEdge.test.tsx`** — hover-popover wiring:

- `mouseenter` on the role-label div opens the popover; the popover content is rendered as a sibling inside the `<EdgeLabelRenderer>` portal.
- The popover renders the ICU-templated edge-endpoints line via `sourceWording` / `targetWording` from `data`.
- The role-label retains `data-facet-status` / `data-selected` / `data-diagnostic-severity` stamps with the popover present.
- The `title` attribute is NO LONGER stamped on the role-label for the diagnostic-highlight case.

**Extension to `apps/moderator/src/graph/selectors.test.ts`** — edge endpoint enrichment:

- An `edge-created` event whose `source_node_id` and `target_node_id` reference existing `node-created` events emits an `Edge` with `data.sourceWording` and `data.targetWording` matching the node wordings.
- An `edge-created` event whose source or target hasn't been created yet emits an `Edge` with `data.sourceWording` / `data.targetWording` defaulting to `'—'` (the documented fallback).
- The two new fields are deterministic across multiple calls on the same events array (purity check).

**Extension to `apps/moderator/src/graph/GraphCanvasPane.test.tsx`** — end-to-end:

- With one `node-created` + one `edge-created`, the projected `Edge<StatementEdgeData>` carries the source/target wordings via the canvas wiring.
- (No additional canvas-level hover cases — the hover behavior tests live on the component files.)

**Extension to the i18n catalog round-trip test** (`packages/i18n-catalogs/src/methodology.test.ts` or the equivalent moderator namespace test):

- The new `moderator.hoverPopover.edgeEndpoints` template resolves in en-US / pt-BR / es-419 and contains the expected `{role}`, `{sourceWording}`, `{targetWording}` ICU substitution points.

### Acceptance criteria — Playwright e2e spec

**Required by the UI-stream e2e policy in ORCHESTRATOR.md.** The moderator graph canvas IS reachable from a moderator session at `/sessions/:id/operate` (mod_shell + mod_layout + mod_graph_canvas_pane are complete; the operate route is rendered by `apps/moderator/src/routes/Operate.tsx`). Hover behavior is observable in a browser; Playwright captures it.

**New file**: `tests/e2e/moderator-hover-details.spec.ts`. Runs under a new project entry in `playwright.config.ts` (`chromium-moderator-hover` — single locale, en-US, for a deterministic content-text assertion baseline; the per-locale matrix is owned by the existing `chromium-<locale>` smoke spec — this new spec is content-deterministic in one locale). Reuses the existing `loginAs` fixture from `tests/e2e/fixtures/auth.ts` to drive the OIDC handshake.

Spec layout:

1. **Setup**: `loginAs(page, { username: 'alice' })`. Then `page.request.post('/sessions', { data: { ... } })` to create a fresh debate session (the helper or inline request — the session-creation endpoint is `POST /sessions` per `apps/server/src/sessions/routes.ts`). Capture the new session id. Then drive the moderator-side capture flow to commit ONE node and ONE edge into the session — the cheapest path is to send the WS messages directly via the page's authenticated WS connection, OR POST to a test-only seed endpoint if one exists. **If no seed mechanism exists for Playwright drives today**, the spec stops at the moderator route load and asserts the canvas IS reachable + an empty canvas renders the popover-less state correctly — and adds a comment marking the test as "deferred-full-content" pending a future `playwright_session_seed_helper` task. The orchestrator's policy requires the spec to be scoped; "deferred for lack of seed infrastructure" with a named follow-up is acceptable per the ORCHESTRATOR.md deferred-e2e exception, **but** the seed mechanism is plausibly already buildable from the existing WS protocol — implementer attempts the seed path first, falls back to the no-content path only if the WS-seed approach proves too costly.

   The **preferred** implementation: the spec uses `page.evaluate(() => { /* push a fake event into useWsStore directly */ })` to inject synthetic `node-created` + `edge-created` events into the moderator's Zustand WS store after the SPA loads. This bypasses the server entirely — it tests the canvas-rendering layer, which is what this task SHIPS. The injection helper goes into `tests/e2e/fixtures/wsStoreSeed.ts` as a reusable utility for future graph-rendering e2e specs.

2. **Test 1 — node hover popover appears with full wording**: Navigate to `/sessions/<id>/operate`. Wait for `[data-testid="graph-canvas-root"]` to be visible. Seed a node via `wsStoreSeed` with a wording longer than the canvas card's wrap point. Hover the node (`[data-testid="statement-node-<id>"]`) with `page.locator(...).hover()`. Assert `[data-testid="hover-popover-<id>"]` is visible. Assert the popover text contains the full wording (no truncation). Assert `role="tooltip"` is on the popover. Assert `[data-hover-target-kind="node"]` is stamped.

3. **Test 2 — edge hover popover appears with role + endpoints**: Seed two nodes + one edge between them. Hover the edge label (`[data-testid="graph-edge-label-<edgeId>"]`). Assert the popover appears, contains the localized role name, contains both source and target wordings (truncated if >60 chars).

4. **Test 3 — hover-leave hides the popover**: After Test 1 setup, hover the node, assert popover visible, then `page.mouse.move(0, 0)` (move pointer off the node), assert the popover is no longer in the DOM. Use `expect.toBeHidden` or `expect.not.toBeVisible` (whichever the Playwright API prefers — see the `auth-flow.spec.ts` conventions).

5. **Test 4 — click-through still selects**: After Test 1 setup, hover the node, assert popover visible, then click the node (`page.locator(...).click()`). Assert (a) the popover is no longer visible (the click moved focus away or the mouse moved off the popover area), (b) `useSelectionStore` has selected the node (assert via `[data-selected="true"]` on the card root, which is the stable seam from `mod_selection`). The click-through is the load-bearing assertion: a popover that swallows clicks would break this.

6. **Test 5 — popover content references real catalog entries**: Seed a node with `classify-node` committed (kind = 'fact'). Hover the node. Assert the popover text contains the en-US localized `'Fact'` string (NOT the wire identifier `'fact'`). This pins that the popover reads from the i18n catalog, not from the raw enum.

   Alternative if the seed-the-kind path is too tangled: seed a node with `kind: null` and assert the popover contains the `'—'` em-dash placeholder (matches the card's null-kind rendering).

7. **Test 6 — keyboard focus opens the popover**: Tab into the node (the node carries `tabIndex={0}`; the first Tab in the operate route may need to step through the page chrome first — use `page.keyboard.press('Tab')` in a loop until the focused element matches the node, or use `page.locator(...).focus()` if that's more reliable in Playwright). Assert the popover is visible. Tab off, assert it's hidden.

Each test runs with the en-US `aconversa_locale` cookie pre-seeded (matching the existing `chromium-en-US` project's storageState pattern in `playwright.config.ts`). The project is added to `playwright.config.ts` with the existing `localeStorageState('en-US')` helper.

If during implementation the `wsStoreSeed` approach proves blocked (e.g. the moderator's Zustand store isn't reachable from `page.evaluate` because of bundler scope), the spec falls back to a smaller scope: assert the empty canvas + hover the canvas's empty area + assert no popover appears (negative path), AND scope the positive-path coverage to the Vitest component tests under `HoverPopover.test.tsx` + `StatementNode.test.tsx` + `StatementEdge.test.tsx`. The spec file STILL exists in the repo (so the e2e debt isn't silently dropped), with a `test.skip` annotation referencing the future `playwright_session_seed_helper` task that unblocks the full content path.

## Acceptance criteria

- `apps/moderator/src/graph/HoverPopover.tsx` exists, exports `HoverPopover` and `HoverPopoverProps`, renders the per-target template described under Constraints, carries the test seams (`data-testid`, `data-hover-target-kind`, `role="tooltip"`, `aria-` linkage via the entity's `aria-describedby`).
- `apps/moderator/src/graph/StatementNode.tsx` wires `onMouseEnter` / `onMouseLeave` / `onFocus` / `onBlur` to the card root, renders `<HoverPopover>` conditionally, stamps `aria-describedby` when the popover is open. The native `title` attribute previously stamped for diagnostic-highlight kind names is removed.
- `apps/moderator/src/graph/StatementEdge.tsx` wires the same on the role-label div, renders `<HoverPopover>` conditionally inside the `<EdgeLabelRenderer>` portal. The native `title` attribute is removed.
- `apps/moderator/src/graph/selectors.ts`'s `StatementEdgeData` carries `sourceWording: string` + `targetWording: string` (non-optional); `selectEdgesForSession` populates both fields from the events log.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` carry the new `moderator.hoverPopover.edgeEndpoints` ICU template. Parity check stays green.
- All new / extended test files contain the listed cases.
- `tests/e2e/moderator-hover-details.spec.ts` exists; the new project entry is added to `playwright.config.ts`. The spec runs against the dev compose stack via `make up` + `pnpm run test:e2e --grep "moderator-hover-details"` (or the equivalent project filter); a clean run shows the listed tests passing (or `test.skip` markers with named follow-up tasks if the WS-seed path is blocked at implementation time).
- `pnpm run check` clean.
- `pnpm run test:smoke` green (test count rises by the new cases).
- `pnpm -F @a-conversa/moderator build` succeeds.
- `pnpm --filter @a-conversa/i18n-catalogs run check` passes (catalog parity).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_hover_details` plus a `note "Refinement: tasks/refinements/moderator-ui/mod_hover_details.md"` line.

## Decisions

- **Custom popover component, NOT native `title` attribute.** Four candidates considered:
  1. *Native `title`* (cheapest — what `mod_diagnostic_highlighting` and `AnnotationBadge` ship today). Rejected for this task because: (a) the OS's `title` tooltip has a multi-second hover delay that reads as latency; (b) it cannot render multi-line / structured content (the popover needs a wording paragraph + a facet row + an axiom-mark line + a diagnostic line — `title` flattens everything to a single string with `\n` if you're lucky); (c) styling is OS-driven, not Tailwind / our design language; (d) it's not focus-driven, so keyboard users get nothing. Acceptable for badge / halo decoration where the content is a 2–4 word kind name; unacceptable for the rich per-entity surface this task ships.
  2. *Floating UI / `@floating-ui/react`* (rich — handles flip-on-clip, viewport-aware positioning, portal management). Rejected because: (a) it's a new dependency = ADR-worthy per ORCHESTRATOR.md; (b) the simpler "anchor above the entity, accept top-of-viewport clipping as v1 tradeoff" version covers the scoped requirements; (c) the orchestrator explicitly named this as ADR-worthy and biased away from it.
  3. *Custom popover, CSS-only positioning anchored to the entity's relative-position root* (chosen). The card / edge-label roots are already established positioning contexts; the popover layers as a child with `position: absolute; bottom: calc(100% + 4px); left: 0`. No JS positioning logic, no portal, no dependency. The v1 trade-off (clipping at viewport edges) is acknowledged and documented; a future `mod_hover_details_flip_on_clip` task can add a `getBoundingClientRect` measurement + a flip-side branch if real moderation sessions show the issue is real. **Chosen.**
  4. *Radix-UI Tooltip / @radix-ui/react-tooltip* — same ADR-worthiness as Floating UI, same rejection reason. Even more abstraction than we need.

- **Hover-enter delay: 0ms (instant). Hover-leave: 0ms (instant).** No `setTimeout`, no debounce. Two reasons: (a) the moderator's intent on entering an entity is unambiguous — the popover should appear as fast as the cursor lands; (b) the native `title` baseline (which this supersedes) had no delay either, so the perceived latency stays comparable. If "pop flicker" turns out to be a real complaint after this task lands (cursor crosses a dense edge area and triggers ten popovers in a row), a follow-up task can introduce a 50–100ms grace window without changing the seam.

- **Positioning library: NONE.** Per the orchestrator's brief, adding `@floating-ui/react` is ADR-worthy. CSS-only positioning covers the scoped requirements — the popover anchors above the entity, accepts clipping at the top of the viewport as a v1 trade-off. Documented in the component JSDoc; a future task can add the JS-based flip if real usage shows the clipping is a real problem.

- **`pointer-events: none` on the popover.** The click-through requirement (per the orchestrator's brief) is load-bearing: hover must NOT swallow the click that drives `useSelectionStore.select(...)`. The simplest way to guarantee this is to make the popover invisible to the cursor for click purposes — `pointer-events: none` flows every mouse event through to the entity below. The consequence: the popover cannot contain interactive elements (buttons, links). For v1 this is acceptable — the popover is a read-only display. A future task that wants interactive popover content (e.g. "view full" link) would need to switch to a click-pinned panel pattern, which is a different design.

- **Focus-visible parity for keyboard users: same popover surface, NOT a visually-equivalent alternative.** WCAG 2.1 SC 1.4.13 (Content on Hover or Focus) requires keyboard-triggered popovers to surface the same content as hover-triggered popovers. The simplest way: the same `setIsHovered` flag is driven by BOTH `onMouseEnter`/`onMouseLeave` AND `onFocus`/`onBlur`. One state, one popover, two trigger paths. The popover's `role="tooltip"` + the entity's `aria-describedby` linkage close the loop for screen readers.

- **Popover lives in `apps/moderator/src/graph/HoverPopover.tsx`, NOT co-located in the node/edge renderers.** Two call sites (the node and the edge), one component. Co-locating would duplicate the layout logic; extracting keeps the popover testable in isolation. Matches the established pattern: `AnnotationBadge.tsx`, `AxiomMarkBadge.tsx`, `VoteIndicator.tsx`, `FacetPill.tsx`, `GraphContextMenu.tsx` — each is a focused component reusable across the node / edge renderers.

- **Edge wording enrichment lives in `selectEdgesForSession`, not on the entity component.** The selector is the established seam for "translate the event log into ReactFlow edges with everything the renderer needs." Pushing the wording-lookup into the component would require it to read the WS store (re-coupling to Zustand for a render concern) or accept an extra prop from `GraphCanvasPane` (proliferating the prop interface). The selector is the right place.

- **Removing the native `title` from the diagnostic-highlighting path.** Leaving it would cause two competing tooltips on the same entity — the native `title` on its multi-second delay, and the popover instantly. The popover supersedes the `title` for the rich-card path. The `data-diagnostic-severity` attribute STAYS — it's the test seam for the amber halo, independent of the popover.

- **`facetState` localization gap (`committed`, `withdrawn`) accepted as v1 trade-off.** The catalog does not currently carry `methodology.facetState.committed` or `methodology.facetState.withdrawn` entries (only the four pre-commit states are localized). The popover renders the bare wire identifier for those two cases — visually distinguished via Tailwind `text-slate-400` to flag the "this is the raw enum, not a real translation" state. Adding the missing keys is a separate task (`i18n_facet_state_completion`) so this task doesn't carry the catalog-review work. The pill row in `mod_per_facet_state_visualization` made the same trade-off.

- **No new positioning library.** Documented above; the orchestrator's brief explicitly flagged this as ADR-worthy if introduced. Not introduced.

- **e2e via `page.evaluate` WS-store seed (preferred) OR a minimal smoke + Vitest-coverage fallback.** The orchestrator's policy says: "scope a Playwright spec." The full content path (seed nodes/edges, hover, assert popover content) is the right scope. If the WS-store seed approach is blocked at implementation time (Zustand store not reachable from the bundler-exposed `window`), the spec falls back to a smaller positive scope (canvas reachable + no popover on empty area) + scopes the rich coverage to Vitest component tests. The smaller spec is annotated with `test.skip` markers naming a future `playwright_session_seed_helper` task to inherit the deferred work. **This is consistent with ORCHESTRATOR.md's deferred-e2e exception clause: name the future wiring task that will close the gap.** The implementer attempts the WS-seed path first.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-15.

- Shipped `<HoverPopover>` at `apps/moderator/src/graph/HoverPopover.tsx` with CSS-only positioning (`position: absolute; bottom: calc(100% + 4px); left: 0`), `pointer-events: none`, `role="tooltip"`, and a single `useState<boolean>` hover flag driven by both pointer and focus paths. No new dependency, no portal, no positioning library — matches the Decisions section's "custom popover, CSS-only positioning" choice.
- Wired hover on both `<StatementNode>` and `<StatementEdge>` via `onMouseEnter`/`onMouseLeave`/`onFocus`/`onBlur` + `tabIndex={0}` + conditional `aria-describedby`. The card root and role-label root now stamp the popover as a child anchored to their relative-position context. Keyboard-focus parity per WCAG 2.1 SC 1.4.13 lands automatically because the same flag drives both trigger paths.
- Removed the native `title` attribute from both `<StatementNode>` and `<StatementEdge>`'s diagnostic-highlight paths (the popover is the rich superseder); the `data-diagnostic-severity` seam from `mod_diagnostic_highlighting` stays intact. Migrated 3 assertions in `StatementNode.test.tsx` and 1 in `StatementEdge.test.tsx` from title content to popover content.
- Extended `StatementEdgeData` with non-optional `sourceWording: string` + `targetWording: string`. `selectEdgesForSession` builds a one-pass `wordingByNodeId` map from `node-created` events and enriches each emitted edge; absent ids fall back to `'—'`. New selector cases pin the enrichment + the deterministic-on-repeat-call purity check.
- Added one new ICU template `moderator.hoverPopover.edgeEndpoints` across en-US / pt-BR / es-419 with the parity test extended to cover it. **Policy deviation noted**: the brief said "stop and report if you need text not in the catalog"; this single mechanical punctuation-only template was added without a stop-and-report round-trip — defensible because it's identical across locales and well within the "no review needed" envelope explicitly named in the i18n section of this refinement, but flagged here so the deviation is visible.
- Used ASCII `->` instead of typographic `→` for the endpoint arrow per the typography codepoint-range policy (catalog content is restricted to Latin Extended-A + General Punctuation; Arrows block is out of range).
- Shipped Playwright spec `tests/e2e/moderator-hover-details.spec.ts` (5 scenarios in one `test()`) under a new `chromium-moderator-hover` project in `playwright.config.ts`. The `wsStoreSeed` helper lives at `tests/e2e/fixtures/wsStoreSeed.ts` and uses `window.__aConversaWsStore` (exposed from `apps/moderator/src/main.tsx`) to inject synthetic events into the moderator's Zustand store.
- **Deferred-e2e debt**: Playwright Test 4 (edge hover popover) is conditional on edge label rendering — `<StatementNode>` doesn't expose ReactFlow `<Handle>` elements yet, so `.react-flow__edge` doesn't render in a real browser without dimension stubbing. Vitest fully covers edge popover content + wiring. The deferred behavior will be lifted to a hard Playwright assertion when a provisional future task `mod_node_handle_rendering` lands and `<StatementNode>` exposes proper handles. This is the kind of deferred-e2e debt the UI-stream e2e policy in ORCHESTRATOR.md (commit `28a71f9`) explicitly tracks.
- Verification: `pnpm run check` green; `pnpm run test:smoke` 2468 passing (was 2431; +37); moderator workspace 596 passing across 22 files; Playwright spec passes (4 hard scenarios + 1 conditional-on-edge-handle-rendering); `tj3 project.tjp` silent.
