// Methodology engine types — the action vocabulary, the validation
// result shape, and the rejection reason set.
//
// Refinement: tasks/refinements/data-and-methodology/agreement_state_machine.md
// TaskJuggler: data_and_methodology.methodology_engine.agreement_state_machine
//
// The methodology engine is the write-side complement of the
// projection's read-side `deriveFacetStatus`. The API layer
// constructs a `MethodologyAction` from an authenticated request,
// calls `validateAction(projection, action)`, and on `Valid` writes
// the resulting events to `session_events`.
//
// Per-action specifics (commit-requires-unanimous-agree, withdrawal-
// requires-prior-agree, etc.) are owned by the eight sibling
// `methodology_engine.*` tasks. This module owns the framework — the
// shared types those siblings consume.

import type { EventKind, PayloadFor, ProposalPayload } from '@a-conversa/shared-types';
import type { ParticipantRecord, PerParticipantVote } from '../projection/index.js';
import type { FacetName } from '../projection/types.js';

// ---------------------------------------------------------------
// Action vocabulary.
//
// Four broad action kinds matching the four event-emitting paths in
// the methodology:
//
//   - `propose` — produces a `proposal` event carrying any of the 11
//     proposal sub-kinds.
//   - `vote` — produces a `vote` event (`agree` / `dispute` /
//     `withdraw`) against an existing proposal.
//   - `commit` — produces a `commit` event; moderator commits a
//     pending proposal.
//   - `mark-meta-disagreement` — produces a
//     `meta-disagreement-marked` event; moderator marks a proposal
//     unresolvable.
//
// Each variant carries the API-layer-minted envelope fields (`eventId`,
// `sequence`, `actor`, `createdAt`) so the engine can construct a
// complete `EventToAppend` for the API layer to insert. Siblings may
// tighten the per-sub-kind shape (e.g. a `commit` for a specific
// proposal sub-kind) as their refinements settle; for this foundation
// task the broad shape suffices.
// ---------------------------------------------------------------

export type ActionKind = 'propose' | 'vote' | 'commit' | 'mark-meta-disagreement';

export interface ActionEnvelopeBase {
  /** Authenticated user id of the requester. The API layer sets this. */
  requester: string;
  /** Owning session id; must match `projection.sessionId`. */
  sessionId: string;
  /** Candidate event id (UUID). The API layer mints this. */
  eventId: string;
  /** Candidate sequence — must equal `projection.lastAppliedSequence + 1`. */
  sequence: number;
  /**
   * Causing actor for the resulting event. Typically the requester;
   * separated to allow system-generated events later. The API layer
   * sets this; the engine does not reinterpret it.
   */
  actor: string | null;
  /** Server-clock event creation time (ISO-8601). The API layer sets this. */
  createdAt: string;
}

export interface ProposeAction extends ActionEnvelopeBase {
  kind: 'propose';
  proposal: ProposalPayload;
}

// Vote actions are a discriminated union over `target` mirroring the
// wire envelope (per ADR 0030 §2 + §9). The facet arm names the
// `(entityKind, entityId, facet)` triple directly — no proposal
// roundtrip is needed because the methodology treats agreement as a
// property of the facet itself (`facet.perParticipant` is the
// canonical record). The proposal arm names a structural proposal id
// (decompose / interpretive-split / axiom-mark / annotate / meta-move
// / break-edge / amend-node) where there is no facet target the vote
// could attach to.
//
// **Why the facet arm has no proposal id.** Some facets enter life
// with an inline candidate that is NOT driven by a proposal targeting
// that facet — e.g. an edge's `shape` facet is seeded inline on
// `edge-created` per ADR 0030 §5, and the `wording` facet's candidate
// rides inline on `node-created` for `capture-node`. Threading a
// proposal id through the facet arm forced the WS layer to manufacture
// one by walking the event log for "a proposal that drives this
// facet"; for inline-seeded facets the walk returned `null` and the
// vote was rejected with `proposal-not-found` (the bug fixed in this
// refactor). Dropping the proposal id from the facet arm removes the
// manufactured-lookup step entirely.
export interface VoteActionFacet extends ActionEnvelopeBase {
  kind: 'vote';
  target: 'facet';
  // `'annotation'` per ADR 0038 §1: a committed annotation's `substance`
  // facet is disputable post-commit via the facet-keyed vote arm.
  entityKind: 'node' | 'edge' | 'annotation';
  entityId: string;
  facet: FacetName;
  vote: PerParticipantVote;
  /** ISO-8601 — payload-level vote timestamp; defaults to `createdAt` if the API layer doesn't set it explicitly. */
  votedAt: string;
}

