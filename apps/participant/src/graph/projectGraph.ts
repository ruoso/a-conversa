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
// Refinement: tasks/refinements/participant-ui/part_axiom_mark_decoration.md
//   (Constraints — `projectGraph` signature widens AGAIN to take an
//    `axiomMarkIndex: ReadonlyMap<string, readonly AxiomMark[]>` third
//    argument; every emitted node `data` carries `isAxiom: boolean`
//    stamped via `nodeHasAxiomMark`. Edges carry no axiom-mark — wire
//    schema is node-only per `axiomMarkProposalSchema`. Decision §4
//    explains why the boolean lives on `data` rather than as a
//    Cytoscape class.)
// Refinement: tasks/refinements/participant-ui/part_annotation_render.md
//   (Constraints — `projectGraph` signature widens AGAIN to take a
//    `nodeAnnotationIndex` + `edgeAnnotationIndex` pair (fourth and
//    fifth arguments). Every emitted node AND edge `data` carries
//    `hasAnnotation: boolean` + `annotationCount: number` stamped from
//    the per-target bucket. The structural divergence from
//    `part_axiom_mark_decoration` — annotations target both kinds per
//    the wire schema XOR — is noted in Decision §1.)
// Refinement: tasks/refinements/participant-ui/part_diagnostic_highlights.md
//   (Constraints — `projectGraph` signature widens AGAIN to take a
//    sixth `diagnosticHighlightIndex: DiagnosticHighlightIndex`
//    argument. Every emitted node AND edge `data` carries
//    `diagnosticHighlight: DiagnosticHighlight | null` stamped from the
//    per-target bucket. Symmetric across node + edge per Decision §1 —
//    two of the five surfaced diagnostic kinds (`contradiction` and
//    `coherency-hint.self-contradicts`) touch edges in addition to
//    nodes.)
// Refinement: tasks/refinements/participant-ui/part_own_vote_indicators.md
//   (Constraints — `projectGraph` signature widens AGAIN to take a
//    seventh `ownVoteIndex: OwnVoteIndex` argument. Every emitted node
//    AND edge `data` carries `ownVote: OwnVote` (`'agree' | 'dispute' |
//    'none'`) stamped from the per-target bucket — Decision §1
//    symmetry: votes target both kinds per the wire
//    `set-edge-substance` proposal sub-kind. The sentinel `'none'`
//    covers both "no vote by the current participant" and "the
//    proposal envelope hasn't yet arrived" defensively, so Cytoscape's
//    `[ownVote = "..."]` selectors have a stable value to match.)
// Refinement: tasks/refinements/participant-ui/part_proposal_notification.md
//   (Constraints — `projectGraph` signature widens AGAIN to take an
//    OPTIONAL ninth `flashIndex: ReadonlyMap<string, true>` argument.
//    Every emitted node AND edge `data` carries `isFlashing: boolean`
//    stamped from `flashIndex.get(id) === true`. The argument is
//    optional so the 49 existing call sites in the test suite remain
//    diff-stable; the route hoist threads the live index in.
//    Symmetric across node + edge target kinds per Decision §1 — every
//    proposal sub-kind has a graph entity target.)
// Refinement: tasks/refinements/participant-ui/part_other_vote_indicators.md
//   (Constraints — `projectGraph` signature widens AGAIN to take an
//    eighth `othersVoteIndex: OthersVoteIndex` argument. Every emitted
//    node AND edge `data` carries `otherVotes: readonly OtherVote[]`
//    stamped from the per-target bucket — Decision §1 symmetry: votes
//    target both kinds per the wire `proposal` family. The default for
//    an entity with no other-votes is the shared
//    `EMPTY_OTHER_VOTES_LIST` reference (NOT a fresh `[]`) so the
//    projection's reference-equality bailout stays stable per the
//    prior leaves' `EMPTY_*` discipline. Per Decision §3 the field is
//    NOT consumed by any Cytoscape stylesheet selector at v0; the
//    DOM mirror's nested `<ul data-other-votes>` is the load-bearing
//    surface. The future `part_other_vote_indicators_canvas_dots`
//    leaf reads the same field off the Cytoscape element record via
//    the `...node.data` / `...edge.data` spread in the localized
//    `elements` memo.)
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
  annotationCountFor,
  edgeHasAnnotation,
  nodeHasAnnotation,
  type Annotation,
} from './annotations';
import { type AxiomMark, nodeHasAxiomMark } from './axiomMarks';
import { type DiagnosticHighlight, type DiagnosticHighlightIndex } from './diagnosticHighlights';
import {
  cardRollupStatus,
  EMPTY_FACET_STATUSES,
  type FacetName,
  type FacetStatus,
  type FacetStatusIndex,
} from '@a-conversa/shell';
import { computeNodeDimensions } from './nodeDimensions';
import { type OwnVote, type OwnVoteIndex } from './ownVotes';
import { EMPTY_OTHER_VOTES_LIST, type OtherVote, type OthersVoteIndex } from './otherVotes';

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
  /**
   * `true` iff at least one committed axiom-mark targets the node.
   * Sourced from the `axiomMarkIndex` argument via
   * `nodeHasAxiomMark`. Drives the `node[?isAxiom]` Cytoscape
   * stylesheet branch (the boolean overlay per Decision §3 of
   * `part_axiom_mark_decoration`) AND the
   * `data-is-axiom="true|false"` mirror attribute (Decision §5).
   */
  readonly isAxiom: boolean;
  /**
   * `true` iff at least one committed annotation targets the node.
   * Sourced from the `nodeAnnotationIndex` argument via
   * `nodeHasAnnotation`. Drives the `node[?hasAnnotation]` Cytoscape
   * stylesheet branch (the amber overlay per Decision §3 of
   * `part_annotation_render`) AND the
   * `data-has-annotation="true|false"` mirror attribute (Decision §5).
   */
  readonly hasAnnotation: boolean;
  /**
   * Total count of committed annotations targeting this node (any kind,
   * any author). Sourced from the `nodeAnnotationIndex` argument via
   * `annotationCountFor`. Drives the `data-annotation-count="<n>"`
   * mirror attribute (Decision §5). The at-a-glance card layer carries
   * presence + count; the per-annotation breakdown (kind / content /
   * author list) is the future entity-detail-panel consumer's concern
   * (Decision §1).
   */
  readonly annotationCount: number;
  /**
   * Per-entity diagnostic-highlight rollup, or `null` when no active
   * structural diagnostic touches this node. Sourced from the
   * `diagnosticHighlightIndex.nodes` argument. Drives the
   * `node[diagnosticSeverity = "..."]` Cytoscape stylesheet branches
   * (the amber border overlay per Decision §3 of
   * `part_diagnostic_highlights`) AND the
   * `data-diagnostic-severity` / `data-diagnostic-kinds` mirror
   * attributes (Decision §5). The at-a-glance card layer carries the
   * rolled-up severity + the deduped kind list; the per-kind
   * localized prose (`diagnostics.<kind>.title` / `.description` /
   * etc.) is the future entity-detail-panel consumer's concern
   * (Decision §1).
   */
  readonly diagnosticHighlight: DiagnosticHighlight | null;
  /**
   * Current participant's at-a-glance own-vote disposition on this
   * node, rolled up across every facet-targeting proposal that
   * references the node. Sourced from `ownVoteIndex.nodes`. Drives the
   * `node[ownVote = "agree"]` / `node[ownVote = "dispute"]` Cytoscape
   * stylesheet branches (the text-outline label-stroke per
   * Decision §3 of `part_own_vote_indicators`) AND the
   * `data-own-vote="agree|dispute|none"` mirror attribute (Decision §5).
   * The `'none'` sentinel covers "no recordable vote by the current
   * participant". (Per ADR 0030 §3 + `pf_unit_test_audit` the legacy
   * `'withdraw'` vote-choice arm is retired; withdrawal is its own
   * first-class event kind, `withdraw-agreement`, surfaced via the
   * facet-status projection, not via this at-a-glance ring.)
   */
  readonly ownVote: OwnVote;
  /**
   * Per-entity list of OTHER participants' at-a-glance votes on this
   * node, rolled up across every facet-targeting proposal that
   * references the node. Sourced from `othersVoteIndex.nodes`. Each
   * entry is `{ participantId, choice: 'agree' | 'dispute' }`. Per
   * ADR 0030 §3 + `pf_unit_test_audit` the wire enum is `'agree' |
   * 'dispute'` and no `'withdraw'` arm reaches this layer; withdrawal
   * is its own first-class event kind (`withdraw-agreement`).
   * First-vote-arrival sort order per Decision §5; arm-switching by
   * the same voter overwrites in-place at the original position
   * (mirrors the moderator's `positionIndex` posture).
   *
   * NOT consumed by any Cytoscape stylesheet selector at v0
   * (Decision §3 — DOM-mirror-only). The mirror render in
   * `GraphView.tsx` surfaces the list as a nested
   * `<ul data-other-votes>` per `<li>` row carrying per-voter
   * `<li data-other-vote data-voter-id="..." data-vote="...">`
   * children (Decision §6). The future
   * `part_other_vote_indicators_canvas_dots` polish leaf reads the
   * same field off the Cytoscape element record (carried through the
   * `...node.data` spread in `GraphView.tsx`'s localized memo).
   *
   * Defaults to the shared `EMPTY_OTHER_VOTES_LIST` frozen reference
   * for an entity with no recordable other-votes — keeps the
   * memoization stable across re-projection passes for the no-vote
   * baseline.
   */
  readonly otherVotes: readonly OtherVote[];
  /**
   * `true` iff this node is currently in the new-proposal-arrival
   * flash window. Sourced from the `flashIndex` argument; the consumer
   * (`<GraphView>`) reads this on each Cytoscape element's data
   * payload to drive the `node[?isFlashing]` stylesheet selector AND
   * the mirror's `data-flashing="true|false"` attribute. The window
   * length and arrival-detection semantics live in
   * `useNewProposalArrival`; this field is the projection-layer carrier
   * for the transient signal.
   *
   * Refinement: tasks/refinements/participant-ui/part_proposal_notification.md.
   */
  readonly isFlashing: boolean;
  /**
   * Per-node Cytoscape box width (px), computed from the wording string
   * by `computeNodeDimensions`. The baseline stylesheet's
   * `width: 'data(width)'` mapper reads this. Refinement:
   * tasks/refinements/participant-ui/part_layout_measured_dimensions.md.
   */
  readonly width: number;
  /** Per-node Cytoscape box height (px). Symmetric with `width`. */
  readonly height: number;
  /** Per-node `text-max-width` budget (px), `width - 2 * padding`. */
  readonly textMaxWidth: number;
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
  /**
   * `true` iff at least one committed annotation targets the edge.
   * Sourced from the `edgeAnnotationIndex` argument via
   * `edgeHasAnnotation`. Drives the `edge[?hasAnnotation]` Cytoscape
   * stylesheet branch (the amber halo per Decision §3 of
   * `part_annotation_render`) AND the
   * `data-has-annotation="true|false"` mirror attribute.
   *
   * Symmetric with `ParticipantNodeData.hasAnnotation` — annotations
   * target both nodes AND edges per the wire schema's XOR (Decision §1
   * of `part_annotation_render` documents the divergence from
   * `part_axiom_mark_decoration`, which is node-only).
   */
  readonly hasAnnotation: boolean;
  /**
   * Total count of committed annotations targeting this edge. Sourced
   * from the `edgeAnnotationIndex` argument via `annotationCountFor`.
   * Drives the `data-annotation-count="<n>"` mirror attribute.
   * Symmetric with `ParticipantNodeData.annotationCount`.
   */
  readonly annotationCount: number;
  /**
   * Per-entity diagnostic-highlight rollup, or `null` when no active
   * structural diagnostic touches this edge. Sourced from the
   * `diagnosticHighlightIndex.edges` argument. Drives the
   * `edge[diagnosticSeverity = "..."]` Cytoscape stylesheet branches
   * (the amber underlay halo per Decision §3 of
   * `part_diagnostic_highlights`) AND the
   * `data-diagnostic-severity` / `data-diagnostic-kinds` mirror
   * attributes. Symmetric with `ParticipantNodeData.diagnosticHighlight`
   * — two of the surfaced diagnostic kinds touch edges
   * (`contradiction.edges` and `coherency-hint.self-contradicts.edgeId`)
   * per Decision §1.
   */
  readonly diagnosticHighlight: DiagnosticHighlight | null;
  /**
   * Current participant's at-a-glance own-vote disposition on this
   * edge, rolled up across every facet-targeting proposal that
   * references the edge (today only the `set-edge-substance`
   * sub-kind). Sourced from `ownVoteIndex.edges`. Drives the
   * `edge[ownVote = "agree"]` / `edge[ownVote = "dispute"]` Cytoscape
   * stylesheet branches (the text-outline label-stroke per Decision §3
   * of `part_own_vote_indicators`) AND the
   * `data-own-vote="agree|dispute|none"` mirror attribute.
   *
   * Symmetric with `ParticipantNodeData.ownVote` per Decision §1 — the
   * wire `proposal` family targets both node entities AND edge entities
   * via the `set-edge-substance` sub-kind; the participant's at-a-
   * glance own-vote ring paints on both kinds.
   */
  readonly ownVote: OwnVote;
  /**
   * Per-entity list of OTHER participants' at-a-glance votes on this
   * edge, rolled up across every facet-targeting proposal that
   * references the edge (today only the `set-edge-substance`
   * sub-kind). Sourced from `othersVoteIndex.edges`. Each entry is
   * `{ participantId, choice: 'agree' | 'dispute' }`. Per ADR 0030 §3 +
   * `pf_unit_test_audit` the wire enum is `'agree' | 'dispute'` and no
   * `'withdraw'` arm reaches this layer; withdrawal is its own first-
   * class event kind (`withdraw-agreement`). First-vote-arrival sort
   * order per Decision §5.
   *
   * Symmetric with `ParticipantNodeData.otherVotes` per Decision §1 —
   * the wire `proposal` family targets both node + edge entities; the
   * per-entity per-other-voter row paints on both kinds.
   *
   * Defaults to the shared `EMPTY_OTHER_VOTES_LIST` frozen reference
   * for an edge with no recordable other-votes.
   */
  readonly otherVotes: readonly OtherVote[];
  /**
   * `true` iff this edge is currently in the new-proposal-arrival
   * flash window. Sourced from the `flashIndex` argument. Symmetric
   * with `ParticipantNodeData.isFlashing` — both kinds carry the
   * transient signal because every proposal sub-kind targets either
   * a node or an edge.
   *
   * Refinement: tasks/refinements/participant-ui/part_proposal_notification.md.
   */
  readonly isFlashing: boolean;
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
/**
 * Stable empty-flash-index reference. Returned literally (not a fresh
 * `new Map()`) so downstream `useMemo` dep arrays bail out cleanly
 * when the consumer has nothing to flash.
 *
 * Refinement: tasks/refinements/participant-ui/part_proposal_notification.md.
 */
