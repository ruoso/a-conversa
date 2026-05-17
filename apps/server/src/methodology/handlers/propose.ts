// `propose` action handler.
//
// Refinement: tasks/refinements/data-and-methodology/decomposition_logic.md
// Refinement: tasks/refinements/data-and-methodology/interpretive_split_logic.md
// Refinement: tasks/refinements/data-and-methodology/axiom_mark_logic.md
// Refinement: tasks/refinements/data-and-methodology/meta_move_logic.md
// Refinement: tasks/refinements/data-and-methodology/reword_vs_restructure.md
// Refinement: tasks/refinements/data-and-methodology/break_edge_logic.md
// Refinement: tasks/refinements/data-and-methodology/amend_node_logic.md
// Refinement: tasks/refinements/data-and-methodology/annotation_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.decomposition_logic
// TaskJuggler: data_and_methodology.methodology_engine.interpretive_split_logic
// TaskJuggler: data_and_methodology.methodology_engine.axiom_mark_logic
// TaskJuggler: data_and_methodology.methodology_engine.meta_move_logic
// TaskJuggler: data_and_methodology.methodology_engine.reword_vs_restructure
// TaskJuggler: data_and_methodology.methodology_engine.break_edge_logic
// TaskJuggler: data_and_methodology.methodology_engine.amend_node_logic
// TaskJuggler: data_and_methodology.methodology_engine.annotation_logic
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
//   - For the `edit-wording` sub-kind: the real propose-side validator
//     per `reword_vs_restructure`. The arm sub-switches on `edit_kind`
//     (`'reword' | 'restructure'`). Three shared rules (the same set
//     decompose / interpretive-split enforce), plus a restructure-only
//     fourth rule:
//       1. Node-exists → `'target-entity-not-found'`.
//       2. Node-visible → `'illegal-state-transition'`.
//       3. No conflicting edit-wording / decompose / interpretive-split
//          pending against the same node → `'illegal-state-transition'`.
//       4. (restructure only) `new_node_id` must NOT name an existing
//          node in the projection → `'illegal-state-transition'`.
//     Reword has no rule 4 — it updates wording in place, preserves
//     the node id, and doesn't mint a new id. Both inner kinds share
//     rules 1–3 because both compete with decompose / interpretive-
//     split on the same node (restructure flips
//     `oldNode.visible = false` on commit; reword owns the wording
//     facet exclusively while pending — both should be rejected if
//     another structural sub-kind is racing them).
//
//   - For the `axiom-mark` sub-kind: the real propose-side validator
//     per `axiom_mark_logic`. Four rules (see
//     `validateAxiomMarkProposal` below for the rule comments):
//       1. Node-exists → `'target-entity-not-found'`.
//       2. Node-visible → `'illegal-state-transition'`.
//       3. Participant-equals-requester → `'axiom-mark-not-self'`
//          (axiom-marks are personal — you can only declare your OWN
//          bedrock; another participant proposing on your behalf is a
//          category error per docs/methodology.md lines 192–200).
//       4. No duplicate axiom-mark (per-participant uniqueness) →
//          `'illegal-state-transition'`.
//     (Structural shape — `kind: 'axiom-mark'`, `node_id: UUID`,
//     `participant: UUID` — is enforced upstream by
//     `axiomMarkProposalSchema` per ADR 0021. The methodology
//     validator does not re-check.) Axiom-mark does NOT participate in
//     the `CONFLICTING_PARENT_KINDS` mutual-exclusion set — it's
//     per-participant, not structural; a pending decompose or
//     interpretive-split against the same node does not block it.
//
//   - For the `meta-move` sub-kind: the real propose-side validator
//     per `meta_move_logic`. Two rules (see `validateMetaMoveProposal`
//     below for the rule comments):
//       1. Target-entity-exists — `projection.getNode(target_id)` (when
//          `target_kind === 'node'`) or `projection.getEdge(target_id)`
//          (when `target_kind === 'edge'`) must be defined →
//          `'target-entity-not-found'`.
//       2. Target-entity-visible — the resolved node/edge's `visible`
//          flag must be `true` → `'illegal-state-transition'`.
//     (Structural shape — `meta_kind ∈ {reframe, scope-change, stance}`,
//     `content` non-empty, `target_kind ∈ {node, edge}`, `target_id` a
//     UUID — is enforced upstream by `metaMoveProposalSchema` per ADR
//     0021 / refinement R28. The methodology validator does not re-
//     check.) Meta-move is **not** in `CONFLICTING_PARENT_KINDS` — it
//     attaches an annotation, doesn't flip target visibility, and
//     multiple meta-moves on the same target are fine.
//
//   - For the `break-edge` sub-kind: the real propose-side validator
//     per `break_edge_logic`. Three rules (see
//     `validateBreakEdgeProposal` below for the rule comments):
//       1. Edge-exists → `'target-entity-not-found'`.
//       2. Edge-visible → `'illegal-state-transition'` (an
//          already-broken edge cannot be re-broken — its
//          `visible` flag is already `false` per the visible-graph
//          derivation in docs/data-model.md lines 287–293).
//       3. No conflicting break-edge proposal pending against the
//          same edge → `'illegal-state-transition'` (two pending
//          break-edges against the same edge would race on commit;
//          the second is rejected).
//     (Structural shape — `kind: 'break-edge'`, `edge_id: UUID` — is
//     enforced upstream by `breakEdgeProposalSchema` per ADR 0021.
//     The methodology validator does not re-check.) Break-edge is
//     **edge-scoped**, not node-scoped: it does not participate in
//     `CONFLICTING_PARENT_KINDS`. Rule 3 uses a separate
//     `findConflictingBreakEdgeProposal` walker keyed on `edge_id`;
//     see `primitives.ts` for the "two narrow walkers beats one
//     wide walker" rationale.
//
//   - For the `amend-node` sub-kind: the real propose-side validator
//     per `amend_node_logic`. Four rules (see
//     `validateAmendNodeProposal` below for the rule comments):
//       1. Node-exists → `'target-entity-not-found'`.
//       2. Node-visible → `'illegal-state-transition'`.
//       3. No conflicting decompose / interpretive-split / edit-wording
//          / amend-node pending against the same node →
//          `'illegal-state-transition'` (mutual exclusion across all
//          four wording-touching / supersession-producing sub-kinds —
//          extends `CONFLICTING_PARENT_KINDS` to include `'amend-node'`).
//       4. The node is currently a party (source or target) to a
//          visible `contradicts` edge whose substance facet is in an
//          agreed state — i.e. there is an actual contradiction to
//          resolve. → `'methodology-not-exhausted'`. **Strict reading**
//          of docs/methodology.md line 219: "amend one [node] to
//          remove conflict" is the contradiction-resolution path. An
//          amend-node without an agreed contradiction is the wrong
//          tool — the participant should propose `edit-wording(reword)`
//          instead. See `amend_node_logic.md` for the strict-vs-
//          permissive discussion.
//     (Structural shape — `kind: 'amend-node'`, `node_id: UUID`,
//     `new_content` non-empty — is enforced upstream by
//     `amendNodeProposalSchema` per ADR 0021. The methodology
//     validator does not re-check.) **amend-node vs reword.** Both
//     sub-kinds update wording in place and have identical structural
//     effect on commit (replay.ts ~line 722); the methodology
//     distinguishes them by intent — reword is the routine
//     clarification path (the wording was imprecise; we agree on what
//     was meant), amend-node is the contradiction-resolution path
//     (the wording implies a contradiction; we agree to amend ONE
//     side to remove it). Rule 4 enforces the intent at the validator
//     layer.
//
//   - For the `annotate` sub-kind: the real propose-side validator per
//     `annotation_logic`. Two rules (see `validateAnnotateProposal`
//     below for the rule comments):
//       1. Target-entity-exists — `projection.getNode(target_id)` (when
//          `target_kind === 'node'`) or `projection.getEdge(target_id)`
//          (when `target_kind === 'edge'`) must be defined →
//          `'target-entity-not-found'`.
//       2. Target-entity-visible — the resolved node/edge's `visible`
//          flag must be `true` → `'illegal-state-transition'`.
//     (Structural shape — `kind: 'annotate'`, `target_kind ∈ {node,
//     edge}`, `target_id: UUID`, `annotation_kind ∈ {note, reframe,
//     scope-change, stance}`, `content` non-empty — is enforced
//     upstream by `annotateProposalSchema` per ADR 0021. The
//     methodology validator does not re-check.) Annotate is **not** in
//     `CONFLICTING_PARENT_KINDS` — it attaches an annotation, doesn't
//     flip target visibility, and multiple annotations on the same
//     target are fine. No deduplication either: annotations are
//     content-bearing and same-content duplicates may be intentional
//     (the agreement workflow handles redundancy via dispute /
//     withdrawal). The methodology validator does not walk pending /
//     committed annotations looking for matches.
//
//     **`annotation_kind` overlap with `meta-move`**: the
//     `annotation_kind` enum (`note`, `reframe`, `scope-change`,
//     `stance`) overlaps with `meta-move`'s `meta_kind` enum
//     (`reframe`, `scope-change`, `stance`). Per the meta_move_logic
//     refinement, a meta-move commit creates an annotation with the
//     corresponding kind; an annotate commit produces an annotation
//     too. The two paths converge structurally but differ in user
//     intent (meta-move: "I'm relocating the debate"; annotate:
//     "attach context"). The annotate validator does NOT redirect or
//     reject the three overlapping `annotation_kind` values — both
//     paths remain available; resolving the redundancy is an ADR-
//     level decision out of scope here. See annotation_logic.md.
//
//   - For the other three sub-kinds (`classify-node`,
//     `set-node-substance`, `set-edge-substance`): the universal-pass
//     placeholder path. Each sub-kind's sibling task will tighten its
//     arm as it lands. The placeholder builds the same one-event
//     envelope the original handler always built — no methodology-
//     specific gating.
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

