# Edges table — polymorphic source/target annotation endpoints (DB migration)

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.schema.edges_table_polymorphic_endpoint_migration`
**Effort estimate**: 0.5d
**Inherited dependencies**: `data_and_methodology.event_types.edge_target_annotation_schema_extension` (settled 2026-05-30 — the wire-schema widening this migration mirrors; its D6 explicitly deferred the DB half to this leaf).
**Executor**: implementation agent — repo-only work. Surfaced by the 2026-06-12 open-leaf audit (the leaf was an orphan: registered as tech debt by the wire-widening closer, wired into no milestone).

## What this task is

The DB migration mirroring the `edge-created` wire-schema widening on
the global `edges` table, exactly as specified by the upstream
refinement's tech-debt registration:

> DB migration widening the global `edges` table to mirror this
> schema change: `source_node_id` and `target_node_id` become
> nullable; `source_annotation_id` and `target_annotation_id` are
> added as nullable FKs to `annotations`; per-endpoint
> `CHECK ((source_node_id IS NOT NULL) <> (source_annotation_id IS
> NOT NULL))` constraints enforce the XOR at the DB layer (mirrors
> `0006_annotations.sql`). The UNIQUE constraint on
> `(role, source_node_id, target_node_id)` becomes a UNIQUE INDEX
> over the polymorphic endpoint tuple.

## Why it needs to be done

- The wire schema (`edgeCreatedPayloadSchema`) has accepted
  annotation endpoints since 2026-05-30, but the `edges` table cannot
  store them — the gap is dormant only because no production write
  path mints rows in the global `edges` table yet. The migration is
  the gate that lets a future write path persist what the wire
  already validates.
- It is the only remaining open leaf under
  `data_and_methodology` and one of three agent-doable leaves found
  by the audit.

## Inputs / context

- **Current shape** ([`0005_edges.sql`](../../../apps/server/migrations/0005_edges.sql)):
  `source_node_id` / `target_node_id` `NOT NULL REFERENCES nodes`,
  inline `UNIQUE (role, source_node_id, target_node_id)` (Postgres
  auto-names it `edges_role_source_node_id_target_node_id_key` —
  verified against a live catalog; the 0005 comment's guessed name
  `edges_role_source_target_key` is wrong), plus per-endpoint lookup
  indexes.
- **Pattern to mirror** ([`0006_annotations.sql`](../../../apps/server/migrations/0006_annotations.sql)):
  polymorphic-FK option (a) — typed nullable FK columns + XOR CHECK.
- **Wire shape** (`packages/shared-types/src/events.ts`): four
  optional endpoint fields, per-endpoint exactly-one `.refine()`s.
- **Uniqueness over nullable columns**: a plain UNIQUE index treats
  NULLs as distinct, which would stop deduplicating node–node edges
  the moment the endpoint columns become nullable. `NULLS NOT
  DISTINCT` (PG 15+) restores the old semantics over the widened
  tuple. Prod pins `postgres:16-alpine` (ADR 0016) and the behavior
  suite's pglite reports PG 17 — both support it (verified live in
  pglite before writing the migration).
- **Safety linter** (ADR 0034, `scripts/lint-migrations.ts`): the
  migration must pass. It does by construction — `DROP NOT NULL`,
  `ADD COLUMN … NULL`, `ADD CONSTRAINT CHECK`, `DROP CONSTRAINT`,
  and index swaps are all backward-tolerable: the previous image
  never INSERTs into `edges` at all, and even if it did, its
  node–node inserts satisfy both new XOR CHECKs and the new unique
  semantics unchanged.
- **Test conventions**: per-migration regression scenarios live in
  `tests/behavior/migrations/edges.feature` +
  `tests/behavior/steps/edges.steps.ts` (pglite per scenario, world
  hook applies all migrations); the lint-migrations corpus baseline
  and the migrate.feature row-count scenarios pick the new file up
  automatically.

## Constraints / requirements

- **`apps/server/migrations/0017_edges_polymorphic_endpoints.sql`**,
  forward-only (ADR 0020), containing exactly:
  - `ALTER COLUMN source_node_id / target_node_id DROP NOT NULL`;
  - `ADD COLUMN source_annotation_id / target_annotation_id UUID NULL
    REFERENCES annotations(id) ON DELETE RESTRICT` (RESTRICT matches
    every other entity FK in the schema);
  - two named XOR CHECK constraints (`edges_source_endpoint_xor`,
    `edges_target_endpoint_xor`);
  - drop of the old inline UNIQUE constraint (by its real auto-name;
    `IF EXISTS` on the 0005 comment's wrong guess too, defensively);
  - `CREATE UNIQUE INDEX edges_role_endpoints_key … NULLS NOT
    DISTINCT` over `(role, source_node_id, source_annotation_id,
    target_node_id, target_annotation_id)`;
  - partial lookup indexes on the two annotation-endpoint columns
    (mirroring the node-endpoint indexes; partial because the columns
    are NULL on every node–node edge).
- **Behavior scenarios** extending `edges.feature`: annotation-source
  and annotation-target inserts succeed; both-set and neither-set
  endpoint shapes are rejected by the CHECKs; a node–node duplicate
  is still rejected (NULLS NOT DISTINCT pin); an annotation-endpoint
  duplicate is rejected; an edge referencing a non-existent
  annotation is rejected by the FK.
- `pnpm run lint:migrations` clean; `pnpm run test:behavior:smoke`
  green; `pnpm run check` green.
- No projection / engine / proposal-schema changes — those are the
  separately-registered follow-ups (`projection_edge_annotation_endpoint`,
  `set_edge_substance_annotation_endpoint`); this leaf is the DB
  layer only, exactly as scoped by the upstream D6.

## Acceptance criteria

- Migration applies on a fresh DB (behavior suite) and on a DB at
  0016 (forward apply — the migrate.feature no-op-rerun scenario plus
  the dry-run tooling cover the mechanics).
- The new scenarios pass; the pre-existing four edges.feature
  scenarios pass unchanged (node–node behavior preserved).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
  `complete 100`.

## Decisions

- **`NULLS NOT DISTINCT` over a COALESCE expression index.** Both
  restore deduplication over nullable columns; the declarative form
  states the intent directly, needs no sentinel UUID, and is
  supported by every Postgres this repo targets (16 prod, 17 pglite).
- **Drop-by-real-name + defensive `IF EXISTS` for the documented
  name.** The 0005 header comment guessed the constraint name
  Postgres would assign and guessed wrong; the migration drops the
  verified auto-name and also the documented-but-wrong name with
  `IF EXISTS` so the migration is immune to either history.
- **Partial indexes for the annotation endpoints.** Every node–node
  edge carries NULL in both new columns; a full index would be ~100%
  NULL entries. The node-endpoint indexes stay full (they predate
  this migration and node endpoints remain the common case).
- **No backfill, no data migration.** The table is empty in every
  deployed environment (no production write path); the migration is
  pure DDL.

## Open questions

(none — all decided upstream; this leaf executes the upstream D6
specification)

## Status

**Done** — 2026-06-12. Landed as:

- [`apps/server/migrations/0017_edges_polymorphic_endpoints.sql`](../../../apps/server/migrations/0017_edges_polymorphic_endpoints.sql).
- Behavior coverage: 6 new scenarios in
  [`tests/behavior/migrations/edges.feature`](../../../tests/behavior/migrations/edges.feature)
  + matching steps in
  [`tests/behavior/steps/edges.steps.ts`](../../../tests/behavior/steps/edges.steps.ts)
  (annotation-endpoint inserts, XOR rejections both ways, NULLS NOT
  DISTINCT duplicate pins for node–node and annotation-endpoint
  tuples, annotation FK violation).
- `pnpm run lint:migrations` clean over the 18-file corpus;
  behavior suite green.
- `complete 100` marker + refinement link in
  [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji); tj3 parse clean.
