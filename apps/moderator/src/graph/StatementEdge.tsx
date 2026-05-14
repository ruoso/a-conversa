// `<StatementEdge>` — custom ReactFlow edge that draws a bezier path and
// renders the methodology role label on the edge body, plus any
// annotations targeting this edge, plus per-facet state styling.
//
// Refinement: tasks/refinements/moderator-ui/mod_disputed_state_styling.md
// (prior:      tasks/refinements/moderator-ui/mod_agreed_state_styling.md,
//              tasks/refinements/moderator-ui/mod_proposed_state_styling.md,
//              tasks/refinements/moderator-ui/mod_annotation_rendering.md,
//              tasks/refinements/moderator-ui/mod_edge_rendering.md)
// ADRs:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md,
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// The component implements ReactFlow's `EdgeProps` contract: it receives
// the source/target endpoints already resolved by ReactFlow plus the
// `data` payload the selector stashed on the edge object. `data.role`
// is an `EdgeRole` (one of seven values from the methodology enum); the
// label text resolves through react-i18next as
// `t('methodology.edgeRole.<role>')`, so the same component renders the
// per-locale label in en-US / pt-BR / es-419 (and any future locale that
// ships a catalog). `data.annotations` carries every `annotation-created`
// event whose `target_edge_id` is this edge; each annotation renders as
// an `<AnnotationBadge>` stacked beneath the role pill.
//
// Geometry: `getBezierPath` matches ReactFlow's default look so the
// downstream state-styling tasks (`mod_proposed_state_styling`,
// `mod_agreed_state_styling`, `mod_disputed_state_styling`) can extend
// the class-name / marker logic without re-deciding the curve shape.
//
// Label rendering: `<EdgeLabelRenderer>` is ReactFlow's official portal
// for putting HTML on an edge. It keeps the label horizontal regardless
// of edge angle (matches the community-recommended text-on-edge pattern),
// lets Tailwind / future ui-tokens style the label as DOM rather than
// SVG text, and positions the label at the midpoint of the bezier
// (`labelX`, `labelY` are emitted by `getBezierPath` for exactly this
// use case).
//
// Memoization: ReactFlow re-runs the edge renderer on every viewport
// pan/zoom — `memo(...)` skips the re-render when `data.role`,
// `data.annotations`, and the endpoint coordinates haven't changed.

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow';

import { AnnotationBadge } from './AnnotationBadge.js';
import type { StatementEdgeData } from './selectors.js';

function StatementEdgeImpl(props: EdgeProps<StatementEdgeData>): ReactElement {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, style } =
    props;
  const { t } = useTranslation();

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Defensive: every edge the selector emits carries `data.role`, but if
  // a future caller forgets the data payload we render an empty label
  // rather than throwing. The catalog miss check below would otherwise
  // return the literal `methodology.edgeRole.undefined`, which is worse
  // signal than just rendering blank.
  const label = data?.role ? t(`methodology.edgeRole.${data.role}`) : '';
  const annotations = data?.annotations ?? [];
  const facetStatuses = data?.facetStatuses ?? {};

  // State-styling rollup. Edges in v1 carry only the `substance` facet,
  // so the rollup is the substance status directly (no priority pick to
  // do across facets). Three branches today:
  //   - `'proposed'` (refinement `mod_proposed_state_styling`): dashed
  //     stroke + opacity-0.6 — the "in flight" visual.
  //   - `'agreed'`   (refinement `mod_agreed_state_styling`): solid
  //     stroke + full opacity. This is the BaseEdge default; we apply
  //     no style override and rely on ReactFlow's defaults. The
  //     `data-facet-status="agreed"` attribute is still stamped on the
  //     role-label pill so downstream tests / styling tasks can target
  //     the agreed seam.
  //   - `'disputed'` (refinement `mod_disputed_state_styling`): solid
  //     red stroke (`#e11d48` — Tailwind's `rose-600`, matching the
  //     red border the node uses for the same state). No dasharray,
  //     no opacity dim — the disputed visual is fully attention-
  //     grabbing, not faded. The `<BaseEdge>` renders the underlying
  //     `<path>` element; the canonical extension point is the `style`
  //     prop's `stroke` (same pattern the proposed branch uses for
  //     `strokeDasharray` / `opacity`).
  //
  // Other substance statuses (`'meta-disagreement'`, `'committed'`,
  // `'withdrawn'`) still stamp the data attribute (stable seam —
  // `<BaseEdge>`'s path is rendered inside ReactFlow's SVG and isn't
  // directly id-targetable) but don't change the stroke style until
  // their own sibling refinements land their styling branches.
  const substanceStatus = facetStatuses.substance;
  const proposedEdgeStyle =
    substanceStatus === 'proposed' ? { strokeDasharray: '6 4', opacity: 0.6 } : undefined;
  // `rose-600` — Tailwind palette. Matches the node's `border-rose-600`
  // disputed marker so nodes and edges in the same disputed state read
  // as the same red across the canvas. If a design-tokens package later
  // lands a `danger` / `error` family, this hex is the placeholder.
  const disputedEdgeStyle = substanceStatus === 'disputed' ? { stroke: '#e11d48' } : undefined;

  // `style` is optional on `EdgeProps` but `BaseEdge`'s prop type (under
  // `exactOptionalPropertyTypes`) requires `CSSProperties` (not `… | undefined`).
  // Compose the caller-provided style (if any) with the per-status
  // override (if any). Only one of the per-status overrides applies at
  // a time (the substance facet has exactly one status). We only set
  // `style` on `<BaseEdge>` when at least one of the inputs is present.
  const statusEdgeStyle = proposedEdgeStyle ?? disputedEdgeStyle;
  const mergedStyle =
    style !== undefined || statusEdgeStyle !== undefined
      ? { ...(style ?? {}), ...(statusEdgeStyle ?? {}) }
      : undefined;
  const baseEdgeStyleProps = mergedStyle === undefined ? {} : { style: mergedStyle };

  const labelDataAttrs =
    substanceStatus !== undefined ? { 'data-facet-status': substanceStatus } : {};

  return (
    <>
      <BaseEdge id={id} path={edgePath} {...baseEdgeStyleProps} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            // `pointer-events: all` keeps the label hover/click-targetable
            // for the downstream `mod_hover_details` / `mod_context_menus`
            // tasks. `nodrag`/`nopan` opt the label out of ReactFlow's
            // pan / drag-to-create-edge gestures so dragging the label
            // doesn't try to start a new connection.
            pointerEvents: 'all',
          }}
          className="nodrag nopan flex flex-col items-center gap-0.5"
        >
          <div
            data-testid={`graph-edge-label-${id}`}
            data-edge-role={data?.role ?? ''}
            className="rounded bg-white px-1 text-xs text-slate-900 shadow-sm"
            {...labelDataAttrs}
          >
            {label}
          </div>
          {annotations.length > 0 ? (
            <div
              data-testid={`annotation-badge-list-edge-${id}`}
              className="flex flex-wrap gap-0.5 justify-center"
            >
              {annotations.map((annotation) => (
                <AnnotationBadge key={annotation.id} annotation={annotation} />
              ))}
            </div>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/**
 * Memo'd custom ReactFlow edge component. Registered in `edgeTypes`
 * under the key `statement`; every edge the selector emits carries
 * `type: 'statement'`.
 */
export const StatementEdge = memo(StatementEdgeImpl);
