# Render the live graph (participant tablet, read-only)

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_graph_render`
**Effort estimate**: 2d
**Inherited dependencies**:

- `!participant_ui.part_shell` (group; settled — every leaf under `part_shell` is `complete 100`. `part_app_skeleton` ships the `/p/*` library-mode bundle + the `<BrowserRouter basename="/p">`; `part_state_management` ships the participant's `useWsStore` singleton at [`apps/participant/src/ws/wsStore.ts:36`](../../../apps/participant/src/ws/wsStore.ts#L36); `part_ws_client` mounts `<WsClientProvider>` at the surface boundary in [`apps/participant/src/main.tsx:77-85`](../../../apps/participant/src/main.tsx#L77); `part_auth_flow` wires `useAuth()` through `<ParticipantChrome>`; `part_landscape_layout` ships `<ParticipantLayout>` with the four named-region testids; `part_status_indicator` plugs the chip into the footer slot).
- `foundation.stack_decisions.graph_lib_decision` (settled — [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) picks **Cytoscape.js** for the participant tablet, audience, and replay surfaces; **ReactFlow** is reserved for the interactive-edit moderator console. The participant surface is read-mostly — pan/zoom/tap-to-detail, no drag-to-create-edge — so it sits on the read-only side of the split).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_session_join.part_lobby_view` (settled, commit `5932395` — the lobby route at `/p/sessions/:id/lobby` already mounts a per-session `client.trackSession(id)` lifecycle, so by the time the moderator's start-debate gesture lands the debater on `/p/sessions/:id` the WS subscription is hot. This leaf's `useEffect` re-tracks the same session id on mount and the call is idempotent per `ws-client.test.ts:547`).
- Prose-only context (NOT a `.tji` edge): `moderator_ui.mod_graph_rendering.mod_node_rendering` + `mod_edge_rendering` + `mod_graph_canvas_pane` (all settled — the moderator's canvas is the reference projection-and-render pipeline this leaf adapts. Node/edge projection from the WS event log, the per-session events selector, the empty-events stable reference, the per-session `useWsStore` slice shape, and the methodology-glossary i18n keys (`methodology.kind.*`, `methodology.edgeRole.<role>.label`) are all reused; the participant version differs in graph library (Cytoscape vs ReactFlow) and interaction profile (read-mostly vs interactive-edit)).
- Prose-only context (NOT a `.tji` edge): `data_and_methodology.event_types.*` + `data_and_methodology.methodology_engine.*` (settled — the wire-event vocabulary the projection reads (`node-created`, `edge-created`, `proposal`/`commit` of `classify-node`) and the entity-vs-facet separation pinned by [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) are stable; per ADR 0027 a `node-created` lands at propose-time, so the canvas renders proposed entities from the moment of proposal).

## What this task is

The participant tablet's read-mostly graph view at `/p/sessions/:id` — the first surface a debater sees once the moderator triggers the start-debate transition out of the lobby. After this leaf:

- The participant `<App>` route table at [`apps/participant/src/App.tsx:109-117`](../../../apps/participant/src/App.tsx#L109) grows a `<Route path="/sessions/:id" element={<OperateRoute />} />` entry (above the existing `/sessions/:id/invite` and `/sessions/:id/lobby` entries; the wildcard catch-all stays as the fallback). The new route renders the surface a debater watches the live debate from.
- A new `<OperateRoute>` component at `apps/participant/src/routes/OperateRoute.tsx` reads `:id` via `useParams()`, mounts the per-session `client.trackSession(id)` / `untrackSession(id)` lifecycle (idempotent re-subscription with the lobby's prior call), composes the existing chrome (`<ParticipantLayout header={<ParticipantChrome />} main={<GraphView sessionId={id} />} footer={<ParticipantStatusIndicator />} />`), and threads the session id into the graph view.
- A new `<GraphView>` component at `apps/participant/src/graph/GraphView.tsx` mounts a Cytoscape.js canvas, subscribes to the per-session `useWsStore((s) => s.sessionState[id]?.events)` slice, projects the event log into Cytoscape node + edge elements via a pure `projectGraph(events)` function (exported for direct testing), renders one Cytoscape `node` per committed-or-proposed `node-created` with its wording + localized kind label, renders one Cytoscape `edge` per `edge-created` with its localized role label, and applies a small read-only stylesheet (rounded node body, role-label on edges, dot grid background, neutral palette).
- The view is **read-mostly** per [docs/participant-ui.md](../../../docs/participant-ui.md#L52-L72) (P1: view the graph): pan + zoom + tap-to-detail are in scope (downstream leaves: `part_pan_zoom_tap`, `part_entity_detail_panel`); per-facet state styling, axiom-mark decoration, annotation rendering, vote indicators, and diagnostic highlights are explicit out-of-scope siblings (`part_per_facet_state_styling`, `part_axiom_mark_decoration`, `part_annotation_render`, `part_own_vote_indicators` / `part_other_vote_indicators`, `part_diagnostic_highlights`). This task lands the *rendering surface*; the visual-vocabulary layers plug in via the sibling tasks under `part_graph_view`.
- The node body shows the **wording** (top, prominent) and the **localized kind label** below it (small uppercase tag; em-dash placeholder for unclassified — mirrors the moderator's [`StatementNode`](../../../apps/moderator/src/graph/StatementNode.tsx) behaviour pinned by `mod_node_rendering`). The edge carries a **localized role label** drawn at its midpoint (same `methodology.edgeRole.<role>.label` source the moderator uses per `mod_edge_rendering`). No vote dots, no per-facet pills, no axiom badges — those are sibling tasks.
- The projection follows the moderator's `projectNodes` / `selectEdgesForSession` shape line-for-line (split: nodes inside `projectGraph`, edges as part of the same pass) but emits **Cytoscape element descriptors** (`{ group: 'nodes', data: { id, label, kind, wording } }` and `{ group: 'edges', data: { id, source, target, role } }`) instead of ReactFlow `Node[]` / `Edge[]`. The wire-event vocabulary is identical (ADR 0027); the output shape differs because the renderer differs.
- Layout uses Cytoscape's built-in `cose` (force-directed) layout for v1 — no dagre dependency on the participant side (dagre is a moderator-only dependency per `mod_layout_engine_choice`). The participant's layout needs are different (read-only, no incremental "don't move what's already laid out" constraint; the moderator's incremental-layout caching is overkill here). `cose` is part of Cytoscape's bundled layouts; no additional dependency. Decision §3 documents the alternatives.
- Per ADR 0026, the WS-store / WS-client substrate already comes from `@a-conversa/shell` and is consumed verbatim. No new shell exports; the projection lives in the participant workspace (Decision §4 — extraction to the shell is premature with only two callers, and the moderator's projection is ReactFlow-shaped today, so there's no shared output type yet anyway).
- All new user-facing strings land under the existing `methodology.kind.*` + `methodology.edgeRole.<role>.label` keys (already populated for en-US / pt-BR / es-419 per [`tasks/refinements/frontend-i18n/i18n_methodology_glossary.md`](../frontend-i18n/i18n_methodology_glossary.md)). No new i18n keys in this leaf (the empty-canvas hint is intentionally minimal; see Decision §7).
- Tests pin: Vitest at the projection layer (`projectGraph(events)` as a pure function) + the React-render layer (`<GraphView>` mounted with a seeded WS store renders the right Cytoscape elements via the test-exposed `cy` handle); Playwright at the e2e layer under `chromium-participant-skeleton` — one scenario authenticates a debater, drives them through the invite → lobby chain, simulates the moderator's start-debate transition (the gesture is `mod_session_lobby`'s "Enter session" button; for this leaf the participant navigates directly to the route since the navigation hook is `part_session_start_handoff`'s deliverable, not this leaf's), and asserts both a `node-created` and an `edge-created` event seeded into the per-session store render as visible Cytoscape elements with their wording + role label. Decision §6 settles the Playwright shape (seed-via-WS-store rather than drive-via-moderator-context, to keep the e2e budget on the lobby-already-pays side).

Out of scope (deferred to existing or future leaves):

- **Per-facet state styling** (proposed dashed / agreed solid / disputed marker / meta-disagreement split) — owned by `part_per_facet_state_styling` (1d, depends `!part_graph_render`). This leaf renders every node and edge with a neutral baseline style; the styling layer extends `<GraphView>`'s Cytoscape stylesheet in its own commit.
- **Per-participant axiom-mark decoration** — owned by `part_axiom_mark_decoration` (0.5d, depends `!part_graph_render`). The moderator renders axiom-mark badges via [`AxiomMarkBadge`](../../../apps/moderator/src/graph/AxiomMarkBadge.tsx); the participant equivalent attaches the same data via the projection in its own commit.
- **Annotation rendering** — owned by `part_annotation_render` (0.5d, depends `!part_graph_render`).
- **Diagnostic highlights** (cycle / contradiction / multi-warrant halos) — owned by `part_diagnostic_highlights` (0.5d, depends `!part_graph_render`).
- **Pan + zoom + tap-to-detail interactions** — owned by `part_pan_zoom_tap` (1d, depends `!part_graph_render`) and `part_entity_detail_panel` (1d, depends `!part_pan_zoom_tap`). Cytoscape's default pan/zoom is on; this leaf does NOT pin a `minZoom` / `maxZoom` bound or wire any tap handler — those are the dedicated tasks' deliverables.
- **Per-debater own-vote / other-vote indicators** — owned by `part_own_vote_indicators` (1d) + `part_other_vote_indicators` (1d), depending transitively on `!part_per_facet_state_styling`.
- **Per-facet voting buttons** — owned by `part_voting.part_vote_button_per_facet` and the rest of the `part_voting.*` group.
- **Pending proposals pane** — owned by the entire `part_pending_proposals.*` group (a sibling under `part_session_join`'s downstream).
- **`mod_session_lobby`'s start-debate transition** (the moderator gesture that takes participants from the lobby to the operate view). For now, the participant lobby is the terminal surface for `m_manual_lobby_smoke`; the navigation handoff (a future leaf, likely `part_session_start_handoff` or folded into `part_lobby_view` as an amendment) decides whether to subscribe to a `debate-started`-style event or to let the URL change drive the route swap. THIS leaf only delivers the destination; how the user gets there is the future leaf's concern.
- **Touch / pinch / tap gesture polish** — owned by `part_pw_touch_simulation` and `part_pan_zoom_tap`.
- **Visual regression on the rendered graph** — owned by `part_vr_state_styling`. Pixel comparisons are deferred until the state-styling layer lands; this leaf's e2e pin is behavioral (elements rendered, labels visible), not pixel-level.
- **Extraction of shared graph types into `@a-conversa/shell`** — premature with two callers whose output shapes diverge (ReactFlow vs Cytoscape). Decision §4 documents the YAGNI rationale; a future `aud_graph_rendering` (the audience surface, also Cytoscape) becomes the third caller and the natural extraction trigger.

## Why it needs to be done

`m_participant_mvp` ([`tasks/99-milestones.tji`](../../99-milestones.tji)) is the milestone at which a debater can see and engage with the live graph from their tablet. The milestone's `depends` line names the whole `part_graph_view` group transitively; **this leaf is the foundation** every other leaf under `part_graph_view` depends on (`part_per_facet_state_styling`, `part_axiom_mark_decoration`, `part_annotation_render`, `part_diagnostic_highlights`, `part_pan_zoom_tap` all carry `depends !part_graph_render`). Without this leaf, the chain stalls:

1. Moderator generates invites; debaters accept; both land in the participant lobby (settled — `m_manual_lobby_smoke` proved this).
2. Moderator clicks Enter-session (settled via `mod_session_lobby` per the cross-surface spec at `tests/e2e/cross-surface-lobby-start.spec.ts`); the moderator advances to `/m/sessions/:id/operate` and starts capturing.
3. The first `node-created` broadcast lands in every participant's `useWsStore.sessionState[id].events` slice.
4. **Today**: the participant has no route that renders the graph. Their lobby route's WS subscription receives the event but their viewport has nothing to show — the chain stalls on the participant side at the lobby. The methodology assumes the debater sees the same graph the moderator does (per [docs/methodology.md](../../../docs/methodology.md#L33-L41) — "the proposal is visible on the graph in a distinct state from the moment it is made"); without a render, the agreement loop the format depends on cannot close.
5. **After this leaf**: when the moderator transitions the debate (or the participant navigates to `/p/sessions/:id` directly), the participant's `<OperateRoute>` mounts `<GraphView>`, the same `useWsStore` slice the lobby read from feeds the projection, and the debater sees the live graph — wording + classification visible per node, role labels visible per edge. Every downstream `part_graph_view.*` leaf has the rendering surface it needs to plug visual layers (state styling, vote indicators, axiom-marks, annotations, diagnostics) onto.

Downstream concretely:

- **`part_per_facet_state_styling`** extends `<GraphView>`'s Cytoscape stylesheet with per-facet-status selectors (`node[facetStatus.classification = 'proposed']`, `edge[facetStatus.substance = 'agreed']`, etc.). The projection in this leaf carries the facet-status data on each element's `data` object (Decision §5 — projection emits facet-status info from day one, even though the stylesheet doesn't read it yet); the styling task is then a stylesheet-only commit.
- **`part_axiom_mark_decoration`** consumes per-node axiom-mark data — the projection adds the field alongside the existing node data (per the moderator's `projectAxiomMarks` pattern) and the decoration task lands the SVG / DOM badge overlay.
- **`part_pan_zoom_tap` + `part_entity_detail_panel`** consume the `<GraphView>` Cytoscape instance via the seam this leaf installs — `<GraphView>` exposes its Cytoscape handle through a `cyRef` callback prop so downstream tasks attach pan/zoom config and tap handlers without forking the component.
- **`part_voting`** uses the graph as the entity-selection surface (the methodology's "tap an entity, see its facets, vote per facet" loop per [docs/participant-ui.md P2](../../../docs/participant-ui.md#L61-L73)).

Architecturally, this leaf is the **second concrete validation of ADR 0004's two-library split**. The moderator surface proved ReactFlow generalizes for interactive-edit; this leaf proves Cytoscape generalizes for read-mostly. The audience surface (and replay) will follow the same `<GraphView>` shape — Cytoscape mount + pure projection from the per-session events slice. The participant version is the first Cytoscape consumer in the workspace; the patterns it sets (component shape, projection-function name, test-handle exposure, stylesheet location) become the template for `aud_graph_render` (a future leaf under `audience.aud_graph_rendering`).

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the surface split. Decision: Cytoscape.js for the **participant tablet** (this leaf), audience, and replay; ReactFlow for the moderator. Cytoscape's strengths cited: layout algorithms, animation hooks, customizable styling for distinct facet/state rendering, OBS-friendly. Stack-validation sketch at [`scripts/hello-cytoscape.ts`](../../../scripts/hello-cytoscape.ts) (the throwaway smoke that proved the import resolves and an `{ group: 'nodes' }` / `{ group: 'edges' }` element graph constructs).
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the `node-created` / `edge-created` / `proposal` / `commit` payloads the projection reads; the shell client validates incoming envelopes at parse time so the projection trusts the shape.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behavioral assertion below is a committed Vitest case or Playwright scenario.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation()` is the participant surface's localization seam; this leaf consumes `methodology.kind.*` and `methodology.edgeRole.<role>.label` from the existing catalog.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the surface owns its mounted region only; `useAuth()`, `useWsClient()`, `useWsStore`, and i18n all come from `@a-conversa/shell`. No new shell substrate in this leaf.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the propose handler emits `node-created` / `edge-created` at propose-time, so the canvas renders proposed entities from the moment of proposal. The projection here does NOT gate node rendering on commit; rendering follows entity-layer events; per-facet status is a separate `data` field consumed by `part_per_facet_state_styling` (this leaf carries it forward for the consumer).

### Sibling refinements

- [`tasks/refinements/participant-ui/part_lobby_view.md`](part_lobby_view.md) — the predecessor surface this leaf composes alongside. The lobby's `client.trackSession(id)` lifecycle is the canonical per-session subscription pattern this leaf re-uses; the re-subscription is idempotent so the lobby → operate transition is clean. The lobby's `useWsStore((s) => s.sessionState[id]?.events)` selector is the canonical events-read pattern; this leaf reuses the exact same shape (return the events array verbatim, no `?? []` inside the selector — the `?? EMPTY_EVENTS` fallback lives at the consumer).
- [`tasks/refinements/participant-ui/part_landscape_layout.md`](part_landscape_layout.md) — the chrome composition this leaf renders inside. `<ParticipantLayout header={<ParticipantChrome />} main={<GraphView sessionId={id} />} footer={<ParticipantStatusIndicator />} />` — same composition shape every other participant route uses.
- [`tasks/refinements/participant-ui/part_status_indicator.md`](part_status_indicator.md) — the footer chip surfaces WS connection state during the graph view's lifetime. A WS disconnect during the operate view is visible through the chip; the graph itself does not duplicate that signal (the operate view's role is to render whatever the local slice carries; the chrome's role is to surface connectivity).
- [`tasks/refinements/participant-ui/part_ws_client.md`](part_ws_client.md) — the surface-wide `<WsClientProvider>` mount means `useWsClient()` and `useWsStore` are available from every route inside the router. This leaf consumes both; no new provider mount.
- [`tasks/refinements/participant-ui/part_state_management.md`](part_state_management.md) — the participant `useWsStore` delegates to `createDefaultWsStore()`; the per-session `events` slice has the exact shape the moderator's projection consumes (`BaseWsSessionState.events: Event[]`), so the projection logic carries over with only the output-shape change.
- [`tasks/refinements/moderator-ui/mod_graph_canvas_pane.md`](../moderator-ui/mod_graph_canvas_pane.md) — the canonical "mount the graph library, register a `data-testid="graph-canvas-root"`, leave node/edge rendering to sibling tasks" pattern. The participant equivalent uses `data-testid="participant-graph-root"` (Decision §8 on testid naming) and DOES land node/edge rendering in this leaf — the moderator's three-task split (mount → nodes → edges) collapses into one for the participant because (a) the participant's interaction profile is read-only so there's no "mount first, wire interactions later" need; (b) Cytoscape is imperative — registering element data IS the mount, you can't `<Cytoscape />` with `nodes={[]}` like ReactFlow.
- [`tasks/refinements/moderator-ui/mod_node_rendering.md`](../moderator-ui/mod_node_rendering.md) — the canonical projection pattern this leaf mirrors. `projectNodes(events)` walks the event log once, picks `node-created` (one node per id, `kind: null` initially), resolves `commit`-of-`classify-node` proposals to flip the kind onto the cached node, ignores other event kinds. The participant equivalent (`projectGraph` — combined for nodes+edges per Decision §5) follows the same algorithm: walk once, accumulate, return.
- [`tasks/refinements/moderator-ui/mod_edge_rendering.md`](../moderator-ui/mod_edge_rendering.md) — the canonical edge selector + custom-edge pattern. `selectEdgesForSession(state, sessionId)` picks every `edge-created`, maps to `{ id: payload.edge_id, source: payload.source_node_id, target: payload.target_node_id, data: { role: payload.role } }`. The participant equivalent emits `{ group: 'edges', data: { id, source, target, role } }` per Cytoscape's element shape; same input → same identity-mapped output.
- [`tasks/refinements/moderator-ui/mod_layout_engine_choice.md`](../moderator-ui/mod_layout_engine_choice.md) — the moderator's `@dagrejs/dagre` layout pass + position cache. The participant does NOT inherit dagre — `cose` is built into Cytoscape, no extra dependency, and the participant's no-incremental-edits profile doesn't need the cache. Decision §3 documents the choice.
- [`tasks/refinements/shell-package/shared_shell_extract_merge_slots_and_derive_slot_occupants.md`](../shell-package/shared_shell_extract_merge_slots_and_derive_slot_occupants.md) — the precedent for "two callers is YAGNI; extract when the third caller materializes." The participant's `projectGraph` is the second projector after the moderator's; per the same policy, extraction waits for `aud_graph_render` to be the third caller. Decision §4.

### Live code the leaf plugs into

- [`apps/participant/src/App.tsx:109-117`](../../../apps/participant/src/App.tsx#L109) — the current route table. This leaf inserts `<Route path="/sessions/:id" element={<OperateRoute />} />` between the existing `/sessions/:id/lobby` entry and the `*` catch-all. The route is `useParams<{ id: string }>`-driven; the `OperateRoute` component reads `:id` and threads it into `<GraphView>`.
- [`apps/participant/src/routes/LobbyRoute.tsx:195-222`](../../../apps/participant/src/routes/LobbyRoute.tsx#L195) — the canonical per-session subscription lifecycle: `useEffect` calls `void client.trackSession(id)` on mount; cleanup calls `void client.untrackSession(id)`. The new `<OperateRoute>` follows the same pattern with the same `id` (idempotent on re-track per `ws-client.test.ts:547`).
- [`apps/participant/src/ws/wsStore.ts:36`](../../../apps/participant/src/ws/wsStore.ts#L36) — the participant's `useWsStore` singleton. The selector `(state) => state.sessionState[sessionId]?.events` is the canonical per-session events read; same shape `LobbyRoute.tsx:379` already uses.
- [`apps/participant/src/main.tsx:77-85`](../../../apps/participant/src/main.tsx#L77) — `<WsClientProvider>` already mounted at the surface boundary; this leaf consumes `useWsClient()` and `useWsStore` without adding a second provider.
- [`apps/participant/src/layout/ParticipantLayout.tsx`](../../../apps/participant/src/layout/ParticipantLayout.tsx) + [`ParticipantChrome.tsx`](../../../apps/participant/src/layout/ParticipantChrome.tsx) + [`ParticipantStatusIndicator.tsx`](../../../apps/participant/src/layout/ParticipantStatusIndicator.tsx) — the chrome the new route composes around the graph view body.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx:433-578`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L433) — `projectNodes` (the canonical projection for nodes). The participant's `projectGraph` mirrors the algorithm — single-pass walk, `node-created` emits a node, classify-node `proposal` cached by envelope id, `commit` of a cached proposal flips the kind onto the node — but emits Cytoscape element descriptors.
- [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts) — `selectEdgesForSession` (the canonical edge projection). Same shape; participant emits Cytoscape `{ group: 'edges', data: { ... } }`.
- [`apps/moderator/src/graph/StatementNode.tsx`](../../../apps/moderator/src/graph/StatementNode.tsx) — the moderator's custom node component (wording + localized kind label, em-dash placeholder for unclassified). The participant equivalent is **NOT** a React custom-node (Cytoscape renders the body via stylesheet + DOM-overlay; React isn't in the render loop for Cytoscape nodes) — the wording + kind label are rendered as Cytoscape `label` text on the node element with a small CSS-driven secondary line for the kind tag. Decision §2 documents the trade-off.
- [`apps/moderator/src/graph/StatementEdge.tsx`](../../../apps/moderator/src/graph/StatementEdge.tsx) — the moderator's custom edge with `<EdgeLabelRenderer>`. The participant equivalent uses Cytoscape's built-in `label` selector on the edge element to draw the role label at the midpoint of the curve — same visual goal, library-native mechanism.
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — the `Event` discriminated union the projection walks. Specifically: `NodeCreatedPayload` (`node_id`, `wording`), `EdgeCreatedPayload` (`edge_id`, `role`, `source_node_id`, `target_node_id`), `ProposalEventPayload`'s `classify-node` sub-shape (`node_id`, `classification`), and the `CommitEventPayload`'s `proposal_id`.
- [`packages/shell/src/ws/store-contract.ts:44-53`](../../../packages/shell/src/ws/store-contract.ts#L44) — `BaseWsSessionState.events: Event[]` is the per-session dedup'd event log this leaf selects from.
- [`packages/shell/src/ws/client.ts:139-141`](../../../packages/shell/src/ws/client.ts#L139) + [`477-503`](../../../packages/shell/src/ws/client.ts#L477) — `trackSession` / `untrackSession`. The route's `useEffect` calls them with `void`, mirroring both the moderator's `Operate.tsx` pattern at [`apps/moderator/src/routes/Operate.tsx:156-162`](../../../apps/moderator/src/routes/Operate.tsx#L156) and the lobby's pattern.
- [`packages/i18n-catalogs/src/catalogs/en-US.json:29-67`](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L29) — the `methodology.kind.*` + `methodology.edgeRole.<role>.label` keys, already populated for en-US / pt-BR / es-419. No new keys.

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts) — `loginAs(page, { username })` drives a full OIDC dance. The spec uses it for alice (moderator, creates the session) and ben (debater-A).
- [`tests/e2e/participant-lobby.spec.ts:58-69`](../../../tests/e2e/participant-lobby.spec.ts#L58) — the `createSession(page, { topic, privacy })` helper. The new spec copies the helper (Decision §6 follows the same "copy until the third caller; then extract" rule the lobby spec used).
- [`playwright.config.ts:303-319`](../../../playwright.config.ts#L303) — `chromium-participant-skeleton` project. Current testMatch widens to accept `participant-(skeleton-smoke|invite-acceptance|lobby|graph-render)\.spec\.ts$`. Same mechanical change `part_invite_acceptance` and `part_lobby_view` already made.

### What the surface MUST NOT do

- **No `createWsClient()` call in the route.** Inherits the lobby / invite rules — `useWsClient()` from the surface-wide provider only.
- **No `fetch('/api/...')` from the graph view.** This leaf is rendering-only; the per-session WS slice is the single data source. No HTTP fetch for graph data.
- **No write paths on the WS connection.** The route does NOT call `useWsClient().send(...)` for any kind. Voting / proposals / axiom-marks are downstream tasks' deliverables.
- **No mutation of the `useWsStore`.** Read-only via the selector; writes happen exclusively through the shell client's dispatch (which the WS client owns).
- **No second `<WsClientProvider>` mount.** Surface-wide provider only.
- **No new top-level dependency without an ADR.** Cytoscape is already declared by ADR 0004; this leaf only adds it to the participant workspace's `package.json` (no new ADR — the ADR already pins it for this surface).
- **No drag-to-create-edge, no context menus, no inline edit.** Read-only profile per ADR 0004 and per [docs/participant-ui.md](../../../docs/participant-ui.md). Those gestures are moderator-exclusive.
- **No `localStorage` / `sessionStorage` writes.** In-memory only; route-local state is `useState`.
- **No `window.location` writes from the graph view.** Navigation handoffs (lobby → operate; operate → withdraw confirmation; etc.) are router-driven, not direct window writes.
- **No layout cache / dagre dependency.** Cytoscape's built-in `cose` layout is the v1 layout (Decision §3); the moderator's incremental-layout caching at [`apps/moderator/src/graph/layoutEngine.ts`](../../../apps/moderator/src/graph/layoutEngine.ts) does not generalize to the participant's read-mostly profile.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/App.tsx` — modified. Adds an import for `OperateRoute` from `./routes/OperateRoute` and inserts `<Route path="/sessions/:id" element={<OperateRoute />} />` above the `*` catch-all. The route-table doc-comment grows a `part_graph_render` reference.
- `apps/participant/src/routes/OperateRoute.tsx` — NEW. The participant's operate route. Reads `useParams<{ id: string }>()`, `useWsClient()`. Lifecycle: `trackSession` on mount + `untrackSession` on cleanup (idempotent re-subscription with the lobby's prior call). Returns `<ParticipantLayout header={<ParticipantChrome />} main={<OperateRouteBody id={id} />} footer={<ParticipantStatusIndicator />} />`. The body component owns the auth guard branch (same belt-and-suspenders shape as `LobbyRoute`'s mid-mount auth check) and renders `<GraphView sessionId={id} />`.
- `apps/participant/src/routes/OperateRoute.test.tsx` — NEW. Vitest cases (4): (a) `trackSession(${id})` called once on mount + `untrackSession(${id})` called once on cleanup; (b) the route renders `<ParticipantLayout>` with the four named-region testids present; (c) the auth-not-authenticated branch renders the dedicated `participant-not-authenticated` testid without crashing on `auth.user.screenName`; (d) the route renders `data-testid="route-operate"` on its outer wrapper (so Playwright assertions have a stable marker).
- `apps/participant/src/graph/GraphView.tsx` — NEW. Mounts Cytoscape inside a sized `<div data-testid="participant-graph-root">`. Subscribes to `useWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS)` (module-scope `EMPTY_EVENTS` frozen array for selector stability — same idiom the moderator's `GraphCanvasPane` uses). Computes a memoized `elements` array via `projectGraph(events)`. On `elements` change, the component runs `cy.json({ elements })` (Cytoscape's bulk-replace path) followed by `cy.layout({ name: 'cose', animate: false }).run()`. The Cytoscape instance lives in a `useRef` (mounted in a one-shot `useEffect`; destroyed on unmount). The component's React render path returns the test-id'd container only; Cytoscape paints inside imperatively. Read-only stylesheet (Decision §2) declares: `node { label, background-color, shape, padding }`, `edge { label, curve-style, line-color, target-arrow-shape }`, plus the small kind-label secondary text (achieved via Cytoscape's `label` + `text-margin-y` selectors).
- `apps/participant/src/graph/GraphView.test.tsx` — NEW. Vitest cases (12) covering the React render + the projection behaviour the test can observe via the Cytoscape `cy.elements()` API (Cytoscape ships a headless mode; happy-dom is sufficient with a `ResizeObserver` stub mirroring the moderator's pattern). (a) Mounts without crashing on an empty session; (b) renders one Cytoscape node per `node-created` event in the seeded WS slice; (c) the node's `data.wording` matches the payload; (d) the node's `data.kind` is `null` until a `commit` of a `classify-node` proposal lands; (e) after the commit, the node's `data.kind` is the committed `StatementKind`; (f) renders one Cytoscape edge per `edge-created` with `data.source` / `data.target` / `data.role` matching the payload; (g) edges and nodes are disjoint (a `node-created` does not contribute to edges); (h) the empty-events fallback renders an empty graph (no nodes, no edges); (i) the component does NOT crash when an `edge-created` references unknown source/target ids (Cytoscape simply skips drawing them — same lenient behaviour the moderator inherits); (j) on a session switch (prop change), the component clears the prior graph before painting the new one (no leaked elements); (k) the `participant-graph-root` testid is present on the outer container; (l) Cytoscape's pan/zoom defaults are enabled (the test reads `cy.userZoomingEnabled()` / `cy.userPanningEnabled()` to assert `true`).
- `apps/participant/src/graph/projectGraph.ts` — NEW. Pure function `projectGraph(events: readonly Event[]): { nodes: ElementDefinition[]; edges: ElementDefinition[] }`. Walks the event log once: `node-created` emits a node with `data: { id, wording, kind: null }`; `proposal` of `classify-node` caches by envelope id; `commit` of a cached classify-node proposal flips the matching node's `data.kind`; `edge-created` emits an edge with `data: { id, source, target, role }`; other event kinds are ignored. Exported separately from `GraphView.tsx` so the Vitest layer can pin the algorithm without mounting Cytoscape. (The split mirrors the moderator's `projectNodes` / `selectEdgesForSession` split — same testability rationale.)
- `apps/participant/src/graph/projectGraph.test.ts` — NEW. Vitest cases (10) covering the pure projection: empty input → empty output; single `node-created` → one node with `kind: null`; single `edge-created` → one edge with the right `source` / `target` / `role`; mixed log (node + edge in arbitrary order) → both projected; classify-node proposal without commit → node kind stays `null`; classify-node proposal + commit → node kind flips; commit of an unknown proposal id → no change; round-trip every `StatementKind` value (`fact` / `predictive` / `value` / `normative` / `definitional`) through a proposal+commit pair → each lands on the node correctly; round-trip every `EdgeRole` value (`supports` / `rebuts` / `qualifies` / `bridges-from` / `bridges-to` / `defines` / `contradicts`) through an `edge-created` → each lands on the edge's `data.role`; event-ordering invariance for non-causal events (an unrelated `participant-joined` between a `node-created` and its classify commit does NOT break the projection).
- `apps/participant/package.json` — modified. Adds `"cytoscape": "<pinned-version>"` to `dependencies` (the latest stable, pinned no-caret per repo convention; the resolved lockfile version is what gets pinned — `pnpm` will choose; expected ~`3.30.x` based on the throwaway smoke at `scripts/hello-cytoscape.ts`). Adds `"@types/cytoscape": "<matching>"` to `devDependencies` for the type-only import. NO `react-cytoscapejs` wrapper — the moderator's pattern is to consume the library directly, and the participant follows the same shape. Decision §1 documents the wrapper-vs-direct choice.
- `apps/participant/tsconfig.json` — unchanged. The new files use the existing project references and compiler settings.
- `apps/participant/vite.config.ts` — unchanged. Cytoscape ships as ESM and works with the existing library-mode build.
- `tests/e2e/participant-graph-render.spec.ts` — NEW. One Playwright scenario under `chromium-participant-skeleton`: alice (moderator) creates a public session via `page.request.post('/api/sessions', { data: { topic, privacy: 'public' } })`; logs out + clears cookies; ben (`loginAs`) navigates to the debater-A invite URL, claims, lands on the lobby. The spec then seeds two events into ben's WS store via the `window.__aConversaWsStore` dev seam (already exposed at [`apps/participant/src/main.tsx:50`](../../../apps/participant/src/main.tsx#L50)) — one `node-created` for a known wording, one `edge-created` referencing the new node. The spec then `page.goto`s `/p/sessions/${sessionId}` and asserts: `route-operate` testid visible; `participant-graph-root` testid visible; the rendered Cytoscape canvas contains an HTML element with the seeded wording text (Cytoscape's default `label` mode draws labels via SVG `<text>` overlays — Playwright's `getByText` finds them); the localized kind label (`—` em-dash placeholder for the unclassified node) is visible. The edge assertion is positional (the SVG `<text>` for the role label is present); the per-role text is locked in by the projection tests, not duplicated here. The scenario uses the seed-via-WS-store path rather than driving the moderator's start-debate trigger (which is `mod_session_lobby`'s deliverable) — Decision §6.
- `playwright.config.ts` — modified. `chromium-participant-skeleton` testMatch widens from `/participant-(skeleton-smoke|invite-acceptance|lobby)\.spec\.ts$/` to `/participant-(skeleton-smoke|invite-acceptance|lobby|graph-render)\.spec\.ts$/`. Same mechanical change `part_lobby_view` made.
- `apps/participant/src/App.tsx` route-table doc-comment — extended to mention `part_graph_render` as the addition this commit lands.

### Files this task does NOT touch

- `apps/participant/src/main.tsx` — the provider stack is correct; no change. The `window.__aConversaWsStore` seam is already exposed for the Playwright spec.
- `apps/participant/src/ws/wsStore.ts` — consumed unchanged. The selector usage is a read-only consumer; no shape change.
- `apps/participant/src/routes/LobbyRoute.tsx` / `InviteAcceptanceRoute.tsx` — unchanged. The graph view is a sibling route; the lobby remains the post-claim destination, and the operate route handoff is deferred to a future task.
- `apps/participant/src/layout/*` — chrome consumed unchanged.
- `apps/participant/src/stores/*` — the local-state stores (`voteStore`, `selectionStore`, `uiStore`) are not consumed by this leaf. The selection store will be consumed by `part_entity_detail_panel` (a future leaf); the vote store by `part_voting`. The UI store's `currentTab` is not relevant to the graph route.
- `packages/shell/` — no new substrate. The projection lives in the participant workspace per Decision §4.
- `packages/i18n-catalogs/` — no new keys. The methodology glossary is the only string source.
- `apps/moderator/` — no cross-surface change. The moderator's graph stays on ReactFlow + dagre; the participant lives on Cytoscape + cose.
- `apps/server/` / `apps/root/` / `apps/audience/` — no cross-surface change.
- `docs/adr/` — no new ADR. Every decision below applies an existing ADR (0004 for the library pick; 0026 for substrate; 0027 for entity-vs-facet timing; 0022 for test discipline).
- `.tji` files — `complete 100` on `part_graph_render` lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual.

### Component shape (`apps/participant/src/graph/GraphView.tsx`)

Sketched:

```tsx
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import type { Event } from '@a-conversa/shared-types';

import { useWsStore } from '../ws/wsStore';
import { projectGraph } from './projectGraph';
import { useTranslation } from 'react-i18next';

const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

// Cytoscape stylesheet — Decision §2 keeps it inline and module-scope so
// the reference stays stable across renders (mirroring the moderator's
// module-scope NODE_TYPES idiom).
const STYLESHEET = [
  {
    selector: 'node',
    style: {
      shape: 'round-rectangle',
      'background-color': '#ffffff',
      'border-width': 1,
      'border-color': '#cbd5e1',
      label: 'data(wording)',
      'text-wrap': 'wrap',
      'text-max-width': '180px',
      color: '#0f172a',
      'text-valign': 'center',
      'text-halign': 'center',
      padding: '12px',
      width: 'label',
      height: 'label',
      'font-size': '12px',
    },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      'line-color': '#94a3b8',
      'target-arrow-color': '#94a3b8',
      'target-arrow-shape': 'triangle',
      label: 'data(roleLabel)',
      'font-size': '10px',
      'text-background-color': '#ffffff',
      'text-background-opacity': 1,
      'text-background-padding': '2px',
      color: '#475569',
    },
  },
];

interface GraphViewProps {
  readonly sessionId: string;
}

export function GraphView({ sessionId }: GraphViewProps): ReactElement {
  const { t } = useTranslation();
  const events = useWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS);
  const cyRef = useRef<Core | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // One-shot mount of the Cytoscape instance.
  useEffect(() => {
    if (containerRef.current === null) return;
    const cy = cytoscape({
      container: containerRef.current,
      style: STYLESHEET,
      elements: [],
      layout: { name: 'preset' },
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Projection + element sync on every events change.
  const elements = useMemo(() => {
    const { nodes, edges } = projectGraph(events);
    // The role label is localized at projection time so Cytoscape's
    // `data(roleLabel)` selector binding stays a pure data read.
    const localizedEdges = edges.map((edge) => ({
      ...edge,
      data: {
        ...edge.data,
        roleLabel: t(`methodology.edgeRole.${edge.data.role}.label`),
      },
    }));
    // Mirror for the kind label as a secondary text — Decision §2.
    const localizedNodes = nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        kindLabel: node.data.kind === null ? '—' : t(`methodology.kind.${node.data.kind}`),
      },
    }));
    return [...localizedNodes, ...localizedEdges];
  }, [events, t]);

  useEffect(() => {
    const cy = cyRef.current;
    if (cy === null) return;
    cy.json({ elements });
    cy.layout({ name: 'cose', animate: false }).run();
  }, [elements]);

  return (
    <div
      ref={containerRef}
      data-testid="participant-graph-root"
      className="h-full w-full"
    />
  );
}
```

The component is intentionally small. The projection is pure (in `projectGraph.ts`); the Cytoscape mount + element sync is the only React-side logic.

## Acceptance criteria

The check that says "done":

- `apps/participant/src/routes/OperateRoute.tsx` exists, renders `<ParticipantLayout>` with `<GraphView sessionId={id} />` in `main`, threads the per-session `trackSession` / `untrackSession` lifecycle, and carries `data-testid="route-operate"` on its wrapper.
- `apps/participant/src/App.tsx` route table includes `<Route path="/sessions/:id" element={<OperateRoute />} />` above the `*` catch-all.
- `apps/participant/src/graph/GraphView.tsx` exists, mounts Cytoscape, reads `useWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS)`, projects via `projectGraph`, and carries `data-testid="participant-graph-root"` on its outer container.
- `apps/participant/src/graph/projectGraph.ts` exports a pure `projectGraph(events)` function that walks the event log once and returns `{ nodes, edges }` Cytoscape element descriptors.
- `apps/participant/src/graph/projectGraph.test.ts` covers the 10 Vitest cases listed under Constraints.
- `apps/participant/src/graph/GraphView.test.tsx` covers the 12 Vitest cases listed under Constraints. ReactFlow / dagre are absent; the participant graph stays on Cytoscape + cose.
- `apps/participant/src/routes/OperateRoute.test.tsx` covers the 4 Vitest cases listed under Constraints.
- `apps/participant/package.json` lists `"cytoscape"` under `dependencies` (pinned, no caret; resolved lockfile version) and `"@types/cytoscape"` under `devDependencies`. `reactflow` and `@dagrejs/dagre` are NOT added.
- `tests/e2e/participant-graph-render.spec.ts` exists with one Playwright scenario per the description above. Asserts: `route-operate` visible; `participant-graph-root` visible; a seeded `node-created` produces a visible label with the wording text; the em-dash placeholder for unclassified kind is visible; the seeded `edge-created`'s role label is visible. **Per ORCHESTRATOR.md UI-stream e2e policy: the spec is in scope; the surface IS reachable as soon as the route lands at `/p/sessions/:id`. No deferral grounds.**
- `playwright.config.ts` — `chromium-participant-skeleton` testMatch widens to accept `participant-graph-render.spec.ts`.
- `pnpm run check` clean; `pnpm run test:smoke` green (Vitest count rises by 26 new cases: 10 projection + 12 GraphView + 4 OperateRoute).
- `pnpm -F @a-conversa/participant build` succeeds (bundle grows with Cytoscape — expected per ADR 0004 Consequences).
- The Playwright spec is in the chromium-participant-skeleton project's run; `pnpm run test:e2e:smoke` (with the compose stack up via `make up`) executes it and it passes.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/40-participant-ui.tji` gets `complete 100` on `part_graph_render` in the same commit (the Closer's ritual).

## Decisions

### §1 — Cytoscape consumed directly, no `react-cytoscapejs` wrapper

The moderator surface consumes ReactFlow directly (no wrapper); the participant surface follows the same pattern with Cytoscape. The `react-cytoscapejs` wrapper is a thin facade that maps React props onto a Cytoscape instance — useful when the lifecycle would otherwise be hand-rolled, but the wrapper's prop-diffing strategy can fight downstream consumers (the wrapper re-creates the cy instance on certain prop changes, which would defeat the per-session lifecycle this leaf wants). A direct mount via `useRef<Core>` + `useEffect` is ~30 lines and gives us complete control over: (a) when the cy instance is created (one-shot mount); (b) when elements are synced (memo over events); (c) when layout runs (right after element sync); (d) how the test seam works (the cy instance is exposed via `cyRef` for downstream tasks). Alternative: use `react-cytoscapejs`. Rejected because the prop-diffing semantics are opaque and the moderator's parallel "raw ReactFlow, no wrapper" choice is the precedent the codebase already lives by.

### §2 — Stylesheet inline + module-scope; no `<StatementNode>` React custom-node analog

ReactFlow renders nodes via React components (so the moderator's `<StatementNode>` is a real React tree with `useTranslation` inside). Cytoscape renders nodes via its own SVG / WebGL pipeline; React is **not** in the node render loop. There is no equivalent React custom-node component for the participant. The options for surfacing the wording + kind label are:

- **(A) Cytoscape `label` style with the wording as primary text and the kind tag rendered as a second `node` style targeting a CSS-class selector** — the chosen path. The wording reads via `label: 'data(wording)'`; the kind tag is set up at projection time (`data.kindLabel = '—'` or the localized kind) and rendered via a second stylesheet entry that targets only the kind text (via Cytoscape's `text-margin-y` for vertical offset). Single render pass, library-native, no DOM overlay.
- **(B) DOM-overlay** — render the wording + kind tag as a React subtree positioned at the Cytoscape node's screen coordinates, syncing on pan/zoom events. Higher-fidelity (full Tailwind / arbitrary React components per node), but expensive: every pan/zoom tick requires re-syncing every overlay's position. Rejected for v1; downstream tasks (`part_per_facet_state_styling`, `part_axiom_mark_decoration`) may revisit if the styling layer needs richer per-node DOM.
- **(C) Custom Cytoscape `nodeHtml` renderer (via `cytoscape-node-html-label` plugin)** — third-party plugin that gives Cytoscape an HTML-overlay layer for node bodies. Pulls a new dependency; the moderator's parallel decision was to use ReactFlow's React-native nodes precisely because Cytoscape's native rendering is harder to extend. For this leaf the rendering is simple enough that the plugin is overkill; if the styling layer hits a wall, the plugin is the documented escape hatch.

Decision §2: ship (A). The wording + kind label render via Cytoscape's built-in stylesheet; the stylesheet is declared at module scope so its reference stays stable across renders. The DOM-overlay path is the documented escape hatch for downstream tasks that need richer per-node content.

### §3 — Layout engine: Cytoscape's bundled `cose`, not dagre

The moderator uses `@dagrejs/dagre` (per [ADR 0025](../../../docs/adr/0025-graph-layout-engine-dagre.md)) with an incremental-layout cache so existing nodes never move on incremental events — that constraint matters for the moderator because the operator is actively manipulating the canvas (proposing, classifying, drawing edges) and a node "jumping" on every event would be disorienting. The participant is read-only; their interaction profile is "look at the live graph as it changes." Constraints satisfied by `cose` (Cytoscape's built-in force-directed layout):

- **No new dependency.** `cose` ships with Cytoscape; no `cytoscape-dagre` package needed. The participant's bundle stays tight.
- **Reasonable visual output.** `cose` is the documented default for general-purpose force-directed layout; for the v1 read-mostly view it's good enough.
- **Re-layout on every projection change.** Acceptable: the participant doesn't need the moderator's "existing nodes never move" invariant. If a node arrives, the whole graph relayouts; the visual effect mimics "the conversation is moving."

Alternatives:

- **Dagre via `cytoscape-dagre`.** Rejected: new dep; the moderator's "existing nodes don't move" invariant isn't a participant requirement; the participant's interaction profile makes a force-directed layout feel right for live-updating content.
- **No layout, fixed grid.** Rejected: would put nodes on top of each other for any non-trivial debate. The moderator's `mod_node_rendering` shipped a placeholder grid for one task only and then immediately replaced it with dagre — the same intermediate state isn't worth landing here.
- **CoSE-Bilkent (a higher-quality CoSE variant via `cytoscape-cose-bilkent`).** Considered. Better visual output but adds a dependency. v1 ships with built-in `cose`; a future polish task can swap if needed.

### §4 — Projection lives in the participant workspace; no shell extraction yet

The moderator's `projectNodes` + `selectEdgesForSession` emit ReactFlow `Node[]` / `Edge[]`. The participant's `projectGraph` emits Cytoscape `ElementDefinition[]`. The output shapes differ; the input (event log) and the algorithm (single-pass walk, classify-node proposal cache, commit flips kind) are identical. Extracting "the algorithm" into the shell as a library-agnostic projector that takes a `mapNode(payload) => T` callback is a clean abstraction in principle, but with two callers whose output types differ it would force every caller to pass through a renderer-shaped callback — net more code than the duplication.

Per the shell extraction policy already in play (`shared_shell_extract_merge_slots_and_derive_slot_occupants` waits for the audience surface to become the third caller before extracting `mergeSlots` + `deriveSlotOccupants`), the same rule applies here: **two callers is YAGNI; extract when the third caller materializes.** The audience surface (`aud_graph_render`, future) is the natural third caller — Cytoscape-shaped output like the participant, so a participant-extraction would already be the right shape for the audience. When `aud_graph_render` lands, a shell-extraction task can lift the projection into `@a-conversa/shell` with the now-validated Cytoscape-output shape. Both this leaf and the audience leaf import it.

Decision §4: ship the participant's `projectGraph` in `apps/participant/src/graph/projectGraph.ts`; document the extraction trigger as "third caller = audience surface" in this refinement's Status block (so the next orchestrator pass picks it up when both Cytoscape callers exist).

### §5 — Combined `projectGraph` returning `{ nodes, edges }`, not split `projectNodes` + `selectEdges`

The moderator splits node and edge projection across `projectNodes` (in `GraphCanvasPane.tsx`) and `selectEdgesForSession` (in `selectors.ts`). The split was driven by the moderator's incremental rendering needs — nodes need per-id position caching, edges don't — and by the moderator's annotation-enrichment pass (annotations targeting nodes are bucketed in `projectNodes`'s second pass; annotations targeting edges happen in `selectors.ts`).

The participant has no incremental-rendering pressure (no position cache; full layout on every change) and no annotation enrichment in scope here (annotations are `part_annotation_render`'s deliverable, a sibling task). Splitting at this scale is gratuitous: the projection walks the event log exactly once, so emitting both `nodes` and `edges` from the same pass is more readable than splitting. The function returns `{ nodes, edges }`; consumers concatenate as needed. A future task that adds annotation enrichment can either grow `projectGraph`'s return shape or split off a sibling helper at that point.

Alternative: mirror the moderator's split (a `projectNodes` and a `selectEdgesForSession` in two files). Rejected because the split is justified for the moderator's reasons (incremental position cache, annotation-bucketing pass) and those reasons don't apply here. Cargo-culting the split would make the participant version look more like the moderator at the cost of being structured around constraints it doesn't have.

### §6 — Playwright spec uses WS-store seed, not the moderator's start-debate gesture

The participant's graph view becomes reachable in two ways: (a) the moderator transitions the debate from the lobby (the `mod_session_lobby` "Enter session" gesture, which today only navigates the MODERATOR to `/m/sessions/:id/operate` per the cross-surface spec at `tests/e2e/cross-surface-lobby-start.spec.ts:195`; the participant-side navigation hook is a future task); (b) the participant navigates to `/p/sessions/:id` directly. For this leaf's e2e, path (a) requires landing a new participant-side handler that reads a `debate-started`-style event and navigates — out of scope here (this leaf is rendering only; the wiring is a future leaf, likely `part_session_start_handoff`). Path (b) is reachable as soon as this leaf lands the route.

The spec uses (b) + the existing `window.__aConversaWsStore` test seam (exposed at [`apps/participant/src/main.tsx:50`](../../../apps/participant/src/main.tsx#L50) — already used by the lobby spec to seed events into the per-session slice). The flow:

1. alice creates the session.
2. ben claims debater-A (via the existing invite-acceptance flow; same path the lobby spec uses).
3. **Seed two events** into ben's WS store via the `__aConversaWsStore` seam: a `node-created` for a known wording and an `edge-created` referencing the new node + an unknown target id (Cytoscape tolerates dangling edges).
4. `page.goto('/p/sessions/${sessionId}')`.
5. Assert the route renders + the graph elements are visible + the wording and kind/role labels are localized.

Alternative: drive path (a) — moderator clicks Enter-session; the spec waits for the participant to auto-navigate. Rejected because (a) requires building the participant-side handler in this leaf, which is out of scope; the handler is a separate task. The seed path proves the rendering surface works; the navigation is pinned later.

Tech-debt registration: a future `part_session_start_handoff` task (0.5d, depends `!part_graph_render` + `mod_session_lobby`'s shipped start gesture) lands the participant-side auto-navigation from the `debate-started` event. The Closer registers it in `tasks/40-participant-ui.tji` per ORCHESTRATOR.md's tech-debt registration policy.

### §7 — No new i18n keys; methodology glossary is the only string source

The participant graph view's user-facing strings are entirely methodology vocabulary (kind labels, edge role labels). Both already exist in the en-US / pt-BR / es-419 catalogs under `methodology.kind.*` and `methodology.edgeRole.<role>.label`, populated by [`tasks/refinements/frontend-i18n/i18n_methodology_glossary.md`](../frontend-i18n/i18n_methodology_glossary.md). No new keys.

The empty-graph state (no nodes yet — the participant lands before the moderator captures anything) renders as just an empty Cytoscape canvas. No "Waiting for the moderator to capture the first statement…" overlay text in this leaf. Rationale: the chrome's footer chip already surfaces the connection state (per `part_status_indicator`); an empty graph carries no ambiguity for the user (they're in the right room, the conversation just hasn't produced a graph yet). Adding an overlay would mint at least one new i18n key for a transient affordance with no decision value. A future polish task (or sibling under `part_voting`'s pending-proposals work) can add the overlay if it surfaces a real user need.

### §8 — Testid naming: `route-operate` + `participant-graph-root`

`route-operate` mirrors the moderator's `/m/sessions/:id/operate` route testid at [`apps/moderator/src/routes/Operate.tsx:165`](../../../apps/moderator/src/routes/Operate.tsx#L165) — same name, different surface. Distinction is by participant-vs-moderator browser context, not by testid (Playwright fixtures already disambiguate). The graph container testid `participant-graph-root` is namespaced with the `participant-` prefix to avoid collision with the moderator's `graph-canvas-root` (which is unprefixed and locked in by `mod_graph_canvas_pane`'s 1681+ test references). The participant-prefix convention matches the existing `participant-layout-root` / `participant-header` / `participant-main` / `participant-footer` testids from `part_landscape_layout`.

### §9 — Per ADR 0027, the projection renders `node-created` events directly — no commit gate

Per [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md), structural events fire at propose-time, not at commit-time. The participant projection walks `node-created` and renders the node immediately — independent of whether any facet of the node is committed yet. The kind label flips when a `commit` of a `classify-node` proposal lands; the wording is rendered from the original `node-created` payload (per the ADR's entity/facet separation: wording is technically a facet, but the wire-event carries the as-proposed wording on `node-created` so the canvas has something to render before the wording facet commits). A future `edit-wording` flow may flip the wording on a committed `edit-wording.reword` proposal; that path is out of scope here and inherited from whatever the moderator's projection does (which is also not yet wired — both surfaces will adopt the wording-flip on commit when `mod_edit_wording_*` lands as a future task).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- Read-mostly Cytoscape graph view at `/p/sessions/:id` landed: `apps/participant/src/routes/OperateRoute.tsx` (route entry composing `<ParticipantLayout>` with `<GraphView sessionId={id} />` in `main` plus the `trackSession` / `untrackSession` lifecycle) and `apps/participant/src/graph/GraphView.tsx` (headless Cytoscape wrapper, subscribes to the per-session `events` slice, calls into `projectGraph` on change). `apps/participant/src/App.tsx` wires the new route above the `*` catch-all and its doc-comment grows a `part_graph_render` reference.
- Pure projection function ships at `apps/participant/src/graph/projectGraph.ts`: single-pass walk of the WS event log, `node-created` -> Cytoscape node descriptor, `edge-created` -> Cytoscape edge descriptor, `classify-node` proposal-then-commit pair flips the node's kind. Localized via the existing `methodology.kind.*` + `methodology.edgeRole.<role>.label` catalog keys; no new i18n keys per Decision §7.
- Vitest suite delta 3745 -> 3771 (+26 cases): 10 in `apps/participant/src/graph/projectGraph.test.ts` (the pure projection), 12 in `apps/participant/src/graph/GraphView.test.tsx` (React render plus Cytoscape `cy.elements()` observation), 4 in `apps/participant/src/routes/OperateRoute.test.tsx` (lifecycle, layout slots, auth-guard branch, route testid). Shared canvas / `ResizeObserver` stub at `apps/participant/src/graph/cytoscapeTestEnv.ts` so happy-dom can host the headless Cytoscape mount.
- Playwright spec `tests/e2e/participant-graph-render.spec.ts` added under `chromium-participant-skeleton` (one scenario, +1 over the prior 5); `playwright.config.ts` testMatch widens to accept `participant-graph-render.spec.ts`. Spec drives alice (moderator) + ben (debater-A) through invite -> lobby, seeds a `node-created` + `edge-created` pair into ben's WS store via the existing `window.__aConversaWsStore` dev seam, navigates ben to `/p/sessions/${sessionId}`, and asserts the events slice carries the seeded payloads plus at least one `<canvas>` layer inside the `participant-graph-root` container. Green against the `make-up` / `make-down-v` compose stack.
- New dependency: `cytoscape@3.33.3` added to `apps/participant/package.json` (pinned, no caret per ADR 0004 root); `pnpm-lock.yaml` auto-updated. `@types/cytoscape` was **not** added (Cytoscape 3.33 ships its own `index.d.ts`); `reactflow` / `@dagrejs/dagre` are absent on the participant side per Decision §3.
- Deviation from Decision §2 stylesheet sketch: `width: 'label'` / `height: 'label'` were swapped for numeric `width: 200` / `height: 80` because Cytoscape 3.33 deprecated the `'label'` value and would otherwise surface as `console.warn`, which the vitest harness now treats as a failure (per the recent warnings-as-errors change in commit `f2f086a`). Sibling task `part_per_facet_state_styling` can revisit if richer sizing is needed.
- Deviation from Decision §6 assertion shape: the Playwright spec asserts via the WS-store events slice plus the presence of a `<canvas>` layer rather than via `getByText` against the seeded wording. Cytoscape's default renderer paints labels directly to `<canvas>`, so DOM text queries cannot reach them; the wording / role-label round-trip is pinned at the Vitest projection layer (via `cy.elements()`) instead.
- Deviation: `<GraphView>` filters edges whose source/target ids aren't yet present in the projected node set before handing elements to Cytoscape. Cytoscape throws synchronously on dangling edges (unlike ReactFlow's lenient behaviour the moderator inherits); the filter pins the boundary at the projection-to-elements seam so neither the React render nor the spec's seeded dangling-edge scenario crashes.
- Tech-debt registered as `participant_ui.part_graph_view.part_session_start_handoff` (0.5d, open) per Decision §6 — the participant-side auto-navigation off the moderator's start-debate signal so the Playwright spec can drop the manual `page.goto('/p/sessions/:id')` step. Same-commit registration in `tasks/40-participant-ui.tji` with `depends !part_graph_render, participant_ui.part_session_join.part_lobby_view_ws_absence_merge_fix, moderator_ui.mod_session_setup.mod_session_lobby`.
