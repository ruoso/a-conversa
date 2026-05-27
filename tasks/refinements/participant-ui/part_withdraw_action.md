# Send withdraw vote; reflect facet → disputed — superseded; do not implement

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_withdraw.part_withdraw_action`
**Effort estimate**: 0.5d (in the WBS; this refinement reduces it to 0 — closer marks `complete 100` with a "superseded" Status block).
**Inherited dependencies**:

- `!participant_ui.part_withdraw.part_withdraw_dialog` (settled — closed as superseded 2026-05-27 per [`tasks/refinements/participant-ui/part_withdraw_dialog.md`](part_withdraw_dialog.md), commit `190be72`; the `complete 100` marker on lines 284-288 of [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji#L284-L288) finalizes the prereq). The per-facet refactor chain's row-local two-stage confirmation gesture IS the dialog beat the prerequisite was meant to add.
- `!participant_ui.part_withdraw.part_find_agreed_facet` (settled — closed as superseded 2026-05-26 per [`tasks/refinements/participant-ui/part_find_agreed_facet.md`](part_find_agreed_facet.md), commit `eb254d1`; transitive prerequisite via `!part_withdraw_dialog`). The always-on per-facet row block IS the find affordance.
- `!participant_ui.part_voting` (settled — the grandparent's prior dependency in [`tasks/40-participant-ui.tji` line 278](../../40-participant-ui.tji#L278); every leaf under `part_voting.*` shipped via the per-facet refactor including `part_proposal_notification` at commit `38bf660`).
- `!data_and_methodology.methodology_engine.withdrawal_logic` (settled at `2026-05-10` per [`tasks/refinements/data-and-methodology/withdrawal_logic.md` line 113](../data-and-methodology/withdrawal_logic.md#L113)). The legacy write-side validator handled `vote.choice === 'withdraw'`; the post-ADR-0030 wire shape replaces that arm with the dedicated `withdraw-agreement` envelope. Either route enforces the same precondition (the requester previously voted agree on a committed proposal).
- Prose-only context (NOT a `.tji` edge): [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) (accepted 2026-05-23 — the per-facet vote keying + sequential-capture model that introduces the dedicated `withdraw-agreement` event kind and shrinks `vote.choice` to `'agree' | 'dispute'` only).
- Prose-only context (NOT a `.tji` edge): `!per_facet_refactor.participant_ui.pf_part_withdraw_agreement_action` (settled 2026-05-24 per [`tasks/refinements/per-facet-refactor/pf_part_withdraw_agreement_action.md` line 54](../per-facet-refactor/pf_part_withdraw_agreement_action.md#L54)). Ships the `useWithdrawAgreementAction` hook + the wired withdraw button on `agreed` / `committed` facet rows + the two-stage row-local confirmation gesture + 13-case Vitest contract + 5-case "wired withdraw button" describe block. **This is the surface that replaces the standalone send-withdraw action.**
- Prose-only context (NOT a `.tji` edge): `!per_facet_refactor.participant_ui.pf_part_detail_panel_three_facet_rows` (settled — every facet of a tapped entity always renders a row; the `agreed` / `committed` row arms host the withdraw button the hook fires from).
- Prose-only context (NOT a `.tji` edge): `!per_facet_refactor.shared.pf_withdraw_agreement_event_kind` (settled — the `withdraw-agreement` event kind + its zod schema in `packages/shared-types/src/events.ts`; the wire envelope the hook dispatches).
- Prose-only context (NOT a `.tji` edge): `!per_facet_refactor.server.pf_withdraw_agreement_handler` (settled — the server-side WS handler at `apps/server/src/ws/handlers/withdraw-agreement.ts` that validates + appends the `withdraw-agreement` event, returning the success / error response the hook surfaces).

## What this task is

**Originally:** add the wire-emit action for the participant withdraw gesture — the bit that, after the confirmation dialog confirms, dispatches a `vote` event (or, later, a `withdraw-agreement` event) over the WS, surfaces success / failure to the UI, and lets the projection flip the affected facet's status from `agreed` / `committed` back to `disputed`. This was the third leaf of the three-step find / dialog / send chain, each owning one piece of the gesture.

**As of this refinement (2026-05-27):** **superseded; do not implement.** The per-facet refactor's `pf_part_withdraw_agreement_action` (done 2026-05-24) landed the **`useWithdrawAgreementAction` hook** + the **wired withdraw button** on `agreed` / `committed` facet rows. The hook's `withdraw()` slot dispatches `useWsClient().send('withdraw-agreement', { entity_kind, entity_id, facet, participant })`; the server-side handler validates + appends; the projection flips the row to `withdrawn` (which is the post-ADR-0030 replacement for "facet → disputed" — see Decision §1 below for why the status name evolved). Per-`(entity_kind, entity_id, facet)` Zustand-backed slot isolation keeps concurrent withdraws on different rows disjoint; an inline wire-error region surfaces typed failures next to the button that triggered them.

The closer should mark this task `complete 100` in the matching `.tji` block with a Status note pointing at this refinement (and at the per-facet-refactor citations below). No new component, no new test, no new i18n key, no new wire shape, no new event kind, no production code change. The deliberate documentation of the cancel-as-superseded is itself the artifact of this refinement round.

Concretely:

- **No** new file lands at `apps/participant/src/detail/useWithdrawAction.ts`, `apps/participant/src/proposals/withdrawAction.ts`, or any equivalent path. The hook at [`apps/participant/src/detail/useWithdrawAgreementAction.ts`](../../../apps/participant/src/detail/useWithdrawAgreementAction.ts) IS the wired send action; its `withdraw()` slot is the exact gesture this leaf would have shipped.
- **No** new test file lands. The existing per-facet refactor coverage (`useWithdrawAgreementAction.test.tsx` 13-case hook contract — success path, failure path, in-flight isolation across slots; `ParticipantVoteButtons.test.tsx` 5-case "wired withdraw button" describe block — arm-then-fire path; the `pf_e2e_methodology_full_flow_update` Playwright spec — drives the end-to-end arm → confirm → send → assert-`withdrawn` chain) already pins the send action contract end-to-end.
- **No** new Playwright spec lands. The methodology-full-flow Playwright spec (per `pf_e2e_methodology_full_flow_update`) already drives a participant through tap-entity → see agreed-facet row → arm-withdraw → confirm-withdraw → assert facet flips to `withdrawn`. The third "send" beat lives on that path.
- **No** new i18n key under `participant.withdrawAction.*` or `participant.sendWithdraw.*` or equivalent. The existing `participant.withdrawAgreementButton.*` catalog entries (`label`, `confirmLabel`, `inFlightLabel`, `ariaLabel`, `ariaLabelConfirm`, `wireError`, `timeoutError`, `errorRoleLabel` — added by `pf_part_withdraw_agreement_action` per its Status block) cover every label the in-flight / error states surface. The send action carries no chrome of its own beyond what the wired button already renders.
- **No** new wire envelope. ADR 0030 §3 settled the dedicated `withdraw-agreement` envelope; `pf_withdraw_agreement_event_kind` ships its zod schema; `pf_withdraw_agreement_handler` ships the server-side accept path. The hook fires that envelope verbatim — no new shape to design.
- **No** new ADR. ADR 0030 already settled the architectural shift (dedicated event kind + always-on row block + `vote.choice` shrink); Decision §1 below documents the supersession derivation; no new architectural seam, no new dependency, no new security trade-off, no new abstraction.
- **No** registration of a follow-up task today. The "wire-emit logic" that this leaf would have built is the `useWithdrawAgreementAction.withdraw()` slot itself — not a separately-scoped option in the WBS. Decision §3 explains why this refinement does NOT register a "revisit send-action shape" follow-up.

Out of scope (explicit non-actions this refinement DOES NOT take):

- **Not an ADR amendment.** ADR 0030 already enumerates the per-facet vote keying + sequential-capture model, the dedicated `withdraw-agreement` event kind (§3), the always-on per-facet row block (§10), and the resulting facet-status walk (Consequences). This refinement cites it rather than amending or splitting it. The ADR convention's "amend rather than re-decide" rule (per [`docs/adr/README.md`](../../../docs/adr/README.md)) doesn't apply because the original ADR's §3 + Consequences already encode the wire-emit semantics this leaf was scoped to add — including the rename of the post-withdraw status from "disputed" to "withdrawn" (see Decision §1).
- **Not a closure of the optional `part_my_agreements_view` leaf.** That leaf is independently scoped (history-view UX, not a wire-emit action) and stays Optional per `part_find_agreed_facet.md` Decision §3.
- **Not a re-opening of `part_find_agreed_facet` or `part_withdraw_dialog`.** Both are already closed-as-superseded (commits `eb254d1` and `190be72`); the find affordance IS the always-on per-facet row block, and the dialog beat IS the row-local two-stage confirmation gesture. No edits to those refinements, no edits to their `.tji` blocks (lines 279-288 of [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji#L279-L288)).
- **Not a re-evaluation of `pf_part_withdraw_agreement_action`'s hook contract.** The `withdraw() → Promise<void>` / `inFlight` / `lastError` slot shape is the recorded outcome there; this refinement cites it rather than re-litigating it.
- **Not a redesign of the per-slot Zustand-backed in-flight bookkeeping.** The `(entity_kind, entity_id, facet)`-keyed slot store is the established pattern (parallel to `useVoteAction` / `useAxiomMarkAction` per `pf_part_withdraw_agreement_action` Decision §2); adding a different in-flight surface (e.g. a global "withdraw is in flight" boolean) would conflict with the per-facet refactor's "in-flight bookkeeping is per-(entity, facet)" invariant from ADR 0030 §2.
- **Not a new optimistic-update layer.** The projection reads the appended `withdraw-agreement` event on broadcast — there is no "flip the row to `withdrawn` *before* the server confirms" optimistic write. ADR 0021 (event envelope; server-authoritative ordering) settles this; the in-flight state is `inFlightLabel`-distinct from the post-confirm `withdrawn` state precisely so the user knows their tap is still in flight.
- **Not a "withdraw rationale" capture field.** The `withdraw-agreement` envelope is `(entity_kind, entity_id, facet, participant)` only per ADR 0030 §3 + the zod schema at `packages/shared-types/src/events.ts`. The data model does not store withdrawal-rationale; the wire envelope correctly does not carry one.
- **Not a retry-on-failure surface.** The hook surfaces `lastError` for the user to read and re-tap if desired; an automatic retry would mask wire-level / server-side validation failures (e.g., the user's prior agree on a different proposal that was since superseded). The user-driven re-tap is the established pattern across `useVoteAction` / `useAxiomMarkAction` (per the participant UI hook conventions).

## Why it needs to be done

The task block is on the WBS; the orchestrator's pick-task pass selected it. The refinement round has to either ship a buildable refinement that says "implement this" or explain in writing why the task is now a no-op. The orchestrator does not read status-block prose retroactively; the only way to surface "this task is superseded" durably is to land a refinement that says so AND have the closer flip the `.tji` to `complete 100` with a Status block that points here. Both halves of the ritual ([`tasks/refinements/README.md` lines 32-42](../README.md#L32-L42)) apply even to a superseded task — otherwise the WBS keeps reading `0% complete` against a leaf nobody will ever implement and the milestone scheduler stays blocked on a phantom.

The downstream chain:

1. **`part_withdraw` parent rolls up.** This is the third-and-final supersession closure under `part_withdraw` (after `part_find_agreed_facet` ✓ closed-superseded 2026-05-26 and `part_withdraw_dialog` ✓ closed-superseded 2026-05-27). With this leaf closed, every required leaf under `part_withdraw` is finalized; the parent's own `complete 100` can land in the next task-completion ritual pass. The optional `part_my_agreements_view` does not gate the parent's rollup (it is `Optional:` per its WBS label and the precedent established in [`tasks/refinements/participant-ui/part_find_agreed_facet.md` Decision §3](part_find_agreed_facet.md)).
2. **`part_tests` depends on `!part_withdraw`.** The participant-tests roll-up at [`tasks/40-participant-ui.tji` line 367](../../40-participant-ui.tji#L367) carries `depends !part_voting, !part_withdraw, !part_axiom_mark_from_tablet`. Completing the third withdraw-chain supersession unblocks `part_tests`' scheduling (modulo its other prerequisites).
3. **Milestone propagation.** The P3 withdraw flow contributes to whichever milestone aggregates the participant UI work (per [`tasks/99-milestones.tji`](../../99-milestones.tji)). The supersession-via-`complete 100` posture lets the milestone gate clear without a phantom leaf.
4. **Audit trail.** The refinement document IS the artifact that proves the supersession was deliberate, citation-supported, and not an oversight — future readers walking the WBS see `complete 100` and read the refinement's Status block + Decision §1 to understand why no production code corresponds to this "completed" leaf. Critically, a future reader asking "why isn't there a standalone `useWithdrawAction` or a `vote.choice = 'withdraw'` arm in the v1 wire vocabulary?" finds the answer here without spelunking through commit history.
5. **Closes the three-leaf supersession arc.** With all three `part_withdraw.*` required leaves closed under the same four-pin argument shape (ADR 0030 + per-facet refactor chain + sibling/precedent supersession + live code surface), the refinement triplet is the durable historical record that the planned three-step find / dialog / send chain was *deliberately* collapsed into the per-facet row block + two-stage button + hook, not accidentally dropped.

Architecturally the supersession is **already established** in four settled sources:

- ADR 0030 §3 (`withdraw-agreement` becomes its own event kind, not a vote-arm of a generic `vote`; `vote.choice` shrinks to `'agree' | 'dispute'`).
- ADR 0030 §10 + Consequences (the always-on per-facet row block; the find / confirm / send chain collapses onto one panel surface).
- `pf_part_withdraw_agreement_action` (refinement Decision §2 + Status block — the `useWithdrawAgreementAction` hook with `withdraw() / inFlight / lastError` slot shape parallel to `useVoteAction` / `useAxiomMarkAction`, including the dispatch through `useWsClient().send('withdraw-agreement', …)` and the inline wire-error region).
- The sibling supersessions `part_withdraw_dialog.md` Decision §1 and `part_find_agreed_facet.md` Decision §1 (precedents for "the find/dialog/send chain collapses onto the always-on per-facet row block under the same four-pin argument shape").

This refinement is the *sixth* recording of the same conclusion at the task-shape layer, scoped to the send-action leaf specifically. No new evidence; no new analysis required.

## Inputs / context

### Design + ADRs (load-bearing for the supersession)

- [docs/participant-ui.md — P3. Withdraw agreement (L93-L101)](../../../docs/participant-ui.md#L93-L101) — the canonical UX sketch: *"1. Find the facet … 2. Tap the [Withdraw] button — a withdraw confirmation appears … 3. Confirm withdrawal — the tablet emits a `withdraw-agreement` event …"* Step 3 is the wire-emit beat this leaf would have built; the post-ADR-0030 hook + wired button realize it as a `useWsClient().send('withdraw-agreement', …)` dispatch from the second tap of the row-local two-stage gesture.
- [docs/participant-ui.md — Per-facet voting (L42-L45)](../../../docs/participant-ui.md#L42-L45) — *"`agreed` … The row shows the candidate value and a [Withdraw] button (emits `withdraw-agreement`, sending the facet back to `disputed`). `committed` … The row shows the committed value and a [Withdraw] button (also emits `withdraw-agreement`)."* The "emits `withdraw-agreement`, sending the facet back to `disputed`" prose IS the third step's contract — sent via the dedicated event kind, with the post-event facet status being the projection-derived state (which post-ADR-0030 is `withdrawn`, not `disputed`; see Decision §1).
- [docs/adr/0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md):
  - **§2 (Decision)**: per-facet vote keying makes the wire `(entity_kind, entity_id, facet)`-discriminated; per-row in-flight bookkeeping is disjoint per facet.
  - **§3 (Decision)**: "Withdrawal becomes a first-class `withdraw-agreement` event kind, separate from `vote`. The `vote.choice` enum shrinks to `'agree' | 'dispute'` only." The send action is the dispatcher for this event kind.
  - **§10 (Decision)**: "Participant detail panel renders all three facet rows per node (two per edge)." The always-on row block hosts the wired button the hook fires from.
  - **Consequences**: the send action's "facet → disputed" outcome from the WBS one-liner is realized via the post-event projection-derived status. Per the post-ADR-0030 status vocabulary, the post-withdraw status is named `withdrawn` (not `disputed`); the methodology-rule transition is identical, only the projected label evolved.
- [docs/methodology.md L25](../../../docs/methodology.md#L25) — *"A participant may withdraw agreement they previously gave. An `agreed` facet transitions back to `disputed`."* — the methodology rule that motivates the send action; the post-ADR-0030 projection names the post-withdraw status `withdrawn` to disambiguate from "fresh disputed (never agreed)" vs. "withdrawn (was agreed, then withdrawn)" — see Decision §1.
- [ADR 0021 — event envelope](../../../docs/adr/0021-event-envelope-shape.md) — applies to the wire shape of the dispatched event. The `withdraw-agreement` envelope rides this same envelope shape verbatim; no special-case framing.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — applies to the closer's Status block (no production code → no new verification; the existing per-facet refactor tests cover the send → confirm → projection chain).
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — applies indirectly: the existing `participant.withdrawAgreementButton.*` catalog entries (`wireError`, `timeoutError`, `inFlightLabel`, `errorRoleLabel`) carry every label the in-flight / error states surface; a separate send-action would have needed its own keys that simply do not exist in the catalog.
- [ADR 0027 — entity / facet layer split](../../../docs/adr/0027-entity-facet-layer-split.md) — scopes where the withdraw row lives (on a per-(entity, facet) basis); the hook's slot key `(entity_kind, entity_id, facet)` follows this directly.

### Sibling refinements (in this `part_withdraw.*` chain — all superseded by the same per-facet refactor work)

- `part_find_agreed_facet` (1d) — **Closed as superseded 2026-05-26** per [`tasks/refinements/participant-ui/part_find_agreed_facet.md`](part_find_agreed_facet.md). The find affordance is the always-on per-facet row block.
- `part_withdraw_dialog` (0.5d) — **Closed as superseded 2026-05-27** per [`tasks/refinements/participant-ui/part_withdraw_dialog.md`](part_withdraw_dialog.md). The dialog beat is the row-local two-stage confirmation gesture.
- This leaf (`part_withdraw_action`, 0.5d) — superseded by `pf_part_withdraw_agreement_action`'s `useWithdrawAgreementAction` hook + the wired withdraw button. Depended on by [`tasks/40-participant-ui.tji` line 292](../../40-participant-ui.tji#L292)'s ordering (via `!part_withdraw_dialog`) but with no downstream `.tji` consumer (the parent's roll-up is the consumer); the orchestrator picked it up now that the prereq's `complete 100` landed.
- `part_my_agreements_view` (1d, Optional) — independent of the supersession per `part_find_agreed_facet.md` Decision §3.

### Per-facet refactor refinements (the supersession source)

- [`tasks/refinements/per-facet-refactor/pf_part_withdraw_agreement_action.md`](../per-facet-refactor/pf_part_withdraw_agreement_action.md) — Done 2026-05-24. **The direct supersession source for this leaf.** Constraints L27 (*"useWithdrawAgreementAction(entityKind, entityId, facet) → { withdraw: () => Promise<void>, inFlight, lastError }"*) defines the hook shape. Constraints L30-L31 (*"On wire success, the row's status flips to `withdrawn` (the projection reads the new event). On wire error, surface the typed message in an inline error region."*) define the success / error semantics. Decision §2 (*"One hook per gesture. The useWithdrawAgreementAction is parallel to useVoteAction / useAxiomMarkAction"*) establishes the pattern. Status block L56 records the wired result.
- [`tasks/refinements/per-facet-refactor/pf_withdraw_agreement_event_kind.md`](../per-facet-refactor/pf_withdraw_agreement_event_kind.md) — Done. The `withdraw-agreement` event kind + its zod schema in `packages/shared-types/`. The wire envelope the hook dispatches.
- [`tasks/refinements/per-facet-refactor/pf_withdraw_agreement_handler.md`](../per-facet-refactor/pf_withdraw_agreement_handler.md) — Done. The server-side WS handler that validates + appends the `withdraw-agreement` event. Returns the success / error response the hook's `lastError` slot surfaces.
- [`tasks/refinements/per-facet-refactor/pf_part_detail_panel_three_facet_rows.md`](../per-facet-refactor/pf_part_detail_panel_three_facet_rows.md) — Done. Always-render every facet row; the `agreed` / `committed` row arms host the withdraw button the hook fires from.
- [`tasks/refinements/per-facet-refactor/pf_e2e_methodology_full_flow_update.md`](../per-facet-refactor/pf_e2e_methodology_full_flow_update.md) — the Playwright spec that exercises the arm → confirm → send → assert-`withdrawn` chain end-to-end.

### Prior precedent refinements

- [`tasks/refinements/participant-ui/part_withdraw_dialog.md`](part_withdraw_dialog.md) — Closed as superseded 2026-05-27. The structural template for this refinement: same supersession argument shape (four-pin: ADR 0030 + UX prose + refinement-layer decision + live code), same ADR 0030 citation set, same "no new ADR, no new follow-up registration, no testid reservation" posture.
- [`tasks/refinements/participant-ui/part_find_agreed_facet.md`](part_find_agreed_facet.md) — Closed as superseded 2026-05-26. The first supersession in this chain; establishes the precedent for "leave the Optional `part_my_agreements_view` sibling independently scoped."
- [`tasks/refinements/participant-ui/part_agree_all_gesture.md`](part_agree_all_gesture.md) — Closed as superseded 2026-05-24. The original precedent for "close-as-superseded with `complete 100` + Status block" in the participant-ui area.
- [`tasks/refinements/data-and-methodology/withdrawal_logic.md`](../data-and-methodology/withdrawal_logic.md) — Done 2026-05-10. The write-side validator on the legacy `vote.choice === 'withdraw'` arm. The post-ADR-0030 wire shape rides through the dedicated `withdraw-agreement` handler instead, but the methodology rule (withdraw requires a prior `agree` on a committed proposal) carries over verbatim.

### Live code surface (no change)

- [`apps/participant/src/detail/useWithdrawAgreementAction.ts`](../../../apps/participant/src/detail/useWithdrawAgreementAction.ts) — **the wired hook.** `withdraw()` slot dispatches `useWsClient().send('withdraw-agreement', { entity_kind, entity_id, facet, participant })`; `inFlight` / `lastError` per-`(entity_kind, entity_id, facet)` slot keys provided by a Zustand-backed store. This is the exact send-emit gesture this leaf was scoped to build; it already shipped. Byte-stable.
- [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) — the always-on per-facet row block. The `agreed` / `committed` branches render the wired withdraw button whose second tap calls `useWithdrawAgreementAction().withdraw()`; the `data-withdraw-state` / `data-withdraw-armed` attrs expose the arm-then-fire state for Playwright assertions; the inline wire-error region surfaces `lastError`. Byte-stable.
- [`apps/participant/src/detail/EntityDetailPanel.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.tsx) — the panel that mounts the per-facet row block on graph-tap. Threads `currentParticipantId` to the row block so the hook can fire with the right `participant` field. Byte-stable.
- [`apps/server/src/ws/handlers/withdraw-agreement.ts`](../../../apps/server/src/ws/handlers/withdraw-agreement.ts) — server-side validator. Enforces the prior-agree + committed-proposal precondition; on accept, appends a `withdraw-agreement` event the projection picks up. Byte-stable.
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — `wsWithdrawAgreementPayloadSchema` + the `'withdraw-agreement'` envelope arm. The wire shape the hook fires. Byte-stable.
- [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) — `computeFacetStatuses(events)` derives every facet's status from the event stream; after a `withdraw-agreement` event lands, the affected `(entity_kind, entity_id, facet)` projects to `'withdrawn'` (the post-ADR-0030 name for "previously-agreed, since withdrawn"). Byte-stable.
- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — the `participant.withdrawAgreementButton.*` group (including `inFlightLabel`, `wireError`, `timeoutError`, `errorRoleLabel`) carries every label the send action's in-flight / error states surface. Byte-stable.

