// `<GraphCanvasPane>` — ReactFlow mount for the moderator's graph
// canvas slot inside `<OperateLayout>`.
//
// Refinement: tasks/refinements/moderator-ui/mod_layout_engine_choice.md
// (prior:     tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md,
//             tasks/refinements/moderator-ui/mod_proposed_state_styling.md,
//             tasks/refinements/moderator-ui/mod_annotation_rendering.md,
//             tasks/refinements/moderator-ui/mod_edge_rendering.md,
//             tasks/refinements/moderator-ui/mod_node_rendering.md,
//             tasks/refinements/moderator-ui/mod_graph_canvas_pane.md)
// ADRs:       docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md,
//             docs/adr/0025-graph-layout-engine-dagre.md
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
// **Layout note.** Node positioning is delegated to `applyLayout` from
// `./layoutEngine` (refinement `mod_layout_engine_choice`, pinned by
// ADR 0025). The engine runs a Sugiyama-style hierarchical layout via
// `@dagrejs/dagre` on every `useMemo([events, diagnosticHighlights,
// edges])` tick; positions for previously-laid-out nodes are cached in
// a `useRef<Map<id, {x, y}>>` so existing nodes never move on
// incremental events (only new nodes feed dagre alongside the cached
// neighbours). `projectNodes` no longer emits placeholder grid
// coordinates — every emitted node starts at `(0, 0)` and the layout
// pass overwrites that with a dagre-derived placement.
//
// CSS coupling: `reactflow/dist/style.css` is imported here (not in
// `main.tsx`) so a surface that doesn't render the canvas doesn't
// pull the stylesheet. Vite handles the side-effect import; Tailwind
// utilities continue to work because Tailwind's stylesheet is imported
// from `src/index.css` independently.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import ReactFlow, {
  Background,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  useStore,
  useStoreApi,
  type Edge,
  type Node,
  type NodeTypes,
  type ReactFlowState,
  type XYPosition,
} from 'reactflow';
import { useTranslation } from 'react-i18next';
import type { Event, StatementKind } from '@a-conversa/shared-types';

import 'reactflow/dist/style.css';

import { useSelectionStore } from '../stores/index.js';
import { useWsStore, type WsState } from '../ws/wsStore.js';
import { STATEMENT_NODE_TYPE, StatementNode, type StatementNodeData } from './StatementNode.js';
import { edgeTypes } from './edgeTypes.js';
import { GraphContextMenu, type MenuItem } from './GraphContextMenu.js';
import { applyLayout } from './layoutEngine.js';
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
 *
 * **`onCreateStatement` seam.** The canvas threads in a real handler
 * that focuses the bottom-strip capture textarea (ad-hoc fix for the
 * pane-menu placeholder shipped in `mod_context_menus`). When omitted
 * (direct unit-test invocations from `buildPaneMenuItems.test.tsx`),
 * the legacy `actionStub` is used so the existing factory-shape cases
 * keep passing without each test having to thread a stub. Capture-pane
 * state (text / classification / target / role) is deliberately NOT
 * cleared — the menu only re-orients the operator's focus to the pane;
 * the auto-stage target chip is a convenience the moderator may want
 * to keep on a fresh wording.
 */
export function buildPaneMenuItems(
  target: ContextMenuState['target'],
  onCreateStatement?: () => void,
): readonly MenuItem[] {
  return [
    {
      id: 'create-statement',
      labelKey: 'moderator.contextMenu.pane.createStatement',
      onSelect: onCreateStatement ?? (() => actionStub('create-statement', target)),
    },
  ];
}

/**
 * Focus the bottom-strip capture textarea. Ad-hoc fix for the pane
 * context-menu "Create new statement" item — the menu's `onClose`
 * fires synchronously right after `onSelect`, and the
 * `<GraphContextMenu>` listens at the window level for the same
 * `mousedown` that opens it, so an immediate `.focus()` can race with
 * the close-path's React state churn. Defer to the next animation
 * frame so the menu unmounts first, then focus the textarea.
 *
 * The textarea's `data-testid` is set in `CaptureTextInput.tsx`; the
 * selector here is the single source of truth used by both this
 * focus seam and the Playwright spec.
 */
