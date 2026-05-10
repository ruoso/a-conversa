// Stack-validation smoke test for ADR 0004 (Graph libraries: ReactFlow + Cytoscape.js).
// Constructs a headless Cytoscape.js instance with two nodes (N1, N2) and one
// "supports" edge, then logs the element count to prove the graph was built.
// Cytoscape runs headless in Node — no DOM needed. Run with
// `npm run smoke:cytoscape` after `npm install`. Throwaway — will be removed
// when the audience / participant / replay workspaces land.

import cytoscape from 'cytoscape';

const cy = cytoscape({
  headless: true,
  styleEnabled: false,
  elements: [
    { group: 'nodes', data: { id: 'N1', label: 'Statement N1' } },
    { group: 'nodes', data: { id: 'N2', label: 'Statement N2' } },
    {
      group: 'edges',
      data: { id: 'E1', source: 'N1', target: 'N2', role: 'supports' },
    },
  ],
});

const total = cy.elements().length;
const nodes = cy.nodes().length;
const edges = cy.edges().length;
console.log(`cytoscape ok: ${total} elements (${nodes} nodes, ${edges} edges)`);

if (total !== 3 || nodes !== 2 || edges !== 1) {
  console.error('smoke test failed: expected 2 nodes + 1 edge');
  process.exit(1);
}
