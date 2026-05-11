Feature: diagnostic event emission — fired and cleared events surface across projection changes
  # The Vitest tests at apps/server/src/diagnostics/event-emission.test.ts
  # cover the aggregator, the diff, the identity-key canonicalization,
  # and the DiagnosticBus in isolation (events constructed as TS literals,
  # synthetic DiagnosticEntry constructors for the bus). This feature
  # covers the integration path: events round-trip through pglite's
  # `session_events` table — JSONB-encoded payloads, TIMESTAMPTZ
  # timestamps, BIGINT sequences — read back out, mapped to typed Event
  # envelopes via validateEvent, and projected via projectFromLog. The
  # diff against the previous diagnostic snapshot must report the same
  # fired/cleared entries against this DB-round-tripped projection.
  #
  # Per ADR 0022 the probe IS the committed scenario.
  #
  # Refinement: tasks/refinements/data-and-methodology/diagnostic_event_emission.md

  Scenario: a session that gains a cycle reports the cycle fired in the diff
    # Build a session with three nodes A, B, C and a partial supports
    # chain (A->B, B->C) that does not yet close a cycle. Project at
    # this position; capture the diagnostic snapshot (empty). Then
    # commit the closing C->A supports edge (plus the substance commits
    # for nodes and edges so the cycle's edges are active-firing).
    # Re-project; compute the new snapshot. diffDiagnostics(pre, post)
    # reports one fired entry of kind 'cycle' whose node set is {A, B, C}
    # and no cleared entries.
    Given a seeded session with three participants for event-emission tests
    And nodes A, B, C with a partial supports chain A->B, B->C for event-emission tests
    And entity-included events for the partial-chain nodes and edges
    And substance-agreed commits for the partial-chain nodes and edges
    When I project the event-emission log at the partial-chain position via projectFromLog
    And I record the partial-chain diagnostic snapshot
    Then the partial-chain diagnostic snapshot has no cycle entry
    Given the closing C->A supports edge with entity-included and substance-agreed commits for event-emission tests
    When I project the event-emission log at the closed-cycle position via projectFromLog
    Then diffDiagnostics from partial-chain to closed-cycle fires one cycle entry covering A, B, and C
    And diffDiagnostics from partial-chain to closed-cycle clears no entries

  Scenario: a session that breaks a cycle reports the cycle cleared in the diff
    # Build the same three-node cycle (A->B->C->A) with all substance
    # committed. Project at this position; capture the snapshot. Then
    # commit a break-edge against C->A. Re-project; compute the new
    # snapshot. diffDiagnostics(pre, post) reports one cleared entry of
    # kind 'cycle' whose node set is {A, B, C}, and no fired entries.
    Given a seeded session with three participants for event-emission tests
    And nodes A, B, C with a closed supports cycle A->B, B->C, C->A for event-emission tests
    And entity-included events for the closed-cycle nodes and edges
    And substance-agreed commits for the closed-cycle nodes and edges
    When I project the event-emission log at the closed-cycle position via projectFromLog
    And I record the closed-cycle diagnostic snapshot
    Then the closed-cycle diagnostic snapshot has one cycle entry covering A, B, and C
    Given a committed break-edge against the C->A edge for event-emission tests
    When I project the event-emission log at the post-break position via projectFromLog
    Then diffDiagnostics from closed-cycle to post-break clears one cycle entry covering A, B, and C
    And diffDiagnostics from closed-cycle to post-break fires no entries
