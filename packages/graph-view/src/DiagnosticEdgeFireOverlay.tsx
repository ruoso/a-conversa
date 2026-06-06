// `<AudienceDiagnosticEdgeFireOverlay>` — React DOM overlay painting one
// absolutely-positioned amber-tinted halo `<span>` per (active
// diagnostic, affected edge) pair. The edge sibling of
// `<AudienceDiagnosticFireOverlay>`: the halo geometry is byte-identical
// (same CSS `@keyframes`, same severity-keyed gradient selectors, same
// 450 ms `cubic-bezier(0.16, 1, 0.3, 1)` decelerated entrance), but
// the iteration target is `cy.edges()` and the halo is placed at the
// rendered edge midpoint via `edge.renderedBoundingBox()` →
// `((x1+x2)/2, (y1+y2)/2)` — the canonical pattern
// `AnnotationOverlay.tsx` already uses for edge-annotation placement.
//
// Two diagnostic kinds emit non-empty `edges` arrays through
// `affectedEntities()`: `contradiction` (the contradicting-edge pair,
// `'blocking'` severity) and the `self-contradicts` sub-kind of
// `coherency-hint` (the warrant-bridge edge the hint flags,
// `'advisory'` severity). All other kinds project `edges: []` and
// contribute no edge halos — the node-fire sibling continues to cover
// their node-axis presentation.
//
// Refinement: tasks/refinements/audience/aud_diagnostic_edge_fire_animation.md
//   (Decision §1 — a parallel `<AudienceDiagnosticEdgeFireOverlay>` DOM
//   sibling rather than folding edge iteration into the node overlay;
//   each overlay paints one geometric class of decoration, preserving
//   symmetry with the existing one-overlay-per-semantic-class pattern.
//   Decision §2 — sibling helper `flattenActiveDiagnosticsForEdgeFire`
//   in `./diagnosticHighlights.ts`; the future
//   `shell_diagnostic_highlights_extract` lifts both helpers together.
//   Decision §3 — edge-midpoint geometry via
//   `edge.renderedBoundingBox()`, matching `AnnotationOverlay.tsx`'s
//   posture; `edge.midpoint()` is NOT used by the audience codebase.
//   Decision §4 — composite key `${identityKey}\0${edgeId}` matches
//   the node sibling's `${identityKey}\0${nodeId}` shape; an edge
//   referenced by both a contradiction (blocking) and a self-contradicts
//   hint (advisory) produces two halos with distinct composite keys
//   and distinct severity classes. Decision §5 — reuses the node
//   sibling's two `@keyframes` byte-identical (`aud-diagnostic-fire-
//   blocking` / `aud-diagnostic-fire-advisory`); no new CSS, no new
//   `prefers-reduced-motion` overrides. Decision §6 — Playwright spec
//   lands INLINE in `tests/e2e/audience-live-session.spec.ts`; the
//   audience route is now reachable, the chain that absorbed the node
//   sibling's deferral has been paid down. Decision §7 — no new ADR.)
// Refinement: tasks/refinements/audience/aud_diagnostic_fire_animation.md
//   (Decisions §3a, §4, §5, §8 — consumed verbatim. The node sibling
//   established `useCytoscapeOverlayPlacements`'s `triggers` parameter,
//   the composite-key `useSeenKeysGate` pattern, the 450 ms ease-out
//   constants, and the no-persistent-steady-state posture; this leaf
//   adopts them unchanged.)
// Refinement: tasks/refinements/audience/aud_dom_overlay_extraction.md
//   (Decisions §1–§6 — the shared hooks `useCytoscapeOverlayPlacements<P>`
//   and `useSeenKeysGate<K>` are consumed verbatim; this leaf is the
//   fourth NEW caller of both since the extraction landed.)
// Refinement: tasks/refinements/audience/aud_annotation_rendering_edges.md
//   (Established the canonical audience-side edge-midpoint placement
//   pattern `edge.renderedBoundingBox()` → `((x1+x2)/2, (y1+y2)/2)`
//   reused here for the halo centre.)
//
// ADRs: 0004 (Cytoscape.js — `renderedBoundingBox` is canonical API; no
//             new dep);
//       0022 (no throwaway verifications — pinned by
//             `DiagnosticEdgeFireOverlay.test.tsx`);
//       0026 (micro-frontend root app — overlay ships inside the
//             audience artifact);
//       0027 (entity / facet layers are strictly separate — structural
//             diagnostics live at the entity layer; the halo decorates
//             entity-layer edges).
//
// The overlay is a `pointer-events: none` + `aria-hidden="true"`
// layer: the halo is a pure visual decoration, screen readers narrate
// the underlying diagnostic via the future toast / banner surface
// (not yet shipped on the audience).

