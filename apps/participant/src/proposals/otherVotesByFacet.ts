// Per-(entity, facet) per-OTHER-participant vote projection for the
// participant's pending-proposals chip strip.
//
// Refinement: tasks/refinements/participant-ui/part_vote_indicators_in_pane.md
//
// Ported from the moderator's `projectVotesByFacet` at
// `apps/moderator/src/graph/selectors.ts:571` with one divergence: votes
// by `currentParticipantId` are silently dropped at insertion time
// (Decision §2 — "port + filter self at insertion", mirroring the canvas-
// side `projectOtherVotes(events, currentParticipantId)` idiom established
// by `part_other_vote_indicators`).
//
// **Pure**: no `Date.now()`, no `Math.random()`, no closure over time.
// Output is a `ReadonlyMap` of `ReadonlyMap`s; the empty default is the
// module-scope frozen `EMPTY_OTHER_VOTES_BY_FACET_INDEX` so React
// memoization stays reference-stable across no-vote sessions.

import type { Event, ProposalPayload } from '@a-conversa/shared-types';
import { type FacetName, type Vote } from '@a-conversa/shell';

export type OtherVotesByFacetIndex = ReadonlyMap<string, ReadonlyMap<FacetName, readonly Vote[]>>;

export const EMPTY_OTHER_VOTES_BY_FACET_INDEX: OtherVotesByFacetIndex = new Map();

type FacetTarget = {
  readonly entityKind: 'node' | 'edge';
  readonly entityId: string;
  readonly facet: FacetName;
};

// Refinement: `data_and_methodology.align_vote_facet_target_vocabulary`
// Decisions §1–§3 — the canonical facet-valued partition is four kinds,
// case-for-case identical to the moderator's `voteTargetOf` at
// `apps/moderator/src/graph/selectors.ts:529`. `amend-node` is structural
// (proposal-keyed; bucketed by `projectVotesByProposal` on the moderator
// side / `projectOtherVotesByProposal` on the participant side, not
// here). `capture-node` is voteless at the proposal arm per
// `packages/shared-types/src/events/proposals.ts:111-116`; post-capture
// wording votes arrive on the `target: 'facet'` arm and bypass this
// dispatcher entirely via the facet-arm branch below.
function facetTargetOf(proposal: ProposalPayload): FacetTarget | null {
  switch (proposal.kind) {
    case 'classify-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'classification' };
    case 'set-node-substance':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'substance' };
    case 'set-edge-substance':
      return { entityKind: 'edge', entityId: proposal.edge_id, facet: 'substance' };
    case 'edit-wording':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    default:
      // decompose, interpretive-split, axiom-mark, meta-move,
      // break-edge, annotate, amend-node, capture-node — no
      // per-(entity, facet) target. amend-node is structural
      // (proposal-keyed); capture-node is voteless at the proposal arm
      // (wording votes following a capture arrive via the facet arm).
      return null;
  }
}

/**
 * Pure projection from a session's event log to a per-(entityId, facet)
 * `Vote[]` index, filtered to OTHER participants only (`currentParticipantId`
 * votes are dropped at insertion). Single-pass over `events`.
 *
 * Position semantics: the first vote from each `(entityId, facet,
 * participant)` triple pins position; subsequent arm-switches by the same
 * participant overwrite in place. Unknown proposals → votes silently
 * dropped. Mirrors the moderator's `projectVotesByFacet` verbatim except
 * for the self-filter.
 */
export function projectOtherVotesByFacet(
  events: readonly Event[],
  currentParticipantId: string,
): OtherVotesByFacetIndex {
  const proposalTarget = new Map<string, FacetTarget>();
  const out = new Map<string, Map<FacetName, Vote[]>>();
  const positionIndex = new Map<string, Map<FacetName, Map<string, number>>>();

  for (const event of events) {
    if (event.kind === 'proposal') {
      const target = facetTargetOf(event.payload.proposal);
      if (target === null) continue;
      proposalTarget.set(event.id, target);
      continue;
    }
    if (event.kind === 'vote') {
      const participantId = event.payload.participant;
      if (participantId === currentParticipantId) continue;

      let entityId: string;
      let facet: FacetName;
      if (event.payload.target === 'facet') {
        entityId = event.payload.entity_id;
        facet = event.payload.facet;
      } else {
        const target = proposalTarget.get(event.payload.proposal_id);
        if (target === undefined) continue;
        entityId = target.entityId;
        facet = target.facet;
      }

      let perEntity = out.get(entityId);
      if (perEntity === undefined) {
        perEntity = new Map();
        out.set(entityId, perEntity);
      }
      let perFacet = perEntity.get(facet);
      if (perFacet === undefined) {
        perFacet = [];
        perEntity.set(facet, perFacet);
      }

      let perEntityPositions = positionIndex.get(entityId);
      if (perEntityPositions === undefined) {
        perEntityPositions = new Map();
        positionIndex.set(entityId, perEntityPositions);
      }
      let perFacetPositions = perEntityPositions.get(facet);
      if (perFacetPositions === undefined) {
        perFacetPositions = new Map();
        perEntityPositions.set(facet, perFacetPositions);
      }

      const choice = event.payload.choice;
      const priorIndex = perFacetPositions.get(participantId);
      if (priorIndex === undefined) {
        perFacetPositions.set(participantId, perFacet.length);
        perFacet.push({ participantId, choice });
      } else {
        perFacet[priorIndex] = { participantId, choice };
      }
      continue;
    }
  }

  return out;
}
