# Resolve a named snapshot to its log position

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.replay_primitive.snapshot_resolution` at lines 584-588 (inside the `replay_primitive` block, lines 571-589).

## Effort estimate

**0.5d** (per the `.tji` allocation).

## Inherited dependencies

- `data_and_methodology.replay_primitive.project_at_position` (**settled**, `depends !project_at_position`). The replay primitive landed on `main`: [`apps/server/src/projection/at-position.ts`](../../../apps/server/src/projection/at-position.ts) exports `projectAtPosition(events, sessionId, position)`, `replayHeadSequence`, and `ReplayPositionError`, with the position contract pinned by [`tasks/refinements/data-and-methodology/project_at_position.md`](./project_at_position.md). Snapshot resolution produces a **position** in exactly that vocabulary; the resolved number is what a consumer hands to `projectAtPosition` to render.
- `data_and_methodology.replay_primitive.position_navigation` (**settled**, sibling). [`apps/server/src/projection/position-navigation.ts`](../../../apps/server/src/projection/position-navigation.ts) established the precedent that **navigation arithmetic lives in the projection package, pure and Vitest-pinned**, leaving rendering to `projectAtPosition`. This task is the snapshot-granularity analogue of that event-granularity stepping: where `position_navigation` answers "what is the next/prev *event* stop," this answers "where does *this named snapshot* sit" and "what is the next/prev *chapter* stop." Refinement: [`tasks/refinements/data-and-methodology/position_navigation.md`](./position_navigation.md).
- `data_and_methodology.event_types.snapshot_events` (**settled**, ambient). [`packages/shared-types/src/events.ts:623-631`](../../../packages/shared-types/src/events.ts) defines `snapshotCreatedPayloadSchema` — `{ snapshot_id: UUID, label: string (1..MAX_SNAPSHOT_LABEL_LENGTH), log_position: positive int }`. Refinement: [`tasks/refinements/data-and-methodology/snapshot_events.md`](./snapshot_events.md). The projector materialises these into `SnapshotRecord`s (see Inputs); resolution reads those records.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) (**settled**). Resolution behaviour must be pinned by committed coverage, not ad hoc probes.

**Pending:** (none — every load-bearing decision is already on `main`; no new ADR is required.)

## What this task is

Add the **snapshot-resolution seam** on top of the replay primitive: given the snapshot records the projector has materialised for a session and a snapshot identifier, return the **log position** (event-sequence number) that snapshot was taken at — the number a consumer feeds to `projectAtPosition` to render the graph "as of that snapshot." It also provides the snapshot-granularity navigation that chapter-jumping needs: the ordered list of snapshot positions (chapter markers) and the next/prev snapshot position relative to an arbitrary current position.

The deliverable is a small, pure helper module beside `position-navigation.ts` — `apps/server/src/projection/snapshot-resolution.ts` — exporting `resolveSnapshotPosition`, `snapshotPositions`, `nextSnapshotPosition`, `prevSnapshotPosition`, and a dedicated `SnapshotNotFoundError`. Resolution computes *positions only*; rendering at a position remains `projectAtPosition`'s job and stepping between adjacent events remains `position_navigation`'s. The three seams compose: snapshot resolution decides **which** stop a named chapter is, navigation decides **where** the next event/chapter stop is, and the replay primitive renders the graph **there**.

## Why it needs to be done

`projectAtPosition` can render at any sequence and `position_navigation` can step ±1, but nothing yet maps a **named snapshot** to a position. A snapshot is a label the moderator attached to a moment ("Segment 1 close"); replay and test-mode surfaces let the audience and operators jump straight to those moments. The direct WBS consumer is the replay viewer's chapter jumping:

- [`tasks/60-replay-and-test-mode.tji:63-66`](../../60-replay-and-test-mode.tji) — `replay_chapter_jumping` ("Jump to next/prev snapshot via chapter markers") `depends ... data_and_methodology.replay_primitive.snapshot_resolution`.

The snapshot surfaces group ([`tasks/60-replay-and-test-mode.tji:114-128`](../../60-replay-and-test-mode.tji) — `snapshot_jump_ui` "Jump-to-snapshot action across replay and test mode") is the second-order consumer: it surfaces the snapshot list and jumps to a chosen one. Without one canonical "snapshot → position" definition, every replay/test-mode surface would re-derive its own "find the record, read its position, find the next marker after here" sort-and-search — the same fragmentation `position_navigation` centralised for event stepping. Keeping this arithmetic in the projection package, pure and tested, gives every chapter/jump surface one notion of "where a snapshot is" and one notion of "next/prev chapter."

## Inputs / context

- [`apps/server/src/projection/types.ts:314-319`](../../../apps/server/src/projection/types.ts) — `SnapshotRecord { snapshotId: string; label: string; logPosition: number; createdAt: string }`. This is the materialised shape resolution operates over; `logPosition` is already the event-sequence number — resolution's job is the lookup/ordering around it, not deriving the position.
- [`apps/server/src/projection/projection.ts:461-478`](../../../apps/server/src/projection/projection.ts) — the projector's snapshot store. `addSnapshot` (461-466) **throws `ProjectionInvariantError` on a duplicate `snapshotId`**, so id uniqueness is an invariant resolution can rely on. `getSnapshot(snapshotId)` (468-470) returns the record or `undefined`; `snapshots()` (472-474) iterates records in **insertion order** (a `Map` — not position order); `snapshotCount()` (476-478). Labels carry **no** uniqueness invariant (see Decision §1).
- [`apps/server/src/projection/at-position.ts:25-49`](../../../apps/server/src/projection/at-position.ts) — `replayHeadSequence(events)` (25-27) and `projectAtPosition(events, sessionId, position)` (35-49). A resolved snapshot position is a valid input to `projectAtPosition`; out-of-range positions are already rejected there with `ReplayPositionError` (see Decision §4). Resolution does **not** re-validate against head.
- [`apps/server/src/projection/position-navigation.ts:1-42`](../../../apps/server/src/projection/position-navigation.ts) — the sibling precedent: pure position arithmetic, reuses `ReplayPositionError` / `replayHeadSequence`, computes positions only, Vitest-only. Snapshot resolution mirrors its shape and testing discipline.
- [`apps/server/src/projection/index.ts:59-60`](../../../apps/server/src/projection/index.ts) — the projection barrel re-exports `projectAtPosition, replayHeadSequence, ReplayPositionError` and the navigation surface; snapshot resolution's exports join here.
- [`packages/shared-types/src/events.ts:623-631`](../../../packages/shared-types/src/events.ts) — `snapshotCreatedPayloadSchema`: `snapshot_id` (UUID), `label` (1..`MAX_SNAPSHOT_LABEL_LENGTH`), `log_position` (positive int). `log_position` is "the session's sequence at the time the snapshot is taken" (snapshot_events.md).
- [`apps/server/src/projection/at-position.test.ts`](../../../apps/server/src/projection/at-position.test.ts) and [`apps/server/src/projection/position-navigation.test.ts`](../../../apps/server/src/projection/position-navigation.test.ts) — the precedent Vitests hand-build `Event` lists (including `snapshot-created` events) via local helpers; resolution's Vitest follows that hand-built style.
- The walkthrough fixture's "Segment 1 close" snapshot lands at `log_position 265` (snapshot event `sequence 266`) in [`packages/test-fixtures/src/fixtures/walkthrough/events.json`](../../../packages/test-fixtures/src/fixtures/walkthrough/events.json); [`tests/behavior/projection/at-position.feature`](../../../tests/behavior/projection/at-position.feature) already pins projection at that snapshot's position. Referenced as a sanity anchor (see Decision §5).
- [`tasks/60-replay-and-test-mode.tji:63-66`](../../60-replay-and-test-mode.tji) — `replay_chapter_jumping`, the per-chapter consumer that depends on this task; its Playwright lives there (see Acceptance criteria).

## Constraints / requirements

- Lives at `apps/server/src/projection/snapshot-resolution.ts`; pure in-memory logic only. No DB, no cache, no WS, no projecting.
- Operates over **`readonly SnapshotRecord[]`** (what a caller gets from `Array.from(projection.snapshots())`), mirroring how `position_navigation` operates over `readonly Event[]` rather than a live `Projection`. This keeps the helpers pure and unit-testable without standing up a full projection, and keeps the `Projection` class as the single owner of the snapshot store.
- Position is **event-sequence space**, identical to `projectAtPosition` / `position_navigation` (`logPosition` is already in that space). Resolution never invents a new position vocabulary.
- **Canonical key is `snapshotId`** (UUID, unique by the `addSnapshot` invariant). Label-based lookup is **not** a data-layer responsibility — labels carry no uniqueness guarantee (see Decision §1).
- `resolveSnapshotPosition` returns a bare `number`; an unknown id **throws `SnapshotNotFoundError`** (loud-contract style, matching `ReplayPositionError`). It does not return a sentinel — `0` is a valid position (pre-history), so there is no spare number to mean "absent" (see Decision §2).
- Resolution does **not** validate the resolved position against a head sequence — it has only the snapshot records, not the event log. `projectAtPosition` already rejects an out-of-range position with `ReplayPositionError`, keeping position validation single-sourced one layer down (see Decision §4).
- Chapter navigation (`nextSnapshotPosition` / `prevSnapshotPosition`) is computed over snapshot positions sorted ascending and de-duplicated; "next" / "prev" are the nearest snapshot position **strictly** greater / less than the current position. Absence of a further chapter returns **`null`** (not saturation), so a chapter UI can disable its affordance (see Decision §3).
- Resolution does **not** project and does **not** step events. It returns positions; consumers pass the result to `projectAtPosition` (or the future `backend.replay_endpoints.get_at_position` endpoint) to render, and to `position_navigation` to fine-step.
- Internal pure helper consumed by other unit-tested code and (later) a UI task → Vitest is the correct pin; this is **not** a UI-stream task and does **not** change wire behaviour, broadcast shape, or projector output (see Decision §5).

## Acceptance criteria

- `apps/server/src/projection/snapshot-resolution.ts` exports:
  - `resolveSnapshotPosition(snapshots: readonly SnapshotRecord[], snapshotId: string): number`
  - `snapshotPositions(snapshots: readonly SnapshotRecord[]): number[]` — snapshot `logPosition`s, ascending and de-duplicated (the chapter markers).
  - `nextSnapshotPosition(snapshots: readonly SnapshotRecord[], position: number): number | null`
  - `prevSnapshotPosition(snapshots: readonly SnapshotRecord[], position: number): number | null`
  - `SnapshotNotFoundError` (carrying the offending `snapshotId`).
- `apps/server/src/projection/index.ts` re-exports `resolveSnapshotPosition`, `snapshotPositions`, `nextSnapshotPosition`, `prevSnapshotPosition`, and `SnapshotNotFoundError`, alongside the existing `projectAtPosition` / navigation lines.
- Behaviour:
  - `resolveSnapshotPosition` returns the record's `logPosition` for a known id; throws `SnapshotNotFoundError` (naming the id) for an unknown id; throws the same for an empty snapshot list.
  - `snapshotPositions` returns positions ascending with duplicates collapsed; returns `[]` for no snapshots; order is independent of the records' insertion order.
  - `nextSnapshotPosition`: from a position before the first marker → the first marker; from on/between markers → the nearest marker strictly greater; from on/after the last marker → `null`; empty list → `null`.
  - `prevSnapshotPosition`: from a position after the last marker → the last marker; from on/between markers → the nearest marker strictly less; from on/before the first marker → `null`; empty list → `null`.
- Vitest coverage at `apps/server/src/projection/snapshot-resolution.test.ts` (hand-built `SnapshotRecord` lists, mirroring `position-navigation.test.ts`) includes:
  - resolve-by-id hit and `SnapshotNotFoundError` miss (unknown id, empty list), asserting the error names the id;
  - `snapshotPositions` ascending + de-dup + insertion-order-independence (feed records out of position order and with two records sharing a `logPosition`);
  - `nextSnapshotPosition` / `prevSnapshotPosition` truth tables: before-first, on-a-marker, between-markers, on/after-last, and the empty-list `null` case, for both directions;
  - a **composition check**: resolve a snapshot, pass the result to `projectAtPosition` over a hand-built log whose snapshot-created event sits at that position, and assert the returned projection's `lastAppliedSequence` equals the resolved position (pins resolution against the replay primitive in-process, mirroring `position_navigation`'s composition test).
- **No Cucumber and no Playwright for this task.** Resolution is a pure helper that does not change wire behaviour, broadcast shape, or projector output; the replay-boundary crossing it enables (projecting at a snapshot's position) is already Cucumber-pinned by [`tests/behavior/projection/at-position.feature`](../../../tests/behavior/projection/at-position.feature) (which projects at the walkthrough "Segment 1 close" snapshot position). The user-visible chapter jumping is the Playwright scope of `replay_chapter_jumping` ([tasks/60-replay-and-test-mode.tji:63](../../60-replay-and-test-mode.tji)), which independently owns that e2e — **no deferred-e2e debt is registered against any future task here** (resolution is not UI-reachable; chapter jumping's Playwright is its own scope, not inherited from this task).
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean after the closer marks completion (ADR 0022: committed coverage, not throwaway verification).

## Decisions

- **§1 — Canonical key is `snapshotId`, not `label`.** Rationale:
  - `addSnapshot` ([projection.ts:461-466](../../../apps/server/src/projection/projection.ts)) throws on a duplicate `snapshotId`, so ids are unique by invariant — a clean primary key for a function that must return exactly one position. Labels carry no uniqueness guarantee (`snapshotCreatedPayloadSchema` only caps length), so a label can map to several positions; a "resolve label → position" function would have to invent collision semantics with no authority to do so.
  - The realistic consumer flow already holds the id: chapter-jumping and jump-to-snapshot UIs render a list of `SnapshotRecord`s (each carrying its id) and resolve the one the user picked. The human-readable *name* lives in the record's `label`; the machine key is the id.
  - Alternative considered: `resolveSnapshotLabel(snapshots, label) → number`. Rejected for the data layer — ambiguous on collision, and the UI that owns label display can map its selected row's id without a label search. If a label-search ever has a concrete call site (e.g. a deep-link by label), it is a thin UI-side filter over `snapshots()`, added there with its chosen collision rule — this refinement registers no follow-up WBS task for it (no concrete agent-implementable data-layer work today).

- **§2 — `resolveSnapshotPosition` throws on miss rather than returning `number | undefined`.** Rationale:
  - The return is a bare position, and `0` is a *valid* position (pre-history baseline, inherited from `projectAtPosition`), so there is no spare number to signal "absent." Returning `number | undefined` would force every caller to guard before passing to `projectAtPosition`.
  - The projection stream's style is loud enforcement (`ReplayPositionError`, `OutOfOrderEventError`, `ProjectionInvariantError`); an id that does not resolve — when the caller got it from this session's snapshot list — is a caller bug, so a dedicated `SnapshotNotFoundError` is consistent and gives consumers a precise failure. The error mirrors `ReplayPositionError`'s shape (a small `Error` subclass carrying the offending value); it is a local helper class, not a new architectural seam, so no ADR is required.
  - Alternative considered: return `undefined`, matching `getSnapshot`'s `undefined`-on-miss. Rejected — `getSnapshot` returns the whole record (which has a natural absent value); a *position* does not, and the loud contract keeps the happy-path type a clean `number`.

- **§3 — Chapter navigation returns `null` at the ends, rather than saturating like `position_navigation`.** Rationale:
  - Snapshots are **sparse** markers, not the contiguous per-event stops `position_navigation` steps over. There, saturating to the boundary and exposing `isAtStart`/`isAtEnd` predicates is natural because every integer in range is a real stop. For sparse chapters, saturating "next at/after the last chapter" to the last chapter is an indistinguishable no-op; a chapter UI needs to know "there is no next chapter" to disable its button. A `null` sentinel answers that directly without a second predicate function.
  - "Strictly greater / strictly less than the current position" is the right relation because the scrubber's current position is usually *not* on a snapshot — chapter-jump means "advance to the next labelled moment after wherever I am."
  - Alternative considered: mirror `position_navigation` exactly with saturation + `isAtFirstSnapshot`/`isAtLastSnapshot` predicates. Rejected — more surface for the same information, and saturation hides the "no further chapter" case the chapter UI must act on. The contrast with `position_navigation` is intentional and reflects sparse-vs-contiguous stops.

- **§4 — Resolution does not re-validate the position against a head sequence.** Rationale:
  - Resolution receives only `SnapshotRecord[]`, not the event log, so it *cannot* compute `replayHeadSequence` without the caller also threading events through — pure coupling for no gain. A snapshot's `logPosition` came from a real event in that session's log, so within a session it is inherently `<= head`.
  - Position validation already lives, single-sourced, in `projectAtPosition` / the navigation helpers (`assertValidPosition`, [at-position.ts:29-33](../../../apps/server/src/projection/at-position.ts)). If a consumer crosses a snapshot list with the wrong session's log (a bug), the resolved position is rejected one layer down with `ReplayPositionError`. Duplicating that guard here would split the "what is a valid position" authority.
  - Alternative considered: also take `events` and assert `logPosition <= head`. Rejected — couples resolution to the log it deliberately avoids, and double-sources position validation.

- **§5 — Vitest-only; no Cucumber, no Playwright.** Rationale:
  - Per the backend-task testing rule, Vitest is the right pin for an internal helper consumed by other unit-tested code that does **not** change wire behaviour, broadcast shape, or projector output. Resolution produces *positions* from already-materialised records; it crosses no protocol or replay boundary. The boundary-crossing it enables (projecting at a snapshot's position) is already Cucumber-pinned by `at-position.feature`, which projects at the walkthrough "Segment 1 close" snapshot position.
  - The composition Vitest case (resolve → `projectAtPosition` → assert `lastAppliedSequence`) ties resolution to the real primitive in-process, so a Cucumber/DB round-trip would add latency without new signal — the same call `position_navigation` made.
  - Not a UI-stream task (no route renders it, no event surface drives it), so the UI-stream e2e policy does not apply; the user-visible chapter jumping is the Playwright scope of `replay_chapter_jumping` ([tasks/60-replay-and-test-mode.tji:63](../../60-replay-and-test-mode.tji)).
  - Alternative considered: a Cucumber scenario that DB-loads the walkthrough fixture and resolves "Segment 1 close" by id to `265` before projecting. Rejected as redundant with `at-position.feature` (which already pins projection at that snapshot's position) — the resolution arithmetic is pure and fully covered by Vitest, including a fixture-positioned snapshot in the composition test.

- **§6 — Surface kept to resolve + chapter markers + chapter next/prev; operates over `SnapshotRecord[]`.** Rationale:
  - The only current WBS consumer is `replay_chapter_jumping`, which needs exactly "where is this snapshot" and "what is the next/prev chapter." Building only for today's call sites matches the predecessor's discipline ([position_navigation.md Decision §6](./position_navigation.md)).
  - Taking `readonly SnapshotRecord[]` (rather than a live `Projection`) keeps the helpers pure and lets tests hand-build inputs, exactly as `position_navigation` takes `readonly Event[]`; the `Projection` class stays the single owner of the snapshot store.
  - Out of scope: snapshot *creation* / labelling (already `data_and_methodology.event_types.snapshot_events` + the WS label handler) and list serialisation for the wire (`backend.replay_endpoints.list_snapshots`). This task is read-side position arithmetic only; it adds no event, no broadcast, no endpoint.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-03.

- Created `apps/server/src/projection/snapshot-resolution.ts` — exports `resolveSnapshotPosition`, `snapshotPositions`, `nextSnapshotPosition`, `prevSnapshotPosition`, and `SnapshotNotFoundError`.
- Created `apps/server/src/projection/snapshot-resolution.test.ts` — 16 Vitest tests covering resolve-by-id hit and `SnapshotNotFoundError` miss (unknown id, empty list, names id); `snapshotPositions` ascending/de-dup/insertion-order-independence; `nextSnapshotPosition`/`prevSnapshotPosition` truth tables (before-first, on-marker, between, on/after-last, empty→null) both directions; composition check (resolve → `projectAtPosition` → assert `lastAppliedSequence`).
- Edited `apps/server/src/projection/index.ts` — barrel re-exports all five new symbols alongside existing navigation/position exports.
- No Cucumber/Playwright (pure helper, no UI-stream/wire boundary); chapter jumping's Playwright belongs to `replay_chapter_jumping`.
- No tech-debt follow-up registered (resolution is not UI-reachable; the `replay_chapter_jumping` task owns its own e2e scope).
