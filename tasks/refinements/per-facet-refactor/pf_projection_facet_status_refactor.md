# Server projection: facet-status refactor

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.projection.pf_projection_facet_status_refactor`
**Effort estimate**: 2d
**Inherited dependencies**: `pf_withdraw_agreement_event_kind`, `pf_facet_keyed_vote_payload`, `pf_facet_keyed_commit_payload`, `pf_facet_keyed_meta_disagreement_payload`, `pf_awaiting_proposal_facet_status`.

## What this task is

Rewrite [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts) and its supporting projection state to key per-`(entity_kind, entity_id, facet)`. The candidate value for a facet is derived from either an inline carriage (`node-created.wording`, `edge-created.shape`) **or** the latest proposal targeting the facet (`classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`). Per-participant votes attach to the `(entity, facet)` pair (not to a proposal id). A new candidate clears prior votes on the facet. The seven-rule derivation table from the existing implementation widens with an `awaiting-proposal` rule for facets with no candidate yet. `withdraw-agreement` events flip the derived status to `withdrawn`.

Both client-side mirrors (`apps/moderator/src/graph/facetStatus.ts` and `apps/participant/src/graph/facetStatus.ts`) follow the same shape change.

## Why it needs to be done

Per [ADR 0030 §7 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): "When the projection walks a new facet-valued proposal event, it clears the prior `perParticipant` vote map on that facet before recording any subsequent votes against the new candidate." The current projection holds votes against the proposal id (via `committedProposalEventId` on `FacetState`); facet-keying changes the data structure. The derivation logic stays shape-wise similar (the seven rules), but reads new fields and gains an eighth condition (`awaiting-proposal`).

## Inputs / context

- [ADR 0030 §2, §7, §10 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts) — current `deriveFacetStatus` implementation (rules 1–7).
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) — `FacetState`, `PerParticipantFacetState`, `CommittedProposalRecord`. `FacetState.committedProposalEventId` and the parallel `committedProposals` map are no longer the right shape for the facet-keyed flow per ADR 0030 Consequences — what the projection tracks now is "has this facet's *current candidate value* been committed?" rather than "has this specific proposal id been committed?". `FacetState` grows fields the new derivation reads: a current `candidateValue`, the proposal-event-id (if any) that supplied it, a committed marker tied to the candidate rather than to a specific proposal id.
- [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) — `handleVote`, `handleCommit`, `handleMetaDisagreementMarked`, `handleNodeCreated`, `handleEdgeCreated` — all touched (`pf_projection_replay_updates` covers the replay walker; this task covers the data-structure + derivation changes).
- [`tasks/refinements/data-and-methodology/per_facet_status_derivation.md`](../data-and-methodology/per_facet_status_derivation.md) — historical record of the original derivation (do not edit).
- [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts), [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) — moderator + participant mirrors that follow the same shape change.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest delta + a Cucumber + pglite integration scenario for the new shape.

## Constraints / requirements

- `FacetState` shape carries: `candidateValue: T | null` (the current candidate), `candidateProposalEventId: string | null` (the proposal that supplied it, if any — `null` for inline-from-creation), `committedAt: string | null`, `committedCandidateValue: T | null` (the value at commit time — used to detect "is the current candidate still the committed one or has a new proposal superseded?"), `perParticipant: Map<participantId, { choice: 'agree' | 'dispute', votedAt: string }>`, `metaDisagreement: boolean`, `withdrawals: Set<participantId>` (or equivalent — withdrawals are per-participant marks on the facet, independent of the current vote-choice map).
- Inline-candidate semantics: when `node-created` lands, `wordingFacet.candidateValue` is set to `payload.wording`; `candidateProposalEventId` stays `null` (no proposal supplied it). When `edge-created` lands, `shapeFacet.candidateValue` is set to `{ role, source_id, target_id }` (the shape carriage); `candidateProposalEventId` stays `null`. Both `classification` and `substance` facets stay with `candidateValue: null` after `node-created` — those facets are `awaiting-proposal` until a `classify-node` / `set-node-substance` proposal lands.
- Vote-handler refactor: routes the facet-target vote to the facet's `perParticipant` map; routes the proposal-target vote (structural proposals) to the existing proposal-keyed structure. Strictly distinct paths.
- Commit-handler refactor: facet-target commit records `committedAt` + `committedCandidateValue` on the facet; proposal-target commit keeps the existing structural-commit path (see `pf_structural_handlers_unchanged`).
- Withdraw-agreement handler: adds the participant to the facet's `withdrawals` set. The derivation rule for `withdrawn` reads off this set.
- Vote-reset-on-new-candidate: when a new facet-valued proposal lands on an already-populated facet (e.g. a second `classify-node` after the first was disputed and replaced), the projection clears `FacetState.perParticipant` before accepting any subsequent votes against the new candidate. Implementation: in `handleProposal`'s facet-valued branches, set `candidateValue` from the new payload, set `candidateProposalEventId` to the new proposal's id, and clear `perParticipant`.
- Derivation rules (revised, in priority order):
  1. If `FacetState.metaDisagreement === true` → `'meta-disagreement'`.
  2. If `candidateValue === null` → `'awaiting-proposal'`.
  3. Filter `perParticipant` by current participants (`leftAt === null`).
  4. If any current participant is in the facet's `withdrawals` set AND `committedAt !== null` → `'withdrawn'`.
  5. If any current participant's most-recent vote is `'dispute'` → `'disputed'`.
  6. If `committedAt !== null` AND no current participant has overturned via dispute or withdraw → `'committed'`.
  7. If at least one current participant has voted AND every current participant has voted `'agree'` → `'agreed'`.
  8. Otherwise → `'proposed'`.
- Verifications per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): Vitest cases at `apps/server/src/projection/facet-status.test.ts` cover all eight rules plus the `awaiting-proposal` → `proposed` transition when a proposal lands; at least one Cucumber + pglite scenario covers `awaiting-proposal` → `proposed` → `agreed` → `committed` → `withdrawn` round through real DB-stored events.
- Mirror change in `apps/moderator/src/graph/facetStatus.ts` + `apps/participant/src/graph/facetStatus.ts` (same shape + same derivation rules). The two client-side mirrors carry their own tests in their respective packages.

## Acceptance criteria

- `FacetState` shape carries `candidateValue`, `candidateProposalEventId`, `committedAt`, `committedCandidateValue`, `perParticipant`, `metaDisagreement`, `withdrawals` (or close cousins by name; this refinement settles structure, not bikeshed).
- `deriveFacetStatus(projection, entityKind, entityId, facet) → FacetStatus` covers all eight rules.
- `apps/server/src/projection/facet-status.test.ts` updated; the historical 15 cases are revised against the new shape, and new cases cover `awaiting-proposal` plus the new `withdraw-agreement` event-driven path.
- Moderator + participant `facetStatus.ts` mirrors carry the same shape and pass their own per-package Vitest suites.
- At least one new Cucumber + pglite scenario in `tests/behavior/projection/` exercises the full `awaiting-proposal → proposed → committed → withdrawn` round through real DB-stored events.
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Inline candidate value lives on the facet, not on the entity row.** The reason: the derivation already needs to know "what candidate is active right now"; carrying it on `FacetState` keeps the derivation a pure function over `FacetState` + the current participants list. Reading it off `nodes.wording` (or wherever the entity row eventually materializes) would couple the derivation to the entity layer and re-introduce the "wording is voteless until edit-wording" bug ADR 0030 is fixing.
- **Withdrawals are a per-facet `Set<participantId>`** rather than a per-participant slot on `perParticipant`. The reason: a withdrawal is a distinct gesture from a vote (different event kind, different semantics — withdraw flips a committed facet back to disputed). Keeping it in its own set makes the derivation logic explicit (rule 4 reads `withdrawals`; rule 5 reads `perParticipant`).
- **Vote reset is performed by the projection at proposal landing**, not by a separate event kind. Per [ADR 0030 §7](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md). A new facet-valued proposal supersedes the old candidate; the prior `perParticipant` map's contents were votes against the old candidate and don't carry over.
- **Edge `shape` facet now has a `FacetState`** (was previously implicit per the prior derivation refinement). Per [ADR 0030 §5](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): edge shape lives inline on `edge-created`; the facet enters life `proposed` (votes can accrue) and follows the same lifecycle as `wording`. The earlier "not applicable in v1" carve-out at [`facet-status.ts:67`](../../../apps/server/src/projection/facet-status.ts) goes away.
- **No methodology-engine-level validation in this task.** Sequence-gate enforcement is `pf_sequence_gate_server_enforced`; withdraw-only-after-commit is the methodology engine's responsibility. This task is data-structure + derivation only.

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-23.

- `FacetState` re-keyed to `(entity_kind, entity_id, facet)` per ADR 0030 §7 + §10 in [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts); fields carry `candidateValue`, `candidateProposalEventId`, `committedAt`, `committedCandidateValue`, `perParticipant`, `metaDisagreement`, `withdrawals`. `ProjectedEdge.shapeFacet` added alongside `EdgeShape`.
- Inline-candidate semantics: `node-created.wording` populates `wordingFacet.candidateValue`; `edge-created` shape populates `shapeFacet.candidateValue` — both with `candidateProposalEventId = null`. Implemented in [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) and the proposal-landing branches of [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) (vote-reset on each new candidate; commit stamps `committedCandidateValue`; meta-disagreement flips the `metaDisagreement` flag; per-component fan-out for `decompose` / `interpretive-split`).
- New `withdraw-agreement` projection handler ([`replay.ts handleWithdrawAgreement`](../../../apps/server/src/projection/replay.ts)) adds the participant to `FacetState.withdrawals`; eight-rule derivation in [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts) covers all rules including `awaiting-proposal` (rule 2) and `withdrawn` (rule 4). Vitest cases revised + property-style additions in [`facet-status.test.ts`](../../../apps/server/src/projection/facet-status.test.ts) and [`active-firing.test.ts`](../../../apps/server/src/projection/active-firing.test.ts).
- Client mirrors follow the same 8-rule derivation: [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) + matching test (withdraw-agreement helper), [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) + matching test. Provisional consumers from prior tasks pay down their `TODO(pf_projection_facet_status_refactor)` markers: [`disputationOutcome.ts`](../../../apps/moderator/src/graph/disputationOutcome.ts), [`proposalFacets.ts`](../../../apps/moderator/src/graph/proposalFacets.ts), [`StatementNode.tsx`](../../../apps/moderator/src/graph/StatementNode.tsx) rollup priority, [`packages/shell/src/facet-pill/`](../../../packages/shell/src/facet-pill/), [`apps/server/src/diagnostics/pending-consequences.ts`](../../../apps/server/src/diagnostics/pending-consequences.ts), and [`apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx`](../../../apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx). Net 6 TODO markers paid down; 0 new TODOs added.
- New Cucumber + pglite feature [`tests/behavior/projection/facet-status-facet-keyed.feature`](../../../tests/behavior/projection/facet-status-facet-keyed.feature) covers the `awaiting-proposal → proposed → agreed → committed → withdrawn` round; two generalized Then steps added to [`tests/behavior/steps/projection-facet-status.steps.ts`](../../../tests/behavior/steps/projection-facet-status.steps.ts). Predecessor task's withdraw-after-commit assertion in [`facet-status.feature`](../../../tests/behavior/projection/facet-status.feature) tightened to `'withdrawn'` (the projection-side handler is part of this task).
- Verification gates: Vitest 4288 → 4291 (+3, 2 skipped carryover); Cucumber 249 → 252 scenarios (+3), 1715 → 1738 steps (+23); Playwright 107 → 107 (unchanged, 1.4m). All four suite gates green.
