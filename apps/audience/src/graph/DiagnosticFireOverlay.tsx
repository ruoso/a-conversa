// `<AudienceDiagnosticFireOverlay>` — React DOM overlay painting one
// absolutely-positioned amber-tinted halo `<span>` per (active
// diagnostic, affected node) pair. The halo is a pure CSS-driven
// decoration (radial gradient + `opacity: 0` rest state) with a one-
// shot `@keyframes` entrance class gated by `useSeenKeysGate` keyed on
// the composite `${identityKey}\0${nodeId}` so initially-active
// diagnostics at audience-join do NOT animate and re-fires of the
// same (identityKey, nodeId) pair after a clear do NOT re-animate.
// Two severity-specific classes: `aud-diagnostic-fire-blocking` (amber-
// 700, for cycle + contradiction) and `aud-diagnostic-fire-advisory`
// (amber-400, for multi-warrant + dangling-claim + coherency-hint).
//
// Refinement: tasks/refinements/audience/aud_diagnostic_fire_animation.md
//              (Decision §1 — CSS `@keyframes` on a React-keyed halo
//              `<span>` in a NEW DOM-overlay sibling of the Cytoscape
//              canvas, NOT a JS-driven tween, NOT a motion-framework
//              dependency, NOT `cy.animate()`. Decision §2 — a NEW
//              overlay file, sixth in the audience's overlay siblings
//              row, NOT a fold into `<AudienceWithdrawalHaloOverlay>`:
//              the diagnostic-fire surface and the disputed-rollup
//              regression surface are distinct semantic classes.
//              Decision §3 — third-caller port of the per-app
//              `diagnosticHighlights.ts` helpers + the
//              `activeDiagnostics` WS-store extension; shell lift
//              deferred to `shell_diagnostic_highlights_extract`.
//              Decision §3a — `useCytoscapeOverlayPlacements` is given
//              the additive `triggers` parameter so a change in the
//              WS-store-derived `tuples` re-runs the commit closure
//              without an imperative cy-event side-channel.
//              Decision §4 — `useSeenKeysGate` keyed by the composite
//              `${identityKey}\0${nodeId}` over the currently-active
//              (diagnostic, node) pairs. The first non-empty commit
//              seeds with whatever (identityKey, nodeId) pairs are
//              already active at audience-join (mid-session joiners
//              do NOT see retrospective animation for diagnostics
//              they missed). Subsequent fires animate exactly once
//              per (identityKey, nodeId, session); a clear+re-fire
//              of the SAME identity does NOT re-animate (the seen-
//              Set only grows). A node affected by two distinct
//              diagnostics gets TWO halos with different composite
//              keys, each animating independently.
//              Decision §5 — 450 ms `cubic-bezier(0.16, 1, 0.3, 1)`
//              with `forwards` fill-mode; parity with the node-appear
//              and withdrawal halos because the halo geometry is
//              identical. Blocking and advisory differ ONLY in the
//              final scale (1.8 vs 1.7) — a subtle "blocking spreads
//              farther" differentiation. `aud_animation_pacing`
//              revisits the constant alongside the other animation
//              siblings'.
//              Decision §6 — `prefers-reduced-motion: reduce`
//              suppression is in CSS, not TS — the class is always
//              emitted. Playwright deferred to
//              `aud_url_routing.aud_session_url` (ninth refinement on
//              that inherited-debt chain).
//              Decision §7 — node halos ONLY. Edge halos (the
//              contradicting-edge surface for contradiction diagnostics
//              + coherency-hint self-contradicts edges) are deferred
//              to the named-future-task
//              `aud_diagnostic_edge_fire_animation`.
//              Decision §8 — the animation IS the audience's entire
//              diagnostic surface; no persistent steady-state border,
//              no `cy.data()` diagnosticSeverity stamping, no
//              `STYLESHEET` edit. The post-animation steady state is
//              a clean canvas.)
// Refinement: tasks/refinements/audience/aud_dom_overlay_extraction.md
//              (Decisions §1–§6 — the shared hooks
//              `useCytoscapeOverlayPlacements<P>` and `useSeenKeysGate<K>`
//              are consumed verbatim; this leaf is the third NEW caller
//              of both since the extraction landed.)
//
// ADRs:        0004 (Cytoscape.js — `renderedBoundingBox` is canonical
//              API; no new dep);
//              0022 (no throwaway verifications — pinned by
//              `DiagnosticFireOverlay.test.tsx`);
//              0026 (micro-frontend root app — overlay ships inside
//              the audience artifact);
//              0027 (entity / facet layers are strictly separate —
//              structural diagnostics live at the entity layer; the
//              halo decorates entity-layer node bodies, orthogonal to
//              the per-facet pill row above and the axiom-mark badge
//              row below).
//
// The overlay is a `pointer-events: none` + `aria-hidden="true"`
// layer: the halo is a pure visual decoration, screen readers narrate
// the underlying diagnostic via the future toast / banner surface
// (not yet shipped on the audience).

