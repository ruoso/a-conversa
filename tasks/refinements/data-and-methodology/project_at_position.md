# Project the graph state at any event-log position

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.replay_primitive.project_at_position` at lines 534-537.

## Effort estimate

**2d** (per the `.tji` allocation).

## Inherited dependencies

This task has **no explicit `depends` line** in `tasks/10-data-and-methodology.tji`; the inherited constraints are ambient and already settled:

- `data_and_methodology.projection.project_from_log` (settled). [`apps/server/src/projection/replay.ts:1445-1448`](../../../apps/server/src/projection/replay.ts) already gives the full-log replay seam, and [`tasks/refinements/data-and-methodology/project_from_log.md:67-70`](./project_from_log.md) explicitly reserved snapshots as the replay primitive's consumer-facing navigation surface.
- `data_and_methodology.projection.project_incrementally` (settled). [`apps/server/src/projection/replay.ts:1351-1442`](../../../apps/server/src/projection/replay.ts) and [`apps/server/src/projection/projection.ts:237-242`](../../../apps/server/src/projection/projection.ts) established sequence as the projector's canonical position counter; replay-at-position should speak that same vocabulary, not invent a second notion of position.
- `data_and_methodology.projection.projection_caching` (settled). [`tasks/refinements/data-and-methodology/projection_caching.md:82-90`](./projection_caching.md) already decided that replay-at-position uses a fresh throwaway projection and does **not** reuse or warm the live cache.
- `data_and_methodology.data_methodology_tests.walkthrough_replay_e2e` (settled). [`tasks/refinements/data-and-methodology/walkthrough_replay_e2e.md:61-66`](./walkthrough_replay_e2e.md) names replay-at-position as a downstream consumer of the canonical walkthrough fixture with a mid-log snapshot.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) (settled). This task needs committed replay-boundary coverage, not ad hoc probes.

**Pending:** (none — all load-bearing decisions are already available on `main`; no new ADR is required.)

## What this task is

Add the first replay primitive proper: given a validated, sequence-ordered session event log and a numeric event-log position, build the projection that reflects exactly the prefix of the log up to that position. This is the pure data-layer seam that both future consumers depend on:

- `position_navigation` moves the requested numeric position forward and backward.
- `snapshot_resolution` resolves a snapshot label or id to a numeric log position, then calls this primitive.

The deliverable is a small projection helper under `apps/server/src/projection/` that reuses the existing replay dispatcher, returns a fresh `Projection`, and makes the position contract explicit: `0` means "before the first event"; `N` means "after applying the event whose `sequence === N`".

## Why it needs to be done

[`docs/architecture.md:49-51`](../../../docs/architecture.md) says snapshots are named references to a position in the event log, and [`docs/architecture.md:75-75`](../../../docs/architecture.md) defines the unified live/replay primitive as "render the graph at a position in the event log." Today the codebase only has two projector entry points:

- full replay from zero: [`apps/server/src/projection/replay.ts:1445-1448`](../../../apps/server/src/projection/replay.ts)
- single-event apply at head: [`apps/server/src/projection/replay.ts:1351-1442`](../../../apps/server/src/projection/replay.ts)

There is no entry point for "give me the graph at sequence 57". Without that seam, downstream replay work either duplicates prefix-slicing logic in the UI/backend layers or cheats by rebuilding head and manually undoing state, which is exactly the kind of second system the projection stream has avoided so far.

The need is already visible in the design docs and fixtures:

- [`docs/data-model.md:273-277`](../../../docs/data-model.md) defines `snapshot-created` as a named log position for replay reference.
- [`docs/example-walkthrough.md:215-233`](../../../docs/example-walkthrough.md) includes a real segment snapshot and explicitly frames it as replay reference.
- [`tasks/refinements/data-and-methodology/walkthrough_replay_e2e.md:65-65`](./walkthrough_replay_e2e.md) calls out replay-at-position as a downstream consumer of that fixture.

## Inputs / context

- [`docs/architecture.md:43-51`](../../../docs/architecture.md) — event log is canonical; snapshots are immutable references to a log position.
- [`docs/architecture.md:69-75`](../../../docs/architecture.md) — replay is a v1 feature; the shared primitive is rendering at a log position.
- [`docs/architecture.md:99-103`](../../../docs/architecture.md) — test mode scrubber stops at every event; granularity is sequence-level, not coarse snapshot-only replay.
- [`docs/data-model.md:273-277`](../../../docs/data-model.md) — `snapshot-created` payload carries a log position; visible graph state at any event-log position is computed from the event log.
- [`docs/example-walkthrough.md:215-233`](../../../docs/example-walkthrough.md) — the canonical walkthrough includes a segment snapshot and is the first non-trivial fixture that should exercise replay-at-position.
- [`apps/server/src/projection/replay.ts:1351-1448`](../../../apps/server/src/projection/replay.ts) — existing projector seams. `applyEvent` already enforces session match and exact `sequence = lastAppliedSequence + 1`; `projectFromLog` is just "start empty, apply every event".
- [`apps/server/src/projection/projection.ts:237-242`](../../../apps/server/src/projection/projection.ts) — `lastAppliedSequence` is the current projector position counter.
- [`apps/server/src/projection/projection.ts:461-477`](../../../apps/server/src/projection/projection.ts) — snapshot records are queryable once replay includes their `snapshot-created` event.
- [`apps/server/src/projection/cache.ts:63-115`](../../../apps/server/src/projection/cache.ts) — the live cache owns head projections only; replay-at-position should stay separate from it.
- [`tests/behavior/projection/from-log.feature:15-64`](../../../tests/behavior/projection/from-log.feature) — existing Cucumber precedent for replay-through-DB at the projection boundary, including snapshot assertions.
- [`tests/behavior/projection/walkthrough-replay.feature:122-125`](../../../tests/behavior/projection/walkthrough-replay.feature) — the walkthrough fixture already pins that the segment snapshot lands on the projection; this task reuses the same fixture to pin replay to that recorded position.

## Constraints / requirements

- Lives under `apps/server/src/projection/`; pure in-memory logic only. No DB access, no cache access, no WS coupling.
- Reuses the existing replay dispatcher rather than duplicating event-kind logic. The only new behavior is stopping at a caller-specified position.
- Position is **event sequence space**, not array index space. If the caller asks for position `5`, the returned projection's `lastAppliedSequence` must be `5`.
- `0` is valid and returns an empty projection for the session.
- Valid positions are inclusive in the range `0..headSequence`, where `headSequence` is the highest sequence present in the provided log. Negative, fractional, and beyond-head positions throw a dedicated position error.
- The helper assumes the caller passed the full ordered log for the session. It does **not** accept a suffix beginning at arbitrary sequence `N`; `applyEvent`'s existing sequence contract remains authoritative.
- Replay-at-position returns a **fresh throwaway `Projection`** each call. It must not mutate or seed `ProjectionCache`.
- Snapshot payloads are not interpreted here. This task replays through `snapshot-created` like any other event; resolving "snapshot label X means numeric position Y" belongs to `snapshot_resolution`.
- Because this changes replay-visible projector output, acceptance must include committed Cucumber coverage at the replay boundary per ADR 0022. No Playwright is required; this is not a UI-stream task.

## Acceptance criteria

- `apps/server/src/projection/at-position.ts` exports:
  - `projectAtPosition(events: readonly Event[], sessionId: string, position: number): Projection`
  - `ReplayPositionError`
- `apps/server/src/projection/index.ts` re-exports that surface.
- `projectAtPosition` behavior:
  - position `0` returns `createEmptyProjection(sessionId)` semantics with `lastAppliedSequence === 0`;
  - position equal to the log head returns the same fingerprint as [`projectFromLog`](../../../apps/server/src/projection/replay.ts);
  - position `N` replays only events with `sequence <= N`, so the returned projection's `lastAppliedSequence === N`;
  - position errors (`< 0`, non-integer, `> headSequence`) throw `ReplayPositionError`;
  - event-log consistency faults still surface through the existing replay errors (`OutOfOrderEventError` / `ReplayError`) rather than being silently normalized.
- Vitest coverage at `apps/server/src/projection/at-position.test.ts` includes:
  - empty-log / position-0 behavior;
  - mid-log replay over a hand-built event list with an assertion that later events are absent;
  - head equivalence with `projectFromLog`;
  - snapshot event inclusion semantics (before the snapshot event: absent; at/after the snapshot event: present);
  - out-of-range and non-integer position rejection.
- Cucumber coverage at `tests/behavior/projection/at-position.feature` includes:
  - scenario: the empty fixture projected at position `0` yields the empty/open baseline;
  - scenario: the walkthrough fixture projected at the recorded "Segment 1 close" log position yields a projection that contains that snapshot and excludes later events;
  - scenario: projecting the walkthrough fixture at head yields the same projection fingerprint as full `projectFromLog`.
- The new step file reuses the existing DB-row helpers in [`tests/behavior/support/event-rows.ts`](../../../tests/behavior/support/event-rows.ts) rather than copying row-to-event mapping logic, keeping the Cucumber seam aligned with `from-log.feature` and `incremental.feature`.
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` green; `tj3 project.tjp` parses clean after the closer marks completion.

