// ReactFlow `edgeTypes` registry for the moderator canvas.
//
// Refinement: tasks/refinements/moderator-ui/mod_edge_rendering.md
//
// A single entry maps the wire-format `type: 'statement'` (emitted by
// `selectEdgesForSession`) to the `<StatementEdge>` custom component.
// The map is `as const` so ReactFlow's `Object.keys`-based dirty-check
// stays stable across renders (a fresh object literal each render would
// trigger ReactFlow to think the edge-type registry changed and rebuild
// it).
//
// Co-locating the map in its own module — separate from `StatementEdge`
// — lets the test suite reference the exact map the canvas does without
// pulling the i18n / react-i18next import chain a pure-function test
// doesn't need.

import type { EdgeTypes } from 'reactflow';

import { StatementEdge } from './StatementEdge.js';

export const edgeTypes: EdgeTypes = {
  statement: StatementEdge,
};
