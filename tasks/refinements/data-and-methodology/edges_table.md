# `edges` table (global)

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.schema.edges_table`
**Effort estimate (placeholder)**: 0.5d
**Inherited dependencies**: none — truly unblocked

## What this task is

Define and create the `edges` table. Edges are first-class structural entities with global identity, holding the role and the source/target nodes. Per-session edge state (substance facet, agreement, etc.) lives in the per-session event log.

## Why it needs to be done

Every relation between nodes is an edge. Structural diagnostics (cycles in `supports`, contradictions, multi-warrant patterns) are computed against the projected graph, which combines the global edges table with per-session facet state. The bridges-from / bridges-to pattern (warrants) and the conditional-substance reading both rest on edges being modeled as concrete rows.

## Inputs / context

From [docs/architecture.md — storage](../../../docs/architecture.md#storage):

> Global tables (one row per entity, no session column): `nodes`, `edges`, `users`.

From [docs/architecture.md — sessions and the global graph](../../../docs/architecture.md#sessions-and-the-global-graph):

> Global (intrinsic to the graph entity):
>   - Edge: id, role, source/target node ids, creator, creation timestamp.

From [docs/data-model.md — edges](../../../docs/data-model.md#edges):

The complete edge-roles enum:

- `supports`
- `rebuts`
- `qualifies`
- `bridges-from`
- `bridges-to`
- `defines`
- `contradicts`

All edges are directed (source → target). `contradicts` between two nodes that are genuinely symmetric is represented as two opposing `contradicts` edges.

From [docs/data-model.md — warrants and bridging](../../../docs/data-model.md#warrants-and-bridging):

> The "bridge" relationship — that a warrant licenses the inference from a specific data node to a specific claim node — is expressed by two ordinary directed edges from the warrant: an edge with role `bridges-from` from the warrant W to the data node D, and an edge with role `bridges-to` from the warrant W to the claim node C.

The TaskJuggler note already specifies the columns:

> id, role, source_node_id, target_node_id, created_by, created_at.

## Constraints / requirements

- **No session column.** Edges have global identity.
- The `role` is one of the seven values listed above.
- `source_node_id` and `target_node_id` are FKs into `nodes`.
- An edge is directed; the same role between the same pair in opposite directions is two distinct edges.

## Acceptance criteria

- A migration creating the `edges` table with these columns:
  - `id` — primary key, **UUID**.
  - `role` — `TEXT` with `CHECK (role IN ('supports', 'rebuts', 'qualifies', 'bridges-from', 'bridges-to', 'defines', 'contradicts'))`.
  - `source_node_id` — FK to `nodes`.
  - `target_node_id` — FK to `nodes`.
  - `created_by` — FK to `users`.
  - `created_at` — timestamp.
- Foreign-key constraints on all three FKs.
- A unique constraint on `(role, source_node_id, target_node_id)` (no duplicate edges with the same role and endpoints).
- An index on `source_node_id` and another on `target_node_id` (graph traversal queries hit both directions).
- The migration runs cleanly in the local dev Compose stack.

## Decisions

- **Primary key type: UUID** (CC1).
- **Role column: `TEXT` with `CHECK` constraint** (CC2).
- **Edge uniqueness: unique on `(role, source, target)`** (F9). Duplicates would be redundant and force diagnostic logic to deduplicate.
- **Paired `bridges-from` / `bridges-to`: runtime check only** (F10). DB-level enforcement is hard (chicken-and-egg insertion order — neither edge can be inserted alone). The coherency-hint diagnostic catches a warrant with only one of the two and surfaces it for resolution.

## Open questions

(none — all decided)

## Status

**Done** 2026-05-10. Migration: [`apps/server/migrations/0005_edges.sql`](../../../apps/server/migrations/0005_edges.sql).

Verified end-to-end against the dev Compose stack (`make up` → `make migrate` → SQL probes → `make down-v`):

- Schema (`\d edges`): six columns (`id`, `role`, `source_node_id`, `target_node_id`, `created_by`, `created_at`), three FKs all `ON DELETE RESTRICT`, the seven-value CHECK on `role`, the inline UNIQUE on `(role, source_node_id, target_node_id)`, and the two btree indexes on `source_node_id` / `target_node_id`.
- **Directionality**: a `supports` edge from N1 → N2 inserts; the reversed `supports` edge N2 → N1 also inserts (different unique tuple). Symmetric `contradicts` will work the same way (two distinct rows with swapped endpoints).
- **Uniqueness (F9)**: re-inserting `(supports, N1, N2)` fails with `duplicate key value violates unique constraint "edges_role_source_node_id_target_node_id_key"`.
- **CHECK (CC2)**: `role = 'invalid'` fails with `violates check constraint "edges_role_check"`.
- **FK**: a bogus `source_node_id` UUID fails with `violates foreign key constraint "edges_source_node_id_fkey"`.
- Paired `bridges-from` / `bridges-to` is **not** enforced at the DB layer (F10 — runtime/diagnostic only); the table happily accepts a lone `bridges-from` without its sibling `bridges-to`. The coherency-hint diagnostic surfaces this.
