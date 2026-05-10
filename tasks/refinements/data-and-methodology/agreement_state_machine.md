# Per-facet, per-participant agreement state machine — write-side foundation

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.methodology_engine.agreement_state_machine`
**Effort estimate**: 3d
**Inherited dependencies**: `methodology_engine` depends on `event_types` and `projection`. Concretely settled: the structural validator (`event_validation`, ADR 0021), the `Event` discriminated union (`@a-conversa/shared-types`), the in-memory `Projection` and its `deriveFacetStatus` read-side helper. This task is the **write-side** complement of `deriveFacetStatus` and the **substrate** for the eight other `methodology_engine.*` siblings (`commit_logic`, `withdrawal_logic`, `meta_disagreement_logic`, `decomposition_logic`, `interpretive_split_logic`, `axiom_mark_logic`, `meta_move_logic`, `reword_vs_restructure`, `defeater_capture_logic`, `break_edge_logic`, `amend_node_logic`, `annotation_logic`).

## What this task is

The methodology engine answers one question for the eventual API layer: *given the current projection state and an authenticated participant trying to do thing X, is X legal?* — and if so, returns the validated event payload(s) to be appended to `session_events`.

This task delivers the **framework**:

1. The action vocabulary the API layer constructs from a request (`propose`, `vote`, `commit`, `mark-meta-disagreement`).
2. A `validateAction(projection, action, requester) → ValidationResult` dispatcher with universal pre-checks (participant gate, sequence gate) and a per-action-kind dispatch table.
3. The common validation primitives the siblings reuse (`requesterIsParticipant`, `requesterIsModerator`, `findProposal`, `currentParticipants`, `nextSequence`, `requireParticipant`, `requireModerator`).
4. The `RejectionReason` enum spanning the rejection cases the siblings will need.
5. Placeholder per-action handlers that pass the universal checks and emit a permissive `Valid`, ready for the siblings to replace with their per-sub-kind rules.

Per-action specifics — *"a commit requires every current participant to be voting agree, a withdrawal must reference a prior agree on a committed proposal, a meta-disagreement-mark requires the moderator and a pending proposal that has run through the methodology, a decompose must list ≥2 components"* — are **explicitly not in scope**. The sibling tasks own them and will register tighter handlers against this framework.

## Why it needs to be done

`docs/methodology.md` settles the agreement rule (every participant must vote agree before the moderator commits), the commit step (the moderator's structural-not-interpretive role), withdrawal (an agreed facet returns to disputed), and the meta-disagreement fallback. `docs/data-model.md` settles the per-facet, per-participant agreement-tracking model and the event-types vocabulary.

The structural validator (`event_validation` / `validateEvent`, ADR 0021) checks payload *shape* — types, enums, UUIDs, timestamp formats. It does not know about the projection. The projection enforces sequence ordering (`OutOfOrderEventError`) and structural referential integrity (a `commit` references a pending proposal, a `vote` references a proposal in pending or committed). It does not enforce role gates (only the moderator may `commit`), participation gates (the requester must be currently joined), or methodology-level rules ("commit requires unanimous agree").

Without a methodology-engine framework, every API endpoint would re-implement the role and methodology checks at its call site, drifting from the methodology spec each time it's touched. This task fills that gap — and gives the siblings a single place to plug in per-action specifics so the API layer stays thin.

## Inputs / context

- [`docs/methodology.md`](../../../docs/methodology.md) — the agreement rule (line 9), the commit step (lines 15–25), withdrawal (line 25), meta-disagreement fallback (lines 203–208), role-based authority (the moderator commits; anyone proposes; participants vote).
- [`docs/data-model.md`](../../../docs/data-model.md) — facet vocabulary (lines 47–84), per-participant agreement-tracking (lines 51–64), event-types catalog (lines 218–268).
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) — `ProjectionChange`, `ParticipantRecord`, `ParticipantRole`, the per-participant per-facet state map, `PendingProposal`, `CommittedProposalRecord`, `UnresolvedMetaDisagreement`.
- [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) — `Projection` getters (`getNode`, `getEdge`, `getAnnotation`, `getPendingProposal`, `getCommittedProposal`, `currentParticipants`, `lastAppliedSequence`).
- [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts) — `deriveFacetStatus` and the `FacetStatus` decision table the engine reads.
- [`apps/server/src/events/validate.ts`](../../../apps/server/src/events/validate.ts), [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — `validateEvent`, the `Event` discriminated union, the `ProposalPayload` sub-kind union.
- [`tasks/10-data-and-methodology.tji`](../../10-data-and-methodology.tji) — the eight sibling `methodology_engine.*` tasks; this task is their substrate.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check is a committed test; Vitest for in-memory logic, Cucumber + pglite for at least one DB-driven scenario.
- [`docs/adr/0021-event-envelope-discriminated-union-with-zod.md`](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the structural validator the engine sits **above**: `validateEvent` runs first; methodology validation runs second.

## Constraints / requirements

- The engine **does not write events**. It returns a `Valid` carrying the event payload(s) the API layer will append, or a `Rejected` carrying a typed reason. Event appending is an API-layer concern (downstream `backend.api_skeleton`).
- The engine **does not authenticate**. The API layer does. The engine takes a `requester` argument (a `userId`) that is **assumed already authenticated**; the engine checks whether that user is a *participant in this session*, not whether they exist in the user table.
- The engine **runs after** `validateEvent` (ADR 0021) — both must pass before an event is appended. The engine trusts payload shape; it adds projection-aware checks on top.
- The engine **pre-empts** the projection's `OutOfOrderEventError` when possible — checks `event.sequence === projection.lastAppliedSequence + 1` upfront and returns a typed `Rejected` instead of letting the projection throw.
- Per-action validators are **explicitly out of scope** for this task. The framework hosts them; siblings register them. For now, every action-kind dispatches to a placeholder that runs the universal checks and emits a permissive `Valid`. Each sibling task replaces its placeholder with its real rule.
- Verifications per ADR 0022: Vitest at `apps/server/src/methodology/engine.test.ts`; Cucumber + pglite scenario at `tests/behavior/methodology/engine.feature` with step defs in `tests/behavior/steps/methodology-engine.steps.ts`.
- New directory `apps/server/src/methodology/` — establish cleanly with a barrel.
- No new event payloads, `ProjectionChange` discriminators, or shared-types schemas. The action vocabulary is engine-internal; siblings produce existing event payloads.
- Don't modify the projection layer beyond strictly necessary getters. The projection's substantive shape is fixed.

## Acceptance criteria

- `apps/server/src/methodology/types.ts` exports:
  - `MethodologyAction` discriminated union over `'propose' | 'vote' | 'commit' | 'mark-meta-disagreement'`. Each variant carries the `requester` userId, the candidate event `sequence` and `id` (the API layer mints these before calling the engine), and the action-specific payload (a `ProposalPayload` for `propose`; a `proposalEventId` + `vote` for `vote`; a `proposalEventId` for `commit` and `mark-meta-disagreement`). Sibling tasks may tighten per-sub-kind shapes (e.g., `commit_logic` may add a per-action variant for the proposal sub-kind it accepts) — for this task the broad shape is fine.
  - `ValidationResult = ValidValidationResult | RejectedValidationResult`.
    - `ValidValidationResult` = `{ ok: true; events: ReadonlyArray<EventToAppend> }` where `EventToAppend` carries the event-envelope shape (`id`, `sessionId`, `sequence`, `kind`, `actor`, `payload`, `createdAt`) ready for the API layer to insert. Most actions emit one event; some (e.g., decompose's structural fan-out — owned downstream) emit multiple.
    - `RejectedValidationResult` = `{ ok: false; reason: RejectionReason; detail: string }` — the typed reason plus a human-readable detail string for surfacing to the requester.
  - `RejectionReason` union covering the cases siblings will need:
    - `'not-a-participant'` — requester is not currently joined to this session.
    - `'sequence-mismatch'` — the action's sequence does not match `projection.lastAppliedSequence + 1`.
    - `'session-mismatch'` — the action's sessionId does not match the projection's.
    - `'not-a-moderator'` — action requires the moderator role; requester is not the moderator (used by `commit_logic` and `meta_disagreement_logic`).
    - `'proposal-not-found'` — referenced proposal id is neither pending nor committed.
    - `'proposal-not-pending'` — referenced proposal must be pending (used by `commit_logic` and `meta_disagreement_logic`).
    - `'proposal-already-committed'` — for `commit_logic` defensive check; the proposal has already been committed.
    - `'proposal-already-meta-disagreement'` — same defense for `meta_disagreement_logic`.
    - `'already-voted'` — for the no-double-agree case if `vote_logic` chooses to enforce it (the engine doesn't preempt the decision; the reason exists in the union for siblings).
    - `'no-prior-agree'` — for `withdrawal_logic`: a `withdraw` vote requires a prior `agree` from this participant on this proposal.
    - `'inapplicable-to-facet'` — the action references a facet that the proposal sub-kind does not target (e.g. classifying an annotation).
    - `'illegal-state-transition'` — generic "the projection state forbids this action" — siblings populate the `detail` with specifics.
    - `'self-vote-not-allowed'` — reserved for sibling rules that forbid voting on one's own proposal (decision deferred to the relevant sibling).
    - `'unanimous-agree-required'` — for `commit_logic`: not every current participant is voting agree.
    - `'methodology-not-exhausted'` — for `meta_disagreement_logic`: the methodology must have run before meta-disagreement is marked (deferred-decision; reason exists in the union for the sibling).
  - `Validator<TAction>` type and a registration helper that lets siblings register a per-action handler.
- `apps/server/src/methodology/primitives.ts` exports:
  - `requesterIsParticipant(projection, userId): boolean` — currently joined.
  - `requesterIsModerator(projection, userId): boolean` — currently joined AND role is `'moderator'`.
  - `findProposal(projection, proposalEventId): { state: 'pending' | 'committed' | 'meta-disagreement'; record: PendingProposal | CommittedProposalRecord | UnresolvedMetaDisagreement } | null`.
  - `currentParticipants(projection)` — re-exported convenience around `Projection.currentParticipants`.
  - `nextSequence(projection): number` — `projection.lastAppliedSequence + 1`.
  - `requireParticipant(projection, userId): RequireResult<ParticipantRecord>` — returns `{ ok: true, record }` or `{ ok: false, rejection }`. The `rejection` carries the matching `RejectionReason` so callers can return it directly.
  - `requireModerator(projection, userId): RequireResult<ParticipantRecord>` — same shape; rejection reason is `'not-a-participant'` if not joined, `'not-a-moderator'` if joined but wrong role.
- `apps/server/src/methodology/engine.ts` exports:
  - `validateAction(projection, action): ValidationResult` — public entry. Runs universal checks (sessionId, sequence, participant), dispatches to the per-action handler.
  - `registerActionHandler(actionKind, handler)` and `getActionHandler(actionKind)` — registration mechanism for siblings. The barrel re-exports both. Sibling tasks call `registerActionHandler('commit', commitLogic.handle)` from their own module init.
  - A default placeholder handler is registered for each action kind. The placeholders pass universal checks and return a permissive `Valid` carrying a single `EventToAppend` constructed from the action's payload — siblings replace these as they land.
- `apps/server/src/methodology/index.ts` — barrel re-exporting the public surface.
- `apps/server/src/methodology/engine.test.ts` covers:
  - Reject action from a non-participant.
  - Reject action with mismatched sequence.
  - Reject action with mismatched session id.
  - The `Valid` / `Rejected` discriminator round-trips correctly (TS narrowing inside an `if (result.ok)` branch).
  - Each primitive in isolation: `requesterIsParticipant`, `requesterIsModerator`, `findProposal` (pending / committed / meta-disagreement / not-found), `currentParticipants`, `nextSequence`, `requireParticipant`, `requireModerator`.
  - End-to-end smoke: build a projection with three participants, build a `vote` action from one of them, call `validateAction` — passes the universal checks, the placeholder handler emits a `Valid` with a single `EventToAppend`.
  - Sequence pre-emption: an action with `sequence = projection.lastAppliedSequence` (replay) and `sequence = projection.lastAppliedSequence + 2` (gap) both rejected with `'sequence-mismatch'`.
- `tests/behavior/methodology/engine.feature` (1 scenario): build the empty fixture; construct a `vote agree` action from one of the seeded participants on a hand-rolled proposal in the projection; project the events through pglite's `session_events`; call `validateAction(projection, action)` — assert `Valid`. Step defs in `tests/behavior/steps/methodology-engine.steps.ts`. Reuses `tests/behavior/support/event-rows.ts`.
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` end-to-end green.
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `agreement_state_machine` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.

