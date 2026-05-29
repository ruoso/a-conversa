// `<AudienceDecompositionFadeOverlay>` — React DOM overlay painting one
// absolutely-positioned slate-tinted halo `<span>` per Cytoscape node
// whose `data.decomposed` is truthy (stamped by `projectGraph` at
// commit of a `decompose` / `interpretive-split` proposal targeting the
// node as parent). The halo is a pure CSS-driven decoration (slate-700
// radial gradient `background-image` + `opacity: 0` rest state);
// React's job is to position the `<span>` at the node's
// `renderedBoundingBox()` midpoint and gate the one-shot
// `aud-decomposition` animation class on the first observation of each
// decomposed-parent node per session.
//
// Refinement: tasks/refinements/audience/aud_decomposition_animation.md
//              (Decision §1 — CSS `@keyframes` on a React-keyed halo
//              `<span>` in a NEW DOM-overlay sibling of the Cytoscape
//              canvas, NOT a JS-driven tween, NOT a motion-framework
//              dependency, NOT a `cy.animate()` call. The parent body
//              lives on the Cytoscape canvas; the new halo overlay is
//              the direct structural mirror of the
//              `aud_withdrawal_animation` predecessor and the
//              `aud_diagnostic_fire_animation` sibling.
//              Decision §2 — `projectGraph` stamps `data.decomposed:
//              true` on the parent node at commit; this overlay reads
//              the cytoscape data field via `node.data('decomposed')`.
//              The flag is monotonic — committed decompositions are
//              structurally permanent per methodology.
//              Decision §3 — the post-animation steady-state visual
//              (`opacity: 0.15` on the parent body) lives in the
//              cytoscape stylesheet entry `node[?decomposed]`, not in
//              this overlay. The halo is the temporal cue; the body
//              snap is masked by the halo's expanding ring.
//              Decision §4 — `useSeenKeysGate` keyed by `nodeId` over
//              currently-`decomposed: true` entries (target-state-
//              keyed, mirroring the withdrawal halo's posture).
//              `commitDecompositionPlacements` early-returns for nodes
//              without `decomposed: true` so `placements.map(p => p.id)`
//              yields only currently-decomposed IDs; the gate's lazy-
//              init-on-non-empty contract seeds with whatever nodes
//              are already decomposed at audience-join, so mid-session
//              joiners do NOT see retrospective animation. Subsequent
//              decompose / interpretive-split commits fire the halo
//              exactly once per (node, session) pair. Because the flag
//              is monotonic, no flip-out gating is needed.
//              Decision §5 — synchronous local-ref seed (inline, NOT
//              the shared hook) at first render where
//              `placements.length > 0`, per the
//              `aud_diagnostic_fire_animation_seeding_alignment`
//              precedent on `DiagnosticFireOverlay.tsx`. Functionally
//              equivalent to `useSeenKeysGate` here because the
//              `data.decomposed` field IS the source-of-truth snapshot
//              read synchronously from cytoscape at the same render
//              tick the projection lands.
//              Decision §6 — `var(--aud-anim-halo-ms)` (450 ms) +
//              `var(--aud-anim-easing)` + `forwards` fill via the
//              `.aud-decomposition` utility class consumed in
//              `apps/audience/src/index.css`. Halo tier parity with
//              node-appear, withdrawal, and diagnostic-fire because
//              the halo geometry is identical (96px square, slate-
//              tinted radial gradient).
//              Decision §7 — reduced-motion suppression is in CSS
//              (`@media (prefers-reduced-motion: reduce)` clause in
//              `apps/audience/src/index.css`), not in TS — the class
//              is always emitted by the render path. Playwright
//              deferred to `aud_url_routing.aud_session_url` (eleventh
//              refinement on that inherited-debt chain).)
// Refinement: tasks/refinements/audience/aud_dom_overlay_extraction.md
//              (Decisions §1–§6 — the shared hook
//              `useCytoscapeOverlayPlacements<P>` is consumed verbatim;
//              this leaf is the sixth NEW caller of the placements
//              hook. The `useSeenKeysGate<K>` hook is bypassed in
//              favour of the synchronous local-ref seed pattern per
//              Decision §5 above.)
// ADRs:        0004 (Cytoscape.js — `renderedBoundingBox` is canonical
//              API; no new dep);
//              0022 (no throwaway verifications — pinned by
//              `DecompositionFadeOverlay.test.tsx`);
//              0026 (micro-frontend root app — overlay ships inside
//              the audience artifact);
//              0027 (entity / facet layers are strictly separate —
//              decomposition is an entity-layer structural event; the
//              halo decorates entity-layer node bodies, orthogonal to
//              the per-facet pill row and the axiom-mark badge row).
//
// The overlay is a `pointer-events: none` + `aria-hidden="true"`
// layer: the halo is a pure visual decoration, screen readers narrate
// the underlying node via Cytoscape's own a11y plumbing.

import { useRef, type ReactElement, type RefObject } from 'react';
import type { Core, NodeSingular } from 'cytoscape';

import { useCytoscapeOverlayPlacements } from './cytoscapeOverlayHooks.js';

export interface AudienceDecompositionFadeOverlayProps {
  /**
   * Live Cytoscape `Core` handle. `null` before the canvas mount
   * effect has run; the overlay early-exits to an empty wrapper in
   * that case.
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
 * `data.decomposed` is `true` contribute a placement; the commit
 * function's early-return filter is what gives the gate its
 * target-state-keyed posture (per Decision §4).
 */
interface DecompositionPlacement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export function AudienceDecompositionFadeOverlay({
  cy,
  containerRef,
}: AudienceDecompositionFadeOverlayProps): ReactElement {
  void containerRef;
  const placements = useCytoscapeOverlayPlacements<DecompositionPlacement>(
    cy,
    commitDecompositionPlacements,
  );
  // Synchronous local-ref seed-from-first-non-empty-placements per
  // Decision §5 (mirror of `aud_diagnostic_fire_animation_seeding_alignment`).
  // On the first render where `placements.length > 0`, every currently-
  // decomposed node id is absorbed into the seen-Set (no retrospective
  // animation for parents already decomposed at audience-join).
  // Subsequent decomposition commits fire the halo exactly once per
  // (node, session) pair: `isNewDecomposition` adds the new id and
  // returns true.
  const seenRef = useRef<Set<string> | null>(null);
  if (seenRef.current === null && placements.length > 0) {
    seenRef.current = new Set<string>(placements.map((p) => p.id));
  }
  const isNewDecomposition = (id: string): boolean => {
    const seen = seenRef.current;
    if (seen === null) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  };

  return (
    <div
      data-testid="audience-decomposition-fade-overlay"
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      {placements.map((p) => {
        const isNew = isNewDecomposition(p.id);
        return (
          <span
            key={p.id}
            data-decomposition-anim=""
            data-element-id={p.id}
            className={isNew ? 'aud-decomposition' : ''}
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

function commitDecompositionPlacements(cy: Core): readonly DecompositionPlacement[] {
  const next: DecompositionPlacement[] = [];
  cy.nodes().forEach((node: NodeSingular) => {
    if (node.data('decomposed') !== true) return;
    const bb = node.renderedBoundingBox();
    next.push({
      id: node.id(),
      x: (bb.x1 + bb.x2) / 2,
      y: (bb.y1 + bb.y2) / 2,
    });
  });
  return next;
}

export default AudienceDecompositionFadeOverlay;
