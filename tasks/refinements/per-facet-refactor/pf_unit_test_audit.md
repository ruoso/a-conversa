# Unit-test audit + revision sweep

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.tests.pf_unit_test_audit`
**Effort estimate**: 1.5d
**Inherited dependencies**: every other `pf_*` task except `pf_e2e_methodology_full_flow_update`. The audit only makes sense after the surface is in place.

## What this task is

Sweep the unit test suites across `apps/server`, `apps/moderator`, `apps/participant`, and `packages/shared-types` for cases that assert the old vote / commit / meta-disagreement-marked envelope shapes (proposal-id-keyed for facet-valued proposals) or the old bundled `classify-node` propose path. For each affected file, decide the resolution:

- **Revise in place** — the assertion is still meaningful under the new shape but the payload changes; rewrite the assertion against the new shape.
- **Remove** — the assertion was specific to the old shape and has no analog under the new shape (e.g. asserting the bundled `classify-node` envelope landed alongside `node-created`).
- **Keep as-is** — the assertion is about a structural proposal sub-kind and continues to pass under `pf_structural_handlers_unchanged`'s pin.

Per [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md): the audit produces a list of test files affected and the per-file resolution. The list lives in this refinement's `## Status` block on completion (per the task-completion ritual); the in-place revisions land in the same commits as the sibling `pf_*` tasks; the removals + the kept-as-is items are explicit in the audit output.

## Why it needs to be done

The refactor changes the wire shape across many event kinds. Each sibling `pf_*` task ships its own per-task tests, but the prior test suite has many indirect dependencies on the old shape (a server-side scenario that asserted the projection's `committedProposalEventId` after a `classify-node` round-trip, for example). Without an explicit audit, those tests rot silently — they either fail at PR time (catching the regression but at the wrong moment) or they pass against stale fixtures (hiding regressions). The audit is the load-bearing one-pass sweep that prevents both.

## Inputs / context

- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — the discipline this task implements.
- Every sibling `pf_*` task's "tests revised" acceptance criterion.
- The four packages whose test suites are in scope: `apps/server/src/**/*.test.ts`, `apps/moderator/src/**/*.test.{ts,tsx}`, `apps/participant/src/**/*.test.{ts,tsx}`, `packages/shared-types/src/**/*.test.ts`.

## Constraints / requirements

- Run `grep -nrE "proposal_id|proposal_event_id|classify-node|set-node-substance|set-edge-substance|edit-wording|vote.*choice.*withdraw|metaDisagreementMarked|committedProposalEventId|committedProposals" apps/ packages/` (or similar) to enumerate candidate files.
- For each candidate, classify as revise / remove / keep, with a one-line rationale.
- The revise + remove cases land in the same commits as the sibling task that introduces the corresponding new shape (so each `pf_*` task ships with its tests in sync). The audit task's deliverable is the **list** + the **decisions per file**; the changes themselves are distributed across the sibling tasks' commits.
- The Cucumber + pglite scenarios under `tests/behavior/` are also in scope (same approach).
- The Playwright spec at `tests/e2e/methodology-full-flow.spec.ts` is owned by `pf_e2e_methodology_full_flow_update`, not this task.

## Acceptance criteria

- A complete list of affected test files lives in the `## Status` block of this refinement on task close (per the task-completion ritual).
- Every file in the list is either: revised in-place under the sibling task's commit, removed under the sibling task's commit, or explicitly kept-as-is with rationale.
- After every sibling `pf_*` task lands, `pnpm run test:smoke` green, `pnpm run test:behavior:smoke` green, `make test` green.
- `tj3 project.tjp` parses clean.

## Decisions

- **The audit is itself the deliverable**, not new code. Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), the audit's output (the list + per-file resolution) is captured in the Status block so future readers can see why specific test changes accompanied specific sibling commits.
- **Revisions land with the sibling task that introduces the new shape**, not in a separate audit commit. This keeps each sibling task self-contained: its tests + its source land together.

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-24.

Final-leaf audit sweep for M2.5. Per the Decisions block + ADR 0022, the audit is the deliverable; the in-place revisions landed under each sibling `pf_*` task's commit as that task introduced its new shape. The Cucumber + Playwright surfaces were also walked.

