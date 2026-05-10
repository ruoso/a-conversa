// `propose` action handler.
//
// Refinement: tasks/refinements/data-and-methodology/decomposition_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.decomposition_logic
//
// The propose action carries one of the eleven proposal sub-kinds. Per
// the methodology framework (agreement_state_machine), the handler runs
// after the universal checks (session match / sequence match /
// participant gate) in `validateAction`. Each sub-kind has its own
// methodology rules; the handler dispatches on `action.proposal.kind`
// and applies the per-sub-kind rule set before emitting the one
// `proposal` envelope event.
//
// **What this handler enforces today.**
//
//   - For the `decompose` sub-kind: the real propose-side validator
//     per `decomposition_logic`. Three rules (see
//     `validateDecomposeProposal` below for the rule comments):
//       1. Parent-node-exists → `'target-entity-not-found'`.
//       2. Parent-node-visible → `'illegal-state-transition'`.
//       3. No conflicting decompose pending → `'illegal-state-transition'`.
//     (Structural shape — `components.length ∈ [2, 10]`, each
//     `wording` non-empty, valid `classification` — is enforced
//     upstream by `decomposeProposalSchema` per ADR 0021. The
//     methodology validator does not re-check.)
//
//   - For the other ten sub-kinds (`classify-node`,
//     `set-node-substance`, `set-edge-substance`, `edit-wording`,
//     `interpretive-split`, `axiom-mark`, `meta-move`, `break-edge`,
//     `amend-node`, `annotate`): the universal-pass placeholder path.
//     Each sub-kind's sibling task (`interpretive_split_logic`,
//     `axiom_mark_logic`, etc.) will tighten its arm as it lands. The
//     placeholder builds the same one-event envelope the original
//     handler always built — no methodology-specific gating.
//
// **Scope: propose-side only.** This handler validates the propose
// action and emits the proposal envelope event. The commit-time
// structural fan-out for decompose (component nodes' `node-created` +
// `entity-included` events) is **not** in scope and lives downstream —
// currently the projection's `applyCommittedProposal` decompose arm
// only flips `parent.visible = false`, and `commit_logic`'s rule 4
// rejects commits of structural sub-kinds with
// `'illegal-state-transition'`. The gap is real and flagged in the
// refinement's Open Questions — settling it is a follow-up
// (`decomposition_commit_logic` or `commit_logic` amendment).
//
// **Boundary with `replay.ts/applyCommittedProposal`.** This handler is
// the **write-side** propose-time gate (does the request pass
// methodology rules?). `applyCommittedProposal`'s decompose arm is the
// **read-side** structural application that runs *at commit time*
// after `commit_logic` has gated the commit. The two layers don't
// overlap: this handler does not touch projection state, and the
// projection handler does not re-validate methodology rules.

import type { PendingProposal, Projection } from '../../projection/index.js';
import { decomposeConflictsWith, nodeIsVisible, requireParticipant } from '../primitives.js';
import type {
  EventToAppendEnvelope,
  ProposeAction,
  RejectedValidationResult,
  ValidationResult,
  Validator,
} from '../types.js';

// ---------------------------------------------------------------
// `validateDecomposeProposal` — the propose-side validator for the
// `decompose` proposal sub-kind.
//
// Rules in evaluation order:
//
//   1. **Parent-node-exists.** `projection.getNode(parent_node_id)` must
//      return a record. → `'target-entity-not-found'`. (The new
//      RejectionReason added by `decomposition_logic`; see the
//      refinement for why it's distinct from `'proposal-not-found'`
//      and `'inapplicable-to-facet'`.)
//   2. **Parent-node-visible.** The node's `visible` field must be
//      `true`. A not-visible parent — already decomposed,
//      restructured, or otherwise superseded per the visible-graph
//      derivation in `docs/data-model.md` lines 273–285 — can't be
//      re-decomposed. → `'illegal-state-transition'`.
//   3. **No conflicting decompose pending.** No other proposal currently
//      in `pendingProposals` is a decompose against the same
//      `parent_node_id`. Two decomposes pending against the same parent
//      would race; the second is rejected. → `'illegal-state-transition'`.
//
// Rule 4 — structural payload shape (`components.length ∈ [2, 10]`,
// each `wording` non-empty, valid `classification`) — is enforced
// upstream by `decomposeProposalSchema` per ADR 0021 (the API layer's
// structural validator runs before the methodology engine). This
// validator does not re-check.
// ---------------------------------------------------------------

