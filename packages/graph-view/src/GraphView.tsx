// `@a-conversa/graph-view` — the shared read-only Cytoscape.js mount.
//
// Lifted verbatim from `apps/audience/src/graph/GraphView.tsx` per
// ADR 0039: the data source is inverted from `useAudienceSession()` /
// `useAudienceActiveDiagnostics()` to the `events` + `instanceKey` +
// `activeDiagnostics` props below, so the renderer is store-agnostic
// and reusable by both the audience surface (via a thin
// `AudienceGraphView` adapter) and the landing walkthrough demo. The
// historical refinement annotations from the audience chain are
// retained below as design provenance.
//
// Refinement: tasks/refinements/landing_page/extract_readonly_graph_package.md
//   (Lift-and-shift of the audience renderer into a shared package;
//   props-in inversion of the two audience data-source couplings.)
//
// Refinement: tasks/refinements/audience/aud_cytoscape_init.md
//   (Decision §1 — Cytoscape consumed directly, no
//   `react-cytoscapejs` wrapper. Decision §2 — module-scope
//   stylesheet + numeric width/height. Decision §3 — `breadthfirst`
//   layout, not `cose`. Decision §7 — Cytoscape's pan/zoom defaults
//   stay enabled until a broadcast-polish sibling flips them off
//   inside an OBS-only `MountProps.broadcastMode` gate. Decision §8 —
//   no `window.__aConversaAudienceCyInstance` test seam; the
//   optional `cyRef` callback prop is the sole observability seam.
//   Decision §9 — no route wiring; this leaf ships the mount, the
//   future `aud_url_routing.aud_session_url` task wires it into
//   `<Route path="/sessions/:id">` and inherits the cumulative
//   deferred-e2e debt. Decision §10 — propose-time rendering per
//   ADR 0027.)
//
// Refinement: tasks/refinements/audience/aud_layout_engine.md
//   (Decision §1 — bundled `breadthfirst` retained; layout options
//   computed per-render by `buildAudienceLayoutOptions(elements)`.
//   Decision §2 — deterministic `roots` make layout output a pure
//   function of the projected element set. Decision §3 — one-shot
//   `cy.fit(PADDING)` on the first non-empty render via
//   `hasFitOnceRef`, reset on mount-effect cleanup so re-mounts get
//   a fresh fit. Decision §4 — broadcast-tuned `SPACING_FACTOR` /
//   `PADDING` as named exports in `./layoutOptions.ts`. Decision §5 —
//   Playwright deferral lands on `aud_visual_regression`, not on
//   `aud_session_url`.)
//
// Refinement: tasks/refinements/audience/aud_clean_typography.md
//   (Decision §1 — consume `BROADCAST_FONT_STACK` from
//   `@a-conversa/i18n-catalogs` rather than duplicating the stack
//   string. Decision §3 — node `font-size: 14` / weight 600 and edge
//   `font-size: 11` / weight 500 fit inside the 200×80 node box +
//   180px text-max-width established by `aud_layout_engine`.
//   Decision §4 — typography constants land as named exports from
//   this module; extraction to a `stylesheet.ts` module is the
//   3-sibling trigger. Decision §5 — `font-family` set on both
//   `node` and `edge` selectors because Cytoscape's text-style
//   resolver keys on the per-element selector, not on `core`.
//   Decision §6 — Playwright pixel-stability deferral re-routes to
//   `aud_visual_regression`.)
//
// Refinement: tasks/refinements/audience/aud_agreed_styling.md
//   (Decision §1 — sequential ordering after `aud_proposed_styling`;
//   the closer adds the `.tji` `depends !aud_proposed_styling` edge.
//   Decision §2 — slate-700 (`#334155`) border / line / target-arrow
//   color, color-only differentiation matching the moderator's
//   `mod_agreed_state_styling`. Decision §3 — inline literal at the
//   second per-state sibling; named-export extraction
//   (`aud_stylesheet_state_color_extraction`) triggers at three.
//   Decision §4 — attribute-equality selector against
//   `data.rollupStatus`; no `addClass` / `classes:` API. Decision §5 —
//   Playwright pixel-stability deferral lands on
//   `aud_visual_regression`.)
//
// Refinement: tasks/refinements/audience/aud_proposed_styling.md
//   (Decision §1 — `projectGraph` stamps BOTH `data.facetStatuses`
//   (the per-facet record) and `data.rollupStatus` (the priority
//   rollup) on every emitted element. Decision §2 — dashed border /
//   line + 60% opacity for the proposed state; color inherits from
//   baseline (CAD convention for "tentative"; cross-surface match
//   with the moderator's `mod_proposed_state_styling`). Decision §3 —
//   port `facetStatus.ts` verbatim from the participant (the newer
//   client mirror with the post-`pf_*` cleanups). Decision §4 — the
//   literal sentinel `'none'` rather than `undefined` when the per-
//   facet record is empty, so Cytoscape's attribute selectors have a
//   stable string to match on. Decision §5 — fourth verbatim copy of
//   `facetStatus.ts` lands here; consolidation deferred to the
//   named-future-task `shell_facet_status_extraction`. Decision §6 —
//   Playwright pixel-stability deferral lands on
//   `aud_visual_regression`.)
//
// Refinement: tasks/refinements/audience/aud_disputed_styling.md
//   (Decision §1 — sequential ordering after `aud_proposed_styling`;
//   the closer adds the `.tji` `depends !aud_proposed_styling` edge.
//   Decision §2 — rose-600 (`#e11d48`) border / line / target-arrow
//   color, plus `border-width: 3` on nodes (first per-state branch to
//   override `border-width`); edges stay 1px (color carries enough
//   signal with the directional arrow). Cross-surface match with the
//   moderator's `mod_disputed_state_styling`; the width-bump is the
//   Cytoscape analogue of the moderator's `ring-rose-500` halo.
//   Decision §3 — mount-time computed-style cases land inline here
//   (the projection-time emission they require already shipped via
//   `aud_proposed_styling`). Decision §4 — attribute-equality selector
//   against `data.rollupStatus`; no `addClass` / `classes:` API.
//   Decision §5 — Playwright pixel-stability deferral lands on
//   `aud_visual_regression`. Decision §6 — both stylesheet extractions
//   (`aud_stylesheet_module_extraction` + `aud_stylesheet_state_color_extraction`)
//   deferred to named-future tasks; this leaf is the third-sibling
//   trigger but not the extraction commit.)
//
// Refinement: tasks/refinements/audience/aud_per_facet_visualization.md
//   (Decision §1 — DOM-overlay sibling of the Cytoscape canvas; the
//   `<AudiencePerFacetPillOverlay>` mounts as a positioned sibling of
//   the canvas mount inside a new `audience-graph-root-wrapper`
//   positioning ancestor. Decision §2 — pill row anchored above the
//   node bounding box. Decision §3 — canonical reading order
//   `wording → classification → substance`. Decision §4 — rAF-batched
//   commit subscribed to `render pan zoom resize` + `position node` +
//   `add remove data`. Decision §5 — `cyInstanceRef` is paired with a
//   new `useState<Core | null>` slot (`cyState`) so the overlay
//   sibling receives a non-null `cy` prop on the second render; the
//   external `cyRef` callback API is unchanged. Decision §6 —
//   Playwright pixel-stability deferral lands on `aud_visual_regression`,
//   the same destination as the four predecessor styling siblings.)
//
// Refinement: tasks/refinements/audience/aud_axiom_mark_decoration.md
//   (Decision §1 — per-participant chromatic axiom-mark badges land as
//   a second DOM-overlay sibling of the Cytoscape canvas (below the
//   node card), distinct from the per-facet pill overlay above the
//   node. Decision §2 — projection stamps
//   `data.axiomMarks: readonly AxiomMark[]` on every node; the
//   overlay reads the field and iterates in commit-arrival order.
//   Decision §3 — inline port of `<AxiomMarkBadge>` + `axiomMarks.ts`
//   into the audience workspace; the third-caller shell extract is
//   deferred to the named-future-task
//   `shell_axiom_marks_extraction`. Decision §4 — badge row anchored
//   BELOW the node bounding box for spatial layer separation from the
//   above-the-node per-facet pill row. Decision §5 — reuse the
//   existing `cyState` slot; no new `useState`. Decision §6 —
//   Playwright pixel-stability deferral lands on `aud_visual_regression`.)
//
// Refinement: tasks/refinements/audience/aud_meta_disagreement_split.md
//   (Decision §1 — sequential ordering after `aud_proposed_styling`
//   and `aud_disputed_styling`; the closer adds the `.tji`
//   `depends !aud_proposed_styling, !aud_disputed_styling` edges.
//   Decision §2 — violet-600 (`#7c3aed`) border / line / target-arrow
//   color, plus `border-style: 'double'` on nodes (first per-state
//   branch to override `border-style: 'double'`); edges stay solid
//   violet (Cytoscape's `line-style` enum lacks a `2 2` analog and
//   violet color alone uniquely identifies meta-disagreement on the
//   canvas). Cross-surface match with the moderator's
//   `mod_meta_disagreement_split_render` and the participant's
//   Cytoscape selector; no `outline-*` halo, no `background-color`
//   fill tint, no `border-width` bump — those axes belong to disputed
//   / future overlays / future committed-withdrawn states. Decision §3
//   — `metaDisagreement: '#7c3aed'` added to `STATE_COLORS`; grow-as-
//   needed posture inherited from `aud_stylesheet_state_color_extraction`.
//   Decision §4 — mount-time computed-style cases land inline here
//   (the projection-time emission they require already shipped via
//   `aud_proposed_styling`). Decision §5 — attribute-equality selector
//   against `data.rollupStatus`; no `addClass` / `classes:` API.
//   Decision §6 — Playwright pixel-stability deferral lands on
//   `aud_visual_regression`.)
//
// Refinement: tasks/refinements/audience/aud_annotation_rendering.md
//   (Decision §1 — per-annotation amber-pill badges land as a third
//   DOM-overlay sibling of the Cytoscape canvas (below the axiom-mark
//   row), surfacing the methodology's meta-commentary layer on the
//   broadcast surface. Decision §2 — scope to node-targeted
//   annotations; edge-targeted deferred to the named-future-task
//   `aud_annotation_rendering_edges`. Decision §3 — inline port of
//   `<AnnotationBadge>` + `annotations.ts` into the audience workspace;
//   third-caller trigger fires for the already-registered
//   `shell_package.extract_cytoscape_projectors`. Decision §4 — badge
//   row anchored at `y2 + 30` so it sits below the axiom-mark row
//   (which itself sits at `y2 + 6` and is ~20 px tall). Decision §5 —
//   reuse the existing `cyState` slot; three overlays receive the same
//   `cy` prop. Decision §6 — Playwright pixel-stability deferral lands
//   on `aud_visual_regression`.)
//
// Refinement: tasks/refinements/audience/aud_stylesheet_module_extraction.md
//   (Decision §1 — `STYLESHEET` remains a module-scope `const` in its
//   new home `./stylesheet.ts`; reference-stable across renders per
//   Cytoscape's diff-by-reference posture. Decision §2 — sibling
//   constants-set extraction (`aud_stylesheet_state_color_extraction`)
//   stays a separate task; this leaf is purely the file-level move.
//   Decision §3 — no re-export shim from this file; the test imports
//   `STYLESHEET` + the four `BROADCAST_*` constants directly from
//   `./stylesheet`. Decision §4 — no new ADR; mechanical refactor
//   following the documented "extract at the third caller" pattern.
//   Decision §5 — JSDoc blocks for `STYLESHEET` and the typography
//   pins travel verbatim with the constants into `./stylesheet.ts`.)
//
// Refinement: tasks/refinements/audience/aud_decomposition_animation.md
//   (Decision §1 — `<AudienceDecompositionFadeOverlay>` is an eighth
//   DOM-overlay sibling of the Cytoscape canvas, painting a slate-
//   tinted halo `<span>` per node whose `data.decomposed` is truthy
//   (the projector stamps the flag at commit of a `decompose` /
//   `interpretive-split` proposal targeting the node as parent). The
//   post-animation steady state is the cytoscape stylesheet entry
//   `node[?decomposed] { opacity: 0.15 }` painting the "structurally
//   retired" parent at 15% opacity while preserving its layout
//   position (spatial-memory anchor for the broadcast viewer).
//   Decision §2 — `projectGraph` extends with `pendingDecompositions:
//   Map<proposalEnvelopeId, parentNodeId>` symmetric with the existing
//   `pendingClassifications`. The flag is monotonic — committed
//   decompositions are structurally permanent.
//   Decision §5 — synchronous local-ref seed-from-first-non-empty
//   placements gate (inline, NOT `useSeenKeysGate`); mirror of the
//   `aud_diagnostic_fire_animation_seeding_alignment` precedent.
//   Decision §6 — `var(--aud-anim-halo-ms)` + `var(--aud-anim-easing)`
//   + `forwards` fill; halo-tier parity. Decision §7 — Playwright
//   deferred to `aud_url_routing.aud_session_url` (eleventh refinement
//   on that inherited-debt chain). The new overlay mounts LAST so its
//   halo `<span>`s sit above the seven earlier overlays' chrome at
//   the moment of arrival.)
//
// Refinement: tasks/refinements/audience/aud_diagnostic_edge_fire_animation.md
//   (Decision §1 — `<AudienceDiagnosticEdgeFireOverlay>` is a seventh
//   DOM-overlay sibling of the Cytoscape canvas, the edge counterpart
//   of the sixth `<AudienceDiagnosticFireOverlay>`. It paints amber
//   halos (blocking amber-700 for `contradiction`, advisory amber-400
//   for the `self-contradicts` coherency-hint sub-kind) per-(diagnostic,
//   edge) pair with a one-shot CSS `@keyframes` entrance reusing the
//   node sibling's keyframes byte-identical (Decision §5 — no new CSS).
//   Decision §3 — edge-midpoint geometry via `edge.renderedBoundingBox()`
//   matching `AnnotationOverlay.tsx`'s posture. Decision §4 — composite
//   key `${identityKey}\0${edgeId}` over `useSeenKeysGate` for lazy-init
//   seed + once-per-(diagnostic, edge, session) animation semantics.
//   Decision §6 — Playwright spec lands INLINE in
//   `tests/e2e/audience-live-session.spec.ts`; the audience route is
//   reachable and the chain that absorbed the node sibling's deferral
//   has been paid down. The new overlay mounts LAST so its halo
//   `<span>`s sit above the six earlier overlays' chrome at the moment
//   of arrival.)
//
// Refinement: tasks/refinements/audience/aud_diagnostic_fire_animation.md
//   (Decision §1 — `<AudienceDiagnosticFireOverlay>` is a sixth DOM-
//   overlay sibling of the Cytoscape canvas, painting amber halos
//   (blocking amber-700 / advisory amber-400) per-(diagnostic, node)
//   pair with a one-shot CSS `@keyframes` entrance; no `cy.animate()`,
//   no motion-framework dep, no STYLESHEET edit. Decision §3 — the
//   audience's WS store extends `BaseWsStoreState` locally with
//   `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` per
//   session; this leaf is the third-caller port that triggers the
//   future shell extraction (`shell_diagnostic_highlights_extract`).
//   Decision §3a — `useCytoscapeOverlayPlacements` is given the
//   additive `triggers` parameter so a change to the WS-store-derived
//   tuples re-runs the commit closure. Decision §4 — `useSeenKeysGate`
//   keyed on the composite `${identityKey}\0${nodeId}`. Decision §5 —
//   450 ms ease-out, `forwards` fill. Decision §6 — reduced-motion
//   handled in CSS; Playwright deferred to
//   `aud_url_routing.aud_session_url` (ninth refinement on the chain).
//   Decision §7 — node halos only; edge halos deferred. Decision §8 —
//   animation IS the entire diagnostic surface; no persistent border.
//   The new overlay mounts LAST so its halo `<span>`s sit above the
//   five earlier overlays' chrome at the moment of arrival.)
//
// Refinement: tasks/refinements/audience/aud_withdrawal_animation.md
//   (Decision §1 — `<AudienceWithdrawalHaloOverlay>` is a fifth DOM-
//   overlay sibling of the Cytoscape canvas, painting a rose-tinted
//   halo `<span>` per currently-`'disputed'`-rollupStatus node with a
//   one-shot CSS `@keyframes` entrance; no `cy.animate()`, no motion-
//   framework dep, no STYLESHEET edit. Decision §2 — a NEW overlay
//   file, NOT a fold into `<AudienceNodeAppearOverlay>`: one overlay
//   paints one DOM-overlay class of decoration (node-appear vs
//   withdrawal-to-disputed are distinct semantic classes). Decision §4
//   — `useSeenKeysGate` keyed by `nodeId` over currently-`'disputed'`-
//   rollup entries (target-status-keyed, mirroring
//   `aud_proposed_to_agreed_animation`'s posture). Decision §5 — 450
//   ms ease-out, `forwards` fill — parity with the node-appear halo
//   because the halo geometry is identical. Decision §6 — reduced-
//   motion handled in CSS; Playwright deferred to
//   `aud_url_routing.aud_session_url` (eighth refinement on that
//   inherited-debt chain). The new overlay mounts LAST so its halo
//   `<span>`s sit above the four earlier overlays' chrome at the
//   moment of arrival.)
//
// Refinement: tasks/refinements/audience/aud_node_appear_animation.md
//   (Decision §1 — `<AudienceNodeAppearOverlay>` is a fourth DOM-overlay
//   sibling of the Cytoscape canvas, painting a halo `<span>` per node
//   with a one-shot CSS `@keyframes` entrance; no `cy.animate()`, no
//   motion-framework dep. Decision §2 — verbatim reuse of the
//   predecessor's overlay shape; the rule-of-three-or-four extraction
//   is registered as the named-future-task `aud_dom_overlay_extraction`.
//   Decision §3 — the overlay owns its own `seenNodeIdsRef`,
//   intentionally separate from `knownNodeIdsRef` here (different
//   lifecycle: this ref mutates AFTER the React commit inside the
//   element-sync effect; the overlay's ref mutates DURING render).
//   Decision §4 — lazy-init the seen-Set on the first non-empty
//   placement commit. Decision §5 — 450 ms ease-out, `forwards` fill.
//   Decision §6 — reduced-motion handled in CSS; Playwright deferred to
//   `aud_url_routing.aud_session_url`. The new overlay mounts LAST so
//   its halo `<span>`s sit above the three earlier overlays' chrome at
//   the moment of arrival.)
//
// ADRs:
//   - 0004 (Cytoscape.js for the audience broadcast surface);
//   - 0022 (no throwaway verifications — Vitest pins the React-mount
//     behaviour, Playwright defers to `aud_session_url`);
//   - 0024 (react-i18next + ICU — `useTranslation()` is the
//     localization seam; this leaf consumes `methodology.kind.*` +
//     `methodology.edgeRole.<role>.label`, no new keys);
//   - 0026 (micro-frontend root app — the surface owns its mounted
//     region only; the event log arrives as the `events` prop, fed by
//     the host adapter from its read-only state barrel — the package
//     itself reads no store);
//   - 0027 (entity / facet layers are strictly separate);
//   - 0029 (anonymous WS subscribe for public sessions — orthogonal,
//     but worth naming: the projection consumes the same event log
//     whether the underlying connection is authenticated or
//     anonymous).
//
// Mirrors the participant's `apps/participant/src/graph/GraphView.tsx`
// minus participant-specific decoration (no own-vote / other-vote
// indicators, no axiom-mark badge, no annotation overlay, no
// diagnostic-highlight halo, no flashing-node animation, no tap
// handler). Sibling tasks under `aud_graph_rendering.*` add those
// back in their own commits as needed.

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import { useTranslation } from 'react-i18next';
import type { DiagnosticPayload, Event } from '@a-conversa/shared-types';

