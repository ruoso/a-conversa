// `useWithdrawAgreementAction({ entity_kind, entity_id, facet,
// participantId })` — the participant's per-facet withdraw-agreement
// React hook. Emits a `withdraw-agreement` WS envelope (per ADR 0030 §3
// + `pf_withdraw_agreement_handler`) against the named
// `(entity_kind, entity_id, facet)` triple. The hook is the UI
// counterpart to the server-side handler at
// `apps/server/src/ws/handlers/withdraw-agreement.ts` + the wire
// payload at `wsWithdrawAgreementPayloadSchema`.
//
// Refinement: tasks/refinements/per-facet-refactor/
//             pf_part_withdraw_agreement_action.md.
//
// **Why a dedicated hook (vs. reusing `useVoteAction`).** Per ADR
// 0030 §3 the withdraw gesture is no longer a vote `choice` —
// `useVoteAction`'s `VoteChoice` is `'agree' | 'dispute'` only. The
// withdraw flow has its own event kind (`withdraw-agreement`), its
// own ack (`agreement-withdrawn`), and its own typed wire errors
// (`no-prior-agree` / `inapplicable-to-facet` / etc. per the
// handler's typed-code surface). This hook mirrors `useVoteAction`'s
// facet-arm slot keying + pessimistic-wait flow + Zustand-backed
// per-slot in-flight + error state — so two `useWithdrawAgreementAction`
// calls binding the same `(entity_kind, entity_id, facet)` triple
// share an in-flight slot, and two calls binding different triples
// observe disjoint state.
//
// **Per-slot keying.** Each call site binds the hook to ONE
// `(entity_kind, entity_id, facet)` triple. The slot key is
// `withdraw:<entity_kind>:<entity_id>:<facet>` — a single string
// keyed under the module-scoped Zustand store. The `withdraw:` prefix
// keeps the namespace disjoint from `useVoteAction`'s `facet:` /
// `proposal:` slots (so a vote on a facet does not collide with a
// withdraw on the same facet for the per-slot in-flight bookkeeping).
//
// **Pessimistic-wait.** The button does NOT optimistically clear
// local state — the facet row's status walks to `'withdrawn'` when
// the `event-applied` broadcast lands and the `deriveFacetStatus`
// projection picks up the new event. Symmetric with `useVoteAction`'s
// commit/vote pattern.
//
// **`participantId` comes from the call site.** The wire payload
// requires the `participant` field (the server cross-checks it
// against `connection.user.id`); the hook accepts it as an argument
// rather than reading it from a context so a stray missing-id at the
// call site fails to type-check. Mirrors `useAxiomMarkAction`'s
// posture — same authority pattern (the participant withdraws ONLY
// their own agreement; the server enforces via `connection.user.id`).
//
// ADRs:
//   - 0003 (React);
//   - 0021 (envelope discriminated union — the typed
//           `'withdraw-agreement'` arm of `WsMessagePayloadMap` is
//           the wire contract);
//   - 0022 (no throwaway verifications — the unit tests in
//           `useWithdrawAgreementAction.test.tsx` lock in the
//           per-call contract);
//   - 0024 (i18n via react-i18next — the localized timeout fallback
//           lands via `useTranslation()`);
//   - 0030 §3 (the dedicated `withdraw-agreement` event kind, the
//           replacement for the deprecated `vote.choice === 'withdraw'`
//           arm).

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import type { FacetName } from '@a-conversa/shared-types';

import { useWsStore } from '../ws/wsStore';

/**
 * Withdraw-target entity kind. Narrows the broader `EntityKind` enum
 * to the two kinds the `withdraw-agreement` envelope addresses
 * (`'node' | 'edge'`) — mirrors `useVoteAction`'s `VoteEntityKind`.
 * The wire schema's `entity_kind` enum is identical (per
 * `wsWithdrawAgreementPayloadSchema`); annotation entities have no
 * per-facet withdraw surface today.
 */
