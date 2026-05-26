// Per-proposal-id per-OTHER-participant vote projection for the
// participant's pending-proposals chip strip (structural sub-kinds).
//
// Refinement: tasks/refinements/participant-ui/part_vote_indicators_in_pane.md
//
// Ported from the moderator's `projectVotesByProposal` at
// `apps/moderator/src/graph/selectors.ts:877` with one divergence: votes
// by `currentParticipantId` are silently dropped at insertion time
// (Decision §2 — same self-filter idiom as `projectOtherVotesByFacet`).
//
// **Pure**: no `Date.now()`, no `Math.random()`, no closure over time.

import type { Event } from '@a-conversa/shared-types';
import { type Vote } from '@a-conversa/shell';

export type OtherVotesByProposalIndex = ReadonlyMap<string, readonly Vote[]>;

export const EMPTY_OTHER_VOTES_BY_PROPOSAL_INDEX: OtherVotesByProposalIndex = new Map();

/**
 * Pure projection from a session's event log to a per-proposal-id
 * `Vote[]` index, filtered to OTHER participants only. Single-pass over
 * `events`.
 *
 * Records every `proposal` envelope id as a known proposal; for each
 * subsequent `vote` event with `target === 'proposal'` referencing a
 * known proposal id, records the participant's latest vote
 * (last-write-wins per `(proposal, participant)`). Position is pinned by
 * each participant's first vote on the proposal; subsequent arm-switches
 * overwrite in place. Facet-arm votes are skipped here (they flow through
 * `projectOtherVotesByFacet`). Unknown proposal ids → silently dropped.
 */
export function projectOtherVotesByProposal(
  events: readonly Event[],
  currentParticipantId: string,
): OtherVotesByProposalIndex {
  const knownProposals = new Set<string>();
  const out = new Map<string, Vote[]>();
  const positionIndex = new Map<string, Map<string, number>>();

  for (const event of events) {
    if (event.kind === 'proposal') {
      knownProposals.add(event.id);
      continue;
    }
    if (event.kind === 'vote') {
      if (event.payload.target !== 'proposal') continue;
      const participantId = event.payload.participant;
      if (participantId === currentParticipantId) continue;
      const proposalId = event.payload.proposal_id;
      if (!knownProposals.has(proposalId)) continue;

      let perProposal = out.get(proposalId);
      if (perProposal === undefined) {
        perProposal = [];
        out.set(proposalId, perProposal);
      }
      let perProposalPositions = positionIndex.get(proposalId);
      if (perProposalPositions === undefined) {
        perProposalPositions = new Map();
        positionIndex.set(proposalId, perProposalPositions);
      }
      const choice = event.payload.choice;
      const priorIndex = perProposalPositions.get(participantId);
      if (priorIndex === undefined) {
        perProposalPositions.set(participantId, perProposal.length);
        perProposal.push({ participantId, choice });
      } else {
        perProposal[priorIndex] = { participantId, choice };
      }
      continue;
    }
  }
  return out;
}