export function focusCaptureTextarea(): void {
  if (typeof window === 'undefined') return;
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="capture-text-input-textarea"]',
    );
    el?.focus();
  });
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
 * The function preserves event order. Position assignment is deferred
 * to `applyLayout` from `./layoutEngine` (refinement
 * `mod_layout_engine_choice`, pinned by ADR 0025); every node emitted
 * here carries the placeholder `position: { x: 0, y: 0 }`, which the
 * layout pass overwrites on the next memoization tick inside
 * `<GraphCanvasPane>`.
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
        // Placeholder origin — `applyLayout` overwrites this with a
        // dagre-derived position before the node reaches `<ReactFlow>`.
        // See the module header's "Layout note".
        position: { x: 0, y: 0 },
        data,
      };
      nodeIndexById.set(event.payload.node_id, nodes.length);
      nodes.push(node);
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

/**
 * Selector hash for the measurement-driven re-layout.
 *
 * Refinement: `mod_layout_measured_dimensions`.
 *
 * `useStore` re-renders the subscribing component when its selector
 * return value changes by referential equality. Returning the live
 * `state.nodeInternals` Map per-render would either (a) allocate a new
 * Map on every render (cheap but defeats memoization in selector
 * subscribers downstream) or (b) return the same Map reference but
 * mutated in place (which React / Zustand would NOT see as changed).
 *
 * Instead, we return a numeric hash derived from each measured node's
 * `id + width + height`. The hash is deterministic given a fixed set of
 * measured rects, and changes if and only if at least one rect changes.
 * The effect that reads the actual rects then pulls them off
 * `useStoreApi().getState().nodeInternals` synchronously — same idiom
 * the ReactFlow docs document for "subscribe to a derived signal,
 * read the live state in the effect."
 *
 * `nodesInitialized` is folded into the hash so the effect fires once
 * the gate flips; before that, every node has `width == null` so the
 * hash stays at 0 regardless of partial measurements.
 */
function selectMeasurementRevision(state: ReactFlowState): number {
  let acc = 0;
  for (const node of state.nodeInternals.values()) {
    if (node.width == null || node.height == null) continue;
    if (node.width <= 0 || node.height <= 0) continue;
    // Deterministic order-insensitive hash over (id, width, height).
    // Stringify the id so the per-id hash differs across ids; multiply
    // width by a prime so width vs height swaps produce a different
    // hash. Order independence is the load-bearing property — Map
    // iteration order is insertion order, which is stable enough for
    // our purposes, but accumulating with `+=` rather than position-
    // dependent shifts keeps the hash robust against future iteration-
    // order changes.
    let idHash = 0;
    for (let i = 0; i < node.id.length; i += 1) {
      idHash = (idHash * 31 + node.id.charCodeAt(i)) | 0;
    }
    acc = (acc + idHash + Math.round(node.width) * 131 + Math.round(node.height)) | 0;
  }
  return acc;
}

/**
 * **Measurement aftershock debounce, ms.** Refinement:
 * `mod_layout_measured_dimensions`. Per-facet decoration rows can fire
 * a chain of `ResizeObserver` callbacks as the catalog text and CSS
 * settle; debouncing 75 ms absorbs the cascade without firing N
 * intermediate re-layouts on a single content tick. Empirically tight
 * enough to feel responsive (well under one perceptual "moment" of
 * 100–150 ms) and loose enough to coalesce a typical decoration
 * cascade. Upper bound on re-layout latency after the last measurement
 * change: ~75 ms + one render cycle + one dagre pass — well under the
 * 100 ms budget ADR 0025 set for the constant-dimension layout pass.
 */
const MEASUREMENT_DEBOUNCE_MS = 75;

/**
 * **Minimum dimension delta to evict a cached position, px.** A
 * measurement that arrives within 1 px of the cached value does NOT
 * trigger a re-layout — sub-pixel jitter (browser zoom, scrollbar
 * artifact, font hinting) shouldn't churn the canvas. The 1 px
 * threshold is the same "ignore measurement noise" idiom the
 * `auth-flow.spec.ts` 2 px tolerance uses on the rendered side.
 * Refinement: `mod_layout_measured_dimensions`.
 */
