# Refinement: `ws_withdraw_proposal_zero_emission_terminator`

## TaskJuggler entry

- Task: `backend.websocket_protocol.ws_withdraw_proposal_zero_emission_terminator`
- Defined in [`tasks/20-backend.tji`](../../20-backend.tji) (lines 363–371), inside the `websocket_protocol` container.
- Title: *"Make zero-emission proposal withdrawals append a log-observable terminator event."*

## Effort estimate

**1d** (from the `.tji` block). Heavy precedent from `ws_withdraw_proposal_message` (handler skeleton), `mod_proposed_entity_canvas_visibility` (new-event-kind + migration recipe), and the existing client `derivePendingProposals` terminator set keeps the surface bounded: one new event kind across three registration sites, one forward-only migration, one projector arm, one conditional emission in the existing handler, two one-line client-terminator additions, plus tests.

## Inherited dependencies

**Settled:**

- `!ws_withdraw_proposal_message` (direct `depends`) — **Done 2026-05-17.** Landed the `withdraw-proposal` handler (`apps/server/src/ws/handlers/withdraw.ts`), the proposer-only authority gate (wire `forbidden`), the per-sub-kind `entitiesToRetractForWithdraw` mapping, and the `proposal-withdrawn` **ack** envelope. Its D5 explicitly deferred a dedicated `proposal-withdrawn` **event** kind ("v1's entity-layer removals are sufficient"); this task lands that deferral for the case where entity-layer removals are empty.
- `mod_proposed_entity_canvas_visibility` (transitive) — **Done 2026-05-17.** Established the `entity-removed` event kind + payload-discriminated schema (D8) and the new-event-kind recipe (CHECK-constraint migration `0012`, projector arm, `EventPayloadMap` entry) this task mirrors. ADR 0027 (entity/facet layer separation) came from this line.
- `part_withdraw_proposal_gesture` (source of debt, not a `depends`) — **Done 2026-06-02.** §D6 + §A4 named this task and documented the gap precisely: an axiom-mark is zero-emission, so withdraw appends no terminator and the proposer's own pending row never clears.

**Pending (downstream, not blocking):**

- `participant_ui.part_withdraw_proposal_overlay_removal` (~0.5d, [`tasks/40-participant-ui.tji:496`](../../40-participant-ui.tji)) — already registered and already `depends` this task. It ports the participant axiom-mark + annotation **overlay** projectors onto the new terminator and lands the deferred Block-1 cross-surface Playwright counterpart. **This task does not touch overlay projectors or Playwright** (see Acceptance criteria); it makes the terminator exist and wires the pending **panes**.

## What this task is

Today, withdrawing a *zero-emission* proposal — one of the seven sub-kinds that mint no structural entity at propose-time (`axiom-mark`, `annotate`, `set-node-substance`, `edit-wording`, `meta-move`, `break-edge`, `amend-node`) — appends **nothing** to the immutable log (`withdraw.ts:570-583` falls through with zero retraction targets). The `proposal-withdrawn` ack returns `removedEventCount: 0`, no `event-applied` broadcast fires, and the proposal stays "pending" everywhere: in the server's `pendingProposals` projection, in both clients' pending panes, on the audience surface, and on replay.

This task introduces a dedicated **`proposal-withdrawn` event kind** (ADR 0037) that the handler appends **iff a withdraw would otherwise be log-silent** (zero `entity-removed` events). The new event is the facet-layer terminal marker for the *withdrawn* disposition — symmetric with the proposal-keyed `commit` and `meta-disagreement-marked` events. It terminates the pending proposal on the server projection and in both client `derivePendingProposals` selectors, so every read surface converges on the immutable log.

## Why it needs to be done

- **Correctness on the read surfaces.** A proposer who withdraws their only contribution (an axiom-mark, say) watches their own pending row sit there indefinitely; no surface can ever clear it because the log carries no signal. This is the live bug from `part_withdraw_proposal_gesture` §A4.
- **Replay-determinism.** Zero-emission withdrawal currently leaves no trace, so a replay of the log cannot reconstruct that the withdraw happened. A terminal event makes the disposition first-class and replayable.
- **Latent server-side defect.** `handleEntityRemoved` flips entity visibility but never removes a proposal from `pendingProposals`; only `commit` / `meta-disagreement-marked` do (`replay.ts` `handleCommit`:~912, `handleMetaDisagreementMarked`:~1011). For a zero-emission withdraw there is not even an `entity-removed`, so the proposal lingers as pending forever and a re-withdraw would re-run. The terminator's projection arm closes this for the zero-emission case.
- **Unblocks** `part_withdraw_proposal_overlay_removal`, which `depends` this task to drive overlay termination off the new event.

