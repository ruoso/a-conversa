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

import { AxiomMarkBadge, type AxiomMark } from '@a-conversa/shell';

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
  // Per refinement Decision §4: lazy-initialize a Set of seen
  // `${nodeId}:${participantId}` keys so that badges present when the
  // overlay first commits a non-empty placement snapshot do NOT
  // animate; only marks that arrive in a subsequent commit do.
  // `placements` starts as `[]` and is populated by the rAF-batched
  // commit inside the useEffect, so we wait for the first non-empty
  // snapshot before seeding — seeding on the literal first render
  // (when placements is still `[]`) would leave the set empty and
  // every later arrival, including the very first commit's contents,
  // would be (incorrectly) treated as "new".
  const seenMarkKeysRef = useRef<Set<string> | null>(null);

  if (seenMarkKeysRef.current === null && placements.length > 0) {
    const seeded = new Set<string>();
    placements.forEach((p) => {
      p.marks.forEach((m) => seeded.add(`${p.id}:${m.participantId}`));
    });
    seenMarkKeysRef.current = seeded;
  }
  const seenMarkKeys = seenMarkKeysRef.current;

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
          {p.marks.map((mark) => {
            const markKey = `${p.id}:${mark.participantId}`;
            const isNew = seenMarkKeys !== null && !seenMarkKeys.has(markKey);
            if (isNew) seenMarkKeys.add(markKey);
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

export default AudienceAxiomMarkOverlay;
