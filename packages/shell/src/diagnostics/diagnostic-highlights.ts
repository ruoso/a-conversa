// Canonical per-entity diagnostic-highlight vocabulary consumed by every
// UI surface (`apps/moderator/`, `apps/participant/`, `apps/audience/`).
//
// Refinement: tasks/refinements/shell-package/shell_diagnostic_highlights_extract.md
//   (the third-caller consolidation — the moderator + participant +
//   audience previously carried near-identical copies of this module.
//   This file lifts the union of all three: the canonical
//   `\0`-joined identity-key formula, the per-kind `affectedEntities()`
//   projection, the `projectDiagnosticHighlights()` rollup + thin
//   presence/severity helpers, and the audience-only
//   `flattenActiveDiagnosticsForFire` / `flattenActiveDiagnosticsForEdgeFire`
//   overlay-feeders.)
// Predecessors:
//   tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md
//     (Decision §1, §2 — the canonical identity-key formula + the per-kind
//     `affectedEntities()` + the `projectDiagnosticHighlights()` rollup.)
//   tasks/refinements/participant-ui/part_diagnostic_highlights.md
//     (Decision §1, §2, §8 — the `DiagnosticHighlight` /
//     `DiagnosticHighlightIndex` shapes, the `EMPTY_DIAGNOSTIC_HIGHLIGHTS`
//     frozen sentinel, the thin presence/severity helpers.)
//   tasks/refinements/audience/aud_diagnostic_fire_animation.md
//     (Decision §3, §7 — the sibling `flattenActiveDiagnosticsForFire`
//     overlay-feeder + the `DiagnosticFireTuple` shape.)
//   tasks/refinements/audience/aud_diagnostic_edge_fire_animation.md
//     (Decision §2 — the sibling `flattenActiveDiagnosticsForEdgeFire`
//     overlay-feeder + the `DiagnosticEdgeFireTuple` shape.)
//
// **Parallel client mirror** (historical, retained to document the
// lockstep-with-server invariant for future maintainers). The per-kind
// `Wire*Diagnostic` interfaces and the `diagnosticIdentityKey` formula
// MUST stay byte-identical to the server's source-of-truth at
// `apps/server/src/diagnostics/event-emission.ts` (and
// `apps/server/src/diagnostics/coherency-hint-detection.ts` for the
// coherency-hint sub-kinds). A drift between this module's
// `diagnosticIdentityKey` and the server's `identityKeyFor` breaks the
// `fired` / `cleared` matching at the WS-store layer (a `cleared` whose
// key doesn't match the previously-fired key leaks an "active" entry in
// the store forever). The consolidated companion vitest suite at
// `diagnostic-highlights.test.ts` hand-builds wire payloads from known
// server-side identities and round-trips the formula; a server-side
// drift fails the one shell suite (instead of three pre-lift
// per-app suites). The third-caller lift dissolves the cross-surface
// drift risk; the server-vs-shell mirror is the residual seam.

import type {
  DiagnosticPayload,
  WsDiagnosticKind,
  WsDiagnosticSeverity,
} from '@a-conversa/shared-types';

// ---------------------------------------------------------------
// Wire-type aliases.
// ---------------------------------------------------------------

/**
 * Severity of a diagnostic, as classified by the server-side
 * `classifyDiagnostic` and stamped on the wire envelope. Alias of
 * `WsDiagnosticSeverity` so client-side names stay stable while the
 * source of truth remains the wire enum.
 */
export type DiagnosticHighlightSeverity = WsDiagnosticSeverity;

/**
 * Kind discriminator of a diagnostic, identical to the wire enum. Alias
 * of `WsDiagnosticKind`.
 */
export type DiagnosticHighlightKind = WsDiagnosticKind;

// ---------------------------------------------------------------
// Mirrored per-kind payload shapes.
// ---------------------------------------------------------------
//
// These mirror `apps/server/src/diagnostics/event-emission.ts` and
// `apps/server/src/diagnostics/coherency-hint-detection.ts` verbatim.
// Inlined here (rather than imported via shared-types) because the wire
// envelope types `diagnostic` as `unknown`; this union is the
// client-side narrowing the projection walks. Any change to a
// server-side payload shape MUST be mirrored here.

