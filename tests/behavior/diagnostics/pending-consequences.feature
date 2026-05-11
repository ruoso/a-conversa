Feature: detectPendingConsequences — agreed-substance edges with unagreed-substance source are surfaced
  # The Vitest tests at apps/server/src/diagnostics/pending-consequences.test.ts
  # cover the algorithm in isolation (events constructed as TS literals).
  # This feature covers the integration path: events are round-tripped
  # through pglite's `session_events` table — JSONB-encoded payloads,
  # TIMESTAMPTZ timestamps, BIGINT sequences — read back out, mapped to
  # typed Event envelopes via validateEvent, and projected via
  # projectFromLog. The pending-consequence rule (visible edges only,
  # edge.substance settled-agreed AND source.substance NOT settled-
  # agreed per docs/data-model.md line 104, plus the asymmetric
  # defeater shape at line 102) must hold against this DB-round-tripped
  # projection too. Per ADR 0022 the probe IS the committed scenario.
  #
  # The feature ships exactly two scenarios — one positive, one
  # negative — matching the v1 "stub" framing in the refinement:
  # the detector is callable and tested but is NOT wired into the
  # diagnostic event stream in v1.
  #
  # Refinement: tasks/refinements/data-and-methodology/pending_consequences_stub.md

  Scenario: an agreed-substance edge whose source is still proposed is a pending consequence
    # session-created -> 3 participants joined -> 2 nodes (source,
    # target) -> 1 supports edge source->target -> entity-included for
    # nodes and edge -> commit substance:agreed for the edge. The
    # source node's substance is left in the default 'proposed' state
    # (no proposal at all). After replay, detectPendingConsequences
    # returns one entry containing the edge id, source node id, and
    # reason 'source-substance-proposed'.
    Given a seeded session with three participants for pending-consequences tests
    And one source node, one target node, plus a supports edge source->target for pending-consequences tests
    And entity-included events for the pending-consequences nodes and edge
    And the substance of the pending-consequences edge is committed agreed
    When I project the pending-consequences event log via projectFromLog
    Then detectPendingConsequences returns one pending consequence for the pending-consequences edge with reason source-substance-proposed

  Scenario: an active edge (both substances committed-agreed) is not a pending consequence
    # Same setup but the source node's substance is ALSO committed-
    # agreed — so the edge is actively firing per isEdgeActive. The
    # detector explicitly excludes active edges (pending-consequence
    # is the asymmetric counterpart, not the conjunction).
    Given a seeded session with three participants for pending-consequences tests
    And one source node, one target node, plus a supports edge source->target for pending-consequences tests
    And entity-included events for the pending-consequences nodes and edge
    And the substance of the pending-consequences edge is committed agreed
    And the substance of the pending-consequences source node is committed agreed
    When I project the pending-consequences event log via projectFromLog
    Then detectPendingConsequences returns no pending consequences for pending-consequences tests
