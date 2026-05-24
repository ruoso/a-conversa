Feature: methodology engine — propose capture-node handler against a DB-projected session
  # The Vitest tests at
  # apps/server/src/methodology/handlers/proposeCaptureNode.test.ts cover
  # the propose-capture-node handler's rule set in isolation (events
  # constructed as TS literals). This feature covers the integration
  # path: the session's events are round-tripped through pglite's
  # `session_events` table (JSONB / TIMESTAMPTZ / BIGINT), replayed
  # through `projectFromLog`, and the resulting projection is the one
  # `validateAction` operates against. Per ADR 0022 the DB-driven layer
  # is committed alongside the unit layer.
  #
  # Refinement: tasks/refinements/per-facet-refactor/pf_capture_emits_inline_wording_only.md
  # ADR:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§1, §4, §5)
  # ADR:        docs/adr/0027-entity-and-facet-layers-strict-separation.md

  Scenario: moderator captures a wording-only node — emits node-created (inline wording) + entity-included + proposal, no co-bundled classify-node
    # Three participants joined; no candidate node yet. The moderator
    # captures a fresh statement; the handler emits the entity-layer
    # record (`node-created` with inline `wording`) and the inclusion
    # event, plus the proposal envelope. Critically NO bundled
    # `classify-node` proposal — that's a separate later gesture per
    # ADR 0030 §1. The classification facet of the new node enters
    # life as `awaiting-proposal`.
    Given a seeded session with three participants and no captured nodes yet
    When the moderator constructs a wording-only propose-capture-node action
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Valid
    And the result carries exactly 3 events — node-created, entity-included, and the capture-node proposal envelope — with no co-bundled classify-node
    And the captured node's classification facet projects as awaiting-proposal

  Scenario: moderator captures a node with a connecting supports edge — emits node + entity-included(node) + edge + entity-included(edge) + proposal (5 events, no co-bundled classify-node / set-edge-substance)
    # Three participants joined; one pre-existing visible target node.
    # The moderator captures a fresh statement AND a `supports` edge
    # linking it to the existing target in one gesture (ADR 0030 §4
    # "compound gesture survives"). The handler emits the captured
    # node's entity-layer record, the connecting edge's entity-layer
    # record, and the proposal envelope. NO co-bundled `classify-node`
    # or `set-edge-substance` proposals.
    Given a seeded session with three participants and a visible target node
    When the moderator constructs a capture-with-edge propose-capture-node action linking a fresh node to the visible target
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Valid
    And the result carries exactly 5 events — node-created, entity-included for the node, edge-created, entity-included for the edge, and the capture-node proposal envelope — with no co-bundled classify-node or set-edge-substance
