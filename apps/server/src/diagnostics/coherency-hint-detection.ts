// Detect unusual edge/kind configurations (coherency hints) in the
// visible graph.
//
// Refinement: tasks/refinements/data-and-methodology/coherency_hint_detection.md
// TaskJuggler: data_and_methodology.diagnostics.coherency_hint_detection
//
// Pure read function over the projection. Per `docs/data-model.md`
// lines 143–151 ("Coherency guidance") and 195–197 ("Coherency
// violations"):
//
//   "Some edge/node configurations are typical; others are unusual.
//    The system provides advisory hints when an unusual configuration
//    is created. … The list of typical/unusual patterns will grow with
//    experience. The system never blocks; it nudges."
//
// Internally the detector is a **list of rule functions**, one per
// `HintKind`. The public `detectCoherencyHints` reduces the list with
// flatMap, concatenating each rule's output. A new rule is added by
// writing a new function and appending it to the rule list — this is
// the explicit extensibility model the WBS note calls out ("small
// rule set; rules can be added over time"). The rule functions are
// not exported individually; they are implementation detail of the
// composed detector.
//
// v1 ships three rules, all doc-grounded:
//
//   1. `incomplete-warrant-missing-bridges-to` — per `docs/data-model.md`
//      lines 122–131. A warrant is defined as a node W with TWO
//      outgoing edges (`bridges-from` to D, `bridges-to` to C); a node
//      with only `bridges-from` is structurally meaningless as a
//      warrant. The `multi_warrant_detection` refinement explicitly
//      hands off this case to coherency_hint_detection.
//   2. `incomplete-warrant-missing-bridges-from` — the mirror case.
//   3. `self-contradicts` — per `docs/data-model.md` line 120. The data
//      model is explicit that genuinely-symmetric contradictions are
//      encoded as **two opposite-direction edges**, not as a single
//      self-loop. A `contradicts` edge whose source equals its target
//      is the degenerate case the encoding doesn't anticipate.
//
// Filtering (uniform across rules):
//   - `edge.visible === true` — broken edges and edges whose endpoints
//     were superseded by decompose / restructure don't participate.
//   - `getNode(edge.sourceNodeId)?.visible === true` AND
//     `getNode(edge.targetNodeId)?.visible === true` — defensive
//     guard mirroring the sibling detectors; the projection cascades
//     endpoint visibility onto edges.
//
// Notably absent: no `isEdgeActive` gate, no substance-agreement
// check. Per `docs/data-model.md` lines 143–151 coherency hints are
// about **structure** — "edge/node configurations." A warrant with
// only one bridge edge is structurally incomplete whether or not the
// substance of either edge is agreed; a self-`contradicts` edge is
// structurally odd whether or not anyone has agreed it actually
// contradicts. This mirrors the multi-warrant and dangling-claim
// detectors' structural-only stance and diverges deliberately from
// the cycle / contradiction detectors (which gate on `isEdgeActive`).
//
// Annotation-endpoint edges.
//   The three v1 per-rule inline guards skip annotation-endpoint
//   edges — those rules are node-node by construction (see
//   `diagnostics_annotation_endpoint_semantics_audit` D3 for the
//   per-rule rationale). Annotation-endpoint structural smells are
//   surfaced by dedicated rules that the audit named:
//     - `annotation-of-annotation-chain` (LANDED — rule 4 below). An
//       `annotation A → role → annotation B` chain of depth ≥ 2;
//       arbitrarily deep annotation-on-annotation chains indicate the
//       meta-discussion has migrated off the substance graph. Cites
//       `docs/methodology.md` "Advisory diagnostics → Coherency hints
//       → Annotation-of-annotation chain (depth ≥ 2)". Refinement:
//       `tasks/refinements/data-and-methodology/coherency_annotation_of_annotation_chain_rule.md`.
//     - `self-referential-annotation-contradicts` (LANDED — rule 5
//       below). A `contradicts` edge connecting a node `N` and an
//       annotation `A` whose anchor is `N`, in either edge direction.
//       Structurally points at "withdraw the annotation" as the
//       resolution rather than "resolve the contradiction at the
//       substance layer" — the methodology positions `contradicts` as
//       a peer-substance relation, not an entity↔metadata one. Cites
//       `docs/methodology.md` "Advisory diagnostics → Coherency hints
//       → Self-referential annotation contradicts (node ↔ own
//       annotation)". Refinement:
//       `tasks/refinements/data-and-methodology/coherency_self_referential_annotation_contradicts_rule.md`.
//     - `non-self-referential-annotation-contradicts` (LANDED — rule 6
//       below). A `contradicts` edge connecting a node `N1` and an
//       annotation `A` whose anchor is some *other* node `N2`
//       (`A.targetNodeId !== null` AND `A.targetNodeId !== N1`), in
//       either edge direction. The cross-anchor partner of the
//       self-referential rule — the two rules' anchor-match filters are
//       inverses and together partition the mixed-endpoint contradicts
//       shape space. Resolution paths diverge: re-target the contradicts
//       edge at `N2`, or extract `A`'s substance as a peer node. Cites
//       `docs/methodology.md` "Advisory diagnostics → Coherency hints
//       → Cross-anchor annotation contradicts (node ↔ annotation-on-a-
//       different-node)". Refinement:
//       `tasks/refinements/data-and-methodology/coherency_non_self_referential_annotation_contradicts_rule.md`.
//
// Boundary with siblings:
//   - `multi_warrant_detection` (settled) counts only COMPLETE
//     warrants (both bridge edges present) on the same (D, C) pair.
//     Incomplete warrants are this detector's responsibility — the
//     two detectors partition the warrant-shape space.
//   - `dangling_claim_detection` (settled) fires on absence of
//     incoming justification edges on a claim-positioned node. That
//     is about absence of engagement on a target node; coherency
//     hints are about structurally-odd configurations of the edges
//     and nodes themselves.
//   - `diagnostic_event_emission` (M2 sibling) wires this function's
//     output into the event-stream surface.
//   - `blocking_vs_advisory_classification` (M2 sibling) classifies
//     coherency hints. Per the doc's "advisory hints" framing, all
//     v1 hint kinds are expected to land as advisory in that
//     downstream classification.

