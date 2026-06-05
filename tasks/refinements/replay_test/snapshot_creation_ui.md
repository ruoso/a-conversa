# `snapshot_creation_ui` — snapshot-creation UI (shared-record contract)

**TaskJuggler entry**: [tasks/60-replay-and-test-mode.tji](../../60-replay-and-test-mode.tji) — task `replay_test.snapshots.snapshot_creation_ui` (under `replay_test.snapshots`, "Snapshot surfaces").

**Effort estimate**: 0.5d.

## Inherited dependencies

The `snapshots` parent block carries the two dependency edges this task inherits (`tasks/60-replay-and-test-mode.tji:115`); the leaf itself declares no further `depends`:

- `data_and_methodology.event_types.snapshot_events` — **settled**. The `snapshot-created` event kind and its payload schema live in [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) (`snapshotCreatedPayloadSchema`, lines 623–628): `{ snapshot_id: uuid, label: string (1–128), log_position: positive int }`. Snapshots are events in `session_events`, not a separate table.
- `backend.replay_endpoints.list_snapshots` — **settled** (Done; see [`tasks/refinements/backend/list_snapshots.md`](../backend/list_snapshots.md)). Ships `GET /sessions/:id/snapshots`, returning every snapshot marker for a session as `{ snapshotId, label, logPosition, createdAt }` ordered by `logPosition` ascending, gated by the session visibility predicate. Route handler: [`apps/server/src/replay/routes.ts:528`](../../../apps/server/src/replay/routes.ts); read helper `readSessionSnapshots` in [`apps/server/src/events/read.ts:222`](../../../apps/server/src/events/read.ts).
- `replay_test` stream root — `depends backend.backend_tests.be_e2e_tests.auth_flow_integration` (`tasks/60-replay-and-test-mode.tji:30`), the OIDC-handshake safety net every replay-UI leaf inherits. Settled.

**Already-delivered prerequisite (not a `.tji` edge, but the decisive context):** the snapshot-creation *user surface* this task names was built and shipped under the moderator-ui stream as `mod_snapshot_flow` (all **Done** 2026-05-31). See "What this task is" below.

## What this task is

The one-line WBS description is *"Snapshot-creation UI (lives on moderator surface; produces shared snapshot record)."* That parenthetical is load-bearing: the snapshot-creation UI **already exists**, on the moderator surface, shipped by the `moderator_ui.mod_snapshot_flow` family three weeks before this refinement was written:

- **`mod_snapshot_action`** (commit `d367db67`, Done 2026-05-31) — the trigger: sidebar [`SnapshotActionButton`](../../../apps/moderator/src/layout/SnapshotActionButton.tsx) + `Cmd/Ctrl+S` shortcut ([`useSnapshotShortcut.ts`](../../../apps/moderator/src/layout/useSnapshotShortcut.ts)), driving a module-scoped [`useSnapshotFlowStore`](../../../apps/moderator/src/layout/useSnapshotFlowStore.ts) (`isLabelInputOpen` / `open()` / `close()`). Refinement: [`mod_snapshot_action.md`](../moderator-ui/mod_snapshot_action.md).
- **`mod_snapshot_label_input`** (commit `3e46bb3c`, Done 2026-05-31) — the label modal [`SnapshotLabelInputModal`](../../../apps/moderator/src/layout/SnapshotLabelInputModal.tsx) + its mount bridge, and the WS dispatch hook [`useLabelSnapshotAction.ts`](../../../apps/moderator/src/layout/useLabelSnapshotAction.ts) (`submit(label)` → `label-snapshot` WS message → close-on-ack, `WireError` on failure). Refinement: [`mod_snapshot_label_input.md`](../moderator-ui/mod_snapshot_label_input.md).
- **`mod_snapshot_visual_marker`** (Done 2026-05-31) — the on-graph confirmation: `projectSnapshots` selector + [`SnapshotMarkerStrip`](../../../apps/moderator/src/graph/SnapshotMarkerStrip.tsx). Refinement: [`mod_snapshot_visual_marker.md`](../moderator-ui/mod_snapshot_visual_marker.md).

