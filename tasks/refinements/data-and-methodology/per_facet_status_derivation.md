# Derive per-facet overall status from per-participant votes + commits

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.projection.per_facet_status_derivation`
**Effort estimate**: 2d
**Inherited dependencies**: `projection_data_structure` (settled — `FacetState`, `PerParticipantFacetState`, the `Projection` class). De-facto also depends on `project_from_log` and `project_incrementally` (the per-event handlers exist; this task tightens vote/commit/meta-disagreement-marked handlers to actually populate per-participant per-facet state).

## What this task is

Expose the *derived* overall status of an `(entity, facet)` pair as a clean, testable function over the projection. The data is already in the projection — per-participant votes accrue on `FacetState.perParticipant`, commit lands a commit marker, meta-disagreement-marked sets a facet-level mark — and the derivation reads those plus the current participants list to return one of: `proposed`, `agreed`, `disputed`, `committed`, `withdrawn`, `meta-disagreement`.

The task has two halves:

1. **Tighten the dispatcher** so per-participant per-facet state and the commit marker actually flow into the projection (the prior `project_from_log` / `project_incrementally` tasks left this deferred — `handleVote` was a referential-check-only stub; `handleCommit` set `FacetState.status='agreed'` and the value, but did not record the commit-event id; `handleMetaDisagreementMarked` did not transition the affected facet to `meta-disagreement`).

2. **Implement `deriveFacetStatus`** as a pure read function over the populated projection.

## Why it needs to be done

`docs/methodology.md` — Agreement rule + commit step + withdrawal:

> A facet advances to `agreed` only when every current participant is voting `agree` *and* the moderator commits.
> A participant may withdraw agreement they previously gave. An `agreed` facet transitions back to `disputed`; the original commit and the withdrawal are both recorded in the change history.
> When the diagnostic tests can't resolve a facet's dispute and decomposition can't either … the facet is marked as `meta-disagreement`.

Downstream consumers — the methodology engine (commit / withdrawal validation: "moderator can only commit an `agreed` facet"; "withdrawal is only valid against a participant's prior `agree` on a committed proposal"), the moderator UI (renders the badge for each facet), the audience broadcaster, the `active_firing_computation` task (`edge.substance ∧ source.substance` for active-firing requires reading per-facet status) — all need a single, well-defined function for "what is this facet's current overall status?". Rolling the derivation locally at every call site would scatter the truth and drift; centralizing it in `deriveFacetStatus` pins the contract.

## Inputs / context

- [`docs/methodology.md`](../../../docs/methodology.md) — agreement state machine, commit step, withdrawal rule, meta-disagreement fallback.
- [`docs/data-model.md`](../../../docs/data-model.md) — facet vocabulary: nodes have `wording`, `classification`, `substance`; edges have `shape`, `substance`; annotations have `wording`, `substance`. Edges have no `wording` facet (structural). The `shape` facet on edges is implicit in the projection — an edge's shape is the role + endpoints fixed at `edge-created` time; the methodology's "shape facet" maps to no separately-tracked `FacetState` in v1 (no proposal sub-kind targets it; if a participant disputes the shape, the methodology engine handles it via `break-edge` + a fresh `edge-created`). This task's derivation supports the facets that have a `FacetState` in the projection: node `classification`, node `substance`, node `wording`, edge `substance`, annotation `wording`, annotation `substance`.
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) — `FacetState`, `PerParticipantFacetState`, the existing `FacetStatus` union, `ProjectionChange`.
- [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) — the dispatcher; `handleVote`, `handleCommit`, `handleMetaDisagreementMarked` are tightened in this task.
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) and [`events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts) — `VotePayload`, `CommitPayload`, `MetaDisagreementMarkedPayload`, the eleven proposal sub-kinds.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check is a committed test. Two layers: Vitest for the in-memory derivation; Cucumber + pglite for at least one integration scenario through real DB-stored events.

## Constraints / requirements

