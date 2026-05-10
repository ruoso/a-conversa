# Update projection on each new event

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.projection.project_incrementally`
**Effort estimate**: 1d
**Inherited dependencies**: `project_from_log` (settled — `applyEvent`, `projectFromLog`, `ReplayError`, the per-event-kind dispatcher, the per-proposal-sub-kind structural commit handlers, and the participants / snapshots / unresolved-meta-disagreements extensions to `Projection` all landed).

## What this task is

Implement the steady-state per-event apply: given a `Projection` that has consumed events 1..N, apply the event at sequence N+1 and emit a `ProjectionChange[]` change feed describing what the event mutated. This is the path the live WS stream takes when a new row lands in `session_events` and downstream subscribers (the broadcaster, the methodology UI, structural diagnostics) need to know what changed without re-walking the full log.

The hard part is *not* the per-event mutation — `applyEvent` already does that. The contributions of this task are: (1) sequence-gap detection (the projection knows which sequence it's at; the next event must be exactly +1 or the apply throws); (2) the `ProjectionChange` change-feed contract that downstream consumers can depend on; (3) a thin `applyEventIncremental` entry point that names the on-the-wire path separately from `applyEvent` (which is shared with replay-from-log).

## Why it needs to be done

[architecture.md — Storage](../../../docs/architecture.md#storage) is explicit:

> In-memory graph projection per active session, rebuilt from the session's event log (joined against the global node/edge tables) on session load and **updated as events stream in**.

`project_from_log` delivered the on-load rebuild. This task delivers the streaming update. Without it, every new event would force a full log re-walk — a non-starter as session histories accumulate. Downstream consumers — the WS broadcaster, structural diagnostics, the methodology UI's "what just changed?" highlight — all read the per-event change feed this task produces.

## Inputs / context

- [`docs/architecture.md` — Storage](../../../docs/architecture.md#storage). The "updated as events stream in" sentence is the spec.
- [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts), [`replay.test.ts`](../../../apps/server/src/projection/replay.test.ts) — the per-event dispatcher and tests this task extends.
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts), [`projection.ts`](../../../apps/server/src/projection/projection.ts) — the storage layer + the `Projection` class we extend with `lastAppliedSequence`.
- [`tests/behavior/projection/from-log.feature`](../../../tests/behavior/projection/from-log.feature) and [`projection-from-log.steps.ts`](../../../tests/behavior/steps/projection-from-log.steps.ts) — the behavior layout this task mirrors for the DB-driven path. The DB-row → Event-envelope mapping is factored into `tests/behavior/support/event-rows.ts` so both step files share it.
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) and [`events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts) — event payload shapes.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check is a committed test. Two layers here: Vitest for the in-memory dispatch + sequence-gap logic; Cucumber + pglite for the DB-driven steady-state apply.

## Constraints / requirements

- Lives under `apps/server/src/projection/` (same package as `replay.ts`); pure in-memory, no DB access in the server module.
- The public entry point is `applyEventIncremental(projection, event): ProjectionChange[]` — a thin wrapper around `applyEvent` that documents the steady-state contract.
- `Projection` is extended with `lastAppliedSequence: number` (default 0, meaning "no events yet"; the first valid event is sequence 1). `applyEvent` bumps this field on successful apply.
- Out-of-order / gap / duplicate sequences throw `OutOfOrderEventError` with `expectedSequence` and `actualSequence` fields readable by the caller. The check fires BEFORE any handler mutation so the projection is unchanged after a rejected apply.
- `applyEvent` now returns `ProjectionChange[]`. `projectFromLog` keeps its `Projection`-returning signature (it discards per-event change feeds — the on-load path has no broadcaster to feed; the incremental path is where the feed matters).
- The `ProjectionChange` shape is a downstream contract — picked once, extensible by additive variants. Documented in the Decisions section below.
- No methodology-engine semantics: this task does not pre-empt `per_facet_status_derivation`, `active_firing_computation`, `projection_caching`, the methodology engine, or the WS broadcaster (which is a downstream backend task that consumes the change feed; not this task).
- Tests per ADR 0022: Vitest unit tests at `apps/server/src/projection/incremental.test.ts`; Cucumber + pglite scenarios at `tests/behavior/projection/incremental.feature` with step defs at `tests/behavior/steps/projection-incremental.steps.ts`.