export interface VoteActionProposal extends ActionEnvelopeBase {
  kind: 'vote';
  target: 'proposal';
  proposalEventId: string;
  vote: PerParticipantVote;
  /** ISO-8601 — payload-level vote timestamp; defaults to `createdAt` if the API layer doesn't set it explicitly. */
  votedAt: string;
}

export type VoteAction = VoteActionFacet | VoteActionProposal;

// Commit actions mirror VoteAction's discriminated-union shape for the
// same reason: facet-arm commits address the facet directly via the
// projection's facet-keyed commit handler (`handleCommit`'s facet arm,
// which sweeps any pending proposals targeting the facet); proposal-arm
// commits address structural sub-kinds by proposal id.
export interface CommitActionFacet extends ActionEnvelopeBase {
  kind: 'commit';
  target: 'facet';
  entityKind: 'node' | 'edge';
  entityId: string;
  facet: FacetName;
  /** ISO-8601 — payload-level commit timestamp; defaults to `createdAt` if the API layer doesn't set it explicitly. */
  committedAt: string;
}

export interface CommitActionProposal extends ActionEnvelopeBase {
  kind: 'commit';
  target: 'proposal';
  proposalEventId: string;
  /** ISO-8601 — payload-level commit timestamp; defaults to `createdAt` if the API layer doesn't set it explicitly. */
  committedAt: string;
}

export type CommitAction = CommitActionFacet | CommitActionProposal;

export interface MarkMetaDisagreementAction extends ActionEnvelopeBase {
  kind: 'mark-meta-disagreement';
  proposalEventId: string;
  /** ISO-8601 — payload-level mark timestamp; defaults to `createdAt` if the API layer doesn't set it explicitly. */
  markedAt: string;
}

export type MethodologyAction =
  | ProposeAction
  | VoteAction
  | CommitAction
  | MarkMetaDisagreementAction;

// ---------------------------------------------------------------
// `EventToAppend` — the engine's output shape.
//
// Mirrors `EventEnvelope` from `@a-conversa/shared-types` exactly:
// `EventToAppendEnvelope<K>` is the per-kind shape; `EventToAppend`
// is the distributive discriminated union over `EventKind` so a
// `switch (ev.kind)` narrows `ev.payload` to the per-kind type
// (matching the `Event` type from shared-types). The API layer
// takes `valid.events` and inserts them into `session_events` in
// order. Multi-event actions (e.g. decompose's structural fan-out
// — owned by `decomposition_logic`) emit several entries; the
// engine is responsible for sequencing them correctly so each
// event's `sequence` advances by 1.
// ---------------------------------------------------------------

export interface EventToAppendEnvelope<K extends EventKind> {
  id: string;
  sessionId: string;
  sequence: number;
  kind: K;
  actor: string | null;
  payload: PayloadFor<K>;
  createdAt: string;
}

export type EventToAppend = {
  [K in EventKind]: EventToAppendEnvelope<K>;
}[EventKind];

// ---------------------------------------------------------------
// `ValidationResult` — the engine's return shape.
//
// Discriminated on `ok`. `Valid` carries the events to append;
// `Rejected` carries the typed reason and a human-readable detail
// for surfacing to the requester.
// ---------------------------------------------------------------

export interface ValidValidationResult {
  ok: true;
  events: ReadonlyArray<EventToAppend>;
}

export interface RejectedValidationResult {
  ok: false;
  reason: RejectionReason;
  detail: string;
}

