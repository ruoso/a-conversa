// Per-(entity, facet) per-participant vote projection for every client-
// side surface.
//
// Refinement: tasks/refinements/shell-package/extract_votes_by_facet_projector_v2.md
//   (predecessor audit: extract_votes_by_facet_projector.md;
//    alignment task:    data-and-methodology/align_vote_facet_target_vocabulary.md)
// ADR 0030 §2 + §10 — the `target`-discriminated vote payload union and
//   the per-`(entity, facet)` bucket semantics this projection mirrors.
//
// Two public entry points share one private accumulator loop:
//
//   - `projectVotesByFacet(events)` — every participant's vote. Drives the
//     moderator's in-pill vote-indicator row and per-proposal sidebar
//     breakdown.
//   - `projectOtherVotesByFacet(events, currentParticipantId)` — every
//     vote EXCEPT the one cast by `currentParticipantId`. Drives the
//     participant's per-proposal breakdown row (the participant's own
//     vote is encoded in the chip color separately; the dot row surfaces
//     OTHER voters only).
//
// The self-filter is applied at insertion time (votes by the current
// participant never reach the bucket), matching the predecessor
// `projectOtherVotesByFacet` posture per
// `tasks/refinements/participant-ui/part_other_vote_indicators.md`
// Decision §3.
//
// **Methodology semantics**: every facet-targeting proposal sub-kind has
// at most one in-flight proposal per facet at a time; latest vote per
// `(proposal, participant)` wins; agree↔dispute switches are legal and
// surface as the new arm. Position semantics: each participant's FIRST
// vote on a `(entity, facet)` bucket pins their position; subsequent
// arm-switches overwrite in place. Unknown / non-facet-targeting
// proposals contribute nothing; votes referencing an unknown proposal id
// (proposal-arm) are silently dropped.
//
// **Pure**: no `Date.now()`, no `Math.random()`, no closure over time.

import type { Event, ProposalPayload } from '@a-conversa/shared-types';

import { type FacetName, type Vote } from '../facet-pill/index.js';

/**
 * Per-participant vote index keyed by `(entityId, facet)`. Both public
 * entry points return this readonly shape; the inner `readonly Vote[]`
 * preserves arrival-order across renders. The outer-map key is
 * `entityId` (node UUID OR edge UUID — disjoint keyspaces per
 * `mod_vote_indicators_in_sidebar` Decision §4).
 */
export type VotesByFacetIndex = ReadonlyMap<string, ReadonlyMap<FacetName, readonly Vote[]>>;

/**
 * Module-scope shared empty `VotesByFacetIndex` — hands a stable
 * reference to callers (default-parameter fall-throughs, tests that
 * exercise consumers without a populated index, no-vote sessions where
 * React memoization wants reference-stability across renders).
 */
export const EMPTY_VOTES_BY_FACET_INDEX: VotesByFacetIndex = new Map();

type FacetTarget = {
  readonly entityKind: 'node' | 'edge';
  readonly entityId: string;
  readonly facet: FacetName;
};

/**
 * Decode the (entityKind, entityId, facet) target of a proposal payload
 * for vote projection. The four facet-targeting sub-kinds resolve to a
 * target — three node-keyed (`classify-node`, `set-node-substance`,
 * `edit-wording`) and one edge-keyed (`set-edge-substance`). Structural
 * / voteless sub-kinds return `null` so the caller drops the proposal
 * from the projection.
 *
 * Refinement: `data_and_methodology.align_vote_facet_target_vocabulary`
 * Decisions §1–§3 — the canonical facet-valued partition is four kinds.
 * `amend-node` is structural (proposal-keyed; routes through
 * `projectVotesByProposal`). `capture-node` is voteless at the proposal
 * arm per `packages/shared-types/src/events/proposals.ts:111-116`;
 * post-capture wording votes arrive on the `target: 'facet'` arm and
 * bypass this dispatcher entirely.
 */
function voteTargetOf(proposal: ProposalPayload): FacetTarget | null {
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
 * Shared single-pass accumulator. `currentParticipantId === null`
 * preserves every vote; a non-null value drops votes whose `participant`
 * matches at insertion time (before any allocation).
 */
function walkVotes(
  events: readonly Event[],
  currentParticipantId: string | null,
): VotesByFacetIndex {
  const proposalTarget = new Map<string, FacetTarget>();
  const out = new Map<string, Map<FacetName, Vote[]>>();
  const positionIndex = new Map<string, Map<FacetName, Map<string, number>>>();

  for (const event of events) {
    if (event.kind === 'proposal') {
      const target = voteTargetOf(event.payload.proposal);
      if (target === null) continue;
      proposalTarget.set(event.id, target);
      continue;
    }
    if (event.kind === 'vote') {
      const participantId = event.payload.participant;
      if (currentParticipantId !== null && participantId === currentParticipantId) continue;

      // Per ADR 0030 §2: vote payloads are a `target`-discriminated
      // union. Resolve to the `(entityId, facet)` pair from either arm —
      // the facet-keyed arm carries it directly; the proposal-keyed arm
      // looks it up via the proposal-id → target map.
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
    // Other event kinds (commit, meta-disagreement-marked, node-created,
    // edge-created, annotation-created, etc.) do not contribute votes.
    // A commit or meta-disagreement-marked event closes the proposal on
    // the methodology side but the votes recorded BEFORE closure remain
    // surfaced — they're the historical record of who agreed. Server-
    // side write rules prevent further arm-switching votes after commit
    // (rule 3 in `vote.ts`), so the last-write-wins semantics are stable.
  }

  return out;
}

/**
 * Pure projection from a session's event log to a per-(entityId, facet)
 * `Vote[]` index covering every participant. Single-pass over `events`.
 */
export function projectVotesByFacet(events: readonly Event[]): VotesByFacetIndex {
  return walkVotes(events, null);
}

/**
 * Pure projection filtered to OTHER participants — votes by
 * `currentParticipantId` are dropped at insertion time. Single-pass over
 * `events`. Used on the participant surface where the local participant's
 * own vote is encoded separately (in the chip color); the per-voter dot
 * row surfaces OTHER voters only.
 */
export function projectOtherVotesByFacet(
  events: readonly Event[],
  currentParticipantId: string,
): VotesByFacetIndex {
  return walkVotes(events, currentParticipantId);
}
