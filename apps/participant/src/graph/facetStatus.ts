// Per-entity per-facet `FacetStatus` derivation for the participant's
// read-mostly Cytoscape graph.
//
// Refinement (current shape): tasks/refinements/per-facet-refactor/pf_projection_facet_status_refactor.md
// Historical: tasks/refinements/participant-ui/part_per_facet_state_styling.md
//
// Client-side mirror of `apps/server/src/projection/facet-status.ts`'s
// `deriveFacetStatus`. This is a verbatim port of the moderator's
// `apps/moderator/src/graph/facetStatus.ts` — Decision §2 of the
// participant refinement settled the "port verbatim now; extract to
// `@a-conversa/shell` when the third caller (audience) materialises"
// rationale. Two existing copies (server source of truth + moderator
// client mirror) had already justified the duplication for the
// moderator; this leaf adds a third copy (participant client mirror)
// under the same workspace-boundary justification. The eventual
// shell extract should find all three copies via this header trail:
//
//   - `apps/server/src/projection/facet-status.ts` — canonical server
//     source (the rules' authoritative implementation; `deriveFacetStatus`).
//   - `apps/moderator/src/graph/facetStatus.ts` — moderator client mirror
//     (ReactFlow consumer; `GraphCanvasPane.tsx` + `PendingProposalsPane.tsx`).
//   - this file — participant client mirror (Cytoscape consumer;
//     `GraphView.tsx`'s element-data stamping + the test mirror).
//
// All three implementations MUST stay in lockstep if the server's
// rule set widens (e.g. a new facet kind, a new vote kind). The
// moderator-side header comment names the same lockstep requirement.
//
// Walks the per-session event log once and builds a per-entity per-facet
// `FacetState` then runs the seven derivation rules to produce the final
// `FacetStatus` per entity-facet pair. Rules ported from
// `deriveFacetStatus`:
//
//   1. Meta-disagreement on a facet short-circuits to 'meta-disagreement'.
//   2. Filter votes by current participants (joined and not left).
//   3. A `withdraw` vote against a committed facet → 'withdrawn'.
//   4. Any `dispute` vote (or `withdraw` without prior commit) → 'disputed'.
//   5. Committed (no dispute / withdraw) → 'committed'.
//   6. All current participants voted `agree` → 'agreed'.
//   7. Anything else → 'proposed'.
//
// Returns `FacetStatusIndex`: two `Map`s — one per entity kind (nodes / edges)
// — keyed by entity id, each value a `Partial<Record<FacetName, FacetStatus>>`.
// An entity with no facet-targeting events appears as an empty record (or
// no entry at all — consumers should treat both the same via
// `index.nodes.get(id) ?? {}`).
//
// `cardRollupStatus(facetStatuses)` returns the highest-priority status
// per the `ROLLUP_PRIORITY` array (proposed > meta-disagreement >
// disputed > agreed > committed > withdrawn). On the moderator side the
// helper lives in `StatementNode.tsx` because the moderator's React
// custom node was its only consumer; on the participant side the
// helper sits here because there are two consumers (the `projectGraph`
// projector and the `<GraphView>` test mirror), so co-location with the
// index that feeds both is cleaner.

import type { Event, ProposalPayload } from '@a-conversa/shared-types';

/**
 * Per-facet overall-status enum. Mirrors `apps/server/src/projection/types.ts`'s
 * `FacetStatus` verbatim. Seven values: the agreement layer (`proposed`,
 * `agreed`, `disputed`, `meta-disagreement`), the committed layer
 * (`committed`, `withdrawn`), and the empty-state `awaiting-proposal`.
 *
 * `'awaiting-proposal'` is added by `pf_awaiting_proposal_facet_status` per
 * [ADR 0030 §10](../../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md):
 * the entity exists but no candidate value has been set for that facet yet
 * (most commonly a freshly-captured node's `classification` and `substance`
 * facets, before a `classify-node` / `set-node-substance` proposal has been
 * made). Distinct from `'proposed'`, which means "a candidate has been set
 * and is gathering votes."
 *
 * This file is the participant's type mirror; the type widening lands here
 * in lockstep with the server canonical and the moderator mirror. The
 * derivation rules above do NOT yet emit `'awaiting-proposal'` — the
 * actual emission lands in the downstream
 * `pf_projection_facet_status_refactor` task, and the consumer UI tasks
 * close their own exhaustive-switch coverage there.
 */
