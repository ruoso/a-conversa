// `vote` action handler — the real write-side validator for the two
// vote arms (`agree` / `dispute`). Per ADR 0030 §3 +
// `pf_facet_keyed_vote_payload` + `pf_unit_test_audit`: the legacy
// `'withdraw'` choice arm is retired (withdrawal is its own first-
// class event kind, `withdraw-agreement`, handled by
// `apps/server/src/ws/handlers/withdraw-agreement.ts`).
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
//      - `committed` (any arm) → `'proposal-already-committed'`. No
//        further votes are accepted on a committed proposal; the
//        `withdraw-agreement` event kind owns the post-commit
//        withdrawal gesture per ADR 0030 §3.
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
//
// **Structural-sub-kind boundary.** For the seven structural sub-kinds
// (`decompose`, `interpretive-split`, `axiom-mark`, `meta-move`,
// `break-edge`, `amend-node`, `annotate`), `findParticipantVoteOnProposal`
// returns `null` — no per-facet vote tracking exists on the projection
// for these. The rule-4 check is short-circuited as "no prior vote":
// `agree` / `dispute` accept. The per-sub-kind sibling tasks tighten
// this if they want different semantics.
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
// write. The post-commit withdrawal gesture lives on its own event
// kind (`withdraw-agreement`), handled by
// `apps/server/src/ws/handlers/withdraw-agreement.ts`.

import type { Projection } from '../../projection/index.js';
import { deriveFacetStatus } from '../../projection/facet-status.js';
import type { FacetName, FacetState } from '../../projection/types.js';
import { findProposal, requireParticipant } from '../primitives.js';
import type { EventToAppendEnvelope, ValidationResult, Validator, VoteAction } from '../types.js';

// Facet-target resolution helper — looks up the `FacetState` for a
// `(entityKind, entityId, facet)` triple. Returns `null` if the entity
// or facet slot does not exist on the projection.
interface FacetTarget {
  entityKind: 'node' | 'edge' | 'annotation';
  entityId: string;
  facet: FacetName;
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
    // Per ADR 0030 §5 + `pf_shape_facet_wire_vote`: facet-keyed votes
    // may target the edge's `shape` facet directly (no v1 proposal
    // sub-kind produces a shape candidate via the proposal layer, but
    // wire-level vote envelopes targeting `(edge, 'shape')` are now
    // first-class and resolve to the edge's `shapeFacet`).
    if (target.facet === 'shape') return edge.shapeFacet;
    return null;
  }
  // entityKind === 'annotation' — per ADR 0038 §4, only an annotation's
  // `substance` facet is disputable (its `wording` *is* the content,
  // inline-agreed at creation; `classification`/`shape` never apply to
  // annotations). A vote naming any other facet on an annotation target
  // resolves to `null` here → `target-entity-not-found`. Mirrors the
  // annotation arm in `primitives.ts` / `commit.ts` (`getAnnotation`),
  // narrowed to `substance`.
  const annotation = projection.getAnnotation(target.entityId);
  if (!annotation) return null;
  if (target.facet === 'substance') return annotation.substanceFacet;
  return null;
}

