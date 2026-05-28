// Per-entity OTHER-participants vote derivation for the participant's
// read-mostly `<GraphView>`.
//
// Refinement: tasks/refinements/participant-ui/part_other_vote_indicators.md
//              (Decision §1 — two-arm closed `OtherVote = { participantId,
//              choice: 'agree' | 'dispute' }`; per-entity rollup with
//              dispute-wins tie-break; symmetric across node AND edge
//              targets. Per ADR 0030 §3 + `pf_unit_test_audit`: the
//              legacy `'withdraw'` vote-choice arm is retired — the
//              projector consumes only `vote` events; `withdraw-
//              agreement` events are silently dropped (the audit
//              catalog labelled this expected pre-`part_withdraw_indicator`). Decision §2 — narrowed participant-side
//              projection rather than a port of the moderator's full
//              `projectVotesByFacet`; lives in the participant workspace
//              today, lifts to `@a-conversa/shell` when the audience
//              surface becomes the third Cytoscape consumer. Decision §4 —
//              per-entity LIST shape rather than a rolled-up sentinel;
//              the per-voter UUID + arm are load-bearing for both the
//              mirror surface and the future entity-detail-panel.
//              Decision §5 — first-vote-arrival sort order; arm-switching
//              by the same voter overwrites in-place at the original
//              position; mirrors the moderator's `positionIndex` posture
//              verbatim. Decision §8 — the projection consumes
//              `currentParticipantId` as the inverse filter of the
//              own-vote projection.)
//
// **Parallel client mirror**: this module is a participant-narrowed
// adaptation of the moderator's
// `apps/moderator/src/graph/selectors.ts:687-846` (`projectVotesByFacet`).
// The single-pass walk + the latest-vote-per-(proposal, participant)
// rule + the proposal-target dance mirror the moderator's algorithm
// line-for-line; the divergences are:
//
//   - The filter inverts: votes by `currentParticipantId` are silently
//     dropped (this projection paints the OTHER participants; the
//     sibling `ownVotes.ts` paints the current participant).
//   - The output collapses from `Map<entityId, Map<FacetName, Vote[]>>`
//     to `{ nodes: Map<entityId, OtherVote[]>, edges: Map<entityId,
//     OtherVote[]> }`. Per-entity per-voter list with per-(entity,
//     voter) dispute-wins rollup (Decision §1). The per-facet
//     granularity stays inside the projector's accumulator; only the
//     per-entity per-voter projection escapes.
//   - Per ADR 0030 §3 + `pf_unit_test_audit`: the wire `choice` enum
//     is `'agree' | 'dispute'`; withdrawal is its own first-class event
//     kind (`withdraw-agreement`) that this projector silently drops
//     (handled separately when a downstream task lands the indicator).
//
// **Parallel participant-side mirror**: this module also runs alongside
// `apps/participant/src/graph/ownVotes.ts` — the two projections share
// the proposal-target walk shape line-for-line; only the filter
// direction + output shape differ. A future extraction trigger (the
// third Cytoscape consumer on the audience surface) lifts the shared
// walk into `@a-conversa/shell` for all three callers (moderator full,
// participant own, participant other).
//
// **Drift risk** (inherited from the moderator's port). Any change to
// the proposal-target mapping (i.e. a new facet-targeting proposal
// sub-kind, a rename, or a structural change to the existing five —
// `classify-node`, `set-node-substance`, `edit-wording`, `amend-node`,
// `set-edge-substance`) MUST be mirrored here AND in
// `apps/participant/src/graph/ownVotes.ts:108-126` AND in
// `apps/participant/src/graph/facetStatus.ts:132-164` AND in the
// moderator's `apps/moderator/src/graph/selectors.ts:736-754`. Four
// locations are intentionally co-shaped today; the natural unification
// point is `@a-conversa/shell` (extracted when the audience surface
// becomes the third Cytoscape consumer, per the same trigger-on-the-
// third-caller policy the predecessor leaves adopted).

import type { Event, ProposalPayload } from '@a-conversa/shared-types';

import type { FacetName } from '@a-conversa/shell';