### Files this refinement writes

- [`tasks/refinements/participant-ui/part_withdraw_action.md`](.) — this document.

### Files this refinement does NOT touch

- No app source — `apps/participant/`, `apps/moderator/`, `apps/server/`, `apps/audience/` all byte-stable.
- No shared package — `packages/shared-types/`, `packages/shell/`, `packages/i18n-catalogs/` all byte-stable.
- No test file — `apps/participant/src/**/*.test.tsx`, `tests/e2e/**/*.spec.ts`, `tests/behavior/**/*.feature` all byte-stable.
- No SQL migration — `apps/server/migrations/` byte-stable.
- No `.tji` file — the `complete 100` marker on `tasks/40-participant-ui.tji` lines 290-294 lands at task-completion-ritual time per [`tasks/refinements/README.md` lines 32-42](../README.md#L32-L42), driven by the closer (NOT this refinement-writer sub-agent).
- No new ADR — Decision §1 below documents why the supersession derivation doesn't warrant one.
- No `docs/adr/`, no `DESIGN.md`, no `docs/participant-ui.md`, no `docs/methodology.md` edit — they already say what this refinement reads off (including the "facet → disputed" wording at L42-L45 + L93-L101 + L25, which Decision §1 explains continues to read correctly against the post-ADR-0030 `withdrawn` status name).

## Constraints / requirements

### Files this task touches (explicit allowlist — REFINEMENT-WRITER PASS)

- `tasks/refinements/participant-ui/part_withdraw_action.md` (this file).

### Files the CLOSER's pass touches (the `complete 100` ritual — NOT this refinement-writer's pass)

- `tasks/40-participant-ui.tji` — add `complete 100` immediately after `allocate team` inside the `part_withdraw_action` block (lines 290-294). Run `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` and confirm silent per [`tasks/refinements/README.md` line 38](../README.md#L38).
- This refinement file — append a `## Status` block at the bottom recording **Closed without implementation — superseded by ADR 0030 + per-facet refactor chain** with the closer's date.

### Constraints the refinement-writer pass MUST satisfy

- **No production code change.** Implicit by the "Files this task touches" allowlist.
- **No test change.** Implicit by the same allowlist.
- **No invented citations.** Every cross-reference above (ADR 0030, `docs/participant-ui.md` line ranges, the per-facet-refactor refinements, the sibling supersessions, the live code surface files) was read by the refinement-writer sub-agent and is real.
- **The refinement document IS the artifact.** Per ADR 0022's "every check is committed," the citation-supported supersession argument is itself the verification — there is no codepath to test because there is no codepath to add.

### What the closer's pass MUST NOT do

- **Do NOT register a placeholder follow-up task** for any "revisit standalone send-action shape" or "add a `useWithdrawAction` distinct from `useWithdrawAgreementAction`" in `tasks/40-participant-ui.tji`. Decision §3 below explains why a placeholder is wrong. The closer registers a follow-up ONLY if the user separately decides one is in scope.
- **Do NOT close `part_my_agreements_view`.** That leaf is Optional and independently scoped per `part_find_agreed_facet.md` Decision §3.
- **Do NOT close `part_withdraw` parent in the same pass.** The parent's `complete 100` is its own ritual step (the orchestrator's next pass will pick it up once all three required leaves are closed); pre-emptively closing the parent here would skip the audit-trail step of confirming each leaf-closure stands on its own.
- **Do NOT amend ADR 0030.** It already settles the architectural shift (dedicated event kind + always-on row block + `vote.choice` shrink); the hook-vs.-standalone-action *shape* call is correctly a refinement-layer decision in `pf_part_withdraw_agreement_action` Decision §2, not an ADR-layer one.
- **Do NOT edit `docs/participant-ui.md`.** The L42-L45 per-status row description ("emits `withdraw-agreement`, sending the facet back to `disputed`") was written before ADR 0030's projection-side status rename to `withdrawn`; Decision §1 explains why the prose still reads correctly (the methodology *transition* is identical — a previously-agreed facet becomes withdrawable / open-to-dispute again — only the projected label evolved). Re-writing the prose would be drift; the surface-detail belongs in `pf_part_withdraw_agreement_action`'s refinement (where it lives), not in the high-level UX sketch.
- **Do NOT edit `docs/methodology.md`.** L25 ("An `agreed` facet transitions back to `disputed`.") is the methodology-layer rule; the projection-layer status name evolution (post-ADR-0030 `withdrawn`) does not require a methodology re-statement because the underlying rule (a withdrawn agreement re-opens the facet for fresh agreement) is identical.
- **Do NOT delete or rename the task block** in `tasks/40-participant-ui.tji` lines 290-294. Closing as `complete 100` with a Status pointer is the recorded outcome; deleting the block would erase the audit trail.

### Test layers per ADR 0022

Zero new tests. The supersession argument is structural — there is no codepath to add or remove, so no test pins one. The existing per-facet refactor coverage is what guarantees v1's send-withdraw action continues to work:

- `apps/participant/src/detail/useWithdrawAgreementAction.test.tsx` — 13 Vitest cases pinning the hook contract: success path, failure path (wire error + timeout), in-flight isolation across `(entity_kind, entity_id, facet)` slots. These are the exact cases this leaf would have shipped as `useWithdrawAction.test.tsx`.
- `apps/participant/src/detail/ParticipantVoteButtons.test.tsx` — 5-case "wired withdraw button" describe block covering the arm-then-fire path (arm on first tap; fire `withdraw-agreement` on second; surface `lastError` in the inline error region; reset to idle on cancel).
- `tests/e2e/methodology-full-flow.spec.ts` (per `pf_e2e_methodology_full_flow_update`) — exercises the arm → confirm → send → assert-facet-flips-to-`withdrawn` chain end-to-end through the wired button surface.
- Server-side: `apps/server/src/ws/handlers/withdraw-agreement.test.ts` (per `pf_withdraw_agreement_handler`) — pins the server's accept-path validation + event append.
- Cucumber: the server-side WS scenarios under `tests/behavior/` for `withdraw-agreement` (per `pf_withdraw_agreement_handler` Status block) pin the wire-to-projection chain.

A grep for `useWithdrawAction|use.withdraw.action|sendWithdraw|withdraw.send.action|withdraw_action.ts` across the test tree returns zero matches today and continues to return zero matches after the closer's pass — that is the regression-pin shape for "no separate standalone send-withdraw action exists outside the hook."

### UI-stream e2e policy (does not apply)

The policy ([`tasks/refinements/README.md` UI-stream e2e section](../README.md)) requires a Playwright spec OR a deferred-e2e justification with a future wiring task. **Deferred-e2e does not apply here either.** The deferral path covers tasks that *create a component or capability that no user flow currently reaches*; this task creates no component at all. The closer's Status block records the supersession; no future task inherits e2e debt against this one (because no future task implements it). The post-ADR-0030 send-withdraw action IS covered end-to-end by the methodology-full-flow Playwright spec via the wired button + hook surface — that spec belongs to `pf_e2e_methodology_full_flow_update`, not this leaf.

### Backend / WS / projector / methodology-engine policy (does not apply)

No wire change. No broadcast envelope shape change. No projector output change. No new Cucumber scenario. The `withdraw-agreement` wire envelope (`pf_withdraw_agreement_event_kind`) + the server validator (`pf_withdraw_agreement_handler`) + the projection's `withdrawn` status rule (`facetStatus.ts`) are all already shipped + tested via the per-facet refactor chain. This refinement adds no backend / projector / methodology-engine surface — it explains why no participant-side send-action implementation is needed.

### Budget honesty (refinement-writer pass — under 0.5d)

- ~20 min: read the sibling supersessions `part_withdraw_dialog.md` end-to-end and `part_find_agreed_facet.md` Decision §3 + §4 (the structural template + the "leave Optional sibling alone" precedent).
- ~20 min: read `pf_part_withdraw_agreement_action.md` end-to-end (Constraints L27 + L30-L31 + Decision §2 + Status block are the direct supersession evidence).
- ~10 min: read ADR 0030 §2 + §3 + §10 + Consequences (the architectural backdrop, including the `vote.choice` shrink to `'agree' | 'dispute'`).
- ~10 min: read `docs/participant-ui.md` L42-L45 + L93-L101 + L25 of `docs/methodology.md` (the UX + methodology prose, including the "facet → disputed" wording that this refinement explains carries over correctly to the `withdrawn` projection-layer name).
- ~10 min: read the live code surface (`useWithdrawAgreementAction.ts` slot shape, `ParticipantVoteButtons.tsx` agreed/committed branches, `apps/server/src/ws/handlers/withdraw-agreement.ts` validator) to confirm the hook IS the send action.
- ~5 min: confirm the WBS shape (`tasks/40-participant-ui.tji` lines 290-294) and the closure of the prereq leaves at lines 279-288.
- ~5 min: read `pf_withdraw_agreement_event_kind.md` + `pf_withdraw_agreement_handler.md` (the wire + server envelopes the hook rides).
- ~50 min: write this refinement document.
- ~10 min: final read-through to ensure the citations are accurate.

The closer's pass costs an additional ~15 min — `complete 100` + `tj3 project.tjp` validate + Status-block append.

Risk surface is minimal. The main hazard is that a future reader interprets `complete 100` against this leaf as "a standalone `useWithdrawAction` hook or send-action module landed" — Decision §2 below mandates the Status block prose to head off that misreading (explicit "the send action is the `useWithdrawAgreementAction.withdraw()` slot, not a separate module" language). A secondary hazard is that the `docs/participant-ui.md:42-45` prose ("sending the facet back to `disputed`") becomes a citation a future reader uses to argue the projection should rename `withdrawn` to `disputed` *now* — Decision §1 below explicitly addresses how the methodology-layer rule (the facet re-opens for fresh agreement) is identical to the projection-layer name (`withdrawn`), and the rename is a structural disambiguation the per-facet refactor settled.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is either an existing committed test, a citation-supported documentation read, or a structural property of the codebase that a grep can verify.

1. **The refinement document exists** at `tasks/refinements/participant-ui/part_withdraw_action.md` and cites ADR 0030 §2 + §3 + §10 + Consequences, `docs/participant-ui.md` lines L42-L45 + L93-L101, the per-facet-refactor refinements (`pf_part_withdraw_agreement_action` Constraints L27 + L30-L31 + Decision §2 + Status block, `pf_withdraw_agreement_event_kind`, `pf_withdraw_agreement_handler`, `pf_part_detail_panel_three_facet_rows`), and the sibling / precedent supersession refinements (`part_withdraw_dialog`, `part_find_agreed_facet`, `part_agree_all_gesture`). This document IS the verification.
2. **`pnpm install` clean** — no dep changes.
3. **`pnpm run check` stays green** (lint + format + typecheck + typecheck-tools + typecheck-tests). The closer's pass touches no TypeScript file, so this is implicit.
4. **`pnpm run test:smoke` stays green** with the existing smoke count unchanged. No new test landed.
5. **`pnpm --filter @a-conversa/i18n-catalogs run check`** stays green — no new i18n keys.
6. **`pnpm run test:e2e --project=chromium-participant-skeleton`** stays green — the existing methodology-full-flow Playwright spec (per `pf_e2e_methodology_full_flow_update`) covers the post-ADR-0030 arm → confirm → send → assert-`withdrawn` chain unchanged.
7. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches (REFINEMENT-WRITER PASS)" for this refinement-writer pass; and outside the allowlist in "Files the CLOSER's pass touches" for the closer's follow-up.
8. **Grep regression-pin: `rg "useWithdrawAction|use.withdraw.action|sendWithdraw|withdraw.send.action|withdraw_action\.ts" apps/ packages/ tests/` returns zero matches** (the absence is the structural property that pins "no v1 standalone send-withdraw action exists outside the `useWithdrawAgreementAction` hook"). The only matches across the repo are inside `tasks/` (refinement-document prose + the `.tji` block itself) and this file.
9. **Grep positive-pin: `rg "useWithdrawAgreementAction|withdraw-agreement" apps/participant/src/`** returns the existing matches from `useWithdrawAgreementAction.ts` + `ParticipantVoteButtons.tsx` (the structural signal that the hook IS the wired send action) — unchanged before and after the closer's pass.
10. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after the closer's pass lands `complete 100` on `part_withdraw_action` in `tasks/40-participant-ui.tji`.
11. **The closer's Status block** records "**Closed without implementation — superseded by ADR 0030 + per-facet refactor chain (`pf_part_withdraw_agreement_action`'s `useWithdrawAgreementAction` hook + wired button)**" with the closer's date and a one-line pointer to this refinement's Decision §1.
12. **No follow-up task registered today.** Decision §3 — the hook-shape decision (single `useWithdrawAgreementAction` parallel to `useVoteAction` / `useAxiomMarkAction`) is recorded at `pf_part_withdraw_agreement_action.md` Decision §2 and is not subject to re-litigation by this refinement. A grep for any new `withdraw_action_*` / `send_withdraw_*` / `use_withdraw_*` leaf in `tasks/` returns zero matches before and after the closer's pass.
13. **`part_withdraw` parent becomes rollup-ready.** With all three required leaves closed (`part_find_agreed_facet` ✓ 2026-05-26, `part_withdraw_dialog` ✓ 2026-05-27, this leaf), the parent's own `complete 100` can land in the next task-completion ritual pass. The Optional `part_my_agreements_view` does not gate the rollup.

