// `<AnnotationBadge>` — small pill that renders one annotation on a
// statement node or edge.
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_move_disputed_visibility.md
// (prior:     tasks/refinements/moderator-ui/mod_annotation_rendering.md,
//             tasks/refinements/moderator-ui/mod_disputed_state_styling.md)
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
// When the per-annotation rollup (via `cardRollupStatus`) resolves to
// `'disputed'` or `'meta-disagreement'`, the badge overlays the rose-600
// ring marker mirroring `<StatementNode>` / `<StatementEdge>` prior art
// (`mod_disputed_state_styling`) and stamps the precise rollup on
// `data-facet-status` so tests / downstream styling can discriminate.
// The aria-label gains a localized `(disputed)` suffix so screen readers
// hear the contested state alongside the kind label. The facet-status
// signal arrives either as an explicit `facetStatuses` prop (the seam
// the future engine wiring uses) or as the field on the render carrier
// (`AnnotationRenderData`).
//
// The badge is rendered by `<StatementNode>` (node-target annotations)
// and by `<StatementEdge>`'s `<EdgeLabelRenderer>` overlay (edge-target
// annotations). Same component for both surfaces; the surrounding
// container provides the layout (horizontal flex row for nodes,
// vertically-stacked centred for edges).

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { cardRollupStatus, type FacetName, type FacetStatus } from '@a-conversa/shell';

import type { AnnotationRenderData } from './selectors.js';

export interface AnnotationBadgeProps {
  readonly annotation: AnnotationRenderData;
  /**
   * Per-facet `FacetStatus` for this annotation. When the
   * `cardRollupStatus` rollup of the record resolves to `'disputed'` or
   * `'meta-disagreement'`, the badge overlays the rose-600 ring marker
   * and stamps `data-facet-status="<rollup>"`. Other rollup values fall
   * back to the baseline amber styling.
   *
   * Today's selector layer (`enrichAnnotationsWithFacetStatuses` against
   * the always-empty `EMPTY_ANNOTATION_FACET_STATUS_INDEX`) never
   * supplies this prop — the future
   * `annotation_facet_status_logic` engine task is the planned
   * populator. The prop is exposed as a separate input so call sites
   * that already destructure off the carrier can pass it without
   * mutating the annotation shape.
   *
   * The carrier (`annotation.facetStatuses`) is the alternate source —
   * the badge reads the explicit prop first, then falls back to the
   * carrier field. Both paths are equivalent today.
   */
  readonly facetStatuses?: Readonly<Partial<Record<FacetName, FacetStatus>>>;
}

function AnnotationBadgeImpl(props: AnnotationBadgeProps): ReactElement {
  const { annotation } = props;
  const facetStatuses = props.facetStatuses ?? annotation.facetStatuses;
  const { t } = useTranslation();

  const rollup = facetStatuses !== undefined ? cardRollupStatus(facetStatuses) : undefined;
  const isDisputedRollup = rollup === 'disputed' || rollup === 'meta-disagreement';

  // Disputed visual recipe (verbatim from `<StatementNode>` at L267–268,
  // L325 — `mod_disputed_state_styling`). The rose marker overlays the
  // existing amber pill: the kind colour stays read-through, but the
  // rose border + ring fires the "contested, attention required" signal.
  // The meta-disagreement state shares the rose marker per Decision §5;
  // tests discriminate via `data-facet-status`.
  const baseClassName =
    'inline-flex items-center rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[10px] uppercase tracking-wide whitespace-nowrap';
  const disputedClassName = isDisputedRollup
    ? ' border-solid border-rose-600 ring-2 ring-rose-500 opacity-100'
    : '';

  const kindLabel = t(`methodology.annotationKind.${annotation.kind}`);
  const ariaLabel = isDisputedRollup
    ? `${kindLabel} ${t('moderator.annotation.disputedAriaSuffix')}`
    : undefined;

  return (
    <span
      data-testid={`annotation-badge-${annotation.id}`}
      data-annotation-kind={annotation.kind}
      {...(isDisputedRollup ? { 'data-facet-status': rollup } : {})}
      {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
      title={annotation.content}
      className={`${baseClassName}${disputedClassName}`}
    >
      {kindLabel}
    </span>
  );
}

/**
 * Memo'd badge — the surrounding canvas re-renders on every viewport
 * pan/zoom; the badge text only changes when `kind` / `content` /
 * `facetStatuses` / locale change.
 */
export const AnnotationBadge = memo(AnnotationBadgeImpl);
