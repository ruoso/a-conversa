# Moderator right-sidebar per-participant vote indicators on each facet chip

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_pending_proposals_pane.mod_vote_indicators_in_sidebar`.

```
task mod_vote_indicators_in_sidebar "Per-participant vote indicators in sidebar" {
  effort 1d
  allocate team
  depends !mod_per_facet_breakdown
}
```

## Effort estimate

**1d.** Confirmed. The deliverable is one selector module (a thin
extension of the already-shipped `derivePerProposalFacets` to carry
per-participant votes through to the chip), one wire-up edit on
`<ProposalFacetBreakdown>` to render the indicator row inside each
chip, the matching Vitest coverage, one new Playwright `test()` block
under `tests/e2e/moderator-capture.spec.ts`, plus the
zero-new-i18n-key reuse of the existing `methodology.voteIndicator.*`
keyspace that `mod_vote_indicators_on_graph` shipped. The per-
participant projection (`projectVotesByFacet`) and the
`<VoteIndicator>` component itself already live on the graph surface
and are reused verbatim (Decisions §2 + §3); the work is plumbing
the existing projection through the sidebar's per-row breakdown.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing
their public contracts):

- **`moderator_ui.mod_pending_proposals_pane.mod_per_facet_breakdown`**
  (done — 2026-05-16, commit `d91063e`). The direct predecessor.
  Landed the per-facet chip row inside each `<PendingProposalRow>`'s
  `<li>` body — the host this task slots indicators INTO. The chip
  carries `data-testid="proposal-facet-row"` +
  `data-facet-name="<facet|proposal>"` +
  `data-facet-status="<status>"`
  (`apps/moderator/src/layout/ProposalFacetBreakdown.tsx:79-90`); the
  selector `derivePerProposalFacets` emits
  `{ facet, status, labelKey }` triples
  (`apps/moderator/src/graph/proposalFacets.ts:62-78`). This task
  extends the selector's output triple to additionally carry
  `votes: readonly Vote[]` and threads the array through to a
  `<VoteIndicator>` row rendered inside each chip (mirroring how
  `<FacetPill>` on the graph already hosts the same indicator row
  inside the pill — see `FacetPill.tsx:96-107`).
- **`moderator_ui.mod_graph_rendering.mod_vote_indicators_on_graph`**
  (done — 2026-05-11). Shipped:
  - `<VoteIndicator>` component at
    `apps/moderator/src/graph/VoteIndicator.tsx` (per-participant
    dot, outer-ring keyed to `axiomMarkColorFor(participantId)`,
    inner fill keyed to `agree`/`dispute`/`withdraw`,
    `data-vote-indicator` + `data-participant-id` + `data-choice`
    seam attributes, localized `aria-label` /  `title` via
    `methodology.voteIndicator.label` + `methodology.voteIndicatorChoice.<arm>`).
  - `projectVotesByFacet(events): Map<string, Map<FacetName, Vote[]>>`
    at `apps/moderator/src/graph/selectors.ts:648-714` — pure single-
    pass projection over the event log; latest vote per
    `(proposal, participant)` wins; insertion order preserves each
    participant's FIRST vote arrival.
  - `Vote` type (`{ participantId, choice }`) and
    `EMPTY_VOTES_BY_FACET` / `EMPTY_VOTES` shared empty references
    at `selectors.ts:585-605`.
  - The four i18n keys this task reuses verbatim:
    `methodology.voteIndicator.label` (ICU template with
    `{participantId}` + `{choice}` substitutions) and
    `methodology.voteIndicatorChoice.{agree,dispute,withdraw}` (the
    verb-form fragments — already shipped in en-US, pt-BR, es-419
    per `packages/i18n-catalogs/src/catalogs/en-US.json:97-104`
    and the matching pt-BR / es-419 catalogs).
  This task is the **second consumer** of the projection + the
  component — Decision §2 commits to mirroring the visual language
  verbatim so the sidebar dots read identically to the graph dots.
- **`moderator_ui.mod_pending_proposals_pane.mod_proposal_list`**
  (done — 2026-05-16, commit `d889e98`). The row container the
  breakdown mounts inside; the pane's Zustand subscription to
  `events` (the projection's input) is already in place at
  `apps/moderator/src/layout/PendingProposalsPane.tsx:209-216`.
  This task adds NO new Zustand subscription — the same `events`
  array the breakdown derives off feeds `projectVotesByFacet`.
- **`backend.websocket_protocol.ws_vote_message`** (done). The
  client-to-server `vote` message handler whose `event-applied`
  broadcast is what lands `vote` events in
  `useWsStore.sessionState[id].events`. The wire payload's three
  arms — `'agree' | 'dispute' | 'withdraw'` — are the closed enum
  the `<VoteIndicator>` component already switches on. See
  `tasks/refinements/backend/ws_vote_message.md`.
- **`backend.websocket_protocol.ws_proposal_status_broadcast`**
  (done). Carries `perFacetStatus` per proposal but **not**
  per-participant vote detail (the wire payload at
  `packages/shared-types/src/ws-envelope.ts:1206-1218` is
  `{ sessionId, proposalId, sequence, perFacetStatus }` only).
  Decision §4 commits to deriving per-participant votes
  client-side from the event log — same approach as the on-graph
  indicator — rather than extending the broadcast wire shape.
- **`data_and_methodology.methodology_engine.agreement_state_machine`**
  (done). The per-participant per-facet vote model the projection
  reflects (`agree` / `dispute` / `withdraw` plus the
  no-vote-yet absence). See
  `tasks/refinements/data-and-methodology/agreement_state_machine.md`.
- **`data_and_methodology.projection.per_facet_status_derivation`**
  (done). The seven derivation rules that aggregate per-participant
  votes into the facet's overall `FacetStatus`. This task doesn't
  re-implement the rules — the per-facet-status surface (the chip's
  border / ring / opacity) is already correct from the predecessor;
  this task adds the per-participant breakdown alongside it.
- **`moderator_ui.mod_graph_rendering.mod_axiom_mark_decoration`**
  (done). Shipped `axiomMarkColorFor(participantId)` + the
  six-bucket per-participant deterministic palette. The
  `<VoteIndicator>` component already imports this; the sidebar
  surface inherits the cross-surface color consistency for free
  (Decision §3 — same participant reads identically on the canvas
  axiom-mark badge, the canvas in-pill vote dot, and the sidebar
  in-chip vote dot).
- **`frontend_i18n.i18n_methodology_glossary`** (done — 2026-05-11).
  Pinned the `methodology.facet.*` + `methodology.facetState.*` +
  `methodology.voteChoice.*` keyspaces this task does NOT extend.
  The `methodology.voteIndicator.*` + `methodology.voteIndicatorChoice.*`
  additions came with `mod_vote_indicators_on_graph` — both pre-
  existing in all three v1 locales (Decision §6 — zero new i18n
  keys in this task).
- **[ADR 0021 — Event envelope as discriminated union](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)** —
  the schema-on-write boundary; every `vote` event in the log is
  structurally valid by construction.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)** —
  every empirical check ships as a committed Vitest / Playwright
  case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)** —
  the catalog discipline the reused indicator keys already flow
  through.

Pending edges (this task FEEDS them; does NOT depend on them):

- **`moderator_ui.mod_pending_proposals_pane.mod_commit_button`** —
  the next sibling. Will surface the "commit this proposal" button
  per row whose enabled/disabled rule reads the per-facet "every
  current participant agreed" predicate. The commit-button task
  could read the predicate off the facet status alone
  (`status === 'agreed'`) — already true today — but the per-
  participant vote indicators this task lands give the moderator
  the at-a-glance answer to "do I have one holdout?" that the
  button enable / disable signal does not surface.
- **`moderator_ui.mod_pw_concurrent_with_moderator`** (registered
  below — pending). The cross-context Playwright spec that drives
  a second authenticated browser as a debater alongside the
  moderator UI. The cross-context "vote-and-see-it-land"
  assertion belongs here (Decision §7 + §8); this task's e2e
  block scopes to the no-vote-yet initial state observable from
  the moderator alone.

## What this task is

Surface **who voted what on which facet** inside the right-sidebar's
per-row per-facet chip row, mirroring the same ambient indicator
language `mod_vote_indicators_on_graph` established on the canvas.
Each per-facet chip (rendered by `<ProposalFacetBreakdown>`) grows
an inline row of small per-participant dots — one dot per
participant who voted on the proposal's targeted facet — color-keyed
identically to the canvas pill so the moderator's recognition
transfers between surfaces (a `disputed` chip with a green +
rose dot pair reads the same in the sidebar and on the graph).

Concretely the deliverable is:

- **One selector extension** in `apps/moderator/src/graph/proposalFacets.ts`:
  `derivePerProposalFacets` grows a fourth `votes: readonly Vote[]`
  field on each `ProposalFacetEntry` (Decision §1). For facet-
  targeting sub-kinds (`classify-node`, `set-node-substance`,
  `set-edge-substance`, `edit-wording`), the `votes` array is the
  per-participant vote list for the matching (nodeId | edgeId,
  facet) pair from the `projectVotesByFacet(events)` index passed
  in as a new parameter. For structural sub-kinds (the synthetic
  `'proposal'` lifecycle entry), the `votes` array is empty
  (Decision §5 — structural proposals don't carry per-(node,
  facet) votes today; a future broadcast tightening can revisit).
  The selector adds ONE new parameter at the tail:
  `votesByFacetIndex: ReturnType<typeof projectVotesByFacet>`.
  Pure addition — calling sites without the new arg pass through
  `new Map()` and the votes array defaults to `EMPTY_VOTES`.
- **One pane wire-up edit** in
  `apps/moderator/src/layout/PendingProposalsPane.tsx`: compute
  `votesByFacetIndex` ONCE per pane render via
  `useMemo([events], () => projectVotesByFacet(events))`, same
  pattern as the existing `facetStatusIndex` memoization at
  `PendingProposalsPane.tsx:236-242`. Pass the index through to
  each `<PendingProposalRow>` and then to its
  `<ProposalFacetBreakdown>` (one new prop on the breakdown).
- **One component edit** in
  `apps/moderator/src/layout/ProposalFacetBreakdown.tsx`: the chip
  span grows an inline indicator row (a `<span>` with
  `data-testid="proposal-facet-vote-indicator-row"`) to the right
  of the localized facet-name label, conditional on
  `entry.votes.length > 0`. The row maps over each `Vote` and
  emits one `<VoteIndicator>` per participant — same component
  the graph pill mounts, no new component (Decision §3). The
  empty-row case (no votes) stays unchanged from the predecessor;
  the chip renders the label only.
- **Selector extensions to existing tests** at
  `apps/moderator/src/graph/proposalFacets.test.ts`: (a) every
  facet-targeting sub-kind's `votes` field defaults to
  `EMPTY_VOTES` when the index is empty; (b) when the index
  carries a vote for the (entityId, facet) pair, the field
  surfaces it; (c) the structural `'proposal'` entry always emits
  empty votes regardless of the index; (d) the selector remains
  pure (calling it twice with the same args returns deep-equal
  results); (e) `set-edge-substance` resolves votes from the
  same index but keyed by `edge_id` (Decision §1 — the index's
  keying scheme is determined by the projection; this task
  extends `projectVotesByFacet` to keep its node-only scope
  AND adds the edge-substance bucket — Decision §4).
- **Component extensions to existing tests** at
  `apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx`:
  (a) chip with no votes renders no indicator row (the
  predecessor's chip shape is preserved); (b) chip with one
  vote renders one `data-vote-indicator` inside the chip;
  (c) chip with three mixed votes renders three indicators with
  distinct `data-choice` values; (d) the indicator row carries
  `data-testid="proposal-facet-vote-indicator-row"` and sits
  inside the chip span (the chip's `data-facet-name` and
  `data-facet-status` attributes are unchanged); (e) the
  per-participant outer-ring color matches the graph
  `<VoteIndicator>`'s ring color for the same participant id
  (drift-guard for the cross-surface consistency contract).
- **Pane integration extensions** at
  `apps/moderator/src/layout/PendingProposalsPane.test.tsx`:
  (a) push a `proposal` + a `vote` event into `useWsStore`
  via the writer pair (`applyEvent`); assert the row's
  breakdown chip grows a single `data-vote-indicator` with
  the expected `data-choice`; (b) two participants on the
  same facet render two indicators in arrival order;
  (c) the chip's `data-facet-status` stays in sync with the
  `<FacetPill>`-equivalent map (no regression).
- **One new `test()` block** in
  `tests/e2e/moderator-capture.spec.ts` extending the just-
  shipped per-facet breakdown assertion: after the propose
  lands, assert that the `proposal-facet-row` chip for
  `classification` has ZERO `data-vote-indicator` children
  (the freshly-proposed item has no votes yet — the no-vote
  baseline). The cross-context vote-and-see-it-land assertion
  is deferred to `mod_pw_concurrent_with_moderator` (Decision
  §7 + §8).
- **Zero new i18n catalog keys** (Decision §6). The four indicator-
  related keys (`methodology.voteIndicator.label` +
  `methodology.voteIndicatorChoice.{agree,dispute,withdraw}`)
  already exist in all three v1 catalogs from
  `mod_vote_indicators_on_graph`; the sidebar consumer reuses
  them verbatim. The `methodology.voteChoice.*` keys (title-case
  nouns) are NOT consumed here.
- **One follow-up tech-debt task registered** in
  `tasks/40-participant-ui.tji` or
  `tasks/30-moderator-ui.tji` —
  `mod_pw_concurrent_with_moderator` — IF it does not already
  exist (Decision §8). A pre-check (see Decision §8) found
  `part_pw_concurrent_with_moderator` already lives at
  `tasks/40-participant-ui.tji:334`; this task does NOT
  register a new one. Instead, this task's deferred e2e debt
  is registered as a note inside the Status block at task
  closure pointing at the existing participant-side task as
  the home for the cross-context vote-and-see-it-land assertion.

This task is the **third leaf of the
`mod_pending_proposals_pane` subgroup** — the foundation
(`mod_proposal_list`) established the row container, the per-facet
breakdown (`mod_per_facet_breakdown`) filled in the per-facet
chips, this task fills the per-participant dots inside each chip;
the remaining two siblings (`mod_commit_button`,
`mod_proposal_filter_search`) build on the chip-with-indicators
shape this task introduces.

## Why it needs to be done

Three reasons, in priority order:

1. **"Decide what to commit next" needs to know who's holding
   out.** The predecessor's per-facet chip tells the moderator
   *whether* the facet is `agreed` / `disputed` / `proposed`. A
   `disputed` facet on a multi-debater session could be
   "one debater disagrees and three agree" (close to commit-ready
   if you discuss the holdout) or "everyone disagrees" (back to
   the drawing board); the chip status alone doesn't
   distinguish. The per-participant indicators surface the
   distribution — the moderator scanning the pane sees both the
   overall status (chip color) and the per-voter detail (dot
   colors) in a single glance.
2. **The sibling commit button reads the same data.** The
   `mod_commit_button` task's enable/disable rule is "every
   facet of this proposal has status === `agreed`", which is
   the chip status. But the *moderator's mental model* of
   "should I push the commit button?" includes "did everyone
   actually vote, or are some participants still silent?" — a
   facet with two agrees and one no-vote-yet stays `proposed`,
   not `agreed`, but the commit-readiness signal is "wait for
   the third vote" rather than "discuss the disagreement". The
   indicator row makes the difference visible.
3. **Cross-surface consistency pays compounding dividends.** The
   graph card's per-pill `<VoteIndicator>` row established the
   visual vocabulary. Mirroring it in the sidebar lets the
   moderator recognize a participant's vote by the dot's
   ring color regardless of which surface they're looking at
   (a participant's dot is the same color on the canvas pill
   and the sidebar chip because both use
   `axiomMarkColorFor(participantId)`). The same logic
   `mod_per_facet_breakdown` Decision §3 used for the per-status
   border color applies here for the per-participant ring color.

## Inputs / context

- [`docs/moderator-ui.md`](../../../docs/moderator-ui.md) lines
  29-32 (the three right-sidebar panes), line 46 (F1 step 4 — "The
  pending-proposals pane fills in"), lines 165-169 — "per-
  participant vote indicators appear in both places (graph +
  sidebar)" is the explicit design intent this task lands the
  second half of (`mod_vote_indicators_on_graph` lands the first
  half).
- [`apps/moderator/src/layout/ProposalFacetBreakdown.tsx`](../../../apps/moderator/src/layout/ProposalFacetBreakdown.tsx)
  — the chip-row component this task extends. The chip span at
  lines 79-90 already carries the per-facet seam attributes; the
  indicator row mounts inside the span between the label
  (`{t(entry.labelKey)}`) and the closing `</span>`, mirroring
  `FacetPill.tsx:96-107`'s shape (`<span data-vote-indicator-row="" className="ml-1 inline-flex items-center gap-0.5">…</span>`).
- [`apps/moderator/src/layout/PendingProposalsPane.tsx`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx)
  — the pane this task adds one selector call to. Lines 209-216
  read `events` + `pendingProposals` via Zustand selectors; lines
  236-242 compute `facetStatusIndex` via memoized
  `computeFacetStatuses(events)`. This task adds an analogous
  `votesByFacetIndex = useMemo([events], () => projectVotesByFacet(events))`
  alongside, and threads the new value through the row component
  to the breakdown.
- [`apps/moderator/src/graph/proposalFacets.ts`](../../../apps/moderator/src/graph/proposalFacets.ts)
  — the selector this task extends. The
  `ProposalFacetEntry` shape at lines 62-78 grows a `votes`
  field. The per-sub-kind `facetTargetOf` helper at lines 86-117
  already returns the `(entityKind, entityId, facet)` triple this
  task uses to index into `votesByFacetIndex`; for `set-edge-
  substance` the entity is an edge (Decision §4 covers the
  index extension to edges).
- [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts)
  — lines 575-714 are the existing
  `projectVotesByFacet(events): Map<string, Map<FacetName, Vote[]>>`
  + the `Vote` type + the `EMPTY_VOTES_BY_FACET` / `EMPTY_VOTES`
  shared empty references. **The projection is currently node-
  only** (the `voteTargetOf` switch at lines 613-627 returns
  `null` for `set-edge-substance`); Decision §4 commits to
  extending it to include edge-substance for the sidebar surface
  (the graph surface's edge pill render is out of scope for that
  decision; the projection extension is additive and does not
  affect the graph consumer because the graph reads
  `votesByFacet[facet]` on node data only).
- [`apps/moderator/src/graph/FacetPill.tsx`](../../../apps/moderator/src/graph/FacetPill.tsx)
  — the graph pill that already hosts the in-pill indicator row.
  Lines 96-107 are the row shape this task mirrors in the
  sidebar chip — same `ml-1 inline-flex items-center gap-0.5`
  spacing; same one-`<VoteIndicator>`-per-`Vote` map.
- [`apps/moderator/src/graph/VoteIndicator.tsx`](../../../apps/moderator/src/graph/VoteIndicator.tsx)
  — the component this task reuses verbatim. Imports
  `axiomMarkColorFor(participantId)` for the outer ring; switches
  on `choice` for the inner fill; renders
  `data-vote-indicator="" data-participant-id=… data-choice=…
  role="img" aria-label=… title=…`. Already memo'd.
- [`apps/moderator/src/ws/wsStore.ts`](../../../apps/moderator/src/ws/wsStore.ts)
  — the per-session `events` slice (line 50) the projection
  reads. No new writer; vote events already land via the
  existing `applyEvent` path (line 157-176).
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts)
  — `votePayloadSchema` (`proposal_id`, `participant`, `vote`,
  `voted_at`) is the wire shape the projection reads off
  `event.payload`. No new fields needed; the projection's
  `(participantId, choice)` shape already matches the indicator
  component's prop shape.
- [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts)
  — lines 1206-1218 are the `ProposalStatusPayload` schema; the
  payload's `perFacetStatus` field is what the predecessor task
  reads through. **The payload does NOT carry per-participant
  vote detail** — Decision §4 covers why this task derives votes
  client-side rather than extending the wire schema.
- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json)
  — lines 97-104 declare the `methodology.voteIndicator.label` +
  `methodology.voteIndicatorChoice.*` keys this task reuses
  verbatim. No new keys, no native-review follow-up.
- [`tests/e2e/moderator-capture.spec.ts`](../../../tests/e2e/moderator-capture.spec.ts)
  — lines 828-885 are the just-landed per-facet-breakdown
  Playwright block this task extends. The chain produces a
  `classify-node` proposal whose row's `classification` chip
  carries the indicator row; with no votes yet the row has
  zero indicators (the assertion this task adds).
- [`tasks/refinements/moderator-ui/mod_per_facet_breakdown.md`](mod_per_facet_breakdown.md)
  — the predecessor refinement; the chip seam this task threads
  indicators into is documented in its Decisions §3 + §11.
- [`tasks/refinements/moderator-ui/mod_vote_indicators_on_graph.md`](mod_vote_indicators_on_graph.md)
  — the parallel refinement on the graph surface; the visual
  vocabulary this task mirrors (`axiomMarkColorFor` outer ring,
  `bg-emerald-500` / `bg-rose-500` / `bg-slate-400` inner fill,
  the `aria-label` ICU template) lives in its Decisions.
- [`tasks/refinements/backend/ws_vote_message.md`](../backend/ws_vote_message.md)
  — the wire shape that lands `vote` events in the log.
- [`tasks/refinements/backend/ws_proposal_status_broadcast.md`](../backend/ws_proposal_status_broadcast.md)
  — the per-facet status broadcast (does NOT carry per-
  participant detail).
- [`tasks/refinements/data-and-methodology/agreement_state_machine.md`](../data-and-methodology/agreement_state_machine.md)
  — the per-participant per-facet vote model the projection
  reflects.
- [`tasks/refinements/data-and-methodology/per_facet_status_derivation.md`](../data-and-methodology/per_facet_status_derivation.md)
  — the seven rules that aggregate votes into status (this task
  does not re-implement; the chip status is correct from the
  predecessor).

## Constraints / requirements

- **Selector remains pure.** The extended
  `derivePerProposalFacets(proposal, facetStatusIndex,
  serverPerFacetStatus, votesByFacetIndex)` stays a pure function
  with no closure over time, no `Date.now()`, no `Math.random()`.
  The `votes` array on each entry is read from the projected index
  (which is itself pure off the event log) — no new effects.
- **Re-use `<VoteIndicator>` verbatim.** No new component, no
  fork. The sidebar mounts the same component the graph mounts;
  the component's import surface (`axiomMarkColorFor`,
  `useTranslation`) carries over unchanged. Decision §3 — drift-
  guard test asserts the rendered DOM matches the graph's
  per-participant ring color for the same `participantId`.
- **Indicator row inside the chip, right of the label.** Mirrors
  the in-pill row from `FacetPill.tsx:96-107` — `ml-1 inline-flex
  items-center gap-0.5` spacing. The chip's existing `data-facet-
  name` / `data-facet-status` / `data-testid` attributes are
  unchanged; the row carries
  `data-testid="proposal-facet-vote-indicator-row"` (a sidebar-
  specific name distinct from the graph's
  `data-vote-indicator-row` so test selectors can target one
  surface at a time, but the inner `<VoteIndicator>` children
  carry the cross-surface `data-vote-indicator` sentinel).
- **Empty-row omission.** Chips for facets with no votes render
  the label only — no empty indicator-row container (mirrors
  `FacetPill.tsx:96-100`'s `votes.length > 0 ? row : null`).
  Structural sub-kinds' synthetic `'proposal'` chip also has no
  row (always — Decision §5).
- **Votes index built once per pane render.** Same memoization
  pattern as `facetStatusIndex` in `PendingProposalsPane.tsx`:
  `const votesByFacetIndex = useMemo([events], () =>
  projectVotesByFacet(events))`. Per-row `<ProposalFacetBreakdown>`
  re-renders only when its `(row.proposal, facetStatusIndex,
  serverPerFacetStatus, votesByFacetIndex)` tuple changes;
  `React.memo` on the component (already in place) gates the
  re-render.
- **`projectVotesByFacet` extended to include edge-substance.**
  Today the projection's `voteTargetOf` (lines 613-627) returns
  `null` for `set-edge-substance`. Decision §4 commits to
  extending it to cover edges — the sidebar surface renders
  edge-substance proposals as one chip per the breakdown's
  per-sub-kind switch (`apps/moderator/src/graph/proposalFacets.ts:108-110`
  — `set-edge-substance` resolves to a `substance` facet on an
  edge target). The projection extension is additive and keyed
  by edgeId; existing graph consumers (which read
  `votesByFacet[facet]` on node data only) are unaffected. The
  consumer in `proposalFacets.ts` indexes into the same map via
  the `entityId` field from `facetTargetOf` regardless of
  whether the entity is a node or an edge (Decision §4).
- **Withdraw renders as a gray dot.** Same semantics as the graph
  indicator — `withdraw` is methodologically meaningful (the
  participant agreed, then retracted) so the dot stays as a
  record with `bg-slate-400`. The chip's overall status (the
  facet may have moved back to `disputed` per the per-facet
  derivation) is the orthogonal signal at the chip level.
- **i18n.** Zero new keys (Decision §6). The reused indicator
  keys' aria-label template (`"Participant {participantId} voted
  {choice}"`) is read by the component verbatim; the
  participantId substitution is the raw UUID for now (the
  participants-projection screen-name resolution is shared
  tech-debt with the graph surface — see
  `mod_vote_indicators_on_graph` Decision on the
  participant-id raw display).
