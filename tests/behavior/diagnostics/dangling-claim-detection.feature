Feature: detectDanglingClaims — claim-positioned nodes without incoming justification are surfaced
  # The Vitest tests at apps/server/src/diagnostics/dangling-claim-detection.test.ts
  # cover the algorithm in isolation (events constructed as TS literals).
  # This feature covers the integration path: events are round-tripped
  # through pglite's `session_events` table — JSONB-encoded payloads,
  # TIMESTAMPTZ timestamps, BIGINT sequences — read back out, mapped to
  # typed Event envelopes via validateEvent, and projected via
  # projectFromLog. The dangling-claim rule (a node is claim-positioned
  # iff some visible edge has it as target, with a visible source; the
  # node is dangling iff none of those incoming visible edges have
  # role in {supports, rebuts, bridges-to} per docs/data-model.md
  # line 192; structural-only — no substance gate) must hold against
  # this DB-round-tripped projection too.
  # Per ADR 0022 the probe IS the committed scenario.
  #
  # Refinement: tasks/refinements/data-and-methodology/dangling_claim_detection.md

  Scenario: a claim-positioned node with only an incoming contradicts is dangling
    # session-created -> 3 participants joined -> node A -> node B ->
    # A->B contradicts edge -> entity-included for both nodes and the
    # edge. After replay, detectDanglingClaims returns one entry naming
    # B. A has no incoming at all — not claim-positioned — not in the
    # result. B is claim-positioned via the contradicts but the role is
    # NOT in the justification triplet (per docs/data-model.md line 192:
    # {supports, rebuts, bridges-to} only). Substance facets are
    # deliberately NOT committed agreed — the dangling-claim detection
    # is structural-only.
    Given a seeded session with three participants for dangling-claim-detection tests
    And nodes A and B for dangling-claim tests
    And an A->B contradicts edge for dangling-claim tests
    And entity-included events for the dangling-claim nodes and edges
    When I project the dangling-claim event log via projectFromLog
    Then detectDanglingClaims returns one entry naming B

  Scenario: a claim-positioned node with an incoming supports is not dangling
    # Same setup but the incoming edge is `supports` (which IS in the
    # justification triplet per docs/data-model.md line 192). B is
    # claim-positioned but justified — not dangling. A is not claim-
    # positioned (no incoming). detectDanglingClaims returns no entries.
    Given a seeded session with three participants for dangling-claim-detection tests
    And nodes A and B for dangling-claim tests
    And an A->B supports edge for dangling-claim tests
    And entity-included events for the dangling-claim nodes and edges
    When I project the dangling-claim event log via projectFromLog
    Then detectDanglingClaims returns no entries for dangling-claim tests
