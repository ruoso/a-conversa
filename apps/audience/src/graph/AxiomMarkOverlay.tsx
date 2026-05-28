// `<AudienceAxiomMarkOverlay>` — React DOM overlay painting one
// absolutely-positioned row of `<AudienceAxiomMarkBadge>` chips per
// Cytoscape node that carries at least one committed axiom-mark.
// Sibling of the Cytoscape canvas mount (and of the per-facet pill
// overlay) inside the `audience-graph-root-wrapper` positioning
// ancestor.
//
// Refinement: tasks/refinements/audience/aud_axiom_mark_decoration.md
//              (Decision §1 — per-participant chromatic badges, NOT a
//              boolean overlay; the audience inverts the participant's
//              boolean-collapse because the broadcast surface has no
//              detail panel. Decision §4 — badge row anchored BELOW the
//              node bounding box (`renderedBoundingBox().y2 +
//              AXIOM_BADGE_ROW_OFFSET_Y`) with `translate(-50%, 0)` so
//              the row's top edge sits at the anchor point; the
//              per-facet pill row already occupies the above-the-node
//              anchor, and the below-the-node anchor matches the
//              cross-surface convention for per-participant signals.
//              Decision §5 — direct transposition of
//              `<AudiencePerFacetPillOverlay>`: same subscription set
//              (`render pan zoom resize` + `position node` + `add
//              remove data`), same singleton-rAF batched commit, same
//              `cyState` slot reuse; two overlays share the same
//              `Core` instance and each owns its own listeners.)
// ADRs:        0004 (Cytoscape.js — `renderedBoundingBox` + `cy.on(...)`
//              vocabulary is canonical Cytoscape API, no new dep);
//              0022 (no throwaway verifications — pinned by
//              `AxiomMarkOverlay.test.tsx`);
//              0026 (micro-frontend root app — the overlay ships
//              inside the audience artifact);
//              0027 (entity / facet layers are strictly separate —
//              axiom-marks are the per-participant disposition layer,
//              orthogonal to both the per-facet agreement layer (the
//              per-facet pills above the node) and the entity-rollup
//              layer (the node's per-state paint)).
//
// The overlay is a `pointer-events: none` layer so the broadcast
// surface stays read-only: clicks pass through to the (already
// `autoungrabify: true`) Cytoscape canvas.

import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import type { Core, NodeSingular } from 'cytoscape';

import { AudienceAxiomMarkBadge } from './AxiomMarkBadge.js';
import type { AxiomMark } from './axiomMarks.js';

export interface AudienceAxiomMarkOverlayProps {
  /**
   * Live Cytoscape `Core` handle. `null` before the canvas mount
   * effect has run; the overlay early-exits to an empty wrapper in
   * that case. `<AudienceGraphView>` reuses its existing `cyState`
   * slot (introduced by `aud_per_facet_visualization`) so this prop
   * becomes non-null on the second render.
   */
  readonly cy: Core | null;
  /**
   * Reference to the Cytoscape mount container. Reserved for future
   * positioning-debug branches that may need to measure the
   * container's `getBoundingClientRect()` to refine the coordinate
   * transform. Today the overlay does not consume it.
   */
  readonly containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Per-node placement record. The render path iterates over a snapshot
 * of these and emits one absolutely-positioned badge row per entry.
 */
interface BadgeRowPlacement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly marks: readonly AxiomMark[];
}

/**
 * Vertical offset (px) below the node bounding-box bottom edge.
 * Matches the per-facet pill row's `PILL_ROW_OFFSET_Y` for visual
 * symmetry: pills 6px above the node, badges 6px below.
 */
const AXIOM_BADGE_ROW_OFFSET_Y = 6;

export function AudienceAxiomMarkOverlay({
  cy,
  containerRef,
}: AudienceAxiomMarkOverlayProps): ReactElement {
  void containerRef;
  const [placements, setPlacements] = useState<readonly BadgeRowPlacement[]>([]);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (cy === null) return undefined;

    const commit = (): void => {
      frameRef.current = null;
      const next: BadgeRowPlacement[] = [];
      cy.nodes().forEach((node: NodeSingular) => {
        const marks = node.data('axiomMarks') as readonly AxiomMark[] | undefined;
        if (marks === undefined || marks.length === 0) return;
        const bb = node.renderedBoundingBox();
        next.push({
          id: node.id(),
          x: (bb.x1 + bb.x2) / 2,
          y: bb.y2 + AXIOM_BADGE_ROW_OFFSET_Y,
          marks,
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
    <div data-testid="audience-axiom-mark-overlay" className="pointer-events-none absolute inset-0">
      {placements.map((p) => (
        <div
          key={p.id}
          data-axiom-mark-row=""
          data-element-id={p.id}
          style={{
            position: 'absolute',
            left: `${String(p.x)}px`,
            top: `${String(p.y)}px`,
            transform: 'translate(-50%, 0)',
            display: 'flex',
            gap: '4px',
          }}
        >
          {p.marks.map((mark) => (
            <AudienceAxiomMarkBadge key={mark.participantId} mark={mark} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default AudienceAxiomMarkOverlay;
