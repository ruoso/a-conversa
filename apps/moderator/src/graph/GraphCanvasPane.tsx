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
// **Layout note.** Node positioning is delegated to the dagre-backed
// engine in `./layoutEngine` (refinement `mod_layout_engine_choice`,
// pinned by ADR 0025; strategy amended 2026-05-24). Which engine
// function runs per `useMemo([events, diagnosticHighlights, edges])`
// tick depends on whether the projection introduces a truly-new node id
// (an id this canvas instance has never seen, tracked separately from
// the position cache so a measurement-driven cache eviction is not
// mistaken for a fresh id):
//
// - **Truly-new id present.** Call `relayoutAll(...)`: every node gets
//   a fresh dagre placement against the new graph structure and the
//   position cache is reset. The viewport is NOT auto-panned to the
//   new node — see ADR 0025 Amendment 2026-05-24 for the history (a
//   center-on-new pan was tried and surfaced races with concurrent
//   tidy-up gestures in multi-user sessions; the user clicks "Tidy
//   up" to recenter).
// - **No truly-new id.** Call `applyLayout(...)` with the position
//   cache: cached ids reuse their `{x, y}`, only uncached ids (e.g. an
//   id whose position cache entry was evicted by the measurement
//   debounce in `mod_layout_measured_dimensions`) feed dagre. Existing
//   nodes do NOT move.
//
// `projectNodes` emits every node at `(0, 0)`; the layout pass
// overwrites that with the dagre-derived (or cached) placement. The
// original "existing nodes never move on incremental events" contract
// was tried and abandoned — dagre run over (new + cached) nodes
// without absolute-position constraints produced new placements that
// did not correspond to the cached coordinate space, so new ids
// stacked at the origin. See ADR 0025 Amendment 2026-05-24.
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
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type OnConnectEnd,
  type ReactFlowState,
  type XYPosition,
} from 'reactflow';
import { useTranslation } from 'react-i18next';
import type { AnnotationKind, Event, StatementKind } from '@a-conversa/shared-types';

import 'reactflow/dist/style.css';

import { useCaptureStore, useSelectionStore } from '../stores/index.js';
import { useWsStore, type WsState } from '../ws/wsStore.js';
import { AxiomMarkSubmenu } from '../layout/AxiomMarkSubmenu.js';
import { AnnotateSubmenu } from '../layout/AnnotateSubmenu.js';
import type { AnnotateTargetKind } from '../layout/useAnnotateAction.js';
import { EditWordingSubmenu } from '../layout/EditWordingSubmenu.js';
import { STATEMENT_NODE_TYPE, StatementNode, type StatementNodeData } from './StatementNode.js';
import {
  ANNOTATION_NODE_TYPE,
  ANNOTATION_NODE_HEIGHT,
  ANNOTATION_NODE_WIDTH,
  AnnotationNode,
} from './AnnotationNode.js';
import {
  ANNOTATION_HOST_MIDPOINT_NODE_TYPE,
  AnnotationHostMidpointNode,
} from './AnnotationHostMidpointNode.js';
import { edgeTypes } from './edgeTypes.js';
import { DrawEdgeRolePicker } from './DrawEdgeRolePicker.js';
import { GraphContextMenu, type MenuItem } from './GraphContextMenu.js';
import { applyLayout, relayoutAll } from './layoutEngine.js';
import {
  buildFacetStatusIndexFromBroadcast,
  computeFacetStatuses,
  EMPTY_DIAGNOSTIC_HIGHLIGHTS,
  EMPTY_FACET_STATUSES,
  projectDiagnosticHighlights,
  type DiagnosticHighlightIndex,
  type FacetStatusIndex,
} from '@a-conversa/shell';
import { disputationOutcome } from './disputationOutcome.js';
import {
  EMPTY_PENDING_AXIOM_MARKS,
  EMPTY_VOTES_BY_FACET,
  buildAnnotationHostEdgeAnchorIndex,
  computeAnnotationsAsEndpoints,
  groupPendingAxiomMarksByNode,
  placeAnnotationHostMidpoints,
  projectAnnotationHostEdges,
  projectAnnotationHostMidpointNodes,
  projectAnnotationNodes,
  projectPendingAxiomMarks,
  selectEdgesForSession,
} from './selectors.js';
import {
  EMPTY_ANNOTATIONS,
  EMPTY_AXIOM_MARKS,
  groupAnnotationsByEntityId,
  groupAxiomMarksByNode,
  projectAnnotations,
  projectAxiomMarks,
  projectVotesByFacet,
} from '@a-conversa/shell';
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
  [ANNOTATION_NODE_TYPE]: AnnotationNode,
  [ANNOTATION_HOST_MIDPOINT_NODE_TYPE]: AnnotationHostMidpointNode,
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
/**
 * Map the ReactFlow `node.type` discriminator to the `EntityKind` the
 * selection store and downstream gestures (capture-target staging,
 * draw-edge endpoint routing) use. `STATEMENT_NODE_TYPE` and the
 * annotation host midpoint type both resolve to `'node'`; only
 * `ANNOTATION_NODE_TYPE` flips to `'annotation'`. A future addition
 * of a new node type with its own endpoint identity would need to
 * extend this map — the default arm keeps the contract honest by
 * falling back to `'node'`.
 *
 * Refinement:
 * `tasks/refinements/moderator-ui/mod_propose_annotation_endpoint_gestures.md`
 * (Constraint 1 — kind discrimination at the ReactFlow-node layer).
 */
function endpointKindFromNodeType(type: string | undefined): 'node' | 'annotation' {
  if (type === ANNOTATION_NODE_TYPE) return 'annotation';
  return 'node';
}

