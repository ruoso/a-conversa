# mod_withdraw_proposal_gesture — proposer-side withdraw-proposal gesture (UI + dispatch through WS)

## TaskJuggler entry

- WBS leaf: `moderator_ui.mod_withdraw_proposal_gesture`
- Definition: [`tasks/30-moderator-ui.tji` L894–903](../../30-moderator-ui.tji#L894)
- Title: _"Proposer-side withdraw-proposal gesture wiring (UI + dispatch through WS)"_
- Source of debt (per the `.tji` `note`):
  [`mod_proposed_entity_canvas_visibility.md` D4 + D7](./mod_proposed_entity_canvas_visibility.md) —
  the `entity-removed` event kind, payload schema, and SQL migration landed with
  `mod_proposed_entity_canvas_visibility`; the proposer-only `withdraw-proposal`
  WS handler landed with `backend.ws_withdraw_proposal_message`. The **proposer-side
  UI gesture** that dispatches the WS `withdraw-proposal` message was the missing
  piece, and Scenario 4 (propose-then-withdraw) was deferred from the
  canvas-visibility e2e against this task. This task closes that gap.

## Effort estimate

`1d` (per the `.tji` block). The engine, wire vocabulary, and broadcast lifecycle
already exist end-to-end; the budget is one per-proposal action hook, a
proposer-gated button on the pending-proposals row, the i18n strings, and the
tests — including the single-actor Playwright spec that pays down the deferred
Scenario 4 debt.

> **Implementation state at refinement time.** The hook, the button, the unit /
> component coverage, and the i18n strings already landed on `main` in commit
> `9bdb83ad` ("moderator(withdraw): proposer-side withdraw-proposal button +
> useWithdrawProposalAction hook"). They are documented below as the shape this
> task ships. The **outstanding deliverable** for the task to reach `complete 100`
> is the single-actor Playwright spec scoped under Acceptance criteria — the
> gesture is now route-rendered and reachable, so the deferred-e2e debt must be
> paid here, not pushed forward again.

## Inherited dependencies

`depends !mod_graph_rendering.mod_proposed_entity_canvas_visibility,
backend.websocket_protocol.ws_withdraw_proposal_message` — **both shipped
(`complete 100`).**

**Settled by `mod_proposed_entity_canvas_visibility` (shipped):**

- Proposed entities render on the moderator canvas in `proposed` state from the
  moment of proposal, and a row appears in the pending-proposals pane. The
  pending-proposal row carries `row.proposalEventId` (the proposal envelope id) and
  `row.actor` (the original proposer's user id, from `event.actor`).
- **D4 — `entity-removed` is explicit**, not derived: withdraw emits one
  `entity-removed` event per propose-time-created entity. Payload at
  [`packages/shared-types/src/events.ts:630`](../../../packages/shared-types/src/events.ts):
  `{ entity_kind: 'node'|'edge'|'annotation', entity_id, removed_by, removed_at }`.
- **D7 — proposer-only authority**: only the original proposer (the `actor` on the
  original `proposal` event) may withdraw; non-proposer rejection maps to wire 403.

**Settled by `backend.ws_withdraw_proposal_message` (shipped — see
[`tasks/refinements/backend/ws_withdraw_proposal_message.md`](../backend/ws_withdraw_proposal_message.md)):**

- The wire vocabulary: `'withdraw-proposal'` (Group B, client→server) at
  [`packages/shared-types/src/ws-envelope.ts:123`](../../../packages/shared-types/src/ws-envelope.ts)
  with payload `{ sessionId, expectedSequence, proposalEventId }`
  ([schema reg. L1717](../../../packages/shared-types/src/ws-envelope.ts)); and
  `'proposal-withdrawn'` (Group C, server→client ack, correlated via `inResponseTo`)
  at [L137](../../../packages/shared-types/src/ws-envelope.ts) ([reg. L1729](../../../packages/shared-types/src/ws-envelope.ts)).
  **The payload carries no `proposerId` field** — actor identity is taken from the
  authenticated connection server-side, and a spoofed client-supplied id is stripped
  by the closed Zod schema (D4 there).
- The handler at `apps/server/src/ws/handlers/withdraw.ts` enforces proposer
  authority (→403), proposal-state gates (not-found→404, already-committed /
  already-meta-disagreement→422), and optimistic-concurrency (sequence-mismatch→409),
  and emits the `entity-removed` events + `proposal-withdrawn` ack. The handler
  derives **which** entities to retract from the proposal's sub-kind — the client
  passes only the `proposalEventId`. Covered by Vitest + Cucumber wire-path tests.

**Pending / out of this task's hands:** the participant-tablet withdraw-proposal
gesture (a debater withdrawing their own proposal from the participant surface) and
the cross-surface 3-context propose-then-withdraw walk — deferred to a named
follow-up task (§D5, Acceptance criteria).

## What this task is

Give the **original proposer** a one-tap affordance to retract a still-pending
proposal, dispatching the existing `withdraw-proposal` WS message and letting the
already-shipped broadcast lifecycle remove the proposed entity from every connected
canvas.

Concretely:

1. `useWithdrawProposalAction(proposalEventId)` — a per-proposal action hook
   mirroring the established affordance-hook pattern (`useEditWordingAction` /
   `useBreakEdgeAction`): a module-scoped Zustand slice keyed by `proposalEventId`
   tracking `inFlight` / `lastError`, and a `withdraw()` that reads the active
   `sessionId` and `expectedSequence` and calls
   `client.send('withdraw-proposal', { sessionId, expectedSequence, proposalEventId })`.
2. A **proposer-only "Withdraw" button** on each pending-proposal row in
   `PendingProposalsPane`, rendered only when the current user is the proposal's
   `actor`, with in-flight label and a wire-error region.
3. The i18n strings (`moderator.withdrawProposalButton.*`) with `pt-BR` / `es-419`
   parity (ADR 0024).
4. Vitest coverage for the hook + the component's proposer-gating / dispatch /
   error surface, **and** a single-actor Playwright spec that proposes a
   free-floating statement and then withdraws it, asserting the node leaves the
   canvas — paying down the Scenario 4 deferral.

## Why it needs to be done

`mod_proposed_entity_canvas_visibility` made a proposal appear on the canvas the
moment it is made; without a withdraw gesture a proposer who mis-proposes has no way
to take it back from the UI — the only retraction path was the raw WS message with
no surface. The methodology treats a proposal as a reversible move until it commits;
the proposer needs a first-class "undo" for their own pending proposal. The WS
handler and the `entity-removed` broadcast already exist precisely to back this
gesture — this task is the surface that drives them, and it is the leaf the
canvas-visibility e2e explicitly deferred Scenario 4 against.

## Inputs / context

**The action hook (shipped in `9bdb83ad`):**

- [`apps/moderator/src/layout/useWithdrawProposalAction.ts:47-53`](../../../apps/moderator/src/layout/useWithdrawProposalAction.ts) —
  result interface `{ withdraw: () => Promise<void>; inFlight: boolean; lastError: WireError | undefined }`.
- [`useWithdrawProposalAction.ts:70-87`](../../../apps/moderator/src/layout/useWithdrawProposalAction.ts) —
  module-scoped `useWithdrawProposalStore` (per-`proposalEventId` `withdrawing` set +
  `errors` map), so two buttons for different proposals don't cross-contaminate.
- [`useWithdrawProposalAction.ts:136`](../../../apps/moderator/src/layout/useWithdrawProposalAction.ts) —
  `sessionId` from `useParams<{ id: string }>()`.
- [`useWithdrawProposalAction.ts:165-171`](../../../apps/moderator/src/layout/useWithdrawProposalAction.ts) —
  `expectedSequence` from `useWsStore().sessionState[sessionId]?.lastAppliedSequence ?? 0`,
  then `await client.send('withdraw-proposal', { sessionId, expectedSequence, proposalEventId })`.
  In-flight flips around the await; the catch arm surfaces a `WireError` via
  `lastError` ([L177, L184-187](../../../apps/moderator/src/layout/useWithdrawProposalAction.ts)).

**The pending-proposals row + button (shipped in `9bdb83ad`):**

- [`apps/moderator/src/layout/PendingProposalsPane.tsx:375`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx) —
  `useWithdrawProposalAction(row.proposalEventId)`.
- [`PendingProposalsPane.tsx:376-383`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx) —
  `const auth = useAuth()`; `isProposer = auth.status === 'authenticated' &&
  auth.user?.userId !== undefined && row.actor === auth.user.userId`.
- [`PendingProposalsPane.tsx:519-535`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx) —
  the `{isProposer ? <button data-testid="withdraw-proposal-button" …> : null}`
  affordance; wire-error region `data-testid="withdraw-proposal-button-wire-error"`
  at [L565](../../../apps/moderator/src/layout/PendingProposalsPane.tsx).

**The WS client seam (already knows the message):**

- [`packages/shell/src/ws/client.ts:447-493`](../../../packages/shell/src/ws/client.ts) —
  the typed `send(type, payload): Promise<WsEnvelopeUnion>`; ack correlation via
  `inResponseTo` at [L328-341](../../../packages/shell/src/ws/client.ts) (rejects with
  `WsRequestError` on an `error` ack). `'withdraw-proposal'` / `'proposal-withdrawn'`
  are already in the envelope union — **no client-class change required.**

**The proposer identity source (server-side, for the authority gate):**

- `PendingProposal.proposer: string | null` at
  [`apps/server/src/projection/types.ts:176`](../../../apps/server/src/projection/types.ts),
  derived from the original `proposal` event's `actor`. The moderator client cannot
  query this directly — it compares the current user's `userId` against the row's
  `actor` (the same `actor` the server stores as `proposer`).
- `useAuth()` shape `{ status, user: { userId, screenName } }` at
  [`packages/shell/src/auth/AuthProvider.tsx:50-56`](../../../packages/shell/src/auth/AuthProvider.tsx).

**The deferred e2e this task pays down:**

- [`tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts:398-413`](../../../tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts) —
  the comment that intentionally **leaves out** Scenario 4 (propose-then-withdraw)
  rather than `test.fixme`, naming `mod_withdraw_proposal_gesture` as the follow-up
  whose refinement "MUST scope its own Playwright cell." Scenarios 1–3 in that file
  (free-floating propose, set-edge-substance, decompose) are the seed/observe shape
  to extend.
- The cross-surface 3-context fixture shape lives at
  [`tests/e2e/cross-surface-lobby-start.spec.ts:46-95`](../../../tests/e2e/cross-surface-lobby-start.spec.ts)
  (moderator + two debaters) — relevant only to the **deferred** 3-context variant
  (§D5), not the single-actor spec this task lands.

## Constraints / requirements

1. **No new wire / engine surface.** Dispatch only the existing `'withdraw-proposal'`
   message with payload `{ sessionId, expectedSequence, proposalEventId }`. No new
   event kind, no schema change, no second message type. The client passes only the
   `proposalEventId`; the server derives which entities to retract.
2. **It is a dedicated message, not `propose { kind: 'withdraw' }`.** Withdraw is its
   own request/ack pair (`withdraw-proposal` → `proposal-withdrawn`), distinct from
   the `propose` lifecycle, because a withdraw retracts entities rather than minting a
   proposal (§D1).
3. **Proposer-gated affordance.** The button renders only when
   `row.actor === auth.user.userId` (current user is the original proposer). This is
   UX gating only — the server independently enforces proposer authority (defense in
   depth, §D3).
4. **Per-proposal in-flight / error isolation.** State is keyed by `proposalEventId`
   in a module-scoped store so concurrent rows don't share in-flight/error state.
5. **Reuse the affordance-hook pattern.** `useWithdrawProposalAction` mirrors
   `useEditWordingAction` / `useBreakEdgeAction`'s store + `client.send(...)` shape;
   no inlined `client.send` in the component.
6. **i18n via `useTranslation` (ADR 0024).** `moderator.withdrawProposalButton.*`
   (label, in-flight label, error) with `pt-BR` / `es-419` parity.
7. **Wire errors are surfaced, not swallowed.** A `forbidden` / `not-found` /
   `already-committed` / `sequence-mismatch` ack must render in the row's wire-error
   region via `lastError`, not be dropped.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check
below ships as a committed test — no throwaway verification.

**Vitest — `useWithdrawProposalAction` (shipped at
[`useWithdrawProposalAction.test.tsx`](../../../apps/moderator/src/layout/useWithdrawProposalAction.test.tsx)):**

1. `withdraw()` calls `client.send('withdraw-proposal', …)` with the bound
   `proposalEventId`, the active `sessionId`, and the current `expectedSequence`.
2. `inFlight` flips true→false around the await; a second `withdraw()` while one is
   in flight is a no-op for the same `proposalEventId`.
3. A `WireError` ack (e.g. `forbidden`, `sequence-mismatch`, `timeout`) surfaces via
   `lastError`; a success clears any prior error. State is isolated per
   `proposalEventId`.

**Vitest — `<PendingProposalsPane>` row (shipped at
[`PendingProposalsPane.test.tsx`](../../../apps/moderator/src/layout/PendingProposalsPane.test.tsx)):**

4. The withdraw button renders **only** when the current user is the proposal's
   `actor` (`isProposer`); a non-proposer / unauthenticated viewer sees no button.
5. Clicking the button invokes the hook's `withdraw()`; the in-flight label renders
   while in flight; a wire error renders in the `withdraw-proposal-button-wire-error`
   region.

**i18n parity:** `moderator.withdrawProposalButton.*` present in `en-US`, `pt-BR`,
`es-419` (catalog-parity check, shipped).

**Playwright — single-actor propose-then-withdraw (IN SCOPE; extends
[`tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts`](../../../tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts)):**

6. As the moderator: propose a free-floating statement (reusing the Scenario 1
   `proposeStatement` flow) → exactly one `statement-node` renders with
   `data-facet-status="proposed"` and a pending-proposal row appears with a withdraw
   button (the moderator is the proposer). Click the withdraw button → the
   `proposal-withdrawn` ack returns, the `entity-removed` broadcast applies, and the
   proposed node **leaves the canvas** (assert zero matching `statement-node`
   elements) and the pending-proposal row is removed.

   The withdraw button is **route-rendered in the operate console and the proposal
   is seedable by the moderator's own propose gesture**, so e2e is **in scope, not
   deferred** (strict reachability test met). This spec **replaces the deferred
   Scenario 4 cell** for the single-actor case — re-adding it satisfies the
   canvas-visibility refinement's instruction that this task scope its own Playwright
   coverage.

**Deferred — cross-surface 3-context propose-then-withdraw** to a new task
`participant_ui.part_withdraw_proposal_gesture` — _"Participant-tablet
withdraw-proposal gesture (debater withdraws own pending proposal) + cross-surface
3-context propose-then-withdraw Playwright spec"_, effort `~1d`, milestone
**`m_participant_mvp`** (closer registers in WBS; depends on this task and on the
participant operate surface). Rationale: the original Scenario 4 exercised a
**debater** proposing and withdrawing from the participant surface while the
moderator observes the node disappear on a second context — that requires a
participant-side withdraw affordance, which does not exist yet and is not part of the
moderator console. The cheap single-actor observable behavior is paid inline (#6);
only the genuinely-unreachable cross-surface dimension is deferred, to a **new
dedicated task** (not piled on an existing catch-all e2e leaf, per the e2e policy's
debt-watch).

## Decisions

**§D1 — Dedicated `withdraw-proposal` message, not `propose { kind: 'withdraw' }`.**
A withdraw retracts the entities a proposal introduced (emitting `entity-removed`),
which is the inverse of `propose`, not another proposal. The backend
(`ws_withdraw_proposal_message`) settled this as its own request/ack pair; the
gesture dispatches it directly via `client.send('withdraw-proposal', …)`. _Alternative
rejected:_ overloading `propose` with a withdraw kind — would entangle two opposite
lifecycles on one message and break the propose-emits-a-`proposal`-event contract.

**§D2 — The gesture lives on the pending-proposals row, not the graph context menu.**
The stable identity a withdraw needs is the **`proposalEventId`** (the proposal
envelope), which the pending-proposal row carries directly (`row.proposalEventId`).
The canvas nodes/edges carry their own **structural** ids (`node_id` / `edge_id`),
not the proposal envelope id, and a single proposal can introduce several entities —
so a per-row button maps one-to-one to a withdraw, while a per-node context menu
would be ambiguous for multi-entity proposals and would have to reverse-map node→
proposal. The row is also where proposer-gating is naturally scoped (`row.actor`).
_Alternative rejected:_ a "Withdraw" item on the node/edge context menu
([`GraphCanvasPane.tsx` `handleNodeContextMenu`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx)) —
ambiguous identity for multi-entity proposals and redundant proposer lookup.

**§D3 — Proposer-only affordance is UX gating; the server enforces authority.** The
button renders only when `row.actor === auth.user.userId`, so non-proposers never see
it. This is **not** the security boundary — the WS handler independently rejects a
non-proposer with wire 403 (D7 of the canvas-visibility refinement; the handler reads
`connection.user.id`, and the closed payload schema strips any spoofed `proposerId`).
Client gating + server enforcement is defense in depth: the UI stays honest for the
common case while the engine remains the source of truth. _Alternative rejected:_
client-only gating with a permissive handler — would let a crafted client withdraw
another participant's proposal.

**§D4 — Client passes only `proposalEventId`; the server derives the retraction set.**
The handler reads the proposal's payload (via `findProposal`) and emits the inverse
`entity-removed` events per sub-kind. The UI does not enumerate the entities to remove
— it cannot reliably mirror the per-sub-kind mapping, and duplicating it client-side
would create an inverse-pair invariant to keep in lockstep across two codebases.
_Alternative rejected:_ the client computing and sending the entity ids — needless
coupling and a second place the propose↔withdraw inverse could drift.

**§D5 — Single-actor e2e in scope; 3-context cross-surface deferred to a new task.**
The moderator can both propose and withdraw their own proposal in a single context
today, so under the strict UI-stream reachability test the single-actor
propose-then-withdraw is paid inline as Playwright (#6), discharging the
canvas-visibility Scenario 4 deferral for that case. The cross-surface variant (a
debater proposing/withdrawing from the participant tablet while the moderator
observes) is genuinely unreachable until a participant-side withdraw gesture exists,
so it is deferred to a **new** `participant_ui.part_withdraw_proposal_gesture` task
rather than to an existing catch-all e2e leaf. _Alternative rejected:_ full deferral
of all withdraw e2e to a future task — the surface is reachable now (the wrong
default per the e2e policy).

**§D6 — No new ADR.** This task adds no dependency, no wire/engine surface, and no
new architectural seam — it reuses the WS client, the affordance-hook pattern, the
pending-proposals row, and the existing `withdraw-proposal` message and
`entity-removed` lifecycle. The UI-shape call (row button vs context menu, §D2) is a
local choice recorded here. No ADR warranted.

## Open questions

(none — all decided.)

## Status

**Done** — 2026-06-02.

- Playwright — `tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts`: added Scenario 4 (single-actor propose-then-withdraw), replacing the deferred comment block; asserts proposed node leaves canvas and pending-proposal row is removed after the moderator withdraws their own proposal.
- `apps/moderator/src/graph/GraphCanvasPane.tsx`: fixed `projectNodes` to collect `entity-removed` ids (with `entity_kind: 'node'`) in an up-front pass and skip those `node-created` nodes so the withdrawn entity leaves the canvas.
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx`: added unit test for `entity-removed` node projection (plus `makeEntityRemoved` helper); 115 tests green.
- `apps/moderator/src/graph/pendingProposals.ts`: fixed `derivePendingProposals` to build a propose-time-entity → proposal-event-id map and terminate a pending row when a later `entity-removed` names one of its minted entities (covering capture-node / decompose / interpretive-split / set-edge-substance).
- `apps/moderator/src/graph/pendingProposals.test.ts`: added 4 withdraw-termination cases plus classification-field fix on decompose fixture; 35 tests green.
- `tests/e2e/methodology-full-flow.spec.ts`: fixed Phase 12.1 settlement locator to use `wire-error[data-proposal-id=…] OR body:not(:has(pending-proposal-row[data-proposal-id=…]))` after `derivePendingProposals` correctly removes the last pending row on withdraw.
- Tech-debt registered: `moderator_ui.mod_withdraw_proposal_canvas_edge_annotation_removal` (edge/annotation canvas projectors also ignore `entity-removed`; ~0.5d, M7) and `participant_ui.part_withdraw_proposal_gesture` (participant-tablet withdraw + cross-surface 3-context e2e; ~1d, M7).
