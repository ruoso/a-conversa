// `useVoteAction({ proposalId })` — the participant's per-pending-proposal
// vote-action React hook. Lives next to `<EntityDetailPanel>` because the
// panel's `actionSlot` is the (only) consumer today.
//
// Refinement: `tasks/refinements/participant-ui/part_voting.md` (parent
//             task in `tasks/40-participant-ui.tji` — `part_voting`,
//             with sub-leaves `part_vote_button_per_facet` +
//             `part_vote_single_tap`). This hook owns the wire-action
//             half (Decision: mirror `useCommitAction` exactly — the
//             two surfaces share the same per-target idiom).
//
// Mirrors `apps/moderator/src/layout/useCommitAction.ts` line-for-line
// adapted for the participant surface:
//
//   - Per-`proposalId` keying — two facet rows targeting the SAME
//     proposal-event-id (e.g. an `amend-node` proposal whose underlying
//     event-id is the same across all three facets) share one in-flight
//     slot. Two DIFFERENT proposalIds (the typical case — each facet
//     has its own pending proposal) hold disjoint in-flight + error
//     state.
//   - Pessimistic-wait. The vote button does NOT optimistically clear
//     the local `useVoteStore` pending-vote slot — the row's "Your
//     vote" badge updates naturally when the `event-applied` broadcast
//     lands and the `ownVotes` projector picks up the new arm. Symmetric
//     with the moderator's commit pattern (per `useCommitAction`'s
//     Decision §5).
//   - The hook owns NO validation gate — the participant surface does
//     not pre-validate vote eligibility (the methodology engine
//     enforces). The in-flight guard is the only gate.
//
// Wire payload (per `packages/shared-types/src/ws-envelope.ts:447`):
//
//   { sessionId, expectedSequence, proposalId, choice }
//
// where `choice` is one of `'agree' | 'dispute' | 'withdraw'`. The
// authenticated user is the voter — no `participantId` on the wire (the
// server reads it from `connection.user.id`, same shape as `commit` +
// `propose`).
//
// ADRs:
//   - 0003 (React);
//   - 0021 (envelope discriminated union — the typed `'vote'` arm of
//           `WsMessagePayloadMap` is the wire contract);
//   - 0022 (no throwaway verifications — the unit tests in
//           `useVoteAction.test.tsx` lock in the per-call contract);
//   - 0024 (i18n via react-i18next — the localized timeout fallback
//           lands via `useTranslation()`).

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';

import { useWsStore } from '../ws/wsStore';

/**
 * The three wire arms a vote can carry. Mirrors `wsVotePayloadSchema`'s
 * `choice` enum verbatim (`'agree' | 'dispute' | 'withdraw'`); the
 * post-commit `'withdraw'` arm IS in scope here per the hook's role as
 * the canonical wire-cast — withdrawal flows through the same envelope
 * type. (The pre-commit local `useVoteStore` slice only carries
 * `'agree' | 'dispute'` because withdrawal is a post-commit gesture
 * that bypasses the pending-vote slot entirely.)
 */
export type VoteChoice = 'agree' | 'dispute' | 'withdraw';

/**
 * Wire-error shape surfaced on `lastError`. Redeclared locally (rather
 * than imported from `useCommitAction`) so the participant hook stays
 * independently consumable across workspace edges — symmetric with
 * `useCommitAction`'s own redeclaration off `useProposeAction`.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseVoteActionResult {
  /**
   * Trigger the vote round-trip for the bound `proposalId` with the
   * named `choice`. Idempotent during the in-flight window (a concurrent
   * call while the prior round-trip is in flight is a no-op).
   */
  castVote: (choice: VoteChoice) => Promise<void>;
  /** True while a vote for this `proposalId` is in flight. */
  inFlight: boolean;
  /** Wire error from the last failed vote for this `proposalId`, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice tracking per-`proposalId` in-flight vote
 * state + the last wire error per `proposalId`. Lives outside React so
 * two `useVoteAction({ proposalId })` call sites for the same id share
 * state. Mirrors `useCommitStore` exactly — disjoint by construction
 * between different `proposalId`s; no React provider; no devtools wiring.
 */
interface VoteActionState {
  readonly voting: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setVoting: (proposalId: string, flag: boolean) => void;
  readonly setError: (proposalId: string, error: WireError | undefined) => void;
}