/**
 * One OTHER participant's at-a-glance vote disposition on an entity. The
 * two-arm closed `choice` covers the at-a-glance "did this voter agree
 * or dispute?" question. Withdrawal is encoded as ABSENCE FROM THE LIST
 * (per Decision §1 — the per-entity list IS the at-a-glance "who's
 * still actively voting agree or dispute on this entity?" record;
 * a withdrawal collapses to the un-voted state at that layer).
 *
 * Mirrors the moderator's `Vote` shape narrowed by one arm. The future
 * entity-detail-panel may rehydrate the explicit "this participant
 * withdrew" signal from the per-facet votes; that surface is out of
 * scope for the at-a-glance layer.
 */
export interface OtherVote {
  readonly participantId: string;
  readonly choice: 'agree' | 'dispute';
}

/**
 * Per-entity-kind index of OTHER participants' votes on each voteable
 * target. Consumers (`projectGraph`) look up by entity id; absent ids
 * mean "no recordable other-participant vote on this entity" and the
 * caller substitutes the shared `EMPTY_OTHER_VOTES_LIST` reference.
 *
 * Symmetric across node + edge targets per Decision §1 — the wire
 * `proposal` family targets both node entities
 * (`classify-node`, `set-node-substance`, `edit-wording`, `amend-node`)
 * and edge entities (`set-edge-substance`). The outer-map keys are
 * disjoint by construction because node UUIDs and edge UUIDs don't
 * collide; the two-bucket shape mirrors `ownVotes.ts`'s `OwnVoteIndex`
 * keyspace.
 */
export interface OthersVoteIndex {
  readonly nodes: ReadonlyMap<string, readonly OtherVote[]>;
  readonly edges: ReadonlyMap<string, readonly OtherVote[]>;
}

/**
 * Stable empty-list reference for the per-entity default. Hands the
 * projector a deterministic per-entity baseline so React / Cytoscape
 * memoization stays stable across re-projection passes for entities
 * with no recordable other-votes. Same `EMPTY_*` shared-reference
 * discipline as `EMPTY_VOTES` in the moderator's `selectors.ts`.
 */
export const EMPTY_OTHER_VOTES_LIST: readonly OtherVote[] = Object.freeze([]);

/**
 * Stable empty-index reference. Hands consumers a deterministic empty
 * value when the session has no other-participant votes on any
 * tracked proposal — keeps the React / Cytoscape memoization stable
 * for the no-vote baseline. Same `EMPTY_*` pattern as
 * `EMPTY_OWN_VOTES`, `EMPTY_FACET_STATUSES`, etc.
 */
export const EMPTY_OTHERS_VOTES: OthersVoteIndex = Object.freeze({
  nodes: new Map<string, readonly OtherVote[]>(),
  edges: new Map<string, readonly OtherVote[]>(),
});

/**
 * Resolve the `(entityKind, entityId, facet)` triple of a facet-
 * targeting proposal. Mirrors the moderator's `voteTargetOf`
 * (`apps/moderator/src/graph/selectors.ts:736-754`) AND
 * `ownVotes.ts:108-126`'s `voteTargetOf` AND
 * `facetStatus.ts:132-164`'s `targetOf` walk verbatim — the four
 * locations stay co-shaped so a future schema change touches all four
 * together (see the module-header drift-risk note).
 *
 * Structural sub-kinds (`decompose`, `interpretive-split`, `axiom-mark`,
 * `meta-move`, `break-edge`, `annotate`) return `null` so the caller
 * drops the proposal from the projection — they don't target a
 * `(entity, facet)` pair and votes against them are not the at-a-glance
 * "who else agreed?" surface this leaf paints.
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
 * Roll up two `OtherVote['choice']` values for the same `(entity,
 * voter)` per Decision §1's dispute-wins tie-break: if either is
 * `'dispute'` the voter is `'dispute'`; else if either is `'agree'`
 * the voter is `'agree'`.
 *
 * Rationale (Decision §1): same "ratchet to the conservative state"
 * methodology posture as the own-vote leaf. If voter X is actively
 * disputing one facet of the entity, the at-a-glance signal is "X
 * disagrees with this entity right now" rather than "X half-agrees".
 * The per-facet breakdown is the future entity-detail-panel's surface.
 */
