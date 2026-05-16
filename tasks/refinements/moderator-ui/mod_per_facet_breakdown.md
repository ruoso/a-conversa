# Moderator right-sidebar per-facet breakdown of each pending proposal

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_pending_proposals_pane.mod_per_facet_breakdown`.

```
task mod_per_facet_breakdown "Per-facet breakdown of each proposal" {
  effort 1d
  allocate team
  depends !mod_proposal_list
}
```

## Effort estimate

**1d.** Confirmed. The deliverable is one selector module
(`apps/moderator/src/graph/proposalFacets.ts` — a pure derivation off
the proposal payload), one new presentational component
(`<ProposalFacetBreakdown>` in `apps/moderator/src/layout/`) wired
into the existing `<PendingProposalRow>` body, the matching Vitest
coverage, one Playwright `test()` block under
`tests/e2e/moderator-capture.spec.ts`, the i18n keys + native-review
follow-up. The per-facet status derivation itself is **already
shipped** (`apps/moderator/src/graph/facetStatus.ts` —
`computeFacetStatuses` mirrors the server's
`deriveFacetStatus`); the per-participant vote indicators and the
commit button are the next siblings and are NOT in scope.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing
their public contracts):

- **`moderator_ui.mod_pending_proposals_pane.mod_proposal_list`**
  (done — 2026-05-16, commit `d889e98`). Shipped the row container
  the breakdown mounts inside. The row currently renders, in order:
  kind chip · wording-or-summary · 8-char author · relative
  timestamp (see `apps/moderator/src/layout/PendingProposalsPane.tsx:196-228`).
  The row's `data-testid="pending-proposal-row"` +
  `data-proposal-id="<id>"` test-seam contract is preserved
  unchanged; this task adds a per-facet breakdown body BELOW the
  one-line row header (Decision §2). The selector seam — the
  `PendingProposalRow` data shape exported from
  `apps/moderator/src/graph/pendingProposals.ts:52-91` —
  already carries the full `proposal: ProposalPayload` field this
  task switches on.
- **`data_and_methodology.event_types.proposal_events`** (done —
  2026-05-10). The eleven proposal sub-kinds + the outer
  `proposalEnvelopePayloadSchema` whose `proposal` payload nests
  the discriminated-union sub-kind. The shape map between sub-kind
  and per-facet target (the "what facets does this proposal
  expose?" question) is settled here — see Decision §1.
- **`data_and_methodology.projection.per_facet_status_derivation`**
  (done — 2026-05-10). The canonical `FacetStatus` enum
  (`'proposed' | 'agreed' | 'disputed' | 'committed' | 'withdrawn'
  | 'meta-disagreement'`) and the seven derivation rules that drive
  it. Used through its client-side mirror.
- **`moderator_ui.mod_graph_rendering.mod_per_facet_state_visualization`**
  (done — 2026-05-11). Established the per-facet visual vocabulary
  on the graph card (the `<FacetPill>` component at
  `apps/moderator/src/graph/FacetPill.tsx`) and the `methodology.facet.*`
  catalog keys (`wording` / `classification` / `substance`). The
  per-status border / ring / opacity choices land here:
  `proposed` dashed-slate + opacity-60, `agreed` solid-slate-700,
  `disputed` solid-rose-600 + ring, `meta-disagreement`
  double-violet-600 + ring, `committed` solid-slate-400 + opacity-90,
  `withdrawn` dashed-slate-400 + opacity-50. Decision §3 commits
  to mirroring this vocabulary in the sidebar so the moderator's
  facet recognition transfers between surfaces.
- **`moderator_ui.mod_graph_rendering.mod_proposed_state_styling`**
  (done — landed `apps/moderator/src/graph/facetStatus.ts`'s
  `computeFacetStatuses(events): FacetStatusIndex` — the pure
  client-side mirror of the server's `deriveFacetStatus`. This task
  uses the same FacetStatus derivation path but at a different
  granularity: instead of asking "what is the *current* facet
  status on entity X?" the breakdown asks "what is the per-facet
  status for *this specific proposal*'s targeted facet?". For
  facet-targeting proposals (the four sub-kinds that map to a
  per-entity-facet — `classify-node`, `set-node-substance`,
  `set-edge-substance`, `edit-wording`), the answer is the same
  value the graph's `<FacetPill>` shows for that (entity, facet)
  pair. For structural sub-kinds (decompose / interpretive-split /
  axiom-mark / meta-move / break-edge / amend-node / annotate /
  set-edge-substance role variants), the proposal does not map to
  a per-facet entry in `FacetStatusIndex` — the breakdown surfaces
  the proposal's *lifecycle* status from
  `useWsStore.sessionState[id].pendingProposals` (the
  `proposal-status` envelope) or the absence-of-terminator default
  (`'proposed'`) (Decision §4).
- **`backend.websocket_protocol.ws_proposal_status_broadcast`** (done).
  Lands `useWsStore.sessionState[id].pendingProposals[proposalId].perFacetStatus`
  with the server-derived per-facet status keyed by `FacetName`. This
  task is the **primary consumer** of that surface — the row body
  reads `perFacetStatus` for each pending proposal id when present,
  and falls back to the client-side `computeFacetStatuses` derivation
  when the server has not yet broadcast (or the proposal targets no
  facet) (Decision §5). The store shape is
  `Record<proposalId, ProposalStatusPayload>` at
  `apps/moderator/src/ws/wsStore.ts:52`.
- **`moderator_ui.mod_shell.mod_ws_client`** (done — 2026-05-11). The
  `WsClientProvider` mounted by `<OperateRoute>`; `useWsStore`
  carries the per-session `events` + `pendingProposals` slices the
  breakdown reads.
- **`frontend_i18n.i18n_methodology_glossary`** (done — 2026-05-11).
  Shipped `methodology.facet.*` (3 keys × 3 locales) and
  `methodology.facetState.*` (4 keys × 3 locales). The per-facet
  label reuses the `methodology.facet.<facet>` keys verbatim
  (same as `<FacetPill>` on the graph); the optional status word
  (e.g. "Proposed" / "Agreed") reuses
  `methodology.facetState.<status>` for the four agreement-layer
  values and adds two new catalog entries for `committed` and
  `withdrawn` (Decision §6 + §10).
- **`frontend_i18n.i18n_propose_action`** + **`mod_proposal_list`** —
  the chained `*_native_review` tasks under
  `tasks/35-frontend-i18n.tji`; this task appends the next link
  (`i18n_per_facet_breakdown_native_review`).
- **[ADR 0021 — Event envelope as discriminated union](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)** —
  the schema-on-write boundary; `proposal.payload.proposal` is
  structurally valid by construction so the breakdown's
  `switch (proposal.kind)` is total.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)** —
  every empirical check ships as a committed Vitest / Playwright
  case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)** —
  the catalog discipline the two new strings flow through.

Pending edges (this task FEEDS them; does NOT depend on them):

- **`moderator_ui.mod_pending_proposals_pane.mod_vote_indicators_in_sidebar`**
  — sibling. Will add per-participant vote indicators INSIDE each
  facet entry the breakdown renders (mirroring how
  `<FacetPill>` on the graph hosts the `<VoteIndicator>` row).
  This task lands the facet-row seam
  (`data-testid="proposal-facet-row"` + `data-facet-name="<facet>"`
  + `data-facet-status="<status>"`); the sibling adds the
  participant dots inside.
- **`moderator_ui.mod_pending_proposals_pane.mod_commit_button`** —
  sibling. Reads the per-facet "all current participants agree"
  predicate the breakdown's status field already surfaces; the
  enable/disable rule is `every facet has status === 'agreed'`.
- **`moderator_ui.mod_pending_proposals_pane.mod_proposal_filter_search`**
  — sibling. May filter by facet status (e.g. "show only
  proposals with disputed facets"); reads the breakdown's
  derived per-facet status list.
- **`frontend_i18n.i18n_per_facet_breakdown_native_review`** (registered
  by this task). The 2 new pt-BR / es-419 drafts
  (`methodology.facetState.committed` / `.withdrawn`) land flagged
  PENDING in the matching `*.review.json` trackers.

## What this task is

Extend each row of the right-sidebar `<PendingProposalsPane>` with a
per-facet breakdown body that lists every facet the proposal
exposes, each with its **overall** per-facet status (proposed /
agreed / disputed / committed / withdrawn / meta-disagreement). The
breakdown body sits **inline below** the existing one-line row
header (kind chip · summary · author · timestamp), always-shown but
compact (Decision §2 — the moderator is scanning the pane "to
decide what to commit next", which favors at-a-glance state over
click-to-expand).

Concretely the deliverable is:

- **One new selector module** `apps/moderator/src/graph/proposalFacets.ts`
  exporting `derivePerProposalFacets(proposal: ProposalPayload,
  facetStatusIndex: FacetStatusIndex, serverPerFacetStatus:
  Record<string, string> | undefined): readonly ProposalFacetEntry[]`.
  Pure function. Decodes the proposal's facet shape via a
  per-sub-kind switch (Decision §1), then resolves each facet's
  status by reading — in priority order — (a) the server-broadcast
  `serverPerFacetStatus` for that facet name (the source of
  truth when present), (b) the client-side
  `facetStatusIndex.{nodes,edges}.get(entityId)?.[facet]` for
  facet-targeting sub-kinds when no server frame has arrived yet,
  (c) `'proposed'` as the default for facet entries the proposal
  introduces but neither surface has computed yet (Decision §5).
  For structural sub-kinds (decompose, interpretive-split, etc.)
  the function emits one "lifecycle" entry per proposal whose
  facet name is the synthetic `'proposal'` (Decision §4) and
  whose status is the same six-value enum
  (`'proposed' | 'agreed' | 'disputed' | 'committed' | 'withdrawn'
  | 'meta-disagreement'`).
- **One new presentational component**
  `apps/moderator/src/layout/ProposalFacetBreakdown.tsx` exporting
  `<ProposalFacetBreakdown row={PendingProposalRow}
  facetStatusIndex={FacetStatusIndex} serverPerFacetStatus={...} />`.
  Renders a small inline row of facet chips inside each
  `<PendingProposalRow>`'s `<li>` body, beneath the existing one-line
  header. Mirrors the `<FacetPill>` vocabulary from the graph (per
  Decision §3): per-status border / color / opacity classes match
  the graph pills 1:1, so a `disputed` chip on the sidebar and a
  `disputed` pill on the graph look the same. Each facet chip
  carries `data-testid="proposal-facet-row"`,
  `data-facet-name="<facet|proposal>"`, and
  `data-facet-status="<status>"` so the sibling
  `mod_vote_indicators_in_sidebar` task can address each chip
  precisely.
- **One edit in `<PendingProposalsPane>`** (`apps/moderator/src/layout/PendingProposalsPane.tsx`):
  read `events` (already done — drives the row list) AND
  `pendingProposals` (the per-proposal server status frames; new
  read for this task). Compute the `facetStatusIndex` once via the
  existing `computeFacetStatuses(events)` from `facetStatus.ts`
  (memoized on the events array reference — same pattern the
  existing pane uses). Pass both into each
  `<PendingProposalRow>`. The row component's internal layout
  changes from a single-line flex container to a two-line stack:
  the existing one-line header stays as-is on the first line; the
  `<ProposalFacetBreakdown>` mounts on the second line.
- **Vitest cases** at
  `apps/moderator/src/graph/proposalFacets.test.ts` (selector
  purity, all eleven sub-kinds round-trip, server-vs-client
  precedence, default-to-proposed) and at
  `apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx`
  (render shape, facet chip test ids, per-status styling branches
  mirror `<FacetPill>`, single-facet vs multi-facet proposals).
  Extend `apps/moderator/src/layout/PendingProposalsPane.test.tsx`
  with: (a) a multi-facet proposal renders one facet chip per
  facet; (b) the server's `perFacetStatus` takes precedence over
  the client mirror when both are available; (c) the existing
  row's one-line header is unaffected (kind chip + summary +
  author + timestamp test ids stay present).
- **One new `test()` block** in `tests/e2e/moderator-capture.spec.ts`
  extending the just-shipped pending-proposals row assertion:
  after the propose lands, assert that the row contains a
  `proposal-facet-row` chip for the `classification` facet (since
  the chain produces a `classify-node` proposal) with status
  `'proposed'` (no votes have arrived yet).
- **2 new i18n catalog keys × 3 locales = 6 new catalog entries**
  scoped under `methodology.facetState.*` for the two
  closed-lifecycle statuses (`committed`, `withdrawn`) that the
  per-facet derivation surfaces but
  `i18n_methodology_glossary` did not pre-register (it shipped
  only the four agreement-layer statuses). Decision §10
  enumerates the keys.
  Plus 1 new key (`methodology.facet.proposal`) for the synthetic
  "lifecycle" facet name structural sub-kinds use (Decision §4 +
  §10).
- **1 follow-up tech-debt task registered** in
  `tasks/35-frontend-i18n.tji`
  (`i18n_per_facet_breakdown_native_review`, effort 0.5d,
  `depends !i18n_proposal_list_native_review`).

This task is the **second leaf of the
`mod_pending_proposals_pane` subgroup** — the foundation
(`mod_proposal_list`) established the row container; this task
fills in the per-facet detail; the remaining three siblings
(`mod_vote_indicators_in_sidebar`, `mod_commit_button`,
`mod_proposal_filter_search`) build on the per-facet chip seam
this task introduces.

## Why it needs to be done

Three reasons, in priority order:

1. **The pane's purpose is "decide what to commit next".** The row
   header (kind chip · summary · author · timestamp) tells the
   moderator *what* was proposed and *who* by, but not *how close
   it is to commit-readiness*. A proposal whose every facet is
   `'agreed'` is one click away from commit; a proposal whose
   `wording` is agreed but `substance` is disputed needs more
   discussion. Without the per-facet breakdown, the moderator
   must drill into the graph canvas or the (not-yet-shipped)
   commit button to see the per-facet state. Surfacing it inline
   makes the pane scannable for commit-readiness.
2. **The sibling commit button (`mod_commit_button`) cannot land
   without it.** The commit button's enabled/disabled rule reads
   the per-facet status (`every facet has status === 'agreed'`).
   The button needs the same derived data this task produces;
   landing it here means the button task slots a button into the
   already-rendered row body without re-deriving anything.
3. **Visual consistency with the graph card pays compounding
   dividends.** The graph's `<FacetPill>` is the moderator's
   reference for per-facet state. Mirroring its visual vocabulary
   in the sidebar means moderators don't learn two grammars — a
   `disputed` chip on the sidebar reads the same as a `disputed`
   pill on the canvas. The per-facet-state-visualization task
   already committed the border / ring / opacity choices; this
   task adopts them verbatim (Decision §3).

## Inputs / context

- [`docs/moderator-ui.md`](../../../docs/moderator-ui.md) — the
  pending-proposals pane spec (line 30 lists it as the first of
  the three right-sidebar panes); F1 step 4 (line 46) — "The
  pending-proposals pane fills in"; the per-participant vote
  indicators "in both places — graph + sidebar" framing (lines
  165-169) makes the breakdown the host for the sibling
  vote-indicator surface in the sidebar.
- [`apps/moderator/src/layout/PendingProposalsPane.tsx`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx) —
  the row component this task extends. Lines 196-228 are the
  current `<PendingProposalRow>`; lines 230-283 are the pane
  shell + the Zustand subscription that reads `events`. Two
  edits: (a) the pane reads `pendingProposals` in addition to
  `events`; (b) the row's internal layout grows a second line
  below the header.
- [`apps/moderator/src/graph/pendingProposals.ts`](../../../apps/moderator/src/graph/pendingProposals.ts) —
  the selector that drives the row list. The
  `PendingProposalRow` shape exported at lines 52-91 already
  carries `proposal: ProposalPayload` (the discriminated union
  this task switches on); no selector changes are needed.
- [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) —
  the client-side per-entity per-facet status derivation. Lines
  179-284 implement `computeFacetStatuses(events): FacetStatusIndex`;
  the `targetOf` helper at lines 111-143 enumerates the four
  facet-targeting proposal sub-kinds (`classify-node`,
  `set-node-substance`, `set-edge-substance`, `edit-wording`)
  and explicitly returns `null` for the seven structural
  sub-kinds — the breakdown's per-sub-kind switch mirrors that
  partition for the same reason. The `FacetStatus` /
  `FacetName` types at lines 43-56 are the canonical client
  types this task reuses.
- [`apps/moderator/src/graph/FacetPill.tsx`](../../../apps/moderator/src/graph/FacetPill.tsx) —
  the per-facet visual vocabulary on the graph card. The
  `PILL_STATUS_CLASSNAME` map at lines 67-75 is the per-status
  Tailwind branches the sidebar chip mirrors verbatim
  (Decision §3). The `data-facet-pill` / `data-facet-name` /
  `data-facet-status` test seam pattern (lines 104-108) is the
  shape the sidebar chip reuses (renamed to
  `data-testid="proposal-facet-row"` to disambiguate the two
  surfaces).
- [`apps/moderator/src/ws/wsStore.ts`](../../../apps/moderator/src/ws/wsStore.ts) —
  lines 46-68 declare `WsSessionState`. Line 50 is `events`
  (already read by the pane); line 52 is `pendingProposals`
  (this task's new read — the per-proposal `perFacetStatus`
  index). Line 191-204 is `applyProposalStatus`, the writer
  that lands `proposal-status` envelopes into the store; the
  pane subscribes to `pendingProposals` via the standard
  Zustand selector pattern alongside the existing `events`
  subscription.
- [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) —
  lines 1188-1218 declare `ProposalStatusPayload` and the
  payload schema. `perFacetStatus: Record<string, string>` is
  the wire shape (the inner `FacetName` / `FacetStatus`
  vocabulary is enforced by the server-side construction site
  at `apps/server/src/ws/broadcast/proposal-status.ts` per the
  ws-envelope file header). Only facets the proposal actually
  targets are present.
- [`packages/shared-types/src/events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts) —
  the canonical proposal-payload definitions. Lines 73-79
  (classify-node — `classification` facet on `node_id`);
  lines 85-91 (set-node-substance — `substance` on `node_id`);
  lines 98-104 (set-edge-substance — `substance` on
  `edge_id`); lines 120-146 (edit-wording reword/restructure
  — `wording` on `node_id`); lines 168-188 (decompose /
  interpretive-split — structural, no per-facet target);
  lines 196-202 (axiom-mark — structural); lines 219-228
  (meta-move — structural); lines 235-275 (break-edge,
  amend-node, annotate — structural). The
  `ProposalPayload` discriminated union at lines 297-311 is
  what the selector switches on.