/** Mirrors server `CycleDiagnosticEntry`. */
export interface WireCycleDiagnostic {
  kind: 'cycle';
  nodes: readonly string[];
}

/** Mirrors server `ContradictionDiagnosticEntry`. */
export interface WireContradictionDiagnostic {
  kind: 'contradiction';
  nodeA: string;
  nodeB: string;
  edges: readonly string[];
}

/** Mirrors server `MultiWarrantDiagnosticEntry`. */
export interface WireMultiWarrantDiagnostic {
  kind: 'multi-warrant';
  dataNodeId: string;
  claimNodeId: string;
  warrantNodeIds: readonly string[];
}

/** Mirrors server `DanglingClaimDiagnosticEntry`. */
export interface WireDanglingClaimDiagnostic {
  kind: 'dangling-claim';
  nodeId: string;
}

/** Mirrors `IncompleteWarrantMissingBridgesToHint`. */
export interface WireIncompleteWarrantMissingBridgesToHint {
  kind: 'incomplete-warrant-missing-bridges-to';
  warrantNodeId: string;
  dataNodeId: string;
}

/** Mirrors `IncompleteWarrantMissingBridgesFromHint`. */
export interface WireIncompleteWarrantMissingBridgesFromHint {
  kind: 'incomplete-warrant-missing-bridges-from';
  warrantNodeId: string;
  claimNodeId: string;
}

/** Mirrors `SelfContradictsHint`. */
export interface WireSelfContradictsHint {
  kind: 'self-contradicts';
  edgeId: string;
  nodeId: string;
}

/** Mirrors `AnnotationOfAnnotationChainHint`. */
export interface WireAnnotationOfAnnotationChainHint {
  kind: 'annotation-of-annotation-chain';
  edgeId: string;
  sourceAnnotationId: string;
  targetAnnotationId: string;
  incomingEdgeId: string;
}

/** Mirrors `SelfReferentialAnnotationContradictsHint`. */
export interface WireSelfReferentialAnnotationContradictsHint {
  kind: 'self-referential-annotation-contradicts';
  edgeId: string;
  nodeId: string;
  annotationId: string;
}

/** Mirrors `NonSelfReferentialAnnotationContradictsHint`. */
export interface WireNonSelfReferentialAnnotationContradictsHint {
  kind: 'non-self-referential-annotation-contradicts';
  edgeId: string;
  nodeId: string;
  annotationId: string;
  anchorNodeId: string;
}

export type WireCoherencyHint =
  | WireIncompleteWarrantMissingBridgesToHint
  | WireIncompleteWarrantMissingBridgesFromHint
  | WireSelfContradictsHint
  | WireAnnotationOfAnnotationChainHint
  | WireSelfReferentialAnnotationContradictsHint
  | WireNonSelfReferentialAnnotationContradictsHint;

/** Mirrors server `CoherencyHintDiagnosticEntry`. */
export interface WireCoherencyHintDiagnostic {
  kind: 'coherency-hint';
  hint: WireCoherencyHint;
}

/**
 * The shape of the inlined `payload.diagnostic` field across the five
 * surfaced diagnostic kinds. The wire envelope types `diagnostic` as
 * `unknown`; this union is the client-side narrowing the projection
 * walks.
 */
export type WireDiagnostic =
  | WireCycleDiagnostic
  | WireContradictionDiagnostic
  | WireMultiWarrantDiagnostic
  | WireDanglingClaimDiagnostic
  | WireCoherencyHintDiagnostic;

// ---------------------------------------------------------------
// Public projection shapes.
// ---------------------------------------------------------------

/**
 * A single entity's diagnostic-highlight rollup. `severity` is the
 * highest-severity hit on this entity (blocking wins over advisory);
 * `kinds` is every distinct diagnostic kind that touches the entity, in
 * encounter order (the order the diagnostic envelopes landed in).
 */
export interface DiagnosticHighlight {
  readonly severity: DiagnosticHighlightSeverity;
  readonly kinds: readonly DiagnosticHighlightKind[];
}

