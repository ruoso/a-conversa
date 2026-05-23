Feature: meta-disagreement-marked payload — facet-keyed and proposal-keyed arms round-trip
  # Per ADR 0030 §2 + §9 the meta-disagreement-marked event's payload is
  # now a `target`-discriminated union with two arms (mirroring the vote
  # + commit payload splits):
  #
  #   - `target: 'facet'` — marks against facet-valued proposal sub-
  #     kinds (classify-node / set-node-substance / set-edge-substance /
  #     edit-wording). Keyed by `(entity_kind, entity_id, facet)`. NO
  #     `proposal_id` field.
  #   - `target: 'proposal'` — marks against structural proposal sub-
  #     kinds (decompose / interpretive-split / axiom-mark / meta-move /
  #     break-edge / amend-node / annotate). Keyed by `proposal_id`.
  #
  # The Vitest tests at `packages/shared-types/src/events.test.ts` and
  # `apps/server/src/events/validate.test.ts` pin the in-memory schema
  # (round-trip both arms + reject every cross-arm corruption). THIS
  # scenario adds the integration pin those tests cannot reach: BOTH
  # arms of the discriminated union round-trip through pglite's JSONB
  # column / TIMESTAMPTZ / BIGINT coercion path, pass the
  # `session_events_kind_check` CHECK constraint (the
  # `meta-disagreement-marked` kind is unchanged at the SQL layer per
  # the refinement; the payload-shape change is wire-level only),
  # survive `selectEvents` → `validateEvent` recovery into a typed
  # envelope, and `projectFromLog` applies the proposal-keyed arm
  # without throwing.
  #
  # **Projection-side handling of the facet-keyed arm is out of scope.**
  # The methodology engine still emits the proposal-keyed arm for ALL
  # meta-disagreement marks (per the
  # TODO(pf_meta_disagreement_handler_facet_keyed) in
  # `apps/server/src/methodology/handlers/markMetaDisagreement.ts`); the
  # projection's `handleMetaDisagreementMarked` rejects the facet-keyed
  # arm with a clear runtime error so any inadvertent emission during
  # the transition surfaces loudly. The downstream
  # `pf_meta_disagreement_handler_facet_keyed` task rewires both halves.
  # Today's pin: the facet-keyed arm round-trips through the SCHEMA
  # SEAM (insert + read + validateEvent) without the projection ever
  # consuming it.
  #
  # Refinement: tasks/refinements/per-facet-refactor/pf_facet_keyed_meta_disagreement_payload.md
  # ADRs:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md,
  #              docs/adr/0021-event-envelope-discriminated-union-with-zod.md

  Scenario: a proposal-keyed meta-disagreement-marked envelope inserts, validates, and replays cleanly
    # Seed a 3-participant session with a node-created + a structural
    # `axiom-mark` proposal so the proposal-keyed mark payload references
    # a real structural-kind proposal. INSERT a `meta-disagreement-marked`
    # envelope with `target: 'proposal'` at the next sequence. Round-trip
    # the log: select rows → validateEvent → replay via projectFromLog.
    # The replay completes (no throw) and the projection's
    # `lastAppliedSequence` matches the mark event's sequence.
    Given a seeded session with three participants for facet-keyed meta-disagreement tests
    And an axiom-mark proposal for the facet-keyed-meta-disagreement-test node
    When a proposal-keyed meta-disagreement-marked envelope is inserted for the axiom-mark proposal
    And I project the facet-keyed-meta-disagreement event log via projectFromLog
    Then the facet-keyed-meta-disagreement projection's lastAppliedSequence equals the proposal-keyed-meta-disagreement event's sequence
    And the proposal-keyed-meta-disagreement event round-trips through validateEvent with kind "meta-disagreement-marked" and target "proposal"

  Scenario: a facet-keyed meta-disagreement-marked envelope inserts and validates cleanly (projection handling is downstream)
    # Same seed (3 participants + node). INSERT a `meta-disagreement-marked`
    # envelope with `target: 'facet'` against the node's classification
    # facet. The DB accepts the row (the `kind` CHECK is unchanged; the
    # payload-shape change is wire-level only). `validateEvent` recovers
    # the typed envelope from the JSONB column. The projection-side
    # handler does NOT yet consume the facet-keyed arm — we assert the
    # round-trip through the schema seam only.
    Given a seeded session with three participants for facet-keyed meta-disagreement tests
    And a node-created event for the facet-keyed-meta-disagreement-test node
    When a facet-keyed meta-disagreement-marked envelope is inserted for the node's classification facet
    Then the facet-keyed-meta-disagreement event round-trips through validateEvent with kind "meta-disagreement-marked" and target "facet"
