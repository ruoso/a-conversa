Feature: methodology engine — validateAction universal checks on a DB-projected session
  # The Vitest tests at apps/server/src/methodology/engine.test.ts cover
  # the universal checks and the per-action placeholder handlers in
  # isolation (events constructed as TS literals). This feature covers
  # the integration path: the session's events are round-tripped through
  # pglite's `session_events` table (JSONB / TIMESTAMPTZ / BIGINT),
  # replayed through `projectFromLog`, and the resulting projection is
  # the one `validateAction` operates against.
  #
  # Refinement: tasks/refinements/data-and-methodology/agreement_state_machine.md

  Scenario: a participant's vote-agree action passes the engine's universal checks
    # Three participants joined; one node created; one classify-node
    # proposal pending. The participant constructs a `vote agree`
    # action; `validateAction` runs universal checks (session match,
    # sequence match, participant gate) and the placeholder vote
    # handler returns a single EventToAppend carrying a vote payload.
    Given a seeded session with three participants and a pending proposal for methodology-engine tests
    When the participant constructs a vote-agree action against the pending proposal
    And the methodology engine validates the action against the projected session
    Then the validation result is Valid
    And the result carries a single vote event for the pending proposal
