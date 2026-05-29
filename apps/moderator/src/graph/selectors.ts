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

import { MarkerType, type Edge, type EdgeMarker } from 'reactflow';
import type { EdgeRole, Event } from '@a-conversa/shared-types';
// `Vote` is imported from the shell after the `extract_facet_pill` lift
// (refinement Decision §3 — the in-pill render-dependency chain ships
// with `<FacetPill>` in `@a-conversa/shell`). The annotation projection
// trio (`Annotation` / `EMPTY_ANNOTATIONS` / `projectAnnotations` /
// `groupAnnotationsBy{Node,Edge}`) also lives in the shell after the
// `shell_package.extract_cytoscape_projectors` lift; the per-(entity,
// facet) vote projectors (`projectVotesByFacet` / `projectOtherVotesByFacet`)
// live in the shell after `shell_package.extract_votes_by_facet_projector_v2`.
// The remaining selector exports (pending axiom-marks projector,
// per-proposal-id vote projector) stay here as moderator-graph-specific.
import {
  EMPTY_ANNOTATIONS,
  EMPTY_FACET_STATUSES,
  computeFacetStatuses,
  groupAnnotationsByEdge,
  projectAnnotations,
  type Annotation,
  type FacetName,
  type FacetStatus,
  type Vote,
} from '@a-conversa/shell';

import {
  EMPTY_DIAGNOSTIC_HIGHLIGHTS,
  type DiagnosticHighlight,
  type DiagnosticHighlightIndex,
} from './diagnosticHighlights.js';
import type { WsState } from '../ws/wsStore.js';

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
 * Project the per-session WS event log into the camelCased annotation
 * list. Walks `state.sessionState[sessionId]?.events` once and picks
 * every `annotation-created` envelope.
 *
 * Thin moderator-internal wrapper around the shell-lifted
 * `projectAnnotations` that adds the null-safe session lookup off
 * `WsState`. The projector itself lives in `@a-conversa/shell` after
 * the `shell_package.extract_cytoscape_projectors` lift; this wrapper
 * stays here because its `WsState` coupling is moderator-internal (per
 * refinement Decision §4).
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
      // Per ADR 0030 §2 + §9: commit payloads are a `target`-
      // discriminated union. The `pending` map tracks axiom-mark
      // proposals (a structural sub-kind per ADR 0030 §9); their
      // commits ride the proposal-keyed arm. The facet-keyed arm
      // targets facet-valued sub-kinds (classify-node /
      // set-node-substance / set-edge-substance / edit-wording) and
      // does not terminate axiom-mark proposals.
      if (event.payload.target !== 'proposal') continue;
      pending.delete(event.payload.proposal_id);
      continue;
    }
    if (event.kind === 'meta-disagreement-marked') {
      // Per ADR 0030 §2 + §9: meta-disagreement-marked payloads are a
      // `target`-discriminated union. The `pending` map tracks axiom-mark
      // proposals (a structural sub-kind per ADR 0030 §9); their marks
      // ride the proposal-keyed arm. The facet-keyed arm targets
      // facet-valued sub-kinds (classify-node / set-node-substance /
      // set-edge-substance / edit-wording) and does not terminate
      // axiom-mark proposals.
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
    // Per `pf_mod_facet_name_widen_shape`: the moderator's local
    // `FacetName` mirror is now 4-valued (matching the wire-level enum),
    // so `<StatementEdge>` reads the shape-facet status directly off the
    // canonical `facetStatuses.shape` slot. The narrow
    // `deriveEdgeShapeStatus` helper that previously populated a
    // `shapeStatus` carriage field is retired; the gate for
    // `<EdgeShapeCommitAffordance>` reads `facetStatuses.shape === 'agreed'`
    // off the same record that drives the substance affordance gate.
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
    // Directional arrow marker. Edges in the methodology are inherently
    // directional ("statement A `supports` statement B" reads source →
    // target); the moderator canvas must surface that direction visually
    // so the role label is not parsed as a symmetric label. ReactFlow
    // only auto-generates `<marker>` defs for the values it finds on
    // `edge.markerEnd`, so the field is attached here on the projection
    // (the consuming `<StatementEdge>` threads it into `<BaseEdge>`).
    //
    // Arrow color matches the per-state stroke override in
    // `<StatementEdge>` so the arrowhead reads as the same signal as the
    // stroke (`#e11d48` for disputed, `#7c3aed` for meta-disagreement);
    // every other substance state uses the default arrow color so the
    // baseline / proposed / agreed / committed / withdrawn arrows match
    // the BaseEdge default stroke. Parallels the participant Cytoscape
    // surface, which already wires per-state `target-arrow-color` next to
    // `line-color` (apps/participant/src/graph/GraphView.tsx).
    const markerEnd: EdgeMarker =
      facetStatuses.substance === 'disputed'
        ? { type: MarkerType.ArrowClosed, color: '#e11d48' }
        : facetStatuses.substance === 'meta-disagreement'
          ? { type: MarkerType.ArrowClosed, color: '#7c3aed' }
          : { type: MarkerType.ArrowClosed };
    out.push({
      id: event.payload.edge_id,
      source: event.payload.source_node_id,
      target: event.payload.target_node_id,
      type: 'statement',
      markerEnd,
      data,
    });
  }
  return out;
}

// -- Per-node per-facet votes shared-empty constant -----------------
//
// `projectVotesByFacet` + `projectOtherVotesByFacet` were lifted into
// `@a-conversa/shell/votes-by-facet/` per
// `tasks/refinements/shell-package/extract_votes_by_facet_projector_v2.md`.
// Callers import them directly from `@a-conversa/shell`. The per-node
// empty record below is the moderator-graph-local default for
// `StatementNodeData.votesByFacet` (the per-node `Partial<Record<FacetName,
// readonly Vote[]>>` shape, not the outer `VotesByFacetIndex` shape).

/**
 * Module-scope shared empty vote-by-facet record. Hands a stable
 * reference to consumers (the node projection's `data.votesByFacet`
 * default) so React / ReactFlow memoization doesn't see a fresh object
 * on every projection pass. Same rationale as `EMPTY_ANNOTATIONS` and
 * `EMPTY_FACET_STATUSES`.
 */
export const EMPTY_VOTES_BY_FACET: Readonly<Partial<Record<FacetName, readonly Vote[]>>> =
  Object.freeze({});

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
