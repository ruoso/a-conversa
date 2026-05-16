# Moderator pending-proposals commit button — the closing move of the propose→vote→commit loop

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_pending_proposals_pane.mod_commit_button`.

```
task mod_commit_button "Commit button per proposal — enabled only when all agree" {
  effort 1d
  allocate team
  depends !mod_vote_indicators_in_sidebar, backend.websocket_protocol.ws_commit_message
}
```

## Effort estimate

**1d.** Confirmed. The deliverable is a small per-row button +
inline-error region wired into the existing
`<PendingProposalRow>` header, one new colocated hook
(`useCommitAction`) that mirrors the established
`useProposeAction` shape against the already-shipped
`client.send('commit', payload)` seam, one tiny module-scoped
Zustand slice (`useCommitStore`) tracking the in-flight set
keyed by `proposalId`, the selector extension to
`derivePerProposalFacets` that surfaces an `allAgree` boolean
per row, the matching Vitest coverage, one new Playwright
`test()` block under `tests/e2e/moderator-capture.spec.ts`,
plus a small `moderator.commitButton.*` i18n namespace
(7 chrome keys + 1 reason key under
`moderator.commitButton.reason.*` = 8 keys × 3 locales = 24
catalog entries). The hook+button pattern is mechanical —
the propose-side analog (`useProposeAction` +
`<ProposeAction>`) is the template; this task substitutes
`commit` for `propose`, swaps the wire shape per
`ws_commit_message.md:34-38`, and constrains the enablement
gate to the all-agree predicate (Decision §1).

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing
their public contracts):

- **`moderator_ui.mod_pending_proposals_pane.mod_vote_indicators_in_sidebar`**
  (done — 2026-05-16, immediate predecessor). Landed
  `projectVotesByFacet(events)` as a memoized pane-level
  computation
  (`apps/moderator/src/layout/PendingProposalsPane.tsx:298`) plus
  the per-row `<ProposalFacetBreakdown>` chip with in-chip
  `<VoteIndicator>` dots. This task extends
  `derivePerProposalFacets` to additionally surface a per-proposal
  `allAgree: boolean` (Decision §1) computed off the same
  `votesByFacetIndex` the breakdown already reads. No new
  projection; pure additive selector output.
- **`moderator_ui.mod_pending_proposals_pane.mod_per_facet_breakdown`**
  (done — 2026-05-16). Established the chip's
  `data-facet-name` / `data-facet-status` seam attributes
  (`apps/moderator/src/layout/ProposalFacetBreakdown.tsx:146-156`)
  and the per-row breakdown derivation
  `derivePerProposalFacets(proposal, facetStatusIndex,
  serverPerFacetStatus, votesByFacetIndex)`
  (`apps/moderator/src/graph/proposalFacets.ts:257-299`) this
  task extends with the `allAgree` per-proposal predicate
  (Decision §1).
- **`moderator_ui.mod_pending_proposals_pane.mod_proposal_list`**
  (done — 2026-05-16, commit `d889e98`). Established
  `<PendingProposalRow>` with the `data-testid="pending-proposal-row"`
  + `data-proposal-id` seam attributes
  (`apps/moderator/src/layout/PendingProposalsPane.tsx:228-256`)
  the new button mounts inside. The row header is where the
  button lands (Decision §2 — option (a)).
- **`moderator_ui.mod_capture_flow.mod_propose_action`**
  (done — 2026-05-16). The propose-side analog. This task
  mirrors its hook+component split (`useProposeAction`
  →`useCommitAction`; `<ProposeAction>` → in-row button),
  optimistic-clear → pessimistic-wait shape (Decision §5 —
  commit is NOT optimistic), and the wire-error inline
  surfacing pattern (Decision §6). See
  `apps/moderator/src/layout/useProposeAction.ts` and
  `apps/moderator/src/layout/ProposeAction.tsx`.
- **`backend.websocket_protocol.ws_commit_message`**
  (done — 2026-05-11). Shipped the server-side `commit`
  handler with the subscribe-before-act gate, the moderator
  authority gate (`not-a-moderator` rejection enforced by the
  engine), the all-agree predicate (`unanimous-agree-required`
  rejection), the `appendSessionEvent` write, the
  `committed` ack + `event-applied` broadcast dual signal,
  and the `rejectedToApiError`-mapped wire-error path. The
  wire shape is settled:
  `wsCommitPayloadSchema = { sessionId, expectedSequence, proposalId }`
  with NO `moderatorId` field
  (`packages/shared-types/src/ws-envelope.ts:534-540`) — the
  server reads the moderator id from the authenticated
  connection. The ack shape is
  `committedPayloadSchema = { sessionId, sequence, eventId }`
  (`packages/shared-types/src/ws-envelope.ts:550-554`). This
  task drives the handler from the moderator UI side; the
  wire contract is settled. See
  `tasks/refinements/backend/ws_commit_message.md`.
- **`moderator_ui.mod_shell.mod_ws_client`** (done —
  2026-05-11). Shipped `createWsClient` +
  `WsClient.send('commit', ...)` (the typed send surface at
  `apps/moderator/src/ws/client.ts:419-465`; `commit` is
  already in the closed union per
  `packages/shared-types/src/ws-envelope.ts:116`) +
  `WsClientProvider` + `useWsClient()` + `useWsStore`. The
  WS client's pending-request map already correlates the
  `committed` ack via `inResponseTo`
  (`apps/moderator/src/ws/client.ts:14, 301-308`); the
  `committed` envelope type is already in
  `wsMessagePayloadSchemas` and `WsMessagePayloadMap`
  (`packages/shared-types/src/ws-envelope.ts:1244, 1282`).
  This task is the first call site of
  `client.send('commit', ...)` from the moderator UI surface;
  everything earlier was test-only.
- **`data_and_methodology.methodology_engine.commit_logic`**
  (done — 2026-05-10). Pinned the four engine-side commit
  rules (moderator gate; proposal exists; proposal is
  pending; unanimous agree across current participants for
  the four facet-targeting sub-kinds; structural sub-kinds
  deferred with `'illegal-state-transition'`). This task's
  client-side enablement gate (Decision §1) reads the same
  predicate as engine rule 4 — they compute the all-agree
  signal independently and must stay consistent by
  construction. See
  `tasks/refinements/data-and-methodology/commit_logic.md:78-84`.
- **`data_and_methodology.projection.per_facet_status_derivation`**
  (done — 2026-05-10). The seven derivation rules that
  aggregate per-participant votes into the facet's overall
  `FacetStatus`. Rule 6 ("every current participant has
  voted agree → `agreed`") is the read-side analog of the
  enablement gate this task surfaces; the chip's
  `data-facet-status="agreed"` is the cross-check signal
  the moderator already sees via the predecessor's
  breakdown. See
  `tasks/refinements/data-and-methodology/per_facet_status_derivation.md:75-83`.
- **`data_and_methodology.methodology_engine.agreement_state_machine`**
  (done). The per-participant per-facet vote model the
  projection reflects (`agree` / `dispute` / `withdraw` plus
  the no-vote-yet absence) — what
  `projectVotesByFacet(events)` already buckets per
  (entityId, facet) and what this task's `allAgree`
  predicate reads. See
  `tasks/refinements/data-and-methodology/agreement_state_machine.md`.
- **`backend.websocket_protocol.ws_event_broadcast`** (done —
  2026-05-11). The `event-applied` broadcast carries the
  appended `commit` event to every subscriber including the
  moderator. The moderator's own
  `useWsStore.applyEvent(event)` reducer
  (`apps/moderator/src/ws/wsStore.ts:157`) reduces the
  `commit` event into the local projection; the row
  disappears naturally because `derivePendingProposals`
  filters out proposals whose id has been referenced by a
  `commit` event
  (`apps/moderator/src/graph/pendingProposals.ts:7-12`).
  This task's pessimistic-wait shape (Decision §5) relies on
  this — no manual store mutation; the broadcast removes the
  row.
- **`backend.websocket_protocol.ws_proposal_status_broadcast`**
  (done). Carries the post-commit `perFacetStatus` map per
  proposal but is NOT required for the row-disappearance
  signal (the pure-event-log derivation handles it). See
  `tasks/refinements/backend/ws_proposal_status_broadcast.md`.
- **`frontend_i18n.i18n_keyboard_shortcuts_policy`** (done —
  the english-mnemonic / locale-independent shortcut policy).
  This task adds NO new keyboard shortcut (Decision §9 —
  commit is click-only; no chord).
- **`frontend_i18n.i18n_library_choice`** /
  **`frontend_i18n.i18n_catalog_workflow`** /
  **`frontend_i18n.i18n_locale_negotiation`** /
  **`frontend_i18n.i18n_testing`** (done — the
  `useTranslation()`, the parity-check script, the
  `*.review.json` PENDING-flag lifecycle, the per-locale
  parity round-trip test pattern are all in place).
- **[ADR 0021 — Event envelope: discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)**
  — the schema-on-write boundary the moderator's send-path
  crosses via `serializeWsEnvelope`.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)**
  — every empirical check ships as a committed Vitest /
  Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)**
  — the `useTranslation()` API the new component consumes.

Pending edges (this task FEEDS them; does NOT depend on them):

- **`moderator_ui.mod_pending_proposals_pane.mod_proposal_filter_search`**
  (sibling, not yet landed). Will wrap the pane's list with
  a filter / search input over the same row contract; the
  per-row commit button this task lands stays inside each
  row regardless of the filter outer wrap. No coupling.
- **`participant_ui.part_pw_concurrent_with_moderator`** —
  the existing cross-context Playwright task at
  `tasks/40-participant-ui.tji:334` (the same carrier
  `mod_vote_indicators_in_sidebar` Decision §8 routed its
  deferred-e2e debt against). This task's "click commit →
  see the committed event land on the graph and on every
  subscribed client" cross-context assertion belongs there
  (Decision §10).
- **`frontend_i18n.i18n_commit_button_native_review`**
  (registered by this task — see Decision §8 + Acceptance
  criteria). The pt-BR + es-419 drafts of the 8 new keys
  land flagged PENDING; the follow-up replaces them with
  native-speaker-reviewed text.

## What this task is

Land the **closing move** of the moderator's propose→vote→commit
loop on the sidebar surface: a per-row commit button inside each
`<PendingProposalRow>` that is enabled iff every counted
participant has voted `agree` on every facet of the proposal, and
that fires the canonical `commit` envelope through the existing
WS-write seam when clicked. The button is the visible affordance
for the moderator's structural authority — committing a proposal
moves it from `pendingProposals` to `committedProposals` (per
`commit_logic.md:13`), marks the affected facet `agreed` on the
read-side projection, and causes the row to disappear from the
pane naturally as the `event-applied` broadcast lands.

Concretely the deliverable is:

- **One selector extension** in
  `apps/moderator/src/graph/proposalFacets.ts`: alongside the
  existing per-row `ProposalFacetEntry[]` output, add a single
  pure function `deriveAllAgree(entries: readonly
  ProposalFacetEntry[], currentParticipantIds: ReadonlySet<string>):
  CommitGate` returning a discriminated tag — either
  `{ ok: true }` (every entry has every current participant
  voting `'agree'`) or `{ ok: false, reason: CommitGateReason }`
  (one of the documented blocking conditions per Decision §1).
  Pure; reads only the entries the breakdown already derived
  plus the current-participants set.
- **One projection extension** in the same module: a small
  helper `deriveCurrentParticipants(events: readonly Event[]):
  ReadonlySet<string>` that walks the event log once per pane
  render (memoized on the same `events` reference as the
  existing `votesByFacetIndex`) collecting every
  `participant-joined` event whose participant has NOT
  subsequently emitted a `participant-left` event. Returns the
  set of currently-joined participant ids (excluding the
  moderator's own id — Decision §1.a explains why). Same module
  / same idiom as the existing `derivePerProposalFacets`.
- **One new hook** `apps/moderator/src/layout/useCommitAction.ts`
  — colocated with the layout components (mirrors
  `useProposeAction.ts`). Reads the row's `proposalEventId`
  passed in as a hook arg, reads the per-session
  `lastAppliedSequence` from `useWsStore`, reads the WS client
  from `useWsClient()`, exposes `{ commit, inFlight, lastError }`
  for the button to render. Per-proposalId in-flight tracking
  comes from a small module-scoped `useCommitStore` Zustand
  slice (Decision §7).
- **One new module-scoped store slice**
  (colocated in `useCommitAction.ts`):
  `useCommitStore` with a `committing: ReadonlySet<string>` (set
  of in-flight `proposalId`s) + `setCommitting(proposalId,
  flag)` setter + `errors: ReadonlyMap<string, WireError>` +
  `setError(proposalId, error | undefined)` setter. Module-
  scoped (NOT a React provider) so two simultaneous button
  clicks on two different rows correctly observe disjoint
  in-flight state. Mirrors the
  `useProposeErrorStore` pattern from `useProposeAction.ts:120-128`.
- **One in-row button** mounted into `<PendingProposalRow>` —
  small, right-aligned in the row header (Decision §2). The
  button is created inline inside the row component (NO new
  file — the surface is small enough that a separate component
  file would be ceremony; mirrors how the row's existing
  chip / summary / author / timestamp spans live inline). The
  button reads `useCommitAction(proposalEventId)` and surfaces
  the four visual states from Decision §3 (disabled-with-gate-
  tooltip / enabled / in-flight / error).
- **One pane-level extension** in
  `apps/moderator/src/layout/PendingProposalsPane.tsx`: compute
  `currentParticipantIds` ONCE per pane render via a third
  `useMemo([events], () => deriveCurrentParticipants(events))`
  alongside the existing `facetStatusIndex` and
  `votesByFacetIndex` memos, thread it through each
  `<PendingProposalRow>` (one new prop). No new Zustand
  subscription — the same `events` slice the other two memos
  read.
- **Vitest cases** covering the gate-derivation predicate, the
  hook in isolation against a stubbed `useWsClient`, the
  in-row button rendering under each of the four visual states,
  and the pane-level integration that pushes
  `proposal` + `vote` + `vote` events into `useWsStore` and
  asserts the button enables / clicking it sends the canonical
  envelope.
- **One new `test()` block** in
  `tests/e2e/moderator-capture.spec.ts` asserting the disabled
  baseline on a freshly-proposed row (no votes yet → gate
  blocks → button is `disabled`). The cross-context
  "vote-from-both-debaters → click commit → see committed
  event land" assertion is registered as deferred-e2e debt
  against the pre-existing `participant_ui.part_pw_concurrent_with_moderator`
  task (Decision §10).
- **8 new i18n catalog keys × 3 locales = 24 new catalog
  entries** under a new `moderator.commitButton.*` namespace
  (Decision §8). The pt-BR + es-419 drafts land flagged
  PENDING in `*.review.json`; one new
  `i18n_commit_button_native_review` task is registered in
  `tasks/35-frontend-i18n.tji` by the Closer.

This task is the **last leaf of `mod_pending_proposals_pane`'s
commit half** — the four prior leaves
(`mod_proposal_list`, `mod_per_facet_breakdown`,
`mod_vote_indicators_in_sidebar`, plus this task) close the
visible feedback loop after a successful commit; the remaining
sibling `mod_proposal_filter_search` is independent and feeds
on the same row contract.

## Why it needs to be done

Three reasons, in priority order:

1. **The propose→vote→commit loop is incomplete without
   commit.** The moderator can propose (via
   `mod_propose_action`); the debaters can vote (via
   `ws_vote_message` and the participant tablet); both surfaces
   reflect each other through the pending-proposals pane and
   the graph canvas. But the moderator currently has no UI to
   close the loop. Without a commit button, every proposal sits
   in `pendingProposals` forever — the canonical methodology
   transition from `agreed` to `committed` is unreachable from
   the moderator console. This is the LAST seam.
2. **The button is the explicit moderator-authority surface.**
   Per `commit_logic.md:13-15` / `docs/methodology.md:15-25`
   only the moderator commits; the commit is the
   structural-not-interpretive enactment of agreement that
   every participant has expressed. The pane's per-facet
   breakdown (`mod_per_facet_breakdown`) and per-participant
   indicators (`mod_vote_indicators_in_sidebar`) give the
   moderator the information to decide; this button is the
   gesture that exercises the authority. Hiding the gesture
   inside a global menu or a graph-canvas right-click would
   obscure the moderator-authority signal — the per-row
   surface makes the authority visible exactly where the
   moderator is reading "is this ready?"
3. **Every downstream "commit-driven" flow waits on this
   surface.** The moderator MVP milestone
   (`m_moderator_mvp` in `tasks/99-milestones.tji`) needs a
   demoable propose→vote→commit cycle; the cross-context
   participant tablet → moderator commit round-trip
   (`part_pw_concurrent_with_moderator`) needs the click
   target this task lands. Without the button, the
   moderator surface stops at "the pane fills in" — the loop
   has no closing move.

## Inputs / context

Code seams the implementation plugs into (real file paths,
verified against the working tree):

- `apps/moderator/src/layout/PendingProposalsPane.tsx:205-256` —
  the `<PendingProposalRow>` host. The row header at lines
  234-247 is the mount point (Decision §2). The pane-level
  memoization pattern at lines 282, 289, 298 is what the
  `currentParticipantIds` third `useMemo` mirrors.
- `apps/moderator/src/layout/ProposalFacetBreakdown.tsx:86-159` —
  the per-row breakdown component. The `votesByFacetIndex`
  prop threading at line 91 + the
  `derivePerProposalFacets(...)` call at lines 102-111 is the
  per-row data source the all-agree predicate reads from;
  this task does NOT modify the breakdown component itself
  (the all-agree predicate is derived per-row in the row
  component, not inside the breakdown).
- `apps/moderator/src/graph/proposalFacets.ts:257-299` — the
  selector this task extends. The
  `ProposalFacetEntry.votes` field
  (lines 79-95) is the per-(entity, facet) vote array the
  all-agree predicate folds over.
- `apps/moderator/src/graph/selectors.ts:592-595` — the
  `Vote` type (`{ participantId, choice: 'agree' | 'dispute' |
  'withdraw' }`) the predicate switches on.
- `apps/moderator/src/graph/selectors.ts:670-714` —
  `projectVotesByFacet(events)`. Already memoized at the
  pane level (`PendingProposalsPane.tsx:298`). Reused
  verbatim; no extension this task.
- `apps/moderator/src/layout/useProposeAction.ts` — the
  propose-side analog. Decision §4 — the commit hook mirrors
  this file's shape: module-scoped Zustand error slice, hook
  reading `useWsClient` + `useWsStore`, send-promise
  awaiting the `committed` ack, snapshot-on-error inline
  surface. Differences: per-proposal-id keying (vs. session-
  global propose), pessimistic-wait (vs. optimistic clear —
  Decision §5), no validation gate beyond the all-agree
  predicate (validation IS the gate — Decision §1).
- `apps/moderator/src/layout/ProposeAction.tsx` — the
  propose-side button component. The visual states (label
  switch on in-flight, `disabled` + `aria-disabled` parity,
  inline error region with `role="alert"`, the secondary-
  surface Tailwind palette) are the template this task's
  in-row button copies. Differences: no `<kbd>` chip
  (Decision §9 — no keyboard shortcut); button is sized
  smaller (per-row compact rather than primary-action
  prominent); no validation-error region distinct from the
  wire-error region (the gate's tooltip is the validation
  surface; the wire-error region is only the
  failure-after-action surface).
- `apps/moderator/src/ws/client.ts:419-465` — the typed
  `WsClient.send('commit', payload)` surface. Returns a
  Promise resolving with the `committed` ack envelope or
  rejecting with `WsRequestError` / `WsRequestTimeoutError`.
  Already typed because `'commit'` is in the
  `wsMessageTypes` closed union
  (`packages/shared-types/src/ws-envelope.ts:116`).
- `apps/moderator/src/ws/wsStore.ts:46-68, 78-185` — the
  per-session `lastAppliedSequence` slice this task reads
  for the `expectedSequence` token, plus the
  `events: Event[]` slice the `currentParticipantIds` memo
  walks. The `applyEvent` reducer (line 157) is the writer
  that reduces the broadcast `commit` event into the local
  projection — no extension needed (the existing reducer
  handles it; the row disappears because
  `derivePendingProposals`
  (`apps/moderator/src/graph/pendingProposals.ts:7-12`)
  filters out committed proposals).
- `apps/moderator/src/ws/WsClientProvider.tsx:57-85` — the
  provider this task's hook consumes via `useWsClient()`.
  No change.
- `packages/shared-types/src/ws-envelope.ts:534-540` —
  `wsCommitPayloadSchema = { sessionId: uuid,
  expectedSequence: int>=0, proposalId: uuid }`. The
  payload shape this task constructs. No `moderatorId`
  field (per `ws_commit_message.md` Decisions — the server
  reads moderator id from the connection).
- `packages/shared-types/src/ws-envelope.ts:550-554` —
  `committedPayloadSchema = { sessionId: uuid, sequence:
  int>0, eventId: uuid }`. The ack shape the send-promise
  resolves with.
- `packages/shared-types/src/ws-envelope.ts:1235, 1244,
  1273, 1282` — the `commit` / `committed` entries already
  registered in `wsMessagePayloadSchemas` and
  `WsMessagePayloadMap`. No shared-types edit.
- `apps/server/src/ws/handlers/commit.ts` — the server-side
  handler. Inspected for the rejection-code vocabulary
  this task surfaces inline; the engine's
  `'not-a-moderator'`, `'unanimous-agree-required'`,
  `'proposal-already-committed'`,
  `'proposal-already-meta-disagreement'`,
  `'proposal-not-found'`, `'illegal-state-transition'`
  rejection reasons map through `rejectedToApiError` to
  the wire `error` envelope's `code` field. No server-side
  edit.
- `apps/moderator/src/graph/pendingProposals.ts:100-130` —
  the existing `derivePendingProposals(events)` selector
  that the pane already reduces via. Decision §5 relies on
  this — the post-commit `commit` event lands via the
  `event-applied` broadcast, the selector reduces it
  (lines 110-119 collect the terminated set), the
  surviving rows are returned without the now-committed
  proposal, and the pane re-renders with the row gone.
- `tests/e2e/moderator-capture.spec.ts:1-485` — the
  sibling spec. The new `test()` block joins the existing
  suite (Decision §10 — option (a) in the e2e scope; (b)
  registered as deferred-e2e debt against
  `part_pw_concurrent_with_moderator`).
- `tests/e2e/fixtures/wsStoreSeed.ts:97-179` — the
  `seedWsStore` + `isWsStoreReachable` helpers the new
  e2e block follows the precedent of. Decision §10
  records: the no-vote baseline does NOT need
  `seedWsStore` (the propose-then-observe chain already
  drives the state); the cross-context vote-and-see-it-
  enable case (registered as deferred debt) would need
  it.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — the
  catalog file the new `moderator.commitButton.*`
  namespace lands in, sibling to the existing
  `moderator.proposeAction.*` /
  `moderator.proposalList.*` /
  `moderator.captureTextInput.*` blocks.

DESIGN.md / docs consulted:

- `DESIGN.md:16-20` — *"All participants — both debaters
  and the moderator — must agree on every change to the
  graph before it lands."* The commit button is the
  moderator's gesture that lands a change after all-agree.
- `DESIGN.md` (pending proposals pane section) — the
  pane's purpose is "decide what to commit next" (carried
  forward from `mod_per_facet_breakdown` Decision §2);
  this task is the gesture that exercises the decision.
- `docs/moderator-ui.md:165-169` — *"per-participant vote
  indicators appear in both places (graph + sidebar)"* —
  the predecessor landed this; the commit-button gesture
  rides on the moderator's per-glance synthesis of the
  indicators.
- `docs/methodology.md:15-25` — moderator-only commit;
  unanimous-agree gate; the canonical statement of the
  rule this task's enablement predicate encodes.
- `docs/ws-protocol.md` — canonical wire spec; covers
  the `commit` / `committed` correlation, the dual-signal
  contract, the error vocabulary, the reconnection /
  catch-up flow.

ADRs and refinements consulted for style + decision
continuity:

- `tasks/refinements/moderator-ui/mod_vote_indicators_in_sidebar.md`
  (predecessor) — the per-(entity, facet) vote bucket
  this task's predicate reads from; the deferred-e2e debt
  routing convention.
- `tasks/refinements/moderator-ui/mod_per_facet_breakdown.md` —
  the chip / breakdown surface this task reads (no edit).
- `tasks/refinements/moderator-ui/mod_proposal_list.md` —
  the row host this task mounts the button inside.
- `tasks/refinements/moderator-ui/mod_propose_action.md` —
  the propose-side analog whose hook+component shape this
  task mirrors.
- `tasks/refinements/backend/ws_commit_message.md` — the
  wire shape this task constructs. The Decisions block
  there pins the moderator-identity-from-connection
  invariant + the engine-rejection mapping this task's
  wire-error region surfaces.
- `tasks/refinements/data-and-methodology/methodology_engine/commit_logic.md`
  (actual path: `tasks/refinements/data-and-methodology/commit_logic.md`)
  — the four engine-side commit rules + the unanimity
  predicate over current participants the client-side
  gate mirrors.
- `tasks/refinements/data-and-methodology/per_facet_status_derivation.md` —
  the seven aggregation rules (especially rule 6: every
  current participant `agree` → `agreed`) that the
  read-side `FacetStatus` projection encodes and this
  task's enablement predicate is the client-side analog
  of.
- `tasks/refinements/data-and-methodology/agreement_state_machine.md` —
  the per-participant per-facet vote model.
- [ADR 0021 — Event envelope: discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)

No new ADR is required (see Decisions §11). No new external
runtime dependency lands. The public type signatures this task
touches are limited to the new `deriveAllAgree` /
`deriveCurrentParticipants` exports in `proposalFacets.ts`, the
new `useCommitAction` hook in `apps/moderator/src/layout/`, and
the new `moderator.commitButton.*` catalog namespace. No
cross-workspace contract changes; no data-model touch; no
shared-types edit.

## Constraints / requirements

### Enablement gate — "all current participants agree on every facet"

The button is enabled iff `deriveAllAgree(entries,
currentParticipantIds)` returns `{ ok: true }`. The predicate
fires in fixed order; the FIRST blocking reason wins (used as
the tooltip text):

1. **`session-not-connected`** — `connectionStatus !== 'open'`.
   No commit possible if the socket is down. (Surfaced inline
   on the button regardless of per-row state; see Decision §1.b.)
2. **`proposal-meta-disagreement`** — any entry's
   `status === 'meta-disagreement'`. A meta-disagreement-marked
   facet is NOT commit-eligible; it must be split (or the
   proposal withdrawn) first. The button is disabled with this
   reason; the tooltip directs the moderator to the
   meta-disagreement resolution flow (out of scope for this
   task — a future task; the tooltip names it).
3. **`no-current-participants`** — `currentParticipantIds.size
   === 0`. Defensive; the engine would also reject (the
   `unanimous-agree-required` rule degenerates to true over
   an empty set, but the moderator's intent on an empty
   session is ambiguous; we disable the button rather than
   commit a vacuous agreement).
4. **`participants-not-voted`** — for any entry, some current
   participant has NO vote on this facet. The set difference
   between `currentParticipantIds` and the set of voting
   participants in `entry.votes` is non-empty. Missing votes
   block commit; explicit `agree` is required from every
   current participant on every facet.
5. **`participants-disagree`** — for any entry, some current
   participant's most-recent vote is `'dispute'` or
   `'withdraw'`. Either arm blocks commit; the predicate does
   not distinguish them in the gate reason (the
   per-participant indicator row already shows which
   participant and which arm).
6. **`ok: true`** — every entry has every current
   participant voting `'agree'`.

Notes on the gate's scope:

- **The moderator's own vote does NOT count.** The methodology
  engine's `commitHandler` rule 4 walks
  `currentParticipants(projection)` and asserts unanimous
  `'agree'`; the engine's `currentParticipants` helper excludes
  the moderator role from the vote-tally (per
  `commit_logic.md:78-84` and the read-side
  `deriveFacetStatus` rule 2: "filtered by the projection's
  *current* participants"). On the client side,
  `deriveCurrentParticipants(events)` collects
  `participant-joined` events filtered for participants whose
  role is `'debater'` (or `'participant'`; whichever the
  event payload's role field uses). The moderator is the
  committer, not a voter; their vote isn't required and isn't
  expected. This keeps the client-side gate identical to the
  server-side gate by construction.
- **Withdraw blocks commit (same as dispute).** The methodology
  engine's commit rule 4 requires explicit `'agree'`; a
  `'withdraw'` vote is NOT `'agree'`. The gate's
  `participants-disagree` reason covers both `dispute` and
  `withdraw` for the same reason — the per-participant
  indicator row distinguishes them visually, but for the
  commit gate either arm blocks.
- **Structural sub-kinds (`'proposal'` synthetic facet) are
  NOT commit-eligible via this button.** The
  `derivePerProposalFacets` selector emits one synthetic
  `'proposal'` lifecycle entry for the structural sub-kinds
  (`decompose`, `interpretive-split`, `axiom-mark`,
  `meta-move`, `break-edge`, `amend-node`, `annotate`); the
  engine's `commitHandler` returns
  `'illegal-state-transition'` for these. The button is
  disabled with the `structural-sub-kind-not-supported`
  reason for any row whose entries include a `'proposal'`
  synthetic facet (Decision §1.c). The reason names the
  sub-kind so the moderator understands why; the methodology
  engine's per-sub-kind handlers will eventually unlock
  these (per `commit_logic.md` Decisions — "deferred to
  decomposition_logic / axiom_mark_logic / etc.").
- **Re-evaluated on every event arrival.** The gate is a
  function of `(entries, currentParticipantIds)`; both are
  derived from `events`; the pane re-renders the row on
  every `applyEvent` write. No manual refresh; the button
  enables / disables in real time as votes arrive.

### Button placement, sizing, and visual states

- **Placement**: right-aligned in the row header (Decision
  §2 — option (a)). Mounts inside the `<div className="flex
  items-center gap-2">` row at
  `PendingProposalsPane.tsx:234-247`, AFTER the timestamp
  span. The header's existing left-to-right layout —
  kind-chip → summary → author → timestamp → commit-button
  — keeps the action at the visual end of the row. The
  per-facet breakdown stays beneath the header (unchanged
  from the predecessor's row layout).
- **Sizing**: smaller than `<ProposeAction>`'s primary
  button. The propose button is the primary-action surface
  in the bottom-strip; the per-row commit button is
  secondary-density (compact). Tailwind class set:
  ```
  inline-flex items-center gap-1 rounded border border-emerald-700 bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-800 hover:border-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-500
  ```
  WCAG AA contrast: white-on-emerald-700 ≈ 5.96:1 (pass);
  slate-500-on-slate-100 (disabled) ≈ 5.36:1 (pass).
  Emerald (rather than blue-700 like propose) signals
  "commit / land" semantically — green for "go". The
  disabled palette is the neutral slate-100/slate-500 set
  the rest of the pane uses for disabled controls.
- **Visual states** (Decision §3):
  - **Disabled (gate blocked)**: slate-100 / slate-500;
    `disabled` + `aria-disabled="true"`; visible label
    is the localized `moderator.commitButton.label`
    ("Commit"); `title` attribute carries the localized
    gate-reason text (so hovering the button reveals
    *why* it's disabled).
  - **Enabled (gate passes, no in-flight)**: emerald-700;
    visible label `moderator.commitButton.label`
    ("Commit"); no `title` decoration.
  - **In-flight (between click and ack)**: emerald-700;
    `disabled` (so a double-click cannot fire a duplicate);
    visible label `moderator.commitButton.inFlightLabel`
    ("Committing…"); a small inline spinner glyph (a
    Unicode `…` is fine — no SVG churn this task; matches
    the `<ProposeAction>` precedent).
  - **Errored (after a failed commit)**: emerald-700
    again (re-enabled for retry — Decision §6); a
    sibling inline `propose-action-wire-error`-style
    region below the row header surfaces the wire error
    code + message via
    `moderator.commitButton.wireError` with `role="alert"`.
- **Test seam attributes**:
  - `data-testid="commit-button"` on the `<button>`.
  - `data-proposal-id="<row.proposalEventId>"` on the
    button (so tests can address per-row buttons without
    re-deriving the row order).
  - `data-commit-state="disabled"` | `"enabled"` | `"in-flight"`
    on the button — the discriminated visual state, so
    Playwright + Vitest assertions read off a single
    attribute rather than poking at class names.
  - `data-commit-gate-reason="<reason>"` on the button when
    `data-commit-state="disabled"` and the gate blocks.
  - `data-testid="commit-button-wire-error"` +
    `data-proposal-id="<row.proposalEventId>"` on the
    inline error region (rendered only when
    `lastError !== undefined` for the row).

### Click handler — pessimistic wait, no optimistic row removal

- The hook's `commit()` function is `async () => Promise<void>`
  and:
  1. Re-checks `commitStore.committing.has(proposalId)` — if
     true, drop silently (the in-flight guard; mirrors the
     propose hook's concurrent-re-entry rule).
  2. Flips `committing → committing ∪ {proposalId}` via
     `useCommitStore.getState().setCommitting(proposalId, true)`.
  3. Clears any prior error for this proposalId via
     `setError(proposalId, undefined)`.
  4. Calls `client.send('commit', { sessionId,
     expectedSequence: useWsStore.getState()
     .sessionState[sessionId]?.lastAppliedSequence ?? 0,
     proposalId })`. The payload's three fields match
     `wsCommitPayloadSchema` exactly; no `moderatorId`
     (the server reads it from the connection).
  5. **Awaits the `committed` ack.** On resolve, the
     `event-applied` broadcast for the `commit` event will
     also have arrived (the server's commit handler
     broadcasts BEFORE replying the ack per
     `ws_commit_message.md` Decisions); the local
     `applyEvent` reducer reduces it, and
     `derivePendingProposals` filters out the now-committed
     row. The row disappears naturally. The hook just
     removes the proposalId from `committing` (the row is
     gone so the in-flight signal is moot, but cleanup
     keeps the store tidy).
  6. **On error** (engine rejection / timeout / unknown):
     remove proposalId from `committing`, set the error
     via `setError(proposalId, toWireError(err))`. The
     row is still in the pane (the proposal wasn't
     committed); the error region renders next to the
     button; the moderator can retry by re-clicking.
- **No optimistic row removal.** Decision §5 — commit may
  fail (a participant could `withdraw` between the
  moderator's read and the server's commit attempt; the
  server could reject for `proposal-already-committed` if
  two moderator UIs raced; the network could time out).
  Optimistic removal would leave the moderator with the
  proposal gone visually but still pending on the server —
  a worse failure mode than a brief "Committing…" pause.
  The pessimistic-wait shape gives the moderator a
  truthful view of state at all times.

### Per-proposal in-flight + error tracking — module-scoped Zustand slice

```ts
// Colocated inside useCommitAction.ts (module-scoped, NOT
// React context). The store-outside-React pattern matches
// useProposeAction's `useProposeErrorStore` slice
// (apps/moderator/src/layout/useProposeAction.ts:120-128)
// so two button renders for the same proposalId share state.

import { create } from 'zustand';

export interface WireError {
  readonly code: string;
  readonly message: string;
}

interface CommitState {
  committing: ReadonlySet<string>;
  errors: ReadonlyMap<string, WireError>;
  setCommitting: (proposalId: string, flag: boolean) => void;
  setError: (proposalId: string, error: WireError | undefined) => void;
}

const useCommitStore = create<CommitState>((set) => ({
  committing: new Set<string>(),
  errors: new Map<string, WireError>(),
  setCommitting: (proposalId, flag) =>
    set((state) => {
      const next = new Set(state.committing);
      if (flag) next.add(proposalId);
      else next.delete(proposalId);
      return { committing: next };
    }),
  setError: (proposalId, error) =>
    set((state) => {
      const next = new Map(state.errors);
      if (error === undefined) next.delete(proposalId);
      else next.set(proposalId, error);
      return { errors: next };
    }),
}));

export function resetCommitStore(): void {
  useCommitStore.setState({
    committing: new Set<string>(),
    errors: new Map<string, WireError>(),
  });
}
```

The store is **NOT** added to `useCaptureStore` (which is
for the in-flight capture draft) or `useWsStore` (which is
for server-state). Commit in-flight tracking is a
per-button UI concern; a thin sibling slice is the right
home.

### Error handling

- `WsRequestError(payload)` → `{ code: payload.code,
  message: payload.message }`. The server's localized-or-
  not message is authoritative for engine rejections (some
  reasons carry per-case detail). The inline region reads
  `t('moderator.commitButton.wireError', { code, message })`.
- `WsRequestTimeoutError(type, id)` → `{ code: 'timeout',
  message: t('moderator.commitButton.timeoutError') }`.
- Any other `Error` → `{ code: 'unknown', message: err.message }`.
- **Dismissal**: the error region clears when the next event
  arrives for this proposalId (a vote or another commit
  attempt) OR when the moderator clicks the button again.
  Specifically, the hook auto-clears the error on every
  click (step 3 above); the on-event-arrival dismissal is
  out of scope for v1 (the next event likely flips
  `canCommit` which redraws the button — the error region
  staying briefly is acceptable).

### i18n catalog keys

8 new keys under the new `moderator.commitButton.*` sub-area:

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.commitButton.label` | "Commit" | "Confirmar" | "Confirmar" |
| `moderator.commitButton.inFlightLabel` | "Committing…" | "Confirmando…" | "Confirmando…" |
| `moderator.commitButton.ariaLabel` | "Commit this proposal (all participants must agree)" | "Confirmar esta proposta (todos os participantes devem concordar)" | "Confirmar esta propuesta (todos los participantes deben estar de acuerdo)" |
| `moderator.commitButton.wireError` | "Commit failed: {message} ({code})" | "Falha ao confirmar: {message} ({code})" | "Falló la confirmación: {message} ({code})" |
| `moderator.commitButton.timeoutError` | "The commit request timed out. Check your connection and try again." | "A solicitação de confirmação expirou. Verifique sua conexão e tente novamente." | "La solicitud de confirmación expiró. Verifica tu conexión y vuelve a intentarlo." |
| `moderator.commitButton.gateTooltip` | "Cannot commit yet: {reason}" | "Não é possível confirmar ainda: {reason}" | "Aún no se puede confirmar: {reason}" |
| `moderator.commitButton.errorRoleLabel` | "Commit error" | "Erro de confirmação" | "Error de confirmación" |

One gate-reason key holding all six branches as ICU `{select}`
arms (Decision §8 — single key with `select` is cheaper
catalog real estate than six sibling keys for what is
effectively one localized message family):

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.commitButton.reason` | (ICU `select` over `{reason, select, sessionNotConnected {…} proposalMetaDisagreement {…} noCurrentParticipants {…} participantsNotVoted {…} participantsDisagree {…} structuralSubKindNotSupported {…} other {…}}` — see Decisions §8 for the per-arm English text) | (draft) | (draft) |

**Total count: 8 keys × 3 locales = 24 catalog entries**. The
pt-BR + es-419 drafts (16 entries) land flagged PENDING in
`packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and
`es-419.review.json`. The en-US is authoritative. The
predecessor's `moderator.proposalList.*` /
`moderator.proposeAction.*` namespacing pattern is the
precedent.

The native-review follow-up:

```
task i18n_commit_button_native_review "Native-speaker review of pt-BR + es-419 commit-button strings" {
  effort 0.5d
  allocate team
  depends !i18n_per_facet_breakdown_native_review
  note "Source of debt: mod_commit_button (this commit) — pt-BR and es-419 drafts of the 8 keys under moderator.commitButton.* landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers. UI prose translation (lower bar than methodology terms but still needs review)."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md (commit b7c5ff0)."
}
```

### Files this task touches (explicit allowlist)

- `apps/moderator/src/graph/proposalFacets.ts` (modified —
  add `deriveAllAgree`, `deriveCurrentParticipants`,
  `CommitGate`, `CommitGateReason` exports).
- `apps/moderator/src/graph/proposalFacets.test.ts` (modified
  — add cases for the new exports).
- `apps/moderator/src/layout/useCommitAction.ts` (new — the
  hook + the module-scoped `useCommitStore` slice +
  `resetCommitStore` test seam).
- `apps/moderator/src/layout/useCommitAction.test.tsx` (new
  — hook isolation cases under `renderHook` with a mocked
  `useWsClient` + a real `useWsStore`).
- `apps/moderator/src/layout/PendingProposalsPane.tsx`
  (modified — add the `currentParticipantIds` third
  `useMemo`; thread it through `<PendingProposalRow>`; mount
  the button + inline error region inside the row header).
- `apps/moderator/src/layout/PendingProposalsPane.test.tsx`
  (modified — add the per-row button rendering + click
  cases).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified
  — add the 8 new `moderator.commitButton.*` keys).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` (modified
  — same).
- `packages/i18n-catalogs/src/catalogs/es-419.json` (modified
  — same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json`
  (modified — PENDING entries for the 8 new keys).
- `packages/i18n-catalogs/src/catalogs/es-419.review.json`
  (modified — same).
- `tests/e2e/moderator-capture.spec.ts` (modified — add one
  new `test()` block — the no-vote disabled-baseline).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_commit_button` and
  the new `i18n_commit_button_native_review` task block
  land at task-completion time per the README ritual, not
  at refinement-write time. The Closer also propagates to
  M4 if this is the last dependency (it is not — M4
  depends on multiple other tasks; see
  `tasks/99-milestones.tji`).
- `docs/adr/` — no new ADR (see Decision §11).
- `apps/server/src/` — no server-side change. The commit
  handler is shipped by `ws_commit_message`.
- `packages/shared-types/` — no schema change. `commit` /
  `committed` are already registered in the closed union.
- `apps/moderator/src/ws/client.ts` — the `WsClient` surface
  is consumed unchanged.
- `apps/moderator/src/ws/wsStore.ts` — `lastAppliedSequence`
  is read; the store is not extended.
- `apps/moderator/src/layout/ProposalFacetBreakdown.tsx` —
  the chip surface is unchanged; the all-agree predicate is
  derived in the row component (above the breakdown), not
  inside it.
- `apps/moderator/src/stores/captureStore.ts` — the capture
  store is for the in-flight propose draft; commit
  in-flight state lives in the colocated `useCommitStore`
  slice instead.

### Build / type / test gates

- `pnpm run check` clean.
- `pnpm run test:smoke` green; the moderator-workspace test
  count rises by the new cases (≥ 12 new across selector +
  hook + component test files).
- `pnpm --filter @a-conversa/i18n-catalogs run check` (the
  parity-check) green after the catalog edits.
- `pnpm -F @a-conversa/moderator build` succeeds.
- `pnpm exec playwright test` green against a freshly
  brought-up dev compose stack; the new no-vote disabled-
  baseline block in `tests/e2e/moderator-capture.spec.ts`
  passes.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent
  after the Closer adds `complete 100` on
  `mod_commit_button` AND the new
  `i18n_commit_button_native_review` task block.

### UI-stream e2e scoping

Per Decision §10, the Playwright e2e is **scoped under
Acceptance criteria, NOT deferred**. The scope is option
(a) — drive the moderator UI alone and assert the button
is DISABLED on a freshly-proposed row (no votes yet). The
cross-context "vote-from-both-debaters → click commit →
see committed event land" assertion is registered as
deferred-e2e debt against the pre-existing
`participant_ui.part_pw_concurrent_with_moderator` task at
`tasks/40-participant-ui.tji:334` — the same carrier the
predecessor's deferred debt routes through.

## Acceptance criteria

### 1. Selector extension

- `apps/moderator/src/graph/proposalFacets.ts` exports
  `deriveAllAgree(entries: readonly ProposalFacetEntry[],
  currentParticipantIds: ReadonlySet<string>): CommitGate`
  returning `{ ok: true } | { ok: false; reason: CommitGateReason }`.
  The `CommitGateReason` union is
  `'session-not-connected' | 'proposal-meta-disagreement' |
  'no-current-participants' | 'participants-not-voted' |
  'participants-disagree' | 'structural-sub-kind-not-supported'`.
  Note: `'session-not-connected'` is the outer gate the row
  component checks BEFORE calling `deriveAllAgree` (since
  the predicate doesn't know about the WS connection
  status); it is included in the union for the row
  component to surface uniformly.
- `apps/moderator/src/graph/proposalFacets.ts` exports
  `deriveCurrentParticipants(events: readonly Event[]):
  ReadonlySet<string>` — walks the event log once,
  collecting every `'participant-joined'` event whose
  participant has not subsequently emitted
  `'participant-left'` AND whose role is NOT `'moderator'`
  (Decision §1.a). Returns the set of currently-joined
  non-moderator participant ids.
- Pure: no closure over time, no `Date.now()`, no
  `Math.random()`. Calling either function twice with the
  same args returns deep-equal output.

### 2. Pane integration

- `apps/moderator/src/layout/PendingProposalsPane.tsx` adds
  a third `useMemo` for `currentParticipantIds` keyed on
  the same `events` reference as the other two memos. The
  set is threaded through `<PendingProposalRow>` to the
  in-row button.

### 3. Button visual states

- The `<button data-testid="commit-button"
  data-proposal-id="<row.proposalEventId>">` renders inside
  the row header, AFTER the timestamp span.
- The button's `data-commit-state` attribute is
  `"disabled"` | `"enabled"` | `"in-flight"`.
- When `data-commit-state="disabled"`, the
  `data-commit-gate-reason` attribute carries the
  `CommitGateReason` value; the `title` attribute carries
  the localized `gateTooltip` text with the
  reason-specific message interpolated.
- The button's visible label is
  `t('moderator.commitButton.label')` when not in-flight,
  `t('moderator.commitButton.inFlightLabel')` when
  in-flight.
- `aria-disabled` mirrors `disabled`; `aria-label` reads
  `moderator.commitButton.ariaLabel`.

### 4. Click handler — pessimistic-wait shape

- Clicking an enabled button:
  - calls `useCommitStore.setCommitting(proposalId, true)`
    + clears any prior error for this proposalId;
  - calls `client.send('commit', { sessionId,
    expectedSequence, proposalId })` with
    `expectedSequence` read off
    `useWsStore.getState().sessionState[sessionId]
    .lastAppliedSequence` at call-time;
  - awaits the `committed` ack;
  - on resolve: removes proposalId from `committing`
    (the row disappears naturally because the broadcast
    `commit` event arrives and `derivePendingProposals`
    filters it out);
  - on `WsRequestError`: removes proposalId from
    `committing`, sets the error via
    `setError(proposalId, { code, message })`; renders the
    inline `commit-button-wire-error` region;
  - on `WsRequestTimeoutError`: same as
    `WsRequestError` but with `code: 'timeout'` and the
    localized timeout message.
- The button cannot fire a duplicate during the in-flight
  window (a concurrent click is a no-op).

### 5. Vitest cases

Minimum 12 new cases, all per ADR 0022.

**In `apps/moderator/src/graph/proposalFacets.test.ts` (≥ 5
cases):**

1. `deriveCurrentParticipants` excludes the moderator role.
2. `deriveCurrentParticipants` excludes left participants.
3. `deriveAllAgree({ ok: true })` when every entry has every
   participant voting `'agree'`.
4. `deriveAllAgree({ ok: false, reason: 'participants-not-voted' })`
   when a participant has no vote on one facet.
5. `deriveAllAgree({ ok: false, reason: 'participants-disagree' })`
   when a participant has voted `'dispute'` (and a separate
   case for `'withdraw'`).
6. `deriveAllAgree({ ok: false, reason: 'proposal-meta-disagreement' })`
   when any entry's status is `'meta-disagreement'`.
7. `deriveAllAgree({ ok: false, reason: 'structural-sub-kind-not-supported' })`
   when an entry's facet is the synthetic `'proposal'`.

**In `apps/moderator/src/layout/useCommitAction.test.tsx`
(≥ 5 cases):**

1. **Successful commit** — fires one `commit` envelope with
   the canonical payload shape, awaits the ack, removes the
   proposalId from `committing`.
2. **Engine rejection** — `WsRequestError({ code:
   'unanimous-agree-required', message: ... })` lands the
   error in `useCommitStore.errors`, removes proposalId from
   `committing`.
3. **Timeout** — `WsRequestTimeoutError` lands a
   `{ code: 'timeout', ... }` error.
4. **Concurrent re-entry** — a second `commit()` call while
   the first is in-flight is a no-op.
5. **`inFlight` reflects `useCommitStore.committing`** for
   the proposalId arg.

**In `apps/moderator/src/layout/PendingProposalsPane.test.tsx`
(≥ 4 cases):**

1. **Disabled baseline** — a freshly-proposed row renders
   a button with `data-commit-state="disabled"` and
   `data-commit-gate-reason="participants-not-voted"`.
2. **Enables when all agree** — push `proposal` + two
   `vote` events (two debaters both voting `'agree'`)
   into `useWsStore` via `applyEvent`; assert the row's
   button flips to `data-commit-state="enabled"`.
3. **Click sends the canonical envelope** — using a spied
   `useWsClient`, click the enabled button; assert one
   `commit` envelope is sent with the right shape; the
   spy resolves with a `committed` ack.
4. **Meta-disagreement-marked row's button is disabled
   with the right reason** — push a
   `meta-disagreement-marked` event into the store;
   assert the row's button shows
   `data-commit-gate-reason="proposal-meta-disagreement"`.

### 6. Playwright e2e (per Decision §10)

One new `test()` block lands in
`tests/e2e/moderator-capture.spec.ts` (joining the existing
suite). The block exercises:

1. Login → create session → land on operate.
2. Type wording + pick classification + Cmd+Enter.
3. Assert the freshly-proposed row appears in the pane.
4. Assert the row's `commit-button` carries
   `data-commit-state="disabled"` with
   `data-commit-gate-reason` of either
   `'no-current-participants'` (in a no-debater session)
   or `'participants-not-voted'` (in a session with
   debaters but no votes). The exact reason depends on
   whether the dev compose stack seeds debater
   participants for the test session; the assertion is
   flexible (either reason satisfies — both prove the
   gate works).

The cross-context vote-and-see-it-enable case is
**explicitly OUT of scope** and registered as deferred-
e2e debt against `participant_ui.part_pw_concurrent_with_moderator`
(`tasks/40-participant-ui.tji:334`) — Decision §10.

### 7. i18n catalog parity

- `packages/i18n-catalogs/src/catalogs/en-US.json` gains
  the 8 new `moderator.commitButton.*` keys.
- `pt-BR.json` and `es-419.json` gain the same 8 keys
  with draft strings.
- `pt-BR.review.json` and `es-419.review.json` gain
  `pending: true` entries for each of the 8 new keys
  (16 PENDING entries total).
- `pnpm --filter @a-conversa/i18n-catalogs run check`
  green.

### 8. WBS updates (per `tasks/refinements/README.md`
ritual)

- `tasks/30-moderator-ui.tji`: `mod_commit_button` block
  gets `complete 100` after the `allocate team` line plus
  a `note "Refinement: tasks/refinements/moderator-ui/mod_commit_button.md"`
  line.
- `tasks/35-frontend-i18n.tji`: a new task block
  `i18n_commit_button_native_review` is added (template
  in the i18n section above).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

### 9. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### §1 — Enablement gate: "all current non-moderator participants vote agree on every facet"

Three options were on the table; option (a) wins.

- **(a) Predicate over `currentParticipantIds × entries`
  requiring every (participant, entry) pair to have an
  `'agree'` vote** — chosen. This mirrors the engine's
  `commitHandler` rule 4 (`commit_logic.md:78-84`) and the
  read-side `deriveFacetStatus` rule 6
  (`per_facet_status_derivation.md:75-83`) — the three
  layers (engine validator, read-side derivation,
  client-side button gate) compute the same predicate
  independently and stay consistent by construction.
  Sub-decisions:
  - **§1.a — Moderator's vote does NOT count.** The
    engine's `currentParticipants` helper excludes the
    moderator role; the client mirrors this in
    `deriveCurrentParticipants(events)`. Rationale: the
    moderator IS the committer, not a voter; their vote
    is neither required nor expected. Methodology
    `docs/methodology.md:15-25` says only the moderator
    commits; the read-side derivation
    (`per_facet_status_derivation.md:75-83`) filters
    `perParticipant` by current participants which by
    construction excludes the moderator role.
  - **§1.b — Connection-status gate is the OUTER check.**
    `connectionStatus !== 'open'` blocks commit
    regardless of the per-row vote state; the row
    component checks it before calling `deriveAllAgree`
    and surfaces a `data-commit-gate-reason="session-not-connected"`.
    Putting it inside `deriveAllAgree` would force the
    predicate to take a connection-status argument it
    has no business reading; keeping it in the row
    component preserves the predicate's purity.
  - **§1.c — Structural sub-kinds get a "not supported"
    reason.** `derivePerProposalFacets` emits a synthetic
    `'proposal'` lifecycle facet for the structural
    sub-kinds; the engine's `commitHandler` returns
    `'illegal-state-transition'` for these. Surfacing a
    `structural-sub-kind-not-supported` reason on the
    button tells the moderator why; the methodology
    engine's per-sub-kind handlers will eventually unlock
    them (per `commit_logic.md` Decisions). Until then
    the button is honestly disabled.
- **(b) Read `entries[i].status === 'agreed'` for every
  entry** — partial overlap with (a) but loses the
  per-participant detail. Rejected because the gate
  reason wants to name *which* condition blocked (e.g.,
  "Carla hasn't voted yet" vs "Bob disagrees"); the
  facet-status enum (`'proposed'` / `'disputed'` /
  `'agreed'`) collapses these into one status and loses
  the detail. Option (a)'s direct walk produces the
  richer reason. Plus the engine's `commit_logic.md`
  Decision on "direct walk vs `deriveFacetStatus`"
  established the same precedent for the same reason
  on the server side (the walk wins for the detail-
  string requirement).
- **(c) Read the server-broadcast `perFacetStatus` map**
  — couples the gate to the server's broadcast cadence.
  If the broadcast is rate-limited or temporarily silent,
  the button would stay disabled longer than the actual
  state warrants. Rejected.

### §2 — Button placement: right-aligned in the row header

Three options were on the table; option (a) wins.

- **(a) Right-aligned in the row header, after the
  timestamp span** — chosen. Compact; glanceable; the
  moderator's eye-path is already left-to-right across
  the row (chip → summary → author → timestamp);
  ending in an action button is the natural completion
  of the read. Doesn't disrupt the per-facet chip rows
  beneath (Decision §2 of `mod_per_facet_breakdown`
  established the row as a vertical stack of header +
  breakdown; adding the button to the header preserves
  the stack).
- **(b) Below the facet breakdown (full-width)** —
  rejected. A full-width button after the chip row
  would compete visually with the per-facet status
  display the moderator is reading; the chip row IS
  the at-a-glance signal for "is this ready?", and the
  action button should be paired with — not after —
  that signal. Also bloats the row vertically.
- **(c) Floating action button per row on hover** —
  rejected. Hover-only affordances are inaccessible
  (keyboard navigation cannot trigger them); they're
  also surprising in a list context where the moderator
  is scanning multiple rows simultaneously.

### §3 — Visual states: 4-state discriminated UI

Mirrored on `<ProposeAction>`'s shape, adapted for per-row
density:

- **Disabled / gate-blocked**: slate-100 background,
  slate-500 text, `disabled` + `aria-disabled`, tooltip
  with the gate reason.
- **Enabled**: emerald-700 background (semantically
  "go / land"), white text, hover-darken on
  emerald-800.
- **In-flight**: emerald-700 still (so the click target
  doesn't visually disappear), `disabled` (double-click
  guard), label switches to "Committing…".
- **Errored**: emerald-700 again (re-enabled for retry),
  inline error region beneath the row header with
  `role="alert"`.

The `data-commit-state` attribute surfaces the
discriminated state as a single test seam (rather than
forcing test assertions to read class names or compute
the state from props).

### §4 — Hook shape: `useCommitAction(proposalId)` mirrors `useProposeAction`

Two options were on the table; option (a) wins.

- **(a) `useCommitAction(proposalId): { commit, inFlight,
  lastError }`** — chosen. Mirrors `useProposeAction`'s
  shape (same hook-in-layout/ home, same WS-client +
  WS-store reads, same WireError surface, same error-to-
  inline-region pattern). The proposalId argument is
  necessary because the hook needs to dispatch on a
  specific row; the propose hook didn't need a row arg
  because there's one capture-store draft at a time.
- **(b) `useCommitAction(): { commit(proposalId),
  inFlight(proposalId), lastError(proposalId) }`** — same
  capability with the proposalId as a per-call argument
  instead of a hook argument. Rejected: the hook would
  have to read the full `committing` set + `errors` map
  on every render, breaking memo selectivity (every
  commit anywhere in the pane would re-render every
  button); the per-proposalId hook signature lets each
  button subscribe to ONLY its own slice.

### §5 — Pessimistic-wait, NOT optimistic row removal

Two options were on the table; option (a) wins.

- **(a) Pessimistic-wait: render "Committing…" until the
  ack arrives; let the broadcast remove the row
  naturally** — chosen. Three rationales:
  1. **Commit can fail.** The engine's all-agree
     predicate is checked at the server against the
     post-transaction projection; a `withdraw` vote
     arriving between the moderator's read and the
     server's commit attempt would flip the result.
     The optimistic path would have to handle "row
     came back after I removed it" which is more
     confusing than "row stayed and a tooltip says why
     it failed."
  2. **Two-moderator-UI race.** If a moderator has the
     same session open in two tabs and clicks commit in
     both, one will succeed (`'proposal-already-committed'`
     rejection on the second). Optimistic removal in
     both tabs would briefly hide the row in BOTH tabs;
     pessimistic-wait shows the truthful state.
  3. **Pessimistic isn't slow.** The propose-side
     optimistic-clear is justified because the
     moderator is rapidly typing the next statement;
     blocking the textarea costs typing time. The
     commit gesture is a single discrete action with
     no follow-up gesture pending; pausing for the
     200-500ms round-trip is invisible to the
     moderator's flow.
- **(b) Optimistic removal: hide the row on click; if
  commit fails, restore it** — rejected per the three
  rationales above. The `<ProposeAction>` precedent
  doesn't carry over because propose and commit have
  different UX shapes (one is part of a typing flow;
  the other is a discrete decision).

### §6 — Errored state: re-enabled for retry, inline message, no auto-dismiss on event

Two options were on the table; option (a) wins.

- **(a) Re-enabled for retry; inline error region with
  `role="alert"`; dismissed on next click (which also
  clears the error before the next attempt)** — chosen.
  Mirrors `<ProposeAction>`'s shape, adapted for the
  per-row context. Auto-dismissal-on-next-event was
  considered but adds complexity for marginal benefit
  (the next event likely flips `canCommit` which
  redraws the button anyway; the error region staying
  briefly is acceptable).
- **(b) Disabled after error until the moderator
  explicitly dismisses the error** — rejected. Adds a
  dismiss button (more chrome, more keys) for the same
  effective behaviour as (a)'s "click to retry which
  also clears the error."

### §7 — Per-proposal state: module-scoped `useCommitStore` Zustand slice

Three options were on the table; option (a) wins.

- **(a) Module-scoped `useCommitStore` Zustand slice
  tracking `committing: ReadonlySet<string>` + `errors:
  ReadonlyMap<string, WireError>` keyed by `proposalId`**
  — chosen. Two reasons:
  1. **Per-button hook instances need to share state.**
     If a future feature mounts the same row in two
     places (e.g., a focused-row sidebar that mirrors
     the pane), both renders need to observe the same
     in-flight / error state for the same proposalId.
     `useState` would give each hook instance its own
     copy.
  2. **`useCaptureStore` is for the in-flight draft.**
     The capture store's `proposing: boolean` slice
     tracks the propose-action's in-flight state; the
     commit-action's in-flight state is per-proposalId
     and conceptually orthogonal. Mixing them muddies
     two distinct concerns; a thin sibling store is the
     right home.
  Mirrors `useProposeErrorStore`'s shape (Decision §11
  of `mod_propose_action` — module-scoped Zustand slice
  outside React).
- **(b) Local component state per button** — rejected
  per (1) above.
- **(c) Reuse `useCaptureStore` with new fields** —
  rejected per (2) above.

### §8 — i18n: 8 new keys; one ICU `select` for gate reasons

Two options were on the table; option (a) wins.

- **(a) 7 chrome keys + 1 ICU `select` key holding all
  six gate-reason arms** — chosen. The six gate reasons
  are conceptually one localized message family ("the
  reason the commit is blocked"); a `select` over six
  arms is the canonical ICU pattern for that family.
  Plus six sibling keys would mean six separate
  catalog entries per locale (18 total just for
  reasons) vs. one entry per locale (3 total) — a
  meaningful catalog-size savings. The en-US `select`
  text is:
  ```
  {reason, select,
    sessionNotConnected {the session is not connected — reconnecting…}
    proposalMetaDisagreement {this proposal is marked as meta-disagreement; resolve it before committing}
    noCurrentParticipants {no participants have joined the session yet}
    participantsNotVoted {one or more participants have not voted on every facet}
    participantsDisagree {one or more participants have not agreed on every facet}
    structuralSubKindNotSupported {this proposal kind is not yet supported for commit}
    other {unknown}}
  ```
  The pt-BR / es-419 drafts mirror the structure; native
  review per-arm is part of the follow-up task.
- **(b) 6 sibling reason keys + 7 chrome keys = 13 keys
  × 3 locales = 39 catalog entries** — rejected per the
  catalog-size + family-coherence rationale.

### §9 — No keyboard shortcut for commit

Two options were on the table; option (a) wins.

- **(a) No keyboard shortcut for commit; click-only** —
  chosen. Three rationales:
  1. **Commit is a deliberate moderator-authority action.**
     The methodology framing (`docs/methodology.md:15-25`)
     pins commit as the structural-not-interpretive
     enactment of agreement; the gesture should be
     explicit. A chord like `Cmd+Shift+Enter` would
     work mechanically but invites accidental commits
     (the moderator's hands are at the keyboard during
     debate; a typo could fire a commit when they
     meant to propose).
  2. **The button is the natural surface.** The pane is
     a list; per-row buttons are the canonical action
     pattern for list-of-items UIs. Keyboard navigation
     is still available — Tab focuses each row's button
     in order; Space/Enter activates the focused button.
  3. **The propose hook's `Cmd+Enter` is already taken
     for propose** in the same surface area (the
     capture pane). Adding another commit-specific
     chord would crowd the keymap and risk muscle-
     memory confusion.
- **(b) A `Cmd+Shift+Enter` or similar chord on the
  focused row's button** — rejected per the
  "deliberate, not reflexive" framing above. Future
  task can revisit if the moderator workflow
  consistently wants a chord; v1 ships click-only.

### §10 — E2E test scope: disabled baseline; defer cross-context vote-and-enable

Two options were on the table; option (a) wins.

- **(a) Drive the moderator UI alone; assert the button
  is disabled on a freshly-proposed row** — chosen. The
  no-vote-yet state is observable from the moderator
  alone (the propose lands; the row appears; the row's
  button is `data-commit-state="disabled"` with a
  gate reason like `'participants-not-voted'` or
  `'no-current-participants'`). This proves the gate
  works in the realistic dev compose stack without
  needing cross-context infrastructure. Mirrors the
  predecessor's Decision §7 (no-vote-yet baseline as
  the minimum-viable e2e).
- **(b) Drive a second authenticated browser context
  as a debater, cast two votes, observe the moderator's
  button enable, click it, assert the committed event
  lands** — rejected for THIS task. The cross-context
  wiring is the natural home of
  `participant_ui.part_pw_concurrent_with_moderator`
  (`tasks/40-participant-ui.tji:334`), the same
  pre-existing carrier the predecessor routed its
  deferred debt against. This task's Status block will
  register the deferred-e2e debt as a note pointing at
  that task (same shape as `mod_vote_indicators_in_sidebar`
  Decision §8).

The Vitest-level coverage covers the positive case
(push `proposal` + `vote` + `vote` into the store; assert
the button enables; click; assert the envelope sent).
The Playwright assertion would re-test the same
contract through a more expensive harness — the
unit-level test is sufficient for the rendering
contract; the cross-context e2e adds confidence about
the WS round-trip which the deferred task carries.

### §11 — No new ADR

Three potential ADR triggers, all dispatched:

- **"A new WS-write pattern is ADR-worthy."** This task
  adds NO new pattern — it follows the wire vocabulary
  settled by `ws_commit_message` and the WS-client API
  settled by `mod_ws_client`. The pessimistic-wait
  shape is a UI-level decision (not architectural).
- **"Per-proposal state slice is ADR-worthy."** The
  module-scoped Zustand slice pattern is precedent
  (per `useProposeErrorStore`). No new architectural
  decision.
- **"Enablement gate computation is ADR-worthy."** The
  client-side mirror of the server-side engine
  predicate is precedent (per
  `mod_per_facet_breakdown`'s server-or-client
  status-resolution decision). The all-agree predicate
  is a tactical UI choice, not an architectural
  decision.

`mod_propose_action`, `mod_per_facet_breakdown`,
`mod_vote_indicators_in_sidebar`, `mod_ws_client`,
`ws_commit_message`, `commit_logic`,
`per_facet_status_derivation`, ADR 0021, ADR 0022, ADR
0024 already pinned every architectural choice this
task implements; this refinement is the task-scope pin
for the UI binding.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Per-row `<button data-testid="commit-button">` plus inline `commit-button-wire-error` region landed inside `<PendingProposalRow>` at `apps/moderator/src/layout/PendingProposalsPane.tsx`, with the row's enablement / disabled-reason wired through the new `useCommitAction` hook at `apps/moderator/src/layout/useCommitAction.ts` (mirrors `useProposeAction` against the already-shipped `client.send('commit', payload)` seam, module-scoped Zustand in-flight set keyed by `proposalId`, pessimistic-wait round-trip surfacing inline errors).
- **New shared decision-logic seam exports** from `apps/moderator/src/graph/proposalFacets.ts`: `deriveAllAgree`, `deriveCurrentParticipants` (pure predicates, moderator excluded, meta-disagreement + structural sub-kinds blocked), `CommitGate`, and `CommitGateReason`. Future commit-aware features (audience commit-state mirroring, palette commit shortcuts, server-side gate parity checks) should consume these instead of re-deriving the logic.
- Selector composition: `PendingProposalsPane.tsx` grew a third `useMemo` plus a `connectionOpen` selector; per-row props now thread the `CommitGate` outcome (gate reason resolves to `no-current-participants` in the no-debater dev stack, as the new e2e baseline asserts).
- i18n: 8 new `moderator.commitButton.*` keys × 3 locales = 24 catalog entries across `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`; pt-BR + es-419 drafts flagged PENDING (8 entries each, 16 total) in the matching `*.review.json` trackers — see `i18n_commit_button_native_review` follow-up below.
- Test-infrastructure fix: `apps/moderator/src/layout/PendingProposalsPane.test.tsx` now wraps every render in `MemoryRouter` + `WsClientProvider` (new local `renderPane()` helper) because the row's `useCommitAction` calls `useWsClient()`; pre-existing tests continue to share the production provider stack.
- Vitest test-count delta across touched files: 80 → 110 (+30) — new coverage in `useCommitAction.test.tsx` (new file), `proposalFacets.test.ts` (+15 cases on the new predicates), and `PendingProposalsPane.test.tsx` (+7 commit-button cases). Full smoke: 3061 passing.
- Playwright: one new `test()` block in `tests/e2e/moderator-capture.spec.ts` asserts the disabled-baseline commit button on a freshly-proposed row in the no-debater dev stack; `chromium-create-session` project remains 11/11.

NOTE — Deferred e2e debt (per Decision §11): the cross-context "vote-and-enable → commit-lands" assertion (drive debater contexts to cast aligning votes, observe the moderator's commit button enable, click it, observe the commit-applied broadcast) is carried by the pre-existing `participant_ui.part_pw_concurrent_with_moderator` task at `tasks/40-participant-ui.tji:334`. No new task registered.