## Decisions

- **Use event `sequence` as the public position vocabulary.** Rationale:
  - [`docs/data-model.md:273-277`](../../../docs/data-model.md) defines snapshots in terms of log position, and the projector already tracks that position as [`Projection.lastAppliedSequence`](../../../apps/server/src/projection/projection.ts).
  - Array indexes are unstable once fixtures or loaders change shape; `sequence` is the durable contract already stored in `session_events`.
  - Alternative considered: zero-based array index. Rejected because it drifts from snapshots, DB rows, and every existing replay/projection contract.

- **Implement `projectAtPosition` as "fresh projection + prefix replay", not rewind-from-head.** Rationale:
  - The existing, tested primitive is `applyEvent`; reusing it keeps replay-at-position honest with the head projector.
  - Rewind logic would need inverse operations for every event kind, including proposal lifecycle and visibility flips, none of which exist today.
  - Alternative considered: hydrate head via `ProjectionCache` and undo back to `N`. Rejected because `projection_caching` already decided replay-at-position uses a throwaway projection, and undo semantics would be more complex and less trustworthy than replaying the prefix.

- **Out-of-range positions throw; they do not clamp.** Rationale:
  - Clamping `999` to head hides caller bugs in `position_navigation` and `snapshot_resolution`.
  - The projection stream's style so far is loud contract enforcement (`OutOfOrderEventError`, `ReplayError`), not silent repair.
  - Alternative considered: clamp negative to `0` and beyond-head to head. Rejected because replay UI/navigation code should know whether it requested a valid stop.