import { useMemo, useRef, type CSSProperties, type ReactElement, type RefObject } from 'react';
import type { Core, EdgeSingular } from 'cytoscape';

import {
  flattenActiveDiagnosticsForEdgeFire,
  type DiagnosticEdgeFireTuple,
  type DiagnosticHighlightSeverity,
} from '@a-conversa/shell';
import type { DiagnosticPayload } from '@a-conversa/shared-types';
import { useCytoscapeOverlayPlacements } from './cytoscapeOverlayHooks.js';

export interface AudienceDiagnosticEdgeFireOverlayProps {
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
 * Per-(diagnostic, edge) placement record. The `compositeKey` drives
 * both React's keyed reconciliation and `useSeenKeysGate`'s gate.
 */
interface DiagnosticEdgeFirePlacement {
  readonly compositeKey: string;
  readonly identityKey: string;
  readonly edgeId: string;
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
 * the edge midpoint instead of staying a fixed 96px and ballooning when
 * zoomed out. The intersection type keeps strict TypeScript happy about
 * the `--*` key.
 */
type HaloStyle = CSSProperties & Record<'--halo-zoom', string>;

export function AudienceDiagnosticEdgeFireOverlay({
  cy,
  containerRef,
  instanceKey,
  active,
}: AudienceDiagnosticEdgeFireOverlayProps): ReactElement {
  void containerRef;
  // Flattened (identityKey, edgeId, severity) tuples. Memoized on
  // `active` so identity stability is the same as the host store
  // selector's: a no-change render returns the same array reference,
  // which keeps `triggers: [tuples]` stable across no-ops.
  const tuples = useMemo(() => flattenActiveDiagnosticsForEdgeFire(active), [active]);
  // Seed the seen-Set synchronously on the FIRST render from the
  // prop-derived tuples, not lazily on the first non-empty placement
  // commit. Rationale: the host passes `active` synchronously at mount
  // time, so mid-session joiners with already-active diagnostics seed
  // their composite keys here (no retro animation), AND fresh sessions
  // (tuples empty at mount) seed with an empty set so the next arrival
  // is "new" and animates. The shared `useSeenKeysGate` cannot make
  // this distinction — it seeds on the first non-empty placement commit,
  // which conflates "store hydration after mount" with "first fire after
  // mount" and therefore swallows the fresh-session-fire animation. The
  // edge sibling's Playwright acceptance (Decision §6) requires the
  // fresh-session fire to animate; the node sibling's latent variant of
  // this issue is out of scope for this leaf.
  const seenKeysRef = useRef<Set<string> | null>(null);
  if (seenKeysRef.current === null) {
    seenKeysRef.current = new Set(
      tuples.map((t) => `${instanceKey}\0${t.identityKey}\0${t.edgeId}`),
    );
  }
  const isNewPair = (key: string): boolean => {
    const seen = seenKeysRef.current;
    if (seen === null) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const placements = useCytoscapeOverlayPlacements<DiagnosticEdgeFirePlacement>(
    cy,
    (cyInstance) => commitDiagnosticEdgeFirePlacements(cyInstance, instanceKey, tuples),
    [tuples],
  );

  return (
    <div
      data-testid="audience-diagnostic-edge-fire-overlay"
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
            data-diagnostic-fire-locus="edge"
            data-severity={p.severity}
            data-identity-key={p.identityKey}
            data-edge-id={p.edgeId}
            className={animClass}
            style={haloStyle}
          />
        );
      })}
    </div>
  );
}

function commitDiagnosticEdgeFirePlacements(
  cy: Core,
  instanceKey: string,
  tuples: readonly DiagnosticEdgeFireTuple[],
): readonly DiagnosticEdgeFirePlacement[] {
  const next: DiagnosticEdgeFirePlacement[] = [];
  const zoom = cy.zoom();
  for (const t of tuples) {
    const edge = cy.getElementById(t.edgeId) as EdgeSingular;
    // An edge referenced by a diagnostic but absent from the current
    // cy snapshot is silently skipped — the methodology engine may
    // emit a `fired` whose edges have not yet landed as events on
    // this client (rare but possible during initial replay drain).
    // The `isEdge()` guard is cheap insurance against the namespace-
    // shared `getElementById` returning a node id collision (the
    // projector emits disjoint id sets in practice).
    if (edge.empty() || !edge.isEdge()) continue;
    const bb = edge.renderedBoundingBox();
    next.push({
      compositeKey: `${instanceKey}\0${t.identityKey}\0${t.edgeId}`,
      identityKey: t.identityKey,
      edgeId: t.edgeId,
      severity: t.severity,
      x: (bb.x1 + bb.x2) / 2,
      y: (bb.y1 + bb.y2) / 2,
      zoom,
    });
  }
  return next;
}

export default AudienceDiagnosticEdgeFireOverlay;
