// Pure selector that decodes a pending-proposal payload into the
// per-facet entries the right-sidebar's breakdown row renders.
//
// Refinement: tasks/refinements/moderator-ui/mod_per_facet_breakdown.md
//
// Companion to `facetStatus.ts` and `pendingProposals.ts` — same idiom
// (pure derivation, no closure over time, no `Date.now()`,
// no `Math.random()`). The selector decodes the proposal's facet shape
// via a per-sub-kind switch (Decision §1), then resolves each facet's
// status by reading — in priority order — (a) the server-broadcast
// `serverPerFacetStatus` for that facet name (the source of truth when
// present), (b) the client-side
// `facetStatusIndex.{nodes,edges}.get(entityId)?.[facet]` for facet-
// targeting sub-kinds when no server frame has arrived yet, (c)
// `'proposed'` as the default for facet entries the proposal introduces
// but neither surface has computed yet (Decision §5).
//
// For structural sub-kinds (decompose, interpretive-split, axiom-mark,
// meta-move, break-edge, amend-node — note `amend-node` actually targets
// `wording`; see Decision §1 for the partition; the seven structural
// kinds here mirror `targetOf`'s `null` return — and annotate) the
// function emits one "lifecycle" entry per proposal whose facet name is
// the synthetic `'proposal'` (Decision §4) and whose status is the same
// six-value enum.
//
// The shape map between sub-kind and per-facet target is settled in
// `data_and_methodology.event_types.proposal_events` and mirrored
// client-side in `facetStatus.ts`'s `targetOf` helper. This selector
// shares the same partition: the four facet-targeting sub-kinds map to
// real facet entries, the seven structural sub-kinds map to the
// synthetic `'proposal'` entry.
//
// **Pure** (Decision §9 / Constraints): no closure over time, no
// `Date.now()`, no `Math.random()`. Output is a `readonly` array of
// `{ facet, status, labelKey }` triples. The `labelKey` is an i18n
// catalog key (not pre-translated prose); the component calls
// `t(labelKey)` at render time.

import type { Event, ProposalPayload } from '@a-conversa/shared-types';
import { EMPTY_VOTES, type Vote } from '@a-conversa/shell';

import type { FacetName, FacetStatus, FacetStatusIndex } from './facetStatus.js';

/**
 * The set of facet names the breakdown can surface. Extends
 * `FacetName` (`'wording' | 'classification' | 'substance'`) with the
 * synthetic `'proposal'` lifecycle facet that structural sub-kinds
 * (decompose, axiom-mark, etc.) map to per Decision §4.
 */
export type LifecycleFacetName = FacetName | 'proposal';

/**
 * One entry in the breakdown's facet list. The component iterates the
 * selector's output array and renders one chip per entry; the chip's
 * `data-facet-name`, `data-facet-status`, and rendered label all flow
 * from this triple.
 *
 * Decision §9 — minimal shape: enough for the component to render the
 * chip, enough for the sibling vote-indicator task to locate the
 * matching `(proposalId, facet)` pair when it later threads in per-
 * participant votes inside each chip.
 */
export interface ProposalFacetEntry {
  /**
   * The facet this entry targets. `'proposal'` is the synthetic
   * lifecycle facet for structural sub-kinds (Decision §4).
   */
  readonly facet: LifecycleFacetName;
  /**
   * The resolved status (server frame → client mirror → default).
   */
  readonly status: FacetStatus;
  /**
   * The i18n catalog key for the facet-name label
   * (`methodology.facet.<facet>`). The component calls
   * `t(labelKey)` at render time; the selector does not pre-translate.
   */
  readonly labelKey: string;
  /**
   * Per-participant votes on this facet's pending proposal, in arrival
   * order (the projection's stable position semantics — each
   * participant's FIRST vote arrival pins their position; subsequent
   * arm-switches overwrite in place).
   *
   * For facet-targeting sub-kinds, populated from the
   * `votesByFacetIndex` lookup on `(entityId, facet)`. For structural
   * sub-kinds (synthetic `'proposal'` lifecycle entry), always
   * `EMPTY_VOTES` — structural proposals don't carry per-(entity,
   * facet) votes today (Decision §5). The component omits the
   * indicator row when this array is empty (mirrors the empty-row
   * omission rule on the graph pill).
   *
   * Refinement: `mod_vote_indicators_in_sidebar` Decisions §1 + §5.
   */
  readonly votes: readonly Vote[];
}

