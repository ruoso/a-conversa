// In-memory graph projection types.
//
// Refinement: tasks/refinements/data-and-methodology/projection_data_structure.md
// TaskJuggler: data_and_methodology.projection.projection_data_structure
//
// Additional state shapes (participants, sessionState, snapshots,
// unresolvedMetaDisagreements) added by `project_from_log`:
// tasks/refinements/data-and-methodology/project_from_log.md.
//
// `ProjectionChange` discriminated union and the contract that
// `applyEvent` reports per-event mutations through it are added by
// `project_incrementally`:
// tasks/refinements/data-and-methodology/project_incrementally.md.
//
// Storage shape only. Per-facet status derivation, event-handling, and
// active-firing computation live in their own tasks; the shapes here
// reserve slots for them (`PerParticipantFacetState` maps, axiom-mark
// maps, derived `FacetState` fields) without owning the population or
// derivation rules.

import type {
  AnnotationKind,
  EdgeRole,
  EntityKind,
  ProposalPayload,
  StatementKind,
} from '@a-conversa/shared-types';

// `FacetStatus` widened (additively) by `per_facet_status_derivation`:
// the four agreement-layer values (`proposed | agreed | disputed |
// meta-disagreement`) are what the dispatcher writes onto
// `FacetState.status`; `committed` and `withdrawn` are output-only
// values produced by `deriveFacetStatus` (facet-status.ts) on top of
// the agreement-layer state plus the commit marker. Keeping the two
// new values in this single union (rather than a separate enum) lets
// consumers store one shape regardless of source.
//
// `'awaiting-proposal'` is added (additively) by
// `pf_awaiting_proposal_facet_status` per
// [ADR 0030 §10](../../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md):
// the entity exists but no candidate value has been set for that
// facet yet (most commonly a freshly-captured node's `classification`
// and `substance` facets, before the moderator has run their
// respective proposal gestures). This task ships the type widening
// only; actual emission of the new value from `deriveFacetStatus`
// lands in the downstream `pf_projection_facet_status_refactor` task.
// Per ADR 0021's `noFallthroughCasesInSwitch` + `never` default
// pattern, exhaustive `switch`es over `FacetStatus` in downstream
// consumers will go red until each consumer task closes its own
// coverage — that compile-time breakage is the surface against which
// the per-consumer tasks work, by design.
export type FacetStatus =
  | 'proposed'
  | 'agreed'
  | 'disputed'
  | 'committed'
  | 'withdrawn'
  | 'meta-disagreement'
  | 'awaiting-proposal';

// Per ADR 0030 §3 + `pf_facet_keyed_vote_payload` (commit `a2521f6`) +
// `pf_withdraw_agreement_handler` (commit `8518fff`): the `vote.choice`
// enum is `'agree' | 'dispute'`; withdrawal is its own first-class event
// kind (`withdraw-agreement`). The clean-break migration policy of ADR
// 0030 retires the legacy `'withdraw'` choice arm — `PerParticipantVote`
// no longer carries it. Withdrawals are tracked on `FacetState.withdrawals`
// (a separate `Set<string>` populated by the withdraw-agreement handler),
// not as a third vote arm. The audit task `pf_unit_test_audit` closed the
// provisional back-compat the refactor had retained.
export type PerParticipantVote = 'agree' | 'dispute';

export interface PerParticipantFacetState {
  vote: PerParticipantVote;
  proposalEventId: string;
  votedAt: string;
}