- [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts) —
  the server-side source of truth the WS broadcast reads
  through. The seven derivation rules live here (mirrored
  client-side in `apps/moderator/src/graph/facetStatus.ts`).
  This task does not re-implement the rules; it reads their
  output via either the broadcast frame or the client mirror.
- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) —
  lines 67-72 declare `methodology.facetState.*` (existing —
  `proposed`/`agreed`/`disputed`/`meta-disagreement`); lines
  73-77 declare `methodology.facet.*` (existing — `wording`,
  `classification`, `substance`). This task adds two new
  status keys (`committed`, `withdrawn`) and one new facet
  key (`proposal` — the synthetic lifecycle facet name).
- [`tests/e2e/moderator-capture.spec.ts`](../../../tests/e2e/moderator-capture.spec.ts) —
  lines 762-815 are the just-landed pending-proposals row
  assertion this task extends. The propose chain produces a
  `classify-node` proposal, so the row's breakdown should
  show one `classification` facet chip at status `'proposed'`
  (the freshly-proposed item has no votes yet).
- [`tasks/refinements/moderator-ui/mod_proposal_list.md`](mod_proposal_list.md) —
  the predecessor refinement; the row shape this task extends
  is defined in its Decision §3-§4.
- [`tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md`](mod_per_facet_state_visualization.md) —
  the parallel-concept refinement on the graph; the per-status
  visual choices this task mirrors live in its Decisions
  (and are rendered into `<FacetPill>`'s
  `PILL_STATUS_CLASSNAME` map).
