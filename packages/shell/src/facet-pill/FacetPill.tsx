// `<FacetPill>` — small bordered chip rendering ONE facet's status on a
// statement node card.
//
// Refinement: tasks/refinements/shell-package/extract_facet_pill.md
//             (lifted from apps/moderator/src/graph/FacetPill.tsx;
//              prior moderator-side: tasks/refinements/moderator-ui/mod_vote_indicators_on_graph.md,
//              tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md,
//              tasks/refinements/moderator-ui/mod_disputed_state_styling.md,
//              tasks/refinements/moderator-ui/mod_agreed_state_styling.md,
//              tasks/refinements/moderator-ui/mod_proposed_state_styling.md)
// ADRs:       docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//             docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//             docs/adr/0026-micro-frontend-root-app.md
//
// Per the methodology (`docs/methodology.md` § "Facets"), every node has
// three facets — `wording`, `classification`, `substance` — each with its
// own independent agreement lifecycle. The card-rollup picks ONE status
// to paint the whole card frame (the "scan the canvas" signal); the
// `<FacetPill>` row inside the card is the per-facet detail layer, so
// the moderator can see at a glance which facets are committed vs
// disputed vs proposed once their eye is on a specific card.
//
// The pill's per-status border / ring / opacity choices mirror the
// whole-card frame rules from the three predecessor state-styling
// refinements, scoped to the smaller surface:
//
//   - `'proposed'`          → dashed slate border + faded opacity
//   - `'agreed'`            → solid dark-slate border + full opacity
//   - `'disputed'`          → solid rose border + ring halo
//   - `'meta-disagreement'` → double violet border + ring halo
//   - `'committed'`         → solid slate border at slight opacity (closed; not faded)
//   - `'withdrawn'`         → dashed slate border at heavier opacity fade (closed; retracted)
//
// Unlike the whole-card frame (which falls back to baseline for closed
// statuses), the pill renders styling for every status — the pill IS the
// per-facet record, so a `committed` / `withdrawn` facet needs its own
// distinct visual.

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { FacetName, FacetStatus } from './types.js';
import { EMPTY_VOTES, type Vote } from './vote-indicator.js';
import { VoteIndicator } from './VoteIndicator.js';

export interface FacetPillProps {
  readonly facet: FacetName;
  readonly status: FacetStatus;
  /**
   * Per-participant votes on this facet's pending proposal. Empty when
   * the facet has no votes; the indicator row is omitted in that case
   * (mirrors the annotation / axiom-mark-row "no empty container" rule).
   * Refinement: `mod_vote_indicators_on_graph`.
   */
  readonly votes?: readonly Vote[];
}

/**
 * Per-status Tailwind classes for the pill. The base class string is the
 * pill's structural baseline (rounded chip, small text, inline-flex);
 * each status appends its border / ring / color / opacity branch.
 *
 * The mapping mirrors the whole-card frame rules from the three
 * predecessor refinements; if those refinements ever change a frame
 * branch, the per-pill mirror needs to follow.
 */
// Exported so the sidebar's `<ProposalFacetBreakdown>` chips
// (per `tasks/refinements/moderator-ui/mod_per_facet_breakdown.md`,
// Decision §11) can mirror the graph pill's per-status vocabulary
// verbatim. Sharing the constant — vs duplicating the map — means a
// future state-styling refinement that retunes the graph pill
// automatically propagates to the sidebar in the same commit.
export const PILL_BASE_CLASSNAME =
  'inline-flex items-center rounded-full border bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wide whitespace-nowrap';

export const PILL_STATUS_CLASSNAME: Readonly<Record<FacetStatus, string>> = {
  proposed: 'border-dashed border-slate-400 text-slate-500 opacity-60',
  agreed: 'border-solid border-slate-700 text-slate-700 opacity-100',
  disputed: 'border-solid border-rose-600 text-rose-700 ring-1 ring-rose-500 opacity-100',
  'meta-disagreement':
    'border-double border-violet-600 text-violet-700 ring-1 ring-violet-400 opacity-100',
  committed: 'border-solid border-slate-400 text-slate-600 opacity-90',
  withdrawn: 'border-dashed border-slate-400 text-slate-500 opacity-50',
  // `'awaiting-proposal'` (per ADR 0030 §10) — pre-agreement empty
  // state: the entity exists but no candidate value has been set for
  // the facet yet. The pill renders with the same visual as
  // `'proposed'` (faded / dashed-slate); the per-facet propose
  // affordance is rendered by the moderator's node card and the
  // participant's detail-panel row (downstream UI tasks
  // `pf_mod_node_card_classification_affordance`,
  // `pf_mod_node_card_substance_affordance`,
  // `pf_part_detail_panel_three_facet_rows`), not by the pill itself.
  'awaiting-proposal': 'border-dashed border-slate-400 text-slate-500 opacity-60',
};

function FacetPillImpl(props: FacetPillProps): ReactElement {
  const { facet, status, votes = EMPTY_VOTES } = props;
  const { t } = useTranslation();

  const className = `${PILL_BASE_CLASSNAME} ${PILL_STATUS_CLASSNAME[status]}`;

  // The vote-indicator row sits inside the pill, to the right of the
  // facet-name label. Rendered ONLY when at least one vote exists —
  // otherwise the pill renders unchanged (mirrors the empty-container
  // omission rule used elsewhere on the card). Refinement:
  // `mod_vote_indicators_on_graph`. `gap-0.5` keeps the dot row tight
  // inside the pill's `px-1.5` padding; `ml-1` separates the dots from
  // the facet-name label.
  const voteIndicatorRow =
    votes.length > 0 ? (
      <span data-vote-indicator-row="" className="ml-1 inline-flex items-center gap-0.5">
        {votes.map((vote) => (
          <VoteIndicator
            key={vote.participantId}
            participantId={vote.participantId}
            choice={vote.choice}
          />
        ))}
      </span>
    ) : null;

  return (
    <span
      data-facet-pill=""
      data-facet-name={facet}
      data-facet-status={status}
      className={className}
    >
      {t(`methodology.facet.${facet}`)}
      {voteIndicatorRow}
    </span>
  );
}

/**
 * Memo'd pill — same React-memoization rationale as `AnnotationBadge` /
 * `AxiomMarkBadge`: the surrounding canvas re-renders on every viewport
 * pan/zoom, but the pill only changes when `facet` / `status` / locale
 * change.
 */
export const FacetPill = memo(FacetPillImpl);
