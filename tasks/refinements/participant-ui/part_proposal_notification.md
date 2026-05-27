# Visual flash + tab-badge pulse on new-proposal arrival

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_voting.part_proposal_notification`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_voting.part_vote_button_per_facet` (settled — the per-facet agree/dispute buttons inside each chip landed at commit `5088234`. The chip is now feature-complete for v1; this leaf adds the arrival-detection signal that animates the badge + flashes the affected graph entity).
- `!participant_ui.part_pending_proposals` (settled — every leaf under the subgroup is `complete 100`; the chip strip, the row-list selector, the badge wiring, and the tab seam are all in place). This leaf does NOT edit any pane internals — it adds a NEW arrival-detection hook + small attribute changes to the badge and graph nodes/edges, all driven from already-projected store data.
- `!backend.websocket_protocol.ws_proposal_status_broadcast` (settled — the `proposal-status` envelope already drives `pendingProposals` updates per [`apps/participant/src/ws/wsStore.ts:155-168`](../../../apps/participant/src/ws/wsStore.ts#L155); the raw `proposal` event lands via `applyEvent` at [`apps/participant/src/ws/wsStore.ts:121-140`](../../../apps/participant/src/ws/wsStore.ts#L121)). The arrival detector subscribes to the `events` array (not the broadcast payload) so it sees the proposal target's entity (`node_id` / `edge_id` / `target_kind` + `target_id`) directly off the discriminated-union payload.
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_pending_proposals.part_proposals_tab` (settled — established the badge span at [`apps/participant/src/proposals/PendingProposalsTabBar.tsx:40-46`](../../../apps/participant/src/proposals/PendingProposalsTabBar.tsx#L40) with `data-testid="participant-proposals-tabbar-badge"` + `data-count={count}`. The count itself is already reactive via `usePendingProposalsCount` — this leaf adds the *attention-drawing* animation that fires when the count *increases*, not the count itself).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.*` + `!participant_ui.part_per_facet_state_styling` + `!participant_ui.part_diagnostic_highlights` (settled — the Cytoscape graph + the per-entity class-binding machinery already exists. The diagnostic-highlight projection at [`apps/participant/src/graph/diagnosticHighlights.ts`](../../../apps/participant/src/graph/diagnosticHighlights.ts) is the prior-art for "transient per-entity class applied via a projected index"; this leaf mirrors that index shape for the flash effect).
- Prose-only context (NOT a `.tji` edge): ADR 0030 (settled — per-facet vote keying and the 11-arm proposal discriminated union; the per-arm target-entity derivation reuses the same `node_id` / `edge_id` / `target_kind` field set [`apps/participant/src/proposals/perProposalFacets.ts:100-112`](../../../apps/participant/src/proposals/perProposalFacets.ts#L100) and [`packages/shared-types/src/events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts) walks).

## What this task is

Add the *arrival-attention* layer that the participant tablet uses to surface a freshly-published proposal: the pending-proposals tab badge briefly animates (a one-shot pulse) and the affected entity in the graph briefly flashes (a one-shot ring-pulse on the node or edge), so the debater notices that a new proposal landed without having to scan the badge text or watch the graph tab. Per `docs/participant-ui.md:82` — "when the moderator publishes a new proposal, the pending-proposals tab badge increments. The graph view also visually flashes the affected entity briefly" — this leaf realizes both halves of that one sentence.

The reactive count already updates passively (the badge's `data-count` rolls up the moment the WS frame lands); this leaf adds the *transient signal that the count just changed*. Two surfaces consume the same arrival-detection seam:

- The tab badge applies a brief `motion-safe:animate-pulse` class window (or equivalent CSS keyframe) when the arrival fires, so the badge visibly notes itself in the tablet operator's peripheral vision. The pulse is one-shot per arrival (re-triggers cleanly when a second proposal lands while the first pulse is still running). `data-flashing="true"` carries the transient attribute so Vitest + Playwright can pin the gate structurally.
- The graph view's `<StatementNode>` / `<StatementEdge>` get a brief flash class on the *target entity* of the arrived proposal (resolved via the same target-derivation that the existing `facetTargetOf` partition already shapes, extended to the structural sub-kinds via a new `proposalTargetEntity(payload): { kind: 'node' | 'edge'; id: string } | null` selector). Same one-shot semantic, same `motion-safe:` gate. `data-flashing="true"` on the rendered entity card / label is the structural pin.

Concretely:

- A new arrival-detection hook lands at [`apps/participant/src/proposals/useNewProposalArrival.ts`](../../../apps/participant/src/proposals/useNewProposalArrival.ts) (NEW). The hook reads `useWsStore((s) => s.sessionState[id]?.events)` with reference-equality bailout, tracks the highest-seen `event.id` for `kind === 'proposal'` events across renders via `useRef`, and on each new arrival adds an entry to a per-session `Map<entityKey, expiresAt>` that the consumer reads via a derived index. The hook returns `{ activeFlashes: ReadonlyMap<string, ProposalFlashEntry>; isBadgeFlashing: boolean }`; each entry carries the target's entity-kind + entity-id + a `clearAt` timestamp. The hook self-clears entries after the flash window via a single `setTimeout` keyed on the soonest expiry. Decision §1 — single hook, not two parallel "badge" + "graph" hooks — keeps the detection cost paid once per render.
- A new target-entity selector lands at [`apps/participant/src/proposals/proposalTargetEntity.ts`](../../../apps/participant/src/proposals/proposalTargetEntity.ts) (NEW). Walks the 11 proposal sub-kinds and returns `{ kind: 'node'; id: string } | { kind: 'edge'; id: string } | null` (the `null` arm handles meta-disagreement-only structural arms that have no rendered-graph target, defensively, even though none of the current 11 arms hit it — see Decision §2). The selector is a pure function over `ProposalPayload`.
- [`apps/participant/src/proposals/PendingProposalsTabBar.tsx`](../../../apps/participant/src/proposals/PendingProposalsTabBar.tsx) consumes `useNewProposalArrival(sessionId).isBadgeFlashing` and applies `data-flashing={isBadgeFlashing}` + the `motion-safe:animate-pulse` class on the badge span when the flag is true. The badge `data-count` value, the testid, and the slate-200 chip look are byte-stable from `part_proposals_tab`'s decisions.
- [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx) calls `useNewProposalArrival(id)` at the parent level (so the detector runs once per render regardless of which tab is foregrounded — same hoist rationale as the projection chain per `part_proposals_tab` Decision §4), and threads `activeFlashes` as a new prop into `<GraphView>` and `<PendingProposalsTabBar>`. The hook call is colocated with the existing eight-memo projection chain at OperateRoute.tsx:234-283.
- [`apps/participant/src/graph/StatementNode.tsx`](../../../apps/participant/src/graph/StatementNode.tsx) + [`apps/participant/src/graph/StatementEdge.tsx`](../../../apps/participant/src/graph/StatementEdge.tsx) accept a new `isFlashing: boolean` data field on their `data-*` payload (read from `cytoscape ele.data()`). When true, the card / label adds a `motion-safe:animate-pulse ring-4 ring-amber-500/80 ring-offset-2 ring-offset-white` class block (mirroring the moderator's coherency-hint-active pattern at `apps/moderator/src/graph/StatementNode.tsx:348` so the visual vocabulary stays consistent across surfaces). The `isFlashing` data field is threaded through [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts)'s element projector, which gains a new `flashIndex: ReadonlyMap<string, true>` parameter (the second element-kind/id key set; the existing six index-maps are paralleled). Decision §3 covers why the flash index goes through the projection chain rather than via a separate prop drill.
- [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) accepts a new `flashIndex` prop and threads it into the existing `projectGraph(...)` call. The Cytoscape element diff is unchanged at the wrapper layer — only the per-element `data.isFlashing` value rolls up new; `<StatementNode>` / `<StatementEdge>` render the visual change.
- Vitest pins:
  - [`apps/participant/src/proposals/useNewProposalArrival.test.ts`](../../../apps/participant/src/proposals/useNewProposalArrival.test.ts) (NEW) — empty `events` → no flash, no badge pulse; first `proposal` event seen → both `activeFlashes` and `isBadgeFlashing` go true with the target entity present; second `proposal` event lands while first flash still active → both targets present, badge pulse re-triggered; flash window expires → entries clear; non-proposal events (vote/commit) do NOT trigger a flash; missing-session → empty state.
  - [`apps/participant/src/proposals/proposalTargetEntity.test.ts`](../../../apps/participant/src/proposals/proposalTargetEntity.test.ts) (NEW) — one case per the 11 proposal sub-kinds asserting the `{kind, id}` (or `null`) return.
  - [`apps/participant/src/proposals/PendingProposalsTabBar.test.tsx`](../../../apps/participant/src/proposals/PendingProposalsTabBar.test.tsx) (extended) — three new cases: badge `data-flashing="false"` on initial render with no proposals; `data-flashing="true"` + `motion-safe:animate-pulse` class present after a `proposal` event lands; `data-flashing="false"` again after the flash window expires.
  - [`apps/participant/src/graph/StatementNode.test.tsx`](../../../apps/participant/src/graph/StatementNode.test.tsx) (extended) — three new cases: `isFlashing: false` → no `animate-pulse` class; `isFlashing: true` → `motion-safe:animate-pulse ring-4 ring-amber-500/80` classes present + `data-flashing="true"`; `isFlashing: true` together with the coherency-hint highlight → both class blocks compose without clobbering each other (the moderator's StatementNode.test already pins the composition pattern at line 1504 + 1765 + 1788 + 2152, mirrored here).
  - [`apps/participant/src/graph/StatementEdge.test.tsx`](../../../apps/participant/src/graph/StatementEdge.test.tsx) (extended) — three matching cases on the edge label.
  - [`apps/participant/src/graph/projectGraph.test.ts`](../../../apps/participant/src/graph/projectGraph.test.ts) (extended) — two new cases: `flashIndex` containing a node id → that node's `data.isFlashing === true`; `flashIndex` containing an edge id → that edge's `data.isFlashing === true`; absent ids stay `false`; the eight existing index parameters' identity is unchanged (the new param is appended).
  - [`apps/participant/src/routes/OperateRoute.test.tsx`](../../../apps/participant/src/routes/OperateRoute.test.tsx) (extended) — one new case: dispatching a `proposal` event whose target is a rendered node sets `data-flashing="true"` on the badge AND on the target node card; awaiting the flash-window expiry clears both.
- Playwright: [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) (extended) adds a step (10) appended after the predecessor's step 9: with the moderator capturing a NEW proposal AFTER the test participant has been on the operate route for some time, the badge's `data-flashing="true"` attribute appears and the target node's `data-flashing="true"` data-attr appears within the flash window; both clear after the window expires. Decision §6 covers the assertion shape + the polling timing.
- **No new i18n keys.** The flash is purely visual; no localized text changes.
- **No new ADR.** Every architectural choice below applies an existing ADR (0005 — Tailwind; 0022 — committed verifications; 0026 — surface-local) or repeats an idiom the moderator's `StatementNode`/`StatementEdge` already established for the coherency-hint flash.

Out of scope (deferred to sibling or future leaves):

- **Not a sticky / persistent highlight.** This is a one-shot transient flash that auto-clears after the window expires. Persistent decoration of "you have not voted on this proposal" lives on the chip strip (`part_per_facet_state_styling`, `part_own_vote_indicators`) and on the badge count (the count itself is the persistent signal). The flash is purely the *attention-attractor* on arrival.
- **Not an audio cue.** `docs/participant-ui.md` mentions no audio for proposal arrival; the surface is a touch tablet usually in a quiet debate room and an audio beep would distract more than help.
- **Not focus-stealing.** The flash does NOT call `ref.current.focus()` or interrupt keyboard input. Visual only.
- **Not a route-level scroll/pan jump to the target entity.** The graph view's pan/zoom state is owned by `part_pan_zoom_tap`; this leaf does NOT recenter the viewport on the flashed entity. If user testing reveals the gap, a follow-up `part_proposal_pan_to_target` (0.5d, depends `!part_proposal_notification`) under `part_voting.*` is the registration target — this leaf does NOT register it.
- **Not a banner / toast notification.** The badge pulse + graph flash are the two notification surfaces; a separate banner would compete with the existing status-indicator footer chip and add a third UI region. Out of scope.
- **Not a proposal-withdrawn / vote-arrived / commit-arrived signal.** This leaf is scoped to *new proposal arrival* only. The vote / commit / withdraw / meta-disagreement-marked events already update the chip's `data-facet-status` reactively (via the projector), which is signal enough for those flows. The flash semantic is reserved for the higher-information event of "a brand-new candidate landed".
- **Not own-proposal suppression.** Per Decision §4, the flash fires for ALL proposal arrivals including those the current participant authored — the flash doubles as a server-acceptance confirmation for the proposer.
- **Not a Cucumber scenario.** The arrival-detection path is pure client-side (a `useRef`-tracked diff over the already-projected `events` array). The upstream `proposal` event's wire shape is already Cucumber-pinned by the existing `ws_proposal_status_broadcast` and `ws_*` proposal-capture scenarios. Decision §7 covers the rationale.
- **Not a new wire shape, projector field, or store slot.** Read-only consumer of the existing `events` array.
- **Not a `prefers-reduced-motion` opt-out toggle in the UI.** The CSS `motion-safe:` Tailwind variant honors the OS-level preference; no in-app toggle is needed. The static (non-animated) state still applies `data-flashing="true"` so the structural pin still works on reduced-motion browsers (e.g. CI's headless Chromium with the media query set).
- **Not a per-participant filter on which proposals trigger a flash.** All pending proposals flash for everyone. Filtering to "proposals where this participant has not yet voted" would mean rebuilding own-vote state on each render; the cost outweighs the benefit when the count badge already encodes the post-filter "needs my action" signal at the count itself (and the chip strip surfaces the per-facet own-vote state inline).
- **Not a moderator-side mirror.** The moderator's pending-proposals surface lives in the right-sidebar accordion (per `mod_right_sidebar`) and surfaces arrival via the accordion's row insertion already. The moderator's existing coherency-hint flash on `StatementNode` (`apps/moderator/src/graph/StatementNode.tsx:348`) covers a different signal class (diagnostic firing). A future `mod_proposal_flash` MAY want the same arrival flash on the moderator's graph; if so, it would be its own task scoped at that point.

## Why it needs to be done

The participant tablet's primary input flow is "see what's pending → vote". The badge increments and the chip list updates passively, but a debater who is focused on the in-progress discussion may not glance at the tablet for several seconds after a new proposal lands — by which point the badge increment looks identical to the steady-state count. The two-surface arrival flash (badge pulse + graph entity ring-pulse) gives the debater a peripheral-vision cue that *something just changed*, which is the bridge between the methodology's "moderator publishes a new proposal" step and the debater's "I should look at the tablet now" reaction. Without it, the tablet is a passive surface that requires polling; with it, the tablet announces state changes.

Downstream WBS:

- **`part_voting` parent rolls up to `complete 100`.** With `part_vote_button_per_facet` (✓), `part_vote_single_tap` (✓), `part_change_vote_pre_commit` (✓), and `part_agree_all_gesture` (closed as superseded per ADR 0030 — see [`tasks/refinements/participant-ui/part_agree_all_gesture.md`](part_agree_all_gesture.md)) all settled, this leaf is the last open `part_voting.*` leaf. After it ships, the parent `part_voting` rolls up.
- **`part_withdraw.*` chain** (P3) depends `!part_voting`. The withdraw chain hangs off the parent's `complete 100`; closing this leaf unblocks the parent rollup which unblocks the withdraw chain.
- **`replay_test.*` chain** depends `!part_voting` (per [`tasks/40-participant-ui.tji:365`](../../40-participant-ui.tji#L365) chain). Same unblock pathway.

Architecturally this leaf **closes out the participant's notification vocabulary for v1**: the chip strip is the *steady-state* signal (which facets are pending and whose vote is needed), the badge count is the *aggregate* signal (how many pending proposals), and now the badge pulse + graph flash are the *transient arrival* signal (something just changed). Together they cover the three temporal scales (steady / aggregate / transient) the methodology calls for.

## Inputs / context

### Design + ADRs

- [DESIGN.md](../../../DESIGN.md) — agreement-driven graph editing; the debater's attention is the bottleneck.
- [docs/participant-ui.md — P2. Vote on a pending proposal](../../../docs/participant-ui.md#L78-L87), specifically line 82: "when the moderator publishes a new proposal, the pending-proposals tab badge increments. The graph view also visually flashes the affected entity briefly." This leaf realizes both halves of that sentence.
- [docs/participant-ui.md — Visual state representation](../../../docs/participant-ui.md#L129-L134) — distinguishes the persistent per-facet markers + pending count badge from the transient arrival cue.
- [ADR 0005 — Tailwind CSS with shared design tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — inline Tailwind utility classes; `motion-safe:` variant for reduced-motion honor.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every check below is a committed test.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the participant surface owns its mounted tree; the flash machinery is participant-local.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the 11 proposal sub-kinds' target-entity field set the `proposalTargetEntity` selector walks.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_proposals_tab.md`](part_proposals_tab.md) — Decision §3 (badge count is total pending; per-participant filter deferred), Decision §4 (projection chain hoisted at the route — the same hoist rationale applies to the arrival-detection hook). Decision §9 named `part_proposal_flash` as a future possible follow-up; this leaf realizes that follow-up under its WBS-registered name `part_proposal_notification`.
- [`tasks/refinements/participant-ui/part_vote_button_per_facet.md`](part_vote_button_per_facet.md) — predecessor that finalized the chip's affordance vocabulary; explicitly names this leaf as the next-up arrival animation (line 36).
- [`tasks/refinements/participant-ui/part_vote_single_tap.md`](part_vote_single_tap.md) + [`tasks/refinements/participant-ui/part_change_vote_pre_commit.md`](part_change_vote_pre_commit.md) — sibling vote-policy pins; both also call out this leaf as the arrival animation (lines 28 / 49).
- [`tasks/refinements/participant-ui/part_diagnostic_highlights.md`](part_diagnostic_highlights.md) — the prior-art "transient per-entity class applied via a projected index" pattern. This leaf mirrors the index → projector → StatementNode/Edge data-attr → CSS class threading.
- [`tasks/refinements/participant-ui/part_per_facet_state_styling.md`](part_per_facet_state_styling.md) — the existing `data-facet-status` attribute machinery on the chip strip. The new `data-flashing` attribute follows the same naming pattern.
- [`tasks/refinements/per-facet-refactor/pf_part_detail_panel_three_facet_rows.md`](../per-facet-refactor/pf_part_detail_panel_three_facet_rows.md) — established that visual changes to per-facet rendering go through the projector rather than via parallel state stores.

### Live code the surface plugs into

- [`apps/participant/src/routes/OperateRoute.tsx:234-283`](../../../apps/participant/src/routes/OperateRoute.tsx#L234) — the eight-memo projection chain. The arrival-detection hook call lands here (after the existing memos, before the JSX return) so its lifetime matches the projection chain's render granularity. The hook returns are passed via prop-thread (no extra context) to `<PendingProposalsTabBar>` (badge flag) and `<GraphView>` (active flash index).
- [`apps/participant/src/routes/OperateRoute.tsx:330-370`](../../../apps/participant/src/routes/OperateRoute.tsx#L330) — the route's JSX return. `<PendingProposalsTabBar sessionId={id} />` grows one prop `isFlashing={...}` (or, alternatively, the bar reads the hook directly — see Decision §1). `<GraphView ... />` grows one prop `flashIndex={...}`. The tab-conditional render block is unchanged.
- [`apps/participant/src/proposals/PendingProposalsTabBar.tsx:40-46`](../../../apps/participant/src/proposals/PendingProposalsTabBar.tsx#L40) — the badge span. New `data-flashing={isFlashing}` attribute and conditional `motion-safe:animate-pulse` class.
- [`apps/participant/src/ws/wsStore.ts:54-86`](../../../apps/participant/src/ws/wsStore.ts#L54) — the per-session `WsSessionState` shape (`events`, `pendingProposals`, `activeDiagnostics`). The arrival-detection hook subscribes to `s.sessionState[id]?.events` with reference-equality bailout; no store shape change.
- [`apps/participant/src/ws/wsStore.ts:121-140`](../../../apps/participant/src/ws/wsStore.ts#L121) — `applyEvent`. The detection hook keys off the `events` array reference change that `applyEvent` produces (the array is replaced wholesale per the existing immutable update pattern), so the subscriber re-runs exactly once per applied event.
- [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) — the Cytoscape mount + element diff. New `flashIndex: ReadonlyMap<string, true>` prop threaded into the `projectGraph(...)` call. The per-element `data.isFlashing` rolls up via the projector.
- [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts) — the final element projector (the eight-memo chain's terminal node). Gains one new parameter `flashIndex`; per-element `data.isFlashing` is set from `flashIndex.get(elementId) === true`. No other parameter changes.
- [`apps/participant/src/graph/StatementNode.tsx`](../../../apps/participant/src/graph/StatementNode.tsx) + [`apps/participant/src/graph/StatementEdge.tsx`](../../../apps/participant/src/graph/StatementEdge.tsx) — the rendered card / label components. New `isFlashing` read off `ele.data()`; when true, the existing class string concatenation grows the flash class block. The moderator's siblings [`apps/moderator/src/graph/StatementNode.tsx:335-348`](../../../apps/moderator/src/graph/StatementNode.tsx#L335) and [`apps/moderator/src/graph/StatementEdge.tsx:240`](../../../apps/moderator/src/graph/StatementEdge.tsx#L240) are the visual-vocabulary template — the same `ring-4 ring-amber-500/80 ring-offset-2 ring-offset-white motion-safe:animate-pulse` class block is reused so the two surfaces' flash looks identical.
- [`apps/participant/src/proposals/perProposalFacets.ts:94-112`](../../../apps/participant/src/proposals/perProposalFacets.ts#L94) — the existing `facetTargetOf` partition that covers 5 of the 11 sub-kinds. The new `proposalTargetEntity` selector covers ALL 11 (facet-targeting + structural).
- [`packages/shared-types/src/events/proposals.ts:88-403`](../../../packages/shared-types/src/events/proposals.ts#L88) — the 11 proposal payload arms with their `node_id` / `edge_id` / `target_kind` / `target_id` / `parent_node_id` fields. The `proposalTargetEntity` selector walks the discriminated union once.

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) — the existing scenario seeds at least two `capture-node` proposals across its steps. The new step 10 (NEW) appends a third proposal capture AFTER the participant has been on the operate route for some time, and asserts both `data-flashing="true"` attributes appear within the flash window.
- [`playwright.config.ts:303-324`](../../../playwright.config.ts#L303) — the `chromium-participant-skeleton` project's `testMatch` regex already includes `participant-pending-proposals`; no Playwright config change.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/proposals/useNewProposalArrival.ts` — NEW. The arrival-detection hook.
- `apps/participant/src/proposals/useNewProposalArrival.test.ts` — NEW. Vitest cases pinning the detection across empty/first/second-arrival/window-expiry/non-proposal/missing-session.
- `apps/participant/src/proposals/proposalTargetEntity.ts` — NEW. The 11-arm target-entity selector.
- `apps/participant/src/proposals/proposalTargetEntity.test.ts` — NEW. Vitest cases — one per sub-kind.
- `apps/participant/src/proposals/PendingProposalsTabBar.tsx` — modified. Add `isFlashing` consumption + `data-flashing` attribute + conditional class.
- `apps/participant/src/proposals/PendingProposalsTabBar.test.tsx` — modified. Three new cases for the flashing-state lifecycle.
- `apps/participant/src/proposals/index.ts` — modified. Export the two new symbols.
- `apps/participant/src/graph/StatementNode.tsx` — modified. Read `isFlashing` from `ele.data()`; conditional class.
- `apps/participant/src/graph/StatementNode.test.tsx` — modified. Three new cases.
- `apps/participant/src/graph/StatementEdge.tsx` — modified. Same as StatementNode for the edge label.
- `apps/participant/src/graph/StatementEdge.test.tsx` — modified. Three new cases.
- `apps/participant/src/graph/projectGraph.ts` — modified. New `flashIndex` parameter; per-element `isFlashing` field.
- `apps/participant/src/graph/projectGraph.test.ts` — modified. Two new cases for the flashIndex-driven roll-up + a pin that the eight existing params' identity is unchanged.
- `apps/participant/src/graph/GraphView.tsx` — modified. New `flashIndex` prop; thread into `projectGraph` call.
- `apps/participant/src/routes/OperateRoute.tsx` — modified. Call the arrival-detection hook; thread `isFlashing` + `flashIndex` to children.
- `apps/participant/src/routes/OperateRoute.test.tsx` — modified. One new case pinning both `data-flashing` flips on a `proposal` event arrival.
- `tests/e2e/participant-pending-proposals.spec.ts` — modified. New step 10 for the arrival flash.

### Files this task does NOT touch

- `apps/participant/src/proposals/PendingProposalsPane.tsx` and its testfile — the pane's render is unchanged; the arrival flash is on the badge + the graph, not on the chip strip (the chip strip's `data-facet-status` already updates reactively, which IS the chip's "something changed" signal — adding a second class block on the chip would compete with the existing per-status styling). Decision §5.
- `apps/participant/src/stores/uiStore.ts` — no UI store shape change.
- `apps/participant/src/ws/wsStore.ts` — no WS store shape change.
- `apps/participant/src/proposals/derivePendingProposals.ts` / `perProposalFacets.ts` / `otherVotesByFacet.ts` / `otherVotesByProposal.ts` — the pane's data pipeline is unchanged.
- `apps/participant/src/detail/*` — the entity-detail panel is unchanged. Tap-to-open via the badge or by tapping the flashed entity is the user's choice; the panel itself does not gain a flash.
- `apps/moderator/src/*`, `apps/audience/*`, `apps/server/*`, `apps/root/*` — no cross-surface change.
- `packages/shared-types/src/events/proposals.ts` — the discriminated union is consumed unchanged; no schema edit.
- `packages/i18n-catalogs/*` — no new i18n key.
- `apps/participant/package.json` / `apps/participant/vite.config.ts` / `apps/participant/tsconfig.json` — no new dep, no new build config.
- `playwright.config.ts` — the project regex already matches `participant-pending-proposals`.
- `tasks/40-participant-ui.tji` — `complete 100` marker lands at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md#L32-L42); not part of this refinement's allowlist.
- `docs/adr/` — no new ADR; every decision applies an existing ADR or a pattern an established refinement settled.

### Hook shape (`apps/participant/src/proposals/useNewProposalArrival.ts`)

```tsx
import { useEffect, useRef, useState } from 'react';

import { useWsStore } from '../ws/wsStore';
import { proposalTargetEntity } from './proposalTargetEntity';

export interface ProposalFlashEntry {
  readonly elementId: string; // node_id or edge_id
  readonly kind: 'node' | 'edge';
  readonly clearAt: number; // performance.now()-relative ms
}

export interface NewProposalArrivalState {
  readonly activeFlashes: ReadonlyMap<string, ProposalFlashEntry>;
  readonly isBadgeFlashing: boolean;
}

const EMPTY_STATE: NewProposalArrivalState = {
  activeFlashes: new Map(),
  isBadgeFlashing: false,
};

export const FLASH_WINDOW_MS = 1200;

export function useNewProposalArrival(sessionId: string): NewProposalArrivalState {
  const events = useWsStore((s) => s.sessionState[sessionId]?.events);
  const seenProposalEventIds = useRef<Set<string>>(new Set());
  const [state, setState] = useState<NewProposalArrivalState>(EMPTY_STATE);

  useEffect(() => {
    if (events === undefined) return;
    const now = performance.now();
    let didChange = false;
    const nextFlashes = new Map(state.activeFlashes);
    // Drop expired entries first.
    for (const [key, entry] of nextFlashes) {
      if (entry.clearAt <= now) {
        nextFlashes.delete(key);
        didChange = true;
      }
    }
    let newArrival = false;
    for (const event of events) {
      if (event.kind !== 'proposal') continue;
      if (seenProposalEventIds.current.has(event.id)) continue;
      seenProposalEventIds.current.add(event.id);
      newArrival = true;
      const target = proposalTargetEntity(event.payload.proposal);
      if (target !== null) {
        nextFlashes.set(target.id, {
          elementId: target.id,
          kind: target.kind,
          clearAt: now + FLASH_WINDOW_MS,
        });
        didChange = true;
      }
    }
    if (newArrival || didChange) {
      setState({
        activeFlashes: nextFlashes,
        isBadgeFlashing: newArrival || nextFlashes.size > 0,
      });
    }
    if (nextFlashes.size > 0) {
      const soonest = Math.min(...Array.from(nextFlashes.values(), (e) => e.clearAt));
      const ms = Math.max(0, soonest - now);
      const timeout = setTimeout(() => setState((prev) => recompute(prev)), ms);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [events]);

  return state;
}

function recompute(prev: NewProposalArrivalState): NewProposalArrivalState {
  const now = performance.now();
  const next = new Map(prev.activeFlashes);
  for (const [key, entry] of next) {
    if (entry.clearAt <= now) next.delete(key);
  }
  return {
    activeFlashes: next,
    isBadgeFlashing: next.size > 0,
  };
}
```

(Implementer may simplify the timer juggling — the sketch shows intent; the test suite pins the observable behavior, not the literal code.)

- The hook's `seenProposalEventIds` ref persists across renders so a re-render does NOT re-fire the flash for the same event. On hook unmount + remount (e.g., navigating away and back), the set resets, so a re-entry into the route would re-flash any pending proposals — Decision §8 covers whether that's the intended behavior.
- The hook returns a `ReadonlyMap` reference that's stable across renders unless the contents change (the `setState` only fires when `didChange` is true), so downstream `useMemo` dep arrays bail out cleanly.
- `performance.now()` (not `Date.now()`) so the timing is monotonic and immune to system-clock jumps mid-debate.
- `setTimeout` (not `requestAnimationFrame`) — the flash window is in the human-perception range (~1s), not animation-frame granularity; `setTimeout` is simpler and more testable.

### Target-entity selector shape (`apps/participant/src/proposals/proposalTargetEntity.ts`)

Returns the entity the flash should mount on, walking the 11-arm discriminated union:

| Sub-kind | Returns |
| --- | --- |
| `capture-node` | `{ kind: 'node', id: node_id }` |
| `classify-node` | `{ kind: 'node', id: node_id }` |
| `set-node-substance` | `{ kind: 'node', id: node_id }` |
| `set-edge-substance` | `{ kind: 'edge', id: edge_id }` |
| `edit-wording` (reword arm) | `{ kind: 'node', id: node_id }` |
| `edit-wording` (restructure arm) | `{ kind: 'node', id: node_id }` (the source node — the new node hasn't been rendered yet) |
| `capture-edge` | `{ kind: 'edge', id: edge_id }` |
| `decompose` | `{ kind: 'node', id: parent_node_id }` |
| `interpretive-split` | `{ kind: 'node', id: parent_node_id }` |
| `axiom-mark` | `{ kind: 'node', id: node_id }` |
| `meta-move` | `{ kind: target_kind, id: target_id }` (the `target_*` fields per the meta-move arm) |
| `break-edge` | `{ kind: 'edge', id: edge_id }` |
| `amend-node` | `{ kind: 'node', id: node_id }` |
| `annotate` | `{ kind: target_kind, id: target_id }` |

All 11 arms have a target; the `null` return arm is defensive (a future zero-target proposal sub-kind, e.g. a session-level meta-move, would land here without breaking the consumer). The selector is pure-function — no React, no store reads.

### What the new hook MUST NOT do

- **No store mutations.** The hook is a pure consumer of `useWsStore`'s events array; no `setState` on the WS store, no dispatch to the UI store.
- **No WS send.** The flash is a render-only effect; no `client.send(...)` call.
- **No reads of `pendingProposals`.** The map is a useful aggregate for the badge *count*, but the *arrival signal* must come from the `events` array because the structural proposal sub-kinds don't necessarily populate `pendingProposals` in the same frame the proposal event lands (per the per-facet/per-proposal distinction in ADR 0030 — the `proposal-status` broadcast may lag the underlying `proposal` event by a network turn). The detection MUST track the underlying event stream.
- **No closure over the current render's `state` value inside `setTimeout`.** The `recompute` function takes the latest state via `setState`'s callback form so a stale-closure bug does not retain dropped entries.
- **No imperative DOM access.** No `document.querySelector`, no `ref.current.classList.add`. The flash state lives in React state and propagates to children via props + the `isFlashing` data field.

### Test layers per ADR 0022

Six pins, each anchoring a different observable property:

1. **Vitest `useNewProposalArrival.test.ts` (NEW)** — cases:
   - (a) Missing session → empty state, no flash.
   - (b) Empty events → empty state.
   - (c) Single `proposal` event lands → one flash entry + `isBadgeFlashing === true`.
   - (d) Second `proposal` event lands while first window still active → two flash entries + still `isBadgeFlashing === true`.
   - (e) Flash window expires → entries clear + `isBadgeFlashing === false`.
   - (f) Non-proposal events (vote / commit / meta-disagreement-marked) do NOT trigger a flash.
   - (g) Re-render with no new events → state is identical reference (no churn).
   - (h) The same event seen twice (e.g., from a replay-vs-live overlap) only fires the flash once.
   - Total: ~9 cases. Smoke count grows by +9.
2. **Vitest `proposalTargetEntity.test.ts` (NEW)** — one case per the 11 proposal sub-kinds + one for the `null` defensive arm = ~12 cases. Smoke count grows by +12.
3. **Vitest `PendingProposalsTabBar.test.tsx` (extended)** — three new cases pinning the badge's `data-flashing` lifecycle + class application. Smoke count grows by +3.
4. **Vitest `StatementNode.test.tsx` + `StatementEdge.test.tsx` (extended)** — three new cases each pinning the entity's flash class application + composition with existing class blocks. Smoke count grows by +6.
5. **Vitest `projectGraph.test.ts` (extended)** — two new cases pinning the `flashIndex` roll-up. Smoke count grows by +2.
6. **Vitest `OperateRoute.test.tsx` (extended)** — one new case pinning both `data-flashing` flips on a `proposal` event arrival. Smoke count grows by +1.
7. **Playwright `participant-pending-proposals.spec.ts` step 10 (NEW step appended)** — under `make up`, with the operate route already mounted: the moderator captures a NEW proposal; within the flash window (~1200ms; Playwright polls with a generous timeout), both the badge's `data-flashing="true"` and the target node's `data-flashing="true"` are observable; after the window expires both flip back. The polling MUST tolerate the WS-frame delivery latency (a one-second window is too tight for a Playwright assertion in CI; use a longer Playwright timeout for the `expect(...).toHaveAttribute('data-flashing', 'true')` and a separate assertion for the eventual clear).

Total smoke count growth: ~+33.

### UI-stream e2e policy (apply)

**E2e is in scope; scoped Playwright is the default.** The participant operate route is reachable today (`/p/sessions/:id`), the badge and the graph nodes are both rendered today, and this leaf makes a user-visible behavior change (the flash) the moment it lands. Per the orchestrator note, full deferral to a future `part_pw_*` catch-all is the exception — for this leaf, the new step 10 in the existing `participant-pending-proposals.spec.ts` covers the badge + graph flash + clear within one scenario. No e2e is deferred from this leaf.

The Playwright spec composes with the existing fixture (the predecessor's seeded session with capturing proposals); the new step appends after step 9 (the per-facet dispute click from `part_vote_button_per_facet`). The CI cost is one extra step in an existing scenario, not a new scenario file.

### Backend / WS / projector / methodology-engine policy (apply)

This leaf changes NO wire shape, NO broadcast envelope, and NO projector output. The arrival-detection hook is a pure client-side consumer of the already-projected `events` array (which the upstream protocol scenarios pin). No Cucumber scenario is needed (Decision §7). If a future change to the proposal payload's target-entity field set lands (e.g., a 12th sub-kind), the `proposalTargetEntity` selector's case-set is updated in the same change-set as the new payload arm; the Vitest case-suite serves as the catch-up gate.

### Budget honesty (1d)

- ~30 min: write `proposalTargetEntity.ts` + `proposalTargetEntity.test.ts` (12-arm switch + per-arm assertion).
- ~1.5h: write `useNewProposalArrival.ts` + its Vitest test suite (the timer-juggling + ref-set semantics + the per-state assertion).
- ~45 min: extend `StatementNode.tsx` / `StatementEdge.tsx` + their test suites (the class composition + the three new cases each).
- ~45 min: extend `projectGraph.ts` + its test (the new param + the two new cases).
- ~30 min: extend `GraphView.tsx` (one new prop + the projector-call thread).
- ~30 min: extend `PendingProposalsTabBar.tsx` + its test (the data-flashing attribute + the three new cases).
- ~30 min: extend `OperateRoute.tsx` + its test (call the hook, thread the returns; one new case).
- ~1h: write the Playwright step 10 (timing + the flash-then-clear assertion); verify under the compose stack.
- ~45 min: full `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:e2e` + visual sanity on the badge pulse + the graph entity flash at 1280×720 + 1024×768.
- ~30 min: WBS-status ritual (refinement Status block + `complete 100` in `.tji` + parent `part_voting` rollup check).

Risk surface: moderate. The timer-juggling in the arrival hook is the highest-risk piece — stale-closure bugs in `setTimeout` callbacks are common. The Vitest suite uses `vi.useFakeTimers()` to pin the timer behavior deterministically. The Playwright timing is the second-highest risk — the WS-frame delivery + the React re-render + the CSS animation start has to land inside Playwright's polling window. Decision §6 covers the timing.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes; lockfile static.
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — all modified + new files compile under TypeScript strict ([ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)).
3. **`pnpm -F @a-conversa/participant build` exits zero** — same library-mode build; bundle output static beyond the new files' code.
4. **`pnpm run check`** stays green (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke`** stays green; smoke count grows by **~+33** (per the per-suite breakdown above).
6. **`pnpm run test:e2e --project=chromium-participant-skeleton`** under `make up` runs the extended `participant-pending-proposals.spec.ts` green — the existing steps 1-9 pass unchanged; the new step 10 asserts the badge + graph flash flips appearing and clearing within the flash window.
7. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
8. **The new hook owns no side effects beyond `setState` + `setTimeout` cleanup** — a grep for `fetch\|XMLHttpRequest\|WebSocket\|useNavigate\|document\.\|window\.location` under `apps/participant/src/proposals/useNewProposalArrival.ts` returns zero matches.
9. **`prefers-reduced-motion` honored** — the rendered class string includes the `motion-safe:` prefix on every animation utility; a Vitest assertion on the rendered class string confirms the prefix is present (a regression that drops the prefix would be caught at the unit layer, not just at the visual layer).
10. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_proposal_notification` task block per the task-completion ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).
11. **Predecessor's existing assertions unchanged** — every `participant-pending-proposals.spec.ts` step 1-9 assertion still passes; `OperateRoute.test.tsx`'s existing cases pass; `StatementNode.test.tsx` + `StatementEdge.test.tsx`'s existing cases pass (the coherency-hint flash composition is preserved per Decision §3); `projectGraph.test.ts`'s existing cases pass with the new param added at the tail.
12. **Parent `part_voting` rolls up** — after this leaf's `complete 100` lands, every leaf under `part_voting` is `complete 100`; the closer also adds `complete 100` to the `part_voting` parent block per the rollup ritual (`tj3` does not auto-roll-up).

## Decisions

### 1. Single arrival-detection hook called at the route; not two parallel hooks for badge + graph

Two alternatives surveyed:

- **(A) One hook called at `<OperateRouteAuthenticatedBody>`** (chosen). The hook runs once per render at the parent (matching the projection chain's hoist per `part_proposals_tab` Decision §4), returns `{ activeFlashes, isBadgeFlashing }`, and the two consumers (`<PendingProposalsTabBar>`, `<GraphView>` via `projectGraph(...)`) read from the same hook output via prop-thread. The seen-event ref + the timer machinery exist in exactly one place.
- **(B) Two hooks — `useBadgePulse(sessionId)` at the tab bar and `useGraphFlash(sessionId)` at the graph view** — each subscribes to the events array independently. Rejected. The seen-event ref would have to be duplicated (or shared via a store slice — another new store seam for no benefit), and the badge pulse + graph flash would have to re-derive the "new arrival since last render" signal twice per WS frame. The single-hook approach pays the detection cost once and threads the output.

The hook is called at the route level (not at the tab bar level) for the same reason `part_proposals_tab` Decision §4 hoists the projection chain: the detection runs regardless of which tab is foregrounded, so a participant who is on the graph tab still sees the badge pulse the moment the proposal arrives (rather than the badge pulse firing only when the participant happens to be foregrounding the proposals tab).

### 2. Target-entity selector covers all 11 proposal sub-kinds (not a subset)

Two alternatives surveyed:

- **(A) Cover only the 5 facet-targeting sub-kinds** (capture-node, classify-node, set-node-substance, set-edge-substance, edit-wording) — the ones `facetTargetOf` already handles. Rejected. Structural proposals (decompose, axiom-mark, annotate, meta-move, break-edge, amend-node, interpretive-split, capture-edge) ALSO target a rendered entity (the parent node for decompose; the marked node for axiom-mark; the target node/edge for annotate; etc.). Excluding them would mean the graph flash silently doesn't fire for those arrivals — surprising behavior and a regression risk every time a new structural sub-kind lands.
- **(B) Cover all 11 sub-kinds** (chosen). The selector returns `{ kind, id }` for every arm. The defensive `null` arm handles a future zero-target sub-kind without breaking the consumer (the badge still pulses; just no graph flash for that arrival).

The selector is named `proposalTargetEntity` (not `facetTargetOf`) to signal that its remit is the *graph-entity target* for visualization purposes, not the facet-keyed vote target the predecessor's selector encodes. The two selectors coexist — `facetTargetOf` for vote dispatch, `proposalTargetEntity` for flash placement.

### 3. Flash threaded through the projector (`projectGraph`), not via parallel prop-drill into `<StatementNode>` / `<StatementEdge>`

Three alternatives surveyed:

- **(A) Flash index threaded into `projectGraph(...)` as a new parameter; each element's `data.isFlashing` is set by the projector** (chosen). Mirrors the existing diagnostic-highlight + own-vote + other-vote threading pattern: per-entity state goes through the projector so the rendered card / label gets it via `ele.data()` (the canonical Cytoscape pattern). No new prop on `<StatementNode>` / `<StatementEdge>`'s outer JSX surface.
- **(B) Parallel prop on `<GraphView>` that bypasses the projector and is read inside `<StatementNode>` via context or via a separate Cytoscape-class-applier effect.** Rejected. Adds a second pathway from "session state" to "rendered class" that competes with the projector's existing single-source-of-truth role. The next refinement that adds yet another per-entity transient cue would have to choose between the two pathways and the conventional answer "use the projector" would be muddled.
- **(C) A Cytoscape style-rule keyed off the element's id directly (via dynamic style injection)** — bypass React entirely. Rejected. The graph already uses React-rendered DOM cards (`<StatementNode>`, `<StatementEdge>`) as the per-element rendering surface (a Cytoscape decision pinned by predecessor refinements); dynamic style injection on the Cytoscape side competes with the React render tree.

The projector chain gains exactly one new parameter (`flashIndex: ReadonlyMap<string, true>`) appended at the tail; the existing eight indexes' positions are unchanged so existing call sites' diffability is preserved.

### 4. Flash fires for ALL arrivals including own-proposed

Two alternatives surveyed:

- **(A) Flash for ALL arrivals including those the current participant authored** (chosen). The flash doubles as a server-acceptance confirmation for the proposer ("yes, your proposal landed"). Suppressing own-proposed flashes would mean the proposer has no visual feedback on the moment their proposal is published — they would have to glance at the chip strip or the badge text to confirm. The peripheral-vision flash is the lower-attention-cost confirmation.
- **(B) Suppress flashes for own-proposed arrivals** — fire only when the proposal's `actor` differs from `currentParticipantId`. Rejected. Adds one more "who is the current participant?" gate to the detection hook; the gate is `currentParticipantId !== event.actor` which requires the participant id to be threaded into the hook. The cost-benefit favors the simpler all-arrivals rule.

If user testing reveals that own-proposed flashes are distracting (e.g. the proposer is mid-typing on the moderator's behalf and the flash competes with their input), a follow-up `part_proposal_flash_own_suppress` (0.25d, depends `!part_proposal_notification`) under `part_voting.*` is the registration target. This leaf does NOT register it.

### 5. No flash on the chip strip / pane row; flash is badge + graph only

Two alternatives surveyed:

- **(A) Add a flash class block to the newly-arrived row inside the pane** — make the freshly-inserted row pulse for the same window. Rejected. The chip strip already updates reactively with `data-facet-status` reflecting the new facet's status; the row's *presence* is the visual signal of arrival. Adding a flash on top of the new row would mean three concurrent visual signals (chip status color + flash class + the row appearing in the list) and would crowd the per-row UX. The badge pulse is the systematic signal that the proposals tab has new content; the graph flash is the spatial signal that the entity in the graph has new content; the pane row's appearance is already its own signal.
- **(B) Flash only on the badge + the graph entity, NOT on the pane row** (chosen). The chip strip stays purely status-driven (status + own-vote + other-votes are the per-facet state machine), the row stays presence-driven (it appears when the proposal is pending; disappears when terminated), and the flash is reserved for the *cross-surface attention attractor* that announces "look at the tablet now".

### 6. Flash window of 1200ms; CSS keyframes (Tailwind `motion-safe:animate-pulse`) over JS-driven animation

Two alternatives surveyed:

- **(A) CSS `motion-safe:animate-pulse` for ~1200ms, applied via a transient class that the React state controls** (chosen). Mirrors the moderator's existing `StatementNode.tsx:348` + `StatementEdge.tsx:240` coherency-hint pattern, so the visual vocabulary is shared across surfaces. The `motion-safe:` prefix honors `prefers-reduced-motion` at the OS level without an in-app toggle. 1200ms is long enough to register in peripheral vision (>1s) and short enough to not stack on rapid arrivals (a second proposal within the window re-triggers cleanly via the timer reset).
- **(B) JS-driven animation via Web Animations API** — `element.animate(...)` with declarative keyframes in JS. Rejected. The CSS approach is declarative, testable via class-string assertion, and reuses the existing Tailwind keyframe (no new CSS to maintain). The JS API would require an imperative `ref.current.animate(...)` call which competes with React's render model and is awkward to test in jsdom.

Playwright timing: 1200ms is comfortably above WS-frame delivery latency (~50ms typical) + React re-render (~20ms) + CSS animation start (~16ms), so the assertion window `expect(badge).toHaveAttribute('data-flashing', 'true')` with Playwright's default 5-second timeout has plenty of slack. The eventual-clear assertion uses `expect.poll(...)` waiting up to ~3 seconds for `data-flashing` to flip back to `false`.

### 7. No Cucumber scenario; Vitest + Playwright suffice

Two alternatives surveyed:

- **(A) Add a Cucumber scenario** that asserts "when a `proposal` event lands on the WS connection, the participant's arrival-detection seam fires". Rejected. The upstream `proposal` event's wire shape + per-session state mutation is already Cucumber-pinned at the protocol boundary (`ws_proposal_status_broadcast` and the proposal-capture scenarios). This leaf is a UI consumer of the already-pinned data; the detection logic is a pure function of the events array, which Vitest pins exhaustively (the `useNewProposalArrival.test.ts` cases hand-build event sequences and assert the hook's output verbatim).
- **(B) Vitest + Playwright** (chosen). The Vitest suite covers the detection-hook semantics across the seven observable state transitions; the Playwright step 10 covers the end-to-end "broadcast lands → React re-render → CSS class applied → flash visible → window expires → class removed" flow under the real compose stack.

### 8. Hook unmount + remount re-fires flashes for currently-pending proposals

Two alternatives surveyed:

- **(A) `seenProposalEventIds` ref resets on hook unmount; re-entry to the route re-flashes pending proposals** (chosen). The user expectation when re-entering the operate route is "show me what's new" — if there are pending proposals when the route mounts, the flash announces them (the participant may have been on a different route or a different browser tab). The flash duplicates the badge count's signal but the spatial-graph signal is novel on remount.
- **(B) Persist the seen-set across remounts via a zustand slice** — no re-flash on re-entry. Rejected. Adds a new store slice + the cross-mount lifecycle complexity for a marginal UX benefit; the cost-benefit favors the simpler unmount-resets rule. The badge text alone announces "you have pending proposals" — the flash on remount is a secondary, brief cue.

### 9. Tech-debt registration

Two follow-ups named crisply for the closer; both optional (orchestrator's call):

- **`part_proposal_pan_to_target`** (0.5d, depends `!part_proposal_notification`, under `part_voting.*`) — pan/zoom the graph view to recenter on the flashed entity. Not requested for v1; flash alone is the spatial cue today. **Action for Closer**: do NOT register unprompted; mention in Status block as "future possible follow-up if user testing reveals the gap".
- **`part_proposal_flash_own_suppress`** (0.25d, depends `!part_proposal_notification`, under `part_voting.*`) — suppress the flash for arrivals authored by the current participant. Not requested for v1; the proposer gets the same confirmation flash as everyone else. **Action for Closer**: do NOT register unprompted; mention in Status block as "future possible follow-up if user testing reveals own-flash is distracting".

### 10. No new ADR needed

Every decision applies an existing ADR or repeats an established refinement's idiom:

- 0005 (Tailwind utility classes + `motion-safe:` variant) covers the animation primitive.
- 0022 (committed verifications) covers the test layers.
- 0026 (surface-local) covers the no-shell-extraction posture for the new hook + selector.
- 0030 (per-facet vote keying + 11-arm discriminated union) covers the target-entity selector's case set.
- `part_diagnostic_highlights` (the participant's prior-art "transient per-entity class via projected index" pattern) covers the projector threading.
- Moderator's `StatementNode`/`StatementEdge` coherency-hint flash pattern (`motion-safe:animate-pulse ring-4 ring-amber-500/80 ...`) covers the visual vocabulary.

No new dependency, no new architectural seam, no security-relevant trade-off.

## Open questions

(none — all decided)

## Status

**Done 2026-05-26.**

Landed artifacts:

- `apps/participant/src/proposals/proposalTargetEntity.ts` + `proposalTargetEntity.test.ts` (NEW) — pure-function 11-arm selector resolving `{ kind: 'node' | 'edge', id }` for every proposal sub-kind, with 15 Vitest cases (one per arm plus the two `edit-wording` inner variants).
- `apps/participant/src/proposals/useNewProposalArrival.ts` + `useNewProposalArrival.test.ts` (NEW) — arrival-detection hook with `useRef`-tracked seen-id dedup, `setTimeout`-keyed soonest-expiry auto-clear, `performance.now()` monotonic clock; 9 Vitest cases pinning missing-session, empty events, single arrival, second-mid-window arrival, window expiry, non-proposal ignore, reference-stable no-op re-render, repeat-id dedup, and three-entity stack.
- `apps/participant/src/proposals/index.ts` — barrel re-exports added for `proposalTargetEntity`, `useNewProposalArrival`, `FLASH_WINDOW_MS`, `EMPTY_FLASH_MAP`, and the companion types.
- `apps/participant/src/graph/projectGraph.ts` + `projectGraph.test.ts` — projector signature widened with optional ninth `flashIndex: ReadonlyMap<string, true>` param (default `EMPTY_FLASH_INDEX`); per-element `isFlashing: boolean` stamped on both `ParticipantNodeData` and `ParticipantEdgeData`. Four new Vitest cases pinning default-false, node-id roll-up, edge-id roll-up, and survive-classify-commit.
- `apps/participant/src/graph/GraphView.tsx` + `GraphView.test.tsx` — new Cytoscape stylesheet entries `node[?isFlashing]` (amber overlay) + `edge[?isFlashing]` (amber underlay) mirror the moderator's coherency-hint hue; DOM mirror rows for both node and edge gained `data-flashing="true"|"false"` + conditional `motion-safe:animate-pulse` className. Four new Vitest cases (default-false, node-true, edge-true, stylesheet-presence).
- `apps/participant/src/proposals/PendingProposalsTabBar.tsx` + `PendingProposalsTabBar.test.tsx` — optional `isFlashing` prop drives `data-flashing` + `motion-safe:animate-pulse ring-2 ring-amber-500/80` on the badge span. Three new Vitest cases (default false, isFlashing prop flips both attr + class, drop-back to false).
- `apps/participant/src/routes/OperateRoute.tsx` + `OperateRoute.test.tsx` — `useNewProposalArrival(id)` called once at the authenticated body (Decision §1 hoist); `arrival.activeFlashes` materialised into a `flashIndex: ReadonlyMap<string, true>` that threads into the existing `projectGraph(...)` memo; `arrival.isBadgeFlashing` threaded as `<PendingProposalsTabBar isFlashing>`. One new Vitest case using `vi.useFakeTimers()` pins both `data-flashing` flips on a `proposal` event arrival and the eventual clear after `FLASH_WINDOW_MS`.
- `tests/e2e/participant-pending-proposals.spec.ts` — new step 11 (appended after the predecessor's per-facet dispute change-vote step) seeds a fresh `node-created` + `proposal` event pair via the `__aConversaWsStore` test seam, asserts both badge and target node mirror surface `data-flashing="true"` within the flash window, then polls for the auto-clear after the window elapses.

Collateral fixture adjustments (required by the new `isFlashing` field on the projector's node + edge data shapes):

- `apps/participant/src/detail/EntityDetailPanel.test.tsx` and `apps/participant/src/detail/lookupEntity.test.ts` gained the required `isFlashing: false` default on their `ParticipantNodeData` / `ParticipantEdgeData` test fixtures. The refinement allowlist did not name these files, but the field is non-optional on the data type (matching the existing explicit-posture sibling fields), so the fixtures had to grow the default. No behavior change.

WBS:

- `tasks/40-participant-ui.tji:269-273` — `part_voting.part_proposal_notification` now carries `complete 100`.
- `tasks/40-participant-ui.tji:246` — parent `part_voting` carries `complete 100` per Acceptance #12 (every leaf — `part_vote_button_per_facet`, `part_vote_single_tap`, `part_change_vote_pre_commit`, `part_agree_all_gesture`, and now `part_proposal_notification` — is `complete 100`). `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.

Verifications (per ADR 0022):

- `pnpm run check` — green.
- `pnpm run test:smoke` — green (239 files, 4711 tests; smoke count grew by ~33 per the refinement's per-suite plan).
- `pnpm run test:e2e --project=chromium-participant-skeleton -- tests/e2e/participant-pending-proposals.spec.ts` under `make up` — green (13 passed).
- `tj3 project.tjp` — silent.

Tech-debt registration (Decision §9): no follow-up registered; the two named possibilities (`part_proposal_pan_to_target` and `part_proposal_flash_own_suppress`) wait on user-testing signal per the closer's instructions.
