// `<GraphCanvasPane>` — ReactFlow mount for the moderator's graph
// canvas slot inside `<OperateLayout>`.
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md
// (prior:     tasks/refinements/moderator-ui/mod_proposed_state_styling.md,
//             tasks/refinements/moderator-ui/mod_annotation_rendering.md,
//             tasks/refinements/moderator-ui/mod_edge_rendering.md,
//             tasks/refinements/moderator-ui/mod_node_rendering.md,
//             tasks/refinements/moderator-ui/mod_graph_canvas_pane.md)
// ADR:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//
// The moderator surface is the interactive-edit profile per ADR 0004:
// ReactFlow's drag-to-create-edge ergonomics + first-class custom React
// components for nodes/edges are why it was picked here. The read-only
// surfaces (audience / participant tablet / replay) use Cytoscape; that
// split is the explicit price of letting each surface use the library
// that fits its interaction profile.
//
// `mod_graph_canvas_pane` landed the empty canvas. `mod_node_rendering`
// added the custom `StatementNode` type + the `projectNodes` event-log
// projection. `mod_edge_rendering` (this revision) layers in the custom
// `StatementEdge` type, the `edgeTypes` registry, and a store-derived
// edges projection via `selectEdgesForSession`. The component now wires
// nodes + edges from the same `useWsStore` events array. Downstream
// rendering tasks (annotations, state styling, pan-zoom polish,
// selection, context menus, draw-edge flow) continue to plug into the
// same `<ReactFlow>` tree.
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