import { randomUUID } from 'node:crypto';

import type { PendingProposal, Projection } from '../../projection/index.js';
import {
  edgeIsVisible,
  findConflictingBreakEdgeProposal,
  findConflictingProposalAgainst,
  hasAxiomMark,
  nodeIsPartyToAgreedContradicts,
  nodeIsVisible,
  requireParticipant,
  type ConflictingParentKind,
} from '../primitives.js';
import type {
  EventToAppend,
  EventToAppendEnvelope,
  ProposeAction,
  RejectedValidationResult,
  ValidationResult,
  Validator,
} from '../types.js';

// ---------------------------------------------------------------
// `CONFLICTING_PARENT_KINDS` — the set of proposal sub-kinds that
// mutually exclude each other against a shared target node. The four
// node-touching structural sub-kinds (`decompose`,
// `interpretive-split`, `edit-wording`, `amend-node`) all compete on
// the same node:
//
//   - `decompose` and `interpretive-split` flip `parent.visible =
//     false` on commit (see `applyCommittedProposal` in `replay.ts`).
//   - `edit-wording` with `edit_kind: restructure` flips
//     `oldNode.visible = false` on commit — also supersession.
//   - `edit-wording` with `edit_kind: reword` updates the wording
//     facet in place but still owns that facet exclusively while
//     pending. Treating both inner kinds uniformly under the
//     conflict-walker keeps the design symmetric (see
//     `reword_vs_restructure.md` for the argument).
//   - `amend-node` updates the wording facet in place — same
//     structural effect as reword, driven by the contradiction-
//     resolution methodology path (see `amend_node_logic.md`).
//
// Only one pending proposal among the four sub-kinds may target a
// given node at a time. All four arms (decompose, interpretive-split,
// edit-wording, amend-node) pass this same set to
// `findConflictingProposalAgainst`; the constant is the single source
// of truth.
//
// If a future sub-kind adopts the same node-targeting behavior, it
// gets added here (and to the `ConflictingParentKind` union in
// `primitives.ts`).
// ---------------------------------------------------------------

