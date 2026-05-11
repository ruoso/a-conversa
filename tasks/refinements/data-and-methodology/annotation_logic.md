# Annotation logic — propose-side validator for the `annotate` proposal sub-kind

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.methodology_engine.annotation_logic`
**Effort estimate**: 1d
**Inherited dependencies**: depends on `methodology_engine.agreement_state_machine` (the framework — `MethodologyAction`, `validateAction`, `RejectionReason`, `requireParticipant`, etc.). Indirectly: `methodology_engine.meta_move_logic` (the prior tightened arm — its `target_kind` dispatch pattern, its `nodeIsVisible` + `edgeIsVisible` reuse, its no-conflict-walking decision) and the other previously-tightened sibling arms (decompose, interpretive-split, axiom-mark, edit-wording, break-edge, amend-node) for the per-arm factoring template (`validateXProposal(projection, action)` locals dispatched from `propose.ts`'s switch). Concretely settled: the Zod `annotateProposalSchema` in `packages/shared-types/src/events/proposals.ts` (enforces structural shape — `{ kind: 'annotate', target_kind, target_id, annotation_kind, content }`); the projection's read-side `replay.ts/applyCommittedProposal` `annotate` arm (currently a no-op — see Open Questions).

## What this task is

Tighten the `propose` handler's `annotate` arm with the real methodology-engine validator. The propose handler currently dispatches seven sub-kinds (`decompose`, `interpretive-split`, `axiom-mark`, `meta-move`, `edit-wording`, `break-edge`, `amend-node`) to their real validators and lets the remaining four — including `annotate` — fall through to the universal-pass placeholder path. This task replaces the fall-through for `annotate` with two methodology-specific rules, in evaluation order:

1. The `target_id` references an entity of the proposed `target_kind` that exists in this session's projection. Dispatched on `target_kind`:
   - `target_kind === 'node'`: `projection.getNode(target_id)` must be non-undefined.
   - `target_kind === 'edge'`: `projection.getEdge(target_id)` must be non-undefined.
2. The resolved entity is currently visible in the projection (`visible === true`). An annotation against a superseded node or broken edge is meaningless — per `docs/data-model.md` lines 295–300, "an annotation is visible iff the annotation's target entity (node or edge) is currently visible. If the target becomes invisible, the annotation does too." Allowing a propose against an already-invisible target would write an annotation that can never render.
3. The structural payload shape — `kind: 'annotate'`, `target_kind ∈ {node, edge}`, `target_id: UUID`, `annotation_kind ∈ {note, reframe, scope-change, stance}`, `content: string.min(1)` — is already enforced upstream by the Zod schema (`annotateProposalSchema`, ADR 0021). The validator relies on that layering and does not re-check.

On `Valid` the handler emits exactly one `EventToAppend` of kind `proposal` whose payload is `{ proposal: action.proposal }`. On any rule failure the handler returns a typed `Rejected` with a `RejectionReason` that names the specific failure.

**No conflict-walking.** An annotation is additive — it attaches to a node or edge without flipping its `visible` flag on commit. Multiple annotations against the same target are fine and methodologically expected (a participant may attach a `note` recording context AND a `stance` declaring decline-to-press against the same node). The `findConflictingProposalAgainst` walker is **not** extended; the `CONFLICTING_PARENT_KINDS` set stays at `{'decompose', 'interpretive-split', 'edit-wording', 'amend-node'}` (the four node-touching structural sub-kinds). No new walker for annotate is added either.

**No deduplication.** See Decisions — the methodology layer does not reject "same-content annotation against same target" as a duplicate.

Scope is **propose-side only**. Commit-time annotation creation — the projection-level rendering of the annotate as a `note` / `reframe` / `scope-change` / `stance` annotation entity bound to the target — is **not** in scope. See Open Questions.

## Why it needs to be done

`docs/data-model.md` lines 135–141 ("Annotations") settles annotations as "notes attached to the entity that record participant context the participants want preserved without modifying the entity's core meaning. Examples from the walkthrough: Ben's note that D1's accreditation boundary 'does argumentative work'; a 'declines to press' methodological stance attached to a node Ben chose not to argue." Annotations carry their own `wording` and `substance` facets and go through the standard agreement workflow.

The placeholder propose handler currently accepts annotate proposals against:
- non-existent nodes / edges (the projection would later fail at commit time — or worse, silently lose the annotation);
- already-superseded nodes (the annotation would render against an invisible entity — per line 300, "if the target becomes invisible, the annotation does too" — but writing one against an already-invisible target is a propose-time contradiction);
- already-broken edges (same UX defect).

Without this task the API layer would write all those illegal proposals as if they were live; downstream consumers would surface confused state.

This task is the **last remaining propose sub-kind** to tighten — completing it brings the propose handler's eleven-arm switch fully off the placeholder path. The four remaining placeholder arms after the prior round (`classify-node`, `set-node-substance`, `set-edge-substance`, `annotate`) are all addressed by their own sibling tasks; this is the eleventh and final tightening.

## Inputs / context

- [`docs/data-model.md`](../../../docs/data-model.md) — "Annotations" section (lines 135–141): "Both nodes and edges may carry annotations…". Annotation visibility derivation (lines 295–300): "An annotation is visible iff (1) an `annotation-created` event has fired in this session's history, AND (2) the annotation's target entity (node or edge) is currently visible. If the target becomes invisible, the annotation does too." Proposal sub-kind enumeration (line 256): "`annotate` — proposes a new annotation on an existing entity. Payload: target entity, content."
- [`apps/server/src/methodology/handlers/propose.ts`](../../../apps/server/src/methodology/handlers/propose.ts) — the propose handler with seven prior arms (`decompose`, `interpretive-split`, `axiom-mark`, `meta-move`, `edit-wording`, `break-edge`, `amend-node`) already tightened. This task tightens the `annotate` arm using the same pattern: a local `validateAnnotateProposal(projection, action)` function called from the `annotate` case of the switch. Most directly mirrors the `validateMetaMoveProposal` arm — same `target_kind` dispatch, same two-rule shape, same no-conflict-walking decision.
- [`apps/server/src/methodology/primitives.ts`](../../../apps/server/src/methodology/primitives.ts) — `nodeIsVisible` (reused for rule 2 when `target_kind === 'node'`) and `edgeIsVisible` (reused for rule 2 when `target_kind === 'edge'`). Both already exist from the meta-move tightening; no new primitive is needed for this task.
- [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) — `applyCommittedProposal`'s `annotate` case (lines 749–760). Currently a structural no-op — leaves annotation creation to a paired `annotation-created` event the methodology engine will eventually emit. See Open Questions.
- [`packages/shared-types/src/events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts) — `annotateProposalSchema` (lines 259–265): `{ kind: 'annotate', target_kind: z.enum(['node', 'edge']), target_id: z.string().uuid(), annotation_kind: annotationKindSchema, content: z.string().min(1) }`. The `annotationKindSchema` (`packages/shared-types/src/events/enums.ts:38`) is `z.enum(['note', 'reframe', 'scope-change', 'stance'])`. Per ADR 0021 the schema validates at the API-layer ingress before the methodology engine sees the action.
- [`tasks/refinements/data-and-methodology/meta_move_logic.md`](meta_move_logic.md) — the closest sibling. Same `target_kind` dispatch shape, same two-rule set, same no-conflict-walking decision, same target-visibility rationale (annotation/meta-move attached to invisible entity is meaningless). The annotate arm's structure mirrors meta-move exactly, with a different rejection-detail payload string.
- [`tasks/refinements/data-and-methodology/break_edge_logic.md`](break_edge_logic.md), [`amend_node_logic.md`](amend_node_logic.md) — sibling templates for the per-arm factoring and structural-shape-upstream layering decision.
- [`apps/server/src/methodology/handlers/proposeMetaMove.test.ts`](../../../apps/server/src/methodology/handlers/proposeMetaMove.test.ts), [`tests/behavior/methodology/propose-meta-move.feature`](../../../../tests/behavior/methodology/propose-meta-move.feature), [`tests/behavior/steps/methodology-propose-meta-move.steps.ts`](../../../../tests/behavior/steps/methodology-propose-meta-move.steps.ts) — direct templates for the test layout and seed-helper style. The annotate test files use the same shape with a distinct UUID prefix.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest for in-memory logic; Cucumber+pglite for at least one DB-driven scenario.

