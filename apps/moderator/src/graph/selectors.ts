// Store-derived selectors that translate the WS event log into the
// ReactFlow node / edge / annotation shapes the canvas consumes.
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md
// (prior:     tasks/refinements/moderator-ui/mod_proposed_state_styling.md,
//             tasks/refinements/moderator-ui/mod_annotation_rendering.md,
//             tasks/refinements/moderator-ui/mod_edge_rendering.md)
//
// `selectEdgesForSession` walks the per-session event log in `useWsStore`
// and projects every `edge-created` event into a ReactFlow `Edge<{ role,
// annotations }>`. `selectAnnotations` does the same for
// `annotation-created` events, returning a camelCased `Annotation[]` for
// downstream consumers (the node / edge projections enrich their per-
// target `data.annotations` from this list via `groupAnnotationsByNode`
// / `groupAnnotationsByEdge`).
//
// Every selector here is a pure function over `WsState`; none subscribes
// to the store itself (the consuming component decides how to subscribe).
// Pure means fully unit-testable without a React render.
//
// Sibling selector `selectNodesForSession` may land later; today the
// node projection lives in `GraphCanvasPane.tsx` as `projectNodes` so
// it can do the per-target annotation enrichment in a single pass.

import type { Edge } from 'reactflow';
import type { AnnotationKind, EdgeRole, Event, ProposalPayload } from '@a-conversa/shared-types';
// `Vote` is imported from the shell after the `extract_facet_pill` lift
// (refinement Decision §3 — the in-pill render-dependency chain ships
// with `<FacetPill>` in `@a-conversa/shell`). The remaining selector
// exports (annotations / axiom-marks / votes-by-facet projection helpers)
// stay here as moderator-graph-specific.
import type { Vote } from '@a-conversa/shell';

import {
  computeFacetStatuses,
  EMPTY_FACET_STATUSES,
  type FacetName,
  type FacetStatus,
} from './facetStatus.js';
import {
  EMPTY_DIAGNOSTIC_HIGHLIGHTS,
  type DiagnosticHighlight,
  type DiagnosticHighlightIndex,
} from './diagnosticHighlights.js';
import type { WsState } from '../ws/wsStore.js';

/**
 * Camel-cased annotation projected off the wire `annotation-created`
 * payload. Consumers (the node / edge projections, the badge component)
 * see this shape, not the snake-cased payload — the selector is the
 * conversion boundary so callers don't re-handle the wire keys.
 *
 * The `target_node_id` / `target_edge_id` XOR enforced by Zod at the
 * validation seam is preserved as a `string | null` pair on the camelCased
 * shape; consumers route the annotation to a node or an edge target by
 * checking which field is non-null.
 */