const CONFLICTING_PARENT_KINDS: ReadonlySet<ConflictingParentKind> = new Set<ConflictingParentKind>(
  ['decompose', 'interpretive-split', 'edit-wording', 'amend-node'],
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
// `validateAxiomMarkProposal` — the propose-side validator for the
// `axiom-mark` proposal sub-kind.
//
// Axiom-marks are **per-participant** signals: "this participant
// declares no evidence would change their mind on this node." Per
// docs/methodology.md lines 192–200 they are personal bedrock — Ben
// may hold N9 as axiom while Anna does not, or both may hold N9 as
// axiom from their respective frames. The proposal itself must come
// from the participant whose bedrock is being declared; the
// subsequent vote round lets the other participants dispute (per the
// methodology's universal agreement rule — agreement on an axiom-mark
// is "we all agree that this participant holds this node as bedrock,"
// not "we all agree the node is true").
//
// Rules in evaluation order:
//
//   1. **Node-exists.** `projection.getNode(node_id)` must return a
//      record. → `'target-entity-not-found'`.
//   2. **Node-visible.** The node's `visible` field must be `true`. An
//      invisible node — already superseded by decompose /
//      interpretive-split / restructure per the visible-graph
//      derivation in docs/data-model.md lines 273–285 — can't carry
//      a fresh axiom-mark; the mark would render on a node nobody
//      can see. → `'illegal-state-transition'`.
//   3. **Participant-equals-requester.** `proposal.participant ===
//      action.requester`. Axiom-marks are personal — you can only
//      mark YOUR OWN axiom. Surfacing someone else's bedrock on their
//      behalf would be a category error: bedrock is what *this
//      person* refuses to retract from, and only they can declare it.
//      → `'axiom-mark-not-self'` (a new RejectionReason; the existing
//      `'self-vote-not-allowed'` has the opposite semantic shape —
//      see axiom_mark_logic.md "Decisions").
//   4. **No duplicate axiom-mark.** `hasAxiomMark(projection, node_id,
//      participant) === false`. The projection's `axiomMarks` map
//      records committed marks per-(node, participant); a second
//      propose from the same participant on the same node would be a
//      no-op duplicate. → `'illegal-state-transition'` (mirrors the
//      decompose / interpretive-split arms' rule 2/3 grouping under
//      the umbrella).
//
// Rule 5 — structural payload shape — is enforced upstream by
// `axiomMarkProposalSchema` per ADR 0021. This validator does not
// re-check.
//
// **No conflict with decompose / interpretive-split.** An axiom-mark
// is NOT in `CONFLICTING_PARENT_KINDS`. It doesn't flip
// `node.visible = false` on commit and so doesn't race against
// structural sub-kinds; a pending decompose or interpretive-split
// against the same node does not block an axiom-mark proposal
// against that node. (Indeed, docs/methodology.md line 175 even
// names axiom-marking as one of the resolution paths for a cycle
// alongside decomposing — these are alternative moves, not racing
// proposals.)
// ---------------------------------------------------------------

function validateAxiomMarkProposal(
  projection: Projection,
  action: ProposeAction,
): RejectedValidationResult | null {
  if (action.proposal.kind !== 'axiom-mark') {
    // Defensive — the dispatcher gates this. Never reached at runtime.
    return null;
  }
  const nodeId = action.proposal.node_id;
  const participantId = action.proposal.participant;

  // Rule 1 — node exists.
  const node = projection.getNode(nodeId);
  if (node === undefined) {
    return {
      ok: false,
      reason: 'target-entity-not-found',
      detail: `propose axiom-mark: node_id ${nodeId} does not reference any node in session ${projection.sessionId}`,
    };
  }

  // Rule 2 — node is currently visible.
  if (!nodeIsVisible(projection, nodeId)) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose axiom-mark: node ${nodeId} is not currently visible (already superseded by a prior decompose / interpretive-split / restructure) and cannot be axiom-marked`,
    };
  }

  // Rule 3 — the proposal's participant equals the action's requester.
  // Axiom-marks are personal; only the bedrock-holder may declare it.
  if (participantId !== action.requester) {
    return {
      ok: false,
      reason: 'axiom-mark-not-self',
      detail: `propose axiom-mark: requester ${action.requester} cannot mark an axiom on behalf of participant ${participantId}; axiom-marks are per-participant and personal — the proposing participant must match the participant being marked`,
    };
  }

  // Rule 4 — no duplicate axiom-mark for this (node, participant).
  if (hasAxiomMark(projection, nodeId, participantId)) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose axiom-mark: participant ${participantId} already has a committed axiom-mark on node ${nodeId}; a second axiom-mark on the same (node, participant) pair is redundant`,
    };
  }

  return null;
}

// ---------------------------------------------------------------
// `validateMetaMoveProposal` — the propose-side validator for the
// `meta-move` proposal sub-kind.
//
// A meta-move is a reframe / scope-change / methodological stance
// attached to a node or edge — a first-class capture of "the real
// question is X, not the Y currently on the board" (per
// docs/methodology.md lines 184–190). Per refinement R28, v1 requires
// every meta-move to carry a target (`target_kind` + `target_id`);
// session-level meta-moves (no target) are deferred.
//
// Rules in evaluation order:
//
//   1. **Target-entity-exists.** Dispatch on `target_kind`:
//      - `'node'` → `projection.getNode(target_id)` must be non-
//        undefined.
//      - `'edge'` → `projection.getEdge(target_id)` must be non-
//        undefined.
//      → `'target-entity-not-found'` (same RejectionReason the
//      decompose / interpretive-split / axiom-mark arms use when their
//      target node is missing).
//   2. **Target-entity-visible.** The resolved entity's `visible`
//      field must be `true`. A meta-move on a superseded node or
//      broken edge is meaningless — the annotation it creates would
//      render against an entity nobody can see. → `'illegal-state-
//      transition'`.
//
// Rule 3 — structural payload shape (`meta_kind ∈ {reframe, scope-
// change, stance}`, `content` non-empty, `target_kind ∈ {node, edge}`,
// `target_id` a UUID) — is enforced upstream by
// `metaMoveProposalSchema` per ADR 0021 and refinement R28. This
// validator does not re-check.
//
// **No conflict-walking.** A meta-move attaches an annotation; it does
// NOT flip the target's `visible` flag on commit. Multiple meta-moves
// on the same target are fine (a participant may reframe AND later
// declare a stance on the same node). The `CONFLICTING_PARENT_KINDS`
// set is unchanged.
//
// **Commit-time annotation creation.** The projection's
// `applyCommittedProposal` meta-move arm (replay.ts ~line 687) is
// currently a structural no-op — it synthesizes an annotation id but
// doesn't emit the annotation-creation, deferring the rendering
// decision to the methodology engine. Resolving the gap is the same
// follow-up the decompose / interpretive-split / axiom-mark arms
// flagged (likely lives alongside `commit_logic`'s structural-sub-
// kind support); see this refinement's Open Questions.
// ---------------------------------------------------------------

