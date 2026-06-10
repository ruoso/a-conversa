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
// Refinement: tasks/refinements/audience/aud_render_annotation_endpoint_edges.md
//   (Decisions §1–§11 — hybrid promotion: lift the L308-321 skip-guard
//   on annotation-endpoint edges by promoting referenced annotations to
//   standalone Cytoscape graph-nodes. `AudienceNodeData` widens with
//   `nodeKind: 'statement' | 'annotation'`, `annotationKind:
//   AnnotationKind | null`, and optional `hostMissing`. `AudienceEdgeData`
//   widens with `entityRole: 'statement' | 'annotation-host'`. End-of-
//   walk builds the promoted set via `computeAnnotationsAsEndpoints`,
//   concatenates `projectAnnotationNodes` onto `nodes`, concatenates
//   `projectAnnotationHostEdges` onto `edges`, and post-filters the
//   `nodeAnnotationIndex` / `edgeAnnotationIndex` buckets against the
//   promoted set so promoted annotations render as Cytoscape nodes only
//   — never also as DOM-overlay badges. A defensive `continue`-skip
//   protects against `edge-created` payloads that reference an
//   annotation id whose `annotation-created` envelope hasn't been seen.)
//
// Refinement: tasks/refinements/audience/aud_annotation_of_annotation_overlay_chain.md
//   (Decisions §1–§5 — migrate the bucketer call to
//   `groupAnnotationsByEntityId` and thread `nodeAnnotationIndex` into
//   `projectAnnotationNodes` so annotations targeting a promoted
//   annotation graph-node surface on its `data.annotations` array and
//   render via the existing DOM overlay. The local variable identifier
//   `nodeAnnotationIndex` is preserved per D2; the shell-level rename
//   carries the polymorphic-entity-id semantic. The propagation lights
//   up the meta-commentary chain end-to-end: A2's `target_node_id`
//   carrying A1's UUID surfaces A2 in A1's `data.annotations` array,
//   which the existing `<AudienceAnnotationOverlay>` reads via
//   `node.data('annotations')`.)
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
import type { AnnotationKind, EdgeRole, Event, StatementKind } from '@a-conversa/shared-types';

import {
  computeAnnotationsAsEndpoints,
  projectAnnotationHostEdges,
  projectAnnotationNodes,
} from './annotations.js';
import { computeNodeDimensions } from './nodeDimensions.js';

import {
  cardRollupStatus,
  computeFacetStatuses,
  deriveSlotOccupants,
  EMPTY_FACET_STATUSES,
  projectVotesByFacet,
  type FacetName,
  type FacetStatus,
  type Vote,
} from '@a-conversa/shell';
import {
  EMPTY_ANNOTATIONS,
  EMPTY_AXIOM_MARKS,
  groupAnnotationsByEdge,
  groupAnnotationsByEntityId,
  groupAxiomMarksByNode,
  projectAnnotations,
  projectAxiomMarks,
  type Annotation,
  type AxiomMark,
} from '@a-conversa/shell';

/** The two debater slots, in display order, for the step-pill roster. */
const DEBATER_ROLES = ['debater-A', 'debater-B'] as const;

/**
 * Extra height (px) reserved on a statement node's box for the per-node
 * HTML step-pill header (`per_facet_step_pill`), above the wording the
 * `computeNodeDimensions` measurement already accounts for. The pill is
 * roughly two lines (facet/value title + the debater checkbox row).
 */
const STEP_PILL_BAND_PX = 64;

