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

  # Per ADR 0030 §3 + `pf_unit_test_audit`: the legacy `'withdraw'`
  # vote-choice arm is retired. The two scenarios that pinned the
  # methodology engine's rejection of facet-valued withdraw votes
  # (committed proposal + debater with prior agree; committed proposal
  # + late-joiner with no prior agree) were deleted — schema rejection
  # of `'withdraw'` now happens at the wire layer (Zod `z.enum(['agree',
  # 'dispute'])` on inbound validation), pinned in
  # `apps/server/src/events/validate.test.ts` +
  # `packages/shared-types/src/events.test.ts`. The legal withdrawal
  # path moves through the dedicated `withdraw-agreement` event kind,
  # covered by `tests/behavior/methodology/withdraw-agreement.feature`.

  Scenario: an agree on a committed proposal is rejected as proposal-already-committed
    # Same committed state; a debater attempts a fresh agree on the
    # now-committed proposal. The handler's rule 3 rejects: per ADR
    # 0030 §3 no further vote-envelope arms are legal on a committed
    # proposal (the dedicated `withdraw-agreement` event kind owns the
    # post-commit withdrawal gesture).
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
