# `annotations` table (global)

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.schema.annotations_table`
**Effort estimate (placeholder)**: 0.5d
**Inherited dependencies**: none — truly unblocked

## What this task is

Define and create the `annotations` table. Annotations are first-class entities attached to nodes or edges; they carry their own facets (wording, optional substance) and run through the standard agreement workflow. Examples in the platform: a participant's note that a definitional boundary "does argumentative work" (recorded with the agreement); a meta-move (reframe / scope-change / methodological stance); a "decline to press" stance.

## Why it needs to be done

The methodology relies on annotations to represent things that aren't pure graph entities — meta-moves, methodological stances, narrative notes. Without this table, those have no structural home.

## Inputs / context

From [docs/architecture.md — storage](../../../docs/architecture.md#storage):

> Global tables (one row per entity, no session column): `nodes`, `edges`, `users`.

(The architecture doc lists `nodes`, `edges`, `users` as the global-tables set in the storage section, but [docs/data-model.md — annotations](../../../docs/data-model.md#annotations) makes annotations first-class entities. The annotations table is a third global graph entity table, parallel to `nodes` and `edges`. The architecture doc's list may need updating after this refinement lands.)

From [docs/data-model.md — annotations](../../../docs/data-model.md#annotations):

> Both nodes and edges may carry annotations — notes attached to the entity that record participant context the participants want preserved without modifying the entity's core meaning.
>
> An annotation has its own owner, content, and the standard facet set (`wording` for the annotation text; `substance` if the annotation makes a substantive claim). Annotations are first-class proposed changes that go through the same agreement lifecycle as nodes and edges.

From [docs/data-model.md — event types — global entity creation](../../../docs/data-model.md#global-entity-creation):

> annotation-created — payload: annotation id, content, target-entity-id (node or edge), creator, timestamp.

From [docs/methodology.md — meta-moves](../../../docs/methodology.md#meta-moves):

> The platform's response is to capture each meta-move as a first-class entry on the board, marked as such.

The example walkthrough captures meta-moves as annotations with `kind=reframe` / `kind=scope-change` / `kind=stance`.

## Constraints / requirements

- **No session column** — annotations are globally addressable, like nodes and edges.
- Annotations attach polymorphically to either a node or an edge.
- Annotations carry a `kind` that distinguishes plain notes (concerns, observations) from meta-moves (`reframe`, `scope-change`, `stance`).
- Content is a wording string with the same lifecycle facets as a node's wording.

## Acceptance criteria

- A migration creating the `annotations` table with these columns (final shape contingent on F11):
  - `id` — primary key, **UUID**.
  - `target_kind` — `TEXT` with `CHECK (target_kind IN ('node', 'edge'))` — annotations cannot themselves be annotated in v1.
  - `target_id` — `UUID` reference (specific representation contingent on F11).
  - `kind` — `TEXT` with `CHECK` constraint listing the supported annotation kinds.
  - `content` — `TEXT`.
  - `created_by` — FK to `users`.
  - `created_at` — timestamp.
- Foreign-key constraint on `created_by`.
- An index on `(target_kind, target_id)` for "show annotations attached to entity X" queries.
- The migration runs cleanly in the local dev Compose stack.
- Update [docs/architecture.md — storage](../../../docs/architecture.md#storage) to list `annotations` as a third global table alongside `nodes`, `edges`, `users` (I1).

## Decisions

- **Primary key type: UUID** (CC1).
- **Target kind: `TEXT` with `CHECK` constraint** (CC2).
- **Annotation kind: `TEXT` with `CHECK` constraint** (CC2).
- **Annotations cannot annotate annotations in v1** (C5). `target_kind` is `node` | `edge` only.

## Open questions

- **Polymorphic FK representation (F11).** Three approaches:
  - **(a)** Single nullable typed columns: `target_node_id NULLABLE FK nodes`, `target_edge_id NULLABLE FK edges`. Cleanly typed FKs; one is always null. Database-level integrity is decent.
  - **(b)** `target_kind` + `target_id` (UUID, no DB-level FK). Loose at the DB level — no FK validity enforced — but simpler to query.
  - **(c)** Two separate tables: `node_annotations` and `edge_annotations`. Strictest typing, more code.
  - **Awaiting input.**
- **Annotation kind set (F12).** Fixed v1 set (`note`, `reframe`, `scope-change`, `stance`) vs. extendable list managed via the CHECK constraint. **Awaiting input.**

## Doc inconsistencies surfaced (not decisions)

- **I1.** [docs/architecture.md — storage](../../../docs/architecture.md#storage) lists only `nodes`, `edges`, `users` as global tables. Annotations need to be added. Pending fix.