- Pure read function; no DB access; no side effects on the projection. The dispatcher tightening that makes per-participant state actually populate is part of this task but lives in `replay.ts` (not in the new `facet-status.ts` file).
- The `FacetStatus` enum changes are **additive**: existing variants (`proposed`, `agreed`, `disputed`, `meta-disagreement`) keep their meaning; new variants (`committed`, `withdrawn`) are added. The existing `replay.test.ts` and `incremental.test.ts` assertions over `FacetState.status` must continue to pass — i.e. `FacetState.status` itself remains `'agreed'` after a commit (the underlying agreement state); the *derived* status from `deriveFacetStatus` is what reports `committed`. Distinguishing the two layers (raw agreement state on the FacetState vs. derived overall status from `deriveFacetStatus`) avoids breaking existing assertions and matches the methodology's framing — "committed" is a higher-order fact about a facet that has been agreed AND committed.
- Withdrawal of a previously-`agree`'d vote on a committed proposal transitions the derived status. Methodology says "agreed → disputed" structurally; the derivation reports `withdrawn` (more precise — preserves the historical fact that the facet was once committed). The methodology engine's downstream validators distinguish "naturally disputed" from "withdrawn" via this status if it cares; for "is this facet currently blocking forward progress?" the consumer treats `withdrawn` and `disputed` identically.
- Per-participant votes must be recorded against a `(entity, facet)` pair on the projection by the vote handler. Today's `handleVote` is referential-check-only; this task tightens it for the four facet-targeting proposal sub-kinds (`classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording` reword/restructure). For proposal sub-kinds that aren't facet-targeting (`axiom-mark`, `decompose`, `interpretive-split`, `meta-move`, `break-edge`, `amend-node`, `annotate`), votes are still validated against pending/committed proposals but no per-facet state is written — those proposals are structural and downstream tasks (`agreement_state_machine`, `decomposition_logic`, etc.) own their per-participant state.
- The commit handler records the commit-event id on the affected facet so the derivation can identify "was committed once" without re-walking the log. A separate `committedProposals` map on the projection lets the vote handler resolve `withdraw` votes against proposals that have already left `pendingProposals`.
- The meta-disagreement-marked handler transitions the affected facet's `FacetState.status` to `'meta-disagreement'` for the four facet-targeting proposal sub-kinds (mirrors the commit handler's per-sub-kind dispatch).
- Verifications per ADR 0022: Vitest unit tests at `apps/server/src/projection/facet-status.test.ts` for the in-memory derivation logic; one Cucumber + pglite scenario (committed-then-withdrawn round through real DB-stored events) at `tests/behavior/projection/facet-status.feature`.

## Acceptance criteria

- `apps/server/src/projection/facet-status.ts` exports `deriveFacetStatus(projection, entityKind, entityId, facet): FacetStatus`.
- `apps/server/src/projection/types.ts` exports the widened `FacetStatus` union (`'proposed' | 'agreed' | 'disputed' | 'committed' | 'withdrawn' | 'meta-disagreement'`); `FacetState` carries `committedProposalEventId: string | null` and `committedAt: string | null`; a `CommittedProposalRecord` interface is added for the `committedProposals` map.
- `apps/server/src/projection/projection.ts` extends `Projection` with `addCommittedProposal`, `getCommittedProposal`, `committedProposals` (iterator), `committedProposalCount`. The `handleCommit` dispatcher in `replay.ts` populates this map.
- `apps/server/src/projection/replay.ts` — `handleVote`, `handleCommit`, `handleMetaDisagreementMarked` tightened per the Decisions below. Per-participant per-facet state populates for the four facet-targeting proposal sub-kinds. The four existing `replay.test.ts` / `incremental.test.ts` shape assertions continue to hold.
- `apps/server/src/projection/index.ts` re-exports `deriveFacetStatus`, `CommittedProposalRecord`.
- `apps/server/src/projection/facet-status.test.ts` covers: empty/unvoted facet → `proposed`; partial-agree → `proposed`; all-agree → `agreed`; one-dispute → `disputed`; agreed → committed → `committed`; committed → withdraw → `withdrawn`; meta-disagreement-marked on the affected facet → `meta-disagreement`; participant-leaves-after-vote → vote no longer counts; property-style: random vote sequences against a fixed participant set + sometimes-commits, derived status matches a hand-rolled reference implementation in the test file.
- `tests/behavior/projection/facet-status.feature` (+ `tests/behavior/steps/projection-facet-status.steps.ts`) has at least two scenarios: classify-node round through real DB events arrives at `committed`; withdrawal after commit reverts to `withdrawn`/`disputed`.
- `pnpm run test:smoke` green (vitest delta = +N for `facet-status.test.ts`); `pnpm run test:behavior:smoke` green; `make test` end-to-end green; `tj3 project.tjp` parses clean.

