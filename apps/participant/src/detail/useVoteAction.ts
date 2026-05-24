// `useVoteAction(args)` — the participant's per-vote-target vote-action
// React hook. Accepts EITHER a facet target (an
// `(entity_kind, entity_id, facet)` triple) for facet-valued proposals
// OR a proposal target (a `proposal_id`) for the structural sub-kinds
// (`decompose` / `interpretive-split` / `axiom-mark` / `annotate` /
// `meta-move` / `break-edge`). The hook constructs the matching
// `target`-discriminated wire payload and dispatches via
// `useWsClient().send('vote', payload)`.
//
// Refinements:
//   - `tasks/refinements/per-facet-refactor/pf_part_vote_action_facet_keyed.md`
//     (this hook's facet-keyed dual-arm shape per [ADR 0030 §2 + §9]
//     (../../../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)).
//   - `tasks/refinements/participant-ui/part_voting.md` (the original
//     per-proposal hook; do not edit).
//
// Mirrors `apps/moderator/src/layout/useCommitAction.ts` line-for-line
// adapted for the participant surface — same per-key store keying
// (here the key is the per-vote-target slot identifier — see
// `slotKey`), same pessimistic-wait + in-flight + error pattern.
//
// **Per-slot keying.** Each call site binds the hook to ONE vote
// target. Two `useVoteAction` calls binding the same facet (or the
// same proposal id, on the structural arm) share an in-flight slot;
// two calls binding different targets observe disjoint state. The
// store keys both arms under the same string-map slot so the row that
// owns the click is the row whose `inFlight` flips.
//
// **Pessimistic-wait.** The button does NOT optimistically clear local
// state — the row's "Your vote" badge updates naturally when the
// `event-applied` broadcast lands and the `ownVotes` projector picks
// up the new arm. Symmetric with the moderator's commit pattern.
//
// **`choice` is `'agree' | 'dispute'`** per [ADR 0030 §3]
// (../../../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
// The withdraw gesture is no longer a vote choice — it has its own
// event kind (`withdraw-agreement`), surfaced by
// `useWithdrawAgreementAction` (`pf_part_withdraw_agreement_action`).
// The wire schema's `choice` enum still tolerates `'withdraw'` for
// back-compat with the structural-arm `useVoteAction` callers (the
// methodology engine accepts `'withdraw'` for structural proposals
// only, refusing it on the facet arm with
// `illegal-state-transition`); the hook's TypeScript signature pins
// the new two-arm vocabulary.
//
// ADRs:
//   - 0003 (React);
//   - 0021 (envelope discriminated union — the typed `'vote'` arm of
//           `WsMessagePayloadMap` is the wire contract);
//   - 0022 (no throwaway verifications — the unit tests in
//           `useVoteAction.test.tsx` lock in both arms' per-call
//           contracts);
//   - 0024 (i18n via react-i18next — the localized timeout fallback
//           lands via `useTranslation()`);
//   - 0030 (the dual-arm shape).

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import type { FacetName } from '@a-conversa/shared-types';

import { useWsStore } from '../ws/wsStore';

/**
 * Vote-target entity kind. Narrows the broader `EntityKind` enum
 * (which includes `'annotation'` per R26 entity-included payloads) to
 * the two kinds the vote envelope addresses: nodes and edges. The
 * methodology engine has no per-facet vote surface against annotations
 * today; widening this when an annotation-facet vote lands is a
 * follow-up.
 */
export type VoteEntityKind = 'node' | 'edge';

/**
 * The two wire arms a vote can carry. Mirrors the wire schema's
 * `choice` enum minus `'withdraw'` (the withdraw gesture lives on its
 * own event kind per ADR 0030 §3). The hook's TypeScript signature
 * pins the two-arm vocabulary so a stray `'withdraw'` at a call site
 * fails to type-check; the wire schema is permissively three-arm for
 * back-compat with the structural-arm callers.
 */
export type VoteChoice = 'agree' | 'dispute';

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
   * Trigger the vote round-trip for the bound target with the named
   * `choice`. Idempotent during the in-flight window (a concurrent
   * call while the prior round-trip is in flight is a no-op).
   */
  castVote: (choice: VoteChoice) => Promise<void>;
  /** True while a vote for this target is in flight. */
  inFlight: boolean;
  /** Wire error from the last failed vote for this target, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice tracking per-slot in-flight vote state +
 * the last wire error per slot. Lives outside React so two
 * `useVoteAction(args)` call sites for the same target share state.
 * Mirrors `useCommitStore` exactly — disjoint by construction between
 * different slots; no React provider; no devtools wiring.
 *
 * The slot key is a single string assembled by `slotKey()` below; the
 * facet arm packs the triple as
 * `facet:<entity_kind>:<entity_id>:<facet>` and the proposal arm packs
 * the proposal id as `proposal:<proposal_id>`. The two namespaces
 * cannot collide.
 */
interface VoteActionState {
  readonly voting: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setVoting: (slot: string, flag: boolean) => void;
  readonly setError: (slot: string, error: WireError | undefined) => void;
}

