Feature: methodology engine — propose interpretive-split handler against a DB-projected session
  # The Vitest tests at
  # apps/server/src/methodology/handlers/proposeInterpretiveSplit.test.ts
  # cover the propose-interpretive-split handler's rule set in isolation
  # (events constructed as TS literals). This feature covers the
  # integration path: the session's events are round-tripped through
  # pglite's `session_events` table (JSONB / TIMESTAMPTZ / BIGINT),
  # replayed through `projectFromLog`, and the resulting projection is
  # the one `validateAction` operates against. Per ADR 0022 the DB-driven
  # layer is committed alongside the unit layer.
  #
  # Refinement: tasks/refinements/data-and-methodology/interpretive_split_logic.md

  Scenario: a participant proposes an interpretive-split against a visible parent node
    # Three participants joined; a node was created and the parent is
    # currently visible. A debater constructs a propose-interpretive-split
    # action; the handler validates against the DB-projected projection
    # and returns Valid with the per-reading structural fan-out
    # (`node-created` + `entity-included` per reading, in array order)
    # followed by the `proposal` envelope — 2N+1 events for N readings
    # per ADR 0027 (entity vs facet layer separation).
    Given a seeded session with three participants and a visible candidate-parent node for propose-interpretive-split tests
    When a debater constructs a propose-interpretive-split action against the visible parent
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Valid
    And the result carries the interpretive-split structural fan-out and proposal envelope

  Scenario: a propose-interpretive-split against an already-decomposed parent is rejected as illegal-state-transition
    # Three participants joined; a node was created and a prior decompose
    # against it has already committed (parent.visible flipped to false
    # on the read-side projection). A debater attempts to interpretively-
    # split the now-invisible parent; the handler's rule 2 rejects.
    Given a seeded session with three participants and a previously-decomposed parent node for propose-interpretive-split tests
    When a debater constructs a propose-interpretive-split action against the previously-decomposed parent
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Rejected with reason "illegal-state-transition"

  Scenario: a propose-interpretive-split is rejected when a decompose against the same parent is pending (mutual exclusion)
    # Three participants joined; a node was created and is visible; a
    # prior decompose proposal against it landed but stays pending (no
    # commit). The two structural sub-kinds are mutually exclusive
    # against the same parent because both flip parent.visible=false on
    # commit; the handler's rule 3 rejects the interpretive-split with
    # illegal-state-transition.
    Given a seeded session with three participants and a pending-decompose against the candidate-parent node for propose-interpretive-split tests
    When a debater constructs a propose-interpretive-split action against the parent with a pending decompose
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Rejected with reason "illegal-state-transition"
