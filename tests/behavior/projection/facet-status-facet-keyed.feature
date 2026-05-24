Feature: deriveFacetStatus — per-facet-keyed projection (pf_projection_facet_status_refactor)
  # Behavior-test coverage for the per-`(entity, facet)`-keyed projection
  # rewrite per ADR 0030 §7 + §10 +
  # `tasks/refinements/per-facet-refactor/pf_projection_facet_status_refactor.md`.
  # The Vitest tests at `apps/server/src/projection/facet-status.test.ts`
  # exercise the new derivation in isolation; these scenarios round-trip
  # the events through pglite's `session_events` table so the JSONB /
  # BIGINT / TIMESTAMPTZ coercion is exercised on the new event kinds
  # (proposal, withdraw-agreement) and the per-participant vote-reset
  # semantics that fire when a fresh facet-valued proposal lands.

  Scenario: a freshly created node has classification + substance in awaiting-proposal
    # node-created alone (no classify / set-substance proposal) leaves
    # the entity's classification and substance facets with no candidate
    # value — derivation Rule 2 emits 'awaiting-proposal'. Wording is
    # inline on `node-created` (per ADR 0030 §4) so it surfaces as
    # 'proposed' immediately.
    Given a seeded session with three participants in session_events for facet-status tests
    And a node-created event for the seeded facet-status session
    And an entity-included event for that node for facet-status tests
    When I project the facet-status event log via projectFromLog
    Then deriveFacetStatus on the seeded node's classification facet is "awaiting-proposal"
    And deriveFacetStatus on the seeded node's substance facet is "awaiting-proposal"
    And deriveFacetStatus on the seeded node's wording facet is "proposed"

  Scenario: a classify-node proposal flips classification from awaiting-proposal to proposed
    # The proposal supplies a candidate value for the classification
    # facet; derivation Rule 8 (default) returns 'proposed' (no votes
    # against the candidate yet).
    Given a seeded session with three participants in session_events for facet-status tests
    And a node-created event for the seeded facet-status session
    And an entity-included event for that node for facet-status tests
    And a classify-node proposal event for that node with classification "fact" for facet-status tests
    When I project the facet-status event log via projectFromLog
    Then deriveFacetStatus on the seeded node's classification facet is "proposed"
    # Substance facet still has no proposal → still awaiting-proposal.
    And deriveFacetStatus on the seeded node's substance facet is "awaiting-proposal"

  Scenario: a withdraw-agreement against a committed facet sends it to withdrawn
    # Per ADR 0030 §3: withdraw-agreement is its own first-class event
    # kind; the projection's `handleWithdrawAgreement` records the
    # participant on the facet's `withdrawals` set; derivation Rule 4
    # surfaces 'withdrawn' on the next read.
    Given a seeded session with three participants in session_events for facet-status tests
    And a node-created event for the seeded facet-status session
    And an entity-included event for that node for facet-status tests
    And a classify-node proposal event for that node with classification "fact" for facet-status tests
    And three agree votes on that classify proposal for facet-status tests
    And a commit event for that classify proposal for facet-status tests
    And a withdraw-agreement event on that node's classification facet for facet-status tests
    When I project the facet-status event log via projectFromLog
    Then deriveFacetStatus on the seeded node's classification facet is "withdrawn"