- **Accessibility.** The reused `<VoteIndicator>` already carries
  `role="img"` + a localized `aria-label` + a `title` attribute
  for hover. The sidebar inherits these for free.
- **Tailwind only.** Consistent with the sidebar palette and the
  reused indicator component classes.

## Acceptance criteria

- `apps/moderator/src/graph/proposalFacets.ts` exports an extended
  `ProposalFacetEntry` interface with a `readonly votes: readonly
  Vote[]` field (the existing `facet` / `status` / `labelKey`
  fields are unchanged). The `derivePerProposalFacets(proposal,
  facetStatusIndex, serverPerFacetStatus, votesByFacetIndex)`
  signature grows a fourth parameter:
  `votesByFacetIndex: Map<string, Map<FacetName, readonly Vote[]>>`.
  For facet-targeting sub-kinds, `votes` is
  `votesByFacetIndex.get(entityId)?.get(facet) ?? EMPTY_VOTES`;
  for structural sub-kinds (synthetic `'proposal'` entry),
  `votes` is `EMPTY_VOTES`.
- `apps/moderator/src/graph/proposalFacets.test.ts` (Vitest, per
  ADR 0022) is extended with: (a) each of the four facet-
  targeting sub-kinds threads a vote through when the index
  carries one for the matching (entityId, facet) pair; (b)
  `set-edge-substance` resolves votes off the same map keyed by
  `edge_id`; (c) the `'proposal'` synthetic entry always emits
  `EMPTY_VOTES` regardless of the index; (d) an empty index
  yields `EMPTY_VOTES` for every entry; (e) the function remains
  pure (calling it twice with the same args returns deep-equal
  outputs); (f) two participants on the same facet surface in
  arrival order (the projection's order is preserved through
  the selector).
