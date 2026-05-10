# Meta-move logic — propose-side validator for the `meta-move` proposal sub-kind

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.methodology_engine.meta_move_logic`
**Effort estimate**: 1d
**Inherited dependencies**: depends on `methodology_engine.agreement_state_machine` (the framework — `MethodologyAction`, `validateAction`, `RejectionReason`, `requireParticipant`, etc.). Indirectly: `methodology_engine.decomposition_logic`, `interpretive_split_logic`, and `axiom_mark_logic` (the prior three propose-arm tightenings — their factoring (`validateXProposal(projection, action)` locals dispatched from `propose.ts`'s switch), their `nodeIsVisible` reuse, and their structural-shape-is-upstream's-concern layering decision are the templates this task extends). Concretely settled: the Zod `metaMoveProposalSchema` in `packages/shared-types/src/events/proposals.ts` (enforces structural shape per R28 — `{ kind: 'meta-move', meta_kind, content, target_kind, target_id }`); the projection's read-side `replay.ts/applyCommittedProposal` `meta-move` arm (currently a no-op — see Open Questions).

## What this task is

Tighten the `propose` handler's `meta-move` arm with the real methodology-engine validator. The propose handler currently dispatches `decompose`, `interpretive-split`, and `axiom-mark` to their real validators and lets the other eight sub-kinds — including `meta-move` — fall through to the universal-pass placeholder path. This task replaces the fall-through for `meta-move` with two methodology-specific rules, in evaluation order:

1. The `target_id` references an entity of the proposed `target_kind` that exists in this session's projection. Dispatched on `target_kind`:
   - `target_kind === 'node'`: `projection.getNode(target_id)` must be non-undefined.
   - `target_kind === 'edge'`: `projection.getEdge(target_id)` must be non-undefined.
2. The resolved entity is currently visible in the projection (`visible === true`). A meta-move on a superseded node or broken edge is meaningless — the annotation it creates would render against an entity nobody can see.
3. The structural payload shape — `kind: 'meta-move'`, `meta_kind ∈ {reframe, scope-change, stance}`, `content: string.min(1)`, `target_kind ∈ {node, edge}`, `target_id: UUID` — is already enforced upstream by the Zod schema (`metaMoveProposalSchema`, ADR 0021, refinement R28). The validator relies on that layering and does not re-check.

On `Valid` the handler emits exactly one `EventToAppend` of kind `proposal` whose payload is `{ proposal: action.proposal }`. On any rule failure the handler returns a typed `Rejected` with a `RejectionReason` that names the specific failure.

**No conflict-walking.** A meta-move attaches an annotation to a target; it does NOT flip the target's `visible` flag on commit. Multiple meta-moves on the same target are fine — a participant may register a reframe and later add a stance against the same node without contradiction. The `findConflictingProposalAgainst` walker is **not** extended; the `CONFLICTING_PARENT_KINDS` set stays at `{'decompose', 'interpretive-split'}`.

Scope is **propose-side only**. Commit-time annotation creation — the projection-level rendering of the meta-move as a `reframe` / `scope-change` / `stance` annotation entity — is **not** in scope. See Open Questions.

## Why it needs to be done

`docs/methodology.md` lines 184–190 ("Meta-moves") settles the meta-move as the methodology's primary tool for capturing relocations of the debate: "a *reframe* ('the netting question is the operational form of the deeper dispute'), a *scope change* ('we should be defending the typical case, not the edge case'), a *methodological stance* ('I won't press this point on principle, even though my opponent has conceded it'). Meta-moves are not substantive claims about the topic; they are claims about *what is being argued about* or *how it should be argued*." Without explicit capture, meta-moves silently shift the terrain.

Per refinement R28 (`proposal_events.md`), v1 meta-moves require a target (`target_kind` + `target_id`); session-level meta-moves (no target) are deferred. The Zod schema already enforces this structurally; this task enforces the *semantic* prerequisites — that the target actually exists in the session's projection and is currently visible.

The placeholder propose handler currently accepts meta-move proposals against:
- non-existent nodes / edges (the projection would later fail at commit time);
- already-superseded nodes (the meta-move's annotation would render against an invisible entity — a UX defect);
- already-broken edges (same UX defect).

Without this task the API layer would write all those illegal proposals as if they were live; downstream consumers would surface confused state.

## Inputs / context

- [`docs/methodology.md`](../../../docs/methodology.md) — "Meta-moves" section (lines 184–190): "the platform's response is to capture each meta-move as a first-class entry on the board, marked as such. The agreement rule applies: a contested meta-move stays visible as contested until accepted, rejected, or rendered moot by the debate moving past it."
- [`docs/data-model.md`](../../../docs/data-model.md) — Meta-moves are events recorded in history; their effects (per the data-model commit semantics, an `annotation-created` entity of kind `reframe` / `scope-change` / `stance`) appear on the graph. See lines 209–211 and the proposal sub-kind enumeration at line 253.
- [`apps/server/src/methodology/handlers/propose.ts`](../../../apps/server/src/methodology/handlers/propose.ts) — the propose handler with `decompose`, `interpretive-split`, and `axiom-mark` arms already tightened. This task tightens the `meta-move` arm using the same pattern: a local `validateMetaMoveProposal(projection, action)` function called from the `meta-move` case of the switch.
- [`apps/server/src/methodology/primitives.ts`](../../../apps/server/src/methodology/primitives.ts) — `nodeIsVisible` (reused for rule 2 when `target_kind === 'node'`). A new `edgeIsVisible(projection, edgeId): boolean` predicate is added as the symmetrical dual for `target_kind === 'edge'`. The conflict-walker `findConflictingProposalAgainst` is **not** extended; meta-move is non-structural and doesn't compete with decompose / interpretive-split.
- [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) — `ProjectedEdge.visible: boolean` is the per-edge visibility flag (flipped by `applyCommittedProposal`'s `break-edge` arm; flipped to `false` for restructured/superseded edges in future commit work). Reads via `projection.getEdge(edgeId)`. The dual of the node case.
- [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) — `applyCommittedProposal`'s `meta-move` case (lines 687–706). Currently a structural no-op — it synthesizes an annotation id but doesn't emit the annotation-creation, deferring to the methodology engine. See Open Questions.
- [`packages/shared-types/src/events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts) — `metaMoveProposalSchema` (lines 214–222): the structural shape — `kind: 'meta-move'`, `meta_kind: z.enum(['reframe', 'scope-change', 'stance'])`, `content: z.string().min(1)`, `target_kind: z.enum(['node', 'edge'])`, `target_id: z.string().uuid()`. Per ADR 0021 (event_validation) the schema validates at the API-layer ingress before the methodology engine sees the action. Refinement R28 settled the single-shape-with-`meta_kind`-enum design (vs. a three-branch discriminated union) and the target-required-in-v1 decision.
- [`tasks/refinements/data-and-methodology/decomposition_logic.md`](decomposition_logic.md), [`interpretive_split_logic.md`](interpretive_split_logic.md), [`axiom_mark_logic.md`](axiom_mark_logic.md) — sibling templates. The factoring (local `validateXProposal` function dispatched from the switch), rule numbering, and structural-shape-upstream layering all carry over.
- [`apps/server/src/methodology/handlers/proposeAxiomMark.test.ts`](../../../apps/server/src/methodology/handlers/proposeAxiomMark.test.ts), [`tests/behavior/methodology/propose-axiom-mark.feature`](../../../../tests/behavior/methodology/propose-axiom-mark.feature) — sibling templates for the test layout and seed-helper style.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest for in-memory logic; Cucumber+pglite for at least one DB-driven scenario.

