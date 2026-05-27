# Initialize the audience Cytoscape.js viewport

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_graph_rendering.aud_cytoscape_init`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!audience.aud_shell` (settled — every leaf under `aud_shell` is `complete 100`. The substrate this leaf consumes: `aud_app_skeleton` ships the library-mode bundle plus the host-supplied React tree; `aud_state_management` ships `useAudienceSession()` at [`apps/audience/src/state/useAudienceSession.ts:73`](../../../apps/audience/src/state/useAudienceSession.ts#L73), which returns `{ sessionId, connectionStatus, events, roster, sessionMode }` from one hook call; `aud_ws_client` mounts `<WsClientProvider>` at the surface boundary in [`apps/audience/src/main.tsx:85-94`](../../../apps/audience/src/main.tsx#L85); `aud_anonymous_ws_subscribe` widens the provider with `allowAnonymous` so a public-session viewer's events arrive without authentication; `aud_no_auth_for_public` flips `requiredAuthLevel: 'public'` so the surface mounts before sign-in; `aud_auth_for_private` reads `useAuth()` inside `<App>` and renders a `<LoginButton>` chrome for anonymous visitors hitting a private session).
- `foundation.stack_decisions.graph_lib_decision` (settled — [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) names **Cytoscape.js** as the renderer for the audience surface alongside the participant and replay surfaces; ReactFlow is reserved for the moderator's interactive-edit console. The audience is the **third surface** to consume the read-only Cytoscape side of the split — after the participant's `part_graph_render` (shipped 2026-05-17) and the participant's downstream styling tasks).
- Prose-only context (NOT a `.tji` edge): `participant_ui.part_graph_view.part_graph_render` (settled — the participant's `<GraphView>` at [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) is the reference Cytoscape mount this leaf mirrors. The validated pattern: numeric `width`/`height` on the `node` selector (Cytoscape 3.33 deprecated `width: 'label'` and the vitest harness now treats `console.warn` as a failure per the participant Status block); `breadthfirst` layout (not `cose`, which has an upstream width/height-swap bug for wide-short nodes); a position-cache ref that suppresses re-layout when no new node ids land; a dangling-edge filter at the projection-to-elements seam because Cytoscape throws synchronously on edges whose source/target ids are absent (unlike ReactFlow's lenient behaviour). This leaf adopts the same shape minus the participant-specific decoration indexes — see Decision §1).
- Prose-only context (NOT a `.tji` edge): `audience.aud_shell.aud_state_management` (settled — Decision §7 of [`aud_state_management.md`](aud_state_management.md) explicitly forwarded the live-projection Playwright pin as deferred-e2e to *this* leaf, citing "the first audience leaf to surface a visible event-driven affordance." The deferral is reconciled below at Decision §9: the WBS splits viewport-init from route-wiring, so reachability still depends on `aud_url_routing.aud_session_url`; the deferred Playwright pins forwarded to this leaf re-defer to `aud_session_url` with this leaf added to the inherited-debt list).
- Prose-only context (NOT a `.tji` edge): `audience.aud_shell.aud_ws_client` + `aud_no_auth_for_public` + `aud_anonymous_ws_subscribe` (settled — each leaf's Playwright "audience visitor sees a node arrive over WS" assertion was forwarded as deferred-e2e to this leaf for the same "first visible affordance" rationale. Same re-deferral applies: Decision §9 names `aud_url_routing.aud_session_url` as the inheriting wiring task and the closer registers the cumulative debt against it).

## What this task is

The 1d foundational leaf under `aud_graph_rendering.*` — the audience surface's Cytoscape.js mount + pure projection function, mirroring the participant's `part_graph_render` shape but stripped of participant-specific decoration (no own-vote / other-vote indicators; no diagnostic highlights; no axiom-mark badge data on day one — those are sibling tasks `aud_axiom_mark_decoration`, `aud_annotation_rendering`, etc.). After this leaf:

- A new `<AudienceGraphView>` component at `apps/audience/src/graph/GraphView.tsx` mounts a single Cytoscape instance inside a sized `<div data-testid="audience-graph-root">`. The component consumes `useAudienceSession()` (re-exported from [`apps/audience/src/state/index.ts`](../../../apps/audience/src/state/index.ts)) to read the `events` slice, projects via `projectGraph(events)`, localizes the kind + role labels via the host-supplied `useTranslation()`, and runs Cytoscape's `breadthfirst` layout only when truly-new node ids land (Decision §3 — position-cache pattern lifted from participant).
- A new pure `projectGraph(events: readonly Event[]): { nodes: ParticipantNodeElement[]; edges: ParticipantEdgeElement[] }` function at `apps/audience/src/graph/projectGraph.ts` walks the WS event log once: `node-created` emits a Cytoscape node descriptor with `data: { id, wording, kind: null }`; `proposal` of `classify-node` caches by envelope id; `commit` of a cached classify-node proposal flips the matching node's `data.kind`; `edge-created` emits a Cytoscape edge descriptor with `data: { id, source, target, role }`; other event kinds ignored. The function is exported standalone so the Vitest layer pins the algorithm without mounting Cytoscape (mirrors the participant's split).
- A new `apps/audience/src/graph/cytoscapeTestEnv.ts` helper duplicates the participant's headless-Cytoscape test setup (`ResizeObserver` stub, `HTMLCanvasElement.prototype.getContext` 2D-context stub with `measureText(text) => { width: text.length * 7 }`, `requestAnimationFrame` + `cancelAnimationFrame` polyfill backed by `queueMicrotask`). Cross-app imports are forbidden under our pnpm-workspaces layout (the participant's helper lives in the participant workspace, not in `@a-conversa/shell`); duplication is the right move at this scale per Decision §6.
- A new `cytoscape@3.33.3` entry lands in `apps/audience/package.json` `dependencies` (no caret, matching the participant's pin). No `@types/cytoscape` — Cytoscape 3.33 ships its own `index.d.ts` (per the participant's Status block). No `react-cytoscapejs` wrapper (Decision §1). No `cytoscape-dagre` (Decision §3 — `breadthfirst` is bundled with the core; the dedicated audience layout-tuning task `aud_layout_engine` is the place to revisit if a third-party layout is warranted for video clarity).
- The Cytoscape stylesheet on day one is the minimal **broadcast-neutral** baseline: rounded-rectangle nodes with the wording as the primary label; bezier edges with the localized role label at the midpoint; neutral palette; numeric `width: 200` / `height: 80` on nodes (the participant's validated post-deviation shape). All per-facet styling (proposed dashed / agreed solid / disputed marker / meta-disagreement split) and decoration (axiom-mark badges, annotation overlays, per-facet sub-states) are explicit out-of-scope siblings — `aud_proposed_styling`, `aud_agreed_styling`, `aud_disputed_styling`, `aud_meta_disagreement_split`, `aud_axiom_mark_decoration`, `aud_annotation_rendering`, `aud_per_facet_visualization`, `aud_clean_typography`. This leaf lands the rendering surface; the visual-vocabulary layers plug in via sibling tasks (the same "stylesheet extends in its own commit" pattern the participant's downstream siblings already use).
- A Vitest suite covers (a) the pure projection in `projectGraph.test.ts` and (b) the React-side mount + element-sync in `GraphView.test.tsx`. The Vitest layer is the e2e regression pin for this leaf — see Decision §9 below for why Playwright defers.

Out of scope (deferred to existing or future leaves):

- **Mounting `<AudienceGraphView>` inside a route the user can reach.** The audience's current route table is a single wildcard at [`apps/audience/src/App.tsx:122-126`](../../../apps/audience/src/App.tsx#L122) rendering the placeholder. The `/sessions/:id` route (and its locale-prefixed variant `/{locale}/sessions/:id`) lands in `audience.aud_url_routing.aud_session_url` (1d, declared at [`tasks/50-audience-and-broadcast.tji:208-211`](../../50-audience-and-broadcast.tji#L208)), which also owns the per-route `useWsClient().trackSession(sessionId)` lifecycle. This leaf intentionally does NOT touch `App.tsx`, the route table, or `trackSession` — see Decision §9.
- **Per-facet state styling, axiom-mark decoration, annotation rendering, meta-disagreement split, per-facet visualization, layout-engine tuning, clean broadcast typography** — owned by the named siblings under `aud_graph_rendering.*`. Each adds its own stylesheet extension or decoration overlay against the rendering surface this leaf installs.
- **Pan / zoom / tap interactions.** The audience's broadcast-output context means pan/zoom are unwanted by default (a moving viewport on an OBS source is disorienting for viewers); Cytoscape's `userPanningEnabled` / `userZoomingEnabled` default to `true` and a future broadcast-polish leaf may flip them off. This leaf keeps Cytoscape's defaults — Decision §7.
- **Animations on commit and graph changes** — owned by the entire `aud_animations.*` group, which depends `!aud_graph_rendering` and runs after every styling leaf has landed. This leaf's element-sync is non-animated (`animate: false` on the layout call), matching the participant's choice for the same reason: an animated layout pass on every event arrival makes pixel-comparison testing impossible and competes with the dedicated animation tasks downstream.
- **Segment markers, chromatic axiom-mark badges, entity-detail overlays, per-vote pie charts, replay-mode overlays** — owned by sibling task groups (`aud_segment_markers.*`, `aud_replay.*`, etc.). The projection in this leaf carries only the entity-layer data (id, wording, kind, role); the facet-layer fields (facet statuses, axiom-mark counts, annotation counts) are added by sibling tasks that extend the projection in their own commits — Decision §4 documents the staged extraction.
- **Extraction of the projection or the test-env helper into `@a-conversa/shell`.** Two callers (participant + audience) is YAGNI; the third Cytoscape consumer (likely `replay_test.*` for the deep-link replay surface, or a future moderator-side audience-preview pane) is the natural extraction trigger. Decision §6.
- **A `window.__aConversaAudienceCyInstance` debug seam.** No Playwright spec consumes it at this tier — `aud_ws_client` deliberately rejected the equivalent `window.__aConversaAudienceWsStore` exposure for the same reason. The future `aud_session_url` Playwright spec decides whether the seam is worth the surface-area cost — Decision §8.
- **A Playwright spec exercising the audience graph.** Per the deferred-e2e exception (`ORCHESTRATOR.md` UI-stream e2e policy): the component is created here but no user flow renders it — no route mounts it, no event surface drives it, only Vitest exercises it. Full deferral applies; the inheriting wiring task is `aud_url_routing.aud_session_url`. Decision §9 lists every deferred Playwright assertion `aud_session_url`'s refinement must scope.

## Why it needs to be done

The `m_audience_mvp` milestone in [`tasks/99-milestones.tji`](../../99-milestones.tji) names the entire `aud_graph_rendering` group transitively, and **this leaf is the foundation every other leaf under `aud_graph_rendering` depends on**: `aud_clean_typography`, `aud_proposed_styling`, `aud_agreed_styling`, `aud_disputed_styling`, `aud_meta_disagreement_split`, `aud_axiom_mark_decoration`, `aud_annotation_rendering`, and `aud_layout_engine` all carry `depends !aud_cytoscape_init` (per [`tasks/50-audience-and-broadcast.tji:91-135`](../../50-audience-and-broadcast.tji#L91)). Without the Cytoscape mount + the projection scaffold, none of those siblings have anywhere to plug their stylesheet extensions or decoration overlays.

Downstream concretely:

- **`aud_proposed_styling` / `aud_agreed_styling` / `aud_disputed_styling`** extend the Cytoscape stylesheet declared in this leaf with per-facet-status selectors (`node[facetStatus.classification = 'proposed']`, `edge[facetStatus.substance = 'agreed']`, etc.). The projection here intentionally does NOT yet carry per-facet fields (the audience hasn't grown the facet-state index that the participant's sibling tasks added); the styling siblings will (a) extend `projectGraph` to emit facet-status data per element and (b) extend `STYLESHEET` to read it — same staged pattern the participant's `part_per_facet_state_styling` followed.
- **`aud_axiom_mark_decoration` / `aud_annotation_rendering` / `aud_meta_disagreement_split`** all consume the same Cytoscape mount this leaf installs; each adds its own data field to the projection and its own selector group to the stylesheet.
- **`aud_layout_engine`** (2d, depends `!aud_cytoscape_init`) replaces the `breadthfirst` layout this leaf ships with a layout tuned for broadcast clarity (tighter spacing, deterministic node ordering for OBS pixel comparison, possibly a custom force-directed variant via `cytoscape-cose-bilkent` or a hand-rolled radial). The 2d effort budget signals it's where layout-tuning effort lives; this leaf's responsibility is to ship a *correct* baseline, not the final one.
- **`aud_url_routing.aud_session_url`** lands the `<Route path="/sessions/:id" element={<AudienceLiveRoute />} />` entry plus the `useWsClient().trackSession(sessionId)` lifecycle. That task mounts `<AudienceGraphView>` inside the route and inherits the deferred-e2e debt registered against this leaf (see Decision §9).
- **The entire `aud_animations.*` group** reads the same WS event log this leaf's projection consumes; animation transitions read element identities the projection emits.

Architecturally, this leaf is the **second Cytoscape consumer in the workspace** (after the participant's `part_graph_render`) and the **first read-only-by-construction Cytoscape consumer** — the participant tablet still has interactive vote affordances (tap-to-detail, vote dots) layered over its Cytoscape mount; the audience is purely a broadcast-output surface (OBS browser source, no input). The patterns this leaf inherits from the participant (numeric width/height, `breadthfirst` layout, position cache, dangling-edge filter, `cyRef` callback for test handles) become the audience's baseline; downstream audience siblings extend rather than fork them.

A third Cytoscape caller materializing crosses the "two callers is YAGNI; extract on the third" threshold the codebase already lives by (`shared_shell_extract_merge_slots_and_derive_slot_occupants`, the participant's `part_graph_render` Decision §4). This leaf consciously does NOT pre-extract — the audience's projection has not yet grown the audience-specific decoration fields (e.g., chromatic axiom-mark badges per the recent commit `a446c82`, per-facet other-voter breakdowns per commit `de79a7d` — both participant-specific today, neither needed for the audience's broadcast role). Extraction waits until the audience-side decoration siblings have landed and the shared-vs-divergent split is empirically clear (Decision §4).

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the surface split. Cytoscape for the audience (and participant, replay). Stack-validation sketch at [`scripts/hello-cytoscape.ts`](../../../scripts/hello-cytoscape.ts).
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the wire-event vocabulary the projection walks; the shell client validates on parse so the projection trusts the shape.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest pins below ARE the regression coverage; no "I opened the page and watched events arrive" smoke.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation()` is the localization seam; this leaf consumes `methodology.kind.*` and `methodology.edgeRole.<role>.label` from the existing catalog. No new keys.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the surface owns its mounted region only; `useTranslation()`, `useAudienceSession()`, and the underlying `<WsClientProvider>` all come from shell + the audience workspace's read-only surface. No new shell substrate in this leaf.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — `node-created` and `edge-created` fire at propose-time; the projection renders entities immediately, with `kind: null` until a `classify-node` proposal commits. Decision §10 below.
- [ADR 0029 — Anonymous WebSocket subscribe for public sessions](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md) — orthogonal to this leaf (the WS path is settled), but worth naming: the projection consumes the same event log whether the underlying connection is authenticated or anonymous.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_graph_render.md`](../participant-ui/part_graph_render.md) — the reference implementation this leaf mirrors. **Read the Status block lines 378-388 carefully**: the post-shipment deviations (numeric width/height instead of `'label'`; dangling-edge filter at the projection-to-elements seam; canvas-based label rendering means no `getByText` in Playwright) are corrections this leaf should incorporate up-front rather than rediscover.
- [`tasks/refinements/audience/aud_state_management.md`](aud_state_management.md) — ships `useAudienceSession()` at [`apps/audience/src/state/useAudienceSession.ts:73`](../../../apps/audience/src/state/useAudienceSession.ts#L73). The facade returns `{ sessionId, connectionStatus, events, roster, sessionMode }`; this leaf reads `events` only (the other fields belong to the future `aud_session_url` and `aud_lobby_overlay` siblings). Decision §7 of that refinement forwarded the live-projection Playwright pin to *this* leaf; Decision §9 below resolves where it actually lands now that the WBS-split clarity is in front of us.
- [`tasks/refinements/audience/aud_ws_client.md`](aud_ws_client.md) — Decision §10 forwarded the audience-WS Playwright pin to this leaf. Same re-deferral as `aud_state_management`'s Decision §7.
- [`tasks/refinements/audience/aud_no_auth_for_public.md`](aud_no_auth_for_public.md) — the audience-skeleton spec already pins anonymous reach-the-placeholder; the live-event-arrival assertion is forwarded to this leaf. Same re-deferral.
- [`tasks/refinements/audience/aud_anonymous_ws_subscribe.md`](aud_anonymous_ws_subscribe.md) — "anonymous viewer sees a node arrive over WS" forwarded to this leaf. Same re-deferral.
- [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md) — the placeholder route this leaf does NOT replace. The wildcard at `App.tsx:124` stays; the audience-graph component lives under `apps/audience/src/graph/`, NOT inside `App.tsx`, and is not yet wired into any route.
- [`tasks/refinements/shell-package/shared_shell_extract_merge_slots_and_derive_slot_occupants.md`](../shell-package/shared_shell_extract_merge_slots_and_derive_slot_occupants.md) — the precedent for "two callers is YAGNI; extract when the third caller materializes." Cited by Decision §4 + §6.

### Live code the leaf plugs into

- [`apps/audience/src/state/index.ts`](../../../apps/audience/src/state/index.ts) — re-exports `useAudienceSession()` plus the per-slice hooks. This leaf imports `useAudienceSession` from here; it does NOT import directly from the inner `useAudienceSession.ts` (the barrel is the audience's stable surface).
- [`apps/audience/src/state/useAudienceSession.ts:73`](../../../apps/audience/src/state/useAudienceSession.ts#L73) — the facade hook the projection reads. Returns `events` as `readonly Event[]` per the type annotation at line 39.
- [`apps/audience/src/ws/wsStore.ts`](../../../apps/audience/src/ws/wsStore.ts) — the audience's Zustand singleton (a thin re-export of `createDefaultWsStore()`). Read indirectly via `useAudienceSession()`; the projection does not touch this file.
- [`apps/audience/src/main.tsx:85-94`](../../../apps/audience/src/main.tsx#L85) — `<WsClientProvider>` already mounted at the surface boundary with `allowAnonymous`. This leaf does NOT touch the provider mount; the connection is already open by the time `<AudienceGraphView>` mounts inside any future route.
- [`apps/audience/src/App.tsx:122-126`](../../../apps/audience/src/App.tsx#L122) — the wildcard route table. UNCHANGED by this leaf. The future `aud_session_url` task will insert a `<Route path="/sessions/:id" element={<AudienceLiveRoute />} />` entry above the wildcard.
- [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) — the reference Cytoscape mount. The audience equivalent strips participant-specific concerns (no `ownVote` / `otherVotes` data fields on day one; no `axiomMarks` index; no `diagnosticHighlights`; no `annotations`) and keeps the validated infrastructure (one-shot mount in `useEffect`, position cache, dangling-edge filter, `breadthfirst` layout, numeric width/height, `cyRef` callback for test handles).
- [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts) — the reference projection. The audience equivalent uses the same single-pass algorithm but emits only the baseline node/edge data fields (`{ id, wording, kind }` for nodes; `{ id, source, target, role }` for edges). Future audience siblings extend the emitted `data` shape as they need it.
- [`apps/participant/src/graph/cytoscapeTestEnv.ts`](../../../apps/participant/src/graph/cytoscapeTestEnv.ts) — the reference happy-dom-friendly test environment. Duplicated to `apps/audience/src/graph/cytoscapeTestEnv.ts` per Decision §6 (cross-app imports are forbidden under our workspace layout).
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — the `Event` discriminated union the projection walks. `NodeCreatedPayload`, `EdgeCreatedPayload`, `ProposalEventPayload`'s `classify-node` sub-shape (`node_id`, `classification`), `CommitEventPayload.proposal_id`.
- [`packages/shell/src/ws/store-contract.ts`](../../../packages/shell/src/ws/store-contract.ts) — `BaseWsSessionState.events: Event[]` is the per-session log the audience selectors thread through.
- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — `methodology.kind.*` + `methodology.edgeRole.<role>.label` are already populated for en-US / pt-BR / es-419 (per `i18n_methodology_glossary`). No new keys.

### What the surface MUST NOT do

- **No new top-level dependency without an ADR backing.** `cytoscape@3.33.3` is already pinned by ADR 0004; this leaf adds it to the audience workspace's `package.json` only. No `cytoscape-dagre` / `cytoscape-cose-bilkent` / `react-cytoscapejs` / `cytoscape-node-html-label`.
- **No `createWsClient()` call inside the component.** The surface-wide `<WsClientProvider>` is the single client; the projection reads the events slice via `useAudienceSession()`. No second WS client.
- **No `useWsClient().send(...)` / `useWsClient().trackSession(...)` from `<AudienceGraphView>`.** The audience is read-only by construction; the audience workspace barrel intentionally does NOT export `useWsClient` (per `aud_ws_client.md` Decision §6). The per-session `trackSession` lifecycle is `aud_session_url`'s scope.
- **No `fetch('/api/...')` from the graph view.** The WS event log is the single data source for the canvas; HTTP fetches for graph data are forbidden.
- **No mutation of `audienceWsStore`.** Read-only via `useAudienceSession()`; writes happen exclusively via the shell client's dispatch path the provider owns.
- **No `localStorage` / `sessionStorage` / `window.location` writes.** Route handoffs are router-driven; the graph view is rendering-only.
- **No edit to `apps/audience/src/App.tsx`.** The placeholder route stays unchanged; the new component is not yet wired into a route. (Wiring is `aud_session_url`'s deliverable — Decision §9.)
- **No `window.__aConversaAudienceCyInstance` test seam.** No Playwright spec consumes it; the future `aud_session_url` spec decides whether the seam is worth the surface-area cost. Decision §8.
- **No drag-to-create-edge, no context menus, no inline edit, no tap handlers, no vote affordances.** The audience is purely read-only output; those gestures belong to the moderator (and a subset to the participant). Sibling `aud_animations.*` may register `cy.on('add', ...)` listeners, but this leaf registers no event handlers on the Cytoscape instance.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/GraphView.tsx` — NEW. The `<AudienceGraphView>` React component. Mounts Cytoscape inside a sized `<div data-testid="audience-graph-root">`. Reads `useAudienceSession()` from the audience state barrel. Computes a memoized `elements` array via `projectGraph(events)` plus the locale-aware label decoration. On `elements` change, calls `cy.json({ elements: nondanglingElements })` and runs `cy.layout(BREADTHFIRST_LAYOUT_OPTIONS).run()` only when newly-introduced node ids exist (position-cache pattern lifted from participant). Cleanup destroys the Cytoscape instance. Accepts an optional `cyRef?: (cy: Core | null) => void` callback prop for test handles (the participant's pattern at [`GraphView.tsx:1124`](../../../apps/participant/src/graph/GraphView.tsx#L1124)).
- `apps/audience/src/graph/GraphView.test.tsx` — NEW. Vitest cases (12) covering React render + the projection behaviour observable via the Cytoscape `cy.elements()` API: (a) mounts without crashing on an empty session; (b) renders one Cytoscape node per `node-created` event; (c) the node's `data.wording` matches the payload; (d) the node's `data.kind` is `null` until a `commit` of `classify-node` lands; (e) after the commit, `data.kind` is the committed `StatementKind`; (f) renders one Cytoscape edge per `edge-created`; (g) edges and nodes are disjoint; (h) the empty-events fallback renders an empty graph; (i) dangling edges (source/target absent from the projected node set) are filtered out at the projection-to-elements seam (matching the participant's post-deviation behaviour); (j) re-mount with an empty session id clears the prior graph; (k) `audience-graph-root` testid present on outer container; (l) Cytoscape's pan/zoom defaults are enabled (`cy.userZoomingEnabled()` / `cy.userPanningEnabled()` both `true` — Decision §7).
- `apps/audience/src/graph/projectGraph.ts` — NEW. Pure `projectGraph(events: readonly Event[]): { nodes: AudienceNodeElement[]; edges: AudienceEdgeElement[] }`. Single-pass walk emitting Cytoscape `ElementDefinition` descriptors. Re-exports the `AudienceNodeElement` / `AudienceEdgeElement` interface types so the React layer + test layer can share the typed shape without re-declaring.
- `apps/audience/src/graph/projectGraph.test.ts` — NEW. Vitest cases (10) covering: empty input → empty output; single `node-created` → one node with `kind: null`; single `edge-created` → one edge with correct `source`/`target`/`role`; mixed log (node + edge interleaved) → both projected; classify-node proposal without commit → kind stays `null`; classify-node proposal + commit → kind flips; commit of an unknown proposal id → no change; round-trip every `StatementKind` value through proposal+commit → each lands; round-trip every `EdgeRole` value through `edge-created` → each lands on `data.role`; event-ordering invariance for non-causal events (an unrelated `participant-joined` between a `node-created` and its classify-commit does not break the projection).
- `apps/audience/src/graph/cytoscapeTestEnv.ts` — NEW. Duplicates the participant's `cytoscapeTestEnv.ts` verbatim (the file is small and self-contained; per Decision §6 we do not yet extract). Exports `installCytoscapeTestEnv(): { restore: () => void }` that installs `ResizeObserver` stub, 2D canvas-context stub with `measureText`, and `requestAnimationFrame` / `cancelAnimationFrame` polyfills backed by `queueMicrotask`.
- `apps/audience/src/graph/cytoscapeTestEnv.test.ts` — NEW. Vitest cases (4): (a) `installCytoscapeTestEnv()` installs `ResizeObserver` when undefined; (b) the canvas-context stub's `measureText('hello')` returns `{ width: 35 }`; (c) `requestAnimationFrame` runs the callback before the next microtask drain completes; (d) `restore()` returns the globals to their pre-install state (or `undefined` if originally absent). Mirrors the participant's `cytoscapeTestEnv.test.ts` shape.
- `apps/audience/package.json` — modified. Adds `"cytoscape": "3.33.3"` to `dependencies` (pinned, matching the participant). No `@types/cytoscape` (Cytoscape 3.33 ships its own `index.d.ts`).
- `apps/audience/tsconfig.json` — unchanged. The new files use the existing project references and compiler settings.
- `apps/audience/vite.config.ts` — unchanged. Cytoscape ships as ESM and works with the existing library-mode build (validated by the participant's `apps/participant/vite.config.ts`).

### Files this task does NOT touch

- `apps/audience/src/App.tsx` — UNCHANGED. The wildcard placeholder route stays; the new component is NOT yet wired into a route. (Wiring lives in `aud_session_url`.)
- `apps/audience/src/main.tsx` — UNCHANGED. The provider stack is correct; the WS connection is already open by the time any future route renders `<AudienceGraphView>`.
- `apps/audience/src/state/*` — read-only consumer. The projection reads `useAudienceSession()` from the barrel; no new state hooks, no extension of the facade.
- `apps/audience/src/ws/*` — read-only consumer. No new selectors; the `events` field of `useAudienceSession()` carries the same `readonly Event[]` the existing `useAudienceSessionEvents(sessionId)` selector returns.
- `apps/participant/src/graph/*` — UNCHANGED. The participant's mount is the reference; this leaf adopts the validated patterns without forking the file.
- `packages/shell/` — no new substrate. The projection lives in the audience workspace per Decision §4 (and the test-env helper lives in the audience workspace per Decision §6).
- `packages/i18n-catalogs/` — no new keys.
- `docs/adr/` — no new ADR. Every decision below applies an existing ADR (0004 for the library pick; 0026 for substrate; 0027 for entity-vs-facet rendering; 0022 for test discipline; 0024 for i18n).
- `apps/moderator/` / `apps/server/` / `apps/root/` / `apps/replay-test/` — no cross-surface change.
- `playwright.config.ts` / `tests/e2e/` — UNCHANGED. The Playwright spec defers to `aud_session_url` (Decision §9). Pre-existing audience-skeleton specs continue to assert the placeholder route shape; they do not reach the new component.
- `.tji` files — `complete 100` on `aud_cytoscape_init` lands at task-completion time per the [tasks/refinements/README.md](../README.md) ritual.

### Component shape (`apps/audience/src/graph/GraphView.tsx`)

Sketched (post-participant-deviation patterns folded in up front):

```tsx
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import cytoscape, {
  type Core,
  type ElementDefinition,
  type StylesheetJson,
} from 'cytoscape';
import { useTranslation } from 'react-i18next';

import { useAudienceSession } from '../state';
import { projectGraph } from './projectGraph';

const STYLESHEET: StylesheetJson = [
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
      width: 200,
      height: 80,
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

const BREADTHFIRST_LAYOUT_OPTIONS = {
  name: 'breadthfirst' as const,
  directed: true,
  circle: false,
  grid: false,
  avoidOverlap: true,
  spacingFactor: 1.25,
  nodeDimensionsIncludeLabels: false,
  padding: 30,
  animate: false,
  fit: false,
};

interface AudienceGraphViewProps {
  readonly cyRef?: (cy: Core | null) => void;
}

export function AudienceGraphView({ cyRef }: AudienceGraphViewProps): ReactElement {
  const { t } = useTranslation();
  const { events } = useAudienceSession();
  const cyInstanceRef = useRef<Core | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const knownNodeIdsRef = useRef<Set<string>>(new Set());
  const positionCacheRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // One-shot mount of the Cytoscape instance.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const cy = cytoscape({
      container,
      style: STYLESHEET,
      elements: [],
      layout: { name: 'preset' },
      userPanningEnabled: true,
      userZoomingEnabled: true,
      boxSelectionEnabled: false,
      selectionType: 'single',
      autoungrabify: true,
    });
    cyInstanceRef.current = cy;
    cyRef?.(cy);
    return () => {
      cy.destroy();
      cyInstanceRef.current = null;
      cyRef?.(null);
      knownNodeIdsRef.current = new Set();
      positionCacheRef.current = new Map();
    };
  }, [cyRef]);

  // Projection + localization, memoized over events + i18n.
  const elements = useMemo(() => {
    const { nodes, edges } = projectGraph(events);
    const projectedNodeIds = new Set(nodes.map((n) => n.data.id));
    const nondanglingEdges = edges.filter(
      (e) => projectedNodeIds.has(e.data.source) && projectedNodeIds.has(e.data.target),
    );
    const localizedNodes = nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        kindLabel:
          node.data.kind === null ? '—' : t(`methodology.kind.${node.data.kind}`),
      },
    }));
    const localizedEdges = nondanglingEdges.map((edge) => ({
      ...edge,
      data: {
        ...edge.data,
        roleLabel: t(`methodology.edgeRole.${edge.data.role}.label`),
      },
    }));
    return [...localizedNodes, ...localizedEdges];
  }, [events, t]);

  // Element sync + layout (only when truly-new node ids land).
  useEffect(() => {
    const cy = cyInstanceRef.current;
    if (cy === null) return;
    cy.json({ elements });
    const currentNodeIds = new Set(elements.filter((e) => e.group !== 'edges').map((e) => e.data.id));
    const knownIds = knownNodeIdsRef.current;
    const introducedNew = [...currentNodeIds].some((id) => !knownIds.has(id));
    if (introducedNew) {
      cy.layout(BREADTHFIRST_LAYOUT_OPTIONS).run();
      cy.nodes().forEach((n) => {
        const p = n.position();
        positionCacheRef.current.set(n.id(), { x: p.x, y: p.y });
      });
    }
    knownNodeIdsRef.current = currentNodeIds;
  }, [elements]);

  return (
    <div
      ref={containerRef}
      data-testid="audience-graph-root"
      className="h-full w-full"
    />
  );
}
```

The shape mirrors `apps/participant/src/graph/GraphView.tsx` minus the participant-specific decoration concerns (no own-vote layer, no other-votes overlay, no axiom-mark badge, no annotation overlay, no diagnostic-highlight halo, no flashing-node animation, no tap handler). Sibling tasks add those back in their own commits as needed.

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/GraphView.tsx` exists, mounts Cytoscape, reads `useAudienceSession()`, projects via `projectGraph`, filters dangling edges, runs `breadthfirst` layout only when truly-new node ids land, and carries `data-testid="audience-graph-root"` on its outer container. Accepts an optional `cyRef` callback prop for tests.
- `apps/audience/src/graph/projectGraph.ts` exports a pure `projectGraph(events)` returning `{ nodes, edges }` Cytoscape element descriptors. Walks the event log once.
- `apps/audience/src/graph/cytoscapeTestEnv.ts` exports `installCytoscapeTestEnv(): { restore: () => void }` matching the participant's helper shape (ResizeObserver stub, 2D canvas-context stub with `measureText`, requestAnimationFrame polyfill backed by `queueMicrotask`).
- `apps/audience/src/graph/projectGraph.test.ts` covers the 10 Vitest cases enumerated above.
- `apps/audience/src/graph/GraphView.test.tsx` covers the 12 Vitest cases enumerated above. ReactFlow / dagre are absent; the audience graph stays on Cytoscape + breadthfirst.
- `apps/audience/src/graph/cytoscapeTestEnv.test.ts` covers the 4 Vitest cases enumerated above.
- `apps/audience/package.json` lists `"cytoscape": "3.33.3"` under `dependencies` (no caret). `reactflow` / `@dagrejs/dagre` / `@types/cytoscape` / `react-cytoscapejs` are NOT added.
- `apps/audience/src/App.tsx` is UNCHANGED. The placeholder route table stays; the new component is not yet reachable through any URL. Per `ORCHESTRATOR.md`'s deferred-e2e exception ("component not yet reachable"), Playwright coverage for this leaf is **deferred** to `audience.aud_url_routing.aud_session_url` (which inherits the cumulative debt from `aud_ws_client`, `aud_state_management`, `aud_anonymous_ws_subscribe`, and this leaf). Decision §9 enumerates the scenarios `aud_session_url`'s refinement must scope. The Vitest layer is the regression pin until `aud_session_url` lands.
- `pnpm run check` clean (the strict TS pass typechecks the new files; the new dep is declared).
- `pnpm run test:smoke` green (Vitest count rises by **26** new cases: 10 projection + 12 GraphView + 4 cytoscapeTestEnv).
- `pnpm -F @a-conversa/audience build` succeeds (bundle grows with Cytoscape — expected per ADR 0004 Consequences; the participant's bundle grew by ~250kB raw on the equivalent change, which sits inside the broadcast-surface's acceptable budget since the audience is an SSR-equivalent OBS browser source).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_cytoscape_init` in the same commit (the Closer's ritual).

## Decisions

### §1 — Cytoscape consumed directly, no `react-cytoscapejs` wrapper

The participant's `part_graph_render` Decision §1 already settled this: the wrapper's prop-diffing semantics can fight per-session lifecycles, and a direct `useRef<Core>` + `useEffect` mount is ~40 lines with complete control over instance lifecycle and test-handle exposure. The audience inherits the same choice. Alternative: `react-cytoscapejs`. Rejected on the same grounds, with the additional rationale that having two Cytoscape consumers consume the library with the same direct pattern keeps a future shell-extraction (Decision §4) clean.

### §2 — Module-scope stylesheet + numeric width/height; no React-custom-node analog

Cytoscape renders nodes via its own canvas/SVG pipeline; React is not in the node render loop, so there's no per-node `<StatementNode>`-style React component. The wording + kind label render via Cytoscape's built-in `label` selector with the `kindLabel` data field appended at projection time and rendered as a secondary line via `text-margin-y`. The stylesheet is declared at module scope so its reference is stable across renders.

**Numeric width/height** (`width: 200`, `height: 80`) is the validated pattern: the participant's status block (lines 384-385 of [`part_graph_render.md`](../participant-ui/part_graph_render.md)) documents that `width: 'label'` / `height: 'label'` was deprecated by Cytoscape 3.33 and surfaced as `console.warn`, which the vitest harness now treats as a failure (commit `f2f086a`). The audience adopts the numeric pattern up-front rather than rediscovering the deviation.

The DOM-overlay path (rendering wording + kind via a React subtree positioned at Cytoscape node coordinates) is the documented escape hatch the participant decision left open — same rationale here: the broadcast-output context might want richer per-node DOM later (font-pairing, kinetic typography, glyphs) but the v1 baseline ships the library-native rendering.

### §3 — Layout: `breadthfirst`, not `cose`; the `aud_layout_engine` sibling owns video tuning

The participant's `part_graph_render` Decision §3 switched away from `cose` after observing an upstream width/height-swap bug that breaks overlap detection for wide-short nodes; `breadthfirst` is bundled and natively respects `outerWidth()/outerHeight()` via `avoidOverlap`. The audience adopts the same validated layout up-front for the same reason: the broadcast-output context has even less tolerance for nodes-on-top-of-nodes than the participant tablet, since pixel-comparison testing depends on deterministic layout.

The audience WBS has a dedicated 2d sibling `audience.aud_graph_rendering.aud_layout_engine` ("Configure layout algorithm tuned for clarity on video"). That task is the place to (a) swap `breadthfirst` for a force-directed-via-`cytoscape-cose-bilkent` variant if visual quality demands it, (b) tune `spacingFactor` / `padding` for OBS-canvas aspect ratios, (c) pin a deterministic seed for pixel-comparison tests if a force-directed layout returns. This leaf does NOT pre-empt `aud_layout_engine`'s scope; it ships the correct baseline.

Alternative: ship a fixed `preset` layout (no auto-layout, all nodes at origin). Rejected: would put nodes on top of each other for any non-trivial debate; defeats the v1 acceptance criterion that "rendered nodes are visually distinguishable on a video frame."

Alternative: ship `cose` and accept the warn-on-overlap-bug. Rejected: the participant already validated `breadthfirst` and the audience-layout sibling can re-evaluate with full context.

### §4 — Projection lives in the audience workspace; shell extraction waits

The participant's `projectGraph` is at `apps/participant/src/graph/projectGraph.ts`; this leaf's `projectGraph` is at `apps/audience/src/graph/projectGraph.ts`. Two callers (participant + audience) is the YAGNI threshold codified by `shared_shell_extract_merge_slots_and_derive_slot_occupants` and the participant's own `part_graph_render` Decision §4. **The extraction trigger this leaf names is NOT "audience is now the third caller" — it's "the third Cytoscape consumer whose projection shape stabilizes against an audience-specific decoration."**

Concretely: the participant's projection has grown well beyond the entity-layer baseline since `part_graph_render` shipped — facet-statuses, axiom-mark counts, annotation counts, diagnostic-highlight states, own/other vote rollups, flashing flags, measured dimensions. The audience needs SOME of those (facet statuses for state-styling siblings, axiom-mark counts for `aud_axiom_mark_decoration`, annotation counts for `aud_annotation_rendering`) and NONE of others (no `ownVote` / `otherVotes` on the audience — there are no votes in the broadcast). The shared-vs-divergent split is not yet empirically clear; pre-extracting today would force an artificial superset interface that imposes participant-specific fields on the audience or vice-versa.

The extraction watermark to flip the decision: when the audience's projection has grown three or more decoration fields shared verbatim with the participant's (the sibling tasks `aud_proposed_styling` + `aud_axiom_mark_decoration` + `aud_annotation_rendering` are the natural extraction triggers; a fourth Cytoscape consumer materializing — most likely under `replay_test.*` — makes extraction unambiguously the right move). A future shell-extraction task in `shell-package/` would lift the projection into `@a-conversa/shell` with parameterized decoration types, and the audience + participant + replay would all consume it.

This leaf does NOT pre-extract. It ships a 50-line projection in the audience workspace and registers no follow-up tech-debt task — the extraction trigger lives in the participant + audience styling siblings' refinements, NOT here. (If the orchestrator wants a tracked-debt entry, see Open questions §1 below.)

### §5 — Combined `projectGraph` returning `{ nodes, edges }`; no `selectEdgesForSession` analog

The participant's `part_graph_render` Decision §5 settled the combined-vs-split choice: the moderator splits projection into `projectNodes` + `selectEdgesForSession` because of the moderator's incremental position-cache concerns and annotation-bucketing pass. The participant has no such concerns; the audience has even fewer. A single-pass `projectGraph` that walks the event log once and returns `{ nodes, edges }` is more readable at this scale than a two-file split.

If a future audience sibling needs to bucket annotation-targeting events by the targeted entity (matching the moderator's pattern), that sibling can grow the projection's return shape or split off a sibling helper at that point. Pre-splitting today is cargo-culting.

### §6 — `cytoscapeTestEnv` duplicated, not shared

The participant's `cytoscapeTestEnv.ts` is a small (~150 LOC), self-contained file: ResizeObserver stub, 2D canvas-context stub with `measureText`, requestAnimationFrame polyfill. Cross-app imports are forbidden under our pnpm-workspaces layout (the participant's file is in `apps/participant/`, not in a published package). Three options:

- **(A — chosen)** Duplicate the helper to `apps/audience/src/graph/cytoscapeTestEnv.ts`. Costs ~150 LOC of duplication; benefit is each app's test environment is self-contained and the two callers can diverge if the audience needs (say) an OffscreenCanvas stub the participant doesn't. Per the same "two callers is YAGNI" precedent (`shared_shell_extract_merge_slots_and_derive_slot_occupants`), duplication is the right move at this stage.
- **(B)** Extract to a new `@a-conversa/test-utils` package. Costs a new workspace package + its build config + a `package.json` entry on every consumer. Benefits accrue when a third consumer materializes (replay-test surface). Premature today.
- **(C)** Move into `@a-conversa/shell` under a `/test` subpath export. Costs a `shell` test-only export surface (the shell is otherwise prod-only). Cleaner from a discovery angle but pollutes the shell's published API. Rejected.

Decision: ship (A). The extraction trigger is the third Cytoscape consumer (replay-test surface, or a moderator-side audience-preview pane); a future task can lift the helper into a shared package then.

### §7 — Pan/zoom defaults on; no broadcast-polish flag yet

Cytoscape's `userPanningEnabled` / `userZoomingEnabled` default to `true`. The audience's broadcast-output role suggests they SHOULD be `false` — an OBS browser source with a draggable viewport is disorienting for downstream viewers — but flipping them off in this leaf would (a) couple two concerns (rendering baseline + interaction policy) and (b) prevent local-dev exploration where panning around the canvas is useful for debugging.

Decision: ship the Cytoscape defaults. The future `aud_layout_engine` (or a dedicated broadcast-polish sibling under `aud_animations.*`) flips the flags off when the surface is mounted inside the production OBS source — likely gated on a `MountProps.broadcastMode` boolean the host supplies. Today's audience surface is not yet OBS-deployed; the defaults are correct for the only consumer (local dev + Playwright fixtures).

The Vitest assertion `cy.userZoomingEnabled() === true && cy.userPanningEnabled() === true` pins the default so a future polish task that flips the flags surfaces an intentional Vitest change rather than a silent behaviour drift.

### §8 — No `window.__aConversaAudienceCyInstance` test seam

The participant exposes its Cytoscape instance via `window.__aConversaCyInstance` (gated on `import.meta.env.MODE === 'test'` or a `?aconversaTestMode=1` query param) so Playwright specs can drive the canvas directly. The audience has no Playwright spec at this tier (Decision §9), so the equivalent `window.__aConversaAudienceCyInstance` seam has no consumer.

`aud_ws_client.md`'s Decision §9 already established the audience's no-window-seam-without-a-consumer posture for `__aConversaAudienceWsStore`; this leaf inherits the same posture. The `cyRef?: (cy: Core | null) => void` callback prop is sufficient for the Vitest layer (the test passes a `ref` callback that captures the instance into a closure). The future `aud_session_url` Playwright spec decides whether the window seam earns its surface-area cost; if so, that spec's refinement adds the gated exposure inside `<AudienceGraphView>`.

### §9 — Full Playwright deferral to `aud_url_routing.aud_session_url` (inherits multi-leaf debt)

Per `ORCHESTRATOR.md`'s deferred-e2e exception: this task creates a component (`<AudienceGraphView>`) that no user flow currently reaches. No route renders it (the audience's `App.tsx:124` wildcard still maps to the placeholder); no event surface invokes it. Only the Vitest layer exercises it. Full deferral applies.

The natural inheriting wiring task is **`audience.aud_url_routing.aud_session_url`** (1d, already in the WBS at [`tasks/50-audience-and-broadcast.tji:208`](../../50-audience-and-broadcast.tji#L208), undocumented as of this writing). That task lands `<Route path="/sessions/:id" element={<AudienceLiveRoute />} />`, calls `useWsClient().trackSession(sessionId)` from inside the route's `useEffect`, and mounts `<AudienceGraphView>` inside its body — making the canvas reachable for the first time.

**Deferred-e2e debt `aud_session_url`'s refinement MUST scope** (closer registers this cumulative list against the task; the inherited debt count is now four leaves, at the threshold `ORCHESTRATOR.md` flags as "pay down inline" territory):

1. **From `aud_ws_client.md` Decision §10**: an authenticated audience visitor's `event-applied` broadcast arrives at the surface and renders a visible affordance.
2. **From `aud_state_management.md` Decision §7**: live projection from real broadcast events produces nodes/edges visible to a Playwright assertion.
3. **From `aud_anonymous_ws_subscribe.md` UI-stream e2e disposition**: an anonymous audience visitor sees a `node-created` arrive via the anonymous-WS-upgrade path.
4. **From this leaf**: the Cytoscape canvas mounts on `/sessions/:id`, the `audience-graph-root` testid is visible, and a seeded `node-created` event lands as a visible Cytoscape element. Assertions follow the participant's `participant-graph-render.spec.ts` shape (Cytoscape paints labels to `<canvas>` so DOM text queries cannot reach them — the wording / role-label round-trip is pinned at the Vitest layer; the Playwright spec asserts via the WS-store events slice plus the presence of a `<canvas>` layer inside `audience-graph-root`, mirroring the participant's post-deviation pattern).

The inherited-debt count is exactly at `ORCHESTRATOR.md`'s "2+ refinements, pay debt down inline" threshold. `aud_session_url` is a routing task; its scope naturally includes "the route + the subscription + the visible affordance," so absorbing all four assertions into ONE spec under that task is the right move — not a planning-debt time bomb, because every deferred assertion is a different observable behaviour of the same route landing. A future closer-pass MUST verify `aud_session_url`'s refinement scopes all four scenarios when it lands.

Alternative: split debt into a dedicated `aud_pw_live_session_arrival` Playwright catch-all. Rejected: would multiply task count for no architectural reason; `aud_session_url` is the natural home (the route + the trackSession lifecycle + the first-visible-affordance all live there).

Alternative: render `<AudienceGraphView>` inline inside this leaf's `PlaceholderRoute` (conditional on `useAudienceSession().sessionId !== null`) so the canvas is reachable today and a thin Playwright spec asserts component-presence. Rejected: would require either (a) calling `trackSession(sessionId)` from inside the placeholder (encroaching on `aud_session_url`'s scope and exporting `useWsClient` from the audience barrel against `aud_ws_client.md` Decision §6), or (b) rendering an always-empty canvas without trackSession (proves nothing about the event path the deferred assertions are about). Neither pays meaningful debt down.

Tech-debt registration: the closer step records the cumulative deferred-e2e against `aud_url_routing.aud_session_url` as a `note` on the WBS leaf (NOT as a new task — `aud_session_url` already exists and the note is the right mechanism for inherited scope).

### §10 — Render at propose-time, not commit-time (per ADR 0027)

Per [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md), structural events fire at propose-time, not at commit-time. The projection walks `node-created` and emits a node immediately — independent of whether any facet of the node is committed yet. The kind label flips when a `commit` of a `classify-node` proposal lands; the wording is rendered from the original `node-created` payload.

This mirrors the participant's Decision §9 — same rationale, same implementation. The audience's broadcast role makes the propose-time-rendering even more important than on the participant tablet: viewers expect to see "the proposal is on the screen the moment it's made" so the rhythm of the conversation translates to the broadcast. Gating on commit would inject 2-3s of delay between proposal and visible rendering, which would degrade the broadcast pace.

A future `edit-wording` flow may flip the wording on a committed `edit-wording.reword` proposal; that path is out of scope here and inherited from whatever the moderator's projection does (also not yet wired — both surfaces adopt the wording-flip on commit when `mod_edit_wording_*` lands as a future task).

### §11 — Localize labels at projection memoization time, not in the stylesheet

The participant's `<GraphView>` resolves `t('methodology.kind.${kind}')` and `t('methodology.edgeRole.${role}.label')` inside the `useMemo` that produces the elements array, then writes the resolved strings into `data.kindLabel` / `data.roleLabel`. Cytoscape's selector then reads `label: 'data(roleLabel)'` as a pure data binding. The audience inherits this exact pattern.

The alternative (resolving inside the Cytoscape stylesheet via a function-valued selector) is technically supported (Cytoscape stylesheet entries can be functions) but breaks selector caching: every paint would re-invoke `t()` per element, defeating the i18n cache and adding measurable cost on a large graph. Resolving at memo-time means re-localization happens only when `events` or `t` (the i18n instance identity) changes — exactly the right invalidation grain.

The audience's host-supplied `useTranslation()` from `react-i18next` returns a stable `t` reference between locale changes; the memo dependency on `t` ensures a runtime locale flip (`i18n.changeLanguage()`) does invalidate the memo and re-localize every label.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- `apps/audience/src/graph/GraphView.tsx` — new `<AudienceGraphView>` component: one-shot Cytoscape mount via `useEffect`, reads `useAudienceSession()` events, projects via `projectGraph`, filters dangling edges, runs `breadthfirst` layout only when truly-new node ids land, `data-testid="audience-graph-root"`, optional `cyRef` callback prop for test handles.
- `apps/audience/src/graph/projectGraph.ts` — pure `projectGraph(events: readonly Event[])` returning `{ nodes: AudienceNodeElement[]; edges: AudienceEdgeElement[] }`; single-pass walk emitting entity-layer Cytoscape descriptors (`kind: null` until `commit` of `classify-node` lands).
- `apps/audience/src/graph/cytoscapeTestEnv.ts` — `installCytoscapeTestEnv()` duplicated from the participant's helper (ResizeObserver stub, 2D canvas-context stub with `measureText`, `requestAnimationFrame`/`cancelAnimationFrame` polyfills backed by `queueMicrotask`); cross-app import forbidden under workspace layout — Decision §6.
- `apps/audience/src/graph/projectGraph.test.ts` — 10 Vitest cases covering empty input, node/edge projection, `kind`-flip on commit, dangling-edge filter, round-trip of all `StatementKind` + `EdgeRole` values, event-ordering invariance.
- `apps/audience/src/graph/GraphView.test.tsx` — 12 Vitest cases covering mount/crash, node/edge element sync, `audience-graph-root` testid, dangling-edge filtering, pan/zoom defaults enabled.
- `apps/audience/src/graph/cytoscapeTestEnv.test.ts` — 4 Vitest cases covering `installCytoscapeTestEnv()` stub installation, `measureText` stub, `requestAnimationFrame` polyfill, and `restore()` teardown.
- `apps/audience/package.json` — added `"cytoscape": "3.33.3"` (pinned, no caret) to `dependencies`; no `@types/cytoscape` (Cytoscape 3.33 ships its own `index.d.ts`).
- Playwright fully deferred to `audience.aud_url_routing.aud_session_url` per Decision §9; cumulative four-leaf debt list registered as a `note` on that WBS task by the closer.
