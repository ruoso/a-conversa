Feature: applyEventIncremental — apply a new event to an existing projection
  # The Vitest tests at apps/server/src/projection/incremental.test.ts
  # cover the in-memory dispatch + sequence-gap detection in isolation.
  # This feature covers the DB-driven path: events inserted into
  # pglite's `session_events` table, projected incrementally one row
  # at a time, with the same JSONB / TIMESTAMPTZ / BIGINT round-trip
  # the on-load `projectFromLog` path exercises.

  Scenario: steady-state stream — events insert and project one at a time
    # Load the empty fixture (4 events, projection at sequence 4),
    # then INSERT new events one-at-a-time and incrementally apply
    # each. lastAppliedSequence advances with each call.
    Given the empty fixture is loaded and the projection has caught up
    When I append a node-created event and incrementally project it
    Then the projection's lastAppliedSequence is 5
    When I append a second node-created event and incrementally project it
    Then the projection's lastAppliedSequence is 6

  Scenario: sequence gap is rejected; projection state unchanged
    # The dispatcher's contract: "exactly N+1 or throw." A gap
    # surfaces as OutOfOrderEventError; the projection's
    # lastAppliedSequence does not advance.
    Given the empty fixture is loaded and the projection has caught up
    When I attempt to apply an event at sequence 9 to a projection at sequence 4
    Then the apply throws an OutOfOrderEventError
    And the projection's lastAppliedSequence is still 4

  Scenario: incremental projection equals full-replay projection
    # Build a non-trivial event log (5+ events including a proposal
    # and a commit), compute the final state two ways, and assert
    # the two final projections are deep-equal in their fingerprint.
    Given a seeded session with three participants in session_events for incremental tests
    And a node-created event for the seeded incremental session
    And a classify-node proposal event for that node with classification "fact" for incremental tests
    And a commit event for that classify proposal for incremental tests
    When I project the full event log via projectFromLog
    And I project the same event log via repeated applyEventIncremental
    Then the two projections have identical fingerprints

  Scenario: change feed for a commit-classify-node round
    # Insert session-created + 3 participant-joined + node-created +
    # entity-included + proposal + 3 votes + commit; collect each
    # event's change feed. The final commit's change feed contains
    # both a pending-proposal-cleared and a facet-updated
    # (classification on the node).
    Given a seeded session with three participants in session_events for incremental tests
    And a node-created event for the seeded incremental session
    And an entity-included event for that node for incremental tests
    And a classify-node proposal event for that node with classification "fact" for incremental tests
    And three agree votes on that classify proposal for incremental tests
    And a commit event for that classify proposal for incremental tests
    When I walk the event log incrementally and collect per-event change feeds
    Then the commit event's change feed contains a pending-proposal-cleared with reason "commit"
    And the commit event's change feed contains a facet-updated with facet "classification" and value "fact"