/**
 * The per-entity-kind index produced by `projectDiagnosticHighlights`.
 * Consumers look up by entity id; absent ids mean "no active diagnostic
 * touches this entity".
 */
export interface DiagnosticHighlightIndex {
  readonly nodes: ReadonlyMap<string, DiagnosticHighlight>;
  readonly edges: ReadonlyMap<string, DiagnosticHighlight>;
}

/**
 * Stable empty-index reference. Hands consumers a deterministic empty
 * value when the session has no active diagnostics — keeps the React /
 * Cytoscape memoization stable for the no-diagnostic baseline. Same
 * `EMPTY_*` pattern as `EMPTY_FACET_STATUSES`.
 */
export const EMPTY_DIAGNOSTIC_HIGHLIGHTS: DiagnosticHighlightIndex = Object.freeze({
  nodes: new Map<string, DiagnosticHighlight>(),
  edges: new Map<string, DiagnosticHighlight>(),
});

// ---------------------------------------------------------------
// Identity-key formula (mirror of server's `identityKeyFor`).
// ---------------------------------------------------------------
//
// Strings, joined with `\0`. UUID v4 strings never contain `\0` and the
// kind discriminators are ASCII, so the joined key is unambiguous.
// Every key carries the kind prefix so cross-kind collisions are
// impossible.

/**
 * Compute the canonical identity key for a `DiagnosticPayload`. MUST
 * produce the same string as the server's `identityKeyFor` for the
 * same canonical diagnostic — a drift breaks `fired` / `cleared`
 * matching and leaks active entries in the store. The companion test
 * pins the invariant.
 */
export function diagnosticIdentityKey(payload: DiagnosticPayload): string {
  const diagnostic = payload.diagnostic as WireDiagnostic;
  switch (diagnostic.kind) {
    case 'cycle': {
      const sorted = [...diagnostic.nodes].sort();
      return `cycle\0${sorted.join('\0')}`;
    }
    case 'contradiction':
      return `contradiction\0${diagnostic.nodeA}\0${diagnostic.nodeB}`;
    case 'multi-warrant': {
      const warrants = [...diagnostic.warrantNodeIds].sort();
      return `multi-warrant\0${diagnostic.dataNodeId}\0${diagnostic.claimNodeId}\0${warrants.join('\0')}`;
    }
    case 'dangling-claim':
      return `dangling-claim\0${diagnostic.nodeId}`;
    case 'coherency-hint':
      return coherencyHintIdentityKey(diagnostic.hint);
  }
}

function coherencyHintIdentityKey(hint: WireCoherencyHint): string {
  switch (hint.kind) {
    case 'incomplete-warrant-missing-bridges-to':
      return `coherency-hint\0incomplete-warrant-missing-bridges-to\0${hint.warrantNodeId}\0${hint.dataNodeId}`;
    case 'incomplete-warrant-missing-bridges-from':
      return `coherency-hint\0incomplete-warrant-missing-bridges-from\0${hint.warrantNodeId}\0${hint.claimNodeId}`;
    case 'self-contradicts':
      return `coherency-hint\0self-contradicts\0${hint.edgeId}`;
    case 'annotation-of-annotation-chain':
      return `coherency-hint\0annotation-of-annotation-chain\0${hint.edgeId}`;
    case 'self-referential-annotation-contradicts':
      return `coherency-hint\0self-referential-annotation-contradicts\0${hint.edgeId}`;
    case 'non-self-referential-annotation-contradicts':
      return `coherency-hint\0non-self-referential-annotation-contradicts\0${hint.edgeId}`;
  }
}

// ---------------------------------------------------------------
// Per-kind affected-entity extraction.
// ---------------------------------------------------------------

/**
 * The (nodes, edges) entity ids a diagnostic affects. Walks the
 * inlined `payload.diagnostic` shape and returns the entity ids the
 * methodology engine flagged. The returned arrays are deterministic
 * for a given payload but DO NOT deduplicate — callers (the rollup
 * loop in `projectDiagnosticHighlights`) handle duplicates by id.
 */
