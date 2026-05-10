Feature: 0006_annotations — XOR on (target_node_id, target_edge_id), CHECK on kind
  # Per-migration regression: exactly one of target_node_id /
  # target_edge_id must be non-null (XOR); kind is restricted by CHECK.

  Scenario: Annotation with both targets set is rejected
    Given a user, a node A, and an edge from A to A by that user
    When I insert an annotation with both target_node_id and target_edge_id set
    Then the insert is rejected with a check-violation error

  Scenario: Annotation with neither target set is rejected
    Given a user, a node A, and an edge from A to A by that user
    When I insert an annotation with neither target_node_id nor target_edge_id set
    Then the insert is rejected with a check-violation error

  Scenario: Annotation kind "endorse" is rejected by the CHECK constraint
    Given a user, a node A, and an edge from A to A by that user
    When I insert an annotation with kind "endorse" targeting node A
    Then the insert is rejected with a check-violation error

  Scenario: Annotation targeting only a node is accepted
    Given a user, a node A, and an edge from A to A by that user
    When I insert an annotation with kind "note" targeting node A
    Then the row is accepted