function validateMetaMoveProposal(
  projection: Projection,
  action: ProposeAction,
): RejectedValidationResult | null {
  if (action.proposal.kind !== 'meta-move') {
    // Defensive — the dispatcher gates this. Never reached at runtime.
    return null;
  }
  const targetKind = action.proposal.target_kind;
  const targetId = action.proposal.target_id;

  // Rule 1 — target entity exists (dispatched on target_kind).
  if (targetKind === 'node') {
    const node = projection.getNode(targetId);
    if (node === undefined) {
      return {
        ok: false,
        reason: 'target-entity-not-found',
        detail: `propose meta-move: target_id ${targetId} (target_kind 'node') does not reference any node in session ${projection.sessionId}`,
      };
    }
    // Rule 2 — node is currently visible.
    if (!nodeIsVisible(projection, targetId)) {
      return {
        ok: false,
        reason: 'illegal-state-transition',
        detail: `propose meta-move: target node ${targetId} is not currently visible (already superseded by a prior decompose / interpretive-split / restructure) — a meta-move on an invisible entity is meaningless`,
      };
    }
    return null;
  }
  // target_kind === 'edge'
  const edge = projection.getEdge(targetId);
  if (edge === undefined) {
    return {
      ok: false,
      reason: 'target-entity-not-found',
      detail: `propose meta-move: target_id ${targetId} (target_kind 'edge') does not reference any edge in session ${projection.sessionId}`,
    };
  }
  // Rule 2 — edge is currently visible.
  if (!edgeIsVisible(projection, targetId)) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose meta-move: target edge ${targetId} is not currently visible (already broken by a prior break-edge commit) — a meta-move on an invisible entity is meaningless`,
    };
  }
  return null;
}

// ---------------------------------------------------------------
// `validateEditWordingProposal` — the propose-side validator for the
// `edit-wording` proposal sub-kind.
//
// The `edit-wording` payload carries a nested `edit_kind` discriminator
// (`'reword' | 'restructure'`). Both inner kinds share three rules; the
// `restructure` inner kind adds a fourth. See
// `reword_vs_restructure.md` for the semantic argument:
//
//   - **Reword** preserves the node id; the wording facet's value
//     changes in place and existing edges remain attached. No new node
//     id is minted.
//   - **Restructure** creates a new node (carrying `new_node_id` from
//     the payload) and supersedes the old node. Edges to the old node
//     do NOT follow to the new node (per the visible-graph derivation
//     in `docs/data-model.md` lines 273–285 / 302); if participants
//     want analogous edges on the replacement, they propose them
//     explicitly.
//
// Rules in evaluation order (shared by both inner kinds):
//
//   1. **Node-exists.** `projection.getNode(node_id)` must return a
//      record. → `'target-entity-not-found'`.
//   2. **Node-visible.** The node's `visible` field must be `true`. A
//      not-visible node — already superseded by a prior decompose /
//      interpretive-split / restructure per the visible-graph
//      derivation — can't be re-edited: the wording change would
//      attach to a node nobody can see. → `'illegal-state-transition'`.
//   3. **No conflicting edit-wording / decompose / interpretive-split
//      pending.** No other proposal currently in `pendingProposals`
//      is one of the three structural sub-kinds targeting the same
//      node. → `'illegal-state-transition'`.
//
// Plus the restructure-only rule:
//
//   4. **`new_node_id` does not collide.** `projection.getNode
//      (new_node_id)` must be `undefined`. A restructure proposal mints
//      a brand-new node id; if that id already names an existing node,
//      the proposal is structurally broken (committing it would
//      silently overwrite the existing entity). →
//      `'illegal-state-transition'`.
//
// Rule 5 — structural payload shape (`kind: 'edit-wording'`, the
// nested `edit_kind` discriminator, `node_id: UUID`, `new_wording`
// non-empty, and (for restructure) `new_node_id: UUID`) — is enforced
// upstream by `editWordingProposalSchema` (a nested
// `z.discriminatedUnion('edit_kind', ...)`) per ADR 0021. This
// validator does not re-check.
// ---------------------------------------------------------------

function validateEditWordingProposal(
  projection: Projection,
  action: ProposeAction,
): RejectedValidationResult | null {
  if (action.proposal.kind !== 'edit-wording') {
    // Defensive — the dispatcher gates this. Never reached at runtime.
    return null;
  }
  const proposal = action.proposal;
  const nodeId = proposal.node_id;
  const editKind = proposal.edit_kind;

  // Rule 1 — node exists.
  const node = projection.getNode(nodeId);
  if (node === undefined) {
    return {
      ok: false,
      reason: 'target-entity-not-found',
      detail: `propose edit-wording(${editKind}): node_id ${nodeId} does not reference any node in session ${projection.sessionId}`,
    };
  }

  // Rule 2 — node is currently visible.
  if (!nodeIsVisible(projection, nodeId)) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose edit-wording(${editKind}): node ${nodeId} is not currently visible (already superseded by a prior decompose / interpretive-split / restructure) and cannot be re-edited`,
    };
  }

  // Rule 3 — no conflicting edit-wording / decompose / interpretive-split
  // pending against the same node.
  const conflict: PendingProposal | null = findConflictingProposalAgainst(
    projection,
    nodeId,
    CONFLICTING_PARENT_KINDS,
  );
  if (conflict !== null) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose edit-wording(${editKind}): another ${conflict.payload.kind} proposal (${conflict.proposalEventId}) against node ${nodeId} is already pending; resolve or withdraw it before re-proposing`,
    };
  }

  // Rule 4 (restructure only) — new_node_id must not collide.
  if (proposal.edit_kind === 'restructure') {
    const newNodeId = proposal.new_node_id;
    const collision = projection.getNode(newNodeId);
    if (collision !== undefined) {
      return {
        ok: false,
        reason: 'illegal-state-transition',
        detail: `propose edit-wording(restructure): new_node_id ${newNodeId} already names an existing node in session ${projection.sessionId}; a restructure must mint a fresh node id`,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------
// `validateBreakEdgeProposal` — the propose-side validator for the
// `break-edge` proposal sub-kind.
//
// A break-edge proposes severing a supporting edge — the methodology's
// primary cycle-resolution path per docs/methodology.md line 218
// ("break one `supports` edge (acknowledged as not actually holding)").
// On commit, `replay.ts`'s `applyCommittedProposal` break-edge arm
// flips `edge.visible = false` (lines 708–720); per the visible-graph
// derivation in docs/data-model.md line 290 ("No subsequent committed
// `break-edge` event references this edge"), the edge is no longer
// rendered.
//
// Rules in evaluation order:
//
//   1. **Edge-exists.** `projection.getEdge(edge_id)` must return a
//      record. → `'target-entity-not-found'`. (Mirrors decompose /
//      interpretive-split / meta-move's existence rule against the
//      same RejectionReason — "the target doesn't exist.")
//   2. **Edge-visible.** The edge's `visible` field must be `true`.
//      An already-broken edge — flipped invisible by a prior committed
//      break-edge — can't be re-broken; the operation would be a no-
//      op against a non-rendered entity. → `'illegal-state-transition'`.
//   3. **No conflicting break-edge pending against the same edge.** No
//      other pending proposal in `pendingProposals` is a break-edge
//      whose `edge_id` matches this one. Two concurrent break-edges
//      against the same edge would race at commit time: the first to
//      land flips `edge.visible = false`; the second, if also
//      committed, would attempt to re-break an already-broken edge
//      (which the projection's `applyCommittedProposal` would treat
//      as idempotent but the methodology semantics treat as
//      meaningless). The propose-time check short-circuits the race.
//      → `'illegal-state-transition'`.
//
// Rule 4 — structural payload shape (`kind: 'break-edge'`,
// `edge_id: UUID`) — is enforced upstream by `breakEdgeProposalSchema`
// per ADR 0021. The methodology validator does not re-check.
//
// **Edge-scope vs. node-scope.** Break-edge is **edge-scoped**: it does
// not participate in `CONFLICTING_PARENT_KINDS` (the node-scoped set
// used by decompose / interpretive-split / edit-wording). A break-edge
// against an edge whose source or target node has a pending decompose
// is fine — the two operations target different entities. Rule 3 uses
// the dedicated `findConflictingBreakEdgeProposal` walker keyed on
// `edge_id`; see `primitives.ts` for the "two narrow walkers beats
// one wide walker" rationale.
//
// **No cycle-prerequisite check.** docs/methodology.md describes
// break-edge as the cycle-resolution path, but does not require a
// diagnostic-fired cycle before allowing the proposal — participants
// may break an edge they consider unsupported even when no cycle has
// been detected. The cycle-detection diagnostic is a separate M2 task
// (`diagnostics.cycle_detection`) and lives in the diagnostics sub-
// stream, not as a propose-side gate. See the refinement's Open
// Questions.
// ---------------------------------------------------------------

function validateBreakEdgeProposal(
  projection: Projection,
  action: ProposeAction,
): RejectedValidationResult | null {
  if (action.proposal.kind !== 'break-edge') {
    // Defensive — the dispatcher gates this. Never reached at runtime.
    return null;
  }
  const edgeId = action.proposal.edge_id;

  // Rule 1 — edge exists.
  const edge = projection.getEdge(edgeId);
  if (edge === undefined) {
    return {
      ok: false,
      reason: 'target-entity-not-found',
      detail: `propose break-edge: edge_id ${edgeId} does not reference any edge in session ${projection.sessionId}`,
    };
  }

  // Rule 2 — edge is currently visible.
  if (!edgeIsVisible(projection, edgeId)) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose break-edge: edge ${edgeId} is not currently visible (already broken by a prior break-edge commit) and cannot be re-broken`,
    };
  }

  // Rule 3 — no conflicting break-edge pending against the same edge.
  const conflict: PendingProposal | null = findConflictingBreakEdgeProposal(projection, edgeId);
  if (conflict !== null) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose break-edge: another break-edge proposal (${conflict.proposalEventId}) against edge ${edgeId} is already pending; resolve or withdraw it before re-proposing`,
    };
  }

  return null;
}

// ---------------------------------------------------------------
// `validateAmendNodeProposal` — the propose-side validator for the
// `amend-node` proposal sub-kind.
//
// **Methodology context.** Per docs/methodology.md line 219 (in
// "Resolution of structural diagnostics → Blocking diagnostics →
// Contradiction"): "decompose one or both nodes (most common), **amend
// one to remove conflict**, or accept the contradiction as a bedrock
// disagreement." Amend-node is the contradiction-resolution path. The
// edit-wording (reword) sub-kind is the routine clarification path
// (the wording was imprecise; we agree on what was meant). Both have
// identical structural effect on commit (in-place wording update; see
// `replay.ts/applyCommittedProposal`'s `amend-node` arm at ~line 722
// vs. its `edit-wording(reword)` arm) — the methodology distinguishes
// them by *intent*. Rule 4 below pins the intent at the validator
// layer: an amend-node is rejected unless the node is currently a
// party to an agreed contradiction.
//
// Rules in evaluation order:
//
//   1. **Node-exists.** `projection.getNode(node_id)` must return a
//      record. → `'target-entity-not-found'`.
//   2. **Node-visible.** The node's `visible` field must be `true`. A
//      not-visible node — already superseded by a prior decompose /
//      interpretive-split / restructure per the visible-graph
//      derivation in `docs/data-model.md` lines 273–285 — can't be
//      amended: the wording change would attach to a node nobody can
//      see. → `'illegal-state-transition'`.
//   3. **No conflicting decompose / interpretive-split / edit-wording
//      / amend-node pending.** No other proposal currently in
//      `pendingProposals` is one of the four node-touching structural
//      sub-kinds against the same node. The walker passes
//      `CONFLICTING_PARENT_KINDS`, which now includes `'amend-node'`
//      (this task's extension). → `'illegal-state-transition'`.
//   4. **Node is party to an agreed `contradicts` edge.** Some visible
//      `contradicts` edge in the projection has source OR target
//      equal to `node_id` AND its `substanceFacet` has been agreed
//      (status `'agreed'` or `'committed'`, value `'agreed'`). The
//      `nodeIsPartyToAgreedContradicts` primitive walks
//      `projection.edges()` for the check. → `'methodology-not-
//      exhausted'` if no such edge exists.
//
// Rule 5 — structural payload shape (`kind: 'amend-node'`,
// `node_id: UUID`, `new_content` non-empty) — is enforced upstream by
// `amendNodeProposalSchema` per ADR 0021. This validator does not
// re-check.
//
// **`'methodology-not-exhausted'` choice for rule 4.** The reason was
// minted by `meta_disagreement_logic` for "the methodology hasn't
// reached the state where this resolution path is appropriate yet."
// Amend-node-without-an-agreed-contradiction matches that shape: the
// participant is reaching for the contradiction-resolution path
// before there is a contradiction to resolve. Alternatives considered:
// `'illegal-state-transition'` (the existing structural reason — but
// the projection state isn't *illegal*; it's that this specific
// methodology operation is the wrong tool for the current state) and
// minting a fresh `'no-contradiction-to-resolve'` reason (clearer but
// adds a single-call-site value to the union — not worth it for one
// rule). Reusing `'methodology-not-exhausted'` keeps the
// `RejectionReason` union stable; the `detail` string carries the
// kind-specific specificity.
// ---------------------------------------------------------------

function validateAmendNodeProposal(
  projection: Projection,
  action: ProposeAction,
): RejectedValidationResult | null {
  if (action.proposal.kind !== 'amend-node') {
    // Defensive — the dispatcher gates this. Never reached at runtime.
    return null;
  }
  const nodeId = action.proposal.node_id;

  // Rule 1 — node exists.
  const node = projection.getNode(nodeId);
  if (node === undefined) {
    return {
      ok: false,
      reason: 'target-entity-not-found',
      detail: `propose amend-node: node_id ${nodeId} does not reference any node in session ${projection.sessionId}`,
    };
  }

  // Rule 2 — node is currently visible.
  if (!nodeIsVisible(projection, nodeId)) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose amend-node: node ${nodeId} is not currently visible (already superseded by a prior decompose / interpretive-split / restructure) and cannot be amended`,
    };
  }

  // Rule 3 — no conflicting decompose / interpretive-split /
  // edit-wording / amend-node pending against the same node.
  const conflict: PendingProposal | null = findConflictingProposalAgainst(
    projection,
    nodeId,
    CONFLICTING_PARENT_KINDS,
  );
  if (conflict !== null) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose amend-node: another ${conflict.payload.kind} proposal (${conflict.proposalEventId}) against node ${nodeId} is already pending; resolve or withdraw it before re-proposing`,
    };
  }

  // Rule 4 — node must be party to a visible `contradicts` edge whose
  // substance facet is agreed. Amend-node is the contradiction-
  // resolution path per docs/methodology.md line 219; without an
  // agreed contradiction there is nothing to resolve and the
  // participant should propose `edit-wording(reword)` instead.
  if (!nodeIsPartyToAgreedContradicts(projection, nodeId)) {
    return {
      ok: false,
      reason: 'methodology-not-exhausted',
      detail: `propose amend-node: node ${nodeId} is not currently a party to any agreed contradicts edge; amend-node is the contradiction-resolution path (per docs/methodology.md), use edit-wording(reword) for routine wording clarifications`,
    };
  }

  return null;
}

