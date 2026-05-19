// `commit` action handler — the real write-side validator.
//
// Refinement: tasks/refinements/data-and-methodology/commit_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.commit_logic
//
// **What this handler enforces** (per docs/methodology.md, lines
// 15–25 — the commit step):
//
//   1. **Moderator gate.** Only the session's moderator may commit.
//      → `'not-a-moderator'` (or `'not-a-participant'` if the requester
//      is not joined at all; unreachable in practice because the
//      universal participant gate in `validateAction` already filtered).
//   2. **Proposal exists.** The proposal id must reference a known
//      proposal in any of the three projection state buckets.
//      → `'proposal-not-found'`.
//   3. **Proposal is pending.** It must still be live (not already
//      committed, not in meta-disagreement). → `'proposal-already-committed'`
//      or `'proposal-already-meta-disagreement'`.
//   4. **Unanimous agree across current participants.** For the four
//      facet-targeting proposal sub-kinds (`classify-node`,
//      `set-node-substance`, `set-edge-substance`, `edit-wording`), the
//      affected facet's `perParticipant` map must contain a record for
//      every current participant (`left_at IS NULL`) and every record's
//      `vote` must be `'agree'`. → `'unanimous-agree-required'`.
//
// **Structural-sub-kind boundary.** `decompose`, `interpretive-split`,
// `axiom-mark`, `meta-move`, `break-edge`, `amend-node`, `annotate` —
// these sub-kinds don't have per-participant vote state on the
// projection (the projection's `handleVote` only writes to `perParticipant`
// for the four facet-targeting sub-kinds). `commit_logic` doesn't know
// where the per-participant agreement state lives for them; their
// sibling tasks (`decomposition_logic`, `axiom_mark_logic`, etc.) will
// register tighter handling as they land. For now, commit-of-structural-
// sub-kind is rejected with `'illegal-state-transition'` and a
// sub-kind-naming `detail`. This is the only boundary commit_logic
// has to draw inside its rule set.
//
// **Participant-leaves-after-voting semantics.** A participant who left
// no longer counts toward rule 4 — neither in the unanimity requirement
// nor in the agreement tally. The handler walks `currentParticipants`
// (left participants are excluded by construction); for each it asserts
// a `perParticipant` record with vote `'agree'`. A participant who
// agreed and then left does not block the commit; their prior agreement
// is preserved in the per-participant map but not consulted. This stays
// consistent with `deriveFacetStatus` rule 2 (read-side filtering by
// current participants).
//
// **Moderator-excluded-from-unanimity-walk semantics.** Per
// `docs/methodology.md` § "The commit step" (lines 15–25): the
// moderator's role is structural, not interpretive — "They don't
// decide whether agreement has been reached on the merits; they enact
// it once participants have expressed it." The **commit IS the
// moderator's act of agreement**; there is no separate moderator vote
// to consult. The rule-4 walk therefore filters
// `currentParticipants()` to NON-moderator participants ("only
// debaters vote"), mirroring the client-side `deriveCurrentParticipants`
// predicate (`apps/moderator/src/graph/proposalFacets.ts`, Decision
// §1.a). Without this filter, a moderator's commit click is rejected
// with `'unanimous-agree-required'` listing the moderator as the
// missing voter even after every debater has voted agree — the
// methodology's commit step is unreachable on the live wire. The
// projection-level `currentParticipants()` shape is unchanged (other
// callers consume every joined participant including the moderator);
// the filter is at this one callsite only.
//
// **Boundary with `replay.ts/handleCommit`.** This handler is the
// **write-side** gate (does the request pass methodology rules?).
// `handleCommit` (in `apps/server/src/projection/replay.ts`) is the
// **read-side** application that runs AFTER the API layer appends the
// event this handler emits: it sets the facet value, marks the facet
// `agreed`, moves the proposal from `pendingProposals` to
// `committedProposals`, and stamps the facet's
// `committedProposalEventId` + `committedAt`. The two layers are
// independent codepaths but compute the same predicate (unanimous-agree
// across current participants) and stay in sync by construction — rule
// 4 of this handler is the same predicate `deriveFacetStatus` rule 6
// evaluates on the read side.

import type { Projection } from '../../projection/index.js';
import type { FacetName, FacetState } from '../../projection/index.js';
import type { ProposalPayload } from '@a-conversa/shared-types';
import { findProposal, requireModerator } from '../primitives.js';
import type {
  CommitAction,
  EventToAppendEnvelope,
  RejectedValidationResult,
  ValidationResult,
  Validator,
} from '../types.js';

// ---------------------------------------------------------------
// Facet-target resolution.
//
// Mirrors the private `facetTargetForProposal` / `facetStateForTarget`
// helpers in `replay.ts`. Duplicated here intentionally: those helpers
// are projection-private and resolving facets is a write-side need for
// the rule-4 unanimity walk. If a future refactor extracts them into a
// shared module, both call sites can switch.
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