export type ValidationResult = ValidValidationResult | RejectedValidationResult;

// ---------------------------------------------------------------
// `RejectionReason` — typed rejection reasons.
//
// Spans what the eight sibling `methodology_engine.*` tasks will
// need; siblings may add to this union as their refinements settle
// additional cases. Each value is paired with a `detail: string` in
// `RejectedValidationResult` so the requester sees both the typed
// code and a specific human-readable message.
// ---------------------------------------------------------------

export type RejectionReason =
  // Universal — checked by the engine itself before dispatch.
  | 'not-a-participant'
  | 'sequence-mismatch'
  | 'session-mismatch'
  // Role-gated — used by `commit_logic` and `meta_disagreement_logic`.
  | 'not-a-moderator'
  // Role-gated, WS-layer flavor — owned by
  // `backend.websocket_protocol.ws_label_snapshot_message`. The
  // label-snapshot WS handler synthesizes this reason for a
  // non-moderator subscribed participant attempting to mint a
  // snapshot. Distinct from `'not-a-moderator'` (the engine's reason
  // word) per `mod_snapshot_label_input.md`'s wire-error vocabulary —
  // the modal's i18n key for the role-gate fail is canonicalised as
  // `'moderator-only'`. See
  // `tasks/refinements/backend/ws_label_snapshot_message.md`
  // Decision §4 for the vocabulary-unification rationale (deferred to
  // a future project-wide rename).
  | 'moderator-only'
  // Proposal-reference — used by `vote`, `commit`, and `mark-meta-disagreement`.
  | 'proposal-not-found'
  | 'proposal-not-pending'
  | 'proposal-already-committed'
  | 'proposal-already-meta-disagreement'
  // Entity-reference — used by propose-side validators that target an
  // existing graph entity (decompose's parent node, break-edge's edge,
  // axiom-mark's node, etc.). Added by `decomposition_logic`; reused by
  // sibling propose-sub-kind validators as they land.
  | 'target-entity-not-found'
  // Vote-specific — owned by `commit_logic`, `withdrawal_logic`,
  // `vote_logic` (siblings).
  | 'already-voted'
  | 'no-prior-agree'
  | 'self-vote-not-allowed'
  | 'unanimous-agree-required'
  // Propose-axiom-mark specific — owned by `axiom_mark_logic`. The rule
  // is "the requester must be the same as the participant whose
  // bedrock is being declared." A separate code from
  // `'self-vote-not-allowed'` because the two have opposite semantic
  // shape: `'self-vote-not-allowed'` would mean "you cannot act on
  // something that is yours" (the historical reservation); this code
  // means "you can only act on something that is yours." See
  // `axiom_mark_logic.md` "Decisions" for the alternatives considered.
  | 'axiom-mark-not-self'
  // Methodology-flow — owned by sibling tasks.
  | 'inapplicable-to-facet'
  | 'illegal-state-transition'
  | 'methodology-not-exhausted'
  // Per-facet sequence-gate — owned by
  // `per_facet_refactor.server_handlers.pf_sequence_gate_server_enforced`
  // per [ADR 0030 §8](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md):
  // the server is the integrity boundary that refuses out-of-sequence
  // facet-valued proposals. A `classify-node` targeting a node whose
  // `wording` facet is not `agreed`/`committed`, a `set-node-substance`
  // targeting a node whose `classification` facet is not
  // `agreed`/`committed`, or a `set-edge-substance` targeting an edge
  // whose `shape` facet is not `agreed`/`committed`, are refused with
  // this typed reason. Distinct from `'illegal-state-transition'`
  // because the proposal is structurally valid; it's the predecessor
  // facet whose state forbids advancing — the kebab name reads
  // honestly at the wire ("the facet sequence is out of order"). The
  // `detail` string names the offending facet + its current status
  // (e.g. `"propose classify-node refused: node X's wording facet is
  // 'proposed' (must be agreed or committed)"`) so debugging clients
  // (and the future i18n surface) can branch on the exact predecessor.
  | 'facet-sequence-out-of-order'
  // Participant-assignment specific — owned by
  // `backend.session_management.participant_assignment`. The four codes
  // cover the failure modes of `POST /sessions/:id/participants` (the
  // role slot is occupied; the user already holds an active role; the
  // userId in the body doesn't resolve to a non-deleted user) and
  // `DELETE /sessions/:id/participants/:userId` (the active participant
  // row is the moderator — the host is bound to the session for its
  // lifetime and cannot be removed via this endpoint). See
  // `tasks/refinements/backend/participant_assignment.md` for status-
  // mapping rationale.
  | 'role-already-filled'
  | 'user-already-joined'
  | 'user-not-found'
  | 'cannot-remove-moderator'
  // Entity-inclusion specific — owned by
  // `backend.cross_session_permissions.entity_inclusion_endpoint`. The
  // two codes cover the failure modes of `POST /sessions/:id/include`
  // that the existing universal reasons don't already capture:
  //   - `entity-not-referenceable` (403): the caller cannot reach the
  //     source entity through any visible origin session (the source-
  //     side `canReference<Kind>` predicate returned false). This is an
  //     authority failure, parallel to `not-a-participant`.
  //   - `entity-already-included` (409): the entity is already in the
  //     destination session (caught via the `ON CONFLICT DO NOTHING`
  //     collapse on the composite-PK join-table INSERT). The duplicate
  //     attempt is rejected with a typed conflict rather than a silent
  //     200 no-op, matching the "no silent no-ops" pattern the other
  //     session-management endpoints follow. See
  //     `tasks/refinements/backend/entity_inclusion_endpoint.md` for
  //     the 403-vs-404 and 409-vs-200-idempotent rationale.
  | 'entity-not-referenceable'
  | 'entity-already-included'
  // Snapshot-label specific — owned by
  // `data_and_methodology.methodology_engine.snapshot_create_logic`.
  // Emitted by the standalone `createSnapshot` helper when the
  // moderator-supplied label fails the trim / non-empty / length-cap
  // rule set. Distinct from `'illegal-state-transition'` because the
  // snapshot itself is legal — only the label is invalid. See
  // `tasks/refinements/data-and-methodology/snapshot_create_logic.md`
  // Decisions §4.
  | 'invalid-label';