## Decisions

- **Where the engine lives.** New directory `apps/server/src/methodology/` with `types.ts`, `primitives.ts`, `engine.ts`, `index.ts` (barrel). Mirrors the `apps/server/src/projection/` layout — pure logic; sibling tasks add files alongside without churning the existing ones.
- **Action vocabulary.** Four broad kinds matching the four event kinds the methodology emits: `propose`, `vote`, `commit`, `mark-meta-disagreement`. Each carries `requester: string` (the authenticated userId — the API layer's responsibility), `sessionId: string`, `sequence: number`, `eventId: string`, `actor: string | null` (the API layer mints this from the requester for typical actions), `createdAt: string` (ISO-8601 — the API layer mints this from the server clock). The `propose` variant additionally carries a `proposal: ProposalPayload`. The `vote` variant additionally carries `proposalEventId: string` and `vote: 'agree' | 'dispute' | 'withdraw'`. The `commit` and `mark-meta-disagreement` variants carry `proposalEventId: string`. Siblings may tighten the per-action shape (e.g. `commit` might split per-sub-kind) — for this task the broad shape is fine.
- **`ValidationResult` shape.** Discriminated union on `ok: true | false`. `Valid` carries `events: ReadonlyArray<EventToAppend>` (most actions emit one; decompose/restructure may emit multiple — siblings own that fan-out). `Rejected` carries `reason: RejectionReason` (typed enum) and `detail: string` (human-readable for surfacing to the requester). The discriminated shape lets API code do `if (result.ok) { /* result.events */ } else { /* result.reason */ }` cleanly.
- **`EventToAppend` shape.** Mirrors the `EventEnvelope` from `@a-conversa/shared-types` with `id`, `sessionId`, `sequence`, `kind`, `actor`, `payload`, `createdAt`. The API layer takes `events` from the result and inserts them into `session_events`. The engine constructs each `EventToAppend` so the API layer doesn't have to re-derive ids / sequences / timestamps; for multi-event actions (downstream) this matters because the events must be sequenced correctly.
- **Universal checks (run first, in `validateAction` itself, before any per-action handler).**
  1. Session match: `action.sessionId === projection.sessionId`. If not → `'session-mismatch'`.
  2. Sequence match: `action.sequence === projection.lastAppliedSequence + 1`. If not → `'sequence-mismatch'`.
  3. Participant gate: `requester` is currently joined to this session. If not → `'not-a-participant'`.
- **Dispatch / registration shape.** A module-level `Map<ActionKind, ActionHandler>` populated by `registerActionHandler(kind, handler)`. The framework registers placeholder handlers for all four kinds at module-init time. Sibling tasks call `registerActionHandler` to replace them with tightened logic. `validateAction` looks up the handler for `action.kind` after universal checks; the handler returns its own `ValidationResult`. Pragmatic choice — a discriminated-union with TS-pattern-match would be cleaner in pure TS, but the registration map is what lets siblings own their logic without forking the dispatcher's source. Document the pattern in `engine.ts`'s file header so siblings know where to plug in.
- **Placeholder handler behavior.** Each placeholder handler returns a `Valid` carrying a single `EventToAppend` constructed naively from the action's payload (e.g. `vote` → an event of kind `'vote'` with the vote payload; `propose` → an event of kind `'proposal'` with the proposal payload). This lets sibling tasks land their tighter logic incrementally without breaking the framework's smoke tests. The placeholders **do not** preempt sibling decisions — they pass the universal checks and return a successful result for any action the universal checks accepted.
- **`RejectionReason` set (committed for this task).** `'not-a-participant'`, `'sequence-mismatch'`, `'session-mismatch'`, `'not-a-moderator'`, `'proposal-not-found'`, `'proposal-not-pending'`, `'proposal-already-committed'`, `'proposal-already-meta-disagreement'`, `'already-voted'`, `'no-prior-agree'`, `'inapplicable-to-facet'`, `'illegal-state-transition'`, `'self-vote-not-allowed'`, `'unanimous-agree-required'`, `'methodology-not-exhausted'`. The set spans what the eight siblings will need; siblings may add to the union when their refinements settle additional cases. Keeping the union open (siblings can add) means the framework doesn't need pre-empt every edge case today.
- **Primitives committed.** `requesterIsParticipant`, `requesterIsModerator`, `findProposal`, `currentParticipants`, `nextSequence`, `requireParticipant`, `requireModerator`. Mirror the `FacetStatusDerivationError` pattern from `facet-status.ts` for the `requireX` helpers — they return a discriminated `RequireResult<T>` rather than throwing. (The siblings call these dozens of times; throwing for control flow would be ugly. The discriminated result also TS-narrows cleanly.)
- **Boundary with the API layer.** The API layer:
  1. Authenticates the request, extracts the userId.
  2. Loads the projection (cached or freshly built).
  3. Constructs a `MethodologyAction` from the request.
  4. Calls `validateAction(projection, action)`.
  5. On `Valid`: appends the events to `session_events` (via `event_validation` for shape, then INSERT), then calls `applyEventIncremental` on the cached projection to update it.
  6. On `Rejected`: returns the rejection reason + detail to the requester (HTTP 4xx with the typed reason as the error code).
  The API layer does not duplicate methodology checks; the engine is the single source. The engine does not duplicate structural validation; `validateEvent` is the single source.
- **Boundary with `validateEvent`.** Both must pass before an event is appended. `validateEvent` runs in two places: (a) optionally inside the engine's per-action handler (sibling tasks may opt into it; not enforced by this task), and (b) inside the API layer's append path (always enforced — it's the schema-on-write step, ADR 0021). Today's engine doesn't double-validate; it trusts `EventToAppend` payloads to be structurally valid because the action's payload was constructed from an already-validated request body. The sibling tasks may tighten this if a regression surfaces.
- **`requester` is `userId`, not a `ParticipantRecord`.** The API layer hands the engine an authenticated userId. The engine resolves the userId to a participant record (or rejects). Mirrors the `Projection.currentParticipants` API shape — userId is the projection's participant key.
- **No `applyEvent` integration in this task.** The engine validates and returns events; the API layer applies them. Wiring the engine to call `applyEventIncremental` directly would conflate "is this legal?" with "make it so" — the API layer owns the latter so the database write happens before the projection mutation. Sibling tasks may revisit if a use case demands it.
- **Test layout (Vitest).** `apps/server/src/methodology/engine.test.ts`. Reuses the `seedSession` pattern from `facet-status.test.ts` (events constructed as TS literals, `applyEvent` to a fresh projection). Cases enumerated above.
- **Test layout (Cucumber + pglite).** `tests/behavior/methodology/engine.feature` + `tests/behavior/steps/methodology-engine.steps.ts`. One scenario: load the empty fixture into pglite (3 participants joined), construct a `vote agree` action from one of those participants (the action references a hand-rolled pending proposal added to the projection in the step), project, call `validateAction`, assert `Valid`. Reuses `tests/behavior/support/event-rows.ts`. The empty fixture's userIds (`11111111-...`, `22222222-...`, `33333333-...`) are stable across the test suite.

## Open questions

(none — all decided for this foundation task. Per-action specifics are deferred to the eight sibling tasks; their refinements will tighten what each handler does.)

## Status

**Done** 2026-05-10.

Implementation:

- `apps/server/src/methodology/types.ts` — `MethodologyAction` discriminated union (`propose` | `vote` | `commit` | `mark-meta-disagreement`), `ActionKind`, `EventToAppend`, `ValidationResult` (`ValidValidationResult` | `RejectedValidationResult`), `RejectionReason` (15-value union), `RequireResult<T>`, `Validator<TAction>`.
- `apps/server/src/methodology/primitives.ts` — `requesterIsParticipant`, `requesterIsModerator`, `findProposal`, `currentParticipants`, `nextSequence`, `requireParticipant`, `requireModerator`. The `requireX` helpers return a discriminated `RequireResult<T>`.
- `apps/server/src/methodology/engine.ts` — `validateAction(projection, action): ValidationResult` with universal pre-checks (session match, sequence match, participant gate), `registerActionHandler` / `getActionHandler` / `resetActionHandlers` for sibling registration. Default placeholder handlers registered for all four kinds at module-init; placeholders pass universal checks and emit a permissive `Valid` carrying a single `EventToAppend`. Siblings will replace placeholders as they land.
- `apps/server/src/methodology/index.ts` — barrel.

Tests:

- `apps/server/src/methodology/engine.test.ts` — 25 cases covering the universal checks, the `ValidationResult` discriminator, each primitive in isolation, end-to-end smoke for each of the four action kinds. Plus sequence pre-emption for replay (`sequence == lastApplied`) and gap (`sequence == lastApplied + 2`).
- `tests/behavior/methodology/engine.feature` — 1 scenario covering the DB-driven path: load the empty fixture into pglite, project the four lifecycle events, construct a `vote agree` action against a hand-rolled pending proposal added to the projection by the step (since the empty fixture has no proposals), assert `validateAction` returns `Valid` with one `EventToAppend` whose payload is the vote.
- Step defs in `tests/behavior/steps/methodology-engine.steps.ts`. Reuses `tests/behavior/support/event-rows.ts` for row helpers.

`pnpm run test:smoke` green (322 tests, +25 over the prior 297 baseline). `pnpm run test:behavior:smoke` green (52 scenarios, +1 over the prior 51 baseline). `make test` end-to-end green. `tj3 project.tjp` parses clean.

`tasks/10-data-and-methodology.tji` updated: `complete 100` and `note "Refinement: ..."` added to `agreement_state_machine`.
