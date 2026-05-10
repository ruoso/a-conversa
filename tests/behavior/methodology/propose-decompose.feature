Feature: methodology engine — propose decompose handler against a DB-projected session
  # The Vitest tests at
  # apps/server/src/methodology/handlers/proposeDecompose.test.ts cover
  # the propose-decompose handler's rule set in isolation (events
  # constructed as TS literals). This feature covers the integration
  # path: the session's events are round-tripped through pglite's
  # `session_events` table (JSONB / TIMESTAMPTZ / BIGINT), replayed
  # through `projectFromLog`, and the resulting projection is the one
  # `validateAction` operates against. Per ADR 0022 the DB-driven layer
  # is committed alongside the unit layer.
  #
  # Refinement: tasks/refinements/data-and-methodology/decomposition_logic.md

  Scenario: a participant proposes a decompose against a visible parent node
    # Three participants joined; a node was created and the parent is
    # currently visible. A debater constructs a propose-decompose action;
    # the handler validates against the DB-projected projection and
    # returns Valid with one proposal event whose payload mirrors the
    # action's decompose payload.
    Given a seeded session with three participants and a visible candidate-parent node for propose-decompose tests
    When a debater constructs a propose-decompose action against the visible parent
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Valid
    And the result carries a single proposal event for the decompose action

  Scenario: a propose-decompose against an unknown node is rejected as target-entity-not-found
    # Three participants joined; no node matching the proposed
    # parent_node_id has been created in this session. The handler's
    # rule 1 rejects.
    Given a seeded session with three participants and no candidate-parent node for propose-decompose tests
    When a debater constructs a propose-decompose action against an unknown parent
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Rejected with reason "target-entity-not-found"

  Scenario: a propose-decompose against an already-decomposed parent is rejected as illegal-state-transition
    # Three participants joined; a node was created and a prior decompose
    # against it has already committed (parent.visible flipped to false
    # on the read-side projection). A debater attempts to re-decompose
    # the now-invisible parent; the handler's rule 2 rejects.
    Given a seeded session with three participants and a previously-decomposed parent node for propose-decompose tests
    When a debater constructs a propose-decompose action against the previously-decomposed parent
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Rejected with reason "illegal-state-transition"
