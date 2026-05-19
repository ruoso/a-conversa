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
//   4. **Unanimous agree across current participants.** Every change
//      requires unanimous agreement (docs/methodology.md "Every change
//      to the graph requires agreement, regardless of what it is.").
//      The agreement source-of-truth differs by sub-kind:
//        - For the four facet-targeting sub-kinds (`classify-node`,
//          `set-node-substance`, `set-edge-substance`, `edit-wording`),
//          the projection's `handleVote` populates the affected facet's
//          `perParticipant` map — rule 4 walks it.
//        - For the structural sub-kinds (`decompose`,
//          `interpretive-split`, `axiom-mark`, `meta-move`, `break-edge`,
//          `amend-node`, `annotate`), no facet target exists; instead
//          `handleVote` populates the pending proposal's
//          `perParticipantVotes` map and rule 4 walks that. Axiom-mark
//          is special: the participant whose bedrock is being marked
//          doesn't vote on it (their proposal IS the declaration; "we
//          all agree that *this participant* holds this node as bedrock"
//          — docs/methodology.md "Axioms"). The unanimity walk excludes
//          the declared participant from the required set for
//          axiom-mark only.
//      → `'unanimous-agree-required'`.
//
// **Per-sub-kind event emission on commit.** For most sub-kinds the
// handler emits exactly one `commit` event; the projection's
// `applyCommittedProposal` arm applies the structural effect on its
// own. For `annotate` the handler additionally emits an
// `annotation-created` event paired with the commit so the annotation
// entity lands on the projection (the annotation id is freshly minted
// at commit time; pre-commit no annotation entity exists). All emitted
// events are appended in order by the WS layer; the projection's
// incremental `applyEvent` processes the `annotation-created` BEFORE
// the `commit` so `handleCommit`'s `applyCommittedProposal` finds the
// annotation in place when needed.
//
// **Participant-leaves-after-voting semantics.** A participant who left
// no longer counts toward rule 4 — neither in the unanimity requirement
// nor in the agreement tally. The handler walks `currentParticipants`
// (left participants are excluded by construction); for each it asserts
// a `perParticipant` record with vote `'agree'`. A participant who
// agreed and then left does not block the commit; their prior agreement
// is preserved in the per-participant map but not consulted.
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
// event this handler emits: it sets the facet value (for facet-
// targeting sub-kinds), flips parent visibility / records axiom marks
// (for structural sub-kinds), and moves the proposal from
// `pendingProposals` to `committedProposals`. The two layers are
// independent codepaths but compute the same predicate (unanimous-agree
// across current participants) and stay in sync by construction.

import { randomUUID } from 'node:crypto';