## Constraints / requirements

- The handler **does not write events**; it returns a `ValidationResult`. On `Valid` it emits exactly one `EventToAppend` of kind `proposal`.
- The handler **does not mint timestamps or ids**; the API layer mints `eventId` and `createdAt` before calling the engine.
- The handler **does not call `validateEvent`**; the API layer runs the structural validator (Zod) separately (ADR 0021). Methodology validation is on top of structural validation. The handler can rely on `target_id` being a valid UUID, `target_kind` being `'node' | 'edge'`, `annotation_kind` being one of the four enum values, and `content` being non-empty.
- **No new `RejectionReason` value.** Rules 1 and 2 reuse the existing `'target-entity-not-found'` and `'illegal-state-transition'` exactly as the meta-move arm uses them. The semantics line up: "the target doesn't exist" → `target-entity-not-found`; "the target exists but is in a state that blocks the action" → `illegal-state-transition`.
- **No new primitive.** The existing `nodeIsVisible` and `edgeIsVisible` primitives in `apps/server/src/methodology/primitives.ts` cover both target-kind branches of rule 2. Don't introduce new accessors.
- Don't extend the conflict-walker (`findConflictingProposalAgainst` / `CONFLICTING_PARENT_KINDS`). Annotate is additive — it does not flip `target.visible = false` on commit and does not compete with the four node-touching structural sub-kinds. Multiple annotations on the same target are fine (per the no-dedup decision below).
- Don't add a deduplication walker either. Annotations are content-bearing; same-content annotations may be intentional.
- **`annotation_kind` overlap with `meta-move`**: don't try to resolve. Annotate accepts all four `annotation_kind` values per the Zod schema. See Decisions.
- Don't pre-empt commit-time annotation creation. The current `applyCommittedProposal` annotate arm is a structural no-op (lines 749–760); the rendering decision lives downstream. Flagged in Open Questions.
- This is the **last** propose sub-kind to tighten. After this task the `default:` branch of the switch in `propose.ts` is unreachable for any propose sub-kind — three sibling arms (`classify-node`, `set-node-substance`, `set-edge-substance`) are addressed in their own concurrent tasks. Don't pre-empt those; only the `annotate` arm changes here.
- Verifications per ADR 0022: Vitest at `apps/server/src/methodology/handlers/proposeAnnotate.test.ts`; Cucumber + pglite scenarios at `tests/behavior/methodology/propose-annotate.feature` with step defs in `tests/behavior/steps/methodology-propose-annotate.steps.ts`.

