// Barrel for `apps/server/src/projection`.
//
// Refinements:
//   - tasks/refinements/data-and-methodology/projection_data_structure.md
//   - tasks/refinements/data-and-methodology/project_from_log.md
//   - tasks/refinements/data-and-methodology/project_incrementally.md
//   - tasks/refinements/data-and-methodology/project_at_position.md
//   - tasks/refinements/data-and-methodology/per_facet_status_derivation.md
//   - tasks/refinements/data-and-methodology/active_firing_computation.md
//   - tasks/refinements/data-and-methodology/projection_caching.md

// Re-exported from @a-conversa/shared-types for the convenience of step files
// that mock or construct event envelopes alongside the projection types.
export type { Event } from '@a-conversa/shared-types';

export { ProjectionCache } from './cache.js';
export type { EventLoader, ProjectionCacheOptions } from './cache.js';
export { Projection, ProjectionInvariantError, createEmptyProjection } from './projection.js';
export type {
  AnnotationAddedChange,
  AxiomMarkAddedChange,
  AxiomMarkRecord,
  ChangeEntityKind,
  CommittedProposalRecord,
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
export { projectAtPosition, ReplayPositionError } from './at-position.js';
export { applyEventIncremental } from './incremental.js';
export {
  deriveFacetStatus,
  deriveFacetStatusFromState,
  FacetStatusDerivationError,
  type DeriveEntityKind,
} from './facet-status.js';
export { ActiveFiringComputationError, getActiveFiring, isEdgeActive } from './active-firing.js';
