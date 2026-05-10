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

## Open questions

- **JSONB payload validation: schema-on-read vs. schema-on-write?**
  - **Schema-on-write**: validate the payload against a JSON schema in the application before insert. Stronger guarantee; payload bugs caught at write time.
  - **Schema-on-read**: validate when projecting. Faster writes; payload bugs surface during projection.
  - **My instinct: schema-on-write** at the application layer (`event_validation` task already exists for this). Confirm.
- **Should `sequence` be enforced monotonic via a trigger, or rely on the application?**
  - **Trigger / DEFAULT** (e.g., `BIGSERIAL` per session via window function): unusual in PostgreSQL; usually done in the application by selecting `MAX(sequence)+1` inside the same transaction.
  - **Application-managed** with a unique constraint as the safety net.
  - **My instinct: application-managed with the unique constraint** as the safety net. Single writer per session (server-authoritative) makes this safe. Confirm.
- **Retention.** Events accumulate indefinitely. Is there a v1 retention policy? **My instinct: no automatic retention in v1** — the change history is part of the product (replay). Confirm.
