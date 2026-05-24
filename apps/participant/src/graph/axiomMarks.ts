// Per-participant axiom-mark derivation for the participant's read-mostly
// `<GraphView>`.
//
// Refinement: tasks/refinements/participant-ui/part_axiom_mark_decoration.md
//              (Decision §1 — boolean `isAxiom` overlay at the at-a-glance
//              card layer; per-participant chromatic identity stays a
//              moderator-only seam until the entity detail panel lands.
//              Decision §2 — verbatim port of `projectAxiomMarks` +
//              `groupAxiomMarksByNode` from the moderator workspace; no
//              shell extraction yet — two callers is YAGNI, lift when the
//              audience surface materialises as the third caller.)
//
// **Parallel client mirror**: this module is a verbatim port of the
// moderator's `apps/moderator/src/graph/selectors.ts:270-359`. Both
// client ports must stay in lock-step if a future axiom-mark wire-event
// shape change lands; the natural unification point is
// `@a-conversa/shell` (lifted when the audience surface becomes the
// third caller).
//
// **Methodology semantics**: `docs/methodology.md` §"Axioms / terminal
// values" — an axiom-mark is the per-participant "this node is bedrock
// for this participant" disposition; the "ratified bedrock" semantic
// anchors the "render committed only" rule (an uncommitted axiom-mark
// proposal contributes nothing here — pending visualization is owned by
// the future participant-side pending-proposals pane, mirroring the
// moderator's `mod_axiom_mark_pending_render`).
//
// **NOT ported**: the moderator's per-participant chromatic palette
// (`AXIOM_MARK_PALETTE`, `axiomMarkColorFor`, `AxiomMarkColor`) is
// explicitly NOT mirrored here. The participant's Cytoscape canvas
// paints a boolean "is-axiom" border (Decision §1 + §3), not a
// per-participant badge. The per-participant chromatic identity is
// owned by the future `part_entity_detail_panel` React surface, which
// can import the moderator's `AxiomMarkBadge` directly when it lands.
// Leaving the palette out keeps the participant workspace's surface
// area minimal and the per-participant attribution work concentrated
// in one place.

import type { Event } from '@a-conversa/shared-types';

/**
 * Camel-cased projection of one committed axiom-mark on a node.
 *
 * Per-participant means a single node can carry N `AxiomMark` records —
 * one per participant who marked it. The participant's at-a-glance card
 * layer collapses this list to a single boolean via `nodeHasAxiomMark`;
 * the per-participant breakdown is the entity-detail-panel consumer's
 * concern (Decision §1).
 *
 * `committedAt` carries the commit envelope's `committed_at` so future
 * sorting / tooltip-detail tasks (the entity detail panel) don't have
 * to re-walk the log.
 */
export interface AxiomMark {
  readonly nodeId: string;
  readonly participantId: string;
  readonly committedAt: string;
}

/**
 * Module-scope shared empty axiom-mark array. Hands a stable reference
 * to consumers so React / memoization doesn't see a fresh array on
 * every projection pass. Same rationale as the moderator's
 * `EMPTY_AXIOM_MARKS` (and the predecessor leaf's
 * `EMPTY_FACET_STATUSES`).
 */
export const EMPTY_AXIOM_MARKS: readonly AxiomMark[] = Object.freeze([]);

/**
 * Pure projection from a session's event log to the `AxiomMark[]` shape.
 *
 * Walks `events` once. For each `proposal` event whose inner proposal
 * is `axiom-mark`, records the (nodeId, participantId) pair against the
 * proposal envelope id. For each `commit` event whose `proposal_id`
 * matches a recorded axiom-mark proposal, emits one `AxiomMark` with
 * the commit's `committed_at`. Uncommitted axiom-mark proposals
 * produce **no** output — the rendering layer treats the boolean as
 * the methodology-disposition "ratified" state, not the in-flight
 * vote (the pending visualization is owned by a future
 * participant-side pending-proposals pane).
 *
 * Emission order is commit-event arrival order.
 */
export function projectAxiomMarks(events: readonly Event[]): AxiomMark[] {
  // Map from proposal envelope id → (nodeId, participantId) for axiom-
  // mark proposals seen in the walk. A commit whose proposal_id
  // references an unseen / non-axiom-mark proposal contributes
  // nothing.
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
 * moderator's `groupAxiomMarksByNode`. The participant's at-a-glance
 * layer collapses each bucket to a boolean via `nodeHasAxiomMark`; the
 * future entity-detail-panel consumer reads the per-participant list
 * directly (Decision §8).
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

/**
 * Boolean "does at least one committed axiom-mark target this node?"
 * helper consumed by the projector to stamp `isAxiom` on every emitted
 * node element.
 *
 * Decision §8 keeps the per-participant list reachable via
 * `groupAxiomMarksByNode` for the future entity-detail-panel consumer;
 * this helper is the small primitive the at-a-glance layer needs.
 */
export function nodeHasAxiomMark(
  grouped: ReadonlyMap<string, readonly AxiomMark[]>,
  nodeId: string,
): boolean {
  return (grouped.get(nodeId)?.length ?? 0) > 0;
}