## Decisions

- **Where the derivation lives.** New file `apps/server/src/projection/facet-status.ts`. Companion to `replay.ts` / `incremental.ts` / `projection.ts` — same module shape, single export `deriveFacetStatus`. Keeps the read-only derivation separate from the event-handling dispatcher.
- **Function signature.** `deriveFacetStatus(projection, entityKind, entityId, facet) → FacetStatus`. `entityKind` is `'node' | 'edge' | 'annotation'`; `facet` is the facet name (`'classification' | 'substance' | 'wording'`). Returns the derived status. Throws `FacetStatusDerivationError` if the entity is missing or the facet isn't applicable to the entity kind (edges have no `wording` / `classification`; annotations have no `classification`). Pragmatic: the consumer is supposed to know the entity exists; an explicit throw on a typo'd id is more useful than a silent fallback.
- **`FacetStatus` enum (final, additive).** `'proposed' | 'agreed' | 'disputed' | 'committed' | 'withdrawn' | 'meta-disagreement'`. The existing four variants keep their semantics on `FacetState.status`; the two new variants (`committed`, `withdrawn`) appear only as outputs of `deriveFacetStatus`. `FacetState.status` itself stays in the agreement-layer four-element subset (the dispatcher writes those values; existing tests assert them). The richer six-element enum is a derived view; it does NOT widen what the dispatcher writes onto `FacetState.status`. (`meta-disagreement` IS written onto `FacetState.status` by the new meta-disagreement-marked handler — this is a backward-compatible change because the prior dispatcher never wrote it but the type already permitted it.)
- **`FacetState` shape extension (additive).** Add `committedProposalEventId: string | null` (defaults `null`; set by `handleCommit` for facet-targeting sub-kinds) and `committedAt: string | null` (the commit event's `committed_at`, recorded for downstream observability — the methodology engine's withdrawal validator may want to know the commit moment). Storage-layer mutator stays compatible with the existing `emptyFacet<T>()` helper (the new fields default to `null`).
- **`CommittedProposalRecord` + `committedProposals` map.** New shape on the projection: `{ proposalEventId, payload: ProposalPayload, committedAt, moderator }`. Populated by `handleCommit`. Read by `handleVote` when a `withdraw` vote arrives — the proposal isn't in `pendingProposals` anymore, but the projection knows it was committed; the vote can resolve to `(entity, facet)` and update `FacetState.perParticipant`.
- **Vote-handler tightening.** `handleVote` now:
  1. Look up the proposal in `pendingProposals` first; fall back to `committedProposals` if not pending. Throw `ReplayError` if neither (proposal was never seen — referential bug).
  2. For the four facet-targeting proposal sub-kinds (`classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording` reword / restructure), record the vote on `FacetState.perParticipant`: `{ vote, proposalEventId, votedAt }`. The participant key is the vote's `participant`. Multiple votes from the same participant overwrite — the most recent vote is the participant's current stance (matches the change-history-as-source-of-truth model: the projection stores current stance; the log stores history).
  3. For other sub-kinds: no per-facet state write. The change-feed entry is unchanged.
- **Commit-handler tightening.** `handleCommit` now:
  1. Run the existing structural-commit dispatch (set `FacetState.status='agreed'`, set value, etc.).
  2. For facet-targeting sub-kinds, record `committedProposalEventId` and `committedAt` on the affected `FacetState`.
  3. Append a `CommittedProposalRecord` to `committedProposals`.
  4. Remove from `pendingProposals` (existing behavior).