import type { Projection } from '../../projection/index.js';
import type { FacetName, FacetState } from '../../projection/index.js';
import type { ProposalPayload } from '@a-conversa/shared-types';
import { findProposal, requireModerator } from '../primitives.js';
import type {
  CommitAction,
  EventToAppend,
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
// Rule 4 — unanimous agree across current participants (facet-targeting
// sub-kinds variant).
//
// Returns `null` on success (rule satisfied), or a `Rejected` carrying
// `'unanimous-agree-required'` with a `detail` that enumerates which
// participants are still missing / are voting non-agree. The detail
// is for surfacing to the requester so the moderator's UI can show
// "still waiting on Alice and Bob" rather than just "rejected".
// ---------------------------------------------------------------

function checkUnanimousAgreeFacet(
  projection: Projection,
  proposalPayload: ProposalPayload,
  target: FacetTarget,
): RejectedValidationResult | null {
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
  void proposalPayload;
  return {
    ok: false,
    reason: 'unanimous-agree-required',
    detail: `commit requires every current participant to have voted agree on the proposal — ${parts.join('; ')}`,
  };
}

// ---------------------------------------------------------------
// Rule 4 — unanimous agree across current participants (structural
// sub-kinds variant).
//
// Walks the pending proposal's `perParticipantVotes` map instead of a
// facet's `perParticipant` map. Same enumeration shape — missing /
// non-agree — so the requester's UI can render the same wait-on message.
//
// **Axiom-mark exclusion.** Per docs/methodology.md: "Agreement on an
// axiom mark is roughly: 'we all agree that this participant holds
// this node as bedrock for this debate'." The participant whose bedrock
// is being declared is the proposer; their proposal IS the declaration
// (`validateAxiomMarkProposal` rule 3 enforces `proposal.participant ===
// action.requester`). They are excluded from the required-voters set
// here — only the other current participants need to vote agree. All
// other structural sub-kinds require every current participant
// (including the proposer) to vote.
// ---------------------------------------------------------------

function checkUnanimousAgreeStructural(
  projection: Projection,
  proposalPayload: ProposalPayload,
  perParticipantVotes: ReadonlyMap<string, { vote: string }>,
): RejectedValidationResult | null {
  // Filter out the moderator: per `docs/methodology.md` § "The commit
  // step", commit IS the moderator's act of agreement, so the
  // moderator is structurally excluded from the per-participant vote
  // walk (mirrors `checkUnanimousAgreeFacet` for facet-bearing sub-
  // kinds + the client's `deriveCurrentParticipants` predicate).
  const current = projection.currentParticipants().filter((p) => p.role !== 'moderator');
  if (current.length === 0) {
    return {
      ok: false,
      reason: 'unanimous-agree-required',
      detail:
        "commit: no current non-moderator participants to evaluate agreement against (the moderator is excluded from the unanimity walk; commit is the moderator's act of agreement)",
    };
  }

  // Axiom-mark: the declared participant doesn't vote separately on
  // their own bedrock declaration — the proposal IS the declaration.
  const excludedParticipant =
    proposalPayload.kind === 'axiom-mark' ? proposalPayload.participant : null;

  const missing: string[] = [];
  const nonAgree: { participant: string; vote: string }[] = [];
  for (const p of current) {
    if (p.userId === excludedParticipant) continue;
    const record = perParticipantVotes.get(p.userId);
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
// Per-sub-kind structural event emission on commit.
//
// Most sub-kinds emit nothing beyond the `commit` envelope itself —
// the projection's `applyCommittedProposal` arm applies the structural
// effect (parent invisibility, axiom-mark recording, etc.) directly on
// the receiving side.
//
// `annotate` is the exception: the annotation entity has its own
// lifecycle (its own visibility, its own facets) and so requires a
// matching `annotation-created` event on the log. The id is minted at
// commit time (pre-commit no annotation entity exists). The event
// precedes the `commit` envelope in the returned list so the
// projection's incremental `applyEvent` sees the annotation lands
// BEFORE the `handleCommit` arm runs.
// ---------------------------------------------------------------

function buildStructuralEventsForCommit(
  proposalPayload: ProposalPayload,
  action: CommitAction,
): EventToAppend[] {
  const events: EventToAppend[] = [];
  if (proposalPayload.kind === 'annotate') {
    const annotationCreated: EventToAppendEnvelope<'annotation-created'> = {
      id: randomUUID(),
      sessionId: action.sessionId,
      sequence: action.sequence + events.length,
      kind: 'annotation-created',
      actor: action.actor,
      payload: {
        annotation_id: randomUUID(),
        kind: proposalPayload.annotation_kind,
        content: proposalPayload.content,
        target_node_id: proposalPayload.target_kind === 'node' ? proposalPayload.target_id : null,
        target_edge_id: proposalPayload.target_kind === 'edge' ? proposalPayload.target_id : null,
        created_by: action.requester,
        created_at: action.createdAt,
      },
      createdAt: action.createdAt,
    };
    events.push(annotationCreated);
  }
  return events;
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

  // Rule 4 — unanimous agree across current participants. Dispatch on
  // facet-targeting vs structural sub-kind (the agreement source
  // differs; see header comment).
  const proposalPayload = found.record.payload;
  const target = facetTargetForProposal(proposalPayload);
  let unanimityRejection: RejectedValidationResult | null;
  if (target !== null) {
    unanimityRejection = checkUnanimousAgreeFacet(projection, proposalPayload, target);
  } else {
    unanimityRejection = checkUnanimousAgreeStructural(
      projection,
      proposalPayload,
      found.record.perParticipantVotes,
    );
  }
  if (unanimityRejection !== null) return unanimityRejection;

  // Valid — emit the structural fan-out (if any) followed by the
  // `commit` envelope. The structural events take the leading
  // sequence slots; the commit envelope takes the last.
  const structuralEvents = buildStructuralEventsForCommit(proposalPayload, action);
  const commitEvent: EventToAppendEnvelope<'commit'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence + structuralEvents.length,
    kind: 'commit',
    actor: action.actor,
    payload: {
      proposal_id: action.proposalEventId,
      moderator: action.requester,
      committed_at: action.committedAt,
    },
    createdAt: action.createdAt,
  };
  return { ok: true, events: [...structuralEvents, commitEvent] };
};

export default commitHandler;
