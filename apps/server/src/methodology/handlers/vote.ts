// `vote` action handler — the real write-side validator for the three
// vote arms (`agree` / `dispute` / `withdraw`).
//
// Refinement: tasks/refinements/data-and-methodology/withdrawal_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.withdrawal_logic
//
// **What this handler enforces** (per docs/methodology.md lines 9–25 and
// the vote-events refinement):
//
//   1. **Participant gate.** The requester must be currently joined.
//      → `'not-a-participant'` (unreachable in practice — the universal
//      gate in `validateAction` already filtered).
//   2. **Proposal exists.** The proposal id must reference a known
//      proposal (pending, committed, or meta-disagreed).
//      → `'proposal-not-found'`.
//   3. **Proposal-state vs. vote-arm matrix.**
//      - `meta-disagreement` (any arm) → `'proposal-already-meta-disagreement'`.
//        No votes are accepted on meta-disagreed proposals.
//      - `committed` + `agree` or `dispute` → `'proposal-already-committed'`.
//        The commit has landed; only `withdraw` is legal on this proposal.
//      - `pending` + `withdraw` → `'no-prior-agree'`.
//        Pending means commit hasn't happened; there is no agree to
//        withdraw from. Withdrawal is "second thoughts after a commit"
//        per `docs/methodology.md` line 25.
//   4. **Per-participant prior-vote check.** Look up the requester's
//      prior vote on the affected facet (only meaningful for the four
//      facet-targeting sub-kinds — `classify-node`, `set-node-substance`,
//      `set-edge-substance`, `edit-wording`):
//      - `agree` arm: prior `agree` on this proposal → `'already-voted'`.
//        No prior vote OR prior `dispute` → accept (dispute→agree switch
//        is legal; see the refinement's "Dispute ↔ agree mutability"
//        decision).
//      - `dispute` arm: prior `dispute` on this proposal → `'already-voted'`.
//        No prior vote OR prior `agree` → accept (agree→dispute switch
//        is legal).
//      - `withdraw` arm: prior `agree` on this proposal **required**.
//        Anything else (no prior vote, prior `dispute`, prior `withdraw`)
//        → `'no-prior-agree'`. Combined with rule 3's "withdraw only on
//        committed proposals" constraint, this is the full
//        "withdrawal requires a prior agree on a committed proposal" rule.
//
// **Structural-sub-kind boundary.** For the seven structural sub-kinds
// (`decompose`, `interpretive-split`, `axiom-mark`, `meta-move`,
// `break-edge`, `amend-node`, `annotate`), `findParticipantVoteOnProposal`
// returns `null` — no per-facet vote tracking exists on the projection
// for these. The rule-4 check is short-circuited as "no prior vote":
// `agree` / `dispute` accept; `withdraw` rejects with `'no-prior-agree'`.
// The per-sub-kind sibling tasks (`decomposition_logic`,
// `axiom_mark_logic`, etc.) will tighten this if they want different
// semantics for their sub-kind. Documented in the refinement.
//
// **Self-vote semantics.** `docs/methodology.md` line 9 says "all
// participants — both debaters and the moderator — must agree on every
// change to the graph before it lands." The proposer's own agree is
// required for the commit; therefore the proposer must be allowed to
// vote on their own proposal. The `'self-vote-not-allowed'`
// `RejectionReason` exists in the union for potential future use by
// other handlers (e.g. annotation logic) but is **not used here**.
//
// **Boundary with `replay.ts/handleVote`.** This handler is the
// **write-side** gate (does the request pass methodology rules?).
// `handleVote` (in `apps/server/src/projection/replay.ts`) is the
// **read-side** application that runs AFTER the API layer appends the
// event this handler emits: for the four facet-targeting sub-kinds it
// updates `facet.perParticipant[participant] = { vote, proposalEventId,
// votedAt }`; for the structural sub-kinds it no-ops the per-facet
// write. `deriveFacetStatus` then derives the overall facet status —
// rule 3 of `deriveFacetStatus` (`wasCommitted && hasWithdraw →
// 'withdrawn'`) is the read-side mirror of the success condition for
// the `withdraw` arm here.

import type { Projection } from '../../projection/index.js';
import { findParticipantVoteOnProposal, findProposal, requireParticipant } from '../primitives.js';
import type { EventToAppendEnvelope, ValidationResult, Validator, VoteAction } from '../types.js';

export const voteHandler: Validator<VoteAction> = (
  projection: Projection,
  action: VoteAction,
): ValidationResult => {
  // Rule 1 — participant gate.
  const participant = requireParticipant(projection, action.requester);
  if (!participant.ok) return participant.rejection;

  // Rule 2 — proposal exists.
  const found = findProposal(projection, action.proposalEventId);
  if (found === null) {
    return {
      ok: false,
      reason: 'proposal-not-found',
      detail: `vote: proposal ${action.proposalEventId} is not known to this session`,
    };
  }

  // Rule 3 — proposal-state vs. vote-arm matrix.
  if (found.state === 'meta-disagreement') {
    return {
      ok: false,
      reason: 'proposal-already-meta-disagreement',
      detail: `vote: proposal ${action.proposalEventId} has been marked as meta-disagreement at ${found.record.markedAt}; no votes are accepted on meta-disagreed proposals`,
    };
  }
  if (found.state === 'committed' && action.vote !== 'withdraw') {
    return {
      ok: false,
      reason: 'proposal-already-committed',
      detail: `vote: proposal ${action.proposalEventId} was committed at ${found.record.committedAt}; only 'withdraw' is legal on a committed proposal`,
    };
  }
  if (found.state === 'pending' && action.vote === 'withdraw') {
    return {
      ok: false,
      reason: 'no-prior-agree',
      detail: `vote: cannot withdraw from proposal ${action.proposalEventId} — it is still pending (no commit has landed; there is no agree to withdraw from)`,
    };
  }

  // Rule 4 — per-participant prior-vote check.
  const priorVote = findParticipantVoteOnProposal(
    projection,
    action.proposalEventId,
    action.requester,
  );
  if (action.vote === 'agree') {
    if (priorVote === 'agree') {
      return {
        ok: false,
        reason: 'already-voted',
        detail: `vote: requester ${action.requester} has already voted 'agree' on proposal ${action.proposalEventId}`,
      };
    }
    // No prior vote or prior 'dispute' → accept (dispute→agree switch).
  } else if (action.vote === 'dispute') {
    if (priorVote === 'dispute') {
      return {
        ok: false,
        reason: 'already-voted',
        detail: `vote: requester ${action.requester} has already voted 'dispute' on proposal ${action.proposalEventId}`,
      };
    }
    // No prior vote or prior 'agree' → accept (agree→dispute switch).
  } else if (action.vote === 'withdraw') {
    if (priorVote !== 'agree') {
      const observed =
        priorVote === null ? 'no prior vote' : `prior vote was '${priorVote}', not 'agree'`;
      return {
        ok: false,
        reason: 'no-prior-agree',
        detail: `vote: cannot withdraw from proposal ${action.proposalEventId} — withdrawal requires a prior 'agree' from ${action.requester} (${observed})`,
      };
    }
  }

  // Valid — emit one vote event.
  const event: EventToAppendEnvelope<'vote'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence,
    kind: 'vote',
    actor: action.actor,
    payload: {
      proposal_id: action.proposalEventId,
      participant: action.requester,
      vote: action.vote,
      voted_at: action.votedAt,
    },
    createdAt: action.createdAt,
  };
  return { ok: true, events: [event] };
};

export default voteHandler;