- **`0` is the only synthetic position.** Rationale:
  - The architecture's scrubber granularity is per-event; a useful replay primitive needs a pre-history state for "before anything happened".
  - `0` composes cleanly with the existing sequence contract, where the first real event must have `sequence === 1`.
  - Alternative considered: disallow `0` and require the first usable position to be `1`. Rejected because it prevents rendering the empty baseline and makes scrubber UX needlessly special-cased.

- **Snapshot events are replayed, not resolved, in this task.** Rationale:
  - [`apps/server/src/projection/projection.ts:461-477`](../../../apps/server/src/projection/projection.ts) already gives a snapshot record surface once the event is replayed.
  - Interpreting snapshot labels or ids is a separate concern and is already named as `snapshot_resolution` in the WBS.
  - Alternative considered: let `projectAtPosition` accept either a number or snapshot id/label. Rejected because it would merge two planned tasks and blur a clean seam.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-31.

- Added `projectAtPosition` and `ReplayPositionError` in [`apps/server/src/projection/at-position.ts`](../../../apps/server/src/projection/at-position.ts) as the replay primitive for prefix-by-sequence projection.
- Re-exported the new projection surface from [`apps/server/src/projection/index.ts`](../../../apps/server/src/projection/index.ts) so downstream callers can import it from the projection barrel.
- Added Vitest coverage in [`apps/server/src/projection/at-position.test.ts`](../../../apps/server/src/projection/at-position.test.ts) for empty-log position `0`, mid-log truncation, head equivalence, snapshot inclusion boundaries, and invalid-position rejection.
- Added Cucumber coverage in [`tests/behavior/projection/at-position.feature`](../../../tests/behavior/projection/at-position.feature) and [`tests/behavior/steps/projection-at-position.steps.ts`](../../../tests/behavior/steps/projection-at-position.steps.ts) for the empty baseline, walkthrough snapshot boundary, and head fingerprint parity.
- Refactored [`tests/behavior/steps/projection-from-log.steps.ts`](../../../tests/behavior/steps/projection-from-log.steps.ts) to reuse the shared `event-rows` DB-row mapping helpers, keeping the replay behavior seam aligned across projection scenarios.
