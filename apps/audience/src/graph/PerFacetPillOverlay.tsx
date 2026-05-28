// `<AudiencePerFacetPillOverlay>` — React DOM overlay painting one
// absolutely-positioned row of `<FacetPill>` chips per Cytoscape node
// with a non-empty `data.facetStatuses` record. Sibling of the
// Cytoscape canvas mount inside the `audience-graph-root-wrapper`
// positioning ancestor.
//
// Refinement: tasks/refinements/audience/aud_per_facet_visualization.md
//              (Decision §1 — DOM overlay sibling of the Cytoscape
//              canvas, mirroring the participant's `OtherVotesOverlay`
//              pattern. Decision §2 — pill row anchored ABOVE the node
//              bounding box (`renderedBoundingBox().y1 -
//              PILL_ROW_OFFSET_Y`) with `translate(-50%, -100%)` so
//              the row's bottom edge sits at the anchor point.
//              Decision §3 — canonical reading order
//              `wording → classification → substance`; pills emit only
//              for facets present in `data.facetStatuses`. Edges are
//              out of scope at this leaf — the overlay iterates
//              `cy.nodes()` only. Decision §4 — rAF-batched commit
//              subscribed to `cy.on('render pan zoom resize', cb)` +
//              `cy.on('position', 'node', cb)` +
//              `cy.on('add remove data', cb)`. Decision §5 — `cy` is
//              lifted into `useState` upstream and arrives as a
//              non-null prop on the second render.)
// ADRs:        0004 (Cytoscape.js for the audience broadcast surface —
//              `renderedBoundingBox` + `cy.on(...)` vocabulary is
//              canonical Cytoscape API, no new dependency);
//              0022 (no throwaway verifications — the behaviour is
//              pinned by `PerFacetPillOverlay.test.tsx`);
//              0026 (micro-frontend root app — the overlay ships
//              inside the audience artifact);
//              0027 (entity / facet layers are strictly separate —
//              the per-facet detail is the facet-layer surfacing, the
//              whole-card rollup paint is the entity-layer surfacing);
//              0030 (per-facet vote keying — the seven `FacetStatus`
//              values are all rendered through `<FacetPill>`).
//
// The overlay is a `pointer-events: none` layer so the show-producer's
// broadcast surface stays read-only: clicks pass through to the
// (already `autoungrabify: true`) Cytoscape canvas.

import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import type { Core, NodeSingular } from 'cytoscape';

import { FacetPill, type FacetName, type FacetStatus } from '@a-conversa/shell';

export interface AudiencePerFacetPillOverlayProps {
  /**
   * Live Cytoscape `Core` handle. `null` before the canvas mount
   * effect has run; the overlay early-exits to an empty wrapper in
   * that case. `<AudienceGraphView>` lifts its `cyInstanceRef` into a
   * `useState` slot (Decision §5 of the refinement) so this prop
   * becomes non-null on the second render and the overlay can
   * subscribe to events.
   */
  readonly cy: Core | null;
  /**
   * Reference to the Cytoscape mount container. Reserved for future
   * positioning-debug branches that may need to measure the
   * container's `getBoundingClientRect()` to refine the coordinate
   * transform. Today the overlay does not consume it — the per-element
   * `renderedBoundingBox` is already in the container's coordinate
   * space, and the `position: relative` wrapper ensures the overlay's
   * `inset-0` matches the canvas rectangle.
   */
  readonly containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Per-node placement record. The render path iterates over a snapshot
 * of these and emits one absolutely-positioned pill row per entry.
 */
interface PillRowPlacement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>;
}

/**
 * Vertical offset (px) above the node bounding-box top edge. Keeps the
 * pill row clear of the per-state border (up to 3px wide for disputed
 * nodes) plus a small breathing gap so the row reads as a distinct
 * surface from the node body.
 */
const PILL_ROW_OFFSET_Y = 6;

/**
 * Canonical reading order — matches the moderator's `FACET_RENDER_ORDER`
 * at `apps/moderator/src/graph/StatementNode.tsx`. The `shape` facet
 * (edges-only in v1) is excluded by the `Exclude<FacetName, never>`
 * pattern — the shell's `FacetName` is already the 3-valued union with
 * no `shape` member, so the type assertion is implicit.
 */
const FACET_RENDER_ORDER: readonly FacetName[] = ['wording', 'classification', 'substance'];

export function AudiencePerFacetPillOverlay({
  cy,
  containerRef,
}: AudiencePerFacetPillOverlayProps): ReactElement {
  // `containerRef` is reserved for future positioning-debug branches
  // (mirrors the participant's `OtherVotesOverlay` precedent). Reference
  // it explicitly so TypeScript's `noUnusedParameters` does not flag the
  // prop.
  void containerRef;
  const [placements, setPlacements] = useState<readonly PillRowPlacement[]>([]);
  // Singleton rAF handle. `null` when no frame is pending; a positive
  // number while a frame is scheduled. Drops re-entrant calls within
  // the same frame (Decision §4 — one commit per frame regardless of
  // how many events fire).
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (cy === null) return undefined;

    const commit = (): void => {
      frameRef.current = null;
      const next: PillRowPlacement[] = [];
      cy.nodes().forEach((node: NodeSingular) => {
        const facetStatuses = node.data('facetStatuses') as
          | Readonly<Partial<Record<FacetName, FacetStatus>>>
          | undefined;
        if (facetStatuses === undefined) return;
        // Skip nodes whose per-facet record is empty (consistent with
        // the moderator's empty-row omission and the participant's
        // empty-votes omission).
        let hasAny = false;
        for (const facet of FACET_RENDER_ORDER) {
          if (facetStatuses[facet] !== undefined) {
            hasAny = true;
            break;
          }
        }
        if (!hasAny) return;
        const bb = node.renderedBoundingBox();
        next.push({
          id: node.id(),
          x: (bb.x1 + bb.x2) / 2,
          y: bb.y1 - PILL_ROW_OFFSET_Y,
          facetStatuses,
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
    <div
      data-testid="audience-per-facet-pill-overlay"
      className="pointer-events-none absolute inset-0"
    >
      {placements.map((p) => (
        <div
          key={p.id}
          data-facet-pill-row=""
          data-element-id={p.id}
          style={{
            position: 'absolute',
            left: `${String(p.x)}px`,
            top: `${String(p.y)}px`,
            transform: 'translate(-50%, -100%)',
            display: 'flex',
            gap: '4px',
          }}
        >
          {FACET_RENDER_ORDER.map((facet) => {
            const status = p.facetStatuses[facet];
            if (status === undefined) return null;
            return <FacetPill key={facet} facet={facet} status={status} />;
          })}
        </div>
      ))}
    </div>
  );
}

export default AudiencePerFacetPillOverlay;
