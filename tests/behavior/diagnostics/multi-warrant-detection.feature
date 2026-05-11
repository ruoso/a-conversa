Feature: detectMultiWarrants — multi-warrant patterns on the same (data, claim) pair are surfaced
  # The Vitest tests at apps/server/src/diagnostics/multi-warrant-detection.test.ts
  # cover the algorithm in isolation (events constructed as TS literals).
  # This feature covers the integration path: events are round-tripped
  # through pglite's `session_events` table — JSONB-encoded payloads,
  # TIMESTAMPTZ timestamps, BIGINT sequences — read back out, mapped to
  # typed Event envelopes via validateEvent, and projected via
  # projectFromLog. The multi-warrant rule (only `bridges-from` +
  # `bridges-to` edges, only `visible === true`, complete warrants
  # only, group by (D, C), >= 2 warrants required, no substance
  # gate per docs/data-model.md line 187) must hold against this
  # DB-round-tripped projection too.
  # Per ADR 0022 the probe IS the committed scenario.
  #
  # Refinement: tasks/refinements/data-and-methodology/multi_warrant_detection.md

  Scenario: two complete warrants on the same (data, claim) pair are detected
    # session-created -> 3 participants joined -> data node D -> claim
    # node C -> warrant nodes W1, W2 -> four bridge edges (W1->D
    # bridges-from, W1->C bridges-to, W2->D bridges-from, W2->C
    # bridges-to) -> entity-included for all six entities. After replay,
    # detectMultiWarrants returns one entry naming D, C, and [W1, W2]
    # (sorted lexicographically). Substance facets are deliberately NOT
    # committed agreed — the multi-warrant detection is structural-only
    # per docs/data-model.md line 187.
    Given a seeded session with three participants for multi-warrant-detection tests
    And data node D, claim node C, and warrant nodes W1, W2 for multi-warrant tests
    And four bridge edges wiring W1 and W2 to D and C for multi-warrant tests
    And entity-included events for the multi-warrant nodes and edges
    When I project the multi-warrant event log via projectFromLog
    Then detectMultiWarrants returns one entry naming D, C, and warrants W1 and W2

  Scenario: a single complete warrant on (data, claim) is not a multi-warrant
    # Same setup as the previous scenario but only W1 (no W2). The
    # (D, C) group has one warrant; the >= 2 threshold isn't met.
    # detectMultiWarrants returns no entries.
    Given a seeded session with three participants for multi-warrant-detection tests
    And data node D, claim node C, and warrant node W1 only for multi-warrant tests
    And two bridge edges wiring W1 to D and C for multi-warrant tests
    And entity-included events for the multi-warrant single-warrant nodes and edges
    When I project the multi-warrant event log via projectFromLog
    Then detectMultiWarrants returns no entries for multi-warrant tests
