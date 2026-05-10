Feature: pglite supports the Postgres features the schema relies on
  # These scenarios are the framework probes — committed, not run
  # interactively. They answer "does pglite support feature X" by
  # asserting on real DDL/DML against a fresh in-memory Postgres.
  # The first scenario in a file IS allowed to be the probe — but it
  # must be committed, not interactive. See ADR 0022
  # (docs/adr/0022-no-throwaway-verifications.md) and ADR 0007's
  # Decision section for the layering rationale.

  Scenario: gen_random_uuid returns a UUID-shaped string
    When I select gen_random_uuid
    Then the result is a UUID-shaped string

  Scenario: JSONB round-trips a JSON object
    Given a probe table with a JSONB column
    When I insert the probe JSON object
    Then the round-tripped JSONB equals the inserted object

  Scenario: A partial unique index fires only on predicate-matching rows
    Given a probe table with a partial unique index on x where active is true
    When I insert two inactive rows with the same x
    Then both rows are accepted
    When I insert two active rows with the same x
    Then the second active insert is rejected

  Scenario: A CHECK (col IN ...) constraint rejects out-of-set values
    Given a probe table with a CHECK constraint that color is in red, green, blue
    When I insert a row with color "red"
    Then the row is accepted
    When I insert a row with color "purple"
    Then the row is rejected