export const EMPTY_FLASH_INDEX: ReadonlyMap<string, true> = Object.freeze(new Map<string, true>());

export function projectGraph(
  events: readonly Event[],
  facetStatusIndex: FacetStatusIndex,
  axiomMarkIndex: ReadonlyMap<string, readonly AxiomMark[]>,
  nodeAnnotationIndex: ReadonlyMap<string, readonly Annotation[]>,
  edgeAnnotationIndex: ReadonlyMap<string, readonly Annotation[]>,
  diagnosticHighlightIndex: DiagnosticHighlightIndex,
  ownVoteIndex: OwnVoteIndex,
  othersVoteIndex: OthersVoteIndex,
  flashIndex: ReadonlyMap<string, true> = EMPTY_FLASH_INDEX,
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
  // Map from `node_id` → the most-recent classification candidate value
  // named by a `classify-node` proposal. Used by the facet-keyed commit
  // arm (per ADR 0030 §2) to resolve the current candidate without a
  // `proposal_id` carrier; a new classify-node proposal overwrites the
  // entry per ADR 0030 §7.
  const currentClassificationByNode = new Map<string, StatementKind>();
  const edges: ParticipantEdgeElement[] = [];

  for (const event of events) {
    if (event.kind === 'node-created') {
      const slot = resolveFacetSlot(facetStatusIndex.nodes, event.payload.node_id);
      const dimensions = computeNodeDimensions(event.payload.wording);
      const element: ParticipantNodeElement = {
        group: 'nodes',
        data: {
          id: event.payload.node_id,
          wording: event.payload.wording,
          kind: null,
          facetStatuses: slot.facetStatuses,
          rollupStatus: slot.rollupStatus,
          isAxiom: nodeHasAxiomMark(axiomMarkIndex, event.payload.node_id),
          hasAnnotation: nodeHasAnnotation(nodeAnnotationIndex, event.payload.node_id),
          annotationCount: annotationCountFor(nodeAnnotationIndex, event.payload.node_id),
          diagnosticHighlight: diagnosticHighlightIndex.nodes.get(event.payload.node_id) ?? null,
          ownVote: ownVoteIndex.nodes.get(event.payload.node_id) ?? 'none',
          otherVotes: othersVoteIndex.nodes.get(event.payload.node_id) ?? EMPTY_OTHER_VOTES_LIST,
          isFlashing: flashIndex.get(event.payload.node_id) === true,
          width: dimensions.width,
          height: dimensions.height,
          textMaxWidth: dimensions.textMaxWidth,
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
          hasAnnotation: edgeHasAnnotation(edgeAnnotationIndex, event.payload.edge_id),
          annotationCount: annotationCountFor(edgeAnnotationIndex, event.payload.edge_id),
          diagnosticHighlight: diagnosticHighlightIndex.edges.get(event.payload.edge_id) ?? null,
          ownVote: ownVoteIndex.edges.get(event.payload.edge_id) ?? 'none',
          otherVotes: othersVoteIndex.edges.get(event.payload.edge_id) ?? EMPTY_OTHER_VOTES_LIST,
          isFlashing: flashIndex.get(event.payload.edge_id) === true,
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
        // Track the most-recent classification candidate per node so a
        // facet-keyed commit (per ADR 0030 §2) can resolve the current
        // candidate without a `proposal_id`. A new classify-node
        // proposal supersedes the prior candidate per ADR 0030 §7.
        currentClassificationByNode.set(inner.node_id, inner.classification);
      }
      continue;
    }

    if (event.kind === 'commit') {
      // Per ADR 0030 §2 + §9: commit payloads are a `target`-
      // discriminated union. The facet-keyed arm carries
      // `(entity_kind, entity_id, facet)`; the proposal-keyed arm
      // carries `proposal_id`. Both flip the matching node's `kind` to
      // the current classification candidate.
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
          data: {
            ...existing.data,
            kind: classification,
          },
        };
        continue;
      }
      // target === 'proposal' — structural arm or legacy facet-valued
      // arm for any proposal-keyed commits still on the log.
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
