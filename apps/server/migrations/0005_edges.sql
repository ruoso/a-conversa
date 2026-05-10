-- Edges table — global, one row per edge (relation) on the graph.
--
-- Refinement: tasks/refinements/data-and-methodology/edges_table.md
-- TaskJuggler: data_and_methodology.schema.edges_table
-- Forward-only per ADR 0020 (no down migration).
--
-- An edge is a first-class graph entity with **global identity**: the
-- same edge (with its role and endpoints) can be referenced in many
-- sessions. Per-session state about an edge (substance facet,
-- agreement, etc.) lives in the per-session event log, not on this
-- table. The M-N join between sessions and edges lives in
-- `session_edges`.
--
-- **No session column.** This is an explicit decision from the
-- refinement (mirroring `nodes`): an edge's identity is global. Do
-- not add a `session_id` column or session FK here — session-specific
-- facets and visibility belong in `session_events` and the M-N join,
-- not on this row.
--
-- Decisions captured by the refinement:
--   * Primary key is UUID (CC1).
--   * `role` is TEXT with a CHECK constraint (CC2) covering the seven
--     roles enumerated in docs/data-model.md — extensibility is a
--     one-line ALTER on the constraint, no separate reference table.
--   * Edges are directed: source → target. A symmetric `contradicts`
--     between two nodes is two separate rows with swapped endpoints.
--   * Edge uniqueness on (role, source_node_id, target_node_id) (F9):
--     duplicates would be redundant and force diagnostic logic to
--     deduplicate. Encoded as an inline UNIQUE constraint (named
--     `edges_role_source_target_key` by Postgres) — chosen over a
--     separate UNIQUE INDEX because there is no partial-WHERE clause
--     and no need for a custom index name; the inline form keeps the
--     column-set decision visibly co-located with the columns.
--   * Paired `bridges-from` / `bridges-to` (F10): runtime check only.
--     DB-level enforcement is impractical (chicken-and-egg insertion
--     order — neither edge can be inserted alone). The coherency-hint
--     diagnostic catches a warrant with only one of the two and
--     surfaces it for resolution.
--
-- ON DELETE RESTRICT on `source_node_id`, `target_node_id`, and
-- `created_by`: matches the soft-delete convention on users from
-- 0001_users.sql and the convention on `nodes` from 0004_nodes.sql.
-- Event-log entries and downstream session rows reference edges (and
-- their endpoints and creators), so endpoints/creators cannot be
-- hard-deleted while edges referencing them exist.
--
-- `gen_random_uuid()` is in core Postgres 13+; the dev stack pins
-- postgres:16-alpine, so this is safe (matches 0001_users.sql,
-- 0002_sessions.sql, 0003_session_participants.sql, 0004_nodes.sql).

CREATE TABLE IF NOT EXISTS edges (
    -- Surrogate UUID primary key. Generated server-side so callers
    -- don't have to mint UUIDs themselves on insert.
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Edge role. TEXT + CHECK rather than an enum type (CC2) for
    -- extensibility — a future role is added by altering this CHECK
    -- constraint. The seven values come from docs/data-model.md.
    role            TEXT            NOT NULL
                                    CHECK (role IN (
                                        'supports',
                                        'rebuts',
                                        'qualifies',
                                        'bridges-from',
                                        'bridges-to',
                                        'defines',
                                        'contradicts'
                                    )),

    -- Source endpoint of the directed edge. RESTRICT so a node
    -- cannot be hard-deleted while edges reference it.
    source_node_id  UUID            NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,

    -- Target endpoint of the directed edge. RESTRICT so a node
    -- cannot be hard-deleted while edges reference it.
    target_node_id  UUID            NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,

    -- The user who first proposed this edge. RESTRICT so a user
    -- cannot be hard-deleted while their edges exist (matches the
    -- soft-delete convention on users from 0001_users.sql).
    created_by      UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- Row creation timestamp. Server clock at insert time.
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- No duplicate edges with the same role and endpoints (F9). The
    -- reverse direction (role, target, source) is a different tuple
    -- and is permitted — symmetric `contradicts` is two distinct
    -- rows.
    UNIQUE (role, source_node_id, target_node_id)
);

-- Lookup index for outgoing-edge graph traversal — "what edges leave
-- this node?". Hot path for projection rebuild and structural
-- diagnostics that walk forward (cycle detection in `supports`,
-- multi-warrant fan-out from a warrant, etc.).
CREATE INDEX IF NOT EXISTS edges_source_node_id_idx
    ON edges (source_node_id);

-- Lookup index for incoming-edge graph traversal — "what edges
-- arrive at this node?". Hot path for dangling-claim detection
-- (claims with no incoming `supports`/`rebuts`/`bridges-to`) and any
-- backward walk during diagnostics.
CREATE INDEX IF NOT EXISTS edges_target_node_id_idx
    ON edges (target_node_id);