- [`tasks/refinements/data-and-methodology/proposal_events.md`](../data-and-methodology/proposal_events.md) —
  the canonical proposal-event shape including facets.
- [`tasks/refinements/data-and-methodology/per_facet_status_derivation.md`](../data-and-methodology/per_facet_status_derivation.md) —
  the seven derivation rules.
- [`tasks/refinements/data-and-methodology/agreement_state_machine.md`](../data-and-methodology/agreement_state_machine.md) —
  the per-facet state machine the derivation operates on.
- [`tasks/refinements/backend/ws_proposal_status_broadcast.md`](../backend/ws_proposal_status_broadcast.md) —
  the surface this task is the primary consumer of.

## Constraints / requirements

- **Selector is pure.** `derivePerProposalFacets(proposal,
  facetStatusIndex, serverPerFacetStatus)` is a pure function with
  no closure over time, no `Date.now()`, no `Math.random()`. The
  rendering happens in the component; the selector's output is a
  plain array of `{ facet, status, label }` triples (the `label`
  is a translation key, not pre-translated prose — the component
  calls `t(label)`).
- **Selector handles all eleven proposal sub-kinds.** Decision
  §1 enumerates the per-sub-kind facet map; the switch is
  exhaustive against `ProposalPayload`'s discriminated union.
  TypeScript narrowing on `proposal.kind` makes the switch
  total; the default branch is a runtime safety net for
  callers that bypass TypeScript (matching the pattern in
  `apps/moderator/src/layout/PendingProposalsPane.tsx:150-156`).
