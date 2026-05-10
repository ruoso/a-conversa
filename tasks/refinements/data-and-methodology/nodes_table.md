# `nodes` table (global)

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.schema.nodes_table`
**Effort estimate (placeholder)**: 0.5d
**Inherited dependencies**: none — truly unblocked

## What this task is

Define and create the `nodes` table. Nodes are first-class graph entities **with global identity** — the same node (with its wording) can be referenced in many sessions. Per-session state about a node (classification, substance, agreement, axiom marks) lives in the per-session event log, not on this table.

## Why it needs to be done

Every node in the platform lives in this table. Edges reference nodes; annotations reference nodes; session_nodes (the M-N join) references nodes. Every event payload that mentions a node refers to its `id` here.

## Inputs / context

From [docs/architecture.md — storage](../../../docs/architecture.md#storage):

> Global tables (one row per entity, no session column): `nodes`, `edges`, `users`.

From [docs/architecture.md — sessions and the global graph](../../../docs/architecture.md#sessions-and-the-global-graph):

> Global (intrinsic to the graph entity):
>   - Node: id, wording (the statement text), creator, creation timestamp.

From [docs/data-model.md — nodes](../../../docs/data-model.md#nodes):

> A node represents a single statement on the graph.

From [docs/data-model.md — sessions and scope](../../../docs/data-model.md#sessions-and-scope):

> Global to a graph entity: a node's wording; an edge's shape.
> Session-scoped: every other facet (classification, substance), per-participant agreement, axiom marks, annotations, structural diagnostics.

The TaskJuggler note already specifies the columns:

> id, wording, created_by, created_at. No session column.

## Constraints / requirements

- **No session column.** A node's identity is global; its session-specific state lives elsewhere.
- The `wording` is the canonical statement text. Edits land via the methodology's reword/restructure workflow (reword updates this column; restructure creates a new row).
- `created_by` is a foreign key to `users` — the participant who first proposed this node.
- The node's structural place (which edges connect it to what) lives in the `edges` table; its session-specific facets live in `session_events`.

## Acceptance criteria

- A migration creating the `nodes` table with these columns:
  - `id` — primary key.
  - `wording` — text (the statement). No length cap at the database level (or a generous cap; the format encourages short statements but doesn't enforce it).
  - `created_by` — FK to `users`.
  - `created_at` — timestamp.
- Foreign-key constraint on `created_by`.
- An index on `created_by` for "show me nodes I've contributed" queries (low priority for v1; can be added later).
- The migration runs cleanly in the local dev Compose stack.

## Open questions

- **Wording length cap.** The format encourages short statements but the methodology is silent on a hard limit. Suggest no cap at the database level; UI can enforce a soft display limit. **Awaiting input.**
- **Wording format.** Plain text only, or does the format support light markup (Markdown / mention syntax)? **Awaiting input.** Strong default: plain text in v1.
- **Reword behavior.** When a wording edit is committed as a "reword", does the database row's `wording` column get updated in place (and prior wordings live only in the event log)? Implied yes by [docs/methodology.md — editing wording](../../../docs/methodology.md#editing-wording-reword-vs-restructure), but worth being explicit. Confirm.
- **Restructure behavior.** When an edit is a "restructure", a new node is created (new `id`); the old node's row stays unchanged? Implied yes. Confirm.
