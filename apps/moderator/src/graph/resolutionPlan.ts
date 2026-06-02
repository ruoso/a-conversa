// Resolution-path router — maps a `(SuggestionMove, DiagnosticPayload)`
// pair to a concrete action descriptor the F7 resolution-path picker
// dispatches against.
//
// Refinement: tasks/refinements/moderator-ui/mod_resolution_path_picker.md
//             (Decision §D3 — pure, exhaustively-narrowed router;
//              Decision §D4 — direct dispatch vs inline target chooser;
//              Decision §D5 — per-move dispositions for v1)
//
// The methodology pins, per diagnostic kind, an ordered catalog of
// next-action moves (`diagnosticSuggestions.ts`). This module decides,
// for a clicked move, HOW the picker acts on it:
//
//   - `mode-entry`       — enter a capture mode (`decompose`,
//                          `warrant-elicitation`) on a target node.
//   - `proposal-submenu` — open a proposal submenu (`axiom-mark`,
//                          `edit-wording`) seeded with a target node.
//   - `break-edge-chooser` — present the cycle's candidate `supports`
//                          edges; picking one dispatches a real
//                          `propose { kind: 'break-edge', edge_id }`
//                          (`mod_break_edge_resolution_action`).
//   - `focus-only`       — frame the affected region but emit nothing
//                          (advisory moves with no committable proposal
//                          kind).
//
// Target derivation (Decision §D4): when a diagnostic implicates a single
// applicable node the plan dispatches directly; when it implicates several
// (a cycle's N nodes, a contradiction's two) the plan carries the candidate
// node ids for the picker's inline target chooser. Targets are always
// derived from the typed diagnostic — never an arbitrary "first node" guess
// (Constraint §4).
//
// Pure module: no React, no Zustand, no side effects. The `switch (move)`
// is exhaustively narrowed with an `assertNever` default so adding a member
// to `SuggestionMove` without routing it is a compile error (Constraint §6 /
// Acceptance §2). Mirrors the `diagnosticSuggestions.ts` /
// `disputationOutcome.ts` pure-module pattern.

import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { affectedEntities, type WireDiagnostic } from '@a-conversa/shell';

import type { SuggestionMove } from './diagnosticSuggestions.js';

/** The affected entity ids the picker frames on every chip click. */
export interface FocusTarget {
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
}

/**
 * Where an action dispatches. `direct` when a single applicable node is
 * implicated (dispatch immediately); `chooser` when several are (present
 * the inline target chooser over `candidateNodeIds` first).
 */
export type ResolutionTarget =
  | { readonly kind: 'direct'; readonly nodeId: string }
  | { readonly kind: 'chooser'; readonly candidateNodeIds: readonly string[] };

/**
 * The concrete action a clicked move resolves to. Every variant carries
 * the affected-region `focus` so the picker can frame the canvas on
 * dispatch regardless of disposition (Constraint §5).
 */
export type ResolutionPlan =
  | {
      readonly disposition: 'mode-entry';
      readonly mode: 'decompose' | 'warrant-elicitation';
      readonly target: ResolutionTarget;
      readonly focus: FocusTarget;
    }
  | {
      readonly disposition: 'proposal-submenu';
      readonly submenu: 'axiom-mark' | 'edit-wording';
      readonly target: ResolutionTarget;
      readonly focus: FocusTarget;
    }
  | {
      readonly disposition: 'break-edge-chooser';
      // The cycle's node ids carried forward so the panel can derive the
      // breakable `supports` edges against the live projection (the router
      // is pure over the payload and has no graph — Decision §D3). The
      // candidate-edge derivation itself lives in `candidateBreakEdges`.
      readonly cycleNodeIds: readonly string[];
      readonly focus: FocusTarget;
    }
  | {
      readonly disposition: 'focus-only';
      readonly focus: FocusTarget;
    };

/** Stable, order-preserving de-dup — mirrors `DiagnosticFlagPane`'s. */
function dedupe(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)];
}

/** The affected region (deduped) for the diagnostic, reused as `focus`. */
function focusFor(payload: DiagnosticPayload): FocusTarget {
  const affected = affectedEntities(payload);
  return { nodeIds: dedupe(affected.nodes), edgeIds: dedupe(affected.edges) };
}

/**
 * Collapse a candidate node list to a `ResolutionTarget`: a single
 * applicable node yields a `direct` plan; several yield a `chooser`
 * plan listing the (deduped) candidates (Decision §D4).
 */
function targetFromCandidates(candidates: readonly string[]): ResolutionTarget {
  const unique = dedupe(candidates);
  // A degenerate empty candidate set should never arise for the catalog
  // pairings, but stay total: fall through to a (empty) chooser rather
  // than minting a `direct` plan with no node.
  if (unique.length === 1) {
    return { kind: 'direct', nodeId: unique[0] as string };
  }
  return { kind: 'chooser', candidateNodeIds: unique };
}