export function affectedEntities(payload: DiagnosticPayload): {
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
} {
  const diagnostic = payload.diagnostic as WireDiagnostic;
  switch (diagnostic.kind) {
    case 'cycle':
      return { nodes: diagnostic.nodes, edges: [] };
    case 'contradiction':
      return {
        nodes: [diagnostic.nodeA, diagnostic.nodeB],
        edges: diagnostic.edges,
      };
    case 'multi-warrant':
      return {
        nodes: [diagnostic.dataNodeId, diagnostic.claimNodeId, ...diagnostic.warrantNodeIds],
        edges: [],
      };
    case 'dangling-claim':
      return { nodes: [diagnostic.nodeId], edges: [] };
    case 'coherency-hint':
      return coherencyHintAffectedEntities(diagnostic.hint);
  }
}

function coherencyHintAffectedEntities(hint: WireCoherencyHint): {
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
} {
  switch (hint.kind) {
    case 'incomplete-warrant-missing-bridges-to':
      return { nodes: [hint.warrantNodeId, hint.dataNodeId], edges: [] };
    case 'incomplete-warrant-missing-bridges-from':
      return { nodes: [hint.warrantNodeId, hint.claimNodeId], edges: [] };
    case 'self-contradicts':
      return { nodes: [hint.nodeId], edges: [hint.edgeId] };
    case 'annotation-of-annotation-chain':
      return {
        nodes: [hint.sourceAnnotationId, hint.targetAnnotationId],
        edges: [hint.edgeId, hint.incomingEdgeId],
      };
    case 'self-referential-annotation-contradicts':
      return { nodes: [hint.nodeId, hint.annotationId], edges: [hint.edgeId] };
    case 'non-self-referential-annotation-contradicts':
      return {
        nodes: [hint.nodeId, hint.annotationId, hint.anchorNodeId],
        edges: [hint.edgeId],
      };
  }
}

// ---------------------------------------------------------------
// projectDiagnosticHighlights — the canvas-facing projection.
// ---------------------------------------------------------------

/**
 * Bucket every active diagnostic's affected entities into a per-entity
 * `DiagnosticHighlight`. The rollup rules:
 *
 * - `severity`: blocking wins over advisory. An entity touched by a
 *   blocking diagnostic AND an advisory one resolves to `'blocking'`.
 * - `kinds`: every distinct kind that touched the entity, in encounter
 *   order (the diagnostic-map iteration order is the wire arrival
 *   order; stable across reads on the same snapshot). Deduped by kind.
 *
 * Empty input → the stable `EMPTY_DIAGNOSTIC_HIGHLIGHTS` reference.
 */
export function projectDiagnosticHighlights(
  activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>,
): DiagnosticHighlightIndex {
  if (activeDiagnostics.size === 0) {
    return EMPTY_DIAGNOSTIC_HIGHLIGHTS;
  }

  interface Accumulator {
    severity: DiagnosticHighlightSeverity;
    kinds: DiagnosticHighlightKind[];
    seen: Set<DiagnosticHighlightKind>;
  }
  const nodes = new Map<string, Accumulator>();
  const edges = new Map<string, Accumulator>();

  function record(
    bucket: Map<string, Accumulator>,
    entityId: string,
    severity: DiagnosticHighlightSeverity,
    kind: DiagnosticHighlightKind,
  ): void {
    let acc = bucket.get(entityId);
    if (acc === undefined) {
      acc = { severity, kinds: [], seen: new Set() };
      bucket.set(entityId, acc);
    } else if (severity === 'blocking' && acc.severity === 'advisory') {
      acc.severity = 'blocking';
    }
    if (!acc.seen.has(kind)) {
      acc.seen.add(kind);
      acc.kinds.push(kind);
    }
  }

  for (const payload of activeDiagnostics.values()) {
    const ids = affectedEntities(payload);
    for (const nodeId of ids.nodes) {
      record(nodes, nodeId, payload.severity, payload.kind);
    }
    for (const edgeId of ids.edges) {
      record(edges, edgeId, payload.severity, payload.kind);
    }
  }

  const nodeOut = new Map<string, DiagnosticHighlight>();
  for (const [id, acc] of nodes) {
    nodeOut.set(id, { severity: acc.severity, kinds: acc.kinds });
  }
  const edgeOut = new Map<string, DiagnosticHighlight>();
  for (const [id, acc] of edges) {
    edgeOut.set(id, { severity: acc.severity, kinds: acc.kinds });
  }

  return { nodes: nodeOut, edges: edgeOut };
}

