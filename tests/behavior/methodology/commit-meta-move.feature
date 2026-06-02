Feature: methodology engine — commit meta-move emits annotation-created against a DB-projected session
  # The Vitest tests at
  # apps/server/src/methodology/handlers/commit.test.ts cover the
  # commit handler's meta-move event-shaping in isolation (events
  # constructed as TS literals). This feature covers the integration /
  # protocol seam: the session's events are round-tripped through
  # pglite's `session_events` table (JSONB / TIMESTAMPTZ / BIGINT),
  # replayed through `projectFromLog`, and the resulting projection is
  # the one `validateAction` operates against. A committed meta-move
  # appends an `annotation-created` event to the log ahead of the
  # `commit`; replaying that log surfaces a visible annotation on the
  # meta-move's target node or edge. Per ADR 0022 the DB-driven layer
  # is committed alongside the unit layer.
  #
  # Refinement: tasks/refinements/data-and-methodology/meta_move_commit_logic.md

  Scenario: committing a unanimously-agreed reframe meta-move on a node surfaces a reframe annotation
    # Three participants joined; a node was created and is visible; a
    # debater proposed a `reframe` meta-move against it and everyone
    # voted agree. The moderator commits: the engine returns Valid with
    # an `annotation-created` (kind reframe, target = the node) ahead of
    # the `commit`. Appending and replaying the log surfaces the
    # annotation on the target node.
    Given a seeded session with three participants, a visible node, a pending reframe meta-move proposal, and three agree votes for commit-meta-move tests
    When the moderator constructs a commit action against the meta-move proposal
    And the methodology engine validates the commit action against the projected session
    Then the validation result is Valid
    And the result carries an annotation-created event of kind "reframe" on the node ahead of the commit event
    When the resulting meta-move events are appended to the session log and the projection is replayed
    Then the projection surfaces a "reframe" annotation on the node target

  Scenario: committing a unanimously-agreed scope-change meta-move on an edge surfaces a scope-change annotation
    # The edge variant pins the `target_edge_id` branch at the replay
    # seam: a `scope-change` meta-move against a visible `supports` edge
    # commits and surfaces an annotation indexed against the edge.
    Given a seeded session with three participants, a visible edge, a pending scope-change meta-move proposal, and three agree votes for commit-meta-move tests
    When the moderator constructs a commit action against the meta-move proposal
    And the methodology engine validates the commit action against the projected session
    Then the validation result is Valid
    And the result carries an annotation-created event of kind "scope-change" on the edge ahead of the commit event
    When the resulting meta-move events are appended to the session log and the projection is replayed
    Then the projection surfaces a "scope-change" annotation on the edge target