import type { Projection } from '../projection/projection.js';

/**
 * Discriminator for the `CoherencyHint` discriminated union.
 *
 * String-literal union rather than a runtime enum. Same choice as the
 * event-kind discriminator in `@a-conversa/shared-types` — smaller
 * bundle, cleaner narrowing in TypeScript `switch` statements, no
 * enum-import overhead. If a future surface wants a runtime listing
 * of all hint kinds, add an `ALL_HINT_KINDS` const-array without
 * changing the type.
 *
 * New rules add a new string literal here AND append a rule function
 * to the `RULES` list below.
 */
export type HintKind =
  | 'incomplete-warrant-missing-bridges-to'
  | 'incomplete-warrant-missing-bridges-from'
  | 'self-contradicts'
  | 'annotation-of-annotation-chain'
  | 'self-referential-annotation-contradicts'
  | 'non-self-referential-annotation-contradicts';

/**
 * Hint emitted by the `incomplete-warrant-missing-bridges-to` rule.
 * A warrant node W has at least one visible `bridges-from W → D`
 * edge but no visible `bridges-to` outgoing edge — one hint per
 * dangling `bridges-from`. Carries the warrant node id and the data
 * node id of that particular `bridges-from` so downstream UI can
 * render "warrant W is wired to data D but has no claim wired" per
 * unfinished pair.
 */
export interface IncompleteWarrantMissingBridgesToHint {
  kind: 'incomplete-warrant-missing-bridges-to';
  warrantNodeId: string;
  dataNodeId: string;
}

/**
 * Hint emitted by the `incomplete-warrant-missing-bridges-from` rule.
 * Mirror of the above: a warrant node W has at least one visible
 * `bridges-to W → C` edge but no visible `bridges-from` outgoing
 * edge — one hint per dangling `bridges-to`. Carries the warrant
 * node id and the claim node id.
 */
export interface IncompleteWarrantMissingBridgesFromHint {
  kind: 'incomplete-warrant-missing-bridges-from';
  warrantNodeId: string;
  claimNodeId: string;
}