export interface Annotation {
  readonly id: string;
  readonly kind: AnnotationKind;
  readonly content: string;
  readonly targetNodeId: string | null;
  readonly targetEdgeId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

/** Payload carried on each rendered edge — the role drives the label and (later) the per-state styling. */
export interface StatementEdgeData {
  role: EdgeRole;
  /**
   * The annotations targeting this edge. Empty when no `annotation-
   * created` event references the edge. Read by `<StatementEdge>` to
   * render the badge row beneath the role label.
   */
  annotations: readonly Annotation[];
  /**
   * Per-facet `FacetStatus` for this edge. Read by `<StatementEdge>` to
   * apply the proposed / agreed / disputed state styling (refinement
   * `mod_proposed_state_styling` and siblings). Empty when no facet-
   * targeting proposal references the edge — the styling falls back to
   * the solid-stroke default. Edges carry only the `substance` facet
   * in v1; this record's shape allows the sibling per-facet-state
   * task to add more facets without changing the contract.
   */
  facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>;
  /**
   * Per-entity diagnostic highlight from the active-diagnostic set, or
   * `undefined` when no active diagnostic touches this edge. Read by
   * `<StatementEdge>` to compose the amber halo onto the role-label
   * pill. Refinement:
   * `tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md`.
   */
  diagnosticHighlight?: DiagnosticHighlight;
  /**
   * Source-node id, copied verbatim from the `edge-created` event's
   * `source_node_id` payload field. Read by `<HoverPopover>` to render
   * the edge popover's endpoint-references row — the canvas-stable
   * canonical handle for cross-referencing an edge endpoint with the
   * matching `data-testid="statement-node-<id>"` card. Refinement:
   * `tasks/refinements/moderator-ui/mod_edge_popover_full_target_wording.md`.
   *
   * Non-optional: every `edge-created` event carries the id by wire
   * contract, so the selector always projects a string here.
   */
  sourceId: string;
  /**
   * Target-node id, copied verbatim from the `edge-created` event's
   * `target_node_id` payload field. Same semantics as `sourceId`.
   * Refinement: `tasks/refinements/moderator-ui/mod_edge_popover_full_target_wording.md`.
   */
  targetId: string;
  /**
   * Wording of this edge's source node, as projected from the per-session
   * `node-created` payloads. Refinements:
   * `tasks/refinements/moderator-ui/mod_hover_details.md`,
   * `tasks/refinements/moderator-ui/mod_edge_popover_full_target_wording.md`.
   *
   * Non-optional: every edge the selector emits carries a string value.
   * When the source-node id has not yet been seen in the events log
   * (a wire-protocol violation but defensible), the value is the
   * documented `'—'` em-dash fallback rather than `undefined` — keeps
   * the renderer's null-check surface small.
   *
   * No longer consumed by `<HoverPopover>` after
   * `mod_edge_popover_full_target_wording` (Option C): the edge popover
   * now renders source/target *ids*, not wordings, to avoid duplicating
   * card content (`<StatementNode>` already renders the full wording
   * with measured dimensions per `mod_layout_measured_dimensions`).
   * The field is retained for future surfaces (per-edge sidebar
   * detail, audit log, diagnostic detail panel) that may want endpoint
   * wordings — the projection is cheap, the field is part of the
   * selector's stable surface, and removing it would force regression
   * sweeps across existing tests.
   *
   * Wording staleness caveat: the wording surfaced here is the
   * ORIGINAL value from the `node-created` payload. Committed
   * `edit-wording` proposals do NOT update this field today — mirrors
   * today's `projectNodes` semantics. A future refinement
   * (`mod_capture_flow.mod_edit_wording_flow`) will update both
   * projections to consume committed wording edits in lockstep.
   */
  sourceWording: string;
  /**
   * Wording of this edge's target node, as projected from the per-session
   * `node-created` payloads. Same semantics, fallback, retention
   * rationale, and staleness caveat as `sourceWording`. Refinements:
   * `tasks/refinements/moderator-ui/mod_hover_details.md`,
   * `tasks/refinements/moderator-ui/mod_edge_popover_full_target_wording.md`.
   */
  targetWording: string;
}

/**
 * Module-scope shared empty annotation array. Hands a stable reference
 * to consumers when a target has no annotations, so React / ReactFlow
 * memoization (`Array.length === 0` is identity-stable here) doesn't
 * see a fresh array on every projection pass.
 */
export const EMPTY_ANNOTATIONS: readonly Annotation[] = Object.freeze([]);

/**
 * Project the per-session WS event log into the camelCased annotation
 * list. Walks `state.sessionState[sessionId]?.events` once and picks
 * every `annotation-created` envelope.
 *
 * Empty for an unknown `sessionId` or an empty event log.
 */
export function selectAnnotations(state: WsState, sessionId: string): Annotation[] {
  const session = state.sessionState[sessionId];
  if (!session) return [];
  return projectAnnotations(session.events);
}

/**
 * Resolve the current wording for a single node by id from a session's
 * event log.
 *
 * Refinement: tasks/refinements/moderator-ui/mod_target_auto_suggest.md
 *
 * Walks the events linearly, picks every `node-created` envelope for
 * the requested id, and returns the *last* one seen (mirrors the rest
 * of the projection rules' "last-write-wins" semantics; duplicate
 * `node-created` events for the same id would be a wire-protocol
 * violation but the selector is deterministic regardless). Returns
 * `null` when no `node-created` event for the id exists in the slice.
 *
 * The cost is one O(N) scan per call. The single consumer
 * (`<CaptureTargetChip>`) calls this once per render when the staged
 * target is non-null; for sessions with thousands of events the cost
 * is trivial compared to the React render the chip already pays.
 *
 * Pure function over `Event[]`; reuses the events slice the consumer
 * already has via `useWsStore`.
 */
export function selectNodeWordingById(events: readonly Event[], nodeId: string): string | null {
  let wording: string | null = null;
  for (const event of events) {
    if (event.kind !== 'node-created') continue;
    if (event.payload.node_id !== nodeId) continue;
    wording = event.payload.wording;
  }
  return wording;
}

/**
 * Pure projection from an `Event[]` slice to the `Annotation[]` shape.
 *
 * Exported separately so `projectNodes` in `GraphCanvasPane.tsx` can
 * re-use it without going through the store — the node projection is a
 * pure function of `events` (no `WsState` dependency), so the enrichment
 * pass walks the same events array directly.
 */
export function projectAnnotations(events: readonly Event[]): Annotation[] {
  const out: Annotation[] = [];
  for (const event of events) {
    if (event.kind !== 'annotation-created') continue;
    out.push({
      id: event.payload.annotation_id,
      kind: event.payload.kind,
      content: event.payload.content,
      targetNodeId: event.payload.target_node_id,
      targetEdgeId: event.payload.target_edge_id,
      createdBy: event.payload.created_by,
      createdAt: event.payload.created_at,
    });
  }
  return out;
}

/**
 * Bucket annotations by their node target.
 *
 * Returns a `Map` rather than a plain `Object` so `get(id)` lookups are
 * O(1) without the JSON-key string-coercion gotcha that surfaces when
 * ids contain dashes (UUIDs do). Annotations targeting an edge (i.e.
 * with `targetNodeId === null`) are skipped.
 */
export function groupAnnotationsByNode(
  annotations: readonly Annotation[],
): Map<string, Annotation[]> {
  const out = new Map<string, Annotation[]>();
  for (const annotation of annotations) {
    if (annotation.targetNodeId === null) continue;
    const existing = out.get(annotation.targetNodeId);
    if (existing) {
      existing.push(annotation);
    } else {
      out.set(annotation.targetNodeId, [annotation]);
    }
  }
  return out;
}

/**
 * Bucket annotations by their edge target. Annotations targeting a
 * node (`targetEdgeId === null`) are skipped. Same `Map` rationale as
 * `groupAnnotationsByNode`.
 */
export function groupAnnotationsByEdge(
  annotations: readonly Annotation[],
): Map<string, Annotation[]> {
  const out = new Map<string, Annotation[]>();
  for (const annotation of annotations) {
    if (annotation.targetEdgeId === null) continue;
    const existing = out.get(annotation.targetEdgeId);
    if (existing) {
      existing.push(annotation);
    } else {
      out.set(annotation.targetEdgeId, [annotation]);
    }
  }
  return out;
}

/**
 * Camel-cased projection of one committed axiom-mark on a node.
 *
 * Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md
 *
 * An axiom-mark is the methodology's per-participant "this node is bedrock
 * for this participant" disposition (`docs/methodology.md` §"Axioms /
 * terminal values"). Per-participant means a single node can carry N
 * `AxiomMark` records — one per participant who marked it. The rendering
 * layer surfaces every record as a separate decoration badge on the node
 * (`<AxiomMarkBadge>`) so the moderator sees both which nodes are marked
 * AND which participant marked each one.
 *
 * `committedAt` carries the commit envelope's `committed_at` so downstream
 * sorting / tooltip-detail tasks don't have to re-walk the log.
 */
export interface AxiomMark {
  readonly nodeId: string;
  readonly participantId: string;
  readonly committedAt: string;
}

/**
 * Module-scope shared empty axiom-mark array. Hands a stable reference to
 * consumers (the node projection's `data.axiomMarks` default) so React /
 * ReactFlow memoization doesn't see a fresh array on every projection
 * pass. Same rationale as `EMPTY_ANNOTATIONS`.
 */
export const EMPTY_AXIOM_MARKS: readonly AxiomMark[] = Object.freeze([]);

/**
 * Pure projection from a session's event log to the `AxiomMark[]` shape.
 *
 * Walks `events` once. For each `proposal` event whose inner proposal is
 * `axiom-mark`, records the (nodeId, participantId) pair against the
 * proposal envelope id. For each `commit` event whose `proposal_id`
 * matches a recorded axiom-mark proposal, emits one `AxiomMark` with the
 * commit's `committed_at`. Uncommitted axiom-mark proposals produce **no**
 * output — the rendering layer treats the badge as the methodology-
 * disposition "ratified" state, not the in-flight vote (the pending
 * visualization is owned by `mod_axiom_mark_pending_render` downstream).
 *
 * Emission order is commit-event arrival order. The typical debate
 * scenario — A marks N9, then B marks N9 — emits A's mark first.
 */
export function projectAxiomMarks(events: readonly Event[]): AxiomMark[] {
  // Map from proposal envelope id → (nodeId, participantId) for axiom-
  // mark proposals seen in the walk. A commit whose proposal_id references
  // an unseen / non-axiom-mark proposal contributes nothing.
  const pending = new Map<string, { nodeId: string; participantId: string }>();
  const out: AxiomMark[] = [];
  for (const event of events) {
    if (event.kind === 'proposal') {
      const inner = event.payload.proposal;
      if (inner.kind === 'axiom-mark') {
        pending.set(event.id, { nodeId: inner.node_id, participantId: inner.participant });
      }
      continue;
    }
    if (event.kind === 'commit') {
      // TODO(pf_commit_handler_facet_keyed): commit payloads are now a
      // `target`-discriminated union. The methodology engine emits
      // proposal-keyed commits for every sub-kind today; read only
      // that arm until the downstream task lands facet-keyed emission.
      if (event.payload.target !== 'proposal') continue;
      const proposal = pending.get(event.payload.proposal_id);
      if (proposal === undefined) continue;
      out.push({
        nodeId: proposal.nodeId,
        participantId: proposal.participantId,
        committedAt: event.payload.committed_at,
      });
      continue;
    }
  }
  return out;
}

/**
 * Bucket axiom-marks by their target node id. Returns a `Map` rather
 * than a plain `Object` for the same UUID-key + `O(1)` rationale as
 * `groupAnnotationsByNode`.
 */
export function groupAxiomMarksByNode(marks: readonly AxiomMark[]): Map<string, AxiomMark[]> {
  const out = new Map<string, AxiomMark[]>();
  for (const mark of marks) {
    const existing = out.get(mark.nodeId);
    if (existing) {
      existing.push(mark);
    } else {
      out.set(mark.nodeId, [mark]);
    }
  }
  return out;
}

/**
 * Camel-cased projection of one **pending** (proposed-but-not-yet-
 * committed) axiom-mark on a node.
 *
 * Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_pending_render.md
 *
 * Parallel to `AxiomMark` (the committed-side projection) but keyed on
 * the proposal-event id rather than the commit-event id. A node may
 * carry multiple pending records (one per uncommitted axiom-mark
 * proposal targeting it); each renders as a separate dashed-faded
 * dot on the moderator's canvas.
 *
 * `proposalEventId` is the stable join key back to the proposal
 * envelope — future per-mark vote / tooltip-detail tasks can resolve
 * it via the events log without re-walking everything. `proposedAt`
 * carries the proposal envelope's `createdAt` so per-mark sorting
 * has the timestamp without re-walking the log (same rationale as
 * `AxiomMark.committedAt`).
 */
export interface PendingAxiomMark {
  readonly proposalEventId: string;
  readonly nodeId: string;
  readonly participantId: string;
  readonly proposedAt: string;
}

/**
 * Module-scope shared empty pending-axiom-mark array. Hands a stable
 * reference to consumers (the node projection's `data.pendingAxiomMarks`
 * default) so React / ReactFlow memoization doesn't see a fresh array
 * on every projection pass. Same rationale as `EMPTY_AXIOM_MARKS`.
 */
export const EMPTY_PENDING_AXIOM_MARKS: readonly PendingAxiomMark[] = Object.freeze([]);

/**
 * Pure projection from a session's event log to the `PendingAxiomMark[]`
 * shape — i.e. the in-flight axiom-mark proposals that have not yet been
 * committed or escalated to meta-disagreement.
 *
 * Walks `events` once. For each `proposal` event whose inner proposal is
 * `axiom-mark`, records the (nodeId, participantId, proposedAt) tuple
 * against the proposal envelope id. For each `commit` or
 * `meta-disagreement-marked` event whose `proposal_id` matches a
 * recorded axiom-mark proposal, removes the entry (mirrors
 * `derivePendingProposals`'s two-terminator handling per Decision §1 of
 * the pending-render refinement).
 *
 * The surviving entries are emitted in proposal-arrival order — the
 * typical debate scenario "A proposes axiom-mark on N9 first, then B
 * proposes theirs" renders A's pending dot before B's.
 *
 * Per Decision §2, the selector does NOT enforce per-participant
 * uniqueness: two pending axiom-mark proposals from the same
 * `(node, participant)` pair both surface as separate entries. The
 * propose-side validator's rule 4 only rejects when a *committed*
 * duplicate exists; the rendering must handle the pre-engine-validation
 * transient gracefully (two dots, both dashed-faded, until one commits).
 */
export function projectPendingAxiomMarks(events: readonly Event[]): PendingAxiomMark[] {
  // Map from proposal envelope id → the pending record. Linked-Map
  // iteration preserves proposal-arrival order so the emitted output
  // tracks the proposal sequence (NOT terminator sequence — pending
  // means "not yet terminated").
  const pending = new Map<string, PendingAxiomMark>();
  for (const event of events) {
    if (event.kind === 'proposal') {
      const inner = event.payload.proposal;
      if (inner.kind === 'axiom-mark') {
        pending.set(event.id, {
          proposalEventId: event.id,
          nodeId: inner.node_id,
          participantId: inner.participant,
          proposedAt: event.createdAt,
        });
      }
      continue;
    }
    if (event.kind === 'commit') {
      // TODO(pf_commit_handler_facet_keyed): commit payloads are now a
      // `target`-discriminated union. The methodology engine emits
      // proposal-keyed commits for every sub-kind today; read only
      // that arm until the downstream task lands facet-keyed emission.
      if (event.payload.target !== 'proposal') continue;
      pending.delete(event.payload.proposal_id);
      continue;
    }
    if (event.kind === 'meta-disagreement-marked') {
      // TODO(pf_meta_disagreement_handler_facet_keyed): meta-disagreement-marked
      // payloads are now a `target`-discriminated union. The methodology
      // engine emits proposal-keyed marks for every sub-kind today; read
      // only that arm until the downstream task lands facet-keyed emission.
      if (event.payload.target !== 'proposal') continue;
      pending.delete(event.payload.proposal_id);
      continue;
    }
  }
  return Array.from(pending.values());
}

/**
 * Bucket pending axiom-marks by their target node id. Same `Map`-vs-
 * `Object` rationale as `groupAxiomMarksByNode` — UUID keys + `O(1)`
 * `get` lookups during the per-node enrichment pass in `projectNodes`.
 */
export function groupPendingAxiomMarksByNode(
  marks: readonly PendingAxiomMark[],
): Map<string, PendingAxiomMark[]> {
  const out = new Map<string, PendingAxiomMark[]>();
  for (const mark of marks) {
    const existing = out.get(mark.nodeId);
    if (existing) {
      existing.push(mark);
    } else {
      out.set(mark.nodeId, [mark]);
    }
  }
  return out;
}

// `AxiomMarkColor` interface, `AXIOM_MARK_PALETTE`, `AXIOM_MARK_PALETTE_SIZE`,
// and the `axiomMarkColorFor` deterministic per-participant color hash
// lifted into `@a-conversa/shell/facet-pill/participant-color.ts` per the
// `extract_facet_pill` refinement Decision §3. Consumers (the moderator's
// `<AxiomMarkBadge>` / `<PendingAxiomMarkBadge>` / `<HoverPopover>` /
// `<VoteIndicator>` / tests) import directly from `@a-conversa/shell`.

/**
 * Project the per-session WS event log into the ReactFlow edge list.
 *
 * Walks `state.sessionState[sessionId]?.events` once, picks every
 * `edge-created` envelope, and maps each to a ReactFlow `Edge` with
 * `type: 'statement'` (the single entry in `edgeTypes`), the role
 * stashed on `data` so `<StatementEdge>` can render the localized label,
 * and the matching annotations bucketed in via
 * `groupAnnotationsByEdge`. Downstream state-styling tasks can still
 * read `data.role` as the stable discriminator.
 *
 * Empty for an unknown `sessionId` or an empty event log — the consuming
 * component renders no edges in that case, which is the expected idle
 * state before the WS catch-up replay lands the first events.
 */
export function selectEdgesForSession(
  state: WsState,
  sessionId: string,
  highlights: DiagnosticHighlightIndex = EMPTY_DIAGNOSTIC_HIGHLIGHTS,
): Edge<StatementEdgeData>[] {
  const session = state.sessionState[sessionId];
  if (!session) return [];
  const annotationsByEdge = groupAnnotationsByEdge(projectAnnotations(session.events));
  // Per-edge per-facet `FacetStatus` index — computed once over the same
  // events array so the projection stays a single pass-effort over the
  // log. Refinement: `mod_proposed_state_styling`.
  const facetStatusIndex = computeFacetStatuses(session.events);
  // Per-node wording index built up from every `node-created` event in
  // the session's log. Read for each emitted edge to populate
  // `data.sourceWording` / `data.targetWording`. Refinement:
  // `mod_hover_details`. Wording is the ORIGINAL `node-created` payload
  // value — committed `edit-wording` proposals do not yet feed this
  // index (matches today's `projectNodes` semantics; a future task
  // updates both projections together).
  const wordingByNodeId = new Map<string, string>();
  for (const event of session.events) {
    if (event.kind === 'node-created') {
      wordingByNodeId.set(event.payload.node_id, event.payload.wording);
    }
  }
  const out: Edge<StatementEdgeData>[] = [];
  for (const event of session.events) {
    if (event.kind !== 'edge-created') continue;
    const annotations = annotationsByEdge.get(event.payload.edge_id) ?? EMPTY_ANNOTATIONS;
    const facetStatuses = facetStatusIndex.edges.get(event.payload.edge_id) ?? EMPTY_FACET_STATUSES;
    // Per-edge diagnostic-highlight enrichment from the precomputed
    // index. Refinement: `mod_diagnostic_highlighting`. Absent ids
    // resolve to `undefined`, which the consumer (`<StatementEdge>`)
    // reads as "no halo".
    const diagnosticHighlight = highlights.edges.get(event.payload.edge_id);
    // Edge endpoint wordings. Refinement: `mod_hover_details`. The
    // `'—'` em-dash fallback is the documented behaviour for an edge
    // whose source or target id hasn't been seen as a `node-created`
    // payload yet — defensible against a wire-protocol violation. Both
    // fields are non-optional on the emitted `StatementEdgeData` so
    // the popover renderer's null-check surface stays small.
    const sourceWording = wordingByNodeId.get(event.payload.source_node_id) ?? '—';
    const targetWording = wordingByNodeId.get(event.payload.target_node_id) ?? '—';
    // Edge endpoint ids — populated verbatim from the `edge-created`
    // payload's `source_node_id` / `target_node_id`. Read by
    // `<HoverPopover>` to render the endpoint-references row (the
    // popover surface that replaced the retired source→target wording
    // line per `mod_edge_popover_full_target_wording`). No walk
    // needed; the ids are always present on the event.
    const sourceId = event.payload.source_node_id;
    const targetId = event.payload.target_node_id;
    const data: StatementEdgeData =
      diagnosticHighlight === undefined
        ? {
            role: event.payload.role,
            annotations,
            facetStatuses,
            sourceId,
            targetId,
            sourceWording,
            targetWording,
          }
        : {
            role: event.payload.role,
            annotations,
            facetStatuses,
            diagnosticHighlight,
            sourceId,
            targetId,
            sourceWording,
            targetWording,
          };
    out.push({
      id: event.payload.edge_id,
      source: event.payload.source_node_id,
      target: event.payload.target_node_id,
      type: 'statement',
      data,
    });
  }
  return out;
}

// -- Per-participant vote projection --------------------------------
//
// Refinement: tasks/refinements/moderator-ui/mod_vote_indicators_on_graph.md
//
// `projectVotesByFacet` walks the per-session event log and produces a
// per-node per-facet list of `Vote` records — one entry per participant
// who voted on the facet's pending proposal, recording the participant's
// *latest* vote arm. The result is consumed by the in-pill vote-indicator
// row to surface "who voted what" ambiently on the canvas.
//
// **Methodology semantics**: every facet-targeting proposal sub-kind has
// at most one in-flight proposal per facet at a time (the server's
// methodology engine enforces this; once a proposal is committed or
// meta-disagreed, it's closed and a new one can be opened). This
// projection mirrors the server-side rule of `apps/server/src/methodology/
// handlers/vote.ts` rule 4: latest vote per `(proposal, participant)`
// wins; agree↔dispute switches are legal and surface as the new arm.
//
// **Scope**: facet-targeting sub-kinds (`classify-node`,
// `set-node-substance`, `edit-wording`, `amend-node`,
// `set-edge-substance`). Edge-substance votes are bucketed under the
// edge id alongside node-keyed buckets — node and edge UUIDs share the
// same outer-map keyspace because they are disjoint by construction
// (UUID-v4 collisions are not modeled). Refinement:
// `mod_vote_indicators_in_sidebar` Decision §4 — the sidebar surface
// renders one chip per pending proposal regardless of entity kind and
// needs per-participant votes for edge-substance proposals too; the
// existing graph consumer (which only ever looks up node ids in the
// map) is unaffected because edge UUIDs simply don't appear in its
// lookups. Structural sub-kinds (`decompose`, `interpretive-split`,
// `axiom-mark`, `meta-move`, `break-edge`, `annotate`) contribute
// nothing — they don't target a (entity, facet) pair.

// `Vote` interface and `EMPTY_VOTES` constant lifted into
// `@a-conversa/shell/facet-pill/vote-indicator.ts` per the
// `extract_facet_pill` refinement Decision §3. The moderator imports
// both directly from `@a-conversa/shell` (see the top-of-file import).

/**
 * Module-scope shared empty vote-by-facet record. Hands a stable
 * reference to consumers (the node projection's `data.votesByFacet`
 * default) so React / ReactFlow memoization doesn't see a fresh object
 * on every projection pass. Same rationale as `EMPTY_ANNOTATIONS` and
 * `EMPTY_FACET_STATUSES`.
 */
export const EMPTY_VOTES_BY_FACET: Readonly<Partial<Record<FacetName, readonly Vote[]>>> =
  Object.freeze({});

/**
 * Decode the (entityKind, entityId, facet) target of a proposal payload
 * for vote projection. The five facet-targeting sub-kinds resolve to a
 * target — four node-keyed (`classify-node`, `set-node-substance`,
 * `edit-wording`, `amend-node`) and one edge-keyed
 * (`set-edge-substance`). Structural sub-kinds return `null` so the
 * caller drops the proposal from the projection.
 *
 * Refinement: `mod_vote_indicators_in_sidebar` Decision §4 — the
 * `set-edge-substance` arm is the additive extension that lets the
 * sidebar surface render the per-participant dot row on edge-substance
 * proposal chips. Node ids and edge ids share the outer-map keyspace
 * because UUIDs don't collide across entity types; the `entityKind`
 * field is preserved on the return value for type-narrowing parity with
 * `proposalFacets.facetTargetOf`, even though the projection's
 * downstream accumulator only consumes `entityId`.
 */
function voteTargetOf(
  proposal: ProposalPayload,
): { entityKind: 'node' | 'edge'; entityId: string; facet: FacetName } | null {
  switch (proposal.kind) {
    case 'classify-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'classification' };
    case 'set-node-substance':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'substance' };
    case 'set-edge-substance':
      return { entityKind: 'edge', entityId: proposal.edge_id, facet: 'substance' };
    case 'edit-wording':
    case 'amend-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    default:
      // decompose, interpretive-split, axiom-mark, meta-move,
      // break-edge, annotate — no per-(entity, facet) target.
      return null;
  }
}