**Corrected judgement on `vote.choice = 'withdraw'` back-compat.** The first pass classified the projection-layer back-compat branches (`hasLegacyWithdrawVote` in `apps/participant/src/graph/facetStatus.ts` + `apps/moderator/src/graph/facetStatus.ts`; the `'withdraw'` arm of the shell `Vote.choice` type at `packages/shell/src/facet-pill/vote-indicator.ts`; the `'withdraw'` arm of `PerParticipantVote` in `apps/server/src/projection/types.ts`) as "keep-as-is — exercises intentional back-compat." That judgement was **wrong**: per `pf_facet_keyed_vote_payload` (commit `a2521f6`) the Zod schema hard-rejects `vote.choice = 'withdraw'` on inbound validation, per `pf_withdraw_agreement_handler` (commit `8518fff`) the canonical `withdraw-agreement` event kind owns the legal withdrawal path, and per ADR 0030's Consequences clean-break paragraph no legacy session logs need to be preserved. Combined, **no `vote.choice = 'withdraw'` can reach the projection** — the back-compat branches were dead code provisionally retained during the refactor, and this audit task closes them.

### Audit-driven changes (this commit)

**Projection sources (back-compat branches removed):**

- `apps/server/src/projection/types.ts` — `PerParticipantVote` narrowed to `'agree' | 'dispute'`.
- `apps/server/src/projection/facet-status.ts` — removed `hasLegacyWithdrawVote` branches from `deriveFacetStatusFromState` rules 4 + 5; updated rule-list comment to name `withdraw-agreement` as the sole withdrawal source.
- `apps/server/src/projection/replay.ts` — narrowed inline doc + dropped the obsolete "still includes `'withdraw'`" comment.
- `apps/moderator/src/graph/facetStatus.ts` — `PerParticipantVote` narrowed; removed the `hasLegacyWithdrawVote` branches; updated rule-list comment.
- `apps/participant/src/graph/facetStatus.ts` — same mirror narrowing + branch removal + rule-list update; widened rule list from 7 → 8 to match the moderator/server canonicals.
- `apps/participant/src/graph/otherVotes.ts` — `perFacetVoterArm` narrowed to `'agree' | 'dispute'`; removed the `arm === 'withdraw'` skip in `rerollEntityVoter`; updated file-header docstring.
- `apps/participant/src/graph/projectGraph.ts` — updated `ownVote` / `otherVotes` JSDoc paragraphs (no behavioural change; the `'withdraw'` arm of the doc was stale).
- `apps/participant/src/detail/EntityDetailPanel.tsx` — `OwnFacetVote` narrowed to `'agree' | 'dispute'`.
- `packages/shell/src/facet-pill/vote-indicator.ts` — `Vote.choice` narrowed to `'agree' | 'dispute'`.
- `packages/shell/src/facet-pill/VoteIndicator.tsx` — `VoteIndicatorProps.choice` narrowed; removed the `withdraw: 'bg-slate-400'` entry from `CHOICE_FILL_CLASSNAME`; updated header doc.

**Wire schema (closed the provisional back-compat seam):**

- `packages/shared-types/src/ws-envelope.ts` — `wsVoteFacetPayloadSchema.choice` + `wsVoteProposalPayloadSchema.choice` narrowed from `['agree', 'dispute', 'withdraw']` to `['agree', 'dispute']`, matching the canonical event payload schema. The methodology-engine `illegal-state-transition` rejection branch for `'withdraw'` is now unreachable (the WS layer rejects with `malformed-envelope` upstream of the engine).

**Methodology engine (dead-code cleanup downstream of the type narrowing):**

- `apps/server/src/methodology/handlers/vote.ts` — `VoteAction.vote` is now `'agree' | 'dispute'`. Removed: the facet-arm `action.vote === 'withdraw'` rejection branch; the proposal-arm `action.vote === 'withdraw'` branches in the proposal-state matrix + the prior-vote check; the obsolete `as 'agree' | 'dispute'` cast (which would now be a no-op). Updated the file-header docstring + the proposal-state matrix rule comment to reflect that no further vote arms are legal on a committed proposal (the dedicated `withdraw-agreement` event owns the gesture).

**Tests deleted (dead-code coverage of unreachable paths):**