// `FacetState` shape — owned by `per_facet_status_derivation`, reshaped
// by `pf_projection_facet_status_refactor` per ADR 0030 §7 + Consequences:
// the facet's identity is the `(entity_kind, entity_id, facet)` pair, not
// the proposal id that last touched it. The projection tracks the
// facet's current candidate value (set by `node-created.wording` /
// `edge-created.shape` for inline candidates, OR by the latest
// facet-valued proposal targeting the facet for proposal-derived
// candidates), the proposal that supplied it (`null` for inline-from-
// creation), whether the current candidate has been committed (via
// `committedAt` + `committedCandidateValue` — committing pins the value
// at commit time so a later proposal supersedes detection is a direct
// comparison), the per-participant vote map (votes attach to
// `(entity, facet)`, not to a proposal id), the `metaDisagreement` flag
// (set when a facet-keyed meta-disagreement-marked event lands), and the
// per-participant withdrawals set (populated by the new
// `withdraw-agreement` event kind per ADR 0030 §3).
//
// `committedProposalEventId` — retained for back-compat with the
// snapshot wire shape consumers, mirrors the proposal id that produced
// the *current commit* (if any). Updated by the commit handler in lock-
// step with `committedAt`.
//
// A new candidate landing on this facet (via a fresh proposal) clears
// `perParticipant` — old votes were votes against the old candidate
// per ADR 0030 §7. The commit marker is NOT cleared by a new proposal
// — instead, a later proposal supersedes the committed value, and the
// derivation reads `committedCandidateValue !== candidateValue` as
// "the current candidate has not (yet) been committed."
export interface FacetState<TValue> {
  status: FacetStatus;
  value: TValue | null;
  /**
   * The current candidate value for the facet. `null` while the facet
   * is `awaiting-proposal` (no candidate yet). Set by inline-creation
   * events (`node-created.wording`, `edge-created.shape` — `null` for
   * `classification` / `substance` until a proposal arrives) or by the
   * latest facet-valued proposal targeting this facet.
   */
  candidateValue: TValue | null;
  /**
   * The proposal event id that supplied the current `candidateValue`,
   * if any. `null` when `candidateValue` came inline from creation
   * (no proposal supplied it) — for wording on `node-created` and
   * shape on `edge-created`.
   */
  candidateProposalEventId: string | null;
  perParticipant: Map<string, PerParticipantFacetState>;
  committedProposalEventId: string | null;
  committedAt: string | null;
  /**
   * The value at commit time. Used to detect "is the current candidate
   * still the committed one, or has a new proposal superseded it?". The
   * derivation compares `committedCandidateValue` against
   * `candidateValue` to decide whether to surface `'committed'` (still
   * the same value) vs. some other state (a fresh candidate has landed
   * since commit). `null` until a commit lands.
   */
  committedCandidateValue: TValue | null;
  /**
   * Per-participant withdrawals (populated by `withdraw-agreement`
   * events per ADR 0030 §3). When a current participant appears in
   * this set AND the facet's current candidate has been committed,
   * the derivation surfaces `'withdrawn'` (the participant has
   * rescinded their agreement on the committed value, returning the
   * facet to disputed semantically).
   */
  withdrawals: Set<string>;
  /**
   * Set to `true` by a facet-keyed meta-disagreement-marked event
   * (or by the proposal-keyed meta-disagreement-marked handler against
   * a facet-valued proposal during the proposal-keyed → facet-keyed
   * transition). Distinct from `status === 'meta-disagreement'` because
   * the status field is the agreement-layer mirror and may be reset
   * by `'proposed'` when a fresh candidate lands; the flag is the
   * facet-keyed derivation's signal.
   */
  metaDisagreement: boolean;
}

// Owned by `per_facet_status_derivation`. Records a commit so the
// vote handler can resolve `withdraw` votes against proposals that
// have left `pendingProposals`, and so future inspection of
// committed history doesn't require a log re-walk.
export interface CommittedProposalRecord {
  proposalEventId: string;
  payload: ProposalPayload;
  committedAt: string;
  moderator: string | null;
}

export interface AxiomMarkRecord {
  proposalEventId: string;
  markedAt: string;
}

export interface PendingProposal {
  proposalEventId: string;
  payload: ProposalPayload;
  proposer: string | null;
  proposedAt: string;
  /**
   * Per-participant vote state for structural proposal sub-kinds
   * (`decompose`, `interpretive-split`, `axiom-mark`, `meta-move`,
   * `break-edge`, `amend-node`, `annotate`). The four facet-targeting
   * sub-kinds (`classify-node`, `set-node-substance`,
   * `set-edge-substance`, `edit-wording`) project per-participant votes
   * onto the target facet's `perParticipant` map instead, so this map
   * is unused for them.
   *
   * Populated by `handleVote` when the projection's
   * `firstFacetTargetForVote` wrapper returns `null` (i.e. the proposal
   * is structural). Consulted by the methodology engine's `commit`
   * handler to evaluate the unanimous-agree rule across current
   * participants for structural sub-kinds.
   *
   * Owned by the structural-sub-kind commit logic — see
   * `apps/server/src/methodology/handlers/commit.ts` for the
   * unanimity walk against this map.
   */
  perParticipantVotes: Map<string, PerParticipantFacetState>;
}

