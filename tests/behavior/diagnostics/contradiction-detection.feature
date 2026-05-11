Feature: detectContradictions — agreed contradicts edges in the visible, active graph are surfaced
  # The Vitest tests at apps/server/src/diagnostics/contradiction-detection.test.ts
  # cover the algorithm in isolation (events constructed as TS literals).
  # This feature covers the integration path: events are round-tripped
  # through pglite's `session_events` table — JSONB-encoded payloads,
  # TIMESTAMPTZ timestamps, BIGINT sequences — read back out, mapped to
  # typed Event envelopes via validateEvent, and projected via
  # projectFromLog. The contradiction-detection rule (only `contradicts`
  # edges, only `visible === true`, edge.substance AND source.substance
  # AND target.substance all settled-agreed per docs/data-model.md
  # line 178) must hold against this DB-round-tripped projection too.
  # Per ADR 0022 the probe IS the committed scenario.
  #
  # Refinement: tasks/refinements/data-and-methodology/contradiction_detection.md

  Scenario: an agreed contradicts edge between two agreed nodes is detected
    # session-created -> 3 participants joined -> 2 nodes (A, B) ->
    # 1 contradicts edge A->B -> entity-included for nodes and edge ->
    # commit substance:agreed for each node -> commit substance:agreed
    # for the edge. After replay, detectContradictions returns one
    # entry containing both nodes and the edge id.
    Given a seeded session with three participants for contradiction-detection tests
    And two nodes A, B plus one contradicts edge A->B for contradiction-detection tests
    And entity-included events for the contradiction-detection nodes and edge
    And the substance of each contradiction node is committed agreed for contradiction-detection tests
    And the substance of the contradicts edge is committed agreed for contradiction-detection tests
    When I project the contradiction-detection event log via projectFromLog
    Then detectContradictions returns one contradiction pair containing both contradiction-detection nodes and the contradicts edge

  Scenario: a pending contradicts edge (substance proposal not committed) is not detected
    # Same setup but the contradicts edge's substance proposal is left
    # uncommitted (proposed but no all-agree commit). The endpoints'
    # substance is committed-agreed. detectContradictions returns no
    # contradictions because the edge isn't actively firing.
    Given a seeded session with three participants for contradiction-detection tests
    And two nodes A, B plus one contradicts edge A->B for contradiction-detection tests
    And entity-included events for the contradiction-detection nodes and edge
    And the substance of each contradiction node is committed agreed for contradiction-detection tests
    And the substance of the contradicts edge is proposed but uncommitted for contradiction-detection tests
    When I project the contradiction-detection event log via projectFromLog
    Then detectContradictions returns no contradictions for contradiction-detection tests

  Scenario: an amend-node commit against one endpoint leaves the agreed contradicts edge in place
    # Same setup as scenario 1, then an amend-node proposal against A
    # is voted-agree by all and committed. The commit updates A's
    # wording in place but does NOT flip the contradicts edge's
    # visible flag or its substance value. detectContradictions STILL
    # returns one contradiction. This documents the v1 contract: the
    # methodology may say amend-node "removes the conflict" but the
    # projection has no read-side signal of the semantic shift — the
    # agreed contradicts edge is still in the graph at agreed
    # substance, and both endpoints' substance is still agreed. A
    # follow-up break-edge or substance withdrawal is required for
    # the detector to go silent.
    Given a seeded session with three participants for contradiction-detection tests
    And two nodes A, B plus one contradicts edge A->B for contradiction-detection tests
    And entity-included events for the contradiction-detection nodes and edge
    And the substance of each contradiction node is committed agreed for contradiction-detection tests
    And the substance of the contradicts edge is committed agreed for contradiction-detection tests
    And an amend-node proposal against A is committed by all for contradiction-detection tests
    When I project the contradiction-detection event log via projectFromLog
    Then detectContradictions returns one contradiction pair containing both contradiction-detection nodes and the contradicts edge