export const voteHandler: Validator<VoteAction> = (
  projection: Projection,
  action: VoteAction,
): ValidationResult => {
  // Rule 1 — participant gate.
  const participant = requireParticipant(projection, action.requester);
  if (!participant.ok) return participant.rejection;

  // The handler dispatches by `action.target` mirroring the wire
  // envelope (per ADR 0030 §2 + §9). The facet arm names the
  // `(entity_kind, entity_id, facet)` triple directly — no proposal
  // lookup is needed because the methodology treats agreement as a
  // property of the facet itself. The proposal arm names a structural
  // proposal id (decompose / interpretive-split / etc.) where no facet
  // target exists.
  //
  // **Mixed-model intent (pinned by `pf_structural_handlers_unchanged`).**
  // Structural sub-kinds (`decompose`, `interpretive-split`, `axiom-mark`,
  // `annotate`, `meta-move`, `break-edge`) intentionally take the
  // proposal-keyed arm below; the two patterns coexist by design per
  // ADR 0030 §9. Do NOT facet-key a structural proposal's vote — the
  // pin tests at `apps/server/src/methodology/handlers/structural-target.test.ts`
  // will fail loudly if a future refactor flips a structural sub-kind
  // into the facet arm. See the refinement at
  // `tasks/refinements/per-facet-refactor/pf_structural_handlers_unchanged.md`.
  if (action.target === 'facet') {
    // ----- FACET-KEYED ARM ------------------------------------------
    //
    // The vote attaches to `(entityKind, entityId, facet)` directly.
    // Validation reads the facet's derived status — proposal-lifecycle
    // gates (committed / pending / meta-disagreement) are subsumed by
    // the facet-status rules (the projection's `handleCommit` /
    // `handleMetaDisagreementMarked` walk both arms; the facet's
    // status reflects whichever event last touched it).
    //
    // **Why no proposal lookup.** Some facets enter life with an
    // inline candidate that is NOT driven by a proposal targeting that
    // facet — an edge's `shape` facet is seeded inline on
    // `edge-created` per ADR 0030 §5; the `wording` facet's candidate
    // rides inline on `node-created` for `capture-node`. The
    // pre-refactor handler required a `proposalEventId` and rejected
    // votes on inline-seeded facets with `proposal-not-found`. Reading
    // the facet directly removes that asymmetry.
    const target = {
      entityKind: action.entityKind,
      entityId: action.entityId,
      facet: action.facet,
    };
    const facet = facetStateForTarget(projection, target);
    if (facet === null) {
      return {
        ok: false,
        reason: 'target-entity-not-found',
        detail: `vote: ${target.entityKind} ${target.entityId} (facet ${target.facet}) is not present in the projection`,
      };
    }

    // **Post-commit legality diverges for annotations (ADR 0038 §3).**
    // An annotation's `substance` facet is commentary any participant may
    // contest at any time: a `dispute` (or a later re-`agree`) is legal
    // regardless of the facet's derived lifecycle status — that is the
    // whole point of the disputable-annotation seam. node/edge facets, by
    // contrast, reject votes once `committed` (re-opened only via the
    // dedicated `withdraw-agreement` event, → `withdrawn`). The annotation
    // substance facet carries no proposed *value* on the server projection
    // (it is seeded `emptyFacet()` at `annotation-created` and is never
    // marked committed server-side — the `disputed` rollup is computed
    // client-side by the shell's `computeFacetStatuses`, Decision §7), so
    // it derives to `'awaiting-proposal'` here; the node/edge lifecycle
    // gate below would wrongly reject it. Skipping that gate for
    // annotations is what lets a committed annotation reach `disputed`.
    // Do NOT apply the node/edge committed-facet rejection to annotations
    // — that is an ADR-0038-superseding change. The per-participant
    // already-voted guard below still applies (no double-dispute /
    // double-agree).
    if (target.entityKind !== 'annotation') {
      const status = deriveFacetStatus(
        projection,
        target.entityKind,
        target.entityId,
        target.facet,
      );

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
          detail: `vote: facet ${target.entityKind}:${target.entityId}/${target.facet} is committed; only 'withdraw-agreement' is legal on a committed facet`,
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
    }

    // Per-participant prior-vote check against the FACET. The facet's
    // `perParticipant` map is the canonical record for facet-keyed
    // votes; multiple proposals touching the same facet over time
    // share the same map (cleared when a fresh candidate lands per
    // ADR 0030 §7).
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
  if (found.state === 'committed') {
    // Per ADR 0030 §3 + `pf_unit_test_audit`: the wire `vote.choice`
    // enum is `'agree' | 'dispute'`; the legacy `'withdraw'` arm is
    // retired. Any vote arm on a committed proposal is rejected here
    // (the dedicated `withdraw-agreement` event kind owns the legal
    // withdraw path).
    return {
      ok: false,
      reason: 'proposal-already-committed',
      detail: `vote: proposal ${action.proposalEventId} was committed at ${found.record.committedAt}; no further votes are accepted (withdrawal is the 'withdraw-agreement' event kind)`,
    };
  }

  // Rule 4 — per-participant prior-vote check. For structural sub-
  // kinds, prior votes live on `pending.perParticipantVotes` (the
  // facet-target helper returns `null` for structural sub-kinds; the
  // legacy `findParticipantVoteOnProposal` is consequently null here).
  // Read directly from the pending proposal's vote map for structural
  // arms.
  let priorVote: 'agree' | 'dispute' | null = null;
  if (found.state === 'pending') {
    const rec = found.record.perParticipantVotes.get(action.requester);
    priorVote = rec?.vote ?? null;
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
  }

  const choice = action.vote;
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
