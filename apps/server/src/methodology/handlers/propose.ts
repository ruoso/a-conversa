// `propose` action handler.
//
// Refinement: tasks/refinements/data-and-methodology/decomposition_logic.md
// Refinement: tasks/refinements/data-and-methodology/interpretive_split_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.decomposition_logic
// TaskJuggler: data_and_methodology.methodology_engine.interpretive_split_logic
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
//       3. No conflicting decompose OR interpretive-split pending
//          against the same parent → `'illegal-state-transition'`.
//          (Mutual exclusion — extended from decomposition_logic's
//          original "no other decompose pending" rule when
//          interpretive_split_logic landed; see that refinement for the
//          symmetry argument.)
//     (Structural shape — `components.length ∈ [2, 10]`, each
//     `wording` non-empty, valid `classification` — is enforced
//     upstream by `decomposeProposalSchema` per ADR 0021. The
//     methodology validator does not re-check.)
//
//   - For the `interpretive-split` sub-kind: the real propose-side
//     validator per `interpretive_split_logic`. Same three rules as
//     decompose, with the conflict-walker invoked against the same
//     `CONFLICTING_PARENT_KINDS` set. The methodology semantics differ
//     (decompose: the speaker bundled multiple claims; interpretive-
//     split: the wording admits multiple readings — see
//     `docs/methodology.md` lines 168–181) but the structural rules
//     are identical because both operations target `parent.visible` on
//     commit.
//
//   - For the other nine sub-kinds (`classify-node`,
//     `set-node-substance`, `set-edge-substance`, `edit-wording`,
//     `axiom-mark`, `meta-move`, `break-edge`, `amend-node`,
//     `annotate`): the universal-pass placeholder path. Each sub-
//     kind's sibling task (`axiom_mark_logic`, `meta_move_logic`,
//     etc.) will tighten its arm as it lands. The placeholder builds
//     the same one-event envelope the original handler always built —
//     no methodology-specific gating.
//
// **Scope: propose-side only.** This handler validates the propose
// action and emits the proposal envelope event. The commit-time
// structural fan-out for decompose / interpretive-split (component-/
// reading-nodes' `node-created` + `entity-included` events) is **not**
// in scope and is the same Open Question both refinements flagged —
// currently the projection's `applyCommittedProposal` arms only flip
// `parent.visible = false`, and `commit_logic`'s rule 4 rejects
// commits of structural sub-kinds with `'illegal-state-transition'`.
// Settling the gap is a follow-up (likely a unified
// `decomposition_commit_logic` that handles both sub-kinds — see the
// refinements' shared open question).
//
// **Boundary with `replay.ts/applyCommittedProposal`.** This handler is
// the **write-side** propose-time gate (does the request pass
// methodology rules?). `applyCommittedProposal`'s decompose and
// interpretive-split arms are the **read-side** structural application
// that runs *at commit time* after `commit_logic` has gated the
// commit. The two layers don't overlap: this handler does not touch
// projection state, and the projection handler does not re-validate
// methodology rules.

import type { PendingProposal, Projection } from '../../projection/index.js';
import {
  findConflictingProposalAgainst,
  nodeIsVisible,
  requireParticipant,
  type ConflictingParentKind,
} from '../primitives.js';
import type {
  EventToAppendEnvelope,
  ProposeAction,
  RejectedValidationResult,
  ValidationResult,
  Validator,
} from '../types.js';

// ---------------------------------------------------------------
// `CONFLICTING_PARENT_KINDS` — the set of proposal sub-kinds that
// mutually exclude each other against a shared `parent_node_id`. Both
// `decompose` and `interpretive-split` flip `parent.visible = false`
// on commit (see `applyCommittedProposal` in `replay.ts`), so only one
// pending proposal of either kind may target a given parent at a
// time. Both the `decompose` arm and the `interpretive-split` arm
// pass this same set to `findConflictingProposalAgainst`; the constant
// is the single source of truth for "what blocks a new decompose or
// interpretive-split."
//
// If a future sub-kind adopts the same parent-flip-invisible behavior,
// it gets added here (and to the `ConflictingParentKind` union in
// `primitives.ts`).
// ---------------------------------------------------------------