/**
 * Hint emitted by the `self-contradicts` rule. A visible `contradicts`
 * edge whose `sourceNodeId === targetNodeId`. The doc (`docs/data-model.md`
 * line 120) says genuinely-symmetric contradictions are represented
 * as two opposite-direction edges; a single self-loop is the
 * degenerate case. Carries both the edge id (so the UI can highlight
 * the specific edge) and the node id (so it can highlight the node).
 */
export interface SelfContradictsHint {
  kind: 'self-contradicts';
  edgeId: string;
  nodeId: string;
}

/**
 * Hint emitted by the `annotation-of-annotation-chain` rule. An edge
 * whose source is an annotation and whose target is an annotation,
 * where the source annotation is itself the target of another visible
 * annotation-to-annotation edge — i.e., the chain of contiguous
 * annotation-to-annotation hops reaches depth ≥ 2 at this edge.
 *
 * Cites `docs/methodology.md` "Advisory diagnostics → Coherency hints
 * → Annotation-of-annotation chain (depth ≥ 2)" — the smell is that
 * the discussion has migrated off the substance graph onto its own
 * metadata layer; the typical resolution is to withdraw the deeper
 * annotations and re-land the discussion at the substance level.
 *
 * Per the refinement Decisions, the rule emits one hint per
 * second-or-later hop (a chain of depth D emits D−1 hints; cycles
 * emit one hint per edge). `incomingEdgeId` identifies the prior
 * annotation-to-annotation edge whose target equals this edge's
 * source — the structural witness that establishes the chain.
 */
export interface AnnotationOfAnnotationChainHint {
  kind: 'annotation-of-annotation-chain';
  edgeId: string;
  sourceAnnotationId: string;
  targetAnnotationId: string;
  incomingEdgeId: string;
}

/**
 * Hint emitted by the `self-referential-annotation-contradicts` rule.
 * A visible `contradicts` edge with exactly one node endpoint and
 * exactly one annotation endpoint, where the annotation's anchor is
 * that same node (`annotation.targetNodeId === node.id`). Fires in
 * both edge directions (`N → contradicts → A` and `A → contradicts → N`);
 * the structural smell is symmetric.
 *
 * Cites `docs/methodology.md` "Advisory diagnostics → Coherency hints
 * → Self-referential annotation contradicts (node ↔ own annotation)".
 *
 * The payload carries the three involved entity ids — the qualifying
 * edge, its node endpoint, and its annotation endpoint — direction-
 * agnostic so the UI can render either arrow direction from the
 * underlying edge fields without re-encoding direction in the hint.
 */
export interface SelfReferentialAnnotationContradictsHint {
  kind: 'self-referential-annotation-contradicts';
  edgeId: string;
  nodeId: string;
  annotationId: string;
}

/**
 * Hint emitted by the `non-self-referential-annotation-contradicts`
 * rule. A visible `contradicts` edge with exactly one node endpoint
 * `N1` and exactly one annotation endpoint `A`, where `A`'s anchor is
 * some other node `N2` (`A.targetNodeId !== null` AND
 * `A.targetNodeId !== N1`). Fires in both edge directions
 * (`N1 → contradicts → A` and `A → contradicts → N1`); the structural
 * smell is symmetric.
 *
 * Cites `docs/methodology.md` "Advisory diagnostics → Coherency hints
 * → Cross-anchor annotation contradicts (node ↔ annotation-on-a-
 * different-node)".
 *
 * Payload carries four ids — the qualifying edge, its node endpoint
 * `N1`, its annotation endpoint `A`, AND the annotation's actual
 * anchor node `N2` (`anchorNodeId`). Per refinement D8 `anchorNodeId`
 * is structurally load-bearing: the cross-anchor case has three
 * distinct entities the UI surface needs to highlight to render the
 * smell legibly. `anchorNodeId` is guaranteed distinct from `nodeId`
 * by the rule's anchor-mismatch filter.
 */
export interface NonSelfReferentialAnnotationContradictsHint {
  kind: 'non-self-referential-annotation-contradicts';
  edgeId: string;
  nodeId: string;
  annotationId: string;
  anchorNodeId: string;
}

/**
 * One coherency hint. Discriminated union over `HintKind`. Downstream
 * consumers `switch` on `kind` and handle the per-variant payload.
 */
