// `<FacetPill>` — small bordered chip rendering ONE facet's status on a
// statement node card.
//
// Refinement: tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md
// (prior:     tasks/refinements/moderator-ui/mod_disputed_state_styling.md,
//             tasks/refinements/moderator-ui/mod_agreed_state_styling.md,
//             tasks/refinements/moderator-ui/mod_proposed_state_styling.md)
// ADRs:       docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//             docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
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

import type { FacetName, FacetStatus } from './facetStatus.js';

export interface FacetPillProps {
  readonly facet: FacetName;
  readonly status: FacetStatus;
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
const PILL_BASE_CLASSNAME =
  'inline-flex items-center rounded-full border bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wide whitespace-nowrap';

const PILL_STATUS_CLASSNAME: Readonly<Record<FacetStatus, string>> = {
  proposed: 'border-dashed border-slate-400 text-slate-500 opacity-60',
  agreed: 'border-solid border-slate-700 text-slate-700 opacity-100',
  disputed: 'border-solid border-rose-600 text-rose-700 ring-1 ring-rose-500 opacity-100',
  'meta-disagreement':
    'border-double border-violet-600 text-violet-700 ring-1 ring-violet-400 opacity-100',
  committed: 'border-solid border-slate-400 text-slate-600 opacity-90',
  withdrawn: 'border-dashed border-slate-400 text-slate-500 opacity-50',
};

function FacetPillImpl(props: FacetPillProps): ReactElement {
  const { facet, status } = props;
  const { t } = useTranslation();

  const className = `${PILL_BASE_CLASSNAME} ${PILL_STATUS_CLASSNAME[status]}`;

  return (
    <span
      data-facet-pill=""
      data-facet-name={facet}
      data-facet-status={status}
      className={className}
    >
      {t(`methodology.facet.${facet}`)}
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
