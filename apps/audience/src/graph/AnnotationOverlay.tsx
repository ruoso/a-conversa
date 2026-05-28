// `<AudienceAnnotationOverlay>` — React DOM overlay painting one
// absolutely-positioned row of `<AudienceAnnotationBadge>` chips per
// Cytoscape node that carries at least one committed annotation. Third
// sibling of the Cytoscape canvas mount (after the per-facet pill
// overlay and the axiom-mark overlay) inside the
// `audience-graph-root-wrapper` positioning ancestor.
//
// Refinement: tasks/refinements/audience/aud_annotation_rendering.md
//              (Decision §1 — per-annotation badges, NOT a boolean
//              overlay; the audience inverts the participant's collapse
//              because the broadcast surface has no detail panel.
//              Decision §2 — scope to node-targeted annotations; the
//              overlay iterates `cy.nodes()` only, edge-targeted
//              deferred to the named-future-task
//              `aud_annotation_rendering_edges`. Decision §4 — badge
//              row anchored BELOW the axiom-mark row at
//              `renderedBoundingBox().y2 + ANNOTATION_ROW_OFFSET_Y`
//              with `ANNOTATION_ROW_OFFSET_Y = 30` so the row sits
//              clear of the axiom-mark row (which itself sits at
//              `y2 + 6` and is ~20 px tall, leaving a 4 px breathing
//              gap). Decision §5 — direct transposition of
//              `<AudienceAxiomMarkOverlay>`: same subscription set
//              (`render pan zoom resize` + `position node` + `add
//              remove data`), same singleton-rAF batched commit, same
//              `cyState` slot reuse; three overlays share the same
//              `Core` instance and each owns its own listeners.)
// ADRs:        0004 (Cytoscape.js — `renderedBoundingBox` + `cy.on(...)`
//              vocabulary is canonical Cytoscape API, no new dep);
//              0022 (no throwaway verifications — pinned by
//              `AnnotationOverlay.test.tsx`);
//              0026 (micro-frontend root app — the overlay ships
//              inside the audience artifact until
//              `extract_cytoscape_projectors` lifts the projection
//              helpers into `@a-conversa/shell`);
//              0027 (entity / facet layers are strictly separate —
//              annotations are the meta-commentary layer, distinct
//              from the per-facet agreement layer (the per-facet pills
//              above the node), the per-participant disposition layer
//              (axiom marks below the node), and the entity-rollup
//              layer (the node's per-state paint)).
//
// The overlay is a `pointer-events: none` layer so the broadcast
// surface stays read-only: clicks pass through to the (already
// `autoungrabify: true`) Cytoscape canvas. The badge's `title`
// attribute is the only hover affordance.

import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import type { Core, NodeSingular } from 'cytoscape';

import { AudienceAnnotationBadge } from './AnnotationBadge.js';
import type { Annotation } from './annotations.js';

export interface AudienceAnnotationOverlayProps {
  /**
   * Live Cytoscape `Core` handle. `null` before the canvas mount
   * effect has run; the overlay early-exits to an empty wrapper in
   * that case. `<AudienceGraphView>` reuses its existing `cyState`
   * slot (Decision §5) so this prop becomes non-null on the second
   * render.
   */
  readonly cy: Core | null;
  /**
   * Reference to the Cytoscape mount container. Reserved for future
   * positioning-debug branches that may need to measure the
   * container's `getBoundingClientRect()`. Today the overlay does not
   * consume it.
   */
  readonly containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Per-node placement record. The render path iterates over a snapshot
 * of these and emits one absolutely-positioned badge row per entry.
 */
interface AnnotationRowPlacement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly annotations: readonly Annotation[];
}

/**
 * Vertical offset (px) below the node bounding-box bottom edge. Places
 * the annotation row below the axiom-mark row (Decision §4): the
 * axiom-mark row sits at `y2 + 6` and is ~20 px tall (`h-5 w-5`
 * ring-1 chip), so 30 px down from `y2` leaves a 4 px breathing gap
 * below the axiom-mark row. When the axiom-mark row is empty, the
 * annotation row sits standalone at `y2 + 30`, with a small gap from
 * the node's bottom edge signalling "decoration here" without
 * ambiguity about which layer it belongs to.
 */
export const ANNOTATION_ROW_OFFSET_Y = 30;

export function AudienceAnnotationOverlay({
  cy,
  containerRef,
}: AudienceAnnotationOverlayProps): ReactElement {
  void containerRef;
  const [placements, setPlacements] = useState<readonly AnnotationRowPlacement[]>([]);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (cy === null) return undefined;

    const commit = (): void => {
      frameRef.current = null;
      const next: AnnotationRowPlacement[] = [];
      cy.nodes().forEach((node: NodeSingular) => {
        const annotations = node.data('annotations') as readonly Annotation[] | undefined;
        if (annotations === undefined || annotations.length === 0) return;
        const bb = node.renderedBoundingBox();
        next.push({
          id: node.id(),
          x: (bb.x1 + bb.x2) / 2,
          y: bb.y2 + ANNOTATION_ROW_OFFSET_Y,
          annotations,
        });
      });
      setPlacements(next);
    };

    const scheduleUpdate = (): void => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(commit);
    };

    scheduleUpdate();

    cy.on('render pan zoom resize', scheduleUpdate);
    cy.on('position', 'node', scheduleUpdate);
    cy.on('add remove data', scheduleUpdate);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      cy.off('render pan zoom resize', scheduleUpdate);
      cy.off('position', 'node', scheduleUpdate);
      cy.off('add remove data', scheduleUpdate);
    };
  }, [cy]);

  return (
    <div data-testid="audience-annotation-overlay" className="pointer-events-none absolute inset-0">
      {placements.map((p) => (
        <div
          key={p.id}
          data-annotation-row=""
          data-element-id={p.id}
          style={{
            position: 'absolute',
            left: `${String(p.x)}px`,
            top: `${String(p.y)}px`,
            transform: 'translate(-50%, 0)',
            display: 'flex',
            gap: '4px',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {p.annotations.map((annotation) => (
            <AudienceAnnotationBadge key={annotation.id} annotation={annotation} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default AudienceAnnotationOverlay;
