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
  MethodologyAction,
  RejectedValidationResult,
  ValidationResult,
} from './types.js';
import { requireParticipant } from './primitives.js';
import { commitHandler } from './handlers/commit.js';
import { placeholderProposeHandler } from './handlers/propose.js';
import { placeholderVoteHandler } from './handlers/vote.js';
import { placeholderMarkMetaDisagreementHandler } from './handlers/markMetaDisagreement.js';

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

// Reset to default handlers. Test-only. Called from `engine.test.ts`
// after a test that installs a custom handler so later tests see the
// default state. Not part of the public API (still exported because
// the test file is in-tree; siblings should register-not-reset).
export function resetActionHandlers(): void {
  handlers.clear();
  installHandlers();
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
// Default handler installation.
//
// Per-action handler logic lives under `./handlers/`. Each file
// exports a `Validator<TAction>`; this function wires them into the
// registry at module init.
//
// **Current state.** `commitHandler` is the real write-side validator
// (per `commit_logic` — moderator-only, proposal-pending, unanimous-
// agree-across-current-participants). The other three are placeholders
// that pass universal checks and emit a single `EventToAppend` from
// the action payload — sibling tasks (`vote_logic`,
// `meta_disagreement_logic`, proposal-specific) will replace them.
// ---------------------------------------------------------------

function installHandlers(): void {
  registerActionHandler('propose', placeholderProposeHandler);
  registerActionHandler('vote', placeholderVoteHandler);
  registerActionHandler('commit', commitHandler);
  registerActionHandler('mark-meta-disagreement', placeholderMarkMetaDisagreementHandler);
}

installHandlers();

// ---------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------

function reject(
  reason: RejectedValidationResult['reason'],
  detail: string,
): RejectedValidationResult {
  return { ok: false, reason, detail };
}
