// Audience-side identity-key + affected-entity port of the participant's
// `apps/participant/src/graph/diagnosticHighlights.ts`. The audience
// surface does NOT paint per-entity steady-state diagnostic highlights
// (per `aud_diagnostic_fire_animation.md` Decision §8 — the fire
// animation IS the audience's entire diagnostic surface). So this file
// ports the minimum subset the fire-animation overlay needs: the wire
// types, the canonical identity-key formula, the per-kind affected-
// entities projection, and a focused `flattenActiveDiagnosticsForFire`
// helper that produces the (identityKey, nodeId, severity) tuples the
// overlay consumes.
//
// Refinement: tasks/refinements/audience/aud_diagnostic_fire_animation.md
//   (Decision §3 — third-caller port, NOT a shell lift. The shell
//   extraction is registered as the named-future-task
//   `shell_diagnostic_highlights_extract`. This file's identity-key
//   formula is byte-identical to the participant's so the future shell
//   lift is a near-mechanical refactor. Decision §7 — node tuples only;
//   edge halos deferred to `aud_diagnostic_edge_fire_animation`. Decision
//   §8 — no full `projectDiagnosticHighlights`; the audience never
//   stamps per-entity steady-state highlights into `cy.data()`.)
//
// **Parallel client mirror**: this module is a port (subset) of the
// participant's `apps/participant/src/graph/diagnosticHighlights.ts`,
// which is itself a verbatim port of the moderator's. All three callers
// MUST stay in lockstep on the identity-key formula or the `fired` /
// `cleared` matching at the WS store layer breaks (a `cleared` whose
// key doesn't match the previously-fired key would leak an "active"
// entry forever). The companion `diagnosticHighlights.test.ts` hand-
// builds payloads and round-trips the formula; the same payloads are
// reused across all three surface tests, so a server-side identity-key
// drift fails all three suites at once.
//
// ADRs: 0022 (no throwaway verifications — the helpers are committed
//             with their Vitest pins);
//       0026 (micro-frontend root app — the port ships inside the
//             audience artifact, NOT the shell; the shell lift is a
//             named-future-task).

import type {
  DiagnosticPayload,
  WsDiagnosticKind,
  WsDiagnosticSeverity,
} from '@a-conversa/shared-types';

// ---------------------------------------------------------------
// Re-exported wire types as audience-side aliases.
// ---------------------------------------------------------------

/**
 * Severity of a diagnostic, as classified by the server-side
 * `classifyDiagnostic` and stamped on the wire envelope. Alias of
 * `WsDiagnosticSeverity` so audience-side names stay stable while the
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
// Byte-identical to the participant's mirror; inlined to keep the
// audience workspace independent of the participant and server
// workspaces. Any change to a server-side payload shape MUST be
// mirrored here.

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

export type WireCoherencyHint =
  | WireIncompleteWarrantMissingBridgesToHint
  | WireIncompleteWarrantMissingBridgesFromHint
  | WireSelfContradictsHint;

/** Mirrors server `CoherencyHintDiagnosticEntry`. */
export interface WireCoherencyHintDiagnostic {
  kind: 'coherency-hint';
  hint: WireCoherencyHint;
}

/**
 * The shape of the inlined `payload.diagnostic` field across the five
 * surfaced diagnostic kinds. The wire envelope types `diagnostic` as
 * `unknown`; this union is the audience-side narrowing.
 */
export type WireDiagnostic =
  | WireCycleDiagnostic
  | WireContradictionDiagnostic
  | WireMultiWarrantDiagnostic
  | WireDanglingClaimDiagnostic
  | WireCoherencyHintDiagnostic;

// ---------------------------------------------------------------
// Identity-key formula (mirror of server's `identityKeyFor`).
// ---------------------------------------------------------------
//
// Strings, joined with `\0`. UUID v4 strings never contain `\0` and the
// kind discriminators are ASCII, so the joined key is unambiguous.
// Every key carries the kind prefix so cross-kind collisions are
// impossible. BYTE-IDENTICAL to the participant's formula — see header.

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
 * for a given payload but DO NOT deduplicate.
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
// Audience-specific: flatten activeDiagnostics → (identityKey, nodeId,
// severity) tuples for the fire-animation overlay.
// ---------------------------------------------------------------

/**
 * One per (active diagnostic, affected node). The overlay maps these
 * into per-node halo `<span>`s. Edges are not surfaced today (Decision
 * §7 — `aud_diagnostic_edge_fire_animation` is the named-future-task
 * for the edge halves).
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