export function handleNodeClick(_event: unknown, node: Node): void {
  useSelectionStore.getState().select({ kind: endpointKindFromNodeType(node.type), id: node.id });
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
  readonly target: {
    readonly kind: 'node' | 'edge' | 'pane' | 'annotation';
    readonly id: string | null;
  };
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
 *
 * **`onOpenAxiomMarkSubmenu` seam (mod_axiom_mark_action).** The
 * canvas threads in a real handler that flips its `axiomMarkSubmenu`
 * state to `true` — the parent menu's `axiom-mark` item then opens
 * the participant-picker `<AxiomMarkSubmenu>` at the cursor instead
 * of calling the legacy `actionStub`. When omitted (direct unit-test
 * invocations of `buildNodeMenuItems`), the legacy stub is used so
 * the existing factory-shape cases keep passing without each test
 * having to thread an opener stub. Decision §2 of the refinement
 * records the placement strategy (the menu item's `onSelect` flips a
 * per-render `submenuOpen` flag rather than firing a proposal
 * directly).
 *
 * **`onEnterDecomposeMode` seam (mod_decompose_mode).** Same shape as
 * the axiom-mark seam: the canvas threads in a callback that
 * dispatches to `useCaptureStore.getState().enterDecomposeMode(nodeId)`
 * — the parent menu's `propose-decompose` item then atomically flips
 * `mode` to `'decompose'` + sets `decomposeTargetNodeId` + clears the
 * F1 capture-flow slices (Decision §6 of the refinement). When
 * omitted (direct unit-test invocations of `buildNodeMenuItems`), the
 * legacy stub is used so the existing factory-shape cases keep
 * passing without each test having to thread a handler. Decision §2
 * of `mod_decompose_mode.md` records the placement.
 *
 * **`onEnterOperationalizationMode` seam (mod_operationalization_mode).**
 * Same shape as the decompose / interpretive-split seams: the canvas
 * threads in a callback that dispatches to
 * `useCaptureStore.getState().enterOperationalizationMode(nodeId)` —
 * the parent menu's `run-operationalization-test` item then atomically
 * flips `mode` to `'operationalization'` + sets
 * `operationalizationTargetNodeId` + clears the F1 capture-flow
 * slices. Per Decision §D5 the item is **always rendered** but the
 * canvas precomputes the `disabled` flag from
 * `disputationOutcome(node.facetStatuses.substance) !== 'claim'` and
 * threads it through `disabledRunOperationalizationTest`. When the
 * handler is omitted (direct unit-test invocations), the legacy stub
 * is used; when the disabled flag is omitted, the item defaults to
 * enabled (the legacy unit-test factory shape).
 *
 * **`onEnterWarrantElicitationMode` seam (mod_warrant_elicitation_mode).**
 * Verbatim mirror of the operationalization seam: the canvas threads
 * in a callback that dispatches to
 * `useCaptureStore.getState().enterWarrantElicitationMode(nodeId)` —
 * the parent menu's `run-warrant-elicitation-test` item (inserted
 * between `run-operationalization-test` and `propose-meta-disagreement`
 * per Decision §D1) then atomically flips `mode` to
 * `'warrant-elicitation'` + sets `warrantElicitationTargetNodeId` +
 * clears the F1 capture-flow slices. Per Decision §D1 the item shares
 * the same `disputationOutcome(node.facetStatuses.substance) !==
 * 'claim'` gate predicate as the operationalization item but is threaded
 * through an independent `disabledRunWarrantElicitationTest` boolean
 * so a future divergence of the warrant-elicitation gate is a one-line
 * change at the call site.
 */
export function buildNodeMenuItems(
  target: ContextMenuState['target'],
  onOpenAxiomMarkSubmenu?: () => void,
  onEnterDecomposeMode?: (nodeId: string) => void,
  onEnterInterpretiveSplitMode?: (nodeId: string) => void,
  onEnterOperationalizationMode?: (nodeId: string) => void,
  disabledRunOperationalizationTest?: boolean,
  onEnterWarrantElicitationMode?: (nodeId: string) => void,
  disabledRunWarrantElicitationTest?: boolean,
  onOpenAnnotateSubmenu?: () => void,
  onOpenEditWordingSubmenu?: () => void,
): readonly MenuItem[] {
  return [
    {
      id: 'propose-vote',
      labelKey: 'moderator.contextMenu.node.proposeVote',
      onSelect: () => actionStub('propose-vote', target),
    },
    {
      id: 'propose-decompose',
      labelKey: 'moderator.contextMenu.node.proposeDecompose',
      onSelect:
        target.kind === 'node' && target.id !== null && onEnterDecomposeMode
          ? () => onEnterDecomposeMode(target.id as string)
          : () => actionStub('propose-decompose', target),
    },
    {
      id: 'propose-interpretive-split',
      labelKey: 'moderator.contextMenu.node.proposeInterpretiveSplit',
      onSelect:
        target.kind === 'node' && target.id !== null && onEnterInterpretiveSplitMode
          ? () => onEnterInterpretiveSplitMode(target.id as string)
          : () => actionStub('propose-interpretive-split', target),
    },
    {
      // Refinement: edit-wording submenu (mod_edit_wording_action). Same
      // `onOpenSubmenu?` shape as the axiom-mark seam — the canvas
      // threads in a handler that flips its `editWordingSubmenu` state
      // to non-null; the parent menu's `propose-edit-wording` item then
      // opens the `<EditWordingSubmenu>` at the cursor. When omitted
      // (direct unit-test invocations), the legacy `actionStub` runs so
      // the existing factory-shape cases keep their stub-fire posture.
      id: 'propose-edit-wording',
      labelKey: 'moderator.contextMenu.node.proposeEditWording',
      onSelect: onOpenEditWordingSubmenu ?? (() => actionStub('propose-edit-wording', target)),
    },
    {
      id: 'run-operationalization-test',
      labelKey: 'moderator.contextMenu.node.runOperationalization',
      onSelect:
        target.kind === 'node' && target.id !== null && onEnterOperationalizationMode
          ? () => onEnterOperationalizationMode(target.id as string)
          : () => actionStub('run-operationalization-test', target),
      disabled: disabledRunOperationalizationTest ?? false,
    },
    {
      id: 'run-warrant-elicitation-test',
      labelKey: 'moderator.contextMenu.node.runWarrantElicitation',
      onSelect:
        target.kind === 'node' && target.id !== null && onEnterWarrantElicitationMode
          ? () => onEnterWarrantElicitationMode(target.id as string)
          : () => actionStub('run-warrant-elicitation-test', target),
      disabled: disabledRunWarrantElicitationTest ?? false,
    },
    {
      id: 'propose-meta-disagreement',
      labelKey: 'moderator.contextMenu.node.proposeMetaDisagreement',
      onSelect: () => actionStub('propose-meta-disagreement', target),
    },
    {
      id: 'annotate',
      labelKey: 'moderator.contextMenu.node.annotate',
      onSelect: onOpenAnnotateSubmenu ?? (() => actionStub('annotate', target)),
    },
    {
      id: 'axiom-mark',
      labelKey: 'moderator.contextMenu.node.axiomMark',
      onSelect: onOpenAxiomMarkSubmenu ?? (() => actionStub('axiom-mark', target)),
    },
  ];
}

