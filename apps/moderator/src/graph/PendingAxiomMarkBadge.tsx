// `<PendingAxiomMarkBadge>` — small per-participant badge that renders
// one IN-FLIGHT (proposed-but-not-yet-committed) axiom-mark on a
// statement node.
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_pending_render.md
// (prior:     tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md,
//             tasks/refinements/moderator-ui/mod_proposed_state_styling.md)
// ADRs:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Parallel to `<AxiomMarkBadge>` (the committed-side decoration) but
// composed with the proposed-state visual overlay: the same per-
// participant color (`axiomMarkColorFor`) + same rounded-square shape
// + same centered "A" glyph, layered with `border-dashed
// border-slate-400` + `opacity-60` to communicate "this is in flight."
// Per Decision §3 the participant-color background + per-participant
// ring stay underneath the dashed slate border so the moderator can
// still identify whose mark is pending — losing per-participant
// attribution at the moment when the moderator most needs to anticipate
// the vote flow was rejected as a visual choice.
//
// Per Decision §5 the component stamps three stable DOM seams that
// downstream tests target:
//   - `data-testid="pending-axiom-mark-badge-{nodeId}-{participantId}"`
//     — distinct from the committed `axiom-mark-badge-{nodeId}-…`
//     testid so existing committed-side tests stay stable.
//   - `data-participant-id="{participantId}"` — same seam shape as the
//     committed badge for per-participant assertions / styling.
//   - `data-pending="true"` — the new boolean attribute that lets
//     downstream tests / styling target "every pending axiom-mark on
//     this node" without per-participant DOM walking. Distinct from
//     `data-facet-status` (which is reserved for the per-facet state
//     machine — axiom-marks are NOT facets per
//     `mod_axiom_mark_decoration` Decision §"No update to
//     `cardRollupStatus`").
//
// Localized tooltip / aria-label resolve through `useTranslation`
// against the new `methodology.axiomMark.pendingTooltip` /
// `methodology.axiomMark.pendingSrLabel` keys with ICU substitution
// `{participantId}` (Decision §6 — parallel keys on the existing
// `methodology.axiomMark.*` namespace, NOT a new
// `methodology.pendingAxiomMark.*` namespace).

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { axiomMarkColorFor, type PendingAxiomMark } from './selectors.js';

export interface PendingAxiomMarkBadgeProps {
  readonly mark: PendingAxiomMark;
}

function PendingAxiomMarkBadgeImpl(props: PendingAxiomMarkBadgeProps): ReactElement {
  const { mark } = props;
  const { t } = useTranslation();
  const color = axiomMarkColorFor(mark.participantId);

  // The tooltip / aria-label carry the participant UUID via ICU
  // substitution against the new per-pending-state keys. The screen-
  // name swap (when the participants projection lands) will happen at
  // the catalog-substitution level in lockstep with the committed
  // badge — both surfaces consume the same `{participantId}` placeholder.
  const tooltip = t('methodology.axiomMark.pendingTooltip', { participantId: mark.participantId });
  const srLabel = t('methodology.axiomMark.pendingSrLabel', { participantId: mark.participantId });

  return (
    <span
      data-testid={`pending-axiom-mark-badge-${mark.nodeId}-${mark.participantId}`}
      data-participant-id={mark.participantId}
      data-pending="true"
      title={tooltip}
      aria-label={srLabel}
      role="img"
      className={`inline-flex h-5 w-5 items-center justify-center rounded-sm ${color.bg} ${color.text} border border-dashed border-slate-400 ring-1 ${color.ring} opacity-60 text-[11px] font-semibold leading-none`}
    >
      A
    </span>
  );
}

/**
 * Memo'd badge — same React-memoization rationale as `AxiomMarkBadge`
 * and `AnnotationBadge`. The badge re-renders only when `participantId`
 * / `nodeId` / locale change; the surrounding canvas re-renders on
 * every pan/zoom.
 */
export const PendingAxiomMarkBadge = memo(PendingAxiomMarkBadgeImpl);