export type FacetStatus =
  | 'proposed'
  | 'agreed'
  | 'disputed'
  | 'committed'
  | 'withdrawn'
  | 'meta-disagreement'
  | 'awaiting-proposal';

/**
 * The three facets the projection tracks per entity. Mirrors
 * `apps/server/src/projection/types.ts`'s `FacetName`. Nodes in v1 carry
 * all three; edges carry only `substance`.
 */
export type FacetName = 'classification' | 'substance' | 'wording';

type PerParticipantVote = 'agree' | 'dispute' | 'withdraw';

/**
 * The output of `computeFacetStatuses`. Per entity kind, a Map of entity id
 * to a partial record of per-facet status. Facets with no events affecting
 * them are absent from the record.
 */
export interface FacetStatusIndex {
  readonly nodes: ReadonlyMap<string, Readonly<Partial<Record<FacetName, FacetStatus>>>>;
  readonly edges: ReadonlyMap<string, Readonly<Partial<Record<FacetName, FacetStatus>>>>;
}

/**
 * Internal accumulator for per-facet state — same shape as the server's
 * `FacetState`, minus the typed `value` field (the client doesn't need
 * the proposed value to compute the status).
 *
 * `perParticipant` is keyed by participant user id; each value is the
 * participant's latest vote on the facet. Multiple votes by the same
 * participant overwrite (the server enforces a one-vote-per-(proposal,
 * participant) invariant; this client mirror trusts that).
 *
 * `committed` flips when a `commit` event lands referencing one of the
 * proposals targeting this facet; `metaDisagreement` flips when a
 * `mark-meta-disagreement` event lands likewise.
 */
interface InternalFacetState {
  perParticipant: Map<string, PerParticipantVote>;
  /** Per-participant withdrawals (populated by `withdraw-agreement` events). */
  withdrawals: Set<string>;
  committed: boolean;
  metaDisagreement: boolean;
  /**
   * Whether the facet has any candidate value to vote on. Set to `true`
   * when a `node-created.wording` populates the wording facet inline,
   * an `edge-created` populates the shape facet inline, or a facet-
   * valued proposal targeting this facet lands. Drives the
   * `'awaiting-proposal'` rule per ADR 0030 §10.
   */
  hasCandidate: boolean;
  /**
   * The candidate-proposal-event-id supplying the current candidate
   * value, if any. Used to track vote-reset semantics when a new
   * facet-valued proposal supersedes the prior candidate.
   */
  candidateProposalEventId: string | null;
}

/** Three-tuple key for the (entity-kind, entity-id, facet) projection. */
type EntityKind = 'node' | 'edge';

function emptyFacetState(): InternalFacetState {
  return {
    perParticipant: new Map(),
    withdrawals: new Set(),
    committed: false,
    metaDisagreement: false,
    hasCandidate: false,
    candidateProposalEventId: null,
  };
}

/**
 * Decode a proposal payload to the (entityKind, entityId, facet) triple
 * the proposal targets, if any. Returns `null` for proposal sub-kinds
 * that do not produce a per-entity-facet status update (decompose,
 * interpretive-split, axiom-mark, meta-move, break-edge, annotate) — see
 * the refinement's "Out-of-scope proposal sub-kinds" decision.
 */
function targetOf(
  proposal: ProposalPayload,
): { entityKind: EntityKind; entityId: string; facet: FacetName } | null {
  switch (proposal.kind) {
    case 'classify-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'classification' };
    case 'set-node-substance':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'substance' };
    case 'set-edge-substance':
      return { entityKind: 'edge', entityId: proposal.edge_id, facet: 'substance' };
    case 'edit-wording':
      // Both reword and restructure target the parent node's wording
      // facet at proposal-time. (Restructure creates a new node at commit;
      // pre-commit the proposal is against the existing node's wording.)
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    case 'amend-node':
      // The methodology-engine repair op — same target as reword.
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    case 'decompose':
    case 'interpretive-split':
    case 'axiom-mark':
    case 'meta-move':
    case 'break-edge':
    case 'annotate':
      return null;
    default: {
      // Exhaustively narrowed; this branch is a runtime safety net for
      // callers that bypass TypeScript (e.g. tests that build malformed
      // events). An unknown proposal kind contributes no facet status.
      return null;
    }
  }
}

