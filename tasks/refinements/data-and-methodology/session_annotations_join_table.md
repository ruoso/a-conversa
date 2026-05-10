# `session_annotations` join table

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.schema.session_annotations_join_table`
**Effort estimate**: 0.25d
**Inherited dependencies**: `data_and_methodology.schema.sessions_table`, `data_and_methodology.schema.annotations_table` (both settled)

## What this task is

Define and create the `session_annotations` M-N join table — sister to `session_nodes` and `session_edges`. Records which (global) annotations a session has ever referenced.

## Why it needs to be done

Annotations are first-class graph entities (per [docs/data-model.md — annotations](../../../docs/data-model.md#annotations)) and go through the standard agreement workflow. Cross-session reference (per [docs/architecture.md — cross-session reference permissions](../../../docs/architecture.md#cross-session-reference-permissions)) needs to extend to annotations symmetrically with nodes and edges — a session may reference an annotation that originated in another session, just as it can reference a node or edge.

This task was added in round 4 (R26) to close that asymmetry. The original architecture and round-1/round-2 schema work focused on `session_nodes` and `session_edges`; annotations were initially assumed to piggyback on their target's inclusion. R26 chose explicit symmetry instead.

## Inputs / context

Same shape as `session_nodes` and `session_edges` join tables:

- `session_id` — FK to `sessions`, part of composite PK.
- `annotation_id` — FK to `annotations`, part of composite PK.
- `included_by` — FK to `users`.
- `included_at` — timestamp.

Same monotonic-inclusion semantics: once a session includes an annotation, it stays included. Visible-graph state derives from the event log (see [docs/data-model.md — visible-graph derivation](../../../docs/data-model.md#visible-graph-derivation)).

## Constraints / requirements

Mirrors `session_nodes` / `session_edges`:

- Pure join.
- Records inclusion event metadata (who, when).
- An annotation can only be in a given session once.
- Permission checks at application layer.

## Acceptance criteria

- A migration creating the `session_annotations` table with these columns:
  - `session_id` — FK to `sessions`, part of composite PK.
  - `annotation_id` — FK to `annotations`, part of composite PK.
  - `included_by` — FK to `users`.
  - `included_at` — timestamp.
- Composite primary key on `(session_id, annotation_id)`.
- Foreign-key constraints on all three FKs.
- An index on `annotation_id` for inverse queries.
- The migration runs cleanly in the local dev Compose stack.

## Decisions

- **Same PK and inclusion-monotonicity choices as `session_nodes`** (composite PK, no `removed_at` column). R9 + R10 carry.
- **Same M-N exception to the UUID-PK convention** that the other two join tables made.
