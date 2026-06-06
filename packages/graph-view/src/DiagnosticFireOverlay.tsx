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
// Refinement: tasks/refinements/audience/aud_diagnostic_fire_animation_seeding_alignment.md
//              (Decision §1 — the original `useSeenKeysGate(compositeKeys)`
//              call here was replaced with a local `useRef<Set<string>>`
//              seeded synchronously from the store-derived `tuples` on
//              first render. The shared hook's lazy-init contract is
//              correct for cy-driven overlay siblings whose
//              `currentKeys` derive from `cy.nodes()` / `cy.edges()`
//              mid-render, but it conflated "store hydration after
//              mount" with "first fire after mount" here — silently
//              swallowing the fresh-session-fire animation. The fix
//              transplants verbatim the pattern shipped by the edge
//              sibling `<AudienceDiagnosticEdgeFireOverlay>`. Decision §2
//              — no new ADR; this is a consequence of the data-flow
//              seam, not a fresh architectural commitment. Decision §3
//              — Vitest tests (c)/(d) lost their pre-seed workarounds.
//              Decision §4 — Playwright scenario `(10)` inline in
//              `tests/e2e/audience-live-session.spec.ts`.)
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

import { useMemo, useRef, type CSSProperties, type ReactElement, type RefObject } from 'react';
import type { Core, NodeSingular } from 'cytoscape';

import {
  flattenActiveDiagnosticsForFire,
  type DiagnosticFireTuple,
  type DiagnosticHighlightSeverity,
} from '@a-conversa/shell';
import type { DiagnosticPayload } from '@a-conversa/shared-types';
import { useCytoscapeOverlayPlacements } from './cytoscapeOverlayHooks.js';

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
   * Opaque per-render identity (the audience session id today). Scopes
   * the seen-key gate's composite key so two independently-mounted
   * renders of the same diagnostic identity animate independently.
   */
  readonly instanceKey: string;
  /**
   * The active-diagnostics map (identity key → payload) for this
   * render. Supplied by the host as a plain prop — the package reads
   * no store. An empty map yields no halos.
   */
  readonly active: ReadonlyMap<string, DiagnosticPayload>;
}

/**
 * Per-(diagnostic, node) placement record. The `compositeKey` drives
 * both React's keyed reconciliation and the local seen-Set gate.
 */
interface DiagnosticFirePlacement {
  readonly compositeKey: string;
  readonly identityKey: string;
  readonly nodeId: string;
  readonly severity: DiagnosticHighlightSeverity;
  readonly x: number;
  readonly y: number;
  /** Cytoscape viewport zoom at commit time; drives `--halo-zoom`. */
  readonly zoom: number;
}

/**
 * Style record for a halo `<span>`. The `--halo-zoom` custom property
 * carries the live Cytoscape viewport zoom; the audience stylesheet
 * sizes the halo as `calc(96px * var(--halo-zoom, 1))` so it scales with
 * the node instead of staying a fixed 96px and ballooning when zoomed
 * out. The intersection type keeps strict TypeScript happy about the
 * `--*` key.
 */
type HaloStyle = CSSProperties & Record<'--halo-zoom', string>;

export function AudienceDiagnosticFireOverlay({
  cy,
  containerRef,
  instanceKey,
  active,
}: AudienceDiagnosticFireOverlayProps): ReactElement {
  void containerRef;
  // Flattened (identityKey, nodeId, severity) tuples. Memoized on
  // `active` so identity stability is the same as the host store
  // selector's: a no-change render returns the same array reference,
  // which keeps `triggers: [tuples]` stable across no-ops.
  const tuples = useMemo(() => flattenActiveDiagnosticsForFire(active), [active]);
  // Seed the seen-Set synchronously on the FIRST render from the
  // prop-derived tuples, not lazily on the first non-empty placement
  // commit. Rationale: the host passes `active` synchronously at mount
  // time, so mid-session joiners with already-active diagnostics seed
  // their composite keys here (no retro animation), AND fresh sessions
  // (tuples empty at mount) seed with an empty set so the next arrival
  // is "new" and animates. The shared `useSeenKeysGate` cannot make
  // this distinction — it seeds on the first non-empty placement commit,
  // which conflates "store hydration after mount" with "first fire after
  // mount" and therefore swallows the fresh-session-fire animation.
  // Mirrors the edge sibling at `DiagnosticEdgeFireOverlay.tsx`; the
  // four cy-driven overlays (PerFacetPill, AxiomMark, NodeAppear,
  // Withdrawal) keep `useSeenKeysGate` since their `currentKeys` derive
  // synchronously from `cy.nodes()` — for them "first non-empty commit"
  // IS "first arrival".
  const seenKeysRef = useRef<Set<string> | null>(null);
  if (seenKeysRef.current === null) {
    seenKeysRef.current = new Set(
      tuples.map((t) => `${instanceKey}\0${t.identityKey}\0${t.nodeId}`),
    );
  }
  const isNewPair = (key: string): boolean => {
    const seen = seenKeysRef.current;
    if (seen === null) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const placements = useCytoscapeOverlayPlacements<DiagnosticFirePlacement>(
    cy,
    (cyInstance) => commitDiagnosticFirePlacements(cyInstance, instanceKey, tuples),
    [tuples],
  );

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
        const haloStyle: HaloStyle = {
          position: 'absolute',
          left: `${String(p.x)}px`,
          top: `${String(p.y)}px`,
          transform: 'translate(-50%, -50%)',
          '--halo-zoom': String(p.zoom),
        };
        return (
          <span
            key={p.compositeKey}
            data-diagnostic-fire-anim=""
            data-severity={p.severity}
            data-identity-key={p.identityKey}
            data-node-id={p.nodeId}
            className={animClass}
            style={haloStyle}
          />
        );
      })}
    </div>
  );
}

function commitDiagnosticFirePlacements(
  cy: Core,
  instanceKey: string,
  tuples: readonly DiagnosticFireTuple[],
): readonly DiagnosticFirePlacement[] {
  const next: DiagnosticFirePlacement[] = [];
  const zoom = cy.zoom();
  for (const t of tuples) {
    const node = cy.getElementById(t.nodeId) as NodeSingular;
    // A node referenced by a diagnostic but absent from the current
    // cy snapshot is silently skipped — the methodology engine may
    // emit a `fired` whose nodes have not yet landed as events on
    // this client (rare but possible during initial replay drain).
    if (node.empty()) continue;
    const bb = node.renderedBoundingBox();
    next.push({
      compositeKey: `${instanceKey}\0${t.identityKey}\0${t.nodeId}`,
      identityKey: t.identityKey,
      nodeId: t.nodeId,
      severity: t.severity,
      x: (bb.x1 + bb.x2) / 2,
      y: (bb.y1 + bb.y2) / 2,
      zoom,
    });
  }
  return next;
}

export default AudienceDiagnosticFireOverlay;