export interface ProjectedNode {
  id: string;
  wording: string;
  createdBy: string;
  createdAt: string;
  visible: boolean;
  wordingFacet: FacetState<string>;
  classificationFacet: FacetState<StatementKind>;
  substanceFacet: FacetState<'agreed' | 'disputed'>;
  axiomMarks: Map<string, AxiomMarkRecord>;
}

// Per ADR 0030 §5 + `pf_projection_facet_status_refactor`: edge `shape`
// (role + endpoints) is an inline candidate on `edge-created` — the
// facet enters life with the carriage as its `candidateValue` and the
// same lifecycle as the wording facet on a node. v1 has no edge-shape-
// edit proposal kind, so the facet stays at `'proposed'` (votes can
// accrue against it) → `'agreed'` → `'committed'` via a future
// `edit-edge-shape` proposal, if one is ever added. Until then, the
// facet's `candidateValue` is the inline carriage and the derivation
// returns `'proposed'` (with no votes / commit) or `'agreed'` / etc.
// once votes land. See `facetStateForTarget` for the resolution.
export type EdgeShape = {
  readonly role: EdgeRole;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
};

export interface ProjectedEdge {
  id: string;
  role: EdgeRole;
  sourceNodeId: string;
  targetNodeId: string;
  createdBy: string;
  createdAt: string;
  visible: boolean;
  shapeFacet: FacetState<EdgeShape>;
  substanceFacet: FacetState<'agreed' | 'disputed'>;
}

export interface ProjectedAnnotation {
  id: string;
  kind: AnnotationKind;
  content: string;
  targetNodeId: string | null;
  targetEdgeId: string | null;
  createdBy: string;
  createdAt: string;
  visible: boolean;
  wordingFacet: FacetState<string>;
  substanceFacet: FacetState<'agreed' | 'disputed'>;
}

export interface NewNodeInput {
  id: string;
  wording: string;
  createdBy: string;
  createdAt: string;
}

export interface NewEdgeInput {
  id: string;
  role: EdgeRole;
  sourceNodeId: string;
  targetNodeId: string;
  createdBy: string;
  createdAt: string;
}

export interface NewAnnotationInput {
  id: string;
  kind: AnnotationKind;
  content: string;
  targetNodeId: string | null;
  targetEdgeId: string | null;
  createdBy: string;
  createdAt: string;
}

export type SessionState = 'open' | 'ended';

// `SessionMode` — the lobby/operate phase the moderator has advanced
// the session into. Per ADR 0028 the lobby → operate transition is
// signalled by a dedicated `session-mode-changed` wire event; the
// projector flips the field on the event's arrival. Default `'lobby'`
// on construction so a fresh projection (or a projection rebuilt from
// an event log predating the event kind) reads honestly without a
// projector-arm assumption.
//
// Refinement: tasks/refinements/participant-ui/part_session_start_handoff_dedicated_event.md
export type SessionMode = 'lobby' | 'operate';

export type ParticipantRole = 'moderator' | 'debater-A' | 'debater-B';

export interface ParticipantRecord {
  userId: string;
  role: ParticipantRole;
  screenName: string;
  joinedAt: string;
  leftAt: string | null;
}

export interface SnapshotRecord {
  snapshotId: string;
  label: string;
  logPosition: number;
  createdAt: string;
}

export interface UnresolvedMetaDisagreement {
  proposalEventId: string;
  payload: ProposalPayload;
  proposer: string | null;
  proposedAt: string;
  markedBy: string | null;
  markedAt: string;
}

// ---------------------------------------------------------------
// ProjectionChange — owned by `project_incrementally`.
//
// The per-event change feed `applyEvent` returns. Each variant
// names one mutation the event caused on the projection. The
// eventual WS broadcaster (downstream backend task, not this one)
// reads the feed to emit per-client deltas; the methodology UI
// reads it to highlight what's new.
//
// **Discriminator stability**: this shape is a downstream contract.
// New event kinds may add new variants here; existing variants do
// not change without a coordinated downstream update. See the
// `project_incrementally` refinement for the rationale of each
// kind.
// ---------------------------------------------------------------

