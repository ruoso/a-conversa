// `<DisputationTestChip>` — small inline chip surfacing the methodology's
// disputation-test outcome (`data | claim | unsettled`) for one node.
//
// Refinement: tasks/refinements/moderator-ui/mod_disputation_test_display.md
// (prior:     tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md,
//             tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md)
// ADRs:       docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//             docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//             docs/adr/0027-entity-and-facet-layers-are-strictly-separate.md
//
// The chip is the methodology-vocabulary overlay on top of the existing
// substance facet pill: where the pill carries the WIRE vocabulary
// (`agreed | disputed | ...`), the chip carries the methodology's
// narrative vocabulary (`Data | Claim | Unsettled`). The two layers
// compose — neither overwrites the other; both surface simultaneously
// so the moderator does not have to mentally translate the wire vocab
// into methodology terms in real-time debate.
//
// Mounted by `<StatementNode>` inside the per-facet pill row,
// immediately after the substance pill. Conditional on
// `disputationOutcome(data.facetStatuses.substance) !== null` — the
// chip is omitted (no DOM presence) when no substance facet activity
// has touched the node. Mirrors the per-facet pill / annotation /
// axiom-mark "no empty container" pattern.

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { DisputationOutcome } from './disputationOutcome.js';

export interface DisputationTestChipProps {
  /**
   * The methodology outcome to render. The chip does NOT take `undefined`
   * — the call site (`<StatementNode>` / `<HoverPopover>`) gates the
   * mount on `disputationOutcome(...) !== null`. Mirrors the
   * `<FacetPill>` convention of "render only present statuses."
   */
  readonly outcome: DisputationOutcome;
}

/**
 * Per-outcome Tailwind classes for the chip. Three branches mirror the
 * `<FacetPill>` structural baseline (rounded chip, small text, border)
 * with a methodology-distinct color palette (refinement Decision §4):
 *
 *   - sky (data)      — calm "settled" blue; distinct from amber
 *                       (diagnostic) and emerald (success).
 *   - rose (claim)    — palette continuity with the disputed substance
 *                       pill (the chip's claim outcome IS the
 *                       methodology reading of the disputed status).
 *   - slate (unsettled) — palette continuity with the proposed pill;
 *                         dashed border reinforces the "in flight" cue.
 *
 * Each backgrounds at the `-50` shade with a darker text color and
 * matching border, sitting visually atop the pill row without
 * competing with it.
 */
const CHIP_OUTCOME_CLASSNAME: Readonly<Record<DisputationOutcome, string>> = {
  data: 'inline-flex items-center rounded-full border border-solid border-sky-600 bg-sky-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-800',
  claim:
    'inline-flex items-center rounded-full border border-solid border-rose-600 bg-rose-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-800',
  unsettled:
    'inline-flex items-center rounded-full border border-dashed border-slate-400 bg-slate-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600',
};

function DisputationTestChipImpl(props: DisputationTestChipProps): ReactElement {
  const { outcome } = props;
  const { t } = useTranslation();

  // Resolve the localized outcome label first so the ICU `chipAriaLabel`
  // template receives the localized string as the `{outcome}` substitute
  // (the aria label reads naturally in each locale rather than carrying
  // the wire identifier).
  const outcomeLabel = t(`moderator.diagnostic.disputationTest.outcome.${outcome}`);
  const ariaLabel = t('moderator.diagnostic.disputationTest.chipAriaLabel', {
    outcome: outcomeLabel,
  });

  return (
    <span
      data-disputation-chip=""
      data-disputation-outcome={outcome}
      aria-label={ariaLabel}
      className={CHIP_OUTCOME_CLASSNAME[outcome]}
    >
      {outcomeLabel}
    </span>
  );
}

/**
 * Memo'd chip — same rationale as `<FacetPill>` / `<AnnotationBadge>`:
 * the surrounding canvas re-renders on every ReactFlow viewport pan/zoom,
 * but the chip only changes when `outcome` or locale changes.
 */
export const DisputationTestChip = memo(DisputationTestChipImpl);