The whole flow is wired into the operate route at [`apps/moderator/src/routes/Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx) (imports lines 99–102; `useSnapshotShortcut()` at 153; `dataSnapshotFlowOpen` at 279; `SnapshotActionButton` at 353; `SnapshotLabelInputMount` at 367). The write-side backend it dispatches to also shipped: the WS handler `backend.websocket_protocol.ws_label_snapshot_message` ([`apps/server/src/ws/handlers/label-snapshot.ts`](../../../apps/server/src/ws/handlers/label-snapshot.ts), commit `48101a71`) and the engine helper `data_and_methodology.methodology_engine.snapshot_create_logic` ([`apps/server/src/methodology/handlers/createSnapshot.ts`](../../../apps/server/src/methodology/handlers/createSnapshot.ts), commit `55238da1`).

Given that, **this task is not a UI build.** Rebuilding a snapshot-creation surface inside `replay_test` would duplicate a shipped moderator surface — there is no second place a moderator creates snapshots, and `replay_test` renders no creation affordance of its own. What `replay_test.snapshots` genuinely needs from "snapshot creation" is the *output*: the **shared snapshot record** that its two downstream siblings consume — `snapshot_list_ui` (the list view) and `snapshot_jump_ui` (jump-to-snapshot across replay and test mode). Both read snapshots through the shared `GET /sessions/:id/snapshots` REST surface, not through any moderator in-memory store.

So this task's deliverable is to **pin the shared-snapshot-record contract end to end**: a snapshot created through the moderator write-path lands as a `snapshot-created` event in the shared session log and is then retrievable, in the same session, via `GET /sessions/:id/snapshots`. That round-trip is exactly the guarantee the `replay_test` snapshot consumers stand on, and it is the one thing about snapshot creation that the existing tests do **not** currently assert (see below).

## Why it needs to be done

`snapshot_list_ui` `depends !snapshot_creation_ui` and `snapshot_jump_ui` `depends !snapshot_list_ui` (`tasks/60-replay-and-test-mode.tji:123,128`). Those tasks will render and navigate snapshots fetched from `GET /sessions/:id/snapshots`. Before building a list/jump UI on top of that endpoint, the stream needs a committed guarantee that the records the moderator *creates* are the records that endpoint *returns* — same `snapshotId`, same `label`, same `logPosition`. Today that link is assumed, not tested:

- The **WS write** is tested in isolation — [`tests/behavior/backend/ws-label-snapshot.feature`](../../../tests/behavior/backend/ws-label-snapshot.feature) asserts the `snapshot-labeled` ack, the `event-applied` broadcast, the moderator-only gate, and the `sequence-mismatch` gate. It does not then read the snapshot back over REST.
- The **REST read** is tested in isolation — [`tests/behavior/backend/list-session-snapshots.feature`](../../../tests/behavior/backend/list-session-snapshots.feature) asserts response shape, `logPosition` ordering, the visibility 404s, and the empty-list case, but against **fixture-seeded** snapshots, not snapshots produced by the write-path.
- The **moderator e2e** ([`tests/e2e/moderator-snapshot.spec.ts`](../../../tests/e2e/moderator-snapshot.spec.ts), 8 scenarios) drives button → modal → submit → marker, but stops at the on-graph marker (fed by the projection); it never calls the REST list endpoint.

Each half is solid; the seam between them is unpinned. This task closes that seam so the list/jump tasks inherit a verified producer→consumer contract rather than an assumption.

## Inputs / context

- WBS leaf: `tasks/60-replay-and-test-mode.tji:116` (`snapshot_creation_ui`), parent block lines 114–130, group dependency line 115.
- Shared record shape: `SnapshotRecord` at [`apps/server/src/projection/types.ts:314`](../../../apps/server/src/projection/types.ts) — `{ snapshotId, label, logPosition, createdAt }`.
- Event/payload: `snapshotCreatedPayloadSchema`, [`packages/shared-types/src/events.ts:623`](../../../packages/shared-types/src/events.ts).
- Write-path engine helper: [`apps/server/src/methodology/handlers/createSnapshot.ts:82`](../../../apps/server/src/methodology/handlers/createSnapshot.ts) — mints `snapshot_id` and the envelope id (distinct), sets `log_position` to the snapshot event's own sequence.
- Write-path WS handler: [`apps/server/src/ws/handlers/label-snapshot.ts`](../../../apps/server/src/ws/handlers/label-snapshot.ts) (`label-snapshot` C→S, `snapshot-labeled` S→C, `event-applied` broadcast).
- Read-path route + helper: [`apps/server/src/replay/routes.ts:528`](../../../apps/server/src/replay/routes.ts), [`apps/server/src/events/read.ts:222`](../../../apps/server/src/events/read.ts).
- Existing round-trip-adjacent features to reuse steps from: [`tests/behavior/backend/ws-label-snapshot.feature`](../../../tests/behavior/backend/ws-label-snapshot.feature), [`tests/behavior/backend/list-session-snapshots.feature`](../../../tests/behavior/backend/list-session-snapshots.feature).
- Cucumber harness convention: ADR 0007 (Cucumber + pglite). The protocol/replay-boundary pin rule is in the refinement-writer brief: anything crossing the protocol or replay boundary gets a Cucumber scenario.
- Existing moderator e2e: [`tests/e2e/moderator-snapshot.spec.ts`](../../../tests/e2e/moderator-snapshot.spec.ts) (ADR 0008 / Playwright).

## Constraints / requirements

1. **Do not rebuild or fork the snapshot-creation UI.** The moderator surface is the single creation surface. This task adds test coverage and (if any) a thin glue assertion only — no new component, route, or store.
2. **The round-trip must use the real write-path and the real read-path**, not two fixture-seeded halves. "Create" means a `label-snapshot` WS message handled by [`label-snapshot.ts`](../../../apps/server/src/ws/handlers/label-snapshot.ts) → `snapshot-created` event appended → projection updated. "Read" means an HTTP `GET /sessions/:id/snapshots` against the same session.
3. **Assert record identity, not just count.** The `snapshotId`, `label`, and `logPosition` returned by the REST list must equal what the write-path produced (the `snapshotId` from the `snapshot-labeled` ack / `event-applied` payload, the submitted `label`, and the sequence the event landed at).
4. **Stay within the visibility gate.** The round-trip runs as a moderator (host) on their own session; the existing visibility 404 cases stay in `list-session-snapshots.feature`.
5. **No new dependency, no new architectural seam.** Reuse the existing pglite Cucumber world and the existing WS/REST step definitions.

## Acceptance criteria

Per ADR 0022, every empirical check is a committed test — no throwaway verification.

1. **Cucumber round-trip scenario (the task's primary deliverable).** A new scenario pins the producer→consumer contract: given a visible session hosted by a moderator, when the moderator labels a snapshot via the `label-snapshot` WS write-path, then `GET /sessions/:id/snapshots` for that session returns a record whose `snapshotId` matches the `snapshot-labeled` ack, whose `label` matches the submitted text, and whose `logPosition` matches the sequence the `snapshot-created` event landed at. Add a second assertion that a *second* labeled snapshot in the same session yields two records in `logPosition`-ascending order (proving accumulation, mirroring `list-session-snapshots.feature`'s ordering case but via the live write-path). Scenario lives in [`tests/behavior/backend/list-session-snapshots.feature`](../../../tests/behavior/backend/list-session-snapshots.feature) (the listability assertion is the subject), reusing the `label-snapshot` step machinery from `ws-label-snapshot.feature`. See Decision §3 for the placement rationale.
2. **No new `replay_test` Playwright spec — and this is not a deferral.** The snapshot-creation UI surface is the moderator console, which is already exhaustively Playwright-covered by [`tests/e2e/moderator-snapshot.spec.ts`](../../../tests/e2e/moderator-snapshot.spec.ts) (8 scenarios: trigger, shortcut, modal submit/escape/backdrop, marker render, marker order). `replay_test` renders no snapshot-creation affordance of its own, so a `replay_test` Playwright spec would re-test the moderator console with zero added behavior. The UI-stream e2e policy's "behavior the task adds" is, for this task, the cross-boundary shared-record contract — a backend/replay seam — and the right pin for that is Cucumber (criterion 1), not Playwright. The user-visible *creation* behavior is satisfied by the existing moderator Playwright coverage; the user-visible *consumption* behavior (a snapshot list / jump rendered in replay or test mode) is owned by `snapshot_list_ui` and `snapshot_jump_ui`, whose refinements scope their own Playwright specs.
3. **Green gate.** `make` build + the full test suite pass with the new scenario (per the global build-and-test-before-commit rule).

## Decisions

**§1 — This task is satisfied by the shipped moderator surface plus a round-trip pin; it does not build new UI.** *Rationale:* the WBS one-liner explicitly says the creation UI "lives on moderator surface," and that surface (`mod_snapshot_flow`, three leaves, all Done 2026-05-31) is the single place a moderator creates a snapshot. A debate has one moderator console; there is no replay-mode or test-mode creation affordance, by design (replay and test mode are read-only consumers of recorded sessions). Building a second creation UI under `replay_test` would be pure duplication. *Alternative rejected:* "scaffold a snapshot-creation control inside the replay/test-mode surface" — rejected because replay/test-mode operate on *completed/recorded* logs; authoring new snapshots there has no meaning in the product model and no event surface to dispatch to.

**§2 — The genuine deliverable is the create→list round-trip contract.** *Rationale:* `replay_test.snapshots`' downstream tasks consume snapshots exclusively through `GET /sessions/:id/snapshots`; the one snapshot-creation fact they depend on and that is currently untested is that moderator-created records actually surface through that endpoint. Pinning it is concrete, agent-implementable, and crosses the protocol/replay boundary (so Cucumber is the prescribed pin). *Alternative rejected:* "mark the task complete with no new artifact, citing the moderator coverage" — rejected because the write→read seam is genuinely unpinned (both halves use fixture-seeded data in isolation), and shipping the list/jump tasks on an unverified producer→consumer link is exactly the kind of silent gap the test discipline exists to prevent. A zero-artifact close would also leave nothing for the implementer to do and nothing for the Status block to point at.

**§3 — The round-trip scenario lives in `list-session-snapshots.feature`, reusing the `label-snapshot` write step.** *Rationale:* the assertion under test is *listability of a created snapshot* — the subject is the list endpoint, so the scenario belongs beside the other list scenarios, and the existing REST-list step definitions are reused directly. The `label-snapshot` write is a precondition step, reused from `ws-label-snapshot.feature`'s step library (both features share the pglite Cucumber world). *Alternative rejected:* "a brand-new dedicated round-trip feature file" — rejected as unnecessary surface area for a single contract assertion when both halves' step machinery already exists; one cohesive list feature keeps the listability invariants in one readable place. *Alternative rejected:* "put it in `ws-label-snapshot.feature`" — rejected because that feature is about the WS write protocol (acks, gates), not REST read shape; mixing a REST GET assertion there blurs the feature's subject.

**§4 — No new ADR.** *Rationale:* nothing here introduces a dependency, an architectural seam, or a security trade-off. Snapshots-as-events (ADR-settled via `snapshot_events`), the WS write-path, the REST read surface, and the visibility gate are all already decided and shipped. This is a scoping + test-coverage task; the decisions above belong in this refinement, not a new ADR.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- Added two new Cucumber round-trip scenarios to `tests/behavior/backend/list-session-snapshots.feature`: "A moderator-created snapshot is listable with matching identity (write-path → REST read)" and "Two moderator-created snapshots accumulate in logPosition-ascending order (write-path → REST read)".
- Extended `tests/behavior/steps/backend-ws-label-snapshot.steps.ts` — the `snapshot-labeled` ack step now stashes `wsLabelSnapshotId` in scratch; teardown clears it.
- Extended `tests/behavior/steps/backend-list-session-snapshots.steps.ts` — new `Then` step asserts `snapshotId` from the REST list matches `wsLabelSnapshotId` stashed from the ack.
- Both scenarios use the real `label-snapshot` WS write-path and the real `GET /sessions/:id/snapshots` REST read against the shared pglite world; they assert `snapshotId`/`label`/`logPosition` identity and ascending accumulation order.
- No new UI, no new architectural seam; no e2e deferral (creation surface is fully Playwright-covered by the moderator suite; the Cucumber pin is the right layer for this backend/replay contract).
- Closes the previously-unverified producer→consumer seam that `replay_test.snapshots.snapshot_list_ui` and `replay_test.snapshots.snapshot_jump_ui` depend on.