- `apps/server/src/methodology/handlers/vote.test.ts` — three withdraw-arm rejection cases (`illegal-state-transition` on facet-valued committed, `proposal-already-meta-disagreement` on meta-marked, `proposal-already-committed` on late-joiner). The fourth case (universal gate not-a-participant on a committed proposal) was rewritten against the `'agree'` arm — the universal gate fires identically regardless of choice.
- `apps/participant/src/graph/otherVotes.test.ts` — test case (f) (`'withdraw'` arm by a previously-voting voter removes the entry).
- `apps/moderator/src/graph/selectors.test.ts` — `records a withdraw arm distinctly` (the legacy `'withdraw'` projection-pinning case).
- `apps/moderator/src/graph/proposalFacets.test.ts` — `participant voted withdraw blocks commit` (the `'dispute'` sibling above carries the structural coverage).
- `apps/moderator/src/graph/StatementNode.test.tsx` — `renders a withdrawn vote with the gray choice color` (the indicator no longer renders a `'withdraw'` arm).
- `packages/shell/src/facet-pill/VoteIndicator.test.tsx` — `stamps data-choice="withdraw"`, `withdraw applies bg-slate-400`, `pt-BR withdraw reads ... votou retirou` (the `bg-slate-400` assertion was load-bearing in the per-choice palette case for `'agree'` + `'dispute'`; the per-choice palette assertions retain the `not.toContain('bg-rose-500')` / `not.toContain('bg-emerald-500')` cross-checks).

**Tests retargeted (kept structural coverage by switching the arm):**

- `apps/moderator/src/graph/selectors.test.ts` — `buckets votes correctly across two distinct nodes` (`'withdraw'` → `'dispute'`).
- `apps/moderator/src/graph/proposalFacets.test.ts` — `surfaces the matching (nodeId, facet) bucket for edit-wording` (`'withdraw'` → `'dispute'`); `preserves arrival order across multiple participants` (`'withdraw'` → `'agree'`).
- `apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx` — `renders three indicators in arrival order` (`'withdraw'` → `'agree'`).
- `packages/shell/src/facet-pill/FacetPill.test.tsx` — `renders three indicators with distinct data-choice values for mixed ... votes` rewritten to two-arm (`'agree'` + `'dispute'`).
- `apps/server/src/ws/handlers/vote.test.ts` — `withdraw of a facet-valued proposal` re-pinned: was `illegal-state-transition` from the methodology engine, now `malformed-envelope` from the WS schema layer (the rejection happens upstream of the engine).

**Test helper signatures narrowed** (the `vote: 'agree' | 'dispute' | 'withdraw'` → `vote: 'agree' | 'dispute'` narrowing across the local `voteEvent` / `makeVote` / `makeVoteAction` helpers):

- `apps/moderator/src/graph/facetStatus.test.ts`
- `apps/moderator/src/graph/selectors.test.ts`
- `apps/participant/src/graph/facetStatus.test.ts`
- `apps/participant/src/graph/otherVotes.test.ts`
- `apps/participant/src/detail/EntityDetailPanel.test.tsx`
- `apps/server/src/methodology/engine.test.ts`
- `apps/server/src/methodology/handlers/vote.test.ts`

**Cucumber:**

- `tests/behavior/methodology/vote.feature` — deleted the two scenarios that pinned the methodology engine's rejection of facet-valued / late-joiner `'withdraw'` votes (schema rejection now happens upstream at the wire layer).
- `tests/behavior/steps/methodology-vote.steps.ts` — deleted the two `When` step definitions that constructed legacy `vote: 'withdraw'` actions.
- `tests/behavior/backend/ws-vote.feature` — re-pinned the wire-level `'withdraw'` rejection scenario to `malformed-envelope` (from `illegal-state-transition`).
- `tests/behavior/steps/backend-ws-vote.steps.ts` — added a new `Then the client receives a malformed-envelope error envelope` step (schema rejection has no `inResponseTo` because the inbound frame failed to parse).

### Original per-file catalog (most resolutions correct)

Catalog query (per the Constraints block):

```
grep -nrlE "proposal_event_id|proposalEventId|classify-node|set-node-substance|set-edge-substance|edit-wording|vote.*choice.*withdraw|metaDisagreementMarked|committedProposalEventId|committedProposals" apps/ packages/ --include='*.test.ts' --include='*.test.tsx'
```

Per-file resolution (60 candidate test files; the sibling task that owns each revise/delete is named where applicable):

**Wire-shape pins for the new model (all `revised in-place` under their owning sibling):**