const CONFLICTING_PARENT_KINDS: ReadonlySet<ConflictingParentKind> = new Set<ConflictingParentKind>(
  ['decompose', 'interpretive-split'],
);

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
//   3. **No conflicting decompose OR interpretive-split pending.** No
//      other proposal currently in `pendingProposals` is a decompose
//      OR interpretive-split against the same `parent_node_id`. The
//      two operations are mutually exclusive on the same parent
//      because both flip `parent.visible = false` on commit — the
//      second of either kind is rejected. → `'illegal-state-transition'`.
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

  // Rule 3 — no conflicting decompose OR interpretive-split pending against the same parent.
  const conflict: PendingProposal | null = findConflictingProposalAgainst(
    projection,
    parentNodeId,
    CONFLICTING_PARENT_KINDS,
  );
  if (conflict !== null) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose decompose: another ${conflict.payload.kind} proposal (${conflict.proposalEventId}) against parent ${parentNodeId} is already pending; resolve or withdraw it before re-proposing`,
    };
  }

  return null;
}

// ---------------------------------------------------------------
// `validateInterpretiveSplitProposal` — the propose-side validator for
// the `interpretive-split` proposal sub-kind.
//
// Same three rules as decompose, in the same evaluation order. The
// methodology semantics differ (per `docs/methodology.md` lines
// 168–181: decompose is for "the speaker bundled multiple claims";
// interpretive-split is for "the wording admits multiple readings and
// the disagreement lives at the seam"), but the propose-side rules
// are identical because both operations have the same structural
// effect on commit — flipping `parent.visible = false`.
//
// Rule 3 in particular checks the same `CONFLICTING_PARENT_KINDS` set:
// a pending decompose against the same parent blocks a new
// interpretive-split, AND a pending interpretive-split against the
// same parent blocks another new interpretive-split. The mutual
// exclusion is symmetric — see interpretive_split_logic.md for the
// argument.
//
// Rule 4 — structural payload shape (`readings.length ∈ [2, 10]`,
// each `wording` non-empty, valid `classification`) — is enforced
// upstream by `interpretiveSplitProposalSchema` per ADR 0021. This
// validator does not re-check.
// ---------------------------------------------------------------

function validateInterpretiveSplitProposal(
  projection: Projection,
  action: ProposeAction,
): RejectedValidationResult | null {
  if (action.proposal.kind !== 'interpretive-split') {
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
      detail: `propose interpretive-split: parent_node_id ${parentNodeId} does not reference any node in session ${projection.sessionId}`,
    };
  }

  // Rule 2 — parent is currently visible.
  if (!nodeIsVisible(projection, parentNodeId)) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose interpretive-split: parent node ${parentNodeId} is not currently visible (already superseded by a prior decompose / interpretive-split / restructure) and cannot be re-split`,
    };
  }

  // Rule 3 — no conflicting decompose OR interpretive-split pending against the same parent.
  const conflict: PendingProposal | null = findConflictingProposalAgainst(
    projection,
    parentNodeId,
    CONFLICTING_PARENT_KINDS,
  );
  if (conflict !== null) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose interpretive-split: another ${conflict.payload.kind} proposal (${conflict.proposalEventId}) against parent ${parentNodeId} is already pending; resolve or withdraw it before re-proposing`,
    };
  }

  return null;
}

// ---------------------------------------------------------------
// The handler.
//
// Switches on `action.proposal.kind`. The `decompose` and
// `interpretive-split` arms run their real validators. All other arms
// fall through to the universal-pass placeholder path — sibling tasks
// (`axiom_mark_logic`, `meta_move_logic`, etc.) will tighten their
// arms as they land.
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
    case 'interpretive-split': {
      const rejection = validateInterpretiveSplitProposal(projection, action);
      if (rejection !== null) return rejection;
      break;
    }
    // The other nine sub-kinds fall through to the placeholder emission.
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
// task the symbol is no longer a placeholder for the `decompose` or
// `interpretive-split` arms (it's the real validator there), but the
// name is preserved so the import sites in `engine.ts` and
// `handlers/index.ts` don't need to churn ahead of the other sibling
// sub-kind tasks. Once the remaining nine sub-kinds tighten, the alias
// and the file comment header should be revisited.
export const placeholderProposeHandler = proposeHandler;

export default proposeHandler;
