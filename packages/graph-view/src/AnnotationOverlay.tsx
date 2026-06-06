// `<AudienceAnnotationOverlay>` — React DOM overlay painting one
// absolutely-positioned row of `<AudienceAnnotationBadge>` chips per
// Cytoscape EDGE — and per non-statement (annotation graph-) node —
// that carries at least one committed annotation. Sibling of the
// Cytoscape canvas mount inside the `audience-graph-root-wrapper`
// positioning ancestor.
//
// NOTE (`per_facet_step_pill` fold-in; ADR 0004 2026-06-06 amendment):
// statement-node annotations now render INSIDE the node box as HTML (via
// `cytoscape-node-html-label`), so the commit pass skips
// `nodeKind === 'statement'` nodes. This overlay survives for the two
// cases that have no node box to fold into: edge-targeted annotations,
// and annotations on promoted annotation graph-nodes. The sibling
// axiom-mark overlay was retired entirely (axiom marks fold into the
// statement-node HTML footer).
//
// Refinement: tasks/refinements/audience/aud_annotation_rendering.md
//              (Decision §1 — per-annotation badges, NOT a boolean
//              overlay; the audience inverts the participant's collapse
//              because the broadcast surface has no detail panel.
//              Decision §2 — scope to node-targeted annotations; the
//              overlay iterates `cy.nodes()` only, edge-targeted
//              deferred to the named-future-task
//              `aud_annotation_rendering_edges`. Decision §4 — badge
//              row anchored BELOW the axiom-mark row at
//              `renderedBoundingBox().y2 + ANNOTATION_ROW_OFFSET_Y`
//              with `ANNOTATION_ROW_OFFSET_Y = 30` so the row sits
//              clear of the axiom-mark row (which itself sits at
//              `y2 + 6` and is ~20 px tall, leaving a 4 px breathing
//              gap). Decision §5 — direct transposition of
//              `<AudienceAxiomMarkOverlay>`: same subscription set
//              (`render pan zoom resize` + `position node` + `add
//              remove data`), same singleton-rAF batched commit, same
//              `cyState` slot reuse; three overlays share the same
//              `Core` instance and each owns its own listeners.)
//
// Refinement: tasks/refinements/audience/aud_annotation_rendering_edges.md
//              (Decision §1 — the existing overlay's commit closure
//              additionally iterates `cy.edges()` after `cy.nodes()`,
//              emitting one placement per edge whose `data.annotations`
//              is non-empty; the placement record stays flat (no
//              `kind` discriminator) since the render path is uniform
//              across element kinds. Decision §3 — edge placement
//              anchored at `renderedBoundingBox()` center plus a fixed
//              `EDGE_ANNOTATION_OFFSET_Y = 18` so the badge row clears
//              the Cytoscape-rendered role label at the edge midpoint.
//              Decision §4 — the overlay reads `data.annotations` off
//              the edge identically to the node branch; the
//              projection's `AudienceEdgeData.annotations` field is
//              the data source. Decision §5 — the existing
//              subscription set already catches every change that
//              moves an edge midpoint (pan, zoom, resize, render,
//              endpoint-node position change via `position node`,
//              add/remove/data); no new listener.)
// Refinement: tasks/refinements/audience/aud_dom_overlay_extraction.md
//              (Decisions §1–§6 — the rAF-batched commit + three-event
//              subscription set + cleanup branch lift into
//              `useCytoscapeOverlayPlacements<P>`. The
//              `commitAnnotationPlacements` pure function still
//              iterates BOTH `cy.nodes()` and `cy.edges()` — the hook
//              parameterizes "what to iterate" via the caller-supplied
//              `commit` callback rather than baking a nodes-only
//              iteration into the primitive (Decision §3 of the
//              extraction refinement). The component keeps its render
//              shape unchanged.)
// ADRs:        0004 (Cytoscape.js — `renderedBoundingBox` + `cy.on(...)`
//              vocabulary is canonical Cytoscape API, no new dep);
//              0022 (no throwaway verifications — pinned by
//              `AnnotationOverlay.test.tsx`);
//              0026 (micro-frontend root app — the overlay ships
//              inside the audience artifact until
//              `extract_cytoscape_projectors` lifts the projection
//              helpers into `@a-conversa/shell`);
//              0027 (entity / facet layers are strictly separate —
//              annotations are the meta-commentary layer, distinct
//              from the per-facet agreement layer (the per-facet pills
//              above the node), the per-participant disposition layer
//              (axiom marks below the node), and the entity-rollup
//              layer (the node's per-state paint)).
//
// The overlay is a `pointer-events: none` layer so the broadcast
// surface stays read-only: clicks pass through to the (already
// `autoungrabify: true`) Cytoscape canvas. The badge's `title`
// attribute is the only hover affordance.

import { type ReactElement, type RefObject } from 'react';
import type { Core, EdgeSingular, NodeSingular } from 'cytoscape';

import type { Annotation } from '@a-conversa/shell';

import { AudienceAnnotationBadge } from './AnnotationBadge.js';
import { useCytoscapeOverlayPlacements } from './cytoscapeOverlayHooks.js';

