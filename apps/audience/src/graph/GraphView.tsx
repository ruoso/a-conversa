// Audience-side Cytoscape.js mount.
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
// ADRs:
//   - 0004 (Cytoscape.js for the audience broadcast surface);
//   - 0022 (no throwaway verifications — Vitest pins the React-mount
//     behaviour, Playwright defers to `aud_session_url`);
//   - 0024 (react-i18next + ICU — `useTranslation()` is the
//     localization seam; this leaf consumes `methodology.kind.*` +
//     `methodology.edgeRole.<role>.label`, no new keys);
//   - 0026 (micro-frontend root app — the surface owns its mounted
//     region only; `useAudienceSession()` reads the WS event log from
//     the audience workspace's read-only state barrel);
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

import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import cytoscape, { type Core, type ElementDefinition, type StylesheetJson } from 'cytoscape';
import { useTranslation } from 'react-i18next';

import { useAudienceSession } from '../state/index.js';
import { projectGraph } from './projectGraph.js';

/**
 * Cytoscape stylesheet for the audience broadcast surface.
 *
 * Module-scope so the reference is stable across renders — Cytoscape
 * diffs by reference identity, not deep equality. Numeric `width: 200`
 * / `height: 80` is the validated post-deviation pattern: the
 * participant's status block documents that `width: 'label'` /
 * `height: 'label'` was deprecated by Cytoscape 3.33 and surfaces as a
 * `console.warn`, which the Vitest harness treats as a failure per
 * `vitest.setup.ts`. The audience adopts numeric width/height up-front
 * rather than rediscovering the deviation.
 *
 * Per-facet styling (proposed dashed / agreed solid / disputed marker /
 * meta-disagreement split) and decoration (axiom-mark badges,
 * annotation overlays, per-facet sub-states) plug in via sibling tasks
 * (`aud_proposed_styling`, `aud_axiom_mark_decoration`,
 * `aud_annotation_rendering`, …) that extend this stylesheet in their
 * own commits.
 */
export const STYLESHEET: StylesheetJson = [
  {
    selector: 'node',
    style: {
      shape: 'round-rectangle',
      'background-color': '#ffffff',
      'border-width': 1,
      'border-color': '#cbd5e1',
      label: 'data(wording)',
      'text-wrap': 'wrap',
      'text-max-width': '180px',
      color: '#0f172a',
      'text-valign': 'center',
      'text-halign': 'center',
      width: 200,
      height: 80,
      'font-size': 12,
    },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      'line-color': '#94a3b8',
      'target-arrow-color': '#94a3b8',
      'target-arrow-shape': 'triangle',
      label: 'data(roleLabel)',
      'font-size': 10,
      'text-background-color': '#ffffff',
      'text-background-opacity': 1,
      'text-background-padding': '2px',
      color: '#475569',
    },
  },
];

/**
 * Layout options for the new-node placement pass.
 *
 * `breadthfirst` (bundled) lays out new nodes in layered BFS order,
 * respecting each node's `outerWidth()` / `outerHeight()` via
 * `avoidOverlap`. The participant's `part_graph_render` Decision §3
 * documented the upstream `cose` width/height swap that the audience
 * inherits as a "do not use cose" precedent; `breadthfirst` is the
 * validated baseline.
 *
 * `animate: false` matches the participant's choice for the same
 * reason: an animated layout pass on every event arrival makes
 * pixel-comparison testing impossible and competes with the dedicated
 * `aud_animations.*` task group. `fit: false` keeps the viewport
 * stable so re-layout-on-new-node doesn't snap the canvas every time
 * a new entity arrives.
 */
export const BREADTHFIRST_LAYOUT_OPTIONS = {
  name: 'breadthfirst' as const,
  directed: true,
  circle: false,
  grid: false,
  avoidOverlap: true,
  spacingFactor: 1.25,
  nodeDimensionsIncludeLabels: false,
  padding: 30,
  animate: false,
  fit: false,
};

export interface AudienceGraphViewProps {
  /**
   * Optional callback fired with the Cytoscape `Core` instance on
   * mount and `null` on unmount. The Vitest layer consumes this seam
   * to capture the instance for `cy.elements()` assertions; the
   * audience does NOT expose a `window.__aConversaAudienceCyInstance`
   * test seam (Decision §8).
   */
  readonly cyRef?: (cy: Core | null) => void;
}

export function AudienceGraphView({ cyRef }: AudienceGraphViewProps): ReactElement {
  const { t } = useTranslation();
  const { events } = useAudienceSession();
  const cyInstanceRef = useRef<Core | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Track node ids the component has already seen so the element-sync
  // effect can decide whether to run a `breadthfirst` layout pass.
  // `useRef` (not `useState`) because writes happen AFTER layout
  // completes and MUST NOT trigger a re-render — the events memo
  // already drives the re-render cadence.
  const knownNodeIdsRef = useRef<Set<string>>(new Set());
  // Position cache mirrored from the participant's pattern: cache
  // every emitted node's `{x, y}` after each layout pass so cy.json
  // re-applies them on the next tick. The audience baseline has no
  // selection / vote / annotation re-projection — but downstream
  // siblings (axiom-mark decoration, annotation rendering) will, and
  // the cache pays its dust once those land.
  const positionCacheRef = useRef<Map<string, { x: number; y: number }>>(new Map());

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
    cyRef?.(cy);
    return () => {
      cy.destroy();
      cyInstanceRef.current = null;
      cyRef?.(null);
      knownNodeIdsRef.current = new Set();
      positionCacheRef.current = new Map();
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
  // node id appears; existing-only re-projections (the empty
  // baseline today, decoration ticks once sibling tasks land) skip
  // the layout.
  useEffect(() => {
    const cy = cyInstanceRef.current;
    if (cy === null) return;
    const trulyNewNodeIds: string[] = [];
    for (const element of elements) {
      if (element.group !== 'nodes') continue;
      const id = element.data?.id;
      if (typeof id !== 'string') continue;
      if (!knownNodeIdsRef.current.has(id)) trulyNewNodeIds.push(id);
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
    if (cy.elements().length > 0 && viewportReady && trulyNewNodeIds.length > 0) {
      cy.layout(BREADTHFIRST_LAYOUT_OPTIONS).run();
    }
    cy.nodes().forEach((node) => {
      const position = node.position();
      positionCacheRef.current.set(node.id(), { x: position.x, y: position.y });
      knownNodeIdsRef.current.add(node.id());
    });
  }, [elements]);

  return <div ref={containerRef} data-testid="audience-graph-root" className="h-full w-full" />;
}
