Feature: projectAtPosition — replay a session event log to a sequence position
  Scenario: projecting the empty fixture at position 0 yields the empty baseline
    When I load the "empty" fixture and project it at position 0
    Then the projection's sessionState is "open"
    And the projection has 0 nodes
    And the projection has 0 edges
    And the projection has 0 pending proposals
    And the projection has 0 current participants

  Scenario: the walkthrough projected at the recorded Segment 1 close log position excludes the snapshot event itself
    When I load the walkthrough fixture and project it at the recorded log position for snapshot "Segment 1 close"
    Then the at-position projection has lastAppliedSequence 265
    And the walkthrough projection does not contain a snapshot labeled "Segment 1 close"

  Scenario: the walkthrough projected at the Segment 1 close snapshot event includes that snapshot
    When I load the walkthrough fixture and project it at the snapshot-created event for snapshot "Segment 1 close"
    Then the at-position projection has lastAppliedSequence 266
    And the walkthrough projection contains a snapshot labeled "Segment 1 close"

  Scenario: projecting the walkthrough at head matches full replay
    When I load the walkthrough fixture and project it at head and via full replay
    Then the walkthrough projection contains a snapshot labeled "Segment 1 close"
    And the at-position projection matches the full-replay fingerprint
