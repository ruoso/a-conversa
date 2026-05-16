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
 * The Tailwind color triple for a single per-participant axiom-mark
 * badge. Each entry is a complete Tailwind class string so the JIT
 * scanner picks them up at build time (Tailwind's content-aware
 * extraction can't see strings interpolated at runtime — every class
 * has to appear literally somewhere in the source).
 *
 * The shape is the public contract: `bg` paints the badge background,
 * `text` paints the centered "A" glyph, `ring` lays a 1-px halo so two
 * adjacent same-colored badges remain separable in the rare per-
 * participant collision (six buckets means a session with seven+
 * participants would alias — the halo keeps the visual stable).
 */
export interface AxiomMarkColor {
  readonly bg: string;
  readonly text: string;
  readonly ring: string;
}

/**
 * The six-color palette for per-participant axiom-marks. Chosen to (a)
 * be pairwise distinguishable, (b) not collide with the methodology-
 * state palette (slate / rose / violet) or the annotation badge (the
 * shape difference — rounded-square here vs. rounded-pill there — is
 * the primary seam, so amber 100/900 is acceptable to share with the
 * annotation badge as long as the shape stays distinct). See the
 * refinement's "Decisions" for the palette rationale.
 *
 * Indexed by hash bucket; `axiomMarkColorFor` selects by `hash(uuid) % 6`.
 * Frozen at module scope so the references stay stable across calls.
 */
const AXIOM_MARK_PALETTE: readonly AxiomMarkColor[] = Object.freeze([
  Object.freeze({ bg: 'bg-sky-100', text: 'text-sky-900', ring: 'ring-sky-300' }),
  Object.freeze({ bg: 'bg-amber-100', text: 'text-amber-900', ring: 'ring-amber-300' }),
  Object.freeze({ bg: 'bg-emerald-100', text: 'text-emerald-900', ring: 'ring-emerald-300' }),
  Object.freeze({ bg: 'bg-fuchsia-100', text: 'text-fuchsia-900', ring: 'ring-fuchsia-300' }),
  Object.freeze({ bg: 'bg-cyan-100', text: 'text-cyan-900', ring: 'ring-cyan-300' }),
  Object.freeze({ bg: 'bg-lime-100', text: 'text-lime-900', ring: 'ring-lime-300' }),
]);

/**
 * Number of color buckets in the per-participant palette. Exported via
 * `AXIOM_MARK_PALETTE.length` so the test suite can assert against the
 * canonical count without re-declaring it.
 */
export const AXIOM_MARK_PALETTE_SIZE = AXIOM_MARK_PALETTE.length;

/**
 * Deterministic per-participant color assignment.
 *
 * Hashes the UUID by summing its hex-digit values (after stripping the
 * dashes / non-hex characters) and picks a palette bucket via
 * `hash % AXIOM_MARK_PALETTE.length`. Same `participantId` always yields
 * the same color across renders / refreshes / browsers / surfaces — the
 * color is a stable property of the participant identity, not of the
 * session join order. Different participants typically get different
 * colors; the 6-bucket palette means a 7+-participant session aliases
 * (the ring halo keeps adjacent same-colored badges separable in that
 * rare case).
 *
 * The hash is stateless and decoupled from any cross-surface coordination
 * — the participant tablet, audience surface, and server-side diagnostic
 * snapshot all arrive at the same color for the same participant without
 * sharing a session-scoped palette assignment. See the refinement's
 * "Decisions" for why hash-based is preferred over a per-session palette.
 */
export function axiomMarkColorFor(participantId: string): AxiomMarkColor {
  let hash = 0;
  for (let i = 0; i < participantId.length; i++) {
    const ch = participantId.charCodeAt(i);
    // Sum hex-digit values only (0-9, a-f, A-F). Skip the dashes that
    // separate UUID groups. Non-hex characters in a well-formed UUID are
    // dashes; skipping them keeps the hash deterministic for any UUID
    // formatting variant (with / without dashes, upper / lower case).
    let digit: number;
    if (ch >= 48 && ch <= 57)
      digit = ch - 48; // '0'-'9' → 0-9
    else if (ch >= 97 && ch <= 102)
      digit = 10 + (ch - 97); // 'a'-'f' → 10-15
    else if (ch >= 65 && ch <= 70)
      digit = 10 + (ch - 65); // 'A'-'F' → 10-15
    else continue;
    hash = (hash + digit) >>> 0; // unsigned 32-bit; sum can't overflow for a 36-char UUID
  }
  // `palette[i] ?? palette[0]` keeps the return non-undefined for
  // TypeScript's strict-null mode; the index is always in range.
  const bucket = hash % AXIOM_MARK_PALETTE.length;
  return AXIOM_MARK_PALETTE[bucket] ?? AXIOM_MARK_PALETTE[0]!;
}

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

/**
 * One participant's vote on a facet's pending proposal, projected for
 * rendering. Mirrors the `vote` event payload, narrowed to the two
 * fields the indicator surface consumes.
 *
 * `choice` uses `'choice'` (not `'vote'`) as the field name so the seam
 * attribute `data-choice` on the indicator span reads naturally; the
 * wire payload's `vote` field name is preserved in the read of
 * `event.payload.vote` and renamed at the projection boundary.
 */
export interface Vote {
  readonly participantId: string;
  readonly choice: 'agree' | 'dispute' | 'withdraw';
}

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
 * Module-scope shared empty per-facet votes array. Used as the
 * default fallback for facets with no votes; keeps the reference
 * stable across renders.
 */
export const EMPTY_VOTES: readonly Vote[] = Object.freeze([]);

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
      const target = proposalTarget.get(event.payload.proposal_id);
      if (target === undefined) continue;
      const { entityId, facet } = target;

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
      const choice = event.payload.vote;
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
