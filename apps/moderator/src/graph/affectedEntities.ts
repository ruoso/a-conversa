// Pure per-`EventKind` map from one event to the graph entities it
// touches — the data behind the change-history pane's click-to-flash
// affordance.
//
// Refinement: tasks/refinements/moderator-ui/mod_history_click_to_flash.md
//
// `affectedEntities(event)` maps a single event to the ReactFlow
// node-ids and edge-ids that event affected, so activating its
// change-history row can (a) re-frame the canvas on those entities
// (`requestCanvasFocus`) and (b) flash them (`useFlashStore.flash`).
//
// **Pure** (Constraints §1): a function of the event payload alone —
// no clock, no RNG, no react-i18next, no store access. Same input →
// same output. Mirrors the established `eventSummary.ts` /
// `proposalSummary.ts` convention that `graph/*` helpers are
// clock/RNG/UI-free and unit-testable without a render harness.
//
// **Total over `EventKind`** (Constraints §2): all kinds handled
// explicitly; the `default` arm narrows to `never` and returns the
// empty result so a future/unknown kind flashes nothing rather than
// throwing (mirrors `eventSummary.ts`'s exhaustive fallback).
//
// **Single-event payload only — no cross-event resolution** (Constraints
// §3, Decision §D3). The helper reads ids out of the event's OWN payload.
// It does NOT walk the log to resolve a `proposal_id` back to the entity
// a proposal targets; the proposal arm extracts the entity ids carried in
// the proposal payload itself. The proposal-arm `vote` / `commit` /
// `meta-disagreement-marked` (which carry only a `proposal_id`) therefore
// flash nothing.
//
// **Over-extraction is safe** (Constraints §5, Decision §D3). Both
// consumers filter to ids ReactFlow currently knows (`useCanvasFocusEffect`
// drops ids `getNode(id) === undefined`; the flash effect does the same),
// so an id that names a not-yet-created or non-promoted entity is a
// harmless no-op. The helper extracts liberally; it must not crash on any
// well-formed event.

import type { Event, ProposalPayload } from '@a-conversa/shared-types';

/**
 * The graph entities one event touched, split into the two flat string-id
 * lists `requestCanvasFocus` / `useFlashStore.flash` consume. Node-ish ids
 * (node ids AND annotation ids — a promoted annotation is a ReactFlow node)
 * go in `nodeIds`; edge ids go in `edgeIds` (Constraints §4).
 */
export interface AffectedEntities {
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
}

const EMPTY: AffectedEntities = { nodeIds: [], edgeIds: [] };

/**
 * Classify a single entity id by its `entity_kind`. `node` and
 * `annotation` are both ReactFlow node ids (a promoted annotation renders
 * as a node), so they land in `nodeIds`; `edge` lands in `edgeIds`
 * (Constraints §4/§5).
 */
function classifyEntity(
  entityKind: 'node' | 'edge' | 'annotation',
  entityId: string,
): AffectedEntities {
  return entityKind === 'edge'
    ? { nodeIds: [], edgeIds: [entityId] }
    : { nodeIds: [entityId], edgeIds: [] };
}

/**
 * Drop `undefined` endpoint ids from a node-ish list — XOR endpoint
 * pairs (`source_node_id` / `source_annotation_id`, …) leave one slot
 * unset per side.
 */
function present(ids: readonly (string | undefined)[]): readonly string[] {
  return ids.filter((id): id is string => id !== undefined);
}

/**
 * Extract the in-payload target ids a single proposal carries (Constraints
 * §3 — the proposal arm reads the proposal payload itself, never the log).
 * Liberal by design: client-minted ids that won't exist until the proposal
 * commits (`edit-wording.restructure`'s `new_node_id`, `decompose` /
 * `interpretive-split` component ids) are extracted anyway — they are a
 * free no-op until they materialise (Decision §D3).
 */
