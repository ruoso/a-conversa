// `<GraphView>` — Cytoscape-powered read-mostly graph for the
// participant's operate route.
//
// Refinement: tasks/refinements/participant-ui/part_graph_render.md
// Refinement: tasks/refinements/participant-ui/part_per_facet_state_styling.md
//              (Stylesheet grows 14 per-status selectors per Decision §1;
//              the elements memo runs `computeFacetStatuses(events)` and
//              threads the index into `projectGraph`; the render returns
//              the existing graph-root div AND a sibling `<ul>` test
//              mirror so DOM-end tests can assert against the per-entity
//              status the Cytoscape canvas paints — Decision §4 covers
//              the testability rationale.)
// ADRs:
//   - 0004 (Cytoscape.js for the read-mostly participant tablet);
//   - 0024 (react-i18next + ICU — `methodology.kind.*` and
//           `methodology.edgeRole.<role>.label` are the only string
//           sources the view consumes);
//   - 0026 (host owns the WS provider; the surface consumes
//           `useWsStore` from its local singleton, which delegates to
//           the shell's `createDefaultWsStore`);
//   - 0027 (entity / facet layers are strictly separate; the projection
//           paints `node-created` events immediately, not at commit).
//
// Component shape (per the refinement's Component-shape section):
//
//   1. `useWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS)`
//      yields the per-session event log. The module-scope frozen empty
//      array keeps the selector reference-stable in the no-events case
//      (Zustand's reference-equality bailout).
//   2. A first `useMemo` runs `computeFacetStatuses(events)` ONCE per
//      events change to produce the per-entity per-facet status index
//      `projectGraph` consumes.
//   3. A second `useMemo` projects the events into Cytoscape element
//      descriptors via the pure `projectGraph` function (threaded with
//      the facet-status index), then enriches each node with a
//      `kindLabel` (em-dash for unclassified, localized
//      `methodology.kind.<kind>` otherwise) and each edge with a
//      `roleLabel` (localized `methodology.edgeRole.<role>.label`).
//      Localization runs at projection time so the Cytoscape
//      stylesheet's `label: 'data(...)'` selector binding stays a pure
//      data read. The localized mapper carries through `rollupStatus`
//      and `facetStatuses` from each `projectGraph` element onto the
//      Cytoscape data record so the stylesheet's
//      `node[rollupStatus = '<status>']` selectors fire.
//   4. A one-shot `useEffect` mounts the Cytoscape instance into the
//      ref'd container; the cleanup destroys it on unmount.
//   5. A second `useEffect` synchronises the elements on every memo
//      tick — `cy.json({ elements })` is Cytoscape's bulk-replace path
//      followed by a `cose` layout pass.
//
// The component returns a React fragment containing the Cytoscape mount
// `<div>` AND a sibling `aria-hidden` `<ul>` test mirror — one `<li>`
// per emitted node and one per emitted edge, each carrying the
// per-entity rollup + per-facet status as `data-*` attributes the
// Vitest / Playwright suites assert against (Cytoscape paints to
// `<canvas>` by default; the canvas pixels are not DOM-queryable so
// the mirror is the testability seam). The mirror is invisible to
// users + screen readers (`aria-hidden="true"` + `sr-only`).

import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import cytoscape, { type Core, type ElementDefinition, type StylesheetJson } from 'cytoscape';
import { useTranslation } from 'react-i18next';
import type { Event } from '@a-conversa/shared-types';

import { useWsStore } from '../ws/wsStore';
import { computeFacetStatuses, type FacetStatus } from './facetStatus';
import {
  projectGraph,
  type ParticipantEdgeElement,
  type ParticipantNodeElement,
} from './projectGraph';

/**
 * Stable empty-events reference for the per-session selector. Zustand
 * bails out of re-renders when the selector return value is
 * referentially equal; minting a fresh `[]` inside the selector would
 * defeat the bailout and force a re-render on every store mutation.
 * Same idiom the moderator's `GraphCanvasPane` uses.
 */
const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

