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

  # 0017_edges_polymorphic_endpoints — endpoints may be annotations;
  # per-endpoint XOR CHECKs; uniqueness preserved over the widened
  # tuple via NULLS NOT DISTINCT.

  Scenario: An edge from a node to an annotation is recorded
    Given a user, two nodes A and B, and an annotation on A by that user
    When I insert an edge "contradicts" from node B to the annotation
    Then the edge with the annotation target is recorded

  Scenario: An edge from an annotation to a node is recorded
    Given a user, two nodes A and B, and an annotation on A by that user
    When I insert an edge "contradicts" from the annotation to node B
    Then the edge with the annotation source is recorded

  Scenario: An edge with both a node and an annotation source is rejected
    Given a user, two nodes A and B, and an annotation on A by that user
    When I insert an edge "supports" with both source endpoint columns set
    Then the insert is rejected with a check-violation error

  Scenario: An edge with no target endpoint is rejected
    Given a user, two nodes A and B, and an annotation on A by that user
    When I insert an edge "supports" with no target endpoint
    Then the insert is rejected with a check-violation error

  Scenario: Duplicate annotation-target edge is rejected
    Given a user, two nodes A and B, and an annotation on A by that user
    And an edge "contradicts" from node B to the annotation
    When I insert an edge "contradicts" from node B to the annotation
    Then the insert is rejected with a unique-violation error

  Scenario: An edge referencing a non-existent annotation is rejected
    Given a user, and two nodes A and B by that user
    When I insert an edge "contradicts" with a non-existent target annotation
    Then the insert is rejected with a foreign-key-violation error