/**
 * Pure projection from a session's event log to the per-node per-facet
 * `Vote[]` index. Single-pass over `events`.
 *
 * For each `proposal` event whose inner proposal targets a (nodeId,
 * facet), records the proposal-id → target mapping. For each subsequent
 * `vote` event referencing a known target, records the participant's
 * latest vote (last-write-wins per `(proposal, participant)`).
 *
 * Insertion order in the per-facet list: order of each participant's
 * FIRST vote on that facet (subsequent votes by the same participant
 * overwrite the choice in-place, preserving the original position).
 * This keeps the rendered dot order stable across the agree↔dispute
 * switch — the dot for participant A doesn't jump to the end of the
 * row when A switches from agree to dispute.
 *
 * Unknown / non-facet-targeting proposals contribute nothing. Votes
 * referencing an unknown proposal are silently dropped.
 */
export function projectVotesByFacet(events: readonly Event[]): Map<string, Map<FacetName, Vote[]>> {
  // proposal envelope id → (entityKind, entityId, facet) target.
  const proposalTarget = new Map<
    string,
    { entityKind: 'node' | 'edge'; entityId: string; facet: FacetName }
  >();
  // per-(entityId, facet) accumulator: keeps both an ordered list of
  // votes and a participantId → index map for in-place overwrite of a
  // participant's latest arm without disturbing arrival order. The
  // outer-map key is `entityId` (node UUID OR edge UUID — disjoint
  // keyspaces per Decision §4).
  const out = new Map<string, Map<FacetName, Vote[]>>();
  const positionIndex = new Map<string, Map<FacetName, Map<string, number>>>();

  for (const event of events) {
    if (event.kind === 'proposal') {
      const target = voteTargetOf(event.payload.proposal);
      if (target === null) continue;
      proposalTarget.set(event.id, target);
      continue;
    }
    if (event.kind === 'vote') {
      // Per ADR 0030 §2: vote payloads are a `target`-discriminated
      // union. Resolve to the `(entityId, facet)` pair from either
      // arm — the facet-keyed arm carries it directly; the proposal-
      // keyed arm looks it up via the proposal-id → target map.
      let entityId: string;
      let facet: FacetName;
      if (event.payload.target === 'facet') {
        entityId = event.payload.entity_id;
        facet = event.payload.facet;
      } else {
        const target = proposalTarget.get(event.payload.proposal_id);
        if (target === undefined) continue;
        entityId = target.entityId;
        facet = target.facet;
      }

      let perEntity = out.get(entityId);
      if (perEntity === undefined) {
        perEntity = new Map();
        out.set(entityId, perEntity);
      }
      let perFacet = perEntity.get(facet);
      if (perFacet === undefined) {
        perFacet = [];
        perEntity.set(facet, perFacet);
      }

      let perEntityPositions = positionIndex.get(entityId);
      if (perEntityPositions === undefined) {
        perEntityPositions = new Map();
        positionIndex.set(entityId, perEntityPositions);
      }
      let perFacetPositions = perEntityPositions.get(facet);
      if (perFacetPositions === undefined) {
        perFacetPositions = new Map();
        perEntityPositions.set(facet, perFacetPositions);
      }

      const participantId = event.payload.participant;
      const choice = event.payload.choice;
      const priorIndex = perFacetPositions.get(participantId);
      if (priorIndex === undefined) {
        perFacetPositions.set(participantId, perFacet.length);
        perFacet.push({ participantId, choice });
      } else {
        perFacet[priorIndex] = { participantId, choice };
      }
      continue;
    }
    // Other event kinds (commit, meta-disagreement-marked, node-created,
    // edge-created, annotation-created, etc.) do not contribute votes.
    // A commit or meta-disagreement-marked event closes the proposal on
    // the methodology side but the votes recorded BEFORE closure remain
    // surfaced — they're the historical record of who agreed (the
    // moderator still wants to see "Alice agreed, Bob agreed" on a
    // committed proposal). Server-side write rules prevent further
    // arm-switching votes after commit (rule 3 in vote.ts), so the
    // last-write-wins semantics are stable.
  }

  return out;
}

