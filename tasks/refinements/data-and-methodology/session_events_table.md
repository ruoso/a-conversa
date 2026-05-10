# `session_events` append-only event log

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.schema.session_events_table`
**Effort estimate**: 1d
**Inherited dependencies**: `data_and_methodology.schema.sessions_table` (settled)

## What this task is

Define and create the per-session append-only event-log table — the canonical record of every state transition in a session. The graph projection is computed from this log; replay walks this log; snapshots are named positions in this log.

## Why it needs to be done

Per the architecture, **the event log is the source of truth.** Every other table (the `nodes`/`edges`/`annotations` global tables, the M-N joins) records *what entities exist*; this table records *what happened*. The two combine to produce the projected session state.

## Inputs / context

From [docs/architecture.md — state model: event-sourced](../../../docs/architecture.md#state-model-event-sourced):

> The event log is the source of truth: every per-facet status transition, every axiom mark, every decomposition / interpretive split / meta-move, every withdrawal of agreement, with proposer, per-participant agreement state, and timestamp.

From [docs/architecture.md — storage](../../../docs/architecture.md#storage):

> a per-session append-only `session_events` table — the event log.

From [docs/data-model.md — event types](../../../docs/data-model.md#event-types):

The full event-type catalog. Categories:

- **Session lifecycle:** `session-created`, `session-ended`, `participant-joined`, `participant-left`.
- **Global entity creation:** `node-created`, `edge-created`, `annotation-created`.
- **Session inclusion:** `entity-included`.
- **Proposals:** discriminated by `kind` — `classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`, `decompose`, `interpretive-split`, `axiom-mark`, `meta-move`, `break-edge`, `amend-node`, `annotate`.
- **Votes:** `vote` (agree / dispute / withdraw on a proposal).
- **Resolutions:** `commit`, `meta-disagreement-marked`.
- **Snapshots:** `snapshot-created`.

Each event has a common envelope plus kind-specific payload.

## Constraints / requirements

- **Append-only.** No updates, no deletes; the application enforces this. (DB-level enforcement via revoking UPDATE/DELETE permissions on the running app's role can be added in production.)
- **Per-session ordering.** Each session has its own monotonically-increasing event sequence. A `(session_id, sequence)` pair uniquely identifies an event within a session.
- **Globally unique event id** for cross-session references (e.g., a snapshot pointing at a specific event).
- **Fine-grained granularity** — every per-facet transition, every individual participant vote, every commit is its own row. Per `docs/data-model.md`: "Granularity is fine-grained: each individual proposal, each individual participant vote, each individual commit is its own event."
- **Schema must accommodate the discriminated union** of event kinds with different payloads.

## Acceptance criteria

- A migration creating the `session_events` table with these columns:
  - `id` — primary key, **UUID**.
  - `session_id` — FK to `sessions`.
  - `sequence` — monotonically-increasing integer per session (e.g., `BIGINT NOT NULL`).
  - `kind` — `TEXT` with `CHECK` listing the supported event kinds.
  - `actor` — FK to `users` (the participant who caused the event; nullable for system-generated events if any).
  - `payload` — `JSONB` holding the kind-specific payload.
  - `created_at` — timestamp.
- Foreign-key constraints on `session_id` and `actor`.
- A unique constraint on `(session_id, sequence)` — sequence must be monotonic within a session.
- An index on `(session_id, sequence)` for the ordered-replay query.
- An index on `(session_id, kind)` for filtered queries (e.g., "show me all axiom-marks in this session").
- An index on `(session_id, created_at)` for time-based filtering.
- Application-level enforcement: **no UPDATE, no DELETE**. (Revoke at the role level in production deploy work.)
- The migration runs cleanly in the local dev Compose stack.

## Decisions

- **Primary key type: UUID** (CC1).
- **Kind: `TEXT` with `CHECK` constraint** (CC2). The CHECK lists every event kind from the catalog.
- **Payload: `JSONB`** — discriminated payload per event kind. The application owns the per-kind payload schema (validated at the event-validation step in `data_and_methodology.event_types.event_validation`).
- **Append-only** — application contract; the table doesn't itself prevent updates, but the app's role won't have UPDATE/DELETE in production.
- **Per-session monotonic sequence** — gives strict ordering within a session for replay purposes; a global timestamp alone isn't reliable enough under concurrent writes.

## Additional decisions

- **Payload validation: schema-on-write** (R11). The application validates each event's JSONB payload against a per-kind schema before insert; payload bugs are caught at write time. The existing `data_and_methodology.event_types.event_validation` task is where this lives.
- **Sequence: application-managed monotonic per session** (R12). The server selects `MAX(sequence)+1` inside the same transaction that inserts the event. Single-writer-per-session (server-authoritative model) makes this safe. The unique constraint on `(session_id, sequence)` is the safety net.
- **Retention: none in v1** (R13). The change history is part of the product (replay). Events accumulate indefinitely. Revisit if storage becomes an operational concern.

## Open questions

(none — all decided)

## Status

**Done** 2026-05-10. Migration: [`apps/server/migrations/0010_session_events.sql`](../../../apps/server/migrations/0010_session_events.sql).

**Event-kind treatment.** Single `'proposal'` envelope kind, payload-discriminated. `docs/data-model.md` (Event types — Proposals) is explicit that all proposals share the same lifecycle and "vary in payload by `kind`", so the envelope-level CHECK lists `'proposal'` once and the inner discrimination (`classify-node` / `set-node-substance` / `set-edge-substance` / `edit-wording` / `decompose` / `interpretive-split` / `axiom-mark` / `meta-move` / `break-edge` / `amend-node` / `annotate`) lives in the payload. The migration's SQL header documents the choice and lists every sub-kind for reviewers.

**CHECK kind list (envelope-level, in order):** `session-created`, `session-ended`, `participant-joined`, `participant-left`, `node-created`, `edge-created`, `annotation-created`, `entity-included`, `proposal`, `vote`, `commit`, `meta-disagreement-marked`, `snapshot-created`.

**Verified behaviors** (against a fresh `make up` + `make migrate` stack):

- `\d session_events` shows all expected columns (`id`, `session_id`, `sequence`, `kind`, `actor`, `payload`, `created_at`), the FK to `sessions` and `users` (both `ON DELETE RESTRICT`), the kind CHECK with the full catalog, the `(session_id, sequence)` unique constraint, and indexes on `(session_id, kind)` and `(session_id, created_at)`. The unique constraint's B-tree on `(session_id, sequence)` is the ordered-replay index — no separate redundant index added.
- Insert with `sequence=1`, `kind='session-created'`, well-formed JSONB payload — succeeds.
- Insert duplicate `(session_id, sequence)=(s, 1)` — fails on `session_events_session_id_sequence_key` unique constraint.
- Insert with `kind='unknown-kind'` — fails on `session_events_kind_check`.
- Insert with bogus `session_id` — fails on `session_events_session_id_fkey`.
- Insert with `actor=NULL` — succeeds (nullable per refinement; leaves room for future system-generated events).
- Insert with bogus `actor` UUID — fails on `session_events_actor_fkey`.
- `make down-v` cleans up cleanly.

**Deferred (out of scope for this migration):**

- Per-kind JSONB payload schemas — owned by the various `data_and_methodology.event_types.*` tasks (envelope, lifecycle, entity-creation, inclusion, proposal, vote, resolution, snapshot).
- Schema-on-write payload validator — owned by `data_and_methodology.event_types.event_validation`.
- DB-level append-only enforcement (revoke UPDATE/DELETE on the running app's role) — production-deploy concern; the contract is application-level today.
- Application-side sequence allocator (`MAX(sequence)+1` in-transaction) — owned by the application layer; the unique constraint here is the safety net.
