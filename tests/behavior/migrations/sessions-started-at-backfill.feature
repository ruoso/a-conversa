Feature: 0018_sessions_started_at — backfill started_at from the earliest operate event

  The discovery migration adds a denormalized `started_at TIMESTAMPTZ
  NULL` column to `sessions` and backfills it, per session, from the
  earliest `session-mode-changed -> operate` event's server-clock
  `created_at` (sd_schema Decision D3). A session that never transitioned
  out of the lobby (no such event) keeps `started_at NULL` — the
  load-bearing lobby-secrecy predicate the public discovery list filters
  on (`started_at IS NOT NULL`).

  The per-scenario pglite has every migration applied before the
  scenario runs (support/world.ts `Before`), so these scenarios seed
  pre-migration-shaped rows — a session with `started_at IS NULL` and a
  historical operate event — and then RE-RUN migration 0018 to exercise
  its idempotent backfill UPDATE against the actual shipped SQL (no
  duplicated query string; the migration file is read and executed).

  Refinement: tasks/refinements/session_discovery/sd_schema.md
  ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
               docs/adr/0028-session-mode-changed-wire-event.md,
               docs/adr/0034-releases-calendar-versioning-tag-deploy.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a user and a session by that user
    And that session's started_at is NULL

  Scenario: Backfill sets started_at to the earliest operate event's created_at
    Given a "session-mode-changed" operate event in that session at "2026-03-01T10:00:00Z" with sequence 3
    And a "session-mode-changed" operate event in that session at "2026-04-01T10:00:00Z" with sequence 5
    When migration 0018 is re-applied
    Then that session's started_at equals "2026-03-01T10:00:00Z"

  Scenario: A session with no operate event keeps started_at NULL
    Given a "session-mode-changed" lobby event in that session at "2026-03-01T10:00:00Z" with sequence 3
    When migration 0018 is re-applied
    Then that session's started_at is NULL