## Constraints / requirements

- The handler **does not write events**; it returns a `ValidationResult`. On `Valid` it emits exactly one `EventToAppend` of kind `proposal`.
- The handler **does not mint timestamps or ids**; the API layer mints `eventId` and `createdAt` before calling the engine.
- The handler **does not call `validateEvent`**; the API layer runs the structural validator (Zod) separately (ADR 0021). Methodology validation is on top of structural validation. The handler can rely on `target_id` being a valid UUID, `target_kind` being `'node' | 'edge'`, `meta_kind` being one of the three enum values, and `content` being non-empty.
- **No new `RejectionReason` value.** Rules 1 and 2 reuse the existing `'target-entity-not-found'` and `'illegal-state-transition'` exactly as the decompose / interpretive-split / axiom-mark arms use them. The semantics line up: "the target doesn't exist" → `target-entity-not-found`; "the target exists but is in a state that blocks the action" → `illegal-state-transition`.
- Add a thin getter primitive `edgeIsVisible(projection, edgeId)` in `primitives.ts`, mirroring `nodeIsVisible`. The projection's `getEdge()` already exposes the `visible` flag; the primitive localizes the visibility check.
- Don't extend the conflict-walker (`findConflictingProposalAgainst` / `CONFLICTING_PARENT_KINDS`). Meta-move is non-structural — it does not flip `target.visible = false` on commit and does not compete with decompose / interpretive-split. Multiple meta-moves on the same target are fine.
- Don't pre-empt the other proposal sub-kinds. `meta-move` is the fourth arm tightened; the remaining seven (`classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`, `break-edge`, `amend-node`, `annotate`) stay on the placeholder path until their own sibling tasks land.
- Don't pre-empt commit-time annotation creation. The current `applyCommittedProposal` meta-move arm is a structural no-op (it synthesizes an annotation id but doesn't emit the entity); the rendering decision lives downstream. Flagged in Open Questions.
- Verifications per ADR 0022: Vitest at `apps/server/src/methodology/handlers/proposeMetaMove.test.ts`; Cucumber + pglite scenarios at `tests/behavior/methodology/propose-meta-move.feature` with step defs in `tests/behavior/steps/methodology-propose-meta-move.steps.ts`.

