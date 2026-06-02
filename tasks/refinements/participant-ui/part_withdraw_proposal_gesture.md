# Refinement: `participant_ui.part_withdraw_proposal_gesture`

## TaskJuggler entry

Defined at `tasks/40-participant-ui.tji:485` —

```
task part_withdraw_proposal_gesture "Participant-tablet withdraw-proposal gesture + cross-surface 3-context propose-then-withdraw Playwright spec" {
  effort 1d
  allocate team
  depends moderator_ui.mod_withdraw_proposal_gesture
}
```

Milestone: **M7 — End-to-end debate** (`tasks/99-milestones.tji:78`, the
`m_end_to_end_debate` `depends` list names this task directly).

## Effort estimate

**1d.** The hook + button are near-mechanical mirrors of the moderator's
already-shipped surface; the participant read-surface projector cleanup
(`derivePendingProposals` + `projectGraph` honoring `entity-removed`) and
the cross-surface 3-context Playwright spec are the substance.

## Inherited dependencies

**Settled (the precedent this task mirrors):**

- `moderator_ui.mod_withdraw_proposal_gesture` (commit `d1d71a3b`,
  Done 2026-06-02) — shipped the `withdraw-proposal` / `proposal-withdrawn`
  WS message pair, the moderator `useWithdrawProposalAction` hook, the
  proposer-only withdraw button, and the moderator-side projector cleanup
  (`GraphCanvasPane` skips `entity-removed` nodes; `pendingProposals.ts`
  terminates rows on `entity-removed`). Its **§D5** deferred the
  cross-surface 3-context variant to this task. Refinement:
  `tasks/refinements/moderator-ui/mod_withdraw_proposal_gesture.md`.
- `moderator_ui.mod_withdraw_proposal_canvas_edge_annotation_removal`
  (commit `d5f9b89f`, Done 2026-06-02) — fixed the moderator edge +
  annotation canvas projectors to honor `entity-removed`. This task's
  participant-side analogue for edges is folded inline (the participant
  `projectGraph` does nodes + edges in one pass); the annotation/axiom-mark
  overlay analogue is deferred (see Acceptance criteria §A4 + the named
  follow-up).
- `participant_ui.part_e2e_user_pool_expansion_v2` (commit `0eec511c`) —
  `tests/e2e/fixtures/dev-users.ts:43-62` now carries an 18-entry
  `DEV_USER_POOL`. The cross-surface spec claims a fresh
  `{moderator, debater-A, debater-B}` triple from the pool.
- The `withdraw-proposal` wire schema is already typed and live:
  `wsWithdrawProposalPayloadSchema` at
  `packages/shared-types/src/ws-envelope.ts:1079`, registered in the
  request map at `:1717` and the ack `proposal-withdrawn` at `:1729`. No
  protocol change is needed for this task.

**Pending (surfaced by this task, deferred to named follow-ups):**

- **Zero-emission withdrawal is not observable on the immutable log.** A
  participant's only proposal is the axiom-mark, a zero-emission sub-kind;
  withdrawing it appends **no** terminator event, so the proposer's own
  pending row does not clear and any read surface stays stale. This is a
  server gap, deferred to a named backend task (see Decisions §D6 +
  Acceptance criteria §A4).

## What this task is

Give a debater on the participant tablet a **withdraw-proposal gesture** for
their own pending proposals, mirroring the moderator's withdraw button, and
make the participant read surface honor proposal retraction so a
moderator-withdrawn entity disappears from the participant's canvas and
pending-proposals pane. Concretely:

1. A participant `useWithdrawProposalAction(proposalEventId)` hook — a
   one-to-one port of the moderator hook
   (`apps/moderator/src/layout/useWithdrawProposalAction.ts`) into the
   participant app, dispatching the same three-field `withdraw-proposal`
   payload and exposing the same `{ withdraw, inFlight, lastError }` shape.
