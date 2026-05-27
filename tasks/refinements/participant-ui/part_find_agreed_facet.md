# Find a previously-agreed facet — superseded; do not implement

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_withdraw.part_find_agreed_facet`
**Effort estimate**: 1d (in the WBS; this refinement reduces it to 0 — closer marks `complete 100` with a "superseded" Status block).
**Inherited dependencies**:

- `!participant_ui.part_voting` (settled — the parent is the prior dependency in [`tasks/40-participant-ui.tji` line 278](../../40-participant-ui.tji#L278); every leaf under `part_voting.*` shipped via per-facet refactor including `part_proposal_notification` at commit `38bf660`).
- `!data_and_methodology.methodology_engine.withdrawal_logic` (settled at `2026-05-10` per [`tasks/refinements/data-and-methodology/withdrawal_logic.md` line 113](../data-and-methodology/withdrawal_logic.md#L113)). The write-side vote validator handles the legacy `vote.choice === 'withdraw'` arm; the post-ADR-0030 wire shape is the dedicated `withdraw-agreement` envelope. Either route accepts a withdraw against a committed proposal where the requester previously voted agree.
- Prose-only context (NOT a `.tji` edge): [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) (accepted 2026-05-23 — the per-facet vote keying + sequential-capture model that introduces a dedicated `withdraw-agreement` event kind and rewrites the participant detail panel into an always-on per-facet row block).
- Prose-only context (NOT a `.tji` edge): `!per_facet_refactor.participant_ui.pf_part_detail_panel_three_facet_rows` (settled — every facet of a tapped entity always renders a row, so any `agreed` / `committed` facet is visible without any additional "find" affordance).
- Prose-only context (NOT a `.tji` edge): `!per_facet_refactor.participant_ui.pf_part_withdraw_agreement_action` (settled 2026-05-24 per [`tasks/refinements/per-facet-refactor/pf_part_withdraw_agreement_action.md` line 54](../per-facet-refactor/pf_part_withdraw_agreement_action.md#L54)). Ships the wired withdraw button on `agreed` / `committed` facet rows + the two-stage confirmation gesture + the `useWithdrawAgreementAction` hook.
- Prose-only context (NOT a `.tji` edge): `!per_facet_refactor.participant_ui.pf_withdraw_agreement_event_kind` + `!per_facet_refactor.server.pf_withdraw_agreement_handler` (settled — the wire envelope + the server validator for the post-ADR-0030 withdraw flow).

## What this task is

**Originally:** add a find-affordance to the participant UI so a debater can locate a facet they previously agreed to (the precondition for withdrawing) — either via the graph view (tap an entity, find the facet on its detail panel) or via a "my agreements" history view. This was the first leaf of the three-step withdraw chain (find → confirm dialog → send), each owning one piece of the gesture.

**As of this refinement (2026-05-26):** **superseded; do not implement.** The per-facet refactor chain (driven by [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md), accepted 2026-05-23) replaced the three-step chain with an always-on per-facet row block on the entity detail panel that surfaces the wired withdraw button inline on every `agreed` / `committed` facet row. Tapping an entity on the graph IS the find affordance; the detail panel always renders the facet rows; the `agreed` / `committed` rows always render the withdraw button. No separate "find" surface is needed — the per-facet row block makes every withdrawable facet visible at zero extra interaction cost.

The closer should mark this task `complete 100` in the matching `.tji` block with a Status note pointing at this refinement (and at the per-facet-refactor citations below). No new component, no new test, no new i18n key, no new wire shape, no new event kind, no production code change. The deliberate documentation of the cancel-as-superseded is itself the artifact of this refinement round.

Concretely:

- **No** new file lands at `apps/participant/src/detail/FindAgreedFacet.tsx`, `apps/participant/src/proposals/MyAgreementsView.tsx`, or any equivalent path. The always-on per-facet row block at [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) IS the find affordance — every `agreed` / `committed` facet of a tapped entity is visible at frame one of the panel.
- **No** new test file lands. The existing per-facet refactor coverage (`ParticipantVoteButtons.test.tsx` per-status row renderings, `useWithdrawAgreementAction.test.tsx` 13-case hook contract, the `pf_e2e_methodology_full_flow_update` Playwright spec) already pins the find / confirm / send chain end-to-end. There is no separate "find" surface to pin.
- **No** new Playwright spec lands. The methodology-full-flow Playwright spec (per `pf_e2e_methodology_full_flow_update`) already drives a participant through tap-entity → see agreed-facet row → arm-withdraw → confirm-withdraw → assert facet flips to `withdrawn`. The graph-tap-to-detail-panel path is the e2e expression of this leaf's "find" intent.
- **No** new i18n key under `participant.findAgreedFacet.*` or similar. The existing `participant.detailPanel.*` + `participant.withdrawAgreementButton.*` catalog entries (added by `pf_part_withdraw_agreement_action` per its Status block) cover every label the panel surfaces. The find-affordance carries no chrome of its own.
- **No** new ADR. ADR 0030 already settled the architectural shift; Decision §1 below documents the supersession derivation; no new architectural seam, no new dependency, no new security trade-off, no new abstraction.
- **No** registration of a follow-up task today. The "my-agreements history view" alternative named in the original task title is a separate sibling leaf at [`tasks/40-participant-ui.tji` line 293](../../40-participant-ui.tji#L293) — `part_my_agreements_view "Optional: 'my agreements' history view"` (1d, explicitly marked Optional). Decision §3 explains why this refinement does NOT pre-decide that leaf's fate.

Out of scope (explicit non-actions this refinement DOES NOT take):

- **Not an ADR amendment.** ADR 0030 already enumerates the per-facet vote keying + sequential-capture model and its consequences for the participant detail panel; this refinement cites it rather than amending or splitting it. The ADR convention's "amend rather than re-decide" rule (per [`docs/adr/README.md`](../../../docs/adr/README.md)) doesn't apply because the original ADR's §3 ("withdrawal becomes a first-class `withdraw-agreement` event kind") + Consequences ("Participant detail panel renders all three facet rows per node") already encode why no separate find-affordance is needed.
- **Not a closure of the sibling `part_withdraw_dialog` or `part_withdraw_action` leaves.** Both are superseded by the same per-facet refactor work (the two-stage confirmation gesture replaces the dialog; the `useWithdrawAgreementAction` hook replaces the send action), but each gets its own refinement round when the orchestrator picks it up. This refinement scope is exactly one leaf.
- **Not a closure of the optional `part_my_agreements_view` leaf.** That leaf is independently scoped (history-view UX, not find-then-withdraw), is marked Optional, and may genuinely ship later as a separate read-only audit affordance. Decision §3 covers why it stays open.
- **Not a re-evaluation of `pf_part_detail_panel_three_facet_rows`'s testid contract.** The per-facet row carries its established `participant-detail-panel-facet-row` testid with `data-facet-name` + `data-facet-status` attrs. No new row-level "is-withdrawable" attr is added — the `data-facet-status="agreed"` / `data-facet-status="committed"` arms are already the withdrawal-eligibility signal a Playwright spec can filter on.
- **Not a new graph-canvas highlight for withdrawable facets.** The graph already paints per-facet status via `<FacetPill>` + the rollup-status border color (`part_per_facet_state_styling`); a debater scanning the graph already sees which entities have `agreed` / `committed` facets. Adding a withdraw-specific highlight overlay would duplicate that signal at the canvas layer.
- **Not a tab-bar badge counting withdrawable facets.** The pending-proposals tab badge counts open proposal facets needing a vote; adding a parallel "withdrawable facets" badge would compete for visual attention with the primary voting badge and isn't anywhere in the docs as a v1 requirement.

## Why it needs to be done

The task block is on the WBS; the orchestrator's pick-task pass selected it. The refinement round has to either ship a buildable refinement that says "implement this" or explain in writing why the task is now a no-op. The orchestrator does not read status-block prose retroactively; the only way to surface "this task is superseded" durably is to land a refinement that says so AND have the closer flip the `.tji` to `complete 100` with a Status block that points here. Both halves of the ritual ([`tasks/refinements/README.md` lines 32-42](../README.md#L32-L42)) apply even to a superseded task — otherwise the WBS keeps reading `0% complete` against a leaf nobody will ever implement and the milestone scheduler stays blocked on a phantom.

The downstream chain:

1. **`part_withdraw` parent rolls up.** With three sibling leaves under `part_withdraw` (this one + `part_withdraw_dialog` + `part_withdraw_action`) all superseded by the same per-facet refactor work, and the optional `part_my_agreements_view` independent of the parent's roll-up gate, closing this one as superseded is the first of three matching closures that unblock the parent's `complete 100`. Each of the three superseded leaves gets its own refinement (sequenced through subsequent orchestrator passes); this refinement is the first.
2. **`part_tests` depends on `!part_withdraw`.** The participant-tests roll-up at [`tasks/40-participant-ui.tji` line 367](../../40-participant-ui.tji#L367) carries `depends !part_voting, !part_withdraw, !part_axiom_mark_from_tablet`. Closing the withdraw chain unblocks part_tests' scheduling.
3. **Milestone propagation.** The P3 withdraw flow contributes to whichever milestone aggregates the participant UI work (per [`tasks/99-milestones.tji`](../../99-milestones.tji)). The supersession-via-`complete 100` posture lets the milestone gate clear without a phantom leaf.
4. **Audit trail.** The refinement document IS the artifact that proves the supersession was deliberate, citation-supported, and not an oversight — future readers walking the WBS see `complete 100` and read the refinement's Status block + Decision §1 to understand why no production code corresponds to this "completed" leaf.

Architecturally the supersession is **already established** in four settled sources:

- ADR 0030 §3 (`withdraw-agreement` becomes its own event kind, not a vote-arm of a generic `vote`).
- ADR 0030 Consequences ("Participant detail panel renders all three facet rows per node (two per edge)" + "A node's panel always shows wording, classification, and substance rows; an edge's panel always shows shape and substance").
- `pf_part_detail_panel_three_facet_rows` (refinement Status block records the rewrite of `ParticipantVoteButtons.tsx` to the always-on row block).
- `pf_part_withdraw_agreement_action` (refinement Status block records the wired withdraw button + two-stage confirmation gesture + the `useWithdrawAgreementAction` hook).

This refinement is the *fifth* recording of the same conclusion, scoped at the task-shape layer. No new evidence; no new analysis required.

## Inputs / context

### Design + ADRs (load-bearing for the supersession)

- [docs/participant-ui.md — P3. Withdraw agreement](../../../docs/participant-ui.md#L93-L101) — the canonical UX sketch: *"1. Find the facet — either via the graph view (tap the entity, find the facet) or via a 'my agreements' history view. The row's status is `agreed` or `committed`. 2. Tap the [Withdraw] button — a withdraw confirmation appears … 3. Confirm withdrawal — the tablet emits a `withdraw-agreement` event …"* The post-ADR-0030 detail panel implements step 1 (tap-entity → see agreed facet row) and step 2 (Withdraw button + confirmation) inline; step 3 is wired via `useWithdrawAgreementAction`. All three originally-distinct steps now sit on one always-rendered surface.
- [docs/participant-ui.md — Per-facet voting](../../../docs/participant-ui.md#L42-L45) — *"`agreed` — all participants are voting `agree`, awaiting moderator commit. The row shows the candidate value and a [Withdraw] button (emits `withdraw-agreement`, sending the facet back to `disputed`). `committed` — moderator has committed; the agreed value is the facet's value of record. The row shows the committed value and a [Withdraw] button (also emits `withdraw-agreement`)."* Per-status row rendering settles where the withdraw affordance lives — on the per-facet row, status-gated.
- [docs/participant-ui.md — Touch interactions](../../../docs/participant-ui.md#L143) — *"Withdrawal confirmation — two-tap (tap [Withdraw] on the agreed/committed facet row, confirm in the dialog). Deliberately one extra tap."* The two-tap shape is the confirmation gesture; the per-facet refactor's two-stage button variant honors the "deliberately one extra tap" contract.
- [docs/adr/0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the ADR that landed the per-facet vote keying + the dedicated `withdraw-agreement` event kind:
  - **§3 (Decision)**: "Withdrawal becomes a first-class `withdraw-agreement` event kind, separate from `vote`. The `vote.choice` enum shrinks to `'agree' | 'dispute'` only."
  - **§10 (Decision)**: "Participant detail panel renders all three facet rows per node (two per edge). A node's panel always shows wording, classification, and substance rows; an edge's panel always shows shape and substance."
  - **Consequences (a)**: "Find-then-withdraw collapses to one panel surface. The graph-tap → detail-panel path lands the debater on the per-facet row block; the row's status-gated button surface (withdraw on `agreed` / `committed`, agree-dispute on `proposed` / `disputed` / `withdrawn`) IS the gesture."
- [docs/methodology.md L25](../../../docs/methodology.md#L25) — *"A participant may withdraw agreement they previously gave. An `agreed` facet transitions back to `disputed`."* — the methodology rule that motivates the find-then-withdraw flow; the per-facet refactor preserves the rule, only relocating the find affordance.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — applies to the closer's Status block (no production code → no new verification; the existing per-facet refactor tests cover the find / confirm / send chain).

### Sibling refinements (in this `part_withdraw.*` chain — all superseded by the same per-facet refactor work)

- This leaf (`part_find_agreed_facet`, 1d) — superseded by `pf_part_detail_panel_three_facet_rows` (find affordance becomes the always-on per-facet row block).
- `part_withdraw_dialog` (0.5d) — superseded by `pf_part_withdraw_agreement_action`'s two-stage confirmation gesture (the inline two-tap button replaces the modal dialog while still satisfying the "deliberately one extra tap" contract from [`docs/participant-ui.md` L143](../../../docs/participant-ui.md#L143)). Awaits its own refinement-round closure.
- `part_withdraw_action` (0.5d) — superseded by `pf_part_withdraw_agreement_action`'s `useWithdrawAgreementAction` hook. Awaits its own refinement-round closure.
- `part_my_agreements_view` (1d, Optional) — independent of the supersession. The history-view UX is a distinct affordance (a chronologically-ordered list of "facets I agreed to, including those since committed") and may genuinely ship later. Decision §3 covers why this leaf stays open.

### Per-facet refactor refinements (the supersession source)

- [`tasks/refinements/per-facet-refactor/pf_part_detail_panel_three_facet_rows.md`](../per-facet-refactor/pf_part_detail_panel_three_facet_rows.md) — Done. Rewrote `apps/participant/src/detail/ParticipantVoteButtons.tsx` to render three rows for every node and two for every edge, regardless of which facets currently have a pending proposal. Each row's content reads the derived `FacetStatus` from the projection; the `agreed` / `committed` arms render the withdraw button (per ADR 0030 §10 + Consequences).
- [`tasks/refinements/per-facet-refactor/pf_part_withdraw_agreement_action.md`](../per-facet-refactor/pf_part_withdraw_agreement_action.md) — Done 2026-05-24. Landed the `useWithdrawAgreementAction` hook + the wired withdraw button on `agreed` / `committed` facet rows + the two-stage row-local confirmation gesture (arms on first tap, fires `withdraw-agreement` on second tap) + 13 Vitest cases for the hook + a 5-case "wired withdraw button" describe block in `ParticipantVoteButtons.test.tsx`.
- [`tasks/refinements/per-facet-refactor/pf_withdraw_agreement_event_kind.md`](../per-facet-refactor/pf_withdraw_agreement_event_kind.md) — Done. The `withdraw-agreement` event kind + its zod schema in `packages/shared-types/`.
- [`tasks/refinements/per-facet-refactor/pf_withdraw_agreement_handler.md`](../per-facet-refactor/pf_withdraw_agreement_handler.md) — Done. The server-side WS handler that validates + appends the `withdraw-agreement` event.
- [`tasks/refinements/per-facet-refactor/pf_e2e_methodology_full_flow_update.md`](../per-facet-refactor/pf_e2e_methodology_full_flow_update.md) — the Playwright spec that exercises the find → confirm → send chain end-to-end through the detail panel surface.

### Prior `part_withdraw` precedent refinement

- [`tasks/refinements/data-and-methodology/withdrawal_logic.md`](../data-and-methodology/withdrawal_logic.md) — Done 2026-05-10. The write-side validator for the legacy `vote.choice === 'withdraw'` arm. The post-ADR-0030 wire shape replaces that arm with a dedicated `withdraw-agreement` envelope, but the methodology rule (withdraw requires a prior `agree` on a committed proposal) carries over verbatim into the new handler at `apps/server/src/ws/handlers/withdraw-agreement.ts`.

### Live code surface (no change)

- [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) — the always-on per-facet row block. The `agreed` / `committed` branches at lines 1124–1226 render the wired withdraw button with two-stage confirmation; the `withdraw:` slot key keeps per-row in-flight bookkeeping disjoint from the vote slot. Byte-stable.
- [`apps/participant/src/detail/useWithdrawAgreementAction.ts`](../../../apps/participant/src/detail/useWithdrawAgreementAction.ts) — the wired hook. `withdraw()` / `inFlight` / `lastError` slots keyed by `(entity_kind, entity_id, facet)`; Zustand-backed per-slot store. Byte-stable.
- [`apps/participant/src/detail/EntityDetailPanel.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.tsx) — the panel that mounts on graph-tap-to-selection. Its `<ParticipantVoteButtons>` mount at line 413 surfaces the per-facet rows for the selected entity, including the `agreed` / `committed` rows that carry the withdraw button. Byte-stable.
- [`apps/participant/src/stores/selectionStore.ts`](../../../apps/participant/src/stores/selectionStore.ts) — the selection store fed by graph taps (per `part_pan_zoom_tap`). The find-affordance starts here: tap an entity, the selection store updates, the detail panel re-renders. Byte-stable.
- [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) — `computeFacetStatuses(events)` derives every facet's `'agreed'` / `'committed'` / etc. status; the detail panel reads from this projection. Byte-stable.
- [`apps/server/src/ws/handlers/withdraw-agreement.ts`](../../../apps/server/src/ws/handlers/withdraw-agreement.ts) — server-side validator that enforces the prior-agree + committed-proposal precondition. Byte-stable.
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — `wsWithdrawAgreementPayloadSchema` + the `'withdraw-agreement'` envelope arm. Byte-stable.