export type CoherencyHint =
  | IncompleteWarrantMissingBridgesToHint
  | IncompleteWarrantMissingBridgesFromHint
  | SelfContradictsHint
  | AnnotationOfAnnotationChainHint
  | SelfReferentialAnnotationContradictsHint
  | NonSelfReferentialAnnotationContradictsHint;

// ---------------------------------------------------------------
// Rule functions — one per HintKind, composed by detectCoherencyHints.
// Each rule is a pure function over the projection that emits the
// hints it owns. Rules are independent; one rule's hints do not
// suppress another rule's hints.
// ---------------------------------------------------------------

/**
 * Detect warrants W that have at least one visible `bridges-from W → D`
 * outgoing edge AND zero visible `bridges-to` outgoing edges. Emits
 * one hint per dangling `bridges-from`.
 *
 * Iteration: walks `projection.nodes()` in insertion order. For each
 * visible node, uses `getEdgesBySource(W.id)` to enumerate W's
 * outgoing edges in a single O(out-degree) pass.
 */
function detectIncompleteWarrantsMissingBridgesTo(
  projection: Projection,
): IncompleteWarrantMissingBridgesToHint[] {
  const hints: IncompleteWarrantMissingBridgesToHint[] = [];
  for (const node of projection.nodes()) {
    if (!node.visible) continue;

    const outgoing = projection.getEdgesBySource(node.id);
    const bridgesFromEdges: { edgeId: string; dataNodeId: string }[] = [];
    let hasBridgesTo = false;

    for (const edge of outgoing) {
      if (!edge.visible) continue;
      // Per `diagnostics_annotation_endpoint_semantics_audit` D3: v1
      // coherency-hint rules (incomplete-warrant, self-contradicts)
      // are node-node (data-model.md L197-199); candidate
      // annotation-endpoint rules are named under that refinement's
      // Tech-debt registration.
      if (edge.targetNodeId === null) continue;
      // Defensive endpoint-visibility check, matching the sibling
      // detectors. The projection cascades endpoint visibility onto
      // edges (per data-model.md lines 287–293) so a visible edge
      // with an invisible endpoint shouldn't happen.
      const target = projection.getNode(edge.targetNodeId);
      if (!target || !target.visible) continue;

      if (edge.role === 'bridges-from') {
        bridgesFromEdges.push({ edgeId: edge.id, dataNodeId: edge.targetNodeId });
      } else if (edge.role === 'bridges-to') {
        hasBridgesTo = true;
      }
    }

    if (bridgesFromEdges.length > 0 && !hasBridgesTo) {
      for (const { dataNodeId } of bridgesFromEdges) {
        hints.push({
          kind: 'incomplete-warrant-missing-bridges-to',
          warrantNodeId: node.id,
          dataNodeId,
        });
      }
    }
  }
  return hints;
}

/**
 * Mirror of `detectIncompleteWarrantsMissingBridgesTo`. Detects
 * warrants W with at least one visible `bridges-to W → C` outgoing
 * edge AND zero visible `bridges-from` outgoing edges. Emits one
 * hint per dangling `bridges-to`.
 */
function detectIncompleteWarrantsMissingBridgesFrom(
  projection: Projection,
): IncompleteWarrantMissingBridgesFromHint[] {
  const hints: IncompleteWarrantMissingBridgesFromHint[] = [];
  for (const node of projection.nodes()) {
    if (!node.visible) continue;

    const outgoing = projection.getEdgesBySource(node.id);
    const bridgesToEdges: { edgeId: string; claimNodeId: string }[] = [];
    let hasBridgesFrom = false;

    for (const edge of outgoing) {
      if (!edge.visible) continue;
      // Per `diagnostics_annotation_endpoint_semantics_audit` D3: v1
      // coherency-hint rules (incomplete-warrant, self-contradicts)
      // are node-node (data-model.md L197-199); candidate
      // annotation-endpoint rules are named under that refinement's
      // Tech-debt registration.
      if (edge.targetNodeId === null) continue;
      const target = projection.getNode(edge.targetNodeId);
      if (!target || !target.visible) continue;

      if (edge.role === 'bridges-to') {
        bridgesToEdges.push({ edgeId: edge.id, claimNodeId: edge.targetNodeId });
      } else if (edge.role === 'bridges-from') {
        hasBridgesFrom = true;
      }
    }

    if (bridgesToEdges.length > 0 && !hasBridgesFrom) {
      for (const { claimNodeId } of bridgesToEdges) {
        hints.push({
          kind: 'incomplete-warrant-missing-bridges-from',
          warrantNodeId: node.id,
          claimNodeId,
        });
      }
    }
  }
  return hints;
}