/**
 * Cytoscape stylesheet — declared at module scope so the reference
 * stays stable across renders (mirroring the moderator's module-scope
 * `NODE_TYPES` idiom).
 *
 * The baseline `node` / `edge` selectors carry the `'none'` rollup
 * branch (Cytoscape selectors are cumulative — every node matches the
 * baseline AND its per-status branch, with later rules overriding
 * earlier ones). Per-status selectors then layer the
 * `border-style` / `border-color` / `background-color` / `opacity` /
 * `outline-*` overrides on top.
 *
 * The fixed `width: 200, height: 80` baseline addresses the
 * `width: 'label'` deprecation deferred by `part_graph_render` per
 * Decision §7 of the per-facet-state-styling refinement: keep the
 * numeric pair, lean on `text-wrap: 'wrap'` + `text-max-width: '180px'`
 * to make the wording fit within the 3-line budget the methodology's
 * "two short sentences" wording cap implies. Future visual-regression
 * work (`part_vr_state_styling`) can revisit if real-world wording
 * lengths break the 3-line budget.
 *
 * The per-status colour vocabulary maps verbatim from the moderator's
 * `PILL_STATUS_CLASSNAME` + `StatementNode` card-frame branches —
 * Decision §1 of this leaf's refinement walks through the mapping
 * table and the surface-specific adaptations (Cytoscape's
 * `outline-*` standing in for Tailwind's `ring-*`; the tinted fill
 * compensating for the lack of a true box-shadow ring).
 */
const STYLESHEET: StylesheetJson = [
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
      // Fixed numeric dimensions: Cytoscape ≥ 3.30 deprecated
      // `width: 'label'` / `height: 'label'` (the auto-sizing path the
      // moderator's ReactFlow tree gets implicitly). Per Decision §7 of
      // `part_per_facet_state_styling`, the baseline carries
      // `width: 200, height: 80` so the wrapped wording fits the 3-line
      // budget the methodology's "two short sentences" cap implies.
      width: 200,
      height: 80,
      padding: '12px',
      'font-size': '12px',
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
      'font-size': '10px',
      'text-background-color': '#ffffff',
      'text-background-opacity': 1,
      'text-background-padding': '2px',
      color: '#475569',
    },
  },
  // Per-status node branches — Decision §1 mapping table. Each branch
  // overrides border / fill / opacity on top of the baseline above;
  // the `'none'` rollup hits no override and stays at the baseline.
  {
    selector: 'node[rollupStatus = "proposed"]',
    style: {
      'border-style': 'dashed',
      'border-color': '#94a3b8', // slate-400
      'background-color': '#f8fafc', // slate-50 — slight tint
      opacity: 0.6,
    },
  },
  {
    selector: 'node[rollupStatus = "agreed"]',
    style: {
      'border-style': 'solid',
      'border-color': '#334155', // slate-700
      'background-color': '#ffffff',
      opacity: 1,
    },
  },
  {
    selector: 'node[rollupStatus = "disputed"]',
    style: {
      'border-style': 'solid',
      'border-color': '#e11d48', // rose-600
      'background-color': '#fff1f2', // rose-50 — slight tint
      'outline-color': '#f43f5e', // rose-500 — the "ring" analog
      'outline-width': 2,
      opacity: 1,
    },
  },
  {
    selector: 'node[rollupStatus = "meta-disagreement"]',
    style: {
      'border-style': 'double',
      'border-color': '#7c3aed', // violet-600
      'background-color': '#f5f3ff', // violet-50
      'outline-color': '#a78bfa', // violet-400
      'outline-width': 2,
      opacity: 1,
    },
  },
  {
    selector: 'node[rollupStatus = "committed"]',
    style: {
      'border-style': 'solid',
      'border-color': '#94a3b8', // slate-400 — closed-tone
      'background-color': '#ffffff',
      opacity: 0.9,
    },
  },
  {
    selector: 'node[rollupStatus = "withdrawn"]',
    style: {
      'border-style': 'dashed',
      'border-color': '#94a3b8', // slate-400 — retracted
      'background-color': '#f8fafc',
      opacity: 0.5,
    },
  },
  // Per-status edge branches — same vocabulary on the edge stroke; no
  // fill on edges. Cytoscape has no `double` line-style for edges, so
  // meta-disagreement uses solid violet (the colour carries the
  // signal; the violet hue is reserved on the surface for the
  // meta-disagreement layer).
  {
    selector: 'edge[rollupStatus = "proposed"]',
    style: {
      'line-style': 'dashed',
      'line-color': '#94a3b8',
      'target-arrow-color': '#94a3b8',
      opacity: 0.6,
    },
  },
  {
    selector: 'edge[rollupStatus = "agreed"]',
    style: {
      'line-style': 'solid',
      'line-color': '#334155',
      'target-arrow-color': '#334155',
      opacity: 1,
    },
  },
  {
    selector: 'edge[rollupStatus = "disputed"]',
    style: {
      'line-style': 'solid',
      'line-color': '#e11d48',
      'target-arrow-color': '#e11d48',
      opacity: 1,
    },
  },
  {
    selector: 'edge[rollupStatus = "meta-disagreement"]',
    style: {
      'line-style': 'solid',
      'line-color': '#7c3aed',
      'target-arrow-color': '#7c3aed',
      opacity: 1,
    },
  },
  {
    selector: 'edge[rollupStatus = "committed"]',
    style: {
      'line-style': 'solid',
      'line-color': '#94a3b8',
      'target-arrow-color': '#94a3b8',
      opacity: 0.9,
    },
  },
  {
    selector: 'edge[rollupStatus = "withdrawn"]',
    style: {
      'line-style': 'dashed',
      'line-color': '#94a3b8',
      'target-arrow-color': '#94a3b8',
      opacity: 0.5,
    },
  },
];