// ---------------------------------------------------------------
// `RequireResult<T>` — the discriminated result shape returned by
// `requireParticipant` / `requireModerator`. Mirrors the
// `ValidationResult` discriminator (`ok: true | false`) so callers
// can `if (result.ok) return result.rejection;` cleanly.
// ---------------------------------------------------------------

export interface RequireSuccess<T> {
  ok: true;
  record: T;
}

export interface RequireFailure {
  ok: false;
  rejection: RejectedValidationResult;
}

export type RequireResult<T> = RequireSuccess<T> | RequireFailure;

// Convenience alias — the most common `RequireResult` use case.
export type RequireParticipantResult = RequireResult<ParticipantRecord>;

// ---------------------------------------------------------------
// `Validator<TAction>` — the per-action handler contract.
//
// Sibling tasks register their tightened handlers via
// `registerActionHandler(kind, handler)` (engine.ts). The handler
// returns a `ValidationResult` for the specific action; the engine's
// `validateAction` runs universal checks before dispatch.
// ---------------------------------------------------------------

import type { Projection } from '../projection/index.js';

export type Validator<TAction extends MethodologyAction> = (
  projection: Projection,
  action: TAction,
) => ValidationResult;

// Per-kind handler-type lookup. Siblings tighten by importing the
// specific action subtype (e.g. `Validator<CommitAction>`).
export type ActionHandlerFor<K extends ActionKind> = K extends 'propose'
  ? Validator<ProposeAction>
  : K extends 'vote'
    ? Validator<VoteAction>
    : K extends 'commit'
      ? Validator<CommitAction>
      : K extends 'mark-meta-disagreement'
        ? Validator<MarkMetaDisagreementAction>
        : never;
