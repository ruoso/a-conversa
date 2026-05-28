// `<AnnotationBadge>` — small pill that renders one annotation on a
// statement node or edge.
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_rendering.md
// ADRs:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Each badge surfaces the annotation's localized kind label
// (`methodology.annotationKind.<kind>` resolved through `useTranslation`)
// and the annotation's `content` via the `title` attribute (cheap baseline
// hover surface — the dedicated `mod_hover_details` task is downstream).
//
// Visual tone: single amber pill regardless of kind. Per-kind colour
// theming is deferred to `packages/ui-tokens`; the `data-annotation-kind`
// attribute is the seam — a future per-kind selector can target each
// variant without touching this component.
//
// The badge is rendered by `<StatementNode>` (node-target annotations)
// and by `<StatementEdge>`'s `<EdgeLabelRenderer>` overlay (edge-target
// annotations). Same component for both surfaces; the surrounding
// container provides the layout (horizontal flex row for nodes,
// vertically-stacked centred for edges).

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { Annotation } from '@a-conversa/shell';

export interface AnnotationBadgeProps {
  readonly annotation: Annotation;
}

function AnnotationBadgeImpl(props: AnnotationBadgeProps): ReactElement {
  const { annotation } = props;
  const { t } = useTranslation();

  return (
    <span
      data-testid={`annotation-badge-${annotation.id}`}
      data-annotation-kind={annotation.kind}
      title={annotation.content}
      className="inline-flex items-center rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[10px] uppercase tracking-wide whitespace-nowrap"
    >
      {t(`methodology.annotationKind.${annotation.kind}`)}
    </span>
  );
}

/**
 * Memo'd badge — the surrounding canvas re-renders on every viewport
 * pan/zoom; the badge text only changes when `kind` / `content` /
 * locale change.
 */
export const AnnotationBadge = memo(AnnotationBadgeImpl);
