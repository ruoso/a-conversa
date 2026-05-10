-- Session participants — M-N join between sessions and users with role.
--
-- Refinement: tasks/refinements/data-and-methodology/session_participants_table.md
-- TaskJuggler: data_and_methodology.schema.session_participants_table
-- Forward-only per ADR 0020 (no down migration).
--
-- Records each participant's role within a given session. Session
-- participation is the basis for the agreement rule ("all current
-- participants voting agree"), per-participant axiom-mark
-- attribution, vote attribution, and auth-on-WebSocket-connect.
--
-- Decisions captured by the refinement:
--   * Primary key is UUID (CC1).
--   * `role` is TEXT with a CHECK constraint (CC2) — extensibility
--     under F6 is a one-line ALTER on the constraint when a new role
--     (e.g. `spectator`) is needed; no separate `roles` reference
--     table for v1.
--   * Single active role per user per session (C2). Encoded as a
--     partial unique index on (session_id, user_id) WHERE
--     left_at IS NULL.
--   * Single active occupant per (session_id, role). Encoded as a
--     partial unique index on (session_id, role) WHERE
--     left_at IS NULL.
--   * Leave-and-rejoin is multiple rows (F5). Each join-leave pair is
--     its own row; the partial unique indexes only constrain rows
--     with `left_at IS NULL`, so historical (left) rows do not block
--     a fresh join. Full join-leave history is reconstructible from
--     the table.
--
-- ON DELETE RESTRICT on both FKs: the event log will reference
-- participants, so neither sessions nor users can be hard-deleted
-- while participant rows exist (matches the soft-delete convention
-- on users from 0001_users.sql).
--
-- `gen_random_uuid()` is in core Postgres 13+; the dev stack pins
-- postgres:16-alpine, so this is safe (matches 0001_users.sql,
-- 0002_sessions.sql).

CREATE TABLE IF NOT EXISTS session_participants (
    -- Surrogate UUID primary key. Generated server-side so callers
    -- don't have to mint UUIDs themselves on insert.
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The session this participation row belongs to. RESTRICT so a
    -- session cannot be hard-deleted while it has participant rows.
    session_id      UUID            NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,

    -- The user filling this participation slot. RESTRICT so a user
    -- cannot be hard-deleted while they have participant rows
    -- (matches users' soft-delete convention from 0001_users.sql).
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- Role for this participation slot. TEXT + CHECK rather than an
    -- enum type (CC2) for extensibility — a future role is added
    -- by altering this CHECK constraint (F6).
    role            TEXT            NOT NULL
                                    CHECK (role IN ('moderator', 'debater-A', 'debater-B')),

    -- When this participation began. Server clock at insert time.
    joined_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- When this participation ended; NULL while the participant is
    -- still in the session. Leave-and-rejoin (F5) creates a new row
    -- rather than mutating this one.
    left_at         TIMESTAMPTZ     NULL
);

-- Lookup index for the most common query — "who's in this session
-- right now?" (filter by `left_at IS NULL` in the query, but the
-- session_id index is the access path).
CREATE INDEX IF NOT EXISTS session_participants_session_id_idx
    ON session_participants (session_id);

-- Partial unique index: at most one active occupant per
-- (session_id, role). v1 sessions have exactly one moderator and
-- two debaters (one in role `debater-A`, one in role `debater-B`);
-- this index enforces that no second active row can take an
-- already-occupied role. WHERE clause makes it partial so historical
-- (left) rows do not block re-occupation after a leave.
CREATE UNIQUE INDEX IF NOT EXISTS session_participants_active_role_idx
    ON session_participants (session_id, role)
    WHERE left_at IS NULL;

-- Partial unique index: at most one active row per (session_id,
-- user_id) — encodes C2 (a single user cannot hold two simultaneous
-- roles in the same session). Same partial-WHERE behavior: a user
-- who has left can rejoin without colliding.
CREATE UNIQUE INDEX IF NOT EXISTS session_participants_active_user_idx
    ON session_participants (session_id, user_id)
    WHERE left_at IS NULL;