// ---------------------------------------------------------------
// `validateAnnotateProposal` — the propose-side validator for the
// `annotate` proposal sub-kind.
//
// An annotation is a note attached to a node or edge that records
// participant context — per docs/data-model.md lines 135–141, "notes
// attached to the entity that record participant context the
// participants want preserved without modifying the entity's core
// meaning." Examples from the walkthrough: Ben's note that D1's
// accreditation boundary "does argumentative work" (recorded as
// context alongside an agree vote); a "declines to press"
// methodological stance attached to a node Ben chose not to argue.
// Annotations carry their own `wording` and `substance` facets and
// go through the standard agreement workflow.
//
// Rules in evaluation order:
//
//   1. **Target-entity-exists.** Dispatch on `target_kind`:
//      - `'node'` → `projection.getNode(target_id)` must be non-
//        undefined.
//      - `'edge'` → `projection.getEdge(target_id)` must be non-
//        undefined.
//      → `'target-entity-not-found'` (same RejectionReason the
//      decompose / interpretive-split / axiom-mark / meta-move arms
//      use when their target entity is missing).
//   2. **Target-entity-visible.** The resolved entity's `visible`
//      field must be `true`. An annotation against a superseded node
//      or broken edge is meaningless — per docs/data-model.md lines
//      295–300, "an annotation is visible iff (1) an annotation-
//      created event has fired in this session's history, AND (2)
//      the annotation's target entity (node or edge) is currently
//      visible. If the target becomes invisible, the annotation does
//      too." Writing one against an already-invisible target is a
//      propose-time contradiction. → `'illegal-state-transition'`.
//
// Rule 3 — structural payload shape (`kind: 'annotate'`,
// `target_kind ∈ {node, edge}`, `target_id` a UUID, `annotation_kind
// ∈ {note, reframe, scope-change, stance}`, `content` non-empty) — is
// enforced upstream by `annotateProposalSchema` per ADR 0021. The
// methodology validator does not re-check.
//
// **No conflict-walking.** An annotation is **additive** — it attaches
// to a target and does NOT flip `target.visible = false` on commit.
// Multiple annotations on the same target are fine and methodologically
// expected (a participant may attach a `note` recording context AND a
// `stance` declaring decline-to-press against the same node). The
// `CONFLICTING_PARENT_KINDS` set is unchanged (it's the node-touching
// structural set: decompose / interpretive-split / edit-wording /
// amend-node — none of which annotate participates in).
//
// **No deduplication.** The methodology layer does NOT reject "same-
// content annotation against same target" as a duplicate. Annotations
// are content-bearing artifacts; the participants may want two notes
// that look similar (different framings, same surface text; or the
// same note re-stated for emphasis at a later point in the debate).
// The agreement workflow handles redundancy — a duplicate annotation,
// if disputed, can be withdrawn. See `annotation_logic.md` "Decisions."
//
// **`annotation_kind` overlap with `meta-move`.** The `annotation_kind`
// enum (`note`, `reframe`, `scope-change`, `stance`) overlaps with
// `meta-move`'s `meta_kind` enum on the latter three values. Per the
// meta_move_logic refinement, a meta-move commit creates an annotation
// with the corresponding kind; an annotate commit also produces an
// annotation. The two paths converge structurally but differ in user
// intent. The annotate validator accepts all four `annotation_kind`
// values — it does NOT redirect or reject the three overlapping
// values. Both paths remain available; resolving the redundancy is an
// ADR-level decision out of scope here.
//
// **Commit-time annotation creation.** The projection's
// `applyCommittedProposal` annotate arm (replay.ts lines 749–760) is
// currently a structural no-op — it defers the annotation entity's
// creation to a paired `annotation-created` event the methodology
// engine will eventually emit. Same shape as the decompose /
// interpretive-split / axiom-mark / meta-move commit-time gaps; see
// this refinement's Open Questions.
// ---------------------------------------------------------------