2. A proposer-only withdraw button inside the participant
   pending-proposals row (`PendingProposalsPane.tsx`'s `PendingProposalRow`),
   rendered only when `row.actor === currentParticipantId`, with in-flight
   disable + inline wire-error region.
3. Participant read-surface projector cleanup honoring `entity-removed`:
   `derivePendingProposals` terminates a row when its propose-time entities
   are retracted; `projectGraph` drops nodes/edges named by `entity-removed`.
4. A cross-surface **3-context** Playwright spec (moderator + two debaters)
   covering both the proposer-only button affordance and the
   observe-the-withdrawal-land behavior.

## Why it needs to be done

`mod_withdraw_proposal_gesture` §D5 paid the *single-actor* moderator
propose-then-withdraw e2e inline but deferred the *cross-surface* variant
because there was no participant-side withdraw affordance to drive it. This
task builds that affordance, and in doing so closes two real gaps that the
moderator withdraw gesture opened on the participant surface:

- The participant `projectGraph` **ignores** `entity-removed`
  (`apps/participant/src/graph/projectGraph.ts:443` — "are ignored at this
  layer"), so a node a moderator withdraws still renders on every
  participant tablet. Now that the moderator can withdraw, this is a live
  cross-surface staleness bug.
- The participant `derivePendingProposals` terminates rows only on `commit`
  / `meta-disagreement-marked` (`derivePendingProposals.ts:141-159`), never
  on `entity-removed`, so a withdrawn proposal's row never leaves the
  participant pending pane.

Downstream: M7 (`m_end_to_end_debate`) names this task in its `depends`
list; the full live debate the walkthrough enacts requires a debater to be
able to retract their own proposal.

## Inputs / context

**The wire contract (no change needed):**

- `packages/shared-types/src/ws-envelope.ts:1079` —
  `wsWithdrawProposalPayloadSchema = z.object({ sessionId, expectedSequence, proposalEventId })`.
  Three fields; **no** proposer id (the server reads `connection.user.id`).
- `apps/server/src/ws/handlers/withdraw.ts:306-321` — the proposer-only
  authority gate (`ApiError.forbidden` → wire `code: 'forbidden'`).
- `apps/server/src/ws/handlers/withdraw.ts:339-385` — appends one
  `entity-removed` per retracted entity, then broadcasts + acks
  `proposal-withdrawn { removedEventCount }`.
- `apps/server/src/ws/handlers/withdraw.ts:570-583` + the inverse mirror
  comment at `apps/moderator/src/graph/pendingProposals.ts:289-293` —
  **axiom-mark / annotate / set-node-substance / edit-wording / meta-move /
  break-edge / amend-node mint no structural entities at propose-time, so a
  withdraw retracts nothing**: `removedEventCount === 0` and there is no
  log-observable terminator. This is the gap behind §D6.

**The moderator surface to mirror:**

- `apps/moderator/src/layout/useWithdrawProposalAction.ts` (full file) — the
  hook: per-`proposalEventId` module-scoped Zustand slice
  (`useWithdrawProposalStore`, `:70-87`), in-flight guard (`:151-153`),
  `client.send('withdraw-proposal', { sessionId, expectedSequence, proposalEventId })`
  (`:167-171`), `toWireError` matrix (`:107-118`), localized timeout via
  `t('moderator.withdrawProposalButton.timeoutError')` (`:184`).
- `apps/moderator/src/layout/PendingProposalsPane.tsx:371-383` — hook call
  + the `isProposer = auth.status === 'authenticated' && auth.user?.userId !== undefined && row.actor === auth.user.userId`
  guard.
- `apps/moderator/src/layout/PendingProposalsPane.tsx:519-535` — the button:
  `data-testid="withdraw-proposal-button"`, `data-proposal-id`,
  `data-withdraw-state` (`disabled` | `enabled` | `in-flight`),
  `disabled` / `aria-disabled` / `aria-label`.
- `apps/moderator/src/layout/PendingProposalsPane.tsx:563-569` — the inline
  wire-error region `data-testid="withdraw-proposal-button-wire-error"`,
  `role="alert"`.
- `apps/moderator/src/graph/pendingProposals.ts:196-204` (terminate on
  `entity-removed`) + `:248-295` (`registerProposeTimeEntities`, the inverse
  of `entitiesToRetractForWithdraw`) — the projector-cleanup pattern to
  port.

**The participant surface to extend:**

- `apps/participant/src/proposals/PendingProposalsPane.tsx` — the pane reads
  `currentParticipantId` from props (`:60`, `:69-73`) and renders
  `PendingProposalRow` (`:158-249`). `currentParticipantId` is **not yet
  threaded into the row** — this task threads it down so the row can compute
  `isProposer = row.actor === currentParticipantId`.
- `apps/participant/src/proposals/derivePendingProposals.ts:112-182` — the
  pure selector to extend with the `entity-removed` terminator + a
  `registerProposeTimeEntities` mirror (`PendingProposalRow.actor` already
  carries the proposer id, `:81`).
- `apps/participant/src/graph/projectGraph.ts:440-446` — the projector that
  currently ignores `entity-removed`; extend its node/edge passes to skip
  retracted entities.
- `apps/participant/src/routes/OperateRoute.tsx:433` — the pane mount; it
  already passes `currentParticipantId={currentParticipantId}` (the
  authenticated `auth.user.userId`, resolved at `:226`).
- `apps/participant/src/detail/useWithdrawAgreementAction.ts` (full file) —
  the existing participant withdraw-**agreement** hook; the closest local
  precedent for the participant hook idiom (route-param `sessionId`,
  `useWsClient`, `expectedSequence` from `lastAppliedSequence`,
  `participant.withdrawAgreementButton.timeoutError` i18n key). **Do not
  conflate**: that hook withdraws a per-facet *agreement*
  (`withdraw-agreement`); this task withdraws a *proposal*
  (`withdraw-proposal`).
- `apps/participant/src/detail/useAxiomMarkAction.ts:204-220` — the only
  participant `client.send('propose', …)` call site (kind `axiom-mark`); the
  gesture the cross-surface spec drives to create a participant-authored
  proposal.

**e2e infrastructure:**

- `tests/e2e/fixtures/dev-users.ts:43-62` — `DEV_USER_POOL` (18 users).
- `tests/e2e/fixtures/authed-context.ts:48-53` — `authedContext(browser, username)`
  (pre-seeded storage-state context, one per surface).
- `playwright.config.ts` — `chromium-cross-surface` is the project that
  hosts specs spanning moderator + participant contexts (e.g.
  `cross-surface-lobby-start.spec.ts`, `methodology-full-flow.spec.ts`).
- Moderator single-actor precedent:
  `tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts` Scenario 4
  — proposes via `capture-text-input-textarea`, withdraws via
  `withdraw-proposal-button`, asserts `statement-node-<id>` count → 0 and
  `pending-proposal-row` count → 0.

**ADRs in force:** 0003 (React), 0021 (event envelope / typed wire union),
0022 (no throwaway verifications), 0024 (i18n via react-i18next), 0026
(host owns auth chrome; surface consumes `useAuth()` + `useWsClient()`),
0030 (per-facet vote model — the proposal lifecycle terminators).

## Constraints / requirements

1. **Reuse the live wire contract.** Dispatch the existing
   `withdraw-proposal` message verbatim; no schema, handler, or broadcast
   change in this task.
2. **Proposer-only UX guard, server is authority.** Render the button only
   when `row.actor === currentParticipantId`. The server's `forbidden` gate
   (`withdraw.ts:313`) remains the real enforcement; the hide keeps the
   happy path branchless and matches the moderator's posture.
3. **Mirror, do not extract.** Port the moderator hook into the participant
   app as a sibling module rather than hoisting a shared hook into
   `@a-conversa/shell`. The two apps are independent micro-frontends
   (ADR 0026); the moderator's `derivePendingProposals` /
   `pendingProposals.ts` duplication precedent
   (`part_proposal_list_view` Decision §1) says duplication is deliberate
   until a third consumer triggers extraction. (See §D2.)
4. **Pure projectors stay pure.** `derivePendingProposals` and
   `projectGraph` remain side-effect-free functions over the event log — no
   `Date.now()`, no store reads. The `entity-removed` terminator is derived
   from the log alone (the server already persists `entity-removed` for the
   kinds that mint entities).
5. **i18n parity (ADR 0024).** New catalog keys
   `participant.withdrawProposalButton.{label,inFlightLabel,ariaLabel,timeoutError}`
   land with `pt-BR` / `es-419` parity, mirroring
   `moderator.withdrawProposalButton.*` and the existing
   `participant.withdrawAgreementButton.*` keys.
6. **Per-row re-render isolation.** Per-`proposalEventId` Zustand selector
   subscriptions, exactly as the moderator hook — a withdraw on row A does
   not re-render row B's button.
7. **File scope — touch only the participant app + tests + i18n catalogs.**
   No server file, no `@a-conversa/shell` file, no moderator file.

## Acceptance criteria

All checks ship as committed tests (ADR 0022 — no throwaway verifications).

**§A1 — Hook (Vitest, `useWithdrawProposalAction.test.tsx`).** Mirrors the
moderator hook's test surface: a `withdraw()` call dispatches
`withdraw-proposal` with `{ sessionId, expectedSequence, proposalEventId }`;
`inFlight` flips true during the round-trip and false after;
`lastError` carries the mapped `WsRequestError` payload on rejection and the
localized timeout message on `WsRequestTimeoutError`; a concurrent
`withdraw()` while in-flight is a no-op; two hook instances bound to
distinct `proposalEventId`s keep disjoint state.

**§A2 — Button + guard (Vitest, `PendingProposalsPane.test.tsx`
extension).** The withdraw button
(`data-testid="participant-withdraw-proposal-button"`,
`data-proposal-id`, `data-withdraw-state`) renders **only** on rows whose
`actor === currentParticipantId`; it is absent on rows authored by another
participant or by the moderator/system (`actor === null`). Clicking it calls
the hook's `withdraw()`; the in-flight state disables it; a wire error
renders in `data-testid="participant-withdraw-proposal-button-wire-error"`
(`role="alert"`).

**§A3 — Projector cleanup (Vitest).**
- `derivePendingProposals.test.ts`: a proposal that minted an entity
  (`capture-node` / `decompose` / `interpretive-split` / connecting
  `set-edge-substance`) is dropped from the pending list once a later
  `entity-removed` names one of its minted entities — mirror of the
  moderator `pendingProposals.ts` cases.
- `projectGraph.test.ts`: a node (and an edge) named by a later
  `entity-removed` is absent from the projected graph; entities never
  retracted are unaffected.

**§A4 — Cross-surface 3-context Playwright spec**
(`tests/e2e/cross-surface-participant-withdraw-proposal.spec.ts`, project
`chromium-cross-surface`). Claims a fresh `{moderator, debater-A, debater-B}`
triple from `DEV_USER_POOL`. Two blocks:

- **Block 1 — proposer-only affordance + accepted withdraw round-trip.**
  Debater-A marks a node as axiom from the tablet
  (`useAxiomMarkAction` gesture). The axiom-mark proposal row appears in the
  pending pane on all three surfaces. Assert the withdraw button is visible
  **only** on debater-A's tablet (absent on debater-B's tablet; the
  moderator console's proposer-only guard also hides it, since the moderator
  is not the actor). Debater-A clicks withdraw → the
  `participant-withdraw-proposal-button-wire-error` region stays empty (the
  `proposal-withdrawn` ack lands cleanly). This pins the new gesture's
  user-visible behavior end-to-end.
- **Block 2 — observe-the-withdrawal-land (projector cleanup).** The
  moderator captures a node (existing `capture-text-input-textarea`
  gesture); both debaters observe the proposed node on their canvas
  (`statement-node-<id>`) **and** the pending row
  (`participant-pending-proposal-row`). The moderator withdraws it (existing
  `withdraw-proposal-button`); both debaters observe the node leave their
  canvas (count → 0) **and** the pending row vanish (count → 0). This pins
  the participant `projectGraph` + `derivePendingProposals`
  `entity-removed` cleanup across surfaces and pays down the
  `mod_withdraw_proposal_gesture` §D5 cross-surface debt in the
  fully-observable direction.

**§A4 deferred sub-scenario (per the UI-stream e2e policy — surface not yet
reachable).** The natural counterpart to Block 1 — *debater-A withdraws
their own axiom-mark and the row + axiom-mark overlay vanish on all
surfaces* — is **deferred because it is not observable today**: an
axiom-mark is a zero-emission proposal, so the server appends no terminator
event on withdraw (`withdraw.ts:570-583`;
`pendingProposals.ts:289-293`). The unit coverage in §A1/§A2 (dispatch +
proposer-only guard + accepted ack) stands in for it for now. It is deferred
to the named follow-ups below, whose work makes the row/overlay removal
observable; their refinements MUST scope the deferred Playwright assertion
(closer registers in WBS, milestone M7):

- **`backend.websocket_protocol.ws_withdraw_proposal_zero_emission_terminator`**
  (~1d) — make `withdraw-proposal` append a persisted, log-observable
  terminator for zero-emission proposal withdrawals (axiom-mark / annotate /
  the other no-emission sub-kinds) so every read surface converges; add the
  Cucumber scenario at the WS/replay seam (the `ws_withdraw_proposal_message`
  precedent) and terminate both pending panes on it. Its refinement decides
  the terminator's exact shape (a dedicated `proposal-withdrawn` event vs. an
  overlay-entity `entity-removed`) and writes an ADR if that introduces a new
  event kind.