// Per ADR 0030 §5 + `pf_shape_facet_wire_vote`: the `'shape'` facet
// (edge role + endpoints, inline candidate on `edge-created`) joins
// the three pre-existing facets so the per-facet keying applies
// symmetrically to edges. The widening is mirrored on the wire by
// `facetNameSchema` in `packages/shared-types/src/events/enums.ts`
// (the two must stay in lockstep). Consumers with an exhaustive
// `switch` over `FacetName` close the `'shape'` arm in lock-step;
// the relevant facet-resolution helpers (`facetStateForTarget`,
// `resolveFacet`, `lookupFacetState`) gain an `edge.shapeFacet` arm
// alongside the existing `edge.substanceFacet` arm.
export type FacetName = 'classification' | 'substance' | 'wording' | 'shape';

export type ChangeEntityKind = 'node' | 'edge' | 'annotation';

export interface SessionStateChanged {
  kind: 'session-state-changed';
  state: SessionState;
}

// Per ADR 0028 — the projector's `session-mode-changed` arm appends
// this entry to the change feed when a `'session-mode-changed'` event
// applies. Downstream consumers (the future replay surface; a
// hypothetical operator dashboard) read it to highlight the
// transition; the participant lobby's auto-navigation `useEffect`
// reads the event directly off the WS slice, not via the change feed.
export interface SessionModeChanged {
  kind: 'session-mode-changed';
  previousMode: SessionMode;
  newMode: SessionMode;
}

export interface ParticipantJoinedChange {
  kind: 'participant-joined';
  userId: string;
  role: ParticipantRole;
}

export interface ParticipantLeftChange {
  kind: 'participant-left';
  userId: string;
}

export interface NodeAddedChange {
  kind: 'node-added';
  nodeId: string;
}

export interface EdgeAddedChange {
  kind: 'edge-added';
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  role: EdgeRole;
}

export interface AnnotationAddedChange {
  kind: 'annotation-added';
  annotationId: string;
  targetNodeId: string | null;
  targetEdgeId: string | null;
}

export interface EntityIncludedChange {
  kind: 'entity-included';
  entityKind: EntityKind;
  entityId: string;
}

export interface PendingProposalAddedChange {
  kind: 'pending-proposal-added';
  proposalId: string;
}

export interface PendingProposalClearedChange {
  kind: 'pending-proposal-cleared';
  proposalId: string;
  reason: 'commit' | 'meta-disagreement';
}

export interface VoteRecordedChange {
  kind: 'vote-recorded';
  proposalId: string;
  participantId: string;
  vote: PerParticipantVote;
}

export interface FacetUpdatedChange {
  kind: 'facet-updated';
  entityKind: ChangeEntityKind;
  entityId: string;
  facet: FacetName;
  value: string;
  status: FacetStatus;
}

export interface VisibilityChangedChange {
  kind: 'visibility-changed';
  entityKind: ChangeEntityKind;
  entityId: string;
  visible: boolean;
}

export interface AxiomMarkAddedChange {
  kind: 'axiom-mark-added';
  nodeId: string;
  participantId: string;
}

export interface MetaDisagreementMarkedChange {
  kind: 'meta-disagreement-marked';
  proposalId: string;
}

export interface SnapshotAddedChange {
  kind: 'snapshot-added';
  snapshotId: string;
  label: string;
  logPosition: number;
}

export interface NodeWordingUpdatedChange {
  kind: 'node-wording-updated';
  nodeId: string;
  wording: string;
}

export type ProjectionChange =
  | SessionStateChanged
  | SessionModeChanged
  | ParticipantJoinedChange
  | ParticipantLeftChange
  | NodeAddedChange
  | EdgeAddedChange
  | AnnotationAddedChange
  | EntityIncludedChange
  | PendingProposalAddedChange
  | PendingProposalClearedChange
  | VoteRecordedChange
  | FacetUpdatedChange
  | VisibilityChangedChange
  | AxiomMarkAddedChange
  | MetaDisagreementMarkedChange
  | SnapshotAddedChange
  | NodeWordingUpdatedChange;
