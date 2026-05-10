-- Users table — global, one row per authenticated platform user.
--
-- Refinement: tasks/refinements/data-and-methodology/users_table.md
-- TaskJuggler: data_and_methodology.schema.users_table
-- Forward-only per ADR 0020 (no down migration).
--
-- Decisions captured by the refinement:
--   * Primary key is UUID (CC1).
--   * `screen_name` is not unique (F1) — display-name style; identity is
--     the OAuth subject.
--   * `screen_name` is VARCHAR(64), UTF-8 (the cluster default encoding).
--   * Deletion is soft (F3): `deleted_at` is set rather than the row being
--     removed, so historical event-log entries can still resolve to a name.
--
-- `gen_random_uuid()` is in core Postgres 13+ (no extension required).
-- The dev stack pins postgres:16-alpine, so this is safe.

CREATE TABLE IF NOT EXISTS users (
    -- Surrogate UUID primary key. Generated server-side so callers don't
    -- have to mint UUIDs themselves on insert.
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

    -- OAuth subject identifier, namespaced by provider to avoid collisions
    -- across providers. Recommended format: `provider:subject`
    -- (e.g. `authelia:alice`). Unique — this is the real identity key.
    oauth_subject   TEXT            NOT NULL UNIQUE,

    -- User-chosen display/screen name. UTF-8, capped at 64 characters.
    -- Not unique: two users may pick the same screen name.
    screen_name     VARCHAR(64)     NOT NULL,

    -- Row creation timestamp. Server clock at insert time.
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Soft-delete marker. NULL while the user is active; set to the
    -- deletion time when the account is removed. The row is preserved
    -- so historical event-log entries continue to resolve to a name.
    deleted_at      TIMESTAMPTZ     NULL
);

-- Non-unique lookup index on screen_name (e.g. directory search).
-- Uniqueness is intentionally not enforced — see refinement F1.
CREATE INDEX IF NOT EXISTS users_screen_name_idx
    ON users (screen_name);

-- Note: the unique index on `oauth_subject` is implicit via the column's
-- UNIQUE constraint above; no separate CREATE UNIQUE INDEX needed.