import { buildAudienceLayoutOptions, PADDING } from './layoutOptions.js';
import { projectGraph } from './projectGraph.js';
import { STYLESHEET } from './stylesheet.js';
import { AudiencePerFacetPillOverlay } from './PerFacetPillOverlay.js';
import { AudienceAxiomMarkOverlay } from './AxiomMarkOverlay.js';
import { AudienceAnnotationOverlay } from './AnnotationOverlay.js';
import { AudienceNodeAppearOverlay } from './NodeAppearOverlay.js';
import { AudienceWithdrawalHaloOverlay } from './WithdrawalHaloOverlay.js';
import { AudienceDiagnosticFireOverlay } from './DiagnosticFireOverlay.js';
import { AudienceDiagnosticEdgeFireOverlay } from './DiagnosticEdgeFireOverlay.js';
import { AudienceDecompositionFadeOverlay } from './DecompositionFadeOverlay.js';

/**
 * Stable empty-map reference for the `activeDiagnostics` default. A
 * read-only consumer with no live diagnostic stream (the landing
 * walkthrough demo) omits the prop entirely; the two diagnostic
 * overlays then render no halos. Module-scope so the default identity
 * is stable across renders and the overlays' memoized tuples stay
 * reference-stable on no-op re-renders.
 */
const EMPTY_ACTIVE_DIAGNOSTICS: ReadonlyMap<string, DiagnosticPayload> = new Map();

