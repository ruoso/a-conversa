// Per-participant axiom-mark vocabulary for every UI surface.
//
// Refinement: tasks/refinements/shell-package/shell_axiom_marks_extraction.md
//   (Third-caller lift: this module is the consolidated home of the
//   `AxiomMark` interface + `EMPTY_AXIOM_MARKS` + `projectAxiomMarks` +
//   `groupAxiomMarksByNode` symbols that previously lived in three
//   verbatim copies — the moderator's `apps/moderator/src/graph/
//   selectors.ts:270-359` block, the participant's
//   `apps/participant/src/graph/axiomMarks.ts`, and the audience's
//   `apps/audience/src/graph/axiomMarks.ts`. The audience landed as the
//   third caller on 2026-05-28 (`aud_axiom_mark_decoration`), triggering
//   the cross-surface lift per the third-caller policy of
//   `extract_facet_pill.md` Decision §2.)
//
// Predecessor refinements:
//   - tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md
//     (canonical source — defined the `AxiomMark` interface shape +
//     `projectAxiomMarks` walk + `groupAxiomMarksByNode` bucketer).
//   - tasks/refinements/participant-ui/part_axiom_mark_decoration.md
//     (verbatim port + participant-local `nodeHasAxiomMark` helper that
//     stays in the participant workspace).
//   - tasks/refinements/audience/aud_axiom_mark_decoration.md
//     (verbatim port — the third caller that fired this extraction).
//
// Methodology semantics: `docs/methodology.md` §"Axioms / terminal
// values" — an axiom-mark is the per-participant "this node is bedrock
// for this participant" disposition. Per-participant means a single
// node can carry N `AxiomMark` records — one per participant who marked
// it. The rendering layer surfaces every record as a separate
// decoration (badge / chip / boolean) depending on the surface's needs.
//
// ADRs:
//   - 0021 (event envelope discriminated union — the projection walks
//     the `proposal` + `commit` arms);
//   - 0026 (micro-frontend root app — the shell package is the
//     architecturally-correct destination for cross-surface vocabulary);
//   - 0027 (entity / facet layers are strictly separate — axiom-marks
//     are an entity-layer disposition decoration, sibling to but
//     distinct from the facet-pill vocabulary);
//   - 0030 §9 (axiom-mark commits ride the proposal-keyed arm of the
//     commit-payload discriminated union).

import type { Event } from '@a-conversa/shared-types';

/**
 * Camel-cased projection of one committed axiom-mark on a node.
 *
 * Per-participant means a single node can carry N `AxiomMark` records —
 * one per participant who marked it. The rendering layer surfaces every
 * record as a separate decoration so consumers see both which nodes are
 * marked AND which participant marked each one.
 *
 * `committedAt` carries the commit envelope's `committed_at` so
 * downstream sorting / tooltip-detail consumers don't have to re-walk
 * the log.
 */
export interface AxiomMark {
  readonly nodeId: string;
  readonly participantId: string;
  readonly committedAt: string;
}

/**
 * Module-scope shared empty axiom-mark array. Hands a stable reference
 * to consumers (per-node `data.axiomMarks` defaults across surfaces)
 * so React / Cytoscape / ReactFlow memoization doesn't see a fresh
 * array on every projection pass.
 */
export const EMPTY_AXIOM_MARKS: readonly AxiomMark[] = Object.freeze([]);

/**
 * Pure projection from a session's event log to the `AxiomMark[]` shape.
 *
 * Walks `events` once. For each `proposal` event whose inner proposal is
 * `axiom-mark`, records the (nodeId, participantId) pair against the
 * proposal envelope id. For each `commit` event whose `proposal_id`
 * matches a recorded axiom-mark proposal, emits one `AxiomMark` with the
 * commit's `committed_at`. Uncommitted axiom-mark proposals produce
 * **no** output — the rendering layer treats the badge as the
 * methodology-disposition "ratified" state, not the in-flight vote
 * (the pending visualization is owned per-surface).
 *
 * Emission order is commit-event arrival order. The typical debate
 * scenario — A marks N9, then B marks N9 — emits A's mark first.
 */
export function projectAxiomMarks(events: readonly Event[]): AxiomMark[] {
  // Map from proposal envelope id → (nodeId, participantId) for axiom-
  // mark proposals seen in the walk. A commit whose proposal_id references
  // an unseen / non-axiom-mark proposal contributes nothing.
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
 * than a plain `Object` for the same UUID-key + `O(1)` rationale used
 * elsewhere in the projection layer.
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