function affectedByProposal(proposal: ProposalPayload): AffectedEntities {
  switch (proposal.kind) {
    case 'classify-node':
    case 'capture-node':
    case 'set-node-substance':
    case 'axiom-mark':
    case 'amend-node':
      return { nodeIds: [proposal.node_id], edgeIds: [] };
    case 'edit-wording':
      return proposal.edit_kind === 'restructure'
        ? { nodeIds: [proposal.node_id, proposal.new_node_id], edgeIds: [] }
        : { nodeIds: [proposal.node_id], edgeIds: [] };
    case 'break-edge':
      return { nodeIds: [], edgeIds: [proposal.edge_id] };
    case 'set-edge-substance':
      return {
        nodeIds: present([
          proposal.source_node_id,
          proposal.source_annotation_id,
          proposal.target_node_id,
          proposal.target_annotation_id,
        ]),
        edgeIds: [proposal.edge_id],
      };
    case 'decompose':
      return {
        nodeIds: [proposal.parent_node_id, ...proposal.components.map((c) => c.node_id)],
        edgeIds: [],
      };
    case 'interpretive-split':
      return {
        nodeIds: [proposal.parent_node_id, ...proposal.readings.map((r) => r.node_id)],
        edgeIds: [],
      };
    case 'meta-move':
    case 'annotate':
      // `target_kind` discriminates node-ish (`node` / `annotation`) from
      // edge. `annotate` admits an `annotation` target; `meta-move` only
      // `node` / `edge` — both classify the same way via `classifyEntity`.
      return classifyEntity(proposal.target_kind, proposal.target_id);
    default: {
      const _exhaustive: never = proposal;
      void _exhaustive;
      return EMPTY;
    }
  }
}

/**
 * Map one event to the graph entities it affected.
 *
 * Pure: same input → same output. No clock / RNG / i18n / store access.
 * See the module header for the per-kind extraction rationale.
 */
export function affectedEntities(event: Event): AffectedEntities {
  switch (event.kind) {
    case 'node-created':
      return { nodeIds: [event.payload.node_id], edgeIds: [] };
    case 'edge-created':
      return {
        nodeIds: present([
          event.payload.source_node_id,
          event.payload.source_annotation_id,
          event.payload.target_node_id,
          event.payload.target_annotation_id,
        ]),
        edgeIds: [event.payload.edge_id],
      };
    case 'annotation-created': {
      // The annotation id is node-ish (a promoted annotation is a ReactFlow
      // node). The host target is an XOR-nullable node/edge pair.
      const nodeIds = [event.payload.annotation_id];
      const edgeIds: string[] = [];
      if (event.payload.target_node_id !== null) nodeIds.push(event.payload.target_node_id);
      if (event.payload.target_edge_id !== null) edgeIds.push(event.payload.target_edge_id);
      return { nodeIds, edgeIds };
    }
    case 'entity-included':
    case 'entity-removed':
      return classifyEntity(event.payload.entity_kind, event.payload.entity_id);
    case 'withdraw-agreement':
      return classifyEntity(event.payload.entity_kind, event.payload.entity_id);
    // `vote` / `commit` / `meta-disagreement-marked` are `target`-
    // discriminated: the facet arm carries an `(entity_kind, entity_id)`
    // graph target; the proposal arm carries only a `proposal_id` (no graph
    // entity, no cross-event resolution in v1 per Decision §D3) → empty.
    case 'vote':
      return event.payload.target === 'facet'
        ? classifyEntity(event.payload.entity_kind, event.payload.entity_id)
        : EMPTY;
    case 'commit':
      return event.payload.target === 'facet'
        ? classifyEntity(event.payload.entity_kind, event.payload.entity_id)
        : EMPTY;
    case 'meta-disagreement-marked':
      return event.payload.target === 'facet'
        ? classifyEntity(event.payload.entity_kind, event.payload.entity_id)
        : EMPTY;
    case 'proposal':
      return affectedByProposal(event.payload.proposal);

    // -- No graph-entity id: flash nothing (Constraints §10, Acceptance §8).
    case 'session-created':
    case 'session-ended':
    case 'participant-joined':
    case 'participant-left':
    case 'session-mode-changed':
    case 'snapshot-created':
    case 'proposal-withdrawn':
      return EMPTY;

    default: {
      // Exhaustively narrowed over `EventKind`; a runtime safety net for a
      // future/unknown kind (and callers that bypass TypeScript) returning
      // the empty result rather than throwing (mirrors `eventSummary.ts`).
      const _exhaustive: never = event;
      void _exhaustive;
      return EMPTY;
    }
  }
}
