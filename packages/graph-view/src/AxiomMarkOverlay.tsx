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
// Refinement: tasks/refinements/audience/aud_axiom_mark_animation.md
//              (Decision §1 — CSS `@keyframes` on a React-keyed
//              `<span data-axiom-mark-anim>` wrapper, NOT a JS-driven
//              tween nor a motion-framework dependency; the wrapper's
//              keyed reconciliation is the per-element lifecycle.
//              Decision §3 — animation lives on the audience-side
//              wrapper only; the shell `<AxiomMarkBadge>` is unchanged
//              so its cross-surface contract stays pure. Decision §4 —
//              `seenMarkKeysRef = useRef<Set<string> | null>(null)` is
//              lazily seeded from the first render's placement set so
//              badges present at initial mount do NOT animate; only
//              post-mount arrivals get the `aud-axiom-mark-land`
//              class. Decision §5 — 350 ms ease-out (cubic-bezier(0.16,
//              1, 0.3, 1)) duration is the initial constant; the
//              `aud_animation_pacing` sibling task revisits it across
//              the animation set. Decision §6 — reduced-motion
//              suppression is in CSS, not TS — the class is always
//              emitted, the `@media (prefers-reduced-motion: reduce)`
//              clause in `apps/audience/src/index.css` no-ops it.)
// Refinement: tasks/refinements/audience/aud_dom_overlay_extraction.md
//              (Decisions §1–§6 — the rAF-batched commit + three-event
//              subscription set + cleanup branch lift into
//              `useCytoscapeOverlayPlacements<P>`; the lazy-init-on-
//              non-empty seen-Set gate lifts into `useSeenKeysGate<K>`
//              (Decision §4 preserves the
//              `seenRef.current === null && currentKeys.length > 0`
//              seeding timing). The component keeps its render shape
//              and its `commitAxiomBadgePlacements` pure iteration
//              function; the hooks own lifecycle and gating state.)
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

import { type ReactElement, type RefObject } from 'react';
import type { Core, NodeSingular } from 'cytoscape';

import { AxiomMarkBadge, type AxiomMark } from '@a-conversa/shell';

import { useCytoscapeOverlayPlacements, useSeenKeysGate } from './cytoscapeOverlayHooks.js';

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
  /**
   * Cytoscape viewport zoom captured at commit time. The badge row is a
   * DOM overlay sized in fixed CSS pixels, but the node geometry it
   * anchors to (`renderedBoundingBox`) scales with the viewport zoom.
   * The render path applies `scale(zoom)` about the row's top-center
   * anchor so the badges keep a constant size relative to the zoom
   * instead of ballooning when zoomed out (mirrors `PerFacetPillOverlay`).
   */
  readonly zoom: number;
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
  const placements = useCytoscapeOverlayPlacements<BadgeRowPlacement>(
    cy,
    commitAxiomBadgePlacements,
  );
  const markKeys = placements.flatMap((p) => p.marks.map((m) => `${p.id}:${m.participantId}`));
  const isNewMark = useSeenKeysGate(markKeys);

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
            // Anchor the row's top-center at (x, y), then scale by the
            // viewport zoom about that point (`transform-origin: center
            // top`) so the badges stay glued below the node and keep a
            // constant size relative to the zoom. Mirrors the pill row.
            transform: `translate(-50%, 0) scale(${String(p.zoom)})`,
            transformOrigin: 'center top',
            display: 'flex',
            gap: '4px',
          }}
        >
          {p.marks.map((mark) => {
            const markKey = `${p.id}:${mark.participantId}`;
            const isNew = isNewMark(markKey);
            return (
              <span
                key={mark.participantId}
                data-axiom-mark-anim=""
                className={isNew ? 'aud-axiom-mark-land' : ''}
              >
                <AxiomMarkBadge mark={mark} />
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function commitAxiomBadgePlacements(cy: Core): readonly BadgeRowPlacement[] {
  const next: BadgeRowPlacement[] = [];
  // Snapshot the viewport zoom once per commit so the offset gap and the
  // row scale track the node at the current zoom (`renderedBoundingBox`
  // is already in zoomed/rendered pixels).
  const zoom = cy.zoom();
  cy.nodes().forEach((node: NodeSingular) => {
    const marks = node.data('axiomMarks') as readonly AxiomMark[] | undefined;
    if (marks === undefined || marks.length === 0) return;
    const bb = node.renderedBoundingBox();
    next.push({
      id: node.id(),
      x: (bb.x1 + bb.x2) / 2,
      y: bb.y2 + AXIOM_BADGE_ROW_OFFSET_Y * zoom,
      zoom,
      marks,
    });
  });
  return next;
}

export default AudienceAxiomMarkOverlay;
