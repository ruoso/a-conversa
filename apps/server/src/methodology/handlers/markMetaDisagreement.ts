// `mark-meta-disagreement` action handler — the real write-side
// validator.
//
// Refinement: tasks/refinements/data-and-methodology/meta_disagreement_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.meta_disagreement_logic
//
// **What this handler enforces** (per docs/methodology.md lines
// 203–208 — the meta-disagreement fallback):
//
//   1. **Moderator gate.** Only the session's moderator may mark a
//      proposal as meta-disagreement.
//      → `'not-a-moderator'` (or `'not-a-participant'` if the requester
//      is not joined at all; unreachable in practice because the
//      universal participant gate in `validateAction` already filtered).
//   2. **Proposal exists.** The proposal id must reference a known
//      proposal in any of the three projection state buckets.
//      → `'proposal-not-found'`.
//   3. **Proposal is pending.** It must still be live (not already
//      committed, not already meta-disagreed). → `'proposal-already-committed'`
//      or `'proposal-already-meta-disagreement'`.
//   4. **Methodology-exhaustion gate (Option A — structural).** For the
//      four facet-targeting sub-kinds (`classify-node`,
//      `set-node-substance`, `set-edge-substance`, `edit-wording`), the
//      affected facet's `perParticipant` map must contain at least one
//      record with vote `'dispute'` and `proposalEventId === action.proposalEventId`.
//      A proposal with no recorded dispute is — by the methodology's
//      definition — not yet stuck; meta-disagreement is the last
//      resort *after* the methodology has run. → `'methodology-not-exhausted'`.
//
// **Methodology-exhaustion-gate semantics — Option A.** The refinement
// settles this as a structural check: require ≥1 recorded `'dispute'`
// on the affected facet. Rationale (excerpted from the refinement):
// `docs/methodology.md` line 208 says meta-disagreement is "a last
// resort; the methodology is designed so that decomposition resolves
// most cases before this fallback is needed" — that phrasing
// presupposes "an actual stuck point," and a proposal with no
// dispute is by definition not stuck. The "fuzzy" judgment about
// whether the methodology was *truly* exhausted (operationalization
// test? decomposition attempts?) is out of scope for the validator
// — those are UX-level prompts the moderator console may surface,
// not write-side gates. The validator's job is to refuse the
// *clearly-too-early* case; everything past "at least one dispute
// exists" is the moderator's call.
//
// **Structural-sub-kind boundary.** Same shape as `commit_logic`:
// `decompose` / `interpretive-split` / `axiom-mark` / `meta-move` /
// `break-edge` / `amend-node` / `annotate` don't have per-participant
// vote state on the projection (`handleVote` only writes to
// `perParticipant` for the four facet-targeting sub-kinds). The
// validator rejects mark attempts on structural sub-kinds with
// `'illegal-state-transition'` and a sub-kind-naming `detail`. The
// per-sub-kind sibling tasks (`decomposition_logic`, etc.) will
// tighten when they land — they may decide their sub-kind cannot be
// meta-disagreed at all, or that the dispute signal lives on a
// different projection structure.
//
// **Participant-leaves semantics.** `proposalHasAnyDispute` walks the
// facet's `perParticipant` map directly, which contains records from
// every participant who ever voted — including those who have since
// left the session. A `dispute` vote from a left participant **does**
// count toward the exhaustion gate. The dispute did happen; the
// methodology's "is this stuck?" signal is the historical fact, not
// the current-participant fact. This differs from `commit_logic` rule
// 4 (current-only walk for unanimity) because the two rules ask
// different questions — see the refinement's "Participant-leaves
// semantics" decision.
//
// **Boundary with `replay.ts/handleMetaDisagreementMarked`.** This
// handler is the **write-side** gate (does the request pass
// methodology rules?). `handleMetaDisagreementMarked` (in
// `apps/server/src/projection/replay.ts`) is the **read-side**
// application that runs AFTER the API layer appends the event this
// handler emits: it moves the proposal from `pendingProposals` to
// `unresolvedMetaDisagreements` and transitions the affected facet's
// status to `'meta-disagreement'`. The two layers are independent
// codepaths; the projection handler trusts that the methodology
// validator already gated the event.