## Acceptance criteria

- `apps/server/src/methodology/handlers/propose.ts` gains an `annotate` arm in its sub-kind switch, dispatching to a new local function `validateAnnotateProposal(projection, action)`. The function mirrors the sibling validators in shape, applies the two rules in evaluation order (dispatched on `target_kind`), and returns a `RejectedValidationResult | null`.
- `validateAnnotateProposal` enforces in evaluation order:
  1. **Target-entity-exists.** Dispatch on `target_kind`:
     - `'node'` → `projection.getNode(target_id)` non-undefined → else `'target-entity-not-found'`, detail naming the missing id, the target_kind, and the session.
     - `'edge'` → `projection.getEdge(target_id)` non-undefined → else `'target-entity-not-found'`, detail naming the missing id, the target_kind, and the session.
  2. **Target-entity-visible.** The resolved entity's `visible` flag is `true`. → `'illegal-state-transition'`, detail naming the not-visible entity and including the phrase "not currently visible".
  3. (Structural shape — enforced upstream by Zod.)
- On `Valid` emit one `EventToAppendEnvelope<'proposal'>` whose payload is `{ proposal: action.proposal }`. Envelope fields are mirror-copied from the action — same shape the meta-move accept path uses.
- `apps/server/src/methodology/handlers/proposeAnnotate.test.ts` covers:
  - Reject when `target_kind=node` and `target_id` refers to no node (reason `'target-entity-not-found'`, detail names the missing id and `'node'`).
  - Reject when `target_kind=edge` and `target_id` refers to no edge (reason `'target-entity-not-found'`, detail names the missing id and `'edge'`).
  - Reject when the target node exists but is not visible (reason `'illegal-state-transition'`, detail names the not-visible node).
  - Reject when the target edge exists but is not visible (reason `'illegal-state-transition'`, detail names the not-visible edge).
  - Accept sample: at minimum `{note × node}`, `{reframe × edge}`, `{stance × node}` — assert `Valid.events` is one `proposal` event with `payload.proposal` deep-equal to the action's payload.
  - Zod-layer assertions: `annotateProposalSchema.safeParse` rejects payloads with empty `content`, missing `target_id`, missing `target_kind`, and an invalid `annotation_kind`. The methodology validator is never reached for those cases per the layering. Documented in the test file's comment header.
