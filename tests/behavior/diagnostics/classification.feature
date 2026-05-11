Feature: blocking vs advisory classification — partition diagnostics from a round-tripped projection
  # The Vitest tests at apps/server/src/diagnostics/classification.test.ts
  # cover the classifier and the partition helper as pure functions
  # over synthetic DiagnosticEntry literals. This feature covers the
  # integration path: events round-trip through pglite's session_events
  # table — JSONB-encoded payloads, TIMESTAMPTZ timestamps, BIGINT
  # sequences — read back out, mapped to typed Event envelopes via
  # validateEvent, and projected via projectFromLog. The diagnostic
  # entries computed off the round-tripped projection partition into
  # the blocking and advisory buckets exactly as the pure-function
  # tests assert.
  #
  # Per ADR 0022 the probe IS the committed scenario.
  #
  # Refinement: tasks/refinements/data-and-methodology/blocking_vs_advisory_classification.md

  Scenario: a session with both a cycle and a multi-warrant pattern partitions into the right buckets
    # Build a session that simultaneously surfaces a blocking diagnostic
    # (a three-node supports cycle A -> B -> C -> A with all substance
    # commits) AND an advisory diagnostic (a multi-warrant pattern on
    # a separate (D, K) data/claim pair with two warrants W1 and W2
    # bridging it). Project the full event log; call
    # computeAllDiagnostics to surface the entry list; pass through
    # partitionBySeverity. Assert the cycle lands in the blocking
    # bucket and the multi-warrant lands in the advisory bucket;
    # assert each bucket has exactly the expected kind(s).
    Given a seeded session with three participants for classification tests
    And nodes A, B, C with a closed supports cycle for classification tests
    And nodes D, K with two warrants W1 and W2 bridging D to K for classification tests
    And entity-included events for the classification fixture entities
    And substance-agreed commits for the classification fixture entities
    When I project the classification log via projectFromLog
    And I compute all diagnostics and partition by severity
    Then the classification blocking bucket contains exactly one cycle entry covering A, B, and C
    And the classification advisory bucket contains exactly one multi-warrant entry on D and K with warrants W1 and W2
    And every classification entry lands in exactly one bucket
