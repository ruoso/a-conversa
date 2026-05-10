-- Session-nodes M-N join — which nodes a session has ever referenced.
--
-- Refinement: tasks/refinements/data-and-methodology/session_nodes_join_table.md
-- TaskJuggler: data_and_methodology.schema.session_nodes_join_table
-- Forward-only per ADR 0020 (no down migration).
--
-- Pure join: one row links one session to one (global) node. A row is
-- inserted when a session begins referencing a node — either because
-- the node was just created in this session or because the session is
-- importing it from another session per the cross-session reference
-- permission rules in docs/architecture.md.
--
-- **This table is an index into the event log, not a representation
-- of the visible-graph state (R10).** A node that is no longer
-- visible in the session's current rendering — e.g. it was decomposed
-- and replaced by components, interpretively-split, or
-- restructured-and-replaced — still has its `session_nodes` row. The
-- visible-graph state is computed from the session's event log; this
-- table only answers two questions:
--   1. Bootstrapping the projection — which global node rows to fetch.
--   2. Cross-session permission checks — was this node ever in this
--      session?
-- Because the table is monotonic (R10), there is deliberately
-- **no `removed_at` column**. Removal-from-visible is an event-log
-- concern, not a row-mutation here.
--
-- Decisions captured by the refinement:
--   * **Composite primary key** on (session_id, node_id) (R9). This
--     is a deliberate departure from the project-wide UUID-PK
--     convention (CC1 in earlier refinements). M-N join tables are
--     the standard exception: the natural key *is* the pair of
--     foreign keys, a surrogate UUID would add nothing, and the
--     composite PK gives us duplicate-prevention and the primary
--     access path "rows for session X" in one B-tree.
--   * **No `removed_at`** (R10). See the monotonic-inclusion note
--     above.
--   * `included_by` records who pulled the node into this session
--     (matches the `entity-included` event payload in
--     docs/data-model.md).
--   * `included_at` records when. Server clock at insert time.
--
-- ON DELETE RESTRICT on all three FKs: matches the soft-delete
-- convention on users from 0001_users.sql and the convention on
-- sessions/nodes from 0002_sessions.sql / 0004_nodes.sql. The event
-- log references inclusions, so none of session, node, or including
-- user can be hard-deleted while a session_nodes row references them.
--
-- Inverse-lookup index on `node_id`: the composite PK already covers
-- "rows for this session" (its leading column is session_id), but
-- "in which sessions does this node appear?" — the cross-session
-- permission-check direction — needs an index on node_id alone. R9
-- calls this out explicitly.
--
-- No `gen_random_uuid()` here: there is no surrogate id column.

CREATE TABLE IF NOT EXISTS session_nodes (
    -- The session this inclusion belongs to. Part of the composite
    -- PK; RESTRICT so a session cannot be hard-deleted while it has
    -- inclusion rows.
    session_id      UUID            NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,

    -- The (global) node included in this session. Part of the
    -- composite PK; RESTRICT so a node cannot be hard-deleted while
    -- any session references it.
    node_id         UUID            NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,

    -- The participant who included this node — either by creating
    -- it in this session or by importing it from another. RESTRICT so
    -- a user cannot be hard-deleted while their inclusion rows exist
    -- (matches the soft-delete convention on users from
    -- 0001_users.sql).
    included_by     UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- When the inclusion happened. Server clock at insert time.
    included_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Composite primary key (R9). The pair (session_id, node_id) is
    -- the natural key; a node can only be in a given session once.
    PRIMARY KEY (session_id, node_id)
);

-- Inverse-direction lookup — "in which sessions does this node
-- appear?". The composite PK's leading column is session_id, so the
-- forward direction is already indexed; this index covers the
-- backward direction used by cross-session permission checks (R9).
CREATE INDEX IF NOT EXISTS session_nodes_node_id_idx
    ON session_nodes (node_id);
