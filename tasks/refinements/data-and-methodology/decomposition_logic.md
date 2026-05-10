# Decomposition logic — propose-side validator for the `decompose` proposal sub-kind

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.methodology_engine.decomposition_logic`
**Effort estimate**: 2d
**Inherited dependencies**: depends on `methodology_engine.agreement_state_machine` (the framework — `MethodologyAction`, `validateAction`, `RejectionReason`, the primitives — `requireParticipant`, `findProposal`, etc. — and the per-action-handler module shape factored out by `commit_logic`); siblings `commit_logic`, `withdrawal_logic`, and `meta_disagreement_logic` already landed (their patterns are the template). Concretely settled: the methodology framework, the placeholder `placeholderProposeHandler` (`apps/server/src/methodology/handlers/propose.ts`), the Zod `decomposeProposalSchema` in `packages/shared-types/src/events/proposals.ts` (enforces structural shape — 2..10 components, each with non-empty wording and a statement-kind classification), and the projection's read-side `replay.ts/applyCommittedProposal` `decompose` arm which flips `parent.visible = false` when a decompose commit lands.

## What this task is

Tighten the `propose` handler's `decompose` arm with the real methodology-engine validator. The placeholder propose handler currently emits one `proposal` event for *any* proposal payload that passes the universal checks (session match / sequence match / participant gate). The `decompose` arm needs four additional methodology-specific rules before that emission:

1. The `parent_node_id` references a node that exists in this session's projection.
2. The parent node is currently visible in the projection (a not-visible parent — already decomposed, restructured, or otherwise superseded per the visible-graph derivation in `docs/data-model.md` — can't be re-decomposed).
3. No other pending decompose proposal references the same `parent_node_id` (in-flight conflict).
4. The structural payload shape — `components.length ∈ [2, 10]`, each component's `wording` non-empty, each `classification` a valid `StatementKind` — is already enforced upstream by the Zod schema (`decomposeProposalSchema`, ADR 0021). The validator relies on that layering and does not re-check.

On `Valid` the handler emits exactly one `EventToAppend` of kind `proposal` whose payload is the matching `ProposalEnvelopePayload` (`{ proposal: action.proposal }`). On any rule failure the handler returns a typed `Rejected` with a `RejectionReason` that names the specific failure.

Scope is **propose-side only**. Decomposition's commit-time multi-event fan-out (creating the component nodes and including them into the session) is a separate concern that lives in `commit_logic` — see Open Questions below.

## Why it needs to be done

`docs/methodology.md` lines 136–155 settle decomposition as a **first-class methodological move** and the methodology's primary tool for resolving classification disputes: "Decomposition is a first-class methodological move, not a fallback. Anyone in the debate (the moderator or either debater) may call out that a statement is saying too much and propose breaking it down." The placeholder propose handler currently accepts decompose proposals against nonexistent parents, already-superseded parents, and parents that already have a competing decompose pending. Without this task, the API layer would write all those illegal proposals as if they were live; downstream consumers (commit, vote, the projection's read-side `applyCommittedProposal`) would then throw `ReplayError`s at commit time rather than the propose author hearing a clean methodology rejection at submission time.

The boundary is precise: this task validates the *intent* to propose a decomposition on the **write** side (does the request pass methodology rules?). The projection's `replay.ts/applyCommittedProposal` for `decompose` is the *structural-effect* path that runs at commit time (it flips `parent.visible = false`). The two layers don't overlap: this validator runs at propose time, and `applyCommittedProposal` runs at commit time after `commit_logic` has gated the commit.

Downstream consumers — `interpretive_split_logic` (next sibling task, structurally analogous to decompose) and the eventual commit-time component-node creation — depend on this rule set as the template they extend.

## Inputs / context

- [`docs/methodology.md`](../../../docs/methodology.md) — decomposition section (lines 136–155): "first-class methodological move," parent is removed and replaced with component nodes, each component's facets start in `proposed` and run through their own lifecycles. The recursion property (line 155): each component runs through the methodology again.
- [`docs/data-model.md`](../../../docs/data-model.md) — visible-graph derivation (lines 273–285): a node is visible iff `entity-included` has been committed AND the node has not been superseded by a subsequent committed `decompose` / `interpretive-split` / `edit-wording(restructure)` against this node. The "currently visible" check in rule 2 is exactly this predicate, read off the projection's `node.visible` field which `applyCommittedProposal` maintains.
- [`apps/server/src/methodology/types.ts`](../../../apps/server/src/methodology/types.ts) — `ProposeAction` envelope (`requester`, `sessionId`, `eventId`, `sequence`, `actor`, `createdAt`, `proposal`); `ValidationResult`; `RejectionReason`. The current union covers `'not-a-participant'`, `'illegal-state-transition'`, `'inapplicable-to-facet'`, etc.; this task adds **one** new value, `'target-entity-not-found'`, for rule 2's "parent_node_id doesn't reference any known node" case.
- [`apps/server/src/methodology/primitives.ts`](../../../apps/server/src/methodology/primitives.ts) — `requireParticipant`, `findProposal`. New primitives added here: `nodeIsVisible` (the check for rule 2) and `decomposeConflictsWith` (the check for rule 3).
- [`apps/server/src/methodology/handlers/propose.ts`](../../../apps/server/src/methodology/handlers/propose.ts) — the placeholder. The `decompose` arm becomes the real validator; the other ten sub-kinds stay on the universal-pass placeholder path until their sibling tasks land.
- [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) — `applyCommittedProposal`'s `decompose` case (lines 625–646) sets `parent.visible = false` on commit. This is the read-side complement; it runs *after* commit_logic gates the commit.
- [`packages/shared-types/src/events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts) — `decomposeProposalSchema` (lines 163–169): the structural shape — `parent_node_id: z.string().uuid()`, `components: z.array(proposalComponentSchema).min(2).max(10)`; `proposalComponentSchema`: `wording: z.string().min(1)`, `classification: statementKindSchema`. Per ADR 0021 (event_validation), the schema validates at the API-layer ingress before the methodology engine sees the action. The methodology validator relies on this layering.
- [`apps/server/src/methodology/handlers/commit.ts`](../../../apps/server/src/methodology/handlers/commit.ts), [`apps/server/src/methodology/handlers/markMetaDisagreement.ts`](../../../apps/server/src/methodology/handlers/markMetaDisagreement.ts) — sibling templates. Mirror the comment header style, the rule-evaluation order, and the rejection-builder pattern.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest for in-memory logic; Cucumber+pglite for at least one DB-driven scenario.

