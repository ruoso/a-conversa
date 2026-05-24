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

import type { ProposalPayload } from '@a-conversa/shared-types';

import type { Projection } from '../../projection/index.js';
import { deriveFacetStatus } from '../../projection/facet-status.js';
import type { FacetName, FacetState } from '../../projection/types.js';
import { findProposal, requireParticipant } from '../primitives.js';
import type { EventToAppendEnvelope, ValidationResult, Validator, VoteAction } from '../types.js';

// Facet-target resolution helper — mirrors the private helper in
// `primitives.ts` (kept local rather than re-exported to avoid a wider
// surface change; a future shared-helper refactor would extract both).
// Returns the `(entity_kind, entity_id, facet)` triple for the four
// facet-valued proposal sub-kinds; `null` for the seven structural
// sub-kinds.
interface FacetTarget {
  entityKind: 'node' | 'edge';
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
  // entityKind === 'edge'
  const edge = projection.getEdge(target.entityId);
  if (!edge) return null;
  if (target.facet === 'substance') return edge.substanceFacet;
  return null;
}

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

  // The handler dispatches by proposal sub-kind: facet-valued proposals
  // emit `target: 'facet'` (per ADR 0030 §2 — votes attach to the
  // `(entity, facet)` pair, not to the proposal); structural proposals
  // continue to emit `target: 'proposal'` (per ADR 0030 §9 — structural
  // proposals have no facet target so votes attach to the proposal
  // envelope id).
  const target = facetTargetForProposal(found.record.payload);

  if (target !== null) {
    // ----- FACET-KEYED ARM (facet-valued sub-kinds) -----------------
    //
    // The vote attaches to the resolved `(entity_kind, entity_id,
    // facet)` triple. Validation reads the facet's derived status
    // directly — proposal-lifecycle gates (committed / pending /
    // meta-disagreement on the proposal record) are subsumed by the
    // facet-status rules (the projection's `handleCommit` /
    // `handleMetaDisagreementMarked` walk both arms; the facet's
    // status reflects whichever event last touched it).
    const facet = facetStateForTarget(projection, target);
    if (facet === null) {
      // The proposal references an entity/facet not present in the
      // projection — a projection-invariant violation given the
      // proposal landed against it. Treat as not-found rather than
      // throw so the wire surface reports a typed rejection.
      return {
        ok: false,
        reason: 'target-entity-not-found',
        detail: `vote: ${target.entityKind} ${target.entityId} (facet ${target.facet}) referenced by proposal ${action.proposalEventId} is not present in the projection`,
      };
    }

    const status = deriveFacetStatus(projection, target.entityKind, target.entityId, target.facet);

    // Per the refinement's Constraints / requirements: votable
    // statuses are `'proposed' | 'disputed'`. Every other status is
    // a refusal.
    //
    //   - 'committed'        — only `withdraw-agreement` is legal;
    //                          handled by the dedicated event kind.
    //   - 'agreed'           — unanimous; the moderator commits next;
    //                          no further votes change the state.
    //   - 'awaiting-proposal' — no candidate; "voting agrees with a
    //                          candidate" — without one the gesture
    //                          is ill-formed.
    //   - 'meta-disagreement' — escape-hatch state; the path out is
    //                          structural (decompose, axiom-mark),
    //                          not a fresh vote.
    //   - 'withdrawn'         — the facet is in a post-commit
    //                          withdrawn limbo; a new candidate must
    //                          land before votes resume.
    if (status === 'committed') {
      return {
        ok: false,
        reason: 'proposal-already-committed',
        detail: `vote: facet ${target.entityKind}:${target.entityId}/${target.facet} is committed (proposal ${action.proposalEventId} produced the committed candidate); only 'withdraw-agreement' is legal on a committed facet`,
      };
    }
    if (status === 'meta-disagreement') {
      return {
        ok: false,
        reason: 'proposal-already-meta-disagreement',
        detail: `vote: facet ${target.entityKind}:${target.entityId}/${target.facet} has been marked as meta-disagreement; no votes are accepted on meta-disagreed facets`,
      };
    }
    if (status === 'agreed' || status === 'awaiting-proposal' || status === 'withdrawn') {
      return {
        ok: false,
        reason: 'illegal-state-transition',
        detail: `vote: facet ${target.entityKind}:${target.entityId}/${target.facet} is in status '${status}' which does not accept votes (votable statuses are 'proposed' | 'disputed')`,
      };
    }
    // status ∈ {'proposed', 'disputed'} — votable.

    // Rule 4 — per-participant prior-vote check against the FACET
    // (not against the proposal). The facet's `perParticipant` map is
    // the canonical record for facet-keyed votes; multiple proposals
    // touching the same facet over time share the same map (cleared
    // when a fresh candidate lands per ADR 0030 §7).
    const prior = facet.perParticipant.get(action.requester);
    const priorVote = prior?.vote ?? null;
    if (action.vote === 'agree' && priorVote === 'agree') {
      return {
        ok: false,
        reason: 'already-voted',
        detail: `vote: requester ${action.requester} has already voted 'agree' on facet ${target.entityKind}:${target.entityId}/${target.facet}`,
      };
    }
    if (action.vote === 'dispute' && priorVote === 'dispute') {
      return {
        ok: false,
        reason: 'already-voted',
        detail: `vote: requester ${action.requester} has already voted 'dispute' on facet ${target.entityKind}:${target.entityId}/${target.facet}`,
      };
    }
    if (action.vote === 'withdraw') {
      // The `'withdraw'` arm on the vote envelope is deprecated per
      // ADR 0030 §3 — withdrawal is its own event kind
      // (`withdraw-agreement`). On the facet-keyed path the vote
      // schema's `choice` enum is `'agree' | 'dispute'`; a `withdraw`
      // reaching here is a programmer error (the WS-layer schema
      // still tolerates the value, but the methodology refuses).
      // `pf_withdraw_agreement_handler` migrates the wire path.
      return {
        ok: false,
        reason: 'illegal-state-transition',
        detail: `vote: 'withdraw' is no longer a valid vote choice for facet-keyed votes — use the withdraw-agreement event kind (proposal ${action.proposalEventId}, facet ${target.entityKind}:${target.entityId}/${target.facet})`,
      };
    }

    // action.vote is narrowed to 'agree' | 'dispute' here by the
    // earlier branch returning on 'withdraw'.
    const choice = action.vote;
    const event: EventToAppendEnvelope<'vote'> = {
      id: action.eventId,
      sessionId: action.sessionId,
      sequence: action.sequence,
      kind: 'vote',
      actor: action.actor,
      payload: {
        target: 'facet',
        entity_kind: target.entityKind,
        entity_id: target.entityId,
        facet: target.facet,
        participant: action.requester,
        choice,
        voted_at: action.votedAt,
      },
      createdAt: action.createdAt,
    };
    return { ok: true, events: [event] };
  }

  // ----- PROPOSAL-KEYED ARM (structural sub-kinds) ------------------
  //
  // The original proposal-state matrix + per-proposal vote check —
  // structural proposals retain proposal-keyed votes per ADR 0030 §9.

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

  // Rule 4 — per-participant prior-vote check. For structural sub-
  // kinds, prior votes live on `pending.perParticipantVotes` (the
  // facet-target helper returns `null` for structural sub-kinds; the
  // legacy `findParticipantVoteOnProposal` is consequently null here).
  // Read directly from the pending proposal's vote map for structural
  // arms.
  let priorVote: 'agree' | 'dispute' | 'withdraw' | null = null;
  if (found.state === 'pending') {
    const rec = found.record.perParticipantVotes.get(action.requester);
    priorVote = rec?.vote ?? null;
  } else if (found.state === 'committed') {
    // Post-commit withdraw path — read the committed proposal's prior
    // vote record. (The current shape doesn't carry it on the
    // committed-proposal record; structural proposals only support
    // commit / withdraw at moderator-only level today. Treat as null
    // — the withdraw path returns `'no-prior-agree'` below if needed.)
    priorVote = null;
  }
  if (action.vote === 'agree') {
    if (priorVote === 'agree') {
      return {
        ok: false,
        reason: 'already-voted',
        detail: `vote: requester ${action.requester} has already voted 'agree' on proposal ${action.proposalEventId}`,
      };
    }
  } else if (action.vote === 'dispute') {
    if (priorVote === 'dispute') {
      return {
        ok: false,
        reason: 'already-voted',
        detail: `vote: requester ${action.requester} has already voted 'dispute' on proposal ${action.proposalEventId}`,
      };
    }
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

  // The `'withdraw'` arm on the vote envelope is deprecated per ADR
  // 0030 §3 — the wire `choice` enum is `'agree' | 'dispute'`. The
  // structural-arm `withdraw` branch above remains so any legacy
  // caller is rejected with `'no-prior-agree'` rather than landing a
  // schema-invalid payload; the dedicated `withdraw-agreement` event
  // kind owns the legal withdraw path.
  const choice = action.vote as 'agree' | 'dispute';
  const event: EventToAppendEnvelope<'vote'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence,
    kind: 'vote',
    actor: action.actor,
    payload: {
      target: 'proposal',
      proposal_id: action.proposalEventId,
      participant: action.requester,
      choice,
      voted_at: action.votedAt,
    },
    createdAt: action.createdAt,
  };
  return { ok: true, events: [event] };
};

export default voteHandler;