function rollUpChoice(
  prior: OtherVote['choice'] | undefined,
  incoming: OtherVote['choice'],
): OtherVote['choice'] {
  if (prior === 'dispute' || incoming === 'dispute') return 'dispute';
  return 'agree';
}

/**
 * Pure projection from a session's event log to the per-entity per-
 * other-voter index. Single-pass over `events`.
 *
 * Walk:
 *
 * - `proposal` events targeting a `(entityKind, entityId, facet)` triple
 *   are recorded in a proposal-id → target map.
 * - `vote` events by ANY participant other than `currentParticipantId`
 *   referencing a known proposal are accumulated per-(entity, facet,
 *   voter) with latest-vote-wins semantics (last write per `(proposal,
 *   participant)` overrides; mirror of the moderator's `latest-vote-
 *   per-(proposal, participant)` rule). Per-(entity, voter) the rollup
 *   applies dispute-wins.
 * - Votes by the CURRENT participant are silently dropped (the filter
 *   is the core "narrowed to OTHER participants" semantic — the
 *   complement of `ownVotes.ts`'s filter direction).
 * - Votes referencing an unknown proposal id are silently dropped.
 * - Per ADR 0030 §3 + `pf_unit_test_audit`: the wire `vote.choice`
 *   collapsed to `'agree' | 'dispute'`; withdrawal is its own first-
 *   class event kind (`withdraw-agreement`). This projector consumes
 *   only `vote` events today — `withdraw-agreement` events are silently
 *   dropped (per the audit catalog, expected pre-`part_withdraw_indicator`).
 *   The gap-close branch below survives for future re-vote semantics
 *   (a voter who has no recorded arm on any facet of the entity is
 *   absent from the list).
 *
 * Per-entity rollup: a voter who voted on multiple facets of the same
 * entity collapses to a SINGLE entry per (entity, voter) per Decision
 * §1's dispute-wins rule. The entry's position in the per-entity list
 * is determined by the voter's FIRST vote on ANY facet of the entity
 * (Decision §5 — first-vote-arrival; subsequent votes by the same
 * voter on the same OR other facets overwrite the rolled-up choice
 * in-place at the original position).
 *
 * Insertion-order semantics on REMOVAL: when a voter's rolled-up
 * choice becomes "absent" (every per-facet arm is `'withdraw'`), the
 * voter's entry is REMOVED from the per-entity list and the gap is
 * closed (subsequent entries shift left by one). A future re-vote by
 * the same voter pushes to the END (per first-vote-arrival).
 *
 * Returns the stable `EMPTY_OTHERS_VOTES` reference when no other-
 * participant vote contributes — keeps the memo's reference-equality
 * bailout stable for the no-vote baseline (every participant joining
 * a fresh session passes through this branch once).
 */
