Feature: 0004_nodes — created_by FK, reword, restructure
  # Per-migration regression: nodes.created_by FK to users(id) with
  # RESTRICT; reword is an UPDATE in place (id unchanged); restructure
  # is INSERT-of-new-id while the old row is preserved.

  Scenario: A node with a non-existent created_by is rejected
    When I insert a node with a created_by that does not exist
    Then the insert is rejected with a foreign-key-violation error

  Scenario: Reword updates wording in place; the id is unchanged
    Given a user "authelia:alice" and a node "Original wording" by alice
    When I update the node's wording to "Reworded statement"
    Then the node's id is unchanged
    And the node's wording is "Reworded statement"

  Scenario: Restructure inserts a new node; the old row is preserved
    Given a user "authelia:alice" and a node "First wording" by alice
    When I insert a new node "Restructured wording" by alice with a different id
    Then both the old and new node rows exist with their original wordings
