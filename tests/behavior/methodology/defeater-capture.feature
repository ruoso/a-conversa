Feature: defeater capture — the rebut sits in the graph and fires only when its source becomes substantively established
  # Per the refinement (Option B): defeater capture is a UI-level macro
  # built on existing primitives. The methodology engine has no
  # defeater-specific handler. The three event-stream operations of the
  # F6 flow (node-created for Y, edge-created for the rebut Y -> X,
  # propose set-edge-substance against the rebut with value 'agreed')
  # all use existing paths. The "pre-committed substance" goes through
  # the normal propose-vote-commit lifecycle per docs/moderator-ui.md
  # F6 step 6.
  #
  # The Vitest tests at
  # apps/server/src/methodology/handlers/proposeDefeaterPreCommit.test.ts
  # cover the propose-handler's set-edge-substance arm in isolation
  # (events constructed as TS literals). This feature covers the
  # integration path: the session's events are round-tripped through
  # pglite's `session_events` table, replayed through `projectFromLog`,
  # and the resulting projection is the one the edge-firing predicate
  # operates against. Per ADR 0022 the DB-driven layer is committed
  # alongside the unit layer.
  #
  # The load-bearing claim from docs/data-model.md line 102 is the
  # subject of these scenarios: "the rebut sits in the graph but does
  # not currently fire... if the source ever becomes substantively
  # established, the rebut activates."
  #
  # Refinement: tasks/refinements/data-and-methodology/defeater_capture_logic.md

  Scenario: the defeater does not fire while the source-node substance is unagreed
    # Three participants joined; the defeated target X is created and
    # set-substance-agreed; the defeater node Y is created (substance
    # stays proposed); the rebut edge Y -> X is created and included.
    # Then a propose set-edge-substance against the rebut with
    # value 'agreed' is voted-agree by all and committed by the
    # moderator (the F6 step-4 pre-commitment). At this end state the
    # rebut edge's substance is agreed BUT Y's substance is still
    # proposed; the edge-firing predicate computes false.
    Given a seeded session with three participants for defeater-capture tests
    And the target X and defeater Y nodes plus the rebut edge for defeater-capture tests
    And entity-included events for the target X, defeater Y, and the rebut edge for defeater-capture tests
    And the target X substance is committed-agreed for defeater-capture tests
    And the rebut edge's substance is committed-agreed via propose-set-edge-substance for defeater-capture tests
    When I project the defeater-capture event log via projectFromLog
    Then the rebut edge's substance facet is agreed for defeater-capture tests
    And the defeater node Y's substance facet is proposed for defeater-capture tests
    And isEdgeActive on the rebut edge is false for defeater-capture tests

  Scenario: the defeater fires when the source substance is later committed-agreed
    # Continuing from the prior scenario's end state, a separate
    # propose-set-node-substance against Y with value 'agreed' is
    # voted-agree by all and committed. Y's substance is now agreed;
    # the rebut edge's substance was already agreed (the
    # pre-commitment); the edge-firing predicate now computes true.
    # The defeater "activates" per docs/data-model.md line 102.
    Given a seeded session with three participants for defeater-capture tests
    And the target X and defeater Y nodes plus the rebut edge for defeater-capture tests
    And entity-included events for the target X, defeater Y, and the rebut edge for defeater-capture tests
    And the target X substance is committed-agreed for defeater-capture tests
    And the rebut edge's substance is committed-agreed via propose-set-edge-substance for defeater-capture tests
    And the defeater Y substance is later committed-agreed via propose-set-node-substance for defeater-capture tests
    When I project the defeater-capture event log via projectFromLog
    Then the rebut edge's substance facet is agreed for defeater-capture tests
    And the defeater node Y's substance facet is agreed for defeater-capture tests
    And isEdgeActive on the rebut edge is true for defeater-capture tests