export const useVoteActionStore = create<VoteActionState>((set) => ({
  voting: new Set<string>(),
  errors: new Map<string, WireError>(),
  setVoting: (slot: string, flag: boolean) =>
    set((state) => {
      const next = new Set(state.voting);
      if (flag) next.add(slot);
      else next.delete(slot);
      return { voting: next };
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

/**
 * Facet-target hook input — names the `(entity_kind, entity_id, facet)`
 * triple. Used for the four facet-valued proposal sub-kinds
 * (`classify-node` / `set-node-substance` / `set-edge-substance` /
 * `edit-wording` / `amend-node`) per ADR 0030 §2. The wire payload
 * surfaces as `target: 'facet'`.
 */
export interface UseVoteActionFacetArgs {
  readonly entity_kind: VoteEntityKind;
  readonly entity_id: string;
  readonly facet: FacetName;
}

/**
 * Proposal-target hook input — names the structural proposal id
 * directly. Used for the structural sub-kinds (`decompose` /
 * `interpretive-split` / `axiom-mark` / `annotate` / `meta-move` /
 * `break-edge`) per ADR 0030 §9. The wire payload surfaces as
 * `target: 'proposal'`.
 */
export interface UseVoteActionProposalArgs {
  readonly proposal_id: string;
}

export type UseVoteActionArgs = UseVoteActionFacetArgs | UseVoteActionProposalArgs;

/**
 * Type guard discriminating the two input shapes. The facet arm
 * carries `entity_kind`; the proposal arm carries `proposal_id`.
 */
function isFacetArgs(args: UseVoteActionArgs): args is UseVoteActionFacetArgs {
  return 'entity_kind' in args;
}

/**
 * Pack a target into the single string key used by the per-slot
 * Zustand store. The two namespaces (`facet:` / `proposal:`) cannot
 * collide; within the facet namespace the triple is the unique key.
 */
function slotKey(args: UseVoteActionArgs): string {
  if (isFacetArgs(args)) {
    return `facet:${args.entity_kind}:${args.entity_id}:${args.facet}`;
  }
  return `proposal:${args.proposal_id}`;
}

/**
 * The per-target vote-action hook. Accepts a facet target OR a
 * proposal target; returns the imperative `castVote()` callback +
 * observable `inFlight` / `lastError` slices.
 *
 * Per-slot selector subscriptions keep each row's re-render scope
 * narrow — a vote on row A does not re-render row B's buttons.
 */
export function useVoteAction(args: UseVoteActionArgs): UseVoteActionResult {
  const { t } = useTranslation();

  // Session-id read off the route param (same as the moderator's
  // `useCommitAction` — the participant routes use the same `/:id`
  // segment per `OperateRoute.tsx`).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  // Per-slot store key. Disjoint between facet / proposal namespaces +
  // disjoint between different triples / proposal ids.
  const slot = slotKey(args);

  // Per-slot slice subscriptions — each call returns a primitive /
  // referentially-stable value so Zustand's default equality check
  // re-renders the consumer only when THIS slot's slice flips.
  const inFlight = useVoteActionStore((s) => s.voting.has(slot));
  const lastError = useVoteActionStore((s) => s.errors.get(slot));

  async function castVote(choice: VoteChoice): Promise<void> {
    // In-flight guard — a concurrent click while the prior round-trip
    // is still in flight is a no-op. Mirrors `useCommitAction`'s gate.
    if (useVoteActionStore.getState().voting.has(slot)) {
      return;
    }

    // Flip in-flight + clear any prior error for this slot. The order
    // matters: a test that asserts the in-flight visual immediately
    // after the click observes the post-flip state.
    const store = useVoteActionStore.getState();
    store.setVoting(slot, true);
    store.setError(slot, undefined);

    try {
      // Build the canonical `vote` payload. The wire shape is a
      // `target`-discriminated union per ADR 0030 §2 + §9; the
      // facet arm carries the `(entity_kind, entity_id, facet)`
      // triple, the proposal arm carries the proposal id. The
      // `voted_at` timestamp is set server-side (the server reads
      // the connection's authoritative clock); the wire payload
      // carries no client timestamp.
      const expectedSequence =
        useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
      if (isFacetArgs(args)) {
        await client.send('vote', {
          sessionId,
          expectedSequence,
          target: 'facet',
          entity_kind: args.entity_kind,
          entity_id: args.entity_id,
          facet: args.facet,
          choice,
        });
      } else {
        await client.send('vote', {
          sessionId,
          expectedSequence,
          target: 'proposal',
          proposalId: args.proposal_id,
          choice,
        });
      }

      // Success — the `voted` ack landed; the broadcast `event-applied`
      // for the `vote` event will arrive (the server broadcasts BEFORE
      // replying the ack per the ws protocol). The `ownVotes` projector
      // will pick up the new arm and the panel's "Your vote" badge
      // updates naturally. Remove the slot from the in-flight set.
      useVoteActionStore.getState().setVoting(slot, false);
    } catch (err) {
      // Failure — the methodology engine rejected, or the request timed
      // out. Remove the slot from in-flight; surface the wire error
      // inline. The user can retry by re-clicking (which also clears
      // the error before the next attempt — symmetric with the
      // moderator's commit button).
      const timeoutText = t('participant.voteButton.timeoutError');
      const store2 = useVoteActionStore.getState();
      store2.setVoting(slot, false);
      store2.setError(slot, toWireError(err, timeoutText));
    }
  }

  return {
    castVote,
    inFlight,
    lastError,
  };
}