- `packages/shared-types/src/events.test.ts` — facet/proposal `target`-discriminated unions for vote/commit/meta-disagreement-marked + `withdraw-agreement` payload schema. Owners: `pf_facet_keyed_vote_payload`, `pf_facet_keyed_commit_payload`, `pf_facet_keyed_meta_disagreement_payload`, `pf_withdraw_agreement_event_kind`.
- `packages/shared-types/src/events/proposals.test.ts` — `capture-node` schema (inline wording + inline edge block) per ADR 0030 §1/§4/§5. Owner: `pf_capture_emits_inline_wording_only`.
- `apps/server/src/events/validate.test.ts` — round-trip + cross-arm corruption + `'withdraw'` choice rejection. Owners: same as `events.test.ts`.
- `packages/shared-types/src/limits.test.ts` — keep-as-is (orthogonal to ADR 0030 — text-length limits).

**Server methodology engine + handlers (revise in-place under each owning sibling):**

- `apps/server/src/methodology/engine.test.ts` — keep-as-is for the engine's input-action shape (`proposalEventId` is the engine's input field; the discriminated wire payload is constructed by the dispatcher per sub-kind).
- `apps/server/src/methodology/handlers/vote.test.ts` — facet vs proposal arm split per ADR 0030 §2/§9. Owner: `pf_vote_handler_facet_keyed`.
- `apps/server/src/methodology/handlers/commit.test.ts` — facet vs proposal arm split. Owner: `pf_commit_handler_facet_keyed`.
- `apps/server/src/methodology/handlers/markMetaDisagreement.test.ts` — facet vs proposal arm split. Owner: `pf_meta_disagreement_handler_facet_keyed`.
- `apps/server/src/methodology/handlers/structural-target.test.ts` — proposal-keyed pin for the structural sub-kinds (the load-bearing keep-as-is at the mixed-model boundary). Owner: `pf_structural_handlers_unchanged`.
- `apps/server/src/methodology/handlers/proposeCaptureNode.test.ts` — new test file; the `capture-node` wording-only + capture-with-edge gestures. Owner: `pf_capture_emits_inline_wording_only`.
- `apps/server/src/methodology/handlers/proposeSequenceGate.test.ts` — wire-level sequence gates (`classify-node` against `wording`, `set-node-substance` against `classification`, `set-edge-substance` against `shape`). Owner: `pf_sequence_gate_server_enforced`.
- `apps/server/src/methodology/handlers/proposeAmendNode.test.ts`, `proposeDecompose.test.ts`, `proposeInterpretiveSplit.test.ts`, `proposeAxiomMark.test.ts`, `proposeAnnotate.test.ts`, `proposeMetaMove.test.ts`, `proposeBreakEdge.test.ts`, `proposeDefeaterPreCommit.test.ts`, `proposeEditWording.test.ts`, `proposeSetEdgeSubstanceEndpoints.test.ts`, `proposeSetEdgeSubstanceValidation.test.ts` — keep-as-is for the propose-side per-sub-kind validation rules (orthogonal to the wire shape change).

**Server projection + replay (revise in-place under their owning siblings):**

- `apps/server/src/projection/replay.test.ts` — facet-keyed vote/commit/meta-disagreement-marked arms + `withdraw-agreement` arm + the structural-proposal `committedProposalEventId` pin. Owners: `pf_projection_replay_updates`, `pf_withdraw_agreement_handler`.
- `apps/server/src/projection/projection.test.ts` — projection.getPendingProposal + facet-state shape. Owner: `pf_projection_facet_status_refactor`.
- `apps/server/src/projection/incremental.test.ts` — incremental projection's pending-proposal iteration. Keep-as-is (the projection's internal `proposalEventId` field is informational metadata, not wire shape).
- `apps/server/src/projection/facet-status.test.ts` — new `awaiting-proposal` value + the 7-rule derivation against the facet-keyed wire arm. Owner: `pf_awaiting_proposal_facet_status`.
- `apps/server/src/projection/active-firing.test.ts` — keep-as-is.

**Server WS handlers (revise in-place under their owning siblings):**