- `tests/behavior/methodology/propose-annotate.feature` covers 3 DB-driven scenarios:
  1. Successful propose annotate against a visible node (`note` annotation_kind) — three participants joined, a node created and visible, then a debater proposes a `note` against it → `Valid` with one `proposal` event whose payload mirrors the action.
  2. Successful propose annotate against a visible edge (`reframe` annotation_kind) — three participants joined, two nodes and a `supports` edge created and visible, then a debater proposes a `reframe` against the edge → `Valid` with one `proposal` event whose payload mirrors the action.
  3. Reject when target_id references no entity — three participants joined, no node-created event for the proposed target, a debater attempts an annotate → `Rejected` with `'target-entity-not-found'`.
- Step defs in `tests/behavior/steps/methodology-propose-annotate.steps.ts`. Reuses `tests/behavior/support/event-rows.ts` for row helpers and the shared `Then 'the validation result is Valid'` / `Then 'the validation result is Rejected with reason "..."'` steps from `methodology-engine.steps.ts` / `methodology-commit.steps.ts`. Reuses the shared `When 'the methodology engine validates the propose action against the projected session'` step from `methodology-propose-decompose.steps.ts`. Uses a distinct UUID prefix (`c3...`) to avoid collisions with the prior step files.
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `annotation_logic` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
- `make test` end-to-end green; the existing 452 vitest + 87 cucumber baseline stays green and is extended by this task.

## Decisions

- **Scope: propose-side only.** This task validates `propose annotate`. Commit-time annotation creation (the projection-level rendering of the annotate as an `annotation-created`-style entity bound to the target) is **not** in scope — see Open Questions.
- **Rule set (numbered, in evaluation order).**
  1. **Target-entity-exists** (dispatched on `target_kind`). → `'target-entity-not-found'`.
  2. **Target-entity-visible.** → `'illegal-state-transition'`.
  3. (Structural shape — enforced upstream by Zod.)
