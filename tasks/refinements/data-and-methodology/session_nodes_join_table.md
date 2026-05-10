# `session_nodes` join table

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.schema.session_nodes_join_table`
**Effort estimate**: 0.25d
**Inherited dependencies**: `data_and_methodology.schema.sessions_table`, `data_and_methodology.schema.nodes_table` (both settled)

## What this task is

Define and create the `session_nodes` M-N join table that records which (global) nodes a session references. A row is added when a session begins referencing a node — either because it just got created in this session or because the session is importing it from another session (cross-session reference per [docs/architecture.md — cross-session reference permissions](../../../docs/architecture.md#cross-session-reference-permissions)).

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
- **Monotonic inclusion** (R10). No `removed_at` column. Once a session includes a node, it stays included. Sessions can mark events for the node as withdrawn or amend the node, but the inclusion itself is monotonic.

## Open questions

(none — all decided)
