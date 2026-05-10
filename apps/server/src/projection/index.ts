// Barrel for `apps/server/src/projection`.
//
// Refinements:
//   - tasks/refinements/data-and-methodology/projection_data_structure.md
//   - tasks/refinements/data-and-methodology/project_from_log.md

export { Projection, ProjectionInvariantError, createEmptyProjection } from './projection.js';
export type {
  AxiomMarkRecord,
  FacetState,
  FacetStatus,
  NewAnnotationInput,
  NewEdgeInput,
  NewNodeInput,
  ParticipantRecord,
  ParticipantRole,
  PendingProposal,
  PerParticipantFacetState,
  PerParticipantVote,
  ProjectedAnnotation,
  ProjectedEdge,
  ProjectedNode,
  SessionState,
  SnapshotRecord,
  UnresolvedMetaDisagreement,
} from './types.js';
export { applyEvent, projectFromLog, ReplayError } from './replay.js';