- **Status precedence: server frame → client mirror → default.**
  When `serverPerFacetStatus[facetName]` is present, that
  value wins (the server is the source of truth — see
  `ws_proposal_status_broadcast.md`). Else, when the client
  mirror's `facetStatusIndex` has an entry for the (entityKind,
  entityId, facet) triple this proposal targets, that value
  wins (the client derivation is itself a port of the
  server's rules — see
  `apps/moderator/src/graph/facetStatus.ts:1-15` for the
  duplication rationale). Else, the default is `'proposed'`
  (the proposal exists in the pending list — the derivation's
  Rule 7 result for an unvoted facet — Decision §5).
- **Structural sub-kinds get one synthetic "lifecycle" facet
  entry.** Decompose / interpretive-split / axiom-mark /
  meta-move / break-edge / amend-node / annotate target no
  per-entity-facet `FacetState` in the projection (per
  `facetStatus.ts:129-142` and `per_facet_status_derivation.md`).
  The breakdown still needs to surface their commit-readiness
  status, so the selector emits one entry with `facet:
  'proposal'` (a synthetic lifecycle facet name) and a status
  derived from the same rules — defaulting to `'proposed'` and
  flipping to `'committed'` / `'meta-disagreement'` via the
  pending-list terminator events (Decision §4). The component
  renders the `methodology.facet.proposal` label
  ("Proposal" in en-US — Decision §10).
- **Breakdown chip vocabulary mirrors `<FacetPill>`.** The
  per-status Tailwind branches are copied verbatim from
  `apps/moderator/src/graph/FacetPill.tsx:64-75`. If the graph's
  pill styling ever changes (e.g. a state-styling refinement
  shifts the disputed ring tone), the sidebar chip must follow
  in the same commit. A small inline test asserts the two
  className maps stay equal in shape (Decision §3 mid-commit
  drift guard).
- **Row-body layout: two-line stack, breakdown second.** The
  existing one-line header (kind chip · summary · author ·
  timestamp) stays as the first line; the breakdown sits below
  it on a second line with the facet chips wrapping (`flex
  flex-wrap gap-1`). Decision §2 commits to always-shown
  (vs click-to-expand) since "scan for commit-readiness" is the
  pane's purpose.
- **Test-id seams the sibling tasks consume.** Each facet chip
  carries `data-testid="proposal-facet-row"`,
  `data-facet-name="<facet>"`, and `data-facet-status="<status>"`.
  The breakdown container carries
  `data-testid="proposal-facet-breakdown"` and
  `data-proposal-id="<proposalEventId>"` (mirrors the row's
  attribute so the breakdown is independently addressable). The
  existing row's `data-testid="pending-proposal-row"` +
  `data-proposal-id` attributes stay unchanged — sibling tasks'
  selectors still resolve.
- **Reads `pendingProposals` from `useWsStore`.** The pane adds a
  second Zustand selector reading
  `state.sessionState[sessionId]?.pendingProposals`. The
  reference-equality check re-renders the pane the moment a
  new `proposal-status` envelope lands. The two reads are
  separate Zustand selector subscriptions (idiomatic — keeps
  each cell narrow).
- **`useMemo` on the per-row breakdown derivation.** Each
  row's breakdown derivation is wrapped in `useMemo` keyed on
  `[row.proposal, facetStatusIndex, serverPerFacetStatus]` so
  re-renders that don't change those references skip the
  derivation. The `facetStatusIndex` is computed once per
  pane render (memoized on the events reference, same pattern
  as `derivePendingProposals`); subscriptions cost stays
  proportional to the rate of new events.
- **No business logic.** The breakdown reads
  `useWsStore` slices only. No `wsClient.send`, no capture
  store, no methodology engine.
- **i18n.** Facet name labels reuse `methodology.facet.<facet>`
  (existing keys). The optional status word reuses
  `methodology.facetState.<status>` for the four existing
  agreement-layer values; two new keys
  (`methodology.facetState.committed` /
  `methodology.facetState.withdrawn`) land in this task plus the
  synthetic `methodology.facet.proposal` for structural
  sub-kinds (Decision §10). Plus the pt-BR / es-419 drafts
  flagged PENDING in `*.review.json`.
- **Tailwind only.** Consistent with the sidebar palette and
  the graph pill (`border-slate-*`, `border-rose-*`,
  `border-violet-*`, `text-*`, `opacity-*`).

## Acceptance criteria

