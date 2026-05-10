-- Sessions table — one row per debate session.
--
-- Refinement: tasks/refinements/data-and-methodology/sessions_table.md
-- TaskJuggler: data_and_methodology.schema.sessions_table
-- Forward-only per ADR 0020 (no down migration).
--
-- A session is a single debate. It owns its own participants, event
-- log, and state. The `sessions` table is the entry point referenced
-- by `session_participants`, `session_nodes`, `session_edges`, and
-- the per-session `session_events` log.
--
-- Decisions captured by the refinement:
--   * Primary key is UUID (CC1).
--   * `privacy` is TEXT with a CHECK constraint (CC2) rather than an
--     enum type, so future values can be added by altering the
--     constraint without an enum-type migration dance. Default
--     'public' per docs/architecture.md ("Sessions are public by
--     default; the host may mark a session private.").
--   * `topic` column included (C1) — debate topic captured at
--     session creation.
--   * No explicit `status` column (F4). Session lifecycle is inferred
--     from `ended_at IS NULL` (active) vs. `ended_at IS NOT NULL`
--     (ended). Avoids redundant denormalization and the corresponding
--     state-machine bugs.
--
-- `gen_random_uuid()` is in core Postgres 13+; the dev stack pins
-- postgres:16-alpine, so this is safe (matches 0001_users.sql).

CREATE TABLE IF NOT EXISTS sessions (
    -- Surrogate UUID primary key. Generated server-side so callers
    -- don't have to mint UUIDs themselves on insert.
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The user who created the session. Exactly one host per session.
    -- Foreign key into users(id); RESTRICT semantics by default so a
    -- host cannot be hard-deleted while their sessions exist (matches
    -- the soft-delete convention from users_table).
    host_user_id    UUID            NOT NULL REFERENCES users(id),

    -- Privacy: 'public' (default) or 'private'. Gates cross-session
    -- reference permissions and audience-page authentication.
    -- Stored as TEXT + CHECK rather than an enum (CC2) for evolution
    -- flexibility.
    privacy         TEXT            NOT NULL DEFAULT 'public'
                                    CHECK (privacy IN ('public', 'private')),

    -- The debate topic, captured at session creation (C1).
    topic           TEXT            NOT NULL,

    -- Row creation timestamp. Server clock at insert time.
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Set when the session is ended; NULL while the session is active
    -- (F4). The row is preserved for replay and history.
    ended_at        TIMESTAMPTZ     NULL
);

-- Index for "list my sessions" queries (host's own sessions, by host).
CREATE INDEX IF NOT EXISTS sessions_host_user_id_idx
    ON sessions (host_user_id);

-- Partial index on public sessions, ordered by recency. Cross-session
-- listing/reference flows scan only public rows; making this a
-- partial index keeps it small (private sessions are excluded
-- entirely) and pre-orders by `created_at DESC` for the common
-- "recent public sessions" query.
CREATE INDEX IF NOT EXISTS sessions_public_idx
    ON sessions (created_at DESC)
    WHERE privacy = 'public';
