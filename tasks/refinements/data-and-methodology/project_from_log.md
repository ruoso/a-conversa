# Build projection from full event log on session load

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.projection.project_from_log`
**Effort estimate**: 2d
**Inherited dependencies**: `projection_data_structure` (settled — types, `Projection` class, mutators, indices, pending-proposal map, axiom-mark and per-participant facet slots all landed).

## What this task is

Implement the on-load replay path: walk a session's full event log in `sequence` order and populate a fresh `Projection` from it. Delivers a per-event-kind dispatcher (`applyEvent`) and an entry point (`projectFromLog`) so that opening a session reads every row of `session_events`, runs each event through the dispatcher, and arrives at the projection the rest of the application reads.

## Why it needs to be done

[`docs/architecture.md` — Storage](../../../docs/architecture.md#storage) states:

> In-memory graph projection per active session, rebuilt from the session's event log (joined against the global node/edge tables) on session load and updated as events stream in.

The previous task (`projection_data_structure`) delivered the storage shape; this task delivers the population. Without it, opening a session yields an empty projection and the live graph is unrendered. Downstream consumers — `project_incrementally` (reuses the same per-event handlers for one-event apply), `per_facet_status_derivation` (reads pending proposals + commits the dispatcher records), `active_firing_computation`, the methodology engine, the API skeleton — all start from this populated projection.

## Inputs / context

- [`docs/data-model.md` — Event types + Visible-graph derivation](../../../docs/data-model.md). The thirteen event kinds and the structural rules for visibility, supersession (decompose / interpretive-split / restructure), and edge-via-broken-endpoint visibility.
- [`docs/methodology.md`](../../../docs/methodology.md) — agreement / commit / withdrawal lifecycle the projection must honor.
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts), [`projection.ts`](../../../apps/server/src/projection/projection.ts), [`projection.test.ts`](../../../apps/server/src/projection/projection.test.ts) — the storage layer this task drives.
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) and [`events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts) — discriminated-union `Event` and the eleven proposal sub-kinds the dispatcher switches on.
- [`apps/server/src/events/validate.ts`](../../../apps/server/src/events/validate.ts) — events arriving at the dispatcher have already passed schema-on-write validation per ADR 0021.
- [`docs/adr/0006-unit-test-framework-vitest.md`](../../../docs/adr/0006-unit-test-framework-vitest.md), [`docs/adr/0021-event-envelope-discriminated-union-with-zod.md`](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md), [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md).

## Constraints / requirements