// ---------------------------------------------------------------
// Rule 4 — unanimous agree across current participants.
//
// Returns `null` on success (rule satisfied), or a `Rejected` carrying
// `'unanimous-agree-required'` with a `detail` that enumerates which
// participants are still missing / are voting non-agree. The detail
// is for surfacing to the requester so the moderator's UI can show
// "still waiting on Alice and Bob" rather than just "rejected".
// ---------------------------------------------------------------

function checkUnanimousAgree(
  projection: Projection,
  proposalPayload: ProposalPayload,
): RejectedValidationResult | null {
  const target = facetTargetForProposal(proposalPayload);
  if (target === null) {
    // Structural sub-kind — deferred to a sibling. See file header.
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `commit of proposal sub-kind '${proposalPayload.kind}' is deferred to the sibling methodology-engine task for that sub-kind; commit_logic does not validate per-participant agreement for non-facet-targeting sub-kinds`,
    };
  }

  const facet = facetStateForTarget(projection, target);
  if (facet === null) {
    // The pending proposal references an entity that isn't on the
    // projection. That would be a projection invariant violation
    // (`handleProposal` doesn't validate the target exists), but if
    // it ever happens, surface a clear typed rejection rather than
    // a NPE downstream.
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `commit: target entity ${target.entityKind}:${target.entityId} for facet '${target.facet}' is not present on the projection`,
    };
  }

  // Filter out the moderator: per `docs/methodology.md` § "The commit
  // step", commit IS the moderator's act of agreement, so the
  // moderator is structurally excluded from the per-participant vote
  // walk. Mirrors `deriveCurrentParticipants` on the client side
  // (`apps/moderator/src/graph/proposalFacets.ts`, Decision §1.a).
  const current = projection.currentParticipants().filter((p) => p.role !== 'moderator');
  if (current.length === 0) {
    // No current non-moderator participants — the agreement rule has
    // nothing to satisfy from voters. A session with only a moderator
    // (no debaters) has no per-participant agreement to record; reject
    // with the unanimity reason so the moderator sees a typed signal
    // rather than committing into a vacuum.
    return {
      ok: false,
      reason: 'unanimous-agree-required',
      detail:
        "commit: no current non-moderator participants to evaluate agreement against (the moderator is excluded from the unanimity walk; commit is the moderator's act of agreement)",
    };
  }

  const missing: string[] = [];
  const nonAgree: { participant: string; vote: string }[] = [];
  for (const p of current) {
    const record = facet.perParticipant.get(p.userId);
    if (!record) {
      missing.push(p.userId);
      continue;
    }
    if (record.vote !== 'agree') {
      nonAgree.push({ participant: p.userId, vote: record.vote });
    }
  }

  if (missing.length === 0 && nonAgree.length === 0) {
    return null;
  }

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing votes from: ${missing.join(', ')}`);
  }
  if (nonAgree.length > 0) {
    parts.push('non-agree votes: ' + nonAgree.map((x) => `${x.participant}=${x.vote}`).join(', '));
  }
  return {
    ok: false,
    reason: 'unanimous-agree-required',
    detail: `commit requires every current participant to have voted agree on the proposal — ${parts.join('; ')}`,
  };
}

// ---------------------------------------------------------------
// The validator.
// ---------------------------------------------------------------

export const commitHandler: Validator<CommitAction> = (
  projection: Projection,
  action: CommitAction,
): ValidationResult => {
  // Rule 1 — moderator gate.
  const moderator = requireModerator(projection, action.requester);
  if (!moderator.ok) return moderator.rejection;

  // Rule 2 — proposal exists. Rule 3 — proposal is pending.
  const found = findProposal(projection, action.proposalEventId);
  if (found === null) {
    return {
      ok: false,
      reason: 'proposal-not-found',
      detail: `commit: proposal ${action.proposalEventId} is not known to this session`,
    };
  }
  if (found.state === 'committed') {
    return {
      ok: false,
      reason: 'proposal-already-committed',
      detail: `commit: proposal ${action.proposalEventId} has already been committed at ${found.record.committedAt}`,
    };
  }
  if (found.state === 'meta-disagreement') {
    return {
      ok: false,
      reason: 'proposal-already-meta-disagreement',
      detail: `commit: proposal ${action.proposalEventId} has been marked as meta-disagreement at ${found.record.markedAt}`,
    };
  }

  // Rule 4 — unanimous agree across current participants.
  const unanimityRejection = checkUnanimousAgree(projection, found.record.payload);
  if (unanimityRejection !== null) return unanimityRejection;

  // Valid — emit one commit event.
  const event: EventToAppendEnvelope<'commit'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence,
    kind: 'commit',
    actor: action.actor,
    payload: {
      proposal_id: action.proposalEventId,
      moderator: action.requester,
      committed_at: action.committedAt,
    },
    createdAt: action.createdAt,
  };
  return { ok: true, events: [event] };
};

export default commitHandler;
