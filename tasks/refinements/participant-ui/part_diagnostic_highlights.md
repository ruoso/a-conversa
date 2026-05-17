# Render active-diagnostic highlights on the participant's read-mostly graph

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_diagnostic_highlights`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!participant_ui.part_graph_view.part_graph_render` (settled — shipped the `/p/sessions/:id` `OperateRoute`, the `<GraphView>` Cytoscape mount, the pure `projectGraph(events)` projector, the per-session `useWsStore((s) => s.sessionState[sessionId]?.events)` selector idiom, the `<ul data-testid="participant-graph-status-mirror">` DOM mirror seam, the per-node `<li data-testid="participant-node-status">` + per-edge `<li data-testid="participant-edge-status">` rows. Live code: [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx#L1), [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts#L1)).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_per_facet_state_styling` (settled — shipped the layered-stylesheet pattern + the DOM mirror sentinel-string posture this leaf extends).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_axiom_mark_decoration` (settled, commit `c717fe2` — established the template: verbatim port from `apps/moderator/src/graph/` → `apps/participant/src/graph/`, widen `projectGraph`'s signature with an extra index argument, stamp a per-element flag on the emitted `data`, layer a `node[?<flag>]` Cytoscape selector on top of the per-status branches, extend per-`<li>` mirror with a `data-*` attribute, add a fresh `test()` block to `tests/e2e/participant-graph-render.spec.ts`).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_annotation_render` (settled, commit `32ebd93` — the most recent template. Established the **symmetric node+edge stamping pattern** when the wire vocabulary attaches to either kind: two indexes, two stylesheet selectors, two mirror-attribute extensions. Diagnostics follow the same symmetric pattern because four of the five surfaced kinds touch nodes only but `contradiction` and `coherency-hint.self-contradicts` also touch edges).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_e2e_user_pool_expansion` (settled, commit `d4f3247` — expanded the Authelia dev pool from 6 to 12 users and reverted the spec to `fullyParallel`. The refinement explicitly earmarks `ivan` + `julia` as the next-block pair for this leaf — see [`part_e2e_user_pool_expansion.md` line 42](part_e2e_user_pool_expansion.md#L42) — and `kate` + `leo` for the subsequent `part_own_vote_indicators` leaf).
- Prose-only context (NOT a `.tji` edge): `moderator_ui.mod_graph_rendering.mod_diagnostic_highlighting` (settled 2026-05-15 — refinement [`tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md`](../moderator-ui/mod_diagnostic_highlighting.md)) is the canonical "client computes per-entity diagnostic highlight from the `activeDiagnostics` map; renders per-target" reference. The moderator artifacts ported by this leaf: [`apps/moderator/src/graph/diagnosticHighlights.ts`](../../../apps/moderator/src/graph/diagnosticHighlights.ts) (the entire module — mirrored `Wire*Diagnostic` types, `diagnosticIdentityKey`, `affectedEntities`, `projectDiagnosticHighlights`, `DiagnosticHighlight`, `DiagnosticHighlightIndex`, `EMPTY_DIAGNOSTIC_HIGHLIGHTS`), [`apps/moderator/src/ws/wsStore.ts`](../../../apps/moderator/src/ws/wsStore.ts) (the widened `applyDiagnostic` reducer dispatching on `status === 'fired' | 'cleared'` and maintaining `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>`). The moderator's `StatementNode` / `StatementEdge` per-component Tailwind ring composition is NOT ported (Cytoscape ≠ ReactFlow); Decision §3 below explains the Cytoscape-side equivalent.
- Prose-only context (NOT a `.tji` edge): wire-format support. The `diagnostic` WS envelope is already shipped — [`packages/shared-types/src/ws-envelope.ts:1195-1265`](../../../packages/shared-types/src/ws-envelope.ts#L1195) defines `wsDiagnosticKinds` (`'cycle' | 'contradiction' | 'multi-warrant' | 'dangling-claim' | 'coherency-hint'`), `wsDiagnosticSeverities` (`'blocking' | 'advisory'`), `wsDiagnosticStatuses` (`'fired' | 'cleared'`), and `diagnosticPayloadSchema`. The server-side broadcast surface fans diagnostic envelopes out to every subscribed connection per session ([`apps/server/src/ws/broadcast/diagnostic.ts`](../../../apps/server/src/ws/broadcast/diagnostic.ts)) — that includes participant WS connections, not just moderator connections. The shell's WS client already routes `diagnostic` envelopes to `useWsStore.getState().applyDiagnostic(payload)` ([`packages/shell/src/ws/client.ts:260`](../../../packages/shell/src/ws/client.ts#L260)). **No wire-format change in scope; no tech-debt deferral needed for the wire layer.** Decision §2 below covers the participant-side store widening.

## What this task is

Extend the participant's read-mostly `<GraphView>` so every node OR edge that is part of an **active** (un-cleared) structural diagnostic's affected-entity set surfaces a presence-indicator + severity + kind-list on its Cytoscape element — the fifth visual-vocabulary layer on top of `part_graph_render` (baseline), `part_per_facet_state_styling` (per-facet rollup status), `part_axiom_mark_decoration` (axiom-mark boolean overlay), and `part_annotation_render` (annotation amber overlay). Before this leaf, an inbound `diagnostic` envelope lands in the participant's WS log (the shell client already calls `applyDiagnostic(payload)`) but the participant's default store only retains it as `lastDiagnostic` — the methodology engine's structural findings (cycles, contradictions, multi-warrants, dangling claims, coherency hints) are silent on the debater's canvas. After this leaf, the debater sees at a glance which nodes / edges are flagged by the engine, with the same severity vocabulary the moderator sees.

Concretely the deliverable is:

- A new `apps/participant/src/graph/diagnosticHighlights.ts` — a verbatim port of the moderator's [`apps/moderator/src/graph/diagnosticHighlights.ts`](../../../apps/moderator/src/graph/diagnosticHighlights.ts) (the entire module). The participant's `Wire*Diagnostic` shapes, `diagnosticIdentityKey`, `affectedEntities`, `projectDiagnosticHighlights`, `DiagnosticHighlight`, `DiagnosticHighlightIndex`, and `EMPTY_DIAGNOSTIC_HIGHLIGHTS` mirror the moderator's verbatim. Plus three thin helpers parallel to the predecessor leaves' shape — `nodeHasDiagnostic(index, nodeId): boolean`, `edgeHasDiagnostic(index, edgeId): boolean`, `diagnosticSeverityFor(index, kind, id): DiagnosticHighlightSeverity | 'none'` — derived from the bucketed `DiagnosticHighlightIndex`. The header comment links back to BOTH the moderator port (for the eventual extract-into-shell trigger when the audience surface adopts the same vocabulary) AND the wire-side mirror-comment cited by the moderator's port (`apps/server/src/diagnostics/event-emission.ts`'s `identityKeyFor`).
- A widening of `apps/participant/src/ws/wsStore.ts` to extend the shell's `BaseWsSessionState` with `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` — the participant cannot use `createDefaultWsStore()` unmodified because that factory's `applyDiagnostic` only stamps `lastDiagnostic` (per [`packages/shell/src/ws/defaultStore.ts:119-129`](../../../packages/shell/src/ws/defaultStore.ts#L119)). Decision §2 walks through the three options for the store widening and chooses the same "extend `BaseWsStoreState` locally; do not push `activeDiagnostics` into the shell yet" posture the moderator's `mod_diagnostic_highlighting` adopted.
- An extension to [`projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts) that takes a sixth argument `diagnosticHighlightIndex: DiagnosticHighlightIndex` (after `events`, `facetStatusIndex`, `axiomMarkIndex`, `nodeAnnotationIndex`, `edgeAnnotationIndex`) and stamps a `diagnosticHighlight: DiagnosticHighlight | null` field on every emitted node AND edge `data` object (Decision §1 — the at-a-glance card layer carries the per-entity rollup; per-diagnostic detail is the future entity-detail-panel's job). `ParticipantNodeData` and `ParticipantEdgeData` interfaces both grow the same field.
- An extension to [`GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) that derives the diagnostic-highlight index once per `activeDiagnostics` change via `useMemo(() => projectDiagnosticHighlights(activeDiagnostics), [activeDiagnostics])` (a sixth `useMemo` parallel to the existing `axiomMarkIndex` / `nodeAnnotationIndex` / `edgeAnnotationIndex` memos). The new `activeDiagnostics` selector reads from `useWsStore((s) => s.sessionState[sessionId]?.activeDiagnostics)` (the widened slice from `wsStore.ts`). Stylesheet adds TWO additional selectors — `node[diagnosticSeverity]` and `edge[diagnosticSeverity]` — that overlay a distinctive ring on top of (not replacing) the existing per-status / axiom / annotation branches. Decision §3 walks through the visual treatment.
- An extension to the existing per-node + per-edge `<li>` mirror entries — both grow `data-diagnostic-severity="blocking|advisory|none"` AND `data-diagnostic-kinds="<kind>,<kind>,..."` attributes (sentinel-string posture matching the existing `data-rollup-status` / `data-is-axiom` / `data-has-annotation` pattern — explicit `"none"` / empty string rather than omit-when-empty per Decision §5).
- Tests pin: Vitest at the projection-helper layer (`diagnosticIdentityKey` round-trips through all five kinds + the three coherency-hint sub-kinds; `affectedEntities` extracts per kind; `projectDiagnosticHighlights` rollup + dedupe + encounter-order; `nodeHasDiagnostic` / `edgeHasDiagnostic` return the right booleans), at the store layer (`applyDiagnostic` with `status: 'fired'` adds an active entry; `status: 'cleared'` removes one; unknown cleared is a no-op; `reset()` clears the map), at the projector layer (`projectGraph` stamps `diagnosticHighlight` on both nodes AND edges from the index), and at the `<GraphView>` render layer (both the node and edge mirror surface the right `data-diagnostic-severity` + `data-diagnostic-kinds`; the Cytoscape element set carries the same values). Playwright at the e2e layer extends `tests/e2e/participant-graph-render.spec.ts` with a **fifth** `test()` block using `ivan` + `julia` (Decision §6 — the fresh pair earmarked by `part_e2e_user_pool_expansion`; the spec stays `fullyParallel`).

Out of scope (deferred to existing or future leaves):

- **Per-diagnostic prose / hover tooltip on the participant canvas.** The moderator paints a native `title` tooltip listing `t('diagnostics.<kind>.title')` per active kind per entity (`mod_diagnostic_highlighting` Decisions). The participant's at-a-glance layer carries the severity + kind list on `data-*` attributes — the localized per-kind title prose (and the longer-form `.description` / `.detail` / `.action` keys, all already populated in en-US / pt-BR / es-419 per [`packages/i18n-catalogs/src/catalogs/en-US.json:564-595`](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L564)) belongs in the future entity-detail-panel (`part_entity_detail_panel`) where a React surface can host the per-locale labels for every kind in `highlight.kinds`. Same posture as `part_annotation_render`'s deferral of per-kind labels.
- **Pulse / animation on blocking-severity highlights.** The moderator's blocking highlight uses Tailwind's `motion-safe:animate-pulse` for an attention-grabbing signal. Cytoscape has no equivalent declarative animation primitive at the stylesheet layer (Cytoscape `style.css`-style animations require imperative `cy.animate()` calls per element, which would force the projector to walk active diagnostics and animate every affected element on every events tick). The static severity differentiation (ring width + color saturation per Decision §3) carries the severity signal; an animated variant routes through a future polish leaf if real usage shows the static signal isn't load-bearing enough on the debater tablet.
- **Diagnostic-resolution / diagnostic-acknowledgment actions from the participant tablet.** The methodology engine's diagnostic-resolution flow is owned by the moderator's `mod_diagnostic_flow.*` family (per the moderator-side dependency chain). The participant is a read-only consumer of the diagnostic signal — there's no participant gesture to dismiss / acknowledge / resolve a diagnostic in this leaf or anywhere else in the current WBS for participant-side.
- **Diagnostic flag pane / sidebar list on the participant tablet.** The moderator has an active-diagnostics sidebar (future `mod_diagnostic_flag_pane`); the participant equivalent is not in the WBS. The at-a-glance canvas signal this leaf paints is the participant's only diagnostic surface for now.
- **`pending-consequences` diagnostic kind.** Per [`packages/shared-types/src/ws-envelope.ts:1161-1163`](../../../packages/shared-types/src/ws-envelope.ts#L1161), `pending-consequences` is DELIBERATELY EXCLUDED from the wire `wsDiagnosticKinds` aggregator (it's a server-side stub kind). The five surfaced kinds are what this leaf renders; if `pending-consequences` is later promoted, both the wire schema and the participant projection get a one-line append.
- **Visual regression on the rendered diagnostic ring.** Same deferral as the prior overlay leaves — pixel comparisons of the rendered halo are out of scope; the DOM-mirror assertions are the load-bearing test contract.

## Why it needs to be done

`m_participant_mvp` ([`tasks/99-milestones.tji`](../../99-milestones.tji)) is the milestone at which a debater can see and engage with the live graph from their tablet. `part_graph_render` lit up the rendering surface; `part_per_facet_state_styling` painted the agreement-state vocabulary; `part_axiom_mark_decoration` painted the bedrock vocabulary; `part_annotation_render` painted the meta-commentary vocabulary; this leaf paints the **methodology-engine vocabulary** — the structural findings the engine reports back to the participants as cycles, contradictions, multi-warrants, dangling claims, and coherency hints ([`docs/methodology.md:210-227`](../../../docs/methodology.md#L210), "Resolution of structural diagnostics").

The methodology assumes both the moderator AND the debaters see the engine's findings. The doc-grounded vocabulary makes the debater an active participant in diagnostic resolution:

- [`docs/methodology.md:224-225`](../../../docs/methodology.md#L224) — axiom-marking is one of the canonical resolutions for cycle / contradiction diagnostics ("have a participant axiom-mark a node in the cycle (the chain terminates at that participant's bedrock)"). The participant cannot intentionally resolve a diagnostic they cannot see.
- The blocking-vs-advisory split ([`docs/methodology.md:210-227`](../../../docs/methodology.md#L210)) is the moderator's gating axis — blocking diagnostics need resolution before forward progress. The debater also needs to see which entities are blocking so they understand WHY the conversation has stalled when the moderator pauses for an axiom-mark or amendment.
- The five surfaced kinds (`cycle`, `contradiction`, `multi-warrant`, `dangling-claim`, `coherency-hint`) are first-class methodology entities, not chrome; they fire from the projection layer and propagate to every subscribed WS connection per session per [`apps/server/src/ws/broadcast/diagnostic.ts`](../../../apps/server/src/ws/broadcast/diagnostic.ts).

Without this leaf, the participant's WS connection receives `diagnostic` envelopes that the shell client dispatches to `applyDiagnostic` and the default store silently throws away the active-set delta (only the last envelope is retained as `lastDiagnostic`). The methodology-engine signal lands on the wire and dies on the participant tablet — the same kind of silent fan-out that erodes trust on the moderator's surface before `mod_diagnostic_highlighting` shipped.

Downstream concretely:

- **`part_entity_detail_panel`** (the React-driven tap-to-detail panel) is the natural home for the per-diagnostic-kind localized title + description row. When that leaf lands, it imports the same `DiagnosticHighlight` shape this leaf stamps on the projection output and renders each entry in `highlight.kinds` with the matching `diagnostics.<kind>.title` / `.description` / `.detail` / `.action` catalog string. The at-a-glance signal this leaf stamps is the canvas scan; the per-diagnostic-detail breakdown is the tap-to-detail.
- **`audience.aud_diagnostic_highlights`** (future, sibling to `aud_annotation_rendering`) becomes the third Cytoscape consumer of diagnostic-highlight vocabulary. When it lands, the natural extraction trigger lifts `diagnosticHighlights.ts` (and `axiomMarks.ts` + `annotations.ts`) into `@a-conversa/shell`.
- The participant's `<GraphView>` becomes the **second concrete adoption of the moderator's diagnostic-highlight vocabulary** (Cytoscape edition; the moderator is React/ReactFlow edition). The audience surface (future) will be the third, and the natural extraction trigger for `projectDiagnosticHighlights` + `diagnosticIdentityKey` + `affectedEntities` + the `Wire*Diagnostic` mirror types into `@a-conversa/shell` (Decision §2 — same "two callers is YAGNI; extract when the third materialises" policy `mergeSlots`, `computeFacetStatuses`, `projectAxiomMarks`, and `projectAnnotations` already followed).

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Cytoscape on the participant surface; the stylesheet's `node[diagnosticSeverity]` / `edge[diagnosticSeverity]` selectors are the canonical "data-field equality" extension point this leaf uses for the per-severity ring (a step up from the boolean `node[?<flag>]` selectors used by the prior overlays, because severity has three states — `'blocking'`, `'advisory'`, `'none'` — not two).
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the wire-event vocabulary. The `diagnostic` envelope is NOT a top-level `Event` (it's a derived broadcast on the WS surface, like `proposal-status` and `snapshot-state`), so this leaf does NOT walk `events` to derive diagnostics — it consumes the pre-derived `activeDiagnostics` map maintained by `applyDiagnostic`'s widened reducer. The wire envelope's `diagnostic` field is typed `z.unknown()` by design (per the wire-schema comment at [`packages/shared-types/src/ws-envelope.ts:1147-1157`](../../../packages/shared-types/src/ws-envelope.ts#L1147)); the participant's narrow happens via the mirrored `WireDiagnostic` union (verbatim ported from the moderator).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behavioural assertion below is a committed Vitest case or Playwright scenario.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation()` is the participant surface's localization seam. This leaf does NOT add new user-facing strings — the at-a-glance signal is a per-severity ring communicated visually + a sentinel-string `data-diagnostic-severity` / `data-diagnostic-kinds` mirror surface; the per-kind localized prose belongs in the entity detail panel where the `diagnostics.<kind>.title` / `.description` / `.detail` / `.action` keys (already populated for en-US / pt-BR / es-419 per [`packages/i18n-catalogs/src/catalogs/en-US.json:564-595`](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L564)) get consumed.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the surface owns its mounted region only; `useWsStore` comes from the participant workspace's singleton. This leaf widens that singleton from `createDefaultWsStore()`'s shape to a participant-specific extension (Decision §2 — symmetric with the moderator's `wsStore.ts`).
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — a structural diagnostic is a per-projection finding on the entity layer (cycles + contradictions + dangling-claims target nodes; contradictions + self-contradicts target edges; multi-warrants + the other coherency-hint sub-kinds target nodes). The per-entity-kind index this leaf threads through `projectGraph` composes orthogonally with the per-facet rollup status the predecessor leaf paints — Decision §3 documents the stylesheet composition.

No new ADR. Every decision below applies an existing ADR or mirrors a settled moderator-side decision; the architectural seams (Cytoscape library pick, micro-frontend shell, methodology vocabulary, two-callers-then-extract policy, per-session `activeDiagnostics` map shape) are settled.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_annotation_render.md`](part_annotation_render.md) — the most recent template + the closest predecessor for symmetric node+edge stamping. This leaf reuses the same six seams (port the helper, widen `projectGraph` signature, derive the index in `<GraphView>` via `useMemo`, layer Cytoscape stylesheet selectors, extend BOTH mirror row kinds with `data-*` attrs, add a fresh Playwright `test()` block) — the divergences are (a) the participant has no `activeDiagnostics` slot on its WS store yet (Decision §2), and (b) the per-entity rollup carries severity + kind list, not a boolean + count (Decision §1).
- [`tasks/refinements/participant-ui/part_axiom_mark_decoration.md`](part_axiom_mark_decoration.md) — established the layered-stylesheet + DOM mirror pattern. Decisions §1 + §3 + §5 below reuse the same posture for diagnostic highlights.
- [`tasks/refinements/participant-ui/part_per_facet_state_styling.md`](part_per_facet_state_styling.md) — the original stylesheet + DOM mirror infrastructure. Decision §5 below extends the same sentinel-string posture (explicit `"none"` / explicit empty string, never omit) to the two new `data-diagnostic-*` attributes.
- [`tasks/refinements/participant-ui/part_graph_render.md`](part_graph_render.md) — `<GraphView>` mount + `projectGraph` seam. Decision §4 of that leaf established "projection lives in the participant workspace; extraction waits for the third caller (audience surface)"; this leaf adopts the same posture (Decision §2).
- [`tasks/refinements/participant-ui/part_state_management.md`](part_state_management.md) — the per-session WS slice shape. The current store uses `createDefaultWsStore()` unmodified (per [`apps/participant/src/ws/wsStore.ts:36`](../../../apps/participant/src/ws/wsStore.ts#L36)). This leaf is the first participant-side feature that needs a slice the base shape doesn't provide — Decision §2 walks through the consequences.
- [`tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md`](part_e2e_user_pool_expansion.md) — the 6→12 user-pool expansion. Names `ivan` + `julia` as the explicit next-block pair for this leaf at [line 42](part_e2e_user_pool_expansion.md#L42); Decision §6 adopts that earmark.

### Sibling refinements on the moderator (the vocabulary this leaf adapts)

- [`tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md`](../moderator-ui/mod_diagnostic_highlighting.md) — the canonical "client widens the WS store with `activeDiagnostics`; pure projection from the map to a per-entity index; per-component ring overlay" pattern. This leaf adopts the projection module verbatim and reduces the rendering to a per-target severity + kinds stamp on the Cytoscape element data (Decisions §1 and §2 explain the reduction). The moderator's per-component Tailwind ring composition is replaced by Cytoscape stylesheet selectors (Decision §3); the i18n tooltip is deferred to the future entity detail panel (Decision §1).
- [`tasks/refinements/data-and-methodology/diagnostic_event_emission.md`](../data-and-methodology/diagnostic_event_emission.md) — identity-key canonicalization per kind. The participant's `diagnosticIdentityKey` mirrors the server's `identityKeyFor` formula verbatim (ported from the moderator port).
- [`tasks/refinements/backend/ws_diagnostic_broadcast.md`](../backend/ws_diagnostic_broadcast.md) — wire-format details, fan-out shape, ordering relative to `event-applied`. Confirms diagnostic envelopes already reach the participant's WS connection (the server's `connectionsForSession(sessionId)` lookup fans out to all subscribed connections, regardless of role).

### Live code the leaf plugs into

- [`apps/participant/src/ws/wsStore.ts:1-36`](../../../apps/participant/src/ws/wsStore.ts#L1) — the participant's WS singleton. Currently delegates to `createDefaultWsStore()` unmodified. This leaf rewrites it to extend the shell's base shape with `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` per session, plus a widened `applyDiagnostic` reducer that dispatches on `payload.status` (mirroring the moderator's `apps/moderator/src/ws/wsStore.ts` widening). Decision §2 walks through the three options.
- [`apps/participant/src/graph/GraphView.tsx:120-304`](../../../apps/participant/src/graph/GraphView.tsx#L120) — the module-scope `STYLESHEET` constant. This leaf appends TWO additional selectors — `node[diagnosticSeverity = "blocking"]` / `node[diagnosticSeverity = "advisory"]` / `edge[diagnosticSeverity = "blocking"]` / `edge[diagnosticSeverity = "advisory"]` (four total) — after the existing annotation overlay block. The baseline `node` / `edge` selectors stay as the catch-all; the per-status, axiom-mark, and annotation branches stay as their respective layered vocabularies; the diagnostic ring layers on top using Cytoscape's `border-color` + `border-width` + `border-opacity` for nodes and `underlay-color` + `underlay-opacity` + `underlay-padding` for edges. Decision §3 walks through the four-style breakdown (per-severity per-target-kind).
- [`apps/participant/src/graph/GraphView.tsx:361-393`](../../../apps/participant/src/graph/GraphView.tsx#L361) — the component body. This leaf inserts ONE new `useMemo` (placed after the existing `edgeAnnotationIndex` memo) that derives `diagnosticHighlightIndex = projectDiagnosticHighlights(activeDiagnostics)` once per `activeDiagnostics` change. The `projected` memo takes it as the sixth argument to `projectGraph`; the localized `elements` memo carries `diagnosticHighlight` through via the existing `...node.data` / `...edge.data` spreads. The new `activeDiagnostics` selector reads `useWsStore((s) => s.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_DIAGNOSTICS_MAP)` (the `EMPTY_DIAGNOSTICS_MAP` constant is a frozen empty `Map` at module scope, paralleling the existing `EMPTY_FACET_STATUSES` / `EMPTY_AXIOM_MARKS` / `EMPTY_ANNOTATIONS` references; default ensures memo stability when no session record exists yet).
- [`apps/participant/src/graph/GraphView.tsx:492-519`](../../../apps/participant/src/graph/GraphView.tsx#L492) — the returned fragment. This leaf adds TWO `data-*` attributes on EACH of the existing `<li>` mirror rows: `data-diagnostic-severity` + `data-diagnostic-kinds` on `<li data-testid="participant-node-status">` AND on `<li data-testid="participant-edge-status">`. No new `<li>` rows; no new wrappers. Two helpers in the same shape as the existing `rollupAttr` / `axiomAttr` / `hasAnnotationAttr` — `diagnosticSeverityAttr(highlight: DiagnosticHighlight | null): 'blocking' | 'advisory' | 'none'` and `diagnosticKindsAttr(highlight: DiagnosticHighlight | null): string` (returns `highlight?.kinds.join(',') ?? ''` — empty string when no diagnostic, comma-joined sentinel list otherwise; Decision §5 walks through the sentinel posture).
- [`apps/participant/src/graph/projectGraph.ts:90-129`](../../../apps/participant/src/graph/projectGraph.ts#L90) — `ParticipantNodeData`. This leaf adds `readonly diagnosticHighlight: DiagnosticHighlight | null` to the interface, in that order, after `annotationCount`.
- [`apps/participant/src/graph/projectGraph.ts:140-174`](../../../apps/participant/src/graph/projectGraph.ts#L140) — `ParticipantEdgeData`. This leaf adds the same field after `annotationCount`. Symmetric with `ParticipantNodeData` because two of the five surfaced kinds touch edges (`contradiction.edges` and `coherency-hint.self-contradicts.edgeId`); Decision §1 walks through the symmetry.
- [`apps/participant/src/graph/projectGraph.ts:244-278`](../../../apps/participant/src/graph/projectGraph.ts#L244) — `projectGraph`. This leaf widens the signature to `projectGraph(events, facetStatusIndex, axiomMarkIndex, nodeAnnotationIndex, edgeAnnotationIndex, diagnosticHighlightIndex)`. The node-creation branch consults `diagnosticHighlightIndex.nodes.get(event.payload.node_id) ?? null` and stamps the value on `data.diagnosticHighlight`. The edge-creation branch does the same with `diagnosticHighlightIndex.edges` + `event.payload.edge_id`. The classify-commit branch's `...existing.data` spread carries the prior value unchanged (same posture the axiom-mark + annotation leaves documented).
- [`apps/moderator/src/graph/diagnosticHighlights.ts`](../../../apps/moderator/src/graph/diagnosticHighlights.ts) — the canonical port source. The participant's `diagnosticHighlights.ts` mirror copies the entire module line-for-line (the `Wire*Diagnostic` types, `WireDiagnostic` union, `DiagnosticHighlight`, `DiagnosticHighlightIndex`, `EMPTY_DIAGNOSTIC_HIGHLIGHTS`, `diagnosticIdentityKey`, `affectedEntities`, `projectDiagnosticHighlights`); adds the three thin presence/severity helpers (`nodeHasDiagnostic` / `edgeHasDiagnostic` / `diagnosticSeverityFor`) at the bottom of the file. No structural change in the port — the moderator helper is shaped for direct reuse on Cytoscape too.
- [`apps/moderator/src/ws/wsStore.ts`](../../../apps/moderator/src/ws/wsStore.ts) — the canonical port source for the store widening. The participant's `wsStore.ts` adopts the same `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` slot on `WsSessionState`, the same widened `applyDiagnostic` reducer (dispatching on `payload.status` with `diagnosticIdentityKey` as the map key), and the same `reset()` clearing. Decision §2 walks through the alternatives.
- [`packages/shared-types/src/ws-envelope.ts:1195-1265`](../../../packages/shared-types/src/ws-envelope.ts#L1195) — `wsDiagnosticKinds`, `wsDiagnosticSeverities`, `wsDiagnosticStatuses`, `diagnosticPayloadSchema`, `DiagnosticPayload`. No change; the port reads the same shape.
- [`packages/shell/src/ws/client.ts:260`](../../../packages/shell/src/ws/client.ts#L260) — the inbound dispatch for `diagnostic` envelopes. Already routes to `store.applyDiagnostic(payload)`; the participant's widened reducer slots in transparently because it satisfies the same `BaseWsStoreState['applyDiagnostic']` signature.
- [`packages/shell/src/ws/store-contract.ts:44-53`](../../../packages/shell/src/ws/store-contract.ts#L44) — `BaseWsSessionState`. The participant extends this with one new field, mirroring the moderator's extension pattern; the shell base shape is not modified (the moderator's `activeDiagnostics` already lives outside `BaseWsSessionState` per the shell-package extraction rule).
- [`tests/e2e/participant-graph-render.spec.ts:103-822`](../../../tests/e2e/participant-graph-render.spec.ts#L103) — the existing Playwright describe with four `test()` blocks (`alice`+`ben`, `maria`+`dave`, `frank`+`erin`, `grace`+`henry`) running fully parallel. This leaf adds a fifth `test()` block using `ivan` + `julia` (per Decision §6); the describe stays parallel.

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/fixtures/auth.ts:118-131`](../../../tests/e2e/fixtures/auth.ts#L118) — `DEV_USER_POOL` (the 12-user roster). `ivan` is at index 6 (zero-based) and `julia` is at index 7. The fifth Playwright block uses these as `{ creator, debater }` per the `(creator, debater)` convention each prior block follows.
- [`tests/e2e/participant-graph-render.spec.ts:64-101`](../../../tests/e2e/participant-graph-render.spec.ts#L64) — `createSession`, `logoutAndClearAllCookies`, `freshContext` helpers. The new `test()` block reuses them verbatim.
- [`playwright.config.ts`](../../../playwright.config.ts) — `chromium-participant-skeleton` already matches `participant-graph-render.spec.ts`. No config change needed. The new block runs in parallel under `fullyParallel`; wall-clock for the project grows by zero (the new block runs in its own worker concurrently with the prior four).
- The new block seeds diagnostic envelopes via `__aConversaWsStore.getState().applyDiagnostic({ ... })` — the same pattern the prior blocks use for `applyEvent` to seed events. The widened reducer routes the payload through `diagnosticIdentityKey` and updates `activeDiagnostics`; the canvas re-renders through the existing `useWsStore` selector flow.

### What the surface MUST NOT do

- **No `fetch('/api/...')` from `GraphView` or the diagnostic derivation.** The per-session `activeDiagnostics` map is the single data source.
- **No mutation of the `useWsStore` from `<GraphView>`.** Read-only via the new selector. The writes happen inside `applyDiagnostic` driven by the shell's WS client.
- **No new top-level dependency.** Cytoscape is already declared by ADR 0004 + the participant `package.json`. The stylesheet extension uses Cytoscape's built-in selector + `border-*` + `underlay-*` vocabulary.
- **No write paths on the WS connection for diagnostic resolution / acknowledgment.** Resolution actions live on the moderator side; the participant is rendering-only.
- **No new shell exports.** The diagnostic-highlights port lives in the participant workspace per Decision §2 (same trigger-on-the-third-caller policy the predecessor leaves adopted).
- **No new i18n keys.** The visual at-a-glance signal is a per-severity ring + the sentinel-string mirror attributes; the per-kind localized titles are the entity-detail-panel's future job (`diagnostics.<kind>.title` and the longer-form prose are already populated in en-US / pt-BR / es-419).
- **No port of the moderator's per-component Tailwind ring composition.** Cytoscape is not React; the stylesheet selectors are the participant's equivalent surface.
- **No animation / pulse on the diagnostic ring** (deferred — see "Out of scope" above for the rationale).
- **No change to `projectGraph`'s output ordering.** Nodes still emit in `node-created` arrival order; edges in `edge-created` arrival order. The new `diagnosticHighlight` field is additive on each element `data` object; it does not reshape iteration.
- **No removal of the prior fields.** `isAxiom`, `rollupStatus`, `facetStatuses`, `hasAnnotation`, `annotationCount`, `kind`, `wording`, `id` all survive — every prior overlay still composes.
- **No re-derivation from `events`.** Diagnostics are pre-derived on the server and broadcast as their own envelopes; the participant consumes the pre-derived `activeDiagnostics` map directly (no walk of the events log for diagnostic state).

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/graph/diagnosticHighlights.ts` — NEW. Verbatim port of [`apps/moderator/src/graph/diagnosticHighlights.ts`](../../../apps/moderator/src/graph/diagnosticHighlights.ts) — the entire module: `WireCycleDiagnostic`, `WireContradictionDiagnostic`, `WireMultiWarrantDiagnostic`, `WireDanglingClaimDiagnostic`, `WireIncompleteWarrantMissingBridgesToHint`, `WireIncompleteWarrantMissingBridgesFromHint`, `WireSelfContradictsHint`, `WireCoherencyHint`, `WireCoherencyHintDiagnostic`, `WireDiagnostic`, `DiagnosticHighlightSeverity`, `DiagnosticHighlightKind`, `DiagnosticHighlight`, `DiagnosticHighlightIndex`, `EMPTY_DIAGNOSTIC_HIGHLIGHTS`, `diagnosticIdentityKey`, `affectedEntities`, `projectDiagnosticHighlights`. Plus three new thin helpers: `nodeHasDiagnostic(index, nodeId): boolean`, `edgeHasDiagnostic(index, edgeId): boolean`, `diagnosticSeverityFor(index, target: 'node' | 'edge', id): DiagnosticHighlightSeverity | 'none'`. Header comment links back to BOTH the moderator source (`apps/moderator/src/graph/diagnosticHighlights.ts`) AND the wire-format mirror (`apps/server/src/diagnostics/event-emission.ts`'s `identityKeyFor`) — keeping the drift-risk warning the moderator file already carries.
- `apps/participant/src/graph/diagnosticHighlights.test.ts` — NEW. Vitest cases (12) mirroring the moderator's coverage from [`apps/moderator/src/graph/diagnosticHighlights.test.ts`](../../../apps/moderator/src/graph/diagnosticHighlights.test.ts) so a reader cross-referencing the two ports sees the same pin: (a) `diagnosticIdentityKey` round-trips for cycle / contradiction / multi-warrant / dangling-claim / coherency-hint (5 cases); (b) `diagnosticIdentityKey` for the three coherency-hint sub-kinds (1 case combining all three); (c) `affectedEntities` per kind (5 cases assertion-collapsed into 1 case with a per-kind table); (d) `affectedEntities` for the three coherency-hint sub-kinds (1 case); (e) `projectDiagnosticHighlights` blocking-wins-over-advisory rollup (1 case); (f) `projectDiagnosticHighlights` kinds dedupe (1 case); (g) `projectDiagnosticHighlights` empty input returns the stable `EMPTY_DIAGNOSTIC_HIGHLIGHTS` reference (1 case); (h) `nodeHasDiagnostic` / `edgeHasDiagnostic` return `true` for entities in the index, `false` otherwise (1 case covering both helpers). The round-trip-consistency-with-server-identity-key case is NOT duplicated — the moderator's test pins that invariant, and the participant module re-exports the moderator's formula verbatim; a future divergence between participant and moderator (which would also diverge from the server) would fail the moderator test first.
- `apps/participant/src/ws/wsStore.ts` — modified. (1) Replace the `createDefaultWsStore()` re-export with a participant-specific Zustand store constructor that extends `BaseWsStoreState`. The new shape adds `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` to a per-session state interface that extends `BaseWsSessionState`. (2) `applyDiagnostic` reducer is widened to dispatch on `payload.status`: `'fired'` adds/replaces the entry keyed by `diagnosticIdentityKey(payload)` AND updates `lastDiagnostic` (preserving the existing slot); `'cleared'` removes the entry by the same key AND updates `lastDiagnostic` (the slot reflects "last envelope seen", regardless of status). (3) `reset()` clears `activeDiagnostics` via the same `ensureSession` rebuild path. (4) Local re-exports `WsSessionState` + `WsState` now reflect the widened shapes; the JSDoc on the module update reflects "we extend the base because the participant carries `activeDiagnostics`, mirroring `apps/moderator/src/ws/wsStore.ts`". The module-header refinement comment links updated to point at this leaf in addition to `part_state_management`.
- `apps/participant/src/ws/wsStore.test.ts` — modified. Existing cases stay (the additive slot doesn't break them). 6 new cases added mirroring the moderator's `wsStore.test.ts` coverage for `activeDiagnostics`: (a) a `fired` payload populates `activeDiagnostics` keyed by the wire identity; (b) a `cleared` payload for the same identity removes the entry; (c) a `cleared` for an unknown identity is a no-op (no error, no spurious entry); (d) two distinct `fired` diagnostics co-exist; (e) `lastDiagnostic` continues to track the most recent envelope regardless of status (backward-compat preservation); (f) `reset()` clears `activeDiagnostics`.
- `apps/participant/src/graph/projectGraph.ts` — modified. (1) `ParticipantNodeData` grows `readonly diagnosticHighlight: DiagnosticHighlight | null` (after `annotationCount`). (2) `ParticipantEdgeData` grows the same field after `annotationCount`. (3) `projectGraph`'s signature widens to `projectGraph(events, facetStatusIndex, axiomMarkIndex, nodeAnnotationIndex, edgeAnnotationIndex, diagnosticHighlightIndex)`. (4) The `node-created` branch resolves the highlight via `diagnosticHighlightIndex.nodes.get(event.payload.node_id) ?? null` and stamps `diagnosticHighlight: <value>`. (5) The `edge-created` branch does the same with `diagnosticHighlightIndex.edges` + `event.payload.edge_id`. (6) The classify-commit branch's `...existing.data` spread carries the prior `diagnosticHighlight` unchanged. (7) `DiagnosticHighlight` + `DiagnosticHighlightIndex` are imported from `./diagnosticHighlights`. The header refinement-block grows one more entry citing this leaf.
- `apps/participant/src/graph/projectGraph.test.ts` — modified. Existing cases adapted to the new signature (each test factory passes `EMPTY_DIAGNOSTIC_HIGHLIGHTS` for the no-diagnostics baseline). 6 new cases added: (a) projection stamps `diagnosticHighlight: null` on every node by default; (b) projection stamps the right `DiagnosticHighlight` on a node when the index targets it; (c) projection stamps the right `DiagnosticHighlight` on an edge when the index targets it; (d) per-severity rollup is preserved through the projection (a node touched by blocking + advisory stamps `severity: 'blocking'`); (e) per-kind list is preserved through the projection (a node touched by cycle + multi-warrant stamps `kinds: ['cycle', 'multi-warrant']`); (f) `diagnosticHighlight` survives a classify-node commit (the spread in the commit branch preserves it).
- `apps/participant/src/graph/GraphView.tsx` — modified. (1) Stylesheet extension: FOUR new selectors after the existing annotation overlay block — per Decision §3, one per `(target-kind × severity)` cell. Node + blocking: `border-color: '#b45309', border-width: 4, border-opacity: 0.9` (amber-700, heavy). Node + advisory: `border-color: '#fbbf24', border-width: 2, border-opacity: 0.7` (amber-400, light). Edge + blocking: `width: 5, underlay-color: '#b45309', underlay-opacity: 0.45, underlay-padding: 4`. Edge + advisory: `width: 3, underlay-color: '#fbbf24', underlay-opacity: 0.3, underlay-padding: 2`. (2) ONE new `useMemo` (placed after the existing `edgeAnnotationIndex` memo) derives `diagnosticHighlightIndex = projectDiagnosticHighlights(activeDiagnostics)`. (3) Two new selectors: `activeDiagnostics = useWsStore((s) => s.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_DIAGNOSTICS_MAP)` (with `EMPTY_DIAGNOSTICS_MAP` a module-scope frozen `Map`). (4) The `projected` memo's dependency list grows the new index; `projectGraph` takes it as the sixth argument. (5) The localized `elements` memo carries `diagnosticHighlight` through via the existing `...node.data` / `...edge.data` spreads — and additionally derives a sibling `diagnosticSeverity` data field (string sentinel `'blocking'` / `'advisory'` / `'none'`) for the Cytoscape stylesheet to match on (Cytoscape's `[<key> = "<value>"]` selectors can't reach into a nested object; the per-severity selector needs a flat string-typed `data` slot). The `diagnosticSeverity` slot is derived from `diagnosticHighlight?.severity ?? 'none'`. (6) The mirror `<li data-testid="participant-node-status">` grows `data-diagnostic-severity` + `data-diagnostic-kinds`; the mirror `<li data-testid="participant-edge-status">` grows the same two attributes. Small helpers `diagnosticSeverityAttr(highlight: DiagnosticHighlight | null): 'blocking' | 'advisory' | 'none'` (matches the `diagnosticSeverity` data field) and `diagnosticKindsAttr(highlight: DiagnosticHighlight | null): string` (returns `highlight?.kinds.join(',') ?? ''`).
- `apps/participant/src/graph/GraphView.test.tsx` — modified. Existing cases stay (the additive fields don't break them once test factories pass empty `activeDiagnostics`). 7 new cases added: (a) the per-node mirror `<li>` carries `data-diagnostic-severity="none"` + `data-diagnostic-kinds=""` by default; (b) when a cycle diagnostic fires targeting the node, the mirror reports `data-diagnostic-severity="blocking"` + `data-diagnostic-kinds="cycle"`; (c) when a multi-warrant diagnostic ALSO fires on the same node, the mirror reports `data-diagnostic-severity="blocking"` + `data-diagnostic-kinds="cycle,multi-warrant"` (blocking wins; kinds in encounter order); (d) the per-edge mirror `<li>` carries the same semantics for edge-targeted diagnostics (a contradiction's edge entry surfaces `data-diagnostic-severity="blocking"` + `data-diagnostic-kinds="contradiction"`); (e) Cytoscape's internal element set carries the same `data.diagnosticHighlight` + `data.diagnosticSeverity` values the mirror surfaces (sanity check via `cy.elements().jsons()`); (f) the stylesheet contains the four new selectors with the expected `border-*` / `underlay-*` overrides (assert against `STYLESHEET` import); (g) a `cleared` envelope arriving for a previously-fired diagnostic drops the entity's mirror back to `data-diagnostic-severity="none"` + `data-diagnostic-kinds=""` (the reactive update path through `applyDiagnostic`).
- `tests/e2e/participant-graph-render.spec.ts` — modified. Adds a fifth `test()` block: `ivan creates a session, julia claims debater-A, seeded WS events + a fired cycle diagnostic + a fired contradiction diagnostic + a fired multi-warrant + a cleared diagnostic surface data-diagnostic-severity + data-diagnostic-kinds on the affected entities and clear correctly`. Seeds: three `node-created` events (NODE_A, NODE_B, NODE_C); one `edge-created` event (EDGE_AB, source NODE_A → target NODE_B); then via `applyDiagnostic`: a `fired` cycle on [NODE_A, NODE_B, NODE_C] (blocking), a `fired` contradiction on (NODE_A, NODE_B, [EDGE_AB]) (blocking), a `fired` multi-warrant on (NODE_C, NODE_A, [NODE_B]) (advisory), and a `cleared` for the multi-warrant identity (so we can pin both the fired AND the cleared path within one block). Asserts: NODE_A mirror has `data-diagnostic-severity="blocking"` (blocking from cycle + contradiction); NODE_A `data-diagnostic-kinds` contains both `"cycle"` and `"contradiction"`; NODE_C mirror has `data-diagnostic-severity="none"` + `data-diagnostic-kinds=""` after the multi-warrant cleared (the cycle doesn't touch NODE_C... wait, it does — sorry, NODE_C is in the cycle; the assertion table needs a node NOT in any active diagnostic — use an additional NODE_D with no `node-created` is wrong — instead, seed NODE_D and assert it's untouched; NODE_C should assert blocking from cycle); EDGE_AB mirror has `data-diagnostic-severity="blocking"` + `data-diagnostic-kinds="contradiction"`. Per the predecessor leaves' pattern: assertions target the DOM mirror, not canvas pixels.
- `playwright.config.ts` — unchanged. `chromium-participant-skeleton` already matches `participant-graph-render.spec.ts`.
- `apps/participant/package.json` — unchanged. No new dependency.

### Files this task does NOT touch

- `apps/participant/src/routes/OperateRoute.tsx` — unchanged. The route composes `<GraphView>`; the diagnostic overlay is a `<GraphView>` internal.
- `apps/participant/src/main.tsx`, `apps/participant/src/App.tsx`, `apps/participant/src/layout/*` — unchanged.
- `apps/participant/src/graph/facetStatus.ts`, `apps/participant/src/graph/axiomMarks.ts`, `apps/participant/src/graph/annotations.ts` — unchanged. The four prior projections stay untouched; the diagnostic derivation is an independent module.
- `apps/moderator/` — no cross-surface change. The moderator's existing diagnostic-highlight seam stays where it is; the duplication is documented in the new participant `diagnosticHighlights.ts` header for the eventual shell extract.
- `packages/shell/`, `packages/shared-types/`, `packages/i18n-catalogs/` — unchanged. No new substrate, no new types, no new strings. The participant widens `BaseWsStoreState` locally (the moderator already does the same) — the shell base shape stays minimal.
- `apps/server/`, `apps/root/`, `apps/audience/` — unchanged.
- `docs/adr/` — no new ADR. Every decision below applies an existing ADR or mirrors a settled moderator-side decision.
- `.tji` files — `complete 100` on `part_diagnostic_highlights` lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual.

### Component shape (additions to `GraphView.tsx`)

Sketched (deltas only):

```ts
// Module scope — new
import {
  EMPTY_DIAGNOSTIC_HIGHLIGHTS,
  projectDiagnosticHighlights,
  type DiagnosticHighlight,
  type DiagnosticHighlightIndex,
} from './diagnosticHighlights';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

const EMPTY_DIAGNOSTICS_MAP: ReadonlyMap<string, DiagnosticPayload> = Object.freeze(new Map());

// STYLESHEET extension — FOUR new selectors appended after the existing
// annotation overlay block. Per Decision §3, severity drives ring intensity
// and width; node uses border-* (composes ON TOP of the per-status border
// because the per-status branch sets `border-color` only, and the per-
// status `border-style` is shared across all selectors at the baseline);
// edge uses underlay-* (Cytoscape edges don't accept overlay-* or border-
// *, so the underlay halo is the cleanest signal).
const STYLESHEET: StylesheetJson = [
  // ... existing baseline node + edge selectors (unchanged) ...
  // ... existing 12 per-status node + edge selectors (unchanged) ...
  // ... existing `node[?isAxiom]` axiom overlay (unchanged) ...
  // ... existing `node[?hasAnnotation]` + `edge[?hasAnnotation]` (unchanged) ...
  // Diagnostic ring (node — blocking)
  { selector: 'node[diagnosticSeverity = "blocking"]', style: {
    'border-color': '#b45309',  // amber-700
    'border-width': 4,
    'border-opacity': 0.9,
  } },
  // Diagnostic ring (node — advisory)
  { selector: 'node[diagnosticSeverity = "advisory"]', style: {
    'border-color': '#fbbf24',  // amber-400
    'border-width': 2,
    'border-opacity': 0.7,
  } },
  // Diagnostic halo (edge — blocking)
  { selector: 'edge[diagnosticSeverity = "blocking"]', style: {
    width: 5,
    'underlay-color': '#b45309',
    'underlay-opacity': 0.45,
    'underlay-padding': 4,
  } },
  // Diagnostic halo (edge — advisory)
  { selector: 'edge[diagnosticSeverity = "advisory"]', style: {
    width: 3,
    'underlay-color': '#fbbf24',
    'underlay-opacity': 0.3,
    'underlay-padding': 2,
  } },
];

// Inside the component — ONE new selector + ONE new memo.
const activeDiagnostics = useWsStore(
  (s) => s.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_DIAGNOSTICS_MAP,
);
const diagnosticHighlightIndex = useMemo(
  () => projectDiagnosticHighlights(activeDiagnostics),
  [activeDiagnostics],
);

// Projected memo — dependency widens
const projected = useMemo(
  () => projectGraph(
    events,
    facetStatusIndex,
    axiomMarkIndex,
    nodeAnnotationIndex,
    edgeAnnotationIndex,
    diagnosticHighlightIndex,
  ),
  [events, facetStatusIndex, axiomMarkIndex, nodeAnnotationIndex, edgeAnnotationIndex, diagnosticHighlightIndex],
);

// localized elements memo — also stamps a flat `diagnosticSeverity` slot
// for Cytoscape's per-data-value selector to match on. The Cytoscape
// selector grammar cannot reach into nested object fields, so we expose
// severity as a sibling primitive on top of the full DiagnosticHighlight.
const elements = useMemo(() => [
  ...projected.nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      diagnosticSeverity: node.data.diagnosticHighlight?.severity ?? 'none',
    },
  })),
  ...projected.edges.map((edge) => ({
    ...edge,
    data: {
      ...edge.data,
      diagnosticSeverity: edge.data.diagnosticHighlight?.severity ?? 'none',
    },
  })),
], [projected]);

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
  data-diagnostic-severity={diagnosticSeverityAttr(node.data.diagnosticHighlight)}
  data-diagnostic-kinds={diagnosticKindsAttr(node.data.diagnosticHighlight)}
/>
<li
  key={`edge-${edge.data.id}`}
  data-testid="participant-edge-status"
  data-edge-id={edge.data.id}
  data-rollup-status={rollupAttr(edge.data.rollupStatus)}
  data-facet-substance={facetAttr(edge.data.facetStatuses.substance)}
  data-has-annotation={hasAnnotationAttr(edge.data.hasAnnotation)}
  data-annotation-count={annotationCountAttr(edge.data.annotationCount)}
  data-diagnostic-severity={diagnosticSeverityAttr(edge.data.diagnosticHighlight)}
  data-diagnostic-kinds={diagnosticKindsAttr(edge.data.diagnosticHighlight)}
/>
```

## Acceptance criteria

The check that says "done":

- `apps/participant/src/graph/diagnosticHighlights.ts` exists, exports the verbatim moderator-port surface (`Wire*Diagnostic`, `WireDiagnostic`, `DiagnosticHighlight`, `DiagnosticHighlightIndex`, `EMPTY_DIAGNOSTIC_HIGHLIGHTS`, `diagnosticIdentityKey`, `affectedEntities`, `projectDiagnosticHighlights`) plus the three thin helpers (`nodeHasDiagnostic`, `edgeHasDiagnostic`, `diagnosticSeverityFor`). The header comment cites both the moderator source and the wire identity-key invariant.
- `apps/participant/src/graph/diagnosticHighlights.test.ts` covers the 12 Vitest cases listed under Constraints.
- `apps/participant/src/ws/wsStore.ts` extends the shell base with `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` per session; `applyDiagnostic` is widened to dispatch on `payload.status` via `diagnosticIdentityKey`; `lastDiagnostic` semantics preserved; `reset()` clears the new slot.
- `apps/participant/src/ws/wsStore.test.ts` covers the 6 new Vitest cases plus the adapted existing cases.
- `apps/participant/src/graph/projectGraph.ts`'s `projectGraph` signature widens to `(events, facetStatusIndex, axiomMarkIndex, nodeAnnotationIndex, edgeAnnotationIndex, diagnosticHighlightIndex)`; every emitted node AND edge data object carries `diagnosticHighlight: DiagnosticHighlight | null`.
- `apps/participant/src/graph/projectGraph.test.ts` covers the 6 new Vitest cases plus the adapted existing cases.
- `apps/participant/src/graph/GraphView.tsx`'s stylesheet grows the four `node[diagnosticSeverity = "..."]` + `edge[diagnosticSeverity = "..."]` selectors per Decision §3; one new `useMemo` derives `diagnosticHighlightIndex`; the per-node AND per-edge mirror `<li>` rows grow `data-diagnostic-severity` + `data-diagnostic-kinds`; the localized `elements` memo derives the flat `diagnosticSeverity` slot the stylesheet matches on.
- `apps/participant/src/graph/GraphView.test.tsx` covers the 7 new Vitest cases plus the adapted existing cases. Per ADR 0022, every behavioural assertion is a committed test case.
- `tests/e2e/participant-graph-render.spec.ts` adds the fifth `test()` block using `ivan` + `julia` per Decision §6; the describe stays `fullyParallel`. **Per ORCHESTRATOR.md UI-stream e2e policy**: the route IS reachable (settled by `part_graph_render`); the per-target mirror IS in place (settled by `part_per_facet_state_styling` + `part_axiom_mark_decoration` + `part_annotation_render`); the wire envelope IS reaching the participant (verified — see Inherited dependencies); the e2e is in scope. The spec asserts via the DOM mirror, not canvas pixels.
- **Failing-first verification per ADR 0022**: forcing `diagnosticHighlight: null` in both `projectGraph` branches must flip 5 of the 6 new `projectGraph` cases to red; the "null by default" case stays green. Document the verification in the Status block.
- `pnpm run check` clean.
- `pnpm run test:smoke` green; Vitest count rises by the new cases (12 diagnosticHighlights + 6 wsStore + 6 projectGraph + 7 GraphView = +31).
- `pnpm -F @a-conversa/participant build` succeeds (bundle grows by the diagnostic-highlight derivation + the widened store; expected, no new dependency).
- `pnpm run test:e2e:smoke` (with the compose stack up via `make up`) executes the extended spec and it passes; wall-clock for `chromium-participant-skeleton` is unchanged (the new block runs in parallel).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/40-participant-ui.tji` gets `complete 100` on `part_diagnostic_highlights` in the same commit (the Closer's ritual).

## Decisions

### §1 — Per-entity rollup carries severity + kind list at the at-a-glance card layer; per-diagnostic detail deferred to the entity detail panel; SYMMETRIC across node AND edge targets

The moderator's `mod_diagnostic_highlighting` renders an amber ring per affected entity, with severity-driven width / pulse and a native `title` tooltip listing the per-kind localized titles. The visual treatment is severity-discriminated (blocking vs advisory) but kind-collapsed at the at-a-glance layer (the moderator sees "this card has a problem"; the per-kind detail is in the tooltip).

The participant's at-a-glance card layer faces the same constraint: question (a) "does this entity carry an active structural diagnostic right now?" is the canvas scan signal — that's a presence + severity question; question (b) "which kinds of diagnostic, what specifically did the engine find?" is the drill-down — the per-kind localized title + description + detail + action.

Three options for the per-entity payload:

- **(a) `diagnosticHighlight: DiagnosticHighlight | null` carrying both `severity` and `kinds` array; tooltip / per-kind prose deferred to the entity detail panel.** Chosen. The two pieces of information answer the at-a-glance question completely (severity drives the ring width / color; kinds is what the detail panel needs to render the per-kind row when the entity is tapped). The detail panel imports the same `DiagnosticHighlight` shape and renders one row per kind with `t(\`diagnostics.${kind}.title\`)` (already populated in en-US / pt-BR / es-419).
- **(b) Boolean `hasDiagnostic` + per-severity flag, drop the kinds list at the projection layer.** Rejected: the kinds list is needed for the future detail panel; computing it here costs nothing (the projector already walks the active diagnostics) and exposing it on the projected `data` means the detail panel doesn't need to re-walk `activeDiagnostics`. Same "carry the seam for the future consumer" reasoning as `part_axiom_mark_decoration` Decision §8 and `part_annotation_render` Decision §8.
- **(c) Full per-diagnostic-list on the entity (every `DiagnosticPayload` that touches it).** Rejected as too heavy: the at-a-glance projection doesn't need the full payloads, just the rollup. The detail panel can re-walk `activeDiagnostics` with `affectedEntities` + a filter when it needs the full per-diagnostic data for a single entity (an `O(N_diagnostics)` walk that runs only on tap, vs an `O(N_entities × N_diagnostics)` per-entity attachment that runs on every projection tick).

Decision §1 (a): ship (a). The participant carries `DiagnosticHighlight | null` (rolled-up severity + deduped kind list) at the at-a-glance card layer. The per-kind / per-author / per-content breakdown lands in the entity detail panel.

**Symmetry across node AND edge targets**: same posture as `part_annotation_render` Decision §1 — `affectedEntities` returns both nodes AND edges. The five surfaced kinds + three coherency-hint sub-kinds break down as:

- `cycle` — nodes only.
- `contradiction` — nodes (the two contradicting statements) AND edges (the `contradicts` edges between them).
- `multi-warrant` — nodes only (data + claim + warrants).
- `dangling-claim` — node only.
- `coherency-hint.incomplete-warrant-missing-bridges-to` — nodes only.
- `coherency-hint.incomplete-warrant-missing-bridges-from` — nodes only.
- `coherency-hint.self-contradicts` — node AND edge.

Two of the kind/sub-kind combinations touch edges; the symmetric pattern this leaf adopts (a `DiagnosticHighlightIndex` with both `nodes` and `edges` maps; stamping on both `ParticipantNodeData` and `ParticipantEdgeData`) is the natural shape. Even if only one kind touched edges, the symmetric posture would be cheaper than the asymmetric special-case branching.

### §2 — Widen the participant's WS store with `activeDiagnostics`; do NOT push the slot into the shell yet

The participant's current `wsStore.ts` ([line 36](../../../apps/participant/src/ws/wsStore.ts#L36)) delegates entirely to `createDefaultWsStore()` from `@a-conversa/shell` — no per-surface extensions. The shell factory's `applyDiagnostic` reducer ([`packages/shell/src/ws/defaultStore.ts:119-129`](../../../packages/shell/src/ws/defaultStore.ts#L119)) only stamps `lastDiagnostic: payload` — it does NOT maintain an `activeDiagnostics` map. The moderator's `wsStore.ts` already extends `BaseWsStoreState` with `activeDiagnostics` per session (per [`mod_diagnostic_highlighting` §"Store widening"](../moderator-ui/mod_diagnostic_highlighting.md#L113)), and the shell-package-extraction refinement explicitly notes ([`packages/shell/src/ws/store-contract.ts:10-13`](../../../packages/shell/src/ws/store-contract.ts#L10)) that "Moderator-specific projections (the `activeDiagnostics` map keyed by `diagnosticIdentityKey`) live outside the shell".

Three options for the participant store:

- **(a) Push `activeDiagnostics` into the shell's `BaseWsSessionState` so both moderator and participant share the slot via `createDefaultWsStore()`.** Tempting on DRY grounds (the moderator and participant now both need the same slot). Rejected for now: the shell-package-extraction decision explicitly kept the slot OUT of the shell (the comment cites the `diagnosticIdentityKey` import dependency — pushing the slot into the shell also pushes the projection helper into the shell to maintain it). The third caller (audience surface, future) will be the trigger to extract `activeDiagnostics` AND `diagnosticIdentityKey` into the shell together; doing it with two callers risks shaping the seam around the second caller's specific needs.
- **(b) Extend the participant's `wsStore.ts` locally with `activeDiagnostics`, mirroring the moderator's pattern.** Chosen. This is symmetric with the moderator: both surfaces extend `BaseWsStoreState` with their own per-session slots; the shell stays minimal. The cost is a ~30-line widening of the participant store + a ~6-line test extension; reversible (when audience comes online and the shell extract happens, the participant simply switches back to importing the now-extended `createDefaultWsStore`).
- **(c) Compute the per-entity highlight at the canvas layer by repeatedly walking `lastDiagnostic` history.** Rejected: `lastDiagnostic` is one slot, not a log; the active set cannot be reconstructed from it. The fan-out per the WS broadcast surface ([`apps/server/src/ws/broadcast/diagnostic.ts`](../../../apps/server/src/ws/broadcast/diagnostic.ts)) sends one envelope per fired/cleared delta; an in-memory `activeDiagnostics` map fed by an `applyDiagnostic` reducer that dispatches on `status` is the only way to reconstruct the active set on the client.

Decision §2 (b): ship (b). Mirrors the moderator-side store widening. The shell's `BaseWsStoreState` stays the canonical contract; the participant extends it the same way the moderator does. The extract-into-shell trigger is the third caller (audience surface).

The participant's port carries the same drift-risk note the moderator's does: `diagnosticIdentityKey`'s formula MUST stay in lockstep with the server's `identityKeyFor`. The moderator's `diagnosticHighlights.test.ts` already pins the round-trip; the participant's port re-uses the same formula verbatim (Decision §1 of this section — the entire module ports verbatim), so a future drift fails the moderator test first.

### §3 — Diagnostic ring = Cytoscape `border-*` on nodes + `underlay-*` on edges; per-severity width + amber palette; composes WITH per-status / axiom / annotation branches

The diagnostic signal needs to be a visual layer that (a) reads at-a-glance as "this entity has a structural diagnostic", (b) composes cleanly with FOUR existing layers (per-status border-color, axiom-mark double-border, annotation amber overlay/underlay, plus the baseline), (c) discriminates blocking vs advisory severity, (d) is testable via the DOM mirror without canvas-pixel introspection.

This is the most constrained layering challenge of any of the five overlays so far. Let's enumerate what each prior layer owns on the node body:

- Per-status (`part_per_facet_state_styling`): `border-color`, `background-color`, `opacity`, `outline-*` (for the rollup status).
- Axiom-mark (`part_axiom_mark_decoration`): `border-style: 'double'`, `border-width: 3` (a "double 3px border" overlay).
- Annotation (`part_annotation_render`): `overlay-color: '#f59e0b'` (amber-500), `overlay-opacity: 0.15`, `overlay-padding: 4` (an amber overlay painted ON TOP of the node body, via Cytoscape's `overlay-*` layer).
- Baseline: `border-style: 'solid'`, `border-width: 1`, etc.

Three options for the node-side diagnostic signal:

- **(A) Reuse `overlay-*` with a stronger amber tint.** Rejected: would clobber the annotation's `overlay-color`. Cytoscape's overlay layer is one per element; the last selector in stylesheet order wins. The annotation overlay is already amber at 0.15; doubling it for diagnostics would lose the distinction "is this entity annotated AND/OR flagged?".
- **(B) Override `border-color` + `border-width` + `border-opacity` to amber.** Chosen. The per-status branch sets `border-color` (rose / slate / etc.); the diagnostic ring REPLACES that color with amber, with a heavier `border-width` than the per-status baseline (1) AND the axiom-mark overlay (3). Blocking gets `border-width: 4` + amber-700 + opacity 0.9; advisory gets `border-width: 2` + amber-400 + opacity 0.7. The override of `border-color` does suppress the rollup status border-color on that entity — but: (i) the participant's PRIMARY visual concern when a diagnostic fires is "the engine has found a structural problem here", which outranks "this facet has a particular agreement state"; (ii) the rollup status remains observable via the DOM mirror's `data-rollup-status` (test-pinnable, screen-reader-pinnable); (iii) the user-visible signal "the engine flagged this; please look here" is methodologically higher-priority than the rollup state (the rollup state is what the participants are voting on; the diagnostic is what's blocking them from progressing). The trade-off is documented; if real usage shows the suppression is confusing, a future polish leaf can swap to a layered `outline-*` ring (Cytoscape's `outline-*` is a separate layer from `border-*`; the moderator's Tailwind `ring-*` translates more closely to Cytoscape `outline-*` than to `border-*`).
- **(C) Use Cytoscape's `outline-*` properties for a true outer ring.** Initially appealing (outline is OUTSIDE the border, so it composes without overriding). Rejected because: per the Cytoscape stylesheet pattern in [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx), `outline-*` is already in use by the per-status branch for the rollup-state outer halo (`outline-color`, `outline-style`, `outline-width` — set on `proposed` / `disputed` / etc.). Using `outline-*` for diagnostics would clobber the per-status outline the same way (B) clobbers the per-status border. The choice between (B) and (C) is "which suppression is least bad?" — and per-status border-color suppression is less visually load-bearing than per-status outline suppression (the outline is the per-status status indicator; the border is the entity body outline). Hence (B).

Three options for the edge-side diagnostic signal:

- **(α) Reuse `underlay-*` with a stronger amber halo + heavier width bump.** Chosen. The annotation edge layer already uses `underlay-color: '#f59e0b'` + `underlay-opacity: 0.25` + `underlay-padding: 3` + `width: 4` on annotated edges. The diagnostic edge layer uses `underlay-color: '#b45309'` (amber-700, darker) + `underlay-opacity: 0.45` (heavier) + `underlay-padding: 4` + `width: 5` for blocking; `underlay-color: '#fbbf24'` (amber-400, lighter) + `underlay-opacity: 0.3` + `underlay-padding: 2` + `width: 3` for advisory. The stylesheet ordering puts diagnostic AFTER annotation, so for an edge that's both annotated AND flagged, the diagnostic underlay overrides the annotation's underlay (the engine signal wins, same as on the node side). The annotation status is still observable via the mirror's `data-has-annotation` attribute.
- **(β) Override `line-color` to amber.** Rejected: would clobber the per-status `line-color` (the methodology-state primary signal). Edges have no analog to the node's `outline-*` layer.
- **(γ) Use `line-style: 'dashed'`.** Rejected: per-status branches use `line-style` for `proposed` vs `agreed` vocabulary; flipping would suppress that signal.

Chosen: (B) for nodes + (α) for edges. Per-severity color (`#b45309` amber-700 for blocking, `#fbbf24` amber-400 for advisory) and per-severity width / opacity give three orthogonal axes of severity differentiation (color, width, opacity) — readable under any color-vision profile, no animation required. The amber family is the same the moderator uses, keeping the cross-surface visual identity stable.

The four selector entries (per `(target-kind, severity)` cell):

```ts
{ selector: 'node[diagnosticSeverity = "blocking"]', style: {
  'border-color': '#b45309', 'border-width': 4, 'border-opacity': 0.9,
} },
{ selector: 'node[diagnosticSeverity = "advisory"]', style: {
  'border-color': '#fbbf24', 'border-width': 2, 'border-opacity': 0.7,
} },
{ selector: 'edge[diagnosticSeverity = "blocking"]', style: {
  width: 5, 'underlay-color': '#b45309', 'underlay-opacity': 0.45, 'underlay-padding': 4,
} },
{ selector: 'edge[diagnosticSeverity = "advisory"]', style: {
  width: 3, 'underlay-color': '#fbbf24', 'underlay-opacity': 0.3, 'underlay-padding': 2,
} },
```

Stylesheet ordering: append these AFTER the existing annotation overlay block (so diagnostic wins on conflict) and AFTER the axiom-mark overlay (so diagnostic-on-an-axiom-marked-node renders the amber diagnostic border heavier than the axiom-mark's `border-style: 'double'`; the axiom-mark `border-style` does still apply because `[diagnosticSeverity = "..."]` doesn't override it — only `border-color`/`border-width`/`border-opacity`). The visual composition on a worst-case node (axiom-marked + annotated + per-status disputed + blocking diagnostic) is: per-status `background-color` + `outline-*` + amber-700 double-border at width 4 opacity 0.9 (diagnostic wins border, axiom-mark wins style, annotation overlay underneath). The four signals coexist; the diagnostic ring is the loudest.

### §4 — `diagnosticHighlight` stamped on the projection output (nested object), plus a flat `diagnosticSeverity` sentinel string for Cytoscape's selector grammar

Same shape question as `part_axiom_mark_decoration` Decision §4 and `part_annotation_render` Decision §4, but with one twist: Cytoscape's `[<key> = "<value>"]` data-equality selectors cannot reach into nested objects. `node[diagnosticHighlight.severity = "blocking"]` is NOT valid Cytoscape syntax; the matcher needs a flat string-typed `data` slot.

Two options:

- **(a) Stamp the full `DiagnosticHighlight | null` on `data.diagnosticHighlight` (per the symmetric overlay pattern of axiom-mark `data.isAxiom` and annotation `data.hasAnnotation` + `data.annotationCount`), AND derive a flat `data.diagnosticSeverity: 'blocking' | 'advisory' | 'none'` sibling slot for the stylesheet selectors.** Chosen. The two slots serve different consumers: the full `DiagnosticHighlight` is what the mirror reads (for `data-diagnostic-severity` + `data-diagnostic-kinds`) and what the future entity-detail-panel reads (for the per-kind localized rows); the flat `diagnosticSeverity` is what Cytoscape's selector grammar matches. The derivation is one `?:` per element; cheap.
- **(b) Drop the full `DiagnosticHighlight` and store only the flat `diagnosticSeverity` on `data`; reconstruct `kinds` from `activeDiagnostics` in the mirror / detail panel separately.** Rejected: the mirror needs both severity AND kinds (per Decision §5 — the `data-diagnostic-kinds` attribute is the test-pinnable seam for "we asserted the right kinds touched this entity"); forcing the mirror to re-derive kinds means re-walking the `activeDiagnostics` map at the render layer, duplicating the projection work.

Decision §4 (a): ship (a). Two slots, one full nested object + one flat sentinel string. The derivation lives in the localized `elements` memo where the `...node.data` spread already runs; the cost is one extra property per element per projection tick.

### §5 — DOM mirror adds `data-diagnostic-severity="blocking|advisory|none"` AND `data-diagnostic-kinds="<csv>"` on BOTH `<li>` row kinds; explicit "none" / explicit empty string (not omit-when-empty)

The DOM mirror is `aria-hidden="true"` and serves as the canvas-blind testability seam. The diagnostic signal extends BOTH the existing per-node AND per-edge `<li>` rows rather than adding new `<li>` rows — keeping the mirror row count tight.

Attribute encoding: explicit `"blocking"` / `"advisory"` / `"none"` for severity (sentinel string, never omit); explicit empty string `""` for no-kinds (when severity is `"none"`), explicit comma-joined sentinel list (`"cycle"`, `"cycle,multi-warrant"`, etc.) for non-empty. Same three reasons as Decision §5 of `part_axiom_mark_decoration` + Decision §5 of `part_annotation_render`:

- **Symmetry with `data-rollup-status` / `data-facet-*` / `data-is-axiom` / `data-has-annotation` / `data-annotation-count`.** All prior mirror attributes use sentinel strings rather than omission. The diagnostic attributes follow suit so the mirror's per-attribute presence is uniform.
- **Explicit not-flagged branch in Playwright.** Block 5 asserts `[data-diagnostic-severity="blocking"]` + `[data-diagnostic-kinds*="cycle"]` on the flagged entities AND `[data-diagnostic-severity="none"]` + `[data-diagnostic-kinds=""]` on the unflagged ones. The "none" / "" branches are real assertions — "we confirmed this entity is NOT diagnosed" — not the absence of an assertion.
- **Reader-friendliness.** A reader scanning the rendered DOM in devtools sees the diagnostic state for every entity, not just the flagged ones.

The `data-diagnostic-kinds` value is the deduped comma-joined kind list (encounter order preserved per the projection's rollup contract). The Playwright assertion uses `toHaveAttribute('data-diagnostic-kinds', 'cycle,contradiction')` for exact match OR `toContainText('cycle')` / `toContainText('contradiction')` for substring match when the order isn't load-bearing for the assertion.

The csv format is a small choice — alternatives include `data-diagnostic-kind-cycle="true"` / `data-diagnostic-kind-contradiction="true"` per-kind (Tailwind-style attribute splatting). Rejected: would inflate the mirror's per-row attribute count by 5 (one per kind) without making any assertion easier, AND would lose the encounter-order signal that the comma-joined list preserves naturally.

### §6 — Fifth `test()` block in the existing spec file using `ivan` + `julia`; describe stays `fullyParallel`

The existing `tests/e2e/participant-graph-render.spec.ts` describe has FOUR `test()` blocks running under `test.describe(...)` (parallel) per [line 123](../../../tests/e2e/participant-graph-render.spec.ts#L123). Per the part_e2e_user_pool_expansion refinement Status block ([line 42](part_e2e_user_pool_expansion.md#L42)), `ivan` + `julia` is the explicit earmark for this leaf.

Three options:

- **(a) Fifth `test()` block in the existing file using `ivan` + `julia`; describe stays `test.describe(...)` (`fullyParallel`).** Chosen. Reuses the spec file's existing helpers (`createSession`, `freshContext`, `logoutAndClearAllCookies`); the new block runs in its own worker concurrently with the prior four; wall-clock for the spec file is unchanged (~14s under parallel). The pair earmark from `part_e2e_user_pool_expansion` is honored — no in-file `users` upsert race, no per-session debater-A claim collision.
- **(b) New spec file `tests/e2e/participant-diagnostic-highlights.spec.ts` with its own setup-auth.** Rejected: would duplicate ~80 lines of fixture composition; the describe-level "5 blocks is the threshold to split" guidance from `part_axiom_mark_decoration` Decision §6 hasn't been formally re-set, but the pool expansion now provides headroom for the existing-file path. Future blocks beyond 6 may warrant the split; at 5 the additive block stays cleaner in the existing file.
- **(c) Use `alice` + `ben` and flip the describe back to `.serial`.** Rejected: the pool expansion specifically reverted the `.serial` regression; reusing the alice+ben pair would re-introduce the race (or force `.serial` back, undoing commit `d4f3247`).

Decision §6 (a): ship (a). The new block:

1. Sets up ivan + julia + the session + the lobby chain (mirroring block 4).
2. Navigates julia to `/p/sessions/${sessionId}` (manual `page.goto`).
3. Asserts `route-operate` + `participant-graph-root` + `participant-graph-status-mirror` visible.
4. Seeds events via `__aConversaWsStore.getState().applyEvent(...)`:
   - Three `node-created` events (NODE_A_ID, NODE_B_ID, NODE_C_ID; NODE_C is in the active diagnostics; we also want one node with no diagnostic to assert the negative branch — add NODE_D_ID so the mirror has an unaffected-node baseline).
   - One `edge-created` event (EDGE_AB_ID, source NODE_A → target NODE_B, role `contradicts`; the edge participates in the contradiction diagnostic).
5. Seeds diagnostics via `__aConversaWsStore.getState().applyDiagnostic(...)`:
   - A `fired` cycle on `[NODE_A_ID, NODE_B_ID, NODE_C_ID]` (blocking).
   - A `fired` contradiction on `(nodeA: NODE_A_ID, nodeB: NODE_B_ID, edges: [EDGE_AB_ID])` (blocking).
   - A `fired` multi-warrant on `(dataNodeId: NODE_C_ID, claimNodeId: NODE_A_ID, warrantNodeIds: [NODE_B_ID])` (advisory).
   - A `cleared` for the multi-warrant identity (so we pin both fired AND cleared paths within the block).
6. Asserts:
   - NODE_A mirror: `data-diagnostic-severity="blocking"`; `data-diagnostic-kinds` contains both `"cycle"` and `"contradiction"` (multi-warrant cleared, so absent).
   - NODE_B mirror: `data-diagnostic-severity="blocking"`; same kinds set as NODE_A.
   - NODE_C mirror: `data-diagnostic-severity="blocking"` (cycle still blocks); `data-diagnostic-kinds="cycle"` (multi-warrant cleared).
   - NODE_D mirror: `data-diagnostic-severity="none"`; `data-diagnostic-kinds=""`.
   - EDGE_AB mirror: `data-diagnostic-severity="blocking"`; `data-diagnostic-kinds="contradiction"`.

The block is ~80 lines on top of the shared helpers (larger than the prior blocks because of the four diagnostic seeds + the five-entity assertion table — three nodes flagged, one unflagged, one edge flagged).

### §7 — Read the active-diagnostic signal directly from `activeDiagnostics`, not from `lastDiagnostic` or the events log

`lastDiagnostic` carries ONE envelope (the most recent fired/cleared); the active set is N envelopes. The events log carries `node-created` / `edge-created` / `proposal` / etc. but NOT `diagnostic` (the wire envelope is a separate type, not a top-level `Event`). The only correct source for the active set is the per-session `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` slot the widened `applyDiagnostic` reducer maintains (Decision §2).

Two options:

- **(a) Read `activeDiagnostics` via a per-session `useWsStore` selector; project once per `activeDiagnostics` reference change.** Chosen. The `useMemo` for `diagnosticHighlightIndex` runs only when the map identity changes (which happens on every `applyDiagnostic` reducer pass, but is cheap to project).
- **(b) Walk the events log to derive diagnostics.** Rejected: diagnostics are NOT events; they're broadcast envelopes derived server-side from the projection. The participant cannot reconstruct them from `events`.
- **(c) Compute the index lazily on every render without memoization.** Rejected: `O(N_diagnostics × max(payload entity count))` per render, even when nothing changed. The memo is one line and stabilizes the reference; downstream `useMemo([projected])` chains benefit.

Decision §7 (a). Memo dependency is `[activeDiagnostics]`; the per-session selector with the `EMPTY_DIAGNOSTICS_MAP` default ensures the reference is stable when no session exists yet.

### §8 — Export the three thin helpers (`nodeHasDiagnostic`, `edgeHasDiagnostic`, `diagnosticSeverityFor`); keep the full `DiagnosticHighlightIndex` reachable for future consumers

The `diagnosticHighlights.ts` module exports:

- `projectDiagnosticHighlights(activeDiagnostics): DiagnosticHighlightIndex` — the canonical projection (verbatim port).
- `affectedEntities(payload)` — per-kind narrow (verbatim port).
- `diagnosticIdentityKey(payload)` — identity key (verbatim port).
- `nodeHasDiagnostic(index, nodeId): boolean` — presence helper.
- `edgeHasDiagnostic(index, edgeId): boolean` — presence helper.
- `diagnosticSeverityFor(index, target: 'node' | 'edge', id): DiagnosticHighlightSeverity | 'none'` — severity-or-`'none'` helper.

The at-a-glance projection inlines the presence + severity check directly from `index.nodes.get(id) ?? null` (`projectGraph`'s node-creation branch), so the thin helpers aren't strictly needed by THIS leaf — but exposing them now keeps the future consumers from refactoring the seam. Same rationale as `part_axiom_mark_decoration` Decision §8 + `part_annotation_render` Decision §8.

The future consumers:

- The entity detail panel (`part_entity_detail_panel`) will use `nodeHasDiagnostic` / `edgeHasDiagnostic` as the precondition for rendering the per-kind localized row.
- The future participant-side methodology-suggestions surface (parallel to the moderator's `mod_diagnostic_methodology_suggestions`) will use `diagnosticSeverityFor` to drive the per-suggestion prominence.
- A future "axiom-mark to resolve a cycle" gesture (per `docs/methodology.md:224-225`) will use `nodeHasDiagnostic(index, nodeId)` to gate the "your axiom-mark would resolve this cycle" prompt.

The full `DiagnosticHighlightIndex` stays the public projection seam; the thin helpers are convenience wrappers over `.nodes.get(...)` / `.edges.get(...)`.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- Participant store widened with an `activeDiagnostics` map slot + `applyDiagnostic` extension, mirroring the moderator pattern (`apps/participant/src/ws/wsStore.ts`, `apps/participant/src/ws/wsStore.test.ts` — 6 new store cases).
- Diagnostic projector ported verbatim from moderator with three thin presence/severity helpers (`projectDiagnosticHighlights`, `affectedEntities`, `diagnosticIdentityKey`, `nodeHasDiagnostic`, `edgeHasDiagnostic`, `diagnosticSeverityFor`) at `apps/participant/src/graph/diagnosticHighlights.ts` with 12 unit cases at `apps/participant/src/graph/diagnosticHighlights.test.ts`.
- `projectGraph` widened to a sixth `DiagnosticHighlightIndex` arg and stamps `diagnosticHighlight: DiagnosticHighlight | null` symmetrically on both node and edge `data` — cycles + contradictions touch edges, multi-warrant touches nodes (`apps/participant/src/graph/projectGraph.ts`, `apps/participant/src/graph/projectGraph.test.ts` — 6 new projection cases).
- Cytoscape stylesheet gains four new `node[?diagnosticSeverity]` / `edge[?diagnosticSeverity]` selectors layered cleanly with annotation overlay/underlay and axiom border-style; diagnostic `border-color` overrides per-status border-color because diagnostic outranks rollup state (`apps/participant/src/graph/GraphView.tsx`, `apps/participant/src/graph/GraphView.test.tsx` — 7 new component cases).
- DOM mirror rows on both nodes and edges grew `data-diagnostic-severity` + `data-diagnostic-kinds` csv attrs so deterministic assertions work without driving the canvas itself.
- Playwright block 5 in `tests/e2e/participant-graph-render.spec.ts` (ivan + julia) seeds all four diagnostic kinds — cycle, contradiction, multi-warrant, cleared multi-warrant — and asserts the per-entity mirror table; chromium-participant-skeleton stays 14/14 green at 21.8s under parallel workers (per-block ~11.4s, within baseline).
- Failing-first verification per ADR 0022: forcing `diagnosticHighlight: null` in both node-created and edge-created branches flipped 10 positive cases red across `projectGraph.test.ts` and `GraphView.test.tsx`; the null-baseline cases stayed green. Stamps restored, full suite back to 3929/3929.
