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
export type FacetStatus =
  | 'proposed'
  | 'agreed'
  | 'disputed'
  | 'committed'
  | 'withdrawn'
  | 'meta-disagreement';

export type PerParticipantVote = 'agree' | 'dispute' | 'withdraw';

export interface PerParticipantFacetState {
  vote: PerParticipantVote;
  proposalEventId: string;
  votedAt: string;
}

// `FacetState.committedProposalEventId` / `committedAt` (additive,
// owned by `per_facet_status_derivation`):
// populated by `handleCommit` for facet-targeting proposal sub-kinds
// so `deriveFacetStatus` can identify "was committed once" without
// re-walking the log. Both default to `null` until a commit lands.
export interface FacetState<TValue> {
  status: FacetStatus;
  value: TValue | null;
  perParticipant: Map<string, PerParticipantFacetState>;
  committedProposalEventId: string | null;
  committedAt: string | null;
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

export interface ProjectedEdge {
  id: string;
  role: EdgeRole;
  sourceNodeId: string;
  targetNodeId: string;
  createdBy: string;
  createdAt: string;
  visible: boolean;
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

export type FacetName = 'classification' | 'substance' | 'wording';

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