export interface GraphViewProps {
  /**
   * The id of the session whose event log feeds the projection. The
   * route reads the id from the URL via `useParams` and threads it
   * through.
   */
  readonly sessionId: string;
  /**
   * Optional callback receiving the Cytoscape `Core` handle. Mounts to
   * `null` on unmount. Reserved for downstream tasks
   * (`part_pan_zoom_tap`, `part_entity_detail_panel`) that need to
   * register interaction handlers without forking the component.
   *
   * Optional in this leaf — the rendering surface is the deliverable;
   * the seam keeps the future tasks' edit surface tight.
   */
  readonly cyRef?: (cy: Core | null) => void;
}

/**
 * Render a `data-rollup-status` attribute value. The projection emits
 * the literal sentinel string `'none'` when an entity has no facet
 * record; the mirror surfaces that value as-is so Playwright selectors
 * can match `[data-rollup-status="proposed"]` without accidentally
 * picking up `'none'` entities.
 */
function rollupAttr(status: FacetStatus | 'none'): string {
  return status;
}

/**
 * Render a per-facet `data-facet-*` attribute value. The projection
 * stores the facet record as `Partial<Record<FacetName, FacetStatus>>`;
 * the mirror surfaces the present-facet status verbatim and an empty
 * string for absent facets (Decision §4 — `[data-facet-classification]`
 * selectors then match both the "absent" and "present" states
 * explicitly, and tests don't conflate "no status" with "projection
 * forgot to stamp the field").
 */
function facetAttr(value: FacetStatus | undefined): string {
  return value ?? '';
}