/**
 * Resolve a facet state from the per-kind storage maps. Creates the entry
 * lazily so callers don't have to pre-allocate; subsequent calls return
 * the same reference.
 */
function getOrCreateFacetState(
  nodeStates: Map<string, Map<FacetName, InternalFacetState>>,
  edgeStates: Map<string, Map<FacetName, InternalFacetState>>,
  entityKind: EntityKind,
  entityId: string,
  facet: FacetName,
): InternalFacetState {
  const store = entityKind === 'node' ? nodeStates : edgeStates;
  let perEntity = store.get(entityId);
  if (!perEntity) {
    perEntity = new Map();
    store.set(entityId, perEntity);
  }
  let state = perEntity.get(facet);
  if (!state) {
    state = emptyFacetState();
    perEntity.set(facet, state);
  }
  return state;
}

/**
 * Pure projection from a session's event log to the per-entity per-facet
 * `FacetStatus` index. The walk is single-pass over `events`; the rule
 * evaluation runs once at the end on each accumulated `InternalFacetState`.
 *
 * Empty event log returns empty maps. Unknown proposal sub-kinds (the
 * structural / per-participant ones) contribute nothing.
 */
export function computeFacetStatuses(events: readonly Event[]): FacetStatusIndex {
  // Step 1: walk events once to build:
  //   - The current-participants set (joined - left).
  //   - A proposal-id → target triple map (vote / commit /
  //     mark-meta-disagreement events reference proposals by id; we map
  //     them back to facets via this).
  //   - Per-entity per-facet `InternalFacetState`s.
  const currentParticipants = new Set<string>();
  const proposalTarget = new Map<
    string,
    { entityKind: EntityKind; entityId: string; facet: FacetName }
  >();
  const nodeStates = new Map<string, Map<FacetName, InternalFacetState>>();
  const edgeStates = new Map<string, Map<FacetName, InternalFacetState>>();

  for (const event of events) {
    if (event.kind === 'participant-joined') {
      currentParticipants.add(event.payload.user_id);
      continue;
    }
    if (event.kind === 'participant-left') {
      currentParticipants.delete(event.payload.user_id);
      continue;
    }
    if (event.kind === 'node-created') {
      // Per ADR 0030 §4: wording is inline on `node-created`. The
      // wording facet enters life with the captured text as its
      // candidate. Classification + substance facets remain
      // `awaiting-proposal` until their respective proposals land.
      const wordingState = getOrCreateFacetState(
        nodeStates,
        edgeStates,
        'node',
        event.payload.node_id,
        'wording',
      );
      wordingState.hasCandidate = true;
      getOrCreateFacetState(
        nodeStates,
        edgeStates,
        'node',
        event.payload.node_id,
        'classification',
      );
      getOrCreateFacetState(nodeStates, edgeStates, 'node', event.payload.node_id, 'substance');
      continue;
    }
    if (event.kind === 'edge-created') {
      // Per ADR 0030 §5: edge substance enters life `awaiting-proposal`
      // until a `set-edge-substance` proposal lands.
      getOrCreateFacetState(nodeStates, edgeStates, 'edge', event.payload.edge_id, 'substance');
      continue;
    }
    if (event.kind === 'withdraw-agreement') {
      // Per ADR 0030 §3: withdraw-agreement is keyed by `(entity, facet,
      // participant)`. The handler records the withdrawal on the
      // matching facet; the derivation surfaces `'withdrawn'` when the
      // withdrawal lands on a committed candidate.
      //
      // Per ADR 0030 §5 + `pf_shape_facet_wire_vote` the wire-level
      // `FacetName` widened to include `'shape'`; the participant card
      // does not surface a shape-facet pill (the local `FacetName`
      // mirror at this file stays 3-valued — see Decision §2 of the
      // participant refinement), so a shape-facet withdraw-agreement
      // is skipped at the projection layer here. The future card-layer
      // task that introduces a shape-facet pill will close this guard.
      if (event.payload.facet === 'shape') continue;
      const state = getOrCreateFacetState(
        nodeStates,
        edgeStates,
        event.payload.entity_kind,
        event.payload.entity_id,
        event.payload.facet,
      );
      state.withdrawals.add(event.payload.participant);
      continue;
    }
    if (event.kind === 'proposal') {
      const target = targetOf(event.payload.proposal);
      if (target !== null) {
        proposalTarget.set(event.id, target);
        const state = getOrCreateFacetState(
          nodeStates,
          edgeStates,
          target.entityKind,
          target.entityId,
          target.facet,
        );
        // Per ADR 0030 §7: a new facet-valued proposal sets a fresh
        // candidate AND clears prior per-participant votes (the old
        // votes were votes against the old candidate). Withdrawals
        // are NOT cleared.
        state.hasCandidate = true;
        state.candidateProposalEventId = event.id;
        state.perParticipant.clear();
      }
      // A pending decompose / interpretive-split proposal introduces N
      // component nodes via the propose-time fan-out; each component's
      // classification facet is `proposed` while the proposal is pending.
      // Without this branch the component nodes would render with NO
      // facet-status attribute. Mirrors the moderator port's decompose /
      // interpretive-split arms.
      const proposal = event.payload.proposal;
      if (proposal.kind === 'decompose') {
        for (const component of proposal.components) {
          const state = getOrCreateFacetState(
            nodeStates,
            edgeStates,
            'node',
            component.node_id,
            'classification',
          );
          state.hasCandidate = true;
          state.candidateProposalEventId = event.id;
        }
      } else if (proposal.kind === 'interpretive-split') {
        for (const reading of proposal.readings) {
          const state = getOrCreateFacetState(
            nodeStates,
            edgeStates,
            'node',
            reading.node_id,
            'classification',
          );
          state.hasCandidate = true;
          state.candidateProposalEventId = event.id;
        }
      }
      continue;
    }
    if (event.kind === 'vote') {
      // Per ADR 0030 §2: vote payloads are a `target`-discriminated
      // union. The facet-keyed arm carries `(entity_kind, entity_id,
      // facet)` directly; the proposal-keyed arm resolves to the
      // facet via the proposal-id → target map.
      //
      // Per `pf_shape_facet_wire_vote` the wire-level `FacetName`
      // includes `'shape'`; the participant card does not yet
      // surface a shape-facet pill, so shape-facet votes are skipped
      // at the projection layer here (mirrors the withdraw-agreement
      // arm above).
      if (event.payload.target === 'facet') {
        if (event.payload.facet === 'shape') continue;
        const state = getOrCreateFacetState(
          nodeStates,
          edgeStates,
          event.payload.entity_kind,
          event.payload.entity_id,
          event.payload.facet,
        );
        state.perParticipant.set(event.payload.participant, event.payload.choice);
        continue;
      }
      const target = proposalTarget.get(event.payload.proposal_id);
      if (!target) continue;
      const state = getOrCreateFacetState(
        nodeStates,
        edgeStates,
        target.entityKind,
        target.entityId,
        target.facet,
      );
      // Latest vote wins (server enforces one-vote-per-participant-per-
      // proposal; this is a no-op for well-formed logs and a defensive
      // last-write-wins for malformed ones).
      state.perParticipant.set(event.payload.participant, event.payload.choice);
      continue;
    }
    if (event.kind === 'commit') {
      // Per ADR 0030 §2 + §9: commit payloads are a `target`-
      // discriminated union. The facet-keyed arm carries the
      // `(entity_kind, entity_id, facet)` triple directly; the
      // proposal-keyed arm resolves to the facet via the proposal-id
      // → target map. Both arms flip the per-facet `committed` flag
      // the derivation reads.
      if (event.payload.target === 'facet') {
        // Shape-facet commits skipped at this layer (see vote +
        // withdraw-agreement arms above for the `'shape'` skip
        // rationale).
        if (event.payload.facet === 'shape') continue;
        const state = getOrCreateFacetState(
          nodeStates,
          edgeStates,
          event.payload.entity_kind,
          event.payload.entity_id,
          event.payload.facet,
        );
        state.committed = true;
        continue;
      }
      // target === 'proposal' — structural arm or legacy facet-valued
      // arm for any proposal-keyed commits still on the log.
      const target = proposalTarget.get(event.payload.proposal_id);
      if (!target) continue;
      const state = getOrCreateFacetState(
        nodeStates,
        edgeStates,
        target.entityKind,
        target.entityId,
        target.facet,
      );
      state.committed = true;
      continue;
    }
    if (event.kind === 'meta-disagreement-marked') {
      // Per ADR 0030 §2 + §9: meta-disagreement-marked payloads are a
      // `target`-discriminated union. The facet-keyed arm carries the
      // `(entity_kind, entity_id, facet)` triple directly; the
      // proposal-keyed arm resolves to the facet via the proposal-id
      // → target map. Both arms flip the per-facet `metaDisagreement`
      // flag the derivation reads.
      if (event.payload.target === 'facet') {
        // Shape-facet marks skipped at this layer (see vote +
        // withdraw-agreement arms above for the `'shape'` skip
        // rationale).
        if (event.payload.facet === 'shape') continue;
        const state = getOrCreateFacetState(
          nodeStates,
          edgeStates,
          event.payload.entity_kind,
          event.payload.entity_id,
          event.payload.facet,
        );
        state.metaDisagreement = true;
        continue;
      }
      // target === 'proposal' — structural arm or legacy facet-valued
      // arm for any proposal-keyed marks still on the log.
      const target = proposalTarget.get(event.payload.proposal_id);
      if (!target) continue;
      const state = getOrCreateFacetState(
        nodeStates,
        edgeStates,
        target.entityKind,
        target.entityId,
        target.facet,
      );
      state.metaDisagreement = true;
      continue;
    }
    // Other event kinds (node-created, edge-created, annotation-created,
    // session-created, session-ended, entity-included, snapshot-created)
    // do not affect facet status directly. The facet status is purely a
    // function of proposals + votes + commits + meta-disagreement marks.
  }

  // Step 2: run the derivation rules on each accumulated state.
  const nodes = new Map<string, Partial<Record<FacetName, FacetStatus>>>();
  for (const [entityId, perEntity] of nodeStates) {
    const out: Partial<Record<FacetName, FacetStatus>> = {};
    for (const [facet, state] of perEntity) {
      out[facet] = derive(state, currentParticipants);
    }
    nodes.set(entityId, out);
  }
  const edges = new Map<string, Partial<Record<FacetName, FacetStatus>>>();
  for (const [entityId, perEntity] of edgeStates) {
    const out: Partial<Record<FacetName, FacetStatus>> = {};
    for (const [facet, state] of perEntity) {
      out[facet] = derive(state, currentParticipants);
    }
    edges.set(entityId, out);
  }

  return { nodes, edges };
}

