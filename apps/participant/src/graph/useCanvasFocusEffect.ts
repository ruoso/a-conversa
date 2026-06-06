// `useCanvasFocusEffect` — the consumer half of the participant's
// canvas-focus command channel.
//
// Refinement: tasks/refinements/participant-ui/part_diagnostic_focus.md
//             (Constraint §2, Decision §D2)
//
// The diagnostics list lives in the operate-route footer, a
// `ParticipantLayout` sibling of `main`, so it cannot reach the
// Cytoscape `Core` (which lives inside `<GraphView>` under `main`)
// directly. Instead it dispatches a `focusRequest` onto `useUiStore`
// (`requestCanvasFocus`). This hook — consumed by one line inside
// `<GraphView>` — subscribes to that request and re-frames the viewport
// when the request's monotonic `nonce` advances.
//
// The `lastHandledNonce` ref (not a store write-back) is what makes the
// effect idempotent and StrictMode-safe: the canvas never mutates the
// store it reads (Decision §D2). The `cy === null` guard sits BEFORE the
// ref touch, so a request that arrives before the instance lands (the
// tab-switch-then-mount path: a tap on the proposals tab switches to the
// graph tab, mounting `<GraphView>`, and `cyInstance` lands a render
// later) is handled once `cy` is non-null rather than dropped. This is
// the participant port of the moderator twin
// (`apps/moderator/src/graph/useCanvasFocusEffect.ts`), swapping the
// ReactFlow `fitView` body for the Cytoscape `cy.animate({ fit })` body
// (Constraint §2).

import { useEffect, useRef } from 'react';
import type { Core } from 'cytoscape';

import { useUiStore } from '../stores/uiStore';

// `fit` framing — a pixel `padding` (Cytoscape `fit` padding is in
// rendered pixels, unlike ReactFlow's `0..1` ratio) so the focused
// region isn't edge-to-edge, plus a short animated pan to orient the
// debater. Cytoscape's `fit` honors the instance's `[MIN_ZOOM,
// MAX_ZOOM]`, so a single-node region won't over-zoom (no manual clamp).
// Tunable details, not contract (Constraint §3).
const FOCUS_PADDING = 48;
const FOCUS_DURATION = 250;
const FOCUS_EASING = 'ease-out';

export function useCanvasFocusEffect(cy: Core | null): void {
  const focusRequest = useUiStore((state) => state.focusRequest);
  const lastHandledNonce = useRef<number | null>(null);

  useEffect(() => {
    if (focusRequest === null) return;
    // Guard `cy === null` BEFORE touching `lastHandledNonce`, so a
    // request that arrives before the instance lands (the
    // tab-switch-then-mount path) is handled on the first render where
    // `cy` becomes non-null, not silently dropped.
    if (cy === null) return;
    // Ref-guard: only re-frame when the nonce advances past the last one
    // we handled. A same-nonce re-render (StrictMode double-invoke, an
    // unrelated store update) is a no-op.
    if (lastHandledNonce.current === focusRequest.nonce) return;
    lastHandledNonce.current = focusRequest.nonce;

    // Frame the affected NODES; the affected-edge set never widens the
    // region beyond them (Constraint §4). Resolve each id to the live
    // Cytoscape node and filter out ids the instance doesn't currently
    // know, so a stale request can't ask `fit` to frame a node that has
    // since left the graph.
    let eles = cy.collection();
    for (const id of focusRequest.nodeIds) {
      const node = cy.getElementById(id);
      if (node.nonempty()) {
        eles = eles.union(node);
      }
    }
    if (eles.empty()) return;

    const handle = requestAnimationFrame(() => {
      cy.animate({
        fit: { eles, padding: FOCUS_PADDING },
        duration: FOCUS_DURATION,
        easing: FOCUS_EASING,
      });
    });
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [focusRequest, cy]);
}