### Files this refinement writes

- [`tasks/refinements/participant-ui/part_find_agreed_facet.md`](.) — this document.

### Files this refinement does NOT touch

- No app source — `apps/participant/`, `apps/moderator/`, `apps/server/`, `apps/audience/` all byte-stable.
- No shared package — `packages/shared-types/`, `packages/shell/`, `packages/i18n-catalogs/` all byte-stable.
- No test file — `apps/participant/src/**/*.test.tsx`, `tests/e2e/**/*.spec.ts`, `tests/behavior/**/*.feature` all byte-stable.
- No SQL migration — `apps/server/migrations/` byte-stable.
- No `.tji` file — the `complete 100` marker on `tasks/40-participant-ui.tji` lines 279-282 lands at task-completion-ritual time per [`tasks/refinements/README.md` lines 32-42](../README.md#L32-L42), driven by the closer (NOT this refinement-writer sub-agent).
- No new ADR — Decision §1 below documents why the supersession derivation doesn't warrant one.
- No `docs/adr/`, no `DESIGN.md`, no `docs/participant-ui.md`, no `docs/methodology.md` edit — they already say what this refinement reads off.

## Constraints / requirements

### Files this task touches (explicit allowlist — REFINEMENT-WRITER PASS)

- `tasks/refinements/participant-ui/part_find_agreed_facet.md` (this file).

### Files the CLOSER's pass touches (the `complete 100` ritual — NOT this refinement-writer's pass)

- `tasks/40-participant-ui.tji` — add `complete 100` immediately after `allocate team` inside the `part_find_agreed_facet` block (lines 279-282). Run `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` and confirm silent per [`tasks/refinements/README.md` line 38](../README.md#L38).
- This refinement file — append a `## Status` block at the bottom recording **Closed without implementation — superseded by ADR 0030 + per-facet refactor chain** with the closer's date.

### Constraints the refinement-writer pass MUST satisfy

- **No production code change.** Implicit by the "Files this task touches" allowlist.
- **No test change.** Implicit by the same allowlist.
- **No invented citations.** Every cross-reference above (ADR 0030, `docs/participant-ui.md` line ranges, the four per-facet-refactor refinements, the live code surface files) was read by the refinement-writer sub-agent and is real.
- **The refinement document IS the artifact.** Per ADR 0022's "every check is committed," the citation-supported supersession argument is itself the verification — there is no codepath to test because there is no codepath to add.

### What the closer's pass MUST NOT do

- **Do NOT register a placeholder follow-up task** for any not-yet-scoped find-affordance flavor in `tasks/40-participant-ui.tji`. Decision §3 below explains why a placeholder is wrong. The closer registers a follow-up ONLY if the user separately decides one is in scope.
- **Do NOT close the sibling `part_withdraw_dialog` or `part_withdraw_action` leaves in the same pass.** Each of those leaves needs its own refinement document recording its own supersession argument (citation set + alternatives surveyed); pre-emptively closing them here would skip the audit trail the refinement system relies on. The closer's mechanical step here is the one leaf this refinement names.
- **Do NOT close `part_my_agreements_view`.** That leaf is Optional and independently scoped (a history-view UX, not a find-affordance); the per-facet refactor does not supersede it. Decision §3 covers the reasoning.
- **Do NOT amend ADR 0030.** It already settles the supersession. Adding a "find-affordance is the always-on row block" sentence to the ADR retroactively would conflate the architectural decision (per-facet vote keying + always-on row block) with the WBS bookkeeping (this leaf is now a no-op).
- **Do NOT edit `docs/participant-ui.md`.** The L93-L101 P3 sketch + the L42-L45 per-status row description + the L143 two-tap touch interaction collectively define the post-ADR-0030 find-then-withdraw UX. Repeating any of them elsewhere creates drift.
- **Do NOT delete or rename the task block** in `tasks/40-participant-ui.tji` lines 279-282. Closing as `complete 100` with a Status pointer is the recorded outcome; deleting the block would erase the audit trail.

### Test layers per ADR 0022

Zero new tests. The supersession argument is structural — there is no codepath to add or remove, so no test pins one. The existing per-facet refactor coverage is what guarantees v1's find-then-withdraw flow continues to work:

- `apps/participant/src/detail/ParticipantVoteButtons.test.tsx` — per-status row renderings including the `agreed` / `committed` arms that render the withdraw button (the find-affordance surface).
- `apps/participant/src/detail/useWithdrawAgreementAction.test.tsx` — 13 Vitest cases pinning the hook contract.
- `apps/participant/src/detail/EntityDetailPanel.test.tsx` — pins the graph-tap-to-panel-render flow (panel mounts when selection is non-null; per-facet row block surfaces the correct facets per entity kind).
- `tests/e2e/methodology-full-flow.spec.ts` (per `pf_e2e_methodology_full_flow_update`) — exercises the find → arm-withdraw → confirm-withdraw → assert-`withdrawn` chain end-to-end.

A grep for `findAgreedFacet|find.agreed.facet|MyAgreementsView|my.agreements.view` across the test tree returns zero matches today and continues to return zero matches after the closer's pass — that is the regression-pin shape for "no separate find-affordance surface exists."

### UI-stream e2e policy (does not apply)

The policy ([`tasks/refinements/README.md` UI-stream e2e section](../README.md)) requires a Playwright spec OR a deferred-e2e justification with a future wiring task. **Deferred-e2e does not apply here either.** The deferral path covers tasks that *create a component or capability that no user flow currently reaches*; this task creates no component at all. The closer's Status block records the supersession; no future task inherits e2e debt against this one (because no future task implements it). The post-ADR-0030 find-affordance IS covered end-to-end by the methodology-full-flow Playwright spec via the always-on per-facet row block — that spec belongs to `pf_e2e_methodology_full_flow_update`, not this leaf.

### Backend / WS / projector / methodology-engine policy (does not apply)

No wire change. No broadcast envelope shape change. No projector output change. No new Cucumber scenario. The `withdraw-agreement` wire envelope + the server validator + the read-side facet status walk are all already shipped + tested via the per-facet refactor chain.

### Budget honesty (refinement-writer pass — under 0.5d)

- ~30 min: read the four per-facet-refactor refinements that ship the supersession source (`pf_part_detail_panel_three_facet_rows`, `pf_part_withdraw_agreement_action`, `pf_withdraw_agreement_event_kind`, `pf_withdraw_agreement_handler`).
- ~20 min: read ADR 0030 + `docs/participant-ui.md` P3 + per-status rows + touch interactions sections to confirm the find-then-withdraw collapse to one panel surface.
- ~15 min: read the live code surface (`ParticipantVoteButtons.tsx` per-facet row block, `useWithdrawAgreementAction.ts` hook, `EntityDetailPanel.tsx` panel mount) to confirm the always-on row block IS the find affordance.
- ~10 min: confirm the WBS shape (`tasks/40-participant-ui.tji` lines 279-282) and the parent's downstream edges (`part_tests` at L367; the optional `part_my_agreements_view` sibling at L293).
- ~10 min: read the precedent supersession refinement (`part_agree_all_gesture.md`) for structural template.
- ~45 min: write this refinement document.
- ~10 min: final read-through to ensure the citations are accurate.

The closer's pass costs an additional ~15 min — `complete 100` + `tj3 project.tjp` validate + Status-block append.

Risk surface is minimal. The main hazard is that a future reader interprets `complete 100` against this leaf as "implementation shipped" — Decision §2 below mandates the Status block prose to head off that misreading. A secondary hazard is that a future reader sees three sibling `part_withdraw.*` leaves all closed-as-superseded and concludes the withdraw feature was dropped entirely — Decision §1's "the gesture absolutely exists, it just lives in the per-facet refactor chain now" language is the safety net.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is either an existing committed test, a citation-supported documentation read, or a structural property of the codebase that a grep can verify.

1. **The refinement document exists** at `tasks/refinements/participant-ui/part_find_agreed_facet.md` and cites ADR 0030, `docs/participant-ui.md` lines L42-L45 + L93-L101 + L143, the four per-facet-refactor refinements (`pf_part_detail_panel_three_facet_rows`, `pf_part_withdraw_agreement_action`, `pf_withdraw_agreement_event_kind`, `pf_withdraw_agreement_handler`), and the precedent supersession refinement (`part_agree_all_gesture`). This document IS the verification.
2. **`pnpm install` clean** — no dep changes.
3. **`pnpm run check` stays green** (lint + format + typecheck + typecheck-tools + typecheck-tests). The closer's pass touches no TypeScript file, so this is implicit.
4. **`pnpm run test:smoke` stays green** with the existing smoke count unchanged. No new test landed.
5. **`pnpm --filter @a-conversa/i18n-catalogs run check`** stays green — no new i18n keys.
6. **`pnpm run test:e2e --project=chromium-participant-skeleton`** stays green — the existing methodology-full-flow Playwright spec (per `pf_e2e_methodology_full_flow_update`) covers the post-ADR-0030 find → arm → confirm → send chain unchanged.
7. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches (REFINEMENT-WRITER PASS)" for this refinement-writer pass; and outside the allowlist in "Files the CLOSER's pass touches" for the closer's follow-up.
8. **Grep regression-pin: `rg "findAgreedFacet|find.agreed.facet|MyAgreementsView|my.agreements.view" apps/ packages/ tests/` returns zero matches** (the absence is the structural property that pins "no v1 find-affordance or my-agreements surface exists"). The only matches across the repo are inside `tasks/` (refinement-document prose + the `.tji` block itself) and this file.
9. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after the closer's pass lands `complete 100` on `part_find_agreed_facet` in `tasks/40-participant-ui.tji`.
10. **The closer's Status block** records "**Closed without implementation — superseded by ADR 0030 + per-facet refactor chain**" with the closer's date and a one-line pointer to this refinement's Decision §1.
11. **No follow-up task registered today.** Decision §3 — the optional `part_my_agreements_view` sibling already exists at [`tasks/40-participant-ui.tji` line 293](../../40-participant-ui.tji#L293) and is independent of this leaf's supersession; no new task is registered. A grep for any new `find_agreed_facet_*` or `my_agreements_view_*` leaf in `tasks/` returns zero matches before and after the closer's pass.
12. **`part_withdraw` parent rollup partially unblocked.** With this leaf closed, the parent's pending-completion gate depends on the remaining open leaves under `part_withdraw` (the supersession-pending siblings `part_withdraw_dialog` + `part_withdraw_action` plus the Optional `part_my_agreements_view`). The parent's own `complete 100` lands when its required leaves all close per the task-completion ritual; this leaf's closure is one of three required-leaf supersessions.

## Decisions

### 1. Close as superseded by ADR 0030 + the per-facet refactor chain; do not implement

The four-pin argument that settles this:

- **Pin A (ADR 0030 §3 + §10 + Consequences)** — Withdrawal becomes a first-class `withdraw-agreement` event kind; the participant detail panel renders all three facet rows per node (two per edge); the find-then-withdraw flow collapses onto one panel surface. Find-affordance becomes a structural property of the always-on row block — every withdrawable facet is visible at frame one of the panel.
- **Pin B (`docs/participant-ui.md:42-45 + :93-101 + :143`)** — Per-status row rendering settles where the withdraw affordance lives (on the `agreed` / `committed` row, status-gated); the P3 sketch's step 1 ("find the facet") is realized by the graph-tap → detail-panel path; step 2 ("withdraw confirmation appears") is realized by the two-stage confirmation gesture; step 3 ("emit withdraw-agreement event") is realized by `useWithdrawAgreementAction`. All three steps collapse onto the per-facet row.
- **Pin C (live code surface — `apps/participant/src/detail/ParticipantVoteButtons.tsx` agreed/committed branches at L1124-1226)** — Structural invariant. Tapping any entity on the graph renders the detail panel; the detail panel renders three rows for nodes, two for edges; the `agreed` / `committed` row arms render the withdraw button with two-stage confirmation. No additional find-affordance is needed — the affordance is the always-on row block.
- **Pin D (downstream-consumer evidence — `pf_part_withdraw_agreement_action.md` Status block at L52-L60)** — The wired withdraw button + hook + two-stage confirmation + 13-case Vitest coverage + 5-case wired-withdraw-button describe block + i18n catalog entries all shipped 2026-05-24. The per-facet refactor chain shipped the entirety of what this leaf was scoped to enable.

Three alternatives surveyed:

- **(A) Close as superseded by ADR 0030 + the per-facet refactor chain** (chosen). Cite ADR 0030 + `docs/participant-ui.md` per-status rows + the four settled per-facet-refactor refinements. No production code change. The closer marks `complete 100` with a "superseded" Status block.
- **(B) Implement a separate "my agreements" overlay or sidebar that lists all (entity, facet) pairs the current participant has voted agree on, navigable** (rejected). The optional sibling `part_my_agreements_view` at [`tasks/40-participant-ui.tji` line 293](../../40-participant-ui.tji#L293) already covers this — it is a *distinct* UX (a chronologically-ordered list view, useful for retrospective audit) and is *independently scoped*. Pulling it into this leaf would conflate two different affordances (find-for-withdraw vs. history-of-my-agreements). Decision §3 documents why `part_my_agreements_view` stays separately scoped.
- **(C) Add a withdraw-eligibility highlight to the canvas (e.g., a pulsing border on entities with `agreed` / `committed` facets the current participant voted agree on)** (rejected). The graph already paints per-facet status via `<FacetPill>` + the rollup-status border color (per `part_per_facet_state_styling`); a debater scanning the graph already sees which entities have `agreed` / `committed` facets, and the detail panel makes the per-participant withdraw affordance visible at one tap of distance. Adding a withdraw-specific canvas overlay would duplicate the existing per-facet status signal at the canvas layer + introduce a second visual treatment competing with the per-facet status colors. The visual-vocabulary cost outweighs the one-tap-of-distance reduction (and the panel's own affordance suffices for the methodology rule).

The supersession is documented citation-by-citation rather than re-derived; this refinement is a "read off the settled sources and record the answer" pass, not a "decide from first principles" pass. Compare to the precedent refinement `part_agree_all_gesture.md` Decision §1 which uses the same four-pin pattern against ADR 0030's sequential-capture model.

### 2. Close ritual: `complete 100` with a "superseded" Status block (NOT a WBS deletion)

Three alternatives surveyed:

- **(A) `complete 100` + Status block citing this refinement** (chosen). The marker tells `tj3`'s scheduler the leaf is finalized — the parent's rollup can proceed (subject to its other open leaves closing). The Status block tells human readers WHY the marker is `complete 100` despite no commit-record of implementation. Future readers walking the WBS see the marker and read the refinement to learn the supersession. The closer's pass is mechanical: append `complete 100` to lines 279-282 of [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji#L279-L282) and append the Status block at the bottom of this refinement.
- **(B) Delete the task block from the `.tji`** (rejected). Erases the audit trail of "this was once on the WBS and was deliberately cancelled in favor of a per-facet refactor approach." A future reader would have no way to know the original three-step find / dialog / send chain was once the planned shape; if a user later asks "didn't we plan a separate find affordance?" the answer "no, never" would be wrong. The `complete 100` + Status posture preserves the historical record.
- **(C) Add a new TaskJuggler attribute** (e.g., `superseded "yes"`) **instead of `complete 100`** (rejected for the same reasons as `part_agree_all_gesture.md` Decision §2 alternative C — the TaskJuggler grammar has no superseded-task primitive; `complete 100` + Status block prose is the established convention).

The Status block prose the closer writes MUST head off the "completed = implemented" misreading. A suggested template (the closer adapts the date):

> ## Status
>
> **Closed without implementation — superseded by [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) + the per-facet refactor chain** — 2026-MM-DD.
>
> The per-facet refactor chain shipped the entire find → confirm → send flow on a single always-on detail-panel surface: `pf_part_detail_panel_three_facet_rows` (always-render every facet row) IS the find affordance; `pf_part_withdraw_agreement_action` (wired withdraw button + two-stage row-local confirmation gesture) IS the dialog + send steps. Per [`docs/participant-ui.md:42-45 + :93-101 + :143`](../../../docs/participant-ui.md#L42-L45) the per-status row renders the [Withdraw] button on `agreed` / `committed` rows with the deliberate one-extra-tap confirmation. No production code corresponds to this leaf's closure.
>
> No source file, no test file, no i18n key, no ADR landed for this task. The refinement document (Decision §1) is the audit trail.

### 3. Do NOT close `part_my_agreements_view` in the same refinement; leave it open as Optional

[`tasks/40-participant-ui.tji` line 293-296](../../40-participant-ui.tji#L293-L296) declares `part_my_agreements_view "Optional: 'my agreements' history view"` at 1d effort. Three alternatives surveyed:

- **(A) Leave `part_my_agreements_view` open and Optional; do not pre-decide its fate here** (chosen). The history-view UX is a *distinct affordance* from the find-for-withdraw flow:
  - The find affordance (this leaf) needs to surface a *single eligible facet at a time* in the context of the entity the debater is inspecting — solved by the always-on detail panel.
  - The history view (the sibling) is a *retrospective audit* surface — a chronologically-ordered list of "all facets I've agreed to and their current status, including those since committed or since withdrawn." Useful for end-of-session review, not for the in-flow find-then-withdraw gesture.
  
  The two solve different problems. The per-facet refactor supersedes only the first. The second remains genuinely Optional — it may be scoped later as a read-only retrospective surface, or it may stay deferred indefinitely. Either way, this refinement (which is about the find-then-withdraw chain's first leaf) is not the right place to make that call.
- **(B) Close `part_my_agreements_view` as superseded in the same Status block** (rejected). The history-view UX is not solved by the per-facet refactor — the detail panel surfaces facets *one entity at a time*, requiring a tap per entity, which is exactly the scaling problem a list view solves for retrospective audit. A debater wanting to review every facet they've agreed to across the session would need to tap N entities and read N panels under the detail-panel-only approach; a list view replaces N taps with one scroll. The two affordances are not interchangeable; rolling them into one supersession would erase a real difference.
- **(C) Re-mark `part_my_agreements_view` as non-Optional in `tasks/40-participant-ui.tji`** (rejected). Out of this leaf's scope — and would conflict with the WBS author's declared Optional posture. A user-scoped decision, not a refinement-writer decision.

The pointer to `part_my_agreements_view` is preserved verbatim in the WBS for any future scoping pass; no edits to that leaf today.

### 4. Do NOT pre-reserve a row-level testid or attr for a hypothetical future find-affordance surface

Three alternatives surveyed:

- **(A) Do not reserve `participant-detail-panel-withdrawable-facets`, `data-is-withdrawable`, or any find-specific testid / attr** (chosen). The existing `data-facet-status="agreed"` / `data-facet-status="committed"` attrs on the per-facet row already enable a Playwright filter for "withdrawable facets" (`[data-testid='participant-detail-panel-facet-row'][data-facet-status='agreed'],[data-testid='participant-detail-panel-facet-row'][data-facet-status='committed']`). No additional attr is needed; introducing one would denormalize the signal (status-vs.-withdrawability would have to stay in sync).
- **(B) Add a `// TODO: reserve participant-detail-panel-withdrawable-facets` comment** in [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) (rejected). The CLAUDE.md instruction "Default to writing no comments" applies; the rejected alternative in `part_agree_all_gesture.md` Decision §4 (B) makes the same case.
- **(C) Pre-register a `tests/e2e/_testids.ts`-style central registry entry for the synthesized "withdrawable facet" selector** (rejected for the same reasons as `part_agree_all_gesture.md` Decision §4 (C) — no such registry exists; introducing one for a hypothetical future selector would be a disproportionate abstraction).

The decision is documented here so a future "find-by-list" view (if scoped via `part_my_agreements_view` or otherwise) names its testids afresh against the surfaces it adds.

### 5. No new ADR

Every architectural question this refinement could have raised is already settled by an existing ADR:

- The dedicated `withdraw-agreement` event kind (replacing the `vote.choice === 'withdraw'` arm) — ADR 0030 §3.
- The always-on per-facet row block on the participant detail panel — ADR 0030 §10 + Consequences.
- The per-facet vote keying that makes the wire `(entity, facet)`-discriminated (which therefore enables the per-row in-flight bookkeeping the hook uses) — ADR 0030 §2.
- The two-tap "deliberate extra tap" confirmation policy — refinement-level decision in [`tasks/refinements/per-facet-refactor/pf_part_withdraw_agreement_action.md`](../per-facet-refactor/pf_part_withdraw_agreement_action.md) (and correctly so, because the two-tap shape is a UX policy not an architectural seam).
- The entity / facet layer split that scopes where the withdraw row lives — ADR 0027.
- The proposal-keyed structural-arm exception (structural sub-kinds keep their proposal-keyed lifecycle; the per-facet refactor doesn't touch them) — ADR 0030 §9.

This refinement introduces no new architectural seam, no new dependency, no new security trade-off, no new abstraction. The ADR convention's "amendment-pass rule" ([`docs/adr/README.md`](../../../docs/adr/README.md)) does not fire because there is no architectural decision being made — only a WBS bookkeeping decision (close as superseded) plus three implementation-shaping decisions (no follow-up registration today, no testid reservation today, leave `part_my_agreements_view` independently scoped).

## Open questions

(none — all decided)

## Status

**Closed without implementation — superseded by [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) + the per-facet refactor chain** — 2026-05-26.

The per-facet refactor chain shipped the entire find → confirm → send flow on a single always-on detail-panel surface: [`pf_part_detail_panel_three_facet_rows`](../per-facet-refactor/pf_part_detail_panel_three_facet_rows.md) (always-render every facet row) IS the find affordance; [`pf_part_withdraw_agreement_action`](../per-facet-refactor/pf_part_withdraw_agreement_action.md) (wired withdraw button + two-stage row-local confirmation gesture + `useWithdrawAgreementAction` hook) IS the dialog + send steps. Per [`docs/participant-ui.md:42-45 + :93-101 + :143`](../../../docs/participant-ui.md#L42-L45) the per-status row renders the [Withdraw] button on `agreed` / `committed` rows with the deliberate one-extra-tap confirmation. No production code corresponds to this leaf's closure.

- Refinement document written: `tasks/refinements/participant-ui/part_find_agreed_facet.md` — the audit trail for the supersession decision.
- WBS closure: `complete 100` added to `tasks/40-participant-ui.tji` at `part_find_agreed_facet` block (lines 279-283).
- No source file, no test file, no i18n key, no ADR landed for this task.
- No follow-up task registered today — the Optional sibling [`part_my_agreements_view`](../../40-participant-ui.tji#L293) already covers the distinct history-view UX per Decision §3 and stays independently scoped.
- Acceptance criterion §8 regression-pin holds: `rg "findAgreedFacet|find.agreed.facet|MyAgreementsView|my.agreements.view" apps/ packages/ tests/` returns zero matches.
- Decision §1 (close as superseded by ADR 0030 + per-facet refactor chain) is the authoritative rationale; Decision §3 (do not close `part_my_agreements_view`) is the closer's constraint.