- `apps/moderator/src/graph/selectors.ts` extends `voteTargetOf`
  to additionally return a target for `set-edge-substance`
  (Decision §4). The shape grows to
  `{ entityKind: 'node' | 'edge'; entityId: string; facet: FacetName } | null`;
  the projection's per-`(entityId, facet)` accumulator stays
  the same outer-map structure (`Map<string, Map<FacetName,
  Vote[]>>`) — node and edge ids share the keyspace because
  UUIDs don't collide across entity types.
- `apps/moderator/src/graph/selectors.test.ts` is extended with:
  (a) a `set-edge-substance` proposal + a `vote` event surfaces
  on the projection under the edge_id key; (b) the existing
  node-keyed cases continue to pass without modification
  (`projectVotesByFacet` regression suite is preserved).
- `apps/moderator/src/layout/ProposalFacetBreakdown.tsx` accepts
  a new `votesByFacetIndex` prop. The chip span renders a
  `<span data-testid="proposal-facet-vote-indicator-row"
  className="ml-1 inline-flex items-center gap-0.5">` row inside
  itself when `entry.votes.length > 0`, mapping each `Vote` to
  one `<VoteIndicator participantId={vote.participantId}
  choice={vote.choice} />`. When `entry.votes.length === 0`, no
  row is rendered (the chip stays in its predecessor shape).