// ---------------------------------------------------------------------
// `projectVotesByProposal` — per-proposal-id vote bucket for the
// structural sub-kinds (`decompose`, `interpretive-split`, `axiom-mark`,
// `annotate`, etc.). Mirrors `projectVotesByFacet` for the four
// facet-targeting sub-kinds but keys on proposal id instead of
// `(entityId, facet)` — structural proposals don't have a
// `(entity, facet)` pair to bucket by; the unanimity walk is per
// proposal envelope id.
//
// **Methodology semantics**: a structural proposal is fully described
// by its envelope id; the participant's vote against it carries that
// id verbatim on the wire. The unanimity gate (`checkUnanimousAgreeStructural`
// per commit `421353f`) walks the pending proposal's `perParticipantVotes`
// map — this projection mirrors that map on the client so the
// moderator-side commit-gate predicate can evaluate the same shape.
//
// **Scope**: every proposal kind that is NOT facet-targeting. The
// projection records the entry, regardless of sub-kind, because a
// `vote` envelope's `proposal_id` is the canonical reference; the
// caller (the moderator commit-gate) filters by sub-kind / by the
// proposal's lifecycle state.
//
// **Latest-vote-wins, position-stable**: same arrival-order semantics
// as `projectVotesByFacet`. The first vote from each participant pins
// their position; subsequent arm-switches overwrite in place.
// ---------------------------------------------------------------------

