Feature: isEdgeActive — an edge fires when its substance and its source's substance are both settled-agreed
  # The Vitest tests at apps/server/src/projection/active-firing.test.ts
  # cover the in-memory computation in isolation (events constructed
  # as TS literals). This feature covers the integration path: events
  # are round-tripped through pglite's `session_events` table —
  # JSONB-encoded payloads, TIMESTAMPTZ timestamps, BIGINT sequences —
  # read back out, mapped to typed Event envelopes via validateEvent,
  # and projected via projectFromLog. The active-firing rule
  # (`edge.substance ∧ source.substance`, per docs/data-model.md
  # line 100) must hold against this DB-round-tripped projection too.
  # Per ADR 0022 the probe IS the committed scenario.

  Scenario: an edge becomes active after both endpoints' substance commits
    # session-created -> 3 participants -> source-node, target-node ->
    # entity-included (3) -> supports edge -> set-node-substance
    # proposal on source (value 'agreed') -> 3 votes(agree) -> commit
    # -> set-edge-substance proposal on the edge (value 'agreed') ->
    # 3 votes(agree) -> commit. After replay, isEdgeActive on the
    # edge returns true.
    Given a seeded session with three participants for active-firing tests
    And source and target nodes plus a supports edge for active-firing tests
    And entity-included events for the source, target, and edge for active-firing tests
    And a set-node-substance proposal on the source with value "agreed" committed by all for active-firing tests
    And a set-edge-substance proposal on the edge with value "agreed" committed by all for active-firing tests
    When I project the active-firing event log via projectFromLog
    Then isEdgeActive on the seeded edge is true for active-firing tests

  Scenario: an edge is not active when the source-node substance has not committed
    # Same setup as the first scenario but the set-node-substance
    # proposal on the source is only partially voted (2 of 3 agree)
    # and never committed. After replay, isEdgeActive on the edge
    # returns false: the edge substance is settled, but the source's
    # is not.
    Given a seeded session with three participants for active-firing tests
    And source and target nodes plus a supports edge for active-firing tests
    And entity-included events for the source, target, and edge for active-firing tests
    And a set-node-substance proposal on the source with value "agreed" partially voted for active-firing tests
    And a set-edge-substance proposal on the edge with value "agreed" committed by all for active-firing tests
    When I project the active-firing event log via projectFromLog
    Then isEdgeActive on the seeded edge is false for active-firing tests
