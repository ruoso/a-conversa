// `useWithdrawProposalAction(proposalEventId)` — the participant's
// withdraw-proposal action React hook, one per pending-proposal row.
//
// Design doc: docs/ws-protocol.md § `withdraw-proposal`
// Wire schema: packages/shared-types/src/ws-envelope.ts
//              (`wsWithdrawProposalPayloadSchema`)
// Server handler: apps/server/src/ws/handlers/withdraw.ts
//
// Refinement: tasks/refinements/participant-ui/part_withdraw_proposal_gesture.md
//
// A near-verbatim port of the moderator hook
// (`apps/moderator/src/layout/useWithdrawProposalAction.ts`) per Decision
// §D2 — the two surfaces are independent micro-frontends (ADR 0026), and
// the standing moderator/participant `derivePendingProposals` duplication
// precedent (`part_proposal_list_view` §1) says duplication is deliberate
// until a third consumer (audience/replay) triggers a shell extraction.
// The only deltas from the moderator hook: the participant `useWsStore` /
// `useWsClient` imports and the `participant.withdrawProposalButton.*`
// timeout key.
//
// Per-row keying — two simultaneous withdraws on two different rows
// observe disjoint in-flight + error state.
//
// The wire payload is `{ sessionId, expectedSequence, proposalEventId }`
// per `wsWithdrawProposalPayloadSchema` — no `proposerId` field; the
// server reads `connection.user.id` and enforces the proposer-only
// gate (see `withdraw.ts`'s `forbidden` branch). A non-proposer attempt
// surfaces as `WsRequestError({ code: 'forbidden', ... })` on the
// rejection path; the UX guard in `PendingProposalsPane` hides the
// button when the current user is not the proposer to keep the
// happy-path branchless, but the server's gate is the authority.

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';

import { useWsStore } from '../ws/wsStore';

/**
 * Wire-error shape surfaced on `lastError`. Re-declared here (rather
 * than imported from a sibling hook) so the hook stays independently
 * consumable — mirrors the moderator hook's posture.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseWithdrawProposalActionResult {
  /** Trigger the withdraw round-trip for the bound proposalEventId. Idempotent during the in-flight window. */
  withdraw: () => Promise<void>;
  /** True while a withdraw for this proposalEventId is in flight. */
  inFlight: boolean;
  /** The wire-error code + message from the last failed withdraw for this proposalEventId, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice tracking per-proposalEventId in-flight
 * withdraw state + the last wire error per proposalEventId. Lives
 * outside React so two `useWithdrawProposalAction(proposalEventId)`
 * call sites for the same id share state. Disjoint by construction
 * between different proposalEventIds.
 */
interface WithdrawState {
  readonly withdrawing: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setWithdrawing: (proposalEventId: string, flag: boolean) => void;
  readonly setError: (proposalEventId: string, error: WireError | undefined) => void;
}

export const useWithdrawProposalStore = create<WithdrawState>((set) => ({
  withdrawing: new Set<string>(),
  errors: new Map<string, WireError>(),
  setWithdrawing: (proposalEventId: string, flag: boolean) =>
    set((state) => {
      const next = new Set(state.withdrawing);
      if (flag) next.add(proposalEventId);
      else next.delete(proposalEventId);
      return { withdrawing: next };
    }),
  setError: (proposalEventId: string, error: WireError | undefined) =>
    set((state) => {
      const next = new Map(state.errors);
      if (error === undefined) next.delete(proposalEventId);
      else next.set(proposalEventId, error);
      return { errors: next };
    }),
}));

/**
 * Test seam — let test suites reset the module-scoped withdraw slice
 * between cases without poking at the store's internals.
 */
export function resetWithdrawProposalStore(): void {
  useWithdrawProposalStore.setState({
    withdrawing: new Set<string>(),
    errors: new Map<string, WireError>(),
  });
}

/**
 * Map any thrown error to the `WireError` surface. The `timeoutText` is
 * pre-resolved by the caller so this function stays React-free and
 * easy to test.
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

/**
 * The per-row withdraw-action hook. Accepts the bound
 * `proposalEventId` (`row.proposalEventId` at the call site) and
 * returns the imperative `withdraw()` callback + observable
 * `inFlight` / `lastError` slices.
 *
 * Per-proposalEventId selector subscriptions keep each button's
 * re-render scope narrow — a withdraw on row A does not re-render
 * row B's button.
 */
export function useWithdrawProposalAction(
  proposalEventId: string,
): UseWithdrawProposalActionResult {
  const { t } = useTranslation();

  // Session-id read off the route param (same as the participant
  // vote/axiom-mark/withdraw-agreement hooks).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  // Per-proposalEventId slice subscriptions — each call returns a
  // primitive / referentially-stable value so Zustand's default
  // equality check re-renders the consumer only when THIS
  // proposalEventId's slice flips.
  const inFlight = useWithdrawProposalStore((s) => s.withdrawing.has(proposalEventId));
  const lastError = useWithdrawProposalStore((s) => s.errors.get(proposalEventId));

  async function withdraw(): Promise<void> {
    // In-flight guard — a concurrent click while the prior round-trip
    // is still in flight is a no-op.
    if (useWithdrawProposalStore.getState().withdrawing.has(proposalEventId)) {
      return;
    }

    // Flip in-flight + clear any prior error for this proposalEventId.
    const store = useWithdrawProposalStore.getState();
    store.setWithdrawing(proposalEventId, true);
    store.setError(proposalEventId, undefined);

    try {
      // Build the canonical `withdraw-proposal` payload. The three
      // fields match `wsWithdrawProposalPayloadSchema` exactly — no
      // `proposerId` (the server reads it from the authenticated
      // connection per `withdraw.ts`).
      const expectedSequence =
        useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
      await client.send('withdraw-proposal', {
        sessionId,
        expectedSequence,
        proposalEventId,
      });

      // Success — the `proposal-withdrawn` ack landed; the server has
      // already broadcast the zero-or-more `entity-removed` events
      // ahead of the ack, so `derivePendingProposals` will surface the
      // updated state via Zustand. Clean up the in-flight set entry.
      useWithdrawProposalStore.getState().setWithdrawing(proposalEventId, false);
    } catch (err) {
      // Failure — the proposal is still pending (engine rejected, the
      // server's `forbidden` gate triggered, or the request timed
      // out). Remove proposalEventId from in-flight; surface the wire
      // error inline. Re-click clears the error before the next
      // attempt.
      const timeoutText = t('participant.withdrawProposalButton.timeoutError');
      const store2 = useWithdrawProposalStore.getState();
      store2.setWithdrawing(proposalEventId, false);
      store2.setError(proposalEventId, toWireError(err, timeoutText));
    }
  }

  return {
    withdraw,
    inFlight,
    lastError,
  };
}