## Decisions

### 1. Close as superseded by ADR 0030 + the per-facet refactor chain; do not implement a standalone send-withdraw action

The four-pin argument that settles this:

- **Pin A (ADR 0030 §3 + §10 + Consequences)** — Withdrawal becomes a first-class `withdraw-agreement` event kind (not a vote-arm); the `vote.choice` enum shrinks to `'agree' | 'dispute'` only; the participant detail panel renders all three facet rows per node (two per edge); the find-then-withdraw flow collapses onto one panel surface. The send action lives on the wired button at the second tap of the row-local two-stage gesture — the ADR's §3 + Consequences already prescribe the wire envelope the action dispatches, so there is no architectural seam left for this leaf to fill.
- **Pin B (`docs/participant-ui.md:42-45 + :93-101`)** — The UX sketch's step 3 ("Confirm withdrawal — the tablet emits a `withdraw-agreement` event") IS the send-emit beat this leaf was scoped to build. The per-status row description ("emits `withdraw-agreement`, sending the facet back to `disputed`") captures the methodology-layer effect; the post-ADR-0030 projection names the resulting status `withdrawn` (rather than `disputed`) to disambiguate "previously-agreed, now withdrawn" from "fresh disputed (never agreed)" — but the methodology rule (the facet re-opens for fresh agreement) is identical. The "facet → disputed" prose continues to read correctly because the methodology-layer transition the docs describe IS preserved; only the projection-layer label evolved.
- **Pin C (`pf_part_withdraw_agreement_action.md` Constraints L27 + L30-L31 + Decision §2)** — The per-facet refactor refinement EXPLICITLY ships the hook this leaf was scoped to build. Constraints L27 defines the slot shape (`useWithdrawAgreementAction(entityKind, entityId, facet) → { withdraw, inFlight, lastError }`); Constraints L30-L31 defines the success / error semantics (`withdrawn` projection on accept; inline error region on failure); Decision §2 establishes the one-hook-per-gesture pattern parallel to `useVoteAction` / `useAxiomMarkAction`. The Status block L56 records the wired result + the per-slot Zustand-backed isolation; Status block L59 records the 13-case Vitest contract + the 5-case wired-withdraw-button describe block. The send action is the `withdraw()` slot.
- **Pin D (live code surface — `apps/participant/src/detail/useWithdrawAgreementAction.ts` + `ParticipantVoteButtons.tsx` agreed/committed branches + `apps/server/src/ws/handlers/withdraw-agreement.ts`)** — Structural invariant. The hook's `withdraw()` dispatches the wire envelope; the wired button calls it from its second-tap (the confirmed beat of the two-stage gesture); the server-side handler validates + appends; the projection flips the row to `withdrawn`. The entire send-confirm-projection chain is wired, tested, and in production. There is no standalone "send-withdraw" module distinct from the hook to implement.

