Feature: session_nodes / session_edges / session_annotations — composite PK uniqueness
  # Per-migration regression: each join table has a composite PK on
  # (session_id, <entity>_id); a duplicate inclusion fails.

  Scenario: Duplicate session_nodes inclusion is rejected
    Given a user, a session, and a node by that user
    And the node is included in the session
    When I include the same node in the same session again
    Then the insert is rejected with a unique-violation error

  Scenario: Duplicate session_edges inclusion is rejected
    Given a user, a session, two nodes A and B by that user, and an edge A->B
    And the edge is included in the session
    When I include the same edge in the same session again
    Then the insert is rejected with a unique-violation error

  Scenario: Duplicate session_annotations inclusion is rejected
    Given a user, a session, a node A by that user, and an annotation on A
    And the annotation is included in the session
    When I include the same annotation in the same session again
    Then the insert is rejected with a unique-violation error