/**
 * Apply the eight derivation rules to a single `InternalFacetState`,
 * given the current participants set. Mirrors
 * `deriveFacetStatus` in `apps/server/src/projection/facet-status.ts`.
 */
function derive(state: InternalFacetState, currentParticipants: Set<string>): FacetStatus {
  // Rule 1: meta-disagreement short-circuits.
  if (state.metaDisagreement) {
    return 'meta-disagreement';
  }

  // Rule 2: no candidate value yet → `'awaiting-proposal'`.
  if (!state.hasCandidate) {
    return 'awaiting-proposal';
  }

  // Rule 3: filter votes + withdrawals to current participants only.
  const currentVotes: PerParticipantVote[] = [];
  for (const [participantId, vote] of state.perParticipant) {
    if (currentParticipants.has(participantId)) {
      currentVotes.push(vote);
    }
  }
  let hasCurrentWithdrawal = false;
  for (const participantId of state.withdrawals) {
    if (currentParticipants.has(participantId)) {
      hasCurrentWithdrawal = true;
      break;
    }
  }

  const hasDispute = currentVotes.some((v) => v === 'dispute');
  const hasLegacyWithdrawVote = currentVotes.some((v) => v === 'withdraw');

  // Rule 4: withdraw-agreement against a committed facet → 'withdrawn'.
  // Back-compat: a legacy `vote.choice = 'withdraw'` against a
  // committed candidate is also surfaced as `'withdrawn'` until the
  // methodology engine's emission path migrates to `withdraw-agreement`.
  if (state.committed && (hasCurrentWithdrawal || hasLegacyWithdrawVote)) {
    return 'withdrawn';
  }

  // Rule 5: any current dispute → disputed.
  if (hasDispute || (hasLegacyWithdrawVote && !state.committed)) {
    return 'disputed';
  }

  // Rule 6: committed (no dispute / withdraw) → committed.
  if (state.committed) {
    return 'committed';
  }

  // Rule 7: every current participant voted agree → agreed. Requires at
  // least one current participant.
  const currentParticipantCount = currentParticipants.size;
  const agreeCount = currentVotes.filter((v) => v === 'agree').length;
  if (currentParticipantCount > 0 && agreeCount === currentParticipantCount) {
    return 'agreed';
  }

  // Rule 8: anything else → proposed.
  return 'proposed';
}