export interface AudienceAnnotationOverlayProps {
  /**
   * Live Cytoscape `Core` handle. `null` before the canvas mount
   * effect has run; the overlay early-exits to an empty wrapper in
   * that case. `<AudienceGraphView>` reuses its existing `cyState`
   * slot (Decision §5) so this prop becomes non-null on the second
   * render.
   */
  readonly cy: Core | null;
  /**
   * Reference to the Cytoscape mount container. Reserved for future
   * positioning-debug branches that may need to measure the
   * container's `getBoundingClientRect()`. Today the overlay does not
   * consume it.
   */
  readonly containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Per-node placement record. The render path iterates over a snapshot
 * of these and emits one absolutely-positioned badge row per entry.
 */
interface AnnotationRowPlacement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /**
   * Cytoscape viewport zoom captured at commit time. The badge row is a
   * DOM overlay sized in fixed CSS pixels, but the node/edge geometry it
   * anchors to (`renderedBoundingBox`) scales with the viewport zoom.
   * Without compensating, the row keeps its fixed pixel size and reads
   * proportionally larger as the graph zooms out. The render path applies
   * `scale(zoom)` about the row's top-center anchor so the badges track
   * the element at every zoom level (mirrors `PerFacetPillOverlay`).
   */
  readonly zoom: number;
  readonly annotations: readonly Annotation[];
}

/**
 * Vertical offset (px) below the node bounding-box bottom edge. Places
 * the annotation row below the axiom-mark row (Decision §4): the
 * axiom-mark row sits at `y2 + 6` and is ~20 px tall (`h-5 w-5`
 * ring-1 chip), so 30 px down from `y2` leaves a 4 px breathing gap
 * below the axiom-mark row. When the axiom-mark row is empty, the
 * annotation row sits standalone at `y2 + 30`, with a small gap from
 * the node's bottom edge signalling "decoration here" without
 * ambiguity about which layer it belongs to.
 */
export const ANNOTATION_ROW_OFFSET_Y = 30;

/**
 * Vertical offset (px) below the edge `renderedBoundingBox()` center
 * (i.e. the rendered midpoint). Places the annotation row below the
 * Cytoscape-rendered role label at the edge midpoint
 * (`aud_annotation_rendering_edges` Decision §3): the role label is
 * rendered with `font-size: 12px` (`BROADCAST_EDGE_FONT_SIZE_PX` minus
 * one, per the audience stylesheet) and occupies roughly 14 px
 * vertical; a 4 px breathing gap below the label's bottom edge yields
 * an 18 px offset from the midpoint. Symmetric in spirit to
 * `ANNOTATION_ROW_OFFSET_Y` (both are fixed offsets pinned to the
 * adjacent visual the row must clear).
 */
export const EDGE_ANNOTATION_OFFSET_Y = 18;

export function AudienceAnnotationOverlay({
  cy,
  containerRef,
}: AudienceAnnotationOverlayProps): ReactElement {
  void containerRef;
  const placements = useCytoscapeOverlayPlacements<AnnotationRowPlacement>(
    cy,
    commitAnnotationPlacements,
  );

  return (
    <div data-testid="audience-annotation-overlay" className="pointer-events-none absolute inset-0">
      {placements.map((p) => (
        <div
          key={p.id}
          data-annotation-row=""
          data-element-id={p.id}
          style={{
            position: 'absolute',
            left: `${String(p.x)}px`,
            top: `${String(p.y)}px`,
            // Anchor the row's top-center at (x, y), then scale by the
            // viewport zoom about that same point (`transform-origin:
            // center top`) so the badges stay glued below the element and
            // keep a constant size *relative to the zoom* instead of
            // ballooning when zoomed out. Mirrors `PerFacetPillOverlay`.
            transform: `translate(-50%, 0) scale(${String(p.zoom)})`,
            transformOrigin: 'center top',
            display: 'flex',
            gap: '4px',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {p.annotations.map((annotation) => (
            <AudienceAnnotationBadge key={annotation.id} annotation={annotation} />
          ))}
        </div>
      ))}
    </div>
  );
}

function commitAnnotationPlacements(cy: Core): readonly AnnotationRowPlacement[] {
  const next: AnnotationRowPlacement[] = [];
  // Snapshot the viewport zoom once per commit. `renderedBoundingBox`
  // below is already in zoomed/rendered pixels; the offset gaps and the
  // row scale derive from this single capture so the whole row tracks the
  // element at the current zoom.
  const zoom = cy.zoom();
  cy.nodes().forEach((node: NodeSingular) => {
    // Statement nodes render their node-targeted annotations INSIDE the
    // node HTML (`per_facet_step_pill` fold-in); the overlay only carries
    // annotations on non-statement (annotation graph-) nodes here, plus
    // every edge-targeted annotation below. An edge has no node box to
    // host its chips, so it must stay a floating row.
    if (node.data('nodeKind') === 'statement') return;
    const annotations = node.data('annotations') as readonly Annotation[] | undefined;
    if (annotations === undefined || annotations.length === 0) return;
    const bb = node.renderedBoundingBox();
    next.push({
      id: node.id(),
      x: (bb.x1 + bb.x2) / 2,
      y: bb.y2 + ANNOTATION_ROW_OFFSET_Y * zoom,
      zoom,
      annotations,
    });
  });
  cy.edges().forEach((edge: EdgeSingular) => {
    const annotations = edge.data('annotations') as readonly Annotation[] | undefined;
    if (annotations === undefined || annotations.length === 0) return;
    const bb = edge.renderedBoundingBox();
    next.push({
      id: edge.id(),
      x: (bb.x1 + bb.x2) / 2,
      y: (bb.y1 + bb.y2) / 2 + EDGE_ANNOTATION_OFFSET_Y * zoom,
      zoom,
      annotations,
    });
  });
  return next;
}

export default AudienceAnnotationOverlay;
