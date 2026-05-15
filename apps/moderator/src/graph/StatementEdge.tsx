// `<StatementEdge>` — custom ReactFlow edge that draws a bezier path and
// renders the methodology role label on the edge body, plus any
// annotations targeting this edge, plus per-facet state styling.
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_disagreement_split_render.md
// (prior:      tasks/refinements/moderator-ui/mod_disputed_state_styling.md,
//              tasks/refinements/moderator-ui/mod_agreed_state_styling.md,
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
// `mod_agreed_state_styling`, `mod_disputed_state_styling`,
// `mod_meta_disagreement_split_render`) can extend the class-name /
// marker logic without re-deciding the curve shape.
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

import { memo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow';

import { useSelectionStore } from '../stores/index.js';
import { AnnotationBadge } from './AnnotationBadge.js';
import { HoverPopover } from './HoverPopover.js';
import type { StatementEdgeData } from './selectors.js';

function StatementEdgeImpl(props: EdgeProps<StatementEdgeData>): ReactElement {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, style } =
    props;
  const { t } = useTranslation();

  // Selection state for this edge. Refinement: `mod_selection`. Same
  // boolean-projection pattern as `<StatementNode>`: the selector
  // reduces the store's `selected: Selection | null` to a single
  // boolean specific to THIS edge so only the previously- or newly-
  // selected edge re-renders. The decoration lives on the role-label
  // div (the visible interactive surface) — the `<BaseEdge>` `<path>`
  // is inside ReactFlow's SVG and isn't directly id-targetable for
  // tests, mirroring the existing `data-facet-status` decision on the
  // same label.
  const isSelected = useSelectionStore(
    (state) => state.selected?.kind === 'edge' && state.selected.id === id,
  );

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
  // do across facets). Four branches today:
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
  //   - `'meta-disagreement'` (refinement
  //     `mod_meta_disagreement_split_render`): violet stroke
  //     (`#7c3aed` — Tailwind's `violet-600`, matching the node's
  //     `border-violet-600` double-border marker) + a tight
  //     `strokeDasharray: '2 2'` dotted pattern conveying "fragmented /
  //     split" — visually distinct from the proposed long-dash
  //     (`6 4`) and the disputed solid stroke. No opacity dim — the
  //     meta-disagreement visual is fully attention-grabbing, not
  //     faded (mirrors the disputed pattern).
  //
  // Other substance statuses (`'committed'`, `'withdrawn'`) still stamp
  // the data attribute (stable seam — `<BaseEdge>`'s path is rendered
  // inside ReactFlow's SVG and isn't directly id-targetable) but don't
  // change the stroke style until their own sibling refinements land
  // their styling branches.
  const substanceStatus = facetStatuses.substance;
  const proposedEdgeStyle =
    substanceStatus === 'proposed' ? { strokeDasharray: '6 4', opacity: 0.6 } : undefined;
  // `rose-600` — Tailwind palette. Matches the node's `border-rose-600`
  // disputed marker so nodes and edges in the same disputed state read
  // as the same red across the canvas. If a design-tokens package later
  // lands a `danger` / `error` family, this hex is the placeholder.
  const disputedEdgeStyle = substanceStatus === 'disputed' ? { stroke: '#e11d48' } : undefined;
  // `violet-600` — Tailwind palette. Matches the node's
  // `border-violet-600` meta-disagreement marker so nodes and edges in
  // the same meta-disagreement state read as the same violet across the
  // canvas. The `2 2` dasharray is a tight dotted pattern (distinct
  // from the proposed `6 4` long-dash) that conveys the "fragmented /
  // split" disposition the methodology text describes. If a design-
  // tokens package later lands a `methodology-escalation` / `notice`
  // family, this hex is the placeholder.
  const metaDisagreementEdgeStyle =
    substanceStatus === 'meta-disagreement'
      ? { stroke: '#7c3aed', strokeDasharray: '2 2' }
      : undefined;

  // `style` is optional on `EdgeProps` but `BaseEdge`'s prop type (under
  // `exactOptionalPropertyTypes`) requires `CSSProperties` (not `… | undefined`).
  // Compose the caller-provided style (if any) with the per-status
  // override (if any). Only one of the per-status overrides applies at
  // a time (the substance facet has exactly one status). We only set
  // `style` on `<BaseEdge>` when at least one of the inputs is present.
  const statusEdgeStyle = proposedEdgeStyle ?? disputedEdgeStyle ?? metaDisagreementEdgeStyle;
  const mergedStyle =
    style !== undefined || statusEdgeStyle !== undefined
      ? { ...(style ?? {}), ...(statusEdgeStyle ?? {}) }
      : undefined;
  const baseEdgeStyleProps = mergedStyle === undefined ? {} : { style: mergedStyle };

  // Diagnostic-highlight halo on the role-label pill (refinement
  // `mod_diagnostic_highlighting`). Same composition decision as the
  // `mod_selection` ring: the `<BaseEdge>` `<path>` is inside ReactFlow's
  // SVG and isn't directly id-targetable for tests; the role-label div
  // is the stable DOM seam for both data-attribute stamps and ring
  // classes. The methodology-state path styling (proposed dashed /
  // disputed red stroke / meta-disagreement violet dotted) stays the
  // canonical signal on the edge body; this halo lives on the label.
  const diagnosticHighlight = data?.diagnosticHighlight;
  const labelDiagnosticClassName =
    diagnosticHighlight === undefined
      ? ''
      : diagnosticHighlight.severity === 'blocking'
        ? ' ring-4 ring-amber-500/80 ring-offset-2 ring-offset-white motion-safe:animate-pulse'
        : ' ring-2 ring-amber-300/70 ring-offset-1 ring-offset-white';
  // Hover / focus-visible state for the per-edge popover. Refinement:
  // `mod_hover_details`. Same single-boolean idiom as `<StatementNode>` —
  // pointer and keyboard inputs both flip the flag, the popover renders
  // as a sibling of the role-label inside the `<EdgeLabelRenderer>`
  // portal's positioned container.
  const [isHovered, setIsHovered] = useState(false);
  // The role-label div carries the existing `data-facet-status` seam
  // for substance state-styling, plus the new `data-selected` seam this
  // task adds. Both branches of `data-selected` are stamped so tests
  // can target the negative case without relying on attribute absence.
  // `data-diagnostic-severity` is stamped only when a diagnostic
  // highlight is present (mirrors the `data-facet-status` decision to
  // omit on baseline rather than stamp `"none"`).
  //
  // The native `title` attribute previously stamped for diagnostic-
  // highlight kind names has been REMOVED. Refinement:
  // `mod_hover_details`. The popover (rendered as a sibling inside the
  // edge-label container below) surfaces the same content with richer
  // layout; leaving `title` would race a native multi-second tooltip
  // against our instant popover.
  const labelDataAttrs = {
    ...(substanceStatus !== undefined ? { 'data-facet-status': substanceStatus } : {}),
    'data-selected': isSelected ? 'true' : 'false',
    ...(diagnosticHighlight !== undefined
      ? { 'data-diagnostic-severity': diagnosticHighlight.severity }
      : {}),
    ...(isHovered ? { 'aria-describedby': `hover-popover-${id}` } : {}),
  };
  // Selection ring (refinement `mod_selection`). Composed via Tailwind
  // `ring-4 ring-sky-500` — same palette / width as the node card so
  // selected nodes and selected edges read as the same "selected" signal
  // across the canvas.
  const labelSelectionClassName = isSelected ? ' ring-4 ring-sky-500' : '';

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
          className="nodrag nopan flex flex-col items-center gap-0.5 relative"
        >
          <div
            data-testid={`graph-edge-label-${id}`}
            data-edge-role={data?.role ?? ''}
            className={`rounded bg-white px-1 text-xs text-slate-900 shadow-sm${labelSelectionClassName}${labelDiagnosticClassName}`}
            tabIndex={0}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onFocus={() => setIsHovered(true)}
            onBlur={() => setIsHovered(false)}
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
          {isHovered && data !== undefined ? (
            <HoverPopover id={id} target={{ kind: 'edge', data }} />
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
