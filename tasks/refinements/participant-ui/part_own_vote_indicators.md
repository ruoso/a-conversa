# Render this debater's own per-facet vote indicators on the participant's read-mostly graph

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_own_vote_indicators`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_graph_view.part_per_facet_state_styling` (settled — shipped `computeFacetStatuses(events)` at [`apps/participant/src/graph/facetStatus.ts:200-336`](../../../apps/participant/src/graph/facetStatus.ts#L200) (the canonical walk over `proposal` / `vote` / `commit` / `meta-disagreement-marked` events that already maps every proposal envelope id to its `(entityKind, entityId, facet)` triple and accumulates per-`(participant, facet)` votes; this leaf reuses the same proposal → target mapping and the same `event.kind === 'vote'` branch shape but emits a per-`(entityId, facet)` index of the local participant's own current vote rather than the per-facet rollup `FacetStatus`). Plus the `<ul data-testid="participant-graph-status-mirror">` DOM mirror with one `<li data-testid="participant-node-status">` per node and one `<li data-testid="participant-edge-status">` per edge carrying the sentinel-string `data-rollup-status` / `data-facet-*` attribute family this leaf extends).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_graph_render` (settled — shipped the Cytoscape mount + the pure `projectGraph(events, ...)` projector + the per-session `useWsStore((s) => s.sessionState[sessionId]?.events)` selector idiom this leaf threads a new index argument through. Live code: [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx#L1), [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts#L1)).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_axiom_mark_decoration` (settled, commit `c717fe2` — established the leaf-overlay template: verbatim port a moderator selector into the participant workspace, widen `projectGraph`'s signature with an extra index argument, stamp a per-element field on the emitted `data`, layer a Cytoscape stylesheet branch on top of the per-status branches, extend the per-`<li>` mirror with a `data-*` attribute, add a fresh `test()` block to `tests/e2e/participant-graph-render.spec.ts`). Decision §3 + §5 of this leaf reuse the same posture, with the divergences spelled out below (the value is a closed enum sentinel `agree | dispute | none`, not a boolean; the stylesheet layer paints a label-outline color rather than a border or overlay; symmetry is node-AND-edge because votes can target both per the wire vote semantics — see Decision §1).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_annotation_render` (settled, commit `32ebd93` — established the symmetric node+edge stamping pattern when the wire vocabulary attaches to either kind: two indexes, two stylesheet selectors, two mirror-attribute extensions. This leaf adopts the same symmetric posture because vote events reference a `proposal_id` whose target may be a node-facet OR an edge-facet — `set-edge-substance` proposals carry per-edge votes (settled `set-edge-substance` proposals already appear in the participant's facet-status walk per [`apps/participant/src/graph/facetStatus.ts:269-283`](../../../apps/participant/src/graph/facetStatus.ts#L269); the moderator-side projection extension landed in `mod_vote_indicators_in_sidebar` per its Decision §4 + Status note "the outer-map key was renamed from `nodeId` to `entityId`")).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_diagnostic_highlights` (settled 2026-05-17 — the most recent overlay leaf; established the "use a fresh Cytoscape stylesheet primitive that does NOT collide with the four prior overlays" discipline this leaf renews. Decision §3 below walks the layer-collision check and lands on `text-outline-*` for the own-vote ring (the prior four overlays own `border-*`, `background-*` / `outline-*` for rollup, `overlay-*` for annotation node, `underlay-*` for annotation edge + diagnostic edge — `text-outline-*` is unclaimed). Also established the symmetric mirror posture this leaf inherits — `<li participant-node-status>` AND `<li participant-edge-status>` BOTH grow the same `data-own-vote-*` attributes).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_session_join.part_lobby_view` + `!participant_ui.part_graph_view.part_graph_render` (settled — established that the authenticated participant's `userId` is the canonical seam for "who am I right now?". `<OperateRoute>`'s mid-mount auth guard at [`apps/participant/src/routes/OperateRoute.tsx:86`](../../../apps/participant/src/routes/OperateRoute.tsx#L86) narrows `auth.status === 'authenticated' && auth.user !== undefined` before mounting `<GraphView sessionId={id} />`; `auth.user.userId: string` is the UUID that the server stamps onto every `vote.payload.participant` field — they are the same value because the same Authelia identity maps to the same `users` row and the server's vote handler uses the connection's authenticated user id verbatim. Decision §4 below threads `auth.user.userId` into `<GraphView>` as an explicit `currentParticipantId` prop rather than reaching for `useAuth()` inside the canvas component).
- Prose-only context (NOT a `.tji` edge): moderator-side `moderator_ui.mod_graph_rendering.mod_vote_indicators_on_graph` (settled 2026-05-11 — refinement [`tasks/refinements/moderator-ui/mod_vote_indicators_on_graph.md`](../moderator-ui/mod_vote_indicators_on_graph.md)) and `moderator_ui.mod_pending_proposals_pane.mod_vote_indicators_in_sidebar` (settled 2026-05-16 — refinement [`tasks/refinements/moderator-ui/mod_vote_indicators_in_sidebar.md`](../moderator-ui/mod_vote_indicators_in_sidebar.md)) are the canonical "client derives per-(entity, facet) votes from the event log via `projectVotesByFacet`; per-participant rendering" references. The moderator artifacts: [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts) (the `Vote` type — `{ participantId: string; choice: 'agree' | 'dispute' | 'withdraw' }`; the `EMPTY_VOTES_BY_FACET` / `EMPTY_VOTES` shared empty references; the `projectVotesByFacet(events): Map<string, Map<FacetName, Vote[]>>` projection — single-pass over the event log; latest vote per `(proposal, participant)` wins; insertion order preserves each participant's first vote arrival; bucketed by `entityId` (node OR edge) per `mod_vote_indicators_in_sidebar` Decision §4). Decision §2 of this leaf walks through the port-vs-narrow choice and lands on porting the same projection verbatim into the participant workspace BUT collapsing the per-`(entity, facet)` `Vote[]` to a single `OwnVote | 'none'` sentinel at the participant's at-a-glance card layer.
- Prose-only context (NOT a `.tji` edge): the BLOCKED sibling leaf `!participant_ui.part_graph_view.part_other_vote_indicators` ([`tasks/40-participant-ui.tji:158-162`](../../40-participant-ui.tji#L158) — declared as the IMMEDIATE downstream `depends !part_own_vote_indicators`). The boundary settled below at Decision §1: THIS leaf renders ONLY the current participant's own per-`(entity, facet)` vote — one bit per voteable target — using a high-visibility ring around the entity card; the sibling renders the per-target tally of OTHER participants' votes (the per-participant dot row the moderator surfaces). The two surfaces compose at the render layer (own-vote ring + others'-dot row on the same Cytoscape element) but the data seams are independent — the sibling can adopt the same `projectVotesByFacet` projection but filters complementary to this leaf's `voter.id === currentParticipantId` filter, so this leaf MUST NOT pre-build the per-other-participant aggregation seam to keep the sibling's ground clean.
- Prose-only context (NOT a `.tji` edge): wire-format support. The `vote` event envelope is already shipped and propagates to the participant's WS connection — [`packages/shared-types/src/events.ts:361-368`](../../../packages/shared-types/src/events.ts#L361) defines `votePayloadSchema` (`{ proposal_id: uuid, participant: uuid, vote: 'agree' | 'dispute' | 'withdraw', voted_at: ISO8601 }`); the server's `event-applied` broadcast fans every committed `vote` event out to every subscribed WS connection per session (the same fan-out the participant's `facetStatus.ts` walk at line 269 already consumes successfully); the participant's WS connection therefore already receives every `vote` envelope that targets this session, and the per-session `useWsStore((s) => s.sessionState[id]?.events)` slice already contains them. Vote events are also already pinned by Cucumber at [`tests/behavior/backend/ws-vote.feature`](../../../tests/behavior/backend/ws-vote.feature) (write path) + [`tests/behavior/backend/ws-proposal-status.feature`](../../../tests/behavior/backend/ws-proposal-status.feature) (the broadcast scenario "After a vote, both subscribed clients receive a proposal-status envelope reflecting the current per-facet state" at line 31 — confirms vote events reach every connection, including the participant's read-mostly one). **No wire-format change in scope; no Cucumber scenario gap to close; no tech-debt deferral needed for the wire layer.** Decision §2 covers the projection-only widening on the participant side.

## What this task is

Extend the participant's read-mostly `<GraphView>` so every node OR edge whose **current participant's** own vote on the latest pending proposal targeting any of its facets surfaces an at-a-glance "I voted X here" indicator on its Cytoscape element — the sixth visual-vocabulary layer on top of `part_graph_render` (baseline), `part_per_facet_state_styling` (per-facet rollup status), `part_axiom_mark_decoration` (axiom-mark boolean overlay), `part_annotation_render` (annotation amber overlay), and `part_diagnostic_highlights` (structural-diagnostic amber ring). Before this leaf, an inbound `vote` envelope by the current participant lands in the participant's per-session events log, contributes to the per-facet `disputed` / `agreed` rollup the canvas paints, and is silent at the per-participant disposition layer — the debater can SEE the facet is `proposed` or `disputed` but cannot tell at a glance "where did I vote agree and where did I vote dispute?" without scanning every proposal in the (future) pending-proposals pane. After this leaf, the debater sees their own per-target vote disposition surfaced on the canvas itself.

Concretely the deliverable is:

- A new `apps/participant/src/graph/ownVotes.ts` — a participant-narrow adaptation of the moderator's [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts) `projectVotesByFacet` projection. Exports: an `OwnVote` type (the narrowed sentinel: `'agree' | 'dispute' | 'none'` — Decision §1 explains the `'none'` literal + the deliberate exclusion of `'withdraw'`); a `OwnVoteIndex` type (`{ readonly nodes: ReadonlyMap<string, OwnVote>; readonly edges: ReadonlyMap<string, OwnVote>; }` — Decision §1 explains the symmetric bucketing); an `EMPTY_OWN_VOTES` module-scope frozen reference for memoization stability; a pure `projectOwnVotes(events, currentParticipantId): OwnVoteIndex` walker (single-pass: maps each `proposal` envelope id to its `(entityKind, entityId, facet)` target — same shape `facetStatus.ts:208-235` already maintains; records the current participant's latest vote on each tracked proposal; collapses per-`(entity, facet)` votes by rolling up the entity to its highest-priority own-vote signal — Decision §1 walks the rollup rule); plus two thin helpers `ownVoteForNode(index, nodeId): OwnVote` and `ownVoteForEdge(index, edgeId): OwnVote` mirroring the predecessor leaves' presence-helper posture (Decision §8). The header comment links back to the moderator selector source AND to `facetStatus.ts`'s proposal-walk for the drift-risk warning (both walks read the same wire shape; a future `proposal-target` schema change touches both).
- An extension to [`projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts) that takes a SEVENTH argument `ownVoteIndex: OwnVoteIndex` (after `events`, `facetStatusIndex`, `axiomMarkIndex`, `nodeAnnotationIndex`, `edgeAnnotationIndex`, `diagnosticHighlightIndex`) and stamps an `ownVote: OwnVote` field on every emitted node AND edge `data` object (Decision §1 — symmetric across both row kinds because the wire-side `proposal-target` already covers both — see the Inputs section's mod-sidebar Decision §4 reference). `ParticipantNodeData` and `ParticipantEdgeData` interfaces both grow the same field.
- An extension to [`GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) that (a) accepts a new `currentParticipantId: string` prop threaded in from `<OperateRoute>` (which reads it from `auth.user.userId` — Decision §4 walks the routing seam); (b) derives `ownVoteIndex = projectOwnVotes(events, currentParticipantId)` via a seventh `useMemo` parallel to the existing `axiomMarkIndex` / `nodeAnnotationIndex` / `edgeAnnotationIndex` / `diagnosticHighlightIndex` memos; (c) appends TWO additional Cytoscape stylesheet selectors at the END of the existing block — `node[ownVote = "agree"]`, `node[ownVote = "dispute"]`, `edge[ownVote = "agree"]`, `edge[ownVote = "dispute"]` (four selectors total — one per `(target-kind × choice)` cell; Decision §3 walks the layer choice). The selectors paint a high-visibility `text-outline-color` ring (Cytoscape's label-outline primitive, an unclaimed layer per the four prior overlays' usage — Decision §3 walks the collision-check) that emerald-greens the label outline for `agree` and rose-reds it for `dispute`. The `'none'` sentinel hits no override and stays at the baseline; the four prior overlays' branches (per-status border, axiom double, annotation amber overlay/underlay, diagnostic amber border-override) all compose orthogonally.
- An extension to the existing per-node + per-edge `<li>` mirror entries — both grow a single `data-own-vote="agree|dispute|none"` attribute (sentinel-string posture matching the existing `data-rollup-status` / `data-is-axiom` / `data-has-annotation` / `data-diagnostic-severity` family — explicit `"none"` rather than omit-when-empty per Decision §5). The mirror-attribute shape choice (one tri-state attribute vs. two `cast` + `value` attributes) is Decision §7.
- Tests pin: Vitest at the projection-helper layer (`projectOwnVotes` round-trips proposal+vote pairs for `classify-node` / `set-node-substance` / `edit-wording` / `amend-node` (node targets) AND `set-edge-substance` (edge target); a vote by NOT the current participant is silently dropped; a vote by the current participant with `'withdraw'` falls back to `'none'` per Decision §1; latest vote wins on a same-participant retake; a vote on a committed-or-meta-disagreement-marked proposal still surfaces the participant's own vote since the methodology preserves the per-participant record); at the projector layer (`projectGraph` stamps `ownVote` on both nodes AND edges from the index; the default for no-vote is `'none'`; the field survives a classify-node commit), at the `<GraphView>` render layer (both node and edge mirror surface the right `data-own-vote`; the Cytoscape element set carries the same value), AND at the `<OperateRoute>` integration layer (the route threads `auth.user.userId` into `<GraphView>` as `currentParticipantId`; the auth-guard branch already runs before the canvas mount so the prop is always a non-empty UUID by the time `<GraphView>` mounts — Decision §4). Playwright at the e2e layer extends `tests/e2e/participant-graph-render.spec.ts` with a **sixth** `test()` block using `kate` + `leo` (Decision §6 — the next-block pair earmarked by `part_e2e_user_pool_expansion` for this leaf; the spec stays `fullyParallel`).

Out of scope (deferred to existing or future leaves):

- **Per-other-participant vote rendering.** The sibling task `participant_ui.part_graph_view.part_other_vote_indicators` ([`tasks/40-participant-ui.tji:158-162`](../../40-participant-ui.tji#L158)) is the home for the per-target dot row showing all OTHER participants' votes (the same per-participant chromatic dot pattern the moderator surfaces in `mod_vote_indicators_on_graph` + `mod_vote_indicators_in_sidebar`). The boundary is non-negotiable per Decision §1: this leaf scopes to a single bit per voteable target — "did I (the local participant) vote here, and if so, agree or dispute?" — using a high-visibility outline; the sibling adopts the moderator's per-participant dot vocabulary for the OTHER participants and renders it as a small in-card dot row. The two surfaces compose orthogonally (own = label outline; others = dot row).
- **Withdraw rendering.** The `vote` wire enum has three arms (`agree`, `dispute`, `withdraw`); the participant's pre-commit voting flow exposes only two (`agree` / `dispute`) per [`apps/participant/src/stores/voteStore.ts:31`](../../../apps/participant/src/stores/voteStore.ts#L31) (the slice's `VoteValue = 'agree' | 'dispute'` narrowing — withdrawal is a post-commit P3 flow owned by `part_withdraw.*`, a different store path with a different wire shape). Decision §1 mirrors that narrowing at the indicator layer: a participant who voted `withdraw` on a post-commit proposal collapses to `'none'` in `OwnVote` because the at-a-glance "did I vote here pre-commit?" surface treats withdrawal as the absence of a pre-commit agreement signal — the explicit "I withdrew my agreement" surface belongs in the future `part_withdraw_indicator` polish leaf alongside the withdrawal action itself.
- **Voting action / vote casting from the canvas.** This leaf is rendering-only. Casting / changing a vote from the participant tablet is the `part_voting.part_vote_single_tap` future leaf which reads / writes the `useVoteStore` pending-vote slice at [`apps/participant/src/stores/voteStore.ts`](../../../apps/participant/src/stores/voteStore.ts) and sends via the shell's `useWsClient()`. The own-vote indicator this leaf paints reflects ONLY the server-acknowledged latest vote (the `vote` event on the wire / in `events`); local UI-tap pending votes from `useVoteStore` are NOT surfaced here (a future polish leaf can layer "I tapped but it hasn't landed yet" as a dashed variant of the same outline if real usage shows the latency confuses debaters).
- **Per-facet own-vote breakdown.** This leaf collapses per-`(entity, facet)` to one rolled-up `OwnVote` per entity (Decision §1 — `agree` if any of the entity's tracked facets carry an agree; `dispute` if any carry a dispute; conflict-tie-breaker is `dispute` wins per Decision §1's rationale). The per-facet detail (the local participant agreed on the classification facet but disputed the wording facet) belongs in the future entity-detail-panel where a React surface can render one per-facet row carrying the own-vote alongside the facet-status pill. Same posture as `part_axiom_mark_decoration` / `part_annotation_render` / `part_diagnostic_highlights`: the canvas carries the at-a-glance signal; the entity detail panel carries the per-facet breakdown.
- **Cucumber scenario for vote rendering.** Vote events are already pinned by Cucumber at the protocol layer (write path in `ws-vote.feature`; broadcast in `ws-proposal-status.feature` line 31 — "After a vote, both subscribed clients receive a proposal-status envelope reflecting the current per-facet state"). The wire arrives at the participant's WS connection; this leaf is a UI-rendering layer ON TOP of an already-pinned protocol surface, so a new Cucumber scenario would be duplicative. Per the ORCHESTRATOR.md UI-stream e2e policy + the "Cucumber has been flat" steer, the e2e contract this leaf adds is the Playwright block 6 (Decision §6).
- **Visual regression on the rendered own-vote outline.** Same deferral as the prior overlay leaves — pixel comparisons of the rendered label outline are out of scope; the DOM-mirror `data-own-vote` assertions are the load-bearing test contract.

## Why it needs to be done

`m_participant_mvp` ([`tasks/99-milestones.tji`](../../99-milestones.tji)) is the milestone at which a debater can see and engage with the live graph from their tablet. `part_graph_render` lit up the rendering surface; the four prior overlay leaves painted the rollup-state / axiom / annotation / diagnostic vocabularies; this leaf paints the **per-participant self-disposition** vocabulary — the at-a-glance "where do I stand on the live questions right now?" surface that closes the methodology's primary feedback loop on the debater tablet.

The methodology assumes the debater can answer "did I already vote on this?" without scanning a sidebar:

- [`docs/methodology.md`](../../../docs/methodology.md) § "Facets" + "Votes / Withdrawal" — the per-(participant, proposal) vote IS the agreement primitive; every other state on the canvas (proposed / agreed / disputed) aggregates per-participant votes. The debater needs to see their own contribution to that aggregation; otherwise the per-facet rollup is opaque ("the facet is `disputed` — but did I dispute it, or am I one of the agreers and someone else disputed?").
- [`docs/participant-ui.md`](../../../docs/participant-ui.md) P1 + P2 (view the graph + single-tap votes) — P1 is the "read the live state" surface; the per-(participant, target) self-disposition is on the read side of the line because the debater reads their own past dispositions before tapping a new vote.
- [`DESIGN.md`](../../../DESIGN.md) "Agreement-driven progress" — the methodology engine treats `agreed` as the green-light state for forward progress; the debater seeing "I voted agree on this; we're one step away from `agreed`" is the load-bearing signal for "should I be pushing back on a holdout right now?". Without the own-vote indicator, the debater has to drill into the (future) pending-proposals pane to reconstruct their own contribution every time the question "am I the holdout, or is someone else?" comes up.

Downstream concretely:

- **`part_other_vote_indicators`** (the BLOCKED sibling) consumes the SAME `projectOwnVotes` projection shape BUT inverts the filter to the complement set (`voter.id !== currentParticipantId`). When that leaf lands, it lifts the per-`(entity, facet)` walk into a shared helper (`projectVotesByFacetForParticipant(events, currentParticipantId)` returning `{ own: ..., others: ... }` or two parallel projections) — Decision §2 below pre-shapes `projectOwnVotes` to make that future split cheap (it returns a `OwnVoteIndex` keyed by entity, NOT by `(entity, facet)`; the future others-side projection will use the moderator's `projectVotesByFacet` shape verbatim because the others side needs the per-participant dot detail).
- **`part_voting.part_vote_single_tap`** (the canvas-side vote-cast gesture, a future leaf) uses the own-vote indicator as its "did I already vote here?" precondition. The gesture's confirm UI ("you previously voted agree; change to dispute?") reads the indicator's current value via the same `ownVoteForNode` / `ownVoteForEdge` helpers exported by `ownVotes.ts`.
- **`part_entity_detail_panel`** (the React-driven tap-to-detail panel) is the natural home for the per-facet own-vote breakdown (the entity has three facets; the participant agreed on two and disputed one — the panel shows three rows; the canvas shows the rolled-up disputed signal). When that leaf lands, it imports `projectOwnVotes` AND a sibling per-facet projection (or re-walks per-facet on tap; the entity-detail-panel's render frequency is gesture-driven, not subscription-driven, so a per-tap walk is acceptable).
- **`audience.aud_other_vote_indicators`** (future, sibling to `aud_annotation_rendering`) becomes the third Cytoscape consumer of the `projectVotesByFacet` family. When it lands, the natural extraction trigger lifts the shared helper (the moderator's `projectVotesByFacet` + this leaf's `projectOwnVotes` + the future `part_other_vote_indicators` projection) into `@a-conversa/shell`.
- The participant's `<GraphView>` becomes the **second concrete adoption of the moderator's vote-vocabulary** (Cytoscape edition, self-disposition narrow; the moderator is React/ReactFlow edition, full per-participant breakdown). The audience surface (future) will be the third.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Cytoscape on the participant surface; the stylesheet's `node[ownVote = "<value>"]` / `edge[ownVote = "<value>"]` selectors are the canonical "data-field equality" extension point this leaf uses (a step up from the boolean `[?<flag>]` selectors used by the axiom-mark and annotation overlays, parallel to the per-status `[rollupStatus = '<status>']` and per-diagnostic `[diagnosticSeverity = '<sev>']` selectors used by the prior two layers).
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the `vote` event lives in the shared event-envelope schema at [`packages/shared-types/src/events.ts:361-368`](../../../packages/shared-types/src/events.ts#L361). The shell client validates incoming envelopes at parse time so this leaf's projection trusts the discriminated-union narrowing.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behavioural assertion below is a committed Vitest case or Playwright scenario.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the participant surface's localization seam. This leaf does NOT add new user-facing strings — the at-a-glance signal is visual (label-outline color); the per-vote prose ("you voted agree on the substance facet") belongs in the entity detail panel where a React surface can host the `methodology.voteIndicatorChoice.<arm>` keys (already populated for en-US / pt-BR / es-419 from the moderator's `mod_vote_indicators_on_graph`).
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the surface owns its mounted region only; `useWsStore` comes from the participant workspace's singleton. No new shell exports in this leaf — the projection lives in the participant workspace per Decision §2 (same trigger-on-the-third-caller policy the predecessor leaves adopted).
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — a vote is a per-(participant, proposal) decoration on the facet layer; the proposal targets a `(entityKind, entityId, facet)` triple. The per-entity own-vote rollup this leaf threads through `projectGraph` composes orthogonally with the per-facet rollup-status the predecessor leaf paints. Decision §1 documents the rollup rule (per-facet → per-entity collapse).

No new ADR. Every decision below applies an existing ADR or mirrors a settled moderator-side decision; the architectural seams (Cytoscape library pick, micro-frontend shell, vote vocabulary, `auth.user.userId` as the current-participant identity, two-callers-then-extract policy) are settled.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_diagnostic_highlights.md`](part_diagnostic_highlights.md) — the most recent overlay template + closest predecessor for symmetric node+edge stamping with a closed-enum sentinel (rather than boolean). This leaf reuses the same seven seams (port/derive the helper, widen `projectGraph` signature, derive the index in `<GraphView>` via `useMemo`, layer Cytoscape stylesheet selectors, extend BOTH mirror row kinds with `data-*` attrs, add a fresh Playwright `test()` block) — the divergences are (a) the projection takes a participant-id parameter (Decision §4), (b) the value is a three-state sentinel (`agree` / `dispute` / `none`) not a two-state severity (Decision §1), (c) the Cytoscape stylesheet primitive is `text-outline-*` rather than `border-*` to avoid collision with the four prior overlays (Decision §3).
- [`tasks/refinements/participant-ui/part_annotation_render.md`](part_annotation_render.md) — the symmetric node+edge stamping template. Decision §1 below reuses the same posture for symmetric ownVote on both row kinds.
- [`tasks/refinements/participant-ui/part_axiom_mark_decoration.md`](part_axiom_mark_decoration.md) — the original layered-stylesheet + DOM mirror template. Decisions §3 + §5 + §7 below reuse the same sentinel-string posture.
- [`tasks/refinements/participant-ui/part_per_facet_state_styling.md`](part_per_facet_state_styling.md) — the original stylesheet + DOM mirror infrastructure + the canonical `event.kind === 'vote'` walk at [`apps/participant/src/graph/facetStatus.ts:269-283`](../../../apps/participant/src/graph/facetStatus.ts#L269) this leaf's projection mirrors in shape (proposal → target mapping; per-participant accumulator). Decision §2 below explains the "port the moderator's projection rather than extend `computeFacetStatuses`" choice.
- [`tasks/refinements/participant-ui/part_graph_render.md`](part_graph_render.md) — `<GraphView>` mount + `projectGraph` seam. Decision §4 of that leaf established "projection lives in the participant workspace; extraction waits for the third caller (audience surface)"; this leaf adopts the same posture (Decision §2).
- [`tasks/refinements/participant-ui/part_state_management.md`](part_state_management.md) — the per-session WS slice shape + the existing pending-vote `useVoteStore` slice (a SEPARATE slice from the WS-fed events log; this leaf does NOT read `useVoteStore` — Decision §1's "server-acknowledged latest vote only" rule explicitly defers pending-vote rendering).
- [`tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md`](part_e2e_user_pool_expansion.md) — the 6→12 user-pool expansion. Names `kate` + `leo` as the explicit next-block pair for this leaf (the diagnostic-highlights refinement at line 11 carries the same earmark forward — "`kate` + `leo` for the subsequent `part_own_vote_indicators` leaf"). Decision §6 adopts the earmark.

### Sibling refinements on the moderator (the vocabulary this leaf adapts)

- [`tasks/refinements/moderator-ui/mod_vote_indicators_on_graph.md`](../moderator-ui/mod_vote_indicators_on_graph.md) — the canonical "client derives per-(entity, facet) votes from the event log via `projectVotesByFacet`; renders per-participant dots inside each facet pill" pattern. This leaf adopts the projection's single-pass walk + the latest-vote-per-(proposal, participant) rule + the insertion-order preservation BUT narrows the output shape from `Map<entityId, Map<FacetName, Vote[]>>` (per-(entity, facet) per-participant list) to `OwnVoteIndex = { nodes: Map<entityId, OwnVote>; edges: Map<entityId, OwnVote> }` (per-entity single-participant rollup) — Decisions §1 + §2 walk the narrowing rationale. The moderator's per-participant `axiomMarkColorFor` ring + per-choice fill is NOT ported (this leaf does not render OTHER participants; that's the sibling); the moderator's `VoteIndicator` component is NOT ported (Cytoscape ≠ ReactFlow; the participant's at-a-glance signal is a stylesheet-driven label-outline color, not an HTML/CSS dot — Decision §3 walks the surface-specific equivalent).
- [`tasks/refinements/moderator-ui/mod_vote_indicators_in_sidebar.md`](../moderator-ui/mod_vote_indicators_in_sidebar.md) — the second consumer of `projectVotesByFacet` + the ratification of the "include edge-substance votes in the projection" extension (its Decision §4 + Status note "the outer-map key was renamed from `nodeId` to `entityId`"). This leaf's projection adopts the same entity-id keyspace from the start so the future others-side projection sibling can read from the same UUID-disjoint outer-map.
- [`tasks/refinements/backend/ws_vote_message.md`](../backend/ws_vote_message.md) — the client-to-server `vote` message handler whose `event-applied` broadcast is what lands `vote` events in `useWsStore.sessionState[id].events`. Confirms the wire shape this leaf reads off `event.payload`.
- [`tasks/refinements/backend/ws_proposal_status_broadcast.md`](../backend/ws_proposal_status_broadcast.md) — the per-facet status broadcast (does NOT carry per-participant vote detail; this leaf derives per-participant votes client-side from the events log, same approach as the moderator).
- [`tasks/refinements/data-and-methodology/agreement_state_machine.md`](../data-and-methodology/agreement_state_machine.md) — the per-participant per-facet vote model the projection mirrors.

### Live code the leaf plugs into

- [`apps/participant/src/graph/facetStatus.ts:200-336`](../../../apps/participant/src/graph/facetStatus.ts#L200) — `computeFacetStatuses(events): FacetStatusIndex`. The canonical single-pass walk over the participant's event log that already maintains:
  - A proposal-id → `{ entityKind, entityId, facet }` map ([line 208-211](../../../apps/participant/src/graph/facetStatus.ts#L208)) — the SAME shape this leaf's `projectOwnVotes` needs. This leaf's projection re-walks the events to keep the two projections independent (per Decision §2 — bundling would couple two test files that have different invalidation cadence), but the proposal-walk shape mirrors `facetStatus.ts`'s line-for-line for drift parity. A future refactor can hoist the proposal-target map into a shared helper when the third caller (`part_other_vote_indicators`) lands.
  - A per-`(participant, proposal-target)` vote accumulator (`state.perParticipant.set(event.payload.participant, event.payload.vote)` at [line 282](../../../apps/participant/src/graph/facetStatus.ts#L282)) — the SAME accumulator shape this leaf narrows to "the current participant only".
- [`apps/participant/src/graph/projectGraph.ts:283-380`](../../../apps/participant/src/graph/projectGraph.ts#L283) — `projectGraph`. This leaf widens the signature to `projectGraph(events, facetStatusIndex, axiomMarkIndex, nodeAnnotationIndex, edgeAnnotationIndex, diagnosticHighlightIndex, ownVoteIndex)`. The `node-created` branch (line 306) consults `ownVoteIndex.nodes.get(event.payload.node_id) ?? 'none'` and stamps `ownVote: <value>`. The `edge-created` branch (line 327) does the same with `ownVoteIndex.edges` + `event.payload.edge_id`. The classify-commit branch's `...existing.data` spread (line 371) carries the prior value unchanged.
- [`apps/participant/src/graph/projectGraph.ts:100-153`](../../../apps/participant/src/graph/projectGraph.ts#L100) — `ParticipantNodeData`. This leaf adds `readonly ownVote: OwnVote` to the interface AFTER `diagnosticHighlight`.
- [`apps/participant/src/graph/projectGraph.ts:165-213`](../../../apps/participant/src/graph/projectGraph.ts#L165) — `ParticipantEdgeData`. This leaf adds the same field after `diagnosticHighlight`. Symmetric with `ParticipantNodeData` because `set-edge-substance` proposals carry votes too (per the mod-sidebar Decision §4 ratification — edge proposals bucket under the same entityId outer-map).
- [`apps/participant/src/graph/GraphView.tsx:103-114`](../../../apps/participant/src/graph/GraphView.tsx#L103) — the import block + `EMPTY_*` module-scope frozen references. This leaf adds (1) an `import { projectOwnVotes, EMPTY_OWN_VOTES, type OwnVoteIndex } from './ownVotes'`; (2) the `OwnVote` type import alongside `OwnVoteIndex`.
- [`apps/participant/src/graph/GraphView.tsx:438-455`](../../../apps/participant/src/graph/GraphView.tsx#L438) — the `GraphViewProps` interface. This leaf adds `readonly currentParticipantId: string;` after `sessionId`. Required (not optional) — Decision §4 walks the rationale.
- [`apps/participant/src/graph/GraphView.tsx:402-435`](../../../apps/participant/src/graph/GraphView.tsx#L402) — the `STYLESHEET` constant's diagnostic block. This leaf appends FOUR new selectors AFTER the diagnostic block: `node[ownVote = "agree"]`, `node[ownVote = "dispute"]`, `edge[ownVote = "agree"]`, `edge[ownVote = "dispute"]`. Decision §3 walks the visual treatment.
- [`apps/participant/src/graph/GraphView.tsx:542-561`](../../../apps/participant/src/graph/GraphView.tsx#L542) — the component body. This leaf inserts (a) ONE new `useMemo` placed after the existing `diagnosticHighlightIndex` memo deriving `ownVoteIndex = projectOwnVotes(events, currentParticipantId)`; (b) the `projected` memo grows the seventh argument; (c) the localized `elements` memo carries `ownVote` through via the existing `...node.data` / `...edge.data` spreads — NO additional flat-sentinel derivation is needed because `ownVote` is already a flat string sentinel at the `data` level (unlike `diagnosticHighlight`, which required a sibling `diagnosticSeverity` slot per the prior leaf's Decision §4).
- [`apps/participant/src/graph/GraphView.tsx:516-540`](../../../apps/participant/src/graph/GraphView.tsx#L516) — the small attr-helper functions. This leaf adds ONE helper `ownVoteAttr(value: OwnVote): 'agree' | 'dispute' | 'none'` (a passthrough — `OwnVote` is already the sentinel set; the helper exists for symmetry with `rollupAttr` / `axiomAttr` / `hasAnnotationAttr` / `diagnosticSeverityAttr` so the mirror render reads uniformly).
- The mirror `<li data-testid="participant-node-status">` AND `<li data-testid="participant-edge-status">` rows both grow one new attribute: `data-own-vote={ownVoteAttr(node.data.ownVote)}` / `data-own-vote={ownVoteAttr(edge.data.ownVote)}`.
- [`apps/participant/src/routes/OperateRoute.tsx:100-104`](../../../apps/participant/src/routes/OperateRoute.tsx#L100) — `<OperateRouteBody>`. This leaf threads the new prop: `<GraphView sessionId={id} currentParticipantId={auth.user.userId} />`. The auth-guard branch at line 86 already narrows `auth.status === 'authenticated' && auth.user !== undefined` before mounting the canvas — so the prop is always a non-empty UUID by the time `<GraphView>` renders. Decision §4 walks the routing seam.
- [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts) — the canonical port source for the `projectVotesByFacet` projection's algorithm + the `Vote` shape. The participant's `ownVotes.ts` mirrors the single-pass walk + the latest-vote-per-(proposal, participant) rule + the proposal-target dance, but narrows the output to per-entity own-vote rollup (Decisions §1 + §2). No structural change in the algorithm itself.
- [`packages/shared-types/src/events.ts:361-368`](../../../packages/shared-types/src/events.ts#L361) — `votePayloadSchema` + `VotePayload`. No change; the projection reads `event.payload.participant` (UUID), `event.payload.vote` (`'agree' | 'dispute' | 'withdraw'`), `event.payload.proposal_id` (UUID).
- [`packages/shell/src/auth/types.ts:20-26`](../../../packages/shell/src/auth/types.ts#L20) — `AuthUser = { readonly userId: string; readonly screenName: string }`. The `userId` field is the canonical UUID stamped into every `vote.payload.participant` by the server-side handler.
- [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) — the existing Playwright describe with FIVE `test()` blocks (alice+ben, maria+dave, frank+erin, grace+henry, ivan+julia). This leaf adds a SIXTH `test()` block using `kate` + `leo`; the describe stays `fullyParallel`.

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/fixtures/auth.ts:118-131`](../../../tests/e2e/fixtures/auth.ts#L118) — `DEV_USER_POOL` (the 12-user roster). `kate` is at index 10 and `leo` is at index 11 (zero-based). The sixth Playwright block uses these as `{ creator, debater }` per the `(creator, debater)` convention each prior block follows.
- The new block seeds vote events via `__aConversaWsStore.getState().applyEvent({ kind: 'vote', payload: { proposal_id, participant, vote, voted_at } })` — the same `applyEvent` pattern the prior five blocks use for `node-created` / `edge-created` / `proposal` / `commit` / `annotation-created`. The widened `<GraphView>` re-renders through the existing `useWsStore` selector flow because the vote event mutates `events` and `events` is the existing memo dependency.
- [`playwright.config.ts`](../../../playwright.config.ts) — `chromium-participant-skeleton` already matches `participant-graph-render.spec.ts`. No config change needed; the new block runs in parallel under `fullyParallel`.

### What the surface MUST NOT do

- **No `fetch('/api/...')` from `<GraphView>` or the own-vote derivation.** The per-session events log is the single data source.
- **No mutation of `useWsStore` from `<GraphView>`.** Read-only via the existing selector + the new `useMemo` chain.
- **No read of `useVoteStore` (the pending-vote slice).** This leaf surfaces server-acknowledged latest votes only; the optimistic local-tap layer is out of scope (a future polish leaf can layer it on as a `data-own-vote-pending="..."` attribute distinct from `data-own-vote`).
- **No new top-level dependency.** Cytoscape's `text-outline-*` is built-in; no new npm package.
- **No write paths on the WS connection.** Vote casting is `part_vote_single_tap`'s job.
- **No new shell exports.** The own-votes projection lives in the participant workspace per Decision §2.
- **No new i18n keys.** The visual at-a-glance signal is a label-outline color + the sentinel-string mirror attribute; the per-vote prose is the entity-detail-panel's future job.
- **No port of the moderator's `<VoteIndicator>` component.** Cytoscape is not React; the stylesheet selectors are the participant's equivalent surface for the OWN vote. (The future `part_other_vote_indicators` sibling MAY port `<VoteIndicator>` for per-other-participant dots; that's the sibling's call.)
- **No pre-building of the per-other-participant aggregation seam.** The future `part_other_vote_indicators` leaf chooses its own projection shape; this leaf's `projectOwnVotes` is deliberately scoped to the current participant only. The boundary is the per-leaf seam.
- **No change to `projectGraph`'s output ordering.** Nodes still emit in `node-created` arrival order; edges in `edge-created` arrival order. The new `ownVote` field is additive on each element `data` object.
- **No removal of the prior fields.** `isAxiom`, `rollupStatus`, `facetStatuses`, `hasAnnotation`, `annotationCount`, `diagnosticHighlight`, `kind`, `wording`, `id` all survive — every prior overlay still composes.
- **No render of `withdraw`-arm votes as a distinct visual state.** Per Decision §1, `withdraw` collapses to `'none'` because the at-a-glance "did I cast a pre-commit agree/dispute here?" surface treats withdrawal as an explicit retraction back to the un-voted baseline. The explicit "I withdrew" signal belongs in the future `part_withdraw_indicator` polish leaf alongside the withdrawal action.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/graph/ownVotes.ts` — NEW. Exports: `OwnVote` (`'agree' | 'dispute' | 'none'` — the closed sentinel set); `OwnVoteIndex` (`{ readonly nodes: ReadonlyMap<string, OwnVote>; readonly edges: ReadonlyMap<string, OwnVote> }`); `EMPTY_OWN_VOTES: OwnVoteIndex` (module-scope frozen `{ nodes: Map(), edges: Map() }` for memoization stability); `projectOwnVotes(events: readonly Event[], currentParticipantId: string): OwnVoteIndex` (the pure projection); `ownVoteForNode(index: OwnVoteIndex, nodeId: string): OwnVote` (presence-helper passthrough returning `index.nodes.get(nodeId) ?? 'none'`); `ownVoteForEdge(index: OwnVoteIndex, edgeId: string): OwnVote`. Header comment cites the moderator selector source (`apps/moderator/src/graph/selectors.ts` `projectVotesByFacet`) AND `facetStatus.ts`'s proposal-walk for the drift-risk parity warning.
- `apps/participant/src/graph/ownVotes.test.ts` — NEW. Vitest cases (10): (a) empty event log → `EMPTY_OWN_VOTES` (stable reference); (b) one `proposal` (`classify-node`) + one matching `vote` (`agree`) by the current participant → `index.nodes.get(nodeId) === 'agree'`; (c) same as (b) but vote by NOT the current participant → `index.nodes.get(nodeId)` returns `undefined` (helper returns `'none'`); (d) one `proposal` (`set-edge-substance`) + one matching `vote` (`dispute`) by the current participant → `index.edges.get(edgeId) === 'dispute'`; (e) latest-vote-wins on a same-participant retake (agree then dispute → `'dispute'`); (f) vote with `'withdraw'` arm by the current participant → `index.nodes.get(nodeId)` returns `undefined` (collapses to `'none'`; per Decision §1); (g) two facets on the same entity — one `agree` + one `dispute` by the current participant → rolled-up entity value is `'dispute'` (dispute wins per Decision §1's tie-break); (h) vote referencing an unknown proposal id → silently dropped (no entry); (i) `ownVoteForNode` returns `'none'` for an unknown nodeId; `ownVoteForEdge` returns `'none'` for an unknown edgeId; (j) projection is pure (calling twice with the same args returns deep-equal results; the same input array yields a referentially-equal `EMPTY_OWN_VOTES` when no votes).
- `apps/participant/src/graph/projectGraph.ts` — modified. (1) `ParticipantNodeData` grows `readonly ownVote: OwnVote` after `diagnosticHighlight`. (2) `ParticipantEdgeData` grows the same field after `diagnosticHighlight`. (3) `projectGraph`'s signature widens to take a SEVENTH `ownVoteIndex: OwnVoteIndex` argument. (4) `node-created` branch stamps `ownVote: ownVoteIndex.nodes.get(event.payload.node_id) ?? 'none'`. (5) `edge-created` branch stamps `ownVote: ownVoteIndex.edges.get(event.payload.edge_id) ?? 'none'`. (6) The classify-commit branch's `...existing.data` spread carries the prior value unchanged. (7) Module-header refinement-block grows one more entry citing this leaf.
- `apps/participant/src/graph/projectGraph.test.ts` — modified. Existing cases adapted to the new signature (each test factory passes `EMPTY_OWN_VOTES` for the no-own-vote baseline). 5 new cases added: (a) projection stamps `ownVote: 'none'` on every node by default; (b) projection stamps the right `ownVote` on a node when the index targets it; (c) projection stamps the right `ownVote` on an edge when the index targets it; (d) `ownVote` survives a classify-node commit (the spread in the commit branch preserves it); (e) the `'dispute'` value composes orthogonally with `rollupStatus: 'agreed'` (the participant individually disputed but the aggregate is `agreed` — sanity check that the per-(participant, target) field doesn't interfere with the per-facet rollup).
- `apps/participant/src/graph/GraphView.tsx` — modified. (1) Imports widened with `projectOwnVotes`, `EMPTY_OWN_VOTES`, `type OwnVote`, `type OwnVoteIndex` from `./ownVotes`. (2) `GraphViewProps` grows a required `currentParticipantId: string` field. (3) Stylesheet appends FOUR new selectors AFTER the diagnostic block. Per Decision §3: `node[ownVote = "agree"]` paints `text-outline-color: '#10b981'` (emerald-500) + `text-outline-width: 3` + `text-outline-opacity: 1`; `node[ownVote = "dispute"]` paints `text-outline-color: '#e11d48'` (rose-600) + `text-outline-width: 3` + `text-outline-opacity: 1`; `edge[ownVote = "agree"]` paints `text-outline-color: '#10b981'` + `text-outline-width: 2` + `text-outline-opacity: 1`; `edge[ownVote = "dispute"]` paints `text-outline-color: '#e11d48'` + `text-outline-width: 2` + `text-outline-opacity: 1`. (4) ONE new `useMemo` deriving `ownVoteIndex = projectOwnVotes(events, currentParticipantId)`. (5) `projected` memo's `projectGraph` call takes the seventh argument; its dependency list grows the new index. (6) The localized `elements` memo carries `ownVote` through via the existing `...node.data` / `...edge.data` spreads (no flat-sentinel derivation needed; `ownVote` is already flat). (7) The mirror `<li data-testid="participant-node-status">` AND the mirror `<li data-testid="participant-edge-status">` grow `data-own-vote={ownVoteAttr(node.data.ownVote)}` / `data-own-vote={ownVoteAttr(edge.data.ownVote)}`. (8) New `ownVoteAttr(value: OwnVote): 'agree' | 'dispute' | 'none'` passthrough helper for symmetry with the prior attr helpers.
- `apps/participant/src/graph/GraphView.test.tsx` — modified. Existing cases stay (the additive field doesn't break them once test factories pass a `currentParticipantId` string and `EMPTY_OWN_VOTES` propagation works). 6 new cases added: (a) per-node mirror `<li>` carries `data-own-vote="none"` by default (no votes seeded); (b) when an `agree` vote by the current participant fires on a node-targeting proposal, the node mirror reports `data-own-vote="agree"`; (c) when a `dispute` vote by the current participant fires on the same node, the mirror reports `data-own-vote="dispute"` (latest-wins); (d) per-edge mirror `<li>` carries the same semantics for an edge-targeted vote (a `set-edge-substance` proposal + a current-participant `dispute` vote → the edge mirror reports `data-own-vote="dispute"`); (e) Cytoscape's internal element set carries the same `data.ownVote` values the mirror surfaces (sanity check via `cy.elements().jsons()`); (f) the stylesheet contains the four new selectors with the expected `text-outline-color` / `text-outline-width` (assert against the exported `STYLESHEET` constant).
- `apps/participant/src/routes/OperateRoute.tsx` — modified. The `<GraphView sessionId={id} />` call grows the `currentParticipantId={auth.user.userId}` prop. The mid-mount auth guard already narrows `auth.user !== undefined` so the prop is always a non-empty UUID. No new imports.
- `apps/participant/src/routes/OperateRoute.test.tsx` — modified. ONE new test case added: when `auth.status === 'authenticated'` with a known `userId`, `<GraphView>` receives the matching `currentParticipantId` prop (via a `vi.mock` of `'../graph/GraphView'` exposing the prop). The existing auth-guard case stays unchanged (the guard still short-circuits before mounting).
- `tests/e2e/participant-graph-render.spec.ts` — modified. Adds a sixth `test()` block: `kate creates a session, leo claims debater-A, seeded vote events by leo on facet-targeting proposals surface data-own-vote on the affected entities and votes by kate (other-participant) do NOT change leo's data-own-vote`. Seeds: two `node-created` events (NODE_A, NODE_B); one `edge-created` event (EDGE_AB); a `proposal` of `classify-node` for NODE_A (proposal P1); a `proposal` of `set-edge-substance` for EDGE_AB (proposal P2); a `proposal` of `classify-node` for NODE_B (proposal P3); a `vote` of `agree` on P1 by leo; a `vote` of `dispute` on P2 by leo; a `vote` of `agree` on P3 by KATE (not leo). Asserts: NODE_A mirror `data-own-vote="agree"` (leo's own agree on P1's node-target); EDGE_AB mirror `data-own-vote="dispute"` (leo's own dispute on P2's edge-target); NODE_B mirror `data-own-vote="none"` (the only vote on P3 was kate's, not leo's — confirms the per-participant filter excludes others). Per the predecessor leaves' pattern: assertions target the DOM mirror, not canvas pixels.
- `playwright.config.ts` — unchanged. `chromium-participant-skeleton` already matches `participant-graph-render.spec.ts`.
- `apps/participant/package.json` — unchanged. No new dependency.

### Files this task does NOT touch

- `apps/participant/src/stores/voteStore.ts` — unchanged. The pending-vote slice is for the FUTURE `part_vote_single_tap` write-path; this leaf surfaces the server-acknowledged vote only.
- `apps/participant/src/ws/wsStore.ts` — unchanged. The `events` slice already carries `vote` envelopes (the participant's facet-status walk already consumes them); no store widening needed.
- `apps/participant/src/graph/facetStatus.ts`, `apps/participant/src/graph/axiomMarks.ts`, `apps/participant/src/graph/annotations.ts`, `apps/participant/src/graph/diagnosticHighlights.ts` — unchanged. The five prior projections stay independent; the own-vote derivation is its own module.
- `apps/moderator/` — no cross-surface change. The moderator's existing vote-rendering seams stay where they are; the participant projection is a NEW module narrowed to the participant's surface (NOT a verbatim port — Decision §2 explains).
- `packages/shell/`, `packages/shared-types/`, `packages/i18n-catalogs/` — unchanged. No new substrate, no new types, no new strings.
- `apps/server/`, `apps/root/`, `apps/audience/` — unchanged.
- `docs/adr/` — no new ADR.
- `.tji` files — `complete 100` on `part_own_vote_indicators` lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual.

### Component shape (additions to `GraphView.tsx`)

Sketched (deltas only):

```ts
// Module scope — new
import {
  EMPTY_OWN_VOTES,
  projectOwnVotes,
  type OwnVote,
  type OwnVoteIndex,
} from './ownVotes';

// STYLESHEET extension — FOUR new selectors appended AFTER the existing
// diagnostic block. Per Decision §3, `text-outline-*` is the only
// stylesheet primitive not yet claimed by the four prior overlays:
//   - rollup owns `border-color`/`background-color`/`opacity`/`outline-*`
//   - axiom owns `border-style: 'double'` + `border-width: 3`
//   - annotation node owns `overlay-color`/`overlay-opacity`/`overlay-padding`
//   - annotation edge + diagnostic edge own `underlay-color`/`underlay-opacity`/`underlay-padding`
//   - diagnostic node owns `border-color`/`border-width`/`border-opacity` (override)
// `text-outline-*` paints a stroke around the label text — high-contrast
// at any zoom, semantically read as "this label is highlighted FOR ME".
// Emerald for agree (matches the moderator's per-arm fill convention),
// rose for dispute (same). On nodes, the wording label IS the body text
// (per the per-status branch's `label: 'data(wording)'`); on edges the
// roleLabel IS the midpoint text. Both surfaces have a label to outline.
const STYLESHEET: StylesheetJson = [
  // ... existing baseline node + edge selectors (unchanged) ...
  // ... existing 12 per-status selectors (unchanged) ...
  // ... existing `node[?isAxiom]` axiom overlay (unchanged) ...
  // ... existing annotation node + edge overlays (unchanged) ...
  // ... existing four diagnostic selectors (unchanged) ...
  // Own-vote (node — agree)
  { selector: 'node[ownVote = "agree"]', style: {
    'text-outline-color': '#10b981',  // emerald-500
    'text-outline-width': 3,
    'text-outline-opacity': 1,
  } },
  // Own-vote (node — dispute)
  { selector: 'node[ownVote = "dispute"]', style: {
    'text-outline-color': '#e11d48',  // rose-600
    'text-outline-width': 3,
    'text-outline-opacity': 1,
  } },
  // Own-vote (edge — agree)
  { selector: 'edge[ownVote = "agree"]', style: {
    'text-outline-color': '#10b981',
    'text-outline-width': 2,
    'text-outline-opacity': 1,
  } },
  // Own-vote (edge — dispute)
  { selector: 'edge[ownVote = "dispute"]', style: {
    'text-outline-color': '#e11d48',
    'text-outline-width': 2,
    'text-outline-opacity': 1,
  } },
];

// GraphViewProps — new required field
export interface GraphViewProps {
  readonly sessionId: string;
  readonly currentParticipantId: string;  // NEW — Decision §4
  readonly cyRef?: (cy: Core | null) => void;
}

// Inside the component — ONE new memo.
const ownVoteIndex = useMemo(
  () => projectOwnVotes(events, currentParticipantId),
  [events, currentParticipantId],
);

// Projected memo — dependency widens.
const projected = useMemo(
  () => projectGraph(
    events,
    facetStatusIndex,
    axiomMarkIndex,
    nodeAnnotationIndex,
    edgeAnnotationIndex,
    diagnosticHighlightIndex,
    ownVoteIndex,
  ),
  [events, facetStatusIndex, axiomMarkIndex, nodeAnnotationIndex, edgeAnnotationIndex, diagnosticHighlightIndex, ownVoteIndex],
);

// Mirror — both <li> rows grow ONE attribute
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
  data-own-vote={ownVoteAttr(node.data.ownVote)}
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
  data-own-vote={ownVoteAttr(edge.data.ownVote)}
/>
```

## Acceptance criteria

The check that says "done":

- `apps/participant/src/graph/ownVotes.ts` exists, exports `OwnVote` / `OwnVoteIndex` / `EMPTY_OWN_VOTES` / `projectOwnVotes` / `ownVoteForNode` / `ownVoteForEdge`. The header comment cites the moderator selector source AND the `facetStatus.ts` proposal-walk for drift-risk parity.
- `apps/participant/src/graph/ownVotes.test.ts` covers the 10 Vitest cases listed under Constraints.
- `apps/participant/src/graph/projectGraph.ts`'s `projectGraph` signature widens to a seventh `ownVoteIndex: OwnVoteIndex` argument; every emitted node AND edge data object carries `ownVote: OwnVote`.
- `apps/participant/src/graph/projectGraph.test.ts` covers the 5 new Vitest cases plus the adapted existing cases.
- `apps/participant/src/graph/GraphView.tsx`'s stylesheet grows the four `node[ownVote = "..."]` / `edge[ownVote = "..."]` selectors per Decision §3; one new `useMemo` derives `ownVoteIndex`; the per-node AND per-edge mirror `<li>` rows grow `data-own-vote`. `GraphViewProps` grows the required `currentParticipantId: string` field.
- `apps/participant/src/graph/GraphView.test.tsx` covers the 6 new Vitest cases plus the adapted existing cases. Per ADR 0022, every behavioural assertion is a committed test case.
- `apps/participant/src/routes/OperateRoute.tsx` threads `currentParticipantId={auth.user.userId}` into `<GraphView>`.
- `apps/participant/src/routes/OperateRoute.test.tsx` covers the new prop-threading case.
- `tests/e2e/participant-graph-render.spec.ts` adds the sixth `test()` block using `kate` + `leo` per Decision §6; the describe stays `fullyParallel`. **Per ORCHESTRATOR.md UI-stream e2e policy**: the route IS reachable (settled by `part_graph_render`); the per-target mirror IS in place (settled by `part_per_facet_state_styling` + the four overlay leaves); the wire envelope IS reaching the participant (verified — vote events already feed the participant's `facetStatus.ts` walk); the e2e is in scope. The spec asserts via the DOM mirror, not canvas pixels.
- **Failing-first verification per ADR 0022**: forcing `ownVote: 'none'` in both `projectGraph` branches must flip 4 of the 5 new `projectGraph` cases to red (the "stamps 'none' by default" case stays green); forcing `projectOwnVotes` to always return `EMPTY_OWN_VOTES` must flip 7 of the 10 new `ownVotes` cases to red (the three null-input / unknown-id cases stay green). Document the verification in the Status block.
- `pnpm run check` clean.
- `pnpm run test:smoke` green; Vitest count rises by the new cases (10 ownVotes + 5 projectGraph + 6 GraphView + 1 OperateRoute = +22).
- `pnpm -F @a-conversa/participant build` succeeds (bundle grows by the own-vote derivation + the widened component prop; expected, no new dependency).
- `pnpm run test:e2e:smoke` (with the compose stack up via `make up`) executes the extended spec and it passes; wall-clock for `chromium-participant-skeleton` is unchanged (the new block runs in parallel).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/40-participant-ui.tji` gets `complete 100` on `part_own_vote_indicators` in the same commit (the Closer's ritual).

## Decisions

### §1 — Vote vocabulary at the indicator layer: closed sentinel `'agree' | 'dispute' | 'none'`; `'withdraw'` collapses to `'none'`; symmetric across node AND edge targets; per-entity rollup with dispute-wins tie-break

The wire `vote` enum has three arms (`'agree' | 'dispute' | 'withdraw'`) per [`votePayloadSchema`](../../../packages/shared-types/src/events.ts#L364). The participant's per-(entity, facet) per-participant vote model carries those three arms verbatim through `facetStatus.ts`. The participant's at-a-glance "did I vote here?" surface needs a narrower sentinel.

Three options for the indicator sentinel:

- **(a) Three-state `'agree' | 'dispute' | 'withdraw'` + a fourth `'none'` for the un-voted baseline (four total).** Rejected: the participant's pre-commit vote-cast surface ([`apps/participant/src/stores/voteStore.ts:31`](../../../apps/participant/src/stores/voteStore.ts#L31)) explicitly narrows to `'agree' | 'dispute'` (the withdraw flow is post-commit P3 with a different store path); rendering `'withdraw'` at the at-a-glance pre-commit layer would over-state the post-commit signal's prominence on the canvas. Withdrawal IS methodologically meaningful (the moderator sidebar surfaces it as a slate-gray dot per `mod_vote_indicators_on_graph`) — but the participant's OWN withdrawal surface belongs alongside the withdrawal action (a future `part_withdraw_indicator` polish leaf), not bundled into the pre-commit own-vote layer.
- **(b) Three-state `'agree' | 'dispute' | 'none'` with `'withdraw'` collapsed to `'none'`.** Chosen. The participant's pre-commit "did I cast a pre-commit agree/dispute here?" question is the load-bearing one for the canvas-at-a-glance scan; a withdrawal is the explicit retraction back to the un-voted baseline at that layer (the post-commit "I withdrew" detail is the entity-detail-panel's job). The collapsed mapping is simpler to render (two selectors per target kind, not three; emerald + rose, no slate-gray).
- **(c) Boolean `castVote: boolean` (no per-arm distinction).** Rejected: loses the agree/dispute distinction — "did I vote agree here, vs. did I dispute here?" is the most load-bearing per-target question for the methodology. The aggregate "I voted somehow" is less useful than the per-arm signal.

Decision §1 (b): ship (b). `OwnVote = 'agree' | 'dispute' | 'none'`. The `'none'` sentinel covers all three "no surfaceable vote" cases:

1. No `vote` event by the current participant on any tracked proposal targeting this entity.
2. A `vote` event by the current participant exists but its latest arm is `'withdraw'`.
3. A `vote` event by the current participant exists but the targeting proposal is unknown (e.g. the proposal envelope hasn't yet arrived because of event-ordering — defensive `'none'` default).

**Symmetry across node AND edge targets**: same posture as `part_annotation_render` Decision §1 + `part_diagnostic_highlights` Decision §1. The wire `proposal` family has both node-targeting sub-kinds (`classify-node`, `set-node-substance`, `edit-wording`, `amend-node`, `axiom-mark`) AND edge-targeting (`set-edge-substance`); the moderator's `projectVotesByFacet` already buckets both per its `mod_vote_indicators_in_sidebar` Decision §4 extension. The participant's `OwnVoteIndex` mirrors that bucketing with `{ nodes: Map, edges: Map }`. The participant's `facetStatus.ts` walk already handles edge votes too — they contribute to the per-edge facet rollup via the same proposal-target dance.

**Per-entity rollup rule** (collapsing per-`(entity, facet)` votes to a single per-entity `OwnVote`): the moderator's per-facet pill carries the per-`(entity, facet)` granularity directly because each facet pill is a distinct visual element. The participant's at-a-glance canvas paints one signal per ENTITY (per node, per edge), not per facet — the entity body has one label, one set of border / overlay / outline layers. The per-facet detail is the entity-detail-panel's future job. The rollup rule for collapsing the per-facet record to a single per-entity value:

- If ANY tracked facet of the entity carries a current-participant `'dispute'` → entity-level `'dispute'`.
- Else if ANY tracked facet carries a current-participant `'agree'` → entity-level `'agree'`.
- Else → entity-level `'none'`.

Rationale: dispute-wins reflects the methodology's "ratchet to the conservative state" posture — if the current participant is actively contesting any one facet of the entity, the at-a-glance signal is "I disagree with this entity right now" rather than "I half-agree" (the per-facet detail is in the entity detail panel for the participant who taps for the breakdown). Same posture as the per-facet `cardRollupStatus` rule that maps multiple facet statuses to a single card-frame status per [`facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts).

### §2 — Project per-entity own-votes in the participant workspace; do NOT port the moderator's full `projectVotesByFacet`; do NOT extract into the shell yet

The moderator's `projectVotesByFacet(events): Map<entityId, Map<FacetName, Vote[]>>` is the canonical client-side vote projection. The participant's at-a-glance layer needs a narrower output (`OwnVoteIndex` per Decision §1). Three options:

- **(a) Port `projectVotesByFacet` verbatim into the participant workspace; narrow at the consumer (`<GraphView>`) via a `useMemo`.** Rejected: the per-facet per-participant detail isn't load-bearing for this leaf — the only consumer is the entity-level rollup. Carrying the full structure through the projector + the memo + the projection inflates memory + recomputation cost for data the surface never reads. (The future sibling `part_other_vote_indicators` WILL need the full structure for the per-participant dot row — that sibling can adopt the moderator's full projection then; this leaf intentionally does not pre-build that seam per the "don't pre-build the sibling's surface" guidance.)
- **(b) Write a narrowed `projectOwnVotes(events, currentParticipantId): OwnVoteIndex` in the participant workspace, single-pass walk that filters to the current participant inline.** Chosen. The single pass is asymptotically the same as the moderator's full projection but with a smaller per-iteration footprint (no per-(facet, participant) Map allocation; just per-entity sentinel write). The output shape is what the projector needs without further narrowing. The proposal-target walk is shape-mirrored from `facetStatus.ts:208-235` (drift-parity note in the header) and from the moderator's `projectVotesByFacet` (algorithm-parity note in the header). Two callers of the proposal-walk live side-by-side in the participant workspace today (`facetStatus.ts` and `ownVotes.ts`); when the third caller materializes (`part_other_vote_indicators`), the shared `mapProposalToTarget` helper extracts at that point per the established "two callers is YAGNI, lift on the third" policy.
- **(c) Compute the own-vote at the canvas layer by re-using `computeFacetStatuses`'s internal `state.perParticipant` accumulator (i.e., expose it as a public field).** Rejected: would couple the per-facet-status projection's internal state to the canvas; the two projections have different invalidation cadences and different test surfaces. Exposing internal state inverts the encapsulation that makes `facetStatus.ts` testable as a pure function.

Decision §2 (b): ship (b). The narrowed projection lives at `apps/participant/src/graph/ownVotes.ts`. Shell extraction waits for the third caller (audience surface) per the same trigger-on-the-third-caller policy `axiomMarks.ts`, `annotations.ts`, and `diagnosticHighlights.ts` already followed.

The participant's `ownVotes.ts` carries a header drift-risk note (same posture as the moderator-port files): a future `proposal-target` schema change touches `facetStatus.ts`'s walk, the moderator's `projectVotesByFacet`'s walk, AND this projection's walk. The three locations are intentionally co-shaped; a future shared helper extraction unifies them.

### §3 — Own-vote ring = Cytoscape `text-outline-*` (label-outline color + width); per-choice color (emerald / rose); composes WITH all five prior overlays

The own-vote signal needs to be a visual layer that (a) reads at-a-glance as "this is MY vote here" (high-personal-relevance), (b) composes cleanly with FIVE existing layers (per-status border-color/background/opacity/outline-*; axiom-mark double-3px border; annotation amber overlay/underlay; diagnostic amber border-override + edge underlay), (c) discriminates agree vs. dispute with semantically-loaded colors, (d) is testable via the DOM mirror without canvas-pixel introspection.

This is the most layer-constrained overlay so far — by the time the diagnostic leaf landed, the participant Cytoscape stylesheet's `border-*`, `background-*`, `opacity`, `outline-*`, `overlay-*` (node), and `underlay-*` (edge) layers were all claimed. Let me enumerate what each prior layer owns on the node body and edge:

| Layer | Node primitives | Edge primitives |
|---|---|---|
| Per-status | `border-color` (per arm), `background-color`, `opacity`, `outline-color`, `outline-width`, `outline-style` | `line-color`, `line-style`, `target-arrow-color`, `opacity` |
| Axiom-mark | `border-style: 'double'`, `border-width: 3` | — (no edge axiom-mark) |
| Annotation | `overlay-color`, `overlay-opacity`, `overlay-padding` | `underlay-color`, `underlay-opacity`, `underlay-padding`, `width` |
| Diagnostic | `border-color` (override), `border-width` (override), `border-opacity` | `underlay-color` (later wins), `underlay-opacity`, `underlay-padding`, `width` |

The only Cytoscape stylesheet primitive families still unclaimed are: `text-*` (label color, font, outline, background, halign, valign); `shape` (node shape — but baseline already uses `round-rectangle`); `padding` (node body padding — used in baseline); `curve-style` (edge — used in baseline).

Three options for the own-vote signal:

- **(A) `text-outline-color` + `text-outline-width` + `text-outline-opacity`** (a stroke painted around the label text itself — emerald for agree, rose for dispute). Chosen. Unclaimed by any prior layer; high-visibility at any zoom (the stroke scales with the label); semantically reads as "the LABEL — the wording of this statement / the role of this edge — has a colored highlight FOR ME" — distinct from the body / border / underlay vocabularies the prior overlays use. Works on both nodes (whose body label is `data(wording)`) and edges (whose midpoint label is `data(roleLabel)`). The four selector entries per `(target-kind × choice)` cell. Color palette: emerald-500 (`#10b981`) for agree (matches the moderator's `bg-emerald-500` fill convention for the same arm); rose-600 (`#e11d48`) for dispute (matches the per-status `disputed` border color and the moderator's `bg-rose-500` fill — same family).
- **(B) `background-color` override (paint the node body in emerald / rose).** Rejected: would clobber the per-status `background-color` (which carries proposed-slate-tint / disputed-rose-tint / etc.). The per-status fill is a methodology signal of the AGGREGATE state; the own-vote is the per-(local-participant, target) signal — clobbering aggregate with per-local-participant inverts the surface's information priority (the canvas is shared; the moderator and other debaters see the per-status fill, not the local participant's own-vote — making the local participant's signal LOUDER than the shared aggregate misleads the local debater into thinking the canvas reads the same way for everyone). Reuses a primitive owned by an existing layer.
- **(C) `shape` swap (round-rectangle → octagon for agree, diamond for dispute).** Rejected: shape carries a high cognitive load and is generally reserved for taxonomic distinctions (node-kind, edge-role); using it for the per-participant own-vote misallocates the channel. Also creates a layout disruption every time a vote arrives (Cytoscape relays shapes on change).

Decision §3 (A): ship (A). `text-outline-color` + `text-outline-width` + `text-outline-opacity` paints a colored stroke around the label text, per-choice. The four selectors:

```ts
{ selector: 'node[ownVote = "agree"]', style: {
  'text-outline-color': '#10b981', 'text-outline-width': 3, 'text-outline-opacity': 1,
} },
{ selector: 'node[ownVote = "dispute"]', style: {
  'text-outline-color': '#e11d48', 'text-outline-width': 3, 'text-outline-opacity': 1,
} },
{ selector: 'edge[ownVote = "agree"]', style: {
  'text-outline-color': '#10b981', 'text-outline-width': 2, 'text-outline-opacity': 1,
} },
{ selector: 'edge[ownVote = "dispute"]', style: {
  'text-outline-color': '#e11d48', 'text-outline-width': 2, 'text-outline-opacity': 1,
} },
```

Stylesheet ordering: append these AFTER the diagnostic block. None of the prior overlays touch `text-outline-*`, so the ordering is purely conventional — placing own-vote last makes it the loudest signal layered on top, which matches its "this is YOUR signal" semantics. The visual composition on a worst-case node (axiom-marked + annotated + per-status disputed + blocking diagnostic + local-participant disputed) reads as: rose-tinted background (per-status) + amber overlay wash (annotation) + amber-700 double-border at width 4 opacity 0.9 (diagnostic + axiom-mark composed) + rose-600 label stroke at width 3 (own-vote). Six signals; the own-vote stroke is the high-contrast finishing touch on the label.

Edge widths are smaller (2 vs 3) than node widths because the edge midpoint label is smaller (10px vs 12px font); the relative scale stays the same.

### §4 — `currentParticipantId` is a REQUIRED prop on `<GraphView>`, threaded from `<OperateRoute>` reading `auth.user.userId`; do NOT call `useAuth()` inside `<GraphView>`

The current participant's UUID is the canonical filter for "own" — every wire `vote.payload.participant` UUID compares equality against `auth.user.userId` because the server-side handler stamps the connection's authenticated user id into the field verbatim. Three options for routing the value into `<GraphView>`:

- **(a) `<GraphView>` calls `useAuth()` directly inside its body to read `auth.user.userId`.** Rejected for two reasons: (1) introduces a hidden dependency between the canvas component and the auth provider, complicating unit tests (every `<GraphView>` test would need an `<AuthProvider>` wrapper or a `useAuth` mock); (2) `useAuth()` returns a discriminated union that needs narrowing — `auth.status === 'authenticated' && auth.user !== undefined` — duplicating the guard `<OperateRouteBody>` already runs. The canvas component would either have to repeat the guard (DRY violation; risk of divergence) or trust an invariant the type system doesn't enforce.
- **(b) `<GraphView>` accepts a required `currentParticipantId: string` prop; `<OperateRouteBody>` threads `auth.user.userId` into it after its own auth-guard branch.** Chosen. The auth-guard at [`OperateRoute.tsx:86`](../../../apps/participant/src/routes/OperateRoute.tsx#L86) already narrows `auth.user !== undefined` before mounting `<GraphView>`; the routing component is the single point that "knows" the auth shape, the canvas component just receives the resolved value. Unit tests for `<GraphView>` pass a literal UUID; no auth mock required.
- **(c) `<GraphView>` accepts an optional `currentParticipantId?: string` prop that defaults to `undefined`; the projection falls back to "no current participant → all votes are others' → `OwnVoteIndex` is always empty".** Rejected: the empty / undefined branch is an at-the-canvas-rendering-time bug detector that should be a type-system constraint instead. Making the prop required forces the routing component to provide a real UUID (or fail to typecheck), pushing the auth-presence invariant up to where it's actually verified.

Decision §4 (b): ship (b). `<GraphView>`'s `GraphViewProps` grows a REQUIRED `currentParticipantId: string` field. `<OperateRouteBody>` reads `auth.user.userId` AFTER its auth-guard and threads the value via `<GraphView sessionId={id} currentParticipantId={auth.user.userId} />`. The canvas component remains auth-unaware; the auth-aware code stays in the route.

### §5 — DOM mirror adds `data-own-vote="agree|dispute|none"` on BOTH `<li>` row kinds; explicit "none" (not omit-when-empty); single tri-state attribute (not two attributes)

The DOM mirror is `aria-hidden="true"` and serves as the canvas-blind testability seam. The own-vote signal extends BOTH the existing per-node AND per-edge `<li>` rows — symmetric per Decision §1.

Attribute encoding: explicit `"agree"` / `"dispute"` / `"none"` (sentinel string, never omit). Same three reasons as Decision §5 of the prior four overlay leaves:

- **Symmetry with `data-rollup-status` / `data-facet-*` / `data-is-axiom` / `data-has-annotation` / `data-annotation-count` / `data-diagnostic-severity` / `data-diagnostic-kinds`.** All prior mirror attributes use sentinel strings rather than omission. The own-vote attribute follows suit so the mirror's per-attribute presence is uniform.
- **Explicit not-voted branch in Playwright.** Block 6 asserts `[data-own-vote="agree"]` on the agreed entity AND `[data-own-vote="dispute"]` on the disputed AND `[data-own-vote="none"]` on the entity where ONLY another participant voted (NOT the current). The "none" branch is a real assertion — "we confirmed the current participant did NOT vote here" — not the absence of an assertion.
- **Reader-friendliness.** A reader scanning the rendered DOM in devtools sees the own-vote state for every entity, not just the voted ones.

**Attribute shape**: ONE tri-state `data-own-vote` attribute, NOT two attributes (`data-own-vote-cast="true|false"` + `data-own-vote-value="agree|dispute"`). The two-attribute shape would be marginally more parseable for "did I vote at all?" without parsing the value, but the three-state encoding is simpler and the value-of-interest assertions (`toHaveAttribute('data-own-vote', 'agree')`) target the value directly without composing two reads. Symmetric with `data-rollup-status` (also a single closed-enum attribute that includes the `'none'` sentinel) and against `data-is-axiom` / `data-has-annotation` (boolean two-state — but those genuinely ARE booleans on the wire; the own-vote is a closed three-state enum so a single attribute matches the wire shape better).

### §6 — Sixth `test()` block in the existing spec file using `kate` + `leo`; describe stays `fullyParallel`

The existing `tests/e2e/participant-graph-render.spec.ts` describe has FIVE `test()` blocks running under `test.describe(...)` (parallel). Per the part_e2e_user_pool_expansion + part_diagnostic_highlights refinement chain, `kate` + `leo` is the explicit earmark for this leaf (the diagnostic-highlights refinement at line 11 carries the earmark forward: "`kate` + `leo` for the subsequent `part_own_vote_indicators` leaf").

Three options:

- **(a) Sixth `test()` block in the existing file using `kate` + `leo`; describe stays `test.describe(...)` (`fullyParallel`).** Chosen. Reuses the spec file's existing helpers (`createSession`, `freshContext`, `logoutAndClearAllCookies`); the new block runs in its own worker concurrently with the prior five; wall-clock for the spec file is unchanged. The pair earmark is honored — no in-file `users` upsert race, no per-session debater-A claim collision. Pool usage after this block: 12/12 users (alice+ben, maria+dave, frank+erin, grace+henry, ivan+julia, kate+leo) — the full roster is now exhausted; subsequent leaves under this describe would need either (i) a new spec file with its own auth scope, (ii) a pool expansion, or (iii) a serialization revert. That is a FUTURE concern, not this leaf's.
- **(b) New spec file `tests/e2e/participant-own-vote-indicators.spec.ts` with its own setup.** Rejected: would duplicate ~80 lines of fixture composition; the existing-file path is cleaner at 6 blocks. (The 6-block threshold is the user-pool exhaustion line; the NEXT new block AFTER this one — whatever that is — has to take the split path.)
- **(c) Use an earlier pair (e.g. alice+ben) and flip the describe back to `.serial`.** Rejected: the pool expansion specifically reverted the `.serial` regression; reusing an earlier pair would re-introduce the race (or force `.serial` back, undoing the pool-expansion work).

Decision §6 (a): ship (a). The new block:

1. Sets up kate + leo + the session + the lobby chain (mirroring block 5).
2. Navigates leo to `/p/sessions/${sessionId}` (manual `page.goto`).
3. Asserts `route-operate` + `participant-graph-root` + `participant-graph-status-mirror` visible.
4. Seeds events via `__aConversaWsStore.getState().applyEvent(...)`:
   - Two `node-created` events (NODE_A, NODE_B).
   - One `edge-created` event (EDGE_AB, source NODE_A → target NODE_B).
   - One `proposal` of `classify-node` for NODE_A (proposal P1) — the proposal envelope id is the wire UUID the vote payload references.
   - One `proposal` of `set-edge-substance` for EDGE_AB (proposal P2).
   - One `proposal` of `classify-node` for NODE_B (proposal P3).
   - A `vote` of `agree` on P1 by leo (current participant). Asserts NODE_A mirror → `data-own-vote="agree"`.
   - A `vote` of `dispute` on P2 by leo. Asserts EDGE_AB mirror → `data-own-vote="dispute"`.
   - A `vote` of `agree` on P3 by kate (other participant). Asserts NODE_B mirror → `data-own-vote="none"` (other-participant's vote does NOT surface in leo's own-vote indicator).

The block is ~90 lines on top of the shared helpers (the three-entity assertion table — node-agree, edge-dispute, node-other-voted-not-me — pins both the positive arms AND the per-participant filter contract).

### §7 — Mirror attribute shape: one `data-own-vote` (not split `data-own-vote-cast` + `data-own-vote-value`)

Covered briefly under Decision §5 — surfaced again here because it's a recurring per-leaf shape decision worth its own bullet. The single tri-state attribute mirrors the wire data faithfully (the wire vote is a closed three-state-or-`'withdraw'` enum, collapsed here to a closed three-state-or-`'none'`); the split-attribute shape would suit a boolean-plus-payload model (true/false + an arm), but the participant's own-vote IS the arm + a `'none'`. Single attribute. No future split planned.

### §8 — Export the two thin helpers (`ownVoteForNode`, `ownVoteForEdge`); keep the full `OwnVoteIndex` reachable for future consumers

The `ownVotes.ts` module exports:

- `projectOwnVotes(events, currentParticipantId): OwnVoteIndex` — the canonical projection.
- `ownVoteForNode(index, nodeId): OwnVote` — passthrough returning `index.nodes.get(nodeId) ?? 'none'`.
- `ownVoteForEdge(index, edgeId): OwnVote` — passthrough returning `index.edges.get(edgeId) ?? 'none'`.

The at-a-glance projection inlines the `index.nodes.get(id) ?? 'none'` directly in `projectGraph`'s node/edge-creation branches, so the thin helpers aren't strictly needed by THIS leaf — but exposing them now keeps future consumers from refactoring the seam. Same rationale as `part_axiom_mark_decoration` Decision §8 + `part_annotation_render` Decision §8 + `part_diagnostic_highlights` Decision §8.

The future consumers:

- The entity detail panel (`part_entity_detail_panel`) will use `ownVoteForNode` / `ownVoteForEdge` as the precondition for showing "your current vote" alongside the per-facet breakdown.
- The participant-side vote-cast gesture (`part_vote_single_tap`) will use the same helpers to read "did I already vote here?" before showing the confirm-change UI.
- The future `part_other_vote_indicators` sibling will adopt a DIFFERENT projection (the moderator's full `projectVotesByFacet`), not these helpers — so the helpers are scoped to "own-vote consumers" only.

The full `OwnVoteIndex` stays the public projection seam; the thin helpers are convenience wrappers.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- Shipped the at-a-glance own-vote indicator as the 6th visual-vocabulary layer on the participant's Cytoscape canvas: emerald `text-outline` for agree, rose for dispute, none-otherwise. New module `apps/participant/src/graph/ownVotes.ts` is a participant-narrowed port of the moderator's `projectVotesByFacet` (10 unit cases in `apps/participant/src/graph/ownVotes.test.ts`), exposing `projectOwnVotes`, `ownVoteForNode`, `ownVoteForEdge`, and the `EMPTY_OWN_VOTES` seam — keeping the public projection seam intact per Decision §8 even though `projectGraph` inlines the lookups.
- Widened `apps/participant/src/graph/projectGraph.ts` to a 7th `ownVoteIndex` argument and grew both `ParticipantNodeData` and `ParticipantEdgeData` with an `ownVote: OwnVote` field; node/edge-creation branches both stamp `index.nodes.get(id) ?? 'none'` / `index.edges.get(id) ?? 'none'` (symmetric node+edge stamping per Decision §3). `apps/participant/src/graph/projectGraph.test.ts` threads `EMPTY_OWN_VOTES` through every existing call and adds 5 new own-vote projection cases (`mm`/`nn`/`oo`/`pp`/`qq`).
- Claimed the `text-outline-*` Cytoscape stylesheet primitive family in `apps/participant/src/graph/GraphView.tsx` (4 new selectors — `node[ownVote = "agree"]`, `node[ownVote = "dispute"]`, `edge[ownVote = "agree"]`, `edge[ownVote = "dispute"]` — gating `text-outline-color` + `text-outline-width`). This is the 6th visual layer; future overlay leaves (`part_other_vote_indicators` and beyond) must enumerate the remaining unclaimed primitive families per the established collision-check discipline.
- Added a new **required** `currentParticipantId` prop to `<GraphView>`, threaded from `OperateRoute` via `auth.user.userId` (`apps/participant/src/routes/OperateRoute.tsx` + one new prop-threading case in `apps/participant/src/routes/OperateRoute.test.tsx`). The DOM mirror `<li>` rows for nodes and edges both grow a single tri-state `data-own-vote` attribute (Decision §5 + §7 — one attribute, not split cast+value).
- Pinned the per-participant filter contract — "another participant's vote stays `none` for me" — at every layer: a dedicated `GraphView.test.tsx` case (within the 6 new component cases), and the 6th Playwright block in `tests/e2e/participant-graph-render.spec.ts` (kate+leo, three-entity assertion table covering agree / dispute / and the other-participant-voted-but-not-me arm).
- Failing-first verification per ADR 0022: forcing `projectOwnVotes → EMPTY_OWN_VOTES` flipped 6 of the 10 `ownVotes` cases red (a/c/f/h stayed naturally green — they exercise the empty/default branch); forcing both `projectGraph` branches to stamp `ownVote: 'none'` flipped 4 of the 5 new `projectGraph` cases red (nn/oo/pp/qq), with `mm` "stamps none by default" passing naturally — exactly matching the refinement prediction.
- Cucumber unchanged: the vote envelope is already pinned by `features/ws-vote.feature` + `features/ws-proposal-status.feature` per the wire-surface pre-pin noted in the refinement Inputs.
- Vitest delta: 3929 → 3951 (+22 = ownVotes +10, projectGraph +5, GraphView +6, OperateRoute +1). Playwright `participant-graph-render.spec.ts`: 5 → 6 blocks (7 matched tests, 15.4s wall-clock under 6 workers — within the pre-vote baseline).
