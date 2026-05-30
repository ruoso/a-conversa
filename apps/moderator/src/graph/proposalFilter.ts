// Pure predicate that decides whether a `PendingProposalRow` survives
// the moderator's right-sidebar filter strip.
//
// Refinement: tasks/refinements/moderator-ui/mod_proposal_filter_search.md
//
// `matchesProposalFilter(row, filter, currentParticipantIds,
// votesByFacetIndex, facetStatusIndex)` is a
// pure function — no closure over time, no `Date.now()`, no
// `Math.random()`. The two filter dimensions are AND-composed:
//
//   - **Free-text** (Decision §3): case-insensitive substring match
//     against `summaryText(row.proposal)` — the same string the row
//     renders in its summary column. Leading / trailing whitespace on
//     the query is trimmed; an empty (or whitespace-only) query
//     short-circuits to a pass.
//   - **State** (Decision §1.c): closed enum `'all' | 'ready' |
//     'disputed'`. `'all'` always passes. `'ready'` passes iff
//     `deriveAllAgree(entries, currentParticipantIds)` returns
//     `{ ok: true }` — the same predicate the per-row commit button
//     consults, so the chip and the button compute the same signal by
//     construction. `'disputed'` passes iff at least one of the row's
//     facet entries has `status === 'disputed'`.
//
// The empty default (`EMPTY_FILTER`) short-circuits to `true` so the
// predicate is the identity for callers that haven't installed a
// non-default filter.

import {
  deriveAllAgree,
  derivePerProposalFacets,
  type VotesByProposalIndex,
} from './proposalFacets.js';
import type { FacetStatusIndex, VotesByFacetIndex } from '@a-conversa/shell';
import type { PendingProposalRow } from './pendingProposals.js';
import { summaryText } from './proposalSummary.js';

/**
 * The closed taxonomy of state-filter arms (Decision §1.c). The empty
 * default is `'all'`; `'ready'` reuses the commit-gate predicate;
 * `'disputed'` matches rows with at least one disputed facet entry.
 */
export type ProposalFilterState = 'all' | 'ready' | 'disputed';

/**
 * The full filter shape — two dimensions, AND-composed. `text` is the
 * raw free-text query string (trimmed before matching, NOT
 * pre-normalized); `state` is the closed-enum chip arm.
 */
export interface ProposalFilter {
  readonly text: string;
  readonly state: ProposalFilterState;
}

/**
 * The default filter — empty text + `'all'` state. Identity-stable
 * reference so callers can compare `filter === EMPTY_FILTER` for the
 * fast-path short-circuit (Decision §8).
 */
export const EMPTY_FILTER: ProposalFilter = Object.freeze({ text: '', state: 'all' });

/**
 * Returns `true` iff the filter has no narrowing effect — empty (or
 * whitespace-only) text AND `'all'` state. The pane's post-derivation
 * `useMemo` consults this so the default case can return the
 * pre-filter `rows` reference directly (identity-stable fast path).
 */
export function isDefaultFilter(filter: ProposalFilter): boolean {
  return filter.text.trim() === '' && filter.state === 'all';
}

/**
 * The AND-composed filter predicate. Pure — no closure over time, no
 * `Date.now()`, no `Math.random()`.
 *
 * @param row One pending-proposal row from `derivePendingProposals(events)`.
 * @param filter The two filter dimensions.
 * @param currentParticipantIds The set of currently-joined NON-moderator
 *   participant ids (from `deriveCurrentParticipants(events)`) — the
 *   `'ready'` arm hands this to `deriveAllAgree` verbatim.
 * @param votesByFacetIndex The per-(entityId, facet) vote bucket from
 *   `projectVotesByFacet(events)` — needed by `derivePerProposalFacets`
 *   to compute the row's facet entries.
 * @param facetStatusIndex The merged facet-status index — the pane
 *   builds it from `merge(eventsBasedIndex,
 *   buildFacetStatusIndexFromBroadcast(pendingProposalFacetStatus))`
 *   with broadcast winning per cell (per
 *   `tasks/refinements/participant-ui/part_migrate_to_pending_proposal_facet_status.md`
 *   D2).
 * @returns `true` iff both filter dimensions admit the row.
 */
export function matchesProposalFilter(
  row: PendingProposalRow,
  filter: ProposalFilter,
  currentParticipantIds: ReadonlySet<string>,
  votesByFacetIndex: VotesByFacetIndex,
  facetStatusIndex: FacetStatusIndex,
  votesByProposalIndex?: VotesByProposalIndex,
): boolean {
  // Default-fast-path: the predicate is the identity for the default
  // filter (Decision §8). Cheap up-front check that avoids the
  // per-row `derivePerProposalFacets` call for the common case.
  if (isDefaultFilter(filter)) return true;

  // Dimension 1: free-text substring against the row's summary string.
  const query = filter.text.trim();
  if (query !== '') {
    const needle = query.toLowerCase();
    const haystack = summaryText(row.proposal).toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  // Dimension 2: state chip.
  if (filter.state === 'all') return true;

  // The remaining two arms need the row's facet entries. Compute them
  // ONCE per call; the pane-level memos pass the same indices that
  // every row's breakdown reads, so the cost is O(facets-per-row)
  // (typically 1) per filter evaluation.
  //
  // `votesByProposalIndex` + `row.proposalEventId` thread the
  // per-proposal vote bucket for structural sub-kinds so the "Ready"
  // chip and the per-row commit button compute the same signal
  // for structural proposals too — the gate predicate walks the
  // `votes` field on the synthetic `'proposal'` entry, populated by
  // the per-proposal projection (per commit `421353f`).
  const entries = derivePerProposalFacets(
    row.proposal,
    facetStatusIndex,
    votesByFacetIndex,
    row.proposalEventId,
    votesByProposalIndex,
  );

  if (filter.state === 'ready') {
    // Reuse the commit-gate predicate exactly so the "Ready" chip and
    // the per-row commit button compute the same signal by
    // construction. Pass the proposal payload so the axiom-mark
    // exclusion stays in lockstep across the two surfaces.
    return deriveAllAgree(entries, currentParticipantIds, row.proposal).ok;
  }

  // filter.state === 'disputed' — any facet entry whose status is
  // `'disputed'` qualifies the row.
  for (const entry of entries) {
    if (entry.status === 'disputed') return true;
  }
  return false;
}
