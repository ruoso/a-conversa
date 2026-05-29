Feature: per-facet vote-projection vocabulary — moderator + participant agree at the cross-surface seam
  # Per ADR 0030 §2 the vote payload is a `target`-discriminated union:
  # facet-arm votes carry `(entity_kind, entity_id, facet)` directly;
  # proposal-arm votes carry `proposal_id` and rely on a client-side
  # dispatcher to map `proposal_id → (entity, facet)`. The four
  # canonical facet-valued proposal sub-kinds are:
  #
  #   - classify-node       → (node, classification)
  #   - set-node-substance  → (node, substance)
  #   - set-edge-substance  → (edge, substance)
  #   - edit-wording        → (node, wording)
  #
  # All other seven sub-kinds (decompose / interpretive-split /
  # axiom-mark / meta-move / break-edge / annotate / amend-node) are
  # structural at the proposal arm; `capture-node` is voteless at the
  # proposal arm per `packages/shared-types/src/events/proposals.ts:111-116`
  # (post-capture wording votes arrive on the facet arm).
  #
  # The moderator's `voteTargetOf` (`apps/moderator/src/graph/selectors.ts`)
  # and the participant's `facetTargetOf`
  # (`apps/participant/src/proposals/otherVotesByFacet.ts`) are the two
  # client-side dispatchers that resolve proposal-arm votes. The
  # Vitest layer per surface pins each dispatcher's local behavior;
  # THIS scenario is the cross-surface seam pin — both projectors run
  # against the same event log and agree on the per-(entity, facet)
  # bucket contents, including for the amend-node-as-structural and
  # capture-node-via-facet-arm cases.
  #
  # Refinement: tasks/refinements/data-and-methodology/align_vote_facet_target_vocabulary.md
  # ADRs:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md,
  #              docs/adr/0022-no-throwaway-verifications.md

  Scenario: both projectors agree on the per-(entity, facet) bucket for a mixed log
    # Seed an in-memory log with: one classify-node, one
    # set-node-substance, one set-edge-substance, one edit-wording (the
    # four facet-valued sub-kinds), one amend-node (structural), and
    # one capture-node (voteless at the proposal arm; the post-capture
    # wording vote arrives on the facet arm against the captured node).
    # `participant-A` votes once against each facet-valued proposal
    # (proposal arm), once against the amend-node proposal (proposal
    # arm — should be dropped by both dispatchers), and once on the
    # captured node's wording facet (facet arm). The participant
    # projector's self-id is `participant-B` so the self-filter
    # doesn't shadow the seam check.
    Given an in-memory event log seeded for the per-facet vote-vocabulary seam
    When both client projectors run against the seeded log
    Then both projectors produce the same per-(entity, facet) vote bucket
    And neither projector buckets the amend-node proposal-arm vote
    And both projectors bucket the captured node's wording vote under (node, wording)
