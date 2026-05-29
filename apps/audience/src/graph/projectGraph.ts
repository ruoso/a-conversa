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
// Refinement: tasks/refinements/audience/aud_annotation_rendering.md
//   (Decision §1 — per-annotation badges on the broadcast canvas; the
//   audience walks back `aud_cytoscape_init`'s "no annotation counts"
//   exclusion now that the meta-commentary layer is being surfaced.
//   Decision §2 — scope to node-targeted annotations; edge-targeted
//   annotations deferred to the named-future-task
//   `aud_annotation_rendering_edges`, so `AudienceEdgeData` is
//   unchanged. Decision §3 — verbatim inline port of
//   `projectAnnotations` + `groupAnnotationsByNode` into
//   `./annotations.ts` (third-caller trigger fires for
//   `shell_package.extract_cytoscape_projectors`). Decision §4 — every
//   projected node carries `data.annotations: readonly Annotation[]`,
//   defaulting to the module-scope `EMPTY_ANNOTATIONS` frozen array
//   for stable React-memoization identity. The commit-arm spread
//   (`...existing.data`) preserves the field unchanged.)
//
// Refinement: tasks/refinements/audience/aud_annotation_rendering_edges.md
//   (Decision §2 — extends the inline port with
//   `groupAnnotationsByEdge`, consumed alongside
//   `groupAnnotationsByNode` off a single `projectAnnotations(events)`
//   walk. Decision §4 — every projected edge now carries
//   `data.annotations: readonly Annotation[]` on `AudienceEdgeData`
//   symmetric to the node field, defaulting to `EMPTY_ANNOTATIONS`.
//   Decision §1 — completes the meta-commentary layer's symmetry
//   between node and edge entities on the broadcast canvas.)
//
// Refinement: tasks/refinements/audience/aud_decomposition_animation.md
//   (Decision §1 — the audience surface paints a one-shot slate-tinted
//   halo on parents whose `data.decomposed` first flips to `true` mid-
//   broadcast (a `commit` of a `decompose` or `interpretive-split`
//   proposal landing structurally retires the parent). The halo lives
//   in `<AudienceDecompositionFadeOverlay>`; the projector's job is to
//   stamp the store-derived flag the overlay reads.
//   Decision §2 — adopt the existing `pendingClassifications` shape:
//   cache `decompose` / `interpretive-split` proposals by event id at
//   the proposal arm, and on the matching `commit` (target=`'proposal'`)
//   stamp `data.decomposed: true` on the proposal's `parent_node_id`.
//   The `AudienceNodeData.decomposed` field is optional (only stamped
//   when the projector observes the commit; absent on non-decomposed
//   parents — semantically equivalent to `false` for Cytoscape's
//   `[?decomposed]` selector). The flag is monotonic (the projector
//   never unsets), so the post-animation steady state lives in the
//   stylesheet as `node[?decomposed] { opacity: 0.15 }`.)
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
} from '@a-conversa/shell';
import {
  EMPTY_ANNOTATIONS,
  EMPTY_AXIOM_MARKS,
  groupAnnotationsByEdge,
  groupAnnotationsByNode,
  groupAxiomMarksByNode,
  projectAnnotations,
  projectAxiomMarks,
  type Annotation,
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
  /**
   * Committed annotations targeting this node, in commit-arrival
   * order. Defaults to the module-scope frozen `EMPTY_ANNOTATIONS`
   * array when no annotations target the node (stable React-
   * memoization identity). Edge-targeted annotations live on a
   * future `AudienceEdgeData.annotations` field added by
   * `aud_annotation_rendering_edges`.
   */
  readonly annotations: readonly Annotation[];
  /**
   * `true` once a `decompose` or `interpretive-split` proposal whose
   * `parent_node_id` is this node has been committed (per
   * `aud_decomposition_animation` Decision §2). Absent on every other
   * node; semantically equivalent to `false` for Cytoscape's
   * `[?decomposed]` attribute-truthy selector. Monotonic: once stamped
   * the projector never unsets, mirroring the methodology contract
   * (committed decompositions are structurally permanent).
   */
  readonly decomposed?: boolean;
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
  /**
   * Committed annotations targeting this edge, in commit-arrival
   * order. Defaults to the module-scope frozen `EMPTY_ANNOTATIONS`
   * array when no annotations target the edge (stable React-
   * memoization identity). Symmetric to `AudienceNodeData.annotations`.
   */
  readonly annotations: readonly Annotation[];
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
  const projectedAnnotations = projectAnnotations(events);
  const nodeAnnotationIndex = groupAnnotationsByNode(projectedAnnotations);
  const edgeAnnotationIndex = groupAnnotationsByEdge(projectedAnnotations);
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
  // Map from `proposal` envelope id → parent node id, for `decompose`
  // and `interpretive-split` proposals. The matching `commit`
  // (target=`'proposal'`) resolves the parent via this map and stamps
  // `data.decomposed: true` on the parent node element. Symmetric with
  // `pendingClassifications` above, scoped to the two multi-component
  // sub-kinds. Refinement: aud_decomposition_animation Decision §2.
  const pendingDecompositions = new Map<string, string>();

  for (const event of events) {
    if (event.kind === 'node-created') {
      const facetStatuses =
        facetStatusIndex.nodes.get(event.payload.node_id) ?? EMPTY_FACET_STATUSES;
      const rollupStatus = cardRollupStatus(facetStatuses) ?? 'none';
      const axiomMarks = axiomMarkIndex.get(event.payload.node_id) ?? EMPTY_AXIOM_MARKS;
      const annotations = nodeAnnotationIndex.get(event.payload.node_id) ?? EMPTY_ANNOTATIONS;
      const element: AudienceNodeElement = {
        group: 'nodes',
        data: {
          id: event.payload.node_id,
          wording: event.payload.wording,
          kind: null,
          facetStatuses,
          rollupStatus,
          axiomMarks,
          annotations,
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
      const annotations = edgeAnnotationIndex.get(event.payload.edge_id) ?? EMPTY_ANNOTATIONS;
      const element: AudienceEdgeElement = {
        group: 'edges',
        data: {
          id: event.payload.edge_id,
          source: event.payload.source_node_id,
          target: event.payload.target_node_id,
          role: event.payload.role,
          facetStatuses,
          rollupStatus,
          annotations,
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
      } else if (inner.kind === 'decompose') {
        pendingDecompositions.set(event.id, inner.parent_node_id);
      } else if (inner.kind === 'interpretive-split') {
        pendingDecompositions.set(event.id, inner.parent_node_id);
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
      if (proposal !== undefined) {
        const idx = nodeIndexById.get(proposal.nodeId);
        if (idx !== undefined) {
          const existing = nodes[idx];
          if (existing !== undefined) {
            nodes[idx] = {
              group: 'nodes',
              data: { ...existing.data, kind: proposal.classification },
            };
          }
        }
        continue;
      }
      // `decompose` / `interpretive-split` fallback per
      // `aud_decomposition_animation` Decision §2: stamp
      // `data.decomposed: true` on the proposal's `parent_node_id`.
      const decomposeParentId = pendingDecompositions.get(event.payload.proposal_id);
      if (decomposeParentId !== undefined) {
        const idx = nodeIndexById.get(decomposeParentId);
        if (idx !== undefined) {
          const existing = nodes[idx];
          if (existing !== undefined) {
            nodes[idx] = {
              group: 'nodes',
              data: { ...existing.data, decomposed: true },
            };
          }
        }
        continue;
      }
      continue;
    }
  }

  return { nodes, edges };
}
