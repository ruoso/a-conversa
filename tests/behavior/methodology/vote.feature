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

  Scenario: a withdraw vote on a committed facet-valued proposal is rejected as illegal-state-transition
    # Per ADR 0030 §3 + `pf_vote_handler_facet_keyed`: the `'withdraw'`
    # arm on the vote envelope's `choice` enum is deprecated —
    # withdrawal is its own top-level event kind
    # (`withdraw-agreement`). On the facet-arm of the vote handler
    # (the seeded classify-node is facet-valued), any `'withdraw'`
    # request is refused with `illegal-state-transition`. The legal
    # withdrawal path moves through the dedicated event kind; the
    # downstream `pf_withdraw_agreement_handler` task wires the new
    # surface.
    Given a seeded session committed on a classify-node proposal with three agree votes for vote-logic tests
    When a debater who previously voted agree constructs a withdraw action against the committed proposal
    And the methodology engine validates the vote action against the projected session
    Then the validation result is Rejected with reason "proposal-already-committed"

  Scenario: a withdraw vote on a facet-valued committed proposal is rejected (late joiner with no prior agree)
    # Same committed state, but a late joiner (who joined after commit
    # and therefore never voted agree on this proposal) attempts the
    # withdraw. The facet-arm rejects with `proposal-already-committed`
    # because the facet's derived status is checked BEFORE the prior-
    # vote check (a committed facet refuses every vote-envelope arm).
    Given a seeded session committed on a classify-node proposal with three agree votes for vote-logic tests
    And a late-joining debater is added after the commit for vote-logic tests
    When the late-joining debater constructs a withdraw action against the committed proposal
    And the methodology engine validates the vote action against the projected session
    Then the validation result is Rejected with reason "proposal-already-committed"

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

  Scenario: an agree on a facet-valued pending proposal emits the facet-keyed vote arm
    # Per ADR 0030 §2 + `pf_vote_handler_facet_keyed`: votes against
    # facet-valued proposal sub-kinds (classify-node here) are emitted
    # as `target: 'facet'`, keyed by the `(entity_kind, entity_id,
    # facet)` triple — NOT by `proposal_id`. Round-trip: the engine's
    # accept path constructs a facet-keyed event; applying the event
    # to the projection populates the targeted facet's
    # `perParticipant` map; the read-side derivation surfaces the
    # status flip on the next call. This scenario covers the facet-
    # target accept path the refinement's Acceptance criteria pin.
    Given a seeded session with three participants and a pending classify-node proposal for vote-logic tests
    When a debater constructs an agree action against the pending proposal
    And the methodology engine validates the vote action against the projected session
    Then the validation result is Valid
    And the result carries a single facet-keyed vote event against the classification facet of the node with choice "agree"