## Inputs / context

Real paths and line references the implementer works against:

- **Handler.** `apps/server/src/ws/handlers/withdraw.ts`
  - `entitiesToRetractForWithdraw` (lines 467–587); the zero-emission fall-through arm is **lines 570–583** (`set-node-substance` / `edit-wording` / `axiom-mark` / `meta-move` / `break-edge` / `amend-node` / `annotate` → `break`, no targets).
  - The append loop (lines 339–360) and the post-commit broadcast + ack (lines 363–386). `removedEventCount` is `appendedEvents.length` (line 382) — see Decisions D4 for keeping its meaning.
  - The docblock at lines 93–99 pre-blesses minting a `proposal-withdrawn` **event** kind distinct from the WS ack of the same name.
- **Event vocabulary.** `packages/shared-types/src/events.ts`
  - `eventKinds` union (lines ~132–170); `entityRemovedPayloadSchema` (lines ~630–637) as the payload-schema template; `EventPayloadMap` registration (`'entity-removed'` at line ~754); the proposal-keyed `commit` arm (`commitPayloadSchema`, `target: 'proposal'` + `proposal_id` at lines ~514–515) as the `proposal_id` naming precedent.
- **Migration template.** `apps/server/migrations/0012_session_events_entity_removed.sql` — the DROP/ADD `session_events_kind_check` CHECK-constraint recipe, forward-only per ADR 0020. Latest applied migration is `0015_auth_flow_state.sql`; the new one is `0016`.
- **Server projection.** `apps/server/src/projection/replay.ts`
  - `handleEntityRemoved` (lines 269–332) — visibility-only, does **not** remove the pending proposal.
  - `handleCommit` proposal arm `removePendingProposal(payload.proposal_id)` (~line 912) and `handleMetaDisagreementMarked` (~line 1011) — the one-line termination the new arm mirrors.
- **Client pending-pane derivations** (the two panes the `.tji` note says to wire):
  - `apps/participant/src/proposals/derivePendingProposals.ts` — `terminatedProposalIds` set fed by `commit` / `meta-disagreement-marked` / `entity-removed`-mirror (lines ~127–214; `registerProposeTimeEntities` mirror ~240–280).
  - `apps/moderator/src/graph/pendingProposals.ts` — identical structure (lines ~129–228; mirror ~248–295).
- **Cucumber seam.** `tests/behavior/backend/ws-withdraw.feature` + `tests/behavior/steps/backend-ws-withdraw.steps.ts` — the WS/replay-seam coverage from `ws_withdraw_proposal_message` (4 scenarios) this task extends with the zero-emission case.
- **ADRs.** [0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) (entity/facet separation — the basis for keeping the terminator a facet-layer event), [0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) (envelope + schema-on-write), [0020](../../../docs/adr/0020-postgres-write-path-locking-and-event-ordering.md) (forward-only migrations + write-path ordering), and the new [0037](../../../docs/adr/0037-proposal-withdrawn-terminator-event.md) written for this task.

## Constraints / requirements

