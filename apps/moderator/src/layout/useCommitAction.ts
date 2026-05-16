// `useCommitAction(proposalId)` — the moderator's commit-action React
// hook, one per pending-proposal row.
//
// Refinement: tasks/refinements/moderator-ui/mod_commit_button.md
// Design doc: docs/moderator-ui.md (right sidebar — pending-proposals
//             pane; commit button per row)
//
// Mirrors `useProposeAction.ts`'s hook+module-scoped-store shape,
// adapted for per-row keying:
//
//   - The propose-side hook is session-global (one in-flight propose at
//     a time, error region next to the bottom-strip button). The
//     commit-side hook is per-proposalId — the button fires for ONE
//     specific row; two simultaneous commits on two different rows
//     must observe disjoint in-flight + error state.
//   - The propose-side hook uses optimistic-clear (reset the capture
//     store before the WS promise resolves). The commit-side hook uses
//     pessimistic-wait (Decision §5) — no optimistic row removal; the
//     row disappears naturally when the broadcast `commit` event lands
//     and `derivePendingProposals` filters it out.
//   - The propose-side hook has its own validation gate; the commit-
//     side hook's validation IS the gate-derived predicate the row
//     component already evaluated. The hook therefore does not
//     re-validate — the click handler relies on the button being
//     disabled when the gate blocks. The in-flight guard remains.
//
// The hook owns:
//
//   - `commit()` — the gesture handler. Fires the canonical `commit`
//     envelope, awaits the `committed` ack, on success removes the
//     proposalId from the in-flight set, on failure surfaces the wire
//     error inline.
//   - `inFlight` — `true` iff this proposalId is in the
//     module-scoped `committing` set.
//   - `lastError` — the wire-error code + message from the last failed
//     commit for this proposalId, or `undefined`.
//
// The module-scoped `useCommitStore` slice (defined below) is NOT a
// React context — two button renders for the same proposalId share the
// same in-flight / error state via the Zustand store, the same idiom
// `useProposeErrorStore` uses on the propose side.

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';

/**
 * Wire-error shape surfaced on `lastError`. `code` is the engine's
 * rejection code (or a transport-layer code like `'timeout'` /
 * `'unknown'`); `message` is the wire-supplied message verbatim when
 * present, or a localized fallback for transport-layer errors.
 *
 * Re-declared here (rather than imported from `useProposeAction`) so
 * the two hooks stay independently consumable — a future task that
 * splits the propose hook out of the layout module would not also have
 * to rehome the commit hook's error shape.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseCommitActionResult {
  /** Trigger the commit round-trip for the bound proposalId. Idempotent during the in-flight window. */
  commit: () => Promise<void>;
  /** True while a commit for this proposalId is in flight. */
  inFlight: boolean;
  /** The wire-error code + message from the last failed commit for this proposalId, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice tracking per-proposalId in-flight commit
 * state + the last wire error per proposalId. Lives outside React so
 * two `useCommitAction(proposalId)` call sites for the same id share
 * state (Decision §7). Disjoint by construction between different
 * proposalIds — each row's button observes only its own slice.
 *
 * The slice is intentionally tiny — no setters beyond the two the
 * hook uses internally; no React provider; no devtools wiring.
 */
interface CommitState {
  readonly committing: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setCommitting: (proposalId: string, flag: boolean) => void;
  readonly setError: (proposalId: string, error: WireError | undefined) => void;
}

export const useCommitStore = create<CommitState>((set) => ({
  committing: new Set<string>(),
  errors: new Map<string, WireError>(),
  setCommitting: (proposalId: string, flag: boolean) =>
    set((state) => {
      const next = new Set(state.committing);
      if (flag) next.add(proposalId);
      else next.delete(proposalId);
      return { committing: next };
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
 * Test seam — let test suites reset the module-scoped commit slice
 * between cases without poking at the store's internals. Mirrors
 * `resetProposeError()` from the propose hook.
 */
export function resetCommitStore(): void {
  useCommitStore.setState({
    committing: new Set<string>(),
    errors: new Map<string, WireError>(),
  });
}

/**
 * Map any thrown error to the `WireError` surface. `WsRequestError`
 * carries the server's typed payload verbatim; `WsRequestTimeoutError`
 * gets a localized fallback message; anything else lands as
 * `'unknown'`. The `timeoutText` is pre-resolved by the caller (so the
 * function stays React-free and easy to test). Mirrors
 * `useProposeAction`'s `toWireError`.
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
 * The per-row commit-action hook. Accepts the bound `proposalId`
 * (`row.proposalEventId` at the call site) and returns the imperative
 * `commit()` callback + observable `inFlight` / `lastError` slices.
 *
 * Per-proposalId selector subscriptions keep each button's re-render
 * scope narrow — Decision §4 sub-option (a): a commit on row A does
 * not re-render row B's button.
 */
export function useCommitAction(proposalId: string): UseCommitActionResult {
  const { t } = useTranslation();

  // Session-id read off the route param (same as the propose hook).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  // Per-proposalId slice subscriptions — each call returns a primitive
  // / referentially-stable value so Zustand's default equality check
  // re-renders the consumer only when THIS proposalId's slice flips.
  const inFlight = useCommitStore((s) => s.committing.has(proposalId));
  const lastError = useCommitStore((s) => s.errors.get(proposalId));

  async function commit(): Promise<void> {
    // In-flight guard — a concurrent click while the prior round-trip
    // is still in flight is a no-op (Decision §5 + AC 4).
    if (useCommitStore.getState().committing.has(proposalId)) {
      return;
    }

    // Flip in-flight + clear any prior error for this proposalId. The
    // order matters: the button's `data-commit-state` transitions to
    // `"in-flight"` before the WS send fires, so a test that asserts
    // the in-flight visual immediately after the click observes the
    // post-flip state.
    const store = useCommitStore.getState();
    store.setCommitting(proposalId, true);
    store.setError(proposalId, undefined);

    try {
      // Build the canonical `commit` payload. The three fields match
      // `wsCommitPayloadSchema` exactly — no `moderatorId` (the server
      // reads it from the authenticated connection per
      // `ws_commit_message.md`).
      const expectedSequence =
        useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
      await client.send('commit', {
        sessionId,
        expectedSequence,
        proposalId,
      });

      // Success — the broadcast `commit` event has arrived (the server
      // broadcasts BEFORE replying the ack per ws_commit_message.md
      // Decisions), `derivePendingProposals` filters out the row, and
      // the pane re-renders without it. Remove proposalId from the
      // in-flight set; the row is gone so the in-flight signal is moot
      // but cleanup keeps the store tidy.
      useCommitStore.getState().setCommitting(proposalId, false);
    } catch (err) {
      // Failure — the proposal is still pending on the server (the
      // engine rejected, or the request timed out). Remove proposalId
      // from in-flight; surface the wire error inline. The row stays
      // in the pane; the moderator can retry by re-clicking (which
      // also clears the error before the next attempt).
      const timeoutText = t('moderator.commitButton.timeoutError');
      const store2 = useCommitStore.getState();
      store2.setCommitting(proposalId, false);
      store2.setError(proposalId, toWireError(err, timeoutText));
    }
  }

  return {
    commit,
    inFlight,
    lastError,
  };
}
