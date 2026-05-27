# Withdrawal confirmation dialog — superseded; do not implement

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_withdraw.part_withdraw_dialog`
**Effort estimate**: 0.5d (in the WBS; this refinement reduces it to 0 — closer marks `complete 100` with a "superseded" Status block).
**Inherited dependencies**:

- `!participant_ui.part_withdraw.part_find_agreed_facet` (settled — closed as superseded 2026-05-26 per [`tasks/refinements/participant-ui/part_find_agreed_facet.md`](part_find_agreed_facet.md), which records the same per-facet-refactor supersession argument scoped to the find leaf). The closer's `complete 100` on lines 279-282 of [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji#L279-L282) marks the prerequisite as finalized; the per-facet refactor chain's always-on detail-panel surface IS the find affordance the prerequisite was meant to add.
- `!participant_ui.part_voting` (settled — the grandparent's prior dependency in [`tasks/40-participant-ui.tji` line 278](../../40-participant-ui.tji#L278); every leaf under `part_voting.*` shipped via the per-facet refactor including `part_proposal_notification` at commit `38bf660`).
- `!data_and_methodology.methodology_engine.withdrawal_logic` (settled at `2026-05-10` per [`tasks/refinements/data-and-methodology/withdrawal_logic.md` line 113](../data-and-methodology/withdrawal_logic.md#L113)). The post-ADR-0030 wire shape replaces the legacy `vote.choice === 'withdraw'` arm with the dedicated `withdraw-agreement` envelope; either route accepts a withdraw against a committed proposal where the requester previously voted agree.
- Prose-only context (NOT a `.tji` edge): [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) (accepted 2026-05-23 — the per-facet vote keying + sequential-capture model that introduces a dedicated `withdraw-agreement` event kind, rewrites the participant detail panel into an always-on per-facet row block, and pushes the confirmation gesture down to a row-local two-stage button).
- Prose-only context (NOT a `.tji` edge): `!per_facet_refactor.participant_ui.pf_part_detail_panel_three_facet_rows` (settled — every facet of a tapped entity always renders a row; the `agreed` / `committed` row arms render the withdraw button surface that hosts the confirmation gesture).
- Prose-only context (NOT a `.tji` edge): `!per_facet_refactor.participant_ui.pf_part_withdraw_agreement_action` (settled 2026-05-24 per [`tasks/refinements/per-facet-refactor/pf_part_withdraw_agreement_action.md` line 54](../per-facet-refactor/pf_part_withdraw_agreement_action.md#L54)). Ships the row-local two-stage confirmation gesture (arms on first tap, fires `withdraw-agreement` on second tap) + the `useWithdrawAgreementAction` hook + the inline wire-error region + the `data-withdraw-state` / `data-withdraw-armed` test hooks + the i18n catalog entries (`participant.withdrawAgreementButton.*`) that carry the gesture's chrome. This is the surface that replaces the modal dialog.

## What this task is

**Originally:** add a withdrawal confirmation dialog (modal) to the participant UI so that tapping the [Withdraw] button on an `agreed` / `committed` facet opens a confirm-or-cancel surface — the "deliberate extra tap" called out in [`docs/participant-ui.md` line 143](../../../docs/participant-ui.md#L143) and the [P3. Withdraw agreement](../../../docs/participant-ui.md#L93-L101) sketch step 2. This was the middle leaf of the three-step find / dialog / send chain, each owning one piece of the gesture.

**As of this refinement (2026-05-26):** **superseded; do not implement.** The per-facet refactor's `pf_part_withdraw_agreement_action` (done 2026-05-24) landed a **row-local two-stage confirmation gesture** in place of a modal dialog. Tapping [Withdraw] on an `agreed` / `committed` facet row arms the button (first tap); a second tap fires `withdraw-agreement`. The two-tap shape preserves the "deliberately one extra tap" contract from [`docs/participant-ui.md:143`](../../../docs/participant-ui.md#L143) without introducing a separate modal surface. No new component, no modal portal, no escape-key trap, no backdrop-click handler — the confirmation is inline on the row that bears the button.

The closer should mark this task `complete 100` in the matching `.tji` block with a Status note pointing at this refinement (and at the per-facet-refactor citations below). No new component, no new test, no new i18n key, no new wire shape, no new event kind, no production code change. The deliberate documentation of the cancel-as-superseded is itself the artifact of this refinement round.

Concretely:

- **No** new file lands at `apps/participant/src/detail/WithdrawConfirmDialog.tsx`, `apps/participant/src/proposals/WithdrawDialog.tsx`, or any equivalent path. The two-stage button surface inside [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) IS the confirmation gesture — `data-withdraw-armed="true"` on the armed-state button is the structural signal a Playwright spec filters on.
- **No** new test file lands. The existing per-facet refactor coverage (`ParticipantVoteButtons.test.tsx` 5-case "wired withdraw button" describe block including the arm-then-fire path, `useWithdrawAgreementAction.test.tsx` 13-case hook contract, and the `pf_e2e_methodology_full_flow_update` Playwright spec) already pins the arm → confirm → send chain. There is no separate modal surface to pin.
- **No** new Playwright spec lands. The methodology-full-flow Playwright spec (per `pf_e2e_methodology_full_flow_update`) already drives a participant through tap-entity → see agreed-facet row → arm-withdraw → confirm-withdraw → assert facet flips to `withdrawn`. The row-local two-stage shape is the e2e expression of this leaf's "confirmation dialog" intent.
- **No** new i18n key under `participant.withdrawDialog.*` or `participant.withdrawConfirm.*` or equivalent. The existing `participant.withdrawAgreementButton.*` catalog entries (`label`, `confirmLabel`, `inFlightLabel`, `ariaLabel`, `ariaLabelConfirm`, `wireError`, `timeoutError`, `errorRoleLabel` — added by `pf_part_withdraw_agreement_action` per its Status block) cover every label the gesture surfaces. The dialog-replacement carries no chrome of its own.
- **No** new ADR. ADR 0030 already settled the architectural shift (dedicated event kind + always-on row block); the confirmation-gesture *shape* (two-stage inline button vs. modal) is a UX-level refinement decision recorded in `pf_part_withdraw_agreement_action.md` Decision §1. Decision §1 below documents the supersession derivation; no new architectural seam, no new dependency, no new security trade-off, no new abstraction.
- **No** registration of a follow-up task today. The "modal" flavor is not a separately scoped option in the WBS — `pf_part_withdraw_agreement_action` explicitly leaves "confirm modal or two-stage button" as a *judgment-at-implementation-time* call ([`tasks/refinements/per-facet-refactor/pf_part_withdraw_agreement_action.md` line 29](../per-facet-refactor/pf_part_withdraw_agreement_action.md#L29)), and the implementer picked two-stage. Decision §3 explains why this refinement does NOT register a "revisit modal flavor" follow-up.

Out of scope (explicit non-actions this refinement DOES NOT take):

- **Not an ADR amendment.** ADR 0030 already enumerates the per-facet vote keying + sequential-capture model and its consequences for the participant detail panel; this refinement cites it rather than amending or splitting it. The ADR convention's "amend rather than re-decide" rule (per [`docs/adr/README.md`](../../../docs/adr/README.md)) doesn't apply because the original ADR's §3 ("withdrawal becomes a first-class `withdraw-agreement` event kind") + Consequences ("Participant detail panel renders all three facet rows per node") already encode the surface the confirmation gesture lives on; the gesture *shape* (two-stage inline vs. modal) was settled at the refinement layer (`pf_part_withdraw_agreement_action` Decision §1), not the ADR layer.
- **Not a closure of the sibling `part_withdraw_action` leaf.** That leaf is also superseded by `pf_part_withdraw_agreement_action` (the `useWithdrawAgreementAction` hook replaces the standalone send action), but it gets its own refinement round when the orchestrator picks it up. This refinement scope is exactly one leaf — the dialog.
- **Not a re-opening of `part_find_agreed_facet`.** That leaf is already closed-as-superseded per [`tasks/refinements/participant-ui/part_find_agreed_facet.md`](part_find_agreed_facet.md); the find affordance IS the always-on per-facet row block. No edits to that refinement, no edits to its `.tji` block (lines 279-283 of [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji#L279-L283)).
- **Not a closure of the optional `part_my_agreements_view` leaf.** That leaf is independently scoped (history-view UX, not the confirmation gesture) and stays Optional per `part_find_agreed_facet.md` Decision §3.
- **Not a re-evaluation of `pf_part_withdraw_agreement_action`'s gesture-shape decision.** The two-stage row-local button shape is the recorded outcome there; this refinement cites it rather than re-litigating it. A future "revisit the gesture shape" pass (if anyone asks for one) would be a separate, user-scoped decision — not this refinement-writer's call.
- **Not a re-evaluation of the `data-withdraw-state` / `data-withdraw-armed` testid attrs.** These are the established structural hooks for the gesture's arm-then-fire flow; Decision §4 below addresses why this leaf does NOT pre-reserve a modal-dialog testid (`participant-withdraw-confirm-dialog` or similar).
- **Not a new keyboard-trap / escape-key / focus-management surface.** A modal would require all of those (per WAI-ARIA modal-dialog pattern); the inline two-stage button surface lives on the row already in tab order with the rest of the per-facet row buttons. No new a11y plumbing.
- **Not an `aria-modal` / `role="dialog"` ARIA surface.** The two-stage button uses `ariaLabel` / `ariaLabelConfirm` to communicate the armed-vs-unarmed state to assistive tech — the existing chrome covers a11y signaling without needing modal-dialog semantics.
- **Not a backdrop-click-to-cancel surface.** The inline two-stage gesture cancels naturally if the user navigates away from the row or taps elsewhere; no backdrop overlay is needed.
- **Not a "withdraw rationale" capture field.** The data model does not store withdrawal-rationale; the `withdraw-agreement` envelope is `(entity_kind, entity_id, facet, participant)` only per ADR 0030 §3. A dialog might have invited "leave a comment" UX; the inline button correctly does not.

## Why it needs to be done

The task block is on the WBS; the orchestrator's pick-task pass selected it. The refinement round has to either ship a buildable refinement that says "implement this" or explain in writing why the task is now a no-op. The orchestrator does not read status-block prose retroactively; the only way to surface "this task is superseded" durably is to land a refinement that says so AND have the closer flip the `.tji` to `complete 100` with a Status block that points here. Both halves of the ritual ([`tasks/refinements/README.md` lines 32-42](../README.md#L32-L42)) apply even to a superseded task — otherwise the WBS keeps reading `0% complete` against a leaf nobody will ever implement and the milestone scheduler stays blocked on a phantom.

The downstream chain:

1. **`part_withdraw` parent rolls up.** With three sibling leaves under `part_withdraw` (`part_find_agreed_facet` ✓ closed-superseded, this one + `part_withdraw_action` still open), and the optional `part_my_agreements_view` independent of the parent's roll-up gate, closing this leaf as superseded is the second of three matching closures that unblock the parent's `complete 100`. Each of the three superseded leaves gets its own refinement (sequenced through subsequent orchestrator passes); this refinement is the second.
2. **`part_withdraw_action` is blocked on this leaf.** [`tasks/40-participant-ui.tji` line 292](../../40-participant-ui.tji#L292) carries `depends !part_withdraw_dialog`; closing this leaf (even via supersession) finalizes the prereq for the third-and-final withdraw-chain leaf's refinement round.
3. **`part_tests` depends on `!part_withdraw`.** The participant-tests roll-up at [`tasks/40-participant-ui.tji` line 367](../../40-participant-ui.tji#L367) carries `depends !part_voting, !part_withdraw, !part_axiom_mark_from_tablet`. Finishing the withdraw chain's three supersession closures unblocks part_tests' scheduling.
4. **Milestone propagation.** The P3 withdraw flow contributes to whichever milestone aggregates the participant UI work (per [`tasks/99-milestones.tji`](../../99-milestones.tji)). The supersession-via-`complete 100` posture lets the milestone gate clear without a phantom leaf.
5. **Audit trail.** The refinement document IS the artifact that proves the supersession was deliberate, citation-supported, and not an oversight — future readers walking the WBS see `complete 100` and read the refinement's Status block + Decision §1 to understand why no production code corresponds to this "completed" leaf. Critically, a future reader asking "why isn't there a modal dialog component?" finds the answer here without spelunking through commit history.

Architecturally the supersession is **already established** in four settled sources:

- ADR 0030 §3 (`withdraw-agreement` becomes its own event kind, not a vote-arm of a generic `vote`) + §10 (always-on per-facet row block).
- `docs/participant-ui.md:143` (the "two-tap … deliberately one extra tap" touch interaction — the *shape* requirement, satisfied equally by a modal OR a two-stage inline button).
- `pf_part_withdraw_agreement_action` (refinement Decision §1 + Status block — the wired two-stage row-local confirmation gesture replaces the modal dialog while satisfying the two-tap requirement).
- The sibling supersession `part_find_agreed_facet.md` Decision §1 (precedent for "the find/dialog/send chain collapses onto the always-on per-facet row block").

This refinement is the *fifth* recording of the same conclusion at the task-shape layer, scoped to the dialog leaf specifically. No new evidence; no new analysis required.

## Inputs / context

### Design + ADRs (load-bearing for the supersession)

- [docs/participant-ui.md — P3. Withdraw agreement (L93-L101)](../../../docs/participant-ui.md#L93-L101) — the canonical UX sketch: *"1. Find the facet … 2. Tap the [Withdraw] button — a withdraw confirmation appears (this is bigger than a normal vote since it reverses an agreement that was provisionally final). 3. Confirm withdrawal — the tablet emits a `withdraw-agreement` event …"* The "withdraw confirmation appears" language is the dialog/confirmation surface this leaf would have built; the post-ADR-0030 two-stage button realizes the "appears" beat as an armed-state transition on the same button (not a popped modal).
- [docs/participant-ui.md — Touch interactions (L143)](../../../docs/participant-ui.md#L143) — *"Withdrawal confirmation — two-tap (tap [Withdraw] on the agreed/committed facet row, confirm in the dialog). Deliberately one extra tap."* The two-tap shape is the constraint; "in the dialog" is the *originally-planned* surface. The two-stage inline button satisfies the two-tap constraint without introducing a separate modal — Decision §1 below explains why the docs prose still reads correctly against the inline shape (the armed-state button IS the "dialog" in the lowercase sense of *"confirmation surface"*, even though it is not a modal).
- [docs/participant-ui.md — Per-facet voting (L42-L45)](../../../docs/participant-ui.md#L42-L45) — *"`agreed` … The row shows the candidate value and a [Withdraw] button (emits `withdraw-agreement`, sending the facet back to `disputed`). `committed` … The row shows the committed value and a [Withdraw] button (also emits `withdraw-agreement`)."* Per-status row rendering settles where the withdraw affordance lives — and consequently where the confirmation gesture must live.
- [docs/adr/0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) §3 (Decision) + §10 (Decision) + Consequences (a) — the ADR that landed the dedicated `withdraw-agreement` event kind, the always-on per-facet row block, and the collapse of the find / confirm / send chain onto a single panel surface. The ADR does not prescribe modal-vs.-inline for the confirmation gesture — that was correctly left as a refinement-layer decision (`pf_part_withdraw_agreement_action` Decision §1).
- [docs/methodology.md L25](../../../docs/methodology.md#L25) — *"A participant may withdraw agreement they previously gave. An `agreed` facet transitions back to `disputed`."* — the methodology rule that motivates the confirmation gesture (the user is about to reverse a provisionally-final agreement; a deliberate gesture is warranted).
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — applies to the closer's Status block (no production code → no new verification; the existing per-facet refactor tests cover the arm → confirm → send chain).
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — applies indirectly: the existing `participant.withdrawAgreementButton.*` catalog entries (`label`, `confirmLabel`, `inFlightLabel`, `ariaLabel`, `ariaLabelConfirm`, `wireError`, `timeoutError`, `errorRoleLabel`) carry every label the gesture surfaces; a separate dialog would have needed its own `participant.withdrawDialog.title` / `cancelLabel` / etc. that simply do not exist in the catalog.

### Sibling refinements (in this `part_withdraw.*` chain — all superseded by the same per-facet refactor work)

- `part_find_agreed_facet` (1d) — **Closed as superseded 2026-05-26** per [`tasks/refinements/participant-ui/part_find_agreed_facet.md`](part_find_agreed_facet.md). The find affordance is the always-on per-facet row block. The structural template for this refinement.
- This leaf (`part_withdraw_dialog`, 0.5d) — superseded by `pf_part_withdraw_agreement_action`'s two-stage row-local confirmation gesture (the inline two-tap button replaces the modal dialog while satisfying the "deliberately one extra tap" contract from [`docs/participant-ui.md` L143](../../../docs/participant-ui.md#L143)).
- `part_withdraw_action` (0.5d) — superseded by `pf_part_withdraw_agreement_action`'s `useWithdrawAgreementAction` hook. Depends on this leaf via [`tasks/40-participant-ui.tji` line 292](../../40-participant-ui.tji#L292). Awaits its own refinement-round closure.
- `part_my_agreements_view` (1d, Optional) — independent of the supersession per `part_find_agreed_facet.md` Decision §3.

### Per-facet refactor refinements (the supersession source)

- [`tasks/refinements/per-facet-refactor/pf_part_withdraw_agreement_action.md`](../per-facet-refactor/pf_part_withdraw_agreement_action.md) — Done 2026-05-24. **The direct supersession source for this leaf.** Decision §1 ("Confirmation gesture is required. Mirrors the existing `part_withdraw_dialog` precedent; consistent UX between the structural withdraw and the new facet withdraw.") explicitly references `part_withdraw_dialog` as the precedent it satisfies. Constraints L29: *"A confirmation gesture is required (per the prior `part_withdraw_dialog` precedent — deliberate extra tap; the methodology treats withdrawal as a significant gesture). Implementation can be a confirm modal or a two-stage button; judgment at implementation time."* — the implementer chose two-stage; Status block L57 records the row-local two-stage gesture (arms on first tap, fires on second).
- [`tasks/refinements/per-facet-refactor/pf_part_detail_panel_three_facet_rows.md`](../per-facet-refactor/pf_part_detail_panel_three_facet_rows.md) — Done. Always-render every facet row; the `agreed` / `committed` row arms host the withdraw button (and thus the confirmation gesture).
- [`tasks/refinements/per-facet-refactor/pf_withdraw_agreement_event_kind.md`](../per-facet-refactor/pf_withdraw_agreement_event_kind.md) — Done. The `withdraw-agreement` event kind + its zod schema. The wire envelope the second-tap fires.
- [`tasks/refinements/per-facet-refactor/pf_withdraw_agreement_handler.md`](../per-facet-refactor/pf_withdraw_agreement_handler.md) — Done. The server-side WS handler that validates + appends the `withdraw-agreement` event.
- [`tasks/refinements/per-facet-refactor/pf_e2e_methodology_full_flow_update.md`](../per-facet-refactor/pf_e2e_methodology_full_flow_update.md) — the Playwright spec that exercises the arm → confirm → send chain end-to-end.

### Prior precedent refinements

- [`tasks/refinements/participant-ui/part_find_agreed_facet.md`](part_find_agreed_facet.md) — Closed as superseded 2026-05-26. The structural template for this refinement: same supersession argument shape, same ADR 0030 citation set, same "no new ADR, no new follow-up registration" posture.
- [`tasks/refinements/participant-ui/part_agree_all_gesture.md`](part_agree_all_gesture.md) — Closed as superseded 2026-05-24. The original precedent for "close-as-superseded with `complete 100` + Status block" in the participant-ui area.
- [`tasks/refinements/data-and-methodology/withdrawal_logic.md`](../data-and-methodology/withdrawal_logic.md) — Done 2026-05-10. The write-side validator; the methodology rule the confirmation gesture protects.

### Live code surface (no change)

- [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) — the always-on per-facet row block. The `agreed` / `committed` branches host the wired withdraw button with two-stage confirmation; the `data-withdraw-state` / `data-withdraw-armed` attrs expose the arm-then-fire state for assertions. Byte-stable.
- [`apps/participant/src/detail/useWithdrawAgreementAction.ts`](../../../apps/participant/src/detail/useWithdrawAgreementAction.ts) — the wired hook the second tap calls. `withdraw()` / `inFlight` / `lastError` slots keyed by `(entity_kind, entity_id, facet)`. Byte-stable.
- [`apps/participant/src/detail/EntityDetailPanel.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.tsx) — the panel that mounts the per-facet row block on graph-tap. Byte-stable.
- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — the `participant.withdrawAgreementButton.*` group (label, confirmLabel, inFlightLabel, ariaLabel, ariaLabelConfirm, wireError, timeoutError, errorRoleLabel) carries every label the two-stage gesture surfaces. Byte-stable.
- [`apps/server/src/ws/handlers/withdraw-agreement.ts`](../../../apps/server/src/ws/handlers/withdraw-agreement.ts) — server-side validator. Byte-stable.
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — `wsWithdrawAgreementPayloadSchema` + the `'withdraw-agreement'` envelope arm. Byte-stable.