export function projectOtherVotes(
  events: readonly Event[],
  currentParticipantId: string,
): OthersVoteIndex {
  // proposal envelope id → (entityKind, entityId, facet) target.
  const proposalTarget = new Map<
    string,
    { entityKind: 'node' | 'edge'; entityId: string; facet: FacetName }
  >();

  // Per-(entityId, facet, voterId) latest arm — the per-facet
  // accumulator. Keyed by `entityId|facet|voterId` composite
  // (UUIDs are hex-with-dashes; facet names are kebab-case ASCII; the
  // pipe character is unambiguous). Used to apply latest-vote-wins per
  // `(proposal, participant)` BEFORE the per-(entity, voter) rollup
  // runs. Per ADR 0030 §3 + `pf_unit_test_audit`: the wire `vote.choice`
  // collapsed to `'agree' | 'dispute'`; withdrawal is its own first-
  // class event kind (`withdraw-agreement`), surfaced via the facet-
  // status projection — the participant's at-a-glance other-votes
  // projection ignores it (no `withdraw-agreement` handling here —
  // documented under "Drift risk" above; future
  // `part_withdraw_indicator` task closes the hand-off).
  const perFacetVoterArm = new Map<string, 'agree' | 'dispute'>();
  // Reverse index per-entity → set of `entityId|facet|voterId`
  // composites — used to re-derive the per-(entity, voter) rollup on
  // every vote arrival.
  const facetKeysByEntity = new Map<string, Set<string>>();
  // Reverse index per-(entity, voter) → set of facets that this voter
  // has touched on this entity — used to bound the rollup re-derivation
  // to only the facets the specific voter has voted on (each `(entity,
  // voter)` rollup re-derivation visits ≤3 facets for nodes, ≤1 for
  // edges).
  const facetsByEntityVoter = new Map<string, Set<FacetName>>();

  // Per-entity per-voter rolled-up choice + position-in-list. Position
  // tracks first-vote-arrival order per Decision §5; arm-switching by
  // the same voter overwrites in-place at the original position;
  // withdrawal-induced removal closes the gap (subsequent entries
  // shift left). Mirrors the moderator's `positionIndex` posture.
  const nodes = new Map<string, OtherVote[]>();
  const edges = new Map<string, OtherVote[]>();
  // entityId → (voterId → index-in-list). Tracks each voter's index
  // for in-place overwrite + removal-gap-close.
  const nodePositions = new Map<string, Map<string, number>>();
  const edgePositions = new Map<string, Map<string, number>>();

  function rerollEntityVoter(entityKind: 'node' | 'edge', entityId: string, voterId: string): void {
    // Resolve the rolled-up choice for `(entityId, voterId)` by
    // visiting every facet of the entity this voter has touched.
    const voterFacetKey = `${entityId}|${voterId}`;
    const facets = facetsByEntityVoter.get(voterFacetKey);
    let rolled: OtherVote['choice'] | undefined;
    if (facets !== undefined) {
      for (const facet of facets) {
        const arm = perFacetVoterArm.get(`${entityId}|${facet}|${voterId}`);
        if (arm === undefined) continue;
        rolled = rollUpChoice(rolled, arm);
      }
    }

    const list = entityKind === 'node' ? nodes : edges;
    const positions = entityKind === 'node' ? nodePositions : edgePositions;
    let perEntityPositions = positions.get(entityId);
    let perEntityList = list.get(entityId);

    if (rolled === undefined) {
      // Voter has withdrawn from every facet (or never voted) — remove
      // their entry if present. Closing the gap (splice) preserves the
      // insertion-order semantics for the surviving voters per
      // Decision §5.
      if (perEntityPositions === undefined || perEntityList === undefined) {
        return;
      }
      const priorIndex = perEntityPositions.get(voterId);
      if (priorIndex === undefined) {
        return;
      }
      perEntityList.splice(priorIndex, 1);
      perEntityPositions.delete(voterId);
      // Shift every later voter's recorded position down by one.
      for (const [otherVoterId, otherIndex] of perEntityPositions) {
        if (otherIndex > priorIndex) {
          perEntityPositions.set(otherVoterId, otherIndex - 1);
        }
      }
      // If the per-entity list is now empty, drop the entity entry
      // entirely so the empty-bailout check below works.
      if (perEntityList.length === 0) {
        list.delete(entityId);
        positions.delete(entityId);
      }
      return;
    }

    // The voter has at least one non-withdraw arm; record the rolled-
    // up choice. In-place overwrite at the existing position (per
    // Decision §5 — first-vote-arrival; subsequent votes overwrite at
    // the original position); first-vote pushes to the end.
    if (perEntityList === undefined) {
      perEntityList = [];
      list.set(entityId, perEntityList);
    }
    if (perEntityPositions === undefined) {
      perEntityPositions = new Map<string, number>();
      positions.set(entityId, perEntityPositions);
    }
    const priorIndex = perEntityPositions.get(voterId);
    if (priorIndex === undefined) {
      perEntityPositions.set(voterId, perEntityList.length);
      perEntityList.push({ participantId: voterId, choice: rolled });
    } else {
      perEntityList[priorIndex] = { participantId: voterId, choice: rolled };
    }
  }

  for (const event of events) {
    if (event.kind === 'proposal') {
      const target = voteTargetOf(event.payload.proposal);
      if (target === null) continue;
      proposalTarget.set(event.id, target);
      continue;
    }
    if (event.kind === 'vote') {
      // Per ADR 0030 §2: vote payloads are a `target`-discriminated
      // union. Resolve to the `(entityKind, entityId, facet)` triple
      // from either arm — the facet-keyed arm carries it directly;
      // the proposal-keyed arm looks it up via the proposal-id →
      // target map (structural-arm votes have no facet target and
      // are skipped).
      const voterId = event.payload.participant;
      if (voterId === currentParticipantId) continue;
      let entityKind: 'node' | 'edge';
      let entityId: string;
      let facet: FacetName;
      if (event.payload.target === 'facet') {
        // Per `pf_part_facet_name_widen_shape` the local `FacetName`
        // mirror is now 4-valued (matching the wire-level enum), so
        // shape-facet votes flow through this arm into the per-entity
        // per-other-voter rollup like the other three facets.
        entityKind = event.payload.entity_kind;
        entityId = event.payload.entity_id;
        facet = event.payload.facet;
      } else {
        const target = proposalTarget.get(event.payload.proposal_id);
        if (target === undefined) continue;
        entityKind = target.entityKind;
        entityId = target.entityId;
        facet = target.facet;
      }

      const facetCompositeKey = `${entityId}|${facet}|${voterId}`;
      perFacetVoterArm.set(facetCompositeKey, event.payload.choice);

      // Maintain the reverse indexes used by the rollup re-derivation.
      let facetKeys = facetKeysByEntity.get(entityId);
      if (facetKeys === undefined) {
        facetKeys = new Set<string>();
        facetKeysByEntity.set(entityId, facetKeys);
      }
      facetKeys.add(facetCompositeKey);

      const voterFacetKey = `${entityId}|${voterId}`;
      let facets = facetsByEntityVoter.get(voterFacetKey);
      if (facets === undefined) {
        facets = new Set<FacetName>();
        facetsByEntityVoter.set(voterFacetKey, facets);
      }
      facets.add(facet);

      rerollEntityVoter(entityKind, entityId, voterId);
      continue;
    }
    // Other event kinds (commit, meta-disagreement-marked,
    // node-created, edge-created, annotation-created, etc.) don't
    // contribute votes. See the moderator's `projectVotesByFacet` for
    // the post-commit rationale (server-side write rules prevent
    // further arm-switching votes after commit, so the last-write-wins
    // semantics are stable).
  }

  if (nodes.size === 0 && edges.size === 0) {
    return EMPTY_OTHERS_VOTES;
  }
  // The internal accumulator stores per-entity lists as mutable
  // `OtherVote[]` (for the in-place overwrite + gap-close write paths
  // above). The return type widens to `readonly OtherVote[]` per
  // `OthersVoteIndex`; TypeScript's structural narrowing handles the
  // widening at the return site. Same posture as `ownVotes.ts`'s
  // internal mutable Map → readonly index return.
  return { nodes, edges };
}

