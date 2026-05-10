// Stack-validation smoke test for ADR 0004 (Graph libraries: ReactFlow + Cytoscape.js).
// Renders a minimal ReactFlow tree with two nodes (N1, N2) and one "supports"
// edge to a string via react-dom/server. ReactFlow's runtime layout needs a
// real DOM; this test validates that the import resolves and the React tree
// constructs without crashing — enough to prove the stack hangs together.
// Run with `npm run smoke:reactflow` after `npm install`. Throwaway — will be
// removed when the moderator-ui workspace lands as part of repo-skeleton work.

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import ReactFlow, { type Edge, type Node } from 'reactflow';

const nodes: Node[] = [
  { id: 'N1', position: { x: 0, y: 0 }, data: { label: 'Statement N1' } },
  { id: 'N2', position: { x: 200, y: 100 }, data: { label: 'Statement N2' } },
];

const edges: Edge[] = [{ id: 'E1', source: 'N1', target: 'N2', label: 'supports' }];

function Hello(): React.ReactElement {
  return React.createElement(
    'div',
    { style: { width: 400, height: 300 } },
    React.createElement(ReactFlow, { nodes, edges }),
  );
}

const html = renderToString(React.createElement(Hello));
console.log(`reactflow ok: rendered ${html.length} chars of markup`);

// ReactFlow defers most rendering until after a DOM mount measures the viewport,
// so the SSR output is intentionally sparse — proving the React tree built and
// the import resolved is the goal here, not a pixel-perfect render.
if (html.length === 0) {
  console.error('smoke test failed: empty render output');
  process.exit(1);
}
