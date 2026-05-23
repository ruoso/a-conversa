Feature: commit payload — facet-keyed and proposal-keyed arms round-trip
  # Per ADR 0030 §2 + §9 the commit event's payload is now a
  # `target`-discriminated union with two arms (mirroring the vote
  # payload's split):
  #
  #   - `target: 'facet'` — commits against facet-valued proposal sub-
  #     kinds (classify-node / set-node-substance / set-edge-substance /
  #     edit-wording). Keyed by `(entity_kind, entity_id, facet)`. NO
  #     `proposal_id` field.
  #   - `target: 'proposal'` — commits against structural proposal sub-
  #     kinds (decompose / interpretive-split / axiom-mark / meta-move /
  #     break-edge / amend-node / annotate). Keyed by `proposal_id`.
  #
  # The Vitest tests at `packages/shared-types/src/events.test.ts` and
  # `apps/server/src/events/validate.test.ts` pin the in-memory schema
  # (round-trip both arms + reject every cross-arm corruption). THIS
  # scenario adds the integration pin those tests cannot reach: BOTH
  # arms of the discriminated union round-trip through pglite's JSONB
  # column / TIMESTAMPTZ / BIGINT coercion path, pass the
  # `session_events_kind_check` CHECK constraint (the `commit` kind is
  # unchanged at the SQL layer per the refinement; the payload-shape
  # change is wire-level only), survive `selectEvents` → `validateEvent`
  # recovery into a typed envelope, and `projectFromLog` applies the
  # proposal-keyed arm without throwing.
  #
  # **Projection-side handling of the facet-keyed arm is out of scope.**
  # The methodology engine still emits the proposal-keyed arm for ALL
  # commits (per the TODO(pf_commit_handler_facet_keyed) in
  # `apps/server/src/methodology/handlers/commit.ts`); the projection's
  # `handleCommit` rejects the facet-keyed arm with a clear runtime
  # error so any inadvertent emission during the transition surfaces
  # loudly. The downstream `pf_commit_handler_facet_keyed` task rewires
  # both halves. Today's pin: the facet-keyed arm round-trips through
  # the SCHEMA SEAM (insert + read + validateEvent) without the
  # projection ever consuming it.
  #
  # Refinement: tasks/refinements/per-facet-refactor/pf_facet_keyed_commit_payload.md
  # ADRs:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md,
  #              docs/adr/0021-event-envelope-discriminated-union-with-zod.md

  Scenario: a proposal-keyed commit envelope inserts, validates, and replays cleanly
    # Seed a 3-participant session with a node-created + a structural
    # `axiom-mark` proposal + a unanimous-agree set of proposal-keyed
    # votes so the commit's unanimous-agree predicate holds on replay.
    # INSERT a `commit` envelope with `target: 'proposal'` at the next
    # sequence. Round-trip the log: select rows → validateEvent →
    # replay via projectFromLog. The replay completes (no throw) and
    # the projection's `lastAppliedSequence` matches the commit
    # event's sequence.
    Given a seeded session with three participants for facet-keyed commit tests
    And an axiom-mark proposal for the facet-keyed-commit-test node
    And unanimous-agree proposal-keyed votes for the axiom-mark proposal
    When a proposal-keyed commit envelope is inserted for the axiom-mark proposal
    And I project the facet-keyed-commit event log via projectFromLog
    Then the facet-keyed-commit projection's lastAppliedSequence equals the proposal-keyed-commit event's sequence
    And the proposal-keyed-commit event round-trips through validateEvent with kind "commit" and target "proposal"

  Scenario: a facet-keyed commit envelope inserts and validates cleanly (projection handling is downstream)
    # Same seed (3 participants + node). INSERT a `commit` envelope with
    # `target: 'facet'` against the node's classification facet. The DB
    # accepts the row (the `kind` CHECK is unchanged; the payload-shape
    # change is wire-level only). `validateEvent` recovers the typed
    # envelope from the JSONB column. The projection-side handler does
    # NOT yet consume the facet-keyed arm — we assert the round-trip
    # through the schema seam only.
    Given a seeded session with three participants for facet-keyed commit tests
    And a node-created event for the facet-keyed-commit-test node
    When a facet-keyed commit envelope is inserted for the node's classification facet
    Then the facet-keyed-commit event round-trips through validateEvent with kind "commit" and target "facet"
