-- Nodes table — global, one row per node (statement) on the graph.
--
-- Refinement: tasks/refinements/data-and-methodology/nodes_table.md
-- TaskJuggler: data_and_methodology.schema.nodes_table
-- Forward-only per ADR 0020 (no down migration).
--
-- A node is a first-class graph entity with **global identity**: the
-- same node (with its wording) can be referenced in many sessions.
-- Per-session state about a node (classification, substance, agreement,
-- axiom marks) lives in the per-session event log, not on this table.
-- Edges that connect nodes live in the `edges` table; the M-N join
-- between sessions and nodes lives in `session_nodes`.
--
-- **No session column.** This is an explicit decision from the
-- refinement: a node's identity is global. Do not add a `session_id`
-- column or session FK here — session-specific facets and visibility
-- belong in `session_events` and the M-N join, not on this row.
--
-- Decisions captured by the refinement:
--   * Primary key is UUID (CC1).
--   * `wording` is TEXT with no DB-level length cap (F7). A UI may
--     enforce a soft display limit; the database does not.
--   * `wording` is plain text in v1 (F8) — no Markdown, no mention
--     syntax. Stored as-is.
--   * Reword updates `wording` in place (C3). Prior wordings live
--     only in the event log; this row mutates.
--   * Restructure creates a new row with a new `id` (C4 + Q-R1). The
--     old row stays unchanged so historical event-log references
--     continue to resolve; in the session's *visible* graph the old
--     node becomes invisible after the restructure event commits.
--
-- ON DELETE RESTRICT on `created_by`: matches the soft-delete
-- convention on users from 0001_users.sql. Event-log entries and
-- downstream session rows reference nodes (and their creators), so
-- a creator cannot be hard-deleted while their nodes exist.
--
-- `gen_random_uuid()` is in core Postgres 13+; the dev stack pins
-- postgres:16-alpine, so this is safe (matches 0001_users.sql,
-- 0002_sessions.sql, 0003_session_participants.sql).

CREATE TABLE IF NOT EXISTS nodes (
    -- Surrogate UUID primary key. Generated server-side so callers
    -- don't have to mint UUIDs themselves on insert.
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The canonical statement text. TEXT with no length cap (F7) —
    -- the database does not constrain length; a UI may impose a soft
    -- display limit. Plain text in v1 (F8): no Markdown, no mention
    -- syntax. Reword (C3) mutates this column in place; restructure
    -- (C4) inserts a new row instead.
    wording         TEXT            NOT NULL,

    -- The user who first proposed this node. RESTRICT so a user
    -- cannot be hard-deleted while their nodes exist (matches the
    -- soft-delete convention on users from 0001_users.sql).
    created_by      UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- Row creation timestamp. Server clock at insert time.
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Index supporting the refinement's stated "show me nodes I've
-- contributed" query path. v1 does not actually surface this query
-- in any flow today, but the index is cheap (small B-tree on a
-- foreign-key column) and matches the refinement's intent — keeping
-- it here avoids a follow-up migration when the query lands.
CREATE INDEX IF NOT EXISTS nodes_created_by_idx
    ON nodes (created_by);