/**
 * Pure projection from a session's event log to a per-proposal-id
 * `Vote[]` index. Single-pass over `events`.
 *
 * For each `proposal` event, records that the envelope id is a known
 * proposal. For each subsequent `vote` event referencing a known
 * proposal id, records the participant's latest vote
 * (last-write-wins per `(proposal, participant)`).
 *
 * Position semantics: the first vote on a proposal from each
 * participant pins their position; subsequent arm-switches overwrite
 * in place. Stable order matches the methodology-pinned wire-arrival
 * order on the server.
 *
 * Unknown / out-of-order votes (referencing a proposal id not yet seen
 * in the log) are silently dropped — the projection is forward-only.
 */
export function projectVotesByProposal(events: readonly Event[]): Map<string, Vote[]> {
  const knownProposals = new Set<string>();
  const out = new Map<string, Vote[]>();
  // per-(proposalId) participant → position map, mirroring the
  // `projectVotesByFacet` convention for in-place overwrite.
  const positionIndex = new Map<string, Map<string, number>>();

  for (const event of events) {
    if (event.kind === 'proposal') {
      knownProposals.add(event.id);
      continue;
    }
    if (event.kind === 'vote') {
      // Per ADR 0030 §2 + §9: this projection buckets per-proposal-id
      // votes for STRUCTURAL sub-kinds only — those still use the
      // proposal-keyed arm (`target === 'proposal'`). Facet-keyed
      // votes (`target === 'facet'`) attach to `(entity, facet)` and
      // have no proposal_id to bucket on — `projectVotesByFacet`
      // above is the corresponding facet-side projection. Skip the
      // facet-keyed arm here.
      if (event.payload.target !== 'proposal') continue;
      const proposalId = event.payload.proposal_id;
      if (!knownProposals.has(proposalId)) continue;

      let perProposal = out.get(proposalId);
      if (perProposal === undefined) {
        perProposal = [];
        out.set(proposalId, perProposal);
      }
      let perProposalPositions = positionIndex.get(proposalId);
      if (perProposalPositions === undefined) {
        perProposalPositions = new Map();
        positionIndex.set(proposalId, perProposalPositions);
      }
      const participantId = event.payload.participant;
      const choice = event.payload.choice;
      const priorIndex = perProposalPositions.get(participantId);
      if (priorIndex === undefined) {
        perProposalPositions.set(participantId, perProposal.length);
        perProposal.push({ participantId, choice });
      } else {
        perProposal[priorIndex] = { participantId, choice };
      }
      continue;
    }
    // commit / meta-disagreement-marked / node-created / etc. — same
    // posture as `projectVotesByFacet`: the historical vote record
    // remains surfaced after closure.
  }
  return out;
}