/**
 * Detect visible `contradicts` edges whose `sourceNodeId === targetNodeId`.
 * Per `docs/data-model.md` line 120, genuinely-symmetric contradictions
 * are represented as two opposite-direction edges; a self-loop is the
 * degenerate case that doesn't fit that representation.
 *
 * Iteration: walks `projection.edges()` in insertion order.
 */
function detectSelfContradicts(projection: Projection): SelfContradictsHint[] {
  const hints: SelfContradictsHint[] = [];
  for (const edge of projection.edges()) {
    if (!edge.visible) continue;
    if (edge.role !== 'contradicts') continue;
    // Per `diagnostics_annotation_endpoint_semantics_audit` D3: v1
    // coherency-hint rules (incomplete-warrant, self-contradicts) are
    // node-node (data-model.md L197-199); candidate annotation-
    // endpoint rules are named under that refinement's Tech-debt
    // registration.
    if (edge.sourceNodeId === null || edge.targetNodeId === null) continue;
    if (edge.sourceNodeId !== edge.targetNodeId) continue;

    const node = projection.getNode(edge.sourceNodeId);
    if (!node || !node.visible) continue;

    hints.push({
      kind: 'self-contradicts',
      edgeId: edge.id,
      nodeId: edge.sourceNodeId,
    });
  }
  return hints;
}

/**
 * Detect visible annotation-to-annotation edges whose source
 * annotation is itself the target of another visible annotation-to-
 * annotation edge — i.e., the contiguous annotation-to-annotation
 * chain reaches depth ≥ 2 at this edge.
 *
 * Cites `docs/methodology.md` "Advisory diagnostics → Coherency hints
 * → Annotation-of-annotation chain (depth ≥ 2)".
 *
 * Iteration: walks `projection.edges()` in insertion order. For each
 * candidate, uses `projection.getEdgesByTarget(sourceAnnotationId)` —
 * the polymorphic-key index accepts annotation IDs as well as node
 * IDs per `projection_edge_annotation_endpoint` — to find a visible
 * incoming annotation-to-annotation edge. Per the refinement D2 a
 * chain spans only contiguous annotation-to-annotation hops; a node
 * in the middle of the path breaks the chain because the methodology
 * smell is "the discussion has migrated off the substance graph",
 * and a node-endpoint edge is *on* the substance graph.
 */
function detectAnnotationOfAnnotationChains(
  projection: Projection,
): AnnotationOfAnnotationChainHint[] {
  const hints: AnnotationOfAnnotationChainHint[] = [];
  for (const edge of projection.edges()) {
    if (!edge.visible) continue;
    if (edge.sourceAnnotationId === null || edge.targetAnnotationId === null) continue;

    // Defensive endpoint-visibility guard — mirrors the sibling rules'
    // pattern. Per refinement D7 an invisible endpoint annotation
    // breaks the chain.
    const sourceAnn = projection.getAnnotation(edge.sourceAnnotationId);
    if (!sourceAnn || !sourceAnn.visible) continue;
    const targetAnn = projection.getAnnotation(edge.targetAnnotationId);
    if (!targetAnn || !targetAnn.visible) continue;

    // Look for a visible incoming annotation-to-annotation edge whose
    // target equals this edge's source annotation. First match wins —
    // if multiple incoming edges qualify, any one of them is a valid
    // structural witness of the chain at this hop.
    //
    // The witness must be a DISTINCT edge — an `A → A` self-loop's
    // `getEdgesByTarget(A)` includes the edge itself, but the rule's
    // "chain reaches depth ≥ 2 at this edge" framing (per refinement
    // D8's cycle example `A → B → A`) requires another edge as the
    // first hop. A single self-loop is depth 1, not 2.
    let incomingEdgeId: string | null = null;
    for (const incoming of projection.getEdgesByTarget(edge.sourceAnnotationId)) {
      if (incoming.id === edge.id) continue;
      if (!incoming.visible) continue;
      if (incoming.sourceAnnotationId === null || incoming.targetAnnotationId === null) {
        continue;
      }
      const incomingSourceAnn = projection.getAnnotation(incoming.sourceAnnotationId);
      if (!incomingSourceAnn || !incomingSourceAnn.visible) continue;
      incomingEdgeId = incoming.id;
      break;
    }
    if (incomingEdgeId === null) continue;

    hints.push({
      kind: 'annotation-of-annotation-chain',
      edgeId: edge.id,
      sourceAnnotationId: edge.sourceAnnotationId,
      targetAnnotationId: edge.targetAnnotationId,
      incomingEdgeId,
    });
  }
  return hints;
}