- **No new RejectionReason value.** Rules 1 and 2 reuse `'target-entity-not-found'` and `'illegal-state-transition'` exactly as the meta-move arm does. The semantic shape lines up: "the target doesn't exist" vs. "the target exists but is in a state that blocks this action." No need to grow the union — the `detail` string carries the kind-specific specificity (which target_kind, which entity id, which session).
- **Rule 1 dispatch on `target_kind`.** Same shape the meta-move arm uses: a clean two-arm if/else inside the validator, no fancy primitive abstraction. The existing `nodeIsVisible` predicate plus the `edgeIsVisible` dual cleanly mirror the dispatch.
- **No conflict-walking.** An annotation is **additive** — it attaches to a target and does NOT flip `target.visible = false` on commit. It can coexist with a pending decompose, interpretive-split, edit-wording, amend-node, break-edge, axiom-mark, meta-move, or another annotate against the same target. The `CONFLICTING_PARENT_KINDS` set stays at `{'decompose', 'interpretive-split', 'edit-wording', 'amend-node'}`. Rationale: annotations are intentionally additive context-recording artifacts (per `docs/data-model.md` line 137 — "notes attached to the entity that record participant context the participants want preserved without modifying the entity's core meaning"); they don't compete with structural changes.
- **No deduplication.** The methodology layer does NOT reject "same-content annotation against same target" as a duplicate. Considered alternatives:
  1. **Walk pending and committed annotations**, reject when `(target_kind, target_id, annotation_kind, content)` matches an existing one. Rejected: annotations are content-bearing artifacts; the participants may want two notes that look similar (different framings, same surface text; or the same note re-stated for emphasis at a later point in the debate). The agreement layer already lets participants vote `dispute` on a redundant annotation.
  2. **Reject only exact-content + same-participant duplicates** (per-participant uniqueness like axiom-mark). Rejected: even more arbitrary — the participant-uniqueness invariant is methodologically meaningful for axiom-marks (per docs/methodology.md, axiom-marks are personal bedrock declarations and a second from the same participant is a no-op) but has no analogue for annotations.
  3. **No dedup** — selected. Annotations carry intentional content. The agreement workflow handles redundancy (a duplicate annotation, if disputed, can be withdrawn). Pinned in the validator's comment header so the absence is visible.
- **`annotation_kind` overlap with `meta-move`**: do not resolve. The `annotateProposalSchema` accepts all four `annotation_kind` values (`note`, `reframe`, `scope-change`, `stance`); the `meta-move` schema's `meta_kind` enum is the latter three. Per the meta_move_logic refinement, when a meta-move proposal commits it creates an annotation with the corresponding kind — so:
  - `propose annotate` with `annotation_kind: 'note'` is a plain note (the only value unique to the annotate path).
  - `propose annotate` with `annotation_kind: 'reframe' | 'scope-change' | 'stance'` is functionally equivalent on commit to a `propose meta-move` with the corresponding `meta_kind`.
  - `propose meta-move` is a separate, possibly redundant path.
  Per `docs/data-model.md` line 253 (meta-move enumeration) vs. line 256 (annotate enumeration), both paths exist in the proposal sub-kind enum. The two paths may converge structurally but differ in user intent: `meta-move` carries a stronger connotation ("I'm relocating the debate"), while `annotate` is the neutral "attach context" path. The annotate validator does NOT redirect or reject `annotation_kind ∈ {reframe, scope-change, stance}` — both paths remain available; downstream consumers (UI, change-history view) may surface them differently. Resolving the redundancy is out of scope here and would be an ADR-level decision touching both schemas.
