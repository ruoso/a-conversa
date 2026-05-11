Feature: detectSupportsCycles — cycles in the visible, active supports graph are surfaced
  # The Vitest tests at apps/server/src/diagnostics/cycle-detection.test.ts
  # cover the algorithm in isolation (events constructed as TS literals).
  # This feature covers the integration path: events are round-tripped
  # through pglite's `session_events` table — JSONB-encoded payloads,
  # TIMESTAMPTZ timestamps, BIGINT sequences — read back out, mapped to
  # typed Event envelopes via validateEvent, and projected via
  # projectFromLog. The cycle-detection rule (only `supports` edges,
  # only `visible === true`, only `isEdgeActive === true`, per
  # docs/data-model.md lines 170-175) must hold against this
  # DB-round-tripped projection too.
  # Per ADR 0022 the probe IS the committed scenario.
  #
  # Refinement: tasks/refinements/data-and-methodology/cycle_detection.md

  Scenario: a three-node supports cycle (A -> B -> C -> A) is detected
    # session-created -> 3 participants joined -> 3 nodes (A, B, C) ->
    # 3 supports edges (A->B, B->C, C->A) -> 3 entity-included for nodes
    # -> 3 entity-included for edges -> commit substance:agreed for each
    # node -> commit substance:agreed for each edge. After replay,
    # detectSupportsCycles returns one cycle containing all three nodes.
    Given a seeded session with three participants for cycle-detection tests
    And three nodes A, B, C plus three supports edges A->B, B->C, C->A for cycle-detection tests
    And entity-included events for the three nodes and three edges for cycle-detection tests
    And the substance of each cycle node is committed agreed for cycle-detection tests
    And the substance of each cycle edge is committed agreed for cycle-detection tests
    When I project the cycle-detection event log via projectFromLog
    Then detectSupportsCycles returns one cycle containing all three cycle-detection nodes

  Scenario: a three-node supports chain (A -> B -> C, no C -> A) has no cycle
    # Same setup as the first scenario but only two supports edges
    # (A->B and B->C). detectSupportsCycles returns no cycles.
    Given a seeded session with three participants for cycle-detection tests
    And three nodes A, B, C plus two supports edges A->B, B->C for cycle-detection tests
    And entity-included events for the three nodes and two edges for cycle-detection tests
    And the substance of each cycle node is committed agreed for cycle-detection tests
    And the substance of each chain edge is committed agreed for cycle-detection tests
    When I project the cycle-detection event log via projectFromLog
    Then detectSupportsCycles returns no cycles for cycle-detection tests

  Scenario: a three-node cycle disappears after one supports edge is broken via committed break-edge
    # Same setup as the first scenario, then a break-edge proposal
    # against the C->A edge is voted-agree by all and committed. The
    # committed break-edge flips that edge's visible flag to false via
    # the replay's break-edge arm. detectSupportsCycles returns no
    # cycles.
    Given a seeded session with three participants for cycle-detection tests
    And three nodes A, B, C plus three supports edges A->B, B->C, C->A for cycle-detection tests
    And entity-included events for the three nodes and three edges for cycle-detection tests
    And the substance of each cycle node is committed agreed for cycle-detection tests
    And the substance of each cycle edge is committed agreed for cycle-detection tests
    And a break-edge proposal against the C->A edge is committed by all for cycle-detection tests
    When I project the cycle-detection event log via projectFromLog
    Then detectSupportsCycles returns no cycles for cycle-detection tests
