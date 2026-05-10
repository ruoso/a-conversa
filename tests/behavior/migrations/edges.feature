Feature: 0005_edges — UNIQUE on (role, source, target), reverse direction allowed, CHECK on role, FK on endpoints
  # Per-migration regression: duplicate edge rows with the same
  # (role, source, target) are rejected; the reversed direction
  # (role, target, source) is permitted; role is restricted by CHECK;
  # endpoints FK to nodes(id) with RESTRICT.

  Scenario: Duplicate edge with same role and endpoints is rejected
    Given a user, and two nodes A and B by that user
    And an edge "supports" from A to B
    When I insert another edge "supports" from A to B
    Then the insert is rejected with a unique-violation error

  Scenario: Reverse-direction edge with same role is permitted
    Given a user, and two nodes A and B by that user
    And an edge "contradicts" from A to B
    When I insert an edge "contradicts" from B to A
    Then both edges are recorded

  Scenario: An invalid edge role is rejected by the CHECK constraint
    Given a user, and two nodes A and B by that user
    When I insert an edge with role "endorses" from A to B
    Then the insert is rejected with a check-violation error

  Scenario: An edge with a non-existent source endpoint is rejected
    Given a user, and two nodes A and B by that user
    When I insert an edge "supports" with a non-existent source node
    Then the insert is rejected with a foreign-key-violation error