function validateAnnotateProposal(
  projection: Projection,
  action: ProposeAction,
): RejectedValidationResult | null {
  if (action.proposal.kind !== 'annotate') {
    // Defensive — the dispatcher gates this. Never reached at runtime.
    return null;
  }
  const targetKind = action.proposal.target_kind;
  const targetId = action.proposal.target_id;

  // Rule 1 — target entity exists (dispatched on target_kind).
  if (targetKind === 'node') {
    const node = projection.getNode(targetId);
    if (node === undefined) {
      return {
        ok: false,
        reason: 'target-entity-not-found',
        detail: `propose annotate: target_id ${targetId} (target_kind 'node') does not reference any node in session ${projection.sessionId}`,
      };
    }
    // Rule 2 — node is currently visible.
    if (!nodeIsVisible(projection, targetId)) {
      return {
        ok: false,
        reason: 'illegal-state-transition',
        detail: `propose annotate: target node ${targetId} is not currently visible (already superseded by a prior decompose / interpretive-split / restructure) — an annotation on an invisible entity is meaningless`,
      };
    }
    return null;
  }
  // target_kind === 'edge'
  const edge = projection.getEdge(targetId);
  if (edge === undefined) {
    return {
      ok: false,
      reason: 'target-entity-not-found',
      detail: `propose annotate: target_id ${targetId} (target_kind 'edge') does not reference any edge in session ${projection.sessionId}`,
    };
  }
  // Rule 2 — edge is currently visible.
  if (!edgeIsVisible(projection, targetId)) {
    return {
      ok: false,
      reason: 'illegal-state-transition',
      detail: `propose annotate: target edge ${targetId} is not currently visible (already broken by a prior break-edge commit) — an annotation on an invisible entity is meaningless`,
    };
  }
  return null;
}

