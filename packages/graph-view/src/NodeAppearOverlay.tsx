// `<AudienceNodeAppearOverlay>` — React DOM overlay painting one
// absolutely-positioned halo `<span>` per Cytoscape node, on top of
// the canvas inside the `audience-graph-root-wrapper` positioning
// ancestor. The halo is a pure CSS-driven decoration (radial gradient
// `background-image` + `opacity: 0` rest state); React's job is to
// position the `<span>` at the node's `renderedBoundingBox()` midpoint
// and gate the one-shot `aud-node-appear` animation class.
//
// Refinement: tasks/refinements/audience/aud_node_appear_animation.md
//              (Decision §1 — CSS `@keyframes` on a React-keyed halo
//              overlay `<span>`, NOT a JS-driven tween, NOT a
//              motion-framework dependency, NOT a `cy.animate()` call
//              (Cytoscape canvas-side animation is rejected for the
//              same reasons the predecessor rejected it).
//              Decision §2 — verbatim reuse of the predecessor's
//              overlay shape (rAF-batched commit + three subscriptions
//              + lazy-init-on-non-empty-placements `useRef<Set>`); the
//              rule-of-three-or-four extraction is registered as the
//              named-future-task `aud_dom_overlay_extraction`.
//              Decision §3 — the overlay owns its own `seenNodeIdsRef`,
//              intentionally separate from `<AudienceGraphView>`'s
//              `knownNodeIdsRef` (different lifecycle: the GraphView
//              ref is mutated AFTER the React commit inside the
//              element-sync effect; the overlay ref is mutated DURING
//              the render path).
//              Decision §4 — `seenNodeIdsRef = useRef<Set<string> |
//              null>(null)` is lazily seeded from the FIRST non-empty
//              placement commit (NOT the literal first render —
//              `placements.length > 0` guard), so nodes present at
//              initial mount do NOT animate; only post-mount arrivals
//              get the `aud-node-appear` class.
//              Decision §5 — 450 ms `cubic-bezier(0.16, 1, 0.3, 1)`
//              ("emphasized decelerate") with `forwards` fill-mode
//              (the halo's rest state is invisible — the fade-to-zero
//              `to` keyframe must stick); slightly slower than the
//              axiom-mark badge's 350 ms because the halo's larger
//              geometry and centered-on-the-node placement benefit
//              from a slower entrance. `aud_animation_pacing` will
//              revisit the constant across the animation set.
//              Decision §6 — reduced-motion suppression is in CSS
//              (`@media (prefers-reduced-motion: reduce)` clause in
//              `apps/audience/src/index.css`), not in TS — the class
//              is always emitted by the render path.)
// Refinement: tasks/refinements/audience/aud_dom_overlay_extraction.md
//              (Decisions §1–§6 — the rAF-batched commit + three-event
//              subscription set + cleanup branch lift into
//              `useCytoscapeOverlayPlacements<P>`; the lazy-init-on-
//              non-empty seen-Set gate lifts into `useSeenKeysGate<K>`,
//              preserving the Decision §4 contract that initially-
//              present nodes do NOT animate while post-mount arrivals
//              do. The component keeps its render shape and its
//              `commitNodeAppearPlacements` pure iteration function.)
// ADRs:        0004 (Cytoscape.js — `renderedBoundingBox` +
//              `cy.on(...)` vocabulary is canonical Cytoscape API, no
//              new dep);
//              0022 (no throwaway verifications — pinned by
//              `NodeAppearOverlay.test.tsx`);
//              0026 (micro-frontend root app — the overlay ships
//              inside the audience artifact);
//              0027 (entity / facet layers are strictly separate —
//              node arrival is an entity-layer event; the halo paints
//              on top of the entity body, orthogonal to the per-facet
//              pill row and the per-participant axiom-mark badge row).
//
// The overlay is a `pointer-events: none` + `aria-hidden="true"`
// layer: the halo is a pure visual decoration, screen readers narrate
// the underlying node via Cytoscape's own a11y plumbing.

import { type CSSProperties, type ReactElement, type RefObject } from 'react';
import type { Core, NodeSingular } from 'cytoscape';

import { useCytoscapeOverlayPlacements, useSeenKeysGate } from './cytoscapeOverlayHooks.js';

/**
 * Style record for a halo `<span>`. The `--halo-zoom` custom property
 * carries the live Cytoscape viewport zoom; the audience stylesheet
 * sizes the halo box as `calc(96px * var(--halo-zoom, 1))` so the halo
 * scales with the node it sits on instead of staying a fixed 96px and
 * ballooning when zoomed out. The intersection type keeps strict-mode
 * TypeScript happy about the otherwise-unknown `--*` key.
 */
type HaloStyle = CSSProperties & Record<'--halo-zoom', string>;

export interface AudienceNodeAppearOverlayProps {
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
   * positioning-debug branches; today the overlay does not consume it.
   */
  readonly containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Per-node placement record. The render path iterates over a snapshot
 * of these and emits one absolutely-positioned halo `<span>` per
 * entry, centered on `(x, y)` via `transform: translate(-50%, -50%)`.
 */
interface NodeAppearPlacement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Cytoscape viewport zoom at commit time; drives `--halo-zoom`. */
  readonly zoom: number;
}

export function AudienceNodeAppearOverlay({
  cy,
  containerRef,
}: AudienceNodeAppearOverlayProps): ReactElement {
  void containerRef;
  const placements = useCytoscapeOverlayPlacements<NodeAppearPlacement>(
    cy,
    commitNodeAppearPlacements,
  );
  const nodeIds = placements.map((p) => p.id);
  const isNewNode = useSeenKeysGate(nodeIds);

  return (
    <div
      data-testid="audience-node-appear-overlay"
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      {placements.map((p) => {
        const isNew = isNewNode(p.id);
        const haloStyle: HaloStyle = {
          position: 'absolute',
          left: `${String(p.x)}px`,
          top: `${String(p.y)}px`,
          transform: 'translate(-50%, -50%)',
          '--halo-zoom': String(p.zoom),
        };
        return (
          <span
            key={p.id}
            data-node-appear-anim=""
            data-element-id={p.id}
            className={isNew ? 'aud-node-appear' : ''}
            style={haloStyle}
          />
        );
      })}
    </div>
  );
}

function commitNodeAppearPlacements(cy: Core): readonly NodeAppearPlacement[] {
  const next: NodeAppearPlacement[] = [];
  const zoom = cy.zoom();
  cy.nodes().forEach((node: NodeSingular) => {
    const bb = node.renderedBoundingBox();
    next.push({
      id: node.id(),
      x: (bb.x1 + bb.x2) / 2,
      y: (bb.y1 + bb.y2) / 2,
      zoom,
    });
  });
  return next;
}

export default AudienceNodeAppearOverlay;
