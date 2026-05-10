-- Annotations table — global, one row per annotation on the graph.
--
-- Refinement: tasks/refinements/data-and-methodology/annotations_table.md
-- TaskJuggler: data_and_methodology.schema.annotations_table
-- Forward-only per ADR 0020 (no down migration).
--
-- An annotation is a first-class graph entity with **global identity**:
-- it attaches polymorphically to either a node or an edge and may be
-- referenced from many sessions. Per-session state about an annotation
-- (visibility, agreement on its facets, etc.) lives in the per-session
-- event log, not on this table. The M-N join between sessions and
-- annotations lives in `session_annotations`.
--
-- **No session column.** This is an explicit decision from the
-- refinement (mirroring `nodes` and `edges`): an annotation's identity
-- is global. Do not add a `session_id` column or session FK here —
-- session-specific facets and visibility belong in `session_events`
-- and the M-N join, not on this row.
--
-- **C5 — annotations cannot annotate annotations in v1.** The
-- polymorphic-target columns are `target_node_id` and `target_edge_id`
-- only; there is deliberately no `target_annotation_id` column. If
-- annotation-on-annotation lands in a future version, a forward
-- migration adds the column, widens the XOR CHECK to a "exactly one
-- non-null" constraint over three columns, and adds a partial index.
--
-- Decisions captured by the refinement:
--   * Primary key is UUID (CC1).
--   * `kind` is TEXT with a CHECK constraint (CC2) covering the four
--     kinds enumerated in the refinement — extensibility is a one-line
--     ALTER on the constraint, no separate reference table (F12).
--   * Polymorphic FK strategy: option (a) — two nullable typed FK
--     columns (F11). `target_node_id` references `nodes`,
--     `target_edge_id` references `edges`, and a CHECK constraint
--     enforces exactly one non-null. Preserves DB-level FK integrity
--     at the cost of one always-null target column per row.
--
-- ON DELETE RESTRICT on `target_node_id`, `target_edge_id`, and
-- `created_by`: matches the soft-delete convention on users from
-- 0001_users.sql and the convention on `nodes`/`edges` from
-- 0004_nodes.sql / 0005_edges.sql. Event-log entries and downstream
-- session rows reference annotations (and their targets and creators),
-- so targets/creators cannot be hard-deleted while annotations
-- referencing them exist.
--
-- `gen_random_uuid()` is in core Postgres 13+; the dev stack pins
-- postgres:16-alpine, so this is safe (matches 0001_users.sql,
-- 0002_sessions.sql, 0003_session_participants.sql, 0004_nodes.sql,
-- 0005_edges.sql).

CREATE TABLE IF NOT EXISTS annotations (
    -- Surrogate UUID primary key. Generated server-side so callers
    -- don't have to mint UUIDs themselves on insert.
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Polymorphic target — node side. Nullable: exactly one of
    -- (target_node_id, target_edge_id) is non-null per the XOR CHECK
    -- below. RESTRICT so a node cannot be hard-deleted while
    -- annotations reference it.
    target_node_id  UUID            NULL REFERENCES nodes(id) ON DELETE RESTRICT,

    -- Polymorphic target — edge side. Nullable: exactly one of
    -- (target_node_id, target_edge_id) is non-null per the XOR CHECK
    -- below. RESTRICT so an edge cannot be hard-deleted while
    -- annotations reference it.
    target_edge_id  UUID            NULL REFERENCES edges(id) ON DELETE RESTRICT,

    -- Annotation kind. TEXT + CHECK rather than an enum type (CC2) for
    -- extensibility — a future kind is added by altering this CHECK
    -- constraint. The four values come from the refinement: `note` for
    -- plain participant notes/concerns, and `reframe` / `scope-change`
    -- / `stance` for the meta-moves enumerated in
    -- docs/methodology.md.
    kind            TEXT            NOT NULL
                                    CHECK (kind IN (
                                        'note',
                                        'reframe',
                                        'scope-change',
                                        'stance'
                                    )),

    -- The annotation's wording text. Same shape as `nodes.wording` —
    -- TEXT with no DB-level length cap; plain text in v1.
    content         TEXT            NOT NULL,

    -- The user who first proposed this annotation. RESTRICT so a user
    -- cannot be hard-deleted while their annotations exist (matches
    -- the soft-delete convention on users from 0001_users.sql).
    created_by      UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- Row creation timestamp. Server clock at insert time.
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Polymorphic-target XOR — exactly one of the two target columns
    -- must be non-null. Encoded as `(a IS NOT NULL) <> (b IS NOT NULL)`:
    -- the two booleans differ iff exactly one is true.
    CHECK ((target_node_id IS NOT NULL) <> (target_edge_id IS NOT NULL))
);

-- Lookup index for "show annotations attached to node X" queries.
-- Partial — annotations targeting an edge have NULL here, so omitting
-- those rows from the index keeps it tight.
CREATE INDEX IF NOT EXISTS annotations_target_node_id_idx
    ON annotations (target_node_id)
    WHERE target_node_id IS NOT NULL;

-- Lookup index for "show annotations attached to edge X" queries.
-- Partial — annotations targeting a node have NULL here, so omitting
-- those rows from the index keeps it tight.
CREATE INDEX IF NOT EXISTS annotations_target_edge_id_idx
    ON annotations (target_edge_id)
    WHERE target_edge_id IS NOT NULL;
