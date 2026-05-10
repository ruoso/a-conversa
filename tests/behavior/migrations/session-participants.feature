Feature: 0003_session_participants — partial unique active-role and active-user, CHECK on role
  # Per-migration regression: at most one active row per
  # (session_id, role) and (session_id, user_id) — partial unique
  # indexes WHERE left_at IS NULL — and role is restricted by CHECK.

  Scenario: A second active occupant of the same role is rejected
    Given a host user, two debaters, and a session exist
    And the first debater joined as "debater-A"
    When the second debater also tries to join as "debater-A" while the first is active
    Then the insert is rejected with a unique-violation error

  Scenario: A user holding two simultaneous roles in the same session is rejected
    Given a host user, two debaters, and a session exist
    And the first debater joined as "debater-A"
    When the first debater tries to also join as "debater-B" while the first row is active
    Then the insert is rejected with a unique-violation error

  Scenario: The same role can be re-occupied after the previous holder leaves
    Given a host user, two debaters, and a session exist
    And the first debater joined as "debater-A"
    When the first debater leaves the session
    And the second debater joins as "debater-A"
    Then both joins are recorded

  Scenario: An invalid role is rejected by the CHECK constraint
    Given a host user, two debaters, and a session exist
    When the first debater tries to join as "spectator"
    Then the insert is rejected with a check-violation error