/**
 * Decode a `ProposalPayload` to the (entityKind, entityId, facet)
 * triple the proposal targets, OR `null` for structural sub-kinds
 * (which get a synthetic `'proposal'` entry instead).
 *
 * Mirrors the partition in `apps/moderator/src/graph/facetStatus.ts`'s
 * `targetOf` helper: same four facet-targeting sub-kinds (classify-
 * node, set-node-substance, set-edge-substance, edit-wording), same
 * seven structural sub-kinds (decompose, interpretive-split,
 * axiom-mark, meta-move, break-edge, amend-node, annotate) returning
 * `null`. Note `amend-node` is treated as structural here per
 * Decision §1 of this refinement (the table lists it under
 * "structural" — it is the methodology-engine repair op whose
 * commit-readiness surface differs from a pure `edit-wording`).
 */
type FacetTarget = {
  readonly entityKind: 'node' | 'edge';
  readonly entityId: string;
  readonly facet: FacetName;
};

function facetTargetOf(proposal: ProposalPayload): FacetTarget | null {
  switch (proposal.kind) {
    case 'classify-node':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'classification' };
    case 'set-node-substance':
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'substance' };
    case 'set-edge-substance':
      return { entityKind: 'edge', entityId: proposal.edge_id, facet: 'substance' };
    case 'edit-wording':
      // Both reword and restructure target the parent node's wording
      // facet at proposal-time.
      return { entityKind: 'node', entityId: proposal.node_id, facet: 'wording' };
    case 'decompose':
    case 'interpretive-split':
    case 'axiom-mark':
    case 'meta-move':
    case 'break-edge':
    case 'amend-node':
    case 'annotate':
      return null;
    default: {
      // Exhaustively narrowed; this branch is a runtime safety net for
      // callers that bypass TypeScript (e.g. tests that build malformed
      // events). An unknown proposal kind contributes one synthetic
      // entry like a structural sub-kind, so the row body always has
      // at least one chip.
      return null;
    }
  }
}

/**
 * Per-proposal-id vote index — `projectVotesByProposal(events)`'s
 * return shape. Re-stated here so the selector's caller does not need
 * to import the projection module just to spell the parameter type.
 *
 * Keyed on the structural proposal's envelope id; the value is the
 * per-participant vote list in arrival order. Empty `Map` when no
 * `vote` events have landed against any structural proposal.
 */
export type VotesByProposalIndex = ReadonlyMap<string, readonly Vote[]>;

/**
 * Shared empty `VotesByProposalIndex` for tests + the default-parameter
 * fall-through on the selector.
 */
const EMPTY_VOTES_BY_PROPOSAL_INDEX: VotesByProposalIndex = new Map();

/**
 * Resolve the per-facet status by precedence: server frame → client
 * mirror → default. Decision §5.
 *
 * @param facet The facet name (real `FacetName` or the synthetic
 *   `'proposal'` lifecycle entry).
 * @param target The `(entityKind, entityId, facet)` triple if the
 *   proposal targets a real facet (`null` for structural sub-kinds).
 * @param facetStatusIndex The client-side derivation off the event log.
 * @param serverPerFacetStatus The server-broadcast status map keyed by
 *   `FacetName` strings (a `Record<string, string>` on the wire; we
 *   defensively narrow to the `FacetStatus` enum below).
 */
