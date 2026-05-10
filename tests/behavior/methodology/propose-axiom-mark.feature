Feature: methodology engine — propose axiom-mark handler against a DB-projected session
  # The Vitest tests at
  # apps/server/src/methodology/handlers/proposeAxiomMark.test.ts cover
  # the propose-axiom-mark handler's rule set in isolation (events
  # constructed as TS literals). This feature covers the integration
  # path: the session's events are round-tripped through pglite's
  # `session_events` table (JSONB / TIMESTAMPTZ / BIGINT), replayed
  # through `projectFromLog`, and the resulting projection is the one
  # `validateAction` operates against. Per ADR 0022 the DB-driven layer
  # is committed alongside the unit layer.
  #
  # Refinement: tasks/refinements/data-and-methodology/axiom_mark_logic.md

  Scenario: a participant proposes their own axiom-mark on a visible node
    # Three participants joined; a node was created and is currently
    # visible. A debater proposes their OWN axiom-mark (participant ==
    # requester); the handler validates against the DB-projected
    # projection and returns Valid with one proposal event whose payload
    # mirrors the action's axiom-mark payload.
    Given a seeded session with three participants and a visible candidate node for propose-axiom-mark tests
    When a debater constructs a propose-axiom-mark action on their own behalf against the visible node
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Valid
    And the result carries a single proposal event for the axiom-mark action

  Scenario: a propose-axiom-mark with cross-participant marking is rejected as axiom-mark-not-self
    # Three participants joined; a node was created and is visible.
    # Debater A constructs a propose-axiom-mark whose `participant`
    # field is debater B (attempting to declare B's bedrock on B's
    # behalf). The handler's rule 3 rejects with axiom-mark-not-self —
    # axiom-marks are personal; only the bedrock-holder may declare it.
    Given a seeded session with three participants and a visible candidate node for propose-axiom-mark tests
    When debater A constructs a propose-axiom-mark action targeting debater B's participation
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Rejected with reason "axiom-mark-not-self"

  Scenario: a propose-axiom-mark against an already-decomposed node is rejected as illegal-state-transition
    # Three participants joined; a node was created and visible, then a
    # prior decompose against it committed (node.visible flipped to
    # false on the read-side projection). A debater attempts to axiom-
    # mark the now-invisible node; the handler's rule 2 rejects.
    Given a seeded session with three participants and a previously-decomposed candidate node for propose-axiom-mark tests
    When a debater constructs a propose-axiom-mark action on their own behalf against the previously-decomposed node
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Rejected with reason "illegal-state-transition"
