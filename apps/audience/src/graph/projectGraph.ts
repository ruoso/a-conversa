// Pure projection from a per-session WS event log to Cytoscape element
// descriptors for the audience surface.
//
// Refinement: tasks/refinements/audience/aud_cytoscape_init.md
//   (Decision §4 — projection lives in the audience workspace; the
//   participant's `projectGraph` is the reference algorithm, and the
//   audience strips participant-specific decoration concerns: no own-
//   vote / other-vote rollups, no axiom-mark booleans, no annotation
//   counts, no diagnostic-highlight rollups, no flash flags, no
//   measured dimensions. The baseline emits only entity-layer data —
//   id / wording / kind for nodes; id / source / target / role for
//   edges. Sibling tasks under `aud_graph_rendering.*` extend the
//   emitted `data` shape as they need it; the extraction-to-shell
//   trigger is the third Cytoscape consumer materializing.
//   Decision §5 — combined `{ nodes, edges }` return shape from one
//   single-pass walk. Decision §10 — propose-time rendering: nodes
//   and edges land on the canvas at `node-created` / `edge-created`,
//   not at commit-time; the kind label flips when a `classify-node`
//   commit lands.)
//
// Refinement: tasks/refinements/audience/aud_proposed_styling.md
//   (Decision §1 — emit BOTH `data.facetStatuses` and
//   `data.rollupStatus` on every projected element. The rollup is the
//   field Cytoscape's attribute selectors key on for the current per-
//   state styling work; the per-facet record is the field the future
//   `aud_per_facet_visualization` task reads to subdivide cards.
//   Decision §4 — stamp the literal sentinel `'none'` rather than
//   `undefined` when the per-facet record is empty so Cytoscape's
//   `[rollupStatus = '<state>']` selectors have a stable string to
//   match on. The `computeFacetStatuses(events)` walk runs once
//   up-front and the index is read inside each `node-created` /
//   `edge-created` branch; the commit-arm `kind` flip preserves both
//   fields via the spread of `existing.data`.)
//
// Refinement: tasks/refinements/audience/aud_axiom_mark_decoration.md
//   (Decision §1 — per-participant chromatic axiom-mark badges on the
//   broadcast canvas; the audience walks back `aud_cytoscape_init`'s
//   "no axiom-mark booleans" exclusion now that the methodology-load-
//   bearing surfacing is being lit up. Decision §2 — stamp
//   `data.axiomMarks: readonly AxiomMark[]` (defaulting to the module-
//   scope `EMPTY_AXIOM_MARKS` frozen array for stable React-memoization
//   identity) on every projected node; edges carry no `axiomMarks`
//   field (axiom-marks are node-only per wire schema + methodology).
//   Decision §3 — in-function `axiomMarkIndex` index alongside
//   `facetStatusIndex` (mirrors the per-facet stamping pattern). The
//   commit-arm spread (`...existing.data`) preserves the field
//   unchanged.)
//
// ADRs:
//   - 0004 (Cytoscape.js for the read-mostly audience broadcast
//           surface);
//   - 0021 (event envelope shape — the shell client validates incoming
//           envelopes at parse time, so this projection trusts the
//           discriminated-union narrowing);
//   - 0022 (no throwaway verifications — every behavioural assertion
//           lives in `projectGraph.test.ts`);
//   - 0027 (entity / facet layers are strictly separate — `node-created`
//           lands at propose-time so the broadcast canvas paints
//           proposed entities the moment of proposal; the kind label
//           flips when a `classify-node` proposal commits, not before);
//   - 0030 (commit envelope discriminated union — both the facet-keyed
//           and proposal-keyed commit arms are honoured here so the
//           projection stays robust against either wire shape).

import type { ElementDefinition } from 'cytoscape';
import type { EdgeRole, Event, StatementKind } from '@a-conversa/shared-types';

import {
  cardRollupStatus,
  computeFacetStatuses,
  EMPTY_FACET_STATUSES,
  type FacetName,
  type FacetStatus,
} from './facetStatus.js';
import {
  EMPTY_AXIOM_MARKS,
  groupAxiomMarksByNode,
  projectAxiomMarks,
  type AxiomMark,
} from '@a-conversa/shell';

/**
 * The per-node payload `projectGraph` emits on each `node-created`
 * descriptor's `data` slot.
 *
 * `kind` starts at `null` and flips to a `StatementKind` when a
 * `commit` of a `classify-node` proposal referencing the node lands.
 *
 * `facetStatuses` carries the per-facet `FacetStatus` record from the
 * `FacetStatusIndex` (or `EMPTY_FACET_STATUSES` when the index has no
 * entry for this node). `rollupStatus` is the highest-priority status
 * per `cardRollupStatus`, or the literal sentinel `'none'` when the
 * record is empty (Decision §4: Cytoscape's
 * `[rollupStatus = '<state>']` selectors require a stable string;
 * `undefined` would not match).
 */
export interface AudienceNodeData {
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
  /**
   * Per-participant axiom-marks committed against this node, in
   * commit-arrival order. Defaults to the module-scope frozen
   * `EMPTY_AXIOM_MARKS` array when no marks have committed (stable
   * React-memoization identity).
   */
  readonly axiomMarks: readonly AxiomMark[];
}

/**
 * The per-edge payload `projectGraph` emits on each `edge-created`
 * descriptor's `data` slot.
 */
