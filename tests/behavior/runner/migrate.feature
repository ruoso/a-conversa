Feature: Migration runner — apply, record, rerun-as-noop
  # Test-only runner under tests/behavior/support/migrate.ts (which
  # mirrors apps/server/scripts/migrate.ts in spirit but reads SQL
  # files directly because pglite isn't a pg.ClientBase). The
  # production node-pg-migrate runner records each applied migration
  # in `pgmigrations`; this scenario asserts the same shape.

  # The Before hook in support/world.ts already applies migrations
  # against a fresh pglite for every scenario, so by the time any
  # scenario runs the table is fully populated. We re-assert here
  # explicitly to pin the runner's contract.

  Scenario: Applying migrations records every migration in pgmigrations
    Then the pgmigrations table has one row per migration file
    And every migration file's basename appears in pgmigrations

  Scenario: Re-running the migration runner is a no-op
    When I run the migration runner again
    Then no additional migrations are reported as applied
    And the pgmigrations row count is unchanged
