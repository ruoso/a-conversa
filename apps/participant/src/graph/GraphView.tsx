// `<GraphView>` — Cytoscape-powered read-mostly graph for the
// participant's operate route.
//
// Refinement: tasks/refinements/participant-ui/part_graph_render.md
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
//   2. `useMemo` projects the events into Cytoscape element descriptors
//      via the pure `projectGraph` function, then enriches each node
//      with a `kindLabel` (em-dash for unclassified, localized
//      `methodology.kind.<kind>` otherwise) and each edge with a
//      `roleLabel` (localized `methodology.edgeRole.<role>.label`).
//      Localization runs at projection time so the Cytoscape
//      stylesheet's `label: 'data(...)'` selector binding stays a pure
//      data read.
//   3. A one-shot `useEffect` mounts the Cytoscape instance into the
//      ref'd container; the cleanup destroys it on unmount.
//   4. A second `useEffect` synchronises the elements on every memo
//      tick — `cy.json({ elements })` is Cytoscape's bulk-replace path
//      followed by a `cose` layout pass.
//
// The component returns a single test-id'd container; Cytoscape paints
// inside it imperatively (React is not in the per-node render loop —
// Decision §2 documents the trade-off vs. a DOM-overlay or
// `cytoscape-node-html-label` plugin).

import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import cytoscape, { type Core, type ElementDefinition, type StylesheetJson } from 'cytoscape';
import { useTranslation } from 'react-i18next';
import type { Event } from '@a-conversa/shared-types';

import { useWsStore } from '../ws/wsStore';
import { projectGraph } from './projectGraph';

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
 * `NODE_TYPES` idiom). Decision §2 keeps the per-node body rendered
 * via Cytoscape's built-in `label` selector rather than a DOM-overlay
 * or the `cytoscape-node-html-label` plugin (the rendering is simple
 * enough that the plugin would be net dependency-debt for v1).
 *
 * The kind label is drawn via a second stylesheet entry that targets
 * the `[kindLabel]` data attribute — Cytoscape's selector engine
 * picks every node with a non-empty `data.kindLabel` and renders the
 * tag below the wording via `text-margin-y`.
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
      // moderator's ReactFlow tree gets implicitly). The participant
      // surface lives with a reasonable rectangle for v1; the per-
      // facet styling layer (sibling task `part_per_facet_state_styling`)
      // can revisit if a tighter fit is needed.
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

  // Element sync — runs on every events / translation change. Cytoscape's
  // `cy.json({ elements })` bulk-replaces the element set; a layout pass
  // follows to position the nodes. `cose` is the bundled force-directed
  // layout (Decision §3 — no dagre dependency on the participant side).
  const elements = useMemo<ElementDefinition[]>(() => {
    const { nodes, edges } = projectGraph(events);
    const nodeIds = new Set<string>();
    const localizedNodes: ElementDefinition[] = nodes.map((node) => {
      nodeIds.add(node.data.id);
      return {
        group: 'nodes',
        data: {
          ...node.data,
          kindLabel: node.data.kind === null ? '—' : t(`methodology.kind.${node.data.kind}`),
        },
      };
    });
    // Drop edges whose source / target id has not been seen as a
    // `node-created` event. Cytoscape throws synchronously on
    // `cy.add({ group: 'edges', data: { source: '<unknown>', ... } })`,
    // so the lenient "render whatever the projection emits" behaviour
    // the moderator gets implicitly from ReactFlow has to be opt-in
    // here. The drop matches the refinement's stated behaviour:
    // "Cytoscape simply skips drawing them — same lenient behaviour
    // the moderator inherits". The dropped edge re-materialises as
    // soon as the missing node lands in the per-session slice and
    // the projection runs again.
    const localizedEdges: ElementDefinition[] = [];
    for (const edge of edges) {
      if (!nodeIds.has(edge.data.source) || !nodeIds.has(edge.data.target)) continue;
      localizedEdges.push({
        group: 'edges',
        data: {
          ...edge.data,
          roleLabel: t(`methodology.edgeRole.${edge.data.role}.label`),
        },
      });
    }
    return [...localizedNodes, ...localizedEdges];
  }, [events, t]);

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

  return <div ref={containerRef} data-testid="participant-graph-root" className="h-full w-full" />;
}
