Feature: methodology engine — createSnapshot helper at the pglite seam
  # The Vitest tests at
  # apps/server/src/methodology/handlers/createSnapshot.test.ts cover
  # the helper's rule set in isolation (events constructed as TS
  # literals). This feature pins the same handler at the DB seam: the
  # session's lifecycle events round-trip through pglite's
  # `session_events` table (JSONB / TIMESTAMPTZ / BIGINT), the
  # projection is rebuilt from the round-tripped log, and the helper is
  # called against a `currentSequence` matching the projected session's
  # last applied sequence. Per ADR 0022 the DB-driven layer is
  # committed alongside the unit layer.
  #
  # Refinement: tasks/refinements/data-and-methodology/snapshot_create_logic.md

  Scenario: a valid label produces a snapshot-created envelope whose log_position equals currentSequence + 1
    # Six seeded lifecycle events bring the session to sequence 6. The
    # moderator triggers a snapshot with a clean label; the helper
    # returns Valid with one snapshot-created event at sequence 7 /
    # log_position 7.
    Given a seeded session at sequence 6 for snapshot-logic tests
    When the moderator calls createSnapshot with label "Segment 1 close" against the projected session
    Then the validation result is Valid
    And the result carries a single snapshot-created event whose log_position is 7 and label is "Segment 1 close"

  Scenario: an empty label is rejected as invalid-label
    Given a seeded session at sequence 6 for snapshot-logic tests
    When the moderator calls createSnapshot with an empty label against the projected session
    Then the validation result is Rejected with reason "invalid-label"

  Scenario: an over-cap label is rejected as invalid-label
    # 129 characters — one over MAX_SNAPSHOT_LABEL_LENGTH.
    Given a seeded session at sequence 6 for snapshot-logic tests
    When the moderator calls createSnapshot with a 129-character label against the projected session
    Then the validation result is Rejected with reason "invalid-label"
