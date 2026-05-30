Feature: projectFromLog — replay events from session_events through to a Projection
  # The Vitest tests at apps/server/src/projection/replay.test.ts cover
  # the per-event-kind dispatcher logic in isolation (events constructed
  # as TS literals). This feature covers the integration path: events
  # are round-tripped through pglite's `session_events` table —
  # JSONB-encoded payloads, TIMESTAMPTZ-formatted timestamps, BIGINT
  # sequences — read back out, mapped to typed `Event` envelopes via
  # `validateEvent` (per ADR 0021), and replayed by `projectFromLog`.
  #
  # The DB-round-trip scenario (last in the file) is the load-bearing
  # one: it asserts the JSONB encoding preserves a non-trivial payload
  # field-for-field. Per ADR 0022 (no throwaway verifications) the
  # probe IS this committed scenario.

  Scenario: project the empty fixture's event log
    # The bundled "empty" fixture has 4 events (session-created plus
    # 3 participant-joined). Replaying them produces an open session
    # with 3 active participants in the canonical roles and no nodes
    # or edges yet.
    When I load the "empty" fixture for projection
    And I read the empty-fixture events out of session_events and project them
    Then the projection's sessionState is "open"
    And the projection has 0 nodes
    And the projection has 0 edges
    And the projection has 0 pending proposals
    And the projection has 3 current participants
    And the projection's participants have roles "moderator", "debater-A", "debater-B"

  Scenario: classify-node commit reaches the projection
    # session-created -> 3 participants -> 1 node -> entity-included
    # -> proposal(classify-node) -> 3 votes(agree) -> commit. After
    # replay the node's classification facet is committed.
    Given a seeded session with three participants in session_events
    And a node-created event for the seeded session
    And an entity-included event for that node
    And a classify-node proposal event for that node with classification "fact"
    And three agree votes on that proposal
    And a commit event for that proposal
    When I read the seeded-session events out of session_events and project them
    Then the projection has 1 node
    And the projection has 0 pending proposals
    And the projected node's classification value is "fact"
    And the projected node's classification status is "agreed"

  Scenario: decompose commit makes the parent invisible
    # The parent node + two component nodes are created globally,
    # then a decompose proposal is committed. The parent stays in
    # getNode() but visible=false; the components remain visible.
    Given a seeded session with three participants in session_events
    And a node-created event named "parent" for the seeded session
    And a node-created event named "componentA" for the seeded session
    And a node-created event named "componentB" for the seeded session
    And a decompose proposal event on "parent" with two components
    And a commit event for that decompose proposal
    When I read the seeded-session events out of session_events and project them
    Then the parent node is in the projection but not visible
    And the component nodes are in the projection and visible

  Scenario: snapshot-created lands as a snapshot record
    Given a seeded session with three participants in session_events
    And a snapshot-created event with label "midpoint" at log position 5
    When I read the seeded-session events out of session_events and project them
    Then the projection has the labeled snapshot at log position 5

  Scenario: annotation-endpoint edge round-trips through projectFromLog
    # Per `projection_edge_annotation_endpoint`, the projection layer
    # carries polymorphic-endpoint edges (node OR annotation per
    # endpoint). The DB-round-trip pin: insert an `edge-created`
    # event whose `source_node_id` resolves a node and whose
    # `target_annotation_id` resolves an annotation, replay through
    # `projectFromLog`, assert the projected edge carries the four
    # polymorphic slots with the right two non-null and the other two
    # null.
    Given a seeded session with three participants in session_events
    And a node-created event for the seeded session
    And an annotation-created event targeting that node
    And an edge-created event from the node to the annotation
    When I read the seeded-session events out of session_events and project them
    Then the projection has 1 edge
    And the projected edge's source is the seeded node and its target is the seeded annotation

  Scenario: events round-trip through JSONB without field loss
    # The committed probe per ADR 0022: insert an event whose payload
    # is a non-trivial discriminated-union shape (a meta-move proposal
    # with content, meta_kind, target_kind, target_id), SELECT it back
    # out of session_events, run validateEvent, project it, and assert
    # the round-tripped payload is byte-for-byte equal to the
    # originally-inserted shape. This is the test that catches "did
    # JSONB drop / re-order / re-type any field?".
    Given a seeded session with three participants in session_events
    And a node-created event named "metaTarget" for the seeded session
    And the meta-move probe proposal event is inserted into session_events
    When I read the meta-move probe event back out of session_events
    Then the round-tripped payload equals the originally-inserted payload exactly
    And validateEvent accepts the round-tripped envelope as a typed Event
    And projectFromLog accepts the round-tripped event and records the proposal as pending
