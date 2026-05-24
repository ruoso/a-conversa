// `useProposeSetNodeSubstanceAction(nodeId)` — the moderator's per-node
// set-node-substance propose hook.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_mod_node_card_substance_affordance.md
// ADRs:       docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§1, §8, §10)
// Mirror:     apps/moderator/src/layout/useProposeClassifyNodeAction.ts
//             (the sibling per-node propose hook for the classification
//             facet — same per-nodeId Zustand-store shape; same `toWireError`
//             mapping; same in-flight guard).
//
// **Per-nodeId keying.** Each `<NodeCardSubstanceAffordance>` is bound to
// a single nodeId — the card it mounts on. The in-flight set + per-key
// error map are keyed by that nodeId so two concurrent set-node-substance
// proposals against different nodes observe disjoint in-flight / error
// state. The keying mirrors `useProposeClassifyNodeAction`'s shape.
//
// **Per-facet refactor (ADR 0030 §1).** Substance is the THIRD facet in
// the per-node sequence (wording → classification → substance). A freshly
// captured node's substance facet enters life `awaiting-proposal`; the
// moderator names a candidate value (`agreed` meaning "claim holds" /
// `disputed` meaning "claim doesn't hold") via the affordance mounted on
// the per-node card. This hook is the wire-write surface for that
// gesture — clicking a value dispatches a `propose` envelope with
// `proposal: { kind: 'set-node-substance', node_id, value }`.
//
// **No bundled events.** This hook ONLY mints `set-node-substance`
// against an extant node whose classification has settled (`agreed` or
// `committed`). The server's sequence gate
// (`pf_sequence_gate_server_enforced`) is the integrity boundary that
// rejects a `set-node-substance` against an unsettled classification
// facet; the UI hides the affordance in that case (gate in
// `<NodeCardSubstanceAffordance>`), but the server is authoritative.

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';

/**
 * The two possible substance values per `docs/data-model.md:247`:
 *   - `'agreed'` — the moderator proposes "the claim holds".
 *   - `'disputed'` — the moderator proposes "the claim doesn't hold".
 *
 * Exported so the affordance component + tests share one enumeration.
 */
export type SubstanceValue = 'agreed' | 'disputed';

/**
 * Wire-error shape surfaced on `lastError`. Re-declared here (rather
 * than imported from a sibling propose hook) so the hook stays
 * independently consumable — same redeclaration pattern the other per-
 * node hooks did off `useProposeAction`.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseProposeSetNodeSubstanceActionResult {
  /**
   * Trigger the set-node-substance proposal for the bound nodeId with
   * the picked `value`. The in-flight guard short-circuits a concurrent
   * click on the SAME nodeId while the prior round-trip is still in
   * flight; clicks against different nodes are allowed in parallel.
   */
  propose: (value: SubstanceValue) => Promise<void>;
  /** True while a propose for the bound nodeId is in flight. */
  inFlight: boolean;
  /** The wire-error from the last failed propose for the bound nodeId, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice tracking per-nodeId in-flight
 * set-node-substance state + the last wire error per nodeId. Lives
 * outside React so two `useProposeSetNodeSubstanceAction(nodeId)` call
 * sites for the same node share state — mirrors `useClassifyNodeStore`.
 */
interface SetNodeSubstanceState {
  readonly inFlight: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setInFlight: (nodeId: string, flag: boolean) => void;
  readonly setError: (nodeId: string, error: WireError | undefined) => void;
}

export const useSetNodeSubstanceStore = create<SetNodeSubstanceState>((set) => ({
  inFlight: new Set<string>(),
  errors: new Map<string, WireError>(),
  setInFlight: (nodeId: string, flag: boolean) =>
    set((state) => {
      const next = new Set(state.inFlight);
      if (flag) next.add(nodeId);
      else next.delete(nodeId);
      return { inFlight: next };
    }),
  setError: (nodeId: string, error: WireError | undefined) =>
    set((state) => {
      const next = new Map(state.errors);
      if (error === undefined) next.delete(nodeId);
      else next.set(nodeId, error);
      return { errors: next };
    }),
}));

/**
 * Test seam — reset the module-scoped set-node-substance slice between
 * cases. Mirrors `resetClassifyNodeStore()`.
 */
export function resetSetNodeSubstanceStore(): void {
  useSetNodeSubstanceStore.setState({
    inFlight: new Set<string>(),
    errors: new Map<string, WireError>(),
  });
}

/**
 * Map any thrown error to the `WireError` surface. Mirrors the same
 * helper in the sibling per-node hooks.
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
 * The per-node set-node-substance hook. Accepts the bound `nodeId` (the
 * card's node id) and returns the imperative `propose` callback +
 * observable `inFlight` / `lastError` slices.
 *
 * **Subscription model.** Subscribes to the full `inFlight` Set +
 * `errors` Map references so the affordance's render observes flips
 * for its bound nodeId; the per-key projections (`inFlight` boolean,
 * `lastError`) are derived in the hook body. Mirrors
 * `useProposeClassifyNodeAction`'s posture.
 */
export function useProposeSetNodeSubstanceAction(
  nodeId: string,
): UseProposeSetNodeSubstanceActionResult {
  const { t } = useTranslation();

  // Session-id read off the route param (same as the sibling per-node
  // hooks).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  // Subscribe to the full slices — the per-key derivation below filters
  // down to the bound nodeId.
  const inFlightSet = useSetNodeSubstanceStore((s) => s.inFlight);
  const errorsMap = useSetNodeSubstanceStore((s) => s.errors);

  const inFlight = inFlightSet.has(nodeId);
  const lastError = errorsMap.get(nodeId);

  async function propose(value: SubstanceValue): Promise<void> {
    // In-flight guard — concurrent click on the SAME nodeId is a no-op.
    if (useSetNodeSubstanceStore.getState().inFlight.has(nodeId)) {
      return;
    }

    // Flip in-flight + clear any prior error for this key. The order
    // matters: the affordance's render transitions before the WS send
    // fires, so a test that asserts the in-flight visual immediately
    // after the click observes the post-flip state.
    const store = useSetNodeSubstanceStore.getState();
    store.setInFlight(nodeId, true);
    store.setError(nodeId, undefined);

    try {
      const expectedSequence =
        useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
      await client.send('propose', {
        sessionId,
        expectedSequence,
        proposal: {
          kind: 'set-node-substance',
          node_id: nodeId,
          value,
        },
      });

      // Success — clear in-flight, drop any stale error for this key.
      const store2 = useSetNodeSubstanceStore.getState();
      store2.setInFlight(nodeId, false);
      store2.setError(nodeId, undefined);
    } catch (err) {
      // Failure — surface the wire error inline on this nodeId. The
      // affordance restores its un-pressed state (the optimistic clear
      // was the in-flight flip; reverting that lets the moderator
      // retry).
      const timeoutText = t('moderator.setNodeSubstanceAction.errorBanner.timeout');
      const store2 = useSetNodeSubstanceStore.getState();
      store2.setInFlight(nodeId, false);
      store2.setError(nodeId, toWireError(err, timeoutText));
    }
  }

  return {
    propose,
    inFlight,
    lastError,
  };
}