/**
 * Resolve the per-entity other-votes list for a node from the index,
 * defaulting to the shared `EMPTY_OTHER_VOTES_LIST` reference when the
 * node has no recordable other-votes.
 *
 * Per Decision §6 — the projector inlines `index.nodes.get(id) ??
 * EMPTY_OTHER_VOTES_LIST` directly so this helper isn't load-bearing
 * for THIS leaf. Exposing it now keeps future consumers
 * (`part_entity_detail_panel`'s per-facet breakdown precondition,
 * `part_other_vote_indicators_canvas_dots`'s canvas-overlay
 * positioning loop) from refactoring the seam.
 */
export function otherVotesForNode(index: OthersVoteIndex, nodeId: string): readonly OtherVote[] {
  return index.nodes.get(nodeId) ?? EMPTY_OTHER_VOTES_LIST;
}

/**
 * Resolve the per-entity other-votes list for an edge from the index,
 * defaulting to the shared `EMPTY_OTHER_VOTES_LIST` reference when the
 * edge has no recordable other-votes. Symmetric with
 * `otherVotesForNode` per Decision §1's node + edge structural
 * symmetry.
 */
export function otherVotesForEdge(index: OthersVoteIndex, edgeId: string): readonly OtherVote[] {
  return index.edges.get(edgeId) ?? EMPTY_OTHER_VOTES_LIST;
}
