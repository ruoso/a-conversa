Feature: methodology engine — mark-meta-disagreement handler against a DB-projected session
  # The Vitest tests at
  # apps/server/src/methodology/handlers/markMetaDisagreement.test.ts
  # cover the mark-meta-disagreement handler's rule set in isolation
  # (events constructed as TS literals). This feature covers the
  # integration path: the session's events are round-tripped through
  # pglite's `session_events` table (JSONB / TIMESTAMPTZ / BIGINT),
  # replayed through `projectFromLog`, and the resulting projection is
  # the one `validateAction` operates against. Per ADR 0022 the DB-
  # driven layer is committed alongside the unit layer.
  #
  # Refinement: tasks/refinements/data-and-methodology/meta_disagreement_logic.md

  Scenario: moderator marks meta-disagreement on a disputed proposal
    # Three participants joined; node-created; classify-node proposal
    # pending; one debater voted dispute (event in session_events). The
    # moderator constructs a mark action; the handler validates against
    # the DB-projected projection and returns Valid with one
    # meta-disagreement-marked event whose payload mirrors the action's
    # mark envelope.
    Given a seeded session with three participants, a pending proposal, and one dispute vote for meta-disagreement-logic tests
    When the moderator constructs a mark-meta-disagreement action against the pending proposal
    And the methodology engine validates the mark-meta-disagreement action against the projected session
    Then the validation result is Valid
    And the result carries a single meta-disagreement-marked event for the pending proposal

  Scenario: a debater's mark attempt is rejected as not-a-moderator
    # Same seeded state (one dispute vote); a debater requests the mark
    # instead of the moderator. The handler's rule 1 rejects before
    # evaluating the exhaustion gate.
    Given a seeded session with three participants, a pending proposal, and one dispute vote for meta-disagreement-logic tests
    When a debater constructs a mark-meta-disagreement action against the pending proposal
    And the methodology engine validates the mark-meta-disagreement action against the projected session
    Then the validation result is Rejected with reason "not-a-moderator"

  Scenario: a mark on an already-committed proposal is rejected as proposal-already-committed
    # Three participants joined; classify-node proposal pending; all
    # three voted agree; moderator committed. The moderator then tries
    # to mark the now-committed proposal as meta-disagreement. The
    # handler's rule 3 rejects: a committed proposal can no longer be
    # meta-disagreed.
    Given a seeded session committed on a classify-node proposal for meta-disagreement-logic tests
    When the moderator constructs a mark-meta-disagreement action against the committed proposal
    And the methodology engine validates the mark-meta-disagreement action against the projected session
    Then the validation result is Rejected with reason "proposal-already-committed"
