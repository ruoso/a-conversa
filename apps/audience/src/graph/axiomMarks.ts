// Per-participant axiom-mark derivation for the audience broadcast surface.
//
// Refinement: tasks/refinements/audience/aud_axiom_mark_decoration.md
//              (Decision §1 — per-participant chromatic DOM-overlay
//              badges on the broadcast canvas: the audience inverts the
//              participant's boolean-collapse and keeps the full
//              `AxiomMark[]` list so each (node, participant) pair
//              renders as its own chromatic chip below the node card.
//              Decision §2 — `data.axiomMarks: readonly AxiomMark[]` is
//              stamped on every projected node, defaulting to the
//              module-scope frozen `EMPTY_AXIOM_MARKS` for stable
//              React-memoization identity. Decision §3 — verbatim port
//              of the participant's `apps/participant/src/graph/axiomMarks.ts`
//              minus `nodeHasAxiomMark` (the audience reads the full
//              list, not a boolean); shell extraction is deferred to
//              the named-future-task `shell_axiom_marks_extraction`
//              (the audience is the third caller, which is the
//              documented trigger).)
//
// **Parallel client mirrors**: this module is a verbatim port of the
// participant's `apps/participant/src/graph/axiomMarks.ts`, which is
// itself a port of the moderator's
// `apps/moderator/src/graph/selectors.ts:270-359` axiom-mark block.
// All three client ports must stay in lock-step if a future axiom-mark
// wire-event shape change lands. The natural unification point is
// `@a-conversa/shell` (the lift is registered as the named-future-task
// `shell_axiom_marks_extraction`, ~0.5d).
//
// **Methodology semantics**: `docs/methodology.md` §"Axioms / terminal
// values" — an axiom-mark is the per-participant "this node is bedrock
// for this participant" disposition; the "ratified bedrock" semantic
// anchors the "render committed only" rule (an uncommitted axiom-mark
// proposal contributes nothing here — pending visualization is owned
// by a future broadcast-polish task `aud_axiom_mark_pending_render` if
// the broadcast feedback identifies it as load-bearing).
//
// **NOT ported**: the participant's `nodeHasAxiomMark` boolean-collapse
// helper. The audience renders one chromatic badge per (node,
// participant) pair (Decision §1 of the refinement) and reads the
// `readonly AxiomMark[]` array directly; the boolean collapse is the
// participant tablet's at-a-glance-card seam, not the broadcast
// surface's chromatic-row seam.

import type { Event } from '@a-conversa/shared-types';

/**
 * Camel-cased projection of one committed axiom-mark on a node.
 *
 * Per-participant means a single node can carry N `AxiomMark` records —
 * one per participant who marked it. The audience renders each entry
 * as its own chromatic badge below the node card; the per-participant
 * identity is the methodology-load-bearing signal for broadcast
 * viewers (Decision §1 of the refinement).
 *
 * `committedAt` carries the commit envelope's `committed_at` so future
 * sorting / tooltip-detail tasks don't have to re-walk the log.
 */
export interface AxiomMark {
  readonly nodeId: string;
  readonly participantId: string;
  readonly committedAt: string;
}

/**
 * Module-scope shared empty axiom-mark array. Hands a stable reference
 * to consumers so React / memoization doesn't see a fresh array on
 * every projection pass. Same rationale as `EMPTY_FACET_STATUSES` and
 * the participant + moderator mirrors.
 */
export const EMPTY_AXIOM_MARKS: readonly AxiomMark[] = Object.freeze([]);

/**
 * Pure projection from a session's event log to the `AxiomMark[]` shape.
 *
 * Walks `events` once. For each `proposal` event whose inner proposal
 * is `axiom-mark`, records the (nodeId, participantId) pair against
 * the proposal envelope id. For each `commit` event whose
 * `proposal_id` matches a recorded axiom-mark proposal, emits one
 * `AxiomMark` with the commit's `committed_at`. Uncommitted axiom-mark
 * proposals produce **no** output — the rendering layer treats the
 * list as the methodology-disposition "ratified" state, not the
 * in-flight vote (a future `aud_axiom_mark_pending_render` may surface
 * pending marks if broadcast feedback identifies it as load-bearing).
 *
 * Emission order is commit-event arrival order.
 */
export function projectAxiomMarks(events: readonly Event[]): AxiomMark[] {
  const pending = new Map<string, { nodeId: string; participantId: string }>();
  const out: AxiomMark[] = [];
  for (const event of events) {
    if (event.kind === 'proposal') {
      const inner = event.payload.proposal;
      if (inner.kind === 'axiom-mark') {
        pending.set(event.id, { nodeId: inner.node_id, participantId: inner.participant });
      }
      continue;
    }
    if (event.kind === 'commit') {
      // Per ADR 0030 §2 + §9: commit payloads are a `target`-
      // discriminated union. Axiom-mark is a structural sub-kind per
      // ADR 0030 §9 — its commits ride the proposal-keyed arm; the
      // facet-keyed arm targets facet-valued sub-kinds (classify-node,
      // set-node-substance, set-edge-substance, edit-wording) which
      // never appear in the `pending` map this selector walks.
      if (event.payload.target !== 'proposal') continue;
      const proposal = pending.get(event.payload.proposal_id);
      if (proposal === undefined) continue;
      out.push({
        nodeId: proposal.nodeId,
        participantId: proposal.participantId,
        committedAt: event.payload.committed_at,
      });
      continue;
    }
  }
  return out;
}

/**
 * Bucket axiom-marks by their target node id. Returns a `Map` rather
 * than a plain object for the same UUID-key + `O(1)` rationale as the
 * moderator + participant mirrors. The audience overlay reads each
 * bucket and renders one chromatic badge per entry (Decision §1).
 */
export function groupAxiomMarksByNode(marks: readonly AxiomMark[]): Map<string, AxiomMark[]> {
  const out = new Map<string, AxiomMark[]>();
  for (const mark of marks) {
    const existing = out.get(mark.nodeId);
    if (existing) {
      existing.push(mark);
    } else {
      out.set(mark.nodeId, [mark]);
    }
  }
  return out;
}
