// `useCanvasFocusEffect` — the consumer half of the canvas-focus
// command channel.
//
// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_focus_action.md
//             (Constraint §2, Decision §D2)
//
// The diagnostic flag pane lives in the right sidebar, OUTSIDE the
// `<ReactFlowProvider>`, so it cannot call `useReactFlow().fitView()`
// directly. Instead it dispatches a `focusRequest` onto `useUiStore`
// (`requestCanvasFocus`). This hook — consumed by one line in
// `GraphCanvasPaneInner`, which IS inside the provider — subscribes to
// that request and re-frames the viewport when the request's monotonic
// `nonce` advances.
//
// The `lastHandledNonce` ref (not a store write-back) is what makes the
// effect idempotent and StrictMode-safe: the canvas never mutates the
// store it reads (Decision §D2). The rAF-then-`fitView` shape mirrors
// the existing `handleTidyUp` precedent (`GraphCanvasPane.tsx`), so
// ReactFlow's internal node-position store is settled before the
// bounding box is computed.

import { useEffect, useRef } from 'react';
import type { ReactFlowInstance } from 'reactflow';

import { useUiStore } from '../stores/uiStore.js';

// `fitView` framing — looser than tidy-up's `0.1` so the focused region
// isn't edge-to-edge, and a short animated pan to orient the moderator
// (tidy-up uses `0` because it re-frames the whole graph). Tunable
// details, not contract (Constraint §3).
const FOCUS_PADDING = 0.2;
const FOCUS_DURATION = 250;

export function useCanvasFocusEffect(reactFlow: ReactFlowInstance): void {
  const focusRequest = useUiStore((state) => state.focusRequest);
  const lastHandledNonce = useRef<number | null>(null);

  useEffect(() => {
    if (focusRequest === null) return;
    // Ref-guard: only re-frame when the nonce advances past the last one
    // we handled. A same-nonce re-render (StrictMode double-invoke, an
    // unrelated store update) is a no-op.
    if (lastHandledNonce.current === focusRequest.nonce) return;
    lastHandledNonce.current = focusRequest.nonce;

    // Frame the affected NODES; the affected-edge set never widens the
    // region beyond them (Constraint §4). Filter to ids ReactFlow
    // currently knows so a stale request can't ask `fitView` to frame a
    // node that has since left the graph.
    const nodes = focusRequest.nodeIds
      .filter((id) => reactFlow.getNode(id) !== undefined)
      .map((id) => ({ id }));
    if (nodes.length === 0) return;

    const handle = requestAnimationFrame(() => {
      reactFlow.fitView({ nodes, padding: FOCUS_PADDING, duration: FOCUS_DURATION });
    });
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [focusRequest, reactFlow]);
}