- `apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx`
  covers: (a) a chip with empty votes renders no
  `proposal-facet-vote-indicator-row`; (b) a chip with one vote
  renders one `data-vote-indicator` inside the chip span;
  (c) a chip with three mixed votes (agree + dispute +
  withdraw) renders three indicators with distinct `data-choice`
  values; (d) the indicator row's `data-testid` is
  `proposal-facet-vote-indicator-row` (sidebar-specific) but
  the inner `<VoteIndicator>` children carry the
  cross-surface `data-vote-indicator` sentinel; (e) the per-
  participant ring color matches the graph's `<VoteIndicator>`
  for the same `participantId` (drift-guard via a direct
  comparison render of two `<VoteIndicator>`s with the same
  prop); (f) the chip's `data-facet-name` /
  `data-facet-status` / `data-testid="proposal-facet-row"`
  attributes are unchanged (the predecessor's seam contract
  is preserved).
- `apps/moderator/src/layout/PendingProposalsPane.tsx` adds a
  third `useMemo` for `votesByFacetIndex` and threads it
  through each `<PendingProposalRow>` to its
  `<ProposalFacetBreakdown>`. The existing two
  Zustand subscriptions (`events`, `pendingProposals`) are
  unchanged.
- `apps/moderator/src/layout/PendingProposalsPane.test.tsx` is
  extended with: (a) push `proposal` + `vote` events into
  `useWsStore` via `applyEvent`; assert the row's breakdown
  chip grows one `data-vote-indicator` with `data-choice="agree"`;
  (b) two participants voting on the same facet render two
  indicators in arrival order; (c) the chip's `data-facet-status`
  remains correct (no regression from the predecessor's
  facet-status assertions).