function resolveStatus(
  facet: LifecycleFacetName,
  target: FacetTarget | null,
  facetStatusIndex: FacetStatusIndex,
  serverPerFacetStatus: Record<string, string> | undefined,
): FacetStatus {
  // (a) Server frame first — source of truth per
  // ws_proposal_status_broadcast.md. The wire shape is
  // `Record<string, string>`; we trust it is one of the six FacetStatus
  // values (enforced server-side at the broadcast construction site).
  if (serverPerFacetStatus) {
    const fromServer = serverPerFacetStatus[facet];
    if (fromServer && isFacetStatus(fromServer)) {
      return fromServer;
    }
  }
  // (b) Client mirror for facet-targeting sub-kinds only.
  if (target) {
    const perEntity =
      target.entityKind === 'node'
        ? facetStatusIndex.nodes.get(target.entityId)
        : facetStatusIndex.edges.get(target.entityId);
    const fromClient = perEntity?.[target.facet];
    if (fromClient) {
      return fromClient;
    }
  }
  // (c) Default — proposal exists in the pending list, so the
  // derivation's Rule 7 result for an unvoted facet applies.
  return 'proposed';
}

const FACET_STATUS_VALUES: ReadonlySet<string> = new Set<FacetStatus>([
  'proposed',
  'agreed',
  'disputed',
  'committed',
  'withdrawn',
  'meta-disagreement',
  // TODO(pf_projection_facet_status_refactor): empty-state row added by
  // `pf_awaiting_proposal_facet_status`. Accepted from the server frame
  // verbatim today; the downstream projection-refactor task will start
  // emitting it from `deriveFacetStatus`, at which point the wire
  // contract is the single source of truth and this branch becomes a
  // pure narrow-helper.
  'awaiting-proposal',
]);

function isFacetStatus(value: string): value is FacetStatus {
  return FACET_STATUS_VALUES.has(value);
}

/**
 * Build the i18n catalog key for a facet name. Reuses the existing
 * `methodology.facet.<facet>` keyspace (`wording` / `classification` /
 * `substance` shipped by `i18n_methodology_glossary`); this task adds
 * `methodology.facet.proposal` for the synthetic lifecycle entry.
 */
function labelKeyFor(facet: LifecycleFacetName): string {
  return `methodology.facet.${facet}`;
}

/**
 * Per-participant vote index keyed by `(entityId, facet)` —
 * `projectVotesByFacet(events)`'s return shape (re-stated here to
 * avoid forcing the selector's caller through the projection import
 * just to spell the parameter type). Refinement:
 * `mod_vote_indicators_in_sidebar` Decision §4.
 */
export type VotesByFacetIndex = ReadonlyMap<string, ReadonlyMap<FacetName, readonly Vote[]>>;

/**
 * Module-scope shared empty `VotesByFacetIndex` — hands a stable
 * reference to callers (notably tests that exercise the selector
 * without a populated index, and the selector's own default-parameter
 * fall-through that older call sites use before the pane rolls out
 * the threaded value).
 */
const EMPTY_VOTES_BY_FACET_INDEX: VotesByFacetIndex = new Map();

/**
 * Derive the per-facet entries for a single pending proposal.
 *
 * @param proposal The proposal payload (the discriminated-union sub-kind).
 * @param facetStatusIndex Client-side `computeFacetStatuses(events)`
 *   output — the fallback when no server frame has arrived yet (or the
 *   broadcast is rate-limited).
 * @param serverPerFacetStatus Per-proposal server-broadcast status map
 *   (from `useWsStore.sessionState[id].pendingProposals[proposalId].perFacetStatus`).
 *   `undefined` when no server frame has landed for this proposal id.
 * @param votesByFacetIndex Per-(entityId, facet) vote bucket from
 *   `projectVotesByFacet(events)`. Defaults to an empty map so the
 *   handful of call sites that were authored before the sidebar
 *   indicator task landed continue to compile / behave as before
 *   (every entry's `votes` field collapses to `EMPTY_VOTES`).
 *   Refinement: `mod_vote_indicators_in_sidebar`.
 * @returns The facet entries the breakdown component renders. Always at
 *   least one entry (Decision §7 — facet-targeting sub-kinds emit one
 *   real facet entry, structural sub-kinds emit one synthetic
 *   `'proposal'` entry).
 */
