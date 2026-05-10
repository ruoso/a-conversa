// In-memory graph projection — storage layer.
//
// Refinement: tasks/refinements/data-and-methodology/projection_data_structure.md
// TaskJuggler: data_and_methodology.projection.projection_data_structure
//
// Holds a single session's projected graph state plus the indices
// downstream tasks (`project_from_log`, `project_incrementally`,
// `per_facet_status_derivation`, `active_firing_computation`,
// `projection_caching`) read and write. This module owns the storage
// invariants only — event-handling and per-facet derivation rules
// live in those downstream tasks.

import type {
  FacetState,
  NewAnnotationInput,
  NewEdgeInput,
  NewNodeInput,
  PendingProposal,
  ProjectedAnnotation,
  ProjectedEdge,
  ProjectedNode,
} from './types.js';

export class ProjectionInvariantError extends Error {
  override readonly name = 'ProjectionInvariantError';
}

function emptyFacet<TValue>(): FacetState<TValue> {
  return {
    status: 'proposed',
    value: null,
    perParticipant: new Map(),
  };
}

function buildNode(input: NewNodeInput): ProjectedNode {
  return {
    id: input.id,
    wording: input.wording,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    visible: true,
    wordingFacet: { ...emptyFacet<string>(), value: input.wording },
    classificationFacet: emptyFacet(),
    substanceFacet: emptyFacet(),
    axiomMarks: new Map(),
  };
}

function buildEdge(input: NewEdgeInput): ProjectedEdge {
  return {
    id: input.id,
    role: input.role,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    visible: true,
    substanceFacet: emptyFacet(),
  };
}

function buildAnnotation(input: NewAnnotationInput): ProjectedAnnotation {
  if ((input.targetNodeId === null) === (input.targetEdgeId === null)) {
    throw new ProjectionInvariantError(
      `annotation ${input.id}: exactly one of targetNodeId / targetEdgeId must be set`,
    );
  }
  return {
    id: input.id,
    kind: input.kind,
    content: input.content,
    targetNodeId: input.targetNodeId,
    targetEdgeId: input.targetEdgeId,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    visible: true,
    wordingFacet: { ...emptyFacet<string>(), value: input.content },
    substanceFacet: emptyFacet(),
  };
}

export class Projection {
  readonly sessionId: string;

  readonly #nodes = new Map<string, ProjectedNode>();
  readonly #edges = new Map<string, ProjectedEdge>();
  readonly #annotations = new Map<string, ProjectedAnnotation>();

  readonly #edgesBySource = new Map<string, Set<string>>();
  readonly #edgesByTarget = new Map<string, Set<string>>();
  readonly #annotationsByNode = new Map<string, Set<string>>();
  readonly #annotationsByEdge = new Map<string, Set<string>>();

