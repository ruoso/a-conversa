Feature: methodology engine — interpretive-split commit inherits the parent's committed edges
  # ADR 0046: when an interpretive-split commits, each reading node takes
  # an inherited copy of each of the parent's qualifying outgoing edges
  # (included, visible, substance committed), with the edge substance
  # carried by an explicit facet-keyed commit (`carried_from_edge_id`).
  # The Vitest tests at
  # apps/server/src/methodology/handlers/commit.test.ts cover the
  # fan-out predicate in isolation and
  # apps/server/src/projection/replay.test.ts covers the apply side.
  # This feature covers the integration path across the replay/protocol
  # boundary: the emitted cluster is round-tripped through pglite's
  # `session_events` table (JSONB validation of the new
  # `carried_from_edge_id` payload field included), replayed through
  # `projectFromLog`, and the resulting projection is asserted.
  #
  # Refinement: tasks/refinements/data-and-methodology/interpretive_split_edge_inheritance.md

  Scenario: committing an interpretive-split mirrors the parent's committed rebut edge onto both readings
    # Three participants; a parent node carries a committed-substance
    # rebut edge to a target node; a 2-reading interpretive-split is
    # pending with every debater voting agree. The moderator commits:
    # the appended stream gains, per reading, edge-created +
    # entity-included + a carried facet commit — all before the split's
    # own proposal-keyed commit — and the replayed projection shows the
    # parent superseded while both readings carry the inherited rebut
    # with substance committed by carry.
    Given a seeded session with a committed rebut edge and a fully-agreed pending interpretive-split
    When the moderator constructs a commit action against the pending interpretive-split
    And the methodology engine validates the interpretive-split commit against the projected session
    Then the validation result is Valid
    And the result carries the inherited-edge cluster before the proposal-keyed commit
    When the interpretive-split commit events are appended to the session log and the projection is replayed
    Then the replayed projection shows the parent superseded and both readings carrying the inherited committed rebut edge