The "facet → disputed" wording in the WBS one-liner and at `docs/participant-ui.md:42-45` reads correctly against the `withdrawn` projection label because the underlying methodology rule (a withdrawn agreement re-opens the facet for fresh agreement votes) is identical. The projection-layer name evolved (per ADR 0030's per-facet refactor) to disambiguate two distinct states — "never agreed; fresh open for vote" (`disputed`) vs. "was agreed; withdrew; now open again for vote" (`withdrawn`) — that the methodology-layer rule does not distinguish. A future audit reader checking "did the facet end up agreeable again post-withdraw?" gets the same yes from either label; the renamed projection only helps the UI distinguish (visually, label-wise) the *provenance* of the open state. ADR 0030's rename is correctly a projection-layer refinement and does not require re-writing the UX or methodology prose.

Three alternatives surveyed:

- **(A) Close as superseded by ADR 0030 + the per-facet refactor chain** (chosen). Cite the four pins above. No production code change. The closer marks `complete 100` with a "superseded" Status block.
- **(B) Implement a separate `useWithdrawAction.ts` module distinct from `useWithdrawAgreementAction.ts`** (rejected). Reasons:
  - The `useWithdrawAgreementAction` hook already ships the exact slot shape this leaf was scoped to build (`withdraw()` / `inFlight` / `lastError` per `(entity_kind, entity_id, facet)`). Renaming or duplicating it would be churn with zero functional delta — and would introduce a second-name overhead readers have to disambiguate.
  - The ADR 0030 shrink of `vote.choice` to `'agree' | 'dispute'` removes the wire shape the legacy `useWithdrawAction` would have dispatched (`vote` with `choice: 'withdraw'`). Building a `useWithdrawAction` against the now-dedicated `withdraw-agreement` envelope would just be `useWithdrawAgreementAction` under a less-accurate name.
  - The per-facet refactor's one-hook-per-gesture pattern (per `pf_part_withdraw_agreement_action.md` Decision §2) makes `useWithdrawAgreementAction` the conventional name for this gesture; any other name would diverge from the established pattern.
  - No accessibility-team, performance-team, or UX-team feedback in the project history requested a separate send-action module; the methodology contract is satisfied by the hook + button surface as shipped.
- **(C) Defer to a future "revisit standalone send-action shape" task** (rejected). The decision is already made in `pf_part_withdraw_agreement_action` Decision §2 and validated by shipping. There is no actionable open question to defer; deferring would be a placeholder-task anti-pattern.

The supersession is documented citation-by-citation rather than re-derived; this refinement is a "read off the settled sources and record the answer" pass, not a "decide from first principles" pass. Compare to the sibling refinements `part_withdraw_dialog.md` Decision §1 and `part_find_agreed_facet.md` Decision §1 which use the same four-pin pattern against ADR 0030's per-facet refactor / sequential-capture model.

### 2. Close ritual: `complete 100` with a "superseded" Status block (NOT a WBS deletion)

Three alternatives surveyed:

- **(A) `complete 100` + Status block citing this refinement** (chosen). The marker tells `tj3`'s scheduler the leaf is finalized — the parent's rollup can proceed (now that all three required leaves are closed). The Status block tells human readers WHY the marker is `complete 100` despite no commit-record of implementation. Future readers walking the WBS see the marker and read the refinement to learn the supersession. The closer's pass is mechanical: append `complete 100` to lines 290-294 of [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji#L290-L294) and append the Status block at the bottom of this refinement.
- **(B) Delete the task block from the `.tji`** (rejected). Erases the audit trail of "this was once on the WBS as a separate send-withdraw action and was deliberately cancelled in favor of the per-facet hook + wired button surface." A future reader would have no way to know the original three-step find / dialog / send chain was once the planned shape; if a user later asks "didn't we plan a standalone send-withdraw action?" the answer "no, never" would be wrong. The `complete 100` + Status posture preserves the historical record.
- **(C) Add a new TaskJuggler attribute** (e.g., `superseded "yes"`) **instead of `complete 100`** (rejected for the same reasons as `part_agree_all_gesture.md` Decision §2 alternative C and the sibling supersessions — the TaskJuggler grammar has no superseded-task primitive; `complete 100` + Status block prose is the established convention).

The Status block prose the closer writes MUST head off the "completed = standalone send-action module shipped" misreading. A suggested template (the closer adapts the date):

> ## Status
>
> **Closed without implementation — superseded by [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) + the per-facet refactor chain (`pf_part_withdraw_agreement_action`'s `useWithdrawAgreementAction` hook + wired button)** — 2026-MM-DD.
>
> The per-facet refactor chain replaced the planned standalone send-withdraw action with a **single `useWithdrawAgreementAction` hook** parallel to `useVoteAction` / `useAxiomMarkAction`. The hook's `withdraw()` slot dispatches `useWsClient().send('withdraw-agreement', { entity_kind, entity_id, facet, participant })` from the second tap of the row-local two-stage gesture on `agreed` / `committed` facet rows in [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx); the server-side handler at [`apps/server/src/ws/handlers/withdraw-agreement.ts`](../../../apps/server/src/ws/handlers/withdraw-agreement.ts) validates + appends; the projection at [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) flips the row to `withdrawn` (the post-ADR-0030 name for the "previously-agreed, since withdrawn" state, semantically equivalent to the "facet → disputed" transition this leaf's WBS one-liner names). No separate `useWithdrawAction` module, no new wire envelope, no new test surface, no new i18n group. The existing `participant.withdrawAgreementButton.*` catalog entries (`inFlightLabel`, `wireError`, `timeoutError`, `errorRoleLabel`) carry the in-flight + error chrome. The refinement document (Decision §1) is the audit trail.

### 3. Do NOT register a "revisit standalone send-action shape" follow-up task; the hook-shape decision is settled

Three alternatives surveyed:

- **(A) Do not register a follow-up task** (chosen). The hook-shape decision is recorded at `pf_part_withdraw_agreement_action.md` Decision §2 + Status block. The `useWithdrawAgreementAction` hook is shipped, tested (13 Vitest cases for the contract + 5-case wired-button describe block + e2e coverage via `pf_e2e_methodology_full_flow_update`), and in production. There is no actionable open question for a future task to address. Registering a placeholder "revisit send-action module" leaf would be:
  - **An anti-pattern** under the WBS hygiene rules — placeholder tasks with no concrete scope rot in the WBS, get inherited by milestone gates that can never close, and confuse future orchestrator passes.
  - **A latent contradiction** with the supersession argument — Decision §1 says the hook + button surface is strictly equivalent to (and architecturally cheaper than) a standalone module; a "revisit" placeholder would imply the decision is provisional, which it isn't.
- **(B) Register a `part_withdraw_send_action_module_variant` follow-up at 0.5d** (rejected). Per the (A) reasoning above. A user-scoped decision to add a separate module later would land its own refinement when scoped, citing whatever new evidence motivates it — there's no need to pre-reserve a placeholder.
- **(C) Register a retry-on-failure follow-up for the hook** (rejected as out of scope for this refinement). The hook surfaces `lastError` for user-driven re-tap (the established pattern across `useVoteAction` / `useAxiomMarkAction`); whether to introduce automatic retry is a project-wide UX policy decision (and would apply uniformly to the three sibling hooks, not just this one). The right placement for that is a separate cross-hook UX-policy task, not under `part_withdraw.*`.

### 4. Do NOT pre-reserve a send-action-specific testid or hook export

Three alternatives surveyed:

- **(A) Do not reserve `useWithdrawAction`, `participant-withdraw-send-action`, or any send-action-specific testid / export name** (chosen). The existing `useWithdrawAgreementAction` hook export covers the gesture; the `data-withdraw-state` (`'idle' | 'armed' | 'in-flight' | 'error'`) + `data-withdraw-armed` attrs on the per-facet row's withdraw button already give Playwright a precise selector for every state the send action transitions through. The hook's `inFlight` / `lastError` slots are the test-surface for unit-level coverage. Introducing a parallel name would denormalize the signal.
- **(B) Add a `// TODO: rename useWithdrawAgreementAction → useWithdrawAction` comment** in [`apps/participant/src/detail/useWithdrawAgreementAction.ts`](../../../apps/participant/src/detail/useWithdrawAgreementAction.ts) (rejected). The CLAUDE.md instruction "Default to writing no comments" applies; the rejected alternative in `part_withdraw_dialog.md` Decision §4 (B) and `part_find_agreed_facet.md` Decision §4 (B) makes the same case.
- **(C) Pre-register a `tests/e2e/_testids.ts`-style central registry entry** (rejected for the same reasons as the sibling-supersession Decision §4 (C) — no such registry exists; introducing one for a hypothetical future selector would be a disproportionate abstraction).

The decision is documented here so a future "add separate send-action module" pass (if anyone ever scopes one) names its exports / testids afresh against the surfaces it adds.

### 5. No new ADR

Every architectural question this refinement could have raised is already settled by an existing ADR or refinement:

- The dedicated `withdraw-agreement` event kind (replacing the `vote.choice === 'withdraw'` arm) — ADR 0030 §3.
- The `vote.choice` enum shrink to `'agree' | 'dispute'` only — ADR 0030 §3.
- The always-on per-facet row block on the participant detail panel (the surface the wired send button lives on) — ADR 0030 §10 + Consequences.
- The per-facet vote keying that makes the wire `(entity_kind, entity_id, facet)`-discriminated (and thus the hook's per-slot in-flight bookkeeping disjoint) — ADR 0030 §2.
- The `withdrawn` projection-layer status name (replacing the legacy "facet → disputed" wording) — implicit in ADR 0030 §10 + Consequences; concretely realized in `apps/participant/src/graph/facetStatus.ts`.
- The one-hook-per-gesture pattern (`useWithdrawAgreementAction` parallel to `useVoteAction` / `useAxiomMarkAction`) — `pf_part_withdraw_agreement_action` Decision §2 (refinement layer; correctly so because it is a code-conventions decision not an architectural seam).
- The two-tap "deliberate extra tap" confirmation contract — `docs/participant-ui.md:143` (UX-policy layer); realized as the row-local two-stage button per `pf_part_withdraw_agreement_action`.
- The event envelope shape the hook dispatches — ADR 0021.
- The entity / facet layer split that scopes the hook's slot key — ADR 0027.
- The proposal-keyed structural-arm exception (structural sub-kinds keep their proposal-keyed lifecycle; the per-facet refactor doesn't touch them — the `ParticipantVoteButtons.tsx` `'proposal'` row still renders a non-wired placeholder per `pf_part_withdraw_agreement_action` Status block L57) — ADR 0030 §9.

This refinement introduces no new architectural seam, no new dependency, no new security trade-off, no new abstraction. The ADR convention's "amendment-pass rule" ([`docs/adr/README.md`](../../../docs/adr/README.md)) does not fire because there is no architectural decision being made — only a WBS bookkeeping decision (close as superseded) plus three implementation-shaping decisions (no follow-up registration today per Decision §3, no testid / hook-name reservation today per Decision §4, no ADR amendment per this Decision §5).

## Open questions

(none — all decided)

## Status

**Closed without implementation — superseded by [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) + the per-facet refactor chain (`pf_part_withdraw_agreement_action`'s `useWithdrawAgreementAction` hook + wired button)** — 2026-05-27.

- The per-facet refactor chain replaced the planned standalone send-withdraw action with a single `useWithdrawAgreementAction` hook parallel to `useVoteAction` / `useAxiomMarkAction` (see Decision §1 for the four-pin supersession argument).
- The hook's `withdraw()` slot dispatches `useWsClient().send('withdraw-agreement', { entity_kind, entity_id, facet, participant })` from the second tap of the row-local two-stage gesture on `agreed` / `committed` facet rows in [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx).
- Server-side validation + event-append at [`apps/server/src/ws/handlers/withdraw-agreement.ts`](../../../apps/server/src/ws/handlers/withdraw-agreement.ts); the projection at [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) flips the row to `withdrawn` (the post-ADR-0030 name for the "previously-agreed, since withdrawn" state, equivalent to the "facet → disputed" transition this leaf's WBS one-liner names).
- No separate `useWithdrawAction` module, no new wire envelope, no new test surface, no new i18n group landed; existing `participant.withdrawAgreementButton.*` catalog entries carry the in-flight + error chrome.
- Existing per-facet refactor coverage pins the send action end-to-end: `useWithdrawAgreementAction.test.tsx` (13-case hook contract) + `ParticipantVoteButtons.test.tsx` (5-case wired-withdraw-button describe block) + `tests/e2e/methodology-full-flow.spec.ts` (arm → confirm → send → assert-`withdrawn` chain).
- `tasks/40-participant-ui.tji` lines 290–294: `complete 100` added to `part_withdraw_action`; no follow-up task registered (Decision §3).
- This is the third and final required-leaf supersession closure under `part_withdraw` (after `part_find_agreed_facet` 2026-05-26 and `part_withdraw_dialog` 2026-05-27); the parent's `complete 100` is its own ritual pass.
