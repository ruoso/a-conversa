// `useProposeClassifyNodeAction(nodeId)` — the moderator's per-node
// classify-node propose hook.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_mod_node_card_classification_affordance.md
// ADRs:       docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§1, §10)
// Mirror:     apps/moderator/src/layout/useEditWordingAction.ts (per-nodeId
//             keyed Zustand-store shape; per-nodeId in-flight + per-nodeId
//             error slice; same `toWireError` mapping).
//
// **Per-nodeId keying.** Each `<NodeCardClassificationPalette>` is bound to
// a single nodeId — the card it mounts on. The in-flight set + per-key
// error map are keyed by that nodeId so two concurrent classify-node
// proposals against different nodes observe disjoint in-flight / error
// state. The keying mirrors `useEditWordingAction`'s shape.
//
// **Per-facet refactor (ADR 0030 §1).** The capture-pane gesture is now
// wording-only (`pf_mod_capture_pane_wording_only`); the classification
// facet enters life `awaiting-proposal` per ADR 0030 §10 and is named by
// a moderator gesture against the per-node card. This hook is the wire-
// write surface for that gesture — picking a kind on the inline node-
// card palette dispatches a `propose` envelope with
// `proposal: { kind: 'classify-node', node_id, classification }`.
//
// **No bundled events.** Unlike the retired legacy `classify-node`-with-
// wording bundle, this hook ONLY mints `classify-node` against an extant
// node. The server's sequence gate (`pf_sequence_gate_server_enforced`)
// is the integrity boundary that rejects a `classify-node` against an
// unsettled wording facet; the UI hides the palette in that case (gate
// in `<NodeCardClassificationPalette>`), but the server is authoritative.

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';
import type { StatementKind } from '@a-conversa/shared-types';

import { useWsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';

/**
 * Wire-error shape surfaced on `lastError`. Re-declared here (rather
 * than imported from a sibling propose hook) so the hook stays
 * independently consumable — same redeclaration the other per-node
 * hooks did off `useProposeAction`.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseProposeClassifyNodeActionResult {
  /**
   * Trigger the classify-node proposal for the bound nodeId with the
   * picked `classification`. The in-flight guard short-circuits a
   * concurrent click on the SAME nodeId while the prior round-trip is
   * still in flight; clicks against different nodes are allowed in
   * parallel.
   */
  propose: (classification: StatementKind) => Promise<void>;
  /** True while a propose for the bound nodeId is in flight. */
  inFlight: boolean;
  /** The wire-error from the last failed propose for the bound nodeId, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice tracking per-nodeId in-flight classify-node
 * state + the last wire error per nodeId. Lives outside React so two
 * `useProposeClassifyNodeAction(nodeId)` call sites for the same node
 * share state — mirrors `useEditWordingStore`'s shape.
 */
interface ClassifyNodeState {
  readonly inFlight: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setInFlight: (nodeId: string, flag: boolean) => void;
  readonly setError: (nodeId: string, error: WireError | undefined) => void;
}

export const useClassifyNodeStore = create<ClassifyNodeState>((set) => ({
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
 * Test seam — reset the module-scoped classify-node slice between cases.
 * Mirrors `resetEditWordingStore()`.
 */
export function resetClassifyNodeStore(): void {
  useClassifyNodeStore.setState({
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
 * The per-node classify-node hook. Accepts the bound `nodeId` (the
 * card's node id) and returns the imperative `propose` callback +
 * observable `inFlight` / `lastError` slices.
 *
 * **Subscription model.** Subscribes to the full `inFlight` Set +
 * `errors` Map references so the palette's render observes flips for
 * its bound nodeId; the per-key projections (`inFlight` boolean,
 * `lastError`) are derived in the hook body. Mirrors
 * `useEditWordingAction`'s posture.
 */
export function useProposeClassifyNodeAction(nodeId: string): UseProposeClassifyNodeActionResult {
  const { t } = useTranslation();

  // Session-id read off the route param (same as the sibling per-node
  // hooks).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  // Subscribe to the full slices — the per-key derivation below filters
  // down to the bound nodeId.
  const inFlightSet = useClassifyNodeStore((s) => s.inFlight);
  const errorsMap = useClassifyNodeStore((s) => s.errors);

  const inFlight = inFlightSet.has(nodeId);
  const lastError = errorsMap.get(nodeId);

  async function propose(classification: StatementKind): Promise<void> {
    // In-flight guard — concurrent click on the SAME nodeId is a no-op.
    if (useClassifyNodeStore.getState().inFlight.has(nodeId)) {
      return;
    }

    // Flip in-flight + clear any prior error for this key. The order
    // matters: the palette's render transitions before the WS send
    // fires, so a test that asserts the in-flight visual immediately
    // after the click observes the post-flip state.
    const store = useClassifyNodeStore.getState();
    store.setInFlight(nodeId, true);
    store.setError(nodeId, undefined);

    try {
      const expectedSequence =
        useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
      await client.send('propose', {
        sessionId,
        expectedSequence,
        proposal: {
          kind: 'classify-node',
          node_id: nodeId,
          classification,
        },
      });

      // Success — clear in-flight, drop any stale error for this key.
      const store2 = useClassifyNodeStore.getState();
      store2.setInFlight(nodeId, false);
      store2.setError(nodeId, undefined);
    } catch (err) {
      // Failure — surface the wire error inline on this nodeId. The
      // palette restores its un-pressed state (the optimistic clear
      // was the in-flight flip; reverting that lets the moderator
      // retry).
      const timeoutText = t('moderator.classifyNodeAction.errorBanner.timeout');
      const store2 = useClassifyNodeStore.getState();
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
