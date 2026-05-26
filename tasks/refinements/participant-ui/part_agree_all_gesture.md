# Agree-all gesture per proposal bundle — superseded; do not implement

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_voting.part_agree_all_gesture`
**Effort estimate**: 0.5d (in the WBS; this refinement reduces it to 0 — closer marks `complete 100` with a "superseded" Status block).
**Inherited dependencies**:

- `!participant_ui.part_voting.part_vote_button_per_facet` (settled at commit `5088234` — per-facet Agree/Dispute buttons render inside each pane chip via [`apps/participant/src/proposals/ProposalFacetVoteButtons.tsx`](../../../apps/participant/src/proposals/ProposalFacetVoteButtons.tsx)).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_voting.part_vote_single_tap` (settled at commit `1813e8e` — the single-tap-no-confirmation posture this gesture would have inherited).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_voting.part_change_vote_pre_commit` (settled at commit `a2d43a4` — the change-vote-during-pre-commit-window semantics this gesture would have interacted with).
- Prose-only context (NOT a `.tji` edge): [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) (accepted 2026-05-23 — the sequential-capture model that removes the bundle this gesture targeted).

## What this task is

**Originally:** mount a single row-level "Agree all" button inside an expanded pending-proposal row that, in one tap, dispatches Agree votes against every pending facet of that proposal bundle — the accelerator the early sketch carried so a debater who fully concurred with a multi-facet proposal could land their vote in one gesture instead of N (one per chip).

**As of this refinement (2026-05-26):** **superseded; do not implement.** ADR 0030 (sequential capture) — accepted 2026-05-23, three days after this task was placed on the WBS — removed the bundle this gesture would have aggregated over. Every facet-valued proposal now targets exactly one facet, and the methodology routes the facets one at a time through the moderator's sequence-enforced propose handler. "Every facet of this proposal" is structurally a singleton; the per-chip Agree button the predecessor leaf landed already IS the agree-all gesture in v1.

The closer should mark this task `complete 100` in the matching `.tji` block with a Status note pointing at this refinement (and at the docs+ADR citations below). No new component, no new test, no new i18n key, no new wire shape, no new event kind, no production code change. The deliberate documentation of the cancel-as-superseded is itself the artifact of this refinement round.

Concretely:

- **No** new file lands at `apps/participant/src/proposals/ProposalAgreeAllButton.tsx` or any equivalent path. The pane chip's per-facet Agree button (predecessor `part_vote_button_per_facet`) is the v1 agree gesture.
- **No** new test file lands. The single-tap policy regression-pins from `part_vote_single_tap` already cover the per-chip Agree's one-envelope-per-click behavior. There is no aggregate "agree-all" envelope shape to pin.
- **No** new Playwright step appended to [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts). The existing step 9 + step 10 (commits `1813e8e` + `a2d43a4`) exhaustively cover the single-tap and pre-commit-change-vote postures on the per-chip Agree affordance.
- **No** new i18n key under `participant.voteButton.*`. The chip's existing `agreeLabel` / `disputeLabel` / `changeAriaLabel` / `wireError` / etc. (lines 683-694 of [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json)) suffice for the per-chip agree gesture, which IS the only agree gesture v1 ships.
- **No** new ADR. ADR 0030 already settled this — Decision §1 below documents the supersession derivation; no new architectural seam, no new dependency, no new security trade-off, no new abstraction.
- **No** registration of a follow-up task today. The "across-entities bulk agree" flavor named in [`docs/participant-ui.md` line 68](../../../docs/participant-ui.md#L68) is *explicitly deferred-decision*; it does NOT get a placeholder WBS leaf in this refinement. The closer registers it only IF the closer (or the user) decides separately that the across-entities flavor is in scope for v1 — which is not this leaf's call.

Out of scope (explicit non-actions this refinement DOES NOT take):

- **Not an ADR amendment.** ADR 0030 already enumerates the alternatives and explains why the bundle is removed; this refinement cites it rather than amending or splitting it. The ADR convention's "amend rather than re-decide" rule (per [`docs/adr/README.md`](../../../docs/adr/README.md)) doesn't apply because the original ADR was never amended to *add* an agree-all rationale — it removed bundling at the data-model layer, which the doc paragraph at `docs/participant-ui.md:68` then read off.
- **Not a new "agree across multiple selected entities" task registration.** Decision §3 below explains why this leaf does NOT register that follow-up.
- **Not a wire-level "batch vote" envelope.** No `vote-batch` / `vote-many` / `agree-all` envelope is introduced. The wire stays exactly as ADR 0030 §2 + §9 left it: per-`(entity, facet)`-keyed for facet-valued proposals, per-`proposalId`-keyed for structural proposals, one envelope per gesture.
- **Not an undo/coalesced-vote affordance** to make a hypothetical agree-all rollback. Without an agree-all gesture, the inverse problem doesn't exist.
- **Not a re-evaluation of `part_vote_button_per_facet`'s testid contract.** The per-chip Agree button keeps its testid `participant-pending-proposal-row-facet-vote-button-agree`. No row-level testid (`participant-pending-proposal-row-agree-all`) is reserved — Decision §4 below addresses why pre-reserving the testid would be tech debt.
- **Not a redefinition of `ProposalFacetEntry`.** The existing `VoteTarget` discriminated-union (facet arm + proposal arm — see [`apps/participant/src/proposals/perProposalFacets.ts` lines 196-220](../../../apps/participant/src/proposals/perProposalFacets.ts#L196-L220)) stays byte-stable. No `voteTargets` (plural) shape is introduced.

## Why it needs to be done

The task block is on the WBS; the orchestrator's pick-task pass selected it. The refinement round has to either ship a buildable refinement that says "implement this" or explain in writing why the task is now a no-op. The orchestrator does not read status-block prose retroactively; the only way to surface "this task is superseded" durably is to land a refinement that says so AND have the closer flip the `.tji` to `complete 100` with a Status block that points here. Both halves of the ritual ([`tasks/refinements/README.md` lines 32-42](../README.md#L32-L42)) apply even to a superseded task — otherwise the WBS keeps reading `0% complete` against a leaf nobody will ever implement and the milestone scheduler stays blocked on a phantom.

The downstream chain:

1. **`part_voting` parent rolls up.** With this leaf's siblings (`part_vote_button_per_facet` ✓, `part_vote_single_tap` ✓, `part_change_vote_pre_commit` ✓) all done and `part_proposal_notification` still pending, the parent's roll-up to `complete 100` is held back by two unfinished leaves — this one plus the notification leaf. Closing this one as superseded unblocks half the gating.
2. **`part_withdraw.*` chain depends on the parent.** The withdraw chain ([`tasks/40-participant-ui.tji` line 275](../../40-participant-ui.tji#L275)) carries `depends !part_voting`; the parent must finalize before the chain can start. Superseded-closure is the same kind of finalization `complete 100` represents.
3. **Replay-test parity tasks** under `replay_test.*` walk the same `!part_voting` edge ([`tasks/40-participant-ui.tji` line 364](../../40-participant-ui.tji#L364) — `part_proposal_notification` carries the same edge; `replay_test.*` carries it elsewhere).
4. **Audit trail.** The refinement document IS the artifact that proves the supersession was deliberate, citation-supported, and not an oversight — future readers walking the WBS see `complete 100` and read the refinement's Status block + Decision §1 to understand why no production code corresponds to this "completed" leaf.

Architecturally the supersession is **already established** in three settled sources (ADR 0030, `docs/participant-ui.md:68`, and the predecessor refinement `part_vote_button_per_facet` Decision §2 + Out-of-scope §8 which already routes the withdraw flow to the per-chip surface only). This refinement is the *fourth* recording of the same conclusion, scoped at the task-shape layer. No new evidence; no new analysis required.

## Inputs / context

### Design + ADRs (load-bearing for the supersession)

- [docs/participant-ui.md — On bulk voting](../../../docs/participant-ui.md#L68) — the canonical statement: **"No 'Agree all' affordance in v1."** Cites the sequential model removing the bundle; explicitly flags an across-entities bulk gesture as a separately-deferred decision (not this leaf's scope).
- [docs/adr/0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the ADR that landed the sequential-capture model. Specifically:
  - **§1 (Decision)**: "The bundled 'capture + classify' gesture is removed."
  - **§2 (Decision)**: vote/commit/meta-disagreement envelopes become `(entity, facet)`-keyed; no batch shape introduced.
  - **§6 (Decision)**: "Per-facet proposal kinds set candidate values; they don't own votes." Each facet-valued proposal targets ONE facet — so "every facet of this proposal" is a singleton.
  - **§8 (Decision)**: "The server enforces the sequence at the wire." Facets get a candidate value one at a time, in methodology order; the moderator's sequence enforcement means a "bundle" of multiple simultaneously-pending facets per entity does not exist in v1.
  - **Alternatives §1 ("Bundle all three facets at capture") — Rejected.** Bundling is the bug the ADR fixes.
- [docs/methodology.md L88](../../../docs/methodology.md#L88) — the worked example that motivates ADR 0030: "Three facets, three independently captured sequential proposals." The methodology itself is incompatible with a single-tap "agree to three sequentially-captured proposals" gesture; the gestures happen at three different moments in deliberation time.
- [ADR 0027 — Entity and facet layers strict separation](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the predecessor ADR that drew the entity / facet line. ADR 0030 finished the work on the facet-layer side.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — applies to the closer's Status block (no production code → no new verification; the existing per-chip Agree tests cover the agree gesture).

### Sibling refinements

- [`tasks/refinements/participant-ui/part_vote_button_per_facet.md`](part_vote_button_per_facet.md) — predecessor, Done at commit `5088234`. Its Out-of-scope §3 ("Not the agree-all gesture") flags the existence of this leaf as a *would-have* sibling at the time it shipped; that "would-have" is now "would-not." The per-chip Agree button at [`apps/participant/src/proposals/ProposalFacetVoteButtons.tsx`](../../../apps/participant/src/proposals/ProposalFacetVoteButtons.tsx) IS the v1 agree gesture.
- [`tasks/refinements/participant-ui/part_vote_single_tap.md`](part_vote_single_tap.md) — Done at commit `1813e8e`. Lines 27 + 50 of that refinement note that the single-tap policy would have applied to the agree-all gesture if it had been built. The policy still applies — to the per-chip Agree button, which IS the gesture.
- [`tasks/refinements/participant-ui/part_change_vote_pre_commit.md`](part_change_vote_pre_commit.md) — Done at commit `a2d43a4`. Line 48 of that refinement notes that the per-chip change-vote affordance subsumes any "change one facet after agree-all" need — i.e., the predecessor anticipated that a separately-mounted agree-all would have leaned on per-chip change-vote for follow-up corrections. With agree-all removed, the per-chip change-vote affordance trivially handles all corrections (because all agrees were per-chip to begin with).

### Live code surface (no change)

- [`apps/participant/src/proposals/ProposalFacetVoteButtons.tsx`](../../../apps/participant/src/proposals/ProposalFacetVoteButtons.tsx) — the per-chip Agree/Dispute affordance. Byte-stable.
- [`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.tsx) — the chip strip; each chip carries its own Agree button. No row-level button mount point exists or is reserved. Byte-stable.
- [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) — the pane; row header/body structure (lines 134-227) stays as predecessor leaves shaped it. Byte-stable.
- [`apps/participant/src/proposals/perProposalFacets.ts`](../../../apps/participant/src/proposals/perProposalFacets.ts) — `derivePerProposalFacets` returns **exactly one entry per proposal** (lines 184-230 — facet-arm path returns `[{ facet: target.facet, ... }]`; structural-arm path returns `[{ facet: 'proposal', ... }]`). One-entry-per-proposal is the structural pin that makes "agree all facets of THIS proposal" a singleton. Byte-stable.
- [`apps/participant/src/detail/useVoteAction.ts`](../../../apps/participant/src/detail/useVoteAction.ts) — the per-slot vote dispatch hook. No batch surface; no new exported helper. Byte-stable.
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — the wire envelope. No `vote-batch` / `vote-many` shape introduced. Byte-stable.
- [`apps/server/src/ws/handlers/vote.ts`](../../../apps/server/src/ws/handlers/vote.ts) — server-side vote handler. Byte-stable.