- `apps/moderator/src/graph/proposalFacets.ts` exports
  `ProposalFacetEntry` interface (`{ facet: FacetName |
  'proposal'; status: FacetStatus; labelKey: string }`) and
  `derivePerProposalFacets(proposal: ProposalPayload,
  facetStatusIndex: FacetStatusIndex, serverPerFacetStatus:
  Record<string, string> | undefined): readonly
  ProposalFacetEntry[]` pure function.
- `apps/moderator/src/graph/proposalFacets.test.ts` (Vitest, per
  ADR 0022) covers: (a) each of the four facet-targeting
  sub-kinds emits one entry with the expected `facet` value
  (`classify-node` → `classification`; `set-node-substance` →
  `substance`; `set-edge-substance` → `substance`;
  `edit-wording` reword/restructure → `wording`); (b) each of
  the seven structural sub-kinds emits one entry with `facet:
  'proposal'`; (c) server `serverPerFacetStatus[facet]`
  overrides the client mirror value; (d) client mirror value is
  used when `serverPerFacetStatus` is undefined OR does not
  carry the facet; (e) default-to-`'proposed'` when neither
  surface carries the facet; (f) the function is pure (calling
  it twice with the same inputs returns deep-equal outputs).
- `apps/moderator/src/layout/ProposalFacetBreakdown.tsx`
  exports `<ProposalFacetBreakdown row, facetStatusIndex,
  serverPerFacetStatus />` component rendering a `<div
  data-testid="proposal-facet-breakdown"
  data-proposal-id="...">` with one
  `<span data-testid="proposal-facet-row" data-facet-name="..."
  data-facet-status="...">` per entry. Each chip carries the
  per-status Tailwind classes that match `<FacetPill>`'s
  `PILL_STATUS_CLASSNAME` map.
- `apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx`
  covers: (a) a `classify-node` proposal renders one chip
  with `data-facet-name="classification"` and the resolved
  facet label ("Classification"); (b) the per-status
  className for each of the six `FacetStatus` values matches
  the corresponding `<FacetPill>` className (assert via the
  shared `PILL_STATUS_CLASSNAME`-equivalent map); (c) a
  structural sub-kind (`decompose`) renders one chip with
  `data-facet-name="proposal"` and the
  `methodology.facet.proposal` label ("Proposal"); (d) when
  `serverPerFacetStatus[facetName]` is present, the chip's
  `data-facet-status` reflects the server value (not the
  client mirror); (e) the breakdown container carries
  `data-proposal-id` matching the row's proposal id.
- `apps/moderator/src/layout/PendingProposalsPane.tsx` reads
  `pendingProposals` in addition to `events`, computes
  `facetStatusIndex` via `computeFacetStatuses(events)`
  (memoized on the events reference), and passes both into
  each `<PendingProposalRow>`. Each row mounts a
  `<ProposalFacetBreakdown>` below the existing one-line
  header.
- `apps/moderator/src/layout/PendingProposalsPane.test.tsx`
  is extended with: (a) a multi-facet test using a
  hand-rolled scenario (two pending proposals of distinct
  sub-kinds → each row's breakdown shows the expected facet
  chips); (b) server precedence: push a
  `applyProposalStatus` payload via the store writer; assert
  the chip's `data-facet-status` updates to the server
  value; (c) the existing row's one-line header
  (`pending-proposal-row-kind`, `-summary`, `-author`,
  `-timestamp`) is unaffected — those test ids remain on the
  page after the breakdown is added.
- New i18n keys ship in en-US + pt-BR / es-419 catalogs:
  `methodology.facetState.committed`,
  `methodology.facetState.withdrawn`,
  `methodology.facet.proposal`. The pt-BR + es-419 drafts are
  flagged PENDING in the matching `*.review.json` trackers
  per the established pattern; the
  `packages/i18n-catalogs/src/methodology.test.ts` round-trip
  matrix picks them up automatically via the
  `METHODOLOGY_VALUES` constant extension
  (Decision §10).
- One new `test()` block in
  `tests/e2e/moderator-capture.spec.ts` extends the
  pending-proposals row chain: after the propose-action
  chain produces the row, assert
  `getByTestId('proposal-facet-row')` filtered by
  `data-facet-name="classification"` has count 1 AND its
  `data-facet-status` is `'proposed'` (no votes yet). Uses
  `expect.poll` with the same 10s budget as the predecessor
  test.
- `i18n_per_facet_breakdown_native_review` is appended in
  `tasks/35-frontend-i18n.tji` after
  `i18n_proposal_list_native_review` (effort 0.5d, depends
  on `i18n_proposal_list_native_review`), wording matching
  the existing pattern (`i18n_proposal_list_native_review`
  at lines 134-140 is the template).
- `pnpm run check`, `pnpm run test:smoke`, and `pnpm -F
  @a-conversa/moderator build` all green.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent
  (after the `complete 100` marker the Closer step adds).
- `complete 100` marker added to `mod_per_facet_breakdown`
  in `tasks/30-moderator-ui.tji` by the Closer step; the
  parent `mod_pending_proposals_pane` stays open until the
  remaining three siblings land.

## Decisions

### §1 — Per-sub-kind facet map

The selector decodes the proposal payload into per-facet
entries by sub-kind:

| Sub-kind | Facet entries emitted |
| --- | --- |
| `classify-node` | `{ facet: 'classification' }` |
| `set-node-substance` | `{ facet: 'substance' }` |
| `set-edge-substance` | `{ facet: 'substance' }` |
| `edit-wording` (reword + restructure) | `{ facet: 'wording' }` |
| `decompose` | `{ facet: 'proposal' }` (synthetic — Decision §4) |
| `interpretive-split` | `{ facet: 'proposal' }` |
| `axiom-mark` | `{ facet: 'proposal' }` |
| `meta-move` | `{ facet: 'proposal' }` |
| `break-edge` | `{ facet: 'proposal' }` |
| `amend-node` | `{ facet: 'proposal' }` |
| `annotate` | `{ facet: 'proposal' }` |

Three options were on the table for the selector's
single-facet-per-sub-kind shape; option (a) wins.

- **(a) One facet entry per sub-kind today.** The four
  facet-targeting sub-kinds each target exactly one facet
  per proposal (a `classify-node` proposal carries the
  `classification` facet only — the wording / substance
  facets stay untouched by this specific proposal). The
  seven structural sub-kinds each get one synthetic
  `'proposal'` entry. Chosen.