- One new `test()` block in `tests/e2e/moderator-capture.spec.ts`
  extends the per-facet-breakdown chain: after the propose
  lands, assert the `classification` chip's
  `proposal-facet-vote-indicator-row` either is absent OR has
  zero `data-vote-indicator` children (the no-vote-yet baseline
  — Decision §7). Uses `expect.poll` with the same 10s budget
  as the predecessor. **The cross-context vote-and-see-it-land
  assertion is explicitly OUT of scope** and registered as
  deferred-e2e debt against
  `participant_ui.part_pw_concurrent_with_moderator`
  (`tasks/40-participant-ui.tji:334`) — Decision §8.
- No new i18n catalog keys (Decision §6). The reused
  `methodology.voteIndicator.label` +
  `methodology.voteIndicatorChoice.*` keys' catalog parity is
  already established by `mod_vote_indicators_on_graph`.
- No new `i18n_*_native_review` task registered (Decision §6).
- `pnpm run check`, `pnpm run test:smoke`, and `pnpm -F
  @a-conversa/moderator build` all green.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (after
  the `complete 100` marker the Closer step adds).
- `complete 100` marker added to `mod_vote_indicators_in_sidebar`
  in `tasks/30-moderator-ui.tji` by the Closer step; the parent
  `mod_pending_proposals_pane` stays open until the remaining
  two siblings (`mod_commit_button`,
  `mod_proposal_filter_search`) land.

## Decisions

### §1 — What "vote indicator" means in the sidebar: per-participant dots inside the chip

Three options were on the table; option (a) wins.

- **(a) Per-participant colored dot inside each facet chip
  (compact, ambient).** Chosen. One dot per voter, outer ring
  keyed to the participant via `axiomMarkColorFor(participantId)`,
  inner fill keyed to the vote arm (emerald = agree, rose =
  dispute, slate = withdraw). The chip's facet-name label
  reads left-of-dots; the dots read right-of-label. Mirrors
  `<FacetPill>` on the graph (`FacetPill.tsx:96-107`) so the
  sidebar reads the same as the canvas — the moderator learns
  one vocabulary, sees it everywhere.
