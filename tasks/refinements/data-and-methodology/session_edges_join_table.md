# `session_edges` join table

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.schema.session_edges_join_table`
**Effort estimate**: 0.25d
**Inherited dependencies**: `data_and_methodology.schema.sessions_table`, `data_and_methodology.schema.edges_table` (both settled)

## What this task is

Define and create the `session_edges` M-N join table — sister to `session_nodes`. Records which (global) edges a session **has ever referenced**.

Same semantics as `session_nodes`: this table is an index into the event log, not a representation of the visible-graph state. An edge that is no longer in the visible graph (because one of its endpoint nodes has been removed, or because the edge itself was broken via the `break-edge` operation) keeps its `session_edges` row; the visible-graph state is computed from the event log.

## Why it needs to be done

Same reason as `session_nodes`: session projection needs to know which global edges to include when reconstructing a session's graph from its event log.

## Inputs / context

Same as `session_nodes_join_table.md` — the architecture and data-model docs treat sessions↔nodes and sessions↔edges symmetrically. Both follow the same pattern.

## Constraints / requirements

Same as `session_nodes`:

- Pure join.
- Records inclusion event metadata (who, when).
- An edge can only be in a given session once.
- Permission checks at application layer.

## Acceptance criteria

- A migration creating the `session_edges` table with these columns:
  - `session_id` — FK to `sessions`, part of composite PK.
  - `edge_id` — FK to `edges`, part of composite PK.
  - `included_by` — FK to `users`.
  - `included_at` — timestamp.
- Composite primary key on `(session_id, edge_id)`.
- Foreign-key constraints on all three FKs.
- An index on `edge_id` for inverse queries.
- The migration runs cleanly in the local dev Compose stack.

## Decisions

- **Same PK and inclusion-monotonicity choices as `session_nodes`** (composite PK on `(session_id, edge_id)`, no `removed_at` column). R9 + R10.

## Open questions

(none — all decided)
