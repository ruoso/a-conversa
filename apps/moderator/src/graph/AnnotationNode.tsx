// `<AnnotationNode>` — custom ReactFlow node for annotations that
// participate as edge endpoints.
//
// Refinement: tasks/refinements/moderator-ui/mod_render_annotation_endpoint_edges.md
// ADRs:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md,
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Annotations decorate their target as a badge in the default case
// (`mod_annotation_rendering` Decision §1). This task amends that
// decision for the subset of annotations that participate as edge
// endpoints: those promote to a standalone ReactFlow node-type so the
// canvas can connect annotation-endpoint edges to them. Per Decision §1
// of this refinement, badge OR node (mutual exclusion), never both.
//
// The card renders a small two-row layout sized for short content:
//   1. The localized kind label header (`methodology.annotationKind.<kind>`
//      — the same i18n key the badge consumes; Decision §6 DRY).
//   2. The annotation content body (truncated to fit the card; full
//      content surfaced via the `title` attribute).
//
// Dimensions (`width: 192, height: 56` per Decision §5) match the
// Tailwind sizing of the rendered card so dagre allocates a footprint
// that matches what gets drawn.

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { AnnotationKind } from '@a-conversa/shared-types';

export interface AnnotationNodeData {
  readonly kind: AnnotationKind;
  readonly content: string;
  /**
   * `true` when the annotation's host (its `targetNodeId` or
   * `targetEdgeId`) cannot be resolved in the projection layer (a
   * wire-protocol defensive case). The node still renders so the
   * moderator sees the orphaned entity rather than encountering a
   * silent drop; the host pseudo-edge is omitted in this case.
   * Stamped as `data-host-missing="true"` on the card root for
   * diagnosis. Per Decision §4.
   */
  readonly hostMissing?: boolean;
}

/**
 * The ReactFlow `type` key under which `AnnotationNode` is registered.
 * Hoisted so the registration and every projected `Node.type` stay in
 * lockstep — a literal typo would silently fall back to ReactFlow's
 * default node.
 */
export const ANNOTATION_NODE_TYPE = 'annotation';

/**
 * Per-card dimensions fed to dagre for `AnnotationNode` placements.
 * Smaller than `StatementNode` (288×90) because annotations are denser
 * semantically but lighter visually — Decision §5.
 */
export const ANNOTATION_NODE_WIDTH = 192;
export const ANNOTATION_NODE_HEIGHT = 56;

function AnnotationNodeImpl(props: NodeProps<AnnotationNodeData>): ReactElement {
  const { id, data } = props;
  const { t } = useTranslation();
  const { kind, content, hostMissing } = data;

  const kindLabel = t(`methodology.annotationKind.${kind}`);

  const rootProps = {
    ...(hostMissing === true ? { 'data-host-missing': 'true' } : {}),
  };

  return (
    <div
      data-testid={`annotation-node-${id}`}
      data-annotation-kind={kind}
      title={content}
      className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 shadow-sm"
      style={{ width: ANNOTATION_NODE_WIDTH, height: ANNOTATION_NODE_HEIGHT }}
      {...rootProps}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <p
        data-testid={`annotation-node-kind-${id}`}
        className="text-[10px] font-semibold uppercase tracking-wide text-amber-900"
      >
        {kindLabel}
      </p>
      <p
        data-testid={`annotation-node-content-${id}`}
        className="mt-0.5 text-xs text-amber-900 leading-tight overflow-hidden text-ellipsis whitespace-nowrap"
      >
        {content}
      </p>
    </div>
  );
}

/**
 * Memo'd custom ReactFlow node component. The surrounding canvas
 * re-renders on every viewport pan/zoom; the node only needs to
 * re-render when `data.kind` / `data.content` / `data.hostMissing` /
 * locale change.
 */
export const AnnotationNode = memo(AnnotationNodeImpl);