/**
 * Detect visible `contradicts` edges connecting a node and an
 * annotation whose anchor is that node — the formal contradiction
 * mechanism applied between an entity and its own metadata.
 *
 * Cites `docs/methodology.md` "Advisory diagnostics → Coherency hints
 * → Self-referential annotation contradicts (node ↔ own annotation)".
 *
 * Per refinement D2 the rule fires in both edge directions
 * (`node → contradicts → annotation` AND `annotation → contradicts →
 * node`): the structural smell is direction-agnostic. Per D3 the
 * anchor scope is direct node-anchor only — annotations anchored on an
 * edge (`targetEdgeId !== null`) do not qualify.
 *
 * Iteration: walks `projection.edges()` in insertion order; for each
 * mixed-endpoint contradicts edge looks up the annotation via
 * `projection.getAnnotation` and checks the anchor-match property
 * against the node endpoint.
 */
function detectSelfReferentialAnnotationContradicts(
  projection: Projection,
): SelfReferentialAnnotationContradictsHint[] {
  const hints: SelfReferentialAnnotationContradictsHint[] = [];
  for (const edge of projection.edges()) {
    if (!edge.visible) continue;
    if (edge.role !== 'contradicts') continue;

    // Mixed-endpoint filter — exactly one node endpoint and exactly
    // one annotation endpoint. Both-node edges are owned by
    // `self-contradicts`; both-annotation edges by
    // `annotation-of-annotation-chain`.
    let nodeId: string;
    let annotationId: string;
    if (
      edge.sourceNodeId !== null &&
      edge.targetAnnotationId !== null &&
      edge.sourceAnnotationId === null &&
      edge.targetNodeId === null
    ) {
      nodeId = edge.sourceNodeId;
      annotationId = edge.targetAnnotationId;
    } else if (
      edge.sourceAnnotationId !== null &&
      edge.targetNodeId !== null &&
      edge.sourceNodeId === null &&
      edge.targetAnnotationId === null
    ) {
      nodeId = edge.targetNodeId;
      annotationId = edge.sourceAnnotationId;
    } else {
      continue;
    }

    const node = projection.getNode(nodeId);
    if (!node || !node.visible) continue;
    const annotation = projection.getAnnotation(annotationId);
    if (!annotation || !annotation.visible) continue;

    // Anchor-match filter — annotation anchors directly on this node.
    if (annotation.targetNodeId !== nodeId) continue;

    hints.push({
      kind: 'self-referential-annotation-contradicts',
      edgeId: edge.id,
      nodeId,
      annotationId,
    });
  }
  return hints;
}

