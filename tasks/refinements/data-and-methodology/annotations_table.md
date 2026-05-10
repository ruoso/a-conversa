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

- A migration creating the `annotations` table with these columns:
  - `id` — primary key, **UUID**.
  - `target_node_id` — `UUID` nullable, FK to `nodes`.
  - `target_edge_id` — `UUID` nullable, FK to `edges`.
  - `kind` — `TEXT` with `CHECK (kind IN ('note', 'reframe', 'scope-change', 'stance'))`. Set extendable by altering the CHECK constraint when new kinds are added.
  - `content` — `TEXT`.
  - `created_by` — FK to `users`.
  - `created_at` — timestamp.
- Foreign-key constraints on `target_node_id`, `target_edge_id`, and `created_by`.
- A `CHECK ((target_node_id IS NOT NULL) <> (target_edge_id IS NOT NULL))` constraint — exactly one of the two target columns must be non-null.
- An index on `target_node_id` and another on `target_edge_id` for "show annotations attached to entity X" queries.
- The migration runs cleanly in the local dev Compose stack.

## Decisions

- **Primary key type: UUID** (CC1).
- **Annotation kind: `TEXT` with `CHECK` constraint** (CC2). Extendable by altering the CHECK when a new kind is needed (F12).
- **Annotations cannot annotate annotations in v1** (C5). The polymorphic-target columns are `target_node_id` and `target_edge_id` only.
- **Polymorphic FK strategy: option (a) — two nullable typed FK columns** (F11). `target_node_id NULLABLE FK nodes`, `target_edge_id NULLABLE FK edges`, with a CHECK constraint that exactly one is non-null. Preserves DB-level FK integrity at the cost of one always-null column per row.

## Open questions

(none — all decided)

## Status

**Done** 2026-05-10 — migration at
[`apps/server/migrations/0006_annotations.sql`](../../../apps/server/migrations/0006_annotations.sql).

Verified end-to-end against the local Compose stack:

- `make up` brings postgres up healthy; `make migrate` applies through
  `0006_annotations` cleanly.
- `\d annotations` shows the seven columns, RESTRICT FKs to `nodes` /
  `edges` / `users`, the `annotations_kind_check` CHECK on `kind`, the
  `annotations_check` XOR CHECK on the polymorphic targets, and the
  two partial indexes (`annotations_target_node_id_idx`,
  `annotations_target_edge_id_idx`) each gated on
  `WHERE <col> IS NOT NULL`.
- Insert with `target_node_id` set + `kind='note'` → SUCCEEDS.
- Insert with `target_edge_id` set + `kind='reframe'` → SUCCEEDS.
- Insert with **both** target columns set → FAILS
  `annotations_check` (the XOR CHECK).
- Insert with **neither** target column set → FAILS
  `annotations_check` (same constraint, the other side of XOR).
- Insert with `kind='foo'` → FAILS `annotations_kind_check`.
- `make down-v` cleans up.

No new ADR — the XOR-via-two-typed-columns pattern (F11) and the
TEXT+CHECK pattern for `kind` (CC2 / F12) are already covered by the
refinement decisions and the existing migration conventions in
ADR 0020. C5 (no `target_annotation_id` in v1) is enforced by
omission and noted in the migration's header comment.
