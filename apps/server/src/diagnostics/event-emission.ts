// Diagnostic event emission — aggregate, diff, and dispatch diagnostic
// notifications to in-process subscribers.
//
// Refinement: tasks/refinements/data-and-methodology/diagnostic_event_emission.md
// TaskJuggler: data_and_methodology.diagnostics.diagnostic_event_emission
//
// The five detectors (cycle, contradiction, multi-warrant, dangling-
// claim, coherency-hint) are pure read functions over the projection;
// each returns its own per-entry shape. This module wraps them under
// a single `DiagnosticEntry` discriminated union, provides a stable
// identity-key-based diff, and ships an in-process `DiagnosticBus` for
// downstream consumers (the eventual WS broadcaster) to subscribe to.
//
// Architectural choice — in-process subscription side channel, NOT a
// `session_events.kind = 'diagnostic-fired'` row. Diagnostics are
// derived from the projection; persisting them to the event log would
// conflate "what happened" (authored events that the canonical log
// must round-trip) with "what the system inferred from what happened"
// (derived views that are recomputable on replay). See the refinement
// Decisions section for the full rationale.
//
// `pending-consequences` is DELIBERATELY EXCLUDED from the aggregator
// per its own refinement's stub-framing. Re-promoting it is a one-
// line append to the detector list and a new variant in the union.
//
// Boundary with downstream:
//   - The eventual WS broadcaster (`backend.ws_surface`) subscribes to
//     a `DiagnosticBus` instance and emits per-client WS messages on
//     `'fired'` / `'cleared'`.
//   - `blocking_vs_advisory_classification` (last diagnostics sibling)
//     classifies each `DiagnosticEntry` post-emission. The entry shape
//     does not carry severity today; the classifier attaches it
//     downstream without modifying this contract.
//   - The projection cache (`apps/server/src/projection/cache.ts`) is
//     where the WS-broadcaster wiring will eventually call
//     `bus.notify(prev, next)` after each `applyEvent`. This module
//     does NOT modify the cache — the bus is a stand-alone abstraction
//     so the wiring decision (cache vs. a separate `MethodologyService`)
//     stays with the broadcaster task.

import type { Projection } from '../projection/projection.js';
import { detectSupportsCycles, type SupportsCycle } from './cycle-detection.js';
import { detectContradictions, type Contradiction } from './contradiction-detection.js';
import { detectMultiWarrants, type MultiWarrant } from './multi-warrant-detection.js';
import { detectDanglingClaims, type DanglingClaim } from './dangling-claim-detection.js';
import {
  detectCoherencyHints,
  type CoherencyHint,
  type IncompleteWarrantMissingBridgesToHint,
  type IncompleteWarrantMissingBridgesFromHint,
  type SelfContradictsHint,
  type AnnotationOfAnnotationChainHint,
  type SelfReferentialAnnotationContradictsHint,
} from './coherency-hint-detection.js';

// ---------------------------------------------------------------
// DiagnosticEntry — unified discriminated union over the five
// surfaced diagnostic kinds.
// ---------------------------------------------------------------
//
// Inlined per-variant fields under a single `kind` discriminator,
// matching the existing house style (the `CoherencyHint` and
// `ProjectionChange` discriminated unions in this codebase do the
// same). Downstream consumers narrow on `kind` and access the per-
// variant payload directly — no `entry.payload.nodes` indirection.

/** Discriminator for the `DiagnosticEntry` union. */
export type DiagnosticKind =
  | 'cycle'
  | 'contradiction'
  | 'multi-warrant'
  | 'dangling-claim'
  | 'coherency-hint';

/**
 * One cycle diagnostic. Wraps `SupportsCycle` under the `'cycle'`
 * variant. The `nodes` array is in adjacency-walk order — for diff
 * purposes the identity key canonicalizes by sorting.
 */
export interface CycleDiagnosticEntry {
  kind: 'cycle';
  nodes: string[];
}

/**
 * One contradiction diagnostic. Wraps `Contradiction` under the
 * `'contradiction'` variant. `nodeA` and `nodeB` are in canonical
 * lexicographic order. `edges` records the contradicts-edge ids that
 * established the pair — informational; identity is the pair only.
 */
export interface ContradictionDiagnosticEntry {
  kind: 'contradiction';
  nodeA: string;
  nodeB: string;
  edges: string[];
}

/**
 * One multi-warrant diagnostic. Wraps `MultiWarrant` under the
 * `'multi-warrant'` variant. `warrantNodeIds` is sorted
 * lexicographically. Identity is the (D, C) pair plus the sorted
 * warrant set — adding or removing a warrant produces a different
 * diagnostic (cleared + fired in the diff).
 */
