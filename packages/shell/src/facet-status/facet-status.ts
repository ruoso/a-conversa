// Per-entity per-facet `FacetStatus` derivation for every client-side
// surface.
//
// Refinement: tasks/refinements/shell-package/extract_facet_status_rules.md
//   (the four-caller consolidation that retires the three client mirrors
//    `apps/{moderator,participant,audience}/src/graph/facetStatus.ts`)
// Predecessor ports:
//   tasks/refinements/moderator-ui/mod_proposed_state_styling.md
//   tasks/refinements/per-facet-refactor/pf_projection_facet_status_refactor.md
//   tasks/refinements/audience/aud_proposed_styling.md
// ADR 0030 §10 — per-facet vote keying / canonical seven-value
//   `FacetStatus` union + the eight-rule derivation walk.
//
// Client-side mirror of `apps/server/src/projection/facet-status.ts`'s
// `deriveFacetStatus`. The server does not expose a client-callable
// helper, and the WS `proposal-status` broadcast only covers facets
// attached to *pending* proposals — committed / withdrawn / meta-
// disagreement facets need the same state-machine evaluation locally.
// Since `apps/server` is not a workspace dependency of any UI surface
// and `@a-conversa/shared-types` does not re-export `FacetStatus`, this
// file mirrors the small rule set verbatim. If a future refactor extracts
// a shared methodology types package, the duplication becomes the call
// site.
//
// Walks the per-session event log once and builds a per-entity per-facet
// `FacetState` then runs the eight derivation rules to produce the final
// `FacetStatus` per entity-facet pair. Rules ported from
// `deriveFacetStatus` per ADR 0030 §10 +
// `pf_projection_facet_status_refactor`:
//
//   1. Meta-disagreement on a facet short-circuits to 'meta-disagreement'.
//   2. No candidate value yet → 'awaiting-proposal'.
//   3. Filter votes + withdrawals by current participants (joined and not left).
//   4. A withdraw-agreement against a committed facet → 'withdrawn'.
//      (Withdrawals come from `withdraw-agreement` events only — per
//      ADR 0030 §3 the legacy `vote.choice = 'withdraw'` arm is retired;
//      closed by `pf_unit_test_audit`.)
//   5. Any `dispute` vote → 'disputed'.
//   6. Committed (no dispute / withdraw) → 'committed'.
//   7. All current participants voted `agree` → 'agreed'.
//   8. Anything else → 'proposed'.
//
// **`node-created` / `edge-created` populate inline candidates.** Per
// ADR 0030 §4 + §5: a node's `wording` facet enters life with the
// captured text as its candidate (no proposal needed); an edge's
// `shape` facet enters life with the inline carriage. The
// `classification` / `substance` facets enter life with `candidateValue
// === null` and surface as `'awaiting-proposal'` until a proposal lands.
//
// **A new facet-valued proposal clears prior votes on that facet.** Per
// ADR 0030 §7: the prior `perParticipant` map's contents were votes
// against the OLD candidate; the new candidate is a fresh proposal that
// needs fresh agreement.
//
// **`withdraw-agreement` events** are tracked per `(entity, facet,
// participant)` per ADR 0030 §3; a withdrawal against a committed
// facet sends it to `'withdrawn'`.
//
// Returns `FacetStatusIndex`: two `Map`s — one per entity kind (nodes / edges)
// — keyed by entity id, each value a `Partial<Record<FacetName, FacetStatus>>`.
// An entity with no facet-targeting events appears as an empty record (or
// no entry at all — consumers should treat both the same via
// `index.nodes.get(id) ?? EMPTY_FACET_STATUSES`).

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
 * The four facets the client-side projection tracks per entity. Mirrors
 * `apps/server/src/projection/types.ts`'s `FacetName` AND the wire-level
 * `facetNameSchema` in `@a-conversa/shared-types` (both 4-valued post
 * `pf_shape_facet_wire_vote`). Nodes in v1 carry `wording` /
 * `classification` / `substance`; edges carry `shape` (inline carriage of
 * the role from `edge-created` per ADR 0030 §5) and `substance`.
 *
 * The shell-side type intentionally stays a separate `export type` rather
 * than re-exporting from `@a-conversa/shared-types` so the shell's
 * facet-status layer keeps its self-contained type-mirror posture (the
 * file also owns the `FacetStatus` enum and the derivation rules — re-
 * exporting `FacetName` from a different module would split the
 * vocabulary across two import sources for one logical concept).
 * Lockstep with the wire enum is enforced by:
 *
 *   - The `Event` import (vote / commit / withdraw-agreement /
 *     meta-disagreement-marked event payloads' `facet` field uses the
 *     wire enum) — the derivation arms below assign event-payload
 *     facets directly into this type's slots, so a drift between the
 *     two values would surface as a TypeScript error.
 *   - The facet round-trip i18n test in
 *     `packages/i18n-catalogs/src/methodology.test.ts` pins the four-
 *     valued vocabulary at the catalog layer (today the test pins
 *     `wording / classification / substance / proposal` — the shape
 *     facet does NOT have a `methodology.facet.shape` catalog key
 *     because the per-facet pill row deliberately omits it).
 */
