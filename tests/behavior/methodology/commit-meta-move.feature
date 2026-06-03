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

  Scenario: a committed reframe meta-move's annotation carries a committed substance facet at the projection seam
    # The per-annotation facet status (`annotation_facet_status_logic`):
    # the shell's `computeFacetStatuses` routes the meta-move's
    # per-participant agree votes onto the resulting annotation's
    # `substance` facet, correlated to the annotation by the
    # [annotation-created, commit] commit-batch adjacency. Because commit
    # is gated on unanimous agreement, the reachable derived status is
    # `committed`. (The `disputed` state is not producible end-to-end
    # today — deferred to `annotation_facet_vote_seam`.)
    Given a seeded session with three participants, a visible node, a pending reframe meta-move proposal, and three agree votes for commit-meta-move tests
    When the moderator constructs a commit action against the meta-move proposal
    And the methodology engine validates the commit action against the projected session
    Then the validation result is Valid
    And the result carries an annotation-created event of kind "reframe" on the node ahead of the commit event
    When the resulting meta-move events are appended to the session log and the projection is replayed
    Then the resulting annotation's substance facet rolls up to "committed" after replay

  Scenario: a participant disputing a committed reframe annotation's substance rolls it up to disputed
    # ADR 0038 (annotation_facet_vote_seam): a committed annotation's
    # `substance` facet is disputable post-commit via a facet-keyed
    # `entity_kind: 'annotation'` vote. This closes the seam the prior
    # scenario flagged as deferred — exercising the full protocol + replay
    # path: the engine vote handler accepts the dispute against the
    # committed annotation (the committed-facet gate diverges for
    # annotations, ADR 0038 §3), the event round-trips through pglite, and
    # `computeFacetStatuses` rolls the substance facet up to `disputed`
    # (Rule 5, which outranks `committed`).
    Given a seeded session with three participants, a visible node, a pending reframe meta-move proposal, and three agree votes for commit-meta-move tests
    When the moderator constructs a commit action against the meta-move proposal
    And the methodology engine validates the commit action against the projected session
    Then the validation result is Valid
    And the result carries an annotation-created event of kind "reframe" on the node ahead of the commit event
    When the resulting meta-move events are appended to the session log and the projection is replayed
    Then the resulting annotation's substance facet rolls up to "committed" after replay
    When a participant casts a facet-keyed dispute vote on the resulting annotation's substance and it is appended and replayed
    Then the resulting annotation's substance facet rolls up to "disputed" after replay
