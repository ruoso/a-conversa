// `<OtherVotesOverlay>` — React DOM overlay painting one absolutely-
// positioned dot row per Cytoscape element with non-empty
// `data.otherVotes`. Sibling of the Cytoscape canvas mount inside the
// `participant-graph-root` positioning ancestor.
//
// Refinement: tasks/refinements/participant-ui/part_other_vote_indicators_canvas_dots.md
//              (Decision §1 — React DOM overlay positioned via
//              `cy.elements().renderedPosition()` / `.renderedBoundingBox()`
//              / `.midpoint()`; the alternatives — Cytoscape compound
//              nodes (B) and `background-image` data URLs (C) — were
//              rejected at refinement time and remain rejected.
//              Decision §3 — below-center anchor for nodes
//              (`renderedBoundingBox().y2 + 4px`, `translateX(-50%)`
//              centring); model-coords midpoint for edges, transformed
//              into screen-coords via `cy.pan()` + `cy.zoom()`; the
//              overlay root is absolute inside the `participant-graph-root`
//              which becomes `position: relative` so the inset rectangle
//              matches the canvas rectangle. Decision §4 — per-arm color
//              dot only (`bg-emerald-500` for agree, `bg-rose-500` for
//              dispute), no per-participant ring color, no per-voter
//              name label, no aria-label (the DOM mirror is the
//              load-bearing aria seam). Decision §5 — render every voter,
//              no cap, first-vote-arrival order via direct iteration over
//              `data.otherVotes`. Decision §6 — rAF-batched re-renders
//              subscribed to `cy.on('render pan zoom resize', ...)` +
//              `cy.on('position', 'node', ...)` +
//              `cy.on('add remove data', ...)`; singleton-handle batching
//              drops re-entrant scheduling within the same frame; the
//              happy-dom rAF polyfill (in `cytoscapeTestEnv`) backs the
//              flow under Vitest. Decision §8 — this is a SECOND DOM
//              surface; the predecessor's DOM mirror remains as-is.)
// ADRs:        0004 (Cytoscape.js for the participant tablet — the
//              `renderedPosition` / `renderedBoundingBox` / `midpoint`
//              + `cy.on('pan zoom render', cb)` / `cy.on('position',
//              'node', cb)` vocabulary is canonical Cytoscape API; no
//              new dependency); 0022 (no throwaway verifications — the
//              behaviour is pinned by `OtherVotesOverlay.test.tsx` AND
//              the 8th block of `tests/e2e/participant-graph-render.spec.ts`).
//
// The overlay is a `pointer-events: none` layer so clicks pass through
// to the underlying Cytoscape canvas. It is NOT `aria-hidden`: the
// visual is user-facing. The DOM mirror (the predecessor's
// `<ul data-other-votes>` nested inside `<li participant-node-status>` /
// `<li participant-edge-status>`) remains the aria-hidden test seam;
// this overlay and the mirror are two renderings of the same per-voter
// data source (`data.otherVotes` per Cytoscape element).

import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import type { Core, EdgeSingular, NodeSingular } from 'cytoscape';

import type { OtherVote } from './otherVotes';

export interface OtherVotesOverlayProps {
  /**
   * Live Cytoscape `Core` handle. `null` before the canvas mount
   * effect has run; the overlay early-exits to an empty wrapper in
   * that case. The container of `<GraphView>` lifts its `cyInstanceRef`
   * into a `useState` slot (Decision §2 of the refinement) so this
   * prop becomes non-null on the second render and the overlay can
   * subscribe to events.
   */
  readonly cy: Core | null;
  /**
   * Reference to the Cytoscape mount container. Reserved for future
   * positioning-debug branches that may need to measure the
   * container's `getBoundingClientRect()` to refine the coordinate
   * transform (e.g. when the participant surface grows nested
   * scroll containers). Today the overlay does not consume it — the
   * Cytoscape per-element `renderedBoundingBox` is already in the
   * container's coordinate space, and the `position: relative`
   * `participant-graph-root` ensures the overlay's `inset-0` matches
   * the canvas rectangle.
   */
  readonly containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Per-element placement record. The render path iterates over a
 * snapshot of these and emits one absolutely-positioned dot row per
 * entry.
 */
interface DotPlacement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly votes: readonly OtherVote[];
}