export type FacetName = 'classification' | 'substance' | 'wording' | 'shape';

// Per ADR 0030 §3 + `pf_facet_keyed_vote_payload` +
// `pf_withdraw_agreement_handler`: `vote.choice` collapsed to
// `'agree' | 'dispute'`; withdrawal is its own first-class event kind.
// The legacy `'withdraw'` arm has been retired from this union — withdrawals
// are tracked separately on the per-facet `withdrawals` set populated by
// `withdraw-agreement` events.
type PerParticipantVote = 'agree' | 'dispute';

/**
 * The output of `computeFacetStatuses`. Per entity kind, a Map of entity id
 * to a partial record of per-facet status. Facets with no events affecting
 * them are absent from the record.
 *
 * The `annotations` bucket carries per-annotation facet status for
 * annotations materialized by a committed meta-move. Its value shape is
 * identical to the node/edge buckets (and to the moderator's
 * `AnnotationFacetStatusIndex`), so `selectAnnotations` consumes it
 * directly. An annotation only ever carries a `substance` entry — the
 * facet the data model reserves for "do we agree with this annotation's
 * substance" (the annotation's `wording` is inline-agreed at creation; it
 * *is* the meta-move `content`). Populated by routing the per-participant
 * votes cast on the originating meta-move proposal through the same
 * `derive` state machine, correlated to the annotation via the
 * commit-batch adjacency the `meta_move_commit_logic` predecessor
 * guarantees (the `annotation-created` event immediately precedes the
 * meta-move's `commit`).
 * Refinement: tasks/refinements/data-and-methodology/annotation_facet_status_logic.md
 */
