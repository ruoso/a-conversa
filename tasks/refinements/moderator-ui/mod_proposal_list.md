# Moderator right-sidebar pending-proposals list — foundation of the subgroup

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_pending_proposals_pane.mod_proposal_list`.

```
task mod_proposal_list "List of in-flight proposals" {
  effort 1d
  allocate team
}
```

## Effort estimate

**1d.** Confirmed. The deliverable is one selector module (a pure
derivation off the existing `useWsStore.sessionState[sessionId].events`
log), one React component that mounts the derived list into the
right-sidebar's `pendingProposalsSlot`, one wire-up edit in
`<OperateRoute>` to pass the slot, the matching Vitest coverage, one
Playwright `test()` block under `tests/e2e/moderator-capture.spec.ts`,
and the i18n keys + native-review follow-up. Everything else (the
per-facet breakdown, the vote indicators, the commit button, the
filter / search) is a sibling task that consumes this list's row
contract.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing
their public contracts):

- **`moderator_ui.mod_layout.mod_right_sidebar`** (done — 2026-05-11).
  Shipped the stacked-pane shell with three named slots; this task
  fills the `pendingProposalsSlot`. The slot contract is a single
  `ReactNode`; the placeholder copy
  (`moderator.rightSidebar.emptyPanePlaceholder` — "Coming soon")
  disappears the moment the slot is set, regardless of whether the
  derived list is empty. See `apps/moderator/src/layout/RightSidebar.tsx:32-48`
  and the pane wiring at lines 70-86.
- **`moderator_ui.mod_capture_flow.mod_propose_action`** (done —
  2026-05-16, commit landed after `05f7d67`). Shipped the first WS
  write surface in the moderator; a successful propose now writes a
  `proposal` event into `useWsStore.sessionState[sessionId].events`
  via the `event-applied` broadcast subscriber. This task is the
  first reader of those `proposal` events for a non-graph surface;
  the pane closes the visible feedback loop after a successful
  propose. See the Status block at
  `tasks/refinements/moderator-ui/mod_propose_action.md:1889-1935`
  for the wire-shape contract the pane reads.
- **`backend.websocket_protocol.ws_event_broadcast`** (done —
  2026-05-11). Shipped the `event-applied` broadcast that lands every
  appended `session_events` row on every subscribed connection. The
  `event-applied` envelope's `payload.event` is the canonical
  `Event` discriminated union; the pane's selector reads off that
  log. See
  `tasks/refinements/backend/ws_event_broadcast.md`.
- **`backend.websocket_protocol.ws_proposal_status_broadcast`** (done
  — listed in the parent's depends). Shipped the `proposal-status`
  envelope that lands the server-derived `perFacetStatus` for every
  affected proposal whenever a proposal / vote / commit /
  meta-disagreement-marked event flows. The pane uses this surface
  for completeness — the sibling `mod_per_facet_breakdown` is the
  primary consumer; this task uses it only as a lifecycle signal
  (presence of a status frame for the proposal id confirms the
  server saw it). The per-facet rendering is NOT in this task's
  scope. See
  `tasks/refinements/backend/ws_proposal_status_broadcast.md`.
- **`moderator_ui.mod_shell.mod_ws_client`** (done — 2026-05-11). The
  `WsClientProvider` is mounted by `<OperateRoute>` (per
  `mod_propose_action` Decision §3); `useWsStore` carries the
  per-session `events`, `pendingProposals` (the `proposal-status`
  index), and `lastAppliedSequence` slices the pane reads
  (`apps/moderator/src/ws/wsStore.ts:46-68`).
- **`data_and_methodology.event_types.proposal_events`** (done — the
  eleven proposal sub-kinds + the outer `proposalEnvelopePayloadSchema`
  the pane unwraps to render each row).
- **`data_and_methodology.methodology_engine.agreement_state_machine`**
  (done — the `commit` and `meta-disagreement-marked` event kinds the
  pane's "no longer pending" predicate filters on). The five
  `FacetStatus` values (`proposed | agreed | disputed | committed |
  meta-disagreement`) sit underneath the lifecycle definition but
  this task does NOT render per-facet status — that's
  `mod_per_facet_breakdown`'s scope.
- **`frontend_i18n.i18n_date_time_formatting`** (done — 2026-05-11).
  Shipped `formatRelativeTime` / `formatDateTime` in
  `packages/i18n-catalogs/src/format.ts` with per-locale memoization.
  The pane's timestamp display reads through `formatRelativeTime`
  rather than minting bespoke "Xm ago" prose.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)** —
  every empirical check ships as a committed Vitest / Playwright
  case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)** —
  the catalog discipline the four new strings flow through.

Pending edges (this task does NOT depend on them; this task FEEDS
them):

- **`moderator_ui.mod_pending_proposals_pane.mod_per_facet_breakdown`**
  — sibling. Will replace this task's one-line row with a header +
  expanded per-facet body when the per-facet breakdown lands. The
  row's `data-testid` contract (per Decision §3) is the seam.
- **`moderator_ui.mod_pending_proposals_pane.mod_vote_indicators_in_sidebar`**
  — sibling. Reads `useWsStore.sessionState[id].pendingProposals`
  (the per-facet status frames) to render vote indicators inside the
  per-facet row.
- **`moderator_ui.mod_pending_proposals_pane.mod_commit_button`** —
  sibling. Reads per-facet "all agree" predicate; uses this task's
  row as the host for the button.
- **`moderator_ui.mod_pending_proposals_pane.mod_proposal_filter_search`**
  — sibling. Wraps this task's list with a filter / search input.
- **`frontend_i18n.i18n_proposal_list_native_review`** (registered by
  this task; see Acceptance criteria + Decisions). The 4 new pt-BR /
  es-419 drafts land flagged PENDING in the matching `*.review.json`
  trackers; the follow-up replaces them with native-speaker-reviewed
  text.

## What this task is

Land the foundation of the right-sidebar's pending-proposals pane:
a scrollable list, one row per in-flight proposal, newest-first.
The pane closes the visible feedback loop after a successful
propose — the moderator sees the freshly-proposed item appear at
the top of the list within the same `event-applied` broadcast that
the capture pane optimistically-clears on.

Concretely the deliverable is:

- **One new selector module** `apps/moderator/src/graph/pendingProposals.ts`
  exporting `derivePendingProposals(events: readonly Event[]): readonly
  PendingProposalRow[]`. Pure walk over the event log: collect every
  `kind === 'proposal'` envelope; mark a proposal "no longer pending"
  when a `commit` or `meta-disagreement-marked` event references its
  id; emit the surviving set newest-first (descending sequence). Co-
  located with the existing `facetStatus.ts` selector under
  `apps/moderator/src/graph/` because the derivation shape — a pure
  reduce over `useWsStore`'s event log — is the same idiom; future
  selectors for the change-history pane and the diagnostic pane will
  sit in the same directory. The `graph/` folder name is historical
  (the first selectors served the canvas); this is intentionally NOT
  renamed in this task — the rename is a follow-up if a third
  non-graph selector lands.
- **One new component** `apps/moderator/src/layout/PendingProposalsPane.tsx`
  consuming the selector via `useWsStore` + a `useMemo` recompute on
  `events` reference change. Renders an `<ol role="list">` with one
  `<li>` per row; each row carries `data-testid="pending-proposal-row"`
  + `data-proposal-id={proposalEventId}` so sibling tasks can address
  individual rows without re-deriving the selector output. Empty
  state is a localized `"No pending proposals"` paragraph with
  `data-testid="pending-proposals-pane-empty"`.
- **One row sub-component** `<PendingProposalRow>` (co-located in the
  same file — small enough not to warrant its own file in v1).
  Renders, in order: a kind icon / chip (reusing the existing
  `moderator.methodology.kind.*` catalog values for `classify-node`
  proposals; a fallback catalog key `moderator.proposalList.kindLabel.<kind>`
  for the other ten sub-kinds — see Decision §4), the wording or
  payload-summary string (truncated via Tailwind `truncate` at one
  line), the author display (the `actor` UUID's first 8 chars in v1
  — Decision §6 covers the screen-name follow-up), and the timestamp
  via `formatRelativeTime(secondsAgo, 'second')`. NO click handler,
  NO selection state, NO per-facet body — those are sibling-task
  surfaces.
- **One wire-up edit** in `apps/moderator/src/routes/Operate.tsx`:
  pass `pendingProposalsSlot={<PendingProposalsPane sessionId={sessionId} />}`
  to `<RightSidebar>`. The placeholder copy disappears; the empty-state
  row or the rendered list takes its place.
- **Vitest cases** under
  `apps/moderator/src/graph/pendingProposals.test.ts` (selector
  purity, lifecycle filtering, sort order) and
  `apps/moderator/src/layout/PendingProposalsPane.test.tsx` (render
  shape, empty state, row test ids, real-time update via store
  push).
- **One new `test()` block** in `tests/e2e/moderator-capture.spec.ts`
  extending the just-shipped propose-action flow: after the propose
  envelope reaches the server, assert the pending-proposals pane has
  one row whose wording matches the typed string and whose kind
  matches `Fact` (the classification chosen earlier in the chain).
- **4 new i18n catalog keys × 3 locales = 12 new catalog entries**
  scoped under `moderator.proposalList.*`. Decision §7 enumerates the
  keys.
- **1 follow-up tech-debt task registered** in
  `tasks/35-frontend-i18n.tji` (`i18n_proposal_list_native_review`,
  effort 0.5d, `depends !i18n_propose_action_native_review`).

This task is the **first reader of `useWsStore.sessionState[id].events`
outside the graph canvas selectors** — every prior sidebar surface
either rendered chrome (the stack + the three placeholders) or
derived from canvas-scoped state. Closing the visible-feedback loop
for the F1 capture flow's payoff (per `docs/moderator-ui.md:30, 46`)
is what justifies the pane being the foundation of its subgroup.

## Why it needs to be done

Three reasons, in priority order:

1. **The F1 capture flow's payoff is invisible without it.** Per
   `docs/moderator-ui.md:46`, F1 step 4 ends with "The pending-
   proposals pane fills in." Today the propose action lands the
   event on the wire and the server broadcasts it back, but the
   moderator has no visible confirmation other than the optimistic
   capture-pane clear. The pane closes the loop. M4
   (`m_moderator_mvp`) gates on this flow being end-to-end
   observable.
2. **The subgroup's four siblings cannot land without the row
   container.** `mod_per_facet_breakdown`, `mod_vote_indicators_in_sidebar`,
   `mod_commit_button`, and `mod_proposal_filter_search` all consume
   the row contract this task establishes (the `data-testid`, the
   `data-proposal-id`, the row's render-prop seams for the breakdown
   body / commit button / vote indicators). Without the foundation,
   the siblings would race on the row geometry and re-decide the
   selector shape independently — the same pattern
   `mod_right_sidebar` settled at the pane-stack layer applies one
   level down at the per-row layer.
3. **The change-history pane will reuse the selector idiom.** The
   `mod_change_history_pane` task (the third right-sidebar slot)
   will derive a similar reverse-chronological list from the same
   `events` log. Settling the
   "selector-walks-events + component-mounts-into-sidebar-slot"
   pattern here makes the change-history landing a near-copy of this
   shape rather than a fresh design.

## Inputs / context

- [`docs/moderator-ui.md`](../../../docs/moderator-ui.md) lines 29-32
  (the three right-sidebar panes), line 46 (F1 step 4 — "The pending-
  proposals pane fills in"), lines 165-169 (per-participant vote
  indicators appear "in both places" — graph + sidebar — and the
  sidebar is the "focus mode" consolidated list).
- [`apps/moderator/src/layout/RightSidebar.tsx`](../../../apps/moderator/src/layout/RightSidebar.tsx) —
  lines 32-48 declare the three slot props; lines 70-86 wire the
  pane definitions; line 144 is the placeholder fallback that
  disappears once the slot is set. The pane block's `data-testid`
  is `right-sidebar-pane-pending-proposals` and the body's is
  `right-sidebar-pane-body-pending-proposals` — this task's component
  mounts inside the body.
- [`apps/moderator/src/routes/Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx) —
  lines 71-85 declare the `OperateRoute` that wraps `<WsClientProvider>`
  around `<OperateRouteInner>`; line 140 currently passes
  `rightSidebar={<RightSidebar />}` with no slot props. The wire-up
  edit replaces that line with `rightSidebar={<RightSidebar
  pendingProposalsSlot={<PendingProposalsPane sessionId={sessionId} />}
  />}`.