- **(b) Initials chips ("DA: agree, DB: dispute") inside each
  facet chip.** Rejected: (1) doubles the chip width per voter,
  breaking the at-a-glance scannability the predecessor's
  Decision §2 ("always-shown but compact") committed to; (2)
  the participants-projection screen-name resolver does not
  yet exist (per `mod_proposal_list` Decision §6), so the
  initials would degrade to UUID prefixes — less informative
  than a colored dot whose ring already encodes the participant
  deterministically; (3) breaks visual symmetry with the graph
  pill, which uses dots — would force the moderator to learn
  two vocabularies for the same data.
- **(c) Tally summary ("1 agree / 1 dispute") per chip.**
  Rejected: (1) loses per-participant detail (the moderator
  cannot tell *which* participant is holding out); (2) the
  predecessor's chip status already encodes the aggregate
  signal (a `disputed` chip means "at least one dispute"),
  so adding a tally duplicates the status-encoding;
  (3) breaks visual symmetry with the graph pill.

Option (a) is also the option the user's brief explicitly
preferred for the same recognition-transfer reason.

### §2 — Visual consistency with `<FacetPill>` on the graph (mirror verbatim)

The sidebar chip's indicator row mirrors the graph pill's
indicator row 1:1:

| Element | Sidebar chip | Graph pill |
| --- | --- | --- |
| Row container | `<span data-testid="proposal-facet-vote-indicator-row" className="ml-1 inline-flex items-center gap-0.5">` | `<span data-vote-indicator-row="" className="ml-1 inline-flex items-center gap-0.5">` |
| Indicator | `<VoteIndicator participantId={…} choice={…} />` | `<VoteIndicator participantId={…} choice={…} />` |
| Outer ring color | `axiomMarkColorFor(participantId).ring` | same |
| Inner fill (agree) | `bg-emerald-500` | same |
| Inner fill (dispute) | `bg-rose-500` | same |
| Inner fill (withdraw) | `bg-slate-400` | same |
| Empty-row omission | yes — no `<span>` when `votes.length === 0` | yes |

The only intentional divergence is the row container's
`data-testid` (sidebar) vs `data-vote-indicator-row` data-
attribute (graph) — the two surfaces need to be addressable
independently in tests, and the sidebar follows the
predecessor's `data-testid` convention while the graph pill
inherited the `data-*` attribute convention from its earlier
ancestry. The inner `<VoteIndicator>` children both carry the
cross-surface `data-vote-indicator` sentinel, so a test
selecting `[data-vote-indicator][data-participant-id="<uuid>"]`
hits both surfaces alike.

Two options were on the table; option (a) wins.

- **(a) Reuse `<VoteIndicator>` verbatim.** Chosen. Cross-
  surface consistency for free; same component import; future
  styling refinements to the indicator propagate to both
  surfaces in the same commit; same drift-guard test pattern
  the predecessor's `PILL_STATUS_CLASSNAME`-mirror used.
- **(b) Fork a sidebar-specific `<SidebarVoteIndicator>`.**
  Rejected: drift risk + zero reason to diverge.

### §3 — Data source: derive per-participant votes client-side from the event log

Three options were on the table; option (b) wins.

- **(a) Extend the `proposal-status` broadcast wire shape to
  carry per-participant votes.** Rejected: (1) the broadcast is
  already shipping per-facet status (the aggregate); per-
  participant detail is a different layer; (2) extending the
  wire schema requires a server-side change + a re-roll of the
  shared-types contract + every reader's schema update — a
  meaningfully bigger task than this one; (3) the server's
  `proposal-status` broadcast is already firing the right set
  of events (proposal / vote / commit / meta-disagreement-
  marked) per `ws_proposal_status_broadcast.md` — clients
  re-deriving from the event log adds zero new network round-
  trips; (4) the graph surface already derives client-side
  via `projectVotesByFacet(events)` for exactly this reason
  (per `mod_vote_indicators_on_graph` Decision rationale); the
  sidebar should match the graph's approach.
- **(b) Derive client-side from `useWsStore.sessionState[id].events`
  via the existing `projectVotesByFacet`.** Chosen. The
  projection is already implemented (it ships with
  `mod_vote_indicators_on_graph`); the only extension is the
  one-line addition of `set-edge-substance` to its
  `voteTargetOf` switch (Decision §4). Client-side derivation
  is consistent with the graph surface; both surfaces stay in
  sync because they read from the same event log via the same
  projection.
- **(c) Read per-participant detail from a new dedicated
  broadcast (e.g., `vote-recorded`).** Rejected: the existing
  `event-applied` broadcast already carries the `vote` event
  envelope (with `participant` + `vote` arm); a parallel
  broadcast would duplicate the on-wire payload.

The client-side projection is `O(events)` per pane render
(memoized on the events reference) — the same asymptotic cost
the graph canvas already pays for `projectVotesByFacet`. Adding
the sidebar consumer adds zero new asymptotic work; the two
surfaces share the same memoized result if hoisted to a
higher-level provider in the future (out of scope for this
task — same deferred-rebase note from `mod_per_facet_breakdown`
Decision §8).

### §4 — Extend `projectVotesByFacet` to cover edge-substance

The shipped `projectVotesByFacet` is **node-only** today (the
`voteTargetOf` switch at
`apps/moderator/src/graph/selectors.ts:613-627` returns `null`
for `set-edge-substance` because the graph surface's edge
pill render is out of scope for the on-graph indicator task).
The sidebar surface, however, renders one chip per pending
proposal regardless of entity kind — including for
`set-edge-substance` proposals — and the predecessor's
selector emits a `substance` facet entry on an edge target
(`apps/moderator/src/graph/proposalFacets.ts:108-110`). To
surface votes on edge-substance proposals in the sidebar, the
projection needs to bucket edge-keyed votes too.

Two options were on the table; option (a) wins.

- **(a) Extend `projectVotesByFacet` to additionally bucket
  `set-edge-substance` votes under the edge_id key.** Chosen.
  Node ids and edge ids are UUIDs — disjoint keyspaces — so
  sharing the outer-map key is safe. The graph consumer
  (which reads `votesByFacet[facet]` on node-data only) is
  unaffected because it never looks up edge ids in the map.
  The sidebar consumer (this task) reads
  `votesByFacetIndex.get(entityId)?.get(facet)` where
  `entityId` comes from `facetTargetOf` and may be a node
  id or an edge id — both resolve correctly through the
  same lookup.