/**
 * Detect visible `contradicts` edges connecting a node `N1` and an
 * annotation `A` whose anchor is some *other* node `N2` — the formal
 * contradiction mechanism applied between an entity and metadata-
 * about-a-different-entity.
 *
 * Cites `docs/methodology.md` "Advisory diagnostics → Coherency hints
 * → Cross-anchor annotation contradicts (node ↔ annotation-on-a-
 * different-node)".
 *
 * Per refinement D2 the rule fires in both edge directions
 * (`node → contradicts → annotation` AND `annotation → contradicts →
 * node`): the structural smell is direction-agnostic. Per D3 the
 * anchor scope is direct node-anchor only — annotations anchored on an
 * edge (`targetNodeId === null`) do not qualify. Per D4 the
 * anchor-mismatch filter (`annotation.targetNodeId !== nodeEndpoint.id`)
 * partitions the mixed-endpoint contradicts shape space with the
 * sibling `self-referential-annotation-contradicts` rule: by
 * construction, exactly one of the two rules (or neither, for
 * edge-anchored annotations) fires per qualifying edge.
 *
 * Per D10 the visibility filter is on the *edge's* two direct endpoints
 * only — the annotation's anchor node `N2` does NOT need to be visible
 * for the hint to fire (the smell is about how the contradicts edge is
 * wired, not about the downstream anchor's projection state).
 */
function detectNonSelfReferentialAnnotationContradicts(
  projection: Projection,
): NonSelfReferentialAnnotationContradictsHint[] {
  const hints: NonSelfReferentialAnnotationContradictsHint[] = [];
  for (const edge of projection.edges()) {
    if (!edge.visible) continue;
    if (edge.role !== 'contradicts') continue;

    // Mixed-endpoint filter — exactly one node endpoint and exactly
    // one annotation endpoint. Mirrors the sibling self-referential
    // rule's filter.
    let nodeId: string;
    let annotationId: string;
    if (
      edge.sourceNodeId !== null &&
      edge.targetAnnotationId !== null &&
      edge.sourceAnnotationId === null &&
      edge.targetNodeId === null
    ) {
      nodeId = edge.sourceNodeId;
      annotationId = edge.targetAnnotationId;
    } else if (
      edge.sourceAnnotationId !== null &&
      edge.targetNodeId !== null &&
      edge.sourceNodeId === null &&
      edge.targetAnnotationId === null
    ) {
      nodeId = edge.targetNodeId;
      annotationId = edge.sourceAnnotationId;
    } else {
      continue;
    }

    const node = projection.getNode(nodeId);
    if (!node || !node.visible) continue;
    const annotation = projection.getAnnotation(annotationId);
    if (!annotation || !annotation.visible) continue;

    // Anchor-mismatch filter — annotation anchors on some other node.
    // The not-null guard excludes edge-anchored annotations (D3); the
    // inequality excludes the self-referential case (owned by the
    // sibling rule, D4).
    if (annotation.targetNodeId === null) continue;
    if (annotation.targetNodeId === nodeId) continue;

    hints.push({
      kind: 'non-self-referential-annotation-contradicts',
      edgeId: edge.id,
      nodeId,
      annotationId,
      anchorNodeId: annotation.targetNodeId,
    });
  }
  return hints;
}

// ---------------------------------------------------------------
// Rule registry.
// ---------------------------------------------------------------

/**
 * Module-private registry of rule functions. Each rule is a pure
 * function from a projection to its own hint kind's output. Rules
 * run in declaration order; the public `detectCoherencyHints`
 * concatenates their output via `flatMap`.
 *
 * **Adding a new rule**: write a new `detect<RuleName>(projection)`
 * function above, add a new variant to the `HintKind` union and the
 * `CoherencyHint` discriminated union, and append the new function
 * here. The pure-function shape and visibility filter pattern carry
 * over.
 */
const RULES: ReadonlyArray<(projection: Projection) => CoherencyHint[]> = [
  detectIncompleteWarrantsMissingBridgesTo,
  detectIncompleteWarrantsMissingBridgesFrom,
  detectSelfContradicts,
  detectAnnotationOfAnnotationChains,
  detectSelfReferentialAnnotationContradicts,
  detectNonSelfReferentialAnnotationContradicts,
];

/**
 * Detect coherency hints in the visible graph.
 *
 * Pure read function. Returns the concatenated output of each rule
 * in `RULES`, in rule-declaration order. Empty when no rule fires.
 *
 * Per the refinement Decisions section, rules are independent — one
 * rule's hints do not suppress another rule's hints. A node that is
 * both an incomplete warrant AND has a self-contradicts edge
 * produces hints from both rules.
 */
export function detectCoherencyHints(projection: Projection): CoherencyHint[] {
  return RULES.flatMap((rule) => rule(projection));
}