export interface GraphViewProps {
  /**
   * The precomputed, ordered event log to project and render. This is
   * the sole data source: the package calls no store, no session hook,
   * and no WebSocket. The audience adapter feeds it from
   * `useAudienceSession()`; the landing walkthrough feeds it a sliced
   * `events[0..pos]` window.
   */
  readonly events: readonly Event[];
  /**
   * Opaque per-instance identity. Supplied by the audience adapter as
   * the session id; the diagnostic overlays' seen-key gates scope their
   * once-per-fire animation by this key so two independently-mounted
   * renders of the same diagnostic identity do not cross-contaminate.
   */
  readonly instanceKey: string;
  /**
   * The live per-instance active-diagnostics map (identity key →
   * payload), supplied today by the audience WS store. Defaults to an
   * empty map for consumers with no live diagnostic stream. The package
   * never reads this from a store — it is a plain prop.
   */
  readonly activeDiagnostics?: ReadonlyMap<string, DiagnosticPayload>;
  /**
   * Optional callback fired with the Cytoscape `Core` instance on
   * mount and `null` on unmount. The Vitest layer consumes this seam
   * to capture the instance for `cy.elements()` assertions; the
   * package does NOT expose a `window.__aConversa*CyInstance` test
   * seam (Decision §8).
   */
  readonly cyRef?: (cy: Core | null) => void;
}

