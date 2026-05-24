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
    case 'capture-node':
      // Per ADR 0030 §1 + §4 + `pf_mod_node_card_classification_affordance`:
      // `capture-node` names the wording-facet candidate inline. The
      // shared facet-target helper threads through the same wording-
      // mapping as the vote / commit / mark handlers above.
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
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

// ---------------------------------------------------------------
// `proposalHasAnyDispute` — does any participant have a `dispute`
// vote on the affected facet, referencing this specific proposal id?
//
// Used by `meta_disagreement_logic` to enforce the "methodology-not-
// exhausted" gate: meta-disagreement is the methodology's last resort
// (per `docs/methodology.md` line 208) and is meaningful only when
// there is an actual stuck point. A proposal with no recorded dispute
// has not been engaged with as a contest and cannot be marked.
//
// Returns:
//
//   - `true` if any `perParticipant` record on the affected facet has
//     vote `'dispute'` AND `proposalEventId === proposalEventId` (the
//     record's `proposalEventId` field is the ground truth for "which
//     proposal does this recorded vote refer to," since the per-
//     participant map is overwritten on re-vote);
//   - `false` if the proposal isn't found, the sub-kind is structural
//     (no per-facet vote tracking), the affected facet's target
//     entity isn't on the projection, or no dispute record matches.
//
// Walks historical records (including those from participants who
// have since left the session). Rationale: the dispute *did* happen
// — the proposal was contested at some point — and the "is this
// stuck?" signal is the historical fact, not the current-participant
// fact. (See the refinement's "Participant-leaves semantics" decision
// for why this differs from `commit_logic` rule 4's current-only walk.)
// ---------------------------------------------------------------

