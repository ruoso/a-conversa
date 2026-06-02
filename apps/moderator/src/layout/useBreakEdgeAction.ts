// `useBreakEdgeAction(edgeId)` — the moderator's break-edge action hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_break_edge_resolution_action.md
//             (Decision §D4 — mirrors `useEditWordingAction`'s per-target
//              Zustand store + `client.send('propose', …)` shape)
// Mirror:     apps/moderator/src/layout/useEditWordingAction.ts
//             apps/moderator/src/layout/useAxiomMarkAction.ts
//
// **Per-edgeId keying.** Each break-edge candidate row is bound to one
// `supports` edge of the cycle. The in-flight set + per-key error map are
// both keyed by the bound `edgeId` — two concurrent break-edge proposals
// against different edges observe disjoint in-flight / error state. The
// keying matches `useEditWordingAction`'s per-nodeId shape, dropped to
// the edge axis because the break-edge payload carries only `edge_id`.
//
// **Reused lifecycle (Decision §D1).** `propose()` emits the existing
// `propose { kind: 'break-edge', edge_id }` envelope — the same schema
// (`breakEdgeProposalSchema`) the server already commits via
// `replay.ts`'s commit arm (`setEdgeVisible(edge_id, false)`). No new
// event kind, no wire change: the cycle flag is an emergent projection
// that clears once the edge is hidden.
//
// `dispatchBreakEdgeProposal` carries the store bookkeeping + `client.send`
// so BOTH the hook (multi-candidate chooser rows) and the panel's
// single-candidate direct-dispatch path run the identical lifecycle
// (Constraint §6).

import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient, WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import type { WsClient } from '@a-conversa/shell';

import { useWsStore } from '../ws/wsStore';

/**
 * Wire-error shape surfaced on `lastError`. Re-declared here (rather than
 * imported from a sibling hook) so the resolution hooks stay independently
 * consumable — same redeclaration `useEditWordingAction` / `useAxiomMarkAction`
 * did off `useProposeAction`.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseBreakEdgeActionResult {
  /**
   * Trigger the break-edge proposal for the bound `edgeId`. The in-flight
   * guard short-circuits a concurrent call on the SAME `edgeId` while the
   * prior round-trip is still in flight; calls against different edges are
   * allowed in parallel.
   */
  propose: () => Promise<void>;
  /** True while a propose for the bound `edgeId` is in flight. */
  inFlight: boolean;
  /** The wire-error from the last failed propose for the bound `edgeId`, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice tracking per-edgeId in-flight break-edge
 * state + the last wire error per edgeId. Lives outside React so two
 * `useBreakEdgeAction(edgeId)` call sites for the same edge share state —
 * mirrors `useEditWordingStore`'s shape.
 */
interface BreakEdgeState {
  readonly inFlight: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setInFlight: (edgeId: string, flag: boolean) => void;
  readonly setError: (edgeId: string, error: WireError | undefined) => void;
}

export const useBreakEdgeStore = create<BreakEdgeState>((set) => ({
  inFlight: new Set<string>(),
  errors: new Map<string, WireError>(),
  setInFlight: (edgeId: string, flag: boolean) =>
    set((state) => {
      const next = new Set(state.inFlight);
      if (flag) next.add(edgeId);
      else next.delete(edgeId);
      return { inFlight: next };
    }),
  setError: (edgeId: string, error: WireError | undefined) =>
    set((state) => {
      const next = new Map(state.errors);
      if (error === undefined) next.delete(edgeId);
      else next.set(edgeId, error);
      return { errors: next };
    }),
}));

/**
 * Test seam — reset the module-scoped break-edge slice between cases.
 * Mirrors `resetEditWordingStore()`.
 */
export function resetBreakEdgeStore(): void {
  useBreakEdgeStore.setState({
    inFlight: new Set<string>(),
    errors: new Map<string, WireError>(),
  });
}

/**
 * Map any thrown error to the `WireError` surface. `WsRequestError`
 * carries the server's typed payload verbatim; `WsRequestTimeoutError`
 * and anything else fall back to their own message. No localized timeout
 * copy is minted here — the break-edge action has no inline error banner
 * in scope (the chooser closes on pick), so the raw transport message is
 * sufficient and no new i18n key is introduced (Constraint §7).
 */
function toWireError(err: unknown): WireError {
  if (err instanceof WsRequestError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof WsRequestTimeoutError) {
    return { code: 'timeout', message: err.message };
  }
  if (err instanceof Error) {
    return { code: 'unknown', message: err.message };
  }
  return { code: 'unknown', message: String(err) };
}

/**
 * Fire one break-edge proposal for `edgeId` and reconcile the per-edgeId
 * in-flight / error slice around the round-trip. Shared by the hook and
 * the panel's single-candidate direct path so both run the identical
 * lifecycle (Constraint §6).
 *
 * The in-flight guard short-circuits a concurrent dispatch on the same
 * `edgeId`; the in-flight flip happens BEFORE the WS send so a render
 * observing the flip immediately after the call sees the post-flip state.
 */
export async function dispatchBreakEdgeProposal(
  client: WsClient,
  sessionId: string,
  edgeId: string,
): Promise<void> {
  if (useBreakEdgeStore.getState().inFlight.has(edgeId)) {
    return;
  }

  const store = useBreakEdgeStore.getState();
  store.setInFlight(edgeId, true);
  store.setError(edgeId, undefined);

  try {
    // Build the break-edge propose envelope. The two-field proposal
    // matches `breakEdgeProposalSchema` + `proposePayloadSchema` exactly —
    // no client-minted id (the server mints the envelope id at append
    // time).
    const expectedSequence =
      useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
    await client.send('propose', {
      sessionId,
      expectedSequence,
      proposal: {
        kind: 'break-edge',
        edge_id: edgeId,
      },
    });

    const store2 = useBreakEdgeStore.getState();
    store2.setInFlight(edgeId, false);
    store2.setError(edgeId, undefined);
  } catch (err) {
    const store2 = useBreakEdgeStore.getState();
    store2.setInFlight(edgeId, false);
    store2.setError(edgeId, toWireError(err));
  }
}

/**
 * The per-edge break-edge hook. Accepts the bound `edgeId` (a cycle's
 * candidate `supports` edge) and returns the imperative `propose`
 * callback + observable `inFlight` / `lastError` slices.
 *
 * **Subscription model.** Subscribes to the full `inFlight` Set +
 * `errors` Map references so a chooser row observes flips for its bound
 * edgeId; the per-key projections are derived in the hook body. Mirrors
 * `useEditWordingAction`'s posture.
 */
export function useBreakEdgeAction(edgeId: string): UseBreakEdgeActionResult {
  // Session-id read off the route param (same as the sibling hooks).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  const inFlightSet = useBreakEdgeStore((s) => s.inFlight);
  const errorsMap = useBreakEdgeStore((s) => s.errors);

  const inFlight = inFlightSet.has(edgeId);
  const lastError = errorsMap.get(edgeId);

  async function propose(): Promise<void> {
    await dispatchBreakEdgeProposal(client, sessionId, edgeId);
  }

  return {
    propose,
    inFlight,
    lastError,
  };
}
