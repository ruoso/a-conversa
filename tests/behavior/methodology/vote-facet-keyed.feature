Feature: vote payload — facet-keyed and proposal-keyed arms round-trip
  # Per ADR 0030 §2 + §9 the vote event's payload is now a
  # `target`-discriminated union with two arms:
  #
  #   - `target: 'facet'` — votes against facet-valued proposal sub-
  #     kinds (classify-node / set-node-substance / set-edge-substance /
  #     edit-wording). Keyed by `(entity_kind, entity_id, facet)`. NO
  #     `proposal_id` field.
  #   - `target: 'proposal'` — votes against structural proposal sub-
  #     kinds (decompose / interpretive-split / axiom-mark / meta-move /
  #     break-edge / amend-node / annotate). Keyed by `proposal_id`.
  #
  # The Vitest tests at `packages/shared-types/src/events.test.ts` and
  # `apps/server/src/events/validate.test.ts` pin the in-memory schema
  # (round-trip both arms + reject every cross-arm corruption). THIS
  # scenario adds the integration pin those tests cannot reach: BOTH
  # arms of the discriminated union round-trip through pglite's JSONB
  # column / TIMESTAMPTZ / BIGINT coercion path, pass the
  # `session_events_kind_check` CHECK constraint (the `vote` kind is
  # unchanged at the SQL layer per the refinement; the payload-shape
  # change is wire-level only), survive `selectEvents` → `validateEvent`
  # recovery into a typed envelope, and `projectFromLog` applies the
  # proposal-keyed arm without throwing.
  #
  # **Schema-seam-only round-trip pin.** The methodology engine now
  # emits both arms (facet-keyed for facet-valued sub-kinds; proposal-
  # keyed for structural sub-kinds) per `pf_vote_handler_facet_keyed`
  # + ADR 0030 §2 + §9, and the projection's `handleVote` consumes
  # both arms. This scenario keeps its narrow focus on the schema seam:
  # both arms round-trip through pglite's JSONB column + `validateEvent`
  # without re-shaping. The dispatch-side coverage lives in the
  # methodology engine's Vitest tests + `vote.feature`.
  #
  # Refinement: tasks/refinements/per-facet-refactor/pf_facet_keyed_vote_payload.md
  # ADRs:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md,
  #              docs/adr/0021-event-envelope-discriminated-union-with-zod.md

  Scenario: a proposal-keyed vote envelope inserts, validates, and replays cleanly
    # Seed a 3-participant session with a node-created + a structural
    # `axiom-mark` proposal so the proposal-keyed vote payload references
    # a real structural-kind proposal. INSERT a `vote` envelope with
    # `target: 'proposal'`, choice 'agree' at the next sequence. Round-
    # trip the log: select rows → validateEvent → replay via
    # projectFromLog. The replay completes (no throw) and the
    # projection's `lastAppliedSequence` matches the vote event's
    # sequence.
    Given a seeded session with three participants for facet-keyed vote tests
    And an axiom-mark proposal for the facet-keyed-vote-test node
    When a proposal-keyed vote envelope is inserted for the axiom-mark proposal
    And I project the facet-keyed-vote event log via projectFromLog
    Then the facet-keyed-vote projection's lastAppliedSequence equals the proposal-keyed-vote event's sequence
    And the proposal-keyed-vote event round-trips through validateEvent with kind "vote" and target "proposal"

  Scenario: a facet-keyed vote envelope inserts and validates cleanly (projection handling is downstream)
    # Same seed (3 participants + node). INSERT a `vote` envelope with
    # `target: 'facet'`, choice 'agree' against the node's classification
    # facet. The DB accepts the row (the `kind` CHECK is unchanged; the
    # payload-shape change is wire-level only). `validateEvent` recovers
    # the typed envelope from the JSONB column. The projection-side
    # handler does NOT yet consume the facet-keyed arm — we assert the
    # round-trip through the schema seam only.
    Given a seeded session with three participants for facet-keyed vote tests
    And a node-created event for the facet-keyed-vote-test node
    When a facet-keyed vote envelope is inserted for the node's classification facet
    Then the facet-keyed-vote event round-trips through validateEvent with kind "vote" and target "facet"
