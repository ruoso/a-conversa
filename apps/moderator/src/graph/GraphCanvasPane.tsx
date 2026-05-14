// `<GraphCanvasPane>` — ReactFlow mount for the moderator's graph
// canvas slot inside `<OperateLayout>`.
//
// Refinement: tasks/refinements/moderator-ui/mod_graph_canvas_pane.md
// ADR:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//
// The moderator surface is the interactive-edit profile per ADR 0004:
// ReactFlow's drag-to-create-edge ergonomics + first-class custom React
// components for nodes are why it was picked here. The read-only
// surfaces (audience / participant tablet / replay) use Cytoscape; that
// split is the explicit price of letting each surface use the library
// that fits its interaction profile.
//
// This task lands the canvas as an empty mount: no nodes, no edges,
// no store wiring. Downstream tasks under `mod_graph_rendering` —
// `mod_node_rendering`, `mod_edge_rendering`, `mod_annotation_rendering`,
// the state-styling tasks, `mod_pan_zoom`, `mod_selection`,
// `mod_context_menus`, the draw-edge flow — read events from the WS
// store and fill the canvas in. This component owns: getting the
// ReactFlow tree on screen, sizing it to fill its slot, enabling the
// default pan + zoom interactions, drawing a background grid, and
// exposing the `graph-canvas-root` test id for downstream assertions.
//
// CSS coupling: `reactflow/dist/style.css` is imported here (not in
// `main.tsx`) so a surface that doesn't render the canvas doesn't
// pull the stylesheet. Vite handles the side-effect import; Tailwind
// utilities continue to work because Tailwind's stylesheet is imported
// from `src/index.css` independently.

import type { ReactElement } from 'react';
import ReactFlow, { Background } from 'reactflow';

import 'reactflow/dist/style.css';

export function GraphCanvasPane(): ReactElement {
  return (
    <div data-testid="graph-canvas-root" className="h-full w-full">
      <ReactFlow nodes={[]} edges={[]}>
        <Background />
      </ReactFlow>
    </div>
  );
}
