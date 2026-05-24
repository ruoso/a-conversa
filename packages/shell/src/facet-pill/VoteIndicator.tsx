// `<VoteIndicator>` — small per-participant vote dot rendered inside a
// facet pill.
//
// Refinement: tasks/refinements/shell-package/extract_facet_pill.md
//             (lifted from apps/moderator/src/graph/VoteIndicator.tsx;
//              prior moderator-side: tasks/refinements/moderator-ui/mod_vote_indicators_on_graph.md,
//              tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md,
//              tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md)
// ADRs:       docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//             docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//             docs/adr/0026-micro-frontend-root-app.md
//
// Per the methodology (`docs/methodology.md` § "Votes / Withdrawal"),
// every facet-targeting proposal accumulates per-participant votes:
// `agree` or `dispute`. (Per ADR 0030 §3 +
// `pf_facet_keyed_vote_payload`: withdrawal is its own first-class event
// kind, `withdraw-agreement`, tracked on a separate per-facet set —
// `pf_unit_test_audit` closed the `'withdraw'` vote choice arm.) The
// whole-pill border / opacity surfaces the facet's overall STATUS (a
// function of the votes through the eight derivation rules in
// `facetStatus.ts`); this indicator surfaces WHO voted WHAT — the
// ambient "Alice agreed, Bob disputed" view on the canvas.
//
// **Dual color encoding** (the same design language `mod_axiom_mark_
// decoration` established):
//   - Outer ring → deterministic per-participant color via
//     `axiomMarkColorFor(participantId)` (the six-bucket palette). Same
//     participant = same ring color across every node and surface.
//   - Inner fill → choice-keyed: emerald for agree, rose for dispute.
//
// Two readings: scan the inner fills to see the agreement pattern at a
// glance; look at a specific dot's outer ring to identify the
// participant.
//
// **Localized aria-label**: the indicator carries an `aria-label` like
// "Participant <uuid> voted agree" via the
// `methodology.voteIndicator.label` ICU template, with the choice
// substituted from `methodology.voteIndicator.choice.<arm>` (verb-form
// fragments). The participant id is the raw UUID today; when the
// participants projection lands, the substitution swaps to screen-name.

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { axiomMarkColorFor } from './participant-color.js';

export interface VoteIndicatorProps {
  readonly participantId: string;
  readonly choice: 'agree' | 'dispute';
}

/**
 * Per-choice inner-fill Tailwind class. Each entry is a complete class
 * string so Tailwind's JIT content scanner picks it up at build time
 * (interpolated runtime strings aren't extracted).
 *
 * Per ADR 0030 §3 + `pf_unit_test_audit`: the legacy `'withdraw'` arm
 * is retired (its own event kind, `withdraw-agreement`, surfaces via
 * the facet-status projection — not via a per-participant indicator).
 */
const CHOICE_FILL_CLASSNAME: Readonly<Record<VoteIndicatorProps['choice'], string>> = {
  agree: 'bg-emerald-500',
  dispute: 'bg-rose-500',
};

function VoteIndicatorImpl(props: VoteIndicatorProps): ReactElement {
  const { participantId, choice } = props;
  const { t } = useTranslation();

  // Per-participant deterministic color — same hash + palette as
  // `<AxiomMarkBadge>`. Same participant → same ring color across every
  // surface in the app.
  const participantColor = axiomMarkColorFor(participantId);
  const fillClass = CHOICE_FILL_CLASSNAME[choice];

  // Verb-form fragment for ICU substitution into the aria-label
  // template. The `methodology.voteIndicatorChoice.<arm>` key family is
  // separate from `methodology.voteChoice.<arm>` because the indicator
  // label reads as a sentence fragment ("voted agree") while the choice
  // noun reads as a title ("Agree" / "Dispute" / "Withdraw"). The flat
  // key shape (`voteIndicatorChoice` rather than nested
  // `voteIndicator.choice`) matches the existing `methodology.<group>.<id>`
  // convention so the round-trip test in
  // `packages/i18n-catalogs/src/methodology.test.ts` covers them
  // automatically via the `METHODOLOGY_VALUES` extension.
  const choiceLabel = t(`methodology.voteIndicatorChoice.${choice}`);
  const label = t('methodology.voteIndicator.label', {
    participantId,
    choice: choiceLabel,
  });

  return (
    <span
      data-vote-indicator=""
      data-participant-id={participantId}
      data-choice={choice}
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block h-2 w-2 rounded-full ring-1 ${participantColor.ring} ${fillClass}`}
    />
  );
}

/**
 * Memo'd indicator — same React-memoization rationale as the other
 * in-card decoration components (`AxiomMarkBadge`, `AnnotationBadge`,
 * `FacetPill`). The indicator only changes when `participantId` /
 * `choice` / locale change; the surrounding canvas re-renders on every
 * pan/zoom.
 */
export const VoteIndicator = memo(VoteIndicatorImpl);
