Feature: detectCoherencyHints — unusual edge/kind configurations are surfaced
  # The Vitest tests at apps/server/src/diagnostics/coherency-hint-detection.test.ts
  # cover the algorithm in isolation (events constructed as TS literals).
  # This feature covers the integration path: events are round-tripped
  # through pglite's `session_events` table — JSONB-encoded payloads,
  # TIMESTAMPTZ timestamps, BIGINT sequences — read back out, mapped to
  # typed Event envelopes via validateEvent, and projected via
  # projectFromLog. The coherency-hint rules (a warrant with only a
  # bridges-from is incomplete; a warrant with both bridge edges is
  # complete; both rules use the visibility filter only, no substance
  # gate per docs/data-model.md lines 143–151 and 195–197) must hold
  # against this DB-round-tripped projection too.
  # Per ADR 0022 the probe IS the committed scenario.
  #
  # Refinement: tasks/refinements/data-and-methodology/coherency_hint_detection.md

  Scenario: a warrant with bridges-from but no bridges-to is flagged as incomplete
    # session-created -> 3 participants joined -> data node D -> warrant
    # node W -> W->D bridges-from edge (NO bridges-to) -> entity-included
    # for all three entities. After replay, detectCoherencyHints returns
    # one entry of kind `incomplete-warrant-missing-bridges-to` naming
    # W and D. Substance facets are deliberately NOT committed agreed —
    # the coherency-hint detection is structural-only per docs/data-model.md
    # lines 143–151.
    Given a seeded session with three participants for coherency-hint-detection tests
    And data node D and warrant node W for coherency-hint tests
    And a W->D bridges-from edge for coherency-hint tests
    And entity-included events for the incomplete-warrant coherency-hint nodes and edge
    When I project the coherency-hint event log via projectFromLog
    Then detectCoherencyHints returns one incomplete-warrant-missing-bridges-to entry naming W and D

  Scenario: a complete warrant produces no incomplete-warrant hint
    # Same setup but the warrant has BOTH bridge edges: W->D bridges-from
    # AND W->C bridges-to. Both incomplete-warrant rules suppress (since
    # each requires the absence of the opposite bridge edge), and there
    # is no contradicts edge so the self-contradicts rule doesn't fire
    # either. detectCoherencyHints returns no entries.
    Given a seeded session with three participants for coherency-hint-detection tests
    And data node D, claim node C, and warrant node W for coherency-hint tests
    And W->D bridges-from and W->C bridges-to edges for coherency-hint tests
    And entity-included events for the complete-warrant coherency-hint nodes and edges
    When I project the coherency-hint event log via projectFromLog
    Then detectCoherencyHints returns no entries for coherency-hint tests