export type WithdrawEntityKind = 'node' | 'edge';

/**
 * Withdraw-facet vocabulary. The wire schema's `facet` enum spans
 * `'classification' | 'substance' | 'wording' | 'shape'`; `FacetName`
 * (from `@a-conversa/shared-types`) is 3-valued (the 'shape' edge
 * facet lives in the wider widening at the participant graph layer).
 * We accept either — the call site's discriminator is the facet
 * status row, which already widens to include `'shape'`.
 */
export type WithdrawFacet = FacetName | 'shape';

/**
 * Wire-error shape surfaced on `lastError`. Redeclared locally (rather
 * than imported from `useVoteAction`) so the hook stays independently
 * consumable across workspace edges — symmetric with `useVoteAction`'s
 * own redeclaration off `useCommitAction`.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseWithdrawAgreementActionArgs {
  readonly entity_kind: WithdrawEntityKind;
  readonly entity_id: string;
  readonly facet: WithdrawFacet;
  /**
   * The authenticated participant's user id — used as the wire
   * `participant` field. The server compares this against
   * `connection.user.id`; passing the authenticated user id makes
   * the `forbidden` / `actor-mismatch` rejection unreachable on the
   * participant surface (it's the correct gesture for the
   * methodology rule).
   */
  readonly participantId: string;
}