export const useVoteActionStore = create<VoteActionState>((set) => ({
  voting: new Set<string>(),
  errors: new Map<string, WireError>(),
  setVoting: (proposalId: string, flag: boolean) =>
    set((state) => {
      const next = new Set(state.voting);
      if (flag) next.add(proposalId);
      else next.delete(proposalId);
      return { voting: next };
    }),
  setError: (proposalId: string, error: WireError | undefined) =>
    set((state) => {
      const next = new Map(state.errors);
      if (error === undefined) next.delete(proposalId);
      else next.set(proposalId, error);
      return { errors: next };
    }),
}));

/**
 * Test seam — lets test suites reset the module-scoped vote-action
 * slice between cases without poking the store's internals. Mirrors
 * `resetCommitStore`.
 */
export function resetVoteActionStore(): void {
  useVoteActionStore.setState({
    voting: new Set<string>(),
    errors: new Map<string, WireError>(),
  });
}

/**
 * Map any thrown error to the `WireError` surface. `WsRequestError`
 * carries the server's typed payload verbatim; `WsRequestTimeoutError`
 * gets a localized fallback message; anything else lands as
 * `'unknown'`. The `timeoutText` is pre-resolved by the caller so the
 * function stays React-free and easy to test. Mirrors
 * `useCommitAction`'s `toWireError`.
 */
function toWireError(err: unknown, timeoutText: string): WireError {
  if (err instanceof WsRequestError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof WsRequestTimeoutError) {
    return { code: 'timeout', message: timeoutText };
  }
  if (err instanceof Error) {
    return { code: 'unknown', message: err.message };
  }
  return { code: 'unknown', message: String(err) };
}

export interface UseVoteActionArgs {
  readonly proposalId: string;
}

/**
 * The per-proposal vote-action hook. Accepts the bound `proposalId`
 * (the pending-proposal event id) and returns the imperative
 * `castVote()` callback + observable `inFlight` / `lastError` slices.
 *
 * Per-`proposalId` selector subscriptions keep each button's re-render
 * scope narrow — a vote on proposal A does not re-render proposal B's
 * buttons. The hook is callable from any participant component; today
 * the only consumer is the `<ParticipantVoteButtons>` row mounted into
 * `<EntityDetailPanel>`'s `actionSlot`.
 */
export function useVoteAction(args: UseVoteActionArgs): UseVoteActionResult {
  const { proposalId } = args;
  const { t } = useTranslation();

  // Session-id read off the route param (same as the moderator's
  // `useCommitAction` — the participant routes use the same `/:id`
  // segment per `OperateRoute.tsx`).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  // Per-`proposalId` slice subscriptions — each call returns a
  // primitive / referentially-stable value so Zustand's default
  // equality check re-renders the consumer only when THIS proposalId's
  // slice flips.
  const inFlight = useVoteActionStore((s) => s.voting.has(proposalId));
  const lastError = useVoteActionStore((s) => s.errors.get(proposalId));

  async function castVote(choice: VoteChoice): Promise<void> {
    // In-flight guard — a concurrent click while the prior round-trip
    // is still in flight is a no-op. Mirrors `useCommitAction`'s gate.
    if (useVoteActionStore.getState().voting.has(proposalId)) {
      return;
    }

    // Flip in-flight + clear any prior error for this `proposalId`.
    // The order matters: a test that asserts the in-flight visual
    // immediately after the click observes the post-flip state.
    const store = useVoteActionStore.getState();
    store.setVoting(proposalId, true);
    store.setError(proposalId, undefined);

    try {
      // Build the canonical `vote` payload. The four fields match
      // `wsVotePayloadSchema` exactly — no `participantId` (the server
      // reads it from the authenticated connection per
      // `ws_vote_message`).
      const expectedSequence =
        useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
      await client.send('vote', {
        sessionId,
        expectedSequence,
        proposalId,
        choice,
      });

      // Success — the `voted` ack landed; the broadcast `event-applied`
      // for the `vote` event will arrive (the server broadcasts BEFORE
      // replying the ack per the ws protocol). The `ownVotes` projector
      // will pick up the new arm and the panel's "Your vote" badge
      // updates naturally. Remove `proposalId` from the in-flight set.
      useVoteActionStore.getState().setVoting(proposalId, false);
    } catch (err) {
      // Failure — the methodology engine rejected, or the request timed
      // out. Remove `proposalId` from in-flight; surface the wire error
      // inline. The user can retry by re-clicking (which also clears
      // the error before the next attempt — symmetric with the
      // moderator's commit button).
      const timeoutText = t('participant.voteButton.timeoutError');
      const store2 = useVoteActionStore.getState();
      store2.setVoting(proposalId, false);
      store2.setError(proposalId, toWireError(err, timeoutText));
    }
  }

  return {
    castVote,
    inFlight,
    lastError,
  };
}
