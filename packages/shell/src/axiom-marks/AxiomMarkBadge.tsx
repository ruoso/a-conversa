// `<AxiomMarkBadge>` — canonical per-participant chromatic badge for one
// committed axiom-mark.
//
// Refinement: tasks/refinements/shell-package/shell_axiom_marks_extraction.md
//   (Cross-surface consolidation of the moderator's
//   `apps/moderator/src/graph/AxiomMarkBadge.tsx` + the audience's
//   `apps/audience/src/graph/AxiomMarkBadge.tsx` (`AudienceAxiomMarkBadge`)
//   into one shell-side primitive every UI surface imports from
//   `@a-conversa/shell`. The two predecessor copies were structurally
//   identical for prop shape, visual contract, and i18n key set; the
//   only divergence was a surface-specific testid prefix
//   (`axiom-mark-badge-` vs `audience-axiom-mark-badge-`) — the canonical
//   prefix is the moderator's `axiom-mark-badge-{nodeId}-{participantId}`
//   shape per the refinement's acceptance criteria.
//
//   The participant's panel-side `<AxiomMarkBadge>` at
//   `apps/participant/src/detail/AxiomMarkBadge.tsx` is NOT subsumed by
//   this canonical badge — that component takes
//   `{participantId, screenName}` and uses the
//   `participant.detailPanel.axiomMarkBadge.srLabel` i18n key (resolving
//   screen names locally via the participant roster), which is a
//   semantically distinct surface from the methodology-keyed
//   `methodology.axiomMark.{tooltip,srLabel}` shape this badge ships.
//   Unifying that copy would be a behavior change, not a refactor —
//   tracked as the follow-up `shell_axiom_mark_panel_badge_consolidation`.)
//
// ADRs:
//   - 0004 (the badge mounts inside whichever graph subtree the surface
//     uses — ReactFlow node child for the moderator, DOM-overlay sibling
//     for the audience Cytoscape canvas);
//   - 0024 (react-i18next + ICU — `title` and `aria-label` resolve via
//     `useTranslation()` against the methodology.axiomMark.{tooltip,
//     srLabel} keys already populated in en-US / pt-BR / es-419);
//   - 0026 (micro-frontend root app — the shell package is the canonical
//     home for cross-surface UI primitives);
//   - 0027 (entity / facet layers are strictly separate — axiom-marks
//     are entity-layer disposition decorations).
//
// Visual contract:
//   - `rounded-sm` square shape (distinct from the rounded-pill
//     annotation badge family — shape is the primary cross-family seam);
//   - centered "A" Latin-anchor glyph (locale-independent visible label;
//     the full localized form lives in `title` + `aria-label`);
//   - per-participant background / text / ring color triple resolved
//     via `axiomMarkColorFor(participantId)` from the sibling
//     `facet-pill/participant-color.ts` module (deterministic six-bucket
//     hash; same participant → same color across surfaces).
//
// Per-participant attribution: today the tooltip / `aria-label` carries
// the raw participant UUID via ICU substitution. The screen-name swap
// is deferred to when the participants projection lands; the testids
// and the `data-participant-id` seam don't change.

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

// Intra-package import — `axiomMarkColorFor` is the shell's existing
// per-participant chromatic primitive. Going through `@a-conversa/shell`
// from inside the shell would introduce a self-circular dependency.
import { axiomMarkColorFor } from '../facet-pill/participant-color.js';

import type { AxiomMark } from './axiom-marks.js';

export interface AxiomMarkBadgeProps {
  readonly mark: AxiomMark;
}

function AxiomMarkBadgeImpl(props: AxiomMarkBadgeProps): ReactElement {
  const { mark } = props;
  const { t } = useTranslation();
  const color = axiomMarkColorFor(mark.participantId);

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
 * Memo'd badge — the badge re-renders only when `mark` changes by
 * reference or the locale changes; the surrounding graph subtree
 * re-renders on every pan/zoom.
 */
export const AxiomMarkBadge = memo(AxiomMarkBadgeImpl);
