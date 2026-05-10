// Methodology engine — `validateAction` dispatcher + sibling handler
// registry.
//
// Refinement: tasks/refinements/data-and-methodology/agreement_state_machine.md
// TaskJuggler: data_and_methodology.methodology_engine.agreement_state_machine
//
// **Dispatch shape.** Universal checks run inside `validateAction`
// itself (session match, sequence match, participant gate). On
// success the dispatcher looks up a per-action handler in the
// `handlers` map and forwards the action. Per-action handlers are
// owned by the eight sibling `methodology_engine.*` tasks
// (`commit_logic`, `withdrawal_logic`, etc.); this module registers
// permissive placeholder handlers for each kind at module-init so the
// framework is usable from day one. Siblings call
// `registerActionHandler(kind, handler)` from their own module-init
// to replace the placeholders.
//
// **Why a registry rather than a switch.** A plain switch would force
// every sibling to edit this file when they tighten their handler;
// the registry lets each sibling own its file. The registry is keyed
// on `ActionKind` (4 values) — small, exhaustive, stable.
//
// **Boundary with the API layer.** The API layer:
//   1. Authenticates the request, extracts the userId.
//   2. Loads the projection (cached or freshly built).
//   3. Constructs a `MethodologyAction` from the request.
//   4. Calls `validateAction(projection, action)`.
//   5. On `Valid`: appends the events to `session_events`, then
//      `applyEventIncremental` to the cached projection.
//   6. On `Rejected`: returns the typed reason to the requester.
//
// The engine does not write events; the API layer does.

import type { Projection } from '../projection/index.js';
import type {
  ActionHandlerFor,
  ActionKind,
  CommitAction,
  EventToAppendEnvelope,
  MarkMetaDisagreementAction,
  MethodologyAction,
  ProposeAction,
  RejectedValidationResult,
  ValidationResult,
  VoteAction,
} from './types.js';
import { requireParticipant } from './primitives.js';

// ---------------------------------------------------------------
// Handler registry.
// ---------------------------------------------------------------

type AnyActionHandler = (projection: Projection, action: MethodologyAction) => ValidationResult;

const handlers = new Map<ActionKind, AnyActionHandler>();

export function registerActionHandler<K extends ActionKind>(
  kind: K,
  handler: ActionHandlerFor<K>,
): void {
  handlers.set(kind, handler as AnyActionHandler);
}

export function getActionHandler<K extends ActionKind>(kind: K): ActionHandlerFor<K> | undefined {
  return handlers.get(kind) as ActionHandlerFor<K> | undefined;
}

// Reset to default placeholder handlers. Test-only. Called from
// `engine.test.ts` after a test that installs a custom handler so
// later tests see the default state. Not part of the public API
// (still exported because the test file is in-tree; siblings should
// register-not-reset).
export function resetActionHandlers(): void {
  handlers.clear();
  installDefaultHandlers();
}

// ---------------------------------------------------------------
// `validateAction` — public entry point.
// ---------------------------------------------------------------

export function validateAction(
  projection: Projection,
  action: MethodologyAction,
): ValidationResult {
  // Universal check 1: session id matches the projection.
  if (action.sessionId !== projection.sessionId) {
    return reject(
      'session-mismatch',
      `action.sessionId=${action.sessionId} does not match projection.sessionId=${projection.sessionId}`,
    );
  }

  // Universal check 2: sequence matches the next-expected. Pre-empts
  // the projection's `OutOfOrderEventError` so the API layer surfaces
  // a typed rejection instead of a thrown projection error.
  const expectedSequence = projection.lastAppliedSequence + 1;
  if (action.sequence !== expectedSequence) {
    return reject(
      'sequence-mismatch',
      `action.sequence=${action.sequence} does not match the next-expected sequence ${expectedSequence}`,
    );
  }

  // Universal check 3: requester is currently joined to this session.
  const participant = requireParticipant(projection, action.requester);
  if (!participant.ok) return participant.rejection;

  // Dispatch to the per-action handler.
  const handler = handlers.get(action.kind);
  if (!handler) {
    // Defensive — every action kind has a registered handler at
    // module-init. Reaching this branch means a programmer error
    // (a new ActionKind was added without a default).
    return reject(
      'illegal-state-transition',
      `no handler registered for action kind '${action.kind}'`,
    );
  }
  return handler(projection, action);
}

// ---------------------------------------------------------------
// Default placeholder handlers.
//
// Each handler pass-through emits a single `EventToAppend` constructed
// from the action's payload. They run after the universal checks
// already accepted the action; the placeholders do NOT add any
// methodology-specific rule. Sibling tasks register tighter handlers
// to replace these.
// ---------------------------------------------------------------

function placeholderPropose(_projection: Projection, action: ProposeAction): ValidationResult {
  const event: EventToAppendEnvelope<'proposal'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence,
    kind: 'proposal',
    actor: action.actor,
    payload: { proposal: action.proposal },
    createdAt: action.createdAt,
  };
  return { ok: true, events: [event] };
}

function placeholderVote(_projection: Projection, action: VoteAction): ValidationResult {
  const event: EventToAppendEnvelope<'vote'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence,
    kind: 'vote',
    actor: action.actor,
    payload: {
      proposal_id: action.proposalEventId,
      participant: action.requester,
      vote: action.vote,
      voted_at: action.votedAt,
    },
    createdAt: action.createdAt,
  };
  return { ok: true, events: [event] };
}

function placeholderCommit(_projection: Projection, action: CommitAction): ValidationResult {
  const event: EventToAppendEnvelope<'commit'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence,
    kind: 'commit',
    actor: action.actor,
    payload: {
      proposal_id: action.proposalEventId,
      moderator: action.requester,
      committed_at: action.committedAt,
    },
    createdAt: action.createdAt,
  };
  return { ok: true, events: [event] };
}

function placeholderMarkMetaDisagreement(
  _projection: Projection,
  action: MarkMetaDisagreementAction,
): ValidationResult {
  const event: EventToAppendEnvelope<'meta-disagreement-marked'> = {
    id: action.eventId,
    sessionId: action.sessionId,
    sequence: action.sequence,
    kind: 'meta-disagreement-marked',
    actor: action.actor,
    payload: {
      proposal_id: action.proposalEventId,
      moderator: action.requester,
      marked_at: action.markedAt,
    },
    createdAt: action.createdAt,
  };
  return { ok: true, events: [event] };
}

function installDefaultHandlers(): void {
  registerActionHandler('propose', placeholderPropose);
  registerActionHandler('vote', placeholderVote);
  registerActionHandler('commit', placeholderCommit);
  registerActionHandler('mark-meta-disagreement', placeholderMarkMetaDisagreement);
}

installDefaultHandlers();

// ---------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------

function reject(
  reason: RejectedValidationResult['reason'],
  detail: string,
): RejectedValidationResult {
  return { ok: false, reason, detail };
}