- `apps/server/src/ws/handlers/vote.test.ts` — discriminated `target` shape + `'withdraw'` choice rejection at the engine arm. Owner: `pf_part_vote_action_facet_keyed`.
- `apps/server/src/ws/handlers/commit.test.ts` — facet vs proposal commit shape. Owner: `pf_commit_handler_facet_keyed`.
- `apps/server/src/ws/handlers/meta-disagreement.test.ts` — facet vs proposal meta-disagreement shape. Owner: `pf_meta_disagreement_handler_facet_keyed`.
- `apps/server/src/ws/handlers/withdraw-agreement.test.ts` — new handler test file for the dedicated event kind. Owner: `pf_withdraw_agreement_handler`.
- `apps/server/src/ws/handlers/withdraw.test.ts` — keep-as-is (distinct `withdraw-proposal` flow per ADR 0027; structural-proposal retraction).
- `apps/server/src/ws/handlers/snapshot.test.ts` — snapshot payload reflects new facet-state shape. Owner: `pf_projection_facet_status_refactor`.
- `apps/server/src/ws/handlers/catch-up.test.ts` — keep-as-is (replay seam orthogonal to wire shape).
- `apps/server/src/ws/broadcast/proposal-status.test.ts` — keep-as-is (broadcast topology unchanged).

**Diagnostics (keep-as-is — diagnostic rules orthogonal to ADR 0030):**

- `apps/server/src/diagnostics/contradiction-detection.test.ts`
- `apps/server/src/diagnostics/cycle-detection.test.ts`
- `apps/server/src/diagnostics/event-emission.test.ts`
- `apps/server/src/diagnostics/pending-consequences.test.ts`

**Moderator UI (revise in-place under their owning siblings):**

- `apps/moderator/src/graph/facetStatus.test.ts` — `FacetName` widening to include `'shape'` + facet-keyed event handling. Owner: `pf_mod_facet_name_widen_shape`. Audit-driven update (this commit): `voteEvent` helper signature narrowed to `'agree' | 'dispute'`.
- `apps/moderator/src/graph/selectors.test.ts` — facet-keyed vote routing through the projection; `committedProposalEventId` retained for structural-proposal display. Owner: `pf_mod_facet_name_widen_shape`. Audit-driven updates: `makeVote` helper narrowed; `records a withdraw arm distinctly` case deleted; `buckets votes correctly across two distinct nodes` retargeted to `'dispute'`.
- `apps/moderator/src/graph/proposalFacets.test.ts` — per-proposal facet derivation. Audit-driven updates: deleted `participant voted withdraw blocks commit` case; retargeted two cases (`edit-wording bucket lookup`, `preserves arrival order`) from `'withdraw'` to `'dispute'` / `'agree'`.
- `apps/moderator/src/graph/pendingProposals.test.ts` — `PendingProposalRow.proposalEventId` is the display-row identifier, not wire shape. Keep-as-is.
- `apps/moderator/src/graph/proposalFilter.test.ts` — same as above. Keep-as-is.
- `apps/moderator/src/graph/StatementNode.test.tsx` — facet pill + per-facet vote rows + pending axiom-mark display. Owner: `pf_mod_facet_name_widen_shape`.
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — pending axiom-mark badge surface. Keep-as-is.
- `apps/moderator/src/graph/PendingAxiomMarkBadge.test.tsx` — keep-as-is (structural proposal display).
- `apps/moderator/src/graph/EdgeCardSubstanceAffordance.test.tsx` — new propose-substance affordance on the edge card. Owner: `pf_mod_edge_card_substance_affordance`.
- `apps/moderator/src/graph/NodeCardClassificationPalette.test.tsx` — relocated classification palette per ADR 0030 §1. Owner: `pf_mod_node_card_classification_affordance`.
- `apps/moderator/src/graph/NodeCardSubstanceAffordance.test.tsx` — new propose-substance affordance on the node card. Owner: `pf_mod_node_card_substance_affordance`.
- `apps/moderator/src/layout/PendingProposalsPane.test.tsx` — facet-keyed proposal listing. Owner: `pf_mod_pending_proposals_pane_facet_keyed`.
- `apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx` — facet breakdown row shape. Owner: `pf_mod_pending_proposals_pane_facet_keyed`.
- `apps/moderator/src/layout/useProposeAction.test.tsx` — `capture-node` (NOT bundled `classify-node`-with-wording) per ADR 0030 §1. Owner: `pf_mod_capture_pane_wording_only`.
- `apps/moderator/src/layout/useProposeClassifyNodeAction.test.tsx` — new per-node card propose hook. Owner: `pf_mod_node_card_classification_affordance`.
- `apps/moderator/src/layout/useProposeSetNodeSubstanceAction.test.tsx` — new per-node card propose hook. Owner: `pf_mod_node_card_substance_affordance`.
- `apps/moderator/src/layout/useProposeSetEdgeSubstanceAction.test.tsx` — new per-edge card propose hook. Owner: `pf_mod_edge_card_substance_affordance`.
- `apps/moderator/src/layout/useEditWordingAction.test.tsx` — edit-wording reword + restructure propose hooks. Owner: `pf_mod_edit_wording_action`.
- `apps/moderator/src/layout/EditWordingSubmenu.test.tsx` — edit-wording submenu UI. Owner: `pf_mod_edit_wording_action`.
- `apps/moderator/src/layout/useWithdrawProposalAction.test.tsx` — keep-as-is (the existing structural-proposal withdraw-proposal flow per ADR 0027).