export interface MultiWarrantDiagnosticEntry {
  kind: 'multi-warrant';
  dataNodeId: string;
  claimNodeId: string;
  warrantNodeIds: string[];
}

/**
 * One dangling-claim diagnostic. Wraps `DanglingClaim` under the
 * `'dangling-claim'` variant. Identity is the node id.
 */
export interface DanglingClaimDiagnosticEntry {
  kind: 'dangling-claim';
  nodeId: string;
}

/**
 * One coherency-hint diagnostic. Wraps `CoherencyHint` under the
 * `'coherency-hint'` variant; the inner `hint` carries the
 * coherency-hint discriminated union so consumers narrow on
 * `entry.hint.kind` for the per-variant payload. We don't flatten
 * the hint's discriminator into the top level so the surrounding
 * `DiagnosticKind` and the inner `HintKind` stay distinct (the two
 * unions would otherwise share a namespace and bloat each kind's
 * literal type with the cross product).
 */
export interface CoherencyHintDiagnosticEntry {
  kind: 'coherency-hint';
  hint: CoherencyHint;
}

/**
 * Unified diagnostic-entry discriminated union. Downstream consumers
 * switch on `kind` and access the per-variant payload.
 */
export type DiagnosticEntry =
  | CycleDiagnosticEntry
  | ContradictionDiagnosticEntry
  | MultiWarrantDiagnosticEntry
  | DanglingClaimDiagnosticEntry
  | CoherencyHintDiagnosticEntry;

// ---------------------------------------------------------------
// computeAllDiagnostics — call all five detectors, wrap, concatenate.
// ---------------------------------------------------------------
//
// Pending-consequences is intentionally excluded. The aggregator
// order is fixed: cycle, contradiction, multi-warrant, dangling-claim,
// coherency-hint. This matches the order the five sibling refinements
// landed in. Downstream classifiers may re-rank (the blocking-vs-
// advisory sibling task), but the raw aggregator delivers a stable
// declarative order so tests are deterministic.

/**
 * Aggregate all v1-surfaced diagnostics over a projection.
 *
 * Pure read function. Calls the five detectors in a fixed order and
 * wraps each entry under the `DiagnosticEntry` envelope. Excludes
 * `pending-consequences` per its stub-framing.
 */
export function computeAllDiagnostics(projection: Projection): DiagnosticEntry[] {
  const out: DiagnosticEntry[] = [];
  for (const cycle of detectSupportsCycles(projection)) {
    out.push(wrapCycle(cycle));
  }
  for (const contradiction of detectContradictions(projection)) {
    out.push(wrapContradiction(contradiction));
  }
  for (const multiWarrant of detectMultiWarrants(projection)) {
    out.push(wrapMultiWarrant(multiWarrant));
  }
  for (const danglingClaim of detectDanglingClaims(projection)) {
    out.push(wrapDanglingClaim(danglingClaim));
  }
  for (const hint of detectCoherencyHints(projection)) {
    out.push(wrapCoherencyHint(hint));
  }
  return out;
}

function wrapCycle(cycle: SupportsCycle): CycleDiagnosticEntry {
  return { kind: 'cycle', nodes: cycle.nodes };
}

function wrapContradiction(c: Contradiction): ContradictionDiagnosticEntry {
  return { kind: 'contradiction', nodeA: c.nodeA, nodeB: c.nodeB, edges: c.edges };
}

function wrapMultiWarrant(mw: MultiWarrant): MultiWarrantDiagnosticEntry {
  return {
    kind: 'multi-warrant',
    dataNodeId: mw.dataNodeId,
    claimNodeId: mw.claimNodeId,
    warrantNodeIds: mw.warrantNodeIds,
  };
}

function wrapDanglingClaim(dc: DanglingClaim): DanglingClaimDiagnosticEntry {
  return { kind: 'dangling-claim', nodeId: dc.nodeId };
}

function wrapCoherencyHint(hint: CoherencyHint): CoherencyHintDiagnosticEntry {
  return { kind: 'coherency-hint', hint };
}

