// Pure projection from a per-session WS event log to Cytoscape
// element descriptors.
//
// Refinement: tasks/refinements/participant-ui/part_graph_render.md
//   (Decision §4 — projection lives in the participant workspace; the
//    moderator's `projectNodes` + `selectEdgesForSession` projection is
//    the canonical algorithm — same single-pass walk, same proposal +
//    commit dance for the kind label — but the output shape differs
//    because Cytoscape's element-descriptor shape is different from
//    ReactFlow's `Node[]` / `Edge[]`. Decision §5 documents the
//    combined `projectGraph` return shape — `{ nodes, edges }` from
//    one pass — and the rationale for not splitting like the
//    moderator does.)
// Refinement: tasks/refinements/participant-ui/part_per_facet_state_styling.md
//   (Constraints — `projectGraph` signature widens to take a
//    `FacetStatusIndex` argument; every emitted node / edge data object
//    carries `facetStatuses` + `rollupStatus`. `rollupStatus` is the
//    literal sentinel string `'none'` when the per-entity record is
//    empty so Cytoscape's selectors have a stable value to match — see
//    Decision §4.)
// ADRs:
//   - 0004 (Cytoscape.js for the read-mostly participant tablet);
//   - 0021 (event envelope shape — the shell client validates incoming
//           envelopes at parse time, so this projection trusts the
//           discriminated-union narrowing);
//   - 0022 (no throwaway verifications — every behavioural assertion
//           lives in `projectGraph.test.ts`);
//   - 0027 (entity / facet layers are strictly separate — `node-created`
//           lands at propose-time so the canvas paints proposed entities
//           the moment of proposal; the kind label flips when a
//           `classify-node` proposal commits, not before).
//
// The function is pure and exported separately from `GraphView.tsx` so
// the algorithm can be unit-tested without mounting Cytoscape. The
// same testability rationale the moderator's `projectNodes` /
// `selectEdgesForSession` split applies, even though we don't split
// per Decision §5.

import type { ElementDefinition } from 'cytoscape';
import type { EdgeRole, Event, StatementKind } from '@a-conversa/shared-types';

import {
  cardRollupStatus,
  EMPTY_FACET_STATUSES,
  type FacetName,
  type FacetStatus,
  type FacetStatusIndex,
} from './facetStatus';

/**
 * The per-node payload `projectGraph` emits on each `node-created`
 * descriptor's `data` slot.
 *
 * The `kind` field starts at `null` for every emitted node and flips
 * to a `StatementKind` when a `commit` of a `classify-node` proposal
 * referencing the node lands. Mirrors the moderator's
 * `StatementNodeData.kind: StatementKind | null` shape.
 *
 * `facetStatuses` carries the per-facet `FacetStatus` record from the
 * `FacetStatusIndex` argument (or `EMPTY_FACET_STATUSES` when the
 * index has no entry for this node). `rollupStatus` is the highest-
 * priority status per `cardRollupStatus`, or the literal sentinel
 * `'none'` when the record is empty (so Cytoscape's
 * `[rollupStatus = '<status>']` selectors have a stable value to
 * match on — `undefined` would not).
 */
export interface ParticipantNodeData {
  /** Node id (mirrors Cytoscape's `data.id` convention). */
  readonly id: string;
  /** Original wording from the `node-created` payload. */
  readonly wording: string;
  /** Committed classification, or `null` while the node is unclassified. */
  readonly kind: StatementKind | null;
  /** Per-facet status record, sourced from the `FacetStatusIndex`. */
  readonly facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>;
  /** Highest-priority facet status, or `'none'` (sentinel) when empty. */
  readonly rollupStatus: FacetStatus | 'none';
}

/**
 * The per-edge payload `projectGraph` emits on each `edge-created`
 * descriptor's `data` slot.
 *
 * Mirrors the moderator's `StatementEdgeData.role` plus the id /
 * source / target shape Cytoscape requires on every edge data record.
 * `facetStatuses` / `rollupStatus` same shape + sentinel as
 * `ParticipantNodeData`.
 */
export interface ParticipantEdgeData {
  /** Edge id (mirrors Cytoscape's `data.id` convention). */
  readonly id: string;
  /** Source-node id (mirrors Cytoscape's `data.source` convention). */
  readonly source: string;
  /** Target-node id (mirrors Cytoscape's `data.target` convention). */
  readonly target: string;
  /** Methodology edge role (`supports`, `rebuts`, etc.). */
  readonly role: EdgeRole;
  /** Per-facet status record, sourced from the `FacetStatusIndex`. */
  readonly facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>;
  /** Highest-priority facet status, or `'none'` (sentinel) when empty. */
  readonly rollupStatus: FacetStatus | 'none';
}

/**
 * Cytoscape element descriptor for a participant-projected node.
 */
export interface ParticipantNodeElement extends ElementDefinition {
  readonly group: 'nodes';
  readonly data: ParticipantNodeData;
}

/**
 * Cytoscape element descriptor for a participant-projected edge.
 */
export interface ParticipantEdgeElement extends ElementDefinition {
  readonly group: 'edges';
  readonly data: ParticipantEdgeData;
}