export function proposalHasAnyDispute(projection: Projection, proposalEventId: string): boolean {
  const found = findProposal(projection, proposalEventId);
  if (found === null) return false;
  const target = facetTargetForProposal(found.record.payload);
  if (target === null) return false; // structural sub-kind — no per-facet vote tracking
  const facet = facetStateForTarget(projection, target);
  if (facet === null) return false;
  for (const record of facet.perParticipant.values()) {
    if (record.vote === 'dispute' && record.proposalEventId === proposalEventId) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------
// `proposalSubKind` — return the proposal's `kind` discriminator, or
// `null` if the proposal isn't found.
//
// Used by `meta_disagreement_logic` to format the
// `'illegal-state-transition'` rejection detail when a mark targets a
// structural sub-kind (a `decompose`, `axiom-mark`, etc. proposal).
// Same lookup as `findProposal` followed by a `.payload.kind` read;
// extracted as a primitive because the handler needs only the kind
// string, not the full record.
// ---------------------------------------------------------------

export function proposalSubKind(projection: Projection, proposalEventId: string): string | null {
  const found = findProposal(projection, proposalEventId);
  if (found === null) return null;
  return found.record.payload.kind;
}

// ---------------------------------------------------------------
// `proposalTargetsFacet` — does the proposal target one of the four
// per-facet sub-kinds (`classify-node` / `set-node-substance` /
// `set-edge-substance` / `edit-wording`)?
//
// Convenience predicate for handlers that need to distinguish the
// facet-targeting sub-kinds from the structural sub-kinds without
// re-implementing the discriminator switch.
// ---------------------------------------------------------------

export function proposalTargetsFacet(projection: Projection, proposalEventId: string): boolean {
  const found = findProposal(projection, proposalEventId);
  if (found === null) return false;
  return facetTargetForProposal(found.record.payload) !== null;
}

// ---------------------------------------------------------------
// `nodeIsVisible` — does the projection have a visible node with this id?
//
// Used by `decomposition_logic` (rule 2 of `validateDecomposeProposal`)
// and by the future `interpretive_split_logic` (same predicate — an
// interpretive-split also requires a visible parent). The check mirrors
// the visible-graph derivation in `docs/data-model.md` lines 273–285:
// a node is "currently visible" iff `projection.getNode(nodeId)` returns
// a record with `visible === true`. Per the read-side projection
// (`apps/server/src/projection/projection.ts`), `visible` is flipped to
// `false` by `applyCommittedProposal` when a `decompose`,
// `interpretive-split`, or `edit-wording(restructure)` against this node
// commits — so this predicate is exactly the supersession check.
//
// Returns `false` for unknown node ids; callers that need to distinguish
// "doesn't exist" from "exists but not visible" should call
// `projection.getNode(nodeId)` directly.
// ---------------------------------------------------------------

export function nodeIsVisible(projection: Projection, nodeId: string): boolean {
  const node = projection.getNode(nodeId);
  return node !== undefined && node.visible === true;
}

// ---------------------------------------------------------------
// `edgeIsVisible` — does the projection have a visible edge with this id?
//
// Used by `meta_move_logic` (rule 2 of `validateMetaMoveProposal` when
// the target is an edge — a meta-move on an invisible edge would attach
// an annotation to an entity nobody can see). The check mirrors the
// visible-graph derivation in `docs/data-model.md`: an edge is
// "currently visible" iff `projection.getEdge(edgeId)` returns a record
// with `visible === true`. Per the read-side projection, `visible` is
// flipped to `false` by `applyCommittedProposal` when a `break-edge`
// against this edge commits (and parallels the node case for
// supersession).
//
// Returns `false` for unknown edge ids; callers that need to
// distinguish "doesn't exist" from "exists but not visible" should call
// `projection.getEdge(edgeId)` directly. The dual of `nodeIsVisible`.
// ---------------------------------------------------------------

export function edgeIsVisible(projection: Projection, edgeId: string): boolean {
  const edge = projection.getEdge(edgeId);
  return edge !== undefined && edge.visible === true;
}

// ---------------------------------------------------------------
// `hasAxiomMark` — does the projection have a committed axiom-mark on
// `nodeId` for `participantId`?
//
// Used by `axiom_mark_logic` (rule 4 of `validateAxiomMarkProposal`).
// Wraps the per-(node, participant) lookup the projection's
// `applyCommittedProposal` axiom-mark arm populates: when an
// axiom-mark proposal commits, `replay.ts` writes an entry to
// `node.axiomMarks[participant]`. The predicate asks "is there
// already a committed entry for this pair?"
//
// Returns `false` for unknown node ids; callers that need to
// distinguish "doesn't exist" from "exists but unmarked" should call
// `projection.getNode(nodeId)` directly and inspect `axiomMarks`.
// Returns `true` iff the node is present AND its `axiomMarks` map
// contains `participantId`.
//
// Per-participant uniqueness model (per docs/data-model.md line 38):
// the check is keyed on `(node, participant)`. Anna's mark on N9 does
// not block Ben from also marking N9 — both are independent personal
// declarations of bedrock and both may coexist.
//
// Reads committed marks only. A pending axiom-mark proposal does NOT
// show up here (pending proposals don't write to `axiomMarks`). The
// duplicate-check is "have you already had a commit land?" — a
// second propose for an already-pending mark by the same participant
// is harmless and short-circuited later by the vote / commit cycle.
// See `axiom_mark_logic.md` "Decisions" for the rationale.
// ---------------------------------------------------------------

export function hasAxiomMark(
  projection: Projection,
  nodeId: string,
  participantId: string,
): boolean {
  const node = projection.getNode(nodeId);
  if (node === undefined) return false;
  return node.axiomMarks.has(participantId);
}

// ---------------------------------------------------------------
// `findConflictingProposalAgainst` — find a pending proposal of a
// configured set of sub-kinds that targets the same node.
//
// Used by the propose handler's `decompose` arm (refinement:
// decomposition_logic), its `interpretive-split` arm (refinement:
// interpretive_split_logic), its `edit-wording` arm (refinement:
// reword_vs_restructure), AND its `amend-node` arm (refinement:
// amend_node_logic) to enforce the mutual-exclusion rule. The four
// node-touching structural sub-kinds (`decompose`,
// `interpretive-split`, `edit-wording`, `amend-node`) all compete on
// the same node:
//
//   - `decompose` and `interpretive-split` flip `parent.visible =
//     false` on commit (the parent becomes superseded).
//   - `edit-wording` with `edit_kind: restructure` flips
//     `oldNode.visible = false` on commit (also supersession).
//   - `edit-wording` with `edit_kind: reword` updates the wording
//     facet in place but still owns that facet exclusively while
//     pending.
//   - `amend-node` updates the wording facet in place — same
//     structural effect as reword, but driven by the contradiction-
//     resolution methodology path (per docs/methodology.md line 219).
//   Treating all four uniformly under the conflict walker keeps the
//   design symmetric — any pending wording-touching or supersession-
//   producing proposal blocks the others.
//
// Only one pending proposal among the four sub-kinds may target a
// given node at a time. All four arms pass the same conflicting-kinds
// set (`{'decompose', 'interpretive-split', 'edit-wording',
// 'amend-node'}`, canonicalized as the constant
// `CONFLICTING_PARENT_KINDS` in `propose.ts`); the set parameter is
// the explicit shape that makes the symmetry visible at the call site.
//
// Walks `projection.pendingProposals()` (not committed or
// meta-disagreed — same reasoning as the original
// `decomposeConflictsWith` rule: a *committed* structural proposal
// against the same node has already flipped `node.visible = false`,
// so the propose handler's node-visible rule catches that case
// structurally; a *meta-disagreement-marked* proposal isn't in flight
// any more) and returns the first pending proposal whose `payload.kind`
// is in `conflictingKinds` AND whose payload's target-node id matches
// `targetNodeId`. The target-node-id field name differs by sub-kind:
//
//   - `decompose` / `interpretive-split` → `payload.parent_node_id`.
//   - `edit-wording` (both inner kinds) → `payload.node_id`.
//   - `amend-node` → `payload.node_id`.
//
// The walker normalizes the lookup so callers pass a single "the node
// the new proposal is about" id regardless of how the conflicting
// candidate payload names its target.
//
// Returns `null` on no conflict.
//
// The narrow union type `'decompose' | 'interpretive-split' |
// 'edit-wording' | 'amend-node'` reflects the v1 set of node-touching
// structural sub-kinds. If a future sub-kind adopts the same node-
// targeting shape (e.g. a hypothetical merge-back operation), the
// union widens additively.
//
// The caller uses the returned proposal's `proposalEventId` and
// `payload.kind` in the rejection detail so the API layer can surface
// "wait for {kind} proposal {id} to resolve first" or "withdraw {id}
// before re-proposing."
// ---------------------------------------------------------------

export type ConflictingParentKind =
  | 'decompose'
  | 'interpretive-split'
  | 'edit-wording'
  | 'amend-node';

export function findConflictingProposalAgainst(
  projection: Projection,
  targetNodeId: string,
  conflictingKinds: ReadonlySet<ConflictingParentKind>,
): PendingProposal | null {
  for (const proposal of projection.pendingProposals()) {
    const payload = proposal.payload;
    if (payload.kind === 'decompose' || payload.kind === 'interpretive-split') {
      if (conflictingKinds.has(payload.kind) && payload.parent_node_id === targetNodeId) {
        return proposal;
      }
      continue;
    }
    if (payload.kind === 'edit-wording') {
      if (conflictingKinds.has(payload.kind) && payload.node_id === targetNodeId) {
        return proposal;
      }
      continue;
    }
    if (payload.kind === 'amend-node') {
      if (conflictingKinds.has(payload.kind) && payload.node_id === targetNodeId) {
        return proposal;
      }
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------
// `nodeIsPartyToAgreedContradicts` — does the projection contain a
// visible `contradicts` edge whose source or target is `nodeId`, and
// whose `substanceFacet` is in an agreed state (status `'agreed'` or
// `'committed'`, value `'agreed'`)?
//
// Used by the propose handler's `amend-node` arm (refinement:
// amend_node_logic) to enforce the contradiction-resolution
// prerequisite. Per docs/methodology.md lines 219 and 74, amend-node
// is specifically the contradiction-resolution path: "amend one [node]
// so the conflict no longer holds." Allowing an amend-node against a
// node that is not party to any agreed contradiction would let the
// methodology distinction collapse — participants would use amend-node
// for routine wording cleanups (which is what `edit-wording(reword)`
// is for). The strict reading per the refinement keeps the two
// operations semantically distinct.
//
// "Agreed" here means the contradicts edge's substance facet has been
// committed (status `'agreed'` or `'committed'` per the agreement-
// layer + facet-status-derivation widening in `FacetStatus`) AND the
// recorded value is `'agreed'`. The shape facet for edges is implicit
// — an edge exists in the projection only after its `edge-created`
// event lands; the role (`'contradicts'`) is fixed at creation. So
// the substance is the only facet that needs to be checked here.
//
// Walks `projection.edges()`. For each visible edge whose
// `role === 'contradicts'` and whose source or target equals `nodeId`,
// inspects `substanceFacet.status` (must be `'agreed'` or
// `'committed'`) AND `substanceFacet.value === 'agreed'`. Returns
// `true` on the first match; `false` if no matching edge is found.
//
// Returns `false` if `nodeId` doesn't reference any node — but the
// caller (rule 1 of `validateAmendNodeProposal`) is expected to have
// already rejected that case before reaching this check.
// ---------------------------------------------------------------

export function nodeIsPartyToAgreedContradicts(projection: Projection, nodeId: string): boolean {
  for (const edge of projection.edges()) {
    if (!edge.visible) continue;
    if (edge.role !== 'contradicts') continue;
    if (edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId) continue;
    const facet = edge.substanceFacet;
    const status = facet.status;
    const value = facet.value;
    if ((status === 'agreed' || status === 'committed') && value === 'agreed') {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------
// `findConflictingBreakEdgeProposal` — find a pending `break-edge`
// proposal that targets the same edge.
//
// Used by the propose handler's `break-edge` arm (refinement:
// break_edge_logic) to enforce edge-scoped mutual exclusion. Two
// pending break-edge proposals against the same edge would race on
// commit: the first to commit flips `edge.visible = false`; the second
// would then be against an already-broken edge. The propose-time check
// short-circuits the race.
//
// **Why a separate walker rather than generalizing
// `findConflictingProposalAgainst`.** The node-scoped walker
// normalizes across three node-targeting sub-kinds (`decompose`,
// `interpretive-split`, `edit-wording`) — its parametric
// `conflictingKinds` set is the shape that makes the symmetry visible.
// The edge-scoped case today has exactly one sub-kind (`break-edge`)
// addressing exactly one payload field (`edge_id`); adding an
// edge-side branch to the existing walker would mix node-targeting
// and edge-targeting concerns inside one function and require the
// caller to know which `conflictingKinds` set applies to which
// target-kind dimension. A second narrow walker is clearer. If a
// future edge-targeting sub-kind appears (none planned in v1), this
// walker generalizes additively the same way the node-scoped one
// did when `edit-wording` joined.
//
// Walks `projection.pendingProposals()` (not committed or
// meta-disagreed — same reasoning as the node-scoped walker: a
// committed break-edge has already flipped `edge.visible = false`, so
// the edge-visible rule catches that case structurally; a meta-
// disagreement-marked proposal isn't in flight any more) and returns
// the first pending proposal whose `payload.kind === 'break-edge'`
// AND whose `payload.edge_id` matches `edgeId`.
//
// Returns `null` on no conflict.
// ---------------------------------------------------------------

export function findConflictingBreakEdgeProposal(
  projection: Projection,
  edgeId: string,
): PendingProposal | null {
  for (const proposal of projection.pendingProposals()) {
    const payload = proposal.payload;
    if (payload.kind === 'break-edge' && payload.edge_id === edgeId) {
      return proposal;
    }
  }
  return null;
}