## Acceptance criteria

- `apps/server/src/methodology/handlers/propose.ts` gains a `meta-move` arm in its sub-kind switch, dispatching to a new local function `validateMetaMoveProposal(projection, action)`. The function mirrors the sibling validators in shape, applies the two rules in evaluation order (dispatched on `target_kind`), and returns a `RejectedValidationResult | null`.
- `apps/server/src/methodology/primitives.ts` gains a `edgeIsVisible(projection: Projection, edgeId: string): boolean` predicate. Returns `true` iff `projection.getEdge(edgeId)` exists AND its `visible` flag is `true`. Returns `false` for unknown edges (callers that need to distinguish "doesn't exist" from "exists but not visible" should call `projection.getEdge` directly).
- `apps/server/src/methodology/index.ts` barrel: adds `edgeIsVisible` to the named exports.
- `validateMetaMoveProposal` enforces in evaluation order:
  1. **Target-entity-exists.** Dispatch on `target_kind`:
     - `'node'` → `projection.getNode(target_id)` non-undefined → else `'target-entity-not-found'`, detail naming the missing id, the target_kind, and the session.
     - `'edge'` → `projection.getEdge(target_id)` non-undefined → else `'target-entity-not-found'`, detail naming the missing id, the target_kind, and the session.
  2. **Target-entity-visible.** The resolved entity's `visible` flag is `true`. → `'illegal-state-transition'`, detail naming the not-visible entity and including the phrase "not currently visible".
  3. (Structural shape — enforced upstream by Zod.)
- On `Valid` emit one `EventToAppendEnvelope<'proposal'>` whose payload is `{ proposal: action.proposal }`. Envelope fields are mirror-copied from the action — same shape decompose's / interpretive-split's / axiom-mark's accept path uses.
- `apps/server/src/methodology/handlers/proposeMetaMove.test.ts` covers:
  - Reject when `target_kind=node` and `target_id` refers to no node (reason `'target-entity-not-found'`, detail names the missing id and `'node'`).
  - Reject when `target_kind=edge` and `target_id` refers to no edge (reason `'target-entity-not-found'`, detail names the missing id and `'edge'`).
  - Reject when the target node exists but is not visible (reason `'illegal-state-transition'`, detail names the not-visible node).
  - Reject when the target edge exists but is not visible (reason `'illegal-state-transition'`, detail names the not-visible edge).
  - Accept matrix: for each `meta_kind ∈ {reframe, scope-change, stance}` × `target_kind ∈ {node, edge}` — assert `Valid.events` is one `proposal` event with `payload.proposal` deep-equal to the action's payload; envelope mirrors the action.
  - Zod-layer assertions: `metaMoveProposalSchema.safeParse` rejects payloads missing `target_id`, missing `target_kind`, with an invalid `meta_kind`, or with empty `content`. The methodology validator is never reached for those cases per the layering. Documented in the test file's comment header.
- `tests/behavior/methodology/propose-meta-move.feature` covers 3 DB-driven scenarios:
  1. Successful propose meta-move against a visible node — three participants joined, a node created and visible, then a debater proposes a `reframe` against it → `Valid` with one `proposal` event whose payload mirrors the action.
  2. Successful propose meta-move against a visible edge — three participants joined, two nodes and a `supports` edge created and visible, then a debater proposes a `scope-change` against the edge → `Valid` with one `proposal` event whose payload mirrors the action.
  3. Reject when target_id references no entity — three participants joined, no node-created event for the proposed target, a debater attempts a meta-move → `Rejected` with `'target-entity-not-found'`.
