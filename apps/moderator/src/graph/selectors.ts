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
import type { AnnotationKind, EdgeRole, Event } from '@a-conversa/shared-types';

import {
  computeFacetStatuses,
  EMPTY_FACET_STATUSES,
  type FacetName,
  type FacetStatus,
} from './facetStatus.js';
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
): Edge<StatementEdgeData>[] {
  const session = state.sessionState[sessionId];
  if (!session) return [];
  const annotationsByEdge = groupAnnotationsByEdge(projectAnnotations(session.events));
  // Per-edge per-facet `FacetStatus` index — computed once over the same
  // events array so the projection stays a single pass-effort over the
  // log. Refinement: `mod_proposed_state_styling`.
  const facetStatusIndex = computeFacetStatuses(session.events);
  const out: Edge<StatementEdgeData>[] = [];
  for (const event of session.events) {
    if (event.kind !== 'edge-created') continue;
    const annotations = annotationsByEdge.get(event.payload.edge_id) ?? EMPTY_ANNOTATIONS;
    const facetStatuses = facetStatusIndex.edges.get(event.payload.edge_id) ?? EMPTY_FACET_STATUSES;
    out.push({
      id: event.payload.edge_id,
      source: event.payload.source_node_id,
      target: event.payload.target_node_id,
      type: 'statement',
      data: { role: event.payload.role, annotations, facetStatuses },
    });
  }
  return out;
}
