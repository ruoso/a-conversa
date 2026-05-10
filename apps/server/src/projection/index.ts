// Barrel for `apps/server/src/projection`.
//
// Refinements:
//   - tasks/refinements/data-and-methodology/projection_data_structure.md
//   - tasks/refinements/data-and-methodology/project_from_log.md
//   - tasks/refinements/data-and-methodology/project_incrementally.md

export { Projection, ProjectionInvariantError, createEmptyProjection } from './projection.js';
export type {
  AnnotationAddedChange,
  AxiomMarkAddedChange,
  AxiomMarkRecord,
  ChangeEntityKind,
  EdgeAddedChange,
  EntityIncludedChange,
  FacetName,
  FacetState,
  FacetStatus,
  FacetUpdatedChange,
  MetaDisagreementMarkedChange,
  NewAnnotationInput,
  NewEdgeInput,
  NewNodeInput,
  NodeAddedChange,
  NodeWordingUpdatedChange,
  ParticipantJoinedChange,
  ParticipantLeftChange,
  ParticipantRecord,
  ParticipantRole,
  PendingProposal,
  PendingProposalAddedChange,
  PendingProposalClearedChange,
  PerParticipantFacetState,
  PerParticipantVote,
  ProjectedAnnotation,
  ProjectedEdge,
  ProjectedNode,
  ProjectionChange,
  SessionState,
  SessionStateChanged,
  SnapshotAddedChange,
  SnapshotRecord,
  UnresolvedMetaDisagreement,
  VisibilityChangedChange,
  VoteRecordedChange,
} from './types.js';
export { applyEvent, OutOfOrderEventError, projectFromLog, ReplayError } from './replay.js';
export { applyEventIncremental } from './incremental.js';