export function derivePerProposalFacets(
  proposal: ProposalPayload,
  facetStatusIndex: FacetStatusIndex,
  serverPerFacetStatus: Record<string, string> | undefined,
  votesByFacetIndex: VotesByFacetIndex = EMPTY_VOTES_BY_FACET_INDEX,
  proposalEventId?: string,
  votesByProposalIndex: VotesByProposalIndex = EMPTY_VOTES_BY_PROPOSAL_INDEX,
): readonly ProposalFacetEntry[] {
  const target = facetTargetOf(proposal);
  if (target) {
    const status = resolveStatus(target.facet, target, facetStatusIndex, serverPerFacetStatus);
    // Lookup keyed by `entityId` (node id OR edge id — UUIDs are
    // disjoint by construction; the projection extension in
    // Decision §4 unifies node and edge buckets under the same
    // outer map). The shared `EMPTY_VOTES` reference keeps React /
    // memoization stable for the common no-votes-yet case.
    const votes = votesByFacetIndex.get(target.entityId)?.get(target.facet) ?? EMPTY_VOTES;
    return [
      {
        facet: target.facet,
        status,
        labelKey: labelKeyFor(target.facet),
        votes,
      },
    ];
  }
  // Structural sub-kind (or unknown) — one synthetic lifecycle entry.
  // Status resolution still consults the server frame (a future
  // broadcast tightening may carry a `'proposal'` keyed status); the
  // client-mirror lookup is skipped because the mirror does not track
  // structural proposals.
  //
  // Per commit `421353f` the server's `checkUnanimousAgreeStructural`
  // walks the pending proposal's `perParticipantVotes` map. On the
  // client side we mirror that map by projecting per-proposal votes
  // off the event log (see `projectVotesByProposal` in
  // `apps/moderator/src/graph/selectors.ts`). When the caller threads
  // the proposal's envelope id + the projection, the structural
  // entry's `votes` field surfaces the per-participant arms;
  // `deriveAllAgree` walks them for the commit gate. Older callers
  // that pre-date this extension pass neither — the `votes` field
  // collapses to `EMPTY_VOTES` (the historical behaviour) and the
  // commit gate falls back to `participants-not-voted` until the
  // caller threads the new arguments through.
  const status = resolveStatus('proposal', null, facetStatusIndex, serverPerFacetStatus);
  const votes =
    proposalEventId !== undefined
      ? (votesByProposalIndex.get(proposalEventId) ?? EMPTY_VOTES)
      : EMPTY_VOTES;
  return [
    {
      facet: 'proposal',
      status,
      labelKey: labelKeyFor('proposal'),
      votes,
    },
  ];
}

// ---------------------------------------------------------------------
// Commit-gate predicate
//
// Refinement: tasks/refinements/moderator-ui/mod_commit_button.md
//
// The per-row commit button reads `deriveAllAgree(entries,
// currentParticipantIds)` to decide its enabled-or-not state. The
// predicate mirrors the engine's `commitHandler` rule 4 (unanimous
// agree across current participants for the four facet-targeting
// sub-kinds; structural sub-kinds rejected with
// `'illegal-state-transition'`) — Decision §1.
//
// The connection-status check (`session-not-connected`) is an OUTER
// gate the row component applies BEFORE calling this predicate — see
// Decision §1.b. The reason is included in the union so the row
// component can surface a uniform `CommitGateReason` shape regardless
// of whether the gate is "internal" (per-row vote state) or "outer"
// (session-level connection).
//
// Pure: no closure over time, no `Date.now()`, no `Math.random()`.
// ---------------------------------------------------------------------