import {
  useCallback,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import ReactFlow, { Background, type Edge, type Node, type NodeTypes } from 'reactflow';
import type { Event, StatementKind } from '@a-conversa/shared-types';

import 'reactflow/dist/style.css';

import { useSelectionStore } from '../stores/index.js';
import { useWsStore, type WsState } from '../ws/wsStore.js';
import { STATEMENT_NODE_TYPE, StatementNode, type StatementNodeData } from './StatementNode.js';
import { edgeTypes } from './edgeTypes.js';
import { GraphContextMenu, type MenuItem } from './GraphContextMenu.js';
import {
  EMPTY_DIAGNOSTIC_HIGHLIGHTS,
  projectDiagnosticHighlights,
  type DiagnosticHighlightIndex,
} from './diagnosticHighlights.js';
import { computeFacetStatuses, EMPTY_FACET_STATUSES } from './facetStatus.js';
import {
  EMPTY_ANNOTATIONS,
  EMPTY_AXIOM_MARKS,
  EMPTY_VOTES_BY_FACET,
  groupAnnotationsByNode,
  groupAxiomMarksByNode,
  projectAnnotations,
  projectAxiomMarks,
  projectVotesByFacet,
  selectEdgesForSession,
} from './selectors.js';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

/**
 * `nodeTypes` is declared at module scope, NOT inline on `<ReactFlow>`.
 * ReactFlow re-creates its internal node-type registry whenever the map
 * changes by referential identity; an inline `{ statement: StatementNode }`
 * would allocate a fresh object every render and fight ReactFlow's
 * internal memoization. One stable reference, registered once.
 *
 * `edgeTypes` is imported from `./edgeTypes` for the same reason — the
 * map is declared once at module scope of that file so the reference
 * stays stable across renders.
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
 * Stable empty `activeDiagnostics` reference. Same `===`-stable-across-
 * renders rationale as `EMPTY_EVENTS` — the Zustand selector returns
 * this constant for sessions with no active diagnostics so subscribers
 * don't re-render on every poll. Refinement: `mod_diagnostic_highlighting`.
 */
const EMPTY_ACTIVE_DIAGNOSTICS: ReadonlyMap<string, DiagnosticPayload> = new Map();

/**
 * Selection click handlers (refinement `mod_selection`).
 *
 * Hoisted to module scope so the handler references stay referentially
 * stable across `<GraphCanvasPane>` renders — ReactFlow's prop-diff for
 * `onNodeClick` / `onEdgeClick` / `onPaneClick` would otherwise see a
 * fresh function every render and fight its own memoization. The handlers
 * only WRITE to `useSelectionStore` (via `.getState()`); they don't read
 * its current value, so subscribing the canvas to the store would be
 * extra renders for no benefit.
 *
 * The store API is `select({ kind, id })` / `clear()` — matching the
 * `useSelectionStore` shape pinned by `mod_state_management`. Exported
 * for direct testing because ReactFlow's internal click pipeline (which
 * checks `nodeInternals.get(id)` from a store populated by ResizeObserver
 * measurements) doesn't fire in happy-dom; the test suite invokes these
 * handlers directly to pin the wire-up contract.
 */
export function handleNodeClick(_event: unknown, node: Node): void {
  useSelectionStore.getState().select({ kind: 'node', id: node.id });
}

export function handleEdgeClick(_event: unknown, edge: Edge): void {
  useSelectionStore.getState().select({ kind: 'edge', id: edge.id });
}

export function handlePaneClick(): void {
  useSelectionStore.getState().clear();
}

/**
 * Context-menu state on the canvas. `null` when no menu is open.
 *
 * Refinement: `mod_context_menus`. Carried as `useState` on the canvas
 * because the open-menu position is a transient UI fact tied to a
 * single component's lifetime — no other surface (right sidebar, mode
 * banner) reads it, so the scope stays honest. The `target` discriminator
 * matches the methodology vocabulary (node vs edge vs pane); `id` is
 * `null` for pane right-clicks (no target entity).
 */
export interface ContextMenuState {
  readonly target: { readonly kind: 'node' | 'edge' | 'pane'; readonly id: string | null };
  readonly x: number;
  readonly y: number;
}

/**
 * Action-handler stub. Refinement: `mod_context_menus`. **Downstream
 * tasks replace each stub with the real action handler** — this task
 * only delivers the menu shell, so every menu item calls into this
 * helper for now. The `target` carries enough info (`kind` + `id`) for
 * the downstream replacements to route to the correct
 * proposal / capture flow.
 *
 * The stub uses `console.info` (not `console.log`) so it's visible in
 * the browser devtools without being filtered as debug noise. Downstream
 * tasks remove the `console.info` line when wiring the real handler.
 */
function actionStub(action: string, target: ContextMenuState['target']): void {
  console.info(`menu action: ${action}`, target);
}

/**
 * Build the menu items for a node right-click. Refinement:
 * `mod_context_menus`. The action list (vote / decompose /
 * meta-disagreement / annotate / axiom-mark) is the methodology's
 * node-scope vocabulary; downstream tasks replace each item's
 * `onSelect` with the real handler. Exported for direct testing without
 * a React tree.
 */
export function buildNodeMenuItems(target: ContextMenuState['target']): readonly MenuItem[] {
  return [
    {
      id: 'propose-vote',
      labelKey: 'moderator.contextMenu.node.proposeVote',
      onSelect: () => actionStub('propose-vote', target),
    },
    {
      id: 'propose-decompose',
      labelKey: 'moderator.contextMenu.node.proposeDecompose',
      onSelect: () => actionStub('propose-decompose', target),
    },
    {
      id: 'propose-meta-disagreement',
      labelKey: 'moderator.contextMenu.node.proposeMetaDisagreement',
      onSelect: () => actionStub('propose-meta-disagreement', target),
    },
    {
      id: 'annotate',
      labelKey: 'moderator.contextMenu.node.annotate',
      onSelect: () => actionStub('annotate', target),
    },
    {
      id: 'axiom-mark',
      labelKey: 'moderator.contextMenu.node.axiomMark',
      onSelect: () => actionStub('axiom-mark', target),
    },
  ];
}

/**
 * Build the menu items for an edge right-click. Refinement:
 * `mod_context_menus`. Edges carry only the `substance` facet so the
 * action list is narrower than the node list — no axiom-mark (a
 * per-node concept), no decompose (a node operation). Vote / meta-
 * disagreement / annotate are the edge-scope vocabulary.
 */
export function buildEdgeMenuItems(target: ContextMenuState['target']): readonly MenuItem[] {
  return [
    {
      id: 'propose-vote',
      labelKey: 'moderator.contextMenu.edge.proposeVote',
      onSelect: () => actionStub('propose-vote', target),
    },
    {
      id: 'propose-meta-disagreement',
      labelKey: 'moderator.contextMenu.edge.proposeMetaDisagreement',
      onSelect: () => actionStub('propose-meta-disagreement', target),
    },
    {
      id: 'annotate',
      labelKey: 'moderator.contextMenu.edge.annotate',
      onSelect: () => actionStub('annotate', target),
    },
  ];
}

/**
 * Build the menu items for a pane right-click (empty-canvas context
 * menu). Refinement: `mod_context_menus`. v1 surfaces only "create new
 * statement" — mirrors the "new node" empty-canvas affordance in
 * desktop graph editors. Downstream review may add additional pane
 * actions; the menu shell already accepts an arbitrary `items` array.
 */
export function buildPaneMenuItems(target: ContextMenuState['target']): readonly MenuItem[] {
  return [
    {
      id: 'create-statement',
      labelKey: 'moderator.contextMenu.pane.createStatement',
      onSelect: () => actionStub('create-statement', target),
    },
  ];
}

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
 * - `annotation-created` (collected in a second pass) → bucket by
 *   `target_node_id` and enrich each matching node's `data.annotations`
 *   with the badges that target it.
 * - All other event kinds are ignored at this layer (edges, substance,
 *   decompose, etc. are downstream tasks).
 *
 * The function preserves event order: the `i`-th `node-created` event
 * gets the `i`-th grid slot. That's enough determinism for the
 * placeholder layout; the real layout engine ships with
 * `mod_layout_engine_choice`.
 */
export function projectNodes(
  events: readonly Event[],
  highlights: DiagnosticHighlightIndex = EMPTY_DIAGNOSTIC_HIGHLIGHTS,
): Node<StatementNodeData>[] {
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

  // Annotation enrichment is a separate pass — annotations target a
  // node by id and aren't gated on the proposal/commit dance, so a
  // single up-front projection + groupBy is cheaper than threading
  // through the main loop.
  const annotationsByNode = groupAnnotationsByNode(projectAnnotations(events));

  // Axiom-mark enrichment — same up-front-pass pattern. The axiom-mark
  // projection IS gated on the proposal + commit dance (only committed
  // marks are rendered as badges), but `projectAxiomMarks` encapsulates
  // that, so the enrichment loop here treats axiom-marks the same way
  // it treats annotations: project once, group by target node, attach
  // the matching subset to each emitted node. Refinement:
  // `mod_axiom_mark_decoration`.
  const axiomMarksByNode = groupAxiomMarksByNode(projectAxiomMarks(events));

  // Per-facet `FacetStatus` index for state-styling (refinement
  // `mod_proposed_state_styling`). Same single-pass-up-front pattern as
  // the annotation enrichment: cheaper than threading through the main
  // loop, and decouples the state-machine derivation from the node /
  // edge / annotation projection.
  const facetStatusIndex = computeFacetStatuses(events);

  // Per-node per-facet vote index — the per-participant vote dots inside
  // each facet pill. Same single-pass-up-front pattern. Refinement:
  // `mod_vote_indicators_on_graph`.
  const votesByFacetIndex = projectVotesByFacet(events);

  for (const event of events) {
    if (event.kind === 'node-created') {
      const i = nodes.length;
      const annotations = annotationsByNode.get(event.payload.node_id) ?? EMPTY_ANNOTATIONS;
      const facetStatuses =
        facetStatusIndex.nodes.get(event.payload.node_id) ?? EMPTY_FACET_STATUSES;
      const axiomMarks = axiomMarksByNode.get(event.payload.node_id) ?? EMPTY_AXIOM_MARKS;
      // Convert the per-node `Map<FacetName, Vote[]>` returned by
      // `projectVotesByFacet` to the `StatementNodeData.votesByFacet`
      // partial-record shape the renderer consumes. Empty / absent →
      // the shared `EMPTY_VOTES_BY_FACET` reference, keeping React /
      // ReactFlow memoization stable for the no-votes common case.
      const perNodeVotes = votesByFacetIndex.get(event.payload.node_id);
      const votesByFacet = perNodeVotes
        ? (Object.fromEntries(perNodeVotes) as StatementNodeData['votesByFacet'])
        : EMPTY_VOTES_BY_FACET;
      // Per-node diagnostic-highlight enrichment from the precomputed
      // index. Refinement: `mod_diagnostic_highlighting`. Absent ids
      // resolve to `undefined` (the `<StatementNode>` consumer reads
      // that as "no halo"). We omit the field entirely when undefined
      // so the equality check in the test suite's `toEqual({...})`
      // calls stays clean for the no-diagnostic baseline.
      const diagnosticHighlight = highlights.nodes.get(event.payload.node_id);
      const data: StatementNodeData =
        diagnosticHighlight === undefined
          ? {
              wording: event.payload.wording,
              kind: null,
              annotations,
              facetStatuses,
              axiomMarks,
              votesByFacet,
            }
          : {
              wording: event.payload.wording,
              kind: null,
              annotations,
              facetStatuses,
              axiomMarks,
              votesByFacet,
              diagnosticHighlight,
            };
      const node: Node<StatementNodeData> = {
        id: event.payload.node_id,
        type: STATEMENT_NODE_TYPE,
        position: {
          x: (i % GRID_COLS) * GRID_DX,
          y: Math.floor(i / GRID_COLS) * GRID_DY,
        },
        data,
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

  // Context-menu state — `null` when no menu is open. Set by the right-
  // click handlers below; cleared by the menu's `onClose`. Refinement:
  // `mod_context_menus`.
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Right-click handlers. Each `preventDefault()`s the native browser
  // context menu and opens our menu at the cursor coordinates. Node /
  // edge right-clicks also `select(...)` the target so the existing
  // selection ring (sky-500 from `mod_selection`) flips to the right-
  // clicked entity — mirrors desktop graph editors' "right-click selects
  // then opens menu" convention.
  const handleNodeContextMenu = useCallback((event: ReactMouseEvent, node: Node): void => {
    event.preventDefault();
    useSelectionStore.getState().select({ kind: 'node', id: node.id });
    setContextMenu({
      target: { kind: 'node', id: node.id },
      x: event.clientX,
      y: event.clientY,
    });
  }, []);
  const handleEdgeContextMenu = useCallback((event: ReactMouseEvent, edge: Edge): void => {
    event.preventDefault();
    useSelectionStore.getState().select({ kind: 'edge', id: edge.id });
    setContextMenu({
      target: { kind: 'edge', id: edge.id },
      x: event.clientX,
      y: event.clientY,
    });
  }, []);
  const handlePaneContextMenu = useCallback((event: ReactMouseEvent): void => {
    event.preventDefault();
    setContextMenu({
      target: { kind: 'pane', id: null },
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  // Per-session events selector. Scoping to `sessionState[sessionId]?.events`
  // means unrelated state changes (other sessions, connection status,
  // subscriptions) don't re-render the canvas — the WS store immutably
  // swaps the per-session record on `applyEvent`.
  const events = useWsStore((state) => state.sessionState[sessionId]?.events ?? EMPTY_EVENTS);
  // Per-session active-diagnostics selector. Same scoping rationale as
  // `events` — the canvas re-renders only when the active-diagnostic
  // set for THIS session flips (the WS store immutably swaps the
  // per-session record on `applyDiagnostic`). Refinement:
  // `mod_diagnostic_highlighting`.
  const activeDiagnostics = useWsStore(
    (state) => state.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_ACTIVE_DIAGNOSTICS,
  );

  // Compute the per-entity diagnostic-highlight index once per
  // memoization tick. The helper is pure over its input map; the
  // memoization dependency is the active-diagnostics reference, which
  // the store immutably swaps on each `applyDiagnostic` call. Empty
  // input returns the stable `EMPTY_DIAGNOSTIC_HIGHLIGHTS` reference so
  // the no-diagnostic baseline doesn't churn references downstream.
  const diagnosticHighlights = useMemo(
    () => projectDiagnosticHighlights(activeDiagnostics),
    [activeDiagnostics],
  );

  const nodes = useMemo(
    () => projectNodes(events, diagnosticHighlights),
    [events, diagnosticHighlights],
  );
  // `selectEdgesForSession` is a pure function over `WsState`; we build
  // the minimal `WsState`-shaped object from the events we already
  // subscribed to so the projection stays the single source of truth
  // for the wire-event → ReactFlow-edge mapping. Reading the live store
  // via `useWsStore.getState()` inside the `useMemo` would skip the
  // events subscription and risk a stale closure across renders.
  const edges = useMemo(
    () =>
      selectEdgesForSession(
        {
          sessionState: {
            [sessionId]: {
              lastAppliedSequence: 0,
              events: events as Event[],
              pendingProposals: {},
              activeDiagnostics: EMPTY_ACTIVE_DIAGNOSTICS,
            },
          },
        } as unknown as WsState,
        sessionId,
        diagnosticHighlights,
      ),
    [sessionId, events, diagnosticHighlights],
  );

  // Build the menu items for whatever the context menu currently targets.
  // The `items` are rebuilt on every render the menu is open, but that's
  // fine — the per-item `onSelect` closes over `contextMenu.target` and
  // gets fresh `target` data each render.
  let menuItems: readonly MenuItem[] = [];
  if (contextMenu !== null) {
    if (contextMenu.target.kind === 'node') {
      menuItems = buildNodeMenuItems(contextMenu.target);
    } else if (contextMenu.target.kind === 'edge') {
      menuItems = buildEdgeMenuItems(contextMenu.target);
    } else {
      menuItems = buildPaneMenuItems(contextMenu.target);
    }
  }

  return (
    <div data-testid="graph-canvas-root" className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeContextMenu={handleEdgeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
      >
        <Background />
      </ReactFlow>
      {contextMenu !== null ? (
        <GraphContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          targetKind={contextMenu.target.kind}
          targetId={contextMenu.target.id}
          items={menuItems}
          onClose={closeContextMenu}
        />
      ) : null}
    </div>
  );
}