- **(b) Emit every facet on the target entity, not just the
  one the proposal targets.** E.g. a `classify-node`
  proposal on node X emits `classification`, `wording`,
  AND `substance` chips so the moderator sees all three
  facet states at a glance. Rejected: (1) the chips would
  duplicate state that's already visible on the graph card
  (the `<FacetPill>` row on the node shows all three);
  (2) it conflates "this proposal's facet" with "this
  entity's facets" — the per-row body is about *this
  proposal*'s commit-readiness, not the underlying entity's
  health; (3) the rendered chips would be redundant across
  multiple proposals against the same entity.
- **(c) Emit zero or more facets based on cross-cutting
  rules.** E.g. a `decompose` could emit one chip per
  component's classification facet. Rejected: structural
  sub-kinds emit children via the methodology engine at
  commit time; the per-facet status of the children
  doesn't exist until they do. Surfacing speculative facet
  state would mislead.

Note: Option (a)'s mapping mirrors the
`apps/moderator/src/graph/facetStatus.ts:111-143`
`targetOf` helper — same partition (facet-targeting four +
structural seven) — so the contract stays uniform across
the two selectors. The structural sub-kinds map to a single
synthetic `'proposal'` entry rather than no entries at all
(Decision §4).

### §2 — Expansion shape: always-shown, compact

Three options were on the table; option (c) wins.

- **(a) Always expanded, multi-line per facet.** Each
  facet sits on its own line inside the row body with the
  full facet-name label, the status word, and (later) the
  per-participant vote-indicator row. Rejected for v1:
  scales poorly for proposals with three facets (rare in
  practice today — only `decompose` post-commit produces
  multi-facet rows, and they're not pending-proposals
  surface) and steals vertical space from the pane,
  reducing scannability across many rows.
- **(b) Click-to-expand.** The row is collapsible; a
  click toggles the breakdown body. Rejected: the
  moderator scans the pane to *decide what to commit
  next*, and a per-facet-status glance is the primary
  signal for that decision. Hiding the per-facet state
  behind a click defeats the pane's scan-for-readiness
  purpose. A second cost: the per-row click handler is a
  semantic add that requires keyboard-accessibility
  consideration (`<button>` vs `<details>` vs an aria-
  expanded div) which adds scope without solving the
  scanability problem.
- **(c) Always shown but compact — small horizontal facet
  chips on each row.** Inline, single line below the
  header, chips wrap if the row is narrow. Chosen.
  Matches the at-a-glance design intent; each chip is
  small (`text-[10px]` per the `<FacetPill>` precedent);
  multi-facet wrapping is a non-issue for the typical
  one-facet-per-proposal shape (and a non-issue for
  structural sub-kinds where the synthetic `'proposal'`
  chip is the only entry).

Option (c) also lets the sibling
`mod_vote_indicators_in_sidebar` task slot the
per-participant dots INSIDE each chip (mirroring how
`<FacetPill>` on the graph already hosts a `<VoteIndicator>`
row inside the pill — see `FacetPill.tsx:90-101`), keeping
the visual grammar between the two surfaces consistent.

### §3 — Visual consistency with `<FacetPill>` (mirror verbatim)

Each per-facet chip on the sidebar uses the same per-status
Tailwind branches as `<FacetPill>` on the graph — the
`PILL_STATUS_CLASSNAME` map at
`apps/moderator/src/graph/FacetPill.tsx:67-75`:

| Status | Tailwind branch |
| --- | --- |
| `proposed` | `border-dashed border-slate-400 text-slate-500 opacity-60` |
| `agreed` | `border-solid border-slate-700 text-slate-700 opacity-100` |
| `disputed` | `border-solid border-rose-600 text-rose-700 ring-1 ring-rose-500 opacity-100` |
| `meta-disagreement` | `border-double border-violet-600 text-violet-700 ring-1 ring-violet-400 opacity-100` |
| `committed` | `border-solid border-slate-400 text-slate-600 opacity-90` |
| `withdrawn` | `border-dashed border-slate-400 text-slate-500 opacity-50` |

The base structural class is also shared
(`inline-flex items-center rounded-full border bg-white
px-1.5 py-0.5 text-[10px] uppercase tracking-wide
whitespace-nowrap` from `FacetPill.tsx:64-65`).

Two options were on the table; option (a) wins.

- **(a) Mirror `<FacetPill>` verbatim — share the
  per-status className map.** Chosen. The two surfaces
  render the same per-facet status; using the same
  visual vocabulary means moderators learn one grammar
  and recognize a `disputed` chip on the sidebar
  immediately if they've seen one on the canvas. The
  className map is shared as a module-level constant
  (Decision §11 covers where it lives) so a future
  state-styling refinement that touches the graph pill
  branches automatically updates the sidebar.
- **(b) Sidebar-specific styling (e.g. solid color
  backgrounds for status).** Rejected: would introduce a
  second visual vocabulary for the same data, costing
  the moderator recognition transfer.

A small test in
`ProposalFacetBreakdown.test.tsx` asserts the shared
className map equals `PILL_STATUS_CLASSNAME`; if a future
edit shifts the graph pill without updating the sidebar
(or vice versa), the assertion fails and the drift
surfaces in CI.

### §4 — Structural sub-kinds: synthetic `'proposal'` facet entry

Seven sub-kinds (decompose, interpretive-split,
axiom-mark, meta-move, break-edge, amend-node, annotate)
target no per-entity-facet `FacetState` — the
`apps/moderator/src/graph/facetStatus.ts:129-142`
`targetOf` helper returns `null` for them. The breakdown
still needs to surface their commit-readiness state, so
the selector emits one synthetic entry with `facet:
'proposal'` (a sentinel facet name) and the same
six-value status.

Three options were on the table; option (b) wins.

- **(a) Render no facet entries for structural
  sub-kinds.** Rejected: the row would have a header
  but no per-facet body — the breakdown's vertical space
  would be empty, breaking the "every row tells you
  commit-readiness at a glance" rule.
- **(b) One synthetic `'proposal'` entry per structural
  proposal.** Chosen. Mirrors the same six-status
  vocabulary as facet-targeting sub-kinds; the chip
  shows status `'proposed'` until a commit /
  meta-disagreement-marked / vote arrives. The label
  is `methodology.facet.proposal` ("Proposal" in
  en-US — Decision §10).
- **(c) Render the structural lifecycle status
  *without* the chip wrapper (just inline text).**
  Rejected: visual inconsistency with facet-targeting
  sub-kinds; the moderator scanning the pane would
  have to recognize two different per-row body shapes.