/**
 * Discriminated set of blocking reasons surfaced to the row component
 * so it can render the localized tooltip text (one ICU `select` key
 * with six arms — see `moderator.commitButton.reason`).
 *
 * Priority order (the FIRST blocking reason wins; the row component
 * checks `session-not-connected` first, then this predicate fires the
 * remaining reasons in the order declared below):
 *
 *   1. `'session-not-connected'` — outer gate; not produced by
 *      `deriveAllAgree` (the predicate has no business reading the WS
 *      connection status). Included in the union for the row
 *      component to surface uniformly.
 *   2. `'proposal-meta-disagreement'` — any entry's `status` is
 *      `'meta-disagreement'`. Cannot commit until the moderator
 *      resolves the meta-disagreement (out-of-scope flow).
 *   3. `'no-current-participants'` — no debaters joined (defensive;
 *      the engine would degenerate to true over the empty set, but
 *      the moderator's intent on an empty session is ambiguous).
 *   4. `'participants-not-voted'` — some current participant has no
 *      vote on some facet.
 *   5. `'participants-disagree'` — some current participant has voted
 *      `'dispute'` or `'withdraw'` on some facet.
 *
 * Historical `'structural-sub-kind-not-supported'` arm: kept in the
 * union for back-compat with the i18n catalog (one ICU `select` key
 * with six arms). Per commit `421353f` the server's commit handler now
 * accepts every structural sub-kind via `checkUnanimousAgreeStructural`
 * — `deriveAllAgree` no longer returns this reason for known structural
 * proposals (the predicate walks the proposal's per-participant votes
 * the same way the server does). The arm continues to exist for the
 * rare case of an unknown / synthetic `'proposal'` entry that the
 * caller did not thread per-proposal vote context for; in that
 * defensive branch the predicate falls through to
 * `'participants-not-voted'` (no votes recorded), not this reason.
 */
export type CommitGateReason =
  | 'session-not-connected'
  | 'proposal-meta-disagreement'
  | 'no-current-participants'
  | 'participants-not-voted'
  | 'participants-disagree'
  | 'structural-sub-kind-not-supported';

/**
 * Discriminated result of the commit-gate predicate. `ok: true` means
 * every entry has every current participant voting `'agree'`; `ok:
 * false` carries the highest-priority blocking reason.
 */
export type CommitGate =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: CommitGateReason };

/**
 * Pure predicate evaluating "is every current participant voting
 * `'agree'` on every facet of this proposal?". Sub-rules:
 *
 *   - The moderator's own vote does NOT count — the caller supplies a
 *     `currentParticipantIds` set already filtered to non-moderator
 *     roles (see `deriveCurrentParticipants`).
 *   - `'withdraw'` blocks commit the same as `'dispute'` (the
 *     methodology engine requires explicit `'agree'`).
 *   - Structural sub-kinds (the synthetic `'proposal'` lifecycle
 *     entry) follow the same unanimity rule as facet-targeting
 *     sub-kinds — per commit `421353f` the server's
 *     `checkUnanimousAgreeStructural` walks the pending proposal's
 *     `perParticipantVotes` map; the client mirrors that map via
 *     `projectVotesByProposal` and the entry's `votes` field carries
 *     it. The historical `'structural-sub-kind-not-supported'` short
 *     circuit is gone — the predicate dispatches purely on `entry.votes`.
 *   - Meta-disagreement-marked entries get the
 *     `'proposal-meta-disagreement'` reason regardless of vote state.
 *   - Axiom-mark special case: per docs/methodology.md § "Axioms /
 *     terminal values", the participant whose bedrock is being declared
 *     is the proposer; their proposal IS the declaration. The required
 *     set excludes them — only the other current participants need to
 *     vote agree. The server's `checkUnanimousAgreeStructural` applies
 *     the same exclusion; the client predicate mirrors it when the
 *     caller passes the proposal payload.
 *
 * @param entries The per-facet entries from `derivePerProposalFacets`.
 * @param currentParticipantIds The set of current non-moderator
 *   participant ids (from `deriveCurrentParticipants`).
 * @param proposal Optional proposal payload — when supplied AND the
 *   proposal is an `axiom-mark`, the declared participant is excluded
 *   from the required-voters set. When omitted, no exclusion applies
 *   (legacy behaviour; safe for facet-targeting sub-kinds and for
 *   non-axiom-mark structural sub-kinds).
 */
