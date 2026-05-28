// Participant-local axiom-mark utilities.
//
// Refinement: tasks/refinements/shell-package/shell_axiom_marks_extraction.md
//   (After the cross-surface lift this module is a thin shim: the four
//   canonical names (`AxiomMark`, `EMPTY_AXIOM_MARKS`, `projectAxiomMarks`,
//   `groupAxiomMarksByNode`) re-export from `@a-conversa/shell`; the
//   participant-local `nodeHasAxiomMark` boolean-collapse helper stays
//   defined here per Decision §1 — single call site at
//   `projectGraph.ts:108`, collapse-to-boolean shape that neither the
//   moderator nor the audience consumes.)
//
// Prior:
//   - tasks/refinements/participant-ui/part_axiom_mark_decoration.md
//     (introduced the boolean-overlay `isAxiom` seam and the
//     `nodeHasAxiomMark` helper).
//
// Methodology semantics: `docs/methodology.md` §"Axioms / terminal
// values" — an axiom-mark is the per-participant "this node is bedrock
// for this participant" disposition. The participant's at-a-glance card
// layer collapses the per-participant list to a single boolean (the
// chromatic per-participant identity is the detail-panel's concern;
// see `apps/participant/src/detail/AxiomMarkBadge.tsx`).

export {
  EMPTY_AXIOM_MARKS,
  groupAxiomMarksByNode,
  projectAxiomMarks,
  type AxiomMark,
} from '@a-conversa/shell';

import type { AxiomMark } from '@a-conversa/shell';

/**
 * Boolean "does at least one committed axiom-mark target this node?"
 * helper consumed by the participant's `projectGraph` to stamp
 * `isAxiom` on every emitted node element.
 *
 * Stays participant-local because the boolean-collapse shape is
 * specific to the participant's at-a-glance overlay; the moderator and
 * audience render the full per-participant `AxiomMark[]` list.
 */
export function nodeHasAxiomMark(
  grouped: ReadonlyMap<string, readonly AxiomMark[]>,
  nodeId: string,
): boolean {
  return (grouped.get(nodeId)?.length ?? 0) > 0;
}
