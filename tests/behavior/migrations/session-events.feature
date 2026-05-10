Feature: 0010_session_events — UNIQUE on (session_id, sequence), CHECK on kind, nullable actor
  # Per-migration regression: duplicate (session_id, sequence) pairs
  # are rejected; an unknown kind fails the CHECK; actor is nullable.

  Scenario: Duplicate (session_id, sequence) is rejected
    Given a user and a session by that user
    And a "session-created" event with sequence 1 in that session
    When I insert another event with the same session and sequence 1
    Then the insert is rejected with a unique-violation error

  Scenario: An unknown kind is rejected by the CHECK constraint
    Given a user and a session by that user
    When I insert an event with kind "unknown-kind" in that session
    Then the insert is rejected with a check-violation error

  Scenario: An event with a NULL actor is accepted
    Given a user and a session by that user
    When I insert a "session-ended" event with sequence 7 and a NULL actor
    Then the row is accepted