- **`participant_ui.part_withdraw_proposal_overlay_removal`** (~0.5d,
  `depends` the backend task above + this task) — port the participant
  axiom-mark + annotation overlay projectors
  (`apps/participant/src/graph/axiomMarks.ts`,
  `apps/participant/src/graph/annotations.ts`) to honor the new terminator,
  and extend the cross-surface spec with the deferred Block-1 counterpart
  (debater-A's own axiom-mark row + overlay vanish after self-withdraw). This
  is the participant analogue of
  `mod_withdraw_proposal_canvas_edge_annotation_removal`.

## Decisions

**§D1 — Proposer-only render guard reuses the moderator pattern verbatim.**
Compute `isProposer = row.actor === currentParticipantId` and render the
button only when true. *Rationale:* identical to the moderator
(`PendingProposalsPane.tsx:380-383`), keeps the happy path branchless, and
the server's `forbidden` gate is the real authority. *Alternative rejected:*
always render + disable for non-proposers — adds a dead affordance and a
second visual state to localize for no benefit (a non-proposer has no reason
to see a withdraw control on someone else's proposal).

**§D2 — Port the hook into the participant app, do not extract to shell.**
Create `apps/participant/src/proposals/useWithdrawProposalAction.ts` as a
near-verbatim copy of the moderator hook (participant `useWsStore` /
`useWsClient` imports, `participant.withdrawProposalButton.timeoutError`
key). *Rationale:* the two surfaces are independent micro-frontends
(ADR 0026); the existing moderator/participant `derivePendingProposals`
duplication (`part_proposal_list_view` §1) is the standing precedent —
extraction waits for a third consumer (audience/replay). *Alternative
rejected:* hoist a shared hook into `@a-conversa/shell` now — premature; it
would couple two surfaces' store wiring with only two call sites and no
audience/replay withdraw surface on the horizon.

**§D3 — Fold the participant edge cleanup into this task; defer the overlay
cleanup.** The participant `projectGraph` projects nodes and edges in one
pass, so honoring `entity-removed` for both is one coherent change and lands
here (the moderator needed a *separate* task only because its node and
edge/annotation projectors are split across `GraphCanvasPane` /
`selectors.ts`). The axiom-mark + annotation **overlay** projectors are
separate modules and are blocked on the zero-emission terminator anyway, so
they defer to `part_withdraw_proposal_overlay_removal`. *Rationale:* matches
the structural reality of the participant projector, keeps this task's
observable e2e (Block 2) green, and avoids shipping overlay cleanup that
cannot be exercised until the server terminator lands.

**§D4 — Block 1 asserts affordance + accepted round-trip, not row removal.**
Because axiom-mark is zero-emission, debater-A's own row will not vanish on
withdraw until the server terminator lands. Block 1 therefore pins what *is*
observable today — the proposer-only button visibility and a clean
`proposal-withdrawn` ack (empty wire-error region) — and the
disappearance assertion is deferred (§A4 deferred sub-scenario).
*Rationale:* tests must pin true observable behavior (ADR 0022); asserting a
row removal that the server cannot yet effect would be a flaky/false test.
*Alternative rejected:* drive Block 1 with a moderator-created node proposal
withdrawn by the participant — impossible, the proposer-only gate (correctly)
forbids a non-proposer withdraw.

**§D5 — Block 2 exercises the moderator's existing withdraw to pin the
participant projector cleanup.** The fully-observable cross-surface
propose-then-withdraw uses the moderator (who *can* mint a node) as the
proposer/withdrawer and the two debaters as observers. *Rationale:* this is
the reachable, deterministic way to assert that a withdrawn structural
entity disappears on the participant surface — the actual new participant
behavior this task ships — and it satisfies the §D5 cross-surface 3-context
debt from `mod_withdraw_proposal_gesture`. *Alternative rejected:* wait for
the server terminator and test only participant-authored withdrawal —
needlessly couples this task's e2e to a separate backend task and leaves the
live `projectGraph` staleness bug unpinned.

**§D6 — Surface the zero-emission terminator gap; defer the fix to a named
backend task, do not solve it here.** A participant-UI task must not redesign
the server's withdraw semantics or the immutable-log event vocabulary; that
is a methodology/protocol decision (and likely an ADR). This refinement
documents the gap precisely and registers
`ws_withdraw_proposal_zero_emission_terminator` to own it. *Rationale:*
respects the file-scope boundary (Constraint §7) and the "make the
defensible call at the right layer" rule — the right layer for "how is a
zero-emission withdrawal made observable" is the server task's own
refinement. *Alternative rejected:* a participant-only optimistic removal
(track withdrawn ids from the `proposal-withdrawn` ack in `wsStore` and
filter them in `derivePendingProposals`) — it would clear the proposer's own
row but leave every *other* surface stale, producing divergent cross-surface
state; convergence requires a persisted log event, which only the server can
append.

## Open questions

(none — all decided; the zero-emission terminator is a deferred,
named-and-registered follow-up per §D6, not an open question for this task.)

## Status

**Done** — 2026-06-02.

- Created `apps/participant/src/proposals/useWithdrawProposalAction.ts` — participant-side withdraw-proposal hook (mirror of moderator hook; per-`proposalEventId` Zustand slice, in-flight guard, `participant.withdrawProposalButton.*` i18n keys).
- Created `apps/participant/src/proposals/useWithdrawProposalAction.test.tsx` — Vitest §A1 coverage: dispatch, in-flight flip, forbidden/timeout error mapping, concurrent no-op, per-id state isolation.
- Edited `apps/participant/src/proposals/PendingProposalsPane.tsx` — threaded `currentParticipantId` into `PendingProposalRow`; added proposer-only withdraw button (`data-testid="participant-withdraw-proposal-button"`, `data-proposal-id`, `data-withdraw-state`) + inline wire-error region (`data-testid="participant-withdraw-proposal-button-wire-error"`).
- Edited `apps/participant/src/proposals/PendingProposalsPane.test.tsx` — §A2 block: proposer-only guard (absent for other/system actor), click→dispatch, in-flight disable, wire-error region.
- Edited `apps/participant/src/proposals/derivePendingProposals.ts` — added `entity-removed` terminator + `registerProposeTimeEntities` mirror (§A3).
- Edited `apps/participant/src/proposals/derivePendingProposals.test.ts` — cases (j)–(m) covering the `entity-removed` row termination.
- Edited `apps/participant/src/graph/projectGraph.ts` — extended node/edge passes to skip retracted entities named by `entity-removed`.
- Edited `apps/participant/src/graph/projectGraph.test.ts` — "entity-removed (withdraw) cleanup" describe block (§A3).
- Edited `apps/participant/src/proposals/index.ts` — barrel export for new hook.
- Edited `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json` — added `participant.withdrawProposalButton.{label,inFlightLabel,ariaLabel,timeoutError}` keys; `pt-BR.review.json` and `es-419.review.json` updated with pending-review flags.
- Created `tests/e2e/cross-surface-participant-withdraw-proposal.spec.ts` — 3-context Playwright spec (§A4): Block 1 (proposer-only affordance + accepted ack, axiom-mark path); Block 2 (moderator-proposed node cross-surface disappearance, pins `projectGraph` + `derivePendingProposals` `entity-removed` cleanup).
- Block 1 self-withdraw row/overlay disappearance deferred per §D4 (axiom-mark is zero-emission); registered follow-ups: `backend.websocket_protocol.ws_withdraw_proposal_zero_emission_terminator` and `participant_ui.part_withdraw_proposal_overlay_removal`.