const DIMENSION_CHANGE_THRESHOLD_PX = 1;

/**
 * **Pan/zoom range, in viewport-transform units.** Refinement:
 * `mod_pan_zoom`. ReactFlow's defaults are `0.5` / `2` — too tight for
 * a moderator debate with up to ~100 nodes. The lower bound supports a
 * true overview of a dense canvas; the upper bound supports close-
 * reading single-card wording detail. The `fitView({ padding: 0.1 })`
 * call inside `handleTidyUp` is bounded to this same range — ReactFlow
 * clamps fitView's computed zoom to `[minZoom, maxZoom]` automatically.
 * Exported so `GraphCanvasPane.test.tsx` asserts against the same
 * source of truth the production code reads (no magic numbers in
 * tests, no drift).
 */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2.5;

export function GraphCanvasPane(props: GraphCanvasPaneProps): ReactElement {
  // Wrap the inner canvas in `<ReactFlowProvider>` so the measurement
  // hooks (`useNodesInitialized` / `useStore`) — which read the same
  // store ReactFlow stamps `width` / `height` on after every
  // `ResizeObserver` callback — can run as siblings of `<ReactFlow>`.
  // Without an explicit provider, ReactFlow auto-creates one INSIDE its
  // own tree; we'd have no place to mount the measurement effect.
  // Refinement: `mod_layout_measured_dimensions`.
  return (
    <ReactFlowProvider>
      <GraphCanvasPaneInner {...props} />
    </ReactFlowProvider>
  );
}

