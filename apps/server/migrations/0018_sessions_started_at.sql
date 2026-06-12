-- Sessions: queryable session start time + the public-list index.
--
-- Refinement: tasks/refinements/session_discovery/sd_schema.md
-- TaskJuggler: session_discovery.sd_schema
-- Forward-only per ADR 0020 (no down migration).
--
-- **What this adds.** A denormalized `started_at TIMESTAMPTZ NULL`
-- column on `sessions` plus the partial index the public discovery
-- list needs. The session lifecycle today is `created_at` / `ended_at`
-- only; the lobby -> operate transition lives purely in the event log
-- (ADR 0028 added a wire event, not a SQL column). The two discovery
-- lists ("My Sessions", "Public Sessions") both sort by start time, and
-- the public list must cheaply exclude unstarted sessions — so the
-- started marker has to be an indexable relational column, not a
-- per-query scan of `session_events` JSONB (Decision D1).
--
-- **`started_at` is a maintained read-model projection**, not an
-- independently-settable field: the event log stays the source of
-- truth. It is NULL for lobby (unstarted) sessions and non-NULL exactly
-- when a `session-mode-changed -> operate` event exists for the
-- session — true for both the rows backfilled below and go-forward
-- writes from `POST /api/sessions/:id/start`, which sets the column in
-- the same transaction that appends the operate event (Decision D2).
--
-- **Backward-compat (ADR 0034 image-rollback invariant).** The
-- immediately previous deployed image never reads or writes
-- `started_at`; a nullable ADD COLUMN, a CREATE INDEX, and a backfill
-- UPDATE are all transparent to it. The migration-safety linter
-- (`pnpm run lint:migrations`) is clean on this file by construction —
-- no drop/rename/alter-type/set-not-null/add-not-null-without-default/
-- truncate — so no escape-hatch marker is needed.
--
-- **Forward-only, single-transaction (ADR 0020).** The runner wraps
-- each migration in one transaction; `CREATE INDEX CONCURRENTLY`
-- cannot run inside a transaction, so this uses a plain, non-concurrent
-- `CREATE INDEX` — consistent with `0002_sessions.sql` and acceptable
-- at pre-MVP table sizes (Decision D6). The IF NOT EXISTS / IF NOT
-- EXISTS guards mirror `0002_sessions.sql` and keep the file idempotent.

-- 1. The denormalized started marker. NULL <=> not-yet-started,
--    mirroring the existing `ended_at` nullability pattern.
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL;

-- 2. Partial index backing the public-discovery list: started, public
--    sessions ordered most-recent-first. Mirrors the shape of the
--    legacy `sessions_public_idx` (which is left in place — forward-
--    only, harmless; dropping it is needless churn, Decision D5). The
--    `started_at IS NOT NULL` predicate keeps the index to exactly the
--    rows the list can enumerate, enforcing the lobby-secrecy rule:
--    unstarted sessions are never listable.
CREATE INDEX IF NOT EXISTS sessions_public_started_idx
    ON sessions (started_at DESC)
    WHERE privacy = 'public' AND started_at IS NOT NULL;

-- 3. Backfill from the earliest `session-mode-changed -> operate`
--    event's server-clock `created_at` per session (Decision D3).
--    `created_at` is the server insert clock — monotonic with
--    `sequence` and the same source the go-forward `NOW()` write
--    approximates — so backfilled and new rows are consistent.
--    `payload.changed_at` is the actor's reported time and can skew, so
--    it is deliberately not used. Rides the existing
--    `session_events_session_kind_idx`. Sessions with no such event
--    keep `started_at NULL`.
UPDATE sessions s
SET started_at = e.first_op
FROM (
    SELECT session_id, MIN(created_at) AS first_op
    FROM session_events
    WHERE kind = 'session-mode-changed'
      AND payload->>'new_mode' = 'operate'
    GROUP BY session_id
) e
WHERE e.session_id = s.id;
