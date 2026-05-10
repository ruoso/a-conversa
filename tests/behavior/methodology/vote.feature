Feature: methodology engine — vote handler against a DB-projected session
  # The Vitest tests at
  # apps/server/src/methodology/handlers/vote.test.ts cover the vote
  # handler's rule set in isolation (events constructed as TS literals).
  # This feature covers the integration path: the session's events are
  # round-tripped through pglite's `session_events` table (JSONB /
  # TIMESTAMPTZ / BIGINT), replayed through `projectFromLog`, and the
  # resulting projection is the one `validateAction` operates against.
  # Per ADR 0022 the DB-driven layer is committed alongside the unit
  # layer.
  #
  # The load-bearing case is withdrawal post-commit; the supporting
  # scenarios exercise the three reject branches the handler must
  # surface (no-prior-agree, proposal-already-committed,
  # not-a-participant).
  #
  # Refinement: tasks/refinements/data-and-methodology/withdrawal_logic.md

  Scenario: a participant withdraws their prior agree on a committed proposal
    # Three participants joined; classify-node proposal pending; all
    # three voted agree; moderator commits. A debater then constructs a
    # withdraw vote against the committed proposal; the handler
    # validates against the DB-projected projection and returns Valid
    # with one vote event. After applying the resulting vote event to
    # the projection, the read-side `deriveFacetStatus` returns
    # `withdrawn` (rule 3 of facet-status.ts).
    Given a seeded session committed on a classify-node proposal with three agree votes for vote-logic tests
    When a debater who previously voted agree constructs a withdraw action against the committed proposal
    And the methodology engine validates the vote action against the projected session
    Then the validation result is Valid
    And the result carries a single vote event with vote value "withdraw"
    And applying the resulting withdraw event to the projection makes the classification facet read "withdrawn"

  Scenario: a withdraw without a prior agree is rejected as no-prior-agree
    # Same committed state, but a late joiner (who joined after commit
    # and therefore never voted agree on this proposal) attempts the
    # withdraw. The handler's rule 4 rejects with `no-prior-agree`.
    Given a seeded session committed on a classify-node proposal with three agree votes for vote-logic tests
    And a late-joining debater is added after the commit for vote-logic tests
    When the late-joining debater constructs a withdraw action against the committed proposal
    And the methodology engine validates the vote action against the projected session
    Then the validation result is Rejected with reason "no-prior-agree"

  Scenario: an agree on a committed proposal is rejected as proposal-already-committed
    # Same committed state; a debater attempts a fresh agree on the
    # now-committed proposal. The handler's rule 3 rejects: only
    # withdraw is legal on a committed proposal.
    Given a seeded session committed on a classify-node proposal with three agree votes for vote-logic tests
    When a debater constructs an agree action against the committed proposal
    And the methodology engine validates the vote action against the projected session
    Then the validation result is Rejected with reason "proposal-already-committed"

  Scenario: a vote from a non-participant is rejected by the universal participant gate
    # Same seeded state (pending proposal, no commit yet — the universal
    # gate fires regardless of proposal state). An outsider (not joined
    # to the session) constructs an agree vote; the engine's universal
    # check rejects with `not-a-participant`.
    Given a seeded session with three participants and a pending classify-node proposal for vote-logic tests
    When an outsider constructs an agree action against the pending proposal
    And the methodology engine validates the vote action against the projected session
    Then the validation result is Rejected with reason "not-a-participant"
