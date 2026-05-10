// Methodology engine — common validation primitives.
//
// Refinement: tasks/refinements/data-and-methodology/agreement_state_machine.md
// TaskJuggler: data_and_methodology.methodology_engine.agreement_state_machine
//
// The siblings (`commit_logic`, `withdrawal_logic`, etc.) call these
// dozens of times each. Two style choices follow from that:
//
//  - **Boolean predicates** for "tell me if X" — read clean inside an
//    `if`-guard.
//  - **Discriminated `RequireResult<T>`** for "fetch X or rejection"
//    — the `requireParticipant` / `requireModerator` helpers return
//    a `{ ok: true; record }` or `{ ok: false; rejection }`. Callers
//    use `if (!result.ok) return result.rejection;` to unwrap. The
//    pattern mirrors `FacetStatusDerivationError`'s sibling on the
//    read side, except we discriminate rather than throw because
//    siblings need to surface the typed `RejectionReason` upstream
//    rather than turn a logic-flow into an exception.

import type { ProposalPayload } from '@a-conversa/shared-types';
import type {
  CommittedProposalRecord,
  FacetName,
  FacetState,
  ParticipantRecord,
  PendingProposal,
  PerParticipantVote,
  Projection,
  UnresolvedMetaDisagreement,
} from '../projection/index.js';
import type { RejectedValidationResult, RequireResult } from './types.js';

// ---------------------------------------------------------------
// Boolean predicates.
// ---------------------------------------------------------------

export function requesterIsParticipant(projection: Projection, userId: string): boolean {
  return projection.currentParticipants().some((p) => p.userId === userId);
}

export function requesterIsModerator(projection: Projection, userId: string): boolean {
  const record = projection.currentParticipants().find((p) => p.userId === userId);
  return record?.role === 'moderator';
}

// ---------------------------------------------------------------
// Convenience accessors.
// ---------------------------------------------------------------

export function currentParticipants(projection: Projection): readonly ParticipantRecord[] {
  return projection.currentParticipants();
}

export function nextSequence(projection: Projection): number {
  return projection.lastAppliedSequence + 1;
}

// ---------------------------------------------------------------
// Proposal lookup.
//
// A proposal id may currently be in any of three states in the
// projection: pending (live; awaiting commit / mark), committed
// (locked-in; potentially still vote-targetable for `withdraw`), or
// meta-disagreement (irreducible; both proposed values carried). A
// fourth state is "not found" — returned as `null`.
// ---------------------------------------------------------------

export type FoundProposal =
  | { state: 'pending'; record: PendingProposal }
  | { state: 'committed'; record: CommittedProposalRecord }
  | { state: 'meta-disagreement'; record: UnresolvedMetaDisagreement };

export function findProposal(
  projection: Projection,
  proposalEventId: string,
): FoundProposal | null {
  const pending = projection.getPendingProposal(proposalEventId);
  if (pending !== undefined) return { state: 'pending', record: pending };
  const committed = projection.getCommittedProposal(proposalEventId);
  if (committed !== undefined) return { state: 'committed', record: committed };
  const meta = projection.getUnresolvedMetaDisagreement(proposalEventId);
  if (meta !== undefined) return { state: 'meta-disagreement', record: meta };
  return null;
}

// ---------------------------------------------------------------
// `requireX` — fetch-or-rejection helpers.
//
// Returns a discriminated result. Callers do
// `if (!r.ok) return r.rejection;` to surface the rejection upstream;
// the success branch carries the participant record so the caller
// doesn't have to re-fetch it.
// ---------------------------------------------------------------

function rejection(
  reason: RejectedValidationResult['reason'],
  detail: string,
): RejectedValidationResult {
  return { ok: false, reason, detail };
}

export function requireParticipant(
  projection: Projection,
  userId: string,
): RequireResult<ParticipantRecord> {
  const record = projection.currentParticipants().find((p) => p.userId === userId);
  if (!record) {
    return {
      ok: false,
      rejection: rejection(
        'not-a-participant',
        `requester ${userId} is not currently joined to session ${projection.sessionId}`,
      ),
    };
  }
  return { ok: true, record };
}

export function requireModerator(
  projection: Projection,
  userId: string,
): RequireResult<ParticipantRecord> {
  const participant = requireParticipant(projection, userId);
  if (!participant.ok) return participant;
  if (participant.record.role !== 'moderator') {
    return {
      ok: false,
      rejection: rejection(
        'not-a-moderator',
        `requester ${userId} is currently joined as ${participant.record.role}; this action requires the moderator role`,
      ),
    };
  }
  return participant;
}

// ---------------------------------------------------------------
// `findParticipantVoteOnProposal` — resolve a participant's prior
// vote on a *specific* proposal.
//
// Used by `withdrawal_logic` (vote handler) for the `already-voted`
// (re-cast same vote) / `no-prior-agree` (withdraw without prior
// agree) / dispute↔agree-switch rules. Returns:
//
//   - the recorded `PerParticipantVote` if the participant has a
//     record on the affected facet AND that record's
//     `proposalEventId` matches the queried proposal id;
//   - `null` if the participant has no record on the facet, the
//     record refers to a different proposal (the facet has hosted
//     votes for other proposals over time and was overwritten on
//     re-vote — the recorded `proposalEventId` is the ground truth
//     for "which proposal does this vote refer to"), or the
//     proposal sub-kind is structural (no per-facet vote tracking
//     — `decompose`, `interpretive-split`, `axiom-mark`,
//     `meta-move`, `break-edge`, `amend-node`, `annotate`).
//
// The facet-target resolution is duplicated from `handlers/commit.ts`
// (which itself mirrors `replay.ts`'s private helpers); a future
// refactor may extract them into a shared module — all three call
// sites would switch together.
// ---------------------------------------------------------------

interface FacetTarget {
  entityKind: 'node' | 'edge' | 'annotation';
  entityId: string;
  facet: FacetName;
}

function facetTargetForProposal(proposal: ProposalPayload): FacetTarget | null {
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
      return null;
  }
}

function facetStateForTarget(
  projection: Projection,
  target: FacetTarget,
): FacetState<unknown> | null {
  if (target.entityKind === 'node') {
    const node = projection.getNode(target.entityId);
    if (!node) return null;
    if (target.facet === 'classification') return node.classificationFacet;
    if (target.facet === 'substance') return node.substanceFacet;
    if (target.facet === 'wording') return node.wordingFacet;
    return null;
  }
  if (target.entityKind === 'edge') {
    const edge = projection.getEdge(target.entityId);
    if (!edge) return null;
    if (target.facet === 'substance') return edge.substanceFacet;
    return null;
  }
  if (target.entityKind === 'annotation') {
    const ann = projection.getAnnotation(target.entityId);
    if (!ann) return null;
    if (target.facet === 'wording') return ann.wordingFacet;
    if (target.facet === 'substance') return ann.substanceFacet;
    return null;
  }
  return null;
}

export function findParticipantVoteOnProposal(
  projection: Projection,
  proposalEventId: string,
  participantId: string,
): PerParticipantVote | null {
  const found = findProposal(projection, proposalEventId);
  if (found === null) return null;
  const target = facetTargetForProposal(found.record.payload);
  if (target === null) return null; // structural sub-kind — no per-facet vote tracking
  const facet = facetStateForTarget(projection, target);
  if (facet === null) return null;
  const record = facet.perParticipant.get(participantId);
  if (!record) return null;
  if (record.proposalEventId !== proposalEventId) return null;
  return record.vote;
}
