// Per-entity own-vote derivation for the participant's read-mostly
// `<GraphView>`.
//
// Refinement: tasks/refinements/participant-ui/part_own_vote_indicators.md
//              (Decision §1 — closed-sentinel `OwnVote = 'agree' |
//              'dispute' | 'none'`; `'withdraw'` collapses to `'none'`;
//              per-entity rollup with dispute-wins tie-break; symmetric
//              across node AND edge targets. Decision §2 — narrowed
//              participant-side adaptation of the moderator's
//              `projectVotesByFacet`; no shell extraction yet — three
//              callers will trigger the lift, but today the participant
//              has two: this module + `facetStatus.ts`'s proposal-walk.
//              Decision §8 — export the thin presence helpers
//              (`ownVoteForNode`, `ownVoteForEdge`) for future consumers
//              even though `projectGraph` inlines `index.get(id) ?? 'none'`
//              directly today.)
//
// **Parallel client mirror**: this module is a participant-narrowed
// adaptation of the moderator's
// `apps/moderator/src/graph/selectors.ts:687-846` (`projectVotesByFacet`).
// The single-pass walk + the latest-vote-per-(proposal, participant)
// rule + the proposal-target dance mirror the moderator's algorithm
// line-for-line; the divergence is at the OUTPUT shape — the moderator
// emits the full `Map<entityId, Map<FacetName, Vote[]>>` for per-
// participant dot rendering; this module collapses to per-entity
// `OwnVote` for the at-a-glance label outline on the current
// participant's tablet. The future sibling `part_other_vote_indicators`
// will adopt the moderator's full projection shape verbatim for the
// per-other-participant dot row.
//
// **Drift risk** (inherited from the moderator's port). Any change to
// the proposal-target mapping (i.e. a new facet-targeting proposal
// sub-kind, a rename, or a structural change to the existing five —
// `classify-node`, `set-node-substance`, `edit-wording`, `amend-node`,
// `set-edge-substance`) MUST be mirrored here AND in
// `apps/participant/src/graph/facetStatus.ts:132-164` AND in the
// moderator's `apps/moderator/src/graph/selectors.ts:736-754`. Three
// locations are intentionally co-shaped today; the natural unification
// point is `@a-conversa/shell` (extracted when the audience surface
// becomes the third caller, per the same trigger-on-the-third-caller
// policy the predecessor leaves adopted).

import type { Event, ProposalPayload } from '@a-conversa/shared-types';

import type { FacetName } from './facetStatus';

/**
 * One participant's at-a-glance vote disposition on an entity. The
 * narrowed indicator sentinel: `'agree'` or `'dispute'` when the current
 * participant has cast a recordable vote on at least one facet-targeting
 * proposal whose target is this entity; `'none'` when no such vote
 * exists OR when the latest such vote is `'withdraw'` (per Decision §1 —
 * the at-a-glance pre-commit surface treats withdrawal as the explicit
 * retraction back to the un-voted baseline; the explicit "I withdrew"
 * detail belongs in the future `part_withdraw_indicator` polish leaf).
 *
 * Closed enum — no other value is valid. The mirror attribute is one
 * of `"agree"` / `"dispute"` / `"none"` (Decision §5).
 */
export type OwnVote = 'agree' | 'dispute' | 'none';

/**
 * Per-entity-kind index of the current participant's own vote on each
 * voteable target. Consumers (`projectGraph`) look up by entity id;
 * absent ids mean "no recordable own-vote on this entity" and the
 * caller defaults to `'none'`.
 *
 * Symmetric across node + edge targets per Decision §1 — the wire
 * `proposal` family targets both node entities
 * (`classify-node`, `set-node-substance`, `edit-wording`, `amend-node`)
 * and edge entities (`set-edge-substance`). The outer-map keys are
 * disjoint by construction because node UUIDs and edge UUIDs don't
 * collide; the two-bucket shape mirrors the moderator's
 * `Map<entityId, ...>` keyspace while keeping the per-target-kind
 * lookup type-safe.
 */
export interface OwnVoteIndex {
  readonly nodes: ReadonlyMap<string, OwnVote>;
  readonly edges: ReadonlyMap<string, OwnVote>;
}

/**
 * Stable empty-index reference. Hands consumers a deterministic empty
 * value when the session has no current-participant votes on any
 * tracked proposal — keeps the React / Cytoscape memoization stable for
 * the no-vote baseline. Same `EMPTY_*` pattern as
 * `EMPTY_DIAGNOSTIC_HIGHLIGHTS`, `EMPTY_FACET_STATUSES`, etc.
 */