export interface AudienceEdgeData {
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

export interface AudienceNodeElement extends ElementDefinition {
  readonly group: 'nodes';
  readonly data: AudienceNodeData;
}

export interface AudienceEdgeElement extends ElementDefinition {
  readonly group: 'edges';
  readonly data: AudienceEdgeData;
}

/**
 * Pure projection from a session's event log to Cytoscape element
 * descriptors for the audience surface.
 *
 * Single-pass walk over `events`:
 *
 * - `node-created` → emit one `{ group: 'nodes', data: { id, wording,
 *   kind: null } }` descriptor.
 * - `proposal` of `classify-node` → cache `{ nodeId, classification }`
 *   against the proposal envelope id AND against the node id (the
 *   facet-keyed commit arm has no `proposal_id` carrier per ADR 0030
 *   §2; the node-keyed cache resolves the candidate by node id).
 * - `commit` with `target: 'proposal'` of a cached classify-node
 *   proposal → flip the matching node's `data.kind` to the cached
 *   classification.
 * - `commit` with `target: 'facet'` + `facet: 'classification'` +
 *   `entity_kind: 'node'` → flip the matching node's `data.kind` to
 *   the most-recent classification candidate from `currentClassificationByNode`.
 * - `edge-created` → emit one `{ group: 'edges', data: { id, source,
 *   target, role } }` descriptor.
 * - All other event kinds are ignored at this layer; sibling tasks
 *   under `aud_graph_rendering.*` extend the projection with the per-
 *   facet / per-decoration data they need.
 *
 * Order: nodes are emitted in `node-created` arrival order; edges are
 * emitted in `edge-created` arrival order. The two arrays are
 * independent so a caller (`<AudienceGraphView>`) can localize each
 * separately and concatenate.
 */
export function projectGraph(events: readonly Event[]): {
  nodes: AudienceNodeElement[];
  edges: AudienceEdgeElement[];
} {
  const facetStatusIndex = computeFacetStatuses(events);
  const axiomMarkIndex = groupAxiomMarksByNode(projectAxiomMarks(events));
  const nodes: AudienceNodeElement[] = [];
  const nodeIndexById = new Map<string, number>();
  const edges: AudienceEdgeElement[] = [];
  // Map from `proposal` envelope id → `{ nodeId, classification }` so a
  // later proposal-keyed `commit` can find the cached classification
  // without a second pass. Mirrors `projectNodes`'s
  // `pendingClassifications` map on the participant side.
  const pendingClassifications = new Map<
    string,
    { nodeId: string; classification: StatementKind }
  >();
  // Map from `node_id` → most-recent classification candidate. The
  // facet-keyed commit arm (per ADR 0030 §2) has no `proposal_id`
  // carrier; this map resolves the current candidate from the entity
  // id. A new classify-node proposal supersedes the prior candidate
  // per ADR 0030 §7.
  const currentClassificationByNode = new Map<string, StatementKind>();

  for (const event of events) {
    if (event.kind === 'node-created') {
      const facetStatuses =
        facetStatusIndex.nodes.get(event.payload.node_id) ?? EMPTY_FACET_STATUSES;
      const rollupStatus = cardRollupStatus(facetStatuses) ?? 'none';
      const axiomMarks = axiomMarkIndex.get(event.payload.node_id) ?? EMPTY_AXIOM_MARKS;
      const element: AudienceNodeElement = {
        group: 'nodes',
        data: {
          id: event.payload.node_id,
          wording: event.payload.wording,
          kind: null,
          facetStatuses,
          rollupStatus,
          axiomMarks,
        },
      };
      nodeIndexById.set(event.payload.node_id, nodes.length);
      nodes.push(element);
      continue;
    }

    if (event.kind === 'edge-created') {
      const facetStatuses =
        facetStatusIndex.edges.get(event.payload.edge_id) ?? EMPTY_FACET_STATUSES;
      const rollupStatus = cardRollupStatus(facetStatuses) ?? 'none';
      const element: AudienceEdgeElement = {
        group: 'edges',
        data: {
          id: event.payload.edge_id,
          source: event.payload.source_node_id,
          target: event.payload.target_node_id,
          role: event.payload.role,
          facetStatuses,
          rollupStatus,
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
        currentClassificationByNode.set(inner.node_id, inner.classification);
      }
      continue;
    }

    if (event.kind === 'commit') {
      if (event.payload.target === 'facet') {
        if (event.payload.facet !== 'classification') continue;
        if (event.payload.entity_kind !== 'node') continue;
        const classification = currentClassificationByNode.get(event.payload.entity_id);
        if (classification === undefined) continue;
        const idx = nodeIndexById.get(event.payload.entity_id);
        if (idx === undefined) continue;
        const existing = nodes[idx];
        if (existing === undefined) continue;
        nodes[idx] = {
          group: 'nodes',
          data: { ...existing.data, kind: classification },
        };
        continue;
      }
      // target === 'proposal' — the proposal-keyed arm.
      const proposal = pendingClassifications.get(event.payload.proposal_id);
      if (proposal === undefined) continue;
      const idx = nodeIndexById.get(proposal.nodeId);
      if (idx === undefined) continue;
      const existing = nodes[idx];
      if (existing === undefined) continue;
      nodes[idx] = {
        group: 'nodes',
        data: { ...existing.data, kind: proposal.classification },
      };
      continue;
    }
  }

  return { nodes, edges };
}