export interface UseWithdrawAgreementActionResult {
  /**
   * Trigger the withdraw round-trip for the bound target. Idempotent
   * during the in-flight window (a concurrent call while the prior
   * round-trip is in flight is a no-op).
   */
  withdraw: () => Promise<void>;
  /** True while a withdraw for this target is in flight. */
  inFlight: boolean;
  /** Wire error from the last failed withdraw for this target, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice tracking per-slot in-flight withdraw
 * state + the last wire error per slot. Lives outside React so two
 * `useWithdrawAgreementAction(args)` call sites for the same target
 * share state. Mirrors `useVoteActionStore` exactly — disjoint by
 * construction between different slots; no React provider; no
 * devtools wiring.
 *
 * The slot key is `withdraw:<entity_kind>:<entity_id>:<facet>` — a
 * disjoint namespace from `useVoteActionStore`'s `facet:` / `proposal:`
 * slots.
 */
interface WithdrawAgreementActionState {
  readonly withdrawing: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setWithdrawing: (slot: string, flag: boolean) => void;
  readonly setError: (slot: string, error: WireError | undefined) => void;
}

export const useWithdrawAgreementActionStore = create<WithdrawAgreementActionState>((set) => ({
  withdrawing: new Set<string>(),
  errors: new Map<string, WireError>(),
  setWithdrawing: (slot: string, flag: boolean) =>
    set((state) => {
      const next = new Set(state.withdrawing);
      if (flag) next.add(slot);
      else next.delete(slot);
      return { withdrawing: next };
    }),
  setError: (slot: string, error: WireError | undefined) =>
    set((state) => {
      const next = new Map(state.errors);
      if (error === undefined) next.delete(slot);
      else next.set(slot, error);
      return { errors: next };
    }),
}));

/**
 * Test seam — lets test suites reset the module-scoped withdraw-
 * agreement slice between cases. Mirrors `resetVoteActionStore`.
 */
export function resetWithdrawAgreementActionStore(): void {
  useWithdrawAgreementActionStore.setState({
    withdrawing: new Set<string>(),
    errors: new Map<string, WireError>(),
  });
}

/**
 * Map any thrown error to the `WireError` surface. `WsRequestError`
 * carries the server's typed payload verbatim; `WsRequestTimeoutError`
 * gets a localized fallback message; anything else lands as
 * `'unknown'`. The `timeoutText` is pre-resolved by the caller so the
 * function stays React-free and easy to test. Mirrors
 * `useVoteAction`'s `toWireError`.
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
 * Pack a target into the single string key used by the per-slot
 * Zustand store. The `withdraw:` prefix keeps the namespace disjoint
 * from `useVoteAction`'s `facet:` / `proposal:` slots, so a vote
 * in-flight on a facet does not collide with a withdraw in-flight on
 * the same facet for the per-slot bookkeeping.
 */
export function slotKey(args: {
  entity_kind: WithdrawEntityKind;
  entity_id: string;
  facet: WithdrawFacet;
}): string {
  return `withdraw:${args.entity_kind}:${args.entity_id}:${args.facet}`;
}

/**
 * The per-target withdraw-agreement hook. Returns the imperative
 * `withdraw()` callback + observable `inFlight` / `lastError` slices.
 *
 * Per-slot selector subscriptions keep each row's re-render scope
 * narrow — a withdraw on row A does not re-render row B's button.
 */
export function useWithdrawAgreementAction(
  args: UseWithdrawAgreementActionArgs,
): UseWithdrawAgreementActionResult {
  const { entity_kind, entity_id, facet, participantId } = args;
  const { t } = useTranslation();

  // Session-id read off the route param (same as `useVoteAction` /
  // `useAxiomMarkAction` — the participant routes use the same `/:id`
  // segment per `OperateRoute.tsx`).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  // Per-slot store key. Disjoint from the vote namespaces.
  const slot = slotKey({ entity_kind, entity_id, facet });

  // Per-slot slice subscriptions — each call returns a primitive /
  // referentially-stable value so Zustand's default equality check
  // re-renders the consumer only when THIS slot's slice flips.
  const inFlight = useWithdrawAgreementActionStore((s) => s.withdrawing.has(slot));
  const lastError = useWithdrawAgreementActionStore((s) => s.errors.get(slot));

  async function withdraw(): Promise<void> {
    // In-flight guard — a concurrent click while the prior round-trip
    // is still in flight is a no-op. Mirrors `useVoteAction`'s gate.
    if (useWithdrawAgreementActionStore.getState().withdrawing.has(slot)) {
      return;
    }

    // Flip in-flight + clear any prior error for this slot. The order
    // matters: a test that asserts the in-flight visual immediately
    // after the click observes the post-flip state.
    const store = useWithdrawAgreementActionStore.getState();
    store.setWithdrawing(slot, true);
    store.setError(slot, undefined);

    try {
      // Build the canonical `withdraw-agreement` payload per
      // `wsWithdrawAgreementPayloadSchema`. Six fields total —
      // `sessionId` / `expectedSequence` / `entity_kind` /
      // `entity_id` / `facet` / `participant`. The server mints
      // `withdrawn_at` at append time (the wire payload carries no
      // client timestamp).
      const expectedSequence =
        useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
      await client.send('withdraw-agreement', {
        sessionId,
        expectedSequence,
        entity_kind,
        entity_id,
        facet,
        participant: participantId,
      });

      // Success — the `agreement-withdrawn` ack landed; the
      // broadcast `event-applied` for the `withdraw-agreement` event
      // will arrive (the server broadcasts BEFORE replying the ack
      // per the ws protocol). The facet-status projector will pick
      // up the new arm and the row flips to `'withdrawn'`; the
      // button disappears as the row re-renders into the
      // disputed/withdrawn branch (no withdraw affordance there).
      useWithdrawAgreementActionStore.getState().setWithdrawing(slot, false);
    } catch (err) {
      // Failure — the methodology engine rejected, or the request
      // timed out. Remove the slot from in-flight; surface the wire
      // error inline. The user can retry by re-clicking (which also
      // clears the error before the next attempt — symmetric with
      // `useVoteAction`).
      const timeoutText = t('participant.withdrawAgreementButton.timeoutError');
      const store2 = useWithdrawAgreementActionStore.getState();
      store2.setWithdrawing(slot, false);
      store2.setError(slot, toWireError(err, timeoutText));
    }
  }

  return {
    withdraw,
    inFlight,
    lastError,
  };
}