export const EMPTY_OWN_VOTES: OwnVoteIndex = Object.freeze({
  nodes: new Map<string, OwnVote>(),
  edges: new Map<string, OwnVote>(),
});

/**
 * Resolve the `(entityKind, entityId, facet)` triple of a facet-
 * targeting proposal. Mirrors the moderator's `voteTargetOf`
 * (`apps/moderator/src/graph/selectors.ts:736-754`) AND the
 * participant's `facetStatus.ts:132-164` `targetOf` walk verbatim — the
 * three locations stay co-shaped so a future schema change touches all
 * three together (see the module-header drift-risk note).
 *
 * Structural sub-kinds (`decompose`, `interpretive-split`, `axiom-mark`,
 * `meta-move`, `break-edge`, `annotate`) return `null` so the caller
 * drops the proposal from the projection — they don't target a
 * `(entity, facet)` pair and votes against them are not the at-a-glance
 * "I agree with this facet" surface this leaf paints.
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
 * Roll up two `OwnVote` values for the same entity per Decision §1's
 * dispute-wins tie-break: if either is `'dispute'` the entity is
 * `'dispute'`; else if either is `'agree'` the entity is `'agree'`;
 * else `'none'`.
 *
 * Rationale (Decision §1): dispute-wins reflects the methodology's
 * "ratchet to the conservative state" posture — if the current
 * participant is actively contesting any one facet of the entity, the
 * at-a-glance signal is "I disagree with this entity right now" rather
 * than "I half-agree". The per-facet detail is the future entity-
 * detail-panel's job.
 */
function rollUp(prior: OwnVote | undefined, incoming: OwnVote): OwnVote {
  if (prior === 'dispute' || incoming === 'dispute') return 'dispute';
  if (prior === 'agree' || incoming === 'agree') return 'agree';
  return 'none';
}

/**
 * Pure projection from a session's event log to the per-entity own-vote
 * index for the supplied current participant. Single-pass over `events`.
 *
 * Walk:
 *
 * - `proposal` events targeting a `(entityKind, entityId, facet)` triple
 *   are recorded in a proposal-id → target map.
 * - `vote` events by the current participant referencing a known
 *   proposal are accumulated per-(entity, facet) with latest-vote-wins
 *   semantics (last write per `(proposal, participant)` overrides; mirror
 *   of the moderator's `latest-vote-per-(proposal, participant)` rule).
 *   The `'withdraw'` arm collapses to `'none'` at the indicator layer
 *   per Decision §1.
 * - Votes by OTHER participants are silently dropped (the filter is the
 *   core "narrowed to single-participant" semantic this leaf adopts).
 * - Votes referencing an unknown proposal id are silently dropped.
 * - Other event kinds (`commit`, `meta-disagreement-marked`,
 *   `node-created`, `edge-created`, `annotation-created`, etc.) do not
 *   contribute. A `commit` closes the proposal on the methodology side
 *   but the per-participant vote record remains surfaced — the at-a-
 *   glance "I voted agree on this" indicator stays valid post-commit
 *   until the next vote (server-side rules prevent further arm-switching
 *   votes after commit, so the last-write-wins semantics are stable).
 *
 * Per-entity rollup: a participant who voted on multiple facets of the
 * same entity collapses to a single `OwnVote` per Decision §1's dispute-
 * wins rule — see `rollUp` above.
 *
 * Returns the stable `EMPTY_OWN_VOTES` reference when no current-
 * participant vote contributes — keeps the memo's reference-equality
 * bailout stable for the no-vote baseline (every participant joining a
 * fresh session passes through this branch once).
 */
