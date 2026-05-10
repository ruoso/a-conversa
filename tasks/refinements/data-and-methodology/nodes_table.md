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
  - `id` — primary key, **UUID**.
  - `wording` — `TEXT` (length cap TBD — see open questions).
  - `created_by` — FK to `users`.
  - `created_at` — timestamp.
- Foreign-key constraint on `created_by`.
- An index on `created_by` for "show me nodes I've contributed" queries (low priority for v1; can be added later).
- Reword updates `wording` in place; prior wordings live only in the event log.
- Restructure creates a new row (new `id`); the old row stays unchanged.
- The migration runs cleanly in the local dev Compose stack.

## Decisions

- **Primary key type: UUID** (CC1).
- **Reword updates in place** (C3). The wording column changes; prior wordings live only in the event log.
- **Restructure creates a new row and supersedes the old node** (C4 + Q-R1 always-replace). The old row in the global `nodes` table stays unchanged (so historical event-log references continue to resolve). In the *session's* visible graph, the old node becomes invisible after the restructure event commits; the new node takes its place. Edges incident to the old node become invisible too (they don't auto-follow). If participants want to keep the original alongside a new statement, they should not restructure — they should add a new node directly via the standard capture flow. See [data-model.md — visible-graph derivation](../../../docs/data-model.md#visible-graph-derivation) for the formal rule.
- **Wording length: no DB-level cap** (F7). Stored as `TEXT`. The UI may enforce a soft display limit.
- **Wording format: plain text in v1** (F8). No Markdown, no mention syntax. Markup adds rendering complexity across all surfaces (audience, debater, moderator) for a feature not on the v1 roadmap. Revisit if/when a use case justifies it.

## Open questions

(none — all decided)

## Status

**Done** 2026-05-10 — migration landed at
[apps/server/migrations/0004_nodes.sql](../../../apps/server/migrations/0004_nodes.sql).

Verified end-to-end against the dev Compose stack:

- `make up` brings postgres up healthy; `make migrate` applies cleanly
  through 0004 (`### MIGRATION 0004_nodes (UP) ###`).
- `\d nodes` shows the four expected columns (`id UUID PK default
  gen_random_uuid()`, `wording TEXT NOT NULL`, `created_by UUID NOT
  NULL`, `created_at TIMESTAMPTZ NOT NULL default NOW()`), the
  `nodes_created_by_idx` btree index, and the
  `nodes_created_by_fkey` FK to `users(id)` ON DELETE RESTRICT.
- INSERT user → INSERT node returns a server-minted UUID plus
  `created_at`.
- INSERT with a bogus `created_by` UUID is rejected by the FK
  (`violates foreign key constraint "nodes_created_by_fkey"`).
- **Reword in place**: `UPDATE nodes SET wording = ...` mutated the
  row; the `id` was unchanged (verified via `id = :old_id`).
- **Restructure as new row**: a second INSERT produced a new `id`;
  the original row's `id` and `wording` were untouched. Both rows
  coexist in the global `nodes` table — visibility is a per-session
  event-log concern, not a row-deletion concern.
- `make down-v` cleans up.

No new ADR (per task spec).