/**
 * Module-scope shared empty per-facet record. Hands a stable reference to
 * consumers when an entity has no facet entries, so React memoization
 * doesn't see a fresh object on every projection pass.
 */
export const EMPTY_FACET_STATUSES: Readonly<Partial<Record<FacetName, FacetStatus>>> =
  Object.freeze({});

/**
 * Card-level rollup priority. Highest priority first; the first status
 * present in the per-facet record wins. Pinned to match the moderator's
 * `ROLLUP_PRIORITY` in `apps/moderator/src/graph/StatementNode.tsx`
 * verbatim so the two client surfaces don't drift.
 *
 *   1. `proposed`           — gathering votes; the most active surface.
 *   2. `meta-disagreement`  — methodology-engine escalation always wins.
 *   3. `disputed`           — agreement broke down on a vote.
 *   4. `agreed`             — all current participants agreed, no commit.
 *   5. `committed`          — agreed and committed; closed (visual signal
 *                              is the closed-tone slate-400 border).
 *   6. `withdrawn`          — committed then withdrawn; closed.
 *
 * Rationale: "things you can act on" sort first; `committed` / `withdrawn`
 * are closed and sort last. Within the agreement layer, `proposed` outranks
 * `disputed` outranks `agreed` because `proposed` means "still gathering
 * votes" — the most active surface to drive forward. `meta-disagreement`
 * sits second because the methodology-engine escalation always takes
 * precedence over a normal disputed facet.
 */