import { useMemo, type ReactElement, type RefObject } from 'react';
import type { Core, NodeSingular } from 'cytoscape';

import {
  flattenActiveDiagnosticsForFire,
  type DiagnosticFireTuple,
  type DiagnosticHighlightSeverity,
} from './diagnosticHighlights.js';
import { useCytoscapeOverlayPlacements, useSeenKeysGate } from './cytoscapeOverlayHooks.js';
import { useAudienceActiveDiagnostics } from '../ws/useAudienceActiveDiagnostics.js';

export interface AudienceDiagnosticFireOverlayProps {
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
  /**
   * Current session id parsed from the URL (`null` before the URL has
   * resolved to a `/sessions/<uuid>` path). The overlay subscribes to
   * the audience WS store's per-session `activeDiagnostics` map keyed
   * by this id; a `null` session resolves to the stable empty-map
   * sentinel.
   */
  readonly sessionId: string | null;
}

/**
 * Per-(diagnostic, node) placement record. The `compositeKey` drives
 * both React's keyed reconciliation and `useSeenKeysGate`'s gate.
 */
interface DiagnosticFirePlacement {
  readonly compositeKey: string;
  readonly identityKey: string;
  readonly nodeId: string;
  readonly severity: DiagnosticHighlightSeverity;
  readonly x: number;
  readonly y: number;
}

export function AudienceDiagnosticFireOverlay({
  cy,
  containerRef,
  sessionId,
}: AudienceDiagnosticFireOverlayProps): ReactElement {
  void containerRef;
  const active = useAudienceActiveDiagnostics(sessionId);
  // Flattened (identityKey, nodeId, severity) tuples. Memoized on
  // `active` so identity stability is the same as the Zustand
  // selector's: a no-change render returns the same array reference,
  // which keeps `triggers: [tuples]` stable across no-ops.
  const tuples = useMemo(() => flattenActiveDiagnosticsForFire(active), [active]);
  const placements = useCytoscapeOverlayPlacements<DiagnosticFirePlacement>(
    cy,
    (cyInstance) => commitDiagnosticFirePlacements(cyInstance, tuples),
    [tuples],
  );
  const compositeKeys = placements.map((p) => p.compositeKey);
  const isNewPair = useSeenKeysGate(compositeKeys);

  return (
    <div
      data-testid="audience-diagnostic-fire-overlay"
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      {placements.map((p) => {
        const isNew = isNewPair(p.compositeKey);
        const animClass = isNew
          ? p.severity === 'blocking'
            ? 'aud-diagnostic-fire-blocking'
            : 'aud-diagnostic-fire-advisory'
          : '';
        return (
          <span
            key={p.compositeKey}
            data-diagnostic-fire-anim=""
            data-severity={p.severity}
            data-identity-key={p.identityKey}
            data-node-id={p.nodeId}
            className={animClass}
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

function commitDiagnosticFirePlacements(
  cy: Core,
  tuples: readonly DiagnosticFireTuple[],
): readonly DiagnosticFirePlacement[] {
  const next: DiagnosticFirePlacement[] = [];
  for (const t of tuples) {
    const node = cy.getElementById(t.nodeId) as NodeSingular;
    // A node referenced by a diagnostic but absent from the current
    // cy snapshot is silently skipped — the methodology engine may
    // emit a `fired` whose nodes have not yet landed as events on
    // this client (rare but possible during initial replay drain).
    if (node.empty()) continue;
    const bb = node.renderedBoundingBox();
    next.push({
      compositeKey: `${t.identityKey}\0${t.nodeId}`,
      identityKey: t.identityKey,
      nodeId: t.nodeId,
      severity: t.severity,
      x: (bb.x1 + bb.x2) / 2,
      y: (bb.y1 + bb.y2) / 2,
    });
  }
  return next;
}

export default AudienceDiagnosticFireOverlay;