The synthetic entry's status derivation reuses the
default `'proposed'` (the row exists in the pending
list — the derivation's Rule 7 result for an unvoted
facet); when the server emits a `proposal-status`
broadcast carrying a status for this proposal id (and
the `perFacetStatus` keyed by `'proposal'` or similar),
that takes precedence. Today's
`ws_proposal_status_broadcast` skips structural
proposals entirely (per its refinement decision —
`deriveFacetStatus` returns undefined for them), so
the synthetic chip's status stays `'proposed'` until
the proposal terminates (commit /
meta-disagreement-marked). A future tightening of the
broadcast to fan out structural-proposal lifecycle
status would be picked up automatically when the
synthetic facet name aligns; for v1 the chip is a
"this proposal is pending" reminder.

### §5 — Status resolution precedence: server → client mirror → default

For each facet entry the selector emits, its status is
resolved in priority order:

1. `serverPerFacetStatus[facetName]` if present — the
   server's `proposal-status` envelope is the source of
   truth (`ws_proposal_status_broadcast.md`).
2. For facet-targeting sub-kinds only:
   `facetStatusIndex.{nodes,edges}.get(entityId)?.[facet]`
   if present — the client-side mirror provides the
   status before the first server frame arrives (or when
   the broadcast is rate-limited / temporarily silent).
3. Default `'proposed'` — the proposal is in the
   pending list, so by definition the derivation's Rule 7
   result applies ("anything else → proposed" for an
   unvoted facet).

Two options were on the table for the precedence; option
(a) wins.

- **(a) Server first, client mirror second, default
  third.** Chosen. The server is the source of truth
  per `ws_proposal_status_broadcast.md`; the client
  mirror is a "look correct before the first frame
  arrives" fallback. The default ensures the chip
  always renders something meaningful — the proposal's
  presence in the list means it's at minimum
  `'proposed'`.