function GraphCanvasPaneInner(props: GraphCanvasPaneProps): ReactElement {
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

  // Position cache for the incremental layout pass (refinement
  // `mod_layout_engine_choice`, ADR 0025). Nodes whose id is in the
  // cache reuse their previous `{x, y}` verbatim; only new nodes feed
  // dagre alongside the cached neighbours. `useRef` (not `useState`):
  // writes to the cache happen AFTER the `useMemo` returns and MUST
  // NOT trigger a re-render — the `useMemo` deps already drive the
  // re-render cadence. The cache is per-component-instance, so route
  // navigation that unmounts / remounts `<GraphCanvasPane>` starts
  // fresh (intended semantics for "the moderator left and came back").
  const positionCacheRef = useRef<Map<string, XYPosition>>(new Map());
  // Measurement cache — the per-id `{width, height}` map fed to dagre
  // via `LayoutOptions.dimensions`. Populated by the debounced
  // measurement effect below, read inside the `nodes` `useMemo`.
  // Refinement: `mod_layout_measured_dimensions`.
  const measurementCacheRef = useRef<Map<string, { width: number; height: number }>>(new Map());
  // Pending evictions — ids whose measured rect changed but the
  // 75 ms debounce hasn't elapsed yet. Survives across re-renders
  // (and across effect cleanup/re-run cycles) so a measurement that
  // crossed the threshold doesn't get silently dropped if a second
  // measurement arrives before the debounce fires. Drained when the
  // debounce timer fires (we apply the position-cache eviction +
  // commit the measurement cache atomically then).
  const pendingMeasurementsRef = useRef<Map<string, { width: number; height: number }>>(new Map());
  // Bumped by the debounced measurement effect when at least one rect
  // crossed the change threshold; folded into the `nodes` `useMemo`
  // deps so the next memoization tick reads the freshly-evicted
  // position cache alongside the freshly-populated measurement cache.
  const [layoutRevision, setLayoutRevision] = useState<number>(0);

  const nodes = useMemo(() => {
    const projected = projectNodes(events, diagnosticHighlights);
    const laidOut = applyLayout(projected, edges, {
      cache: positionCacheRef.current,
      dimensions: measurementCacheRef.current,
    });
    // Mirror every emitted position into the cache so the NEXT
    // memoization tick reuses these positions for already-laid-out
    // nodes. The mutation does not drive a render (useRef semantics).
    for (const node of laidOut) {
      positionCacheRef.current.set(node.id, node.position);
    }
    return laidOut;
    // `edges` is a new dep relative to the pre-layout-engine memo —
    // dagre's placement depends on the edge set, so adding an edge
    // between an existing node and a new node MUST re-run the layout.
    // `layoutRevision` is bumped by the measurement effect when an
    // evicted cache entry needs a fresh dagre pass for the measured
    // footprint. Refinement: `mod_layout_measured_dimensions`.
  }, [events, diagnosticHighlights, edges, layoutRevision]);

  // -- Tidy-up action (mod_layout_tidy_action) -----------------------
  //
  // The moderator-visible button rendered in the top-right corner of the
  // canvas binds to this handler. Clicking it forces a fresh dagre pass
  // over every node by (a) clearing the position cache so the next
  // `useMemo` tick treats every id as a cache miss — `applyLayout` over
  // an empty cache produces "the same result as `relayoutAll(...)` for
  // the same inputs" per the function's contract documentation
  // (`layoutEngine.ts:264`); (b) bumping the existing `layoutRevision`
  // counter (a second writer to the seam `mod_layout_measured_dimensions`
  // established) so the `nodes` `useMemo` invalidates and re-runs; and
  // (c) deferring a `fitView({ duration: 0, padding: 0.1 })` call to the
  // next animation frame so ReactFlow's internal node-position store
  // reads the post-relayout positions when computing the bounding box.
  // The measurement cache is preserved — only positions are recomputed.
  const { t } = useTranslation();
  const { fitView } = useReactFlow();
  const handleTidyUp = useCallback((): void => {
    positionCacheRef.current.clear();
    setLayoutRevision((r) => r + 1);
    requestAnimationFrame(() => {
      fitView({ duration: 0, padding: 0.1 });
    });
  }, [fitView]);

  // -- Measurement-driven re-layout (mod_layout_measured_dimensions) --
  //
  // Subscribe to a deterministic hash of `state.nodeInternals`'s
  // measured rects. The selector changes its return value if and only
  // if at least one node's measured `width` / `height` changed; that
  // change re-runs the effect below. We DON'T use `state.nodeInternals`
  // directly as the selector return value because the Map reference is
  // mutated in place internally (Zustand `useStore` would not see the
  // change), and re-creating it per render is both wasteful and noisy
  // for downstream selectors. The numeric hash is content-stable and
  // cheap. The actual rects are read off the live state inside the
  // effect via `useStoreApi().getState()` — same idiom the ReactFlow
  // docs document for "subscribe to a derived signal, read the live
  // state in the effect."
  const measurementRevision = useStore(selectMeasurementRevision);
  const nodesInitialized = useNodesInitialized();
  const storeApi = useStoreApi();

  useEffect(() => {
    // Gate the re-layout on `useNodesInitialized` (the official
    // ReactFlow seam; returns `true` only after every visible node has
    // been measured at least once). Before the gate flips, partial
    // measurements would produce a re-layout that immediately needs
    // another re-layout — wasteful.
    if (!nodesInitialized) return undefined;

    // Read the live `nodeInternals` Map out of the store. The map is
    // keyed by node id; each entry's `width` / `height` is what
    // ReactFlow's `ResizeObserver` measured (null until the first
    // measurement; we already gated on `nodesInitialized`).
    const internals = storeApi.getState().nodeInternals;

    // Compare each rect against the committed measurement cache. If
    // the rect differs by ≥ DIMENSION_CHANGE_THRESHOLD_PX on either
    // axis, stage it in `pendingMeasurementsRef.current`. We DO NOT
    // commit the measurement cache or evict the position cache yet —
    // the debounce window may bring further measurements (the
    // per-facet / per-decoration cascade); we hold the staged set
    // until the timer fires.
    let staged = false;
    for (const [id, internal] of internals.entries()) {
      if (internal.width == null || internal.height == null) continue;
      if (internal.width <= 0 || internal.height <= 0) continue;
      const rect = { width: internal.width, height: internal.height };
      const prev = measurementCacheRef.current.get(id);
      if (
        prev === undefined ||
        Math.abs(prev.width - rect.width) >= DIMENSION_CHANGE_THRESHOLD_PX ||
        Math.abs(prev.height - rect.height) >= DIMENSION_CHANGE_THRESHOLD_PX
      ) {
        pendingMeasurementsRef.current.set(id, rect);
        staged = true;
      }
    }

    // Only arm the debounce if THIS invocation staged something OR a
    // previous invocation staged something the timer never got to
    // commit (cleanup raced ahead). The "previous staging survives"
    // path is the load-bearing piece — without it, a cascade of
    // measurements that arrives faster than the debounce window would
    // never get its eviction applied.
    if (!staged && pendingMeasurementsRef.current.size === 0) return undefined;

    // Debounce: per-facet decoration rows can fire a chain of
    // ResizeObserver callbacks as the catalog text and CSS settle.
    // Coalesce them into one re-layout pass at the end of the cascade.
    const timer = setTimeout(() => {
      // Drain the staged measurements: commit each into the
      // measurement cache and evict the matching position-cache entry
      // so the next `applyLayout` pass treats those ids as uncached
      // (forcing a fresh dagre placement for them, alongside the
      // cached neighbours, which pass through with their existing
      // positions — `applyLayout`'s mixed cache / no-cache codepath
      // is the seam). Existing-nodes-never-move is preserved for
      // every id NOT in the staged set.
      const drained = pendingMeasurementsRef.current;
      if (drained.size === 0) return;
      for (const [id, rect] of drained.entries()) {
        measurementCacheRef.current.set(id, rect);
        positionCacheRef.current.delete(id);
      }
      pendingMeasurementsRef.current = new Map();
      // Bump the layout revision to invalidate the `nodes` `useMemo`.
      // The next memoization tick re-runs `applyLayout` with the
      // freshly-evicted position cache + the freshly-populated
      // measurement cache, producing positions that respect the
      // rendered footprint.
      setLayoutRevision((rev) => rev + 1);
    }, MEASUREMENT_DEBOUNCE_MS);

    // Cleanup: clear the pending debounce on unmount OR on a re-render
    // that supplants the previous effect invocation. A new measurement
    // that arrives during the 75 ms window resets the timer to the
    // tail of the cascade.
    return () => {
      clearTimeout(timer);
    };
  }, [measurementRevision, nodesInitialized, storeApi]);

  // Build the menu items for whatever the context menu currently targets.
  // The `items` are rebuilt on every render the menu is open, but that's
  // fine — the per-item `onSelect` closes over `contextMenu.target` and
  // gets fresh `target` data each render. The pane menu's "Create new
  // statement" item is wired to `focusCaptureTextarea` (ad-hoc fix for
  // the placeholder `actionStub` that shipped in `mod_context_menus`).
  let menuItems: readonly MenuItem[] = [];
  if (contextMenu !== null) {
    if (contextMenu.target.kind === 'node') {
      menuItems = buildNodeMenuItems(contextMenu.target);
    } else if (contextMenu.target.kind === 'edge') {
      menuItems = buildEdgeMenuItems(contextMenu.target);
    } else {
      menuItems = buildPaneMenuItems(contextMenu.target, focusCaptureTextarea);
    }
  }

  return (
    <div data-testid="graph-canvas-root" className="relative h-full w-full">
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
        // Refinement: `mod_pan_zoom`. Pin the pan/zoom contract
        // explicitly so the behaviour does not drift across ReactFlow
        // upgrades. The four behaviour props match ReactFlow's
        // documented defaults (drag-to-pan on background, scroll-wheel
        // zoom, trackpad pinch zoom, double-click zoom) — the explicit
        // declaration is the load-bearing piece, the values themselves
        // are unchanged from the library defaults.
        panOnDrag={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
        zoomOnDoubleClick={true}
        // Widen the zoom range from ReactFlow's defaults (0.5 .. 2). A
        // debate with ~100 nodes does not fit in the viewport at 0.5x;
        // the moderator needs to zoom further out to overview the
        // whole canvas. The 2.5x upper bound lets a moderator close-
        // read a single card with wording detail.
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
      >
        <Background />
      </ReactFlow>
      <button
        type="button"
        data-testid="graph-tidy-up-button"
        aria-label={t('moderator.graph.tidyUp.ariaLabel')}
        title={t('moderator.graph.tidyUp.tooltip')}
        onClick={handleTidyUp}
        className="absolute right-4 top-4 z-10 rounded bg-white px-3 py-1.5 text-sm font-medium text-slate-900 shadow ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        {t('moderator.graph.tidyUp.label')}
      </button>
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