// ---------------------------------------------------------------
// The handler.
//
// Switches on `action.proposal.kind`. The `decompose`,
// `interpretive-split`, `axiom-mark`, `meta-move`, `edit-wording`,
// `break-edge`, `amend-node`, and `annotate` arms run their real
// validators. The remaining three arms (`classify-node`,
// `set-node-substance`, `set-edge-substance`) fall through to the
// universal-pass placeholder path — their sibling tasks will tighten
// them as they land.
// ---------------------------------------------------------------

export const proposeHandler: Validator<ProposeAction> = (
  projection: Projection,
  action: ProposeAction,
): ValidationResult => {
  // Universal participant check is already enforced by
  // `validateAction`; re-affirming here is defensive but typed (the
  // `requireParticipant` helper's contract is "fetch the record or
  // surface a typed rejection"). The duplicate check costs one Map
  // lookup; we keep it because per-sub-kind branches may need the
  // participant record (e.g. axiom-mark's `participant` field must
  // match the requester — `validateAxiomMarkProposal` rule 3 uses
  // `action.requester` directly).
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
    case 'axiom-mark': {
      const rejection = validateAxiomMarkProposal(projection, action);
      if (rejection !== null) return rejection;
      break;
    }
    case 'meta-move': {
      const rejection = validateMetaMoveProposal(projection, action);
      if (rejection !== null) return rejection;
      break;
    }
    case 'edit-wording': {
      const rejection = validateEditWordingProposal(projection, action);
      if (rejection !== null) return rejection;
      break;
    }
    case 'break-edge': {
      const rejection = validateBreakEdgeProposal(projection, action);
      if (rejection !== null) return rejection;
      break;
    }
    case 'amend-node': {
      const rejection = validateAmendNodeProposal(projection, action);
      if (rejection !== null) return rejection;
      break;
    }
    case 'annotate': {
      const rejection = validateAnnotateProposal(projection, action);
      if (rejection !== null) return rejection;
      break;
    }
    // The other three sub-kinds (`classify-node`, `set-node-substance`,
    // `set-edge-substance`) fall through to the placeholder emission.
    // Each sub-kind's sibling task tightens its arm as it lands.
    default:
      break;
  }

  // Per ADR 0027 (entity vs facet layer separation), proposals that
  // introduce new entities emit the matching structural events at
  // propose-time alongside the `proposal` envelope. The previous
  // implementation gated `node-created` / `edge-created` /
  // `entity-included` on commit, which violated the methodology
  // contract that proposed entities are visible on the graph from
  // the moment of proposal (`docs/methodology.md` L57). The fix
  // builds a multi-event list with the proposal envelope as the
  // *last* event so consumers that walk the projection in-order see
  // the structural records before the `handleProposal` arm runs
  // (and thus `facetTargetForProposal` resolves the facet against an
  // already-present entity).
  //
  // Each new event needs its own sequence (the WS handler allocates
  // sequences sequentially starting from `action.sequence`; the
  // engine assigns 1 + offset per emitted event). Event ids are
  // freshly minted UUIDs; `action.eventId` is reserved for the
  // `proposal` envelope so the proposal's `proposalEventId`
  // identifier (used by vote / commit / withdraw lookups) stays
  // stable.
  const structuralEvents = buildStructuralEventsForPropose(projection, action);
  const proposalEvent: EventToAppendEnvelope<'proposal'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence + structuralEvents.length,
    kind: 'proposal',
    actor: action.actor,
    payload: { proposal: action.proposal },
    createdAt: action.createdAt,
  };
  return { ok: true, events: [...structuralEvents, proposalEvent] };
};