## Acceptance criteria

- `apps/server/src/projection/incremental.ts` exports `applyEventIncremental(projection, event): ProjectionChange[]`.
- `apps/server/src/projection/replay.ts` exports `OutOfOrderEventError` and `applyEvent` returns `ProjectionChange[]`; `projectFromLog` still returns `Projection`.
- `apps/server/src/projection/types.ts` exports the `ProjectionChange` discriminated union (and the helper aliases `FacetName`, `ChangeEntityKind`).
- `apps/server/src/projection/projection.ts` extends `Projection` with `lastAppliedSequence` (getter + `setLastAppliedSequence` setter).
- `apps/server/src/projection/index.ts` re-exports the new surface.
- `apps/server/src/projection/incremental.test.ts` covers single-event apply, two-events-in-sequence apply, duplicate / gap / out-of-order rejection (`OutOfOrderEventError`), the equivalence property (`projectFromLog ≡ N calls of applyEventIncremental from empty`), and at least one case per `ProjectionChange` discriminator the structural-commit handlers emit.
- `tests/behavior/projection/incremental.feature` has four scenarios: steady-state stream, sequence gap rejected, equivalence with full replay, change feed for a commit-classify-node round.
- `tests/behavior/support/event-rows.ts` factors the DB-row → Event-envelope helpers used by both `projection-from-log.steps.ts` and `projection-incremental.steps.ts`. (The from-log steps file keeps its inline copy for now — the helper is the single source of truth going forward and is the one the incremental scenarios use.)
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` end-to-end green; `tj3 project.tjp` parses clean.

## Decisions

- **`applyEventIncremental` is a thin wrapper around `applyEvent`, not a re-implementation.** The per-event dispatch logic lives in one place — `replay.ts`'s `applyEvent`. The wrapper exists to document the steady-state contract separately from the on-load replay contract and to give the WS broadcaster a clearly-named entry point. A wholesale re-implementation would duplicate the per-event-kind switch and drift over time.
- **`lastAppliedSequence: number` lives on `Projection`.** Default 0 (no events yet); the first valid event is sequence 1. `applyEvent` bumps the field after every successful apply. The projection knows its own sequence position so the caller doesn't have to thread it through a parallel structure.
- **Out-of-order / gap / duplicate semantics: throw, not no-op.** The DB's UNIQUE on `(session_id, sequence)` rejects duplicates at write-time, so the projection never sees them in normal operation. A duplicate arriving at the projection means an upstream bug — the right response is a loud throw, not a silent no-op that masks the bug. Same for gap and out-of-order: the contract is "exactly N+1," and anything else is a programming error in the calling layer.
- **`OutOfOrderEventError` is its own class (not a `ReplayError` sub-kind).** Callers may want to retry differently for sequence faults (the event is fine, the projection just lost its position — typically rebuild from the log via `projectFromLog`) vs. payload faults (the event is malformed — must be rejected before the next event). Carrying `expectedSequence` and `actualSequence` as own-fields lets the caller decide.
- **Sequence check fires BEFORE handler mutation.** The throw on out-of-order leaves the projection unchanged. This is the steady-state atomicity floor: a rejected apply is a no-op on the projection. (Mid-handler invariant throws are a different story — see below.)
- **`applyEvent` now returns `ProjectionChange[]`; `projectFromLog` discards them.** The signature change is acceptable: nothing in the existing codebase relied on `applyEvent`'s void return (the existing tests asserted projection state, not the return value). `projectFromLog` calls `applyEvent` in a loop and ignores the returned arrays — the on-load path has no broadcaster to feed.
- **`ProjectionChange` discriminator set (committed contract):**
  - `session-state-changed` — session lifecycle transition (`open` ↔ `ended`).
  - `participant-joined` — participant entered the session.
  - `participant-left` — participant left.
  - `node-added` — new node visible in the projection.
  - `edge-added` — new edge visible in the projection.
  - `annotation-added` — new annotation visible in the projection.
  - `entity-included` — global entity referenced into this session (no-op on storage when same-session, but information downstream consumers need to register the cross-session reference).
  - `pending-proposal-added` — a proposal was recorded as pending; downstream tally / UI shows it.
  - `pending-proposal-cleared` (with `reason: 'commit' | 'meta-disagreement'`) — pending proposal removed; downstream tally / UI clears it.
  - `vote-recorded` — a vote referenced a pending proposal; downstream tally counts it (the per-facet state derivation owns the per-participant fan-out; the change-feed entry is the wire-level signal).
  - `facet-updated` (with `entityKind`, `entityId`, `facet`, `value`, `status`) — a facet's committed value changed; downstream renders the new value with the new status.
  - `visibility-changed` (with `entityKind`, `entityId`, `visible`) — node / edge / annotation visibility flipped; downstream re-renders the visible subgraph.
  - `axiom-mark-added` — a (node, participant) axiom-mark was recorded.
  - `meta-disagreement-marked` — a proposal was marked as an unresolved meta-disagreement (paired with the `pending-proposal-cleared(reason='meta-disagreement')` entry).
  - `snapshot-added` — a snapshot was recorded.
  - `node-wording-updated` — a node's wording field changed (separate from the wording-facet update; both fire on a reword commit, in that order).
  Variants are additive: new event kinds may add new variants; existing variants do not change shape without a coordinated downstream update. Each variant carries the minimum payload a downstream consumer needs to identify the affected entity — full entity payloads stay on the projection itself, which the consumer can re-read by id.
- **Order within a single event's change feed is meaningful for commits.** A reword commit emits `node-wording-updated` then `facet-updated` then `pending-proposal-cleared` — the downstream consumer renders the wording first, then the facet status badge, then clears the pending UI. Same logic for decompose (visibility-changed then pending-proposal-cleared) and meta-disagreement-marked (meta-disagreement-marked then pending-proposal-cleared). Documenting this order means downstream consumers can rely on it.
- **Atomicity floor: storage-layer invariant throws may leave the projection partially mutated.** The straight-line handlers can throw mid-handler (a `ProjectionInvariantError` from the storage layer surfaces as a `ReplayError`). We do not implement transactional rollback at the projection layer — the storage-layer mutators don't compose that way and the cost-to-value is wrong for the steady-state path. The recovery story is "discard the projection and rebuild from the event log via `projectFromLog`" — which is always safe because the event log is the source of truth. Critically, `lastAppliedSequence` is NOT advanced on a failed apply, so a retry of the same sequence after rebuild is well-defined.
- **The WS broadcaster is a downstream task, not this one.** This task delivers the change-feed shape and the in-memory pathway. The broadcaster's job — fan out per-event changes to subscribed clients with per-client filtering, backpressure, and re-sync semantics — lives in `backend.api_skeleton` / `backend.ws_surface`. The change-feed shape is the contract those tasks consume; this task pins it.
- **The DB-row → Event-envelope helper is factored into `tests/behavior/support/event-rows.ts`.** Two step files now read events out of `session_events`: `projection-from-log.steps.ts` (which kept its inline copy from the previous task — re-touching it for refactoring isn't this task's scope) and `projection-incremental.steps.ts` (which uses the shared helper). The helper is the single source of truth going forward; if a third step file needs the same mapping, it imports from `support/event-rows.ts` rather than copying.
- **No duplicate-event idempotency at the projection layer.** Duplicates are a DB-rejected case; the projection layer treats a same-sequence apply as out-of-order and throws. If an upstream bug feeds a duplicate to the projection, we'd rather see the throw than silently accept it.

## Open questions

- **Vote-recorded change feed precision.** The current `vote-recorded` change carries `proposalId`, `participantId`, and the raw `vote` enum. `per_facet_status_derivation` (the next task on the stream) is what computes per-participant facet state from votes; whether the change feed should also carry the affected entity's id (the proposal's target) is a question for that task. The current shape is "the broadcaster knows a vote on proposal X happened; downstream computes the consequences." If `per_facet_status_derivation` decides the broadcaster also needs to know the affected entity directly, the variant can be widened additively. (Judgment call: minimal payload now; widen if the consuming task asks for it.)

- **Change-feed ordering across multiple events.** Within a single event the order is documented above. Across events: callers concatenate the per-event arrays in event-sequence order, which is the natural order for downstream consumers. We do not currently expose a global ordering invariant (e.g. "vote-recorded for proposal X never precedes pending-proposal-added for X") — the event log's own ordering provides that. (Judgment call: rely on event-sequence ordering; revisit if a consumer needs an explicit cross-event ordering contract.)

## Status

**Done** 2026-05-10.

Implementation:

- `apps/server/src/projection/incremental.ts` — `applyEventIncremental` (thin wrapper around `applyEvent`).
- `apps/server/src/projection/replay.ts` — `applyEvent` now returns `ProjectionChange[]` and enforces the sequence-gap / replay / out-of-order check (`OutOfOrderEventError`); `projectFromLog` unchanged in signature (discards change feeds).
- `apps/server/src/projection/types.ts` — `ProjectionChange` discriminated union added with sixteen variants (full list above).
- `apps/server/src/projection/projection.ts` — `Projection` extended with `lastAppliedSequence: number` getter and `setLastAppliedSequence` setter; default 0.
- `apps/server/src/projection/index.ts` — barrel re-exports the new surface.

Tests:

- `apps/server/src/projection/incremental.test.ts` — 23 cases. Coverage: sequence advancement on single and multi-event apply; duplicate / gap / out-of-order all throw `OutOfOrderEventError` with `expectedSequence` / `actualSequence` fields; one case per `ProjectionChange` variant the structural-commit handlers emit (node-added, edge-added, annotation-added, entity-included, pending-proposal-added, vote-recorded, facet-updated + pending-proposal-cleared on classify-node commit, visibility-changed on decompose commit, node-wording-updated + facet-updated on reword commit, axiom-mark-added, meta-disagreement-marked, snapshot-added, participant-left, restructure-edit visibility-changed); equivalence property `projectFromLog ≡ N calls of applyEventIncremental from empty`; smoke that `applyEvent` and `applyEventIncremental` are the same path.

- `tests/behavior/projection/incremental.feature` — 4 scenarios + step defs in `tests/behavior/steps/projection-incremental.steps.ts`. Coverage: steady-state stream (insert + project one-at-a-time, lastAppliedSequence advances); sequence gap rejected (`OutOfOrderEventError`, projection unchanged); equivalence with full replay (a richer log projected both ways, fingerprints equal); change feed for a commit-classify-node round (collect per-event change feeds, assert the commit's feed contains `pending-proposal-cleared` and `facet-updated(classification, 'fact')`).

- `tests/behavior/support/event-rows.ts` — shared DB-row → Event-envelope mapping (`rowToEnvelopeShape`, `rowToValidatedEvent`, `selectEvents`, `insertEventRow`, `evId`). Used by `projection-incremental.steps.ts`. (`projection-from-log.steps.ts` keeps its inline copy for now; the helper is the single source of truth going forward.)

`pnpm run test:smoke` green (249 tests, +23 over the prior baseline of 226). `pnpm run test:behavior:smoke` green (45 scenarios, +4 over the prior baseline of 41). `make test` end-to-end green (249 unit + 45 cucumber + 1 playwright). `tj3 project.tjp` parses clean.

`tasks/10-data-and-methodology.tji` updated: `complete 100` and `note "Refinement: ..."` added to `project_incrementally`.
