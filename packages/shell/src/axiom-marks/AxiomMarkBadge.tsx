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
// Refinement: tasks/refinements/shell-package/shell_axiom_mark_panel_badge_consolidation.md
//   (Subsumed the participant's panel-side badge by adding an optional
//   `screenName?: string` prop. When provided, the badge resolves
//   `title` + `aria-label` via the `methodology.axiomMarkBadge.{tooltip,
//   srLabel}` cluster (with `{screenName}` substitution) — for callers
//   that have a participants projection locally (the participant detail
//   panel today). When omitted, the badge keeps the historical UUID-keyed
//   methodology surface — for graph callers without a roster (moderator
//   `<StatementNode>` + audience `<AxiomMarkOverlay>`).)
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
// Per-participant attribution: when no `screenName` is passed the tooltip /
// `aria-label` carry the raw participant UUID via the
// `methodology.axiomMark.{tooltip,srLabel}` cluster (graph callers without
// a roster); when `screenName` is passed they carry the screen name via
// the `methodology.axiomMarkBadge.{tooltip,srLabel}` cluster (panel
// callers with a roster). Testids + `data-participant-id` are
// branch-independent.

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

// Intra-package import — `axiomMarkColorFor` is the shell's existing
// per-participant chromatic primitive. Going through `@a-conversa/shell`
// from inside the shell would introduce a self-circular dependency.
import { axiomMarkColorFor } from '../facet-pill/participant-color.js';

import type { AxiomMark } from './axiom-marks.js';

export interface AxiomMarkBadgeProps {
  readonly mark: AxiomMark;
  readonly screenName?: string;
}

function AxiomMarkBadgeImpl(props: AxiomMarkBadgeProps): ReactElement {
  const { mark, screenName } = props;
  const { t } = useTranslation();
  const color = axiomMarkColorFor(mark.participantId);

  const tooltip =
    screenName !== undefined
      ? t('methodology.axiomMarkBadge.tooltip', { screenName })
      : t('methodology.axiomMark.tooltip', { participantId: mark.participantId });
  const srLabel =
    screenName !== undefined
      ? t('methodology.axiomMarkBadge.srLabel', { screenName })
      : t('methodology.axiomMark.srLabel', { participantId: mark.participantId });

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