export function GraphView({ sessionId, cyRef }: GraphViewProps): ReactElement {
  const { t } = useTranslation();
  const events = useWsStore((state) => state.sessionState[sessionId]?.events ?? EMPTY_EVENTS);
  const cyInstanceRef = useRef<Core | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // One-shot mount of the Cytoscape instance. The `useEffect`'s empty
  // dependency array keeps the instance stable across the component's
  // lifetime; element sync happens in a separate effect below.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const cy = cytoscape({
      container,
      style: STYLESHEET,
      elements: [],
      layout: { name: 'preset' },
    });
    cyInstanceRef.current = cy;
    cyRef?.(cy);
    return () => {
      cy.destroy();
      cyInstanceRef.current = null;
      cyRef?.(null);
    };
    // The `cyRef` callback is intentionally NOT a dependency — the
    // mount lifecycle owns the instance, not the consumer's callback
    // identity. If the consumer passes a new callback per render the
    // instance must NOT be re-created.
    // The repo does not run `react-hooks/exhaustive-deps` so no
    // suppression directive is required; this comment documents the
    // intent for the human reviewer.
  }, []);

  // Per-facet status index. Computed once per events change so the
  // derivation cost is paid once per WS frame, not per render.
  const facetStatusIndex = useMemo(() => computeFacetStatuses(events), [events]);

  // Raw projection — the per-element data the test mirror surfaces
  // verbatim and the localized memo below enriches for Cytoscape. Split
  // from the localized memo so the mirror has access to the per-element
  // status without re-running the projector. Dangling-edge filtering
  // runs at the localized layer (Cytoscape's `cy.add` complains about
  // unknown endpoints); the mirror lists exactly what the projector
  // emits before the filter — but the localized memo below also drops
  // dangling edges from the mirror to keep the two collections in
  // lockstep so a test can sanity-check the mirror against Cytoscape's
  // element set.
  const projected = useMemo<{
    nodes: ParticipantNodeElement[];
    edges: ParticipantEdgeElement[];
  }>(() => projectGraph(events, facetStatusIndex), [events, facetStatusIndex]);

  // Element sync — runs on every events / translation change. Cytoscape's
  // `cy.json({ elements })` bulk-replaces the element set; a layout pass
  // follows to position the nodes. `cose` is the bundled force-directed
  // layout (Decision §3 — no dagre dependency on the participant side).
  // The localized mapper carries through `rollupStatus` + `facetStatuses`
  // from each projected element onto the Cytoscape data record so the
  // per-status stylesheet selectors fire.
  const renderedEdges = useMemo<ParticipantEdgeElement[]>(() => {
    const nodeIds = new Set(projected.nodes.map((node) => node.data.id));
    // Drop edges whose source / target id has not been seen as a
    // `node-created` event. Cytoscape throws synchronously on
    // `cy.add({ group: 'edges', data: { source: '<unknown>', ... } })`,
    // so the lenient "render whatever the projection emits" behaviour
    // the moderator gets implicitly from ReactFlow has to be opt-in
    // here. The dropped edge re-materialises as soon as the missing
    // node lands in the per-session slice and the projection runs again.
    return projected.edges.filter(
      (edge) => nodeIds.has(edge.data.source) && nodeIds.has(edge.data.target),
    );
  }, [projected]);

  const elements = useMemo<ElementDefinition[]>(() => {
    const localizedNodes: ElementDefinition[] = projected.nodes.map((node) => ({
      group: 'nodes',
      data: {
        ...node.data,
        kindLabel: node.data.kind === null ? '—' : t(`methodology.kind.${node.data.kind}`),
      },
    }));
    const localizedEdges: ElementDefinition[] = renderedEdges.map((edge) => ({
      group: 'edges',
      data: {
        ...edge.data,
        roleLabel: t(`methodology.edgeRole.${edge.data.role}.label`),
      },
    }));
    return [...localizedNodes, ...localizedEdges];
  }, [projected, renderedEdges, t]);

  useEffect(() => {
    const cy = cyInstanceRef.current;
    if (cy === null) return;
    cy.json({ elements });
    // Skip the layout pass when the canvas has no measurable
    // viewport (e.g. a happy-dom test environment where
    // `cy.width()` reports 0). `cose` requires a non-zero
    // bounding box; calling `.run()` against a zero-sized
    // viewport throws inside the layout's `createLayoutInfo`.
    // The browser path always has a real viewport (the surface-
    // wide layout's `participant-main` region carries `1fr`);
    // a future leaf (`part_pan_zoom_tap`) can hook a
    // `ResizeObserver` to re-trigger the layout if the canvas
    // grows. Empty graphs also skip — the layout is a no-op.
    const width = cy.width();
    const height = cy.height();
    if (
      cy.elements().length === 0 ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return;
    }
    cy.layout({ name: 'cose', animate: false }).run();
  }, [elements]);

  return (
    <>
      <div ref={containerRef} data-testid="participant-graph-root" className="h-full w-full" />
      <ul data-testid="participant-graph-status-mirror" aria-hidden="true" className="sr-only">
        {projected.nodes.map((node) => (
          <li
            key={`node-${node.data.id}`}
            data-testid="participant-node-status"
            data-node-id={node.data.id}
            data-rollup-status={rollupAttr(node.data.rollupStatus)}
            data-facet-classification={facetAttr(node.data.facetStatuses.classification)}
            data-facet-substance={facetAttr(node.data.facetStatuses.substance)}
            data-facet-wording={facetAttr(node.data.facetStatuses.wording)}
          />
        ))}
        {renderedEdges.map((edge) => (
          <li
            key={`edge-${edge.data.id}`}
            data-testid="participant-edge-status"
            data-edge-id={edge.data.id}
            data-rollup-status={rollupAttr(edge.data.rollupStatus)}
            data-facet-substance={facetAttr(edge.data.facetStatuses.substance)}
          />
        ))}
      </ul>
    </>
  );
}
