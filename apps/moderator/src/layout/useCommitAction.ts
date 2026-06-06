// `useCommitAction(args)` — the moderator's per-row commit-action React
// hook. Accepts EITHER a facet target (an
// `(entity_kind, entity_id, facet)` triple) for facet-valued proposals
// OR a proposal target (a `proposal_id`) for the structural sub-kinds
// (`decompose` / `interpretive-split` / `axiom-mark` / `annotate` /
// `meta-move` / `break-edge`). The hook constructs the matching
// `target`-discriminated wire payload and dispatches via
// `useWsClient().send('commit', payload)`.
//
// Refinements:
//   - `tasks/refinements/per-facet-refactor/pf_mod_pending_proposals_pane_facet_keyed.md`
//     (this hook's dual-arm shape per [ADR 0030 §2 + §9]
//     (../../../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)).
//   - `tasks/refinements/moderator-ui/mod_commit_button.md` (the
//     original per-proposal hook; do not edit).
//
// Mirrors `apps/participant/src/detail/useVoteAction.ts` line-for-line
// adapted for the moderator's commit surface — same per-slot store
// keying (the slot is `facet:<entity_kind>:<entity_id>:<facet>` for the
// facet arm or `proposal:<proposal_id>` for the proposal arm), same
// pessimistic-wait + in-flight + error pattern.
//
// **Per-slot keying.** Each call site binds the hook to ONE commit
// target. Two `useCommitAction(args)` calls binding the same target
// share an in-flight slot; two calls binding different targets observe
// disjoint state. The store keys both arms under the same string-map
// slot so the row that owns the click is the row whose `inFlight` flips.
//
// **Pessimistic-wait** (Decision §5 of the predecessor refinement) — no
// optimistic row removal; the row disappears naturally when the
// broadcast `commit` event lands and `derivePendingProposals` filters
// it out.
//
// **Validation is the gate-derived predicate** the row component
// already evaluated. The hook therefore does not re-validate — the
// click handler relies on the button being disabled when the gate
// blocks. The in-flight guard remains.

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { WsRequestError, WsRequestTimeoutError, type WsClient } from '@a-conversa/shell';
import type { FacetName } from '@a-conversa/shared-types';

/**
 * Commit-target entity kind. Narrows the broader `EntityKind` enum to
 * the two kinds the wire envelope addresses today: nodes and edges.
 * Mirrors `VoteEntityKind` in `useVoteAction.ts`.
 */
export type CommitEntityKind = 'node' | 'edge';

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
  /** Trigger the commit round-trip for the bound target. Idempotent during the in-flight window. */
  commit: () => Promise<void>;
  /** True while a commit for this target is in flight. */
  inFlight: boolean;
  /** The wire-error code + message from the last failed commit for this target, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice tracking per-slot in-flight commit state +
 * the last wire error per slot. Lives outside React so two
 * `useCommitAction(args)` call sites for the same target share state
 * (Decision §7 of the predecessor refinement). Disjoint by construction
 * between different slots — each row's button observes only its own
 * slice.
 *
 * The slot key is a single string assembled by `slotKey()` below; the
 * facet arm packs the triple as `facet:<entity_kind>:<entity_id>:<facet>`
 * and the proposal arm packs the proposal id as
 * `proposal:<proposal_id>`. The two namespaces cannot collide.
 */
interface CommitState {
  readonly committing: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setCommitting: (slot: string, flag: boolean) => void;
  readonly setError: (slot: string, error: WireError | undefined) => void;
}

