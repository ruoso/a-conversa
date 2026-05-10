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

import type {
  CommittedProposalRecord,
  ParticipantRecord,
  PendingProposal,
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