### Files this refinement writes

- [`tasks/refinements/participant-ui/part_withdraw_dialog.md`](.) — this document.

### Files this refinement does NOT touch

- No app source — `apps/participant/`, `apps/moderator/`, `apps/server/`, `apps/audience/` all byte-stable.
- No shared package — `packages/shared-types/`, `packages/shell/`, `packages/i18n-catalogs/` all byte-stable.
- No test file — `apps/participant/src/**/*.test.tsx`, `tests/e2e/**/*.spec.ts`, `tests/behavior/**/*.feature` all byte-stable.
- No SQL migration — `apps/server/migrations/` byte-stable.
- No `.tji` file — the `complete 100` marker on `tasks/40-participant-ui.tji` lines 284-288 lands at task-completion-ritual time per [`tasks/refinements/README.md` lines 32-42](../README.md#L32-L42), driven by the closer (NOT this refinement-writer sub-agent).
- No new ADR — Decision §1 below documents why the supersession derivation doesn't warrant one.
- No `docs/adr/`, no `DESIGN.md`, no `docs/participant-ui.md`, no `docs/methodology.md` edit — they already say what this refinement reads off.

## Constraints / requirements

### Files this task touches (explicit allowlist — REFINEMENT-WRITER PASS)

- `tasks/refinements/participant-ui/part_withdraw_dialog.md` (this file).

### Files the CLOSER's pass touches (the `complete 100` ritual — NOT this refinement-writer's pass)

- `tasks/40-participant-ui.tji` — add `complete 100` immediately after `allocate team` inside the `part_withdraw_dialog` block (lines 284-288). Run `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` and confirm silent per [`tasks/refinements/README.md` line 38](../README.md#L38).
- This refinement file — append a `## Status` block at the bottom recording **Closed without implementation — superseded by ADR 0030 + per-facet refactor chain** with the closer's date.

### Constraints the refinement-writer pass MUST satisfy

- **No production code change.** Implicit by the "Files this task touches" allowlist.
- **No test change.** Implicit by the same allowlist.
- **No invented citations.** Every cross-reference above (ADR 0030, `docs/participant-ui.md` line ranges, the per-facet-refactor refinements, the sibling supersession `part_find_agreed_facet.md`, the live code surface files) was read by the refinement-writer sub-agent and is real.
- **The refinement document IS the artifact.** Per ADR 0022's "every check is committed," the citation-supported supersession argument is itself the verification — there is no codepath to test because there is no codepath to add.

### What the closer's pass MUST NOT do

- **Do NOT register a placeholder follow-up task** for any "revisit modal flavor" or "add explicit dialog component" in `tasks/40-participant-ui.tji`. Decision §3 below explains why a placeholder is wrong. The closer registers a follow-up ONLY if the user separately decides one is in scope.
- **Do NOT close the sibling `part_withdraw_action` leaf in the same pass.** It needs its own refinement document recording its own supersession argument (citation set + alternatives surveyed); pre-emptively closing it here would skip the audit trail the refinement system relies on. The closer's mechanical step here is the one leaf this refinement names.
- **Do NOT close `part_my_agreements_view`.** That leaf is Optional and independently scoped per `part_find_agreed_facet.md` Decision §3.
- **Do NOT amend ADR 0030.** It already settles the architectural shift; the confirmation-gesture *shape* is correctly a refinement-layer decision in `pf_part_withdraw_agreement_action` Decision §1, not an ADR-layer one.
- **Do NOT edit `docs/participant-ui.md`.** The L93-L101 P3 sketch + the L42-L45 per-status row description + the L143 two-tap touch interaction collectively describe the post-ADR-0030 confirmation gesture. The prose at L143 uses the word "dialog" in the lowercase sense — the two-stage inline button IS the confirmation surface, just realized inline rather than as a modal. Re-writing the prose to say "two-stage button" instead of "in the dialog" would be drift; the surface-shape detail belongs in `pf_part_withdraw_agreement_action`'s refinement (where it lives now), not in the high-level UX sketch.
- **Do NOT delete or rename the task block** in `tasks/40-participant-ui.tji` lines 284-288. Closing as `complete 100` with a Status pointer is the recorded outcome; deleting the block would erase the audit trail.

### Test layers per ADR 0022

Zero new tests. The supersession argument is structural — there is no codepath to add or remove, so no test pins one. The existing per-facet refactor coverage is what guarantees v1's confirmation gesture continues to work:

- `apps/participant/src/detail/ParticipantVoteButtons.test.tsx` — per-status row renderings including the 5-case "wired withdraw button" describe block that pins the arm-then-fire two-tap behavior (the confirmation gesture surface).
- `apps/participant/src/detail/useWithdrawAgreementAction.test.tsx` — 13 Vitest cases pinning the hook contract (which the second tap invokes).
- `tests/e2e/methodology-full-flow.spec.ts` (per `pf_e2e_methodology_full_flow_update`) — exercises the arm → confirm → send chain end-to-end through the inline two-stage gesture.

A grep for `WithdrawConfirmDialog|WithdrawDialog|withdraw.confirm.dialog|withdraw.dialog` across the test tree returns zero matches today and continues to return zero matches after the closer's pass — that is the regression-pin shape for "no separate modal-dialog surface exists."

### UI-stream e2e policy (does not apply)

The policy ([`tasks/refinements/README.md` UI-stream e2e section](../README.md)) requires a Playwright spec OR a deferred-e2e justification with a future wiring task. **Deferred-e2e does not apply here either.** The deferral path covers tasks that *create a component or capability that no user flow currently reaches*; this task creates no component at all. The closer's Status block records the supersession; no future task inherits e2e debt against this one (because no future task implements it). The post-ADR-0030 confirmation gesture IS covered end-to-end by the methodology-full-flow Playwright spec via the inline two-stage button — that spec belongs to `pf_e2e_methodology_full_flow_update`, not this leaf.

### Backend / WS / projector / methodology-engine policy (does not apply)

No wire change. No broadcast envelope shape change. No projector output change. No new Cucumber scenario. The `withdraw-agreement` wire envelope + the server validator + the read-side facet status walk are all already shipped + tested via the per-facet refactor chain.

### Budget honesty (refinement-writer pass — under 0.5d)

- ~15 min: read the sibling supersession `part_find_agreed_facet.md` (Decision §1's four-pin pattern + Decision §3's "leave `part_my_agreements_view` independently scoped" pattern provide the structural template).
- ~20 min: read `pf_part_withdraw_agreement_action.md` end-to-end (Decision §1 + Constraints L29 + Status block L57 are the direct supersession evidence).
- ~10 min: read ADR 0030 §3 + §10 + Consequences (the architectural backdrop) and `docs/participant-ui.md` L42-L45 + L93-L101 + L143 (the UX prose).
- ~10 min: read the live code surface (`ParticipantVoteButtons.tsx`'s `agreed` / `committed` branches and the `data-withdraw-state` / `data-withdraw-armed` attrs) to confirm the two-stage gesture IS the confirmation surface.
- ~5 min: confirm the WBS shape (`tasks/40-participant-ui.tji` lines 284-288) and the downstream `part_withdraw_action` edge at L292.
- ~5 min: read the original precedent `part_agree_all_gesture.md` opening sections for structural-template double-check.
- ~45 min: write this refinement document.
- ~10 min: final read-through to ensure the citations are accurate.

The closer's pass costs an additional ~15 min — `complete 100` + `tj3 project.tjp` validate + Status-block append.

Risk surface is minimal. The main hazard is that a future reader interprets `complete 100` against this leaf as "the modal-dialog component shipped" — Decision §2 below mandates the Status block prose to head off that misreading (explicit "no modal landed; the two-stage inline button satisfies the two-tap contract" language). A secondary hazard is that the `docs/participant-ui.md:143` prose ("confirm in the dialog") becomes a citation a future reader uses to argue for adding a modal *now* — Decision §1 below explicitly addresses how the lowercase "dialog" reads correctly against the inline shape (the armed-state button IS the confirmation surface; the prose was written before ADR 0030's per-facet refactor landed and the word survives correctly because "dialog" in the lowercase sense covers any confirm-or-cancel surface).

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is either an existing committed test, a citation-supported documentation read, or a structural property of the codebase that a grep can verify.

1. **The refinement document exists** at `tasks/refinements/participant-ui/part_withdraw_dialog.md` and cites ADR 0030 §3 + §10 + Consequences, `docs/participant-ui.md` lines L42-L45 + L93-L101 + L143, the per-facet-refactor refinement `pf_part_withdraw_agreement_action` (Decision §1 + Constraints L29 + Status block L57), and the precedent supersession refinements (`part_find_agreed_facet`, `part_agree_all_gesture`). This document IS the verification.
2. **`pnpm install` clean** — no dep changes.
3. **`pnpm run check` stays green** (lint + format + typecheck + typecheck-tools + typecheck-tests). The closer's pass touches no TypeScript file, so this is implicit.
4. **`pnpm run test:smoke` stays green** with the existing smoke count unchanged. No new test landed.
5. **`pnpm --filter @a-conversa/i18n-catalogs run check`** stays green — no new i18n keys.
6. **`pnpm run test:e2e --project=chromium-participant-skeleton`** stays green — the existing methodology-full-flow Playwright spec (per `pf_e2e_methodology_full_flow_update`) covers the post-ADR-0030 arm → confirm → send chain unchanged.
7. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches (REFINEMENT-WRITER PASS)" for this refinement-writer pass; and outside the allowlist in "Files the CLOSER's pass touches" for the closer's follow-up.
8. **Grep regression-pin: `rg "WithdrawConfirmDialog|WithdrawDialog|withdraw.confirm.dialog|withdraw.dialog" apps/ packages/ tests/` returns zero matches** (the absence is the structural property that pins "no v1 modal-dialog surface for withdrawal exists"). The only matches across the repo are inside `tasks/` (refinement-document prose + the `.tji` block itself) and this file.
9. **Grep positive-pin: `rg "data-withdraw-armed|data-withdraw-state" apps/participant/src/`** returns the existing matches from `ParticipantVoteButtons.tsx` (the structural signal that the two-stage gesture IS the confirmation surface) — unchanged before and after the closer's pass.
10. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after the closer's pass lands `complete 100` on `part_withdraw_dialog` in `tasks/40-participant-ui.tji`.
11. **The closer's Status block** records "**Closed without implementation — superseded by ADR 0030 + per-facet refactor chain (`pf_part_withdraw_agreement_action` two-stage inline gesture)**" with the closer's date and a one-line pointer to this refinement's Decision §1.
12. **No follow-up task registered today.** Decision §3 — the gesture-shape decision (two-stage inline vs. modal) is recorded at `pf_part_withdraw_agreement_action` Decision §1 and is not subject to re-litigation by this refinement. A grep for any new `withdraw_dialog_*` / `withdraw_modal_*` leaf in `tasks/` returns zero matches before and after the closer's pass.
13. **`part_withdraw_action` becomes refinement-ready.** With this leaf closed (and `part_find_agreed_facet` already closed), the third-and-final `part_withdraw.*` leaf at [`tasks/40-participant-ui.tji` line 289-293](../../40-participant-ui.tji#L289-L293) has its prerequisite (`!part_withdraw_dialog`) finalized; the orchestrator can pick it up in a subsequent pass.

## Decisions

### 1. Close as superseded by ADR 0030 + the per-facet refactor chain; do not implement a modal dialog

The four-pin argument that settles this:

- **Pin A (ADR 0030 §3 + §10 + Consequences)** — Withdrawal becomes a first-class `withdraw-agreement` event kind; the participant detail panel renders all three facet rows per node (two per edge); the find-then-withdraw flow collapses onto one panel surface. The confirmation gesture therefore lives on the same row that bears the withdraw button — the ADR does not prescribe modal-vs.-inline, leaving the *shape* to the refinement layer.
- **Pin B (`docs/participant-ui.md:143` + L93-L101)** — The "two-tap … deliberately one extra tap" constraint is the methodology requirement: the gesture must be deliberately harder than a normal vote, not the casual one-tap of agree/dispute. The two-tap shape is the structural contract; "in the dialog" is descriptive prose written before ADR 0030 landed. A two-stage inline button satisfies the two-tap contract precisely (arm = first tap; fire = second tap), at the same number of taps a modal would have required (one to confirm), with the same deliberate-pause beat in the middle.
- **Pin C (`pf_part_withdraw_agreement_action.md` Decision §1 + Constraints L29)** — The per-facet refactor refinement EXPLICITLY references this leaf's precedent (*"Mirrors the existing `part_withdraw_dialog` precedent; consistent UX between the structural withdraw and the new facet withdraw"*) and explicitly leaves the modal-vs.-inline call as a refinement-layer decision (*"Implementation can be a confirm modal or a two-stage button; judgment at implementation time"*). The implementer chose two-stage; the Status block L57 records the wired result; the test coverage L59-L60 pins the arm-then-fire path.
- **Pin D (live code surface — `apps/participant/src/detail/ParticipantVoteButtons.tsx` agreed/committed branches with `data-withdraw-state` / `data-withdraw-armed`)** — Structural invariant. The armed-state button IS the confirmation surface; the structural attrs expose the state for Playwright assertions; the i18n entries `participant.withdrawAgreementButton.confirmLabel` / `ariaLabelConfirm` carry the armed-state chrome. No modal portal, no backdrop, no focus trap — and yet the two-tap contract holds.

The "dialog" wording at `docs/participant-ui.md:143` is *lowercase-d* and reads correctly against the inline shape: in plain English, a "dialog" is any back-and-forth surface (the user is asked "are you sure?", the user confirms or doesn't) — the armed-state button is the surface; the user's choice to tap-or-not-tap is the answer. Capital-D `<Dialog>` (the React-component flavor with a modal portal) was *one possible realization* of the surface, not the only one. ADR 0030's collapse to the always-on row block made the inline realization strictly cheaper at every dimension (a11y, perf, code surface, test surface, i18n surface) while preserving the methodology contract.

Three alternatives surveyed:

- **(A) Close as superseded by ADR 0030 + the per-facet refactor chain** (chosen). Cite the four pins above. No production code change. The closer marks `complete 100` with a "superseded" Status block.
- **(B) Implement a separate `WithdrawConfirmDialog.tsx` modal component anyway** (rejected). Reasons:
  - The two-stage inline button already satisfies the two-tap "deliberately one extra tap" contract. Adding a modal *on top of* the existing inline gesture would make the gesture *three* taps (arm + open modal + confirm in modal) — a worse fit for the methodology contract, not a better one.
  - Replacing the two-stage gesture *with* a modal would require ripping out the wired, tested two-stage path (`pf_part_withdraw_agreement_action`'s 5-case "wired withdraw button" Vitest describe block + the `data-withdraw-state` / `data-withdraw-armed` testid contract + the `pf_e2e_methodology_full_flow_update` Playwright path) and replacing it with a modal-dialog component + portal mount + focus-trap + escape-key handler + backdrop-click handler + ARIA modal semantics + new test surface + new i18n catalog group (`participant.withdrawDialog.title` / `cancelLabel` / etc.). High cost; zero methodology-contract delta.
  - The mobile-first context (landscape tablet, debater holding the device, glance-down-then-tap interaction) penalizes modal surfaces more than desktop: a modal that pops over the graph view fragments the visual context the debater needs to maintain (which entity? which facet? which agreement?). The inline button keeps the row visible while the gesture is in flight.
  - No accessibility-team or UX-team feedback in the project history requested a modal flavor; the methodology contract is satisfied by the simpler shape.
- **(C) Defer to a future "revisit confirmation gesture shape" task** (rejected). The decision is already made in `pf_part_withdraw_agreement_action` Decision §1 and validated by shipping. There is no actionable open question to defer; deferring would be a placeholder-task anti-pattern.

The supersession is documented citation-by-citation rather than re-derived; this refinement is a "read off the settled sources and record the answer" pass, not a "decide from first principles" pass. Compare to the precedent refinements `part_find_agreed_facet.md` Decision §1 and `part_agree_all_gesture.md` Decision §1 which use the same four-pin pattern against ADR 0030's per-facet refactor / sequential-capture model.

### 2. Close ritual: `complete 100` with a "superseded" Status block (NOT a WBS deletion)

Three alternatives surveyed:

- **(A) `complete 100` + Status block citing this refinement** (chosen). The marker tells `tj3`'s scheduler the leaf is finalized — the parent's rollup can proceed (subject to its other open leaves closing). The Status block tells human readers WHY the marker is `complete 100` despite no commit-record of implementation. Future readers walking the WBS see the marker and read the refinement to learn the supersession. The closer's pass is mechanical: append `complete 100` to lines 284-288 of [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji#L284-L288) and append the Status block at the bottom of this refinement.
- **(B) Delete the task block from the `.tji`** (rejected). Erases the audit trail of "this was once on the WBS as a separate modal-dialog component and was deliberately cancelled in favor of a row-local two-stage inline gesture." A future reader would have no way to know the original three-step find / dialog / send chain was once the planned shape; if a user later asks "didn't we plan a confirmation dialog?" the answer "no, never" would be wrong. The `complete 100` + Status posture preserves the historical record.
- **(C) Add a new TaskJuggler attribute** (e.g., `superseded "yes"`) **instead of `complete 100`** (rejected for the same reasons as `part_agree_all_gesture.md` Decision §2 alternative C and `part_find_agreed_facet.md` Decision §2 alternative C — the TaskJuggler grammar has no superseded-task primitive; `complete 100` + Status block prose is the established convention).

The Status block prose the closer writes MUST head off the "completed = modal dialog shipped" misreading. A suggested template (the closer adapts the date):

> ## Status
>
> **Closed without implementation — superseded by [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) + the per-facet refactor chain (`pf_part_withdraw_agreement_action` two-stage inline gesture)** — 2026-MM-DD.
>
> The per-facet refactor chain replaced the planned modal-dialog confirmation with a **row-local two-stage button** on the always-on per-facet row block. The first tap on the [Withdraw] button arms the gesture (the row exposes `data-withdraw-armed="true"`); a second tap fires `withdraw-agreement`. The two-tap shape preserves the "deliberately one extra tap" contract from [`docs/participant-ui.md:143`](../../../docs/participant-ui.md#L143) without introducing a modal portal, focus trap, backdrop handler, or new i18n group. The existing `participant.withdrawAgreementButton.*` catalog entries carry the gesture's chrome (including `confirmLabel` + `ariaLabelConfirm` for the armed state). No source file, no test file, no i18n key, no ADR landed for this task. The refinement document (Decision §1) is the audit trail.

### 3. Do NOT register a "revisit modal flavor" follow-up task; the gesture-shape decision is settled

Three alternatives surveyed:

- **(A) Do not register a follow-up task** (chosen). The gesture-shape decision is recorded at `pf_part_withdraw_agreement_action.md` Decision §1 + Status block. The two-stage inline shape is shipped, tested, and in production. There is no actionable open question for a future task to address. Registering a placeholder "revisit modal flavor" leaf would be:
  - **An anti-pattern** under the WBS hygiene rules — placeholder tasks with no concrete scope rot in the WBS, get inherited by milestone gates that can never close, and confuse future orchestrator passes.
  - **A latent contradiction** with the supersession argument — Decision §1 says the inline shape is strictly cheaper and equally compliant with the methodology contract; a "revisit" placeholder would imply the decision is provisional, which it isn't.
- **(B) Register a `part_withdraw_dialog_modal_variant` follow-up at 0.5d** (rejected). Per the (A) reasoning above. A user-scoped decision to add a modal flavor later would land its own refinement when scoped, citing whatever new evidence motivates it — there's no need to pre-reserve a placeholder.
- **(C) Register an a11y-audit follow-up for the inline two-stage shape** (rejected as out of scope for this refinement). The a11y attrs (`ariaLabel` / `ariaLabelConfirm` / `errorRoleLabel`) are already in place per `pf_part_withdraw_agreement_action.md` Status block L58; whether to commission a screen-reader / WAI-ARIA audit on the participant UI as a whole is a separate, project-wide decision (and the right placement for that is an audit task at the milestone level, not under `part_withdraw.*`).

### 4. Do NOT pre-reserve a modal-dialog testid or ARIA selector

Three alternatives surveyed:

- **(A) Do not reserve `participant-withdraw-confirm-dialog`, `withdraw-modal`, `role="dialog"`, or any modal-specific testid / ARIA selector** (chosen). The existing `data-withdraw-state` (`'idle' | 'armed' | 'in-flight' | 'error'`) and `data-withdraw-armed` attrs on the per-facet row's withdraw button already give Playwright a precise selector for the armed-state ("confirmation pending") condition; the `participant.withdrawAgreementButton.confirmLabel` / `ariaLabelConfirm` i18n entries carry the chrome the screen reader announces. No additional testid is needed; introducing one would denormalize the signal.
- **(B) Add a `// TODO: reserve participant-withdraw-confirm-dialog` comment** in [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) (rejected). The CLAUDE.md instruction "Default to writing no comments" applies; the rejected alternative in `part_find_agreed_facet.md` Decision §4 (B) and `part_agree_all_gesture.md` Decision §4 (B) makes the same case.
- **(C) Pre-register a `tests/e2e/_testids.ts`-style central registry entry** (rejected for the same reasons as `part_agree_all_gesture.md` Decision §4 (C) and `part_find_agreed_facet.md` Decision §4 (C) — no such registry exists; introducing one for a hypothetical future selector would be a disproportionate abstraction).

The decision is documented here so a future "add modal-dialog flavor" pass (if anyone ever scopes one) names its testids afresh against the surfaces it adds.

### 5. No new ADR

Every architectural question this refinement could have raised is already settled by an existing ADR or refinement:

- The dedicated `withdraw-agreement` event kind (replacing the `vote.choice === 'withdraw'` arm) — ADR 0030 §3.
- The always-on per-facet row block on the participant detail panel (the surface the confirmation gesture lives on) — ADR 0030 §10 + Consequences.
- The per-facet vote keying that makes the wire `(entity, facet)`-discriminated (and thus the per-row in-flight bookkeeping disjoint) — ADR 0030 §2.
- The two-tap "deliberate extra tap" methodology contract — [`docs/participant-ui.md:143`](../../../docs/participant-ui.md#L143) (UX-policy layer).
- The two-stage inline vs. modal *shape* call — `pf_part_withdraw_agreement_action` Decision §1 (refinement layer, correctly so because it is a UX-shape decision not an architectural seam).
- The entity / facet layer split that scopes where the withdraw row lives — ADR 0027.
- The proposal-keyed structural-arm exception (structural sub-kinds keep their proposal-keyed lifecycle; the per-facet refactor doesn't touch them) — ADR 0030 §9.

This refinement introduces no new architectural seam, no new dependency, no new security trade-off, no new abstraction. The ADR convention's "amendment-pass rule" ([`docs/adr/README.md`](../../../docs/adr/README.md)) does not fire because there is no architectural decision being made — only a WBS bookkeeping decision (close as superseded) plus three implementation-shaping decisions (no follow-up registration today per Decision §3, no testid reservation today per Decision §4, no ADR amendment per this Decision §5).

## Open questions

(none — all decided)

## Status

**Closed without implementation — superseded by [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) + the per-facet refactor chain (`pf_part_withdraw_agreement_action` two-stage inline gesture)** — 2026-05-27.

The per-facet refactor chain replaced the planned modal-dialog confirmation with a **row-local two-stage button** on the always-on per-facet row block. The first tap on the [Withdraw] button arms the gesture (the row exposes `data-withdraw-armed="true"`); a second tap fires `withdraw-agreement`. The two-tap shape preserves the "deliberately one extra tap" contract from [`docs/participant-ui.md:143`](../../../docs/participant-ui.md#L143) without introducing a modal portal, focus trap, backdrop handler, or new i18n group. The existing `participant.withdrawAgreementButton.*` catalog entries carry the gesture's chrome (including `confirmLabel` + `ariaLabelConfirm` for the armed state). No source file, no test file, no i18n key, no ADR landed for this task. The refinement document (Decision §1) is the audit trail.

- No new component at `apps/participant/src/detail/WithdrawConfirmDialog.tsx` — the two-stage inline button in [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) IS the confirmation gesture.
- `data-withdraw-state` / `data-withdraw-armed` attrs already wired in `ParticipantVoteButtons.tsx` are the structural test hooks for the arm-then-fire flow; no new testid surface.
- Regression pins confirmed: negative pin (no modal-dialog surface outside `tasks/`) passes; positive pin (`data-withdraw-armed` wired in `ParticipantVoteButtons.tsx`) passes.
- `tasks/40-participant-ui.tji` — `complete 100` added to `part_withdraw_dialog` block (lines 284-288).
- No tech-debt follow-up task registered — Decision §3 explicitly rejects a "revisit modal flavor" placeholder.
