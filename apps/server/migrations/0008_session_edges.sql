-- Session-edges M-N join — which edges a session has ever referenced.
--
-- Refinement: tasks/refinements/data-and-methodology/session_edges_join_table.md
-- TaskJuggler: data_and_methodology.schema.session_edges_join_table
-- Forward-only per ADR 0020 (no down migration).
--
-- Sister table to `session_nodes` (0007_session_nodes.sql); the
-- refinement is explicit that this follows the exact same shape and
-- decisions. The two are symmetric in the architecture and data-model
-- docs, and they are symmetric here.
--
-- Pure join: one row links one session to one (global) edge. A row is
-- inserted when a session begins referencing an edge — either because
-- the edge was just created in this session or because the session is
-- importing it from another session per the cross-session reference
-- permission rules in docs/architecture.md.
--
-- **This table is an index into the event log, not a representation
-- of the visible-graph state (R10).** An edge that is no longer
-- visible in the session's current rendering — e.g. it was broken via
-- `break-edge`, or one of its endpoint nodes was decomposed,
-- interpretively-split, or restructured-and-replaced — still has its
-- `session_edges` row. The visible-graph state is computed from the
-- session's event log; this table only answers two questions:
--   1. Bootstrapping the projection — which global edge rows to fetch.
--   2. Cross-session permission checks — was this edge ever in this
--      session?
-- Because the table is monotonic (R10), there is deliberately
-- **no `removed_at` column**. Removal-from-visible is an event-log
-- concern, not a row-mutation here.
--
-- Decisions captured by the refinement:
--   * **Composite primary key** on (session_id, edge_id) (R9). This
--     is a deliberate departure from the project-wide UUID-PK
--     convention (CC1 in earlier refinements). M-N join tables are
--     the standard exception: the natural key *is* the pair of
--     foreign keys, a surrogate UUID would add nothing, and the
--     composite PK gives us duplicate-prevention and the primary
--     access path "rows for session X" in one B-tree.
--   * **No `removed_at`** (R10). See the monotonic-inclusion note
--     above.
--   * `included_by` records who pulled the edge into this session
--     (matches the `entity-included` event payload in
--     docs/data-model.md).
--   * `included_at` records when. Server clock at insert time.
--
-- ON DELETE RESTRICT on all three FKs: matches the soft-delete
-- convention on users from 0001_users.sql and the convention on
-- sessions/edges from 0002_sessions.sql / 0005_edges.sql. The event
-- log references inclusions, so none of session, edge, or including
-- user can be hard-deleted while a session_edges row references them.
--
-- Inverse-lookup index on `edge_id`: the composite PK already covers
-- "rows for this session" (its leading column is session_id), but
-- "in which sessions does this edge appear?" — the cross-session
-- permission-check direction — needs an index on edge_id alone. R9
-- calls this out explicitly.
--
-- No `gen_random_uuid()` here: there is no surrogate id column.

CREATE TABLE IF NOT EXISTS session_edges (
    -- The session this inclusion belongs to. Part of the composite
    -- PK; RESTRICT so a session cannot be hard-deleted while it has
    -- inclusion rows.
    session_id      UUID            NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,

    -- The (global) edge included in this session. Part of the
    -- composite PK; RESTRICT so an edge cannot be hard-deleted while
    -- any session references it.
    edge_id         UUID            NOT NULL REFERENCES edges(id) ON DELETE RESTRICT,

    -- The participant who included this edge — either by creating
    -- it in this session or by importing it from another. RESTRICT so
    -- a user cannot be hard-deleted while their inclusion rows exist
    -- (matches the soft-delete convention on users from
    -- 0001_users.sql).
    included_by     UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- When the inclusion happened. Server clock at insert time.
    included_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Composite primary key (R9). The pair (session_id, edge_id) is
    -- the natural key; an edge can only be in a given session once.
    PRIMARY KEY (session_id, edge_id)
);

-- Inverse-direction lookup — "in which sessions does this edge
-- appear?". The composite PK's leading column is session_id, so the
-- forward direction is already indexed; this index covers the
-- backward direction used by cross-session permission checks (R9).
CREATE INDEX IF NOT EXISTS session_edges_edge_id_idx
    ON session_edges (edge_id);