export function deriveAllAgree(
  entries: readonly ProposalFacetEntry[],
  currentParticipantIds: ReadonlySet<string>,
  proposal?: ProposalPayload,
): CommitGate {
  // Priority 1: meta-disagreement on any entry — even if every vote is
  // `'agree'`, the proposal cannot commit until the moderator resolves
  // the meta-disagreement. Walk all entries first (the cheap structural
  // check) so the reason wins over the per-participant checks.
  for (const entry of entries) {
    if (entry.status === 'meta-disagreement') {
      return { ok: false, reason: 'proposal-meta-disagreement' };
    }
  }
  // Apply the axiom-mark exclusion to the required set: per
  // docs/methodology.md, the declared participant doesn't vote on
  // their own bedrock declaration (their proposal IS the
  // declaration). Mirrors `checkUnanimousAgreeStructural`'s
  // `excludedParticipant` filter on the server side.
  const requiredParticipantIds =
    proposal?.kind === 'axiom-mark'
      ? new Set([...currentParticipantIds].filter((id) => id !== proposal.participant))
      : currentParticipantIds;
  // Priority 2: no debaters required to vote — this can fire for an
  // empty session OR an axiom-mark debate where only the declared
  // participant is present (the exclusion drains the required set).
  if (requiredParticipantIds.size === 0) {
    return { ok: false, reason: 'no-current-participants' };
  }
  // Priorities 3 + 4: walk participants × entries. The first missing
  // vote wins over the first disagree vote (caller-facing tooltip
  // priority), so we walk in two passes.
  for (const entry of entries) {
    const voters = new Set<string>();
    for (const vote of entry.votes) voters.add(vote.participantId);
    for (const participantId of requiredParticipantIds) {
      if (!voters.has(participantId)) {
        return { ok: false, reason: 'participants-not-voted' };
      }
    }
  }
  for (const entry of entries) {
    for (const vote of entry.votes) {
      if (!requiredParticipantIds.has(vote.participantId)) continue;
      if (vote.choice !== 'agree') {
        return { ok: false, reason: 'participants-disagree' };
      }
    }
  }
  return { ok: true };
}

/**
 * Walk the session's event log once and return the set of currently
 * joined NON-moderator participant ids. The pane memoizes this on the
 * same `events` reference as `facetStatusIndex` and
 * `votesByFacetIndex` so the cost is one O(events) pass per pane
 * render shared across all rows.
 *
 * Sub-rules (Decision §1.a):
 *
 *   - The moderator's role is excluded — the engine's
 *     `currentParticipants` helper does the same. Only `'debater-A'`
 *     and `'debater-B'` count toward unanimity.
 *   - `'participant-left'` cancels a prior `'participant-joined'` for
 *     the same user id; a subsequent rejoin re-adds them.
 *   - Pure: no closure over time, no `Date.now()`.
 */
export function deriveCurrentParticipants(events: readonly Event[]): ReadonlySet<string> {
  const current = new Set<string>();
  for (const event of events) {
    if (event.kind === 'participant-joined') {
      // Exclude the moderator — only debaters vote (Decision §1.a).
      if (event.payload.role === 'moderator') continue;
      current.add(event.payload.user_id);
      continue;
    }
    if (event.kind === 'participant-left') {
      current.delete(event.payload.user_id);
    }
  }
  return current;
}
