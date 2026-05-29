// `<AudienceWithdrawalHaloOverlay>` — React DOM overlay painting one
// absolutely-positioned rose-tinted halo `<span>` per Cytoscape node
// whose `data.rollupStatus` resolves to `'disputed'`. The halo is a
// pure CSS-driven decoration (rose-600 radial gradient `background-
// image` + `opacity: 0` rest state); React's job is to position the
// `<span>` at the node's `renderedBoundingBox()` midpoint and gate the
// one-shot `aud-withdrawal` animation class on the first observation
// of each disputed-rollup node per session.
//
// Refinement: tasks/refinements/audience/aud_withdrawal_animation.md
//              (Decision §1 — CSS `@keyframes` on a React-keyed halo
//              `<span>` in a NEW DOM-overlay sibling of the Cytoscape
//              canvas, NOT a JS-driven tween, NOT a motion-framework
//              dependency, NOT a `cy.animate()` call. The node body
//              lives on the Cytoscape canvas, not in any React
//              overlay, so the in-place-wrap option (the pattern
//              `aud_proposed_to_agreed_animation` used) is unreachable
//              and a new halo overlay is the direct structural mirror
//              of the `aud_node_appear_animation` predecessor.
//              Decision §2 — a NEW overlay file, not a fold into
//              `<AudienceNodeAppearOverlay>`. One overlay paints one
//              DOM-overlay class of decoration: node-appear paints
//              "this node is new"; this overlay paints "this node just
//              landed in dispute". Folding would mix two semantic
//              classes (arrival vs regression) and obscure the
//              symmetry of the `aud_animations.*` task group.
//              Decision §4 — `useSeenKeysGate` keyed by `nodeId` over
//              currently-`'disputed'`-rollup entries (target-status-
//              keyed, mirroring `aud_proposed_to_agreed_animation`'s
//              posture). `commitWithdrawalPlacements` early-returns
//              for non-disputed nodes so `placements.map(p => p.id)`
//              yields only currently-disputed IDs; the gate's lazy-
//              init-on-non-empty contract seeds with whatever nodes
//              are already disputed at audience-join, so mid-session
//              joiners do NOT see retrospective animation. Subsequent
//              disputed-rollup arrivals fire the halo exactly once per
//              (node, session) pair. A node that flips out of
//              `'disputed'` and back IS NOT re-animated: the seen-Set
//              only grows, so the conservative "first observation per
//              session" gate captures structural-event semantics.
//              Decision §5 — 450 ms with `cubic-bezier(0.16, 1, 0.3,
//              1)` ("emphasized decelerate") with `forwards` fill;
//              parity with the node-appear halo's 450 ms because the
//              halo geometry is identical (96px square, radial
//              gradient fading at 75%). `aud_animation_pacing` will
//              revisit the constant alongside the other animation
//              siblings'.
//              Decision §6 — reduced-motion suppression is in CSS
//              (`@media (prefers-reduced-motion: reduce)` clause in
//              `apps/audience/src/index.css`), not in TS — the class
//              is always emitted by the render path. Playwright
//              deferred to `aud_url_routing.aud_session_url` (eighth
//              refinement on that inherited-debt chain).)
// Refinement: tasks/refinements/audience/aud_dom_overlay_extraction.md
//              (Decisions §1–§6 — the shared hooks
//              `useCytoscapeOverlayPlacements<P>` and
//              `useSeenKeysGate<K>` are consumed verbatim; this leaf
//              is the second new caller of both hooks since the
//              extraction landed.)
// Refinement: tasks/refinements/audience/aud_disputed_styling.md
//              (The static rose-600 (`#e11d48` / rose-600) border /
//              line-color paint at `apps/audience/src/graph/stylesheet.ts`
//              `node[rollupStatus = 'disputed']` + `edge[rollupStatus
//              = 'disputed']` is the steady state this halo fades
//              toward. The halo's radial-gradient is sampled from the
//              same `STATE_COLORS.disputed` so the pulse reads as "of
//              the disputed-state surface" and the post-animation
//              steady state lands cleanly on the static rose-600
//              border.)
// ADRs:        0004 (Cytoscape.js — `renderedBoundingBox` +
//              `cy.on(...)` vocabulary is canonical Cytoscape API, no
//              new dep);
//              0022 (no throwaway verifications — pinned by
//              `WithdrawalHaloOverlay.test.tsx`);
//              0026 (micro-frontend root app — the overlay ships
//              inside the audience artifact);
//              0027 (entity / facet layers are strictly separate —
//              the rollup transition to `'disputed'` is an entity-
//              layer event; the halo paints on top of the entity
//              body, orthogonal to the per-facet pill row and the
//              per-participant axiom-mark badge row).
//
// The overlay is a `pointer-events: none` + `aria-hidden="true"`
// layer: the halo is a pure visual decoration, screen readers narrate
// the underlying node via Cytoscape's own a11y plumbing.

import { type ReactElement, type RefObject } from 'react';
import type { Core, NodeSingular } from 'cytoscape';

import { useCytoscapeOverlayPlacements, useSeenKeysGate } from './cytoscapeOverlayHooks.js';

export interface AudienceWithdrawalHaloOverlayProps {
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
 * Per-node placement record. Only nodes whose current
 * `data.rollupStatus` is `'disputed'` contribute a placement; the
 * commit function's early-return filter is what gives
 * `useSeenKeysGate` its target-status-keyed posture (per Decision
 * §4).
 */
interface WithdrawalHaloPlacement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export function AudienceWithdrawalHaloOverlay({
  cy,
  containerRef,
}: AudienceWithdrawalHaloOverlayProps): ReactElement {
  void containerRef;
  const placements = useCytoscapeOverlayPlacements<WithdrawalHaloPlacement>(
    cy,
    commitWithdrawalPlacements,
  );
  const disputedNodeIds = placements.map((p) => p.id);
  const isNewDisputedNode = useSeenKeysGate(disputedNodeIds);

  return (
    <div
      data-testid="audience-withdrawal-halo-overlay"
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      {placements.map((p) => {
        const isNew = isNewDisputedNode(p.id);
        return (
          <span
            key={p.id}
            data-withdrawal-anim=""
            data-element-id={p.id}
            className={isNew ? 'aud-withdrawal' : ''}
            style={{
              position: 'absolute',
              left: `${String(p.x)}px`,
              top: `${String(p.y)}px`,
              transform: 'translate(-50%, -50%)',
            }}
          />
        );
      })}
    </div>
  );
}

function commitWithdrawalPlacements(cy: Core): readonly WithdrawalHaloPlacement[] {
  const next: WithdrawalHaloPlacement[] = [];
  cy.nodes().forEach((node: NodeSingular) => {
    if (node.data('rollupStatus') !== 'disputed') return;
    const bb = node.renderedBoundingBox();
    next.push({
      id: node.id(),
      x: (bb.x1 + bb.x2) / 2,
      y: (bb.y1 + bb.y2) / 2,
    });
  });
  return next;
}

export default AudienceWithdrawalHaloOverlay;