// ---------------------------------------------------------------
// Identity keys — the diff's equality predicate.
// ---------------------------------------------------------------
//
// Strings, joined with `\0`. UUID v4 strings never contain `\0` and
// the kind discriminator literals are ASCII, so the joined key is
// unambiguous. Every key includes the kind prefix so identity-key
// collisions across kinds are impossible.
//
// Per-kind canonicalization:
//   - cycle: sort the node ids lexicographically before joining.
//     The detector returns nodes in adjacency-walk order which may
//     start at different nodes for "the same" cycle across two calls
//     (e.g., after a re-projection); the sort makes identity stable.
//   - contradiction: `nodeA` and `nodeB` are already in canonical
//     lexicographic order per the detector. Identity is the pair —
//     the `edges` array is content, not identity.
//   - multi-warrant: `warrantNodeIds` is already sorted per the
//     detector. Identity is the (D, C) pair plus the warrant set.
//   - dangling-claim: the node id directly.
//   - coherency-hint: per-variant, with the variant's own kind
//     literal as a secondary discriminator so two different hint
//     kinds with overlapping ids can't collide.

/**
 * Compute the stable identity key for a diagnostic entry. Two
 * entries with the same key denote the same diagnostic. Downstream
 * consumers can use this to deduplicate or to maintain external
 * indices keyed by diagnostic identity.
 */
export function identityKeyFor(entry: DiagnosticEntry): string {
  switch (entry.kind) {
    case 'cycle': {
      const sorted = [...entry.nodes].sort();
      return `cycle\0${sorted.join('\0')}`;
    }
    case 'contradiction':
      return `contradiction\0${entry.nodeA}\0${entry.nodeB}`;
    case 'multi-warrant': {
      const warrants = [...entry.warrantNodeIds].sort();
      return `multi-warrant\0${entry.dataNodeId}\0${entry.claimNodeId}\0${warrants.join('\0')}`;
    }
    case 'dangling-claim':
      return `dangling-claim\0${entry.nodeId}`;
    case 'coherency-hint':
      return coherencyHintIdentityKey(entry.hint);
  }
}

function coherencyHintIdentityKey(hint: CoherencyHint): string {
  switch (hint.kind) {
    case 'incomplete-warrant-missing-bridges-to':
      return incompleteWarrantToKey(hint);
    case 'incomplete-warrant-missing-bridges-from':
      return incompleteWarrantFromKey(hint);
    case 'self-contradicts':
      return selfContradictsKey(hint);
    case 'annotation-of-annotation-chain':
      return annotationOfAnnotationChainKey(hint);
    case 'self-referential-annotation-contradicts':
      return selfReferentialAnnotationContradictsKey(hint);
  }
}

function incompleteWarrantToKey(hint: IncompleteWarrantMissingBridgesToHint): string {
  return `coherency-hint\0incomplete-warrant-missing-bridges-to\0${hint.warrantNodeId}\0${hint.dataNodeId}`;
}

function incompleteWarrantFromKey(hint: IncompleteWarrantMissingBridgesFromHint): string {
  return `coherency-hint\0incomplete-warrant-missing-bridges-from\0${hint.warrantNodeId}\0${hint.claimNodeId}`;
}

function selfContradictsKey(hint: SelfContradictsHint): string {
  return `coherency-hint\0self-contradicts\0${hint.edgeId}`;
}

function annotationOfAnnotationChainKey(hint: AnnotationOfAnnotationChainHint): string {
  // Identity is the second-or-later-hop edge id. The hint fires once
  // per qualifying edge; same edge across two snapshots is the same
  // diagnostic.
  return `coherency-hint\0annotation-of-annotation-chain\0${hint.edgeId}`;
}

function selfReferentialAnnotationContradictsKey(
  hint: SelfReferentialAnnotationContradictsHint,
): string {
  // Identity is the qualifying edge id, mirroring `self-contradicts`
  // and `annotation-of-annotation-chain` — one diagnostic per
  // qualifying edge.
  return `coherency-hint\0self-referential-annotation-contradicts\0${hint.edgeId}`;
}

// ---------------------------------------------------------------
// diffDiagnostics — compute fired and cleared across two snapshots.
// ---------------------------------------------------------------
//
// `fired` = entries in `next` whose identity key is NOT in `prev`.
// `cleared` = entries in `prev` whose identity key is NOT in `next`.
//
// Order-independent on inputs. Output order matches input list order:
// fired follows `next`'s order; cleared follows `prev`'s order. This
// keeps downstream dispatch deterministic for tests.

/**
 * Diff two diagnostic snapshots by stable identity key. Returns the
 * entries that fired (new in `next`) and the entries that cleared
 * (gone from `prev`).
 *
 * Pure function. Repeated calls with the same inputs return
 * structurally identical results.
 */
