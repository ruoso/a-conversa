// `<StatementEdge>` — custom ReactFlow edge that draws a bezier path and
// renders the methodology role label on the edge body, plus any
// annotations targeting this edge.
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_rendering.md
// (prior:      tasks/refinements/moderator-ui/mod_edge_rendering.md)
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

  // `style` is optional on `EdgeProps` but `BaseEdge`'s prop type (under
  // `exactOptionalPropertyTypes`) requires `CSSProperties` (not `… | undefined`).
  // Spread the prop only when defined to satisfy the stricter signature
  // without losing the caller-provided style when ReactFlow does pass one.
  const baseEdgeStyleProps = style === undefined ? {} : { style };

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
