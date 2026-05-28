// `<AudienceAxiomMarkBadge>` — small per-participant badge that renders
// one committed axiom-mark on the audience broadcast canvas.
//
// Refinement: tasks/refinements/audience/aud_axiom_mark_decoration.md
//              (Decision §1 — per-participant chromatic badge, NOT a
//              boolean overlay: the broadcast surface has no detail
//              panel and the per-participant identity IS the
//              methodology-load-bearing signal for broadcast viewers.
//              Decision §3 — inline port of the moderator's
//              `apps/moderator/src/graph/AxiomMarkBadge.tsx`, consuming
//              the audience-local `AxiomMark` interface; cross-surface
//              lift to `@a-conversa/shell` is deferred to the
//              `shell_axiom_marks_extraction` named-future-task.)
// ADRs:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//              (the audience canvas has no React tree per node, so this
//              badge is rendered by `<AudienceAxiomMarkOverlay>` as a
//              DOM-overlay sibling of the Cytoscape canvas mount —
//              one row of these chips per axiom-marked node);
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//              (the `title` and `aria-label` resolve via
//              `useTranslation()` against the
//              `methodology.axiomMark.{tooltip,srLabel}` ICU keys
//              already populated by the moderator's leaf).
//
// Visual contract — mirrors the moderator's `<AxiomMarkBadge>` so a
// future shell-lift consolidates the two callers without visual drift:
//   - `rounded-sm` square shape (distinct from the rounded-pill
//     annotation badge family — shape is the primary cross-family seam);
//   - centered "A" Latin-anchor glyph (locale-independent visible label;
//     the full localized form lives in the `title` + `aria-label`);
//   - per-participant background / text / ring color triple resolved
//     via `axiomMarkColorFor(participantId)` from `@a-conversa/shell`
//     (deterministic six-bucket hash; same participant → same color
//     across surfaces).
//
// The component is `memo`'d — the badge re-renders only when the
// `mark` reference changes; the surrounding canvas re-renders on every
// pan/zoom.

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { axiomMarkColorFor } from '@a-conversa/shell';

import type { AxiomMark } from './axiomMarks.js';

export interface AudienceAxiomMarkBadgeProps {
  readonly mark: AxiomMark;
}

function AudienceAxiomMarkBadgeImpl(props: AudienceAxiomMarkBadgeProps): ReactElement {
  const { mark } = props;
  const { t } = useTranslation();
  const color = axiomMarkColorFor(mark.participantId);

  const tooltip = t('methodology.axiomMark.tooltip', { participantId: mark.participantId });
  const srLabel = t('methodology.axiomMark.srLabel', { participantId: mark.participantId });

  return (
    <span
      data-testid={`audience-axiom-mark-badge-${mark.nodeId}-${mark.participantId}`}
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

export const AudienceAxiomMarkBadge = memo(AudienceAxiomMarkBadgeImpl);

export default AudienceAxiomMarkBadge;