- [`apps/moderator/src/ws/wsStore.ts`](../../../apps/moderator/src/ws/wsStore.ts) —
  lines 46-68 declare `WsSessionState`. The pane reads `events`
  (line 50, the canonical event log this task's selector walks) and
  `pendingProposals` (line 52, the per-facet status frames the
  sibling vote-indicator task consumes). Line 157-176 is the
  `applyEvent` dedup'd writer that the WS client subscriber calls on
  each `event-applied` envelope; the same writer is what makes the
  pane real-time (Decision §8).
- [`packages/shared-types/src/events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts) —
  lines 58-66 declare `statementKindSchema` (the five-way
  classification the kind chip reads); lines 73-79 are the
  `classify-node` shape (`{ kind: 'classify-node', node_id,
  classification: StatementKind }`); lines 297-309 are the
  discriminated union the row resolves to a sub-kind label; lines
  328-332 declare the outer `proposalEnvelopePayloadSchema`'s
  `{ proposal: ProposalPayload }` nesting. The wording string for
  the row's middle column is sub-kind dependent (see Decision §5).
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) —
  lines 480-504 are the `EventEnvelope` shape the selector iterates
  (`id`, `sessionId`, `sequence`, `kind`, `actor`, `payload`,
  `createdAt`); line 141 declares `'proposal'` as one of the
  `eventKinds`; the `commit` and `meta-disagreement-marked` kinds at
  lines 145-146 are the lifecycle terminators the selector filters on.
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) —
  lines 82-87 declare `PendingProposal` (the server-side projection's
  record). The moderator UI does NOT consume this type directly — the
  server's projection is in-process to the server. The client-side
  selector derives its own `PendingProposalRow` shape (Decision §3)
  with the fields the row component renders.
- [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) —
  lines 179-260 are the existing
  selector-walks-events idiom (`computeFacetStatuses`) the new
  selector mirrors structurally: pure single-pass reduce over
  `readonly Event[]`, returning a derived index.
- [`packages/i18n-catalogs/src/format.ts`](../../../packages/i18n-catalogs/src/format.ts) —
  `formatRelativeTime(value, unit, options?)` is the locale-aware
  relative-time helper the row's timestamp column reads through. Per
  `tasks/refinements/frontend-i18n/i18n_date_time_formatting.md` the
  helper memoizes formatter instances and falls back to
  `i18next.language` for the locale tag.
- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) —
  the existing `methodology.kind.{fact,predictive,value,normative,definitional}`
  keys (lines 30-36) are the kind-label catalog the row reuses for
  `classify-node` proposals. The new keys land under
  `moderator.proposalList.*` (Decision §7).
- [`tests/e2e/moderator-capture.spec.ts`](../../../tests/e2e/moderator-capture.spec.ts) —
  lines 591-699 are the propose-action e2e test that this task's new
  `test()` block extends. The session-id parse from URL (lines
  632-635), the propose chain (login → create-session → operate →
  type wording → pick classification → Cmd+Enter), and the
  WS-store probe pattern (lines 657-698) are the seams this task
  reuses.
- [`tasks/refinements/moderator-ui/mod_right_sidebar.md`](mod_right_sidebar.md) —
  the slot contract this task plugs into.
- [`tasks/refinements/moderator-ui/mod_propose_action.md`](mod_propose_action.md) —
  the wire-shape contract (propose emits exactly one `proposal`
  event; the structural entity-creation events fire later on commit)
  the selector relies on. The pane reading `events` filtered by
  `kind === 'proposal'` is consistent with this contract.
- [`tasks/refinements/backend/ws_proposal_status_broadcast.md`](../backend/ws_proposal_status_broadcast.md) —
  the secondary surface (`proposal-status` envelopes) the sibling
  vote-indicator task consumes. This task does NOT render
  `perFacetStatus`; the row uses status-frame presence as an opaque
  "server saw it" signal only.
- [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) —
  the schema-on-write boundary the pane sits on the read side of:
  every event in `useWsStore.sessionState[id].events` is structurally
  valid by construction.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) —
  every empirical check is a committed test.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) —
  the i18n discipline the new catalog keys flow through.

## Constraints / requirements

- **Selector is pure and idempotent.** `derivePendingProposals(events)`
  must be a pure function with no closure over time, no Math.random,
  no `Date.now()`. The relative-time formatting happens at render
  time inside the row component; the selector emits ISO-8601
  `createdAt` strings verbatim from each event envelope.
- **Selector reads only the event log.** The selector does NOT read
  `useWsStore.sessionState[id].pendingProposals` (the per-facet
  status frames) or any server-side projection cache. The event log
  is the authoritative source; status frames are a derived
  convenience the sibling tasks consume separately. Coupling this
  selector to the status frames would make it stop working when the
  server's `proposal-status` broadcast is rate-limited or
  temporarily silent.
- **Selector handles all eleven proposal sub-kinds.** Even though
  only `classify-node` and `set-edge-substance` reach the wire today
  (the only two sub-kinds the capture-flow produces), the selector
  emits a row for every `proposal`-kind event regardless of sub-kind.
  A `decompose`, `axiom-mark`, `meta-move`, etc. proposal landing
  via a future task lights up its row without any selector change.
- **Lifecycle filter is exact.** A proposal exits "pending" when the
  event log contains a `commit` or `meta-disagreement-marked` event
  whose `payload.proposal_id === proposal.id`. A `vote` event does
  NOT remove the proposal from the pending list — even the unanimous-
  agree state is "pending" until the moderator commits. (The commit
  is a separate event with its own `actor` and `createdAt`.)
- **Sort: newest first, by event `sequence` descending.** Sequence
  monotonically increases per session; ties are impossible (the
  sequence is the primary order key). The selector emits the
  newest-proposed item at index 0.
- **Empty state visible from first render.** The pane renders the
  empty-state paragraph immediately on mount — there is no
  loading state for an empty event log. The placeholder copy from
  `mod_right_sidebar`'s slot fallback is no longer involved once
  the slot is filled.
- **Row test id contract.** Each row carries
  `data-testid="pending-proposal-row"` AND
  `data-proposal-id="<proposalEventId>"`. The pane container carries
  `data-testid="pending-proposals-pane"`. The empty-state paragraph
  carries `data-testid="pending-proposals-pane-empty"`. The list
  count badge (Decision §9 — deferred) is OUT of scope for this
  task.
- **Real-time updates.** The pane component subscribes to
  `useWsStore` via the standard Zustand selector pattern; any new
  `proposal` event landing via the `event-applied` broadcast
  triggers a render with the new row at the top. No manual refresh,
  no polling, no debounce — the WS subscriber's `applyEvent` writer
  already coalesces re-renders the right way (the events array
  reference changes on each write).
- **No selection / no click handler.** The row is a non-interactive
  `<li>` in v1. Sibling tasks may add a click handler later (e.g.,
  to expand the per-facet body) without changing the row's surface
  test id; the row stays plain `<li>` here, no `<button>`, no
  `tabIndex`.
- **No `useMemo` over the selector when the events array reference
  is stable.** Use `useMemo([events], () => derivePendingProposals(events))`
  so the derived list reference is stable across renders when the
  log hasn't grown — this keeps siblings' future use of the row
  contract (`React.memo`-wrapped row components, virtualization)
  cheap.
- **Scroll.** The pane body's container (`<RightSidebar>`'s
  `right-sidebar-pane-body-pending-proposals`) is height-bounded by
  the sidebar shell. The pane sets `overflow-y: auto` and
  `max-height: 100%` so the list scrolls inside the slot. No
  bespoke virtualization in v1 — the list is short in practice
  (sessions typically have ≤ ~20 in-flight proposals; the
  per-facet breakdown sibling will rebalance row heights and
  re-evaluate if scrolling perf degrades).
- **i18n.** All user-visible strings (the empty-state paragraph,
  the row's author-prefix label, the kind label for non-`classify-node`
  sub-kinds, the pane container's `aria-label`) flow through
  `useTranslation()` against `@a-conversa/i18n-catalogs`. Relative-time
  prose uses `formatRelativeTime` from the catalogs package — NOT
  bespoke per-locale strings.
- **Author display.** The row's "author" column renders
  `event.actor`'s first 8 chars (UUID-prefix). Decision §6 explains
  why a screen-name resolution is deferred to a follow-up.
- **No business logic.** The pane reads `useWsStore` only. It does
  not touch `wsClient.send`, does not touch the capture store, does
  not subscribe to the methodology engine. It is a pure derived view
  of the event log.
- **Tailwind only.** Consistent with `RightSidebar.tsx`'s palette
  (`text-slate-700`, `text-slate-500`, `bg-slate-100`).

## Acceptance criteria

- `apps/moderator/src/graph/pendingProposals.ts` exports
  `PendingProposalRow` interface (`{ proposalEventId, sequence, kind,
  proposal, actor, createdAt }`) and `derivePendingProposals(events:
  readonly Event[]): readonly PendingProposalRow[]` pure function.
- `apps/moderator/src/graph/pendingProposals.test.ts` (Vitest, per
  ADR 0022) covers: (a) empty input returns empty array; (b) one
  `proposal` event in returns one row; (c) `commit` referencing a
  proposal id removes that proposal from the output; (d)
  `meta-disagreement-marked` referencing a proposal id removes that
  proposal; (e) `vote` does NOT remove the proposal; (f) newest-first
  sort holds across out-of-order insertion; (g) all eleven
  proposal sub-kinds round-trip (one assertion per sub-kind on the
  emitted row's `proposal.kind`); (h) non-proposal event kinds
  (`session-created`, `participant-joined`, `node-created`, etc.)
  are ignored; (i) a `commit` referencing an unknown proposal id is
  a no-op (defensive — should not happen in well-formed logs).
- `apps/moderator/src/layout/PendingProposalsPane.tsx` exports
  `<PendingProposalsPane sessionId: string />` component. The
  component subscribes to `useWsStore.sessionState[sessionId].events`
  and renders the empty state or the `<ol>` with one `<li
  data-testid="pending-proposal-row" data-proposal-id="...">` per
  derived row.
- `apps/moderator/src/layout/PendingProposalsPane.test.tsx` covers:
  (a) empty event log renders the localized empty-state paragraph
  with the expected test id; (b) one `proposal` event in the store
  renders one row with the expected wording / kind / author / timestamp
  test ids; (c) the row's `data-proposal-id` matches the event id;
  (d) two proposals render in newest-first order; (e) after a commit
  event lands, the corresponding row disappears; (f) the pane updates
  on store push (push a `proposal` event into `useWsStore` via
  `applyEvent`; assert the new row appears without re-render-by-hand);
  (g) all eleven proposal sub-kinds resolve to a non-empty kind label
  (the round-trip pin against the new catalog keys); (h) the kind
  chip for `classify-node` proposals reuses the existing
  `methodology.kind.<kind>` catalog values; (i) the row's author
  column renders the 8-char UUID prefix; (j) the timestamp column
  renders through `formatRelativeTime` — assert the formatter is
  called rather than asserting prose (locale-stable test).
- `apps/moderator/src/routes/Operate.tsx` passes
  `pendingProposalsSlot={<PendingProposalsPane sessionId={sessionId} />}`
  to `<RightSidebar>`. The pre-existing `mod_right_sidebar` tests
  remain green (their slot-routing assertion is content-agnostic).
- New i18n keys (`moderator.proposalList.*`) ship in en-US +
  pt-BR / es-419 catalogs. The pt-BR + es-419 drafts are flagged
  PENDING in the matching `*.review.json` trackers; the per-locale
  parity round-trip test pattern asserts each key resolves to a
  non-empty, locale-distinct string in each locale.
- One new `test()` block in `tests/e2e/moderator-capture.spec.ts`
  extends the propose-action chain: after the existing test's
  `Cmd/Ctrl+Enter` propose, assert `getByTestId('pending-proposal-row')`
  has count 1 AND contains the typed wording substring AND its kind
  chip's text matches the en-US `methodology.kind.fact` label
  ("Fact"). The assertion polls with `expect.poll` to tolerate the
  WS round-trip latency, mirroring the existing `__aConversaWsStore`
  probe pattern.
- `i18n_proposal_list_native_review` is appended in
  `tasks/35-frontend-i18n.tji` after
  `i18n_propose_action_native_review` (effort 0.5d, depends on
  `i18n_propose_action_native_review`), wording matching the
  existing pattern (`mod_propose_action`'s entry at lines 126-132
  is the template).
- `pnpm run check`, `pnpm run test:smoke`, and `pnpm -F
  @a-conversa/moderator build` all green.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (after the
  `complete 100` marker the Closer step adds).
- `complete 100` marker added to `mod_proposal_list` in
  `tasks/30-moderator-ui.tji` by the Closer step; the parent
  `mod_pending_proposals_pane` stays open until the remaining four
  siblings land.

## Decisions

### §1 — Data source: derive from `useWsStore.sessionState[id].events`

Three options were on the table; option (b) wins.

- **(a) Read from a server-side projection cache.** The server has
  `PendingProposal` records (`apps/server/src/projection/types.ts:82-87`),
  but they live in-process to the server. Exposing them to the
  client would require a new `pending-proposals` WS broadcast (or
  HTTP endpoint), parallel to the existing `event-applied` and
  `proposal-status` surfaces. Rejected: a new wire surface for data
  that is already on the wire (in raw event form) is duplicate
  plumbing; any drift between the server's projection and the
  client's derivation would surface as silent inconsistency the same
  way the `proposal-status` task warned against.
- **(b) Derive from `useWsStore.sessionState[id].events`.** The
  event log is the authoritative source and is already on the wire
  per the `event-applied` broadcast. A pure selector
  (`derivePendingProposals`) walks it; the pane subscribes via
  Zustand and re-renders on every applied event. Chosen.
- **(c) Read from the capture store's optimistic-add.** The propose
  hook stores the in-flight UUID + content somewhere temporarily.
  Rejected: (1) the capture store resets immediately on optimistic
  clear per `mod_propose_action` Decision §4, so the in-progress
  draft is gone before the server's ack lands; (2) the moderator UI
  receives the server's broadcast of its own propose alongside
  proposals from other participants — the WS-log path is the only
  source that covers both; (3) coupling the pending list to the
  capture flow would block any future actor (a participant proposing
  from a tablet, an audience proposal, a server-emitted system
  proposal) from showing up.

Option (b) is also consistent with the existing
`apps/moderator/src/graph/facetStatus.ts` selector idiom — a pure
walk over `readonly Event[]` returning a derived index — so the
codebase's reduce-over-events vocabulary stays uniform.

### §2 — "In-flight" lifecycle definition

A proposal is in-flight when its `proposal` event has been observed
AND no terminating event referencing its id has been observed.
Terminating events are `commit` and `meta-disagreement-marked`. A
`vote` is NOT terminating: even a unanimous-agree state is
"pending" until the moderator commits.

This matches the server-side projection's `PendingProposal`
lifecycle in `apps/server/src/projection/types.ts:82-87`. A future
"withdrawn-pending-proposal" sub-event (out of scope for v1) would
extend the terminator set; the selector takes a closed enum of
terminator kinds and an open enum of `proposal` sub-kinds, so adding
a terminator is a one-line edit when it lands.

Note: a `commit` for an already-committed proposal is impossible per
the methodology engine (rejected with
`'proposal-already-committed'`); the selector does not need to
defend against double-commit. A `meta-disagreement-marked` for an
already-committed proposal is similarly impossible.

### §3 — Row shape: `PendingProposalRow`

The selector emits one row per surviving proposal with this shape:

```ts
interface PendingProposalRow {
  /** The `proposal` event's id. Matches `vote/commit/meta-disagreement-marked`'s `proposal_id`. */
  proposalEventId: string;
  /** Event sequence (descending sort key). */
  sequence: number;
  /** Outer envelope kind — always `'proposal'`; included for forward-compat with multi-kind row sources. */
  kind: 'proposal';
  /** The proposal payload (the discriminated union over the eleven sub-kinds). */
  proposal: ProposalPayload;
  /** The `event.actor` UUID (nullable per envelope spec; render falls back to a localized "system" label). */
  actor: string | null;
  /** ISO-8601 `event.createdAt` for the timestamp column to format. */
  createdAt: string;
}
```

The fields are the minimum each sibling task needs: the
`proposalEventId` is the row's stable key (and the
`data-proposal-id` attribute); the `proposal` payload is enough for
the per-facet breakdown sibling to compute the target facet; the
`actor` + `createdAt` are the human-readable identity columns. No
`screenName` field — the moderator UI does not yet have a
client-side user-screen-name resolver (Decision §6).

### §4 — Row visual layout: one line, four columns

The row is a single line:

```
[kind chip] [wording / summary, truncated] [author 8-char] [Xm ago]
```

This matches the "list of in-flight proposals" wording from
`docs/moderator-ui.md:30`. The per-facet vote indicators and the
commit button are intentionally absent — siblings own those.

The wording column gets `truncate` (Tailwind: `overflow-hidden
text-ellipsis whitespace-nowrap`); the row's `title` attribute holds
the full wording so hover reveals it. The width split is implicit:
the kind chip is auto-width, the wording column is `flex-1`, the
author + timestamp columns are auto-width on the right.

### §5 — Per-sub-kind summary string

The middle column's prose comes from the proposal payload, picked
sub-kind by sub-kind. The selector emits the full `proposal`
payload; the row component decides per sub-kind what to show:

- `classify-node` — render `<wording fallback to node id prefix>`
  + a `[Fact]` / `[Predictive]` / etc. badge from
  `methodology.kind.<classification>`. Since the moderator UI does
  NOT yet have a client-side node-wording resolver in the pane
  (the canvas owns the per-node wording lookup but the pane is
  decoupled), v1 renders the `node_id` prefix as the summary.
  Decision §6's screen-name follow-up will likely include a
  per-row wording-resolver follow-up.
- `set-edge-substance`, `set-node-substance` — render `Set
  <facet> = <value>` (catalog `moderator.proposalList.summary.setSubstance`).
- `edit-wording` (reword / restructure) — render the proposed
  new wording (the only sub-kind whose payload has a string the
  pane can render verbatim).
- `decompose` / `interpretive-split` — render `Decompose into N
  components` / `Split into N readings` (catalog
  `moderator.proposalList.summary.decompose` / `summary.split`).
- `axiom-mark` — render `Axiom-mark` + the participant 8-char.
- `meta-move` — render `Meta-move: <meta_kind>` with the `content`
  string truncated.
- `break-edge` — render `Break edge`.
- `amend-node` — render the `new_content` string verbatim.
- `annotate` — render `Annotate (<kind>)` + the `content` truncated.

The per-sub-kind summary logic lives inside the row component (not
the selector) — the selector's shape stays minimal so sibling tasks
can compose their own summaries if needed. The catalog keys for the
summary prose land under `moderator.proposalList.summary.*` (Decision
§7 enumerates which keys this task introduces vs which it defers).

### §6 — Author display: 8-char UUID prefix, screen-name deferred

The row's author column renders `event.actor.slice(0, 8)` in v1. The
moderator UI's `useWsStore` does not currently host a per-user
`screenName` resolver (no `userId → screenName` map). The `events`
log carries `participant-joined` events with `screen_name`, so a
selector COULD walk those to build the lookup — but that's a new
selector + a new derived view + a new test surface, and it composes
with the sibling `mod_vote_indicators_in_sidebar` which has its own
need for the same resolver. Pushing the resolver into this task
would multiply scope.

The 8-char prefix is a defensible v1 — it's unambiguous (UUID
collisions on 8 chars are vanishingly rare), it's locale-stable, and
it lets the row land complete enough to fuel its siblings. The
screen-name resolution is registered as future tech-debt:
`mod_pending_proposals_pane_author_screen_name` (effort 0.5d) — to
be registered by the Closer step IF the work is judged
worth-doing-separately (otherwise the per-facet-breakdown sibling
absorbs it).

The fallback for `actor === null` (system-emitted events; not
expected for proposals in v1 but the envelope shape allows it) is a
localized "System" label (`moderator.proposalList.systemAuthor`).

### §7 — i18n keys: 4 new keys × 3 locales = 12 catalog entries

New keys under `moderator.proposalList.*`:

1. `moderator.proposalList.emptyState` — "No pending proposals" (en-US).
2. `moderator.proposalList.paneAriaLabel` — "Pending proposals list" (en-US).
3. `moderator.proposalList.rowAriaLabel` — ICU `"{kind} by {author}, {ago}"` (en-US).
4. `moderator.proposalList.systemAuthor` — "System" (en-US).

The per-sub-kind summary strings (Decision §5) reuse the existing
`methodology.kind.*` keys for `classify-node` and are deliberately
left out of v1 for the other ten sub-kinds (the row's prose
fallback is the payload's literal string where one exists, or a
hard-coded English placeholder for the structural sub-kinds). When
the structural sub-kinds (decompose, axiom-mark, meta-move,
break-edge, amend-node, annotate, set-substance, edit-wording) reach
the wire from their own capture-flow tasks, those tasks register
their own summary catalog keys. This keeps the catalog footprint
proportional to what's actually reachable from the UI today.

Native-review follow-up: `i18n_proposal_list_native_review`, effort
0.5d, depends on `i18n_propose_action_native_review` (the latest
i18n review task; the chain is sequential per the existing pattern).

### §8 — Real-time updates via Zustand subscription

The pane subscribes to `useWsStore` with a selector that reads
`sessionState[sessionId].events`. Zustand's reference-equality check
re-renders only when the events array reference changes, which
happens on each `applyEvent` write (the writer creates a new array
via `[...session.events, event]` per
`apps/moderator/src/ws/wsStore.ts:168`). The pane re-derives the
list via `useMemo([events], () => derivePendingProposals(events))`.

This is the standard Zustand idiom; no extra subscriber, no manual
re-fetch, no polling. The `event-applied` broadcast already drives
the writer; the pane is downstream of the writer.

A subtle case: when the moderator's own propose lands the event,
the moderator sees it appear at the top of the list as part of the
same `event-applied` broadcast that the capture pane uses to confirm
the round-trip. The user-perceived latency between optimistic-clear
and "see your proposal in the pane" is the WS round-trip plus the
React commit, typically tens of ms.

### §9 — Pane chrome (count badge, scroll, sort): in-scope subset

- **Scroll**: in scope. The pane body sets
  `overflow-y: auto; max-height: 100%` so the list scrolls inside
  the slot. The `<RightSidebar>` shell already height-bounds the
  pane via the flex container.
- **Sort**: in scope. Newest-first by event sequence. The selector
  emits the sorted array; the pane renders it in order.
- **Empty state**: in scope. A localized paragraph (Decision §7's
  `emptyState` key) under the empty list.
- **Count badge** ("3 pending proposals" header chip): OUT of
  scope. The pane title comes from `mod_right_sidebar`'s catalog
  key (`moderator.rightSidebar.panes.pendingProposals.title` —
  "Pending proposals"); adding a count badge to that header would
  reach across the slot boundary. Deferred to a follow-up if the
  visual signal turns out to matter; the per-facet-breakdown
  sibling will likely surface it organically.
- **Per-row selection / click-to-focus**: OUT of scope. Siblings
  own row interactivity.
- **Filter / search**: OUT of scope —
  `mod_proposal_filter_search` is a separate sibling.

### §10 — Test layout

- **Unit (Vitest, per ADR 0022)**:
  `apps/moderator/src/graph/pendingProposals.test.ts` covers the
  selector;
  `apps/moderator/src/layout/PendingProposalsPane.test.tsx` covers
  the component. The component test uses React Testing Library
  against a freshly-reset `useWsStore` (the writer's `applyEvent`
  is the seam to push events without mocking the WS client).
- **E2E (Playwright, per the UI-stream e2e policy)**: extend
  `tests/e2e/moderator-capture.spec.ts` with one new `test()`
  block. The pre-existing propose-action test already covers the
  full chain through the dev compose stack; this task's e2e
  block reuses that chain (login → create session → operate →
  type → classify → Cmd+Enter) and adds the post-propose
  assertion (the pending-proposals pane shows the new row). A
  dedicated `tests/e2e/moderator-pending-proposals.spec.ts`
  was considered but rejected — the propose chain is the only
  way to produce a pending proposal from a real user flow today,
  so the assertion belongs in the same file as the chain that
  produces the precondition. Splitting the spec would force the
  new file to re-implement the propose chain (or share via a
  helper that doesn't yet exist) for one assertion's benefit.
- **No Cucumber scenario.** Cucumber + pglite covers backend
  behaviour against a real DB; this task is a pure frontend
  derivation off a WS log. The Vitest + Playwright pair is
  sufficient.

### §11 — Selector module location: `apps/moderator/src/graph/`

The selector lives at `apps/moderator/src/graph/pendingProposals.ts`
co-located with `facetStatus.ts`. The `graph/` folder name is
historical — the first selectors served the canvas — but the
shape (pure walk over `readonly Event[]` returning a derived index)
is identical. A future rename to `apps/moderator/src/selectors/` is
plausible if a third non-graph selector lands; deferred. The
component itself lives at `apps/moderator/src/layout/` alongside the
other sidebar / strip components, matching the existing convention
(selectors and components are in different directories; the
selector imports nothing from the component, the component imports
the selector).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Pure selector landed at [`apps/moderator/src/graph/pendingProposals.ts`](../../../apps/moderator/src/graph/pendingProposals.ts) — `derivePendingProposals(events)` walks the event log, filters proposals terminated by `commit` or `meta-disagreement-marked`, and emits `PendingProposalRow[]` newest-first by sequence (Decisions §1, §2, §3). Co-located with `facetStatus.ts` per Decision §11.
- Pane component landed at [`apps/moderator/src/layout/PendingProposalsPane.tsx`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx) — subscribes to `useWsStore.sessionState[sessionId].events`, memoizes the derived list, renders `<ol>` with one row per pending proposal (kind chip · summary · 8-char author · relative timestamp) plus the localized empty state. Test-id contract honored (`pending-proposals-pane`, `pending-proposal-row` + `data-proposal-id`, `pending-proposals-pane-empty`).
- Wire-up edit in [`apps/moderator/src/routes/Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx) passes `pendingProposalsSlot={<PendingProposalsPane sessionId={sessionId} />}` to `<RightSidebar>`; the placeholder copy gives way to the live pane.
- Vitest coverage: [`apps/moderator/src/graph/pendingProposals.test.ts`](../../../apps/moderator/src/graph/pendingProposals.test.ts) (selector purity, lifecycle filtering, sort order, all eleven sub-kinds, defensive no-ops) and [`apps/moderator/src/layout/PendingProposalsPane.test.tsx`](../../../apps/moderator/src/layout/PendingProposalsPane.test.tsx) (render shape, empty state, real-time store push, test-id contract, formatter wiring). Suite delta: 2887 → 2957 (+70), files 120 → 122.
- E2E coverage: new `test()` block in [`tests/e2e/moderator-capture.spec.ts`](../../../tests/e2e/moderator-capture.spec.ts) extends the propose-action chain to assert the freshly-proposed row appears in the pane with the typed wording and `Fact` chip. `chromium-create-session` Playwright project: 9/9 green.
- i18n: 4 new keys × 3 locales (12 entries) under `moderator.proposalList.*` in [`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`](../../../packages/i18n-catalogs/src/catalogs/); pt-BR and es-419 drafts flagged PENDING in the matching `*.review.json` trackers per the established convention.
- Tech-debt follow-up `i18n_proposal_list_native_review` registered in [`tasks/35-frontend-i18n.tji`](../../35-frontend-i18n.tji) (effort 0.5d, `depends !i18n_propose_action_native_review`). **Rule violation**: the implementer touched the `.tji` file directly to register this follow-up — `.tji` edits are exclusively the Closer's surface per the orchestration policy. Closer verified the addition is shape-correct (matches the `i18n_propose_action_native_review` template line-for-line) so it was left in place; future audits should catch this kind of premature registration earlier.
- `pnpm run check` green; `pnpm run test:smoke` 2957/2957 passing; `tj3 project.tjp` parses silent. `mod_pending_proposals_pane` stays open — four siblings (`mod_per_facet_breakdown`, `mod_vote_indicators_in_sidebar`, `mod_commit_button`, `mod_proposal_filter_search`) still pending, so M4 does not advance from this commit.
