Feature: projectFromLog — replay the example-walkthrough fixture end-to-end
  # The walkthrough fixture (packages/test-fixtures/src/fixtures/walkthrough/)
  # encodes the 22-turn debate from docs/example-walkthrough.md as a
  # deterministic event log. This feature loads that fixture through the
  # same loader path the empty fixture uses in from-log.feature, reads the
  # events back out of session_events, runs them through validateEvent +
  # projectFromLog, and asserts the projection's final state matches the
  # walkthrough's coda checklist.
  #
  # Per the walkthrough_replay_e2e refinement (D1) this is the canonical
  # end-to-end integration cover for the projection: the per-event-kind
  # Vitest tests at apps/server/src/projection/replay.test.ts cover the
  # dispatcher logic; the per-mechanic from-log.feature scenarios cover
  # one operation each; THIS feature covers the integration of all of
  # them together at scale.
  #
  # The fixture's identifier mapping (walkthrough N1-N19, E1-E15, A1-A3
  # to stable UUIDs) lives in the meta.json header of the fixture
  # directory; the step file at tests/behavior/steps/projection-
  # walkthrough-replay.steps.ts pins the same constants in code.

  Scenario: full walkthrough projects to the canonical final state
    # The load-bearing scenario. Loads the walkthrough fixture, projects
    # from the database event log, walks the coda checklist as a flat
    # sequence of facet-status assertions covering every committed node,
    # committed edge, disputed-or-live entity, and the projection's
    # entity counts.
    When I load the walkthrough fixture and project it
    Then the walkthrough projection's sessionState is "open"
    And the walkthrough projection has at least 19 nodes
    And the walkthrough projection has 17 edges
    And the walkthrough projection has 3 annotations
    And the walkthrough projection has 3 current participants
    # Committed nodes — classification facet status.
    And walkthrough node N1 classification facet is "committed"
    And walkthrough node N2 classification facet is "committed"
    And walkthrough node N3 classification facet is "committed"
    And walkthrough node N4 classification facet is "committed"
    And walkthrough node N5 classification facet is "committed"
    And walkthrough node N6 classification facet is "committed"
    And walkthrough node N7 classification facet is "committed"
    And walkthrough node N8 classification facet is "committed"
    And walkthrough node N9 classification facet is "committed"
    And walkthrough node N10 classification facet is "committed"
    And walkthrough node N11 classification facet is "committed"
    And walkthrough node N12 classification facet is "committed"
    And walkthrough node N13 classification facet is "committed"
    And walkthrough node N16 classification facet is "committed"
    And walkthrough node N18 classification facet is "committed"
    And walkthrough node N19 classification facet is "committed"
    # Decompose parents are invisible after their commits land.
    And walkthrough node N_OPENER_A is in the projection but not visible
    And walkthrough node N_LEG_B is in the projection but not visible
    # Interpretive-split parent N14 is invisible after the turn-17 split.
    And walkthrough node N14 is in the projection but not visible
    # Committed edges — substance facet status.
    And walkthrough edge E1 substance facet is "committed"
    And walkthrough edge E2 substance facet is "committed"
    And walkthrough edge E3 substance facet is "committed"
    And walkthrough edge E4 substance facet is "committed"
    And walkthrough edge E5 substance facet is "committed"
    And walkthrough edge E6 substance facet is "committed"
    And walkthrough edge E7 substance facet is "committed"
    And walkthrough edge E8 substance facet is "committed"
    And walkthrough edge E9 substance facet is "committed"
    And walkthrough edge E10 substance facet is "committed"
    And walkthrough edge E11a substance facet is "committed"
    And walkthrough edge E11b substance facet is "committed"
    And walkthrough edge E12 substance facet is "committed"
    And walkthrough edge E13 substance facet is "committed"
    And walkthrough edge E14 substance facet is "committed"
    # E15 stays non-committed (per the walkthrough's "live disagreement"
    # framing at turn 22) — substance facet was never proposed-and-
    # committed.
    And walkthrough edge E15 substance facet is not "committed"
    # Disputed-or-live entities — non-committed facet statuses per the
    # walkthrough's coda.
    And walkthrough node N17 substance facet is not "committed"
    # Annotations — A1 + A3 commit; A2 stays in flight per Ben's dispute.
    And walkthrough annotation A1 is present in the projection
    And walkthrough annotation A2 is present in the projection
    And walkthrough annotation A3 is present in the projection
    # Pending proposals — the A2 annotate proposal sits unresolved at
    # segment-1 close (Ben's dispute vote landed without a commit).
    And the walkthrough projection has at least 1 pending proposal

  Scenario: per-participant axiom-marks on N12 are independent
    # Carved out per the walkthrough_replay_e2e refinement D5: the per-
    # participant axiom-mark surface is the walkthrough's most distinctive
    # mechanic (turn 14 = Ben's mark; turn 16 = Anna's mark; same node,
    # two independent marks).
    When I load the walkthrough fixture and project it
    Then walkthrough node N12 carries an axiom-mark for Anna
    And walkthrough node N12 carries an axiom-mark for Ben
    And walkthrough node N12 carries exactly 2 axiom-marks

  Scenario: defeater pre-commit leaves the rebut edge non-firing
    # Scenario 3 per the refinement, encoded faithful to the walkthrough's
    # narrative (turn 11): E5's substance is committed (Ben pre-committed
    # agreed); N8's substance stays proposed. Per active_firing_computation
    # the rebut does NOT fire because both endpoint substances must be
    # committed; the walkthrough's coda specifically demonstrates this
    # deferred-activation pattern. E11b is the parallel case at turn 17 —
    # substance pre-committed, N17 substance stays proposed.
    When I load the walkthrough fixture and project it
    Then walkthrough edge E5 substance facet is "committed"
    And walkthrough node N6 substance facet is "committed"
    And walkthrough node N8 substance facet is not "committed"
    And walkthrough edge E5 is not active
    And walkthrough edge E11b substance facet is "committed"
    And walkthrough node N17 substance facet is not "committed"
    And walkthrough edge E11b is not active

  Scenario: disputed entities at segment-1 close stay non-committed
    # Scenario 4 per the refinement — the entities the walkthrough's coda
    # marks as "live / disputed" carry non-committed facet statuses.
    When I load the walkthrough fixture and project it
    Then walkthrough node N17 substance facet is not "committed"
    And walkthrough edge E15 substance facet is not "committed"
    And walkthrough annotation A2 substance facet is not "committed"

  Scenario: snapshot-created at "Segment 1 close" lands on the projection
    # Scenario 5 per the refinement.
    When I load the walkthrough fixture and project it
    Then the walkthrough projection contains a snapshot labeled "Segment 1 close"