## Constraints / requirements

- The handler **does not write events**; it returns a `ValidationResult`. On `Valid` it emits exactly one `EventToAppend` of kind `proposal`.
- The handler **does not mint timestamps or ids**; the API layer mints `eventId` and `createdAt` before calling the engine.
- The handler **does not call `validateEvent`**; the API layer runs the structural validator (Zod) separately (ADR 0021). Methodology validation is on top of structural validation. The handler can rely on `components.length ∈ [2, 10]` and `wording: non-empty` being already-true.
- One new `RejectionReason` value (`'target-entity-not-found'`) is added to the union — additive, doesn't break existing handlers.
- Don't modify `apps/server/src/projection/*`. The projection's `applyCommittedProposal` decompose handler is stable; this task validates *before* commit (which is before that handler runs).
- Don't pre-empt the sibling tasks: `interpretive_split_logic` is the next sibling; its validator will be structurally analogous, but it owns its handler. The other propose sub-kinds (`classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`, etc.) stay on the placeholder until their own tasks land.
- Don't pre-empt commit-time multi-event emission for decompose; flag in Open Questions.
- Verifications per ADR 0022: Vitest at `apps/server/src/methodology/handlers/proposeDecompose.test.ts`; Cucumber + pglite scenarios at `tests/behavior/methodology/propose-decompose.feature` with step defs in `tests/behavior/steps/methodology-propose-decompose.steps.ts`.

## Acceptance criteria