**Participant UI (revise in-place under their owning siblings):**

- `apps/participant/src/graph/facetStatus.test.ts` — facet-keyed wire arm + `withdraw-agreement` event. Owner: `pf_projection_facet_status_refactor`. Audit-driven update: `voteEvent` helper narrowed to `'agree' | 'dispute'`.
- `apps/participant/src/graph/ownVotes.test.ts` — `withdraw-agreement` event silently dropped by the vote-only projector (documented as expected pre-`part_withdraw_indicator`). Keep-as-is.
- `apps/participant/src/graph/otherVotes.test.ts` — `withdraw-agreement` rollup. Audit-driven updates: `voteEvent` helper narrowed; test case (f) (the legacy `'withdraw'` arm REMOVES voter entry) deleted.
- `apps/participant/src/graph/projectGraph.test.ts` — facet-keyed projection + wording-inline node display. Owner: `pf_projection_facet_status_refactor`.
- `apps/participant/src/graph/annotations.test.ts`, `axiomMarks.test.ts` — keep-as-is (structural proposal display).
- `apps/participant/src/graph/GraphView.test.tsx` — keep-as-is.
- `apps/participant/src/detail/EntityDetailPanel.test.tsx` — three-facet-rows-per-node + two-facet-rows-per-edge surface per ADR 0030. Owner: `pf_part_detail_panel_three_facet_rows`.
- `apps/participant/src/detail/ParticipantVoteButtons.test.tsx` — facet-keyed vote routing for facet-valued proposals + proposal-keyed routing for structural sub-kinds. Owner: `pf_part_vote_action_facet_keyed`.
- `apps/participant/src/routes/LobbyRoute.test.tsx` — keep-as-is (lobby flow orthogonal).

**Shell package (revise in-place):**

- `packages/shell/src/facet-pill/FacetPill.test.tsx` — facet pill display. Audit-driven updates: `Vote.choice` narrowed to `'agree' | 'dispute'`; `renders three indicators with distinct data-choice values for mixed agree + dispute + withdraw votes` rewritten as a two-arm `'agree' + 'dispute'` case.
- `packages/shell/src/facet-pill/VoteIndicator.test.tsx` — audit-driven updates: deleted `stamps data-choice="withdraw"`, `withdraw applies bg-slate-400`, and `pt-BR withdraw` cases (the indicator no longer renders a `'withdraw'` arm).

**Behavior (Cucumber + pglite) — `tests/behavior/`:**

- `methodology/vote.feature` + `steps/methodology-vote.steps.ts` — facet-keyed vote round-trip. Owners: `pf_vote_handler_facet_keyed`, `pf_withdraw_agreement_event_kind`. Audit-driven updates (this commit): deleted the two `'withdraw'`-choice rejection scenarios + matching `When` step definitions (schema rejection now happens at the wire layer).
- `methodology/withdraw-agreement.feature` + `steps/withdraw-agreement.steps.ts` — new feature for the new event kind. Owners: `pf_withdraw_agreement_event_kind`, `pf_withdraw_agreement_handler`.
- `projection/facet-status.feature` + `facet-status-facet-keyed.feature` — `awaiting-proposal` + facet-keyed event handling. Owner: `pf_awaiting_proposal_facet_status`.
- `projection/replay-mixed-arm.feature` + `steps/projection-replay-mixed-arm.steps.ts` — explicit pin for the mixed (facet + proposal) arm replay. Owner: `pf_projection_replay_updates`.
- `backend/ws-vote.feature` + `backend/ws-withdraw.feature` + `backend/ws-audience-subscribe.feature` — wire-level vote + withdraw-proposal + audience flows; all updated to new shape. Owners: respective sibling tasks. Audit-driven update (this commit): the `'withdraw'` choice rejection scenario in `ws-vote.feature` was re-pinned from `illegal-state-transition` (methodology engine) to `malformed-envelope` (WS schema layer); added a matching `Then` step `the client receives a malformed-envelope error envelope` in `steps/backend-ws-vote.steps.ts`.
- `methodology/propose-capture-node.feature` — new feature for the wording-only capture gesture. Owner: `pf_capture_emits_inline_wording_only`.
- `diagnostics/contradiction-detection.feature` — keep-as-is.