import type { ProposalPayload } from '@a-conversa/shared-types';

import type { Projection } from '../../projection/index.js';
import type { FacetName } from '../../projection/index.js';
import { deriveFacetStatus } from '../../projection/facet-status.js';
import {
  findProposal,
  proposalHasAnyDispute,
  proposalSubKind,
  proposalTargetsFacet,
  requireModerator,
} from '../primitives.js';
import type {
  EventToAppendEnvelope,
  MarkMetaDisagreementAction,
  ValidationResult,
  Validator,
} from '../types.js';

// Facet-target resolution helper — mirrors the private helper in
// `primitives.ts` + `handlers/commit.ts` + `handlers/vote.ts`. Kept
// local rather than re-exported to avoid a wider surface change; a
// future shared-helper refactor would extract all call sites together.
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
    case 'capture-node':
      // Per ADR 0030 §1 + §4 + `pf_mod_node_card_classification_affordance`:
      // `capture-node` names the wording-facet candidate inline; a
      // proposal-keyed meta-disagreement-marked routes onto the wording
      // facet, symmetric with the vote / commit arms.
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

export const markMetaDisagreementHandler: Validator<MarkMetaDisagreementAction> = (
  projection: Projection,
  action: MarkMetaDisagreementAction,
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
      detail: `mark-meta-disagreement: proposal ${action.proposalEventId} is not known to this session`,
    };
  }
  if (found.state === 'committed') {
    return {
      ok: false,
      reason: 'proposal-already-committed',
      detail: `mark-meta-disagreement: proposal ${action.proposalEventId} has already been committed at ${found.record.committedAt}`,
    };
  }
  if (found.state === 'meta-disagreement') {
    return {
      ok: false,
      reason: 'proposal-already-meta-disagreement',
      detail: `mark-meta-disagreement: proposal ${action.proposalEventId} has already been marked as meta-disagreement at ${found.record.markedAt}`,
    };
  }

  // Rule 4 — methodology-exhaustion gate.
  //
  // For the structural sub-kinds, defer with the boundary rejection.
  // For the four facet-targeting sub-kinds, require ≥1 recorded
  // `'dispute'` on the affected facet.
  if (!proposalTargetsFacet(projection, action.proposalEventId)) {
    const kind = proposalSubKind(projection, action.proposalEventId);
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `mark-meta-disagreement of proposal sub-kind '${kind}' is deferred to the sibling methodology-engine task for that sub-kind; meta_disagreement_logic does not validate exhaustion for non-facet-targeting sub-kinds`,
    };
  }

  if (!proposalHasAnyDispute(projection, action.proposalEventId)) {
    return {
      ok: false,
      reason: 'methodology-not-exhausted',
      detail: `mark-meta-disagreement: proposal ${action.proposalEventId} has no recorded dispute on the affected facet — meta-disagreement is the methodology's last resort and is only meaningful when at least one participant has disputed the proposal`,
    };
  }

  // Facet-arm cross-check: the projection's facet-keyed
  // `handleMetaDisagreementMarked` arm does NOT remove the pending
  // proposal record (the mark hangs off the facet itself); only the
  // proposal-keyed arm does. A second mark on the same facet-valued
  // proposal therefore still finds the proposal as `pending` in
  // `findProposal` above — rule 3 cannot catch the duplicate. Read the
  // targeted facet's derived status directly: if it's already
  // `'meta-disagreement'` (a prior facet-keyed mark landed) or
  // `'committed'` / `'withdrawn'` (the facet's lifecycle has moved on),
  // refuse with the appropriate typed rejection before emitting.
  // Mirrors the cross-check pattern in `checkUnanimousAgreeFacet`
  // (`apps/server/src/methodology/handlers/commit.ts`) for the
  // analogous facet-arm second-commit gate.
  const target = facetTargetForProposal(found.record.payload);
  if (target !== null) {
    const status = deriveFacetStatus(projection, target.entityKind, target.entityId, target.facet);
    if (status === 'meta-disagreement') {
      return {
        ok: false,
        reason: 'proposal-already-meta-disagreement',
        detail: `mark-meta-disagreement: facet ${target.entityKind}:${target.entityId}/${target.facet} has already been marked as meta-disagreement (a prior facet-keyed mark landed)`,
      };
    }
    if (status === 'committed') {
      return {
        ok: false,
        reason: 'proposal-already-committed',
        detail: `mark-meta-disagreement: facet ${target.entityKind}:${target.entityId}/${target.facet} is already committed; meta-disagreement is not legal on a committed facet`,
      };
    }
    if (status === 'withdrawn') {
      return {
        ok: false,
        reason: 'illegal-state-transition',
        detail: `mark-meta-disagreement: facet ${target.entityKind}:${target.entityId}/${target.facet} is in status 'withdrawn' — a fresh candidate must land before meta-disagreement can be considered`,
      };
    }
  }

  // Valid — emit one meta-disagreement-marked event.
  //
  // Per ADR 0030 §2 + §9 the meta-disagreement-marked payload is a
  // `target`-discriminated union. Dispatch on proposal sub-kind:
  //
  //   - facet-valued sub-kinds (classify-node / set-node-substance /
  //     set-edge-substance / edit-wording) emit `target: 'facet'` keyed
  //     by `(entity_kind, entity_id, facet)` per ADR 0030 §2 — the mark
  //     hangs off the facet itself rather than off the proposal id, so
  //     subsequent re-proposal lifecycles compose cleanly against the
  //     per-facet state.
  //   - structural sub-kinds (decompose / interpretive-split /
  //     axiom-mark / meta-move / break-edge / amend-node / annotate)
  //     emit `target: 'proposal'` keyed by `proposal_id` per ADR 0030
  //     §9 — these proposals have no facet target the mark could attach
  //     to. (Unreachable here today: the boundary check above already
  //     refuses structural sub-kinds with `illegal-state-transition`;
  //     the per-sub-kind sibling tasks own structural meta-disagreement
  //     semantics.)
  //
  // The discriminator derives from `facetTargetForProposal` (mirrors
  // the same helper in the commit + vote handlers): non-null ↔ facet
  // arm; null ↔ structural arm. The projection's
  // `handleMetaDisagreementMarked` walks both arms (per
  // `pf_projection_replay_updates`); the wire frame here picks the
  // appropriate shape per sub-kind. `target` is the same `FacetTarget`
  // already computed for the facet-arm cross-check above.
  //
  // **Mixed-model intent (pinned by `pf_structural_handlers_unchanged`).**
  // Structural sub-kinds (`decompose`, `interpretive-split`, `axiom-mark`,
  // `annotate`, `meta-move`, `break-edge`) intentionally take the
  // proposal-keyed arm per ADR 0030 §9; the two patterns coexist by
  // design. The handler-side reject above (rule 4) is the BOUNDARY:
  // structural-meta-mark methodology semantics are deferred to the
  // per-sub-kind sibling tasks, so the structural arm of the emission
  // dispatch below is unreachable today. The arm is preserved so the
  // wire-shape contract is in place for those sibling tasks to consume.
  // The pin tests at `apps/server/src/methodology/handlers/structural-target.test.ts`
  // exercise the projection-arm round-trip (a `meta-disagreement-marked`
  // event with `target: 'proposal'` lands and the proposal moves to
  // `unresolvedMetaDisagreements`). See the refinement at
  // `tasks/refinements/per-facet-refactor/pf_structural_handlers_unchanged.md`.
  const payload =
    target !== null
      ? ({
          target: 'facet' as const,
          entity_kind: target.entityKind,
          entity_id: target.entityId,
          facet: target.facet,
          marked_by: action.requester,
          marked_at: action.markedAt,
        } as const)
      : ({
          target: 'proposal' as const,
          proposal_id: action.proposalEventId,
          marked_by: action.requester,
          marked_at: action.markedAt,
        } as const);
  const event: EventToAppendEnvelope<'meta-disagreement-marked'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence,
    kind: 'meta-disagreement-marked',
    actor: action.actor,
    payload,
    createdAt: action.createdAt,
  };
  return { ok: true, events: [event] };
};

export default markMetaDisagreementHandler;
