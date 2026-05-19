// `useMarkMetaDisagreementAction(proposalId)` — the moderator's
// mark-meta-disagreement React hook, one per pending-proposal row.
//
// Companion to `useCommitAction.ts`: same per-proposalId keying, same
// in-flight + lastError tracking, same one-envelope-per-call discipline.
// The moderator surfaces "mark this proposal as meta-disagreement" on
// each pending-proposal row in `PendingProposalsPane`; the methodology
// gate is enforced server-side (`not-a-moderator` / `proposal-not-found`
// / `proposal-already-committed` / `proposal-already-meta-disagreement` /
// `illegal-state-transition` / `methodology-not-exhausted`), so the
// client UI need only thread the wire envelope and surface the typed
// rejection.
//
// Wire envelope (per `wsMarkMetaDisagreementPayloadSchema` in
// `packages/shared-types/src/ws-envelope.ts`):
//
//   { type: 'mark-meta-disagreement',
//     payload: { sessionId, expectedSequence, proposalId } }
//
// The hook owns:
//
//   - `mark()` — the gesture handler. Fires the canonical
//     `mark-meta-disagreement` envelope, awaits the
//     `meta-disagreement-marked` ack, on success removes the
//     proposalId from the in-flight set, on failure surfaces the wire
//     error inline (analogous to the commit-button's wire-error region).
//   - `inFlight` — `true` iff this proposalId is in the module-scoped
//     `marking` set.
//   - `lastError` — the wire-error code + message from the last failed
//     mark for this proposalId, or `undefined`.

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';

/**
 * Wire-error shape surfaced on `lastError`. Re-declared here (rather
 * than imported from `useCommitAction`) so the two hooks stay
 * independently consumable — same rationale as the commit-hook
 * carrying its own copy.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseMarkMetaDisagreementActionResult {
  /** Trigger the mark round-trip for the bound proposalId. Idempotent during the in-flight window. */
  mark: () => Promise<void>;
  /** True while a mark for this proposalId is in flight. */
  inFlight: boolean;
  /** The wire-error code + message from the last failed mark for this proposalId, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice tracking per-proposalId in-flight
 * mark-meta-disagreement state + the last wire error per proposalId.
 * Lives outside React so two `useMarkMetaDisagreementAction(proposalId)`
 * call sites for the same id share state. Disjoint by construction
 * between different proposalIds — each row's button observes only its
 * own slice. Mirrors `useCommitStore`.
 */
interface MarkState {
  readonly marking: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setMarking: (proposalId: string, flag: boolean) => void;
  readonly setError: (proposalId: string, error: WireError | undefined) => void;
}

export const useMarkMetaDisagreementStore = create<MarkState>((set) => ({
  marking: new Set<string>(),
  errors: new Map<string, WireError>(),
  setMarking: (proposalId: string, flag: boolean) =>
    set((state) => {
      const next = new Set(state.marking);
      if (flag) next.add(proposalId);
      else next.delete(proposalId);
      return { marking: next };
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
 * Test seam — let test suites reset the module-scoped mark slice
 * between cases without poking at the store's internals. Mirrors
 * `resetCommitStore()`.
 */
export function resetMarkMetaDisagreementStore(): void {
  useMarkMetaDisagreementStore.setState({
    marking: new Set<string>(),
    errors: new Map<string, WireError>(),
  });
}

/**
 * Map any thrown error to the `WireError` surface. `WsRequestError`
 * carries the server's typed payload verbatim; `WsRequestTimeoutError`
 * gets a localized fallback message; anything else lands as
 * `'unknown'`. Mirrors `useCommitAction`'s `toWireError`.
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
 * The per-row mark-meta-disagreement-action hook. Accepts the bound
 * `proposalId` (`row.proposalEventId` at the call site) and returns
 * the imperative `mark()` callback + observable `inFlight` /
 * `lastError` slices.
 */
export function useMarkMetaDisagreementAction(
  proposalId: string,
): UseMarkMetaDisagreementActionResult {
  const { t } = useTranslation();

  // Session-id read off the route param (same as the commit hook).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  // Per-proposalId slice subscriptions — each call returns a primitive
  // / referentially-stable value so Zustand's default equality check
  // re-renders the consumer only when THIS proposalId's slice flips.
  const inFlight = useMarkMetaDisagreementStore((s) => s.marking.has(proposalId));
  const lastError = useMarkMetaDisagreementStore((s) => s.errors.get(proposalId));

  async function mark(): Promise<void> {
    // In-flight guard — a concurrent click while the prior round-trip
    // is still in flight is a no-op.
    if (useMarkMetaDisagreementStore.getState().marking.has(proposalId)) {
      return;
    }

    // Flip in-flight + clear any prior error for this proposalId.
    const store = useMarkMetaDisagreementStore.getState();
    store.setMarking(proposalId, true);
    store.setError(proposalId, undefined);

    try {
      // Build the canonical `mark-meta-disagreement` payload. The three
      // fields match `wsMarkMetaDisagreementPayloadSchema` exactly — no
      // `moderatorId` (the server reads it from the authenticated
      // connection per the handler's security invariant).
      const expectedSequence =
        useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
      await client.send('mark-meta-disagreement', {
        sessionId,
        expectedSequence,
        proposalId,
      });

      // Success — the broadcast `event-applied` envelope carrying the
      // `meta-disagreement-marked` event has arrived, the read-side
      // projection has transitioned the affected facet and moved the
      // proposal out of `pendingProposals`, and the row will disappear
      // naturally on the next render.
      useMarkMetaDisagreementStore.getState().setMarking(proposalId, false);
    } catch (err) {
      // Failure — the proposal is still pending on the server (the
      // engine rejected, or the request timed out). Remove proposalId
      // from in-flight; surface the wire error inline.
      const timeoutText = t('moderator.markMetaDisagreementButton.timeoutError');
      const store2 = useMarkMetaDisagreementStore.getState();
      store2.setMarking(proposalId, false);
      store2.setError(proposalId, toWireError(err, timeoutText));
    }
  }

  return {
    mark,
    inFlight,
    lastError,
  };
}