/**
 * Resolve the per-facet record + rollup sentinel for an entity from the
 * `FacetStatusIndex`. Returns the shared `EMPTY_FACET_STATUSES`
 * reference + `'none'` when the index has no entry, so memoized
 * downstream consumers don't see a fresh object on every projection
 * pass for unstatued entities.
 */
function resolveFacetSlot(
  index: ReadonlyMap<string, Readonly<Partial<Record<FacetName, FacetStatus>>>>,
  entityId: string,
): {
  facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>;
  rollupStatus: FacetStatus | 'none';
} {
  const record = index.get(entityId);
  if (record === undefined) {
    return { facetStatuses: EMPTY_FACET_STATUSES, rollupStatus: 'none' };
  }
  const rollup = cardRollupStatus(record);
  return { facetStatuses: record, rollupStatus: rollup ?? 'none' };
}

/**
 * Pure projection from a session's event log to Cytoscape element
 * descriptors, with per-entity facet status stamped from the
 * `FacetStatusIndex`.
 *
 * Single-pass walk over `events`:
 *
 * - `node-created` → emit one `{ group: 'nodes', data: { id, wording,
 *   kind: null, facetStatuses, rollupStatus } }` descriptor.
 * - `proposal` of `classify-node` → cache `{ nodeId, classification }`
 *   against the proposal envelope id.
 * - `commit` of a cached classify-node proposal → flip the matching
 *   node's `data.kind` to the cached classification.
 * - `edge-created` → emit one `{ group: 'edges', data: { id, source,
 *   target, role, facetStatuses, rollupStatus } }` descriptor.
 * - All other event kinds (`participant-joined`, `participant-left`,
 *   `vote`, `annotation-created`, `meta-disagreement-marked`,
 *   `snapshot-created`, `entity-included`, `entity-removed`, …) are
 *   ignored at this layer; the visual-vocabulary they drive lives in
 *   the sibling-task layers (`part_annotation_render`,
 *   `part_own_vote_indicators`, etc.). The per-facet status they
 *   contribute to is computed BEFORE this call via
 *   `computeFacetStatuses(events)` and passed in as
 *   `facetStatusIndex`.
 *
 * Order: nodes are emitted in `node-created` arrival order; edges are
 * emitted in `edge-created` arrival order. The two arrays are
 * independent so a caller (`GraphView`) can localize each separately
 * and concatenate.
 */
export function projectGraph(
  events: readonly Event[],
  facetStatusIndex: FacetStatusIndex,
): {
  nodes: ParticipantNodeElement[];
  edges: ParticipantEdgeElement[];
} {
  const nodes: ParticipantNodeElement[] = [];
  const nodeIndexById = new Map<string, number>();
  // Map from `proposal` envelope id → `{ nodeId, classification }` so a
  // later `commit` can find the cached classification without a second
  // pass. Mirrors `projectNodes`'s `pendingClassifications` map exactly.
  const pendingClassifications = new Map<
    string,
    { nodeId: string; classification: StatementKind }
  >();
  const edges: ParticipantEdgeElement[] = [];

  for (const event of events) {
    if (event.kind === 'node-created') {
      const slot = resolveFacetSlot(facetStatusIndex.nodes, event.payload.node_id);
      const element: ParticipantNodeElement = {
        group: 'nodes',
        data: {
          id: event.payload.node_id,
          wording: event.payload.wording,
          kind: null,
          facetStatuses: slot.facetStatuses,
          rollupStatus: slot.rollupStatus,
        },
      };
      nodeIndexById.set(event.payload.node_id, nodes.length);
      nodes.push(element);
      continue;
    }

    if (event.kind === 'edge-created') {
      const slot = resolveFacetSlot(facetStatusIndex.edges, event.payload.edge_id);
      const element: ParticipantEdgeElement = {
        group: 'edges',
        data: {
          id: event.payload.edge_id,
          source: event.payload.source_node_id,
          target: event.payload.target_node_id,
          role: event.payload.role,
          facetStatuses: slot.facetStatuses,
          rollupStatus: slot.rollupStatus,
        },
      };
      edges.push(element);
      continue;
    }

    if (event.kind === 'proposal') {
      const inner = event.payload.proposal;
      if (inner.kind === 'classify-node') {
        pendingClassifications.set(event.id, {
          nodeId: inner.node_id,
          classification: inner.classification,
        });
      }
      continue;
    }

    if (event.kind === 'commit') {
      const proposal = pendingClassifications.get(event.payload.proposal_id);
      if (proposal === undefined) continue;
      const idx = nodeIndexById.get(proposal.nodeId);
      if (idx === undefined) continue;
      const existing = nodes[idx];
      if (existing === undefined) continue;
      // Replace the descriptor with a new object so referential identity
      // changes — `useMemo` consumers that hold the prior list will see
      // the difference and re-render.
      nodes[idx] = {
        group: 'nodes',
        data: {
          ...existing.data,
          kind: proposal.classification,
        },
      };
      continue;
    }
  }

  return { nodes, edges };
}