/** A debater in the step-pill checkbox roster. */
export interface StepDebater {
  readonly role: (typeof DEBATER_ROLES)[number];
  readonly participantId: string;
  readonly screenName: string;
}

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
  /** Original wording from the `node-created` payload (or annotation
   * `content` for promoted annotation nodes per
   * `aud_render_annotation_endpoint_edges` Decision §6). */
  readonly wording: string;
  /**
   * Discriminates statement nodes (emitted from `node-created` events)
   * from annotation graph-nodes (materialized when an `edge-created`
   * payload references an annotation id via `source_annotation_id` /
   * `target_annotation_id`). Per
   * `aud_render_annotation_endpoint_edges` Decision §3 the shared shape
   * carries the discriminator so the stylesheet and overlay code branch
   * via `nodeKind` rather than via a discriminated-union split.
   * Statement-only fields (`kind`, `facetStatuses`, `rollupStatus`,
   * `axiomMarks`, `annotations`, `decomposed`) carry sentinel defaults
   * on annotation nodes so the existing per-status / decomposed /
   * axiom-mark selectors don't paint on them.
   */
  readonly nodeKind: 'statement' | 'annotation';
  /**
   * For annotation graph-nodes (`nodeKind === 'annotation'`), the wire
   * `annotation-created.kind` enum value (`'note'` / `'reframe'` /
   * `'scope-change'` / `'stance'`). `null` for statement nodes — the
   * stylesheet's `[annotationKind = "..."]` selectors then paint
   * nothing on statement nodes.
   */
  readonly annotationKind: AnnotationKind | null;
  /**
   * Stamped `true` on a promoted annotation node when its host can't
   * be resolved per `aud_render_annotation_endpoint_edges` Decision §4
   * (defensive case — wire-protocol violation). Absent on every other
   * node. The annotation still renders so the broadcast viewer can see
   * the entity rather than encountering a silent drop.
   */
  readonly hostMissing?: boolean;
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
  /**
   * Per-node Cytoscape box width (px), measured from `wording` by
   * `computeNodeDimensions`. The baseline `node` selector's
   * `width: 'data(width)'` mapper reads this so statement boxes size to
   * their content instead of the prior constant `200`. Stamped on
   * statement nodes only — promoted annotation graph-nodes keep the
   * fixed footprint from their `node[nodeKind = 'annotation']` selector
   * (which overrides `width` with a literal, so the mapper is never
   * evaluated for them). Refinement: closes the constant-`200`/`80`
   * deferral noted in `stylesheet.ts`'s STYLESHEET status block.
   */
  readonly width?: number;
  /** Per-node Cytoscape box height (px). Symmetric with `width`. */
  readonly height?: number;
  /** Per-node `text-max-width` budget (px), `width - 2 * padding`. */
  readonly textMaxWidth?: number;
  /**
   * Per-facet candidate VALUE being voted on, RAW (not localized): the
   * `classification` slot carries a `StatementKind` (`'fact'`…), the
   * `substance` slot carries `'agreed'` / `'disputed'`. `wording` has no
   * separate candidate (the text is `wording`). Absent facets are
   * omitted; the whole field is absent when no candidate exists yet.
   * Consumed by the step-pill renderer (`per_facet_step_pill`).
   */
  readonly facetCandidates?: Readonly<Partial<Record<FacetName, string>>>;
  /**
   * Per-facet per-participant votes on the facet's pending candidate,
   * from `projectVotesByFacet`. Drives the per-debater checkbox marks.
   */
  readonly facetVotes?: Readonly<Partial<Record<FacetName, readonly Vote[]>>>;
  /**
   * The debater roster (debater-A, debater-B) for the step-pill checkbox
   * row — both slots are listed so empty boxes render before anyone
   * votes. Session-wide, so the same frozen array is shared across nodes.
   */
  readonly debaters?: readonly StepDebater[];
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
  /**
   * Discriminates statement edges (emitted from `edge-created` events)
   * from synthetic annotation-host pseudo-edges (one dashed tether per
   * promoted annotation per
   * `aud_render_annotation_endpoint_edges` Decision §4). The
   * `edge[entityRole = 'annotation-host']` selector paints the dashed
   * slate tether without a target arrow or label; statement edges
   * inherit the baseline `edge` selector. Default `'statement'` is
   * stamped on every emitted statement edge.
   */
  readonly entityRole: 'statement' | 'annotation-host';
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
  // Per-facet per-participant votes + the debater roster for the step
  // pill (`per_facet_step_pill`). Both are pure functions of the event
  // log; computed once and stamped on statement nodes in the post-walk
  // pass below. `debaters` is a single frozen array shared across nodes
  // for stable React-memoization identity.
  const votesByFacet = projectVotesByFacet(events);
  const occupants = deriveSlotOccupants(events);
  const debaters: readonly StepDebater[] = DEBATER_ROLES.flatMap((role) => {
    const occupant = occupants[role];
    return occupant === undefined
      ? []
      : [{ role, participantId: occupant.userId, screenName: occupant.screenName }];
  });
  const projectedAnnotations = projectAnnotations(events);
  // Hybrid promotion per `aud_render_annotation_endpoint_edges` Decisions
  // §1 + §3: an annotation referenced as an edge endpoint becomes a
  // Cytoscape graph-node; the DOM-overlay badge is suppressed for that
  // id. The promoted set is computed once up-front and used to filter
  // both the node-targeted and edge-targeted annotation buckets before
  // they're stamped on `data.annotations`, AND to drive the end-of-walk
  // materialization pass.
  const promotedAnnotationIds = computeAnnotationsAsEndpoints(events);
  const nodeAnnotationIndex = filterAnnotationIndex(
    groupAnnotationsByEntityId(projectedAnnotations),
    promotedAnnotationIds,
  );
  const edgeAnnotationIndex = filterAnnotationIndex(
    groupAnnotationsByEdge(projectedAnnotations),
    promotedAnnotationIds,
  );
  // Track which annotation ids have been seen as `annotation-created`
  // by the time their `edge-created` reference arrives. The lifted
  // `edge-created` arm defensively `continue`-skips any
  // annotation-endpoint edge whose endpoint hasn't been seen yet — per
  // Decision §8 + Constraint §11 (Cytoscape's orphan-edge invariant
  // would otherwise throw at mount because the promoted-annotation
  // node hasn't been emitted yet for that id).
  const seenAnnotationIds = new Set<string>();
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
  // Map from `node_id` → most-recent substance candidate (`'agreed'` /
  // `'disputed'`), set by `set-node-substance` proposals. Parallel to
  // `currentClassificationByNode`; read in the post-walk stamp.
  const currentSubstanceByNode = new Map<string, 'agreed' | 'disputed'>();
  // Map from `proposal` envelope id → parent node id, for `decompose`
  // and `interpretive-split` proposals. The matching `commit`
  // (target=`'proposal'`) resolves the parent via this map and stamps
  // `data.decomposed: true` on the parent node element. Symmetric with
  // `pendingClassifications` above, scoped to the two multi-component
  // sub-kinds. Refinement: aud_decomposition_animation Decision §2.
  const pendingDecompositions = new Map<string, string>();
  // Restructure edits mint a `new_node_id` (created via its own
  // `node-created`) and supersede the old node. Track (proposal id →
  // superseded old node id) so the commit can drop the old node.
  const pendingRestructures = new Map<string, string>();
  // Reword edits keep the node id and swap its text at COMMIT time (the
  // node keeps showing the old wording while the candidate gathers
  // votes; the pill carries the in-flight candidate). Tracked under both
  // keyings: (proposal id → {nodeId, wording}) for the proposal-keyed
  // commit arm, and (node id → wording) for the facet-keyed arm, which
  // has no proposal_id carrier (per ADR 0030 §2 — symmetric with
  // `currentClassificationByNode`).
  const pendingRewords = new Map<string, { nodeId: string; wording: string }>();
  const currentWordingByNode = new Map<string, string>();
  // Node ids superseded by a COMMITTED decompose / interpretive-split (the
  // parent) or restructure (the old node). These are omitted from the
  // emitted graph entirely at the end of the walk — a superseded node is no
  // longer part of the live argument, and leaving it (even with distinct
  // formatting) only clutters the read-only surfaces.
  const supersededNodeIds = new Set<string>();

  // Swap a statement node's displayed wording (a committed reword) and
  // re-measure its box — the width/height/textMaxWidth `data(...)`
  // mappers were measured from the old text at `node-created` time.
  const applyCommittedWording = (nodeId: string, wording: string): void => {
    const idx = nodeIndexById.get(nodeId);
    if (idx === undefined) return;
    const existing = nodes[idx];
    if (existing === undefined) return;
    const dimensions = computeNodeDimensions(wording);
    nodes[idx] = {
      group: 'nodes',
      data: {
        ...existing.data,
        wording,
        width: dimensions.width,
        height: dimensions.height + STEP_PILL_BAND_PX,
        textMaxWidth: dimensions.textMaxWidth,
      },
    };
  };

  for (const event of events) {
    if (event.kind === 'node-created') {
      const facetStatuses =
        facetStatusIndex.nodes.get(event.payload.node_id) ?? EMPTY_FACET_STATUSES;
      const rollupStatus = cardRollupStatus(facetStatuses) ?? 'none';
      const axiomMarks = axiomMarkIndex.get(event.payload.node_id) ?? EMPTY_AXIOM_MARKS;
      const annotations = nodeAnnotationIndex.get(event.payload.node_id) ?? EMPTY_ANNOTATIONS;
      // Measure the wording once so the statement box sizes to its
      // content (the `width`/`height`/`textMaxWidth` `data(...)` mappers
      // in `STYLESHEET` read these back). Annotation graph-nodes are
      // emitted by `projectAnnotationNodes` below and keep their fixed
      // selector footprint, so they carry no measured dimensions.
      const dimensions = computeNodeDimensions(event.payload.wording);
      const element: AudienceNodeElement = {
        group: 'nodes',
        data: {
          id: event.payload.node_id,
          wording: event.payload.wording,
          nodeKind: 'statement',
          annotationKind: null,
          kind: null,
          facetStatuses,
          rollupStatus,
          axiomMarks,
          annotations,
          width: dimensions.width,
          height: dimensions.height + STEP_PILL_BAND_PX,
          textMaxWidth: dimensions.textMaxWidth,
        },
      };
      nodeIndexById.set(event.payload.node_id, nodes.length);
      nodes.push(element);
      continue;
    }

    if (event.kind === 'annotation-created') {
      // Track the annotation id so a later annotation-endpoint
      // `edge-created` referencing it survives the defensive seen-id
      // skip below. Per Decision §8 the projection-time order matters:
      // an `edge-created (target_annotation_id = A)` arriving before
      // `annotation-created (id = A)` is a wire-protocol violation and
      // the edge silently drops; once `annotation-created` lands, the
      // edge re-materialises on the next projection pass.
      seenAnnotationIds.add(event.payload.annotation_id);
      continue;
    }

    if (event.kind === 'edge-created') {
      // Annotation-endpoint widening per
      // `aud_render_annotation_endpoint_edges` Decisions §1 + §8.
      // The wire schema's XOR `.refine()` guarantees exactly one of
      // `source_node_id` / `source_annotation_id` is set per endpoint
      // (symmetric for target); the `?? null` tail is defensive — if
      // the refinement were ever weakened the projector falls through
      // and the edge silently drops rather than throwing.
      const sourceId = event.payload.source_node_id ?? event.payload.source_annotation_id ?? null;
      const targetId = event.payload.target_node_id ?? event.payload.target_annotation_id ?? null;
      if (sourceId === null || targetId === null) continue;
      // Decision §2 + Constraint §8 — defensive skip when an
      // annotation-endpoint references an annotation id whose
      // `annotation-created` event hasn't been seen. The materialization
      // pass at end-of-walk emits one Cytoscape node per id in the
      // `(promoted ∩ projectedAnnotations)` intersection; an edge whose
      // annotation endpoint never materializes a node would orphan at
      // Cytoscape's `cy.add()` invariant (Constraint §11).
      if (
        event.payload.source_annotation_id !== undefined &&
        !seenAnnotationIds.has(event.payload.source_annotation_id)
      ) {
        continue;
      }
      if (
        event.payload.target_annotation_id !== undefined &&
        !seenAnnotationIds.has(event.payload.target_annotation_id)
      ) {
        continue;
      }
      const facetStatuses =
        facetStatusIndex.edges.get(event.payload.edge_id) ?? EMPTY_FACET_STATUSES;
      const rollupStatus = cardRollupStatus(facetStatuses) ?? 'none';
      const annotations = edgeAnnotationIndex.get(event.payload.edge_id) ?? EMPTY_ANNOTATIONS;
      const element: AudienceEdgeElement = {
        group: 'edges',
        data: {
          id: event.payload.edge_id,
          source: sourceId,
          target: targetId,
          role: event.payload.role,
          entityRole: 'statement',
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
      } else if (inner.kind === 'set-node-substance') {
        currentSubstanceByNode.set(inner.node_id, inner.value);
      } else if (inner.kind === 'decompose') {
        pendingDecompositions.set(event.id, inner.parent_node_id);
      } else if (inner.kind === 'interpretive-split') {
        pendingDecompositions.set(event.id, inner.parent_node_id);
      } else if (inner.kind === 'edit-wording' && inner.edit_kind === 'restructure') {
        // Restructure's `node_id` is the OLD node being superseded; the
        // `new_node_id` replacement arrives via its own `node-created`.
        pendingRestructures.set(event.id, inner.node_id);
      } else if (inner.kind === 'edit-wording' && inner.edit_kind === 'reword') {
        // Reword keeps the node id; the new text lands at commit.
        pendingRewords.set(event.id, { nodeId: inner.node_id, wording: inner.new_wording });
        currentWordingByNode.set(inner.node_id, inner.new_wording);
      }
      continue;
    }

    if (event.kind === 'commit') {
      if (event.payload.target === 'facet') {
        if (event.payload.entity_kind !== 'node') continue;
        if (event.payload.facet === 'wording') {
          // A committed reword: swap the displayed text. A wording
          // commit with no reword candidate (e.g. sealing a captured
          // node's original text) finds no map entry and is a no-op —
          // the node already shows that wording.
          const wording = currentWordingByNode.get(event.payload.entity_id);
          if (wording !== undefined) {
            applyCommittedWording(event.payload.entity_id, wording);
          }
          continue;
        }
        if (event.payload.facet !== 'classification') continue;
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
      const reword = pendingRewords.get(event.payload.proposal_id);
      if (reword !== undefined) {
        applyCommittedWording(reword.nodeId, reword.wording);
        continue;
      }
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
      // A committed decompose / interpretive-split supersedes the parent
      // node; a committed restructure supersedes the old node. Record the
      // superseded id — the node (and any edge touching it) is dropped from
      // the emitted graph at the end of the walk, rather than lingering as
      // faded clutter on the read-only surfaces.
      const supersededId =
        pendingDecompositions.get(event.payload.proposal_id) ??
        pendingRestructures.get(event.payload.proposal_id);
      if (supersededId !== undefined) {
        supersededNodeIds.add(supersededId);
      }
      continue;
    }
  }

  // Stamp the step-pill data on every statement node now that the walk
  // has resolved the final candidate caches + the vote index. At this
  // point `nodes` holds only statement nodes (annotation graph-nodes are
  // appended below), so no `nodeKind` filter is needed.
  for (let i = 0; i < nodes.length; i++) {
    const element = nodes[i];
    if (element === undefined) continue;
    const id = element.data.id;
    // `exactOptionalPropertyTypes`: omit the optional keys when absent
    // rather than assigning `undefined`.
    const facetCandidates = buildFacetCandidates(
      currentClassificationByNode.get(id),
      currentSubstanceByNode.get(id),
    );
    const facetVotes = facetVotesToRecord(votesByFacet.get(id));
    nodes[i] = {
      group: 'nodes',
      data: {
        ...element.data,
        ...(facetCandidates !== undefined ? { facetCandidates } : {}),
        ...(facetVotes !== undefined ? { facetVotes } : {}),
        debaters,
      },
    };
  }

  // Annotation graph-node + host-edge materialization pass per
  // `aud_render_annotation_endpoint_edges` Decisions §1 + §4.
  // Constraint §11 — emit nodes BEFORE concatenating edges so the
  // synthetic host pseudo-edges' `target` (the annotation id) is a
  // known graph element at Cytoscape `cy.add()` time. The
  // `nondanglingEdges` filter at the `<AudienceGraphView>` layer is
  // the belt-and-suspenders pin against orphan edges; emitting in
  // dependency order here keeps the projection itself self-consistent.
  const annotationNodes = projectAnnotationNodes(
    projectedAnnotations,
    promotedAnnotationIds,
    events,
    nodeAnnotationIndex,
  );
  for (const annotationNode of annotationNodes) {
    nodeIndexById.set(annotationNode.data.id, nodes.length);
    nodes.push(annotationNode);
  }
  const annotationHostEdges = projectAnnotationHostEdges(
    projectedAnnotations,
    promotedAnnotationIds,
    events,
  );
  for (const hostEdge of annotationHostEdges) {
    edges.push(hostEdge);
  }

  if (supersededNodeIds.size === 0) {
    return { nodes, edges };
  }
  // Drop superseded nodes and any edge with a superseded endpoint. The
  // `<GraphView>` element memo also filters dangling edges, but pruning
  // here keeps the projection self-consistent for every consumer.
  return {
    nodes: nodes.filter((node) => !supersededNodeIds.has(node.data.id)),
    edges: edges.filter(
      (edge) =>
        !supersededNodeIds.has(edge.data.source) && !supersededNodeIds.has(edge.data.target),
    ),
  };
}

/**
 * Drop entries whose annotation id is in the promoted set so the
 * remaining `data.annotations` array on each entity carries only the
 * DOM-overlay-badge population (mutual exclusion per
 * `aud_render_annotation_endpoint_edges` Decision §3 + Constraint §2).
 *
 * The filter walks each `(entityId, annotations)` pair once and either
 * preserves the original array reference (no promoted entries — stable
 * React-memoization identity) or replaces it with a new filtered array.
 * Entities whose ALL annotations got promoted drop out of the index
 * entirely so the `index.get(entityId)` lookup falls back to
 * `EMPTY_ANNOTATIONS` on the corresponding node/edge arm.
 */
/**
 * Build the per-facet candidate-value record from the final
 * classification / substance caches. Returns `undefined` when neither has a
 * candidate yet (so the node carries no `facetCandidates` key).
 */
function buildFacetCandidates(
  classification: StatementKind | undefined,
  substance: 'agreed' | 'disputed' | undefined,
): Readonly<Partial<Record<FacetName, string>>> | undefined {
  const out: Partial<Record<FacetName, string>> = {};
  if (classification !== undefined) out.classification = classification;
  if (substance !== undefined) out.substance = substance;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Flatten a `VotesByFacetIndex` per-entity map (`Map<FacetName, Vote[]>`)
 * into a plain record for the node data. Returns `undefined` when the
 * node has no votes (so the node carries no `facetVotes` key).
 */
function facetVotesToRecord(
  perFacet: ReadonlyMap<FacetName, readonly Vote[]> | undefined,
): Readonly<Partial<Record<FacetName, readonly Vote[]>>> | undefined {
  if (perFacet === undefined || perFacet.size === 0) return undefined;
  const out: Partial<Record<FacetName, readonly Vote[]>> = {};
  for (const [facet, votes] of perFacet) out[facet] = votes;
  return out;
}

function filterAnnotationIndex(
  index: Map<string, Annotation[]>,
  promotedSet: ReadonlySet<string>,
): Map<string, Annotation[]> {
  if (promotedSet.size === 0) return index;
  const out = new Map<string, Annotation[]>();
  for (const [entityId, annotations] of index) {
    const kept = annotations.filter((annotation) => !promotedSet.has(annotation.id));
    if (kept.length === 0) continue;
    if (kept.length === annotations.length) {
      out.set(entityId, annotations);
      continue;
    }
    out.set(entityId, kept);
  }
  return out;
}