- `apps/server/src/methodology/handlers/propose.ts` exports a default `Validator<ProposeAction>` that switches on `action.proposal.kind`. The `decompose` case dispatches to a new internal function `validateDecomposeProposal(projection, action)` (factored locally in `propose.ts` — small enough that a separate `proposeKinds/decompose.ts` module isn't yet warranted; sibling sub-kinds may force the factoring later). All other proposal sub-kinds fall through to the universal-pass placeholder path (build the same one-event envelope the placeholder always built).
- `validateDecomposeProposal` enforces in evaluation order:
  1. **Parent-node-exists check.** `projection.getNode(action.proposal.parent_node_id)` must return a record. → `'target-entity-not-found'` (new RejectionReason — see Decisions for justification).
  2. **Parent-node-visible check.** The node's `visible` field must be `true`. → `'illegal-state-transition'` with a `detail` naming the not-visible parent. (Reusing the umbrella `illegal-state-transition` value is the right choice here — see Decisions.)
  3. **Decompose-conflict check.** No other proposal currently in `pendingProposals` is a `decompose` against the same `parent_node_id`. → `'illegal-state-transition'` with a `detail` naming the conflicting pending proposal id.
  4. **Structural payload shape.** Already enforced by `decomposeProposalSchema` upstream — this validator does not re-check; the comment header documents the layering. The Vitest tests assert the Zod parse rejects 1- and 11-component arrays before they would reach the methodology engine.
- On `Valid` emit one `EventToAppendEnvelope<'proposal'>` whose payload is `{ proposal: action.proposal }`. Envelope fields are mirror-copied from the action.
- Two new primitives added to `apps/server/src/methodology/primitives.ts`:
  - `nodeIsVisible(projection, nodeId) → boolean`: returns true iff `projection.getNode(nodeId)` returns a node with `visible === true`. Tiny, but worth a name so the propose handler reads cleanly and so `interpretive_split_logic` reuses the same predicate.
  - `decomposeConflictsWith(projection, parentNodeId) → PendingProposal | null`: walks `projection.pendingProposals()` and returns the first pending proposal whose payload is `{ kind: 'decompose', parent_node_id: <match> }`. Returns null on no conflict. The handler uses the returned proposal's `proposalEventId` in the rejection detail.
- One new `RejectionReason` value: `'target-entity-not-found'`. Added to the union in `types.ts`. Reused by `interpretive_split_logic` (next sibling) and future structural-sub-kind validators (`break-edge`, `amend-node`, `axiom-mark`, etc.) that target an existing entity.
- `apps/server/src/methodology/index.ts` re-exports `nodeIsVisible` and `decomposeConflictsWith`.
- `apps/server/src/methodology/handlers/proposeDecompose.test.ts` covers:
  - Reject when `parent_node_id` refers to no node in the projection (reason `'target-entity-not-found'`, detail names the missing id).
  - Reject when the parent node exists but is not visible (reason `'illegal-state-transition'`, detail names the not-visible parent).
  - Reject when another decompose proposal against the same parent is in flight (reason `'illegal-state-transition'`, detail names the conflicting pending proposal id).
  - Accept a well-formed decompose proposal — assert `Valid.events` is one `proposal` event with `payload.proposal` deep-equal to the action's payload; envelope `id` / `sequence` / `actor` / `createdAt` / `sessionId` mirror the action.
  - Zod-layer assertion: `decomposeProposalSchema.safeParse` rejects a 1-component array and an 11-component array. The methodology validator is never reached for those cases per the layering. Documented in the test file's comment header.
- `tests/behavior/methodology/propose-decompose.feature` covers 3 DB-driven scenarios:
  1. Successful propose decompose — three participants joined, a node created and included, then a participant constructs a propose-decompose action → `Valid` with one `proposal` event.
  2. Reject for non-visible parent — three participants joined; a node created, included, then decomposed (parent visibility flipped via committed decompose); a participant attempts to re-decompose the now-invisible parent → `Rejected` with `'illegal-state-transition'`.
  3. Reject for unknown parent — three participants joined; no matching node created; a participant attempts to decompose a non-existent node id → `Rejected` with `'target-entity-not-found'`.
- Step defs in `tests/behavior/steps/methodology-propose-decompose.steps.ts`. Reuses `tests/behavior/support/event-rows.ts` and the shared `Then 'the validation result is Valid'` / `Then 'the validation result is Rejected with reason "..."'` steps from `methodology-engine.steps.ts` / `methodology-commit.steps.ts`.
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `decomposition_logic` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` end-to-end green.

## Decisions

- **Scope: propose-side only.** This task validates `propose decompose`. The commit-time multi-event emission (creating component nodes, including them into the session) is **not** in scope — see Open Questions. The simplest defensible scoping is "decomposition_logic owns the propose-side validation; the commit-side fan-out is `commit_logic`'s decompose path (which currently emits only the one commit event, and the projection's `applyCommittedProposal` decompose handler currently only flips `parent.visible = false` — the gap is real and is flagged in Open Questions)."
- **Rule set (numbered, in evaluation order).** Mirrors the sibling shape:
  1. **Parent-node-exists.** `projection.getNode(parent_node_id)` non-undefined. → `'target-entity-not-found'`.
  2. **Parent-node-visible.** Returned node's `visible === true`. → `'illegal-state-transition'`.
  3. **No conflicting decompose pending.** No other pending proposal in `pendingProposals` is a decompose against the same `parent_node_id`. → `'illegal-state-transition'`.
  4. (Structural shape — enforced upstream by Zod.)
- **New RejectionReason `'target-entity-not-found'`.** Considered alternatives:
  - **`'proposal-not-found'`** — the existing union value. *Rejected.* That value is for "this proposal id doesn't reference a known proposal" — it's a methodology-layer concept (vote / commit / mark-meta-disagreement reference an existing proposal). Decompose's parent is a different referent kind (an entity, not a proposal); reusing this value would be a category error and would confuse future readers debugging rejection logs.
  - **`'inapplicable-to-facet'`** — *Rejected.* That value is for "this proposal targets a facet that doesn't exist on the entity kind" — semantically wrong for "the entity itself doesn't exist."
  - **`'illegal-state-transition'`** — the umbrella value. *Rejected* for this specific failure but reused for rules 2 and 3. Rule 1's failure is structurally different: "the referent doesn't exist" is a referential check, not a state-machine transition. The umbrella value reads correctly for rules 2 and 3 (the parent is in a state — superseded; or another decompose is in flight — that blocks the requested transition), but for rule 1 the umbrella is honest only if there's no tighter name.
  - **New value `'target-entity-not-found'`** — *Chosen.* Specific to "the proposal payload references an entity-id that doesn't exist in the projection." Sibling validators that take an entity-id payload (`break-edge` for `edge_id`, `amend-node` and `axiom-mark` for `node_id`, `annotate` for `target_id`) will reuse this value. Additive change to the union; doesn't break existing handlers; carries a precise meaning.
- **Rule 2 reason: `'illegal-state-transition'`.** The not-visible-parent case is naturally framed as "the parent is in a state (superseded) that the decompose can't transition out of." The existing umbrella value is the right level of specificity here — minting `'parent-not-visible'` would be over-specific and would proliferate at the next sub-kind.
- **Rule 3 reason: `'illegal-state-transition'`.** Same umbrella: another pending decompose against the same parent is "an in-flight transition that this one would clobber." Detail names the conflicting proposal id so the API layer can surface "wait for {id} to resolve first" or "withdraw {id} before re-proposing." Considered minting `'conflicting-pending-proposal'`; rejected as premature specificity. If multiple sibling validators need the same shape, the case for a dedicated value strengthens; for now the umbrella works.
- **Structural shape is upstream's concern.** The Zod schema in `decomposeProposalSchema` (lines 163–169 of `packages/shared-types/src/events/proposals.ts`) enforces:
  - `components: z.array(proposalComponentSchema).min(2).max(10)` — the 2..10 bound (R27).
  - `proposalComponentSchema.wording: z.string().min(1)` — non-empty wording.
  - `proposalComponentSchema.classification: statementKindSchema` — valid statement kind.
  Per ADR 0021 the validator runs at the API ingress before the methodology engine sees the action. The methodology validator relies on this layering and does not re-check. The Vitest test file asserts this layering by calling `decomposeProposalSchema.safeParse` directly on the 1-component and 11-component cases and confirming `success === false`.
- **Where the handler lives.** `propose.ts` itself, factored locally as `validateDecomposeProposal(projection, action)`. Reasons: (1) the rule set is small (three checks); (2) the placeholder propose handler is currently a single short function, and inlining a switch in it keeps the per-sub-kind dispatch close to the placeholder for the other ten sub-kinds; (3) the next sibling (`interpretive_split_logic`) will write `validateInterpretiveSplitProposal` in the same file, mirroring the same switch arm. If the file grows past ~300 lines as more sub-kinds land, factor into `apps/server/src/methodology/handlers/proposeKinds/<sub-kind>.ts` — same factoring pattern `commit_logic` applied to the action handlers.
- **New primitives.** `nodeIsVisible(projection, nodeId)` and `decomposeConflictsWith(projection, parentNodeId)` are added to `primitives.ts`. Reasons: (1) `interpretive_split_logic` will reuse `nodeIsVisible` (an interpretive-split also requires a visible parent); (2) `decomposeConflictsWith` is the model for `interpretiveSplitConflictsWith` (next sibling); (3) the propose handler reads more cleanly with named primitives than with an inline `projection.getNode(id)?.visible !== true` check.
- **Read-side `decomposeConflictsWith` semantics.** Walks `projection.pendingProposals()` (not `committedProposals` or `unresolvedMetaDisagreements`). A *committed* decompose against the same parent will have already flipped `parent.visible = false`, so rule 2 catches that case structurally. A *meta-disagreement-marked* decompose can't currently exist (the structural-sub-kind boundary in `meta_disagreement_logic` rejects mark attempts on `decompose` proposals with `'illegal-state-transition'`) — but if a future task widens that gate, the conflict check stays correct: a meta-disagreed decompose isn't in flight any more, so it doesn't conflict. The pending-only walk is right.
- **Boundary with the projection's existing decompose handling.** `applyCommittedProposal`'s `decompose` arm (lines 625–646 of `replay.ts`) is the **read-side structural effect** that runs *at commit time* — it flips `parent.visible = false`. **Our validator runs at propose time, before commit**, gating whether the proposal is *legal to append*. The two layers don't overlap: this validator does not touch projection state, and the projection handler does not re-validate methodology rules.
- **Boundary with `commit_logic` for decompose commits.** `commit_logic`'s rule 4 currently rejects commits of structural sub-kinds (including `decompose`) with `'illegal-state-transition'` and a sub-kind-naming detail (commit_logic doesn't know how to validate per-participant unanimity for sub-kinds that don't write to `perParticipant`). That gating means a decompose proposal, once landed, cannot currently be committed. This task does **not** lift that block — it stays scoped to propose-side validation. Lifting the block is a separate refinement question (one of: tighten commit_logic with a per-sub-kind branch; have decomposition_logic register its own commit-side validator; require participant agreement to be tracked on a different projection structure for structural sub-kinds). Flagged in Open Questions; settling it is the next iteration's call.
- **No fan-out of component-node events at propose time.** The propose handler emits one `proposal` event. Even if the propose is eventually committed and decomposition needs to create component nodes (one `node-created` per component + one `entity-included` per component), those events are emitted at *commit* time, not propose time. The propose-side validator's only output is the proposal envelope.
- **Test layout.** Vitest at `apps/server/src/methodology/handlers/proposeDecompose.test.ts` (new file, not extending the placeholder's tests — those live in `engine.test.ts` and stay there for the other sub-kinds). Cucumber + pglite at `tests/behavior/methodology/propose-decompose.feature` with step defs in `tests/behavior/steps/methodology-propose-decompose.steps.ts`. Reuses `event-rows.ts` and the shared Then steps.

## Open questions

- **Commit-time multi-event emission for decompose.** When a decompose proposal eventually commits, the methodology needs N `node-created` events (one per component) + N `entity-included` events + one `commit` event. The current shape of the system:
  - `commit_logic`'s rule 4 rejects commits of structural sub-kinds (including `decompose`) with `'illegal-state-transition'`. So a decompose can't currently be committed.
  - The projection's `applyCommittedProposal` decompose handler (lines 625–646 of `replay.ts`) only flips `parent.visible = false`; it expects component nodes to arrive via their own `node-created` events emitted by the methodology engine.
  - Neither layer currently emits those component-creation events.

  The gap is real. Three resolution paths:

  - **(P1)** `commit_logic` grows a per-sub-kind branch for `decompose` that emits the proposal's component-creation events alongside the `commit` event. This belongs in `commit_logic` because it's a commit-time emission concern. The branch reads the pending decompose proposal's `components` array and emits one `node-created` + one `entity-included` per component, plus the `commit` event.
  - **(P2)** `decomposition_logic` registers a commit-side validator (parallel to its propose-side validator) that owns the commit-time fan-out for `decompose` proposals. The framework would need a per-sub-kind commit-handler registry (analogous to the per-action-kind handler registry). More machinery; cleaner separation.
  - **(P3)** The component-node creation happens via a sequence of follow-up proposals (one `propose node-created` + `propose entity-included` per component, each requiring its own agreement). This matches the methodology's "each component's facets start as proposed" reading, but multiplies the agreement burden N-fold.

  The current task does not settle this — it's flagged for the next iteration to resolve, likely in a `decomposition_commit_logic` follow-up or by amending `commit_logic`. For now the gap means a decompose proposal lands but cannot be committed; the integration tests in this task cover only the propose-side path and assert nothing about commit.

(All other questions settled.)

## Status

**Done** 2026-05-10.

Implementation:

- `apps/server/src/methodology/handlers/propose.ts` — the propose handler now switches on `action.proposal.kind`. The `decompose` arm dispatches to a local `validateDecomposeProposal(projection, action)` that enforces the three rules in order; on `Valid` the handler emits one `EventToAppendEnvelope<'proposal'>`. The other ten sub-kinds fall through to the universal-pass placeholder emission. The export name `placeholderProposeHandler` is preserved as an alias for `proposeHandler` so the engine's `installHandlers` and the handlers barrel don't need to churn ahead of sibling sub-kind tasks.
- `apps/server/src/methodology/primitives.ts` — two new primitives: `nodeIsVisible(projection, nodeId) → boolean` (predicate for rule 2) and `decomposeConflictsWith(projection, parentNodeId) → PendingProposal | null` (the pending-only walk for rule 3).
- `apps/server/src/methodology/types.ts` — one new `RejectionReason` value: `'target-entity-not-found'`. Additive; reused by future propose-sub-kind validators (`interpretive_split_logic` next).
- `apps/server/src/methodology/index.ts` — barrel re-exports `nodeIsVisible` and `decomposeConflictsWith`.
- `tasks/10-data-and-methodology.tji` — `complete 100` and `note "Refinement: ..."` added to `decomposition_logic`.

Tests:

- `apps/server/src/methodology/handlers/proposeDecompose.test.ts` — 9 cases covering the three rules + the accept path (with both 2-component and 10-component payloads) + the Zod-layer layering pin (1-component, 11-component, empty-wording cases all reject at `decomposeProposalSchema.safeParse`).
- `tests/behavior/methodology/propose-decompose.feature` — 3 DB-driven scenarios: (1) propose decompose against a visible parent → `Valid` with one proposal event whose payload mirrors the action; (2) propose decompose against an unknown node → `Rejected` with `'target-entity-not-found'`; (3) propose decompose against a previously-decomposed parent → `Rejected` with `'illegal-state-transition'`.
- Step defs in `tests/behavior/steps/methodology-propose-decompose.steps.ts`. Reuses `tests/behavior/support/event-rows.ts` for row helpers and writes to the shared `scratch['methodologyResult']` key so the existing `Then 'the validation result is Valid'` / `Then 'the validation result is Rejected with reason "..."'` steps from `methodology-engine.steps.ts` / `methodology-commit.steps.ts` match.

`pnpm run test:smoke` green (370 tests, +9 over the prior 361 baseline). `pnpm run test:behavior:smoke` green (65 scenarios, +3 over the prior 62 baseline). `make test` end-to-end green (vitest + cucumber + playwright). `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent. `pnpm run typecheck` clean.