- **Edge-visibility checked symmetrically.** When `target_kind === 'edge'`, the rule mirrors the node case: the edge must be currently visible. The not-visible state for an edge today comes from a committed `break-edge` against it (replay.ts's `break-edge` arm calls `setEdgeVisible(edge_id, false)`); future restructure-style operations may produce more sources of invisibility. The predicate is the same: `edge.visible === true`.
- **Where the handler lives.** `propose.ts` itself, factored locally as `validateAnnotateProposal(projection, action)`. Mirrors the meta-move / break-edge / amend-node siblings' choice. If `propose.ts` grows further, the per-arm factoring is already file-extraction-ready.
- **Structural shape is upstream's concern.** The Zod schema in `annotateProposalSchema` enforces all structural constraints (`target_kind` enum, `target_id` UUID, `annotation_kind` enum, `content` non-empty). Per ADR 0021 the validator runs at the API ingress before the methodology engine sees the action. The methodology validator relies on this layering and does not re-check.
- **Test layout.** Vitest at `apps/server/src/methodology/handlers/proposeAnnotate.test.ts` (new file — same naming pattern as the sibling `proposeXxx.test.ts` files). Cucumber + pglite at `tests/behavior/methodology/propose-annotate.feature` with step defs in `tests/behavior/steps/methodology-propose-annotate.steps.ts`. Reuses `event-rows.ts` and the shared Then steps. The step file uses a distinct UUID prefix (`c3...`) to avoid collisions with the prior propose-* step files.

## Open questions

- **Commit-time annotation creation for the annotate commit arm.** `replay.ts`'s `applyCommittedProposal` annotate arm (lines 749–760) is currently a structural no-op — it explicitly defers the annotation entity's creation to a separate `annotation-created` event the methodology engine will eventually emit. Per `docs/data-model.md` lines 234 and 295–300, an `annotation-created` event with the annotation id, kind, content, target, creator, and timestamp is what makes the annotation visible. Resolving the gap likely lives alongside `commit_logic`'s structural-sub-kind support (the commit handler today rejects `annotate` commits with `'illegal-state-transition'` per `commit_logic` rule 4) and the parallel decompose / interpretive-split / axiom-mark / meta-move commit-time follow-ups flagged in those refinements. The current task does not settle this; the integration tests cover propose-side only. Same shape as the prior structural-sub-kind commit-time gaps.
- **Whether the meta-move vs annotate path overlap should be resolved at the schema level.** The two paths converge on commit (both produce an annotation entity of the same kind); the v1 distinction is intent-only. A future ADR could collapse the two into one (renaming `meta-move` → `annotate` with `annotation_kind`) or split them more sharply (deny `annotation_kind ∈ {reframe, scope-change, stance}` from the annotate path, forcing meta-move). Out of scope for this task.

(All other questions settled.)

## Status

**Done** 2026-05-10.

Implementation:

- `apps/server/src/methodology/handlers/propose.ts` — the propose handler's switch gains an `annotate` arm that dispatches to a local `validateAnnotateProposal(projection, action)`. The function enforces the two rules in evaluation order, dispatched on `target_kind`: (1) target-entity-exists via `getNode` / `getEdge`; (2) target-entity-visible via `nodeIsVisible` / `edgeIsVisible`. On `Valid` the handler emits one `EventToAppendEnvelope<'proposal'>`. The `CONFLICTING_PARENT_KINDS` set is unchanged — annotate is additive. The `placeholderProposeHandler` alias is preserved; the file's comment header is updated to reflect that only three sub-kinds (`classify-node`, `set-node-substance`, `set-edge-substance`) remain on the placeholder path.
- No new primitives. The existing `nodeIsVisible` and `edgeIsVisible` (added during meta_move_logic) cover both target-kind branches of rule 2.
- `tasks/10-data-and-methodology.tji` — `complete 100` and `note "Refinement: ..."` added to `annotation_logic`.
- **No new `RejectionReason` value.** Rules 1 and 2 reuse the existing `'target-entity-not-found'` and `'illegal-state-transition'` codes exactly as the meta-move sibling does.

Tests:

- `apps/server/src/methodology/handlers/proposeAnnotate.test.ts` — 11 cases: rule 1 dispatched on `target_kind` (unknown node, unknown edge), rule 2 dispatched on `target_kind` (previously-decomposed not-visible node, previously-broken not-visible edge), the accept path samples (`{note × node}`, `{reframe × edge}`, `{stance × node}` — emits one proposal event with mirrored payload), and four Zod-layer pins (empty `content`, missing `target_id`, missing `target_kind`, invalid `annotation_kind`).
- `tests/behavior/methodology/propose-annotate.feature` — 3 DB-driven scenarios: (1) propose `note` against a visible node → `Valid` with one proposal event whose payload mirrors the action; (2) propose `reframe` against a visible `supports` edge → `Valid` with one proposal event whose payload mirrors the action; (3) propose annotate against an unknown node target → `Rejected` with `'target-entity-not-found'`.
- Step defs in `tests/behavior/steps/methodology-propose-annotate.steps.ts`. Distinct UUID prefix (`c3...`) keeps the SQL rows in separate sessions from prior propose-* step files. Reuses `tests/behavior/support/event-rows.ts` and the shared `Then 'the validation result is Valid'` / `Then 'the validation result is Rejected with reason "..."'` / `When 'the methodology engine validates the propose action against the projected session'` steps.

`pnpm run test:smoke` green (463 tests, +11 over the prior 452 baseline). `pnpm run test:behavior:smoke` green (90 scenarios, +3 over the prior 87 baseline). `make test` end-to-end green (vitest + cucumber). `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent. `pnpm run typecheck` clean.
