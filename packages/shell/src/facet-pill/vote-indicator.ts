// Co-located types + constants + re-export for the in-pill
// `<VoteIndicator>` row.
//
// Refinement: tasks/refinements/shell-package/extract_facet_pill.md
//   Decision §3 — `Vote` interface + `EMPTY_VOTES` constant lift here
//   alongside the indicator component itself. The moderator's
//   `selectors.ts` keeps its `projectVotesByFacet` projector and re-imports
//   `Vote` + `EMPTY_VOTES` from `@a-conversa/shell` going forward.
//
// Ported verbatim from `apps/moderator/src/graph/selectors.ts` lines
// 697-700 (the `Vote` interface) and line 717 (the `EMPTY_VOTES`
// frozen-array constant).

export { VoteIndicator, type VoteIndicatorProps } from './VoteIndicator.js';

/**
 * One participant's vote on a facet's pending proposal, projected for
 * rendering. Mirrors the `vote` event payload, narrowed to the two
 * fields the indicator surface consumes.
 *
 * `choice` uses `'choice'` (not `'vote'`) as the field name so the seam
 * attribute `data-choice` on the indicator span reads naturally; the
 * wire payload's `vote` field name is preserved in the read of
 * `event.payload.vote` and renamed at the projection boundary.
 */
export interface Vote {
  readonly participantId: string;
  readonly choice: 'agree' | 'dispute' | 'withdraw';
}

/**
 * Module-scope shared empty per-facet votes array. Used as the
 * default fallback for facets with no votes; keeps the reference
 * stable across renders so React / ReactFlow memoization doesn't see a
 * fresh array on every projection pass.
 */
export const EMPTY_VOTES: readonly Vote[] = Object.freeze([]);
