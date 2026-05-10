// Barrel for `apps/server/src/projection`.
//
// Refinement: tasks/refinements/data-and-methodology/projection_data_structure.md

export { Projection, ProjectionInvariantError, createEmptyProjection } from './projection.js';
export type {
  AxiomMarkRecord,
  FacetState,
  FacetStatus,
  NewAnnotationInput,
  NewEdgeInput,
  NewNodeInput,
  PendingProposal,
  PerParticipantFacetState,
  PerParticipantVote,
  ProjectedAnnotation,
  ProjectedEdge,
  ProjectedNode,
} from './types.js';
