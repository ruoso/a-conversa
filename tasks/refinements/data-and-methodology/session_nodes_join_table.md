# `session_nodes` join table

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.schema.session_nodes_join_table`
**Effort estimate**: 0.25d
**Inherited dependencies**: `data_and_methodology.schema.sessions_table`, `data_and_methodology.schema.nodes_table` (both settled)

## What this task is

Define and create the `session_nodes` M-N join table that records which (global) nodes a session **has ever referenced**. A row is added when a session begins referencing a node — either because it just got created in this session or because the session is importing it from another session (cross-session reference per [docs/architecture.md — cross-session reference permissions](../../../docs/architecture.md#cross-session-reference-permissions)).

The table is an **index into the event log**, not a representation of the visible-graph state. A node that is no longer visible in the session's current rendering (e.g., it was decomposed and replaced by components, interpretively-split, or restructured-and-replaced) still has its `session_nodes` row — the visible-graph state is **computed from the event log**, not derived from this table. session_nodes serves two purposes only: (1) bootstrapping the projection (which global node rows to fetch) and (2) cross-session permission checks (was this node ever in this session?).

## Why it needs to be done

Without this table the system can't enumerate a session's graph. Session projection (`data_and_methodology.projection.project_from_log`) reads the session's events plus the session_nodes/session_edges joins to know which global entities to include.

## Inputs / context

From [docs/architecture.md — storage](../../../docs/architecture.md#storage):

> Session tables: `sessions`, `session_participants`, `session_nodes` and `session_edges` (M-N joins recording which graph entities each session includes), and a per-session append-only `session_events` table — the event log.

From [docs/architecture.md — sessions and the global graph](../../../docs/architecture.md#sessions-and-the-global-graph):

> A node may appear in many sessions; a session contains many nodes and edges. This lets one session build on top of another — a debate in session B can reference a node that was first introduced in session A, citing prior establishment without recreating it.

From [docs/data-model.md — event types — session inclusion](../../../docs/data-model.md#session-inclusion):

> entity-included — the session begins referencing an existing global entity. Payload: session id, entity-id, by-whom, timestamp.

## Constraints / requirements

- Pure join: a row links one session to one node.
- Records who included it and when (matches the `entity-included` event payload).
- A node can only be in a given session once (no duplicate inclusions).
- Cross-session permission checks happen at the application layer (see `backend.cross_session_permissions`); the table itself just records inclusions.

## Acceptance criteria

- A migration creating the `session_nodes` table with these columns:
  - `session_id` — FK to `sessions`, part of composite PK.
  - `node_id` — FK to `nodes`, part of composite PK.
  - `included_by` — FK to `users` (the participant who included this node).
  - `included_at` — timestamp.
- Composite primary key on `(session_id, node_id)`.
- Foreign-key constraints on all three FKs.
- An index on `node_id` for "in which sessions does this node appear?" queries (the inverse-permission query).
- The migration runs cleanly in the local dev Compose stack.

## Decisions

- **Composite PK** on `(session_id, node_id)` (R9). Departure from the project-wide UUID-PK convention; M-N join tables are the standard exception.
- **Monotonic inclusion as an event-log index** (R10, clarified). No `removed_at` column. The table records "this node has been referenced in this session at some point." The visible-graph state is computed from the session's event log, not from this table — events such as decomposition, interpretive-split, or restructure-and-replace remove a node from the *visible* graph while leaving its `session_nodes` row in place.

## Open questions

(none — all decided)