// ---------------------------------------------------------------
// Thin presence / severity helpers.
// ---------------------------------------------------------------

/**
 * `true` iff `nodeId` carries any active diagnostic in the index.
 */
export function nodeHasDiagnostic(index: DiagnosticHighlightIndex, nodeId: string): boolean {
  return index.nodes.has(nodeId);
}

/**
 * `true` iff `edgeId` carries any active diagnostic in the index.
 */
export function edgeHasDiagnostic(index: DiagnosticHighlightIndex, edgeId: string): boolean {
  return index.edges.has(edgeId);
}

/**
 * Severity of the rolled-up highlight for `(target, id)`, or the
 * literal sentinel `'none'` when no active diagnostic touches the
 * entity. Mirrors the projector's "explicit 'none' rather than
 * undefined" sentinel posture so consumers don't conflate "no active
 * diagnostic" with "we forgot to project".
 */
export function diagnosticSeverityFor(
  index: DiagnosticHighlightIndex,
  target: 'node' | 'edge',
  id: string,
): DiagnosticHighlightSeverity | 'none' {
  const bucket = target === 'node' ? index.nodes : index.edges;
  const highlight = bucket.get(id);
  return highlight?.severity ?? 'none';
}

// ---------------------------------------------------------------
// Audience-side fire-tuple flatteners.
// ---------------------------------------------------------------

/**
 * One per (active diagnostic, affected node). The audience's node-fire
 * overlay maps these into per-node halo `<span>`s.
 */
export interface DiagnosticFireTuple {
  readonly identityKey: string;
  readonly nodeId: string;
  readonly severity: DiagnosticHighlightSeverity;
}

/**
 * Walk the per-session `activeDiagnostics` map and emit one tuple per
 * (identity, affected-node) pair. Severity is carried verbatim from the
 * payload. The output order is the map's iteration order followed by
 * per-payload affected-node order; deterministic for a given input map
 * but stability is NOT a contract (consumers gate on the composite key
 * `${identityKey}\0${nodeId}`, not on array position).
 */
export function flattenActiveDiagnosticsForFire(
  activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>,
): readonly DiagnosticFireTuple[] {
  const tuples: DiagnosticFireTuple[] = [];
  for (const [identityKey, payload] of activeDiagnostics) {
    const { nodes } = affectedEntities(payload);
    for (const nodeId of nodes) {
      tuples.push({ identityKey, nodeId, severity: payload.severity });
    }
  }
  return tuples;
}

/**
 * One per (active diagnostic, affected edge). The audience's edge-fire
 * overlay maps these into per-edge halo `<span>`s placed at the
 * rendered edge midpoint. Only two diagnostic kinds emit a non-empty
 * `edges` projection — `contradiction` (the two contradicting edges)
 * and the `self-contradicts` sub-kind of `coherency-hint` (the
 * warrant-bridge edge). All other kinds project an empty `edges` array
 * and contribute zero tuples.
 */
export interface DiagnosticEdgeFireTuple {
  readonly identityKey: string;
  readonly edgeId: string;
  readonly severity: DiagnosticHighlightSeverity;
}

/**
 * Walk the per-session `activeDiagnostics` map and emit one tuple per
 * (identity, affected-edge) pair. Severity is carried verbatim from the
 * payload. Output order mirrors `flattenActiveDiagnosticsForFire`'s
 * stability posture — deterministic for a given input map but
 * consumers gate on the composite key `${identityKey}\0${edgeId}`, not
 * on array position.
 */
export function flattenActiveDiagnosticsForEdgeFire(
  activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>,
): readonly DiagnosticEdgeFireTuple[] {
  const tuples: DiagnosticEdgeFireTuple[] = [];
  for (const [identityKey, payload] of activeDiagnostics) {
    const { edges } = affectedEntities(payload);
    for (const edgeId of edges) {
      tuples.push({ identityKey, edgeId, severity: payload.severity });
    }
  }
  return tuples;
}