  readonly #pendingProposals = new Map<string, PendingProposal>();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  addNode(input: NewNodeInput): ProjectedNode {
    if (this.#nodes.has(input.id)) {
      throw new ProjectionInvariantError(`node ${input.id} already present`);
    }
    const node = buildNode(input);
    this.#nodes.set(node.id, node);
    return node;
  }

  removeNode(nodeId: string): void {
    if (!this.#nodes.has(nodeId)) return;
    const outgoing = this.#edgesBySource.get(nodeId);
    const incoming = this.#edgesByTarget.get(nodeId);
    const incidentEdgeIds = new Set<string>();
    if (outgoing) for (const id of outgoing) incidentEdgeIds.add(id);
    if (incoming) for (const id of incoming) incidentEdgeIds.add(id);
    for (const edgeId of incidentEdgeIds) this.removeEdge(edgeId);

    const annotationIds = this.#annotationsByNode.get(nodeId);
    if (annotationIds) {
      for (const annotationId of [...annotationIds]) this.removeAnnotation(annotationId);
    }

    this.#edgesBySource.delete(nodeId);
    this.#edgesByTarget.delete(nodeId);
    this.#annotationsByNode.delete(nodeId);
    this.#nodes.delete(nodeId);
  }

  addEdge(input: NewEdgeInput): ProjectedEdge {
    if (this.#edges.has(input.id)) {
      throw new ProjectionInvariantError(`edge ${input.id} already present`);
    }
    const edge = buildEdge(input);
    this.#edges.set(edge.id, edge);
    addToIndex(this.#edgesBySource, edge.sourceNodeId, edge.id);
    addToIndex(this.#edgesByTarget, edge.targetNodeId, edge.id);
    return edge;
  }

  removeEdge(edgeId: string): void {
    const edge = this.#edges.get(edgeId);
    if (!edge) return;

    const annotationIds = this.#annotationsByEdge.get(edgeId);
    if (annotationIds) {
      for (const annotationId of [...annotationIds]) this.removeAnnotation(annotationId);
    }

    removeFromIndex(this.#edgesBySource, edge.sourceNodeId, edgeId);
    removeFromIndex(this.#edgesByTarget, edge.targetNodeId, edgeId);
    this.#annotationsByEdge.delete(edgeId);
    this.#edges.delete(edgeId);
  }

  addAnnotation(input: NewAnnotationInput): ProjectedAnnotation {
    if (this.#annotations.has(input.id)) {
      throw new ProjectionInvariantError(`annotation ${input.id} already present`);
    }
    const annotation = buildAnnotation(input);
    this.#annotations.set(annotation.id, annotation);
    if (annotation.targetNodeId !== null) {
      addToIndex(this.#annotationsByNode, annotation.targetNodeId, annotation.id);
    } else if (annotation.targetEdgeId !== null) {
      addToIndex(this.#annotationsByEdge, annotation.targetEdgeId, annotation.id);
    }
    return annotation;
  }

  removeAnnotation(annotationId: string): void {
    const annotation = this.#annotations.get(annotationId);
    if (!annotation) return;
    if (annotation.targetNodeId !== null) {
      removeFromIndex(this.#annotationsByNode, annotation.targetNodeId, annotationId);
    } else if (annotation.targetEdgeId !== null) {
      removeFromIndex(this.#annotationsByEdge, annotation.targetEdgeId, annotationId);
    }
    this.#annotations.delete(annotationId);
  }

  setNodeVisible(nodeId: string, visible: boolean): void {
    const node = this.#nodes.get(nodeId);
    if (!node) {
      throw new ProjectionInvariantError(`node ${nodeId} not present`);
    }
    node.visible = visible;
  }

  setEdgeVisible(edgeId: string, visible: boolean): void {
    const edge = this.#edges.get(edgeId);
    if (!edge) {
      throw new ProjectionInvariantError(`edge ${edgeId} not present`);
    }
    edge.visible = visible;
  }

  setAnnotationVisible(annotationId: string, visible: boolean): void {
    const annotation = this.#annotations.get(annotationId);
    if (!annotation) {
      throw new ProjectionInvariantError(`annotation ${annotationId} not present`);
    }
    annotation.visible = visible;
  }

  getNode(nodeId: string): ProjectedNode | undefined {
    return this.#nodes.get(nodeId);
  }

  getEdge(edgeId: string): ProjectedEdge | undefined {
    return this.#edges.get(edgeId);
  }

  getAnnotation(annotationId: string): ProjectedAnnotation | undefined {
    return this.#annotations.get(annotationId);
  }

  getEdgesBySource(nodeId: string): ProjectedEdge[] {
    return collectByIndex(this.#edgesBySource, this.#edges, nodeId);
  }

  getEdgesByTarget(nodeId: string): ProjectedEdge[] {
    return collectByIndex(this.#edgesByTarget, this.#edges, nodeId);
  }

  getAnnotationsByNode(nodeId: string): ProjectedAnnotation[] {
    return collectByIndex(this.#annotationsByNode, this.#annotations, nodeId);
  }

  getAnnotationsByEdge(edgeId: string): ProjectedAnnotation[] {
    return collectByIndex(this.#annotationsByEdge, this.#annotations, edgeId);
  }

  addPendingProposal(proposal: PendingProposal): void {
    if (this.#pendingProposals.has(proposal.proposalEventId)) {
      throw new ProjectionInvariantError(
        `pending proposal ${proposal.proposalEventId} already present`,
      );
    }
    this.#pendingProposals.set(proposal.proposalEventId, proposal);
  }

  removePendingProposal(proposalEventId: string): void {
    this.#pendingProposals.delete(proposalEventId);
  }

  getPendingProposal(proposalEventId: string): PendingProposal | undefined {
    return this.#pendingProposals.get(proposalEventId);
  }

  nodeCount(): number {
    return this.#nodes.size;
  }

  edgeCount(): number {
    return this.#edges.size;
  }

  annotationCount(): number {
    return this.#annotations.size;
  }

  pendingProposalCount(): number {
    return this.#pendingProposals.size;
  }

  nodes(): IterableIterator<ProjectedNode> {
    return this.#nodes.values();
  }

  edges(): IterableIterator<ProjectedEdge> {
    return this.#edges.values();
  }

  annotations(): IterableIterator<ProjectedAnnotation> {
    return this.#annotations.values();
  }

  pendingProposals(): IterableIterator<PendingProposal> {
    return this.#pendingProposals.values();
  }
}

export function createEmptyProjection(sessionId: string): Projection {
  return new Projection(sessionId);
}

function addToIndex(index: Map<string, Set<string>>, key: string, value: string): void {
  let bucket = index.get(key);
  if (!bucket) {
    bucket = new Set();
    index.set(key, bucket);
  }
  bucket.add(value);
}

function removeFromIndex(index: Map<string, Set<string>>, key: string, value: string): void {
  const bucket = index.get(key);
  if (!bucket) return;
  bucket.delete(value);
  if (bucket.size === 0) index.delete(key);
}

function collectByIndex<T>(
  index: Map<string, Set<string>>,
  store: Map<string, T>,
  key: string,
): T[] {
  const bucket = index.get(key);
  if (!bucket) return [];
  const out: T[] = [];
  for (const id of bucket) {
    const entry = store.get(id);
    if (entry !== undefined) out.push(entry);
  }
  return out;
}
