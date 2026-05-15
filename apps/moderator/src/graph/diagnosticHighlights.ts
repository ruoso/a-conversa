// Per-entity diagnostic-highlight projection for the moderator's graph.
//
// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md
//
// Client-side mirror of `apps/server/src/diagnostics/event-emission.ts`'s
// `identityKeyFor` + per-kind payload shapes. The server does not expose a
// client-callable helper, and the moderator workspace is not allowed to
// import from `apps/server/*` (workspace-boundary discipline). The shapes
// declared inline below mirror the server's `CycleDiagnosticEntry` /
// `ContradictionDiagnosticEntry` / `MultiWarrantDiagnosticEntry` /
// `DanglingClaimDiagnosticEntry` / `CoherencyHintDiagnosticEntry` and the
// three `CoherencyHint` sub-kind interfaces in
// `apps/server/src/diagnostics/coherency-hint-detection.ts` verbatim.
//
// **Drift risk.** Any change to a per-kind payload shape on the server
// MUST be mirrored here, AND the identity-key formula MUST stay in
// lockstep. A drift between this file's `diagnosticIdentityKey` and the
// server's `identityKeyFor` would break the `fired` / `cleared` matching
// — a `cleared` whose key doesn't match the previously-fired `fired`
// would leak an "active" entry in the store forever. The companion
// vitest case in `diagnosticHighlights.test.ts` hand-builds wire
// payloads from known server-side identities and asserts the
// round-trip; if a server-side identity-key change lands without this
// file updating, that test fails. Same mirror-comment pattern as
// `facetStatus.ts`.

import type {
  DiagnosticPayload,
  WsDiagnosticKind,
  WsDiagnosticSeverity,
} from '@a-conversa/shared-types';

// ---------------------------------------------------------------
// Re-exported wire types as moderator-side aliases.
// ---------------------------------------------------------------

/**
 * Severity of a diagnostic, as classified by the server-side
 * `classifyDiagnostic` and stamped on the wire envelope. Alias of
 * `WsDiagnosticSeverity` so moderator-side names stay stable while the
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
// Inlined here (rather than imported) to keep the moderator workspace
// independent of the server workspace. Any change to a server-side
// payload shape MUST be mirrored here; the round-trip test pins the
// invariant.

/** Mirrors server `CycleDiagnosticEntry`. */
interface WireCycleDiagnostic {
  kind: 'cycle';
  nodes: readonly string[];
}

/** Mirrors server `ContradictionDiagnosticEntry`. */
interface WireContradictionDiagnostic {
  kind: 'contradiction';
  nodeA: string;
  nodeB: string;
  edges: readonly string[];
}

/** Mirrors server `MultiWarrantDiagnosticEntry`. */
interface WireMultiWarrantDiagnostic {
  kind: 'multi-warrant';
  dataNodeId: string;
  claimNodeId: string;
  warrantNodeIds: readonly string[];
}

/** Mirrors server `DanglingClaimDiagnosticEntry`. */
interface WireDanglingClaimDiagnostic {
  kind: 'dangling-claim';
  nodeId: string;
}

/** Mirrors `IncompleteWarrantMissingBridgesToHint`. */
interface WireIncompleteWarrantMissingBridgesToHint {
  kind: 'incomplete-warrant-missing-bridges-to';
  warrantNodeId: string;
  dataNodeId: string;
}

/** Mirrors `IncompleteWarrantMissingBridgesFromHint`. */
interface WireIncompleteWarrantMissingBridgesFromHint {
  kind: 'incomplete-warrant-missing-bridges-from';
  warrantNodeId: string;
  claimNodeId: string;
}

/** Mirrors `SelfContradictsHint`. */
interface WireSelfContradictsHint {
  kind: 'self-contradicts';
  edgeId: string;
  nodeId: string;
}

type WireCoherencyHint =
  | WireIncompleteWarrantMissingBridgesToHint
  | WireIncompleteWarrantMissingBridgesFromHint
  | WireSelfContradictsHint;

/** Mirrors server `CoherencyHintDiagnosticEntry`. */
interface WireCoherencyHintDiagnostic {
  kind: 'coherency-hint';
  hint: WireCoherencyHint;
}

/**
 * The shape of the inlined `payload.diagnostic` field across the five
 * surfaced diagnostic kinds. The wire envelope types `diagnostic` as
 * `unknown` (the same trade-off `snapshot-state.projection` makes); this
 * union is the moderator-side narrowing the projection walks.
 */
type WireDiagnostic =
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
 * Consumers (`projectNodes`, `selectEdgesForSession`) look up by entity
 * id; absent ids mean "no active diagnostic touches this entity".
 */
export interface DiagnosticHighlightIndex {
  readonly nodes: ReadonlyMap<string, DiagnosticHighlight>;
  readonly edges: ReadonlyMap<string, DiagnosticHighlight>;
}

/**
 * Stable empty-index reference. Hands consumers a deterministic empty
 * value when the session has no active diagnostics — keeps the React /
 * ReactFlow memoization stable for the no-diagnostic baseline. Same
 * `EMPTY_*` pattern as `EMPTY_FACET_STATUSES`, `EMPTY_ANNOTATIONS`,
 * `EMPTY_VOTES_BY_FACET`.
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

  // Accumulator: per-entity per-kind, plus a per-entity rolling
  // severity. We build the kinds list as we walk so encounter order is
  // preserved; the per-kind dedupe uses a Set we never expose.
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
      // Blocking wins; demoting advisory→blocking is one-way.
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

  // Freeze each accumulator into a public `DiagnosticHighlight` (drop
  // the internal `seen` Set so the public shape matches the
  // interface). The `kinds` array is a fresh `readonly` projection.
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
