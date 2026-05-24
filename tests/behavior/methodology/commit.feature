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

  Scenario: the engine's facet-keyed commit event lands on the projection and flips the facet status to committed
    # Per ADR 0030 §2 + `pf_commit_handler_facet_keyed`: for the four
    # facet-valued sub-kinds (classify-node here as canonical) the
    # engine emits a `target: 'facet'` commit. The wire layer appends it
    # to the session log; the projection's `handleCommit` facet arm
    # stamps the facet `'committed'`. This scenario walks the full
    # engine → DB → projection → derivation round-trip and asserts the
    # status flip on the targeted facet.
    Given a seeded session with three participants, a pending proposal, and three agree votes for commit-logic tests
    When the moderator constructs a commit action against the pending proposal
    And the methodology engine validates the commit action against the projected session
    And the resulting commit event is appended to the session log and the projection is replayed
    Then the validation result is Valid
    And the targeted classification facet's derived status is "committed"