- Step defs in `tests/behavior/steps/methodology-propose-meta-move.steps.ts`. Reuses `tests/behavior/support/event-rows.ts` for row helpers and the shared `Then 'the validation result is Valid'` / `Then 'the validation result is Rejected with reason "..."'` steps from `methodology-engine.steps.ts` / `methodology-commit.steps.ts`. Reuses the shared `When 'the methodology engine validates the propose action against the projected session'` step from `methodology-propose-decompose.steps.ts`. Uses a distinct UUID prefix (`b2...`) to avoid collisions with propose-decompose (`e0...`), propose-interpretive-split (`f0...`), and propose-axiom-mark (`a1...`).
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `meta_move_logic` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
- `make test` end-to-end green; the existing 390 vitest + 71 cucumber baseline stays green and is extended by this task.

## Decisions

- **Scope: propose-side only.** This task validates `propose meta-move`. Commit-time annotation creation (the projection-level rendering of the meta-move as an annotation entity of kind `reframe` / `scope-change` / `stance`) is **not** in scope — see Open Questions.
- **Rule set (numbered, in evaluation order).**
  1. **Target-entity-exists** (dispatched on `target_kind`). → `'target-entity-not-found'`.
  2. **Target-entity-visible.** → `'illegal-state-transition'`.
  3. (Structural shape — enforced upstream by Zod per R28.)
