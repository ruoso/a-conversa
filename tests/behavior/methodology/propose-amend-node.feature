Feature: methodology engine — propose amend-node handler against a DB-projected session
  # The Vitest tests at
  # apps/server/src/methodology/handlers/proposeAmendNode.test.ts cover
  # the propose-amend-node handler's rule set in isolation (events
  # constructed as TS literals; rules 1-4 plus the conflict-walker
  # cross-kind matrix). This feature covers the integration path: the
  # session's events are round-tripped through pglite's `session_events`
  # table (JSONB / TIMESTAMPTZ / BIGINT), replayed through
  # `projectFromLog`, and the resulting projection is the one
  # `validateAction` operates against. Per ADR 0022 the DB-driven layer
  # is committed alongside the unit layer.
  #
  # Refinement: tasks/refinements/data-and-methodology/amend_node_logic.md

  Scenario: a participant proposes amending a node that is party to an agreed contradicts edge
    # Three participants joined; two nodes (A and B) created and a
    # `contradicts` edge from A to B with its substance facet
    # committed to `agreed`. A debater proposes amending node A to
    # remove the conflict; the handler validates against the
    # DB-projected projection and returns Valid with one proposal event
    # whose payload mirrors the action.
    Given a seeded session with three participants and a node party to an agreed contradicts edge for propose-amend-node tests
    When a debater constructs a propose-amend-node action against the contradicting node
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Valid
    And the result carries a single proposal event for the amend-node action

  Scenario: a propose-amend-node against an unknown node is rejected as target-entity-not-found
    # Three participants joined; no node matching the proposed node_id
    # has been created in this session. The handler's rule 1 rejects
    # with target-entity-not-found.
    Given a seeded session with three participants and no candidate node for propose-amend-node tests
    When a debater constructs a propose-amend-node action against an unknown node
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Rejected with reason "target-entity-not-found"

  Scenario: a propose-amend-node against a node with a pending decompose is rejected as illegal-state-transition
    # Three participants joined; the candidate node is party to an
    # agreed contradicts edge AND has a pending decompose against it.
    # The debater attempts an amend-node; the handler's rule 3
    # (conflict-walker) rejects.
    Given a seeded session with three participants, a node party to an agreed contradicts edge, and a pending decompose against that node for propose-amend-node tests
    When a debater constructs a propose-amend-node action against the contradicting node
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Rejected with reason "illegal-state-transition"

  Scenario: a propose-amend-node against a node with no contradicts edge is rejected as methodology-not-exhausted
    # Three participants joined; the candidate node exists and is
    # visible but has NO contradicts edge against it. Per the strict
    # rule 4 (amend-node is the contradiction-resolution path; if
    # there's no contradiction to resolve, edit-wording(reword) is the
    # right tool), the handler rejects with methodology-not-exhausted.
    Given a seeded session with three participants and a visible node with no contradicts edge for propose-amend-node tests
    When a debater constructs a propose-amend-node action against the contradicting node
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Rejected with reason "methodology-not-exhausted"