// ---------------------------------------------------------------
// `buildStructuralEventsForPropose` — emit the propose-time
// structural fan-out per ADR 0027.
//
// Returns the array of structural events that must precede the
// `proposal` envelope event for the given action. Returns an empty
// array when the proposal sub-kind doesn't introduce new entities
// (every sub-kind that targets existing entities — set-node-substance,
// edit-wording.reword, axiom-mark, meta-move, break-edge, amend-node,
// annotate — has no propose-time structural event to emit).
//
// **classify-node**: the proposal carries `node_id`. If the node
// doesn't exist on the projection yet, emit `node-created` +
// `entity-included` so the canvas projector renders the proposed
// entity in `proposed` state (the facet status derives `proposed` so
// long as the proposal is pending). When the node already exists
// (a re-classify against a committed node), no structural events fire.
//
// **set-edge-substance**: the proposal carries `edge_id`. If the
// edge doesn't exist yet (the connecting case where a new statement
// is being proposed with an edge to an existing target), the propose
// flow currently passes through two proposals back-to-back
// (`classify-node` for the source node + `set-edge-substance` for
// the edge). The `set-edge-substance` arm here would mint
// `edge-created` + `entity-included` if it had the source/target/role
// fields, but `setEdgeSubstanceProposalSchema` doesn't carry them
// today — the v1 `useProposeAction` client mints them client-side
// and passes the connecting case as a *single* proposal with the
// existing `set-edge-substance` shape, leaving the source/target
// resolution to the engine. Per refinement Open Questions: extending
// the propose payload to carry the edge endpoints is a follow-up
// (`mod_set_edge_substance_endpoint_carriage`); for now the
// `set-edge-substance` arm cannot mint a fresh `edge-created` without
// those fields. The connecting-case canvas visibility instead lands
// via the source-node `classify-node` propose's `node-created` event
// alone — the edge surfaces post-commit, matching the prior contract
// for the edge but unblocking the source-node visibility.
//
// **decompose / interpretive-split**: each component / reading needs
// a fresh `node-created` + `entity-included`. The proposal payload
// does NOT carry per-component ids today, so the engine mints them
// here and the commit handler reads them back from the projection's
// pending-proposals record. Per refinement Open Questions: a payload
// extension that carries the minted ids inline is a follow-up
// (`mod_decompose_propose_time_canvas_visibility`); for now the
// arms below emit nothing and the regression cover (scenario 3 of
// the failing-first Playwright spec) stays scoped as that follow-up.
// ---------------------------------------------------------------

function buildStructuralEventsForPropose(
  projection: Projection,
  action: ProposeAction,
): EventToAppend[] {
  const events: EventToAppend[] = [];
  // Sequence offsets — the proposal envelope itself takes the last
  // slot; structural events fill the prior slots starting from
  // `action.sequence`.
  const seq = (offset: number): number => action.sequence + offset;

  switch (action.proposal.kind) {
    case 'classify-node': {
      const nodeId = action.proposal.node_id;
      const wording = action.proposal.wording;
      if (projection.getNode(nodeId) === undefined && wording !== undefined) {
        // Free-floating new statement — mint the node and inject it
        // into the session. The client signals the
        // free-floating-vs-re-classify shape by supplying / omitting
        // `wording`; when absent, no `node-created` is emitted.
        const nodeCreated: EventToAppendEnvelope<'node-created'> = {
          id: randomUUID(),
          sessionId: action.sessionId,
          sequence: seq(events.length),
          kind: 'node-created',
          actor: action.actor,
          payload: {
            node_id: nodeId,
            wording,
            created_by: action.requester,
            created_at: action.createdAt,
          },
          createdAt: action.createdAt,
        };
        events.push(nodeCreated);
        const entityIncluded: EventToAppendEnvelope<'entity-included'> = {
          id: randomUUID(),
          sessionId: action.sessionId,
          sequence: seq(events.length),
          kind: 'entity-included',
          actor: action.actor,
          payload: {
            entity_kind: 'node',
            entity_id: nodeId,
            included_by: action.requester,
            included_at: action.createdAt,
          },
          createdAt: action.createdAt,
        };
        events.push(entityIncluded);
      }
      break;
    }
    case 'set-edge-substance': {
      // See header comment — the v1 proposal payload doesn't carry
      // edge endpoints (source/target/role) so we can't mint a
      // `edge-created` here. The connecting-case source node IS
      // covered: the client's two-envelope `classify-node` +
      // `set-edge-substance` chain produces the source node via the
      // first envelope's `node-created` emission above. Extending
      // this arm is the follow-up
      // `mod_set_edge_substance_endpoint_carriage`.
      break;
    }
    default:
      break;
  }
  return events;
}

// Backward-compatibility alias — the engine's `installHandlers` and the
// barrel both still reference `placeholderProposeHandler`. After this
// task the symbol is no longer a placeholder for the `decompose`,
// `interpretive-split`, `axiom-mark`, `meta-move`, `edit-wording`,
// `break-edge`, `amend-node`, or `annotate` arms (it's the real
// validator there), but the name is preserved so the import sites in
// `engine.ts` and `handlers/index.ts` don't need to churn ahead of the
// remaining three sibling sub-kind tasks (`classify-node`,
// `set-node-substance`, `set-edge-substance`). Once those tighten, the
// alias and the file comment header should be revisited.
export const placeholderProposeHandler = proposeHandler;

export default proposeHandler;
