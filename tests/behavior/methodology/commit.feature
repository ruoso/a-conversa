Feature: methodology engine — commit handler against a DB-projected session
  # The Vitest tests at
  # apps/server/src/methodology/handlers/commit.test.ts cover the
  # commit handler's rule set in isolation (events constructed as TS
  # literals). This feature covers the integration path: the session's
  # events are round-tripped through pglite's `session_events` table
  # (JSONB / TIMESTAMPTZ / BIGINT), replayed through `projectFromLog`,
  # and the resulting projection is the one `validateAction` operates
  # against. Per ADR 0022 the DB-driven layer is committed alongside
  # the unit layer.
  #
  # Refinement: tasks/refinements/data-and-methodology/commit_logic.md

  Scenario: moderator commits a unanimously-agreed proposal
    # Three participants joined; node-created; classify-node proposal
    # pending; all three voted agree (events in session_events). The
    # moderator constructs a commit action; the handler validates
    # against the DB-projected projection and returns Valid with one
    # commit event whose payload mirrors the action's commit envelope.
    Given a seeded session with three participants, a pending proposal, and three agree votes for commit-logic tests
    When the moderator constructs a commit action against the pending proposal
    And the methodology engine validates the commit action against the projected session
    Then the validation result is Valid
    And the result carries a single commit event for the pending proposal

  Scenario: a debater's commit attempt is rejected as not-a-moderator
    # Same seeded state (three agree votes); a debater requests the
    # commit instead of the moderator. The handler's rule 1 rejects
    # before evaluating the unanimity rule.
    Given a seeded session with three participants, a pending proposal, and three agree votes for commit-logic tests
    When a debater constructs a commit action against the pending proposal
    And the methodology engine validates the commit action against the projected session
    Then the validation result is Rejected with reason "not-a-moderator"

  Scenario: a commit before everyone has voted is rejected as unanimous-agree-required
    # Three participants joined; node-created; classify-node proposal
    # pending; only two of the three have voted agree. The moderator
    # requests the commit; the handler rejects with the unanimity
    # rejection.
    Given a seeded session with three participants, a pending proposal, and two agree votes for commit-logic tests
    When the moderator constructs a commit action against the pending proposal
    And the methodology engine validates the commit action against the projected session
    Then the validation result is Rejected with reason "unanimous-agree-required"