- Lives under `apps/server/src/projection/` next to the storage layer; pure in-memory logic, no DB access.
- Per ADR 0010 module-shape: a single `replay.ts` exports `applyEvent(projection, event): void` and `projectFromLog(events, sessionId): Projection`. The dispatcher is the single source of truth — both replay-from-zero (this task) and incremental apply (next task) call it.
- Events arriving here have already been schema-validated; the dispatcher trusts the discriminated union type and does not re-run Zod. Cross-event referential checks (a `commit`'s `proposal_id` references a currently-pending proposal in the projection) ARE checked here — Zod can't see them.
- Per-proposal-sub-kind commit effects are **structural only**. Methodology-engine semantics (per-participant agreement-state fan-out, axiom-mark invariants, decompose component-edge rebinding, meta-move rendering) are downstream tasks and out of scope.
- Vote events: dispatcher confirms the proposal_id refers to a currently-pending proposal but defers the per-participant agreement projection to `per_facet_status_derivation` (per the methodology — facet status only changes on commit / meta-disagreement-marked).
- The `Projection` type is extended with the additional state shapes required by lifecycle events (session state, participants, snapshots, unresolved meta-disagreements). Extensions land in `types.ts` / `projection.ts`; the original storage-layer mutators are unchanged.
- All verifications are committed Vitest unit tests under `apps/server/src/projection/replay.test.ts` per ADR 0022. No throwaway probes.

## Acceptance criteria

- `apps/server/src/projection/replay.ts` exports `applyEvent`, `projectFromLog`, and `ReplayError`.
- `apps/server/src/projection/types.ts` exports `SessionState`, `ParticipantRole`, `ParticipantRecord`, `SnapshotRecord`, `UnresolvedMetaDisagreement`.
- `apps/server/src/projection/projection.ts` extends `Projection` with `sessionState` getter, `setSessionState`, participant API (`addParticipant`, `markParticipantLeft`, `getParticipantHistory`, `currentParticipants`, `participantCount`), snapshot API (`addSnapshot`, `getSnapshot`, `snapshots`, `snapshotCount`), and unresolved-meta-disagreement API (`markMetaDisagreement`, `getUnresolvedMetaDisagreement`, `unresolvedMetaDisagreements`, `unresolvedMetaDisagreementCount`).
- `apps/server/src/projection/index.ts` re-exports the new types and the replay surface.
- `apps/server/src/projection/replay.test.ts` covers every event kind happy path, the documented negative cases (vote / commit / meta-disagreement-marked of an unknown proposal id throws `ReplayError`; participant-joined/left misorderings throw; session-id mismatch throws; entity-included for an unknown entity throws; node-created duplicate throws), the visible-graph supersession rules (decompose / interpretive-split / restructure mark the parent not-visible), the per-sub-kind structural commit effects, the snapshot path, and the round-trip property (`projectFromLog(events) ≡ iterative applyEvent`).
- `pnpm run test:smoke` green; `make test` end-to-end green; `tj3 project.tjp` parses clean.

## Decisions

- **Single dispatcher, two entry points.** `applyEvent(projection, event): void` is the per-event handler; `projectFromLog(events, sessionId)` is the on-load entry point that creates an empty projection and iterates. The next task (`project_incrementally`) reuses `applyEvent` for one-event apply. Pragmatic split: the per-kind logic lives in one place; the difference between replay-from-zero and apply-one is just whether the projection started fresh.
- **Trust validation, check referential.** Events arriving at `applyEvent` have already passed the server-side `validateEvent` (ADR 0021) at append time. The dispatcher does not re-run Zod — that would double-cost every replay. What it DOES check is cross-event referential consistency (a vote's proposal id points at a pending proposal; a commit's id likewise; a node-created id is not already present; a participant-joined doesn't double-join). These checks fall outside payload validation's scope and are cheap to surface here as `ReplayError`.
- **`ReplayError` is the dispatcher's error class.** Storage-layer invariant violations (`ProjectionInvariantError`) are caught and re-wrapped with the offending event's id, kind, and sequence so the failure is diagnosable from the error message alone.
- **Vote handling is referential-check-only at this layer.** Per the methodology, vote events do not change facet status — only `commit` (which transitions the facet to `agreed`) and `meta-disagreement-marked` (which transitions to `meta-disagreement`) do. The dispatcher records that the vote referenced a real proposal and defers per-participant agreement-state projection to `per_facet_status_derivation`. This honestly mirrors the data-model rule and avoids pre-empting downstream tasks.
- **Per-proposal-sub-kind structural effects.** For `commit`, the dispatcher applies the visible-graph effect of the proposal sub-kind:
  - `classify-node` → set `classificationFacet.value` and status `agreed`.
  - `set-node-substance` / `set-edge-substance` → set the substance facet's value and status.
  - `edit-wording (reword)` → update wording in place; flip the wording facet to `agreed`.
  - `edit-wording (restructure)` → mark the old node not-visible; the paired `node-created` for the new node id is expected to have run already.
  - `decompose` / `interpretive-split` → mark parent not-visible. Component / reading nodes are added by their own `node-created` events emitted by the methodology engine; this dispatcher does NOT synthesize them.
  - `axiom-mark` → record the `(node, participant)` pair on the node's `axiomMarks` map.
  - `break-edge` → mark the edge not-visible.
  - `amend-node` → update wording in place, mirroring reword (the methodology-engine task `amend_node_logic` will distinguish if needed).
  - `meta-move` and `annotate` → no-op at this layer; the methodology engine emits paired creation events for the visible artifact. TODOs reference the downstream task.
  After applying the effect, the pending proposal is removed.
- **`entity-included` requires the entity to be in the projection already.** A single-session log is the typical case (the `*-created` event came first, then `entity-included`). Cross-session inclusion requires the loader to inject synthetic creation events from the global tables before the included event; the dispatcher surfaces the missing-entity case as `ReplayError` so a contract violation is a loud failure, not a silent skip.
- **Participants extension to `Projection`.** `participant-joined` / `participant-left` need a place to land. Per the `session_participants_table` decision (a leave-and-rejoin gets a NEW row in persistence), the projection mirrors that — `Map<userId, ParticipantRecord[]>`, with the latest record's `leftAt === null` indicating "currently joined." `currentParticipants()` filters to currently-joined; `getParticipantHistory()` returns the full ordered list.
- **`sessionState` is a single field.** `'open' | 'ended'`. Defaults to `'open'` on construction; `session-created` re-affirms; `session-ended` flips to `'ended'`.
- **Snapshots are recorded in their own map.** `snapshot-created` is a navigation marker — not a graph-affecting event. The projection holds a `Map<snapshotId, SnapshotRecord>` so the replay-primitive task can read it later without re-walking the log.
- **Unresolved meta-disagreements get their own map.** `meta-disagreement-marked` removes the proposal from `pendingProposals` and records it in `unresolvedMetaDisagreements`. Methodology-engine tasks read from this map to render the side-by-side proposed values per the data model.
- **Round-trip property test guards the dispatcher's shape-invariance.** A small fixture log is replayed via `projectFromLog` AND via iterative `applyEvent` from empty; the resulting projections must be fingerprint-equal. This is the property `project_incrementally` will lean on (different entry shape, same per-event logic).
- **No reliance on the order events are passed in beyond `sequence`-ascending.** `projectFromLog` iterates the array as given. The loader is responsible for `ORDER BY sequence ASC` in its SQL.

## Open questions

- **Meta-move and annotate commit effects** — the proposal payload identifies the target but not the resulting annotation id. Per `docs/data-model.md` "Operations that aren't graph entities live only in the change history; their *effects* (nodes added or removed, axiom rendering, etc.) appear on the graph." For meta-move that means the methodology engine emits a paired `annotation-created` with a fresh annotation id when the meta-move commits; for `annotate`, the methodology engine likewise emits a paired `annotation-created`. The dispatcher's commit-handler is therefore a no-op at this layer for those two sub-kinds. Confirming this split is precisely what the methodology engine emits is a downstream concern for `meta_move_logic` and `annotation_logic`. (Judgment call: no-op now; downstream tasks may revisit.)

- **Decompose / interpretive-split component nodes are NOT synthesized here.** The dispatcher marks the parent not-visible; the components / readings are expected to arrive as their own `node-created` events emitted by the methodology engine on commit. This keeps M1's structural scope honest (no methodology-engine logic) but means a log produced by a non-engine path (e.g. a hand-written test fixture) needs to include the component creation events explicitly. (Judgment call: deliberate boundary; documented for downstream test authors.)

## Status

**Done** 2026-05-10.

Implementation:

- `apps/server/src/projection/replay.ts` — `applyEvent`, `projectFromLog`, `ReplayError`.
- `apps/server/src/projection/types.ts` — extended with `SessionState`, `ParticipantRole`, `ParticipantRecord`, `SnapshotRecord`, `UnresolvedMetaDisagreement`.
- `apps/server/src/projection/projection.ts` — `Projection` extended with session state, participants API, snapshots API, unresolved-meta-disagreements API.
- `apps/server/src/projection/index.ts` — barrel updated.

Tests: `apps/server/src/projection/replay.test.ts` — 30 cases. Coverage: every event kind happy path; participant join/leave/rejoin and the misorder negatives; entity-included no-op + missing-entity throw; node-created duplicate throw; the walkthrough (3 participants, 2 nodes, 1 edge, classify proposal, 3 agree votes, commit) asserting facet value + cleared pending proposal; vote / commit / meta-disagreement-marked of an unknown proposal throw; meta-disagreement records the unresolved entry and clears pending; per-sub-kind structural commit effects (classify-node, set-node-substance, set-edge-substance, edit-wording reword + restructure, decompose, interpretive-split, axiom-mark, break-edge, amend-node); snapshot-created records without affecting the graph; session-id mismatch throws; round-trip property `projectFromLog ≡ iterative applyEvent`; empty-log returns a fresh projection.

`pnpm run test:smoke` green (226 tests). `make test` end-to-end green (226 unit + 36 cucumber + 1 playwright). `tj3 project.tjp` parses clean.

`tasks/10-data-and-methodology.tji` updated: `complete 100` and `note "Refinement: ..."` added to `project_from_log`.

### Follow-up — behavior tests at the DB-round-tripped layer (2026-05-10)

The Vitest tests at `apps/server/src/projection/replay.test.ts` cover the
per-event-kind dispatcher logic in isolation (events constructed as TS
literals). A complementary Cucumber+pglite layer was added at
`tests/behavior/projection/from-log.feature` (with step definitions in
`tests/behavior/steps/projection-from-log.steps.ts`) that exercises the
**DB-round-tripped** path — events inserted into pglite's
`session_events`, SELECTed back out, mapped through `validateEvent` to
typed `Event` envelopes, and replayed by `projectFromLog`. This is the
layer that catches JSONB encoding quirks, TIMESTAMPTZ-vs-ISO-string
mismatches, and BIGINT-vs-number issues that pure in-memory tests
cannot see.

Five scenarios:

- Empty-fixture replay (via `loadFixture('empty', client)`) — assert
  `sessionState='open'`, zero nodes/edges, three participants in
  canonical roles.
- classify-node commit drives the projection — assert the node's
  classification facet has the committed value with status `agreed`.
- decompose commit makes the parent invisible — assert parent
  `visible=false`; components remain visible.
- snapshot-created lands as a snapshot record — assert
  `getSnapshot(id)` returns the record with the right label and
  log_position.
- **Round-trip equality probe** (per ADR 0022 — the committed probe):
  insert a meta-move proposal with content + meta_kind + target_kind +
  target_id, SELECT back out, `deepEqual` the JSONB payload against
  the originally-inserted literal, run `validateEvent`, and replay —
  the load-bearing assertion that no payload field is lost or
  re-typed in the round trip.

Both test layers (`replay.test.ts` and `from-log.feature`) run as part
of `make test`.