/**
 * Build the menu items for an annotation right-click. Refinement:
 * `mod_annotation_context_menu`. Annotations carry an entirely
 * different vocabulary from nodes / edges — the methodology's
 * node-scope and edge-scope actions (vote / decompose / axiom-mark /
 * etc.) don't apply to annotations. The two v1 items both open the
 * existing `<AnnotateSubmenu>` against the annotation target so the
 * round-trip emits an `annotate` proposal with
 * `target_kind: 'annotation'` — the wire widening that lands
 * alongside this factory (Decision §1) makes those proposals real,
 * not stubs.
 *
 * The "Disagree with this annotation" item pre-biases the kind-radio
 * to `'stance'` via the submenu's optional `initialAnnotationKind`
 * prop. `'stance'` is the closest existing annotation kind that
 * conveys a moderator's disagreement with an annotation's content
 * — `'meta-disagreement'` is a facet-state, not an annotation kind
 * (the AnnotationKind enum is `note / reframe / scope-change /
 * stance` per `annotationKindSchema`). The disagree label
 * communicates the intent; the picker stays adjustable so the
 * moderator can override before submitting. Decision §2 of the
 * refinement.
 */
export function buildAnnotationMenuItems(
  target: ContextMenuState['target'],
  onOpenAnnotateSubmenu?: () => void,
  onOpenMetaDisagreeSubmenu?: () => void,
): readonly MenuItem[] {
  return [
    {
      id: 'annotate',
      labelKey: 'moderator.contextMenu.annotation.annotate',
      onSelect: onOpenAnnotateSubmenu ?? (() => actionStub('annotate', target)),
    },
    {
      id: 'meta-disagree',
      labelKey: 'moderator.contextMenu.annotation.metaDisagree',
      onSelect: onOpenMetaDisagreeSubmenu ?? (() => actionStub('meta-disagree', target)),
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
export function buildEdgeMenuItems(
  target: ContextMenuState['target'],
  onOpenAnnotateSubmenu?: () => void,
): readonly MenuItem[] {
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
      onSelect: onOpenAnnotateSubmenu ?? (() => actionStub('annotate', target)),
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
const EMPTY_FACET_STATUS_INDEX: FacetStatusIndex = Object.freeze({
  nodes: new Map(),
  edges: new Map(),
});

/**
 * `projectNodes` accepts the per-facet status as a parameter so callers
 * control its source. Production callers (the `<GraphCanvasPane>` hook)
 * pass the broadcast-derived `buildFacetStatusIndexFromBroadcast` shape
 * — that's the migration's source-of-truth swap. Callers that omit the
 * argument (unit tests asserting the pre-migration enrichment shape via
 * pure events → nodes derivation) fall through to `computeFacetStatuses`
 * over the supplied events log so their assertions stay stable without
 * a forced WS-store seed step in every fixture.
 */
export function projectNodes(
  events: readonly Event[],
  highlights: DiagnosticHighlightIndex = EMPTY_DIAGNOSTIC_HIGHLIGHTS,
  facetStatusIndex: FacetStatusIndex = computeFacetStatuses(events),
): Node<StatementNodeData>[] {
  // First pass: collect node-created events in arrival order, alongside
  // a map from node id to the array index (so we can apply later
  // classification commits without re-scanning).
  const nodes: Node<StatementNodeData>[] = [];
  const nodeIndexById = new Map<string, number>();
  // Promotion-set for annotation-endpoint rendering — annotations
  // referenced as edge endpoints render as `<AnnotationNode>` and are
  // filtered out of the per-host `data.annotations` badge bucket
  // (mutual exclusion per `mod_render_annotation_endpoint_edges`
  // Decisions §1 + §3).
  const promotedAnnotationIds = computeAnnotationsAsEndpoints(events);
  // Map from proposal envelope id to (node id, classification) for
  // classify-node proposals — used when a commit later references one.
  const pendingClassifications = new Map<
    string,
    { nodeId: string; classification: StatementKind }
  >();
  // Map from `node_id` → the most-recent classification candidate value
  // named by a `classify-node` proposal. Used by the facet-keyed commit
  // arm (per ADR 0030 §2) to resolve the current candidate without a
  // `proposal_id` carrier; a new classify-node proposal overwrites the
  // entry per ADR 0030 §7.
  const currentClassificationByNode = new Map<string, StatementKind>();

  // Annotation enrichment is a separate pass — annotations target a
  // node by id and aren't gated on the proposal/commit dance, so a
  // single up-front projection + groupBy is cheaper than threading
  // through the main loop.
  //
  // Per `mod_render_annotation_endpoint_edges` Decisions §1 + §3,
  // annotations promoted to `<AnnotationNode>` (referenced as edge
  // endpoints) are filtered out of the badge bucket here so the host
  // node's `data.annotations` excludes them — mutual exclusion between
  // badge and node.
  const allAnnotations = projectAnnotations(events);
  const annotationsByNode = groupAnnotationsByEntityId(
    promotedAnnotationIds.size === 0
      ? allAnnotations
      : allAnnotations.filter((annotation) => !promotedAnnotationIds.has(annotation.id)),
  );

  // Axiom-mark enrichment — same up-front-pass pattern. The axiom-mark
  // projection IS gated on the proposal + commit dance (only committed
  // marks are rendered as badges), but `projectAxiomMarks` encapsulates
  // that, so the enrichment loop here treats axiom-marks the same way
  // it treats annotations: project once, group by target node, attach
  // the matching subset to each emitted node. Refinement:
  // `mod_axiom_mark_decoration`.
  const axiomMarksByNode = groupAxiomMarksByNode(projectAxiomMarks(events));

  // Pending axiom-mark enrichment — same up-front-pass pattern as the
  // committed enrichment above. The pending projection walks the event
  // log once; per-node bucketing produces a `Map<nodeId,
  // PendingAxiomMark[]>` the main loop reads via `O(1)` `get`. Empty /
  // absent → the shared `EMPTY_PENDING_AXIOM_MARKS` reference (stable
  // identity keeps React / ReactFlow memoization clean for the common
  // "no pending axiom-mark targets this node" case). Refinement:
  // `mod_axiom_mark_pending_render`.
  const pendingAxiomMarksByNode = groupPendingAxiomMarksByNode(projectPendingAxiomMarks(events));

  // Per-facet `FacetStatus` index for state-styling. Per
  // `migrate_off_compute_facet_statuses_onto_proposal_status_broadcast`,
  // the index is now SUPPLIED from the broadcast-derived
  // `pendingProposalFacetStatus` cell-map (adapter:
  // `buildFacetStatusIndexFromBroadcast`) instead of being computed
  // client-side from the events log. The argument is the threaded
  // selector value from the outer hook; tests that pre-date the
  // migration pass `EMPTY_FACET_STATUS_INDEX` via the default.

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
      const pendingAxiomMarks =
        pendingAxiomMarksByNode.get(event.payload.node_id) ?? EMPTY_PENDING_AXIOM_MARKS;
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
              pendingAxiomMarks,
              votesByFacet,
            }
          : {
              wording: event.payload.wording,
              kind: null,
              annotations,
              facetStatuses,
              axiomMarks,
              pendingAxiomMarks,
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
        // Track the most-recent classification candidate per node so a
        // facet-keyed commit (per ADR 0030 §2) can resolve the current
        // candidate without a `proposal_id`. A new classify-node
        // proposal supersedes the prior candidate per ADR 0030 §7.
        currentClassificationByNode.set(inner.node_id, inner.classification);
      }
      continue;
    }

    if (event.kind === 'commit') {
      // Per ADR 0030 §2 + §9: commit payloads are a `target`-
      // discriminated union. The facet-keyed arm carries
      // `(entity_kind, entity_id, facet)`; the proposal-keyed arm
      // carries `proposal_id`. Both flip the matching node's `kind` to
      // the current classification candidate.
      if (event.payload.target === 'facet') {
        if (event.payload.facet !== 'classification') continue;
        if (event.payload.entity_kind !== 'node') continue;
        const classification = currentClassificationByNode.get(event.payload.entity_id);
        if (classification === undefined) continue;
        const idx = nodeIndexById.get(event.payload.entity_id);
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
            kind: classification,
          },
        };
        continue;
      }
      // target === 'proposal' — structural arm or legacy facet-valued
      // arm for any proposal-keyed commits still on the log.
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

  // Append promoted-annotation nodes after the statement nodes. The
  // combined `Node[]` array is what `<ReactFlow>` consumes; node-type
  // discrimination is per-node via `node.type` (`'statement'` vs
  // `'annotation'`). ReactFlow routes each node to the right component
  // via the `NODE_TYPES` map regardless of the static `T` on
  // `Node<T>` — so we collapse the two shapes here under the same
  // array typed as `Node<StatementNodeData>` (the existing consumer
  // contract). The annotation projector resolves each promoted
  // annotation's host inline and stamps `data.hostMissing` when the
  // host can't be found in the events log (Decision §4 defensive
  // case). Refinement: `mod_render_annotation_endpoint_edges`.
  const annotationNodes = projectAnnotationNodes(
    allAnnotations,
    promotedAnnotationIds,
    events,
    annotationsByNode,
  );
  if (annotationNodes.length === 0) {
    return nodes;
  }
  return [...nodes, ...(annotationNodes as unknown as Node<StatementNodeData>[])];
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

  // ReactFlow handle — stable across the component lifetime; lets
  // `handleConnect` / `handleConnectEnd` resolve the live
  // `node.type` for either endpoint of a drag-to-create-edge gesture
  // so the picker can route the resulting payload to the kind-
  // appropriate schema slot (`source_node_id` vs
  // `source_annotation_id`, symmetric for target). Refinement:
  // `mod_propose_annotation_endpoint_gestures` Decision §2.
  const reactFlow = useReactFlow();

  // Context-menu state — `null` when no menu is open. Set by the right-
  // click handlers below; cleared by the menu's `onClose`. Refinement:
  // `mod_context_menus`.
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // Axiom-mark submenu state — `null` when the participant-picker
  // submenu is not open. Set when the node menu's `axiom-mark` item is
  // selected; cleared by the submenu's `onClose` (outside-click /
  // Escape) or by closing the parent context menu. Refinement:
  // `mod_axiom_mark_action` Decision §2 — the submenu is a sibling
  // render to `<GraphContextMenu>`, not a nested item, and its
  // open-state lives alongside `contextMenu` on the canvas (same
  // transient-UI-fact rationale `mod_context_menus` used).
  const [axiomMarkSubmenu, setAxiomMarkSubmenu] = useState<{
    readonly nodeId: string;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const closeAxiomMarkSubmenu = useCallback(() => setAxiomMarkSubmenu(null), []);
  // Annotate submenu state. `initialAnnotationKind` (optional) lets the
  // annotation-context-menu's "Disagree with this annotation" item
  // pre-bias the kind-radio picker; node / edge openers omit it and
  // fall back to the submenu's default of `'note'`. Refinement:
  // `mod_annotation_context_menu`.
  const [annotateSubmenu, setAnnotateSubmenu] = useState<{
    readonly targetId: string;
    readonly targetKind: AnnotateTargetKind;
    readonly x: number;
    readonly y: number;
    readonly initialAnnotationKind?: AnnotationKind;
  } | null>(null);
  const closeAnnotateSubmenu = useCallback(() => setAnnotateSubmenu(null), []);
  // Edit-wording submenu state.
  const [editWordingSubmenu, setEditWordingSubmenu] = useState<{
    readonly nodeId: string;
    readonly x: number;
    readonly y: number;
    readonly currentWording: string;
  } | null>(null);
  const closeEditWordingSubmenu = useCallback(() => setEditWordingSubmenu(null), []);
  // Draw-edge role picker state — `null` when no handle-to-handle drag
  // has just completed against two distinct statement nodes. Set by the
  // ReactFlow `onConnect` / `onConnectEnd` handler pair below; cleared
  // by the picker's `onClose`. The picker fires a `set-edge-substance`
  // connecting-case proposal once the moderator picks a role.
  // Refinement: `mod_draw_edge_flow`.
  const [drawEdgePicker, setDrawEdgePicker] = useState<{
    readonly source: string;
    readonly sourceKind: 'node' | 'annotation';
    readonly target: string;
    readonly targetKind: 'node' | 'annotation';
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const closeDrawEdgePicker = useCallback(() => setDrawEdgePicker(null), []);
  // The `onConnect` handler runs synchronously inside ReactFlow's drop
  // pipeline; the matching `onConnectEnd` fires immediately after with
  // the native MouseEvent carrying the drop coordinates. We stash the
  // valid (source, target) pair from `onConnect` in a ref and read
  // it back inside `onConnectEnd` to combine with the cursor x/y. The
  // endpoint kinds are resolved from the ReactFlow store at drop time
  // via `reactFlow.getNode(id)?.type`; the kinds ride alongside the
  // pair so the picker can route the proposal's endpoint slots per
  // `mod_propose_annotation_endpoint_gestures`.
  const pendingConnectionRef = useRef<{
    source: string;
    sourceKind: 'node' | 'annotation';
    target: string;
    targetKind: 'node' | 'annotation';
  } | null>(null);
  const handleConnect = useCallback(
    (params: Connection): void => {
      if (params.source === null || params.target === null || params.source === params.target) {
        pendingConnectionRef.current = null;
        return;
      }
      const sourceKind = endpointKindFromNodeType(reactFlow.getNode(params.source)?.type);
      const targetKind = endpointKindFromNodeType(reactFlow.getNode(params.target)?.type);
      pendingConnectionRef.current = {
        source: params.source,
        sourceKind,
        target: params.target,
        targetKind,
      };
    },
    [reactFlow],
  );
  const handleConnectEnd = useCallback<OnConnectEnd>((event) => {
    const pending = pendingConnectionRef.current;
    pendingConnectionRef.current = null;
    if (pending === null) return;
    let clientX = 0;
    let clientY = 0;
    if ('clientX' in event && 'clientY' in event) {
      clientX = event.clientX;
      clientY = event.clientY;
    } else if (
      'changedTouches' in event &&
      event.changedTouches !== undefined &&
      event.changedTouches.length > 0
    ) {
      const touch = event.changedTouches[0]!;
      clientX = touch.clientX;
      clientY = touch.clientY;
    }
    setDrawEdgePicker({
      source: pending.source,
      sourceKind: pending.sourceKind,
      target: pending.target,
      targetKind: pending.targetKind,
      x: clientX,
      y: clientY,
    });
  }, []);
  // Stable mode-entry callback for the node context menu's
  // `propose-decompose` item. Dispatches to the global capture store
  // (no canvas-local state — decompose-mode lives on `useCaptureStore`).
  // Refinement: `mod_decompose_mode`.
  const enterDecomposeMode = useCallback(
    (nodeId: string) => useCaptureStore.getState().enterDecomposeMode(nodeId),
    [],
  );
  // Sibling stable mode-entry callback for the new
  // `propose-interpretive-split` item. Refinement:
  // `mod_interpretive_split_mode`.
  const enterInterpretiveSplitMode = useCallback(
    (nodeId: string) => useCaptureStore.getState().enterInterpretiveSplitMode(nodeId),
    [],
  );
  // Sibling stable mode-entry callback for the new
  // `run-operationalization-test` item. Refinement:
  // `mod_operationalization_mode`.
  const enterOperationalizationMode = useCallback(
    (nodeId: string) => useCaptureStore.getState().enterOperationalizationMode(nodeId),
    [],
  );
  // Sibling stable mode-entry callback for the new
  // `run-warrant-elicitation-test` item. Refinement:
  // `mod_warrant_elicitation_mode`.
  const enterWarrantElicitationMode = useCallback(
    (nodeId: string) => useCaptureStore.getState().enterWarrantElicitationMode(nodeId),
    [],
  );
  // **Important:** `closeContextMenu` does NOT cascade-close the
  // submenu. The `<GraphContextMenu>` shell calls `onClose` after a
  // menu item's `onSelect` runs (including the axiom-mark item that
  // OPENS the submenu); cascading here would unmount the submenu in
  // the same React commit, defeating the whole flow. The submenu
  // owns its own outside-click / Escape close-path (mirrors the
  // parent menu's identical handlers) and dismisses itself
  // independently when the moderator clicks elsewhere or presses
  // Escape.
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Right-click handlers. Each `preventDefault()`s the native browser
  // context menu and opens our menu at the cursor coordinates. Node /
  // edge right-clicks also `select(...)` the target so the existing
  // selection ring (sky-500 from `mod_selection`) flips to the right-
  // clicked entity — mirrors desktop graph editors' "right-click selects
  // then opens menu" convention.
  const handleNodeContextMenu = useCallback((event: ReactMouseEvent, node: Node): void => {
    event.preventDefault();
    // Single-source the kind discrimination — the same
    // `endpointKindFromNodeType(node.type)` value flows into both the
    // selection dispatch and the context-menu target so the two stay in
    // sync (per `mod_annotation_context_menu` Decision §5 and
    // Constraint 2).
    const kind = endpointKindFromNodeType(node.type);
    useSelectionStore.getState().select({ kind, id: node.id });
    // A fresh right-click dismisses any stale axiom-mark / annotate
    // submenu from a prior gesture before opening the new parent menu.
    setAxiomMarkSubmenu(null);
    setAnnotateSubmenu(null);
    setEditWordingSubmenu(null);
    setContextMenu({
      target: { kind, id: node.id },
      x: event.clientX,
      y: event.clientY,
    });
  }, []);
  const handleEdgeContextMenu = useCallback((event: ReactMouseEvent, edge: Edge): void => {
    event.preventDefault();
    useSelectionStore.getState().select({ kind: 'edge', id: edge.id });
    setAxiomMarkSubmenu(null);
    setAnnotateSubmenu(null);
    setEditWordingSubmenu(null);
    setContextMenu({
      target: { kind: 'edge', id: edge.id },
      x: event.clientX,
      y: event.clientY,
    });
  }, []);
  const handlePaneContextMenu = useCallback((event: ReactMouseEvent): void => {
    event.preventDefault();
    setAxiomMarkSubmenu(null);
    setAnnotateSubmenu(null);
    setEditWordingSubmenu(null);
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

  // Per-`(entityKind, entityId, facet)` server-derived facet status
  // map. Per `migrate_off_compute_facet_statuses_onto_proposal_status_broadcast`,
  // the canvas reads the broadcast-derived map and adapts it to the
  // existing `FacetStatusIndex` shape so the downstream
  // `StatementNodeData` plumbing stays untouched. Reference-equality
  // re-renders the canvas when a new `proposal-status` envelope lands
  // (the writer creates a fresh `Map` per applied envelope).
  //
  // When the broadcast-derived map is empty (the post-subscribe →
  // pre-seed window, or a unit test that exercises `<GraphCanvasPane>`
  // without driving the server-emit pipe), we fall through to the
  // pure-events derivation `computeFacetStatuses(events)` so the canvas
  // styling still reflects pending proposals the events log already
  // contains. Per refinement D4 — the broadcast IS the source of truth
  // when present; the fallback only carries the brief transitional
  // window. The merge layers broadcast cells over events-derived ones
  // (broadcast wins per `(entityKind, entityId, facet)`).
  const pendingProposalFacetStatus = useWsStore(
    (state) => state.sessionState[sessionId]?.pendingProposalFacetStatus,
  );
  const eventsBasedFacetStatusIndex = useMemo(() => computeFacetStatuses(events), [events]);
  const facetStatusIndex = useMemo<FacetStatusIndex>(() => {
    const broadcastIndex =
      pendingProposalFacetStatus === undefined || pendingProposalFacetStatus.size === 0
        ? EMPTY_FACET_STATUS_INDEX
        : buildFacetStatusIndexFromBroadcast(pendingProposalFacetStatus);
    if (broadcastIndex.nodes.size === 0 && broadcastIndex.edges.size === 0) {
      return eventsBasedFacetStatusIndex;
    }
    const mergedNodes = new Map(eventsBasedFacetStatusIndex.nodes);
    for (const [id, cells] of broadcastIndex.nodes) {
      const existing = mergedNodes.get(id);
      mergedNodes.set(id, existing ? { ...existing, ...cells } : cells);
    }
    const mergedEdges = new Map(eventsBasedFacetStatusIndex.edges);
    for (const [id, cells] of broadcastIndex.edges) {
      const existing = mergedEdges.get(id);
      mergedEdges.set(id, existing ? { ...existing, ...cells } : cells);
    }
    return { nodes: mergedNodes, edges: mergedEdges };
  }, [pendingProposalFacetStatus, eventsBasedFacetStatusIndex]);

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
  //
  // The combined edge array also includes the synthetic host pseudo-
  // edges per `mod_render_annotation_endpoint_edges`: one
  // `'annotation-host'` ReactFlow edge per promoted annotation tethering
  // it to its host node (or the host edge's source). The pseudo-edge
  // preserves the spatial association the badge currently provides
  // when an annotation is promoted to a node (Decision §4).
  const edges = useMemo(() => {
    const wsStateShape = {
      sessionState: {
        [sessionId]: {
          lastAppliedSequence: 0,
          events: events as Event[],
          pendingProposalFacetStatus: new Map(),
          activeDiagnostics: EMPTY_ACTIVE_DIAGNOSTICS,
        },
      },
    } as unknown as WsState;
    const statementEdges = selectEdgesForSession(wsStateShape, sessionId, diagnosticHighlights);
    const promoted = computeAnnotationsAsEndpoints(events);
    if (promoted.size === 0) {
      return statementEdges;
    }
    const hostEdges = projectAnnotationHostEdges(projectAnnotations(events), promoted, events);
    if (hostEdges.length === 0) {
      return statementEdges;
    }
    return [...statementEdges, ...hostEdges];
  }, [sessionId, events, diagnosticHighlights]);

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
  // Ids the canvas has ever projected. Distinguishes "truly new"
  // (never seen by this instance) from "evicted by measurement debounce"
  // (already known, just lost its cached position so dagre can re-place
  // it against the measured footprint). Only truly-new ids trigger the
  // full relayout path below.
  const knownNodeIdsRef = useRef<Set<string>>(new Set());
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
    const projected = projectNodes(events, diagnosticHighlights, facetStatusIndex);
    // ADR 0025 Amendment 2026-05-24: when at least one projected id is
    // truly new (never seen by this canvas instance — distinct from a
    // measurement-driven cache eviction, which removes an id from
    // `positionCacheRef` but leaves it in `knownNodeIdsRef`), run a
    // full `relayoutAll` over every node and stage the new ids for the
    // center-on-new pan below. When no id is truly new (annotations,
    // votes, facet status, edge-only changes between existing nodes,
    // measurement-driven evictions), keep the incremental cache path so
    // `mod_layout_measured_dimensions`' eviction-then-relayout flow
    // does not churn unrelated nodes.
    const trulyNewIds: string[] = [];
    for (const node of projected) {
      if (!knownNodeIdsRef.current.has(node.id)) {
        trulyNewIds.push(node.id);
      }
    }

    // Per `mod_render_annotation_endpoint_edges` Decision §5,
    // `AnnotationNode`s carry their own smaller per-card dimensions
    // (192×56) than `StatementNode` (288×90). Seed the dagre dimensions
    // map with the annotation-node constants for any ids not yet
    // measured by the ResizeObserver pass — once the measurement
    // arrives it overrides via the same map.
    const dimensions = new Map(measurementCacheRef.current);
    for (const node of projected) {
      if (node.type === ANNOTATION_NODE_TYPE && !dimensions.has(node.id)) {
        dimensions.set(node.id, {
          width: ANNOTATION_NODE_WIDTH,
          height: ANNOTATION_NODE_HEIGHT,
        });
      }
    }
    let laidOut: Node<StatementNodeData>[];
    if (trulyNewIds.length > 0) {
      laidOut = relayoutAll(projected, edges, {
        dimensions,
      });
      // Reset the position cache — every node received a fresh
      // placement, the prior cache entries are stale.
      positionCacheRef.current.clear();
      for (const id of trulyNewIds) {
        knownNodeIdsRef.current.add(id);
      }
    } else {
      laidOut = applyLayout(projected, edges, {
        cache: positionCacheRef.current,
        dimensions,
      });
    }
    // Mirror every emitted position into the cache so the NEXT
    // memoization tick reuses these positions for already-laid-out
    // nodes. The mutation does not drive a render (useRef semantics).
    for (const node of laidOut) {
      positionCacheRef.current.set(node.id, node.position);
    }
    // Append synthetic midpoint nodes for edge-hosted promoted
    // annotations (refinement `mod_annotation_node_edge_host_midpoint`).
    // Per Decision §2 these are NOT fed to dagre — they're added in a
    // downstream pass and positioned by `placeAnnotationHostMidpoints`
    // against the dagre output of the host edge's two endpoint nodes.
    // Their ids never enter `knownNodeIdsRef` / `positionCacheRef`, so
    // the ADR 0025 Amendment 2026-05-24 cache-stability contract holds
    // (midpoint ids don't trigger relayout when a new annotation
    // promotes; their position is derived from the dagre-managed
    // statement-node positions every render).
    const allAnnotations = projectAnnotations(events);
    const promotedAnnotationIds = computeAnnotationsAsEndpoints(events);
    const midpointNodes = projectAnnotationHostMidpointNodes(
      allAnnotations,
      promotedAnnotationIds,
      events,
    );
    if (midpointNodes.length === 0) {
      return laidOut;
    }
    const hostEdgeAnchors = buildAnnotationHostEdgeAnchorIndex(events);
    const combined = [...laidOut, ...(midpointNodes as unknown as Node<StatementNodeData>[])];
    // `placeAnnotationHostMidpoints` widens to `Node[]`; ReactFlow's
    // `nodes` prop accepts the same shape — node-type discrimination is
    // per-node via `node.type` regardless of the static `T` on `Node<T>`.
    return placeAnnotationHostMidpoints(combined, hostEdgeAnchors, dimensions);
    // `edges` is a new dep relative to the pre-layout-engine memo —
    // dagre's placement depends on the edge set, so adding an edge
    // between an existing node and a new node MUST re-run the layout.
    // `layoutRevision` is bumped by the measurement effect when an
    // evicted cache entry needs a fresh dagre pass for the measured
    // footprint. Refinement: `mod_layout_measured_dimensions`.
  }, [events, diagnosticHighlights, edges, layoutRevision, facetStatusIndex]);

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
  const { fitView } = reactFlow;
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
      // Drain the staged measurements: commit each into the measurement
      // cache, then CLEAR the entire position cache so the next
      // `applyLayout` pass treats every id as uncached and recomputes
      // a fresh dagre layout for the whole graph (per
      // `applyLayout`'s contract: an empty cache produces the same
      // result as `relayoutAll`).
      //
      // Why the full clear rather than per-id eviction: the prior
      // partial-eviction strategy fed the uncached node through dagre
      // alongside the cached neighbours and used dagre's coordinate
      // for the uncached node only. But dagre returns the whole graph
      // in its own coordinate space, not anchored to the cached
      // coordinate space — so the uncached node would snap to dagre's
      // absolute coord (often near the origin if the new node had no
      // edges yet), visually disconnected from the cached neighbours.
      // Concretely a freshly captured node rendered at the correct
      // dagre-layout position on first paint, then after the
      // ResizeObserver-driven measurement cascade jumped to a fixed
      // position. Clearing the whole cache so every node receives a
      // fresh, coherent placement is the simplest fix.
      //
      // Trade-off: every node moves on every measurement-driven
      // invalidation. The `mod_layout_measured_dimensions` refinement
      // originally chose per-id eviction to avoid that churn, but the
      // partial-cache approach was unsound. The user-triggered tidy-up
      // path (`handleTidyUp` above) already clears the whole cache for
      // the same reason; this brings the measurement path in line.
      const drained = pendingMeasurementsRef.current;
      if (drained.size === 0) return;
      for (const [id, rect] of drained.entries()) {
        measurementCacheRef.current.set(id, rect);
      }
      positionCacheRef.current.clear();
      pendingMeasurementsRef.current = new Map();
      // Bump the layout revision to invalidate the `nodes` `useMemo`.
      // The next memoization tick re-runs `applyLayout` with an empty
      // position cache + the freshly-populated measurement cache,
      // producing a fresh dagre arrangement that respects every node's
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
  // The node menu's `axiom-mark` item is wired to the canvas's
  // `axiomMarkSubmenu` opener (refinement `mod_axiom_mark_action`).
  let menuItems: readonly MenuItem[] = [];
  if (contextMenu !== null) {
    if (contextMenu.target.kind === 'node') {
      const nodeIdForSubmenu = contextMenu.target.id;
      const submenuX = contextMenu.x;
      const submenuY = contextMenu.y;
      // Methodology-gate computation for the
      // `run-operationalization-test` item. Per Decision §D5 of
      // mod_operationalization_mode.md, the item is always rendered
      // but disabled unless the target node's substance facet maps to
      // `'claim'` via `disputationOutcome(...)`. The gate runs at the
      // call site so the factory stays a pure shape function (the
      // factory accepts the precomputed `disabled` boolean).
      // The context menu's substance-gate + edit-wording prefill only
      // apply to statement nodes; annotation nodes (post
      // `mod_render_annotation_endpoint_edges`) carry no `facetStatuses`
      // / `wording` fields. Narrowing the find to statement nodes keeps
      // the type access honest and degrades gracefully for an
      // annotation-node right-click (the substance gate stays open via
      // the `undefined`-flowing path the disputation helper already
      // tolerates; the wording prefill falls back to '').
      const targetNode =
        contextMenu.target.id === null
          ? null
          : (nodes.find(
              (n): n is Node<StatementNodeData> =>
                n.id === contextMenu.target.id && n.type === STATEMENT_NODE_TYPE,
            ) ?? null);
      const substanceStatus = targetNode?.data.facetStatuses.substance;
      const disabledRunOperationalizationTest = disputationOutcome(substanceStatus) !== 'claim';
      // Independent constant for the warrant-elicitation gate per
      // mod_warrant_elicitation_mode.md Decision §D1 — same predicate
      // as the operationalization gate today (both contested-claim
      // methodology contexts via `disputationOutcome`), but a separate
      // boolean so a future divergence (if warrant-elicitation later
      // narrows to `'meta-disagreement'` only) is a one-line change.
      const disabledRunWarrantElicitationTest = disputationOutcome(substanceStatus) !== 'claim';
      menuItems = buildNodeMenuItems(
        contextMenu.target,
        () => {
          // Open the participant-picker submenu at a slight inset from
          // the parent menu's cursor coordinates so the two surfaces
          // don't overlap their borders. The parent context menu's
          // close-path runs synchronously right after this `onSelect`
          // (the menu shell auto-closes on item activation); we set
          // the submenu state inside the same React commit so the
          // submenu mounts on the next render alongside the closed
          // parent.
          if (nodeIdForSubmenu === null) return;
          setAxiomMarkSubmenu({
            nodeId: nodeIdForSubmenu,
            x: submenuX + 16,
            y: submenuY + 16,
          });
        },
        enterDecomposeMode,
        enterInterpretiveSplitMode,
        enterOperationalizationMode,
        disabledRunOperationalizationTest,
        enterWarrantElicitationMode,
        disabledRunWarrantElicitationTest,
        () => {
          // Open the annotate submenu against the right-clicked node.
          if (nodeIdForSubmenu === null) return;
          setAnnotateSubmenu({
            targetId: nodeIdForSubmenu,
            targetKind: 'node',
            x: submenuX + 16,
            y: submenuY + 16,
          });
        },
        () => {
          // Open the edit-wording submenu at a slight inset; the
          // textarea pre-fills with the current wording.
          if (nodeIdForSubmenu === null) return;
          const currentWording = targetNode?.data.wording ?? '';
          setEditWordingSubmenu({
            nodeId: nodeIdForSubmenu,
            x: submenuX + 16,
            y: submenuY + 16,
            currentWording,
          });
        },
      );
    } else if (contextMenu.target.kind === 'edge') {
      const edgeIdForSubmenu = contextMenu.target.id;
      const submenuX = contextMenu.x;
      const submenuY = contextMenu.y;
      menuItems = buildEdgeMenuItems(contextMenu.target, () => {
        // Open the annotate submenu against the right-clicked edge.
        // Mirrors the node-menu opener seam above.
        if (edgeIdForSubmenu === null) return;
        setAnnotateSubmenu({
          targetId: edgeIdForSubmenu,
          targetKind: 'edge',
          x: submenuX + 16,
          y: submenuY + 16,
        });
      });
    } else if (contextMenu.target.kind === 'annotation') {
      // Annotation-context-menu arm (mod_annotation_context_menu). Both
      // v1 items open the existing `<AnnotateSubmenu>` against the
      // annotation target; the "Disagree" opener pre-biases the
      // kind-radio to `'stance'` so the moderator's disagreement is
      // framed as a stance-shaped annotation. The annotate proposal
      // round-trip carries `target_kind: 'annotation'` (the wire
      // widening landed alongside this factory).
      const annotationIdForSubmenu = contextMenu.target.id;
      const submenuX = contextMenu.x;
      const submenuY = contextMenu.y;
      menuItems = buildAnnotationMenuItems(
        contextMenu.target,
        () => {
          if (annotationIdForSubmenu === null) return;
          setAnnotateSubmenu({
            targetId: annotationIdForSubmenu,
            targetKind: 'annotation',
            x: submenuX + 16,
            y: submenuY + 16,
          });
        },
        () => {
          if (annotationIdForSubmenu === null) return;
          setAnnotateSubmenu({
            targetId: annotationIdForSubmenu,
            targetKind: 'annotation',
            x: submenuX + 16,
            y: submenuY + 16,
            initialAnnotationKind: 'stance',
          });
        },
      );
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
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
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
      {axiomMarkSubmenu !== null ? (
        <AxiomMarkSubmenu
          nodeId={axiomMarkSubmenu.nodeId}
          x={axiomMarkSubmenu.x}
          y={axiomMarkSubmenu.y}
          events={events}
          onClose={closeAxiomMarkSubmenu}
        />
      ) : null}
      {annotateSubmenu !== null ? (
        <AnnotateSubmenu
          targetId={annotateSubmenu.targetId}
          targetKind={annotateSubmenu.targetKind}
          x={annotateSubmenu.x}
          y={annotateSubmenu.y}
          {...(annotateSubmenu.initialAnnotationKind !== undefined
            ? { initialAnnotationKind: annotateSubmenu.initialAnnotationKind }
            : {})}
          onClose={closeAnnotateSubmenu}
        />
      ) : null}
      {editWordingSubmenu !== null ? (
        <EditWordingSubmenu
          nodeId={editWordingSubmenu.nodeId}
          x={editWordingSubmenu.x}
          y={editWordingSubmenu.y}
          currentWording={editWordingSubmenu.currentWording}
          onClose={closeEditWordingSubmenu}
        />
      ) : null}
      {drawEdgePicker !== null ? (
        <DrawEdgeRolePicker
          source={drawEdgePicker.source}
          sourceKind={drawEdgePicker.sourceKind}
          target={drawEdgePicker.target}
          targetKind={drawEdgePicker.targetKind}
          x={drawEdgePicker.x}
          y={drawEdgePicker.y}
          onClose={closeDrawEdgePicker}
        />
      ) : null}
    </div>
  );
}
