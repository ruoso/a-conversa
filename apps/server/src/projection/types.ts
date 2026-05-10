// In-memory graph projection types.
//
// Refinement: tasks/refinements/data-and-methodology/projection_data_structure.md
// TaskJuggler: data_and_methodology.projection.projection_data_structure
//
// Storage shape only. Per-facet status derivation, event-handling, and
// active-firing computation live in their own tasks; the shapes here
// reserve slots for them (`PerParticipantFacetState` maps, axiom-mark
// maps, derived `FacetState` fields) without owning the population or
// derivation rules.

import type {
  AnnotationKind,
  EdgeRole,
  ProposalPayload,
  StatementKind,
} from '@a-conversa/shared-types';

export type FacetStatus = 'proposed' | 'agreed' | 'disputed' | 'meta-disagreement';

export type PerParticipantVote = 'agree' | 'dispute' | 'withdraw';

export interface PerParticipantFacetState {
  vote: PerParticipantVote;
  proposalEventId: string;
  votedAt: string;
}

export interface FacetState<TValue> {
  status: FacetStatus;
  value: TValue | null;
  perParticipant: Map<string, PerParticipantFacetState>;
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
