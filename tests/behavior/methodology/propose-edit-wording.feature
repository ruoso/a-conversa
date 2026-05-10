Feature: methodology engine — propose edit-wording handler against a DB-projected session
  # The Vitest tests at
  # apps/server/src/methodology/handlers/proposeEditWording.test.ts
  # cover the propose-edit-wording handler's rule set in isolation
  # (events constructed as TS literals; both reword and restructure
  # branches, plus the cross-kind conflict-walker and new_node_id
  # collision pins). This feature covers the integration path: the
  # session's events are round-tripped through pglite's `session_events`
  # table (JSONB / TIMESTAMPTZ / BIGINT), replayed through
  # `projectFromLog`, and the resulting projection is the one
  # `validateAction` operates against. Per ADR 0022 the DB-driven layer
  # is committed alongside the unit layer.
  #
  # Refinement: tasks/refinements/data-and-methodology/reword_vs_restructure.md

  Scenario: a participant proposes a reword against a visible node
    # Three participants joined; a node was created and is currently
    # visible. A debater proposes a reword against the node; the handler
    # validates against the DB-projected projection and returns Valid
    # with one proposal event whose payload mirrors the action.
    Given a seeded session with three participants and a visible candidate node for propose-edit-wording tests
    When a debater constructs a propose-reword action against the visible node
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Valid
    And the result carries a single proposal event for the reword action

  Scenario: a participant proposes a restructure against a visible node
    # Three participants joined; a node was created and is currently
    # visible. A debater proposes a restructure with a fresh
    # `new_node_id`; the handler accepts.
    Given a seeded session with three participants and a visible candidate node for propose-edit-wording tests
    When a debater constructs a propose-restructure action against the visible node with a fresh new_node_id
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Valid
    And the result carries a single proposal event for the restructure action

  Scenario: a propose-restructure with a colliding new_node_id is rejected as illegal-state-transition
    # Three participants joined; two nodes have been created. The
    # debater proposes a restructure of the first node but sets
    # `new_node_id` to the second node's id; the handler's rule 4
    # rejects.
    Given a seeded session with three participants and two visible nodes for propose-edit-wording tests
    When a debater constructs a propose-restructure action whose new_node_id collides with an existing node
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Rejected with reason "illegal-state-transition"

  Scenario: a propose-edit-wording against a node with a pending decompose is rejected as illegal-state-transition
    # Three participants joined; a node was created and a decompose
    # proposal is pending against it. The debater attempts an
    # edit-wording (reword) against the same node; the handler's rule
    # 3 (conflict-walker, extended in reword_vs_restructure) rejects.
    Given a seeded session with three participants, a visible node, and a pending decompose against that node for propose-edit-wording tests
    When a debater constructs a propose-reword action against the visible node
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Rejected with reason "illegal-state-transition"