### Files this refinement writes

- [`tasks/refinements/participant-ui/part_agree_all_gesture.md`](.) — this document.

### Files this refinement does NOT touch

- No app source — `apps/participant/`, `apps/moderator/`, `apps/server/`, `apps/audience/` all byte-stable.
- No shared package — `packages/shared-types/`, `packages/shell/`, `packages/i18n-catalogs/` all byte-stable.
- No test file — `apps/participant/src/**/*.test.tsx`, `tests/e2e/**/*.spec.ts`, `tests/behavior/**/*.feature` all byte-stable.
- No SQL migration — `apps/server/migrations/` byte-stable.
- No `.tji` file — the `complete 100` marker on `tasks/40-participant-ui.tji` lines 263-267 lands at task-completion-ritual time per [`tasks/refinements/README.md` lines 32-42](../README.md#L32-L42), driven by the closer (NOT this refinement-writer sub-agent).
- No new ADR — Decision §1 below documents why the supersession derivation doesn't warrant one.
- No `docs/adr/`, no `DESIGN.md`, no `docs/participant-ui.md`, no `docs/methodology.md` edit — they already say what this refinement reads off.

## Constraints / requirements

### Files this task touches (explicit allowlist — REFINEMENT-WRITER PASS)

- `tasks/refinements/participant-ui/part_agree_all_gesture.md` (this file).

### Files the CLOSER's pass touches (the `complete 100` ritual — NOT this refinement-writer's pass)

- `tasks/40-participant-ui.tji` — add `complete 100` immediately after `allocate team` inside the `part_agree_all_gesture` block (lines 263-267). Run `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` and confirm silent per [`tasks/refinements/README.md` line 38](../README.md#L38).
- This refinement file — append a `## Status` block at the bottom recording **Closed without implementation — superseded by ADR 0030** with the closer's date.

### Constraints the refinement-writer pass MUST satisfy

- **No production code change.** Implicit by the "Files this task touches" allowlist.
- **No test change.** Implicit by the same allowlist.
- **No invented citations.** Every cross-reference above (ADR 0030, `docs/participant-ui.md:68`, predecessor refinements, the matching `.tji` block) was read by the refinement-writer sub-agent and is real.
- **The refinement document IS the artifact.** Per ADR 0022's "every check is committed," the citation-supported supersession argument is itself the verification — there is no codepath to test because there is no codepath to add.

### What the closer's pass MUST NOT do

- **Do NOT register a placeholder follow-up task** for the across-entities bulk-agree gesture in `tasks/40-participant-ui.tji`. Decision §3 below explains why a placeholder is wrong. The closer registers a follow-up ONLY if the user separately decides the across-entities flavor is in scope for v1.
- **Do NOT amend ADR 0030.** It already settles the supersession. Adding an "agree-all is removed" sentence to the ADR retroactively would conflate the architectural decision (sequential capture removes bundling) with the WBS bookkeeping (this leaf is now a no-op).
- **Do NOT edit `docs/participant-ui.md:68`.** That paragraph is already the canonical statement. Repeating it elsewhere creates drift.
- **Do NOT delete or rename the task block** in `tasks/40-participant-ui.tji` lines 263-267. Closing as `complete 100` with a Status pointer is the recorded outcome; deleting the block would erase the audit trail.

### Test layers per ADR 0022

Zero new tests. The supersession argument is structural — there is no codepath to add or remove, so no test pins one. The existing per-chip Agree button's full coverage (`ProposalFacetVoteButtons.test.tsx` + the predecessor leaves' Playwright steps 9 + 10) is what guarantees v1's agree gesture continues to work. A grep for `agree.all\|agreeAll` across the test tree returns zero matches today and continues to return zero matches after the closer's pass — that is the regression-pin shape for "no agree-all surface exists."

### UI-stream e2e policy (does not apply)

The policy ([`tasks/refinements/README.md` UI-stream e2e section](../README.md)) requires a Playwright spec OR a deferred-e2e justification with a future wiring task. **Deferred-e2e does not apply here either.** The deferral path covers tasks that *create a component or capability that no user flow currently reaches*; this task creates no component at all. The closer's Status block records the supersession; no future task inherits e2e debt against this one (because no future task implements it).

### Backend / WS / projector / methodology-engine policy (does not apply)

No wire change. No broadcast envelope shape change. No projector output change. No new Cucumber scenario.

### Budget honesty (refinement-writer pass — under 0.5d)

- ~30 min: read the predecessor refinement (`part_vote_button_per_facet.md`) + the two settled siblings (`part_vote_single_tap`, `part_change_vote_pre_commit`) for context.
- ~20 min: read `docs/participant-ui.md` + ADR 0030 + ADR 0027 + the `derivePerProposalFacets` selector to confirm the one-entry-per-proposal invariant.
- ~10 min: confirm the WBS shape (`tasks/40-participant-ui.tji` lines 263-267) and the parent's downstream-edges shape.
- ~45 min: write this refinement document.
- ~10 min: final read-through to ensure the citations are accurate.

The closer's pass costs an additional ~15 min — `complete 100` + `tj3 project.tjp` validate + Status-block append.

Risk surface is minimal. The main hazard is that a future reader interprets `complete 100` against this leaf as "implementation shipped" — Decision §2 below mandates the Status block prose to head off that misreading.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is either an existing committed test, a citation-supported documentation read, or a structural property of the codebase that a grep can verify.

1. **The refinement document exists** at `tasks/refinements/participant-ui/part_agree_all_gesture.md` and cites ADR 0030, `docs/participant-ui.md:68`, and the three predecessor refinements (`part_vote_button_per_facet`, `part_vote_single_tap`, `part_change_vote_pre_commit`). This document IS the verification.
2. **`pnpm install` clean** — no dep changes.
3. **`pnpm run check` stays green** (lint + format + typecheck + typecheck-tools + typecheck-tests). The closer's pass touches no TypeScript file, so this is implicit.
4. **`pnpm run test:smoke` stays green** with the existing smoke count unchanged. No new test landed.
5. **`pnpm --filter @a-conversa/i18n-catalogs run check`** stays green — no new i18n keys.
6. **`pnpm run test:e2e --project=chromium-participant-skeleton`** stays green — `tests/e2e/participant-pending-proposals.spec.ts` is byte-stable; steps 1-10 (covering single-tap agree, change-vote-pre-commit, no-confirmation-modal) all pass as the predecessor commits left them.
7. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches (REFINEMENT-WRITER PASS)" for this refinement-writer pass; and outside the allowlist in "Files the CLOSER's pass touches" for the closer's follow-up.
8. **Grep regression-pin: `rg "agree.all|agreeAll|agree all" apps/ packages/ tests/` returns zero matches** (the absence is the structural property that pins "no v1 agree-all surface exists"). The only matches across the repo are inside `tasks/` (refinement-document prose + the `.tji` block itself), `docs/` (the supersession statements), and this file.
9. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after the closer's pass lands `complete 100` on `part_agree_all_gesture` in `tasks/40-participant-ui.tji`.
10. **The closer's Status block** records "**Closed without implementation — superseded by ADR 0030**" with the closer's date and a one-line pointer to this refinement's Decision §1.
11. **No follow-up task registered today.** Decision §3 — the across-entities bulk-agree flavor is a separately-deferred decision; the closer registers it ONLY if the user separately scopes it (which is out of this refinement's reach). A grep for `across_entities_bulk\|bulk_agree\|agree_many` in `tasks/` returns zero matches before and after the closer's pass.
12. **`part_voting` parent rollup unblocked from this leaf.** With this leaf closed, the parent's pending-completion gate depends only on `part_proposal_notification`, which is the lone remaining open leaf under `part_voting`. (`tj3 project.tjp` does NOT auto-rollup, per the task-completion ritual; the closer marks the parent at the parent's own completion ritual when its last leaf lands — separately from this leaf's closure.)

## Decisions

### 1. Close as superseded by ADR 0030; do not implement

The four-pin argument that settles this:

- **Pin A (ADR 0030 §1 + alternatives §1)** — The bundled "capture + classify" gesture is removed. The methodology routes facets one at a time through the moderator's sequence-enforced propose handler. Bundling at the data layer is gone; the UI cannot meaningfully aggregate over a non-existent bundle.
- **Pin B (`docs/participant-ui.md:68`)** — Canonical statement: "No 'Agree all' affordance in v1." Reads off Pin A and crystallizes it as a v1 UX rule.
- **Pin C (`derivePerProposalFacets` returns exactly one entry per proposal)** — Structural invariant in [`apps/participant/src/proposals/perProposalFacets.ts` lines 184-230](../../../apps/participant/src/proposals/perProposalFacets.ts#L184-L230). Whether the selector follows the facet arm or the proposal arm, the result is `[ { ... } ]` — one entry, always. The per-chip Agree button on that one entry IS the agree gesture; aggregating over a singleton adds no affordance, only complexity.
- **Pin D (downstream-consumer evidence)** — The two siblings landed after this task was placed on the WBS (`part_vote_single_tap` at `1813e8e`, `part_change_vote_pre_commit` at `a2d43a4`) both mention the would-have agree-all gesture in their out-of-scope sections and document that the per-chip surface they finalize is sufficient. Three layers of consumer evidence agree that the aggregate gesture has no v1 home.

Three alternatives surveyed:

- **(A) Close as superseded by ADR 0030** (chosen). Cite ADR 0030 + `docs/participant-ui.md:68` + the one-entry-per-proposal structural invariant. No production code change. The closer marks `complete 100` with a "superseded" Status block.
- **(B) Implement a "tap one button to agree to this one chip" wrapper as a degenerate agree-all** (rejected). The per-chip Agree button already IS that gesture (single-tap, no confirmation, dispatches one envelope). Adding a row-level wrapper that fires the same envelope from a different testid is pure surface-area expansion with zero user-visible benefit — it would also have to handle the "row body must be expanded first" UX, the "structural proposal vs facet proposal" arm split (same as the per-chip button already handles), the change-vote re-render branch (same as the per-chip button), and the inline error region (same). Two ways to dispatch the same vote at the same surface is worse than one. Predecessor-refinement §3 (`part_vote_button_per_facet`'s "single component encapsulates the affordance gate") already rejected the analogous "two presentational components" alternative at the per-chip layer; the same logic forbids two surfaces at the per-row layer.
- **(C) Redefine the task as the across-entities bulk-agree gesture** (rejected, with Decision §3 addressing the registration question separately). The original task title is "Agree-all gesture per proposal *bundle*" (emphasis added) — the bundle phrase specifically targets the bundled-proposal data model ADR 0030 removed, not the across-entities flavor. Redefining the task at refinement time without an explicit user-scoped redirection violates the [refinements' scope-shaping role](../README.md#L44-L51) — a refinement bounds task scope, it doesn't introduce new task scope. The across-entities flavor is a separate decision Decision §3 handles.

The supersession is documented citation-by-citation rather than re-derived; this refinement is a "read off the settled sources and record the answer" pass, not a "decide from first principles" pass.

### 2. Close ritual: `complete 100` with a "superseded" Status block (NOT a WBS deletion)

Three alternatives surveyed:

- **(A) `complete 100` + Status block citing this refinement** (chosen). The marker tells `tj3`'s scheduler the leaf is finalized — the parent's rollup can proceed. The Status block tells human readers WHY the marker is `complete 100` despite no commit-record of implementation. Future readers walking the WBS see the marker and read the refinement to learn the supersession. The closer's pass is mechanical: append `complete 100` to lines 263-267 of [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji#L263-L267) and append the Status block at the bottom of this refinement.
- **(B) Delete the task block from the `.tji`** (rejected). Erases the audit trail of "this was once on the WBS and was deliberately cancelled." A future reader would have no way to know the task ever existed; if a user later asks "didn't we plan an agree-all gesture once?" the answer "no, never" would be wrong. The `complete 100` + Status posture preserves the historical record.
- **(C) Add a new TaskJuggler attribute** (e.g., `superseded "yes"` or a custom `note`) **instead of `complete 100`** (rejected). The TaskJuggler grammar has no superseded-task primitive; the scheduler reads `complete 100` and nothing else for "this leaf no longer holds up dependents." Inventing a custom attribute would have to be parsed by something — and the something doesn't exist. `complete 100` is the existing pattern the closer ritual already uses; this leaf reuses it for the structural property (leaf finalized) and the Status block carries the human-readable rationale (finalized without implementation).

The Status block prose the closer writes MUST head off the "completed = implemented" misreading. A suggested template (the closer adapts the date):

> ## Status
>
> **Closed without implementation — superseded by [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)** — 2026-MM-DD.
>
> The sequential-capture model from ADR 0030 removes the bundled-proposal data shape this gesture would have aggregated over. Per [`docs/participant-ui.md:68`](../../../docs/participant-ui.md#L68) ("No 'Agree all' affordance in v1") and the predecessor [`part_vote_button_per_facet`](part_vote_button_per_facet.md)'s per-chip Agree button (which IS v1's agree gesture), no production code corresponds to this leaf's closure.
>
> No source file, no test file, no i18n key, no ADR landed for this task. The refinement document (Decision §1) is the audit trail.

### 3. Do NOT register an across-entities bulk-agree follow-up today

[`docs/participant-ui.md:68`](../../../docs/participant-ui.md#L68) names an across-entities flavor as a "separately deferred decision": *"If a future need surfaces for bulk-agreeing the currently-proposed facet across multiple selected entities (an across-entities bulk gesture), that would be its own deferred decision."*

Three alternatives surveyed:

- **(A) Do not register a follow-up; document the deferred-decision pointer in this refinement only** (chosen). The docs explicitly name the across-entities flavor as a separate deferred decision — meaning the decision-to-implement has not been made. A WBS leaf records work the project plans to do; pre-registering a leaf for work the project has not decided to do creates planning debt (a stale entry that everyone scrolls past until somebody finally deletes it, or worse, an entry the orchestrator picks up and a refinement-writer has to rebut). The registration of a future leaf is a user-scoped decision; the refinement-writer pass does not have the authority to make it.
- **(B) Register `part_voting.part_across_entities_bulk_agree` (1d) as a deferred follow-up** in [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji) (rejected). Premature — the docs explicitly say the decision is deferred. Adding a WBS leaf for an undecided feature contradicts the docs. If the user later decides to scope it, they (or a follow-up refinement they request) can register the leaf at that moment.
- **(C) Add an open question to this refinement** asking the closer to decide the registration (rejected). The closer's role per [`tasks/refinements/README.md` lines 32-42](../README.md#L32-L42) is to mechanically append the `complete 100` marker and Status block — not to make scoping decisions. Pushing the registration question onto the closer mis-routes the authority. The user is the right authority.

The pointer to the across-entities flavor is already in `docs/participant-ui.md`; future readers walking from this refinement to the docs see it without an in-WBS placeholder.

### 4. Do NOT pre-reserve a row-level testid for a hypothetical future agree-all surface

Three alternatives surveyed:

- **(A) Do not reserve `participant-pending-proposal-row-agree-all` or any row-level button testid** (chosen). No row-level button exists; pre-reserving a name that nothing emits is tech debt — a grep for the testid would land readers at zero call sites, leaving them to wonder whether the surface is missing or never existed. The naming convention (pane-namespaced prefix, dash-separated, per-leaf settle per `part_vote_button_per_facet` Decision §4) is consistent enough that a future implementer can name the testid at that moment with no naming-collision risk.
- **(B) Add a `// TODO: reserve participant-pending-proposal-row-agree-all` comment** in [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) (rejected). The CLAUDE.md instruction "Default to writing no comments" applies. The comment would also have to be removed if/when the across-entities flavor is scoped under a different testid (e.g., pane-level instead of row-level).
- **(C) Pre-register the testid in a `tests/e2e/_testids.ts`-style central registry** (rejected). No such central registry exists; introducing one for a single hypothetical testid would be a disproportionate abstraction.

The decision is documented here so a future "agree across multiple selected entities" refinement (if scoped) names the testid afresh.

### 5. No new ADR

Every architectural question this refinement could have raised is already settled by an existing ADR:

- The sequential-capture model that removes the bundle — ADR 0030 §1 + §6 + §8.
- The wire shape that makes votes `(entity, facet)`-keyed (and which therefore cannot natively batch) — ADR 0030 §2.
- The entity / facet layer split that determines where bundling could live — ADR 0027.
- The single-tap-no-confirmation posture the agree-all gesture would have inherited — [`tasks/refinements/participant-ui/part_vote_single_tap.md`](part_vote_single_tap.md) (refinement-level decision, not an ADR — and correctly so, because single-tap is a UX policy not an architectural seam).
- The per-facet supersession-clear rule — ADR 0030 §7.
- The proposal-keyed structural-arm-stays-structural rule — ADR 0030 §9.

This refinement introduces no new architectural seam, no new dependency, no new security trade-off, no new abstraction. The ADR convention's "amendment-pass rule" ([`docs/adr/README.md`](../../../docs/adr/README.md)) does not fire because there is no architectural decision being made — only a WBS bookkeeping decision (close as superseded) plus three implementation-shaping decisions (no follow-up registration today, no testid reservation today, no comment-shaped TODO).

## Open questions

(none — all decided)

## Status

**Closed without implementation — superseded by [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)** — 2026-05-26.

The sequential-capture model from ADR 0030 removes the bundled-proposal data shape this gesture would have aggregated over. Per [`docs/participant-ui.md:68`](../../../docs/participant-ui.md#L68) ("No 'Agree all' affordance in v1") and the predecessor [`part_vote_button_per_facet`](part_vote_button_per_facet.md)'s per-chip Agree button (which IS v1's agree gesture), no production code corresponds to this leaf's closure.

- Refinement document written: `tasks/refinements/participant-ui/part_agree_all_gesture.md` — the audit trail for the supersession decision.
- WBS closure: `complete 100` added to `tasks/40-participant-ui.tji` at `part_agree_all_gesture` block (lines 263-267).
- No source file, no test file, no i18n key, no ADR landed for this task.
- No follow-up task registered (across-entities bulk-agree is a separately-deferred user-scoped decision per `docs/participant-ui.md:68`).
- Acceptance criterion §8 regression-pin holds: `rg "agree.all|agreeAll|agree all"` returns zero matches outside `tasks/` and `docs/`.
- Decision §1 (close as superseded by ADR 0030) is the authoritative rationale; Decision §3 (no follow-up registration) is the closer's constraint.