- **(b) Client mirror always.** Rejected: would skip
  the server's source-of-truth view for facets the
  server's `deriveFacetStatus` computes differently
  from the client mirror (e.g. a server-side fix to a
  derivation rule the client hasn't picked up).
  Coupling the sidebar to the client mirror exclusively
  would surface that drift silently.

The client mirror is included as a fallback (vs.
"server-only and a loading state otherwise") because
the WS broadcast is rate-limited at the server's
discretion; relying on it as the only source would
make the chip render `'proposed'` (the default) for a
period after a vote arrives but before the next
broadcast lands, which is wrong if the client mirror
already knows the vote moved the facet.

### §6 — Per-facet status word — chip label vs. inline word

Two options were on the table; option (a) wins.

- **(a) Chip carries the facet-name label only; status
  is communicated via the per-status visual
  (border / ring / color / opacity).** Chosen. Mirrors
  `<FacetPill>` exactly (the graph pill displays the
  facet name only, with status encoded visually). The
  chip's `data-facet-status="<status>"` attribute is
  the machine-readable seam for tests and sibling
  tasks; the visual is the human-readable signal. This
  also keeps the chip narrow (single short word) so
  many fit per row.
- **(b) Chip shows both the facet name and the status
  word side by side.** Rejected: doubles the chip
  width; redundant with the visual encoding; introduces
  a second translation key per status that
  `i18n_methodology_glossary` already covered for the
  four agreement-layer statuses (the chip would
  duplicate `<FacetPill>`'s visual + add a
  prose redundancy).

The status word is still localized — it's reachable
via `methodology.facetState.<status>` for screen
readers (the chip's `aria-label` reads "Classification
proposed" via an ICU template — Decision §10 ships
two new status keys for `committed` and `withdrawn` to
complete coverage).

### §7 — Edge-case: single-facet proposals

A proposal with one facet (e.g. a withdraw-vote — not a
proposal sub-kind; or simply any of the per-sub-kind
single-facet outputs from Decision §1) renders one
chip; no special-casing. The component iterates the
selector's output array and emits one chip per entry;
an array of length 1 renders one chip. The wrapping
container (`<div data-testid="proposal-facet-breakdown">`)
still renders. The Constraints' "no empty container"
rule from sibling refinements doesn't apply because
every proposal — facet-targeting or structural —
emits at least one entry (Decision §1 + §4).

### §8 — Memoization / re-render cost

The breakdown derivation runs per row per render. To
keep cost proportional to the rate of new events:

- The pane computes `facetStatusIndex` ONCE per pane
  render via `useMemo([events], () =>
  computeFacetStatuses(events))`. Same pattern as the
  existing `derivePendingProposals` memoization at
  `PendingProposalsPane.tsx:244`.
- Each row's breakdown derivation runs inside the row
  component via `useMemo([row.proposal,
  facetStatusIndex, serverPerFacetStatus], () =>
  derivePerProposalFacets(...))`. The
  `serverPerFacetStatus` reference comes from the
  `pendingProposals` slice; the reference changes
  only when a new `proposal-status` envelope lands.
- `<ProposalFacetBreakdown>` is memoized via
  `React.memo` so it skips re-render when its props
  reference is stable.

The total re-derivation cost per pane render is
O(events) for the `facetStatusIndex` build + O(rows ×
facets-per-row) for the breakdown derivations. For
typical sessions (~20 rows × 1 facet each) this is
trivial; the bigger cost is the `facetStatusIndex`
walk (O(events)), which is the existing cost of the
graph canvas's facet-pill rendering on the same data,
so adding it to the sidebar adds zero new asymptotic
work — both surfaces share the same memoized
derivation if hoisted to a higher-level provider in
the future (out of scope for this task).

### §9 — `ProposalFacetEntry` shape

The selector emits:

```ts
type LifecycleFacetName = FacetName | 'proposal';

interface ProposalFacetEntry {
  /** The facet this entry targets. `'proposal'` is the
   * synthetic lifecycle facet for structural sub-kinds. */
  readonly facet: LifecycleFacetName;
  /** The resolved status (server frame → client mirror → default). */
  readonly status: FacetStatus;
  /** i18n key for the facet-name label
   * (`methodology.facet.<facet>`). The component calls
   * `t(labelKey)`; the selector does not pre-translate. */
  readonly labelKey: string;
}
```

The shape is minimal: enough for the component to render
the chip, enough for the sibling vote-indicator task to
find the matching `(proposalId, facet)` pair when it
later threads in per-participant votes.

### §10 — i18n: 3 new keys × 3 locales = 9 new catalog entries

The breakdown reuses existing `methodology.facet.*` keys
(`wording`, `classification`, `substance` — shipped by
`i18n_methodology_glossary`) and existing
`methodology.facetState.*` keys for the four
agreement-layer statuses (`proposed`, `agreed`,
`disputed`, `meta-disagreement`).

New keys this task introduces:

1. `methodology.facetState.committed` — "Committed"
   (en-US). The closed-lifecycle "agreed and committed"
   status that `<FacetPill>` already renders visually
   on the graph; this task adds the prose for screen
   readers and the chip's `aria-label`.
2. `methodology.facetState.withdrawn` — "Withdrawn"
   (en-US). The closed-lifecycle "previously committed,
   then a participant withdrew agreement" status; same
   rationale as `committed`.
3. `methodology.facet.proposal` — "Proposal" (en-US).
   The synthetic lifecycle facet name for structural
   sub-kinds (Decision §4).

The `METHODOLOGY_VALUES` constant in
`packages/i18n-catalogs/src/methodology.test.ts` is
extended additively — `facetState: [...existing,
'committed', 'withdrawn']` and
`facet: [...existing, 'proposal']` — so the existing
round-trip test covers the new keys automatically (+9
new round-trip cases: 3 new keys × 3 locales).

Native-review follow-up:
`i18n_per_facet_breakdown_native_review`, effort 0.5d,
depends on `i18n_proposal_list_native_review` (the
latest i18n review task; the chain is sequential per
the existing pattern at
`tasks/35-frontend-i18n.tji:62-140`).

### §11 — Module locations

- Selector: `apps/moderator/src/graph/proposalFacets.ts`.
  Co-located with `facetStatus.ts` and
  `pendingProposals.ts` — the `graph/` folder name is
  historical (per `mod_proposal_list` Decision §11)
  but the pure-walk-over-events / pure-decode-of-payload
  idiom is the same. A future rename to
  `apps/moderator/src/selectors/` becomes plausible if
  a third non-graph selector lands; deferred.
- Component: `apps/moderator/src/layout/ProposalFacetBreakdown.tsx`.
  Sits alongside `PendingProposalsPane.tsx` and
  `RightSidebar.tsx` — the established convention is
  that selectors live under `graph/` and components
  under `layout/`. The component imports the selector;
  the selector imports nothing from the component.
- Shared className map: stays inside
  `apps/moderator/src/graph/FacetPill.tsx` and is
  re-exported as a named export
  (`PILL_STATUS_CLASSNAME`). The sidebar chip imports
  it directly. Rejected alternatives — duplicating the
  map (drift risk Decision §3 calls out) or extracting
  it to a third file (over-engineering for two
  consumers). The current `FacetPill.tsx` already
  defines the constant; this task widens its
  visibility from module-local to a named export.

### §12 — Test layout

- **Unit (Vitest, per ADR 0022)**:
  - `apps/moderator/src/graph/proposalFacets.test.ts`
    — the selector. Cases enumerated in the
    Acceptance criteria.
  - `apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx`
    — the component. Cases enumerated in the
    Acceptance criteria.
  - `apps/moderator/src/layout/PendingProposalsPane.test.tsx`
    — extended with three new cases (multi-facet
    breakdown, server-precedence-via-store-push,
    existing-header-unaffected).
- **E2E (Playwright, per the UI-stream e2e policy)**:
  one new `test()` block in
  `tests/e2e/moderator-capture.spec.ts`, extending the
  pending-proposals row chain. The chain already
  produces a `classify-node` proposal; the breakdown
  should show one `classification` chip at status
  `'proposed'`. The assertion uses `expect.poll` with
  the 10s budget the predecessor test established.
- **No Cucumber scenario.** Pure frontend derivation
  off a WS log; Vitest + Playwright is sufficient
  (same rationale as `mod_proposal_list` Decision
  §10).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Pure selector `derivePerProposalFacets(proposal, facetStatusIndex, serverPerFacetStatus): readonly ProposalFacetEntry[]` lands at `apps/moderator/src/graph/proposalFacets.ts`, with the per-sub-kind facet map from Decision §1 and the server → client-mirror → `'proposed'` precedence from Decision §5. 17 Vitest cases cover all eleven sub-kinds, server precedence, client-mirror fallback, and default-to-`'proposed'` (`apps/moderator/src/graph/proposalFacets.test.ts`).
- Presentational `<ProposalFacetBreakdown row, facetStatusIndex, serverPerFacetStatus />` lands at `apps/moderator/src/layout/ProposalFacetBreakdown.tsx`, memoized via `React.memo`, with the `data-testid="proposal-facet-breakdown"` container + per-chip `data-testid="proposal-facet-row"` / `data-facet-name` / `data-facet-status` seams the sibling vote-indicator task consumes. 14 Vitest cases at `apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx`.
- `<FacetPill>` widens `PILL_BASE_CLASSNAME` and `PILL_STATUS_CLASSNAME` from module-local constants to named exports (`apps/moderator/src/graph/FacetPill.tsx`). This is the **shared seam** Decision §11 calls out: the sibling `mod_vote_indicators_in_sidebar` task may also consume `PILL_STATUS_CLASSNAME` to keep the in-chip vote-dot styling aligned with the graph pill; a future state-styling refinement that touches the graph pill branches automatically updates both sidebar consumers. A drift-guard test in `ProposalFacetBreakdown.test.tsx` asserts the per-status className map matches `PILL_STATUS_CLASSNAME` verbatim.
- `<PendingProposalsPane>` (`apps/moderator/src/layout/PendingProposalsPane.tsx`) grows a second Zustand selector reading `pendingProposals` alongside the existing `events` read, computes `facetStatusIndex` once via memoized `computeFacetStatuses(events)`, and mounts `<ProposalFacetBreakdown>` beneath each row's one-line header (two-line stack per Decision §2). Three new integration cases extend `PendingProposalsPane.test.tsx` (multi-facet render, server precedence via store push, existing-header test ids untouched).
- i18n: 3 new keys × 3 locales = 9 new catalog entries (`methodology.facetState.committed`, `methodology.facetState.withdrawn`, `methodology.facet.proposal`) land in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`; pt-BR + es-419 drafts flagged PENDING in the matching `*.review.json` trackers. `METHODOLOGY_VALUES` in `packages/i18n-catalogs/src/methodology.test.ts` extended additively so the round-trip matrix picks up the new keys automatically. Tech-debt follow-up `i18n_per_facet_breakdown_native_review` registered in `tasks/35-frontend-i18n.tji`.
- Playwright: one new `test()` block in `tests/e2e/moderator-capture.spec.ts` extends the pending-proposals row chain; after the propose lands, the row's `proposal-facet-row[data-facet-name="classification"]` chip is asserted at `data-facet-status="proposed"` with the 10s `expect.poll` budget the predecessor test established.
- Verification: `pnpm run check` green; `pnpm run test:smoke` 3009 passing (+27 from baseline); `pnpm -F @a-conversa/moderator build` green; `chromium-create-session` Playwright project 9/9 green.
