Feature: methodology engine — propose break-edge handler against a DB-projected session
  # The Vitest tests at
  # apps/server/src/methodology/handlers/proposeBreakEdge.test.ts cover
  # the propose-break-edge handler's rule set in isolation (events
  # constructed as TS literals). This feature covers the integration
  # path: the session's events are round-tripped through pglite's
  # `session_events` table (JSONB / TIMESTAMPTZ / BIGINT), replayed
  # through `projectFromLog`, and the resulting projection is the one
  # `validateAction` operates against. Per ADR 0022 the DB-driven layer
  # is committed alongside the unit layer.
  #
  # Refinement: tasks/refinements/data-and-methodology/break_edge_logic.md

  Scenario: a participant proposes breaking a visible edge
    # Three participants joined; two nodes and a `supports` edge between
    # them were created and are currently visible. A debater proposes a
    # break-edge against the edge; the handler validates against the
    # DB-projected projection and returns Valid with one proposal event
    # whose payload mirrors the action's break-edge payload.
    Given a seeded session with three participants and a visible candidate edge for propose-break-edge tests
    When a debater constructs a propose-break-edge action against the visible edge
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Valid
    And the result carries a single proposal event for the break-edge action

  Scenario: a propose-break-edge against an unknown edge is rejected as target-entity-not-found
    # Three participants joined; no edge matching the proposed edge_id
    # has been created in this session. The handler's rule 1 rejects
    # with target-entity-not-found.
    Given a seeded session with three participants and no candidate edge for propose-break-edge tests
    When a debater constructs a propose-break-edge action against an unknown edge
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Rejected with reason "target-entity-not-found"

  Scenario: a propose-break-edge against an already-broken edge is rejected as illegal-state-transition
    # Three participants joined; an edge created, a prior break-edge
    # proposal committed against it (edge.visible is now false). A new
    # break-edge proposal against the same edge is rejected — rule 2.
    Given a seeded session with three participants and a previously-broken edge for propose-break-edge tests
    When a debater constructs a propose-break-edge action against the broken edge
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Rejected with reason "illegal-state-transition"