export function projectOwnVotes(
  events: readonly Event[],
  currentParticipantId: string,
): OwnVoteIndex {
  // proposal envelope id → (entityKind, entityId, facet) target.
  const proposalTarget = new Map<
    string,
    { entityKind: 'node' | 'edge'; entityId: string; facet: FacetName }
  >();
  // Per-(entity, facet) latest own-vote arm. Keyed by `entityId|facet`
  // composite (entities never carry the pipe character — UUIDs are
  // hex-with-dashes, facet names are kebab-case ASCII), so the
  // composite is unambiguous. Used to apply latest-vote-wins per
  // `(proposal, participant)` BEFORE the per-entity rollup runs.
  const perFacetVote = new Map<string, OwnVote>();
  // Per-entity-kind rolled-up own-vote, built incrementally as each
  // vote arrives so the final shape is ready to return without a
  // second pass. Re-derived per-entity at vote-time via `rollUp` so
  // dispute-wins is enforced even if a facet's vote shifts from
  // dispute back to agree (the per-facet map remembers the latest;
  // the rollup re-derives from all facets touching the same entity).
  const nodes = new Map<string, OwnVote>();
  const edges = new Map<string, OwnVote>();
  // Reverse index for the per-entity rollup re-derivation: each
  // entity → the set of `entityId|facet` composite keys touching it.
  // Lets the re-derivation visit only the relevant per-facet entries
  // (small constant in practice; the methodology bounds the per-
  // entity facet count to three for nodes and one for edges).
  const facetsByEntity = new Map<string, Set<string>>();

  for (const event of events) {
    if (event.kind === 'proposal') {
      const target = voteTargetOf(event.payload.proposal);
      if (target === null) continue;
      proposalTarget.set(event.id, target);
      continue;
    }
    if (event.kind === 'vote') {
      // TODO(pf_vote_handler_facet_keyed): vote payloads are now a
      // `target`-discriminated union. The methodology engine emits
      // the proposal-keyed arm for now; the facet-keyed arm is
      // reserved for the downstream rewrite. Read only the proposal-
      // keyed arm until that lands.
      if (event.payload.target !== 'proposal') continue;
      if (event.payload.participant !== currentParticipantId) continue;
      const target = proposalTarget.get(event.payload.proposal_id);
      if (target === undefined) continue;
      // Map the wire arm to the indicator sentinel. The `'withdraw'`
      // choice is gone from the vote-payload `choice` enum (it lives
      // on its own `withdraw-agreement` event kind now); `'agree'` and
      // `'dispute'` are the only remaining values.
      const arm: OwnVote = event.payload.choice === 'agree' ? 'agree' : 'dispute';
      const facetKey = `${target.entityId}|${target.facet}`;
      perFacetVote.set(facetKey, arm);
      let facetKeys = facetsByEntity.get(target.entityId);
      if (facetKeys === undefined) {
        facetKeys = new Set<string>();
        facetsByEntity.set(target.entityId, facetKeys);
      }
      facetKeys.add(facetKey);
      // Re-derive the per-entity rollup from every facet touching
      // this entity. Dispute wins; then agree; else none. The set is
      // bounded (≤3 facets per node, 1 per edge today) so the cost is
      // O(1) per vote.
      let rolled: OwnVote = 'none';
      for (const key of facetKeys) {
        const v = perFacetVote.get(key);
        if (v === undefined) continue;
        rolled = rollUp(rolled, v);
      }
      const bucket = target.entityKind === 'node' ? nodes : edges;
      if (rolled === 'none') {
        bucket.delete(target.entityId);
      } else {
        bucket.set(target.entityId, rolled);
      }
      continue;
    }
    // Other event kinds (commit, meta-disagreement-marked,
    // node-created, edge-created, annotation-created, etc.) don't
    // contribute votes by the current participant. See the function
    // docstring for the post-commit rationale.
  }

  if (nodes.size === 0 && edges.size === 0) {
    return EMPTY_OWN_VOTES;
  }
  return { nodes, edges };
}

/**
 * Resolve the current participant's own-vote on a node from the index,
 * defaulting to `'none'` when the node has no recordable own-vote.
 *
 * Per Decision §8 — the at-a-glance projector inlines
 * `index.nodes.get(id) ?? 'none'` directly so this helper isn't load-
 * bearing for THIS leaf. Exposing it now keeps future consumers
 * (`part_entity_detail_panel`'s per-facet breakdown precondition,
 * `part_vote_single_tap`'s "did I already vote here?" check) from
 * refactoring the seam.
 */
export function ownVoteForNode(index: OwnVoteIndex, nodeId: string): OwnVote {
  return index.nodes.get(nodeId) ?? 'none';
}

/**
 * Resolve the current participant's own-vote on an edge from the index,
 * defaulting to `'none'` when the edge has no recordable own-vote.
 * Symmetric with `ownVoteForNode` per Decision §1's node + edge
 * structural symmetry.
 */
export function ownVoteForEdge(index: OwnVoteIndex, edgeId: string): OwnVote {
  return index.edges.get(edgeId) ?? 'none';
}