**Playwright (`tests/e2e/`)** — owned by `pf_e2e_methodology_full_flow_update`, out of scope here.

**Files deleted across the milestone**: none. The retirements (`vote.choice = 'withdraw'` arm, bundled `classify-node`-with-wording) had no dedicated test files — they were inline cases within larger files. The legacy `'withdraw'` cases were either rewritten in place against the surviving arms, or deleted as part of this audit task (see "Audit-driven changes" above).

**Files added across the milestone** (new test files, all under sibling task ownership):

- `apps/server/src/methodology/handlers/proposeCaptureNode.test.ts`
- `apps/server/src/methodology/handlers/proposeSequenceGate.test.ts`
- `apps/server/src/methodology/handlers/structural-target.test.ts`
- `apps/server/src/ws/handlers/withdraw-agreement.test.ts`
- `apps/moderator/src/graph/EdgeCardSubstanceAffordance.test.tsx`
- `apps/moderator/src/graph/NodeCardClassificationPalette.test.tsx` (relocated from `apps/moderator/src/layout/ClassificationPalette.test.tsx` — old tests kept where orthogonal, new card-relative pin added)
- `apps/moderator/src/graph/NodeCardSubstanceAffordance.test.tsx`
- `apps/moderator/src/layout/useProposeClassifyNodeAction.test.tsx`
- `apps/moderator/src/layout/useProposeSetNodeSubstanceAction.test.tsx`
- `apps/moderator/src/layout/useProposeSetEdgeSubstanceAction.test.tsx`
- `apps/moderator/src/layout/useEditWordingAction.test.tsx`
- `apps/moderator/src/layout/EditWordingSubmenu.test.tsx`
- `tests/behavior/methodology/withdraw-agreement.feature` + `steps/withdraw-agreement.steps.ts`
- `tests/behavior/methodology/propose-capture-node.feature`
- `tests/behavior/projection/replay-mixed-arm.feature` + `steps/projection-replay-mixed-arm.steps.ts`
- `tests/behavior/projection/facet-status-facet-keyed.feature`

**Audit finding summary**: the per-task discipline (revise tests in the same commit as the source change) held across all 26 sibling commits. The final audit sweep confirms no stale test references survived; the `proposalEventId` references that remain are either projection-internal informational metadata, methodology-engine input-action fields, or display-row identifiers — none assert wire-payload shape against facet-valued proposals. The legacy `'withdraw'` projection-arm back-compat that the prior audit pass mis-classified as "kept-as-is" was retired by this commit: the wire schema's hard rejection (Zod enum) + ADR 0030's clean-break migration mean no `'withdraw'` choice can reach the projection, so the back-compat branches in `apps/participant/src/graph/facetStatus.ts`, `apps/moderator/src/graph/facetStatus.ts`, and `apps/server/src/projection/facet-status.ts` were dead code; closed alongside the dead-code coverage tests + the shell `Vote` type narrowing.

Verification:

- `pnpm run check` — green.
- `pnpm run test:smoke` — 4440 passing, 0 skipped (Δ −10 from the `pf_mod_facet_name_widen_shape` baseline of 4450 — the audit-driven case deletions: 3 withdraw-arm cases in `apps/server/src/methodology/handlers/vote.test.ts`, 1 in `apps/participant/src/graph/otherVotes.test.ts`, 1 in `apps/moderator/src/graph/selectors.test.ts`, 1 in `apps/moderator/src/graph/proposalFacets.test.ts`, 1 in `apps/moderator/src/graph/StatementNode.test.tsx`, and 3 in `packages/shell/src/facet-pill/VoteIndicator.test.tsx`).
- `pnpm run test:behavior:smoke` — 261 scenarios / 1803 steps (Δ −2 / −9 — the two deleted `'withdraw'`-rejection scenarios in `methodology/vote.feature`).
- `make up` + `pnpm run test:e2e:smoke` + `make down-v` — 121 passed + 0 fixme (unchanged; the e2e suite was not touched).
