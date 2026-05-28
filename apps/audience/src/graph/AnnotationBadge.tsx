// `<AudienceAnnotationBadge>` — small amber pill rendering one
// committed annotation on the audience broadcast canvas. Painted as a
// child of the `<AudienceAnnotationOverlay>` DOM-sibling layer (the
// audience renders to a Cytoscape canvas; there is no React subtree
// per node, so per-element decoration lives in a DOM overlay).
//
// Refinement: tasks/refinements/audience/aud_annotation_rendering.md
//              (Decision §1 — per-annotation badges with localized kind
//              labels (NOT a boolean+count overlay); the audience
//              inverts the participant's collapse because the broadcast
//              surface has no detail panel. Decision §3 — inline port
//              of the moderator's `<AnnotationBadge>` with audience-
//              prefixed testid (`audience-annotation-badge-<id>`) so
//              cross-surface selectors don't collide when the show
//              producer composites the moderator + audience feeds in
//              OBS; cross-surface extraction is deferred to
//              `shell_package.extract_cytoscape_projectors` (already
//              registered).)
// ADRs:        0004 (Cytoscape.js + DOM overlay seam for per-element
//              React decoration); 0005 (Tailwind — amber-100 /
//              amber-900 palette via direct utility classes; per-kind
//              chromatic theming routes through `packages/ui-tokens`
//              once that workstream ships); 0022 (no throwaway
//              verifications — `AnnotationBadge.test.tsx` pins
//              behavior); 0024 (react-i18next + ICU — the kind label
//              resolves via `useTranslation()` against the
//              `methodology.annotationKind.<kind>` catalog key, which
//              `mod_annotation_rendering` populated for en-US / pt-BR /
//              es-419).
//
// Visual contract: single amber pill regardless of kind. The
// `data-annotation-kind` attribute is the seam for future per-kind
// theming (a `[data-annotation-kind="reframe"]` CSS rule can layer
// chromatic identity without touching this component).
//
// The `title` attribute carries the annotation's raw `content` body —
// the cheap-baseline hover affordance the moderator's
// `mod_annotation_rendering` chose. The broadcast audience has no
// detail panel and no click-to-expand surface, so the browser-native
// tooltip is the only way for an interactive viewer (the show
// producer's monitor) to read the full annotation body.

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { Annotation } from '@a-conversa/shell';

export interface AudienceAnnotationBadgeProps {
  readonly annotation: Annotation;
}

function AudienceAnnotationBadgeImpl(props: AudienceAnnotationBadgeProps): ReactElement {
  const { annotation } = props;
  const { t } = useTranslation();

  return (
    <span
      data-testid={`audience-annotation-badge-${annotation.id}`}
      data-annotation-kind={annotation.kind}
      title={annotation.content}
      className="inline-flex items-center rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[10px] uppercase tracking-wide whitespace-nowrap"
    >
      {t(`methodology.annotationKind.${annotation.kind}`)}
    </span>
  );
}

export const AudienceAnnotationBadge = memo(AudienceAnnotationBadgeImpl);

export default AudienceAnnotationBadge;
