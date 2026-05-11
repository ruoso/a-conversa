Feature: methodology engine — propose annotate handler against a DB-projected session
  # The Vitest tests at
  # apps/server/src/methodology/handlers/proposeAnnotate.test.ts cover
  # the propose-annotate handler's rule set in isolation (events
  # constructed as TS literals). This feature covers the integration
  # path: the session's events are round-tripped through pglite's
  # `session_events` table (JSONB / TIMESTAMPTZ / BIGINT), replayed
  # through `projectFromLog`, and the resulting projection is the one
  # `validateAction` operates against. Per ADR 0022 the DB-driven layer
  # is committed alongside the unit layer.
  #
  # Refinement: tasks/refinements/data-and-methodology/annotation_logic.md

  Scenario: a participant proposes a note annotation on a visible node
    # Three participants joined; a node was created and is currently
    # visible. A debater proposes a `note` annotation against the
    # node; the handler validates against the DB-projected projection
    # and returns Valid with one proposal event whose payload mirrors
    # the action's annotate payload.
    Given a seeded session with three participants and a visible candidate node for propose-annotate tests
    When a debater constructs a propose-annotate action against the visible node
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Valid
    And the result carries a single proposal event for the annotate action

  Scenario: a participant proposes a reframe annotation on a visible edge
    # Three participants joined; two nodes and a `supports` edge between
    # them were created and are currently visible. A debater proposes a
    # `reframe` annotation against the edge; the handler accepts.
    Given a seeded session with three participants and a visible candidate edge for propose-annotate tests
    When a debater constructs a propose-annotate action against the visible edge
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Valid
    And the result carries a single proposal event for the annotate action targeting the edge

  Scenario: a propose-annotate against an unknown target is rejected as target-entity-not-found
    # Three participants joined; no node matching the proposed
    # target_id has been created in this session. The handler's rule 1
    # rejects with target-entity-not-found.
    Given a seeded session with three participants and no candidate node for propose-annotate tests
    When a debater constructs a propose-annotate action against an unknown node target
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Rejected with reason "target-entity-not-found"