1. **New event kind, registered in all three places** consistently: `eventKinds` array, `EventPayloadMap`, and the `session_events.kind` CHECK constraint (new migration `0016`). Schema-on-write (`validateEvent`) must accept it (ADR 0021).
2. **Payload:** `{ proposal_id: uuid, withdrawn_by: uuid, withdrawn_at: datetime({ offset: true }) }`. `withdrawn_by` / `withdrawn_at` come from `connection.user.id` + the injected `now()` clock — never from the wire payload (symmetric with `entity-removed`'s `removed_by` / `removed_at` per `withdraw.ts` D4). The wire `wsWithdrawProposalPayloadSchema` is **unchanged** — no new request field.
3. **Emission predicate:** append exactly one `proposal-withdrawn` event **iff `entitiesToRetractForWithdraw` returned zero targets** for this withdraw. When it returned ≥1 target, behave exactly as today (entity-removed events only, no terminator). The predicate is "this withdraw is otherwise log-silent," computed in the same handler pass as the retraction mapping so the two cannot drift.
4. **Sequence allocation:** the terminator takes `maxSeq + 1`, using the existing multi-event allocator. It is appended inside the same transaction, validated on write, and pushed to `appendedEvents` so the existing post-commit broadcast loop emits it.
5. **Ack invariant preserved:** the `proposal-withdrawn` **ack** `removedEventCount` keeps meaning "count of `entity-removed` events." For a zero-emission withdraw it is `0` (the terminator is not an entity removal and is not counted). The ack envelope shape is unchanged. Existing entity-emitting withdraw scenarios/units are **untouched** (no terminator on their path).
6. **Server projection terminates the pending proposal:** a `handleProposalWithdrawn` arm calls `projection.removePendingProposal(payload.proposal_id)`. After it, `findProposal` returns `null` for that id (re-withdraw → `proposal-not-found`).
7. **Both client pending panes terminate on the new event:** add `'proposal-withdrawn'` to the `terminatedProposalIds` feed in `derivePendingProposals.ts` (participant) and `pendingProposals.ts` (moderator), keyed by `payload.proposal_id`, alongside the existing `commit` / `meta-disagreement-marked` arms. The existing `entity-removed` mirror stays in place — the two terminator paths coexist, so row termination is robust to the zero-emission/entity-emitting boundary moving later.
8. **No overlay-projector work, no Playwright** in this task (owned by `part_withdraw_proposal_overlay_removal`). No change to the `propose` path. No new WS request field.
9. **Forward-only migration** (ADR 0020); no down path.

## Acceptance criteria

Test layering per **ADR 0022** (no throwaway verifications — every check lands as a committed, named test at the right seam):

- **Cucumber — WS/replay seam (the protocol/projector boundary this task changes).** Add a scenario to `tests/behavior/backend/ws-withdraw.feature`: a subscribed participant proposes a zero-emission sub-kind (an `axiom-mark`), then withdraws it. Assert:
  1. the server appends exactly **one** `proposal-withdrawn` event to the session log (queried at the seam), with `proposal_id` = the withdrawn proposal's event id and a non-null `withdrawn_by`;
  2. an `event-applied` broadcast carrying that `proposal-withdrawn` event reaches the subscribed socket(s);
  3. the `proposal-withdrawn` **ack** references the withdraw envelope with `removedEventCount 0`;
  4. a **second** withdraw of the same proposal is rejected `proposal-not-found` — pinning that the server projection dropped it from `pendingProposals`.
  This is the right seam for a backend task that crosses the protocol/replay boundary (the `ws_withdraw_proposal_message` precedent). **Existing entity-emitting scenarios are not modified** — the predicate leaves their path byte-for-byte unchanged.

- **Vitest — server.** (a) `withdraw.test.ts`: a zero-emission pending proposal → handler appends one `proposal-withdrawn` event and zero `entity-removed`; an entity-emitting proposal → zero `proposal-withdrawn` (regression guard on the predicate). (b) `replay.test.ts` (or the projection's test): replaying a `proposal-withdrawn` event removes the proposal from `pendingProposals` (and `findProposal` then returns `null`).

- **Vitest — clients.** `apps/participant/src/proposals/derivePendingProposals.test.ts` and `apps/moderator/src/graph/pendingProposals.test.ts`: a log containing a `proposal` followed by a `proposal-withdrawn` for that id yields **no** pending row for it; the existing `commit` / `meta-disagreement-marked` / `entity-removed` termination cases still pass.

- **Schema.** A `packages/shared-types` unit asserts the `proposalWithdrawnPayloadSchema` round-trips a valid payload and rejects a missing/extra field (mirrors the `entity-removed` schema test).

- **e2e (deferred — already-registered owner, no new debt).** The user-visible cross-surface behavior ("debater-A withdraws their own axiom-mark and the row + overlay vanish on all surfaces" — `part_withdraw_proposal_gesture` §A4 deferred sub-scenario) is **not** in scope here: this is a backend task whose seam is the WS/replay boundary (covered by Cucumber above), and the overlay projectors are untouched. That Playwright counterpart is owned by **`participant_ui.part_withdraw_proposal_overlay_removal`** (already in the WBS, already `depends` this task). This task makes that behavior *reachable*; the overlay task lands the spec. **No new follow-up task is registered** — the owner already exists.

## Decisions

- **D1 — Dedicated `proposal-withdrawn` event kind, not an overlay-entity `entity-removed`** (ADR 0037). The terminator is keyed by `proposal_id`, so it is uniform across all seven zero-emission sub-kinds — five of which (`set-node-substance`, `edit-wording`, `meta-move`, `break-edge`, `amend-node`) are facet re-votes with no overlay to remove. Reusing `entity-removed` would require synthesizing a fake entity id and would push facet-layer semantics into the entity layer, the mixing ADR 0027 forbids. A proposal-keyed terminator is the natural fourth sibling of `commit` / `meta-disagreement-marked`.

- **D2 — Emit the terminator iff the withdraw is otherwise log-silent** (zero `entity-removed` events), **not for every withdraw.** This matches the task's scope ("zero-emission withdrawals") and leaves shipped, green entity-emitting withdraw behavior (broadcast count, `removedEventCount`, the 4 existing Cucumber scenarios, the 10 unit cases) byte-for-byte untouched. The predicate is self-correcting: when a sub-kind later grows propose-time emission, its withdraw stops being log-silent and the `entity-removed` events become the observable signal — so there is no per-sub-kind list to maintain. *Rejected alternative:* emit for every withdraw and retire the client `entity-removed` inference mirror (the fully symmetric design, ADR 0037 "Alternatives"). Cleaner long-term, but it churns shipped behavior and the mirror-removal touches both client apps' dedup logic — beyond a 1d zero-emission task and risk on shipped code. Keeping both client terminator paths wired (D5) makes the narrow fix robust without the rip-out.

- **D3 — Payload `{ proposal_id, withdrawn_by, withdrawn_at }`.** `proposal_id` mirrors the proposal-keyed `commit` / `meta-disagreement-marked` payloads; `withdrawn_by` / `withdrawn_at` mirror `entity-removed`. No sub-kind field — consumers resolve the original `proposal` event by `proposal_id`. Server owns the actor + timestamp (D4 of `ws_withdraw_proposal_message`); the wire request schema is unchanged.

- **D4 — `removedEventCount` ack keeps meaning "entity-removed count."** It is `0` for a zero-emission withdraw; the terminator is not an entity removal. Computing it from the entity-removed events (not `appendedEvents.length`) preserves the field's documented meaning and the existing unit/Cucumber assertions. The proposer observes termination via the `event-applied` broadcast, like any other event-driven update. *Alternative rejected:* count the terminator in `removedEventCount` — would silently change the field's meaning and break shipped assertions.

- **D5 — Both client terminator mechanisms coexist.** Add `'proposal-withdrawn'` to the `terminatedProposalIds` feed without removing the existing `entity-removed`→proposal mirror. The two are additive and idempotent (set membership). This makes pending-row termination robust if a sub-kind crosses the zero-emission boundary later, and avoids the risk of ripping out the `registerProposeTimeEntities` mirror in a backend-scoped task.

- **D6 — Server projection arm terminates the pending proposal.** `handleProposalWithdrawn → removePendingProposal(proposal_id)`. Necessary anyway (the `replay.ts` event switch is exhaustive — a new kind needs an arm), and it closes the latent "withdrawn proposal lingers in `pendingProposals`" defect for the zero-emission path (re-withdraw → `proposal-not-found`). The generalization to entity-emitting withdrawals (which also linger server-side today) is **not** scoped here.

- **D7 — Forward-only migration `0016`** extending `session_events_kind_check`, following `0012`'s recipe (ADR 0020). No down path; no pre-existing rows carry the kind.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-02.

- New event kind `proposal-withdrawn` registered in `packages/shared-types/src/events.ts`: added to `eventKinds`, `EventPayloadMap`, `proposalWithdrawnEventPayloadSchema` / `ProposalWithdrawnEventPayload` (disambiguated from the WS-ack symbol in `ws-envelope.ts`).
- Forward-only migration `apps/server/migrations/0016_session_events_proposal_withdrawn.sql` extends the `session_events_kind_check` CHECK constraint.
- Handler `apps/server/src/ws/handlers/withdraw.ts` appends one `proposal-withdrawn` terminator iff zero retraction targets; `removedEventCount` counts only `entity-removed` events (ack invariant preserved).
- Server projection `apps/server/src/projection/replay.ts` gains `handleProposalWithdrawn` arm; `apps/server/src/projection/types.ts` adds `'withdraw'` to `PendingProposalClearedChange.reason`.
- Both client pending panes terminate on `proposal-withdrawn`: `apps/participant/src/proposals/derivePendingProposals.ts` and `apps/moderator/src/graph/pendingProposals.ts`.
- ADR 0037 written at `docs/adr/0037-proposal-withdrawn-terminator-event.md`.
- Cucumber scenario added to `tests/behavior/backend/ws-withdraw.feature` + 3 steps in `tests/behavior/steps/backend-ws-withdraw.steps.ts`: axiom-mark propose → withdraw → terminator appended/broadcast/ack-0, re-withdraw → `proposal-not-found`.
- Vitest coverage: `events.test.ts` (schema round-trip), `validate.test.ts`, `withdraw.test.ts` (zero-emission → terminator; entity-emitting regression guard), `replay.test.ts` (terminator removes pending; unknown-proposal throws), `derivePendingProposals.test.ts`, `pendingProposals.test.ts`.