export const ROLLUP_PRIORITY: readonly FacetStatus[] = [
  'proposed',
  'meta-disagreement',
  'disputed',
  'agreed',
  'committed',
  'withdrawn',
  // `'awaiting-proposal'` (per ADR 0030 §10) sorts LAST in the rollup
  // — it's the empty-state row for a facet with no candidate value
  // yet. A card with at least one *actively proposed* facet should
  // surface as `'proposed'`; only when ALL facets are awaiting-proposal
  // does the card surface the empty-state rollup. The downstream
  // participant-UI task (`pf_part_detail_panel_three_facet_rows`) may
  // revisit the visual when it lands the per-facet propose affordance.
  'awaiting-proposal',
];

/**
 * Return the highest-priority `FacetStatus` present in the per-facet
 * record per `ROLLUP_PRIORITY`. Returns `undefined` when the record is
 * empty (no facet entries) — the `<GraphView>` projection consumer then
 * stamps the literal sentinel string `'none'` onto the element data so
 * Cytoscape's selector engine has a stable value to match on
 * (`[rollupStatus = 'none']` matches the baseline branch). Decision §4
 * of the refinement covers the sentinel-string choice.
 */
export function cardRollupStatus(
  facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>,
): FacetStatus | undefined {
  const present = new Set(Object.values(facetStatuses));
  for (const status of ROLLUP_PRIORITY) {
    if (present.has(status)) return status;
  }
  return undefined;
}