/**
 * Per-arm dot classNames. Matches the participant own-vote palette
 * (Decision §3 of `part_own_vote_indicators`) and the moderator's
 * `bg-emerald-500` / `bg-rose-500` per-arm convention. The `inline-block`
 * shape keeps the dots row-flowing inside the `display: flex` parent;
 * `w-2 h-2 rounded-full` produces an 8px circle that fits comfortably
 * under a 200px-wide node bounding box even with 10 voters in the row.
 */
const DOT_AGREE_CLASS = 'inline-block w-2 h-2 rounded-full bg-emerald-500';
const DOT_DISPUTE_CLASS = 'inline-block w-2 h-2 rounded-full bg-rose-500';

/**
 * Vertical offset (px) below the node bounding-box bottom edge. Keeps
 * the dot row clear of the per-status border (up to 3px wide for
 * axiom-marked + diagnosed nodes) plus a small breathing gap so the
 * row reads as a distinct surface from the node body.
 */
const NODE_DOTS_OFFSET_Y = 4;

export function OtherVotesOverlay({ cy, containerRef }: OtherVotesOverlayProps): ReactElement {
  // The `containerRef` prop is reserved for future positioning-debug
  // branches (Decision §6 — the per-element `renderedBoundingBox` is
  // already in the container's coordinate space, so no further
  // translation is needed today; the prop stays on the API for the
  // Acceptance criteria to pin and for a future polish leaf to use).
  // Reference it explicitly so TypeScript's `noUnusedParameters` does
  // not flag the prop.
  void containerRef;
  const [placements, setPlacements] = useState<readonly DotPlacement[]>([]);
  // Singleton rAF handle. `null` when no frame is pending; a positive
  // number while a frame is scheduled. Drops re-entrant calls within
  // the same frame (Decision §6 — one commit per frame regardless of
  // how many events fire).
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (cy === null) return undefined;

    const commit = (): void => {
      frameRef.current = null;
      const next: DotPlacement[] = [];
      cy.nodes().forEach((node: NodeSingular) => {
        const votes = node.data('otherVotes') as readonly OtherVote[] | undefined;
        if (votes === undefined || votes.length === 0) return;
        const bb = node.renderedBoundingBox();
        next.push({
          id: node.id(),
          x: (bb.x1 + bb.x2) / 2,
          y: bb.y2 + NODE_DOTS_OFFSET_Y,
          votes,
        });
      });
      cy.edges().forEach((edge: EdgeSingular) => {
        const votes = edge.data('otherVotes') as readonly OtherVote[] | undefined;
        if (votes === undefined || votes.length === 0) return;
        // Cytoscape's `edge.midpoint()` returns the midpoint in
        // MODEL coordinates (not rendered). Convert to screen-coords
        // via the per-instance `pan()` + `zoom()` so the overlay
        // dot row sits at the edge midpoint in the same coordinate
        // space the node `renderedBoundingBox` returned above.
        const mid = edge.midpoint();
        const pan = cy.pan();
        const zoom = cy.zoom();
        next.push({
          id: edge.id(),
          x: mid.x * zoom + pan.x,
          y: mid.y * zoom + pan.y,
          votes,
        });
      });
      setPlacements(next);
    };

    const scheduleUpdate = (): void => {
      if (frameRef.current !== null) return; // already scheduled this frame
      frameRef.current = requestAnimationFrame(commit);
    };

    // Initial paint — the cy mount may already have elements by this
    // point (the `<GraphView>` element-sync effect runs on the same
    // tick as the cy mount effect).
    scheduleUpdate();

    // Decision §6 — the five-event-category subscription set covers:
    //   `render`          — Cytoscape re-paint (general "something moved").
    //   `pan` / `zoom`    — viewport transform changed.
    //   `resize`          — canvas `<div>` bounds changed.
    //   `position` (node) — per-element position update (layout settled).
    //   `add remove data` — element set changed; `data` catches the
    //                       `otherVotes` field mutating on an existing
    //                       element when a new vote arrives and the
    //                       projection mints a fresh data record.
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
      data-testid="participant-other-votes-overlay"
      className="pointer-events-none absolute inset-0"
    >
      {placements.map((p) => (
        <div
          key={p.id}
          data-canvas-vote-dots=""
          data-element-id={p.id}
          style={{
            position: 'absolute',
            left: `${String(p.x)}px`,
            top: `${String(p.y)}px`,
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '2px',
          }}
        >
          {p.votes.map((v) => (
            <span
              key={v.participantId}
              data-canvas-vote-dot=""
              data-voter-id={v.participantId}
              data-vote={v.choice}
              className={v.choice === 'agree' ? DOT_AGREE_CLASS : DOT_DISPUTE_CLASS}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
