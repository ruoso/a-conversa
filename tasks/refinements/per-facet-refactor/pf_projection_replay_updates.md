# Projection replay walker updates

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.projection.pf_projection_replay_updates`
**Effort estimate**: 1d
**Inherited dependencies**: `pf_projection_facet_status_refactor` (defines the data structure this task's walker populates).

## What this task is

Tighten the replay dispatcher in [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) so the new facet-keyed event shapes route correctly:

- `handleNodeCreated` writes `payload.wording` into the new node's `wordingFacet.candidateValue`.
- `handleEdgeCreated` writes the role + endpoints into the new edge's `shapeFacet.candidateValue`.
- `handleProposal` (for facet-valued sub-kinds: `classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`) sets `FacetState.candidateValue` + `candidateProposalEventId` on the targeted facet AND clears `FacetState.perParticipant`.
- `handleProposal` (for structural sub-kinds) keeps its existing behavior; routes through the proposal-keyed structure that the structural-handler refinement (`pf_structural_handlers_unchanged`) pins.
- `handleVote` routes the facet-target branch to `FacetState.perParticipant`; routes the proposal-target branch to the structural store.
- `handleCommit` routes the facet-target branch to `FacetState.committedAt` + `FacetState.committedCandidateValue`; routes the proposal-target branch to the structural store.
- `handleMetaDisagreementMarked` routes the facet-target branch to `FacetState.metaDisagreement = true`; routes the proposal-target branch to the structural store.
- New `handleWithdrawAgreement` adds the participant to the targeted facet's `withdrawals` set.

This task is the walker-side companion to `pf_projection_facet_status_refactor` (which defines the data structure + the derivation function). They could ship together as a single commit; the task is split out so the structural-data work can be reviewed independently of the per-event-kind dispatch routing.

## Why it needs to be done

[ADR 0030 Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): every event-handler in the replay walker that previously routed by proposal id needs to learn the new `target: 'facet' | 'proposal'` discriminator and dispatch accordingly. Inline-wording / inline-shape capture also needs the walker to populate `candidateValue` at creation time (not at a later proposal). Without the walker update, the new payload shapes are accepted by the schema layer but produce empty projections.

## Inputs / context

- [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) — current dispatcher.
- [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) — the `Projection` class methods the walker reads / writes.
- `pf_projection_facet_status_refactor` (sibling) — the structure this walker populates.
- `pf_structural_handlers_unchanged` (sibling) — the carve-out for the structural proposal sub-kinds.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every code path here gets a Vitest case.

## Constraints / requirements

- Each handler is a pure function over `(projection, event) → ReplayResult`. No DB access. Existing testing pattern (`replay.test.ts`, `incremental.test.ts`) carries through; new cases land in `apps/server/src/projection/replay.test.ts` covering each routing branch.
- The `target: 'facet' | 'proposal'` discriminator on each payload drives the routing. Unknown target value throws `ReplayError` with a typed code (exhaustiveness check via `never`).
- For facet-valued proposal sub-kinds, the walker clears `FacetState.perParticipant` BEFORE applying the new candidate. The clear is part of the new-candidate semantics; without it, votes against the prior candidate stick to the new one (which is exactly the methodology bug ADR 0030 fixes).
- `handleWithdrawAgreement` is new. It takes `{ entity_kind, entity_id, facet, participant }`, resolves the `FacetState`, and adds `participant` to `FacetState.withdrawals`. It does NOT remove the participant's prior vote from `perParticipant` — the participant's most-recent vote is preserved as a historical fact; the derivation reads withdrawals separately.

## Acceptance criteria

- `handleNodeCreated` / `handleEdgeCreated` populate the inline-candidate facet value.
- `handleProposal` for the four facet-valued sub-kinds populates `candidateValue` + `candidateProposalEventId` AND clears `perParticipant`.
- `handleVote` / `handleCommit` / `handleMetaDisagreementMarked` route on `payload.target`.
- New `handleWithdrawAgreement` exists and writes to `FacetState.withdrawals`.
- `apps/server/src/projection/replay.test.ts` carries a case for every new code path; the existing `replay.test.ts` + `incremental.test.ts` cases that asserted the prior shape are revised against the new shape (per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), the revision is in-place, not throwaway).
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Walker is the right home for vote-reset-on-new-candidate**, per [ADR 0030 §7](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): "The reset is performed by the projection when it walks the proposal event; it does not need its own event kind."
- **Withdraw preserves the prior `agree` vote** in `perParticipant`. The participant's vote history is a historical fact; the derivation reads `withdrawals` to decide whether the facet is `withdrawn` regardless. (See the parallel "vote vs. withdrawal are distinct" decision in `pf_withdraw_agreement_event_kind`.)

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-23.

- Replay walker (`apps/server/src/projection/replay.ts`) accepts both `target: 'facet'` and `target: 'proposal'` arms across `handleVote`, `handleCommit`, and `handleMetaDisagreementMarked`. The facet-keyed arms write into the projection's per-`(entity, facet)` `FacetState` (`perParticipant` / `committedAt` + `committedCandidateValue` / `metaDisagreement`); proposal-keyed arms continue through the existing structural paths.
- `applyCommittedProposal` helper comment updated to reflect that the facet arm bypasses it (no structural mutation when the commit targets a facet).
- `withdraw-agreement` projection was already in place from `pf_projection_facet_status_refactor`; nothing further needed here.
- `apps/server/src/projection/replay.test.ts` grew 4 new describes / 8 new it cases — facet-keyed happy paths + missing-entity error cases + a mixed-arm replay end-to-end that pins `deriveFacetStatus` on top.
- `tests/behavior/projection/replay-mixed-arm.feature` (+ steps in `tests/behavior/steps/projection-replay-mixed-arm.steps.ts`) round-trips a mixed log (proposal-keyed + facet-keyed votes/commits + withdraw-agreement) through pglite.
- Projection is now ready for the downstream methodology-engine facet-keyed emission rewrite (`pf_vote_handler_facet_keyed`, `pf_commit_handler_facet_keyed`, `pf_meta_disagreement_handler_facet_keyed`) — those tasks flip the handler emission; the projection already projects what they emit.
- TODO markers paid down (4): `TODO(pf_vote_handler_facet_keyed)`, `TODO(pf_commit_handler_facet_keyed)`, `TODO(pf_meta_disagreement_handler_facet_keyed)` (replay-side), plus the `applyCommittedProposal` helper-signature comment. The handler-side markers in `apps/server/src/methodology/handlers/*.ts`, `apps/server/src/ws/broadcast/proposal-status.ts`, and UI consumers stay — they belong to the downstream handler tasks.
- Verification: `pnpm run check` green; `pnpm run test:smoke` 4299 passing (+8) / 2 skipped (carryover); `pnpm run test:behavior:smoke` 253 scenarios / 1746 steps (+1 / +8); `pnpm run test:e2e:smoke` 107 green (unchanged, 1.4m).
