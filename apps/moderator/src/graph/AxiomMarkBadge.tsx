// `<AxiomMarkBadge>` — small per-participant badge that renders one
// committed axiom-mark on a statement node.
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md
// ADRs:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Each badge surfaces one (node, participant) axiom-mark pair from the
// projection. The methodology models axiom-marks as **per-participant**
// (`docs/methodology.md` §"Axioms / terminal values"): a node may carry
// multiple marks from different participants, each a separately-recorded
// bedrock disposition. This component renders ONE such mark — the
// surrounding `<StatementNode>` decoration row stacks the badges
// horizontally so the multi-participant case reads as a row.
//
// Per-participant color: `axiomMarkColorFor(participantId)` deterministically
// hashes the UUID into one of six palette buckets. Same participant →
// same color across every node they marked, across renders, across
// surfaces (moderator / participant / audience). See the refinement's
// "Decisions" for why hash-based color is preferred over a per-session
// assignment.
//
// Visual shape: rounded-square (`rounded-sm`), distinct from the
// rounded-pill `AnnotationBadge`. The shape difference is the primary
// seam between the two decoration families — axiom-marks are
// methodology-disposition (load-bearing); annotations are commentary.
//
// Glyph: a centered "A" character (Latin-alphabet anchor that works for
// every supported locale — en-US / pt-BR / es-419 all use the same A).
// The full localized form lives in the `title` and `aria-label` for
// hover and screen-reader use, where space isn't a constraint.
//
// Per-participant attribution: today the tooltip / `aria-label` carries
// the raw participant UUID. When the participants projection lands, the
// tooltip body swaps to the participant's screen-name; the testids and
// the `data-participant-id` seam don't change.

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { axiomMarkColorFor } from '@a-conversa/shell';

import type { AxiomMark } from './selectors.js';

export interface AxiomMarkBadgeProps {
  readonly mark: AxiomMark;
}

function AxiomMarkBadgeImpl(props: AxiomMarkBadgeProps): ReactElement {
  const { mark } = props;
  const { t } = useTranslation();
  const color = axiomMarkColorFor(mark.participantId);

  // The tooltip / aria-label carry the participant UUID via ICU
  // substitution. The screen-name swap is deferred to when the
  // participants projection lands.
  const tooltip = t('methodology.axiomMark.tooltip', { participantId: mark.participantId });
  const srLabel = t('methodology.axiomMark.srLabel', { participantId: mark.participantId });

  return (
    <span
      data-testid={`axiom-mark-badge-${mark.nodeId}-${mark.participantId}`}
      data-participant-id={mark.participantId}
      title={tooltip}
      aria-label={srLabel}
      role="img"
      className={`inline-flex h-5 w-5 items-center justify-center rounded-sm ${color.bg} ${color.text} ring-1 ${color.ring} text-[11px] font-semibold leading-none`}
    >
      A
    </span>
  );
}

/**
 * Memo'd badge — same React-memoization rationale as `AnnotationBadge`.
 * The badge re-renders only when `participantId` / `nodeId` / locale
 * change; the surrounding canvas re-renders on every pan/zoom.
 */
export const AxiomMarkBadge = memo(AxiomMarkBadgeImpl);