- **(b) Add a separate `projectEdgeVotesByFacet` projection.**
  Rejected: same shape, same walk, same single-pass — splitting
  the projection doubles the walk cost without any payoff.
  The sidebar consumer would have to merge two indices at
  read time; the graph consumer would never read the edge
  one. Single projection wins on simplicity.

The extension also touches `voteTargetOf`'s return type:
`{ nodeId: string; facet: FacetName }` becomes
`{ entityKind: 'node' | 'edge'; entityId: string; facet: FacetName }`,
matching `facetTargetOf` in
`apps/moderator/src/graph/proposalFacets.ts:81-117`. The
projection's downstream accumulator uses `entityId` as the
outer-map key regardless of `entityKind` (UUID-disjoint
keyspaces — see above). A migration note: the existing graph
consumer (which reads the projection in
`apps/moderator/src/graph/GraphCanvasPane.tsx` per
`mod_vote_indicators_on_graph` Status) needs no change because
its lookup is `votesByFacetIndex.get(nodeId)` — node UUIDs
still resolve to the node bucket; edge UUIDs (newly populated)
simply aren't looked up by the graph consumer.

### §5 — Structural sub-kinds: synthetic `'proposal'` chip has no indicator row

The structural sub-kinds (decompose, interpretive-split,
axiom-mark, meta-move, break-edge, amend-node, annotate) emit
one synthetic `'proposal'` lifecycle chip per the predecessor's
Decision §4. These proposals do not target a per-(node, facet)
pair, so `projectVotesByFacet` records no votes for them. The
chip's `entry.votes` array is therefore always `EMPTY_VOTES`,
and the indicator row is omitted (mirrors the empty-row
omission rule).

This is consistent with the graph surface — the structural
sub-kinds don't render a `<FacetPill>` for the proposal
either (the on-graph indicator only applies to
node-facet-targeting sub-kinds), so the sidebar's structural
chip naturally has no indicator row too.

A future broadcast tightening to fan out structural-proposal
votes (out of scope today — per
`ws_proposal_status_broadcast.md` the structural sub-kinds
are skipped) would land per-participant detail through the
same projection, at which point the synthetic chip could
grow an indicator row by changing the `EMPTY_VOTES` default
to a real lookup. Today the default is the right answer.

### §6 — i18n: zero new keys (full reuse of the graph surface's vocabulary)

The `<VoteIndicator>` component already reads through:

- `methodology.voteIndicator.label` — ICU template with
  `{participantId}` + `{choice}` substitutions
  (`packages/i18n-catalogs/src/catalogs/en-US.json:97-99`).
- `methodology.voteIndicatorChoice.agree` — "agree" verb form
  (line 101).
- `methodology.voteIndicatorChoice.dispute` — "dispute" verb
  form (line 102).
- `methodology.voteIndicatorChoice.withdraw` — "withdraw"
  verb form (line 103).

All four keys exist in all three v1 locales (en-US / pt-BR /
es-419) from `mod_vote_indicators_on_graph` (Status line
covers the catalog parity at 131 keys across all three
locales). The sidebar consumer reads through the same
component which reads through the same keys. Zero new keys
this task introduces; zero pt-BR / es-419 drafts to flag
PENDING; zero `i18n_*_native_review` follow-up to register.

Two options were on the table; option (a) wins.

- **(a) Reuse existing `methodology.voteIndicator.*` keyspace
  via the shared `<VoteIndicator>` component.** Chosen.
- **(b) Introduce sidebar-specific keys (e.g.
  `moderator.proposalList.voteIndicator.*`).** Rejected: a
  per-surface keyspace would force pt-BR / es-419 reviewers
  to re-review identical prose; the user-facing string is
  identical between surfaces (the indicator IS the same
  component on both surfaces) so the catalog should match
  too. Reuse via the shared component is the correct seam.

### §7 — E2E test scope: assert no-vote-yet baseline only; defer cross-context vote assertion

Two options were on the table; option (b) wins.

- **(a) Drive a second authenticated browser context as a
  debater, vote, assert moderator sees the indicator land.**
  Rejected for this task. The cross-context wiring (login two
  users, subscribe both to the same session, drive one
  context to cast a vote while the other observes) is a
  meaningful additional Playwright fixture scope — the
  current `moderator-capture.spec.ts` is single-context
  throughout. The cross-context surface belongs in the
  dedicated `part_pw_concurrent_with_moderator` task
  (`tasks/40-participant-ui.tji:334`), which already
  registers the participant-tablet-in-parallel-with-
  moderator-UI Playwright work.
- **(b) Drive the moderator UI only and assert the no-vote-
  yet baseline.** Chosen. After the propose lands, the
  `classification` chip's `proposal-facet-vote-indicator-row`
  is absent (zero votes → no row). The assertion proves
  the negative case lands correctly; the positive case
  (vote arrives → indicator appears) is unit-tested at
  Vitest level (`PendingProposalsPane.test.tsx` extension
  pushes `applyEvent` directly to simulate the vote).

The Vitest-level coverage is sufficient for the per-
participant rendering contract because the boundary
between "vote on the wire" and "store reflects vote" is
fully unit-testable via `useWsStore.applyEvent`; the
Playwright assertion would essentially re-test the same
contract through a more expensive harness.

### §8 — Deferred e2e debt: registered against `part_pw_concurrent_with_moderator`

The pre-existing task
`participant_ui.part_pw_concurrent_with_moderator`
(`tasks/40-participant-ui.tji:334`) already scopes the
cross-context Playwright work — driving a participant
tablet in parallel with the moderator UI. The cross-
context "vote-and-see-it-land" assertion this task defers
naturally belongs there:

1. The participant tablet is the natural surface to cast a
   vote from (the moderator UI does not currently expose a
   vote button — voting comes from the participant tablet
   per the methodology).
2. The participant tablet's Playwright suite is the home
   for cross-context fixtures (two authenticated contexts,
   shared session subscription) that this task's deferred
   assertion needs.

Two options were on the table; option (a) wins.

- **(a) Register the deferred assertion as a note in this
  task's Status block (at closure) pointing at
  `part_pw_concurrent_with_moderator` as the home.**
  Chosen. The Closer step appends a note like "deferred e2e
  debt: cross-context vote-and-see-it-land in the moderator
  sidebar — to be covered by
  `part_pw_concurrent_with_moderator` when it lands." The
  existing task's scope already includes the round-trip
  assertion; no new task creation needed.
- **(b) Register a new dedicated
  `mod_pw_vote_indicator_in_sidebar_cross_context` task.**
  Rejected: duplicates the existing task's scope; adds a
  task with effort < 0.25d that would be folded into
  `part_pw_concurrent_with_moderator` anyway. The note-in-
  Status approach keeps the WBS tight.