- **No new RejectionReason value.** Rules 1 and 2 reuse `'target-entity-not-found'` and `'illegal-state-transition'` exactly as the decompose / interpretive-split / axiom-mark arms use them. The semantic shape lines up: "the target doesn't exist" vs. "the target exists but is in a state that blocks this action." No need to grow the union — the `detail` string carries the kind-specific specificity (which target_kind, which entity id, which session).
- **Rule 1 dispatch on `target_kind`.** The schema's `target_kind` enum is `'node' | 'edge'`; the projection has separate `getNode()` and `getEdge()` accessors. The dispatch is a clean two-arm if/else inside the validator — no fancy primitive abstraction. Alternative considered: a unified `getEntity(target_kind, target_id)` primitive that returns either kind of record. *Rejected.* The two-arm dispatch is local, readable, and avoids introducing a union type that downstream rule 2 would have to discriminate again anyway. The existing `nodeIsVisible` predicate plus the new `edgeIsVisible` dual cleanly mirror the dispatch.
- **No conflict with decompose / interpretive-split.** A meta-move is **non-structural** — it attaches an annotation and does NOT flip `target.visible = false` on commit. It can coexist with a pending decompose or interpretive-split against the same node. The `CONFLICTING_PARENT_KINDS` set stays at `{'decompose', 'interpretive-split'}`. Rationale: meta-moves are explicitly described in `docs/methodology.md` as relocation moves — they don't compete with structural changes; they reframe the surrounding question.
- **Multiple meta-moves on the same target are allowed.** A participant may register a `reframe` against N1 and later register a `stance` against N1 — both are independent first-class entries on the board. The handler does NOT walk pending or committed meta-moves looking for duplicates. (Contrast `axiom-mark`'s rule 4: per-participant uniqueness, because two axiom-marks from the same participant on the same node would be redundant by definition. Meta-moves don't have that uniqueness invariant — the `meta_kind` axis already differentiates them, and even same-`meta_kind` repeated meta-moves capture an evolving framing.)
- **Edge-visibility checked symmetrically.** When `target_kind === 'edge'`, the rule mirrors the node case: the edge must be currently visible. The not-visible state for an edge today comes from a committed `break-edge` against it (replay.ts's `break-edge` arm calls `setEdgeVisible(edge_id, false)`); future restructure-style operations may produce more sources of invisibility. The predicate is the same: `edge.visible === true`.
- **Where the handler lives.** `propose.ts` itself, factored locally as `validateMetaMoveProposal(projection, action)`. Mirrors decomposition_logic / interpretive_split_logic / axiom_mark_logic's choice. If `propose.ts` grows past ~400 lines as more sub-kinds tighten, factor into per-sub-kind files.
- **Structural shape is upstream's concern.** The Zod schema in `metaMoveProposalSchema` enforces all structural constraints per R28 (single-shape with `meta_kind` enum; `target_kind` + `target_id` both required). Per ADR 0021 the validator runs at the API ingress before the methodology engine sees the action. The methodology validator relies on this layering and does not re-check.
- **Test layout.** Vitest at `apps/server/src/methodology/handlers/proposeMetaMove.test.ts` (new file — same naming pattern as the sibling `proposeXxx.test.ts` files). Cucumber + pglite at `tests/behavior/methodology/propose-meta-move.feature` with step defs in `tests/behavior/steps/methodology-propose-meta-move.steps.ts`. Reuses `event-rows.ts` and the shared Then steps. The step file uses a distinct UUID prefix (`b2...`) to avoid collisions with the propose-decompose (`e0...`), propose-interpretive-split (`f0...`), and propose-axiom-mark (`a1...`) step files.

## Open questions

- **Commit-time annotation creation for the meta-move commit arm.** `replay.ts`'s `applyCommittedProposal` meta-move arm (lines 687–706) is currently a structural no-op — it synthesizes an annotation id (`meta-move:${target_id}:${meta_kind}:${content.length}`) but does **not** emit the annotation-creation. Per `docs/data-model.md` the commit should create an annotation entity of kind `reframe` / `scope-change` / `stance` against the target. Resolving the gap likely lives alongside `commit_logic`'s structural-sub-kind support (the commit handler today rejects `meta-move` commits with `'illegal-state-transition'` per `commit_logic` rule 4) and the parallel decompose / interpretive-split / axiom-mark commit-time follow-ups flagged in those refinements. The current task does not settle this; the integration tests cover propose-side only. Same shape as the decompose / interpretive-split / axiom-mark commit-time gaps.

(All other questions settled.)

## Status

**Done** 2026-05-10.

Implementation:

- `apps/server/src/methodology/handlers/propose.ts` — the propose handler's switch gains a `meta-move` arm that dispatches to a local `validateMetaMoveProposal(projection, action)`. The function enforces the two rules in evaluation order, dispatched on `target_kind`: (1) target-entity-exists via `getNode` / `getEdge`; (2) target-entity-visible via `nodeIsVisible` / `edgeIsVisible`. On `Valid` the handler emits one `EventToAppendEnvelope<'proposal'>`. The `CONFLICTING_PARENT_KINDS` set is unchanged — meta-move is non-structural. The `placeholderProposeHandler` alias is preserved.
- `apps/server/src/methodology/primitives.ts` — new `edgeIsVisible(projection, edgeId)` predicate. The dual of `nodeIsVisible`. Returns `false` for unknown edges; returns `true` iff the edge is present AND its `visible` flag is `true`.
- `apps/server/src/methodology/index.ts` — barrel updated: adds `edgeIsVisible` to the named exports.
- `tasks/10-data-and-methodology.tji` — `complete 100` and `note "Refinement: ..."` added to `meta_move_logic`.
- **No new `RejectionReason` value.** Rules 1 and 2 reuse the existing `'target-entity-not-found'` and `'illegal-state-transition'` codes exactly as the sibling propose-arms do.

Tests:

- `apps/server/src/methodology/handlers/proposeMetaMove.test.ts` — 14 cases: rule 1 dispatched on `target_kind` (unknown node, unknown edge), rule 2 dispatched on `target_kind` (previously-decomposed not-visible node, previously-broken not-visible edge), the accept matrix `meta_kind ∈ {reframe, scope-change, stance} × target_kind ∈ {node, edge}` (6 cases — emits one proposal event with mirrored payload across the matrix), and four Zod-layer pins (missing `target_id`, missing `target_kind`, invalid `meta_kind`, empty `content`).
- `tests/behavior/methodology/propose-meta-move.feature` — 3 DB-driven scenarios: (1) propose `reframe` against a visible node → `Valid` with one proposal event whose payload mirrors the action; (2) propose `scope-change` against a visible `supports` edge → `Valid` with one proposal event whose payload mirrors the action; (3) propose meta-move against an unknown node target → `Rejected` with `'target-entity-not-found'`.
- Step defs in `tests/behavior/steps/methodology-propose-meta-move.steps.ts`. Distinct UUID prefix (`b2...`) from the propose-decompose (`e0...`), propose-interpretive-split (`f0...`), and propose-axiom-mark (`a1...`) step files keeps the SQL rows in separate sessions. Reuses `tests/behavior/support/event-rows.ts` and the shared `Then 'the validation result is Valid'` / `Then 'the validation result is Rejected with reason "..."'` / `When 'the methodology engine validates the propose action against the projected session'` steps from `methodology-engine.steps.ts`, `methodology-commit.steps.ts`, and `methodology-propose-decompose.steps.ts`.

`pnpm run test:smoke` green (404 tests, +14 over the prior 390 baseline). `pnpm run test:behavior:smoke` green (74 scenarios, +3 over the prior 71 baseline). `make test` end-to-end green (vitest + cucumber + playwright). `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent. `pnpm run typecheck` clean.
