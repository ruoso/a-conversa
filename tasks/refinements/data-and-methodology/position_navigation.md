# Move position forward / backward through the log

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.replay_primitive.position_navigation` at lines 578-582 (inside the `replay_primitive` block, lines 571-588).

## Effort estimate

**1d** (per the `.tji` allocation).

## Inherited dependencies

- `data_and_methodology.replay_primitive.project_at_position` (**settled**, `depends !project_at_position`). The replay primitive proper landed on `main`: [`apps/server/src/projection/at-position.ts`](../../../apps/server/src/projection/at-position.ts) exports `projectAtPosition(events, sessionId, position)` and `ReplayPositionError`, with the position contract pinned by [`tasks/refinements/data-and-methodology/project_at_position.md`](./project_at_position.md). Navigation layers "which position do I move to" on top of that "render at position" primitive; it does not re-derive projection logic.
- `data_and_methodology.projection.project_incrementally` (**settled**, ambient). [`apps/server/src/projection/projection.ts:215-239`](../../../apps/server/src/projection/projection.ts) established `lastAppliedSequence` (initialized to `0` by `createEmptyProjection`, [`apps/server/src/projection/projection.ts:534-536`](../../../apps/server/src/projection/projection.ts)) as the projector's canonical position counter. Navigation speaks that same sequence vocabulary, matching the decision in [`project_at_position.md` Decision §1](./project_at_position.md).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) (**settled**). Navigation behavior must be pinned by committed coverage, not ad hoc probes.

**Pending:** (none — every load-bearing decision is already on `main`; no new ADR is required.)

## What this task is

Add the navigation seam on top of the replay primitive: given a session's full ordered event log and a current numeric position, compute the **next** and **previous** event-log position, and answer the boundary questions ("am I at the first stop?" / "am I at the last stop?") that a scrubber/seek UI needs to enable or disable its step affordances.

The deliverable is a small, pure helper module beside `at-position.ts` — `apps/server/src/projection/position-navigation.ts` — exporting `nextPosition`, `prevPosition`, `isAtStart`, and `isAtEnd`. Navigation computes *positions only*; rendering at a position remains `projectAtPosition`'s job. The two seams compose: navigation decides **where** to stop, the replay primitive renders the graph **there**.

The architecture frames the scrubber granularity as per-event — "every event in the log is a scrubber stop" ([tasks/60-replay-and-test-mode.tji:90](../../60-replay-and-test-mode.tji)) — so a "step" is exactly one event-sequence position, and the navigable stops are `0` (the pre-history baseline) through `headSequence`.

## Why it needs to be done

`projectAtPosition` can render the graph at any sequence, but nothing yet defines how a consumer *moves* between stops. The direct WBS consumer is the test-mode timeline scrubber:

- [`tasks/60-replay-and-test-mode.tji:86-90`](../../60-replay-and-test-mode.tji) — `test_mode_timeline_scrubber` `depends ... data_and_methodology.replay_primitive.position_navigation`; its note pins per-event granularity.

Without a single canonical definition of "next/prev stop and where the boundaries are," every replay/test-mode surface would re-derive its own clamp-and-step arithmetic and get the boundary cases subtly wrong (is `head` equal to `events.length` or `events.length - 1`? is `0` reachable? does stepping past the end throw or saturate?). Centralizing this in the projection package keeps one notion of forward/backward, exactly as `project_at_position` kept one notion of "position." [`docs/architecture.md:99-103`](../../../docs/architecture.md) requires sequence-level scrubber granularity; this task is the data-layer primitive that makes that stepping precise and tested.

## Inputs / context

- [`apps/server/src/projection/at-position.ts:11-49`](../../../apps/server/src/projection/at-position.ts) — the replay primitive this task builds on. `headSequenceOf` (lines 25-27) computes the head sequence; `assertValidPosition` (lines 29-33) enforces `Number.isInteger(position) && 0 <= position <= headSequence`; `ReplayPositionError` (lines 11-23) is the dedicated position-fault type. Both the head computation and the error type should be **reused**, not re-implemented.
- [`apps/server/src/projection/projection.ts:215-239`](../../../apps/server/src/projection/projection.ts) — `lastAppliedSequence` is the projector position counter; `createEmptyProjection` ([:534-536](../../../apps/server/src/projection/projection.ts)) starts it at `0`.
- [`apps/server/src/projection/index.ts:59`](../../../apps/server/src/projection/index.ts) — the projection barrel already re-exports `projectAtPosition, ReplayPositionError`; navigation's surface joins it here.
- [`apps/server/src/projection/replay.ts:1351-1442`](../../../apps/server/src/projection/replay.ts) — `applyEvent` enforces `sequence === lastAppliedSequence + 1`, i.e. a session's full ordered log carries **contiguous** sequences `1..head`. Navigation relies on that contract (see Decision §2).
- [`apps/server/src/projection/at-position.test.ts:30-88`](../../../apps/server/src/projection/at-position.test.ts) — the precedent Vitest hand-builds `Event` lists via local `makeEvent`/`buildLog` helpers; navigation's Vitest follows the same hand-built style (no DB, no fixture loader).
- [`tasks/60-replay-and-test-mode.tji:86-90`](../../60-replay-and-test-mode.tji) — `test_mode_timeline_scrubber`, the per-event consumer that depends on this task; its Playwright lives there (see Acceptance criteria).
- [`docs/architecture.md:99-103`](../../../docs/architecture.md) — scrubber granularity is per-event; every event is a stop.
- The walkthrough fixture's "Segment 1 close" snapshot lands at `sequence 266` (`payload.log_position 265`) in [`packages/test-fixtures/src/fixtures/walkthrough/events.json`](../../../packages/test-fixtures/src/fixtures/walkthrough/events.json) — referenced only as a sanity anchor; navigation's tests stay synthetic (see Decision §5).

## Constraints / requirements

- Lives at `apps/server/src/projection/position-navigation.ts`; pure in-memory integer logic only. No DB, no cache, no WS, no projecting.
- **Reuses** `ReplayPositionError` and the head-sequence computation from `at-position.ts` rather than duplicating them. The head-sequence helper is exported from `at-position.ts` (small refactor — see Decision §6) so "what is head" stays single-sourced.
- Position is **event sequence space**, identical to `projectAtPosition`. The navigable stops are the integers `0..headSequence` inclusive (`0` = pre-history baseline; `headSequence` = the highest sequence in the log; `0` for an empty log).
- A **step** is one event: `nextPosition` moves `+1`, `prevPosition` moves `-1`.
- Stepping past a boundary **saturates** (next at head returns head; prev at `0` returns `0`) — it does not throw. Boundary saturation is the correct navigation UX (see Decision §3).
- A **non-navigable current position** (non-integer, `< 0`, or `> headSequence`) is a caller bug and **throws `ReplayPositionError`** — the same loud-contract enforcement `projectAtPosition` uses for direct requests.
- The helper assumes the caller passed the full ordered log for the session (same assumption as `projectAtPosition`); it does not accept a suffix.
- Navigation does **not** project. It returns positions; consumers pass the result to `projectAtPosition` (or the future `backend.replay_endpoints.get_at_position` endpoint) to render.
- Internal pure helper consumed by other unit-tested code → Vitest is the correct pin; this is **not** a UI-stream task and does **not** cross the protocol/replay boundary (see Decision §5).

## Acceptance criteria

- `apps/server/src/projection/position-navigation.ts` exports:
  - `nextPosition(events: readonly Event[], position: number): number`
  - `prevPosition(events: readonly Event[], position: number): number`
  - `isAtStart(position: number): boolean`
  - `isAtEnd(events: readonly Event[], position: number): boolean`
- `apps/server/src/projection/at-position.ts` exports its head-sequence helper (e.g. `replayHeadSequence(events: readonly Event[]): number`) so navigation reuses it; the existing `projectAtPosition` keeps using it internally (no behavior change to `at-position.ts`).
- `apps/server/src/projection/index.ts` re-exports `nextPosition`, `prevPosition`, `isAtStart`, `isAtEnd` (and `replayHeadSequence` if useful to consumers), alongside the existing `projectAtPosition, ReplayPositionError` line.
- Behavior:
  - `nextPosition`: `0 → 1`; mid-log `N → N+1`; at head → head (saturates); empty log `[] , 0 → 0`.
  - `prevPosition`: head `→ head-1`; `1 → 0`; at `0 → 0` (saturates); empty log `[] , 0 → 0`.
  - both `nextPosition` and `prevPosition` throw `ReplayPositionError` for a non-integer, negative, or beyond-head **current** position.
  - `isAtStart(position)` is `true` iff `position === 0`; `isAtEnd(events, position)` is `true` iff `position === headSequence`. On an empty log (`head === 0`) position `0` is simultaneously at-start and at-end.
- Vitest coverage at `apps/server/src/projection/position-navigation.test.ts` (hand-built `Event` lists, mirroring `at-position.test.ts`) includes:
  - forward/backward single steps from `0`, mid-log, and at each boundary, asserting saturation;
  - a full forward walk from `0` reaching head in exactly `head` steps and visiting every sequence once, plus the symmetric backward walk;
  - `ReplayPositionError` rejection of non-integer / negative / beyond-head current positions for both functions;
  - `isAtStart` / `isAtEnd` truth tables including the empty-log coincidence;
  - a composition check: stepping forward from `0` and calling `projectAtPosition` at each returned stop yields a projection whose `lastAppliedSequence` equals that stop (pins navigation against the replay primitive without DB).
- **No Cucumber and no Playwright for this task.** Navigation is a pure helper that does not cross the protocol/replay boundary; the projection-at-position crossing it drives is already Cucumber-pinned by [`tests/behavior/projection/at-position.feature`](../../../tests/behavior/projection/at-position.feature). The user-visible stepping behavior is exercised by the Playwright spec scoped under `test_mode_timeline_scrubber` ([tasks/60-replay-and-test-mode.tji:86](../../60-replay-and-test-mode.tji)), which already independently owns that e2e — **no deferred-e2e debt is registered against any future task here** (navigation is not UI-reachable; the scrubber task's Playwright is its own scope, not inherited from this task).
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean after the closer marks completion.

## Decisions

- **§1 — Navigation computes positions only; it does not project.** Rationale:
  - Keeps each seam single-purpose, mirroring how `project_at_position` kept snapshot *resolution* out of the *projection* primitive ([project_at_position.md Decision §5](./project_at_position.md)).
  - The server already has a rendering path (`projectAtPosition`, and the future `backend.replay_endpoints.get_at_position` endpoint); navigation feeding it a number composes cleanly.
  - Alternative considered: a combined `stepAndProject(events, sessionId, position, dir) → { position, projection }`. Rejected — it couples navigation to projection, duplicates what the endpoint already does, and blurs the clean where/what split.

- **§2 — Step is `±1` over a contiguous sequence space, saturating at `[0, headSequence]`.** Rationale:
  - `applyEvent` enforces `sequence === lastAppliedSequence + 1` ([replay.ts:1351-1442](../../../apps/server/src/projection/replay.ts)), so a session's full ordered log carries contiguous sequences `1..head`; every integer in `0..head` is therefore a real, distinct stop.
  - `±1` is the simplest expression of "every event is a scrubber stop" and stays honest with the projector's `lastAppliedSequence` counter.
  - Alternative considered: scan the `events` list for the nearest stop strictly greater/less than the current position (robust to sequence gaps). Rejected — equivalent under the enforced contiguity contract but strictly more code for a gap case the append/replay layer guarantees cannot occur. If contiguity were ever relaxed, that would be a replay-primitive-level change with its own ADR, and navigation would follow.

- **§3 — A non-navigable *current* position throws; stepping *past a boundary* saturates.** Rationale:
  - These are two different situations. A current position of `999` or `-1` or `2.5` is a caller bug; the projection stream's style is loud enforcement (`ReplayPositionError`, `OutOfOrderEventError`, `ReplayError`), so navigation throws — consistent with `projectAtPosition` ([project_at_position.md Decision §3](./project_at_position.md)).
  - Stepping next at head or prev at `0` is an *expected* navigation action (the user clicks "next" on the last frame); returning the boundary position is the right UX no-op, and `isAtStart`/`isAtEnd` let the UI disable the affordance pre-emptively. Throwing there would force every consumer to guard each step.
  - Alternative considered: throw on boundary overstep too (uniform with `projectAtPosition`). Rejected — `projectAtPosition` answers direct position *requests* where overshoot signals a bug; navigation answers *step* actions where boundary saturation is the contract.

- **§4 — `0` is a navigable stop (the pre-history baseline).** Rationale:
  - Inherited directly from `projectAtPosition`, where `0` returns the empty projection ([project_at_position.md Decision §4](./project_at_position.md)). The scrubber must be able to rest "before anything happened," so `prevPosition` floors at `0`, not `1`, and `isAtStart` keys on `0`.

- **§5 — Vitest-only; no Cucumber, no Playwright.** Rationale:
  - Per the backend-task testing rule, Vitest is the right pin for an internal helper consumed by other unit-tested code that does **not** cross the protocol or replay boundary. Navigation produces *positions*, not projector output or wire frames; the boundary-crossing it enables (rendering at a position) is already pinned by `at-position.feature`.
  - The composition Vitest case (step → `projectAtPosition` → assert `lastAppliedSequence`) ties navigation to the real primitive in-process, so a Cucumber/DB round-trip would add latency without new signal.
  - Not a UI-stream task (no route renders it, no event surface drives it), so the UI-stream e2e policy does not apply; the user-visible scrubber stepping is the Playwright scope of `test_mode_timeline_scrubber`.
  - Alternative considered: a Cucumber scenario stepping through the walkthrough fixture across the `sequence 266` snapshot. Rejected as redundant with `at-position.feature` (which already pins the fixture's snapshot boundary) and as requiring DB replay for what is pure integer arithmetic.

- **§6 — Surface kept to `next`/`prev` + boundary predicates; head-sequence helper exported from `at-position.ts` for reuse.** Rationale:
  - The only current WBS consumer is the per-event scrubber, which needs exactly stepping + boundary state. Building only for today's one or two call sites matches the predecessor's discipline.
  - Exporting `at-position.ts`'s head computation (rather than re-deriving `events[events.length - 1].sequence` in a second place) keeps a single definition of "head" shared by the primitive and its navigation.
  - Out of scope: a `clampPosition` for snapping an *arbitrary* dragged seek-bar value into range. The replay seek bar ([tasks/60-replay-and-test-mode.tji:53-57](../../60-replay-and-test-mode.tji)) does **not** depend on this task, so adding clamp here would be speculative. If a seek-bar task later needs arbitrary-value clamping, it adds it then — this refinement registers no follow-up WBS task for it (there is no concrete agent-implementable work to schedule today).

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-02.

- `apps/server/src/projection/position-navigation.ts` created: exports `nextPosition`, `prevPosition`, `isAtStart`, `isAtEnd` — pure integer position-navigation seam atop the replay primitive.
- `apps/server/src/projection/at-position.ts` edited: `headSequenceOf` renamed/exported as `replayHeadSequence` so navigation reuses the single definition of "head" without re-deriving it.
- `apps/server/src/projection/index.ts` edited: re-exports the navigation surface (`nextPosition`, `prevPosition`, `isAtStart`, `isAtEnd`) and `replayHeadSequence` alongside the existing `projectAtPosition` / `ReplayPositionError` exports.
- `apps/server/src/projection/position-navigation.test.ts` created: 16 Vitest cases covering next/prev single steps and boundary saturation, full forward/backward walks, `ReplayPositionError` rejection for invalid current positions, `isAtStart`/`isAtEnd` truth tables (including empty-log coincidence), and a `projectAtPosition` composition check.
- No Cucumber or Playwright added (Decision §5: navigation is a pure helper; user-visible scrubber stepping is the Playwright scope of `test_mode_timeline_scrubber`).
- No tech-debt follow-up registered (refinement Decision §6 explicitly scopes no clamp/seek-bar task).
