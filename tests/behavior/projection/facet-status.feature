Feature: deriveFacetStatus — derive overall facet status from per-participant votes + commits
  # The Vitest tests at apps/server/src/projection/facet-status.test.ts
  # cover the in-memory derivation in isolation (events constructed as
  # TS literals). This feature covers the integration path: events are
  # round-tripped through pglite's `session_events` table — JSONB-
  # encoded payloads, TIMESTAMPTZ timestamps, BIGINT sequences — read
  # back out, mapped to typed Event envelopes via validateEvent, and
  # projected via projectFromLog. The derived facet status must hold
  # against this DB-round-tripped projection too. Per ADR 0022 the
  # probe IS the committed scenario.

  Scenario: classify-node round arrives at status committed
    # session-created -> 3 participants -> 1 node -> entity-included
    # -> proposal(classify-node "fact") -> 3 votes(agree) -> commit.
    # After replay, deriveFacetStatus on the node's classification
    # facet returns "committed".
    Given a seeded session with three participants in session_events for facet-status tests
    And a node-created event for the seeded facet-status session
    And an entity-included event for that node for facet-status tests
    And a classify-node proposal event for that node with classification "fact" for facet-status tests
    And three agree votes on that classify proposal for facet-status tests
    And a commit event for that classify proposal for facet-status tests
    When I project the facet-status event log via projectFromLog
    Then deriveFacetStatus on the seeded node's classification facet is "committed"

  Scenario: withdrawal after commit reverts the facet to withdrawn
    # Same setup as above, then INSERT a vote with vote='withdraw'
    # from one participant. Replay; deriveFacetStatus returns
    # "withdrawn".
    Given a seeded session with three participants in session_events for facet-status tests
    And a node-created event for the seeded facet-status session
    And an entity-included event for that node for facet-status tests
    And a classify-node proposal event for that node with classification "fact" for facet-status tests
    And three agree votes on that classify proposal for facet-status tests
    And a commit event for that classify proposal for facet-status tests
    And a withdraw vote on that classify proposal for facet-status tests
    When I project the facet-status event log via projectFromLog
    Then deriveFacetStatus on the seeded node's classification facet is "withdrawn"
