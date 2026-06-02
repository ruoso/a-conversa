# 0037 — `proposal-withdrawn` terminator event for log-silent (zero-emission) withdrawals

## Status

Accepted

## Context

A pending proposal has exactly three terminal dispositions: it is **committed**, marked a **meta-disagreement**, or **withdrawn** by its proposer. The first two have explicit, proposal-keyed events on the immutable log — `commit` (`target: 'proposal'`) and `meta-disagreement-marked` (`target: 'proposal'`). Every projector terminates a pending proposal by a single-event lookup against those two kinds (`apps/server/src/projection/replay.ts` `handleCommit` / `handleMetaDisagreementMarked`; the client mirrors in `apps/moderator/src/graph/pendingProposals.ts` and `apps/participant/src/proposals/derivePendingProposals.ts`).

The **withdrawn** disposition has no explicit event. Per ADR 0027 (entity/facet layer separation) and the `ws_withdraw_proposal_message` refinement (D5), `withdraw-proposal` appends only `entity-removed` events — one per entity the proposal minted at propose-time — and the original `proposal` envelope stays on the log forever. Termination of the pending row was left to be *inferred* from those `entity-removed` events: each client keeps a `proposalByCreatedEntity` mirror of the server's `entitiesToRetractForWithdraw` mapping and treats "an entity this proposal created was removed" as "this proposal is no longer pending."

That inference only works when the withdraw produces at least one `entity-removed` event. Seven proposal sub-kinds — `axiom-mark`, `annotate`, `set-node-substance`, `edit-wording`, `meta-move`, `break-edge`, `amend-node` — mint **no** structural entity at propose-time (`apps/server/src/ws/handlers/withdraw.ts:570-583`). Withdrawing one of these appends **nothing** to the log:

- The proposer's own pending row never clears (no terminator to infer from).
- The server-side `pendingProposals` projection never drops the proposal — `entity-removed` flips entity visibility but does not remove the pending record, and here there is not even an `entity-removed`. The proposal lingers as "pending" forever.
- Every read surface (moderator pane, participant pane, audience, replay) stays stale.

This is the gap surfaced by `part_withdraw_proposal_gesture` (§D6, §A4 deferred sub-scenario) and registered as `backend.websocket_protocol.ws_withdraw_proposal_zero_emission_terminator`. The `ws_withdraw_proposal_message` handler docblock (`withdraw.ts:93-99`) anticipated this resolution: "If a future consumer … needs an explicit terminal marker on the proposal, that's the right time to mint it."

Two terminator shapes were on the table (named in the source refinement): a dedicated `proposal-withdrawn` event kind, or an "overlay-entity" `entity-removed`.

## Decision

Introduce a dedicated **`proposal-withdrawn`** event kind, emitted by the `withdraw-proposal` handler **if and only if the withdraw would otherwise append zero events to the log** (i.e. the per-sub-kind retraction mapping produced no `entity-removed` events). It is the facet/proposal-layer terminal marker for the *withdrawn* disposition, symmetric with the proposal-keyed `commit` and `meta-disagreement-marked` events.

- **Kind:** `'proposal-withdrawn'`, added to the `eventKinds` union (`packages/shared-types/src/events.ts`), the `EventPayloadMap`, and the `session_events.kind` CHECK constraint (forward-only migration per ADR 0020).
- **Payload:** `{ proposal_id: uuid, withdrawn_by: uuid, withdrawn_at: datetime(offset) }`. `proposal_id` mirrors the proposal-keyed `commit` / `meta-disagreement-marked` payloads; `withdrawn_by` / `withdrawn_at` mirror `entity-removed`'s `removed_by` / `removed_at` (authenticated connection + injected clock, never the wire payload).
- **Server projection:** a `handleProposalWithdrawn` arm in `replay.ts` calls `projection.removePendingProposal(payload.proposal_id)` — the same one-line termination as the commit/meta-disagreement proposal arms. This also closes the latent "withdrawn proposal lingers in `pendingProposals`" defect for the zero-emission case (a re-withdraw now correctly fails `proposal-not-found`).
- **Emission predicate:** "append a terminator IFF this withdraw is otherwise log-silent." Self-correcting: when a sub-kind later grows propose-time emission (the `entitiesToRetractForWithdraw` tech-debt arms), its withdraw stops being log-silent and the `entity-removed` events become the observable signal, so no terminator is emitted for it — no per-sub-kind list to maintain.
- **Namespace overlap is intentional.** The WS ack envelope type `'proposal-withdrawn'` (`packages/shared-types/src/ws-envelope.ts`) and this event kind share a name but live in separate namespaces (`wsMessageTypes` vs `eventKinds`). The `withdraw.ts` docblock already blessed this overlap as "intentional + namespace-distinct."

The `removedEventCount` field on the `proposal-withdrawn` **ack** keeps its meaning — count of `entity-removed` (structural retraction) events. For a zero-emission withdraw it is `0`; the terminator is a proposal-layer event and is not counted there. The proposer observes the termination through the `event-applied` broadcast carrying the `proposal-withdrawn` event, exactly as every other event-driven UI update arrives.

### Alternatives considered

- **Overlay-entity `entity-removed` (rejected).** Synthesize a fake "overlay entity" id for the withdrawn proposal and emit `entity-removed` against it. Rejected: only two of the seven zero-emission sub-kinds (`axiom-mark`, `annotate`) are overlay-shaped; the other five (`set-node-substance`, `edit-wording`, `meta-move`, `break-edge`, `amend-node`) are facet-level re-votes against extant entities with no overlay to remove. It also overloads the entity layer with facet-layer semantics — the exact layer-mixing ADR 0027 rejected (`entity-removed` means "a structural entity left the structure," and flips visibility). A proposal-keyed terminator is uniform across all seven and respects the layer boundary.

- **Emit the terminator for *every* withdraw and retire the client `entity-removed` inference mirror (deferred, not chosen here).** The fully symmetric design makes `proposal-withdrawn` the single proposal-termination signal for all sub-kinds and deletes the "MUST stay in sync with the server" mirror in both client apps. It is the cleaner long-term shape, but it changes already-shipped, already-green behavior for entity-emitting withdrawals (extra broadcast per withdraw; rewritten Cucumber/unit assertions) — churn beyond this task's "zero-emission" scope and risk on shipped behavior. The "log-silent only" predicate above keeps both client termination mechanisms wired (terminator set **and** the existing mirror), so row termination is robust to the zero-emission boundary moving without ripping out the mirror now. Generalizing — and the parallel latent server-side `pendingProposals` lingering for entity-emitting withdrawals — is surfaced for the parking lot rather than scoped here.

## Consequences

- A fourth proposal-terminal event flows on the log. Projectors gain one `case 'proposal-withdrawn'` arm; the pending-proposal lookup stays a single-event check.
- The zero-emission withdraw becomes log-observable and replay-deterministic — pending rows, and (via the follow-up `participant_ui.part_withdraw_proposal_overlay_removal`) overlays, terminate on the immutable log.
- A withdrawn zero-emission proposal is removed from the server `pendingProposals` projection; re-withdrawing it fails `proposal-not-found` rather than silently re-running.
- The emission predicate ("log-silent → terminator") must be read together with `entitiesToRetractForWithdraw`: the two are computed in the same handler pass, so they cannot drift.
- Forward-only migration (ADR 0020); no down path. No existing rows carry the new kind.
- This resolves the deferral recorded in the `ws_withdraw_proposal_message` refinement (D5); ADR 0027's entity/facet decision is unchanged and is the basis for keeping the terminator in the facet layer.