- **Meta-disagreement-marked-handler tightening.** `handleMetaDisagreementMarked` now also (in addition to the existing pending-proposal-removal and unresolved-meta-disagreement record):
  1. For facet-targeting sub-kinds, set the affected `FacetState.status = 'meta-disagreement'` (the underlying agreement state). The derivation surfaces this directly. Mirrors the commit-handler's per-sub-kind dispatch.
- **Derivation rules (in priority order).**
  1. If the affected `FacetState.status === 'meta-disagreement'` → return `'meta-disagreement'`.
  2. Look at `FacetState.perParticipant` filtered by the projection's *current* participants (`leftAt === null`). Excluded participants don't count — methodology says "current participants" must agree; a left participant's vote is historical.
  3. If any current participant's most-recent vote is `'withdraw'` AND `FacetState.committedProposalEventId !== null` → return `'withdrawn'` (the facet was committed; a withdrawal supersedes the commit).
  4. If any current participant's most-recent vote is `'dispute'` → return `'disputed'`.
  5. If `FacetState.committedProposalEventId !== null` AND all current participants have voted `'agree'` (or no `'dispute'`/`'withdraw'` and at least the count is positive) → return `'committed'`. (More precisely: a commit happened and no current participant has overturned via dispute or withdrawal.)
  6. If at least one current participant has voted but no `'dispute'` / `'withdraw'` is outstanding AND every current participant has voted `'agree'` → return `'agreed'`.
  7. Otherwise (no votes recorded yet, or some current participants haven't voted) → return `'proposed'`.
- **Lazy / not memoized.** The derivation is O(participants) per call. The sibling task `projection_caching` addresses memoization across reads. For now: lazy. The function is pure — repeat calls are well-defined.
- **`handleVote` for `withdraw` against a non-committed proposal.** Per the methodology, withdraw is "only valid against an existing agree vote on a committed proposal." That validation lives in the methodology engine; this dispatcher records the participant's `'withdraw'` vote on the perParticipant map regardless. The derivation's `withdrawn`-vs-`disputed` distinction reads `FacetState.committedProposalEventId`: a withdraw without a prior commit is just a `disputed` outcome (rule 4 above triggers because `'withdraw'` is treated like `'dispute'` for facet status when no commit happened). The change-history record preserves the participant's actual vote enum; the projection's overall status is the one the consumer reads.
- **Edge `shape` facet not handled.** The data-model says edges have `shape` and `substance`; the projection only carries `substanceFacet` for edges (the shape — role + endpoints — is fixed at `edge-created` time and not separately tracked as a `FacetState` since no proposal sub-kind targets it). `deriveFacetStatus(projection, 'edge', edgeId, 'shape')` throws `FacetStatusDerivationError` ("not applicable in v1"). If a future feature adds a shape-edit proposal, the projection grows a `shapeFacet` and the derivation supports it then.
- **Annotation facets handled with the same shape as nodes.** `wording` and `substance` facets exist on annotations; the derivation function works for them via the same per-participant + commit-marker rules. (For v1 the `annotation_logic` task — methodology engine — owns the proposal sub-kinds that target them; this derivation is forward-compatible.)
- **No methodology-engine validation.** The derivation does not enforce "moderator can only commit an agreed facet" or "withdrawal is only valid against a committed-and-prior-agree." Those validations land in the methodology engine task. The derivation is consumed by it, not the reverse.

## Open questions

- **Is `withdrawn` a status the moderator UI distinguishes from `disputed`?** The methodology says withdrawal returns the facet to `disputed`, with the commit and the withdrawal both in change history. This task surfaces `withdrawn` as a richer status because the projection knows the facet was once committed, and the UI may want to render that distinction (e.g., "Disputed (was committed)"). If the UI ends up flattening to `disputed`, no harm done — the consumer treats `withdrawn` and `disputed` identically. (Judgment call: surface the distinction now; let the UI flatten if it doesn't want it.)
- **Should the `committedProposals` map cap its growth?** Sessions accumulate commits over their lifetime; the map grows without bound. For a v1 session of plausible length (hundreds of commits), the cost is negligible. If a long-running session ever hits memory pressure, pruning policies (drop committed proposals older than N events; persist to disk) become a follow-up; for now, unbounded map is fine. (Judgment call: documented; not optimized in this task.)

## Status

**Done** 2026-05-10.

Implementation:

- `apps/server/src/projection/facet-status.ts` — new file. Exports `deriveFacetStatus(projection, entityKind, entityId, facet): FacetStatus`, `FacetStatusDerivationError`, `DeriveEntityKind`. Pure read function over the projection per the seven-rule decision table in the Decisions section.
- `apps/server/src/projection/types.ts` — `FacetStatus` widened additively to `'proposed' | 'agreed' | 'disputed' | 'committed' | 'withdrawn' | 'meta-disagreement'`. `FacetState<T>` gained `committedProposalEventId: string | null` and `committedAt: string | null`. `CommittedProposalRecord` interface added.
- `apps/server/src/projection/projection.ts` — `Projection` extended with `addCommittedProposal`, `getCommittedProposal`, `committedProposals` (iterator), `committedProposalCount`. `emptyFacet<T>()` now initializes the two new fields to `null`.
- `apps/server/src/projection/replay.ts` — three handlers tightened:
  - `handleVote`: looks up the proposal in `pendingProposals` OR `committedProposals` (the latter handles `withdraw` votes that arrive after commit); for the four facet-targeting proposal sub-kinds (`classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording` reword/restructure) writes the vote into the affected `FacetState.perParticipant`.
  - `handleCommit`: in addition to the existing structural commit dispatch, records `committedProposalEventId` + `committedAt` on the affected `FacetState` for the four facet-targeting sub-kinds, and appends a `CommittedProposalRecord` to the projection's `committedProposals` map.
  - `handleMetaDisagreementMarked`: in addition to the existing pending-proposal-removal and unresolved-meta-disagreement record, sets the affected `FacetState.status = 'meta-disagreement'` for the four facet-targeting sub-kinds.
- `apps/server/src/projection/index.ts` — barrel re-exports `deriveFacetStatus`, `FacetStatusDerivationError`, `DeriveEntityKind`, `CommittedProposalRecord`.

Tests:

- `apps/server/src/projection/facet-status.test.ts` — 15 cases. Coverage: empty/unvoted facet (`proposed`), partial-agree (`proposed`), all-agree (`agreed`), one-dispute / all-dispute (`disputed`), all-agree + commit (`committed`), commit + withdraw (`withdrawn`), meta-disagreement-marked (`meta-disagreement`), participant leaves between vote and commit (vote no longer counts), withdraw without prior commit collapses to `disputed`, missing-entity / inapplicable-facet error paths (`FacetStatusDerivationError`), edge substance facet derivation through a full set-edge-substance round, and a property-style test that runs a deterministic mulberry32 PRNG over six seeds, generating 20 random actions per seed (vote / commit / leave / meta-disagreement) and cross-checking the derived status against a hand-rolled reference implementation after each action.
- `tests/behavior/projection/facet-status.feature` — 2 scenarios, step defs in `tests/behavior/steps/projection-facet-status.steps.ts`. Coverage: a classify-node round through real DB-stored events arrives at `committed`; a withdrawal after commit reverts the facet to `withdrawn`. Both round-trip events through pglite's `session_events` (JSONB / TIMESTAMPTZ / BIGINT) and call `deriveFacetStatus` against the resulting projection.

`pnpm run test:smoke` green (264 tests, +15 over the prior baseline of 249). `pnpm run test:behavior:smoke` green (47 scenarios, +2 over the prior baseline of 45). `make test` end-to-end green (264 unit + 47 cucumber + 1 playwright). `tj3 project.tjp` parses clean.

`tasks/10-data-and-methodology.tji` updated: `complete 100` and `note "Refinement: ..."` added to `per_facet_status_derivation`.