export function diffDiagnostics(
  prev: DiagnosticEntry[],
  next: DiagnosticEntry[],
): { fired: DiagnosticEntry[]; cleared: DiagnosticEntry[] } {
  const prevByKey = new Map<string, DiagnosticEntry>();
  for (const entry of prev) {
    prevByKey.set(identityKeyFor(entry), entry);
  }
  const nextByKey = new Map<string, DiagnosticEntry>();
  for (const entry of next) {
    nextByKey.set(identityKeyFor(entry), entry);
  }

  const fired: DiagnosticEntry[] = [];
  for (const entry of next) {
    const key = identityKeyFor(entry);
    if (!prevByKey.has(key)) {
      fired.push(entry);
    }
  }

  const cleared: DiagnosticEntry[] = [];
  for (const entry of prev) {
    const key = identityKeyFor(entry);
    if (!nextByKey.has(key)) {
      cleared.push(entry);
    }
  }

  return { fired, cleared };
}

// ---------------------------------------------------------------
// DiagnosticBus — in-process pub/sub for diagnostic notifications.
// ---------------------------------------------------------------
//
// Stateless w.r.t. previous diagnostic snapshots — the caller passes
// `prev` and `next` to `notify` explicitly. Stateless = trivially
// testable, no hidden cleanup obligations on session-end. The trade-
// off is that callers must thread the previous snapshot themselves;
// the broadcaster task can wrap the bus in a session-keyed
// abstraction if it wants caching.
//
// Synchronous dispatch, no error handling. A throwing listener
// throws back to the `notify` caller. The bus is a low-level
// primitive; ergonomic concerns (async dispatch, error containment,
// per-listener filtering) belong on the broadcaster's wrapper, not
// here.

/** Event name on the `DiagnosticBus`. */
export type DiagnosticBusEvent = 'fired' | 'cleared';

/** Listener signature on the `DiagnosticBus`. */
export type DiagnosticListener = (entry: DiagnosticEntry) => void;

/**
 * In-process pub/sub for diagnostic-fired / diagnostic-cleared
 * notifications.
 *
 * Usage:
 *   const bus = new DiagnosticBus();
 *   const off = bus.on('fired', (entry) => render(entry));
 *   bus.notify(prevDiagnostics, nextDiagnostics);
 *   off();
 *
 * The caller (eventually the projection-cache wiring or the
 * methodology engine) is responsible for computing `prev` and `next`
 * via `computeAllDiagnostics` and passing them to `notify`.
 */
export class DiagnosticBus {
  readonly #firedListeners: DiagnosticListener[] = [];
  readonly #clearedListeners: DiagnosticListener[] = [];

  /**
   * Register a listener for one of the bus's events. Returns an
   * unsubscribe function that, when called, removes the listener.
   * The same function may be registered more than once; each
   * registration produces a separate dispatch and a separate
   * unsubscribe handle.
   */
  on(event: DiagnosticBusEvent, listener: DiagnosticListener): () => void {
    const target = event === 'fired' ? this.#firedListeners : this.#clearedListeners;
    target.push(listener);
    return () => {
      // Remove the FIRST occurrence — multiple registrations of the
      // same function are independent. Mutating the array (vs.
      // reassigning) lets in-flight `notify` calls see the same
      // listener set their iteration started against; the JS array's
      // splice during iteration is well-defined.
      const idx = target.indexOf(listener);
      if (idx !== -1) {
        target.splice(idx, 1);
      }
    };
  }

  /**
   * Diff `prev` against `next` and dispatch the appropriate listeners
   * for each fired and cleared entry. Listeners are invoked in
   * registration order, synchronously. A throwing listener propagates
   * to the caller.
   */
  notify(prev: DiagnosticEntry[], next: DiagnosticEntry[]): void {
    const { fired, cleared } = diffDiagnostics(prev, next);
    // Snapshot the listener lists before dispatch so a listener that
    // unsubscribes itself doesn't disturb the iteration. The snapshot
    // is a shallow copy; new registrations from within a listener
    // fire on the NEXT notify, not the current one.
    const firedListeners = [...this.#firedListeners];
    const clearedListeners = [...this.#clearedListeners];
    for (const entry of fired) {
      for (const listener of firedListeners) {
        listener(entry);
      }
    }
    for (const entry of cleared) {
      for (const listener of clearedListeners) {
        listener(entry);
      }
    }
  }

  /** Number of registered listeners for the given event. */
  listenerCount(event: DiagnosticBusEvent): number {
    return event === 'fired' ? this.#firedListeners.length : this.#clearedListeners.length;
  }
}
