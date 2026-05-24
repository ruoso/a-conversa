// `useProposeSetEdgeSubstanceAction(edgeId)` — the moderator's per-edge
// set-edge-substance propose hook.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_mod_edge_card_substance_affordance.md
// ADRs:       docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§1, §8, §10)
// Mirror:     apps/moderator/src/layout/useProposeSetNodeSubstanceAction.ts
//             (the node-side per-entity propose hook for the substance
//             facet — same per-id Zustand-store shape; same `toWireError`
//             mapping; same in-flight guard. The two hooks are deliberately
//             parallel; a future refactor may merge into a shared base.)
//
// **Per-edgeId keying.** Each `<EdgeCardSubstanceAffordance>` is bound
// to a single edgeId — the edge label it mounts on. The in-flight set
// + per-key error map are keyed by that edgeId so two concurrent
// set-edge-substance proposals against different edges observe
// disjoint in-flight / error state. The keying mirrors
// `useProposeSetNodeSubstanceAction`'s shape exactly.
//
// **Per-facet refactor (ADR 0030 §1 + §8).** For edges the facet
// sequence is `shape → substance`. Shape lands inline on
// `edge-created`; once shape settles, substance becomes the next
// facet awaiting a candidate. This hook is the wire-write surface for
// the substance-proposal gesture — clicking a value dispatches a
// `propose` envelope with `proposal: { kind: 'set-edge-substance',
// edge_id, value }`.
//
// **No bundled events.** This hook ONLY mints `set-edge-substance`
// against an extant edge whose shape has settled. The server's
// sequence gate (`pf_sequence_gate_server_enforced`) is the integrity
// boundary that rejects a `set-edge-substance` against an unsettled
// shape facet; the UI mounts the affordance only when
// `substance === 'awaiting-proposal'` (the simplest predicate that
// admits the in-sequence case — see the affordance's Decisions for
// the rationale on not also checking `shape`).
//
// **No endpoint fields on the propose payload.** Per the
// `setEdgeSubstanceProposalSchema` two-arm contract, the optional
// `source_node_id` / `target_node_id` / `role` fields are populated
// ONLY for the connecting-edge case (proposing the substance for a
// freshly-minted edge that doesn't exist on the projection yet). This
// hook targets an EXTANT edge already on the canvas — so the payload
// carries only `edge_id` + `value`, no endpoint fields.

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';

/**
 * The two possible substance values per `docs/data-model.md:248`:
 *   - `'agreed'` — the moderator proposes "the relation holds".
 *   - `'disputed'` — the moderator proposes "the relation doesn't hold".
 *
 * Exported so the affordance component + tests share one enumeration.
 * Identical to the node-side `SubstanceValue` shape — re-declared here
 * (rather than re-exported) so the hook stays independently consumable.
 */
export type SubstanceValue = 'agreed' | 'disputed';

/**
 * Wire-error shape surfaced on `lastError`. Re-declared here (rather
 * than imported from a sibling propose hook) so the hook stays
 * independently consumable — same redeclaration pattern the other
 * per-entity hooks use.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseProposeSetEdgeSubstanceActionResult {
  /**
   * Trigger the set-edge-substance proposal for the bound edgeId with
   * the picked `value`. The in-flight guard short-circuits a concurrent
   * click on the SAME edgeId while the prior round-trip is still in
   * flight; clicks against different edges are allowed in parallel.
   */
  propose: (value: SubstanceValue) => Promise<void>;
  /** True while a propose for the bound edgeId is in flight. */
  inFlight: boolean;
  /** The wire-error from the last failed propose for the bound edgeId, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice tracking per-edgeId in-flight
 * set-edge-substance state + the last wire error per edgeId. Lives
 * outside React so two `useProposeSetEdgeSubstanceAction(edgeId)` call
 * sites for the same edge share state — mirrors
 * `useSetNodeSubstanceStore`.
 */
interface SetEdgeSubstanceState {
  readonly inFlight: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setInFlight: (edgeId: string, flag: boolean) => void;
  readonly setError: (edgeId: string, error: WireError | undefined) => void;
}

export const useSetEdgeSubstanceStore = create<SetEdgeSubstanceState>((set) => ({
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
 * Test seam — reset the module-scoped set-edge-substance slice between
 * cases. Mirrors `resetSetNodeSubstanceStore()`.
 */
export function resetSetEdgeSubstanceStore(): void {
  useSetEdgeSubstanceStore.setState({
    inFlight: new Set<string>(),
    errors: new Map<string, WireError>(),
  });
}

/**
 * Map any thrown error to the `WireError` surface. Mirrors the same
 * helper in the sibling per-entity hooks.
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
 * The per-edge set-edge-substance hook. Accepts the bound `edgeId`
 * (the edge label's id) and returns the imperative `propose` callback
 * + observable `inFlight` / `lastError` slices.
 *
 * **Subscription model.** Subscribes to the full `inFlight` Set +
 * `errors` Map references so the affordance's render observes flips
 * for its bound edgeId; the per-key projections (`inFlight` boolean,
 * `lastError`) are derived in the hook body. Mirrors
 * `useProposeSetNodeSubstanceAction`'s posture.
 */
export function useProposeSetEdgeSubstanceAction(
  edgeId: string,
): UseProposeSetEdgeSubstanceActionResult {
  const { t } = useTranslation();

  // Session-id read off the route param (same as the sibling per-entity
  // hooks).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  // Subscribe to the full slices — the per-key derivation below filters
  // down to the bound edgeId.
  const inFlightSet = useSetEdgeSubstanceStore((s) => s.inFlight);
  const errorsMap = useSetEdgeSubstanceStore((s) => s.errors);

  const inFlight = inFlightSet.has(edgeId);
  const lastError = errorsMap.get(edgeId);

  async function propose(value: SubstanceValue): Promise<void> {
    // In-flight guard — concurrent click on the SAME edgeId is a no-op.
    if (useSetEdgeSubstanceStore.getState().inFlight.has(edgeId)) {
      return;
    }

    // Flip in-flight + clear any prior error for this key. The order
    // matters: the affordance's render transitions before the WS send
    // fires, so a test that asserts the in-flight visual immediately
    // after the click observes the post-flip state. Mirrors the
    // node-side hook.
    const store = useSetEdgeSubstanceStore.getState();
    store.setInFlight(edgeId, true);
    store.setError(edgeId, undefined);

    try {
      const expectedSequence =
        useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
      await client.send('propose', {
        sessionId,
        expectedSequence,
        proposal: {
          kind: 'set-edge-substance',
          edge_id: edgeId,
          value,
        },
      });

      // Success — clear in-flight, drop any stale error for this key.
      const store2 = useSetEdgeSubstanceStore.getState();
      store2.setInFlight(edgeId, false);
      store2.setError(edgeId, undefined);
    } catch (err) {
      // Failure — surface the wire error inline on this edgeId. The
      // affordance restores its un-pressed state.
      const timeoutText = t('moderator.setNodeSubstanceAction.errorBanner.timeout');
      const store2 = useSetEdgeSubstanceStore.getState();
      store2.setInFlight(edgeId, false);
      store2.setError(edgeId, toWireError(err, timeoutText));
    }
  }

  return {
    propose,
    inFlight,
    lastError,
  };
}
