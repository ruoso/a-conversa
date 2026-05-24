Feature: methodology engine — structural sub-kinds retain proposal-keyed vote / commit envelopes
  # Per ADR 0030 §9 the six structural proposal sub-kinds — `decompose`,
  # `interpretive-split`, `axiom-mark`, `annotate`, `meta-move`,
  # `break-edge` — keep proposal-id-keyed vote / commit / meta-disagreement-
  # marked envelopes (the `target: 'proposal'` arm of the discriminated
  # union). The four facet-valued sub-kinds (`classify-node`,
  # `set-node-substance`, `set-edge-substance`, `edit-wording`) use the
  # `target: 'facet'` arm per ADR 0030 §2. The two patterns coexist by
  # design.
  #
  # The Vitest unit tests at
  # `apps/server/src/methodology/handlers/structural-target.test.ts`
  # cover the in-memory contract: across all six structural sub-kinds,
  # the methodology engine's vote and commit dispatchers emit the
  # proposal-keyed arm; never the facet-keyed arm. THIS scenario adds
  # the integration pin those tests cannot reach: the structural
  # round-trip walks through pglite (`session_events` JSONB column +
  # `session_events_kind_check` CHECK + TIMESTAMPTZ / BIGINT coercion),
  # the projection's incremental `applyEvent` for both votes and the
  # commit, and the proposal-keyed arm of `handleCommit` to confirm the
  # proposal lands on `committedProposals` with the proposal-id-keyed
  # commit record.
  #
  # If a future refactor accidentally flips a structural sub-kind into
  # the facet arm — or removes the proposal-keyed arm of the dispatch —
  # this scenario fails at the schema seam, complementing the unit-test
  # pins at the dispatch site.
  #
  # Refinement: tasks/refinements/per-facet-refactor/pf_structural_handlers_unchanged.md
  # ADR:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md §9

  Scenario: a decompose proposal round-trips through proposal-keyed votes + commit via pglite
    # Seed a 3-participant session with a node-created + a structural
    # `decompose` proposal (with propose-time fan-out per ADR 0027).
    # Cast three unanimous-agree `vote` envelopes with `target:
    # 'proposal'` (NOT `target: 'facet'`) — one per current participant.
    # The moderator then constructs a `commit` action; the methodology
    # engine validates against the DB-projected projection and returns
    # Valid with a single `commit` event carrying `target: 'proposal'`
    # and the original proposal id. The full log is round-tripped
    # through pglite + projectFromLog and the projection's
    # `committedProposals` map carries the decompose proposal id.
    Given a seeded session with three participants and a pending decompose proposal for structural-target tests
    And three proposal-keyed agree votes against the decompose proposal in the session log
    When the moderator constructs a commit action against the pending decompose proposal
    And the methodology engine validates the commit action against the projected session for structural-target tests
    Then the validation result is Valid for structural-target tests
    And the emitted commit event carries target "proposal" and the original decompose proposal id
    And appending the commit event to the session log and re-projecting moves the decompose proposal into committedProposals