export interface FacetStatusIndex {
  readonly nodes: ReadonlyMap<string, Readonly<Partial<Record<FacetName, FacetStatus>>>>;
  readonly edges: ReadonlyMap<string, Readonly<Partial<Record<FacetName, FacetStatus>>>>;
  readonly annotations: ReadonlyMap<string, Readonly<Partial<Record<FacetName, FacetStatus>>>>;
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
   * when (a) a `node-created.wording` populates the wording facet
   * inline, (b) an `edge-created` populates the shape facet inline, or
   * (c) a facet-valued proposal targeting this facet lands. Drives
   * Rule 2 (`candidate === false` → `'awaiting-proposal'`).
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
    case 'capture-node':
      // Per ADR 0030 §1 + §4: `capture-node` names the wording-facet
      // candidate inline; threading the wording target lets a facet-
      // keyed vote / commit walk against this proposal resolve
      // consistently across every client mirror.
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
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
  // Per-annotation `substance` facet accumulators, keyed by annotation id.
  // Populated when a committed meta-move's `commit` is paired with its
  // preceding `annotation-created` (see the `commit` arm below).
  const annotationStates = new Map<string, InternalFacetState>();
  // Per-participant votes accumulated against an in-flight meta-move
  // proposal, keyed by the proposal's event id. `targetOf` returns null
  // for meta-move (it produces no node/edge facet update), so these votes
  // are tracked here and routed onto the resulting annotation's
  // `substance` facet at commit time. Refinement Decision §3.
  const metaMoveProposalVotes = new Map<string, InternalFacetState>();

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.kind === 'participant-joined') {
      // Per `deriveCurrentParticipants` in `proposalFacets.ts` + the
      // methodology semantics in `docs/methodology.md` § "Voting":
      // only non-moderator participants count toward facet unanimity.
      // The moderator drives the conversation but does not vote — a
      // moderator-counted Rule 7 would never fire `'agreed'` until
      // the moderator personally voted, which the methodology
      // doesn't model.
      if (event.payload.role === 'moderator') continue;
      currentParticipants.add(event.payload.user_id);
      continue;
    }
    if (event.kind === 'participant-left') {
      currentParticipants.delete(event.payload.user_id);
      continue;
    }
    if (event.kind === 'node-created') {
      // Per ADR 0030 §4: wording is inline on `node-created` — the
      // wording facet enters life with the captured text as its
      // candidate (no proposal supplied it). Classification +
      // substance facets remain `awaiting-proposal` until their
      // respective proposals land.
      const wordingState = getOrCreateFacetState(
        nodeStates,
        edgeStates,
        'node',
        event.payload.node_id,
        'wording',
      );
      wordingState.hasCandidate = true;
      // Pre-allocate classification + substance facet entries so the
      // `'awaiting-proposal'` rule fires for them. (Without this the
      // entity would have no entry and the lookup returns `undefined` —
      // the consumer treats undefined the same as `'awaiting-proposal'`
      // semantically, but the explicit emission is clearer.)
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
      // Per ADR 0030 §5: edge shape is inline on `edge-created` — the
      // shape facet enters life with the inline role as its candidate
      // (no proposal supplied it). Mirrors the `node-created.wording`
      // seeding above.
      const shapeState = getOrCreateFacetState(
        nodeStates,
        edgeStates,
        'edge',
        event.payload.edge_id,
        'shape',
      );
      shapeState.hasCandidate = true;
      // The substance facet enters life `awaiting-proposal` until a
      // `set-edge-substance` proposal lands.
      getOrCreateFacetState(nodeStates, edgeStates, 'edge', event.payload.edge_id, 'substance');
      continue;
    }
    if (event.kind === 'withdraw-agreement') {
      // Per ADR 0030 §3: withdraw-agreement is keyed by `(entity, facet,
      // participant)`. The handler records the withdrawal on the
      // matching facet's `withdrawals` set; the derivation surfaces
      // `'withdrawn'` when the withdrawal lands on a committed
      // candidate.
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
        // Per ADR 0030 §7 + the refactor: a new facet-valued proposal
        // sets a fresh candidate AND clears prior per-participant votes
        // on the facet (the old votes were votes against the old
        // candidate). Withdrawals are NOT cleared — those are
        // historical participant gestures against the prior commit.
        state.hasCandidate = true;
        state.candidateProposalEventId = event.id;
        state.perParticipant.clear();
      } else if (event.payload.proposal.kind === 'meta-move') {
        // A meta-move produces no per-entity (node/edge) facet update —
        // its effect is on the *annotation* it materializes at commit.
        // Track its whole-proposal `agree`/`dispute` votes here so they
        // can be routed onto the resulting annotation's `substance`
        // facet once the commit pairs it with its `annotation-created`.
        // Refinement Decision §3; correlation via Decision §2.
        const metaState = emptyFacetState();
        metaState.hasCandidate = true;
        metaMoveProposalVotes.set(event.id, metaState);
      }
      // Per-component decompose / interpretive-split classification
      // facet seeding was removed by
      // `migrate_off_compute_facet_statuses_onto_proposal_status_broadcast`.
      // The server-side `facetTargetsForProposal` in
      // `apps/server/src/ws/broadcast/proposal-status.ts` is now the
      // single source of truth: it emits one `proposal-status` envelope
      // per component, and the shell store's `pendingProposalFacetStatus`
      // map carries the per-`(entityKind, entityId, facet)` cell each
      // consumer reads.
      continue;
    }
    if (event.kind === 'vote') {
      // Per ADR 0030 §2: vote payloads are a `target`-discriminated
      // union. The facet-keyed arm carries the `(entity_kind,
      // entity_id, facet)` triple directly; the proposal-keyed arm
      // resolves to the facet via the proposal-id → target map. Both
      // arms write to the same per-facet `perParticipant` map.
      if (event.payload.target === 'facet') {
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
      // target === 'proposal' — structural arm or legacy facet-valued
      // arm for any proposal-keyed votes still on the log.
      const target = proposalTarget.get(event.payload.proposal_id);
      if (!target) {
        // Not a node/edge facet proposal — it may be a meta-move whose
        // votes route onto the resulting annotation's substance facet.
        const metaState = metaMoveProposalVotes.get(event.payload.proposal_id);
        if (metaState) {
          metaState.perParticipant.set(event.payload.participant, event.payload.choice);
        }
        continue;
      }
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
      if (!target) {
        // A committed meta-move: route its accumulated votes onto the
        // resulting annotation's `substance` facet. The annotation is
        // recovered from the `annotation-created` event immediately
        // preceding this `commit` — the commit-batch adjacency the
        // `meta_move_commit_logic` predecessor guarantees ([annotation-
        // created, commit] in that order). Refinement Decisions §2/§3.
        const metaState = metaMoveProposalVotes.get(event.payload.proposal_id);
        const prev = i > 0 ? events[i - 1] : undefined;
        if (metaState && prev && prev.kind === 'annotation-created') {
          const annotationId = prev.payload.annotation_id;
          let substance = annotationStates.get(annotationId);
          if (!substance) {
            substance = emptyFacetState();
            annotationStates.set(annotationId, substance);
          }
          for (const [participant, choice] of metaState.perParticipant) {
            substance.perParticipant.set(participant, choice);
          }
          substance.hasCandidate = true;
          substance.committed = true;
        }
        continue;
      }
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
    // Other event kinds (annotation-created, session-created,
    // session-ended, entity-included, snapshot-created, ...) do not
    // affect facet status directly. The facet status is purely a
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
  // Annotations carry only a `substance` entry — the facet the routed
  // meta-move votes feed (Refinement Decision §3). The same `derive`
  // rules apply: a committed meta-move (necessarily unanimous `agree`
  // per `checkUnanimousAgreeStructural`) rolls up to `committed`.
  const annotations = new Map<string, Partial<Record<FacetName, FacetStatus>>>();
  for (const [annotationId, state] of annotationStates) {
    annotations.set(annotationId, { substance: derive(state, currentParticipants) });
  }

  return { nodes, edges, annotations };
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

  // Rule 2: no candidate value yet → `'awaiting-proposal'`. Per ADR
  // 0030 §10: this is the empty-state row.
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

  // Rule 4: withdraw-agreement against a committed facet → 'withdrawn'.
  // Per ADR 0030 §3: withdrawal is its own first-class event kind
  // (`withdraw-agreement`); the legacy `vote.choice = 'withdraw'`
  // back-compat branch was closed by `pf_unit_test_audit` since the
  // wire schema's hard rejection + ADR 0030's clean-break migration
  // mean no legacy `'withdraw'` choice can reach this projection.
  if (state.committed && hasCurrentWithdrawal) {
    return 'withdrawn';
  }

  // Rule 5: any current dispute → disputed.
  if (hasDispute) {
    return 'disputed';
  }

  // Rule 6: committed (no dispute / withdraw) → committed.
  if (state.committed) {
    return 'committed';
  }

  // Rule 7: every current participant voted agree → agreed. Requires at
  // least one current participant (an empty-session facet stays
  // 'proposed').
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
 * consumers when an entity has no facet entries, so React / ReactFlow
 * memoization doesn't see a fresh object on every projection pass.
 */
export const EMPTY_FACET_STATUSES: Readonly<Partial<Record<FacetName, FacetStatus>>> =
  Object.freeze({});

/**
 * Card-level rollup priority. Highest priority first; the first status
 * present in the per-facet record wins. Sourced from the moderator's
 * `apps/moderator/src/graph/StatementNode.tsx` (the canonical chronological
 * source — the participant + audience copies were verbatim ports of it).
 *
 *   1. `proposed`           — gathering votes; the most active surface.
 *   2. `meta-disagreement`  — methodology-engine escalation always wins.
 *   3. `disputed`           — agreement broke down on a vote.
 *   4. `agreed`             — all current participants agreed, no commit.
 *   5. `committed`          — agreed and committed; closed (visual signal
 *                              is the closed-tone slate-400 border).
 *   6. `withdrawn`          — committed then withdrawn; closed.
 *   7. `awaiting-proposal`  — empty-state row; only surfaces when ALL
 *                              facets are awaiting-proposal.
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
  'awaiting-proposal',
];

/**
 * Return the highest-priority `FacetStatus` present in the per-facet
 * record per `ROLLUP_PRIORITY`. Returns `undefined` when the record is
 * empty (no facet entries) — Cytoscape-driven consumers then stamp the
 * literal sentinel string `'none'` onto element data so the selector
 * engine has a stable value to match on (`[rollupStatus = 'none']`
 * matches the baseline branch).
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

/**
 * Build a `FacetStatusIndex` adapter shape over the shell store's
 * per-`(entityKind, entityId, facet)` `pendingProposalFacetStatus`
 * cell-map. Used by moderator consumers (`GraphCanvasPane`,
 * `PendingProposalsPane`) that want the broadcast-derived facet status
 * exposed through the same `.nodes.get(id)?.[facet]` shape they already
 * consume from `computeFacetStatuses(events)`.
 *
 * Per `migrate_off_compute_facet_statuses_onto_proposal_status_broadcast`
 * D5 — a thin adapter so the existing `StatementNodeData` / chip-lookup
 * code paths stay untouched while the source-of-truth swap happens at
 * the selector boundary. The broadcast cell-map is keyed on node/edge
 * facets only, so the `annotations` bucket (populated from the event
 * log by `computeFacetStatuses`, not from this broadcast adapter) is
 * returned empty here.
 */
export function buildFacetStatusIndexFromBroadcast(
  cellMap: ReadonlyMap<string, FacetStatus>,
): FacetStatusIndex {
  const nodes = new Map<string, Partial<Record<FacetName, FacetStatus>>>();
  const edges = new Map<string, Partial<Record<FacetName, FacetStatus>>>();
  for (const [key, status] of cellMap) {
    const firstColon = key.indexOf(':');
    if (firstColon < 0) continue;
    const lastColon = key.lastIndexOf(':');
    if (lastColon === firstColon) continue;
    const entityKind = key.slice(0, firstColon);
    const entityId = key.slice(firstColon + 1, lastColon);
    const facet = key.slice(lastColon + 1) as FacetName;
    const bucket = entityKind === 'node' ? nodes : entityKind === 'edge' ? edges : null;
    if (bucket === null) continue;
    const existing = bucket.get(entityId);
    if (existing) {
      existing[facet] = status;
    } else {
      bucket.set(entityId, { [facet]: status });
    }
  }
  return { nodes, edges, annotations: new Map() };
}