// Per-move candidate node derivation. Each narrows the typed diagnostic
// for the kinds the methodology catalog pairs the move with, and falls
// back to the affected node set for the (unreachable) off-catalog kinds
// so the router stays total.

function decomposeCandidates(d: WireDiagnostic, focus: FocusTarget): readonly string[] {
  switch (d.kind) {
    case 'multi-warrant':
      // The compound claim is the decompose target (Decision §D4 —
      // multi-warrant dispatches directly on its claim node).
      return [d.claimNodeId];
    case 'cycle':
      return d.nodes;
    case 'contradiction':
      return [d.nodeA, d.nodeB];
    case 'dangling-claim':
    case 'coherency-hint':
      return focus.nodeIds;
  }
}

function nodePairCandidates(d: WireDiagnostic, focus: FocusTarget): readonly string[] {
  // Covers `axiom-mark` (cycle's N nodes) and `axiom-mark-both`
  // (contradiction's two nodes — "surfaces axiom-mark for both",
  // Acceptance §7).
  switch (d.kind) {
    case 'cycle':
      return d.nodes;
    case 'contradiction':
      return [d.nodeA, d.nodeB];
    case 'multi-warrant':
    case 'dangling-claim':
    case 'coherency-hint':
      return focus.nodeIds;
  }
}

function amendCandidates(d: WireDiagnostic, focus: FocusTarget): readonly string[] {
  switch (d.kind) {
    case 'contradiction':
      return [d.nodeA, d.nodeB];
    case 'cycle':
    case 'multi-warrant':
    case 'dangling-claim':
    case 'coherency-hint':
      return focus.nodeIds;
  }
}

function promptForSupportCandidates(d: WireDiagnostic, focus: FocusTarget): readonly string[] {
  switch (d.kind) {
    case 'dangling-claim':
      return [d.nodeId];
    case 'cycle':
    case 'contradiction':
    case 'multi-warrant':
    case 'coherency-hint':
      return focus.nodeIds;
  }
}

function breakEdgeCycleNodeIds(d: WireDiagnostic, focus: FocusTarget): readonly string[] {
  // `break-edge` is paired with `cycle` in the methodology catalog; the
  // cycle's node ids are the set the panel derives candidate `supports`
  // edges against. The off-catalog kinds fall back to the affected node
  // set so the router stays total.
  switch (d.kind) {
    case 'cycle':
      return d.nodes;
    case 'contradiction':
    case 'multi-warrant':
    case 'dangling-claim':
    case 'coherency-hint':
      return focus.nodeIds;
  }
}

function assertNever(move: never): never {
  throw new Error(`resolutionPlanForMove: unrouted move ${String(move)}`);
}

/**
 * Map a clicked `(move, diagnostic)` pair to its action descriptor.
 * Pure — the picker's `onClick` is a thin dispatcher over the result.
 *
 * The `switch (move)` is exhaustive over `SuggestionMove`; the
 * `assertNever` default makes an unrouted move a compile/test break
 * rather than a silent dead chip (Decision §D3 / Acceptance §2).
 */
export function resolutionPlanForMove(
  move: SuggestionMove,
  payload: DiagnosticPayload,
): ResolutionPlan {
  const focus = focusFor(payload);
  const d = payload.diagnostic as WireDiagnostic;

  switch (move) {
    case 'decompose':
      return {
        disposition: 'mode-entry',
        mode: 'decompose',
        target: targetFromCandidates(decomposeCandidates(d, focus)),
        focus,
      };
    case 'prompt-for-support':
      return {
        disposition: 'mode-entry',
        mode: 'warrant-elicitation',
        target: targetFromCandidates(promptForSupportCandidates(d, focus)),
        focus,
      };
    case 'axiom-mark':
    case 'axiom-mark-both':
      return {
        disposition: 'proposal-submenu',
        submenu: 'axiom-mark',
        target: targetFromCandidates(nodePairCandidates(d, focus)),
        focus,
      };
    case 'amend':
      return {
        disposition: 'proposal-submenu',
        submenu: 'edit-wording',
        target: targetFromCandidates(amendCandidates(d, focus)),
        focus,
      };
    case 'break-edge':
      // The panel derives the cycle's candidate `supports` edges from the
      // live projection (`candidateBreakEdges`) and dispatches a real
      // `propose { kind: 'break-edge', edge_id }`
      // (`mod_break_edge_resolution_action`, Decision §D3).
      return {
        disposition: 'break-edge-chooser',
        cycleNodeIds: dedupe(breakEdgeCycleNodeIds(d, focus)),
        focus,
      };
    // The advisory moves carry no committable proposal kind — focus the
    // affected region only.
    case 'mark-conceded':
    case 'review-configuration':
    case 'repair-configuration':
    case 'leave-as-intentional':
      return { disposition: 'focus-only', focus };
    default:
      return assertNever(move);
  }
}
