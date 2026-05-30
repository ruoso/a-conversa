Feature: methodology engine — propose set-edge-substance handler with polymorphic annotation endpoints
  # The Vitest tests at
  # apps/server/src/methodology/handlers/proposeSetEdgeSubstanceValidation.test.ts
  # cover the propose-set-edge-substance handler's polymorphic Phase 1
  # symmetry / Phase 2a/2b/2c rule set in isolation (events constructed
  # as TS literals). This feature covers the integration path per
  # `set_edge_substance_annotation_endpoint` D8: the session's events
  # are round-tripped through pglite's `session_events` table (JSONB /
  # TIMESTAMPTZ / BIGINT), replayed through `projectFromLog`, and the
  # resulting projection is the one `validateAction` operates against.
  # The emitted `edge-created` carries the polymorphic-endpoint shape
  # (one source-side slot + one target-side slot, each independently a
  # node id or an annotation id); appending the emitted events to the
  # event log and re-projecting yields an annotation-endpoint edge on
  # the projection.
  #
  # Refinement: tasks/refinements/data-and-methodology/set_edge_substance_annotation_endpoint.md
  # ADR:        docs/adr/0027-entity-and-facet-layers-strict-separation.md
  # ADR:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§4, §5)

  Scenario: moderator proposes a set-edge-substance with target_annotation_id — emits edge-created (polymorphic) + entity-included + proposal, projected edge carries the annotation endpoint
    # Three participants joined; one visible source node + one visible
    # annotation attached to that node. The moderator proposes the
    # first substance vote for a fresh edge whose source is the node
    # and whose target is the annotation (the E15-shape edge per the
    # example walkthrough). The handler emits the entity-layer record
    # (`edge-created` with polymorphic endpoints inline) + the
    # inclusion event + the proposal envelope; replaying the
    # concatenated log yields a projected edge with `targetNodeId ===
    # null` and `targetAnnotationId === <annotation id>`.
    Given a seeded session with three participants, a visible source node, and a visible target annotation
    When the moderator constructs a set-edge-substance propose action whose target is the annotation
    And the methodology engine validates the propose action against the projected session
    Then the validation result is Valid
    And the result carries exactly 3 events — edge-created, entity-included, and the set-edge-substance proposal envelope
    And the emitted edge-created event carries source_node_id and target_annotation_id with the node-side and annotation-side slots empty for their opposites
    And replaying the concatenated log yields a projected edge whose source is the node and whose target is the annotation
