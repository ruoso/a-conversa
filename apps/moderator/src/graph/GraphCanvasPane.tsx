// `<GraphCanvasPane>` — ReactFlow mount for the moderator's graph
// canvas slot inside `<OperateLayout>`.
//
// Refinement: tasks/refinements/moderator-ui/mod_node_rendering.md
// (prior:     tasks/refinements/moderator-ui/mod_graph_canvas_pane.md)
// ADR:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//
// The moderator surface is the interactive-edit profile per ADR 0004:
// ReactFlow's drag-to-create-edge ergonomics + first-class custom React
// components for nodes are why it was picked here. The read-only
// surfaces (audience / participant tablet / replay) use Cytoscape; that
// split is the explicit price of letting each surface use the library
// that fits its interaction profile.
//
// `mod_graph_canvas_pane` landed the empty canvas. `mod_node_rendering`
// (this revision) adds: a `StatementNode` custom node type, an event
// projection that turns the session's `events: Event[]` into ReactFlow
// `Node<StatementNodeData>[]`, and the `sessionId` prop the projection
// keys off of. Downstream rendering tasks (edges, annotations, state
// styling, pan-zoom polish, selection, context menus, draw-edge flow)
// continue to plug into the same `<ReactFlow>` tree.
//
// **Layout note.** Node positioning is owned by `mod_layout_engine_choice`
// (a separate task). Until then this component lays nodes out on a
// deterministic grid keyed by their `node-created` event sequence — the
// minimum that keeps nodes from stacking on top of each other and keeps
// the test assertions concrete.
//
// CSS coupling: `reactflow/dist/style.css` is imported here (not in
// `main.tsx`) so a surface that doesn't render the canvas doesn't
// pull the stylesheet. Vite handles the side-effect import; Tailwind
// utilities continue to work because Tailwind's stylesheet is imported
// from `src/index.css` independently.

import { useMemo, type ReactElement } from 'react';
import ReactFlow, { Background, type Node, type NodeTypes } from 'reactflow';
import type { Event, StatementKind } from '@a-conversa/shared-types';

import 'reactflow/dist/style.css';

import { useWsStore } from '../ws/wsStore.js';
import { STATEMENT_NODE_TYPE, StatementNode, type StatementNodeData } from './StatementNode.js';

/**
 * `nodeTypes` is declared at module scope, NOT inline on `<ReactFlow>`.
 * ReactFlow re-creates its internal node-type registry whenever the map
 * changes by referential identity; an inline `{ statement: StatementNode }`
 * would allocate a fresh object every render and fight ReactFlow's
 * internal memoization. One stable reference, registered once.
 */
const NODE_TYPES: NodeTypes = {
  [STATEMENT_NODE_TYPE]: StatementNode,
};

/**
 * Grid width: this many nodes per row before wrapping. Coupled with
 * `GRID_DX` / `GRID_DY` it determines the deterministic placeholder
 * layout — superseded once `mod_layout_engine_choice` lands.
 */
const GRID_COLS = 4;
const GRID_DX = 240;
const GRID_DY = 140;

/**
 * Empty array used as the selector fallback when a session hasn't
 * received any events yet. Defined at module scope so the `===`
 * reference stays stable across renders and the Zustand selector
 * doesn't trigger an extra render on every poll.
 */
const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

/**
 * Pure projection from a session's event log to ReactFlow nodes.
 *
 * Exported so the projection can be unit-tested without a React tree.
 *
 * Today's rules:
 * - `node-created` → emit a `Node<StatementNodeData>` with `id =
 *   payload.node_id`, `data.wording = payload.wording`, and
 *   `data.kind = null` (unclassified until a classify-node proposal
 *   commits).
 * - `commit` whose referenced proposal is `classify-node` → set the
 *   matching node's `data.kind` to the proposal's `classification`.
 * - All other event kinds are ignored at this layer (edges,
 *   annotations, substance, decompose, etc. are downstream tasks).
 *
 * The function preserves event order: the `i`-th `node-created` event
 * gets the `i`-th grid slot. That's enough determinism for the
 * placeholder layout; the real layout engine ships with
 * `mod_layout_engine_choice`.
 */
export function projectNodes(events: readonly Event[]): Node<StatementNodeData>[] {
  // First pass: collect node-created events in arrival order, alongside
  // a map from node id to the array index (so we can apply later
  // classification commits without re-scanning).
  const nodes: Node<StatementNodeData>[] = [];
  const nodeIndexById = new Map<string, number>();
  // Map from proposal envelope id to (node id, classification) for
  // classify-node proposals — used when a commit later references one.
  const pendingClassifications = new Map<
    string,
    { nodeId: string; classification: StatementKind }
  >();

  for (const event of events) {
    if (event.kind === 'node-created') {
      const i = nodes.length;
      const node: Node<StatementNodeData> = {
        id: event.payload.node_id,
        type: STATEMENT_NODE_TYPE,
        position: {
          x: (i % GRID_COLS) * GRID_DX,
          y: Math.floor(i / GRID_COLS) * GRID_DY,
        },
        data: {
          wording: event.payload.wording,
          kind: null,
        },
      };
      nodes.push(node);
      nodeIndexById.set(event.payload.node_id, i);
      continue;
    }

    if (event.kind === 'proposal') {
      const inner = event.payload.proposal;
      if (inner.kind === 'classify-node') {
        pendingClassifications.set(event.id, {
          nodeId: inner.node_id,
          classification: inner.classification,
        });
      }
      continue;
    }

    if (event.kind === 'commit') {
      const proposal = pendingClassifications.get(event.payload.proposal_id);
      if (proposal === undefined) continue;
      const idx = nodeIndexById.get(proposal.nodeId);
      if (idx === undefined) continue;
      const existing = nodes[idx];
      if (existing === undefined) continue;
      // Replace the node with a new object so referential identity
      // changes — ReactFlow will pick up the updated `data` on the
      // next render.
      nodes[idx] = {
        ...existing,
        data: {
          ...existing.data,
          kind: proposal.classification,
        },
      };
      continue;
    }
  }

  return nodes;
}

export interface GraphCanvasPaneProps {
  /**
   * The id of the session whose nodes are projected onto the canvas.
   * Threaded through from `Operate.tsx` (`/sessions/:id/operate`).
   */
  readonly sessionId: string;
}

export function GraphCanvasPane(props: GraphCanvasPaneProps): ReactElement {
  const { sessionId } = props;

  // Per-session events selector. Scoping to `sessionState[sessionId]?.events`
  // means unrelated state changes (other sessions, connection status,
  // subscriptions) don't re-render the canvas — the WS store immutably
  // swaps the per-session record on `applyEvent`.
  const events = useWsStore((state) => state.sessionState[sessionId]?.events ?? EMPTY_EVENTS);

  const nodes = useMemo(() => projectNodes(events), [events]);

  return (
    <div data-testid="graph-canvas-root" className="h-full w-full">
      <ReactFlow nodes={nodes} edges={[]} nodeTypes={NODE_TYPES}>
        <Background />
      </ReactFlow>
    </div>
  );
}