export function GraphView({
  events,
  instanceKey,
  activeDiagnostics = EMPTY_ACTIVE_DIAGNOSTICS,
  cyRef,
}: GraphViewProps): ReactElement {
  const { t } = useTranslation();
  const cyInstanceRef = useRef<Core | null>(null);
  // Per `aud_per_facet_visualization` Decision §5 — `cyInstanceRef` (a
  // plain `useRef`) is React-invisible: mutating the ref doesn't
  // trigger re-renders, so a sibling consumer like
  // `<AudiencePerFacetPillOverlay>` cannot know when the cy instance
  // becomes available. The `useState` slot solves the visibility
  // problem: the mount effect calls `setCyState(cy)` alongside the
  // imperative ref-mutation, and the overlay re-renders when the
  // instance lands. The existing `cyRef` callback continues to fire
  // for external consumers.
  const [cyState, setCyState] = useState<Core | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Track node ids the component has already seen so the element-sync
  // effect can decide whether to run a `breadthfirst` layout pass.
  // `useRef` (not `useState`) because writes happen AFTER layout
  // completes and MUST NOT trigger a re-render — the events memo
  // already drives the re-render cadence.
  const knownNodeIdsRef = useRef<Set<string>>(new Set());
  // Companion to `knownNodeIdsRef` for edge ids. The layout pass also
  // fires when a truly-new EDGE arrives — an `edge-created` between two
  // already-placed nodes (a rebuttal / contradiction between existing
  // statements) introduces no new node id, so a node-only gate would
  // leave the new edge routed across the untouched layout, overlapping
  // the existing cards / edges. Re-tidying on any new element (node OR
  // edge) keeps the arrangement readable as the graph grows; property-
  // only re-projections (classification flips, votes, decoration ticks)
  // still introduce no new id, skip the layout, and reuse the cached
  // positions verbatim.
  const knownEdgeIdsRef = useRef<Set<string>>(new Set());
  // Position cache mirrored from the participant's pattern: cache
  // every emitted node's `{x, y}` after each layout pass so cy.json
  // re-applies them on the next tick. The audience baseline has no
  // selection / vote / annotation re-projection — but downstream
  // siblings (axiom-mark decoration, annotation rendering) will, and
  // the cache pays its dust once those land.
  const positionCacheRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // One-shot first-mount auto-fit gate. The broadcast surface uses
  // `fit: false` for every layout pass so event-arrival never recenters
  // the viewport (camera jumps are disorienting on video). The very
  // first non-empty render has no prior camera to preserve, though —
  // without a one-shot `cy.fit(PADDING)` the graph paints at
  // Cytoscape's origin with the default `zoom: 1, pan: { 0, 0 }`,
  // often partially off-screen for any non-trivial canvas size.
  // Reset on cleanup so a re-mount (StrictMode double-mount, Vite hot
  // reload, Playwright reload) gets a fresh first-fit.
  const hasFitOnceRef = useRef<boolean>(false);

  // One-shot mount of the Cytoscape instance. The `cyRef` callback
  // is intentionally NOT a dependency — the mount lifecycle owns the
  // instance, not the consumer's callback identity. If the consumer
  // passes a new callback per render the instance must NOT be
  // re-created. The repo does not run `react-hooks/exhaustive-deps`
  // so no suppression directive is required; this comment documents
  // the intent for the human reviewer (mirrors the participant's
  // `<GraphView>` pattern).
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const cy = cytoscape({
      container,
      style: STYLESHEET,
      elements: [],
      layout: { name: 'preset' },
      // Pan / zoom defaults — Decision §7. A future broadcast-polish
      // task flips these off when the surface mounts inside an OBS
      // browser source.
      userPanningEnabled: true,
      userZoomingEnabled: true,
      boxSelectionEnabled: false,
      selectionType: 'single',
      // Audience is read-only by construction; no manual drag.
      autoungrabify: true,
    });
    cyInstanceRef.current = cy;
    setCyState(cy);
    cyRef?.(cy);
    return () => {
      cy.destroy();
      cyInstanceRef.current = null;
      setCyState(null);
      cyRef?.(null);
      knownNodeIdsRef.current = new Set();
      knownEdgeIdsRef.current = new Set();
      positionCacheRef.current = new Map();
      hasFitOnceRef.current = false;
    };
  }, []);

  // Projection + localization, memoized over events + the i18n
  // instance. The localized labels live in `data.roleLabel` (consumed
  // by the edge selector) and `data.kindLabel` (carried for future
  // sibling stylesheets — the baseline node selector renders
  // `data(wording)`, not the kind).
  const elements = useMemo<ElementDefinition[]>(() => {
    const { nodes, edges } = projectGraph(events);
    const projectedNodeIds = new Set(nodes.map((n) => n.data.id));
    // Drop edges whose source / target id has not been seen as a
    // `node-created` event. Cytoscape throws synchronously on
    // `cy.add({ group: 'edges', data: { source: '<unknown>', ... } })`,
    // so the lenient "render whatever the projection emits" behaviour
    // has to be opt-in. The dropped edge re-materialises as soon as
    // the missing node lands and the projection runs again.
    const nondanglingEdges = edges.filter(
      (e) => projectedNodeIds.has(e.data.source) && projectedNodeIds.has(e.data.target),
    );
    const localizedNodes: ElementDefinition[] = nodes.map((node) => {
      const cachedPosition = positionCacheRef.current.get(node.data.id);
      const descriptor: ElementDefinition = {
        group: 'nodes',
        data: {
          ...node.data,
          kindLabel: node.data.kind === null ? '—' : t(`methodology.kind.${node.data.kind}`),
        },
      };
      if (cachedPosition !== undefined) {
        descriptor.position = { x: cachedPosition.x, y: cachedPosition.y };
      }
      return descriptor;
    });
    const localizedEdges: ElementDefinition[] = nondanglingEdges.map((edge) => ({
      group: 'edges',
      data: {
        ...edge.data,
        roleLabel: t(`methodology.edgeRole.${edge.data.role}.label`),
      },
    }));
    return [...localizedNodes, ...localizedEdges];
  }, [events, t]);

  // Element sync — runs on every events / translation change. Runs
  // a `breadthfirst` layout pass only when at least one truly-new
  // ELEMENT (node OR edge) id appears; existing-only re-projections
  // (decoration ticks, classification flips, vote arrivals) introduce
  // no new id and skip the layout, preserving the cached positions so
  // the camera and arrangement stay stable on property-only changes.
  useEffect(() => {
    const cy = cyInstanceRef.current;
    if (cy === null) return;
    // A new node OR a new edge re-tidies the whole graph. Edges are
    // tracked alongside nodes (see `knownEdgeIdsRef`) so an
    // `edge-created` between two already-placed nodes still recomputes
    // the layout instead of routing the new edge across the stale
    // arrangement.
    let hasNewElement = false;
    for (const element of elements) {
      const id = element.data?.id;
      if (typeof id !== 'string') continue;
      if (element.group === 'nodes') {
        if (!knownNodeIdsRef.current.has(id)) hasNewElement = true;
      } else if (element.group === 'edges') {
        if (!knownEdgeIdsRef.current.has(id)) hasNewElement = true;
      }
    }
    cy.json({ elements });
    // Skip the layout pass when the canvas has no measurable
    // viewport (happy-dom: `cy.width()` reports 0). Cytoscape
    // layouts need a non-zero bounding box to assign coordinates;
    // running against a zero-sized viewport is unreliable. The
    // browser path always has a real viewport. Empty graphs skip too.
    const width = cy.width();
    const height = cy.height();
    const viewportReady =
      Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    if (cy.elements().length > 0 && viewportReady && hasNewElement) {
      cy.layout(buildAudienceLayoutOptions(elements)).run();
    }
    cy.nodes().forEach((node) => {
      const position = node.position();
      positionCacheRef.current.set(node.id(), { x: position.x, y: position.y });
      knownNodeIdsRef.current.add(node.id());
    });
    // Record every currently-rendered edge id so the NEXT sync tick
    // treats it as known — a property-only re-projection of the same
    // edge set then skips the layout, while a fresh `edge-created`
    // re-tidies. Dangling edges are filtered out of `elements` above, so
    // `cy.edges()` only carries the edges actually on the canvas.
    cy.edges().forEach((edge) => {
      knownEdgeIdsRef.current.add(edge.id());
    });
    // One-shot auto-fit on the first non-empty render. `fit: false` on
    // the layout options keeps subsequent event arrivals from snapping
    // the camera; this branch re-centers the camera exactly once so the
    // graph is visible in the viewport from the first render. The
    // mount-effect cleanup resets the ref so a re-mount fits again.
    if (cy.elements().length > 0 && viewportReady && !hasFitOnceRef.current) {
      cy.fit(undefined, PADDING);
      hasFitOnceRef.current = true;
    }
  }, [elements]);

  return (
    <div data-testid="audience-graph-root-wrapper" className="relative h-full w-full">
      <div ref={containerRef} data-testid="audience-graph-root" className="h-full w-full" />
      <AudiencePerFacetPillOverlay cy={cyState} containerRef={containerRef} />
      <AudienceAxiomMarkOverlay cy={cyState} containerRef={containerRef} />
      <AudienceAnnotationOverlay cy={cyState} containerRef={containerRef} />
      <AudienceNodeAppearOverlay cy={cyState} containerRef={containerRef} />
      <AudienceWithdrawalHaloOverlay cy={cyState} containerRef={containerRef} />
      <AudienceDiagnosticFireOverlay
        cy={cyState}
        containerRef={containerRef}
        instanceKey={instanceKey}
        active={activeDiagnostics}
      />
      <AudienceDiagnosticEdgeFireOverlay
        cy={cyState}
        containerRef={containerRef}
        instanceKey={instanceKey}
        active={activeDiagnostics}
      />
      <AudienceDecompositionFadeOverlay cy={cyState} containerRef={containerRef} />
    </div>
  );
}
