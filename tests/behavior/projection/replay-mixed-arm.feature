Feature: projectFromLog — mixed facet-keyed + proposal-keyed arms (pf_projection_replay_updates)
  # Behavior-test coverage for the projection walker's tolerance of
  # both arms of the `target`-discriminated vote / commit / meta-
  # disagreement-marked payloads (per ADR 0030 §2 + §9 +
  # `tasks/refinements/per-facet-refactor/pf_projection_replay_updates.md`).
  # The Vitest cases at `apps/server/src/projection/replay.test.ts`
  # exercise the dispatcher arm-by-arm in isolation; this feature
  # rounds-trips a single event log mixing BOTH arms through pglite's
  # `session_events` JSONB column so the discriminator round-trips
  # honestly through the wire seam and `projectFromLog` accepts the
  # mixed log without throwing.

  Scenario: a mixed-arm event log replays through to the expected facet states
    # Seed: 3 participants + 2 nodes. PROPOSAL-KEYED arm: classify node 1
    # via a proposal + 3 agree votes + a proposal-keyed commit. FACET-
    # KEYED arm: classify node 2 via a proposal + 3 facet-keyed agree
    # votes + a facet-keyed commit + a withdraw-agreement against the
    # committed facet. After replay:
    #   - node 1's classification facet derives `'committed'` (rule 6).
    #   - node 2's classification facet derives `'withdrawn'` (rule 4 —
    #     the facet was committed AND a participant withdrew).
    Given a seeded session with three participants for mixed-arm replay tests
    And two nodes for the mixed-arm replay session
    And a proposal-keyed classify round commits on the first node
    And a facet-keyed classify round commits on the second node
    And a withdraw-agreement against the second node's committed classification facet
    When I project the mixed-arm event log via projectFromLog
    Then deriveFacetStatus on the mixed-arm first node's classification facet is "committed"
    And deriveFacetStatus on the mixed-arm second node's classification facet is "withdrawn"
