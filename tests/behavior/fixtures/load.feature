Feature: loadFixture — bundled "empty" fixture loads, is idempotent, rejects unknown names
  # The fixture loader at packages/test-fixtures/src/loader.ts is
  # truncate-then-insert. It populates the per-fixture users, session,
  # participants, and event-log rows. The bundled "empty" fixture has
  # 4 events and 3 participants in the canonical roles.

  Scenario: Loading the "empty" fixture populates 4 events and 3 participants in expected roles
    When I load the "empty" fixture
    Then the session_events row count is 4
    And the session_participants row count is 3
    And the participants have roles "moderator", "debater-A", "debater-B"

  Scenario: Loading the "empty" fixture twice is idempotent
    When I load the "empty" fixture
    And I load the "empty" fixture again
    Then the session_events row count is 4
    And the session_participants row count is 3

  Scenario: Loading an unknown fixture name throws
    When I try to load a fixture named "does-not-exist"
    Then the loader throws an unknown-fixture error