### §9 — Order of indicators inside a chip: arrival order (the projection's existing rule)

The shipped `projectVotesByFacet` preserves each
participant's FIRST vote arrival order in the per-facet list
(`apps/moderator/src/graph/selectors.ts:638-643` — "insertion
order preserves each participant's FIRST vote on that
facet"). The graph pill renders in this order; this task
inherits the order via the shared projection.

Three options were on the table; option (a) wins.

- **(a) Arrival order (the projection's existing rule).**
  Chosen. Cross-surface consistency with the graph pill
  (same projection, same order). The order is also stable
  across agree↔dispute switches — a participant doesn't
  jump to the end of the row when they switch arms, which
  preserves moderator recognition of "the third dot is
  Alice's" through a vote change.
- **(b) Role order (moderator-first, then debaters by join
  order).** Rejected: (1) the moderator is the committer,
  not a voter — the methodology engine's vote handler
  rejects votes from the moderator role; so the moderator's
  dot would never appear in the row anyway; (2) the
  participant-role projection does not yet exist on the
  client-side moderator UI; landing one in this task would
  triple scope; (3) cross-surface consistency with the
  graph pill matters more than per-row ordering rules.
- **(c) Alphabetical by participant id.** Rejected: UUID
  prefixes have no human meaning; alphabetical-by-UUID is
  alphabetical-by-noise; provides zero ordering signal.

### §10 — Real-time updates: shared with the existing pane subscription

The pane already subscribes to
`useWsStore.sessionState[sessionId].events` (per the
predecessor's wire-up). Adding the `votesByFacetIndex` as a
third `useMemo` keyed on the same `events` reference means
the index recomputes on every applied event — including
every `vote` event — and the breakdown re-renders with the
fresh votes through the existing `useMemo` chain in
`<ProposalFacetBreakdown>`. No new Zustand subscription, no
new writer, no manual refresh. Same pattern the predecessor's
Decision §8 settled.

### §11 — Module locations

- Selector extension: in-place in
  `apps/moderator/src/graph/proposalFacets.ts` — same module
  as the predecessor's selector.
- Projection extension: in-place in
  `apps/moderator/src/graph/selectors.ts` — same module as
  the existing `projectVotesByFacet`.
- Component edit: in-place in
  `apps/moderator/src/layout/ProposalFacetBreakdown.tsx` —
  the chip-row component grows a child inside the chip span.
- Pane edit: in-place in
  `apps/moderator/src/layout/PendingProposalsPane.tsx` — one
  new `useMemo` + one new prop passed through.
- No new files; no new directories. The shared
  `<VoteIndicator>` component is imported across the
  layout / graph boundary (the sidebar already imports
  `PILL_BASE_CLASSNAME` + `PILL_STATUS_CLASSNAME` from the
  graph surface per the predecessor's Decision §11, so the
  cross-boundary import precedent is set).

### §12 — Test layout

- **Unit (Vitest, per ADR 0022)**:
  - `apps/moderator/src/graph/proposalFacets.test.ts` —
    extended with the `votes`-field cases (per Acceptance
    criteria).
  - `apps/moderator/src/graph/selectors.test.ts` — extended
    with the edge-substance projection case.
  - `apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx`
    — extended with the indicator-row cases and the
    cross-surface ring-color drift-guard.
  - `apps/moderator/src/layout/PendingProposalsPane.test.tsx`
    — extended with the store-push real-time update cases.
- **E2E (Playwright, per the UI-stream e2e policy)**: one
  new `test()` block in `tests/e2e/moderator-capture.spec.ts`
  asserting the no-vote-yet baseline (Decision §7).
- **No Cucumber scenario.** Pure frontend derivation off a
  WS log; Vitest + Playwright is sufficient (same rationale
  as the predecessor's Decision §12).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Per-participant `<VoteIndicator>` dots now render inside each `<ProposalFacetBreakdown>` chip via a new `data-testid="proposal-facet-vote-indicator-row"` row (mirrors `<FacetPill>` 1:1) at `apps/moderator/src/layout/ProposalFacetBreakdown.tsx`; chips with zero votes omit the row (per Decisions §2 + §5).
- `derivePerProposalFacets` in `apps/moderator/src/graph/proposalFacets.ts` grew a fourth `votesByFacetIndex` parameter (defaulted to empty for back-compat) and `ProposalFacetEntry` gained a `readonly votes: readonly Vote[]` field; new exported `VotesByFacetIndex` type.
- `PendingProposalsPane.tsx` gained a third `useMemo` for `votesByFacetIndex = projectVotesByFacet(events)` threaded through `<PendingProposalRow>` to the breakdown; no new Zustand subscription (shares the existing `events` slice per Decision §10).
- `projectVotesByFacet` in `apps/moderator/src/graph/selectors.ts` now buckets `set-edge-substance` votes alongside node-keyed votes (Decision §4); the outer-map key was renamed from `nodeId` to `entityId` and the projection's voteTargetOf now returns `{ entityKind, entityId, facet }`.
- **Contract change for future consumers:** `voteTargetOf` migrated from `{ nodeId, facet }` to `{ entityKind: 'node' | 'edge'; entityId: string; facet: FacetName }` (Decision §4). Existing graph consumers (`votesByFacetIndex.get(nodeId)`) keep working because node and edge UUIDs share a disjoint keyspace, but any new consumer reading the projection should treat the outer-map key as an entity id (node or edge) rather than a node id.
- Vitest test-count delta: 3009 → 3031 (+22); coverage added in `apps/moderator/src/graph/{selectors,proposalFacets}.test.ts` and `apps/moderator/src/layout/{ProposalFacetBreakdown,PendingProposalsPane}.test.tsx`, including a cross-surface ring-color drift-guard (per Decision §2).
- Playwright: one new `test()` block in `tests/e2e/moderator-capture.spec.ts` asserts the no-vote baseline on the freshly-proposed `classification` chip (zero `data-vote-indicator` children, zero `proposal-facet-vote-indicator-row`); `chromium-create-session` project remains 10/10.
- Zero new i18n keys (full reuse of `methodology.voteIndicator.*` + `methodology.voteIndicatorChoice.*` per Decision §6); zero new `i18n_*_native_review` follow-ups registered.

NOTE — Deferred e2e debt (per Decision §8): the cross-context "vote-and-see-it-land" assertion (drive a debater context to cast a vote, observe the indicator land on the moderator sidebar) is carried by the pre-existing `participant_ui.part_pw_concurrent_with_moderator` task at `tasks/40-participant-ui.tji:334`. No new task registered.