export const useCommitStore = create<CommitState>((set) => ({
  committing: new Set<string>(),
  errors: new Map<string, WireError>(),
  setCommitting: (slot: string, flag: boolean) =>
    set((state) => {
      const next = new Set(state.committing);
      if (flag) next.add(slot);
      else next.delete(slot);
      return { committing: next };
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
 * Facet-target hook input — names the `(entity_kind, entity_id, facet)`
 * triple. Used for the facet-valued proposal sub-kinds (`classify-node`
 * / `set-node-substance` / `set-edge-substance` / `edit-wording` /
 * `capture-node`'s wording facet) per ADR 0030 §2. The wire payload
 * surfaces as `target: 'facet'`.
 */
export interface UseCommitActionFacetArgs {
  readonly entity_kind: CommitEntityKind;
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
export interface UseCommitActionProposalArgs {
  readonly proposal_id: string;
}

export type UseCommitActionArgs = UseCommitActionFacetArgs | UseCommitActionProposalArgs;

/**
 * Type guard discriminating the two input shapes. The facet arm
 * carries `entity_kind`; the proposal arm carries `proposal_id`.
 */
function isFacetArgs(args: UseCommitActionArgs): args is UseCommitActionFacetArgs {
  return 'entity_kind' in args;
}

/**
 * Pack a target into the single string key used by the per-slot
 * Zustand store. The two namespaces (`facet:` / `proposal:`) cannot
 * collide; within the facet namespace the triple is the unique key.
 */
function slotKey(args: UseCommitActionArgs): string {
  if (isFacetArgs(args)) {
    return `facet:${args.entity_kind}:${args.entity_id}:${args.facet}`;
  }
  return `proposal:${args.proposal_id}`;
}

/**
 * Shared commit-dispatch core — the envelope-shaping + per-slot in-flight
 * (`useCommitStore`) body, extracted from `useCommitAction.commit()` so
 * the row button AND the keyboard commit chord
 * (`useProposalCommitChord`) drive the IDENTICAL path: same
 * `target`-armed envelope (ADR 0030), same in-flight slot keying (a
 * chord + a button press for the same target de-duplicate rather than
 * double-send). Pure of React — `timeoutText` is pre-resolved by the
 * caller so this function stays renderless and easy to test (mirrors the
 * existing `toWireError(err, timeoutText)` discipline).
 *
 * The in-flight guard, the `expectedSequence` read, and the
 * success/error transitions are byte-for-byte the prior `commit()` body;
 * only their home moved.
 *
 * @param client The WS client (`useWsClient()`'s value at the call site).
 * @param sessionId The route session id.
 * @param target The facet OR proposal commit target.
 * @param timeoutText Pre-localized fallback for the timeout wire error.
 */
export async function sendCommit(
  client: WsClient,
  sessionId: string,
  target: UseCommitActionArgs,
  timeoutText: string,
): Promise<void> {
  const slot = slotKey(target);

  // In-flight guard — a concurrent trigger (a second click, or a chord
  // racing a click) while the prior round-trip is still in flight is a
  // no-op. Mirrors `useVoteAction`'s gate.
  if (useCommitStore.getState().committing.has(slot)) {
    return;
  }

  // Flip in-flight + clear any prior error for this slot. The order
  // matters: the button's `data-commit-state` transitions to
  // `"in-flight"` before the WS send fires.
  const store = useCommitStore.getState();
  store.setCommitting(slot, true);
  store.setError(slot, undefined);

  try {
    // Build the canonical `commit` payload. The wire shape is a
    // `target`-discriminated union per ADR 0030 §2 + §9; the facet arm
    // carries the `(entity_kind, entity_id, facet)` triple, the proposal
    // arm carries the proposal id.
    const expectedSequence =
      useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
    if (isFacetArgs(target)) {
      await client.send('commit', {
        sessionId,
        expectedSequence,
        target: 'facet',
        entity_kind: target.entity_kind,
        entity_id: target.entity_id,
        facet: target.facet,
      });
    } else {
      await client.send('commit', {
        sessionId,
        expectedSequence,
        target: 'proposal',
        proposalId: target.proposal_id,
      });
    }

    // Success — the broadcast `commit` event has arrived, the pane
    // re-renders without the row. Clear the in-flight slot.
    useCommitStore.getState().setCommitting(slot, false);
  } catch (err) {
    // Failure — the proposal is still pending on the server. Clear
    // in-flight; surface the wire error inline for the row to render.
    const store2 = useCommitStore.getState();
    store2.setCommitting(slot, false);
    store2.setError(slot, toWireError(err, timeoutText));
  }
}

/**
 * The per-target commit-action hook. Accepts a facet target OR a
 * proposal target; returns the imperative `commit()` callback +
 * observable `inFlight` / `lastError` slices.
 *
 * Per-slot selector subscriptions keep each button's re-render scope
 * narrow — a commit on row A does not re-render row B's button.
 */
export function useCommitAction(args: UseCommitActionArgs): UseCommitActionResult {
  const { t } = useTranslation();

  // Session-id read off the route param (same as the propose hook).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  // Per-slot store key. Disjoint between facet / proposal namespaces +
  // disjoint between different triples / proposal ids.
  const slot = slotKey(args);

  // Per-slot slice subscriptions — each call returns a primitive /
  // referentially-stable value so Zustand's default equality check
  // re-renders the consumer only when THIS slot's slice flips.
  const inFlight = useCommitStore((s) => s.committing.has(slot));
  const lastError = useCommitStore((s) => s.errors.get(slot));

  async function commit(): Promise<void> {
    // Delegate to the shared dispatch core — same path the keyboard
    // commit chord drives. `timeoutText` is pre-resolved here (inside
    // render) so the core stays React-free.
    const timeoutText = t('moderator.commitButton.timeoutError');
    await sendCommit(client, sessionId, args, timeoutText);
  }

  return {
    commit,
    inFlight,
    lastError,
  };
}