function validateDecomposeProposal(
  projection: Projection,
  action: ProposeAction,
): RejectedValidationResult | null {
  if (action.proposal.kind !== 'decompose') {
    // Defensive — the dispatcher gates this. Never reached at runtime.
    return null;
  }
  const parentNodeId = action.proposal.parent_node_id;

  // Rule 1 — parent node exists.
  const parent = projection.getNode(parentNodeId);
  if (parent === undefined) {
    return {
      ok: false,
      reason: 'target-entity-not-found',
      detail: `propose decompose: parent_node_id ${parentNodeId} does not reference any node in session ${projection.sessionId}`,
    };
  }

  // Rule 2 — parent is currently visible.
  if (!nodeIsVisible(projection, parentNodeId)) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose decompose: parent node ${parentNodeId} is not currently visible (already superseded by a prior decompose / interpretive-split / restructure) and cannot be re-decomposed`,
    };
  }

  // Rule 3 — no conflicting decompose pending against the same parent.
  const conflict: PendingProposal | null = decomposeConflictsWith(projection, parentNodeId);
  if (conflict !== null) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose decompose: another decompose proposal (${conflict.proposalEventId}) against parent ${parentNodeId} is already pending; resolve or withdraw it before re-proposing`,
    };
  }

  return null;
}

// ---------------------------------------------------------------
// The handler.
//
// Switches on `action.proposal.kind`. The `decompose` arm runs the
// real validator. All other arms fall through to the universal-pass
// placeholder path — sibling tasks (`interpretive_split_logic`,
// `axiom_mark_logic`, etc.) will tighten their arms as they land.
// ---------------------------------------------------------------

export const proposeHandler: Validator<ProposeAction> = (
  projection: Projection,
  action: ProposeAction,
): ValidationResult => {
  // Universal participant check is already enforced by
  // `validateAction`; re-affirming here is defensive but typed (the
  // `requireParticipant` helper's contract is "fetch the record or
  // surface a typed rejection"). The duplicate check costs one Map
  // lookup; we keep it because future per-sub-kind branches may need
  // the participant record (e.g. axiom-mark's `participant` field
  // must match the requester — sibling task's call).
  const participant = requireParticipant(projection, action.requester);
  if (!participant.ok) return participant.rejection;

  // Per-sub-kind dispatch.
  switch (action.proposal.kind) {
    case 'decompose': {
      const rejection = validateDecomposeProposal(projection, action);
      if (rejection !== null) return rejection;
      break;
    }
    // The other ten sub-kinds fall through to the placeholder emission.
    // Each sub-kind's sibling task tightens its arm as it lands.
    default:
      break;
  }

  const event: EventToAppendEnvelope<'proposal'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence,
    kind: 'proposal',
    actor: action.actor,
    payload: { proposal: action.proposal },
    createdAt: action.createdAt,
  };
  return { ok: true, events: [event] };
};

// Backward-compatibility alias — the engine's `installHandlers` and the
// barrel both still reference `placeholderProposeHandler`. After this
// task the symbol is no longer a placeholder for the `decompose` arm
// (it's the real validator there), but the name is preserved so the
// import sites in `engine.ts` and `handlers/index.ts` don't need to
// churn ahead of the other sibling sub-kind tasks. Once the remaining
// ten sub-kinds tighten, the alias and the file comment header should
// be revisited.
export const placeholderProposeHandler = proposeHandler;

export default proposeHandler;
